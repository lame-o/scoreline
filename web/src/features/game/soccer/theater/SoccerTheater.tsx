/**
 * The soccer theater (SoccerTheater.swift): at the top of the Live Pitch,
 * the latest big moment replayed on a pitch in perspective as it arrives
 * from the live lane, shot like a broadcast from high in the main stand. The
 * camera rides the ball through the build-up (each pass from the man who
 * played it to the man it found, standing where ESPN placed them), pushes
 * in as the shot is struck, and holds on the goal and the scorer wheeling
 * away. The shot goes to the exact point in the goal mouth it was heading
 * for: in off the post, into the keeper's hands, onto the bar. Marquee
 * moments get a headline (GOAL, SAVE, OFF THE POST, PENALTY, OWN GOAL) and
 * a goal its fireworks over the net; the stamp names the scorer, the
 * assist, the minute and the distance. The moment's own words, under it,
 * are its caption.
 *
 * Drawn on one canvas through the camera (TheaterStage, drawSoccer.ts). It
 * reads the live lane itself (and nothing above it does), so a new moment
 * redraws the theater alone. Moments already on the page when it opened
 * show as they ended; a new one mid-replay cuts to itself; with Reduce
 * Motion each moment crossfades to how it ended and the camera never moves.
 * The stage is decorative for screen readers: the caption carries the
 * moment. Lazy: the page loads this module only when it shows a live pitch.
 *
 *     <SoccerTheater feed={feed} homeTeamID="362" kits={kits} />
 */
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { cueFor, presetFor } from "../../../../data/celebrations";
import type { SoccerFeed } from "../../../../data/liveFeeds/soccer";
import { dress, type TheaterKits } from "../../../../data/mlb/theaterTeams";
import { goalOf, scored, type SoccerScene, type SoccerTheaterState } from "../../../../data/theater/soccerScene";
import { SoccerScript } from "../../../../data/theater/soccerScript";
import { GoalCelebration, PitchProjection, sentences, SoccerTheaterWatch } from "../../../../data/theater/soccerTheater";
import { useSettings } from "../../../../state/settings";
import { useColorScheme } from "../../../../state/theme";
import { useChartMoment } from "../../core/moments";
import { TheaterStage, type StageInputs } from "../../core/theater/TheaterStage";
import { accentOf, drawBursts, TheaterType, teamPalette, type Size } from "../../core/theater/theaterKit";
import wellStyles from "../../core/theater/TheaterWell.module.css";
import { useReducedMotion } from "../../core/useMedia";
import { theaterInk } from "../../mlb/theater/theaterInk";
import { drawPitch, drawSoccerFrame, layoutLabels, type Labels, type SoccerTeams } from "./drawSoccer";
import styles from "./SoccerTheater.module.css";

export interface SoccerTheaterProps {
  /** The live lane: the theater reads its window of plays itself. Null in previews (`preloaded`). */
  readonly feed: SoccerFeed | null;
  /** The home (top) team's ESPN ID. */
  readonly homeTeamID: string | null;
  /** The teams' own and second colors, so the figures always contrast. */
  readonly kits: TheaterKits;
  /** A moment to show before (or without) the live lane: previews, the harness. */
  readonly preloaded?: SoccerTheaterState | null;
  /** Development: draw this instant of the moment, frozen (seconds from its first touch). */
  readonly frozen?: number | null;
}

const EMPTY: SoccerTheaterState = { scene: null, news: false };

/** The lane's theater, kept beside it: each change to the lane's window, read as it happens (SoccerFeed.updateTheater). */
class TheaterFollow {
  readonly watch = new SoccerTheaterWatch();
  /** Whether the lane had had a load before this change: until then everything is history. */
  private primed = false;

  constructor(
    private readonly feed: SoccerFeed,
    private readonly homeTeamID: string | null,
  ) {
    this.process();
  }

