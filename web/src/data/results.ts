/**
 * Results data (ResultProvider.swift): what a finished game adds to its row
 * (`ResultParse`, `ResultLine`), the rounds a league's results page steps
 * through (`Rounds`), a team's season (`TeamSeasons`) and a CS2 team's
 * history (`CSHistory`). Pure functions over responses and parsed items; the
 * ESPN parser runs inside the schedule parser (`providers/schedule.ts`), so
 * every string a row shows is made once, at parse time.
 */
import { addingDays, compareDays, daysBetween, dayKeyIn, dayRangeLabel, longDayLabel, mediumDayLabel, dayID, weekStart, type DayKey } from "./days";
import { ordinal, plural, spokenStatus, enDash } from "./format";
import { arr, at, bool, int, str, type JSONValue } from "./json";
import type { League, Sport } from "./models";
import { leagueWithID } from "./leagues";
import { TIER } from "./providers/counterStrike";
import {
  isField,
  itemTeams,
  resultDetail,
  sortDate,
  startDate,
  type CalendarWeek,
  type Decisions,
  type FormMark,
  type Performer,
  type ResultDetail,
  type ResultRound,
  type ResultRoundKind,
  type ScheduleCalendar,
  type ScheduleItem,
  type ScheduleStatus,
  type ScheduleTeam,
  type ScheduleTeamRef,
  type Scorer,
  type TeamSeason,
} from "./schedule";

export const EASTERN = "America/New_York";

// MARK: - Parsing (ResultParse)

/** One side of an ESPN competition, as a result needs it (boards and team schedules). */
export interface ResultSide {
  /** ESPN's own team ID ("367"), which `details[].team.id` refers to. */
  readonly id: string | null;
  /** "Spurs" */
  readonly name: string;
  /** "Tottenham Hotspur" */
  readonly fullName: string;
  /** "Milwaukee" */
  readonly location: string | null;
  readonly abbreviation: string;
  readonly score: number | null;
  readonly espnWinner: boolean;
  readonly shootout: number | null;
  readonly aggregate: number | null;
  /** W+D+L of the record after this game (soccer). */
  readonly gamesPlayed: number | null;
}

/** "7-0-1" → 8; null unless every part is a number. */
export function gamesPlayedIn(record: string): number | null {
  const parts = record.split(/[-–]/);
  if (parts.length === 0 || !parts.every((p) => /^\d+$/.test(p))) return null;
  return parts.reduce((sum, p) => sum + Number(p), 0);
}

/** The score as a number, from either response shape (`"2"` or `{ displayValue: "2" }`). */
function scoreText(comp: JSONValue): string | null {
  return str(at(comp, "score")) ?? str(at(comp, "score", "displayValue")) ?? null;
}

export function resultSide(comp: JSONValue): ResultSide {
  const t = at(comp, "team");
  const name = str(at(t, "shortDisplayName")) ?? str(at(t, "displayName")) ?? "TBD";
  const fullName = str(at(t, "displayName")) ?? name;
  const score = scoreText(comp);
  const records = arr(at(comp, "records"));
  const record =
    str(at(records.find((r) => str(at(r, "type")) === "total"), "summary")) ??
    str(at(arr(at(comp, "record")).find((r) => str(at(r, "type")) === "total"), "displayValue"));
  return {
    id: str(at(t, "id")) ?? null,
    name,
    fullName,
    // Boards don't carry `location`: "Milwaukee Brewers" less "Brewers".
    location: str(at(t, "location")) ?? (fullName.endsWith(` ${name}`) ? fullName.slice(0, -(name.length + 1)) : null),
    abbreviation: str(at(t, "abbreviation")) ?? name.slice(0, 3).toUpperCase(),
    score: score != null && /^-?\d+$/.test(score) ? Number(score) : null,
    espnWinner: bool(at(comp, "winner")) ?? false,
    shootout: int(at(comp, "shootoutScore")) ?? null,
    aggregate: int(at(comp, "aggregateScore")) ?? null,
    gamesPlayed: record ? gamesPlayedIn(record) : null,
  };
}

/** Forfeits and walkovers: awarded results, whose score (if any) is a formality. */
export function isAwarded(statusName: string): boolean {
  return statusName.includes("FORFEIT") || statusName.includes("WALKOVER");
}

/**
 * What a finished, postponed or canceled ESPN game adds to its row: label,
 * scorers, decisions, performers, context, and every string a row shows.
 * `top`/`bottom` are the competitors in house order; `notes` the item's
 * rewritten notes (with a postseason series). Null for games not yet played.
 */
export function parseESPNResult(
  e: JSONValue,
  c: JSONValue,
  sport: Sport,
  topJSON: JSONValue,
  bottomJSON: JSONValue,
  status: ScheduleStatus,
  notes: readonly string[] = [],
): ResultDetail | null {
  if (status !== "final" && status !== "postponed" && status !== "canceled") return null;
  const type = at(c, "status", "type") !== undefined ? at(c, "status", "type") : at(e, "status", "type");
  const name = str(at(type, "name")) ?? "";
  const short = str(at(type, "shortDetail")) ?? str(at(type, "detail"));
  const top = resultSide(topJSON);
  const bottom = resultSide(bottomJSON);
  const headlines = arr(at(c, "notes")).flatMap((n) => str(at(n, "headline")) || []);

  if (status !== "final") {
    const r = resultDetail({ label: status === "canceled" ? "Canceled" : "Postponed", context: notes.length ? notes.join(" · ") : null });
    return { ...r, spoken: spokenResultLine(r, sport, top, bottom, status, notes) };
  }

  let kind: ResultDetail["kind"] = "regulation";
  let label: string;
  if (name === "STATUS_FINAL_PEN") [kind, label] = ["penalties", "Pens"];
  else if (name === "STATUS_FINAL_AET") [kind, label] = ["extraTime", "AET"];
  else if (name === "STATUS_SUSPENDED") [kind, label] = ["suspended", "Suspended"];
  else if (name === "STATUS_ABANDONED") [kind, label] = ["abandoned", "Abandoned"];
  else if (isAwarded(name)) [kind, label] = ["forfeit", "Forfeit"];
  else {
    const l = short ?? (sport === "soccer" ? "FT" : "Final");
    if (l === "FT-Pens" || l === "Pens") [kind, label] = ["penalties", "Pens"];
    else if (l === "AET") [kind, label] = ["extraTime", "AET"];
    else {
      label = l;
      if (l.startsWith("Final/") || l.startsWith("F/")) kind = "overtime";
    }
  }
  const periods = int(at(c, "status", "period")) ?? int(at(e, "status", "period")) ?? null;

  // Shootout: the scoreboard says it; team schedules only say it in a note
  // ("Arsenal win 5-4 on penalties"), whose first number is the winner's.
  let shootout: ResultDetail["shootout"] = null;
  let advances: string | null = null;
  if (kind === "penalties") {
    if (top.shootout != null && bottom.shootout != null) {
      shootout = { top: top.shootout, bottom: bottom.shootout };
    } else {
      const note = penaltyNote(headlines);
      if (note) {
        const topWon = top.espnWinner || (!bottom.espnWinner && namesSide(headlines, top));
        shootout = topWon ? { top: note[0], bottom: note[1] } : { top: note[1], bottom: note[0] };
      }
    }
    if (shootout && shootout.top !== shootout.bottom) advances = shootout.top > shootout.bottom ? top.fullName : bottom.fullName;
  }

  // Two legs: aggregate, leg, and who went through (ESPN's `winner` follows the tie, not this match).
  const series = at(c, "series");
  const aggTop = top.aggregate ?? seriesAggregate(series, top.id);
  const aggBottom = bottom.aggregate ?? seriesAggregate(series, bottom.id);
  const aggregate = aggTop != null && aggBottom != null ? { top: aggTop, bottom: aggBottom } : null;
  const leg = int(at(c, "leg", "value")) ?? null;
  if (aggregate && (leg === 2 || bool(at(series, "completed")) === true)) {
    const tieWinner = str(at(arr(at(series, "competitors")).find((s) => bool(at(s, "winner")) === true), "id"));
    if (tieWinner) {
      advances = tieWinner === top.id ? top.fullName : tieWinner === bottom.id ? bottom.fullName : advances;
    } else if (aggregate.top !== aggregate.bottom) {
      advances = aggregate.top > aggregate.bottom ? top.fullName : bottom.fullName;
    }
  }

  let stage: string | null = null;
  let gamesPlayed: number | null = null;
  let scorers: Scorer[] = [];
  if (sport === "soccer") {
    const slug = str(at(e, "season", "slug"));
    // A season's own slug ("2026-27-english-premier-league") isn't a stage.
    stage = slug && !/^\d{4}/.test(slug) ? slug : null;
    const played = [top.gamesPlayed, bottom.gamesPlayed].filter((n): n is number => n != null);
    gamesPlayed = played.length ? Math.max(...played) : null;
    scorers = parseScorers(c, top, bottom);
  }
  let performers: Performer[] = [];
  let decisions: Decisions | null = null;
  if (kind !== "forfeit") {
    if (sport === "football") performers = footballLeaders(c, top);
    else if (sport === "basketball") performers = [...basketballLeaders(topJSON, true), ...basketballLeaders(bottomJSON, false)];
    else if (sport === "baseball") decisions = parseDecisions(at(c, "status", "featuredAthletes") !== undefined ? at(c, "status") : at(e, "status"));
  }
  const postseason = str(at(e, "season", "slug")) === "post-season" || int(at(e, "seasonType", "type")) === 3;
  const summary = str(at(series, "summary"));
  const r = resultDetail({
    kind,
    label,
    periods,
    shootout,
    aggregate,
    leg,
    advances,
    stage,
    gamesPlayed,
    scorers,
    performers,
    decisions,
    series: postseason && summary ? shortSeriesSummary(summary) : null,
    headline: str(at(c, "headlines", 0, "shortLinkText")) ?? str(at(c, "headlines", 0, "description")) ?? null,
    attendance: (() => {
      const a = int(at(c, "attendance"));
      return a != null && a > 0 ? a : null;
    })(),
  });
  const verb = headlines.some((h) => h.toLowerCase().includes(" advance")) ? "advance" : "win";
  return fillResultLines(r, sport, top, bottom, postseason ? notes : [], verb);
}

