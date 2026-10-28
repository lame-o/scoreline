/**
 * The football theater (FootballTheater.swift): in the Field section, above
 * the drive chart, the last snap replayed on an isometric field as it
 * arrives from the live lane, shot like a broadcast. The camera opens
 * behind the offense on the formation, with the line of scrimmage in blue
 * and the line to gain in yellow; it follows the ball in the air and the
 * man carrying it, then frames the end spot and the new line to gain as the
 * stamp lands ("+12", "1ST DOWN", "−7 SACK", "INC", "FG 47 ✓"). Marquee
 * plays get a headline across the top (TOUCHDOWN, FIELD GOAL,
 * INTERCEPTION), and a touchdown's fireworks burst over the goal line it
 * crossed; its extra point or two-point try follows as a short beat of its
 * own once ESPN has it. The drive chart under it, and its play-by-play, is
 * its caption.
 *
 * Built from the baseball theater's parts (its projection, camera framing,
 * pictogram figures, ball and type; core/theater). Drawn on one canvas
 * through the camera (TheaterStage, drawFootball.ts). It reads the live
 * lane itself (and nothing above it does), so a new play redraws the
 * theater alone. A new play replays (a new one mid-replay cuts to itself;
 * with Reduce Motion it crossfades to how it ended and the camera never
 * moves), and its end holds (the stamp, the ball, the players where it
 * ended) until the next snap or `HOLD_MS`, then crossfades to the game as it
 * stands: both teams set at the live line, the blue and yellow lines, no
 * stamp. History isn't shown: on opening the page the field is the live
 * one (`footballShown`). The field and the players are one canvas pass,
 * through the same camera. Decorative for
 * screen readers: the drive chart carries the play. Lazy: the page loads
 * this module only when it shows a field.
 *
 *     <FootballTheater feed={feed} teams={teams} situation={situation} kits={kits} palette={palette} topName="DAL" bottomName="PHI" />
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Football } from "../../../../data/gameDetail";
import type { FootballFeed, FootballTeams as LaneTeams } from "../../../../data/liveFeeds/football";
import { dress, type TheaterKits } from "../../../../data/mlb/theaterTeams";
import type { Side } from "../../../../data/models";
import { cueFor, presetFor } from "../../../../data/celebrations";
import { NEUTRAL, type Scheme, type TeamPalette } from "../../../../data/teamColors";
import type { FootballTheaterState } from "../../../../data/theater/footballScene";
import { FootballScript } from "../../../../data/theater/footballScript";
import { DEFAULT_REST, FootballCelebration, footballShown, FootballTheaterWatch, footballRest, type FootballBurst } from "../../../../data/theater/footballTheater";
import { HOLD_MS } from "../../../../data/theater/theaterKit";
import { useSettings } from "../../../../state/settings";
import { useColorScheme } from "../../../../state/theme";
import { useChartMoment } from "../../core/moments";
import { TheaterStage, type StageInputs } from "../../core/theater/TheaterStage";
import { accentOf, drawBursts, TheaterType, teamPalette, type Size, type StageBurst } from "../../core/theater/theaterKit";
import { useReducedMotion } from "../../core/useMedia";
import { theaterInk } from "../../mlb/theater/theaterInk";
import styles from "../../core/theater/TheaterWell.module.css";
import { drawFootballFrame, drawGridiron, GridProjection, layoutLabels, type EndZone, type FootballTeams, type Labels } from "./drawFootball";

export interface FootballTheaterProps {
  /** The live lane: the theater reads its raw entries itself. Null in previews (`preloaded`). */
  readonly feed: FootballFeed | null;
  /** Who's home and the teams' abbreviations (the lane's teams); null until the first full load says. */
  readonly teams: LaneTeams | null;
  /** The field between plays when no play has come yet: the spot, from the live situation. */
  readonly situation: Football | null;
  /** The teams' own and second colors, so the players always contrast. */
  readonly kits: TheaterKits;
  /** The page's palette: the end zones wear it. */
  readonly palette: TeamPalette;
  readonly topName: string;
  readonly bottomName: string;
  /** What to show without a live lane (previews and the render harness). */
  readonly preloaded?: FootballTheaterState | null;
  /** Development: draw this instant of the play, frozen (seconds from the start of the replay). */
  readonly frozen?: number | null;
}

