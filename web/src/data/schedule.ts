/**
 * Schedules and results: the values every schedule, results, season,
 * standings and bracket page shares. Ported from ScheduleModels.swift and
 * ResultsContract.swift, with the same names and comments. Plain,
 * serializable data: dates are epoch milliseconds, absent values `null`.
 *
 * The page logic that works on these (Agenda, ResultsNavigation, rounds,
 * windows) lives in `agenda.ts` and `results.ts`; parsers in `providers/`.
 */
import { compareDays, startOfDay, type DayKey } from "./days";
import { leagueWithID } from "./leagues";
import type { Competitor, EventRef, EventState, League, ScoreEvent, Sport } from "./models";

// MARK: - Times

/** Shown dimmed with "Provisional": EPL kickoffs before the TV picks, bo3.gg's placeholder order of play. */
export type Provisional = "tvPicks" | "orderOfPlay" | "programme";

/** When something starts, as honestly as the source knows (Swift `StartTime`). */
export type StartTime =
  | { readonly kind: "exact"; readonly date: number }
  | { readonly kind: "provisional"; readonly date: number; readonly why: Provisional }
  /** Listed for its day, time unknown (ESPN `timeValid: false`, climbing rounds). */
  | { readonly kind: "tba" }
  /** The day may move too (European soccer `timeValid: false`). */
  | { readonly kind: "tbc" };

export function startDate(start: StartTime): number | null {
  return start.kind === "exact" || start.kind === "provisional" ? start.date : null;
}

export type ScheduleStatus = "scheduled" | "live" | "final" | "postponed" | "canceled";

// MARK: - Items

export interface ScheduleTeam {
  /** The `Competitor.id` format (espnTeamID, "cs-793"), so following and stars just work. */
  readonly id: string | null;
  readonly name: string;
  readonly abbreviation: string;
  readonly logo: string | null;
  readonly record: string | null;
  readonly rank: number | null;
  readonly score: string | null;
  readonly winner: boolean;
}

export function scheduleTeam(t: Partial<ScheduleTeam> & Pick<ScheduleTeam, "name">): ScheduleTeam {
  return {
    id: t.id ?? null,
    name: t.name,
    abbreviation: t.abbreviation ?? t.name.slice(0, 3).toUpperCase(),
    logo: t.logo ?? null,
    record: t.record ?? null,
    rank: t.rank ?? null,
    score: t.score ?? null,
    winner: t.winner ?? false,
  };
}

export type ScheduleRef =
  | { readonly kind: "espn"; readonly path: string; readonly id: string }
  | { readonly kind: "counterStrike"; readonly slug: string; readonly tournament: string | null }
  | { readonly kind: "climbing"; readonly eventID: number };

/** One game, match or round on a schedule (Swift `ScheduleItem`). */
export interface ScheduleItem {
  /**
   * The same ID the scores list uses ("espn-401873033", "cs-412345"), so live
   * state can be read from the scoreboard and the match page opens as usual.
   */
  readonly id: string;
  readonly sport: Sport;
  /** `League.id` for catalog leagues, else the competition's slug ("eng.league_cup"). */
  readonly league: string;
  /** "Carabao Cup · Fourth Round": shown when the scope isn't that league. */
  readonly competition: string | null;
  readonly day: DayKey;
  readonly start: StartTime;
  readonly status: ScheduleStatus;
  /** The source's short status for live and final games ("67'", "Final/OT"). */
  readonly statusDetail: string | null;
  /** House order: soccer lists the home side first, everyone else the away side. */
  readonly top: ScheduleTeam | null;
  readonly bottom: ScheduleTeam | null;
  /** Field events (climbing rounds, a collapsed tournament day). */
  readonly title: string | null;
  readonly subtitle: string | null;
  /** "Anfield · Liverpool" */
  readonly venue: string | null;
  /** Display names, national networks first. */
  readonly networks: readonly string[];
  /** "Best of 3" */
  readonly format: string | null;
  /** Rewritten captions ("World Series · Game 5 · If necessary"). */
  readonly notes: readonly string[];
  readonly ifNecessary: boolean;
  readonly week: number | null;
  readonly link: string | null;
  readonly ref: ScheduleRef;
  /** What a finished (or postponed, canceled) game adds. Null until it's played. */
  readonly result: ResultDetail | null;
  /** A collapsed tournament day's matches (CS2 in the All scope). */
  readonly children: readonly ScheduleItem[] | null;
}

