/**
 * The football theater's model (FootballScene.swift): one snap (or kick)
 * parsed from ESPN's core play-by-play into what the theater replays: the
 * kind of play, where the ball was snapped and where it ended up, the hole a
 * run went through or the depth and side of a pass, where the ball changed
 * hands or came down, the downs before and after, the flag and its yards,
 * and who was in on it by position. Pure values: the parser is tested
 * against a real game, and the replay is a function of the scene and time.
 *
 * Spots are yards from the offense's own goal line (0…100; the end zones
 * beyond), whoever has the ball after. ESPN counts its `yardLine` from the
 * home team's goal line (as the drive chart reads it, through
 * `FootballGeometry`); the text's spots ("to DAL 32") are read the same way.
 * Structured fields decide the play (its type, the spots, the scoring and
 * turnover flags); the text adds what only it says: the direction, the
 * depth, out of bounds, a touchback or a fair catch, and the spots in between.
 */
import { arr, at, bool, int, num, str, type JSONValue } from "../json";
import { teamSide, type FootballTeams } from "../liveFeeds/football";
import type { Side } from "../models";

export type Kind =
  | { readonly type: "pass" | "incomplete" | "rush" | "sack" | "kneel" | "spike" }
  | { readonly type: "interception" }
  /** Lost: the other team recovered (a fumble the offense keeps is its run or sack). */
  | { readonly type: "fumble" }
  | { readonly type: "punt" | "kickoff" }
  | { readonly type: "fieldGoal"; readonly good: boolean }
  | { readonly type: "extraPoint"; readonly good: boolean }
  /** A flag that wiped out the snap, or stopped it: yards walked off. */
  | { readonly type: "penalty" }
  /** A play we can't name: the ball goes from its spot to where it ended. */
  | { readonly type: "other" };

export type KindName = Kind["type"];

/** The offense's left and right (the theater stands behind it). */
export type Lane = "left" | "middle" | "right";

/** Where a run went in: "left guard", "right tackle", "left end", "up the middle". */
export type Gap = "middle" | "guard" | "tackle" | "end";

export type Depth = "short" | "deep";

export type Scoring = "touchdown" | "fieldGoal" | "safety";

/** How a kick ended for the team receiving it. */
export type Kick = "returned" | "fairCatch" | "downed" | "outOfBounds" | "touchback";

export type Miss = "wideLeft" | "wideRight" | "short" | "blocked";

/**
 * How the offense lined up, as far as the play says (in the gun or under
 * center is `shotgun`). base: three wide and a tight end (under center on a
 * run, a fullback and two wide); heavy: an extra lineman reported in as
 * eligible (two tight ends, a fullback, one wide); empty: nobody behind the
 * quarterback, five out wide; bunch: three receivers bunched tight on one
 * side; victory: the kneel, a back at each of the quarterback's hips, one deep.
 */
export type Formation = "base" | "heavy" | "empty" | "bunch" | "victory";

/**
 * The try after a touchdown, as the touchdown's entry tells it (ESPN adds it
 * once it's taken): a kick, or a pass or a run from the 2.
 */
export interface Attempt {
  readonly kind: "kick" | "pass" | "rush";
  readonly good: boolean;
  /** Its own words ("B.Aubrey extra point is GOOD, Center-T.Sieg, Holder-B.Anger."). */
  readonly text: string;
}

/** ESPN's positions, as the theater stands them up. */
export type Position =
  | "quarterback"
  | "back"
  | "fullback"
  | "receiver"
  | "tightEnd"
  | "lineman"
  | "defensiveLine"
  | "linebacker"
  | "corner"
  | "safety"
  | "kicker"
  | "punter"
  | "snapper";

export const isDefense = (p: Position): boolean => p === "defensiveLine" || p === "linebacker" || p === "corner" || p === "safety";

