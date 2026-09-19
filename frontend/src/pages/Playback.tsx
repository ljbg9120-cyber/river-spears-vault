/**
 * Playback settings: how tracks hand over, how fast they run, and how hard
 * the interface is allowed to work while they do.
 *
 * Separate from Appearance on purpose — nothing here changes how the site
 * looks, it changes how it behaves.
 */
import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { Icon, useToast } from "../components/ui";
import type { Theme } from "../lib/api";
import { getProfile, subscribe, type PerfTier } from "../lib/perf";
import { PLAYBACK_SPEEDS, useAuth, usePlayer } from "../lib/store";

export default function Playback() {
  const { theme, previewTheme, saveTheme } = useAuth();
  const { speed, setSpeed, shuffle, repeat, toggleShuffle, cycleRepeat } = usePlayer();
  const toast = useToast();
  const [tier, setTier] = useState<PerfTier>(() => getProfile().tier);
  const [saving, setSaving] = useState(false);
  const timer = useRef<number>();

  // Sliders fire constantly; apply immediately, persist once they settle.
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
  useEffect(() => subscribe((profile) => setTier(profile.tier)), []);

  const crossfade = theme.crossfade ?? 0;

  return (
    <div className="mx-auto max-w-4xl">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="title-xl text-3xl sm:text-4xl">Playback</h1>
        <p className="mt-1 text-sm text-muted">
          How one track hands over to the next, and how hard this machine works
          while it happens.
          {saving && <span className="ml-2 opacity-70">saving…</span>}
        </p>
      </motion.div>

      {/* ------------------------------ crossfade ----------------------------- */}
      <Section
        title="Crossfade"
        hint="The next track starts before this one ends, and the two are mixed across the overlap."
      >
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-sm font-semibold">Overlap</span>
          <span className="font-mono text-xs text-muted">
            {crossfade > 0 ? `${crossfade.toFixed(1)} seconds` : "off"}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={12}
          step={0.5}
          value={crossfade}
          onChange={(e) => nudge({ crossfade: Number(e.target.value) })}
          className="w-full"
          aria-label="Crossfade length"
        />
        <div className="mt-1 flex justify-between font-mono text-[10px] text-muted">
          <span>off</span>
          <span>6s</span>
          <span>12s</span>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {[0, 2, 4, 6, 8].map((preset) => (
            <button
              key={preset}
              onClick={() => commit({ crossfade: preset })}
              className={`chip ${Math.abs(crossfade - preset) < 0.01 ? "chip-on" : ""}`}
            >
              {preset === 0 ? "Off" : `${preset}s`}
            </button>
          ))}
        </div>

        <p className="mt-4 text-xs leading-relaxed text-muted">
          {crossfade > 0 ? (
            <>
              Mixed on an equal-power curve, so the volume holds steady through the
              handover instead of sagging in the middle. Short sketches never fade
              over more than a third of their length.
              <br />
              <strong className="text-ink">
                Play from a library or album
              </strong>{" "}
              so there is a next track to fade into — a single track opened on its
              own has nothing queued behind it.
            </>
          ) : (
            "Tracks start the moment the one before them finishes."
          )}
        </p>
      </Section>

      {/* -------------------------------- queue ------------------------------- */}
      <Section title="Queue" hint="Remembered on this device.">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={toggleShuffle}
            className={`chip ${shuffle ? "chip-on" : ""}`}
          >
            <Icon name="shuffle" size={13} />
            Shuffle {shuffle ? "on" : "off"}
          </button>
          <button onClick={cycleRepeat} className={`chip ${repeat !== "off" ? "chip-on" : ""}`}>
            <Icon name="repeat" size={13} />
            {repeat === "off"
              ? "Repeat off"
              : repeat === "all"
                ? "Repeat queue"
                : "Repeat one track"}
          </button>
        </div>
        <p className="mt-3 text-xs text-muted">
          The same two buttons sit in the player bar, next to skip.
        </p>
      </Section>

      {/* -------------------------------- speed ------------------------------- */}
      <Section title="Speed" hint="Useful for checking a beat slowed down. Pitch is not corrected.">
        <div className="glass inline-flex flex-wrap rounded-xl p-1">
          {PLAYBACK_SPEEDS.map((rate) => (
            <button
              key={rate}
              onClick={() => setSpeed(rate)}
              className="rounded-lg px-3.5 py-1.5 font-mono text-xs font-medium transition"
              style={{
                background: speed === rate ? "rgb(var(--accent-rgb) / 0.22)" : "transparent",
                color: speed === rate ? "rgb(var(--ink-rgb))" : "rgb(var(--muted-rgb))",
              }}
            >
              {rate === 1 ? "1x" : `${rate}x`}
            </button>
          ))}
        </div>
      </Section>

      {/* ----------------------------- performance ---------------------------- */}
      <Section
        title="Performance"
        hint="On an older laptop the blur and glow cost more than everything else here put together."
      >
        <div className="grid gap-2 sm:grid-cols-3">
          {([
            ["auto", "Automatic", "Watches the frame rate and eases off if it drops"],
            ["high", "Full", "Every effect, all the time"],
            ["low", "Light", "No blur, no glow, fewer particles"],
          ] as const).map(([value, label, detail]) => {
            const active = (theme.performance ?? "auto") === value;
            return (
              <button
                key={value}
                onClick={() => commit({ performance: value }, `${label} graphics`)}
                className="card p-3 text-left"
                style={{
                  borderColor: active ? "rgb(var(--accent-rgb))" : undefined,
                  background: active ? "rgb(var(--accent-rgb) / 0.1)" : undefined,
                }}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-display text-sm font-bold">{label}</span>
                  {active && (
                    <span style={{ color: "rgb(var(--accent-rgb))" }}>
                      <Icon name="check" size={13} />
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-muted">
                  {detail}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-muted">
          Currently drawing in <strong>{tier === "low" ? "light" : "full"}</strong> mode
          {(theme.performance ?? "auto") === "auto" && tier === "low"
            ? " — this machine asked for it, or the frame rate did."
            : "."}
        </p>
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
