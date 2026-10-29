/**
 * The ballpark theater's beats between balls in play (playBeat.ts) as
 * choreography (PlayBeatScript.swift), in the same terms as a play's
 * (playScript.ts): every figure's path, the ball's flights, what each figure
 * does, the captions (what the tag says from when) and where the camera
 * looks. Built once per beat; a frame is a pure function of the script and
 * t. Each starts and ends on the field as it stands between pitches (`Rest`),
 * so beats play one after another, and after a play's replay, without a jump.
 *
 * Every beat takes its shape from its own data. A pitch flies MLB's tracked
 * path (a sinker runs and sinks, a sweeper sweeps) to its real plate
 * location, from the pitcher's real side and arm slot, to a batter on his
 * real side; without tracking, a path shaped like its type to ESPN's plate
 * location. The call decides the swing: a take, a full swing through it, a
 * foul off to the side or back, a tip into the mitt, a bunt squared; a ball
 * in the dirt the catcher blocks. The plate umpire is down in his set as it
 * comes and makes the call the data says he made. A throw over goes to the
 * base MLB names, from the pitcher (or the catcher); the reliever jogs in
 * from his team's bullpen. Where the data is silent (which way a foul went,
 * who went out to the mound, how far a fielder shifts) it varies by the
 * beat's own ID: no two look canned, and a replay is always the same.
 *
 * Replay time, as a play's: the delivery and the pitch in real time, the rest
 * of the beat brisker. A pitch takes about 2.5 s with the ball coming back to
 * the mound; a visit or a change about 5. Between beats, the idle life
 * (`idleNext`): a move every few seconds, a second or two long.
 *
 *     const script = beatScript(beat, rest);   // its duration, captions, camera…
 */
import { bunted, seedOf, swung, thrown, type BeatPitch, type CaptionLine, type Change, type Delay, type PlayBeat } from "./playBeat";
import { BATTERY, Box, CameraFrame, CameraTrack, regionOf, restCamera } from "./playCamera";
import { Actor, Flight, PlayScript, TARP_ROLL, hurtSpot, pitchPoint, pitchTimeAt, pitchTimeAtHeight, restSpot, type Rest, type Signal, type Team } from "./playScript";
import { plateTime, type StatcastPitch } from "./statcast";
import { Ballpark, type FieldPoint, type Point } from "./theaterField";
import type { Hand } from "./playScene";
import { CameraFollow } from "../theater/theaterKit";

const MASK = 0xffffffffffffffffn;

/** A run of numbers from a seed (SplitMix64): the same every time, and the same as the Mac's. */
export class BeatRandom {
  private state: bigint;

  constructor(seed: bigint) {
    this.state = seed & MASK;
  }

  /** 0 ..< 1. */
  next(): number {
    this.state = (this.state + 0x9e3779b97f4a7c15n) & MASK;
    let z = this.state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
    return Number((z ^ (z >> 31n)) >> 11n) / 2 ** 53;
  }

  between(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
}

/** The battery for a pitch, and a runner leading off first or third (one off second is out of the shot): what a pitch's camera holds. */
export function batteryPoints(rest: Rest): FieldPoint[] {
  const points = [...BATTERY];
  for (const base of [1, 3]) if (rest.bases[base - 1]) points.push({ ...Ballpark.lead(base), z: 0 });
  return points;
}

export function battery(rest: Rest): CameraFrame {
  return CameraFrame.fit(regionOf(batteryPoints(rest)), CameraFrame.headroom);
}

const fit = (points: readonly FieldPoint[]) => CameraFrame.fit(regionOf(points), CameraFrame.headroom);
const fp = (p: Point, z = 0): FieldPoint => ({ x: p.x, y: p.y, z });

/** A beat's choreography on the field as it stands. The camera starts at `from` and comes to rest at `to`. */
export function beatScript(beat: PlayBeat, rest: Rest, from: CameraFrame = restCamera(), to: CameraFrame = restCamera()): PlayScript {
  const b = new BeatBuilder(beat, rest);
  b.build();
  b.shoot(from, to);
  b.script.measureBodies();
  return b.script;
}

/** Assembles a beat's script. */
export class BeatBuilder {
  readonly beat: PlayBeat;
  readonly rest: Rest;
  script: PlayScript;
  batter: number | null;
  /** Actor index by the base a runner leads off. */
  readonly runner = new Map<number, number>();
  readonly random: BeatRandom;
  /** Where the camera looks, from when (each eases in over half a second). */
  looks: { at: number; frame: CameraFrame }[] = [];

  constructor(beat: PlayBeat, rest: Rest) {
    this.beat = beat;
    this.rest = rest;
    this.random = new BeatRandom(seedOf(beat.id));
    this.script = BeatBuilder.field(rest, beat.arm);
    const batter = this.script.actors.findIndex((a) => a.role.kind === "batter");
    this.batter = batter >= 0 ? batter : null;
    this.script.actors.forEach((a, i) => {
      if (a.role.kind !== "runner") return;
      for (let base = 1; base <= 3; base++) {
        const lead = Ballpark.lead(base);
        if (lead.x === a.at.x && lead.y === a.at.y) this.runner.set(base, i);
      }
    });
  }

  /** The field between pitches, as `PlayScript.rest` stands it, the pitcher's hand set: the cast of every beat and idle move. */
  static field(rest: Rest, arm: Hand | null): PlayScript {
    const script = PlayScript.rest(rest);
    if (script.actors[0]) script.actors[0].arm = arm;
    script.rig = [];
    return script;
  }

  fielder(n: number): number {
    return Math.min(Math.max(n, 1), 9) - 1;
  }

  actor(i: number): Actor {
    return this.script.actors[i]!;
  }

  get fieldingHome(): boolean {
    return this.rest.fieldingHome ?? true;
  }

  /** The team in the field's dugout, and the team at bat's. */
  get fieldingDugout(): Point {
    return Ballpark.dugout(this.fieldingHome);
  }

  get battingDugout(): Point {
    return Ballpark.dugout(!this.fieldingHome);
  }

  caption(line: CaptionLine, at: number): void {
    this.script.captions.push({ at, line });
  }

  build(): void {
    const k = this.beat.kind;
    switch (k.kind) {
      case "pitch":
        this.pitch(k.pitch);
        break;
      case "batterUp":
        this.batterUp();
        break;
      case "pickoff":
        this.pickoff(k.base, k.catcher);
        break;
      case "stepOff":
        this.stepOff();
        break;
      case "timeout":
        this.timeout();
        break;
      case "moundVisit":
        this.visit(k.coach);
        break;
      case "pitchingChange":
        this.pitchingChange();
        break;
      case "substitution":
        this.substitution(k.change);
        break;
      case "inningBreak":
        this.inningBreak();
        break;
      case "review":
        this.huddle();
        break;
      case "delay":
        this.delay(k.delay);
        break;
      case "play":
        this.script.duration = 0.1;
        break;
    }
    this.script.flights.sort((a, b) => a.start - b.start);
    this.script.settle = this.script.duration;
  }