/** ESPN's position IDs ("…/positions/8"): QB 8, RB 9, FB 10, WR 1, TE 7, PK 22, P 23, LS 78; the line and the defense by group. */
export function positionFromESPN(id: number): Position | null {
  if (id === 8) return "quarterback";
  if (id === 9) return "back";
  if (id === 10) return "fullback";
  if (id === 1) return "receiver";
  if (id === 7) return "tightEnd";
  if ((id >= 2 && id <= 6) || id === 46 || (id >= 70 && id <= 77) || id === 79) return "lineman";
  if ((id >= 11 && id <= 13) || id === 31 || id === 32) return "defensiveLine";
  if ((id >= 14 && id <= 16) || id === 30 || (id >= 33 && id <= 35)) return "linebacker";
  if (id === 17 || id === 18 || id === 29) return "corner";
  if (id === 19 || id === 20 || (id >= 36 && id <= 38)) return "safety";
  if (id === 22) return "kicker";
  if (id === 23) return "punter";
  if (id === 78) return "snapper";
  return null;
}

/** Someone in on the play: their part ("rusher", "tackler", "sackedBy"), athlete ID and position. */
export interface Participant {
  readonly role: string;
  readonly id: string | null;
  readonly position: Position | null;
}

/** The down and distance at a spot ("3rd & 7"). */
export interface Down {
  readonly down: number;
  readonly distance: number;
}

export interface Penalty {
  /** "Offensive Holding". */
  readonly name: string | null;
  readonly yards: number;
  /** The snap didn't count ("… - No Play"). */
  readonly noPlay: boolean;
}

export const opponent = (side: Side): Side => (side === "top" ? "bottom" : "top");

/** Swift's `.rounded()`: half away from zero (Math.round rounds half up). */
export const rounded = (x: number): number => Math.sign(x) * Math.round(Math.abs(x));

export class FootballScene {
  readonly id: string;
  kind: Kind;
  /** The team that snapped or kicked. */
  offense: Side | null;
  /** Where the ball was snapped (or kicked from) and where it ended up. */
  from: number;
  to: number;
  before: Down | null = null;
  /** The downs after, for whoever has the ball (null after a score or a kick). */
  after: Down | null = null;
  /** ESPN's yards: the gain, a kick's return, a penalty's. */
  yards = 0;
  lane: Lane | null = null;
  gap: Gap | null = null;
  depth: Depth | null = null;
  shotgun = false;
  formation: Formation = "base";
  /**
   * Where the ball was spotted across the field, in the offense's frame: on
   * the left or right hash, or between them. The text never says: the feed
   * works it out from the plays before (`spot`, footballTheater.ts).
   */
  hash: Lane = "middle";
  outOfBounds = false;
  /** A pass: yards past the line where it was caught or thrown to (ESPN's yards after the catch, else the text's depth). */
  air: number | null = null;
  /** Where the ball changed hands or came down: the interception, the fumble's recovery, a kick's landing. */
  turn: number | null = null;
  /** Where the ball was put on the ground or popped loose (a fumble). */
  loose: number | null = null;
  /** Where the ball carrier was stopped before a flag's yards were walked off. */
  stopped: number | null = null;
  kick: Kick | null = null;
  /** A kick's length ("kicks 59 yards", "55 yard field goal"). */
  kickYards: number | null = null;
  miss: Miss | null = null;
  scoring: Scoring | null = null;
  /** The ball changed hands on the play (a turnover, a kick, fourth down). */
  flips = false;
  onDowns = false;
  penalty: Penalty | null = null;
  /** A touchdown's try, once its entry has it. */
  attempt: Attempt | null = null;
  /** On a try's own scene: how the point (or two) after was tried. */
  pointAfter: Attempt["kind"] | null = null;
  participants: Participant[] = [];
  /** Short names by part, from the text ("Barkley"). */
  names: Record<string, string> = {};
  text = "";
  /** Epoch milliseconds. */
  wallclock: number | null = null;

  constructor(id: string, kind: Kind, offense: Side | null, from: number, to: number) {
    this.id = id;
    this.kind = kind;
    this.offense = offense;
    this.from = from;
    this.to = to;
  }