/** "MIL leads series 2-0" → "MIL leads 2–0" (Brackets.swift `MLBPostseason.shortSummary`). */
export function shortSeriesSummary(summary: string): string {
  return summary.replaceAll(" series", "").replaceAll("-", "–");
}

/**
 * The score rule: the side that won the match is the winner, whatever ESPN's
 * `winner` says about the tie; level scores keep ESPN's (a shootout). A
 * forfeit hides its score; an abandoned or suspended game has no winner.
 */
export function settle(top: ScheduleTeam, bottom: ScheduleTeam, result: ResultDetail | null): [ScheduleTeam, ScheduleTeam] {
  if (!result) return [top, bottom];
  switch (result.kind) {
    case "forfeit":
      return [{ ...top, score: null }, { ...bottom, score: null }];
    case "abandoned":
    case "suspended":
      return [{ ...top, winner: false }, { ...bottom, winner: false }];
    default: {
      const a = top.score != null && /^\d+$/.test(top.score) ? Number(top.score) : null;
      const b = bottom.score != null && /^\d+$/.test(bottom.score) ? Number(bottom.score) : null;
      if (a != null && b != null && a !== b) return [{ ...top, winner: a > b }, { ...bottom, winner: b > a }];
      return [top, bottom];
    }
  }
}

/** A CS2 match from bo3.gg, finished or forfeited (`defwin`, whose 1–0 is fake). */
export function counterStrikeResult(item: ScheduleItem): ScheduleItem {
  if (item.status !== "final" || !item.top || !item.bottom) return item;
  let top = item.top;
  let bottom = item.bottom;
  let r = resultDetail({ label: "Final" });
  if (item.statusDetail === "Forfeit") {
    top = { ...top, score: null };
    bottom = { ...bottom, score: null };
    const winner = top.winner ? top : bottom.winner ? bottom : null;
    r = {
      ...r,
      kind: "forfeit",
      label: "Forfeit",
      context: winner ? `Awarded to ${winner.name}` : null,
      spoken: `${top.name} versus ${bottom.name}, forfeit${winner ? `, awarded to ${winner.name}.` : "."}`,
    };
  } else if (top.score != null && bottom.score != null) {
    const winner = top.winner ? top.name : bottom.winner ? bottom.name : null;
    r = { ...r, spoken: `${top.name} ${top.score}, ${bottom.name} ${bottom.score}, final${winner ? `, ${winner} won.` : "."}` };
  }
  return { ...item, top, bottom, result: r };
}

/** "Egypt advance 4-2 on penalties" → [4, 2]. */
export function penaltyNote(headlines: readonly string[]): [number, number] | null {
  for (const h of headlines) {
    const m = /(\d+)-(\d+) on penalties/.exec(h);
    if (m) return [Number(m[1]), Number(m[2])];
  }
  return null;
}

/** Whether a note names this side ("Arsenal win …"). */
function namesSide(headlines: readonly string[], side: ResultSide): boolean {
  return headlines.some((h) => [side.fullName, side.name, side.location].some((n) => n != null && h.startsWith(n)));
}

function seriesAggregate(series: JSONValue, id: string | null): number | null {
  if (!id) return null;
  return int(at(arr(at(series, "competitors")).find((s) => str(at(s, "id")) === id), "aggregateScore")) ?? null;
}

/** Goals (not shootout kicks; own goals under the side they counted for) and red cards, in match order. */
export function parseScorers(c: JSONValue, top: ResultSide, _bottom: ResultSide): Scorer[] {
  return arr(at(c, "details")).flatMap((d): Scorer[] => {
    const red = bool(at(d, "redCard")) === true;
    const goal = bool(at(d, "scoringPlay")) === true && bool(at(d, "shootout")) !== true;
    if (!red && !goal) return [];
    const athlete = at(d, "athletesInvolved", 0);
    const team = str(at(d, "team", "id")) ?? str(at(athlete, "team", "id"));
    const short = str(at(athlete, "shortName")) ?? str(at(athlete, "displayName"));
    if (!short) return [];
    const mark: Scorer["mark"] = red ? "red" : bool(at(d, "ownGoal")) === true ? "ownGoal" : bool(at(d, "penaltyKick")) === true ? "penalty" : "goal";
    return [{ top: team != null && team === top.id, name: short, minute: str(at(d, "clock", "displayValue")) ?? "", mark, athleteID: str(at(athlete, "id")) ?? null }];
  });
}

