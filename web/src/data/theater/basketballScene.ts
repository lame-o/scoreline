/**
 * The basketball theater's model (BasketballScene.swift): one play from
 * ESPN's core play-by-play (as the live lane keeps it, `normalized` in
 * data/liveFeeds/basketball.ts) parsed into what the theater replays: the
 * kind of shot and how it was taken, where (ESPN's own spot), who shot it,
 * who passed it, who blocked it, the miss a putback came from and the steal
 * a fast break came from, the result and the points, and what made it more
 * than a basket (an and-one, the buzzer, a dunk through a defender who
 * fouled him). Pure values: the parser is tested against real games, and
 * the replay is a function of the scene and time.
 *
 * Structured fields decide the play (its type, the participants and their
 * parts, the coordinate, the scores, the clock); the text adds only the
 * names a stamp shows ("Mikel Brown Jr. makes 23-foot three point jumper
 * (Keon Ellis assists)": Brown Jr., Ellis) and ESPN's own distance.
 *
 * What replays in full (the marquee): every made field goal, every block,
 * and a shot to tie or take the lead in the last 30 seconds of the fourth or
 * overtime that missed (or a free throw that tied it or won the lead).
 * Everything else ESPN logs is a lighter beat between them
 * (basketballBeats.ts): each miss and its rebound, each free throw, each
 * whistle (its call and who), each turnover by its kind, the jump balls,
 * substitutions, timeouts, reviews and the ends of periods. A steal is the
 * lead-in to the basket it led to, an offensive rebound the lead-in to its
 * putback: a replay that shows them says so (`leadIn`), as a miss says which
 * rebound it ends in (`follows`).
 *
 *     const plays = basketballRecent(lane.items, teams);
 */
import {
  buzzer as isBuzzer,
  clutch as isClutch,
  DEFENSIVE_FOUL_TYPES,
  DUNK_TYPES,
  elapsed as gameElapsed,
  isFreeThrow,
  isLastFreeThrow,
  OFFENSIVE_FOUL_TYPES,
  participants,
  periodEnd,
  plain,
  seconds,
  shotValue,
  TURNOVER_TYPES,
} from "../basketball";
import { arr, at, type JSONValue } from "../json";
import { andOne as isAndOne, marginOf, sideIn, type Teams } from "../liveFeeds/basketball";
import { liveScore } from "../liveFeeds/baseball";
import type { Side } from "../models";
import type { Point } from "../mlb/theaterField";

export type BasketballKind =
  | "jumper"
  | "three"
  | "layup"
  | "dunk"
  | "alleyOop"
  | "putback"
  | "freeThrow"
  /** A shot swatted away (`shot` says what was tried). */
  | "block"
  /** The ball taken by a defender; lost without one. */
  | "steal"
  | "turnover"
  | "offensiveRebound"
  | "defensiveRebound"
  /**
   * A whistle that isn't a turnover: a foul (offensive ones too), a
   * technical; a violation the ball stays with the offense on (a kicked
   * ball, goaltending, a delay). `call` says which.
   */
  | "foul"
  | "violation"
  | "jumpBall"
  | "substitution"
  | "timeout"
  | "periodEnd"
  /** A coach's challenge or a referee's review, and how it came out. */
  | "challenge";

/**
 * What a whistle (or a turnover) was for, as the play-by-play names it;
 * `other` is anything else ESPN calls (a double dribble, three seconds, a
 * backcourt), in its words ("DOUBLE DRIBBLE").
 */
export type Call =
  | { readonly kind: "shooting" | "personal" | "looseBall" | "take" | "flagrant" | "technical" | "offensive" | "charge" }
  | { readonly kind: "badPass" | "lostBall" | "outOfBounds" | "traveling" | "shotClock" | "offensiveGoaltending" }
  | { readonly kind: "kickedBall" | "goaltending" | "delay" }
  | { readonly kind: "other"; readonly words: string };

export type CallKind = Call["kind"];

const call = (kind: Exclude<CallKind, "other">): Call => ({ kind }) as Call;

/** Swift's `Call ==`. */
export const sameCall = (a: Call | null, b: Call | null): boolean =>
  a === b || (a != null && b != null && a.kind === b.kind && (a.kind !== "other" || (b.kind === "other" && a.words === b.words)));

const CALL_WORDS: Readonly<Record<Exclude<CallKind, "other">, string>> = {
  shooting: "SHOOTING FOUL",
  personal: "FOUL",
  looseBall: "LOOSE BALL FOUL",
  take: "TAKE FOUL",
  flagrant: "FLAGRANT FOUL",
  technical: "TECHNICAL",
  offensive: "OFFENSIVE FOUL",
  charge: "CHARGE",
  badPass: "BAD PASS",
  lostBall: "LOST BALL",
  outOfBounds: "OUT OF BOUNDS",
  traveling: "TRAVELING",
  shotClock: "SHOT CLOCK",
  offensiveGoaltending: "OFFENSIVE GOALTENDING",
  kickedBall: "KICKED BALL",
  goaltending: "GOALTENDING",
  delay: "DELAY OF GAME",
};

/** The call as a broadcast tag says it. */
export const callWords = (c: Call): string => (c.kind === "other" ? c.words : CALL_WORDS[c.kind]);

/** A foul by the team without the ball: the other team keeps it (and may shoot). */
export const isDefensiveCall = (c: Call): boolean => ["shooting", "personal", "looseBall", "take", "flagrant", "kickedBall", "goaltending"].includes(c.kind);

/** How a player plays, from ESPN's position: who stands on the arc, who on the block (a guard rebounds long, a big under the rim). */
export type Role = "guard" | "wing" | "big";

/**
 * How the shooter got the shot off, from ESPN's type: off a pass, off the
 * dribble, going away from the defender, with his back to the basket,
 * floating it over the help, at the rim (`drive` down the lane off the
 * dribble, `cut` to the rim off a pass), back up off the rim (`tip`), set at
 * the line.
 */
