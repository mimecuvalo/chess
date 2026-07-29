import { F } from 'i18n';
import type { BotSearchResult, Explanation } from 'lib/chess/types';
import Prose, { DetailBlock, type PreviewHandlers } from './Prose';
import styles from './chess.module.css';

/**
 * The bot's confessional.
 *
 * Everything here comes out of the 1K engine's own search — the score it gave the
 * move, the line it expects, what it rejected, how many positions it visited —
 * rather than being reconstructed after the fact. When its material-only verdict
 * and Stockfish's disagree, the explainer says so, which is the most useful thing
 * on the page: you get to watch a 1,024-byte evaluation function fail in slow
 * motion and learn what a real one would have noticed.
 */
export default function BotThoughts({
  thoughts,
  thinking,
  preview,
}: {
  thoughts: { search: BotSearchResult; explanation: Explanation } | null;
  thinking: boolean;
  preview: PreviewHandlers;
}) {
  return (
    <section className={`${styles.panel} ${styles.botPanel}`}>
      <h2 className={styles.panelTitle}>
        <F defaultMessage="What the bot was thinking" />
      </h2>

      {thinking ? (
        <p className={styles.muted}>
          <F defaultMessage="Searching…" />
        </p>
      ) : thoughts ? (
        <>
          <Prose className={styles.headline} text={thoughts.explanation.headline} />
          {thoughts.explanation.detail.map((item, index) => (
            <DetailBlock key={index} item={item} preview={preview} />
          ))}
          <div className={styles.stats}>
            <span>{thoughts.search.nodes.toLocaleString()} positions</span>
            <span>depth {thoughts.search.depth}</span>
            <span>{thoughts.search.timeMs} ms</span>
          </div>
          <p className={styles.scale}>
            <F defaultMessage="Scores are in pawns: 0.0 is even, ± shows who's ahead, and a forced mate reads as M#. No fixed max — past roughly ±10 the game is decided." />
          </p>
        </>
      ) : (
        <p className={styles.muted}>
          <F defaultMessage="The bot hasn't moved yet." />
        </p>
      )}
    </section>
  );
}
