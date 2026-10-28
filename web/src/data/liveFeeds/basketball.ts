/**
 * ESPN's real-time NBA lane while a game page is open (BasketballFeed.swift):
 * the clock every few seconds (two requests of a few hundred bytes: the core
 * API's `situation` and `status`), and the newest plays only when the
 * situation points at one we haven't read. The game summary (refreshed every
 * 30 seconds) stays the full record; this lane adds the shots, scores and
 * moments that came after it.
 *
 * ESPN rewrites a third of shots under the same ID (a placeholder becomes a
 * jumper, a block is added), median 30 s later, and deletes or splices in a
 * few, so each look re-reads whole pages from a little before the newest
 * known play and everything derived (shots, flow, possession, streaks, the
 * run) is recomputed from the window, never incrementally. Announced moments
 * are reconciled against each look: a play edited into more is news again,
 * one deleted or edited into less is taken back (`takeRetractions`).
 *
 * Plain TypeScript, no React: every field is replaced only when its value
 * changed, so readers compare by identity (`subscribe` to hear a change).
 * The WNBA reads the same feed (its league and 10-minute quarters).
 */
import {
  clutch as isClutch,
  courtPlays,
  elapsed as gameElapsed,
  FIRE_STREAK,
  flowPoint,
  isFireMilestone,
  isFreeThrow,
  NO_BALL,
  ball as ballOf,
  participants,
  periodEnd,
  periodName,
  QUARTER,
  recentPlays,
  seconds,
  shot,
  short,
  streaks as streaksOf,
  TURNOVER_TYPES,
  DUNK_TYPES,
  buzzer,
  laneLinescore,
  opponent,
  type CourtPlay,
  type FlowPoint,
  type Shot,
} from "../basketball";
import { clockReading } from "../clock";
import type { Fetcher } from "../http";
import { arr, at, bool, str, type JSONValue } from "../json";
import type { GameClock, Side } from "../models";
import { liveMoment, Tier, type Accent, type LiveMoment } from "../moments";
import { nbaFacts } from "../scoringFacts";
import { liveScore, playIDFromRef, teamIDFromRef, type LiveScore } from "./baseball";

/** Who's playing, for reading the plays (BasketballFeed.Teams). */
export interface Teams {
  readonly topIsHome: boolean;
  readonly topID: string | null;
  readonly bottomID: string | null;
  readonly topName: string;
  readonly bottomName: string;
}

export const sideIn = (teams: Teams) => (id: string | null | undefined): Side | null => (id == null ? null : id === teams.topID ? "top" : id === teams.bottomID ? "bottom" : null);
const nameOf = (teams: Teams, side: Side) => (side === "top" ? teams.topName : teams.bottomName);
/** Top − bottom. */
export const marginOf = (teams: Teams, score: LiveScore) => (teams.topIsHome ? score.home - score.away : score.away - score.home);

/** "LAL 74–71", leader first; "Tied 74–74". */
export function scoreText(teams: Teams, score: LiveScore): string {
  const [top, bottom] = teams.topIsHome ? [score.home, score.away] : [score.away, score.home];
  if (top === bottom) return `Tied ${top}–${bottom}`;
  return top > bottom ? `${teams.topName} ${top}–${bottom}` : `${teams.bottomName} ${bottom}–${top}`;
}

/** A scoring run: who's on it, from its first play to its newest, and its points against the other team's ("12–0", "10–2"). */
export interface Run {
  readonly team: Side;
  /** Game seconds at its first play, and at its newest. */
  readonly start: number;
  readonly end: number;
  readonly larger: number;
  readonly smaller: number;
}

export const runLabel = (r: Run) => `${r.larger}–${r.smaller} run`;
export const runSpan = (r: Run): readonly [number, number] => [r.start, Math.max(r.start, r.end)];

export interface BasketballUpdate {
  /** "basketball/nba" or "basketball/wnba". */
  readonly path: string;
  readonly eventID: string;
  readonly teams: Teams;
  readonly signal?: AbortSignal;
}

