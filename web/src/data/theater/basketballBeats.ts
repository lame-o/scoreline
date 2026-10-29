/**
 * The basketball theater's lighter beats (BasketballBeats.swift): every play
 * ESPN logs that isn't a marquee replay, told in a second or three from its
 * real data, so the isometric view never sits on a frozen court while the
 * game goes on. A miss leaves the shooter's hand where ESPN put him and
 * comes off the rim the way a shot from there does (a long three kicks out
 * long, often to the weak side; a floater stays at the rim; a free throw
 * comes off the front), to the man the data credits, who goes where a
 * player of his position would come from (a center from the block, a guard
 * from the arc). Each free throw is its own beat (the shooter's routine is
 * his own, every trip), each whistle is called at ESPN's spot by a referee
 * who runs in to make it, each turnover is told by its kind (picked off,
 * poked loose, out of bounds, a travel, a charge with the defender on the
 * floor), and the stoppages (substitutions, timeouts, reviews, the ends of
 * periods) take the floor where it stood.
 *
 * Every beat starts where the last one left everyone (`Lineup`, turned half
 * a turn when the ball changes hands), so the court plays on like a video
 * game; a marquee replay still cuts to its own set, as a replay does. Where
 * the data is silent (who drew a personal foul, which way a pass went), the
 * choice is plausible and seeded from the play's ID: the same play always
 * looks the same, and no two look alike. The dice are the Mac's
 * (`SplitMix64`), so each beat is the Mac's beat.
 *
 * Between plays the court rests possession-aware (`RestSpec`): the team
 * with the ball pushes up the floor or inbounds and sets up in the half
 * court, then every few seconds something small happens (a jab, a swing
 * pass, a cut, a screen), the defense shading with it, still in between; at
 * a timeout both teams are at their benches until play resumes; at the half
 * the floor is empty. Pure values: a frame is a function of the script and t.
 *
 *     const script = beatScript(scene, [], ends, lineup, "top");
 *     const court = restScript(restOf({ offense: "top", ends, phase: "live", from: script.lineup(script.duration) }));
 */
import type { Side } from "../models";
import { CameraFrame, type Rect } from "../mlb/playCamera";
import { fieldPoint, ground, type Ease, type FieldPoint, type Point } from "../mlb/theaterField";
import { reviewWords, periodWords } from "./basketballFlow";
import { ballSide, made, type BasketballScene, type Miss, type Role } from "./basketballScene";
import {
  along,
  arc,
  BasketballScript,
  basketballStamp,
  Builder,
  distance,
  G,
  Hoops,
  inbounds,
  Player,
  RIM,
  RIM_POINT,
  rotate,
  STRAIGHT,
  unit,
  type ActionKind,
  type Team,
} from "./basketballScript";
import { seed64, SplitMix64 } from "./splitMix64";
import { CameraPath, CameraRig, clearing, fitting, unionAll } from "./theaterKit";

// MARK: - Lineup

/** The shape the floor is in: play, the lane for free throws, the benches, an empty court, round the center circle. */
export type Formation = "play" | "lane" | "benches" | "offCourt" | "center";

/**
 * Where everyone stood when one beat handed over to the next: in its frame
 * (the team at the basket in front first), who had the ball, the shape the
 * floor was in, and the camera's framing then.
 */
export interface Lineup {
  readonly offense: Side | null;
  readonly at: readonly Point[];
  readonly holder: number | null;
  readonly ball: Point | null;
  readonly formation: Formation;
  readonly camera: CameraFrame | null;
  readonly yaw: number | null;
}

/** The same floor in `side`'s frame: half a turn round, and the fives swapped, when the other team is the one at the basket in front. */
export function seenBy(l: Lineup, side: Side | null): Lineup {
  if (l.at.length !== 10 || side == null || l.offense == null || side === l.offense) return l;
  const turn = (p: Point): Point => ({ x: Hoops.length - p.x, y: Hoops.width - p.y });
  return {
    offense: side,
    at: [...l.at.slice(5, 10), ...l.at.slice(0, 5)].map(turn),
    holder: l.holder == null ? null : (l.holder + 5) % 10,
    ball: l.ball ? turn(l.ball) : null,
    formation: l.formation,
    camera: null,
    yaw: null,
  };
}

/** Swift's `Lineup ==` (cache keys). */
export const sameLineup = (a: Lineup | null, b: Lineup | null): boolean => a === b || (a != null && b != null && JSON.stringify(a) === JSON.stringify(b));

// MARK: - Ends

/**
 * Which basket each team attacks, as the theater draws it. ESPN folds its
 * coordinates onto one half court, so the data can't say which end a team
 * is at on TV: the default is the broadcast's on the night this was built
 * (the visitors at the right basket in the first half: the Spurs were going
 * right to left in overtime at Utah), the ends swapped at halftime and kept
 * for overtime, and the viewer's turn (`TheaterFlipButton`) on top of it. A
 * team's bench is by the basket it defends in the first half. `topRight`:
 * the top team attacks the right basket now; `topOpensRight`: …and did in
 * the first half. (pure; tested)
 */
export interface HoopsEnds {
  readonly topRight: boolean;
  readonly topOpensRight: boolean;
}

/** The ends in `period` (1–4, 5 on for overtime) for a game whose top team is the home team or not, turned round when the viewer `flipped` it. */
export function hoopsEnds(period: number | null, topIsHome: boolean, flipped: boolean): HoopsEnds {
  const opens = !topIsHome !== flipped;
  return { topOpensRight: opens, topRight: (period ?? 1) >= 3 ? !opens : opens };
}

/** Whether `side` attacks the right basket (null: the top team's end). */
export const endsRight = (e: HoopsEnds, side: Side | null): boolean => (side === "bottom" ? !e.topRight : e.topRight);

/** Whether `side`'s bench is at the right end (by the basket it defends in the first half). */
export const benchRight = (e: HoopsEnds, side: Side): boolean => (side === "top" ? !e.topOpensRight : e.topOpensRight);

const FLAT: HoopsEnds = { topRight: true, topOpensRight: true };

// MARK: - Between plays

/**
 * How the floor got this way, and so what it does first: play on (set up
 * in the half court, pushed up the floor first when they're far from it);
 * the ball taken out (under the basket after a score, at the sideline after
 * a whistle), then up the floor; free throws to come (lined up on the lane);
 * a timeout or the end of a quarter (both teams at their benches); halftime
 * or the final (the court empty); before a tip (round the center circle); a
 * miss nobody has yet (the ball where it lies).
 */
export type Phase = "live" | "inboundBaseline" | "inboundSideline" | "lane" | "benches" | "offCourt" | "tip" | "loose";

export const isInbound = (p: Phase) => p === "inboundBaseline" || p === "inboundSideline";

/**
 * The court between plays (BasketballScript.Rest): who has the ball, which
 * way everyone faces, how the floor got this way, where it starts from, a
 * seed for its variety; `round`: the rest before this one ran out (a long
 * stoppage goes on as a new one), so no opening; `outlet`: a big's
 * defensive board, outletted rather than brought up himself.
 */
export interface RestSpec {
  readonly offense: Side | null;
  readonly ends: HoopsEnds;
  readonly phase: Phase;
  readonly from: Lineup | null;
  readonly seed: string;
  readonly round: number;
  readonly outlet: boolean;
}

/** A court between plays, its defaults filled (nobody's ball and play on: round the center circle). */
export function restOf(r: Partial<RestSpec> & { readonly offense: Side | null }): RestSpec {
  const phase = r.phase ?? "live";
  return {
    offense: r.offense,
    ends: r.ends ?? FLAT,
    phase: r.offense == null && phase === "live" ? "tip" : phase,
    from: r.from ?? null,
    seed: r.seed ?? "rest",
    round: r.round ?? 0,
    outlet: r.outlet ?? false,
  };
}

/** Swift's `Rest ==` (cache keys). */
export const sameRest = (a: RestSpec | null, b: RestSpec | null): boolean => a === b || (a != null && b != null && JSON.stringify(a) === JSON.stringify(b));

/** How long a court between plays runs before it goes on as a new one (a long stoppage, a long possession): its sparse beats are in here. */
export const REST_LENGTH = 30;

/** The court between plays. */
export function restScript(rest: RestSpec): BasketballScript {
  // Nobody's ball (the end of a period): the floor stays turned the way it was.
  const side = rest.offense ?? rest.from?.offense ?? "top";
  const b = new BeatBuilder(null, side, endsRight(rest.ends, side), `${rest.seed}·${rest.round}`);
  b.ends = rest.ends;
  b.rest(rest);
  b.script.measureBodies();
  return b.script;
}

/**
 * A lighter beat: the play `scene` (and, for substitutions, the rest of its
 * stoppage's), from where `from` left everyone; `fallback` is who has the
 * ball when the play doesn't say.
 */
export function beatScript(scene: BasketballScene, group: readonly BasketballScene[], ends: HoopsEnds, from: Lineup | null, fallback: Side | null = null): BasketballScript {
  const side = beatSide(scene, from, fallback);
  const b = new BeatBuilder(scene, side, endsRight(ends, side));
  b.ends = ends;
  b.beat(from, group);
  b.script.measureBodies();
  return b.script;
}

/** The frame a beat is told in: the team with the ball on it (a whistle's stays with the floor as it was). */
export function beatSide(scene: BasketballScene, from: Lineup | null, fallback: Side | null): Side {
  if (scene.kind === "defensiveRebound" && from?.formation === "play" && from.offense != null) return from.offense;
  return ballSide(scene) ?? from?.offense ?? fallback ?? "top";
}

// MARK: - Where a miss comes down

/**
 * Off the rim the way a shot from there comes off (ESPN logs the rebound at
 * the miss's own spot, not where it was taken): where it hits the ring,
 * where it comes down, whether it's taken up in traffic (`high`) or after a
 * bounce. A three kicks out long, two times in three to the weak side; a
 * mid-range shot comes off six to ten feet; a floater or a hook stays at the
 * rim; a layup goes out the far side or back the way it came; a free throw
 * comes off the front, to the lane. Seeded by the miss itself, so its beat
 * and its rebound's agree. In the shooter's frame. (pure; tested)
 */
export interface Carom {
  readonly hit: FieldPoint;
  readonly spot: Point;
  readonly high: boolean;
  readonly bounce: boolean;
}

/** A Double as Swift prints it ("15.0"). */
const swiftDouble = (n: number) => (Number.isInteger(n) ? `${n}.0` : String(n));

export function carom(miss: Miss): Carom {
  const r = new SplitMix64(seed64("carom·" + (miss.id ?? `${swiftDouble(miss.spot.x)},${swiftDouble(miss.spot.y)}`)));
  const from = miss.freeThrow ? { x: Hoops.freeThrow, y: 25 } : inbounds(Hoops.court(miss.spot));
  const rim = RIM;
  const o = distance(from, rim) > 1.5 ? unit({ x: from.x - rim.x, y: from.y - rim.y }) : { x: -1, y: 0 };
  const weak = { x: o.x, y: -o.y };
  const d = miss.distance ?? distance(from, rim);
  let dir: Point;
  let reach: number;
  if (miss.freeThrow) {
    dir = rotate(o, r.in(-1.1, 1.1));
    reach = r.in(4, 7.5);
  } else if (miss.close) {
    const approach = o.x > -0.3 ? { x: -0.3, y: o.y >= 0 ? 0.954 : -0.954 } : o;
    dir = r.in(0, 1) < 0.55 ? rotate({ x: -approach.x, y: -approach.y }, r.in(-0.8, 0.8)) : rotate(approach, r.in(-0.9, 0.9));
    reach = r.in(2.5, 5.5);
  } else if (d >= 22) {
    dir = r.in(0, 1) < 0.65 ? rotate(weak, r.in(-0.45, 0.45)) : rotate(o, r.in(-0.5, 0.5));
    reach = r.in(10, 16);
  } else if (d >= 10) {
    dir = r.in(0, 1) < 0.5 ? rotate(weak, r.in(-0.5, 0.5)) : rotate(o, r.in(-0.75, 0.75));
    reach = r.in(6, 10.5);
  } else {
    const way = r.in(0, 1) < 0.5 ? weak : o;
    dir = rotate(way, r.in(-0.9, 0.9));
    reach = r.in(3, 6.5);
  }
  let spot = along(rim, dir, reach);
  // Nothing comes down behind the backboard: off the baseline, back in front of it.
  if (spot.x > 87.5) spot = { x: 87.5 - (spot.x - 87.5) * 0.6, y: spot.y };
  spot = { x: Math.min(Math.max(spot.x, 45), 92), y: Math.min(Math.max(spot.y, 1.6), 48.4) };
  const out = unit({ x: spot.x - rim.x, y: spot.y - rim.y });
  const hit = fieldPoint(along(rim, out, Hoops.rimRadius), Hoops.rimHeight + 0.15);
  const high = reach < 8.5 && r.in(0, 1) < 0.8;
  return { hit, spot, high, bounce: !high && reach > 10.5 && r.in(0, 1) < 0.5 };
}

