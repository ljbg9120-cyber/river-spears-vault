"""River Spears and the Crews Vault — a free home for unreleased music."""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import align, audio, migrate
from .config import ROOT, get_settings
from .db import Base, engine
from .routers import auth, comments, folders, share, tracks, users, videos, workflow

settings = get_settings()

app = FastAPI(
    title="River Spears and the Crews Vault",
    description="A free, unlimited home for unreleased music.",
    version="1.0.0",
)

# The Vite dev server runs on a different port; cookies need credentials + origins.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        settings.public_url,
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(folders.router)
app.include_router(tracks.router)
app.include_router(comments.router)
app.include_router(share.router)
app.include_router(videos.router)
app.include_router(workflow.router)


@app.on_event("startup")
def startup() -> None:
    Base.metadata.create_all(bind=engine)
    # Columns added after a database already existed.
    migrate.run(engine)


@app.get("/api/health")
def health() -> dict:
    return {
        "ok": True,
        "google_enabled": settings.google_enabled,
        "ffmpeg": audio.ffmpeg_available(),
        "autosync": align.available(),
        "max_upload_mb": settings.max_upload_mb,
        # Vault is free. These are here so the client can say so out loud.
        "limits": {"tracks": None, "albums": None, "storage": None},
    }


# ---------------------------------------------------------------------------
# Serve the built frontend, when there is one. In development Vite serves it
# instead and proxies /api back here.
# ---------------------------------------------------------------------------
DIST = ROOT / "frontend" / "dist"

if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str, request: Request):
        if full_path.startswith("api/"):
            return JSONResponse({"detail": "Not found"}, status_code=404)
        candidate = DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        # index.html names the hashed bundles, so it must never be cached:
        # a stale copy pins someone to an old build for as long as their
        # browser feels like it, and they keep asking where the new thing is.
        return FileResponse(
            DIST / "index.html",
            headers={
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache",
            },
        )
else:

    @app.get("/")
    def dev_hint() -> dict:
        return {
            "message": "Vault API is running. Start the frontend with "
            "`npm run dev` in frontend/, or build it with `npm run build`.",
            "docs": "/docs",
        }
