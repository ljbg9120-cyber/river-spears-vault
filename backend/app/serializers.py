"""Turning ORM rows into the shapes the client expects."""
from __future__ import annotations

from sqlalchemy import func
from sqlalchemy.orm import Session

from .models import Comment, Folder, Like, Track, User
from .schemas import CommentOut, FolderOut, PublicUser, TrackOut


def cover_url(folder: Folder | None, share_token: str | None = None,
              thumb: bool = False) -> str:
    """Empty string when there is no art, so the client can fall back."""
    if folder is None or not folder.cover_name:
        return ""
    url = f"/api/folders/{folder.id}/cover"
    params = []
    if thumb:
        params.append("thumb=1")
    if share_token:
        params.append(f"t={share_token}")
    # The stored name changes on every re-upload, which busts any cache.
    params.append(f"v={folder.cover_name[:8]}")
    return f"{url}?{'&'.join(params)}"


def folder_out(folder: Folder, track_count: int = 0) -> FolderOut:
    data = FolderOut.model_validate(folder, from_attributes=True)
    data.track_count = track_count
    data.cover_url = cover_url(folder)
    data.has_cover = bool(folder.cover_name)
    return data


def track_out(
    db: Session, track: Track, viewer: User | None = None, share_token: str | None = None
) -> TrackOut:
    return tracks_out(db, [track], viewer, share_token)[0]


def tracks_out(
    db: Session, tracks: list[Track], viewer: User | None = None,
    share_token: str | None = None,
) -> list[TrackOut]:
    """Aggregate activity once per page, not three queries for every track."""
    if not tracks:
        return []
    ids = [track.id for track in tracks]
    comment_counts = {
        tid: (total, unresolved) for tid, total, unresolved in db.query(
            Comment.track_id, func.count(Comment.id),
            func.count(Comment.id).filter(Comment.resolved.is_(False)),
        ).filter(Comment.track_id.in_(ids)).group_by(Comment.track_id).all()
    }
    like_counts = dict(db.query(Like.track_id, func.count(Like.id)).filter(
        Like.track_id.in_(ids),
    ).group_by(Like.track_id).all())
    liked_ids: set[str] = set()
    if viewer is not None:
        liked_ids = {tid for (tid,) in db.query(Like.track_id).filter(
            Like.track_id.in_(ids), Like.user_id == viewer.id,
        ).all()}
    result = []
    for track in tracks:
        stream = f"/api/tracks/{track.id}/stream"
        if share_token:
            stream = f"{stream}?t={share_token}"
        data = TrackOut.model_validate(track, from_attributes=True)
        data.owner = PublicUser.model_validate(track.owner, from_attributes=True)
        data.comment_count, data.unresolved_comment_count = comment_counts.get(track.id, (0, 0))
        data.like_count = like_counts.get(track.id, 0)
        data.liked_by_me = track.id in liked_ids
        data.stream_url = stream
        data.cover_url = cover_url(track.folder, share_token)
        result.append(data)
    return result


def comment_out(comment: Comment, track_owner_id: str) -> CommentOut:
    author = comment.user
    return CommentOut(
        id=comment.id,
        body=comment.body,
        at_sec=comment.at_sec,
        created_at=comment.created_at,
        author_name=(author.display_name if author else (comment.guest_name or "Guest")),
        author_handle=author.handle if author else None,
        author_avatar=author.avatar_url if author else None,
        is_owner=bool(author and author.id == track_owner_id),
        resolved=comment.resolved,
        resolved_at=comment.resolved_at,
    )