/** The scene's shot as the miss a rebound comes off (the rebound beat's carom is this one's). */
export function missOf(scene: BasketballScene): Miss {
  const kind = scene.shot ?? scene.kind;
  return {
    spot: scene.spot ?? { x: 25, y: 15 },
    shooter: scene.shooter,
    value: scene.value,
    close: kind === "layup" || kind === "dunk" || kind === "alleyOop" || kind === "putback",
    id: scene.id,
    blocked: scene.result === "blocked",
    freeThrow: scene.kind === "freeThrow",
    distance: scene.kind === "freeThrow" ? 14 : scene.distance,
  };
}

/** A man's name for a tag: "HAYES". */
function called(person: { readonly name: string } | null | undefined): string | null {
  const name = person?.name;
  return name ? name.toUpperCase() : null;
}

const joined = (words: readonly (string | null)[]) => words.filter((w): w is string => w != null).join(" · ");

/** A stoppage's words: TIMEOUT · JAZZ, END OF 3RD, HALFTIME, END OF REGULATION, FINAL. */
export function stoppageWords(scene: BasketballScene, team: string | null = null): string {
  switch (scene.kind) {
    case "timeout": {
      if (scene.stoppage != null) return scene.stoppage;
      const who = team ?? /^(.+?) (?:Full|Short|full|short|20 Sec\.?|Official)? ?timeout/.exec(scene.text)?.[1]?.toUpperCase() ?? null;
      return joined(["TIMEOUT", who]);
    }
    case "periodEnd":
      return periodWords(scene.period ?? 1, scene.final, scene.top === scene.bottom);
    default:
      return "";
  }
}

const AT_SPOT = (point: FieldPoint) => ({ kind: "spot" as const, point });

// MARK: - Building the beats

/** The beats and the court between plays, built beat by beat (BasketballScript.Builder's beats extension). */
export class BeatBuilder extends Builder {
  // MARK: Helpers

  get right(): boolean {
    return endsRight(this.ends, this.offense);
  }

  /** A point as drawn (x left to right, y out from the near sideline, the camera's) in this frame. */
  framed(drawn: Point): Point {
    return this.right ? drawn : { x: Hoops.length - drawn.x, y: Hoops.width - drawn.y };
  }

  /** The near sideline's y in this frame. */
  get near(): number {
    return this.right ? 0 : Hoops.width;
  }

  /** Off the near sideline by `d` feet, in this frame. */
  offNear(d: number): number {
    return this.right ? -d : Hoops.width + d;
  }

  /** The side a team is (0–4 the team at the basket in front). */
  sideOf(team: Team): Side {
    const own = this.offense ?? "top";
    return team === "defense" ? (own === "top" ? "bottom" : "top") : own;
  }

  /** A team's huddle at its bench: five round a spot just off the near sideline, by the basket it defended in the first half. */
  huddle(team: Team): Point[] {
    const x = benchRight(this.ends, this.sideOf(team)) ? 66 : 28;
    return [
      [-3.0, -0.7],
      [-1.5, 0.8],
      [0, 1.3],
      [1.5, 0.8],
      [3.0, -0.7],
    ].map(([dx, dy]) => this.framed({ x: x + dx!, y: -4.4 + dy! }));
  }

  /** Starts from where the last beat left everyone, turned into this frame: true when the floor was in one of `allowed` (live play, by default); false sets up fresh. */
  place(lineup: Lineup | null, allowed: readonly Formation[] = ["play"]): boolean {
    if (!lineup || lineup.at.length !== 10 || !allowed.includes(lineup.formation)) return false;
    const seen = seenBy(lineup, this.offense ?? "top");
    this.script.players = seen.at.map((p, i) => new Player(i < 5 ? "offense" : "defense", p));
    this.start = seen;
    return true;
  }

  /** Five on five set up fresh round `fixed` (the first of them with the ball), when there's no floor to start from. */
  setUp(fixed: readonly Point[]): void {
    this.lineUp(fixed, 0);
    this.start = { offense: this.offense ?? "top", at: this.script.players.map((p) => p.at), holder: 0, ball: null, formation: "play", camera: null, yaw: null };
  }

  /** Starts from the floor as it stood, unless the man with the ball is nowhere near where ESPN puts the play (the floor had moved on, a beat was passed over): then set up there fresh, as a cut. */
  placeNear(lineup: Lineup | null, spot: Point, reach = 32): void {
    if (this.place(lineup) && distance(this.position(this.holder(), 0), spot) <= reach) return;
    this.setUp([inbounds(along(spot, this.out(spot), 3))]);
  }

  /** Players `a` and `b` trade places in the list (before anyone moves): the one a beat is about becomes 0, as the replays have it. */
  trade(a: number, b: number): void {
    const players = this.script.players;
    if (a === b || a >= players.length || b >= players.length) return;
    [players[a], players[b]] = [players[b]!, players[a]!];
    const h = this.start?.holder;
    if (this.start && h != null) this.start = { ...this.start, holder: h === a ? b : h === b ? a : h };
  }

  /** Who had the ball at the start (or the man of `team` nearest where it lay). */
  holder(lo = 0, hi = 4): number {
    const h = this.start?.holder;
    if (h != null && h >= lo && h <= hi) return h;
    const ball = this.start?.ball ?? { x: 62, y: 25 };
    let best = lo;
    for (let k = lo + 1; k <= hi; k++) if (distance(this.position(k, 0), ball) < distance(this.position(best, 0), ball)) best = k;
    return best;
  }

  /** The nearest of `pool` to `p` at t. */
  nearest(pool: readonly number[], p: Point, t = 0): number {
    let best = pool[0] ?? 0;
    for (const k of pool.slice(1)) if (distance(this.position(k, t), p) < distance(this.position(best, t), p)) best = k;
    return best;
  }

  /** A move that isn't kept on the floor (to a bench, off the court). */
  walk(i: number, path: readonly Point[], start: number, end: number, ease: Ease = "inOut"): void {
    this.script.players[i]!.move(path, start, end, ease);
  }

  /** The referee nearest the call comes in to see it (the lead on the baseline for one near the basket, else the trail on the near sideline), whistles at `t` and signals. */
  whistle(t: number, spot: Point, signal: ActionKind = "signal", toward: Point | null = null): number {
    const deep = spot.x > 79;
    const stand = deep ? { x: 95.4, y: spot.y >= 25 ? 31 : 19 } : { x: Math.min(Math.max(spot.x - 5, 50), 82), y: this.offNear(1.6) };
    const from = deep ? { x: 95.6, y: stand.y + (spot.y >= 25 ? 4 : -4) } : { x: stand.x - 6, y: stand.y };
    const ref = new Player("official", from);
    ref.enters = Math.max(t - 0.9, -0.3);
    ref.move([stand], Math.max(t - 0.7, 0), t, "out");
    ref.act(signal, t + 0.06, toward ?? spot);
    this.script.players.push(ref);
    this.script.flashes.push({ beat: "whistle", at: t, point: fieldPoint(stand, 6.2) });
    return this.script.players.length - 1;
  }

  /** Play stops at the whistle: everyone eases to a stop just past where he was going (`except` aside). */
  freeze(t: number, except: ReadonlySet<number> = new Set()): void {
    for (let i = 0; i < Math.min(this.script.players.length, 10); i++) {
      if (except.has(i)) continue;
      const here = this.position(i, t);
      const ahead = this.position(i, t + 0.3);
      const stop = { x: here.x + (ahead.x - here.x) * 0.5, y: here.y + (ahead.y - here.y) * 0.5 };
      this.script.players[i]!.move([stop], t, t + 0.45, "out");
    }
  }

  /** A tag over the beat, in `side`'s color, from `t`. */
  tagAt(text: string, side: Side | null, t: number): void {
    this.script.tag = { text, side, at: t };
  }

  /** The man the data credits with a rebound, from where he'd come: of his team (`pool`), the nearest the ball weighted by how he plays (a big from near the rim, a guard from out on the floor). */
  rebounderOf(pool: readonly number[], spot: Point, role: Role | null | undefined, t: number): number | null {
    const cost = (i: number) => {
      const p = this.position(i, t);
      const lean = role === "big" ? 0.5 : role === "guard" ? -0.3 : 0.1;
      return distance(p, spot) + lean * distance(p, RIM);
    };
    let best: number | null = null;
    for (const k of pool) if (best == null || cost(k) < cost(best)) best = k;
    return best;
  }

  /** The ball off the rim at `t` (leaving the ring at the carom's point), and down to `r` (null: the floor) where it's going: a man in traffic takes it high, one out on the floor on the bounce. When it's taken. */
  comeOff(c: Carom, t: number, r: number | null, from: number): number {
    const script = this.script;
    script.rimHit = t;
    script.rimStrength = 0.3;
    script.flashes.push({ beat: "rim", at: t, point: c.hit });
    if (r == null) {
      // Nobody's: up off the rim and down, bouncing to rest.
      const peak = 1.6 + distance(ground(c.hit), c.spot) * 0.1;
      const time = Math.sqrt((8 * peak) / G) * 0.75 + 0.12;
      this.fly(c.hit, fieldPoint(c.spot, 4), t, time, arc(peak));
      const o = unit({ x: c.spot.x - RIM.x, y: c.spot.y - RIM.y });
      this.dropToFloor(fieldPoint(c.spot, 4), t + time, { x: o.x * 3.5, y: o.y * 3.5 }, 9);
      return t + time;
    }
    const land = this.reach(r, c.spot, from, t + (c.high ? 0.7 : 1.0));
    if (c.high) {
      const peak = 1.8 + distance(ground(c.hit), land) * 0.1;
      const time = Math.sqrt((8 * peak) / G) * 0.8 + 0.1;
      this.fly(c.hit, fieldPoint(land, 8.6), t, time, arc(peak));
      this.takeRebound(r, land, t + time, from);
      return t + time;
    }
    // Long: down once short of him, up into his hands at the chest.
    const way = unit({ x: land.x - RIM.x, y: land.y - RIM.y });
    const bounceAt = along(land, way, c.bounce ? -3.2 : -0.1);
    const peak = 2.4 + distance(ground(c.hit), bounceAt) * 0.12;
    const first = Math.sqrt((8 * peak) / G) * 0.85 + 0.12;
    if (c.bounce) {
      this.fly(c.hit, fieldPoint(bounceAt, 0.4), t, first, arc(peak));
      this.fly(fieldPoint(bounceAt, 0.4), fieldPoint(land, 4.2), t + first, 0.34, arc(1.1));
    } else {
      this.fly(c.hit, fieldPoint(land, 5.2), t, first, arc(peak));
    }
    const caught = t + first + (c.bounce ? 0.34 : 0);
    this.move(r, [along(land, way, 0.6)], from, Math.max(caught - 0.05, from + 0.2), "out");
    this.act(r, "catchBall", caught, land);
    this.hold(r, caught, Infinity);
    script.flashes.push({ beat: "catchBall", at: caught, point: fieldPoint(land, 4.6) });
    this.over = Math.max(this.over, caught + 0.3);
    return caught;
  }

  // MARK: Dispatch