const EMPTY: FootballTheaterState = { play: null, news: false };

/** The lane's theater, kept beside it: each change to the lane's entries, read as it happens (FootballFeed's `theater`). */
class TheaterFollow {
  readonly watch = new FootballTheaterWatch();
  /** Whether the lane had had a complete look before this change: until then everything is history. */
  private primed = false;

  constructor(
    private readonly feed: FootballFeed,
    private readonly teams: LaneTeams,
  ) {
    this.process();
  }

  private process(): boolean {
    const changed = this.watch.update(this.feed.items, this.teams, this.primed, Date.now(), this.feed.charts);
    this.primed = this.feed.loaded;
    return changed;
  }

  readonly subscribe = (listener: () => void) => {
    // Catch up on anything the lane said between this follower's making and React's subscribing.
    if (this.process()) listener();
    return this.feed.subscribe(() => {
      if (this.process()) listener();
    });
  };

  readonly state = () => this.watch.state;
}

const none = () => () => {};

function useTheaterState(feed: FootballFeed | null, teams: LaneTeams | null): FootballTheaterState {
  const key = teams ? `${teams.topIsHome}|${teams.topID}|${teams.bottomID}|${teams.homeAbbreviation}|${teams.awayAbbreviation}|${teams.homeName ?? ""}|${teams.awayName ?? ""}` : "";
  // One follower per lane and teams (the page's teams object is new on every poll; its values aren't).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const follow = useMemo(() => (feed && teams ? new TheaterFollow(feed, teams) : null), [feed, key]);
  return useSyncExternalStore(follow ? follow.subscribe : none, follow ? follow.state : () => EMPTY, () => EMPTY);
}

/** A team's end-zone color (TheaterTeams.solid): its own, or a gray for one with none. */
function solid(color: string, scheme: Scheme): string {
  return color === NEUTRAL || !color.startsWith("#") ? (scheme === "dark" ? "#b8b8b8" : "#808080") : color;
}

