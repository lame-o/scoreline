/**
 * A play theater's stage (FootballTheater.swift `FootballStage`,
 * SoccerTheater.swift `SoccerStage` and their celebration stages): one
 * canvas, drawn imperatively. A requestAnimationFrame loop exists only while
 * something moves (a replay, its bursts, a crossfade, Reduce Motion's
 * bloom), and only while the stage is on screen in a visible tab; between
 * plays the field is drawn once, as a still, and redrawn only when its
 * inputs, size or theme change. React never renders per frame: the
 * component hands the stage new inputs and the stage decides what to draw.
 *
 * - A new play that's news replays from its start; a new one mid-replay cuts to itself.
 * - A play that isn't replayed (history, or Reduce Motion) crossfades to how it ended (0.35 s).
 * - Off screen or in a hidden tab the replay's clock stops, and picks up where it was when it's seen again (a web addition: a page scrolled past a touchdown still gets to see it).
 * - With Reduce Motion a score blooms softly where it happened instead of its bursts.
 * - The bursts are taken when the moment arrives and kept for the play, so a goal at the end of a long move still has them after the page's moment has moved on.
 *
 * The sport supplies `paint` (the field, the play, its type, the bursts given)
 * and its rules for bursts and the bloom; the stage owns time.
 */
import { cueDuration, drawParticles, particles, type CelebrationCue, type CelebrationPalette } from "../../../../data/celebrations";
import type { Point } from "../../../../data/mlb/theaterField";
import { stageBurstEnd, type Ctx, type Size, type StageBurst } from "./theaterKit";

export interface Bloom {
  readonly cue: CelebrationCue;
  readonly origin: Point;
  readonly palette: CelebrationPalette;
}

export interface StageInputs {
  /** The play or moment on screen (null: the field between plays). */
  readonly id: string | null;
  /** Arrived while the page was open, or only just happened: replay it. */
  readonly news: boolean;
  /** When its replay has ended, settle included. */
  readonly duration: number;
  /** Development: draw this instant of the play, frozen (the Swift harness's `.frozen(t)` clock). */
  readonly frozen: number | null;
  readonly reduceMotion: boolean;
  /** The page's moment for this chart (its ID), so a moment arriving starts Reduce Motion's bloom once. */
  readonly momentID: string | null;
  /** The play's bursts for the page's moment at this stage height, in script time. */
  readonly bursts: (height: number) => readonly StageBurst[];
  /** Reduce Motion's end state for the moment: a bloom where it happened, or null. */
  readonly bloom: ((size: Size) => Bloom | null) | null;
  /** One frame at t (Infinity: as it ended): the field, the play and its type, then the bursts given. */
  readonly paint: (ctx: Ctx, size: Size, pt: number, t: number, bursts: readonly StageBurst[]) => void;
  /** Seconds the replay holds its first frame before t = 0 (a try's breath after its touchdown). */
  readonly lead?: number;
  /** Told when a replay has run its course (a touchdown's try follows it). */
  readonly onEnd?: (id: string) => void;
}

const CROSSFADE_MS = 350;

/** Development and tests: frame times of the last replay, in ms (draw only), read from `window.__theaterFrames`. */
declare global {
  interface Window {
    __theaterFrames?: number[];
  }
}

