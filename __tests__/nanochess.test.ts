import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { Nanochess, WHITE_BIT, indexToSquare, squareToIndex } from 'lib/chess/nanochess';

/** The engine's move list for a side, as a sorted set of "e2e4" strings. */
function engineMoves(engine: Nanochess, side: number): string[] {
  return engine
    .legalMoves(side)
    .map(({ from, to }) => indexToSquare(from) + indexToSquare(to))
    .sort();
}

/** chess.js's move list, reduced to the same from/to form (promotions collapsed). */
function referenceMoves(chess: Chess): string[] {
  return [...new Set(chess.moves({ verbose: true }).map((m) => m.from + m.to))].sort();
}

describe('square mapping', () => {
  it('maps the corners and centre the way the mailbox expects', () => {
    expect(squareToIndex('a1')).toBe(91);
    expect(squareToIndex('h1')).toBe(98);
    expect(squareToIndex('a8')).toBe(21);
    expect(squareToIndex('h8')).toBe(28);
    expect(squareToIndex('e1')).toBe(95);
    expect(squareToIndex('e4')).toBe(65);
  });

  it('round-trips every square', () => {
    for (const file of 'abcdefgh') {
      for (let rank = 1; rank <= 8; rank++) {
        const square = `${file}${rank}`;
        expect(indexToSquare(squareToIndex(square))).toBe(square);
      }
    }
  });
});

describe('board setup', () => {
  it('produces the standard starting position', () => {
    const engine = new Nanochess();
    expect(engine.toFen('w')).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  });

  it('round-trips a FEN through load and serialise', () => {
    const fens = [
      'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
      '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
      'rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3',
    ];
    for (const fen of fens) {
      const engine = new Nanochess();
      engine.loadFen(fen);
      const [placement, side, castling, ep] = fen.split(' ');
      const round = engine.toFen(side as 'w' | 'b').split(' ');
      expect(round[0]).toBe(placement);
      expect(round[2]).toBe(castling);
      expect(round[3]).toBe(ep);
    }
  });
});

describe('move generation matches chess.js', () => {
  const positions: { name: string; fen: string }[] = [
    { name: 'start', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' },
    {
      name: 'italian game',
      fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
    },
    { name: 'both sides can castle', fen: 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1' },
    { name: 'castling blocked by check', fen: 'r3k2r/pppppppp/8/8/8/4q3/PPPP1PPP/R3K2R w KQkq - 0 1' },
    { name: 'en passant available', fen: 'rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3' },
    { name: 'promotion race', fen: '8/1P4k1/8/8/8/8/6K1/8 w - - 0 1' },
    { name: 'king must step off the back rank', fen: '6k1/8/8/8/8/8/4R3/4K2r w - - 0 1' },
    { name: 'pinned rook cannot abandon the file', fen: '4k3/8/8/8/4r3/8/4R3/4K3 w - - 0 1' },
    { name: 'in check, must respond', fen: 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3' },
    { name: 'endgame', fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1' },
  ];

  for (const { name, fen } of positions) {
    it(`generates the same white moves: ${name}`, () => {
      const engine = new Nanochess();
      engine.loadFen(fen);
      const chess = new Chess(fen);
      expect(engineMoves(engine, WHITE_BIT)).toEqual(referenceMoves(chess));
    });
  }

  it('agrees with chess.js across a few hundred random positions', { timeout: 60_000 }, () => {
    const chess = new Chess();
    let checked = 0;
    let rng = 12345;
    const next = (max: number) => {
      rng = (rng * 1103515245 + 12345) & 0x7fffffff;
      return rng % max;
    };

    for (let game = 0; game < 20; game++) {
      chess.reset();
      for (let ply = 0; ply < 40; ply++) {
        if (chess.isGameOver()) break;

        // Only check white-to-move positions; the engine's two sides are
        // symmetric and this keeps the test fast.
        if (chess.turn() === 'w') {
          const engine = new Nanochess();
          engine.loadFen(chess.fen());
          expect(engineMoves(engine, WHITE_BIT), `position: ${chess.fen()}`).toEqual(referenceMoves(chess));
          checked++;
        }

        const moves = chess.moves();
        chess.move(moves[next(moves.length)]);
      }
    }

    expect(checked).toBeGreaterThan(100);
  });
});

describe('search', () => {
  it('finds mate in one', () => {
    // Black to move (the bot is the top side): Ra1 is back-rank mate, since the
    // white king's only escapes are f1/h1, both covered by the rook.
    const engine = new Nanochess();
    engine.loadFen('r5k1/5ppp/8/8/8/8/5PPP/6K1 b - - 0 1');
    const result = engine.think(3);
    expect(result.move).toBe('a8a1');
  });

  it('grabs a free queen', () => {
    // The knight on e4 can take the undefended queen on d6.
    const engine = new Nanochess();
    engine.loadFen('4k3/8/3Q4/8/4n3/8/8/4K3 b - - 0 1');
    const result = engine.think(3);
    expect(result.move).toBe('e4d6');
  });

  it('reports the reasoning we need to narrate', () => {
    const engine = new Nanochess();
    const result = engine.think(4);

    expect(result.nodes).toBeGreaterThan(1000);
    expect(result.depth).toBe(4);
    expect(result.rootMoves.length).toBe(20); // 20 legal opening moves
    expect(result.pv[0]).toBe(result.move);
    expect(result.rootMoves[0].score).toBeGreaterThanOrEqual(result.rootMoves[1].score);
  });

  it('is deterministic for a given seed', () => {
    const play = () => {
      const engine = new Nanochess(99);
      const moves: string[] = [];
      for (let i = 0; i < 3; i++) {
        moves.push(engine.think(3).move);
        const legal = engine.legalMoves(WHITE_BIT);
        engine.playMove(legal[0].from, legal[0].to);
      }
      return moves;
    };
    expect(play()).toEqual(play());
  });
});

describe('playing moves', () => {
  it('accepts legal moves and rejects illegal ones', () => {
    const engine = new Nanochess();
    expect(engine.playSquares('e2', 'e4')).toBe(true);
    expect(engine.playSquares('e1', 'e3')).toBe(false); // king can't teleport
  });

  it('castles kingside', () => {
    const engine = new Nanochess();
    engine.loadFen('r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1');
    expect(engine.playSquares('e1', 'g1')).toBe(true);
    expect(engine.toFen('b').split(' ')[0]).toBe('r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R4RK1');
  });

  it('castles queenside', () => {
    const engine = new Nanochess();
    engine.loadFen('r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1');
    expect(engine.playSquares('e1', 'c1')).toBe(true);
    expect(engine.toFen('b').split(' ')[0]).toBe('r3k2r/pppppppp/8/8/8/8/PPPPPPPP/2KR3R');
  });

  it('captures en passant', () => {
    const engine = new Nanochess();
    engine.loadFen('rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3');
    expect(engine.playSquares('e5', 'f6')).toBe(true);
    expect(engine.toFen('b').split(' ')[0]).toBe('rnbqkbnr/ppp1p1pp/5P2/3p4/8/8/PPPP1PPP/RNBQKBNR');
  });

  it('promotes to a queen', () => {
    const engine = new Nanochess();
    engine.loadFen('8/1P4k1/8/8/8/8/6K1/8 w - - 0 1');
    expect(engine.playSquares('b7', 'b8')).toBe(true);
    expect(engine.toFen('b').split(' ')[0]).toBe('1Q6/6k1/8/8/8/8/6K1/8');
  });
});
