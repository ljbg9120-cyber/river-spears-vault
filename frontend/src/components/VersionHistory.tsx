import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, formatDate, formatSize, formatTime, type Track } from "../lib/api";
import { usePlayer } from "../lib/store";
import { Icon, Modal, Spinner, useToast } from "./ui";

export default function VersionHistory({ track }: { track: Track }) {
  const { current, time, playAt } = usePlayer();
  const [versions, setVersions] = useState<Track[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [open, setOpen] = useState(false);
  const [a, setA] = useState("");
  const [b, setB] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    api.get<Track[]>(`/api/tracks/${track.id}/versions`).then((rows) => {
      if (cancelled) return;
      setVersions(rows);
      setA(rows[rows.length - 2]?.id ?? rows[0]?.id ?? "");
      setB(rows[rows.length - 1]?.id ?? "");
    }).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "Could not load versions.");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [track.id, reload]);

  const listening = versions.find((v) => v.id === current?.id);
  const audition = (id: string) => {
    const selected = versions.find((v) => v.id === id);
    if (selected) playAt(selected, listening ? time : 0, [selected]);
  };

  return (
    <aside className="review-panel review-versions" aria-label="Version history">
      <div className="review-section-top">
        <div>
          <p className="review-eyebrow">THE EVOLUTION</p>
          <h2>Version history</h2>
        </div>
        <span className="review-count">{loading ? "—" : versions.length}</span>
      </div>
      <p className="review-help">Keep every mix. Feedback stays with the version it belongs to.</p>
      <button className="btn-primary review-full" onClick={() => setOpen(true)}>
        <Icon name="upload" size={16} /> Upload new version
      </button>
      {loading ? <div className="review-loading"><Spinner size={20} /></div> : error ? (
        <div className="review-error" role="alert">
          <p>{error}</p><button className="btn-ghost" onClick={() => setReload((n) => n + 1)}>Try again</button>
        </div>
      ) : (
        <>
          {versions.length >= 2 && (
            <div className="review-compare">
              <div className="review-section-top"><h3>A/B listening</h3><Icon name="volume" size={16} /></div>
              <p>Switch mixes at the same timestamp.</p>
              {([{ letter: "A", value: a, set: setA }, { letter: "B", value: b, set: setB }] as const).map((slot) => (
                <div className="review-ab-row" key={slot.letter}>
                  <label htmlFor={`revision-${slot.letter}`} className="review-ab-label">{slot.letter}</label>
                  <select id={`revision-${slot.letter}`} className="field" value={slot.value} onChange={(e) => slot.set(e.target.value)}>
                    {versions.map((v) => <option key={v.id} value={v.id}>Version {v.version_number}{v.revision_note ? ` · ${v.revision_note}` : ""}</option>)}
                  </select>
                  <button className={`review-audition ${current?.id === slot.value ? "is-active" : ""}`} onClick={() => audition(slot.value)} aria-label={`Listen to comparison ${slot.letter}`}>
                    <Icon name="play" size={15} />
                  </button>
                </div>
              ))}
              <p className="review-compare-status" aria-live="polite">
                {listening ? `Listening to V${listening.version_number} · ${formatTime(time)}` : "Choose a mix and press play."}
              </p>
              {a === b && <p className="review-help">Choose different versions to compare two mixes.</p>}
              {listening && listening.id !== track.id && <Link className="review-inline-link" to={`/track/${listening.id}`}>Open V{listening.version_number} to leave feedback <Icon name="chevron" size={13} /></Link>}
            </div>
          )}
          <ol className="review-version-list">
            {[...versions].reverse().map((v, index) => (
              <li key={v.id} className={v.id === track.id ? "is-selected" : ""}>
                <div className="review-version-number">V{v.version_number}</div>
                <div className="review-version-detail">
                  <Link to={`/track/${v.id}`} className="review-version-title">{v.revision_note || (v.version_number === 1 ? "Original upload" : `Version ${v.version_number}`)}</Link>
                  <p>{formatDate(v.created_at)} · {formatTime(v.duration)}</p>
                  <div className="review-version-badges">
                    {v.id === track.id && <span>Viewing</span>}
                    {index === 0 && <span>Latest</span>}
                    {v.unresolved_comment_count > 0 && <span>{v.unresolved_comment_count} open {v.unresolved_comment_count === 1 ? "note" : "notes"}</span>}
                  </div>
                </div>
                <button className="review-icon-button" onClick={() => audition(v.id)} aria-label={`Listen to version ${v.version_number}`}><Icon name="play" size={15} /></button>
              </li>
            ))}
          </ol>
        </>
      )}
      <RevisionUpload open={open} track={track} onClose={() => setOpen(false)} />
    </aside>
  );
}

function RevisionUpload({ open, track, onClose }: { open: boolean; track: Track; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const requestRef = useRef<XMLHttpRequest | null>(null);
  const nav = useNavigate();
  const toast = useToast();
  useEffect(() => () => { requestRef.current?.abort(); }, []);

  const upload = (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || busy) return;
    const form = new FormData();
    form.append("file", file);
    form.append("revision_note", note.trim());
    const xhr = new XMLHttpRequest();
    requestRef.current = xhr;
    xhr.open("POST", `/api/tracks/${track.id}/versions`);
    xhr.withCredentials = true;
    setBusy(true);
    setProgress(0);
    setError("");
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) setProgress(event.loaded / event.total); };
    xhr.onerror = () => { setBusy(false); setError("The connection was interrupted. Check version history before trying again."); };
    xhr.onload = () => {
      setBusy(false);
      requestRef.current = null;
      let result;
      try { result = JSON.parse(xhr.responseText); } catch { setError("The server returned an unreadable response. Check version history before trying again."); return; }
      if (xhr.status < 200 || xhr.status >= 300) {
        setError(typeof result.detail === "string" ? result.detail : "The version could not be uploaded. Please try again.");
        return;
      }
      const updated = result as Track;
      onClose();
      setFile(null);
      setNote("");
      toast(`Version ${updated.version_number} is ready`);
      nav(`/track/${updated.id}`);
    };
    xhr.send(form);
  };

  return <Modal open={open} onClose={busy ? () => {} : onClose} title="Upload a new version">
    <form onSubmit={upload} className="review-upload-form">
      <p className="review-help">Add the next mix of <strong>{track.title}</strong>. Your earlier audio, share links and feedback stay intact. The new version starts private.</p>
      <label className="review-file-picker">
        <Icon name="upload" size={26} />
        <span>{file ? file.name : "Choose your audio file"}</span>
        <small>{file ? formatSize(file.size) : "WAV, MP3, FLAC, M4A, AIFF and more"}</small>
        <input type="file" aria-label="Audio file for new version" accept="audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg,.opus,.aiff,.aif,.alac,.wma" disabled={busy} onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(""); }} />
      </label>
      <label className="review-field-label">What changed?
        <textarea className="field" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} disabled={busy} placeholder="e.g. Tighter low end, new vocal take in the bridge" />
      </label>
      {error && <p className="review-error" role="alert">{error}</p>}
      {busy && <div aria-live="polite"><div className="review-progress"><span style={{ width: `${progress * 100}%` }} /></div><p className="review-help">{progress >= 1 ? "Processing audio and building the waveform…" : `Uploading · ${Math.round(progress * 100)}%`}</p></div>}
      <button className="btn-primary review-full" type="submit" disabled={!file || busy}>{busy ? <><Spinner size={16} /> Preparing version…</> : <><Icon name="upload" size={16} /> Upload version</>}</button>
    </form>
  </Modal>;
}