const PAGE_SIZE = 50;
/** Plays re-read behind the newest, so recent rewrites are always seen. */
const LOOK_BACK = 20;
/** Enough history to see where a run started. */
const WINDOW_SIZE = 150;
/** A run (by margin: 10–2 is 8) is news when it reaches each of these. */
export const RUN_MILESTONES = [8, 12, 16, 20, 24, 28];

export class BasketballFeed {
  /** Field-goal attempts among the newest plays. */
  shots: readonly Shot[] = [];
  /** The score after each scoring play among the newest plays. */
  flow: readonly FlowPoint[] = [];
  /** The newest plays as the court uses them, edits and deletions included: splice over the summary's with `mergePlays`. */
  plays: readonly CourtPlay[] = [];
  /** The last few plays, newest first ("Q3 4:12  …"). */
  recentPlays: readonly string[] = [];
  score: LiveScore | null = null;
  /** The period of the newest play, the one `score` is read from. */
  period: number | null = null;
  /** "4:12 - 3rd", "Halftime", "End of 3rd". */
  clock: string | null = null;
  /** The game clock from 5-second readings, so it ticks only while really running. */
  gameClock: GameClock | null = null;
  /** Game seconds played at the last reading (the game flow runs to here). */
  elapsed: number | null = null;
  /** True once the play feed has been read. */
  loaded = false;
  /** The status says the game is on (halftime included). Everything below is live information, cleared when it isn't. */
  playing = false;
  /** Who has the ball; while a shot is in the air, the team that shot it. */
  possession: Side | null = null;
  /** A missed shot or last free throw waiting for its rebound. */
  ballInAir = false;
  /** The last five minutes of the fourth or overtime, within five. */
  clutch = false;
  /** Players on fire: straight makes (FIRE_STREAK or more) by athlete ID. */
  streaks: Readonly<Record<string, number>> = {};
  /** ESPN's scoring run while one is on (8+ points of margin): the game flow's band. */
  runs: readonly Run[] = [];

  private window: JSONValue[] = [];
  /** Index in ESPN's full play list of `window[0]`. */
  private windowStart = 0;
  private fetched: number | null = null;
  private lastPlayRef: string | null = null;
  private newestID: string | null = null;
  private moments: LiveMoment[] = [];
  /** Each play announced as a moment, as it was announced: an edit can take it back or make it bigger. */
  private announced = new Map<string, LiveMoment>();
  private retracted: string[] = [];
  private primed = false;
  /** Looks at the play list so far, and the look each play was first seen in. */
  private looks = 0;
  private firstSeen = new Map<string, number>();
  private teams: Teams | null = null;
  private quarter: number = QUARTER.nba;
  /** The status endpoint's word on whether the game is on (null: no reading yet). */
  private statusLive: boolean | null = null;
  private inflight: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  private changed = false;
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** A token that changes whenever anything the page reads changes (for useSyncExternalStore). */
  version = 0;

  private set<K extends keyof this>(key: K, value: this[K], same: (a: this[K], b: this[K]) => boolean = Object.is): void {
    if (same(this[key], value)) return;
    this[key] = value;
    this.changed = true;
  }

  private flush(): void {
    if (!this.changed) return;
    this.changed = false;
    this.version += 1;
    for (const l of this.listeners) l();
  }

  /** One look: the status and situation, then new plays if the last play changed. One update at a time. */
  async update(fetcher: Fetcher, options: BasketballUpdate): Promise<void> {
    while (this.inflight) await this.inflight.catch(() => {});
    if (options.signal?.aborted) return;
    this.inflight = this.look(fetcher, options);
    try {
      await this.inflight;
    } finally {
      this.inflight = null;
      this.flush();
    }
  }

  private async look(fetcher: Fetcher, { path, eventID, teams, signal }: BasketballUpdate): Promise<void> {
    this.teams = teams;
    this.quarter = path.endsWith("wnba") ? QUARTER.wnba : QUARTER.nba;
    const league = path.split("/").pop() ?? "nba";
    const base = `https://sports.core.api.espn.com/v2/sports/basketball/leagues/${league}/events/${eventID}/competitions/${eventID}`;
    const [situation, status] = await Promise.all([fetcher(`${base}/situation`, { signal }).catch(() => null), fetcher(`${base}/status`, { signal }).catch(() => null)]);
    if (signal?.aborted) return;
    if (status != null) this.readStatus(status);
    if (situation == null) return;
    // New plays only when the last one changed.
    const lastRef = str(at(situation, "lastPlay", "$ref")) ?? null;
    if (lastRef !== this.lastPlayRef || !this.loaded) {
      await this.loadPlays(fetcher, base, teams, signal);
      // The play feed can trail the situation by a few seconds: keep asking until it has the play the situation points to.
      const id = lastRef ? playIDFromRef(lastRef) : null;
      if (!signal?.aborted && (id == null || id === this.newestID)) this.lastPlayRef = lastRef;
    }
  }