  // MARK: The pitch

  /**
   * The pitch: the delivery from the set, the ball along its flight to the
   * plate and into the mitt (or off the bat), the batter's take or swing,
   * the umpire's call, the runners' secondary leads, the infield's creep,
   * and the ball back to the mound. The call lands as it pops the mitt.
   */
  pitch(p: BeatPitch): void {
    const hand: Hand = this.beat.arm ?? "R";
    const bats: Hand = this.rest.bats ?? this.beat.bats ?? "R";
    if (!thrown(p)) return this.automatic(p);
    const flight = p.flight ?? BeatBuilder.shaped(p, hand, seedOf(this.beat.id));
    const pitcher = this.actor(0);
    pitcher.arm = hand;
    pitcher.slot = BeatBuilder.slot(flight);
    const release = 0.8;
    const releaseT = pitchTimeAt(flight, Ballpark.release) ?? 0;
    const plateT = plateTime(flight) ?? releaseT + 0.42;
    // Into the mitt behind the plate, or the dirt before it.
    let endT = pitchTimeAt(flight, -6.5) ?? plateT + 0.05;
    const dirtT = pitchTimeAtHeight(flight, 0.25, releaseT + 0.1);
    const dirt = dirtT != null && dirtT < endT ? dirtT : null;
    if (dirt != null) endT = dirt;
    const at = (tt: number) => release + tt - releaseT;
    const contact = at(plateT);
    const plate = pitchPoint(flight, plateT);
    const script = this.script;
    script.release = release;
    script.ballFrom = release - 0.04;
    // The pitcher sets, comes to the plate; the batter in his stance.
    pitcher.sets = [{ lower: 0.08, upper: release - 0.55 }];
    const fouled = p.call === "foul" || p.call === "foulBunt";
    const pop = fouled ? contact : at(endT);
    const flightEnd = fouled ? plateT : endT;
    script.flights.push(
      new Flight(release, fouled ? contact : pop, pitchPoint(flight, releaseT), pitchPoint(flight, flightEnd), { kind: "pitch", pitch: flight, from: releaseT, to: flightEnd }),
    );

    if (this.batter != null) {
      const batter = this.actor(this.batter);
      if (swung(p)) batter.swing = contact;
      if (bunted(p)) batter.bunt = release - 0.4;
      // A ball near the edge with two strikes: he starts and holds up (a check swing the umpire called a ball).
      if (p.call === "ball" && p.strikes === 2 && BeatBuilder.borderline(plate, flight.zone) && this.random.next() < 0.6) batter.check = contact - 0.02;
    }

    const catcher = this.actor(this.fielder(2));
    if (fouled) {
      this.foul(plate, contact, bats, p.call === "foulBunt");
    } else {
      // A tip: off the bat, on into the mitt.
      if (p.call === "foulTip") script.flashes.push({ beat: "contact", at: contact, point: plate });
      const mitt = pitchPoint(flight, endT);
      if (dirt != null) {
        // In the dirt: he drops to block it, and it kicks out in front of him.
        catcher.act("scoop", pop, Ballpark.rubber);
        const kick = { x: mitt.x + this.random.between(-4, 4), y: mitt.y + this.random.between(1.5, 5) };
        script.flights.push(new Flight(pop, pop + 0.4, mitt, fp(kick), { kind: "bounce", hops: 2 }, "out"));
        catcher.move([{ x: kick.x, y: kick.y - 1.5 }], pop + 0.25, pop + 0.75, "out");
        catcher.act("scoop", pop + 0.75, kick);
        catcher.rise = [{ lower: pop + 0.1, upper: pop + 1.6 }];
        catcher.move([restSpot(this.rest, 2)], pop + 1.5, pop + 2.1);
        this.returnThrow({ x: kick.x, y: kick.y - 1.5 }, pop + 1.0);
      } else {
        catcher.act("glove", pop, Ballpark.rubber);
        script.flashes.push({ beat: "catchBall", at: pop, point: mitt });
        this.returnThrow(restSpot(this.rest, 2), pop + 0.5);
      }
    }

    this.runnersOnThePitch(release, pop, contact, fouled, p.balls === 3 && p.strikes === 2 && this.beat.outs === 2);
    this.creep(release, pop);

    // The zone at the plate as the pitch comes, and where it crossed.
    const zone = flight.zone ?? { bottom: 1.6, top: 3.4 };
    script.zone = { bottom: zone.bottom, top: zone.top, at: contact, crossing: { x: plate.x, y: plate.z }, from: release - 0.1, until: (fouled ? contact : pop) + 0.9 };

    // The call as it pops (a foul as it's hit); a challenge, then how it came out.
    const called = fouled ? contact + 0.12 : pop + 0.02;
    this.caption({ kind: "call", asCalled: p.review != null }, called);
    this.umpire(p, release, fouled ? contact : pop, called);
    let end = Math.max(...script.flights.map((f) => f.end), called + 1.3) + 0.35;
    if (p.review != null) {
      this.caption({ kind: "challenge" }, called + 1.2);
      this.caption({ kind: "outcome" }, called + 2.4);
      end = Math.max(end, called + 3.6);
    }
    script.duration = Math.max(end, ...script.actors.flatMap((a) => a.moves.map((m) => m.end)));
    // In on the battery from the start: there by the release.
    this.looks = [
      { at: 0, frame: restCamera() },
      { at: 0, frame: battery(this.rest) },
    ];
    // A foul down the line or back over the screen: the camera opens up to see where it went, a beat before contact.
    if (fouled && script.watch != null && script.flights[script.watch]) {
      const f = script.flights[script.watch]!;
      const box = new Box();
      for (const q of batteryPoints(this.rest)) box.add(q, true);
      box.add(f.point(f.start + (f.end - f.start) * 0.7), false);
      this.looks.push({ at: contact - 0.1, frame: CameraFrame.fit(box.rect, CameraFrame.headroom) });
    }
    this.looks.push({ at: script.duration - 0.75, frame: restCamera() });
  }

