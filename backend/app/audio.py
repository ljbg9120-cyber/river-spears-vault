"""Audio inspection: duration and the waveform the player draws.

Everything here shells out to the ffmpeg already on the machine rather than
pulling in a decoder dependency. Note that both calls use subprocess.run with
capture_output, which drains stdout and stderr together -- reading one pipe
while the other fills is how ffmpeg pipelines deadlock.
"""
from __future__ import annotations

import array
import json
import shutil
import subprocess
from pathlib import Path

PEAK_BUCKETS = 800
_SAMPLE_RATE = 8000


class AudioError(RuntimeError):
    pass


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


def probe_duration(path: Path) -> float:
    proc = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "json", str(path),
        ],
        capture_output=True,
        timeout=60,
    )
    if proc.returncode != 0:
        raise AudioError(proc.stderr.decode("utf-8", "replace")[:400])
    try:
        return float(json.loads(proc.stdout)["format"]["duration"])
    except (KeyError, ValueError, json.JSONDecodeError):
        return 0.0


def compute_peaks(path: Path, buckets: int = PEAK_BUCKETS) -> list[float]:
    """Decode to mono PCM and reduce it to `buckets` normalised 0..1 peaks."""
    proc = subprocess.run(
        [
            "ffmpeg", "-nostdin", "-v", "error",
            "-i", str(path),
            "-ac", "1", "-ar", str(_SAMPLE_RATE),
            "-f", "s16le", "-",
        ],
        capture_output=True,
        timeout=300,
    )
    if proc.returncode != 0 or not proc.stdout:
        raise AudioError(proc.stderr.decode("utf-8", "replace")[:400])

    raw = proc.stdout
    samples = array.array("h")
    samples.frombytes(raw[: len(raw) - (len(raw) % 2)])
    if not samples:
        return [0.0] * buckets

    span = max(1, len(samples) // buckets)
    peaks: list[float] = []
    for i in range(buckets):
        chunk = samples[i * span : (i + 1) * span]
        if not chunk:
            break
        peaks.append(max(abs(min(chunk)), abs(max(chunk))) / 32768.0)
    while len(peaks) < buckets:
        peaks.append(0.0)

    # Normalise against the loudest bucket so quiet demos still look like music.
    ceiling = max(peaks)
    if ceiling > 0:
        peaks = [round(p / ceiling, 4) for p in peaks]
    return peaks


def analyse(path: Path) -> tuple[float, list[float]]:
    duration = probe_duration(path)
    try:
        peaks = compute_peaks(path)
    except (AudioError, subprocess.TimeoutExpired):
        peaks = []
    return duration, peaks
