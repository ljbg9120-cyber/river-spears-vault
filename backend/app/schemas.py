"""Request and response shapes for the API."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

TrackStatus = Literal["demo", "in_progress", "in_review", "approved"]
TrackSort = Literal["recent", "oldest", "title", "longest", "plays", "updated"]


class OutputModel(BaseModel):
    @field_validator("*", mode="after")
    @classmethod
    def _utc_dates(cls, value):
        # SQLite drops timezone information. Every stored date is UTC, and
        # returning the offset consistently prevents browsers shifting it.
        if isinstance(value, datetime) and value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value


class SignUpIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)
    display_name: str = Field(min_length=1, max_length=80)

    @field_validator("display_name")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Pick a name people will recognise.")
        return v


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class GoogleIn(BaseModel):
    credential: str


class UserOut(OutputModel):
    id: str
    email: str
    handle: str
    display_name: str
    avatar_url: str | None = None
    bio: str = ""
    theme: dict = {}
    created_at: datetime

    class Config:
        from_attributes = True


class PublicUser(BaseModel):
    id: str
    handle: str
    display_name: str
    avatar_url: str | None = None
    bio: str = ""
    theme: dict = {}

    class Config:
        from_attributes = True


class AuthOut(BaseModel):
    user: UserOut
    token: str


class FolderIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    accent: str = "violet"


class FolderOut(OutputModel):
    id: str
    name: str
    accent: str
    # Empty when the album has no art; the client falls back to a gradient.
    cover_url: str = ""
    has_cover: bool = False
    position: int
    track_count: int = 0
    created_at: datetime

    class Config:
        from_attributes = True


class TrackPatch(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    notes: str | None = None
    bpm: int | None = Field(default=None, ge=20, le=400)
    song_key: str | None = Field(default=None, max_length=12)
    folder_id: str | None = None
    tags: list[str] | None = None
    lyrics: str | None = Field(default=None, max_length=20000)
    visibility: str | None = None
    allow_download: bool | None = None
    status: TrackStatus | None = None
    is_favorite: bool | None = None

    @field_validator("title", "notes", "lyrics", "visibility", "allow_download", "status", "is_favorite")
    @classmethod
    def _not_null(cls, v):
        if v is None:
            raise ValueError("This field cannot be null")
        return v

    @field_validator("visibility")
    @classmethod
    def _vis(cls, v: str | None) -> str | None:
        if v is not None and v not in {"private", "unlisted", "public"}:
            raise ValueError("visibility must be private, unlisted or public")
        return v


class TrackOut(OutputModel):
    id: str
    title: str
    notes: str = ""
    bpm: int | None = None
    song_key: str | None = None
    duration: float
    peaks: list[float] = []
    tags: list[str] = []
    lyrics: str = ""
    visibility: str
    allow_download: bool
    plays: int
    folder_id: str | None = None
    size_bytes: int
    original_name: str
    created_at: datetime
    updated_at: datetime
    owner: PublicUser
    comment_count: int = 0
    like_count: int = 0
    liked_by_me: bool = False
    stream_url: str = ""
    # Inherited from the album, so a track shows its cover everywhere.
    cover_url: str = ""
    status: TrackStatus = "demo"
    is_favorite: bool = False
    unresolved_comment_count: int = 0
    version_root_id: str | None = None
    version_number: int = 1
    revision_note: str = ""

    class Config:
        from_attributes = True


class CommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=2000)
    at_sec: float | None = Field(default=None, ge=0)
    guest_name: str | None = Field(default=None, max_length=60)

    @field_validator("body")
    @classmethod
    def _body(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Write a comment first.")
        return v.strip()


class CommentOut(OutputModel):
    id: str
    body: str
    at_sec: float | None = None
    created_at: datetime
    author_name: str
    author_handle: str | None = None
    author_avatar: str | None = None
    is_owner: bool = False
    resolved: bool = False
    resolved_at: datetime | None = None


class CommentPatch(BaseModel):
    resolved: bool


class FeedbackOut(CommentOut):
    track_id: str
    track_title: str
    track_cover_url: str = ""
    version_number: int = 1
    track_status: TrackStatus = "demo"


class LibraryFilters(BaseModel):
    model_config = ConfigDict(extra="forbid")

    q: str = Field(default="", max_length=120)
    folder_id: str | None = Field(default=None, max_length=40)
    tag: str | None = Field(default=None, max_length=30)
    sort: TrackSort = "recent"
    status: TrackStatus | None = None
    favorite: bool | None = None
    latest_only: bool = True


class LibraryViewIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    filters: LibraryFilters

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Give this view a name.")
        return v.strip()


class LibraryViewPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    filters: LibraryFilters | None = None

    @field_validator("name", "filters")
    @classmethod
    def _present(cls, v):
        if v is None or isinstance(v, str) and not v.strip():
            raise ValueError("This field cannot be empty.")
        return v.strip() if isinstance(v, str) else v


class LibraryViewOut(OutputModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    filters: LibraryFilters
    created_at: datetime
    updated_at: datetime


class ShareIn(BaseModel):
    track_id: str | None = None
    folder_id: str | None = None
    label: str = ""
    allow_download: bool = False
    allow_comments: bool = True
    expires_in_days: int | None = Field(default=None, ge=1, le=365)


class ShareOut(OutputModel):
    id: str
    token: str
    # Filled in by the router, which knows the public base URL.
    url: str = ""
    label: str
    allow_download: bool
    allow_comments: bool
    expires_at: datetime | None = None
    views: int
    track_id: str | None = None
    folder_id: str | None = None
    created_at: datetime

    class Config:
        from_attributes = True


class ProfilePatch(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=80)
    bio: str | None = Field(default=None, max_length=500)
    handle: str | None = Field(default=None, min_length=2, max_length=24)


class ThemePatch(BaseModel):
    """Appearance settings. Every field is optional so the editor can PATCH one."""

    background: str | None = None
    accent: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    accent2: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    intensity: float | None = Field(default=None, ge=0, le=1)
    speed: float | None = Field(default=None, ge=0, le=1)
    grain: bool | None = None
    reactive: bool | None = None
    visualizer: str | None = None
    visualizer_size: float | None = Field(default=None, ge=0, le=1)
    video_id: str | None = None
    video_fit: str | None = None
    video_dim: float | None = Field(default=None, ge=0, le=1)
    crossfade: float | None = Field(default=None, ge=0, le=12)
    skip_silence: bool | None = None
    performance: str | None = None
    background_boost: float | None = Field(default=None, ge=0, le=1)
    mode: str | None = None

    @field_validator("mode")
    @classmethod
    def _mode(cls, v: str | None) -> str | None:
        if v is not None and v not in {"dark", "light"}:
            raise ValueError("mode must be dark or light")
        return v

    @field_validator("performance")
    @classmethod
    def _performance(cls, v: str | None) -> str | None:
        if v is not None and v not in {"auto", "high", "low"}:
            raise ValueError("performance must be auto, high or low")
        return v


class BulkAction(BaseModel):
    """Move or delete many tracks at once from the library's selection mode."""

    track_ids: list[str] = Field(min_length=1, max_length=500)
    folder_id: str | None = None
    add_tags: list[str] | None = None
    visibility: Literal["private", "unlisted", "public"] | None = None
    status: TrackStatus | None = None
    is_favorite: bool | None = None


class VideoOut(OutputModel):
    id: str
    name: str
    duration: float
    width: int
    height: int
    size_bytes: int
    status: str
    error: str | None = None
    created_at: datetime
    src_url: str = ""
    poster_url: str = ""

    class Config:
        from_attributes = True


class VideoRename(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class RateIn(BaseModel):
    stars: int = Field(ge=1, le=5)


class ShowcaseItem(BaseModel):
    """A track or album published to the public showcase."""

    kind: str                       # "track" or "album"
    id: str
    title: str
    cover_url: str = ""
    owner: PublicUser
    created_at: datetime
    rating_avg: float = 0.0
    rating_count: int = 0
    my_rating: int | None = None
    # Tracks carry playback; albums carry a count.
    duration: float = 0.0
    stream_url: str = ""
    track_count: int = 0
    tags: list[str] = []
