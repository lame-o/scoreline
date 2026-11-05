/**
 * The game as one broadcast, part 7: the game page's model (Broadcast.swift;
 * BROADCAST.md §3). Plain TypeScript, no React: the page's hook
 * (features/game/core/broadcast.tsx) holds one and subscribes to it.
 *
 * One per game page. It runs the engine (engine.ts) on what the page's lanes
 * bring: the summary as it loads, the core plays and status as the fast lane
 * reads them, the scoreboard as the store polls it. It sleeps until the next
 * thing that changes on its own (a play's moment on p, the game clock
 * stopping, a hold beginning) and publishes what's presented then. Nothing
 * polls; nothing ticks per frame.
 *
 * Everything on the page that isn't a theater reads the presented state
 * through it:
 * - `presentEvent(event)`: the hero's and the docked bar's score, clock,
 *   period and state, the tab's line for this game, the notifications;
 * - `presentDetail(detail)`: the play lists (rows appear when their play is
 *   told), the charts' plays, Win Probability (ESPN's per play, by event
 *   time), the line score (from the told plays), the box score and team
 *   stats (each summary's tables held until p passes that summary's
 *   watermark);
 * - `shows(id)`, `toldPlays`: the lanes' own lists, cut the same way (the
 *   NBA's live marks and football's field: presentNBA.ts, presentFootball.ts,
 *   each with its sport's page);
 * - `gate(moments)`: live moments wait for their play's moment (the moment
 *   slot, the celebrations and the scoring slides take them then).
 *
 * The theaters read today's inputs until CHOREOGRAPHY Phase 0; the director
 * reads this model through `BroadcastTheaterSource` (theaterSource.ts: the
 * timeline up to the watermark, the clock, the hints) and hands back its
 * binding horizons and solved anchors.
 *
 * Web: one change of what's published is one notification (Swift's one
 * transaction per step); a hidden tab is the Mac asleep (`suspend`, `resume`):
 * nothing is scheduled while it's hidden, and coming back is a wake.
 */
import { currentAtBat, battedBalls, type Baseball, type GameDetail, type Linescore, type SideOf } from "../gameDetail";
import { recentPlays as nbaRecentPlays } from "../basketball";
import { at, int, str, type JSONValue } from "../json";
import type { LiveMoment } from "../moments";
import { withChanges, type EventState, type GameClock, type ScoreEvent } from "../models";
import type { OddsBasis } from "../odds/espn";
import { behindFromClock, type BehindLive } from "./behindLive";
import { BroadcastEngine, EMPTY_SNAPSHOT, type TimelineSnapshot } from "./engine";
import { broadcastSport, plateTimes, policy as sportPolicy, readingFromEvent, readingFromStatus, timed, entries as laneEntries, type BroadcastSport } from "./lanes";
import { PresentationClock } from "./presentationClock";
import { clockless, isFinal, NOTHING_PRESENTED, presentedStatus, remaining, samePhase, samePresented, type PresentedGame } from "./presentedGame";
import type { BroadcastTheaterSource } from "./theaterSource";
import type { StatcastAtBat } from "../mlb/statcast";
import { sameScore, type BindingHorizons, type FastReading, type Hint, type LaneID, type PTime, type RawPlay, type ScoreLine, type TimelineEntry, type TimelineRecord } from "./timeline";

/** Wall time for the broadcast (seconds since 1970): the real clock, or a test's virtual one. */
export interface BroadcastTime {
  now(): PTime;
}

export const LIVE_TIME: BroadcastTime = { now: () => Date.now() / 1000 };

/** What the page's model asks of the world around it, so tests and the page set it apart. */
export interface BroadcastHost {
  /** Baseball: MLB's at-bats the page's Statcast query already has for this game (MLB's own pitch times), if any. */
  readonly statcast?: (eventID: string) => readonly StatcastAtBat[];
  /** A scheduler (the browser's timers; tests step by hand). */
  readonly setTimer?: (run: () => void, ms: number) => () => void;
  /** Where the theater's disagreements are noted (the Mac's `Log.theater`); development only on the page. */
  readonly log?: (message: string) => void;
}

const browserTimer = (run: () => void, ms: number) => {
  const id = setTimeout(run, ms);
  return () => clearTimeout(id);
};