  /** The summary's linescore with this lane's score in it, while the game is on. */
  linescore<L extends { readonly headers: readonly string[]; readonly top: readonly string[]; readonly bottom: readonly string[] }>(summary: L, topIsHome: boolean): L {
    if (!this.playing || !this.score) return summary;
    const lane = topIsHome ? { top: this.score.home, bottom: this.score.away } : { top: this.score.away, bottom: this.score.home };
    return laneLinescore(summary, lane, this.period);
  }

  /** The moments since the last call. */
  takeMoments(): LiveMoment[] {
    const out = this.moments;
    this.moments = [];
    return out;
  }

  /** Plays whose moment was taken back (deleted, or edited into less) since the last call. */
  takeRetractions(): string[] {
    const out = this.retracted;
    this.retracted = [];
    return out;
  }

  /** The status endpoint (BasketballFeed.read). */
  readStatus(status: JSONValue): void {
    const text = str(at(status, "type", "shortDetail"));
    if (str(at(status, "type", "state")) !== "in" || !text) {
      this.set("clock", null);
      this.set("gameClock", null);
      this.statusLive = false;
      this.set("playing", false);
      this.set("possession", null);
      this.set("ballInAir", false);
      this.set("clutch", false);
      this.set("streaks", {}, sameRecord);
      this.set("runs", [], sameRuns);
      return;
    }
    this.statusLive = true;
    this.set("playing", true);
    this.set("clock", text);
    const secs = typeof at(status, "clock") === "number" ? (at(status, "clock") as number) : null;
    const period = typeof at(status, "period") === "number" ? (at(status, "period") as number) : null;
    if (secs != null && period != null) {
      const reading = clockReading({ seconds: secs, sampledAt: this.now(), period, direction: "down", display: text, running: false }, this.gameClock);
      this.set("gameClock", reading, sameClock);
      this.set("elapsed", gameElapsed(period, str(at(status, "displayClock")) ?? "", this.quarter));
      if (this.teams && this.score) this.set("clutch", isClutch(period, secs, marginOf(this.teams, this.score)));
    }
  }

  private async loadPlays(fetcher: Fetcher, base: string, teams: Teams, signal?: AbortSignal): Promise<void> {
    // First look: start a couple of pages from the end, not at tip-off (the summary already has the game so far).
    if (this.fetched == null) {
      const head = await fetcher(`${base}/plays?limit=1`, { signal }).catch(() => null);
      if (head == null) return;
      const count = typeof at(head, "count") === "number" ? (at(head, "count") as number) : 0;
      this.fetched = Math.max(count - 2 * PAGE_SIZE, 0);
    }
    const known = this.fetched;
    // Re-read from a little before the newest known play, whole pages.
    let page = Math.floor(Math.max(known - LOOK_BACK, 0) / PAGE_SIZE) + 1;
    const start = (page - 1) * PAGE_SIZE;
    const fresh: JSONValue[] = [];
    let total = known;
    let complete = false;
    while (!signal?.aborted) {
      const json = await fetcher(`${base}/plays?limit=${PAGE_SIZE}&page=${page}`, { signal }).catch(() => null);
      if (json == null) break;
      const items = arr(at(json, "items"));
      fresh.push(...items.map(normalized));
      total = (page - 1) * PAGE_SIZE + items.length;
      const pageCount = typeof at(json, "pageCount") === "number" ? (at(json, "pageCount") as number) : page;
      if (page >= pageCount || items.length === 0) {
        complete = true;
        break;
      }
      page += 1;
    }
    // A partial read would drop plays we have; the next look tries again.
    if (!complete || signal?.aborted) return;
    const freshIDs = new Set(fresh.flatMap((p) => str(at(p, "id")) ?? []));
    // Keep what came before the re-read; it replaces everything from there on.
    const firstLook = this.window.length === 0;
    const keep = firstLook ? 0 : Math.max(0, Math.min(start - this.windowStart, this.window.length));
    let next = [...this.window.slice(0, keep).filter((p) => !freshIDs.has(str(at(p, "id")) ?? "")), ...fresh];
    let nextStart = firstLook ? start : this.windowStart;
    if (next.length > WINDOW_SIZE) {
      const drop = next.length - WINDOW_SIZE;
      next = next.slice(drop);
      nextStart += drop;
    }
    this.fetched = total;
    this.ingest(next, nextStart, teams);
  }

