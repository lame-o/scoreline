/**
 * The game as one broadcast, part 8: anchors (TheaterAnchors.swift;
 * CHOREOGRAPHY §5.1). Where each known play's decisive moment lands on p, to
 * well under a second.
 *
 * Neither field the feeds give places it alone. Wallclocks are whole seconds
 * and tie (a miss and its rebound share one every time), and in a stoppage
 * they're the stoppage's stamp, not the play's: free throws, substitutions and
 * the rebound that restarts the clock all carry the moment the whistle blew,
 * though they happened up to minutes later, just before play resumed. The game
 * clock reads whole seconds above a minute. So the anchors are solved:
 *
 * 1. **Stretches.** While the clock runs, a play's time is the stretch's
 *    offset plus its game clock: the median of (wallclock − game clock) over
 *    the stretch's live-ball plays, which keeps the clock's relative timing
 *    and the wallclocks' absolute placement and absorbs the quantization.
 * 2. **Stoppages.** Plays at a stopped clock happened before the restart, not
 *    at the stamp: each is placed back from the restart (the timeline's bound,
 *    or where the next stretch says the clock started again) by the sport's
 *    gaps; the rebound that restarts it, at the restart.
 * 3. **Gaps.** Consecutive decisive moments keep the sport's physical minimum
 *    apart (a rebound after the rim, free throws a routine apart).
 * 4. **Solve.** Least squares to the targets subject to the gaps: with
 *    `u = τ − Σgaps` the gaps become `u` nondecreasing, which is weighted
 *    isotonic regression, solved exactly by pool-adjacent-violators. Plays
 *    whose own times mean nothing (admin) are placed between their neighbors.
 * 5. **Frozen.** Anchors already presented never move: the solve runs on what
 *    follows them, starting no earlier than the last one's gap.
 *
 * Pure arithmetic, O(n), deterministic: the Mac's numbers exactly.
 */
import { playAnchor, type PlayAnchor, type PTime, type Span } from "./theaterEngine";

/** One play as the anchor solver reads it, in the timeline's order. */
export interface AnchorInput {
  readonly id: string;
  readonly period: number;
  /** The reported event time (wallclock, MLB's startTime); null: none. */
  readonly eventTime: PTime | null;
  /** Where the moment must lie, when the timeline knows (a play stamped at a stoppage's start lies between the stamp and the clock's restart). */
  readonly bounds: Span | null;
  /** Game clock elapsed in the period (null: no clock, or not given). */
  readonly elapsed: number | null;
  /** The clock's resolution (1 s; 0.1 s under a minute in basketball). */
  readonly resolution: number;
  readonly live: boolean;
  readonly stopsClock: boolean;
  /** How much its own time is believed: 1 a live-ball play's wallclock, 0 placed by its neighbors. */
  readonly weight: number;
  /** The least time from this play's decisive moment to the next play's (the sport's physics table). */
  readonly gapAfter: number;
  /**
   * After its stoppage's plays, the clock restarts this long after it (the
   * inbound after the last free throw); 0 for a play that restarts the clock
   * itself (the rebound off a missed last free throw).
   */
  readonly restartAfter: number;
}

/** An input with Swift's defaults (`resolution` 1, `restartAfter` 1). */
export function anchorInput(
  fields: Omit<AnchorInput, "resolution" | "restartAfter" | "bounds"> & Partial<Pick<AnchorInput, "resolution" | "restartAfter" | "bounds">>,
): AnchorInput {
  return { resolution: 1, restartAfter: 1, bounds: null, ...fields };
}

/** A half-open run of indices (Swift's `Range<Int>`). */
interface Stretch {
  readonly lower: number;
  readonly upper: number;
}

