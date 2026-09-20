/** Thin fetch wrapper. Cookies carry the session; errors come back readable. */

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  path: string,
  options: RequestInit & { raw?: boolean } = {},
): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    ...options,
    headers: {
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      if (typeof data.detail === "string") detail = data.detail;
      else if (Array.isArray(data.detail) && data.detail[0]?.msg)
        detail = data.detail[0].msg;
    } catch {
      /* non-JSON error body: keep the status text */
    }
    throw new ApiError(res.status, detail);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T,>(path: string) => request<T>(path),
  post: <T,>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "POST",
      body: body instanceof FormData ? body : JSON.stringify(body ?? {}),
    }),
  put: <T,>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "PUT",
      body: body instanceof FormData ? body : JSON.stringify(body ?? {}),
    }),
  patch: <T,>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  del: <T,>(path: string) => request<T>(path, { method: "DELETE" }),
};

// --- shapes mirrored from the API -----------------------------------------

export type Theme = {
  background: string;
  accent: string;
  accent2: string;
  intensity: number;
  speed: number;
  grain: boolean;
  reactive: boolean;
  mode: "dark" | "light";
  visualizer: string;
  visualizer_size: number;
  /** Which uploaded clip plays when visualizer is "video". */
  video_id: string | null;
  video_fit: "cover" | "contain";
  video_dim: number;
  /** Seconds of overlap between tracks; 0 is off. */
  crossfade: number;
  skip_silence: boolean;
  performance: "auto" | "high" | "low";
  /** 0 keeps the background behind the glass, 1 brings it forward. */
  background_boost: number;
  /** Typeface for headings and the wordmark. */
  font: string;
};

export type Badge = { id: string; label: string; hint: string };
export type ProfileLink = { label: string; url: string };

export type User = {
  id: string;
  email: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  banner_url: string;
  bio: string;
  pronouns: string;
  links: ProfileLink[];
  profile_accent: string;
  theme: Theme;
  created_at: string;
};

export type PublicUser = Omit<User, "email" | "created_at"> & {
  badges: Badge[];
};

export type FollowState = { following: boolean; followers: number; follows: number };

export type TrackStatus = "demo" | "in_progress" | "in_review" | "approved";

export const TRACK_STATUSES: { value: TrackStatus; label: string }[] = [
  { value: "demo", label: "Demo" },
  { value: "in_progress", label: "In progress" },
  { value: "in_review", label: "In review" },
  { value: "approved", label: "Approved" },
];

export type Track = {
  id: string;
  title: string;
  notes: string;
  bpm: number | null;
  song_key: string | null;
  duration: number;
  peaks: number[];
  tags: string[];
  lyrics: string;
  visibility: "private" | "unlisted" | "public";
  allow_download: boolean;
  plays: number;
  folder_id: string | null;
  size_bytes: number;
  original_name: string;
  created_at: string;
  updated_at: string;
  owner: PublicUser;
  comment_count: number;
  like_count: number;
  liked_by_me: boolean;
  status: TrackStatus;
  is_favorite: boolean;
  unresolved_comment_count: number;
  version_root_id: string | null;
  version_number: number;
  revision_note: string;
  stream_url: string;
  /** Inherited from the track's album, empty when there is none. */
  cover_url: string;
};

export type Folder = {
  id: string;
  name: string;
  accent: string;
  /** Empty when the album has no art. */
  cover_url: string;
  has_cover: boolean;
  position: number;
  track_count: number;
  created_at: string;
};

export type Comment = {
  id: string;
  body: string;
  at_sec: number | null;
  created_at: string;
  author_name: string;
  author_handle: string | null;
  author_avatar: string | null;
  is_owner: boolean;
  resolved: boolean;
  resolved_at: string | null;
};

export type FeedbackItem = Comment & {
  track_id: string;
  track_title: string;
  track_cover_url: string;
  version_number: number;
  track_status: TrackStatus;
};

export type ShareLink = {
  id: string;
  token: string;
  url: string;
  label: string;
  allow_download: boolean;
  allow_comments: boolean;
  expires_at: string | null;
  views: number;
  track_id: string | null;
  folder_id: string | null;
  created_at: string;
};

export type VideoLoop = {
  id: string;
  name: string;
  duration: number;
  width: number;
  height: number;
  size_bytes: number;
  /** ready | processing | error */
  status: string;
  error: string | null;
  created_at: string;
  src_url: string;
  poster_url: string;
};

export type ShowcaseItem = {
  kind: "track" | "album";
  id: string;
  title: string;
  cover_url: string;
  owner: PublicUser;
  created_at: string;
  rating_avg: number;
  rating_count: number;
  /** Your own score, if you have given one. */
  my_rating: number | null;
  duration: number;
  stream_url: string;
  track_count: number;
  tags: string[];
};

export type SharePayload = {
  kind: "track" | "album";
  title: string;
  cover_url: string;
  label: string;
  allow_download: boolean;
  allow_comments: boolean;
  owner: PublicUser;
  tracks: Track[];
};

// --- helpers ---------------------------------------------------------------

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * The API stores UTC but serialises without an offset, which a browser would
 * otherwise read as local time — and "5 minutes ago" becomes "in 4 hours".
 */
export function parseUtc(iso: string): Date {
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(iso);
  return new Date(hasZone ? iso : `${iso}Z`);
}

export function formatDate(iso: string): string {
  const d = parseUtc(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
