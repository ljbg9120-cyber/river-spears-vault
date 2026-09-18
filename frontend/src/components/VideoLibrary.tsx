/**
 * Upload clips and pick one to run as the visualizer.
 *
 * Anything a browser cannot play is converted server-side, so a clip can land
 * in "processing" for a while — those tiles poll until they are ready rather
 * than pretending to be selectable.
 */
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, formatSize, formatTime, type Theme, type VideoLoop } from "../lib/api";
import { Icon, Spinner, useToast } from "./ui";

export default function VideoLibrary({
  theme,
  onPick,
}: {
  theme: Theme;
  onPick: (patch: Partial<Theme>) => void;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [videos, setVideos] = useState<VideoLoop[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<{ name: string; pct: number } | null>(null);

  const load = useCallback(async () => {
    setVideos(await api.get<VideoLoop[]>("/api/videos"));
  }, []);

  useEffect(() => {
    load()
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [load]);

  // Keep checking while anything is still converting.
  useEffect(() => {
    if (!videos.some((v) => v.status === "processing")) return;
    const id = window.setInterval(() => {
      load().catch(() => {});
    }, 2500);
    return () => window.clearInterval(id);
  }, [videos, load]);

  const upload = (file: File) => {
    setUploading({ name: file.name, pct: 0 });
    const form = new FormData();
    form.append("file", file);

    // XHR, because fetch cannot report upload progress and these are big.
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/videos");
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        setUploading({ name: file.name, pct: e.loaded / e.total });
      }
    };
    xhr.onload = () => {
      setUploading(null);
      if (xhr.status >= 200 && xhr.status < 300) {
        const created: VideoLoop = JSON.parse(xhr.responseText);
        load().catch(() => {});
        toast(
          created.status === "processing"
            ? "Uploaded — converting it for the browser"
            : `"${created.name}" ready`,
        );
        if (created.status === "ready") {
          onPick({ visualizer: "video", video_id: created.id });
        }
      } else {
        let detail = "Upload failed.";
        try {
          detail = JSON.parse(xhr.responseText).detail ?? detail;
        } catch {
          /* keep the default */
        }
        toast(detail, "err");
      }
    };
    xhr.onerror = () => {
      setUploading(null);
      toast("Upload failed — connection lost.", "err");
    };
    xhr.send(form);
  };

  const remove = async (clip: VideoLoop) => {
    if (!confirm(`Delete "${clip.name}"?`)) return;
    await api.del(`/api/videos/${clip.id}`);
    setVideos((v) => v.filter((x) => x.id !== clip.id));
    if (theme.video_id === clip.id) onPick({ visualizer: "bars", video_id: null });
    toast("Clip deleted");
  };

  const usingVideo = theme.visualizer === "video";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={!!uploading}
          className="btn-ghost !px-4 !py-2 text-sm disabled:opacity-50"
        >
          <Icon name="upload" size={15} />
          {uploading ? "Uploading…" : "Upload a clip"}
        </button>
        <span className="text-xs text-muted">
          MP4, WEBM or MOV · up to 400 MB · sound is stripped
        </span>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.m4v,.mkv"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload(file);
          e.target.value = "";
        }}
      />

      <AnimatePresence>
        {uploading && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="truncate">{uploading.name}</span>
              <span className="shrink-0 text-muted">
                {Math.round(uploading.pct * 100)}%
              </span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10">
              <motion.div
                className="h-full rounded-full"
                animate={{ width: `${uploading.pct * 100}%` }}
                style={{
                  background:
                    "linear-gradient(90deg, rgb(var(--accent-rgb)), rgb(var(--accent2-rgb)))",
                }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="flex justify-center py-6 text-muted">
          <Spinner size={20} />
        </div>
      ) : videos.length === 0 ? (
        <p className="rounded-2xl px-4 py-5 text-center text-sm text-muted"
           style={{ background: "var(--panel)" }}>
          No clips yet. Upload one and it plays behind your music — on the lyrics
          screen and in the player.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
          {videos.map((clip) => {
            const active = usingVideo && theme.video_id === clip.id;
            const busy = clip.status === "processing";
            const broken = clip.status === "error";
            return (
              <motion.div
                key={clip.id}
                layout
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="card group relative overflow-hidden p-2"
                style={{
                  borderColor: active ? "rgb(var(--accent-rgb))" : undefined,
                  boxShadow: active ? "0 0 30px -10px rgb(var(--accent-rgb))" : undefined,
                }}
              >
                <button
                  onClick={() =>
                    !busy && !broken &&
                    onPick({ visualizer: "video", video_id: clip.id })
                  }
                  disabled={busy || broken}
                  className="block w-full text-left"
                >
                  <span
                    className="relative flex h-24 w-full items-center justify-center overflow-hidden rounded-lg"
                    style={{ background: "#0b0a12" }}
                  >
                    {clip.poster_url ? (
                      <img
                        src={clip.poster_url}
                        alt=""
                        className="h-full w-full object-cover"
                        style={{ opacity: busy ? 0.4 : 1 }}
                      />
                    ) : (
                      <Icon name="music" size={22} />
                    )}
                    {busy && (
                      <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-[11px] text-white">
                        <Spinner size={16} />
                        converting
                      </span>
                    )}
                    {broken && (
                      <span className="absolute inset-0 flex items-center justify-center px-2 text-center text-[10px]"
                            style={{ background: "rgba(255,84,112,0.25)", color: "#ffb4c2" }}>
                        could not convert
                      </span>
                    )}
                    {active && (
                      <span
                        className="absolute right-1.5 top-1.5 rounded-full p-1 text-white"
                        style={{ background: "rgb(var(--accent-rgb))" }}
                      >
                        <Icon name="check" size={11} />
                      </span>
                    )}
                  </span>

                  <span className="mt-1.5 block truncate font-display text-[12px] font-bold">
                    {clip.name}
                  </span>
                  <span className="block text-[10px] text-muted">
                    {clip.duration > 0 && `${formatTime(clip.duration)} · `}
                    {clip.width > 0 && `${clip.width}×${clip.height} · `}
                    {formatSize(clip.size_bytes)}
                  </span>
                </button>

                <button
                  onClick={() => remove(clip)}
                  className="absolute left-3 top-3 rounded-full p-1 text-white opacity-0 transition group-hover:opacity-100"
                  style={{ background: "rgba(0,0,0,0.6)" }}
                  aria-label={`Delete ${clip.name}`}
                >
                  <Icon name="trash" size={12} />
                </button>
              </motion.div>
            );
          })}
        </div>
      )}

      {usingVideo && theme.video_id && (
        <div className="space-y-4 rounded-2xl p-4" style={{ background: "var(--panel)" }}>
          <div>
            <p className="mb-2 text-sm font-semibold">How it fills the screen</p>
            <div className="glass inline-flex rounded-xl p-1">
              {(["cover", "contain"] as const).map((fit) => (
                <button
                  key={fit}
                  onClick={() => onPick({ video_fit: fit })}
                  className="rounded-lg px-4 py-1.5 text-sm font-medium capitalize transition"
                  style={{
                    background:
                      theme.video_fit === fit
                        ? "rgb(var(--accent-rgb) / 0.22)"
                        : "transparent",
                    color:
                      theme.video_fit === fit
                        ? "rgb(var(--ink-rgb))"
                        : "rgb(var(--muted-rgb))",
                  }}
                >
                  {fit === "cover" ? "Fill" : "Fit"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-sm font-semibold">Darken</span>
              <span className="font-mono text-xs text-muted">
                {Math.round(theme.video_dim * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={theme.video_dim}
              onChange={(e) => onPick({ video_dim: Number(e.target.value) })}
              className="w-full"
              aria-label="Darken the video"
            />
            <p className="mt-1 text-xs text-muted">
              Turn this up if the clip is fighting your lyrics.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