  /** A copy to change (Swift's `var copy = scene`). */
  clone(): FootballScene {
    const copy = new FootballScene(this.id, this.kind, this.offense, this.from, this.to);
    Object.assign(copy, this);
    copy.participants = [...this.participants];
    copy.names = { ...this.names };
    return copy;
  }

  /** The line to gain before the snap; null on goal to go. */
  get gainBefore(): number | null {
    const before = this.before;
    if (!before || !(before.down > 0) || !(this.from + before.distance < 100)) return null;
    return this.from + before.distance;
  }

  /**
   * The line to gain after it, for whoever has the ball (the other team
   * goes the other way); null on goal to go, after a score or a kick off.
   */
  get gainAfter(): number | null {
    const after = this.after;
    if (!after || !(after.down > 0) || this.scoring != null) return null;
    const line = this.flips ? this.to - after.distance : this.to + after.distance;
    return line > 0 && line < 100 ? line : null;
  }

  /** A new set of downs for the same team: past the line to gain, or a flag's first down (the distance reset rather than walked off). */
  get firstDown(): boolean {
    const { after, before } = this;
    if (this.flips || this.scoring != null || !after || after.down !== 1 || !before || !(before.down > 0)) return false;
    return before.down > 1 || this.to >= this.from + before.distance - 0.01 || after.distance > before.distance - (this.to - this.from) + 0.5;
  }

  /** A kick's return, from where it was caught to where he was stopped. */
  get returnYards(): number | null {
    if (this.turn == null || !(this.kind.type === "kickoff" || this.kind.type === "punt") || this.kick !== "returned") return null;
    return rounded(this.turn - (this.stopped ?? this.to));
  }

  /** The team whose points they are. */
  get scorer(): Side | null {
    const { scoring, offense } = this;
    if (!scoring || !offense) return null;
    switch (scoring) {
      case "fieldGoal":
        return offense;
      case "safety":
        return opponent(offense);
      case "touchdown":
        return this.to <= 0.5 ? opponent(offense) : offense;
    }
  }

  /** The team without the ball. */
  get defense(): Side | null {
    return this.offense ? opponent(this.offense) : null;
  }

  get pickSix(): boolean {
    return this.kind.type === "interception" && this.scoring === "touchdown";
  }

  /** The first participant in a part. */
  position(role: string): Position | null {
    return this.participants.find((p) => p.role === role)?.position ?? null;
  }

  /** Everyone credited with the stop, by position. */
  get tacklers(): (Position | null)[] {
    return this.participants.filter((p) => p.role === "tackler" || p.role === "assistedBy").map((p) => p.position);
  }

  /**
   * A touchdown's try as a scene of its own, replayed as a short beat after
   * it: the kick from the 15, or the pass or run from the 2, by the team that
   * scored, from the middle of the field.
   */
  get conversion(): FootballScene | null {
    const attempt = this.attempt;
    const side = this.scorer;
    if (!attempt || this.scoring !== "touchdown" || !side) return null;
    const kick = attempt.kind === "kick";
    const from = kick ? 85 : 98;
    const kind: Kind = attempt.kind === "kick" ? { type: "extraPoint", good: attempt.good } : attempt.kind === "pass" ? { type: attempt.good ? "pass" : "incomplete" } : { type: "rush" };
    const scene = new FootballScene(`${this.id}-try`, kind, side, from, kick ? from : attempt.good ? 100 : attempt.kind === "rush" ? 99 : from);
    scene.pointAfter = attempt.kind;
    scene.text = attempt.text;
    scene.wallclock = this.wallclock;
    scene.scoring = attempt.good && !kick ? "touchdown" : null;
    scene.yards = attempt.good && !kick ? 2 : 0;
    scene.shotgun = attempt.kind === "pass";
    const lower = attempt.text.toLowerCase();
    const run = RUN_WAY.exec(lower);
    const thrown = run ? null : /pass (?:short |deep )?(left|middle|right)/.exec(lower);
    if (run) {
      scene.lane = lane(run[1]!);
      scene.gap = run[2] === "end" ? "end" : run[2] === "tackle" ? "tackle" : "guard";
    } else if (thrown) {
      scene.lane = lane(thrown[1]!);
      scene.depth = "short";
    } else if (lower.includes("middle")) {
      scene.lane = "middle";
      scene.gap = "middle";
    }
    scene.names = names(attempt.text);
    // The quarterback who threw the touchdown keeps it himself.
    const passer = this.names.lead;
    if (attempt.kind === "rush" && kind.type === "rush" && this.kind.type === "pass" && passer != null && scene.names.lead === passer) {
      scene.participants = [{ role: "rusher", id: null, position: "quarterback" }];
    }
    return scene;
  }

