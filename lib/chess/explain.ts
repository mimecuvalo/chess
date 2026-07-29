/**
 * Turning engine output into coaching prose.
 *
 * `CoachExplainer` is async from day one so a Claude-backed explainer can be
 * dropped in later without touching a single component (see explain-claude.ts).
 * The rule-based implementation below is instant, offline, free and deterministic,
 * which makes it the right default: you get feedback the moment you move.
 */

import { Chess } from 'chess.js';
import { GRADE_LABEL, analysisWinProbability, describeCost, gradeMove, lineToCp } from './analysis';
import { describeSan, describeSanCapitalized, detectMotifs, hangingPieces, pieceName } from './motifs';
import { score } from './score';
import type {
  Analysis,
  BotSearchResult,
  DetailItem,
  Explanation,
  InlineMove,
  MoveAssessment,
  MoveLine,
  UciMove,
} from './types';

export type MoveContext = {
  /** Position the move was played in. */
  fenBefore: string;
  move: UciMove;
  san: string;
  /** Analysis of `fenBefore` (from the mover's perspective). */
  before: Analysis;
  /** Analysis of the position after the move (from the opponent's perspective). */
  after: Analysis;
};

export type BotMoveContext = MoveContext & {
  /** What the 1K engine reported about its own search. */
  search: BotSearchResult;
};

export interface CoachExplainer {
  explainYourMove(ctx: MoveContext): Promise<Explanation>;
  explainBotMove(ctx: BotMoveContext): Promise<Explanation>;
  /** Progressive hint for the position the player is about to move in. */
  hint(fen: string, analysis: Analysis, level: 0 | 1 | 2): Promise<Explanation>;
}

/** Builds the structured assessment that the prose is generated from. */
export function assessMove(ctx: MoveContext): MoveAssessment {
  const { fenBefore, move, san, before, after } = ctx;

  const best = before.lines[0] ?? null;
  const wasBest = best?.move === move;

  const winProbBefore = analysisWinProbability(before);
  // `after` is scored for the opponent, so flip it back to the mover's view.
  const winProbAfter = 1 - analysisWinProbability(after);

  const { grade, lost } = gradeMove(winProbBefore, winProbAfter, wasBest);

  return {
    san,
    move,
    grade,
    winProbBefore,
    winProbAfter,
    lost,
    best,
    refutation: after.lines[0] ?? null,
    motifs: detectMotifs(fenBefore, move),
  };
}

/**
 * Spells out a variation as a `MoveLine`, so notation is never left cramped. Each
 * ply becomes "knight to f3 (Nf3)". It also replays the line from `baseFen` to
 * record the position after every ply, which is what lets the board ghost a single
 * move on hover and animate the whole sequence. Kept to a few plies so the list
 * stays scannable, and truncated at the first move that won't replay.
 */
function describeLine(lead: string, baseFen: string, pv: string[], plies = 5): MoveLine {
  const chess = new Chess(baseFen);
  const moves: string[] = [];
  const fens: string[] = [];

  for (const san of pv.slice(0, plies)) {
    let played;
    try {
      played = chess.move(san);
    } catch {
      break;
    }
    if (!played) break;
    moves.push(`${describeSan(san)} (${san})`);
    fens.push(chess.fen());
  }

  return { lead, moves, baseFen, fens };
}

/**
 * Builds one hoverable move mention for use inside a sentence. Returns a plain
 * string (non-hoverable) if the move can't be replayed from `baseFen`, so callers
 * can drop it straight into a segment list either way.
 */
function moveSeg(
  baseFen: string,
  san: string,
  opts: { suffix?: string; capitalize?: boolean } = {}
): InlineMove | string {
  let described = describeSan(san);
  if (opts.capitalize) described = described.charAt(0).toUpperCase() + described.slice(1);
  const label = `${described} (${san}${opts.suffix ?? ''})`;

  const chess = new Chess(baseFen);
  let played;
  try {
    played = chess.move(san);
  } catch {
    return label;
  }
  return played ? { label, fen: chess.fen() } : label;
}