export type BasketballMove = "catchAndShoot" | "pullUp" | "stepBack" | "fadeaway" | "turnaround" | "floater" | "hook" | "drive" | "cut" | "tip" | "set";

export type BasketballResult = "make" | "miss" | "blocked";

/** Someone in on it: ESPN's athlete ID and the name the stamp gives him ("Brown Jr."), and how he plays (ESPN's position for him on the play). */
export interface Person {
  readonly id: string | null;
  readonly name: string;
  readonly role?: Role | null;
}

/**
 * The missed shot a putback (or a rebound) came off: where, by whom, for how
 * many; `close`: a layup or a dunk (it goes up from the rim, not the arc);
 * the miss and the offensive rebound after it by ID (a putback's replay
 * shows both); swatted (it falls by the shooter), or a free throw (off the
 * front of the rim); ESPN's distance in feet.
 */
export interface Miss {
  readonly spot: Point;
  readonly shooter: Person | null;
  readonly value: number;
  readonly close: boolean;
  readonly id?: string | null;
  readonly board?: string | null;
  readonly blocked?: boolean;
  readonly freeThrow?: boolean;
  readonly distance?: number | null;
}

/** The steal a fast break came from, at its spot (in ESPN's feet toward the basket of the team that lost it: the far end). */
export interface Steal {
  readonly spot: Point | null;
  readonly loser: Person | null;
  readonly stealer: Person | null;
  readonly id?: string | null;
}

/** Who got the ball after a miss or a block, from the next play: null person for a team rebound; `id`: the rebound's own play. */
export interface Rebound {
  readonly person: Person | null;
  readonly offensive: boolean;
  readonly id?: string | null;
}

export interface BasketballScene {
  readonly id: string;
  kind: BasketballKind;
  /** The shot taken (a block's: the layup it stopped); null when no shot was. */
  shot: BasketballKind | null;
  move: BasketballMove;
  result: BasketballResult;
  /** Points scored, and what the shot was for (2 or 3; 1 at the line). */
  points: number;
  value: number;
  /** The team that shot it (or lost the ball). */
  offense: Side | null;
  /**
   * ESPN's spot in half-court feet toward the offense's basket: x 0…50
   * across (0 the shooter's left facing it), y out from the backboard (the
   * rim at about (25, 1.25)).
   */
  spot: Point | null;
  /** Feet from the rim, as ESPN's text gives it (else from the spot). */
  distance: number | null;
  shooter: Person | null;
  assister: Person | null;
  blocker: Person | null;
  /** The defender a made basket's and-one foul was on. */
  fouler: Person | null;
  rebound: Rebound | null;
  miss: Miss | null;
  steal: Steal | null;
  /** A make with a shooting foul by the other team at the same clock. */
  andOne: boolean;
  /** Made with a second or less on the clock (`buzzer`). */
  buzzer: boolean;
  /** A buzzer-beater that tied it or won it at the end of the fourth or overtime. */
  decisive: boolean;
  /** The last five minutes, within five (`clutch`). */
  clutch: boolean;
  /** A shot to tie or take the lead in the last 30 seconds of the fourth or overtime. */
  lastShot: boolean;
  /** Finished at the rim with a dunk (an alley-oop's, a putback's too). */
  dunk: boolean;
  /** A reverse finish: under the rim and up the other side. */
  reverse: boolean;
  period: number | null;
  clock: string;
  /** The score after it. */
  top: number;
  bottom: number;
  typeID: number | null;
  typeText: string;
  text: string;
  /** Epoch ms. */
  wallclock: number | null;

  // The lighter beats' facts.
  /** What the whistle (or the turnover) was for. */
  call: Call | null;
  /** A free throw's place in its trip ("1 of 2"): null when ESPN doesn't say. */
  attempt: number | null;
  attempts: number | null;
  /** Who drew a foul: the shooter of the free throws it gave, when they're in. */
  drew: Person | null;
  /** How many free throws a foul gave (null: none, or not in yet). */
  trip: number | null;
  /** Who came in, who went out. */
  subIn: Person | null;
  subOut: Person | null;
  /** The two men in a jump ball, and who came up with it. */
  jumpers: Person[];
  winner: Person | null;
  /** The game's last play ("End of Game"). */
  final: boolean;
  /** A challenge's outcome: overturned, or the call stands (null: under way). */
  overturned: boolean | null;
  /** A review the referees started (no coach's challenge). */
  review: boolean;
  /** "Official timeout", or a media one, as ESPN's text calls it. */
  stoppage: string | null;
  /**
   * Plays its choreography also shows: earlier ones (the steal before a
   * break, the miss and the board before a putback), later ones (the
   * rebound a miss ends in, an and-one's foul, an offensive foul's turnover).
   */
  leadIn: string[];
  follows: string[];
}

function scene(id: string, kind: BasketballKind, shot: BasketballKind | null, move: BasketballMove, result: BasketballResult): BasketballScene {
  return {
    id,
    kind,
    shot,
    move,
    result,
    points: 0,
    value: 2,
    offense: null,
    spot: null,
    distance: null,
    shooter: null,
    assister: null,
    blocker: null,
    fouler: null,
    rebound: null,
    miss: null,
    steal: null,
    andOne: false,
    buzzer: false,
    decisive: false,
    clutch: false,
    lastShot: false,
    dunk: false,
    reverse: false,
    period: null,
    clock: "",
    top: 0,
    bottom: 0,
    typeID: null,
    typeText: "",
    text: "",
    wallclock: null,
    call: null,
    attempt: null,
    attempts: null,
    drew: null,
    trip: null,
    subIn: null,
    subOut: null,
    jumpers: [],
    winner: null,
    final: false,
    overturned: null,
    review: false,
    stoppage: null,
    leadIn: [],
    follows: [],
  };
}

export const made = (s: BasketballScene) => s.result === "make";

/** A dunk through the defender who fouled him: the data credits him. */
export const posterized = (s: BasketballScene) => s.dunk && s.andOne && s.fouler != null && s.result === "make";

/** The team without the ball. */
export const defense = (s: BasketballScene): Side | null => (s.offense === "top" ? "bottom" : s.offense === "bottom" ? "top" : null);

