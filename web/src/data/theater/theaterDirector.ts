/**
 * The game as one broadcast, part 14: the director (TheaterDirector.swift;
 * CHOREOGRAPHY §4.2, §4.5).
 *
 * The only stateful part of the engine. It holds the plan chain, decides when
 * to re-plan (new plays, a revision, the clock holding, resuming or skipping,
 * the viewer turning the court), plans and bakes, and splices the result in.
 * It never re-plans on a timer; the one wake it schedules is the plan's own
 * horizon running out (the court between plays goes on round by round while
 * nothing new comes).
 *
 * The theater's time. The chain is indexed by the theater's own time `T`, not
 * by p. While p runs (its gentle slews included), T is p plus a fixed shift,
 * so every play's decisive moment lands as p reaches it. While p holds (a
 * stall at the watermark, a stretch inside a stoppage) or eases into or out of
 * a hold, T runs on wall time: the field never freezes, and what plays there
 * is the court between plays, never a play the clock hasn't reached (plays
 * past the hold wait for it to let go). A skip moves p across a stoppage and T
 * not at all. Only a declared jump (opening, waking, a Jmax catch-up) moves T
 * with p. The shift changes only in those holds and skips, and each change
 * re-plans, so anchors are always placed at `τ + shift`.
 *
 * Web: the Mac plans on a serial actor off the main thread; a plan here holds
 * closures over its scripts, which a worker can't take, so it's made on the
 * main thread in a task of its own (never inside a frame or a React render),
 * one at a time, exactly as the actor serializes them.
 */
import type { TheaterClip } from "./theaterClips";
import type { ActorIDs } from "./theaterClips";
import { TheaterTiming, type PTime } from "./theaterEngine";
import { PlanChain, TheaterBake, type BakedPlan, type Plan } from "./theaterPlanChain";
import type { ClockEvent, ClockPiece, RawPlay, TheaterClock, TimelinePlay, TimelineSnapshot } from "./theaterSource";

/** The theater's own time (see above): pure, advanced by the clock's pieces. */
export class TheaterTime {
  /** T at `wall` (the last time it was advanced). */
  private _t = 0;
  private _wall: PTime | null = null;
  /** T − p at `wall`. */
  private _shift = 0;

  get t(): PTime {
    return this._t;
  }

  get wall(): PTime | null {
    return this._wall;
  }

  get shift(): number {
    return this._shift;
  }

  get started(): boolean {
    return this._wall != null;
  }

  copy(): TheaterTime {
    const c = new TheaterTime();
    c._t = this._t;
    c._wall = this._wall;
    c._shift = this._shift;
    return c;
  }

  /** How T runs on a piece of the clock: with p while p runs at a pace (a slew is a pace), on wall time otherwise. */
  static follows(piece: ClockPiece): boolean {
    return piece.a === 0 && piece.v0 >= 0.85 && piece.v0 <= 1.15;
  }

  /** T at wall time `now`, from the last advance, on `clock`'s pieces (valid since then). */
  at(now: PTime, clock: TheaterClock): PTime {
    const wall = this._wall;
    if (wall == null) return clock.p(now);
    if (!(now > wall)) return this._t - (wall - now);
    let t = this._t;
    let from = wall;
    for (const piece of clock.pieces) {
      if (!(piece.t1 > from && piece.t0 < now)) continue;
      const a = Math.max(piece.t0, from);
      const b = Math.min(piece.t1, now);
      if (!(b > a)) continue;
      t += TheaterTime.follows(piece) ? piece.p(b) - piece.p(a) : b - a;
      from = b;
    }
    if (now > from) t += now - from;
    return t;
  }

