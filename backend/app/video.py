"""Video loops used as visualizers.

A browser will only play what its codecs understand, so every upload is probed
first. Anything already web-safe is kept byte-for-byte; anything else is
transcoded to H.264/MP4 in the background. Audio is always stripped — these
play behind music.
"""
from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

# Containers a browser will actually open.
WEB_CONTAINERS = {".mp4", ".m4v", ".webm"}
# Video codecs every current browser decodes.
WEB_CODECS = {"h264", "vp8", "vp9", "av1"}
# Accepted for upload; anything outside WEB_* gets converted.
ACCEPTED = WEB_CONTAINERS | {".mov", ".mkv", ".avi", ".webm"}

MAX_SECONDS = 15 * 60


class VideoError(RuntimeError):
    pass


@dataclass
class Probe:
    duration: float
    width: int
    height: int
    codec: str
    has_audio: bool


def probe(path: Path) -> Probe:
    proc = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "stream=codec_name,codec_type,width,height",
            "-show_entries", "format=duration",
            "-of", "json", str(path),
        ],
        capture_output=True,
        timeout=120,
    )
    if proc.returncode != 0:
        raise VideoError("That file is not a video Vault can read.")

    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise VideoError("That file is not a video Vault can read.") from exc

    streams = data.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    if video is None:
        raise VideoError("That file has no video in it.")

    try:
        duration = float(data.get("format", {}).get("duration", 0.0))
    except (TypeError, ValueError):
        duration = 0.0

    return Probe(
        duration=duration,
        width=int(video.get("width") or 0),
        height=int(video.get("height") or 0),
        codec=(video.get("codec_name") or "").lower(),
        has_audio=any(s.get("codec_type") == "audio" for s in streams),
    )


def needs_transcode(path: Path, info: Probe) -> bool:
    if path.suffix.lower() not in WEB_CONTAINERS:
        return True
    if info.codec not in WEB_CODECS:
        return True
    # A loop playing behind lyrics does not need a soundtrack fighting the song.
    return info.has_audio


def transcode(src: Path, dest: Path, on_progress=None) -> None:
    """Re-encode to silent H.264/MP4, capped at 1080p on the long edge."""
    cmd = [
        "ffmpeg", "-nostdin", "-v", "error", "-y",
        "-i", str(src),
        "-an",                                  # drop audio entirely
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "24",
        "-pix_fmt", "yuv420p",                  # Safari refuses anything else
        "-vf", "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease,"
               "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        "-movflags", "+faststart",              # start playing before it lands
        str(dest),
    ]
    if on_progress:
        on_progress(0.15)
    proc = subprocess.run(cmd, capture_output=True, timeout=60 * 60)
    if proc.returncode != 0 or not dest.exists():
        detail = proc.stderr.decode("utf-8", "replace")[:300]
        raise VideoError(f"Could not convert that video: {detail}")
    if on_progress:
        on_progress(0.95)


def strip_audio_fast(src: Path, dest: Path) -> bool:
    """Drop the audio track without re-encoding the video. Cheap and lossless."""
    proc = subprocess.run(
        [
            "ffmpeg", "-nostdin", "-v", "error", "-y",
            "-i", str(src), "-an", "-c:v", "copy",
            "-movflags", "+faststart", str(dest),
        ],
        capture_output=True,
        timeout=15 * 60,
    )
    return proc.returncode == 0 and dest.exists()


def poster(path: Path, dest: Path, at: float = 1.0) -> bool:
    """Grab a frame for the picker grid."""
    proc = subprocess.run(
        [
            "ffmpeg", "-nostdin", "-v", "error", "-y",
            "-ss", str(max(0.0, at)), "-i", str(path),
            "-frames:v", "1",
            "-vf", "scale=480:-2",
            "-q:v", "4",
            str(dest),
        ],
        capture_output=True,
        timeout=120,
    )
    if proc.returncode == 0 and dest.exists():
        return True
    # Very short clips can have nothing at the seek point; retry from the top.
    proc = subprocess.run(
        [
            "ffmpeg", "-nostdin", "-v", "error", "-y",
            "-i", str(path), "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4",
            str(dest),
        ],
        capture_output=True,
        timeout=120,
    )
    return proc.returncode == 0 and dest.exists()
