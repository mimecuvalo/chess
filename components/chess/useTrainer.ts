/**
 * Orchestrates a game: chess.js holds the truth, the 1K bot plays the moves, and
 * Stockfish grades everything either of you does.
 *
 * Analyses are cached by FEN, which matters more than it looks: the position
 * after your move is also the position before the bot's, so a full move costs two
 * new Stockfish searches rather than four.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { BOT_COLOR } from 'lib/chess/bot';
import { RuleBasedExplainer } from 'lib/chess/explain';
import { StockfishEngine } from 'lib/chess/stockfish';
import { assessMove } from 'lib/chess/explain';
import type { BotRequest, BotResponse } from 'lib/chess/bot.worker';
import type { Analysis, BotSearchResult, EngineLine, Explanation, MoveGrade } from 'lib/chess/types';

/** Deep enough to grade honestly, shallow enough to stay responsive. */
const ANALYSIS_DEPTH = 14;
const MULTI_PV = 3;

export type HistoryEntry = {
  ply: number;
  san: string;
  uci: string;
  color: 'w' | 'b';
  fenBefore: string;
  fenAfter: string;
  grade?: MoveGrade;
};

export type TrainerState = {
  fen: string;
  history: HistoryEntry[];
  /** Stockfish's view of the current position. */
  evaluation: EngineLine | null;
  turn: 'w' | 'b';
  isGameOver: boolean;
  result: string | null;
  /** True while the 1K bot is searching. */
  thinking: boolean;
  /** True while Stockfish is grading the last move. */
  grading: boolean;
  engineReady: boolean;
  engineError: string | null;
  coach: Explanation | null;
  botThoughts: { search: BotSearchResult; explanation: Explanation } | null;
  hint: Explanation | null;
  hintLevel: number;
  botDepth: number;
};