  /**
   * The wall time T reaches `target` on `clock`'s pieces (T never runs
   * backward: a bisection), from `now` on; null if it's already past or
   * beyond a day.
   */
  wallReaching(target: PTime, clock: TheaterClock, now: PTime): PTime | null {
    if (!(this.at(now, clock) < target)) return null;
    let lo = now;
    let hi = now + Math.max(target - this.at(now, clock), 0.5);
    let guardSteps = 0;
    while (this.at(hi, clock) < target && guardSteps < 40) {
      hi = now + (hi - now) * 2;
      guardSteps += 1;
      if (hi - now > 86_400) return null;
    }
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (this.at(mid, clock) < target) lo = mid;
      else hi = mid;
    }
    return hi;
  }

  /** Advances to `now` on the clock that ran until then, then applies what the clock did at `now`. */
  advance(now: PTime, ran: TheaterClock, events: readonly ClockEvent[], updated: TheaterClock): void {
    if (this._wall == null) {
      this._t = updated.p(now);
      this._wall = now;
      this._shift = 0;
      return;
    }
    this._t = this.at(now, ran);
    this._wall = now;
    for (const event of events) {
      // Declared: T moves with p, the shift kept.
      if (event.kind === "start" || event.kind === "wake" || event.kind === "jump") this._t = updated.p(now) + this._shift;
    }
    this._shift = this._t - updated.p(now);
  }
}

// MARK: - A sport, as the director runs it (Phase 0)

/**
 * A sport on the director (the Swift `TheaterSport` protocol): how its plays
 * are read as scenes, and how a plan is made from them.
 */
export interface TheaterSport<Clip extends TheaterClip, Play, Facts, Context = number> {
  /** What every play's scene may read (soccer's keepers): when it changes, every scene is read again. */
  sceneContext(json: readonly unknown[], facts: Facts): Context;
  sameContext(a: Context, b: Context): boolean;
  sameFacts(a: Facts, b: Facts): boolean;
  /** How many plays either side a play's scene reads (one this near a change is read again). */
  readonly sceneReach: number;
  /** Earliest scene affected by a changed suffix. Some sports count playing entries rather than raw rows. */
  sceneStart(first: number, json: readonly unknown[]): number;
  /** The scene of the timeline's play at `i` of `raw` (its plays, then the pending ones past the watermark); null: none. */
  scene(raw: readonly RawPlay[], json: readonly unknown[], i: number, pending: boolean, facts: Facts, context: Context, prior: readonly (Play | null)[]): Play | null;
  /** The plan from the splice at `c` (on the theater's time): each play's anchor at `τ + shift`; plays at or past `deferFrom` (on p) wait. */
  plan(
    plays: readonly TimelinePlay<Play>[],
    history: ReadonlySet<string>,
    facts: Facts,
    chain: PlanChain<Clip>,
    c: PTime,
    shift: number,
    deferFrom: PTime | null,
    revision: number,
    ids: ActorIDs,
  ): Plan<Clip>;
  /** The binding horizons by the timeline's kind label (BROADCAST's late binding). */
  readonly horizons: Readonly<Record<string, number>>;
}

/** Plain facts compared field by field (Swift's synthesized `Equatable` on a struct of values). */
export function sameFields(a: object, b: object): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if ((a as Record<string, unknown>)[k] !== (b as Record<string, unknown>)[k]) return false;
  return true;
}

/** The default `sceneStart`: the sport's reach back from the first change. */
export function reachBack(reach: number): (first: number) => number {
  return (first) => Math.max(first - reach, 0);
}

interface SceneKey {
  readonly id: string;
  readonly digest: number;
  readonly pending: boolean;
}

/**
 * The timeline's plays read as a sport's scenes, incrementally: each scene is
 * kept until its play, or a play within the sport's reach of it, changes, so
 * an ingest reads the few new plays, not the game.
 */
export class SceneCache<Clip extends TheaterClip, Play, Facts, Context> {
  private keys: readonly SceneKey[] = [];
  private scenes: readonly (Play | null)[] = [];
  private context: Context | undefined = undefined;
  private facts: Facts | undefined = undefined;
  private hasContext = false;
  /** How many plays the last read parsed (the bench reports it). */
  parsed = 0;

  constructor(private readonly sport: TheaterSport<Clip, Play, Facts, Context>) {}

