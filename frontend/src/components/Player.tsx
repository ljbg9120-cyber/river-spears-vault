/** The persistent bottom player. Tap the artwork for the full-screen view. */
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatTime } from "../lib/api";
import { useAuth, usePlayer } from "../lib/store";
import Cover from "./Cover";
import NowPlaying from "./NowPlaying";
import { Icon } from "./ui";
import Visualizer from "./Visualizer";
import Waveform from "./Waveform";

export default function Player() {
  const { current, playing, time, duration, volume, toggle, seek, next, prev, setVolume } =
    usePlayer();
  const { theme } = useAuth();
  const [expanded, setExpanded] = useState(false);

  // Space to play/pause, arrows to scrub — unless you are typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el?.tagName === "INPUT" || el?.tagName === "TEXTAREA" || el?.isContentEditable)
        return;
      if (e.code === "Space") {
        e.preventDefault();
        toggle();
      } else if (e.code === "ArrowRight" && e.shiftKey) next();
      else if (e.code === "ArrowLeft" && e.shiftKey) prev();
      else if (e.code === "ArrowRight") seek(time + 5);
      else if (e.code === "ArrowLeft") seek(time - 5);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, next, prev, seek, time]);

  // Any page can ask for the lyrics screen without threading props through.
  useEffect(() => {
    const open = () => setExpanded(true);
    window.addEventListener("vault:nowplaying", open);
    return () => window.removeEventListener("vault:nowplaying", open);
  }, []);

  const total = duration || current?.duration || 0;
  const progress = total > 0 ? Math.min(1, time / total) : 0;
  const showViz = theme.visualizer !== "off";

  return (
    <>
      <AnimatePresence>
        {current && (
          <motion.div
            key="player"
            initial={{ y: 120, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 120, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed inset-x-0 bottom-0 z-40 px-2 pb-2 sm:px-4 sm:pb-4"
            style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
          >
            <div className="glass-strong relative mx-auto max-w-5xl overflow-hidden rounded-2xl shadow-lift sm:rounded-3xl">
              {/* The bar itself breathes with the track, behind the controls. */}
              {showViz && (
                <div
                  className="pointer-events-none absolute inset-0 opacity-45"
                  style={{
                    maskImage:
                      "linear-gradient(90deg, #000 0%, transparent 32%, transparent 68%, #000 100%)",
                    WebkitMaskImage:
                      "linear-gradient(90deg, #000 0%, transparent 32%, transparent 68%, #000 100%)",
                  }}
                >
                  <Visualizer theme={theme} />
                </div>
              )}

              <div className="relative h-0.5 w-full bg-white/5">
                <motion.div
                  className="h-full"
                  style={{
                    width: `${progress * 100}%`,
                    background:
                      "linear-gradient(90deg, rgb(var(--accent-rgb)), rgb(var(--accent2-rgb)))",
                  }}
                />
              </div>

              <div className="relative flex items-center gap-3 p-2.5 sm:gap-4 sm:p-3">
                {/* Artwork doubles as the visualizer and the way in. */}
                <button
                  onClick={() => setExpanded(true)}
                  className="group relative h-12 w-12 shrink-0 sm:h-14 sm:w-14"
                  aria-label="Open full screen player"
                >
                  <Cover url={current.cover_url || undefined} radius={12} icon={20} thumb />
                  {showViz && (
                    // Over real art the visualizer sits back and screens in,
                    // so it lifts the cover rather than covering it.
                    <span
                      className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl"
                      style={{
                        opacity: current.cover_url ? 0.4 : 0.95,
                        mixBlendMode: current.cover_url ? "screen" : "normal",
                      }}
                    >
                      <Visualizer theme={theme} />
                    </span>
                  )}
                </button>

                <div className="min-w-0 flex-1">
                  <Link
                    to={`/track/${current.id}`}
                    className="block truncate font-display text-sm font-bold hover:underline sm:text-base"
                  >
                    {current.title}
                  </Link>
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <span className="truncate">{current.owner.display_name}</span>
                    <span className="hidden font-mono tabular-nums sm:inline">
                      {formatTime(time)} / {formatTime(total)}
                    </span>
                  </div>
                </div>

                <div className="hidden min-w-0 flex-[2] md:block">
                  <Waveform
                    peaks={current.peaks}
                    progress={progress}
                    height={40}
                    duration={total}
                    live={playing}
                    onSeek={(r) => seek(r * total)}
                  />
                </div>

                <div className="flex shrink-0 items-center gap-1 sm:gap-2">
                  <button
                    onClick={prev}
                    className="hidden rounded-full p-2 text-muted transition hover:bg-white/10 hover:text-ink sm:block"
                    aria-label="Previous"
                  >
                    <Icon name="prev" size={18} />
                  </button>
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    onClick={toggle}
                    className="flex h-11 w-11 items-center justify-center rounded-full text-white"
                    style={{
                      background:
                        "linear-gradient(135deg, rgb(var(--accent-rgb)), rgb(var(--accent2-rgb)))",
                      boxShadow: "0 8px 24px -8px rgb(var(--accent-rgb) / 0.9)",
                    }}
                    aria-label={playing ? "Pause" : "Play"}
                  >
                    <Icon name={playing ? "pause" : "play"} size={20} />
                  </motion.button>
                  <button
                    onClick={next}
                    className="hidden rounded-full p-2 text-muted transition hover:bg-white/10 hover:text-ink sm:block"
                    aria-label="Next"
                  >
                    <Icon name="next" size={18} />
                  </button>

                  <button
                    onClick={() => setExpanded(true)}
                    className="rounded-full p-2 text-muted transition hover:bg-white/10 hover:text-ink"
                    aria-label="Lyrics and visualizer"
                    title="Lyrics & visualizer"
                  >
                    <Icon name="sparkles" size={17} />
                  </button>

                  <div className="ml-1 hidden items-center gap-2 lg:flex">
                    <Icon name="volume" size={16} className="text-muted" />
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={volume}
                      onChange={(e) => setVolume(Number(e.target.value))}
                      className="w-20"
                      aria-label="Volume"
                    />
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <NowPlaying open={expanded} onClose={() => setExpanded(false)} />
    </>
  );
}
