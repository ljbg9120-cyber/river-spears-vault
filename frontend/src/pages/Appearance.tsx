/**
 * The appearance editor. Selecting anything repaints the page underneath you —
 * the preview is the site itself, not a thumbnail.
 */
import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { BACKGROUNDS } from "../components/Background";
import Visualizer, { VISUALIZERS } from "../components/Visualizer";
import VideoLibrary from "../components/VideoLibrary";
import { Icon, useToast } from "../components/ui";
import { api, type Theme } from "../lib/api";
import { useAuth } from "../lib/store";

const PALETTES: { name: string; accent: string; accent2: string }[] = [
  { name: "Ultraviolet", accent: "#7c5cff", accent2: "#22d3ee" },
  { name: "Sunburn", accent: "#ff6b35", accent2: "#f7b801" },
  { name: "Bubblegum", accent: "#ff5d8f", accent2: "#a06cd5" },
  { name: "Chlorophyll", accent: "#00d68f", accent2: "#7ee787" },
  { name: "Deep Sea", accent: "#3a86ff", accent2: "#00f5d4" },
  { name: "Ember", accent: "#e63946", accent2: "#ff9f1c" },
  { name: "Mercury", accent: "#94a3b8", accent2: "#e2e8f0" },
  { name: "Acid", accent: "#c8ff00", accent2: "#00e5ff" },
];