  copy(): SceneCache<Clip, Play, Facts, Context> {
    const c = new SceneCache(this.sport);
    c.keys = this.keys;
    c.scenes = this.scenes;
    c.context = this.context;
    c.facts = this.facts;
    c.hasContext = this.hasContext;
    c.parsed = this.parsed;
    return c;
  }

  read(snapshot: TimelineSnapshot<RawPlay>, facts: Facts): TimelinePlay<Play>[] {
    const sport = this.sport;
    const all = [...snapshot.plays, ...snapshot.pending];
    const split = snapshot.plays.length;
    const fresh: SceneKey[] = all.map((p, i) => ({ id: p.id, digest: p.play.digest, pending: i >= split }));
    const raw = all.map((p) => p.play);
    const json = raw.map((r) => r.json);
    const context = sport.sceneContext(json, facts);
    const common = Math.min(this.keys.length, fresh.length);
    let first = common;
    for (let i = 0; i < common; i++) {
      const a = this.keys[i]!;
      const b = fresh[i]!;
      if (a.id !== b.id || a.digest !== b.digest || a.pending !== b.pending) {
        first = i;
        break;
      }
    }
    const changedContext = !this.hasContext || !sport.sameContext(context, this.context as Context);
    const changedFacts = this.facts === undefined || !sport.sameFacts(facts, this.facts);
    if (changedContext || changedFacts) first = 0;
    const unchanged = first === fresh.length && this.keys.length === fresh.length;
    const from = unchanged ? first : sport.sceneStart(first, json);
    const out: (Play | null)[] = this.scenes.slice(0, from);
    for (let i = from; i < all.length; i++) out.push(sport.scene(raw, json, i, i >= split, facts, context, out));
    this.parsed = all.length - from;
    this.keys = fresh;
    this.scenes = out;
    this.context = context;
    this.hasContext = true;
    this.facts = facts;
    const plays: TimelinePlay<Play>[] = [];
    all.forEach((p, i) => {
      const scene = out[i];
      if (scene != null) plays.push({ ...p, play: scene });
    });
    return plays;
  }
}

/** What a plan is made from (everything the planning reads). */
export interface PlanRequest<Clip extends TheaterClip, Play, Facts, Context> {
  /** The timeline as it stands, read as scenes (`scenes` keeps what's already read). */
  readonly snapshot: TimelineSnapshot<RawPlay>;
  readonly scenes: SceneCache<Clip, Play, Facts, Context>;
  /** Plays known when the page opened (null until the first plan reads `opening`, the first snapshot). */
  readonly history: ReadonlySet<string> | null;
  readonly opening: TimelineSnapshot<RawPlay> | null;
  readonly facts: Facts;
  readonly chain: PlanChain<Clip>;
  readonly at: PTime;
  readonly shift: number;
  readonly deferFrom: PTime | null;
  readonly revision: number;
  readonly nextID: number;
  /** Not seen: planned (its anchors are the tell times) but not baked for frames. */
  light: boolean;
  /** The theater's time jumped with p (a declared jump, a wake): this plan's start is a declared cut. */
  declared: boolean;
}

/** A plan made and baked, with what it read. */
export interface MadePlan<Clip extends TheaterClip, Play, Facts, Context> {
  readonly baked: BakedPlan<Clip>;
  readonly nextID: number;
  readonly scenes: SceneCache<Clip, Play, Facts, Context>;
  readonly history: ReadonlySet<string>;
}

/** The director's state as a pure value: the bench runs it synchronously, the page's director in a task of its own. */
export class TheaterSession<Clip extends TheaterClip, Play, Facts, Context = number> {
  private _chain = new PlanChain<Clip>();
  private readonly time = new TheaterTime();
  /** Plays known when the page opened: shown as the court they left, never told. */
  private _history: ReadonlySet<string> | null = null;
  /** The timeline as of the last change that matters to a plan, the first one, and the scenes read so far. */
  private snapshotNow: TimelineSnapshot<RawPlay> | null = null;
  private opening: TimelineSnapshot<RawPlay> | null = null;
  private scenes: SceneCache<Clip, Play, Facts, Context>;
  private nextID = 1;
  private revision = 0;
  /** The clock's last state: T advances on it until the next update. */
  private clock: TheaterClock | null = null;
  /** p holds (a stall or a stretch): plays past it wait. */
  private _holding: PTime | null = null;
  /** A declared jump happened since the last plan: the next one declares its cut. */
  private declareNext = false;

