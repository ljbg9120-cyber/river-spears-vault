# Vault — one image that builds the site and serves it with the API.

# ---- stage 1: build the frontend -------------------------------------------
FROM node:22-slim AS web

WORKDIR /build
COPY frontend/package.json frontend/package-lock.json* ./
# Dev dependencies included on purpose: TypeScript and Vite build the site.
# This whole stage is discarded afterwards -- only dist/ is copied out.
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

COPY frontend/ ./
RUN npm run build


# ---- stage 2: the runtime ---------------------------------------------------
FROM python:3.11-slim

# ffmpeg is what draws the waveforms and reads track length.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY backend/requirements.txt backend/requirements-autosync.txt ./backend/
RUN pip install --no-cache-dir -r backend/requirements.txt

# Automatic lyric syncing. Build with --build-arg WITH_AUTOSYNC=0 to leave it
# out and save ~200 MB plus the model download on first use.
ARG WITH_AUTOSYNC=1
RUN if [ "$WITH_AUTOSYNC" = "1" ]; then pip install --no-cache-dir -r backend/requirements-autosync.txt; fi

COPY backend/ ./backend/
COPY --from=web /build/dist ./frontend/dist

# Uploads and the database live here. Mount a persistent volume on this path,
# or every deploy wipes the music.
ENV VAULT_DATA_DIR=/data
RUN mkdir -p /data/uploads

EXPOSE 8000

# Hosts hand the port in via $PORT; fall back to 8000 when run locally.
CMD ["sh", "-c", "cd backend && exec python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips=*"]
