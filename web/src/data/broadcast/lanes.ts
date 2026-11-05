/**
 * The game as one broadcast, part 3: the lanes (BroadcastLanes.swift;
 * BROADCAST.md §1, "Ingest").
 *
 * Each sport's feeds, read into the timeline's terms: every play's ID, event
 * time, period and clock, kind (live-ball or dead-ball, whether it stops the
 * clock, whether it ends a period), score after it, and a digest of the
 * fields that make a revision; the play itself rides along as the feed's own
 * JSON, so the page's real parsers read the presented prefix unchanged. And
 * the fast lane (the scoreboard, the core status) read as evidence.
 *
 * The per-sport numbers live here too (`policy`). Measured ones say so; the
 * rest are starting values the recording bench tunes.
 *
 * Reads go through the Swift `JSON` wrapper's coercions (profiles/read.ts:
 * `.string` takes a number, `.int` a numeric string), as the Swift does: ESPN
 * sends type IDs as strings and the recorder's scores as strings.
 */
import { isFreeThrow, NBA_PATH, periodEnd, seconds as clockSeconds, TURNOVER_TYPES } from "../basketball";
import type { ScoreEvent } from "../models";
import type { PlayEvent, StatcastAtBat } from "../mlb/statcast";
import { arr, at, b, d, exists, i, s, type JSONValue } from "../profiles/read";
import {
  bindingHorizons,
  defaultPolicy,
  FAST_FINAL,
  FAST_INTERVAL,
  FAST_LIVE,
  NO_CLOCK,
  parseEventTime,
  periodLengthOf,
  playKind,
  type BroadcastPolicy,
  type FastReading,
  type FastState,
  type PlayKind,
  type PTime,
  type RawPlay,
  type ScoreLine,
  type TimelineEntry,
} from "./timeline";
import { stoppage, Stoppages, type Stoppage } from "./stoppage";

/** The sports the broadcast clock runs for (head-to-head ESPN games with a play-by-play). */
export type BroadcastSport = "basketball" | "football" | "soccer" | "baseball";

/** The sport this event broadcasts as, if any: ESPN head-to-head games with a play-by-play (Broadcast.sport). */
export function broadcastSport(event: ScoreEvent): BroadcastSport | null {
  if (event.ref?.kind !== "espn" || event.content.kind !== "match") return null;
  switch (event.ref.sport) {
    case "basketball":
    case "football":
    case "soccer":
    case "baseball":
      return event.ref.sport;
    default:
      return null;
  }
}

// MARK: Policy

/** Soccer's decisive kinds (BroadcastPolicy.decisive). */
export const SOCCER_DECISIVE: ReadonlySet<string> = new Set(["shot", "save", "corner", "free kick"]);

/**
 * The numbers for a sport. NBA's are measured (CHOREOGRAPHY §3.1, the
 * 2026-10-30 recordings); the others start from the fixtures' timing and
 * the NBA's lags until their recordings are measured (§9.5).
 */
