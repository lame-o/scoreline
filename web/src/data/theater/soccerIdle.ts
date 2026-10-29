/**
 * What the soccer theater shows between its big moments (SoccerIdle.swift),
 * so a live match never looks frozen: every event ESPN logs gets its beat,
 * and between them the ball goes round. A corner: the taker jogs to the flag
 * on the side it went out, the box fills, each man picked up. A foul: the
 * man fouled down, the referee in, then the free kick set up at the real
 * spot (a wall when it's in range). Offside: the assistant's flag up level
 * with the man. A booking: the referee's card up to the real player where
 * his foul was; a red, and he walks. A substitution: the man coming off to
 * the halfway line, the board up, the man coming on. A man hurt: down, the
 * physios on. A VAR check, its decision; half time and full time, off to
 * the tunnel; the second half's kick-off with the ends changed. Otherwise
 * the team on the ball (the last event's) passes it round in its formation
 * from the lineups, the other team shifting with it, a pass every few
 * seconds.
 *
 * Each is a script like a moment's (soccerScript.ts), a pure function of
 * what the feed said and t, in sparse beats: a second or two of motion,
 * then still, round a loop. Where the data is silent (who takes the corner,
 * who the ball goes to), the choices are seeded from the event's ID with the
 * Mac's own generator (SplitMix64, bit for bit): never the same twice, the
 * same every time, and the same as on the Mac.
 *
 *     const idle = soccerIdle({ event, touch, scene, period, lineups, flipped: false });
 *     const script = soccerIdleScript(idle); script.idleTime(elapsed);
 */
import { at, num, type JSONValue } from "../json";
import { CameraFrame } from "../mlb/playCamera";
import { fieldPoint, type Point } from "../mlb/theaterField";
import type { Side } from "../models";
import type { PitchScale } from "../liveFeeds/soccer";
import { credit, minute, name, place, Pitch, playID, SoccerLineup, surname, teamID, type LineupPlayer, type Lineups, type SoccerScene, type SoccerTheaterState } from "./soccerScene";
import { string } from "./soccerEntries";
import { Actor, Flight, PitchCamera, room, SoccerScript, type Role, type Team } from "./soccerScript";
import { CameraFollow } from "./theaterKit";
import { seed64, SplitMix64 } from "./splitMix64";

// MARK: - Events

/** What an event is (SoccerEvent.Kind). */
export type SoccerEventKind =
  | { readonly type: "corner" | "foul" | "handball" | "offside" | "substitution" | "injury" | "delay" | "varCheck" | "resume" | "kickoff" | "halftime" | "secondHalf" | "fullTime" }
  /** A booking; `second`: a second yellow. */
  | { readonly type: "card"; readonly red: boolean; readonly second: boolean }
  /** VAR's word ("Penalty Valencia", "No Goal", "Card upgraded"). */
  | { readonly type: "varDecision"; readonly words: string };

/**
 * An event that isn't a shot: a corner, a foul, an offside, a booking, a
 * substitution, a stoppage, the halves; from ESPN's core plays (each with
 * its team, its man and, mostly, where it happened).
 */
export interface SoccerEvent {
  readonly id: string;
  readonly kind: SoccerEventKind;
  /** Whose it is: the team awarded the corner, the team that fouled, the man's team. */
  readonly side: Side | null;
  /** The man: the fouler, the man booked or offside, the man coming on, the man hurt. */
  readonly player: string | null;
  readonly athlete: string | null;
  /** The other man: the one fouled, the one going off. */
  readonly other: string | null;
  readonly otherAthlete: string | null;
  /** Where, in metres on the pitch (home attacking right, as a scene's). */
  readonly at: Point | null;
  /** A foul in the box: a penalty. */
  readonly penalty: boolean;
  readonly minute: string;
  readonly clock: number;
  readonly period: number | null;
  readonly text: string;
  /** Epoch ms. */
  readonly wallclock: number | null;
  /** The feed's order: later is newer. */
  readonly order: number;
}

const typeOf = (item: JSONValue): string => string(at(item, "type", "type")) ?? "";
const intOf = (v: JSONValue): number | null => {
  const n = num(v);
  return n != null && Number.isInteger(n) ? n : null;
};
const dateOf = (item: JSONValue): number | null => {
  const ms = Date.parse(string(at(item, "wallclock")) ?? "");
  return Number.isFinite(ms) ? ms : null;
};

/** VAR's decision in a few words: "Penalty Valencia", "No Goal", "Card upgraded". (SoccerEvent.decision; pure; tested) */
export function decision(text: string): string | null {
  const i = text.indexOf("VAR Decision: ");
  if (i < 0) return null;
  const words = text.slice(i + "VAR Decision: ".length).replace(/^[. ]+|[. ]+$/g, "");
  const first = (n: number) => words.split(" ").filter((w) => w !== "").slice(0, n).join(" ");
  for (const phrase of ["No Goal", "Goal", "No Penalty", "Penalty", "Card upgraded", "Card downgraded", "No Red Card", "Red Card", "No Offside", "Offside"]) {
    if (!words.toLowerCase().startsWith(phrase.toLowerCase())) continue;
    // A penalty says for whom ("Penalty Valencia"); the rest are the call alone.
    return phrase === "Penalty" ? first(3) : phrase;
  }
  return first(3);
}

/**
 * The entry at `index` as an event, with the plays before it (a booking's
 * foul); null for anything else (a pass, a shot). (SoccerEvent.parse; pure; tested)
 */
