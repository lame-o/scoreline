/**
 * ESPN's real-time football lane while a game page is open (LiveFeeds.swift
 * `FootballFeed`, `DrivePlay`; LiveSnapshot.swift `FootballGeometry`): the
 * down, distance, spot and clock every few seconds (two requests of a few
 * hundred bytes: the core API's `situation` and `status`), and the
 * play-by-play only when a new play has happened, so the drive grows snap by
 * snap on the field as it's played.
 *
 * Plain TypeScript with no React: the page's fast lane calls `update` on its
 * cadence and re-renders what changed (`subscribe`; every field is replaced
 * only when its value changed, so selectors can compare by identity).
 *
 *     const feed = new FootballFeed();
 *     await feed.update(getJSON, { path, eventID, teams });
 *     moments.retract(feed.takeRetractions());
 *     moments.offer(feed.takeMoments());
 */
import { clockReading } from "../clock";
import { ordinal } from "../format";
import { intOf, type Football } from "../gameDetail";
import type { Fetcher } from "../http";
import { at, bool, num, str, arr, type JSONValue } from "../json";
import type { GameClock, Side } from "../models";
import { liveMoment, Tier, type Accent, type LiveMoment, type MomentKind } from "../moments";
import { footballFacts } from "../scoringFacts";
import { liveScore, playIDFromRef, teamIDFromRef, type LiveScore } from "./baseball";

// MARK: - Geometry (FootballGeometry: shared with the tiles, so the two never disagree)

/** ESPN counts yard lines from the home goal line; x runs from the top team's (0…100). */
export const fieldX = (yardLine: number, topIsHome: boolean): number => (topIsHome ? yardLine : 100 - yardLine);

/** Whether the line to gain is at or past the goal line ("1st & Goal"). */
export function goalToGo(yardLine: number, distance: number, homeHasBall: boolean): boolean {
  const toEndzone = homeHasBall ? 100 - yardLine : yardLine;
  return Math.trunc(toEndzone) <= distance;
}

/** The first-down marker: the top team attacks right (+x), the bottom team left. */
export const lineToGain = (ballX: number, distance: number, possession: Side): number =>
  possession === "bottom" ? Math.max(ballX - distance, 0) : Math.min(ballX + distance, 100);

// MARK: - A snap (DrivePlay)

export type DriveKind = "rush" | "pass" | "sack" | "penalty" | "kick" | "score" | "turnover" | "other";

/** One snap of a drive, on the field's coordinates (0 = the top team's goal line, 100 = the bottom team's). */
export interface DrivePlay {
  readonly id: string;
  readonly side: Side | null;
  readonly startX: number;
  readonly endX: number;
  readonly kind: DriveKind;
  /** "1st & 10". */
  readonly downDistance: string | null;
  readonly yards: number;
  readonly clock: string;
  readonly text: string;
  readonly driveID: string | null;
  /** ESPN's play type ("Pass Incompletion", "Rushing Touchdown"). */
  readonly type: string;
  readonly turnover: boolean;
  /** ESPN's play type number: the reliable classifier (text gets edited, and has announced touchdowns that were overturned). */
  readonly typeID: string;
  /** "touchdown", "field-goal", "safety" on scoring plays. */
  readonly scoring: string | null;
  /** Play order: the feed isn't always listed in it. */
  readonly sequence: number;
  /** The score after the play (ESPN's fields include the extra point). */
  readonly homeScore: number | null;
  readonly awayScore: number | null;
  readonly period: number | null;
  /** Seconds left in the period. */
  readonly clockSeconds: number | null;
}

/** A gain this long is a big play (LMD §1.3). */
export const BIG_PLAY_YARDS = 20;

/** A pass or rush of 20+ yards (and not a penalty). */
export const bigPlay = (play: DrivePlay): boolean => play.yards >= BIG_PLAY_YARDS && play.kind !== "penalty";

export interface PlayMoment {
  readonly kind: MomentKind;
  readonly tier: Tier;
  readonly lead: string;
}

