/**
 * The game as one broadcast, part 2: the presentation clock
 * (PresentationClock.swift; BROADCAST.md §2).
 *
 * p = now − D: the moment of the game being presented. D is per game and
 * adaptive (the timeline's `targetDelay`: the live-ball lag quantile, the
 * lead-in, a margin) and never jumps; the clock slews toward it at 0.92–1.08×,
 * which nobody can see. The only discontinuities are declared:
 *
 * - **Start and wake**: the live edge, without telling what came before.
 * - **Jump**: more than `jumpMax` behind the target (a long stall): toward the
 *   live edge, a crossfade, the plays in between told as history. Never over a
 *   play that must be told live (a score, a VAR decision, a shot, a card: the
 *   timeline's `jumpLimit`): it lands just short of the first one, and the rest
 *   of the deficit is made up in dead time (skips) and by the slew.
 * - **Skip**: across a stoppage the clock may move instantly, forward to catch
 *   up or by holding still to fall back, because nothing on screen changes
 *   there (no play to tell, the game clock stopped). That's where TV puts its
 *   catch-ups too, and it's why a stall rarely costs anything once play stops.
 *
 * And the rule over all of them: **p never passes the watermark less the
 * binding horizon.** The watermark moves on hard evidence only (BROADCAST §1),
 * so it rarely binds; approaching it, the clock first slews down (0.92×), then
 * eases to a stop there and holds (a stall); the presented game clock holds
 * with it, and the page goes on living (the theater keeps its ambient motion
 * on wall time, the heartbeat keeps beating).
 *
 * The clock is a plan: a few pieces of constant acceleration (p(t) is C¹
 * everywhere except the declared jumps and the slew's 8% rate steps), re-made
 * from the current p and rate whenever the inputs change. Pure and
 * deterministic: callers pass `now` (seconds since 1970, timeline.ts `PTime`).
 */
import type { BroadcastPolicy, PTime } from "./timeline";

/** What the clock did, for the page (a jump crossfades) and the bench (it counts them). */
export type ClockEvent =
  /** Opened at the live edge. */
  | { readonly kind: "start"; readonly at: PTime; readonly p: PTime }
  /** Woke (or came back to the page) and went to the live edge. */
  | { readonly kind: "wake"; readonly at: PTime; readonly from: PTime; readonly to: PTime }
  /** More than `jumpMax` behind: a declared jump to the live edge. */
  | { readonly kind: "jump"; readonly at: PTime; readonly from: PTime; readonly to: PTime }
  /** Across a stoppage, where nothing on screen changes. */
  | { readonly kind: "skip"; readonly at: PTime; readonly from: PTime; readonly to: PTime }
  /** Began holding at the watermark (`p`), and when it let go. */
  | { readonly kind: "stall"; readonly at: PTime; readonly p: PTime }
  | { readonly kind: "resume"; readonly at: PTime; readonly held: number };

/**
 * What the clock is doing now: "off"; "tracking" (at the target delay, rate 1);
 * "catchingUp" or "fallingBack" (slewing toward the target); "stretching" (held
 * still inside a stoppage while the delay grows to its target); "stalled" (held
 * at the watermark: nothing more is known yet).
 */
export type Regime = "off" | "tracking" | "catchingUp" | "fallingBack" | "stretching" | "stalled";

export interface Tuning {
  /** The slew's bounds: nobody sees an 8% change of pace. */
  readonly slow: number;
  readonly fast: number;
  /** Within this of the target, run at 1×. */
  readonly deadband: number;
  /** More than this behind the target: a declared jump. */
  readonly jumpMax: number;
  /** Skip and stretch inside stoppages. */
  readonly stoppages: boolean;
  /** A skip shorter than this isn't worth one. */
  readonly minSkip: number;
  /**
   * A jump shorter than this isn't worth a crossfade: the clock catches up by running
   * (held at the watermark, it would otherwise "jump" a few seconds at every read).
   */
  readonly minJump: number;
  /** Easing into a hold, and out of one. */
  readonly ease: number;
  /** Within this much p of the cap, slew down before the ease. */
  readonly approach: number;
  /** Updates further apart than this (sleep, another page, a hidden tab) are a wake. */
  readonly wakeGap: number;
}

export const DEFAULT_TUNING: Tuning = { slow: 0.92, fast: 1.08, deadband: 0.25, jumpMax: 40, stoppages: true, minSkip: 0.75, minJump: 10, ease: 1.0, approach: 5, wakeGap: 30 };

