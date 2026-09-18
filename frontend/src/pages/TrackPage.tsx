/** One track, full size: big waveform, timestamped feedback, share controls. */
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import AutoSync from "../components/AutoSync";
import Cover from "../components/Cover";
import LyricsSync from "../components/LyricsSync";
import Waveform from "../components/Waveform";
import { Avatar, Empty, Icon, Modal, Spinner, useToast } from "../components/ui";
import {
  api,
  formatDate,
  formatSize,
  formatTime,
  type Comment,
  type ShareLink,
  type Track,
} from "../lib/api";
import { parseLyrics, hasTimings } from "../lib/lyrics";
import { useAuth, usePlayer } from "../lib/store";

export default function TrackPage() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const token = params.get("t") ?? undefined;
  const { user } = useAuth();
  const { current, playing, play, time, duration, seek } = usePlayer();
  const toast = useToast();
  const nav = useNavigate();

  const [track, setTrack] = useState<Track | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [guestName, setGuestName] = useState("");
  const [pinTime, setPinTime] = useState(true);
  const [editing, setEditing] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const suffix = token ? `?t=${token}` : "";
  const isCurrent = current?.id === track?.id;
  const total = isCurrent ? duration || track?.duration || 0 : track?.duration ?? 0;
  const progress = isCurrent && total > 0 ? Math.min(1, time / total) : 0;
  const isOwner = !!user && !!track && user.id === track.owner.id;

  const load = useCallback(async () => {
    if (!id) return;
    const [t, c] = await Promise.all([
      api.get<Track>(`/api/tracks/${id}${suffix}`),
      api.get<Comment[]>(`/api/tracks/${id}/comments${suffix}`),
    ]);
    setTrack(t);
    setComments(c);
  }, [id, suffix]);

  useEffect(() => {
    setLoading(true);
    load()
      .catch(() => toast("Could not load that track", "err"))
      .finally(() => setLoading(false));
  }, [load, toast]);

  const postComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim() || !track) return;
    try {
      const c = await api.post<Comment>(`/api/tracks/${track.id}/comments${suffix}`, {
        body: body.trim(),
        at_sec: pinTime && isCurrent ? time : null,
        guest_name: user ? undefined : guestName.trim(),
      });
      setComments((cs) => [...cs, c]);
      setBody("");
      toast("Feedback added");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not post that", "err");
    }
  };

  const removeComment = async (c: Comment) => {
    if (!track) return;
    await api.del(`/api/tracks/${track.id}/comments/${c.id}`);
    setComments((cs) => cs.filter((x) => x.id !== c.id));
  };

  const toggleLike = async () => {
    if (!track) return;
    const res = await api.post<{ liked: boolean; like_count: number }>(
      `/api/tracks/${track.id}/like${suffix}`,
    );
    setTrack({ ...track, liked_by_me: res.liked, like_count: res.like_count });
  };

  const removeTrack = async () => {
    if (!track || !confirm(`Delete "${track.title}" permanently?`)) return;
    await api.del(`/api/tracks/${track.id}`);
    toast("Track deleted");
    nav("/library");
  };

  if (loading) {
    return (
      <div className="flex justify-center py-32 text-muted">
        <Spinner size={28} />
      </div>
    );
  }

  if (!track) {
    return <Empty title="Track not found" hint="It may have been deleted or the link revoked." />;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="card p-5 sm:p-7">
        <div className="flex items-start gap-4">
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={() => play(track, [track], token)}
            className="group relative h-16 w-16 shrink-0 sm:h-20 sm:w-20"
            style={{ boxShadow: "0 14px 40px -14px rgb(var(--accent-rgb))" }}
            aria-label={isCurrent && playing ? "Pause" : "Play"}
          >
            <Cover url={track.cover_url || undefined} radius={16} icon={28} />
            <span className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/35 text-white transition group-hover:bg-black/50">
              <Icon name={isCurrent && playing ? "pause" : "play"} size={28} />
            </span>
          </motion.button>

          <div className="min-w-0 flex-1">
            <h1 className="title-xl truncate text-2xl sm:text-3xl">{track.title}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
              <span className="flex items-center gap-1.5">
                <Avatar name={track.owner.display_name} src={track.owner.avatar_url} size={20} />
                {track.owner.display_name}
              </span>
              <span className="font-mono">{formatTime(track.duration)}</span>
              {track.bpm && <span className="font-mono">{track.bpm} BPM</span>}
              {track.song_key && <span className="font-mono">{track.song_key}</span>}
              <span>{formatDate(track.created_at)}</span>
              <span>{formatSize(track.size_bytes)}</span>
              {track.plays > 0 && <span>{track.plays} plays</span>}
            </div>
          </div>
        </div>

        <div className="mt-5">
          <Waveform
            peaks={track.peaks}
            progress={progress}
            height={110}
            duration={total}
            comments={comments}
            live={isCurrent && playing}
            onSeek={(r) => {
              if (!isCurrent) play(track, [track], token);
              seek(r * total);
            }}
            onCommentClick={(c) => {
              if (!isCurrent) play(track, [track], token);
              if (c.at_sec !== null) seek(c.at_sec);
            }}
          />
        </div>

        {track.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {track.tags.map((t) => (
              <span key={t} className="chip">
                <Icon name="tag" size={11} />
                {t}
              </span>
            ))}
          </div>
        )}

        {track.notes && (
          <p className="mt-4 whitespace-pre-wrap rounded-2xl bg-white/5 p-4 text-sm leading-relaxed text-muted">
            {track.notes}
          </p>
        )}

        {(() => {
          const lines = parseLyrics(track.lyrics);
          if (lines.length === 0) return null;
          return (
            <div className="mt-4 rounded-2xl bg-white/5 p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted">
                  Lyrics
                </h2>
                <button
                  onClick={() => {
                    if (!isCurrent) play(track, [track], token);
                    window.dispatchEvent(new CustomEvent("vault:nowplaying"));
                  }}
                  className="chip chip-on"
                >
                  <Icon name="sparkles" size={12} />
                  {hasTimings(lines) ? "Follow along" : "Full screen"}
                </button>
              </div>
              <div className="max-h-56 overflow-y-auto text-sm leading-relaxed text-muted">
                {lines.map((l, i) => (
                  <div key={i}>{l.text || " "}</div>
                ))}
              </div>
            </div>
          );
        })()}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {user && (
            <button onClick={toggleLike} className="btn-ghost !px-4 !py-2 text-sm">
              <span style={{ color: track.liked_by_me ? "rgb(var(--accent-rgb))" : undefined }}>
                <Icon name="heart" size={15} filled={track.liked_by_me} />
              </span>
              {track.like_count > 0 ? track.like_count : "Like"}
            </button>
          )}
          {isOwner && (
            <>
              <button onClick={() => setShareOpen(true)} className="btn-primary !px-4 !py-2 text-sm">
                <Icon name="share" size={15} /> Share
              </button>
              <button onClick={() => setEditing(true)} className="btn-ghost !px-4 !py-2 text-sm">
                <Icon name="edit" size={15} /> Edit
              </button>
              <button
                onClick={removeTrack}
                className="btn-ghost !px-4 !py-2 text-sm"
                style={{ color: "#ff8098" }}
              >
                <Icon name="trash" size={15} />
              </button>
            </>
          )}
          {(track.allow_download || isOwner) && (
            <a
              href={`/api/tracks/${track.id}/download${suffix}`}
              className="btn-ghost !px-4 !py-2 text-sm"
            >
              <Icon name="download" size={15} /> Download
            </a>
          )}
        </div>
      </motion.div>

      {/* --------------------------- comments --------------------------- */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
        className="card mt-4 p-5 sm:p-6"
      >
        <h2 className="mb-4 font-display text-lg font-bold">
          Feedback {comments.length > 0 && <span className="text-muted">({comments.length})</span>}
        </h2>

        <form onSubmit={postComment} className="mb-5 space-y-2">
          {!user && (
            <input
              className="field"
              placeholder="Your name"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              required
              maxLength={60}
            />
          )}
          <textarea
            className="field min-h-[80px] resize-y"
            placeholder={
              isCurrent
                ? `Say something about ${formatTime(time)}…`
                : "Play the track to pin a note to the exact second…"
            }
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={2000}
          />
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setPinTime((v) => !v)}
              disabled={!isCurrent}
              className={`chip ${pinTime && isCurrent ? "chip-on" : ""} disabled:opacity-40`}
            >
              <Icon name="clock" size={12} />
              {isCurrent ? `Pin to ${formatTime(time)}` : "Pin to time"}
            </button>
            <button type="submit" disabled={!body.trim()} className="btn-primary !px-5 !py-2 text-sm disabled:opacity-50">
              Post
            </button>
          </div>
        </form>

        {comments.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">
            No feedback yet. Share a link and the notes land here.
          </p>
        ) : (
          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {comments.map((c) => (
                <motion.div
                  key={c.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -12 }}
                  className="group flex gap-3 rounded-2xl p-3 transition hover:bg-white/5"
                >
                  <Avatar name={c.author_name} src={c.author_avatar} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{c.author_name}</span>
                      {c.is_owner && (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase"
                          style={{
                            background: "rgb(var(--accent-rgb) / 0.2)",
                            color: "rgb(var(--accent-rgb))",
                          }}
                        >
                          artist
                        </span>
                      )}
                      {c.at_sec !== null && (
                        <button
                          onClick={() => {
                            if (!isCurrent) play(track, [track], token);
                            seek(c.at_sec!);
                          }}
                          className="font-mono text-xs transition hover:underline"
                          style={{ color: "rgb(var(--accent2-rgb))" }}
                        >
                          {formatTime(c.at_sec)}
                        </button>
                      )}
                      <span className="text-xs text-muted">{formatDate(c.created_at)}</span>
                    </div>
                    <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed">
                      {c.body}
                    </p>
                  </div>
                  {(isOwner || (user && c.author_handle === user.handle)) && (
                    <button
                      onClick={() => removeComment(c)}
                      className="self-start rounded-lg p-1.5 text-muted opacity-0 transition hover:text-ink group-hover:opacity-100"
                      aria-label="Delete comment"
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </motion.div>

      {isOwner && (
        <>
          <EditModal
            open={editing}
            onClose={() => setEditing(false)}
            track={track}
            onSaved={(t) => {
              setTrack(t);
              toast("Saved");
            }}
          />
          <ShareModal open={shareOpen} onClose={() => setShareOpen(false)} track={track} />
        </>
      )}
    </div>
  );
}

function EditModal({
  open,
  onClose,
  track,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  track: Track;
  onSaved: (t: Track) => void;
}) {
  const [title, setTitle] = useState(track.title);
  const [notes, setNotes] = useState(track.notes);
  const [bpm, setBpm] = useState(track.bpm?.toString() ?? "");
  const [songKey, setSongKey] = useState(track.song_key ?? "");
  const [tags, setTags] = useState(track.tags.join(", "));
  const [lyrics, setLyrics] = useState(track.lyrics ?? "");
  const [syncing, setSyncing] = useState(false);
  const [visibility, setVisibility] = useState(track.visibility);
  const [allowDownload, setAllowDownload] = useState(track.allow_download);

  const save = async () => {
    const updated = await api.patch<Track>(`/api/tracks/${track.id}`, {
      title: title.trim() || track.title,
      notes,
      bpm: bpm ? Number(bpm) : null,
      song_key: songKey.trim() || null,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      lyrics,
      visibility,
      allow_download: allowDownload,
    });
    onSaved(updated);
    onClose();
  };

  if (syncing) {
    return (
      <Modal open={open} onClose={() => setSyncing(false)} title="Tap to sync" width={560}>
        <LyricsSync
          track={track}
          text={lyrics}
          onCancel={() => setSyncing(false)}
          onDone={(synced) => {
            setLyrics(synced);
            setSyncing(false);
          }}
        />
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title="Edit track">
      <div className="space-y-3">
        <Labelled label="Title">
          <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Labelled>
        <div className="grid grid-cols-2 gap-3">
          <Labelled label="BPM">
            <input
              className="field"
              type="number"
              min={20}
              max={400}
              value={bpm}
              onChange={(e) => setBpm(e.target.value)}
              placeholder="140"
            />
          </Labelled>
          <Labelled label="Key">
            <input
              className="field"
              value={songKey}
              onChange={(e) => setSongKey(e.target.value)}
              placeholder="F#m"
            />
          </Labelled>
        </div>
        <Labelled label="Tags (comma separated)">
          <input
            className="field"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="demo, needs mix, sent to Jae"
          />
        </Labelled>
        <Labelled label="Notes">
          <textarea
            className="field min-h-[90px] resize-y"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What needs doing to this one?"
          />
        </Labelled>
        <Labelled label="Lyrics">
          <textarea
            className="field min-h-[120px] resize-y font-mono text-[13px]"
            value={lyrics}
            onChange={(e) => setLyrics(e.target.value)}
            placeholder="Paste the words, one line per line. Then hit Sync automatically and they will scroll with the song."
          />
          <AutoSync
            trackId={track.id}
            lyrics={lyrics}
            onSynced={setLyrics}
            onManual={() => setSyncing(true)}
          />
        </Labelled>
        <Labelled label="Who can hear it">
          <div className="grid grid-cols-3 gap-2">
            {(["private", "unlisted", "public"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setVisibility(v)}
                className="card flex flex-col items-center gap-1 px-2 py-3 text-xs capitalize"
                style={{
                  borderColor: visibility === v ? "rgb(var(--accent-rgb))" : undefined,
                  background: visibility === v ? "rgb(var(--accent-rgb) / 0.12)" : undefined,
                }}
              >
                <Icon name={v === "private" ? "lock" : v === "unlisted" ? "link" : "globe"} size={15} />
                {v === "unlisted" ? "link only" : v}
              </button>
            ))}
          </div>
        </Labelled>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={allowDownload}
            onChange={(e) => setAllowDownload(e.target.checked)}
          />
          Let listeners download the file
        </label>
        <button onClick={save} className="btn-primary w-full">
          Save changes
        </button>
      </div>
    </Modal>
  );
}

function ShareModal({
  open,
  onClose,
  track,
}: {
  open: boolean;
  onClose: () => void;
  track: Track;
}) {
  const toast = useToast();
  const [link, setLink] = useState<ShareLink | null>(null);
  const [allowDownload, setAllowDownload] = useState(false);
  const [allowComments, setAllowComments] = useState(true);
  const [expires, setExpires] = useState<number | "">("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      setLink(
        await api.post<ShareLink>("/api/shares", {
          track_id: track.id,
          allow_download: allowDownload,
          allow_comments: allowComments,
          expires_in_days: expires === "" ? null : expires,
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link.url);
    toast("Link copied");
  };

  return (
    <Modal open={open} onClose={onClose} title="Share this track">
      {link ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <input className="field font-mono text-xs" readOnly value={link.url} />
            <button onClick={copy} className="btn-primary shrink-0 !px-4">
              <Icon name="link" size={15} /> Copy
            </button>
          </div>
          <p className="text-xs text-muted">
            Anyone with this link can listen — no account needed. Revoke it any time from
            the Links page.
          </p>
          <button
            onClick={() => setLink(null)}
            className="btn-ghost w-full text-sm"
          >
            Make another link
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <label className="flex items-center justify-between gap-4 text-sm">
            Let them download the file
            <input
              type="checkbox"
              checked={allowDownload}
              onChange={(e) => setAllowDownload(e.target.checked)}
            />
          </label>
          <label className="flex items-center justify-between gap-4 text-sm">
            Let them leave feedback
            <input
              type="checkbox"
              checked={allowComments}
              onChange={(e) => setAllowComments(e.target.checked)}
            />
          </label>
          <Labelled label="Expires">
            <select
              className="field"
              value={expires}
              onChange={(e) => setExpires(e.target.value === "" ? "" : Number(e.target.value))}
            >
              <option value="" style={{ color: "#111" }}>Never</option>
              {[1, 7, 30, 90].map((d) => (
                <option key={d} value={d} style={{ color: "#111" }}>
                  In {d} day{d > 1 ? "s" : ""}
                </option>
              ))}
            </select>
          </Labelled>
          <button onClick={create} disabled={busy} className="btn-primary w-full">
            {busy ? <Spinner size={16} /> : "Create link"}
          </button>
        </div>
      )}
    </Modal>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}
