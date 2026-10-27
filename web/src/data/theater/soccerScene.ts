/**
 * The soccer theater's model (SoccerScene.swift): one big moment (a goal, a
 * save, a shot off the woodwork, a block, a big chance, a penalty), parsed
 * from ESPN's core plays into what the theater replays: the attacking team's
 * chain of touches that led to the shot, each where it happened; the shot
 * from its spot to the exact point in the goal mouth it was heading for; how
 * it ended, and who was in it. Pure values: the parser is tested against real
 * plays, and the replay is a function of the scene and time.
 *
 * ESPN (Opta) logs every touch with where it happened (`fieldPositionX/Y`)
 * and, for a pass or a shot, where it went (`fieldPosition2X/Y`), each in the
 * acting team's own frame: it attacks toward x = 100, and y runs from its
 * right touchline (0) to its left (100). A shot also says where it crossed
 * the goal line (`goalPositionY`: the posts at 45.2 and 54.8) and how high
 * (`goalPositionZ`: the bar at 38). The scene puts all of it on one pitch in
 * metres, home attacking right as the Live Pitch draws it, through Opta's
 * pitch markings, so a touch on the edge of the box is on its line.
 *
 * Web-only: archived feeds measured 0…1 toward x = 0 (`pitchScale` says
 * "unit", data/liveFeeds/soccer.ts) are read through the same turn-round as
 * the Live Pitch's (`100 × (1 − v)`), via the trailing `scale` arguments.
 *
 *     const scene = SoccerScene.latest(plays, homeTeamID, SoccerScene.keepers(plays));
 */
import { at, bool, type JSONValue } from "../json";
import { BIG_CHANCE_XG, LATE_SECONDS, type PitchScale } from "../liveFeeds/soccer";
import type { Side } from "../models";
import type { Point } from "../mlb/theaterField";

// MARK: - Swift JSON's coercions

/** `JSON.double`: a number, or a numeric string. */
function double(v: JSONValue): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** `JSON.int`: a double, truncated. */
function int(v: JSONValue): number | null {
  const d = double(v);
  return d == null ? null : Math.trunc(d);
}

/** `JSON.string`: a string, or a number's text. */
function string(v: JSONValue): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/** A value read on the feed's scale: unit-scale feeds turned round (a half turn) onto the percent scale (web-only). */
function scaled(v: number | null, scale: PitchScale): number | null {
  return v == null ? null : scale === "unit" && v !== 0 ? 100 * (1 - v) : v;
}

// MARK: - Pitch

/**
 * The pitch in metres: x from the left goal line (105 long), y from the near
 * touchline, the camera's side (68 wide), z up. Home attacks right.
 */
const ALONG: readonly (readonly [number, number])[] = [
  [0, 0],
  [5.8, 5.5],
  [11.5, 11],
  [17, 16.5],
  [50, 52.5],
  [83, 88.5],
  [88.5, 94],
  [94.2, 99.5],
  [100, 105],
];
const ACROSS: readonly (readonly [number, number])[] = [
  [0, 0],
  [21.1, 13.84],
  [36.8, 24.84],
  [45.2, 30.34],
  [50, 34],
  [54.8, 37.66],
  [63.2, 43.16],
  [78.9, 54.16],
  [100, 68],
];

export const Pitch = {
  length: 105,
  width: 68,
  goalWidth: 7.32,
  goalHeight: 2.44,
  /** Distances from the goal line. */
  spot: 11,
  boxDepth: 16.5,
  boxWidth: 40.32,
  sixDepth: 5.5,
  sixWidth: 18.32,
  circle: 9.15,

  get center(): Point {
    return { x: Pitch.length / 2, y: Pitch.width / 2 };
  },

  /** The middle of the goal a team attacks: the right one for home. */
  goal(right: boolean): Point {
    return { x: right ? Pitch.length : 0, y: Pitch.width / 2 };
  },

  /** Its posts, near (the camera's side) then far. */
  get posts(): { readonly near: number; readonly far: number } {
    return { near: Pitch.width / 2 - Pitch.goalWidth / 2, far: Pitch.width / 2 + Pitch.goalWidth / 2 };
  },

  /**
   * Opta's pitch (0…100 each way) to metres, piecewise through the
   * markings its coordinates are drawn to: the box 17 deep and 21.1 to
   * 78.9 across, the six-yard box 5.8 and 36.8 to 63.2, the spot 11.5, the
   * posts 45.2 and 54.8.
   */
  metres(x: number, y: number): Point {
    return { x: Pitch.piecewise(x, ALONG), y: Pitch.piecewise(y, ACROSS) };
  },

  /** Across only: where a shot crossed the goal line. */
  across(y: number): number {
    return Pitch.piecewise(y, ACROSS);
  },

  /** A goal-mouth height (the bar at 38) in metres. */
  height(z: number): number {
    return (Math.max(z, 0) / 38) * Pitch.goalHeight;
  },

  /** Between knots, linear; past the ends (a ball over the line), the end segment carried on. */
  piecewise(v: number, knots: readonly (readonly [number, number])[]): number {
    let i = 1;
    while (i < knots.length - 1 && v > knots[i]![0]) i += 1;
    const a = knots[i - 1]!;
    const b = knots[i]!;
    return a[1] + ((v - a[0]) * (b[1] - a[1])) / (b[0] - a[0]);
  },
};