const opponent = (side: Side | null): Side | null => (side === "top" ? "bottom" : side === "bottom" ? "top" : null);

/** A field goal attempt or a free throw. */
export const isShot = (s: BasketballScene) => s.shot != null;

/**
 * The team the play happens to with the ball (its frame: the basket it
 * attacks is the one in front): the shooter's, the team that lost it, the
 * team a foul was on; a defensive rebound's comes off the other team's miss.
 * Null when the play doesn't say (a substitution, a timeout).
 */
export function ballSide(s: BasketballScene): Side | null {
  switch (s.kind) {
    case "defensiveRebound":
      return opponent(s.offense);
    case "foul":
    case "violation": {
      const c = s.call;
      if (!c || c.kind === "technical" || c.kind === "delay") return null;
      return isDefensiveCall(c) ? opponent(s.offense) : s.offense;
    }
    case "substitution":
    case "timeout":
    case "periodEnd":
    case "challenge":
      return null;
    default:
      return s.offense;
  }
}

/**
 * Who has the ball once it's over (null: nobody can say, or a stoppage
 * keeps whatever was): a make or a defensive board turns it over, an
 * offensive board keeps it, a whistle gives it to the team it was for.
 */
export function afterSide(s: BasketballScene): Side | null {
  switch (s.kind) {
    case "jumper":
    case "three":
    case "layup":
    case "dunk":
    case "alleyOop":
    case "putback":
    case "block":
      if (made(s)) return s.andOne ? s.offense : opponent(s.offense);
      return s.rebound ? (s.rebound.offensive ? s.offense : opponent(s.offense)) : null;
    case "freeThrow": {
      const last = (s.attempt ?? 1) >= (s.attempts ?? 1);
      if (made(s)) return last ? opponent(s.offense) : s.offense;
      return last ? (s.rebound ? (s.rebound.offensive ? s.offense : opponent(s.offense)) : null) : s.offense;
    }
    case "steal":
    case "turnover":
      return opponent(s.offense);
    case "offensiveRebound":
    case "defensiveRebound":
    case "jumpBall":
      return s.offense;
    case "foul":
    case "violation": {
      const c = s.call;
      if (!c || c.kind === "technical" || c.kind === "delay") return null;
      // Goaltending's basket counts: the team that committed it takes it out.
      return c.kind === "goaltending" ? s.offense : opponent(s.offense);
    }
    case "substitution":
    case "timeout":
    case "periodEnd":
    case "challenge":
      return null;
  }
}

/** Whether the theater replays it (see the module's note). (pure; tested) */
export function replays(s: BasketballScene): boolean {
  switch (s.kind) {
    case "jumper":
    case "three":
    case "layup":
    case "dunk":
    case "alleyOop":
    case "putback":
      return s.spot != null && (made(s) || s.lastShot);
    case "block":
      return s.spot != null;
    case "freeThrow":
      return made(s) && s.lastShot;
    case "steal":
    case "turnover":
    case "offensiveRebound":
    case "defensiveRebound":
    case "foul":
    case "violation":
    case "jumpBall":
    case "substitution":
    case "timeout":
    case "periodEnd":
    case "challenge":
      return false;
  }
}

/** Swift's `Equatable` for scenes: every field the same. */
export function sameScene(a: BasketballScene | null, b: BasketballScene | null): boolean {
  return a === b || (a != null && b != null && JSON.stringify(a) === JSON.stringify(b));
}

/**
 * What the basketball theater tells: the newest plays, every kind, in game
 * order, and which of them are news (arrived while the page was open, or
 * only just happened); history is never told, only the court it left.
 * `heard`: when the lane last brought a new play (epoch ms), the heartbeat
 * counts from here.
 */
export interface BasketballTheaterState {
  readonly plays: readonly BasketballScene[];
  readonly news: ReadonlySet<string>;
  readonly heard: number | null;
}

/** The newest play worth a full replay (the marquee), news or not. */
export function marqueeOf(state: BasketballTheaterState): BasketballScene | null {
  for (let i = state.plays.length - 1; i >= 0; i--) if (replays(state.plays[i]!)) return state.plays[i]!;
  return null;
}

// MARK: - Swift JSON's coercions

/** `JSON.string`: a string, or a number's digits. */
function string(v: JSONValue): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

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

/** `JSON.bool`: a boolean (or a number's truth, as NSNumber reads it). */
function truth(v: JSONValue): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  return null;
}

const typeOf = (play: JSONValue) => int(at(play, "type", "id"));
const periodOf = (play: JSONValue) => int(at(play, "period", "number"));
const clockOf = (play: JSONValue) => string(at(play, "clock", "displayValue"));
const teamOf = (play: JSONValue) => string(at(play, "team", "id"));
const shooting = (play: JSONValue) => truth(at(play, "shootingPlay")) === true;
const scoring = (play: JSONValue) => truth(at(play, "scoringPlay")) === true;

// MARK: - Parsing

/** Substitutions, timeouts, reviews and challenges: nothing moves on the court. */
export const ADMIN: ReadonlySet<number> = new Set([584, 16, 17, 10, 18, 213, 214, 215, 216, 277, 278, 279, 280, 281]);
/** Tips and putbacks of every kind. */
export const PUTBACK_TYPES: ReadonlySet<number> = new Set([94, 125, 138, 150]);
/** Layups of every kind, alley-oops' too. */
export const LAYUP_TYPES: ReadonlySet<number> = new Set([95, 109, 110, 111, 112, 126, 127, 128, 129, 141, 142]);
/** Reverse finishes. */
export const REVERSE_TYPES: ReadonlySet<number> = new Set([112, 117, 126, 127]);

/** The newest play worth replaying among the last `reach` of `plays` (only the newest are ever looked at). */
export function basketballNewest(plays: readonly JSONValue[], teams: Teams, reach = 12): BasketballScene | null {
  for (let index = plays.length - 1; index >= 0 && index >= plays.length - reach; index--) {
    const s = parseScene(plays, index, teams);
    if (s && replays(s)) return s;
  }
  return null;
}

