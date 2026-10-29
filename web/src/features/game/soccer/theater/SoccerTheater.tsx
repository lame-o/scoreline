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
 * redraws the theater alone. Every shot replays (a new one mid-replay cuts
 * to itself; with Reduce Motion it crossfades to how it ended and the
 * camera never moves), and its end holds (the scorer wheeling away, the
 * stamp) until the next moment or `HOLD_MS`. Between moments the pitch is
 * never frozen (soccerIdle.ts): every event ESPN logs gets its beat in turn
 * (a corner from the right flag, a foul and the free kick at the real spot,
 * the card shown to the real player, an offside, a substitution, a man
 * down, VAR, the breaks), and otherwise the team on the ball passes it
 * round in its formation. It moves in sparse beats (BeatClock): a
 * requestAnimationFrame loop only through a beat, nothing at all off screen
 * or in a hidden tab, and with Reduce Motion one still moment. The ends
 * change at half time (and the viewer can turn the pitch round to match
 * their TV, remembered for the match). The tag at the top says what's
 * happening (ARSENAL BALL, CORNER · ARSENAL, YELLOW CARD · GUÉHI, VAR
 * CHECK, +4 ADDED), the heartbeat in the corner away from the stamp how long
 * since ESPN spoke. History isn't replayed: on opening the page the pitch is
 * the live one (`soccerShown`). The names over the players: whoever the
 * pointer's over (on a phone, the man tapped) gets his tag, his number,
 * SURNAME and place in the shape, and the man the moment is about keeps his
 * surname (the scorer; between moments the man booked, whistled or coming
 * on), all twenty-two named from the squads with each change made by then
 * (core/theater/theaterTags.ts). The canvas is decorative for screen
 * readers: the caption carries the moment, or the event, in ESPN's words.
 * Lazy: the page loads this module only when it shows a live pitch.
 *
 *     <SoccerTheater feed={feed} homeTeamID="362" kits={kits} eventId={event.id} topTeam="Aston Villa" bottomTeam="Man City" added={detail.soccerAdded} people={detail.people} />
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { cueFor, presetFor } from "../../../../data/celebrations";
import type { SoccerFeed } from "../../../../data/liveFeeds/soccer";
import { dress, type TheaterKits } from "../../../../data/mlb/theaterTeams";
import type { SoccerAddedTime } from "../../../../data/soccer";
import { addedShowing, eventBeat, PitchFacing, sameSoccerIdle, soccerEvents, soccerIdle, soccerIdleScript, SoccerStatus, turnedScene, type SoccerIdle, type SoccerNames, type SoccerStatusTag } from "../../../../data/theater/soccerIdle";
import { goalOf, lineupsOn, scored, type SoccerScene, type SoccerTheaterState } from "../../../../data/theater/soccerScene";
import { SoccerScript } from "../../../../data/theater/soccerScript";
import { GoalCelebration, idleKeyMan, PitchProjection, sentences, soccerCast, soccerKey, soccerShown, SoccerTheaterWatch } from "../../../../data/theater/soccerTheater";
import { HOLD_MS } from "../../../../data/theater/theaterKit";
import { NO_CAST, theaterLabels, type HitFigure, type TheaterPerson } from "../../../../data/theater/theaterNames";
import { useSettings } from "../../../../state/settings";
import { useColorScheme } from "../../../../state/theme";
import { useChartMoment } from "../../core/moments";
import { BeatClock } from "../../core/theater/beatClock";
import { RigLens } from "../../core/theater/rigFigure";
import { TheaterStage, type StageInputs } from "../../core/theater/TheaterStage";
import { TheaterFlipButton, TheaterHeartbeat, TheaterStatusTag, useTheaterFlip } from "../../core/theater/TheaterStatus";
import { accentOf, drawBursts, TheaterType, teamPalette, type Size } from "../../core/theater/theaterKit";
import wellStyles from "../../core/theater/TheaterWell.module.css";
import { useTheaterNames, type NamesPose } from "../../core/theater/useTheaterNames";
import { useReducedMotion } from "../../core/useMedia";
import { theaterInk } from "../../mlb/theater/theaterInk";
import { drawPitch, drawSoccerFrame, layoutLabels, type Labels, type SoccerTeams } from "./drawSoccer";
import { useSlidePitch } from "./slidePitch";
import styles from "./SoccerTheater.module.css";

