/**
 * A TypeScript port of Óscar Toledo G.'s 1KB JavaScript chess engine — the one
 * powering VOLE.wtf's "The Kilobyte's Gambit". Original © 2010 Óscar Toledo G.,
 * https://nanochess.org/chess4.html#js1k
 *
 * WHY THIS EXISTS
 * ---------------
 * We could have dropped the minified original in a <script> tag, but the whole
 * point of this trainer is that the bot explains its own reasoning. That needs
 * instrumentation: which root moves it considered, what it scored them, the line
 * it expects, how many nodes it burned. So the search is reproduced here with
 * hooks — but its *behavior* is kept byte-for-byte faithful, because the bot's
 * character (tactically sharp to 4 plies, positionally oblivious) is the feature.
 *
 * A NOTE ON THE VARIABLE NAMES
 * ----------------------------
 * The single-letter names are deliberately preserved. Every expression below is
 * dense bitwise arithmetic where operator precedence carries real meaning, and
 * renaming fifteen variables across it is exactly where a subtle porting bug
 * would hide. Instead: a legend, and comments. The names map 1:1 to the original
 * source, so you can diff this against the minified version line by line.
 *
 *   LEGEND (engine-internal)
 *   I  board, 120 squares (10x12 mailbox)     l  the packed data table
 *   B  "from" square of the move being played b  "to" square
 *   y  en passant square (see note below)     x  10, the row stride
 *   z  15, the piece mask                     W  commit-the-move callback
 *
 *   LEGEND (inside the search function X)
 *   c  side to move (0 or 8; XORed on entry)  h  ply / height
 *   e  en passant square for this node        S  mode/depth (see below)
 *   s  the beta bound handed down             O  origin square being scanned
 *   T  target square                          o  the piece on O
 *   G  piece type minus one (see below)       A  direction count (4 or 8)
 *   C  index into the movement-delta table    R  the piece captured on T
 *   L  score of this move                     N  best score found so far
 *   n  piece to place on T (handles promotion)
 *   g  square whose piece gets displaced (en passant victim / castling rook)
 *   D  ditto, source of that displacement     E  castling / legality flag
 *   d  "am I currently in check?" oracle      K  mate score at this ply
 *   a  pawn direction helper (+/- 10)
 *
 * MODES (the `S` parameter) — one function is the whole engine:
 *   S falsy  "can anyone capture the king?" — the in-check oracle. Generates
 *            moves, returns >1e4 the moment a king capture appears.
 *   S = 1    "find the move matching B->b and actually play it." Used both to
 *            execute the bot's chosen move and to validate a human's move: an
 *            illegal move isn't rejected, it simply isn't found.
 *   S >= 2   the real negamax search, to depth S.
 *
 * PIECE ENCODING
 *   0 = empty, 7 = border sentinel.
 *   Otherwise: type | colorBit | virginBits
 *     type      1 pawn, 2 king, 3 knight, 4 bishop, 5 rook, 6 queen
 *     colorBit  8 = the side starting on the bottom rows (White, in our mapping)
 *     virginBits 48 (16|32) = this piece has never moved. Powers castling rights
 *                and double pawn pushes; stripped via `o & z` on the first move.
 *
 *   `G = o & z ^ c` yields the type for a piece of side `c` (so `G < 7` is the
 *   "is this my piece?" test), and is then decremented, so inside the move loop
 *   G is: 0 pawn, 1 king, 2 knight, 3 bishop, 4 rook, 5 queen.
 *
 * BOARD GEOMETRY
 *   Index = (10 - rank) * 10 + file, with file a=1..h=8. So a1=91, e1=95, h8=28.
 *   Rows 0,1,10,11 and columns 0,9 are border sentinels (7), which is what lets
 *   a knight jump off the edge without escaping the array: the "is this square
 *   a border or an enemy piece?" test collapses into one comparison.
 *
 * EN PASSANT
 *   `y` holds the square of the pawn that just double-pushed — NOT the skipped
 *   square that FEN records. `fenToBoard`/`boardToFen` translate between them.
 */

import type { BotSearchResult, RootMove, UciMove } from './types';

/** The packed data table. Four overlapping tables share these characters. */
const TABLE_SOURCE = 'ustvrtsuqqqqqqqq' + 'yyyyyyyy}{|~z|{}@G@TSb~?A6J57IKJT576,+-48HLSUmgukgg OJNMLK  IDHGFE';

const ROW_STRIDE = 10; // x
const PIECE_MASK = 15; // z
const BORDER = 7;
const VIRGIN = 48;

