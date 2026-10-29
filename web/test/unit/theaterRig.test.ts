/**
 * The theaters' rig (TheaterRigTests.swift, check by check, the same
 * thresholds): feet that stay put while they're down, a stride that follows
 * speed, knees and elbows that only bend their own way, a heading that turns
 * at a limited rate, limbs that swap in front of and behind the body as it
 * turns past the camera, and the projections. Each sport's joint limits on
 * every fixture play are in its own theater's tests (rigJoints.ts).
 */
import { describe, expect, it } from "vitest";
import { Move } from "../../src/data/mlb/playScript";
import type { Ease, Point } from "../../src/data/mlb/theaterField";
import { Gridiron } from "../../src/data/theater/footballScript";
import { PitchFrame } from "../../src/data/theater/soccerScript";
import { PitchProjection } from "../../src/data/theater/soccerTheater";
import { gait, mix, remainder, Rig, rigArm, RigGait, rigPose, RigPoses, RigTrack, skeleton, vec, type RigMotion, type RigPose, type RigVector } from "../../src/data/theater/rig";
import { FieldProjection } from "../../src/features/game/core/theater/fieldProjection";
import { drawFigure, figureInks, nearest, RigLens, rigFigure } from "../../src/features/game/core/theater/rigFigure";
import { theaterInk } from "../../src/features/game/mlb/theater/theaterInk";
import type { Uniform } from "../../src/data/mlb/theaterTeams";
import { GridProjection } from "../../src/features/game/football/theater/drawFootball";

const height = 8.5;
const unit = 1.1 / height;

/** A figure running a straight line, diagonally, at `pace` heights a second (eased: from a standing start, peaking at it), and his track. */
function run(pace: number, length = 160, ease: Ease = "linear"): { move: Move; track: RigTrack } {
  const time = (length / (pace * height)) * (ease === "linear" ? 1 : 1.5);
  const move = new Move(0.3, 0.3 + time, [
    { x: 0, y: 0 },
    { x: length * 0.8, y: length * 0.6 },
  ], ease);
  const track = RigTrack.measure(0, move.end + 0.6, height, (t) => move.point(t), () => null);
  return { move, track };
}

/** The skeleton at t through the whole pipeline (standing pose, stride, IK), and each foot in the field. */
function feet(track: RigTrack, position: (t: number) => Point, t: number): [RigVector, RigVector] {
  const here = position(t);
  const m = track.motion(t);
  const planted = track.feet(t, here, m.heading, unit, m.speed, { left: RigPoses.stand.left, right: RigPoses.stand.right });
  const k = skeleton(mix(RigPoses.stand, gait(m, planted), m.weight));
  const world = (p: RigVector): RigVector => {
    const w = Rig.yaw(p, m.heading);
    return vec(here.x + w.x / unit, here.y + w.y / unit, w.z / unit);
  };
  return [world(k.feet[0]), world(k.feet[1])];
}

describe("the rig: planted feet", () => {
  it("a foot down stays put: under 3 mm of the field while it's down, walking to sprinting", () => {
    let worst = 0;
    let fewest = Infinity;
    const slips: string[] = [];
    for (const pace of [1.2, 3.0, 6.0, 9.0]) {
      const { move, track } = run(pace);
      let slip = 0;
      let stances = 0;
      for (const [side, steps] of [
        [0, track.left],
        [1, track.right],
      ] as const) {
        // Steps at full pace: from a third of the way in to a third from the end.
        for (const s of steps) {
          if (!(Number.isFinite(s.land) && Number.isFinite(s.lift))) continue;
          if (!(s.land > move.start + (move.end - move.start) * 0.3 && s.lift < move.end - (move.end - move.start) * 0.3)) continue;
          const span = s.lift - s.land;
          const a = s.land + span * 0.02;
          const b = s.lift - span * 0.02;
          stances++;
          const first = feet(track, (t) => move.point(t), a)[side];
          for (let k = 1; k <= 24; k++) {
            const q = feet(track, (t) => move.point(t), a + ((b - a) * k) / 24)[side];
            slip = Math.max(slip, Math.hypot(q.x - first.x, q.y - first.y), Math.abs(q.z));
          }
        }
      }
      worst = Math.max(worst, slip);
      fewest = Math.min(fewest, stances);
      slips.push(`${pace.toFixed(1)} H/s ${(slip * 304.8).toFixed(3)} mm over ${stances} stances`);
    }
    console.log(`    foot slip: ${slips.join(", ")}`);
    expect(worst * 304.8).toBeLessThan(3);
    expect(fewest).toBeGreaterThanOrEqual(4);
  });
});

