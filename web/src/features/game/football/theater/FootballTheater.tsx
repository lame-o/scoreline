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
 * moves); several that arrive together replay in turn, oldest first. Its
 * end holds (the stamp, the ball, the players where it ended) until the
 * next snap or `HOLD_MS`, then crossfades to the field between snaps
 * (footballIdle.ts), so a live game never looks frozen: the huddle, the
 * break and the line-up at the real line, the looks before the snap; a
 * timeout, a TV timeout, the two-minute warning, the end of a quarter (the
 * field turning as the teams change ends), the half, a man down, a
 * challenge, each as ESPN posts it. The field between snaps moves in sparse
 * beats (BeatClock): a requestAnimationFrame loop only through a beat,
 * nothing at all off screen or in a hidden tab, and with Reduce Motion one
 * still moment. The tag at the top says what's happening (EAGLES BALL ·
 * 3RD & 7, FLAG · HOLDING, OFFENSE · 10 YDS, TIMEOUT · EAGLES · 2 LEFT,
 * UNDER REVIEW), the heartbeat at the bottom how long since ESPN spoke, and
 * the control at the top trailing corner turns the field round to match
 * the viewer's TV (remembered for the game; the quarters still turn it).
 * Over the players, their names in the tag's own type (theaterNames.ts):
 * the man with the ball keeps his surname; the pointer names whoever it's
 * over (a tap does on a phone), the credited men by name and number, the
 * rest by team and place (SEAHAWKS · DE), drawn into the frame on the grass
 * under everything that plays.
 * History isn't replayed: on opening the page the field is the live one
 * (`footballShown`). The canvas is decorative for screen readers: the drive
 * chart carries the play. Lazy: the page loads this module only when it
 * shows a field.
 *
 *     <FootballTheater feed={feed} teams={teams} situation={situation} kits={kits} palette={palette} topName="DAL" bottomName="PHI" eventId={event.id} topTeam="Cowboys" bottomTeam="Eagles" />
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Football } from "../../../../data/gameDetail";
import type { FootballFeed, FootballTeams as LaneTeams } from "../../../../data/liveFeeds/football";
import { dress, type TheaterKits } from "../../../../data/mlb/theaterTeams";
import type { Side } from "../../../../data/models";
import { cueFor, presetFor } from "../../../../data/celebrations";
import { NEUTRAL, type Scheme, type TeamPalette } from "../../../../data/teamColors";
import { FieldFacing, footballIdle, FootballStatus, idleScript, sameIdle, type FootballIdle, type StatusNames, type StatusTag } from "../../../../data/theater/footballIdle";
import type { FootballScene, FootballTheaterState } from "../../../../data/theater/footballScene";
import { FootballScript } from "../../../../data/theater/footballScript";
import { DEFAULT_REST, FootballCelebration, footballCast, footballDown, footballShown, FootballTheaterWatch, footballRest, footballWaiting, nextQueued, type FootballBurst } from "../../../../data/theater/footballTheater";
import { theaterLabels } from "../../../../data/theater/theaterNames";
import type { TheaterPerson } from "../../../../data/theater/theaterPeople";
import { HOLD_MS } from "../../../../data/theater/theaterKit";
import { useSettings } from "../../../../state/settings";
import { useColorScheme } from "../../../../state/theme";
import { useChartMoment } from "../../core/moments";
import { BeatClock } from "../../core/theater/beatClock";
import { TheaterStage, type StageInputs } from "../../core/theater/TheaterStage";
import { TheaterFlipButton, TheaterHeartbeat, TheaterStatusTag, useTheaterFlip } from "../../core/theater/TheaterStatus";
import { accentOf, drawBursts, TheaterType, teamPalette, type Size, type StageBurst } from "../../core/theater/theaterKit";
import { useReducedMotion } from "../../core/useMedia";
import { theaterInk } from "../../mlb/theater/theaterInk";
import styles from "../../core/theater/TheaterWell.module.css";
import { useTheaterNames, type NamesPose } from "../../core/theater/useTheaterNames";
import { drawFootballFrame, drawGridiron, GridProjection, hitFigures, layoutLabels, type EndZone, type FootballTeams, type Labels } from "./drawFootball";
import { useSlideField } from "./slideField";

