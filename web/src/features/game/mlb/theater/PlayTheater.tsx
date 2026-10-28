/**
 * The play theater (PlayTheater.swift): under the diamond and the count,
 * the last play replayed on an isometric field as it arrives from the live
 * lane, shot like a broadcast. The camera opens tight on the battery for the
 * delivery and the pitch (its type and speed), follows the ball off the bat
 * with the fielder going for it, frames each throw end to end, then settles
 * on the runners' last bases as the scorer's mark lands (with Statcast's
 * batted-ball line under it when MLB has the at-bat). Where MLB's feed has
 * the play (useStatcast.ts), it's told from MLB's official account: the ball
 * to the man credited with fielding it, the throws along the credited chain,
 * every runner where MLB says, each run crossing in turn with the camera on
 * it. A replay keeps the play it began with: MLB's account landing
 * mid-replay waits for its end. Marquee plays get a
 * headline across the top (HOME RUN, TRIPLE, DOUBLE PLAY), and a home run's
 * fireworks burst at the wall it cleared. The footer under it (the
 * diamond's last play) is its caption.
 *
 * Drawn on one canvas through the camera (renderer.ts, drawTheater.ts), so
 * lines stay crisp at any zoom. A rAF loop runs only while a replay plays;
 * between plays the scene is a still on the infield. Plays already on the
 * page when it opened show as they ended; a new one mid-replay cuts to
 * itself; with Reduce Motion each play crossfades to how it ended and the
 * camera never moves. A play's end (its trace, the stamp, the Statcast line)
 * stays until the next at-bat's first pitch, or `HOLD_MS` after its replay,
 * whichever comes first; then the field crossfades to the game as it is (the
 * live bases and batter). The field and the figures are one canvas pass,
 * through the same camera at the same moment. Decorative for screen readers:
 * the caption carries the play.
 *
 *     <PlayTheater state={theater} bases={[on1, on2, on3]} batting="top" palette={palette} kits={kits} event={event} />
 *
 * Faithful to the Swift: the parser and notation, the script (every beat and
 * pace), the camera (shots, spring, caps, the corner kept clear), the field,
 * figures and poses, the ball, the beats, the type and its timings, the
 * teams' dress, and the celebrations (fireworks at the wall, the banner's
 * confetti, Subtle, the cooldown, Reduce Motion's bloom).
 * Simplified on the web:
 * - The headline's expanded width uses the canvas `fontStretch` where the browser has it (SF Pro Expanded isn't web-addressable); type is the system UI face, without tabular figures.
 * - Text is measured with the canvas, not SwiftUI's layout, so the stamp's line boxes are approximations of SF's metrics.
 * - Team colors mix in OKLab for the far limbs (SwiftUI's `mix` is its own perceptual space).
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ScoreEvent, Side } from "../../../../data/models";
import { PlayScript, type Rest } from "../../../../data/mlb/playScript";
import { playOnStage, type PlayScene, type TheaterState } from "../../../../data/mlb/playScene";
import { HOLD_MS } from "../../../../data/theater/theaterKit";
import { theaterTeams, type TheaterKits } from "../../../../data/mlb/theaterTeams";
import type { TeamPalette } from "../../../../data/teamColors";
import { useSettings } from "../../../../state/settings";
import { useColorScheme } from "../../../../state/theme";
import { useChartMoment } from "../../core/moments";
import { TheaterRenderer } from "./renderer";
import { theaterInk } from "./theaterInk";
import { useMeasuredTheater } from "./useStatcast";
import styles from "./PlayTheater.module.css";

export type { TeamKit, TheaterKits } from "../../../../data/mlb/theaterTeams";

export interface PlayTheaterProps {
  readonly state: TheaterState;
  /** The live bases and the team at bat (the diamond's), for the field between plays. */
  readonly bases: readonly [boolean, boolean, boolean] | null;
  readonly batting: Side | null;
  /** Unused when kits dress the teams (they always do here); kept for the contract with the page. */
  readonly palette: TeamPalette;
  /** The teams' own and second colors, so the figures always contrast. */
  readonly kits: TheaterKits;
  /** For MLB's feed: the game's date and teams. */
  readonly event: ScoreEvent;
  /** Development: draw this instant of the play, frozen (seconds from the pitch). */
  readonly frozen?: number | null;
}

