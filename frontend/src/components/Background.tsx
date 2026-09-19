/**
 * The animated background engine.
 *
 * Gradient-based looks are CSS (cheaper and smoother than repainting blurs);
 * anything with moving objects is one canvas driven by a single rAF loop.
 * `reactive` backgrounds read the player's analyser, so the room moves with
 * whatever is playing.
 */
import { useEffect, useMemo, useRef } from "react";
import type { Theme } from "../lib/api";
import { hexToRgb, usePlayer } from "../lib/store";

export const BACKGROUNDS = [
  { id: "aurora", name: "Aurora", hint: "Slow northern lights" },
  { id: "starfield", name: "Starfield", hint: "Flying through stars" },
  { id: "mesh", name: "Mesh", hint: "Soft gradient mesh" },
  { id: "waves", name: "Waves", hint: "Reacts to the music" },
  { id: "particles", name: "Particles", hint: "Drifting connected dots" },
  { id: "grid", name: "Grid", hint: "Retro perspective floor" },
  { id: "liquid", name: "Liquid", hint: "Lava-lamp blobs" },
  { id: "spectrum", name: "Spectrum", hint: "Reacts to the music" },
  { id: "orbit", name: "Orbit", hint: "Rings and satellites" },
  { id: "rain", name: "Rain", hint: "Quiet downpour" },
  { id: "noise", name: "Static", hint: "Analogue shimmer" },
  { id: "sunset", name: "Sunset", hint: "Warm horizon" },
  { id: "matrix", name: "Cascade", hint: "Falling glyphs" },
  { id: "plasma", name: "Plasma", hint: "Molten colour field" },
  { id: "none", name: "None", hint: "Just the colour" },
] as const;

const CANVAS_KINDS = new Set([
  "starfield", "particles", "grid", "waves",
  "spectrum", "orbit", "rain", "matrix", "noise",
]);

type RGB = [number, number, number];

function rgb(hex: string): RGB {
  const [r, g, b] = hexToRgb(hex).split(" ").map(Number);
  return [r, g, b];
}

function css(c: RGB, a = 1) {
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
}

export default function Background({ theme }: { theme: Theme }) {
  const { analyser, playing } = usePlayer();
  const kind = theme.background;

  // Thinning the panels only gets the glass out of the way; the artwork itself
  // also has to come up, or "stand out" just means "darker interface".
  const boost = theme.background_boost ?? 0;

  return (
    <div
      className={`bg-layer ${theme.grain ? "grain" : ""}`}
      aria-hidden="true"
      style={
        boost > 0
          ? {
              filter: `saturate(${(1 + boost * 0.8).toFixed(2)}) brightness(${(1 + boost * 0.45).toFixed(2)}) contrast(${(1 + boost * 0.2).toFixed(2)})`,
            }
          : undefined
      }
    >
      <BaseWash theme={theme} />
      {kind === "aurora" && <Aurora theme={theme} />}
      {kind === "mesh" && <Mesh theme={theme} />}
      {kind === "liquid" && <Liquid theme={theme} />}
      {kind === "sunset" && <Sunset theme={theme} />}
      {kind === "plasma" && <Plasma theme={theme} />}
      {CANVAS_KINDS.has(kind) && (
        <CanvasScene theme={theme} analyser={analyser} playing={playing} />
      )}
      <Vignette theme={theme} />
    </div>
  );
}

/** A constant accent wash so even "none" is not flat black. */
function BaseWash({ theme }: { theme: Theme }) {
  // A boosted background gets a stronger wash under it so the colour
  // carries all the way to the edges instead of fading into the panel.
  const boost = theme.background_boost ?? 0;
  return (
    <div
      className="absolute inset-0"
      style={{
        opacity: 1 + boost * 0.9,
        background:
          theme.mode === "light"
            ? `radial-gradient(1200px 700px at 15% -10%, ${theme.accent}18, transparent 60%),
               radial-gradient(1000px 600px at 90% 10%, ${theme.accent2}14, transparent 60%)`
            : `radial-gradient(1200px 700px at 15% -10%, ${theme.accent}26, transparent 60%),
               radial-gradient(1000px 600px at 90% 10%, ${theme.accent2}1f, transparent 60%)`,
      }}
    />
  );
}