  constructor(
    readonly sport: TheaterSport<Clip, Play, Facts, Context>,
    public facts: Facts,
  ) {
    this.scenes = new SceneCache(sport);
  }

  get chain(): PlanChain<Clip> {
    return this._chain;
  }

  get history(): ReadonlySet<string> | null {
    return this._history;
  }

  get holding(): PTime | null {
    return this._holding;
  }

  /** The theater's time and the clock it runs on (the stage's wake maps tiers through them). */
  get timing(): { time: TheaterTime; clock: TheaterClock } | null {
    return this.clock ? { time: this.time, clock: this.clock } : null;
  }

  /** p at a wall time, on the clock the theater runs on (the bench measures decisive moments against it). */
  presentation(now: PTime): PTime | null {
    return this.clock?.p(now) ?? null;
  }

  /** The theater's time at `now`. */
  theaterTime(now: PTime): PTime | null {
    if (!this.clock || !this.time.started) return null;
    return this.time.at(now, this.clock);
  }

  /**
   * The clock was updated at `now` (its events since): T follows it. True
   * when that calls for a new plan (a hold began or ended, a skip, a jump).
   */
  clockDidUpdate(updated: TheaterClock, events: readonly ClockEvent[], now: PTime): boolean {
    if (!updated.started) return false;
    const shiftBefore = this.time.shift;
    this.time.advance(now, this.clock ?? updated, events, updated);
    this.clock = updated;
    const held = updated.regime === "stalled" || updated.regime === "stretching";
    const wasHolding = this._holding != null;
    this._holding = held ? updated.p(now) : null;
    // T moved with p (declared): the plan made next starts with a declared cut.
    if (events.some((e) => e.kind === "jump" || e.kind === "wake")) this.declareNext = true;
    return held !== wasHolding || Math.abs(this.time.shift - shiftBefore) > 0.05 || events.some((e) => e.kind === "skip");
  }

  /**
   * New plays (or revised, or removed). Cheap (the main thread's part): true
   * when it matters to a plan. What's told and where it's presented don't
   * (the plan sets those); the scenes are read in `make`.
   */
  timelineDidChange(snapshot: TimelineSnapshot<RawPlay>): boolean {
    if (this.opening == null) this.opening = snapshot;
    const last = this.snapshotNow;
    if (last && TheaterSession.samePlays(last, snapshot)) return false;
    this.snapshotNow = snapshot;
    return true;
  }

  /** Whether two snapshots hold the same plays as a plan reads them (everything but what's told and `presentAt`). */
  static samePlays(a: TimelineSnapshot<RawPlay>, b: TimelineSnapshot<RawPlay>): boolean {
    if (a.plays.length !== b.plays.length || a.pending.length !== b.pending.length) return false;
    const same = (x: TimelinePlay<RawPlay>, y: TimelinePlay<RawPlay>) =>
      x.id === y.id &&
      x.play.digest === y.play.digest &&
      x.revision === y.revision &&
      x.eventTime === y.eventTime &&
      x.eventBounds?.lower === y.eventBounds?.lower &&
      x.eventBounds?.upper === y.eventBounds?.upper &&
      x.estimated === y.estimated &&
      x.timeSource === y.timeSource &&
      x.kind.phase === y.kind.phase &&
      x.kind.label === y.kind.label &&
      x.kind.stopsClock === y.kind.stopsClock &&
      x.kind.announced === y.kind.announced &&
      x.period === y.period &&
      x.clock.elapsed === y.clock.elapsed &&
      x.clock.resolution === y.clock.resolution &&
      x.clock.display === y.clock.display &&
      x.score?.home === y.score?.home &&
      x.score?.away === y.score?.away &&
      x.order === y.order;
    for (let i = 0; i < a.plays.length; i++) if (!same(a.plays[i]!, b.plays[i]!)) return false;
    for (let i = 0; i < a.pending.length; i++) if (!same(a.pending[i]!, b.pending[i]!)) return false;
    return true;
  }