export class RuleBasedExplainer implements CoachExplainer {
  async explainYourMove(ctx: MoveContext): Promise<Explanation> {
    const assessment = assessMove(ctx);
    const { grade, best, refutation, motifs, san } = assessment;

    const detail: DetailItem[] = [];
    const highlight: Explanation['highlight'] = [];

    // 1. What the move did, and what it cost.
    const cpLost = best ? Math.abs(lineToCp(best) - -lineToCp(ctx.after.lines[0] ?? null)) : 0;
    const moveName = describeSanCapitalized(san);
    const headline =
      grade === 'best'
        ? `${moveName} (${san}) — best move.`
        : grade === 'excellent' || grade === 'good'
          ? `${moveName} (${san}) — ${GRADE_LABEL[grade].toLowerCase()}.`
          : `${moveName} (${san}) is ${grade === 'inaccuracy' ? 'an' : 'a'} ${GRADE_LABEL[grade].toLowerCase()}; it gives away ${describeCost(cpLost)}.`;

    // 2. The refutation: what the opponent gets to do about it.
    if (refutation && grade !== 'best' && grade !== 'excellent') {
      const fenAfter = ctxFenAfter(ctx);
      const refutationMotifs = detectMotifs(fenAfter, refutation.move);
      const point = refutationMotifs.find((m) => ['mate', 'fork', 'skewer', 'pin'].includes(m.kind));
      // A free capture is almost always the real story, and it's the case a
      // beginner most needs named plainly. Only reach for a tactical motif when
      // the refutation isn't simply taking something.
      const grab = describeFreeCapture(fenAfter, refutation.move);

      // The refutation move is hoverable — previewed from the position after
      // your move, where it's played.
      const refSeg = moveSeg(fenAfter, refutation.san);
      detail.push({
        segments: grab
          ? ['The problem is ', refSeg, ` — ${grab}.`]
          : point
            ? ['The problem is ', refSeg, `, which ${point.phrase}.`]
            : ['The reply is ', refSeg, '.'],
      });
      // Spell out the whole line it leads to, if there's more than the one move.
      // The refutation is played from the position after your move.
      if (!grab && refutation.pv.length > 1) {
        detail.push(describeLine('The line runs:', fenAfter, refutation.pv));
      }
      highlight.push({
        from: refutation.move.slice(0, 2),
        to: refutation.move.slice(2, 4),
        color: '#d64545',
      });
    }

    // 3. What was better, and what its point was.
    if (best && grade !== 'best') {
      const bestMotifs = detectMotifs(ctx.fenBefore, best.move);
      const point = bestMotifs.find((m) => ['fork', 'pin', 'skewer', 'mate', 'promotion'].includes(m.kind));
      // The better move is hoverable, previewed from the position before your move.
      const bestSeg = moveSeg(ctx.fenBefore, best.san, { capitalize: true });
      detail.push({
        segments: point ? [bestSeg, ` was better: it ${point.phrase}.`] : [bestSeg, ' was better.'],
      });
      // Stockfish's best line is played from the position before your move.
      if (best.pv.length > 1) {
        detail.push(describeLine('The idea:', ctx.fenBefore, best.pv));
      }
      highlight.push({
        from: best.move.slice(0, 2),
        to: best.move.slice(2, 4),
        color: '#3d9970',
      });
    }

    // A parting warning about anything you left en prise.
    const loose = motifs.filter((m) => m.kind === 'hanging');
    if (loose.length && grade !== 'best') {
      detail.push(`Careful — this ${loose[0].phrase}.`);
    }

    return { headline, detail, highlight };
  }

  async explainBotMove(ctx: BotMoveContext): Promise<Explanation> {
    const { search } = ctx;
    const detail: DetailItem[] = [];

    const chosenName = search.san ? describeSanCapitalized(search.san) : search.move;
    const headline = `${chosenName} (${search.san || search.move}) — the bot scores this ${score(search.score / 100)}.`;

    // What it expects to happen next — spelled out as a list. (search.pv is SAN,
    // played from the position before the bot moved.)
    if (search.pv.length > 1) {
      detail.push(describeLine('It expects:', ctx.fenBefore, search.pv));
    }

    // What it turned down, each move hoverable and spelled out with its score.
    const alternatives = search.rootMoves.filter((m) => m.move !== search.move).slice(0, 2);
    if (alternatives.length) {
      const segments: (string | InlineMove)[] = ['It also looked at '];
      alternatives.forEach((m, index) => {
        if (index > 0) segments.push(' and ');
        const suffix = `, ${score(m.score / 100)}`;
        segments.push(m.san ? moveSeg(ctx.fenBefore, m.san, { suffix }) : `${m.move} (${suffix.slice(2)})`);
      });
      segments.push(`, across ${search.nodes.toLocaleString()} positions at depth ${search.depth}.`);
      detail.push({ segments });
    }

    // Honesty about the coin flip.
    if (search.tiedWithBest.length > 1) {
      detail.push(
        `${search.tiedWithBest.length} moves tied for best, so it flipped a coin — it has no positional tiebreaker to appeal to.`
      );
    }

    // The blind-spot callout: where its material-only eval and Stockfish part ways.
    const blindSpot = describeBlindSpot(ctx);
    if (blindSpot) detail.push(blindSpot);

    return {
      headline,
      detail,
      highlight: [{ from: search.move.slice(0, 2), to: search.move.slice(2, 4), color: '#7a5af5' }],
    };
  }