  /**
   * One complete look at the newest plays (in ESPN's order; `start` is the
   * index of the first in the full list): new plays become moments, edits to
   * announced ones are reconciled, and everything derived is recomputed from
   * the whole window. The first look is history: nothing in it is news.
   */
  ingest(next: readonly JSONValue[], start: number, teams: Teams): void {
    this.teams = teams;
    this.looks += 1;
    const previous = new Set(this.window.flatMap((p) => str(at(p, "id")) ?? []));
    this.window = [...next];
    this.windowStart = start;
    const last = this.window.at(-1);
    this.newestID = last != null ? (str(at(last, "id")) ?? null) : null;
    const latest = last != null ? liveScore(last) : null;
    if (latest) {
      this.set("score", latest, (a, b) => a?.home === b?.home && a?.away === b?.away);
      const p = at(last, "period", "number");
      this.set("period", typeof p === "number" ? p : null);
    }
    const ids = this.window.flatMap((p) => str(at(p, "id")) ?? []);
    for (const id of ids) if (!this.firstSeen.has(id)) this.firstSeen.set(id, this.looks);
    if (this.firstSeen.size > ids.length + 40) {
      const current = new Set(ids);
      for (const id of [...this.firstSeen.keys()]) if (!current.has(id)) this.firstSeen.delete(id);
    }
    const side = sideIn(teams);
    const fromTipOff = this.windowStart === 0;

    // Until a complete look it's history; after, new plays are news. A play spliced in before one already seen (entered late) isn't "now".
    if (this.primed) {
      const ages = new Map<string, number>();
      for (const id of ids) ages.set(id, this.looks - (this.firstSeen.get(id) ?? this.looks));
      const edits = reconcile(this.announced, this.window, teams, fromTipOff, ages);
      this.moments.push(...edits.upgraded);
      this.retracted.push(...edits.retracted);
      this.announced = edits.announced;
      let lastSeen = -1;
      this.window.forEach((p, i) => {
        if (previous.has(str(at(p, "id")) ?? "")) lastSeen = i;
      });
      for (let index = lastSeen + 1; index < this.window.length; index++) {
        const found = momentAt(index, this.window, teams, fromTipOff);
        const m = found ? { ...found, facts: nbaFacts(this.window[index], teams.topIsHome) } : null;
        if (m) {
          this.moments.push(m);
          this.announced.set(m.id, m);
        }
      }
      // Only recent plays can still change what's on screen.
      if (this.announced.size > 40) {
        const recent = new Set(this.window.slice(-40).flatMap((p) => str(at(p, "id")) ?? []));
        for (const id of [...this.announced.keys()]) if (!recent.has(id)) this.announced.delete(id);
      }
    }
    this.primed = true;
    this.set("loaded", true);

    this.set("shots", this.window.flatMap((p) => shot(p, side, this.quarter) ?? []), sameJSON);
    const court = courtPlays(this.window, side, teams.topIsHome, this.quarter);
    this.set("plays", court, sameJSON);
    const points: FlowPoint[] = [];
    for (const play of this.window) {
      if (bool(at(play, "scoringPlay")) !== true) continue;
      const point = flowPoint(play, points.at(-1) ?? null, teams.topIsHome, this.quarter);
      if (point) points.push(point);
    }
    this.set("flow", points, sameJSON);
    this.set("recentPlays", recentPlays(this.window), sameJSON);
    this.derive(court, teams);
  }

