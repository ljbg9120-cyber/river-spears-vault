/** Library rows and public listening cards share the single audio player. */
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, formatTime, TRACK_STATUSES, type Track } from "../lib/api";
import { useAuth, usePlayer } from "../lib/store";
import Cover from "./Cover";
import { Icon, useToast } from "./ui";
import Waveform from "./Waveform";

type Props = { track: Track; queue: Track[]; index?: number; shareToken?: string; selectable?: boolean; selected?: boolean; onSelect?: (id:string) => void; view?: "list" | "grid"; onUpdate?: (track:Track) => void; folderName?: string };
export default function TrackRow({track,queue,index=0,shareToken,selectable=false,selected=false,onSelect,view="list",onUpdate,folderName}:Props) {
  const { user } = useAuth();
  const player = usePlayer();
  const toast = useToast();
  const [busy,setBusy] = useState(false);
  const isOwner = user?.id === track.owner.id && !shareToken;
  const current = player.current?.id === track.id;
  const duration = current ? player.duration || track.duration : track.duration;
  const progress = current && duration > 0 ? Math.min(1,player.time/duration) : 0;
  const status = TRACK_STATUSES.find(s => s.value === track.status) ?? TRACK_STATUSES[0];
  const href = `/track/${track.id}${shareToken ? `?t=${encodeURIComponent(shareToken)}` : ""}`;
  const save = async (patch: Partial<Track>) => {
    setBusy(true);
    try { const updated = await api.patch<Track>(`/api/tracks/${track.id}`,patch); onUpdate?.(updated); }
    catch(e) {toast(e instanceof Error ? e.message : "Could not update this track","err");}
    finally {setBusy(false);}
  };
  const playButton = <button className={`track-play ${current && player.playing ? "playing" : ""}`} aria-label={current && player.playing ? `Pause ${track.title}` : `Play ${track.title}`} onClick={() => player.play(track,queue,shareToken)}><Icon name={current && player.playing ? "pause" : "play"} size={15} /></button>;
  const checkbox = selectable && <input className="track-checkbox" type="checkbox" aria-label={`Select ${track.title}`} checked={selected} onChange={() => onSelect?.(track.id)} />;
  const waveform = <Waveform peaks={track.peaks} progress={progress} height={view === "grid" ? 48 : 36} duration={duration} live={current && player.playing} onSeek={ratio => player.playAt(track,ratio*duration,queue,shareToken)} />;
  const statusControl = isOwner && onUpdate ? <select aria-label={`Status for ${track.title}`} className={`track-status status-${status.value}`} value={status.value} disabled={busy} onChange={e => void save({status:e.target.value as Track["status"]})}>{TRACK_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select> : <span className={`track-status status-${status.value}`}>{status.label}</span>;
  const actions = <div className="track-row-actions">{isOwner && onUpdate && <button className={`icon-button favorite-button ${track.is_favorite ? "is-favorite" : ""}`} aria-label={`${track.is_favorite ? "Unfavorite" : "Favorite"} ${track.title}`} aria-pressed={track.is_favorite} disabled={busy} onClick={() => void save({is_favorite:!track.is_favorite})}><Icon name="heart" size={16} filled={track.is_favorite} /></button>}<button className="icon-button queue-add" aria-label={`Add ${track.title} to queue`} title="Add to queue" onClick={() => {player.addToQueue(track,shareToken);toast(`“${track.title}” added to queue`);}}><Icon name="plus" size={17} /></button></div>;
  const meta = <><span>{folderName ?? (isOwner ? "Unfiled" : track.owner.display_name)}</span>{track.bpm && <span>{track.bpm} BPM</span>}{track.song_key && <span>{track.song_key}</span>}</>;
  return <article className={`${view === "grid" ? "track-grid-card" : "studio-track-row"} ${current ? "is-current" : ""} ${selected ? "is-selected" : ""}`}>
    {view === "grid" ? <>
      <div className="grid-track-top"><div className="flex items-center gap-3">{checkbox}<Cover url={track.cover_url || undefined} size={48} radius={10} thumb />{playButton}</div>{actions}</div>
      <div className="grid-track-title"><Link to={href}>{track.title}</Link><span className="version-pill">v{track.version_number ?? 1}</span></div>
      <div className="track-subline">{meta}</div>
      <div className="grid-waveform">{waveform}</div>
      <div className="grid-track-bottom">{!shareToken && statusControl}<span className="tabular-nums">{formatTime(duration)}</span><Link className="track-feedback-count" to={href} title="Open feedback"><Icon name="comment" size={13} />{track.unresolved_comment_count ?? track.comment_count}</Link></div>
      {track.tags.length > 0 && <div className="grid-track-tags">{track.tags.slice(0,3).map(tag => <span key={tag}>{tag}</span>)}</div>}
    </> : <>
      <div className="track-identity">{checkbox}<span className="track-number">{String(index+1).padStart(2,"0")}</span>{playButton}<span className="track-cover"><Cover url={track.cover_url || undefined} size={38} radius={8} icon={16} thumb /></span><div className="track-title-block"><div className="track-title-line"><Link to={href}>{track.title}</Link><span className="version-pill">v{track.version_number ?? 1}</span></div><div className="track-subline">{meta}</div></div></div>
      <div className="track-waveform">{waveform}</div>
      <div className="track-status-cell">{!shareToken && statusControl}</div>
      <span className="track-duration">{formatTime(duration)}</span>
      <div className="track-end"><Link to={href} className={`track-feedback-count ${track.unresolved_comment_count ? "has-notes" : ""}`} aria-label={`${track.unresolved_comment_count ?? track.comment_count} open notes on ${track.title}`}><Icon name="comment" size={14} /><span>{track.unresolved_comment_count ?? track.comment_count}</span></Link>{actions}</div>
    </>}
  </article>;
}