const reduceQuery = typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
const subscribeReduce = (listener: () => void) => {
  reduceQuery?.addEventListener("change", listener);
  return () => reduceQuery?.removeEventListener("change", listener);
};

/** The system's Reduce Motion, live. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduce, () => reduceQuery?.matches ?? false, () => false);
}

export function PlayTheater({ state: lane, bases, batting, kits, event, frozen = null }: PlayTheaterProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<TheaterRenderer | null>(null);
  const scheme = useColorScheme();
  const level = useSettings((s) => s.celebrationLevel);
  const reduceMotion = usePrefersReducedMotion();
  const moment = useChartMoment("plate");
  // The replay that has run its course, and the one whose end has had its time on screen.
  const [ended, setEnded] = useState<string | null>(null);
  const [rested, setRested] = useState<string | null>(null);
  // The lane's play with MLB's account in it, once found (a new one waits briefly for it).
  const state = useMeasuredTheater(event, lane);
  // The play on screen: a replay's own until it's over; then how the latest
  // ended, until the next pitch or the hold; then none, and the field shows
  // the live bases and batter.
  const latest = playOnStage(state, frozen == null && !reduceMotion, ended, rested);
  // A replay keeps the play it began with (MLB's account landing mid-replay waits for its end).
  const began = useRef<PlayScene | null>(null);
  const replaying = latest != null && frozen == null && !reduceMotion && state.news && ended !== latest.id;
  if (replaying && began.current?.id !== latest.id) began.current = latest;
  const play = replaying ? began.current : latest;
  useEffect(() => {
    if (ended == null) return;
    // Done: its end holds a while, then the field returns to the game.
    const id = setTimeout(() => setRested(ended), HOLD_MS);
    return () => clearTimeout(id);
  }, [ended]);

  // The field between plays: the live bases and batter, or how the play left them.
  const swapped = play?.endsInning ?? false;
  const restBases: readonly boolean[] = play ? (swapped ? [false, false, false] : (bases ?? play.basesAfter)) : (bases ?? [false, false, false]);
  const restKey = `${restBases.map(Number).join("")}|${state.bats ?? "-"}|${swapped}`;
  const script = useMemo(() => {
    const rest: Rest = { bases: restBases, bats: state.bats, swapped };
    return play ? PlayScript.play(play, rest) : PlayScript.rest(rest);
    // A play keeps one script per field it settles to and reading of MLB's account (the play's object may be re-made by a poll).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play?.id, play?.measured, restKey]);

  // The play's batting team; else the live one; else the top team (the visitors bat first).
  const side = play?.batting ?? batting ?? "top";
  const teams = useMemo(
    () => theaterTeams(kits, scheme, side),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kits.top.color, kits.top.alternate, kits.bottom.color, kits.bottom.alternate, scheme, side],
  );
  const ink = useMemo(() => theaterInk(scheme), [scheme]);
  // Statcast's batted-ball line on the stamp (a grounder's without its first hop's distance).
  const statcast = play?.readout ?? null;

  useEffect(() => {
    if (!canvas.current) return;
    const r = new TheaterRenderer(canvas.current);
    renderer.current = r;
    return () => {
      r.dispose();
      renderer.current = null;
    };
  }, []);

  useEffect(() => {
    renderer.current?.update({ scene: play, news: state.news, script, teams, ink, statcast, moment, level, reduceMotion, frozen, onEnd: setEnded });
  }, [play, state.news, script, teams, ink, statcast, moment, level, reduceMotion, frozen]);

  return (
    <div className={styles.well} aria-hidden="true">
      <canvas ref={canvas} className={styles.canvas} />
    </div>
  );
}
