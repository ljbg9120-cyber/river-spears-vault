/**
 * The audio visualizer.
 *
 * One canvas, one rAF loop, reading the player's live AnalyserNode. Every style
 * is drawn to be *seen* — thick strokes, real glow, amplitudes that use the
 * space they are given. When nothing is playing it idles on a slow sine rather
 * than freezing, so the screen never looks broken. "off" draws nothing at all.
 */
import { useEffect, useRef } from "react";
import type { Theme } from "../lib/api";
import { hexToRgb, usePlayer } from "../lib/store";

export const VISUALIZERS = [
  { id: "bars", name: "Bars", hint: "Classic spectrum" },
  { id: "mirror", name: "Mirror", hint: "Bars from the centre" },
  { id: "wave", name: "Wave", hint: "Glowing oscilloscope" },
  { id: "twin", name: "Twin Wave", hint: "Mirrored ribbons" },
  { id: "orb", name: "Orb", hint: "Breathing sphere" },
  { id: "ring", name: "Ring", hint: "Spectrum in a circle" },
  { id: "bloom", name: "Bloom", hint: "Heavy pulsing light" },
  { id: "rings", name: "Ripples", hint: "A ring on every hit" },
  { id: "tunnel", name: "Tunnel", hint: "Flying down a shaft" },
  { id: "starburst", name: "Starburst", hint: "Rays off the centre" },
  { id: "matrix", name: "Matrix", hint: "LED wall" },
  { id: "spiral", name: "Spiral", hint: "Spinning galaxy arm" },
  { id: "terrain", name: "Terrain", hint: "Scrolling mountains" },
  { id: "kaleido", name: "Kaleidoscope", hint: "Six-fold mirror" },
  { id: "sparks", name: "Sparks", hint: "Bursts on the beat" },
  { id: "video", name: "Your video", hint: "Play your own clip" },
  { id: "off", name: "Off", hint: "No visualizer" },
] as const;

type Props = {
  theme: Theme;
  /** Fills its parent; the parent decides the size. */
  className?: string;
  /** Overrides the saved style — used by the settings previews. */
  style?: string;
  /** Previews run at half rate; a grid of them should not cost a full frame each. */
  preview?: boolean;
};

function rgb(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).split(" ").map(Number);
  return [r, g, b];
}

