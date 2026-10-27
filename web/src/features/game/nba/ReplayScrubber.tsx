/**
 * The court's replay control (BasketballReplay.swift `ReplayScrubber`):
 * play/pause, a track over game time with quarter ticks, then the score
 * where the thumb is. Drag or click anywhere on it to hold the replay there;
 * at the end (or past "now" in a live game) it's the whole game again.
 * Pointing reads out the time and score in the chart's footer. A slider for
 * assistive tech and the keyboard (←/→ a minute; it takes no keys the page uses).
 *
 * While a replay runs the thumb and the score move without a render: the
 * court hands each frame to `handle.show(t, score)`, which writes a CSS
 * variable and a text node.
 */
import { memo, useCallback, useLayoutEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { Icon } from "../../../design/components";
import { clockLabelAt, periodStart } from "../../../data/basketball";
import styles from "./Court.module.css";

export interface ScrubberHandle {
  show: (t: number | null, score: string) => void;
}

export interface ReplayScrubberProps {
  /** The track's span: regulation, plus any overtime. */
  readonly length: number;
  /** How far the replay reaches: the end of a final, now in a live game. */
  readonly end: number;
  readonly live: boolean;
  /** The replay's game second (null: not replaying; the thumb rests at `end`). */
  readonly time: number | null;
  readonly playing: boolean;
  /** "LAL 78–71" at the thumb. */
  readonly score: string;
  readonly periods: number;
  readonly quarter: number;
  readonly onSeek: (t: number) => void;
  readonly onPlayPause: () => void;
  /** The game second under the pointer, for the footer readout. */
  readonly onHover: (t: number | null) => void;
  readonly handle: React.RefObject<ScrubberHandle | null>;
}

export const ReplayScrubber = memo(function ReplayScrubber({ length, end, live, time, playing, score, periods, quarter, onSeek, onPlayPause, onHover, handle }: ReplayScrubberProps) {
  const track = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const dragging = useRef(false);
  const fraction = (t: number) => Math.min(Math.max(t / Math.max(length, 1), 0), 1);
  const thumb = time ?? end;

  // The frame path: a CSS variable for the thumb and the fill, a text node for the score.
  handle.current = {
    show: (t, text) => {
      const el = track.current;
      if (el) {
        el.style.setProperty("--thumb", String(fraction(t ?? end)));
        el.dataset.replaying = String(t != null);
      }
      if (label.current && label.current.textContent !== text) label.current.textContent = text;
    },
  };

  // The score is written here (and by the frame path), never by React's children, so the two never disagree.
  useLayoutEffect(() => {
    if (label.current) label.current.textContent = score;
  }, [score]);

  const at = useCallback(
    (clientX: number) => {
      const el = track.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const px = Math.min(Math.max(clientX - rect.left, 0), rect.width);
      // Within a few points of the end is the end: the whole game, or live.
      const endPx = rect.width * fraction(end);
      return px >= endPx - 3 ? end : (px / Math.max(rect.width, 1)) * length;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [end, length],
  );

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    const t = at(e.clientX);
    if (t != null) onSeek(t);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const t = at(e.clientX);
    if (dragging.current) {
      if (t != null) onSeek(t);
    } else if (e.pointerType === "mouse" && t != null) onHover(Math.max(0, Math.min(t, end)));
  };
  const onPointerUp = () => {
    dragging.current = false;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const from = time ?? end;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") onSeek(Math.min(from + 60, end));
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") onSeek(Math.max(from - 60, 0));
    else if (e.key === "Home") onSeek(0);
    else if (e.key === "End") onSeek(end);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const ticks = Array.from({ length: Math.max(periods - 1, 0) }, (_, i) => fraction(periodStart(i + 2, quarter)));
  const value = time != null ? `${clockLabelAt(time, quarter)}, ${score}` : live ? `Live, ${score}` : `Whole game, ${score}`;
  return (
    <div className={styles.scrubber}>
      <button type="button" className={styles.playButton} onClick={onPlayPause} title={playing ? "Pause the replay" : time == null ? "Replay the game" : "Resume the replay"} aria-label={playing ? "Pause replay" : time == null ? "Replay the game" : "Resume replay"}>
        <Icon name={playing ? "pause" : "playFill"} size={9.5} />
      </button>
      <div
        ref={track}
        className={styles.track}
        style={{ "--thumb": fraction(thumb), "--end": fraction(end) } as React.CSSProperties}
        data-live={live}
        data-replaying={time != null}
        role="slider"
        tabIndex={0}
        aria-label="Replay"
        aria-valuemin={0}
        aria-valuemax={Math.round(end)}
        aria-valuenow={Math.round(thumb)}
        aria-valuetext={value}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => onHover(null)}
        onKeyDown={onKeyDown}
      >
        <span className={styles.rail} />
        <span className={styles.played} />
        <span className={styles.fill} />
        {ticks.map((x) => (
          <span key={x} className={styles.tick} style={{ "--x": x } as React.CSSProperties} />
        ))}
        {live ? <span className={styles.now} /> : null}
        <span className={styles.thumb} />
      </div>
      <span ref={label} className={styles.scrubScore} data-replaying={time != null} aria-hidden="true" />
    </div>
  );
});