export class Broadcast implements BroadcastTheaterSource {
  /** What's presented now. Re-derived only at the moments it schedules. */
  presented: PresentedGame = NOTHING_PRESENTED;
  /** The clock as planned; republished only when the plan changes what it presents (a copy: the engine's moves on). */
  clock: PresentationClock = new PresentationClock();
  /** Bumps when the plays or what's told change. */
  revision = 0;
  /** This page is broadcasting (a live ESPN game with a play-by-play). */
  active = false;
  /** The game's last play is told: the page may say Final. */
  ended = false;
  /** Bumps when moments are released (their play just told): the page takes them (`takeReleased`). */
  releasedRevision = 0;
  /**
   * The score the owner could already see when the page opened (or the tab
   * came back): the scoreboard's, and the scores list's. A shown score never
   * steps back below it: each side shows max(p's score, the floor) until p's
   * score reaches it on both sides; then it's gone for good. It goes too when
   * the fast lane itself corrects below it (a genuine overturn), when a told
   * play takes a score back (a VAR decision), and after `floorTimeout`. Only
   * the score: the court and the lists still tell those plays at p, so the
   * score leads them once, and only by what the owner had already seen.
   */
  floor: ScoreLine | null = null;
  /** Bumps on every published change: the token React's `useSyncExternalStore` reads. */
  version = 0;

  engine: BroadcastEngine<RawPlay> | null = null;
  /**
   * This game's feed turned out to have no event times (a league that doesn't log wallclocks):
   * presenting it behind live would only add delay, so it shows as today.
   */
  unsupported = false;
  sport: BroadcastSport | null = null;
  path = "";
  /** ESPN's event ID (MLB's feed is looked up by it). */
  private espnID = "";
  topIsHome = false;
  private eventID: string | null = null;
  private rawState: EventState = "scheduled";
  private lastScoreboard: FastReading | null = null;
  private lastStatus: FastReading | null = null;
  private cancelWake: (() => void) | null = null;
  /** The real clock, or the harness's virtual one (and then it doesn't schedule itself: the harness steps it). */
  time: BroadcastTime = LIVE_TIME;
  automatic = true;
  /** A hidden tab: asleep (nothing scheduled). */
  private suspended = false;
  /** Each summary's tables (box score, stats, leaders), held until p passes its watermark. */
  private tables: { watermark: PTime; detail: GameDetail }[] = [];
  /** Moments waiting for their play's moment, and those already offered. */
  private pending = new Map<string, { moment: LiveMoment; since: PTime }>();
  private offered = new Set<string>();
  /** Fast-lane situations (baseball) by the play they follow: the diamond at p. */
  private situations: { play: string; situation: Baseball }[] = [];
  private memo: { key: string; input: GameDetail; detail: GameDetail } | null = null;
  private eventMemo: { input: ScoreEvent; game: PresentedGame; floor: ScoreLine | null; wall: PTime; shown: ScoreEvent } | null = null;
  private payloadMemo: { key: string; plays: JSONValue[] } | null = null;
  /** Moments released since the page last took them. */
  private released: LiveMoment[] = [];
  /** When `presented` was published (its game clock ticks on from then). */
  presentedWall: PTime = 0;
  /** When the floor was set (it lapses `floorTimeout` later). */
  private floorSince: PTime = 0;
  static readonly floorTimeout = 120;
  /** p's score when the floor was last settled (a drop since then is a told reversal). */
  private settledScore: ScoreLine | null = null;
  private listeners = new Set<() => void>();
  private host: BroadcastHost;
  private changed = false;

  constructor(host: BroadcastHost = {}) {
    this.host = host;
  }

  // MARK: Observation

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set<K extends keyof this>(key: K, value: this[K], same: (a: this[K], b: this[K]) => boolean = Object.is): void {
    if (same(this[key], value)) return;
    this[key] = value;
    this.changed = true;
  }

  /** One notification for everything a step changed (Swift's one transaction per step). */
  private flush(): void {
    if (!this.changed) return;
    this.changed = false;
    this.version += 1;
    for (const l of [...this.listeners]) l();
  }

  /** The moments released since the last call (their play's moment came). */
  takeReleased(): LiveMoment[] {
    const out = this.released;
    this.released = [];
    return out;
  }

  private release(moments: readonly LiveMoment[]): void {
    if (moments.length === 0) return;
    this.released.push(...moments);
    this.set("releasedRevision", this.releasedRevision + 1);
  }

  // MARK: Lifecycle

  /**
   * The page has its first load of a live game: start broadcasting it. A
   * final, or a sport without a play-by-play, never starts (everything shows
   * as today). `seen`: other copies of the game the owner could already see
   * (the scores list's, a lane's): with the event's own, they set the floor.
   */
  begin(event: ScoreEvent, topIsHome: boolean, seen: readonly ScoreEvent[] = []): void {
    const sport = broadcastSport(event);
    if (this.active || this.unsupported || event.state !== "live" || !sport || event.ref?.kind !== "espn") return;
    this.sport = sport;
    this.path = event.ref.path;
    this.espnID = event.ref.id;
    this.topIsHome = topIsHome;
    this.eventID = event.id;
    this.rawState = event.state;
    this.engine = new BroadcastEngine<RawPlay>(sport, sportPolicy(sport, this.path));
    this.set("active", true);
    this.raiseFloor([event, ...seen].flatMap((e) => this.scoreOf(e) ?? []), this.time.now());
    this.observeScoreboard(event);
  }

