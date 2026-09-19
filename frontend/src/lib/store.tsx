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
import { setPerfSetting } from "./perf";

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
  crossfade: 0,
  skip_silence: true,
  performance: "auto",
  background_boost: 0,
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
  // Drawing effort follows the saved preference; "auto" measures instead.
  setPerfSetting(theme.performance ?? "auto");

  // Making the background "stand out" is mostly a matter of getting the glass
  // out of its way: thinner panels and a lighter vignette let it through.
  const boost = Math.max(0, Math.min(1, theme.background_boost ?? 0));
  root.style.setProperty("--bg-boost", String(boost));
  const light = theme.mode === "light";
  const base = light ? 0.66 : 0.045;
  const strong = light ? 0.85 : 0.075;
  const tint = light ? "255, 255, 255" : "255, 255, 255";
  root.style.setProperty("--panel", `rgba(${tint}, ${(base * (1 - boost * 0.75)).toFixed(3)})`);
  root.style.setProperty(
    "--panel-strong",
    `rgba(${tint}, ${(strong * (1 - boost * 0.6)).toFixed(3)})`,
  );
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
      window.dispatchEvent(new Event("vault:logout"));
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

type QueueEntry = { track: Track; token?: string };
type PlayerValue = {
  current: Track | null;
  /** Session playback order, including the current track and played history. */
  queue: Track[];
  queueIndex: number;
  playing: boolean;
  loading: boolean;
  error: string | null;
  time: number;
  duration: number;
  volume: number;
  shareToken?: string;
  analyser: AnalyserNode | null;
  play: (track: Track, queue?: Track[], token?: string) => void;
  playAt: (track: Track, seconds: number, queue?: Track[], token?: string) => void;
  addToQueue: (track: Track | Track[], token?: string) => void;
  playNext: (track: Track, token?: string) => void;
  playQueued: (index: number) => void;
  removeFromQueue: (index: number) => void;
  moveInQueue: (fromIndex: number, toIndex: number) => void;
  clearQueue: () => void;
  dismissError: () => void;
  retryPlayback: () => void;
  toggle: () => void;
  seek: (seconds: number) => void;
  next: () => void;
  prev: () => void;
  setVolume: (v: number) => void;
  audio: HTMLAudioElement | null;
  /** True while two tracks are overlapping. */
  crossfading: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  speed: number;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setSpeed: (rate: number) => void;
};

export type RepeatMode = "off" | "all" | "one";
const SPEEDS = [0.75, 0.9, 1, 1.1, 1.25, 1.5] as const;
export const PLAYBACK_SPEEDS = SPEEDS;

