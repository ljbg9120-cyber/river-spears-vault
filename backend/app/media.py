"""Byte-range file serving, shared by audio and video.

Both need it for the same reason: a browser must be able to seek without
re-downloading the file, and <video> will not even start on some platforms
unless the server advertises ranges.
"""
from __future__ import annotations

import re
from pathlib import Path

from fastapi import Request, Response
from fastapi.responses import FileResponse, StreamingResponse

CHUNK = 256 * 1024
_RANGE = re.compile(r"bytes=(\d*)-(\d*)")


def range_response(
    path: Path,
    mime: str,
    request: Request,
    filename: str,
    *,
    cache: str = "private, max-age=3600",
) -> Response:
    """Serve `path`, honouring a Range header when one is present."""
    file_size = path.stat().st_size
    range_header = request.headers.get("range")
    safe_name = filename.replace('"', "")
    base_headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": cache,
        "Content-Disposition": f'inline; filename="{safe_name}"',
    }

    if not range_header:
        return FileResponse(path, media_type=mime, headers=base_headers)

    match = _RANGE.match(range_header.strip())
    if not match:
        return FileResponse(path, media_type=mime, headers=base_headers)

    raw_start, raw_end = match.groups()
    if raw_start:
        start = int(raw_start)
        end = int(raw_end) if raw_end else file_size - 1
    else:
        # Suffix form: "bytes=-500" means the final 500 bytes.
        length = int(raw_end or 0)
        start = max(0, file_size - length)
        end = file_size - 1

    if start >= file_size:
        return Response(
            status_code=416, headers={"Content-Range": f"bytes */{file_size}"}
        )
    end = min(end, file_size - 1)

    def stream():
        remaining = end - start + 1
        with path.open("rb") as fh:
            fh.seek(start)
            while remaining > 0:
                data = fh.read(min(CHUNK, remaining))
                if not data:
                    break
                remaining -= len(data)
                yield data

    return StreamingResponse(
        stream(),
        status_code=206,
        media_type=mime,
        headers={
            **base_headers,
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Content-Length": str(end - start + 1),
        },
    )
