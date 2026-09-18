"""Video loops: upload a clip, run it as your visualizer."""
from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from .. import jobs, media, video
from ..config import get_settings
from ..db import SessionLocal, get_db
from ..models import User, VideoLoop
from ..schemas import VideoOut, VideoRename
from ..security import current_user, current_user_optional

router = APIRouter(prefix="/api/videos", tags=["videos"])
settings = get_settings()

CHUNK = 1024 * 1024
MAX_MB = 400


def _out(loop: VideoLoop) -> VideoOut:
    data = VideoOut.model_validate(loop, from_attributes=True)
    data.src_url = f"/api/videos/{loop.id}/file"
    data.poster_url = f"/api/videos/{loop.id}/poster" if loop.poster_name else ""
    return data


def _own(db: Session, video_id: str, user: User) -> VideoLoop:
    loop = db.get(VideoLoop, video_id)
    if loop is None or loop.owner_id != user.id:
        raise HTTPException(404, "That clip no longer exists.")
    return loop


def _delete_files(loop: VideoLoop) -> None:
    (settings.videos_dir / loop.stored_name).unlink(missing_ok=True)
    if loop.poster_name:
        (settings.videos_dir / loop.poster_name).unlink(missing_ok=True)


@router.get("", response_model=list[VideoOut])
def list_videos(db: Session = Depends(get_db), user: User = Depends(current_user)):
    loops = (
        db.query(VideoLoop)
        .filter(VideoLoop.owner_id == user.id)
        .order_by(VideoLoop.created_at.desc())
        .all()
    )
    return [_out(l) for l in loops]


@router.post("", response_model=VideoOut, status_code=201)
async def upload_video(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """Take an MP4 (or similar). Anything a browser cannot play is converted."""
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in video.ACCEPTED:
        raise HTTPException(415, "Pick an MP4, WEBM or MOV.")

    stored = f"{uuid.uuid4().hex}{suffix}"
    raw_path = settings.videos_dir / stored
    limit = MAX_MB * 1024 * 1024
    size = 0

    try:
        with raw_path.open("wb") as out:
            while chunk := await file.read(CHUNK):
                size += len(chunk)
                if size > limit:
                    raise HTTPException(413, f"Clips are capped at {MAX_MB} MB.")
                out.write(chunk)
    except HTTPException:
        raw_path.unlink(missing_ok=True)
        raise
    finally:
        await file.close()

    try:
        info = video.probe(raw_path)
    except video.VideoError as exc:
        raw_path.unlink(missing_ok=True)
        raise HTTPException(422, str(exc)) from exc

    if info.duration > video.MAX_SECONDS:
        raw_path.unlink(missing_ok=True)
        raise HTTPException(
            422, f"That clip is longer than {video.MAX_SECONDS // 60} minutes."
        )

    name = (Path(file.filename or "Clip").stem or "Clip")[:120]
    loop = VideoLoop(
        owner_id=user.id,
        name=name,
        stored_name=stored,
        mime="video/webm" if suffix == ".webm" else "video/mp4",
        duration=info.duration,
        width=info.width,
        height=info.height,
        size_bytes=size,
        status="ready",
    )

    if video.needs_transcode(raw_path, info):
        loop.status = "processing"

    db.add(loop)
    db.commit()

    poster_name = f"{Path(stored).stem}.jpg"
    if video.poster(raw_path, settings.videos_dir / poster_name):
        loop.poster_name = poster_name
        db.commit()

    if loop.status == "processing":
        _queue_conversion(loop.id, user.id, raw_path, info)

    return _out(loop)


def _queue_conversion(video_id: str, owner_id: str, raw_path: Path, info: video.Probe):
    """Convert to something every browser plays, without blocking the upload."""

    def work(report):
        report(0.05, "Converting…")
        final_name = f"{uuid.uuid4().hex}.mp4"
        final_path = settings.videos_dir / final_name

        # Web-ready video with a stray audio track only needs a remux.
        cheap = (
            raw_path.suffix.lower() in video.WEB_CONTAINERS
            and info.codec in video.WEB_CODECS
        )
        if not (cheap and video.strip_audio_fast(raw_path, final_path)):
            final_path.unlink(missing_ok=True)
            video.transcode(raw_path, final_path, lambda p: report(p, "Converting…"))

        new_info = video.probe(final_path)
        poster_name = f"{final_path.stem}.jpg"
        video.poster(final_path, settings.videos_dir / poster_name)

        with SessionLocal() as session:
            loop = session.get(VideoLoop, video_id)
            if loop is None:
                final_path.unlink(missing_ok=True)
                raise RuntimeError("That clip was deleted while converting.")
            old_stored, old_poster = loop.stored_name, loop.poster_name
            loop.stored_name = final_name
            loop.poster_name = poster_name
            loop.mime = "video/mp4"
            loop.duration = new_info.duration
            loop.width = new_info.width
            loop.height = new_info.height
            loop.size_bytes = final_path.stat().st_size
            loop.status = "ready"
            loop.error = None
            session.commit()

        (settings.videos_dir / old_stored).unlink(missing_ok=True)
        if old_poster and old_poster != poster_name:
            (settings.videos_dir / old_poster).unlink(missing_ok=True)
        return {"video_id": video_id}

    def mark_failed(exc: Exception) -> None:
        with SessionLocal() as session:
            loop = session.get(VideoLoop, video_id)
            if loop is not None:
                loop.status = "error"
                loop.error = str(exc)[:400]
                session.commit()

    def guarded(report):
        try:
            return work(report)
        except Exception as exc:
            mark_failed(exc)
            raise

    jobs.submit("video", owner_id, video_id, guarded)


@router.get("/{video_id}/job")
def conversion_status(
    video_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)
):
    loop = _own(db, video_id, user)
    job = jobs.find("video", user.id, video_id)
    return {"video": _out(loop), "job": job.public() if job else None}


