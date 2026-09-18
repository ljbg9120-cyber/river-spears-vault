"""Albums: unlimited crates for organising a Vault, each with its own cover."""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import images
from ..access import can_view_folder
from ..config import get_settings
from ..db import get_db
from ..models import Folder, Track, User
from ..schemas import FolderIn, FolderOut
from ..security import current_user, current_user_optional
from ..serializers import folder_out

router = APIRouter(prefix="/api/folders", tags=["folders"])
settings = get_settings()


def _counts(db: Session, owner_id: str) -> dict[str, int]:
    rows = (
        db.query(Track.folder_id, func.count(Track.id))
        .filter(Track.owner_id == owner_id, Track.folder_id.isnot(None))
        .group_by(Track.folder_id)
        .all()
    )
    return {folder_id: n for folder_id, n in rows}


def _own_folder(db: Session, folder_id: str, user: User) -> Folder:
    folder = db.get(Folder, folder_id)
    if folder is None or folder.owner_id != user.id:
        raise HTTPException(404, "That album no longer exists.")
    return folder


@router.get("", response_model=list[FolderOut])
def list_folders(db: Session = Depends(get_db), user: User = Depends(current_user)):
    folders = (
        db.query(Folder)
        .filter(Folder.owner_id == user.id)
        .order_by(Folder.position.asc(), Folder.created_at.asc())
        .all()
    )
    counts = _counts(db, user.id)
    return [folder_out(f, counts.get(f.id, 0)) for f in folders]


@router.post("", response_model=FolderOut, status_code=201)
def create_folder(
    body: FolderIn, db: Session = Depends(get_db), user: User = Depends(current_user)
):
    top = (
        db.query(func.max(Folder.position)).filter(Folder.owner_id == user.id).scalar()
    )
    folder = Folder(
        owner_id=user.id,
        name=body.name.strip(),
        accent=body.accent,
        position=(top or 0) + 1,
    )
    db.add(folder)
    db.commit()
    return folder_out(folder, 0)


@router.patch("/{folder_id}", response_model=FolderOut)
def rename_folder(
    folder_id: str,
    body: FolderIn,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    folder = _own_folder(db, folder_id, user)
    folder.name = body.name.strip()
    folder.accent = body.accent
    db.commit()
    return folder_out(folder, _counts(db, user.id).get(folder.id, 0))


# ---------------------------------------------------------------------------
# Cover art
# ---------------------------------------------------------------------------


@router.put("/{folder_id}/cover", response_model=FolderOut)
async def upload_cover(
    folder_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """Replace this album's cover. The image is re-encoded, never stored raw."""
    folder = _own_folder(db, folder_id, user)

    if not images.looks_like_image(file.filename or "", file.content_type):
        raise HTTPException(415, "Pick a JPG, PNG, WEBP or GIF.")

    data = await file.read()
    await file.close()
    if not data:
        raise HTTPException(422, "That file was empty.")

    try:
        base = images.save_cover(data, settings.covers_dir)
    except images.ImageError as exc:
        raise HTTPException(422, str(exc)) from exc

    previous = folder.cover_name
    folder.cover_name = base
    db.commit()
    # Only bin the old art once the new art is safely committed.
    images.delete_cover(settings.covers_dir, previous)

    return folder_out(folder, _counts(db, user.id).get(folder.id, 0))


@router.delete("/{folder_id}/cover", response_model=FolderOut)
def remove_cover(
    folder_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)
):
    folder = _own_folder(db, folder_id, user)
    previous = folder.cover_name
    folder.cover_name = None
    db.commit()
    images.delete_cover(settings.covers_dir, previous)
    return folder_out(folder, _counts(db, user.id).get(folder.id, 0))


@router.get("/{folder_id}/cover")
def get_cover(
    folder_id: str,
    thumb: bool = False,
    t: str | None = None,
    db: Session = Depends(get_db),
    viewer: User | None = Depends(current_user_optional),
):
    folder = db.get(Folder, folder_id)
    if folder is None or not folder.cover_name:
        raise HTTPException(404, "No cover on that album.")
    if not can_view_folder(db, folder, viewer, t):
        raise HTTPException(404, "No cover on that album.")

    full, small = images.cover_paths(settings.covers_dir, folder.cover_name)
    path = small if thumb else full
    if not path.exists():
        raise HTTPException(410, "That cover is missing from disk.")

    return FileResponse(
        path,
        media_type="image/jpeg",
        # The URL carries a version tag, so this can be cached hard.
        headers={"Cache-Control": "public, max-age=604800, immutable"},
    )


# ---------------------------------------------------------------------------


@router.post("/reorder", response_model=list[FolderOut])
def reorder(
    order: list[str], db: Session = Depends(get_db), user: User = Depends(current_user)
):
    folders = db.query(Folder).filter(Folder.owner_id == user.id).all()
    index = {fid: i for i, fid in enumerate(order)}
    for folder in folders:
        if folder.id in index:
            folder.position = index[folder.id]
    db.commit()
    counts = _counts(db, user.id)
    folders.sort(key=lambda f: f.position)
    return [folder_out(f, counts.get(f.id, 0)) for f in folders]


@router.delete("/{folder_id}")
def delete_folder(
    folder_id: str,
    keep_tracks: bool = True,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """Deleting an album never deletes the music unless explicitly asked."""
    folder = _own_folder(db, folder_id, user)

    tracks = db.query(Track).filter(Track.folder_id == folder.id).all()
    if keep_tracks:
        for track in tracks:
            track.folder_id = None
    else:
        for track in tracks:
            (settings.uploads_dir / track.stored_name).unlink(missing_ok=True)
            db.delete(track)

    images.delete_cover(settings.covers_dir, folder.cover_name)
    db.delete(folder)
    db.commit()
    return {"ok": True, "tracks_kept": keep_tracks}