  /**
   * The plate umpire through a pitch: down in his set behind the catcher as
   * it comes, up as it's in; his call as he made it (a called strike's
   * punch, a swinging strike's point, both arms up for a foul; a ball gets
   * nothing); a challenge's tap on the cap, and the strike he signals if the
   * zone gave it.
   */
  umpire(p: BeatPitch, release: number, done: number, called: number): void {
    const u = this.script.umpire;
    if (u == null) return;
    const ump = this.actor(u);
    ump.sets.push({ lower: release - 0.45, upper: done + 0.3 });
    // The call he made: the other one, when the zone overturned it.
    let made = p.call;
    if (p.review?.overturned) made = p.call === "calledStrike" ? "ball" : p.call === "ball" ? "calledStrike" : p.call;
    const kind: Signal["kind"] | null =
      made === "calledStrike"
        ? "strike"
        : made === "swingingStrike" || made === "swingingBlocked" || made === "missedBunt" || made === "foulTip"
          ? "swinging"
          : made === "foul" || made === "foulBunt"
            ? "foul"
            : null;
    if (kind) ump.signals.push({ kind, at: kind === "foul" ? called + 0.1 : called + 0.04, toward: Ballpark.rubber });
    const review = p.review;
    if (!review) return;
    ump.signals.push({ kind: "challenge", at: called + 1.15, toward: Ballpark.rubber });
    if (review.overturned && p.call === "calledStrike") ump.signals.push({ kind: "strike", at: called + 2.45, toward: Ballpark.rubber });
  }

  /** A pitch-clock violation: nothing thrown. The pitcher's (an automatic ball) comes as he's set too long; the batter's (a strike) as he's out of the box. */
  automatic(p: BeatPitch): void {
    if (p.call === "automaticBall") {
      const pitcher = this.actor(0);
      pitcher.sets = [{ lower: 0.2, upper: 1.3 }];
      pitcher.move([{ x: 0, y: 59 }], 1.3, 1.6);
      pitcher.move([restSpot(this.rest, 1)], 1.9, 2.3);
    } else if (this.batter != null && this.rest.bats) {
      const box = Ballpark.box(this.rest.bats);
      const out = { x: box.x * 1.45, y: box.y - 2 };
      const batter = this.actor(this.batter);
      batter.move([out], 0.1, 0.6);
      batter.move([box], 1.6, 2.2);
    }
    this.caption({ kind: "call", asCalled: false }, 0.6);
    this.script.duration = 2.6;
    this.looks = [
      { at: 0, frame: restCamera() },
      { at: 0.2, frame: battery(this.rest) },
      { at: 1.8, frame: restCamera() },
    ];
  }

  /** The ball back to the pitcher: a soft toss from the catcher, up out of his crouch. */
  returnThrow(from: Point, start: number): void {
    const catcher = this.actor(this.fielder(2));
    const mound = restSpot(this.rest, 1);
    const length = 0.62;
    this.script.flights.push(new Flight(start, start + length, fp(from, 4.5), { x: mound.x, y: mound.y + 1, z: 5.2 }, { kind: "arc", peak: 4 }));
    catcher.rise.push({ lower: start - 0.3, upper: start + 0.45 });
    catcher.act("throwBall", start, mound);
    this.actor(0).act("glove", start + length, { x: 0, y: 0 });
    this.script.ballGone = start + length + 0.05;
  }

  /**
   * A foul off the bat. Which way, as the pitch's location and his side make
   * likely (an inside pitch pulled down the line, an outside one sliced the
   * other way, one up in the zone back into the screen, one down chopped into
   * the dirt), the beat's seed choosing among them.
   */
  foul(plate: FieldPoint, contact: number, bats: Hand, bunt: boolean): void {
    const script = this.script;
    const r = this.random;
    script.flashes.push({ beat: "contact", at: contact, point: plate });
    // A right-handed batter pulls toward third (x < 0).
    const pull = bats === "L" ? 1 : -1;
    const inside = bats === "L" ? plate.x : -plate.x;
    let flight: Flight;
    if (bunt) {
      // Bunted foul: off the bat and dribbling over the line.
      const side = r.next() < 0.5 ? 1 : -1;
      const to = Ballpark.polar(r.between(18, 34), side * r.between(50, 70));
      flight = new Flight(contact, contact + 0.75, plate, fp(to), { kind: "bounce", hops: 3 }, "out");
    } else {
      const high = plate.z > 3.3;
      const low = plate.z < 1.75;
      const weights = [0.3 + (high ? 0.4 : 0), 0.3 + Math.min(Math.max(inside * 0.5, -0.25), 0.4), 0.3 + Math.min(Math.max(-inside * 0.5, -0.25), 0.4), low ? 0.4 : 0.06];
      let pick = r.next() * weights.reduce((a, b) => a + b, 0);
      let way = 0;
      for (let i = 0; i < weights.length; i++) {
        const w = weights[i]!;
        if (pick < w) {
          way = i;
          break;
        }
        pick -= w;
        way = i;
      }
      if (way === 0) {
        // Straight back, over the catcher into the screen.
        const to = { x: r.between(-12, 12), y: -58, z: r.between(16, 34) };
        flight = new Flight(contact, contact + 0.5, plate, to, { kind: "arc", peak: r.between(4, 12) });
        this.actor(this.fielder(2)).rise = [{ lower: contact + 0.05, upper: contact + 1.2 }];
      } else if (way === 1 || way === 2) {
        // Down the line, into the seats: pulled, or sliced the other way (shorter).
        const side = way === 1 ? pull : -pull;
        const distance = way === 1 ? r.between(120, 270) : r.between(90, 210);
        const to = Ballpark.polar(distance, side * r.between(50, 76));
        const peak = r.between(24, way === 1 ? 80 : 60);
        // At a replay's pace, quicker than life but slow enough to follow into the seats.
        flight = new Flight(contact, contact + 0.8 + distance / 260, plate, fp(to, 6), { kind: "arc", peak });
        // The man nearest it drifts over to watch it go.
        const dist = (n: number) => Math.hypot(Ballpark.position(n).x - to.x, Ballpark.position(n).y - to.y);
        const near = dist(3) < dist(5) ? 3 : 5;
        const spot = restSpot(this.rest, near);
        const d = Math.max(Math.hypot(to.x - spot.x, to.y - spot.y), 1);
        const step = Math.min(d * 0.12, 14);
        const man = this.actor(this.fielder(near));
        man.move([{ x: spot.x + ((to.x - spot.x) / d) * step, y: spot.y + ((to.y - spot.y) / d) * step }], contact + 0.1, contact + 0.7, "out");
        man.move([spot], contact + 1.3, contact + 2.0);
      } else {
        // Chopped into the dirt, bouncing foul.
        const side = inside >= 0 ? pull : -pull;
        const to = Ballpark.polar(r.between(22, 48), side * r.between(52, 80));
        flight = new Flight(contact, contact + 0.6, plate, fp(to), { kind: "bounce", hops: 2 }, "out");
      }
    }
    script.watch = script.flights.length;
    script.flights.push(flight);
    script.ballGone = flight.end;
  }

  /** A pitch near the zone's edge (the call could have gone either way). */
  static borderline(p: FieldPoint, zone: StatcastPitch["zone"]): boolean {
    const z = zone ?? { bottom: 1.6, top: 3.4 };
    const wide = Math.abs(p.x) - 0.83;
    const tall = Math.max(z.bottom - p.z, p.z - z.top);
    return Math.max(wide, tall) < 0.45;
  }

