"""Private feedback triage and saved library views."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from ..db import get_db
from ..models import Comment, LibraryView, Track, User
from ..schemas import (
    CommentOut, CommentPatch, FeedbackOut, LibraryViewIn, LibraryViewOut,
    LibraryViewPatch,
)
from ..security import current_user
from ..serializers import comment_out, cover_url

router = APIRouter(prefix="/api", tags=["workflow"])


@router.patch("/comments/{comment_id}", response_model=CommentOut)
def resolve_comment(
    comment_id: str, body: CommentPatch, db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    comment = db.query(Comment).join(Track).filter(
        Comment.id == comment_id, Track.owner_id == user.id,
    ).first()
    if comment is None:
        raise HTTPException(404, "That comment no longer exists.")
    if comment.resolved != body.resolved:
        comment.resolved = body.resolved
        comment.resolved_at = datetime.now(timezone.utc) if body.resolved else None
        db.commit()
    return comment_out(comment, user.id)


@router.get("/feedback", response_model=list[FeedbackOut])
def feedback(
    resolved: bool | None = None,
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db), user: User = Depends(current_user),
):
    query = db.query(Comment).join(Track).filter(Track.owner_id == user.id)
    if resolved is not None:
        query = query.filter(Comment.resolved == resolved)
    rows = query.options(
        joinedload(Comment.user), joinedload(Comment.track).joinedload(Track.folder),
    ).order_by(Comment.created_at.desc(), Comment.id.desc()).offset(offset).limit(limit).all()
    return [FeedbackOut(
        **comment_out(c, user.id).model_dump(), track_id=c.track_id,
        track_title=c.track.title, track_cover_url=cover_url(c.track.folder),
        version_number=c.track.version_number, track_status=c.track.status,
    ) for c in rows]


def own_view(db: Session, view_id: str, user: User) -> LibraryView:
    view = db.get(LibraryView, view_id)
    if view is None or view.owner_id != user.id:
        raise HTTPException(404, "That saved view no longer exists.")
    return view


@router.get("/library-views", response_model=list[LibraryViewOut])
def library_views(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return db.query(LibraryView).filter(LibraryView.owner_id == user.id).order_by(
        LibraryView.created_at.asc(), LibraryView.id.asc(),
    ).all()


@router.post("/library-views", response_model=LibraryViewOut, status_code=201)
def create_view(
    body: LibraryViewIn, db: Session = Depends(get_db), user: User = Depends(current_user),
):
    if db.query(LibraryView).filter(LibraryView.owner_id == user.id).count() >= 100:
        raise HTTPException(422, "You can save up to 100 views. Remove one to make room.")
    view = LibraryView(owner_id=user.id, name=body.name, filters=body.filters.model_dump())
    db.add(view)
    db.commit()
    return view


@router.get("/library-views/{view_id}", response_model=LibraryViewOut)
def get_view(view_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return own_view(db, view_id, user)


@router.patch("/library-views/{view_id}", response_model=LibraryViewOut)
def update_view(
    view_id: str, body: LibraryViewPatch, db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    view = own_view(db, view_id, user)
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(view, key, value)
    db.commit()
    return view


@router.delete("/library-views/{view_id}")
def delete_view(
    view_id: str, db: Session = Depends(get_db), user: User = Depends(current_user),
):
    db.delete(own_view(db, view_id, user))
    db.commit()
    return {"ok": True}
