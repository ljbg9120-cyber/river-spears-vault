/** Drag-and-drop upload with real progress. Drop as many files as you like. */
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Track } from "../lib/api";
import { formatSize } from "../lib/api";
import { Icon, useToast } from "./ui";

type Job = { name: string; size: number; progress: number; error?: string };

export default function Upload({
  folderId,
  onDone,
}: {
  folderId?: string | null;
  onDone: (tracks: Track[]) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const send = useCallback(
    (files: File[]) => {
      if (!files.length) return;
      setJobs(files.map((f) => ({ name: f.name, size: f.size, progress: 0 })));

      const form = new FormData();
      files.forEach((f) => form.append("files", f));
      if (folderId) form.append("folder_id", folderId);

      // XHR rather than fetch: it is the only way to get upload progress.
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/tracks/upload");
      xhr.withCredentials = true;

      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const pct = e.loaded / e.total;
        setJobs((js) => js.map((j) => ({ ...j, progress: pct })));
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const tracks: Track[] = JSON.parse(xhr.responseText);
          setJobs((js) => js.map((j) => ({ ...j, progress: 1 })));
          toast(
            tracks.length === 1
              ? `"${tracks[0].title}" is in your vault`
              : `${tracks.length} tracks added`,
          );
          onDone(tracks);
          setTimeout(() => setJobs([]), 900);
        } else {
          let detail = "Upload failed.";
          try {
            detail = JSON.parse(xhr.responseText).detail ?? detail;
          } catch {
            /* keep the default */
          }
          setJobs((js) => js.map((j) => ({ ...j, error: detail })));
          toast(detail, "err");
          setTimeout(() => setJobs([]), 4000);
        }
      };

      xhr.onerror = () => {
        setJobs((js) => js.map((j) => ({ ...j, error: "Connection lost." })));
        toast("Upload failed — connection lost.", "err");
        setTimeout(() => setJobs([]), 4000);
      };

      xhr.send(form);
    },
    [folderId, onDone, toast],
  );

  // Dropping anywhere on the page works, not just on the dashed box.
  useEffect(() => {
    const over = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer?.types.includes("Files")) setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) send(files);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [send]);

  const busy = jobs.length > 0;

  return (
    <>
      <motion.button
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="card flex w-full items-center gap-4 border-dashed px-5 py-4 text-left disabled:opacity-60"
        style={{ borderStyle: "dashed", borderWidth: 1.5 }}
      >
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
          style={{
            background: "rgb(var(--accent-rgb) / 0.14)",
            color: "rgb(var(--accent-rgb))",
          }}
        >
          <Icon name="upload" size={20} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-sm font-bold">
            Drop audio here, or click to browse
          </span>
          <span className="block text-xs text-muted">
            MP3, WAV, FLAC, M4A, AIFF and more — as many as you want, always free
          </span>
        </span>
      </motion.button>

      <input
        ref={inputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg,.opus,.aiff,.aif,.alac"
        multiple
        hidden
        onChange={(e) => {
          send(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />

      <AnimatePresence>
        {jobs.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-3 space-y-2 overflow-hidden"
          >
            {jobs.map((j, i) => (
              <div key={i} className="card px-4 py-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate font-medium">{j.name}</span>
                  <span className="shrink-0 text-xs text-muted">
                    {j.error ? j.error : `${Math.round(j.progress * 100)}% · ${formatSize(j.size)}`}
                  </span>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
                  <motion.div
                    className="h-full rounded-full"
                    animate={{ width: `${j.progress * 100}%` }}
                    transition={{ ease: "easeOut", duration: 0.25 }}
                    style={{
                      background: j.error
                        ? "#ff5470"
                        : "linear-gradient(90deg, rgb(var(--accent-rgb)), rgb(var(--accent2-rgb)))",
                    }}
                  />
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Full-screen drop veil */}
      <AnimatePresence>
        {dragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center backdrop-blur-sm"
            style={{ background: "rgb(var(--accent-rgb) / 0.14)" }}
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              className="glass-strong flex flex-col items-center gap-3 rounded-3xl px-12 py-10"
            >
              <motion.span
                animate={{ y: [0, -8, 0] }}
                transition={{ repeat: Infinity, duration: 1.4 }}
                style={{ color: "rgb(var(--accent-rgb))" }}
              >
                <Icon name="upload" size={40} />
              </motion.span>
              <span className="font-display text-xl font-bold">Drop it in the vault</span>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
