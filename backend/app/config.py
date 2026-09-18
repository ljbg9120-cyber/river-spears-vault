"""Runtime configuration, read from .env at the repo root."""
from __future__ import annotations

import secrets
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ROOT / ".env", env_prefix="VAULT_", extra="ignore"
    )

    secret_key: str = ""
    google_client_id: str = ""
    public_url: str = "http://localhost:5173"
    max_upload_mb: int = 200
    token_days: int = 30

    data_dir: Path = ROOT / "data"

    @property
    def uploads_dir(self) -> Path:
        return self.data_dir / "uploads"

    @property
    def covers_dir(self) -> Path:
        return self.data_dir / "covers"

    @property
    def videos_dir(self) -> Path:
        return self.data_dir / "videos"

    @property
    def db_url(self) -> str:
        return f"sqlite:///{(self.data_dir / 'vault.db').as_posix()}"

    @property
    def google_enabled(self) -> bool:
        return bool(self.google_client_id.strip())


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    # Some hosts (Render, for one) hand back a bare hostname with no scheme.
    # Share links and the secure-cookie decision both depend on having one.
    if s.public_url and "://" not in s.public_url:
        s.public_url = f"https://{s.public_url}"
    s.public_url = s.public_url.rstrip("/")
    s.data_dir.mkdir(parents=True, exist_ok=True)
    s.uploads_dir.mkdir(parents=True, exist_ok=True)
    s.covers_dir.mkdir(parents=True, exist_ok=True)
    s.videos_dir.mkdir(parents=True, exist_ok=True)
    if not s.secret_key or s.secret_key == "change-me-before-you-deploy":
        # Keep dev usable without a .env, but persist the key so that restarting
        # the server does not log everybody out.
        keyfile = s.data_dir / ".devkey"
        if not keyfile.exists():
            keyfile.write_text(secrets.token_urlsafe(48), encoding="utf-8")
        s.secret_key = keyfile.read_text(encoding="utf-8").strip()
    return s