export function policy(sport: BroadcastSport, path = ""): BroadcastPolicy {
  const p = defaultPolicy();
  switch (sport) {
    case "basketball":
      // Live-ball lag p50 31 s, p90 47 s (one 4th quarter); miss and rebound arrive together.
      p.priorLag = 47;
      // A shot clock: something live is logged at least every 24 game seconds, ~3× in wall time when it stops.
      p.quietRunning = 45;
      // Free throws trail their foul by 22–89 s; the net is for a play that never comes.
      p.safetyGrace = 60;
      p.periodLength = path === NBA_PATH ? 720 : 600;
      p.overtimeLength = 300;
      p.regulationPeriods = 4;
      p.priorFastLag = 24;
      // The morning-report choice (BROADCAST §2's NBA table): q 0.95, horizon 2.5 s, margin 1 s; jump past 40 s behind.
      p.quantile = 0.95;
      p.horizons = bindingHorizons(2.5);
      p.margin = 1;
      p.jumpMax = 40;
      break;
    case "football":
      // Snap to snap p50 42 s, p90 69–90 s inside a drive; the clock often runs between.
      p.priorLag = 50;
      p.horizons = bindingHorizons(2.5, { snap: 3, kick: 3 });
      p.quietRunning = 100;
      p.insertionAllowance = 6;
      p.safetyGrace = 60;
      p.periodLength = 900;
      p.overtimeLength = path.endsWith("college-football") ? 0 : 600;
      p.regulationPeriods = 4;
      p.priorFastLag = 25;
      // Rarely late, as the owner chose (BROADCAST §2's football table: two college games
      // 2026-10-31, our own outages taken out): q 0.95, horizon 2.5 s, margin 10 s,
      // D ≈ 74 s, live-ball plays past their moment 2.6% (the NBA's level). The NFL
      // takes college's until its own recordings (2026-11-01) are measured.
      p.quantile = 0.95;
      p.margin = 10;
      p.jumpMax = 40;
      break;
    case "soccer":
      // Entries every 2 s (p50); dead balls run to 105 s (goals, subs, injuries).
      p.priorLag = 45;
      p.quietRunning = 120;
      p.safetyGrace = 45;
      p.clockCountsDown = false;
      p.periodLength = 2700;
      p.overtimeLength = 900;
      p.regulationPeriods = 2;
      p.priorFastLag = 25;
      p.slowPoll = 8;
      p.quantile = 0.95;
      // What the director must bind: shots (goals among them), saves, and the
      // set pieces awarded. Passes and touches are flow it can fold a late one into.
      p.decisive = SOCCER_DECISIVE;
      // The morning-report choice (BROADCAST §2's soccer table): sized on every live-ball
      // kind at q 0.95, horizon 3 s, margin 13 s: D ≈ 102 s, +20 s over today's page
      // (the scoreboard, ~89 s behind real). The margin is the sport's knob.
      p.horizons = bindingHorizons(3);
      p.margin = 13;
      // Outages run minutes and the ball is out of play ~40% of a match: jump only past 180 s
      // behind, and make up the rest in dead time. A jump never passes these (nor a score, nor VAR).
      p.jumpMax = 180;
      p.toldLive = new Set(["shot", "save", "yellow card", "red card", "yellow red card"]);
      break;
    case "baseball":
      // Pitch to pitch p50 20 s, p90 31 s; mound visits ~73 s, pitching changes ~147 s.
      p.priorLag = 35;
      p.quietRunning = 150;
      p.safetyGrace = 45;
      p.clockCountsDown = null;
      p.periodLength = 0;
      p.overtimeLength = 0;
      p.regulationPeriods = 18;
      p.priorFastLag = 20;
      // Until its recordings are measured: the NBA's margin and jump.
      p.margin = 1;
      p.jumpMax = 40;
      break;
  }
  return p;
}

// MARK: Digests

