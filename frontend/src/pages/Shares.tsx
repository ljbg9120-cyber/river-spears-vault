/** Every link you have handed out, and the switch to kill it. */
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Empty, Icon, Spinner, useToast } from "../components/ui";
import { api, formatDate, parseUtc, type ShareLink } from "../lib/api";

export default function Shares() {
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  useEffect(() => {
    api
      .get<ShareLink[]>("/api/shares")
      .then(setLinks)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const revoke = async (link: ShareLink) => {
    if (!confirm(`Revoke "${link.label}"? Anyone holding it loses access immediately.`))
      return;
    await api.del(`/api/shares/${link.id}`);
    setLinks((l) => l.filter((x) => x.id !== link.id));
    toast("Link revoked");
  };

  const copy = async (link: ShareLink) => {
    await navigator.clipboard.writeText(link.url);
    toast("Copied");
  };

  const expired = (link: ShareLink) =>
    link.expires_at !== null && parseUtc(link.expires_at) < new Date();

  if (loading) {
    return (
      <div className="flex justify-center py-32 text-muted">
        <Spinner size={28} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="title-xl text-3xl sm:text-4xl">Shared links</h1>
        <p className="mt-1 text-sm text-muted">
          Every private link you have made. Revoking one kills it everywhere, instantly.
        </p>
      </motion.div>

      {links.length === 0 ? (
        <Empty
          icon="link"
          title="No links yet"
          hint="Open a track and hit Share to make one."
          action={
            <Link to="/library" className="btn-primary">
              Go to my library
            </Link>
          }
        />
      ) : (
        <div className="mt-5 space-y-2">
          <AnimatePresence initial={false}>
            {links.map((link, i) => (
              <motion.div
                key={link.id}
                layout
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ delay: Math.min(i * 0.03, 0.3) }}
                className="card flex flex-wrap items-center gap-3 p-4"
                style={{ opacity: expired(link) ? 0.55 : 1 }}
              >
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                  style={{
                    background: "rgb(var(--accent-rgb) / 0.14)",
                    color: "rgb(var(--accent-rgb))",
                  }}
                >
                  <Icon name={link.folder_id ? "folder" : "music"} size={18} />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="truncate font-display text-sm font-bold">
                    {link.label}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted">
                    <span>{link.views} opens</span>
                    <span>made {formatDate(link.created_at)}</span>
                    {link.allow_download && (
                      <span className="flex items-center gap-1">
                        <Icon name="download" size={11} /> downloads on
                      </span>
                    )}
                    {link.allow_comments && (
                      <span className="flex items-center gap-1">
                        <Icon name="comment" size={11} /> feedback on
                      </span>
                    )}
                    {link.expires_at && (
                      <span>
                        {expired(link) ? "expired" : `expires ${formatDate(link.expires_at)}`}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <button onClick={() => copy(link)} className="btn-ghost !px-3 !py-1.5 text-xs">
                    <Icon name="link" size={13} /> Copy
                  </button>
                  <a
                    href={`/s/${link.token}`}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-ghost !px-3 !py-1.5 text-xs"
                  >
                    Open
                  </a>
                  <button
                    onClick={() => revoke(link)}
                    className="rounded-lg p-2 text-muted transition hover:text-ink"
                    style={{ color: "#ff8098" }}
                    aria-label="Revoke"
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
