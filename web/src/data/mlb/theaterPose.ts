/**
 * Baseball's poses beyond the shared ones (PlayTheater.swift's `RigPose`
 * extension), for a right-hander (a lefty's are `mirrored`), relative to his
 * heading: the batter faces the plate, the pitcher home, the catcher his
 * pitcher, a fielder his throw. The rig itself (the skeleton, the stride, the
 * shared poses) is data/theater/rig.ts; how the theater picks a pose at t is
 * features/game/mlb/theater/drawTheater.ts `pose`.
 */
import { rigArm, rigPose, vec } from "../theater/rig";

export const BaseballPoses = {
  /** The catcher's squat, the mitt up as a target. */
  squat: rigPose({
    hip: vec(-0.05, 0, 0.18),
    lean: 0.3,
    left: vec(0.05, 0.17, 0),
    right: vec(0.05, -0.17, 0),
    knees: 0.6,
    leftArm: rigArm({ swing: 1.3, spread: 0.3, turn: -0.3, bend: 1.2 }),
    rightArm: rigArm({ swing: 0.55, spread: 0.25, turn: 0, bend: 1.3 }),
  }),
  /** Leading off: low and wide, side-on to the next base, watching the pitcher. */
  lead: rigPose({
    hip: vec(0, 0, 0.39),
    lean: 0.4,
    left: vec(0.02, 0.17, 0),
    right: vec(0.02, -0.17, 0),
    knees: 0.35,
    leftArm: rigArm({ swing: 0.45, spread: 0.32, turn: -0.15, bend: 0.6 }),
    rightArm: rigArm({ swing: 0.45, spread: 0.32, turn: -0.15, bend: 0.6 }),
  }),
  /** Feet first: leaning back, the lead leg out along the dirt, the other folded under, a hand up. */
  slide: rigPose({
    hip: vec(-0.12, 0, 0.09),
    lean: -1.25,
    left: vec(0.42, 0.04, 0.02),
    right: vec(0.14, -0.07, 0),
    knees: 0.15,
    leftArm: rigArm({ swing: 2.45, spread: 0, turn: 0.5, bend: 0.3 }),
    rightArm: rigArm({ swing: 0.9, spread: 0.45, turn: 0.2, bend: 0.4 }),
  }),

  // The pitcher's delivery, facing home: set side-on (his glove side to the
  // plate), the leg kick, the stride with the arm cocked, the release over the
  // top, the follow-through with the back leg up behind him, and square to the
  // plate where he landed, ready to field.
  set: rigPose({
    turn: -1.5,
    hip: vec(0, 0, 0.485),
    left: vec(0.07, 0.01, 0),
    right: vec(-0.07, -0.01, 0),
    leftArm: rigArm({ swing: 0.8, spread: 0.1, turn: -0.55, bend: 1.6 }),
    rightArm: rigArm({ swing: 0.75, spread: 0.1, turn: -0.6, bend: 1.65 }),
  }),
  kick: rigPose({
    turn: -1.85,
    hip: vec(-0.03, 0, 0.49),
    lean: -0.12,
    left: vec(0.0, 0.04, 0.33),
    right: vec(-0.06, -0.01, 0),
    knees: 0.05,
    leftArm: rigArm({ swing: 1.0, spread: 0.08, turn: -0.6, bend: 1.75 }),
    rightArm: rigArm({ swing: 0.95, spread: 0.08, turn: -0.65, bend: 1.8 }),
  }),
  stride: rigPose({
    turn: -1.35,
    hip: vec(0.24, -0.03, 0.38),
    twist: -0.5,
    left: vec(0.52, -0.1, 0),
    right: vec(-0.07, -0.01, 0),
    knees: 0.15,
    leftArm: rigArm({ swing: 1.45, spread: 0.3, turn: 1.2, bend: 0.2 }),
    rightArm: rigArm({ swing: 1.4, spread: 0.2, turn: 1.9, bend: 1.7 }),
  }),
  deliver: rigPose({
    turn: -0.85,
    hip: vec(0.36, -0.05, 0.36),
    lean: 0.55,
    twist: 0.5,
    left: vec(0.52, -0.1, 0),
    right: vec(0.0, -0.04, 0.12),
    knees: 0.15,
    leftArm: rigArm({ swing: 0.5, spread: 0.2, turn: -0.4, bend: 1.8 }),
    rightArm: rigArm({ swing: 2.7, spread: 0.25, turn: -0.1, bend: 0.4 }),
  }),
  follow: rigPose({
    turn: -0.35,
    hip: vec(0.43, -0.06, 0.36),
    lean: 0.95,
    twist: 0.4,
    left: vec(0.52, -0.1, 0),
    right: vec(0.17, 0.08, 0.3),
    knees: 0.2,
    leftArm: rigArm({ swing: -0.4, spread: 0.3, turn: 0.2, bend: 1.2 }),
    rightArm: rigArm({ swing: 0.4, spread: 0.0, turn: -0.9, bend: 0.35 }),
  }),
  fielding: rigPose({
    hip: vec(0.44, -0.24, 0.41),
    lean: 0.55,
    left: vec(0.52, -0.1, 0),
    right: vec(0.42, -0.4, 0),
    knees: 0.4,
    leftArm: rigArm({ swing: 0.4, spread: 0.3, turn: -0.35, bend: 0.65 }),
    rightArm: rigArm({ swing: 0.4, spread: 0.3, turn: -0.35, bend: 0.65 }),
  }),

  // The batter, facing the plate (a right-hander's front shoulder, his left,
  // to the pitcher): the stance, wide and coiled, the hands by his back
  // shoulder; the bat through the zone, the hips open, the back foot up on its
  // toe; the finish over the front shoulder.
  stance: rigPose({
    hip: vec(-0.04, -0.02, 0.4),
    lean: 0.35,
    roll: -0.05,
    twist: -0.35,
    left: vec(-0.08, 0.25, 0),
    right: vec(0.03, -0.21, 0),
    knees: 0.3,
    leftArm: rigArm({ swing: 1.2, spread: 0.0, turn: -1.3, bend: 1.2 }),
    rightArm: rigArm({ swing: 0.9, spread: 0.9, turn: -0.4, bend: 2.2 }),
  }),
  contact: rigPose({
    turn: 0.9,
    hip: vec(-0.02, 0.06, 0.4),
    lean: 0.3,
    twist: 0.25,
    left: vec(-0.06, 0.27, 0),
    right: vec(0.02, -0.17, 0.05),
    knees: 0.45,
    leftArm: rigArm({ swing: 1.3, spread: 0.0, turn: -0.35, bend: 0.1 }),
    rightArm: rigArm({ swing: 1.1, spread: 0.0, turn: -0.75, bend: 0.5 }),
  }),
  finish: rigPose({
    turn: 1.35,
    hip: vec(-0.02, 0.08, 0.43),
    lean: 0.12,
    twist: 0.55,
    left: vec(-0.06, 0.27, 0),
    right: vec(0.1, -0.08, 0.1),
    knees: 0.6,
    leftArm: rigArm({ swing: 2.2, spread: 0.6, turn: 1.0, bend: 1.8 }),
    rightArm: rigArm({ swing: 2.0, spread: 0.15, turn: -1.0, bend: 1.4 }),
  }),
};