  /** The live state recomputed from the whole window each look (never incrementally: ESPN edits, deletes and splices plays). */
  private derive(court: readonly CourtPlay[], teams: Teams): void {
    // The status decides when it has spoken; until then, the plays (on until "End of Game").
    const last = this.window.at(-1);
    const ended = last != null && periodEnd(last)?.final === true;
    this.set("playing", this.statusLive ?? !ended);
    const b = this.playing ? ballOf(court) : NO_BALL;
    this.set("possession", b.side);
    this.set("ballInAir", b.inAir);
    if (!this.playing) {
      this.set("streaks", {}, sameRecord);
      this.set("runs", [], sameRuns);
      this.set("clutch", false);
      return;
    }
    this.set("streaks", Object.fromEntries(Object.entries(streaksOf(court)).filter(([, n]) => n >= FIRE_STREAK)), sameRecord);
    const run = activeRun(this.window, teams, this.quarter);
    this.set("runs", run ? [run] : [], sameRuns);
    // Clutch from the newest play until the status has a fresher clock.
    if (!this.gameClock && last != null && this.score) {
      const period = at(last, "period", "number");
      const left = seconds(str(at(last, "clock", "displayValue")) ?? "");
      if (typeof period === "number" && left != null) this.set("clutch", isClutch(period, left, marginOf(teams, this.score)));
    } else if (this.gameClock && this.score) {
      this.set("clutch", isClutch(this.gameClock.period, this.gameClock.seconds, marginOf(teams, this.score)));
    }
  }
}

// MARK: - Runs

/** A core play's `scoringRun`: the team on it, its points against the other team's, and the play it started with (its identity). */
export function scoringRun(play: JSONValue): { team: string | null; larger: number; smaller: number; start: string | null } | null {
  const run = at(play, "scoringRun");
  const larger = at(run, "larger");
  const smaller = at(run, "smaller");
  if (typeof larger !== "number" || typeof smaller !== "number") return null;
  const ref = str(at(run, "play", "$ref"));
  return {
    team: teamIDFromRef(str(at(run, "team", "$ref"))) ?? str(at(run, "team", "id")) ?? null,
    larger,
    smaller,
    start: (ref ? playIDFromRef(ref) : null) ?? str(at(run, "play", "id")) ?? null,
  };
}

function playElapsed(play: JSONValue | undefined, quarter: number): number | null {
  if (play == null) return null;
  const period = at(play, "period", "number");
  return typeof period === "number" ? gameElapsed(period, str(at(play, "clock", "displayValue")) ?? "", quarter) : null;
}

/** ESPN's scoring run, while it's on: the newest play carries it. It starts at the play ESPN names (or the earliest we have that carries it). */
export function activeRun(plays: readonly JSONValue[], teams: Teams, quarter: number = QUARTER.nba): Run | null {
  const last = plays.at(-1);
  const run = last != null ? scoringRun(last) : null;
  const team = run ? sideIn(teams)(run.team) : null;
  if (!run || !team) return null;
  const first = plays.find((p) => str(at(p, "id")) === run.start) ?? plays.find((p) => scoringRun(p)?.start === run.start);
  const start = playElapsed(first, quarter);
  const end = playElapsed(last, quarter);
  if (start == null || end == null) return null;
  return { team, start, end: Math.max(start, end), larger: run.larger, smaller: run.smaller };
}

// MARK: - Moments

/**
 * Announced plays against ESPN's current list: a play that's gone, or edited
 * into less (a basket overturned), is taken back; one edited into more (a
 * placeholder that turns out to be a three) is news again.
 */
export function reconcile(
  announced: ReadonlyMap<string, LiveMoment>,
  window: readonly JSONValue[],
  teams: Teams,
  fromTipOff = false,
  ages: ReadonlyMap<string, number> = new Map(),
): { upgraded: LiveMoment[]; retracted: string[]; announced: Map<string, LiveMoment> } {
  const indices = new Map<string, number>();
  window.forEach((p, i) => {
    const id = str(at(p, "id"));
    if (id) indices.set(id, i);
  });
  const upgraded: LiveMoment[] = [];
  const retracted: string[] = [];
  const kept = new Map(announced);
  for (const [id, was] of announced) {
    const index = indices.get(id);
    if (index == null) {
      retracted.push(id);
      kept.delete(id);
      continue;
    }
    const now = momentAt(index, window, teams, fromTipOff, ages.get(id) ?? 0, was);
    if (now && now.tier > was.tier) {
      upgraded.push(now);
      kept.set(id, now);
    } else if (!now || now.tier < was.tier || basketTakenBack(was, now)) {
      retracted.push(id);
      if (now) kept.set(id, now);
      else kept.delete(id);
    }
  }
  return { upgraded, retracted, announced: kept };
}

