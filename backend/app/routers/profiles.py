"""Profiles: pictures, banners, badges, following, and the font it all reads in.

Everything here is free. The site has no paid tier and is not getting one, so
badges are earned from what someone has actually done rather than bought.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from .. import images
from ..config import get_settings
from ..db import get_db
from ..models import Follow, Rating, Track, User
from ..schemas import FollowState, PublicUser, UserOut
from ..security import current_user, current_user_optional

router = APIRouter(prefix="/api", tags=["profiles"])
settings = get_settings()

# Typefaces a profile can be written in. Each is a Google Font the client
# loads on demand, so the list costs nothing until one is picked.
FONTS = [
    "Outfit", "Inter", "Space Grotesk", "Poppins", "Playfair Display",
    "Bebas Neue", "Archivo Black", "DM Serif Display", "JetBrains Mono",
    "Rubik", "Lora", "Chakra Petch",
]


# ---------------------------------------------------------------------------
# Badges
# ---------------------------------------------------------------------------


def badges_for(db: Session, user: User) -> list[dict]:
    earned: list[dict] = []

    tracks = db.query(func.count(Track.id)).filter(Track.owner_id == user.id).scalar() or 0
    if tracks >= 1:
        earned.append({"id": "uploader", "label": "Has uploaded",
                       "hint": "Put music in the vault"})
    if tracks >= 25:
        earned.append({"id": "archivist", "label": "Archivist",
                       "hint": "25 tracks or more"})
    if tracks >= 100:
        earned.append({"id": "prolific", "label": "Prolific",
                       "hint": "100 tracks or more"})

    published = (
        db.query(func.count(Track.id))
        .filter(Track.owner_id == user.id, Track.showcased.is_(True))
        .scalar() or 0
    )
    if published:
        earned.append({"id": "published", "label": "Published",
                       "hint": "Music on the showcase"})

    followers = (
        db.query(func.count(Follow.id)).filter(Follow.following_id == user.id).scalar() or 0
    )
    if followers >= 10:
        earned.append({"id": "followed", "label": "Followed",
                       "hint": "Ten followers or more"})

    rated = db.query(func.count(Rating.id)).filter(Rating.user_id == user.id).scalar() or 0
    if rated >= 10:
        earned.append({"id": "listener", "label": "Listener",
                       "hint": "Rated ten things"})

    return earned


# ---------------------------------------------------------------------------
# Pictures
# ---------------------------------------------------------------------------


async def _read(file: UploadFile) -> bytes:
    if not images.looks_like_image(file.filename or "", file.content_type):
        raise HTTPException(415, "Pick a JPG, PNG, GIF or WEBP.")
    data = await file.read()
    await file.close()
    if not data:
        raise HTTPException(422, "That file was empty.")
    return data


@router.put("/me/avatar", response_model=UserOut)
async def upload_avatar(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """Profile picture. An animated GIF stays animated."""
    data = await _read(file)
    try:
        name = images.save_avatar(data, settings.profiles_dir)
    except images.ImageError as exc:
        raise HTTPException(422, str(exc)) from exc

    previous = user.avatar_name
    user.avatar_name = name
    db.commit()
    images.delete_profile_image(settings.profiles_dir, previous)
    return user


@router.delete("/me/avatar", response_model=UserOut)
def remove_avatar(db: Session = Depends(get_db), user: User = Depends(current_user)):
    previous = user.avatar_name
    user.avatar_name = None
    db.commit()
    images.delete_profile_image(settings.profiles_dir, previous)
    return user


@router.put("/me/banner", response_model=UserOut)
async def upload_banner(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    data = await _read(file)
    try:
        name = images.save_banner(data, settings.profiles_dir)
    except images.ImageError as exc:
        raise HTTPException(422, str(exc)) from exc

    previous = user.banner_name
    user.banner_name = name
    db.commit()
    images.delete_profile_image(settings.profiles_dir, previous)
    return user


@router.delete("/me/banner", response_model=UserOut)
def remove_banner(db: Session = Depends(get_db), user: User = Depends(current_user)):
    previous = user.banner_name
    user.banner_name = None
    db.commit()
    images.delete_profile_image(settings.profiles_dir, previous)
    return user


def _serve(name: str | None):
    if not name:
        raise HTTPException(404, "Nothing set.")
    path = settings.profiles_dir / name
    if not path.exists():
        raise HTTPException(410, "That image is missing from disk.")
    return FileResponse(
        path,
        media_type="image/gif" if name.endswith(".gif") else "image/jpeg",
        # The URL carries a version tag, so this can be cached hard.
        headers={"Cache-Control": "public, max-age=604800, immutable"},
    )


def _by_handle(db: Session, handle: str) -> User:
    user = db.query(User).filter(User.handle == handle.lstrip("@")).first()
    if user is None:
        raise HTTPException(404, "No artist with that handle.")
    return user


@router.get("/u/{handle}/avatar")
def profile_avatar(handle: str, db: Session = Depends(get_db)):
    return _serve(_by_handle(db, handle).avatar_name)


@router.get("/u/{handle}/banner")
def profile_banner(handle: str, db: Session = Depends(get_db)):
    return _serve(_by_handle(db, handle).banner_name)


# ---------------------------------------------------------------------------
# Following
# ---------------------------------------------------------------------------


def follow_state(db: Session, target: User, viewer: User | None) -> FollowState:
    followers = (
        db.query(func.count(Follow.id)).filter(Follow.following_id == target.id).scalar() or 0
    )
    follows = (
        db.query(func.count(Follow.id)).filter(Follow.follower_id == target.id).scalar() or 0
    )
    following = False
    if viewer is not None:
        following = (
            db.query(Follow.id)
            .filter(Follow.follower_id == viewer.id, Follow.following_id == target.id)
            .first()
            is not None
        )
    return FollowState(following=following, followers=followers, follows=follows)


@router.get("/u/{handle}/follow", response_model=FollowState)
def follow_status(
    handle: str,
    db: Session = Depends(get_db),
    viewer: User | None = Depends(current_user_optional),
):
    return follow_state(db, _by_handle(db, handle), viewer)


@router.post("/u/{handle}/follow", response_model=FollowState)
def follow(handle: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    target = _by_handle(db, handle)
    if target.id == user.id:
        raise HTTPException(400, "You cannot follow yourself.")
    already = (
        db.query(Follow)
        .filter(Follow.follower_id == user.id, Follow.following_id == target.id)
        .first()
    )
    if already is None:
        db.add(Follow(follower_id=user.id, following_id=target.id))
        db.commit()
    return follow_state(db, target, user)


@router.delete("/u/{handle}/follow", response_model=FollowState)
def unfollow(handle: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    target = _by_handle(db, handle)
    db.query(Follow).filter(
        Follow.follower_id == user.id, Follow.following_id == target.id
    ).delete()
    db.commit()
    return follow_state(db, target, user)


@router.get("/u/{handle}/followers", response_model=list[PublicUser])
def followers(handle: str, db: Session = Depends(get_db), limit: int = 100):
    target = _by_handle(db, handle)
    rows = (
        db.query(User)
        .join(Follow, Follow.follower_id == User.id)
        .filter(Follow.following_id == target.id)
        .order_by(Follow.created_at.desc())
        .limit(min(limit, 200))
        .all()
    )
    return [PublicUser.model_validate(u, from_attributes=True) for u in rows]


@router.get("/u/{handle}/following", response_model=list[PublicUser])
def following(handle: str, db: Session = Depends(get_db), limit: int = 100):
    target = _by_handle(db, handle)
    rows = (
        db.query(User)
        .join(Follow, Follow.following_id == User.id)
        .filter(Follow.follower_id == target.id)
        .order_by(Follow.created_at.desc())
        .limit(min(limit, 200))
        .all()
    )
    return [PublicUser.model_validate(u, from_attributes=True) for u in rows]


@router.get("/fonts", response_model=list[str])
def list_fonts() -> list[str]:
    return FONTS


@router.get("/users/search", response_model=list[PublicUser])
def search_users(
    q: str = Query(default="", max_length=60),
    db: Session = Depends(get_db),
    limit: int = Query(default=30, ge=1, le=100),
):
    """Find people by handle or display name.

    An empty search returns the most recently joined, so the page has
    something on it before anyone types.
    """
    query = db.query(User)
    needle = q.strip().lstrip("@").lower()
    if needle:
        pattern = f"%{needle}%"
        query = query.filter(
            or_(
                func.lower(User.handle).like(pattern),
                func.lower(User.display_name).like(pattern),
            )
        )
    rows = query.order_by(User.created_at.desc()).limit(limit).all()

    out: list[PublicUser] = []
    for user in rows:
        profile = PublicUser.model_validate(user, from_attributes=True)
        profile.badges = badges_for(db, user)
        out.append(profile)
    return out
