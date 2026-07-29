import { describe, expect, it } from 'vitest';
import { gradeMove, winProbability, formatEval, describeCost } from 'lib/chess/analysis';
import { describeSan, detectMotifs, hangingPieces, hasBackRankWeakness } from 'lib/chess/motifs';
import { scoreColor, tokenizeProse, score } from 'lib/chess/score';
import { think } from 'lib/chess/bot';
import { RuleBasedExplainer } from 'lib/chess/explain';
import type { Analysis } from 'lib/chess/types';

describe('win probability', () => {
  it('is even at a level evaluation', () => {
    expect(winProbability(0)).toBeCloseTo(0.5);
  });

  it('rises with the evaluation and saturates', () => {
    expect(winProbability(100)).toBeGreaterThan(0.5);
    expect(winProbability(1000)).toBeGreaterThan(0.99);
    expect(winProbability(-1000)).toBeLessThan(0.01);
  });
});

describe('grading', () => {
  it('calls the engine move best regardless of the swing', () => {
    expect(gradeMove(0.5, 0.4, true).grade).toBe('best');
  });

  it('scales with lost win probability rather than centipawns', () => {
    expect(gradeMove(0.5, 0.5, false).grade).toBe('excellent');
    expect(gradeMove(0.5, 0.42, false).grade).toBe('inaccuracy');
    expect(gradeMove(0.5, 0.35, false).grade).toBe('mistake');
    expect(gradeMove(0.5, 0.2, false).grade).toBe('blunder');
  });

  it('never reports a negative loss when a move improves things', () => {
    expect(gradeMove(0.4, 0.6, false).lost).toBe(0);
  });
});

describe('formatting', () => {
  it('shows evaluations from white’s point of view', () => {
    const line = { move: 'e2e4', san: 'e4', pv: ['e4'], cp: 120, mate: null, depth: 10 };
    expect(formatEval(line, 'w')).toBe('+1.2');
    expect(formatEval(line, 'b')).toBe('-1.2');
  });

  it('shows mates as M-scores', () => {
    const line = { move: 'e2e4', san: 'e4', pv: ['e4'], cp: null, mate: 3, depth: 10 };
    expect(formatEval(line, 'w')).toBe('M3');
  });

  it('describes costs in pawns', () => {
    expect(describeCost(20)).toMatch(/fraction/);
    expect(describeCost(300)).toMatch(/3\.0 pawns/);
  });
});

describe('hanging pieces', () => {
  it('spots an undefended attacked piece', () => {
    // White queen on d5 attacked by the knight on f6, with nothing defending it.
    const found = hangingPieces('4k3/8/5n2/3Q4/8/8/8/4K3 w - - 0 1', 'w');
    expect(found.map((piece) => piece.square)).toContain('d5');
    expect(found[0].undefended).toBe(true);
  });

  it('ignores a piece that is properly defended', () => {
    // The knight on e5 is attacked by a pawn but defended by another pawn... and
    // a pawn attacker is cheaper, so it still counts. Use a rook-vs-rook case.
    const found = hangingPieces('4k3/8/8/8/8/8/4R3/4K3 w - - 0 1', 'w');
    expect(found).toEqual([]);
  });

  it('flags a piece defended only by something dearer than the attacker', () => {
    // Black rook on d5 attacked by a white pawn on c4, defended by the king.
    const found = hangingPieces('4k3/8/8/3r4/2P5/8/8/4K3 b - - 0 1', 'b');
    expect(found.map((piece) => piece.square)).toContain('d5');
  });
});

