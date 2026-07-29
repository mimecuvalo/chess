/**
 * Pixel-art chess pieces by Lucas312, from OpenGameArt
 * (https://opengameart.org/content/pixel-chess-pieces), licensed CC-BY 3.0 /
 * CC-BY-SA 3.0. The 42×42 PNGs live in `public/pieces/` and are rendered with
 * `image-rendering: pixelated` so they stay crisp at board size.
 *
 * react-chessboard's `pieces` option wants a render function per piece keyed wP…bK.
 */

import type { PieceRenderObject } from 'react-chessboard';

const COLORS = ['w', 'b'] as const;
const LETTERS = ['P', 'R', 'N', 'B', 'Q', 'K'] as const;

const PIECE_NAME: Record<string, string> = {
  P: 'pawn',
  R: 'rook',
  N: 'knight',
  B: 'bishop',
  Q: 'queen',
  K: 'king',
};

/** The `pieces` map react-chessboard expects, keyed wP…bK. */
export const pixelPieces: PieceRenderObject = Object.fromEntries(
  COLORS.flatMap((color) =>
    LETTERS.map((letter) => {
      const key = `${color}${letter}`;
      const alt = `${color === 'w' ? 'white' : 'black'} ${PIECE_NAME[letter]}`;
      const render = () => (
        <img
          src={`/pieces/${key}.png`}
          alt={alt}
          draggable={false}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            imageRendering: 'pixelated',
            // A touch of inset so the sprite doesn't crowd the square's edges.
            padding: '6%',
            boxSizing: 'border-box',
          }}
        />
      );
      return [key, render];
    })
  )
);
