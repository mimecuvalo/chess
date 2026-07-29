import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chessboard } from 'react-chessboard';
import { F } from 'i18n';
import BotThoughts from 'components/chess/BotThoughts';
import CoachPanel from 'components/chess/CoachPanel';
import EvalBar from 'components/chess/EvalBar';
import MoveList from 'components/chess/MoveList';
import { pixelPieces } from 'components/chess/PixelPieces';
import type { PreviewHandlers } from 'components/chess/Prose';
import { useTrainer } from 'components/chess/useTrainer';
import type { MoveLine } from 'lib/chess/types';
import styles from 'components/chess/chess.module.css';

/** How long each ply lingers when animating a whole line, in ms. */
const ANIMATE_STEP_MS = 850;

// A warm retro palette to match the pixel pieces and Silkscreen type.
const LIGHT_SQUARE = '#e8c9a0';
const DARK_SQUARE = '#a9743f';

// The board's rank/file coordinates, in the pixel font.
const NOTATION_STYLE: React.CSSProperties = {
  fontFamily: "'Silkscreen', 'Courier New', monospace",
  fontSize: '0.6rem',
  fontWeight: 700,
};

/**
 * You play White against Toledo's 1KB engine; Stockfish watches over both your
 * shoulders. The bot narrates its own search, the coach grades the result.
 */
