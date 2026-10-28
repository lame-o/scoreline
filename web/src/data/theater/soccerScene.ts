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
 * Every entry credits who did it (athlete, shirt, lineup role: 1 is the
 * keeper; `credit`), a shot its contact, situation and xGOT; the summary's
 * rosters give both starting elevens their spots (`SoccerLineup`). An
 * entry's own reads (`isGoal`, `credit`, `teamID`, `playID`) live in
 * soccerEntries.ts, so the lane can read them without this parser.
 *
 * Web-only: archived feeds measured 0…1 toward x = 0 (`pitchScale` says
 * "unit", data/liveFeeds/soccer.ts) are read through the same turn-round as
 * the Live Pitch's (`100 × (1 − v)`), via the trailing `scale` arguments.
 *
 *     const scene = SoccerScene.latest(plays, homeTeamID, SoccerScene.keepers(plays));
 */
import { arr, at, bool, type JSONValue } from "../json";
import { BIG_CHANCE_XG, LATE_SECONDS, type PitchScale } from "../liveFeeds/soccer";
import type { Side } from "../models";
import type { Point } from "../mlb/theaterField";
import { credit, isGoal, playID, string, teamID, type Credit } from "./soccerEntries";

export { credit, isGoal, playID, teamID, type Credit } from "./soccerEntries";

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

/** What struck it, as Opta logs it (`contactType`). */
export type Contact = "leftFoot" | "rightFoot" | "head";

/** How the move that made the chance began, as Opta tags the shot (`shotInfo`), even when the build-up doesn't reach back that far. */
export type Situation = "openPlay" | "corner" | "setPiece" | "freeKick" | "throwIn" | "fastBreak" | "penalty" | "ownGoal";

/** The assist's kind, from the text ("Assisted by Ben White with a cross"). */
export type AssistKind = "cross" | "throughBall" | "headedPass";

/** VAR's word on a goal: confirmed ("Goal confirmed following VAR Review."), or struck off (`SoccerFeed` takes it off the stage). */
export type Review = "confirmed" | "overturned";

export type KeeperActionKind = "save" | "punch" | "claim" | "smother" | "sweep" | "spill";

/**
 * What the defending keeper did, and where, as the feed logs it (it has no
 * save type: diving, catching): a save at his spot, a punch and where it
 * landed, a claim in the air, a smother at a forward's feet, a rush off his
 * line, the ball spilled.
 */
export interface KeeperAction {
  readonly kind: KeeperActionKind;
  readonly at: Point;
  /** Where a punch landed. */
  readonly to: Point | null;
  /** Match clock, in seconds. */
  readonly clock: number;
}

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
  /** Who, exactly (athlete, shirt, lineup role). */
  credit: Credit | null;
  /** Where it happened, in metres. */
  at: Point;
  /** Where a pass, a cross or an earlier shot went. */
  to: Point | null;
  /** In the air: a cross, a corner, a long ball. */
  lofted: boolean;
  /** Match clock, in seconds (1 s resolution): the real gaps between touches, for pacing. */
  clock: number;
  /** The other team's: a deflection, a header won, a save. */
  defending: boolean;
  /** The defending keeper's own: a save, a punch, coming off his line (credited to lineup role 1, or something only a keeper does). */
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
  contact: Contact | null;
  situation: Situation | null;
  penalty: boolean;
  /** Opta's expected goals. */
  xg: number | null;
  /** Expected goals on target: how hard it was to keep out (0 off target). */
  xgot: number | null;
}

/** A player the moment names, and where he was (if ESPN placed him). */
export interface Person {
  name: string | null;
  at: Point | null;
  credit?: Credit | null;
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
  shooterCredit: Credit | null;
  assist: string | null;
  assistCredit: Credit | null;
  assistKind: AssistKind | null;
  keeper: Person;
  blocker: Person | null;
  /** The defending keeper's actions in the move and just after the shot, oldest first. */
  keeperActions: KeeperAction[];
  review: Review | null;
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
  /** A goal VAR struck off after it showed (`review` overturned): no longer the scene, so it never replays or celebrates; kept for a "no goal" beat. */
  readonly overturned?: SoccerScene | null;
  /** Both starting elevens and their nominal spots, from the match summary. */
  readonly lineups?: Lineups;
}