/**
 * What a snap looks like as it happens, if it's worth showing. Classified by
 * type number and scoring fields, never by the play's text (only spikes and
 * kneels, which share a type with passes and rushes, need it). (DrivePlay.moment)
 */
export function playMoment(play: DrivePlay): PlayMoment | null {
  const lower = play.text.toLowerCase();
  switch (play.scoring) {
    case "touchdown":
      return { kind: "touchdown", tier: Tier.score, lead: "Touchdown" };
    case "field-goal":
      return { kind: "fieldGoal", tier: Tier.score, lead: "Field goal" };
    case "safety":
      return { kind: "safety", tier: Tier.score, lead: "Safety" };
  }
  const big = bigPlay(play);
  switch (play.typeID) {
    case "59":
      return { kind: "fieldGoal", tier: Tier.score, lead: "Field goal" };
    case "60":
    case "18":
      return { kind: "fieldGoalMissed", tier: Tier.swing, lead: "No good" };
    case "20":
      return { kind: "safety", tier: Tier.score, lead: "Safety" };
    case "26":
    case "63":
    case "36":
      return { kind: "turnover", tier: Tier.swing, lead: "Interception" };
    case "29":
    case "30":
      return { kind: "turnover", tier: Tier.swing, lead: "Fumble lost" };
    case "7":
    case "80":
      return { kind: "sack", tier: Tier.routine, lead: "Sack" };
    case "3":
      return lower.includes("spike") ? null : { kind: "passIncomplete", tier: Tier.routine, lead: "Incomplete" };
    case "24":
    case "67":
      return big ? { kind: "passComplete", tier: Tier.swing, lead: `Big play +${play.yards}` } : { kind: "passComplete", tier: Tier.routine, lead: "Complete" };
    case "5":
    case "68":
      if (lower.includes("kneel") || lower.includes("takes a knee")) return null;
      return big ? { kind: "rush", tier: Tier.swing, lead: `Big play +${play.yards}` } : { kind: "rush", tier: Tier.routine, lead: "Rush" };
    case "8":
      return { kind: "penalty", tier: Tier.routine, lead: "Flag" };
    default:
      return play.kind === "penalty" ? { kind: "penalty", tier: Tier.routine, lead: "Flag" } : null;
  }
}

/**
 * A score that puts its team ahead with two minutes or less left in the 4th,
 * or in overtime: the game-winner. `before` is the score going into the play
 * (home, away); `scorerIsHome` is whose points they are. (DrivePlay.decides)
 */
export function decides(play: DrivePlay, before: LiveScore | null, scorerIsHome: boolean): boolean {
  if (play.period == null || play.homeScore == null || play.awayScore == null || !before) return false;
  const late = play.period >= 5 || (play.period === 4 && (play.clockSeconds ?? Infinity) <= 120);
  const [mine, theirs] = scorerIsHome ? [play.homeScore, play.awayScore] : [play.awayScore, play.homeScore];
  const [was, wasTheirs] = scorerIsHome ? [before.home, before.away] : [before.away, before.home];
  return late && mine > theirs && was <= wasTheirs;
}

/**
 * A play as a moment for the field. A touchdown belongs to whoever owns the
 * end zone it reached: a pick-six or return scores for the defense. A late
 * go-ahead score is decisive; a long gain is a big play. (FootballFeed.moment)
 */
export function footballMoment(play: DrivePlay, before: LiveScore | null = null, topIsHome = true): LiveMoment | null {
  const m = playMoment(play);
  if (!m) return null;
  const side: Side | null = m.kind === "touchdown" ? (play.endX >= 50 ? "top" : "bottom") : play.side;
  const accents: Accent[] = [];
  if ((m.kind === "passComplete" || m.kind === "rush") && bigPlay(play)) accents.push("bigPlay");
  if (m.tier === Tier.score && side && decides(play, before, (side === "top") === topIsHome)) accents.push("decisive");
  const facts = m.tier === Tier.score ? { facts: footballFacts(play, before, topIsHome) } : {};
  return liveMoment({ id: play.id, chart: "field", tier: m.tier, kind: m.kind, lead: m.lead, detail: play.text, side, accents, ...facts });
}

