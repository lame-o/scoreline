/**
 * What the football theater shows between snaps (FootballIdle.swift), so a
 * live game never looks frozen: the time between plays as it really goes.
 * The offense huddles a few yards behind the ball while the defense gathers
 * across from it, then breaks, jogs to the real line of scrimmage and lines
 * up in the set it uses (the last snap's, else what the down and distance
 * call for), and every few seconds something happens before the snap: a man
 * in motion, a safety creeping down, the quarterback's audible. The game's
 * own stoppages, as ESPN posts them, have their own: a timeout sends the
 * team that called it to its bench; a TV timeout (ESPN's "Official
 * Timeout") or the two-minute warning empties the field to both sidelines;
 * the end of a quarter turns the field round as the teams change ends; at
 * halftime they leave; a man hurt on the play stays down while the trainers
 * come out; a challenge's red flag comes in from the bench while the teams
 * wait. Then they come back, huddle and line up again. No officials: nothing
 * in the data has them doing anything on the field, and standing there they
 * only got in the way.
 *
 * Each is a script like a snap's (footballScript.ts), a pure function of
 * what the feed said and t, so the harness can draw any moment of it. They
 * move in sparse beats (a second or two of motion, then still for several):
 * the stage animates only through a beat and draws a still frame between
 * them, and past the opening the pre-snap beats loop. Where the data is
 * silent (who goes in motion, where a man stands on the sideline), the
 * choices are seeded from the entry's ID with the Mac's own generator
 * (SplitMix64, bit for bit): never canned, the same every time, and the same
 * as on the Mac.
 *
 *     const idle = footballIdleMake({ play, stoppage, rest, offense, down, kickoff: false, flipped: false });
 *     const script = idleScript(idle); script.idleTime(elapsed);
 */
import { ordinal } from "../format";
import { at, int, num, str, type JSONValue } from "../json";
import type { FootballTeams } from "../liveFeeds/football";
import { CameraFrame, type Rect } from "../mlb/playCamera";
import { fieldPoint, type FieldPoint, type Point } from "../mlb/theaterField";
import type { Side } from "../models";
import { FootballScene, isHome, kindIs, opponent, sideNamed, type Down, type Formation, type Front, type Injury, type Lane, type Review } from "./footballScene";
import { announced, Builder, FootballScript, Gridiron, Player, type Team } from "./footballScript";
import { Rig } from "./rig";
import { seed64, SplitMix64 } from "./splitMix64";
import { CameraPath, CameraRig, fitting, unionAll } from "./theaterKit";

// MARK: - Stoppages

export type StoppageKind = "timeout" | "official" | "twoMinuteWarning" | "endOfPeriod" | "halftime" | "endOfGame";

/**
 * A stop in play as ESPN's play-by-play posts it (entries that aren't
 * snaps): a team's timeout ("Timeout #1 by PHI at 13:55.", college's
 * "Timeout Alabama, clock 11:24"), a TV timeout ("Official Timeout at
 * 12:30."), the two-minute warning, the end of a quarter or the half, the end
 * of the game.
 */
export interface FootballStoppage {
  readonly id: string;
  readonly kind: StoppageKind;
  /** The team that called a timeout (its letters or name in the text; the entry's own team is the one with the ball). */
  readonly side: Side | null;
  /** "Timeout #2": the team's second of the half. */
  readonly number: number | null;
  readonly period: number | null;
  /** "13:55". */
  readonly clock: string | null;
  readonly sequence: number;
  /** Epoch ms. */
  readonly wallclock: number | null;
  readonly text: string;
}

/** A stoppage entry; null for a snap, a kick, the coin toss. (FootballStoppage.parse; pure; tested) */
export function parseStoppage(item: JSONValue, teams: FootballTeams): FootballStoppage | null {
  const id = str(at(item, "id"));
  if (id == null) return null;
  const text = str(at(item, "text")) ?? "";
  const period = int(at(item, "period", "number")) ?? null;
  let kind: StoppageKind;
  switch ((str(at(item, "type", "text")) ?? "").toLowerCase()) {
    case "timeout":
      kind = "timeout";
      break;
    case "official timeout":
      kind = "official";
      break;
    case "two-minute warning":
      kind = "twoMinuteWarning";
      break;
    case "end period":
    case "end of regulation":
      kind = "endOfPeriod";
      break;
    case "end of half":
      kind = "halftime";
      break;
    case "end of game":
      kind = "endOfGame";
      break;
    default:
      return null;
  }
  // College ends its second quarter as an "End Period".
  if (kind === "endOfPeriod" && period === 2) kind = "halftime";
  const sequenceText = str(at(item, "sequenceNumber"));
  const sequence = sequenceText != null && Number.isFinite(Number(sequenceText)) ? Number(sequenceText) : (num(at(item, "sequenceNumber")) ?? 0);
  const wallclock = str(at(item, "wallclock"));
  const parsed = wallclock ? Date.parse(wallclock) : NaN;
  let side: Side | null = null;
  let number: number | null = null;
  if (kind === "timeout") {
    const nfl = /Timeout #(\d+) by ([A-Z]{2,4})/.exec(text);
    const college = nfl ? null : /^Timeout ([^,]+?),/.exec(text);
    if (nfl) {
      number = Number(nfl[1]);
      const home = isHome(teams, nfl[2]!);
      side = home == null ? null : home === teams.topIsHome ? "top" : "bottom";
    } else if (college) {
      side = sideNamed(teams, college[1]!);
    }
  }
  return { id, kind, side, number, period, clock: str(at(item, "clock", "displayValue")) ?? null, sequence, wallclock: Number.isFinite(parsed) ? parsed : null, text };
}

