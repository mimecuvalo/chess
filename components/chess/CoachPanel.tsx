import { F } from 'i18n';
import type { Explanation } from 'lib/chess/types';
import Prose, { DetailBlock, type PreviewHandlers } from './Prose';
import styles from './chess.module.css';

/** Stockfish's verdict on your last move, in words. */
export default function CoachPanel({
  coach,
  hint,
  grading,
  preview,
}: {
  coach: Explanation | null;
  hint: Explanation | null;
  grading: boolean;
  preview: PreviewHandlers;
}) {
  const shown = hint ?? coach;

  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>{hint ? <F defaultMessage="Hint" /> : <F defaultMessage="Coach" />}</h2>

      {grading && !hint ? (
        <p className={styles.muted}>
          <F defaultMessage="Checking that move…" />
        </p>
      ) : shown ? (
        <>
          <Prose className={styles.headline} text={shown.headline} />
          {shown.detail.map((item, index) => (
            <DetailBlock key={index} item={item} preview={preview} />
          ))}
        </>
      ) : (
        <p className={styles.muted}>
          <F defaultMessage="Make a move and I'll tell you what I think of it." />
        </p>
      )}
    </section>
  );
}