  /**
   * Where the next snap is spotted across the field, in the next offense's
   * frame: on the hash nearest where this play ended (between the hashes,
   * where it lay; over the side it went out of bounds); back where it was
   * after an incompletion or a flag; in the middle after a score, a kick off
   * or a return. The other way round when the ball changed hands. (pure; tested)
   */
  get nextHash(): Lane {
    if (this.scoring != null) return "middle";
    let side: Lane;
    switch (this.kind.type) {
      case "kickoff":
      case "extraPoint":
        return "middle";
      case "punt":
        // Out of bounds where the punter aimed it (his right); else the return's end isn't known.
        side = this.kick === "outOfBounds" ? "right" : "middle";
        break;
      case "fieldGoal":
        // A miss: the spot of the kick, the holder's.
        side = this.hash;
        break;
      case "incomplete":
      case "spike":
      case "penalty":
      case "kneel":
      case "sack":
        side = this.hash;
        break;
      case "pass":
      case "rush":
      case "other":
      case "fumble":
      case "interception":
        side = this.lane ?? this.hash;
        break;
    }
    if (!this.flips) return side;
    return side === "left" ? "right" : side === "right" ? "left" : "middle";
  }
}

/** Swift's `scene.kind == .fieldGoal(good: true)`, without the payload when `good` is left out. */
export function kindIs(kind: Kind, type: KindName, good?: boolean): boolean {
  if (kind.type !== type) return false;
  return good == null || ("good" in kind && kind.good === good);
}

/** What the football theater shows: the last snap, and whether to replay it. */
export interface FootballTheaterState {
  readonly play: FootballScene | null;
  /** Arrived while the page was open, or only just happened: replay it. */
  readonly news: boolean;
}

export const EMPTY_FOOTBALL_THEATER: FootballTheaterState = { play: null, news: false };

// MARK: - Parsing

/** Clock stoppages and admin entries: not snaps. */
export const NOT_PLAYS: ReadonlySet<string> = new Set(["timeout", "official timeout", "end period", "end of half", "end of game", "two-minute warning", "coin toss", "end of regulation"]);

const SPOT = String.raw`([A-Z]{2,4} \d{1,2}|50)`;
const STOPPED = new RegExp(String.raw`(?:to|at) ${SPOT} for (?:-?\d+ yards?|no gain)`);
const INTERCEPTED = new RegExp(String.raw`INTERCEPTED by \S+ at ${SPOT}`);
const FUMBLES = new RegExp(String.raw`FUMBLES[^,.]*? at ${SPOT}`);
const RECOVERED = new RegExp(String.raw`RECOVERED by \S+ at ${SPOT}`);
const SACKED = new RegExp(String.raw`sacked at ${SPOT}`);
const LANDING = /(?:kicks|punts) (\d+) yards?(?: from [A-Z]{2,4} \d{1,2}| from 50)? to (?:the )?([A-Z]{2,4} \d{1,2}|50|end zone)/;
const PASS_WAY = /pass (?:incomplete )?(short|deep) (left|middle|right)/;
const RUN_WAY = /(left|right) (end|tackle|guard)/;
const FIELD_GOAL_YARDS = /(\d+) yard field goal/;
const PENALTY_NAME = /PENALTY on [^,]+, ([^,]+),/;