  /** A copy of the game's score, home and away. */
  private scoreOf(event: ScoreEvent): ScoreLine | null {
    if (event.content.kind !== "match") return null;
    const t = toInt(event.content.top.score);
    const b = toInt(event.content.bottom.score);
    if (t == null || b == null) return null;
    return this.topIsHome ? { home: t, away: b } : { home: b, away: t };
  }

  /** The floor: per side, the most the owner could have seen. */
  private raiseFloor(scores: readonly ScoreLine[], now: PTime): void {
    const first = scores[0];
    if (!first) return;
    const seen = scores.slice(1).reduce((a, s) => ({ home: Math.max(a.home, s.home), away: Math.max(a.away, s.away) }), first);
    const current = this.floor ?? seen;
    this.set("floor", { home: Math.max(current.home, seen.home), away: Math.max(current.away, seen.away) }, sameScore);
    this.floorSince = now;
  }

  /** The score as shown: p's, held up per side by the floor while it stands. (pure; tested) */
  static shown(score: ScoreLine | null, floor: ScoreLine | null): ScoreLine | null {
    if (!floor) return score;
    if (!score) return floor;
    return { home: Math.max(score.home, floor.home), away: Math.max(score.away, floor.away) };
  }

  /**
   * The floor goes once p's score has reached it on both sides, when a told
   * play takes a score back (a VAR decision: the score the owner saw is
   * overturned on screen, so the floor goes with it), or after `floorTimeout`.
   */
  private settleFloor(now: PTime): void {
    const f = this.floor;
    const score = this.presented.score;
    if (f) {
      const reached = score != null && score.home >= f.home && score.away >= f.away;
      const was = this.settledScore;
      const reversed = was != null && score != null && (score.home < was.home || score.away < was.away);
      if (reached || reversed || now - this.floorSince >= Broadcast.floorTimeout) this.set("floor", null);
    }
    this.settledScore = score;
  }

  /** The page closed (or another game took it): everything shows as today again. */
  end(): void {
    this.cancelWake?.();
    this.cancelWake = null;
    this.engine = null;
    this.set("active", false);
    this.set("ended", false);
    this.set("presented", NOTHING_PRESENTED);
    this.tables = [];
    this.pending.clear();
    this.offered.clear();
    this.set("floor", null);
    this.situations = [];
    this.memo = null;
    this.payloadMemo = null;
    this.released = [];
    this.flush();
  }

  /** The tab hid: the page sleeps (nothing scheduled), as the Mac does asleep. */
  suspend(): void {
    this.suspended = true;
    this.cancelWake?.();
    this.cancelWake = null;
  }

  /** The tab is back: a step (more than 30 s away is a wake: the live edge, as on opening). */
  resume(): void {
    if (!this.suspended) return;
    this.suspended = false;
    this.step();
  }

  // MARK: Lanes

  /** A summary arrived: its plays (parsed as it loaded) and its tables. */
  ingestSummary(detail: GameDetail, arrived?: PTime): void {
    const engine = this.engine;
    if (!this.active || !engine) return;
    const now = arrived ?? this.time.now();
    const list = detail.broadcastPlays;
    if (list) {
      // A feed with plays but no event times can't be presented at p.
      if (engine.timeline.isEmpty && list.length >= 5 && list.every((e) => e.wallclock == null)) {
        this.unsupported = true;
        this.end();
        return;
      }
      engine.ingest({ lane: "summary", entries: this.mlbTimed(list), coverage: "full", arrived: now });
      // The tables are as of the summary's newest play.
      let watermark = -Infinity;
      for (const e of list) if (e.wallclock != null && e.wallclock > watermark) watermark = e.wallclock;
      this.tables.push({ watermark: Number.isFinite(watermark) ? watermark : now, detail });
      if (this.tables.length > 8) this.tables.splice(0, this.tables.length - 8);
    }
    this.step(now);
  }

  /** A look at the core plays (a tail of the game, in order): NBA, football, soccer, baseball's fast lanes. */
  ingestCore(items: readonly JSONValue[], arrived?: PTime): void {
    const engine = this.engine;
    const sport = this.sport;
    if (!this.active || !engine || !sport) return;
    const now = arrived ?? this.time.now();
    const list = this.mlbTimed(laneEntries(items, sport, engine.policy));
    engine.ingest({ lane: "core", entries: list, coverage: "tail", arrived: now });
    this.step(now);
  }

  /** Baseball: ESPN's plays with MLB's own times, from the at-bats the page's Statcast query has. */
  private mlbTimed(list: readonly TimelineEntry<RawPlay>[]): TimelineEntry<RawPlay>[] {
    if (this.sport !== "baseball" || this.path !== "baseball/mlb") return [...list];
    const atBats = this.host.statcast?.(this.eventID ?? `espn-${this.espnID}`) ?? [];
    return atBats.length === 0 ? [...list] : timed(list, plateTimes(atBats));
  }