export interface SoccerTheaterProps {
  /** The live lane: the theater reads its window of plays itself. Null in previews (`preloaded`). */
  readonly feed: SoccerFeed | null;
  /** The home (top) team's ESPN ID. */
  readonly homeTeamID: string | null;
  /** The teams' own and second colors, so the figures always contrast. */
  readonly kits: TheaterKits;
  /** The match: the viewer's turn of the pitch is remembered for it. */
  readonly eventId?: string;
  /** The teams' names for the tag ("Arsenal"). */
  readonly topTeam?: string;
  readonly bottomTeam?: string;
  /** The added time last announced (the commentary's), for its tag. */
  readonly added?: SoccerAddedTime | null;
  /** A moment to show before (or without) the live lane: previews, the harness. */
  readonly preloaded?: SoccerTheaterState | null;
  /** Development: draw this instant, frozen (seconds from the moment's first touch, or into the pitch between moments). */
  readonly frozen?: number | null;
  /** The squads (the summary's rosters), by athlete ID: the names over the players. */
  readonly people?: Readonly<Record<string, TheaterPerson>>;
  /** Development (the render harness): the pointer held over a player or a point. */
  readonly pointer?: NamesPose | null;
}

const NO_PEOPLE: Readonly<Record<string, TheaterPerson>> = {};

const EMPTY: SoccerTheaterState = { scene: null, news: false };
const NO_STATUS: SoccerStatusTag = { tag: null, tint: null };
const NONE_PLAYED: ReadonlySet<string> = new Set();

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
    const changed = this.watch.update(this.feed.plays, this.homeTeamID, this.primed, Date.now(), { struck: this.feed.struck, rosters: this.feed.rosters });
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