// MARK: - Scene

export type Outcome = "goal" | "ownGoal" | "saved" | "blocked" | "woodwork" | "wide";

/** How the move began. */
export type Start = "openPlay" | "corner" | "freeKick" | "throwIn" | "goalKick" | "kickoff" | "penalty";

export type Technique = "foot" | "header" | "volley";

export type TouchKind =
  | "pass"
  | "cross"
  | "takeOn"
  | "touch"
  /** A set piece taken: a corner, a free kick, a throw-in, a goal kick. */
  | "restart"
  /** The ball won back: where the move began. */
  | "regain"
  /** An earlier shot in the same move (saved, and the rebound went in). */
  | "shot";

/** Somebody on the ball (or at it) on the way to the shot. */
export interface Touch {
  kind: TouchKind;
  player: string;
  /** Where it happened, in metres. */
  at: Point;
  /** Where a pass, a cross or an earlier shot went. */
  to: Point | null;
  /** In the air: a cross, a corner, a long ball. */
  lofted: boolean;
  /** Match clock, in seconds. */
  clock: number;
  /** The other team's: a deflection, a header won, a save. */
  defending: boolean;
  /** The defending keeper's own: a save, a punch, coming off his line (whether or not the feed has learned his name yet). */
  keeper: boolean;
}

/** Where a shot crossed (or would have crossed) the goal line: metres from the near touchline, and up. */
export interface Mouth {
  y: number;
  z: number;
}

/** The shot (SoccerScene.Shot; the script's camera shots are `Shot` in soccerScript.ts). */
export interface SceneShot {
  from: Point;
  mouth: Mouth | null;
  /** Where it was stopped: the keeper's hands, the block. */
  stopped: Point | null;
  technique: Technique;
  penalty: boolean;
  /** Opta's expected goals. */
  xg: number | null;
}

/** A player the moment names, and where he was (if ESPN placed him). */
export interface Person {
  name: string | null;
  at: Point | null;
}

export interface SoccerScene {
  readonly id: string;
  outcome: Outcome;
  start: Start;
  /** The attacking team (the one credited, for an own goal). Top is home, attacking right. */
  side: Side;
  /** The build-up, oldest first, the defending team's touches among them. */
  touches: Touch[];
  shot: SceneShot;
  /** Who struck it (an own goal's defender). */
  shooter: string;
  assist: string | null;
  keeper: Person;
  blocker: Person | null;
  /** Where the ball went after a save, a block or the woodwork, if it's known; null when the keeper held it. */
  rebound: Point | null;
  /** "37'", "90+3'". */
  minute: string;
  /** Match clock, in seconds. */
  clock: number;
  /** "Goal! Arsenal 2, Everton 0. Gabriel Magalhães (Arsenal) header from very close range…" */
  text: string;
  /** Goals after it, home (top) first. */
  topScore: number | null;
  bottomScore: number | null;
  /** A late goal that changes the result: an equalizer or a winner from 85'. */
  decisive: boolean;
  /** Epoch milliseconds. */
  wallclock: number | null;
}

export const attacksRight = (scene: SoccerScene): boolean => scene.side === "top";
export const goalOf = (scene: SoccerScene): Point => Pitch.goal(attacksRight(scene));
export const scored = (scene: SoccerScene): boolean => scene.outcome === "goal" || scene.outcome === "ownGoal";
/** The touches that led to the shot by the team that took it. */
export const buildUpOf = (scene: SoccerScene): Touch[] => scene.touches.filter((t) => !t.defending);

