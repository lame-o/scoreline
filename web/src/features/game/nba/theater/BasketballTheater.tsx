/**
 * The basketball theater (BasketballTheater.swift): in the Shot Chart
 * section, above the court, every play of a live game told on an isometric
 * court as it arrives from the live lane, in order, shot like a broadcast. A
 * basket (a block, a buzzer-beater) replays in full: the camera opens on the
 * half court with both fives set, follows the ball to the man it goes to,
 * frames the shooter and the rim as the shot goes up, and settles on the rim
 * as the stamp lands ("+3 3PT", "BROWN JR. · 23 FT JUMP SHOT", "AST ELLIS");
 * marquee plays get a headline across the top (DUNK, AND-ONE, POSTERIZED,
 * BUZZER-BEATER, REJECTED), a buzzer-beater's confetti off it. Everything
 * else is a lighter beat that carries on from where the court stood
 * (data/theater/basketballBeats.ts): each miss and its rebound, each free
 * throw, each whistle and turnover, the jump balls, substitutions, timeouts,
 * reviews and the ends of periods; between plays the court rests
 * possession-aware, a small beat every few seconds while the game is on. The
 * running order and what the tag says are basketballFlow.ts's.
 *
 * Over the court: the broadcast tag (SPURS BALL, SHOOTING FOUL · HAYES,
 * TIMEOUT · JAZZ, END OF 3RD), the heartbeat ("Live · 4s"), and on hover the
 * control that turns the court round to match the viewer's TV (remembered
 * per game). Names over the players (TheaterNames.swift): the man the play
 * is about keeps his surname; the pointer (a tap on a phone) names whoever
 * it's over, the men ESPN credits by name and number, everyone else by team
 * (`basketballCast`), drawn into the frame under everything that plays. The
 * theater takes the broadcast's ends (`hoopsEnds`: swapped at halftime); the
 * shot chart under it keeps its whole-game convention (the top team at the
 * right basket all game, as its caption says), because it lays every shot of
 * both halves on one court and a team's shots split across both ends would
 * read as two teams.
 *
 * Drawn on one canvas through the camera (TheaterStage, drawBasketball.ts).
 * A requestAnimationFrame loop runs only while something moves: a replay,
 * a beat, the court's opening and each of its sparse beats (each handed to
 * the stage as a short replay of its own), never off screen or in a hidden
 * tab; between them a still. Plays already on the page when it opened
 * aren't told (the live court); with Reduce Motion each play crossfades to
 * how it ended, nothing idles, and the tags still say what's happening. The
 * canvas is decorative for screen readers (the shot chart carries the
 * play); the turn control isn't. It reads the live lane itself (and nothing
 * above it does), so a new play redraws the theater alone. Lazy: the page
 * loads this module only while it's live.
 *
 *     <BasketballTheater feed={feed} teams={teams} kits={kits} palette={palette} topIsHome topName="SA" bottomName="UTAH" topTeam="Spurs" bottomTeam="Jazz" eventId={id} />
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { cueFor, presetFor } from "../../../../data/celebrations";
import type { BasketballFeed, Teams } from "../../../../data/liveFeeds/basketball";
import { dress, type TheaterKits } from "../../../../data/mlb/theaterTeams";
import type { Side } from "../../../../data/models";
import { NEUTRAL, type Scheme, type TeamPalette } from "../../../../data/teamColors";
import { beatScript, endsRight, hoopsEnds, restScript, REST_LENGTH, sameLineup, sameRest, type HoopsEnds, type Lineup, type RestSpec } from "../../../../data/theater/basketballBeats";
import { basketballNext, isMarquee, restAfter, statusBetween, statusDuring, type BasketballUnit, type Said } from "../../../../data/theater/basketballFlow";
import type { BasketballScene, BasketballTheaterState } from "../../../../data/theater/basketballScene";
import { BasketballScript, Hoops } from "../../../../data/theater/basketballScript";
import { basketballBridge, basketballCast, BasketballCelebration, BasketballTheaterWatch, NO_PLAYS, type BasketballBurst } from "../../../../data/theater/basketballTheater";
import type { RigTrack } from "../../../../data/theater/rig";
import { beatLeft, bridgeTracks, type BridgePlan } from "../../../../data/theater/theaterBridge";
import { TheaterDelays } from "../../../../data/theater/theaterDelays";
import { theaterLabels, type HitFigure, type TheaterPerson } from "../../../../data/theater/theaterNames";
import { useSettings } from "../../../../state/settings";
import { useColorScheme } from "../../../../state/theme";
import { useChartMoment } from "../../core/moments";
import { TheaterStage, type StageInputs } from "../../core/theater/TheaterStage";
import { TheaterFlipButton, TheaterHeartbeat, TheaterStatusTag, useTheaterFlip } from "../../core/theater/TheaterStatus";
import { accentOf, drawBursts, TheaterType, teamPalette, type Ctx, type Size, type StageBurst } from "../../core/theater/theaterKit";
import { useTheaterNames, type NamesPose } from "../../core/theater/useTheaterNames";
import styles from "../../core/theater/TheaterWell.module.css";
import { drawLayers } from "../../core/theater/layers";
import { useReducedMotion } from "../../core/useMedia";
import { theaterInk } from "../../mlb/theater/theaterInk";
import { basketballProjection, drawBasketballFrame, drawCourt, HoopProjection, layoutLabels, type BasketballBridge, type BasketballTeams, type Labels, type Paint } from "./drawBasketball";
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
  /** The teams as a tag names them ("SPURS BALL"), when not their codes. */
  readonly topTeam?: string;
  readonly bottomTeam?: string;
  /** The game: the court's turn is remembered for it. */
  readonly eventId?: string;
  /** The period without a lane (the ends swap at halftime). */
  readonly period?: number | null;
  /** What to show without a live lane (previews and the render harness). */
  readonly preloaded?: BasketballTheaterState | null;
  /** Who has the ball between plays when there's no lane. */
  readonly restOffense?: Side | null;
  /** Development: draw this instant, frozen (seconds into the first play that's news, else into the court between plays). */
  readonly frozen?: number | null;
  /** The court's sparse beats between plays: while the game is on (the lane says), or as asked (previews). */
  readonly idle?: boolean | null;
  /** The box score's players, by athlete ID: the names over the credited men. */
  readonly people?: Readonly<Record<string, TheaterPerson>>;
  /** Development (the render harness): the pointer held over a figure or a point. */
  readonly pointer?: NamesPose | null;
  /** Development (the render harness): the tag held as given, in place of what the play says. */
  readonly said?: Said | null;
}