// MARK: - Which way the field faces

/**
 * Which end each team attacks on the viewer's screen, as a TV broadcast
 * shows it from the press box (FieldFacing). ESPN doesn't say which physical
 * end zone is whose; the default has the top team attacking the right end
 * zone (as the drive chart under the theater draws it) in the first and
 * third quarters and overtime, the left one in the second and fourth, the
 * teams changing ends every quarter. The viewer's flip turns it round for
 * the game, and the quarters still turn it after that. The theater stands
 * behind the offense either way: attacking the screen's right it looks up the
 * field to the right, attacking its left, up the field to the left. (pure; tested)
 */
export const FieldFacing = {
  topAttacksRight(period: number | null, flipped: boolean): boolean {
    return ((period ?? 1) % 2 === 1) !== flipped;
  },

  attacksRight(offense: Side | null, period: number | null, flipped: boolean): boolean {
    return ((offense ?? "top") === "top") === FieldFacing.topAttacksRight(period, flipped);
  },

  /** The camera's yaw for an offense: the field turned a third of the way round toward the end it attacks. */
  yaw(offense: Side | null, period: number | null, flipped: boolean): number {
    return FieldFacing.attacksRight(offense, period, flipped) ? Gridiron.yaw : -Gridiron.yaw;
  },

  /** The sideline nearest the camera, in the offense's frame (its right is +x): its right when it attacks the screen's right. */
  near(yaw: number): number {
    return yaw >= 0 ? 1 : -1;
  },
};

// MARK: - Idle

/** What the field does now, between snaps (FootballIdle.Phase). */
export type IdlePhase =
  /** Huddle, break, line up, and the looks before the snap. */
  | { readonly kind: "between" }
  /** After a score: the kickoff team lined up across the field at its spot. */
  | { readonly kind: "kickoff" }
  /** A team's timeout (null: ESPN didn't say whose). */
  | { readonly kind: "timeout"; readonly side: Side | null }
  /** A TV timeout or the two-minute warning: both teams to their sidelines. */
  | { readonly kind: "commercial" }
  /** The end of a quarter: the teams change ends, the field turning to this yaw. */
  | { readonly kind: "quarter"; readonly turnTo: number }
  /** The half, or the game, over: off the field. */
  | { readonly kind: "off" }
  | { readonly kind: "injury"; readonly hurt: Injury }
  | { readonly kind: "review"; readonly review: Review };

export interface FootballIdle {
  readonly phase: IdlePhase;
  /** The team with the ball (on a kickoff, the team kicking). */
  readonly offense: Side;
  /** The spot, in the offense's yards, and the line to gain. */
  readonly yard: number;
  readonly gain: number | null;
  readonly hash: Lane;
  readonly formation: Formation;
  readonly shotgun: boolean;
  /** The play's strong side: where the tight end lines up. */
  readonly strong: Lane;
  readonly front: Front | null;
  readonly yaw: number;
  /** The offense's bench, by its sideline's sign in its frame: the home team's across the field from the camera, the visitors' on its side. */
  readonly bench: number;
  readonly seed: bigint;
}

export interface IdleInputs {
  readonly play: FootballScene | null;
  readonly stoppage: FootballStoppage | null;
  readonly rest: { readonly yard: number; readonly gain: number | null };
  readonly offense: Side;
  readonly down: Down | null;
  readonly kickoff: boolean;
  readonly flipped: boolean;
}

/**
 * What the field does after the last snap and whatever ESPN posted since
 * (FootballIdle.make): the stoppage if there is one (a timeout, a TV
 * timeout, the quarter's end), else the snap's own aftermath (a challenge,
 * a man down), else the next snap's huddle, or the kickoff after a score.
 * The set comes from the offense's own last snap where it has one; else the
 * down and distance (the gun on a long third down, heavy at the goal line).
 * (pure; tested)
 */
