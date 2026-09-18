"""A tiny in-process job runner for work too slow for a request.

Transcribing a song takes seconds to minutes, so auto-sync runs on a worker
thread and the client polls. Deliberately no Redis and no Celery: one process
serves this whole app, and jobs are cheap to lose — you just press the button
again.
"""
from __future__ import annotations

import logging
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Callable

log = logging.getLogger("vault.jobs")

# One at a time: the transcription model is the bottleneck and running two
# copies of it would just fight over the GPU.
_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="vault-job")
_lock = threading.Lock()
_jobs: dict[str, "Job"] = {}

KEEP_FINISHED_FOR = 15 * 60


@dataclass
class Job:
    id: str
    kind: str
    owner_id: str
    key: str                       # what this job is about, e.g. a track id
    status: str = "queued"         # queued | running | done | error
    progress: float = 0.0
    message: str = ""
    result: dict[str, Any] | None = None
    error: str | None = None
    created_at: float = field(default_factory=time.time)
    finished_at: float | None = None

    def public(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "status": self.status,
            "progress": round(self.progress, 3),
            "message": self.message,
            "result": self.result,
            "error": self.error,
        }


def _sweep() -> None:
    cutoff = time.time() - KEEP_FINISHED_FOR
    for job_id, job in list(_jobs.items()):
        if job.finished_at and job.finished_at < cutoff:
            _jobs.pop(job_id, None)


def find(kind: str, owner_id: str, key: str) -> Job | None:
    """An unfinished job for this thing, if one is already in flight."""
    with _lock:
        for job in _jobs.values():
            if (
                job.kind == kind
                and job.owner_id == owner_id
                and job.key == key
                and job.status in ("queued", "running")
            ):
                return job
    return None


def get(job_id: str) -> Job | None:
    with _lock:
        return _jobs.get(job_id)


def submit(
    kind: str,
    owner_id: str,
    key: str,
    work: Callable[[Callable[[float, str], None]], dict[str, Any]],
) -> Job:
    """Queue `work`, handing it a `report(progress, message)` callback."""
    with _lock:
        _sweep()
        job = Job(id=uuid.uuid4().hex, kind=kind, owner_id=owner_id, key=key)
        _jobs[job.id] = job

    def report(progress: float, message: str = "") -> None:
        job.progress = max(0.0, min(1.0, progress))
        if message:
            job.message = message

    def run() -> None:
        job.status = "running"
        job.message = job.message or "Starting…"
        try:
            job.result = work(report)
            job.progress = 1.0
            job.status = "done"
            job.message = "Done"
        except Exception as exc:  # noqa: BLE001 - surfaced to the client
            log.exception("job %s failed", job.id)
            job.status = "error"
            job.error = str(exc)
        finally:
            job.finished_at = time.time()

    _pool.submit(run)
    return job