/** The game's passing, rushing and receiving leaders (finals only: before kickoff the same key holds season leaders). */
export function footballLeaders(c: JSONValue, top: ResultSide): Performer[] {
  return arr(at(c, "leaders")).flatMap((category): Performer[] => {
    const key = str(at(category, "name"));
    if (!key || !["passingYards", "rushingYards", "receivingYards"].includes(key)) return [];
    const leader = at(category, "leaders", 0);
    const short = str(at(leader, "athlete", "shortName")) ?? str(at(leader, "athlete", "displayName"));
    const value = str(at(leader, "displayValue"));
    if (!short || !value) return [];
    const team = str(at(leader, "team", "id")) ?? str(at(leader, "athlete", "team", "id"));
    return [{ top: team != null && team === top.id, name: short, line: value, category: key, athleteID: str(at(leader, "athlete", "id")) ?? null }];
  });
}

/** A side's points and overall (rating) leaders. */
export function basketballLeaders(comp: JSONValue, top: boolean): Performer[] {
  return arr(at(comp, "leaders")).flatMap((category): Performer[] => {
    const key = str(at(category, "name"));
    if (key !== "points" && key !== "rating") return [];
    const leader = at(category, "leaders", 0);
    const short = str(at(leader, "athlete", "shortName")) ?? str(at(leader, "athlete", "displayName"));
    const value = str(at(leader, "displayValue"));
    if (!short || !value) return [];
    return [{ top, name: short, line: key === "points" ? `${value} PTS` : value, category: key, athleteID: str(at(leader, "athlete", "id")) ?? null }];
  });
}

/** MLB: winning, losing and saving pitchers (`competitions[0].status.featuredAthletes`). */
export function parseDecisions(status: JSONValue): Decisions | null {
  let win: Decisions["win"] = null;
  let loss: Decisions["loss"] = null;
  let save: Decisions["save"] = null;
  for (const a of arr(at(status, "featuredAthletes"))) {
    const short = str(at(a, "athlete", "shortName")) ?? str(at(a, "athlete", "displayName"));
    if (!short) continue;
    const stat = (abbreviation: string) => str(at(arr(at(a, "statistics")).find((s) => str(at(s, "abbreviation")) === abbreviation), "displayValue"));
    const id = str(at(a, "athlete", "id")) ?? null;
    switch (str(at(a, "name"))) {
      case "winningPitcher":
        win = { name: short, record: `${stat("W") ?? "0"}–${stat("L") ?? "0"}`, athleteID: id };
        break;
      case "losingPitcher":
        loss = { name: short, record: `${stat("W") ?? "0"}–${stat("L") ?? "0"}`, athleteID: id };
        break;
      case "savingPitcher":
        save = { name: short, record: stat("SV") ?? "", athleteID: id };
        break;
    }
  }
  return win || loss || save ? { win, loss, save } : null;
}

// MARK: - Display strings (ResultLine)

/** Marks a red card in `details` ("▮ Palmer 80'"); rows draw it red. */
export const RED_CARD = "▮";

const SHORTHAND: Readonly<Record<string, string>> = { YDS: "yds", CAR: "car", REC: "rec", PTS: "pts", REB: "reb", AST: "ast" };

/** ESPN's stat shorthand in the app's voice. */
export function rewriteStats(text: string): string {
  return text
    .split(" ")
    .map((word) => {
      const comma = word.endsWith(",");
      const lower = SHORTHAND[comma ? word.slice(0, -1) : word];
      return lower == null ? word : comma ? `${lower},` : lower;
    })
    .join(" ");
}

/** "N. Jackson" → "Jackson"; "J.J. McCarthy" → "McCarthy"; "M. van de Ven" → "van de Ven". */
export function surname(short: string): string {
  const tokens = short.split(" ").filter(Boolean);
  const first = tokens[0];
  if (tokens.length <= 1 || !first || !first.endsWith(".") || first.length > 4 || !/^[\p{L}.]+$/u.test(first)) return short;
  return tokens.slice(1).join(" ");
}

/** Surnames, except where two people in one game share one: they keep their initials ("N. Jackson · B. Jackson"). */
export class CallNames {
  private people = new Map<string, Set<string>>();
  constructor(entries: readonly { short: string; id: string | null }[]) {
    for (const e of entries) {
      const s = surname(e.short);
      let set = this.people.get(s);
      if (!set) this.people.set(s, (set = new Set()));
      set.add(e.id ?? e.short);
    }
  }
  callName(short: string): string {
    const s = surname(short);
    return (this.people.get(s)?.size ?? 0) > 1 ? short : s;
  }
}

/** Fills `details`, `detailsWide`, `context` and `spoken` of a final. */
export function fillResultLines(r: ResultDetail, sport: Sport, top: ResultSide, bottom: ResultSide, notes: readonly string[], shootoutVerb: string): ResultDetail {
  const pitchers = [r.decisions?.win, r.decisions?.loss, r.decisions?.save].filter((p): p is NonNullable<typeof p> => p != null);
  const names = new CallNames([...r.scorers.map((s) => ({ short: s.name, id: s.athleteID })), ...r.performers.map((p) => ({ short: p.name, id: p.athleteID })), ...pitchers.map((p) => ({ short: p.name, id: p.athleteID }))]);
  const topWon = resultWinner(r, top, bottom);

  let details: string | null = null;
  let detailsWide: string | null = null;
  switch (sport) {
    case "soccer":
      details = soccerDetails(r.scorers, names);
      detailsWide = details;
      break;
    case "baseball":
      details = r.decisions ? decisionsLine(r.decisions, names) : null;
      detailsWide = details;
      break;
    case "basketball": {
      const order = topWon === false ? [false, true] : [true, false];
      const line = (category: string) => {
        const parts = order.flatMap((side) => r.performers.find((p) => p.top === side && p.category === category) ?? []).map((p) => `${names.callName(p.name)} ${rewriteStats(p.line)}`);
        return parts.length ? parts.join(" · ") : null;
      };
      details = line("points");
      detailsWide = line("rating") ?? details;
      break;
    }
    case "football":
      details = footballLine(r.performers, names, false);
      detailsWide = footballLine(r.performers, names, true);
      break;
  }

  // Context: what the match itself doesn't say (legs, aggregate, shootout, the postseason series, a forfeit).
  const context: string[] = [];
  if (r.kind === "forfeit") {
    if (topWon != null) context.push(`Awarded to ${topWon ? top.name : bottom.name}`);
  } else if (r.kind === "abandoned") {
    context.push("Abandoned · score at the time");
  } else if (notes.length > 0) {
    context.push(notes.join(" · "));
  } else if (sport === "soccer") {
    const knockout: string[] = [];
    if (r.leg != null) knockout.push(`${ordinal(r.leg)} leg`);
    if (r.shootout && r.shootout.top !== r.shootout.bottom) {
      const [w, l, side] = r.shootout.top > r.shootout.bottom ? [r.shootout.top, r.shootout.bottom, top] : [r.shootout.bottom, r.shootout.top, bottom];
      knockout.push(`${side.name} ${shootoutVerb} ${w}–${l} on pens.`);
    } else if (r.aggregate && (r.leg === 2 || r.advances != null) && r.advances != null) {
      const side = r.advances === top.fullName ? top : bottom;
      const [a, b] = side.fullName === top.fullName ? [r.aggregate.top, r.aggregate.bottom] : [r.aggregate.bottom, r.aggregate.top];
      knockout.push(`${side.name} advance ${a}–${b} on agg.`);
    }
    if (knockout.length > 0) {
      const stage = r.stage ? stageTitle(r.stage) : null;
      if (stage && isKnockoutSlug(r.stage)) context.push(stage);
      context.push(...knockout);
    }
  }
  const filled: ResultDetail = { ...r, details, detailsWide, context: context.length ? context.join(" · ") : null };
  return { ...filled, spoken: spokenResultLine(filled, sport, top, bottom, "final", notes, names, topWon) };
}