/** The score going into a play: the nearest earlier play (in play order) that carries one. */
export function scoreBefore(play: DrivePlay, ordered: readonly DrivePlay[]): LiveScore | null {
  const index = ordered.findIndex((p) => p.id === play.id);
  if (index < 0) return null;
  for (let i = index - 1; i >= 0; i--) {
    const p = ordered[i]!;
    if (p.homeScore != null && p.awayScore != null) return { home: p.homeScore, away: p.awayScore };
  }
  return null;
}

/** The plays of the drive in progress (or the last one), oldest first. */
export function currentDrive(plays: readonly DrivePlay[]): readonly DrivePlay[] {
  const id = plays.at(-1)?.driveID;
  if (id == null) return [];
  let i = plays.length;
  while (i > 0 && plays[i - 1]!.driveID === id) i--;
  return plays.slice(i);
}

/** The drive a play belongs to (the scoring drive stays on the field while its moment shows, even after the kickoff). */
export function driveContaining(plays: readonly DrivePlay[], playID: string): readonly DrivePlay[] | null {
  const driveID = plays.find((p) => p.id === playID)?.driveID;
  if (driveID == null) return null;
  return plays.filter((p) => p.driveID === driveID);
}

// MARK: - Parsing

export interface FootballTeams {
  readonly topIsHome: boolean;
  readonly topID: string | null;
  readonly bottomID: string | null;
  readonly homeAbbreviation: string;
  readonly awayAbbreviation: string;
  /** The teams' names ("Kent State"): college's text writes some spots with them ("Kent38"), not the abbreviation. */
  readonly homeName?: string;
  readonly awayName?: string;
}

export const teamSide = (teams: FootballTeams, id: string | null | undefined): Side | null =>
  id == null ? null : id === teams.topID ? "top" : id === teams.bottomID ? "bottom" : null;

/** Clock stoppages and admin entries, not snaps. */
const NOT_PLAYS = new Set(["Official Timeout", "Timeout", "End Period", "End of Half", "End of Game", "Two-minute warning", "Coin Toss", "End of Regulation"]);

/** "…/drives/4018730161?lang=en" → "4018730161". */
export function driveIDFromRef(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const i = ref.indexOf("/drives/");
  if (i < 0) return null;
  return /^\d+/.exec(ref.slice(i + "/drives/".length))?.[0] ?? null;
}

const sequenceOf = (item: JSONValue): number => {
  const s = str(at(item, "sequenceNumber"));
  const n = s != null ? Number(s) : num(at(item, "sequenceNumber"));
  return n != null && Number.isFinite(n) ? n : 0;
};

