/**
 * The play theater's stage (PlayTheater.swift `PlayStage`,
 * `TheaterCelebration`): one canvas, drawn imperatively. A requestAnimation
 * Frame loop exists only while something moves (a replay, its bursts, a
 * crossfade, Reduce Motion's bloom); between plays the field is drawn once,
 * as a still, and redrawn only when its inputs, size or theme change. React
 * never renders per frame: the component hands the renderer new inputs and
 * it decides what to draw.
 *
 * - A new play that's news replays from its pitch; a new one mid-replay cuts to itself.
 * - Its end is said (`onEnd`): the component holds it, then returns the field to the game.
 * - A play that isn't replayed (history, or Reduce Motion) crossfades to how it ended (0.35 s).
 * - With Reduce Motion a home run blooms softly at the plate instead of its fireworks.
 * - Between plays, a beat (a pitch, a visit, a change; playBeatScript.ts) or an idle move is drawn on its own
 *   clock from when the stage began it, the loop running only until it's over (at half the frame rate for an
 *   idle move: it's small and slow); with Reduce Motion, off screen or in a hidden tab it's drawn as it ends.
 */
import { cueDuration, cueFor, presetFor, type CelebrationLevel, type CelebrationPalette } from "../../../../data/celebrations";
import { restCamera } from "../../../../data/mlb/playCamera";
import type { PlayScene } from "../../../../data/mlb/playScene";
import type { PlayScript } from "../../../../data/mlb/playScript";
import { burstEnd, plateCelebration, type TheaterBurst } from "../../../../data/mlb/theaterCelebration";
import type { TheaterTeams } from "../../../../data/mlb/theaterTeams";
import type { LiveMoment } from "../../../../data/moments";
import { drawBursts, drawField, drawFrame, FieldProjection, layoutLabels, type Labels, type Size } from "./drawTheater";
import { mixHex, rgba, type TheaterInk } from "./theaterInk";
import type { TagFrame } from "../../../../data/theater/theaterNames";

export interface StageInputs {
  readonly scene: PlayScene | null;
  readonly news: boolean;
  readonly script: PlayScript;
  readonly teams: TheaterTeams;
  readonly ink: TheaterInk;
  readonly statcast: string | null;
  readonly moment: LiveMoment | null;
  readonly level: CelebrationLevel;
  readonly reduceMotion: boolean;
  /** Development: draw this instant of the play, frozen (the Swift harness's `.frozen(t)` clock). */
  readonly frozen: number | null;
  /** Told once a replay has run its course (its end then holds; PlayStage's `replay.done`). */
  readonly onEnd?: (id: string) => void;
  /** Between plays: a beat or an idle move, drawn from `start` (performance.now(), ms) in place of the still. */
  readonly beat?: { readonly key: string; readonly script: PlayScript; readonly start: number; readonly idle: boolean } | null;
  /** Room kept at the bottom trailing corner for the heartbeat. */
  readonly footer?: number;
  /** Off screen or in a hidden tab: a beat or idle move is drawn as it ends (nothing animates unseen). */
  readonly paused?: boolean;
  /** The names over the figures for the script drawn at t (the play's, or a beat's), through its projection. */
  readonly tags?: ((script: PlayScript, t: number, f: FieldProjection) => TagFrame | null) | null;
}

const CROSSFADE_MS = 350;
/** An idle move's frames, about 30 a second (the next waits on a vsync after this). */
const IDLE_FRAME_MS = 1000 / 30 - 6;

