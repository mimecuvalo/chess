import { Fragment } from 'react';
import { F } from 'i18n';
import { GRADE_GLYPH } from 'lib/chess/analysis';
import { describeSan } from 'lib/chess/motifs';
import type { MoveGrade } from 'lib/chess/types';
import type { PreviewHandlers } from './Prose';
import type { HistoryEntry } from './useTrainer';
import styles from './chess.module.css';

const GRADE_CLASS: Record<MoveGrade, string> = {
  best: styles.gradeBest,
  excellent: styles.gradeExcellent,
  good: '',
  inaccuracy: styles.gradeInaccuracy,
  mistake: styles.gradeMistake,
  blunder: styles.gradeBlunder,
};

/**
 * One played move. Hovering it ghosts the position it produced onto the board,
 * the same treatment the coaching prose gets; the verbose name is its tooltip.
 *
 * Note there's no per-chip `onMouseLeave`: the preview is ended once at the grid
 * level (below), so sliding the pointer between chips — across the column gaps —
 * just switches which position shows instead of flickering back to the live board.
 */
function Move({ entry, preview }: { entry: HistoryEntry | undefined; preview: PreviewHandlers }) {
  if (!entry) return <span />;
  const grade = entry.grade ? (
    <span className={`${styles.grade} ${GRADE_CLASS[entry.grade]}`}>{GRADE_GLYPH[entry.grade]}</span>
  ) : null;

  return (
    <button
      type="button"
      className={styles.moveChip}
      onMouseEnter={() => preview.show(entry.fenAfter)}
      onFocus={() => preview.show(entry.fenAfter)}
      onBlur={() => preview.end()}
      title={`${describeSan(entry.san)} — hover to preview on the board`}
    >
      {entry.san}
      {grade}
    </button>
  );
}

/** The game score, with a grade glyph on every move once Stockfish has judged it. */
export default function MoveList({ history, preview }: { history: HistoryEntry[]; preview: PreviewHandlers }) {
  const pairs: HistoryEntry[][] = [];
  for (let i = 0; i < history.length; i += 2) {
    pairs.push(history.slice(i, i + 2));
  }

  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>
        <F defaultMessage="Moves" />
      </h2>
      {pairs.length ? (
        <div className={styles.moves} onMouseLeave={() => preview.end()}>
          {pairs.map((pair, index) => (
            <Fragment key={pair[0].fenAfter}>
              <span className={styles.moveNumber}>{index + 1}.</span>
              <Move entry={pair[0]} preview={preview} />
              <Move entry={pair[1]} preview={preview} />
            </Fragment>
          ))}
        </div>
      ) : (
        <p className={styles.muted}>
          <F defaultMessage="No moves yet." />
        </p>
      )}
    </section>
  );
}