  beat(lineup: Lineup | null, group: readonly BasketballScene[]): void {
    const scene = this.scene;
    if (!scene) return;
    const script = this.script;
    script.formation = "play";
    switch (scene.kind) {
      case "jumper":
      case "three":
      case "layup":
      case "dunk":
      case "alleyOop":
      case "putback":
      case "block":
        this.missBeat(lineup);
        break;
      case "freeThrow":
        this.freeThrowBeat(lineup);
        break;
      case "offensiveRebound":
      case "defensiveRebound":
        this.reboundBeat(lineup);
        break;
      case "steal":
      case "turnover":
        this.turnoverBeat(lineup);
        break;
      case "foul":
      case "violation":
        this.whistleBeat(lineup);
        break;
      case "jumpBall":
        this.jumpBallBeat();
        break;
      case "substitution":
        this.substitutionBeat(lineup, group.length === 0 ? [scene] : group);
        break;
      case "timeout":
        this.stoppageBeat(lineup, "benches");
        break;
      case "periodEnd":
        this.stoppageBeat(lineup, scene.final || scene.period === 2 ? "offCourt" : "benches");
        break;
      case "challenge":
        this.reviewBeat(lineup);
        break;
    }
    this.sortLegs();
    // A whistle's tag says it; a ball play's stamp does (a free throw has both: its place in the trip, its result).
    const shows = basketballStamp(scene).parts.length > 0;
    if (shows && script.stamp === Infinity && script.tag == null) script.stamp = Math.max(this.arrive + 0.3, this.over - 0.2, 0.9);
    if (!shows) script.stamp = Infinity;
    // A ball still bouncing after the shot doesn't hold the beat: the next one takes it from where it lies.
    if (scene.shot != null) this.over = Math.min(this.over, this.arrive + (scene.kind === "freeThrow" ? 0.8 : 1.4));
    const flashes = script.flashes.map((f) => f.at);
    const ends = [Number.isFinite(script.stamp) ? script.stamp + 0.9 : 0, this.over + 0.4, (flashes.length > 0 ? Math.max(...flashes) : 0) + 0.7, (script.tag?.at ?? 0) + 1.4];
    script.settle = Math.max(Math.max(...ends), 1.2);
    if (shows) this.measureStamp();
    script.duration = script.settle + 0.2;
    // The referee goes once it's called.
    for (const p of script.players) if (p.team === "official") p.leaves = Math.min(p.leaves, script.duration);
    this.beatCamera();
  }

  // MARK: A miss

  /**
   * A missed shot, from ESPN's spot: the ball to the shooter the way the
   * floor gives it (off the dribble when he has it, else a pass as he gets
   * there), the shot (a three's a three's arc), off the rim, and the rebound
   * into the hands of the man the data credits.
   */
  missBeat(lineup: Lineup | null): void {
    const scene = this.scene;
    if (!scene) return;
    const script = this.script;
    // A live placeholder can come without a spot: a jumper from the top of the key, until ESPN says.
    const spot = inbounds(Hoops.court(scene.spot ?? { x: 25, y: 14 }));
    const kind = scene.shot ?? scene.kind;
    const close = kind === "layup" || kind === "dunk" || kind === "alleyOop" || kind === "putback" || distance(spot, RIM) < 3.5;
    const offDribble = close || ["pullUp", "stepBack", "floater", "drive", "fadeaway", "turnaround", "hook"].includes(scene.move);
    let passer: number | null = null;
    if (this.place(lineup)) {
      const h = this.holder();
      const catcher = this.nearest([0, 1, 2, 3, 4].filter((k) => k !== h), spot);
      // ESPN's plain "jump shot" misses say nothing of the pass: off one when he's far from the ball, off the dribble when it's his.
      const pull = distance(this.position(h, 0), spot) < 10 || (offDribble && scene.typeID !== 92 && scene.typeID !== 282);
      const shooter = pull ? h : catcher;
      this.trade(0, shooter);
      if (!pull) passer = this.start?.holder ?? this.holder();
      if (passer === 0) passer = null;
    }
    if (script.players.length >= 10 && this.start != null && distance(this.position(0, 0), spot) > 30) {
      // Nobody near where ESPN says he shot (the floor had moved on): set up there fresh, as a cut.
      passer = null;
      script.players = [];
    }
    if (script.players.length === 0) {
      const o = this.out(spot);
      const lateral = unit({ x: -o.y, y: o.x });
      const from = close ? along(RIM, this.approach(spot), 20) : offDribble ? along(along(spot, o, 6), lateral, 7 * this.random.sign()) : spot;
      this.setUp([inbounds(from)]);
    }
    script.shooter = 0;
    this.credit(0, scene.shooter);
    let t = 0.2;
    if (passer != null) {
      // Off the catch: the pass reaches him as he gets to his spot.
      this.hold(passer, 0, t);
      const time = this.passTime(passer, t, spot, "chest");
      this.move(0, [spot], Math.max(t - 0.3, 0), t + time, "out");
      t = this.pass(passer, 0, t, spot, "chest");
      this.hold(0, t, Infinity);
      t += 0.2;
    } else if (close) {
      // At the rim: downhill from where he is, up, off the rim.
      this.hold(0, 0, t);
      this.bounce(0, t, Infinity);
      const a = this.approach(distance(this.position(0, t), RIM) > 6 ? this.position(0, t) : spot);
      const takeoff = along(RIM, a, kind === "dunk" ? 5.2 : 4.4);
      t = this.drive(0, takeoff, t, 20, "linear");
      this.lastLegUntil(t);
      this.hold(0, t, t + 0.3);
      this.move(0, [along(RIM, a, 1.2)], t, t + 0.62, "linear");
      this.jump(0, t, t + 0.31, t + 0.62, kind === "dunk" ? 3.0 : 2.2);
      this.act(0, kind === "dunk" ? "dunk" : "layup", t + 0.31, RIM);
      script.release = t + 0.3;
      const hand = fieldPoint(along(RIM, a, 1.6), kind === "dunk" ? Hoops.rimHeight + 0.9 : 9.3);
      const c = carom(missOf(scene));
      this.fly(hand, c.hit, t + 0.3, kind === "dunk" ? 0.08 : 0.32, kind === "dunk" ? STRAIGHT : arc(1.2));
      this.arrive = t + (kind === "dunk" ? 0.38 : 0.62);
      this.helpAtRim(t + 0.31, a);
      this.reboundOff(c, this.arrive, t + 0.3);
      // A dunk off the back iron shakes it.
      if (kind === "dunk") script.rimStrength = 0.85;
      this.boxOut(t + 0.3);
      script.stamp = this.arrive + 0.35;
      return;
    } else {
      this.hold(0, 0, t);
      if (distance(this.position(0, t), spot) > 2) {
        this.bounce(0, t, Infinity);
        t = this.drive(0, spot, t, distance(this.position(0, t), spot) > 25 ? 21 : 15);
        this.lastLegUntil(t);
      }
      this.hold(0, t, Infinity);
      t += 0.1;
    }
    // Up: the dip, the rise, the release just before the top.
    const three = scene.value === 3;
    let lift = three ? 1.3 : 1.5;
    let angle = distance(spot, RIM) > 18 ? 0.84 : 0.88;
    let drift = 0;
    switch (scene.move) {
      case "floater":
        [lift, angle] = [1.1, 1.02];
        break;
      case "hook":
        [lift, angle] = [0.9, 1.0];
        break;
      case "fadeaway":
        [lift, drift] = [1.6, 2.0];
        break;
      case "stepBack":
        drift = 0.6;
        break;
      case "turnaround":
        [lift, drift] = [1.6, 0.8];
        break;
      default:
        break;
    }
    if (scene.typeID === 282) [lift, angle] = [1.0, 0.7];
    const takeoff = t + 0.1;
    const airtime = 2 * Math.sqrt((2 * lift) / G);
    const releaseAt = takeoff + airtime / 2 - 0.03;
    if (drift > 0) this.move(0, [along(this.position(0, takeoff), this.out(spot), drift)], takeoff, takeoff + airtime, "linear");
    this.jump(0, takeoff, takeoff + airtime / 2, takeoff + airtime, lift);
    this.act(0, scene.move === "hook" ? "hook" : "shoot", releaseAt, RIM);
    const held = this.lastHeld(0);
    if (held >= 0) script.legs[held]!.until = releaseAt;
    script.release = releaseAt;
    const hand = this.release(this.position(0, releaseAt), lift * 0.97);
    const c = carom(missOf(scene));
    const flight = this.shoot(hand, c.hit, releaseAt, angle);
    this.arrive = flight.end;
    // His man closes out, a hand up as it goes.
    this.shadow(0, this.arrive + 0.2, new Set([5]));
    const at = this.position(0, releaseAt);
    const contestAt = along(at, unit({ x: RIM.x - at.x, y: RIM.y - at.y }), scene.move === "stepBack" ? 4.4 : 3.0);
    this.move(5, [contestAt], Math.max(releaseAt - 0.65, 0), releaseAt - 0.02, "out");
    this.contest(5, releaseAt, ground(hand), 1.0);
    this.reboundOff(c, this.arrive, releaseAt);
    this.boxOut(releaseAt);
    script.stamp = this.arrive + 0.35;
  }

  /** The help comes over at the rim, a beat late. */
  helpAtRim(t: number, approach: Point): void {
    const helper = this.nearest([6, 7, 8, 9], RIM, t);
    this.move(helper, [along(RIM, rotate(approach, approach.y >= 0 ? -0.5 : 0.5), 2.8)], Math.max(t - 0.8, 0), t - 0.05);
    this.contestAtRim(helper, t, false);
    this.shadow(0, t + 0.8, new Set([helper, 5]));
    this.trail(5, 0, 0.2, t + 0.3, { x: -approach.x, y: -approach.y });
  }

  /** Off the rim to the credited rebounder (his team's, by where he'd come from), or to the floor when nobody has it yet; a team rebound rolls out of bounds. The offense's guards get back; its bigs crash. */
  reboundOff(c: Carom, t: number, release: number): void {
    const scene = this.scene;
    if (!scene) return;
    const rebound = scene.rebound;
    let r: number | null = null;
    if (rebound && rebound.person != null) {
      const own = rebound.offensive && rebound.person.id != null && rebound.person.id === scene.shooter?.id;
      r = own ? 0 : this.rebounderOf(rebound.offensive ? [1, 2, 3, 4] : [5, 6, 7, 8, 9], c.spot, rebound.person.role, release);
      this.credit(r, rebound.person);
    }
    const caught = this.comeOff(c, t, r, release + 0.15);
    if (rebound && rebound.person == null) {
      // A team rebound: it went out (or the clock ran): out over the nearest line.
      this.outOfBounds(c.spot, caught + 0.3);
    }
    // Back on defense, or in for it.
    for (let k = 1; k < 5; k++) {
      if (k === r) continue;
      const here = this.position(k, release);
      if (distance(here, RIM) > 18) {
        this.move(k, [{ x: here.x - 7, y: here.y + (25 - here.y) * 0.2 }], release + 0.2, release + 1.4);
      } else {
        this.move(k, [along(here, unit({ x: RIM.x - here.x, y: RIM.y - here.y }), 3)], release + 0.1, release + 0.8);
      }
    }
  }

  /** The ball bouncing along the floor from `from` to `to` in `hops` bounces, each lower, never through the floor (the ball's center stays a radius up). */
  hop(from: FieldPoint, to: FieldPoint, start: number, time: number, hops: number): void {
    const n = 30;
    const high = from.z > 1;
    const points: FieldPoint[] = [];
    for (let k = 0; k <= n; k++) {
      const u = k / n;
      const g = { x: from.x + (to.x - from.x) * u, y: from.y + (to.y - from.y) * u };
      // Down from where it starts (or up off the floor), then each hop a little lower; into where it ends.
      const phase = u * Math.max(hops, 1);
      const hop = Math.min(Math.trunc(phase), Math.max(hops, 1) - 1);
      const f = phase - hop;
      const top = Math.max(from.z, 1.2) * 0.45 ** hop;
      const z = hop === 0 && high ? 0.4 + (from.z - 0.4) * (1 - f * f) : 0.4 + (top - 0.4) * 4 * f * (1 - f);
      points.push(fieldPoint(g, Math.max(z, 0.4) + (to.z - 0.4) * u));
    }
    this.fly(from, to, start, time, { kind: "samples", points });
  }

