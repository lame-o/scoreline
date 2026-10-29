/**
 * The clock of a field between plays (FootballStage's and SoccerStage's
 * `IdleClock` and their wake task, FootballIdle.swift and SoccerIdle.swift):
 * the idle's script time counts from when it began and goes round its loop,
 * and it moves only in sparse beats. Through a beat it draws every frame (a
 * requestAnimationFrame loop for the beat alone); between beats it draws
 * once and sleeps on a timer until the next beat or the tag's next change.
 * Off screen or in a hidden tab nothing runs at all: no frame, no timer.
 * The time is the wall clock's, so a theater scrolled back into view picks up
 * where the idle would be, as the Mac's does. With Reduce Motion it draws
 * one still moment and never wakes; frozen (development), that instant.
 *
 * It owns no canvas: it hands each instant to `draw` (the theater feeds it to
 * its TheaterStage as the frame to draw, `StageInputs.frozen`).
 *
 *     const clock = new BeatClock(well);
 *     clock.set({ key, script, changes: [9], still: null, frozen: null, draw: (t) => stage.update({ ...inputs, frozen: t }) });
 *     clock.set(null); // a replay took over
 */

/** What an idle script tells its clock (FootballScript's and SoccerScript's loop and beats). */
export interface BeatScript {
  /** The script's time for this many seconds of idle (straight through, then round the loop). */
  idleTime(elapsed: number): number;
  /** Whether anything moves at t. */
  moving(t: number): boolean;
  /** When the next beat begins after t (script time, past the loop's end coming round again). */
  nextBeat(t: number): number | null;
}

export interface BeatInputs {
  /** Which idle it is: a new key starts its clock again from 0. */
  readonly key: string;
  readonly script: BeatScript;
  /** Script times the tag changes at, to wake for between beats. */
  readonly changes: readonly number[];
  /** Reduce Motion's still moment (script time), or null to animate. */
  readonly still: number | null;
  /** Development: this many seconds into the idle, frozen. */
  readonly frozen: number | null;
  /** Draws the idle at script time t. */
  readonly draw: (t: number) => void;
}

export class BeatClock {
  private inputs: BeatInputs | null = null;
  private key: string | null = null;
  private since = 0;
  private frame = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private onScreen = true;
  private readonly intersection: IntersectionObserver | null;
  private readonly onVisibility = () => this.tick();

  constructor(element: Element) {
    this.intersection =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(
            (entries) => {
              const entry = entries[entries.length - 1];
              if (!entry) return;
              this.onScreen = entry.isIntersecting;
              this.tick();
            },
            { rootMargin: "64px" },
          );
    this.intersection?.observe(element);
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  dispose(): void {
    this.intersection?.disconnect();
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.stop();
    this.inputs = null;
  }

  /** The idle to run (null: none, a replay is on). The same key keeps its clock; a new one starts from 0. */
  set(inputs: BeatInputs | null): void {
    this.inputs = inputs;
    if (!inputs) {
      this.key = null;
      this.stop();
      return;
    }
    if (inputs.key !== this.key) {
      this.key = inputs.key;
      this.since = performance.now();
    }
    this.tick();
  }

  private get visible(): boolean {
    return this.onScreen && document.visibilityState !== "hidden";
  }

  private stop(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (this.timer != null) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Seconds into the idle's script now. */
  private time(now: number): number {
    const i = this.inputs!;
    if (i.frozen != null) return i.script.idleTime(i.frozen);
    if (i.still != null) return i.still;
    return i.script.idleTime((now - this.since) / 1000);
  }

  /** Draws now, then the next frame through a beat, or a timer to the next beat or tag change; nothing while unseen. */
  private tick(): void {
    this.stop();
    const i = this.inputs;
    if (!i) return;
    const t = this.time(performance.now());
    i.draw(t);
    if (i.frozen != null || i.still != null || !this.visible) return;
    if (i.script.moving(t)) {
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.tick();
      });
      return;
    }
    let wake = i.script.nextBeat(t);
    for (const c of i.changes) if (c > t && (wake == null || c < wake)) wake = c;
    if (wake == null) return;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        this.tick();
      },
      (Math.max(wake - t, 0.05) + 0.02) * 1000,
    );
  }
}
