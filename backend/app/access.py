"""Who is allowed to hear what."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .models import Folder, ShareLink, Track, User


def share_link_for(db: Session, token: str | None) -> ShareLink | None:
    if not token:
        return None
    link = db.query(ShareLink).filter(ShareLink.token == token).first()
    if link is None:
        return None
    if link.expires_at is not None:
        expires = link.expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires < datetime.now(timezone.utc):
            return None
    return link


def link_covers_track(link: ShareLink | None, track: Track) -> bool:
    if link is None:
        return False
    if link.track_id and link.track_id == track.id:
        return True
    if link.folder_id and track.folder_id and link.folder_id == track.folder_id:
        return True
    return False


def can_view_track(
    db: Session, track: Track, viewer: User | None, token: str | None = None
) -> bool:
    if viewer is not None and track.owner_id == viewer.id:
        return True
    if track.visibility == "public":
        return True
    return link_covers_track(share_link_for(db, token), track)


def require_track(
    db: Session, track_id: str, viewer: User | None, token: str | None = None
) -> Track:
    track = db.get(Track, track_id)
    if track is None:
        raise HTTPException(404, "That track no longer exists.")
    if not can_view_track(db, track, viewer, token):
        raise HTTPException(404, "That track no longer exists.")
    return track


def require_own_track(db: Session, track_id: str, owner: User) -> Track:
    track = db.get(Track, track_id)
    if track is None or track.owner_id != owner.id:
        raise HTTPException(404, "That track no longer exists.")
    return track


def can_view_folder(
    db: Session, folder: Folder, viewer: User | None, token: str | None = None
) -> bool:
    """Album art is visible to its owner, to anyone holding a link that covers
    it, and to everyone once the album has a public track on a profile."""
    if viewer is not None and folder.owner_id == viewer.id:
        return True

    link = share_link_for(db, token)
    if link is not None:
        if link.folder_id and link.folder_id == folder.id:
            return True
        if link.track_id:
            shared = db.get(Track, link.track_id)
            if shared is not None and shared.folder_id == folder.id:
                return True

    public = (
        db.query(Track.id)
        .filter(Track.folder_id == folder.id, Track.visibility == "public")
        .first()
    )
    return public is not None