/** The newest `count` plays of `plays` as scenes, every kind the theater tells, in ESPN's order. */
export function basketballRecent(plays: readonly JSONValue[], teams: Teams, count = 40): BasketballScene[] {
  const out: BasketballScene[] = [];
  for (let i = Math.max(plays.length - count, 0); i < plays.length; i++) {
    const s = parseScene(plays, i, teams);
    if (s) out.push(s);
  }
  return out;
}

/**
 * The play at `index` of `plays` (in ESPN's order) as a scene; null for one
 * the theater has nothing to tell of (a placeholder, a type it doesn't know).
 */
export function parseScene(plays: readonly JSONValue[], index: number, teams: Teams): BasketballScene | null {
  if (!(index >= 0 && index < plays.length)) return null;
  const play = plays[index];
  const id = string(at(play, "id"));
  if (id == null) return null;
  const type = typeOf(play);
  const typeText = (string(at(play, "type", "text")) ?? "").replaceAll("\n", " ");
  const text = plain(string(at(play, "text")) ?? "").replaceAll(" 's ", "'s ");
  const raw = string(at(play, "text")) ?? "";
  const parts = roles(play);
  let kind: BasketballKind;
  let move: BasketballMove;
  let shot: BasketballKind | null = null;
  let result: BasketballResult = "miss";
  let theCall: Call | null = null;
  if (shooting(play)) {
    const scored = scoring(play) && (int(at(play, "scoreValue")) ?? 1) > 0;
    const blocked = !scored && parts.some((p) => p.role === "blocker");
    result = scored ? "make" : blocked ? "blocked" : "miss";
    if (isFreeThrow(play)) {
      kind = "freeThrow";
      move = "set";
      shot = "freeThrow";
    } else {
      const assisted = parts.some((p) => p.role === "assister");
      const f = form(type, string(at(play, "type", "text")) ?? "", assisted, distance(play));
      kind = blocked ? "block" : f.kind;
      move = f.move;
      shot = f.kind;
    }
  } else if (type === 156 || type === 155) {
    kind = type === 156 ? "offensiveRebound" : "defensiveRebound";
    move = "tip";
  } else if (type != null && TURNOVER_TYPES.has(type) && type !== 61) {
    kind = parts.some((p) => p.role === "defender") || participants(play).length > 1 ? "steal" : "turnover";
    move = "drive";
    theCall = lossCall(type, typeText);
  } else {
    const foul = foulCall(type, typeText);
    const violation = foul ? null : violationCall(type, typeText);
    move = "set";
    if (foul) {
      kind = "foul";
      move = "drive";
      theCall = foul;
    } else if (violation) {
      kind = "violation";
      move = "drive";
      theCall = violation;
    } else if (type === 615) kind = "jumpBall";
    else if (type === 584) kind = "substitution";
    else if (periodEnd(play) != null) kind = "periodEnd";
    else if (isReview(type, raw)) kind = "challenge";
    else if ([16, 17, 10, 18].includes(type ?? 0) || typeText.toLowerCase().includes("timeout")) kind = "timeout";
    else return null;
  }

  const s = scene(id, kind, shot, move, result);
  s.offense = sideIn(teams)(teamOf(play));
  s.typeID = type;
  s.typeText = typeText;
  s.call = theCall;
  s.text = text;
  s.period = periodOf(play);
  s.clock = clockOf(play) ?? "";
  s.wallclock = parseDate(string(at(play, "wallclock")));
  const score = liveScore(play);
  if (score) {
    s.top = teams.topIsHome ? score.home : score.away;
    s.bottom = teams.topIsHome ? score.away : score.home;
  }
  const x = double(at(play, "coordinate", "x"));
  const y = double(at(play, "coordinate", "y"));
  if (x != null && y != null && x > -1000 && y > -1000) s.spot = { x, y };
  if (kind === "freeThrow") s.spot = { x: 25, y: 15 };
  s.distance = distance(play) ?? (s.spot ? Math.round(Math.hypot(s.spot.x - 25, s.spot.y - 1.25)) : null);
  if (shot != null) {
    s.value = kind === "freeThrow" ? 1 : shotValue(play, s.spot?.x ?? 25, s.spot?.y ?? 1);
    s.points = made(s) ? (int(at(play, "scoreValue")) ?? s.value) : 0;
    // A jump shot from beyond the arc is a three.
    if (s.value === 3 && s.shot === "jumper") {
      s.shot = "three";
      if (s.kind === "jumper") s.kind = "three";
    }
  }
  s.reverse = type != null && REVERSE_TYPES.has(type);
  s.dunk = made(s) || result === "blocked" ? type != null && DUNK_TYPES.has(type) : false;

  // Who: the credited parts, named from the text.
  const person = (role: string, fallback: number | null, named: string | null): Person | null => {
    const entry = parts.find((p) => p.role === role) ?? (fallback != null && fallback < parts.length && parts[fallback]!.role == null ? parts[fallback]! : null);
    if (entry?.id == null && named == null) return null;
    return { id: entry?.id ?? null, name: named != null ? surname(named) : "", role: entry?.position != null ? roleOf(entry.position) : null };
  };
  const named = names(raw);
  switch (kind) {
    case "steal":
    case "turnover":
      s.shooter = person("offense", 0, named.loser ?? leadingName(raw));
      s.steal = { spot: s.spot, loser: s.shooter, stealer: kind === "steal" ? person("defender", 1, named.stealer) : null, id };
      break;
    case "offensiveRebound":
    case "defensiveRebound":
      s.shooter = person("rebounder", 0, named.rebounder);
      s.miss = shotBefore(index, plays);
      break;
    case "foul":
    case "violation": {
      s.shooter = person("fouler", 0, leadingName(raw));
      // Who drew it, and how many shots it gave: the free throws at its clock, by the other team.
      const trip = freeThrows(index, plays);
      s.trip = trip.attempts ?? (trip.shooter != null ? 1 : null);
      s.drew = trip.shooter;
      if (theCall?.kind === "offensive" || theCall?.kind === "charge") {
        // ESPN logs the turnover again, at the same clock.
        const again = sameClock(index, plays, 3, (p) => typeOf(p) === 84);
        s.follows = again != null ? [again] : [];
      }
      break;
    }
    case "jumpBall": {
      // "A vs. B (C gains possession)": both jumpers, then who came up with it.
      const m = /^(.+?) vs\. (.+?) \((.+?) gains possession\)/.exec(raw);
      const people = [0, 1, 2].map((i): Person | null => {
        const entry = i < parts.length ? parts[i]! : null;
        const n = m?.[i + 1] ?? null;
        if (entry?.id == null && n == null) return null;
        return { id: entry?.id ?? null, name: n != null ? surname(n) : "", role: entry?.position != null ? roleOf(entry.position) : null };
      });
      s.jumpers = people.slice(0, 2).filter((p): p is Person => p != null);
      s.winner = people[2] ?? null;
      break;
    }
    case "substitution": {
      const m = /^(.+?) enters the game for (.+)$/.exec(raw);
      s.subIn = person("subin", 0, m?.[1] ?? null);
      s.subOut = person("subout", 1, m?.[2] != null ? m[2].trim() : null);
      break;
    }
    case "periodEnd":
      s.final = periodEnd(play)?.final ?? false;
      break;
    case "challenge": {
      const words = raw.toUpperCase();
      s.review = words.includes("REF-INITIATED") || (type != null && type >= 278 && type <= 281);
      s.overturned =
        words.includes("OVERTURNED") || type === 215
          ? true
          : words.includes("STANDS") || words.includes("SUPPORTS") || words.includes("CONFIRMED") || type === 214 || type === 216
            ? false
            : null;
      const team = /\[(.+?)\]/.exec(raw)?.[1];
      if (s.offense == null && team != null) {
        const lower = team.toLowerCase();
        s.offense = teams.topName.toLowerCase() === lower ? "top" : teams.bottomName.toLowerCase() === lower ? "bottom" : null;
      }
      break;
    }
    case "timeout": {
      const words = raw.toLowerCase();
      s.stoppage = words.includes("media") || words.includes("tv timeout") ? "MEDIA TIMEOUT" : words.includes("official") ? "OFFICIAL TIMEOUT" : null;
      break;
    }
    default:
      s.shooter = person("shooter", 0, named.shooter);
      s.assister = made(s) ? person("assister", 1, named.assister) : null;
      s.blocker = result === "blocked" ? person("blocker", 1, named.blocker) : null;
  }
  if (shot == null) return s;
  if (kind === "freeThrow") [s.attempt, s.attempts] = tripOf(type, raw);

  // The moment around it: the margin before and after, the clock.
  let before: ReturnType<typeof liveScore> = { home: 0, away: 0 };
  if (index > 0) {
    before = null;
    for (let j = index - 1; j >= 0; j--) {
      const score = liveScore(plays[j]);
      if (score) {
        before = score;
        break;
      }
    }
  }
  const after = liveScore(play);
  const sign = s.offense === "bottom" ? -1 : 1;
  const marginBefore = (before ?? after) != null ? marginOf(teams, (before ?? after)!) * sign : null;
  const marginAfter = after ? marginOf(teams, after) * sign : null;
  const period = s.period ?? 0;
  const left = seconds(s.clock);
  if (left != null && marginBefore != null) {
    s.clutch = isClutch(period, left, marginBefore);
    // A shot to tie or take the lead, late: a miss that matters, or a free throw that ties it or goes ahead.
    const late = period >= 4 && left <= 30;
    s.lastShot =
      late && (kind === "freeThrow" ? (marginBefore === -1 || marginBefore === 0) && made(s) && isLastFreeThrowOfTrip(play) : marginBefore >= -s.value && marginBefore <= 0);
  }
  if (made(s) && kind !== "freeThrow") {
    s.buzzer = isBuzzer(s.clock);
    if (s.buzzer && period >= 4 && marginBefore != null && marginAfter != null && marginBefore <= 0 && marginAfter >= 0) s.decisive = true;
    if (isAndOne(index, plays, teams)) {
      s.andOne = true;
      s.fouler = andOneFouler(index, plays);
    }
    s.miss = missBefore(index, plays, s.shooter, s.kind);
    if (kind === "putback" || (s.miss != null && (s.distance ?? 99) <= 5)) {
      // Up off the rim: a tip or a putback, whatever ESPN calls the finish.
      if (s.miss != null || PUTBACK_TYPES.has(type ?? 0)) {
        if (kind !== "putback") {
          s.kind = "putback";
          s.shot = "putback";
        }
        s.move = "tip";
      }
    } else {
      s.miss = null;
    }
    s.steal = stealBefore(index, plays, teams);
    // What its replay shows besides: the steal before a break, the miss and the board before a putback, the and-one's foul.
    s.leadIn = [s.steal?.id, s.miss?.id, s.miss?.board].filter((x): x is string => x != null);
    if (s.andOne) {
      const foul = sameClock(index, plays, 8, (p) => typeOf(p) === 44);
      s.follows = foul != null ? [foul] : [];
    }
  }
  if (!made(s)) {
    // A miss ends in its rebound (a free throw's only when it's live: a trip's earlier misses are dead, the bookkeeping rebound after them too).
    const last = (s.attempt ?? 1) >= (s.attempts ?? 1);
    if (kind !== "freeThrow" || last) {
      s.rebound = reboundAfter(index, plays);
    } else {
      const dead = sameClock(index, plays, 2, (p) => typeOf(p) === 155 || typeOf(p) === 156);
      if (dead != null) s.follows = [dead];
    }
    if (s.rebound?.id != null) s.follows = [s.rebound.id];
  }
  return s;
}