export type ScheduleItemInit = Partial<ScheduleItem> & Pick<ScheduleItem, "id" | "sport" | "league" | "day" | "start" | "status" | "ref">;

export function scheduleItem(i: ScheduleItemInit): ScheduleItem {
  return {
    competition: null,
    statusDetail: null,
    top: null,
    bottom: null,
    title: null,
    subtitle: null,
    venue: null,
    networks: [],
    format: null,
    notes: [],
    ifNecessary: false,
    week: null,
    link: null,
    result: null,
    children: null,
    ...i,
  };
}

export function isField(item: ScheduleItem): boolean {
  return item.top == null && item.bottom == null;
}

export function itemTeams(item: ScheduleItem): ScheduleTeam[] {
  return [item.top, item.bottom].filter((t): t is ScheduleTeam => t != null);
}

/** Timed games by time; games without one sort after their day's timed games. */
export function sortDate(item: ScheduleItem): number {
  return startDate(item.start) ?? startOfDay(item.day) + 86_399_000;
}

/** The app's `ScoreEvent`, for the match page, links and live lookup (Swift `ScheduleItem.event()`). */
export function itemEvent(item: ScheduleItem): ScoreEvent {
  const state: EventState = item.status === "live" ? "live" : item.status === "scheduled" ? "scheduled" : "final";
  const played = item.status === "live" || item.status === "final";
  const competitor = (t: ScheduleTeam): Competitor => ({
    id: t.id,
    name: t.name,
    abbreviation: t.abbreviation,
    score: played ? t.score : null,
    logo: t.logo,
    isWinner: item.status === "final" && t.winner,
    color: null,
    rank: t.rank,
    record: t.record,
    conferenceRecord: null,
    alternateColor: null,
  });
  const detail = item.status === "postponed" ? "Postponed" : item.status === "canceled" ? "Canceled" : item.statusDetail;
  let ref: EventRef;
  switch (item.ref.kind) {
    case "espn":
      ref = { kind: "espn", path: item.ref.path, id: item.ref.id, sport: item.sport };
      break;
    case "counterStrike":
      ref = { kind: "counterStrike", slug: item.ref.slug, tournament: item.ref.tournament };
      break;
    case "climbing":
      ref = { kind: "climbing", eventID: item.ref.eventID, category: "", resultURL: null, round: null, eventName: item.title ?? "", nextURL: null };
      break;
  }
  const caption = [item.competition, ...item.notes].filter(Boolean).join(" · ");
  return {
    id: item.id,
    content: item.top && item.bottom ? { kind: "match", top: competitor(item.top), bottom: competitor(item.bottom) } : { kind: "field", title: item.title ?? "", summary: item.subtitle ?? "" },
    state,
    start: startDate(item.start) ?? startOfDay(item.day),
    detail,
    caption: caption || null,
    link: item.link,
    ref,
    stage: item.result?.stage ?? null,
    clock: null,
    possession: null,
    liveLine: null,
    liveLineRoutine: false,
    broadcast: item.networks.length > 0 ? item.networks.slice(0, 2).join(" · ") : null,
    venue: item.venue,
    snapshot: null,
  };
}

// MARK: - Results (ResultsContract.swift)

/** Which way a schedule page faces in time. */
export type ScheduleMode = "upcoming" | "results";

export const MODE_TITLE: Readonly<Record<ScheduleMode, string>> = { upcoming: "Upcoming", results: "Results" };

export type ResultKind = "regulation" | "overtime" | "extraTime" | "penalties" | "forfeit" | "abandoned" | "suspended";

/** House order: top, then bottom. */
export interface Pair {
  readonly top: number;
  readonly bottom: number;
}

export interface Scorer {
  /** The side it counts for (an own goal: the side it benefits). */
  readonly top: boolean;
  /** "Jackson" */
  readonly name: string;
  /** "6'", "90'+3'" */
  readonly minute: string;
  readonly mark: "goal" | "penalty" | "ownGoal" | "red";
  readonly athleteID: string | null;
}

