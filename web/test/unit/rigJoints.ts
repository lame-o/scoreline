/**
 * The rig's joint limits (TheaterRigTests.swift `jointsBreak`, `jointsHold`),
 * shared by each theater's tests: knees and elbows only ever bend their own
 * way, and no further than they fold.
 */
import { dot, minus, norm, Rig, skeleton, type RigPose, type RigSkeleton, type RigVector } from "../../src/data/theater/rig";

/** Knees and elbows only ever bend their own way, and no further than they fold, in a skeleton. */
export function jointsHold(k: RigSkeleton): boolean {
  const knee = (hip: RigVector, knee: RigVector, foot: RigVector, forward: RigVector) => {
    // The knee stands out from the line between hip and foot on its forward side: bent, never bent back.
    const reach = minus(foot, hip);
    const l = Math.max(norm(reach), 1e-9);
    const line = { x: reach.x / l, y: reach.y / l, z: reach.z / l };
    const kh = minus(knee, hip);
    const along = dot(kh, line);
    const out = { x: kh.x - line.x * along, y: kh.y - line.y * along, z: kh.z - line.z * along };
    return dot(out, forward) >= -1e-9;
  };
  const elbow = (shoulder: RigVector, elbow: RigVector, hand: RigVector, axis: RigVector) => {
    const u = minus(elbow, shoulder);
    const f = minus(hand, elbow);
    const cross = { x: u.y * f.z - u.z * f.y, y: u.z * f.x - u.x * f.z, z: u.x * f.y - u.y * f.x };
    const cosine = dot(u, f) / Math.max(Math.sqrt(dot(u, u) * dot(f, f)), 1e-12);
    return dot(cross, axis) <= 1e-9 && Math.acos(Math.min(Math.max(cosine, -1), 1)) <= Rig.fold + 1e-6;
  };
  return (
    knee(k.hips[0], k.knees[0], k.feet[0], k.kneeForward[0]) &&
    knee(k.hips[1], k.knees[1], k.feet[1], k.kneeForward[1]) &&
    elbow(k.shoulders[0], k.elbows[0], k.hands[0], k.elbowAxis[0]) &&
    elbow(k.shoulders[1], k.elbows[1], k.hands[1], k.elbowAxis[1])
  );
}

/** Every figure of a replay, 30 frames a second and at rest, posed as the theater poses it: where the first whose knees or elbows break, if any. */
export function jointsBreak(duration: number, figures: number, pose: (i: number, t: number) => RigPose): string | null {
  const times: number[] = [];
  for (let k = 0; k / 30 <= duration; k++) times.push(k / 30);
  times.push(Infinity);
  for (const t of times) {
    for (let i = 0; i < figures; i++) if (!jointsHold(skeleton(pose(i, t)))) return `figure ${i} at ${t.toFixed(2)} s`;
  }
  return null;
}
