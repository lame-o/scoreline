/**
 * The play theater with Statcast (PlayStatcastTests.swift, check by check:
 * World Series Game 3's plays, mlb-ws-g3-plays.json, and MLB's at-bats for
 * the same game, statcast-849804.json): the batted ball flown from its launch,
 * coming down where MLB measured it in real hang times; the pitch along its
 * tracked path to where it crossed the plate; the choreography keyed to the
 * real flight; and ESPN's account alone, as before, whenever Statcast has
 * nothing. (The matching is statcast.test.ts's.)
 */
import { describe, expect, it } from "vitest";
import { CameraFrame, restCamera } from "../../src/data/mlb/playCamera";
import { parse, type PlayScene, type SideOf } from "../../src/data/mlb/playScene";
import { BattedFlight, Builder, pitchPoint, PlayScript } from "../../src/data/mlb/playScript";
import { plateTime, statcastAtBats } from "../../src/data/mlb/statcast";
import { Ballpark, fieldPoint, ground, samePoint, type FieldPoint } from "../../src/data/mlb/theaterField";
import { fixture } from "./fixtures";

const g3 = fixture("mlb-ws-g3-plays.json") as { items: unknown[]; names: Record<string, string> };
const plays = g3.items;
const atBats = statcastAtBats(fixture("statcast-849804.json"));
const side: SideOf = (id) => (id === "8" ? "top" : id === "30" ? "bottom" : null);
const idOf = (p: unknown) => (p as { id?: string }).id;
const scene = (id: string): PlayScene => parse(plays, plays.findIndex((p) => idOf(p) === id), side, g3.names)!;
const measured = (id: string): PlayScene => {
  const s = scene(id);
  s.measured = s.measurement(atBats);
  return s;
};
const script = (s: PlayScene) => PlayScript.play(s, { bases: s.endsInning ? [false, false, false] : s.basesAfter, bats: "R", swapped: s.endsInning });
const scenes = plays.flatMap((p, i) => ((p as { type?: { type?: string } }).type?.type === "play-result" ? (parse(plays, i, side, g3.names) ?? []) : []));
const samplesOf = (s: PlayScript) => {
  const arc = s.batted != null ? s.flights[s.batted]!.arc : null;
  return arc?.kind === "samples" ? arc.points : null;
};

