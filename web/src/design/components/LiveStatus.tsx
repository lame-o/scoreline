/**
 * LiveStatus: the pulsing dot and the live clock, in red (SharedUI.swift
 * `LiveStatus`). A running clock ticks every second between polls, on the
 * second with every other clock; a stopped one shows the source's reading.
 *
 *     <LiveStatus clock={event.clock} fallback={event.detail ?? "Live"} />
 */
import { clockText } from "../../data/clock";
import { spokenStatus } from "../../data/format";
import type { GameClock } from "../../data/models";
import { useNow } from "../../state/clock";
import { LiveDot } from "./LiveDot";
import styles from "./LiveStatus.module.css";

export interface LiveStatusProps {
  readonly clock: GameClock | null;
  readonly fallback?: string;
  /** Mac points. */
  readonly size?: number;
  /** False while the data is stale: the dot holds still. */
  readonly animated?: boolean;
  readonly className?: string;
}

export function LiveStatus({ clock, fallback = "Live", size = 11, animated = true, className }: LiveStatusProps) {
  const running = clock?.running === true;
  const now = useNow(1000, running);
  // A stopped clock (a timeout, half-time) shows the source's own words.
  const text = clock && running ? clockText(clock, now) : fallback;
  return (
    <span className={[styles.status, className].filter(Boolean).join(" ")} style={{ fontSize: `calc(${size} * var(--pt))` }}>
      <LiveDot animated={animated} />
      <span className={styles.text} aria-hidden="true">
        {text}
      </span>
      <span className="visually-hidden">Live, {spokenStatus(text)}</span>
    </span>
  );
}