  /** A slow lane was read and had nothing new (the situation's last play hadn't changed). */
  noteRead(lane: LaneID = "core"): void {
    const engine = this.engine;
    if (!this.active || !engine) return;
    const now = this.time.now();
    engine.noteRead(lane, now);
    this.step(now);
  }

  /** The store's scoreboard copy of this game changed (a poll). */
  observeScoreboard(event: ScoreEvent): void {
    this.rawState = event.state;
    const engine = this.engine;
    if (!this.active || !engine) return;
    const now = this.time.now();
    const reading = readingFromEvent(event, this.topIsHome, engine.policy, this.lastScoreboard, now);
    if (reading) {
      // The fast lane correcting its own score downward is a genuine overturn: the floor goes.
      const was = this.lastScoreboard?.score;
      if (was && reading.score && (reading.score.home < was.home || reading.score.away < was.away)) this.set("floor", null);
      this.lastScoreboard = reading;
      engine.observe(reading);
    }
    this.settleFloor(now);
    this.step(now);
  }

  /** The core status (NBA, football, baseball's fast lanes): the clock every few seconds. */
  observeStatus(status: JSONValue | null | undefined): void {
    const engine = this.engine;
    if (!this.active || !engine || status == null) return;
    const now = this.time.now();
    const reading = readingFromStatus(status, engine.policy, this.lastStatus, now);
    if (reading) {
      this.lastStatus = reading;
      engine.observe(reading);
    }
    this.step(now);
  }

  /** Baseball: the fast lane's situation (count, outs, runners) after a play. */
  observeSituation(situation: Baseball, play: string | null): void {
    if (!this.active || play == null) return;
    const last = this.situations.at(-1);
    if (last?.play === play) last.situation = situation;
    else this.situations.push({ play, situation });
    if (this.situations.length > 200) this.situations.splice(0, this.situations.length - 200);
  }

  // MARK: Stepping

  /** Brings the presentation to `now`: the engine's step, the moments told, what's presented published if it changed, and the next wake scheduled. */
  step(at?: PTime): void {
    const engine = this.engine;
    if (!this.active || !engine) {
      this.flush();
      return;
    }
    const now = at ?? this.time.now();
    const overridden = engine.timeline.guardOverrideCount;
    const uncovered = engine.timeline.uncoveredTellCount;
    const shownBefore = Broadcast.shown(this.presented.score, this.floor);
    const result = engine.advance(now);
    // The order guard would have held a play the theater anchored: told at the anchor (one scheduler), and noted.
    const overrides = engine.timeline.guardOverrideCount - overridden;
    if (overrides > 0) for (const id of engine.timeline.guardOverrides.slice(-overrides)) this.host.log?.(`order guard overridden by the theater's anchor for play ${id}`);
    // The theater never anchored a play it was scheduling: the fallback told it (the court tells it late).
    const uncoveredNow = engine.timeline.uncoveredTellCount - uncovered;
    if (uncoveredNow > 0) for (const id of engine.timeline.uncoveredTells.slice(-uncoveredNow)) this.host.log?.(`play ${id} told without the theater's anchor (none within the wait)`);
    // Woke (or came back to the page): what the owner could see then is the floor again.
    if (result.events.some((e) => e.kind === "wake")) {
      this.raiseFloor([shownBefore, this.lastScoreboard?.score ?? null].flatMap((s) => s ?? []), now);
    }
    // Everything a step changes lands in one notification.
    const next = this.upcoming(now, engine);
    if (result.told.length > 0) this.releaseMoments(result.told);
    this.expireMoments(now);
    this.publish(next, now, engine);
    this.settleFloor(now);
    this.flush();
    if (this.automatic && !this.suspended) this.schedule(now);
  }

  /** What's presented at `now`. */
  private upcoming(now: PTime, engine: BroadcastEngine<RawPlay>): PresentedGame {
    let next = engine.presented(now);
    // A final with nothing left to tell ends a moment after its last play, even
    // if ESPN never logs the end.
    const last = engine.timeline.lastTold;
    if (!isFinal(next) && this.rawState === "final" && engine.timeline.nextUntold == null && last && engine.p(now) >= last.presentAt + 5) {
      next = { ...next, phase: { kind: "final" } };
    }
    // The game clock holds while the presentation clock does (a stall).
    if (engine.clock.rate(now) === 0 && next.clock) next = { ...next, clock: { ...next.clock, running: false } };
    return next;
  }

  private publish(next: PresentedGame, now: PTime, engine: BroadcastEngine<RawPlay>): void {
    if (Broadcast.differs(next, this.presented, now - this.presentedWall)) {
      this.presentedWall = now;
      this.set("presented", next);
    }
    this.set("ended", isFinal(next));
    this.set("revision", engine.timeline.revision);
    if (!this.clock.presentsSame(engine.clock, now)) this.set("clock", engine.clock.clone());
  }