describe("the batted ball's flight", () => {
  it("every measured ball comes down at Statcast's distance on its spot's line, ends where it was fielded, in real hang times, never under the grass", { timeout: 60_000 }, () => {
    const landings: string[] = [];
    const spots: string[] = [];
    const hangs: string[] = [];
    const under: string[] = [];
    for (const bare of scenes) {
      const s = bare.copy({ measured: bare.measurement(atBats) });
      const batted = s.measured?.batted;
      const distance = batted?.distance;
      const sc = script(s);
      const points = samplesOf(sc);
      if (!batted || distance == null || !points || sc.batted == null) continue;
      const flight = sc.flights[sc.batted]!;
      const firstStep = flight.hops[0] != null ? Math.round(flight.hops[0] * (points.length - 1)) : points.length - 1;
      const first = points[firstStep]!;
      // In the air until caught or down; a ball hit into the ground, until it gets to its fielder.
      const angle = batted.launchAngle ?? 0;
      const real = (angle < 8 ? points.length - 1 : firstStep) / 120;
      const spot = batted.spot ? Ballpark.feet({ x: batted.spot[0], y: batted.spot[1] }) : { x: 0, y: 0 };
      const wall = distance > Ballpark.fence(Ballpark.bearing(spot)) - 3;
      // Where it first comes down (or is caught): Statcast's distance, on its spot's line.
      const off = Math.abs(Ballpark.distance(ground(first)) - distance);
      const across = Math.abs(Ballpark.bearing(ground(first)) - Ballpark.bearing(spot)) * distance;
      if (!wall && (off > 1 || across > 3)) landings.push(`${s.text} ${off.toFixed(0)} ft off, ${across.toFixed(0)} ft across`);
      // A ball on the ground ends where it was fielded.
      const end = ground(points[points.length - 1]!);
      const caughtKind = ["flyOut", "lineOut", "popOut", "foulOut"].includes(s.kind.type);
      if (!caughtKind && Math.hypot(end.x - spot.x, end.y - spot.y) > 1) spots.push(`${s.text} ${Math.trunc(Math.hypot(end.x - spot.x, end.y - spot.y))} ft from its spot`);
      const range = angle < 8 ? [0.8, 4.5] : angle < 20 ? [1.2, 3.8] : angle < 40 ? [2.5, 5.5] : angle < 60 ? [3.0, 6.5] : [4.0, 6.5];
      // (A drive off the wall first touches the grass on its way back.)
      if (!wall && !(real >= range[0]! && real <= range[1]!)) hangs.push(`${s.text} ${angle.toFixed(0)}° ${real.toFixed(2)} s`);
      if (points.some((p) => p.z < -0.01 || !Number.isFinite(p.x) || !Number.isFinite(p.y))) under.push(s.text);
    }
    expect(landings).toEqual([]);
    expect(spots).toEqual([]);
    expect(hangs).toEqual([]);
    expect(under).toEqual([]);
  });
  it("Hamilton's 80 mph liner at 12° is in a glove 163 ft out in under 2 s; Yelich's 105 mph fly at 29° hangs about 5 s", () => {
    const hang = (id: string) => {
      const points = samplesOf(script(measured(id)));
      return points ? (points.length - 1) / 120 : -1;
    };
    expect(hang("4019080440801990057")).toBeGreaterThan(1.4);
    expect(hang("4019080440801990057")).toBeLessThan(2.0);
    expect(hang("4019080441001990057")).toBeGreaterThan(4.5);
    expect(hang("4019080441001990057")).toBeLessThan(5.3);
  });
  it("the physics on its own: a no-doubter's carry, a home run into the seats, a liner, a grounder's hops", () => {
    const plate = { x: 0, y: 1.4 };
    const fly = new BattedFlight(105, 28, fieldPoint(plate, 3), Ballpark.polar(400, 0), { kind: "caught", height: 0 });
    expect(Math.abs(Ballpark.distance(ground(fly.points[fly.points.length - 1]!)) - 400)).toBeLessThan(1);
    expect(fly.duration).toBeGreaterThan(4.6);
    expect(fly.duration).toBeLessThan(5.4);
    const deep = new BattedFlight(105, 28, fieldPoint(plate, 3), Ballpark.polar(405, 0), { kind: "homeRun" });
    const last = deep.points[deep.points.length - 1]!;
    expect(deep.over != null && deep.point(deep.over).z > Ballpark.wallHeight).toBe(true);
    expect(last.z).toBeGreaterThanOrEqual(Ballpark.wallHeight);
    expect(Ballpark.distance(ground(last))).toBeGreaterThan(Ballpark.fence(0));
    const liner = new BattedFlight(100, 10, fieldPoint(plate, 3), null, { kind: "fielded", spot: Ballpark.polar(300, -10) });
    expect(liner.touchdown).toBeGreaterThan(1.6);
    expect(liner.touchdown).toBeLessThan(2.3);
    const down = Ballpark.distance(ground(liner.point(liner.touchdown)));
    expect(down >= 200 && down <= 250).toBe(true);
    const through = Ballpark.polar(250, -20);
    const chopper = new BattedFlight(95, -20, fieldPoint(plate, 2.5), Ballpark.polar(8, -20), { kind: "fielded", spot: through });
    const end = chopper.points[chopper.points.length - 1]!;
    expect(chopper.hops.length).toBeGreaterThanOrEqual(3);
    expect(chopper.duration).toBeGreaterThan(1.5);
    expect(chopper.duration).toBeLessThan(4.2);
    expect(Math.hypot(end.x - through.x, end.y - through.y)).toBeLessThan(0.5);
    // …each hop no higher than the last.
    const heights = chopper.hops.slice(1).map((b, i) => {
      let top = 0;
      for (let t = chopper.hops[i]!; t <= b; t += 1 / 120) top = Math.max(top, chopper.point(t).z);
      return top;
    });
    expect(heights.slice(1).every((h, i) => heights[i]! >= h)).toBe(true);
  });
});

