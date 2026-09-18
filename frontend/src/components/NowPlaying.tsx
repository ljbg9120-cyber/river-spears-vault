/**
 * The full-screen now-playing view: visualizer behind, lyrics scrolling in
 * time with the song, everything painted in the artist's colours.
 *
 * Lines light up as they arrive and dim once they pass; clicking one seeks
 * there. Untimed lyrics still render, they just sit still.
 */
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatTime } from "../lib/api";
import { activeLineIndex, hasTimings, parseLyrics } from "../lib/lyrics";
import { useAuth, usePlayer } from "../lib/store";
import Cover from "./Cover";
import { Avatar, Icon } from "./ui";
import Visualizer from "./Visualizer";
import Waveform from "./Waveform";

export default function NowPlaying({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { current, playing, time, duration, toggle, seek, next, prev } = usePlayer();
  const { theme, user } = useAuth();

  const scroller = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // Let people read ahead without the song yanking them back.
  const manualUntil = useRef(0);

  const lines = useMemo(() => parseLyrics(current?.lyrics ?? ""), [current?.lyrics]);
  const timed = hasTimings(lines);
  const active = timed ? activeLineIndex(lines, time) : -1;

  const total = duration || current?.duration || 0;
  const progress = total > 0 ? Math.min(1, time / total) : 0;
  const isOwner = !!user && !!current && user.id === current.owner.id;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Keep the current line centred while the song plays.
  useEffect(() => {
    if (!open || active < 0 || Date.now() < manualUntil.current) return;
    const el = lineRefs.current[active];
    const box = scroller.current;
    if (!el || !box) return;
    box.scrollTo({
      top: el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2,
      behavior: "smooth",
    });
  }, [active, open]);

  if (!current) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-[55] overflow-hidden"
          // Opaque base: this is a destination, not an overlay. Without a solid
          // colour here the page underneath reads straight through the tints.
          style={{ background: theme.mode === "light" ? "#f4f3fb" : "#06060b" }}
        >
          {/* ---- the room ---- */}
          <div
            className="absolute inset-0"
            style={{
              background:
                theme.mode === "light"
                  ? `linear-gradient(160deg, ${theme.accent}22, ${theme.accent2}18 55%, rgb(var(--bg-rgb)))`
                  : `linear-gradient(160deg, ${theme.accent}77, ${theme.accent2}44 52%, #06060b)`,
            }}
          />
          {current.cover_url && (
            <div
              className="absolute inset-0 scale-110"
              style={{
                backgroundImage: `url(${current.cover_url})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                filter: "blur(60px) saturate(150%)",
                opacity: theme.mode === "light" ? 0.35 : 0.5,
              }}
            />
          )}
          <motion.div
            className="absolute inset-0"
            animate={playing ? { opacity: [0.55, 0.85, 0.55] } : { opacity: 0.5 }}
            transition={{ repeat: Infinity, duration: 7, ease: "easeInOut" }}
            style={{
              background: `radial-gradient(70% 55% at 22% 18%, ${theme.accent}66, transparent 65%),
                           radial-gradient(60% 50% at 82% 78%, ${theme.accent2}55, transparent 65%)`,
              filter: "blur(30px)",
            }}
          />
          <div className="pointer-events-none absolute inset-0">
            <Visualizer theme={theme} />
          </div>
          <div
            className="absolute inset-0"
            style={{
              background:
                theme.mode === "light"
                  ? "rgba(255,255,255,0.18)"
                  : "rgba(4,4,9,0.20)",
            }}
          />

          {/* ---- content ---- */}
          <div className="relative flex h-full flex-col">
            <header className="flex items-center justify-between px-4 py-4 sm:px-8">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-white/60">
                <motion.span
                  animate={playing ? { opacity: [0.4, 1, 0.4] } : { opacity: 0.5 }}
                  transition={{ repeat: Infinity, duration: 2 }}
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: theme.accent2 }}
                />
                Now playing
              </div>
              <button
                onClick={onClose}
                className="rounded-full p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
                aria-label="Close"
              >
                <Icon name="x" size={22} />
              </button>
            </header>

            <div className="flex min-h-0 flex-1 flex-col gap-6 px-4 pb-4 sm:px-8 lg:flex-row lg:items-center lg:gap-12">
              {/* --- left: the track --- */}
              <div className="flex shrink-0 flex-row items-center gap-4 lg:w-[320px] lg:flex-col lg:items-start lg:gap-6">
                <motion.div
                  animate={
                    playing
                      ? { scale: [1, 1.025, 1], rotate: [0, 0.8, 0] }
                      : { scale: 1, rotate: 0 }
                  }
                  transition={{ repeat: Infinity, duration: 5, ease: "easeInOut" }}
                  className="relative h-20 w-20 shrink-0 sm:h-24 sm:w-24 lg:h-[280px] lg:w-[280px]"
                  style={{ filter: `drop-shadow(0 30px 80px ${theme.accent}55)` }}
                >
                  <span className="block h-full w-full lg:hidden">
                    <Cover url={current.cover_url || undefined} radius={16} icon={28} />
                  </span>
                  <span className="hidden h-full w-full lg:block">
                    <Cover url={current.cover_url || undefined} radius={32} icon={90} />
                  </span>
                </motion.div>

                <div className="min-w-0 lg:w-full">
                  <h1 className="title-xl truncate text-xl text-white sm:text-2xl lg:text-4xl lg:leading-tight">
                    {current.title}
                  </h1>
                  <div className="mt-1 flex items-center gap-2 text-sm text-white/65 lg:mt-3">
                    <Avatar
                      name={current.owner.display_name}
                      src={current.owner.avatar_url}
                      size={22}
                    />
                    <span className="truncate">{current.owner.display_name}</span>
                  </div>
                  <div className="mt-2 hidden flex-wrap gap-2 lg:flex">
                    {current.bpm && (
                      <span className="chip !border-white/15 !bg-white/10 !text-white/80">
                        {current.bpm} BPM
                      </span>
                    )}
                    {current.song_key && (
                      <span className="chip !border-white/15 !bg-white/10 !text-white/80">
                        {current.song_key}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* --- right: the words --- */}
              <div className="relative min-h-0 flex-1">
                {/* Local scrim: keeps lines legible over a busy visualizer
                    without flattening the whole screen. */}
                <div
                  className="pointer-events-none absolute -inset-x-6 inset-y-0"
                  style={{
                    background:
                      theme.mode === "light"
                        ? "radial-gradient(60% 50% at 50% 50%, rgba(255,255,255,0.75), transparent 75%)"
                        : "radial-gradient(60% 50% at 50% 50%, rgba(3,3,8,0.62), transparent 75%)",
                  }}
                />
                {lines.length > 0 ? (
                  <div
                    ref={scroller}
                    onWheel={() => (manualUntil.current = Date.now() + 5000)}
                    onTouchMove={() => (manualUntil.current = Date.now() + 5000)}
                    className="h-full max-h-[52vh] overflow-y-auto px-1 py-[22vh] lg:max-h-[62vh] lg:py-[26vh]"
                    style={{
                      maskImage:
                        "linear-gradient(180deg, transparent, #000 16%, #000 84%, transparent)",
                      WebkitMaskImage:
                        "linear-gradient(180deg, transparent, #000 16%, #000 84%, transparent)",
                    }}
                  >
                    {lines.map((line, i) => {
                      const isActive = i === active;
                      const isPast = timed && active >= 0 && i < active;
                      if (!line.text.trim()) return <div key={i} className="h-5" />;
                      return (
                        <motion.button
                          key={i}
                          ref={(el) => (lineRefs.current[i] = el)}
                          onClick={() => line.time !== null && seek(line.time)}
                          disabled={line.time === null}
                          animate={{
                            opacity: !timed ? 0.85 : isActive ? 1 : isPast ? 0.32 : 0.45,
                            scale: isActive ? 1 : 0.985,
                          }}
                          transition={{ duration: 0.35 }}
                          className="block w-full cursor-pointer text-left font-display text-2xl font-bold leading-snug tracking-tight text-white transition-colors disabled:cursor-default sm:text-3xl lg:text-[2.6rem] lg:leading-[1.15]"
                          style={{
                            textShadow: isActive
                              ? `0 0 34px ${theme.accent2}77`
                              : "none",
                            paddingBlock: "0.28rem",
                          }}
                        >
                          {line.text}
                        </motion.button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex h-full min-h-[34vh] flex-col items-center justify-center gap-3 text-center">
                    <div className="h-32 w-full max-w-md opacity-90">
                      <Visualizer theme={theme} />
                    </div>
                    <p className="text-sm text-white/55">
                      {isOwner
                        ? "No lyrics on this one yet — add them from the track page and they'll scroll here in time."
                        : "No lyrics for this track."}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* ---- transport ---- */}
            <footer className="px-4 pb-6 sm:px-8">
              <div className="mx-auto w-full max-w-3xl">
                <Waveform
                  peaks={current.peaks}
                  progress={progress}
                  height={54}
                  duration={total}
                  live={playing}
                  onSeek={(r) => seek(r * total)}
                />
                <div className="mt-1 flex justify-between font-mono text-[11px] text-white/55">
                  <span>{formatTime(time)}</span>
                  <span>{formatTime(total)}</span>
                </div>

                <div className="mt-3 flex items-center justify-center gap-7">
                  <button
                    onClick={prev}
                    className="text-white/70 transition hover:text-white"
                    aria-label="Previous"
                  >
                    <Icon name="prev" size={26} />
                  </button>
                  <motion.button
                    whileTap={{ scale: 0.92 }}
                    onClick={toggle}
                    className="flex h-16 w-16 items-center justify-center rounded-full text-white"
                    style={{
                      background: `linear-gradient(135deg, ${theme.accent}, ${theme.accent2})`,
                      boxShadow: `0 14px 44px -12px ${theme.accent}`,
                    }}
                    aria-label={playing ? "Pause" : "Play"}
                  >
                    <Icon name={playing ? "pause" : "play"} size={28} />
                  </motion.button>
                  <button
                    onClick={next}
                    className="text-white/70 transition hover:text-white"
                    aria-label="Next"
                  >
                    <Icon name="next" size={26} />
                  </button>
                </div>
              </div>
            </footer>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
