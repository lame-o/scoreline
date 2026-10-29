/**
 * Baseball's poses beyond the shared ones (PlayTheater.swift's `RigPose`
 * extension), for a right-hander (a lefty's are `mirrored`), relative to his
 * heading: the batter faces the plate, the pitcher home, the catcher his
 * pitcher, a fielder his throw. The rig itself (the skeleton, the stride, the
 * shared poses) is data/theater/rig.ts; how the theater picks a pose at t is
 * features/game/mlb/theater/drawTheater.ts `pose`.
 */
import { mix, rigArm, rigPose, vec, type RigPose } from "../theater/rig";

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

  /** The release from a low slot: the arm comes round from the side, not over the top. */
  sidearm: rigPose({
    turn: -0.85,
    hip: vec(0.36, -0.05, 0.35),
    lean: 0.38,
    twist: 0.55,
    left: vec(0.52, -0.1, 0),
    right: vec(0.0, -0.04, 0.12),
    knees: 0.2,
    leftArm: rigArm({ swing: 0.4, spread: 0.35, turn: -0.4, bend: 1.7 }),
    rightArm: rigArm({ swing: 1.55, spread: 1.2, turn: -0.3, bend: 0.4 }),
  }),
  /** On the rubber, bent in for the catcher's sign: the glove at his side, the ball behind his back. */
  sign: rigPose({
    hip: vec(-0.02, 0, 0.47),
    lean: 0.45,
    nod: 0.2,
    left: vec(0.05, 0.12, 0),
    right: vec(-0.03, -0.1, 0),
    knees: 0.15,
    leftArm: rigArm({ swing: 0.3, spread: 0.18, turn: 0, bend: 0.5 }),
    rightArm: rigArm({ swing: -0.35, spread: 0.12, turn: 0, bend: 1.4 }),
  }),
  /** Squared round to bunt: chest to the pitcher, the bat level out in front, knees bent. */
  bunt: rigPose({
    turn: 1.15,
    hip: vec(0, 0, 0.4),
    lean: 0.32,
    left: vec(0.1, 0.12, 0),
    right: vec(-0.08, -0.13, 0),
    knees: 0.4,
    leftArm: rigArm({ swing: 1.2, spread: 0.05, turn: -0.2, bend: 0.75 }),
    rightArm: rigArm({ swing: 1.25, spread: 0.0, turn: -0.4, bend: 0.5 }),
  }),
  /** Back into a base head first: flat out along the dirt, both arms reaching for the bag. */
  diveBack: rigPose({
    hip: vec(-0.2, 0, 0.12),
    lean: 1.42,
    nod: -0.3,
    left: vec(-0.48, 0.07, 0.02),
    right: vec(-0.46, -0.08, 0.02),
    knees: 0.05,
    leftArm: rigArm({ swing: 2.85, spread: 0.12, bend: 0.1 }),
    rightArm: rigArm({ swing: 2.75, spread: 0.2, bend: 0.15 }),
  }),

  // The plate umpire, facing the pitcher: his set behind the catcher, and
  // his calls (all with the right hand, as every umpire makes them).

  /** Set behind the catcher: low, hands on his knees, looking in over the catcher's shoulder. */
  umpireSet: rigPose({
    hip: vec(-0.06, 0, 0.34),
    lean: 0.42,
    left: vec(0.05, 0.2, 0),
    right: vec(-0.04, -0.2, 0),
    knees: 0.5,
    leftArm: rigArm({ swing: 0.55, spread: 0.32, turn: -0.2, bend: 0.5 }),
    rightArm: rigArm({ swing: 0.55, spread: 0.32, turn: -0.2, bend: 0.5 }),
  }),
  /** Strike: up out of the set, the right fist punched up and out to his side (the camera's behind him: it reads from there). */
  strikeCall: rigPose({
    hip: vec(0, 0, 0.47),
    lean: 0.06,
    roll: 0.08,
    left: vec(0.02, 0.12, 0),
    right: vec(0, -0.12, 0),
    leftArm: rigArm({ swing: 0.15, spread: 0.18, bend: 0.4 }),
    rightArm: rigArm({ swing: 0.3, spread: 2.3, turn: 0, bend: 0.35 }),
  }),
  /** Strike three, looking: the punch-out, side-on to first, a lunge and the fist thrown at it. */
  punchOut: rigPose({
    turn: -1.35,
    hip: vec(0.04, -0.04, 0.4),
    lean: 0.2,
    twist: -0.25,
    left: vec(0.16, 0.2, 0),
    right: vec(-0.12, -0.22, 0),
    knees: 0.4,
    leftArm: rigArm({ swing: 0.35, spread: 0.35, turn: 0, bend: 1.4 }),
    rightArm: rigArm({ swing: 1.55, spread: 0.1, turn: 0, bend: 0.12 }),
  }),
  /** A swinging strike: the right arm pointed out, quick. */
  swingingCall: rigPose({
    hip: vec(0, 0, 0.47),
    lean: 0.05,
    leftArm: rigArm({ swing: 0.15, spread: 0.18, bend: 0.4 }),
    rightArm: rigArm({ swing: 1.4, spread: 0.6, turn: 0, bend: 0.25 }),
  }),
  /** Foul: both arms up over his head. */
  foulCall: rigPose({
    hip: vec(0, 0, 0.48),
    lean: -0.04,
    leftArm: rigArm({ swing: 2.85, spread: 0.35, bend: 0.1 }),
    rightArm: rigArm({ swing: 2.85, spread: 0.35, bend: 0.1 }),
  }),
  /** Safe: both arms swept out level to the sides, crouched over the plate. */
  safeCall: rigPose({
    hip: vec(0, 0, 0.42),
    lean: 0.32,
    left: vec(0.02, 0.21, 0),
    right: vec(0.02, -0.21, 0),
    knees: 0.35,
    leftArm: rigArm({ swing: 0.12, spread: 1.5, bend: 0.05 }),
    rightArm: rigArm({ swing: 0.12, spread: 1.5, bend: 0.05 }),
  }),
  /** Out: the hammer, the right fist up and out, leaning into it. */
  outCall: rigPose({
    hip: vec(0, 0, 0.44),
    lean: 0.2,
    roll: 0.1,
    left: vec(0.05, 0.15, 0),
    right: vec(-0.03, -0.15, 0),
    knees: 0.25,
    leftArm: rigArm({ swing: 0.2, spread: 0.2, bend: 0.5 }),
    rightArm: rigArm({ swing: 0.45, spread: 2.2, turn: 0, bend: 1.0 }),
  }),
  /** A challenge under the automated zone: a tap on the cap. */
  capTap: rigPose({
    hip: vec(0, 0, 0.48),
    leftArm: rigArm({ swing: 0.1, spread: 0.15, bend: 0.3 }),
    rightArm: rigArm({ swing: 1.95, spread: 0.65, turn: 0.2, bend: 2.35 }),
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

/** The release at his arm slot: over the top (1) to sidearm (0). */
export function deliverAt(slot: number): RigPose {
  return mix(BaseballPoses.sidearm, BaseballPoses.deliver, Math.min(Math.max(slot, 0), 1));
}