  /** Each runner's secondary lead: two shuffles off as the pitch is thrown, back once it's caught. Two out on a full count, they're off with the pitch (a foul sends them back). */
  runnersOnThePitch(release: number, pop: number, contact: number, fouled: boolean, full: boolean): void {
    for (const [base, index] of [...this.runner.entries()].sort((a, b) => a[0] - b[0])) {
      const lead = Ballpark.lead(base);
      const next = Ballpark.base(base + 1);
      const d = Math.max(Math.hypot(next.x - lead.x, next.y - lead.y), 1);
      const along = (feet: number) => ({ x: lead.x + ((next.x - lead.x) / d) * feet, y: lead.y + ((next.y - lead.y) / d) * feet });
      const runner = this.actor(index);
      if (full && fouled) {
        runner.move([along(Math.min(80 * (contact + 0.25 - release + 0.2), 62))], release - 0.2, contact + 0.25, "linear");
        runner.move([lead], contact + 0.7, contact + 2.0);
      } else {
        runner.move([along(this.random.between(4, 7))], release - 0.15, release + 0.35, "out");
        runner.move([lead], pop + 0.3, pop + 1.0);
      }
    }
  }

  /** The infielders' creep: a step in as the pitch is thrown, back after. */
  creep(release: number, pop: number): void {
    for (let n = 3; n <= 6; n++) {
      const spot = restSpot(this.rest, n);
      const d = Math.max(Ballpark.distance(spot), 1);
      const step = this.random.between(1.5, 3.5);
      const man = this.actor(this.fielder(n));
      man.move([{ x: spot.x - (spot.x / d) * step, y: spot.y - (spot.y / d) * step }], release - 0.25, release + 0.25, "out");
      man.move([spot], pop + 0.4 + this.random.between(0, 0.3), pop + 1.2);
    }
  }

  /**
   * A pitch's flight shaped like its type, where MLB didn't track it: from
   * his side of the rubber (a right-hander's release on the third-base side),
   * at its speed, breaking as its type does (arm-side run and sink for a
   * sinker, glove-side sweep for a sweeper, drop for a curve), to ESPN's plate
   * location; with none, a spot its call allows. (pure; tested)
   */
  static shaped(p: BeatPitch, arm: Hand, seed: bigint): StatcastPitch {
    const r = new BeatRandom(seed ^ 0x5eedn);
    const mph = p.mph ?? 91;
    const speed = (mph * 5280) / 3600;
    const side = arm === "L" ? 1 : -1;
    // Break (ft/s², x toward his arm side, z with gravity) by type.
    const breaks: Readonly<Record<string, readonly [number, number]>> = {
      SI: [17, -24],
      FT: [17, -24],
      FC: [-4, -24],
      SL: [-8, -30],
      ST: [-15, -30],
      SV: [-15, -30],
      CU: [-7, -42],
      KC: [-7, -42],
      CS: [-7, -42],
      CH: [15, -27],
      FS: [9, -34],
      FO: [9, -34],
      KN: [0, -33],
      EP: [0, -33],
    };
    const [run, drop] = breaks[p.code ?? "FF"] ?? [9, -15];
    const a: [number, number, number] = [run * side, 28, drop];
    const release: [number, number, number] = [side * r.between(1.3, 2.4), Ballpark.release, r.between(5.4, 6.3)];
    const spot = BeatBuilder.plateLocation(p, seed);
    // Time to the front of the plate, under the deceleration.
    const y = 17 / 12;
    const vy = -speed;
    const root = Math.sqrt(vy * vy - 2 * a[1] * (release[1] - y));
    const t = (-vy - root) / a[1];
    const vx = (spot.x - release[0] - (a[0] * t * t) / 2) / t;
    const vz = (spot.y - release[2] - (a[2] * t * t) / 2) / t;
    return { release, velocity: [vx, vy, vz], acceleration: a, plate: [spot.x, spot.y], zone: null, mph, spin: null, type: p.code };
  }

  /** Where a pitch crossed the plate (feet across from its center, and height): ESPN's coordinates, as the strike zone chart has them, else a spot its call allows. */
  static plateLocation(p: BeatPitch, seed: bigint): Point {
    if (p.x != null && p.y != null) return { x: Math.min(Math.max((p.x - 116) * 0.085, -3), 3), y: Math.min(Math.max(3.4 - (p.y - 148) * 0.045, 0.3), 5.2) };
    const r = new BeatRandom(seed ^ 0x91a7en);
    switch (p.call) {
      case "ball":
      case "automaticBall": {
        const side = r.next() < 0.5 ? -1 : 1;
        return { x: side * r.between(1.05, 1.6), y: r.between(1.4, 3.6) };
      }
      case "ballInDirt":
      case "swingingBlocked":
        return { x: r.between(-0.8, 0.8), y: r.between(0.1, 0.5) };
      default:
        return { x: r.between(-0.75, 0.75), y: r.between(1.8, 3.2) };
    }
  }

  /** His arm slot from where the ball left his hand: high and in line with him is over the top, low and wide sidearm. 1 over the top, 0 sidearm. */
  static slot(p: StatcastPitch): number {
    const angle = (Math.atan2(p.release[2] - 4.9, Math.max(Math.abs(p.release[0]) - 0.3, 0.05)) * 180) / Math.PI;
    return Math.min(Math.max(angle / 75, 0), 1);
  }

  // MARK: Between pitches

  /** The batter steps in: a practice swing as he settles. */
  batterUp(): void {
    if (this.batter != null) this.actor(this.batter).practice = 0.4;
    this.caption({ kind: "tag" }, 0);
    this.script.duration = 2.2;
    this.looks = [{ at: 0, frame: restCamera() }];
  }