/** A core play as a snap on the field, or null for a stoppage (FootballFeed.play). */
export function footballPlay(item: JSONValue, teams: FootballTeams): DrivePlay | null {
  const type = str(at(item, "type", "text")) ?? "";
  const start = num(at(item, "start", "yardLine"));
  const end = num(at(item, "end", "yardLine"));
  const id = str(at(item, "id"));
  if (NOT_PLAYS.has(type) || type.startsWith("End ") || start == null || end == null || !id) return null;
  const lower = type.toLowerCase();
  const scoringPlay = bool(at(item, "scoringPlay")) === true;
  const turnover = bool(at(item, "isTurnover")) === true;
  const kind: DriveKind = scoringPlay
    ? "score"
    : turnover
      ? "turnover"
      : bool(at(item, "isPenalty")) === true || lower.includes("penalty")
        ? "penalty"
        : lower.includes("sack")
          ? "sack"
          : lower.includes("pass")
            ? "pass"
            : lower.includes("rush")
              ? "rush"
              : lower.includes("punt") || lower.includes("kickoff") || lower.includes("field goal") || lower.includes("extra point")
                ? "kick"
                : "other";
  const shortDD = str(at(item, "start", "shortDownDistanceText"));
  return {
    id,
    side: teamSide(teams, teamIDFromRef(str(at(item, "start", "team", "$ref"))) ?? teamIDFromRef(str(at(item, "team", "$ref")))),
    startX: fieldX(start, teams.topIsHome),
    endX: fieldX(end, teams.topIsHome),
    kind,
    downDistance: shortDD ? shortDD : null,
    yards: intOf(at(item, "statYardage")) ?? 0,
    clock: str(at(item, "clock", "displayValue")) ?? "",
    text: str(at(item, "shortText")) ?? str(at(item, "text")) ?? type,
    driveID: driveIDFromRef(str(at(item, "drive", "$ref"))),
    type,
    turnover,
    typeID: str(at(item, "type", "id")) ?? "",
    scoring: scoringPlay ? (str(at(item, "scoringType", "name")) ?? null) : null,
    sequence: sequenceOf(item),
    homeScore: intOf(at(item, "homeScore")),
    awayScore: intOf(at(item, "awayScore")),
    period: intOf(at(item, "period", "number")),
    clockSeconds: num(at(item, "clock", "value")) ?? null,
  };
}

/** "9:13 - 1st", "Halftime", "4:02 - OT"; null once it's over (FootballFeed.clock). */
export function footballClock(status: JSONValue): string | null {
  const display = str(at(status, "displayClock"));
  const period = intOf(at(status, "period"));
  if (!display || period == null || period <= 0) return null;
  const name = period <= 4 ? ordinal(period) : period === 5 ? "OT" : `${period - 4}OT`;
  if (str(at(status, "type", "state")) === "post") return null;
  const detail = str(at(status, "type", "shortDetail"));
  if (detail && detail.toLowerCase().includes("half")) return detail;
  return `${display} - ${name}`;
}

/**
 * "2nd & 7 at MIN 38", the ball spot and line to gain, from the core
 * situation. The geometry is the tiles' (`fieldX`, `goalToGo`, `lineToGain`),
 * so the tile and the game page always draw the same lines (on 1st & Goal,
 * none: the goal line is the target). (FootballFeed.situation)
 */
export function footballSituation(s: JSONValue, possessionTeam: string | null, teams: FootballTeams, lastPlay: string | null, afterScore = false): Football | null {
  const yardLine = num(at(s, "yardLine"));
  if (yardLine == null) return null;
  const possession = teamSide(teams, possessionTeam);
  const ballX = fieldX(yardLine, teams.topIsHome);
  const down = intOf(at(s, "down")) ?? -1;
  const distance = intOf(at(s, "distance")) ?? 0;
  const homeHasBall = possession == null ? null : (possession === "top") === teams.topIsHome;
  const goal = homeHasBall == null ? false : goalToGo(yardLine, distance, homeHasBall);
  const spot = yardLine === 50 ? "50" : yardLine < 50 ? `${teams.homeAbbreviation} ${Math.trunc(yardLine)}` : `${teams.awayAbbreviation} ${Math.trunc(100 - yardLine)}`;
  const isDown = down >= 1 && down <= 4;
  let text: string | null = null;
  // After a score ESPN parks the next kickoff as a "1st & 10"; it isn't one.
  if (afterScore) text = "Kickoff";
  else if (isDown) text = `${ordinal(down)} & ${goal ? "Goal" : distance} at ${spot}`;
  const gain = !afterScore && isDown && !goal && possession ? lineToGain(ballX, distance, possession) : null;
  return {
    downDistance: text,
    ballX,
    lineToGainX: gain,
    possession,
    redZone: bool(at(s, "isRedZone")) ?? false,
    topTimeouts: intOf(at(s, teams.topIsHome ? "homeTimeouts" : "awayTimeouts")),
    bottomTimeouts: intOf(at(s, teams.topIsHome ? "awayTimeouts" : "homeTimeouts")),
    lastPlay,
  };
}

