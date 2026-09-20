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
    # Playback: seconds of overlap between tracks. 0 turns it off.
    "crossfade": 0.0,
    # Skip silence at the head and tail of a track when crossfading.
    "skip_silence": True,
    # auto | high | low -- how hard the interface is allowed to work.
    "performance": "auto",
    # 0 leaves the background behind the glass; 1 pushes it forward, thins
    # the panels and lifts the vignette so it becomes the main event.
    "background_boost": 0.0,
    # Typeface for headings and the wordmark. Loaded on demand, so an
    # unused font costs nothing.
    "font": "Outfit",
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
    # From Google, when they signed in that way.
    avatar_url: Mapped[str | None] = mapped_column(String(500), default=None)
    # An uploaded avatar wins over the Google one. Animated GIFs are kept
    # animated rather than flattened, which is half the appeal.
    avatar_name: Mapped[str | None] = mapped_column(String(80), default=None)
    banner_name: Mapped[str | None] = mapped_column(String(80), default=None)
    bio: Mapped[str] = mapped_column(Text, default="")
    pronouns: Mapped[str] = mapped_column(String(40), default="")
    # [{"label": "Instagram", "url": "https://..."}], shown on the profile.
    links: Mapped[list[dict]] = mapped_column(JSON, default=list)
    # Hex colour behind the avatar and name. Empty falls back to the theme.
    profile_accent: Mapped[str] = mapped_column(String(16), default="")
    # Second colour; when set, the display name is a gradient between the two.
    profile_accent2: Mapped[str] = mapped_column(String(16), default="")
    # A track of theirs that plays when someone opens the profile.
    profile_song_id: Mapped[str | None] = mapped_column(String(32), default=None)
    # Decorative overlay: none | notes | sparkles | confetti | rain | embers
    profile_effect: Mapped[str] = mapped_column(String(16), default="none")
    # Treatment around the picture: none | ring | glow | vinyl | square
    avatar_frame: Mapped[str] = mapped_column(String(16), default="none")
    # Which part of a tall banner to show: top | center | bottom
    banner_focus: Mapped[str] = mapped_column(String(10), default="center")
    # card = contained, wide = full-bleed banner across the page
    profile_layout: Mapped[str] = mapped_column(String(10), default="card")
    # One line under the name, like "working on the album".
    status_text: Mapped[str] = mapped_column(String(80), default="")
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

    @property
    def avatar_src(self) -> str | None:
        """An uploaded picture beats the one Google supplied."""
        if self.avatar_name:
            return f"/api/u/{self.handle}/avatar?v={self.avatar_name[:8]}"
        return self.avatar_url

    @property
    def banner_src(self) -> str:
        if self.banner_name:
            return f"/api/u/{self.handle}/banner?v={self.banner_name[:8]}"
        return ""


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
    showcased: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
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
    status: Mapped[str] = mapped_column(String(16), default="demo")
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    # A stable family key, deliberately not a cascading foreign key: removing an
    # old version must never remove the newer audio or its feedback.
    version_root_id: Mapped[str | None] = mapped_column(String(32), default=None)
    version_number: Mapped[int] = mapped_column(Integer, default=1)
    revision_note: Mapped[str] = mapped_column(Text, default="")

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
    # Listed on the public showcase, where anyone signed in can rate it.
    showcased: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
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
    resolved: Mapped[bool] = mapped_column(Boolean, default=False)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)
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


class LibraryView(Base):
    """An owner's named, validated library filters, available on every device."""

    __tablename__ = "library_views"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uid)
    owner_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(80))
    filters: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class Follow(Base):
    """One person following another. Nobody follows themselves."""

    __tablename__ = "follows"
    __table_args__ = (
        UniqueConstraint("follower_id", "following_id", name="uq_follow"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uid)
    follower_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    following_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class Rating(Base):
    """One person's score for one track or album. Changing it overwrites."""

    __tablename__ = "ratings"
    __table_args__ = (
        UniqueConstraint("user_id", "track_id", name="uq_rating_track"),
        UniqueConstraint("user_id", "folder_id", name="uq_rating_folder"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uid)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    track_id: Mapped[str | None] = mapped_column(
        ForeignKey("tracks.id", ondelete="CASCADE"), index=True, default=None
    )
    folder_id: Mapped[str | None] = mapped_column(
        ForeignKey("folders.id", ondelete="CASCADE"), index=True, default=None
    )
    stars: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


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