  /**
   * Whether the presented game changed in a way the page shows: a play
   * told, a revision, the score, the phase, the period, the clock starting
   * or stopping, or a running clock drifting more than 0.75 s from where the
   * published one has ticked to (`elapsed` seconds later). A running clock
   * alone never republishes: the page's clock text ticks itself. (pure)
   */
  static differs(next: PresentedGame, old: PresentedGame, elapsed: number): boolean {
    if (next.told !== old.told || next.revision !== old.revision || !sameScore(next.score, old.score) || !samePhase(next.phase, old.phase) || next.period !== old.period || next.lastID !== old.lastID) return true;
    const n = next.clock;
    const o = old.clock;
    if (n == null && o == null) return false;
    if (n == null || o == null) return true;
    if (n.running !== o.running || n.period !== o.period) return true;
    const expected = o.running ? o.elapsed + elapsed : o.elapsed;
    return Math.abs(n.elapsed - expected) > (o.running ? 0.75 : 0.05);
  }

  private schedule(now: PTime): void {
    this.cancelWake?.();
    this.cancelWake = null;
    const engine = this.engine;
    if (!engine) return;
    let at = engine.nextWake(now);
    // A final the feed never ends: check once its last play has had its moment.
    const last = engine.timeline.lastTold;
    if (this.rawState === "final" && engine.timeline.nextUntold == null && last) {
      const t = engine.clock.wallReaching(last.presentAt + 5.01, now);
      if (t != null) at = Math.min(at ?? t, t);
    }
    // The floor lapses on its own.
    if (this.floor) at = Math.min(at ?? Infinity, this.floorSince + Broadcast.floorTimeout + 0.01);
    // Moments for plays the timeline doesn't know expire after a minute.
    let oldest = Infinity;
    for (const p of this.pending.values()) oldest = Math.min(oldest, p.since);
    if (Number.isFinite(oldest)) at = Math.min(at ?? Infinity, oldest + 60.01);
    if (at == null || !Number.isFinite(at)) return;
    const delay = Math.max(at - now, 0.001);
    this.cancelWake = (this.host.setTimer ?? browserTimer)(() => {
      this.cancelWake = null;
      this.step();
    }, delay * 1000);
  }

  // MARK: Moments

  /**
   * Live moments from the lanes, as the page takes them. Returns those to
   * offer now (their play is already told, or it isn't a broadcast play);
   * the rest wait for their play's moment (`release`). A moment for a play
   * told as history or a correction is dropped (never news); an upgrade to
   * a told play's moment is a quiet correction (dropped too).
   */
  gate(moments: readonly LiveMoment[]): LiveMoment[] {
    const timeline = this.engine?.timeline;
    if (!this.active || !timeline) return [...moments];
    const now = this.time.now();
    const out: LiveMoment[] = [];
    for (const m of moments) {
      if (this.offered.has(m.id)) continue;
      const record = timeline.record(m.id);
      if (record?.told != null) {
        if (record.told === "onTime" || record.told === "late") {
          this.offered.add(m.id);
          out.push(m);
        }
        continue;
      }
      this.pending.set(m.id, { moment: m, since: this.pending.get(m.id)?.since ?? now });
    }
    return out;
  }

  /** Moments taken back (a basket overturned): those waiting are dropped silently; returns the IDs already offered (the page takes them back). */
  retract(ids: readonly string[]): string[] {
    if (!this.active) return [...ids];
    for (const id of ids) this.pending.delete(id);
    return ids.filter((id) => this.offered.delete(id));
  }

  private releaseMoments(told: readonly TimelineRecord<RawPlay>[]): void {
    const out: LiveMoment[] = [];
    for (const record of told) {
      const waiting = this.pending.get(record.entry.id);
      if (!waiting) continue;
      this.pending.delete(record.entry.id);
      if (record.told === "onTime" || record.told === "late") {
        this.offered.add(record.entry.id);
        out.push(waiting.moment);
      }
    }
    this.release(out);
  }

  /** A moment whose play never reached the timeline (a lane it doesn't read) goes after a minute rather than never. */
  private expireMoments(now: PTime): void {
    const timeline = this.engine?.timeline;
    if (!timeline) return;
    const stale: LiveMoment[] = [];
    for (const [id, p] of this.pending) {
      if (!timeline.knows(id) && now - p.since > 60) {
        stale.push(p.moment);
        this.pending.delete(id);
        this.offered.add(id);
      }
    }
    this.release(stale);
  }

  // MARK: Presenting

  /**
   * How far behind live the page is now (the clock's delay, rounded to 5 s), for the live indicator's hover and
   * the hero's spoken value; null while not broadcasting. Read from the engine's clock when it's asked (on a
   * hover, or as the hero renders): a re-plan of the clock re-renders nothing for a number on a hover.
   */
  get behind(): BehindLive | null {
    const clock = this.engine?.clock;
    if (!this.active || this.ended || !clock || !clock.started) return null;
    return behindFromClock(clock.delay(this.time.now()), clock.regime);
  }