  /**
   * What a plan made now would be made from: the splice a quarter second
   * ahead of T, on the chain's grid. `lead`: how far ahead of T the splice
   * goes (the time the plan gets; more after a plan came back too late).
   */
  request(now: PTime, lead: number = TheaterTiming.commitLead): PlanRequest<Clip, Play, Facts, Context> | null {
    const T = this.theaterTime(now);
    const snapshot = this.snapshotNow;
    if (T == null || !snapshot) return null;
    const c = this._chain.isEmpty ? T : this._chain.commit(T, lead);
    this.revision = (this.revision + 1) >>> 0;
    // While T runs on wall time (a hold) its shift from p grows: anchors go with the shift as it is now.
    const shift = this.clock ? T - this.clock.p(now) : this.time.shift;
    return {
      snapshot,
      scenes: this.scenes.copy(),
      history: this._history,
      opening: this._history == null ? this.opening : null,
      facts: this.facts,
      chain: this._chain.copy(),
      at: c,
      shift,
      deferFrom: this._holding,
      revision: this.revision,
      nextID: this.nextID,
      light: false,
      declared: this.declareNext,
    };
  }

  /** Reads the scenes, plans and bakes (pure). */
  static make<Clip extends TheaterClip, Play, Facts, Context>(
    sport: TheaterSport<Clip, Play, Facts, Context>,
    request: PlanRequest<Clip, Play, Facts, Context>,
  ): MadePlan<Clip, Play, Facts, Context> {
    const scenes = request.scenes;
    const plays = scenes.read(request.snapshot, request.facts);
    // Plays known when the page opened: its first snapshot's (the court they left, never told).
    let history: ReadonlySet<string>;
    if (request.history) history = request.history;
    else if (request.opening) {
      history =
        request.opening === request.snapshot ? new Set(plays.map((p) => p.id)) : new Set(new SceneCache(sport).read(request.opening, request.facts).map((p) => p.id));
    } else history = new Set(plays.map((p) => p.id));
    const ids: ActorIDs = { next: request.nextID };
    const plan = sport.plan(plays, history, request.facts, request.chain, request.at, request.shift, request.deferFrom, request.revision, ids);
    if (request.declared) plan.declared = true;
    plan.known = new Set(request.snapshot.plays.map((p) => p.id).filter((id) => !plan.deferred.has(id)));
    const baked = TheaterBake.bake(plan, undefined, request.light, request.chain.plan(request.at));
    return { baked, nextID: ids.next, scenes, history };
  }

  /** Takes in a baked plan if it's still in time (its splice not yet passed); else it must be made again. What it read is kept either way. */
  accept(made: MadePlan<Clip, Play, Facts, Context>, now: PTime): boolean {
    this.scenes = made.scenes;
    if (this._history == null) this._history = made.history;
    const baked = made.baked;
    const T = this.theaterTime(now);
    if (T != null && !this._chain.isEmpty && baked.start < T - 1e-6) return false;
    if (baked.plan.declared) this.declareNext = false;
    const next = this._chain.copy();
    next.splice(baked, T ?? baked.start);
    this._chain = next;
    this.nextID = Math.max(this.nextID, made.nextID);
    return true;
  }

