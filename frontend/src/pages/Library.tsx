/** The library: albums down the side, everything you own in the middle. */
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type Folder, type Track } from "../lib/api";
import { useAuth } from "../lib/store";
import AlbumModal, { ACCENT_HEX } from "../components/AlbumModal";
import Cover from "../components/Cover";
import TrackRow from "../components/TrackRow";
import Upload from "../components/Upload";
import { Empty, Icon, Modal, Spinner, useToast } from "../components/ui";

const SORTS = [
  { id: "recent", label: "Newest" },
  { id: "oldest", label: "Oldest" },
  { id: "title", label: "A–Z" },
  { id: "longest", label: "Longest" },
  { id: "plays", label: "Most played" },
] as const;

export default function Library() {
  const { user } = useAuth();
  const toast = useToast();

  const [tracks, setTracks] = useState<Track[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState("");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [sort, setSort] = useState<string>("recent");
  const [view, setView] = useState<"list" | "grid">(
    () => (localStorage.getItem("vault:view") as "list" | "grid") ?? "list",
  );

  const [selection, setSelection] = useState<string[]>([]);
  const [albumModal, setAlbumModal] = useState<{ open: boolean; folder: Folder | null }>(
    { open: false, folder: null },
  );
  const [moveOpen, setMoveOpen] = useState(false);

  useEffect(() => localStorage.setItem("vault:view", view), [view]);

  const loadFolders = useCallback(async () => {
    setFolders(await api.get<Folder[]>("/api/folders"));
  }, []);

  const loadTracks = useCallback(async () => {
    const params = new URLSearchParams({ sort });
    if (q.trim()) params.set("q", q.trim());
    if (folderId) params.set("folder_id", folderId);
    if (tag) params.set("tag", tag);
    setTracks(await api.get<Track[]>(`/api/tracks?${params}`));
  }, [q, folderId, tag, sort]);

  const loadTags = useCallback(async () => {
    setTags(await api.get<string[]>("/api/tracks/tags"));
  }, []);

  useEffect(() => {
    Promise.all([loadFolders(), loadTags()]).catch(() => {});
  }, [loadFolders, loadTags]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    // Debounce so typing in search does not fire a request per keystroke.
    const id = setTimeout(() => {
      loadTracks()
        .catch(() => {})
        .finally(() => alive && setLoading(false));
    }, q ? 220 : 0);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [loadTracks, q]);

  const refreshAll = useCallback(() => {
    Promise.all([loadTracks(), loadFolders(), loadTags()]).catch(() => {});
  }, [loadTracks, loadFolders, loadTags]);

  const activeFolder = folders.find((f) => f.id === folderId) ?? null;
  const totalDuration = useMemo(
    () => tracks.reduce((sum, t) => sum + t.duration, 0),
    [tracks],
  );

  const deleteAlbum = async (folder: Folder) => {
    if (!confirm(`Delete "${folder.name}"? The tracks inside stay in your vault.`)) return;
    await api.del(`/api/folders/${folder.id}?keep_tracks=true`);
    if (folderId === folder.id) setFolderId(null);
    toast(`"${folder.name}" deleted — tracks kept`);
    refreshAll();
  };

  const bulkMove = async (target: string | null) => {
    await api.post<Track[]>("/api/tracks/bulk", {
      track_ids: selection,
      folder_id: target ?? "",
    });
    toast(`${selection.length} moved`);
    setSelection([]);
    setMoveOpen(false);
    refreshAll();
  };

  const bulkDelete = async () => {
    if (!confirm(`Permanently delete ${selection.length} track(s)? This cannot be undone.`))
      return;
    await api.post("/api/tracks/bulk/delete", { track_ids: selection });
    toast(`${selection.length} deleted`);
    setSelection([]);
    refreshAll();
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[236px_1fr]">
      {/* ---------------- albums ---------------- */}
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted">
            Albums
          </h2>
          <button
            onClick={() => setAlbumModal({ open: true, folder: null })}
            className="rounded-lg p-1.5 text-muted transition hover:bg-white/10 hover:text-ink"
            aria-label="New album"
          >
            <Icon name="plus" size={16} />
          </button>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-2 lg:block lg:space-y-1 lg:overflow-visible lg:pb-0">
          <AlbumButton
            active={folderId === null}
            onClick={() => setFolderId(null)}
            label="Everything"
            count={null}
            icon="music"
          />
          {folders.map((f) => (
            <AlbumButton
              key={f.id}
              active={folderId === f.id}
              onClick={() => setFolderId(f.id)}
              onEdit={() => setAlbumModal({ open: true, folder: f })}
              onDelete={() => deleteAlbum(f)}
              label={f.name}
              count={f.track_count}
              dot={ACCENT_HEX[f.accent] ?? ACCENT_HEX.violet}
              cover={f.cover_url}
            />
          ))}
          <AlbumButton
            active={folderId === "none"}
            onClick={() => setFolderId("none")}
            label="Unfiled"
            count={null}
            icon="folder"
          />
        </div>

        {tags.length > 0 && (
          <div className="mt-6 hidden lg:block">
            <h2 className="mb-2 px-1 font-display text-sm font-bold uppercase tracking-wider text-muted">
              Tags
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <button
                  key={t}
                  onClick={() => setTag(tag === t ? null : t)}
                  className={`chip ${tag === t ? "chip-on" : ""}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}
      </aside>

      {/* ---------------- main ---------------- */}
      <section className="min-w-0">
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-4"
        >
          {activeFolder && (
            <motion.button
              layoutId={`cover-${activeFolder.id}`}
              onClick={() => setAlbumModal({ open: true, folder: activeFolder })}
              className="group relative"
              aria-label="Edit album cover"
            >
              <Cover
                url={activeFolder.cover_url || undefined}
                size={96}
                radius={20}
                icon={30}
                className="shadow-lift"
              />
              <span
                className="absolute inset-0 flex items-center justify-center rounded-[20px] text-white opacity-0 transition group-hover:opacity-100"
                style={{ background: "rgba(0,0,0,0.5)" }}
              >
                <Icon name="edit" size={20} />
              </span>
            </motion.button>
          )}

          <div className="min-w-0">
            <h1 className="title-xl truncate text-3xl sm:text-4xl">
              {activeFolder
                ? activeFolder.name
                : folderId === "none"
                  ? "Unfiled"
                  : `${user?.display_name.split(" ")[0]}'s vault`}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {tracks.length} {tracks.length === 1 ? "track" : "tracks"}
              {totalDuration > 0 && ` · ${Math.round(totalDuration / 60)} min`}
              {activeFolder && !activeFolder.has_cover && (
                <>
                  {" · "}
                  <button
                    onClick={() => setAlbumModal({ open: true, folder: activeFolder })}
                    className="underline decoration-dotted underline-offset-2 hover:text-ink"
                  >
                    add a cover
                  </button>
                </>
              )}
              {!activeFolder && " · unlimited space, always free"}
            </p>
          </div>
        </motion.div>

        <div className="my-4">
          <Upload folderId={folderId === "none" ? null : folderId} onDone={refreshAll} />
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">
              <Icon name="search" size={16} />
            </span>
            <input
              className="field !py-2.5 !pl-10"
              placeholder="Search titles, notes, tags…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {q && (
              <button
                onClick={() => setQ("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
                aria-label="Clear search"
              >
                <Icon name="x" size={15} />
              </button>
            )}
          </div>

          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="field !w-auto !py-2.5 text-sm"
            aria-label="Sort"
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id} style={{ color: "#111" }}>
                {s.label}
              </option>
            ))}
          </select>

          <div className="glass flex rounded-xl p-1">
            {(["list", "grid"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className="rounded-lg p-1.5 transition"
                style={{
                  background: view === v ? "rgb(var(--accent-rgb) / 0.22)" : "transparent",
                  color: view === v ? "rgb(var(--ink-rgb))" : "rgb(var(--muted-rgb))",
                }}
                aria-label={`${v} view`}
              >
                <Icon name={v} size={16} />
              </button>
            ))}
          </div>

          <button
            onClick={() => setSelection(selection.length ? [] : tracks.map((t) => t.id))}
            className="btn-ghost !px-3 !py-2 text-xs"
          >
            {selection.length ? "Clear" : "Select"}
          </button>
        </div>

        {tag && (
          <div className="mb-3 flex items-center gap-2 text-sm">
            <span className="chip chip-on">
              <Icon name="tag" size={12} />
              {tag}
              <button onClick={() => setTag(null)} aria-label="Clear tag">
                <Icon name="x" size={12} />
              </button>
            </span>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-20 text-muted">
            <Spinner size={26} />
          </div>
        ) : tracks.length === 0 ? (
          <Empty
            title={q || tag ? "Nothing matches that" : "This vault is empty"}
            hint={
              q || tag
                ? "Try a different search, or clear the filters."
                : "Drop your first track above. There is no limit on how much you keep here."
            }
          />
        ) : view === "grid" ? (
          <motion.div layout className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <AnimatePresence mode="popLayout">
              {tracks.map((t, i) => (
                <TrackRow
                  key={t.id}
                  track={t}
                  queue={tracks}
                  index={i}
                  view="grid"
                  selectable={selection.length > 0}
                  selected={selection.includes(t.id)}
                  onSelect={(id) =>
                    setSelection((s) =>
                      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
                    )
                  }
                />
              ))}
            </AnimatePresence>
          </motion.div>
        ) : (
          <motion.div layout className="card divide-y divide-[var(--hairline)] p-1.5">
            <AnimatePresence mode="popLayout">
              {tracks.map((t, i) => (
                <TrackRow
                  key={t.id}
                  track={t}
                  queue={tracks}
                  index={i}
                  selectable={selection.length > 0}
                  selected={selection.includes(t.id)}
                  onSelect={(id) =>
                    setSelection((s) =>
                      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
                    )
                  }
                />
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </section>

      {/* ---------------- selection bar ---------------- */}
      <AnimatePresence>
        {selection.length > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: "spring", stiffness: 340, damping: 30 }}
            className="glass-strong fixed inset-x-3 z-40 flex items-center gap-2 rounded-2xl px-4 py-3 shadow-lift sm:inset-x-auto sm:left-1/2 sm:w-auto sm:-translate-x-1/2"
            style={{ bottom: "calc(150px + env(safe-area-inset-bottom))" }}
          >
            <span className="text-sm font-semibold">{selection.length} selected</span>
            <div className="mx-1 h-5 w-px bg-[var(--hairline)]" />
            <button onClick={() => setMoveOpen(true)} className="btn-ghost !px-3 !py-1.5 text-xs">
              <Icon name="folder" size={14} /> Move
            </button>
            <button
              onClick={bulkDelete}
              className="btn-ghost !px-3 !py-1.5 text-xs"
              style={{ color: "#ff8098" }}
            >
              <Icon name="trash" size={14} /> Delete
            </button>
            <button
              onClick={() => setSelection([])}
              className="rounded-full p-1.5 text-muted hover:text-ink"
              aria-label="Cancel"
            >
              <Icon name="x" size={15} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AlbumModal
        open={albumModal.open}
        folder={albumModal.folder}
        onClose={() => setAlbumModal({ open: false, folder: null })}
        onSaved={(folder, created) => {
          refreshAll();
          if (created) setFolderId(folder.id);
          toast(created ? `"${folder.name}" created` : "Album saved");
        }}
      />

      <Modal open={moveOpen} onClose={() => setMoveOpen(false)} title="Move to album">
        <div className="space-y-1.5">
          {folders.map((f) => (
            <button
              key={f.id}
              onClick={() => bulkMove(f.id)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition hover:bg-white/10"
            >
              <Cover url={f.cover_url || undefined} size={32} radius={8} icon={14} thumb />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="text-xs text-muted">{f.track_count}</span>
            </button>
          ))}
          <button
            onClick={() => bulkMove(null)}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-muted transition hover:bg-white/10"
          >
            <Icon name="x" size={14} /> Remove from album
          </button>
        </div>
      </Modal>
    </div>
  );
}

function AlbumButton({
  active,
  onClick,
  onEdit,
  onDelete,
  label,
  count,
  dot,
  cover,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  label: string;
  count: number | null;
  dot?: string;
  cover?: string;
  icon?: "music" | "folder";
}) {
  const showCover = cover !== undefined;
  return (
    <div className="group relative shrink-0">
      <button
        onClick={onClick}
        className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-xl px-2 py-1.5 text-left text-sm font-medium transition"
        style={{
          background: active ? "rgb(var(--accent-rgb) / 0.16)" : "transparent",
          color: active ? "rgb(var(--ink-rgb))" : "rgb(var(--muted-rgb))",
        }}
      >
        {showCover ? (
          <Cover url={cover || undefined} size={28} radius={7} icon={12} thumb />
        ) : (
          <span className="flex h-7 w-7 items-center justify-center">
            <Icon name={icon ?? "folder"} size={15} />
          </span>
        )}
        <span className="truncate">{label}</span>
        {dot && !cover && (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full opacity-70"
            style={{ background: dot }}
          />
        )}
        {count !== null && count > 0 && (
          <span className="ml-auto pl-2 text-xs text-muted">{count}</span>
        )}
      </button>

      {(onEdit || onDelete) && (
        <div className="absolute right-1 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 opacity-0 transition group-hover:opacity-100 lg:flex">
          {onEdit && (
            <button
              onClick={onEdit}
              className="rounded-md p-1 text-muted transition hover:text-ink"
              aria-label={`Edit ${label}`}
            >
              <Icon name="edit" size={13} />
            </button>
          )}
          {onDelete && (
            <button
              onClick={onDelete}
              className="rounded-md p-1 text-muted transition hover:text-ink"
              aria-label={`Delete ${label}`}
            >
              <Icon name="trash" size={13} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
