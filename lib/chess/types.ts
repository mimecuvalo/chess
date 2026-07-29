/** Shared types for the chess trainer's two engines and the coaching layer. */

/** A move in UCI/long-algebraic form, e.g. `e2e4`, `e7e8q`. */
export type UciMove = string;

/** One root move the 1K bot considered, with the score its own search gave it. */
export type RootMove = {
  move: UciMove;
  san: string;
  /** Centipawn-ish score in the bot's own (material-only) units. */
  score: number;
};

/**
 * Everything the 1K bot knows about the move it just chose. This is what lets it
 * narrate its reasoning honestly rather than us inventing a rationale for it.
 */
export type BotSearchResult = {
  move: UciMove;
  san: string;
  /** Score of the chosen move, in the bot's own units, from the bot's perspective. */
  score: number;
  /** The line the bot expects to follow, in SAN. */
  pv: string[];
  /** Every root move it looked at, best first. */
  rootMoves: RootMove[];
  /** Moves that tied with the best score — it coin-flipped among these. */
  tiedWithBest: UciMove[];
  /** Positions visited. Grows explosively with depth; good narration material. */
  nodes: number;
  depth: number;
  /** Milliseconds spent searching. */
  timeMs: number;
};

/** One line of Stockfish analysis (one entry of a MultiPV result). */
export type EngineLine = {
  move: UciMove;
  san: string;
  /** Principal variation in SAN, starting with `san`. */
  pv: string[];
  /** Score in centipawns from the side-to-move's perspective. Null when `mate` is set. */
  cp: number | null;
  /** Mate in N (positive = side to move mates). Null when it's a normal eval. */
  mate: number | null;
  depth: number;
};

/** A full Stockfish evaluation of one position. */
export type Analysis = {
  fen: string;
  depth: number;
  /** Best line first. Length is the requested MultiPV (or fewer near the end of a game). */
  lines: EngineLine[];
};

/** How good a played move was, relative to the best available. */
export type MoveGrade = 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

/** Tactical patterns we detect to explain *why*, rather than just quoting a number. */
export type MotifKind =
  | 'hanging'
  | 'fork'
  | 'pin'
  | 'skewer'
  | 'discovered-attack'
  | 'back-rank'
  | 'mate'
  | 'promotion'
  | 'trapped';

export type Motif = {
  kind: MotifKind;
  /** Squares involved, for board highlighting. */
  squares: string[];
  /** Short human phrase, e.g. "forks the king and rook". */
  phrase: string;
};

/** A graded move plus everything needed to explain it. */
export type MoveAssessment = {
  /** The move that was actually played, in SAN. */
  san: string;
  move: UciMove;
  grade: MoveGrade;
  /** Win probability (0-1) before and after, from the mover's perspective. */
  winProbBefore: number;
  winProbAfter: number;
  /** How much win probability the move gave away (0 when it was best). */
  lost: number;
  /** Stockfish's preferred move in this position. */
  best: EngineLine | null;
  /** The opponent's refutation — the first move of the PV after the played move. */
  refutation: EngineLine | null;
  motifs: Motif[];
};

/**
 * A move sequence, rendered as a bulleted list of verbose descriptions rather
 * than a cramped run of notation like "e4 e6 d4 d5". It also carries the position
 * before the line and after each ply, so the UI can ghost a single move on hover
 * or animate the whole line on the board.
 */
export type MoveLine = {
  /** Introductory phrase, e.g. "The idea:" or "It expects:". */
  lead: string;
  /** Each move spelled out, e.g. "knight to f3 (Nf3)". */
  moves: string[];
  /** The position the line starts from. */
  baseFen: string;
  /** FEN after each ply — `fens[i]` is the board once `moves[0..i]` are played. */
  fens: string[];
};

/**
 * A move mentioned inside a sentence, made hoverable so it can ghost its position
 * on the board just like a list item.
 */
export type InlineMove = {
  /** Display text, e.g. "pawn to a5 (a5, «+0.1»)" — may embed a score sentinel. */
  label: string;
  /** The board once this move is played, for the hover preview. */
  fen: string;
};

/**
 * A sentence built from plain-text runs and hoverable move mentions, e.g.
 * ["It also looked at ", {move}, " and ", {move}, ", across 154,300 positions…"].
 */
export type RichLine = { segments: (string | InlineMove)[] };

/** One block of supporting detail: a sentence, a rich sentence, or a move sequence. */
export type DetailItem = string | RichLine | MoveLine;

/** Prose produced by a `CoachExplainer`. */
export type Explanation = {
  /** One-line summary, e.g. "Nxe5 is a blunder — it drops a piece." */
  headline: string;
  /** Supporting sentences and move sequences, in reading order. */
  detail: DetailItem[];
  /** Squares/arrows to draw on the board. */
  highlight: { from: string; to: string; color?: string }[];
};