/** A core play as a scene; null for an entry that isn't a snap or a kick. */
export function parse(item: JSONValue, teams: FootballTeams): FootballScene | null {
  const type = (str(at(item, "type", "text")) ?? "").toLowerCase();
  const id = str(at(item, "id"));
  const fromLine = num(at(item, "start", "yardLine"));
  const toLine = num(at(item, "end", "yardLine"));
  if (id == null || NOT_PLAYS.has(type) || type.startsWith("end ") || fromLine == null || toLine == null) return null;
  const text = str(at(item, "text")) ?? "";
  const play = playText(text);
  const kicking = type.includes("kickoff") || type.includes("punt");
  // The team that snapped or kicked: the start's (the play's own team is the receiving one on a kick or a return).
  const startTeam = idFrom(str(at(item, "start", "team", "$ref")), "/teams/");
  const offense = teamSide(teams, startTeam ?? (kicking ? null : idFrom(str(at(item, "team", "$ref")), "/teams/")));
  if (!offense) return null;
  const home = (offense === "top") === teams.topIsHome;
  const yard = (line: number) => (home ? line : 100 - line);
  const spot = (token: string | undefined): number | null => {
    if (token == null) return null;
    if (token === "50") return 50;
    const parts = token.split(" ").filter((p) => p !== "");
    const n = parts.length === 2 ? Number(parts[1]) : Number.NaN;
    if (!Number.isFinite(n)) return null;
    if (parts[0] === teams.homeAbbreviation) return yard(n);
    if (parts[0] === teams.awayAbbreviation) return yard(100 - n);
    return null;
  };

  const scene = new FootballScene(id, kind(type, play.toLowerCase()), offense, yard(fromLine), yard(toLine));
  scene.text = text;
  scene.wallclock = parseDate(str(at(item, "wallclock")));
  scene.yards = int(at(item, "statYardage")) ?? 0;
  const startDown = int(at(item, "start", "down"));
  if (startDown != null && startDown >= 1 && startDown <= 4) scene.before = { down: startDown, distance: int(at(item, "start", "distance")) ?? 10 };
  const endDown = int(at(item, "end", "down"));
  if (endDown != null && endDown >= 1 && endDown <= 4) scene.after = { down: endDown, distance: int(at(item, "end", "distance")) ?? 10 };
  const endTeam = idFrom(str(at(item, "end", "team", "$ref")), "/teams/");
  scene.flips = startTeam != null && endTeam != null && startTeam !== endTeam;
  if (bool(at(item, "scoringPlay")) === true) {
    switch (str(at(item, "scoringType", "name"))) {
      case "field-goal":
        scene.scoring = "fieldGoal";
        break;
      case "safety":
        scene.scoring = "safety";
        break;
      default:
        scene.scoring = "touchdown";
    }
  }
  if (type.includes("safety")) scene.scoring = "safety";
  if (scene.kind.type === "fumble" && bool(at(item, "isTurnover")) !== true && !scene.flips) {
    // Recovered by its own side: the run (or sack) it was.
    scene.kind = { type: play.includes("sacked") ? "sack" : "rush" };
  }
  switch (scene.kind.type) {
    case "pass":
    case "incomplete":
    case "rush":
    case "sack":
    case "kneel":
    case "spike":
    case "other":
      scene.onDowns = scene.flips && scene.before?.down === 4 && scene.scoring == null;
      break;
    default:
      break;
  }
  scene.participants = arr(at(item, "participants")).map((p) => {
    const position = idFrom(str(at(p, "position", "$ref")), "/positions/");
    return {
      role: str(at(p, "type")) ?? "",
      id: idFrom(str(at(p, "athlete", "$ref")), "/athletes/"),
      position: position != null ? positionFromESPN(Number(position)) : null,
    };
  });
  const flag = at(item, "penalty");
  if (flag != null && str(at(flag, "status", "slug")) !== "declined") {
    scene.penalty = { name: str(at(flag, "type", "text")) ?? null, yards: int(at(flag, "yards")) ?? Math.abs(scene.yards), noPlay: text.includes("No Play") };
  } else if (scene.kind.type === "penalty") {
    scene.penalty = { name: PENALTY_NAME.exec(text)?.[1] ?? null, yards: Math.abs(scene.yards), noPlay: text.includes("No Play") };
  }
  scene.names = names(play);

  // What only the text says.
  const lower = play.toLowerCase();
  scene.shotgun = text.includes("Shotgun");
  scene.formation = formation(text, scene.kind);
  scene.outOfBounds = lower.includes(" ob ") || lower.includes(" ob at") || lower.includes("out of bounds");
  const way = PASS_WAY.exec(lower);
  if (way) {
    scene.depth = way[1] === "deep" ? "deep" : "short";
    scene.lane = lane(way[2]!);
  }
  if (scene.lane == null) {
    const run = RUN_WAY.exec(lower);
    if (run) {
      scene.lane = lane(run[1]!);
      scene.gap = run[2] === "end" ? "end" : run[2] === "tackle" ? "tackle" : "guard";
    } else if (lower.includes("up the middle") || lower.includes("middle")) {
      scene.lane = "middle";
      scene.gap = "middle";
    }
  }
  // Where the ball carrier was stopped ("to DAL 41 for 6 yards", "pushed ob at PHI 37").
  scene.stopped = spot(STOPPED.exec(play)?.[1]);
  switch (scene.kind.type) {
    case "pass":
    case "incomplete": {
      const afterCatch = int(at(item, "yardsAfterCatch"));
      if (afterCatch != null && scene.kind.type === "pass") {
        scene.air = scene.yards - afterCatch;
      } else if (scene.depth) {
        // Short is about 5–10 yards past the line; deep, 20 and more.
        scene.air = scene.kind.type === "pass" ? Math.min(scene.yards, scene.depth === "deep" ? Math.max(scene.yards - 4, 20) : 7) : scene.depth === "deep" ? 24 : 7;
      }
      break;
    }
    case "interception":
      scene.turn = spot(INTERCEPTED.exec(play)?.[1]);
      if (scene.turn != null) scene.air = scene.turn - scene.from;
      scene.stopped = null;
      break;
    case "fumble":
      scene.loose = spot(FUMBLES.exec(play)?.[1]);
      scene.turn = spot(RECOVERED.exec(play)?.[1]) ?? scene.loose;
      break;
    case "sack":
      scene.stopped = spot(SACKED.exec(play)?.[1]);
      break;
    case "kickoff":
    case "punt": {
      const landing = LANDING.exec(play);
      const kickYards = landing ? Number(landing[1]) : Number.NaN;
      scene.kickYards = Number.isFinite(kickYards) ? kickYards : null;
      if (landing) scene.turn = landing[2] === "end zone" ? 105 : spot(landing[2]);
      if (scene.turn == null && scene.kickYards != null) scene.turn = scene.from + scene.kickYards;
      scene.kick = lower.includes("touchback")
        ? "touchback"
        : lower.includes("fair catch")
          ? "fairCatch"
          : lower.includes("downed")
            ? "downed"
            : lower.includes("out of bounds") && !play.includes(" for ")
              ? "outOfBounds"
              : "returned";
      // A return's end: the returner stopped ("J.Mingo to DAL 35 for 25 yards"); else where it was downed or caught.
      scene.stopped = spot(STOPPED.exec(play)?.[1]) ?? (scene.kick === "downed" || scene.kick === "fairCatch" || scene.kick === "outOfBounds" ? scene.turn : null);
      break;
    }
    case "fieldGoal":
    case "extraPoint": {
      const yards = FIELD_GOAL_YARDS.exec(lower);
      scene.kickYards = yards ? Number(yards[1]) : null;
      if (kindIs(scene.kind, "fieldGoal", false)) {
        scene.miss = lower.includes("blocked")
          ? "blocked"
          : lower.includes("wide right")
            ? "wideRight"
            : lower.includes("wide left")
              ? "wideLeft"
              : lower.includes("short")
                ? "short"
                : "wideRight";
      } else if (kindIs(scene.kind, "extraPoint", false)) {
        scene.miss = lower.includes("blocked") ? "blocked" : lower.includes("wide left") ? "wideLeft" : "wideRight";
      }
      break;
    }
    default:
      break;
  }
  if (scene.scoring === "touchdown") scene.attempt = attempt(item, text);
  // A try logged as its own entry: from the 15 or the 2, whatever the spot says.
  if (scene.kind.type === "extraPoint") {
    scene.pointAfter = "kick";
    if (!(scene.from >= 80 && scene.from <= 99)) {
      scene.from = 85;
      scene.to = 85;
    }
  } else if (type.includes("two point") || type.includes("two-point") || type.includes("2pt")) {
    const good = type.includes("good") || type.includes("succeed") || lower.includes("succeeds") || lower.includes("is good");
    const pass = type.includes("pass") || lower.includes(" pass ");
    scene.pointAfter = pass ? "pass" : "rush";
    scene.kind = pass ? { type: good ? "pass" : "incomplete" } : { type: "rush" };
    scene.scoring = good ? "touchdown" : null;
    if (!(scene.from >= 95 && scene.from <= 99)) scene.from = 98;
    scene.to = good ? 100 : Math.min(scene.from + 1, 99);
    scene.before = null;
    scene.after = null;
  }
  return scene;
}