export function tuningFor(policy: BroadcastPolicy): Tuning {
  return { ...DEFAULT_TUNING, jumpMax: policy.jumpMax, stoppages: policy.skipStoppages, approach: policy.approach };
}

/** What the timeline says now. */
export interface ClockInputs {
  /** The delay to aim for. */
  readonly target: number;
  /** The latest p may present: the watermark less the lead-in. */
  readonly cap: PTime;
  /** p may move instantly up to here (a stoppage with nothing to tell); null: nowhere. */
  readonly quietUntil?: PTime | null;
  /**
   * A jump lands no later than here: just short of the first untold play that
   * must be told live (its lead-in included); null: anywhere up to the edge.
   */
  readonly jumpLimit?: PTime | null;
}

/** One piece of the plan: p(t) = p0 + v0·(t − t0) + a·(t − t0)²/2, for t in [t0, t1). */
export class Piece {
  constructor(
    public t0: PTime,
    public p0: PTime,
    public v0: number,
    public a = 0,
    public t1: PTime = Infinity,
  ) {}

  p(t: PTime): PTime {
    const dt = t - this.t0;
    return this.p0 + this.v0 * dt + 0.5 * this.a * dt * dt;
  }

  v(t: PTime): number {
    return this.v0 + this.a * (t - this.t0);
  }

  /** When p reaches `target` in this piece, if it does. */
  timeReaching(target: PTime): PTime | null {
    const d = target - this.p0;
    if (d <= 0) return this.t0;
    let dt: number | null = null;
    if (Math.abs(this.a) < 1e-12) {
      if (this.v0 > 1e-9) dt = d / this.v0;
    } else {
      const disc = this.v0 * this.v0 + 2 * this.a * d;
      if (disc >= 0) {
        const root = (-this.v0 + Math.sqrt(disc)) / this.a;
        if (root >= 0) dt = root;
        else {
          const other = (-this.v0 - Math.sqrt(disc)) / this.a;
          if (other >= 0) dt = other;
        }
      }
    }
    if (dt == null || !(this.t0 + dt < this.t1)) return null;
    return this.t0 + dt;
  }

  copy(): Piece {
    return new Piece(this.t0, this.p0, this.v0, this.a, this.t1);
  }

  same(other: Piece): boolean {
    return this.t0 === other.t0 && this.p0 === other.p0 && this.v0 === other.v0 && this.a === other.a && this.t1 === other.t1;
  }
}

export class PresentationClock {
  readonly tuning: Tuning;
  pieces: Piece[] = [];
  target = 0;
  cap: PTime = -Infinity;
  regime: Regime = "off";
  lastUpdate: PTime | null = null;
  /** Since when the clock has been held at the watermark (null: not stalled). */
  stalledSince: PTime | null = null;
  /** What it did, newest last (bounded). */
  events: ClockEvent[] = [];
  /** A cursor independent of the bounded history's length. Long games still deliver new clock events. */
  eventRevision = 0;

  constructor(tuning: Tuning = DEFAULT_TUNING) {
    this.tuning = tuning;
  }

  /** A copy (Swift's value semantics: the page publishes a clock that the engine's next plan doesn't move). */
  clone(): PresentationClock {
    const c = new PresentationClock(this.tuning);
    c.pieces = this.pieces.map((p) => p.copy());
    c.target = this.target;
    c.cap = this.cap;
    c.regime = this.regime;
    c.lastUpdate = this.lastUpdate;
    c.stalledSince = this.stalledSince;
    c.events = [...this.events];
    c.eventRevision = this.eventRevision;
    return c;
  }

  eventsSince(revision: number): ClockEvent[] {
    const n = Math.min(this.eventRevision - revision, this.events.length);
    return n > 0 ? this.events.slice(-n) : [];
  }

  get started(): boolean {
    return this.pieces.length > 0;
  }

  // MARK: Reading

  /** The moment of the game presented at wall time `t`. */
  p(t: PTime): PTime {
    const piece = this.piece(t);
    return piece ? piece.p(t) : -Infinity;
  }

  /** The clock's rate at `t` (1: real time, 0: holding). */
  rate(t: PTime): number {
    return this.piece(t)?.v(t) ?? 0;
  }