describe("the rig: stride and cadence", () => {
  it("cadence and stride both grow with speed, and a stride is exactly the ground covered (no slide)", () => {
    const gaits = [1.0, 2.0, 4.0, 7.0, 10.0].map((pace) => {
      const { move, track } = run(pace, 260);
      const middle = track.left.filter((s) => s.land > move.start + (move.end - move.start) * 0.35 && s.land < move.end - (move.end - move.start) * 0.35);
      const first = middle[0];
      const last = middle[middle.length - 1];
      if (!first || !last || middle.length <= 2) return { cadence: 0, stride: 0, pace };
      const n = middle.length - 1;
      return { cadence: n / (last.land - first.land), stride: Math.hypot(last.at.x - first.at.x, last.at.y - first.at.y) / n / height, pace };
    });
    console.log(`    gait: ${gaits.map((g) => `${g.pace.toFixed(0)} H/s ${g.cadence.toFixed(2)} Hz × ${g.stride.toFixed(2)} H`).join(", ")}`);
    for (let i = 0; i + 1 < gaits.length; i++) {
      expect(gaits[i]!.cadence).toBeLessThan(gaits[i + 1]!.cadence);
      expect(gaits[i]!.stride).toBeLessThan(gaits[i + 1]!.stride);
    }
    for (const g of gaits) {
      expect(g.cadence).toBeGreaterThan(0);
      expect(Math.abs(g.cadence * g.stride - g.pace) / g.pace).toBeLessThan(0.03);
    }
    // The Mac's numbers (TheaterRigTests.swift's log): 1.65 Hz × 0.61 H … 3.71 Hz × 2.70 H.
    expect(gaits.map((g) => [+g.cadence.toFixed(2), +g.stride.toFixed(2)])).toEqual([
      [1.65, 0.61],
      [2.12, 0.94],
      [2.77, 1.44],
      [3.35, 2.09],
      [3.71, 2.7],
    ]);
  });

  it("walk, jog and sprint blend continuously: no threshold anywhere in the stride", () => {
    for (let i = 0; i < 1200; i++) {
      const a = i * 0.01;
      const b = (i + 1) * 0.01;
      expect(Math.abs(RigGait.cadence(b) - RigGait.cadence(a))).toBeLessThan(0.01);
      expect(Math.abs(RigGait.duty(b) - RigGait.duty(a))).toBeLessThan(0.01);
      expect(Math.abs(RigGait.run(b) - RigGait.run(a))).toBeLessThan(0.01);
    }
  });

  it("starting and stopping ease through a stride: standing at both ends, both feet down", () => {
    const { move, track } = run(4, 160, "inOut");
    const rest = track.motion(Infinity);
    const done = feet(track, (t) => move.point(t), Infinity);
    expect(rest.weight).toBe(0);
    expect(Math.abs(done[0].z)).toBeLessThan(1e-6);
    expect(Math.abs(done[1].z)).toBeLessThan(1e-6);
    expect(track.motion(0).weight).toBe(0);
  });
});

describe("the rig: heading", () => {
  it("the heading turns at no more than 11 rad/s, toward where he's running, then what he watches", () => {
    const out = new Move(0.2, 1.4, [
      { x: 0, y: 0 },
      { x: 60, y: 0 },
    ]);
    const back = new Move(1.4, 2.6, [
      { x: 60, y: 0 },
      { x: 0, y: 20 },
    ]);
    const turning = RigTrack.measure(0, 3, height, (t) => (t < 1.4 ? out.point(t) : back.point(t)), () => ({ point: { x: 0, y: -100 } }));
    const headings = Array.from({ length: 181 }, (_, i) => turning.motion(i / 60).heading);
    let fastest = 0;
    for (let i = 0; i + 1 < headings.length; i++) fastest = Math.max(fastest, Math.abs(remainder(headings[i + 1]! - headings[i]!, 2 * Math.PI)) * 60);
    console.log(`    turn: ${fastest.toFixed(1)} rad/s`);
    expect(fastest).toBeLessThanOrEqual(11.01);
    expect(Math.abs(remainder(turning.motion(2.0).heading - Math.atan2(20, -60), 2 * Math.PI))).toBeLessThan(0.05);
    expect(Math.abs(remainder(turning.motion(3).heading - Math.atan2(-100, 0), 2 * Math.PI))).toBeLessThan(0.05);
  });
});