/** From the spot to the middle of the goal, in yards (penalty spots included: 12). */
export function distance(scene: SoccerScene): number {
  const goal = goalOf(scene);
  const d = Math.hypot(goal.x - scene.shot.from.x, goal.y - scene.shot.from.y) / 0.9144;
  return Math.round(d);
}

/** Off the bar rather than a post: crossed between the posts, high. */
export function crossbar(scene: SoccerScene): boolean {
  const mouth = scene.shot.mouth;
  if (scene.outcome !== "woodwork" || !mouth) return false;
  return mouth.z >= Pitch.goalHeight * 0.88 && mouth.y > Pitch.posts.near && mouth.y < Pitch.posts.far;
}

const PARTICLES: ReadonlySet<string> = new Set(["van", "von", "de", "da", "di", "der", "den", "dos", "du", "le", "la", "del", "ter", "ten"]);

/** "Magalhães" from "Gabriel Magalhães"; "van Dijk" from "Virgil van Dijk"; a single name stays whole. */
export function surname(name: string): string {
  const words = name.split(" ").filter((w) => w !== "");
  if (words.length <= 1) return name;
  for (let i = 1; i < words.length; i++) {
    if (PARTICLES.has(words[i]!)) return words.slice(i).join(" ");
  }
  return words.slice(1).join(" ");
}

/** What the soccer theater shows: the latest big moment. */
export interface SoccerTheaterState {
  readonly scene: SoccerScene | null;
  /** Arrived while the page was open, or only just happened: replay it. Otherwise it's history, and shows as it ended. */
  readonly news: boolean;
}

// MARK: - Parsing

const typeOf = (item: JSONValue): string => string(at(item, "type", "type")) ?? "";

/** The plays the theater replays: goals (own goals and penalties too), saves, shots off the woodwork, blocks, big chances, penalties. */
export function isMoment(item: JSONValue): boolean {
  const type = typeOf(item);
  if (bool(at(item, "scoringPlay")) === true || type === "goal" || type.startsWith("goal---") || type === "own-goal") return true;
  if (bool(at(item, "penaltyKick")) === true || type.startsWith("penalty---")) return true;
  switch (type) {
    case "shot-on-target":
    case "shot-blocked":
    case "shot-hit-woodwork":
      return true;
    case "shot-off-target":
      return (double(at(item, "expectedGoals")) ?? 0) >= BIG_CHANCE_XG;
    default:
      return false;
  }
}

/** The newest moment in a run of plays, with its build-up. */
export function latest(plays: readonly JSONValue[], homeTeamID: string | null, keeperNames: Readonly<Record<string, string>> = {}, scale: PitchScale = "percent"): SoccerScene | null {
  for (let index = plays.length - 1; index >= 0; index--) {
    if (!isMoment(plays[index])) continue;
    const scene = parse(plays, index, homeTeamID, keeperNames, scale);
    if (scene) return scene;
  }
  return null;
}

/** Goalkeepers by team ID, from what only a keeper does (a claim, a punch, a smother) and who saves are credited to. */
export function keepers(plays: readonly JSONValue[]): Record<string, string> {
  const found: Record<string, string> = {};
  let saved = false;
  for (const item of plays) {
    const type = typeOf(item);
    const team = teamID(item);
    const who = name(item);
    if ((keeperOnly(type) || (type === "save" && saved)) && team != null && who != null) found[team] = who;
    // A save after a shot on target is the keeper's (after a block, the blocker's).
    if (type.startsWith("shot-")) saved = type === "shot-on-target" || (string(at(item, "text"))?.includes(" saved ") ?? false);
    else if (!["assist", "assists-shot", "save"].includes(type)) saved = false;
  }
  return found;
}