@router.patch("/{video_id}", response_model=VideoOut)
def rename_video(
    video_id: str,
    body: VideoRename,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    loop = _own(db, video_id, user)
    loop.name = body.name.strip()
    db.commit()
    return _out(loop)


@router.delete("/{video_id}")
def delete_video(
    video_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)
):
    loop = _own(db, video_id, user)
    _delete_files(loop)
    db.delete(loop)

    # A theme pointing at a deleted clip would render nothing at all.
    theme = dict(user.theme or {})
    if theme.get("video_id") == video_id:
        theme["video_id"] = None
        if theme.get("visualizer") == "video":
            theme["visualizer"] = "bars"
        user.theme = theme

    db.commit()
    return {"ok": True}


@router.get("/{video_id}/poster")
def video_poster(
    video_id: str,
    db: Session = Depends(get_db),
    viewer: User | None = Depends(current_user_optional),
):
    loop = db.get(VideoLoop, video_id)
    if loop is None or not loop.poster_name:
        raise HTTPException(404, "No poster for that clip.")
    path = settings.videos_dir / loop.poster_name
    if not path.exists():
        raise HTTPException(410, "That poster is missing from disk.")
    return FileResponse(
        path,
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@router.get("/{video_id}/file")
def video_file(
    video_id: str,
    request: Request,
    db: Session = Depends(get_db),
    viewer: User | None = Depends(current_user_optional),
):
    """Served to anyone with the id: a loop carries no private audio or words.

    It is what a listener sees behind a shared track, so gating it on the
    owner's session would break every share link.
    """
    loop = db.get(VideoLoop, video_id)
    if loop is None:
        raise HTTPException(404, "That clip no longer exists.")
    path = settings.videos_dir / loop.stored_name
    if not path.exists():
        raise HTTPException(410, "That clip is missing from disk.")
    return media.range_response(
        path,
        loop.mime,
        request,
        f"{loop.name}{Path(loop.stored_name).suffix}",
        cache="public, max-age=86400",
    )