function Vignette({ theme }: { theme: Theme }) {
  if (theme.mode === "light") return null;
  // The vignette exists to keep text readable over a busy background. Turning
  // the background up should lift it, not remove it entirely.
  const boost = theme.background_boost ?? 0;
  const edge = 0.55 * (1 - boost * 0.8);
  return (
    <div
      className="absolute inset-0"
      style={{
        background:
          `radial-gradient(120% 100% at 50% 40%, transparent 40%, rgba(0,0,0,${edge.toFixed(3)}) 100%)`,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// CSS looks
// ---------------------------------------------------------------------------

function Aurora({ theme }: { theme: Theme }) {
  const dur = 26 - theme.speed * 16;
  const blobs = [
    { c: theme.accent, x: "8%", y: "12%", s: 620, d: 0 },
    { c: theme.accent2, x: "68%", y: "4%", s: 560, d: -6 },
    { c: theme.accent, x: "42%", y: "58%", s: 700, d: -12 },
    { c: theme.accent2, x: "82%", y: "62%", s: 480, d: -18 },
  ];
  return (
    <>
      <style>{auroraKeyframes}</style>
      {blobs.map((b, i) => (
        <div
          key={i}
          className="absolute rounded-full"
          style={{
            left: b.x,
            top: b.y,
            width: b.s,
            height: b.s,
            background: `radial-gradient(circle at 35% 35%, ${b.c}, transparent 68%)`,
            filter: `blur(${70 + theme.intensity * 50}px)`,
            opacity: 0.32 + theme.intensity * 0.42,
            animation: `auroraFloat ${dur + i * 3}s ease-in-out ${b.d}s infinite`,
            mixBlendMode: theme.mode === "light" ? "multiply" : "screen",
          }}
        />
      ))}
    </>
  );
}

const auroraKeyframes = `
@keyframes auroraFloat {
  0%, 100% { transform: translate3d(0,0,0) scale(1); }
  33%      { transform: translate3d(9vw, -6vh, 0) scale(1.16); }
  66%      { transform: translate3d(-7vw, 7vh, 0) scale(0.9); }
}
@keyframes meshSpin {
  0%   { transform: rotate(0deg) scale(1.4); }
  100% { transform: rotate(360deg) scale(1.4); }
}
@keyframes blobMorph {
  0%, 100% { border-radius: 42% 58% 63% 37% / 41% 44% 56% 59%; transform: translate(0,0) rotate(0deg); }
  34%      { border-radius: 68% 32% 39% 61% / 63% 38% 62% 37%; transform: translate(6vw,-5vh) rotate(120deg); }
  67%      { border-radius: 35% 65% 56% 44% / 52% 63% 37% 48%; transform: translate(-5vw,6vh) rotate(240deg); }
}
@keyframes plasmaDrift {
  0%, 100% { background-position: 0% 50%, 100% 50%, 50% 0%; }
  50%      { background-position: 100% 50%, 0% 50%, 50% 100%; }
}
@keyframes sunPulse {
  0%, 100% { transform: translateX(-50%) scale(1); opacity: 0.9; }
  50%      { transform: translateX(-50%) scale(1.06); opacity: 1; }
}
`;

function Mesh({ theme }: { theme: Theme }) {
  const dur = 60 - theme.speed * 38;
  return (
    <>
      <style>{auroraKeyframes}</style>
      <div
        className="absolute inset-0"
        style={{
          background: `conic-gradient(from 0deg at 50% 50%,
            ${theme.accent}00, ${theme.accent}cc, ${theme.accent2}cc,
            ${theme.accent}00, ${theme.accent2}aa, ${theme.accent}00)`,
          filter: `blur(${90 + theme.intensity * 70}px)`,
          opacity: 0.3 + theme.intensity * 0.4,
          animation: `meshSpin ${dur}s linear infinite`,
        }}
      />
    </>
  );
}

function Liquid({ theme }: { theme: Theme }) {
  const dur = 30 - theme.speed * 18;
  const blobs = [
    { c: theme.accent, x: "12%", y: "18%", s: 420 },
    { c: theme.accent2, x: "62%", y: "24%", s: 380 },
    { c: theme.accent, x: "38%", y: "62%", s: 460 },
  ];
  return (
    <>
      <style>{auroraKeyframes}</style>
      <div className="absolute inset-0" style={{ filter: "blur(44px)" }}>
        {blobs.map((b, i) => (
          <div
            key={i}
            className="absolute"
            style={{
              left: b.x,
              top: b.y,
              width: b.s,
              height: b.s,
              background: `linear-gradient(135deg, ${b.c}, ${
                i % 2 ? theme.accent : theme.accent2
              })`,
              opacity: 0.35 + theme.intensity * 0.4,
              animation: `blobMorph ${dur + i * 4}s ease-in-out ${-i * 5}s infinite`,
              borderRadius: "42% 58% 63% 37% / 41% 44% 56% 59%",
            }}
          />
        ))}
      </div>
    </>
  );
}

function Sunset({ theme }: { theme: Theme }) {
  return (
    <>
      <style>{auroraKeyframes}</style>
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(180deg,
            transparent 0%, ${theme.accent}22 42%, ${theme.accent}55 62%,
            ${theme.accent2}66 78%, ${theme.accent2}22 100%)`,
          opacity: 0.55 + theme.intensity * 0.45,
        }}
      />
      <div
        className="absolute rounded-full"
        style={{
          left: "50%",
          bottom: "16%",
          width: 360,
          height: 360,
          background: `radial-gradient(circle, ${theme.accent} 0%, ${theme.accent2}88 45%, transparent 70%)`,
          filter: "blur(22px)",
          opacity: 0.7 + theme.intensity * 0.3,
          animation: `sunPulse ${10 - theme.speed * 5}s ease-in-out infinite`,
        }}
      />
    </>
  );
}

function Plasma({ theme }: { theme: Theme }) {
  return (
    <>
      <style>{auroraKeyframes}</style>
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `radial-gradient(circle at 20% 30%, ${theme.accent}, transparent 45%),
            radial-gradient(circle at 80% 40%, ${theme.accent2}, transparent 45%),
            radial-gradient(circle at 50% 80%, ${theme.accent}aa, transparent 50%)`,
          backgroundSize: "180% 180%, 170% 170%, 200% 200%",
          filter: `blur(${50 + theme.intensity * 40}px)`,
          opacity: 0.4 + theme.intensity * 0.45,
          animation: `plasmaDrift ${34 - theme.speed * 22}s ease-in-out infinite`,
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Canvas looks
// ---------------------------------------------------------------------------

function CanvasScene({
  theme,
  analyser,
  playing,
}: {
  theme: Theme;
  analyser: AnalyserNode | null;
  playing: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  // Read live values inside the loop without restarting it every render.
  const conf = useRef({ theme, analyser, playing });
  conf.current = { theme, analyser, playing };

  const seed = useMemo(() => Math.random() * 1000, []);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let t = seed;
    let stars: { x: number; y: number; z: number }[] = [];
    let dots: { x: number; y: number; vx: number; vy: number }[] = [];
    let drops: { x: number; y: number; len: number; v: number }[] = [];
    let columns: number[] = [];

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seedScene();
    };

    const seedScene = () => {
      const density = 0.4 + conf.current.theme.intensity;
      stars = Array.from({ length: Math.floor(220 * density) }, () => ({
        x: Math.random() * w - w / 2,
        y: Math.random() * h - h / 2,
        z: Math.random() * w,
      }));
      dots = Array.from({ length: Math.floor(70 * density) }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
      }));
      drops = Array.from({ length: Math.floor(160 * density) }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        len: 8 + Math.random() * 22,
        v: 2.5 + Math.random() * 5,
      }));
      columns = Array.from({ length: Math.ceil(w / 16) }, () =>
        Math.random() * -h,
      );
    };

    const freq = new Uint8Array(128);

    /** 0..1 loudness, or a gentle idle sway when nothing is playing. */
    const energy = (): number => {
      const { analyser: an, theme: th, playing: on } = conf.current;
      if (!th.reactive || !an || !on) return 0.16 + Math.sin(t * 0.6) * 0.06;
      an.getByteFrequencyData(freq);
      let sum = 0;
      for (let i = 0; i < 48; i++) sum += freq[i];
      return Math.min(1, sum / 48 / 190);
    };

    const draw = () => {
      const th = conf.current.theme;
      const a = rgb(th.accent);
      const b = rgb(th.accent2);
      const speed = 0.25 + th.speed * 1.5;
      const power = th.intensity;
      const e = energy();
      t += 0.016 * speed;

      ctx.clearRect(0, 0, w, h);

      switch (th.background) {
        case "starfield": {
          for (const s of stars) {
            s.z -= 1.6 * speed * (1 + e * 2.4);
            if (s.z <= 1) {
              s.z = w;
              s.x = Math.random() * w - w / 2;
              s.y = Math.random() * h - h / 2;
            }
            const k = 128 / s.z;
            const x = s.x * k + w / 2;
            const y = s.y * k + h / 2;
            if (x < 0 || x > w || y < 0 || y > h) continue;
            const size = Math.max(0.4, (1 - s.z / w) * 2.6);
            const mix = s.z / w;
            ctx.fillStyle = css(mix > 0.5 ? a : b, (1 - mix) * (0.5 + power * 0.5));
            ctx.beginPath();
            ctx.arc(x, y, size, 0, Math.PI * 2);
            ctx.fill();
          }
          break;
        }

        case "particles": {
          const reach = 130 + e * 60;
          for (const d of dots) {
            d.x += d.vx * speed * (1 + e * 2);
            d.y += d.vy * speed * (1 + e * 2);
            if (d.x < 0) d.x = w;
            if (d.x > w) d.x = 0;
            if (d.y < 0) d.y = h;
            if (d.y > h) d.y = 0;
          }
          ctx.lineWidth = 1;
          for (let i = 0; i < dots.length; i++) {
            for (let j = i + 1; j < dots.length; j++) {
              const dx = dots[i].x - dots[j].x;
              const dy = dots[i].y - dots[j].y;
              const dist = Math.hypot(dx, dy);
              if (dist > reach) continue;
              ctx.strokeStyle = css(a, (1 - dist / reach) * 0.22 * (0.5 + power));
              ctx.beginPath();
              ctx.moveTo(dots[i].x, dots[i].y);
              ctx.lineTo(dots[j].x, dots[j].y);
              ctx.stroke();
            }
          }
          for (const d of dots) {
            ctx.fillStyle = css(b, 0.55 + power * 0.4);
            ctx.beginPath();
            ctx.arc(d.x, d.y, 1.8 + e * 2.4, 0, Math.PI * 2);
            ctx.fill();
          }
          break;
        }

        case "grid": {
          const horizon = h * 0.52;
          const scroll = (t * 26) % 60;
          ctx.lineWidth = 1;
          for (let i = 0; i < 26; i++) {
            const z = i * 60 + scroll;
            const y = horizon + (h * 34) / (z + 34);
            if (y > h) continue;
            ctx.strokeStyle = css(a, (1 - (y - horizon) / (h - horizon)) * 0.5 * (0.4 + power));
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
          }
          for (let i = -22; i <= 22; i++) {
            const x = w / 2 + i * (w / 14);
            ctx.strokeStyle = css(b, 0.26 * (0.4 + power));
            ctx.beginPath();
            ctx.moveTo(w / 2 + i * 12, horizon);
            ctx.lineTo(x, h);
            ctx.stroke();
          }
          const glowH = ctx.createLinearGradient(0, horizon - 90, 0, horizon + 10);
          glowH.addColorStop(0, css(a, 0));
          glowH.addColorStop(1, css(a, 0.32 * (0.4 + power)));
          ctx.fillStyle = glowH;
          ctx.fillRect(0, horizon - 90, w, 100);
          break;
        }

        case "waves": {
          const layers = 4;
          for (let l = 0; l < layers; l++) {
            const amp = (16 + l * 12) * (0.5 + power) * (1 + e * 2.6);
            const yBase = h * (0.55 + l * 0.1);
            ctx.beginPath();
            ctx.moveTo(0, h);
            for (let x = 0; x <= w; x += 6) {
              const y =
                yBase +
                Math.sin(x * 0.006 + t * (1 + l * 0.3)) * amp +
                Math.sin(x * 0.013 - t * 0.8) * amp * 0.4;
              ctx.lineTo(x, y);
            }
            ctx.lineTo(w, h);
            ctx.closePath();
            const grad = ctx.createLinearGradient(0, yBase - amp, 0, h);
            grad.addColorStop(0, css(l % 2 ? b : a, 0.22 * (0.5 + power)));
            grad.addColorStop(1, css(l % 2 ? b : a, 0));
            ctx.fillStyle = grad;
            ctx.fill();
          }
          break;
        }

        case "spectrum": {
          const an = conf.current.analyser;
          const bars = 64;
          const bw = w / bars;
          if (an && th.reactive) an.getByteFrequencyData(freq);
          for (let i = 0; i < bars; i++) {
            const raw =
              an && th.reactive && conf.current.playing
                ? freq[i] / 255
                : (Math.sin(t * 1.6 + i * 0.28) * 0.5 + 0.5) * 0.28;
            const bh = raw * h * 0.42 * (0.5 + power);
            const grad = ctx.createLinearGradient(0, h - bh, 0, h);
            grad.addColorStop(0, css(b, 0.75));
            grad.addColorStop(1, css(a, 0.06));
            ctx.fillStyle = grad;
            const x = i * bw;
            ctx.fillRect(x + bw * 0.18, h - bh, bw * 0.64, bh);
            // Mirrored ceiling, quieter, for symmetry.
            ctx.globalAlpha = 0.22;
            ctx.fillRect(x + bw * 0.18, 0, bw * 0.64, bh * 0.5);
            ctx.globalAlpha = 1;
          }
          break;
        }

        case "orbit": {
          const cx = w / 2;
          const cy = h / 2;
          for (let ring = 1; ring <= 5; ring++) {
            const r = ring * Math.min(w, h) * 0.09 * (1 + e * 0.25);
            ctx.strokeStyle = css(ring % 2 ? a : b, 0.16 * (0.5 + power));
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.ellipse(cx, cy, r * 1.5, r, t * 0.05, 0, Math.PI * 2);
            ctx.stroke();

            const angle = t * (0.5 / ring) + ring;
            const px = cx + Math.cos(angle) * r * 1.5;
            const py = cy + Math.sin(angle) * r;
            ctx.fillStyle = css(ring % 2 ? b : a, 0.85);
            ctx.beginPath();
            ctx.arc(px, py, 2.5 + e * 4, 0, Math.PI * 2);
            ctx.fill();
          }
          const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, 90 * (1 + e));
          core.addColorStop(0, css(a, 0.45 * (0.5 + power)));
          core.addColorStop(1, css(a, 0));
          ctx.fillStyle = core;
          ctx.fillRect(cx - 120, cy - 120, 240, 240);
          break;
        }

        case "rain": {
          ctx.lineWidth = 1.1;
          for (const d of drops) {
            d.y += d.v * speed * 2.2;
            if (d.y > h) {
              d.y = -d.len;
              d.x = Math.random() * w;
            }
            const grad = ctx.createLinearGradient(d.x, d.y, d.x, d.y + d.len);
            grad.addColorStop(0, css(b, 0));
            grad.addColorStop(1, css(b, 0.45 * (0.4 + power)));
            ctx.strokeStyle = grad;
            ctx.beginPath();
            ctx.moveTo(d.x, d.y);
            ctx.lineTo(d.x, d.y + d.len);
            ctx.stroke();
          }
          break;
        }

        case "matrix": {
          ctx.font = "14px ui-monospace, monospace";
          for (let i = 0; i < columns.length; i++) {
            columns[i] += (4 + (i % 5)) * speed * (1 + e);
            if (columns[i] > h + 200) columns[i] = -Math.random() * 400;
            const x = i * 16;
            for (let k = 0; k < 10; k++) {
              const y = columns[i] - k * 16;
              if (y < 0 || y > h) continue;
              const ch = String.fromCharCode(0x30a0 + ((i * 7 + k * 13 + Math.floor(t * 4)) % 90));
              ctx.fillStyle = css(k === 0 ? b : a, (1 - k / 10) * 0.55 * (0.4 + power));
              ctx.fillText(ch, x, y);
            }
          }
          break;
        }

        case "noise": {
          const cell = 26;
          for (let x = 0; x < w; x += cell) {
            for (let y = 0; y < h; y += cell) {
              const n =
                Math.sin(x * 0.01 + t) * Math.cos(y * 0.012 - t * 0.7) * 0.5 + 0.5;
              if (n < 0.55) continue;
              ctx.fillStyle = css(n > 0.78 ? b : a, (n - 0.55) * 0.5 * (0.4 + power));
              ctx.fillRect(x, y, cell - 6, cell - 6);
            }
          }
          break;
        }
      }

      raf = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(draw);

    // Stop burning frames when the tab is in the background.
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) raf = requestAnimationFrame(draw);
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [seed]);

  return <canvas ref={ref} className="absolute inset-0 h-full w-full" />;
}
