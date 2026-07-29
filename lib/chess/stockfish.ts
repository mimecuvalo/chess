/**
 * A promise-based wrapper around Stockfish's UCI protocol, running in a Web
 * Worker. This is the coach's brain: it has the positional knowledge the 1K bot
 * conspicuously lacks, so it's what grades moves and supplies best lines.
 *
 * Client-only — instantiate it from an effect, never at module scope, or SSR
 * will blow up on `Worker is not defined`.
 */

import { Chess } from 'chess.js';
import type { Analysis, EngineLine, UciMove } from './types';

const ENGINE_URL = '/stockfish/stockfish-18-lite-single.js';

type PendingSearch = {
  fen: string;
  depth: number;
  multipv: number;
  resolve: (analysis: Analysis) => void;
  reject: (error: Error) => void;
  /** Best line seen so far at each multipv slot, keyed by slot number. */
  lines: Map<number, EngineLine>;
};

/** Turns a UCI move and the position it's played in into SAN. */
function uciToSan(chess: Chess, uci: UciMove): string | null {
  const move = chess.move({
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci[4] : undefined,
  });
  return move ? move.san : null;
}

/** Converts a UCI principal variation into SAN, stopping at the first illegal move. */
export function pvToSan(fen: string, pv: UciMove[]): string[] {
  const chess = new Chess(fen);
  const san: string[] = [];
  for (const uci of pv) {
    try {
      const next = uciToSan(chess, uci);
      if (!next) break;
      san.push(next);
    } catch {
      break;
    }
  }
  return san;
}

export class StockfishEngine {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private pending: PendingSearch | null = null;
  /** Serialises searches — UCI is a single-conversation protocol. */
  private queue: Promise<unknown> = Promise.resolve();

  /** Boots the worker and waits for `uciok`/`readyok`. Idempotent. */
  async init(): Promise<void> {
    if (this.ready) return this.ready;

    this.ready = new Promise<void>((resolve, reject) => {
      try {
        this.worker = new Worker(ENGINE_URL);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      const onMessage = (event: MessageEvent) => {
        const line = typeof event.data === 'string' ? event.data : String(event.data);
        if (line.startsWith('readyok')) {
          this.worker?.removeEventListener('message', onMessage);
          this.worker?.addEventListener('message', this.handleLine);
          resolve();
        }
      };

      this.worker.addEventListener('message', onMessage);
      this.worker.addEventListener('error', (event) => reject(new Error(event.message)));
      this.send('uci');
      this.send('isready');
    });

    return this.ready;
  }

  private send(command: string): void {
    this.worker?.postMessage(command);
  }

  private handleLine = (event: MessageEvent) => {
    const line = typeof event.data === 'string' ? event.data : String(event.data);
    const search = this.pending;
    if (!search) return;

    if (line.startsWith('info ') && line.includes(' pv ')) {
      const parsed = this.parseInfo(line, search.fen);
      if (parsed) search.lines.set(parsed.slot, parsed.line);
      return;
    }

    if (line.startsWith('bestmove')) {
      this.pending = null;
      const lines = [...search.lines.entries()].sort((a, b) => a[0] - b[0]).map(([, value]) => value);
      search.resolve({ fen: search.fen, depth: search.depth, lines });
    }
  };

  /** Parses one `info ... pv ...` line into an `EngineLine`. */
  private parseInfo(line: string, fen: string): { slot: number; line: EngineLine } | null {
    const tokens = line.split(' ');
    const valueAfter = (key: string) => {
      const index = tokens.indexOf(key);
      return index === -1 ? null : tokens[index + 1];
    };

    const depth = Number(valueAfter('depth') ?? 0);
    const slot = Number(valueAfter('multipv') ?? 1);

    const scoreIndex = tokens.indexOf('score');
    if (scoreIndex === -1) return null;
    const scoreType = tokens[scoreIndex + 1];
    const scoreValue = Number(tokens[scoreIndex + 2]);

    const pvIndex = tokens.indexOf('pv');
    if (pvIndex === -1) return null;
    const pvUci = tokens.slice(pvIndex + 1).filter((token) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(token));
    if (!pvUci.length) return null;

    const pvSan = pvToSan(fen, pvUci);
    if (!pvSan.length) return null;

    return {
      slot,
      line: {
        move: pvUci[0],
        san: pvSan[0],
        pv: pvSan,
        cp: scoreType === 'cp' ? scoreValue : null,
        mate: scoreType === 'mate' ? scoreValue : null,
        depth,
      },
    };
  }

  /**
   * Analyses a position. Resolves once the engine reports `bestmove`.
   * Calls are serialised, so it's safe to fire these off freely.
   */
  analyse(fen: string, options: { depth?: number; multipv?: number } = {}): Promise<Analysis> {
    const depth = options.depth ?? 16;
    const multipv = options.multipv ?? 3;

    const run = async (): Promise<Analysis> => {
      await this.init();
      return new Promise<Analysis>((resolve, reject) => {
        this.pending = { fen, depth, multipv, resolve, reject, lines: new Map() };
        this.send(`setoption name MultiPV value ${multipv}`);
        this.send(`position fen ${fen}`);
        this.send(`go depth ${depth}`);
      });
    };

    const result = this.queue.then(run, run);
    // Keep the chain alive even if one search rejects.
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** Stops any running search and tears down the worker. */
  dispose(): void {
    if (!this.worker) return;
    this.send('stop');
    this.send('quit');
    this.worker.terminate();
    this.worker = null;
    this.ready = null;
    this.pending = null;
  }
}
