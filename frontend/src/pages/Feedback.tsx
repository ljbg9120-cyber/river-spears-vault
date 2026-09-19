import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Cover from "../components/Cover";
import { Avatar, Empty, Icon, Spinner, useToast } from "../components/ui";
import { api, formatDate, formatTime, type Comment, type FeedbackItem } from "../lib/api";
import "./review.css";

type Filter = "open" | "all" | "resolved";
const PAGE_SIZE = 100;

export default function Feedback() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [filter, setFilter] = useState<Filter>("open");
  const [search, setSearch] = useState("");
  const [trackFilter, setTrackFilter] = useState("");
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    api.get<FeedbackItem[]>(`/api/feedback?limit=${PAGE_SIZE}`).then((result) => {
      if (!cancelled) { setItems(result); setHasMore(result.length === PAGE_SIZE); }
    }).catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Could not load feedback."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reload]);

  const loadMore = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await api.get<FeedbackItem[]>(`/api/feedback?limit=${PAGE_SIZE}&offset=${items.length}`);
      setItems((previous) => [...previous, ...next.filter((item) => !previous.some((other) => other.id === item.id))]);
      setHasMore(next.length === PAGE_SIZE);
    } catch (err) { toast(err instanceof Error ? err.message : "Could not load more feedback", "err"); }
    finally { setLoadingMore(false); }
  };

  const resolve = async (item: FeedbackItem) => {
    if (busy.has(item.id)) return;
    setBusy((previous) => new Set(previous).add(item.id));
    try {
      const saved = await api.patch<Comment>(`/api/comments/${item.id}`, { resolved: !item.resolved });
      setItems((previous) => previous.map((other) => other.id === item.id ? { ...other, ...saved } : other));
      toast(saved.resolved ? "Feedback resolved" : "Feedback reopened");
    } catch (err) { toast(err instanceof Error ? err.message : "Could not update feedback", "err"); }
    finally { setBusy((previous) => { const next = new Set(previous); next.delete(item.id); return next; }); }
  };

  const counts = useMemo(() => ({ open: items.filter((item) => !item.resolved).length, resolved: items.filter((item) => item.resolved).length, tracks: new Set(items.filter((item) => !item.resolved).map((item) => item.track_id)).size }), [items]);
  const tracks = useMemo(() => Array.from(new Map(items.map((item) => [item.track_id, { title: item.track_title, version: item.version_number }]))).sort((a, b) => a[1].title.localeCompare(b[1].title)), [items]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return items.filter((item) => (filter === "all" || (filter === "resolved" ? item.resolved : !item.resolved))
      && (!trackFilter || item.track_id === trackFilter)
      && (!needle || [item.body, item.author_name, item.track_title].some((value) => value.toLocaleLowerCase().includes(needle))));
  }, [items, filter, search, trackFilter]);

  return <div className="review-page review-inbox">
    <header className="review-inbox-heading"><div><p className="review-eyebrow">YOUR NEXT GREAT MIX STARTS HERE</p><h1>Feedback inbox<span>.</span></h1><p>Every listening note, in one place. Hear the moment. Make the change.</p></div><button className="btn-ghost" onClick={() => setReload((value) => value + 1)} disabled={loading}><Icon name="comment" size={16} />Refresh</button></header>
    <div className="review-inbox-stats" aria-label="Feedback summary">
      <div><span className="review-stat-icon"><Icon name="comment" size={18} /></span><div><strong>{loading ? "—" : counts.open}</strong><p>Open notes</p></div></div>
      <div><span className="review-stat-icon"><Icon name="music" size={18} /></span><div><strong>{loading ? "—" : counts.tracks}</strong><p>Versions to revisit</p></div></div>
      <div><span className="review-stat-icon review-stat-complete"><Icon name="check" size={18} /></span><div><strong>{loading ? "—" : counts.resolved}</strong><p>Resolved notes</p></div></div>
    </div>
    <section className="review-panel review-inbox-panel" aria-label="Feedback inbox">
      <div className="review-inbox-tools"><div className="review-filter-bar" role="group" aria-label="Feedback status">{(["open", "all", "resolved"] as const).map((value) => <button key={value} className={filter === value ? "is-active" : ""} onClick={() => setFilter(value)} aria-pressed={filter === value}>{value === "open" ? "Open" : value === "all" ? "All feedback" : "Resolved"}<span>{value === "open" ? counts.open : value === "resolved" ? counts.resolved : items.length}</span></button>)}</div><label className="review-inbox-search"><Icon name="search" size={16} /><input aria-label="Search feedback" placeholder="Search notes, tracks or people" value={search} onChange={(event) => setSearch(event.target.value)} /></label></div>
      <div className="review-inbox-subtools"><label htmlFor="feedback-track">Show notes for</label><select id="feedback-track" className="field" value={trackFilter} onChange={(event) => setTrackFilter(event.target.value)}><option value="">All tracks</option>{tracks.map(([id, item]) => <option value={id} key={id}>{item.title} · V{item.version}</option>)}</select><span>{hasMore ? `${items.length} notes loaded · load more below` : `${filtered.length} ${filtered.length === 1 ? "note" : "notes"}`}</span></div>
      {loading ? <div className="review-loading" role="status" aria-label="Loading feedback"><Spinner size={25} /></div> : error ? <Empty icon="comment" title="Feedback could not be loaded" hint={error} action={<button className="btn-primary" onClick={() => setReload((value) => value + 1)}>Try again</button>} /> : filtered.length === 0 ? <Empty icon={filter === "open" && items.length > 0 && !search && !trackFilter ? "check" : "comment"} title={search || trackFilter ? "No notes match those filters" : items.length === 0 ? "Bring your music into the conversation" : filter === "open" ? "You’re all caught up" : "No resolved notes yet"} hint={search || trackFilter ? "Try another search or return to all tracks." : items.length === 0 ? "Share a track or album. Feedback from your listeners will arrive here, with timestamps that take you straight to the moment." : filter === "open" ? "All loaded notes have been resolved. Your feedback history is always here." : "Mark notes resolved after you’ve worked through them."} action={items.length === 0 ? <Link className="btn-primary" to="/library">Open your library<Icon name="chevron" size={15} /></Link> : search || trackFilter ? <button className="btn-ghost" onClick={() => { setSearch(""); setTrackFilter(""); }}>Clear filters</button> : undefined} /> : <div className="review-inbox-list">{filtered.map((item) => {
        const query = new URLSearchParams({ comment: item.id });
        if (item.at_sec !== null) query.set("at", String(item.at_sec));
        const url = `/track/${item.track_id}?${query}`;
        return <article className={`review-inbox-item ${item.resolved ? "is-resolved" : ""}`} key={item.id}>
          <Link className="review-inbox-cover" to={url} aria-label={`Open ${item.track_title} version ${item.version_number}`}><Cover url={item.track_cover_url || undefined} radius={9} icon={22} /></Link>
          <div className="review-inbox-item-content"><div className="review-inbox-track"><Link to={url}>{item.track_title}</Link><span>V{item.version_number}</span>{item.resolved && <span className="review-resolved-badge"><Icon name="check" size={12} />Resolved</span>}</div><p className="review-inbox-body">{item.body}</p><div className="review-inbox-byline"><Avatar name={item.author_name} src={item.author_avatar} size={20} /><strong>{item.author_name}</strong>{item.is_owner && <span className="review-artist-badge">Artist</span>}<span>· {formatDate(item.created_at)}</span></div></div>
          <div className="review-inbox-item-actions"><Link className="review-timestamp" to={url}><Icon name={item.at_sec === null ? "comment" : "play"} size={12} />{item.at_sec === null ? "Open track" : formatTime(item.at_sec)}</Link><button className={`review-resolve ${item.resolved ? "" : "review-resolve-prominent"}`} disabled={busy.has(item.id)} onClick={() => resolve(item)}>{busy.has(item.id) ? <Spinner size={13} /> : <Icon name={item.resolved ? "plus" : "check"} size={14} />}{item.resolved ? "Reopen" : "Resolve"}</button></div>
        </article>;
      })}</div>}
      {!loading && !error && hasMore && <div className="review-load-more"><p>Counts and filters apply to the {items.length} notes loaded so far.</p><button className="btn-ghost" onClick={loadMore} disabled={loadingMore}>{loadingMore ? <Spinner size={16} /> : "Load more feedback"}</button></div>}
    </section>
  </div>;
}
