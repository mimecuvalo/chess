/**
 * Copies the Stockfish WASM build into public/ so the browser can load it as a
 * Web Worker.
 *
 * We use the *single-threaded lite* build deliberately. The multithreaded builds
 * need SharedArrayBuffer, which needs COOP/COEP cross-origin isolation headers on
 * every response — a lot of deployment friction for a coach that only ever needs
 * ~depth 16, which the single-threaded build reaches in about a second.
 *
 * The .wasm is ~7MB, so it's gitignored and restored by this script on install.
 *
 * Stockfish is GPL-3.0. We redistribute the compiled engine to every visitor, so
 * its license text ships alongside it — see COPYING.txt in the output directory.
 */

import { copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules', 'stockfish', 'bin');
const to = join(root, 'public', 'stockfish');

const FILES = ['stockfish-18-lite-single.js', 'stockfish-18-lite-single.wasm'];

// GPL-3.0 obliges us to convey the license with the binary. It sits at the
// package root rather than in bin/, so it's copied separately.
const LICENSE = { from: join(root, 'node_modules', 'stockfish', 'Copying.txt'), to: join(to, 'COPYING.txt') };

if (!existsSync(from)) {
  console.warn('[stockfish] package not installed yet; skipping asset copy');
  process.exit(0);
}

await mkdir(to, { recursive: true });
for (const file of FILES) {
  await copyFile(join(from, file), join(to, file));
}

await copyFile(LICENSE.from, LICENSE.to);

console.log(`[stockfish] copied ${FILES.length} files + COPYING.txt to public/stockfish`);