/** The moment at `index`, with what led to it. Null for anything that isn't one. */
export function parse(
  plays: readonly JSONValue[],
  index: number,
  homeTeamID: string | null,
  keeperNames: Readonly<Record<string, string>> = {},
  scale: PitchScale = "percent",
): SoccerScene | null {
  const item = plays[index];
  if (item === undefined || !isMoment(item)) return null;
  const id = playID(item);
  const team = teamID(item);
  const from = place(item, "fieldPositionX", "fieldPositionY", homeTeamID, scale);
  if (id == null || team == null || from == null) return null;
  const type = typeOf(item);
  const text = string(at(item, "text")) ?? "";
  const lower = text.toLowerCase();
  const side: Side = team === homeTeamID ? "top" : "bottom";

  let outcome: Outcome;
  if (bool(at(item, "ownGoal")) === true || type === "own-goal") {
    outcome = "ownGoal";
  } else if (bool(at(item, "scoringPlay")) === true || type === "goal" || type.startsWith("goal---") || type === "penalty---scored") {
    outcome = "goal";
  } else if (type === "shot-on-target" || type === "penalty---saved" || (type === "shot-blocked" && lower.includes(" saved "))) {
    outcome = "saved";
  } else if (type === "shot-blocked") {
    outcome = "blocked";
  } else if (type === "shot-hit-woodwork" || (lower.includes("hits the") && (lower.includes("post") || lower.includes("bar")))) {
    outcome = "woodwork";
  } else {
    outcome = "wide";
  }

  const shot: SceneShot = { from, mouth: null, stopped: null, technique: "foot", penalty: false, xg: null };
  shot.penalty = bool(at(item, "penaltyKick")) === true || type.startsWith("penalty---");
  shot.technique = lower.includes("header") || type === "goal---header" ? "header" : type === "goal---volley" || lower.includes("volley") ? "volley" : "foot";
  shot.xg = double(at(item, "expectedGoals"));
  const gy = scaled(double(at(item, "goalPositionY")), scale);
  if (gy != null) {
    // In the shooter's frame like everything else: the away team's mouth turns round.
    shot.mouth = { y: Pitch.across(side === "top" ? gy : 100 - gy), z: Pitch.height(double(at(item, "goalPositionZ")) ?? 0) };
  }
  if (outcome === "saved" || outcome === "blocked") {
    shot.stopped = place(item, "fieldPosition2X", "fieldPosition2Y", homeTeamID, scale);
  }

  const ownGoalBy = outcome === "ownGoal" ? (/Own Goal by ([^,]+),/.exec(text)?.[1] ?? null) : null;
  const shooter = name(item) ?? ownGoalBy ?? "";
  const scene: SoccerScene = {
    id,
    outcome,
    start: "openPlay",
    side,
    touches: [],
    shot,
    shooter,
    assist: null,
    keeper: { name: null, at: null },
    blocker: null,
    rebound: null,
    minute: "",
    clock: 0,
    text: "",
    topScore: null,
    bottomScore: null,
    decisive: false,
    wallclock: null,
  };
  scene.assist = /Assisted by (.+?)(?: with | following |\.|$)/.exec(text)?.[1] ?? null;
  scene.text = text;
  scene.clock = double(at(item, "clock", "value")) ?? 0;
  scene.minute = minute(string(at(item, "clock", "displayValue")) ?? "");
  scene.topScore = int(at(item, "homeScore"));
  scene.bottomScore = int(at(item, "awayScore"));
  scene.wallclock = parseDate(string(at(item, "wallclock")));
  scene.decisive = scored(scene) && decides(scene);
  if (shot.penalty) scene.start = "penalty";

  // After the shot: the keeper's save or the block (an entry credited
  // to the defending team, where it was made), and where the ball went.
  let defending: string | null = null;
  for (const p of plays) {
    const t = teamID(p);
    if (t != null && t !== team) {
      defending = t;
      break;
    }
  }
  const names: Record<string, string> = { ...keeperNames };
  const saver = savedBy(text);
  if (saver != null && defending != null) names[defending] = saver;
  scene.keeper.name = defending != null ? (names[defending] ?? null) : null;
  for (let i = index + 1; i < plays.length && i <= index + 6; i++) {
    const next = plays[i];
    const nextType = typeOf(next);
    if (!(Math.abs((double(at(next, "clock", "value")) ?? scene.clock) - scene.clock) <= 4)) break;
    if (["assist", "assists-shot"].includes(nextType)) continue;
    const spot = place(next, "fieldPositionX", "fieldPositionY", homeTeamID, scale);
    if (nextType === "save" && teamID(next) !== team) {
      if (outcome === "blocked") {
        scene.blocker = { name: name(next), at: spot };
      } else if (outcome === "saved" || name(next) === scene.keeper.name) {
        scene.keeper.at = spot;
        if (scene.keeper.name == null) scene.keeper.name = name(next);
      }
      continue;
    }
    if (scored(scene) || spot == null) break;
    const keeper = scene.keeper.name;
    if (nextType === "corner-awarded") {
      // Turned behind: past the post on the side it was going.
      const mouthY = shot.mouth?.y ?? Pitch.width / 2;
      const beyond = side === "top" ? Pitch.length + 2.5 : -2.5;
      scene.rebound = { x: beyond, y: mouthY < Pitch.width / 2 ? Pitch.posts.near - 3 : Pitch.posts.far + 3 };
    } else if (teamID(next) !== team && keeper != null && (name(next) === keeper || keeperOnly(nextType))) {
      // The keeper has it: held.
      scene.rebound = null;
    } else {
      scene.rebound = spot;
    }
    break;
  }

  if (!shot.penalty) {
    const chain = buildUp(plays, index, team, shooter, from, scene.clock, homeTeamID, shot.technique !== "foot", scale);
    scene.touches = chain.touches;
    scene.start = chain.start;
    // His touches are the keeper's, by name or by what only a keeper does; one the feed
    // hasn't learned yet is named by them.
    for (const touch of scene.touches) if (touch.defending && touch.player === scene.keeper.name) touch.keeper = true;
    if (scene.keeper.name == null) {
      const his = scene.touches.findLast((t) => t.keeper);
      if (his && his.player !== "") scene.keeper.name = his.player;
    }
  }
  return scene;
}