describe('motifs', () => {
  it('detects a knight fork of king and rook', () => {
    // Nc7+ forks the king on e8 and the rook on a8.
    const motifs = detectMotifs('r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1', 'd5c7');
    const fork = motifs.find((motif) => motif.kind === 'fork');
    expect(fork).toBeDefined();
    expect(fork?.phrase).toMatch(/forks/);
  });

  it('detects a pin against the king', () => {
    // Bb5 pins the knight on c6 to the king on e8, along the b5-c6-d7-e8 diagonal.
    const motifs = detectMotifs('4k3/8/2n5/8/8/8/8/4KB2 w - - 0 1', 'f1b5');
    const pin = motifs.find((motif) => motif.kind === 'pin');
    expect(pin?.phrase).toMatch(/pins the knight on c6 to the king/);
  });

  it('does not call a bishop eyeing f7 a pin', () => {
    // Bc4 lines up c4-d5-e6-f7-g8, but "pins the f7 pawn against the knight" is
    // noise no coach would say.
    const motifs = detectMotifs('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', 'f1c4');
    expect(motifs.some((motif) => motif.kind === 'pin')).toBe(false);
  });

  it('still reports a pawn pinned against its own king', () => {
    // Bb5+ pins the c6 pawn to the king on e8... use a rook on the e-file instead:
    // Re1 pins the e5 pawn to the black king on e8.
    const motifs = detectMotifs('4k3/8/8/4p3/8/8/8/4RK2 w - - 0 1', 'e1e2');
    const pin = motifs.find((motif) => motif.kind === 'pin');
    expect(pin?.phrase).toMatch(/pins the pawn on e5 to the king/);
  });

  it('detects checkmate and says nothing else', () => {
    const motifs = detectMotifs('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', 'a1a8');
    expect(motifs).toEqual([{ kind: 'mate', squares: ['a8'], phrase: 'delivers checkmate' }]);
  });

  it('detects a promotion', () => {
    const motifs = detectMotifs('8/1P4k1/8/8/8/8/6K1/8 w - - 0 1', 'b7b8q');
    expect(motifs.some((motif) => motif.kind === 'promotion')).toBe(true);
  });

  it('notices a move that leaves a piece hanging', () => {
    // Qd5 walks the queen onto a square the knight on f6 attacks.
    const motifs = detectMotifs('4k3/8/5n2/8/8/8/8/3QK3 w - - 0 1', 'd1d5');
    expect(motifs.some((motif) => motif.kind === 'hanging')).toBe(true);
  });

  it('does not invent motifs in a quiet position', () => {
    const motifs = detectMotifs('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'e2e4');
    expect(motifs).toEqual([]);
  });
});

describe('back rank', () => {
  it('flags a king boxed in by its own pawns', () => {
    const motif = hasBackRankWeakness('6k1/5ppp/8/8/8/8/8/R5K1 b - - 0 1', 'b');
    expect(motif?.kind).toBe('back-rank');
  });

  it('is quiet when the king has luft', () => {
    const motif = hasBackRankWeakness('6k1/5pp1/7p/8/8/8/8/R5K1 b - - 0 1', 'b');
    expect(motif).toBeNull();
  });
});

describe('describeSan', () => {
  it('names quiet moves', () => {
    expect(describeSan('e4')).toBe('pawn to e4');
    expect(describeSan('Nf3')).toBe('knight to f3');
    expect(describeSan('Qh5')).toBe('queen to h5');
  });

  it('names captures', () => {
    expect(describeSan('Bxc4')).toBe('bishop takes c4');
    expect(describeSan('exd5')).toBe('pawn takes d5');
    expect(describeSan('Kxf7')).toBe('king takes f7');
  });

  it('names castling, promotion, check and mate', () => {
    expect(describeSan('O-O')).toBe('castles kingside');
    expect(describeSan('O-O-O')).toBe('castles queenside');
    expect(describeSan('e8=Q')).toBe('pawn to e8, promoting to queen');
    expect(describeSan('Qh5+')).toBe('queen to h5, check');
    expect(describeSan('Ra8#')).toBe('rook to a8, checkmate');
    expect(describeSan('exd8=Q+')).toBe('pawn takes d8, promoting to queen, check');
  });
});

describe('score colouring', () => {
  it('is amber near even and trends green or red with advantage', () => {
    expect(scoreColor(0)).toBe('rgb(217, 164, 65)');
    // A big edge for the side is greener than a small one.
    const small = scoreColor(1);
    const big = scoreColor(9);
    expect(big).not.toBe(small);
    // Losing side trends toward red (more red channel than green).
    const losing = scoreColor(-9);
    const [r, , b] = losing.match(/\d+/g)!.map(Number);
    expect(r).toBeGreaterThan(b);
  });

  it('wraps and recovers scores through the prose sentinel', () => {
    const line = `the bot scores this ${score(1.5)} here`;
    const tokens = tokenizeProse(line);
    const scoreToken = tokens.find((token) => token.score !== undefined);
    expect(scoreToken?.score).toBe(1.5);
    expect(scoreToken?.text).toBe('+1.5');
    // Plain text around it survives.
    expect(tokens.map((token) => token.text).join('')).toBe('the bot scores this +1.5 here');
  });

  it('does not colour ordinary numbers', () => {
    const tokens = tokenizeProse('across 220,252 positions at depth 4');
    expect(tokens.every((token) => token.score === undefined)).toBe(true);
  });
});

describe('explainer verbosity', () => {
  const explainer = new RuleBasedExplainer();

  // A minimal analysis where the bot's move was a mistake with a known refutation.
  const before: Analysis = {
    fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
    depth: 12,
    lines: [{ move: 'g1f3', san: 'Nf3', pv: ['Nf3', 'Nc6', 'Bb5'], cp: 30, mate: null, depth: 12 }],
  };

  it('spells the bot’s expected line out as a verbose list', async () => {
    const explanation = await explainer.explainBotMove({
      fenBefore: before.fen,
      move: 'd1h5',
      san: 'Qh5',
      before,
      after: {
        fen: before.fen,
        depth: 12,
        lines: [{ move: 'b8c6', san: 'Nc6', pv: ['Nc6'], cp: -20, mate: null, depth: 12 }],
      },
      search: {
        move: 'd1h5',
        san: 'Qh5',
        score: 10,
        pv: ['Qh5', 'Nc6', 'Bc4', 'g6'],
        rootMoves: [{ move: 'd1h5', san: 'Qh5', score: 10 }],
        tiedWithBest: [],
        nodes: 1000,
        depth: 4,
        timeMs: 50,
      },
    });

    const moveLine = explanation.detail.find((item) => typeof item !== 'string' && 'moves' in item);
    expect(moveLine).toBeDefined();
    if (!moveLine || typeof moveLine === 'string' || !('moves' in moveLine)) {
      throw new Error('expected a move line');
    }
    expect(moveLine.lead).toBe('It expects:');
    // Each entry is a spelled-out move, not bare notation.
    expect(moveLine.moves[0]).toBe('queen to h5 (Qh5)');
    expect(moveLine.moves).toContain('knight to c6 (Nc6)');
    // It carries the position after each ply, for hover-to-preview and animation.
    expect(moveLine.fens.length).toBe(moveLine.moves.length);
    expect(moveLine.baseFen).toBe(before.fen);
    // The first ply's FEN really is the position after that move.
    expect(moveLine.fens[0].split(' ')[0]).toContain('Q'); // queen has moved to h5
    expect(moveLine.fens[0]).not.toBe(before.fen);
  });

  it('makes the moves it rejected hoverable inline, with a preview FEN each', async () => {
    const explanation = await explainer.explainBotMove({
      fenBefore: before.fen,
      move: 'd1h5',
      san: 'Qh5',
      before,
      after: {
        fen: before.fen,
        depth: 12,
        lines: [{ move: 'b8c6', san: 'Nc6', pv: ['Nc6'], cp: -20, mate: null, depth: 12 }],
      },
      search: {
        move: 'd1h5',
        san: 'Qh5',
        score: 10,
        pv: ['Qh5'],
        rootMoves: [
          { move: 'd1h5', san: 'Qh5', score: 10 },
          { move: 'g1f3', san: 'Nf3', score: 8 },
          { move: 'd2d4', san: 'd4', score: 6 },
        ],
        tiedWithBest: [],
        nodes: 154300,
        depth: 4,
        timeMs: 50,
      },
    });

    // The "It also looked at …" sentence is a rich line with inline move mentions.
    const rich = explanation.detail.find((item) => typeof item !== 'string' && 'segments' in item);
    if (!rich || typeof rich === 'string' || !('segments' in rich)) throw new Error('expected a rich line');

    const moves = rich.segments.filter((seg) => typeof seg !== 'string');
    expect(moves.length).toBe(2); // two alternatives, both hoverable
    for (const move of moves) {
      if (typeof move === 'string') continue;
      expect(move.fen).toMatch(/ (w|b) /); // a real FEN to preview
      expect(move.label).toMatch(/\(/); // spelled out with notation
    }
    // The plain-text runs still carry the node count and depth.
    const text = rich.segments.filter((seg): seg is string => typeof seg === 'string').join('');
    expect(text).toMatch(/154,300 positions at depth 4/);
  });
});

describe('bot reporting', () => {
  const fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2';

  it('reports scores in centipawns on a normal pawn scale', () => {
    // Black to move and win a queen: Stockfish-comparable units, so roughly +900.
    const result = think('4k3/8/3Q4/8/4n3/8/8/4K3 b - - 0 1', { depth: 3, seed: 1 });
    expect(result.move).toBe('e4d6');
    expect(result.score).toBeGreaterThan(700);
    expect(result.score).toBeLessThan(1100);
  });

  it('only reports alternatives it was actually allowed to play', () => {
    // Black is in check; every "alternative" that ignores it must be filtered out.
    const inCheck = 'rnbqkbnr/pppp1Qpp/8/4p3/4P3/8/PPPP1PPP/RNB1KBNR b KQkq - 0 3';
    const result = think(inCheck, { depth: 3, seed: 1 });
    expect(result.rootMoves.length).toBeGreaterThan(0);
    for (const move of result.rootMoves) {
      expect(move.san).not.toMatch(/^[a-h][1-8][a-h][1-8]$/); // no raw UCI leaked
    }
    expect(result.rootMoves.map((move) => move.move)).toContain('e8f7');
  });

  it('produces a principal variation that can actually be played', () => {
    const result = think(fen, { depth: 4, seed: 42 });
    expect(result.pv[0]).toBe(result.san);
    expect(result.pv.length).toBeGreaterThan(1);
    // SAN, not UCI — proof each ply was replayed successfully.
    for (const move of result.pv) {
      expect(move).not.toMatch(/^[a-h][1-8][a-h][1-8]$/);
    }
  });
});
