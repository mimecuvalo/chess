<h1 align="center">♟️ Chess trainer</h1>

<p align="center">A self-aware 1KB bot, with a Stockfish coach looking over its shoulder.</p>

## What this is

You play White against a TypeScript port of [Óscar Toledo G.'s 1,024-byte JavaScript
chess engine](https://nanochess.org/chess4.html#js1k) — the one behind VOLE.wtf's
[The Kilobyte's Gambit](https://vole.wtf/kilobytes-gambit/). Stockfish runs
alongside as an impartial coach, grading every move either of you makes.

The interesting part is the gap between the two engines.

The 1K engine's entire evaluation function is **material plus a small bonus for
pawn advancement**. No piece-square tables, no mobility, no king safety, no pawn
structure, no opening book. That gives it a split personality: a genuinely sharp
tactician inside four plies, and a hopeless positional player everywhere else
(roughly 1100–1300 over the board).

So the bot doesn't just move — it tells you what it was thinking, using its real
search data, and then Stockfish says where that thinking went wrong:

> **Kxf7 — the bot scores this 8.4.**
> It expects: Kxf7 Bc4+ Ke7 Bxg8.
> It also looked at e6 (8.4) and d5 (0.7), across 220,252 positions at depth 4.
> Stockfish rates this 5.7, well below the bot's own 8.4. With no king safety or
> mobility terms, it can't see positional trouble coming — only material it has
> already counted.

Its blind spots become the teaching material.

## Running it

```bash
bun install     # also copies the Stockfish WASM build into public/
bun run dev     # http://localhost:3000
```

Stockfish's `.wasm` is ~7MB and gitignored; `scripts/copy-stockfish.mjs` restores
it on install. First page load takes a few seconds while it boots.

```bash
bun run test        # vitest
bun run type-check
bun run lint
```

## How it fits together

```
routes/index.tsx              → components/pages/Trainer.tsx

components/chess/
  useTrainer.ts     the orchestration: chess.js holds the truth, the bot moves,
                    Stockfish grades. Analyses are cached by FEN, so a full move
                    costs two engine searches rather than four.
  EvalBar.tsx       eval bar, sized by win probability rather than centipawns
  CoachPanel.tsx    verdict on your move, or the current hint
  BotThoughts.tsx   the bot's confessional
  MoveList.tsx      the score, with a grade glyph per move

lib/chess/
  nanochess.ts      the port + instrumentation  ← the interesting file
  bot.ts            adapter: FEN in, verified SAN reasoning out
  bot.worker.ts     keeps depth-4/5 searches off the main thread
  stockfish.ts      promise-based UCI wrapper
  analysis.ts       win probability and move grading
  motifs.ts         forks, pins, skewers, hanging pieces, back-rank
  explain.ts        CoachExplainer interface + the rule-based implementation
```

### Decisions worth knowing

**chess.js is the only rules authority.** The ported engine is a brain, never a
referee. That's what stops a subtle porting bug from ever becoming an illegal
move on the board.

**The port keeps the original's single-letter names.** Every expression in that
search is dense bitwise arithmetic where operator precedence carries meaning;
renaming fifteen variables across it is precisely where a porting bug would hide.
There's a legend and heavy commentary at the top of `nanochess.ts` instead, and it
diffs line-by-line against the minified original.

**Port fidelity is verified against chess.js**, not by perft: ~200 random
positions plus fixtures for castling, en passant, promotion and pins, asserting
the engine's generated moves match chess.js exactly.

**Grading uses win probability, not centipawns.** Dropping 100cp from equality is
a disaster; dropping it while up a queen is noise. Centipawn deltas treat those
the same, which is why engine-flavoured trainers scold you for nothing.

**The bot's reported reasoning is checked before it's shown.** Its principal
variation is replayed through chess.js and truncated at the first move that isn't
legal, and root moves it wasn't actually allowed to play are filtered out. The 1K
search reuses its bookkeeping aggressively — a coach that misreports its own
reasoning would be worse than one that says nothing.

**Scores are converted to centipawns.** The engine's own capture table is
`pawn 7, knight 20, bishop 19, rook 34, queen 62`, doubled when scoring, so a pawn
is 14. Dividing by 14 recovers the usual 1/3/3/5/9 scale and makes the comparison
against Stockfish meaningful.

**Single-threaded Stockfish.** The multithreaded build needs `SharedArrayBuffer`
and therefore COOP/COEP headers on every response. Depth 14 single-threaded takes
about a second, which is plenty for coaching.

## Ideas not yet built

- Review mode: walk a finished game with an eval graph, jumping to each mistake.
- Let the bot play White (needs a vertical board flip — the engine's geometry
  fixes the bit-8 side to the bottom rows).
- Estimate the bot's Elo via self-play at depths 2/3/4 and show it in the UI.
- `explain-claude.ts`: swap the rule-based prose for LLM-authored coaching. The
  `CoachExplainer` interface is already async so it drops in without UI changes.

## Credits

Chess engine © 2010 Óscar Toledo G., [nanochess.org](https://nanochess.org/) —
`lib/chess/nanochess.ts` is a derivative port, and the original states no license;
see [license.md](license.md). Inspired by
[The Kilobyte's Gambit](https://vole.wtf/kilobytes-gambit/) by VOLE.wtf.
Scaffolded from [all-the-things](https://github.com/mimecuvalo/all-the-things).

Coaching engine: [Stockfish](https://stockfishchess.org/), **GPL-3.0** — served
to the browser from `public/stockfish/`, with its license text alongside it as
`COPYING.txt`.

Piece artwork: [Pixel Chess Pieces](https://opengameart.org/content/pixel-chess-pieces)
by **Lucas312** (OpenGameArt), used under CC-BY 3.0. The PNGs live in
`public/pieces/`. Fonts: [Silkscreen](https://fonts.google.com/specimen/Silkscreen)
and [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P) (SIL Open
Font License).

## 📜 License

[MIT](license.md) for this project's own source. Bundled third-party works keep
their own terms — notably **Stockfish (GPL-3.0)** and the **unlicensed** upstream
of the 1KB engine. See [Third-party components](license.md#third-party-components).
