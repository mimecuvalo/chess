import { formatEval, lineToCp, winProbability } from 'lib/chess/analysis';
import { scoreColor } from 'lib/chess/score';
import type { EngineLine } from 'lib/chess/types';
import styles from './chess.module.css';

/**
 * The classic vertical eval bar. Height is win probability rather than a clamped
 * centipawn score, so the bar moves the way the game actually feels: dramatically
 * around equality, barely at all once someone is winning.
 */
export default function EvalBar({ line, sideToMove }: { line: EngineLine | null; sideToMove: 'w' | 'b' }) {
  const cp = lineToCp(line) * (sideToMove === 'w' ? 1 : -1);
  const whiteShare = line ? winProbability(cp) : 0.5;

  return (
    <div className={styles.evalBar} role="img" aria-label={`Evaluation ${formatEval(line, sideToMove)}`}>
      <div className={styles.evalWhite} style={{ height: `${whiteShare * 100}%` }} />
      <div className={styles.evalNumber} style={{ color: line ? scoreColor(cp / 100) : undefined }}>
        {formatEval(line, sideToMove)}
      </div>
    </div>
  );
}