// MARK: - The lane

export interface FootballUpdate {
  readonly path: string;
  readonly eventID: string;
  readonly teams: FootballTeams;
  readonly signal?: AbortSignal;
}

const PAGE_SIZE = 50;
/** How long a new spot may wait for the play that put it there before it shows anyway. */
const BEHIND_MS = 15_000;
/** How long before depth charts that didn't come are asked for again. */
const CHARTS_RETRY_MS = 300_000;
/** How long a team's depth chart is kept: it changes once a week. */
const CHART_DAY_MS = 86_400_000;

/** The NFL season a date falls in: September to February, as New York's calendar has it. (FootballFeed.season; pure; tested) */
export function footballSeason(date: number): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "numeric" }).formatToParts(new Date(date));
  const year = Number(parts.find((p) => p.type === "year")?.value ?? 2026);
  const month = Number(parts.find((p) => p.type === "month")?.value ?? 9);
  return year - (month <= 2 ? 1 : 0);
}

/**
 * Whether a depth chart response holds any slot (FootballDepthChart's
 * failable init: a group with positions). The lane keeps the response as
 * ESPN sent it; the theater reads it (`FootballDepthChart.from`), so the
 * lane never loads the theater's parser.
 */
export function holdsSlots(json: JSONValue): boolean {
  return arr(at(json, "items")).some((group) => {
    const positions = at(group, "positions");
    return positions != null && typeof positions === "object" && !Array.isArray(positions) && Object.keys(positions).length > 0;
  });
}

/** A team's NFL depth chart for a season (official ESPN core, about 20 KB), from the day's cache or fetched. (FootballFeed.depthChart) */
export async function depthChart(fetcher: Fetcher, team: string | null, season: number, now: number, signal?: AbortSignal): Promise<JSONValue | null> {
  if (team == null) return null;
  const key = `${season}/${team}`;
  const cached = FootballFeed.chartCache.get(key);
  if (cached && now - cached.fetched < CHART_DAY_MS) return cached.chart;
  const json = await fetcher(`https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${season}/teams/${team}/depthcharts`, { signal }).catch(() => null);
  if (json == null || !holdsSlots(json)) return null;
  FootballFeed.chartCache.set(key, { chart: json, fetched: now });
  return json;
}

export class FootballFeed {
  /** Every snap seen, in play order. Replaced only when plays arrive or change. */
  plays: readonly DrivePlay[] = [];
  /**
   * Every core play entry as ESPN sent it (its latest version), in play order:
   * for the play theater's parser (to port: FootballScene.swift), which reads
   * each play's start and end spots, down and distance, `statYardage`, type,
   * text, participants with their roles and `scoringPlay`. Replaced only when
   * entries arrive or change.
   */
  items: readonly JSONValue[] = [];
  private itemsByID = new Map<string, JSONValue>();
  situation: Football | null = null;
  /** "9:13 - 1st". */
  clock: string | null = null;
  /** The game clock from 5-second readings, so it ticks only while really running. */
  gameClock: GameClock | null = null;
  /** The team with the ball now (after the last play). */
  possession: Side | null = null;
  score: LiveScore | null = null;
  /** True once the play feed has been read in full. */
  loaded = false;
  /**
   * Both teams' depth charts (NFL) as ESPN sent them, once fetched: the
   * theater reads them (`FootballDepthChart`) and places its snaps on them
   * (`FootballTheaterWatch`). Replaced only when they come.
   */
  charts: Readonly<Partial<Record<Side, JSONValue>>> = {};
  /** Bumped on every change: a snapshot for `useSyncExternalStore`. */
  version = 0;

  /** Depth charts by season and team, kept for the day across pages: they change once a week. */
  static chartCache = new Map<string, { readonly chart: JSONValue; readonly fetched: number }>();