describe("its replay", () => {
  it("a deep fly plays at one pace contact to glove, about 2.4× real time; the center fielder gloves it where and when it comes down", () => {
    const s = script(measured("4019080441001990057"));
    const points = samplesOf(s)!;
    const flight = s.flights[s.batted!]!;
    const real = (points.length - 1) / 120;
    expect(Math.abs(flight.end - flight.start - real * Builder.pace(real))).toBeLessThan(0.001);
    expect(real / (flight.end - flight.start)).toBeGreaterThan(2);
    expect(real / (flight.end - flight.start)).toBeLessThan(3);
    const catcher = s.actors[7]!.actions.find((a) => a.kind === "catchHigh");
    expect(catcher != null && Math.abs(catcher.at - flight.end) < 0.001).toBe(true);
    expect(Math.abs(s.actors[7]!.position(flight.end).x - points[points.length - 1]!.x)).toBeLessThan(0.5);
  });
  it("6-3 on a measured chopper: the shortstop fields it as it gets to him, then throws; the out still beats the runner; dust at each hop", () => {
    const s = script(measured("4019080440005990057"));
    const flight = s.flights[s.batted!]!;
    const out = s.flashes.find((f) => f.beat === "out")!;
    const scoop = s.actors[5]!.actions.find((a) => a.kind === "scoop")?.at ?? 0;
    const throwAt = s.actors[5]!.actions.find((a) => a.kind === "throwBall")?.at ?? 0;
    const moves = s.actors[9]!.moves;
    expect(Math.abs(scoop - flight.end)).toBeLessThan(0.001);
    expect(throwAt).toBeGreaterThan(scoop);
    expect(out.at).toBeGreaterThan(throwAt);
    expect(out.at).toBeLessThan(moves[moves.length - 1]?.end ?? 0);
    expect(s.puffs.length).toBeGreaterThan(0);
    expect(s.puffs.every((p) => p.at >= flight.start && p.at <= flight.end)).toBe(true);
  });
  it("4-6-3 on the measured grounder: out at second, then at first", () => {
    const s = script(measured("4019080441102990057"));
    const outs = s.flashes.filter((f) => f.beat === "out").sort((a, b) => a.at - b.at).map((f) => ground(f.point));
    expect(outs.length).toBe(2);
    expect(samePoint(outs[0]!, Ballpark.base(2)) && samePoint(outs[1]!, Ballpark.base(1))).toBe(true);
  });
  it("a liner that falls in: it lands, hops on to the center fielder, and the hit's mark is where he gathers it", () => {
    const s = script(measured("4019080440101990057"));
    const points = samplesOf(s)!;
    const flight = s.flights[s.batted!]!;
    const touchdown = (flight.hops[0] ?? 1) * (flight.end - flight.start) + flight.start;
    expect(touchdown).toBeLessThan(flight.end);
    expect(Math.abs(s.landing!.at - flight.end)).toBeLessThan(0.001);
    expect(samePoint(s.landing!.point, ground(points[points.length - 1]!))).toBe(true);
  });
  it("a 413 ft drive that stayed in (Díaz's double): off this park's wall below its top, and back to the center fielder", () => {
    const points = samplesOf(script(measured("4019080441704990057")))!;
    const beyond = (p: FieldPoint) => Ballpark.distance(ground(p)) - Ballpark.fence(Ballpark.bearing(ground(p)));
    const wall = points.findIndex((p) => beyond(p) > -2.5);
    expect(wall).toBeGreaterThanOrEqual(0);
    expect(points[wall]!.z).toBeLessThan(Ballpark.wallHeight);
    expect(points.slice(wall).every((p) => beyond(p) <= 0)).toBe(true);
    expect(beyond(points[points.length - 1]!)).toBeLessThan(-15);
  });
  it("every measured play's figures and ball stay finite, runs 1.2–4.8 s before it settles, and the camera ends exactly at rest", { timeout: 60_000 }, () => {
    const all = scenes.map((s) => script(s.copy({ measured: s.measurement(atBats) })));
    for (const sc of all) {
      for (let t = 0; t <= sc.duration; t += 0.05) {
        for (const a of sc.actors) {
          const p = a.position(t);
          expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
        }
        const ball = sc.ball(t);
        if (ball) expect(Number.isFinite(ball.x) && Number.isFinite(ball.y) && Number.isFinite(ball.z) && ball.z >= -0.01).toBe(true);
      }
      expect(sc.settle - 0.75).toBeGreaterThanOrEqual(1.2);
      expect(sc.settle - 0.75).toBeLessThanOrEqual(4.8);
      expect(CameraFrame.equal(sc.camera.frame(sc.duration), restCamera())).toBe(true);
    }
  });
  it("a measured home run clears the wall mid-flight and comes down in the seats; the mark as it clears, both runs home, its distance in the readout once", () => {
    const g2 = (fixture("mlb-ws-g2-summary-plays.json") as { plays: unknown[] }).plays;
    const homer = parse(g2, g2.findIndex((p) => idOf(p) === "4019080430005990057"), (id) => (id === "30" ? "top" : "bottom"))!;
    const spot = homer.spot!;
    homer.measured = {
      batted: { launchSpeed: 106.2, launchAngle: 29, distance: 411, trajectory: "fly_ball", spot: [spot.x, spot.y], fielder: null },
      pitch: null,
      movements: [],
    };
    const s = script(homer);
    const fence = s.fence!;
    const flight = s.flights[s.batted!]!;
    const landing = s.landing!;
    expect(fence.at).toBeGreaterThan(flight.start);
    expect(fence.at).toBeLessThan(flight.end);
    expect(flight.point(fence.at).z).toBeGreaterThan(Ballpark.wallHeight);
    expect(landing.z ?? 0).toBeGreaterThan(Ballpark.wallHeight);
    expect(Ballpark.distance(landing.point)).toBeGreaterThan(Ballpark.fence(Ballpark.bearing(landing.point)));
    expect(s.stamp).toBe(fence.at + 0.05);
    expect(s.flashes.filter((f) => f.beat === "run").length).toBe(2);
    expect(s.settle - 0.75).toBeLessThan(4.6);
    expect(homer.readout).toBe("106.2 MPH · 29° · 411 FT");
  });
});