  /** A throw over: the pitcher set, spinning to throw to the base MLB names (or the catcher up and snapping it there), the man covering it taking the throw and putting down the tag, the runner diving back; then the ball back to the mound. */
  pickoff(base: number, catcher: boolean): void {
    const b = Math.min(Math.max(base, 1), 3);
    const cover = b === 1 ? 3 : b === 2 ? (this.random.next() < 0.5 ? 6 : 4) : 5;
    const bag = Ballpark.bag(b);
    const thrower = catcher ? 2 : 1;
    const from = catcher ? { x: 0, y: -7 } : restSpot(this.rest, 1);
    let start: number;
    if (catcher) {
      this.actor(this.fielder(2)).rise = [{ lower: 0.2, upper: 1.4 }];
      start = 0.55;
    } else {
      this.actor(0).sets = [{ lower: 0.1, upper: 0.62 }];
      start = 0.78;
    }
    const coverer = this.actor(this.fielder(cover));
    coverer.move([bag], 0.25, start + 0.1, "out");
    const d = Math.hypot(bag.x - from.x, bag.y - from.y);
    const length = Math.min(Math.max(d / 165 + 0.08, 0.24), 0.7);
    const arrive = start + length;
    this.script.ballFrom = 0;
    this.script.flights.push(new Flight(start, arrive, fp(from, 5.5), fp(bag, 2.5), { kind: "arc", peak: 1.5 + d * 0.02 }));
    this.actor(this.fielder(thrower)).act("throwBall", start, bag);
    coverer.act("glove", arrive, from);
    coverer.act("scoop", arrive + 0.14, Ballpark.lead(b));
    const index = this.runner.get(b);
    if (index != null) {
      // Back, head first.
      const runner = this.actor(index);
      runner.move([Ballpark.base(b)], start + 0.05, start + 0.42, "out");
      runner.diveBack = start + 0.05;
      runner.move([Ballpark.lead(b)], arrive + 1.0, arrive + 1.7);
    }
    // Back to the mound, and everyone back to his spot.
    const toss = arrive + 0.75;
    const mound = restSpot(this.rest, 1);
    this.script.flights.push(new Flight(toss, toss + 0.5, fp(bag, 4.5), fp(mound, 5), { kind: "arc", peak: 4 }));
    coverer.act("throwBall", toss, mound);
    this.actor(0).act("glove", toss + 0.5, bag);
    coverer.move([restSpot(this.rest, cover)], toss + 0.4, toss + 1.2);
    this.script.ballGone = toss + 0.55;
    this.caption({ kind: "tag" }, 0.2);
    this.script.duration = toss + 1.4;
    const region = [fp(from), fp(bag), fp(Ballpark.lead(b))];
    if (catcher) region.push({ x: 0, y: 0, z: 0 });
    this.looks = [
      { at: 0, frame: restCamera() },
      { at: 0.1, frame: fit(region) },
      { at: toss + 0.3, frame: restCamera() },
    ];
  }

  /** Off the rubber: set, then a step back off it; the runners lean back toward their bags. */
  stepOff(): void {
    const pitcher = this.actor(0);
    pitcher.sets = [{ lower: 0.1, upper: 0.7 }];
    const spot = restSpot(this.rest, 1);
    pitcher.move([{ x: spot.x, y: spot.y + 3.5 }], 0.72, 1.05, "out");
    pitcher.move([spot], 1.5, 2.0);
    for (const [base, index] of this.runner) {
      const lead = Ballpark.lead(base);
      const bag = Ballpark.base(base);
      const runner = this.actor(index);
      runner.move([{ x: (lead.x + bag.x) / 2, y: (lead.y + bag.y) / 2 }], 0.75, 1.05, "out");
      runner.move([lead], 1.5, 2.0);
    }
    this.caption({ kind: "tag" }, 0.7);
    this.script.duration = 2.2;
    this.looks = [{ at: 0, frame: restCamera() }];
  }

  /** Time: the batter steps out, takes a swing, steps back in. */
  timeout(): void {
    if (this.batter == null || !this.rest.bats) {
      this.script.duration = 0.4;
      return;
    }
    const box = Ballpark.box(this.rest.bats);
    const batter = this.actor(this.batter);
    batter.move([{ x: box.x * 1.5, y: box.y - 3 }], 0.15, 0.75);
    batter.practice = 1.0;
    batter.move([box], 1.9, 2.5);
    this.script.duration = 2.7;
    this.looks = [{ at: 0, frame: restCamera() }];
  }

  /** A mound visit: the catcher jogs out (the infielders gather round), or the pitching coach walks out of the dugout with him, a word, and back. */
  visit(coach: boolean): void {
    const mound = restSpot(this.rest, 1);
    const catcher = this.actor(this.fielder(2));
    catcher.move([{ x: mound.x - 3, y: mound.y - 4 }], 0.2, 1.5);
    catcher.move([restSpot(this.rest, 2)], 3.6, 4.9);
    [3, 4, 5, 6].forEach((n, k) => {
      if (!(this.random.next() < 0.75 || !coach)) return;
      const a = (k * Math.PI) / 2 + 0.6 + this.random.between(-0.2, 0.2);
      const spot = { x: mound.x + Math.cos(a) * 10, y: mound.y + Math.sin(a) * 7 };
      const man = this.actor(this.fielder(n));
      man.move([spot], 0.6 + this.random.between(0, 0.3), 2.2);
      man.move([restSpot(this.rest, n)], 3.6 + this.random.between(0, 0.3), 5.0);
    });
    if (coach) {
      const dugout = this.fieldingDugout;
      const walker = new Actor("fielding", dugout, { kind: "coach" }, { appear: 0 });
      walker.move([{ x: mound.x + (dugout.x > 0 ? 4 : -4), y: mound.y - 3 }], 0.1, 2.0);
      walker.move([dugout], 3.6, 5.4);
      walker.vanish = 5.1;
      this.script.actors.push(walker);
    }
    this.caption({ kind: "tag" }, 0.1);
    this.script.duration = 5.6;
    const region = [fp(mound), { x: 0, y: -6, z: 0 }, fp(Ballpark.position(4)), fp(Ballpark.position(6))];
    if (coach) region.push(fp(this.fieldingDugout));
    this.looks = [
      { at: 0, frame: restCamera() },
      { at: 0.3, frame: fit(region) },
      { at: 4.0, frame: restCamera() },
    ];
  }

  /** A pitching change: the manager walks out, the pitcher walks off to his dugout, and the reliever jogs in from his team's bullpen to the mound. */
  pitchingChange(): void {
    const mound = restSpot(this.rest, 1);
    const gate = Ballpark.bullpen(this.fieldingHome);
    const dugout = this.fieldingDugout;
    const manager = new Actor("fielding", dugout, { kind: "coach" }, { appear: 0 });
    manager.move([{ x: mound.x + (dugout.x > 0 ? 5 : -5), y: mound.y - 3 }], 0.1, 1.7);
    manager.move([dugout], 4.6, 6.4);
    manager.vanish = 6.1;
    this.script.actors.push(manager);
    // The pitcher he's taking out.
    const old = this.actor(0);
    old.move([dugout], 1.9, 4.0);
    old.vanish = 3.7;
    // The reliever, seen from part way in: a jog across the outfield.
    const entry = { x: gate.x + (mound.x - gate.x) * 0.5, y: gate.y + (mound.y - gate.y) * 0.5 };
    const reliever = new Actor("fielding", entry, { kind: "fielder", n: 1 }, { appear: 0.5 });
    reliever.arm = this.beat.arm;
    reliever.move([mound], 0.7, 4.4, "linear");
    this.script.actors.push(reliever);
    this.caption({ kind: "tag" }, 0.1);
    this.script.duration = 6.6;
    const mid = { x: (entry.x + mound.x) / 2, y: (entry.y + mound.y) / 2 };
    this.looks = [
      { at: 0, frame: restCamera() },
      { at: 0.3, frame: fit([fp(entry), fp(mound), { x: 0, y: -6, z: 0 }, fp(dugout)]) },
      { at: 2.6, frame: fit([fp(mid), fp(mound), { x: 0, y: -6, z: 0 }, fp(dugout)]) },
      { at: 4.6, frame: restCamera() },
    ];
  }