  /** The ball rolls from `p` out over the nearest line, at `t`. */
  outOfBounds(p: Point, t: number): void {
    const lines: [number, Point][] = [
      [p.y, { x: p.x, y: -2 }],
      [Hoops.width - p.y, { x: p.x, y: Hoops.width + 2 }],
      [Hoops.length - p.x, { x: Hoops.length + 2, y: p.y }],
    ];
    const out = nearestLine(lines);
    this.script.legs = this.script.legs.filter((l) => !(l.from >= t));
    const time = Math.min(Math.max(distance(p, out) / 9, 0.5), 1.4);
    this.hop(fieldPoint(p, 0.4), fieldPoint(out, 0.4), t, time, 2);
    this.script.legs.push({ from: t + time, until: Infinity, hand: AT_SPOT(fieldPoint(out, 0.4)) });
    this.over = Math.max(this.over, t + 1);
  }

  // MARK: A free throw

  /**
   * One free throw, as it comes: both teams on the lane (or still on it from
   * the last), the shooter at the line with his own routine (how many
   * dribbles, how long he holds it: his, every trip), the shot, and through
   * the net (a swish, or in off the rim) or off it; a trip's last miss is
   * live, the lane crashing as it leaves his hand, and comes down to the man
   * the data credits.
   */
  freeThrowBeat(lineup: Lineup | null): void {
    const scene = this.scene;
    if (!scene) return;
    const script = this.script;
    script.formation = "lane";
    const line = { x: Hoops.freeThrow - 0.6, y: 25 };
    const last = (scene.attempt ?? 1) >= (scene.attempts ?? 1);
    if (!this.place(lineup, ["lane"])) this.laneUp();
    // The shooter is the one at the line.
    this.trade(0, this.nearest([0, 1, 2, 3, 4], line));
    const official = this.laneOfficial();
    // His routine: seeded by him, so it's the same every trip.
    const routine = new SplitMix64(seed64("routine·" + (scene.shooter?.id ?? scene.shooter?.name ?? scene.id)));
    const dribbles = Math.trunc(routine.in(1, 3.99));
    const breath = routine.in(0.1, 0.4);
    const spin = routine.next() % 3n === 0n;
    let t = 0.3;
    this.hold(0, 0, t);
    this.bounce(0, t, t + dribbles * 0.42);
    t += dribbles * 0.42;
    this.hold(0, t, Infinity);
    if (spin) t += 0.25;
    t += breath;
    const releaseAt = t + 0.35;
    this.jump(0, releaseAt - 0.15, releaseAt + 0.03, releaseAt + 0.2, 0.25);
    this.act(0, "shoot", releaseAt, RIM);
    const held = this.lastHeld(0);
    if (held >= 0) script.legs[held]!.until = releaseAt;
    script.release = releaseAt;
    script.shooter = 0;
    this.credit(0, scene.shooter);
    const hand = this.release(line, 0.2);
    this.tagAt(`FREE THROW ${scene.attempt ?? 1} OF ${scene.attempts ?? 1}`, scene.offense, 0);
    if (made(scene)) {
      // A swish, or in off the front of the rim.
      const rattle = seed64(scene.id) % 4n === 0n;
      if (rattle) {
        const kiss = fieldPoint(along(RIM, { x: -1, y: 0 }, 0.55), Hoops.rimHeight + 0.1);
        const f = this.shoot(hand, kiss, releaseAt, 0.9);
        script.rimHit = f.end;
        script.rimStrength = 0.2;
        script.flashes.push({ beat: "rim", at: f.end, point: kiss });
        this.fly(kiss, RIM_POINT, f.end, 0.22, arc(0.5));
        this.throughNet(f.end + 0.22, { x: 1, y: 0 }, 0.35);
        this.arrive = f.end + 0.22;
      } else {
        const f = this.shoot(hand, RIM_POINT, releaseAt, 0.92);
        this.throughNet(f.end, { x: 1, y: 0 }, 0.5);
        this.arrive = f.end;
      }
      if (!last) {
        // The referee takes it under the basket.
        this.walk(official, [{ x: 93.2, y: 25 + (this.position(official, 0).y > 25 ? 2.5 : -2.5) }], this.arrive, this.arrive + 0.7, "out");
      }
    } else {
      const c = carom(missOf(scene));
      const f = this.shoot(hand, c.hit, releaseAt, 0.9);
      this.arrive = f.end;
      if (last) {
        let r: number | null = null;
        const rebound = scene.rebound;
        if (rebound && rebound.person != null) {
          r = this.rebounderOf(rebound.offensive ? [1, 2, 3, 4] : [5, 6, 7, 8, 9], c.spot, rebound.person.role, releaseAt);
          this.credit(r, rebound.person);
        }
        this.comeOff(c, f.end, r, releaseAt + 0.05);
      } else {
        this.comeOff(c, f.end, null, releaseAt);
      }
    }
    if (last) {
      // In as it leaves his hand: the defense boxes out, the offense goes for it.
      for (let k = 1; k < 10; k++) {
        if (script.players[k]!.actions.some((a) => a.kind === "rebound" || a.kind === "catchBall")) continue;
        const here = this.position(k, releaseAt);
        if (!(distance(here, RIM) < 20)) continue;
        const inward = unit({ x: RIM.x - here.x, y: RIM.y - here.y });
        this.move(k, [along(here, inward, k >= 5 ? 1.6 : 2.6)], releaseAt + 0.02, releaseAt + 0.5, "out");
        if (k >= 5) this.act(k, "boxOut", releaseAt + 0.3, RIM);
      }
    } else {
      // Nothing's live: hands on hips, waiting.
      for (let k = 1; k < 10; k++) this.act(k, "hips", 0, line);
    }
    script.look = { point: line, from: 0 };
    script.stamp = this.arrive + 0.3;
  }

  /** Both teams on the lane for free throws: the defense in the spaces nearest the basket and the third, the offense in the second, the rest behind the arc; the shooter at the line. */
  laneUp(): void {
    const line = { x: Hoops.freeThrow - 0.6, y: 25 };
    const ours = [line, { x: 81.5, y: 33.8 }, { x: 81.5, y: 16.2 }, { x: 66, y: 39 }, { x: 66, y: 11 }];
    const theirs = [
      { x: 63.5, y: 26 },
      { x: 84.5, y: 33.8 },
      { x: 84.5, y: 16.2 },
      { x: 78.5, y: 33.8 },
      { x: 78.5, y: 16.2 },
    ];
    this.script.players = [...ours.map((p) => new Player("offense", p)), ...theirs.map((p) => new Player("defense", p))];
    this.start = { offense: this.offense, at: [...ours, ...theirs], holder: 0, ball: null, formation: "lane", camera: null, yaw: null };
  }

  /** The lead referee under the basket for free throws. */
  laneOfficial(): number {
    const ref = new Player("official", { x: 95.2, y: 21 });
    ref.enters = -1;
    this.script.players.push(ref);
    return this.script.players.length - 1;
  }

  // MARK: A rebound

  /** A rebound that came in after its miss had been told: the ball off the rim where the miss sent it (still bouncing where it lay, when it had come down), into the hands of the man the data credits. */
  reboundBeat(lineup: Lineup | null): void {
    const scene = this.scene;
    if (!scene) return;
    const script = this.script;
    const miss: Miss = scene.miss ?? { spot: scene.spot ?? { x: 25, y: 12 }, shooter: null, value: 2, close: false, id: scene.id };
    const c = carom(miss);
    const shooterSide = scene.kind === "offensiveRebound";
    if (!this.place(lineup)) this.setUp([inbounds(Hoops.court(miss.freeThrow ? { x: 25, y: 15 } : miss.spot))]);
    script.formation = "play";
    const pool = shooterSide ? [0, 1, 2, 3, 4] : [5, 6, 7, 8, 9];
    const r = scene.shooter == null ? null : this.rebounderOf(pool, c.spot, scene.shooter.role, 0);
    this.credit(r, scene.shooter);
    const lying = this.start?.ball ?? null;
    if (lying && this.start?.holder == null && r != null && distance(this.position(r, 0), lying) < 24) {
      // Where it came down: he gets to it and takes it up.
      script.legs = [{ from: 0, until: Infinity, hand: AT_SPOT(fieldPoint(lying, 0.4)) }];
      const at = this.position(r, 0);
      const time = Math.max(distance(at, lying) / 16, 0.35);
      this.move(r, [along(lying, unit({ x: at.x - lying.x, y: at.y - lying.y }), 0.8)], 0.1, 0.1 + time, "out");
      const caught = 0.1 + time;
      this.fly(fieldPoint(lying, 0.4), fieldPoint(this.position(r, caught), 4.2), caught - 0.05, 0.18, STRAIGHT);
      this.act(r, "catchBall", caught + 0.1, lying);
      this.hold(r, caught + 0.13, Infinity);
      script.flashes.push({ beat: "catchBall", at: caught + 0.13, point: fieldPoint(lying, 4.2) });
      this.over = caught + 0.5;
      this.arrive = caught;
    } else {
      this.arrive = this.comeOff(c, 0.25, r, 0.1);
      if (r == null) this.outOfBounds(c.spot, this.arrive + 0.4);
    }
    this.boxOut(0);
    script.stamp = this.arrive + 0.15;
  }

  // MARK: A turnover