  private process(): boolean {
    const changed = this.watch.update(this.feed.plays, this.homeTeamID, this.primed);
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

function useTheaterState(feed: SoccerFeed | null, homeTeamID: string | null): SoccerTheaterState {
  const follow = useMemo(() => (feed ? new TheaterFollow(feed, homeTeamID) : null), [feed, homeTeamID]);
  return useSyncExternalStore(follow ? follow.subscribe : none, follow ? follow.state : () => EMPTY, () => EMPTY);
}

export default function SoccerTheater({ feed, homeTeamID, kits, preloaded = null, frozen = null }: SoccerTheaterProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<TheaterStage | null>(null);
  const live = useTheaterState(feed, homeTeamID);
  const state = live.scene ? live : (preloaded ?? live);
  const scheme = useColorScheme();
  const level = useSettings((s) => s.celebrationLevel);
  const reduceMotion = useReducedMotion();
  const moment = useChartMoment("pitch");
  const scene = state.scene;

  // The moment's script, built once (a render for anything else reuses it).
  const script = useMemo(() => (scene ? SoccerScript.build(scene) : new SoccerScript()), [scene]);
  const dressed = useMemo(
    () => dress(kits, scheme),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kits.top.color, kits.top.alternate, kits.bottom.color, kits.bottom.alternate, scheme],
  );
  // The moment's attacking team (home is the top team).
  const side = scene?.side ?? "top";
  const teams: SoccerTeams = useMemo(() => (side === "top" ? { attacking: dressed.top, defending: dressed.bottom } : { attacking: dressed.bottom, defending: dressed.top }), [dressed, side]);
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
    let labels: { key: string; value: Labels } | null = null;
    const labelsFor = (ctx: CanvasRenderingContext2D, size: Size, pt: number): Labels => {
      const key = `${size.width}x${size.height}|${pt}`;
      if (labels?.key !== key) labels = { key, value: layoutLabels(ctx, scene, script, teams, ink, size, pt) };
      return labels.value;
    };
    const color = accentOf(teams.attacking, ink);
    const inputs: StageInputs = {
      id: scene?.id ?? null,
      news: state.news,
      duration: script.duration,
      frozen,
      reduceMotion,
      momentID: moment?.id ?? null,
      bursts: (height) => (scene ? GoalCelebration.theater(moment, scene, script, level, reduceMotion, height) : []),
      bloom:
        scene && moment
          ? (size) => {
              // The end state: a bloom over the net it went into.
              if (moment.id !== scene.id || !scored(scene) || level === "off") return null;
              const cue = cueFor(moment, { level, reduceMotion: true, preset: presetFor(size.height), direction: Math.PI / 2 });
              if (!cue) return null;
              const goal = goalOf(scene);
              const origin = new PitchProjection(size, script.frame(Infinity)).point({ x: goal.x, y: goal.y, z: 1.2 });
              return { cue, origin, palette: teamPalette(color, ink) };
            }
          : null,
      paint: (ctx, size, pt, t, bursts) => {
        const f = new PitchProjection(size, script.frame(t));
        drawPitch(ctx, f, ink);
        drawSoccerFrame(ctx, f, { scene, script, t, teams, ink, labels: labelsFor(ctx, size, pt) });
        if (bursts.length > 0) {
          const palette = teamPalette(color, ink);
          drawBursts(ctx, bursts, t, (p) => f.point(p), TheaterType.bannerOrigin(size, pt), () => palette, size);
        }
      },
    };
    stage.current?.update(inputs);
  }, [scene, state.news, script, teams, ink, moment, level, reduceMotion, frozen]);

  return (
    <div className={styles.theater}>
      <div className={wellStyles.well} data-theater="soccer" aria-hidden="true">
        <canvas ref={canvas} className={wellStyles.canvas} />
      </div>
      <Caption scene={scene} />
    </div>
  );
}

/** The moment in ESPN's words, under the stage: its minute, then what happened (a space where ESPN ran two sentences together). */
function Caption({ scene }: { scene: SoccerScene | null }) {
  if (!scene) return <p className={styles.caption}>Goals, saves and big chances replay here as they happen.</p>;
  return (
    <p key={scene.id} className={styles.caption}>
      <span className={styles.minute}>{scene.minute}</span>
      {`\u00a0 ${sentences(scene.text)}`}
    </p>
  );
}