/** The side that won the match (score rule), or the shootout or ESPN's pick when level; null for none. */
export function resultWinner(r: ResultDetail, top: ResultSide, bottom: ResultSide): boolean | null {
  if (r.kind === "abandoned" || r.kind === "suspended") return null;
  if (r.kind !== "forfeit" && top.score != null && bottom.score != null && top.score !== bottom.score) return top.score > bottom.score;
  if (top.espnWinner !== bottom.espnWinner) return top.espnWinner;
  return null;
}

/** "Jackson 6', 60' · Haaland 52'": goals by player, home side first, "(P)" and "(OG)" after a minute, red cards last. */
export function soccerDetails(scorers: readonly Scorer[], names: CallNames): string | null {
  const parts: string[] = [];
  for (const side of [true, false]) {
    const order: string[] = [];
    const minutes = new Map<string, string[]>();
    const shown = new Map<string, string>();
    for (const s of scorers) {
      if (s.top !== side || s.mark === "red") continue;
      const key = s.athleteID ?? s.name;
      if (!minutes.has(key)) order.push(key);
      shown.set(key, names.callName(s.name));
      minutes.set(key, [...(minutes.get(key) ?? []), s.minute + (s.mark === "penalty" ? " (P)" : s.mark === "ownGoal" ? " (OG)" : "")]);
    }
    parts.push(...order.map((k) => `${shown.get(k) ?? k} ${(minutes.get(k) ?? []).join(", ")}`));
  }
  parts.push(...scorers.filter((s) => s.mark === "red").map((s) => `${RED_CARD} ${names.callName(s.name)} ${s.minute}`));
  return parts.length ? parts.join(" · ") : null;
}

/** "W Uribe (1–0) · L Wells (0–2) · S Ashby (3)" */
export function decisionsLine(d: Decisions, names: CallNames): string | null {
  const parts = (
    [
      ["W", d.win],
      ["L", d.loss],
      ["S", d.save],
    ] as const
  ).flatMap(([letter, p]) => (p ? [`${letter} ${names.callName(p.name)}${p.record ? ` (${p.record})` : ""}`] : []));
  return parts.length ? parts.join(" · ") : null;
}

/** The parts of "20/28, 257 YDS, 1 TD, 1 INT". */
function statLine(text: string): { yards: string | null; touchdowns: string | null; count: string | null; td: string } {
  let yards: string | null = null;
  let touchdowns: string | null = null;
  let count: string | null = null;
  for (const part of text.split(", ")) {
    const p = part.trim();
    if (p.endsWith(" YDS")) yards = p.slice(0, -4);
    else if (p.endsWith(" TD")) touchdowns = p.slice(0, -3);
    else if (p.endsWith(" REC")) count = p.slice(0, -4);
  }
  return { yards, touchdowns, count, td: touchdowns ? `, ${touchdowns} TD` : "" };
}

/** Compact: the passer (yards, TDs) and the bigger of the rushing and receiving leaders. Wide: all three. */
export function footballLine(performers: readonly Performer[], names: CallNames, wide: boolean): string | null {
  const find = (key: string) => performers.find((p) => p.category === key);
  const text = (p: Performer) => {
    const s = statLine(p.line);
    switch (p.category) {
      case "passingYards":
        return wide ? rewriteStats(p.line) : `${s.yards ?? "0"} yds${s.td}`;
      case "rushingYards":
        return `${s.yards ?? "0"} rush yds${s.td}`;
      default:
        return wide ? `${s.count ? `${s.count} rec, ` : ""}${s.yards ?? "0"} yds${s.td}` : `${s.yards ?? "0"} rec yds${s.td}`;
    }
  };
  const shown: Performer[] = [];
  const pass = find("passingYards");
  if (pass) shown.push(pass);
  const rush = find("rushingYards");
  const rec = find("receivingYards");
  if (wide) {
    shown.push(...[rush, rec].filter((p): p is Performer => p != null));
  } else {
    const yards = (p: Performer | undefined) => (p ? Number.parseInt(statLine(p.line).yards ?? "", 10) : -1);
    const y = (p: Performer | undefined) => (Number.isNaN(yards(p)) ? -1 : yards(p));
    const bigger = y(rush) >= y(rec) ? rush : rec;
    if (bigger) shown.push(bigger);
  }
  if (shown.length === 0) return null;
  return shown.map((p) => `${names.callName(p.name)} ${text(p)}`).join(" · ");
}

// MARK: Spoken

/** The row's spoken sentence for a result: score, status, outcome, then the context and details in words. */
export function spokenResultLine(
  r: ResultDetail,
  sport: Sport,
  top: ResultSide,
  bottom: ResultSide,
  status: ScheduleStatus,
  notes: readonly string[],
  givenNames: CallNames | null = null,
  topWon: boolean | null = null,
): string {
  const versus = `${top.name} versus ${bottom.name}`;
  const sentences: string[] = [];
  if (status === "postponed" || status === "canceled") {
    sentences.push(`${versus}, ${status === "canceled" ? "canceled" : "postponed"}.`);
    if (notes.length) sentences.push(`${say(notes.join(" · "))}.`);
    return sentences.join(" ");
  }
  const words = spokenStatus(r.label);
  const statusWords = words.slice(0, 1).toLowerCase() + words.slice(1);
  const scores = top.score != null && bottom.score != null ? `${top.name} ${top.score}, ${bottom.name} ${bottom.score}` : versus;
  switch (r.kind) {
    case "forfeit":
      sentences.push(`${versus}, forfeit${topWon != null ? `, awarded to ${topWon ? top.name : bottom.name}` : ""}.`);
      break;
    case "abandoned":
      sentences.push(`${scores}, abandoned, score at the time.`);
      break;
    case "suspended":
      sentences.push(`${scores}, suspended.`);
      break;
    default: {
      let outcome = topWon != null ? `${topWon ? top.name : bottom.name} won` : sport === "soccer" ? "draw" : "tie";
      let shootoutSaid = false;
      if (r.shootout && r.shootout.top !== r.shootout.bottom) {
        const [w, l, side] = r.shootout.top > r.shootout.bottom ? [r.shootout.top, r.shootout.bottom, top] : [r.shootout.bottom, r.shootout.top, bottom];
        if (top.score === bottom.score) outcome = `${side.fullName} won ${w} to ${l} on penalties`;
        else {
          sentences.push(`${scores}, ${statusWords}, ${outcome}.`);
          sentences.push(`${side.fullName} won ${w} to ${l} on penalties.`);
          shootoutSaid = true;
        }
      }
      if (!shootoutSaid) sentences.push(`${scores}, ${statusWords}, ${outcome}.`);
    }
  }

  // Context
  if (notes.length) {
    sentences.push(`${sayNotes(notes.join(" · "), top, bottom)}.`);
  } else if (sport === "soccer") {
    const stage = isKnockoutSlug(r.stage) && r.stage ? stageTitle(r.stage) : null;
    const legWord = (leg: number) => `${["first", "second"][Math.min(Math.max(leg, 1), 2) - 1]} leg`;
    if (r.aggregate && r.advances && (r.shootout == null || r.shootout.top === r.shootout.bottom)) {
      const topAdvances = r.advances === top.fullName;
      const [a, b] = topAdvances ? [r.aggregate.top, r.aggregate.bottom] : [r.aggregate.bottom, r.aggregate.top];
      const lead = [stage, r.leg != null ? legWord(r.leg) : null].filter(Boolean).join(", ");
      const sentence = `${r.advances} advance ${a} to ${b} on aggregate.`;
      sentences.push(lead ? `${lead.slice(0, 1).toUpperCase()}${lead.slice(1)}: ${sentence}` : sentence);
    } else if ((r.leg != null || r.shootout != null) && stage) {
      sentences.push(`${stage}${r.leg != null ? `, ${legWord(r.leg)}` : ""}.`);
    }
  }

  // Details
  const names = givenNames ?? new CallNames([]);
  switch (sport) {
    case "soccer": {
      const goals = spokenGoals(
        r.scorers.filter((s) => s.mark !== "red"),
        names,
      );
      if (goals) sentences.push(`Goals: ${goals}.`);
      const reds = r.scorers.filter((s) => s.mark === "red");
      if (reds.length) sentences.push(`${reds.length === 1 ? "Red card: " : "Red cards: "}${reds.map((s) => `${names.callName(s.name)}, ${spokenMinutes([s.minute])}`).join("; ")}.`);
      break;
    }
    case "baseball":
      if (r.decisions) {
        const d = r.decisions;
        const said = (
          [
            ["Winning pitcher", d.win],
            ["losing pitcher", d.loss],
            ["save", d.save],
          ] as const
        )
          .flatMap(([label, p]) => (p ? [`${label} ${names.callName(p.name)}`] : []))
          .join(", ");
        if (said) sentences.push(`${said.slice(0, 1).toUpperCase()}${said.slice(1)}.`);
      }
      break;
    case "basketball": {
      const order = topWon === false ? [false, true] : [true, false];
      const parts = order.flatMap((side) => r.performers.find((p) => p.top === side && p.category === "points") ?? []).map((p) => `${names.callName(p.name)} ${say(rewriteStats(p.line))}`);
      if (parts.length) sentences.push(`${parts.join("; ")}.`);
      break;
    }
    case "football":
      if (footballLine(r.performers, names, false) != null) {
        const kinds: Record<string, string> = { passingYards: "passing", rushingYards: "rushing", receivingYards: "receiving" };
        const parts = ["passingYards", "rushingYards", "receivingYards"].flatMap((key) => r.performers.find((p) => p.category === key) ?? []).map((p) => {
          const s = statLine(p.line);
          const tds = s.touchdowns ? `, ${s.touchdowns} ${s.touchdowns === "1" ? "touchdown" : "touchdowns"}` : "";
          return `${names.callName(p.name)} ${s.yards ?? "0"} ${kinds[p.category] ?? ""} yards${tds}`;
        });
        sentences.push(`${parts.join("; ")}.`);
      }
      break;
  }
  return sentences.join(" ");
}