  /** A turnover by its kind, at ESPN's spot: a pass picked off by the man who stole it, a ball poked loose, a pass or a dribble gone out of bounds, a travel (a whistle), an offensive foul's contact. */
  turnoverBeat(lineup: Lineup | null): void {
    const scene = this.scene;
    if (!scene) return;
    const script = this.script;
    const spot = scene.spot ? inbounds(Hoops.court(scene.spot)) : { x: 66, y: 25 };
    this.placeNear(lineup, spot);
    const h = this.holder();
    this.trade(0, h);
    const theCall = scene.call ?? { kind: "other" as const, words: "TURNOVER" };
    let stealer: number | null = null;
    if (scene.kind === "steal") {
      this.trade(5, this.nearest([5, 6, 7, 8, 9], spot));
      stealer = 5;
    }
    this.credit(0, scene.shooter);
    this.credit(stealer, scene.steal?.stealer);
    const name = called(scene.shooter);
    if (theCall.kind === "badPass" && stealer != null) {
      // A pass into the lane he jumps: picked off where ESPN put it.
      const target = along(spot, unit({ x: spot.x - this.position(0, 0).x, y: spot.y - this.position(0, 0).y }), 9);
      const receiver = this.nearest([1, 2, 3, 4], target);
      this.move(receiver, [inbounds(target)], 0, 0.8);
      this.hold(0, 0, 0.35);
      const from = this.position(0, 0.35);
      const d = distance(from, spot);
      const time = Math.min(Math.max(d / 38, 0.2), 0.6);
      this.fly(fieldPoint(along(from, unit({ x: spot.x - from.x, y: spot.y - from.y }), 0.8), 4.6), fieldPoint(spot, 4.4), 0.35, time, arc(0.6));
      this.act(0, "pass", 0.35, spot);
      const takeAt = 0.35 + time;
      this.move(5, [along(spot, this.out(spot), -0.6)], 0.15, takeAt, "out");
      this.act(5, "steal", takeAt, spot);
      script.flashes.push({ beat: "steal", at: takeAt, point: fieldPoint(spot, 3) });
      this.pickOff(5, takeAt);
      this.arrive = takeAt;
      script.stamp = takeAt + 0.3;
    } else if (theCall.kind === "lostBall" || theCall.kind === "badPass") {
      // Poked loose (or off his knee), a few feet, and gathered.
      this.hold(0, 0, 0.15);
      this.bounce(0, 0.15, 0.75);
      const way = unit({ x: spot.x - this.position(0, 0).x + 0.01, y: spot.y - this.position(0, 0).y });
      this.move(0, [spot], 0.15, 0.75, "inOut");
      const taker = stealer ?? this.nearest([5, 6, 7, 8, 9], spot, 0.75);
      this.move(taker, [along(spot, rotate(way, 0.9), 2.2)], 0.2, 0.75, "out");
      if (stealer != null) this.act(taker, "steal", 0.75, spot);
      const turn = this.random.in(-1.2, 1.2);
      const loose = inbounds(along(spot, rotate(way, turn), this.random.in(4, 7)));
      this.hop(fieldPoint(spot, 1.2), fieldPoint(loose, 1.0), 0.75, 0.5, 2);
      script.flashes.push({ beat: "steal", at: 0.75, point: fieldPoint(spot, 1.5) });
      this.move(taker, [along(loose, rotate(way, 0.6), 0.7)], 0.8, 1.25, "out");
      this.move(0, [along(spot, way, 1.5)], 0.75, 1.2, "out");
      this.fly(fieldPoint(loose, 1.0), fieldPoint(this.position(taker, 1.3), 4.2), 1.25, 0.12, STRAIGHT);
      this.act(taker, "catchBall", 1.37, loose);
      this.hold(taker, 1.37, Infinity);
      this.pickOff(taker, 1.37);
      this.arrive = 1.37;
      script.stamp = 1.6;
    } else if (theCall.kind === "outOfBounds") {
      // Out over the nearest line: a pass that sails, a dribble that gets away.
      const out = nearestLine([
        [spot.y, { x: spot.x, y: -2.5 }],
        [Hoops.width - spot.y, { x: spot.x, y: Hoops.width + 2.5 }],
        [Hoops.length - spot.x, { x: Hoops.length + 2.5, y: spot.y }],
      ]);
      this.hold(0, 0, 0.3);
      const passed = scene.typeID === 90;
      if (passed) {
        this.act(0, "pass", 0.3, out);
        const from = this.position(0, 0.3);
        this.fly(fieldPoint(from, 4.6), fieldPoint(out, 2.5), 0.3, Math.min(Math.max(distance(from, out) / 34, 0.35), 0.9), arc(1.2));
      } else {
        this.bounce(0, 0.3, 0.8);
        this.move(0, [spot], 0.3, 0.8);
        this.hop(fieldPoint(spot, 1.0), fieldPoint(out, 0.4), 0.8, 0.6, 2);
      }
      const gone = script.legs.at(-1)?.until ?? 1;
      script.legs.push({ from: gone, until: Infinity, hand: AT_SPOT(fieldPoint(out, 0.4)) });
      this.whistle(gone + 0.05, spot, "point", { x: 0, y: 25 });
      this.freeze(gone + 0.1);
      this.tagAt(joined(["OUT OF BOUNDS", name]), scene.offense, gone + 0.05);
      this.arrive = gone;
    } else if (theCall.kind === "offensive") {
      this.chargeBeat(spot, false, name, scene.offense);
    } else if (theCall.kind === "offensiveGoaltending") {
      // A shot up from the arc, touched on its way down by his own man at the rim.
      const shooter = this.nearest([1, 2, 3, 4], { x: 68, y: 25 });
      this.hold(0, 0, 0.25);
      const p = this.pass(0, shooter, 0.25, this.position(shooter, 0.6), "chest");
      this.hold(shooter, p, p + 0.3);
      this.act(shooter, "shoot", p + 0.3, RIM);
      const f = this.shoot(this.release(this.position(shooter, p + 0.3), 1.4), fieldPoint(along(RIM, this.out(this.position(shooter, p)), -0.2), Hoops.rimHeight + 0.8), p + 0.3, 0.85);
      this.move(0, [along(RIM, { x: -0.6, y: 0.8 }, 2.2)], 0.3, f.end - 0.4);
      this.jump(0, f.end - 0.35, f.end, f.end + 0.35, 2.8);
      this.act(0, "tip", f.end, RIM);
      this.fly(script.flights[f.flight]!.to, fieldPoint(along(RIM, { x: -1, y: 0.3 }, 6), 0.4), f.end, 0.6, arc(1));
      this.whistle(f.end + 0.15, RIM);
      this.freeze(f.end + 0.2);
      this.tagAt(joined(["OFFENSIVE GOALTENDING", name]), scene.offense, f.end + 0.15);
      this.arrive = f.end;
    } else {
      // A travel, a double dribble, three seconds, the shot clock: on the move at the spot, the whistle, the ball set down.
      this.hold(0, 0, 0.2);
      this.bounce(0, 0.2, 0.95);
      this.move(0, [spot], 0.2, 0.95);
      const at = 0.95;
      this.hold(0, at, at + 0.6);
      this.whistle(at, spot, theCall.kind === "traveling" ? "signal" : "point", { x: 0, y: 25 });
      this.freeze(at + 0.05, new Set([0]));
      this.move(0, [along(spot, this.out(spot), 1.2)], at, at + 0.5, "out");
      const set = along(spot, { x: -1, y: 0 }, 3);
      this.hop(fieldPoint(spot, 4.4), fieldPoint(set, 0.4), at + 0.6, 0.5, 2);
      script.legs.push({ from: at + 1.1, until: Infinity, hand: AT_SPOT(fieldPoint(set, 0.4)) });
      const words = theCall.kind === "other" ? theCall.words : callName(theCall.kind);
      this.tagAt(joined([words, theCall.kind === "shotClock" ? null : name]), scene.offense, at);
      this.arrive = at;
    }
    if (script.tag == null && script.stamp === Infinity) script.stamp = this.arrive + 0.3;
    if (script.tag != null) script.stamp = Infinity;
  }

  /** He has it, and turns up the floor the other way: the start of the break. */
  pickOff(i: number, t: number): void {
    this.hold(i, t, Infinity);
    const here = this.position(i, t);
    this.move(i, [{ x: here.x - 5, y: here.y + (25 - here.y) * 0.25 }], t + 0.15, t + 0.75, "inOut");
    this.over = Math.max(this.over, t + 0.75);
    // The man who lost it turns to chase.
    const loser = this.position(0, t);
    this.move(0, [{ x: loser.x - 2.5, y: loser.y }], t + 0.1, t + 0.7, "out");
  }

  /** An offensive foul: the man with the ball drives into a defender set at ESPN's spot (a charge puts him on the floor; a push-off shoves him back), the whistle, the call. */
  chargeBeat(spot: Point, charge: boolean, name: string | null, side: Side | null): void {
    const d = this.nearest([5, 6, 7, 8, 9], spot);
    this.trade(5, d);
    this.credit(0, this.scene?.shooter);
    this.credit(5, this.scene?.drew);
    this.hold(0, 0, 0.2);
    this.bounce(0, 0.2, Infinity);
    const way = unit({ x: spot.x - this.position(0, 0).x + 0.01, y: spot.y - this.position(0, 0).y });
    const meet = along(spot, way, -1.4);
    const hit = this.drive(0, meet, 0.2, 17, "linear");
    this.lastLegUntil(hit);
    this.hold(0, hit, Infinity);
    // The defender beats him there and sets.
    this.move(5, [along(spot, way, 0.3)], 0.1, Math.max(hit - 0.3, 0.3), "out");
    this.act(0, "reach", hit, spot);
    const knocked = along(spot, way, charge ? 2.4 : 2.0);
    this.move(5, [knocked], hit, hit + 0.35, "out");
    this.act(5, charge ? "fall" : "reach", hit + 0.1, this.position(0, hit));
    this.move(0, [along(meet, way, 0.8)], hit, hit + 0.3, "out");
    this.whistle(hit + 0.12, spot, charge ? "fall" : "signal", { x: 0, y: 25 });
    this.freeze(hit + 0.2, new Set([0, 5]));
    this.tagAt(joined([charge ? "CHARGE" : "OFFENSIVE FOUL", name]), side, hit + 0.12);
    this.arrive = hit;
    this.over = Math.max(this.over, hit + 1.4);
  }

  // MARK: A whistle

  /**
   * A foul or a violation at ESPN's spot: the man it was on (the one with
   * the ball, or nearest it) and the man who did it, the contact the call
   * says (a hand on a shooter, a reach on the dribble, both diving for a
   * loose ball, a hard foul that puts him down), the referee's whistle, and
   * the tag (SHOOTING FOUL · HAYES).
   */
  whistleBeat(lineup: Lineup | null): void {
    const scene = this.scene;
    const theCall = scene?.call;
    if (!scene || !theCall) return;
    const script = this.script;
    const name = called(scene.shooter);
    const words = joined([theCall.kind === "other" ? theCall.words : callName(theCall.kind), name]);
    const DEFAULT = { x: 68, y: 25 };
    let spot = scene.spot ? inbounds(Hoops.court(scene.spot)) : DEFAULT;
    if (scene.spot == null && this.place(lineup)) {
      // No spot from ESPN (a kicked ball, goaltending): where the ball is.
      spot = this.position(this.holder(), 0);
    } else {
      this.placeNear(lineup, spot);
    }
    if (theCall.kind === "offensive" || theCall.kind === "charge") {
      this.trade(0, this.holder());
      this.chargeBeat(spot, theCall.kind === "charge", name, scene.offense);
      return;
    }
    if (theCall.kind === "technical" || theCall.kind === "delay" || ballSide(scene) == null) {
      // Nothing on the floor: the whistle, a T.
      const h = this.holder();
      this.hold(h, 0, Infinity);
      const at = 0.4;
      this.whistle(at, spot.x === DEFAULT.x && spot.y === DEFAULT.y ? this.position(h, 0) : spot, "signal");
      this.tagAt(words, scene.offense, at);
      this.over = at + 1;
      return;
    }
    // The man it was on: the one with the ball (or nearest the spot), there by the contact.
    const h = this.holder();
    const fouled = distance(this.position(h, 0), spot) < 14 || theCall.kind === "shooting" ? h : this.nearest([0, 1, 2, 3, 4], spot);
    this.trade(0, fouled);
    const fouler = this.nearest([5, 6, 7, 8, 9], spot, 0.6);
    this.trade(5, fouler);
    this.credit(0, scene.drew);
    this.credit(5, scene.shooter);
    const carrying = this.start?.holder === 0;
    const contact = Math.max(0.75, Math.min(distance(this.position(0, 0), spot) / 15 + 0.35, 1.3));
    if (carrying) {
      this.hold(0, 0, 0.15);
      this.bounce(0, 0.15, contact);
    } else {
      this.hold(this.holder(), 0, Infinity);
    }
    this.move(0, [spot], 0.1, contact, "inOut");
    const at = this.position(0, contact);
    const way = unit({ x: RIM.x - at.x, y: RIM.y - at.y });
    this.move(5, [along(spot, way, 1.9)], 0.1, contact - 0.05, "out");
    switch (theCall.kind) {
      case "shooting": {
        // Up into the shot, hit on the arm: it comes off short, no basket.
        if (carrying) this.hold(0, contact, contact + 0.32);
        const close = distance(spot, RIM) < 7;
        this.jump(0, contact, contact + 0.3, contact + 0.6, close ? 2.0 : 1.4);
        this.act(0, close ? "layup" : "shoot", contact + 0.3, RIM);
        this.contest(5, contact + 0.3, at, 1.3);
        this.act(5, "reach", contact + 0.32, at);
        if (carrying) {
          const hand = this.release(at, close ? 2.0 : 1.4);
          const short = fieldPoint(along(RIM, way, -2.2), 7.5);
          this.fly(hand, short, contact + 0.32, 0.6, arc(2));
          this.dropToFloor(short, contact + 0.92, { x: -way.x * 3, y: -way.y * 3 }, 6, 1);
        }
        this.whistle(contact + 0.38, spot);
        this.freeze(contact + 0.7, new Set([0]));
        break;
      }
      case "looseBall": {
        // The ball gets away from him; both go for it.
        const loose = inbounds(along(spot, way, -3));
        if (carrying) {
          this.hop(fieldPoint(at, 1.4), fieldPoint(loose, 0.4), contact, 0.45, 2);
          script.legs.push({ from: contact + 0.45, until: Infinity, hand: AT_SPOT(fieldPoint(loose, 0.4)) });
        }
        this.move(0, [along(loose, way, 1)], contact, contact + 0.45, "out");
        this.move(5, [along(loose, way, -1)], contact, contact + 0.45, "out");
        this.act(0, "steal", contact + 0.4, loose);
        this.act(5, "reach", contact + 0.45, this.position(0, contact + 0.45));
        this.whistle(contact + 0.55, loose);
        this.freeze(contact + 0.7, new Set([0, 5]));
        break;
      }
      case "goaltending": {
        // A shot from the spot, swatted on its way down over the rim: the basket counts.
        if (carrying) this.hold(0, contact, contact + 0.3);
        this.act(0, "shoot", contact + 0.3, RIM);
        this.jump(0, contact, contact + 0.3, contact + 0.6, 1.4);
        const f = carrying ? this.shoot(this.release(at, 1.4), fieldPoint(along(RIM, way, -0.6), Hoops.rimHeight + 0.9), contact + 0.32, 0.95) : null;
        const up = f?.end ?? contact + 1.1;
        this.move(5, [along(RIM, way, -1.6)], contact + 0.2, up - 0.35);
        this.jump(5, up - 0.35, up, up + 0.4, 3.0);
        this.act(5, "block", up, RIM);
        if (f) {
          const away = fieldPoint(along(RIM, way, -9), 2);
          this.fly(script.flights[f.flight]!.to, away, up, 0.5, arc(0.8));
          this.dropToFloor(away, up + 0.5, { x: -way.x * 5, y: -way.y * 5 }, 8, 1);
        }
        script.flashes.push({ beat: "block", at: up, point: fieldPoint(along(RIM, way, -0.6), Hoops.rimHeight + 0.9) });
        this.whistle(up + 0.12, RIM);
        this.freeze(up + 0.4, new Set([5]));
        spot = RIM;
        break;
      }
      case "kickedBall": {
        // A pass that hits his foot.
        const mate = this.nearest([1, 2, 3, 4], along(spot, way, -6));
        if (carrying) this.hold(0, contact, contact + 0.15);
        this.act(0, "pass", contact + 0.15, this.position(mate, contact));
        const foot = along(this.position(5, contact + 0.3), way, -0.4);
        if (carrying) {
          this.fly(fieldPoint(at, 4.4), fieldPoint(foot, 0.8), contact + 0.15, 0.2, STRAIGHT);
          const off = along(foot, way, -4);
          this.hop(fieldPoint(foot, 0.8), fieldPoint(off, 0.4), contact + 0.35, 0.4, 1);
          script.legs.push({ from: contact + 0.75, until: Infinity, hand: AT_SPOT(fieldPoint(off, 0.4)) });
        }
        this.whistle(contact + 0.4, foot);
        this.freeze(contact + 0.5);
        break;
      }
      default: {
        // A reach on the dribble, a hold, a hard foul.
        if (carrying) this.hold(0, contact, Infinity);
        this.act(5, "reach", contact, at);
        const hard = theCall.kind === "flagrant";
        this.move(0, [along(at, way, hard ? 1.6 : 0.9)], contact, contact + 0.35, "out");
        if (hard) this.act(0, "fall", contact + 0.12, this.position(5, contact));
        this.whistle(contact + 0.15, spot);
        this.freeze(contact + 0.4, hard ? new Set([0]) : new Set());
      }
    }
    let whistled: number | null = null;
    for (let i = script.flashes.length - 1; i >= 0; i--) {
      if (script.flashes[i]!.beat === "whistle") {
        whistled = script.flashes[i]!.at;
        break;
      }
    }
    this.tagAt(words, scene.offense, whistled ?? contact);
    this.arrive = contact;
    this.over = Math.max(this.over, contact + 1.1);
  }

