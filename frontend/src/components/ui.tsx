/** Small shared pieces: avatars, modals, toasts, empty states, icons. */
import { AnimatePresence, motion } from "framer-motion";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

export function Avatar({
  name,
  src,
  size = 36,
}: {
  name: string;
  src?: string | null;
  size?: number;
}) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        referrerPolicy="no-referrer"
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="flex items-center justify-center rounded-full font-display font-bold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: "linear-gradient(135deg, rgb(var(--accent-rgb)), rgb(var(--accent2-rgb)))",
      }}
    >
      {initials || "?"}
    </div>
  );
}

export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <span
      className="inline-block animate-spin rounded-full border-2 border-current border-t-transparent"
      style={{ width: size, height: size }}
    />
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 520,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            className="glass-strong relative w-full overflow-hidden rounded-t-3xl sm:rounded-3xl"
            style={{ maxWidth: width, boxShadow: "0 40px 100px -30px rgba(0,0,0,0.8)" }}
            initial={{ y: 40, scale: 0.97, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 30, scale: 0.98, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
          >
            <div className="flex items-center justify-between border-b border-[var(--hairline)] px-6 py-4">
              <h3 className="font-display text-lg font-bold">{title}</h3>
              <button
                onClick={onClose}
                className="rounded-full p-1.5 text-muted transition hover:bg-white/10 hover:text-ink"
                aria-label="Close"
              >
                <Icon name="x" />
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// --- toasts ----------------------------------------------------------------

type Toast = { id: number; text: string; kind: "ok" | "err" };
const ToastCtx = createContext<(text: string, kind?: "ok" | "err") => void>(
  () => {},
);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((text: string, kind: "ok" | "err" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-28 left-1/2 z-[60] flex w-full max-w-sm -translate-x-1/2 flex-col items-center gap-2 px-4">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 20, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.96 }}
              transition={{ type: "spring", stiffness: 420, damping: 30 }}
              className="glass-strong pointer-events-auto flex items-center gap-2.5 rounded-full px-4 py-2.5 text-sm font-medium shadow-lift"
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{
                  background: t.kind === "ok" ? "rgb(var(--accent-rgb))" : "#ff5470",
                }}
              />
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

export function Empty({
  icon = "music",
  title,
  hint,
  action,
}: {
  icon?: IconName;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center"
    >
      <div
        className="mb-1 flex h-16 w-16 items-center justify-center rounded-2xl"
        style={{
          background: "rgb(var(--accent-rgb) / 0.12)",
          color: "rgb(var(--accent-rgb))",
        }}
      >
        <Icon name={icon} size={28} />
      </div>
      <h3 className="font-display text-xl font-bold">{title}</h3>
      {hint && <p className="max-w-sm text-sm text-muted">{hint}</p>}
      {action && <div className="mt-3">{action}</div>}
    </motion.div>
  );
}

// --- icons -----------------------------------------------------------------

export type IconName =
  | "play" | "pause" | "next" | "prev" | "music" | "upload" | "folder"
  | "search" | "x" | "plus" | "trash" | "share" | "heart" | "comment"
  | "download" | "settings" | "sparkles" | "lock" | "globe" | "link"
  | "check" | "chevron" | "volume" | "grid" | "list" | "logout" | "user"
  | "shuffle" | "tag" | "clock" | "edit" | "repeat";

const PATHS: Record<IconName, string> = {
  play: "M8 5v14l11-7z",
  pause: "M6 5h4v14H6zm8 0h4v14h-4z",
  next: "M6 5l9 7-9 7V5zm10 0h3v14h-3z",
  prev: "M18 5l-9 7 9 7V5zM5 5h3v14H5z",
  music: "M9 18V6l10-2v12M9 18a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zm10-2a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z",
  upload: "M12 16V4m0 0L7 9m5-5l5 5M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2",
  folder: "M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z",
  search: "M11 19a8 8 0 100-16 8 8 0 000 16zm10 2l-4.35-4.35",
  x: "M18 6L6 18M6 6l12 12",
  plus: "M12 5v14M5 12h14",
  trash: "M4 7h16M10 11v6M14 11v6M5 7l1 13a2 2 0 002 2h8a2 2 0 002-2l1-13M9 7V4h6v3",
  share: "M4 12v7a2 2 0 002 2h12a2 2 0 002-2v-7M16 6l-4-4-4 4M12 2v14",
  heart: "M20.8 6.6a5 5 0 00-7.1 0L12 8.3l-1.7-1.7a5 5 0 00-7.1 7.1l8.8 8.8 8.8-8.8a5 5 0 000-7.1z",
  comment: "M21 12a8 8 0 01-8 8H7l-4 3v-9a8 8 0 018-8h2a8 8 0 018 8z",
  download: "M12 4v12m0 0l-5-5m5 5l5-5M4 19h16",
  settings: "M12 15a3 3 0 100-6 3 3 0 000 6zm8.4-3a8.4 8.4 0 00-.1-1.2l2-1.6-2-3.4-2.4 1a8.4 8.4 0 00-2-1.2L15.5 2h-4l-.4 2.6a8.4 8.4 0 00-2 1.2l-2.4-1-2 3.4 2 1.6a8.4 8.4 0 000 2.4l-2 1.6 2 3.4 2.4-1a8.4 8.4 0 002 1.2l.4 2.6h4l.4-2.6a8.4 8.4 0 002-1.2l2.4 1 2-3.4-2-1.6c.06-.4.1-.8.1-1.2z",
  sparkles: "M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3zM19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z",
  lock: "M6 11V8a6 6 0 1112 0v3M5 11h14v10H5V11z",
  globe: "M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3a15 15 0 010 18 15 15 0 010-18z",
  link: "M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.7-1.7",
  check: "M20 6L9 17l-5-5",
  chevron: "M9 18l6-6-6-6",
  volume: "M11 5L6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 010 7M19 5a9 9 0 010 14",
  grid: "M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  logout: "M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9",
  user: "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z",
  shuffle: "M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5",
  repeat: "M17 2l4 4-4 4M3 11v-1a4 4 0 014-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 01-4 4H3",
  tag: "M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0l-7.2-7.2a2 2 0 01-.6-1.4V4a2 2 0 012-2h8c.5 0 1 .2 1.4.6l6.4 6.4a2 2 0 010 2.8zM7.5 7.5h.01",
  clock: "M12 21a9 9 0 100-18 9 9 0 000 18zm0-14v5l3 2",
  edit: "M11 4H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2v-5M18.5 2.5a2.1 2.1 0 013 3L12 15l-4 1 1-4 9.5-9.5z",
};

export function Icon({
  name,
  size = 18,
  filled = false,
  className = "",
}: {
  name: IconName;
  size?: number;
  filled?: boolean;
  className?: string;
}) {
  const solid = name === "play" || name === "pause" || name === "next" || name === "prev";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={solid || filled ? "currentColor" : "none"}
      stroke={solid || filled ? "none" : "currentColor"}
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
