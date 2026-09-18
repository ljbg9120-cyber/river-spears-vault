"""Timestamped feedback on a track."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..access import link_covers_track, require_track, share_link_for
from ..db import get_db
from ..models import Comment, User
from ..schemas import CommentIn, CommentOut
from ..security import current_user, current_user_optional
from ..serializers import comment_out

router = APIRouter(prefix="/api/tracks/{track_id}/comments", tags=["comments"])


@router.get("", response_model=list[CommentOut])
def list_comments(
    track_id: str,
    t: str | None = None,
    db: Session = Depends(get_db),
    viewer: User | None = Depends(current_user_optional),
):
    track = require_track(db, track_id, viewer, t)
    rows = (
        db.query(Comment)
        .filter(Comment.track_id == track.id)
        .order_by(Comment.at_sec.is_(None), Comment.at_sec.asc(), Comment.created_at.asc())
        .all()
    )
    return [comment_out(c, track.owner_id) for c in rows]


@router.post("", response_model=CommentOut, status_code=201)
def add_comment(
    track_id: str,
    body: CommentIn,
    t: str | None = None,
    db: Session = Depends(get_db),
    viewer: User | None = Depends(current_user_optional),
):
    track = require_track(db, track_id, viewer, t)

    if viewer is None:
        # A listener on a share link: allowed only if that link permits comments.
        link = share_link_for(db, t)
        if not link_covers_track(link, track) or not link.allow_comments:
            raise HTTPException(403, "Sign in to leave feedback on this track.")
        if not (body.guest_name or "").strip():
            raise HTTPException(422, "Add your name so they know who this is from.")

    comment = Comment(
        track_id=track.id,
        user_id=viewer.id if viewer else None,
        guest_name=None if viewer else body.guest_name.strip()[:60],
        body=body.body.strip(),
        at_sec=body.at_sec,
    )
    db.add(comment)
    db.commit()
    return comment_out(comment, track.owner_id)


@router.delete("/{comment_id}")
def delete_comment(
    track_id: str,
    comment_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    comment = db.get(Comment, comment_id)
    if comment is None or comment.track_id != track_id:
        raise HTTPException(404, "That comment is already gone.")
    # The track's owner can clear anything on their own track; everyone else
    # can only remove their own words.
    track = comment.track
    if comment.user_id != user.id and track.owner_id != user.id:
        raise HTTPException(403, "That is not yours to delete.")
    db.delete(comment)
    db.commit()
    return {"ok": True}