export interface FootballTheaterProps {
  /** The live lane: the theater reads its raw entries itself. Null in previews (`preloaded`). */
  readonly feed: FootballFeed | null;
  /** Who's home and the teams' abbreviations (the lane's teams); null until the first full load says. */
  readonly teams: LaneTeams | null;
  /** The live situation: the spot and line to gain between snaps, the down and distance and the timeouts left for the tag. */
  readonly situation: Football | null;
  /** The teams' own and second colors, so the players always contrast. */
  readonly kits: TheaterKits;
  /** The page's palette: the end zones wear it. */
  readonly palette: TeamPalette;
  readonly topName: string;
  readonly bottomName: string;
  /** The game: the viewer's turn of the field is remembered for it. */
  readonly eventId?: string;
  /** The teams' names for the tag ("Eagles"); their abbreviations if not given. */
  readonly topTeam?: string;
  readonly bottomTeam?: string;
  /** What to show without a live lane (previews and the render harness). */
  readonly preloaded?: FootballTheaterState | null;
  /** Development: draw this instant, frozen (seconds from the start of the replay, or into the field between snaps). */
  readonly frozen?: number | null;
  /** The box score's players, by athlete ID: the names over the credited men. */
  readonly people?: Readonly<Record<string, TheaterPerson>>;
  /** Development (the render harness): the pointer held over a figure or a point. */
  readonly pointer?: NamesPose | null;
}

const EMPTY: FootballTheaterState = { play: null, news: false };
const NO_PEOPLE: Readonly<Record<string, TheaterPerson>> = {};
const NO_STATUS: StatusTag = { tag: null, tint: null };

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
    const changed = this.watch.update(this.feed.items, this.teams, this.primed, Date.now(), this.feed.charts, this.feed.following);
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