/** Lineups by side (Swift's `[GameDetail.Side: SoccerLineup]`). */
export type Lineups = Readonly<Partial<Record<Side, SoccerLineup>>>;

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
export function latest(plays: readonly JSONValue[], homeTeamID: string | null, keepers: Readonly<Record<string, Person>> = {}, scale: PitchScale = "percent"): SoccerScene | null {
  for (let index = plays.length - 1; index >= 0; index--) {
    if (!isMoment(plays[index])) continue;
    const scene = parse(plays, index, homeTeamID, keepers, scale);
    if (scene) return scene;
  }
  return null;
}

/** Goalkeepers by team ID: whoever ESPN credits in lineup role 1, or with what only a keeper does (a substitute keeper's role is 27). */
export function keepers(plays: readonly JSONValue[]): Record<string, Person> {
  const found: Record<string, Person> = {};
  for (const item of plays) {
    const team = teamID(item);
    const c = credit(item);
    if (team == null || c == null || !(c.keeper || keeperOnly(typeOf(item)))) continue;
    found[team] = { name: name(item), at: null, credit: c };
  }
  return found;
}

/** The moment at `index`, with what led to it. Null for anything that isn't one. */
export function parse(
  plays: readonly JSONValue[],
  index: number,
  homeTeamID: string | null,
  keepers: Readonly<Record<string, Person>> = {},
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

  const shot: SceneShot = { from, mouth: null, stopped: null, technique: "foot", contact: null, situation: null, penalty: false, xg: null, xgot: null };
  shot.penalty = bool(at(item, "penaltyKick")) === true || type.startsWith("penalty---");
  shot.contact = contact(string(at(item, "contactType", "text")));
  shot.situation = situation(string(at(item, "shotInfo", "text")));
  const header = shot.contact != null ? shot.contact === "head" : lower.includes("header") || type === "goal---header";
  shot.technique = header ? "header" : type === "goal---volley" || lower.includes("volley") ? "volley" : "foot";
  shot.xg = double(at(item, "expectedGoals"));
  shot.xgot = double(at(item, "expectedGoalsOnTarget"));
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
    shooterCredit: null,
    assist: null,
    assistCredit: null,
    assistKind: null,
    keeper: { name: null, at: null },
    blocker: null,
    keeperActions: [],
    review: null,
    rebound: null,
    minute: "",
    clock: 0,
    text: "",
    topScore: null,
    bottomScore: null,
    decisive: false,
    wallclock: null,
  };
  scene.shooterCredit = credit(item);
  scene.assist = /Assisted by (.+?)(?: with | following |\.|$)/.exec(text)?.[1] ?? null;
  // The assister: credited by role, else second (the shooter is first).
  const credits = arr(at(item, "participants"));
  const assister = credits.findIndex((c) => string(at(c, "type")) === "assister");
  scene.assistCredit = assister >= 0 ? credit(item, assister) : credits.length > 1 && string(at(credits[1], "type")) == null ? credit(item, 1) : null;
  scene.assistKind = lower.includes("with a cross") ? "cross" : lower.includes("with a through ball") ? "throughBall" : lower.includes("with a headed pass") ? "headedPass" : null;
  if (lower.includes("goal confirmed following var review")) scene.review = "confirmed";
  scene.text = text;
  scene.clock = double(at(item, "clock", "value")) ?? 0;
  scene.minute = minute(string(at(item, "clock", "displayValue")) ?? "");
  scene.topScore = int(at(item, "homeScore"));
  scene.bottomScore = int(at(item, "awayScore"));
  scene.wallclock = parseDate(string(at(item, "wallclock")));
  scene.decisive = scored(scene) && decides(scene);
  if (shot.penalty) scene.start = "penalty";

  // After the shot: the keeper's save or the block (an entry credited
  // to the defending team, where it was made, sometimes after the
  // header that made it), and where the ball went.
  let defending: string | null = null;
  for (const p of plays) {
    const t = teamID(p);
    if (t != null && t !== team) {
      defending = t;
      break;
    }
  }
  const known = defending != null ? keepers[defending] : undefined;
  if (known) scene.keeper = { ...known };
  // The text names him before any entry of his has ("saved … by Zion Suzuki").
  if (scene.keeper.name == null) scene.keeper.name = savedBy(text);
  let settled = false;
  for (let i = index + 1; i < plays.length && i <= index + 6; i++) {
    const next = plays[i];
    const nextType = typeOf(next);
    if (!(Math.abs((double(at(next, "clock", "value")) ?? scene.clock) - scene.clock) <= 4)) break;
    if (["assist", "assists-shot"].includes(nextType)) continue;
    // Another attempt: what follows is its own.
    if (nextType.startsWith("shot-") || isGoal(next)) break;
    const spot = place(next, "fieldPositionX", "fieldPositionY", homeTeamID, scale);
    const theirs = teamID(next) !== team;
    const nextCredit = credit(next);
    const keeper = theirs && (nextCredit?.keeper === true || keeperOnly(nextType));
    if (keeper) {
      const action = keeperAction(next, homeTeamID, scale);
      if (action) scene.keeperActions.push(action);
      scene.keeper.credit = nextCredit ?? scene.keeper.credit ?? null;
      scene.keeper.name = scene.keeper.name ?? name(next);
    }
    if (nextType === "save" && theirs) {
      if (keeper || (nextCredit == null && outcome === "saved")) {
        scene.keeper.at = spot;
        scene.keeper.name = name(next) ?? scene.keeper.name;
      } else {
        scene.blocker = { name: name(next), at: spot, credit: nextCredit };
      }
      continue;
    }
    if (settled) continue;
    if (scored(scene) || spot == null) break;
    settled = true;
    if (nextType === "corner-awarded") {
      // Turned behind: past the post on the side it was going.
      const mouthY = shot.mouth?.y ?? Pitch.width / 2;
      const beyond = side === "top" ? Pitch.length + 2.5 : -2.5;
      scene.rebound = { x: beyond, y: mouthY < Pitch.width / 2 ? Pitch.posts.near - 3 : Pitch.posts.far + 3 };
    } else if (keeper) {
      // The keeper's: a punch flies to where it landed, a spill drops at his feet; anything else he held.
      scene.rebound = nextType === "punch" ? (place(next, "fieldPosition2X", "fieldPosition2Y", homeTeamID, scale) ?? spot) : nextType === "drop-of-ball" ? spot : null;
    } else {
      scene.rebound = spot;
    }
  }

  if (!shot.penalty) {
    const chain = buildUp(plays, index, team, shooter, from, scene.clock, homeTeamID, shot.technique !== "foot", scale);
    scene.touches = chain.touches;
    scene.start = chain.start;
    const his = scene.keeper.credit == null ? scene.touches.findLast((t) => t.keeper) : undefined;
    if (his) {
      scene.keeper.credit = his.credit;
      if (scene.keeper.name == null && his.player !== "") scene.keeper.name = his.player;
    }
    // The keeper's actions in the moment's window (a corner punched out before the move), then after the shot.
    const first = Math.min(scene.touches[0]?.clock ?? scene.clock, scene.clock - window);
    const before = plays.slice(Math.max(index - 30, 0), index).filter((p) => teamID(p) !== team && (double(at(p, "clock", "value")) ?? 0) >= first && (credit(p)?.keeper === true || keeperOnly(typeOf(p))));
    scene.keeperActions = [...before.flatMap((p) => keeperAction(p, homeTeamID, scale) ?? []), ...scene.keeperActions];
  }
  return scene;
}