const PlayerCtx = createContext<PlayerValue | null>(null);

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  // PlayerProvider always sits inside AuthProvider, but read the context
  // directly so it degrades to defaults rather than throwing if that changes.
  const auth = useContext(AuthCtx);
  const themeCrossfade = auth?.theme.crossfade ?? 0;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // The second deck exists so one track can fade out while the next fades in.
  // Whichever deck is playing becomes `audioRef.current`, so every call site
  // below keeps working without knowing there are two.
  const spareRef = useRef<HTMLAudioElement | null>(null);
  const gainsRef = useRef<WeakMap<HTMLAudioElement, GainNode>>(new WeakMap());
  const fadeRef = useRef<{ raf: number; to: HTMLAudioElement } | null>(null);
  const crossfadeRef = useRef(0);
  // startEntry is defined before the fade helpers, so it reaches them by ref.
  const cancelCrossfadeRef = useRef<() => void>(() => {});
  const maybeCrossfadeRef = useRef<(el: HTMLAudioElement) => void>(() => {});
  const upcomingIndexRef = useRef<() => number>(() => -1);
  const ctxRef = useRef<AudioContext | null>(null);
  const currentRef = useRef<Track | null>(null);
  const entriesRef = useRef<QueueEntry[]>([]);
  const indexRef = useRef(-1);
  const tokenRef = useRef<string | undefined>();
  const pendingSeekRef = useRef<number | null>(null);
  const playRequestRef = useRef(0);
  const nextRef = useRef<() => void>(() => {});

  const [current, setCurrent] = useState<Track | null>(null);
  const [queue, setQueue] = useState<Track[]>([]);
  const [queueIndex, setQueueIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [shareToken, setShareToken] = useState<string | undefined>();
  const [volume, setVolumeState] = useState(() => {
    try {
      const raw = localStorage.getItem("vault:volume");
      const saved = raw === null ? NaN : Number(raw);
      return Number.isFinite(saved) ? Math.max(0, Math.min(1, saved)) : 0.85;
    } catch { return 0.85; }
  });
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [crossfading, setCrossfading] = useState(false);
  crossfadeRef.current = themeCrossfade;
  const [shuffle, setShuffle] = useState(() => {
    try { return localStorage.getItem("vault:shuffle") === "1"; } catch { return false; }
  });
  const [repeat, setRepeat] = useState<RepeatMode>(() => {
    try {
      const saved = localStorage.getItem("vault:repeat");
      return saved === "all" || saved === "one" ? saved : "off";
    } catch { return "off"; }
  });
  const [speed, setSpeedState] = useState(() => {
    try {
      const saved = Number(localStorage.getItem("vault:speed"));
      return SPEEDS.includes(saved as typeof SPEEDS[number]) ? saved : 1;
    } catch { return 1; }
  });
  const shuffleRef = useRef(shuffle);
  const repeatRef = useRef<RepeatMode>(repeat);
  shuffleRef.current = shuffle;
  repeatRef.current = repeat;

  if (!audioRef.current && typeof Audio !== "undefined") {
    const make = () => {
      const el = new Audio();
      el.preload = "metadata";
      el.crossOrigin = "use-credentials";
      return el;
    };
    audioRef.current = make();
    spareRef.current = make();
  }

  const ensureAnalyser = useCallback(() => {
    if (ctxRef.current) return;
    const decks = [audioRef.current, spareRef.current].filter(Boolean) as HTMLAudioElement[];
    if (!decks.length) return;
    try {
      const Ctor = window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor();
      const node = ctx.createAnalyser();
      node.fftSize = 256;
      node.smoothingTimeConstant = 0.82;
      // Both decks run through their own gain into one analyser, so the
      // visualizer sees the actual mix during an overlap rather than one side.
      for (const deck of decks) {
        const source = ctx.createMediaElementSource(deck);
        const gain = ctx.createGain();
        gain.gain.value = deck === audioRef.current ? 1 : 0;
        source.connect(gain);
        gain.connect(node);
        gainsRef.current.set(deck, gain);
      }
      node.connect(ctx.destination);
      ctxRef.current = ctx;
      setAnalyser(node);
    } catch { /* Playback can continue without reactive visualizations. */ }
  }, []);

  /** Set a deck's level, through Web Audio when we have it, else the element. */
  const setDeckGain = useCallback((deck: HTMLAudioElement, value: number) => {
    const gain = gainsRef.current.get(deck);
    if (gain) gain.gain.value = value;
    else deck.volume = Math.max(0, Math.min(1, value));
  }, []);

  /**
   * Overlap the next track with the one ending. Runs off requestAnimationFrame
   * with an equal-power curve: a straight linear fade dips in the middle,
   * because two uncorrelated signals sum by power, not amplitude.
   */
  const beginCrossfade = useCallback((entry: QueueEntry, seconds: number) => {
    const from = audioRef.current;
    const to = spareRef.current;
    if (!from || !to || fadeRef.current) return;

    to.src = entry.track.stream_url;
    to.currentTime = 0;
    to.playbackRate = from.playbackRate;
    setDeckGain(to, 0);
    to.play().catch(() => {});

    // Swap which deck is "the player" immediately: everything else in here
    // talks to audioRef, and the new track is the one that matters now.
    audioRef.current = to;
    spareRef.current = from;
    currentRef.current = entry.track;
    tokenRef.current = entry.token;
    setCurrent(entry.track);
    setShareToken(entry.token);
    setDuration(entry.track.duration || 0);
    setCrossfading(true);

    const started = performance.now();
    const step = () => {
      const progress = Math.min(1, (performance.now() - started) / (seconds * 1000));
      setDeckGain(to, Math.sin((progress * Math.PI) / 2));
      setDeckGain(from, Math.cos((progress * Math.PI) / 2));
      if (progress < 1) {
        fadeRef.current = { raf: requestAnimationFrame(step), to };
        return;
      }
      fadeRef.current = null;
      setCrossfading(false);
      from.pause();
      from.removeAttribute("src");
      from.load();
      setDeckGain(from, 0);
      setDeckGain(to, 1);
    };
    fadeRef.current = { raf: requestAnimationFrame(step), to };

    const url = "/api/tracks/" + encodeURIComponent(entry.track.id) + "/play" +
      (entry.token ? "?t=" + encodeURIComponent(entry.token) : "");
    api.post(url).catch(() => {});
  }, [setDeckGain]);

  /** Stop any overlap in progress and leave the active deck at full level. */
  const cancelCrossfade = useCallback(() => {
    if (!fadeRef.current) return;
    cancelAnimationFrame(fadeRef.current.raf);
    fadeRef.current = null;
    setCrossfading(false);
    const spare = spareRef.current;
    if (spare) {
      spare.pause();
      spare.removeAttribute("src");
      spare.load();
      setDeckGain(spare, 0);
    }
    if (audioRef.current) setDeckGain(audioRef.current, 1);
  }, [setDeckGain]);

  cancelCrossfadeRef.current = cancelCrossfade;

  /**
   * Called on every tick of the live deck. Starts the overlap once the track
   * is within the crossfade window and there is something queued to go to.
   */
  maybeCrossfadeRef.current = (el: HTMLAudioElement) => {
    const seconds = crossfadeRef.current;
    if (seconds <= 0 || fadeRef.current || el.paused) return;
    if (!Number.isFinite(el.duration) || el.duration <= 0) return;

    const remaining = el.duration - el.currentTime;
    // Never overlap more than a third of a track: on a 20-second sketch an
    // 8-second fade would bury it.
    const window = Math.min(seconds, el.duration / 3);
    if (remaining > window || remaining <= 0.05) return;

    const target = upcomingIndexRef.current();
    if (target < 0 || target === indexRef.current) return;
    const entry = entriesRef.current[target];
    if (!entry) return;

    indexRef.current = target;
    setQueueIndex(target);
    beginCrossfade(entry, window);
  };

  const requestPlayback = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    const requestId = ++playRequestRef.current;
    ensureAnalyser();
    ctxRef.current?.resume().catch(() => {});
    setError(null);
    el.play().catch((reason: unknown) => {
      if (requestId !== playRequestRef.current) return;
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setPlaying(false);
      setLoading(false);
      setError(reason instanceof DOMException && reason.name === "NotAllowedError"
        ? "Your browser paused playback. Press play to start the audio."
        : "This audio could not be played. Check your connection or try another version.");
    });
  }, [ensureAnalyser]);

  const seek = useCallback((seconds: number) => {
    const el = audioRef.current;
    if (!el || !Number.isFinite(seconds)) return;
    const limit = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : Infinity;
    const target = Math.max(0, Math.min(seconds, limit));
    if (el.readyState < 1) pendingSeekRef.current = target;
    else {
      try { el.currentTime = target; pendingSeekRef.current = null; }
      catch { pendingSeekRef.current = target; }
    }
    setTime(target);
  }, []);

  const updateQueue = useCallback((entries: QueueEntry[], index: number) => {
    entriesRef.current = entries;
    indexRef.current = index;
    setQueue(entries.map((entry) => entry.track));
    setQueueIndex(index);
  }, []);

  const startEntry = useCallback((entry: QueueEntry, startAt: number, toggleSame = false) => {
    cancelCrossfadeRef.current();
    const el = audioRef.current;
    if (!el) return;
    const sameSource = currentRef.current?.id === entry.track.id &&
      el.getAttribute("src") === entry.track.stream_url && tokenRef.current === entry.token;
    currentRef.current = entry.track;
    tokenRef.current = entry.token;
    setCurrent(entry.track);
    setShareToken(entry.token);
    if (sameSource) {
      if (toggleSame && !el.paused) {
        ++playRequestRef.current;
        el.pause();
        return;
      }
      if (!toggleSame) seek(startAt);
      requestPlayback();
      return;
    }

    ++playRequestRef.current;
    el.pause();
    setPlaying(false);
    setLoading(true);
    setError(null);
    const target = Number.isFinite(startAt) ? Math.max(0, startAt) : 0;
    pendingSeekRef.current = target;
    setTime(target);
    setDuration(entry.track.duration || 0);
    el.src = entry.track.stream_url;
    requestPlayback();
    const url = "/api/tracks/" + encodeURIComponent(entry.track.id) + "/play" +
      (entry.token ? "?t=" + encodeURIComponent(entry.token) : "");
    api.post(url).catch(() => {});
  }, [requestPlayback, seek]);

  const makeList = (track: Track, list: Track[], token?: string) => {
    const index = list.findIndex((item) => item.id === track.id);
    return index >= 0
      ? { entries: list.map((item) => ({ track: item, token })), index }
      : { entries: [{ track, token }, ...list.map((item) => ({ track: item, token }))], index: 0 };
  };

  const play = useCallback((track: Track, list?: Track[], token?: string) => {
    if (list) {
      const session = makeList(track, list, token);
      updateQueue(session.entries, session.index);
    } else if (currentRef.current?.id !== track.id || tokenRef.current !== token) {
      updateQueue([{ track, token }], 0);
    }
    startEntry({ track, token }, 0, true);
  }, [startEntry, updateQueue]);

  const playAt = useCallback((track: Track, seconds: number, list?: Track[], token?: string) => {
    if (list) {
      const session = makeList(track, list, token);
      updateQueue(session.entries, session.index);
    } else if (indexRef.current >= 0) {
      // A/B replaces this listening slot, retaining the tracks already queued.
      const entries = [...entriesRef.current];
      entries[indexRef.current] = { track, token };
      updateQueue(entries, indexRef.current);
    } else updateQueue([{ track, token }], 0);
    startEntry({ track, token }, seconds);
  }, [startEntry, updateQueue]);

  const playQueued = useCallback((index: number) => {
    const entry = entriesRef.current[index];
    if (!entry || !Number.isInteger(index)) return;
    indexRef.current = index;
    setQueueIndex(index);
    startEntry(entry, 0);
  }, [startEntry]);

  const addToQueue = useCallback((track: Track | Track[], token?: string) => {
    const additions = (Array.isArray(track) ? track : [track]).map((item) => ({ track: item, token }));
    if (!additions.length) return;
    if (!currentRef.current) {
      updateQueue(additions, 0);
      startEntry(additions[0], 0);
    } else updateQueue([...entriesRef.current, ...additions], indexRef.current);
  }, [startEntry, updateQueue]);

  const playNext = useCallback((track: Track, token?: string) => {
    if (!currentRef.current) { addToQueue(track, token); return; }
    const entries = [...entriesRef.current];
    entries.splice(indexRef.current + 1, 0, { track, token });
    updateQueue(entries, indexRef.current);
  }, [addToQueue, updateQueue]);

  const removeFromQueue = useCallback((index: number) => {
    // Current playback and played history cannot be removed by upcoming controls.
    if (!Number.isInteger(index) || index <= indexRef.current || index >= entriesRef.current.length) return;
    updateQueue(entriesRef.current.filter((_, position) => position !== index), indexRef.current);
  }, [updateQueue]);

  const moveInQueue = useCallback((fromIndex: number, toIndex: number) => {
    const entries = [...entriesRef.current];
    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex) ||
      fromIndex <= indexRef.current || toIndex <= indexRef.current ||
      fromIndex >= entries.length || toIndex >= entries.length) return;
    const [entry] = entries.splice(fromIndex, 1);
    entries.splice(toIndex, 0, entry);
    updateQueue(entries, indexRef.current);
  }, [updateQueue]);

  const clearQueue = useCallback(() => {
    const entry = entriesRef.current[indexRef.current];
    updateQueue(entry ? [entry] : [], entry ? 0 : -1);
  }, [updateQueue]);

  /** Which entry should follow the current one, or -1 to stop. */
  const upcomingIndex = useCallback(() => {
    const entries = entriesRef.current;
    const here = indexRef.current;
    if (!entries.length) return -1;
    if (repeatRef.current === "one") return here;
    if (shuffleRef.current && entries.length > 1) {
      // Anything but the track just heard, so shuffle never repeats itself
      // back to back on a queue of two.
      let pick = here;
      for (let attempt = 0; attempt < 12 && pick === here; attempt++) {
        pick = Math.floor(Math.random() * entries.length);
      }
      return pick;
    }
    const ahead = here + 1;
    if (ahead < entries.length) return ahead;
    return repeatRef.current === "all" ? 0 : -1;
  }, []);

  const next = useCallback(() => {
    cancelCrossfade();
    const target = upcomingIndex();
    if (target < 0) return;   // End the session rather than looping silently.
    if (target === indexRef.current && repeatRef.current === "one") {
      seek(0);
      requestPlayback();
      return;
    }
    playQueued(target);
  }, [cancelCrossfade, playQueued, requestPlayback, seek, upcomingIndex]);

  upcomingIndexRef.current = upcomingIndex;

  const toggleShuffle = useCallback(() => setShuffle((on) => !on), []);
  const cycleRepeat = useCallback(() => {
    setRepeat((mode) => (mode === "off" ? "all" : mode === "all" ? "one" : "off"));
  }, []);
  const setSpeed = useCallback((rate: number) => {
    if (SPEEDS.includes(rate as typeof SPEEDS[number])) setSpeedState(rate);
  }, []);

  const prev = useCallback(() => {
    const el = audioRef.current;
    if (el && (el.currentTime > 3 || indexRef.current <= 0)) seek(0);
    else playQueued(indexRef.current - 1);
  }, [playQueued, seek]);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el || !currentRef.current) return;
    if (el.paused) requestPlayback();
    else { ++playRequestRef.current; el.pause(); }
  }, [requestPlayback]);

  const retryPlayback = useCallback(() => {
    const el = audioRef.current;
    if (!el || !currentRef.current) return;
    pendingSeekRef.current = Number.isFinite(el.currentTime) ? el.currentTime : 0;
    el.load();
    setLoading(true);
    requestPlayback();
  }, [requestPlayback]);

  nextRef.current = next;

  useEffect(() => {
    const decks = [audioRef.current, spareRef.current].filter(Boolean) as HTMLAudioElement[];
    if (!decks.length) return;
    // Listeners go on both decks and ignore whichever is not live, because a
    // crossfade swaps which element audioRef points at.
    const live = (target: EventTarget | null) => target === audioRef.current;
    const onTime = (event: Event) => {
      const el = audioRef.current;
      if (!el || !live(event.target)) return;
      setTime(el.currentTime);
      maybeCrossfadeRef.current(el);
    };
    const onMeta = (event: Event) => {
      const el = audioRef.current;
      if (!el || !live(event.target)) return;
      setDuration(Number.isFinite(el.duration) ? el.duration : 0);
      if (pendingSeekRef.current !== null && el.readyState >= 1) seek(pendingSeekRef.current);
    };
    const onEnd = (event: Event) => {
      // A deck that ran out during a crossfade has already been handed over.
      if (!live(event.target)) return;
      setPlaying(false); setLoading(false); nextRef.current();
    };
    const onPlay = (event: Event) => {
      if (!live(event.target)) return;
      setPlaying(true); setLoading(false); setError(null);
    };
    const onPause = (event: Event) => {
      if (!live(event.target) || fadeRef.current) return;
      setPlaying(false); setLoading(false);
    };
    const onWaiting = (event: Event) => { if (live(event.target)) setLoading(true); };
    const onReady = (event: Event) => { if (live(event.target)) setLoading(false); };
    const onError = (event: Event) => {
      const el = audioRef.current;
      if (!el || !live(event.target)) return;
      if (!currentRef.current || !el.getAttribute("src")) return;
      setPlaying(false);
      setLoading(false);
      setError("Audio unavailable. The file may have been removed, the connection lost, or the share link expired.");
    };
    const reset = () => {
      ++playRequestRef.current;
      cancelCrossfadeRef.current();
      for (const deck of decks) {
        deck.pause();
        deck.removeAttribute("src");
        deck.load();
      }
      pendingSeekRef.current = null;
      currentRef.current = null;
      tokenRef.current = undefined;
      setCurrent(null);
      setShareToken(undefined);
      setTime(0);
      setDuration(0);
      setError(null);
      updateQueue([], -1);
    };
    const bindings: [string, EventListener][] = [
      ["timeupdate", onTime], ["loadedmetadata", onMeta], ["durationchange", onMeta],
      ["ended", onEnd], ["playing", onPlay], ["pause", onPause],
      ["waiting", onWaiting], ["canplay", onReady], ["error", onError],
    ];
    for (const deck of decks) {
      for (const [type, handler] of bindings) deck.addEventListener(type, handler);
    }
    window.addEventListener("vault:logout", reset);
    return () => {
      ++playRequestRef.current;
      for (const deck of decks) {
        for (const [type, handler] of bindings) deck.removeEventListener(type, handler);
        deck.pause();
        deck.removeAttribute("src");
        deck.load();
      }
      window.removeEventListener("vault:logout", reset);
      ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
    };
  }, [seek, updateQueue]);

  useEffect(() => {
    // Master volume is the element's own volume on both decks; the gain nodes
    // are reserved for the crossfade so the two never fight each other.
    for (const deck of [audioRef.current, spareRef.current]) {
      if (deck) deck.volume = volume;
    }
    try { localStorage.setItem("vault:volume", String(volume)); } catch { /* Storage may be disabled. */ }
  }, [volume]);

  useEffect(() => {
    for (const deck of [audioRef.current, spareRef.current]) {
      if (deck) deck.playbackRate = speed;
    }
    try { localStorage.setItem("vault:speed", String(speed)); } catch { /* Storage may be disabled. */ }
  }, [speed]);

  useEffect(() => {
    try { localStorage.setItem("vault:shuffle", shuffle ? "1" : "0"); } catch { /* Storage may be disabled. */ }
  }, [shuffle]);

  useEffect(() => {
    try { localStorage.setItem("vault:repeat", repeat); } catch { /* Storage may be disabled. */ }
  }, [repeat]);

  // Tear down any running fade when the provider goes away.
  useEffect(() => () => {
    if (fadeRef.current) cancelAnimationFrame(fadeRef.current.raf);
  }, []);

  const value: PlayerValue = {
    current, queue, queueIndex, playing, loading, error, time, duration, volume,
    crossfading, shuffle, repeat, speed, toggleShuffle, cycleRepeat, setSpeed,
    shareToken, analyser, audio: audioRef.current,
    play, playAt, addToQueue, playNext, playQueued, removeFromQueue, moveInQueue,
    clearQueue, retryPlayback, toggle, seek, next, prev,
    dismissError: () => setError(null),
    setVolume: (value) => { if (Number.isFinite(value)) setVolumeState(Math.max(0, Math.min(1, value))); },
  };

  return <PlayerCtx.Provider value={value}>{children}</PlayerCtx.Provider>;
}

export function usePlayer() {
  const ctx = useContext(PlayerCtx);
  if (!ctx) throw new Error("usePlayer must be used inside PlayerProvider");
  return ctx;
}