/** A made basket that's now a miss (or gone). */
function basketTakenBack(was: LiveMoment, now: LiveMoment | null): boolean {
  if (was.kind !== "made") return false;
  if (now?.kind === "made") return false;
  return now?.kind !== "run" && now?.kind !== "leadChange";
}

const intOf = (v: JSONValue): number | null => (typeof v === "number" ? Math.trunc(v) : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : null);

/**
 * The play at `index` as a moment, from its structured fields (never its
 * text): the end of a period; a lead changing hands in the fourth or
 * overtime; ESPN's scoring run (8+ points of margin) appearing or growing by
 * another 4; a shot's story (make, miss, block); a steal. One moment per
 * play, the biggest thing it did. ESPN adds blocks and steals, refines
 * placeholder shots into dunks and logs and-one fouls after the fact: those
 * celebrate only while the play is still news (`age`: looks since it first
 * appeared). Whatever `was` announced stays: an edit never takes back an accent.
 */
export function momentAt(index: number, plays: readonly JSONValue[], teams: Teams, fromTipOff = false, age = 0, was: LiveMoment | null = null): LiveMoment | null {
  const play = plays[index];
  const id = str(at(play, "id"));
  if (!id) return null;
  const text = short(str(at(play, "text")) ?? "");
  const side = sideIn(teams)(str(at(play, "team", "id")));

  const end = periodEnd(play);
  if (end) {
    const score = liveScore(play);
    if (!score) return null;
    return liveMoment({ id, chart: "court", tier: Tier.swing, kind: "periodEnd", lead: end.final ? "Final" : `End of ${periodName(end.period)}`, detail: scoreText(teams, score) });
  }
  const isShot = bool(at(play, "shootingPlay")) === true && !isFreeThrow(play);
  const scored = bool(at(play, "scoringPlay")) === true && (intOf(at(play, "scoreValue")) ?? 1) > 0;
  const basket = isShot ? shotMoment(index, plays, teams, fromTipOff, age, was) : null;

  const after = liveScore(play);
  if (scored && (index > 0 || fromTipOff) && after) {
    const before = index > 0 ? liveScore(plays[index - 1]) : { home: 0, away: 0 };
    // A buzzer-beater (or a pressure basket raised to a score) outranks the story it's part of.
    if (basket && basket.tier === Tier.score) return basket;
    if (before) {
      const marginBefore = marginOf(teams, before);
      const marginAfter = marginOf(teams, after);
      const scorer: Side | null = marginAfter > marginBefore ? "top" : marginAfter < marginBefore ? "bottom" : side;
      // Lead changes: the last team ahead (ties don't count) loses it, late.
      const period = intOf(at(play, "period", "number")) ?? 0;
      const earlier = lastLeader(index, plays, teams);
      if (period >= 4 && marginAfter !== 0 && earlier != null && earlier !== Math.sign(marginAfter)) {
        return liveMoment({ id, chart: "court", tier: Tier.swing, kind: "leadChange", lead: "Lead change", detail: `${text} · ${scoreText(teams, after)}`, side: scorer, accents: basket?.accents ?? [] });
      }
      // Runs: ESPN's own, news when it starts or grows past a milestone.
      const run = scoringRun(play);
      if (run) {
        const prior = index > 0 ? scoringRun(plays[index - 1]) : null;
        const earlierRun = prior && prior.start === run.start ? prior : null;
        const was8 = earlierRun ? earlierRun.larger - earlierRun.smaller : 0;
        const now = run.larger - run.smaller;
        if (RUN_MILESTONES.some((m) => was8 < m && now >= m)) {
          const team = sideIn(teams)(run.team) ?? scorer;
          const span = activeRun(plays.slice(0, index + 1), teams);
          return {
            ...liveMoment({
              id,
              chart: "court",
              tier: Tier.swing,
              kind: "run",
              lead: `${run.larger}–${run.smaller} run`,
              detail: [team ? nameOf(teams, team) : null, text].filter(Boolean).join(" · "),
              side: team,
              accents: basket?.accents ?? [],
            }),
            ...(span ? { span: [span.start, Math.max(span.start, span.end)] as const } : {}),
          };
        }
      }
    }
  }
  if (basket) return basket;
  // A steal: a turnover with a second participant (the defender who took it).
  const type = intOf(at(play, "type", "id"));
  if (type != null && TURNOVER_TYPES.has(type)) {
    const people = participants(play);
    if (people.length < 2 || !(age <= 2 || was?.kind === "steal")) return null;
    return liveMoment({ id, chart: "court", tier: Tier.swing, kind: "steal", lead: "Steal", detail: text, side: side ? opponent(side) : null, targets: [people[1]!] });
  }
  return null;
}