/** Piece type codes, as stored on the board (before the -1 the search applies). */
export const PAWN = 1;
export const KING = 2;
export const KNIGHT = 3;
export const BISHOP = 4;
export const ROOK = 5;
export const QUEEN = 6;

/** Bit 8 marks the side that starts on the bottom rows — White, in our mapping. */
export const WHITE_BIT = 8;

const TYPE_TO_FEN_CHAR: Record<number, string> = {
  [PAWN]: 'p',
  [KING]: 'k',
  [KNIGHT]: 'n',
  [BISHOP]: 'b',
  [ROOK]: 'r',
  [QUEEN]: 'q',
};

const FEN_CHAR_TO_TYPE: Record<string, number> = {
  p: PAWN,
  k: KING,
  n: KNIGHT,
  b: BISHOP,
  r: ROOK,
  q: QUEEN,
};

/** Board index -> algebraic square, e.g. 95 -> "e1". */
export function indexToSquare(index: number): string {
  const rank = 10 - Math.floor(index / ROW_STRIDE);
  const file = index % ROW_STRIDE;
  return String.fromCharCode(96 + file) + rank;
}

/** Algebraic square -> board index, e.g. "e1" -> 95. */
export function squareToIndex(square: string): number {
  const file = square.charCodeAt(0) - 96;
  const rank = Number(square[1]);
  return (10 - rank) * ROW_STRIDE + file;
}

/** Builds the data table exactly as the original's setup loop does. */
function buildTable(): number[] {
  const l: number[] = [];
  for (let i = 0; i <= 120; i++) {
    l[i] = TABLE_SOURCE.charCodeAt(i) - 64;
  }
  return l;
}

/**
 * A move as the engine sees it: origin and destination board indices. Castling is
 * a two-square king move; promotion is implicit (the 1K engine only ever promotes
 * to a queen).
 */
export type EngineMove = { from: number; to: number };

/** Converts an engine move to UCI, appending `q` for a promotion. */
function toUci(board: number[], from: number, to: number): UciMove {
  const piece = board[from] & PIECE_MASK;
  const isPawn = (piece & 7) === PAWN;
  const destRank = 10 - Math.floor(to / ROW_STRIDE);
  const promoting = isPawn && (destRank === 8 || destRank === 1);
  return indexToSquare(from) + indexToSquare(to) + (promoting ? 'q' : '');
}

