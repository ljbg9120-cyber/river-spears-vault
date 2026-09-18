"""SQLAlchemy models for Vault."""
from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _uid() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _share_token() -> str:
    return secrets.token_urlsafe(9)


# Keys the appearance editor is allowed to set. Values here are the defaults a
# brand-new account starts with.
DEFAULT_THEME: dict = {
    "background": "aurora",
    "accent": "#7c5cff",
    "accent2": "#22d3ee",
    "intensity": 0.7,
    "speed": 0.6,
    "grain": True,
    "reactive": True,
    "mode": "dark",
    # The visualizer drawn while a track plays. "off" turns it off entirely.
    "visualizer": "bars",
    "visualizer_size": 0.85,
    # Which uploaded clip plays when visualizer == "video".
    "video_id": None,
    "video_fit": "cover",
    "video_dim": 0.45,
}


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uid)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    handle: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(80))
    # Null for accounts that only ever signed in with Google.
    password_hash: Mapped[str | None] = mapped_column(String(200), default=None)
    google_sub: Mapped[str | None] = mapped_column(
        String(64), unique=True, index=True, default=None
    )
    avatar_url: Mapped[str | None] = mapped_column(String(500), default=None)
    bio: Mapped[str] = mapped_column(Text, default="")
    # Appearance: which animated background plays, accent colour, motion amount.
    # Travels with every page this user shares, so listeners see their vibe.
    theme: Mapped[dict] = mapped_column(JSON, default=lambda: dict(DEFAULT_THEME))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    tracks: Mapped[list["Track"]] = relationship(
        back_populates="owner", cascade="all, delete-orphan"
    )
    folders: Mapped[list["Folder"]] = relationship(
        back_populates="owner", cascade="all, delete-orphan"
    )


class Folder(Base):
    """A crate of tracks — an album, a beat pack, a client's batch."""

    __tablename__ = "folders"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uid)
    owner_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(120))
    accent: Mapped[str] = mapped_column(String(16), default="violet")
    # Base name of the stored cover art; the jpg and its thumb sit beside it.
    cover_name: Mapped[str | None] = mapped_column(String(64), default=None)
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    owner: Mapped[User] = relationship(back_populates="folders")
    tracks: Mapped[list["Track"]] = relationship(back_populates="folder")


class Track(Base):
    __tablename__ = "tracks"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uid)
    owner_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    folder_id: Mapped[str | None] = mapped_column(
        ForeignKey("folders.id", ondelete="SET NULL"), index=True, default=None
    )

    title: Mapped[str] = mapped_column(String(200))
    notes: Mapped[str] = mapped_column(Text, default="")
    bpm: Mapped[int | None] = mapped_column(Integer, default=None)
    song_key: Mapped[str | None] = mapped_column(String(12), default=None)

    stored_name: Mapped[str] = mapped_column(String(80))
    original_name: Mapped[str] = mapped_column(String(260))
    mime: Mapped[str] = mapped_column(String(80), default="audio/mpeg")
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    duration: Mapped[float] = mapped_column(Float, default=0.0)
    # Normalised 0..1 waveform buckets, drawn by the player.
    peaks: Mapped[list[float]] = mapped_column(JSON, default=list)
    # Free-form labels: "verse idea", "sent to mix", "keep". Searchable.
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    # Plain text, optionally with LRC-style "[mm:ss.xx] " prefixes per line.
    # Timed lines drive the scrolling lyrics view; untimed ones just display.
    lyrics: Mapped[str] = mapped_column(Text, default="")

    # private = owner only, unlisted = anyone with a share link, public = on profile
    visibility: Mapped[str] = mapped_column(String(10), default="private")
    allow_download: Mapped[bool] = mapped_column(Boolean, default=False)
    plays: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=_now, onupdate=_now
    )

    owner: Mapped[User] = relationship(back_populates="tracks")
    folder: Mapped[Folder | None] = relationship(back_populates="tracks")
    comments: Mapped[list["Comment"]] = relationship(
        back_populates="track", cascade="all, delete-orphan"
    )
    likes: Mapped[list["Like"]] = relationship(
        back_populates="track", cascade="all, delete-orphan"
    )
    shares: Mapped[list["ShareLink"]] = relationship(
        back_populates="track", cascade="all, delete-orphan"
    )


class Comment(Base):
    """Feedback pinned to a moment in the track."""

    __tablename__ = "comments"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uid)
    track_id: Mapped[str] = mapped_column(
        ForeignKey("tracks.id", ondelete="CASCADE"), index=True
    )
    # Null when a listener on a share link comments without an account.
    user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), default=None
    )
    guest_name: Mapped[str | None] = mapped_column(String(60), default=None)
    body: Mapped[str] = mapped_column(Text)
    # Seconds into the track; null for a general comment.
    at_sec: Mapped[float | None] = mapped_column(Float, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)

    track: Mapped[Track] = relationship(back_populates="comments")
    user: Mapped[User | None] = relationship()


class Like(Base):
    __tablename__ = "likes"
    __table_args__ = (UniqueConstraint("track_id", "user_id", name="uq_like"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uid)
    track_id: Mapped[str] = mapped_column(
        ForeignKey("tracks.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    track: Mapped[Track] = relationship(back_populates="likes")


class ShareLink(Base):
    """A private URL that exposes one track or one folder to listeners."""

    __tablename__ = "share_links"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uid)
    token: Mapped[str] = mapped_column(
        String(24), unique=True, index=True, default=_share_token
    )
    owner_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    track_id: Mapped[str | None] = mapped_column(
        ForeignKey("tracks.id", ondelete="CASCADE"), default=None
    )
    folder_id: Mapped[str | None] = mapped_column(
        ForeignKey("folders.id", ondelete="CASCADE"), default=None
    )
    label: Mapped[str] = mapped_column(String(120), default="")
    allow_download: Mapped[bool] = mapped_column(Boolean, default=False)
    allow_comments: Mapped[bool] = mapped_column(Boolean, default=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)
    views: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    track: Mapped[Track | None] = relationship(back_populates="shares")
    folder: Mapped[Folder | None] = relationship()


class VideoLoop(Base):
    """A clip the owner can run as their visualizer."""

    __tablename__ = "video_loops"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uid)
    owner_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(120))
    stored_name: Mapped[str] = mapped_column(String(80))
    poster_name: Mapped[str | None] = mapped_column(String(80), default=None)
    mime: Mapped[str] = mapped_column(String(60), default="video/mp4")
    duration: Mapped[float] = mapped_column(Float, default=0.0)
    width: Mapped[int] = mapped_column(Integer, default=0)
    height: Mapped[int] = mapped_column(Integer, default=0)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    # ready | processing | error -- uploads may need converting first.
    status: Mapped[str] = mapped_column(String(12), default="ready")
    error: Mapped[str | None] = mapped_column(Text, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)

    owner: Mapped[User] = relationship()


Index("ix_tracks_owner_created", Track.owner_id, Track.created_at.desc())
