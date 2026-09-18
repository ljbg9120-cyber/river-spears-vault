/**
 * "Sync automatically": save whatever is in the lyrics box, let the server
 * listen to the track, and hand back the same words with timings on them.
 *
 * The server reads lyrics from the database, not from this form, so the current
 * text is saved first — otherwise it would sync a stale version.
 */
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { Icon, Spinner, useToast } from "./ui";

type Job = {
  id: string;
  status: "queued" | "running" | "done" | "error";
  progress: number;
  message: string;
  result: { lyrics: string; confidence: number; lines: number } | null;
  error: string | null;
};

export default function AutoSync({
  trackId,
  lyrics,
  onSynced,
  onManual,
}: {
  trackId: string;
  lyrics: string;
  onSynced: (lyrics: string) => void;
  onManual: () => void;
}) {
  const toast = useToast();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [done, setDone] = useState<{ confidence: number; lines: number } | null>(null);
  const poll = useRef<number>();

  // Ask once whether the server can do this at all, and pick up a job that is
  // already running (someone reopened the editor mid-sync).
  useEffect(() => {
    let alive = true;
    api
      .get<{ available: boolean; job: Job | null }>(`/api/tracks/${trackId}/autosync`)
      .then((res) => {
        if (!alive) return;
        setAvailable(res.available);
        if (res.job && (res.job.status === "running" || res.job.status === "queued")) {
          setJob(res.job);
        }
      })
      .catch(() => alive && setAvailable(false));
    return () => {
      alive = false;
    };
  }, [trackId]);

  useEffect(() => {
    if (!job || job.status === "done" || job.status === "error") return;

    poll.current = window.setInterval(async () => {
      try {
        const res = await api.get<{ job: Job | null }>(
          `/api/tracks/${trackId}/autosync?job=${job.id}`,
        );
        const next = res.job;
        if (!next) return;
        setJob(next);

        if (next.status === "done" && next.result) {
          onSynced(next.result.lyrics);
          setDone({ confidence: next.result.confidence, lines: next.result.lines });
          toast(
            next.result.confidence >= 0.6
              ? "Lyrics synced to the track"
              : "Synced — check the lines it had to guess",
            next.result.confidence >= 0.6 ? "ok" : "err",
          );
        } else if (next.status === "error") {
          toast(next.error ?? "Could not sync that one", "err");
        }
      } catch {
        /* keep polling; a dropped request is not fatal */
      }
    }, 1500);

    return () => window.clearInterval(poll.current);
  }, [job, trackId, onSynced, toast]);

  const start = async () => {
    if (!lyrics.trim()) return;
    setDone(null);
    try {
      // Persist the current text first so the server syncs what is on screen.
      await api.patch(`/api/tracks/${trackId}`, { lyrics });
      const res = await api.post<{ job: Job }>(`/api/tracks/${trackId}/autosync`);
      setJob(res.job);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not start syncing", "err");
    }
  };

  const busy = job?.status === "running" || job?.status === "queued";
  const pct = Math.round((job?.progress ?? 0) * 100);

  return (
    <div className="mt-2 space-y-2">
      {available !== false && (
        <button
          type="button"
          onClick={start}
          disabled={busy || !lyrics.trim()}
          className="btn-primary w-full !py-2.5 text-sm disabled:opacity-45"
        >
          {busy ? (
            <>
              <Spinner size={15} />
              {job?.message || "Working…"} {pct}%
            </>
          ) : (
            <>
              <Icon name="sparkles" size={15} />
              Sync automatically
            </>
          )}
        </button>
      )}

      <AnimatePresence>
        {busy && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="h-1 overflow-hidden rounded-full bg-white/10">
              <motion.div
                className="h-full rounded-full"
                animate={{ width: `${Math.max(4, pct)}%` }}
                transition={{ ease: "easeOut", duration: 0.4 }}
                style={{
                  background:
                    "linear-gradient(90deg, rgb(var(--accent-rgb)), rgb(var(--accent2-rgb)))",
                }}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-muted">
              It plays the track through a transcriber and matches what it hears
              against your words. A few minutes for a long song.
            </p>
          </motion.div>
        )}

        {done && !busy && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl px-3 py-2 text-xs"
            style={{
              background:
                done.confidence >= 0.6
                  ? "rgb(var(--accent-rgb) / 0.14)"
                  : "rgba(255,84,112,0.14)",
              color: done.confidence >= 0.6 ? "rgb(var(--ink-rgb))" : "#ff8098",
            }}
          >
            {done.confidence >= 0.85
              ? `Matched every line it could — ${Math.round(done.confidence * 100)}% of ${done.lines}.`
              : done.confidence >= 0.6
                ? `Matched ${Math.round(done.confidence * 100)}% of ${done.lines} lines. The rest were spaced evenly — nudge any that drift.`
                : `Only ${Math.round(done.confidence * 100)}% of ${done.lines} lines matched. Busy mixes are hard to hear; tapping it in by hand will be quicker.`}
          </motion.p>
        )}
      </AnimatePresence>

      <button
        type="button"
        onClick={onManual}
        disabled={busy || !lyrics.trim()}
        className="btn-ghost w-full !py-2 text-xs disabled:opacity-45"
      >
        <Icon name="clock" size={13} />
        {available === false ? "Sync by tapping along" : "Or tap it in by hand"}
      </button>

      {available === false && (
        <p className="text-[11px] text-muted">
          Automatic syncing is not installed on this server.
        </p>
      )}
    </div>
  );
}