export interface Performer {
  readonly top: boolean;
  /** "Doncic" */
  readonly name: string;
  /** "52 pts, 8 reb, 10 ast" */
  readonly line: string;
  /** "points", "rating", "passingYards" */
  readonly category: string;
  readonly athleteID: string | null;
}

export interface Pitcher {
  readonly name: string;
  /** "1–0" for a decision, "3" for a save. */
  readonly record: string;
  readonly athleteID: string | null;
}

export interface Decisions {
  readonly win: Pitcher | null;
  readonly loss: Pitcher | null;
  readonly save: Pitcher | null;
}

/** What a finished game adds to its row. Built by the parser; every string a view shows is computed once, there. */
export interface ResultDetail {
  readonly kind: ResultKind;
  /** "FT", "AET", "Pens", "Final/OT", "Forfeit" */
  readonly label: string;
  readonly periods: number | null;
  readonly shootout: Pair | null;
  readonly aggregate: Pair | null;
  readonly leg: number | null;
  /** Who goes through, when the match itself doesn't say (two legs, shootouts). */
  readonly advances: string | null;
  /** `season.slug`: "round-of-16", "league-phase" */
  readonly stage: string | null;
  /** Soccer: the larger of the two sides' W+D+L after this game (its matchweek). */
  readonly gamesPlayed: number | null;
  readonly scorers: readonly Scorer[];
  readonly performers: readonly Performer[];
  readonly decisions: Decisions | null;
  /** "MIL leads 2–0" */
  readonly series: string | null;
  /** The recap's headline. */
  readonly headline: string | null;
  readonly attendance: number | null;
  /** The compact details line. */
  readonly details: string | null;
  /** The lane's first line from the large width class. */
  readonly detailsWide: string | null;
  /** The knockout context line. */
  readonly context: string | null;
  /** Appended to the row's spoken label. */
  readonly spoken: string | null;
}

export function resultDetail(r: Partial<ResultDetail> & Pick<ResultDetail, "label">): ResultDetail {
  return {
    kind: "regulation",
    periods: null,
    shootout: null,
    aggregate: null,
    leg: null,
    advances: null,
    stage: null,
    gamesPlayed: null,
    scorers: [],
    performers: [],
    decisions: null,
    series: null,
    headline: null,
    attendance: null,
    details: null,
    detailsWide: null,
    context: null,
    spoken: null,
    ...r,
  };
}

export type ResultRoundKind = "day" | "week" | "matchweek" | "stage" | "dates";

/** A round of results: a matchweek, a football week, a cup stage block, a day. */
export interface ResultRound {
  /** "d:2026-10-25", "w:2-7", "b:2026-10-23" */
  readonly id: string;
  readonly kind: ResultRoundKind;
  /** "Matchweek 8", "Week 7", "Sunday, Oct 25", "Round of 16 · 2nd legs" */
  readonly title: string;
  /** "Oct 23–25" */
  readonly detail: string;
  readonly first: DayKey;
  readonly last: DayKey;
  /** "2026–27", "League Phase", "Regular Season" */
  readonly section: string | null;
  /** Football: the board to fetch. */
  readonly week: number | null;
  readonly seasonType: number | null;
  /** Known once the round has loaded. */
  readonly played: number | null;
  readonly total: number | null;
}

/** One letter of a team's form strip. */
export interface FormMark {
  /** "W", "D", "L", "T" */
  readonly letter: string;
  readonly itemID: string;
  /** "Sat, Oct 24 · W 2–0 vs Everton · Premier League" */
  readonly readout: string;
  /** "October 24, won 2 to 0 against Everton" */
  readonly spoken: string;
}

export interface TeamSeason {
  readonly team: ScheduleTeamRef;
  /** "2026–27" */
  readonly season: string;
  readonly isCurrent: boolean;
  /** ESPN's (current season) or computed. */
  readonly record: string | null;
  /** The current season only. */
  readonly standing: string | null;
  readonly played: number;
  readonly won: number;
  readonly drawn: number;
  readonly lost: number;
  readonly scoredFor: number | null;
  readonly scoredAgainst: number | null;
  /** The last 10, oldest first. */
  readonly form: readonly FormMark[];
  /** Newest first. */
  readonly results: readonly ScheduleItem[];
}