/** A team's color for the tag, as hex without the hash (the kit's own, else none). */
const tagColor = (color: string | null | undefined): string | null => (color ? color.replace(/^#/, "") : null);

/** The pitch between moments' script, built once per idle (a render for anything else reuses it). */
function useIdleScript(idle: SoccerIdle | null): SoccerScript | null {
  const cache = useRef<{ idle: SoccerIdle; script: SoccerScript } | null>(null);
  if (!idle) return null;
  if (!cache.current || !sameSoccerIdle(cache.current.idle, idle)) cache.current = { idle, script: soccerIdleScript(idle) };
  return cache.current.script;
}

export default function SoccerTheater({
  feed,
  homeTeamID,
  kits,
  eventId = "soccer",
  topTeam = "",
  bottomTeam = "",
  added = null,
  preloaded = null,
  frozen = null,
  people = NO_PEOPLE,
  pointer,
}: SoccerTheaterProps) {
  const well = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<TheaterStage | null>(null);
  // Who the pointer's over (the name over him): read by each frame, never React state.
  const named = useTheaterNames(well, stage);
  const beats = useRef<BeatClock | null>(null);
  const live = useTheaterState(feed, homeTeamID);
  const state = live.scene || live.touch ? live : (preloaded ?? live);
  const scheme = useColorScheme();
  const level = useSettings((s) => s.celebrationLevel);
  const reduceMotion = useReducedMotion();
  const moment = useChartMoment("pitch");
  const [flipped, flip] = useTheaterFlip(eventId);
  // The replay begun on the stage (SoccerStage.replay) and whether it has run its course; the one whose end has had its time; the events whose beats have played.
  const [replay, setReplay] = useState<{ readonly id: string; readonly done: boolean } | null>(null);
  const [rested, setRested] = useState<string | null>(null);
  const [played, setPlayed] = useState<ReadonlySet<string>>(NONE_PLAYED);
  const clockLive = frozen == null;
  // A new moment replays from its first touch; with Reduce Motion it's over at once (its end crossfades in, and holds). History doesn't.
  // A goal just struck off replays as its NO GOAL beat.
  useEffect(() => {
    if (!clockLive) return;
    const struck = state.overturned;
    if (struck && soccerShown(state, replay?.id ?? null, rested) === struck) {
      const key = soccerKey(struck);
      setReplay((r) => (r?.id === key ? r : { id: key, done: reduceMotion }));
      return;
    }
    const s = state.scene;
    if (!state.news || !s) return;
    setReplay((r) => (r?.id === s.id ? r : { id: s.id, done: reduceMotion }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.scene?.id, state.overturned?.id]);
  // Done: its end holds a while (unless the next moment comes), then the pitch goes on.
  useEffect(() => {
    if (!replay?.done) return;
    const id = setTimeout(() => setRested(replay.id), HOLD_MS);
    return () => clearTimeout(id);
  }, [replay]);
  /** The moment on screen: a replay, then its end until it has held; else none (the pitch between moments). */
  const shown = soccerShown(state, replay?.id ?? null, rested);
  const key = shown ? soccerKey(shown) : null;
  // (A goal just struck off is about to replay as its NO GOAL beat.)
  const news = replay != null && key != null && replay.id === key ? !replay.done : shown != null && shown === state.overturned ? true : state.news;
  // The moment as drawn: turned round for the second half, or the viewer's turn.
  const scene = useMemo(() => (shown && !PitchFacing.homeAttacksRight(shown.period ?? state.period, flipped) ? turnedScene(shown) : shown), [shown, state.period, flipped]);

  // Between moments: the event showing (its beat, or what holds play up), else the ball going round.
  const { pending, standing } = soccerEvents(state, played);
  const current = pending[0] ?? standing;
  const lineups = state.lineups;
  const lineupCount = Object.keys(lineups ?? {}).length;
  const idle = scene
    ? null
    : soccerIdle({ event: current, touch: state.touch ?? null, scene: state.scene, period: state.period ?? null, lineups: lineups ?? {}, flipped });
  /** Which idle it is: an event's beat; else the ball going round for a team from about where it is (a new spot or the ball changing hands starts it again, not every touch). */
  const touch = state.touch;
  const idleKey = current
    ? `${current.id}|${flipped}|${lineupCount}`
    : `play|${touch?.side === "bottom"}|${touch ? `${Math.trunc(touch.at.x / 15)},${Math.trunc(touch.at.y / 17)}` : "-"}|${flipped}|${lineupCount}|${state.period ?? 1}`;
  const addedNow = addedShowing(added, state.period ?? null, touch?.clock ?? 0);
  // Each event's beat for its time, then the next (or the pitch going on).
  const beating = scene == null && clockLive && current != null && pending[0]?.id === current.id ? current : null;
  useEffect(() => {
    if (!beating) return;
    const id = setTimeout(() => setPlayed((was) => new Set([...was, beating.id])), eventBeat(beating.kind) * 1000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beating?.id]);

  // The moment's script with both elevens, built once (a render for anything else reuses it); the pitch's between moments.
  const replayScript = useMemo(() => (scene ? SoccerScript.build(scene, lineups ?? {}) : null), [scene, lineups]);
  const idling = useIdleScript(idle);
  const script = replayScript ?? idling ?? new SoccerScript();
  // The scoring slide lands with this replay's climax.
  useSlidePitch(state, scene, script);
  const dressed = useMemo(
    () => dress(kits, scheme),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kits.top.color, kits.top.alternate, kits.bottom.color, kits.bottom.alternate, scheme],
  );
  // The attacking team: the moment's, or the one on the ball (home is the top team).
  const side = scene?.side ?? idle?.possession ?? "top";
  const teams: SoccerTeams = useMemo(() => (side === "top" ? { attacking: dressed.top, defending: dressed.bottom } : { attacking: dressed.bottom, defending: dressed.top }), [dressed, side]);
  const ink = useMemo(() => theaterInk(scheme), [scheme]);
  const names: SoccerNames = useMemo(() => ({ top: topTeam, bottom: bottomTeam, topColor: tagColor(kits.top.color), bottomColor: tagColor(kits.bottom.color) }), [topTeam, bottomTeam, kits.top.color, kits.bottom.color]);
  // Who each player on screen is, once per script: the moment's men as they stood (each change made by its minute), or the pitch's between moments.
  const cast = useMemo(
    () =>
      scene
        ? soccerCast(script, scene.side, lineupsOn(lineups ?? {}, scene.clock), people, scene.shooterCredit?.athlete ?? null, `${key ?? scene.id}|${flipped}`)
        : idle
          ? soccerCast(script, idle.possession, idle.lineups, people, idleKeyMan(idle), `idle|${idleKey}`)
          : NO_CAST,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [script, scene, key, flipped, lineups, people, idleKey, idle?.possession, idle?.lineups, idle?.event],
  );
  const labels = useMemo(
    () => theaterLabels(kits, scheme, { top: topTeam, bottom: bottomTeam }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kits.top.color, kits.top.alternate, kits.bottom.color, kits.bottom.alternate, scheme, topTeam, bottomTeam],
  );
  useEffect(() => {
    if (pointer !== undefined) named.pose(pointer);
  }, [named, pointer]);
  // The heartbeat in the corner away from the stamp.
  const heartbeatLeading = scene != null && script.cornerRight;

  // The tag: what's happening at the instant drawn, set only when its words or color change.
  const [status, setStatus] = useState<SoccerStatusTag>(NO_STATUS);
  const shownStatus = useRef<SoccerStatusTag>(NO_STATUS);
  const say = useCallback((next: SoccerStatusTag) => {
    if (next.tag === shownStatus.current.tag && next.tint === shownStatus.current.tint) return;
    shownStatus.current = next;
    setStatus(next);
  }, []);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (!canvas.current || !well.current) return;
    const s = new TheaterStage(canvas.current);
    const b = new BeatClock(well.current);
    stage.current = s;
    beats.current = b;
    const box = well.current;
    const resize = new ResizeObserver(() => setHeight(box.clientHeight));
    resize.observe(box);
    return () => {
      resize.disconnect();
      b.dispose();
      s.dispose();
      stage.current = null;
      beats.current = null;
    };
  }, []);

  useEffect(() => {
    let laidOut: { key: string; value: Labels } | null = null;
    const labelsFor = (ctx: CanvasRenderingContext2D, size: Size, pt: number): Labels => {
      const key = `${size.width}x${size.height}|${pt}`;
      if (laidOut?.key !== key) laidOut = { key, value: layoutLabels(ctx, scene, script, teams, ink, size, pt) };
      return laidOut.value;
    };
    /** Each player on screen at t through the camera, for the hit test: his spot and the lens there, no posing. */
    const figuresAt = (f: PitchProjection, t: number): HitFigure[] =>
      script.actors.flatMap((actor, index) => {
        if (!(actor.opacity(t) > 0.01)) return [];
        const lens = RigLens.pitch(f, actor.position(t));
        return [{ index, ground: lens.origin, height: lens.height }];
      });
    const color = accentOf(teams.attacking, ink);
    const statusAt = (t: number): SoccerStatusTag => {
      if (scene) {
        // The headline and the stamp say it for themselves.
        const banner = script.banners.some((b) => t >= b.at - 0.3 && t < b.until + 0.3);
        return banner || t >= script.stamp ? NO_STATUS : SoccerStatus.replay(scene, names);
      }
      return idle ? SoccerStatus.idle(idle, t, names, addedNow) : NO_STATUS;
    };
    const inputs: StageInputs = {
      id: key ?? `idle|${idleKey}`,
      news: key ? news : false,
      // Its course run: its end holds.
      onEnd: (id) => setReplay((r) => (r && r.id === id && !r.done ? { id, done: true } : r)),
      duration: script.duration,
      frozen: scene ? frozen : null,
      reduceMotion,
      momentID: moment?.id ?? null,
      bursts: (height) => (scene ? GoalCelebration.theater(moment, scene, script, level, reduceMotion, height) : []),
      bloom:
        scene && moment
          ? (size) => {
              // The end state: a bloom over the net it went into.
              if (moment.id !== scene.id || !scored(scene) || scene.review === "overturned" || level === "off") return null;
              const cue = cueFor(moment, { level, reduceMotion: true, preset: presetFor(size.height), direction: Math.PI / 2 });
              if (!cue) return null;
              const goal = goalOf(scene);
              const origin = new PitchProjection(size, script.frame(Infinity)).point({ x: goal.x, y: goal.y, z: 1.2 });
              return { cue, origin, palette: teamPalette(color, ink) };
            }
          : null,
      paint: (ctx, size, pt, t, bursts) => {
        const f = new PitchProjection(size, script.frame(t));
        const status = statusAt(t);
        const tags = named.frame(cast, labels, { status: status.tag, flip: true, heartbeat: heartbeatLeading ? "leading" : "trailing" }, () => figuresAt(f, t));
        drawPitch(ctx, f, ink);
        drawSoccerFrame(ctx, f, { scene, script, t, teams, ink, labels: labelsFor(ctx, size, pt), tags });
        if (bursts.length > 0) {
          const palette = teamPalette(color, ink);
          drawBursts(ctx, bursts, t, (p) => f.point(p), TheaterType.bannerOrigin(size, pt), () => palette, size);
        }
        say(status);
      },
    };
    if (scene || !idle) {
      beats.current?.set(null);
      stage.current?.update(inputs);
      return;
    }
    // Between moments: the beat clock says which instant to draw, and wakes for the next beat (or the tag's next change).
    beats.current?.set({
      key: idleKey,
      script,
      changes: SoccerStatus.changes(idle, addedNow),
      still: reduceMotion ? (script.loop?.start ?? script.duration) : null,
      frozen,
      draw: (t) => stage.current?.update({ ...inputs, frozen: t }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, key, news, script, teams, ink, moment, level, reduceMotion, frozen, idleKey, names, addedNow, cast, labels]);

  return (
    <div className={styles.theater}>
      <div ref={well} className={wellStyles.well} data-theater="soccer">
        <canvas ref={canvas} className={wellStyles.canvas} aria-hidden="true" />
        <TheaterStatusTag tag={status.tag} tint={status.tint} height={height} />
        <div className={heartbeatLeading ? styles.heartbeatLeading : styles.heartbeat}>
          <TheaterHeartbeat updated={state.heard ?? null} source="ESPN" />
        </div>
        <TheaterFlipButton surface="pitch" flipped={flipped} onFlip={flip} />
      </div>
      <Caption state={state} />
    </div>
  );
}

/** The latest event's words (or the moment's), under the stage: its minute, then what happened (a space where ESPN ran two sentences together). */
function Caption({ state }: { state: SoccerTheaterState }) {
  const event = (state.events ?? []).findLast((e) => e.order > (state.sceneOrder ?? -1) && e.text !== "");
  const line = event ? { minute: event.minute, text: event.text, id: event.id } : state.scene ? { minute: state.scene.minute, text: state.scene.text, id: state.scene.id } : null;
  if (!line) return <p className={styles.caption}>Every shot, corner, card and stoppage plays here as it happens.</p>;
  return (
    <p key={line.id} className={styles.caption}>
      <span className={styles.minute}>{line.minute}</span>
      {`\u00a0 ${sentences(line.text)}`}
    </p>
  );
}