/** "Jackson, 6th and 60th minute; Haaland, 52nd minute" */
export function spokenGoals(goals: readonly Scorer[], names: CallNames): string {
  const order: string[] = [];
  const byKey = new Map<string, Scorer[]>();
  for (const g of [...goals.filter((g) => g.top), ...goals.filter((g) => !g.top)]) {
    const key = (g.top ? "t" : "b") + (g.athleteID ?? g.name);
    if (!byKey.has(key)) order.push(key);
    byKey.set(key, [...(byKey.get(key) ?? []), g]);
  }
  return order
    .flatMap((k) => byKey.get(k) ?? [])
    .reduce<Scorer[][]>((groups, g) => {
      const last = groups[groups.length - 1];
      const key = (g.top ? "t" : "b") + (g.athleteID ?? g.name);
      if (last && (last[0]!.top ? "t" : "b") + (last[0]!.athleteID ?? last[0]!.name) === key) last.push(g);
      else groups.push([g]);
      return groups;
    }, [])
    .map((list) => {
      const plain = list.every((g) => g.mark === "goal");
      const said = plain ? spokenMinutes(list.map((g) => g.minute)) : list.map((g) => spokenMinutes([g.minute]) + (g.mark === "penalty" ? ", penalty" : g.mark === "ownGoal" ? ", own goal" : "")).join(" and ");
      return `${names.callName(list[0]!.name)}, ${said}`;
    })
    .join("; ");
}

/** ["6'", "60'"] → "6th and 60th minute"; ["90'+5'"] → "90th minute plus 5". */
export function spokenMinutes(list: readonly string[]): string {
  const said = list.map((m) => spokenStatus(m));
  if (said.length > 1 && said.every((s) => s.endsWith(" minute"))) {
    const ordinals = said.map((s) => s.slice(0, -" minute".length));
    return `${ordinals.slice(0, -1).join(", ")} and ${ordinals[ordinals.length - 1]} minute`;
  }
  return said.join(" and ");
}

/** Shorthand read aloud: "·" pauses, "–" reads "to", "pts" reads "points". */
export function say(text: string): string {
  return text.replaceAll(" · ", ", ").replaceAll("–", " to ").replaceAll(" pts", " points").replaceAll(" reb", " rebounds").replaceAll(" ast", " assists");
}

/** Notes read aloud, with a series' team code as its city ("MIL leads 2–0" → "Milwaukee leads 2 to 0"). */
function sayNotes(text: string, top: ResultSide, bottom: ResultSide): string {
  let out = text;
  for (const side of [top, bottom]) {
    const place = side.location ?? side.name;
    for (const verb of [" leads ", " wins ", " lead ", " win "]) out = out.replaceAll(side.abbreviation + verb, place + verb);
  }
  return say(out);
}

// MARK: Stages

/** Cup stages a tie is decided in ("round-of-16", "quarterfinals", "final"). */
export function isKnockoutSlug(slug: string | null | undefined): boolean {
  const s = slug?.toLowerCase();
  if (!s) return false;
  return s.includes("knockout") || s.includes("playoff") || s.startsWith("round-of") || s.includes("final");
}

/** "round-of-16" → "Round of 16"; "quarterfinals" → "Quarterfinals". */
export function stageTitle(slug: string): string | null {
  const words = slug.split("-").filter(Boolean);
  if (words.length === 0) return null;
  return words.map((w, i) => (i > 0 && (w === "of" || w === "and") ? w : w.slice(0, 1).toUpperCase() + w.slice(1))).join(" ");
}

/** The status column's second line: the shootout ("2–4"), else the aggregate ("Agg 5–7"), top–bottom. */
export function resultSecondLine(r: ResultDetail | null): string | null {
  if (!r) return null;
  if (r.shootout) return `${r.shootout.top}–${r.shootout.bottom}`;
  if (r.aggregate && (r.leg === 2 || r.advances != null)) return `Agg ${r.aggregate.top}–${r.aggregate.bottom}`;
  return null;
}

/** "Attendance 60,123" */
export function attendanceLine(r: ResultDetail | null): string | null {
  return r?.attendance ? `Attendance ${r.attendance.toLocaleString()}` : null;
}

// MARK: - Rounds

/** "Matchweek 8 · Oct 23–25", "Week 7 · Oct 21–27", "Sep 12–14". */
export function roundLabel(round: ResultRound): string {
  return !round.detail || round.detail === round.title ? round.title : `${round.title} · ${round.detail}`;
}

/** The Eastern day a game's board lists it on (calendars and boards are Eastern). */
export function boardDay(item: ScheduleItem): DayKey {
  const date = startDate(item.start);
  return date != null ? dayKeyIn(date, EASTERN) : item.day;
}

function round(r: Partial<ResultRound> & Pick<ResultRound, "id" | "kind" | "title" | "detail" | "first" | "last">): ResultRound {
  return { section: null, week: null, seasonType: null, played: null, total: null, ...r };
}

/**
 * Rounds for `league`: `days` are the calendar's game days, `items` whatever
 * of the league is loaded, `calendar` gives cup stages and football weeks.
 * Rounds starting after `today` (Eastern) are left out. Oldest first.
 */
