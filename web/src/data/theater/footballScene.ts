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
 * ESPN writes the text two ways: the NFL's gamebook ("(Shotgun) P.Mahomes pass
 * short left to C.Allen to SEA 49 for 18 yards (T.Okada).") and college's
 * ("(14:31) Shotgun #4 D.Hill rush middle for 2 yards gain to the ALA43 (#10
 * M.Jones)"), each read in its own grammar.
 *
 * Also here, as in the Swift file: an NFL team's depth chart
 * (`FootballDepthChart`, read once a game by the lane) and the teams' own
 * letters in the text (`isHome`, Swift's `FootballFeed.Teams.isHome`).
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
  /** A defensive back ESPN doesn't call a corner or a safety: most college credits, and the nickel back. */
  | "defensiveBack"
  | "kicker"
  | "punter"
  | "snapper";

export const isDefense = (p: Position): boolean => p === "defensiveLine" || p === "linebacker" || p === "corner" || p === "safety" || p === "defensiveBack";

/**
 * ESPN's position IDs ("…/positions/8"), as its `/positions/{id}` names
 * them. Plays credit groups: WR 1, C 4, TE 7, QB 8, RB 9, FB 10, PK 22, P 23,
 * CB 29, LB 30, DE 31, DT 32, DB 35, S 36, DL 37, OL 45, OT 46, G 73, LS 78.
 * Depth charts use slots: LT 2, LG 3, RG 5, RT 6, LDE 11, NT 12, RDE 13, LOLB
 * 14, LILB 15, RILB 16, ROLB 17, LCB 18, RCB 19, SS 20, FS 21, LDT 24, RDT 25,
 * WLB 26, MLB 27, SLB 28, UT 33, NB 34, LS 39, OG 47, T 74, NG 75.
 */
export function positionFromESPN(id: number): Position | null {
  if (id === 8) return "quarterback";
  if (id === 9) return "back";
  if (id === 10) return "fullback";
  if (id === 1) return "receiver";
  if (id === 7) return "tightEnd";
  if ((id >= 2 && id <= 6) || (id >= 45 && id <= 47) || id === 73 || id === 74) return "lineman";
  if ((id >= 11 && id <= 13) || id === 24 || id === 25 || (id >= 31 && id <= 33) || id === 37 || id === 75) return "defensiveLine";
  if ((id >= 14 && id <= 17) || (id >= 26 && id <= 28) || id === 30) return "linebacker";
  if (id === 18 || id === 19 || id === 29) return "corner";
  if (id === 20 || id === 21 || id === 36) return "safety";
  if (id === 34 || id === 35) return "defensiveBack";
  if (id === 22) return "kicker";
  if (id === 23) return "punter";
  if (id === 39 || id === 78) return "snapper";
  return null;
}

/**
 * Someone in on the play: their part ("rusher", "tackler", "sackedBy"),
 * athlete ID and position; the name and shirt the text gives ("#3
 * M.Ratcliffe"), and the depth-chart slot he starts in ("lde", "rcb"), once
 * the feed has the chart.
 */
export interface Participant {
  readonly role: string;
  readonly id: string | null;
  readonly position: Position | null;
  readonly name?: string | null;
  readonly jersey?: string | null;
  readonly slot?: string | null;
}

/**
 * The rush getting home as the quarterback threw: a hit (the NFL credits the
 * hitter as `other`, in [brackets] in the text) or a hurry (college's "QB
 * hurried by").
 */
export interface Pressure {
  readonly by: readonly Participant[];
  readonly hit: boolean;
}

export type FlagStatus = "accepted" | "declined" | "offsetting";
/**
 * Before the snap (the ball never snapped: a false start, a delay), during
 * the play, or after the whistle (unsportsmanlike conduct, unnecessary
 * roughness, enforced between downs).
 */
export type FlagTiming = "beforeSnap" | "duringPlay" | "afterPlay";

/**
 * A flag on the play, every one the text names (ESPN's `penalty` object
 * holds only the main one): the foul, who, the yards, where they were walked
 * from and to, whether it counted, and when it happened.
 */
export interface Flag {
  /** "Offensive Holding". */
  name: string;
  /** ESPN's ("offensive-holding"); null where only the text names it (college). */
  slug: string | null;
  status: FlagStatus;
  timing: FlagTiming;
  /** The team flagged. */
  side: Side | null;
  /** Who was flagged (the `penalized` participant), when the flag names someone. */
  player: Participant | null;
  yards: number | null;
  /**
   * Where it was enforced from ("enforced at SEA 46", college's "from
   * TAM14") and where that put the ball (college's "to TAM29"; else the
   * yards walked off).
   */
  from: number | null;
  to: number | null;
  noPlay: boolean;
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
  /** Where the ball was put on the ground or popped loose (a fumble, lost or not). */
  loose: number | null = null;
  /** Where a fumble was recovered, by either side (a lost one's is also `turn`). */
  recovered: number | null = null;
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
  /** The flag whose yards were walked off (declined ones aren't). */
  penalty: Penalty | null = null;
  /** Every flag on the play, in the order thrown, declined and offsetting ones too. */
  flags: Flag[] = [];
  /** Who got to the quarterback as he threw. */
  pressure: Pressure | null = null;
  /** Who knocked the ball loose (`forcedBy`). */
  stripper: Participant | null = null;
  /** Who sacked him: two on a split sack. */
  sackers: Participant[] = [];
  /** Who blocked the kick (the `other` credited on a blocked one). */
  blocker: Participant | null = null;
  /** The defense's base front, from its depth chart (NFL; once the feed has it). */
  front: Front | null = null;
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
    copy.flags = this.flags.map((f) => ({ ...f }));
    copy.sackers = [...this.sackers];
    copy.names = { ...this.names };
    return copy;
  }

  /**
   * The scene with its credited men placed on the depth charts (the slot
   * each starts in) and the defense's base front. (pure; tested)
   */
  slotted(charts: DepthCharts): FootballScene {
    const values = (["top", "bottom"] as const).flatMap((s) => charts[s] ?? []);
    if (values.length === 0) return this;
    const scene = this.clone();
    const place = (p: Participant): Participant => {
      let slot: string | null = null;
      if (p.id != null) for (const chart of values) if ((slot = chart.slot(p.id)?.key ?? null) != null) break;
      return { ...p, slot: slot ?? p.slot ?? null };
    };
    scene.participants = this.participants.map(place);
    if (scene.pressure) scene.pressure = { ...scene.pressure, by: this.pressure?.by.map(place) ?? [] };
    scene.stripper = this.stripper ? place(this.stripper) : null;
    scene.sackers = this.sackers.map(place);
    scene.blocker = this.blocker ? place(this.blocker) : null;
    scene.flags = this.flags.map((flag) => ({ ...flag, player: flag.player ? place(flag.player) : null }));
    const defense = this.defense;
    if (defense) scene.front = charts[defense]?.front ?? this.front;
    return scene;
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
  /** Both teams' depth charts (NFL), once fetched: who starts where. */
  readonly charts?: DepthCharts;
}

export const EMPTY_FOOTBALL_THEATER: FootballTheaterState = { play: null, news: false };

/** Depth charts by side (Swift's `[GameDetail.Side: FootballDepthChart]`). */
export type DepthCharts = Readonly<Partial<Record<Side, FootballDepthChart>>>;

/** A base 4-3 (four down linemen, three backers) or 3-4 (a nose tackle and two ends, four backers). */
export type Front = "fourThree" | "threeFour";

/** One slot of a depth chart (FootballDepthChart.Slot). */
export class DepthSlot {
  constructor(
    /** ESPN's key: "lde", "nt", "lilb", "rcb", "ss", "lt", "wr", "pk". */
    readonly key: string,
    /** Athlete IDs by rank, the starter first. */
    readonly athletes: readonly string[],
    readonly defense: boolean,
    readonly position: Position | null,
  ) {}

  /**
   * Which side he lines up on in the offense's frame, the one the theater
   * stands in (behind the offense): the offense's left tackle on its left,
   * the defense's left end (or corner) on the offense's right.
   */
  get lane(): Lane | null {
    const first = this.key[0];
    if (!(first === "l" || first === "r") || this.key === "ls") return null;
    return (first === "l") !== this.defense ? "left" : "right";
  }
}

/**
 * A team's NFL depth chart (ESPN core `seasons/{year}/teams/{id}/depthcharts`):
 * each slot's players, the starter first, and the defense's base front. It
 * makes each credited man a specific player on a specific side, not "the
 * nearest linebacker". College has none (ESPN answers 400).
 */
export class FootballDepthChart {
  private constructor(
    readonly front: Front | null,
    readonly slots: readonly DepthSlot[],
  ) {}

  /** The slot an athlete starts in: where he ranks highest. */
  slot(athlete: string): DepthSlot | null {
    let best: DepthSlot | null = null;
    let rank = Infinity;
    for (const slot of this.slots) {
      const i = slot.athletes.indexOf(athlete);
      if (i >= 0 && i < rank) {
        best = slot;
        rank = i;
      }
    }
    return best;
  }

  /**
   * The core response: offense ("3WR 1TE"), defense ("Base 4-3 D", "Base
   * 3-4 D") and special teams, each a map of slots to ranked athletes. Null
   * without a slot (Swift's failable `init?(_ json:)`).
   */
  static from(json: JSONValue): FootballDepthChart | null {
    const slots: DepthSlot[] = [];
    let front: Front | null = null;
    for (const group of arr(at(json, "items"))) {
      const name = str(at(group, "name")) ?? "";
      const defense = name.includes(" D") || name.toLowerCase().includes("defense");
      if (defense) front = name.includes("3-4") ? "threeFour" : name.includes("4-3") ? "fourThree" : front;
      const positions = at(group, "positions");
      if (positions == null || typeof positions !== "object" || Array.isArray(positions)) continue;
      for (const [key, entry] of Object.entries(positions as Record<string, unknown>)) {
        const ranked = [...arr(at(entry, "athletes"))].sort((a, b) => (coercedInt(at(a, "rank")) ?? 99) - (coercedInt(at(b, "rank")) ?? 99));
        const athletes = ranked.flatMap((a) => {
          const ref = str(at(a, "athlete", "$ref"));
          return (ref != null ? athleteID(ref) : null) ?? [];
        });
        const id = coercedInt(at(entry, "position", "id"));
        slots.push(new DepthSlot(key, athletes, defense, id != null ? positionFromESPN(id) : null));
      }
    }
    if (slots.length === 0) return null;
    // Dictionary order isn't stable: by key, so two loads compare equal.
    slots.sort((a, b) => (a.defense ? 0 : 1) - (b.defense ? 0 : 1) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return new FootballDepthChart(front, slots);
  }
}

/** Swift `JSON.int`: a number or a numeric string, truncated (ESPN sends the depth chart's position IDs as strings). */
function coercedInt(v: JSONValue): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

// MARK: - Parsing

/** Clock stoppages and admin entries: not snaps. */
export const NOT_PLAYS: ReadonlySet<string> = new Set(["timeout", "official timeout", "end period", "end of half", "end of game", "two-minute warning", "coin toss", "end of regulation"]);

/** A spot as the gamebook writes it ("SEA 49", "KC -9" in the end zone, "50"). */
const SPOT = String.raw`([A-Z]{2,4} -?\d{1,2}|50)`;
/** A spot as college writes it ("ALA43", "Akron09", "TAM00"). */
const CSPOT = String.raw`([A-Za-z&]{2,12}\d{1,2})`;
const STOPPED = new RegExp(String.raw`(?:to|at) ${SPOT} for (?:-?\d+ yards?|no gain)`);
// The pick, past whoever hit the passer or broke it up: "INTERCEPTED by T.Okada [N.Emmanwori]
// at SEA 34", "by T.Smith (K.Scott) at CAR 32"; in the end zone, "at KC -9".
const INTERCEPTED = new RegExp(String.raw`INTERCEPTED by [^\[(]+?(?: \[[^\]]*\]| \([^)]*\))* at ${SPOT}`);
const SACKED = new RegExp(String.raw`sacked (?:ob )?at ${SPOT}`);
const LANDING = /(?:kicks|punts) (\d+) yards?(?: from [A-Z]{2,4} \d{1,2}| from 50)? to (?:the )?([A-Z]{2,4} -?\d{1,2}|50|end zone)/;
const PASS_WAY = /pass (?:incomplete )?(short|deep) (left|middle|right)/;
const RUN_WAY = /(left|right) (end|tackle|guard)/;
const FIELD_GOAL_YARDS = /(\d+) yard field goal/;
const CARRIER = new RegExp(String.raw`(?:to|at) ${SPOT}\b`, "g");
const LOOSE = new RegExp(String.raw`^FUMBLES(?: \([^)]*\))* at ${SPOT}`);
const TOUCHED = new RegExp(String.raw`touched at ${SPOT}`);
// Swift's `(?i:recovered by)`: inline modifiers are too new for every browser.
const FELL_ON = new RegExp(String.raw`[Rr][Ee][Cc][Oo][Vv][Ee][Rr][Ee][Dd] [Bb][Yy] .+? at ${SPOT}|and recovers at ${SPOT}`);

/** A core play as a scene; null for an entry that isn't a snap or a kick. */
export function parse(item: JSONValue, teams: FootballTeams): FootballScene | null {
  const type = (str(at(item, "type", "text")) ?? "").toLowerCase();
  const id = str(at(item, "id"));
  const fromLine = num(at(item, "start", "yardLine"));
  const toLine = num(at(item, "end", "yardLine"));
  if (id == null || NOT_PLAYS.has(type) || type.startsWith("end ") || fromLine == null || toLine == null) return null;
  const text = str(at(item, "text")) ?? "";
  const play = playText(text);
  const stood = ruling(text);
  const college = isCollege(text);
  const kicking = type.includes("kickoff") || type.includes("punt");
  // The team that snapped or kicked: the start's (the play's own team is the receiving one on a kick or a return).
  const startTeam = idFrom(str(at(item, "start", "team", "$ref")), "/teams/");
  const offense = teamSide(teams, startTeam ?? (kicking ? null : idFrom(str(at(item, "team", "$ref")), "/teams/")));
  if (!offense) return null;
  const home = (offense === "top") === teams.topIsHome;
  const yard = (line: number) => (home ? line : 100 - line);
  // A spot in the text ("SEA 49", "KC -9" in the end zone, college's "ALA43"), at the end its letters name.
  const ends = endsIn(text, teams, [fromLine, toLine]);
  const spot = (token: string | null | undefined): number | null => {
    if (token == null) return null;
    if (token === "50") return 50;
    const m = /^([A-Za-z&]{2,12}) ?(-?\d{1,2})$/.exec(token);
    const homeEnd = m ? ends.get(m[1]!) : undefined;
    if (!m || homeEnd == null) return null;
    const n = Number(m[2]);
    return yard(homeEnd ? n : 100 - n);
  };
  // The team a flag's letters name ("KC" in "PENALTY on KC-T.Kelce", college's "ALA").
  const team = (letters: string): Side | null => {
    const homeEnd = isHome(teams, letters) ?? ends.get(letters) ?? null;
    return homeEnd == null ? null : homeEnd === teams.topIsHome ? "top" : "bottom";
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
    // Recovered by its own side: the run, sack or catch it was.
    scene.kind = { type: play.includes("sacked") ? "sack" : play.includes(" pass ") ? "pass" : "rush" };
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
  scene.flags = flags(stood, college, play !== "", at(item, "penalty"), scene.participants.filter((p) => p.role === "penalized"), offense, team, spot);
  const flag = at(item, "penalty");
  const walked = scene.flags.find((f) => f.status === "accepted");
  if (flag != null && str(at(flag, "status", "slug")) !== "declined") {
    scene.penalty = { name: str(at(flag, "type", "text")) ?? null, yards: int(at(flag, "yards")) ?? Math.abs(scene.yards), noPlay: text.includes("No Play") };
  } else if ((scene.kind.type === "penalty" || college) && walked) {
    // No object (college never has one): the flag that counted, as the text has it.
    scene.penalty = { name: walked.name, yards: walked.yards ?? Math.abs(scene.yards), noPlay: walked.noPlay };
  } else if (scene.kind.type === "penalty") {
    scene.penalty = { name: null, yards: Math.abs(scene.yards), noPlay: /no play/i.test(text) };
  }
  scene.names = college ? collegeNames(play) : names(play);

  // What only the text says.
  const lower = play.toLowerCase();
  scene.shotgun = text.includes("Shotgun");
  scene.formation = formation(text, scene.kind);
  scene.outOfBounds = lower.includes(" ob ") || lower.includes(" ob at") || lower.includes("out of bounds");
  if (college) readCollege(scene, play, spot);
  else readGamebook(scene, item, play, spot);
  credit(scene, play, college);
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

type Spot = (token: string | null | undefined) => number | null;

/**
 * What the NFL's gamebook text says: the depth and side, the hole, where he
 * was stopped, where a pass was picked off, where a kick came down, where a
 * fumble came loose and who fell on it.
 */
function readGamebook(scene: FootballScene, item: JSONValue, play: string, spot: Spot): void {
  const lower = play.toLowerCase();
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
      miss(scene, lower);
      break;
    }
    default:
      break;
  }
  // A fumble, lost or kept: where it came loose ("FUMBLES (Aborted) at DET 41"; else where he was,
  // the sack's or the run's spot; else where the ball was first touched) and where it was recovered
  // ("RECOVERED by TB-C.Kancey at CAR 32", "recovered by KC-P.Mahomes at KC 49", "and recovers at SEA 32").
  const fumbles = play.indexOf("FUMBLES");
  if (fumbles >= 0) {
    const carrier = spot([...play.slice(0, fumbles).matchAll(CARRIER)].at(-1)?.[1]);
    const after = play.slice(fumbles);
    scene.loose = spot(LOOSE.exec(after)?.[1]) ?? carrier ?? spot(TOUCHED.exec(after)?.[1]);
    const m = FELL_ON.exec(after);
    if (m) scene.recovered = spot(m[1] ?? m[2]);
    if (scene.kind.type === "fumble") scene.turn = scene.recovered ?? scene.loose;
  }
}

/**
 * What college's text says ("(11:05) Shotgun #12 K.Russell pass complete
 * short left to #7 R.Scott caught at TAM24, for 17 yards to the TAM24"),
 * richer than the NFL's on a pass: where it was caught, or where an
 * incompletion was thrown to.
 */
function readCollege(scene: FootballScene, play: string, spot: Spot): void {
  const lower = play.toLowerCase();
  const pass = /pass (?:complete|incomplete)(?: (short|deep))?(?: (left|middle|right))?/.exec(lower);
  if (pass) {
    scene.depth = pass[1] != null ? (pass[1] === "deep" ? "deep" : "short") : null;
    scene.lane = pass[2] != null ? lane(pass[2]) : null;
  } else {
    const run = /rush (left|middle|right)/.exec(lower);
    if (run) {
      // A run's direction only (no gap): left or right is off tackle.
      scene.lane = lane(run[1]!);
      scene.gap = run[1] === "middle" ? "middle" : "tackle";
    }
  }
  // Where he was stopped: "for 2 yards gain to the ALA43", "sacked for loss of 7 yards to the TAM25",
  // "Kneel down by #10 M.Reed at TAM09".
  const stop = new RegExp(String.raw`for (?:no gain|(?:loss of )?\d+ yards?(?: gain| loss)?) to the ${CSPOT}|Kneel down by .+? at ${CSPOT}`).exec(play);
  scene.stopped = stop ? spot(stop[1] ?? stop[2]) : null;
  switch (scene.kind.type) {
    case "pass":
    case "incomplete": {
      // Exactly where it was caught, or thrown to.
      const point = spot(new RegExp(String.raw`(?:caught at|thrown to) ${CSPOT}`).exec(play)?.[1]);
      if (point != null) {
        scene.air = point - scene.from;
      } else if (scene.depth) {
        scene.air = scene.kind.type === "pass" ? Math.min(scene.yards, scene.depth === "deep" ? Math.max(scene.yards - 4, 20) : 7) : scene.depth === "deep" ? 24 : 7;
      }
      break;
    }
    case "interception":
      scene.turn = spot(new RegExp(String.raw`intercepted by #\d+ .+? at ${CSPOT}`).exec(play)?.[1]);
      if (scene.turn != null) scene.air = scene.turn - scene.from;
      scene.stopped = null;
      break;
    case "kickoff":
    case "punt": {
      // "kickoff 41 yards to the ALA24 #81 K.Edwards return 9 yards to the ALA33", "punt 42 yards to
      // the Akron09 fair catch by #13 S.Patrick at Akron09", "punt 46 yards to the TAM00, Touchback".
      const landing = new RegExp(String.raw`(?:kickoff|punt) (\d+) yards? to the ${CSPOT}`).exec(play);
      scene.kickYards = landing ? Number(landing[1]) : null;
      scene.turn = landing ? spot(landing[2]) : null;
      if (scene.turn == null && scene.kickYards != null) scene.turn = scene.from + scene.kickYards;
      const returned = new RegExp(String.raw`return -?\d+ yards? to the ${CSPOT}`).exec(play);
      scene.kick = lower.includes("touchback")
        ? "touchback"
        : lower.includes("fair catch")
          ? "fairCatch"
          : returned != null || lower.includes("muffed")
            ? "returned"
            : lower.includes("out of bounds")
              ? "outOfBounds"
              : "downed";
      // Into the end zone: the NFL's spot for it.
      if (scene.kick === "touchback" && scene.turn != null && scene.turn >= 99.5) scene.turn = 105;
      scene.stopped =
        spot(returned?.[1]) ??
        spot(new RegExp(String.raw`recovered by \S+ #\d+ .+? at ${CSPOT}`).exec(play)?.[1]) ??
        (scene.kick === "downed" || scene.kick === "fairCatch" || scene.kick === "outOfBounds" ? scene.turn : null);
      break;
    }
    case "fieldGoal":
    case "extraPoint": {
      const yards = /field goal attempt from (\d+) yards?/.exec(lower);
      scene.kickYards = yards ? Number(yards[1]) : null;
      miss(scene, lower);
      break;
    }
    default:
      break;
  }
  // A fumble: "fumbled by #10 M.Reed at TAM18 forced by #90 L.Simmons recovered by TAM #4 R.Owens II
  // at TAM22"; with no spot of its own ("fumble by #12 D.DeShields recovered by …"), where he was.
  const fumbled = /fumble/i.exec(play);
  if (fumbled) {
    const carrier = spot([...play.slice(0, fumbled.index).matchAll(new RegExp(String.raw`to the ${CSPOT}`, "g"))].at(-1)?.[1]);
    scene.loose = spot(new RegExp(String.raw`fumbled by #\d+ .+? at ${CSPOT}`).exec(play)?.[1]) ?? carrier;
    scene.recovered = spot(new RegExp(String.raw`recovered by \S+ #\d+ .+? at ${CSPOT}`).exec(play)?.[1]);
    if (scene.kind.type === "fumble") scene.turn = scene.recovered ?? scene.loose;
  }
}

/** A missed kick's way: blocked, wide left or right, short. */
function miss(scene: FootballScene, lower: string): void {
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
}

/** A name with its suffix ("Lee Jr.", "Owens II"), as college writes it. */
const SUFFIXED = String.raw`(?: (?:Jr\.|Sr\.|III|II|IV))?`;

/** Someone the text names: a short name, and the shirt when college gives it. */
export interface Named {
  readonly name: string;
  readonly jersey: string | null;
}

/**
 * Who did what beyond the carrier and the tacklers, from the credits (with
 * the text's names where it gives them): who hit or hurried the passer, who
 * knocked the ball out, who sacked him, who blocked the kick.
 */
function credit(scene: FootballScene, play: string, college: boolean): void {
  const named = (role: string, names: readonly Named[]): Participant[] => {
    const credited = scene.participants.filter((p) => p.role === role);
    // Names in the text's order go to the credits in theirs; a name with no credit stands alone.
    names.forEach((n, i) => {
      if (i < credited.length) credited[i] = { ...credited[i]!, name: n.name, jersey: n.jersey };
      else credited.push({ role, id: null, position: null, name: n.name, jersey: n.jersey });
    });
    return credited;
  };
  switch (scene.kind.type) {
    case "pass":
    case "incomplete":
    case "interception":
    case "spike": {
      const hurried = college ? /QB hurried by (#\d+ .+?)(?=,| TOUCHDOWN|$| (?!and #)[a-z(])/.exec(play) : null;
      if (hurried) {
        scene.pressure = { by: named("hurriedBy", people(hurried[1]!)), hit: false };
      } else if (!college) {
        // A hit on the passer is in [brackets] ("… to X.Worthy [D.Hall].") and credited to a defender
        // as `other`. An `other` with no bracket isn't one: its per-play stats show a second
        // tackler, or nothing. The credit goes with the name when there's one of each.
        const bracketed = [...play.matchAll(/\[([^\]]+)\]/g)].map((m) => shortName(m[1]!));
        const credited = scene.participants.filter((p) => p.role === "other" && p.position != null && isDefense(p.position));
        const by = bracketed.map((name, i): Participant => ({ ...(credited.length === bracketed.length ? credited[i]! : { role: "other", id: null, position: null }), name }));
        if (by.length > 0) scene.pressure = { by, hit: true };
      }
      const broken = college ? new RegExp(String.raw`broken up by #(\d+) (\S+${SUFFIXED})`).exec(play) : null;
      if (broken) {
        const i = scene.participants.findIndex((p) => p.role === "passDefender");
        if (i >= 0) scene.participants[i] = { ...scene.participants[i]!, name: shortName(broken[2]!), jersey: broken[1]! };
        else scene.participants.push({ role: "passDefender", id: null, position: null, name: shortName(broken[2]!), jersey: broken[1]! });
      }
      break;
    }
    case "fieldGoal":
    case "extraPoint":
    case "punt": {
      if ("good" in scene.kind && scene.kind.good) break;
      if (!(scene.miss === "blocked" || play.toLowerCase().includes("blocked"))) break;
      const m = /BLOCKED \(([^)]+)\)|blocked by (#\d+ [^ ,.]+)/.exec(play);
      const who = m ? (people(m[1] ?? m[2] ?? "")[0] ?? null) : null;
      const blocker = scene.participants.find((p) => p.role === "other") ?? (who ? { role: "other", id: null, position: null } : null);
      if (blocker) scene.blocker = who ? { ...blocker, name: who.name, jersey: who.jersey } : blocker;
      break;
    }
    default:
      break;
  }
  // The sack: "(sack split by D.Alexander and A.Reese)", "sacked at CAR 31 for -9 yards (A.Muhammad)",
  // college's "sacked for loss of 5 yards to the TAM15 (#3 M.Ratcliffe, #10 M.Jones)".
  const sacked = play.indexOf("sacked");
  if (sacked >= 0) {
    const after = play.slice(sacked + "sacked".length);
    const split = /sack split by ([^)]+)\)/.exec(after);
    const plain = split ? null : /^[^(.]*?\(([^)]+)\)/.exec(after);
    scene.sackers = named("sackedBy", split ? people(split[1]!) : plain ? people(plain[1]!) : []);
  }
  // Who knocked it out: "FUMBLES (A.Muhammad)", "forced by #90 L.Simmons".
  const s = new RegExp(String.raw`FUMBLES \((?!Aborted)([^)]+)\)|forced by (#\d+ \S+${SUFFIXED})`).exec(play);
  const stripped = s ? (people(s[1] ?? s[2] ?? "")[0] ?? null) : null;
  const stripper = scene.participants.find((p) => p.role === "forcedBy") ?? (stripped ? { role: "forcedBy", id: null, position: null } : null);
  if (stripper) scene.stripper = stripped ? { ...stripper, name: stripped.name, jersey: stripped.jersey } : stripper;
}