/** cyrb53: a 53-bit string hash, stable across runs (Swift's Hasher is seeded per process; only equality matters). */
function hash53(text: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let k = 0; k < text.length; k++) {
    const ch = text.charCodeAt(k);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** A digest of some values (each null-aware), in order. */
export function digestOf(values: readonly unknown[]): number {
  return hash53(values.map((v) => (v == null ? "∅" : String(v))).join("\u0001"));
}

/**
 * The digest of a play's fields that a revision changes (text, type, scores,
 * time, place, people). `extra` carries a sport's own fields.
 */
export function digest(play: JSONValue, extra: readonly unknown[] = []): number {
  const parts: unknown[] = [
    s(at(play, "id")),
    s(at(play, "text")),
    s(at(play, "type", "id")),
    s(at(play, "type", "text")),
    s(at(play, "type", "type")),
    i(at(play, "homeScore")),
    i(at(play, "awayScore")),
    i(at(play, "scoreValue")),
    b(at(play, "scoringPlay")),
    s(at(play, "wallclock")),
    i(at(play, "period", "number")),
    s(at(play, "clock", "displayValue")),
    s(at(play, "team", "id")) ?? s(at(play, "team", "$ref")),
  ];
  for (const person of arr(at(play, "participants"))) {
    parts.push(s(at(person, "athlete", "id")) ?? s(at(person, "athlete", "$ref")));
    parts.push(s(at(person, "type")));
  }
  parts.push("|", ...extra);
  return digestOf(parts);
}

/** A football play's digest: the common fields, and where it starts and ends. */
export const footballDigest = (play: JSONValue): number =>
  digest(play, [d(at(play, "start", "yardLine")), d(at(play, "end", "yardLine")), i(at(play, "start", "down")), i(at(play, "statYardage")), b(at(play, "isPenalty")), b(at(play, "isTurnover"))]);

/** A basketball play's digest: the common fields, and where the shot was taken. */
export const basketballDigest = (play: JSONValue): number => digest(play, [d(at(play, "coordinate", "x")), d(at(play, "coordinate", "y")), b(at(play, "shootingPlay"))]);

// MARK: Entries

/**
 * A lane's plays as timeline entries, in game order. Football's feed isn't
 * always listed in play order: its sequence numbers are (ties keep the list's order).
 */
export function entries(items: readonly JSONValue[], sport: BroadcastSport, p: BroadcastPolicy): TimelineEntry<RawPlay>[] {
  switch (sport) {
    case "basketball":
      return items.flatMap((item) => basketball(item, p) ?? []);
    case "football": {
      const parsed = items.flatMap((item, offset) => {
        const f = football(item, p);
        return f ? [{ offset, ...f }] : [];
      });
      parsed.sort((a, z) => a.progressKey - z.progressKey || a.offset - z.offset);
      return parsed.map((x) => x.entry);
    }
    case "soccer":
      return items.flatMap((item) => soccer(item, p) ?? []);
    case "baseball":
      return items.flatMap((item, offset) => baseball(item, offset, p) ?? []);
  }
}

/**
 * The summary's play list, in game order, for sports whose summary has one
 * (soccer's doesn't: its plays come from the core lane).
 */
export function summaryPlays(summary: JSONValue, sport: BroadcastSport): JSONValue[] | null {
  switch (sport) {
    case "basketball":
    case "baseball": {
      const plays = arr(at(summary, "plays"));
      return plays.length === 0 && !exists(at(summary, "plays")) ? null : [...plays];
    }
    case "football": {
      const plays: JSONValue[] = [];
      for (const drive of arr(at(summary, "drives", "previous"))) plays.push(...arr(at(drive, "plays")));
      const current = at(summary, "drives", "current");
      if (exists(current)) {
        const known = new Set(plays.flatMap((p) => s(at(p, "id")) ?? []));
        plays.push(...arr(at(current, "plays")).filter((p) => !known.has(s(at(p, "id")) ?? "")));
      }
      // Summaries outside a drive list (a final with only scoring plays) say nothing complete.
      return plays.length === 0 ? null : plays;
    }
    case "soccer":
      return null;
  }
}

/** The scores a play carries, home and away. */
export function score(play: JSONValue): ScoreLine | null {
  const home = i(at(play, "homeScore"));
  const away = i(at(play, "awayScore"));
  return home == null || away == null ? null : { home, away };
}

const raw = (json: JSONValue, digest: number): RawPlay => ({ json, digest });

// MARK: Basketball

/** Clock-stopping turnovers: violations and dead balls. A turnover with a stealer (a second participant) is a live ball. */
export const STOPPING_TURNOVERS: ReadonlySet<number> = new Set([64, 65, 67, 68, 69, 70, 71, 72, 73, 78, 84, 86, 87, 90]);

/** NBADetail.seconds: "4:12" or "33.8" as seconds left (Swift's `Double(text)`: no blanks). */
function seconds(display: string): number | null {
  return display.trim() === "" ? null : clockSeconds(display);
}

/**
 * A basketball play (summary or normalized core plays). Live-ball: shots,
 * rebounds by a player, turnovers, the jump ball. Dead-ball: free throws,
 * fouls, timeouts, substitutions, reviews, violations, team rebounds, period ends.
 */
export function basketball(play: JSONValue, p: BroadcastPolicy): TimelineEntry<RawPlay> | null {
  const id = s(at(play, "id"));
  if (id == null) return null;
  const period = i(at(play, "period", "number")) ?? 0;
  const display = s(at(play, "clock", "displayValue")) ?? "";
  const remaining = d(at(play, "clock", "value")) ?? seconds(display);
  const length = periodLengthOf(p, period);
  const elapsed = remaining == null ? null : Math.max(length - remaining, 0);
  const type = i(at(play, "type", "id"));
  const people = arr(at(play, "participants")).length;
  let kind: PlayKind;
  const end = periodEnd(play);
  if (end) {
    kind = playKind("dead", end.final ? "game end" : "period end", { endsPeriod: end.period, endsGame: end.final });
  } else if (isFreeThrow(play)) {
    kind = playKind("dead", "free throw", { stopsClock: true });
  } else if (b(at(play, "shootingPlay")) === true) {
    // A made basket stops the clock in the last two minutes of the fourth and overtime.
    const late = period >= p.regulationPeriods && (remaining ?? Infinity) <= 120;
    kind = playKind("live", "shot", { stopsClock: b(at(play, "scoringPlay")) === true && late });
  } else if (type === 155 || type === 156) {
    kind = people > 0 ? playKind("live", "rebound") : playKind("dead", "team rebound", { stopsClock: true });
  } else if (type != null && TURNOVER_TYPES.has(type)) {
    kind = playKind("live", "turnover", { stopsClock: people < 2 && STOPPING_TURNOVERS.has(type) });
  } else if (type === 615) {
    kind = playKind("live", "jump ball");
  } else if (type === 16 || type === 17) {
    kind = playKind("dead", "timeout", { stopsClock: true, stoppage: stoppage(s(at(play, "type", "text"))) ?? Stoppages.timeout });
  } else if (type === 584) {
    kind = playKind("dead", "substitution", { stopsClock: true, attaches: true });
  } else if (type != null && type >= 213 && type <= 290) {
    kind = playKind("dead", "review", { stopsClock: true, stoppage: Stoppages.review });
  } else if (type != null && type >= 20 && type <= 60) {
    kind = playKind("dead", "foul", { stopsClock: true });
  } else {
    const stopped = stoppage(s(at(play, "type", "text")));
    kind = playKind("dead", stopped == null ? "other" : "timeout", { stopsClock: true, stoppage: stopped });
  }
  const dg = basketballDigest(play);
  return {
    id,
    wallclock: parseEventTime(s(at(play, "wallclock"))),
    period,
    progress: elapsed ?? 0,
    clock: { elapsed, resolution: display.includes(":") ? 1 : 0.1, display },
    kind,
    score: score(play),
    text: s(at(play, "text")) ?? "",
    reportedSource: "wallclock",
    digest: dg,
    payload: raw(play, dg),
  };
}

// MARK: Football

/** A stoppage as ESPN names a play's type, whatever the sport: the one table (stoppage.ts). */
export { stoppage } from "./stoppage";

const KICK_TYPES = new Set(["52", "53", "59", "60", "18", "12", "17"]);

/**
 * A football entry. Every snap (rush, pass, sack, kick, penalty) is live;
 * stoppages and admin are dead. The clock stops after an incompletion, a
 * score, a turnover, a kick, a penalty, a play out of bounds, a timeout,
 * and a period's end.
 */
export function football(play: JSONValue, p: BroadcastPolicy): { entry: TimelineEntry<RawPlay>; progressKey: number } | null {
  const id = s(at(play, "id"));
  if (id == null) return null;
  const period = i(at(play, "period", "number")) ?? 0;
  const typeText = s(at(play, "type", "text")) ?? "";
  const typeID = s(at(play, "type", "id")) ?? "";
  // College summaries give only "11:35" (no numeric value): the stoppage clusters
  // and the presented clock need it as seconds.
  const displayValue = s(at(play, "clock", "displayValue"));
  const remaining = d(at(play, "clock", "value")) ?? (displayValue != null ? seconds(displayValue) : null);
  const length = periodLengthOf(p, period);
  const elapsed = remaining == null ? null : length > 0 ? Math.max(length - remaining, 0) : remaining;
  const text = (s(at(play, "text")) ?? "").toLowerCase();
  const sequence = toDouble(s(at(play, "sequenceNumber")) ?? "") ?? d(at(play, "sequenceNumber")) ?? 0;
  let kind: PlayKind;
  const stopped = stoppage(typeText);
  if (stopped != null || typeText === "Coin Toss" || typeText.startsWith("End ")) {
    const ends = typeText.startsWith("End");
    const final = typeText === "End of Game";
    kind = playKind("dead", ends ? (final ? "game end" : "period end") : typeText.toLowerCase(), { stopsClock: true, endsPeriod: ends ? period : null, endsGame: final, stoppage: stopped });
  } else {
    const incomplete = typeID === "3";
    const kick = KICK_TYPES.has(typeID) || typeText.includes("Punt") || typeText.includes("Kickoff") || typeText.includes("Field Goal");
    const outOfBounds = text.includes(" ob ") || text.includes("out of bounds") || text.includes("pushed ob") || text.includes("ran ob");
    const penalty = b(at(play, "isPenalty")) === true;
    const stops = incomplete || kick || outOfBounds || b(at(play, "scoringPlay")) === true || b(at(play, "isTurnover")) === true || penalty || typeID === "8" || text.includes("spike");
    kind = playKind("live", penalty || typeID === "8" ? "penalty" : kick ? "kick" : "snap", { stopsClock: stops });
  }
  const dg = footballDigest(play);
  const entry: TimelineEntry<RawPlay> = {
    id,
    wallclock: parseEventTime(s(at(play, "wallclock"))),
    period,
    progress: elapsed ?? sequence,
    clock: { elapsed, resolution: 1, display: displayValue ?? null },
    kind,
    score: score(play),
    text: s(at(play, "shortText")) ?? s(at(play, "text")) ?? typeText,
    reportedSource: "wallclock",
    digest: dg,
    payload: raw(play, dg),
  };
  return { entry, progressKey: period * 1e7 + sequence };
}

/** Swift's `Double(text)`: a whole numeric string, else null. */
function toDouble(text: string): number | null {
  if (text.trim() === "" || text.trim() !== text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

// MARK: Soccer

/** Entries after which the ball is out of play until the restart. */
export const SOCCER_DEAD_BALL: ReadonlySet<string> = new Set(["out", "foul", "offside", "hand-ball", "penalty---won", "penalty-won", "injury", "drop-of-ball"]);

/**
 * A shot or a goal by its core type. ESPN posts a shot first as a "temp-attempt"
 * (~37 s after it, p50) and revises it in place to on target, off target or
 * blocked a minute or more later: the temporary one is the shot. "goal-kick" is a restart, not a goal.
 */
export function soccerShot(type: string): boolean {
  return type.startsWith("shot") || type === "temp-attempt" || type === "goal" || type.startsWith("goal---") || type === "own-goal" || type.startsWith("penalty---") || type === "hit-woodwork" || type === "attempt-saved";
}

/**
 * A soccer entry. Located entries and every shot, goal and save are live;
 * cards, substitutions, VAR and the half's admin are dead. The clock never
 * stops but at the half.
 */
export function soccer(play: JSONValue, p: BroadcastPolicy): TimelineEntry<RawPlay> | null {
  const id = s(at(play, "id")) ?? (i(at(play, "id")) != null ? String(i(at(play, "id"))) : null);
  if (id == null) return null;
  const period = i(at(play, "period", "number")) ?? 0;
  const type = s(at(play, "type", "type")) ?? "";
  const value = d(at(play, "clock", "value"));
  const located = (d(at(play, "fieldPositionX")) ?? 0) !== 0 || (d(at(play, "fieldPositionY")) ?? 0) !== 0;
  let kind: PlayKind;
  switch (type) {
    case "halftime":
      kind = playKind("dead", "period end", { endsPeriod: period });
      break;
    case "end-regular-time":
    case "end-extra-time":
    case "full-time":
    case "end-of-game":
      kind = playKind("dead", "game end", { endsPeriod: period, endsGame: type !== "end-regular-time" || p.regulationPeriods <= period });
      break;
    case "substitution":
    case "yellow-card":
    case "red-card":
    case "yellow-red-card":
      kind = playKind("dead", type.replaceAll("-", " "), { stopsPlay: true, attaches: true });
      break;
    case "start-2nd-half":
    case "kickoff":
    case "start-extra-time":
      kind = playKind("dead", type.replaceAll("-", " "));
      break;
    case "start-delay": {
      // ESPN logs a delay twice; only one says why.
      const why = s(at(play, "text")) ?? "";
      kind = playKind("dead", "delay", { delay: "opens", stopsPlay: true, stoppage: why === "" ? null : why.includes("VAR") ? Stoppages.varCheck : Stoppages.delay, attaches: why === "" });
      break;
    }
    case "end-delay":
      kind = playKind("dead", "delay", { delay: "closes" });
      break;
    default:
      if (type.startsWith("var") || type === "deleted-after-review") {
        // A VAR decision (a goal ruled out, a penalty given) and the goal it struck:
        // told as events even when they come minutes late, never as quiet corrections.
        kind = playKind("dead", "review", { announced: true, stopsPlay: true, stoppage: Stoppages.varCheck });
      } else if (soccerShot(type) || b(at(play, "scoringPlay")) === true) {
        // A goal leaves the ball dead until the kickoff; a shot doesn't (a save, a rebound, a corner follows).
        kind = playKind("live", "shot", { stopsPlay: b(at(play, "scoringPlay")) === true });
      } else if (type === "save" || type === "temp-save") {
        kind = playKind("live", "save");
      } else if (type === "corner-awarded") {
        kind = playKind("live", "corner", { stopsPlay: true });
      } else if (type === "free-kick") {
        kind = playKind("live", "free kick", { stopsPlay: true });
      } else if (located) {
        kind = playKind("live", "entry", { stopsPlay: SOCCER_DEAD_BALL.has(type) });
      } else {
        kind = playKind("dead", "other", { stopsPlay: SOCCER_DEAD_BALL.has(type) });
      }
  }
  const dg = digest(play, [d(at(play, "fieldPositionX")), d(at(play, "fieldPositionY")), d(at(play, "fieldPosition2X")), d(at(play, "fieldPosition2Y")), d(at(play, "addedClock"))]);
  return {
    id,
    wallclock: parseEventTime(s(at(play, "wallclock"))),
    period,
    progress: value ?? 0,
    clock: { elapsed: value ?? null, resolution: 1, display: s(at(play, "clock", "displayValue")) ?? null },
    kind,
    score: score(play),
    text: s(at(play, "shortText")) ?? s(at(play, "text")) ?? "",
    reportedSource: "wallclock",
    digest: dg,
    payload: raw(play, dg),
  };
}

// MARK: Baseball

/** Entries that are bookkeeping around a plate appearance, not something on the field. */
export const BASEBALL_ADMIN: ReadonlySet<string> = new Set([
  "start-inning",
  "start-batterpitcher",
  "end-batterpitcher",
  "end-inning",
  "pitching-change",
  "mound-visit",
  "defensive-substitution",
  "offensive-substitution",
  "pinch-hitter",
  "pinch-runner",
  "defensive-switch",
  "umpire-review",
  "manager-challenge",
]);

/**
 * A baseball entry. Pitches and results are live; admin is dead. No game
 * clock: progress is the half-inning, then the at-bat and pitch ordinal.
 */
export function baseball(play: JSONValue, ordinal: number, p: BroadcastPolicy): TimelineEntry<RawPlay> | null {
  void p;
  const id = s(at(play, "id"));
  if (id == null) return null;
  const number = i(at(play, "period", "number")) ?? 0;
  const half = s(at(play, "period", "type"))?.toLowerCase();
  // Half-innings as periods: Top 1 = 1, Bottom 1 = 2, …
  const period = Math.max(number * 2 - (half === "top" ? 1 : 0), 0);
  const type = s(at(play, "type", "type")) ?? "";
  const atBatID = s(at(play, "atBatId"));
  const atBat = atBatID != null ? (toInt(atBatID.slice(-4)) ?? 0) : 0;
  let kind: PlayKind;
  if (type === "end-inning") {
    kind = playKind("dead", "half-inning end", { endsPeriod: period });
  } else if (type === "end-game" || type === "game-end") {
    kind = playKind("dead", "game end", { endsPeriod: period, endsGame: true });
  } else if (BASEBALL_ADMIN.has(type) || type.includes("substitution") || type.includes("visit")) {
    const stopped: Stoppage | null =
      type === "pitching-change" ? Stoppages.pitchingChange : type === "mound-visit" ? Stoppages.moundVisit : type === "umpire-review" || type === "manager-challenge" ? Stoppages.review : null;
    kind = playKind("dead", type.replaceAll("-", " "), { stoppage: stopped, attaches: stopped == null && type !== "start-inning" });
  } else if (type === "play-result") {
    // ESPN logs a pitching change as a result: "Rodriguez relieved Vásquez".
    kind = playKind("live", "result", { stoppage: (s(at(play, "text")) ?? "").includes(" relieved ") ? Stoppages.pitchingChange : null });
  } else {
    kind = playKind("live", exists(at(play, "pitchCoordinate")) || s(at(play, "summaryType")) === "P" ? "pitch" : "event");
  }
  const dg = digest(play, [d(at(play, "pitchCoordinate", "x")), d(at(play, "hitCoordinate", "x")), i(at(play, "outs")), s(at(play, "summaryType"))]);
  return {
    id,
    wallclock: parseEventTime(s(at(play, "wallclock"))),
    period,
    progress: atBat * 1000 + (ordinal % 1000),
    clock: NO_CLOCK,
    kind,
    score: score(play),
    text: s(at(play, "text")) ?? s(at(play, "type", "text")) ?? "",
    reportedSource: "wallclock",
    digest: dg,
    payload: raw(play, dg),
  };
}

/** Swift's `Int(text)`: digits with an optional sign, nothing else. */
function toInt(text: string): number | null {
  return /^[+-]?\d+$/.test(text) ? Number(text) : null;
}

/** MLB's times for one plate appearance: each pitch's `startTime`, and when the at-bat ended. */
export interface PlateTimes {
  readonly pitches: readonly PTime[];
  readonly end: PTime | null;
}

/** MLB's live feed (raw statsapi JSON) as plate times, keyed by half-inning (our periods) and the plate appearance's place in it. */
export function plateTimesFromFeed(feed: JSONValue): Map<number, PlateTimes[]> {
  const out = new Map<number, PlateTimes[]>();
  for (const play of arr(at(feed, "liveData", "plays", "allPlays"))) {
    const inning = i(at(play, "about", "inning"));
    const top = b(at(play, "about", "isTopInning"));
    if (inning == null || top == null) continue;
    const pitches = arr(at(play, "playEvents"))
      .filter((e) => b(at(e, "isPitch")) === true)
      .flatMap((e) => parseEventTime(s(at(e, "startTime"))) ?? []);
    const key = inning * 2 - (top ? 1 : 0);
    const list = out.get(key) ?? [];
    list.push({ pitches, end: parseEventTime(s(at(play, "about", "endTime"))) });
    out.set(key, list);
  }
  return out;
}

/** Statcast's `isPitch` (statcast.ts `isPitchEvent`, kept here so the summary's parse doesn't load Statcast's module). */
const isPitch = (e: PlayEvent): boolean => e.kind.kind === "pitch" || e.kind.kind === "automatic";

/** The same from the at-bats the page's Statcast query already parsed (event times in epoch ms there). */
export function plateTimes(atBats: readonly StatcastAtBat[]): Map<number, PlateTimes[]> {
  const out = new Map<number, PlateTimes[]>();
  for (const ab of [...atBats].sort((x, y) => x.index - y.index)) {
    const events = ab.events ?? [];
    const pitches = events.filter(isPitch).flatMap((e) => (e.start != null ? [e.start / 1000] : []));
    const lastStart = events.at(-1)?.start;
    const end = ab.complete && lastStart != null ? lastStart / 1000 : null;
    const key = ab.inning * 2 - (ab.top ? 1 : 0);
    const list = out.get(key) ?? [];
    list.push({ pitches, end });
    out.set(key, list);
  }
  return out;
}

/**
 * ESPN's plays with MLB's times (CHOREOGRAPHY §3.4: statsapi's `startTime` is
 * the pitch's own moment to the millisecond; ESPN's wallclock trails it by
 * p50 1.1 s and by 8–20 s a quarter of the time). Plate appearances are
 * matched by half-inning and their place in it; an at-bat whose pitch
 * counts differ between the two keeps ESPN's times (never a wrong join).
 */
export function timed(list: readonly TimelineEntry<RawPlay>[], plates: ReadonlyMap<number, readonly PlateTimes[]>): TimelineEntry<RawPlay>[] {
  if (plates.size === 0) return [...list];
  // ESPN's at-bats in each half-inning, in order.
  const atBats = new Map<number, number[]>();
  for (const e of list) {
    if (e.kind.label !== "pitch" && e.kind.label !== "result") continue;
    const atBat = Math.trunc(e.progress / 1000);
    const known = atBats.get(e.period) ?? [];
    if (known.at(-1) !== atBat && !known.includes(atBat)) known.push(atBat);
    atBats.set(e.period, known);
  }
  const pitchCount = new Map<number, number>();
  for (const e of list) if (e.kind.label === "pitch") pitchCount.set(Math.trunc(e.progress / 1000), (pitchCount.get(Math.trunc(e.progress / 1000)) ?? 0) + 1);
  const seen = new Map<number, number>();
  return list.map((entry) => {
    const atBat = Math.trunc(entry.progress / 1000);
    if (entry.kind.label !== "pitch" && entry.kind.label !== "result") return entry;
    const ordinal = atBats.get(entry.period)?.indexOf(atBat) ?? -1;
    const half = plates.get(entry.period);
    const plate = ordinal >= 0 && half && ordinal < half.length ? half[ordinal]! : null;
    if (!plate || plate.pitches.length !== (pitchCount.get(atBat) ?? null)) return entry;
    if (entry.kind.label === "pitch") {
      const n = seen.get(atBat) ?? 0;
      seen.set(atBat, n + 1);
      return n < plate.pitches.length ? { ...entry, wallclock: plate.pitches[n]!, reportedSource: "statsapi" as const } : entry;
    }
    return plate.end != null ? { ...entry, wallclock: plate.end, reportedSource: "statsapi" as const } : entry;
  });
}

// MARK: The fast lane

/**
 * A scoreboard event as a fast-lane reading (`previous`: the lane's last
 * one, to tell a running clock from a stopped one). `now` is seconds since 1970.
 */
export function readingFromEvent(event: ScoreEvent, topIsHome: boolean, p: BroadcastPolicy, previous: FastReading | null, now: PTime, source = "scoreboard"): FastReading | null {
  if (event.content.kind !== "match") return null;
  let state: FastState;
  switch (event.state) {
    case "scheduled":
      return null;
    case "final":
      state = FAST_FINAL;
      break;
    case "live":
      state = liveState(event.detail);
      break;
  }
  let sc: ScoreLine | null = null;
  const t = toInt(event.content.top.score ?? "");
  const bt = toInt(event.content.bottom.score ?? "");
  if (t != null && bt != null) sc = topIsHome ? { home: t, away: bt } : { home: bt, away: t };
  const period = event.clock?.period ?? null;
  const elapsed = event.clock ? elapsedFromClock(event.clock.seconds, event.clock.period, p) : null;
  return { arrived: now, state, period, elapsed, running: running(elapsed, period, previous), score: sc, source };
}

/** The core status endpoint as a reading (clock only: it has no score). */
export function readingFromStatus(status: JSONValue, p: BroadcastPolicy, previous: FastReading | null, now: PTime): FastReading | null {
  const stateName = s(at(status, "type", "state"));
  const detail = s(at(status, "type", "shortDetail"));
  let state: FastState;
  if (stateName === "post") state = FAST_FINAL;
  else if (stateName === "in") state = liveState(detail);
  else return null;
  const period = i(at(status, "period"));
  const clock = d(at(status, "clock"));
  const elapsed = clock != null && period != null ? elapsedFromClock(clock, period, p) : null;
  return { arrived: now, state, period, elapsed, running: running(elapsed, period, previous), score: null, source: "status" };
}

/** A row of the recorder's `scores.jsonl` as a reading (the bench's fast lane). */
export function readingFromRow(row: JSONValue, p: BroadcastPolicy, previous: FastReading | null, now: PTime): FastReading | null {
  let state: FastState;
  const stateName = s(at(row, "state"));
  if (stateName === "post") state = FAST_FINAL;
  else if (stateName === "in") state = liveState(s(at(row, "clock")));
  else return null;
  let sc: ScoreLine | null = null;
  const home = i(at(row, "score", "home"));
  const away = i(at(row, "score", "away"));
  if (home != null && away != null) sc = { home, away };
  const period = i(at(row, "period"));
  const display = s(at(row, "clock")) ?? "";
  let elapsed: number | null = null;
  if (period != null) {
    const secs = seconds(display);
    if (p.clockCountsDown === true && secs != null) {
      elapsed = elapsedFromClock(secs, period, p);
    } else if (p.clockCountsDown === false) {
      const digits = /^\d+/.exec(display)?.[0];
      if (digits) elapsed = Number(digits) * 60;
    }
  }
  return { arrived: now, state, period, elapsed, running: running(elapsed, period, previous), score: sc, source: "scoreboard" };
}

/** A live game's status: under way, between periods, or held up in the source's own words. */
export function liveState(detail: string | null | undefined): FastState {
  if (isInterval(detail)) return FAST_INTERVAL;
  if (detail != null && isHeldUp(detail)) return { kind: "stopped", words: detail };
  return FAST_LIVE;
}

/** "Rain Delay", "Weather Delay", "Delayed", "Suspended": play has stopped, and ESPN says why. */
export function isHeldUp(detail: string): boolean {
  const t = detail.toLowerCase();
  return t.includes("delay") || t.includes("suspend");
}

/** "Halftime", "End of 3rd", "Mid 7th", "End 7th", "HT": between periods. */
export function isInterval(detail: string | null | undefined): boolean {
  if (detail == null) return false;
  const t = detail.toLowerCase();
  return t.includes("halftime") || t.startsWith("end of") || t.startsWith("mid ") || t.startsWith("end ") || t === "ht" || t.includes("half-time");
}

export function elapsedFromClock(secs: number, period: number, p: BroadcastPolicy): number {
  if (p.clockCountsDown === true) {
    const length = periodLengthOf(p, period);
    return length > 0 ? Math.max(length - secs, 0) : secs;
  }
  return secs;
}

function running(elapsed: number | null, period: number | null, previous: FastReading | null): boolean | null {
  if (elapsed == null || !previous || previous.elapsed == null || previous.period !== period) return null;
  return elapsed - previous.elapsed >= 0.5;
}
