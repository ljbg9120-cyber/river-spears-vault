/** An artist's public page: banner, picture, badges, followers, and their music. */
import { motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import TrackRow from "../components/TrackRow";
import FontPicker from "../components/FontPicker";
import { ProfileEffectLayer, frameRadius, frameStyle } from "../components/ProfileDecor";
import { Avatar, Empty, Icon, Modal, Spinner, useToast } from "../components/ui";
import {
  api, AVATAR_FRAMES, PROFILE_EFFECTS, type AvatarFrame, type FollowState,
  type ProfileEffect, type ProfileLink, type PublicUser, type Track, type User,
} from "../lib/api";
import { fontStack, glowStyle, loadFont } from "../lib/fonts";
import { useAuth, usePlayer } from "../lib/store";

type ProfileData = {
  user: PublicUser;
  tracks: Track[];
  is_me: boolean;
  follow: FollowState;
};

export default function Profile() {
  const { handle } = useParams<{ handle: string }>();
  const { user, setUser } = useAuth();
  const { current, playing, play } = usePlayer();
  const toast = useToast();

  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setData(await api.get<ProfileData>(`/api/u/${handle}`));
  }, [handle]);

  useEffect(() => {
    setLoading(true);
    load().catch(() => setData(null)).finally(() => setLoading(false));
  }, [load]);

  // A profile can be written in its owner's typeface, not the viewer's.
  useEffect(() => {
    if (data?.user.profile_font) loadFont(data.user.profile_font);
  }, [data?.user.profile_font]);

  const toggleFollow = async () => {
    if (!user) { toast("Sign in to follow people", "err"); return; }
    if (!data) return;
    setBusy(true);
    try {
      const next = data.follow.following
        ? await api.del<FollowState>(`/api/u/${handle}/follow`)
        : await api.post<FollowState>(`/api/u/${handle}/follow`);
      setData({ ...data, follow: next });
      toast(next.following ? `Following ${data.user.display_name}` : "Unfollowed");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not do that", "err");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-32 text-muted"><Spinner size={28} /></div>;
  }
  if (!data) {
    return <Empty icon="user" title="No artist here" hint={`Nobody goes by @${handle}.`} />;
  }

  const p = data.user;
  const accent = p.profile_accent || "rgb(var(--accent-rgb))";
  const accent2 = p.profile_accent2 || "rgb(var(--accent2-rgb))";

  return (
    <div className="mx-auto max-w-3xl">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="card overflow-hidden"
      >
        {/* ---- banner ---- */}
        <div
          className="relative h-36 w-full sm:h-48"
          style={{
            background: p.banner_url
              ? undefined
              : `linear-gradient(120deg, ${accent}, ${accent2})`,
          }}
        >
          {p.banner_url && (
            <img
              src={p.banner_url}
              alt=""
              className="h-full w-full object-cover"
              style={{ objectPosition: `center ${p.banner_focus ?? "center"}` }}
            />
          )}
          <ProfileEffectLayer
            effect={p.profile_effect ?? "none"}
            accent={accent}
            accent2={accent2}
          />
          {data.is_me && (
            <button
              onClick={() => setEditing(true)}
              className="absolute right-3 top-3 rounded-full px-3 py-1.5 text-xs font-semibold text-white backdrop-blur"
              style={{ background: "rgba(0,0,0,0.45)" }}
            >
              <Icon name="edit" size={12} /> Edit profile
            </button>
          )}
        </div>

        {/* ---- identity ---- */}
        <div className="relative z-10 px-5 pb-5 sm:px-7 sm:pb-7">
          <div className="-mt-12 flex items-end justify-between gap-4 sm:-mt-14">
            <span
              className="inline-flex"
              style={frameStyle(p.avatar_frame ?? "none", accent, accent2)}
            >
              <Avatar
                name={p.display_name}
                src={p.avatar_url}
                size={96}
                radius={frameRadius(p.avatar_frame ?? "none")}
              />
            </span>

            {!data.is_me && (
              <button
                onClick={toggleFollow}
                disabled={busy}
                className={data.follow.following ? "btn-ghost !px-5" : "btn-primary !px-5"}
              >
                {busy ? <Spinner size={15} />
                  : data.follow.following ? "Following" : "Follow"}
              </button>
            )}
          </div>

          <div className="mt-3">
            <h1
              className="title-xl text-2xl sm:text-3xl"
              style={{
                fontFamily: p.profile_font ? fontStack(p.profile_font) : undefined,
                // A gradient fill paints the text transparent, and a shadow
                // under transparent text shows through as a halo — which is
                // exactly the glow, so the two combine rather than conflict.
                ...(p.profile_accent2
                  ? {
                      backgroundImage: `linear-gradient(100deg, ${accent}, ${p.profile_accent2})`,
                      WebkitBackgroundClip: "text",
                      backgroundClip: "text",
                      color: "transparent",
                    }
                  : p.profile_accent
                    ? { color: p.profile_accent }
                    : {}),
                textShadow: glowStyle(p.profile_glow ?? 0, accent),
              }}
            >
              {p.display_name}
              {p.pronouns && (
                <span className="ml-2 align-middle text-sm font-medium text-muted">
                  {p.pronouns}
                </span>
              )}
            </h1>
            <p className="text-sm text-muted">@{p.handle}</p>
            {p.status_text && (
              <p
                className="mt-1 text-sm"
                style={{
                  color: accent,
                  fontFamily: p.profile_font ? fontStack(p.profile_font) : undefined,
                  textShadow: glowStyle((p.profile_glow ?? 0) * 0.6, accent),
                }}
              >
                {p.status_text}
              </p>
            )}
          </div>

          {p.bio && (
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{p.bio}</p>
          )}

          {p.links?.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {p.links.map((l, i) => (
                <a
                  key={i}
                  href={l.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="chip hover:underline"
                >
                  <Icon name="link" size={11} />
                  {l.label || new URL(l.url).hostname.replace(/^www\./, "")}
                </a>
              ))}
            </div>
          )}

          {p.badges?.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {p.badges.map((b) => (
                <span
                  key={b.id}
                  title={b.hint}
                  className="chip !py-0.5 !text-[11px]"
                  style={{
                    borderColor: `${accent}66`,
                    background: `${accent}1f`,
                  }}
                >
                  <Icon name="sparkles" size={10} />
                  {b.label}
                </span>
              ))}
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-4 text-sm">
            <span><strong>{data.follow.followers}</strong>{" "}
              <span className="text-muted">follower{data.follow.followers === 1 ? "" : "s"}</span></span>
            <span><strong>{data.follow.follows}</strong>{" "}
              <span className="text-muted">following</span></span>
            <span><strong>{data.tracks.length}</strong>{" "}
              <span className="text-muted">public track{data.tracks.length === 1 ? "" : "s"}</span></span>
          </div>
        </div>
      </motion.div>

      {(() => {
        const song = data.tracks.find((t) => t.id === p.profile_song_id);
        if (!song) return null;
        const isCurrent = current?.id === song.id;
        // Autoplay with sound is blocked by every browser, so this is a
        // deliberate button rather than something that silently fails.
        return (
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={() => play(song, data.tracks)}
            className="card mt-4 flex w-full items-center gap-3 p-3 text-left"
            style={{ borderColor: `${accent}66` }}
          >
            <span
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white"
              style={{ background: `linear-gradient(135deg, ${accent}, ${accent2})` }}
            >
              <Icon name={isCurrent && playing ? "pause" : "play"} size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] uppercase tracking-wider text-muted">
                {p.display_name.split(" ")[0]}&rsquo;s pick
              </span>
              <span className="block truncate font-display text-[15px] font-bold">
                {song.title}
              </span>
            </span>
          </motion.button>
        );
      })()}

      <div className="mt-4">
        {data.tracks.length === 0 ? (
          <Empty
            title="Nothing public yet"
            hint={data.is_me
              ? "Set a track's visibility to Public and it shows up here."
              : "This artist keeps their vault private."}
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
          onSaved={(u) => { setUser(u); load().catch(() => {}); }}
        />
      )}
    </div>
  );
}