/** Swift's `trimmingCharacters(in: .whitespaces)`: spaces and tabs, not newlines. */
const trimSpaces = (s: string): string => s.replace(/^[\p{Zs}\t]+|[\p{Zs}\t]+$/gu, "");

/**
 * People as the text lists them: "D.Alexander and A.Reese", college's "#3
 * M.Ratcliffe, #10 M.Jones", "#7 C.Woodson; #6 R.Morgan" (short names).
 */
export function people(list: string): Named[] {
  return list.split(/, | and |; /).flatMap((part): Named[] => {
    const s = trimSpaces(part);
    const m = /^#(\d+) (.+)$/.exec(s);
    if (m) return [{ name: shortName(m[2]!), jersey: m[1]! }];
    return s === "" ? [] : [{ name: shortName(s), jersey: null }];
  });
}

/** "Barkley" from "S.Barkley", "Lee Jr." from "D.Lee Jr." (Swift's split(maxSplits: 1) drops an empty piece). */
export function shortName(s: string): string {
  const pieces = s.split(".");
  const rest = pieces.length > 1 ? [pieces[0]!, pieces.slice(1).join(".")].filter((x) => x !== "") : [s];
  return trimSpaces(rest[rest.length - 1] ?? s);
}

// MARK: Flags

/**
 * Every flag the text names, in order; the one ESPN's `penalty` object
 * describes gets its slug, yards and status from it. The NFL: "PENALTY on
 * KC-T.Kelce, Illegal Shift, 5 yards, enforced at SEA 46 - No Play.",
 * "Penalty on GB-K.Brooks, Defensive Offside, declined.", "…, offsetting,
 * enforced at SEA 30 - No Play.". College: "PENALTY ALA Targeting (#6
 * R.Morgan) 15 yards from ALA29 to ALA14, 1ST DOWN. NO PLAY", "PENALTY ALA
 * Offside declined", "PENALTY Kent UNS: Unsportsmanlike Conduct offsetting
 * Akron UNS: Unsportsmanlike Conduct offsetting". (pure; tested)
 */