  /** Someone in, someone out: a pinch runner swapped at his base; a defensive change, the man at that position off to the dugout and his replacement out. */
  substitution(c: Change): void {
    this.caption({ kind: "tag" }, 0.1);
    this.script.duration = 3.4;
    this.looks = [{ at: 0, frame: restCamera() }];
    if (c.role === "pinchRunner") {
      let base = c.base;
      if (base == null) for (let b = 3; b >= 1; b--) if (base == null && this.runner.has(b)) base = b;
      const index = base != null ? this.runner.get(base) : undefined;
      if (base == null || index == null) return;
      this.swap(index, Ballpark.lead(base), this.battingDugout, "batting", { kind: "runner" });
    } else if (c.role === "defensive" || c.role === "moves") {
      const n = c.position;
      if (n == null || n < 2 || n > 9) return;
      this.swap(this.fielder(n), restSpot(this.rest, n), this.fieldingDugout, "fielding", { kind: "fielder", n });
    }
  }

  /** One man jogs off to `dugout`, another comes out of it to `spot`. */
  swap(index: number, spot: Point, dugout: Point, team: Team, role: Actor["role"]): void {
    const pace = 36;
    const d = Math.max(Math.hypot(dugout.x - spot.x, dugout.y - spot.y), 1);
    const jog = Math.min(d / pace, 1.9);
    const f = Math.min((jog * pace) / d, 1);
    const leaving = this.actor(index);
    leaving.move([{ x: spot.x + (dugout.x - spot.x) * f, y: spot.y + (dugout.y - spot.y) * f }], 0.2, 0.2 + jog, "linear");
    leaving.vanish = 0.2 + jog - Actor.fade;
    const g = Math.max(1 - (jog * pace) / d, 0);
    const coming = new Actor(team, { x: dugout.x + (spot.x - dugout.x) * g, y: dugout.y + (spot.y - dugout.y) * g }, role, {
      appear: 0.5,
      crouch: role.kind === "fielder" && role.n === 2,
    });
    coming.move([spot], 0.6, 0.6 + jog, "out");
    this.script.actors.push(coming);
    this.script.duration = Math.max(this.script.duration, 0.6 + jog + 0.6);
    this.looks = [
      { at: 0, frame: restCamera() },
      { at: 0.2, frame: fit([fp(spot), fp(dugout), { x: 0, y: 30, z: 0 }]) },
      { at: this.script.duration - 0.9, frame: restCamera() },
    ];
  }

  /** Between halves, the team just out there warms up: the pitcher's warm-up toss to the catcher and back, then the first baseman's grounder to an infielder, thrown back to him. */
  inningBreak(): void {
    this.warmUp(0.5);
    this.groundBall(2.9);
    this.caption({ kind: "tag" }, 0.05);
    this.script.duration = Math.max(...this.script.flights.map((f) => f.end), 4) + 0.5;
    this.looks = [{ at: 0, frame: restCamera() }];
  }

  /** A warm-up pitch: an easy fastball down the middle, and back. */
  warmUp(start: number): void {
    const hand: Hand = this.beat.arm ?? "R";
    const p: BeatPitch = { call: "calledStrike", number: 0, balls: 0, strikes: 0, code: "FF", mph: this.random.between(84, 90), x: null, y: null, flight: null, review: null };
    const flight = BeatBuilder.shaped(p, hand, seedOf(this.beat.id) ^ 0xa11n);
    const releaseT = pitchTimeAt(flight, Ballpark.release) ?? 0;
    const endT = pitchTimeAt(flight, -6.5) ?? 0.5;
    const release = start + 0.55;
    this.script.release = release;
    this.actor(0).arm = hand;
    this.script.flights.push(new Flight(release, release + endT - releaseT, pitchPoint(flight, releaseT), pitchPoint(flight, endT), { kind: "pitch", pitch: flight, from: releaseT, to: endT }));
    const pop = release + endT - releaseT;
    this.actor(this.fielder(2)).act("glove", pop, Ballpark.rubber);
    this.returnThrow(restSpot(this.rest, 2), pop + 0.55);
  }

  /** The first baseman rolls a grounder to an infielder, who throws it back. */
  groundBall(start: number): void {
    const to = [4, 5, 6][Math.trunc(this.random.next() * 3) % 3]!;
    const a = restSpot(this.rest, 3);
    const b = restSpot(this.rest, to);
    const roll = new Flight(start, start + 0.95, fp(a, 2), fp(b, 0.4), { kind: "bounce", hops: 3 }, "out");
    roll.fresh = true;
    this.script.flights.push(roll);
    this.actor(this.fielder(3)).act("throwBall", start, b);
    this.actor(this.fielder(to)).act("scoop", start + 0.95, a);
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const length = Math.min(Math.max(d / 160 + 0.08, 0.3), 0.75);
    this.script.flights.push(new Flight(start + 1.3, start + 1.3 + length, fp(b, 5), fp(a, 4.5), { kind: "arc", peak: 2 + d * 0.03 }));
    this.actor(this.fielder(to)).act("throwBall", start + 1.3, a);
    this.actor(this.fielder(3)).act("glove", start + 1.3 + length, b);
    this.script.ballGone = start + 1.3 + length + 0.05;
  }

  /** A review (or a hold-up on the field): the infielders drift in toward the mound and wait, the catcher up out of his crouch; back after. */
  huddle(): void {
    for (let n = 3; n <= 6; n++) {
      const spot = restSpot(this.rest, n);
      const toward = restSpot(this.rest, 1);
      const d = Math.max(Math.hypot(toward.x - spot.x, toward.y - spot.y), 1);
      const step = this.random.between(6, 16);
      const man = this.actor(this.fielder(n));
      man.move([{ x: spot.x + ((toward.x - spot.x) / d) * step, y: spot.y + ((toward.y - spot.y) / d) * step }], 0.3 + this.random.between(0, 0.4), 1.6);
      man.move([spot], 2.6 + this.random.between(0, 0.3), 3.6);
    }
    this.actor(this.fielder(2)).rise = [{ lower: 0.2, upper: 3.4 }];
    this.caption({ kind: "tag" }, 0.1);
    this.script.duration = 3.8;
    this.looks = [{ at: 0, frame: restCamera() }];
  }