/** A CS2 placing. */
export interface Placement {
  /** "1st", "5th–8th" */
  readonly place: string;
  /** Sort key: the first number. */
  readonly order: number;
  readonly team: ScheduleTeam;
  readonly money: number | null;
  readonly clubMoney: number | null;
}

/** Pages deeper than a row: a climbing category's full results, a tournament's. */
export type EventResultsRef =
  /** `eventName` is the short name ("Santiago"). */
  | { readonly kind: "climbing"; readonly eventID: number; readonly dcatID: number; readonly category: string; readonly eventName: string }
  | { readonly kind: "tournament"; readonly slug: string; readonly name: string };

// MARK: - Seasons (climbing competitions, CS2 tournaments)

/** A round of a climbing competition, with a time when the programme gives one. */
export interface ClimbingRound {
  readonly name: string;
  /** "Lead", "Boulder", "Speed" */
  readonly discipline: string;
  /** ["Men", "Women"] */
  readonly categories: readonly string[];
  readonly start: StartTime;
  readonly stream: string | null;
  /** pending / active / finished */
  readonly status: string;
}

export const climbingRoundID = (r: ClimbingRound) => `${r.discipline}|${r.name}`;
/** "Lead semi-final" */
export const climbingRoundLabel = (r: ClimbingRound) => `${r.discipline} ${r.name.toLowerCase()}`;

/** A category's round, as the event detail lists it. */
export interface RoundLink {
  /** `category_round_id` */
  readonly id: number;
  /** "Qualification", "Semi-final", "Final" */
  readonly name: string;
  /** "finished", "active", "not_started" */
  readonly status: string;
  /** `result_url`: what `EventRef.climbing(resultURL:)` loads. */
  readonly resultPath: string | null;
}

/** A podium athlete, with the ID their page needs. */
export interface PodiumAthlete {
  readonly athleteID: number;
  readonly rank: number;
  readonly first: string;
  readonly last: string;
  /** IOC code ("SLO"). */
  readonly country: string | null;
}

export interface SeasonCategory {
  /** "Lead Women" */
  readonly name: string;
  /** "SLO Garnbret" */
  readonly podium: readonly string[];
  /** IFSC's `dcat_id`: the category's full results. */
  readonly dcatID: number | null;
  readonly rounds: readonly RoundLink[];
  readonly podiumAthletes: readonly PodiumAthlete[];
}

export type SeasonEventKind = { readonly kind: "climbing"; readonly id: number } | { readonly kind: "tournament"; readonly slug: string };
export type SeasonEventStatus = "upcoming" | "live" | "finished" | "canceled";

export interface SeasonEvent {
  readonly id: string;
  readonly kind: SeasonEventKind;
  /** "World Climbing Series Tokyo 2027" */
  readonly name: string;
  /** "Tokyo" */
  readonly shortName: string;
  /** "Tokyo, Japan" */
  readonly place: string | null;
  /** ISO 3166 alpha-2, for the flag. */
  readonly countryCode: string | null;
  /** Venue-local dates (climbing) or UTC dates (CS2): never converted. */
  readonly startDay: DayKey;
  readonly endDay: DayKey;
  readonly startsAt: number | null;
  readonly endsAt: number | null;
  /** IANA zone of the venue (climbing). */
  readonly timeZone: string | null;
  /** Timeline lanes: "boulder", "lead", "speed" / "s". */
  readonly lanes: readonly string[];
  /** "World Championships", "Olympic Games", "Major" */
  readonly badge: string | null;
  readonly prize: number | null;
  /** "LAN", "Online" */
  readonly format: string | null;
  readonly logo: string | null;
  readonly status: SeasonEventStatus;
  readonly categories: readonly SeasonCategory[];
  readonly rounds: readonly ClimbingRound[];
  readonly teams: readonly ScheduleTeam[];
  /** IOC code → confirmed athletes (highlighted countries only). */
  readonly registered: Readonly<Record<string, number>>;
  readonly link: string | null;
  readonly infoSheet: string | null;
  /** CS2: stages drawn so far (a bracket page has something to show). */
  readonly stages: number;
  /** True once the event's own detail has been loaded. */
  readonly detailed: boolean;
}

