/**
 * The theater bench's continuity meter (TheaterBenchMeter.swift; CHOREOGRAPHY
 * §9.2): what a theater presented, frame by frame at 60 Hz in the world frame
 * (every figure, the ball, the camera), measured against the human limits and
 * the rule that nothing jumps outside a declared jump. The same numbers as
 * the Mac's, so the gates mean the same thing.
 */
import { RigGait, remainder } from "../../src/data/theater/rig";
import type { Band, Vec4 } from "../../src/data/theater/theaterEngine";

export interface MeterFigure {
  /** The same man from frame to frame. */
  key: number;
  position: { x: number; y: number };
  heading: number;
  band: Band;
  /** His feet in the world (z: off the ground), and whether each is planted, with the gait's weight. */
  feet?: { left: { x: number; y: number; z: number }; right: { x: number; y: number; z: number } } | null;
  planted?: { left: boolean; right: boolean };
  weight?: number;
  /** The rig's height (feet a figure stands): a slip's millimetres are on a 1.8 m man. */
  height?: number;
  opacity?: number;
  /** What moves him now (a clip's kind, or a splice's travel): the report splits speed by it. */
  source?: string;
  /** The rig's own planted feet in the world (the stride before any pose blends it), for the spec's footSlip. */
  rigFeet?: { left: { x: number; y: number }; right: { x: number; y: number } } | null;
}

export type MeterChange = "same" | "hardCut" | "crossfade" | "declared";

export interface MeterFrame {
  t: number;
  figures: MeterFigure[];
  camera?: Vec4 | null;
  change?: MeterChange;
  reason?: string | null;
}

export class ContinuityReport {
  label = "";
  frames = 0;
  seconds = 0;
  hardCuts = 0;
  hardCutReasons = new Map<string, number>();
  crossfades = 0;
  hiddenTeleport = 0;
  teleportMax = 0;
  teleportMaxDistance = 0;
  actorSeconds = 0;
  overSpeedSeconds = 0;
  maxOverspeed = 0;
  overAccelSeconds = 0;
  overTurnSeconds = 0;
  movingSeconds = 0;
  footSlipMax = 0;
  footSlipFrames = 0;
  footSlipAcrossChanges = 0;
  cameraPanMax = 0;
  cameraYawJumpMax = 0;
  yawSpeedMax = 0;
  cameraJumps = 0;
  decisiveErrors: number[] = [];
  catchUps: number[] = [];
  notes: string[] = [];
  overSpeedBySource = new Map<string, number>();
  overSpeed12BySource = new Map<string, number>();
  maxOverspeedBySource = new Map<string, number>();
  overAccelBySource = new Map<string, number>();
  secondsBySource = new Map<string, number>();
  rigSlipMax = 0;
  rigSlipFrames = 0;
  jumpLog: string[] = [];
  glideFrames = 0;

  get speedShare(): number {
    return this.actorSeconds > 0 ? this.overSpeedSeconds / this.actorSeconds : 0;
  }

  get accelShare(): number {
    return this.actorSeconds > 0 ? this.overAccelSeconds / this.actorSeconds : 0;
  }

  get turnShare(): number {
    return this.movingSeconds > 0 ? this.overTurnSeconds / this.movingSeconds : 0;
  }
}

const bump = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);

/** Feeds frames in order; reads the report at the end. */
export class ContinuityMeter {
  readonly report = new ContinuityReport();
  private previous: MeterFrame | null = null;
  private before: MeterFrame | null = null;

  constructor(label: string) {
    this.report.label = label;
  }