function EditProfile({
  open, onClose, user, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  user: User;
  onSaved: (u: User) => void;
}) {
  const toast = useToast();
  const avatarRef = useRef<HTMLInputElement>(null);
  const bannerRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(user.display_name);
  const [handle, setHandle] = useState(user.handle);
  const [bio, setBio] = useState(user.bio);
  const [pronouns, setPronouns] = useState((user as unknown as PublicUser).pronouns ?? "");
  const [accent, setAccent] = useState((user as unknown as PublicUser).profile_accent ?? "");
  const [links, setLinks] = useState<ProfileLink[]>(
    ((user as unknown as PublicUser).links ?? []).slice(0, 5),
  );
  const me = user as unknown as PublicUser;
  const [accent2, setAccent2] = useState(me.profile_accent2 ?? "");
  const [status, setStatus] = useState(me.status_text ?? "");
  const [effect, setEffect] = useState<ProfileEffect>(me.profile_effect ?? "none");
  const [frame, setFrame] = useState<AvatarFrame>(me.avatar_frame ?? "none");
  const [focus, setFocus] = useState(me.banner_focus ?? "center");
  const [songId, setSongId] = useState<string | null>(me.profile_song_id ?? null);
  const [font, setFont] = useState(me.profile_font ?? "");
  const [glow, setGlow] = useState(me.profile_glow ?? 0);
  const [myTracks, setMyTracks] = useState<Track[]>([]);
  const [uploading, setUploading] = useState<"avatar" | "banner" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    api.get<Track[]>("/api/tracks?limit=200").then(setMyTracks).catch(() => {});
  }, [open]);

  const sendImage = async (kind: "avatar" | "banner", file: File) => {
    setUploading(kind);
    try {
      const form = new FormData();
      form.append("file", file);
      onSaved(await api.put<User>(`/api/me/${kind}`, form));
      toast(kind === "avatar" ? "Picture updated" : "Banner updated");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not upload that", "err");
    } finally {
      setUploading(null);
    }
  };

  const clearImage = async (kind: "avatar" | "banner") => {
    try {
      onSaved(await api.del<User>(`/api/me/${kind}`));
      toast("Removed");
    } catch {
      toast("Could not remove that", "err");
    }
  };

  const save = async () => {
    setError("");
    try {
      onSaved(await api.patch<User>("/api/me", {
        display_name: name.trim(),
        handle: handle.trim(),
        bio,
        pronouns: pronouns.trim(),
        profile_accent: accent,
        profile_accent2: accent2,
        status_text: status.trim(),
        profile_effect: effect,
        avatar_frame: frame,
        banner_focus: focus,
        profile_song_id: songId,
        profile_font: font,
        profile_glow: glow,
        links: links.filter((l) => l.url.trim()),
      }));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Edit profile" width={560}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => avatarRef.current?.click()}
            disabled={!!uploading}
            className="btn-ghost !px-4 !py-2 text-sm"
          >
            {uploading === "avatar" ? <Spinner size={14} /> : <Icon name="user" size={14} />}
            Change picture
          </button>
          <button onClick={() => clearImage("avatar")} className="btn-ghost !px-3 !py-2 text-xs">
            Remove
          </button>
          <button
            onClick={() => bannerRef.current?.click()}
            disabled={!!uploading}
            className="btn-ghost !px-4 !py-2 text-sm"
          >
            {uploading === "banner" ? <Spinner size={14} /> : <Icon name="upload" size={14} />}
            Change banner
          </button>
          <button onClick={() => clearImage("banner")} className="btn-ghost !px-3 !py-2 text-xs">
            Remove
          </button>
        </div>
        <p className="text-xs text-muted">
          Animated GIFs stay animated, up to 8 MB and 1024px.
        </p>

        <input ref={avatarRef} type="file" accept="image/*" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) sendImage("avatar", f); e.target.value = ""; }} />
        <input ref={bannerRef} type="file" accept="image/*" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) sendImage("banner", f); e.target.value = ""; }} />

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wider text-muted">Name</span>
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wider text-muted">Handle</span>
            <input className="field" value={handle} onChange={(e) => setHandle(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wider text-muted">Pronouns</span>
            <input className="field" value={pronouns} placeholder="they/them"
              onChange={(e) => setPronouns(e.target.value)} maxLength={40} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wider text-muted">Profile colour</span>
            <input type="color" className="field !h-[46px] !p-1"
              value={accent || "#7c5cff"} onChange={(e) => setAccent(e.target.value)} />
          </label>
        </div>

        <label className="block">
          <span className="mb-1 block text-xs uppercase tracking-wider text-muted">About</span>
          <textarea className="field min-h-[90px] resize-y" value={bio} maxLength={500}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Producer. Atlanta. Open for placements." />
        </label>

        <div>
          <span className="mb-1 block text-xs uppercase tracking-wider text-muted">
            Links (up to 5)
          </span>
          <div className="space-y-2">
            {links.map((l, i) => (
              <div key={i} className="flex gap-2">
                <input className="field !py-2 !text-sm" placeholder="Label" value={l.label}
                  onChange={(e) => setLinks(links.map((x, k) => k === i ? { ...x, label: e.target.value } : x))} />
                <input className="field !py-2 !text-sm" placeholder="https://…" value={l.url}
                  onChange={(e) => setLinks(links.map((x, k) => k === i ? { ...x, url: e.target.value } : x))} />
                <button onClick={() => setLinks(links.filter((_, k) => k !== i))}
                  className="rounded-lg p-2 text-muted hover:text-ink" aria-label="Remove link">
                  <Icon name="x" size={14} />
                </button>
              </div>
            ))}
            {links.length < 5 && (
              <button onClick={() => setLinks([...links, { label: "", url: "" }])}
                className="btn-ghost w-full !py-2 text-xs">
                <Icon name="plus" size={13} /> Add a link
              </button>
            )}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wider text-muted">
              Second colour
            </span>
            <input type="color" className="field !h-[46px] !p-1"
              value={accent2 || "#22d3ee"} onChange={(e) => setAccent2(e.target.value)} />
            <span className="mt-1 block text-[11px] text-muted">
              Makes your name a gradient between the two.
            </span>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wider text-muted">
              Status
            </span>
            <input className="field" value={status} maxLength={80}
              placeholder="working on the album"
              onChange={(e) => setStatus(e.target.value)} />
          </label>
        </div>

        <div>
          <span className="mb-1.5 block text-xs uppercase tracking-wider text-muted">
            Banner effect
          </span>
          <div className="flex flex-wrap gap-1.5">
            {PROFILE_EFFECTS.map((e) => (
              <button key={e.id} onClick={() => setEffect(e.id)}
                className={`chip ${effect === e.id ? "chip-on" : ""}`}>
                {e.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="mb-1.5 block text-xs uppercase tracking-wider text-muted">
            Picture frame
          </span>
          <div className="flex flex-wrap gap-1.5">
            {AVATAR_FRAMES.map((f) => (
              <button key={f.id} onClick={() => setFrame(f.id)}
                className={`chip ${frame === f.id ? "chip-on" : ""}`}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="mb-1.5 block text-xs uppercase tracking-wider text-muted">
            Banner focus
          </span>
          <div className="flex flex-wrap gap-1.5">
            {(["top", "center", "bottom"] as const).map((f) => (
              <button key={f} onClick={() => setFocus(f)}
                className={`chip ${focus === f ? "chip-on" : ""}`}>
                {f}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="mb-1 block text-xs uppercase tracking-wider text-muted">
            Profile song
          </span>
          <select className="field" value={songId ?? ""}
            onChange={(e) => setSongId(e.target.value || null)}>
            <option value="" style={{ color: "#111" }}>None</option>
            {myTracks.map((t) => (
              <option key={t.id} value={t.id} style={{ color: "#111" }}>{t.title}</option>
            ))}
          </select>
          <span className="mt-1 block text-[11px] text-muted">
            Plays when someone opens your profile. Choosing one makes that track
            public so visitors can actually hear it.
          </span>
        </label>

        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-xs uppercase tracking-wider text-muted">
              Profile typeface
            </span>
            {font && (
              <button onClick={() => setFont("")} className="text-[11px] text-muted underline">
                use the default
              </button>
            )}
          </div>
          <FontPicker
            value={font}
            onPick={setFont}
            glow={glow}
            accent={accent || "#7c5cff"}
            sample={name.slice(0, 2) || "Aa"}
          />
          <p className="mt-1.5 text-[11px] text-muted">
            This is what visitors see on your page, whatever font they use
            elsewhere.
          </p>
        </div>

        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-xs uppercase tracking-wider text-muted">Glow</span>
            <span className="font-mono text-xs text-muted">
              {glow > 0 ? `${Math.round(glow * 100)}%` : "off"}
            </span>
          </div>
          <input
            type="range" min={0} max={1} step={0.05} value={glow}
            onChange={(e) => setGlow(Number(e.target.value))}
            className="w-full" aria-label="Name glow"
          />
          <p
            className="mt-2 text-center text-2xl font-bold"
            style={{
              fontFamily: font ? `"${font}", Outfit, sans-serif` : undefined,
              color: glow ? (accent || "#7c5cff") : undefined,
              textShadow: glow
                ? [4, 12, 28, 52].map((r) => `0 0 ${(r * glow).toFixed(1)}px ${accent || "#7c5cff"}`).join(", ")
                : undefined,
            }}
          >
            {name || "Your name"}
          </p>
          <p className="mt-1 text-[11px] text-muted">
            Lights your name up in your profile colour. Pairs well with Monoton
            or Audiowide.
          </p>
        </div>

        {error && <p className="text-sm" style={{ color: "#ff8098" }}>{error}</p>}
        <button onClick={save} className="btn-primary w-full">Save profile</button>
      </div>
    </Modal>
  );
}