/** How far back a move reaches: seconds before the shot, the longest pause in it, its touches. */
export const window = 20;
export const lull = 8;
export const touchLimit = 8;

/**
 * The move before the shot: back through the plays while the attacking
 * team keeps the ball, for up to 20 seconds and its last eight touches.
 * The other team's touches that didn't win it (a header contested, a
 * deflection, a parry) are part of the move; one that did (a tackle, an
 * interception, a clearance), or a stoppage, ends it. A set piece
 * begins it.
 */
export function buildUp(
  plays: readonly JSONValue[],
  index: number,
  team: string,
  shooter: string,
  shotAt: Point,
  clock: number,
  home: string | null,
  lofting: boolean,
  scale: PitchScale = "percent",
): { touches: Touch[]; start: Start } {
  const touches: Touch[] = [];
  let start: Start = "openPlay";
  let last = clock;
  scan: for (let i = index - 1; i >= 0; i--) {
    const item = plays[i];
    const type = typeOf(item);
    const spot = place(item, "fieldPositionX", "fieldPositionY", home, scale);
    const time = double(at(item, "clock", "value")) ?? last;
    // Bookkeeping: an assist credit, a card, a substitution.
    if (spot == null) {
      if (["halftime", "kickoff", "start-2nd-half", "end-regular-time"].includes(type)) break;
      continue;
    }
    if (clock - time > window || last - time > lull) break;
    if (touches.filter((t) => !t.defending).length >= touchLimit) break;
    const ours = teamID(item) === team;
    const player = name(item) ?? "";
    const touch: Touch = { kind: "touch", player, at: spot, to: null, lofted: false, clock: time, defending: !ours, keeper: false };
    touch.to = place(item, "fieldPosition2X", "fieldPosition2Y", home, scale);
    const length = touch.to ? Math.hypot(touch.to.x - spot.x, touch.to.y - spot.y) : 0;
    if (ours) {
      switch (type) {
        case "pass":
        case "cross": {
          const raw = [scaled(double(at(item, "fieldPositionX")), scale) ?? 0, scaled(double(at(item, "fieldPositionY")), scale) ?? 50] as const;
          if (raw[0] >= 98.5 && (raw[1] <= 1.5 || raw[1] >= 98.5)) {
            touch.kind = "restart";
            touch.lofted = true;
            touches.push(touch);
            start = "corner";
            break scan;
          }
          touch.kind = type === "cross" ? "cross" : "pass";
          touch.lofted = type === "cross" || length > 30;
          break;
        }
        case "take-on":
          touch.kind = "takeOn";
          break;
        case "ball-touch":
        case "aerial":
        case "shield-ball-opp":
          touch.kind = "touch";
          break;
        case "shot-on-target":
        case "shot-blocked":
        case "shot-off-target":
        case "shot-hit-woodwork":
          touch.kind = "shot";
          break;
        case "free-kick":
        case "throw-in":
        case "goal-kick":
        case "kickoff":
          touch.kind = "restart";
          touch.lofted = type === "free-kick" ? length > 25 : type === "goal-kick" && length > 30;
          touches.push(touch);
          start = type === "free-kick" ? "freeKick" : type === "throw-in" ? "throwIn" : type === "goal-kick" ? "goalKick" : "kickoff";
          break scan;
        case "tackle":
        case "interception":
        case "blocked-pass":
        case "clear":
        case "save":
        case "claim":
        case "punch":
        case "smother":
        case "keeper-sweeper":
          touch.kind = "regain";
          touches.push(touch);
          break scan;
        case "assist":
        case "assists-shot":
          continue scan;
        default:
          // Out of play, offside, a foul: the move starts after it.
          break scan;
      }
      // The header's own duel (logged as an aerial on the shot's spot) isn't a touch before it.
      if (touches.length === 0 && player === shooter && Math.hypot(spot.x - shotAt.x, spot.y - shotAt.y) < 1.5 && touch.kind !== "pass" && touch.kind !== "cross") {
        last = time;
        continue;
      }
      // A take-on logged twice.
      const newer = touches[touches.length - 1];
      if (newer && !newer.defending && newer.player === player && newer.kind === touch.kind && newer.at.x === touch.at.x && newer.at.y === touch.at.y) {
        continue;
      }
      touches.push(touch);
      last = time;
    } else {
      switch (type) {
        case "aerial":
        case "ball-touch":
        case "blocked-pass":
        case "attempted-tackle":
        case "save":
        case "punch":
        case "keeper-sweeper":
        case "challenge":
        case "shield-ball-opp":
          touch.keeper = keeperOnly(type) || (type === "save" && keeperSave(plays, i));
          touches.push(touch);
          break;
        case "pass":
          if (length < 6 && last - time <= 4) {
            // A pass of a few yards straight back to the attack: a header won and lost, really.
            touch.to = null;
            touches.push(touch);
            break;
          }
          break scan;
        default:
          break scan;
      }
    }
  }
  // The other team's touches before the attack's first don't belong to it.
  while (touches[touches.length - 1]?.defending === true) touches.pop();
  touches.reverse();
  // The ball into a header (or a volley) came through the air.
  if (lofting) {
    const i = touches.findLastIndex((t) => !t.defending && (t.kind === "pass" || t.kind === "restart"));
    const to = i >= 0 ? touches[i]!.to : null;
    if (to && Math.hypot(to.x - shotAt.x, to.y - shotAt.y) < 8) touches[i]!.lofted = true;
  }
  return { touches, start };
}

