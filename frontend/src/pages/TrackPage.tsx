/** A focused review room: audio, version history and actionable feedback. */
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import AutoSync from "../components/AutoSync";
import Cover from "../components/Cover";
import LyricsSync from "../components/LyricsSync";
import VersionHistory from "../components/VersionHistory";
import Waveform from "../components/Waveform";
import { Avatar, Empty, Icon, Modal, Spinner, useToast } from "../components/ui";
import { api, formatDate, formatSize, formatTime, TRACK_STATUSES, type Comment, type ShareLink, type Track, type TrackStatus } from "../lib/api";
import { parseLyrics, hasTimings } from "../lib/lyrics";
import { useAuth, usePlayer } from "../lib/store";
import "./review.css";

type FeedbackFilter = "open" | "all" | "resolved";

export default function TrackPage() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const token = params.get("t") ?? undefined;
  const at = params.get("at");
  const focusedComment = params.get("comment");
  const { user } = useAuth();
  const { current, playing, play, playAt, time, duration, seek, addToQueue } = usePlayer();
  const toast = useToast();
  const nav = useNavigate();
  const [track, setTrack] = useState<Track | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [body, setBody] = useState("");
  const [guestName, setGuestName] = useState("");
  const [pinTime, setPinTime] = useState(true);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState("");
  const [editing, setEditing] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [filter, setFilter] = useState<FeedbackFilter>("open");
  const [saving, setSaving] = useState(false);
  const [busyComments, setBusyComments] = useState<Set<string>>(new Set());
  const openedAt = useRef("");
  const suffix = token ? `?t=${encodeURIComponent(token)}` : "";
  const isCurrent = current?.id === track?.id;
  const total = isCurrent ? duration || track?.duration || 0 : track?.duration ?? 0;
  const progress = isCurrent && total > 0 ? Math.min(1, time / total) : 0;
  const isOwner = !!user && !!track && user.id === track.owner.id;
  const openCount = comments.filter((c) => !c.resolved).length;
  const shownComments = comments.filter((c) => filter === "all" || (filter === "resolved" ? c.resolved : !c.resolved));

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    setTrack(null);
    setComments([]);
    setBody("");
    setPostError("");
    setFilter(focusedComment ? "all" : "open");
    Promise.all([
      api.get<Track>(`/api/tracks/${id}${suffix}`),
      api.get<Comment[]>(`/api/tracks/${id}/comments${suffix}`),
    ]).then(([nextTrack, nextComments]) => {
      if (!cancelled) { setTrack(nextTrack); setComments(nextComments); }
    }).catch((err) => {
      if (!cancelled) setLoadError(err instanceof Error ? err.message : "Could not load this track.");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id, suffix, reload, focusedComment]);

  useEffect(() => {
    if (!track || at === null) return;
    const target = Number(at);
    const key = `${track.id}:${at}`;
    if (!Number.isFinite(target) || target < 0 || openedAt.current === key) return;
    openedAt.current = key;
    playAt(track, target, [track], token);
  }, [track, at, playAt, token]);

  useEffect(() => {
    if (!loading && focusedComment) document.getElementById(`feedback-${focusedComment}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [loading, focusedComment]);

  const postComment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!body.trim() || !track || posting) return;
    setPosting(true);
    setPostError("");
    try {
      const comment = await api.post<Comment>(`/api/tracks/${track.id}/comments${suffix}`, {
        body: body.trim(), at_sec: pinTime && isCurrent ? time : null,
        guest_name: user ? undefined : guestName.trim(),
      });
      setComments((items) => [...items, comment]);
      setBody("");
      setFilter("open");
      toast("Feedback added");
    } catch (err) { setPostError(err instanceof Error ? err.message : "Could not post feedback. Your note is still here."); }
    finally { setPosting(false); }
  };

  const mutateComment = async (comment: Comment, remove = false) => {
    if (!track || busyComments.has(comment.id)) return;
    setBusyComments((items) => new Set(items).add(comment.id));
    try {
      if (remove) {
        if (!confirm("Delete this feedback permanently?")) return;
        await api.del(`/api/tracks/${track.id}/comments/${comment.id}`);
        setComments((items) => items.filter((item) => item.id !== comment.id));
        toast("Feedback deleted");
      } else {
        const updated = await api.patch<Comment>(`/api/comments/${comment.id}`, { resolved: !comment.resolved });
        setComments((items) => items.map((item) => item.id === updated.id ? updated : item));
        toast(updated.resolved ? "Feedback resolved" : "Feedback reopened");
      }
    } catch (err) { toast(err instanceof Error ? err.message : "Could not update feedback", "err"); }
    finally { setBusyComments((items) => { const next = new Set(items); next.delete(comment.id); return next; }); }
  };

  const updateTrack = async (patch: Partial<Track>) => {
    if (!track || saving) return;
    setSaving(true);
    try { setTrack(await api.patch<Track>(`/api/tracks/${track.id}`, patch)); }
    catch (err) { toast(err instanceof Error ? err.message : "Could not save that change", "err"); }
    finally { setSaving(false); }
  };

  const toggleLike = async () => {
    if (!track || saving) return;
    setSaving(true);
    try {
      const result = await api.post<{ liked: boolean; like_count: number }>(`/api/tracks/${track.id}/like${suffix}`);
      setTrack((previous) => previous ? { ...previous, liked_by_me: result.liked, like_count: result.like_count } : previous);
    } catch (err) { toast(err instanceof Error ? err.message : "Could not update like", "err"); }
    finally { setSaving(false); }
  };

  const removeTrack = async () => {
    if (!track || !confirm(`Delete "${track.title}" version ${track.version_number || 1} permanently? Its feedback and share links will also be removed.`)) return;
    try { await api.del(`/api/tracks/${track.id}`); toast("Track deleted"); nav("/library"); }
    catch (err) { toast(err instanceof Error ? err.message : "Could not delete track", "err"); }
  };

  if (loading) return <div className="review-loading" role="status" aria-label="Loading track"><Spinner size={28} /></div>;
  if (loadError) return <Empty icon="music" title="This track could not be loaded" hint={loadError} action={<button className="btn-primary" onClick={() => setReload((n) => n + 1)}>Try again</button>} />;
  if (!track) return <Empty title="Track not found" hint="It may have been deleted or the link revoked." />;
  const lines = parseLyrics(track.lyrics);

  return <div className="review-page">
    <div className="review-breadcrumb">
      {isOwner ? <><Link to="/library">Library</Link><Icon name="chevron" size={12} /><span>Track workspace</span></> : <><Icon name="music" size={14} /><span>{track.owner.display_name} · Listening room</span></>}
      <span className="review-privacy"><Icon name={track.visibility === "public" ? "globe" : "lock"} size={12} />{track.visibility === "unlisted" ? "Link only" : track.visibility}</span>
    </div>
    <div className={`review-layout ${isOwner ? "" : "review-layout-public"}`}>
      <div className="review-main">
        <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="review-panel review-track-panel">
          <div className="review-track-heading">
            <button onClick={() => play(track, [track], token)} className="review-cover-button" aria-label={`${isCurrent && playing ? "Pause" : "Play"} ${track.title}`}>
              <Cover url={track.cover_url || undefined} radius={12} icon={28} />
              <span><Icon name={isCurrent && playing ? "pause" : "play"} size={28} /></span>
            </button>
            <div className="review-track-title">
              <p className="review-eyebrow">VERSION {track.version_number || 1}{track.revision_note ? ` / ${track.revision_note}` : " / ORIGINAL UPLOAD"}</p>
              <h1>{track.title}</h1>
              <div className="review-owner"><Avatar name={track.owner.display_name} src={track.owner.avatar_url} size={22} /><span>{track.owner.display_name}</span></div>
            </div>
            {isOwner && <button className={`review-icon-button review-favorite ${track.is_favorite ? "is-active" : ""}`} onClick={() => updateTrack({ is_favorite: !track.is_favorite })} disabled={saving} aria-label={track.is_favorite ? "Remove from favorites" : "Add to favorites"} aria-pressed={track.is_favorite}><Icon name="heart" size={21} filled={track.is_favorite} /></button>}
          </div>
          <div className="review-metadata">
            <span><Icon name="clock" size={13} />{formatTime(track.duration)}</span>
            {track.bpm && <span>{track.bpm} BPM</span>}
            {track.song_key && <span>{track.song_key}</span>}
            <span>{formatSize(track.size_bytes)}</span><span>Added {formatDate(track.created_at)}</span>
            {track.plays > 0 && <span>{track.plays} plays</span>}
          </div>
          <div className="review-waveform">
            <Waveform peaks={track.peaks} progress={progress} height={112} duration={total} comments={comments.filter((comment) => !comment.resolved)} live={isCurrent && playing}
              onSeek={(ratio) => { if (isCurrent) seek(ratio * total); else playAt(track, ratio * total, [track], token); }}
              onCommentClick={(comment) => playAt(track, comment.at_sec ?? 0, [track], token)} />
            <div className="review-waveform-caption"><span>{isCurrent ? formatTime(time) : "0:00"}</span><span>{openCount} open {openCount === 1 ? "note" : "notes"} on this version</span><span>{formatTime(total)}</span></div>
          </div>
          <div className="review-track-actions">
            <button className="btn-primary" onClick={() => play(track, [track], token)}><Icon name={isCurrent && playing ? "pause" : "play"} size={16} />{isCurrent && playing ? "Pause" : "Play track"}</button>
            {isOwner && <button className="btn-ghost" onClick={() => setShareOpen(true)}><Icon name="share" size={16} />Share</button>}
            <button className="btn-ghost" onClick={() => { addToQueue(track, token); toast("Added to queue"); }}><Icon name="plus" size={16} />Queue</button>
            {(track.allow_download || isOwner) && <a href={`/api/tracks/${track.id}/download${suffix}`} className="btn-ghost" aria-label="Download this version"><Icon name="download" size={16} /><span className="review-download-label">Download</span></a>}
            {!isOwner && user && <button onClick={toggleLike} disabled={saving} className="btn-ghost" aria-label="Like this track"><Icon name="heart" size={16} filled={track.liked_by_me} />{track.like_count || "Like"}</button>}
          </div>
          {isOwner && <div className="review-workflow">
            <label htmlFor="track-status">Production status</label>
            <select id="track-status" className={`field review-status-select status-${track.status}`} value={track.status || "demo"} onChange={(event) => updateTrack({ status: event.target.value as TrackStatus })} disabled={saving}>{TRACK_STATUSES.map((status) => <option value={status.value} key={status.value}>{status.label}</option>)}</select>
            <button className="review-text-button" onClick={() => setEditing(true)}><Icon name="edit" size={14} />Edit details</button>
          </div>}
          {track.tags.length > 0 && <div className="review-tags">{track.tags.map((tag) => <span key={tag} className="chip">{tag}</span>)}</div>}
          {track.notes && <div className="review-notes"><h3>Session notes</h3><p>{track.notes}</p></div>}
          {lines.length > 0 && <details className="review-lyrics">
            <summary>Lyrics <span>{hasTimings(lines) ? "Synced" : `${lines.length} lines`}</span></summary>
            <button onClick={() => { if (!isCurrent) play(track, [track], token); window.dispatchEvent(new CustomEvent("vault:nowplaying")); }} className="review-inline-link"><Icon name="sparkles" size={14} />{hasTimings(lines) ? "Follow along in the player" : "Open full screen"}</button>
            <div className="review-lyrics-body">{lines.map((line, index) => <div key={index}>{line.text || " "}</div>)}</div>
          </details>}
        </motion.section>

        <section className="review-panel review-feedback-panel" aria-label="Track feedback">
          <div className="review-section-top"><div><p className="review-eyebrow">MAKE THE NEXT MIX BETTER</p><h2>Feedback <span className="review-count">{comments.length}</span></h2></div>{openCount === 0 && comments.length > 0 && <span className="review-all-resolved"><Icon name="check" size={14} />All resolved</span>}</div>
          <form onSubmit={postComment} className="review-comment-form">
            {!user && <input className="field" aria-label="Your name" placeholder="Your name" value={guestName} onChange={(event) => setGuestName(event.target.value)} required maxLength={60} />}
            <label className="sr-only" htmlFor="feedback-body">Feedback on version {track.version_number || 1}</label>
            <textarea id="feedback-body" className="field" placeholder={isCurrent ? `What do you hear at ${formatTime(time)}?` : "Leave a note. Play the track to pin it to an exact moment."} value={body} onChange={(event) => setBody(event.target.value)} maxLength={2000} rows={3} disabled={posting} />
            <div className="review-form-footer"><button type="button" onClick={() => setPinTime((value) => !value)} disabled={!isCurrent || posting} className={`review-pin ${pinTime && isCurrent ? "is-active" : ""}`} aria-pressed={pinTime && isCurrent}><Icon name="clock" size={14} />{isCurrent && pinTime ? `Pinned at ${formatTime(time)}` : "Pin to timestamp"}</button><button type="submit" disabled={!body.trim() || posting} className="btn-primary">{posting ? <Spinner size={16} /> : <Icon name="plus" size={15} />}Add feedback</button></div>
            {postError && <p className="review-error" role="alert">{postError}</p>}
          </form>
          <div className="review-filter-bar" role="group" aria-label="Filter feedback">{(["open", "all", "resolved"] as const).map((value) => <button key={value} onClick={() => setFilter(value)} className={filter === value ? "is-active" : ""} aria-pressed={filter === value}>{value === "open" ? "Open" : value === "all" ? "All feedback" : "Resolved"}<span>{value === "open" ? openCount : value === "all" ? comments.length : comments.length - openCount}</span></button>)}</div>
          {shownComments.length === 0 ? <div className="review-feedback-empty"><Icon name={filter === "open" && comments.length > 0 ? "check" : "comment"} size={25} /><h3>{comments.length === 0 ? "Good feedback starts with a listen." : filter === "open" ? "Every note is taken care of." : "No resolved notes yet."}</h3><p>{comments.length === 0 ? "Share this version and bring the conversation to the exact second." : filter === "open" ? "You’re ready for the next version. All previous notes are still in All feedback." : "Resolve feedback as you work through it."}</p></div> : <div className="review-comments"><AnimatePresence initial={false}>{shownComments.map((comment) => <motion.article key={comment.id} id={`feedback-${comment.id}`} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className={`review-comment ${comment.resolved ? "is-resolved" : ""} ${focusedComment === comment.id ? "is-highlighted" : ""}`}>
            <Avatar name={comment.author_name} src={comment.author_avatar} size={32} />
            <div className="review-comment-content"><div className="review-comment-meta"><strong>{comment.author_name}</strong>{comment.is_owner && <span className="review-artist-badge">Artist</span>}<span>{formatDate(comment.created_at)}</span>{comment.resolved && <span className="review-resolved-badge"><Icon name="check" size={12} />Resolved</span>}</div><p>{comment.body}</p><div className="review-comment-bottom">
              {comment.at_sec !== null ? <button className="review-timestamp" onClick={() => playAt(track, comment.at_sec!, [track], token)}><Icon name="play" size={11} />{formatTime(comment.at_sec)}</button> : <span className="review-general-note">General note</span>}
              {isOwner && <button className="review-resolve" disabled={busyComments.has(comment.id)} onClick={() => mutateComment(comment)}>{busyComments.has(comment.id) ? <Spinner size={13} /> : <Icon name={comment.resolved ? "plus" : "check"} size={14} />}{comment.resolved ? "Reopen" : "Resolve"}</button>}
              {(isOwner || (user && comment.author_handle === user.handle)) && <button className="review-icon-button review-delete-comment" onClick={() => mutateComment(comment, true)} disabled={busyComments.has(comment.id)} aria-label={`Delete feedback from ${comment.author_name}`}><Icon name="trash" size={14} /></button>}
            </div></div>
          </motion.article>)}</AnimatePresence></div>}
        </section>
        {isOwner && <div className="review-track-footer"><span>Changes saved to your private vault.</span><button className="review-text-button review-danger" onClick={removeTrack}><Icon name="trash" size={13} />Delete this version</button></div>}
      </div>
      {isOwner && <VersionHistory track={{ ...track, unresolved_comment_count: openCount }} />}
    </div>
    {isOwner && <><EditModal key={track.id} open={editing} onClose={() => setEditing(false)} track={track} onSaved={(updated) => { setTrack(updated); toast("Track details saved"); }} /><ShareModal key={`share-${track.id}`} open={shareOpen} onClose={() => setShareOpen(false)} track={track} /></>}
  </div>;
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