  /** How far behind the game the page is at `t`: D. */
  delay(t: PTime): number {
    return t - this.p(t);
  }

  /**
   * The wall time at which p reaches `target`: null if the plan never gets
   * there (it holds short of it). Past targets are now (`after`).
   */
  wallReaching(target: PTime, after: PTime): PTime | null {
    if (!this.started) return null;
    const now = after;
    if (this.p(now) >= target) return now;
    for (const piece of this.pieces) {
      if (!(piece.t1 > now)) continue;
      const start = Math.max(piece.t0, now);
      if (!(piece.p(start) < target || piece.t0 >= now)) return start;
      const t = piece.timeReaching(target);
      if (t != null && t >= start) return t;
    }
    return null;
  }

  /** Whether the clock is held at the watermark at `t`, and for how long. */
  stalled(t: PTime): number | null {
    if (this.regime !== "stalled" || this.stalledSince == null || !(t >= this.stalledSince)) return null;
    return t - this.stalledSince;
  }

  private piece(t: PTime): Piece | null {
    const first = this.pieces[0];
    if (!first) return null;
    if (t < first.t0) return first;
    for (let i = this.pieces.length - 1; i >= 0; i--) if (this.pieces[i]!.t0 <= t) return this.pieces[i]!;
    return first;
  }

  // MARK: Planning

  /**
   * Re-plans from `now` with what the timeline says. Continuous in p (and in
   * rate, but for the slew's small steps), except the declared jumps.
   */
  update(now: PTime, inputs: ClockInputs): void {
    this.target = inputs.target;
    this.cap = inputs.cap;
    const edge = Math.min(now - inputs.target, inputs.cap);
    const last = this.lastUpdate;
    if (!this.started || last == null) {
      this.pieces = [new Piece(now, edge, 1)];
      this.note({ kind: "start", at: now, p: edge });
      this.plan(now, edge, 1, inputs);
      this.lastUpdate = now;
      return;
    }
    let p = this.p(now);
    let v = this.rate(now);
    const limit = inputs.jumpLimit ?? Infinity;
    // Asleep, or away on another page: the live edge, as on opening.
    if (now - last > this.tuning.wakeGap) {
      const to = Math.max(p, edge);
      this.note({ kind: "wake", at: now, from: p, to });
      p = to;
      v = 1;
    } else if (now - p - inputs.target > this.tuning.jumpMax && Math.min(edge, limit) - p >= this.tuning.minJump) {
      // Far behind (a long stall): a declared jump, landing short of any play that must be told live.
      const to = Math.min(edge, limit);
      this.note({ kind: "jump", at: now, from: p, to });
      p = to;
      v = 1;
    } else if (this.tuning.stoppages && now - p - inputs.target > this.tuning.minSkip && inputs.quietUntil != null && inputs.quietUntil > p) {
      // Behind, inside a stoppage: catch up where nothing on screen changes.
      const to = Math.min(now - inputs.target, inputs.quietUntil, inputs.cap);
      if (to - p >= this.tuning.minSkip) {
        this.note({ kind: "skip", at: now, from: p, to });
        p = to;
      }
    }
    this.plan(now, p, v, inputs);
    this.lastUpdate = now;
  }