/** The kind and the move of a field-goal attempt, from ESPN's type (its words where the number is one it doesn't list, a live placeholder's distance last). */
export function form(type: number | null, typeText: string, assisted: boolean, distance: number | null): { kind: BasketballKind; move: BasketballMove } {
  const words = typeText.toLowerCase();
  const f = (kind: BasketballKind, move: BasketballMove) => ({ kind, move });
  switch (type) {
    case 118:
      return f("alleyOop", "cut");
    case 111:
      return f("alleyOop", "cut");
    case 138:
    case 150:
    case 94:
    case 125:
      return f("putback", "tip");
    case 151:
      return f("dunk", "cut");
    case 96:
      return f("dunk", assisted ? "cut" : "drive");
  }
  if (type != null && DUNK_TYPES.has(type)) return f("dunk", "drive");
  switch (type) {
    case 141:
    case 142:
      return f("layup", "cut");
    case 95:
      return f("layup", assisted ? "cut" : "drive");
  }
  if (type != null && LAYUP_TYPES.has(type)) return f("layup", "drive");
  switch (type) {
    case 131:
    case 133:
    case 146:
    case 113:
    case 134:
      return f("jumper", "pullUp");
    case 132:
      return f("jumper", "stepBack");
    case 121:
    case 137:
      return f("jumper", "fadeaway");
    case 114:
      return f("jumper", "turnaround");
    case 130:
    case 144:
    case 145:
      return f("jumper", "floater");
    case 93:
    case 119:
    case 120:
      return f("jumper", "hook");
    case 282:
      return f("jumper", "pullUp");
  }
  if (words.includes("alley oop")) return f("alleyOop", "cut");
  if (words.includes("tip") || words.includes("putback")) return f("putback", "tip");
  if (words.includes("dunk")) return f("dunk", assisted ? "cut" : "drive");
  if (words.includes("layup") || words.includes("finger roll")) return f("layup", assisted ? "cut" : "drive");
  if (words.includes("step back")) return f("jumper", "stepBack");
  if (words.includes("pullup") || words.includes("pull-up")) return f("jumper", "pullUp");
  if (words.includes("fade")) return f("jumper", "fadeaway");
  if (words.includes("float")) return f("jumper", "floater");
  if (words.includes("hook")) return f("jumper", "hook");
  // A live placeholder ("makes shot"): at the rim, a layup.
  if (distance != null && distance <= 3) return f("layup", assisted ? "cut" : "drive");
  return f("jumper", assisted ? "catchAndShoot" : "pullUp");
}

