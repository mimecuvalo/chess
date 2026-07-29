/**
 * Tactical pattern detection.
 *
 * Engine numbers alone don't teach anyone anything: "-1.4" is a verdict, not an
 * explanation. These detectors turn a position and a move into the vocabulary a
 * coach actually uses — forks, pins, hanging pieces, back-rank weaknesses — so the
 * prose layer can say *why* a move works instead of just quoting an evaluation.
 *
 * All of it runs on chess.js, which is our single source of truth for legality.
 */

import { Chess } from 'chess.js';
import type { Color, PieceSymbol, Square } from 'chess.js';
import type { Motif, UciMove } from './types';

const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

const NAME: Record<PieceSymbol, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

/** Human name for a piece on a square, e.g. "knight on f6". */
export function describePiece(piece: PieceSymbol, square: Square): string {
  return `${NAME[piece]} on ${square}`;
}

export function pieceName(piece: PieceSymbol): string {
  return NAME[piece];
}

const SAN_PIECE: Record<string, string> = {
  K: 'king',
  Q: 'queen',
  R: 'rook',
  B: 'bishop',
  N: 'knight',
  P: 'pawn',
};

/**
 * Rewrites SAN into plain English so the notation is easy to map onto the board:
 * "Nf3" -> "knight to f3", "Bxc4" -> "bishop takes c4", "exd5" -> "pawn takes d5",
 * "O-O" -> "castles kingside", "e8=Q" -> "pawn to e8, promoting to queen",
 * "Qh7#" -> "queen to h7, checkmate".
 */