/** Inclusive day count ("Day 1 of 3"). */
export function dayCount(e: SeasonEvent): number {
  return Math.round((Date.UTC(e.endDay.year, e.endDay.month - 1, e.endDay.day) - Date.UTC(e.startDay.year, e.startDay.month - 1, e.startDay.day)) / 86_400_000) + 1;
}

export function seasonContains(e: SeasonEvent, day: DayKey): boolean {
  return compareDays(e.startDay, day) <= 0 && compareDays(day, e.endDay) <= 0;
}

// MARK: - Calendars

/** A football week (Swift `ScheduleCalendar.Week`). */
export interface CalendarWeek {
  /** "Week 8", "Wild Card", "Bowls" */
  readonly label: string;
  /** "Oct 28-Nov 3" */
  readonly detail: string;
  readonly number: number;
  /** 1 preseason, 2 regular, 3 postseason */
  readonly seasonType: number;
  readonly start: number;
  readonly end: number;
}

export const weekID = (w: CalendarWeek) => `${w.seasonType}-${w.number}`;

/** A league's season, from ESPN's scoreboard: the dates that have games (soccer, NBA, MLB) or the weeks (NFL, college). */
export interface ScheduleCalendar {
  /** Game days, for leagues whose calendar lists them (most). */
  readonly days: readonly DayKey[];
  /** MLB lists the opposite: days off within the season (`offSeason…`). */
  readonly offDays: readonly DayKey[] | null;
  readonly seasonStart: DayKey | null;
  readonly seasonEnd: DayKey | null;
  readonly weeks: readonly CalendarWeek[];
}

export const EMPTY_CALENDAR: ScheduleCalendar = { days: [], offDays: null, seasonStart: null, seasonEnd: null, weeks: [] };

// MARK: - Scopes

/** A team a schedule can be opened for. */
export interface ScheduleTeamRef {
  readonly id: string;
  readonly name: string;
  readonly logo: string | null;
  /** League ID when known (otherwise derived from the ID's prefix). */
  readonly league?: string | null;
}

/** What a schedule page shows (Swift `ScheduleScope`). */
export type ScheduleScope =
  /** Every enabled league, filtered as the scores list is. */
  | { readonly kind: "all" }
  | { readonly kind: "yourTeams" }
  | { readonly kind: "league"; readonly id: string }
  | { readonly kind: "team"; readonly team: ScheduleTeamRef }
  | { readonly kind: "climbing" }
  | { readonly kind: "tournaments" };

export function scopeFor(league: League): ScheduleScope {
  switch (league.source.kind) {
    case "ifsc":
      return { kind: "climbing" };
    case "counterStrike":
      return { kind: "tournaments" };
    case "espn":
      return { kind: "league", id: league.id };
  }
}

export function scopeKey(scope: ScheduleScope): string {
  switch (scope.kind) {
    case "league":
      return `league:${scope.id}`;
    case "team":
      return `team:${scope.team.id}`;
    default:
      return scope.kind;
  }
}

export function scopeTitle(scope: ScheduleScope): string {
  switch (scope.kind) {
    case "all":
      return "Schedule";
    case "yourTeams":
      return "Your Teams";
    case "league":
      return leagueWithID(scope.id)?.name ?? "Schedule";
    case "team":
      return scope.team.name;
    case "climbing":
      return "Climbing Season";
    case "tournaments":
      return "Tournaments";
  }
}

/**
 * How the page navigates in time: a week of every league (strip), a football
 * week (picker), a daily league's coming game days (list, more on request),
 * a team's season by month.
 */
export type Navigator = "weekStrip" | "weekPicker" | "list" | "monthBar" | "none";

export function scopeNavigator(scope: ScheduleScope): Navigator {
  switch (scope.kind) {
    case "all":
      return "weekStrip";
    case "league": {
      const source = leagueWithID(scope.id)?.source;
      return source?.kind === "espn" && source.weekly ? "weekPicker" : "list";
    }
    case "yourTeams":
    case "team":
      return "monthBar";
    default:
      return "none";
  }
}