/** A keeper's entry as an action: a save, a punch (and where it landed), a claim, a smother, a rush off his line, a spill. */
export function keeperAction(item: JSONValue, home: string | null, scale: PitchScale = "percent"): KeeperAction | null {
  let kind: KeeperActionKind;
  switch (typeOf(item)) {
    case "save":
      kind = "save";
      break;
    case "punch":
      kind = "punch";
      break;
    case "claim":
    case "keeper-pick-up":
      kind = "claim";
      break;
    case "smother":
      kind = "smother";
      break;
    case "keeper-sweeper":
      kind = "sweep";
      break;
    case "drop-of-ball":
      kind = "spill";
      break;
    default:
      return null;
  }
  const spot = place(item, "fieldPositionX", "fieldPositionY", home, scale);
  if (spot == null) return null;
  return { kind, at: spot, to: kind === "punch" ? place(item, "fieldPosition2X", "fieldPosition2Y", home, scale) : null, clock: double(at(item, "clock", "value")) ?? 0 };
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
    const touch: Touch = { kind: "touch", player, credit: credit(item), at: spot, to: null, lofted: false, clock: time, defending: !ours, keeper: false };
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
          touch.keeper = touch.credit?.keeper === true || keeperOnly(type) || (type === "save" && keeperSave(plays, i));
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

/** A save entry is the keeper's when ESPN credits it to lineup role 1. Without a credit: when the shot just before it was on target (after a block it's the blocker's). */
export function keeperSave(plays: readonly JSONValue[], index: number): boolean {
  const c = credit(plays[index]);
  if (c) return c.keeper;
  for (let k = index - 1; k >= Math.max(index - 3, 0); k--) {
    const item = plays[k];
    const type = typeOf(item);
    if (!(type.startsWith("shot-") || type.startsWith("goal") || type.startsWith("penalty"))) continue;
    return type !== "shot-blocked" || (string(at(item, "text")) ?? "").includes(" saved ");
  }
  return false;
}

/** "Left Foot", "Right Foot", "Header". */
export function contact(text: string | null): Contact | null {
  switch (text?.toLowerCase()) {
    case "left foot":
      return "leftFoot";
    case "right foot":
      return "rightFoot";
    case "header":
    case "head":
      return "head";
    default:
      return null;
  }
}

/** "Regular Play", "From Corner", "Set Piece", "Free Kick", "Throw-in Set Piece", "Fast Break", "Penalty", "Own Goal". */
export function situation(text: string | null): Situation | null {
  if (text == null) return null;
  const t = text.toLowerCase();
  if (t.includes("corner")) return "corner";
  if (t.includes("throw")) return "throwIn";
  if (t.includes("free kick")) return "freeKick";
  if (t.includes("set piece")) return "setPiece";
  if (t.includes("fast break")) return "fastBreak";
  if (t.includes("penalty")) return "penalty";
  if (t.includes("own goal")) return "ownGoal";
  if (t.includes("regular")) return "openPlay";
  return null;
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
  isGoal,
  latest,
  keepers,
  parse,
  keeperAction,
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
  credit,
  contact,
  situation,
  keeperOnly,
  minute,
  decides,
  surname,
};

// MARK: - Lineups

/** One of a team's starting eleven (SoccerLineup.Player). */
export interface LineupPlayer {
  readonly athlete: string;
  /** "Zion Suzuki". */
  readonly name: string | null;
  readonly jersey: string | null;
  /**
   * ESPN's abbreviation: "G", "CD-L", "AM-R", "LM"… Ambiguous alone: LM and
   * RM are the holding pair in a 4-2-3-1 but the wing-backs in a 3-4-2-1, so
   * the formation decides where he stands.
   */
  readonly position: string;
  /** Opta's formation place: 1 the keeper, 2 to 11 by the formation's numbering. */
  readonly place: number;
  /** His line: 0 the keeper, 1 the back line, and so on up the pitch. */
  line: number;
  /**
   * Where the shape puts him, in his team's own frame on Opta's pitch: x
   * toward the goal it attacks (0…100), y from its right touchline (0) to
   * its left (100).
   */
  spot: Point;
  readonly subbedOut: boolean;
}

/**
 * A team's starting eleven as the match summary lists it (`rosters[]`, which
 * the page's summary load already fetches): the formation, and each
 * starter's place in it, so every player has a nominal spot on the pitch,
 * not only those who touch the ball.
 */
export class SoccerLineup {
  private constructor(
    /** The team's ID. */
    readonly team: string,
    /** "4-2-3-1", "3-4-2-1", "5-4-1". */
    readonly formation: string | null,
    /** The starting eleven, by formation place. */
    readonly players: readonly LineupPlayer[],
  ) {}

  /** A player's nominal spot on the pitch, in metres (home attacks right, as the scene draws it). */
  spot(athlete: string, attacksRight: boolean): Point | null {
    const p = this.players.find((x) => x.athlete === athlete);
    if (!p) return null;
    return Pitch.metres(attacksRight ? p.spot.x : 100 - p.spot.x, attacksRight ? p.spot.y : 100 - p.spot.y);
  }

  /** One roster from the summary; null without a starting eleven (Swift's failable init). */
  static from(roster: JSONValue): SoccerLineup | null {
    const team = string(at(roster, "team", "id"));
    if (team == null) return null;
    const players = arr(at(roster, "roster"))
      .filter((r) => bool(at(r, "starter")) === true)
      .flatMap((r): LineupPlayer[] => {
        const athlete = string(at(r, "athlete", "id"));
        if (athlete == null) return [];
        return [
          {
            athlete,
            name: string(at(r, "athlete", "displayName")),
            jersey: string(at(r, "jersey")),
            position: string(at(r, "position", "abbreviation")) ?? "",
            place: int(at(r, "formationPlace")) ?? 0,
            line: 0,
            spot: { x: 50, y: 50 },
            subbedOut: bool(at(r, "subbedOut")) ?? false,
          },
        ];
      });
    if (players.length === 0) return null;
    const formation = string(at(roster, "formation"));
    return new SoccerLineup(team, formation, SoccerLineup.shaped([...players].sort((a, b) => a.place - b.place), formation));
  }

  /** Both teams' lineups from a summary's `rosters`, by side. */
  static lineups(rosters: JSONValue, side: (team: string | null) => Side | null): Lineups {
    const out: { top?: SoccerLineup; bottom?: SoccerLineup } = {};
    for (const roster of arr(rosters)) {
      const lineup = SoccerLineup.from(roster);
      const s = lineup ? side(lineup.team) : null;
      if (lineup && s) out[s] = lineup;
    }
    return out;
  }

  /**
   * Lays the eleven out from the formation string: the keeper, then one line
   * per number, filled from the back by each position's depth (a back, a
   * holding or wide midfielder, an attacking midfielder, a second striker,
   * the striker), each line ordered across by its side (right, centre,
   * left) and spread evenly. Without a usable formation, a line per depth.
   * (pure; tested)
   */
  static shaped(players: readonly LineupPlayer[], formation: string | null): LineupPlayer[] {
    const out = players.map((p) => ({ ...p }));
    const keeper = out.findIndex((p) => p.place === 1 || p.position === "G");
    const outfield = out
      .map((_, i) => i)
      .filter((i) => i !== keeper)
      .sort((a, b) => SoccerLineup.depth(out[a]!.position) - SoccerLineup.depth(out[b]!.position) || out[a]!.place - out[b]!.place);
    // Swift's `split(separator: "-").compactMap { Int($0) }`.
    const counts = (formation ?? "")
      .split("-")
      .filter((x) => x !== "")
      .flatMap((x) => (/^[+-]?\d+$/.test(x) ? [Number(x)] : []));
    const lines: number[][] = [];
    if (counts.reduce((a, b) => a + b, 0) === outfield.length && counts.length > 0) {
      let rest = outfield;
      for (const n of counts) {
        lines.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
    } else {
      for (const i of outfield) {
        const last = lines.at(-1)?.at(-1);
        if (last != null && SoccerLineup.depth(out[last]!.position) === SoccerLineup.depth(out[i]!.position)) lines[lines.length - 1]!.push(i);
        else lines.push([i]);
      }
    }
    if (keeper >= 0) {
      out[keeper]!.line = 0;
      out[keeper]!.spot = { x: 5, y: 50 };
    }
    lines.forEach((line, n) => {
      // The back line about a fifth of the way up, the striker past halfway.
      const x = lines.length > 1 ? 22 + (40 * n) / (lines.length - 1) : 40;
      const across = [...line].sort((a, b) => SoccerLineup.lateral(out[a]!.position) - SoccerLineup.lateral(out[b]!.position) || out[a]!.place - out[b]!.place);
      const width = Math.min(76, 22 * (across.length - 1));
      across.forEach((i, k) => {
        out[i]!.line = n + 1;
        out[i]!.spot = { x, y: across.length > 1 ? 50 - width / 2 + (width * k) / (across.length - 1) : 50 };
      });
    });
    return out;
  }

  /**
   * How far up the pitch a position plays: the backs, a holding midfielder,
   * the midfield line (wing-backs and wide men in it), the attacking
   * midfielders, a second striker, the striker.
   */
  static depth(position: string): number {
    const p = position.toUpperCase();
    if (["RB", "LB", "CB", "D", "SW"].includes(p) || p.startsWith("CD")) return 1;
    if (p.startsWith("DM") || p === "CDM") return 1.8;
    if (["LM", "RM", "M", "LWB", "RWB"].includes(p) || p.startsWith("CM")) return 2;
    if (p.startsWith("AM") || p === "CAM") return 3;
    if (p.startsWith("CF-") || ["SS", "RW", "LW", "RF", "LF"].includes(p)) return 3.5;
    if (["F", "CF", "ST", "FW"].includes(p)) return 4;
    return 2.5;
  }

  /** Across the pitch from the team's right: a wide right player, right of centre ("-R"), central, left of centre ("-L"), wide left. */
  static lateral(position: string): number {
    const p = position.toUpperCase();
    if (["RB", "RM", "RW", "RWB", "RF"].includes(p)) return -2;
    if (["LB", "LM", "LW", "LWB", "LF"].includes(p)) return 2;
    if (p.endsWith("-R")) return -1;
    if (p.endsWith("-L")) return 1;
    return 0;
  }
}

/** Both lineups from each side's roster as the summary sent it (GameDetail's `soccerRosters`); a side without a starting eleven is left out. */
export function readLineups(rosters: Readonly<Partial<Record<Side, JSONValue>>>): Lineups {
  const out: { top?: SoccerLineup; bottom?: SoccerLineup } = {};
  for (const side of ["top", "bottom"] as const) {
    const lineup = rosters[side] != null ? SoccerLineup.from(rosters[side]) : null;
    if (lineup) out[side] = lineup;
  }
  return out;
}