export function flags(
  text: string,
  college: boolean,
  played: boolean,
  main: JSONValue,
  penalized: readonly Participant[],
  offense: Side,
  team: (letters: string) => Side | null,
  spot: Spot,
): Flag[] {
  const marks: { start: number; end: number }[] = [];
  if (college) {
    for (let i = text.indexOf("PENALTY "); i >= 0; i = text.indexOf("PENALTY ", i + "PENALTY ".length)) marks.push({ start: i, end: i + "PENALTY ".length });
  } else {
    for (const m of text.matchAll(/(?:PENALTY|Penalty) on /g)) marks.push({ start: m.index, end: m.index + m[0].length });
  }
  const clauses: string[] = [];
  marks.forEach((mark, i) => {
    const clause = text.slice(mark.end, i + 1 < marks.length ? marks[i + 1]!.start : text.length);
    // College runs two offsetting fouls into one: "Kent UNS: … offsetting Akron UNS: … offsetting".
    if (college && clause.includes(" offsetting")) {
      clauses.push(
        ...clause
          .split("offsetting")
          .map(trimSpaces)
          .filter((c) => /^\p{L}/u.test(c))
          .map((c) => c + " offsetting"),
      );
    } else {
      clauses.push(clause);
    }
  });
  const out: Flag[] = [];
  for (const clause of clauses) {
    let flag: Flag;
    let player: Named | null = null;
    if (college) {
      const m = /^([A-Za-z&]+) (?:[A-Z]{2,4}: )?(.+?)(?= \(#\d| declined| offsetting| \d+ yards? from|[.,]|$)/.exec(clause);
      if (!m) continue;
      flag = newFlag(m[2]!, team(m[1]!));
      const p = /\((#\d+ [^)]+)\)/.exec(clause);
      if (p) player = people(p[1]!)[0] ?? null;
      const walk = new RegExp(String.raw`(\d+) yards? from ${CSPOT} to ${CSPOT}`).exec(clause);
      if (walk) {
        flag.yards = Number(walk[1]);
        flag.from = spot(walk[2]);
        flag.to = spot(walk[3]);
      }
      flag.noPlay = clause.includes("NO PLAY");
    } else {
      const m = /^([A-Z]{2,4})(?:-([^,]+))?, ([^,]+), ?(.*)/.exec(clause);
      if (!m) continue;
      flag = newFlag(m[3]!, team(m[1]!));
      player = m[2] != null ? { name: shortName(m[2]), jersey: null } : null;
      const tail = m[4]!;
      const yards = /^(\d+) yards?/.exec(tail);
      flag.yards = yards ? Number(yards[1]) : null;
      flag.from = spot(new RegExp(String.raw`enforced at ${SPOT}`).exec(tail)?.[1]);
      flag.noPlay = tail.includes("No Play");
    }
    const rest = clause.toLowerCase();
    flag.status = rest.includes("declined") ? "declined" : rest.includes("offsetting") ? "offsetting" : "accepted";
    // The main flag, as ESPN's object describes it.
    if (main != null && str(at(main, "type", "text"))?.toLowerCase() === flag.name.toLowerCase() && !out.some((f) => f.slug != null)) {
      flag.slug = str(at(main, "type", "slug")) ?? null;
      flag.yards = flag.yards ?? int(at(main, "yards")) ?? null;
      switch (str(at(main, "status", "slug"))) {
        case "declined":
          flag.status = "declined";
          break;
        case "offsetting":
          flag.status = "offsetting";
          break;
        default:
          break;
      }
    }
    flag.timing = timing(flag, played, rest.includes("between downs"));
    if (flag.to == null && flag.status === "accepted" && flag.from != null && flag.yards != null && flag.side != null) {
      flag.to = flag.side === offense ? flag.from - flag.yards : flag.from + flag.yards;
    }
    if (player) flag.player = { role: "penalized", id: null, position: null, name: player.name, jersey: player.jersey };
    // College repeats a flag (once with the yards, once without): one flag, all it says.
    const same = out.find((f) => f.name === flag.name && f.side === flag.side && (f.player?.name ?? null) === (flag.player?.name ?? null));
    if (same) {
      same.yards = same.yards ?? flag.yards;
      same.from = same.from ?? flag.from;
      same.to = same.to ?? flag.to;
      same.noPlay = same.noPlay || flag.noPlay;
      continue;
    }
    out.push(flag);
  }
  // The credited fouler (`penalized`, with his ID and position) to the flags that name one, those that counted first.
  const credits = [...penalized];
  const order = out.map((_, i) => i).sort((a, b) => (out[a]!.status === "declined" ? 1 : 0) - (out[b]!.status === "declined" ? 1 : 0));
  for (const i of order) {
    const named = out[i]!.player;
    if (named == null || credits.length === 0) continue;
    out[i]!.player = { ...credits.shift()!, name: named.name ?? null, jersey: named.jersey ?? null };
  }
  return out;
}

const newFlag = (name: string, side: Side | null): Flag => ({ name, slug: null, status: "accepted", timing: "duringPlay", side, player: null, yards: null, from: null, to: null, noPlay: false });

/**
 * When a foul happened: before the snap when no play ran, or for a dead-ball
 * foul (a false start, encroachment, a neutral zone infraction, a delay of
 * game: college logs the play it stopped anyway); after the whistle for
 * unsportsmanlike conduct, taunting, unnecessary roughness and personal
 * fouls, or one enforced between downs; otherwise during the play.
 */
export function timing(flag: Pick<Flag, "slug" | "name">, played: boolean, between: boolean): FlagTiming {
  const key = flag.slug ?? flag.name.toLowerCase().replaceAll(" ", "-");
  const early = ["false-start", "encroachment", "neutral-zone", "delay-of-game"];
  const late = ["unsportsmanlike", "taunting", "unnecessary-roughness", "personal-foul"];
  if (!played || early.some((e) => key.includes(e))) return "beforeSnap";
  return between || late.some((l) => key.includes(l)) ? "afterPlay" : "duringPlay";
}

// MARK: Text

/**
 * Which end each spot's letters in the text name, home (true) or away: the
 * team's own letters (`isHome`), else by elimination: the other team's,
 * when the rest of the play's spots name one; or the end that puts the spot
 * nearest ESPN's own yard lines. (Swift's `ends(in:teams:lines:)`; pure; tested)
 */
export function endsIn(text: string, teams: FootballTeams, lines: readonly number[]): Map<string, boolean> {
  const ends = new Map<string, boolean>();
  const unknown = new Map<string, number>();
  for (const m of text.matchAll(/\b(?:to|at|from)(?: the)? ([A-Za-z&]{2,12}) ?(-?\d{1,2})\b/g)) {
    const letters = m[1]!;
    const home = isHome(teams, letters);
    if (home != null) ends.set(letters, home);
    else if (!unknown.has(letters)) unknown.set(letters, Number(m[2]));
  }
  if (unknown.size !== 1) return ends;
  const [letters, n] = [...unknown][0]!;
  const known = new Set(ends.values());
  if (known.size === 1) {
    ends.set(letters, ![...known][0]!);
  } else if (ends.size === 0 && n !== 50 && lines.length > 0) {
    const home = Math.min(...lines.map((l) => Math.abs(l - n)));
    const away = Math.min(...lines.map((l) => Math.abs(l - (100 - n))));
    if (home !== away) ends.set(letters, home < away);
  }
  return ends;
}

/** College's text: a shirt number on every name ("#4 D.Hill"), spots written without a space ("to the ALA43"; the NFL's "to SEA 49"). */
export function isCollege(text: string): boolean {
  return /#\d{1,2} [A-Z][A-Za-z'-]*\.|\b(?:to|at|from)(?: the)? [A-Za-z&]{2,12}\d{2}\b/.test(text);
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
  if (type.includes("rush")) return { type: play.includes("kneels") || play.includes("takes a knee") || play.includes("kneel down") ? "kneel" : "rush" };
  if (type.includes("safety")) return { type: play.includes("sacked") ? "sack" : "rush" };
  return { type: "other" };
}

const lane = (word: string): Lane => (word === "left" ? "left" : word === "right" ? "right" : "middle");

/**
 * The play as it stood: after a review's reversal (college puts the ruling
 * first, the review after it), before a penalty, without the clock, the
 * formation or a lineman reporting in.
 */
export function playText(text: string): string {
  let play = ruling(text);
  const flag = /PENALTY|Penalty on /.exec(play);
  if (flag) play = play.slice(0, flag.index);
  play = play.replace(/\((?:\d+:\d+|[^)]*(?:Shotgun|Huddle|formation)[^)]*)\)/g, "");
  // Swift's `\w` is Unicode's word characters.
  play = play.replace(/[A-Z]\.[\p{L}\p{N}_'-]+ reported in as eligible\.?/gu, "");
  // College's set, unbracketed: "No Huddle-Shotgun #10 M.Reed …".
  play = play.replace(/^\s*(?:No Huddle-?)?(?:Shotgun)?\s*(?=#\d)/, "");
  return play.trim();
}

/**
 * The ruling that stood: the NFL's after a reversal ("… the play was
 * REVERSED.W.Marks left tackle …"), college's before its review ("… The
 * previous play is under automatic review … (Original Play: …)").
 */
export function ruling(text: string): string {
  let stood = text;
  const reversed = stood.lastIndexOf("REVERSED.");
  if (reversed >= 0) stood = stood.slice(reversed + "REVERSED.".length);
  const review = stood.indexOf("The previous play is under");
  if (review >= 0) stood = stood.slice(0, review);
  return stood;
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
  const lead = LEAD.exec(play);
  if (lead) out.lead = shortName(lead[1]!);
  const target = TARGET.exec(play);
  if (target) out.target = shortName(target[1]!);
  const stop = STOP.exec(play);
  if (stop) out.stop = shortName(stop[1]!);
  const taker = TAKER.exec(play);
  if (taker) out.taker = shortName(taker[1]!);
  const returner = RETURNER.exec(play);
  if (returner) out.returner = shortName(returner[1]!);
  return out;
}

/** College's names: a shirt number first, maybe a suffix ("#5 D.Lee Jr."). */
const CNAME = String.raw`([A-Z][A-Za-z'\-]*\.\s?[A-Z][A-Za-z'\-]+${SUFFIXED})`;
const C_LEAD = new RegExp(String.raw`^(?:Kneel down by )?#\d+ ${CNAME}`);
const C_TARGET = new RegExp(String.raw` to #\d+ ${CNAME}`);
const C_STOP = new RegExp(String.raw`\(#\d+ ${CNAME}`);
const C_TAKER = new RegExp(String.raw`(?:intercepted|recovered) by (?:\S+ )?#\d+ ${CNAME}`);
const C_RETURNER = new RegExp(String.raw`#\d+ ${CNAME} return|(?:fair catch|muffed) by #\d+ ([A-Z][A-Za-z'\-]*\.\s?[A-Z][A-Za-z'\-]+)`);

/**
 * The same parts in college's words: "#12 K.Russell pass complete … to #7
 * R.Scott … (#5 D.Lee Jr.)", "intercepted by #5 D.Lee Jr.", "recovered by ALA
 * #36 Q.Reese", "#81 K.Edwards return 9 yards".
 */
export function collegeNames(play: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lead = C_LEAD.exec(play);
  if (lead) out.lead = shortName(lead[1]!);
  const target = C_TARGET.exec(play);
  if (target) out.target = shortName(target[1]!);
  const stop = C_STOP.exec(play);
  if (stop) out.stop = shortName(stop[1]!);
  const taker = C_TAKER.exec(play);
  if (taker) out.taker = shortName(taker[1]!);
  const returner = C_RETURNER.exec(play);
  if (returner) out.returner = shortName(returner[1] ?? returner[2] ?? "");
  return out;
}

/** "…/athletes/3139477?lang=en" → "3139477". */
export function athleteID(ref: string): string | null {
  return idFrom(ref, "/athletes/");
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

// MARK: - The teams' letters (Swift's `extension FootballFeed.Teams`)

/** The gamebook's codes where they aren't ESPN's abbreviations. */
export const GAMEBOOK: Readonly<Record<string, string>> = { ARI: "ARZ", BAL: "BLT", CLE: "CLV", HOU: "HST", LAR: "LA", WSH: "WAS" };

const teamKey = (s: string): string => s.toUpperCase().replace(/[^\p{L}]/gu, "");

function teamKeys(abbreviation: string, name: string): Set<string> {
  const keys = new Set([teamKey(abbreviation)]);
  const code = GAMEBOOK[abbreviation];
  if (code) keys.add(code);
  const first = name.split(" ").find((w) => w !== "");
  if (first && [...first].length >= 3) keys.add(teamKey(first));
  keys.delete("");
  return keys;
}

/**
 * Whether a spot's letters name the home team's end (null: neither, or
 * both): its abbreviation ("ALA"; "TA&M" written "TAM"), the NFL gamebook's
 * own code for it ("HST" for HOU), or the first word of its name ("Kent" for
 * Kent State, "Akron").
 */
export function isHome(teams: FootballTeams, letters: string): boolean | null {
  const key = teamKey(letters);
  const home = teamKeys(teams.homeAbbreviation, teams.homeName ?? "").has(key);
  const away = teamKeys(teams.awayAbbreviation, teams.awayName ?? "").has(key);
  return home === away ? null : home;
}