/** Deterministic RNG so games and tests are reproducible. */
function makeRng(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    // xorshift32
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

export class Nanochess {
  /** The 10x12 mailbox board. */
  private I: number[] = [];
  private readonly l: number[] = buildTable();

  /** Move being played/searched: B -> b. Globals in the original. */
  private B = 0;
  private b = 0;
  /** Square of the pawn that just double-pushed (0 when there is none). */
  private y = 0;

  private random: () => number;

  // ---- instrumentation (purely additive; never read by the search itself) ----
  private tracking = false;
  private nodes = 0;
  private searchDepth = 0;
  private rootMoves: { from: number; to: number; score: number }[] = [];
  private pvAtPly: EngineMove[][] = [];
  /** Set when the S=1 pass commits a move. */
  private committed: EngineMove | null = null;

  constructor(seed = 1) {
    this.random = makeRng(seed);
    this.reset();
  }

  /** Reseeds the tie-break RNG. Same seed + same moves = same game. */
  setSeed(seed: number): void {
    this.random = makeRng(seed);
  }

  /** Sets up the initial position, exactly as the original's setup loop does. */
  reset(): void {
    const { l } = this;
    const I: number[] = [];
    const x = ROW_STRIDE;
    for (let B = 0, u = 0; B++ < 120;) {
      I[B - 1] = B % x ? ((B / x) % x < 2 || B % x < 2 ? BORDER : (B / x) & 4 ? 0 : l[u++]) : BORDER;
    }
    this.I = I;
    this.B = 0;
    this.b = 0;
    this.y = 0;
  }

  /** The raw board, for tests and debugging. */
  getBoard(): readonly number[] {
    return this.I;
  }

  // -------------------------------------------------------------------------
  // The engine. `X` is the move generator, the legality checker, the search and
  // the move executor, switched on `S`. See the header comment for the modes.
  // -------------------------------------------------------------------------

  private X(c: number, h: number, e: number, S: number, s: number): number {
    const I = this.I;
    const l = this.l;
    const x = ROW_STRIDE;
    const z = PIECE_MASK;

    this.nodes++;
    c ^= 8;

    let T = 0;
    let o = 0;
    let L = 0;
    let E = 0;
    let D = 0;
    let O = 20;
    let G = 0;
    let N = -1e8;
    let n = 0;
    let g = 0;
    let C = 0;
    let R = 0;
    let A = 0;

    // d: "is the side to move currently in check?" — a depth-0 scan by the
    // opponent for a king capture. Only computed when we're actually searching.
    const d = S && this.X(c, 0, 0, 0, 0) > 1e4 ? 1 : 0;

    const K = (78 - h) << 9; // mate score; nearer mates score higher
    const a = c ? x : -x; // pawn direction helper

    const trackingHere = this.tracking && S > 1;

    while (++O < 99) {
      // Scan for a piece of ours on square O.
      if ((o = I[(T = O)]) && (G = (o & z) ^ c) < 7) {
        A = G-- & 2 ? 8 : 4; // 8 directions for king/knight/queen, else 4
        C = (9 - o) & z ? l[61 + G] : 49; // pawn direction lists differ per side

        do {
          R = I[(T += l[C])]; // slide/step to the next target square

          // En passant: a pawn landing behind the pawn that just double-pushed.
          g = D = G | (T + a - e) ? 0 : e;

          if ((!R && (G || A < 3 || g)) || ((((1 + R) & z) ^ c) > 9 && G | (A > 2 ? 1 : 0))) {
            // Captured a king: this position is already won, bail out.
            if (!((2 - R) & 7)) return K;

            // n is the piece that lands on T — a queen if this pawn promotes
            // (detected by the square *behind* the destination being a border).
            // The loop's update expression is the castling machinery: after a
            // legal one-square king step it slides the king a second square and
            // re-runs the body, so castling costs no dedicated code.
            for (
              E = n = G | (I[T - a] - 7) ? o & z : 6 ^ c;
              E;
              E =
                !E && !d && !((g = T), (D = T < O ? g - 3 : g + 2), (I[D] < z ? 1 : 0) | I[D + O - T] | I[(T += T - O)])
                  ? 1
                  : 0
            ) {
              // The entire evaluation function: material, plus a nudge for pawn
              // advancement/promotion. No piece-square tables, no mobility, no
              // king safety, no pawn structure. This is why the bot is a sharp
              // tactician and a hopeless positional player.
              L =
                (R ? l[(R & 7) | 32] * 2 - h - G : 0) +
                (G ? 0 : (n - o) & z ? 110 : (D ? 14 : 0) + (A < 2 ? 1 : 0) + 1);

              if (S > h || ((1 < S ? 1 : 0) & (S === h ? 1 : 0) && (L > 2 ? 1 : 0) | d)) {
                // Make the move.
                I[T] = n;
                I[g] = I[D];
                I[O] = D ? (I[D] = 0) : 0;

                if (trackingHere) this.pvAtPly[h + 1] = [];

                L -= this.X(c, h + 1, (E = G | (A > 1 ? 1 : 0) ? 0 : T), S, L - N);

                // S=1 && h=0: this is the execute pass and we've found B->b.
                if (!(h || (S - 1) | (this.B - O) | (T - this.b) | (L < -1e4 ? 1 : 0))) {
                  this.committed = { from: this.B, to: T };
                  this.B = this.b;
                  this.y = E;
                  return 0;
                }

                if (trackingHere && h === 0) {
                  this.rootMoves.push({ from: O, to: T, score: L });
                }

                // Was that move actually legal? (Only worth checking when it
                // could have left our own king en prise, or for castling.)
                E =
                  (1 - G) | (A < 7 ? 1 : 0) | D | (S ? 0 : 1) | R | (o < z ? 1 : 0) || this.X(c, 0, 0, 0, 0) > 1e4
                    ? 1
                    : 0;

                // Unmake.
                I[O] = o;
                I[T] = R;
                I[D] = I[g];
                if (D) I[g] = G ? 0 : 9 ^ c;
              }

              if (L > N || ((h ? 0 : 1) & (L === N ? 1 : 0) && this.random() < 0.5)) {
                N = L;
                if (trackingHere) {
                  this.pvAtPly[h] = [{ from: O, to: T }, ...(this.pvAtPly[h + 1] ?? [])];
                }
                if (S > 1) {
                  if (h ? s - L < 0 : ((this.B = O), (this.b = T), false)) return N;
                }
              }
            }
          }
        } while (
          (R ? 0 : 1) & (G > 2 ? 1 : 0) ||
          ((T = O), G | (A > 2 ? 1 : 0) | ((z < o ? 1 : 0) & (R ? 0 : 1)) && ++C * --A)
        );
      }
    }

    // No move improved on -1e8: either we're mated (return the mate score) or
    // it's stalemate (not in check -> return 0, a draw).
    return ((-K + 768 < N ? 1 : 0) | d && N) || 0;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Runs the bot's search for the side without the White bit (the top side), then
   * plays the move it chose — mirroring the original's `Y()`.
   */
  think(depth = 4): BotSearchResult {
    const started = Date.now();

    this.tracking = true;
    this.nodes = 0;
    this.searchDepth = depth;
    this.rootMoves = [];
    this.pvAtPly = [];
    this.committed = null;

    this.X(8, 0, this.y, depth, 0);

    const nodes = this.nodes;
    const pvIndices = this.pvAtPly[0] ?? [];
    const chosen: EngineMove = { from: this.B, to: this.b };

    // Snapshot the board so we can render the PV in SAN before it's mutated.
    const boardBefore = [...this.I];
    const pv = pvIndices.map((m) => toUci(boardBefore, m.from, m.to));

    const best = Math.max(...this.rootMoves.map((m) => m.score));
    const rootMoves: RootMove[] = dedupeRootMoves(this.rootMoves)
      .sort((p, q) => q.score - p.score)
      .map((m) => ({
        move: toUci(boardBefore, m.from, m.to),
        san: '', // filled in by the caller, which has a chess.js instance
        score: m.score,
      }));
    const tiedWithBest = dedupeRootMoves(this.rootMoves)
      .filter((m) => m.score === best)
      .map((m) => toUci(boardBefore, m.from, m.to));

    this.tracking = false;

    // Second pass: actually execute the chosen move (the original's `X(8,0,y,1)`).
    const move = toUci(boardBefore, chosen.from, chosen.to);
    this.B = chosen.from;
    this.b = chosen.to;
    this.committed = null;
    this.X(8, 0, this.y, 1, 0);

    if (!this.committed) {
      throw new Error(`nanochess: chose ${move} but could not play it`);
    }

    return {
      move,
      san: '',
      score: best,
      pv,
      rootMoves,
      tiedWithBest,
      nodes,
      depth,
      timeMs: Date.now() - started,
    };
  }

  /**
   * Plays a move for the White-bit side (the human), mirroring the original's
   * `Z()`. Returns false if the engine's own depth-1 search couldn't find it —
   * which is how the 1K engine rejects illegal moves: it simply never finds them.
   */
  playMove(from: number, to: number): boolean {
    this.B = from;
    this.b = to;
    this.committed = null;
    this.X(0, 0, this.y, 1, 0);
    return this.committed !== null;
  }

  /** Convenience wrapper taking algebraic squares. */
  playSquares(from: string, to: string): boolean {
    return this.playMove(squareToIndex(from), squareToIndex(to));
  }

  /**
   * Generates every legal move for `side` (WHITE_BIT or 0) by brute force: try
   * each origin/destination pair through the engine's own S=1 executor on a copy.
   * Slow, but it exercises exactly the code path that validates human moves,
   * which makes it the right oracle for the port-fidelity tests.
   */
  legalMoves(side: number): EngineMove[] {
    const moves: EngineMove[] = [];
    const snapshot = [...this.I];
    const { B, b, y } = this;

    for (let from = 20; from < 99; from++) {
      const piece = snapshot[from];
      if (!piece || piece === BORDER) continue;
      if ((piece & WHITE_BIT) !== side) continue;

      for (let to = 20; to < 99; to++) {
        if (to === from) continue;
        if (snapshot[to] === BORDER) continue;

        this.I = [...snapshot];
        this.y = y;
        const ok = side === WHITE_BIT ? this.playMove(from, to) : this.playAsTopSide(from, to);
        if (ok) moves.push({ from, to });
      }
    }

    this.I = snapshot;
    this.B = B;
    this.b = b;
    this.y = y;
    return moves;
  }

  /** The bot-side equivalent of `playMove` (the original's `Y` execute pass). */
  playAsTopSide(from: number, to: number): boolean {
    this.B = from;
    this.b = to;
    this.committed = null;
    this.X(8, 0, this.y, 1, 0);
    return this.committed !== null;
  }

  // -------------------------------------------------------------------------
  // FEN <-> board
  // -------------------------------------------------------------------------

  /**
   * Loads a FEN. The White-bit side is always the one on ranks 1-2 at the start,
   * so this maps FEN's white/black straight onto the engine's bit-8/no-bit sides.
   */
  loadFen(fen: string): void {
    const [placement, , castling, epTarget] = fen.trim().split(/\s+/);

    const I: number[] = [];
    for (let i = 0; i < 120; i++) {
      const row = Math.floor(i / ROW_STRIDE);
      const col = i % ROW_STRIDE;
      I[i] = row < 2 || row > 9 || col < 1 || col > 8 ? BORDER : 0;
    }

    const ranks = placement.split('/');
    for (let r = 0; r < 8; r++) {
      const rank = 8 - r;
      let file = 1;
      for (const ch of ranks[r]) {
        if (ch >= '1' && ch <= '8') {
          file += Number(ch);
          continue;
        }
        const isWhite = ch === ch.toUpperCase();
        const type = FEN_CHAR_TO_TYPE[ch.toLowerCase()];
        const index = (10 - rank) * ROW_STRIDE + file;

        let code = type | (isWhite ? WHITE_BIT : 0);

        // Virginity only matters for pawn double-pushes and castling, and both
        // are exactly recoverable from a FEN.
        if (type === PAWN && rank === (isWhite ? 2 : 7)) code |= VIRGIN;
        if (type === KING && castling.includes(isWhite ? 'K' : 'k')) code |= VIRGIN;
        if (type === KING && castling.includes(isWhite ? 'Q' : 'q')) code |= VIRGIN;
        if (type === ROOK && file === 8 && castling.includes(isWhite ? 'K' : 'k')) code |= VIRGIN;
        if (type === ROOK && file === 1 && castling.includes(isWhite ? 'Q' : 'q')) code |= VIRGIN;

        I[index] = code;
        file++;
      }
    }

    this.I = I;
    this.B = 0;
    this.b = 0;

    // FEN records the square the pawn skipped over; the engine wants the square
    // the pawn actually landed on.
    if (epTarget && epTarget !== '-') {
      const target = squareToIndex(epTarget);
      const targetRank = Number(epTarget[1]);
      this.y = targetRank === 3 ? target - ROW_STRIDE : target + ROW_STRIDE;
    } else {
      this.y = 0;
    }
  }

  /** Serialises the board back to a FEN. `sideToMove` is 'w' or 'b'. */
  toFen(sideToMove: 'w' | 'b', halfmove = 0, fullmove = 1): string {
    const rows: string[] = [];
    for (let rank = 8; rank >= 1; rank--) {
      let row = '';
      let empty = 0;
      for (let file = 1; file <= 8; file++) {
        const code = this.I[(10 - rank) * ROW_STRIDE + file];
        if (!code) {
          empty++;
          continue;
        }
        if (empty) {
          row += empty;
          empty = 0;
        }
        const char = TYPE_TO_FEN_CHAR[code & 7];
        row += code & WHITE_BIT ? char.toUpperCase() : char;
      }
      if (empty) row += empty;
      rows.push(row);
    }

    let castling = '';
    const virgin = (index: number, type: number, colorBit: number) => {
      const code = this.I[index];
      return code > PIECE_MASK && (code & 7) === type && (code & WHITE_BIT) === colorBit;
    };
    if (virgin(95, KING, WHITE_BIT)) {
      if (virgin(98, ROOK, WHITE_BIT)) castling += 'K';
      if (virgin(91, ROOK, WHITE_BIT)) castling += 'Q';
    }
    if (virgin(25, KING, 0)) {
      if (virgin(28, ROOK, 0)) castling += 'k';
      if (virgin(21, ROOK, 0)) castling += 'q';
    }

    let ep = '-';
    if (this.y) {
      const pawnRank = 10 - Math.floor(this.y / ROW_STRIDE);
      ep = indexToSquare(pawnRank === 4 ? this.y + ROW_STRIDE : this.y - ROW_STRIDE);
    }

    return `${rows.join('/')} ${sideToMove} ${castling || '-'} ${ep} ${halfmove} ${fullmove}`;
  }
}

/** The castling machinery can yield the same (from,to) twice; keep the best. */
function dedupeRootMoves(
  moves: { from: number; to: number; score: number }[]
): { from: number; to: number; score: number }[] {
  const byKey = new Map<number, { from: number; to: number; score: number }>();
  for (const m of moves) {
    const key = m.from * 128 + m.to;
    const existing = byKey.get(key);
    if (!existing || m.score > existing.score) byKey.set(key, m);
  }
  return [...byKey.values()];
}