  private fetched = 0;
  private lastPlayRef: string | null = null;
  /** ID of the newest entry fetched (snap or not), to tell whether the feed has caught up with the situation's last play. */
  private newestID: string | null = null;
  private possessionTeam: string | null = null;
  private latestSequence = -1;
  private newestMomentSequence = -1;
  /** When the situation first ran ahead of the play feed. */
  private behindSince: number | null = null;
  /** Scores taken back by an edit (overturned on review) since the last call. */
  private retracted: string[] = [];
  private moments: LiveMoment[] = [];
  private primed = false;
  /** When the depth charts were last asked for. */
  private chartsAsked: number | null = null;
  private inflight: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  private drive_: { plays: readonly DrivePlay[]; drive: readonly DrivePlay[] } | null = null;
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  /** The plays of the drive in progress (or the last one), oldest first; the same array until the plays change. */
  get drive(): readonly DrivePlay[] {
    if (this.drive_?.plays !== this.plays) this.drive_ = { plays: this.plays, drive: currentDrive(this.plays) };
    return this.drive_.drive;
  }

  /** The moments since the last call. */
  takeMoments(): LiveMoment[] {
    const out = this.moments;
    this.moments = [];
    return out;
  }

  /** Play IDs whose score was taken back since the last call. */
  takeRetractions(): string[] {
    const out = this.retracted;
    this.retracted = [];
    return out;
  }

  /** One look: the situation and status, then new plays if the last play changed. One update at a time. */
  async update(fetcher: Fetcher, options: FootballUpdate): Promise<void> {
    while (this.inflight) await this.inflight.catch(() => {});
    if (options.signal?.aborted) return;
    this.inflight = this.look(fetcher, options);
    try {
      await this.inflight;
    } finally {
      this.inflight = null;
    }
  }