export default function Appearance() {
  const { theme, previewTheme, saveTheme } = useAuth();
  const toast = useToast();
  const [fonts, setFonts] = useState<string[]>(["Outfit"]);
  const [saving, setSaving] = useState(false);
  const timer = useRef<number>();

  // Sliders fire constantly; repaint immediately, persist once things settle.
  const nudge = (patch: Partial<Theme>) => {
    previewTheme(patch);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setSaving(true);
      saveTheme(patch)
        .catch(() => toast("Could not save that", "err"))
        .finally(() => setSaving(false));
    }, 450);
  };

  const commit = async (patch: Partial<Theme>, note?: string) => {
    previewTheme(patch);
    setSaving(true);
    try {
      await saveTheme(patch);
      if (note) toast(note);
    } catch {
      toast("Could not save that", "err");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    api.get<string[]>("/api/fonts").then(setFonts).catch(() => {});
  }, []);

  return (
    <div className="mx-auto max-w-4xl">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="title-xl text-3xl sm:text-4xl">Make it yours</h1>
        <p className="mt-1 text-sm text-muted">
          Everything here applies live, and travels with every link you share — so people
          open your music in your room, not a grey box.
          {saving && <span className="ml-2 opacity-70">saving…</span>}
        </p>
      </motion.div>

      {/* ------------------------- backgrounds ------------------------- */}
      <Section title="Animated background" hint="Two of them move with whatever is playing.">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
          {BACKGROUNDS.map((bg, i) => {
            const active = theme.background === bg.id;
            return (
              <motion.button
                key={bg.id}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                whileHover={{ y: -3, scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onMouseEnter={() => previewTheme({ background: bg.id })}
                onMouseLeave={() => previewTheme({ background: theme.background })}
                onClick={() => commit({ background: bg.id }, `${bg.name} applied`)}
                className="card relative overflow-hidden p-3 text-left"
                style={{
                  borderColor: active ? "rgb(var(--accent-rgb))" : undefined,
                  boxShadow: active ? "0 0 30px -10px rgb(var(--accent-rgb))" : undefined,
                }}
              >
                <Swatch id={bg.id} />
                <div className="mt-2 flex items-center justify-between gap-1">
                  <span className="truncate font-display text-[13px] font-bold">
                    {bg.name}
                  </span>
                  {active && (
                    <span style={{ color: "rgb(var(--accent-rgb))" }}>
                      <Icon name="check" size={14} />
                    </span>
                  )}
                </div>
                <span className="block truncate text-[11px] text-muted">{bg.hint}</span>
              </motion.button>
            );
          })}
        </div>

        <div className="mt-5">
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-sm font-semibold">Make it stand out</span>
            <span className="font-mono text-xs text-muted">
              {Math.round((theme.background_boost ?? 0) * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={theme.background_boost ?? 0}
            onChange={(e) => nudge({ background_boost: Number(e.target.value) })}
            className="w-full"
            aria-label="How much the background stands out"
          />
          <p className="mt-1 text-xs text-muted">
            Thins the panels and lifts the darkening at the edges, so the
            background comes forward instead of sitting behind the glass. Turn it
            far up and the interface almost floats on top of it.
          </p>
        </div>
      </Section>

      {/* ------------------------- visualizer ------------------------- */}
      <Section
        title="Visualizer"
        hint="Fifteen of them, drawn from the live audio — small in the player, full-bleed behind the lyrics. Previews are live, so hit play and watch them move."
      >
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-8">
          {VISUALIZERS.map((viz, i) => {
            const active = (theme.visualizer ?? "bars") === viz.id;
            return (
              <motion.button
                key={viz.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                whileHover={{ y: -3, scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() =>
                  viz.id === "video" && !theme.video_id
                    ? toast("Upload a clip below first")
                    : commit({ visualizer: viz.id }, `${viz.name} visualizer`)
                }
                className="card relative overflow-hidden p-2.5 text-left"
                style={{
                  borderColor: active ? "rgb(var(--accent-rgb))" : undefined,
                  boxShadow: active ? "0 0 30px -10px rgb(var(--accent-rgb))" : undefined,
                }}
              >
                <span
                  className="flex h-12 w-full items-center justify-center overflow-hidden rounded-lg"
                  style={{ background: "#0b0a12" }}
                >
                  {viz.id === "off" ? (
                    <span className="text-[11px] text-muted">no visualizer</span>
                  ) : viz.id === "video" ? (
                    <span className="flex flex-col items-center gap-0.5 text-[11px] text-muted">
                      <Icon name="upload" size={15} />
                      your clip
                    </span>
                  ) : (
                    <Visualizer theme={theme} style={viz.id} preview />
                  )}
                </span>
                <span className="mt-1.5 flex items-center justify-between gap-1">
                  <span className="truncate font-display text-[12px] font-bold">
                    {viz.name}
                  </span>
                  {active && (
                    <span style={{ color: "rgb(var(--accent-rgb))" }}>
                      <Icon name="check" size={13} />
                    </span>
                  )}
                </span>
                <span className="block truncate text-[10px] text-muted">{viz.hint}</span>
              </motion.button>
            );
          })}
        </div>

        {theme.visualizer !== "off" && theme.visualizer !== "video" && (
          <div className="mt-5">
            <Slider
              label="Visualizer size"
              hint="How much of the screen it fills"
              value={theme.visualizer_size ?? 0.85}
              onChange={(v) => nudge({ visualizer_size: v })}
            />
          </div>
        )}
      </Section>

      {/* ------------------------- video clips ------------------------- */}
      <Section
        title="Your videos"
        hint="Drop in an MP4 and it plays behind the music, on the lyrics screen and in the player. Sound is stripped — the song is the sound."
      >
        <VideoLibrary theme={theme} onPick={(patch) => commit(patch)} />
      </Section>

      {/* ------------------------- typeface ------------------------- */}
      <Section
        title="Typeface"
        hint="Sets headings and the wordmark. Each one loads only if you pick it."
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {fonts.map((name) => {
            const active = (theme.font ?? "Outfit") === name;
            return (
              <button
                key={name}
                onMouseEnter={() => previewTheme({ font: name })}
                onMouseLeave={() => previewTheme({ font: theme.font })}
                onClick={() => commit({ font: name }, `${name} applied`)}
                className="card px-3 py-3 text-left"
                style={{
                  borderColor: active ? "rgb(var(--accent-rgb))" : undefined,
                  background: active ? "rgb(var(--accent-rgb) / 0.1)" : undefined,
                }}
              >
                <span
                  className="block truncate text-lg font-bold"
                  style={{ fontFamily: `"${name}", Outfit, sans-serif` }}
                >
                  Aa
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-muted">{name}</span>
              </button>
            );
          })}
        </div>
      </Section>


      {/* ------------------------- colours ------------------------- */}
      <Section title="Colours" hint="Pick a pair, or dial in exact hex values.">
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PALETTES.map((p) => {
            const active =
              theme.accent.toLowerCase() === p.accent.toLowerCase() &&
              theme.accent2.toLowerCase() === p.accent2.toLowerCase();
            return (
              <button
                key={p.name}
                onClick={() =>
                  commit({ accent: p.accent, accent2: p.accent2 }, `${p.name} applied`)
                }
                className="card flex items-center gap-2.5 px-3 py-2.5 text-left transition hover:scale-[1.02]"
                style={{ borderColor: active ? "rgb(var(--accent-rgb))" : undefined }}
              >
                <span
                  className="h-7 w-7 shrink-0 rounded-lg"
                  style={{
                    background: `linear-gradient(135deg, ${p.accent}, ${p.accent2})`,
                  }}
                />
                <span className="truncate text-[13px] font-medium">{p.name}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-3">
          <ColorField
            label="Primary"
            value={theme.accent}
            onChange={(v) => nudge({ accent: v })}
          />
          <ColorField
            label="Secondary"
            value={theme.accent2}
            onChange={(v) => nudge({ accent2: v })}
          />
        </div>
      </Section>

      {/* ------------------------- motion ------------------------- */}
      <Section title="Motion & texture">
        <div className="space-y-5">
          <Slider
            label="Intensity"
            hint="How strong the background reads"
            value={theme.intensity}
            onChange={(v) => nudge({ intensity: v })}
          />
          <Slider
            label="Speed"
            hint="How fast it moves"
            value={theme.speed}
            onChange={(v) => nudge({ speed: v })}
          />

          <Toggle
            label="React to the music"
            hint="Waves, Spectrum and the rest pulse with what is playing"
            value={theme.reactive}
            onChange={(v) => commit({ reactive: v })}
          />
          <Toggle
            label="Film grain"
            hint="A fine analogue texture over everything"
            value={theme.grain}
            onChange={(v) => commit({ grain: v })}
          />

          <div>
            <p className="mb-2 text-sm font-semibold">Mode</p>
            <div className="glass inline-flex rounded-xl p-1">
              {(["dark", "light"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => commit({ mode: m })}
                  className="rounded-lg px-4 py-1.5 text-sm font-medium capitalize transition"
                  style={{
                    background:
                      theme.mode === m ? "rgb(var(--accent-rgb) / 0.22)" : "transparent",
                    color:
                      theme.mode === m ? "rgb(var(--ink-rgb))" : "rgb(var(--muted-rgb))",
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="card mt-5 p-5 sm:p-6"
    >
      <h2 className="font-display text-lg font-bold">{title}</h2>
      {hint && <p className="mb-4 mt-0.5 text-sm text-muted">{hint}</p>}
      {!hint && <div className="mb-4" />}
      {children}
    </motion.section>
  );
}

/** A tiny CSS impression of each background, just enough to tell them apart. */
function Swatch({ id }: { id: string }) {
  // Alpha has to go inside rgb(), not as a hex suffix -- "rgb(...)66" is
  // invalid CSS and silently renders nothing.
  const a = (alpha = 1) => `rgb(var(--accent-rgb) / ${alpha})`;
  const b = (alpha = 1) => `rgb(var(--accent2-rgb) / ${alpha})`;
  const dark = "#0b0a12";
  const styles: Record<string, React.CSSProperties> = {
    aurora: { background: `radial-gradient(circle at 30% 30%, ${a()}, transparent 60%), radial-gradient(circle at 70% 70%, ${b()}, transparent 60%), ${dark}`, filter: "blur(6px)" },
    starfield: { background: `radial-gradient(1.4px 1.4px at 20% 30%, ${b()} 50%, transparent), radial-gradient(2px 2px at 60% 20%, ${a()} 50%, transparent), radial-gradient(1.4px 1.4px at 80% 70%, ${b()} 50%, transparent), radial-gradient(1.6px 1.6px at 38% 76%, ${a()} 50%, transparent), ${dark}` },
    mesh: { background: `conic-gradient(from 0deg, transparent, ${a()}, ${b()}, transparent), ${dark}`, filter: "blur(7px)" },
    waves: { background: `linear-gradient(0deg, ${a(0.85)} 6%, transparent 62%), linear-gradient(0deg, ${b(0.6)} 3%, transparent 40%), ${dark}` },
    particles: { background: `radial-gradient(2.4px 2.4px at 30% 40%, ${b()} 60%, transparent), radial-gradient(2.4px 2.4px at 65% 60%, ${a()} 60%, transparent), radial-gradient(2px 2px at 48% 25%, ${b()} 60%, transparent), ${dark}` },
    grid: { background: `linear-gradient(${a(0.5)} 1px, transparent 1px), linear-gradient(90deg, ${a(0.35)} 1px, transparent 1px), ${dark}`, backgroundSize: "10px 10px, 10px 10px, 100% 100%" },
    liquid: { background: `linear-gradient(135deg, ${a()}, ${b()}), ${dark}`, filter: "blur(4px)", borderRadius: "40% 60% 55% 45%" },
    spectrum: { background: `repeating-linear-gradient(90deg, ${a(0.9)} 0 4px, transparent 4px 8px), ${dark}` },
    orbit: { background: `radial-gradient(circle at 50% 50%, ${a()} 0 7%, transparent 8%), radial-gradient(circle at 50% 50%, transparent 34%, ${b(0.7)} 35% 37%, transparent 38%), ${dark}` },
    rain: { background: `repeating-linear-gradient(105deg, ${b(0.6)} 0 1px, transparent 1px 7px), ${dark}` },
    noise: { background: `repeating-conic-gradient(${a(0.45)} 0% 25%, transparent 0% 50%), ${dark}`, backgroundSize: "9px 9px, 100% 100%" },
    sunset: { background: `linear-gradient(180deg, #1b1030, ${a()}, ${b()})` },
    matrix: { background: `repeating-linear-gradient(180deg, ${b(0.7)} 0 3px, transparent 3px 9px), #06070a` },
    plasma: { background: `radial-gradient(circle at 25% 30%, ${a()}, transparent 45%), radial-gradient(circle at 75% 65%, ${b()}, transparent 45%), ${dark}`, filter: "blur(4px)" },
    none: { background: "rgb(var(--bg-rgb))", border: "1px dashed var(--hairline)" },
  };
  return (
    <span
      className="block h-14 w-full overflow-hidden rounded-lg"
      style={{ ...styles[id], backgroundColor: styles[id]?.backgroundColor ?? "#0b0a12" }}
    />
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="glass flex items-center gap-3 rounded-2xl px-3 py-2.5">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-9 cursor-pointer rounded-lg border-0 bg-transparent p-0"
        aria-label={label}
      />
      <span>
        <span className="block text-[11px] uppercase tracking-wider text-muted">
          {label}
        </span>
        <span className="block font-mono text-sm">{value.toUpperCase()}</span>
      </span>
    </label>
  );
}

function Slider({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-sm font-semibold">{label}</span>
        <span className="font-mono text-xs text-muted">{Math.round(value * 100)}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
        aria-label={label}
      />
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      className="flex w-full items-center justify-between gap-4 text-left"
    >
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
      <span
        className="relative h-6 w-11 shrink-0 rounded-full transition"
        style={{
          background: value ? "rgb(var(--accent-rgb))" : "rgb(var(--muted-rgb) / 0.35)",
        }}
      >
        <motion.span
          className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow"
          animate={{ left: value ? 22 : 2 }}
          transition={{ type: "spring", stiffness: 500, damping: 32 }}
        />
      </span>
    </button>
  );
}