export function parseEvent(plays: readonly JSONValue[], index: number, homeTeamID: string | null, order = 0, scale: PitchScale = "percent"): SoccerEvent | null {
  const item = plays[index];
  const id = item === undefined ? null : playID(item);
  if (id == null) return null;
  const type = typeOf(item);
  const text = string(at(item, "text")) ?? "";
  let kind: SoccerEventKind;
  switch (type) {
    case "corner-awarded":
      kind = { type: "corner" };
      break;
    case "foul":
      kind = { type: "foul" };
      break;
    case "handball":
      kind = { type: "handball" };
      break;
    case "offside":
      kind = { type: "offside" };
      break;
    case "yellow-card":
      kind = { type: "card", red: false, second: false };
      break;
    case "red-card":
      kind = { type: "card", red: true, second: text.toLowerCase().includes("second yellow") };
      break;
    case "substitution":
      kind = { type: "substitution" };
      break;
    case "start-delay":
      // ESPN logs a delay twice; only one says why.
      if (text === "") return null;
      kind = { type: text.includes("VAR") ? "varCheck" : text.includes("injury") ? "injury" : "delay" };
      break;
    case "end-delay":
      if (text === "") return null;
      kind = { type: "resume" };
      break;
    case "kickoff":
      kind = { type: "kickoff" };
      break;
    case "halftime":
      kind = { type: "halftime" };
      break;
    case "start-2nd-half":
      kind = { type: "secondHalf" };
      break;
    case "end-regular-time":
      kind = { type: "fullTime" };
      break;
    default: {
      const words = type.startsWith("var---") ? decision(text) : null;
      if (words == null) return null;
      kind = { type: "varDecision", words };
    }
  }
  const team = teamID(item);
  const c = credit(item);
  let player: string | null = null;
  let other: string | null = null;
  let otherAthlete: string | null = null;
  let spot = place(item, "fieldPositionX", "fieldPositionY", homeTeamID, scale);
  let penalty = false;
  switch (kind.type) {
    case "foul": {
      player = name(item);
      // "Johan Manzambi (Aston Villa) wins a free kick on the left wing.": the man fouled.
      const wins = /^([^(]+?) \([^)]*\) (?:wins|draws)/.exec(text);
      if (wins) other = wins[1]!;
      const by = /^Foul by ([^(]+?) \(/.exec(text);
      if (by) player = by[1]!;
      penalty = text.includes("penalty area");
      // "Penalty Hull City. Tim Iroegbunam draws a foul in the penalty area.": the man fouled.
      const drawn = /^Penalty .+?\. ([^.]+?) draws a foul/.exec(text);
      if (drawn) other = drawn[1]!;
      break;
    }
    case "handball":
      player = /^Handball by ([^(]+?) \(/.exec(text)?.[1] ?? name(item);
      break;
    case "offside":
      player = /\. (.+?) is caught offside/.exec(text)?.[1] ?? name(item);
      break;
    case "card": {
      player = /^(?:Second yellow card to )?([^(]+?) \(/.exec(text)?.[1] ?? name(item);
      // Booked where his foul was: the foul (or handball) just before by the same man.
      for (let i = index - 1; i >= Math.max(index - 12, 0); i--) {
        const foul = plays[i];
        if (!["foul", "handball"].includes(typeOf(foul))) continue;
        const same = c != null && credit(foul)?.athlete === c.athlete;
        const named = player != null && ((string(at(foul, "text")) ?? "").includes(player) || (string(at(foul, "shortText")) ?? "").startsWith(player));
        if (same || named) {
          spot = place(foul, "fieldPositionX", "fieldPositionY", homeTeamID, scale);
          break;
        }
      }
      break;
    }
    case "substitution": {
      // "Substitution, Manchester City. Rico Lewis replaces Marc Guéhi."
      const m = /\. (.+?) replaces (.+?)(?: because of an injury)?\.$/.exec(text);
      if (m) {
        player = m[1]!;
        other = m[2]!;
      }
      otherAthlete = credit(item, 1)?.athlete ?? null;
      break;
    }
    case "injury":
      player = /injury (.+?) \(/.exec(text)?.[1] ?? null;
      break;
    default:
      break;
  }
  return {
    id,
    kind,
    side: team == null ? null : team === homeTeamID ? "top" : "bottom",
    player,
    athlete: c?.athlete ?? null,
    other,
    otherAthlete,
    at: spot,
    penalty,
    minute: minute(string(at(item, "clock", "displayValue")) ?? ""),
    clock: num(at(item, "clock", "value")) ?? 0,
    period: intOf(at(item, "period", "number")),
    text,
    wallclock: dateOf(item),
    order,
  };
}

/** The man as the tag names him: his surname. */
export const eventSurname = (e: SoccerEvent): string | null => (e.player != null ? surname(e.player) : null);

/** The last thing that happened on the ball: whose it is now, and where (SoccerTouch). */
export interface SoccerTouch {
  readonly side: Side;
  readonly at: Point;
  readonly order: number;
  readonly period: number | null;
  /** Match clock, in seconds: whether the half's added time is being played. */
  readonly clock: number;
}

const LOST: ReadonlySet<string> = new Set(["out", "foul", "offside", "handball", "foul-throw-in", "dispossessed"]);

/** A located entry as the ball's whereabouts: the team on it (after a foul, the ball out, an offside: the other one). (SoccerTouch.parse; pure; tested) */
export function parseTouch(item: JSONValue, homeTeamID: string | null, order: number, scale: PitchScale = "percent"): SoccerTouch | null {
  const team = teamID(item);
  const spot = place(item, "fieldPositionX", "fieldPositionY", homeTeamID, scale);
  if (team == null || !spot) return null;
  const side: Side = team === homeTeamID ? "top" : "bottom";
  const lost = LOST.has(typeOf(item));
  return {
    side: lost ? (side === "top" ? "bottom" : "top") : side,
    at: { x: Math.min(Math.max(spot.x, 0.5), Pitch.length - 0.5), y: Math.min(Math.max(spot.y, 0.5), Pitch.width - 0.5) },
    order,
    period: intOf(at(item, "period", "number")),
    clock: num(at(item, "clock", "value")) ?? 0,
  };
}

/** The added minutes, while they're being played: from the 45th (90th, 105th, 120th) minute of their half on. (SoccerAddedTime.showing; pure; tested) */
export function addedShowing(added: { readonly minutes: number; readonly half: number } | null, period: number | null, clock: number): number | null {
  if (!added || period !== added.half || !(added.minutes > 0)) return null;
  return clock >= [45, 90, 105, 120][Math.min(Math.max(added.half, 1), 4) - 1]! * 60 ? added.minutes : null;
}

// MARK: - Which way the pitch faces

/**
 * Which end each team attacks on the viewer's screen (PitchFacing): home to
 * the right in the first half, as the Live Pitch draws it, the teams
 * changing ends at half time (extra time's halves as the match's); the
 * viewer's turn swaps them for the game. (pure; tested)
 */
export const PitchFacing = {
  homeAttacksRight(period: number | null | undefined, flipped: boolean): boolean {
    return ((period ?? 1) % 2 === 1) !== flipped;
  },

  /** A point on the pitch turned round (the other end, the other touchline). */
  turned(p: Point): Point {
    return { x: Pitch.length - p.x, y: Pitch.width - p.y };
  },
};

/** The moment as drawn with the ends changed: every place turned round, its team attacking the other way. (SoccerScene.turned; pure; tested) */
export function turnedScene(scene: SoccerScene): SoccerScene {
  const t = PitchFacing.turned;
  return {
    ...scene,
    touches: scene.touches.map((touch) => ({ ...touch, at: t(touch.at), to: touch.to ? t(touch.to) : null })),
    shot: { ...scene.shot, from: t(scene.shot.from), stopped: scene.shot.stopped ? t(scene.shot.stopped) : null, mouth: scene.shot.mouth ? { y: Pitch.width - scene.shot.mouth.y, z: scene.shot.mouth.z } : null },
    keeper: { ...scene.keeper, at: scene.keeper.at ? t(scene.keeper.at) : null },
    blocker: scene.blocker ? { ...scene.blocker, at: scene.blocker.at ? t(scene.blocker.at) : null } : null,
    keeperActions: scene.keeperActions.map((a) => ({ ...a, at: t(a.at), to: a.to ? t(a.to) : null })),
    rebound: scene.rebound ? t(scene.rebound) : null,
    turnedRound: !(scene.turnedRound === true),
  };
}

// MARK: - Idle

/** What the pitch does now, between big moments (SoccerIdle). */
export interface SoccerIdle {
  /** The team on the ball passes it round (null), or an event's beat. */
  readonly event: SoccerEvent | null;
  /** The team on the ball (`attacking` in the script). */
  readonly possession: Side;
  /** Where the ball is, as drawn. */
  readonly ball: Point;
  /** Whether home attacks right, as drawn (the half, the viewer's turn). */
  readonly homeRight: boolean;
  readonly lineups: Lineups;
  readonly seed: bigint;
}

/** Whether the team on the ball attacks right, as drawn. */
export const idleRight = (idle: SoccerIdle): boolean => (idle.possession === "top") === idle.homeRight;

export interface SoccerIdleInputs {
  readonly event: SoccerEvent | null;
  readonly touch: SoccerTouch | null;
  readonly scene: SoccerScene | null;
  readonly period: number | null;
  readonly lineups: Lineups;
  readonly flipped: boolean;
}

/**
 * What the pitch does after the last moment and what came since (SoccerIdle.make):
 * the event showing (or the newest that still holds play up: a corner
 * waiting to be taken, a man down, a check, the half), else the ball going
 * round for the team that had it last. (pure; tested)
 */
export function soccerIdle({ event, touch, scene, period: given, lineups, flipped }: SoccerIdleInputs): SoccerIdle {
  const period = event?.period ?? touch?.period ?? scene?.period ?? given;
  const homeRight = PitchFacing.homeAttacksRight(event?.kind.type === "secondHalf" ? 2 : period, flipped);
  const drawn = (p: Point) => (homeRight ? p : PitchFacing.turned(p));
  let possession: Side = touch?.side ?? scene?.side ?? "top";
  let ball = touch ? drawn(touch.at) : scene ? drawn(scene.shot.from) : Pitch.center;
  if (event) {
    switch (event.kind.type) {
      // The team awarded it: a foul's, a handball's, an offside's other team.
      case "foul":
      case "handball":
      case "offside":
        possession = event.side ? (event.side === "top" ? "bottom" : "top") : possession;
        break;
      case "corner":
      case "substitution":
        possession = event.side ?? possession;
        break;
      case "kickoff":
      case "secondHalf":
      case "halftime":
      case "fullTime":
        ball = Pitch.center;
        break;
      default:
        break;
    }
    if (event.at) ball = drawn(event.at);
  }
  const seed = seed64(event?.id ?? `play-${touch?.order ?? 0}-${scene?.id ?? ""}`);
  return { event, possession, ball, homeRight, lineups, seed };
}

/** How long an event holds the stage before the next one waiting takes it, in seconds (SoccerIdle.beat). */
export function eventBeat(kind: SoccerEventKind): number {
  switch (kind.type) {
    case "substitution":
      return 10;
    case "card":
      return kind.red ? 11 : 7;
    case "foul":
    case "handball":
    case "offside":
      return 8;
    case "corner":
      return 7;
    default:
      return 6;
  }
}

/** Whether an event still holds play up after its beat: a corner till it's taken, a man down till play's on again, a check, the break. (SoccerIdle.holds) */
export function eventHolds(kind: SoccerEventKind): boolean {
  return ["corner", "injury", "delay", "varCheck", "halftime", "fullTime", "kickoff", "secondHalf", "foul", "handball", "offside"].includes(kind.type);
}

/**
 * The events since the last moment, and which of them still to play (news
 * not yet played, oldest first) or holds play up now (the newest, when
 * nothing on the ball came after it: a corner not yet taken, a man down,
 * the break). (SoccerTheater.events; pure; tested)
 */
export function soccerEvents(state: SoccerTheaterState, played: ReadonlySet<string>): { pending: SoccerEvent[]; standing: SoccerEvent | null } {
  const since = (state.events ?? []).filter((e) => e.order > (state.sceneOrder ?? -1));
  const newsFrom = state.newsFrom;
  const pending = since.filter((e) => newsFrom != null && e.order >= newsFrom && !played.has(e.id) && e.kind.type !== "resume");
  const last = since.at(-1);
  const standing = last && eventHolds(last.kind) && last.order > (state.touch?.order ?? -1) ? last : null;
  return { pending, standing };
}

/** Whether two idles are the same (SoccerIdle's `==`), for the script's cache. */
export function sameSoccerIdle(a: SoccerIdle | null, b: SoccerIdle | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.seed === b.seed && a.possession === b.possession && a.homeRight === b.homeRight && a.ball.x === b.ball.x && a.ball.y === b.ball.y && a.lineups === b.lineups && a.event?.id === b.event?.id;
}

/** The pitch between moments (`SoccerScript(idle:)`): both elevens, the officials, and the beat. */
export function soccerIdleScript(idle: SoccerIdle): SoccerScript {
  const b = new IdleBuilder(idle);
  b.build();
  b.script.measureBodies();
  return b.script;
}

interface Man {
  readonly player: LineupPlayer;
  readonly actor: number;
}

interface Focus {
  readonly from: number;
  readonly until: number;
  readonly actors: readonly number[];
  readonly points: readonly Point[];
  readonly closest: number;
}

const hypot = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Windows sorted and joined where they touch (FootballScript.Builder.merged; football's own is footballIdle.ts's, kept apart so neither theater's chunk loads the other's). */
function merged(windows: readonly (readonly [number, number])[]): [number, number][] {
  const out: [number, number][] = [];
  for (const w of [...windows].sort((a, b) => a[0] - b[0])) {
    if (!(w[1] > w[0])) continue;
    const last = out[out.length - 1];
    if (last && w[0] <= last[1] + 0.05) last[1] = Math.max(last[1], w[1]);
    else out.push([w[0], w[1]]);
  }
  return out;
}

/** The first nearest of `items` to a point (Swift's `min(by:)`: the first of equals). */
function nearestOf<T>(items: readonly T[], distance: (item: T) => number): T | null {
  let best: T | null = null;
  let d = Infinity;
  for (const item of items) {
    const e = distance(item);
    if (e < d) {
      best = item;
      d = e;
    }
  }
  return best;
}

/** Without the lineups: a plain 4-4-2. */
function standard(team: string): SoccerLineup {
  const positions = ["G", "RB", "CD-R", "CD-L", "LB", "RM", "CM-R", "CM-L", "LM", "CF-R", "CF-L"];
  const players: LineupPlayer[] = positions.map((p, k) => ({ athlete: `${team}-${k + 1}`, name: null, jersey: String(k + 1), position: p, place: k + 1, line: 0, spot: { x: 50, y: 50 }, subbedOut: false }));
  return SoccerLineup.laid(team, "4-4-2", SoccerLineup.shaped(players, "4-4-2"));
}

/** Assembles the pitch between moments (`SoccerScript.IdleBuilder`). */
class IdleBuilder {
  readonly script = new SoccerScript();
  private readonly random: SplitMix64;
  /** Each man of the team on the ball (attacking) and the other, by athlete. */
  private readonly men: { attacking: Man[]; defending: Man[] } = { attacking: [], defending: [] };
  private referee = 0;
  /** What the camera keeps in frame, by when. */
  private readonly focus: Focus[] = [];

  constructor(private readonly idle: SoccerIdle) {
    this.random = new SplitMix64(idle.seed);
  }

  private get right(): boolean {
    return idleRight(this.idle);
  }

  /** The goal the team on the ball attacks, as drawn. */
  private get goal(): Point {
    return Pitch.goal(this.right);
  }

  private get everyone(): Man[] {
    return [...this.men.attacking, ...this.men.defending];
  }

  private lineup(team: "attacking" | "defending"): SoccerLineup {
    const side: Side = team === "attacking" ? this.idle.possession : this.idle.possession === "top" ? "bottom" : "top";
    const real = this.idle.lineups[side];
    if (real && real.players.length >= 10) return real;
    return standard(side === "top" ? "home" : "away");
  }

  /**
   * Where a man stands in his team's shape with the ball at `ball` (as
   * drawn): the side on the ball pushed up behind it and drawn across to it,
   * the other between it and its goal, deeper and tighter the nearer it
   * comes; the keepers on their lines.
   */
  private shape(p: LineupPlayer, team: Team, ball: Point): Point {
    const facing = team === "attacking" ? this.right : !this.right;
    const own = (q: Point) => (facing ? q : PitchFacing.turned(q));
    const n = Pitch.metres(p.spot.x, p.spot.y);
    const b = own(ball);
    let q: Point;
    if (p.place === 1 || p.position === "G") {
      q = team === "attacking" ? { x: 5 + Math.max(b.x - 52.5, 0) * 0.3, y: 34 + (b.y - 34) * 0.15 } : { x: 1.6 + Math.min(b.x * 0.03, 3), y: 34 + (b.y - 34) * 0.12 };
    } else if (team === "attacking") {
      q = { x: n.x + (b.x - 45) * 0.6, y: 34 + (n.y - 34) * 0.95 + (b.y - 34) * 0.3 };
      q = { x: Math.min(q.x, Math.max(b.x + 22, 60)), y: q.y };
    } else {
      const k = clamp(b.x / 55, 0.35, 1);
      const back = clamp(b.x * 0.45 + 2, 6, 34);
      q = { x: back + (n.x - 21) * k, y: 34 + (n.y - 34) * (0.7 + 0.25 * k) + (b.y - 34) * 0.35 };
    }
    q = { x: clamp(q.x, 1, Pitch.length - 1), y: clamp(q.y, 1.5, Pitch.width - 1.5) };
    return own(q);
  }

  private add(team: Team, label: string, p: Point, role: Role = "outfield", athlete: string | null = null): number {
    const actor = new Actor(team, role, label, p);
    actor.athlete = athlete;
    this.script.actors.push(actor);
    return this.script.actors.length - 1;
  }

  private position(i: number, t: number): Point {
    return this.script.actors[i]!.position(t);
  }

  private move(i: number, p: Point, start: number, end: number, ease: "inOut" | "linear" = "inOut"): void {
    this.script.actors[i]!.move([p], start, end, ease);
  }

  private look(i: number, from: number, point: Point): void {
    this.script.actors[i]!.looks.push({ from, point });
  }

  private hold(i: number, kind: "down" | "kneel" | "cardUp" | "ear" | "screen" | "boardUp", from: number, until: number): void {
    this.script.actors[i]!.holds.push({ kind, from, until });
  }

  /** Everyone into the shape for a ball at `ball`, from `start`, at a jog. */
  private reshape(ball: Point, start: number, except: ReadonlySet<number> = new Set()): void {
    for (const team of ["attacking", "defending"] as const) {
      for (const { player, actor } of this.men[team]) {
        if (except.has(actor) || !(this.script.actors[actor]!.opacity(start) > 0.5)) continue;
        const to = this.shape(player, team, ball);
        const d = hypot(to, this.position(actor, start));
        if (!(d > 0.3)) continue;
        this.move(actor, to, start + this.random.in(0, 0.25), start + clamp(d / 6, 0.9, 2.2));
      }
    }
  }

  /** The man of a team named by the event (by athlete, else by name), else the one of its men nearest a spot. */
  private man(team: "attacking" | "defending", athlete: string | null, label: string | null, near: Point, outfield = true): number | null {
    const pool = this.men[team].filter((m) => !outfield || m.player.place !== 1);
    if (athlete != null) {
      const hit = pool.find((m) => m.player.athlete === athlete);
      if (hit) return hit.actor;
    }
    if (label != null) {
      const hit = pool.find((m) => m.player.name === label || (m.player.name != null && surname(m.player.name) === surname(label)));
      if (hit) return hit.actor;
    }
    return nearestOf(pool, (m) => hypot(this.position(m.actor, 0), near))?.actor ?? null;
  }

  private choose<T>(items: readonly T[]): T | null {
    if (items.length === 0) return null;
    return items[Math.trunc(this.random.in(0, 0.999) * items.length)]!;
  }

  build(): void {
    const { idle, random, script } = this;
    const ball = idle.ball;
    for (const team of ["attacking", "defending"] as const) {
      this.men[team] = this.lineup(team).players.map((p) => {
        const i = this.add(team, p.name ?? p.athlete, this.shape(p, team, ball), p.place === 1 ? "keeper" : "outfield", p.athlete);
        script.actors[i]!.shaped = true;
        return { player: p, actor: i };
      });
    }
    // The officials: the referee near the play, an assistant on each touchline level with the last defender.
    const sx = random.sign();
    const rx = ball.x + sx * random.in(6, 11);
    const sy = random.sign();
    const ry = clamp(ball.y + sy * random.in(5, 10), 4, Pitch.width - 4);
    this.referee = this.add("official", "referee", { x: rx, y: ry });
    const lastMan = this.men.defending.filter((m) => m.player.place !== 1).map((m) => this.position(m.actor, 0).x);
    const line = this.right ? (lastMan.length > 0 ? Math.max(...lastMan) : 70) : lastMan.length > 0 ? Math.min(...lastMan) : 35;
    const near = this.add("official", "assistant", { x: line, y: -1.2 });
    this.add("official", "assistant", { x: Pitch.length - line, y: Pitch.width + 1.2 });
    script.flights = [new Flight("carry", 0, 0.01, fieldPoint(ball, 0.11), fieldPoint(ball, 0.11))];
    const [loopStart, period] = idle.event ? this.beat(idle.event, near) : this.circulate(ball);
    script.loop = loopStart < Infinity && period > 0 ? { start: loopStart, period } : null;
    script.duration = period > 0 ? loopStart + period : Math.max(loopStart, 1);
    script.settle = script.duration;
    script.stamp = Infinity;
    this.finish();
  }

  // MARK: The ball going round

  /**
   * Passes round the team on the ball, one every few seconds: to a man in
   * its shape 8 to 30 metres off (sideways and back more than forward, as a
   * side keeping it does), met with a step toward it, sometimes carried on a
   * few strides; both shapes shift with it. The last goes back to where it
   * began, so it loops.
   */
  private circulate(start: Point): [number, number] {
    const { random, script } = this;
    const outfield = this.men.attacking.filter((m) => m.player.place !== 1);
    const first = nearestOf(outfield, (m) => hypot(this.position(m.actor, 0), start));
    if (!first) return [0.6, 0];
    // He has it where it is.
    script.actors[first.actor]!.at = start;
    let ball = start;
    let holder = first;
    let t = random.in(1.2, 2.2);
    const passes = 5 + Math.trunc(random.in(0, 2.99));
    for (let k = 0; k <= passes; k++) {
      const last = k === passes;
      const options = outfield.filter((o) => o.actor !== holder.actor).filter((o) => {
        const d = hypot(this.shape(o.player, "attacking", ball), ball);
        return d > 8 && d < 32;
      });
      // Back and across more often than forward.
      const weighted = options.flatMap((o) => {
        const forward = (this.shape(o.player, "attacking", ball).x - ball.x) * (this.right ? 1 : -1);
        return Array.from({ length: forward > 6 ? 1 : 3 }, () => o);
      });
      const receiver = last ? first : this.choose(weighted.length === 0 ? outfield.filter((o) => o.actor !== holder.actor) : weighted);
      if (!receiver) break;
      const target = last ? start : this.shape(receiver.player, "attacking", ball);
      // Met with a step toward it (the last one back where it all began, so it loops).
      const meet = last ? start : { x: target.x + (ball.x - target.x) * 0.06, y: target.y + (ball.y - target.y) * 0.06 };
      const d = hypot(meet, ball);
      const time = clamp(d / 15, 0.6, 2);
      script.actors[holder.actor]!.act("kick", t, meet, random.in(0, 1) < 0.3);
      script.flights.push(new Flight("pass", t, t + time, fieldPoint(ball, 0.11), fieldPoint(meet, 0.11), d > 26 ? { kind: "lofted", peak: Math.min(1.5 + d * 0.06, 3.5) } : { kind: "straight" }));
      this.move(receiver.actor, meet, t + 0.1, t + time);
      script.actors[receiver.actor]!.act("control", t + time, ball);
      this.reshape(meet, t + 0.35, new Set([receiver.actor]));
      ball = meet;
      holder = receiver;
      t += time;
      // Sometimes on a few strides with it.
      if (!last && random.in(0, 1) < 0.45) {
        const ox = clamp(ball.x + (this.right ? 1 : -1) * random.in(2, 6), 2, Pitch.length - 2);
        const on = { x: ox, y: clamp(ball.y + random.in(-3, 3), 2, Pitch.width - 2) };
        const carry = random.in(0.9, 1.4);
        this.move(holder.actor, on, t + 0.4, t + 0.4 + carry, "linear");
        script.flights.push(new Flight("carry", t + 0.4, t + 0.4 + carry, fieldPoint(ball, 0.11), fieldPoint(on, 0.11)));
        ball = on;
        t += 0.4 + carry;
      }
      t += random.in(4.2, 6.2);
    }
    return [0.4, t - 0.4];
  }

  // MARK: Events

  /** An event's beat: the stage it sets, at its real spot, with its real men. */
  private beat(e: SoccerEvent, assistant: number): [number, number] {
    const { idle, random, script } = this;
    const ball = idle.ball;
    switch (e.kind.type) {
      case "corner":
        return this.corner(e);
      case "foul":
      case "handball":
        return this.freeKick(e);
      case "offside": {
        // The assistant level with him, his flag up; then the free kick back.
        const man = this.man("defending", e.athlete, e.player, ball) ?? 0;
        this.move(man, ball, 0.2, 1.2);
        this.move(assistant, { x: ball.x, y: -1.2 }, 0.2, 1.6);
        script.props.push({ kind: "flag", actor: assistant, from: 1.4, until: 5.5 });
        this.hold(assistant, "cardUp", 1.4, 5.5);
        this.focus.push({ from: 0, until: 5.5, actors: [man, assistant], points: [ball], closest: 26 });
        return this.freeKickSetup(ball, 6, false);
      }
      case "card":
        return this.card(e, e.kind.red);
      case "substitution":
        return this.substitution(e);
      case "injury":
      case "delay":
        return this.injury(e);
      case "varCheck":
      case "varDecision": {
        // Everyone waits; the referee's hand to his ear, then (the decision) his sign for the screen.
        this.move(this.referee, { x: ball.x + 4, y: ball.y + 2 }, 0.3, 2.4);
        const decided = e.kind.type === "varDecision";
        this.hold(this.referee, decided ? "screen" : "ear", 2.6, decided ? 5.5 : 14);
        for (const { actor } of this.everyone) {
          if (!(random.in(0, 1) < 0.25)) continue;
          const here = this.position(actor, 0);
          const x = here.x + random.in(-3, 3);
          const y = here.y + random.in(-3, 3);
          const from = random.in(3, 8);
          this.move(actor, { x, y }, from, random.in(9, 10));
        }
        this.focus.push({ from: 0, until: 16, actors: [this.referee], points: [ball], closest: 30 });
        return [16, 12];
      }
      case "resume":
        return this.circulate(ball);
      case "kickoff":
      case "secondHalf":
        return this.kickoff();
      case "halftime":
      case "fullTime": {
        // Off to the tunnel at the halfway line, the officials last.
        const tunnel = { x: Pitch.length / 2, y: -5 };
        script.actors.forEach((actor, i) => {
          const d = hypot(tunnel, this.position(i, 0.3));
          const leave = 0.3 + random.in(0, 1.2) + (actor.team === "official" ? 1.2 : 0);
          const arrive = leave + clamp(d / 5, 3, 9);
          this.move(i, { x: tunnel.x + random.in(-3, 3), y: tunnel.y }, leave, arrive);
          actor.vanish = arrive - 0.8;
        });
        script.ballGone = 2;
        const vanished = script.actors.map((a) => a.vanish).filter((v) => Number.isFinite(v));
        const end = vanished.length > 0 ? Math.max(...vanished) : 8;
        return [end + 1, 0];
      }
    }
  }

  /**
   * A corner: the taker to the flag on the side it went out, the attack's
   * big men into the box and each picked up by a man, a man on the near
   * post, the keeper on his line; then the men in the box jostling for
   * position till it's taken.
   */
  private corner(e: SoccerEvent): [number, number] {
    const { idle, random, script } = this;
    const right = this.right;
    const goalX = right ? Pitch.length : 0;
    const across = e.at ? (idle.homeRight ? e.at.y : Pitch.width - e.at.y) : random.in(0, 1) < 0.5 ? 0 : 68;
    const flag = { x: goalX, y: across > Pitch.width / 2 ? Pitch.width : 0 };
    const spot = { x: goalX + (right ? -0.6 : 0.6), y: flag.y === 0 ? 0.6 : Pitch.width - 0.6 };
    script.flights = [new Flight("carry", 0, 0.01, fieldPoint(spot, 0.11), fieldPoint(spot, 0.11))];
    const attack = this.men.attacking.filter((m) => m.player.place !== 1);
    const defence = this.men.defending.filter((m) => m.player.place !== 1);
    // The taker: a wide man on that side, else whoever's nearest.
    const side = flag.y > Pitch.width / 2 ? 2 : -2;
    const wide = attack.filter((m) => SoccerLineup.lateral(m.player.position) === (right === side > 0 ? 2 : -2));
    const taker = this.choose(wide)?.actor ?? nearestOf(attack, (m) => hypot(this.position(m.actor, 0), flag))?.actor ?? 0;
    const s = right ? -1 : 1;
    this.move(taker, { x: spot.x + s * 1.2, y: spot.y + (flag.y === 0 ? 1.3 : -1.3) }, 0.3, 3.2);
    this.look(taker, 3.2, { x: goalX + s * 11, y: Pitch.width / 2 });
    // The box: the centre-backs and the front men.
    const big = attack.filter((m) => m.actor !== taker && (m.player.line >= 3 || (m.player.line === 1 && Math.abs(SoccerLineup.lateral(m.player.position)) <= 1)));
    const inBox: number[] = [];
    big.slice(0, 6).forEach((a, k) => {
      const x = goalX + s * random.in(5.5, 13);
      const p = { x, y: 34 + (k - 2.5) * random.in(2.4, 3.4) };
      const from = 0.4 + random.in(0, 0.8);
      this.move(a.actor, p, from, 3.6 + random.in(0, 0.8));
      this.look(a.actor, 4, spot);
      inBox.push(a.actor);
    });
    // Each picked up, goal-side; a man on the near post.
    const markers = [...defence].sort((a, b) => a.player.line - b.player.line).map((m) => m.actor);
    for (const a of inBox) {
      if (markers.length === 0) break;
      const m = markers.shift()!;
      const p = this.position(a, 4.6);
      const to = { x: p.x + s * 1.1, y: p.y + random.in(-0.6, 0.6) };
      const from = 0.5 + random.in(0, 0.6);
      this.move(m, to, from, 4.0 + random.in(0, 0.6));
      this.look(m, 4.2, spot);
    }
    const post = markers[0];
    if (post != null) {
      this.move(post, { x: goalX + s * 0.6, y: flag.y === 0 ? Pitch.posts.near - 0.4 : Pitch.posts.far + 0.4 }, 0.6, 3.8);
      markers.shift();
    }
    // The keeper on his line; everyone else back toward the edge of the box and beyond.
    for (const { player, actor } of this.everyone) {
      if (actor === taker || inBox.includes(actor) || script.actors[actor]!.moves.length > 0) continue;
      const to = this.shape(player, script.actors[actor]!.team, { x: goalX + s * 18, y: 34 });
      const from = 0.5 + random.in(0, 0.6);
      this.move(actor, to, from, 3.6 + random.in(0, 1));
    }
    const keeper = this.men.defending.find((m) => m.player.place === 1)?.actor;
    if (keeper != null) {
      this.move(keeper, { x: goalX + s * 0.7, y: 34 + (flag.y === 0 ? -1 : 1) }, 0.4, 2.4);
      this.look(keeper, 2.4, spot);
    }
    this.move(this.referee, { x: goalX + s * 14, y: flag.y === 0 ? 50 : 18 }, 0.5, 3.6);
    // The jostling: a man in the box steps off his marker and back, round and round.
    let t = 6.5;
    for (let n = 0; n < 2; n++) {
      const a = this.choose(inBox);
      if (a == null) break;
      const here = this.position(a, t);
      const x = here.x + s * random.in(-2, 2);
      this.move(a, { x, y: here.y + random.in(-2.5, 2.5) }, t, t + 0.9);
      this.move(a, here, t + 3.4, t + 4.3);
      t += 5.5;
    }
    this.hold(taker, "cardUp", 11.2, 12);
    this.focus.push({ from: 0, until: 20, actors: [...inBox, taker], points: [spot, { x: goalX, y: 34 }], closest: 30 });
    return [6.0, 12.0];
  }

  /** A foul: the man fouled down, the referee in, then the free kick. */
  private freeKick(e: SoccerEvent): [number, number] {
    const { random } = this;
    const spot = this.idle.ball;
    const fouler = this.man("defending", e.athlete, e.player, spot);
    const fouled = this.man("attacking", null, e.other, spot);
    if (fouled != null) {
      this.move(fouled, spot, 0.1, 0.6);
      this.hold(fouled, "down", 0.6, 3.6);
    }
    if (fouler != null) {
      const x = spot.x + random.in(-2, 2);
      const sign = random.sign();
      this.move(fouler, { x, y: spot.y + sign * random.in(1.5, 2.5) }, 0.1, 0.7);
      this.look(fouler, 0.8, spot);
    }
    this.move(this.referee, { x: spot.x + random.sign() * 3, y: spot.y + 2.5 }, 0.3, 2.6);
    this.look(this.referee, 2.6, spot);
    this.focus.push({ from: 0, until: 4.2, actors: [...[fouler, fouled].filter((x): x is number => x != null), this.referee], points: [spot], closest: 20 });
    return this.freeKickSetup(spot, 4.2, true, e.penalty);
  }

  /**
   * The free kick set up at a spot: the taker over it, a wall the distance
   * off on the line to goal when it's in range, the box filling when it's in
   * the attacking third; a penalty on the spot with everyone else outside
   * the box.
   */
  private freeKickSetup(spot: Point, start: number, foul: boolean, penalty = false): [number, number] {
    void foul;
    const { random, script } = this;
    const s = this.right ? 1 : -1;
    const goal = this.goal;
    const ball = penalty ? { x: goal.x - s * Pitch.spot, y: Pitch.width / 2 } : spot;
    const was = script.ball(start);
    script.flights.push(new Flight("carry", start, start + 0.6, fieldPoint(was ? { x: was.x, y: was.y } : spot, 0.11), fieldPoint(ball, 0.11)));
    const attack = this.men.attacking.filter((m) => m.player.place !== 1);
    const taker = nearestOf(attack, (m) => hypot(this.position(m.actor, start), ball))?.actor;
    if (taker == null) return [start, 0];
    const toGoal = { x: goal.x - ball.x, y: goal.y - ball.y };
    const d = Math.max(Math.hypot(toGoal.x, toGoal.y), 1);
    const u = { x: toGoal.x / d, y: toGoal.y / d };
    this.move(taker, { x: ball.x - u.x * 1.3, y: ball.y - u.y * 1.3 }, start, start + 1.6);
    this.look(taker, start + 1.6, goal);
    this.reshape(ball, start + 0.2, new Set([taker]));
    if (penalty) {
      // Everyone out of the box but the taker and the keeper.
      for (const { actor } of this.everyone) {
        if (actor === taker || script.actors[actor]!.role === "keeper") continue;
        const p = this.position(actor, start + 3.5);
        if (Math.abs(p.x - goal.x) < Pitch.boxDepth + 1) this.move(actor, { x: goal.x - s * (Pitch.boxDepth + random.in(1, 4)), y: p.y }, start + 0.3, start + 2.6);
      }
    } else if (d < 32 && Math.abs(ball.x - goal.x) < 40) {
      // The wall: three to five, 9.15 m off on the line to goal.
      const wall = this.men.defending
        .filter((m) => m.player.place !== 1)
        .sort((a, b) => b.player.line - a.player.line)
        .slice(0, d < 22 ? 5 : 3);
      const c = { x: ball.x + u.x * Pitch.circle, y: ball.y + u.y * Pitch.circle };
      const across = { x: -u.y, y: u.x };
      wall.forEach((w, k) => {
        const off = (k - (wall.length - 1) / 2) * 0.75;
        this.move(w.actor, { x: c.x + across.x * off, y: c.y + across.y * off }, start + 0.4, start + 2.6 + random.in(0, 0.4));
        this.look(w.actor, start + 2.8, ball);
      });
    }
    // Round the loop: the taker steps back, then up again.
    const t = start + 5;
    const bx = ball.x - u.x * random.in(3, 5);
    const by = ball.y - u.y * random.in(3, 5) + random.in(-1, 1);
    this.move(taker, { x: bx, y: by }, t, t + 1.1);
    this.move(taker, { x: ball.x - u.x * 1.3, y: ball.y - u.y * 1.3 }, t + 5, t + 6.1);
    this.focus.push({ from: start, until: Infinity, actors: [taker], points: [ball, { x: ball.x + u.x * 14, y: ball.y + u.y * 14 }], closest: 26 });
    return [t - 1, 11];
  }

  /** A booking: the man to the referee where his foul was, the card up; a red, and he walks off. */
  private card(e: SoccerEvent, red: boolean): [number, number] {
    const { idle, random, script } = this;
    const spot = idle.ball;
    const team = e.side === idle.possession ? "attacking" : "defending";
    const booked = this.man(team, e.athlete, e.player, spot) ?? 0;
    this.move(this.referee, spot, 0.2, 1.6);
    this.move(booked, { x: spot.x + 1.6, y: spot.y + random.sign() * 0.8 }, 0.3, 1.9);
    this.look(booked, 1.9, spot);
    this.look(this.referee, 1.7, { x: spot.x + 1.6, y: spot.y });
    this.hold(this.referee, "cardUp", 2.2, 4.6);
    script.props.push({ kind: red ? "redCard" : "yellowCard", actor: this.referee, from: 2.2, until: 4.6 });
    // The rest stand off a few yards.
    for (const { actor } of this.everyone) {
      if (actor === booked) continue;
      const here = this.position(actor, 0);
      const d = hypot(here, spot);
      if (!(d < 9)) continue;
      const away = Math.max(9 - d, 2);
      this.move(actor, { x: here.x + ((here.x - spot.x) / Math.max(d, 0.5)) * away, y: here.y + ((here.y - spot.y) / Math.max(d, 0.5)) * away }, 0.4, 1.8);
    }
    let end = 7.5;
    if (red) {
      const off = { x: clamp(spot.x + random.in(-8, 8), 10, Pitch.length - 10), y: -3 };
      const walk = clamp(hypot(off, spot) / 2.6, 3, 9);
      this.move(booked, off, 5.2, 5.2 + walk);
      script.actors[booked]!.vanish = 5.2 + walk - 0.6;
      end = 5.2 + walk + 0.5;
    }
    this.focus.push({ from: 0, until: red ? end : 6, actors: [booked, this.referee], points: [spot], closest: 16 });
    return [end, 0];
  }

  /** A substitution at the halfway line: the man coming off walks to the touchline, the fourth official's board up, the man coming on runs to his place. */
  private substitution(e: SoccerEvent): [number, number] {
    const { script } = this;
    const line = { x: Pitch.length / 2, y: -1.2 };
    const fourth = this.add("official", "fourth official", { x: line.x + 2.2, y: -3 });
    this.hold(fourth, "boardUp", 0.4, 8.5);
    script.props.push({ kind: "board", actor: fourth, from: 0.4, until: 8.5 });
    this.look(fourth, 0, Pitch.center);
    const off = this.man("attacking", e.otherAthlete, e.other, Pitch.center) ?? 0;
    const spot = this.position(off, 0);
    const walk = clamp(hypot(spot, line) / 2.4, 3, 9);
    this.move(off, { x: line.x - 1.5, y: line.y }, 0.6, 0.6 + walk);
    script.actors[off]!.vanish = 0.6 + walk - 0.4;
    const on = this.add("attacking", e.player ?? "substitute", { x: line.x + 1, y: -3 }, "outfield", e.athlete);
    script.actors[on]!.appear = 0.6 + walk - 0.6;
    this.move(on, spot, 0.6 + walk, 0.6 + walk + clamp(hypot(spot, line) / 6, 2, 6));
    this.focus.push({ from: 0, until: 0.6 + walk + 1.5, actors: [off, on, fourth], points: [line], closest: 18 });
    return [0.6 + walk + 6, 0];
  }

  /** A man down: on the grass where he is, the players round him, the referee waving the physios on; they run on from the bench side. */
  private injury(e: SoccerEvent): [number, number] {
    const { idle, random, script } = this;
    const team = e.side === idle.possession ? "attacking" : "defending";
    const hurt = this.man(team, e.athlete, e.player, idle.ball) ?? this.men[team][0]?.actor ?? 0;
    const down = this.position(hurt, 0);
    this.hold(hurt, "down", 0.4, Infinity);
    this.move(this.referee, { x: down.x + 3, y: down.y + 2 }, 0.4, 2.6);
    this.look(this.referee, 2.6, { x: down.x, y: -3 });
    for (const { actor } of this.everyone) {
      if (actor === hurt) continue;
      const here = this.position(actor, 0);
      if (!(hypot(here, down) < 14)) continue;
      const r = random.in(3.5, 6.5);
      const a = Math.atan2(here.y - down.y, here.x - down.x);
      const from = 0.6 + random.in(0, 0.8);
      this.move(actor, { x: down.x + Math.cos(a) * r, y: down.y + Math.sin(a) * r }, from, 2.8 + random.in(0, 1));
      this.look(actor, 3, down);
    }
    const physios: number[] = [];
    for (let k = 0; k < 2; k++) {
      const from = { x: down.x + k * 3 - 1.5, y: -3 };
      const p = this.add("staff", "physio", from);
      script.actors[p]!.appear = 2.4;
      const by = { x: down.x + (k === 0 ? -1.1 : 1.1), y: down.y + (k === 0 ? -0.5 : 0.5) };
      const run = clamp(hypot(by, from) / 6, 2, 7);
      this.move(p, by, 2.8 + k * 0.3, 2.8 + k * 0.3 + run);
      this.hold(p, "kneel", 2.9 + k * 0.3 + run, Infinity);
      this.look(p, 3, down);
      physios.push(p);
    }
    this.focus.push({ from: 0, until: Infinity, actors: [hurt, ...physios], points: [down], closest: 14 });
    const ends = physios.flatMap((p) => script.actors[p]!.moves.at(-1)?.end ?? []);
    const arrive = ends.length > 0 ? Math.max(...ends) : 9;
    return [arrive + 1, 10];
  }

  /** The kick-off: each team in its own half, the ball on the spot, two of the side kicking off at it; the second half's with the ends changed. */
  private kickoff(): [number, number] {
    const { script } = this;
    const c = Pitch.center;
    script.flights = [new Flight("carry", 0, 0.01, fieldPoint(c, 0.11), fieldPoint(c, 0.11))];
    for (const team of ["attacking", "defending"] as const) {
      const own = (team === "attacking" ? this.right : !this.right) ? -1 : 1;
      for (const { player, actor } of this.men[team]) {
        let q = this.shape(player, team, c);
        // In its own half, outside the circle (the kickers aside).
        q = { x: own < 0 ? Math.min(q.x, c.x - 1.2) : Math.max(q.x, c.x + 1.2), y: q.y };
        if (hypot(q, c) < Pitch.circle + 0.5 && team === "defending") q = { x: c.x - own * -(Pitch.circle + 1), y: q.y };
        script.actors[actor]!.at = q;
        this.look(actor, 0, c);
      }
    }
    const forwards = this.men.attacking.filter((m) => m.player.line >= 3).map((m) => m.actor);
    const s = this.right ? -1 : 1;
    forwards.slice(0, 2).forEach((i, k) => {
      script.actors[i]!.at = { x: c.x + s * (k === 0 ? 0.4 : 1.6), y: c.y + (k === 0 ? -0.6 : 7) };
    });
    script.actors[this.referee]!.at = { x: c.x - s * 12, y: c.y + 9 };
    // Loop: the kicker's foot on the ball, a man bouncing on his toes.
    const kicker = forwards[0];
    if (kicker != null) this.hold(kicker, "cardUp", 4, 4.8);
    const fidget = this.choose(this.men.defending.map((m) => m.actor));
    if (fidget != null) {
      const here = script.actors[fidget]!.at;
      this.move(fidget, { x: here.x, y: here.y + 1.5 }, 6, 6.7);
      this.move(fidget, here, 9, 9.7);
    }
    this.focus.push({ from: 0, until: Infinity, actors: forwards, points: [c], closest: 40 });
    return [1, 10];
  }

  // MARK: Camera and beats

  /**
   * The camera on what the beat is about (the ball and the men near it, else
   * the event's men), following through a beat and still between; the
   * beats: whenever anyone or the ball moves, or a pose or prop changes.
   */
  private finish(): void {
    const { idle, script, focus } = this;
    const end = Math.max(script.duration, 1);
    const goal = (t: number): CameraFrame => {
      const b = script.ball(t);
      const ball = b ? { x: b.x, y: b.y } : idle.ball;
      const f = focus.findLast((x) => t >= x.from && t < x.until) ?? null;
      // What the beat is about; else the ball and the men round it.
      const rooms = f == null ? [room(fieldPoint(ball), false)] : [];
      if (f) {
        for (const i of f.actors) if (script.actors[i]!.opacity(t) > 0.5) rooms.push(room(fieldPoint(script.actors[i]!.position(t)), true));
        for (const p of f.points) rooms.push(room(fieldPoint(p), false));
      } else {
        for (const a of script.actors) {
          const p = a.position(t);
          if (a.opacity(t) > 0.5 && a.team !== "official" && hypot(p, ball) < 22) rooms.push(room(fieldPoint(p), true));
        }
      }
      return PitchCamera.fitting(rooms, CameraFrame.headroom + 0.07, f?.closest ?? 30);
    };
    const samples = CameraFollow.samples(end, goal);
    script.camera = samples;
    const beats: [number, number][] = [];
    for (const a of script.actors) {
      for (const m of a.moves) beats.push([m.start, m.end + 0.3]);
      for (const x of a.actions) beats.push([x.at - 0.4, x.at + 0.5]);
      for (const h of a.holds) {
        beats.push([h.from - 0.1, h.from + 0.45]);
        if (Number.isFinite(h.until)) beats.push([h.until - 0.1, h.until + 0.45]);
      }
      if (Number.isFinite(a.vanish)) beats.push([a.vanish, a.vanish + Actor.fade + 0.05]);
      if (Number.isFinite(a.appear) && a.appear > 0) beats.push([a.appear, a.appear + Actor.fade + 0.05]);
    }
    for (const f of script.flights) if (f.end - f.start > 0.02) beats.push([f.start, f.end + 0.1]);
    for (const p of script.props) beats.push([p.from - 0.1, p.from + 0.3], [p.until - 0.1, p.until + 0.3]);
    if (Number.isFinite(script.ballGone)) beats.push([script.ballGone, script.ballGone + 0.35]);
    let travelling: number | null = null;
    for (let k = 1; k < samples.length; k++) {
      const a = samples[k - 1]!;
      const c = samples[k]!;
      const t = k / CameraFollow.rate;
      const moved = Math.abs(c.x - a.x) + Math.abs(c.y - a.y) > a.span * 0.0004 || Math.abs(c.span - a.span) > a.span * 0.0004;
      if (moved && travelling == null) travelling = t;
      if (!moved && travelling != null) {
        beats.push([travelling, t]);
        travelling = null;
      }
    }
    if (travelling != null) beats.push([travelling, end]);
    script.beats = merged(beats.map(([a, z]) => [Math.max(a, 0), Math.min(Math.max(z, 0), end)] as [number, number]));
  }
}

// MARK: - Status

/** The teams' names for the tags ("Arsenal") and their colors (hex). */
export interface SoccerNames {
  readonly top: string;
  readonly bottom: string;
  readonly topColor: string | null;
  readonly bottomColor: string | null;
}

/** A status: the tag and its tint. */
export interface SoccerStatusTag {
  readonly tag: string | null;
  readonly tint: string | null;
}

const nameOf = (names: SoccerNames, side: Side | null): string | null => {
  if (side == null) return null;
  const n = side === "top" ? names.top : names.bottom;
  return n === "" ? null : n;
};
const colorOf = (names: SoccerNames, side: Side | null): string | null => (side == null ? null : side === "top" ? names.topColor : names.bottomColor);
const joined = (parts: readonly (string | null)[]): string => parts.filter((p): p is string => p != null).join(" · ");

/**
 * The broadcast tag over the pitch (SoccerStatus): the team on the ball,
 * each event as it comes ("CORNER · ARSENAL", "FOUL · RICE", "YELLOW CARD ·
 * GUÉHI", "VAR CHECK"), the break ("HALF TIME"), and the added time once
 * it's announced ("+4 ADDED"). (pure; tested)
 */
export const SoccerStatus = {
  yellow: "FFD61A",
  red: "D7261E",

  /** "Arsenal ball". */
  ball(side: Side | null, names: SoccerNames): SoccerStatusTag {
    const n = nameOf(names, side);
    return { tag: n != null ? `${n} ball` : null, tint: colorOf(names, side) };
  },

  /** Between moments, t into the idle; `added`: the minutes announced, while they're being played. */
  idle(idle: SoccerIdle, t: number, names: SoccerNames, added: number | null): SoccerStatusTag {
    const e = idle.event;
    if (!e) {
      if (added != null && t % 20 < 8) return { tag: `+${added} added`, tint: null };
      return SoccerStatus.ball(idle.possession, names);
    }
    const who = eventSurname(e);
    const kind = e.kind;
    switch (kind.type) {
      case "corner":
        return { tag: joined(["Corner", nameOf(names, e.side)]), tint: colorOf(names, e.side) };
      case "foul":
      case "handball":
        if (e.penalty) return { tag: joined(["Penalty", nameOf(names, idle.possession)]), tint: colorOf(names, idle.possession) };
        if (t < 4.2) return { tag: joined([kind.type === "handball" ? "Handball" : "Foul", who]), tint: colorOf(names, e.side) };
        return { tag: joined(["Free kick", nameOf(names, idle.possession)]), tint: colorOf(names, idle.possession) };
      case "offside":
        if (t < 6) return { tag: joined(["Offside", who]), tint: colorOf(names, e.side) };
        return { tag: joined(["Free kick", nameOf(names, idle.possession)]), tint: colorOf(names, idle.possession) };
      case "card":
        return { tag: joined([kind.second ? "Second yellow" : kind.red ? "Red card" : "Yellow card", who]), tint: kind.red ? SoccerStatus.red : SoccerStatus.yellow };
      case "substitution": {
        const on = eventSurname(e);
        const off = e.other != null ? surname(e.other) : null;
        return { tag: on != null && off != null ? `${on} on · ${off} off` : joined(["Substitution", nameOf(names, e.side)]), tint: colorOf(names, e.side) };
      }
      case "injury":
        return { tag: joined(["Injury", who]), tint: colorOf(names, e.side) };
      case "delay":
        return { tag: "Delay in match", tint: null };
      case "varCheck":
        return { tag: "VAR check", tint: null };
      case "varDecision":
        return { tag: `VAR · ${kind.words}`, tint: null };
      case "resume":
        return SoccerStatus.ball(idle.possession, names);
      case "kickoff":
        return { tag: "Kick-off", tint: null };
      case "secondHalf":
        return { tag: "Second half", tint: null };
      case "halftime":
        return { tag: "Half time", tint: null };
      case "fullTime":
        return { tag: "Full time", tint: null };
    }
  },

  /** During a moment's replay: how the move began, the team on the ball. */
  replay(scene: SoccerScene, names: SoccerNames): SoccerStatusTag {
    const team = nameOf(names, scene.side);
    let tag: string | null;
    switch (scene.start) {
      case "corner":
        tag = joined(["Corner", team]);
        break;
      case "freeKick":
        tag = joined(["Free kick", team]);
        break;
      case "penalty":
        tag = joined(["Penalty", team]);
        break;
      default:
        tag = team != null ? `${team} ball` : null;
    }
    return { tag, tint: colorOf(names, scene.side) };
  },

  /** When the idle's tag changes (script time), for the stage to wake. */
  changes(idle: SoccerIdle, added: number | null): number[] {
    const e = idle.event;
    if (!e) return added == null ? [] : [8, 20, 28];
    switch (e.kind.type) {
      case "foul":
      case "handball":
        return [4.2];
      case "offside":
        return [6];
      default:
        return [];
    }
  },
};
