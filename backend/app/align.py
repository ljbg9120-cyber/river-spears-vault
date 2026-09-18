"""Automatic lyric syncing.

Given a track and the words the artist typed, work out when each line lands.

The approach is forced alignment by proxy: transcribe the audio with word-level
timestamps, then align that (often wrong) transcript against the (correct)
lyrics with a sequence matcher. Singing confuses speech recognition constantly,
but it rarely mishears a *whole line*, so enough anchor words match to place
every line — and unmatched lines get interpolated between their neighbours.

faster-whisper is optional. Without it the API says so plainly and the manual
tap-sync still works.
"""
from __future__ import annotations

import logging
import re
import threading
import unicodedata
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path

log = logging.getLogger("vault.align")

MODEL_SIZE = "small"
_model = None
_model_device = "none"
_model_lock = threading.Lock()


class AlignError(RuntimeError):
    pass


def available() -> bool:
    try:
        import faster_whisper  # noqa: F401
    except ImportError:
        return False
    return True


@dataclass
class Word:
    text: str
    start: float
    end: float


def _load_model():
    """Load once, preferring the GPU but surviving a broken CUDA stack.

    CUDA can be present while cuBLAS is missing: the model constructs happily
    and then dies on the first decode, so the fallback cannot live here alone —
    `transcribe` retries on CPU too.
    """
    global _model, _model_device
    if _model is not None:
        return _model

    with _model_lock:
        if _model is not None:
            return _model
        try:
            from faster_whisper import WhisperModel
        except ImportError as exc:  # pragma: no cover - env dependent
            raise AlignError(
                "Automatic syncing needs faster-whisper installed on the server."
            ) from exc

        try:
            _model = WhisperModel(MODEL_SIZE, device="cuda", compute_type="float16")
            _model_device = "cuda"
            log.info("whisper %s loaded on cuda", MODEL_SIZE)
        except Exception as exc:
            log.info("cuda unavailable (%s); using cpu", exc)
            _model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8")
            _model_device = "cpu"
    return _model


def _reset_to_cpu():
    global _model, _model_device
    from faster_whisper import WhisperModel

    with _model_lock:
        _model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8")
        _model_device = "cpu"
    log.warning("fell back to cpu whisper after a gpu decode failure")


def transcribe_words(path: Path, on_progress=None) -> list[Word]:
    """Every word the model hears, with timings."""
    model = _load_model()

    def run(m):
        segments, info = m.transcribe(
            str(path),
            word_timestamps=True,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 400},
            beam_size=5,
            condition_on_previous_text=False,
        )
        words: list[Word] = []
        total = max(info.duration or 0.0, 0.001)
        for segment in segments:
            for w in segment.words or []:
                words.append(Word(w.word.strip(), float(w.start), float(w.end)))
            if on_progress:
                on_progress(min(0.95, float(segment.end) / total))
        return words

    try:
        return run(model)
    except Exception as exc:
        if _model_device != "cuda":
            raise AlignError(f"Could not listen to that track: {exc}") from exc
        # The documented CUDA-without-cuBLAS case: retry once on CPU.
        _reset_to_cpu()
        try:
            return run(_load_model())
        except Exception as exc2:
            raise AlignError(f"Could not listen to that track: {exc2}") from exc2


_PUNCT = re.compile(r"[^\w\s']", re.UNICODE)


def normalise(text: str) -> list[str]:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    text = _PUNCT.sub(" ", text.lower())
    # "walkin'" and "walking" should not be strangers to each other.
    return [w.rstrip("'") for w in text.split() if w.strip("'")]


