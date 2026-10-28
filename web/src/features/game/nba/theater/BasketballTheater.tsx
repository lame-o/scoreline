/**
 * The basketball theater (BasketballTheater.swift): in the Shot Chart
 * section, above the court, the newest basket replayed on an isometric
 * court as it arrives from the live lane, shot like a broadcast. The camera
 * opens on the half court with both fives set, follows the ball to the man
 * it goes to, frames the shooter and the rim as the shot goes up, and
 * settles on the rim as the stamp lands ("+3 3PT", "BROWN JR. · 23 FT JUMP
 * SHOT", "AST ELLIS"). Marquee plays get a headline across the top (DUNK,
 * AND-ONE, POSTERIZED, BUZZER-BEATER, REJECTED); a buzzer-beater's confetti
 * comes off it. The shot chart under it, and its shot story, is its
 * caption.
 *
 * Built from the other theaters' parts: the projection and camera framing,
 * the rig's figures, the ball and its comet tail, the type (core/theater).
 * Drawn on one canvas through the camera (TheaterStage, drawBasketball.ts),
 * the court and the players together, so lines stay crisp at any zoom and
 * the two never disagree on it. Between plays the court is still, the team
 * with the ball set in its half. Plays already on the page when it opened
 * show as nothing (the live court); a new one mid-replay cuts to itself;
 * with Reduce Motion each play crossfades to how it ended and the camera
 * never moves. Its end holds (`HOLD_MS`), then the live court returns.
 * Decorative for screen readers: the shot chart carries the play. It reads
 * the live lane itself (and nothing above it does), so a new play redraws
 * the theater alone. Lazy: the page loads this module only while it's live.
 *
 *     <BasketballTheater feed={feed} teams={teams} kits={kits} palette={palette} topIsHome topName="BKN" bottomName="BOS" />
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { cueFor, presetFor } from "../../../../data/celebrations";
import type { BasketballFeed, Teams } from "../../../../data/liveFeeds/basketball";
import { dress, type TheaterKits } from "../../../../data/mlb/theaterTeams";
import type { Side } from "../../../../data/models";
import { NEUTRAL, type Scheme, type TeamPalette } from "../../../../data/teamColors";
import type { BasketballTheaterState } from "../../../../data/theater/basketballScene";
import { BasketballScript, Hoops } from "../../../../data/theater/basketballScript";
import { BasketballCelebration, basketballShown, BasketballTheaterWatch, type BasketballBurst } from "../../../../data/theater/basketballTheater";
import { HOLD_MS } from "../../../../data/theater/theaterKit";
import { useSettings } from "../../../../state/settings";
import { useColorScheme } from "../../../../state/theme";
import { useChartMoment } from "../../core/moments";
import { TheaterStage, type StageInputs } from "../../core/theater/TheaterStage";
import { accentOf, drawBursts, TheaterType, teamPalette, type Size, type StageBurst } from "../../core/theater/theaterKit";
import styles from "../../core/theater/TheaterWell.module.css";
import { useReducedMotion } from "../../core/useMedia";
import { theaterInk } from "../../mlb/theater/theaterInk";
import { drawBasketballFrame, drawCourt, HoopProjection, layoutLabels, type BasketballTeams, type Labels, type Paint } from "./drawBasketball";
import { useSlideCourt } from "./slideCourt";

export interface BasketballTheaterProps {
  /** The live lane: the theater reads its plays itself. Null in previews (`preloaded`). */
  readonly feed: BasketballFeed | null;
  /** Who's playing (the lane's teams); null until the first full load says who's home. */
  readonly teams: Teams | null;
  /** The teams' own and second colors, so the players always contrast. */
  readonly kits: TheaterKits;
  /** The page's palette: the paint wears the home team's. */
  readonly palette: TeamPalette;
  readonly topIsHome: boolean;
  readonly topName: string;
  readonly bottomName: string;
  /** What to show without a live lane (previews and the render harness). */
  readonly preloaded?: BasketballTheaterState | null;
  /** Who has the ball between plays when there's no lane. */
  readonly restOffense?: Side | null;
  /** Development: draw this instant of the play, frozen (seconds from the start of the replay). */
  readonly frozen?: number | null;
}

const EMPTY: BasketballTheaterState = { scene: null, news: false };

/** The lane's theater, kept beside it: each change to the lane's plays, read as it happens (BasketballFeed's `theater`). */
class TheaterFollow {
  readonly watch = new BasketballTheaterWatch();
  private snapshot: { readonly state: BasketballTheaterState; readonly possession: Side | null };

  constructor(
    private readonly feed: BasketballFeed,
    private readonly teams: Teams,
  ) {
    this.process();
    this.snapshot = { state: this.watch.state, possession: feed.possession };
  }

  private process(): boolean {
    return this.watch.update(this.feed.items, this.teams, this.feed.looks, (id) => this.feed.seenIn(id), Date.now());
  }

  /** The theater's state, and who has the ball (the court between plays): a new object only when either changes. */
  private refresh(): boolean {
    const changed = this.process();
    if (!changed && this.snapshot.possession === this.feed.possession) return false;
    this.snapshot = { state: this.watch.state, possession: this.feed.possession };
    return true;
  }

  readonly subscribe = (listener: () => void) => {
    // Catch up on anything the lane said between this follower's making and React's subscribing.
    if (this.refresh()) listener();
    return this.feed.subscribe(() => {
      if (this.refresh()) listener();
    });
  };

  readonly state = () => this.snapshot;
}

const none = () => () => {};
const NOTHING = { state: EMPTY, possession: null };