export function footballIdle({ play, stoppage, rest, offense: given, down, kickoff, flipped }: IdleInputs): FootballIdle {
  const period = stoppage?.period ?? play?.period ?? null;
  const seedID = stoppage?.id ?? (play ? `${play.id}-after` : `rest-${Math.trunc(rest.yard)}`);
  const random = new SplitMix64(seed64(seedID));
  let offense = given;
  let yard = rest.yard;
  const scorer = play?.scorer ?? null;
  if (kickoff && play && scorer) {
    // After a score the team that scored kicks off from its 35 (after a safety, the team scored on).
    offense = play.scoring === "safety" ? opponent(scorer) : scorer;
    yard = 35;
  }
  const yaw = FieldFacing.yaw(offense, period, flipped);
  // American football lists the visitors first: the bottom team is at home, its bench across the field.
  const far = -FieldFacing.near(yaw);
  let formation: Formation;
  let shotgun: boolean;
  // The set: the offense's own last one, else the situation's.
  const goalLine = rest.yard >= 97;
  const k = play?.kind.type;
  if (play && play.offense === offense && play.pointAfter == null && k !== "punt" && k !== "kickoff" && k !== "kneel" && !kindIs(play.kind, "fieldGoal")) {
    formation = play.formation === "victory" ? "base" : play.formation;
    shotgun = play.shotgun;
  } else if (down && (down.distance <= 2 || goalLine)) {
    formation = "heavy";
    shotgun = false;
  } else if (down && down.down >= 3 && down.distance >= 6) {
    formation = random.in(0, 1) < 0.3 ? "empty" : "base";
    shotgun = true;
  } else {
    formation = random.in(0, 1) < 0.2 ? "bunch" : "base";
    shotgun = random.in(0, 1) < 0.65;
  }
  if (goalLine && formation !== "heavy") shotgun = false;
  const strong: Lane = random.in(0, 1) < 0.5 ? "left" : "right";
  let front: Front | null = null;
  if (play && play.offense === offense) front = play.front;
  else if (play && play.defense === offense && play.front) front = play.front;

  let phase: IdlePhase = { kind: kickoff ? "kickoff" : "between" };
  if (stoppage) {
    switch (stoppage.kind) {
      case "timeout":
        phase = { kind: "timeout", side: stoppage.side };
        break;
      case "official":
      case "twoMinuteWarning":
        phase = { kind: "commercial" };
        break;
      case "endOfPeriod":
        phase = { kind: "quarter", turnTo: FieldFacing.yaw(offense, (stoppage.period ?? 1) + 1, flipped) };
        break;
      case "halftime":
      case "endOfGame":
        phase = { kind: "off" };
        break;
    }
  } else if (play?.review) {
    phase = { kind: "review", review: play.review };
  } else if (play && play.injuries[0]) {
    phase = { kind: "injury", hurt: play.injuries[0] };
  }
  return {
    phase,
    offense,
    yard,
    gain: kickoff ? null : rest.gain,
    hash: play?.nextHash ?? "middle",
    formation,
    shotgun,
    strong,
    front,
    yaw,
    bench: offense === "bottom" ? far : -far,
    seed: seed64(seedID),
  };
}

/** Whether two idles are the same (FootballIdle's `==`), for the script's cache. */
export function sameIdle(a: FootballIdle | null, b: FootballIdle | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify({ ...a, seed: String(a.seed) }) === JSON.stringify({ ...b, seed: String(b.seed) });
}

/** The snap the formation is laid out from: in the gun or under center, the set, its strength, its hash. */
export function idleLineup(idle: FootballIdle): FootballScene {
  const scene = new FootballScene("idle", { type: idle.formation === "heavy" && !idle.shotgun ? "rush" : "pass" }, idle.offense, idle.yard, idle.yard);
  scene.formation = idle.formation;
  scene.shotgun = idle.shotgun;
  scene.hash = idle.hash;
  scene.lane = idle.strong;
  scene.front = idle.front;
  return scene;
}

/** Between snaps, or through a stoppage: the field alive (`FootballScript(idle:)`). */
export function idleScript(idle: FootballIdle): FootballScript {
  const b = new Builder(idleLineup(idle), Gridiron.y(idle.yard), idle.shotgun);
  b.script.yaw = idle.yaw;
  if (idle.phase.kind === "kickoff") b.kickoffFormation({ x: 6, y: Gridiron.y(idle.yard + 62) });
  else b.scrimmage();
  new IdleBuilder(b, idle).build();
  b.script.measureBodies();
  return b.script;
}

/** What the idle's camera keeps in frame for a while: these men and spots. */
interface IdleFocus {
  readonly from: number;
  readonly until: number;
  readonly players: readonly number[];
  readonly points: readonly FieldPoint[];
  /** No closer than this (feet top to bottom). */
  readonly closest: number;
}

const hypot = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const pick = <T>(items: readonly T[], random: SplitMix64): T => items[Math.trunc(random.in(0, 0.999) * items.length)]!;

/** The idle's beats (the Swift Builder's `idle` and its helpers), on a formation already laid out. */
class IdleBuilder {
  private readonly random: SplitMix64;

  constructor(
    private readonly b: Builder,
    private readonly idle: FootballIdle,
  ) {
    this.random = new SplitMix64(idle.seed);
  }

  private get script(): FootballScript {
    return this.b.script;
  }

  build(): void {
    const { b, idle, random, script } = this;
    const kickoff = idle.phase.kind === "kickoff";
    const line = b.line;
    script.legs = [{ from: 0, until: 0, hand: { kind: "spot", point: kickoff ? { x: b.ballX, y: line, z: 0.9 } : b.spot } }];
    script.lines = { scrimmage: kickoff ? null : line, gain: kickoff || idle.gain == null ? null : Gridiron.y(idle.gain) };
    script.next = script.lines;
    // Everyone set as the last snap left them; out of their stances as they turn away.
    for (const p of script.players) if (p.set != null) p.set = 0.35;

    let t = 0;
    let back = true;
    const focus: IdleFocus[] = [];
    const phase = idle.phase;
    switch (phase.kind) {
      case "between":
        break;
      case "kickoff":
        // The kicker sets the ball on the tee and walks back to his run-up before the loop.
        back = false;
        t = 4.6;
        break;
      case "timeout":
        t = this.sidelines(phase.side == null ? [] : [phase.side === idle.offense ? "offense" : "defense"], 34);
        break;
      case "commercial":
        t = this.sidelines(["offense", "defense"], 44);
        break;
      case "quarter":
        // They gather while the field turns: the teams have changed ends.
        this.huddles(0.4);
        script.turn = { from: idle.yaw, to: phase.turnTo, start: 1.0, end: 4.2 };
        t = 7;
        back = false;
        this.lineUp(t);
        t += 3.2;
        break;
      case "off":
        this.leave();
        script.ballGone = 4.6;
        script.duration = 6;
        script.settle = 6;
        this.finish([]);
        return;
      case "injury":
        t = this.injury(phase.hurt, focus);
        break;
      case "review":
        t = this.review(phase.review, focus);
        break;
    }
    if (back) {
      // Back to the huddle, a breath, the break, and the line-up.
      this.huddles(t + 0.4);
      t += 7;
      this.lineUp(t);
      t += 3.2;
    }
    // The looks before the snap, round and round.
    const start = t + 1.5;
    const period = kickoff ? this.kickoffLooks(start) : this.preSnap(start);
    script.loop = { start, period };
    script.duration = start + period;
    script.settle = script.duration;
    this.finish(focus);
  }