export class TheaterRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private size: Size = { width: 0, height: 0 };
  private dpr = 1;
  private pt = 1;
  private inputs: StageInputs | null = null;
  private labels: Labels | null = null;
  private labelsKey = "";
  private bursts: readonly TheaterBurst[] = [];
  private bloom: { cue: ReturnType<typeof cueFor>; start: number } | null = null;
  private replay: { id: string; start: number; ended?: boolean } | null = null;
  private fade: { snapshot: HTMLCanvasElement; start: number } | null = null;
  private shownID: string | null | undefined = undefined;
  private frame = 0;
  /** A name tag fading in or out: frames until then (performance.now(), ms). */
  private tagsUntil = 0;
  private wait: ReturnType<typeof setTimeout> | undefined;
  private readonly observer: ResizeObserver;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("No 2D canvas");
    this.ctx = ctx;
    this.observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) this.resize(box.width, box.height);
    });
    this.observer.observe(canvas);
  }

  dispose(): void {
    this.observer.disconnect();
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    clearTimeout(this.wait);
    this.wait = undefined;
  }

  /** New inputs from React: decides whether a replay begins, a crossfade runs, or a still is redrawn. */
  update(next: StageInputs): void {
    const previous = this.inputs;
    this.inputs = next;
    const id = next.scene?.id ?? null;
    const now = performance.now();
    if (id !== this.shownID) {
      const first = this.shownID === undefined;
      this.shownID = id;
      this.bloom = null;
      if (next.frozen == null && !next.reduceMotion && next.news && id != null) {
        // A new play replays from its pitch (and a new one mid-replay cuts to itself).
        this.replay = { id, start: now };
        this.fade = null;
      } else {
        this.replay = null;
        // A play that isn't replayed crossfades to how it ended.
        if (!first && this.size.width > 0) this.fade = { snapshot: this.snapshot(), start: now };
      }
    }
    if (next.moment !== previous?.moment || next.level !== previous?.level || next.reduceMotion !== previous?.reduceMotion || next.script !== previous?.script) {
      this.armCelebration(previous?.moment ?? null, now);
    }
    this.layout();
    this.schedule();
  }

  /** Draws the frame on screen again now, and keeps drawing until `until` (a name tag fading in or out over a still). */
  animate(until: number): void {
    this.tagsUntil = Math.max(this.tagsUntil, until);
    this.schedule(true);
  }

  private resize(width: number, height: number): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.pt = (Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 13) / 13;
    this.size = { width, height };
    this.canvas.width = Math.max(Math.round(width * this.dpr), 1);
    this.canvas.height = Math.max(Math.round(height * this.dpr), 1);
    this.layout(true);
    this.armCelebration(this.inputs?.moment ?? null, performance.now(), true);
    this.schedule(true);
  }

  /** The type, laid out once per play, size, theme and Statcast line. */
  private layout(force = false): void {
    const i = this.inputs;
    if (!i || this.size.width === 0) return;
    const key = `${i.scene?.id}|${this.size.width}x${this.size.height}|${i.ink.dark}|${i.statcast}|${i.teams.batting.accent}|${i.script.banner?.text}|${this.pt}`;
    if (!force && key === this.labelsKey && this.labels) return;
    this.labelsKey = key;
    this.labels = layoutLabels(this.ctx, { scene: i.scene, script: i.script, teams: i.teams, ink: i.ink, size: this.size, pt: this.pt, statcast: i.statcast });
  }

  /** The theater's bursts for the page's moment (fireworks at the wall, the banner's confetti), or Reduce Motion's bloom. */
  private armCelebration(previousMoment: LiveMoment | null, now: number, keepBloom = false): void {
    const i = this.inputs;
    if (!i || !i.scene || this.size.height === 0) {
      this.bursts = [];
      return;
    }
    this.bursts = plateCelebration(i.moment, i.scene, i.script, i.level, false, this.size.height);
    if (i.reduceMotion && !keepBloom) {
      const m = i.moment;
      // The end state: a bloom where the runs crossed.
      if (m && m !== previousMoment && m.id === i.scene.id && m.kind === "homeRun" && i.level !== "off") {
        const cue = cueFor(m, { level: i.level, reduceMotion: true, preset: presetFor(this.size.height), direction: -Math.PI / 2 });
        this.bloom = cue ? { cue, start: now } : null;
      }
    }
    if (i.reduceMotion) this.bursts = [];
  }

  private snapshot(): HTMLCanvasElement {
    const copy = document.createElement("canvas");
    copy.width = this.canvas.width;
    copy.height = this.canvas.height;
    copy.getContext("2d")?.drawImage(this.canvas, 0, 0);
    return copy;
  }

  /** A beat or idle move on screen (not while a replay runs). */
  private beatShown(now: number): StageInputs["beat"] {
    const i = this.inputs;
    if (!i?.beat) return null;
    if (this.replay && i.scene && this.replay.id === i.scene.id && Number.isFinite(this.replayTime(now))) return null;
    return i.beat;
  }

  private replayTime(now: number): number {
    const i = this.inputs;
    if (!i || !i.scene || !this.replay || this.replay.id !== i.scene.id) return Infinity;
    const t = (now - this.replay.start) / 1000;
    return t > this.replayEnd() ? Infinity : t;
  }

  /** Seconds into what's on screen (a beat's own clock while one is up); Infinity once it has ended (or was never replayed). */
  private time(now: number): number {
    const i = this.inputs;
    if (!i) return Infinity;
    if (i.frozen != null) return i.frozen;
    const beat = this.beatShown(now);
    if (beat) {
      if (i.reduceMotion || i.paused) return Infinity;
      const t = (now - beat.start) / 1000;
      return t > beat.script.duration ? Infinity : Math.max(t, 0);
    }
    if (!i.scene || !this.replay || this.replay.id !== i.scene.id) return Infinity;
    const t = (now - this.replay.start) / 1000;
    return t > this.replayEnd() ? Infinity : t;
  }

  private replayEnd(): number {
    const i = this.inputs;
    if (!i) return 0;
    return Math.max(i.script.duration, ...this.bursts.map(burstEnd)) + 0.05;
  }

  /** A replay past its script's end (its bursts may run on): said once, as PlayStage marks `replay.done`. */
  private noteEnd(now: number): void {
    const r = this.replay;
    const i = this.inputs;
    if (!r || r.ended || !i || i.scene?.id !== r.id || (now - r.start) / 1000 <= i.script.duration + 0.05) return;
    r.ended = true;
    i.onEnd?.(r.id);
  }

  private moving(now: number): boolean {
    const t = this.time(now);
    if (Number.isFinite(t) && this.inputs?.frozen == null) return true;
    // A beat that hasn't begun yet (its start a moment ahead) still waits on the loop.
    const beat = this.beatShown(now);
    if (beat && !this.inputs?.reduceMotion && !this.inputs?.paused && this.inputs?.frozen == null && now < beat.start) return true;
    if (this.fade && now - this.fade.start < CROSSFADE_MS) return true;
    if (this.bloom?.cue && (now - this.bloom.start) / 1000 < cueDuration(this.bloom.cue)) return true;
    return now < this.tagsUntil;
  }

  private schedule(immediate = false): void {
    if (immediate) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      clearTimeout(this.wait);
      this.wait = undefined;
      this.draw(performance.now());
    }
    if (this.frame || this.wait !== undefined) return;
    this.frame = requestAnimationFrame((now) => {
      this.frame = 0;
      this.draw(now);
      this.noteEnd(now);
      if (this.moving(now)) {
        // An idle move at half the frame rate (it's small and slow): the next frame waits, rather than waking each vsync.
        if (this.beatShown(now)?.idle && Number.isFinite(this.time(now))) {
          this.wait = setTimeout(() => {
            this.wait = undefined;
            this.schedule();
          }, IDLE_FRAME_MS);
        } else this.schedule();
      } else {
        this.fade = null;
        this.bloom = null;
        // The last frame of a replay is the static scene.
        if (this.replay && !Number.isFinite(this.time(now))) this.replay = null;
      }
    });
  }

  private palette(): CelebrationPalette {
    const i = this.inputs!;
    const primary = i.teams.batting.accent ?? i.ink.accent;
    return {
      primary,
      tint: mixHex(primary, "#ffffff", 0.4),
      neutral: rgba(i.ink.primary, 0.55),
      gold: i.ink.yellow,
      glint: rgba(i.ink.primary, 0.8),
      edge: rgba(i.ink.primary, 0.5),
    };
  }

  private draw(now: number): void {
    const i = this.inputs;
    const { ctx, size } = this;
    if (!i || size.width === 0 || size.height === 0) return;
    this.layout();
    const t = this.time(now);
    const beat = this.beatShown(now);
    const script = beat?.script ?? i.script;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    const f = new FieldProjection(size, script.camera.frame(t));
    drawField(ctx, f, i.ink);
    drawFrame(ctx, f, { scene: beat ? null : i.scene, script, t, teams: i.teams, ink: i.ink, labels: this.labels!, footer: i.footer ?? 0, tags: i.tags?.(script, t, f) ?? null });
    if (Number.isFinite(t) && this.bursts.length > 0) drawBursts(ctx, f, this.bursts, t, this.palette(), this.pt);
    if (this.bloom?.cue) {
      // At the plate, through the rest framing (Reduce Motion never moves the camera).
      const still = new FieldProjection(size, restCamera());
      drawBursts(ctx, still, [{ cue: this.bloom.cue, at: 0, anchor: { kind: "field", point: { x: 0, y: 0, z: 0 } }, scale: 1 }], (now - this.bloom.start) / 1000, this.palette(), this.pt);
    }
    if (this.fade) {
      const u = Math.min((now - this.fade.start) / CROSSFADE_MS, 1);
      const eased = u * u * (3 - 2 * u);
      if (u < 1) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1 - eased;
        ctx.drawImage(this.fade.snapshot, 0, 0, this.canvas.width, this.canvas.height);
        ctx.restore();
      }
    }
  }
}