export const AnchorSolver = {
  /** The least gap between two decisive moments of any kind: never two in one instant. */
  least: 0.15,

  /**
   * Anchors for every play, in order; those in `frozen` keep theirs and the
   * rest start no earlier than the last frozen one allows.
   */
  solve(plays: readonly AnchorInput[], frozen: ReadonlyMap<string, PTime> = new Map()): Map<string, PlayAnchor> {
    const out = new Map<string, PlayAnchor>();
    if (plays.length === 0) return out;
    const n = plays.length;
    // The frozen prefix: up to the last play with a frozen anchor.
    let last = -1;
    for (let i = n - 1; i >= 0; i--) {
      if (frozen.has(plays[i]!.id)) {
        last = i;
        break;
      }
    }
    let floor = -Infinity;
    if (last >= 0) {
      let previous = -Infinity;
      for (let i = 0; i <= last; i++) {
        // A play behind the last frozen one without an anchor of its own sits just after the one before it.
        const at = frozen.get(plays[i]!.id) ?? (Number.isFinite(previous) ? previous + AnchorSolver.gap(plays[Math.max(i - 1, 0)]!) : frozen.get(plays[last]!.id)!);
        out.set(plays[i]!.id, playAnchor(at));
        previous = at;
      }
      floor = previous + AnchorSolver.gap(plays[last]!);
    }
    const start = last + 1;
    if (start >= n) return out;
    const suffix = plays.slice(start);
    const { targets, weights } = AnchorSolver.targets(suffix);
    const solved = AnchorSolver.place(
      targets,
      weights,
      suffix.map((p) => AnchorSolver.gap(p)),
      suffix.map((p) => p.bounds),
      floor,
    );
    suffix.forEach((play, k) => out.set(play.id, playAnchor(solved[k]!)));
    return out;
  },

  gap(play: AnchorInput): number {
    return Math.max(play.gapAfter, AnchorSolver.least);
  },

  // MARK: Targets

  /** Each play's target time and how much it's believed (§5.1 steps 1–2). */
  targets(plays: readonly AnchorInput[]): { targets: (number | null)[]; weights: number[] } {
    const n = plays.length;
    const targets: (number | null)[] = plays.map((p) => (p.bounds ? Math.min(Math.max(p.eventTime ?? p.bounds.lower, p.bounds.lower), p.bounds.upper) : p.eventTime));
    const weights = plays.map((p) => (p.eventTime == null && p.bounds == null ? 0 : p.weight));
    // Running-clock stretches: from a play after the clock restarted through the play that stops it.
    const stretches: Stretch[] = [];
    let i = 0;
    while (i < n) {
      if (plays[i]!.elapsed == null) {
        i += 1;
        continue;
      }
      let j = i;
      while (j + 1 < n && !plays[j]!.stopsClock && plays[j + 1]!.period === plays[i]!.period) {
        const a = plays[j]!.elapsed;
        const b = plays[j + 1]!.elapsed;
        if (a == null || b == null || !(b >= a - 1e-9)) break;
        j += 1;
      }
      stretches.push({ lower: i, upper: j + 1 });
      i = j + 1;
      // The plays at the clock it stopped at: the stoppage, placed below.
      const stop = plays[j]!.elapsed;
      if (stop != null && plays[j]!.stopsClock) {
        while (i < n && plays[i]!.period === plays[j]!.period) {
          const g = plays[i]!.elapsed;
          if (g == null || !(Math.abs(g - stop) <= Math.max(plays[i]!.resolution, 1e-9) * 0.51)) break;
          i += 1;
        }
      }
    }
    // Each stretch's offset (wallclock − game clock) over its live-ball plays.
    const offsets = new Map<Stretch, number>();
    for (const s of stretches) {
      const samples: number[] = [];
      for (let k = s.lower; k < s.upper; k++) {
        const p = plays[k]!;
        if (!p.live || !(p.weight > 0) || p.bounds != null || p.eventTime == null || p.elapsed == null) continue;
        samples.push(p.eventTime - p.elapsed);
      }
      if (samples.length === 0) continue;
      const offset = AnchorSolver.median(samples);
      offsets.set(s, offset);
      for (let k = s.lower; k < s.upper; k++) {
        const g = plays[k]!.elapsed;
        if (g == null) continue;
        targets[k] = offset + g;
        if (plays[k]!.bounds == null) weights[k] = Math.max(weights[k]!, plays[k]!.live ? 1 : 0.75);
      }
    }
    // Stoppages: the plays after a clock-stopping play at its clock, placed back from the restart.
    stretches.forEach((s, m) => {
      const stopper = s.upper - 1;
      const stop = plays[stopper]!.elapsed;
      if (!plays[stopper]!.stopsClock || stop == null) return;
      const next = m + 1 < stretches.length ? stretches[m + 1]! : null;
      const members: number[] = [];
      for (let k = stopper + 1; k < (next?.lower ?? plays.length); k++) {
        const g = plays[k]!.elapsed;
        if (plays[k]!.period !== plays[stopper]!.period || g == null) continue;
        if (Math.abs(g - stop) <= 0.51 * Math.max(plays[k]!.resolution, 1e-9)) members.push(k);
      }
      const lastMember = members[members.length - 1];
      if (lastMember == null) return;
      // The restart: the timeline's bound; else where the next stretch's clock reads the stop again.
      let restart: number | null = plays[lastMember]!.bounds?.upper ?? null;
      if (restart == null && next && plays[next.lower]!.period === plays[stopper]!.period) {
        const offset = offsets.get(next);
        if (offset != null) restart = offset + stop;
      }
      if (restart == null) return;
      const low = targets[stopper] ?? plays[stopper]!.eventTime ?? -Infinity;
      // Backward from the restart by the gaps (the last one restarts it, or a moment before it).
      let at = restart - plays[lastMember]!.restartAfter;
      for (let r = members.length - 1; r >= 0; r--) {
        const k = members[r]!;
        if (k !== lastMember) at -= AnchorSolver.gap(plays[k]!);
        targets[k] = Math.max(at, low + AnchorSolver.gap(plays[stopper]!));
        weights[k] = 1;
      }
    });
    return { targets, weights };
  },

  median(values: readonly number[]): number {
    const s = [...values].sort((a, b) => a - b);
    return s.length % 2 === 1 ? s[s.length >> 1]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
  },

  // MARK: Solving

  /**
   * The times nearest the targets (weighted least squares) with each gap
   * kept, none before `floor`; unweighted plays between their neighbors;
   * bounds held where the gaps allow.
   */
  place(targets: readonly (number | null)[], weights: readonly number[], gaps: readonly number[], bounds: readonly (Span | null)[], floor: number): number[] {
    const n = targets.length;
    const before = new Array<number>(n).fill(0);
    for (let i = 1; i < Math.max(n, 1); i++) before[i] = before[i - 1]! + gaps[i - 1]!;
    // Isotonic regression of (target − gaps before) over the plays that have a target.
    const fitted: number[] = [];
    for (let i = 0; i < n; i++) if (targets[i] != null && weights[i]! > 0) fitted.push(i);
    const u = new Array<number>(n).fill(Number.NaN);
    if (fitted.length > 0) {
      const y = fitted.map((i) => targets[i]! - before[i]!);
      const w = fitted.map((i) => weights[i]!);
      const solved = AnchorSolver.isotonic(y, w);
      fitted.forEach((i, k) => {
        u[i] = solved[k]!;
      });
    }
    // The rest: between their neighbors (u is nondecreasing, so anything between theirs keeps the gaps).
    const known: number[] = [];
    for (let i = 0; i < n; i++) if (!Number.isNaN(u[i]!)) known.push(i);
    if (known.length === 0) {
      // Nothing believed: the first time anyone gives, else the floor, then the gaps.
      const base = targets.find((t) => t != null) ?? (Number.isFinite(floor) ? floor : 0);
      for (let i = 0; i < n; i++) u[i] = base - before[0]!;
    } else {
      for (let i = 0; i < n; i++) {
        if (!Number.isNaN(u[i]!)) continue;
        let l: number | null = null;
        for (const k of known) if (k < i) l = k;
        const r = known.find((k) => k > i) ?? null;
        if (l != null && r != null) u[i] = u[l]! + ((u[r]! - u[l]!) * (i - l)) / (r - l);
        else if (l != null) u[i] = u[l]!;
        else if (r != null) u[i] = u[r]!;
      }
    }
    // The floor (a frozen anchor's gap): clamping a nondecreasing sequence keeps it so, and is the projection.
    const tau = u.map((x, i) => Math.max(x, floor - before[0]!) + before[i]!);
    // Bounds: below, raised and the gaps carried forward; above, lowered where the gaps behind allow.
    for (let i = 0; i < n; i++) {
      const b = bounds[i];
      if (b && tau[i]! > b.upper) tau[i] = Math.max(b.upper, i > 0 ? tau[i - 1]! + gaps[i - 1]! : -Infinity);
      if (b) tau[i] = Math.max(tau[i]!, b.lower);
      if (i > 0) tau[i] = Math.max(tau[i]!, tau[i - 1]! + gaps[i - 1]!);
      if (i === 0 && Number.isFinite(floor)) tau[0] = Math.max(tau[0]!, floor);
    }
    return tau;
  },

  /**
   * Weighted isotonic regression by pool-adjacent-violators: the
   * nondecreasing sequence nearest `y` in Σ w·(u − y)².
   */
  isotonic(y: readonly number[], w: readonly number[]): number[] {
    const blocks: { sum: number; weight: number; count: number }[] = [];
    for (let i = 0; i < y.length; i++) {
      const wi = Math.max(w[i]!, 1e-12);
      blocks.push({ sum: y[i]! * wi, weight: wi, count: 1 });
      while (blocks.length > 1) {
        const b = blocks[blocks.length - 1]!;
        const a = blocks[blocks.length - 2]!;
        if (!(a.sum / a.weight > b.sum / b.weight)) break;
        blocks.splice(blocks.length - 2, 2, { sum: a.sum + b.sum, weight: a.weight + b.weight, count: a.count + b.count });
      }
    }
    const out: number[] = [];
    for (const b of blocks) for (let k = 0; k < b.count; k++) out.push(b.sum / b.weight);
    return out;
  },
};
