/**
 * Tap-to-sync: play the track and hit the button (or Space) as each line
 * lands. Nobody should be typing [00:12.40] by hand.
 */
import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { formatTime, type Track } from "../lib/api";
import { formatStamp, parseLyrics, serializeLyrics, type LyricLine } from "../lib/lyrics";
import { usePlayer } from "../lib/store";
import { Icon } from "./ui";

export default function LyricsSync({
  track,
  text,
  onDone,
  onCancel,
}: {
  track: Track;
  text: string;
  onDone: (synced: string) => void;
  onCancel: () => void;
}) {
  const { current, playing, time, play, toggle, seek } = usePlayer();
  const isCurrent = current?.id === track.id;

  // Only lines with words can hold a timestamp; blanks ride along untouched.
  const [lines, setLines] = useState<LyricLine[]>(() =>
    parseLyrics(text).map((l) => ({ ...l, time: null })),
  );
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  const stampable = (i: number) => i < lines.length && lines[i].text.trim() !== "";

  const advance = (from: number) => {
    let i = from + 1;
    while (i < lines.length && !stampable(i)) i++;
    return i;
  };

  const stamp = () => {
    if (cursor >= lines.length) return;
    setLines((ls) =>
      ls.map((l, i) => (i === cursor ? { ...l, time: Math.max(0, time) } : l)),
    );
    setCursor((c) => advance(c));
  };

  const undo = () => {
    // Walk back to the last line that actually carries a stamp.
    let i = cursor - 1;
    while (i >= 0 && !stampable(i)) i--;
    if (i < 0) return;
    setLines((ls) => ls.map((l, k) => (k === i ? { ...l, time: null } : l)));
    setCursor(i);
    const back = lines[i].time;
    if (back !== null) seek(Math.max(0, back - 1));
  };

  const reset = () => {
    setLines((ls) => ls.map((l) => ({ ...l, time: null })));
    setCursor(stampable(0) ? 0 : advance(0));
    seek(0);
  };

  useEffect(() => {
    if (!stampable(0)) setCursor(advance(0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el?.tagName === "INPUT" || el?.tagName === "TEXTAREA") return;
      if (e.code === "Space") {
        e.preventDefault();
        stamp();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  useEffect(() => {
    const row = rowRefs.current[cursor];
    const box = listRef.current;
    if (!row || !box) return;
    box.scrollTo({
      top: row.offsetTop - box.clientHeight / 2 + row.clientHeight / 2,
      behavior: "smooth",
    });
  }, [cursor]);

  const done = lines.filter((l) => l.time !== null).length;
  const total = lines.filter((l) => l.text.trim()).length;
  const finished = cursor >= lines.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button
          onClick={() => (isCurrent ? toggle() : play(track, [track]))}
          className="btn-primary !px-4 !py-2 text-sm"
        >
          <Icon name={isCurrent && playing ? "pause" : "play"} size={15} />
          {isCurrent && playing ? "Pause" : "Play"}
        </button>
        <span className="font-mono text-sm text-muted">
          {formatTime(isCurrent ? time : 0)}
        </span>
        <span className="ml-auto text-xs text-muted">
          {done} / {total} lines
        </span>
      </div>

      <div
        ref={listRef}
        className="max-h-[38vh] overflow-y-auto rounded-2xl p-2"
        style={{ background: "var(--panel)" }}
      >
        {lines.map((line, i) => {
          if (!line.text.trim()) return <div key={i} className="h-3" />;
          const isNext = i === cursor;
          return (
            <div
              key={i}
              ref={(el) => (rowRefs.current[i] = el)}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 transition"
              style={{
                background: isNext ? "rgb(var(--accent-rgb) / 0.18)" : "transparent",
                opacity: line.time !== null ? 1 : isNext ? 1 : 0.5,
              }}
            >
              <button
                onClick={() => line.time !== null && seek(line.time)}
                disabled={line.time === null}
                className="w-[62px] shrink-0 text-left font-mono text-[11px]"
                style={{
                  color:
                    line.time !== null
                      ? "rgb(var(--accent2-rgb))"
                      : "rgb(var(--muted-rgb))",
                }}
              >
                {line.time !== null ? formatStamp(line.time).slice(1, -1) : "--:--"}
              </button>
              <span className="min-w-0 flex-1 truncate text-sm">{line.text}</span>
              {isNext && (
                <motion.span
                  animate={{ opacity: [0.35, 1, 0.35] }}
                  transition={{ repeat: Infinity, duration: 1.4 }}
                  className="shrink-0 text-[10px] font-bold uppercase tracking-wider"
                  style={{ color: "rgb(var(--accent-rgb))" }}
                >
                  next
                </motion.span>
              )}
            </div>
          );
        })}
      </div>

      <motion.button
        whileTap={{ scale: 0.98 }}
        onClick={stamp}
        disabled={finished || !isCurrent}
        className="btn-primary w-full !py-4 text-base disabled:opacity-45"
      >
        {finished
          ? "All lines stamped"
          : !isCurrent
            ? "Press play to start"
            : "Tap here as the line starts  ·  Space"}
      </motion.button>

      <div className="flex gap-2">
        <button onClick={undo} className="btn-ghost flex-1 !py-2 text-sm">
          <Icon name="prev" size={14} /> Undo last
        </button>
        <button onClick={reset} className="btn-ghost flex-1 !py-2 text-sm">
          Start over
        </button>
      </div>

      <div className="flex gap-2 border-t border-[var(--hairline)] pt-3">
        <button onClick={onCancel} className="btn-ghost flex-1 text-sm">
          Cancel
        </button>
        <button
          onClick={() => onDone(serializeLyrics(lines))}
          disabled={done === 0}
          className="btn-primary flex-1 text-sm disabled:opacity-50"
        >
          Save timings
        </button>
      </div>
    </div>
  );
}
