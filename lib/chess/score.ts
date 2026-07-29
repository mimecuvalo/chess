/**
 * Giving evaluation numbers a visible scale.
 *
 * A bare "1.5" tells a beginner nothing — is that a lot? So every score we show
 * is coloured on a red → amber → green heat scale, and formatted consistently.
 *
 * Scores are in pawns, from the perspective of whoever the score belongs to:
 * positive means that side is ahead. There's no hard maximum — a forced mate is
 * effectively infinite and shown as `M3` rather than a number — but past about
 * ±10 pawns the game is decided, so that's where the colour saturates.
 */

/** Where the colour scale tops out, in pawns. Beyond this it's a decided game. */
export const DECISIVE_PAWNS = 10;

type Rgb = [number, number, number];

const RED: Rgb = [0xd6, 0x45, 0x45];
const AMBER: Rgb = [0xd9, 0xa4, 0x41];
const GREEN: Rgb = [0x4c, 0xb0, 0x6a];

function mix(a: Rgb, b: Rgb, t: number): string {
  const channel = (i: number) => Math.round(a[i] + (b[i] - a[i]) * t);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

/**
 * A colour for a score in pawns. 0 is amber (even), positive trends green, negative
 * trends red, saturating at ±{@link DECISIVE_PAWNS}.
 */
export function scoreColor(pawns: number): string {
  const t = Math.max(-1, Math.min(1, pawns / DECISIVE_PAWNS));
  if (t >= 0) return mix(AMBER, GREEN, t);
  return mix(AMBER, RED, -t);
}

/** Formats a score in pawns the way a chess UI does: "+1.5", "-0.6", "0.0". */
export function formatScore(pawns: number): string {
  const rounded = pawns.toFixed(1);
  return pawns > 0 ? `+${rounded}` : rounded;
}

/**
 * We embed scores inside prose strings but still want to colour just the numbers,
 * so scores are wrapped in guillemet sentinels the renderer can find without
 * accidentally colouring things like "depth 4" or "220,252 positions".
 *
 *   `the bot scores this ${score(0.1)}`  ->  "the bot scores this «+0.1»"
 */
export function score(pawns: number): string {
  return `«${formatScore(pawns)}»`;
}

const SENTINEL = /«([+-]?\d+\.\d+)»/g;

/** One run of prose: either plain text or a score to be coloured. */
export type ProseToken = { text: string; score?: number };

/** Splits a prose string into plain and score tokens for colour rendering. */
export function tokenizeProse(line: string): ProseToken[] {
  const tokens: ProseToken[] = [];
  let lastIndex = 0;
  for (const match of line.matchAll(SENTINEL)) {
    const start = match.index ?? 0;
    if (start > lastIndex) tokens.push({ text: line.slice(lastIndex, start) });
    tokens.push({ text: match[1], score: Number(match[1]) });
    lastIndex = start + match[0].length;
  }
  if (lastIndex < line.length) tokens.push({ text: line.slice(lastIndex) });
  return tokens;
}