/** A team's color for the tag, as hex without the hash (the kit's own, else none). */
const tagColor = (color: string | null | undefined): string | null => (color ? color.replace(/^#/, "") : null);

/** The moment Reduce Motion shows between snaps (FootballStage.still): lined up for the snap; through a stoppage, its own (the benches, the man down, the monitor). */
function still(idle: FootballIdle, script: FootballScript): number {
  switch (idle.phase.kind) {
    case "between":
    case "kickoff":
      return script.loop?.start ?? script.duration;
    case "quarter":
      return 5.5;
    case "off":
      return script.duration;
    default:
      return 12;
  }
}

/** The idle's script, built once per idle (a render for anything else reuses it): its camera track and motion take a few milliseconds. */
function useIdleScript(idle: FootballIdle | null): FootballScript | null {
  const cache = useRef<{ idle: FootballIdle; script: FootballScript } | null>(null);
  if (!idle) return null;
  if (!cache.current || !sameIdle(cache.current.idle, idle)) cache.current = { idle, script: idleScript(idle) };
  return cache.current.script;
}

export default function FootballTheater({
  feed,
  teams: laneTeams,
  situation,
  kits,
  palette,
  topName,
  bottomName,
  eventId = "football",
  topTeam = "",
  bottomTeam = "",
  preloaded = null,
  frozen = null,
  people = NO_PEOPLE,
  pointer,
}: FootballTheaterProps) {
  const well = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<TheaterStage | null>(null);
  // Who the pointer's over (the name over him), read by each frame as it's drawn.
  const tagged = useTheaterNames(well, stage);
  useEffect(() => {
    if (pointer !== undefined) tagged.pose(pointer);
  }, [tagged, pointer]);
  const beats = useRef<BeatClock | null>(null);
  const live = useTheaterState(feed, laneTeams);
  const state = live.play || live.stoppage ? live : (preloaded ?? live);
  const scheme = useColorScheme();
  const level = useSettings((s) => s.celebrationLevel);
  const reduceMotion = useReducedMotion();
  const moment = useChartMoment("field");
  const [flipped, flip] = useTheaterFlip(eventId);
  // The replay begun on the stage (FootballStage.replay): which play, and whether it has run its course;
  // the replay whose end has had its time on screen; and the snaps replayed on this page.
  const [replay, setReplay] = useState<{ readonly id: string; readonly done: boolean } | null>(null);
  const [rested, setRested] = useState<string | null>(null);
  const played = useRef(new Set<string>()).current;
  const replayNow = useRef(replay);
  replayNow.current = replay;
  const clockLive = frozen == null;
  const queueKey = (state.queue ?? []).map((q) => q.id).join(",");

  const start = useCallback(
    (scene: FootballScene) => {
      played.add(scene.id);
      setRested(null);
      setReplay({ id: scene.id, done: false });
    },
    [played],
  );
  // A new snap replays from its snap, after any queued before it that haven't (one already replaying carries on to them);
  // with Reduce Motion each is over at once (its end crossfades in, and holds). History doesn't.
  useEffect(() => {
    const p = state.play;
    if (!clockLive || !state.news || !p) return;
    const queue = state.queue ?? [];
    const r = replayNow.current;
    if (reduceMotion) {
      if (r?.id === p.id) return;
      for (const q of queue) played.add(q.id);
      played.add(p.id);
      setReplay({ id: p.id, done: true });
      return;
    }
    if (r && !r.done) return;
    const waiting = footballWaiting(state, r?.id ?? null, played);
    if (waiting) start(waiting);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.play?.id, queueKey]);
  // A touchdown replayed here is followed by its try, as a short beat of its own: a cut to the try's formation, a breath, the snap.
  useEffect(() => {
    if (!clockLive || reduceMotion || !replay?.done) return;
    const scene = [...(state.queue ?? []), ...(state.play ? [state.play] : [])].find((s) => s.id === replay.id);
    const attempt = scene?.conversion;
    if (!attempt || played.has(attempt.id)) return;
    played.add(attempt.id);
    setReplay({ id: attempt.id, done: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replay, state.play?.conversion?.id]);
  // Done: the next snap waiting replays at once; else its end holds a while (unless the next play comes), then the field returns to the game.
  useEffect(() => {
    if (!replay?.done) return;
    const next = nextQueued(state, replay.id, played);
    if (next) {
      const id = setTimeout(() => start(next), 700);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => setRested(replay.id), HOLD_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replay]);
  /** The play on screen: a replay (or one queued before it), a touchdown's try in its own beat, then its end until it has held; else none (the field between snaps). */
  const shownNow = footballShown(state, replay?.id ?? null, rested, played);
  // A try is made from its touchdown each time it's asked for: one per touchdown, so its script is built once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const play = useMemo(() => shownNow, [shownNow?.id, state.play, queueKey]);
  const replaying = replay != null && play != null && replay.id === play.id;
  const news = replaying ? !replay.done : state.news;
  const following = replaying && play.id.endsWith("-try");

  // The field between snaps, from what the feed says now: the live spot, else the offense at its 25.
  const rest = situation ? footballRest(situation) : null;
  const restOffense: Side | null = rest?.offense ?? null;
  const downDistance = situation?.downDistance ?? null;
  const idle = play
    ? null
    : footballIdle({
        play: state.play,
        stoppage: state.stoppage ?? null,
        rest: rest?.rest ?? DEFAULT_REST,
        offense: restOffense ?? state.play?.offense ?? "top",
        down: footballDown(downDistance),
        kickoff: downDistance === "Kickoff",
        flipped,
      });
  /** Which idle it is: a new stoppage, snap, spot or turn of the field starts it again. */
  const idleKey = `${state.stoppage?.id ?? "-"}|${state.play?.id ?? "-"}|${rest ? rest.rest.yard : "-"}|${restOffense === "bottom"}|${flipped}|${downDistance ?? ""}`;
  const idling = useIdleScript(idle);
  const yaw = play ? FieldFacing.yaw(play.offense, play.period, flipped) : 0;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const replayScript = useMemo(() => (play ? FootballScript.play(play, yaw) : null), [play, yaw]);
  const script = replayScript ?? idling ?? FootballScript.rest(DEFAULT_REST);
  // The scoring slide lands with this replay's climax.
  useSlideField(state, play, script);

  const offense: Side = play?.offense ?? idle?.offense ?? "top";
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
  // Who each figure is (the credited men by name, everyone else by team and place), and each side's tags in the color it wears.
  const cast = useMemo(() => footballCast(script, play, offense, people, play ? `${play.id}|${flipped}` : `idle|${idleKey}`), [script, play, offense, people, idleKey, flipped]);
  const tagLabels = useMemo(
    () => theaterLabels(kits, scheme, { top: topTeam || topName, bottom: bottomTeam || bottomName }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kits.top.color, kits.top.alternate, kits.bottom.color, kits.bottom.alternate, scheme, topTeam, topName, bottomTeam, bottomName],
  );
  const names: StatusNames = useMemo(
    () => ({ top: topTeam || topName, bottom: bottomTeam || bottomName, topColor: tagColor(kits.top.color), bottomColor: tagColor(kits.bottom.color) }),
    [topTeam, topName, bottomTeam, bottomName, kits.top.color, kits.bottom.color],
  );

  // The tag: what's happening at the instant drawn, set only when its words or color change.
  const [status, setStatus] = useState<StatusTag>(NO_STATUS);
  const shownStatus = useRef<StatusTag>(NO_STATUS);
  const say = useCallback((next: StatusTag) => {
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
    // The type, laid out once per size and point (the inputs it depends on are this effect's).
    let labels: { key: string; value: Labels } | null = null;
    const labelsFor = (ctx: CanvasRenderingContext2D, size: Size, pt: number): Labels => {
      const key = `${size.width}x${size.height}|${pt}`;
      if (labels?.key !== key) labels = { key, value: layoutLabels(ctx, play, script, teams, ink, size, pt) };
      return labels.value;
    };
    const color = (side: Side | null) => (side == null || side === play?.offense ? accentOf(teams.offense, ink) : accentOf(teams.defense, ink));
    const statusAt = (t: number): StatusTag => {
      if (play) {
        // The headline says it for itself.
        const banner = script.banner;
        if (banner && t >= banner.at - 0.3 && t < banner.until + 0.3) return NO_STATUS;
        return FootballStatus.replay(play, script, t, names);
      }
      if (!idle) return NO_STATUS;
      return FootballStatus.idle(idle, state.stoppage ?? null, script, t, names, downDistance, { top: situation?.topTimeouts ?? null, bottom: situation?.bottomTimeouts ?? null });
    };
    const inputs: StageInputs = {
      id: play?.id ?? `idle|${idleKey}`,
      news: play ? news : false,
      lead: following ? 0.3 : 0,
      // Its course run: the touchdown's try follows, or its end holds.
      onEnd: (id) => setReplay((r) => (r && r.id === id && !r.done ? { id, done: true } : r)),
      duration: script.duration,
      frozen: play ? frozen : null,
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
              const origin = new GridProjection(size, script.camera.rest, script.yawAt(Infinity)).at(point);
              return { cue, origin, palette: teamPalette(color(play.scorer), ink) };
            }
          : null,
      paint: (ctx, size, pt, t, bursts: readonly StageBurst[]) => {
        const f = new GridProjection(size, script.camera.frame(t), script.yawAt(t));
        const status = statusAt(t);
        const tags = tagged.frame(cast, tagLabels, { status: status.tag, flip: true, heartbeat: "trailing" }, () => hitFigures(f, script, t));
        drawGridiron(ctx, f, ink, zones.near, zones.far);
        drawFootballFrame(ctx, f, { script, t, teams, ink, labels: labelsFor(ctx, size, pt), tags });
        if (bursts.length > 0) {
          drawBursts(ctx, bursts, t, (p) => f.at(p), TheaterType.bannerOrigin(size, pt), (b) => teamPalette(color((b as FootballBurst).side ?? null), ink), size);
        }
        say(status);
      },
    };
    if (play || !idle) {
      beats.current?.set(null);
      stage.current?.update(inputs);
      return;
    }
    // Between snaps: the beat clock says which instant to draw, and wakes for the next beat (or the tag's next change).
    beats.current?.set({
      key: idleKey,
      script,
      changes: FootballStatus.changes(idle, script),
      still: reduceMotion ? still(idle, script) : null,
      frozen,
      draw: (t) => stage.current?.update({ ...inputs, frozen: t }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play, news, following, script, teams, zones, ink, moment, level, reduceMotion, frozen, idleKey, names, downDistance, situation?.topTimeouts, situation?.bottomTimeouts, state.stoppage, cast, tagLabels, tagged]);

  return (
    <div ref={well} className={styles.well} data-theater="football">
      <canvas ref={canvas} className={styles.canvas} aria-hidden="true" />
      <TheaterStatusTag tag={status.tag} tint={status.tint} height={height} />
      <TheaterHeartbeat updated={state.heard ?? null} source="ESPN" />
      <TheaterFlipButton surface="field" flipped={flipped} onFlip={flip} />
    </div>
  );
}
