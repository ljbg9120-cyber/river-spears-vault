/** One track, as a list row or a grid card. */
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { formatDate, formatTime, type Track } from "../lib/api";
import { usePlayer } from "../lib/store";
import Cover from "./Cover";
import { Icon } from "./ui";
import Waveform from "./Waveform";

const VIS = {
  private: { icon: "lock" as const, label: "Private" },
  unlisted: { icon: "link" as const, label: "Link only" },
  public: { icon: "globe" as const, label: "Public" },
};

type Props = {
  track: Track;
  queue: Track[];
  index?: number;
  shareToken?: string;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (id: string) => void;
  view?: "list" | "grid";
};

export default function TrackRow({
  track,
  queue,
  index = 0,
  shareToken,
  selectable = false,
  selected = false,
  onSelect,
  view = "list",
}: Props) {
  const { current, playing, play, time, duration } = usePlayer();
  const isCurrent = current?.id === track.id;
  const total = isCurrent ? duration || track.duration : track.duration;
  const progress = isCurrent && total > 0 ? Math.min(1, time / total) : 0;
  // A listener holding a share link does not need to be told it is private.
  const vis = shareToken ? null : VIS[track.visibility];

  const PlayButton = (
    <motion.button
      whileTap={{ scale: 0.88 }}
      whileHover={{ scale: 1.06 }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        play(track, queue, shareToken);
      }}
      className="flex shrink-0 items-center justify-center rounded-full text-white"
      style={{
        width: view === "grid" ? 52 : 42,
        height: view === "grid" ? 52 : 42,
        background: isCurrent
          ? "linear-gradient(135deg, rgb(var(--accent-rgb)), rgb(var(--accent2-rgb)))"
          : "rgb(var(--accent-rgb) / 0.18)",
        color: isCurrent ? "white" : "rgb(var(--accent-rgb))",
        boxShadow: isCurrent ? "0 8px 24px -8px rgb(var(--accent-rgb))" : "none",
      }}
      aria-label={isCurrent && playing ? "Pause" : `Play ${track.title}`}
    >
      <Icon name={isCurrent && playing ? "pause" : "play"} size={view === "grid" ? 20 : 16} />
    </motion.button>
  );

  if (view === "grid") {
    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: Math.min(index * 0.03, 0.4), type: "spring", stiffness: 300, damping: 26 }}
        whileHover={{ y: -4 }}
        className="card group relative overflow-hidden p-4"
        style={{
          borderColor: isCurrent ? "rgb(var(--accent-rgb) / 0.5)" : undefined,
          boxShadow: isCurrent ? "0 0 40px -14px rgb(var(--accent-rgb))" : undefined,
        }}
      >
        {selectable && (
          <Checkbox checked={selected} onChange={() => onSelect?.(track.id)} corner />
        )}
        <div className="mb-3 flex items-start justify-between gap-3">
          <span className="relative">
            <Cover url={track.cover_url || undefined} size={52} radius={14} icon={20} thumb />
            {/* Always visible: hover-only controls strand every touch device. */}
            <span className="absolute inset-0 flex items-center justify-center rounded-[14px] bg-black/30 transition group-hover:bg-black/45">
              {PlayButton}
            </span>
          </span>
          {vis && (
            <div className="flex items-center gap-1 text-muted">
              <Icon name={vis.icon} size={13} />
              <span className="text-[11px]">{vis.label}</span>
            </div>
          )}
        </div>

        <Link to={`/track/${track.id}${shareToken ? `?t=${shareToken}` : ""}`}>
          <h3 className="truncate font-display text-base font-bold group-hover:underline">
            {track.title}
          </h3>
        </Link>

        <div className="mt-2 opacity-80">
          <Waveform
            peaks={track.peaks}
            progress={progress}
            height={38}
            duration={total}
            live={isCurrent && playing}
            onSeek={undefined}
          />
        </div>

        <div className="mt-2 flex items-center justify-between text-xs text-muted">
          <span className="font-mono">{formatTime(total)}</span>
          <Meta track={track} />
        </div>
        {track.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {track.tags.slice(0, 3).map((t) => (
              <span key={t} className="chip !px-2 !py-0.5 !text-[10px]">
                {t}
              </span>
            ))}
          </div>
        )}
      </motion.div>
    );
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.02, 0.3) }}
      className="group relative flex items-center gap-3 rounded-2xl px-2.5 py-2.5 transition sm:gap-4 sm:px-3"
      style={{
        background: isCurrent ? "rgb(var(--accent-rgb) / 0.1)" : "transparent",
      }}
      onMouseEnter={(e) => {
        if (!isCurrent) e.currentTarget.style.background = "var(--panel)";
      }}
      onMouseLeave={(e) => {
        if (!isCurrent) e.currentTarget.style.background = "transparent";
      }}
    >
      {selectable && <Checkbox checked={selected} onChange={() => onSelect?.(track.id)} />}
      {PlayButton}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link
            to={`/track/${track.id}${shareToken ? `?t=${shareToken}` : ""}`}
            className="truncate font-display text-[15px] font-semibold hover:underline"
          >
            {track.title}
          </Link>
          {track.bpm && (
            <span className="hidden shrink-0 font-mono text-[11px] text-muted sm:inline">
              {track.bpm} BPM
            </span>
          )}
          {track.song_key && (
            <span className="hidden shrink-0 font-mono text-[11px] text-muted sm:inline">
              {track.song_key}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted">
          {vis && <Icon name={vis.icon} size={11} />}
          <span>{formatDate(track.created_at)}</span>
          <span className="font-mono">{formatTime(total)}</span>
        </div>
      </div>

      <div className="hidden min-w-0 flex-[1.4] lg:block">
        <Waveform
          peaks={track.peaks}
          progress={progress}
          height={34}
          duration={total}
          live={isCurrent && playing}
        />
      </div>

      <Meta track={track} />
    </motion.div>
  );
}

function Meta({ track }: { track: Track }) {
  return (
    <div className="flex shrink-0 items-center gap-3 text-xs text-muted">
      {track.comment_count > 0 && (
        <span className="flex items-center gap-1">
          <Icon name="comment" size={13} />
          {track.comment_count}
        </span>
      )}
      {track.like_count > 0 && (
        <span className="flex items-center gap-1">
          <Icon name="heart" size={13} filled={track.liked_by_me} />
          {track.like_count}
        </span>
      )}
      {track.plays > 0 && <span className="hidden sm:inline">{track.plays} plays</span>}
    </div>
  );
}

function Checkbox({
  checked,
  onChange,
  corner = false,
}: {
  checked: boolean;
  onChange: () => void;
  corner?: boolean;
}) {
  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onChange();
      }}
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
        corner ? "absolute right-3 top-3 z-10" : ""
      }`}
      style={{
        borderColor: checked ? "rgb(var(--accent-rgb))" : "var(--hairline)",
        background: checked ? "rgb(var(--accent-rgb))" : "transparent",
        color: "white",
      }}
      aria-label={checked ? "Deselect" : "Select"}
    >
      {checked && <Icon name="check" size={13} />}
    </button>
  );
}