  add(frame: MeterFrame): void {
    const report = this.report;
    const change = frame.change ?? "same";
    report.frames += 1;
    const prev = this.previous;
    const finish = () => {
      this.before = this.previous;
      this.previous = frame;
    };
    if (!prev) return finish();
    const dt = frame.t - prev.t;
    if (!(dt > 1e-6)) return finish();
    report.seconds += dt;
    const byKey = new Map<number, MeterFigure>();
    for (const f of prev.figures) if (!byKey.has(f.key)) byKey.set(f.key, f);
    const older = new Map<number, MeterFigure>();
    for (const f of this.before?.figures ?? []) if (!older.has(f.key)) older.set(f.key, f);
    const prevChange = prev.change ?? "same";
    const beforeChange = this.before?.change ?? "same";
    // How far each man moved, against what a man can. A jump is a frame's move far past both the cap and the man's
    // own move the frame before (a discontinuity); a sustained superhuman run is a glide.
    let jump = 0;
    let jumpDistance = 0;
    for (const f of frame.figures) {
      if (!((f.opacity ?? 1) > 0.05)) continue;
      const p = byKey.get(f.key);
      if (!p || !((p.opacity ?? 1) > 0.05)) continue;
      const d = Math.hypot(f.position.x - p.position.x, f.position.y - p.position.y);
      const cap = f.band.sprint * (1 + f.band.overspeed);
      const ratio = d / Math.max(cap * dt, 1e-9);
      const q = older.get(f.key);
      const was = q ? Math.hypot(p.position.x - q.position.x, p.position.y - q.position.y) : null;
      if (ratio > 1.5 && change === "same" && was != null && d < 2.5 * Math.max(was, 1e-9)) report.glideFrames += 1;
      const discontinuous = was != null ? d > 2.5 * Math.max(was, cap * dt * 0.25) : true;
      if ((discontinuous || change !== "same") && ratio > jump) {
        jump = ratio;
        jumpDistance = d;
      }
      if (ratio > report.teleportMax && change === "same") {
        report.teleportMax = ratio;
        report.teleportMaxDistance = d;
      }
      if (ratio > 1.5 && discontinuous && change === "same" && report.jumpLog.length < 40) {
        report.jumpLog.push(`t=${frame.t.toFixed(2)} key=${f.key} d=${d.toFixed(2)} ${frame.reason ?? ""} · ${f.source ?? ""} (was ${p.source ?? ""})`);
      }
      const source = f.source ?? "";
      if (change === "same") {
        report.actorSeconds += dt;
        bump(report.secondsBySource, source, dt);
        const v = d / dt;
        if (v > f.band.sprint * 1.001) {
          report.overSpeedSeconds += dt;
          bump(report.overSpeedBySource, source, dt);
          report.maxOverspeed = Math.max(report.maxOverspeed, v / f.band.sprint - 1);
          report.maxOverspeedBySource.set(source, Math.max(report.maxOverspeedBySource.get(source) ?? 0, v / f.band.sprint - 1));
          if (v > f.band.sprint * 1.12) bump(report.overSpeed12BySource, source, dt);
        }
        if (q && (beforeChange === "same" || prevChange === "same")) {
          const dt0 = prev.t - (this.before?.t ?? prev.t);
          if (dt0 > 1e-6) {
            const v1x = (f.position.x - p.position.x) / dt;
            const v1y = (f.position.y - p.position.y) / dt;
            const v0x = (p.position.x - q.position.x) / dt0;
            const v0y = (p.position.y - q.position.y) / dt0;
            const ax = (v1x - v0x) / ((dt + dt0) / 2);
            const ay = (v1y - v0y) / ((dt + dt0) / 2);
            const mx = (v1x + v0x) / 2;
            const my = (v1y + v0y) / 2;
            const speed = Math.hypot(mx, my);
            let over = false;
            if (speed > 0.5) {
              const along = (ax * mx + ay * my) / speed;
              const across = Math.hypot(ax - (along * mx) / speed, ay - (along * my) / speed);
              over = along > f.band.accel * 1.001 || -along > f.band.decel * 1.001 || across > f.band.lateral * 1.001;
            } else {
              over = Math.hypot(ax, ay) > Math.max(f.band.accel, f.band.decel) * 1.001;
            }
            if (over) {
              report.overAccelSeconds += dt;
              bump(report.overAccelBySource, source, dt);
            }
          }
        }
        // Turning: the rig's own cap (11 − 5·run rad/s, speed in heights a second), while faster than a jog.
        if (v > f.band.jog) {
          report.movingSeconds += dt;
          const turn = Math.abs(remainder(f.heading - p.heading, 2 * Math.PI)) / dt;
          const cap2 = 11 - 5 * RigGait.run(v / Math.max(f.height ?? 1, 1e-6));
          if (turn > cap2 * 1.05) report.overTurnSeconds += dt;
        }
      }
      const height = Math.max(f.height ?? 1, 1e-6);
      const weightNow = f.weight ?? 0;
      const weightWas = p.weight ?? 0;
      // The rig's own planted foot (the stride itself).
      if (f.rigFeet && p.rigFeet && weightNow > 0.5 && weightWas > 0.5) {
        const sides = [
          [f.rigFeet.left, p.rigFeet.left, (f.planted?.left ?? false) && (p.planted?.left ?? false)],
          [f.rigFeet.right, p.rigFeet.right, (f.planted?.right ?? false) && (p.planted?.right ?? false)],
        ] as const;
        for (const [now, was2, down] of sides) {
          if (!down) continue;
          const slip = (Math.hypot(now.x - was2.x, now.y - was2.y) / height) * 1800;
          report.rigSlipMax = Math.max(report.rigSlipMax, slip);
          if (slip > 0.5) report.rigSlipFrames += 1;
        }
      }
      // A planted foot must stay where it was planted (as drawn, the pose's blends included).
      if (f.feet && p.feet && weightNow > 0.5 && weightWas > 0.5) {
        const sides = [
          [f.feet.left, p.feet.left, (f.planted?.left ?? false) && (p.planted?.left ?? false)],
          [f.feet.right, p.feet.right, (f.planted?.right ?? false) && (p.planted?.right ?? false)],
        ] as const;
        for (const [now, was2, down] of sides) {
          if (!down) continue;
          const slip = (Math.hypot(now.x - was2.x, now.y - was2.y) / height) * 1800;
          report.footSlipMax = Math.max(report.footSlipMax, slip);
          if (slip > 0.5) report.footSlipFrames += 1;
          if (change !== "same") report.footSlipAcrossChanges = Math.max(report.footSlipAcrossChanges, slip);
        }
      }
    }
    // The camera: a pan of more than 0.2 view heights, or 5° of yaw, in one frame is a cut.
    let cameraCut = false;
    const c = frame.camera;
    const pc = prev.camera;
    if (c && pc) {
      const span = Math.exp((c.z + pc.z) / 2);
      const dx = c.x - pc.x;
      const dy = c.y - pc.y;
      const yaw = c.w;
      // Across the view (x) and up it (y halved by the dimetric view), in view heights.
      const across = dx * Math.cos(yaw) + dy * Math.sin(yaw);
      const up = (-dx * Math.sin(yaw) + dy * Math.cos(yaw)) * 0.5;
      const pan = Math.sqrt(across * across + up * up) / span;
      const zoom = Math.abs(c.z - pc.z);
      const yawStep = Math.abs(remainder(c.w - pc.w, 2 * Math.PI));
      const rate = yawStep / dt;
      if (change === "same") {
        report.cameraPanMax = Math.max(report.cameraPanMax, pan);
        report.cameraYawJumpMax = Math.max(report.cameraYawJumpMax, (yawStep * 180) / Math.PI);
        report.yawSpeedMax = Math.max(report.yawSpeedMax, (rate * 180) / Math.PI);
      }
      cameraCut = pan > 0.2 || yawStep > (5 * Math.PI) / 180 || zoom > Math.log(1.25);
      if (cameraCut && (change === "same" || change === "hardCut")) report.cameraJumps += 1;
    }
    const figureCut = jump > 1.5;
    switch (change) {
      case "same":
        if (figureCut || cameraCut) {
          report.hardCuts += 1;
          bump(report.hardCutReasons as Map<string, number>, frame.reason ?? (figureCut ? "a figure jumped" : "the camera jumped"), 1);
        }
        break;
      case "hardCut":
        if (figureCut || cameraCut || frame.figures.length !== prev.figures.length) {
          report.hardCuts += 1;
          bump(report.hardCutReasons as Map<string, number>, frame.reason ?? "scene swap", 1);
        }
        break;
      case "crossfade":
        report.crossfades += 1;
        report.hiddenTeleport = Math.max(report.hiddenTeleport, jumpDistance);
        break;
      case "declared":
        break;
    }
    finish();
  }
}

/** The q-quantile of a list (Stats.quantile: linear between order statistics). */
export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const x = q * (s.length - 1);
  const lo = Math.floor(x);
  const hi = Math.min(lo + 1, s.length - 1);
  return s[lo]! + (s[hi]! - s[lo]!) * (x - lo);
}