describe("the rig: depth", () => {
  const size = { width: 640, height: 320 };
  const f = new FieldProjection(size, { x: 0, y: 30, span: 60 });
  const lens = RigLens.field(f, { x: 0, y: 30 });
  const motion = (heading: number, phase: number): RigMotion => ({ heading, phase, speed: 5, push: 0, weight: 1 });
  const striding = gait(motion(0, 0.1), { left: vec(0.12, 0.06, 0), right: vec(-0.16, -0.06, 0.18) });
  const leftInFront = (heading: number) => {
    const k = skeleton(striding);
    const figure = rigFigure(k, heading, lens);
    const front = (p: RigVector) => {
      const at = lens.point(Rig.yaw(p, heading));
      return figure.limbs.find((l) => l.end.x === at.x && l.end.y === at.y)?.front ?? false;
    };
    return { legs: front(k.feet[0]), arms: front(k.hands[0]) };
  };

  it("limbs sort by depth: his left side behind him facing right, in front facing left, swapping once as he turns past the camera", () => {
    const right = leftInFront(0);
    const left = leftInFront(Math.PI);
    // Turning from facing right through facing the camera to facing left, the left leg comes in front once, and stays.
    const sweep: boolean[] = [];
    for (let i = 0; i * 0.05 <= Math.PI; i++) sweep.push(leftInFront(-i * 0.05).legs);
    let swaps = 0;
    for (let i = 0; i + 1 < sweep.length; i++) if (sweep[i] !== sweep[i + 1]) swaps++;
    expect(right).toEqual({ legs: false, arms: false });
    expect(left).toEqual({ legs: true, arms: true });
    expect(swaps).toBe(1);
    expect(sweep[0]).toBe(false);
    expect(sweep[sweep.length - 1]).toBe(true);
  });

  it("…drawn far to near: the ones behind shaded, the ones in front in the jersey", () => {
    const limbs = rigFigure(striding, 0, lens).limbs;
    for (const l of limbs) expect(l.front ? l.shade === 0 : l.shade > 0).toBe(true);
    for (let i = 0; i + 1 < limbs.length; i++) expect(limbs[i]!.depth).toBeGreaterThanOrEqual(limbs[i + 1]!.depth);
  });

  it("running at the camera his stride goes toward and away from the lens: the feet apart in depth", () => {
    const toward = rigFigure(gait(motion(-Math.PI / 2, 0.1), { left: vec(0.18, 0.06, 0), right: vec(-0.18, -0.06, 0.05) }), -Math.PI / 2, lens);
    const ends = toward.limbs.filter((l) => Math.abs(l.root.y - toward.hip.y) < 2).map((l) => l.end);
    expect(ends.length).toBe(2);
    expect(Math.abs(ends[0]!.y - ends[1]!.y)).toBeGreaterThan(Math.abs(ends[0]!.x - ends[1]!.x));
  });
});