export function buildRounds(days: readonly DayKey[], items: readonly ScheduleItem[], calendar: ScheduleCalendar | null, league: League, today: DayKey, now: number): ResultRound[] {
  if (league.source.kind !== "espn") return [];
  if (league.source.weekly) return calendarRounds(calendar, now);
  if (league.sport !== "soccer") {
    const unique = new Map(days.filter((d) => compareDays(d, today) <= 0).map((d) => [dayID(d), d]));
    return [...unique.values()].sort(compareDays).map(dayRound);
  }
  return roundsLayout(days, items, calendar, league, today).rounds;
}

export interface RoundsLayout {
  readonly rounds: ResultRound[];
  /** Round ID → its games, in kickoff order. */
  readonly members: Map<string, ScheduleItem[]>;
}

/** Matchweeks (leagues) and stage blocks (cups) with the games in each. */
export function roundsLayout(days: readonly DayKey[], items: readonly ScheduleItem[], calendar: ScheduleCalendar | null, league: League, today: DayKey): RoundsLayout {
  // Cups list stages, not days: their blocks come from the games loaded.
  const stages = (calendar?.weeks ?? []).map((w) => ({ name: stageName(w.label), first: dayKeyIn(w.start, EASTERN), end: dayKeyIn(w.end, EASTERN) }));
  const stage = (d: DayKey): string | null => {
    const hits = stages.filter((s) => compareDays(s.first, d) <= 0 && compareDays(d, s.end) < 0);
    return hits.length ? hits.reduce((a, b) => (compareDays(a.first, b.first) >= 0 ? a : b)).name : null;
  };
  const byDay = new Map<string, ScheduleItem[]>();
  for (const item of items) {
    const key = dayID(boardDay(item));
    byDay.set(key, [...(byDay.get(key) ?? []), item]);
  }
  const all = new Map<string, DayKey>();
  for (const d of days) all.set(dayID(d), d);
  for (const item of items) all.set(dayID(boardDay(item)), boardDay(item));
  const blocks: DayKey[][] = [];
  for (const d of [...all.values()].sort(compareDays)) {
    const lastBlock = blocks[blocks.length - 1];
    const previous = lastBlock?.[lastBlock.length - 1];
    if (lastBlock && previous && daysBetween(previous, d) === 1 && stage(previous) === stage(d)) lastBlock.push(d);
    else blocks.push([d]);
  }
  const out: RoundsLayout = { rounds: [], members: new Map() };
  for (const block of blocks) {
    if (compareDays(block[0]!, today) > 0) continue;
    const members = sortItems(block.flatMap((d) => byDay.get(dayID(d)) ?? []));
    for (const [r, games] of blockRounds(block, members, stage(block[0]!), league)) {
      out.rounds.push(r);
      out.members.set(r.id, games);
    }
  }
  return out;
}

function blockRounds(block: readonly DayKey[], members: ScheduleItem[], stage: string | null, league: League): [ResultRound, ScheduleItem[]][] {
  const first = block[0]!;
  const last = block[block.length - 1]!;
  const finals = members.filter((m) => m.status === "final");
  const make = (id: string, kind: ResultRoundKind, title: string, games: ScheduleItem[]): [ResultRound, ScheduleItem[]] => {
    const ds = games.map(boardDay).sort(compareDays);
    const a = ds[0] ?? first;
    const b = ds[ds.length - 1] ?? last;
    return [
      round({
        id,
        kind,
        title,
        detail: dayRangeLabel(a, b),
        first: a,
        last: b,
        section: stage ?? seasonOf(a, league),
        played: games.length ? games.filter((g) => g.status === "final").length : null,
        total: games.length ? games.length : null,
      }),
      games,
    ];
  };
  const id = `b:${dayID(first)}`;
  const dates = make(id, "dates", dayRangeLabel(first, last), members);
  if (members.length === 0) return [dates];

  if (stage && isKnockoutStage(stage)) {
    const legs = members.map((m) => m.result?.leg ?? null);
    let title = stage;
    const leg = legs[0];
    if (leg != null && legs.every((l) => l === leg)) title += ` · ${ordinal(leg)} legs`;
    return [make(id, "stage", title, members)];
  }
  const played = finals.flatMap((f) => (f.result?.gamesPlayed != null ? [f.result.gamesPlayed] : []));
  if (played.length === 0) return [dates];
  const tally = new Map<number, number>();
  for (const g of played) tally.set(g, (tally.get(g) ?? 0) + 1);
  const counts = [...tally].sort((a, b) => (a[1] !== b[1] ? b[1] - a[1] : a[0] - b[0]));
  const kind: ResultRoundKind = stage == null ? "matchweek" : "stage";
  const title = (g: number) => (stage ? `${stage} · Matchday ${g}` : `Matchweek ${g}`);
  const total = played.length;
  if (counts[0]![1] >= 0.7 * total) return [make(id, kind, title(counts[0]![0]), members)];
  if (counts.length >= 2 && counts[1]![1] >= 0.3 * total) {
    // A holiday run holding two matchweeks: split by games played. A game
    // still to play goes with the round its day belongs to.
    const a = Math.min(counts[0]![0], counts[1]![0]);
    const b = Math.max(counts[0]![0], counts[1]![0]);
    const groupA: ScheduleItem[] = [];
    const groupB: ScheduleItem[] = [];
    const lastA = finals.filter((f) => f.result?.gamesPlayed === a).map(boardDay).sort(compareDays).pop() ?? first;
    for (const game of members) {
      const g = game.result?.gamesPlayed;
      if (g != null && game.status === "final") (Math.abs(g - a) <= Math.abs(g - b) ? groupA : groupB).push(game);
      else if (compareDays(boardDay(game), lastA) <= 0) groupA.push(game);
      else groupB.push(game);
    }
    return [make(`${id}:${a}`, kind, title(a), groupA), make(`${id}:${b}`, kind, title(b), groupB)];
  }
  return [dates];
}

/** Calendar stage labels as shown: "Rd of 16" → "Round of 16", "Group" → "Group Stage". */
export function stageName(label: string): string {
  switch (label) {
    case "Rd of 16":
      return "Round of 16";
    case "Rd of 32":
      return "Round of 32";
    case "Group":
      return "Group Stage";
    default:
      return label;
  }
}

export function isKnockoutStage(name: string): boolean {
  const s = name.toLowerCase();
  return !(s.includes("league") || s.includes("group"));
}

/** "2026–27" for a European league's round; "2026" for MLS. */
export function seasonOf(day: DayKey, league: League): string {
  if (league.id === "usa.1") return String(day.year);
  return seasonLabel(day.month >= 7 ? day.year : day.year - 1, "soccer", league.id);
}

/** NFL and college weeks that have started (preseason left out). */
export function calendarRounds(calendar: ScheduleCalendar | null, now: number): ResultRound[] {
  return (calendar?.weeks ?? [])
    .filter((w) => w.seasonType >= 2 && w.start <= now)
    .map((w: CalendarWeek) =>
      round({
        id: `w:${w.seasonType}-${w.number}`,
        kind: "week",
        title: w.label,
        detail: w.detail.replaceAll("-", "–"),
        first: dayKeyIn(w.start, EASTERN),
        last: dayKeyIn(w.end - 1000, EASTERN),
        section: w.seasonType === 3 ? "Postseason" : "Regular Season",
        week: w.number,
        seasonType: w.seasonType,
      }),
    );
}

