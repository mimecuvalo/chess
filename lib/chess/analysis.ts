/**
 * Grading moves.
 *
 * We deliberately grade on *win probability* rather than raw centipawns. Losing
 * 100cp from a dead-level position is a catastrophe; losing 100cp when you're
 * already up a queen is noise. Centipawn deltas treat those identically, which is
 * why engine-flavoured trainers so often scold you for nothing.
 */

import type { Analysis, EngineLine, MoveGrade } from './types';

/**
 * The standard logistic used by Lichess and friends. 0cp -> 0.5, +400cp -> ~0.91.
 */
export function winProbability(cp: number): number {
  return 1 / (1 + 10 ** (-cp / 400));
}

/** Collapses an engine line's score to centipawns, clamping mates to a huge value. */
export function lineToCp(line: EngineLine | null | undefined): number {
  if (!line) return 0;
  if (line.mate !== null) return line.mate > 0 ? 10_000 : -10_000;
  return line.cp ?? 0;
}

/** Win probability for the side to move in this analysis. */
export function analysisWinProbability(analysis: Analysis | null): number {
  if (!analysis || !analysis.lines.length) return 0.5;
  return winProbability(lineToCp(analysis.lines[0]));
}

/**
 * Thresholds in lost win-probability. Tuned so that a "mistake" is roughly
 * "you'd notice this in the post-mortem" and a "blunder" is "the game changed".
 */
const THRESHOLDS: { grade: MoveGrade; lost: number }[] = [
  { grade: 'blunder', lost: 0.2 },
  { grade: 'mistake', lost: 0.12 },
  { grade: 'inaccuracy', lost: 0.06 },
  { grade: 'good', lost: 0.02 },
];

/**
 * Grades a move from the win probability before and after it, both expressed
 * from the *mover's* perspective.
 */
export function gradeMove(
  winProbBefore: number,
  winProbAfter: number,
  wasEngineBest: boolean
): { grade: MoveGrade; lost: number } {
  const lost = Math.max(0, winProbBefore - winProbAfter);

  if (wasEngineBest) return { grade: 'best', lost: 0 };

  for (const { grade, lost: threshold } of THRESHOLDS) {
    if (lost >= threshold) return { grade, lost };
  }
  return { grade: 'excellent', lost };
}

/** Human-readable label for a grade. */
export const GRADE_LABEL: Record<MoveGrade, string> = {
  best: 'Best move',
  excellent: 'Excellent',
  good: 'Good',
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  blunder: 'Blunder',
};

/** A glyph for the move list, in the spirit of chess annotation symbols. */
export const GRADE_GLYPH: Record<MoveGrade, string> = {
  best: '★',
  excellent: '!',
  good: '',
  inaccuracy: '?!',
  mistake: '?',
  blunder: '??',
};

/**
 * Formats an evaluation the way a chess UI does: "+1.4", "-0.6", "M3".
 * Always from White's perspective, which is what an eval bar shows.
 */
export function formatEval(line: EngineLine | null, sideToMove: 'w' | 'b'): string {
  if (!line) return '0.0';

  const perspective = sideToMove === 'w' ? 1 : -1;

  if (line.mate !== null) {
    const mate = line.mate * perspective;
    return `${mate > 0 ? 'M' : '-M'}${Math.abs(line.mate)}`;
  }

  const pawns = ((line.cp ?? 0) * perspective) / 100;
  return `${pawns > 0 ? '+' : ''}${pawns.toFixed(1)}`;
}

/** Describes a centipawn swing in pawns, e.g. "1.4 pawns", "half a pawn". */
export function describeCost(cpLost: number): string {
  const pawns = cpLost / 100;
  if (pawns < 0.35) return 'a fraction of a pawn';
  if (pawns < 0.75) return 'about half a pawn';
  if (pawns < 1.4) return 'about a pawn';
  return `about ${pawns.toFixed(1)} pawns`;
}
