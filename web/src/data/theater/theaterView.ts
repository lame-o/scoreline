/**
 * The game as one broadcast, part 15: the theater's view, its pure half
 * (TheaterView.swift; CHOREOGRAPHY §5.6.7, §5.7, §10). The canvas loop that
 * runs it is features/game/core/theater/directedStage.ts.
 *
 * It draws only what's seen, and only while something moves: at the
 * display's own rate (requestAnimationFrame) whenever anything on screen is
 * moving, and not at all when nothing is, or when the theater is folded or
 * scrolled away (the clock and the plan carry on). Between the two is one
 * wake, at the moment the plan's next tier begins on the theater's time,
 * across a hold of the clock as well as any other stretch of it.
 *
 * Reduce Motion: the same clock and the same plan, shown as key states (each
 * clip's decisive moment and its end), each crossfading into the next over a
 * quarter second on the house ease-out: no travel, no camera moves.
 */
import type { TheaterClip } from "./theaterClips";
import type { TheaterTime } from "./theaterDirector";
import { TheaterCurve, type ActorID, type PTime } from "./theaterEngine";
import { TheaterCast, hitFigure, type CastKey, type CastMember, type HitFigure } from "./theaterNames";
import type { FrameTier, Plan, PlanChain } from "./theaterPlanChain";
import type { TheaterClock } from "./theaterSource";

/** Whether a directed theater should be drawing, and when that next changes. (pure; tested) */
export const TheaterFrameGate = {
  /**
   * How far ahead of a tier that moves the frames start, so that the first
   * frame past its start isn't left to a timer's lateness: two frames of a
   * still field cost nothing to see.
   */
  lead: 2 / 60,
  /** How long frames carry on past a tier that moves, so that its end is drawn where it comes to rest. */
  tail: 1 / 60,

  tier(tiers: readonly FrameTier[], T: PTime): FrameTier | null {
    if (tiers.length === 0) return null;
    let lo = 0;
    let hi = tiers.length - 1;
    if (T < tiers[0]!.from) return tiers[0]!;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (tiers[mid]!.from <= T) lo = mid;
      else hi = mid - 1;
    }
    return tiers[lo]!;
  },

  /** `moving`: draw now; `wake`: the wall time that next changes (null: it doesn't, on this plan). */
  state(tiers: readonly FrameTier[], time: TheaterTime, clock: TheaterClock, now: PTime): { moving: boolean; wake: PTime | null } {
    const { lead, tail } = TheaterFrameGate;
    const T = time.at(now, clock);
    const here = TheaterFrameGate.tier(tiers, T);
    if (!here) return { moving: false, wake: null };
    // A tier that moves is drawn from a little before its start, and a little past its end.
    const moving = here.moves || TheaterFrameGate.tier(tiers, T + lead)?.moves === true || TheaterFrameGate.tier(tiers, T - tail)?.moves === true;
    // The next moment that answer changes, on the theater's time.
    let target: PTime | null;
    if (moving) {
      let until = here.from;
      for (const t of tiers) {
        if (!(t.until > T)) continue;
        if (!t.moves && t.until - t.from > lead + tail + 1e-6) {
          until = t.from;
          break;
        }
        until = t.until;
      }
      target = until > T || !here.moves ? until + tail : null;
      if (target != null && target <= T) return { moving: true, wake: now + 1 / 60 };
    } else {
      const next = tiers.find((t) => t.moves && t.from > T);
      target = next ? next.from - lead : null;
    }
    if (target == null || !Number.isFinite(target)) return { moving, wake: null };
    return { moving, wake: time.wallReaching(target, clock, now) };
  },
};

/** The key states Reduce Motion shows: each clip's decisive moment and its end, on the theater's time. */
export const TheaterKeyStates = {
  keys<Clip extends TheaterClip>(plan: Plan<Clip>): PTime[] {
    const keys: PTime[] = [plan.start];
    for (const p of plan.placements) {
      if (p.clip.decisive != null) keys.push(p.offset + p.clip.decisive);
      keys.push(p.offset + p.clip.length);
    }
    return keys.sort((a, b) => a - b);
  },

  /** The key state shown at T, the one before it, and how far the crossfade between them is (1: done). */
  shown(keys: readonly PTime[], T: PTime): { now: PTime; before: PTime | null; fade: number } {
    let k = -1;
    for (let i = keys.length - 1; i >= 0; i--) {
      if (keys[i]! <= T) {
        k = i;
        break;
      }
    }
    if (k < 0) return { now: T, before: null, fade: 1 };
    const fade = Math.min(Math.max((T - keys[k]!) / 0.25, 0), 1);
    return { now: keys[k]!, before: k > 0 ? keys[k - 1]! : null, fade: TheaterCurve.out(fade) };
  },
};

