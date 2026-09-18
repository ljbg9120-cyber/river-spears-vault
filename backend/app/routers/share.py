"""Private share links — one track or a whole album, no account required to listen."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..access import share_link_for
from ..config import get_settings
from ..db import get_db
from ..models import Folder, ShareLink, Track, User
from ..schemas import PublicUser, ShareIn, ShareOut
from ..security import current_user, current_user_optional
from ..serializers import cover_url, track_out

router = APIRouter(prefix="/api", tags=["share"])
settings = get_settings()


def _share_out(link: ShareLink) -> ShareOut:
    data = ShareOut.model_validate(link, from_attributes=True)
    data.url = f"{settings.public_url.rstrip('/')}/s/{link.token}"
    return data


@router.post("/shares", response_model=ShareOut, status_code=201)
def create_share(
    body: ShareIn, db: Session = Depends(get_db), user: User = Depends(current_user)
):
    if bool(body.track_id) == bool(body.folder_id):
        raise HTTPException(422, "Share exactly one track or one album.")

    if body.track_id:
        track = db.get(Track, body.track_id)
        if track is None or track.owner_id != user.id:
            raise HTTPException(404, "That track no longer exists.")
        label = body.label or track.title
    else:
        folder = db.get(Folder, body.folder_id)
        if folder is None or folder.owner_id != user.id:
            raise HTTPException(404, "That album no longer exists.")
        label = body.label or folder.name

    expires = None
    if body.expires_in_days:
        expires = datetime.now(timezone.utc) + timedelta(days=body.expires_in_days)

    link = ShareLink(
        owner_id=user.id,
        track_id=body.track_id,
        folder_id=body.folder_id,
        label=label[:120],
        allow_download=body.allow_download,
        allow_comments=body.allow_comments,
        expires_at=expires,
    )
    db.add(link)
    db.commit()
    return _share_out(link)


@router.get("/shares", response_model=list[ShareOut])
def my_shares(db: Session = Depends(get_db), user: User = Depends(current_user)):
    links = (
        db.query(ShareLink)
        .filter(ShareLink.owner_id == user.id)
        .order_by(ShareLink.created_at.desc())
        .all()
    )
    return [_share_out(link) for link in links]


@router.delete("/shares/{share_id}")
def revoke_share(
    share_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)
):
    link = db.get(ShareLink, share_id)
    if link is None or link.owner_id != user.id:
        raise HTTPException(404, "That link is already revoked.")
    db.delete(link)
    db.commit()
    return {"ok": True}


@router.get("/share/{token}")
def open_share(
    token: str,
    db: Session = Depends(get_db),
    viewer: User | None = Depends(current_user_optional),
):
    """What a listener sees when they open a share link. No account needed."""
    link = share_link_for(db, token)
    if link is None:
        raise HTTPException(404, "This link has expired or been revoked.")

    link.views += 1
    db.commit()

    folder = None
    if link.track_id:
        tracks = [t for t in [db.get(Track, link.track_id)] if t is not None]
        kind, title = "track", (tracks[0].title if tracks else link.label)
        if tracks and tracks[0].folder_id:
            folder = db.get(Folder, tracks[0].folder_id)
    else:
        tracks = (
            db.query(Track)
            .filter(Track.folder_id == link.folder_id)
            .order_by(Track.created_at.asc())
            .all()
        )
        folder = db.get(Folder, link.folder_id)
        kind, title = "album", (folder.name if folder else link.label)

    owner = db.get(User, link.owner_id)
    return {
        "kind": kind,
        "title": title,
        "label": link.label,
        "allow_download": link.allow_download,
        "allow_comments": link.allow_comments,
        "cover_url": cover_url(folder, token),
        "owner": PublicUser.model_validate(owner, from_attributes=True),
        "tracks": [track_out(db, t, viewer, token) for t in tracks],
    }
