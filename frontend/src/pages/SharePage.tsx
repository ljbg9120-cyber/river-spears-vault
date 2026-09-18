/** What a listener sees. No account, no sign-up wall — and the artist's theme. */
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Cover from "../components/Cover";
import TrackRow from "../components/TrackRow";
import { Logo } from "../components/Shell";
import { Avatar, Empty, Icon, Spinner } from "../components/ui";
import { api, formatTime, type SharePayload } from "../lib/api";
import { BRAND } from "../lib/brand";

export default function SharePage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<SharePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [dead, setDead] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .get<SharePayload>(`/api/share/${token}`)
      .then((payload) => {
        if (!alive) return;
        setData(payload);
        // Paint the whole page in the artist's colours while this link is open.
        window.dispatchEvent(
          new CustomEvent("vault:guest-theme", { detail: payload.owner.theme }),
        );
      })
      .catch(() => alive && setDead(true))
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
      window.dispatchEvent(new CustomEvent("vault:guest-theme", { detail: null }));
    };
  }, [token]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted">
        <Spinner size={30} />
      </div>
    );
  }

  if (dead || !data) {
    return (
      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-4">
        <Empty
          icon="lock"
          title="This link is closed"
          hint="It expired, or the artist revoked it."
          action={
            <Link to="/" className="btn-primary">
              See what Vault is
            </Link>
          }
        />
      </div>
    );
  }

  const totalLength = data.tracks.reduce((s, t) => s + t.duration, 0);

  return (
    <div className="relative z-10 mx-auto max-w-3xl px-3 pb-player pt-6 sm:px-5">
      <div className="mb-6 flex items-center justify-between">
        <Link to="/">
          <Logo size={26} />
        </Link>
        <Link to="/signup" className="btn-ghost !px-4 !py-2 text-xs">
          Make your own — free
        </Link>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 240, damping: 26 }}
        className="card p-6 text-center sm:p-9"
      >
        <div className="mb-4 flex justify-center">
          {data.cover_url ? (
            <Cover
              url={data.cover_url}
              size={168}
              radius={22}
              icon={48}
              className="shadow-lift"
            />
          ) : (
            <Avatar
              name={data.owner.display_name}
              src={data.owner.avatar_url}
              size={68}
            />
          )}
        </div>
        <p className="flex items-center justify-center gap-2 text-sm text-muted">
          {data.cover_url && (
            <Avatar
              name={data.owner.display_name}
              src={data.owner.avatar_url}
              size={20}
            />
          )}
          {data.owner.display_name} shared {data.kind === "album" ? "an album" : "a track"}
        </p>
        <h1 className="title-xl mt-1 text-3xl sm:text-4xl">{data.title}</h1>
        <p className="mt-2 text-sm text-muted">
          {data.tracks.length} {data.tracks.length === 1 ? "track" : "tracks"} ·{" "}
          {formatTime(totalLength)}
          {data.allow_comments && " · feedback welcome"}
        </p>
        {data.allow_comments && (
          <p className="mt-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs"
             style={{ background: "rgb(var(--accent-rgb) / 0.14)", color: "rgb(var(--accent-rgb))" }}>
            <Icon name="comment" size={12} />
            Open a track to pin a note to the exact second
          </p>
        )}
      </motion.div>

      <div className="card mt-4 divide-y divide-[var(--hairline)] p-1.5">
        {data.tracks.map((t, i) => (
          <TrackRow key={t.id} track={t} queue={data.tracks} index={i} shareToken={token} />
        ))}
      </div>

      <p className="mt-8 text-center text-xs text-muted">
        Shared privately with {BRAND.short} ·{" "}
        <Link to="/signup" className="underline">
          free, unlimited, no card
        </Link>
      </p>
    </div>
  );
}
