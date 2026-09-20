/**
 * Webfont loading.
 *
 * Forty-odd typefaces are offered; fetching them all would be absurd, so each
 * one is requested the first time something actually asks for it and then
 * remembered. Visiting a profile loads that profile's font, not the whole
 * catalogue.
 */

const loaded = new Set<string>();

/** Bundled with the app, so it never needs fetching. */
export const DEFAULT_FONT = "Outfit";

export function loadFont(name: string | null | undefined): void {
  if (!name || name === DEFAULT_FONT || loaded.has(name)) return;
  if (typeof document === "undefined") return;

  loaded.add(name);
  const id = `font-${name.replace(/\s+/g, "-").toLowerCase()}`;
  if (document.getElementById(id)) return;

  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  // Not every family has every weight; Google serves the closest it has.
  link.href =
    "https://fonts.googleapis.com/css2?family=" +
    encodeURIComponent(name).replace(/%20/g, "+") +
    ":wght@400;600;700&display=swap";
  document.head.appendChild(link);
}

export function fontStack(name: string | null | undefined): string {
  return name ? `"${name}", "${DEFAULT_FONT}", system-ui, sans-serif`
              : `"${DEFAULT_FONT}", system-ui, sans-serif`;
}

/**
 * A neon-style text shadow in `colour`, scaled by `amount` (0..1).
 * Layered rather than one big blur: a single shadow reads as a smudge,
 * several at increasing radii read as light.
 */
export function glowStyle(amount: number, colour: string): string | undefined {
  if (!amount) return undefined;
  const a = Math.max(0, Math.min(1, amount));
  return [
    `0 0 ${(4 * a).toFixed(1)}px ${colour}`,
    `0 0 ${(12 * a).toFixed(1)}px ${colour}`,
    `0 0 ${(28 * a).toFixed(1)}px ${colour}`,
    `0 0 ${(52 * a).toFixed(1)}px ${colour}`,
  ].join(", ");
}