  /** Whether a play-keyed item shows: told plays do, untold ones wait. Items the timeline doesn't know (a synthesized ID) show as today. */
  shows(id: string | null | undefined): boolean {
    const timeline = this.engine?.timeline;
    if (!this.active || id == null || !timeline) return true;
    return timeline.isTold(id) || !timeline.knows(id);
  }

  /** The presentation time now (null while not broadcasting). */
  get p(): PTime | null {
    const engine = this.engine;
    if (!this.active || !engine || !engine.started) return null;
    return engine.p(this.time.now());
  }

  /** The told plays' entries, in order (the lanes' parsers read them: recent plays, the at-bat, runs). */
  get toldPlays(): JSONValue[] {
    const timeline = this.engine?.timeline;
    if (!this.active || !timeline) return [];
    const key = `${timeline.revision}|${timeline.toldCount}`;
    if (this.payloadMemo?.key === key) return this.payloadMemo.plays;
    const plays = timeline.records
      .slice(0, timeline.toldCount)
      .filter((r) => r.entry.payload.json != null)
      .map((r) => r.entry.payload.json);
    this.payloadMemo = { key, plays };
    return plays;
  }

  /** The last told play's entry (football reads its end spot and possession from it). */
  get lastToldPlay(): JSONValue | null {
    return this.engine?.timeline.lastTold?.entry.payload.json ?? null;
  }

  /** The presented game minute (soccer's timeline), from the presented clock. */
  get minute(): number | null {
    return this.presented.clock ? this.presented.clock.elapsed / 60 : null;
  }

  /** The words the hero says for the presented game ("4:12 - 3rd", "Half-time"). */
  status(): string | null {
    const engine = this.engine;
    if (!this.active || !this.sport || !engine) return null;
    return presentedStatus(this.presented, this.sport, engine.policy.regulationPeriods);
  }

  /** The event as presented: score, state, status and clock at p. */
  presentEvent(event: ScoreEvent): ScoreEvent {
    const engine = this.engine;
    const sport = this.sport;
    if (!this.active || event.content.kind !== "match" || !sport || !engine) return event;
    const game = this.presented;
    if (game.phase.kind === "pregame" && game.score == null) return event;
    // A page reads its event many times a render; it changes when the game does.
    const memo = this.eventMemo;
    if (memo && memo.input === event && memo.game === game && sameScore(memo.floor, this.floor) && memo.wall === this.presentedWall) return memo.shown;
    let { top, bottom } = event.content;
    const score = Broadcast.shown(game.score, this.floor);
    if (score) {
      top = { ...top, score: String(this.topIsHome ? score.home : score.away) };
      bottom = { ...bottom, score: String(this.topIsHome ? score.away : score.home) };
    }
    const state: EventState = isFinal(game) ? "final" : event.state === "scheduled" ? "scheduled" : "live";
    const status = presentedStatus(game, sport, engine.policy.regulationPeriods);
    const detail = isFinal(game) ? (event.state === "final" ? (event.detail ?? status) : status) : status;
    let clock: GameClock | null = game.clock
      ? {
          seconds: game.clock.countsDown ? remaining(game.clock) : game.clock.elapsed,
          sampledAt: this.presentedWall * 1000,
          period: game.clock.period,
          direction: game.clock.countsDown ? "down" : "up",
          display: status,
          running: game.clock.running,
        }
      : null;
    if (clockless(game)) clock = null;
    const shown = withChanges(event, { state, content: { kind: "match", top, bottom }, detail, clock, possession: null, liveLine: null, snapshot: null });
    this.eventMemo = { input: event, game, floor: this.floor, wall: this.presentedWall, shown };
    return shown;
  }