export default function FootballTheater({ feed, teams: laneTeams, situation, kits, palette, topName, bottomName, preloaded = null, frozen = null }: FootballTheaterProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<TheaterStage | null>(null);
  const live = useTheaterState(feed, laneTeams);
  const state = live.play ? live : (preloaded ?? live);
  const scheme = useColorScheme();
  const level = useSettings((s) => s.celebrationLevel);
  const reduceMotion = useReducedMotion();
  const moment = useChartMoment("field");
  // The replay begun on the stage (FootballStage.replay): which play, and whether it has run its course;
  // and the replay whose end has had its time on screen.
  const [replay, setReplay] = useState<{ readonly id: string; readonly done: boolean } | null>(null);
  const [rested, setRested] = useState<string | null>(null);
  const clockLive = frozen == null;
  // A new play replays from its snap; with Reduce Motion it's over at once (its end crossfades in, and holds). History doesn't.
  useEffect(() => {
    const p = state.play;
    if (!clockLive || !state.news || !p) return;
    setReplay((r) => (r?.id === p.id ? r : { id: p.id, done: reduceMotion }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.play?.id]);
  // A touchdown replayed here is followed by its try, as a short beat of its own: a cut to the try's formation, a breath, the snap.
  useEffect(() => {
    const p = state.play;
    const attempt = p?.conversion;
    if (!clockLive || reduceMotion || !p || !attempt || replay?.id !== p.id || !replay.done) return;
    setReplay({ id: attempt.id, done: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replay, state.play?.conversion?.id]);
  // Done: its end holds a while (unless the next play comes), then the field returns to the game.
  useEffect(() => {
    if (!replay?.done) return;
    const id = setTimeout(() => setRested(replay.id), HOLD_MS);
    return () => clearTimeout(id);
  }, [replay]);
  /** The play on screen: a replay, a touchdown's try in its own beat, then its end until it has held; else none (the game as it stands). */
  const shownNow = footballShown(state, replay?.id ?? null, rested);
  // A try is made from its touchdown each time it's asked for: one per touchdown, so its script is built once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const play = useMemo(() => shownNow, [shownNow?.id, state.play]);
  const replaying = replay != null && play != null && replay.id === play.id;
  const news = replaying ? !replay.done : state.news;
  const following = replaying && play.id === state.play?.conversion?.id;

  // The field between plays when no play has come yet: the live spot, else the offense at its 25.
  const rest = situation ? footballRest(situation) : null;
  const restKey = rest ? `${rest.rest.yard}|${rest.rest.gain}` : "";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const script = useMemo(() => (play ? FootballScript.play(play) : FootballScript.rest(rest?.rest ?? DEFAULT_REST)), [play, restKey]);

  const offense: Side = play?.offense ?? rest?.offense ?? "top";
  const dressed = useMemo(
    () => dress(kits, scheme),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kits.top.color, kits.top.alternate, kits.bottom.color, kits.bottom.alternate, scheme],
  );
  const teams: FootballTeams = useMemo(() => (offense === "top" ? { offense: dressed.top, defense: dressed.bottom } : { offense: dressed.bottom, defense: dressed.top }), [dressed, offense]);
  // The end zones: the offense's own nearest the camera, the one it attacks at the far end.
  const zones = useMemo(() => {
    const top: EndZone = { color: solid(palette.top, scheme), name: topName.toUpperCase() };
    const bottom: EndZone = { color: solid(palette.bottom, scheme), name: bottomName.toUpperCase() };
    return offense === "top" ? { near: top, far: bottom } : { near: bottom, far: top };
  }, [palette.top, palette.bottom, scheme, topName, bottomName, offense]);
  const ink = useMemo(() => theaterInk(scheme), [scheme]);

  useEffect(() => {
    if (!canvas.current) return;
    const s = new TheaterStage(canvas.current);
    stage.current = s;
    return () => {
      s.dispose();
      stage.current = null;
    };
  }, []);

  useEffect(() => {
    // The type, laid out once per size and point (the inputs it depends on are this effect's).
    let labels: { key: string; value: Labels } | null = null;
    const labelsFor = (ctx: CanvasRenderingContext2D, size: Size, pt: number): Labels => {
      const key = `${size.width}x${size.height}|${pt}`;
      if (labels?.key !== key) labels = { key, value: layoutLabels(ctx, play, script, teams, ink, size, pt) };
      return labels.value;
    };
    const color = (side: Side | null) => (side == null || side === play?.offense ? accentOf(teams.offense, ink) : accentOf(teams.defense, ink));
    const inputs: StageInputs = {
      id: play?.id ?? null,
      news,
      lead: following ? 0.3 : 0,
      // Its course run: the touchdown's try follows, or its end holds.
      onEnd: (id) => setReplay((r) => (r && r.id === id && !r.done ? { id, done: true } : r)),
      duration: script.duration,
      frozen,
      reduceMotion,
      momentID: moment?.id ?? null,
      bursts: (height) => (play ? FootballCelebration.theater(moment, play, script, level, reduceMotion, height) : []),
      bloom:
        play && moment
          ? (size) => {
              // The end state: a bloom where the score happened, through the rest framing (Reduce Motion never moves the camera).
              const point = script.scorePoint ?? script.end;
              if (moment.id !== play.id || moment.kind !== "touchdown" || !point || level === "off") return null;
              const cue = cueFor(moment, { level, reduceMotion: true, preset: presetFor(size.height), direction: Math.PI / 2 });
              if (!cue) return null;
              const origin = new GridProjection(size, script.camera.rest, script.yaw).at(point);
              return { cue, origin, palette: teamPalette(color(play.scorer), ink) };
            }
          : null,
      paint: (ctx, size, pt, t, bursts: readonly StageBurst[]) => {
        const f = new GridProjection(size, script.camera.frame(t), script.yaw);
        drawGridiron(ctx, f, ink, zones.near, zones.far);
        drawFootballFrame(ctx, f, { script, t, teams, ink, labels: labelsFor(ctx, size, pt) });
        if (bursts.length > 0) {
          drawBursts(ctx, bursts, t, (p) => f.at(p), TheaterType.bannerOrigin(size, pt), (b) => teamPalette(color((b as FootballBurst).side ?? null), ink), size);
        }
      },
    };
    stage.current?.update(inputs);
  }, [play, news, following, script, teams, zones, ink, moment, level, reduceMotion, frozen]);

  return (
    <div className={styles.well} data-theater="football" aria-hidden="true">
      <canvas ref={canvas} className={styles.canvas} />
    </div>
  );
}
