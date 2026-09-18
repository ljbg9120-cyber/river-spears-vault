/**
 * Lyrics are stored as plain text. A line may carry an LRC-style timestamp:
 *
 *   [00:12.40] first line
 *   [00:16.10] second line
 *
 * Timed lines drive the scrolling view. Untimed text still displays, it just
 * does not follow along — so pasting lyrics from anywhere works immediately.
 */

export type LyricLine = {
  /** Seconds into the track, or null for an untimed line. */
  time: number | null;
  text: string;
};

const STAMP = /^\s*\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]\s?/;

export function parseLyrics(raw: string): LyricLine[] {
  if (!raw?.trim()) return [];

  return raw.replace(/\r\n/g, "\n").split("\n").map((line) => {
    const match = STAMP.exec(line);
    if (!match) return { time: null, text: line.trim() };

    const [, mm, ss, frac] = match;
    // ".4" means four tenths, ".40" forty hundredths — pad, don't parse raw.
    const fraction = frac ? Number(frac.padEnd(3, "0")) / 1000 : 0;
    return {
      time: Number(mm) * 60 + Number(ss) + fraction,
      text: line.slice(match[0].length).trim(),
    };
  });
}

export function hasTimings(lines: LyricLine[]): boolean {
  return lines.some((l) => l.time !== null);
}

/**
 * Index of the line that should be highlighted at `time`, or -1 before the
 * first one. Ignores untimed lines so a stray heading cannot capture the
 * highlight.
 */
export function activeLineIndex(lines: LyricLine[], time: number): number {
  let active = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].time;
    if (t === null) continue;
    if (t <= time + 0.15) active = i;
    else break;
  }
  return active;
}

export function formatStamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  return `[${m.toString().padStart(2, "0")}:${s
    .toString()
    .padStart(2, "0")}.${cs.toString().padStart(2, "0")}]`;
}

/** Re-emit lines as text, keeping whatever timestamps they carry. */
export function serializeLyrics(lines: LyricLine[]): string {
  return lines
    .map((l) => (l.time === null ? l.text : `${formatStamp(l.time)} ${l.text}`))
    .join("\n");
}

/** Drop every timestamp, leaving the words. */
export function stripTimings(raw: string): string {
  return parseLyrics(raw)
    .map((l) => l.text)
    .join("\n");
}
