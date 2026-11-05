/**
 * A directed theater's frames (TheaterView.swift `TheaterFrames`;
 * CHOREOGRAPHY §5.6.7, §5.7, §13): one canvas, drawn imperatively, at the
 * display's own rate (requestAnimationFrame) while anything on screen moves
 * and the theater is seen, and not at all when nothing does, or when it's
 * scrolled away or the tab is hidden (the clock and the plan carry on).
 * Between the two is one wake, a timer to the moment the plan's next tier
 * begins on the theater's time (TheaterFrameGate), across a hold of the clock
 * as well as any other stretch of it. Each frame reads the theater's time
 * from the presentation clock, samples the chain into a scratch the stage
 * holds (no allocation), and hands it to the sport's painter; React never
 * renders per frame.
 *
 * Reduce Motion: the same clock and the same plan, shown as key states (each
 * clip's decisive moment and its end), each crossfading into the next over a
 * quarter second on the house ease-out: no travel, no camera moves. (The
 * Mac's view pauses its TimelineView and redraws on each change; the web
 * draws the key states the design names.)
 *
 * What it tells the director: whether it's seen (plan always, bake when
 * seen: §8.4). What it hears: every splice and every change of the clock.
 */
import type { TheaterClip } from "../../../../data/theater/theaterClips";
import type { TheaterTime } from "../../../../data/theater/theaterDirector";
import type { PTime } from "../../../../data/theater/theaterEngine";
import type { FrameTier, PlanChain } from "../../../../data/theater/theaterPlanChain";
import type { TheaterClock } from "../../../../data/theater/theaterSource";
import { TheaterFrameGate, TheaterKeyStates } from "../../../../data/theater/theaterView";
import { drawLayers } from "./layers";
import type { Ctx, Size } from "./theaterKit";

/** What the stage reads of the director. */
export interface DirectedSource<Clip extends TheaterClip> {
  readonly chain: PlanChain<Clip>;
  readonly timing: { time: TheaterTime; clock: TheaterClock } | null;
  time(wall: PTime): PTime | null;
  now: () => PTime;
  subscribe(listener: () => void): () => void;
  setVisible(seen: boolean): void;
}

/** One frame at a wall time and its theater's time T (the painter samples the chain at T). */
export type DirectedPaint = (ctx: Ctx, size: Size, pt: number, wall: PTime, T: PTime) => void;

/** Development and tests: frame times of the directed theaters, in ms (draw only), read from `window.__theaterFrames`. */
declare global {
  interface Window {
    __theaterFrames?: number[];
  }
}

const FADE = 0.25;

