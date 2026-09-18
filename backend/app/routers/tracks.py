"""Uploading, browsing, streaming and organising tracks."""
from __future__ import annotations

import mimetypes
import re
import uuid
from pathlib import Path

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
)
from fastapi.responses import FileResponse
from sqlalchemy import String, func, or_
from sqlalchemy.orm import Session

from .. import align, audio, jobs, media
from ..access import (
    link_covers_track,
    require_own_track,
    require_track,
    share_link_for,
)
from ..config import get_settings
from ..db import SessionLocal, get_db
from ..models import Folder, Like, Track, User
from ..schemas import BulkAction, TrackOut, TrackPatch
from ..security import current_user, current_user_optional
from ..serializers import track_out

router = APIRouter(prefix="/api/tracks", tags=["tracks"])
settings = get_settings()

AUDIO_SUFFIXES = {
    ".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg", ".oga",
    ".opus", ".aiff", ".aif", ".wma", ".alac", ".mp4",
}
CHUNK = 256 * 1024


def _clean_title(filename: str) -> str:
    stem = Path(filename).stem
    stem = re.sub(r"[_]+", " ", stem)
    stem = re.sub(r"\s{2,}", " ", stem).strip()
    return stem[:200] or "Untitled"


@router.post("/upload", response_model=list[TrackOut])
async def upload(
    files: list[UploadFile] = File(...),
    folder_id: str | None = Form(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """Take any number of audio files. No cap on how many a Vault can hold."""
    if folder_id:
        folder = db.get(Folder, folder_id)
        if folder is None or folder.owner_id != user.id:
            raise HTTPException(404, "That album no longer exists.")

    limit = settings.max_upload_mb * 1024 * 1024
    created: list[Track] = []

    for upload_file in files:
        suffix = Path(upload_file.filename or "").suffix.lower()
        if suffix not in AUDIO_SUFFIXES:
            raise HTTPException(
                415, f"{upload_file.filename or 'That file'} is not an audio file."
            )

        stored_name = f"{uuid.uuid4().hex}{suffix}"
        dest = settings.uploads_dir / stored_name
        size = 0
        try:
            with dest.open("wb") as out:
                while chunk := await upload_file.read(CHUNK):
                    size += len(chunk)
                    if size > limit:
                        raise HTTPException(
                            413,
                            f"{upload_file.filename} is over the "
                            f"{settings.max_upload_mb} MB per-file limit.",
                        )
                    out.write(chunk)
        except HTTPException:
            dest.unlink(missing_ok=True)
            raise
        finally:
            await upload_file.close()

        duration, peaks = audio.analyse(dest)
        track = Track(
            owner_id=user.id,
            folder_id=folder_id or None,
            title=_clean_title(upload_file.filename or "Untitled"),
            stored_name=stored_name,
            original_name=(upload_file.filename or stored_name)[:260],
            mime=upload_file.content_type
            or mimetypes.guess_type(stored_name)[0]
            or "audio/mpeg",
            size_bytes=size,
            duration=duration,
            peaks=peaks,
        )
        db.add(track)
        created.append(track)

    db.commit()
    return [track_out(db, t, user) for t in created]


@router.get("", response_model=list[TrackOut])
def list_tracks(
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
    q: str = Query(default="", max_length=120),
    folder_id: str | None = None,
    tag: str | None = None,
    sort: str = Query(default="recent"),
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    query = db.query(Track).filter(Track.owner_id == user.id)

    if folder_id == "none":
        query = query.filter(Track.folder_id.is_(None))
    elif folder_id:
        query = query.filter(Track.folder_id == folder_id)

    if q.strip():
        needle = f"%{q.strip().lower()}%"
        query = query.filter(
            or_(
                func.lower(Track.title).like(needle),
                func.lower(Track.notes).like(needle),
                func.lower(Track.original_name).like(needle),
                func.lower(func.cast(Track.tags, String)).like(needle),
            )
        )

    orderings = {
        "recent": Track.created_at.desc(),
        "oldest": Track.created_at.asc(),
        "title": func.lower(Track.title).asc(),
        "longest": Track.duration.desc(),
        "plays": Track.plays.desc(),
        "updated": Track.updated_at.desc(),
    }
    query = query.order_by(orderings.get(sort, Track.created_at.desc()))

    rows = query.offset(offset).limit(limit).all()
    if tag:
        wanted = tag.lower()
        rows = [t for t in rows if any(x.lower() == wanted for x in (t.tags or []))]
    return [track_out(db, t, user) for t in rows]


@router.get("/tags", response_model=list[str])
def all_tags(db: Session = Depends(get_db), user: User = Depends(current_user)):
    seen: dict[str, int] = {}
    for (tags,) in db.query(Track.tags).filter(Track.owner_id == user.id).all():
        for tag in tags or []:
            seen[tag] = seen.get(tag, 0) + 1
    return [t for t, _ in sorted(seen.items(), key=lambda kv: (-kv[1], kv[0].lower()))]


@router.get("/{track_id}", response_model=TrackOut)
def get_track(
    track_id: str,
    t: str | None = None,
    db: Session = Depends(get_db),
    viewer: User | None = Depends(current_user_optional),
):
    track = require_track(db, track_id, viewer, t)
    return track_out(db, track, viewer, t)


@router.patch("/{track_id}", response_model=TrackOut)
def patch_track(
    track_id: str,
    body: TrackPatch,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    track = require_own_track(db, track_id, user)
    data = body.model_dump(exclude_unset=True)

    if "folder_id" in data and data["folder_id"]:
        folder = db.get(Folder, data["folder_id"])
        if folder is None or folder.owner_id != user.id:
            raise HTTPException(404, "That album no longer exists.")
    if "tags" in data and data["tags"] is not None:
        seen, cleaned = set(), []
        for raw in data["tags"][:40]:
            tag = raw.strip()[:30]
            if tag and tag.lower() not in seen:
                seen.add(tag.lower())
                cleaned.append(tag)
        data["tags"] = cleaned

    for field, value in data.items():
        setattr(track, field, value)
    db.commit()
    return track_out(db, track, user)


@router.post("/bulk", response_model=list[TrackOut])
def bulk_update(
    body: BulkAction,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    tracks = (
        db.query(Track)
        .filter(Track.owner_id == user.id, Track.id.in_(body.track_ids))
        .all()
    )
    for track in tracks:
        if body.folder_id is not None:
            track.folder_id = body.folder_id or None
        if body.visibility:
            track.visibility = body.visibility
        if body.add_tags:
            existing = {t.lower() for t in (track.tags or [])}
            track.tags = (track.tags or []) + [
                t.strip()[:30]
                for t in body.add_tags
                if t.strip() and t.strip().lower() not in existing
            ]
    db.commit()
    return [track_out(db, t, user) for t in tracks]


@router.post("/bulk/delete")
def bulk_delete(
    body: BulkAction,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    tracks = (
        db.query(Track)
        .filter(Track.owner_id == user.id, Track.id.in_(body.track_ids))
        .all()
    )
    for track in tracks:
        (settings.uploads_dir / track.stored_name).unlink(missing_ok=True)
        db.delete(track)
    db.commit()
    return {"deleted": len(tracks)}


@router.delete("/{track_id}")
def delete_track(
    track_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)
):
    track = require_own_track(db, track_id, user)
    (settings.uploads_dir / track.stored_name).unlink(missing_ok=True)
    db.delete(track)
    db.commit()
    return {"ok": True}


@router.post("/{track_id}/like")
def toggle_like(
    track_id: str,
    t: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    track = require_track(db, track_id, user, t)
    existing = (
        db.query(Like)
        .filter(Like.track_id == track.id, Like.user_id == user.id)
        .first()
    )
    if existing:
        db.delete(existing)
        liked = False
    else:
        db.add(Like(track_id=track.id, user_id=user.id))
        liked = True
    db.commit()
    count = db.query(func.count(Like.id)).filter(Like.track_id == track.id).scalar() or 0
    return {"liked": liked, "like_count": count}


@router.post("/{track_id}/play")
def count_play(
    track_id: str,
    t: str | None = None,
    db: Session = Depends(get_db),
    viewer: User | None = Depends(current_user_optional),
):
    track = require_track(db, track_id, viewer, t)
    track.plays += 1
    db.commit()
    return {"plays": track.plays}


@router.get("/{track_id}/stream")
def stream_track(
    track_id: str,
    request: Request,
    t: str | None = None,
    db: Session = Depends(get_db),
    viewer: User | None = Depends(current_user_optional),
):
    track = require_track(db, track_id, viewer, t)
    path = settings.uploads_dir / track.stored_name
    if not path.exists():
        raise HTTPException(410, "The audio for this track is missing.")
    return media.range_response(path, track.mime, request, track.original_name)


@router.get("/{track_id}/download")
def download_track(
    track_id: str,
    t: str | None = None,
    db: Session = Depends(get_db),
    viewer: User | None = Depends(current_user_optional),
):
    track = require_track(db, track_id, viewer, t)
    is_owner = viewer is not None and viewer.id == track.owner_id
    if not is_owner and not track.allow_download:
        # A share link can grant downloads for a track that otherwise withholds
        # them -- that is the point of ticking the box when creating the link.
        link = share_link_for(db, t)
        if not (link_covers_track(link, track) and link.allow_download):
            raise HTTPException(403, "Downloads are off for this track.")
    path = settings.uploads_dir / track.stored_name
    if not path.exists():
        raise HTTPException(410, "The audio for this track is missing.")
    return FileResponse(path, media_type=track.mime, filename=track.original_name)


# ---------------------------------------------------------------------------
# Automatic lyric syncing
# ---------------------------------------------------------------------------


@router.get("/{track_id}/autosync")
def autosync_status(
    track_id: str,
    job: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """Poll a running sync, or ask whether the feature is available at all."""
    require_own_track(db, track_id, user)

    running = jobs.get(job) if job else jobs.find("autosync", user.id, track_id)
    if running is None:
        return {"available": align.available(), "job": None}
    if running.owner_id != user.id or running.key != track_id:
        raise HTTPException(404, "No such job.")
    return {"available": align.available(), "job": running.public()}


@router.post("/{track_id}/autosync", status_code=202)
def start_autosync(
    track_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """Listen to the track and timestamp the lyrics already on it."""
    track = require_own_track(db, track_id, user)

    if not align.available():
        raise HTTPException(
            503,
            "Automatic syncing is not installed on this server. "
            "You can still sync by tapping along.",
        )
    if not (track.lyrics or "").strip():
        raise HTTPException(422, "Add the lyrics first, then sync them.")

    existing = jobs.find("autosync", user.id, track_id)
    if existing is not None:
        return {"job": existing.public()}

    path = settings.uploads_dir / track.stored_name
    if not path.exists():
        raise HTTPException(410, "The audio for this track is missing.")

    lyrics = track.lyrics
    duration = track.duration or 0.0

    def work(report):
        report(0.02, "Listening to the track…")

        def on_progress(fraction: float) -> None:
            # Transcription is nearly all of the wall time.
            report(0.02 + fraction * 0.93, "Listening to the track…")

        synced, confidence, lines = align.autosync(path, lyrics, duration, on_progress)
        report(0.98, "Matching up the words…")

        # The worker owns its own session; the request's is long gone.
        with SessionLocal() as session:
            fresh = session.get(Track, track_id)
            if fresh is None:
                raise RuntimeError("That track was deleted while syncing.")
            fresh.lyrics = synced
            session.commit()

        return {"lyrics": synced, "confidence": confidence, "lines": lines}

    job = jobs.submit("autosync", user.id, track_id, work)
    return {"job": job.public()}