  delay(d: Delay): void {
    this.caption({ kind: "tag" }, 0.1);
    this.looks = [{ at: 0, frame: restCamera() }];
    switch (d.kind) {
      case "injury": {
        // The trainer and the manager out to him, from his team's dugout.
        const spot = hurtSpot(d.hurt);
        const dugout = d.hurt === "batter" ? this.battingDugout : this.fieldingDugout;
        const team: Team = d.hurt === "batter" ? "batting" : "fielding";
        [
          { x: spot.x + 4, y: spot.y - 2 },
          { x: spot.x - 4, y: spot.y + 1 },
        ].forEach((end, k) => {
          const a = new Actor(team, dugout, { kind: "coach" }, { appear: 0.1 + k * 0.35 });
          a.move([end], 0.2 + k * 0.35, 2.0 + k * 0.35);
          this.script.actors.push(a);
        });
        this.script.duration = 2.9;
        this.looks = [
          { at: 0, frame: restCamera() },
          { at: 0.3, frame: fit([fp(spot), fp(dugout), { x: 0, y: 30, z: 0 }]) },
          { at: 2.0, frame: restCamera() },
        ];
        break;
      }
      case "onField":
        this.huddle();
        break;
      case "weather": {
        if (this.rest.standing?.kind === "tarp") {
          // Already under the tarp (MLB's status said so first).
          this.script.duration = 1.2;
          return;
        }
        // Everyone off (the umpires behind the plate), and the tarp out over the infield.
        for (const a of this.script.actors) {
          const dugout = a.team === "official" ? { x: 0, y: -70 } : a.team === "fielding" ? this.fieldingDugout : this.battingDugout;
          const from = a.position(0);
          const dd = Math.max(Math.hypot(dugout.x - from.x, dugout.y - from.y), 1);
          const jog = Math.min(dd / 38, 1.8);
          const f = Math.min((jog * 38) / dd, 1);
          const start = 0.2 + this.random.between(0, 0.4);
          a.move([{ x: from.x + (dugout.x - from.x) * f, y: from.y + (dugout.y - from.y) * f }], start, start + jog, "linear");
          a.vanish = start + jog - Actor.fade;
        }
        this.script.tarp = { at: 1.0, out: true };
        this.script.duration = 1.0 + TARP_ROLL + 0.3;
        break;
      }
      case "resuming":
        this.script = BeatBuilder.field({ ...this.rest, standing: { kind: "tarp" } }, null);
        this.caption({ kind: "tag" }, 0.1);
        this.script.duration = 1.2;
        break;
      case "over": {
        // The tarp comes off and the team in the field takes it again.
        const after: Rest = { ...this.rest, standing: null };
        this.script = BeatBuilder.field({ ...this.rest, standing: { kind: "tarp" } }, null);
        this.script.tarp = { at: 0.1, out: false };
        this.caption({ kind: "tag" }, 0.1);
        const dugout = this.fieldingDugout;
        let arrived = TARP_ROLL;
        for (let n = 1; n <= 9; n++) {
          const spot = restSpot(after, n);
          const dd = Math.max(Math.hypot(spot.x - dugout.x, spot.y - dugout.y), 1);
          const jog = Math.min(dd / 38, 2.0);
          const f = Math.max(1 - (jog * 38) / dd, 0);
          const start = TARP_ROLL * 0.6 + this.random.between(0, 0.4);
          const a = new Actor("fielding", { x: dugout.x + (spot.x - dugout.x) * f, y: dugout.y + (spot.y - dugout.y) * f }, { kind: "fielder", n }, { appear: start - 0.1, crouch: n === 2 });
          a.move([spot], start, start + jog, "out");
          this.script.actors.push(a);
          arrived = Math.max(arrived, start + jog);
        }
        if (after.bats) this.script.actors.push(new Actor("batting", Ballpark.box(after.bats), { kind: "batter" }, { appear: arrived, bats: after.bats }));
        for (let base = 1; base <= 3; base++) if (after.bases[base - 1]) this.script.actors.push(new Actor("batting", Ballpark.lead(base), { kind: "runner" }, { appear: arrived }));
        // The plate umpire, back out from behind it.
        const umpire = new Actor("official", { x: 0, y: -40 }, { kind: "umpire" }, { appear: TARP_ROLL * 0.5 });
        umpire.move([Ballpark.umpire(after.bats)], TARP_ROLL * 0.5 + 0.1, TARP_ROLL * 0.5 + 1.8);
        this.script.actors.push(umpire);
        this.script.duration = arrived + 0.4;
        break;
      }
    }
  }

  // MARK: Camera

  /** The camera through the beat: each look eased in over half a second, followed on the broadcast spring, resting at `to`. */
  shoot(from: CameraFrame, to: CameraFrame): void {
    const duration = this.script.duration;
    const rest = restCamera();
    if (this.looks.length <= 1 && CameraFrame.equal(from, rest) && CameraFrame.equal(to, rest)) {
      this.script.camera = new CameraTrack();
      return;
    }
    const keys = this.looks.length === 0 ? [{ at: 0, frame: from }] : this.looks.map((k) => ({ ...k }));
    keys[0]!.frame = from;
    const last = keys[keys.length - 1]!;
    if (keys.length > 1 && CameraFrame.equal(last.frame, rest)) last.frame = to;
    else keys.push({ at: Math.max(duration - 0.8, 0), frame: to });
    const goal = (t: number): CameraFrame => {
      let k = 0;
      for (let i = keys.length - 1; i >= 0; i--) {
        if (keys[i]!.at <= t) {
          k = i;
          break;
        }
      }
      if (k === 0) return keys[0]!.frame;
      const u = Math.min(Math.max((t - keys[k]!.at) / 0.5, 0), 1);
      return CameraFrame.mix(keys[k - 1]!.frame, keys[k]!.frame, u * u * (3 - 2 * u));
    };
    const samples = CameraFollow.samples(duration, goal);
    // Landed exactly where it rests: the last few frames close the gap.
    const tail = Math.trunc(0.35 * CameraTrack.rate);
    for (let i = Math.max(samples.length - tail, 0); i < samples.length; i++) {
      const u = (i - (samples.length - tail)) / Math.max(tail - 1, 1);
      samples[i] = CameraFrame.mix(samples[i]!, to, u * u * (3 - 2 * u));
    }
    this.script.camera = CameraTrack.fromSamples(samples, to);
  }

  // MARK: Idle