export default function Trainer() {
  const trainer = useTrainer();
  const {
    fen,
    turn,
    thinking,
    grading,
    engineReady,
    engineError,
    coach,
    hint,
    botThoughts,
    history,
    evaluation,
    isGameOver,
    result,
    botDepth,
    playMove,
    legalTargets,
    requestHint,
    newGame,
    setBotDepth,
  } = trainer;

  // Click-to-move, alongside dragging: click a piece, then click a destination.
  const [selected, setSelected] = useState<string | null>(null);

  // Board preview: hovering a move in the coaching prose ghosts that position;
  // the ▶ button animates a whole line ply by ply. Preview is display-only — it
  // never touches the real game, and reverts the moment the pointer leaves.
  const [previewFen, setPreviewFen] = useState<string | null>(null);
  const [previewLabel, setPreviewLabel] = useState<string | null>(null);
  const animTimers = useRef<number[]>([]);

  const clearAnimation = useCallback(() => {
    animTimers.current.forEach((id) => window.clearTimeout(id));
    animTimers.current = [];
  }, []);

  const endPreview = useCallback(() => {
    clearAnimation();
    setPreviewFen(null);
    setPreviewLabel(null);
  }, [clearAnimation]);

  const showPreview = useCallback(
    (fen: string) => {
      clearAnimation();
      setPreviewFen(fen);
      setPreviewLabel(null);
    },
    [clearAnimation]
  );

  const animateLine = useCallback(
    (line: MoveLine) => {
      clearAnimation();
      // Start from the position the line branches off, then reveal each ply on a
      // timer so the board slides through the sequence one move at a time.
      setPreviewFen(line.baseFen);
      line.fens.forEach((plyFen, index) => {
        const id = window.setTimeout(
          () => {
            setPreviewFen(plyFen);
            setPreviewLabel(line.moves[index]);
          },
          ANIMATE_STEP_MS * (index + 1)
        );
        animTimers.current.push(id);
      });
    },
    [clearAnimation]
  );

  const preview: PreviewHandlers = useMemo(
    () => ({ show: showPreview, end: endPreview, animate: animateLine }),
    [showPreview, endPreview, animateLine]
  );

  // Any change to the real game (your move, the bot's reply, a new game) drops
  // whatever preview was on screen so it can't get out of sync.
  useEffect(() => endPreview(), [fen, endPreview]);
  useEffect(() => clearAnimation, [clearAnimation]);

  const previewing = previewFen !== null;

  const onSquareClick = useCallback(
    ({ square }: { square: string | null }) => {
      if (!square || thinking || isGameOver || turn !== 'w') return;

      if (selected) {
        if (square === selected) {
          setSelected(null);
          return;
        }
        if (playMove(selected, square)) {
          setSelected(null);
          return;
        }
      }
      setSelected(legalTargets(square).length ? square : null);
    },
    [selected, thinking, isGameOver, turn, playMove, legalTargets]
  );

  const onPieceDrop = useCallback(
    ({ sourceSquare, targetSquare }: { sourceSquare: string; targetSquare: string | null }) => {
      setSelected(null);
      return targetSquare ? playMove(sourceSquare, targetSquare) : false;
    },
    [playMove]
  );

  // Highlight the selected piece and every square it can legally reach.
  const squareStyles = useMemo(() => {
    if (!selected) return {};
    const styles_: Record<string, React.CSSProperties> = {
      [selected]: { boxShadow: 'inset 0 0 0 4px rgba(122, 90, 245, 0.75)' },
    };
    for (const target of legalTargets(selected)) {
      styles_[target] = {
        background: 'radial-gradient(circle, rgba(122, 90, 245, 0.45) 22%, transparent 24%)',
      };
    }
    return styles_;
  }, [selected, legalTargets]);

  // Arrows come from whichever explanation is on screen: green for the move you
  // should have played, red for the refutation, purple for the bot's own choice.
  const arrows = useMemo(() => {
    const source = hint ?? coach ?? botThoughts?.explanation;
    return (source?.highlight ?? [])
      .filter((arrow) => arrow.from !== arrow.to)
      .map((arrow) => ({
        startSquare: arrow.from,
        endSquare: arrow.to,
        color: arrow.color ?? '#3d9970',
      }));
  }, [coach, hint, botThoughts]);

  const boardOptions = useMemo(
    () => ({
      id: 'trainer-board',
      // While previewing, show the hypothetical position instead of the game.
      position: previewFen ?? fen,
      boardOrientation: 'white' as const,
      // No moving pieces during a preview — it isn't the real position.
      allowDragging: !previewing && !thinking && !isGameOver && turn === 'w',
      // The coach's own arrows would clash with a preview, so hide them then.
      arrows: previewing ? [] : arrows,
      squareStyles: previewing ? {} : squareStyles,
      pieces: pixelPieces,
      darkSquareStyle: { backgroundColor: DARK_SQUARE },
      lightSquareStyle: { backgroundColor: LIGHT_SQUARE },
      // The rank/file labels get the pixel font too.
      alphaNotationStyle: NOTATION_STYLE,
      numericNotationStyle: NOTATION_STYLE,
      // A short slide so previewed moves read as motion without a floaty glide.
      animationDurationInMs: 220,
      onPieceDrop,
      onSquareClick,
      // The drag sensor sits on the piece, so a click that lands on a piece never
      // reaches the square underneath. Wire both to the same handler.
      onPieceClick: onSquareClick,
    }),
    [previewFen, previewing, fen, thinking, isGameOver, turn, arrows, squareStyles, onPieceDrop, onSquareClick]
  );

  return (
    <>
      <header className={styles.header}>
        <h1 className={styles.title}>
          <F defaultMessage="Chess trainer" />
        </h1>
        <p className={styles.subtitle}>
          <F defaultMessage="You're playing 1,024 bytes of JavaScript. It explains itself; Stockfish keeps it honest." />
        </p>
      </header>

      <main className={styles.layout}>
        <div className={styles.boardColumn}>
          <EvalBar line={evaluation} sideToMove={turn} />
          <div className={`${styles.board} ${previewing ? styles.boardPreview : ''}`}>
            <Chessboard options={boardOptions} />
            {previewing ? (
              <div className={styles.previewBadge}>
                <F defaultMessage="Preview" />
                {previewLabel ? <span className={styles.previewMove}>{previewLabel}</span> : null}
              </div>
            ) : null}
          </div>
        </div>

        <div>
          <div className={styles.controls}>
            <button className={styles.button} onClick={newGame} type="button">
              <F defaultMessage="New game" />
            </button>
            <button
              className={styles.button}
              onClick={requestHint}
              disabled={!engineReady || thinking || isGameOver || turn !== 'w'}
              type="button"
            >
              <F defaultMessage="Hint" />
            </button>
            <select
              className={styles.select}
              value={botDepth}
              onChange={(event) => setBotDepth(Number(event.target.value))}
              aria-label="Bot search depth"
            >
              <option value={2}>Depth 2 — beatable</option>
              <option value={3}>Depth 3 — quick</option>
              <option value={4}>Depth 4 — stock</option>
              <option value={5}>Depth 5 — slow &amp; mean</option>
            </select>

            <span className={styles.status}>
              {engineError ? (
                <span className={styles.error}>{engineError}</span>
              ) : !engineReady ? (
                <F defaultMessage="Loading Stockfish…" />
              ) : thinking ? (
                <F defaultMessage="Bot is thinking…" />
              ) : null}
            </span>
          </div>

          {result ? <p className={styles.result}>{result}</p> : null}

          <CoachPanel coach={coach} hint={hint} grading={grading} preview={preview} />
          <BotThoughts thoughts={botThoughts} thinking={thinking} preview={preview} />
          <MoveList history={history} preview={preview} />
        </div>
      </main>
    </>
  );
}