function useTheaterState(feed: BasketballFeed | null, teams: Teams | null): { readonly state: BasketballTheaterState; readonly possession: Side | null } {
  const key = teams ? `${teams.topIsHome}|${teams.topID}|${teams.bottomID}|${teams.topName}|${teams.bottomName}` : "";
  // One follower per lane and teams (the page's teams object is new when its names change; its values are what matter).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const follow = useMemo(() => (feed && teams ? new TheaterFollow(feed, teams) : null), [feed, key]);
  return useSyncExternalStore(follow ? follow.subscribe : none, follow ? follow.state : () => NOTHING, () => NOTHING);
}

/** A team's paint (TheaterTeams.solid): its own color, or a gray for one with none. */
function solid(color: string, scheme: Scheme): string {
  return color === NEUTRAL || !color.startsWith("#") ? (scheme === "dark" ? "#b8b8b8" : "#808080") : color;
}

/** The rim the offense attacks: where Reduce Motion's bloom goes. */
const RIM = { x: Hoops.rim.x, y: Hoops.rim.y, z: Hoops.rimHeight };

export default function BasketballTheater({ feed, teams: laneTeams, kits, palette, topIsHome, topName, bottomName, preloaded = null, restOffense = null, frozen = null }: BasketballTheaterProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<TheaterStage | null>(null);
  const live = useTheaterState(feed, laneTeams);
  const state = live.state.scene ? live.state : (preloaded ?? live.state);
  const possession = feed ? live.possession : restOffense;
  const scheme = useColorScheme();
  const level = useSettings((s) => s.celebrationLevel);
  const reduceMotion = useReducedMotion();
  const moment = useChartMoment("court");
  // The replay begun on the stage (BasketballStage.replay): which play, and whether it has run its course; and the replay whose end has had its time.
  const [replay, setReplay] = useState<{ readonly id: string; readonly done: boolean } | null>(null);
  const [rested, setRested] = useState<string | null>(null);
  // A new play replays from the start; with Reduce Motion it's over at once (its end crossfades in, and holds). History doesn't.
  useEffect(() => {
    const p = state.scene;
    if (frozen != null || !state.news || !p) return;
    setReplay((r) => (r?.id === p.id ? r : { id: p.id, done: reduceMotion }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.scene?.id]);
  // Done: its end holds a while (unless the next play comes), then the court returns to the game.
  useEffect(() => {
    if (!replay?.done) return;
    const id = setTimeout(() => setRested(replay.id), HOLD_MS);
    return () => clearTimeout(id);
  }, [replay]);
  /** The play on screen: a replay, then its end until it has held; else none (the team with the ball set in its half). */
  const play = basketballShown(state, replay?.id ?? null, rested);
  const replaying = replay != null && play != null && replay.id === play.id;
  const news = replaying ? !replay.done : state.news;

  // The play's script, or the court between plays: built once each (a render for anything else reuses it).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const script = useMemo(() => (play ? BasketballScript.play(play) : BasketballScript.rest({ offense: possession })), [play, play ? null : possession]);
  // The scoring slide lands with this replay's climax.
  useSlideCourt(state, play, script);

  const dressed = useMemo(
    () => dress(kits, scheme),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kits.top.color, kits.top.alternate, kits.bottom.color, kits.bottom.alternate, scheme],
  );
  const offense: Side = play?.offense ?? possession ?? "top";
  const teams: BasketballTeams = useMemo(() => (offense === "top" ? { offense: dressed.top, defense: dressed.bottom } : { offense: dressed.bottom, defense: dressed.top }), [dressed, offense]);
  // The paint in the home team's color, its name at center court.
  const paint: Paint = useMemo(
    () => ({ color: solid(topIsHome ? palette.top : palette.bottom, scheme), name: (topIsHome ? topName : bottomName).toUpperCase(), three: Hoops.three }),
    [topIsHome, palette.top, palette.bottom, scheme, topName, bottomName],
  );
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
      // A replay cuts in; a play that isn't replayed (or the court changing ends) crossfades.
      id: play?.id ?? `rest-${possession ?? "none"}`,
      news: play != null && news,
      // Its course run: its end holds.
      onEnd: (id) => setReplay((r) => (r && r.id === id && !r.done ? { id, done: true } : r)),
      duration: script.duration,
      frozen,
      reduceMotion,
      momentID: moment?.id ?? null,
      bursts: (height) => (play ? BasketballCelebration.theater(moment, play, script, level, reduceMotion, height) : []),
      bloom:
        play && moment
          ? (size) => {
              // With Reduce Motion there's no replay: a basket that celebrates blooms at the rim, as the play's end shows.
              if (moment.id !== play.id || BasketballCelebration.theater(moment, play, script, level, true, size.height).length === 0) return null;
              const cue = cueFor(moment, { level, reduceMotion: true, preset: presetFor(size.height), direction: -Math.PI / 2 });
              if (!cue) return null;
              const origin = new HoopProjection(size, script.camera.rest, script.yaw).at(RIM);
              return { cue, origin, palette: teamPalette(color(play.offense), ink) };
            }
          : null,
      paint: (ctx, size, pt, t, bursts: readonly StageBurst[]) => {
        const h = new HoopProjection(size, script.camera.frame(t), script.yaw);
        drawCourt(ctx, h, ink, paint);
        drawBasketballFrame(ctx, h, { script, t, teams, ink, labels: labelsFor(ctx, size, pt) });
        if (bursts.length > 0) {
          drawBursts(ctx, bursts, t, (p) => h.at(p), TheaterType.bannerOrigin(size, pt), (b) => teamPalette(color((b as BasketballBurst).side ?? null), ink), size);
        }
      },
    };
    stage.current?.update(inputs);
  }, [play, possession, news, script, teams, paint, ink, moment, level, reduceMotion, frozen]);

  return (
    <div className={styles.well} data-theater="basketball" aria-hidden="true">
      <canvas ref={canvas} className={styles.canvas} />
    </div>
  );
}
