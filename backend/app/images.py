"""Cover art handling: validate, square off, shrink, strip metadata.

Covers arrive as whatever the phone took — 12 megapixels, EXIF rotation, an
embedded location. None of that should reach the disk or a listener, so every
upload is re-encoded rather than stored as sent.
"""
from __future__ import annotations

import io
import uuid
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

# What a cover is served at. Big enough for a full-screen player on a retina
# phone, small enough that a library of them stays cheap.
COVER_SIZE = 1000
THUMB_SIZE = 320
JPEG_QUALITY = 86
MAX_SOURCE_BYTES = 25 * 1024 * 1024

ALLOWED = {"image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"}
SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".bmp", ".tif", ".tiff"}


class ImageError(ValueError):
    pass


def looks_like_image(filename: str, content_type: str | None) -> bool:
    if content_type and content_type.lower() in ALLOWED:
        return True
    return Path(filename or "").suffix.lower() in SUFFIXES


def save_cover(data: bytes, dest_dir: Path) -> str:
    """Write a square cover plus its thumbnail. Returns the stored base name."""
    if len(data) > MAX_SOURCE_BYTES:
        raise ImageError("That image is over 25 MB. Try a smaller one.")

    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except (UnidentifiedImageError, OSError) as exc:
        raise ImageError("That file is not an image Vault can read.") from exc

    # Honour EXIF rotation, then drop the EXIF entirely.
    image = ImageOps.exif_transpose(image)

    if image.mode in ("RGBA", "LA", "P"):
        # Flatten transparency onto near-black so it sits naturally in the UI.
        image = image.convert("RGBA")
        backdrop = Image.new("RGB", image.size, (11, 10, 18))
        backdrop.paste(image, mask=image.split()[-1])
        image = backdrop
    else:
        image = image.convert("RGB")

    # Covers are square everywhere they appear, so crop rather than letterbox.
    square = ImageOps.fit(image, (COVER_SIZE, COVER_SIZE), Image.LANCZOS, centering=(0.5, 0.5))
    thumb = square.resize((THUMB_SIZE, THUMB_SIZE), Image.LANCZOS)

    dest_dir.mkdir(parents=True, exist_ok=True)
    base = uuid.uuid4().hex
    square.save(dest_dir / f"{base}.jpg", "JPEG", quality=JPEG_QUALITY, optimize=True)
    thumb.save(dest_dir / f"{base}_thumb.jpg", "JPEG", quality=82, optimize=True)
    return base


def cover_paths(dest_dir: Path, base: str) -> tuple[Path, Path]:
    return dest_dir / f"{base}.jpg", dest_dir / f"{base}_thumb.jpg"


def delete_cover(dest_dir: Path, base: str | None) -> None:
    if not base:
        return
    for path in cover_paths(dest_dir, base):
        path.unlink(missing_ok=True)
