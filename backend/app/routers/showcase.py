"""The public showcase: music its owner chose to publish, and what people make of it.

Anyone can browse it signed out. Rating needs an account, and one account is
one vote per item — changing your mind overwrites rather than stacking, which
is the difference between a rating and a poll you can stuff.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Folder, Rating, Track, User
from ..schemas import PublicUser, RateIn, ShowcaseItem
from ..security import current_user, current_user_optional
from ..serializers import cover_url

router = APIRouter(prefix="/api/showcase", tags=["showcase"])


def _scores(db: Session, column, ids: list[str]) -> dict[str, tuple[float, int]]:
    """Average and count per item, in one query rather than one per row."""
    if not ids:
        return {}
    rows = (
        db.query(column, func.avg(Rating.stars), func.count(Rating.id))
        .filter(column.in_(ids))
        .group_by(column)
        .all()
    )
    return {key: (float(avg or 0), int(count or 0)) for key, avg, count in rows}


def _mine(db: Session, viewer: User | None, column, ids: list[str]) -> dict[str, int]:
    if viewer is None or not ids:
        return {}
    rows = (
        db.query(column, Rating.stars)
        .filter(Rating.user_id == viewer.id, column.in_(ids))
        .all()
    )
    return {key: stars for key, stars in rows}


@router.get("", response_model=list[ShowcaseItem])
def browse(
    db: Session = Depends(get_db),
    viewer: User | None = Depends(current_user_optional),
    sort: str = Query(default="top"),
    kind: str = Query(default="all"),
    limit: int = Query(default=60, ge=1, le=200),
):
    """Everything published, newest or best first."""
    items: list[ShowcaseItem] = []

    if kind in ("all", "track"):
        tracks = (
            db.query(Track)
            .filter(Track.showcased.is_(True))
            .order_by(Track.created_at.desc())
            .limit(limit)
            .all()
        )
        ids = [t.id for t in tracks]
        scores = _scores(db, Rating.track_id, ids)
        mine = _mine(db, viewer, Rating.track_id, ids)
        for t in tracks:
            avg, count = scores.get(t.id, (0.0, 0))
            items.append(ShowcaseItem(
                kind="track", id=t.id, title=t.title,
                cover_url=cover_url(t.folder), owner=PublicUser.model_validate(t.owner, from_attributes=True),
                created_at=t.created_at, rating_avg=round(avg, 2), rating_count=count,
                my_rating=mine.get(t.id), duration=t.duration,
                stream_url=f"/api/tracks/{t.id}/stream", tags=list(t.tags or []),
            ))

    if kind in ("all", "album"):
        folders = (
            db.query(Folder)
            .filter(Folder.showcased.is_(True))
            .order_by(Folder.created_at.desc())
            .limit(limit)
            .all()
        )
        ids = [f.id for f in folders]
        scores = _scores(db, Rating.folder_id, ids)
        mine = _mine(db, viewer, Rating.folder_id, ids)
        counts = dict(
            db.query(Track.folder_id, func.count(Track.id))
            .filter(Track.folder_id.in_(ids))
            .group_by(Track.folder_id)
            .all()
        ) if ids else {}
        for f in folders:
            avg, count = scores.get(f.id, (0.0, 0))
            items.append(ShowcaseItem(
                kind="album", id=f.id, title=f.name, cover_url=cover_url(f),
                owner=PublicUser.model_validate(f.owner, from_attributes=True),
                created_at=f.created_at, rating_avg=round(avg, 2), rating_count=count,
                my_rating=mine.get(f.id), track_count=int(counts.get(f.id, 0)),
            ))

    if sort == "new":
        items.sort(key=lambda i: i.created_at, reverse=True)
    else:
        # Unrated things should not outrank a well-liked one, so rank by score
        # first and use the number of votes to break ties.
        items.sort(key=lambda i: (i.rating_avg, i.rating_count), reverse=True)
    return items[:limit]


def _rate(db: Session, user: User, stars: int, *, track: Track | None = None,
          folder: Folder | None = None) -> dict:
    query = db.query(Rating).filter(Rating.user_id == user.id)
    query = query.filter(Rating.track_id == track.id) if track else \
        query.filter(Rating.folder_id == folder.id)

    existing = query.first()
    if existing:
        existing.stars = stars
    else:
        db.add(Rating(
            user_id=user.id, stars=stars,
            track_id=track.id if track else None,
            folder_id=folder.id if folder else None,
        ))
    db.commit()

    column = Rating.track_id if track else Rating.folder_id
    target = track.id if track else folder.id
    avg, count = (
        db.query(func.avg(Rating.stars), func.count(Rating.id))
        .filter(column == target)
        .first()
    )
    return {
        "rating_avg": round(float(avg or 0), 2),
        "rating_count": int(count or 0),
        "my_rating": stars,
    }


@router.post("/tracks/{track_id}/rate")
def rate_track(
    track_id: str,
    body: RateIn,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    track = db.get(Track, track_id)
    if track is None or not track.showcased:
        raise HTTPException(404, "That track is not on the showcase.")
    if track.owner_id == user.id:
        raise HTTPException(403, "You cannot rate your own music.")
    return _rate(db, user, body.stars, track=track)


@router.post("/albums/{folder_id}/rate")
def rate_album(
    folder_id: str,
    body: RateIn,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    folder = db.get(Folder, folder_id)
    if folder is None or not folder.showcased:
        raise HTTPException(404, "That album is not on the showcase.")
    if folder.owner_id == user.id:
        raise HTTPException(403, "You cannot rate your own music.")
    return _rate(db, user, body.stars, folder=folder)


@router.post("/tracks/{track_id}/publish")
def publish_track(
    track_id: str,
    on: bool = True,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """Put one of your own tracks on the showcase, or take it back off."""
    track = db.get(Track, track_id)
    if track is None or track.owner_id != user.id:
        raise HTTPException(404, "That track no longer exists.")
    track.showcased = on
    # Something nobody can play is not a showcase entry.
    if on and track.visibility == "private":
        track.visibility = "public"
    db.commit()
    return {"showcased": track.showcased, "visibility": track.visibility}


@router.post("/albums/{folder_id}/publish")
def publish_album(
    folder_id: str,
    on: bool = True,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    folder = db.get(Folder, folder_id)
    if folder is None or folder.owner_id != user.id:
        raise HTTPException(404, "That album no longer exists.")
    folder.showcased = on
    if on:
        for track in db.query(Track).filter(Track.folder_id == folder.id).all():
            if track.visibility == "private":
                track.visibility = "public"
    db.commit()
    return {"showcased": folder.showcased}