  async hint(fen: string, analysis: Analysis, level: 0 | 1 | 2): Promise<Explanation> {
    const best = analysis.lines[0];
    if (!best) {
      return { headline: 'No suggestion available.', detail: [], highlight: [] };
    }

    const chess = new Chess(fen);
    const piece = chess.get(best.move.slice(0, 2) as never);
    const motifs = detectMotifs(fen, best.move);
    const point = motifs.find((m) => m.kind !== 'hanging');

    // Level 0: the idea. Level 1: which piece. Level 2: the move itself.
    if (level === 0) {
      const loose = hangingPieces(fen, chess.turn() === 'w' ? 'b' : 'w');
      return {
        headline: point
          ? `There's a move here that ${point.phrase}.`
          : loose.length
            ? `Look for a loose piece — something of theirs isn't properly defended.`
            : `Nothing tactical; look for the move that improves your worst-placed piece.`,
        detail: [],
        highlight: [],
      };
    }

    if (level === 1) {
      return {
        headline: piece
          ? `Think about your ${pieceName(piece.type)} on ${best.move.slice(0, 2)}.`
          : `Think about the piece on ${best.move.slice(0, 2)}.`,
        detail: [],
        highlight: [{ from: best.move.slice(0, 2), to: best.move.slice(0, 2), color: '#3d9970' }],
      };
    }

    return {
      headline: `Play ${describeSan(best.san)} (${best.san}).`,
      detail: point ? [`It ${point.phrase}.`] : best.pv.length > 1 ? [describeLine('The idea:', fen, best.pv)] : [],
      highlight: [{ from: best.move.slice(0, 2), to: best.move.slice(2, 4), color: '#3d9970' }],
    };
  }
}

/**
 * If `uci` captures something the opponent can't profitably recapture, describes
 * the grab in plain words. Returns null when the capture is an even trade or when
 * the move isn't a capture at all — in those cases the tactical motif, not the
 * capture, is the thing worth explaining.
 */
function describeFreeCapture(fen: string, uci: UciMove): string | null {
  const chess = new Chess(fen);
  let move;
  try {
    move = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : undefined,
    });
  } catch {
    return null;
  }
  if (!move?.captured) return null;

  const target = pieceName(move.captured);
  const recapturers = chess.attackers(move.to as never, chess.turn());

  if (!recapturers.length) return `it just takes the ${target}`;

  const capturedValue = PIECE_VALUE[move.captured] ?? 0;
  const attackerValue = PIECE_VALUE[move.piece] ?? 0;
  if (capturedValue - attackerValue >= 2) {
    return `it wins the ${target} for a ${pieceName(move.piece)}`;
  }
  return null;
}

const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

/** The FEN after the move in a `MoveContext` — i.e. what `after` analysed. */
function ctxFenAfter(ctx: MoveContext): string {
  return ctx.after.fen;
}

/**
 * The heart of the bot's self-awareness: where its material-only evaluation and
 * Stockfish's judgement disagree, and which missing eval term explains the gap.
 */
function describeBlindSpot(ctx: BotMoveContext): string | null {
  const stockfishAfter = ctx.after.lines[0];
  if (!stockfishAfter) return null;

  // `after` is from the human's perspective; flip it to the bot's.
  const botViewCp = -lineToCp(stockfishAfter);
  const botOwnScore = ctx.search.score;

  // Both in centipawn-ish units. The 1K engine's units are coarse, so only call
  // out disagreements that are large enough to be real.
  const gap = botOwnScore - botViewCp;
  if (Math.abs(gap) < 150) return null;

  const fenAfter = ctx.after.fen;
  const loose = hangingPieces(fenAfter, botColor(ctx));

  if (gap > 0) {
    // The bot is more optimistic than reality.
    if (loose.length) {
      return `Stockfish rates this ${score(botViewCp / 100)} — the bot missed that its ${pieceName(loose[0].piece)} on ${loose[0].square} is loose. Its evaluation is material only, so an attacked piece looks the same as a safe one until it's actually captured.`;
    }
    return `Stockfish rates this ${score(botViewCp / 100)}, well below the bot's own ${score(botOwnScore / 100)}. With no king safety or mobility terms, it can't see positional trouble coming — only material it has already counted.`;
  }

  return `Stockfish actually likes this more than the bot does (${score(botViewCp / 100)} vs ${score(botOwnScore / 100)}). It stumbled into a good move it can't explain — at four plies it saw the material, not the reason.`;
}

/** The colour the bot is playing, derived from whose turn it is after its move. */
function botColor(ctx: BotMoveContext): 'w' | 'b' {
  const chess = new Chess(ctx.after.fen);
  return chess.turn() === 'w' ? 'b' : 'w';
}
