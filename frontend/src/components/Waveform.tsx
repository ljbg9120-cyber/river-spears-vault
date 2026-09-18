/** The waveform: click to seek, hover to preview, comments pinned underneath. */
import { useEffect, useRef, useState } from "react";
import type { Comment } from "../lib/api";
import { formatTime } from "../lib/api";

type Props = {
  peaks: number[];
  progress: number; // 0..1
  height?: number;
  duration?: number;
  comments?: Comment[];
  live?: boolean; // animate the played portion while audio runs
  onSeek?: (ratio: number) => void;
  onCommentClick?: (c: Comment) => void;
};

export default function Waveform({
  peaks,
  progress,
  height = 72,
  duration = 0,
  comments = [],
  live = false,
  onSeek,
  onCommentClick,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const frame = useRef(0);

  // Redraw on any visual input; a rAF keeps the played edge shimmering.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;

    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = wrap.clientWidth;
      const h = height;
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const style = getComputedStyle(document.documentElement);
      const accent = style.getPropertyValue("--accent-rgb").trim() || "124 92 255";
      const accent2 = style.getPropertyValue("--accent2-rgb").trim() || "34 211 238";
      const muted = style.getPropertyValue("--muted-rgb").trim() || "150 148 178";

      const source = peaks.length ? peaks : new Array(120).fill(0.12);
      const barW = 3;
      const gap = 1.5;
      const count = Math.max(24, Math.floor(w / (barW + gap)));
      const mid = h / 2;
      frame.current += 1;

      for (let i = 0; i < count; i++) {
        const ratio = i / count;
        // Resample the stored peaks to however many bars fit right now.
        const from = Math.floor((i / count) * source.length);
        const to = Math.max(from + 1, Math.floor(((i + 1) / count) * source.length));
        let peak = 0;
        for (let k = from; k < to && k < source.length; k++) {
          if (source[k] > peak) peak = source[k];
        }

        const played = ratio <= progress;
        const atEdge = live && Math.abs(ratio - progress) < 0.012;
        const wobble = atEdge ? 1 + Math.sin(frame.current * 0.25) * 0.18 : 1;
        const barH = Math.max(2, peak * (h * 0.86) * wobble);
        const x = i * (barW + gap);
        const y = mid - barH / 2;

        if (played) {
          const grad = ctx.createLinearGradient(0, y, 0, y + barH);
          grad.addColorStop(0, `rgb(${accent2})`);
          grad.addColorStop(1, `rgb(${accent})`);
          ctx.fillStyle = grad;
        } else {
          const hovered = hover !== null && ratio <= hover;
          ctx.fillStyle = `rgb(${muted} / ${hovered ? 0.55 : 0.3})`;
        }

        ctx.beginPath();
        ctx.roundRect(x, y, barW, barH, 1.5);
        ctx.fill();
      }

      // A soft glow riding the playhead.
      if (progress > 0 && progress < 1) {
        const px = progress * w;
        const glow = ctx.createRadialGradient(px, mid, 0, px, mid, 26);
        glow.addColorStop(0, `rgb(${accent2} / 0.45)`);
        glow.addColorStop(1, `rgb(${accent2} / 0)`);
        ctx.fillStyle = glow;
        ctx.fillRect(px - 26, 0, 52, h);
      }

      if (live) raf = requestAnimationFrame(draw);
    };

    draw();
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [peaks, progress, height, hover, live]);

  const ratioFrom = (e: React.MouseEvent | React.TouchEvent) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const clientX =
      "touches" in e ? e.touches[0]?.clientX ?? 0 : (e as React.MouseEvent).clientX;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };

  const pinned = comments.filter((c) => c.at_sec !== null && duration > 0);

  return (
    <div className="w-full">
      <div
        ref={wrapRef}
        className="relative w-full cursor-pointer select-none"
        style={{ height }}
        onClick={(e) => onSeek?.(ratioFrom(e))}
        onMouseMove={(e) => setHover(ratioFrom(e))}
        onMouseLeave={() => setHover(null)}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") onSeek?.(Math.min(1, progress + 0.02));
          if (e.key === "ArrowLeft") onSeek?.(Math.max(0, progress - 0.02));
        }}
      >
        <canvas ref={canvasRef} className="h-full w-full" />

        {hover !== null && duration > 0 && (
          <div
            className="pointer-events-none absolute -top-7 z-10 -translate-x-1/2 rounded-md px-1.5 py-0.5 font-mono text-[11px]"
            style={{
              left: `${hover * 100}%`,
              background: "rgb(var(--accent-rgb))",
              color: "white",
            }}
          >
            {formatTime(hover * duration)}
          </div>
        )}
      </div>

      {pinned.length > 0 && (
        <div className="relative mt-1 h-6">
          {pinned.map((c) => (
            <button
              key={c.id}
              onClick={() => onCommentClick?.(c)}
              title={`${c.author_name} at ${formatTime(c.at_sec!)}: ${c.body}`}
              className="absolute top-0 -translate-x-1/2 transition hover:scale-125"
              style={{ left: `${Math.min(99, (c.at_sec! / duration) * 100)}%` }}
            >
              <span
                className="block h-2.5 w-2.5 rounded-full ring-2 ring-[rgb(var(--bg-rgb))]"
                style={{ background: "rgb(var(--accent2-rgb))" }}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