export class DirectedStage<Clip extends TheaterClip> {
  private readonly ctx: CanvasRenderingContext2D;
  private size: Size = { width: 0, height: 0 };
  private dpr = 1;
  private pt = 1;
  private frame = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private onScreen = true;
  private paintFrame: DirectedPaint | null = null;
  private reduceMotion = false;
  /** A name tag fading in or out: frames until then (performance.now(), ms). */
  private awakeUntil = 0;
  /** The gate's answer and the wall time it next changes. */
  private moving = false;
  private recheck = -Infinity;
  /** The chain's tiers end to end, built once per splice. */
  private tiers: { revision: number; value: readonly FrameTier[] } | null = null;
  private keys: { revision: number; value: readonly PTime[] } | null = null;
  private readonly resize: ResizeObserver;
  private readonly intersection: IntersectionObserver | null;
  private readonly onVisibility = () => this.visibilityChanged();
  private readonly unsubscribe: () => void;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly director: DirectedSource<Clip>,
  ) {
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("No 2D canvas");
    this.ctx = ctx;
    this.resize = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) this.resized(box.width, box.height);
    });
    this.resize.observe(canvas);
    // Scrolled away: nothing runs (the plan is still made; only its bake waits for the court to be seen).
    this.intersection =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(
            (entries) => {
              const entry = entries[entries.length - 1];
              if (!entry) return;
              this.onScreen = entry.isIntersecting;
              this.visibilityChanged();
            },
            { rootMargin: "64px" },
          );
    this.intersection?.observe(canvas);
    document.addEventListener("visibilitychange", this.onVisibility);
    // A new plan or a new clock looks again; otherwise it sleeps until the tier changes.
    this.unsubscribe = director.subscribe(() => this.schedule(true));
  }

  dispose(): void {
    this.resize.disconnect();
    this.intersection?.disconnect();
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.unsubscribe();
    this.stop();
  }

  private get visible(): boolean {
    return this.onScreen && document.visibilityState !== "hidden";
  }

  /** New drawing inputs from React (the teams, the theme, the names): redraws now. */
  update(paint: DirectedPaint, reduceMotion: boolean): void {
    this.paintFrame = paint;
    this.reduceMotion = reduceMotion;
    this.schedule(true);
  }

  /** Draws the frame on screen again now, and keeps drawing until `until` (a name tag fading in or out over a still). */
  animate(until: number): void {
    this.awakeUntil = Math.max(this.awakeUntil, until);
    this.schedule(true);
  }

  /** From inside a frame: keep the frames coming until `until` (performance.now(), ms: a burst playing out past its clip). */
  keepAwake(until: number): void {
    this.awakeUntil = Math.max(this.awakeUntil, until);
  }

  private resized(width: number, height: number): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.pt = (Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 13) / 13;
    this.size = { width, height };
    this.canvas.width = Math.max(Math.round(width * this.dpr), 1);
    this.canvas.height = Math.max(Math.round(height * this.dpr), 1);
    this.schedule(true);
  }

  private visibilityChanged(): void {
    this.director.setVisible(this.visible);
    if (this.visible) this.schedule(true);
    else this.stop();
  }

  private stop(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private chainTiers(): readonly FrameTier[] {
    const chain = this.director.chain;
    if (this.tiers?.revision !== chain.revision) this.tiers = { revision: chain.revision, value: chain.tiers };
    return this.tiers.value;
  }

  /** The gate's answer now (re-read only once the wall passes when it said it would change). */
  private gate(wall: PTime): boolean {
    if (wall < this.recheck) return this.moving;
    const timing = this.director.timing;
    if (!timing) {
      this.moving = false;
      this.recheck = Infinity;
      return false;
    }
    const state = TheaterFrameGate.state(this.chainTiers(), timing.time, timing.clock, wall);
    this.moving = state.moving;
    this.recheck = state.wake ?? Infinity;
    return state.moving;
  }

  /**
   * Draws now (`immediate`) and keeps frames coming at the display's rate
   * while the plan moves and the stage is seen; otherwise sleeps on one timer
   * to when it next moves.
   */
  private schedule(immediate = false): void {
    if (immediate) this.recheck = -Infinity;
    if (!this.visible) {
      this.stop();
      return;
    }
    if (immediate) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.draw(this.director.now());
    }
    if (this.frame) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const wall = this.director.now();
    if (this.reduceMotion) {
      this.scheduleKeys(wall);
      return;
    }
    const moving = this.gate(wall) || performance.now() < this.awakeUntil;
    if (moving) {
      this.frame = requestAnimationFrame(() => this.tick());
      return;
    }
    if (Number.isFinite(this.recheck)) this.sleep(this.recheck - wall);
  }

  private tick(): void {
    this.frame = 0;
    const wall = this.director.now();
    const begin = performance.now();
    this.draw(wall);
    const frames = window.__theaterFrames;
    if (frames) frames.push(performance.now() - begin);
    if (!this.visible) return;
    if (this.gate(wall) || performance.now() < this.awakeUntil) {
      this.frame = requestAnimationFrame(() => this.tick());
      return;
    }
    // Come to rest: the last frame drawn is the still; one wake to the next tier that moves.
    if (Number.isFinite(this.recheck)) this.sleep(this.recheck - wall);
  }

  private sleep(seconds: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(
      () => {
        this.timer = null;
        this.recheck = -Infinity;
        this.schedule(false);
      },
      Math.max(seconds, 1 / 240) * 1000,
    );
  }

  /** Reduce Motion: a crossfade's frames while one runs, else a timer to the next key state. */
  private scheduleKeys(wall: PTime): void {
    const T = this.director.time(wall);
    const timing = this.director.timing;
    if (T == null || !timing) return;
    const keys = this.keyStates();
    const shown = TheaterKeyStates.shown(keys, T);
    if (shown.fade < 1 || performance.now() < this.awakeUntil) {
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.draw(this.director.now());
        this.schedule(false);
      });
      return;
    }
    const next = keys.find((k) => k > T);
    if (next == null) return;
    const at = timing.time.wallReaching(next, timing.clock, wall);
    if (at != null) this.sleep(at - wall);
  }

  private keyStates(): readonly PTime[] {
    const chain = this.director.chain;
    if (this.keys?.revision !== chain.revision) {
      const out: PTime[] = [];
      for (const baked of chain.plans) out.push(...TheaterKeyStates.keys(baked.plan));
      this.keys = { revision: chain.revision, value: out.sort((a, b) => a - b) };
    }
    return this.keys.value;
  }

  private draw(wall: PTime): void {
    const paint = this.paintFrame;
    const { ctx, size } = this;
    if (!paint || size.width === 0 || size.height === 0) return;
    const T = this.director.time(wall);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    if (T == null) return;
    if (!this.reduceMotion) {
      paint(ctx, size, this.pt, wall, T);
      return;
    }
    // The key state at T, crossfading in from the one before.
    const shown = TheaterKeyStates.shown(this.keyStates(), T);
    const at = (key: PTime) => wall - (T - key);
    if (shown.before == null || !(shown.fade < 1)) {
      paint(ctx, size, this.pt, at(shown.now), shown.now);
      return;
    }
    const before = shown.before;
    drawLayers(ctx, [
      [1 - shown.fade, (c) => paint(c, size, this.pt, at(before), before)],
      [shown.fade, (c) => paint(c, size, this.pt, at(shown.now), shown.now)],
    ]);
  }
}

/** The fade between Reduce Motion's key states (seconds). */
export const KEY_FADE = FADE;