  /**
   * Where each placed play is presented on p: the p the clock will show as T
   * reaches its decisive frame (so the score, the lists and the court land
   * together however T and p run between now and then); a play whose frame is
   * already drawn keeps what was published.
   */
  anchors(now: PTime): Map<string, PTime> {
    const plans = this._chain.plans;
    const plan = plans[plans.length - 1]?.plan;
    if (!plan) return new Map();
    const out = new Map(plan.published);
    const clock = this.clock;
    if (!clock || !this.time.started) return out;
    for (const [id, at] of plan.decisive) {
      const w = this.time.wallReaching(at, clock, now);
      if (w != null) out.set(id, clock.p(w));
    }
    return out;
  }

  /** The plays the newest plan was made from: the timeline waits for the anchor of one past them (null: no plan yet). */
  get covering(): ReadonlySet<string> | null {
    const plans = this._chain.plans;
    return plans[plans.length - 1]?.plan.known ?? null;
  }

  /**
   * The running order's actual approach to each tell. Includes the splice
   * travel, which can begin several seconds before a clip's nominal lead-in.
   * A clock skip there would move its anchor mid-play.
   */
  get leadIns(): Map<string, number> {
    const plans = this._chain.plans;
    const plan = plans[plans.length - 1]?.plan;
    const out = new Map<string, number>();
    if (!plan) return out;
    for (const placement of plan.placements) {
      for (const [id, at] of placement.presents) out.set(id, Math.max(out.get(id) ?? 0, at + placement.shift - placement.start));
    }
    return out;
  }

  /** When the plan runs out (the court between plays needs its next rounds): a wall time to re-plan by. */
  horizonWake(now: PTime): PTime | null {
    const plans = this._chain.plans;
    const last = plans[plans.length - 1];
    const T = this.theaterTime(now);
    if (!last || T == null) return null;
    return now + Math.max(last.horizon - 15 - T, 0.5);
  }
}

// MARK: - The director

/** Plans in flight across every director, and the most there ever were at once (a gate: one). */
export const TheaterDebug = { planning: 0, most: 0 };

/** The page's planning queue: one plan at a time across every director (the Mac's `TheaterBakery` actor). */
const bakery: { busy: boolean; queue: (() => void)[] } = { busy: false, queue: [] };

function bake(job: () => void): void {
  const run = () => {
    bakery.busy = true;
    TheaterDebug.planning += 1;
    TheaterDebug.most = Math.max(TheaterDebug.most, TheaterDebug.planning);
    try {
      job();
    } finally {
      TheaterDebug.planning -= 1;
      bakery.busy = false;
      const next = bakery.queue.shift();
      if (next) setTimeout(next, 0);
    }
  };
  if (bakery.busy) bakery.queue.push(run);
  else setTimeout(run, 0);
}

/**
 * The game page's theater director (one per page, event-driven): `chain`
 * changes only on a splice, and listeners hear of it (the stage, the source's
 * anchors, the slides' cues).
 */
export class TheaterDirector<Clip extends TheaterClip, Play, Facts, Context = number> {
  private session: TheaterSession<Clip, Play, Facts, Context>;
  private baking = false;
  private disposed = false;
  private waking: ReturnType<typeof setTimeout> | null = null;
  private _visible = true;
  private pending = false;
  /** Bumps when the clock the theater's time runs on changes: when the plan's next frames are due moved with it. */
  private _clockRevision = 0;
  /**
   * How far ahead the next splice goes: the commit lead, doubled after a
   * plan comes back past its splice (a slow machine, a busy moment) and
   * easing back as plans land in time.
   */
  private lead: number = TheaterTiming.commitLead;
  private readonly listeners = new Set<() => void>();
  /** Wall time now, in seconds since 1970 (tests and the bench pass a virtual clock). */
  now: () => PTime = () => Date.now() / 1000;

  constructor(
    readonly sport: TheaterSport<Clip, Play, Facts, Context>,
    facts: Facts,
  ) {
    this.session = new TheaterSession(sport, facts);
  }

  get chain(): PlanChain<Clip> {
    return this.session.chain;
  }

  get clockRevision(): number {
    return this._clockRevision;
  }

  get visible(): boolean {
    return this._visible;
  }

