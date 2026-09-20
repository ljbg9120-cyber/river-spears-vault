/** Find people by name or handle, and follow them. */
import { motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Avatar, Empty, Icon, Spinner, useToast } from "../components/ui";
import { api, type FollowState, type PublicUser } from "../lib/api";
import { useAuth } from "../lib/store";

export default function People() {
  const { user } = useAuth();
  const toast = useToast();

  const [q, setQ] = useState("");
  const [people, setPeople] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [follows, setFollows] = useState<Record<string, FollowState>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const search = useCallback(async (term: string) => {
    setPeople(await api.get<PublicUser[]>(`/api/users/search?q=${encodeURIComponent(term)}`));
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    // Debounce so typing does not fire a request per keystroke.
    const id = setTimeout(() => {
      search(q).catch(() => {}).finally(() => alive && setLoading(false));
    }, q ? 220 : 0);
    return () => { alive = false; clearTimeout(id); };
  }, [q, search]);

  const toggle = async (person: PublicUser) => {
    if (!user) { toast("Sign in to follow people", "err"); return; }
    setBusy(person.id);
    const already = follows[person.handle]?.following;
    try {
      const next = already
        ? await api.del<FollowState>(`/api/u/${person.handle}/follow`)
        : await api.post<FollowState>(`/api/u/${person.handle}/follow`);
      setFollows((f) => ({ ...f, [person.handle]: next }));
      toast(next.following ? `Following ${person.display_name}` : "Unfollowed");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not do that", "err");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="title-xl text-3xl sm:text-4xl">People</h1>
        <p className="mt-1 text-sm text-muted">
          Search by name or @handle. Following someone keeps their public music
          easy to find.
        </p>
      </motion.div>

      <div className="relative mt-5">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">
          <Icon name="search" size={16} />
        </span>
        <input
          className="field !py-3 !pl-10"
          placeholder="Search names and @handles…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
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

      {loading ? (
        <div className="flex justify-center py-16 text-muted"><Spinner size={24} /></div>
      ) : people.length === 0 ? (
        <Empty
          icon="user"
          title={q ? "Nobody by that name" : "No one here yet"}
          hint={q ? "Try part of a name, or their @handle." : undefined}
        />
      ) : (
        <div className="mt-4 space-y-2">
          {people.map((person, i) => {
            const state = follows[person.handle];
            const isMe = user?.id === person.id;
            return (
              <motion.div
                key={person.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.03, 0.3) }}
                className="card flex items-center gap-3 p-3"
              >
                <Link to={`/u/${person.handle}`} className="shrink-0">
                  <Avatar name={person.display_name} src={person.avatar_url} size={44} />
                </Link>

                <div className="min-w-0 flex-1">
                  <Link
                    to={`/u/${person.handle}`}
                    className="block truncate font-display text-[15px] font-bold hover:underline"
                  >
                    {person.display_name}
                    {person.pronouns && (
                      <span className="ml-1.5 text-xs font-medium text-muted">
                        {person.pronouns}
                      </span>
                    )}
                  </Link>
                  <span className="block truncate text-xs text-muted">@{person.handle}</span>
                  {person.bio && (
                    <span className="mt-0.5 block truncate text-xs text-muted">{person.bio}</span>
                  )}
                  {person.badges?.length > 0 && (
                    <span className="mt-1 flex flex-wrap gap-1">
                      {person.badges.slice(0, 3).map((b) => (
                        <span key={b.id} title={b.hint} className="chip !px-1.5 !py-0 !text-[10px]">
                          {b.label}
                        </span>
                      ))}
                    </span>
                  )}
                </div>

                {!isMe && (
                  <button
                    onClick={() => toggle(person)}
                    disabled={busy === person.id}
                    className={state?.following ? "btn-ghost !px-4 !py-2 text-xs" : "btn-primary !px-4 !py-2 text-xs"}
                  >
                    {busy === person.id
                      ? <Spinner size={13} />
                      : state?.following ? "Following" : "Follow"}
                  </button>
                )}
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