/** Days fold to a one-line summary on pages with many games a day. A team's days hold one game each, so they never fold. */
export function foldsDays(scope: ScheduleScope): boolean {
  return scope.kind === "all" || scope.kind === "league";
}

// MARK: - URLs (the web's `Page.schedule(scope, mode:)`)

/**
 * A schedule page's path: `/schedule`, `/schedule/your-teams`,
 * `/schedule/nfl`, `/schedule/climbing`, `/schedule/tournaments`,
 * `/schedule/team/<id>?name=…&logo=…`, each with `?mode=results` facing back.
 */
export function schedulePath(scope: ScheduleScope, mode: ScheduleMode = "upcoming"): string {
  const params = new URLSearchParams();
  let path: string;
  switch (scope.kind) {
    case "all":
      path = "/schedule";
      break;
    case "yourTeams":
      path = "/schedule/your-teams";
      break;
    case "league":
      path = `/schedule/${encodeURIComponent(scope.id)}`;
      break;
    case "team":
      path = `/schedule/team/${encodeURIComponent(scope.team.id)}`;
      params.set("name", scope.team.name);
      if (scope.team.logo) params.set("logo", scope.team.logo);
      break;
    case "climbing":
      path = "/schedule/climbing";
      break;
    case "tournaments":
      path = "/schedule/tournaments";
      break;
  }
  if (mode === "results") params.set("mode", "results");
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/** The scope a schedule path names, or null for an unknown league. */
export function parseScope(segment: string | undefined, teamID: string | undefined, search: URLSearchParams): ScheduleScope | null {
  if (teamID) {
    return { kind: "team", team: { id: teamID, name: search.get("name") ?? "Team", logo: search.get("logo") } };
  }
  if (!segment) return { kind: "all" };
  if (segment === "your-teams") return { kind: "yourTeams" };
  if (segment === "climbing" || segment === "ifsc") return { kind: "climbing" };
  if (segment === "tournaments" || segment === "cs2") return { kind: "tournaments" };
  const league = leagueWithID(segment);
  return league ? scopeFor(league) : null;
}

export function parseMode(search: URLSearchParams): ScheduleMode {
  return search.get("mode") === "results" ? "results" : "upcoming";
}

/** `/results/climbing/1489/5?category=Lead%20Women&event=Santiago`, `/results/tournament/<slug>?name=…` */
export function eventResultsPath(ref: EventResultsRef): string {
  if (ref.kind === "climbing") {
    const q = new URLSearchParams({ category: ref.category, event: ref.eventName });
    return `/results/climbing/${ref.eventID}/${ref.dcatID}?${q}`;
  }
  return `/results/tournament/${encodeURIComponent(ref.slug)}?${new URLSearchParams({ name: ref.name })}`;
}

/** `/standings/<league>`; `ring` names teams to light (the match it was opened from). */
export function standingsPath(league: string, ring: readonly (string | null)[] = []): string {
  const ids = ring.filter(Boolean);
  return ids.length ? `/standings/${encodeURIComponent(league)}?ring=${ids.map((id) => encodeURIComponent(id!)).join(",")}` : `/standings/${encodeURIComponent(league)}`;
}

/** `/rankings/college-football` (the AP Top 25 and the Coaches Poll). */
export function rankingsPath(league = "college-football"): string {
  return `/rankings/${encodeURIComponent(league)}`;
}

/** A bracket: the MLB postseason of a year, or a CS2 tournament; `ring` lights the originating match's teams. */
export type BracketSource = { readonly kind: "espnPostseason"; readonly path: string; readonly year: number } | { readonly kind: "csTournament"; readonly slug: string; readonly name: string };

export function bracketPath(source: BracketSource, ring: readonly (string | null)[] = []): string {
  const params = new URLSearchParams();
  const ids = ring.filter(Boolean);
  if (ids.length) params.set("ring", ids.join(","));
  let path: string;
  if (source.kind === "espnPostseason") {
    path = `/bracket/${source.path.split("/").pop() ?? "mlb"}/${source.year}`;
  } else {
    path = `/bracket/cs2/${encodeURIComponent(source.slug)}`;
    params.set("name", source.name);
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
