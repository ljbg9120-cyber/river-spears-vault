/** Auth, appearance and playback — the three things every page needs. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api, ApiError, type Theme, type Track, type User } from "./api";

// ---------------------------------------------------------------------------
// Appearance
// ---------------------------------------------------------------------------

export const DEFAULT_THEME: Theme = {
  background: "aurora",
  accent: "#7c5cff",
  accent2: "#22d3ee",
  intensity: 0.7,
  speed: 0.6,
  grain: true,
  reactive: true,
  mode: "dark",
  visualizer: "bars",
  visualizer_size: 0.85,
  video_id: null,
  video_fit: "cover",
  video_dim: 0.45,
};

export function hexToRgb(hex: string): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return "124 92 255";
  return `${parseInt(m[1], 16)} ${parseInt(m[2], 16)} ${parseInt(m[3], 16)}`;
}

/** Push a theme into CSS custom properties. Everything else reads from there. */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.style.setProperty("--accent-rgb", hexToRgb(theme.accent));
  root.style.setProperty("--accent2-rgb", hexToRgb(theme.accent2));
  root.dataset.mode = theme.mode;
  root.style.setProperty("--motion", String(theme.speed));
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme.mode === "light" ? "#f6f5fc" : "#08070d");
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

type AuthValue = {
  user: User | null;
  loading: boolean;
  theme: Theme;
  /** Preview a theme without saving — used while dragging the editor's sliders. */
  previewTheme: (patch: Partial<Theme>) => void;
  saveTheme: (patch: Partial<Theme>) => Promise<void>;
  signup: (email: string, password: string, name: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: (credential: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  setUser: (u: User) => void;
};

const AuthCtx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [override, setOverride] = useState<Partial<Theme> | null>(null);
  // A share page paints itself in the artist's colours, not the viewer's.
  const [guestTheme, setGuestTheme] = useState<Theme | null>(null);

  const theme: Theme = useMemo(
    () => ({ ...DEFAULT_THEME, ...(guestTheme ?? user?.theme ?? {}), ...(override ?? {}) }),
    [user, override, guestTheme],
  );

  useEffect(() => applyTheme(theme), [theme]);

  const refresh = useCallback(async () => {
    try {
      setUser(await api.get<User>("/api/auth/me"));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setUser(null);
      else throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => setLoading(false));
  }, [refresh]);

  // Listen for a share page announcing whose theme should be on screen.
  useEffect(() => {
    const onGuestTheme = (e: Event) =>
      setGuestTheme((e as CustomEvent<Theme | null>).detail);
    window.addEventListener("vault:guest-theme", onGuestTheme);
    return () => window.removeEventListener("vault:guest-theme", onGuestTheme);
  }, []);

  const value: AuthValue = {
    user,
    loading,
    theme,
    setUser,
    previewTheme: (patch) => setOverride((prev) => ({ ...(prev ?? {}), ...patch })),
    saveTheme: async (patch) => {
      setOverride((prev) => ({ ...(prev ?? {}), ...patch }));
      const saved = await api.patch<Theme>("/api/me/theme", patch);
      setUser((u) => (u ? { ...u, theme: saved } : u));
      setOverride(null);
    },
    signup: async (email, password, display_name) => {
      const res = await api.post<{ user: User }>("/api/auth/signup", {
        email,
        password,
        display_name,
      });
      setUser(res.user);
    },
    login: async (email, password) => {
      const res = await api.post<{ user: User }>("/api/auth/login", {
        email,
        password,
      });
      setUser(res.user);
    },
    loginWithGoogle: async (credential) => {
      const res = await api.post<{ user: User }>("/api/auth/google", { credential });
      setUser(res.user);
    },
    logout: async () => {
      await api.post("/api/auth/logout");
      setUser(null);
    },
    refresh,
  };

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

type PlayerValue = {
  current: Track | null;
  queue: Track[];
  playing: boolean;
  time: number;
  duration: number;
  volume: number;
  shareToken?: string;
  /** Live frequency data when a reactive background is on, else null. */
  analyser: AnalyserNode | null;
  play: (track: Track, queue?: Track[], token?: string) => void;
  toggle: () => void;
  seek: (seconds: number) => void;
  next: () => void;
  prev: () => void;
  setVolume: (v: number) => void;
  audio: HTMLAudioElement | null;
};

const PlayerCtx = createContext<PlayerValue | null>(null);

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const [current, setCurrent] = useState<Track | null>(null);
  const [queue, setQueue] = useState<Track[]>([]);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [shareToken, setShareToken] = useState<string | undefined>();
  const [volume, setVolumeState] = useState(() => {
    const saved = Number(localStorage.getItem("vault:volume"));
    return Number.isFinite(saved) && saved > 0 ? saved : 0.85;
  });
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  if (!audioRef.current && typeof Audio !== "undefined") {
    const el = new Audio();
    el.preload = "metadata";
    el.crossOrigin = "use-credentials";
    audioRef.current = el;
  }

  /** Web Audio can only be started from a gesture, so this runs on first play. */
  const ensureAnalyser = useCallback(() => {
    const el = audioRef.current;
    if (!el || ctxRef.current) return;
    try {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new Ctor();
      const source = ctx.createMediaElementSource(el);
      const node = ctx.createAnalyser();
      node.fftSize = 256;
      node.smoothingTimeConstant = 0.82;
      source.connect(node);
      node.connect(ctx.destination);
      ctxRef.current = ctx;
      analyserRef.current = node;
      setAnalyser(node);
    } catch {
      // Analyser is a nice-to-have; playback still works without it.
    }
  }, []);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => setTime(el.currentTime);
    const onMeta = () => setDuration(el.duration || 0);
    const onEnd = () => nextRef.current();
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("durationchange", onMeta);
    el.addEventListener("ended", onEnd);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("durationchange", onMeta);
      el.removeEventListener("ended", onEnd);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
    };
  }, []);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
    localStorage.setItem("vault:volume", String(volume));
  }, [volume]);

  const play = useCallback(
    (track: Track, list?: Track[], token?: string) => {
      const el = audioRef.current;
      if (!el) return;
      ensureAnalyser();
      ctxRef.current?.resume().catch(() => {});
      if (list) setQueue(list);
      if (token !== undefined) setShareToken(token);

      if (current?.id === track.id) {
        el.paused ? el.play().catch(() => {}) : el.pause();
        return;
      }

      setCurrent(track);
      setTime(0);
      setDuration(track.duration || 0);
      el.src = track.stream_url;
      el.play().catch(() => {});
      const url = token ? `/api/tracks/${track.id}/play?t=${token}` : `/api/tracks/${track.id}/play`;
      api.post(url).catch(() => {});
    },
    [current, ensureAnalyser],
  );

  const step = useCallback(
    (delta: number) => {
      if (!current || queue.length === 0) return;
      const i = queue.findIndex((t) => t.id === current.id);
      const nextTrack = queue[(i + delta + queue.length) % queue.length];
      if (nextTrack) play(nextTrack, queue, shareToken);
    },
    [current, queue, play, shareToken],
  );

  // `ended` fires from a listener registered once, so it needs a live ref.
  const nextRef = useRef(() => step(1));
  useEffect(() => {
    nextRef.current = () => step(1);
  }, [step]);

  const value: PlayerValue = {
    current,
    queue,
    playing,
    time,
    duration,
    volume,
    shareToken,
    analyser,
    audio: audioRef.current,
    play,
    toggle: () => {
      const el = audioRef.current;
      if (!el || !current) return;
      ctxRef.current?.resume().catch(() => {});
      el.paused ? el.play().catch(() => {}) : el.pause();
    },
    seek: (seconds) => {
      const el = audioRef.current;
      if (!el) return;
      el.currentTime = Math.max(0, Math.min(seconds, el.duration || seconds));
      setTime(el.currentTime);
    },
    next: () => step(1),
    prev: () => {
      const el = audioRef.current;
      // Match every music player ever: restart before skipping back.
      if (el && el.currentTime > 3) {
        el.currentTime = 0;
        return;
      }
      step(-1);
    },
    setVolume: setVolumeState,
  };

  return <PlayerCtx.Provider value={value}>{children}</PlayerCtx.Provider>;
}

export function usePlayer() {
  const ctx = useContext(PlayerCtx);
  if (!ctx) throw new Error("usePlayer must be used inside PlayerProvider");
  return ctx;
}