/** Each participant's part ("shooter", "assister", "blocker", "defender", "rebounder", "fouler") and position, in ESPN's order. */
export function roles(play: JSONValue): { readonly id: string | null; readonly role: string | null; readonly position: string | null }[] {
  return arr(at(play, "participants")).map((p) => ({ id: string(at(p, "athlete", "id")), role: string(at(p, "type")), position: string(at(p, "position", "id")) }));
}

/**
 * ESPN's position (by its ID) as how he plays: point guard, shooting guard
 * and guard on the arc; the forwards on the wing; the power forward, the
 * forward-center and the center inside.
 */
export function roleOf(position: string): Role | null {
  switch (position) {
    case "1":
    case "2":
    case "3":
      return "guard";
    case "4":
    case "5":
    case "7":
      return "wing";
    case "6":
    case "8":
    case "9":
      return "big";
    default:
      return null;
  }
}

/** ESPN's distance ("23-foot") as feet. */
export function distance(play: JSONValue): number | null {
  const m = /(\d+)-foot/.exec(string(at(play, "text")) ?? "");
  return m ? Number(m[1]) : null;
}

/** The names the text gives each part (full names: "Mikel Brown Jr."). */
export function names(full: string): {
  shooter: string | null;
  assister: string | null;
  blocker: string | null;
  stealer: string | null;
  loser: string | null;
  rebounder: string | null;
  fouler: string | null;
} {
  const text = full.replaceAll("\n", " ");
  let shooter = /^(.+?) (?:makes|misses) /.exec(text)?.[1] ?? null;
  let blocker: string | null = null;
  const block = /^(.+?) blocks (.+?) ?'s /.exec(text);
  if (block) {
    blocker = block[1]!;
    shooter = block[2]!;
  }
  const assister = /\((.+?) assists\)/.exec(text)?.[1] ?? null;
  const stealer = /\((.+?) steals\)/.exec(text)?.[1] ?? null;
  const loser =
    /^(.+?) (?:bad pass|lost ball|out of bounds|traveling|offensive|shot clock|3-second|step out|palming|double dribble|discontinued|kicked|backcourt|inbound|turnover|lane violation)/.exec(text)?.[1] ?? null;
  const rebounder = text.includes("team rebound") ? null : (/^(.+?) (?:offensive|defensive) rebound/.exec(text)?.[1] ?? null);
  const fouler = /^(.+?) (?:shooting|personal|loose ball|flagrant)/.exec(text)?.[1] ?? null;
  return { shooter, assister, blocker, stealer, loser, rebounder, fouler };
}

/** The surname a stamp gives a player, his suffix kept: "Mikel Brown Jr." → "Brown Jr.", "Karl-Anthony Towns" → "Towns", "Ronald Holland II" → "Holland II". (pure; tested) */
export function surname(full: string): string {
  const words = full.split(" ").filter((w) => w.length > 0);
  const last = words.at(-1);
  if (last == null) return full;
  if (["Jr.", "Sr.", "Jr", "Sr", "II", "III", "IV", "V"].includes(last) && words.length >= 2) return `${words[words.length - 2]} ${last}`;
  return last;
}

/** Plays that move something on the court, back from `index` (not including it). */
function courtIndices(index: number, plays: readonly JSONValue[], limit: number): number[] {
  const out: number[] = [];
  let j = index - 1;
  while (j >= 0 && out.length < limit) {
    if (!ADMIN.has(typeOf(plays[j]) ?? 0)) out.push(j);
    j -= 1;
  }
  return out;
}

function elapsedOf(play: JSONValue): number | null {
  const period = periodOf(play);
  return period == null ? null : gameElapsed(period, clockOf(play) ?? "");
}

