/**
 * How hard the interface is allowed to work.
 *
 * The expensive things here are backdrop blur (every glass panel), canvas
 * shadow blur (every visualizer), and device-pixel-ratio scaling on a laptop
 * with a 2x screen and integrated graphics. On a weak machine those together
 * turn a music player into a slideshow.
 *
 * "low" is not a stripped interface — it is the same interface drawn cheaply.
 * "auto" starts from what the device reports, then watches real frame rate and
 * drops down if the machine is actually struggling.
 */

export type PerfSetting = "auto" | "high" | "low";
export type PerfTier = "high" | "low";

export type PerfProfile = {
  tier: PerfTier;
  /** Cap for canvas backing-store scaling. 2x costs four times the fill rate. */
  dpr: number;
  /** ctx.shadowBlur is the single most expensive thing a visualizer does. */
  glow: boolean;
  /** Frames per second the canvas loops aim for. */
  fps: number;
  /** How many bars/particles/rays to draw, as a multiplier. */
  density: number;
  /** backdrop-filter on glass panels. */
  blur: boolean;
  /** Film grain, drifting blobs, looping decorative animation. */
  ambient: boolean;
};

const HIGH: PerfProfile = {
  tier: "high", dpr: 2, glow: true, fps: 60, density: 1, blur: true, ambient: true,
};
const LOW: PerfProfile = {
  tier: "low", dpr: 1, glow: false, fps: 30, density: 0.5, blur: false, ambient: false,
};

export const PROFILES: Record<PerfTier, PerfProfile> = { high: HIGH, low: LOW };

/** What the device says about itself, before we have watched it run. */
export function guessTier(): PerfTier {
  if (typeof navigator === "undefined") return "high";

  const cores = navigator.hardwareConcurrency ?? 8;
  const memory = (navigator as { deviceMemory?: number }).deviceMemory ?? 8;

  // Someone who has asked for less motion gets the cheap path too: it is the
  // same preference expressed a different way.
  const reduced =
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;

  const saveData =
    (navigator as { connection?: { saveData?: boolean } }).connection?.saveData === true;

  if (reduced || saveData) return "low";
  if (cores <= 4) return "low";
  if (memory <= 4) return "low";
  return "high";
}

let listeners = new Set<(p: PerfProfile) => void>();
let setting: PerfSetting = "auto";
let measured: PerfTier | null = null;
let profile: PerfProfile = HIGH;

function resolve(): PerfProfile {
  if (setting === "high") return HIGH;
  if (setting === "low") return LOW;
  return PROFILES[measured ?? guessTier()];
}

function publish() {
  const next = resolve();
  if (next.tier === profile.tier && next === profile) return;
  profile = next;
  if (typeof document !== "undefined") {
    document.documentElement.dataset.perf = profile.tier;
  }
  listeners.forEach((fn) => fn(profile));
}

export function getProfile(): PerfProfile {
  return profile;
}

export function setPerfSetting(next: PerfSetting) {
  if (setting === next) return;
  setting = next;
  // A deliberate choice clears anything measured, so switching back to auto
  // re-measures rather than remembering an old bad moment.
  if (next !== "auto") measured = null;
  publish();
}

export function subscribe(fn: (p: PerfProfile) => void): () => void {
  listeners.add(fn);
  fn(profile);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Watch real frame rate and drop to the cheap path if the machine cannot keep
 * up. Only ever downgrades: flapping between tiers would be worse than either.
 */
export function startWatching() {
  if (typeof requestAnimationFrame === "undefined") return () => {};

  let frames = 0;
  let windowStart = performance.now();
  let slowWindows = 0;
  let raf = 0;
  let stopped = false;

  const tick = () => {
    if (stopped) return;
    frames++;
    const now = performance.now();
    const elapsed = now - windowStart;

    if (elapsed >= 2000) {
      const fps = (frames * 1000) / elapsed;
      frames = 0;
      windowStart = now;

      // Ignore windows where the tab was hidden or the machine was busy
      // elsewhere; only sustained slowness counts.
      if (fps < 24) slowWindows++;
      else slowWindows = 0;

      if (slowWindows >= 2 && setting === "auto" && measured !== "low") {
        measured = "low";
        publish();
      }
    }
    raf = requestAnimationFrame(tick);
  };

  raf = requestAnimationFrame(tick);
  const onHidden = () => {
    // A hidden tab throttles rAF to ~1fps; that is not the GPU struggling.
    frames = 0;
    windowStart = performance.now();
    slowWindows = 0;
  };
  document.addEventListener("visibilitychange", onHidden);

  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    document.removeEventListener("visibilitychange", onHidden);
  };
}

/** Initialise before first paint so the cheap path never flashes the dear one. */
export function initPerf(preference: PerfSetting = "auto") {
  setting = preference;
  profile = resolve();
  if (typeof document !== "undefined") {
    document.documentElement.dataset.perf = profile.tier;
  }
  return profile;
}
