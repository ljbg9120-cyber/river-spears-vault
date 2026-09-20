/**
 * Profile decoration: the drifting overlay behind a banner, and the treatment
 * around a profile picture.
 *
 * Deliberately CSS rather than canvas — these are small, always-on, and often
 * several to a page on the People list. Transform and opacity animations are
 * compositor work, so they cost close to nothing even on a weak machine, and
 * the low performance profile drops them entirely.
 */
import { useMemo } from "react";
import type { AvatarFrame, ProfileEffect } from "../lib/api";
import { getProfile } from "../lib/perf";

const KEYFRAMES = `
@keyframes decorRise {
  0%   { transform: translate3d(0, 110%, 0) rotate(0deg); opacity: 0; }
  12%  { opacity: 1; }
  88%  { opacity: 1; }
  100% { transform: translate3d(var(--drift, 0px), -20%, 0) rotate(var(--spin, 0deg)); opacity: 0; }
}
@keyframes decorFall {
  0%   { transform: translate3d(0, -20%, 0) rotate(0deg); opacity: 0; }
  10%  { opacity: 1; }
  90%  { opacity: 1; }
  100% { transform: translate3d(var(--drift, 0px), 120%, 0) rotate(var(--spin, 0deg)); opacity: 0; }
}
@keyframes decorTwinkle {
  0%, 100% { transform: scale(0.6); opacity: 0; }
  50%      { transform: scale(1); opacity: 1; }
}
`;

type Piece = {
  left: number;
  delay: number;
  duration: number;
  size: number;
  drift: number;
  spin: number;
  glyph: string;
};

const GLYPHS: Record<ProfileEffect, string[]> = {
  none: [],
  notes: ["♪", "♫", "♩", "♬"],
  sparkles: ["✦", "✧", "⋆"],
  confetti: ["▪", "▬", "◆"],
  rain: ["|"],
  embers: ["●"],
};

export function ProfileEffectLayer({
  effect,
  accent,
  accent2,
}: {
  effect: ProfileEffect;
  accent: string;
  accent2: string;
}) {
  const perf = getProfile();
  const count = effect === "none" ? 0 : Math.round(18 * perf.density);

  const pieces = useMemo<Piece[]>(() => {
    const glyphs = GLYPHS[effect] ?? [];
    if (!glyphs.length) return [];
    // Seeded-ish by index so the layout is stable between renders.
    return Array.from({ length: count }, (_, i) => ({
      left: (i * 37) % 100,
      delay: (i % 7) * 0.9,
      duration: 6 + ((i * 13) % 7),
      size: 10 + ((i * 7) % 12),
      drift: (((i * 29) % 60) - 30),
      spin: (((i * 53) % 200) - 100),
      glyph: glyphs[i % glyphs.length],
    }));
  }, [effect, count]);

  // Ambient motion is exactly what the light profile exists to drop.
  if (effect === "none" || !perf.ambient || !pieces.length) return null;

  const falls = effect === "rain" || effect === "confetti";
  const twinkles = effect === "sparkles";

  return (
    <span className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <style>{KEYFRAMES}</style>
      {pieces.map((p, i) => (
        <span
          key={i}
          className="absolute"
          style={{
            left: `${p.left}%`,
            top: twinkles ? `${(i * 23) % 100}%` : undefined,
            fontSize: p.size,
            lineHeight: 1,
            color: i % 2 ? accent2 : accent,
            opacity: 0,
            ["--drift" as string]: `${p.drift}px`,
            ["--spin" as string]: `${p.spin}deg`,
            animation: `${
              twinkles ? "decorTwinkle" : falls ? "decorFall" : "decorRise"
            } ${p.duration}s linear ${p.delay}s infinite`,
            textShadow: `0 0 8px currentColor`,
          }}
        >
          {p.glyph}
        </span>
      ))}
    </span>
  );
}

/** The treatment around a profile picture. */
export function frameStyle(frame: AvatarFrame, accent: string, accent2: string) {
  switch (frame) {
    case "ring":
      return {
        padding: 3,
        borderRadius: 999,
        background: `linear-gradient(135deg, ${accent}, ${accent2})`,
      };
    case "glow":
      return {
        padding: 3,
        borderRadius: 999,
        background: "rgb(var(--bg-rgb))",
        boxShadow: `0 0 26px 2px ${accent}`,
      };
    case "vinyl":
      // Concentric grooves, which is the one frame that earns its place on a
      // music site rather than being decoration for its own sake.
      return {
        padding: 6,
        borderRadius: 999,
        background: `repeating-radial-gradient(circle, #111 0 2px, #1d1d24 2px 4px)`,
        boxShadow: `0 0 0 2px ${accent}55`,
      };
    case "square":
      return {
        padding: 3,
        borderRadius: 18,
        background: `linear-gradient(135deg, ${accent}, ${accent2})`,
      };
    default:
      return { padding: 3, borderRadius: 999, background: "rgb(var(--bg-rgb))" };
  }
}

export function frameRadius(frame: AvatarFrame): number {
  return frame === "square" ? 14 : 999;
}