  /**
   * The detail as presented: play-keyed lists cut to what's told, the line
   * score from the told plays, Win Probability at the last told play, the
   * tables of the newest summary p has passed. `revision`: the page's count
   * of loads (the memo's key); `side`: ESPN team ID to top/bottom.
   */
  presentDetail(d: GameDetail, loaded: number, side: SideOf): GameDetail {
    const engine = this.engine;
    if (!this.active || !engine || !engine.started) return d;
    const game = this.presented;
    const p = engine.p(this.time.now());
    const held = this.heldTables(p);
    const key = `${loaded}|${game.revision}|${game.told}|${held.index}`;
    if (this.memo && this.memo.key === key && this.memo.input === d) return this.memo.detail;
    let out: GameDetail = { ...d };
    // Tables: as of the newest summary p has passed.
    const tables = held.detail;
    if (tables) {
      out = { ...out, stats: tables.stats };
      if (out.basketball && tables.basketball) {
        const old = tables.basketball;
        out = { ...out, basketball: { ...out.basketball, topBox: old.topBox, bottomBox: old.bottomBox, topTotals: old.topTotals, bottomTotals: old.bottomTotals, leaders: old.leaders } };
      }
    }
    out = { ...out, moments: d.moments.filter((m) => this.shows(m.id)), recentPlays: this.recentPlays(d) };
    if (out.basketball) {
      const nba = out.basketball;
      out = { ...out, basketball: { ...nba, shots: nba.shots.filter((s) => this.shows(s.id)), flow: nba.flow.filter((f) => this.shows(f.id)), plays: nba.plays.filter((x) => this.shows(x.id)) } };
    }
    out = { ...out, battedBalls: d.battedBalls.filter((b) => this.shows(b.id)) };
    if (this.sport === "baseball") {
      const told = this.toldPlays;
      out = { ...out, atBat: currentAtBat(told), battedBalls: battedBalls(told, side), baseball: this.presentedBaseball(d.baseball) };
    }
    const [top, draw] = this.win(d);
    out = { ...out, topWinProbability: top, drawProbability: draw, odds: presentedOdds(d.odds, p) };
    if (d.linescore) out = { ...out, linescore: this.linescore(d.linescore, held.detail?.linescore ?? null) };
    this.memo = { key, input: d, detail: out };
    return out;
  }

  /** The tables to show at `p`: the newest summary whose watermark p has passed (before any has, the first: opening on a game in progress). */
  private heldTables(p: PTime): { index: number; detail: GameDetail | null } {
    if (this.tables.length === 0) return { index: -1, detail: null };
    for (let i = this.tables.length - 1; i >= 0; i--) if (this.tables[i]!.watermark <= p) return { index: i, detail: this.tables[i]!.detail };
    return { index: 0, detail: this.tables[0]!.detail };
  }

  /** The last plays, newest first, as each sport's page lists them, from the told plays. */
  private recentPlays(d: GameDetail): string[] {
    const told = this.toldPlays;
    const text = (p: JSONValue) => str(at(p, "text"));
    switch (this.sport) {
      case "basketball":
        // The summary's lines carry no IDs on the web: before anything's told, they show only while the timeline knows no plays (Swift's `shows`).
        if (told.length > 0) return nbaRecentPlays(told);
        return this.engine?.timeline.isEmpty !== false ? [...d.recentPlays] : [];
      case "baseball":
        return told
          .filter((p) => str(at(p, "type", "type")) === "play-result")
          .slice(-4)
          .reverse()
          .flatMap((p) => text(p) ?? []);
      case "football":
        return told
          .slice(-4)
          .reverse()
          .flatMap((p) => text(p) ?? []);
      case "soccer": {
        // Commentary: rows with a play show once it's told; a line without one ("Match ends") once the game has ended.
        const all = d.allRecentPlays;
        return all
          .filter((r) => (r.id != null ? this.shows(r.id) : isFinal(this.presented)))
          .slice(-4)
          .reverse()
          .map((r) => r.text);
      }
      case null:
        return [...d.recentPlays];
    }
  }

  /** ESPN's win probability after the last told play that has one (soccer: and the draw). */
  private win(d: GameDetail): [number | null, number | null] {
    const timeline = this.engine?.timeline;
    if (Object.keys(d.winByPlay).length === 0 || !timeline) return [d.topWinProbability, d.drawProbability];
    for (let i = timeline.toldCount - 1; i >= 0; i--) {
      const chance = d.winByPlay[timeline.records[i]!.entry.id];
      if (chance) {
        const top = this.topIsHome ? chance.home : Math.max(1 - chance.home - chance.tie, 0);
        return [top, chance.tie > 0 ? chance.tie : null];
      }
    }
    return [d.topWinProbability, d.drawProbability];
  }