  /** The players of a team in the formation (not the staff). */
  private team(team: Team): number[] {
    return this.script.players.flatMap((p, i) => (p.team === team ? [i] : []));
  }

  /** Where a man stands in the formation: his place at the line. */
  private home(i: number): Point {
    return this.script.players[i]!.at;
  }

  private look(i: number, from: number, point: Point): void {
    this.script.players[i]!.looks.push({ from, point });
  }

  /** Both teams into their huddles: the offense in a ring a few yards behind the ball, its quarterback facing them; the defense gathered across the line, looking in at its caller. */
  private huddles(start: number): void {
    const { b, random } = this;
    const gun = { x: b.ballX + random.in(-4, 4), y: b.line - random.in(21, 27) };
    const offense = this.team("offense");
    const defense = this.team("defense");
    this.ring(offense, gun, 7.5, b.at("quarterback"), start);
    const gather = { x: b.ballX + random.in(-8, 8), y: b.line + random.in(18, 26) };
    this.ring(defense, gather, 8.5, null, start);
  }

  /** Men into a ring round a point, each facing in; `first` at the near side (toward the line), facing the rest. */
  private ring(men: readonly number[], c: Point, radius: number, first: number | null, start: number): void {
    const { b, random } = this;
    const ordered = [...(first != null ? [first] : []), ...men.filter((i) => i !== first).sort((p, q) => this.home(p).x - this.home(q).x)];
    ordered.forEach((i, k) => {
      const a = Math.PI / 2 + (k / Math.max(ordered.length, 1)) * 2 * Math.PI;
      const r = radius * (k === 0 && first != null ? 0.7 : 1) + random.in(-0.8, 0.8);
      const p = { x: c.x + Math.cos(a) * r * 1.25, y: c.y + Math.sin(a) * r };
      const d = hypot(p, b.position(i, start));
      const leave = start + random.in(0, 0.35);
      b.move(i, [p], leave, leave + clamp(d / 11, 0.8, 3.2), "inOut");
      this.look(i, leave + 0.2, c);
    });
  }

  /** The break: from wherever they are to their places at the line (the linemen first, the men out wide last), and into their stances. */
  private lineUp(start: number): void {
    const { b, random, script } = this;
    for (const i of [...this.team("offense"), ...this.team("defense")]) {
      const p = this.home(i);
      const d = hypot(p, b.position(i, start));
      const wide = Math.abs(p.x - b.ballX) > 30;
      const leave = start + (wide ? random.in(0.2, 0.5) : random.in(0, 0.25));
      const arrive = leave + clamp(d / 13, 0.9, 3.4);
      b.move(i, [p], leave, arrive, "inOut");
      const way = script.players[i]!.team === "offense" ? 1 : -1;
      this.look(i, arrive - 0.3, { x: p.x, y: p.y + 60 * way });
      if (script.players[i]!.set != null) script.players[i]!.resets = arrive + 0.35;
    }
  }

  /**
   * The looks before the snap, a loop that comes back to where it began: a
   * man in motion across the formation and his man going with him, a safety
   * walking down into the box, the quarterback's hand up for the audible as
   * the motion comes back, the safety back out. Returns its period.
   */
  private preSnap(start: number): number {
    const { b, random, script } = this;
    const period = 24;
    const motionAt = start + random.in(2.4, 3.6);
    const audibleAt = start + random.in(13.5, 14.5);
    const motion = [...b.players("offense", "receiver"), ...b.players("offense", "tightEnd")].filter((i) => script.players[i]!.set == null && Math.abs(this.home(i).x - b.ballX) > 12);
    if (motion.length > 0) {
      const man = pick(motion, random);
      const p = this.home(man);
      const side = p.x > b.ballX ? 1 : -1;
      const across = { x: b.ballX - side * (Math.abs(p.x - b.ballX) * 0.35 + 7), y: p.y - 1.5 };
      b.move(man, [across], motionAt, motionAt + 1.7, "inOut");
      b.move(man, [p], audibleAt + 1.2, audibleAt + 2.9, "inOut");
      // His man goes with him.
      const cover = b.nearest("defense", p, 0, ["corner", "backer", "safety"]);
      if (cover != null) {
        const q = this.home(cover);
        const shift = { x: q.x + (across.x - p.x) * 0.55, y: q.y };
        b.move(cover, [shift], motionAt + 0.15, motionAt + 1.8, "inOut");
        b.move(cover, [q], audibleAt + 1.3, audibleAt + 3.0, "inOut");
      }
    }
    // A safety creeps down, then back.
    const safeties = b.players("defense", "safety");
    if (safeties.length > 0) {
      const s = pick(safeties, random);
      const q = this.home(s);
      const downAt = start + random.in(8.5, 9.5);
      const upAt = start + random.in(19.5, 20.5);
      const box = { x: b.ballX + (q.x - b.ballX) * 0.55, y: b.line + random.in(18, 26) };
      b.move(s, [box], downAt, downAt + 1.5, "inOut");
      b.move(s, [q], upAt, upAt + 1.6, "inOut");
    }
    const qb = b.at("quarterback");
    if (qb != null) script.players[qb]!.holds.push({ kind: "fairCatch", from: audibleAt, until: audibleAt + 0.9 });
    return period;
  }