const css = (c: [number, number, number], a = 1) =>
  `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;

export default function Visualizer({
  theme,
  className = "",
  style,
  preview = false,
}: Props) {
  const { analyser, playing } = usePlayer();
  const ref = useRef<HTMLCanvasElement>(null);

  // Live values the loop reads without being torn down each render.
  const conf = useRef({ theme, analyser, playing, style, preview });
  conf.current = { theme, analyser, playing, style, preview };

  const kind = style ?? theme.visualizer ?? "bars";

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let w = 0;
    let h = 0;
    let t = 0;
    let frame = 0;
    const freq = new Uint8Array(128);
    const timeData = new Uint8Array(256);
    const ripples: { r: number; strength: number }[] = [];
    const sparks: { x: number; y: number; vx: number; vy: number; life: number }[] = [];
    const history: number[][] = [];
    let lastBeat = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const read = (): { bins: number[]; energy: number; bass: number } => {
      const { analyser: an, playing: on } = conf.current;
      const live = an && on;
      if (live) an.getByteFrequencyData(freq);

      const bins: number[] = [];
      for (let i = 0; i < 64; i++) {
        bins.push(
          live
            ? freq[i] / 255
            : // Idle motion, lively enough to read as "alive but silent".
              (Math.sin(t * 1.5 + i * 0.3) * 0.5 + 0.5) * 0.34 + 0.06,
        );
      }
      const energy = bins.slice(0, 40).reduce((a, b) => a + b, 0) / 40;
      const bass = bins.slice(0, 6).reduce((a, b) => a + b, 0) / 6;
      return { bins, energy, bass };
    };

    const draw = () => {
      raf = requestAnimationFrame(draw);
      frame++;
      // Previews idle at half rate; the real thing always runs full speed.
      if (conf.current.preview && frame % 2) return;

      const th = conf.current.theme;
      const which = conf.current.style ?? th.visualizer ?? "bars";
      t += 0.016;

      ctx.clearRect(0, 0, w, h);
      if (which === "off" || w === 0 || h === 0) return;

      const a = rgb(th.accent);
      const b = rgb(th.accent2);
      // Presence: even at the low end of the slider the art still commands space.
      const scale = 0.55 + (th.visualizer_size ?? 0.85) * 0.75;
      const { bins, energy, bass } = read();
      const cx = w / 2;
      const cy = h / 2;
      const min = Math.min(w, h);

      /** Bin for a point at `p` (0..1) around a circle, mirrored so both
       *  halves match instead of sweeping loud-to-quiet around one side. */
      const radialBin = (p: number) =>
        bins[Math.min(bins.length - 1, Math.floor(Math.abs(p * 2 - 1) * bins.length))];

      const glow = (colour: string, blur: number) => {
        ctx.shadowColor = colour;
        ctx.shadowBlur = conf.current.preview ? blur * 0.4 : blur;
      };
      const noGlow = () => {
        ctx.shadowBlur = 0;
      };

      switch (which) {
        case "bars": {
          const count = 56;
          const bw = w / count;
          glow(css(b, 0.9), 22);
          for (let i = 0; i < count; i++) {
            const v = bins[Math.floor((i / count) * bins.length)];
            const bh = Math.max(3, v * h * 0.95 * scale);
            const grad = ctx.createLinearGradient(0, h - bh, 0, h);
            grad.addColorStop(0, css(b, 1));
            grad.addColorStop(0.55, css(a, 0.95));
            grad.addColorStop(1, css(a, 0.4));
            ctx.fillStyle = grad;
            const x = i * bw + bw * 0.12;
            const bwidth = bw * 0.76;
            ctx.beginPath();
            ctx.roundRect(x, h - bh, bwidth, bh, bwidth / 2);
            ctx.fill();
          }
          noGlow();
          break;
        }

        case "mirror": {
          const count = 56;
          const bw = w / count;
          glow(css(a, 0.9), 24);
          for (let i = 0; i < count; i++) {
            const v = bins[Math.floor((i / count) * bins.length)];
            const half = Math.max(2, v * h * 0.48 * scale);
            const grad = ctx.createLinearGradient(0, cy - half, 0, cy + half);
            grad.addColorStop(0, css(b, 0.95));
            grad.addColorStop(0.5, css(a, 1));
            grad.addColorStop(1, css(b, 0.95));
            ctx.fillStyle = grad;
            const x = i * bw + bw * 0.12;
            const bwidth = bw * 0.76;
            ctx.beginPath();
            ctx.roundRect(x, cy - half, bwidth, half * 2, bwidth / 2);
            ctx.fill();
          }
          noGlow();
          break;
        }

        case "wave":
        case "twin": {
          const { analyser: an, playing: on } = conf.current;
          if (an && on) an.getByteTimeDomainData(timeData);
          const amp = h * 0.46 * scale;
          const sampleAt = (x: number) => {
            const i = Math.floor((x / w) * timeData.length);
            return an && on
              ? (timeData[i] - 128) / 128
              : Math.sin(x * 0.014 + t * 2.6) * 0.34;
          };

          const ribbon = (dir: number, colour: [number, number, number], alpha: number) => {
            ctx.beginPath();
            for (let x = 0; x <= w; x += 3) {
              ctx.lineTo(x, cy + sampleAt(x) * amp * dir);
            }
            glow(css(colour, 0.95), 26);
            ctx.strokeStyle = css(colour, alpha);
            ctx.lineWidth = 3.5;
            ctx.lineJoin = "round";
            ctx.stroke();
            noGlow();

            // Fill under the line so it reads as a body, not a hairline.
            ctx.lineTo(w, cy);
            ctx.lineTo(0, cy);
            ctx.closePath();
            const fill = ctx.createLinearGradient(0, cy - amp, 0, cy + amp);
            fill.addColorStop(0, css(colour, 0.28));
            fill.addColorStop(1, css(colour, 0));
            ctx.fillStyle = fill;
            ctx.fill();
          };

          ribbon(1, b, 1);
          if (which === "twin") ribbon(-1, a, 0.9);
          break;
        }

        case "orb": {
          const base = min * 0.24 * scale;
          const r = base * (1 + bass * 0.7);
          const halo = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 1.7);
          halo.addColorStop(0, css(b, 0.95));
          halo.addColorStop(0.4, css(a, 0.6));
          halo.addColorStop(1, css(a, 0));
          ctx.fillStyle = halo;
          ctx.fillRect(0, 0, w, h);

          glow(css(b, 1), 30);
          ctx.beginPath();
          for (let i = 0; i <= 120; i++) {
            const ang = (i / 120) * Math.PI * 2;
            const v = radialBin(i / 120);
            const rr = r * (1 + Math.sin(ang * 3 + t * 1.8) * 0.09 + v * 0.38);
            const x = cx + Math.cos(ang) * rr;
            const y = cy + Math.sin(ang) * rr;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.strokeStyle = css(b, 1);
          ctx.lineWidth = 3;
          ctx.stroke();
          noGlow();
          break;
        }

        case "ring": {
          const inner = min * 0.2 * scale;
          const count = 96;
          glow(css(a, 0.8), 18);
          for (let i = 0; i < count; i++) {
            const ang = (i / count) * Math.PI * 2 - Math.PI / 2;
            const v = radialBin(i / count);
            const len = inner * 0.3 + v * inner * 2.1 * scale;
            const x1 = cx + Math.cos(ang) * inner;
            const y1 = cy + Math.sin(ang) * inner;
            const x2 = cx + Math.cos(ang) * (inner + len);
            const y2 = cy + Math.sin(ang) * (inner + len);
            const grad = ctx.createLinearGradient(x1, y1, x2, y2);
            grad.addColorStop(0, css(a, 1));
            grad.addColorStop(1, css(b, 0.35));
            ctx.strokeStyle = grad;
            ctx.lineWidth = 4;
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
          }
          ctx.strokeStyle = css(b, 0.5 + bass * 0.5);
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(cx, cy, inner * 0.9, 0, Math.PI * 2);
          ctx.stroke();
          noGlow();
          break;
        }

        case "bloom": {
          for (let i = 0; i < 4; i++) {
            const band = bins[i * 9] * 0.8 + energy * 0.8;
            const r = min * (0.22 + i * 0.1) * (1 + band) * scale;
            const ox = cx + Math.cos(t * 0.55 + i * 2.1) * w * 0.14;
            const oy = cy + Math.sin(t * 0.47 + i * 1.7) * h * 0.14;
            const grad = ctx.createRadialGradient(ox, oy, 0, ox, oy, Math.max(1, r));
            grad.addColorStop(0, css(i % 2 ? b : a, 0.62));
            grad.addColorStop(0.5, css(i % 2 ? b : a, 0.22));
            grad.addColorStop(1, css(i % 2 ? b : a, 0));
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, w, h);
          }
          break;
        }

        case "rings": {
          const hit = conf.current.playing
            ? bass > 0.5 && t - lastBeat > 0.16
            : t - lastBeat > 0.9;
          if (hit) {
            ripples.push({ r: 0, strength: Math.max(0.5, bass) });
            lastBeat = t;
          }
          glow(css(b, 0.7), 18);
          for (let i = ripples.length - 1; i >= 0; i--) {
            const ring = ripples[i];
            ring.r += 4.6 * scale;
            const max = Math.max(w, h) * 0.75;
            const fade = 1 - ring.r / max;
            if (fade <= 0) {
              ripples.splice(i, 1);
              continue;
            }
            ctx.strokeStyle = css(i % 2 ? b : a, fade * ring.strength);
            ctx.lineWidth = 3 + ring.strength * 6;
            ctx.beginPath();
            ctx.arc(cx, cy, ring.r, 0, Math.PI * 2);
            ctx.stroke();
          }
          noGlow();
          const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, min * 0.3 * (1 + bass));
          core.addColorStop(0, css(b, 0.7 + bass * 0.3));
          core.addColorStop(1, css(b, 0));
          ctx.fillStyle = core;
          ctx.fillRect(0, 0, w, h);
          break;
        }

        case "tunnel": {
          const depth = 14;
          glow(css(a, 0.6), 16);
          for (let i = 0; i < depth; i++) {
            // Rings march toward the viewer, looping on a fixed cadence.
            const p = ((t * 0.55 + i / depth) % 1);
            const r = Math.pow(p, 2.1) * min * 1.25 * scale;
            const v = bins[(i * 4) % bins.length];
            ctx.strokeStyle = css(i % 2 ? a : b, (1 - p) * (0.5 + v * 0.7));
            ctx.lineWidth = 2 + v * 8;
            ctx.beginPath();
            ctx.ellipse(
              cx + Math.sin(t * 0.6 + i * 0.3) * w * 0.04,
              cy + Math.cos(t * 0.5 + i * 0.3) * h * 0.04,
              Math.max(1, r * 1.18),
              Math.max(1, r),
              0, 0, Math.PI * 2,
            );
            ctx.stroke();
          }
          noGlow();
          break;
        }

        case "starburst": {
          const rays = 60;
          glow(css(b, 0.9), 22);
          for (let i = 0; i < rays; i++) {
            const ang = (i / rays) * Math.PI * 2 + t * 0.25;
            const v = radialBin(i / rays);
            const len = min * (0.12 + v * 0.62) * scale;
            const grad = ctx.createLinearGradient(
              cx, cy,
              cx + Math.cos(ang) * len,
              cy + Math.sin(ang) * len,
            );
            grad.addColorStop(0, css(b, 0.95));
            grad.addColorStop(1, css(a, 0));
            ctx.strokeStyle = grad;
            ctx.lineWidth = 2 + v * 5;
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len);
            ctx.stroke();
          }
          noGlow();
          break;
        }

        case "matrix": {
          const cols = 28;
          const rows = 14;
          const cw = w / cols;
          const ch = h / rows;
          for (let c = 0; c < cols; c++) {
            const v = bins[Math.floor((c / cols) * bins.length)] * scale;
            const lit = Math.round(v * rows);
            for (let r = 0; r < rows; r++) {
              const on = rows - r <= lit;
              const heat = (rows - r) / rows;
              ctx.fillStyle = on
                ? css(heat > 0.72 ? b : a, 0.55 + heat * 0.45)
                : css(a, 0.05);
              ctx.beginPath();
              ctx.roundRect(
                c * cw + cw * 0.14,
                r * ch + ch * 0.16,
                cw * 0.72,
                ch * 0.68,
                2,
              );
              ctx.fill();
            }
          }
          break;
        }

        case "spiral": {
          const arms = 3;
          const pts = 150;
          glow(css(b, 0.8), 16);
          for (let arm = 0; arm < arms; arm++) {
            for (let i = 0; i < pts; i++) {
              const p = i / pts;
              const ang = p * Math.PI * 5 + t * 0.85 + (arm / arms) * Math.PI * 2;
              const v = bins[Math.floor(p * bins.length)];
              const r = p * min * 0.52 * scale * (1 + v * 0.45);
              const x = cx + Math.cos(ang) * r;
              const y = cy + Math.sin(ang) * r;
              ctx.fillStyle = css(arm % 2 ? b : a, (1 - p) * (0.45 + v * 0.75));
              ctx.beginPath();
              ctx.arc(x, y, 1.4 + v * 4.5, 0, Math.PI * 2);
              ctx.fill();
            }
          }
          noGlow();
          break;
        }

        case "terrain": {
          // Each frame pushes the current spectrum in; older rows recede.
          history.unshift(bins.slice(0, 40));
          if (history.length > 26) history.pop();
          for (let row = history.length - 1; row >= 0; row--) {
            const p = row / 26;
            const y = h * (0.42 + p * 0.55);
            const squash = 1 - p * 0.72;
            ctx.beginPath();
            ctx.moveTo(-10, h);
            for (let i = 0; i < history[row].length; i++) {
              const x = (i / (history[row].length - 1)) * w;
              ctx.lineTo(x, y - history[row][i] * h * 0.34 * squash * scale);
            }
            ctx.lineTo(w + 10, h);
            ctx.closePath();
            ctx.fillStyle = css(row % 2 ? a : b, 0.1 + (1 - p) * 0.22);
            ctx.fill();
            ctx.strokeStyle = css(b, (1 - p) * 0.75);
            ctx.lineWidth = 1.6;
            ctx.stroke();
          }
          break;
        }

        case "kaleido": {
          const wedges = 6;
          glow(css(b, 0.7), 18);
          for (let k = 0; k < wedges; k++) {
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate((k / wedges) * Math.PI * 2 + t * 0.3);
            if (k % 2) ctx.scale(1, -1);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            for (let i = 0; i < 32; i++) {
              const v = bins[i];
              const ang = (i / 32) * (Math.PI / wedges) * 2;
              const r = (min * 0.16 + v * min * 0.4) * scale;
              ctx.lineTo(Math.cos(ang) * r, Math.sin(ang) * r);
            }
            ctx.closePath();
            const grad = ctx.createLinearGradient(0, 0, min * 0.5, 0);
            grad.addColorStop(0, css(a, 0.55));
            grad.addColorStop(1, css(b, 0.12));
            ctx.fillStyle = grad;
            ctx.fill();
            ctx.strokeStyle = css(b, 0.6);
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.restore();
          }
          noGlow();
          break;
        }

        case "sparks": {
          // With nothing playing there are no beats to fire on, which would
          // leave the tile blank — keep a slow pulse going instead.
          const beat = conf.current.playing
            ? bass > 0.46 && t - lastBeat > 0.1
            : t - lastBeat > 0.7;
          if (beat) {
            lastBeat = t;
            const burst = 14 + Math.round(bass * 22);
            for (let i = 0; i < burst; i++) {
              const ang = Math.random() * Math.PI * 2;
              const speed = (1.6 + Math.random() * 5.5) * (0.6 + bass) * scale;
              sparks.push({
                x: cx,
                y: cy,
                vx: Math.cos(ang) * speed,
                vy: Math.sin(ang) * speed,
                life: 1,
              });
            }
          }
          glow(css(b, 0.9), 14);
          for (let i = sparks.length - 1; i >= 0; i--) {
            const s = sparks[i];
            s.x += s.vx;
            s.y += s.vy;
            s.vy += 0.045;        // a little gravity so bursts arc
            s.vx *= 0.987;
            s.life -= 0.016;
            if (s.life <= 0) {
              sparks.splice(i, 1);
              continue;
            }
            ctx.fillStyle = css(s.life > 0.55 ? b : a, s.life);
            ctx.beginPath();
            ctx.arc(s.x, s.y, 1.6 + s.life * 3.4, 0, Math.PI * 2);
            ctx.fill();
          }
          noGlow();
          if (sparks.length > 900) sparks.splice(0, sparks.length - 900);
          break;
        }
      }
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    raf = requestAnimationFrame(draw);

    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) raf = requestAnimationFrame(draw);
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  if (kind === "video") {
    return <VideoLoopLayer theme={theme} className={className} />;
  }
  if (kind === "off") return null;
  return <canvas ref={ref} className={`h-full w-full ${className}`} aria-hidden="true" />;
}

/**
 * A clip the owner uploaded, looping silently behind the music. It follows the
 * player: paused song, paused picture.
 */
function VideoLoopLayer({ theme, className }: { theme: Theme; className: string }) {
  const { playing } = usePlayer();
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (playing) el.play().catch(() => {});
    else el.pause();
  }, [playing]);

  if (!theme.video_id) return null;

  return (
    <span className={`relative block h-full w-full overflow-hidden ${className}`}>
      <video
        ref={ref}
        src={`/api/videos/${theme.video_id}/file`}
        poster={`/api/videos/${theme.video_id}/poster`}
        className="h-full w-full"
        style={{ objectFit: theme.video_fit === "contain" ? "contain" : "cover" }}
        loop
        muted
        playsInline
        autoPlay
        // Nothing here should ever grab a click from the page behind it.
        tabIndex={-1}
        aria-hidden="true"
      />
      {theme.video_dim > 0 && (
        <span
          className="absolute inset-0"
          style={{ background: `rgba(0,0,0,${theme.video_dim})` }}
        />
      )}
    </span>
  );
}