  private async look(fetcher: Fetcher, { path, eventID, teams, signal }: FootballUpdate): Promise<void> {
    const league = path.split("/").pop() ?? path;
    const base = `https://sports.core.api.espn.com/v2/sports/football/leagues/${league}/events/${eventID}/competitions/${eventID}`;
    const [s, status] = await Promise.all([fetcher(`${base}/situation`, { signal }).catch(() => null), fetcher(`${base}/status`, { signal }).catch(() => null)]);
    if (signal?.aborted) return;
    let changed = false;
    if (status != null) {
      const clock = footballClock(status);
      if (clock !== this.clock) {
        this.clock = clock;
        changed = true;
      }
      const seconds = num(at(status, "clock"));
      const period = intOf(at(status, "period"));
      const next =
        clock != null && seconds != null && period != null
          ? clockReading({ seconds, sampledAt: this.now(), period, direction: "down", display: clock, running: false }, this.gameClock)
          : null;
      if (next !== this.gameClock && JSON.stringify(next) !== JSON.stringify(this.gameClock)) {
        this.gameClock = next;
        changed = true;
      }
    }
    if (s == null) {
      if (changed) this.emit();
      return;
    }
    // New plays only when the last one changed.
    const lastRef = str(at(s, "lastPlay", "$ref")) ?? null;
    if (lastRef !== this.lastPlayRef || this.plays.length === 0) {
      if (await this.loadPlays(fetcher, base, teams, signal)) changed = true;
      // The play feed trails the situation by a few seconds: keep asking until it has the play the situation points to.
      const lastID = lastRef ? playIDFromRef(lastRef) : null;
      if (!signal?.aborted && (lastID == null || lastID === this.newestID)) this.lastPlayRef = lastRef;
    }
    // Who starts where, once a game (college has no depth charts).
    if (league === "nfl" && Object.keys(this.charts).length === 0 && this.now() - (this.chartsAsked ?? -Infinity) > CHARTS_RETRY_MS) {
      this.chartsAsked = this.now();
      if (await this.loadCharts(fetcher, teams, signal)) changed = true;
    }
    if (signal?.aborted) {
      if (changed) this.emit();
      return;
    }
    // The ball moves with its play: hold a new spot back (briefly) until the
    // play that put it there is in, so the two animate together.
    const caughtUp = lastRef === this.lastPlayRef;
    const now = this.now();
    if (caughtUp) this.behindSince = null;
    else this.behindSince ??= now;
    if (caughtUp || this.situation == null || now - (this.behindSince ?? now) > BEHIND_MS) {
      const possession = teamSide(teams, this.possessionTeam);
      if (possession !== this.possession) {
        this.possession = possession;
        changed = true;
      }
      const last = this.plays.at(-1);
      const next = footballSituation(s, this.possessionTeam, teams, last?.text ?? null, last?.kind === "score");
      if (JSON.stringify(next) !== JSON.stringify(this.situation)) {
        this.situation = next;
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  /**
   * Both teams' depth charts, from the day's cache or fetched together
   * (official ESPN core, about 20 KB each); the theater then places the snap
   * showing on them (`FootballTheaterWatch`). True when they came.
   */
  private async loadCharts(fetcher: Fetcher, teams: FootballTeams, signal?: AbortSignal): Promise<boolean> {
    const now = this.now();
    const season = footballSeason(now);
    const [top, bottom] = await Promise.all([depthChart(fetcher, teams.topID, season, now, signal), depthChart(fetcher, teams.bottomID, season, now, signal)]);
    const found: { top?: JSONValue; bottom?: JSONValue } = {};
    if (top) found.top = top;
    if (bottom) found.bottom = bottom;
    if (Object.keys(found).length === 0 || signal?.aborted) return false;
    this.charts = found;
    return true;
  }

  private async loadPlays(fetcher: Fetcher, base: string, teams: FootballTeams, signal?: AbortSignal): Promise<boolean> {
    // Start at the page holding the newest known play and read it whole:
    // ESPN edits plays in place (yardage, the extra point, a call overturned).
    let page = Math.floor(Math.max(this.fetched - 1, 0) / PAGE_SIZE) + 1;
    const fresh: DrivePlay[] = [];
    const entries: JSONValue[] = [];
    let complete = false;
    let fetched = this.fetched;
    let newestID = this.newestID;
    let latestSequence = this.latestSequence;
    let score = this.score;
    let possessionTeam = this.possessionTeam;
    while (!signal?.aborted) {
      const json = await fetcher(`${base}/plays?limit=${PAGE_SIZE}&page=${page}`, { signal }).catch(() => null);
      if (json == null) break;
      const items = arr(at(json, "items"));
      for (const item of items) {
        newestID = str(at(item, "id")) ?? newestID;
        // The score and the ball after the latest play in play order, not list order.
        const sequence = sequenceOf(item);
        if (sequence >= latestSequence) {
          latestSequence = sequence;
          const latest = liveScore(item);
          if (latest) score = latest;
          const team = teamIDFromRef(str(at(item, "end", "team", "$ref"))) ?? teamIDFromRef(str(at(item, "team", "$ref")));
          if (team) possessionTeam = team;
        }
        const play = footballPlay(item, teams);
        if (play) fresh.push(play);
        entries.push(item);
      }
      fetched = Math.max(fetched, (page - 1) * PAGE_SIZE + items.length);
      if (page >= (intOf(at(json, "pageCount")) ?? page) || items.length === 0) {
        complete = true;
        break;
      }
      page += 1;
    }
    // An abandoned look keeps nothing, so the next one reads the same plays again.
    if (signal?.aborted) return false;
    this.fetched = fetched;
    this.newestID = newestID;
    this.latestSequence = latestSequence;
    this.possessionTeam = possessionTeam;
    let changed = false;
    if (score && (score.home !== this.score?.home || score.away !== this.score?.away)) {
      this.score = score;
      changed = true;
    }

    // The raw entries, for the theater: an edited one replaces its earlier version.
    let itemsChanged = false;
    for (const item of entries) {
      const id = str(at(item, "id"));
      if (!id) continue;
      const was = this.itemsByID.get(id);
      if (was !== undefined && JSON.stringify(was) === JSON.stringify(item)) continue;
      this.itemsByID.set(id, item);
      itemsChanged = true;
    }
    if (itemsChanged) {
      this.items = [...this.itemsByID.values()].map((item, i) => ({ item, i, s: sequenceOf(item) })).sort((a, b) => a.s - b.s || a.i - b.i).map(({ item }) => item);
      changed = true;
    }

    // An edited play replaces its earlier version.
    const known = new Map(this.plays.map((p, i) => [p.id, i]));
    const merged = [...this.plays];
    const added: DrivePlay[] = [];
    const upgraded: DrivePlay[] = [];
    let edited = false;
    for (const play of fresh) {
      const index = known.get(play.id);
      if (index != null) {
        const was = playMoment(merged[index]!)?.tier;
        const now = playMoment(play)?.tier;
        if (was === Tier.score && now !== Tier.score) this.retracted.push(play.id);
        if (was !== Tier.score && now === Tier.score) upgraded.push(play);
        if (JSON.stringify(merged[index]) !== JSON.stringify(play)) {
          merged[index] = play;
          edited = true;
        }
      } else {
        const i = added.findIndex((p) => p.id === play.id);
        if (i >= 0) added[i] = play;
        else added.push(play);
      }
    }
    // The feed isn't always in play order; sequence numbers are (ties keep arrival order).
    if (added.length > 0 || edited) {
      this.plays = [...merged, ...added]
        .map((p, i) => ({ p, i }))
        .sort((a, b) => a.p.sequence - b.p.sequence || a.i - b.i)
        .map(({ p }) => p);
      changed = true;
    }
    // Only a complete first load counts as history; after it, new plays (and
    // plays edited into a score) are news. A play older than one already
    // shown arrived late: it isn't "now" any more.
    if (this.primed) {
      const news = [...added.filter((p) => p.sequence >= this.newestMomentSequence), ...upgraded].sort((a, b) => a.sequence - b.sequence);
      for (const play of news) {
        const m = footballMoment(play, scoreBefore(play, this.plays), teams.topIsHome);
        if (m) this.moments.push(m);
      }
      this.newestMomentSequence = Math.max(this.newestMomentSequence, ...added.map((p) => p.sequence));
    } else if (complete) {
      this.newestMomentSequence = this.plays.at(-1)?.sequence ?? -1;
    }
    if (complete) {
      this.primed = true;
      if (!this.loaded) {
        this.loaded = true;
        changed = true;
      }
    }
    return changed;
  }
}

// MARK: - Page rules

/**
 * Football, live: the team with the ball trails by one score (1–8) with two
 * minutes or less left in the 4th or overtime: the 2-MIN DRILL chip
 * (MatchRules.twoMinuteDrill).
 */
export function twoMinuteDrill(period: number, seconds: number, possession: Side | null, top: number, bottom: number): boolean {
  if (period < 4 || seconds <= 0 || seconds > 120 || !possession) return false;
  const deficit = possession === "top" ? bottom - top : top - bottom;
  return deficit >= 1 && deficit <= 8;
}

/** "IND drive · 6 plays · 62 yards" for the snaps on the field (FootballField.driveSummary). */
export function driveSummary(rows: readonly DrivePlay[], drive: readonly DrivePlay[], possession: Side | null, names: { top: string; bottom: string }): string | null {
  const side = possession ?? rows.at(-1)?.side ?? drive.at(-1)?.side ?? null;
  if (!side) return null;
  const team = side === "bottom" ? names.bottom : names.top;
  const first = rows[0];
  const last = rows.at(-1);
  if (!first || !last) return `${team} drive · starting`;
  const net = Math.round(side === "bottom" ? first.startX - last.endX : last.endX - first.startX);
  return `${team} drive · ${rows.length} play${rows.length === 1 ? "" : "s"} · ${net} yard${Math.abs(net) === 1 ? "" : "s"}`;
}

/** "+12", "−3"; nothing for no gain (FootballField.yards). */
export const yardsText = (yards: number): string | null => (yards === 0 ? null : yards > 0 ? `+${yards}` : `−${-yards}`);