export function useTrainer() {
  const chessRef = useRef<Chess>(null as unknown as Chess);
  if (chessRef.current === null) chessRef.current = new Chess();

  const stockfishRef = useRef<StockfishEngine | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const cacheRef = useRef(new Map<string, Analysis>());
  const explainerRef = useRef(new RuleBasedExplainer());
  const requestIdRef = useRef(0);

  const [state, setState] = useState<TrainerState>(() => ({
    fen: chessRef.current.fen(),
    history: [],
    evaluation: null,
    turn: 'w',
    isGameOver: false,
    result: null,
    thinking: false,
    grading: false,
    engineReady: false,
    engineError: null,
    coach: null,
    botThoughts: null,
    hint: null,
    hintLevel: 0,
    botDepth: 4,
  }));

  // Callbacks below need the freshest state without being rebuilt on every render.
  const stateRef = useRef(state);
  stateRef.current = state;

  const patch = useCallback((next: Partial<TrainerState>) => {
    setState((current) => ({ ...current, ...next }));
  }, []);

  // Boot both engines. Client-only: workers don't exist during SSR.
  useEffect(() => {
    const stockfish = new StockfishEngine();
    stockfishRef.current = stockfish;

    const worker = new Worker(new URL('../../lib/chess/bot.worker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;

    stockfish
      .init()
      .then(() => patch({ engineReady: true }))
      .catch((error: Error) => patch({ engineError: error.message }));

    return () => {
      stockfish.dispose();
      worker.terminate();
      stockfishRef.current = null;
      workerRef.current = null;
    };
  }, [patch]);

  const analyse = useCallback(async (fen: string): Promise<Analysis | null> => {
    const cached = cacheRef.current.get(fen);
    if (cached) return cached;

    const stockfish = stockfishRef.current;
    if (!stockfish) return null;

    const analysis = await stockfish.analyse(fen, { depth: ANALYSIS_DEPTH, multipv: MULTI_PV });
    cacheRef.current.set(fen, analysis);
    return analysis;
  }, []);

  /** Asks the 1K engine for a move, off the main thread. */
  const askBot = useCallback((fen: string, depth: number): Promise<BotSearchResult> => {
    const worker = workerRef.current;
    if (!worker) return Promise.reject(new Error('bot worker is not running'));

    const id = ++requestIdRef.current;
    return new Promise((resolve, reject) => {
      const onMessage = (event: MessageEvent<BotResponse>) => {
        if (event.data.id !== id) return;
        worker.removeEventListener('message', onMessage);
        if (event.data.ok) resolve(event.data.result);
        else reject(new Error(event.data.error));
      };
      worker.addEventListener('message', onMessage);
      worker.postMessage({ id, fen, options: { depth } } satisfies BotRequest);
    });
  }, []);

  const describeResult = useCallback((chess: Chess): string | null => {
    if (!chess.isGameOver()) return null;
    if (chess.isCheckmate()) return chess.turn() === 'w' ? 'Black wins by checkmate' : 'You win by checkmate';
    if (chess.isStalemate()) return 'Draw by stalemate';
    if (chess.isThreefoldRepetition()) return 'Draw by repetition';
    if (chess.isInsufficientMaterial()) return 'Draw — insufficient material';
    return 'Draw';
  }, []);

  /** The bot's turn: search, play, then grade and narrate what it did. */
  const playBotMove = useCallback(
    async (depth: number) => {
      const chess = chessRef.current;
      const fenBefore = chess.fen();

      patch({ thinking: true });

      let search: BotSearchResult;
      try {
        search = await askBot(fenBefore, depth);
      } catch (error) {
        patch({ thinking: false, engineError: (error as Error).message });
        return;
      }

      const move = chess.move({
        from: search.move.slice(0, 2),
        to: search.move.slice(2, 4),
        promotion: search.move.length > 4 ? search.move[4] : undefined,
      });
      if (!move) {
        patch({ thinking: false, engineError: `bot played an illegal move: ${search.move}` });
        return;
      }

      const fenAfter = chess.fen();
      setState((current) => ({
        ...current,
        thinking: false,
        fen: fenAfter,
        turn: chess.turn(),
        isGameOver: chess.isGameOver(),
        result: describeResult(chess),
        hint: null,
        hintLevel: 0,
        history: [
          ...current.history,
          {
            ply: current.history.length + 1,
            san: move.san,
            uci: search.move,
            color: 'b',
            fenBefore,
            fenAfter,
          },
        ],
      }));

      const [before, after] = await Promise.all([analyse(fenBefore), analyse(fenAfter)]);
      if (!before || !after) return;

      const explanation = await explainerRef.current.explainBotMove({
        fenBefore,
        move: search.move,
        san: move.san,
        before,
        after,
        search,
      });

      const assessment = assessMove({ fenBefore, move: search.move, san: move.san, before, after });

      setState((current) => ({
        ...current,
        botThoughts: { search, explanation },
        evaluation: after.lines[0] ?? null,
        history: current.history.map((entry) =>
          entry.fenAfter === fenAfter ? { ...entry, grade: assessment.grade } : entry
        ),
      }));
    },
    [analyse, askBot, describeResult, patch]
  );

  /** Your turn. Returns false when the move isn't legal, so the board snaps back. */
  const playMove = useCallback(
    (from: string, to: string): boolean => {
      const chess = chessRef.current;
      if (chess.isGameOver() || chess.turn() === BOT_COLOR) return false;

      const fenBefore = chess.fen();
      let move;
      try {
        // The 1K engine only ever promotes to a queen, so we match it.
        move = chess.move({ from, to, promotion: 'q' });
      } catch {
        return false;
      }
      if (!move) return false;

      const fenAfter = chess.fen();
      const uci = from + to + (move.promotion ?? '');

      setState((current) => ({
        ...current,
        fen: fenAfter,
        turn: chess.turn(),
        isGameOver: chess.isGameOver(),
        result: describeResult(chess),
        coach: null,
        hint: null,
        hintLevel: 0,
        grading: true,
        history: [
          ...current.history,
          {
            ply: current.history.length + 1,
            san: move.san,
            uci,
            color: 'w',
            fenBefore,
            fenAfter,
          },
        ],
      }));

      void (async () => {
        const [before, after] = await Promise.all([analyse(fenBefore), analyse(fenAfter)]);
        if (!before || !after) {
          patch({ grading: false });
          return;
        }

        const assessment = assessMove({ fenBefore, move: uci, san: move.san, before, after });
        const explanation = await explainerRef.current.explainYourMove({
          fenBefore,
          move: uci,
          san: move.san,
          before,
          after,
        });

        setState((current) => ({
          ...current,
          grading: false,
          coach: explanation,
          evaluation: after.lines[0] ?? null,
          history: current.history.map((entry) =>
            entry.fenAfter === fenAfter ? { ...entry, grade: assessment.grade } : entry
          ),
        }));

        if (!chessRef.current.isGameOver()) {
          await playBotMove(stateRef.current.botDepth);
        }
      })();

      return true;
    },
    [analyse, describeResult, patch, playBotMove]
  );

  /** Reveals progressively more of Stockfish's suggestion. */
  const requestHint = useCallback(async () => {
    const chess = chessRef.current;
    if (chess.isGameOver() || chess.turn() === BOT_COLOR) return;

    const level = Math.min(2, stateRef.current.hintLevel) as 0 | 1 | 2;
    const analysis = await analyse(chess.fen());
    if (!analysis) return;

    const hint = await explainerRef.current.hint(chess.fen(), analysis, level);
    setState((current) => ({ ...current, hint, hintLevel: Math.min(3, current.hintLevel + 1) }));
  }, [analyse]);

  const newGame = useCallback(() => {
    chessRef.current = new Chess();
    setState((current) => ({
      ...current,
      fen: chessRef.current.fen(),
      history: [],
      evaluation: null,
      turn: 'w',
      isGameOver: false,
      result: null,
      coach: null,
      botThoughts: null,
      hint: null,
      hintLevel: 0,
      grading: false,
      thinking: false,
    }));
  }, []);

  const setBotDepth = useCallback((botDepth: number) => patch({ botDepth }), [patch]);

  /** Destination squares for a piece, so the board can show where it may go. */
  const legalTargets = useCallback((from: string): string[] => {
    const chess = chessRef.current;
    if (chess.isGameOver() || chess.turn() === BOT_COLOR) return [];
    const piece = chess.get(from as never);
    if (!piece || piece.color !== 'w') return [];
    return chess.moves({ square: from as never, verbose: true }).map((move) => move.to);
  }, []);

  return { ...state, playMove, legalTargets, requestHint, newGame, setBotDepth };
}