  /** After a score: the kicker sets the ball on the tee, walks back to his run-up, and his hand goes up when he's ready; the coverage shuffles. */
  private kickoffLooks(start: number): number {
    const { b, random, script } = this;
    const period = 18;
    const kicker = b.at("kicker");
    if (kicker == null) return period;
    const p = this.home(kicker);
    b.move(kicker, [{ x: b.ballX + 1, y: b.line - 1.5 }], 0.6, 1.8, "inOut");
    b.move(kicker, [p], 2.6, 4.2, "inOut");
    const ready = start + random.in(5.5, 6.5);
    script.players[kicker]!.holds.push({ kind: "fairCatch", from: ready, until: ready + 1 });
    const cover: number[] = [];
    for (let k = 0; k < 10; k++) {
      const i = b.at(`cover${k}`);
      if (i != null) cover.push(i);
    }
    for (let k = 0; k < Math.min(2, cover.length); k++) {
      const i = pick(cover, random);
      const q = this.home(i);
      const at = start + random.in(10, 12) + k * 0.4;
      const dx = random.in(-4, 4);
      b.move(i, [{ x: q.x + dx, y: q.y - random.in(1, 3) }], at, at + 0.8, "inOut");
      b.move(i, [q], at + 3.5, at + 4.3, "inOut");
    }
    return period;
  }

  /** A team to its bench (or both): it jogs off to its sideline and stands in a loose knot there; a team that stays gathers on the field. A man or two moves every several seconds. Returns when they come back. */
  private sidelines(teams: readonly Team[], hold: number): number {
    const { b, idle, random } = this;
    for (const side of ["offense", "defense"] as const) {
      const men = this.team(side);
      if (teams.includes(side)) {
        const bench = (side === "offense" ? idle.bench : -idle.bench) * (Gridiron.half + random.in(2, 8));
        const c = { x: bench, y: b.line + random.in(-20, 20) };
        for (const i of men) {
          const px = c.x - (bench > 0 ? 1 : -1) * random.in(0, 22);
          const p = { x: px, y: c.y + random.in(-24, 24) };
          const d = hypot(p, b.position(i, 0.4));
          const leave = 0.4 + random.in(0, 0.6);
          b.move(i, [p], leave, leave + clamp(d / 14, 1, 6), "inOut");
          this.look(i, leave + 6, { x: 0, y: c.y });
        }
      } else {
        const cx = b.ballX + random.in(-6, 6);
        const c = { x: cx, y: b.line + (side === "offense" ? -1 : 1) * random.in(16, 24) };
        this.ring(men, c, 9, side === "offense" ? b.at("quarterback") : null, 0.4);
      }
    }
    this.shuffles([...this.team("offense"), ...this.team("defense")], 9, hold);
    return hold;
  }

  /** Every several seconds a man or two takes a few steps. */
  private shuffles(men: readonly number[], start: number, end: number): void {
    const { b, random } = this;
    if (men.length === 0) return;
    let t = start + random.in(0, 2);
    while (t < end - 2) {
      for (let n = 0; n < 2; n++) {
        const i = pick(men, random);
        const here = b.position(i, t);
        const x = here.x + random.in(-9, 9);
        const y = here.y + random.in(-7, 7);
        b.move(i, [{ x, y }], t, t + random.in(0.8, 1.3), "inOut");
      }
      t += random.in(6.5, 9.5);
    }
  }

  /** The half (or the game) over: both teams jog off to their benches and out of sight; the field stands empty. */
  private leave(): void {
    const { b, idle, random, script } = this;
    script.players.forEach((player, i) => {
      const side = player.team === "offense" ? idle.bench : player.team === "defense" ? -idle.bench : random.sign();
      const here = b.position(i, 0.4);
      const x = side * (Gridiron.half + random.in(10, 20));
      const p = { x, y: here.y + random.in(-30, 30) };
      const leave = 0.4 + random.in(0, 0.8);
      const arrive = leave + clamp(hypot(p, here) / 15, 2, 4);
      b.move(i, [p], leave, arrive, "inOut");
      player.vanish = arrive - 0.6;
    });
  }