  // MARK: A jump ball

  /** The tip at center court: the two men ESPN names in the circle (the team that came up with it at the near side of it), the rest round it, the referee's toss, both up, and the tip to the man who gained it. */
  jumpBallBeat(): void {
    const scene = this.scene;
    if (!scene) return;
    const script = this.script;
    const c = { x: Hoops.length / 2, y: Hoops.width / 2 };
    const round = (a: number, r: number): Point => ({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
    const ours = [round(Math.PI, 1.5), round(0.35 * Math.PI, 8.5), round(-0.35 * Math.PI, 8.5), round(0.8 * Math.PI, 9), { x: 31, y: 25 }];
    const theirs = [round(0, 1.5), round(0.62 * Math.PI, 8.5), round(-0.62 * Math.PI, 8.5), round(-0.8 * Math.PI, 9), { x: 64, y: 25 }];
    script.players = [...ours.map((p) => new Player("offense", p)), ...theirs.map((p) => new Player("defense", p))];
    script.formation = "center";
    const ref = new Player("official", { x: c.x, y: c.y - 2.4 });
    ref.enters = -1;
    script.players.push(ref);
    const official = script.players.length - 1;
    // The toss: up from his hands to a little over their reach, the tip on the way down.
    const toss = 0.55;
    const top = toss + 0.62;
    const tip = top + 0.12;
    script.legs.push({ from: 0, until: toss, hand: { kind: "held", player: official } });
    this.fly(fieldPoint(c, 5), fieldPoint(c, 13.2), toss, top - toss, STRAIGHT);
    this.fly(fieldPoint(c, 13.2), fieldPoint(c, 12.4), top, tip - top, STRAIGHT);
    this.act(official, "toss", toss, c);
    this.walk(official, [{ x: c.x, y: c.y - 6 }], toss + 0.1, toss + 0.9);
    for (const j of [0, 5]) {
      this.jump(j, tip - 0.36, tip, tip + 0.4, 2.6);
      this.act(j, "tip", tip, c);
    }
    // To the man who gained it: the teammate ahead of the circle.
    const gainer = this.nearest([1, 2], { x: c.x + 9, y: c.y });
    const catchAt = along(this.position(gainer, tip), { x: -1, y: 0 }, 1);
    this.fly(fieldPoint(c, 12.4), fieldPoint(catchAt, 4.6), tip, 0.55, arc(1.2));
    this.move(gainer, [catchAt], tip, tip + 0.5, "out");
    this.act(gainer, "catchBall", tip + 0.55, c);
    this.credit(gainer, scene.winner);
    this.hold(gainer, tip + 0.55, Infinity);
    script.flashes.push({ beat: "catchBall", at: tip + 0.55, point: fieldPoint(catchAt, 4.6) });
    script.look = { point: c, from: 0 };
    const opening = scene.clock === "12:00" || scene.clock === "5:00";
    this.tagAt(joined([opening ? "TIP-OFF" : "JUMP BALL", called(scene.winner)]), scene.offense, 0);
    this.arrive = tip + 0.55;
    this.over = tip + 1.1;
  }

  // MARK: Substitutions

  /** A quick tag (SUB · HARPER IN), and the change on the floor: for each, the man of that team nearest his bench jogs off and fades as he goes, the man coming in jogs on from the bench to where he stood. */
  substitutionBeat(lineup: Lineup | null, group: readonly BasketballScene[]): void {
    const script = this.script;
    const placed = this.place(lineup, ["play", "lane", "center"]);
    if (!placed) {
      if (lineup && lineup.at.length === 10) {
        // At the benches (or off the floor): the floor stays as it was; the tag says it.
        this.place(lineup, ["benches", "offCourt"]);
        script.formation = lineup.formation;
        this.hideAll(lineup.formation === "offCourt");
      } else {
        this.setUp([{ x: 62, y: 25 }]);
      }
    } else {
      script.formation = this.start?.formation ?? "play";
    }
    const h = this.start?.holder ?? (placed ? null : 0);
    if (h != null) this.hold(h, 0, Infinity);
    else if (this.start?.ball) script.legs = [{ from: 0, until: Infinity, hand: AT_SPOT(fieldPoint(this.start.ball, 0.4)) }];
    const used = new Set<number>();
    if (placed) {
      group.slice(0, 3).forEach((sub, k) => {
        const team = sub.offense;
        if (team == null) return;
        const ours = team === this.sideOf("offense");
        const pool = ours ? [0, 1, 2, 3, 4] : [5, 6, 7, 8, 9];
        const bench = this.huddle(ours ? "offense" : "defense")[2]!;
        const candidates = pool.filter((i) => !used.has(i) && i !== this.start?.holder);
        if (candidates.length === 0) return;
        let off = candidates[0]!;
        for (const i of candidates.slice(1)) if (distance(this.position(i, 0), bench) < distance(this.position(off, 0), bench)) off = i;
        used.add(off);
        const at = this.position(off, 0);
        const lag = k * 0.18;
        const way = unit({ x: bench.x - at.x, y: bench.y - at.y });
        this.walk(off, [along(at, way, Math.min(9, distance(at, bench)))], 0.15 + lag, 1.15 + lag);
        script.players[off]!.leaves = 1.15 + lag;
        const on = new Player(script.players[off]!.team, along(at, way, Math.min(12, distance(at, bench))));
        on.enters = 0.45 + lag;
        on.move([at], 0.55 + lag, 1.55 + lag, "out");
        script.players.push(on);
        script.stand.set(off, script.players.length - 1);
        this.credit(off, sub.subOut);
        this.credit(script.players.length - 1, sub.subIn);
      });
    }
    const names = group.map((g) => called(g.subIn)).filter((n): n is string => n != null);
    const teams = new Set(group.map((g) => g.offense).filter((s): s is Side => s != null));
    const who = names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", ");
    this.tagAt(`${group.length > 1 ? "SUBS" : "SUB"}${who === "" ? "" : ` · ${who} IN`}`, teams.size === 1 ? [...teams][0]! : null, 0);
    this.over = used.size === 0 ? 1.0 : 1.7 + (Math.min(group.length, 3) - 1) * 0.18;
  }

  /** Nobody to see (the floor empty at the half). */
  hideAll(hidden: boolean): void {
    if (!hidden) return;
    for (const p of this.script.players) p.leaves = -1;
    this.script.legs = [];
  }

  // MARK: Stoppages

  /** A timeout or the end of a period: the whistle (the horn and the backboards' red at the end of a period), the tag, and everyone starting for the benches (or, at the half and at the end, off the floor); the court between plays walks them the rest of the way. */
  stoppageBeat(lineup: Lineup | null, formation: Formation): void {
    const scene = this.scene;
    if (!scene) return;
    const script = this.script;
    const placed = this.place(lineup, ["play", "lane", "center", "benches"]);
    if (!placed) this.setUp([{ x: 62, y: 25 }]);
    const h = this.start?.holder ?? 0;
    const ball = this.start?.holder == null ? (this.start?.ball ?? null) : null;
    if (ball) script.legs = [{ from: 0, until: Infinity, hand: AT_SPOT(fieldPoint(ball, 0.4)) }];
    else this.hold(h, 0, Infinity);
    const at = 0.3;
    if (scene.kind === "timeout") this.whistle(at, this.position(h, 0), "signal");
    else script.flashes.push({ beat: "horn", at, point: RIM_POINT });
    this.tagAt(stoppageWords(scene), scene.kind === "timeout" ? scene.offense : null, at);
    script.formation = formation;
    this.headOff(at + 0.35, formation);
    this.over = at + 1.6;
  }

  /** Everyone sets off for his bench (or the tunnel), walking. */
  headOff(t: number, formation: Formation): void {
    const ours = this.huddle("offense");
    const theirs = this.huddle("defense");
    for (let i = 0; i < Math.min(this.script.players.length, 10); i++) {
      if (this.script.players[i]!.team === "official") continue;
      const goal = formation === "offCourt" ? this.framed({ x: 47 + ((i % 5) - 2) * 1.5, y: -9 }) : i < 5 ? ours[i]! : theirs[i - 5]!;
      const here = this.position(i, t);
      const d = distance(here, goal);
      this.walk(i, [goal], t + (i % 5) * 0.06, t + Math.max(d / 9, 0.6), "inOut");
    }
  }

  /** A coach's challenge or a review: the referee to the table, the monitor, the ruling (overturned: waved off; the call stands: as it was). */
  reviewBeat(lineup: Lineup | null): void {
    const scene = this.scene;
    if (!scene) return;
    const script = this.script;
    const placed = this.place(lineup, ["play", "lane", "center", "benches"]);
    if (!placed) this.setUp([{ x: 62, y: 25 }]);
    script.formation = this.start?.formation ?? "play";
    const h = this.start?.holder;
    if (h != null) this.hold(h, 0, Infinity);
    const table = { x: Hoops.length / 2, y: this.offNear(2.2) };
    const ref = new Player("official", { x: table.x + 7, y: this.offNear(0.8) });
    ref.enters = -0.5;
    ref.move([table], 0.1, 1.0, "out");
    if (scene.overturned != null) ref.act(scene.overturned ? "point" : "signal", 1.5, { x: table.x, y: 25 });
    script.players.push(ref);
    script.look = { point: table, from: 0.4 };
    this.tagAt(reviewWords(scene, null), scene.offense, 0);
    this.over = 2.2;
  }

  // MARK: The beat's camera

  /** The ball and everyone near it, the rim while the ball's at it, the referee once he's in; picked up from where the camera was when the last beat handed over (when it looked the same way), and the stamp's corner kept clear while it's up. */
  beatCamera(): void {
    const script = this.script;
    const rimRoom = script.room(RIM_POINT, false);
    const corner = Number.isFinite(script.stamp) ? { width: script.corner.width + 0.03, height: script.corner.height + 0.04 } : { width: 0, height: 0 };
    const end = script.settle;
    const rooms = (t: number): Rect[] => {
      const items: Rect[] = [];
      const ball = script.ball(t);
      script.players.forEach((p, i) => {
        if (!(p.opacity(t) > 0.4)) return;
        const at = p.position(t);
        const close = ball ? distance(ground(ball), at) < 17 : true;
        if (!(close || p.team === "official" || i === script.shooter)) return;
        items.push(script.room(fieldPoint(at, p.lift(t)), true));
      });
      if (ball) {
        items.push(script.room(ball, false));
        if (distance(ground(ball), RIM) < 30) items.push(rimRoom);
      }
      return items.length === 0 ? [rimRoom] : items;
    };
    const first = this.start?.camera ?? null;
    const same = this.start?.yaw === script.yaw && this.start?.formation === script.formation;
    const goal = (t: number): CameraFrame => {
      const list = [...rooms(Math.min(t, end)), ...rooms(Math.min(t + 0.35, end))];
      const region = unionAll(list)!;
      let frame: CameraFrame;
      if (Number.isFinite(script.stamp) && t >= script.stamp - 0.3) {
        const others = script.players.map((p) => script.room(fieldPoint(p.position(t)), true));
        frame = clearing(region, list, others, CameraFrame.headroom, 31, corner, Hoops.tightest);
      } else {
        frame = fitting(region, CameraFrame.headroom, 31, Hoops.tightest);
      }
      if (same && first && t < 0.7) frame = CameraFrame.mix(first, frame, CameraRig.smooth(t / 0.7));
      return frame;
    };
    const samples = CameraRig.follow(script.duration, goal);
    script.camera = new CameraPath(samples.at(-1) ?? goal(end), samples, script.duration, script.duration);
  }

  // MARK: - The court between plays

  /** The court between plays (see the module's note): what the floor does first (up the floor, the ball in, to the lane, to the benches, off), then a beat every few seconds, still in between. */
  rest(rest: RestSpec): void {
    let opening = 0;
    switch (rest.phase) {
      case "tip":
        this.tipSet();
        break;
      case "offCourt":
        opening = this.offCourt(rest);
        break;
      case "benches":
        opening = this.benches(rest);
        break;
      case "lane":
        opening = this.laneRest(rest);
        break;
      case "loose":
        if (!this.place(rest.from, ["play"])) this.setUp([{ x: 62, y: 25 }]);
        if (this.start?.ball && this.start.holder == null) {
          this.script.legs = [{ from: 0, until: Infinity, hand: AT_SPOT(fieldPoint(this.start.ball, 0.4)) }];
        } else {
          this.hold(this.start?.holder ?? 0, 0, Infinity);
        }
        break;
      case "live":
      case "inboundBaseline":
      case "inboundSideline":
        opening = this.liveRest(rest);
        break;
    }
    this.sortLegs();
    this.script.duration = this.script.formation === "offCourt" || rest.phase === "loose" || rest.phase === "tip" ? Math.max(opening + 0.5, 1) : REST_LENGTH;
    this.script.settle = 0;
    this.restCamera(opening);
  }

  /** Before the tip: both teams round the center circle, the ball at center court. */
  tipSet(): void {
    const center = { x: Hoops.length / 2, y: Hoops.width / 2 };
    const ours = [
      { x: -1.6, y: 0 },
      { x: -7, y: 6 },
      { x: -7, y: -6 },
      { x: -14, y: 10 },
      { x: -14, y: -10 },
    ];
    this.script.players = [
      ...ours.map((p) => new Player("offense", { x: center.x + p.x, y: center.y + p.y })),
      ...ours.map((p) => new Player("defense", { x: center.x - p.x, y: center.y - p.y * 0.9 })),
    ];
    this.script.legs = [{ from: 0, until: Infinity, hand: AT_SPOT(fieldPoint(center, 0.4)) }];
    this.script.formation = "center";
  }

  // MARK: Play on

  /**
   * Play on: from where the last beat left everyone, up the floor (the ball
   * in first after a score or a whistle) and into a half-court set, the
   * defense back on its men; then the sparse beats. When the opening's done.
   */
  liveRest(rest: RestSpec): number {
    const script = this.script;
    script.formation = "play";
    const set = SETS[Number(this.random.next() % BigInt(SETS.length))]!;
    let spots = set.map((p) => {
      const x = p.x + this.random.in(-1, 1);
      const y = p.y + this.random.in(-1, 1);
      return { x, y };
    });
    let t = 0;
    let ball: number;
    if (this.place(rest.from, ["play", "center"])) {
      const h = this.start?.holder;
      ball = h != null && h < 5 ? h : -1;
      if (ball < 0) {
        // A loose ball, or the other team's hands: the nearest of ours picks it up.
        const lying = this.start?.ball ?? (this.start?.holder != null ? this.position(this.start.holder, 0) : { x: 47, y: 25 });
        ball = this.nearest([0, 1, 2, 3, 4], lying);
        const d = distance(this.position(ball, 0), lying);
        if (d > 1.5) {
          script.legs.push({ from: 0, until: d / 14 + 0.2, hand: AT_SPOT(fieldPoint(lying, 0.4)) });
          this.move(ball, [lying], 0, d / 14 + 0.2, "out");
          t = d / 14 + 0.2;
        }
      }
      if (rest.round === 0) {
        if (rest.phase === "inboundBaseline") {
          [ball, t] = this.inbound(ball, t, { x: -1.5, y: 25 + (this.position(ball, t).y >= 25 ? 3.5 : -3.5) });
        } else if (rest.phase === "inboundSideline") {
          const here = this.position(ball, t);
          const line = here.y < 25 ? -1.4 : Hoops.width + 1.4;
          [ball, t] = this.inbound(ball, t, { x: Math.min(Math.max(here.x, 30), 80), y: line });
        } else {
          // A big off the defensive glass: the outlet up the sideline, as he would.
          const deep = { x: Hoops.length - RIM.x, y: RIM.y };
          const here = this.position(ball, t);
          if (rest.outlet && distance(here, deep) < 22) {
            const wing = { x: Math.min(here.x + 18, 40), y: here.y < 25 ? 9 : 41 };
            const holder = ball;
            const mate = this.nearest([0, 1, 2, 3, 4].filter((k) => k !== holder), wing, t);
            const meet = inbounds({ x: Math.max(this.position(mate, t).x, wing.x - 4), y: wing.y });
            this.move(mate, [meet], t, t + 0.35 + this.passTime(ball, t + 0.35, meet, "outlet"), "out");
            this.hold(ball, t, t + 0.35);
            const caught = this.pass(ball, mate, t + 0.35, meet, "outlet");
            ball = mate;
            t = caught;
          }
        }
      }
    } else {
      this.setUp([spots[0]!]);
      ball = 0;
      spots = script.players.slice(0, 5).map((p) => p.at);
    }
    this.hold(ball, t, Infinity);
    // Into the set: each man to the nearest open spot (the holder to the top), the defense back on them.
    let open = spots.map((_, i) => i);
    const goal = new Map<number, Point>();
    goal.set(ball, spots[0]!);
    open = open.filter((j) => j !== 0);
    const others = [0, 1, 2, 3, 4].filter((k) => k !== ball).sort((a, b) => this.position(b, t).x - this.position(a, t).x);
    for (const k of others) {
      if (open.length === 0) break;
      let j = open[0]!;
      for (const o of open.slice(1)) if (distance(this.position(k, t), spots[o]!) < distance(this.position(k, t), spots[j]!)) j = o;
      goal.set(k, spots[j]!);
      open = open.filter((o) => o !== j);
    }
    let end = t;
    for (let k = 0; k < 5; k++) {
      const g = goal.get(k);
      if (!g) continue;
      const d = distance(this.position(k, t), g);
      if (!(d > 1.2)) continue;
      const speed = d > 30 ? (k === ball ? 15.0 : 16.0) : 9;
      if (k === ball) {
        this.letGo(ball, t);
        this.bounce(ball, t, t + d / speed + 0.35);
        this.hold(ball, t + d / speed + 0.35, Infinity);
      }
      this.move(k, [g], t + (k === ball ? 0 : 0.1), t + d / speed + 0.35, "inOut");
      end = Math.max(end, t + d / speed + 0.35);
    }
    this.shadow(0, end + 0.3);
    script.active = end > 0.05 ? [[0, end + 0.3]] : [];
    this.ambient(end, ball);
    return end;
  }

  /** The ball in from out of bounds at `out`: the nearest man takes it out, a teammate comes to it, the pass in. Who has it, and when it's in. */
  inbound(ball: number, t: number, out: Point): [number, number] {
    const taker = ball;
    const d = distance(this.position(taker, t), out);
    this.walk(taker, [out], t, t + Math.max(d / 10, 0.4), "inOut");
    let at = t + Math.max(d / 10, 0.4);
    this.hold(taker, t, at + 0.5);
    const inward = unit({ x: (out.x < 0 ? 12 : out.x + 4) - out.x, y: 25 - out.y });
    const meet = inbounds(along(out, inward, 9));
    const receiver = this.nearest([0, 1, 2, 3, 4].filter((k) => k !== taker), meet, at);
    this.move(receiver, [meet], Math.max(at - 0.6, t), at + 0.4, "out");
    at = this.pass(taker, receiver, at + 0.5, meet, "chest");
    this.walk(taker, [inbounds(along(out, inward, 4))], at, at + 0.6);
    return [receiver, at];
  }

  /** The ball leaves his hands at `t` (his open-ended hold ends there). */
  letGo(i: number, t: number): void {
    const legs = this.script.legs;
    for (let k = legs.length - 1; k >= 0; k--) {
      const h = legs[k]!.hand;
      if (h.kind === "held" && h.player === i && legs[k]!.until === Infinity) {
        legs[k]!.until = t;
        return;
      }
    }
  }

  /** A beat every few seconds, small and brief, still in between: a jab, a swing pass, a man relocating on the arc, a screen, a cut; the defense shading with each. */
  ambient(t0: number, holder: number): void {
    const script = this.script;
    let ball = holder;
    let at = t0 + this.random.in(2.5, 4);
    while (at < REST_LENGTH - 3) {
      const roll = this.random.in(0, 1);
      let length = 1.2;
      const h = this.position(ball, at);
      const others = [0, 1, 2, 3, 4].filter((k) => k !== ball);
      if (roll < 0.28) {
        // A jab and back: two dribbles one way, one back.
        const side = rotate(unit({ x: RIM.x - h.x, y: RIM.y - h.y }), (Math.PI / 2) * this.random.sign());
        this.letGo(ball, at);
        this.bounce(ball, at, at + 1.0);
        this.move(ball, [along(h, side, 3.5), along(h, side, 1.2)], at, at + 1.0);
        this.hold(ball, at + 1.0, Infinity);
        length = 1.0;
      } else if (roll < 0.55) {
        // A swing pass to the man on the arc nearest him.
        const arcMen = others.filter((k) => distance(this.position(k, at), RIM) > 18);
        let mate = others[0]!;
        if (arcMen.length > 0) {
          mate = arcMen[0]!;
          for (const k of arcMen.slice(1)) if (distance(this.position(k, at), h) < distance(this.position(mate, at), h)) mate = k;
        }
        const here = this.position(mate, at);
        const meet = along(here, unit({ x: h.x - here.x, y: h.y - here.y }), 1.5);
        this.letGo(ball, at + 0.25);
        this.move(mate, [meet], at, at + 0.25 + this.passTime(ball, at + 0.25, meet, "chest"), "out");
        const caught = this.pass(ball, mate, at + 0.25, meet, "chest");
        this.hold(mate, caught, Infinity);
        ball = mate;
        length = caught - at + 0.3;
      } else if (roll < 0.75) {
        // A man off the ball slides round the arc.
        const k = others[Number(this.random.next() % BigInt(others.length))]!;
        const p = this.position(k, at);
        const d = distance(p, RIM);
        const turn = this.random.in(0.22, 0.4);
        const a = Math.atan2(p.y - RIM.y, p.x - RIM.x) + turn * this.random.sign();
        let to = { x: RIM.x + d * Math.cos(a), y: RIM.y + d * Math.sin(a) };
        to = { x: Math.min(to.x, 89), y: Math.min(Math.max(to.y, 3), 47) };
        this.move(k, [to], at, at + 1.3);
        length = 1.3;
      } else if (roll < 0.9) {
        // The big up to screen for him, then rolling back down.
        let big = others[0]!;
        for (const k of others.slice(1)) if (distance(this.position(k, at), RIM) < distance(this.position(big, at), RIM)) big = k;
        const guardAt = this.guardSpot(h, h, true);
        const side = rotate(unit({ x: RIM.x - h.x, y: RIM.y - h.y }), Math.PI / 2);
        const screen = along(guardAt, side, 1.8);
        const back = this.position(big, at);
        this.move(big, [screen], at, at + 0.9);
        this.move(big, [along(back, unit({ x: RIM.x - back.x, y: RIM.y - back.y }), 2)], at + 1.5, at + 2.3);
        this.letGo(ball, at + 0.9);
        this.bounce(ball, at + 0.9, at + 1.7);
        this.move(ball, [along(h, side, -4)], at + 0.9, at + 1.7);
        this.hold(ball, at + 1.7, Infinity);
        length = 2.3;
      } else {
        // A cut to the rim and back out.
        let k = others[0]!;
        for (const o of others.slice(1)) if (distance(this.position(k, at), RIM) < distance(this.position(o, at), RIM)) k = o;
        const p = this.position(k, at);
        const sign = this.random.sign();
        this.move(k, [along(RIM, this.out(p), 6), along(RIM, rotate(this.out(p), sign * 0.9), distance(p, RIM))], at, at + 2.0);
        length = 2.0;
      }
      this.sortLegs();
      this.shadow(at, at + length + 0.2);
      script.active.push([at - 0.05, at + length + 0.3]);
      at += length + this.random.in(3.5, 6);
    }
  }

  // MARK: Free throws to come

  /** Free throws to come: everyone walks to the lane (the man fouled to the line), the referee under the basket bounces him the ball; then a shuffle now and then. */
  laneRest(rest: RestSpec): number {
    const script = this.script;
    script.formation = "lane";
    const line = { x: Hoops.freeThrow - 0.6, y: 25 };
    let t = 0;
    if (this.place(rest.from, ["lane"])) {
      this.laneOfficial();
      this.hold(this.start?.holder ?? 0, 0, Infinity);
    } else {
      const from = rest.from;
      this.laneUp();
      const lane = script.players.slice(0, 10).map((p) => p.at);
      const placed = this.place(from, ["play", "center"]);
      const ref = this.laneOfficial();
      if (placed) {
        // The man fouled (0, the beat's) to the line; the rest to the nearest open place.
        let open = [1, 2, 3, 4];
        let theirs = [5, 6, 7, 8, 9];
        const goal = new Map<number, Point>([[0, lane[0]!]]);
        const pick = (k: number, pool: number[]) => {
          let j = pool[0]!;
          for (const o of pool.slice(1)) if (distance(this.position(k, 0), lane[o]!) < distance(this.position(k, 0), lane[j]!)) j = o;
          return j;
        };
        for (let k = 1; k < 5; k++) {
          const j = pick(k, open);
          goal.set(k, lane[j]!);
          open = open.filter((o) => o !== j);
        }
        for (let k = 5; k < 10; k++) {
          const j = pick(k, theirs);
          goal.set(k, lane[j]!);
          theirs = theirs.filter((o) => o !== j);
        }
        for (const [k, g] of goal) {
          const d = distance(this.position(k, 0), g);
          this.move(k, [g], 0.2 + (k % 5) * 0.08, 0.2 + Math.max(d / 7, 0.6));
          t = Math.max(t, 0.2 + Math.max(d / 7, 0.6));
        }
      }
      // The ball from the referee to the man at the line.
      script.legs = [{ from: 0, until: t + 0.4, hand: { kind: "held", player: ref } }];
      const caught = this.pass(ref, 0, t + 0.4, line, "bounce");
      this.hold(0, caught, Infinity);
      t = caught + 0.2;
    }
    for (let k = 1; k < 10; k++) {
      if (this.random.in(0, 1) < 0.5) this.act(k, "hips", t + this.random.in(0, 1.5), line);
    }
    script.look = { point: line, from: t };
    script.active = t > 0 ? [[0, t + 0.3]] : [];
    // Now and then one shifts his feet.
    let at = t + this.random.in(3, 5);
    while (at < REST_LENGTH - 2) {
      const k = Math.trunc(this.random.in(1, 9.99));
      const p = this.position(k, at);
      const x = p.x + this.random.in(-0.8, 0.8);
      const y = p.y + this.random.in(-0.5, 0.5);
      this.move(k, [{ x, y }], at, at + 0.7);
      script.active.push([at - 0.05, at + 0.95]);
      at += this.random.in(4.5, 7);
    }
    return t;
  }

  // MARK: Stoppages

  /** A timeout, the end of a quarter: both teams walk to their benches (from wherever they stopped) and huddle; one shifts now and then. */
  benches(rest: RestSpec): number {
    const script = this.script;
    script.formation = "benches";
    const ours = this.huddle("offense");
    const theirs = this.huddle("defense");
    let t = 0;
    if (this.place(rest.from, ["play", "lane", "center", "benches"])) {
      for (let i = 0; i < 10; i++) {
        const goal = i < 5 ? ours[i]! : theirs[i - 5]!;
        const d = distance(this.position(i, 0), goal);
        if (!(d > 0.6)) continue;
        this.walk(i, [goal], (i % 5) * 0.06, Math.max(d / 9, 0.5));
        t = Math.max(t, Math.max(d / 9, 0.5));
      }
    } else {
      script.players = [...ours.map((p) => new Player("offense", p)), ...theirs.map((p) => new Player("defense", p))];
    }
    script.look = null;
    script.active = t > 0 ? [[0, t + 0.3]] : [];
    let at = t + this.random.in(4, 6);
    while (at < REST_LENGTH - 2) {
      const k = Math.trunc(this.random.in(0, 9.99));
      const p = this.position(k, at);
      const x = p.x + this.random.in(-0.6, 0.6);
      const y = p.y + this.random.in(-0.4, 0.4);
      this.walk(k, [{ x, y }], at, at + 0.8);
      script.active.push([at - 0.05, at + 1.05]);
      at += this.random.in(6, 9);
    }
    return t;
  }

  /** Halftime, the final: off the floor by the tunnel, fading as they go; then the court empty. */
  offCourt(rest: RestSpec): number {
    const script = this.script;
    script.formation = "offCourt";
    if (!this.place(rest.from, ["play", "lane", "center", "benches", "offCourt"])) {
      this.tipSet();
      script.formation = "offCourt";
      this.hideAll(true);
      return 0;
    }
    let t = 0;
    for (let i = 0; i < 10; i++) {
      const goal = this.framed({ x: 47 + ((i % 5) - 2) * 1.6 + (i < 5 ? -2 : 2), y: -9 });
      const d = distance(this.position(i, 0), goal);
      const end = Math.max(d / 8, 0.8) + (i % 5) * 0.1;
      this.walk(i, [goal], (i % 5) * 0.1, end);
      script.players[i]!.leaves = end;
      t = Math.max(t, end);
    }
    script.legs = [];
    script.active = [[0, t + 0.4]];
    return t;
  }

  // MARK: Its camera

  /** The court between plays through the camera: following the opening (up the floor, to the lane, to the benches), picked up from where the last beat's camera was when it looks the same way; then still on the floor as it set, with room for the small beats. */
  restCamera(opening: number): void {
    const script = this.script;
    const rimRoom = script.room(RIM_POINT, false);
    const formation = script.formation;
    const region = (t: number): Rect => {
      let items: Rect[] = [];
      for (const p of script.players) {
        if (!(p.opacity(t) > 0.3)) continue;
        items.push(script.room(fieldPoint(p.position(t)), true));
        items.push(script.room(fieldPoint(p.position(t + 0.4)), true));
      }
      const ball = script.ball(t);
      if (ball) items.push(script.room(ball, false));
      if ((formation === "play" || formation === "lane") && script.players.slice(0, 5).some((p) => distance(p.position(t), RIM) < 40)) items.push(rimRoom);
      if (items.length === 0) {
        // The empty court: center court and both lanes.
        const c = { x: Hoops.length / 2, y: Hoops.width / 2 };
        items = [script.room(fieldPoint(c), false), script.room(fieldPoint({ x: c.x - 22, y: c.y }), false), script.room(fieldPoint({ x: c.x + 22, y: c.y }), false)];
      }
      return unionAll(items)!;
    };
    const closest = formation === "benches" ? 30.0 : 36;
    const frame = (t: number): CameraFrame => {
      const r = region(t);
      const grown = t >= opening ? { x: r.x - 3, y: r.y - 1.5, width: r.width + 6, height: r.height + 3 } : r;
      return fitting(grown, CameraFrame.headroom, closest, Hoops.tightest);
    };
    const settled = frame(opening + 0.6);
    const first = this.start?.camera ?? null;
    const same = this.start?.yaw === script.yaw && first != null;
    if (!(opening > 0.05 || same)) {
      script.camera = new CameraPath(settled);
      return;
    }
    const goal = (t: number): CameraFrame => {
      let g = t >= opening ? settled : frame(t);
      if (same && first && t < 0.7) g = CameraFrame.mix(first, g, CameraRig.smooth(t / 0.7));
      return g;
    };
    const until = opening + 1.2;
    const samples = CameraRig.follow(until, goal);
    script.camera = new CameraPath(settled, samples, until, until + 0.6);
    if (script.active.length > 0) script.active[0] = [0, Math.max(script.active[0]![1], until + 0.6)];
    else script.active = [[0, until + 0.6]];
  }
}

/** The half-court sets the offense sits in between plays: five out, the big at the elbow (horns), four out and one in. The holder at the top. */
const SETS: readonly (readonly Point[])[] = [
  [
    { x: 63, y: 25 },
    { x: 70, y: 7.5 },
    { x: 70, y: 42.5 },
    { x: 88.5, y: 3.6 },
    { x: 88.5, y: 46.4 },
  ],
  [
    { x: 64, y: 25 },
    { x: 76.5, y: 17.5 },
    { x: 76.5, y: 32.5 },
    { x: 88.5, y: 3.6 },
    { x: 88.5, y: 46.4 },
  ],
  [
    { x: 63, y: 21 },
    { x: 70, y: 43 },
    { x: 84, y: 5 },
    { x: 68, y: 7 },
    { x: 84.5, y: 32 },
  ],
];

/** The nearest line's point out of bounds (the first of the nearest, as Swift's `min`). */
function nearestLine(lines: readonly [number, Point][]): Point {
  let best = lines[0]!;
  for (const l of lines.slice(1)) if (l[0] < best[0]) best = l;
  return best[1];
}

const CALL_NAMES: Readonly<Record<string, string>> = {
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

const callName = (kind: string) => CALL_NAMES[kind] ?? kind.toUpperCase();
