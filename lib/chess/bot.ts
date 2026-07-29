/**
 * The adapter between the 1K engine and the rest of the app.
 *
 * The engine keeps its own mailbox board, but we never try to keep that in sync
 * with the game: every turn we just hand it the current FEN. Fewer moving parts,
 * and it means a bug in the engine can never corrupt the game state.
 *
 * This is also where the search's raw output is made presentable *and honest*:
 * the principal variation is replayed through chess.js and truncated at the first
 * move that isn't legal. The 1K search reuses its bookkeeping aggressively and its
 * deeper PV entries can be stale, so an unchecked PV would sometimes show a line
 * the bot cannot actually play — and a coach that misreports its own reasoning is
 * worse than one that says nothing.
 */

import { Chess } from 'chess.js';
import { Nanochess } from './nanochess';
import type { BotSearchResult, UciMove } from './types';

/** The 1K engine plays the top side, which in our mapping is Black. */
export const BOT_COLOR = 'b';

/**
 * What one pawn is worth in the 1K engine's own units.
 *
 * Its capture-value table is `pawn 7, knight 20, bishop 19, rook 34, queen 62`,
 * doubled when scoring — so a pawn is 14, and dividing by 14 recovers the usual
 * 1/3/3/5/9 scale almost exactly (2.9 for a knight, 8.9 for a queen). Everything
 * this module emits is converted to centipawns so it can be compared with
 * Stockfish directly, which is the whole basis of the blind-spot callout.
 */
const BOT_PAWN = 14;

function toCentipawns(score: number): number {
  return Math.round((score / BOT_PAWN) * 100);
}

export type BotOptions = {
  /** Search depth. 4 is the stock engine; 2-3 are beatable, 5 is slow. */
  depth?: number;
  /** Tie-break seed; same seed and same moves reproduce a game exactly. */
  seed?: number;
};

/** Plays `uci` on a chess.js instance, returning the SAN or null if illegal. */
function tryMove(chess: Chess, uci: UciMove): string | null {
  try {
    const move = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : undefined,
    });
    return move?.san ?? null;
  } catch {
    return null;
  }
}

/**
 * Runs the 1K engine on a position and returns its reasoning with every move
 * rendered in SAN and the PV verified.
 */
export function think(fen: string, options: BotOptions = {}): BotSearchResult {
  const depth = options.depth ?? 4;

  const engine = new Nanochess(options.seed ?? Math.floor(Math.random() * 2 ** 31));
  engine.loadFen(fen);

  const result = engine.think(depth);

  // The chosen move, in SAN.
  const sanBoard = new Chess(fen);
  const san = tryMove(sanBoard, result.move);
  if (!san) {
    throw new Error(`bot: produced an illegal move ${result.move} in ${fen}`);
  }

  // Verify the PV, stopping at the first move that can't actually be played.
  const pvBoard = new Chess(fen);
  const pv: string[] = [];
  for (const uci of result.pv.slice(0, depth + 2)) {
    const moveSan = tryMove(pvBoard, uci);
    if (!moveSan) break;
    pv.push(moveSan);
  }

  // SAN for each root move it considered — dropping the ones it turned out not to
  // be allowed to play. The search records a move's score before it verifies the
  // move was legal, so when the bot is in check its root list is full of moves
  // that ignore the check. Reporting those as "alternatives it considered" would
  // be a lie about its reasoning.
  const rootMoves = result.rootMoves.flatMap((move) => {
    const board = new Chess(fen);
    const moveSan = tryMove(board, move.move);
    if (!moveSan) return [];
    return [{ ...move, san: moveSan, score: toCentipawns(move.score) }];
  });

  const tiedWithBest = result.tiedWithBest.filter((uci) => rootMoves.some((move) => move.move === uci));

  // Report the score of the move it actually played. The raw search reports the
  // best score it saw anywhere at the root, which can belong to a move it then
  // discarded as illegal.
  const chosen = rootMoves.find((move) => move.move === result.move);

  return {
    ...result,
    san,
    pv,
    rootMoves,
    tiedWithBest,
    score: chosen ? chosen.score : toCentipawns(result.score),
  };
}