  /**
   * The pieces from (now, p, v): the slew (or a stretch inside a stoppage),
   * then real time, eased to a hold short of the cap.
   */
  private plan(now: PTime, p: PTime, v: number, inputs: ClockInputs): void {
    const t = this.tuning;
    const d = now - p;
    let plan: Piece[] = [];
    const wasStalled = this.regime === "stalled";
    const quiet = inputs.quietUntil ?? null;
    if (p >= inputs.cap - 1e-6) {
      // At the watermark: hold.
      plan = [new Piece(now, p, 0)];
      this.regime = d < inputs.target - t.deadband && quiet != null && quiet > p ? "stretching" : "stalled";
    } else if (t.stoppages && d < inputs.target - t.deadband && quiet != null && quiet > p) {
      // Ahead of the target, inside a stoppage: hold still until the delay has grown to it.
      const until = p + inputs.target;
      plan = PresentationClock.capped([new Piece(now, p, 0, 0, until), new Piece(until, p, 1)], inputs.cap, t.ease, t.approach, t.slow);
      this.regime = "stretching";
    } else {
      const r = d > inputs.target + t.deadband ? t.fast : d < inputs.target - t.deadband ? t.slow : 1;
      this.regime = r > 1 ? "catchingUp" : r < 1 ? "fallingBack" : "tracking";
      let at = now;
      let pAt = p;
      // Out of a hold: ease up to pace rather than lurch.
      if (v < r - 0.01) {
        const a = (r - v) / t.ease;
        plan.push(new Piece(at, pAt, v, a, at + t.ease));
        pAt = plan[0]!.p(at + t.ease);
        at += t.ease;
      }
      if (r !== 1) {
        // Until D reaches the target: D(t) = d' + (1 − r)(t − t').
        const dNow = at - pAt;
        const reach = at + Math.max((inputs.target - dNow) / (1 - r), 0);
        plan.push(new Piece(at, pAt, r, 0, reach));
        pAt += r * (reach - at);
        at = reach;
      }
      plan.push(new Piece(at, pAt, 1));
      plan = PresentationClock.capped(plan, inputs.cap, t.ease, t.approach, t.slow);
    }
    // Seal the pieces' ends.
    for (let i = 0; i < plan.length - 1; i++) plan[i]!.t1 = plan[i + 1]!.t0;
    this.pieces = plan;
    if (this.regime === "stalled") {
      if (!wasStalled || this.stalledSince == null) {
        this.stalledSince = now;
        this.note({ kind: "stall", at: now, p });
      }
    } else if (wasStalled && this.stalledSince != null) {
      this.note({ kind: "resume", at: now, held: now - this.stalledSince });
      this.stalledSince = null;
    } else {
      this.stalledSince = null;
    }
  }

  /**
   * The plan, approaching `cap`: within `approach` of it, no faster than
   * `slow` (the slew's low bound); then, the first time p comes within its
   * braking distance (`ease`·v/2), a uniform deceleration to rest exactly
   * at the cap, and a hold.
   */
  static capped(plan: readonly Piece[], cap: PTime, ease: number, approach = 0, slow = 1): Piece[] {
    if (!Number.isFinite(cap)) return [...plan];
    const out: Piece[] = [];
    for (const piece of plan) {
      if (approach > 0) {
        const t = piece.timeReaching(cap - approach);
        if (t != null && piece.v(t) > slow + 1e-9) {
          const head = piece.copy();
          head.t1 = t;
          if (t > piece.t0) out.push(head);
          return [...out, ...PresentationClock.capped([new Piece(t, piece.p(t), slow)], cap, ease)];
        }
      }
      const v = Math.max(piece.v0, piece.v(Math.min(piece.t1, piece.t0 + 3600)));
      const brake = 0.5 * Math.max(v, 0.01) * ease;
      const t = piece.timeReaching(cap - brake);
      if (t != null) {
        const head = piece.copy();
        head.t1 = t;
        if (t > piece.t0) out.push(head);
        const vEase = Math.max(piece.v(t), 0.01);
        const pEase = piece.p(t);
        const distance = Math.max(cap - pEase, 0);
        const duration = distance > 0 ? (2 * distance) / vEase : 0;
        if (duration > 0) out.push(new Piece(t, pEase, vEase, -vEase / duration, t + duration));
        out.push(new Piece(t + duration, cap, 0));
        return out;
      }
      out.push(piece);
    }
    return out;
  }

  private note(event: ClockEvent): void {
    this.eventRevision += 1;
    this.events.push(event);
    if (this.events.length > 400) this.events.splice(0, this.events.length - 400);
  }

  /**
   * Whether another plan presents the same p over the next minute (within a
   * millisecond): a re-plan that changes nothing isn't republished, so nothing
   * reading the clock re-renders for it (Broadcast.swift `presentsSame`).
   */
  presentsSame(other: PresentationClock, now: PTime): boolean {
    if (this.started !== other.started || this.regime !== other.regime) return false;
    for (let dt = 0; dt <= 60; dt += 2.5) if (Math.abs(this.p(now + dt) - other.p(now + dt)) > 0.001) return false;
    return true;
  }
}

/** Swift's `Event ==`: the same kind with the same numbers. */
export function sameClockEvent(a: ClockEvent, b: ClockEvent): boolean {
  if (a.kind !== b.kind) return false;
  const x = a as unknown as Record<string, unknown>;
  const y = b as unknown as Record<string, unknown>;
  return Object.keys(x).every((k) => x[k] === y[k]) && Object.keys(y).length === Object.keys(x).length;
}
