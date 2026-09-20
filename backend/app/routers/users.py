"""Profiles and appearance settings."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import DEFAULT_THEME, Track, User
from ..schemas import ProfilePatch, PublicUser, ThemePatch, UserOut
from ..security import current_user, current_user_optional, slugify_handle
from ..serializers import track_out

router = APIRouter(prefix="/api", tags=["users"])

# Every animated background the appearance editor can choose from. The frontend
# renders each one; this list is what the server will accept.
BACKGROUNDS = [
    "aurora", "starfield", "mesh", "waves", "particles", "grid",
    "liquid", "spectrum", "orbit", "rain", "noise", "sunset",
    "matrix", "plasma", "none",
]

# Visualizers drawn over the now-playing screen while audio runs. "off" is a
# real choice, not a missing value -- some people just want the words.
VISUALIZERS = [
    "bars", "mirror", "wave", "twin", "orb", "ring", "bloom", "rings",
    "tunnel", "starburst", "matrix", "spiral", "terrain", "kaleido",
    "sparks", "video", "off",
]


@router.patch("/me", response_model=UserOut)
def update_profile(
    body: ProfilePatch,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    data = body.model_dump(exclude_unset=True)

    if "handle" in data and data["handle"]:
        handle = slugify_handle(data["handle"])
        clash = (
            db.query(User)
            .filter(User.handle == handle, User.id != user.id)
            .first()
        )
        if clash:
            raise HTTPException(409, f"@{handle} is taken.")
        data["handle"] = handle

    for field, value in data.items():
        setattr(user, field, value)
    db.commit()
    return user


@router.get("/me/theme")
def get_theme(user: User = Depends(current_user)) -> dict:
    return {
        **DEFAULT_THEME,
        **(user.theme or {}),
        "backgrounds": BACKGROUNDS,
        "visualizers": VISUALIZERS,
    }


@router.patch("/me/theme")
def update_theme(
    body: ThemePatch,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> dict:
    data = body.model_dump(exclude_unset=True, exclude_none=True)
    if "background" in data and data["background"] not in BACKGROUNDS:
        raise HTTPException(422, f"Unknown background: {data['background']}")
    if "visualizer" in data and data["visualizer"] not in VISUALIZERS:
        raise HTTPException(422, f"Unknown visualizer: {data['visualizer']}")
    from .profiles import FONTS

    if "font" in data and data["font"] not in FONTS:
        raise HTTPException(422, "Unknown font: " + str(data["font"]))
    if "video_fit" in data and data["video_fit"] not in {"cover", "contain"}:
        raise HTTPException(422, "video_fit must be cover or contain")
    if data.get("video_id"):
        from ..models import VideoLoop

        loop = db.get(VideoLoop, data["video_id"])
        if loop is None or loop.owner_id != user.id:
            raise HTTPException(404, "That clip no longer exists.")
    if data.get("visualizer") == "video":
        chosen = data.get("video_id") or (user.theme or {}).get("video_id")
        if not chosen:
            raise HTTPException(422, "Upload a clip before picking the video visualizer.")

    # JSON columns need a fresh object for SQLAlchemy to notice the change.
    user.theme = {**DEFAULT_THEME, **(user.theme or {}), **data}
    db.commit()
    return user.theme


@router.get("/backgrounds", response_model=list[str])
def list_backgrounds() -> list[str]:
    return BACKGROUNDS


@router.get("/visualizers", response_model=list[str])
def list_visualizers() -> list[str]:
    return VISUALIZERS


@router.get("/u/{handle}")
def public_profile(
    handle: str,
    db: Session = Depends(get_db),
    viewer: User | None = Depends(current_user_optional),
):
    """An artist's public page: their theme, plus anything marked public."""
    user = db.query(User).filter(User.handle == handle.lstrip("@")).first()
    if user is None:
        raise HTTPException(404, "No artist with that handle.")

    tracks = (
        db.query(Track)
        .filter(Track.owner_id == user.id, Track.visibility == "public")
        .order_by(Track.created_at.desc())
        .all()
    )
    from .profiles import badges_for, follow_state

    profile = PublicUser.model_validate(user, from_attributes=True)
    profile.badges = badges_for(db, user)
    return {
        "user": profile,
        "follow": follow_state(db, user, viewer).model_dump(),
        "tracks": [track_out(db, t, viewer) for t in tracks],
        "is_me": viewer is not None and viewer.id == user.id,
    }