export function dayRound(d: DayKey): ResultRound {
  return round({ id: `d:${dayID(d)}`, kind: "day", title: longDayLabel(d), detail: "", first: d, last: d });
}

/** A daily league's game days up to `today`, newest `limit` (MLB's calendar lists the days off instead). */
export function pastGameDays(calendar: ScheduleCalendar | null, today: DayKey, limit = 240): DayKey[] {
  if (!calendar) return Array.from({ length: 14 }, (_, i) => addingDays(today, -i)).reverse();
  if (calendar.offDays && calendar.seasonStart && calendar.seasonEnd) {
    const off = new Set(calendar.offDays.map(dayID));
    const out: DayKey[] = [];
    let d = compareDays(today, calendar.seasonEnd) <= 0 ? today : calendar.seasonEnd;
    while (compareDays(d, calendar.seasonStart) >= 0 && out.length < limit) {
      if (!off.has(dayID(d))) out.push(d);
      d = addingDays(d, -1);
    }
    return out.reverse();
  }
  return calendar.days.filter((d) => compareDays(d, today) <= 0).slice(-limit);
}

/**
 * The newest round with a result: rounds are skipped only when known to have
 * none (`hasFinal` false: loaded, nothing finished yet); an unloaded round
 * (null) is a candidate the caller loads to find out.
 */
export function latestRound(rounds: readonly ResultRound[], hasFinal: (r: ResultRound) => boolean | null): ResultRound | null {
  for (let i = rounds.length - 1; i >= 0; i--) if (hasFinal(rounds[i]!) !== false) return rounds[i]!;
  return rounds[rounds.length - 1] ?? null;
}

const nextFormat = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });

/** The round summary line: "10 results · 19 goals", "13 results · 1 overtime", "8 of 10 played · next: Mon 12:00 PM", "All 3 games postponed". */
export function roundSummary(items: readonly ScheduleItem[], sport: Sport | null): string | null {
  const games = items.filter((i) => !isField(i));
  if (games.length === 0) return null;
  const finals = games.filter((g) => g.status === "final" && g.result?.kind !== "abandoned");
  const pending = games.filter((g) => g.status === "scheduled" || g.status === "live");
  if (finals.length === 0 && pending.length === 0) return games.length === 1 ? "Postponed" : `All ${games.length} games postponed`;
  if (pending.length > 0) {
    const next = pending.filter((g) => g.status === "scheduled").sort((a, b) => sortDate(a) - sortDate(b))[0];
    const date = next ? startDate(next.start) : null;
    return [`${finals.length} of ${finals.length + pending.length} played`, date != null ? `next: ${nextFormat.format(date)}` : null].filter(Boolean).join(" · ");
  }
  const parts = [plural(finals.length, "result")];
  if (sport === "soccer") {
    const goals = finals.reduce((sum, f) => sum + itemTeams(f).reduce((s, t) => s + (t.score != null && /^\d+$/.test(t.score) ? Number(t.score) : 0), 0), 0);
    parts.push(plural(goals, "goal"));
  } else if (sport === "football" || sport === "basketball") {
    const extra = finals.filter((f) => f.result?.kind === "overtime").length;
    if (extra > 0) parts.push(plural(extra, "overtime"));
  }
  return parts.join(" · ");
}