// MARK: Fields

/**
 * A position in metres, from the entry's own team's frame onto the pitch
 * where home attacks right. Null for an entry ESPN didn't place.
 */
export function place(item: JSONValue, xKey: string, yKey: string, home: string | null, scale: PitchScale = "percent"): Point | null {
  const x = scaled(double(at(item, xKey)), scale);
  const y = scaled(double(at(item, yKey)), scale);
  if (x == null || y == null || (x === 0 && y === 0)) return null;
  const isHome = teamID(item) === home;
  return Pitch.metres(isHome ? x : 100 - x, isHome ? y : 100 - y);
}

/** ".../teams/362?lang=en" → "362". */
export function teamID(item: JSONValue): string | null {
  const ref = string(at(item, "team", "$ref"));
  if (ref == null) return null;
  const i = ref.indexOf("/teams/");
  if (i < 0) return null;
  const id = /^\d+/.exec(ref.slice(i + "/teams/".length))?.[0];
  return id ? id : null;
}

export function playID(item: JSONValue): string | null {
  return string(at(item, "id"));
}

/** "Martin Ødegaard Pass" less its type: "Martin Ødegaard". */
export function name(item: JSONValue): string | null {
  const short = string(at(item, "shortText"));
  const type = string(at(item, "type", "text"));
  if (short != null && type != null && short.endsWith(" " + type)) {
    const n = short.slice(0, short.length - type.length - 1);
    return n === "" ? null : n;
  }
  const text = string(at(item, "text"));
  return text != null ? (/^([^.!()]+?) \(/.exec(text)?.[1] ?? null) : null;
}

/** "…is saved in the bottom left corner by Zion Suzuki (Aston Villa)." → "Zion Suzuki". */
export function savedBy(text: string): string | null {
  return /saved [^.]*? by ([^(.]+?) \(/.exec(text)?.[1] ?? null;
}

/** A save entry is the keeper's when the shot just before it was on target; after a block it's the blocker's. */
export function keeperSave(plays: readonly JSONValue[], index: number): boolean {
  for (let k = index - 1; k >= Math.max(index - 3, 0); k--) {
    const item = plays[k];
    const type = typeOf(item);
    if (!(type.startsWith("shot-") || type.startsWith("goal") || type.startsWith("penalty"))) continue;
    return type !== "shot-blocked" || (string(at(item, "text")) ?? "").includes(" saved ");
  }
  return false;
}

export function keeperOnly(type: string): boolean {
  return ["claim", "punch", "smother", "keeper-sweeper", "keeper-pick-up", "drop-of-ball"].includes(type);
}

/** "90'+3'" → "90+3'". */
export function minute(display: string): string {
  const bare = display.replaceAll("'", "");
  return bare === "" ? "" : bare + "'";
}

/** From 85': the scorers now level, or one ahead. */
export function decides(scene: SoccerScene): boolean {
  const top = scene.topScore;
  const bottom = scene.bottomScore;
  if (!(scene.clock >= LATE_SECONDS) || top == null || bottom == null) return false;
  const [mine, theirs] = scene.side === "top" ? [top, bottom] : [bottom, top];
  return mine === theirs || mine === theirs + 1;
}

/** "2026-10-24T11:32:05Z" → epoch milliseconds. */
function parseDate(s: string | null): number | null {
  if (s == null) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

// MARK: - The stamp's second line

/** Characters as Swift counts them (grapheme clusters). */
export function characters(s: string): number {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    let n = 0;
    for (const _ of new Intl.Segmenter().segment(s)) n += 1;
    return n;
  }
  return [...s.normalize("NFC")].length;
}

/**
 * The stamp's second line (SoccerTheater.swift `SoccerFrame.detail`): "AST
 * ØDEGAARD · HEADER · 9 YD", "SAVED BY SUZUKI · 18 YD", "BIG CHANCE · 0.61 XG
 * · WIDE". Here, not with the drawing, because the script measures it.
 */
export function stampDetail(scene: SoccerScene): string {
  let parts: (string | null)[] = [];
  const technique = scene.shot.penalty ? "Penalty" : scene.shot.technique === "header" ? "Header" : scene.shot.technique === "volley" ? "Volley" : null;
  const yards = scene.shot.penalty ? null : `${distance(scene)} yd`;
  switch (scene.outcome) {
    case "goal":
      parts = [scene.assist != null ? `Ast ${surname(scene.assist)}` : null, technique, yards];
      break;
    case "ownGoal":
      parts = ["Own goal"];
      break;
    case "saved":
      parts = [scene.keeper.name != null ? `Saved by ${surname(scene.keeper.name)}` : "Saved", technique, yards];
      break;
    case "blocked":
      parts = [scene.blocker?.name != null ? `Blocked by ${surname(scene.blocker.name)}` : "Blocked", technique, yards];
      break;
    case "woodwork":
      parts = [crossbar(scene) ? "Off the bar" : "Off the post", technique, yards];
      break;
    case "wide": {
      const mouth = scene.shot.mouth;
      const over = (mouth?.z ?? 0) > Pitch.goalHeight && Math.abs((mouth?.y ?? Pitch.width / 2) - Pitch.width / 2) < Pitch.goalWidth / 2;
      parts = [(scene.shot.xg ?? 0) >= BIG_CHANCE_XG ? "Big chance" : null, scene.shot.xg != null ? `${scene.shot.xg.toFixed(2)} xG` : null, technique, over ? "Over" : "Wide"];
      break;
    }
  }
  return parts
    .filter((p): p is string => p != null)
    .join(" · ")
    .toUpperCase();
}

/** SoccerScene's static members, by their Swift names. */
export const SoccerScene = {
  isMoment,
  latest,
  keepers,
  parse,
  buildUp,
  window,
  lull,
  touchLimit,
  place,
  teamID,
  playID,
  name,
  savedBy,
  keeperSave,
  keeperOnly,
  minute,
  decides,
  surname,
};
