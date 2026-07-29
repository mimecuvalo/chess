/**
 * Runs the 1K engine off the main thread. At depth 4 a search is 130ms-1s and at
 * depth 5 it can be tens of seconds, which would visibly freeze the board.
 */

import { think } from './bot';
import type { BotOptions } from './bot';
import type { BotSearchResult } from './types';

export type BotRequest = { id: number; fen: string; options: BotOptions };
export type BotResponse = { id: number; ok: true; result: BotSearchResult } | { id: number; ok: false; error: string };

self.addEventListener('message', (event: MessageEvent<BotRequest>) => {
  const { id, fen, options } = event.data;
  try {
    const result = think(fen, options);
    self.postMessage({ id, ok: true, result } satisfies BotResponse);
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    } satisfies BotResponse);
  }
});
