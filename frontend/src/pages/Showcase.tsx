/**
 * The public showcase: music people chose to publish, and what everyone makes
 * of it. Browsable signed out; rating needs an account, one vote per person
 * per item, changeable.
 */
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Cover from "../components/Cover";
import { Avatar, Empty, Icon, Spinner, useToast } from "../components/ui";
import { api, formatTime, type Folder, type ShowcaseItem, type Track } from "../lib/api";
import { useAuth, usePlayer } from "../lib/store";

export default function Showcase() {
  const { user } = useAuth();
  const { current, playing, play } = usePlayer();
  const toast = useToast();

  const [items, setItems] = useState<ShowcaseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<"top" | "new">("top");
  const [kind, setKind] = useState<"all" | "track" | "album">("all");
  const [managing, setManaging] = useState(false);

  const load = useCallback(async () => {
    setItems(await api.get<ShowcaseItem[]>(`/api/showcase?sort=${sort}&kind=${kind}`));
  }, [sort, kind]);

  useEffect(() => {
    setLoading(true);
    load().catch(() => {}).finally(() => setLoading(false));
  }, [load]);

  const rate = async (item: ShowcaseItem, stars: number) => {
    if (!user) {
      toast("Sign in to rate this", "err");
      return;
    }
    const path = item.kind === "track"
      ? `/api/showcase/tracks/${item.id}/rate`
      : `/api/showcase/albums/${item.id}/rate`;
    try {
      const res = await api.post<{ rating_avg: number; rating_count: number; my_rating: number }>(
        path, { stars },
      );
      setItems((list) => list.map((x) =>
        x.kind === item.kind && x.id === item.id ? { ...x, ...res } : x));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not save that rating", "err");
    }
  };

  const playTrack = (item: ShowcaseItem) => {
    const queue = items.filter((x) => x.kind === "track");
    const asTrack = (x: ShowcaseItem): Track => ({
      id: x.id, title: x.title, notes: "", bpm: null, song_key: null,
      duration: x.duration, peaks: [], tags: x.tags, lyrics: "",
      visibility: "public", allow_download: false, plays: 0, folder_id: null,
      size_bytes: 0, original_name: "", created_at: x.created_at,
      updated_at: x.created_at, owner: x.owner, comment_count: 0, like_count: 0,
      liked_by_me: false, status: "demo", is_favorite: false,
      unresolved_comment_count: 0, version_root_id: null, version_number: 1,
      revision_note: "", stream_url: x.stream_url, cover_url: x.cover_url,
    });
    play(asTrack(item), queue.map(asTrack));
  };

  return (
    <div className="mx-auto max-w-5xl">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="title-xl text-3xl sm:text-4xl">Showcase</h1>
        <p className="mt-1 text-sm text-muted">
          Music people have published for anyone to hear and rate. Nothing lands
          here unless its owner puts it here.
        </p>
      </motion.div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="glass inline-flex rounded-xl p-1">
          {(["top", "new"] as const).map((value) => (
            <button
              key={value}
              onClick={() => setSort(value)}
              className="rounded-lg px-4 py-1.5 text-sm font-medium transition"
              style={{
                background: sort === value ? "rgb(var(--accent-rgb) / 0.22)" : "transparent",
                color: sort === value ? "rgb(var(--ink-rgb))" : "rgb(var(--muted-rgb))",
              }}
            >
              {value === "top" ? "Highest rated" : "Newest"}
            </button>
          ))}
        </div>

        <div className="glass inline-flex rounded-xl p-1">
          {(["all", "track", "album"] as const).map((value) => (
            <button
              key={value}
              onClick={() => setKind(value)}
              className="rounded-lg px-3.5 py-1.5 text-sm font-medium transition"
              style={{
                background: kind === value ? "rgb(var(--accent-rgb) / 0.22)" : "transparent",
                color: kind === value ? "rgb(var(--ink-rgb))" : "rgb(var(--muted-rgb))",
              }}
            >
              {value === "all" ? "Everything" : value === "track" ? "Tracks" : "Albums"}
            </button>
          ))}
        </div>

        {user && (
          <button
            onClick={() => setManaging((v) => !v)}
            className="btn-ghost ml-auto !px-4 !py-2 text-sm"
          >
            <Icon name="upload" size={14} />
            {managing ? "Done" : "Publish yours"}
          </button>
        )}
      </div>

      <AnimatePresence>
        {managing && user && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <PublishPanel onChanged={load} />
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="flex justify-center py-20 text-muted"><Spinner size={26} /></div>
      ) : items.length === 0 ? (
        <Empty
          icon="sparkles"
          title="Nothing published yet"
          hint={user
            ? "Use “Publish yours” above to put a track or album here."
            : "Sign in and publish something to get this started."}
        />
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {items.map((item, i) => {
            const isCurrent = item.kind === "track" && current?.id === item.id;
            const mine = user?.id === item.owner.id;
            return (
              <motion.div
                key={`${item.kind}:${item.id}`}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.03, 0.35) }}
                className="card flex gap-3 p-3"
              >
                <span className="relative shrink-0">
                  <Cover url={item.cover_url || undefined} size={76} radius={14} icon={24} thumb />
                  {item.kind === "track" && (
                    <button
                      onClick={() => playTrack(item)}
                      className="absolute inset-0 flex items-center justify-center rounded-[14px] bg-black/35 text-white transition hover:bg-black/55"
                      aria-label={`Play ${item.title}`}
                    >
                      <Icon name={isCurrent && playing ? "pause" : "play"} size={20} />
                    </button>
                  )}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate font-display text-[15px] font-bold">
                        {item.title}
                      </h3>
                      <Link
                        to={`/u/${item.owner.handle}`}
                        className="mt-0.5 flex items-center gap-1.5 text-xs text-muted hover:underline"
                      >
                        <Avatar name={item.owner.display_name} src={item.owner.avatar_url} size={16} />
                        {item.owner.display_name}
                      </Link>
                    </div>
                    <span className="chip shrink-0 !px-2 !py-0.5 !text-[10px]">
                      {item.kind === "album"
                        ? `${item.track_count} track${item.track_count === 1 ? "" : "s"}`
                        : formatTime(item.duration)}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Stars
                      value={item.my_rating ?? 0}
                      average={item.rating_avg}
                      disabled={mine || !user}
                      onRate={(stars) => rate(item, stars)}
                    />
                    <span className="text-xs text-muted">
                      {item.rating_count === 0
                        ? "no ratings yet"
                        : `${item.rating_avg.toFixed(1)} · ${item.rating_count} rating${item.rating_count === 1 ? "" : "s"}`}
                    </span>
                  </div>

                  {mine && (
                    <p className="mt-1 text-[11px] text-muted">Yours — you can't rate it.</p>
                  )}
                  {!user && (
                    <p className="mt-1 text-[11px] text-muted">
                      <Link to="/login" className="underline">Sign in</Link> to rate.
                    </p>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Five stars. Hovering previews, clicking commits. */
function Stars({
  value,
  average,
  disabled,
  onRate,
}: {
  value: number;
  average: number;
  disabled?: boolean;
  onRate: (stars: number) => void;
}) {
  const [hover, setHover] = useState(0);
  // Show your own rating if you have one, otherwise the crowd's.
  const shown = hover || value || Math.round(average);
  return (
    <span className="flex items-center gap-0.5" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          disabled={disabled}
          onMouseEnter={() => !disabled && setHover(star)}
          onClick={() => !disabled && onRate(star)}
          className="p-0.5 transition disabled:cursor-default"
          style={{
            color: star <= shown ? "rgb(var(--accent-rgb))" : "rgb(var(--muted-rgb) / 0.45)",
            transform: !disabled && hover === star ? "scale(1.2)" : "scale(1)",
          }}
          aria-label={`${star} star${star === 1 ? "" : "s"}`}
        >
          <Icon name="heart" size={15} filled={star <= shown} />
        </button>
      ))}
    </span>
  );
}

/** Pick which of your own tracks and albums appear on the showcase. */
function PublishPanel({ onChanged }: { onChanged: () => void }) {
  const toast = useToast();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<Track[]>("/api/tracks?limit=200"),
      api.get<Folder[]>("/api/folders"),
    ]).then(([t, f]) => { setTracks(t); setFolders(f); }).catch(() => {});
  }, []);

  const toggle = async (kind: "tracks" | "albums", id: string, on: boolean) => {
    setBusy(id);
    try {
      await api.post(`/api/showcase/${kind}/${id}/publish?on=${on}`);
      toast(on ? "Published to the showcase" : "Taken off the showcase");
      onChanged();
      if (kind === "tracks") {
        setTracks((list) => list.map((t) =>
          t.id === id ? { ...t, visibility: on ? "public" : t.visibility } : t));
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not change that", "err");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card mt-3 p-4">
      <p className="mb-3 text-sm text-muted">
        Publishing makes something public so anyone can play and rate it. Take it
        off at any time — that hides it again but keeps the ratings.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="mb-2 font-display text-xs font-bold uppercase tracking-wider text-muted">
            Albums
          </h3>
          <div className="space-y-1.5">
            {folders.length === 0 && <p className="text-xs text-muted">No albums yet.</p>}
            {folders.map((f) => (
              <button
                key={f.id}
                disabled={busy === f.id}
                onClick={() => toggle("albums", f.id, true)}
                className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left text-sm transition hover:bg-white/10 disabled:opacity-50"
              >
                <Cover url={f.cover_url || undefined} size={28} radius={7} icon={12} thumb />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="chip !px-2 !py-0.5 !text-[10px]">Publish</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <h3 className="mb-2 font-display text-xs font-bold uppercase tracking-wider text-muted">
            Tracks
          </h3>
          <div className="max-h-56 space-y-1.5 overflow-y-auto">
            {tracks.length === 0 && <p className="text-xs text-muted">No tracks yet.</p>}
            {tracks.map((t) => (
              <button
                key={t.id}
                disabled={busy === t.id}
                onClick={() => toggle("tracks", t.id, true)}
                className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left text-sm transition hover:bg-white/10 disabled:opacity-50"
              >
                <Cover url={t.cover_url || undefined} size={28} radius={7} icon={12} thumb />
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
                <span className="chip !px-2 !py-0.5 !text-[10px]">Publish</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