def align(
    lyric_lines: list[str], heard: list[Word], duration: float
) -> tuple[list[float | None], float]:
    """Return a start time per lyric line, and how much of it was really matched.

    Times are None only when a line genuinely could not be placed, which the
    caller then fills by interpolation.
    """
    # Flatten the lyrics into words, remembering which line each came from.
    lyric_words: list[str] = []
    owner: list[int] = []
    for index, line in enumerate(lyric_lines):
        for word in normalise(line):
            lyric_words.append(word)
            owner.append(index)

    heard_words = [normalise(w.text) for w in heard]
    flat_heard: list[str] = []
    flat_times: list[float] = []
    for words, w in zip(heard_words, heard):
        for piece in words:
            flat_heard.append(piece)
            flat_times.append(w.start)

    if not lyric_words or not flat_heard:
        return [None] * len(lyric_lines), 0.0

    matcher = SequenceMatcher(None, lyric_words, flat_heard, autojunk=False)
    earliest: dict[int, float] = {}
    matched_words = 0

    for block in matcher.get_matching_blocks():
        for k in range(block.size):
            line = owner[block.a + k]
            when = flat_times[block.b + k]
            matched_words += 1
            if line not in earliest or when < earliest[line]:
                earliest[line] = when

    times: list[float | None] = [earliest.get(i) for i in range(len(lyric_lines))]

    # A line that matched later than a line below it is noise, not a timing.
    last = -1.0
    for i, value in enumerate(times):
        if value is None:
            continue
        if value < last:
            times[i] = None
        else:
            last = value

    singable = sum(1 for line in lyric_lines if normalise(line))
    confidence = (
        sum(1 for i, v in enumerate(times) if v is not None and normalise(lyric_lines[i]))
        / singable
        if singable
        else 0.0
    )
    return times, confidence


def fill_gaps(times: list[float | None], duration: float) -> list[float]:
    """Spread unplaced lines evenly between the ones that were placed."""
    filled = list(times)
    known = [i for i, v in enumerate(filled) if v is not None]

    if not known:
        # Nothing matched at all: lay the lines out across the track.
        step = duration / max(1, len(filled))
        return [round(i * step, 2) for i in range(len(filled))]

    # Before the first anchor.
    first = known[0]
    if first > 0:
        head = filled[first] or 0.0
        step = head / (first + 1)
        for i in range(first):
            filled[i] = round(step * i, 2)

    # Between anchors.
    for a, b in zip(known, known[1:]):
        if b - a <= 1:
            continue
        start, end = filled[a] or 0.0, filled[b] or duration
        step = (end - start) / (b - a)
        for k in range(1, b - a):
            filled[a + k] = round(start + step * k, 2)

    # After the last anchor.
    last = known[-1]
    if last < len(filled) - 1:
        start = filled[last] or 0.0
        remaining = len(filled) - 1 - last
        step = max(1.2, (duration - start) / (remaining + 1))
        for k in range(1, remaining + 1):
            filled[last + k] = round(min(duration, start + step * k), 2)

    out = [float(v if v is not None else 0.0) for v in filled]
    # Never let a line start before the one above it.
    for i in range(1, len(out)):
        if out[i] < out[i - 1]:
            out[i] = round(out[i - 1] + 0.4, 2)
    return out


def autosync(
    path: Path, lyrics: str, duration: float, on_progress=None
) -> tuple[str, float, int]:
    """Timestamp `lyrics` against the audio. Returns (lrc, confidence, lines)."""
    raw_lines = lyrics.replace("\r\n", "\n").split("\n")
    # Strip any timings already there; we are recomputing them.
    stripped = [re.sub(r"^\s*\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]\s?", "", l) for l in raw_lines]

    singable_idx = [i for i, l in enumerate(stripped) if normalise(l)]
    if not singable_idx:
        raise AlignError("There are no words to sync yet.")

    heard = transcribe_words(path, on_progress)
    if on_progress:
        on_progress(0.97)

    subset = [stripped[i] for i in singable_idx]
    times, confidence = align(subset, heard, duration)
    filled = fill_gaps(times, duration)

    out: list[str] = []
    placed = dict(zip(singable_idx, filled))
    for i, line in enumerate(stripped):
        if i in placed:
            t = placed[i]
            m, s = divmod(t, 60)
            out.append(f"[{int(m):02d}:{s:05.2f}] {line.strip()}")
        else:
            out.append(line.strip())

    return "\n".join(out), round(confidence, 3), len(singable_idx)