/** A field-goal attempt's moment: a make with its accents, a block, or a miss. */
function shotMoment(index: number, plays: readonly JSONValue[], teams: Teams, fromTipOff: boolean, age: number, was: LiveMoment | null): LiveMoment | null {
  const play = plays[index];
  const id = str(at(play, "id"));
  if (!id) return null;
  const text = short(str(at(play, "text")) ?? "");
  const side = sideIn(teams)(str(at(play, "team", "id")));
  const people = participants(play);
  const period = intOf(at(play, "period", "number")) ?? 0;
  const clock = str(at(play, "clock", "displayValue")) ?? "";
  if (!(bool(at(play, "scoringPlay")) === true && (intOf(at(play, "scoreValue")) ?? 1) > 0)) {
    // A block: a miss with a second participant (the blocker).
    if (people.length > 1 && (age <= 2 || was?.kind === "block")) {
      return liveMoment({ id, chart: "court", tier: Tier.swing, kind: "block", lead: "Block", detail: text, side: side ? opponent(side) : null, targets: [people[1]!] });
    }
    return liveMoment({ id, chart: "court", tier: Tier.routine, kind: "missed", lead: "Miss", detail: text, side });
  }
  const value = intOf(at(play, "pointsAttempted")) ?? intOf(at(play, "scoreValue")) ?? 2;
  const after = liveScore(play);
  const before = index > 0 ? liveScore(plays[index - 1]) : fromTipOff ? { home: 0, away: 0 } : null;
  // The shooter's margin before and after.
  const sign = side === "bottom" ? -1 : 1;
  const marginBefore = (before ?? after) ? marginOf(teams, (before ?? after)!) * sign : null;
  const marginAfter = after ? marginOf(teams, after) * sign : null;

  const accents = new Set<Accent>();
  const type = intOf(at(play, "type", "id"));
  if (type != null && DUNK_TYPES.has(type) && (age === 0 || index >= plays.length - 3 || was?.accents.has("dunk") === true)) accents.add("dunk");
  if (andOne(index, plays, teams) && (age <= 1 || was?.accents.has("andOne") === true)) accents.add("andOne");
  if (buzzer(clock)) {
    accents.add("buzzer");
    if (period >= 4 && marginBefore != null && marginAfter != null && marginBefore <= 0 && marginAfter >= 0) accents.add("decisive");
  }
  const streak = makes(index, plays);
  if (isFireMilestone(streak)) accents.add("onFire");
  const left = seconds(clock);
  if (left != null && marginBefore != null && isClutch(period, left, marginBefore)) accents.add("clutch");
  // An edit never takes an accent back.
  if (was?.kind === "made") for (const a of was.accents) accents.add(a);

  let tier: Tier;
  if (accents.has("buzzer")) tier = Tier.score;
  else {
    let rank = value >= 3 ? 1 : 0;
    if (accents.has("dunk")) rank += 1;
    if (accents.has("andOne")) rank += 1;
    if (accents.has("clutch") || accents.has("onFire")) rank += 1;
    tier = (Tier.routine + Math.min(rank, 2)) as Tier;
  }
  const lead = accents.has("buzzer") ? "Buzzer-beater" : accents.has("andOne") ? (value >= 3 ? "Four-point play" : "And-one") : accents.has("dunk") ? "Dunk" : value >= 3 ? "Three" : "Two";
  const best = Math.max(streak, was?.streak ?? 0);
  return {
    ...liveMoment({ id, chart: "court", tier, kind: "made", value, lead, detail: accents.has("onFire") ? `${text} · ${best} straight` : text, side, accents }),
    ...(accents.has("onFire") ? { streak: best } : {}),
  };
}