  /**
   * The line score from the told plays, period by period (each cell the
   * points scored in it, blank until it starts); a timeline that doesn't
   * start at the game's start keeps the held summary's. Baseball's periods
   * are half-innings: the top half's runs are the visitors', the bottom's the
   * home side's; its hits and errors come with the held summary.
   */
  private linescore(line: Linescore, held: Linescore | null): Linescore {
    const timeline = this.engine?.timeline;
    const first = timeline?.records[0];
    const total = line.headers.findIndex((h) => h === "T" || h === "R");
    const score = this.presented.score;
    if (!timeline || !first || first.entry.period > 1 || total < 0 || !score) return held ?? line;
    const atEnd = new Map<number, ScoreLine>();
    for (const record of timeline.records.slice(0, timeline.toldCount)) if (record.entry.score) atEnd.set(record.entry.period, record.entry.score);
    const current = this.presented.period ?? 0;
    const end = (period: number): ScoreLine => {
      for (let k = period; k >= 1; k--) {
        const s = atEnd.get(k);
        if (s) return s;
      }
      return { home: 0, away: 0 };
    };
    const baseball = this.sport === "baseball";
    const top = [...line.top];
    const bottom = [...line.bottom];
    for (let column = 0; column < total; column++) {
      if (!(column < top.length && column < bottom.length)) continue;
      let home = "";
      let away = "";
      if (baseball) {
        const topHalf = 2 * (column + 1) - 1;
        const bottomHalf = topHalf + 1;
        if (topHalf <= current) away = String(end(topHalf).away - end(topHalf - 1).away);
        if (bottomHalf <= current) home = String(end(bottomHalf).home - end(bottomHalf - 1).home);
      } else if (column + 1 <= current) {
        home = String(end(column + 1).home - end(column).home);
        away = String(end(column + 1).away - end(column).away);
      }
      top[column] = this.topIsHome ? home : away;
      bottom[column] = this.topIsHome ? away : home;
    }
    if (total < top.length && total < bottom.length) {
      top[total] = String(this.topIsHome ? score.home : score.away);
      bottom[total] = String(this.topIsHome ? score.away : score.home);
    }
    if (baseball && held && held.headers.join("\u0001") === line.headers.join("\u0001")) {
      for (let i = total + 1; i < line.headers.length; i++) {
        if (i < held.top.length && i < held.bottom.length && i < top.length) {
          top[i] = held.top[i]!;
          bottom[i] = held.bottom[i]!;
        }
      }
    }
    return { ...line, headers: line.headers, top, bottom };
  }

  /**
   * The diamond as it stood after the last told play: the fast lane's
   * situation recorded after it (or the nearest before it); else the count
   * and outs from the told pitches.
   */
  private presentedBaseball(fallback: Baseball | null): Baseball | null {
    const timeline = this.engine?.timeline;
    const last = timeline?.lastTold;
    if (!timeline || !last) return fallback;
    const toldIDs = new Set(timeline.records.slice(0, timeline.toldCount).map((r) => r.entry.id));
    for (let i = this.situations.length - 1; i >= 0; i--) if (toldIDs.has(this.situations[i]!.play)) return this.situations[i]!.situation;
    let balls = 0;
    let strikes = 0;
    for (const pitch of currentAtBat(this.toldPlays)) {
      if (pitch.result === "ball") balls = Math.min(balls + 1, 3);
      else if (pitch.result === "strike" && (pitch.strike !== "foul" || strikes < 2)) strikes = Math.min(strikes + 1, 2);
    }
    const outs = int(at(last.entry.payload.json, "outs")) ?? fallback?.outs ?? 0;
    return {
      balls,
      strikes,
      outs,
      onFirst: fallback?.onFirst ?? false,
      onSecond: fallback?.onSecond ?? false,
      onThird: fallback?.onThird ?? false,
      batter: fallback?.batter ?? null,
      pitcher: fallback?.pitcher ?? null,
      lastPlay: last.entry.text,
      runners: fallback?.runners ?? [null, null, null],
      batterID: fallback?.batterID ?? null,
      pitcherID: fallback?.pitcherID ?? null,
      runnerIDs: fallback?.runnerIDs ?? [null, null, null],
    };
  }

  // MARK: The theater's side

  now(): PTime {
    return this.time.now();
  }

  snapshot(): TimelineSnapshot<RawPlay> {
    return this.engine?.snapshot(this.time.now()) ?? (EMPTY_SNAPSHOT as TimelineSnapshot<RawPlay>);
  }

  get hints(): readonly Hint[] {
    return this.engine?.timeline.hints ?? [];
  }

  setBindingHorizons(horizons: BindingHorizons): void {
    const engine = this.engine;
    if (!engine) return;
    engine.setHorizons(horizons);
    this.step();
  }

  setAnchors(anchors: ReadonlyMap<string, PTime>, covering: ReadonlySet<string> | null, leadIns: ReadonlyMap<string, number> = new Map()): void {
    const engine = this.engine;
    if (!engine) return;
    engine.setAnchors(anchors, leadIns, covering);
    this.step();
  }
}

/** The odds chart's ESPN side up to p (seconds): its model's points and the plays, by event time; the periods clipped there. */
export function presentedOdds(basis: OddsBasis, p: PTime): OddsBasis {
  const until = p * 1000;
  const periods = basis.periods.filter((x) => x.t <= until).map((x) => ({ ...x, end: Math.min(x.end, until) }));
  return {
    ...basis,
    win: basis.win.filter((x) => x.t <= until),
    plays: basis.plays.filter((x) => x.t <= until),
    periods,
    start: basis.start != null && basis.start <= until ? basis.start : null,
    end: basis.end != null && basis.start != null && basis.start <= until ? Math.min(basis.end, until) : null,
  };
}

/** Swift's `Int(text)`. */
function toInt(text: string | null): number | null {
  return text != null && /^[+-]?\d+$/.test(text) ? Number(text) : null;
}

/** The presented-state equality the page's selectors use. */
export { samePresented };
