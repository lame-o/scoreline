/**
 * The game as one broadcast, part 13: the frame path (TheaterFrameScratch.swift;
 * CHOREOGRAPHY §5.7, §8).
 *
 * A frame samples the plan chain into a scratch object the stage holds and
 * never renders from React: buffers sized once (32 figures: football's 22 and
 * its staff), refilled each frame without allocating. The painter reads it.
 * (The Mac's malloc-logger probe is the bench's; on the web the frame path is
 * measured with Chromium tracing, as ARCHITECTURE.md's theater notes say.)
 */
import type { ActorID, PTime } from "./theaterEngine";

/** One man in a frame, refilled in place. */
export interface ScratchActor {
  id: ActorID;
  /** Its track in the plan. */
  track: number;
  x: number;
  y: number;
  opacity: number;
  /** The stride at p (RigMotion's fields). */
  readonly motion: { heading: number; phase: number; speed: number; push: number; weight: number };
  /** The clip that poses him and his figure in it, at its time. */
  placement: number;
  figure: number;
  clipTime: number;
  /** While he travels from one clip to the next: the one he leaves, and how far the blend is (1: all the new one's). */
  previousPlacement: number;
  previousFigure: number;
  previousTime: number;
  blend: number;
}

/** Where the ball is in a frame: none, in a clip (it says where and whose), in a man's hands across a splice, or passed between clips. */
export type ScratchBallKind = "none" | "clip" | "held" | "free";

const emptyActor = (): ScratchActor => ({
  id: 0,
  track: 0,
  x: 0,
  y: 0,
  opacity: 0,
  motion: { heading: 0, phase: 0, speed: 0, push: 0, weight: 0 },
  placement: -1,
  figure: -1,
  clipTime: 0,
  previousPlacement: -1,
  previousFigure: -1,
  previousTime: 0,
  blend: 1,
});

/** What one frame draws at p, refilled every frame (never observed). */
export class FrameScratch {
  static readonly capacity = 32;

  p: PTime = 0;
  /** The chain's plan (−1: nothing yet), and the placement covering p in it. */
  plan = -1;
  placement = -1;
  /** x, y of the ground center, log span, yaw. */
  readonly camera = { x: 0, y: 0, z: 0, w: 0 };
  /** The first `count` are this frame's. */
  readonly actors: ScratchActor[] = [];
  count = 0;
  ballKind: ScratchBallKind = "none";
  /** The clip's placement (`clip`), the man (`held`), or where (`free`). */
  ballPlacement = -1;
  ballActor: ActorID = 0;
  readonly ball = { x: 0, y: 0, z: 0 };
  /** Depth order for the painter (insertion sort into this buffer). */
  readonly order: number[] = [];
  orderCount = 0;

  constructor() {
    for (let i = 0; i < FrameScratch.capacity; i++) this.actors.push(emptyActor());
  }

  /** The next actor slot, cleared of its blend (a frame with more men than the capacity grows it once). */
  take(): ScratchActor {
    if (this.count >= this.actors.length) this.actors.push(emptyActor());
    const a = this.actors[this.count]!;
    this.count += 1;
    a.previousPlacement = -1;
    a.previousFigure = -1;
    a.previousTime = 0;
    a.blend = 1;
    return a;
  }

  /** The actors far to near by `depth` (larger first), into `order`: insertion sort, no allocation. */
  sortByDepth(depth: (actor: ScratchActor) => number): void {
    this.orderCount = 0;
    for (let i = 0; i < this.count; i++) {
      const d = depth(this.actors[i]!);
      let j = this.orderCount;
      this.order[this.orderCount] = i;
      this.orderCount += 1;
      while (j > 0 && depth(this.actors[this.order[j - 1]!]!) < d) {
        this.order[j] = this.order[j - 1]!;
        j -= 1;
      }
      this.order[j] = i;
    }
  }
}