const CLOSE: ReadonlySet<BasketballKind> = new Set(["layup", "dunk", "alleyOop", "putback"]);

/** The miss a make came off: the offensive rebound right before it by the shooter's team, and the miss before that, within six seconds. */
export function missBefore(index: number, plays: readonly JSONValue[], shooter: Person | null, kind: BasketballKind): Miss | null {
  const back = courtIndices(index, plays, 2);
  if (back.length !== 2) return null;
  const play = plays[index];
  const board = plays[back[0]!];
  const missed = plays[back[1]!];
  const team = teamOf(play);
  const x = double(at(missed, "coordinate", "x"));
  const y = double(at(missed, "coordinate", "y"));
  const a = elapsedOf(missed);
  const b = elapsedOf(play);
  if (
    !(
      typeOf(board) === 156 &&
      teamOf(board) === team &&
      shooting(missed) &&
      !scoring(missed) &&
      !isFreeThrow(missed) &&
      teamOf(missed) === team &&
      x != null &&
      y != null &&
      x > -1000 &&
      y > -1000 &&
      a != null &&
      b != null &&
      b - a <= 6
    )
  ) {
    return null;
  }
  // The putback is the rebounder's: someone else's rebound and a long shot is a kick-out, not a putback.
  const rebounder = roles(board)[0]?.id ?? null;
  if (!(rebounder == null || rebounder === shooter?.id || kind === "putback")) return null;
  const f = form(typeOf(missed), string(at(missed, "type", "text")) ?? "", false, distance(missed));
  const people = roles(missed);
  const who = people.find((p) => p.role === "shooter")?.id ?? people[0]?.id ?? null;
  const name = names(string(at(missed, "text")) ?? "").shooter;
  return {
    spot: { x, y },
    shooter: { id: who, name: name != null ? surname(name) : "" },
    value: shotValue(missed, x, y),
    close: CLOSE.has(f.kind),
    id: string(at(missed, "id")),
    board: string(at(board, "id")),
    distance: distance(missed),
  };
}

/** The steal a basket came from: the play right before it, a turnover the scoring team took, within nine seconds. */
export function stealBefore(index: number, plays: readonly JSONValue[], teams: Teams): Steal | null {
  const j = courtIndices(index, plays, 1)[0];
  if (j == null) return null;
  const s = parseScene(plays, j, teams);
  if (!s || s.kind !== "steal") return null;
  const side = sideIn(teams)(teamOf(plays[index]));
  if (side == null || s.offense !== (side === "top" ? "bottom" : "top")) return null;
  const a = elapsedOf(plays[j]);
  const b = elapsedOf(plays[index]);
  if (a == null || b == null || !(b - a <= 9)) return null;
  return s.steal;
}

/** The defender on a made basket's and-one: the shooting foul at its clock. */
export function andOneFouler(index: number, plays: readonly JSONValue[]): Person | null {
  const play = plays[index];
  for (const next of plays.slice(index + 1, index + 9)) {
    if (periodOf(next) !== periodOf(play) || clockOf(next) !== clockOf(play)) break;
    if (typeOf(next) !== 44) continue;
    const people = roles(next);
    const id = people.find((p) => p.role === "fouler")?.id ?? people[0]?.id ?? null;
    const named = names(string(at(next, "text")) ?? "").fouler;
    const name = named != null ? surname(named) : null;
    return id == null && name == null ? null : { id, name: name ?? "" };
  }
  return null;
}

/** Who got a miss: the first rebound among the next plays, unless the ball went another way first. */
export function reboundAfter(index: number, plays: readonly JSONValue[]): Rebound | null {
  let j = index + 1;
  let looked = 0;
  while (j < plays.length && looked < 4) {
    const next = plays[j];
    j += 1;
    const type = typeOf(next);
    if (ADMIN.has(type ?? 0)) continue;
    looked += 1;
    if (type === 155 || type === 156) {
      const name = names(string(at(next, "text")) ?? "").rebounder;
      const entry = roles(next)[0];
      const id = entry?.id ?? null;
      return {
        person: id == null && name == null ? null : { id, name: name != null ? surname(name) : "", role: entry?.position != null ? roleOf(entry.position) : null },
        offensive: type === 156,
        id: string(at(next, "id")),
      };
    }
    if (type != null && (TURNOVER_TYPES.has(type) || OFFENSIVE_FOUL_TYPES.has(type))) return null;
    // A foul on the shot, a loose-ball foul: keep looking.
    if (shooting(next)) return null;
  }
  return null;
}

// MARK: - The lighter beats

/** A turnover's kind, from ESPN's type (its words for the rest). */
export function lossCall(type: number, words: string): Call {
  switch (type) {
    case 62:
      return call("badPass");
    case 63:
      return call("lostBall");
    case 87:
    case 90:
      return call("outOfBounds");
    case 64:
      return call("traveling");
    case 70:
      return call("shotClock");
    case 73:
      return call("offensiveGoaltending");
    case 84:
      return call("offensive");
    default:
      return { kind: "other", words: typeCallWords(words) };
  }
}

/** A foul's kind, from its type (its words for one it doesn't list); null for a play that isn't a foul. */
export function foulCall(type: number | null, words: string): Call | null {
  switch (type) {
    case 44:
      return call("shooting");
    case 45:
    case 40:
      return call("personal");
    case 43:
      return call("looseBall");
    case 22:
      return call("take");
    case 31:
    case 32:
      return call("flagrant");
    // Technicals: a defensive three seconds, a double, a flop.
    case 35:
    case 29:
    case 30:
    case 48:
      return call("technical");
    case 42:
      return call("offensive");
    case 24:
      return call("charge");
  }
  const w = words.toLowerCase();
  if (!w.includes("foul") || w.includes("turnover")) return null;
  if (w.includes("offensive")) return call("offensive");
  if (w.includes("shooting")) return call("shooting");
  if (w.includes("technical")) return call("technical");
  if (w.includes("flagrant")) return call("flagrant");
  if (w.includes("loose")) return call("looseBall");
  return call("personal");
}