describe("the rig: projections", () => {
  // A field offset from where he stands lands where the field's own projection puts it: isometric exactly, perspective to a hair.
  const size = { width: 640, height: 320 };
  const offsets = [
    { x: 1.5, y: 0 },
    { x: 0, y: 1.5 },
    { x: -1, y: 1 },
  ];
  const gap = (lens: RigLens, p: Point, field: (q: Point) => Point) =>
    Math.max(
      ...offsets.map((d) => {
        const a = lens.point(vec(d.x * lens.unit, d.y * lens.unit, 0));
        const b = field({ x: p.x + d.x, y: p.y + d.y });
        return Math.hypot(a.x - b.x, a.y - b.y);
      }),
    );

  it("the rig projects through each theater's own lens: dimetric (ballpark, gridiron) exactly, perspective (stand, behind the goal) to a hair", () => {
    const f = new FieldProjection(size, { x: 0, y: 30, span: 60 });
    const spot = { x: 40, y: 70 };
    const iso = gap(RigLens.field(f, spot), spot, (q) => f.point(q));
    const g = new GridProjection(size, { x: 0, y: 40, span: 70 }, Gridiron.yaw);
    const grid = gap(RigLens.grid(g, { x: 10, y: 100 }), { x: 10, y: 100 }, (q) => g.point(q));
    const pitch = new PitchProjection(size, new PitchFrame({ x: 70, y: 30, span: 40 }));
    const near = { x: 80, y: 20 };
    const perspective = gap(RigLens.pitch(pitch, near), near, (q) => pitch.pointGround(q)) / Math.max(RigLens.pitch(pitch, near).height, 1);
    const behind = new PitchProjection(size, new PitchFrame({ x: 100, y: 34, span: 14 }, { kind: "behind", right: true }));
    const mouth = { x: 103, y: 36 };
    const reverse = gap(RigLens.pitch(behind, mouth), mouth, (q) => behind.pointGround(q)) / Math.max(RigLens.pitch(behind, mouth).height, 1);
    console.log(`    lens: ${iso.toPrecision(2)}, ${grid.toPrecision(2)}, ${perspective.toFixed(3)}, ${reverse.toFixed(3)} of his height`);
    expect(iso).toBeLessThan(1e-6);
    expect(grid).toBeLessThan(1e-6);
    expect(perspective).toBeLessThan(0.03);
    expect(reverse).toBeLessThan(0.03);
    expect(RigLens.pitch(pitch, near).height).toBe(pitch.figure(near));
  });
});

