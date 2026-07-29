import type { ReactNode } from 'react';
import { scoreColor, tokenizeProse } from 'lib/chess/score';
import type { DetailItem, InlineMove, MoveLine, RichLine } from 'lib/chess/types';
import styles from './chess.module.css';

/**
 * Board-preview handlers, threaded down from the trainer. Hovering a move ghosts
 * that position on the board; the animate button steps through the whole line.
 */
export type PreviewHandlers = {
  show: (fen: string) => void;
  end: () => void;
  animate: (line: MoveLine) => void;
};

/**
 * Renders a run of text, colouring any embedded score on a red → amber → green
 * heat scale. The explainer wraps scores in sentinels (see `lib/chess/score.ts`);
 * everything else renders as plain text.
 */
function renderScored(text: string): ReactNode[] {
  return tokenizeProse(text).map((token, index) =>
    token.score === undefined ? (
      <span key={index}>{token.text}</span>
    ) : (
      <strong key={index} style={{ color: scoreColor(token.score) }}>
        {token.text}
      </strong>
    )
  );
}

/** A paragraph of prose with score colouring. */
export default function Prose({ text, className }: { text: string; className?: string }) {
  return <p className={className}>{renderScored(text)}</p>;
}

function isRichLine(item: DetailItem): item is RichLine {
  return typeof item !== 'string' && 'segments' in item;
}

function isMoveLine(item: DetailItem): item is MoveLine {
  return typeof item !== 'string' && 'moves' in item;
}

/** A hoverable move mention inside a sentence. */
function InlineMoveChip({ move, preview }: { move: InlineMove; preview?: PreviewHandlers }) {
  if (!preview) return <span>{renderScored(move.label)}</span>;
  return (
    <button
      type="button"
      className={styles.moveInline}
      onMouseEnter={() => preview.show(move.fen)}
      onMouseLeave={() => preview.end()}
      onFocus={() => preview.show(move.fen)}
      onBlur={() => preview.end()}
      title="Hover to preview on the board"
    >
      {renderScored(move.label)}
    </button>
  );
}

/** A sentence whose move mentions are hoverable preview targets. */
function RichLineView({ line, preview }: { line: RichLine; preview?: PreviewHandlers }) {
  return (
    <p className={styles.detail}>
      {line.segments.map((segment, index) =>
        typeof segment === 'string' ? (
          <span key={index}>{renderScored(segment)}</span>
        ) : (
          <InlineMoveChip key={index} move={segment} preview={preview} />
        )
      )}
    </p>
  );
}

/** A spelled-out move sequence: hoverable items plus a ▶ button to animate it. */
function MoveLineView({ line, preview }: { line: MoveLine; preview?: PreviewHandlers }) {
  return (
    <div className={styles.moveLine} onMouseLeave={() => preview?.end()}>
      <div className={styles.moveLineHead}>
        <Prose className={styles.moveLineLead} text={line.lead} />
        {preview && line.fens.length > 1 ? (
          <button
            type="button"
            className={styles.ghostPlay}
            onClick={() => preview.animate(line)}
            aria-label="Animate this line on the board"
            title="Animate this line"
          >
            ▶
          </button>
        ) : null}
      </div>
      <ol className={styles.moveLineList}>
        {line.moves.map((move, index) => (
          <li key={index}>
            <button
              type="button"
              className={styles.moveChip}
              onMouseEnter={() => preview?.show(line.fens[index])}
              onFocus={() => preview?.show(line.fens[index])}
              onBlur={() => preview?.end()}
              title="Hover to preview on the board"
            >
              {renderScored(move)}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Renders one block of explanation detail: a plain sentence, a sentence with
 * hoverable move mentions, or a spelled-out (and animatable) move sequence.
 */
export function DetailBlock({ item, preview }: { item: DetailItem; preview?: PreviewHandlers }) {
  if (typeof item === 'string') return <Prose className={styles.detail} text={item} />;
  if (isMoveLine(item)) return <MoveLineView line={item} preview={preview} />;
  if (isRichLine(item)) return <RichLineView line={item} preview={preview} />;
  return null;
}
