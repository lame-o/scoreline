/**
 * Development only: a recording played back as the page's broadcast would
 * hand it to a directed theater (`BroadcastTheaterSource`): each play arrives
 * when the recorder first saw it, on the wall's own time from where the page
 * opened (`offset` seconds into the recording), and the presentation clock
 * runs a fixed delay behind (replayTimeline.ts). What the director hands back
 * (horizons, anchors) is kept for the page's checks to read.
 */
import { DelayClock, snapshotAt, type Arrival } from "../../../../data/theater/replayTimeline";
import type { PTime } from "../../../../data/theater/theaterEngine";
import type { BindingHorizons, BroadcastTheaterSource, RawPlay, TheaterClock, TimelineSnapshot } from "../../../../data/theater/theaterSource";

export class ReplaySource implements BroadcastTheaterSource {
  readonly clock: TheaterClock;
  private arrived = -1;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<() => void>();
  /** Recording time less wall time. */
  private readonly shift: number;
  horizons: BindingHorizons | null = null;
  anchors: ReadonlyMap<string, PTime> = new Map();

  constructor(
    private readonly arrivals: readonly Arrival[],
    /** Seconds into the recording the page opens at. */
    offset: number,
    /** How far behind the recording's own time the clock presents (D). */
    delay: number,
    wall: PTime = Date.now() / 1000,
  ) {
    const first = arrivals[0]?.at ?? wall;
    this.shift = first + offset - wall;
    // Everything on the wall's axis (the plays' times shifted onto it): p = wall − D.
    this.clock = new DelayClock(delay, wall);
    this.arrived = this.count(wall);
  }

  /** Arrivals on the wall's axis. */
  private count(wall: PTime): number {
    const rec = wall + this.shift;
    let n = 0;
    for (const a of this.arrivals) if (a.at <= rec) n += 1;
    return n;
  }

  get revision(): number {
    return this.arrived;
  }

  snapshot(): TimelineSnapshot<RawPlay> {
    const wall = Date.now() / 1000;
    // The plays' own times are the recording's: shift them onto the wall's axis as the clock is.
    const shifted = this.arrivals.map((a) => ({
      at: a.at - this.shift,
      play: { ...a.play, eventTime: a.play.eventTime == null ? null : a.play.eventTime - this.shift, presentAt: a.play.presentAt - this.shift },
    }));
    return snapshotAt(shifted, this.clock, wall);
  }

  setBindingHorizons(horizons: BindingHorizons): void {
    this.horizons = horizons;
  }

  setAnchors(anchors: ReadonlyMap<string, PTime>): void {
    this.anchors = anchors;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    this.arm();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
    };
  }

  /** One timer to the next arrival. */
  private arm(): void {
    if (this.timer || this.listeners.size === 0) return;
    const wall = Date.now() / 1000;
    const next = this.arrivals.find((a) => a.at - this.shift > wall);
    if (!next) return;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        const n = this.count(Date.now() / 1000);
        if (n !== this.arrived) {
          this.arrived = n;
          for (const l of [...this.listeners]) l();
        }
        this.arm();
      },
      Math.max((next.at - this.shift - wall) * 1000, 0) + 5,
    );
  }
}
