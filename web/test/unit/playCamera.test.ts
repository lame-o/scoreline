/**
 * The play theater as a broadcast (PlayBroadcastTests.swift): the camera per
 * shot (tight on the battery, riding a grounder on the infield, widening
 * with a fly, chasing a home run to the wall and cutting to the trot,
 * framing each throw, resting exactly where it rests between plays), never
 * faster than its caps, and never parking anyone under the scorer's mark.
 */
import { describe, expect, it } from "vitest";
import { BATTERY, CameraFrame, restCamera } from "../../src/data/mlb/playCamera";
import { parse, type PlayScene, type SideOf } from "../../src/data/mlb/playScene";
import { PlayScript } from "../../src/data/mlb/playScript";
import { fieldPoint, type FieldPoint } from "../../src/data/mlb/theaterField";
import { fixture } from "./fixtures";

const g3 = fixture("mlb-ws-g3-plays.json") as { items: unknown[]; names: Record<string, string> };
const plays = g3.items;
const names = g3.names;
const side: SideOf = (id) => (id === "8" ? "top" : id === "30" ? "bottom" : null);
const idOf = (p: unknown) => (p as { id?: string }).id;
const typeOf = (p: unknown) => (p as { type?: { type?: string } }).type?.type;
const scene = (id: string) => parse(plays, plays.findIndex((p) => idOf(p) === id), side, names)!;
const g2 = (fixture("mlb-ws-g2-summary-plays.json") as { plays: unknown[] }).plays;
const homer = parse(g2, g2.findIndex((p) => idOf(p) === "4019080430005990057"), (id) => (id === "30" ? "top" : "bottom"))!;

const script = (s: PlayScene) => PlayScript.play(s, { bases: s.endsInning ? [false, false, false] : s.basesAfter, bats: "R", swapped: s.endsInning });

/** Where a point sits in the view, as fractions across and up. */
const view = (p: FieldPoint, c: CameraFrame) => ({ x: 0.5 + (p.x - c.x) / (c.span * CameraFrame.aspect), y: 0.5 + (p.y * 0.5 + p.z * 0.82 - c.y) / c.span });
const inView = (p: FieldPoint, c: CameraFrame, slack = 0) => {
  const v = view(p, c);
  return v.x >= -slack && v.x <= 1 + slack && v.y >= -slack && v.y <= 1 + slack;
};
const range = (from: number, to: number, step: number) => {
  const out: number[] = [];
  for (let t = from; t <= to + 1e-9; t += step) out.push(t);
  return out;
};

