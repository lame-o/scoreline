/**
 * What every isometric view says between plays (TheaterStatus.swift), so a
 * live game never looks frozen when nothing is being replayed: a broadcast
 * tag for the state of play (SPURS BALL, TIMEOUT · JAZZ, END OF 3RD, MOUND
 * VISIT, VAR CHECK), the heartbeat that says the feed is live and when it
 * last spoke, and the control that turns the court or field round to match
 * the viewer's TV. Each sport's theater decides what its status says from its
 * feed; this file draws it the same way everywhere, in the scoring slide's
 * broadcast type.
 *
 * Place them inside the theater's well (position: relative):
 *
 *     <TheaterStatusTag tag="SPURS BALL" tint="#000000" height={wellHeight} />
 *     <TheaterHeartbeat updated={heard} source="ESPN" />
 *     <TheaterFlipButton eventId={id} surface="court" flipped={flipped} onFlip={toggle} />
 */
import { type CSSProperties, useCallback, useEffect, useState } from "react";
import { teamPaint } from "../../../../data/scoringSlide";
import { toHex } from "../../../../data/teamColors";
import { systemCondenses } from "../scoringSlides";
import styles from "./TheaterStatus.module.css";

/** The state of play a theater shows between (and during) plays. */
export interface TheaterStatus {
  /** What's happening now, in a few words ("TIMEOUT · JAZZ", "SPURS BALL"); null when play is on and there's nothing to say. */
  readonly tag: string | null;
  /** The tag's color: a team's (hex) for its ball, its timeout, its change; null for the game's own moments. */
  readonly tint: string | null;
  /** When the feed last brought anything (ms since the epoch): the heartbeat counts from here. */
  readonly updated: number | null;
}

/** The tag's type size for a well this tall (pt). */
export const statusTagSize = (height: number) => Math.min(Math.max(height * 0.052, 10), 14);

/**
 * The status tag, at the theater's top leading corner, 8pt down: square at
 * the edge it sits on, its far end cut on the type's lean, in the team's
 * color (or near black for the game's own), condensed black italic caps as
 * the scoring slide's kicker. A change cross-fades (keyed on the words).
 */
export function TheaterStatusTag({ tag, tint, height }: { tag: string | null; tint: string | null; height: number }) {
  const [condensed] = useState(systemCondenses);
  if (tag === null) return null;
  const paint = tint === null ? null : teamPaint(tint, null);
  const style = {
    "--size": `${statusTagSize(height)}px`,
    "--fill": paint === null ? "rgb(15 15 15 / 0.88)" : toHex(paint.slab),
    "--ink": paint === null ? "#ffffff" : paint.lightInk ? "#ffffff" : "#141414",
  } as CSSProperties;
  return (
    <span key={tag} className={styles.tag} style={style} data-type={condensed ? undefined : "fallback"} role="status">
      {tag}
    </span>
  );
}

/** "Live · 4s", "Live · 45s", then "Waiting for ESPN · 2m". (pure; tested) */
export function heartbeatLabel(seconds: number, source: string): string {
  if (seconds < 60) return `Live · ${seconds}s`;
  return `Waiting for ${source} · ${Math.floor(seconds / 60)}m`;
}

/**
 * The heartbeat, small at the theater's bottom trailing corner: the live dot
 * and how long since the feed last brought anything, ticking once a second
 * only while it's mounted and the tab is visible.
 */
export function TheaterHeartbeat({ updated, source }: { updated: number | null; source: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (updated === null) return;
    let timer: number | undefined;
    const start = () => {
      window.clearInterval(timer);
      setNow(Date.now());
      timer = document.hidden ? undefined : window.setInterval(() => setNow(Date.now()), 1000);
    };
    start();
    document.addEventListener("visibilitychange", start);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", start);
    };
  }, [updated]);
  if (updated === null) return null;
  const seconds = Math.max(Math.floor((now - updated) / 1000), 0);
  return (
    <span className={styles.heartbeat} aria-hidden="true">
      <span className={styles.dot} />
      {heartbeatLabel(seconds, source)}
    </span>
  );
}

/** Which way a theater faces for one game: turned round once by the viewer to match their TV, remembered for that game. */
export const theaterFlipKey = (eventId: string) => `theaterFlip.${eventId}`;

/** Whether the viewer turned this game's court or field round (false when storage is unavailable). */
export function readTheaterFlip(eventId: string): boolean {
  try {
    return window.localStorage.getItem(theaterFlipKey(eventId)) === "1";
  } catch {
    return false;
  }
}

/** The flip, remembered per game: [flipped, toggle]. */
export function useTheaterFlip(eventId: string): [boolean, () => void] {
  const [flipped, setFlipped] = useState(() => readTheaterFlip(eventId));
  useEffect(() => setFlipped(readTheaterFlip(eventId)), [eventId]);
  const toggle = useCallback(() => {
    setFlipped((was) => {
      const next = !was;
      try {
        if (next) window.localStorage.setItem(theaterFlipKey(eventId), "1");
        else window.localStorage.removeItem(theaterFlipKey(eventId));
      } catch {
        // Not remembered, still turned for this visit.
      }
      return next;
    });
  }, [eventId]);
  return [flipped, toggle];
}

/**
 * The control that turns the court round to match the TV: a small round
 * button at the theater's top trailing corner, shown while the pointer is
 * over the theater (and always to keyboard and screen-reader users).
 * `surface` is "court", "field" or "pitch".
 */
export function TheaterFlipButton({ surface, flipped, onFlip }: { surface: string; flipped: boolean; onFlip: () => void }) {
  return (
    <button
      type="button"
      className={styles.flip}
      onClick={onFlip}
      title={`Turn the ${surface} around to match your TV`}
      aria-label={`Turn the ${surface} around`}
      aria-pressed={flipped}
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2.5 5.5h11M10.5 2.5l3 3-3 3M13.5 10.5h-11M5.5 7.5l-3 3 3 3" />
      </svg>
    </button>
  );
}