describe("drawn", () => {
  const f = new FieldProjection({ width: 640, height: 320 }, { x: 0, y: 30, span: 60 });
  const lens = RigLens.field(f, { x: 0, y: 30 });
  const facing = -Math.PI / 2;
  const overHead = (pose: RigPose) => {
    const k = skeleton(pose);
    const figure = rigFigure(k, facing, lens);
    const hands = [k.hands[0], k.hands[1]].map((p) => lens.point(Rig.yaw(p, facing)));
    return figure.limbs.map((l) => ({
      arm: hands.some((h) => h.x === l.end.x && h.y === l.end.y),
      crosses: Math.min(nearest(figure.head, l.root, l.joint)[0], nearest(figure.head, l.joint, l.end)[0]) < figure.headRadius + figure.limb / 2,
      under: l.underHead,
    }));
  };

  it("facing the camera, the head goes over hands cocked behind it and arms raised beside it, under an arm across its face; clear of it, neither", () => {
    const cocked = overHead(rigPose({ lean: -0.18, leftArm: rigArm({ swing: 3.0, spread: 0.18, turn: -0.2, bend: 0.8 }), rightArm: rigArm({ swing: 3.0, spread: 0.18, turn: -0.2, bend: 0.8 }) }));
    const raised = overHead(rigPose({ leftArm: rigArm({ swing: 3.05, spread: 0.1, turn: -0.1, bend: 0.06 }), rightArm: rigArm({ swing: 3.05, spread: 0.1, turn: -0.1, bend: 0.06 }) }));
    const across = overHead(rigPose({ lean: -0.06, rightArm: rigArm({ swing: 2.85, spread: 0.08, turn: -0.1, bend: 0.1 }) }));
    const standing = overHead(RigPoses.stand);
    expect(cocked.filter((l) => l.arm).every((l) => l.crosses && l.under)).toBe(true);
    expect(raised.filter((l) => l.arm).every((l) => l.crosses && l.under)).toBe(true);
    expect(across.some((l) => l.arm && l.crosses && !l.under)).toBe(true);
    expect(standing.every((l) => !l.crosses && !l.under)).toBe(true);
    expect([...cocked, ...raised, ...across, ...standing].every((l) => l.crosses || !l.under)).toBe(true);
  });

  /** The calls a figure's drawing makes: what's filled and stroked in which ink, and whether it's clipped. */
  const plain: Uniform = { jersey: "#ffffff", cap: "#ff0000", piping: null, accent: null };
  function record(pose: RigPose, heading: number, height: number, opacity: number, uniform: Uniform = plain) {
    const k = height / lens.height;
    const big = new RigLens({ x: 60, y: 108 }, { x: lens.x.x * k, y: lens.x.y * k }, { x: lens.y.x * k, y: lens.y.y * k }, { x: lens.z.x * k, y: lens.z.y * k }, lens.unit, lens.view, height);
    const calls: { op: "fill" | "stroke"; ink: string; clipped: boolean; alpha: number }[] = [];
    let depth = 0;
    const clips: number[] = [];
    const ctx = {
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      lineCap: "butt",
      lineJoin: "miter",
      globalAlpha: 1,
      beginPath() {},
      moveTo() {},
      lineTo() {},
      arc() {},
      ellipse() {},
      closePath() {},
      save() {
        depth++;
      },
      restore() {
        depth--;
        while (clips.length && clips[clips.length - 1]! > depth) clips.pop();
      },
      clip() {
        clips.push(depth);
      },
      fill() {
        calls.push({ op: "fill", ink: this.fillStyle, clipped: clips.length > 0, alpha: this.globalAlpha });
      },
      stroke() {
        calls.push({ op: "stroke", ink: this.strokeStyle, clipped: clips.length > 0, alpha: this.globalAlpha });
      },
    };
    const inks = figureInks(uniform, theaterInk("dark"));
    drawFigure(ctx as unknown as CanvasRenderingContext2D, rigFigure(pose, heading, big), inks, height, opacity);
    return { calls, inks, alpha: ctx.globalAlpha, depth };
  }

  const striding = gait({ heading: 0, phase: 0.1, speed: 5, push: 0, weight: 1 }, { left: vec(0.12, 0.06, 0), right: vec(-0.16, -0.06, 0.18) });
  const poses: [RigPose, number][] = [
    [RigPoses.stand, facing],
    [striding, 0],
    [striding, Math.PI * 0.75],
    [RigPoses.catchHigh, facing],
    [RigPoses.release, -0.6],
  ];

  it("the outline is one shape: filled once, never stroked part by part, so it's never darker where the parts meet", () => {
    for (const [pose, heading] of poses) {
      for (const height of [60, 12]) {
        const { calls, inks } = record(pose, heading, height, 1);
        expect(calls.filter((c) => c.ink === inks.rim).map((c) => c.op)).toEqual(["fill"]);
        expect(calls[0]).toMatchObject({ op: "fill", ink: inks.rim });
      }
    }
  });

  it("a limb in front crosses what's drawn already with one fine line, kept to it (never over the outline), and only on a figure big enough to carry it", () => {
    let lines = 0;
    for (const [pose, heading] of poses) {
      const big = record(pose, heading, 60, 1);
      const inner = big.calls.filter((c) => c.ink === big.inks.inner);
      expect(inner.every((c) => c.op === "fill" && c.clipped)).toBe(true);
      lines += inner.length;
      expect(big.alpha).toBe(1);
      expect(big.depth).toBe(0);
      const small = record(pose, heading, 12, 1);
      expect(small.calls.some((c) => c.ink === small.inks.inner)).toBe(false);
    }
    expect(lines).toBeGreaterThan(0);
  });

  it("an official's kit: stripes down the body and the sleeves, slacks of their own, all inside the outline; a plain uniform as it was", () => {
    const zebra: Uniform = { ...plain, stripes: "#000000" };
    const slacks: Uniform = { ...plain, legs: "#000000" };
    for (const [pose, heading] of poses) {
      for (const height of [60, 12]) {
        const p = record(pose, heading, height, 1);
        const z = record(pose, heading, height, 1, zebra);
        const t = record(pose, heading, height, 1, slacks);
        // The stripes: strokes in their ink, every one kept to its part; none on a plain jersey.
        expect(z.calls.some((c) => c.op === "stroke" && c.ink === "#000000")).toBe(true);
        expect(z.calls.filter((c) => c.ink === "#000000").every((c) => c.op === "stroke" && c.clipped)).toBe(true);
        expect(p.calls.some((c) => c.ink === "#000000")).toBe(false);
        // The slacks: the legs stroked in their own color.
        expect(t.calls.some((c) => c.op === "stroke" && c.ink === "#000000" && !c.clipped)).toBe(true);
        // The outline the same shape, filled once, first, either way.
        for (const r of [z, t]) expect(r.calls.filter((c) => c.ink === r.inks.rim)).toEqual([p.calls[0]]);
        // No kit at all draws exactly as before.
        expect(record(pose, heading, height, 1, { ...plain, stripes: null, legs: null }).calls).toEqual(p.calls);
      }
    }
  });
});