  /** A man hurt on the play: down where he was, his teammates on a knee round him, the other team giving them room, two trainers jogging out from his bench to him; then he's helped up and off with them, and the teams come back. Returns when they're back. */
  private injury(hurt: Injury, focus: IdleFocus[]): number {
    const { b, idle, random, script } = this;
    const side: Team = hurt.side === idle.offense ? "offense" : "defense";
    // Who's hurt: a man of his team off the line (ESPN names him, but not where he stood).
    const candidates = this.team(side).filter((i) => script.players[i]!.role !== "line" && script.players[i]!.role !== "front");
    const pool = candidates.length > 0 ? candidates : this.team(side);
    if (pool.length === 0) return 6;
    const man = pick(pool, random);
    const down = this.home(man);
    script.players[man]!.holds.push({ kind: "down", from: 0.5, until: 26 });
    const near: number[] = [man];
    for (const i of [...this.team("offense"), ...this.team("defense")]) {
      if (i === man) continue;
      const here = this.home(i);
      const d = hypot(here, down);
      if (script.players[i]!.team === side && d < 45) {
        // His teammates on a knee round him, giving him room.
        const a = Math.atan2(here.y - down.y, here.x - down.x);
        const r = d < 20 ? random.in(13, 17) : random.in(22, 30);
        const p = { x: down.x + Math.cos(a) * r, y: down.y + Math.sin(a) * r };
        if (d < 20) near.push(i);
        const from = 0.6 + random.in(0, 0.6);
        b.move(i, [p], from, 2.4 + random.in(0, 0.8), "inOut");
        script.players[i]!.holds.push({ kind: "kneel", from: 3.4 + random.in(0, 1.2), until: 26 });
        this.look(i, 2.5, down);
      } else {
        // Back a few yards, out of the way.
        const dd = Math.max(d, 1);
        const push = Math.max(36 - dd, 6);
        const away = { x: here.x + ((here.x - down.x) / dd) * push, y: here.y + ((here.y - down.y) / dd) * push };
        const from = 0.8 + random.in(0, 0.8);
        b.move(i, [away], from, 2.8 + random.in(0, 1), "inOut");
        if (random.in(0, 1) < 0.5) script.players[i]!.holds.push({ kind: "kneel", from: 4 + random.in(0, 2), until: 26 });
      }
    }
    const bench = (side === "offense" ? idle.bench : -idle.bench) * (Gridiron.half + 6);
    for (let k = 0; k < 2; k++) {
      const from = { x: bench, y: down.y + k * 8 - 4 };
      script.players.push(new Player("staff", from, "staff"));
      const trainer = script.players.length - 1;
      near.push(trainer);
      const by = { x: down.x + (k === 0 ? -4.5 : 4.5), y: down.y + (k === 0 ? 2.5 : -2.5) };
      b.move(trainer, [by], 1.6 + k * 0.3, 1.6 + k * 0.3 + clamp(Math.abs(by.x - bench) / 15, 2, 5), "inOut");
      script.players[trainer]!.holds.push({ kind: "kneel", from: 6.8, until: 24 });
      this.look(trainer, 5, down);
      // Up and off with him.
      const off = { x: bench * 1.12, y: down.y + k * 4 };
      const walk = clamp(Math.abs(off.x - by.x) / 9, 3, 8);
      b.move(trainer, [off], 26.2, 26.2 + walk, "inOut");
      script.players[trainer]!.vanish = 26.2 + walk - 0.5;
    }
    const off = { x: bench * 1.1, y: down.y };
    const walk = clamp(Math.abs(off.x - down.x) / 8, 3, 9);
    b.move(man, [off], 26.4, 26.4 + walk, "inOut");
    script.players[man]!.vanish = 26.4 + walk - 0.5;
    // The camera on him and the men round him while he's down.
    focus.push({ from: 1.2, until: 26, players: near, points: [fieldPoint(down)], closest: 40 });
    return 28;
  }

  /**
   * A second look: on a challenge, the red flag in from the bench of the
   * team that threw it; the teams in loose knots while it's looked at (the
   * tag says what's under review, then the call). The referee isn't drawn
   * walking to the monitor: the data has him doing nothing on the field.
   * Returns when they're back.
   */
  private review(review: Review, focus: IdleFocus[]): number {
    const { b, idle, random, script } = this;
    if (review.kind === "challenge") {
      const side = review.side != null ? (review.side === idle.offense ? idle.bench : -idle.bench) : -FieldFacing.near(idle.yaw);
      const from = { x: side * (Gridiron.half + 8), y: b.line + random.in(-25, 25), z: 6 };
      const tx = side * (Gridiron.half - random.in(8, 16));
      const to = { x: tx, y: from.y + random.in(-6, 6) };
      script.flags.push({ thrown: 0.7, lands: 1.5, from, to, declined: false, red: true });
      script.flashes.push({ beat: "flag", at: 1.5, point: fieldPoint(to) });
      // Thrown by the head coach, at his bench.
      script.players.push(new Player("staff", { x: from.x + side * 2, y: from.y - 2 }, "staff"));
      const coach = script.players.length - 1;
      script.players[coach]!.act("flagThrow", 0.7, to);
      this.look(coach, 0, to);
      script.players[coach]!.vanish = 6;
      // The flag coming in, and the field it lands on.
      focus.push({ from: 0, until: 3.4, players: [], points: [fieldPoint(to), from, b.spot, { x: to.x * 0.4, y: to.y, z: 0 }], closest: 60 });
    }
    // The teams wait in knots on the field.
    const offense = this.team("offense");
    const defense = this.team("defense");
    const ox = b.ballX + random.in(-6, 6);
    this.ring(offense, { x: ox, y: b.line - random.in(20, 26) }, 9, b.at("quarterback"), 0.8);
    const dx = b.ballX + random.in(-8, 8);
    this.ring(defense, { x: dx, y: b.line + random.in(18, 26) }, 10, null, 0.8);
    this.shuffles([...offense, ...defense], 8, 20);
    return 21;
  }

