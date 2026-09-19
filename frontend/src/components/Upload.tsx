/** A sequential upload queue: each file owns its progress and outcome. */
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatSize, type Track } from "../lib/api";
import { Icon, useToast } from "./ui";

type Status = "queued" | "uploading" | "processing" | "success" | "error" | "cancelled" | "uncertain";
type Job = {
  id: string;
  name: string;
  size: number;
  file?: File;
  folderId?: string | null;
  progress: number;
  status: Status;
  message?: string;
  retryable?: boolean;
  checked?: boolean;
};
const AUDIO_EXTENSIONS = ["mp3", "wav", "flac", "m4a", "aac", "ogg", "oga", "opus", "aiff", "aif", "wma", "alac", "mp4"];
const activeStatus = (status: Status) => ["queued", "uploading", "processing"].includes(status);

export default function Upload({ folderId, onDone, compact = false }: {
  folderId?: string | null;
  onDone: (tracks: Track[]) => void;
  compact?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [maxMb, setMaxMb] = useState<number | null>(null);
  const jobsRef = useRef<Job[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<{ id: string; xhr: XMLHttpRequest } | null>(null);
  const mounted = useRef(true);
  const onDoneRef = useRef(onDone);
  const toast = useToast();
  onDoneRef.current = onDone;

  const update = useCallback((change: (previous: Job[]) => Job[]) => {
    jobsRef.current = change(jobsRef.current);
    if (mounted.current) setJobs(jobsRef.current);
  }, []);
  const patch = useCallback((id: string, changes: Partial<Job>) => {
    update((previous) => previous.map((job) => job.id === id ? { ...job, ...changes } : job));
  }, [update]);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    fetch("/api/health", { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((health) => {
        if (mounted.current && Number.isFinite(health?.max_upload_mb) && health.max_upload_mb > 0) setMaxMb(health.max_upload_mb);
      }).catch(() => {});
    return () => {
      mounted.current = false;
      controller.abort();
      const xhr = activeRef.current?.xhr;
      if (xhr) {
        xhr.onload = xhr.onerror = xhr.onabort = xhr.ontimeout = null;
        xhr.upload.onprogress = xhr.upload.onload = null;
        xhr.abort();
      }
      activeRef.current = null;
    };
  }, []);

  const send = useCallback((files: File[]) => {
    const additions: Job[] = [];
    for (const file of files) {
      const duplicate = [...jobsRef.current, ...additions].some((job) =>
        activeStatus(job.status) && job.file?.name === file.name && job.file.size === file.size && job.file.lastModified === file.lastModified);
      if (duplicate) { toast(`${file.name} is already queued.`, "err"); continue; }
      const extension = file.name.split(".").pop()?.toLowerCase();
      const message = !extension || !AUDIO_EXTENSIONS.includes(extension)
        ? "Unsupported file type. Choose an audio file."
        : file.size === 0 ? "This file is empty. Choose a file with audio."
        : maxMb && file.size > maxMb * 1024 * 1024 ? `Over the ${maxMb} MB per-file limit.` : undefined;
      additions.push({
        id: crypto.randomUUID(), name: file.name, size: file.size, folderId,
        file: message ? undefined : file, progress: 0,
        status: message ? "error" : "queued", message, retryable: false,
      });
    }
    update((previous) => [...previous, ...additions]);
  }, [folderId, maxMb, toast, update]);

  // A single request at a time prevents large batches competing for memory.
  useEffect(() => {
    if (activeRef.current) return;
    const job = jobs.find((item) => item.status === "queued" && item.file);
    if (!job?.file) return;
    if (maxMb && job.size > maxMb * 1024 * 1024) {
      patch(job.id, { status: "error", message: `Over the ${maxMb} MB per-file limit.`, retryable: false, file: undefined });
      return;
    }
    const xhr = new XMLHttpRequest();
    activeRef.current = { id: job.id, xhr };
    let settled = false;
    const finish = (changes: Partial<Job>) => {
      if (settled) return;
      settled = true;
      xhr.onload = xhr.onerror = xhr.onabort = xhr.ontimeout = null;
      xhr.upload.onprogress = xhr.upload.onload = null;
      activeRef.current = null;
      patch(job.id, changes);
    };
    const uncertain = (message: string) => finish({ status: "uncertain", message, retryable: false, checked: false });
    xhr.open("POST", "/api/tracks/upload");
    xhr.withCredentials = true;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) patch(job.id, { progress: Math.min(1, event.loaded / event.total) });
    };
    xhr.upload.onload = () => patch(job.id, { status: "processing", progress: 1 });
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        let tracks: Track[];
        try {
          tracks = JSON.parse(xhr.responseText);
          if (!Array.isArray(tracks) || tracks.length !== 1 || typeof tracks[0]?.id !== "string") throw new Error();
        } catch {
          uncertain("The server replied, but completion could not be confirmed. Check your library before retrying.");
          return;
        }
        finish({ status: "success", progress: 1, message: "Added to your vault", file: undefined });
        onDoneRef.current(tracks);
      } else {
        let message = `Upload failed (${xhr.status}).`;
        try {
          const detail = JSON.parse(xhr.responseText).detail;
          if (typeof detail === "string") message = detail;
          else if (Array.isArray(detail) && detail[0]?.msg) message = detail[0].msg;
        } catch { /* Keep a useful HTTP status for non-JSON responses. */ }
        if (xhr.status >= 500 || xhr.status === 0 || xhr.status === 408) {
          uncertain(`${message} The file may have arrived. Check your library before retrying.`);
        } else finish({ status: "error", message, retryable: ![413, 415, 422].includes(xhr.status) });
      }
    };
    xhr.onerror = () => uncertain("Connection lost. The file may have arrived. Check your library before retrying.");
    xhr.ontimeout = () => uncertain("The request timed out. Check your library before retrying.");
    xhr.onabort = () => uncertain("Transfer stopped. The server may still finish this file. Check your library before retrying.");
    const form = new FormData();
    form.append("files", job.file);
    if (job.folderId) form.append("folder_id", job.folderId);
    patch(job.id, { status: "uploading", progress: 0, message: undefined });
    try { xhr.send(form); }
    catch { finish({ status: "error", message: "The upload could not start. Try again.", retryable: true }); }
  }, [jobs, maxMb, patch]);

  const busy = jobs.some((job) => activeStatus(job.status));
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  useEffect(() => {
    const over = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault(); setDragging(true);
    };
    const leave = (event: DragEvent) => { if (event.relatedTarget === null) setDragging(false); };
    const drop = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault(); setDragging(false);
      send(Array.from(event.dataTransfer.files));
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

  const cancel = (id: string) => {
    if (activeRef.current?.id === id) activeRef.current.xhr.abort();
    else patch(id, { status: "cancelled", message: "Cancelled before upload", retryable: true });
  };
  const retry = (job: Job) => {
    if (!job.file || (job.status === "uncertain" && !job.checked)) return;
    patch(job.id, { status: "queued", progress: 0, message: undefined, checked: false });
  };
  const complete = jobs.filter((job) => job.status === "success").length;
  const queued = jobs.filter((job) => job.status === "queued").length;

  return <>
    <button type="button" onClick={() => inputRef.current?.click()}
      className={`upload-dropzone card flex w-full items-center gap-4 border-dashed text-left ${compact ? "px-4 py-3" : "px-5 py-5"}`}
      style={{ borderStyle: "dashed", borderWidth: 1.5, borderColor: "#a99cff55" }}>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ background: "#a99cff18", color: "#a99cff" }}><Icon name="upload" size={20} /></span>
      <span className="min-w-0 flex-1"><span className="block font-display text-sm font-bold">{busy ? "Add more audio to the queue" : "Drop your next idea here"}</span>
        <span className="mt-1 block text-xs text-muted">Browse files · MP3, WAV, FLAC, M4A and more{maxMb ? ` · ${maxMb} MB per file` : ""}</span></span>
      <Icon name="plus" size={18} className="shrink-0 text-muted" />
    </button>
    <input ref={inputRef} type="file" accept={AUDIO_EXTENSIONS.map((extension) => `.${extension}`).join(",")} multiple hidden
      onChange={(event) => { send(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
    {jobs.length > 0 && <section className="mt-3 space-y-2" aria-label="Upload queue">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-muted">
        <span role="status">{complete} added{queued ? ` · ${queued} queued` : ""}{busy ? " · Keep this page open" : " · Uploads finished"}</span>
        <div className="flex items-center gap-3">
          {queued > 0 && <button type="button" className="hover:text-ink" onClick={() => update((previous) => previous.map((job) => job.status === "queued" ? { ...job, status: "cancelled", message: "Cancelled before upload", retryable: true } : job))}>Cancel queued</button>}
          {jobs.some((job) => !activeStatus(job.status)) && <button type="button" className="hover:text-ink" onClick={() => update((previous) => previous.filter((job) => activeStatus(job.status)))}>Dismiss finished</button>}
        </div>
      </div>
      {jobs.map((job) => <div key={job.id} className="card px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium" title={job.name}>{job.name}</p>
            <p className={`mt-1 text-xs ${job.status === "error" || job.status === "uncertain" ? "text-rose-300" : "text-muted"}`}>
              {job.status === "queued" ? "Queued" : job.status === "uploading" ? `Uploading ${Math.round(job.progress * 100)}%` : job.status === "processing" ? "Uploaded · Analysing audio…" : job.message} · {formatSize(job.size)}
            </p>
          </div>
          {activeStatus(job.status) && <button type="button" className="shrink-0 rounded-lg px-2 py-1 text-xs text-muted hover:bg-white/10 hover:text-ink" onClick={() => cancel(job.id)}>{job.status === "queued" ? "Cancel" : "Stop"}</button>}
          {(job.status === "error" || job.status === "cancelled") && job.retryable && job.file && <button type="button" className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-[#a99cff] hover:bg-white/10" onClick={() => retry(job)}>Retry</button>}
          {job.status === "success" && <Icon name="check" size={18} className="shrink-0 text-emerald-300" />}
        </div>
        {(job.status === "uploading" || job.status === "processing") && <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label={`Upload ${job.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(job.progress * 100)} aria-valuetext={job.status === "processing" ? "Upload complete; analysing audio" : undefined}>
          <div className={`h-full rounded-full bg-[#a99cff] transition-[width] ${job.status === "processing" ? "animate-pulse" : ""}`} style={{ width: `${job.progress * 100}%` }} />
        </div>}
        {job.status === "uncertain" && <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-white/10 pt-3 text-xs">
          <button type="button" className="font-semibold text-[#a99cff]" onClick={() => onDoneRef.current([])}>Refresh library</button>
          <label className="flex items-center gap-2 text-muted"><input type="checkbox" checked={!!job.checked} onChange={(event) => patch(job.id, { checked: event.target.checked })} />I checked; this file was not added</label>
          <button type="button" className="rounded-lg px-2 py-1 font-semibold text-[#a99cff] disabled:opacity-40" disabled={!job.checked} onClick={() => retry(job)}>Retry upload</button>
        </div>}
      </div>)}
    </section>}
    <AnimatePresence>{dragging && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center bg-[#101016]/90 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-4 rounded-3xl border border-[#a99cff]/40 bg-[#181820] px-12 py-10 text-[#a99cff]"><Icon name="upload" size={40} /><span className="font-display text-xl font-bold text-white">Drop audio into your vault</span></div>
    </motion.div>}</AnimatePresence>
  </>;
}
