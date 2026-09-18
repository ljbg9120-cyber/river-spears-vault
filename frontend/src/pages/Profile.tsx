/** An artist's public page — only what they marked public. */
import { motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import TrackRow from "../components/TrackRow";
import { Avatar, Empty, Icon, Modal, Spinner, useToast } from "../components/ui";
import { api, type PublicUser, type Track, type User } from "../lib/api";
import { useAuth } from "../lib/store";

type ProfileData = { user: PublicUser; tracks: Track[]; is_me: boolean };

export default function Profile() {
  const { handle } = useParams<{ handle: string }>();
  const { user, setUser } = useAuth();
  const toast = useToast();

  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    setData(await api.get<ProfileData>(`/api/u/${handle}`));
  }, [handle]);

  useEffect(() => {
    setLoading(true);
    load()
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [load]);

  if (loading) {
    return (
      <div className="flex justify-center py-32 text-muted">
        <Spinner size={28} />
      </div>
    );
  }

  if (!data) {
    return <Empty icon="user" title="No artist here" hint={`Nobody goes by @${handle}.`} />;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="card flex flex-col items-center gap-4 p-7 text-center sm:flex-row sm:text-left"
      >
        <Avatar name={data.user.display_name} src={data.user.avatar_url} size={80} />
        <div className="min-w-0 flex-1">
          <h1 className="title-xl text-3xl">{data.user.display_name}</h1>
          <p className="text-sm text-muted">@{data.user.handle}</p>
          {data.user.bio && <p className="mt-2 text-sm leading-relaxed">{data.user.bio}</p>}
        </div>
        {data.is_me && (
          <button onClick={() => setEditing(true)} className="btn-ghost !px-4 !py-2 text-sm">
            <Icon name="edit" size={15} /> Edit
          </button>
        )}
      </motion.div>

      <div className="mt-4">
        {data.tracks.length === 0 ? (
          <Empty
            title={data.is_me ? "Nothing public yet" : "Nothing public yet"}
            hint={
              data.is_me
                ? "Set a track's visibility to Public and it shows up here."
                : "This artist keeps their vault private."
            }
          />
        ) : (
          <div className="card divide-y divide-[var(--hairline)] p-1.5">
            {data.tracks.map((t, i) => (
              <TrackRow key={t.id} track={t} queue={data.tracks} index={i} />
            ))}
          </div>
        )}
      </div>

      {data.is_me && user && (
        <EditProfile
          open={editing}
          onClose={() => setEditing(false)}
          user={user}
          onSaved={(u) => {
            setUser(u);
            toast("Profile saved");
            load().catch(() => {});
          }}
        />
      )}
    </div>
  );
}

function EditProfile({
  open,
  onClose,
  user,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  user: User;
  onSaved: (u: User) => void;
}) {
  const [name, setName] = useState(user.display_name);
  const [handle, setHandle] = useState(user.handle);
  const [bio, setBio] = useState(user.bio);
  const [error, setError] = useState("");

  const save = async () => {
    setError("");
    try {
      onSaved(
        await api.patch<User>("/api/me", {
          display_name: name.trim(),
          handle: handle.trim(),
          bio,
        }),
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Edit profile">
      <div className="space-y-3">
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name" />
        <input className="field" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="handle" />
        <textarea
          className="field min-h-[90px] resize-y"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="Producer. Atlanta. Open for placements."
          maxLength={500}
        />
        {error && <p className="text-sm" style={{ color: "#ff8098" }}>{error}</p>}
        <button onClick={save} className="btn-primary w-full">Save</button>
      </div>
    </Modal>
  );
}
