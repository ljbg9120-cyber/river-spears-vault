import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, formatSize, TRACK_STATUSES, type Folder, type Track, type TrackStatus } from "../lib/api";
import { useAuth, usePlayer } from "../lib/store";
import AlbumModal, { ACCENT_HEX } from "../components/AlbumModal";
import Cover from "../components/Cover";
import TrackRow from "../components/TrackRow";
import Upload from "../components/Upload";
import { Empty, Icon, Modal, Spinner, useToast } from "../components/ui";

type SavedView = { id: string; name: string; filters: Record<string, string | boolean> };
const SORTS = [{ id: "recent", label: "Recently added" }, { id: "title", label: "Title A–Z" }, { id: "oldest", label: "Oldest first" }, { id: "longest", label: "Longest first" }, { id: "plays", label: "Most played" }];
const FILTER_KEYS = ["q", "folder_id", "tag", "sort", "status", "favorite", "latest_only"];
const message = (e: unknown) => e instanceof Error ? e.message : "Something went wrong. Please try again.";

export default function Library() {
  const { user } = useAuth();
  const player = usePlayer();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [allTracks, setAllTracks] = useState<Track[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [catalogError, setCatalogError] = useState("");
  const [revision, setRevision] = useState(0);
  const [view, setView] = useState<"list" | "grid">(() => { try { return localStorage.getItem("vault:view") === "grid" ? "grid" : "list"; } catch { return "list"; } });
  const [selection, setSelection] = useState<string[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [albumModal, setAlbumModal] = useState<{ open: boolean; folder: Folder | null }>({ open: false, folder: null });
  const [moveOpen, setMoveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteFolder, setDeleteFolder] = useState<Folder | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [viewName, setViewName] = useState("");
  const [busy, setBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const q = params.get("q") ?? "";
  const folderId = params.get("folder_id") ?? "";
  const tag = params.get("tag") ?? "";
  const status = params.get("status") ?? "";
  const favorite = params.get("favorite") === "true";
  const sort = params.get("sort") ?? "recent";
  const latestOnly = params.get("latest_only") !== "false";
  const activeFolder = folders.find(f => f.id === folderId);
  const hasFilters = Boolean(q || folderId || tag || status || favorite || !latestOnly);
  const query = useMemo(() => {
    const value = new URLSearchParams({ sort, latest_only: String(latestOnly) });
    if (q.trim()) value.set("q", q.trim());
    if (folderId) value.set("folder_id", folderId);
    if (tag) value.set("tag", tag);
    if (status) value.set("status", status);
    if (favorite) value.set("favorite", "true");
    return value.toString();
  }, [q, folderId, tag, status, favorite, sort, latestOnly]);

  const updateFilters = (values: Record<string, string | null>) => setParams(previous => {
    const next = new URLSearchParams(previous);
    Object.entries(values).forEach(([key,value]) => value ? next.set(key,value) : next.delete(key));
    return next;
  }, { replace: true });
  const refresh = useCallback(() => setRevision(n => n + 1), []);
  useEffect(() => { try { localStorage.setItem("vault:view", view); } catch { /* View preference is optional. */ } }, [view]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !target.closest("input,textarea,select,[contenteditable=true],[role=dialog]")) { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    let active = true;
    setCatalogError("");
    Promise.all([api.get<Folder[]>("/api/folders"), api.get<string[]>("/api/tracks/tags"), api.get<Track[]>("/api/tracks?latest_only=true"), api.get<SavedView[]>("/api/library-views")])
      .then(([f,t,a,s]) => { if (active) { setFolders(f); setTags(t); setAllTracks(a); setSavedViews(s); } })
      .catch(e => { if (active) setCatalogError(message(e)); });
    return () => { active = false; };
  }, [revision, user?.id]);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(""); setSelection([]); setSelecting(false);
    const timer = window.setTimeout(() => {
      api.get<Track[]>(`/api/tracks?${query}`).then(data => { if (active) setTracks(data); })
        .catch(e => { if (active) setError(message(e)); })
        .finally(() => { if (active) setLoading(false); });
    }, q ? 200 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, revision, user?.id]);
  const onTrackUpdate = (track: Track) => {
    setTracks(current => current.map(t => t.id === track.id ? track : t));
    setAllTracks(current => current.map(t => t.id === track.id ? track : t));
    if (favorite || status) refresh();
  };
  const bulk = async (values: object, text: string) => {
    setBusy(true);
    try { await api.post("/api/tracks/bulk", { track_ids: selection, ...values }); toast(text); setMoveOpen(false); refresh(); }
    catch(e) { toast(message(e), "err"); }
    finally { setBusy(false); }
  };
  const permanentlyDelete = async () => {
    setBusy(true);
    try { await api.post("/api/tracks/bulk/delete", { track_ids: selection }); toast(`${selection.length} tracks deleted`); setDeleteOpen(false); refresh(); }
    catch(e) { toast(message(e), "err"); }
    finally { setBusy(false); }
  };
  const saveView = async (e: React.FormEvent) => {
    e.preventDefault(); if (!viewName.trim()) return; setBusy(true);
    const filters: Record<string,string | boolean> = { latest_only: latestOnly, sort };
    FILTER_KEYS.forEach(key => { const value = params.get(key); if (value !== null) filters[key] = ["favorite", "latest_only"].includes(key) ? value === "true" : value; });
    try { const saved = await api.post<SavedView>("/api/library-views", { name: viewName.trim(), filters }); setSavedViews(v => [...v, saved]); setSaveOpen(false); setViewName(""); toast("View saved to your account"); }
    catch(e) { toast(message(e), "err"); } finally { setBusy(false); }
  };
  const applyView = (saved: SavedView) => { const next = new URLSearchParams(); Object.entries(saved.filters).forEach(([k,v]) => next.set(k,String(v))); setParams(next); setViewsOpen(false); };
  const reviewCount = allTracks.filter(t => t.status === "in_review").length;
  const openNotes = allTracks.reduce((n,t) => n + (t.unresolved_comment_count ?? 0), 0);
  const totalDuration = tracks.reduce((n,t) => n + t.duration, 0);
  const totalBytes = allTracks.reduce((n,t) => n + t.size_bytes, 0);

  return <div className="library-workspace">
    <div className="page-heading">
      <div><div className="eyebrow">THE COLLECTION</div><h1>Your library<span className="heading-period">.</span></h1><p>Every idea has a place. Make room for the next one.</p></div>
      <div className="heading-actions"><button className="btn-ghost" onClick={() => setAlbumModal({open:true,folder:null})}><Icon name="plus" size={16} />New album</button><button className="btn-primary" onClick={() => setUploadOpen(v => !v)} aria-expanded={uploadOpen} aria-controls="library-upload"><Icon name="upload" size={17} />Upload tracks</button></div>
    </div>
    {(catalogError || error) && <div className="error-panel" role="alert"><Icon name="music" size={18} /><div><strong>Couldn’t load your library</strong><p>{error || catalogError}</p></div><button className="btn-ghost" onClick={refresh}>Try again</button></div>}
    <div className="library-overview" aria-label="Library overview">
      <div><span className="overview-symbol"><Icon name="music" size={18} /></span><strong>{catalogError ? "—" : allTracks.length}</strong><span>tracks</span></div>
      <div><span className="overview-symbol"><Icon name="folder" size={18} /></span><strong>{catalogError ? "—" : folders.length}</strong><span>albums</span></div>
      <button onClick={() => updateFilters({status:"in_review",favorite:null})}><span className="overview-symbol amber"><Icon name="clock" size={18} /></span><strong>{catalogError ? "—" : reviewCount}</strong><span>ready for review</span><Icon name="chevron" size={13} /></button>
      <Link to="/feedback"><span className="overview-symbol violet"><Icon name="comment" size={18} /></span><strong>{catalogError ? "—" : openNotes}</strong><span>open notes on latest mixes</span><Icon name="chevron" size={13} /></Link>
    </div>
    <div id="library-upload" hidden={!uploadOpen} className="library-upload-panel"><div className="section-heading"><h2>Add to your vault</h2><button className="icon-button" onClick={() => setUploadOpen(false)} aria-label="Collapse uploads"><Icon name="x" size={16} /></button></div><Upload folderId={folderId && folderId !== "none" ? folderId : null} onDone={refresh} /></div>
    <section className="album-section" aria-label="Albums">
      <div className="section-heading"><h2>Albums <span>{folders.length}</span></h2>{folderId && <button className="text-button" onClick={() => updateFilters({folder_id:null})}>View all tracks<Icon name="chevron" size={14} /></button>}</div>
      <div className="album-strip">
        {folders.map((f, i) => <div key={f.id} className={`album-tile ${folderId === f.id ? "selected" : ""}`} style={{"--album-accent":ACCENT_HEX[f.accent] ?? "#9c8dff"} as React.CSSProperties}>
          <button className="album-main" onClick={() => updateFilters({folder_id:folderId === f.id ? null : f.id})} aria-pressed={folderId === f.id}><div className="album-art">{f.cover_url ? <Cover url={f.cover_url} size={62} radius={10} thumb /> : <span className="album-monogram"><Icon name="folder" size={25} /><small>{String(i + 1).padStart(2,"0")}</small></span>}</div><span className="album-title"><strong>{f.name}</strong><small>{allTracks.filter(t => t.folder_id === f.id).length} tracks</small></span></button>
          <button className="album-edit icon-button" aria-label={`Edit ${f.name}`} onClick={() => setAlbumModal({open:true,folder:f})}><Icon name="edit" size={14} /></button>
        </div>)}
        {folders.length === 0 && <button className="album-create" onClick={() => setAlbumModal({open:true,folder:null})}><Icon name="plus" size={24} /><span>Create your first album</span></button>}
      </div>
    </section>
    <section className="track-collection" aria-label="Tracks">
      <div className="collection-tabs"><div role="group" aria-label="Quick filters"><button className={!status && !favorite ? "active" : ""} onClick={() => updateFilters({status:null,favorite:null})}>All tracks</button><button className={favorite ? "active" : ""} onClick={() => updateFilters({favorite:"true",status:null})}><Icon name="heart" size={15} />Favorites</button><button className={status === "in_review" ? "active" : ""} onClick={() => updateFilters({status:"in_review",favorite:null})}>In review</button><button className={status === "approved" ? "active" : ""} onClick={() => updateFilters({status:"approved",favorite:null})}>Approved</button></div><button className="text-button saved-view-trigger" onClick={() => setViewsOpen(true)}><Icon name="folder" size={15} />Saved views{savedViews.length > 0 && <span>{savedViews.length}</span>}</button></div>
      <div className="library-toolbar">
        <div className="library-search"><Icon name="search" size={18} /><input ref={searchRef} aria-label="Search tracks" placeholder="Search tracks, notes, or tags…" value={q} onChange={e => updateFilters({q:e.target.value || null})} />{q ? <button aria-label="Clear search" className="icon-button" onClick={() => updateFilters({q:null})}><Icon name="x" size={14} /></button> : <kbd>/</kbd>}</div>
        <select aria-label="Filter by status" className="toolbar-select" value={status} onChange={e => updateFilters({status:e.target.value || null})}><option value="">All statuses</option>{TRACK_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
        <select aria-label="Filter by tag" className="toolbar-select" value={tag} onChange={e => updateFilters({tag:e.target.value || null})}><option value="">All tags</option>{tags.map(t => <option key={t} value={t}>{t}</option>)}</select>
        <select aria-label="Sort tracks" className="toolbar-select" value={sort} onChange={e => updateFilters({sort:e.target.value})}>{SORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
        <div className="view-switch">{(["list","grid"] as const).map(v => <button key={v} aria-label={`${v} view`} aria-pressed={view === v} onClick={() => setView(v)} className={view === v ? "active" : ""}><Icon name={v} size={17} /></button>)}</div>
      </div>
      <div className="results-toolbar"><span>{loading ? "Loading tracks…" : `${tracks.length} ${tracks.length === 1 ? "track" : "tracks"}${totalDuration ? ` · ${Math.round(totalDuration/60)} min` : ""}`}{activeFolder && <> in <strong>{activeFolder.name}</strong></>}</span><div><label className="latest-toggle"><input type="checkbox" checked={latestOnly} onChange={e => updateFilters({latest_only:e.target.checked ? null : "false"})} />Latest versions</label><button className="text-button" onClick={() => setSaveOpen(true)}><Icon name="plus" size={13} />Save view</button><button className="text-button" onClick={() => {setSelecting(v => !v);setSelection([]);}}>{selecting ? "Done" : "Select"}</button></div></div>
      {hasFilters && <div className="active-filters">{folderId && <button onClick={() => updateFilters({folder_id:null})}><Icon name="folder" size={12} />{activeFolder?.name ?? "Unfiled"}<Icon name="x" size={12} /></button>}{tag && <button onClick={() => updateFilters({tag:null})}>{tag}<Icon name="x" size={12} /></button>}{status && <button onClick={() => updateFilters({status:null})}>{TRACK_STATUSES.find(s => s.value === status)?.label ?? status}<Icon name="x" size={12} /></button>}{favorite && <button onClick={() => updateFilters({favorite:null})}>Favorites<Icon name="x" size={12} /></button>}<button className="clear-filters" onClick={() => setParams({})}>Clear filters</button></div>}
      {selecting && <div className="selection-toolbar"><label><input type="checkbox" checked={tracks.length > 0 && selection.length === tracks.length} onChange={e => setSelection(e.target.checked ? tracks.map(t => t.id) : [])} />Select all {tracks.length}</label><span>{selection.length} selected</span><button disabled={!selection.length || busy} onClick={() => setMoveOpen(true)}><Icon name="folder" size={15} />Move</button><select aria-label="Set selected tracks status" value="" disabled={!selection.length || busy} onChange={e => {if(e.target.value) void bulk({status:e.target.value},"Status updated");}}><option value="">Set status…</option>{TRACK_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select><button disabled={!selection.length || busy} onClick={() => void bulk({is_favorite:true},"Added to favorites")}><Icon name="heart" size={15} />Favorite</button><button disabled={!selection.length} onClick={() => {player.addToQueue(tracks.filter(t => selection.includes(t.id)));toast("Added selection to queue");}}><Icon name="list" size={15} />Queue</button><button className="danger-text" disabled={!selection.length || busy} onClick={() => setDeleteOpen(true)}><Icon name="trash" size={15} /><span className="sr-only">Delete selected tracks</span></button></div>}
      {loading ? <div className="library-loading" role="status"><Spinner size={22} /><span>Opening the vault…</span></div> : error ? null : tracks.length === 0 ? <Empty title={hasFilters ? "No tracks match this view" : "Your next idea starts here"} hint={hasFilters ? "Try a different search or clear the filters." : "Upload a demo, voice memo, or finished mix to start your collection."} action={<button className="btn-primary" onClick={() => hasFilters ? setParams({}) : setUploadOpen(true)}>{hasFilters ? "Clear filters" : "Upload your first track"}</button>} /> : <div className={view === "grid" ? "tracks-grid" : "track-table"}>
        {view === "list" && <div className="track-table-heading"><span>TRACK / VERSION</span><span>WAVEFORM</span><span>STATUS</span><span>TIME</span><span /></div>}
        {tracks.map((t,i) => <TrackRow key={t.id} track={t} queue={tracks} index={i} view={view} selectable={selecting} selected={selection.includes(t.id)} onSelect={id => setSelection(s => s.includes(id) ? s.filter(x => x !== id) : [...s,id])} onUpdate={onTrackUpdate} folderName={folders.find(f => f.id === t.folder_id)?.name} />)}
      </div>}
      <footer className="library-footer"><span><Icon name="lock" size={12} />Private by default</span><span>{formatSize(totalBytes)} in your library</span></footer>
    </section>
    <AlbumModal open={albumModal.open} folder={albumModal.folder} onClose={() => setAlbumModal({open:false,folder:null})} onSaved={(folder,created) => {refresh();if(created) updateFilters({folder_id:folder.id});toast(created ? "Album created" : "Album saved");}} />
    {activeFolder && <button className="text-button album-remove-link" onClick={() => setDeleteFolder(activeFolder)}><Icon name="trash" size={13} />Remove album</button>}
    <Modal open={moveOpen} onClose={() => !busy && setMoveOpen(false)} title="Move selected tracks"><div className="space-y-2">{folders.map(f => <button key={f.id} className="account-link w-full" disabled={busy} onClick={() => void bulk({folder_id:f.id},"Tracks moved")}><Cover url={f.cover_url} size={30} radius={7} thumb />{f.name}</button>)}<button className="account-link w-full" disabled={busy} onClick={() => void bulk({folder_id:""},"Tracks moved to Unfiled")}><Icon name="folder" size={18} />Unfiled</button></div></Modal>
    <Modal open={deleteOpen} onClose={() => !busy && setDeleteOpen(false)} title={`Delete ${selection.length} tracks?`}><p>The audio, feedback, and private links for these tracks will be permanently removed. This cannot be undone.</p><ul className="delete-list">{tracks.filter(t => selection.includes(t.id)).map(t => <li key={t.id}>{t.title}</li>)}</ul><div className="flex justify-end gap-2 mt-5"><button className="btn-ghost" disabled={busy} onClick={() => setDeleteOpen(false)}>Keep tracks</button><button className="btn-primary danger-button" disabled={busy} onClick={() => void permanentlyDelete()}>{busy ? "Deleting…" : "Permanently delete"}</button></div></Modal>
    <Modal open={Boolean(deleteFolder)} onClose={() => !busy && setDeleteFolder(null)} title="Remove this album?"><p>Remove “{deleteFolder?.name}” from your library. Its tracks will stay in Unfiled.</p><div className="flex justify-end gap-2 mt-5"><button className="btn-ghost" onClick={() => setDeleteFolder(null)}>Keep album</button><button className="btn-primary" disabled={busy} onClick={async () => {if(!deleteFolder)return;setBusy(true);try{await api.del(`/api/folders/${deleteFolder.id}?keep_tracks=true`);setDeleteFolder(null);updateFilters({folder_id:null});refresh();toast("Album removed; tracks kept");}catch(e){toast(message(e),"err");}finally{setBusy(false);}}}>Remove album</button></div></Modal>
    <Modal open={saveOpen} onClose={() => !busy && setSaveOpen(false)} title="Save this library view"><form onSubmit={saveView}><p className="text-muted mb-5">Keep this search, album, tags, status, and sort together. Your saved views are available whenever you sign in.</p><label className="field-label">View name<input autoFocus className="field mt-2" placeholder="Friday listening session" maxLength={80} value={viewName} onChange={e => setViewName(e.target.value)} required /></label><button className="btn-primary w-full mt-5" disabled={busy || !viewName.trim()}>{busy ? "Saving…" : "Save view"}</button></form></Modal>
    <Modal open={viewsOpen} onClose={() => setViewsOpen(false)} title="Saved views"><div className="space-y-2">{savedViews.length === 0 && <p className="text-muted">Save a combination of filters to return to it in one click.</p>}{savedViews.map(saved => <div key={saved.id} className="saved-view-row"><button onClick={() => applyView(saved)}><Icon name="folder" size={18} /><span>{saved.name}</span><Icon name="chevron" size={15} /></button><button className="icon-button" aria-label={`Remove saved view ${saved.name}`} disabled={busy} onClick={async () => {setBusy(true);try{await api.del(`/api/library-views/${saved.id}`);setSavedViews(v => v.filter(x => x.id !== saved.id));toast("Saved view removed");}catch(e){toast(message(e),"err");}finally{setBusy(false);}}}><Icon name="trash" size={15} /></button></div>)}</div></Modal>
  </div>;
}