/** A violation the ball stays with the offense on (a kicked ball, goaltending, a delay); null for a play that isn't one. */
export function violationCall(type: number | null, words: string): Call | null {
  switch (type) {
    case 12:
      return call("kickedBall");
    case 9:
      return call("goaltending");
    case 8:
      return call("delay");
  }
  const w = words.toLowerCase();
  if (!w.includes("violation")) return null;
  if (w.includes("kicked")) return call("kickedBall");
  if (w.includes("goaltending")) return call("goaltending");
  if (w.includes("delay")) return call("delay");
  return { kind: "other", words: typeCallWords(words) };
}

/** ESPN's type in a tag's words: "Double Dribble Turnover" → "DOUBLE DRIBBLE". */
export function typeCallWords(typeText: string): string {
  let w = typeText.toUpperCase().replaceAll("\n", " ");
  for (const tail of [" TURNOVER", " VIOLATION"]) if (w.endsWith(tail)) w = w.slice(0, w.length - tail.length);
  return w.trim();
}

/** A coach's challenge or a referees' review: types 213–216 and 277–281, the words for any other. */
export function isReview(type: number | null, text: string): boolean {
  if (type != null && ((type >= 213 && type <= 216) || (type >= 277 && type <= 281))) return true;
  const w = text.toUpperCase();
  return w.includes("CHALLENGE") || w.includes("REVIEW");
}

/** The name a play's text leads with: its words up to the first in lower case ("De'Aaron Fox traveling turnover" → "De'Aaron Fox"); null when it leads with none ("shot clock turnover"). */
export function leadingName(text: string): string | null {
  const words: string[] = [];
  for (const word of text.replaceAll("\n", " ").split(" ").filter((w) => w.length > 0)) {
    const first = word[0]!;
    if (!(first !== first.toLowerCase() && first === first.toUpperCase())) break;
    words.push(word);
  }
  if (words.length === 0 || words[0] === "Double") return null;
  return words.join(" ");
}

/** The shot a rebound came off: the newest attempt before it (a field goal or a free throw; a foul between them aside), where ESPN put it. */
export function shotBefore(index: number, plays: readonly JSONValue[]): Miss | null {
  for (const j of courtIndices(index, plays, 3)) {
    const shot = plays[j];
    if (!shooting(shot)) {
      if (DEFENSIVE_FOUL_TYPES.has(typeOf(shot) ?? 0)) continue;
      return null;
    }
    if (scoring(shot) && (int(at(shot, "scoreValue")) ?? 1) !== 0) return null;
    const free = isFreeThrow(shot);
    const x = double(at(shot, "coordinate", "x")) ?? -1e9;
    const y = double(at(shot, "coordinate", "y")) ?? -1e9;
    const spot = free || x < -1000 || y < -1000 ? { x: 25, y: 15 } : { x, y };
    const close = !free && CLOSE.has(form(typeOf(shot), string(at(shot, "type", "text")) ?? "", false, distance(shot)).kind);
    const r = roles(shot);
    const who = r.find((p) => p.role === "shooter") ?? r[0] ?? null;
    const name = names(string(at(shot, "text")) ?? "").shooter;
    return {
      spot,
      shooter: { id: who?.id ?? null, name: name != null ? surname(name) : "", role: who?.position != null ? roleOf(who.position) : null },
      value: free ? 1 : shotValue(shot, spot.x, spot.y),
      close,
      id: string(at(shot, "id")),
      blocked: r.some((p) => p.role === "blocker"),
      freeThrow: free,
      distance: free ? 14 : (distance(shot) ?? Math.round(Math.hypot(spot.x - 25, spot.y - 1.25))),
    };
  }
  return null;
}

/** The free throws a whistle gave, at its clock, by the other team: who shot them, and how many the trip is. */
export function freeThrows(index: number, plays: readonly JSONValue[]): { shooter: Person | null; attempts: number | null } {
  const play = plays[index];
  for (const next of plays.slice(index + 1, index + 13)) {
    if (periodOf(next) !== periodOf(play) || clockOf(next) !== clockOf(play)) break;
    if (!(shooting(next) && isFreeThrow(next) && teamOf(next) !== teamOf(play))) continue;
    const r = roles(next)[0];
    const name = names(string(at(next, "text")) ?? "").shooter;
    const person: Person = { id: r?.id ?? null, name: name != null ? surname(name) : "", role: r?.position != null ? roleOf(r.position) : null };
    return { shooter: person, attempts: tripOf(typeOf(next), string(at(next, "text")) ?? "")[1] };
  }
  return { shooter: null, attempts: null };
}

/** The first play after `index` at its period and clock (within `limit`) that `match`es: its ID. */
export function sameClock(index: number, plays: readonly JSONValue[], limit: number, match: (play: JSONValue) => boolean): string | null {
  const play = plays[index];
  for (const next of plays.slice(index + 1, index + 1 + limit)) {
    if (periodOf(next) !== periodOf(play) || clockOf(next) !== clockOf(play)) break;
    if (match(next)) return string(at(next, "id"));
  }
  return null;
}

/** A free throw's place in its trip: by its type (98 is 1 of 2), else its words ("flagrant 1 of 2"); a technical stands alone. */
export function tripOf(type: number | null, text: string): [number | null, number | null] {
  switch (type) {
    case 97:
      return [1, 1];
    case 98:
      return [1, 2];
    case 99:
      return [2, 2];
    case 100:
      return [1, 3];
    case 101:
      return [2, 3];
    case 102:
      return [3, 3];
  }
  const m = /(\d) of (\d)/.exec(text);
  if (m) return [Number(m[1]), Number(m[2])];
  return type === 103 || text.toLowerCase().includes("technical") ? [1, 1] : [null, null];
}

/** The trip's last free throw ("2 of 2"), not a technical. */
function isLastFreeThrowOfTrip(play: JSONValue): boolean {
  return typeOf(play) !== 103 && isLastFreeThrow(play);
}

/** "2026-10-27T23:41:17Z", as epoch ms. */
function parseDate(s: string | null): number | null {
  if (s == null) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}