/** A make with a shooting foul by the other team at the same period and clock (the free throw may not be in yet): 204 of 204 in the data spec. */
export function andOne(index: number, plays: readonly JSONValue[], teams: Teams): boolean {
  const play = plays[index];
  const period = intOf(at(play, "period", "number"));
  const clock = str(at(play, "clock", "displayValue"));
  const shooter = sideIn(teams)(str(at(play, "team", "id")));
  for (const next of plays.slice(index + 1, index + 9)) {
    if (intOf(at(next, "period", "number")) !== period || str(at(next, "clock", "displayValue")) !== clock) break;
    if (intOf(at(next, "type", "id")) === 44) {
      const fouler = sideIn(teams)(str(at(next, "team", "id")));
      if (fouler == null || shooter == null || fouler !== shooter) return true;
    }
  }
  return false;
}

/** The shooter's straight makes through `index` (field goals only, by game order). */
export function makes(index: number, plays: readonly JSONValue[]): number {
  const shooter = participants(plays[index])[0];
  if (!shooter) return 0;
  let count = 0;
  for (let i = index; i >= 0; i--) {
    const play = plays[i];
    if (bool(at(play, "shootingPlay")) !== true || isFreeThrow(play) || participants(play)[0] !== shooter) continue;
    if (bool(at(play, "scoringPlay")) !== true) break;
    count += 1;
  }
  return count;
}

/** The sign of the margin the last time a team was ahead before `index` (null if nobody led within the plays we have). */
function lastLeader(index: number, plays: readonly JSONValue[], teams: Teams): number | null {
  for (let j = index - 1; j >= 0; j--) {
    const score = liveScore(plays[j]);
    if (score && marginOf(teams, score) !== 0) return Math.sign(marginOf(teams, score));
  }
  return null;
}

// MARK: - Parsing

/** Core plays name teams and players by link; the summary parsers expect `team.id` and `participants[].athlete.id` (shooter first). */
export function normalized(item: JSONValue): JSONValue {
  if (item == null || typeof item !== "object" || Array.isArray(item)) return item;
  const raw: Record<string, unknown> = { ...(item as Record<string, unknown>) };
  const team = teamIDFromRef(str(at(item, "team", "$ref")));
  if (team) raw.team = { id: team };
  const people = arr(at(item, "participants"))
    .map((p, offset) => ({ p, order: typeof at(p, "order") === "number" ? (at(p, "order") as number) : offset, offset }))
    .sort((a, b) => a.order - b.order || a.offset - b.offset);
  raw.participants = people.flatMap(({ p }) => {
    const id = str(at(p, "athlete", "id"));
    if (id) return [{ athlete: { id } }];
    const ref = str(at(p, "athlete", "$ref"));
    const i = ref?.indexOf("/athletes/") ?? -1;
    if (!ref || i < 0) return [];
    const digits = /^\d+/.exec(ref.slice(i + "/athletes/".length));
    return digits ? [{ athlete: { id: digits[0] } }] : [];
  });
  return raw;
}

// MARK: - Equality

function sameJSON<T>(a: T, b: T): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

function sameRecord(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

function sameRuns(a: readonly Run[], b: readonly Run[]): boolean {
  return a.length === b.length && a.every((r, i) => {
    const s = b[i]!;
    return r.team === s.team && r.start === s.start && r.end === s.end && r.larger === s.larger && r.smaller === s.smaller;
  });
}

function sameClock(a: GameClock | null, b: GameClock | null): boolean {
  return a === b || (a != null && b != null && a.seconds === b.seconds && a.period === b.period && a.display === b.display && a.running === b.running && a.sampledAt === b.sampledAt);
}