  /** The theater's time at a wall time: what the stage samples the chain at. */
  time(wall: PTime): PTime | null {
    return this.session.theaterTime(wall);
  }

  /** What the plan is made from (the teams, the viewer's turn). */
  get facts(): Facts {
    return this.session.facts;
  }

  /** A plan is being made. */
  get busy(): boolean {
    return this.baking;
  }

  /** The theater's time and its clock, for the stage's frames. */
  get timing(): { time: TheaterTime; clock: TheaterClock } | null {
    return this.session.timing;
  }

  /** Where each play is presented on p (as T reaches its decisive frame): the timeline presents it there too. */
  get anchors(): Map<string, PTime> {
    return this.session.anchors(this.now());
  }

  /** The plays the newest plan has seen: a newer one waits for its anchor (the court and the score land together). */
  get covering(): ReadonlySet<string> | null {
    return this.session.covering;
  }

  get leadIns(): Map<string, number> {
    return this.session.leadIns;
  }

  /** Hears every splice and every change of the clock (returns the unsubscribe). */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    for (const l of [...this.listeners]) l();
  }

  /** The plays changed (an ingest, a revision, a removal): re-plan from a quarter second ahead. */
  timelineDidChange(snapshot: TimelineSnapshot<RawPlay>): void {
    if (this.session.timelineDidChange(snapshot) || this.chain.isEmpty) this.replan();
  }

  /** The presentation clock re-planned (its events since the last time): T follows; a hold, a resume, a skip or a jump re-plans. */
  clockDidChange(clock: TheaterClock, events: readonly ClockEvent[]): void {
    if (this.session.clockDidUpdate(clock, events, this.now()) || this.chain.isEmpty) this.replan();
    this._clockRevision += 1;
    this.changed();
  }

  /** The viewer turned the court (the facts changed): re-plan. */
  factsDidChange(facts: Facts): void {
    if (this.sport.sameFacts(facts, this.session.facts)) return;
    this.session.facts = facts;
    this.replan();
  }

  /**
   * Plan always, bake when seen (§8.4): off screen the plans are still made
   * (their anchors are every consumer's tell times), only not baked for
   * frames; on return, a full plan from where T is.
   */
  setVisible(seen: boolean): void {
    if (seen === this._visible) return;
    this._visible = seen;
    if (seen) this.replan();
  }

  /** The page is gone (its timers stop; a plan in flight is dropped). */
  dispose(): void {
    this.disposed = true;
    if (this.waking) clearTimeout(this.waking);
    this.waking = null;
  }

  /** Back on the page (React's development remount): plans again from where T is. */
  revive(): void {
    if (!this.disposed) return;
    this.disposed = false;
    this.replan();
  }

  private replan(): void {
    if (this.disposed) return;
    if (this.baking) {
      this.pending = true;
      return;
    }
    const request = this.session.request(this.now(), this.lead);
    if (!request) return;
    request.light = !this._visible;
    this.baking = true;
    bake(() => {
      if (this.disposed) {
        this.baking = false;
        this.pending = false;
        return;
      }
      const made = TheaterSession.make(this.sport, request);
      this.baking = false;
      if (this.session.accept(made, this.now())) {
        this.lead = Math.max(TheaterTiming.commitLead, this.lead * 0.75);
        this.scheduleHorizon();
        this.changed();
      } else {
        // Too late for its splice: again, from now, with more room.
        this.lead = Math.min(this.lead * 2, 4);
        this.pending = true;
      }
      if (this.pending) {
        this.pending = false;
        this.replan();
      }
    });
  }

  /** The one wake: before the plan runs out, the next rounds of the court between plays. */
  private scheduleHorizon(): void {
    if (this.waking) clearTimeout(this.waking);
    this.waking = null;
    const at = this.session.horizonWake(this.now());
    if (at == null) return;
    const delay = Math.max(at - this.now(), 0.5);
    this.waking = setTimeout(() => {
      this.waking = null;
      this.replan();
    }, delay * 1000);
  }
}