describe("camera, shot by shot", () => {
  it("a 6-3: tight on the battery through the pitch, riding the grounder on the infield, settling exactly at rest", () => {
    const s = script(scene("4019080440005990057"));
    const battery = s.camera.frame(0);
    expect(battery.span).toBeLessThan(60);
    expect(BATTERY.every((p) => inView(p, battery))).toBe(true);
    const pitch = s.camera.frame(s.release! + 0.2);
    expect(Math.abs(pitch.span - battery.span)).toBeLessThan(1);
    expect(Math.hypot(pitch.x - battery.x, pitch.y - battery.y)).toBeLessThan(1);
    const flight = s.flights[s.batted ?? 0]!;
    const riding = range(flight.start, flight.end, 1 / 60).map((t) => s.camera.frame(t));
    expect(riding.every((f) => f.span < 140 && f.y < 90 && Math.abs(f.x) < 100)).toBe(true);
    expect(range(flight.start, flight.end, 1 / 30).every((t) => inView(flight.point(t), s.camera.frame(t), 0.02))).toBe(true);
    expect(CameraFrame.equal(s.camera.frame(s.duration), restCamera())).toBe(true);
    expect(CameraFrame.equal(s.camera.frame(Infinity), restCamera())).toBe(true);
  });
  it("a fly widens with its height and distance, keeping the ball in frame, and the right fielder at the catch", () => {
    const s = script(scene("4019080440102990057"));
    const flight = s.flights[s.batted!]!;
    const frames = range(flight.start, flight.end, 1 / 60).map((t) => [t, s.camera.frame(t)] as const);
    const widest = Math.max(...frames.map(([, f]) => f.span));
    expect(widest).toBeGreaterThan(s.camera.frame(0).span * 1.6);
    const seen = frames.filter(([t, f]) => inView(flight.point(t), f, 0.03)).length;
    expect(seen / frames.length).toBeGreaterThan(0.9);
    expect(inView(fieldPoint(s.actors[8]!.position(flight.end)), s.camera.frame(flight.end))).toBe(true);
  });
  it("a pop-up: the shortstop in frame as he squeezes it", () => {
    const s = script(scene("4019080440004990057"));
    const flight = s.flights[s.batted!]!;
    expect(inView(fieldPoint(s.actors[5]!.position(flight.end)), s.camera.frame(flight.end))).toBe(true);
  });
  it("throws: each one framed end to end (4 to 6, 6 to 3), after closing in on the second baseman", () => {
    const s = script(scene("4019080441102990057"));
    const framed = s.flights.every((f, i) => {
      if (i <= (s.batted ?? 0)) return true;
      const mid = s.camera.frame((f.start + f.end) / 2 + 0.15);
      return inView(f.from, mid, 0.02) && inView(f.to, mid, 0.02);
    });
    expect(framed).toBe(true);
    const flight = s.flights[s.batted ?? 0]!;
    expect(inView(fieldPoint(s.actors[3]!.position(flight.end)), s.camera.frame(flight.end))).toBe(true);
    expect(s.camera.frame(flight.end).span).toBeLessThan(s.camera.frame(s.duration).span);
  });
  it("a home run: the camera chases it to the wall it clears, then cuts to the trot", () => {
    const s = script(homer);
    const fence = s.fence!;
    const at = s.camera.frame(fence.at);
    expect(inView(fence.point, at)).toBe(true);
    expect(at.span).toBeLessThan(140);
    const cut = s.shots.find((x) => x.cut)!;
    const before = s.camera.frame(cut.from - 1 / 60);
    const after = s.camera.frame(cut.from + 1 / 60);
    expect(Math.hypot(before.x - after.x, before.y - after.y)).toBeGreaterThan(50);
    expect(inView(fieldPoint(s.actors[9]!.position(cut.from + 0.2)), s.camera.frame(cut.from + 0.2))).toBe(true);
  });
});

describe("never seasick", () => {
  const all = [...plays.flatMap((p, i) => (typeOf(p) === "play-result" ? (parse(plays, i, side, names) ?? []) : [])), homer].map(script);

  it("the camera never outruns its caps on any play: pans ≤ 1.4 view-heights/s, zooms in ≤ ×3/s, out ≤ ×9/s", () => {
    let pan = 0;
    let closer = 0;
    let wider = 0;
    for (const s of all) {
      const cuts = s.shots.filter((x) => x.cut).map((x) => x.from);
      let previous = s.camera.frame(0);
      for (let i = 1; i <= Math.trunc(s.duration * 60); i++) {
        const t = i / 60;
        const now = s.camera.frame(t);
        if (cuts.some((c) => c > t - 1 / 30 && c <= t + 1 / 60)) {
          previous = now;
          continue;
        }
        const p = (Math.hypot(now.x - previous.x, now.y - previous.y) * 60) / now.span;
        const z = Math.log(now.span / previous.span) * 60;
        expect(Number.isFinite(p) && Number.isFinite(z)).toBe(true);
        pan = Math.max(pan, p);
        closer = Math.max(closer, -z);
        wider = Math.max(wider, z);
        previous = now;
      }
    }
    expect(pan).toBeLessThanOrEqual(1.5);
    expect(closer).toBeLessThanOrEqual(1.2);
    expect(wider).toBeLessThanOrEqual(2.3);
  });
  it("at rest the scorer's mark's corner is clear of every figure", () => {
    const rest = restCamera();
    for (const s of all.filter((x) => Number.isFinite(x.stamp))) {
      for (const a of s.actors.filter((x) => x.opacity(s.duration) > 0.5)) {
        const v = view(fieldPoint(a.position(s.duration)), rest);
        expect(v.x - 6 / (rest.span * 2) < s.corner.width && v.y - 3 / rest.span < s.corner.height).toBe(false);
      }
    }
  });
});