export class TheaterStage {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private size: Size = { width: 0, height: 0 };
  private dpr = 1;
  private pt = 1;
  private inputs: StageInputs | null = null;
  private bursts: readonly StageBurst[] = [];
  private armedFor: string | null = null;
  private bloom: { value: Bloom; start: number } | null = null;
  private replay: { id: string; start: number; pausedAt: number | null } | null = null;
  private fade: { snapshot: HTMLCanvasElement; start: number } | null = null;
  private shownID: string | null | undefined = undefined;
  private frame = 0;
  /** A name tag fading in or out: frames until then (performance.now(), ms). */
  private tagsUntil = 0;
  private onScreen = true;
  private readonly resize: ResizeObserver;
  private readonly intersection: IntersectionObserver | null;
  private readonly onVisibility = () => this.visibilityChanged();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("No 2D canvas");
    this.ctx = ctx;
    this.resize = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) this.resized(box.width, box.height);
    });
    this.resize.observe(canvas);
    // Off screen, nothing runs: the loop stops and the replay's clock with it.
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
  }

  dispose(): void {
    this.resize.disconnect();
    this.intersection?.disconnect();
    document.removeEventListener("visibilitychange", this.onVisibility);
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private get visible(): boolean {
    return this.onScreen && document.visibilityState !== "hidden";
  }

  /** New inputs from React: decides whether a replay begins, a crossfade runs, a bloom plays, or a still is redrawn. */
  update(next: StageInputs): void {
    const previous = this.inputs;
    this.inputs = next;
    const now = performance.now();
    if (next.id !== this.shownID) {
      const first = this.shownID === undefined;
      this.shownID = next.id;
      this.bloom = null;
      this.bursts = [];
      this.armedFor = null;
      if (next.frozen == null && !next.reduceMotion && next.news && next.id != null) {
        // A new play replays from its start (and a new one mid-replay cuts to itself).
        const start = now + (next.lead ?? 0) * 1000;
        this.replay = { id: next.id, start, pausedAt: this.visible ? null : now };
        this.fade = null;
      } else {
        this.replay = null;
        // A play that isn't replayed crossfades to how it ended.
        if (!first && this.size.width > 0 && this.visible) this.fade = { snapshot: this.snapshot(), start: now };
      }
    }
    this.arm();
    if (next.reduceMotion && next.momentID != null && next.momentID === next.id && next.momentID !== previous?.momentID && next.bloom) {
      // The end state: a bloom where it happened.
      const bloom = this.size.height > 0 ? next.bloom(this.size) : null;
      this.bloom = bloom ? { value: bloom, start: now } : null;
    }
    this.schedule(true);
  }

  /** Draws the frame on screen again now, and keeps drawing until `until` (a name tag fading in or out over a still). */
  animate(until: number): void {
    this.tagsUntil = Math.max(this.tagsUntil, until);
    this.schedule(true);
  }

  /** The moment's bursts for this play, kept once it has had them. */
  private arm(): void {
    const i = this.inputs;
    if (!i || !i.id || this.size.height === 0 || i.reduceMotion) {
      if (i?.reduceMotion) this.bursts = [];
      return;
    }
    const current = i.bursts(this.size.height);
    if (current.length > 0) {
      this.bursts = current;
      this.armedFor = i.id;
    } else if (this.armedFor !== i.id) {
      this.bursts = [];
    }
  }

  private resized(width: number, height: number): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.pt = (Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 13) / 13;
    this.size = { width, height };
    this.canvas.width = Math.max(Math.round(width * this.dpr), 1);
    this.canvas.height = Math.max(Math.round(height * this.dpr), 1);
    this.arm();
    this.schedule(true);
  }

  private visibilityChanged(): void {
    const now = performance.now();
    const r = this.replay;
    if (this.visible) {
      if (r && r.pausedAt != null) {
        r.start += now - r.pausedAt;
        r.pausedAt = null;
      }
      this.schedule(true);
    } else {
      if (r && r.pausedAt == null) r.pausedAt = now;
      // Nothing moves while unseen: a crossfade or a bloom just ends.
      this.fade = null;
      this.bloom = null;
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
  }

  private snapshot(): HTMLCanvasElement {
    const copy = document.createElement("canvas");
    copy.width = this.canvas.width;
    copy.height = this.canvas.height;
    copy.getContext("2d")?.drawImage(this.canvas, 0, 0);
    return copy;
  }

  private replayEnd(): number {
    const i = this.inputs;
    if (!i) return 0;
    let end = i.duration;
    for (const b of this.bursts) end = Math.max(end, stageBurstEnd(b));
    return end + 0.05;
  }

  /** Seconds into the play on screen; Infinity once it has ended (or was never replayed). */
  private time(now: number): number {
    const i = this.inputs;
    if (!i) return Infinity;
    if (i.frozen != null) return i.frozen;
    const r = this.replay;
    if (!r || r.id !== i.id) return Infinity;
    const t = Math.max(((r.pausedAt ?? now) - r.start) / 1000, 0);
    return t > this.replayEnd() ? Infinity : t;
  }

  private moving(now: number): boolean {
    const t = this.time(now);
    if (Number.isFinite(t) && this.inputs?.frozen == null) return true;
    if (this.fade && now - this.fade.start < CROSSFADE_MS) return true;
    if (this.bloom && (now - this.bloom.start) / 1000 < cueDuration(this.bloom.value.cue)) return true;
    return now < this.tagsUntil;
  }

  /**
   * Draws now (`immediate`) and keeps a frame coming while something moves
   * and the stage is seen. Unseen, it draws the still once (cheap) so it's
   * right when it comes back, and schedules nothing.
   */
  private schedule(immediate = false): void {
    if (immediate) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.draw(performance.now());
    }
    if (this.frame || !this.visible) return;
    if (!this.moving(performance.now())) {
      this.settle();
      return;
    }
    this.frame = requestAnimationFrame((now) => {
      this.frame = 0;
      const begin = performance.now();
      this.draw(now);
      const frames = window.__theaterFrames;
      if (frames) frames.push(performance.now() - begin);
      if (this.moving(now)) this.schedule();
      else {
        this.settle();
        // The last frame of a replay is the static scene.
        this.draw(now);
      }
    });
  }

  private settle(): void {
    this.fade = null;
    this.bloom = null;
    const r = this.replay;
    if (r && !Number.isFinite(this.time(performance.now()))) {
      this.replay = null;
      this.inputs?.onEnd?.(r.id);
    }
  }

  private draw(now: number): void {
    const i = this.inputs;
    const { ctx, size } = this;
    if (!i || size.width === 0 || size.height === 0) return;
    const t = this.time(now);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    i.paint(ctx, size, this.pt, t, Number.isFinite(t) ? this.bursts : []);
    const bloom = this.bloom;
    if (bloom) {
      ctx.save();
      ctx.translate(bloom.value.origin.x, bloom.value.origin.y);
      drawParticles(ctx, particles(bloom.value.cue, { x: 0, y: 0 }, (now - bloom.start) / 1000), bloom.value.palette);
      ctx.restore();
    }
    const fade = this.fade;
    if (fade) {
      const u = Math.min((now - fade.start) / CROSSFADE_MS, 1);
      const eased = u * u * (3 - 2 * u);
      if (u < 1) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1 - eased;
        ctx.drawImage(fade.snapshot, 0, 0, this.canvas.width, this.canvas.height);
        ctx.restore();
      }
    }
  }
}