describe("the pitch", () => {
  it("every tracked pitch leaves the hand (54 ft) and crosses the plate where Statcast measured, within an inch, in real time", () => {
    const misses: string[] = [];
    for (const bare of scenes) {
      const s = bare.copy({ measured: bare.measurement(atBats) });
      const pitch = s.measured?.pitch;
      const plate = pitch ? plateTime(pitch) : null;
      const first = script(s).flights[0];
      if (!pitch || plate == null || first?.arc.kind !== "pitch") continue;
      const { from, to } = first.arc;
      const hand = first.point(first.start);
      const crossing = pitchPoint(first.arc.pitch, plate);
      if (Math.abs(hand.y - Ballpark.release) > 0.01 || Math.abs(crossing.x - pitch.plate[0]) > 1 / 12 || Math.abs(crossing.z - pitch.plate[1]) > 1 / 12 || Math.abs(first.end - first.start - (to - from)) > 0.001) {
        misses.push(s.text);
      }
      if (s.inPlay && (Math.abs(first.to.x - pitch.plate[0]) > 1 / 12 || Math.abs(first.to.z - pitch.plate[1]) > 1 / 12)) misses.push(`in play: ${s.text}`);
    }
    expect(misses).toEqual([]);
  });
  it("strike three: on past the plate into the catcher's mitt, where it pops", () => {
    const k = script(measured("4019080440902990057"));
    const first = k.flights[0]!;
    expect(first.arc.kind).toBe("pitch");
    expect(first.to.y).toBeLessThan(0);
    expect(first.to.z).toBeGreaterThanOrEqual(0.29);
    expect(Math.abs(k.flashes.find((f) => f.beat === "catchBall")!.at - first.end)).toBeLessThan(0.001);
  });
});

describe("without Statcast", () => {
  it("a measured play replays differently, and without its measurements exactly as ESPN's account alone always has", () => {
    const plain = script(scene("4019080441001990057"));
    const m = measured("4019080441001990057");
    expect(JSON.stringify(script(m))).not.toBe(JSON.stringify(plain));
    expect(JSON.stringify(script(m.copy({ measured: null })))).toBe(JSON.stringify(plain));
  });
  it("ESPN's plays alone draw no measured flight", () => {
    expect(scenes.map(script).every((s) => s.flights.every((f) => f.arc.kind !== "samples" && f.arc.kind !== "pitch"))).toBe(true);
  });
});

describe("on screen", () => {
  it("the stamp's readout: exit velocity, launch angle, distance; a grounder's without its first hop's distance; none unless measured", () => {
    expect(measured("4019080440101990057").readout).toBe("115.5 MPH · 10° · 302 FT");
    expect(measured("4019080440005990057").readout).toBe("67.0 MPH · −29°");
    expect(scene("4019080440101990057").readout).toBeNull();
    expect(measured("4019080440902990057").readout).toBeNull();
  });
  it("the camera keeps the play out of the taller stamp", () => {
    const s = script(measured("4019080440101990057"));
    const plain = script(scene("4019080440101990057"));
    expect(s.corner.height).toBeGreaterThan(plain.corner.height);
    expect(s.corner.width).toBeGreaterThanOrEqual(plain.corner.width);
  });
});