interface Live {
  readonly state: BasketballTheaterState;
  readonly possession: Side | null;
  readonly period: number | null;
  readonly playing: boolean;
}

/** The lane's theater, kept beside it: each change to the lane's plays, read as it happens (BasketballFeed's `theater`). */
class TheaterFollow {
  readonly watch = new BasketballTheaterWatch();
  private snapshot: Live;

  constructor(
    private readonly feed: BasketballFeed,
    private readonly teams: Teams,
  ) {
    this.process();
    this.snapshot = this.read();
  }

  private read(): Live {
    return { state: this.watch.state, possession: this.feed.possession, period: this.feed.period, playing: this.feed.playing };
  }

  private process(): boolean {
    return this.watch.update(this.feed.items, this.teams, this.feed.looks, (id) => this.feed.seenIn(id), Date.now(), this.feed.history);
  }

  /** The theater's state and the lane's say on the game: a new object only when any changes. */
  private refresh(): boolean {
    const changed = this.process();
    const s = this.snapshot;
    if (!changed && s.possession === this.feed.possession && s.period === this.feed.period && s.playing === this.feed.playing) return false;
    this.snapshot = this.read();
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
const NO_PEOPLE: Readonly<Record<string, TheaterPerson>> = {};
const NOTHING: Live = { state: NO_PLAYS, possession: null, period: null, playing: false };

function useTheaterState(feed: BasketballFeed | null, teams: Teams | null): Live {
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

/** What's on screen: a play being told, or the court between plays (from `start`, performance.now() ms). */
type Run =
  | { readonly kind: "unit"; readonly unit: BasketballUnit; readonly from: Lineup | null; readonly fallback: Side | null; readonly serial: number }
  | { readonly kind: "rest"; readonly rest: RestSpec; readonly start: number; readonly serial: number };

/**
 * The hand-off from the court between plays to the replay of `id`
 * (BasketballStage.Bridge): when the play came in (performance.now(), ms),
 * the plan, and the court as it was (its script plays on under the bridge,
 * from `elapsed` seconds in), each traveller's stride.
 */
interface Handoff {
  readonly id: string;
  readonly came: number;
  readonly plan: BridgePlan;
  readonly script: BasketballScript;
  readonly elapsed: number;
  readonly tracks: ReadonlyMap<number, RigTrack>;
}

/** What's been told (or passed over), the last of it, and the stoppage it left (BasketballStage.Told). */
interface Told {
  cursor: string | null;
  ids: Set<string>;
  /** The last play told that wasn't a substitution: the stoppage the tag keeps saying. */
  context: BasketballScene | null;
  /** The court before the last thing told. */
  rest: RestSpec | null;
}

/** The scripts on screen, built once each (a render for anything else reuses them). */
class ScriptCache {
  private unitKey: { unit: BasketballUnit; from: Lineup | null; ends: HoopsEnds; fallback: Side | null } | null = null;
  private unitScript: BasketballScript | null = null;
  private restKey: RestSpec | null = null;
  private restScriptBuilt: BasketballScript | null = null;

  unit(unit: BasketballUnit, from: Lineup | null, ends: HoopsEnds, fallback: Side | null): BasketballScript {
    const k = this.unitKey;
    if (
      !this.unitScript ||
      !k ||
      k.unit !== unit ||
      !sameLineup(k.from, from) ||
      k.ends.topRight !== ends.topRight ||
      k.ends.topOpensRight !== ends.topOpensRight ||
      k.fallback !== fallback
    ) {
      this.unitKey = { unit, from, ends, fallback };
      this.unitScript = isMarquee(unit) ? BasketballScript.play(unit.scene, endsRight(ends, unit.scene.offense)) : beatScript(unit.scene, unit.group, ends, from, fallback);
    }
    return this.unitScript;
  }

  rest(rest: RestSpec): BasketballScript {
    if (!this.restScriptBuilt || !sameRest(this.restKey, rest)) {
      this.restKey = rest;
      this.restScriptBuilt = restScript(rest);
    }
    return this.restScriptBuilt;
  }
}

/** Seconds a told play's end stays up to be read before what's next (a replay's stamp longer; less when more is waiting). */
const readFor = (marquee: boolean, pending: boolean) => (marquee ? (pending ? 0.9 : 1.6) : pending ? 0.2 : 0.45);

export default function BasketballTheater({
  feed,
  teams: laneTeams,
  kits,
  palette,
  topIsHome,
  topName,
  bottomName,
  topTeam = "",
  bottomTeam = "",
  eventId = "",
  period = null,
  preloaded = null,
  restOffense = null,
  frozen = null,
  idle = null,
  people = NO_PEOPLE,
  pointer,
  said: heldSaid,
}: BasketballTheaterProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const well = useRef<HTMLDivElement>(null);
  const stage = useRef<TheaterStage | null>(null);
  const live = useTheaterState(feed, laneTeams);
  const state = live.state.plays.length > 0 ? live.state : (preloaded ?? live.state);
  const possession = feed ? live.possession : restOffense;
  const gamePeriod = feed ? live.period : period;
  const ambient = idle ?? (feed != null && live.playing);
  const scheme = useColorScheme();
  const level = useSettings((s) => s.celebrationLevel);
  const reduceMotion = useReducedMotion();
  const moment = useChartMoment("court");
  const nameTags = useTheaterNames(well, stage);
  useEffect(() => {
    if (pointer !== undefined) nameTags.pose(pointer);
  }, [nameTags, pointer]);
  const [flipped, flip] = useTheaterFlip(eventId);
  const names = useMemo(() => ({ top: topTeam || topName, bottom: bottomTeam || bottomName }), [topTeam, topName, bottomTeam, bottomName]);
  const ends = useCallback((p: number | null | undefined) => hoopsEnds(p ?? gamePeriod, topIsHome, flipped), [gamePeriod, topIsHome, flipped]);
  const [height, setHeight] = useState(0);
  const [said, setSaid] = useState<Said | null>(null);

  // The running order (BasketballStage's showing, resting and told).
  const cache = useRef(new ScriptCache());
  const told = useRef<Told>({ cursor: null, ids: new Set(), context: null, rest: null });
  const [run, setRun] = useState<Run | null>(null);
  const runRef = useRef<Run | null>(null);
  runRef.current = run;
  // The court between plays a replay is taking over from, while the hand-off runs.
  const handoff = useRef<Handoff | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const serial = useRef(0);

  const restPeriod = () => told.current.context?.period ?? stateRef.current.plays.at(-1)?.period ?? gamePeriod;
  const scriptOf = (r: Run): BasketballScript =>
    r.kind === "unit" ? cache.current.unit(r.unit, r.from, ends(r.unit.scene.period), r.fallback) : cache.current.rest({ ...r.rest, ends: ends(restPeriod()) });
  const historyRest = (): RestSpec => {
    const plays = stateRef.current.plays;
    let last: BasketballScene | null = null;
    for (let i = plays.length - 1; i >= 0; i--) {
      if (plays[i]!.kind !== "substitution") {
        last = plays[i]!;
        break;
      }
    }
    return restAfter(last, null, null, ends(plays.at(-1)?.period), possession);
  };

  /** Where everyone is now on screen: what the next beat starts from. */
  const lineupNow = (): Lineup | null => {
    const r = runRef.current;
    if (!r) return null;
    const s = scriptOf(r);
    if (r.kind === "unit") return s.lineup(s.duration);
    return s.lineup(Math.min((performance.now() - r.start) / 1000, s.duration));
  };

  /** The next thing to tell, or the court the last one left. */
  const advance = () => {
    if (frozen != null) return;
    const r = runRef.current;
    const from = lineupNow();
    const unit = basketballNext(told.current.cursor, told.current.ids, stateRef.current);
    serial.current += 1;
    if (unit) {
      const t = told.current;
      t.cursor = unit.scene.id;
      for (const id of [unit.scene.id, ...unit.covers]) t.ids.add(id);
      if (t.ids.size > 400) t.ids = new Set(stateRef.current.plays.map((p) => p.id).filter((id) => t.ids.has(id)));
      if (unit.scene.kind !== "substitution") t.context = unit.scene;
      if (r?.kind === "rest") t.rest = r.rest;
      const fallback = r?.kind === "rest" ? r.rest.offense : r ? scriptOf(r).side : possession;
      const next: Run = { kind: "unit", unit, from: isMarquee(unit) ? null : from, fallback, serial: serial.current };
      // A replay that comes in while the court rests takes over from it, from where everyone is (theaterBridge.ts).
      handoff.current = null;
      if (isMarquee(unit) && r?.kind === "rest" && !reduceMotion) {
        const rest = scriptOf(r);
        const came = performance.now();
        const elapsed = (came - r.start) / 1000;
        const replay = scriptOf(next);
        const plan = basketballBridge(rest, elapsed, replay, reduceMotion, beatLeft(rest.active, elapsed));
        const tracks = bridgeTracks(
          plan,
          Hoops.ground,
          (j, s) => ({ at: rest.players[j]!.position(elapsed + s), heading: rest.rig[j]?.motion(elapsed + s).heading ?? 0 }),
          (i, s) => {
            const u = Math.max(plan.replayTime(s), 0);
            return { at: replay.players[i]!.position(u), heading: replay.rig[i]?.motion(u).heading ?? 0 };
          },
        );
        handoff.current = { id: unit.scene.id, came, plan, script: rest, elapsed, tracks };
        TheaterDelays.note(unit.scene.id, plan.delay);
      }
      runRef.current = next;
      setRun(next);
      return;
    }
    if (r && r.kind === "rest") return;
    let last: BasketballScene | null = r?.kind === "unit" ? r.unit.scene : null;
    if (!last) {
      const plays = stateRef.current.plays;
      for (let i = plays.length - 1; i >= 0; i--) {
        if (plays[i]!.kind !== "substitution") {
          last = plays[i]!;
          break;
        }
      }
    }
    const next: Run = { kind: "rest", rest: restAfter(last, told.current.rest, from, ends(last?.period), possession), start: performance.now(), serial: serial.current };
    runRef.current = next;
    setRun(next);
  };
  const advanceRef = useRef(advance);
  advanceRef.current = advance;

  // A new play while the court rests: tell it.
  useEffect(() => {
    if (runRef.current?.kind !== "unit") advanceRef.current();
  }, [state]);

  // Each play told: its length, then a beat to read its end, then what's next.
  useEffect(() => {
    if (!run || run.kind !== "unit" || frozen != null || !reduceMotion) return;
    // With Reduce Motion there's no replay: its end shows at once and holds a moment.
    const s = scriptOf(run);
    const pending = basketballNext(told.current.cursor, told.current.ids, stateRef.current) != null;
    const id = setTimeout(() => advanceRef.current(), (Math.min(s.duration, 2.4) + readFor(isMarquee(run.unit), pending)) * 1000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, reduceMotion, frozen]);
  const ended = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onEnd = useCallback(() => {
    const r = runRef.current;
    if (!r || r.kind !== "unit") return;
    const pending = basketballNext(told.current.cursor, told.current.ids, stateRef.current) != null;
    if (ended.current) clearTimeout(ended.current);
    const serialNow = r.serial;
    ended.current = setTimeout(() => {
      if (runRef.current?.serial === serialNow) advanceRef.current();
    }, readFor(isMarquee(r.unit), pending) * 1000);
  }, []);
  useEffect(() => () => {
    if (ended.current) clearTimeout(ended.current);
  }, []);

  // The court between plays: each sparse beat handed to the stage as a short replay of its own, still in between; when it runs out, it goes on as a new one.
  const [spanAt, setSpanAt] = useState<{ readonly serial: number; readonly index: number } | null>(null);
  useEffect(() => {
    setSpanAt(null);
    if (!run || run.kind !== "rest" || frozen != null) return;
    const s = scriptOf(run);
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (!reduceMotion) {
      s.active.forEach(([from], index) => {
        // The opening always runs; the small beats only while the game is on.
        if (index > 0 && !ambient) return;
        const wait = run.start + from * 1000 - performance.now();
        if (wait <= 0 && index > 0) return;
        timers.push(setTimeout(() => setSpanAt({ serial: run.serial, index }), Math.max(wait, 0)));
      });
    }
    if (ambient && s.duration >= REST_LENGTH) {
      timers.push(
        setTimeout(
          () => {
            if (runRef.current?.serial !== run.serial) return;
            serial.current += 1;
            const next: RestSpec = { ...run.rest, from: s.lineup(s.duration), round: run.rest.round + 1, phase: run.rest.phase === "inboundBaseline" || run.rest.phase === "inboundSideline" ? "live" : run.rest.phase };
            setRun({ kind: "rest", rest: next, start: performance.now(), serial: serial.current });
          },
          Math.max(run.start + s.duration * 1000 - performance.now(), 0),
        ),
      );
    }
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, reduceMotion, frozen, ambient]);

  // What's on screen: on the harness's frozen clock, the first news there is (else the court the plays left); otherwise the run (before the first: the court as it stands).
  const frozenUnit = useMemo(() => (frozen != null ? basketballNext(null, new Set(), state) : null), [frozen, state]);
  const shown: Run = useMemo(() => {
    if (frozen != null) return frozenUnit ? { kind: "unit", unit: frozenUnit, from: null, fallback: possession, serial: -1 } : { kind: "rest", rest: historyRest(), start: 0, serial: -1 };
    return run ?? { kind: "rest", rest: historyRest(), start: performance.now(), serial: 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frozen, frozenUnit, run, state, possession, flipped]);
  const script = scriptOf(shown);
  const unit = shown.kind === "unit" ? shown.unit : null;
  const play = unit?.scene ?? null;
  const marquee = unit != null && isMarquee(unit);

  // The scoring slide lands with this replay's climax.
  useSlideCourt(marquee ? play : null, marquee ? script : null);
  const dressed = useMemo(
    () => dress(kits, scheme),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kits.top.color, kits.top.alternate, kits.bottom.color, kits.bottom.alternate, scheme],
  );
  const offense: Side = script.side ?? possession ?? "top";
  // Each side's look with the ball (the court a replay takes over from may have the other's).
  const teamsBy = useMemo((): Record<Side, BasketballTeams> => ({ top: { offense: dressed.top, defense: dressed.bottom }, bottom: { offense: dressed.bottom, defense: dressed.top } }), [dressed]);
  const teams = teamsBy[offense];
  // The paint in the home team's color, its name at center court.
  const paint: Paint = useMemo(
    () => ({ color: solid(topIsHome ? palette.top : palette.bottom, scheme), name: (topIsHome ? topName : bottomName).toUpperCase(), three: Hoops.three }),
    [topIsHome, palette.top, palette.bottom, scheme, topName, bottomName],
  );
  const ink = useMemo(() => theaterInk(scheme), [scheme]);
  // Who each figure on screen is (the names over the court), once per script; each side's tags in the color it wears.
  const castScope = `${unit ? unit.scene.id : `rest-${shown.serial}`}|${flipped}`;
  const cast = useMemo(() => basketballCast(script, play, people, castScope), [script, play, people, castScope]);
  const tagLabels = useMemo(
    () => theaterLabels(kits, scheme, names),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kits.top.color, kits.top.alternate, kits.bottom.color, kits.bottom.alternate, scheme, names],
  );
  const heartbeat = (feed ? live.playing : true) && state.heard != null;

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
    const el = well.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => setHeight(entries[0]?.contentRect.height ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    // The type, laid out once per size and point (the inputs it depends on are this effect's).
    let labels: { key: string; value: Labels } | null = null;
    const labelsFor = (ctx: CanvasRenderingContext2D, size: Size, pt: number): Labels => {
      const key = `${size.width}x${size.height}|${pt}`;
      if (labels?.key !== key) labels = { key, value: layoutLabels(ctx, play, script, teams, ink, size, pt) };
      return labels.value;
    };
    const color = (side: Side | null) => (side == null || side === script.side ? accentOf(teams.offense, ink) : accentOf(teams.defense, ink));
    // The script's own time for the stage's t: a told play's own; the court's, from its start (its window's while one runs).
    const rest = shown.kind === "rest" ? shown : null;
    // Its opening runs from the start (and its beats as their times come).
    const opening = rest && frozen == null && !reduceMotion && (script.active[0]?.[0] ?? 1) <= 0 ? 0 : null;
    const windowIndex = rest && spanAt?.serial === rest.serial ? spanAt.index : opening;
    const span = windowIndex != null ? script.active[windowIndex] : null;
    const timeOf = (t: number): number => {
      if (frozen != null) return frozen;
      if (!rest) return t;
      if (reduceMotion) return script.active[0]?.[1] ?? 0;
      if (span && Number.isFinite(t)) return span[0] + t;
      return Math.min(Math.max((performance.now() - rest.start) / 1000, 0), script.duration);
    };
    let lastSaid: string | null | undefined = undefined;
    const statusAt = (t: number): Said | null =>
      unit ? statusDuring(unit, script, t, names) : statusBetween(frozen == null ? (told.current.context ?? lastNonSub(state)) : lastNonSub(state), rest?.rest ?? null, names);
    const report = (next: Said | null) => {
      const key = next ? `${next.text}|${next.side ?? ""}` : null;
      if (key === lastSaid) return;
      lastSaid = key;
      setSaid(next);
    };
    // Taking over from the court between plays: the men travel (the frame blends), or the court fades out over the replay's set.
    const hand = unit && handoff.current?.id === unit.scene.id ? handoff.current : null;
    const inputs: StageInputs = {
      // A told play is a replay of its own, by its ID (the moment's, for Reduce Motion's bloom); so is each of the court's beats (the same
      // floor: it carries on, never a crossfade). The court turned round between plays crossfades to its other side.
      id: unit ? unit.scene.id : `rest-${shown.serial}${flipped ? "-turned" : ""}-${windowIndex ?? "still"}`,
      news: unit != null ? frozen == null : windowIndex != null,
      lead: hand?.plan.delay ?? 0,
      came: hand?.came ?? null,
      onEnd: unit ? onEnd : undefined,
      duration: span ? span[1] - span[0] : script.duration,
      frozen: frozen != null ? frozen : null,
      reduceMotion,
      momentID: moment?.id ?? null,
      bursts: (h) => (play && marquee ? BasketballCelebration.theater(moment, play, script, level, reduceMotion, h) : []),
      bloom:
        play && marquee && moment
          ? (size) => {
              // With Reduce Motion there's no replay: a basket that celebrates blooms at the rim, as the play's end shows.
              if (moment.id !== play.id || BasketballCelebration.theater(moment, play, script, level, true, size.height).length === 0) return null;
              const cue = cueFor(moment, { level, reduceMotion: true, preset: presetFor(size.height), direction: -Math.PI / 2 });
              if (!cue) return null;
              const origin = new HoopProjection(size, script.camera.rest, script.yaw).at(RIM);
              return { cue, origin, palette: teamPalette(color(play.offense), ink) };
            }
          : null,
      paint: (ctx, size, pt, t, bursts: readonly StageBurst[], since) => {
        const at = timeOf(t);
        const live = hand && since < hand.plan.end ? hand : null;
        const w = live ? live.plan.weight(since) : 1;
        const restT = live ? live.elapsed + since : 0;
        const bridge: BasketballBridge | null = live && live.plan.mode === "bridge" ? { script: live.script, t: restT, w, s: since, pairs: live.plan.pairs, tracks: live.tracks } : null;
        const h = basketballProjection(size, script, at, bridge);
        const saying = heldSaid !== undefined ? heldSaid : statusAt(at);
        // The names: the pointer's man hit-tested on this frame's players (each one's spot at t through the camera, no posing).
        const hits = (): HitFigure[] =>
          script.players.flatMap((player, index) => {
            if (!(player.opacity(at) > 0.01)) return [];
            const lens = h.lens(player.position(at));
            return [{ index, ground: lens.origin, height: lens.height }];
          });
        const tags = nameTags.frame(cast, tagLabels, { status: saying?.text ?? null, flip: eventId !== "", heartbeat: heartbeat ? "trailing" : null }, hits);
        const frame = (c: Ctx) => {
          drawCourt(c, h, ink, paint);
          drawBasketballFrame(c, h, { script, t: at, teams, ink, labels: labelsFor(c, size, pt), tags, bridge });
          if (bursts.length > 0) {
            drawBursts(c, bursts, t, (p) => h.at(p), TheaterType.bannerOrigin(size, pt), (b) => teamPalette(color((b as BasketballBurst).side ?? null), ink), size);
          }
        };
        if (live && live.plan.mode === "crossfade") {
          // A crossfade: the two frames each partly there.
          const court = live.script;
          const g = new HoopProjection(size, court.camera.frame(restT), court.yaw);
          const courtTeams = teamsBy[court.side ?? "top"];
          drawLayers(ctx, [
            [w, frame],
            [
              1 - w,
              (c) => {
                drawCourt(c, g, ink, paint);
                drawBasketballFrame(c, g, { script: court, t: restT, teams: courtTeams, ink, labels: layoutLabels(c, null, court, courtTeams, ink, size, pt) });
              },
            ],
          ]);
        } else {
          frame(ctx);
        }
        report(saying);
      },
    };
    stage.current?.update(inputs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, spanAt, script, teams, teamsBy, paint, ink, moment, level, reduceMotion, frozen, names, flipped, cast, tagLabels, heartbeat, eventId, heldSaid]);

  return (
    <div ref={well} className={styles.well} data-theater="basketball">
      <canvas ref={canvas} className={styles.canvas} aria-hidden="true" />
      <TheaterStatusTag tag={said?.text ?? null} tint={said?.side ? (said.side === "top" ? (kits.top.color ?? null) : (kits.bottom.color ?? null)) : null} height={height} />
      {feed ? (live.playing ? <TheaterHeartbeat updated={state.heard} source="ESPN" /> : null) : <TheaterHeartbeat updated={state.heard} source="ESPN" />}
      {eventId ? <TheaterFlipButton surface="court" flipped={flipped} onFlip={flip} /> : null}
    </div>
  );
}

/** The newest play that wasn't a substitution (the stoppage the game is in, before anything's been told). */
function lastNonSub(state: BasketballTheaterState): BasketballScene | null {
  for (let i = state.plays.length - 1; i >= 0; i--) if (state.plays[i]!.kind !== "substitution") return state.plays[i]!;
  return null;
}