/** The set the text implies: an extra lineman reported in (a heavy set), an empty backfield, a bunch; the kneel's victory formation. */
export function formation(text: string, kind: Kind): Formation {
  if (kind.type === "kneel") return "victory";
  const lower = text.toLowerCase();
  if (lower.includes("reported in as eligible") || lower.includes("jumbo")) return "heavy";
  // The formation's own words, in its parentheses ("(Shotgun, Empty)").
  const hints = [...text.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]!.toLowerCase()).join(" ");
  if (hints.includes("empty")) return "empty";
  if (hints.includes("bunch") || hints.includes("trips")) return "bunch";
  return "base";
}

/**
 * The try in a touchdown's entry: "J.Elliott extra point is GOOD, …",
 * "TWO-POINT CONVERSION ATTEMPT. D.Prescott rushes left guard. ATTEMPT
 * SUCCEEDS."; else as `pointAfterAttempt` names it ("Extra Point Good").
 */
export function attempt(item: JSONValue, text: string): Attempt | null {
  const namedText = str(at(item, "pointAfterAttempt", "text")) ?? "";
  const named = namedText.toLowerCase();
  const two = text.toLowerCase().indexOf("two-point conversion attempt");
  if (two >= 0) {
    // Swift's trimmingCharacters(in: ". "): dots and spaces off both ends.
    const words = text.slice(two + "TWO-POINT CONVERSION ATTEMPT".length).replace(/^[. ]+|[. ]+$/g, "");
    const lower = words.toLowerCase();
    const good = lower.includes("succeeds") || (!lower.includes("fails") && (int(at(item, "pointAfterAttempt", "value")) ?? 0) === 2);
    const pass = lower.includes(" pass") || named.includes("pass");
    return { kind: pass ? "pass" : "rush", good, text: words };
  }
  const kicked = /[A-Z]\.[\p{L}\p{N}_'-]+ extra point is/u.exec(text);
  if (kicked) {
    const words = text.slice(kicked.index).trim();
    return { kind: "kick", good: words.toLowerCase().includes("is good"), text: words };
  }
  if (named === "") return null;
  const kind: Attempt["kind"] = named.includes("pass") ? "pass" : named.includes("rush") ? "rush" : "kick";
  const good = !(named.includes("miss") || named.includes("block") || named.includes("fail") || named.includes("no good"));
  return { kind, good, text: namedText };
}

/** The type of play, from ESPN's type (the text only for kneels and spikes, which share a type with runs and incompletions). */
export function kind(type: string, play: string): Kind {
  if (type.includes("kickoff")) return { type: "kickoff" };
  if (type.includes("punt")) return { type: "punt" };
  if (type.includes("field goal")) return { type: "fieldGoal", good: type.includes("good") && !type.includes("blocked") };
  if (type.includes("extra point") || type.includes("pat")) return { type: "extraPoint", good: type.includes("good") || play.includes("is good") };
  if (type.includes("interception")) return { type: "interception" };
  if (type.includes("fumble")) return { type: "fumble" };
  if (type.includes("sack")) return { type: "sack" };
  if (type.includes("penalty")) return { type: "penalty" };
  if (type.includes("incompletion") || type.includes("incomplete")) return { type: play.includes("spike") ? "spike" : "incomplete" };
  if (type.includes("pass") || type.includes("reception")) return { type: "pass" };
  if (type.includes("rush")) return { type: play.includes("kneels") || play.includes("takes a knee") ? "kneel" : "rush" };
  if (type.includes("safety")) return { type: play.includes("sacked") ? "sack" : "rush" };
  return { type: "other" };
}

const lane = (word: string): Lane => (word === "left" ? "left" : word === "right" ? "right" : "middle");

/**
 * The play as it stood: after a review's reversal, before a penalty,
 * without the clock, the formation or a lineman reporting in.
 */
export function playText(text: string): string {
  let play = text;
  const reversed = play.lastIndexOf("REVERSED.");
  if (reversed >= 0) play = play.slice(reversed + "REVERSED.".length);
  const flag = play.indexOf("PENALTY");
  if (flag >= 0) play = play.slice(0, flag);
  play = play.replace(/\((?:\d+:\d+|[^)]*(?:Shotgun|Huddle|formation)[^)]*)\)/g, "");
  // Swift's `\w` is Unicode's word characters.
  play = play.replace(/[A-Z]\.[\p{L}\p{N}_'-]+ reported in as eligible\.?/gu, "");
  return play.trim();
}

const NAME = String.raw`([A-Z][A-Za-z]{0,2}\.\s?[A-Z][A-Za-z'\-]+)`;
const LEAD = new RegExp(String.raw`^${NAME}`);
const TARGET = new RegExp(String.raw`(?:to|for) ${NAME}`);
const STOP = new RegExp(String.raw`\(${NAME}`);
const TAKER = new RegExp(String.raw`(?:INTERCEPTED|RECOVERED) by (?:[A-Z]{2,4}-)?${NAME}`);
const RETURNER = new RegExp(String.raw`\. ${NAME} (?:to|for|pushed|ran|MUFFS|fair)`);

/** Short names by part: who ran, threw, caught, kicked, made the stop. */
export function names(play: string): Record<string, string> {
  const out: Record<string, string> = {};
  // "T.McKee" → "McKee" (Swift's split(maxSplits: 1) drops an empty piece).
  const short = (s: string): string => {
    const pieces = s.split(".");
    const rest = pieces.length > 1 ? [pieces[0]!, pieces.slice(1).join(".")].filter((x) => x !== "") : [s];
    return (rest[rest.length - 1] ?? s).trim();
  };
  const lead = LEAD.exec(play);
  if (lead) out.lead = short(lead[1]!);
  const target = TARGET.exec(play);
  if (target) out.target = short(target[1]!);
  const stop = STOP.exec(play);
  if (stop) out.stop = short(stop[1]!);
  const taker = TAKER.exec(play);
  if (taker) out.taker = short(taker[1]!);
  const returner = RETURNER.exec(play);
  if (returner) out.returner = short(returner[1]!);
  return out;
}

function idFrom(ref: string | undefined, marker: string): string | null {
  if (!ref) return null;
  const i = ref.indexOf(marker);
  if (i < 0) return null;
  const id = /^\d+/.exec(ref.slice(i + marker.length))?.[0];
  return id ? id : null;
}

/** "2026-10-27T00:19:09Z", as epoch milliseconds. */
function parseDate(s: string | undefined): number | null {
  if (!s) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}