export function describeSan(san: string): string {
  const check = san.endsWith('#') ? ', checkmate' : san.endsWith('+') ? ', check' : '';
  let core = san.replace(/[+#]$/, '');

  if (core === 'O-O' || core === '0-0') return `castles kingside${check}`;
  if (core === 'O-O-O' || core === '0-0-0') return `castles queenside${check}`;

  let promotion = '';
  const promo = core.match(/=([QRBN])$/);
  if (promo) {
    promotion = `, promoting to ${SAN_PIECE[promo[1]]}`;
    core = core.replace(/=([QRBN])$/, '');
  }

  const captures = core.includes('x');
  const dest = core.match(/([a-h][1-8])$/)?.[1] ?? core;
  const pieceLetter = /^[KQRBN]/.test(core) ? core[0] : 'P';
  const verb = captures ? 'takes' : 'to';

  return `${SAN_PIECE[pieceLetter]} ${verb} ${dest}${promotion}${check}`;
}

/** Same, with the first letter capitalised — for the start of a sentence. */
export function describeSanCapitalized(san: string): string {
  const described = describeSan(san);
  return described.charAt(0).toUpperCase() + described.slice(1);
}

const FILES = 'abcdefgh';

function toSquare(file: number, rank: number): Square | null {
  if (file < 0 || file > 7 || rank < 1 || rank > 8) return null;
  return `${FILES[file]}${rank}` as Square;
}

function fileOf(square: Square): number {
  return FILES.indexOf(square[0]);
}

function rankOf(square: Square): number {
  return Number(square[1]);
}

const ROOK_DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const BISHOP_DIRS = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

function slidingDirs(piece: PieceSymbol): number[][] {
  if (piece === 'r') return ROOK_DIRS;
  if (piece === 'b') return BISHOP_DIRS;
  if (piece === 'q') return [...ROOK_DIRS, ...BISHOP_DIRS];
  return [];
}

function opposite(color: Color): Color {
  return color === 'w' ? 'b' : 'w';
}

/** A piece that is attacked and not adequately defended. */
export type HangingPiece = {
  square: Square;
  piece: PieceSymbol;
  value: number;
  /** True when it's simply undefended; false when it's defended but by too little. */
  undefended: boolean;
};

/**
 * Finds pieces of `color` that the opponent can profitably take: either
 * undefended while attacked, or defended but attacked by something cheaper.
 */
export function hangingPieces(fen: string, color: Color): HangingPiece[] {
  const chess = new Chess(fen);
  const found: HangingPiece[] = [];

  for (const row of chess.board()) {
    for (const cell of row) {
      if (!cell || cell.color !== color || cell.type === 'k') continue;

      const attackers = chess.attackers(cell.square, opposite(color));
      if (!attackers.length) continue;

      const defenders = chess.attackers(cell.square, color);
      const value = VALUE[cell.type];

      if (!defenders.length) {
        found.push({ square: cell.square, piece: cell.type, value, undefended: true });
        continue;
      }

      // Defended, but is the cheapest attacker worth less than the target?
      const cheapestAttacker = Math.min(...attackers.map((square) => VALUE[chess.get(square)?.type ?? 'p']));
      if (cheapestAttacker < value) {
        found.push({ square: cell.square, piece: cell.type, value, undefended: false });
      }
    }
  }

  return found.sort((a, b) => b.value - a.value);
}

/** Squares of `color`'s pieces that the piece on `from` attacks. */
function attackedEnemies(chess: Chess, from: Square, enemy: Color): Square[] {
  const targets: Square[] = [];
  for (const row of chess.board()) {
    for (const cell of row) {
      if (!cell || cell.color !== enemy) continue;
      if (chess.attackers(cell.square, opposite(enemy)).includes(from)) {
        targets.push(cell.square);
      }
    }
  }
  return targets;
}

/**
 * Looks along a slider's rays from `from` for a pin or skewer: two enemy pieces
 * in a line with nothing between them. Pin = cheaper piece shielding a dearer one
 * (or the king); skewer = the other way round.
 */
function findPinsAndSkewers(chess: Chess, from: Square, mover: Color): Motif[] {
  const piece = chess.get(from);
  if (!piece) return [];

  const motifs: Motif[] = [];
  const enemy = opposite(mover);

  for (const [df, dr] of slidingDirs(piece.type)) {
    let file = fileOf(from) + df;
    let rank = rankOf(from) + dr;
    const seen: { square: Square; type: PieceSymbol; color: Color }[] = [];

    while (true) {
      const square = toSquare(file, rank);
      if (!square) break;

      const occupant = chess.get(square);
      if (occupant) {
        if (occupant.color === mover) break; // our own piece blocks the ray
        seen.push({ square, type: occupant.type, color: occupant.color });
        if (seen.length === 2) break;
      }

      file += df;
      rank += dr;
    }

    if (seen.length !== 2) continue;
    const [front, back] = seen;
    if (front.color !== enemy || back.color !== enemy) continue;

    // A pawn shielding a piece is technically a pin and never worth saying: every
    // bishop aimed at f7 would "pin the pawn against the knight on g8". Only call
    // it a pin when the pawn is shielding the king, which genuinely matters.
    if (front.type === 'p' && back.type !== 'k') continue;

    if (back.type === 'k' || VALUE[back.type] > VALUE[front.type]) {
      motifs.push({
        kind: 'pin',
        squares: [from, front.square, back.square],
        phrase:
          back.type === 'k'
            ? `pins the ${NAME[front.type]} on ${front.square} to the king`
            : `pins the ${NAME[front.type]} on ${front.square} against the ${NAME[back.type]} on ${back.square}`,
      });
    } else if (VALUE[front.type] > VALUE[back.type]) {
      motifs.push({
        kind: 'skewer',
        squares: [from, front.square, back.square],
        phrase: `skewers the ${NAME[front.type]} on ${front.square}, winning the ${NAME[back.type]} behind it`,
      });
    }
  }

  return motifs;
}

/**
 * Is `color`'s king stuck on its back rank behind its own pawns? This is the
 * precondition for back-rank mates, and worth flagging before one shows up.
 */
export function hasBackRankWeakness(fen: string, color: Color): Motif | null {
  const chess = new Chess(fen);
  const backRank = color === 'w' ? 1 : 8;
  const forward = color === 'w' ? 1 : -1;

  let kingSquare: Square | null = null;
  for (const row of chess.board()) {
    for (const cell of row) {
      if (cell?.type === 'k' && cell.color === color) kingSquare = cell.square;
    }
  }
  if (!kingSquare || rankOf(kingSquare) !== backRank) return null;

  const escapes: Square[] = [];
  for (const df of [-1, 0, 1]) {
    const square = toSquare(fileOf(kingSquare) + df, backRank + forward);
    if (square) escapes.push(square);
  }
  if (!escapes.length) return null;

  const blocked = escapes.every((square) => {
    const occupant = chess.get(square);
    return occupant?.color === color && occupant.type === 'p';
  });
  if (!blocked) return null;

  return {
    kind: 'back-rank',
    squares: [kingSquare, ...escapes],
    phrase: `the king on ${kingSquare} has no luft — every escape square is blocked by its own pawns`,
  };
}

/**
 * Describes what a move does tactically. `fenBefore` is the position the move is
 * played in; the move is UCI.
 */
export function detectMotifs(fenBefore: string, uci: UciMove): Motif[] {
  const chess = new Chess(fenBefore);

  const move = chess.move({
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci[4] : undefined,
  });
  if (!move) return [];

  const motifs: Motif[] = [];
  const to = move.to as Square;
  const mover = move.color;
  const enemy = opposite(mover);

  if (chess.isCheckmate()) {
    motifs.push({ kind: 'mate', squares: [to], phrase: 'delivers checkmate' });
    return motifs;
  }

  if (move.promotion) {
    motifs.push({
      kind: 'promotion',
      squares: [to],
      phrase: `promotes to a ${NAME[move.promotion]}`,
    });
  }

  // Fork: the piece that just landed attacks two or more things worth having.
  const attacked = attackedEnemies(chess, to, enemy);
  const worthwhile = attacked.filter((square) => {
    const occupant = chess.get(square);
    if (!occupant) return false;
    if (occupant.type === 'k') return true;
    // A target counts if it's undefended, or worth more than the attacker.
    const defended = chess.attackers(square, enemy).length > 0;
    return !defended || VALUE[occupant.type] > VALUE[move.piece];
  });

  if (worthwhile.length >= 2) {
    const names = worthwhile.map((square) => NAME[chess.get(square)!.type]);
    motifs.push({
      kind: 'fork',
      squares: [to, ...worthwhile],
      phrase: `forks the ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`,
    });
  }

  motifs.push(...findPinsAndSkewers(chess, to, mover));

  // Anything left hanging by this move?
  for (const hanging of hangingPieces(chess.fen(), mover)) {
    motifs.push({
      kind: 'hanging',
      squares: [hanging.square],
      phrase: hanging.undefended
        ? `leaves the ${describePiece(hanging.piece, hanging.square)} undefended`
        : `leaves the ${describePiece(hanging.piece, hanging.square)} attacked by something cheaper`,
    });
  }

  const backRank = hasBackRankWeakness(chess.fen(), mover);
  if (backRank) motifs.push(backRank);

  return motifs;
}