/** Timed games by time, then those without one (Swift `Agenda.sorted`). */
export function sortItems(items: readonly ScheduleItem[]): ScheduleItem[] {
  return [...items].sort((a, b) => {
    const ka = startDate(a.start) != null;
    const kb = startDate(b.start) != null;
    if (ka !== kb) return ka ? -1 : 1;
    const da = sortDate(a);
    const db = sortDate(b);
    if (da !== db) return da - db;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// MARK: - Team seasons

/** Club friendlies and invitationals (`club.friendly`, `friendly.emirates_cup`): hidden from results unless asked for. */
export function isFriendly(item: ScheduleItem): boolean {
  return item.league.includes("friendly");
}

/** A result from one team's side: its letter, its side and the other. */
export function outcome(item: ScheduleItem, teamID: string): { letter: string; mine: ScheduleTeam; other: ScheduleTeam } | null {
  if (item.status !== "final") return null;
  const teams = itemTeams(item);
  const mine = teams.find((t) => t.id === teamID);
  const other = teams.find((t) => t.id !== teamID);
  if (!mine || !other) return null;
  if (item.result?.kind === "abandoned" || item.result?.kind === "suspended") return null;
  const letter = mine.winner ? "W" : other.winner ? "L" : item.sport === "soccer" ? "D" : "T";
  return { letter, mine, other };
}

/**
 * A team's season from its schedule: record, W/D/L, goals (or points, runs),
 * the last ten results as form, and the results newest first. `summary` is
 * the team schedule's "7–0–1 · 2nd in English Premier League", trusted only
 * for the current season.
 */
export function summarizeSeason(items: readonly ScheduleItem[], team: ScheduleTeamRef, season: string, isCurrent: boolean, summary: string | null, includeFriendlies = false): TeamSeason {
  const seen = new Set<string>();
  const results = items
    .filter((item) => item.status === "final" && (includeFriendlies || !isFriendly(item)) && !seen.has(item.id) && seen.add(item.id) && itemTeams(item).some((t) => t.id === team.id))
    .sort((a, b) => sortDate(b) - sortDate(a));
  let played = 0;
  let won = 0;
  let drawn = 0;
  let lost = 0;
  let ties = 0;
  let scoredFor = 0;
  let scoredAgainst = 0;
  let scored = false;
  const marks: FormMark[] = [];
  for (const item of results) {
    const o = outcome(item, team.id);
    if (!o) continue;
    played += 1;
    if (o.letter === "W") won += 1;
    else if (o.letter === "L") lost += 1;
    else {
      drawn += 1;
      ties += 1;
    }
    const a = o.mine.score != null && /^\d+$/.test(o.mine.score) ? Number(o.mine.score) : null;
    const b = o.other.score != null && /^\d+$/.test(o.other.score) ? Number(o.other.score) : null;
    if (a != null && b != null) {
      scoredFor += a;
      scoredAgainst += b;
      scored = true;
    }
    if (marks.length < 10) marks.push(formMark(item, o.letter, o.mine, o.other));
  }
  const soccer = results[0]?.sport === "soccer" || team.id.startsWith("espn-soccer-");
  const computed = soccer ? `${won}–${drawn}–${lost}` : `${won}–${lost}${ties > 0 ? `–${ties}` : ""}`;
  const parts = (summary ?? "").split(" · ").filter(Boolean);
  const espnRecord = parts[0] && gamesPlayedIn(parts[0]) != null ? enDash(parts[0]) : null;
  let record: string | null;
  let standing: string | null = null;
  if (isCurrent) {
    record = espnRecord ?? (played > 0 ? computed : null);
    const s = parts.slice(espnRecord == null ? 0 : 1)[0];
    standing = s ? standingText(s) : null;
  } else {
    record = played > 0 ? computed : null;
  }
  return {
    team,
    season,
    isCurrent,
    record,
    standing,
    played,
    won,
    drawn,
    lost,
    scoredFor: scored ? scoredFor : null,
    scoredAgainst: scored ? scoredAgainst : null,
    form: marks.reverse(),
    results,
  };
}

/** "2nd in English Premier League" → "2nd in Premier League". */
export function standingText(text: string): string {
  return text.replaceAll("English Premier League", "Premier League");
}

const spokenDate = new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" });

/** One form letter's readout and words: "Sat, Oct 24 · W 2–0 vs Everton · Premier League". */
export function formMark(item: ScheduleItem, letter: string, mine: ScheduleTeam, other: ScheduleTeam): FormMark {
  const home = item.sport === "soccer" ? item.top?.id === mine.id : item.bottom?.id === mine.id;
  const score = [mine.score, other.score].filter((s): s is string => s != null);
  const scoreText = score.length === 2 ? ` ${score[0]}–${score[1]}` : "";
  let shootout: { text: string; spoken: string } | null = null;
  const s = item.result?.shootout;
  if (s) {
    const mineFirst = item.top?.id === mine.id;
    const [a, b] = mineFirst ? [s.top, s.bottom] : [s.bottom, s.top];
    const verb = a > b ? "won" : "lost";
    shootout = { text: `${verb} ${a}–${b} on pens`, spoken: `${verb} ${a} to ${b} on penalties` };
  }
  const competition = item.competition ?? leagueWithID(item.league)?.name ?? null;
  const opponent = `${home ? "vs" : "at"} ${other.name}`;
  const result = `${letter}${scoreText}`;
  const day = mediumDayLabel(item.day);
  const readout = [...(shootout ? [day, result, shootout.text, opponent] : [day, `${result} ${opponent}`]), ...(competition ? [competition] : [])].join(" · ");
  const verb = ({ W: "won", L: "lost", D: "drew", T: "tied" } as Record<string, string>)[letter] ?? "played";
  const date = spokenDate.format(new Date(item.day.year, item.day.month - 1, item.day.day, 12));
  const spokenScore = score.length === 2 ? ` ${score[0]} to ${score[1]}` : "";
  return { letter, itemID: item.id, readout, spoken: `${date}, ${verb}${spokenScore} against ${other.name}${shootout ? `, ${shootout.spoken}` : ""}` };
}

/**
 * ESPN's `season=` for the season under way: soccer counts from the start
 * year (2026 is 2026–27), basketball from the end year (2027 is 2026–27),
 * football from the September it starts.
 */
export function currentSeasonYear(sport: Sport, league: string | null, today: DayKey): number {
  switch (sport) {
    case "soccer":
      return league === "usa.1" ? today.year : today.month >= 7 ? today.year : today.year - 1;
    case "basketball":
      return league === "wnba" ? today.year : today.month >= 10 ? today.year + 1 : today.year;
    case "football":
      return today.month >= 3 ? today.year : today.year - 1;
    default:
      return today.year;
  }
}

/** "2026–27" (soccer `season=2026`, NBA `season=2027`), "2024" (NFL, MLB). */
export function seasonLabel(year: number, sport: Sport, league: string | null): string {
  if (sport === "soccer" && league !== "usa.1") return `${year}–${String((year + 1) % 100).padStart(2, "0")}`;
  if (sport === "basketball" && league !== "wnba") return `${year - 1}–${String(year % 100).padStart(2, "0")}`;
  return String(year);
}

export interface SeasonChoice {
  /** ESPN's `season=`; null for the current season (the default request). */
  readonly year: number | null;
  readonly label: string;
}

// MARK: - CS2 team history

export const CS_HISTORY_PAGE = 20;

/** A team's finished matches (and forfeits), newest first, 20 a page. */
export function csHistoryURL(teamIDs: readonly number[], page: number): string {
  const params = new URLSearchParams({
    "filter[matches.team_ids][overlap]": teamIDs.join(","),
    "filter[matches.status][in]": "finished,defwin",
    "filter[matches.tier][in]": TIER,
    sort: "-start_date",
    "page[limit]": String(CS_HISTORY_PAGE),
    "page[offset]": String(Math.max(page, 0) * CS_HISTORY_PAGE),
    with: "teams,tournament",
  });
  return `https://api.bo3.gg/api/v1/matches?${params}`;
}

// MARK: - Navigation and a team's side (ResultsPage.swift `ResultsNavigation`, ResultRows.swift `TeamResult`)

/** The strip's first day: the selected day's week (Sunday first), except that this week ends today. */
export function stripStart(day: DayKey, today: DayKey): DayKey {
  const start = weekStart(day);
  if (compareDays(addingDays(start, 6), today) > 0) {
    const back = addingDays(today, -6);
    return compareDays(start, back) <= 0 ? start : back;
  }
  return start;
}

/** The round picker's sections, newest first: sections by their newest round, rounds newest first inside. */
export function roundSections(rounds: readonly { id: string; title: string; detail: string; section: string | null }[]) {
  const order: string[] = [];
  const by = new Map<string, { id: string; title: string; detail: string }[]>();
  for (const r of [...rounds].reverse()) {
    const k = r.section ?? "";
    if (!by.has(k)) order.push(k);
    by.set(k, [...(by.get(k) ?? []), { id: r.id, title: r.title, detail: r.detail }]);
  }
  return order.map((title) => ({ title, options: by.get(title) ?? [] }));
}

/** The strip's ‹ › in Results: a week back or on, landing on the game day nearest the same weekday. */
export function weekStep(direction: number, current: DayKey, rounds: readonly { id: string; first: DayKey }[]) {
  const target = addingDays(current, 7 * direction);
  const start = weekStart(target);
  const end = addingDays(start, 6);
  const inWeek = rounds.filter((r) => compareDays(start, r.first) <= 0 && compareDays(r.first, end) <= 0);
  if (inWeek.length) {
    return inWeek.reduce((a, b) => (Math.abs(daysBetween(a.first, target)) <= Math.abs(daysBetween(b.first, target)) ? a : b));
  }
  return direction < 0 ? ([...rounds].reverse().find((r) => compareDays(r.first, start) < 0) ?? null) : (rounds.find((r) => compareDays(r.first, end) > 0) ?? null);
}


// MARK: - A team's side of a result

/** One result read from a team's side: "W 2–0 vs Everton" (Swift `TeamResult`). Pure: tested. */
export interface TeamResult {
  /** "W", "D", "L", "T"; null when there's no result to read. */
  readonly letter: string | null;
  /** "2–0", the team's score first; null for a forfeit. */
  readonly score: string | null;
  readonly home: boolean;
  readonly opponent: ScheduleTeam | null;
  /** "(P)" after a shootout. */
  readonly shootout: boolean;
}

export function teamResult(item: ScheduleItem, team: string): TeamResult {
  const teams = itemTeams(item);
  const mine = teams.find((t) => t.id === team) ?? null;
  const other = teams.find((t) => t.id !== team) ?? (mine == null ? null : (teams[teams.length - 1] ?? null));
  // Soccer lists the home side first; everyone else the away side first.
  const home = item.sport === "soccer" ? item.top?.id === team : item.bottom?.id === team;
  const shootout = item.result?.kind === "penalties";
  const base = { home, opponent: other, shootout };
  if (item.status !== "final" || !mine || !other) return { ...base, letter: null, score: null };
  if (item.result?.kind === "forfeit") return { ...base, letter: mine.winner ? "W" : other.winner ? "L" : null, score: null };
  // No score, no result to read (a final the source sent bare).
  if (mine.score == null || other.score == null) return { ...base, letter: null, score: null };
  return { ...base, letter: mine.winner ? "W" : other.winner ? "L" : item.sport === "soccer" ? "D" : "T", score: `${mine.score}–${other.score}` };
}

/** "won 2 to 0", "lost 1 to 3", "drew 2 to 2". */
export function spokenTeamResult(r: TeamResult): string | null {
  if (!r.letter) return null;
  const word = ({ W: "won", L: "lost", D: "drew", T: "tied" } as Record<string, string>)[r.letter] ?? r.letter;
  return [word, r.score?.replaceAll("–", " to ")].filter(Boolean).join(" ");
}