/**
 * A directed theater's scoring moments, for the page's scoring slides
 * (CHOREOGRAPHY §12): each scoring play's `Cue.scored` on the theater's time,
 * and the theater's time at a wall time. The slide lands with the theater's
 * decisive frame because both are the plan's.
 */
export class TheaterCues {
  private _scored: { id: string; at: PTime }[] = [];
  private time: (wall: PTime) => PTime | null = () => null;
  private readonly listeners = new Set<() => void>();

  get scored(): readonly { id: string; at: PTime }[] {
    return this._scored;
  }

  publish<Clip extends TheaterClip>(chain: PlanChain<Clip>, time: (wall: PTime) => PTime | null): void {
    const out: { id: string; at: PTime }[] = [];
    for (const plan of chain.plans) {
      for (const cue of plan.plan.cues) {
        if (cue.kind.kind !== "scored") continue;
        const id = cue.kind.play;
        const i = out.findIndex((c) => c.id === id);
        if (i >= 0) out.splice(i, 1);
        out.push({ id, at: cue.at });
      }
    }
    this._scored = out.sort((a, b) => a.at - b.at);
    this.time = time;
    for (const l of [...this.listeners]) l();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The scoring play the theater is at (its decisive moment come, or the next to come). */
  playing(wall: PTime): string | null {
    const T = this.time(wall);
    if (T == null) return null;
    let come: string | null = null;
    for (const c of this._scored) if (c.at <= T + 0.5) come = c.id;
    return come ?? this._scored.find((c) => c.at > T)?.id ?? null;
  }

  /** Seconds from now to that play's decisive frame. */
  climax(wall: PTime): number | null {
    const T = this.time(wall);
    const id = this.playing(wall);
    if (T == null || id == null) return null;
    const cue = this._scored.find((c) => c.id === id);
    return cue ? Math.max(cue.at - T, 0) : null;
  }

  /** When that play's decisive frame is (seconds since 1970, wall), for a slide that waits for it. */
  climaxOf(id: string, wall: PTime): number | null {
    const T = this.time(wall);
    const cue = this._scored.find((c) => c.id === id);
    if (T == null || !cue) return null;
    return wall + Math.max(cue.at - T, 0);
  }
}

/**
 * A directed theater's frame on screen, for the pointer's tag: each man's
 * spot through the camera, and who he is (the cast of the clip in charge,
 * keyed by the engine's men). Written as each frame is drawn, never rendered from.
 */
export class DirectedFrame {
  private _figures: readonly HitFigure[] = [];
  private _cast = new TheaterCast();
  private castKey = "";

  get figures(): readonly HitFigure[] {
    return this._figures;
  }

  get cast(): TheaterCast {
    return this._cast;
  }

  /** The member under the pointer. */
  member(point: { x: number; y: number }): string | null {
    const index = hitFigure(this._figures, point);
    return index == null ? null : (this._cast.members.get(index)?.id ?? null);
  }

  update(figures: readonly HitFigure[]): void {
    this._figures = figures;
  }

  /** The clip's cast (by its figures) as the engine's men play them, built once per clip in charge. */
  castFor(key: string, men: readonly ActorID[], byFigure: () => TheaterCast): TheaterCast {
    if (key === this.castKey) return this._cast;
    const mine = byFigure();
    const members = new Map<number, CastMember>();
    for (const [i, m] of mine.members) if (i < men.length) members.set(men[i]!, m);
    const keys: CastKey[] = mine.keys.map((k) => ({ from: k.from, figure: k.figure != null && k.figure < men.length ? men[k.figure]! : null }));
    this._cast = new TheaterCast(members, keys, mine.scope);
    this.castKey = key;
    return this._cast;
  }
}
