MIT License

Copyright (c) 2018-present Mime Čuvalo <mimecuvalo@gmail.com> [@mimecuvalo](https://github.com/mimecuvalo)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

## Third-party components

The MIT license above covers this project's own source. Bundled and derived
third-party works keep their own terms:

### Stockfish — GPL-3.0

`public/stockfish/` contains a compiled build of [Stockfish](https://stockfishchess.org/)
(the `stockfish` npm package), which is licensed under the **GNU General Public
License, version 3**. Because the site serves this engine to every visitor, we
are redistributing it: the full license text ships next to the binary as
`public/stockfish/COPYING.txt`, and source is available at
https://github.com/official-stockfish/Stockfish.

Stockfish runs as a standalone Web Worker and communicates with this application
only over the UCI text protocol; no Stockfish code is linked into or derived from
the source in this repository.

### Toledo 1KB JavaScript chess — attribution only, terms unconfirmed

`lib/chess/nanochess.ts` is an annotated TypeScript port of Óscar Toledo G.'s
1,024-byte JavaScript chess engine ("Tiny Chess", © 2010 Óscar Toledo G.,
https://nanochess.org/chess4.html#js1k), and is therefore a derivative work of it.

The original publishes a copyright notice but **no license or grant of
permission**, so no redistribution terms have been established for the port. It is
included here with attribution pending confirmation from the author. If you fork
or redeploy this project, resolve that first.

### Pixel chess piece artwork — CC-BY 3.0

The PNGs in `public/pieces/` are [Pixel Chess Pieces](https://opengameart.org/content/pixel-chess-pieces)
by **Lucas312**, published on OpenGameArt under CC-BY 3.0 and CC-BY-SA 3.0. This
project relies on the **CC-BY 3.0** option; the sprites are used unmodified.

### Fonts — SIL Open Font License 1.1

[Silkscreen](https://fonts.google.com/specimen/Silkscreen) and
[Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P), vendored via
`@fontsource`, which ships each font's OFL text in its package.