  /**
   * The idle's camera (following the beats, then still) and its beats:
   * everyone on the field and the lines, or what a moment is about (a man
   * down and the trainers with him, a flag coming in) while it lasts.
   * Through a turn of the field it frames each instant exactly, as the
   * field swings under it.
   */
  private finish(focus: readonly IdleFocus[]): void {
    const { b, script } = this;
    script.legs.sort((p, q) => p.from - q.from);
    const end = script.duration;
    const spot = b.spot;
    const ballX = b.ballX;
    const active = (t: number) => focus.findLast((f) => t >= f.from && t < f.until) ?? null;
    const goal = (t: number): CameraFrame => {
      const yaw = script.yawAt(t);
      let items: Rect[];
      const f = active(t);
      if (f) {
        items = f.players.filter((i) => script.players[i]!.opacity(t) > 0.5).map((i) => Gridiron.room(fieldPoint(script.players[i]!.position(t)), true, yaw));
        items.push(...f.points.map((p) => Gridiron.room(p, false, yaw)));
      } else {
        items = script.players.flatMap((p) => (p.opacity(t) > 0.5 ? [Gridiron.room(fieldPoint(p.position(t)), true, yaw)] : []));
        if (script.lines.gain != null) items.push(Gridiron.room({ x: ballX, y: script.lines.gain, z: 0 }, false, yaw));
      }
      items.push(Gridiron.room(spot, false, yaw));
      const region = unionAll(items)!;
      return fitting(region, CameraFrame.headroom + 0.06, f?.closest ?? 60, 36);
    };
    const samples = CameraRig.follow(end, goal);
    const loop = script.loop;
    if (loop) {
      // Still through the looks before the snap: the formation's framing holds them all.
      let held = -1;
      samples.forEach((_, k) => {
        if (k / CameraRig.rate <= loop.start) held = k;
      });
      if (held >= 0) for (let k = held + 1; k < samples.length; k++) samples[k] = samples[held]!;
    }
    const turn = script.turn;
    if (turn) {
      // Exactly framed through the turn, eased into and out of it.
      for (let k = 0; k < samples.length; k++) {
        const t = k / CameraRig.rate;
        const w = Rig.smooth((t - turn.start + 0.6) / 0.6) * (1 - Rig.smooth((t - turn.end - 0.2) / 0.8));
        if (w > 0) samples[k] = CameraFrame.mix(samples[k]!, goal(t), w);
      }
    }
    script.camera = new CameraPath(samples[samples.length - 1] ?? goal(end), samples, end, end);
    // The beats: whenever anyone moves, a flag flies, a pose changes, the field turns or the camera travels.
    const beats: [number, number][] = [];
    for (const p of script.players) {
      for (const m of p.moves) beats.push([m.start, m.end + 0.3]);
      for (const h of p.holds) {
        beats.push([h.from - 0.1, h.from + 0.45]);
        if (Number.isFinite(h.until)) beats.push([h.until - 0.1, h.until + 0.45]);
      }
      for (const a of p.actions) beats.push([a.at - 0.5, a.at + 0.6]);
      if (Number.isFinite(p.vanish)) beats.push([p.vanish, p.vanish + Player.fade + 0.05]);
      if (p.set != null && p.set > 0) beats.push([p.set - 0.05, p.set + 0.3]);
      if (p.resets != null) beats.push([p.resets - 0.35, p.resets + 0.05]);
    }
    for (const f of script.flags) beats.push([f.thrown, f.lands + 0.5]);
    for (const f of script.flights) beats.push([f.start, f.end]);
    if (turn) beats.push([turn.start, turn.end]);
    if (Number.isFinite(script.ballGone)) beats.push([script.ballGone, script.ballGone + 0.1]);
    // The camera, while it travels.
    let travelling: number | null = null;
    for (let k = 1; k < samples.length; k++) {
      const a = samples[k - 1]!;
      const c = samples[k]!;
      const t = k / CameraRig.rate;
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

/** Windows sorted and joined where they touch. */
export function merged(windows: readonly (readonly [number, number])[]): [number, number][] {
  const out: [number, number][] = [];
  for (const w of [...windows].sort((a, b) => a[0] - b[0])) {
    if (!(w[1] > w[0])) continue;
    const last = out[out.length - 1];
    if (last && w[0] <= last[1] + 0.05) last[1] = Math.max(last[1], w[1]);
    else out.push([w[0], w[1]]);
  }
  return out;
}

// MARK: - Status

/** The teams' names for the tags ("Eagles") and their colors (hex). */
export interface StatusNames {
  readonly top: string;
  readonly bottom: string;
  readonly topColor: string | null;
  readonly bottomColor: string | null;
}

const nameOf = (names: StatusNames, side: Side | null): string | null => {
  if (side == null) return null;
  const n = side === "top" ? names.top : names.bottom;
  return n === "" ? null : n;
};
const colorOf = (names: StatusNames, side: Side | null): string | null => (side == null ? null : side === "top" ? names.topColor : names.bottomColor);
const joined = (parts: readonly (string | null)[]): string => parts.filter((p): p is string => p != null).join(" · ");

/** A status: the tag and its tint (TheaterStatus without the heartbeat). */
export interface StatusTag {
  readonly tag: string | null;
  readonly tint: string | null;
}

/**
 * The broadcast tag over the field (FootballStatus), from what the feed
 * says: whose ball and the down during a snap and between them, the flag
 * once it's down ("FLAG · HOLDING, OFFENSE · 10 YDS"), and each stoppage in
 * turn ("TIMEOUT · EAGLES · 2 LEFT", "COMMERCIAL BREAK", "END OF 1ST",
 * "CHALLENGE · FALCONS", then "UNDER REVIEW", then "REVERSED"). The tag
 * draws in capitals. (pure; tested)
 */
export const FootballStatus = {
  /** The flags' yellow, for the flag's tag. */
  flagYellow: "FFD61A",

  /** During a snap's replay at t: the down until the flag lands, then the flag. */
  replay(scene: FootballScene, script: FootballScript, t: number, names: StatusNames): StatusTag {
    const flag = script.flags.find((f) => !f.red);
    const flagged = flag && t >= flag.lands ? FootballStatus.flagTag(scene) : null;
    if (flagged) return { tag: flagged, tint: FootballStatus.flagYellow };
    const team = nameOf(names, scene.offense);
    let tag: string | null;
    if (scene.pointAfter != null) tag = joined([scene.pointAfter === "kick" ? "Extra point" : "Two-point try", team]);
    else if (scene.kind.type === "kickoff") tag = joined(["Kickoff", team]);
    else tag = FootballStatus.ball(team, scene.before ? FootballStatus.downText(scene.before, scene.gainBefore == null) : null);
    return { tag, tint: colorOf(names, scene.offense) };
  },

  /** "Holding, Offense · 10 yds", "Offside, Defense · declined", "Offsetting penalties". */
  flagTag(scene: FootballScene): string | null {
    if (scene.flags.length === 0) return null;
    if (scene.flags.length > 1 && scene.flags.every((f) => f.status === "offsetting")) return "Flag · offsetting penalties";
    const flag = scene.flags.find((f) => f.status === "accepted") ?? scene.flags[0]!;
    const detail = flag.status === "declined" ? "declined" : flag.status === "offsetting" ? "offsetting" : flag.yards != null ? `${flag.yards} yds` : null;
    return joined(["Flag", announced(flag.name, flag.side, scene.offense), detail]);
  },

  /** "Eagles ball · 3rd & 7". */
  ball(team: string | null, down: string | null): string | null {
    const parts = [team != null ? `${team} ball` : null, down];
    return parts.some((p) => p != null) ? joined(parts) : null;
  },

  downText(down: Down, goal: boolean): string {
    return `${ordinal(down.down)} & ${goal ? "Goal" : String(down.distance)}`;
  },

  /** Between snaps at t into the idle: the stoppage, or the situation. `situation`: the live down and distance ("2nd & 7 at MIN 38", "Kickoff"). */
  idle(idle: FootballIdle, stoppage: FootballStoppage | null, script: FootballScript, t: number, names: StatusNames, situation: string | null, timeoutsLeft: { readonly top: number | null; readonly bottom: number | null }): StatusTag {
    const down = situation != null ? (situation.split(" at ")[0] ?? situation) : null;
    const ballTag: StatusTag = {
      tag: idle.phase.kind === "kickoff" ? joined(["Kickoff", nameOf(names, idle.offense)]) : FootballStatus.ball(nameOf(names, idle.offense), down === "Kickoff" ? null : down),
      tint: colorOf(names, idle.offense),
    };
    // Back on the field: the ball again.
    const back = script.loop != null && t >= script.loop.start - 4.5;
    const phase = idle.phase;
    switch (phase.kind) {
      case "between":
      case "kickoff":
        return ballTag;
      case "timeout": {
        if (back) return ballTag;
        const left = phase.side == null ? null : phase.side === "top" ? timeoutsLeft.top : timeoutsLeft.bottom;
        return { tag: joined(["Timeout", nameOf(names, phase.side), left != null ? `${left} left` : null]), tint: colorOf(names, phase.side) };
      }
      case "commercial":
        if (back) return ballTag;
        return { tag: stoppage?.kind === "twoMinuteWarning" ? "Two-minute warning" : "Commercial break", tint: null };
      case "quarter": {
        if (t >= 9) return ballTag;
        const period = stoppage?.period ?? 1;
        return { tag: period >= 4 ? "End of regulation" : `End of ${ordinal(period)}`, tint: null };
      }
      case "off":
        return { tag: stoppage?.kind === "endOfGame" ? "Final" : "Halftime", tint: null };
      case "injury":
        if (back) return ballTag;
        return { tag: `Injury · ${phase.hurt.name}`, tint: colorOf(names, phase.hurt.side) };
      case "review": {
        if (back) return ballTag;
        const review = phase.review;
        const words = review.ruling.length <= 26 ? review.ruling : null;
        if (t < 7 && review.kind === "challenge") return { tag: joined(["Challenge", nameOf(names, review.side)]), tint: colorOf(names, review.side) };
        if (t < (review.kind === "challenge" ? 16 : 13)) return { tag: joined(["Under review", words]), tint: null };
        return { tag: review.reversed ? "Reversed" : "Ruling stands", tint: null };
      }
    }
  },

  /** When the idle's tag next changes (script time), for the stage to wake. */
  changes(idle: FootballIdle, script: FootballScript): number[] {
    const back = script.loop ? script.loop.start - 4.5 : null;
    const phase = idle.phase;
    switch (phase.kind) {
      case "between":
      case "kickoff":
      case "off":
        return [];
      case "quarter":
        return [9];
      case "review":
        return [phase.review.kind === "challenge" ? 7 : null, phase.review.kind === "challenge" ? 16 : 13, back].filter((x): x is number => x != null);
      default:
        return back != null ? [back] : [];
    }
  },
};