  idle(kind: IdleBeat): void {
    const script = this.script;
    script.duration = 1.4;
    switch (kind) {
      case "sign":
        this.actor(0).sign = { lower: 0.1, upper: 1.05 };
        script.duration = 1.3;
        break;
      case "practiceSwing":
        if (this.batter != null) this.actor(this.batter).practice = 0.1;
        script.duration = 1.4;
        break;
      case "weight": {
        const pool = [3, 4, 5, 6, 7, 8, 9];
        const i = Math.trunc(this.random.next() * 7) % 7;
        const j = (i + 1 + Math.trunc(this.random.next() * 5)) % 7;
        for (const n of [pool[i]!, pool[j]!]) {
          const spot = restSpot(this.rest, n);
          const side = this.random.next() < 0.5 ? -1 : 1;
          const d = Math.max(Ballpark.distance(spot), 1);
          // Across his line to the plate, a step and back.
          const across = { x: spot.x + (spot.y / d) * side * this.random.between(1.2, 2.4), y: spot.y - (spot.x / d) * side * this.random.between(1.2, 2.4) };
          const start = this.random.between(0, 0.25);
          const man = this.actor(this.fielder(n));
          man.move([across], start, start + 0.45, "inOut");
          man.move([spot], start + 0.75, start + 1.2, "inOut");
        }
        script.duration = 1.5;
        break;
      }
      case "lead": {
        const on = [...this.runner.entries()].sort((a, b) => a[0] - b[0]);
        if (on.length === 0) return;
        const [base, index] = on[Math.trunc(this.random.next() * on.length) % on.length]!;
        const lead = Ballpark.lead(base);
        const next = Ballpark.base(base + 1);
        const d = Math.max(Math.hypot(next.x - lead.x, next.y - lead.y), 1);
        const step = this.random.between(2.5, 4.5);
        const runner = this.actor(index);
        runner.move([{ x: lead.x + ((next.x - lead.x) / d) * step, y: lead.y + ((next.y - lead.y) / d) * step }], 0.1, 0.55, "out");
        runner.move([lead], 0.95, 1.45);
        script.duration = 1.6;
        break;
      }
      case "catcher":
        this.actor(this.fielder(2)).rise = [{ lower: 0.1, upper: 1.1 }];
        script.duration = 1.4;
        break;
      case "warmup":
        this.warmUp(0.1);
        script.duration = Math.max(...script.flights.map((f) => f.end), 1) + 0.3;
        break;
      case "infield":
        this.groundBall(0.15);
        script.duration = Math.max(...script.flights.map((f) => f.end), 1) + 0.3;
        break;
      case "outfield": {
        const a = restSpot(this.rest, 7);
        const b = restSpot(this.rest, 8);
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const toss = new Flight(0.25, 1.15, fp(a, 5.5), fp(b, 5), { kind: "arc", peak: 10 + d * 0.06 });
        toss.fresh = true;
        script.flights.push(toss);
        this.actor(this.fielder(7)).act("throwBall", 0.25, b);
        this.actor(this.fielder(8)).act("glove", 1.15, a);
        script.flights.push(new Flight(1.45, 2.35, fp(b, 5.5), fp(a, 5), { kind: "arc", peak: 10 + d * 0.06 }));
        this.actor(this.fielder(8)).act("throwBall", 1.45, a);
        this.actor(this.fielder(7)).act("glove", 2.35, b);
        script.ballGone = 2.4;
        script.duration = 2.6;
        break;
      }
      case "trainer":
        script.actors.forEach((a) => {
          if (a.role.kind !== "coach") return;
          const p = a.at;
          a.move([{ x: p.x + this.random.between(-1.5, 1.5), y: p.y + this.random.between(-1, 1) }], 0.1, 0.6);
          a.move([p], 0.9, 1.4);
        });
        script.duration = 1.5;
        break;
      case "brush": {
        const u = script.umpire;
        if (u == null) return;
        const ump = this.actor(u);
        const spot = ump.at;
        const side = spot.x < 0 ? -1 : 1;
        // Round the catcher on his own side, a bend over the plate, and back.
        ump.move([{ x: side * 3.6, y: -6 }, { x: side * 1.2, y: 2.4 }], 0.1, 1.0);
        ump.act("scoop", 1.25, { x: 0, y: 0 });
        ump.move([{ x: side * 3.6, y: -6 }, spot], 1.75, 2.65);
        script.duration = 2.8;
        break;
      }
    }
  }
}

// MARK: - Idle

/**
 * The field's life between pitches, so it never looks frozen: a move every
 * few seconds, a second or two long, then still. Which moves fit what's on
 * the field (a lead off only with a runner on, the warm-up throws only
 * between halves), and which comes next is the seed's, never the same one
 * twice running.
 */
export type IdleBeat = "sign" | "practiceSwing" | "weight" | "lead" | "catcher" | "warmup" | "infield" | "outfield" | "trainer" | "brush";

export const IDLE_BEATS: readonly IdleBeat[] = ["sign", "practiceSwing", "weight", "lead", "catcher", "warmup", "infield", "outfield", "trainer", "brush"];

/** The moves that fit the field as it stands. */
export function idleFitting(rest: Rest, between: boolean): IdleBeat[] {
  if (rest.standing?.kind === "tarp") return [];
  if (rest.standing?.kind === "injury") return ["trainer", "weight"];
  if (between) return ["warmup", "infield", "outfield", "weight", "brush"];
  const out: IdleBeat[] = ["sign", "weight", "catcher"];
  if (rest.bats) out.push("practiceSwing");
  if (rest.bases.some(Boolean)) out.push("lead");
  return out;
}

/**
 * The `n`th move after the field came to rest, and how long before it
 * (4.5–8 s of stillness): null when nothing fits (a tarp; Reduce Motion is
 * the stage's). (pure; tested)
 */
export function idleNext(n: number, rest: Rest, between: boolean, seed: bigint): { beat: IdleBeat; wait: number } | null {
  const options = idleFitting(rest, between);
  if (options.length === 0) return null;
  // Each pick in turn from the first: never the same move twice running.
  let pick = -1;
  let wait = 0;
  for (let k = 0; k <= Math.max(n, 0); k++) {
    const r = new BeatRandom((seed + BigInt(k) * 7919n) & MASK);
    wait = r.between(4.5, 8);
    let next = Math.trunc(r.next() * options.length) % options.length;
    if (next === pick && options.length > 1) next = (next + 1) % options.length;
    pick = next;
  }
  return { beat: options[pick]!, wait };
}

/** One idle move on the field as it stands: it starts and ends there. */
export function idleScript(kind: IdleBeat, rest: Rest, seed: bigint, arm: Hand | null = null): PlayScript {
  const beat: PlayBeat = {
    id: `idle.${seed}`,
    kind: { kind: "timeout" },
    bats: null,
    arm,
    inning: null,
    top: null,
    balls: 0,
    strikes: 0,
    outs: 0,
    wallclock: null,
    bases: null,
    news: false,
  };
  const b = new BeatBuilder(beat, rest);
  b.idle(kind);
  b.script.flights.sort((x, y) => x.start - y.start);
  b.script.settle = b.script.duration;
  b.script.measureBodies();
  return b.script;
}
