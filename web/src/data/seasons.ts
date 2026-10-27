/**
 * The two season sports' calendars: climbing competitions (IFSC) and CS2
 * S-tier tournaments (bo3.gg), and what the season pages say about them.
 * Ported from ScheduleProvider.swift (`IFSC`, `CS`), ScheduleStore.swift
 * (the season loads' rules), ScoreStore.swift (`tracked`,
 * `SeasonEvent.tracking`), SeasonTimeline.swift, SeasonCard.swift
 * (`SeasonSummary`, `SeasonAxis`, `SeasonDock`), ClimbingSeasonPage.swift
 * and TournamentsPage.swift (their `SeasonSummary` extensions), and
 * DockedScorebar.swift / PageGeometry.swift (the dock's math). Pure:
 * fetching lives in `state/seasons.ts`.
 *
 * CS2 match lists are parsed by `providers/schedule.ts` (`parseCSMatches`).
 *
 * Round times: the Mac reads them from World Climbing's YouTube schedule,
 * which isn't on the web's allowlist, so climbing rounds stay `tba` here.
 */
import { addingDays, compareDays, dayKeyFromISO, dayRangeLabel, daysBetween, shortDayLabel, startOfDay, weekdayLabel, type DayKey } from "./days";
import { plural } from "./format";
import { arr, at, bool, int, str, text, type JSONValue } from "./json";
import { abbreviate, TIER } from "./providers/counterStrike";
import { parseDate } from "./providers/espn";
import { BO3_API } from "./providers/schedule";
import { capitalized, competitionShortName } from "./providers/ifsc";
import { scheduleTeam, type ClimbingRound, type RoundLink, type ScheduleTeam, type SeasonCategory, type SeasonEvent, type SeasonEventStatus, type PodiumAthlete } from "./schedule";
import { disciplinesOf } from "./scoreboard";
import { flagFromIOC, flagFromISO, isoFromIOC } from "./teams";


// MARK: - Building

export type SeasonEventInit = Partial<SeasonEvent> & Pick<SeasonEvent, "id" | "kind" | "name" | "shortName" | "startDay" | "endDay" | "lanes" | "status">;

export function seasonEvent(e: SeasonEventInit): SeasonEvent {
  return {
    place: null,
    countryCode: null,
    startsAt: null,
    endsAt: null,
    timeZone: null,
    badge: null,
    prize: null,
    format: null,
    logo: null,
    categories: [],
    rounds: [],
    teams: [],
    registered: {},
    link: null,
    infoSheet: null,
    stages: 0,
    detailed: false,
    ...e,
  };
}

/** The flag of the event's country. */
export function eventFlag(e: SeasonEvent): string | null {
  return flagFromISO(e.countryCode);
}

/** "lead semi-final" → "Lead semi-final" */
export function capitalizedFirst(s: string): string {
  return s.slice(0, 1).toUpperCase() + s.slice(1);
}

/** The day at `ms` in UTC (bo3.gg's convention: tournament days are UTC dates). */
function utcDay(ms: number): DayKey {
  const d = new Date(ms);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

// MARK: - IFSC (climbing seasons)

export const IFSC_BASE = "https://ifsc.results.info";
export const IFSC_ROOT_URL = `${IFSC_BASE}/api/v1/`;
export const ifscSeasonURL = (id: number) => `${IFSC_BASE}/api/v1/seasons/${id}`;
export const ifscEventURL = (id: number) => `${IFSC_BASE}/api/v1/events/${id}`;
export const ifscRegistrationsURL = (id: number) => `${IFSC_BASE}/api/v1/events/${id}/registrations`;

export interface SeasonRef {
  readonly id: number;
  readonly name: string;
}

export interface SeasonList {
  readonly current: SeasonRef | null;
  readonly all: readonly SeasonRef[];
}

/** Seasons are addressed by ID, not year (`/seasons/2026` is a 404): the root lists them all and says which is current. */
export function parseSeasonRefs(root: JSONValue): SeasonList {
  const all = arr(at(root, "seasons"))
    .flatMap((s): SeasonRef[] => {
      const id = int(at(s, "id"));
      const name = str(at(s, "name"));
      return id != null && name ? [{ id, name }] : [];
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const currentID = int(at(root, "current", "id"));
  const currentName = str(at(root, "current", "season"));
  const current = all.find((s) => s.id === currentID) ?? all.find((s) => s.name === currentName) ?? null;
  return { current, all };
}

/** The current season and the one after it (by name), when published. */
export function currentAndNext(list: SeasonList): SeasonRef[] {
  if (!list.current) return list.all.slice(-2);
  const year = Number(list.current.name);
  const next = Number.isInteger(year) ? list.all.find((s) => s.name === String(year + 1)) : undefined;
  return [list.current, ...(next ? [next] : [])];
}

function lanesOf(disciplines: JSONValue): string[] {
  const lanes: string[] = [];
  for (const kind of arr(disciplines).flatMap((d) => str(at(d, "kind")) ?? [])) {
    const mapped = kind === "speed_relay" ? ["speed"] : kind === "boulder&lead" || kind === "combined" ? ["boulder", "lead"] : [kind];
    for (const lane of mapped) if (!lanes.includes(lane)) lanes.push(lane);
  }
  return lanes;
}

export function ifscStatus(startsAt: number | null, endsAt: number | null, now: number): SeasonEventStatus {
  if (startsAt == null || endsAt == null) return "upcoming";
  if (now < startsAt) return "upcoming";
  return now <= endsAt ? "live" : "finished";
}

/** World Cups and the World Championships (plus the Olympics), without cancelled, youth, continental or para events. */
export function parseSeasonEvents(json: JSONValue, now: number): SeasonEvent[] {
  // A season's leagues carry only a name and a URL; the ID is the URL's last part.
  const worldCup = new Set<number>();
  const games = new Set<number>();
  for (const league of arr(at(json, "leagues"))) {
    const name = str(at(league, "name"));
    const id = Number(str(at(league, "url"))?.split("/").pop());
    if (!name || !Number.isInteger(id)) continue;
    if (name.startsWith("World Cups")) worldCup.add(id);
    if (name === "Games") games.add(id);
  }
  return arr(at(json, "events"))
    .flatMap((e): SeasonEvent[] => {
      const id = int(at(e, "event_id"));
      const name = str(at(e, "event"));
      const leagueSeason = int(at(e, "league_season_id"));
      if (id == null || !name || leagueSeason == null) return [];
      const olympic = games.has(leagueSeason) && name.includes("Olympic Games");
      const first = dayKeyFromISO(str(at(e, "local_start_date")));
      const last = dayKeyFromISO(str(at(e, "local_end_date")));
      if (!(worldCup.has(leagueSeason) || olympic) || name.toLowerCase().includes("cancelled") || bool(at(e, "is_paraclimbing_event")) === true || !first || !last) return [];
      const startsAt = parseDate(str(at(e, "starts_at")));
      const endsAt = parseDate(str(at(e, "ends_at")));
      return [
        seasonEvent({
          id: `ifsc-${id}`,
          kind: { kind: "climbing", id },
          name,
          shortName: competitionShortName(name),
          place: str(at(e, "location")) ?? null,
          countryCode: isoFromIOC(str(at(e, "country"))),
          startDay: first,
          endDay: last,
          startsAt,
          endsAt,
          timeZone: str(at(e, "timezone", "value")) ?? null,
          lanes: lanesOf(at(e, "disciplines")),
          badge: olympic ? "Olympic Games" : name.includes("Championship") ? "World Championships" : null,
          status: ifscStatus(startsAt, endsAt, now),
          link: `${IFSC_BASE}/event/${id}`,
          infoSheet: text(at(e, "infosheet_url")) ?? null,
        }),
      ];
    })
    .sort((a, b) => compareDays(a.startDay, b.startDay));
}

/** Statuses move with the clock, not the cache (SeasonResults.clocked). */
export function clocked(events: readonly SeasonEvent[], now: number): SeasonEvent[] {
  return events.map((e) => {
    if (e.kind.kind !== "climbing" || e.status === "canceled") return e;
    const status = ifscStatus(e.startsAt, e.endsAt, now);
    return status === e.status ? e : { ...e, status };
  });
}

/** The competition still to come (or underway) soonest. */
export function nextEvent(events: readonly SeasonEvent[], now: number): SeasonEvent | null {
  let best: SeasonEvent | null = null;
  for (const e of events) {
    if ((e.endsAt ?? startOfDay(e.endDay)) <= now) continue;
    if (!best || compareDays(e.startDay, best.startDay) < 0) best = e;
  }
  return best;
}

const ROUND_ORDER: Readonly<Record<string, number>> = { qualification: 0, "semi-final": 1, final: 2 };

/** Categories, rounds (same-named rounds of one discipline merge: "Lead semi-final · Men, Women") and podiums, from `/events/{id}`. */
export function parseEvent(json: JSONValue, into: SeasonEvent): SeasonEvent {
  const rounds: { round: ClimbingRound; order: number }[] = [];
  const categories: SeasonCategory[] = [];
  for (const cat of arr(at(json, "d_cats"))) {
    const raw = str(at(cat, "dcat_name")) ?? ""; // "LEAD Women"
    const space = raw.indexOf(" ");
    const discipline = capitalized(space >= 0 ? raw.slice(0, space) : raw); // "Lead"
    const gender = space >= 0 ? raw.slice(space + 1) : ""; // "Women"
    const podium = arr(at(cat, "top_3_results")).flatMap((a) => {
      const last = str(at(a, "lastname"));
      if (!last) return [];
      return [[str(at(a, "country")), capitalized(last)].filter(Boolean).join(" ")];
    });
    // Results: the category's ID (its full results), its rounds (each opens
    // the match page) and the podium with athlete IDs.
    const links = arr(at(cat, "category_rounds")).flatMap((r): RoundLink[] => {
      const id = int(at(r, "category_round_id"));
      if (id == null) return [];
      return [{ id, name: str(at(r, "name")) ?? "Round", status: str(at(r, "status")) ?? "pending", resultPath: str(at(r, "result_url")) ?? null }];
    });
    const athletes = arr(at(cat, "top_3_results")).flatMap((a): PodiumAthlete[] => {
      const id = int(at(a, "athlete_id"));
      const rank = int(at(a, "rank"));
      const last = str(at(a, "lastname"));
      if (id == null || rank == null || !last) return [];
      return [{ athleteID: id, rank, first: str(at(a, "firstname")) ?? "", last: capitalized(last), country: str(at(a, "country")) ?? null }];
    });
    categories.push({ name: `${discipline} ${gender}`.trim(), podium, dcatID: int(at(cat, "dcat_id")) ?? null, rounds: links, podiumAthletes: athletes });
    for (const r of arr(at(cat, "category_rounds"))) {
      const name = str(at(r, "name")) ?? "Round";
      const status = str(at(r, "status")) ?? "pending";
      const existing = rounds.find((x) => x.round.discipline === discipline && x.round.name === name);
      if (existing) {
        let { categories: cats, status: st } = existing.round;
        if (gender && !cats.includes(gender)) cats = [...cats, gender];
        if (status === "active" || (status === "finished" && st === "pending")) st = status;
        existing.round = { ...existing.round, categories: cats, status: st };
      } else {
        rounds.push({ round: { name, discipline, categories: gender ? [gender] : [], start: { kind: "tba" }, stream: null, status }, order: rounds.length });
      }
    }
  }
  const sorted = [...rounds].sort((a, b) => {
    const ra = ROUND_ORDER[a.round.name.toLowerCase()] ?? 1;
    const rb = ROUND_ORDER[b.round.name.toLowerCase()] ?? 1;
    return ra !== rb ? ra - rb : a.order - b.order;
  });
  return { ...into, rounds: sorted.map((x) => x.round), categories, detailed: true, infoSheet: text(at(json, "infosheet_url")) ?? into.infoSheet };
}

/** The detail `parseEvent` adds, copied onto the competition as it is now. */
export function withDetail(parsed: SeasonEvent, into: SeasonEvent): SeasonEvent {
  return { ...into, rounds: parsed.rounds, categories: parsed.categories, infoSheet: parsed.infoSheet ?? into.infoSheet, detailed: true };
}

/** Confirmed athletes per highlighted country (IOC codes). The response is a bare array. */
export function parseRegistrations(json: JSONValue, countries: ReadonlySet<string>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const athlete of arr(json)) {
    const country = str(at(athlete, "country"));
    if (!country || !countries.has(country)) continue;
    if (!arr(at(athlete, "d_cats")).some((d) => str(at(d, "status")) === "confirmed")) continue;
    counts[country] = (counts[country] ?? 0) + 1;
  }
  return counts;
}

/** Whether the calendar wants a competition's detail loaded on its own: what's live or within two weeks (ScheduleStore.loadClimbing). */
export function wantsDetail(e: SeasonEvent, today: DayKey): boolean {
  return e.status === "live" || (e.status === "upcoming" && daysBetween(today, e.startDay) <= 14);
}

// MARK: - The disciplines you follow (ScoreStore.tracked, SeasonEvent.tracking)

/**
 * A climbing competition cut to the disciplines you follow: their lanes,
 * categories and rounds only, or null when it has none of them. One that
 * doesn't list its disciplines (a CS2 event, a bare calendar entry) stays as it is.
 */
export function tracking(e: SeasonEvent, disciplines: readonly string[]): SeasonEvent | null {
  if (e.kind.kind !== "climbing" || e.lanes.length === 0) return e;
  const kept = e.lanes.filter((l) => disciplines.includes(l));
  if (kept.length === 0) return null;
  const follows = (name: string) => {
    const found = disciplinesOf(name);
    return found == null || [...found].some((d) => disciplines.includes(d));
  };
  const categories = e.categories.filter((c) => follows(c.name));
  const rounds = e.rounds.filter((r) => follows(r.discipline));
  if (kept.length === e.lanes.length && categories.length === e.categories.length && rounds.length === e.rounds.length) return e;
  return { ...e, lanes: kept, categories, rounds };
}

/** Competitions as far as the disciplines shown go (the others don't appear at all). */
export function tracked(events: readonly SeasonEvent[], disciplines: readonly string[]): SeasonEvent[] {
  return events.flatMap((e) => tracking(e, disciplines) ?? []);
}

// MARK: - bo3.gg (CS2 tournaments and matches)

export { BO3_API };

/** S-tier tournaments by status ("current", "upcoming"), soonest first. */
export function tournamentsURL(status: string): string {
  const url = new URL(`${BO3_API}/tournaments`);
  url.searchParams.set("filter[tournaments.discipline_id][eq]", "1");
  url.searchParams.set("filter[tournaments.status][in]", status);
  url.searchParams.set("filter[tournaments.tier][in]", TIER);
  url.searchParams.set("sort", "start_date");
  url.searchParams.set("page[limit]", "50");
  return url.href;
}

export function tournamentURL(slug: string): string {
  return `${BO3_API}/tournaments/${encodeURIComponent(slug)}`;
}

export function parseTournaments(json: JSONValue): SeasonEvent[] {
  return arr(at(json, "results")).flatMap((t) => tournament(t) ?? []);
}

export function tournament(t: JSONValue): SeasonEvent | null {
  const slug = str(at(t, "slug"));
  const name = str(at(t, "name"));
  const start = parseDate(str(at(t, "start_date")));
  if (!slug || !name || start == null) return null;
  const end = parseDate(str(at(t, "end_date"))) ?? start;
  const raw = str(at(t, "status"));
  const status: SeasonEventStatus = raw === "current" ? "live" : raw === "finished" ? "finished" : raw === "canceled" ? "canceled" : "upcoming";
  const type = str(at(t, "event_type"));
  return seasonEvent({
    id: `cs-t-${slug}`,
    kind: { kind: "tournament", slug },
    name,
    shortName: csShortName(name),
    place: str(at(t, "country", "name")) ?? null,
    countryCode: str(at(t, "country", "code")) ?? null,
    // bo3.gg's own convention: tournament days are UTC dates.
    startDay: utcDay(start),
    endDay: utcDay(end),
    startsAt: start,
    endsAt: end,
    lanes: [TIER],
    badge: name.includes("Major") ? "Major" : null,
    prize: int(at(t, "prize")) ?? null,
    format: type ? (type === "lan" ? "LAN" : capitalized(type)) : null,
    logo: str(at(t, "image_url")) ?? null,
    status,
    link: `https://bo3.gg/tournaments/${slug}`,
  });
}

/** "Intel Extreme Masters Beijing 2026" → "IEM Beijing": the name fans use, without the year its dates already give. */
export function csShortName(name: string): string {
  let s = name.replaceAll("Intel Extreme Masters ", "IEM ");
  const last = s.split(" ").pop() ?? "";
  if (/^\d{4}$/.test(last) && s.length > 5) s = s.slice(0, -5);
  return s;
}

/** The detail `parseTournament` adds, copied onto the tournament as it is now. */
export function withTournamentDetail(parsed: SeasonEvent, into: SeasonEvent): SeasonEvent {
  return {
    ...into,
    place: parsed.place ?? into.place,
    countryCode: parsed.countryCode ?? into.countryCode,
    badge: parsed.badge === "Major" ? "Major" : into.badge,
    stages: parsed.stages,
    teams: parsed.teams,
    detailed: true,
  };
}

/** Country, city, teams and the Major series, from `/tournaments/{slug}`. */
export function parseTournament(json: JSONValue, into: SeasonEvent): SeasonEvent {
  const country = str(at(json, "country", "name"));
  const teams = arr(at(json, "teams"))
    .flatMap((team): ScheduleTeam[] => {
      const id = int(at(team, "id"));
      const name = str(at(team, "name"));
      if (id == null || !name) return [];
      return [scheduleTeam({ id: `cs-${id}`, name, abbreviation: abbreviate(name), logo: str(at(team, "image_url")) ?? null, rank: int(at(team, "rank")) ?? null })];
    })
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
  return {
    ...into,
    place: country ? [str(at(json, "city", "name")), country].filter(Boolean).join(", ") : into.place,
    countryCode: str(at(json, "country", "code")) ?? into.countryCode,
    badge: str(at(json, "series", "slug")) === "cs2-major" ? "Major" : into.badge,
    stages: arr(at(json, "stages")).length,
    teams,
    detailed: true,
  };
}

/** How many of bo3.gg's world top 10 are in the field. */
export function topTen(teams: readonly ScheduleTeam[]): number {
  return teams.filter((t) => (t.rank ?? Infinity) <= 10).length;
}

/** "$1.25M", "$100K", "$750" */
export function prize(amount: number | null | undefined): string | null {
  if (amount == null || amount <= 0) return null;
  if (amount >= 1_000_000) {
    const m = amount / 1_000_000;
    return `$${m === Math.round(m) ? String(m) : m.toFixed(2).replace(/0$/, "")}M`;
  }
  if (amount >= 1_000) return `$${Math.floor(amount / 1_000)}K`;
  return `$${amount}`;
}

/** Whether a tournament opens its bracket (drawn) rather than in place (ScheduleStore/TournamentsPage). */
export function isDrawn(e: SeasonEvent): boolean {
  return e.status !== "upcoming" || e.stages > 0;
}

// MARK: - The season at a glance (SeasonCard.swift)

/** The season at a glance, in two lines. */
export interface SeasonSummary {
  /** "Next: 🇯🇵 Tokyo", "Live now · 🇨🇱 Santiago", "2026 season complete". */
  readonly headline: string;
  /** "Apr 9–11 · in 165 days", "10 competitions". */
  readonly subline: string | null;
  /** Something's underway: a live dot leads the headline. */
  readonly live: boolean;
  /** The subline is happening now (a live match): it's red. */
  readonly sublineLive: boolean;
}

export function summary(headline: string, subline: string | null = null, live = false, sublineLive = false): SeasonSummary {
  return { headline, subline, live, sublineLive };
}

/** "starts today", "starts tomorrow", "starts Saturday", "in 12 days". */
export function whenText(start: DayKey, today: DayKey): string {
  const days = daysBetween(today, start);
  if (days <= 0) return "starts today";
  if (days === 1) return "starts tomorrow";
  if (days <= 6) return `starts ${new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(new Date(start.year, start.month - 1, start.day, 12))}`;
  return `in ${days} days`;
}

/**
 * Climbing's Upcoming card: what's live, else what's next (between seasons,
 * that the last one is done), else that this one is.
 */
export function climbingSummary(live: SeasonEvent | null, next: SeasonEvent | null, previousSeasonOver: string | null, today: DayKey): SeasonSummary {
  if (live) {
    const active = live.rounds.find((r) => r.status === "active");
    const line = active
      ? `${capitalizedFirst(`${active.discipline} ${active.name.toLowerCase()}`)} underway`
      : [dayRangeLabel(live.startDay, live.endDay), live.lanes.map(capitalized).join(" · ")].join(" · ");
    const flag = eventFlag(live);
    return summary(`Live now · ${flag ? `${flag} ` : ""}${live.shortName}`, line, true);
  }
  if (!next) return summary("Season complete", "The next calendar isn't published yet.");
  const days = daysBetween(today, next.startDay);
  if (previousSeasonOver) {
    return summary(`${previousSeasonOver} season complete`, `${next.startDay.year} starts ${shortDayLabel(next.startDay)} in ${next.shortName} · ${days} days`);
  }
  const flag = eventFlag(next);
  return summary(`Next: ${flag ? `${flag} ` : ""}${next.shortName}`, [dayRangeLabel(next.startDay, next.endDay), whenText(next.startDay, today)].join(" · "));
}

/** The season before `next`'s is finished and this one hasn't started (ClimbingSeasonPage.previousSeasonOver). */
export function previousSeasonOver(live: SeasonEvent | null, next: SeasonEvent | null, seasons: readonly string[], events: Readonly<Record<string, readonly SeasonEvent[]>>): string | null {
  if (live || !next) return null;
  const previous = seasons.find((s) => s < String(next.startDay.year));
  if (!previous) return null;
  return (events[previous] ?? []).every((e) => e.status !== "upcoming") ? previous : null;
}

/** The text of a competition as the timeline's readout gives it: "Tokyo · Apr 9–11 · Boulder, Lead · World Championships". */
export function climbingReadout(e: SeasonEvent): string {
  return [e.shortName, dayRangeLabel(e.startDay, e.endDay), e.lanes.map(capitalized).join(", "), e.badge].filter(Boolean).join(" · ");
}

/** CS2's Upcoming card while a tournament is underway: its name, then its next match (red while live), else its dates and prize. */
export function tournamentsLiveSummary(live: SeasonEvent, match: { readonly state: "live" | "scheduled" | "final"; readonly teams: readonly string[]; readonly when: string } | null): SeasonSummary {
  let line: string | null = null;
  if (match) {
    const teams = match.teams.join(" v ");
    if (match.state === "live") line = `Live: ${teams}`;
    else if (match.state === "scheduled") line = `Next: ${teams} · ${match.when}`;
  }
  return summary(
    `Live now · ${live.shortName}`,
    line ?? [dayRangeLabel(live.startDay, live.endDay), prize(live.prize)].filter(Boolean).join(" · "),
    true,
    match?.state === "live",
  );
}

/** CS2's Upcoming card: the next S-tier tournament, when and for how much. */
export function tournamentsNextSummary(next: SeasonEvent | null, today: DayKey): SeasonSummary {
  if (!next) return summary("No S-tier tournaments ahead");
  return summary(`Next: ${next.shortName}`, [dayRangeLabel(next.startDay, next.endDay), whenText(next.startDay, today), prize(next.prize)].filter(Boolean).join(" · "));
}

/** "IEM Beijing · Nov 2–7 · $1.25M" */
export function tournamentReadout(e: SeasonEvent): string {
  return [e.shortName, dayRangeLabel(e.startDay, e.endDay), prize(e.prize)].filter(Boolean).join(" · ");
}

/** Climbing's Results card: "2026 season complete · 10 competitions"; mid-season, how far along. */
export function resultsSummary(season: string | null, finished: number, total: number): SeasonSummary {
  const name = season ?? "";
  if (finished === total) return summary(`${name} season complete`, plural(total, "competition"));
  return summary(`${name} season`, `${finished} of ${plural(total, "competition")} finished`);
}

/** CS2's Results card: how many S-tier tournaments are listed, and since when. Grows with Show Earlier. */
export function tournamentResultsSummary(events: readonly SeasonEvent[]): SeasonSummary {
  if (events.length === 0) return summary("No S-tier results yet");
  const first = events.reduce((a, e) => (compareDays(e.startDay, a) < 0 ? e.startDay : a), events[0]!.startDay);
  const since = new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric" }).format(new Date(first.year, first.month - 1, 15, 12));
  return summary(`${events.length} S-tier ${events.length === 1 ? "tournament" : "tournaments"}`, `Since ${since}`);
}

export interface TimelineLane {
  readonly id: string;
  readonly label: string;
}

export const CLIMBING_LANES: readonly TimelineLane[] = [
  { id: "boulder", label: "Boulder" },
  { id: "lead", label: "Lead" },
  { id: "speed", label: "Speed" },
];

export const S_TIER_LANE: readonly TimelineLane[] = [{ id: TIER, label: "S-Tier" }];

/** The season on one axis, as the card's timeline and the bar's strip draw it. */
export interface SeasonAxis {
  readonly events: readonly SeasonEvent[];
  readonly lanes: readonly TimelineLane[];
  readonly today: DayKey;
  /** The next competition (accent), when nothing is live. */
  readonly next: string | null;
  /** The one open beside the list (split panel). */
  readonly selected: string | null;
  /** Each competition's one line ("Santiago · Oct 23–25 · 🥇 Utelli, Garnbret"). */
  readonly readouts: Readonly<Record<string, string>>;
  /** Whose line shows with nothing under the pointer. */
  readonly resting: string | null;
}

/** The readout: the competition under the pointer (in the timeline, the strip or the list), else the resting one. */
export function readout(axis: SeasonAxis, hovered: string | null): string | null {
  return (hovered != null ? axis.readouts[hovered] : undefined) ?? (axis.resting != null ? axis.readouts[axis.resting] : undefined) ?? null;
}

// MARK: - The timeline's geometry (SeasonTimeline.swift, pure)

export const TIMELINE = { laneHeight: 16, markHeight: 6, labelWidth: 54, axisHeight: 16 } as const;
export const DOCK = { barHeight: 50, reserve: 62, stripHeight: 10, stripMark: 5 } as const;

export interface Mark {
  readonly event: string;
  readonly lane: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const firstOfMonth = (d: DayKey): DayKey => ({ year: d.year, month: d.month, day: 1 });
const nextMonth = (d: DayKey): DayKey => (d.month === 12 ? { year: d.year + 1, month: 1, day: 1 } : { year: d.year, month: d.month + 1, day: 1 });

/** From the first day of the first event's month to the last day of the last event's month. */
export function timelineDomain(events: readonly SeasonEvent[], today: DayKey): readonly [DayKey, DayKey] {
  if (events.length === 0) return [today, addingDays(today, 30)];
  let first = events[0]!.startDay;
  let last = events[0]!.endDay;
  for (const e of events) {
    if (compareDays(e.startDay, first) < 0) first = e.startDay;
    if (compareDays(e.endDay, last) > 0) last = e.endDay;
  }
  return [firstOfMonth(first), addingDays(nextMonth(last), -1)];
}

export function timelineX(day: DayKey, domain: readonly [DayKey, DayKey], width: number): number {
  const total = Math.max(daysBetween(domain[0], domain[1]) + 1, 1);
  return (daysBetween(domain[0], day) / total) * width;
}

/** The first of each month inside the domain, for ticks. */
export function monthsOf(domain: readonly [DayKey, DayKey]): DayKey[] {
  const out: DayKey[] = [];
  for (let m = firstOfMonth(domain[0]); compareDays(m, domain[1]) <= 0; m = nextMonth(m)) out.push(m);
  return out;
}

/** Mark rectangles in plot coordinates: at least 6pt wide, and 2pt clear of the previous mark in the same lane. */
export function timelineLayout(events: readonly SeasonEvent[], lanes: readonly TimelineLane[], domain: readonly [DayKey, DayKey], width: number): Mark[] {
  const marks: Mark[] = [];
  lanes.forEach((lane, row) => {
    let lastMaxX = -Infinity;
    const inLane = events.filter((e) => e.lanes.includes(lane.id)).sort((a, b) => compareDays(a.startDay, b.startDay));
    for (const e of inLane) {
      const x0 = Math.max(timelineX(e.startDay, domain, width), lastMaxX + 2);
      const x1 = timelineX(addingDays(e.endDay, 1), domain, width);
      const w = Math.max(x1 - x0, 6);
      const mark = { event: e.id, lane: lane.id, x: x0, y: row * TIMELINE.laneHeight + (TIMELINE.laneHeight - TIMELINE.markHeight) / 2, width: w, height: TIMELINE.markHeight };
      marks.push(mark);
      lastMaxX = x0 + w;
    }
  });
  return marks;
}

/** The mark under the pointer (with a little slack), else the nearest within 10pt in its lane. */
export function timelineHit(marks: readonly Mark[], x: number, y: number, laneHeight: number = TIMELINE.laneHeight): string | null {
  const direct = marks.find((m) => x >= m.x - 3 && x <= m.x + m.width + 3 && y >= m.y - 5 && y <= m.y + m.height + 5);
  if (direct) return direct.event;
  let best: Mark | null = null;
  for (const m of marks) {
    if (Math.abs(m.y + m.height / 2 - y) > laneHeight / 2) continue;
    if (!best || Math.abs(m.x + m.width / 2 - x) < Math.abs(best.x + best.width / 2 - x)) best = m;
  }
  return best && Math.abs(best.x + best.width / 2 - x) <= 10 ? best.event : null;
}

/** The strip's marks: every competition on one lane, whatever its disciplines, at least 4pt wide and 1.5pt clear of the one before. */
export function dockStrip(events: readonly SeasonEvent[], domain: readonly [DayKey, DayKey], width: number): Mark[] {
  const marks: Mark[] = [];
  let lastMaxX = -Infinity;
  for (const e of [...events].sort((a, b) => compareDays(a.startDay, b.startDay))) {
    const x0 = Math.max(timelineX(e.startDay, domain, width), lastMaxX + 1.5);
    const x1 = timelineX(addingDays(e.endDay, 1), domain, width);
    const w = Math.max(x1 - x0, 4);
    marks.push({ event: e.id, lane: "", x: x0, y: (DOCK.stripHeight - DOCK.stripMark) / 2, width: w, height: DOCK.stripMark });
    lastMaxX = x0 + w;
  }
  return marks;
}

/** The bar's line: the competition under the pointer when there is one, else the headline and its subline. */
export function dockLine(s: SeasonSummary, hovered: string | null, axis: SeasonAxis): { readonly lead: string; readonly trail: string | null } {
  const r = hovered != null ? axis.readouts[hovered] : undefined;
  if (r) return { lead: r, trail: null };
  return { lead: s.headline, trail: s.subline };
}

// MARK: - The dock (PageGeometry.swift, DockedScorebar.swift `DockRules`)

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * How far the card has docked, in steps of 1/64, from how far it has slid
 * under the header (`under`, points: 0 when its top meets the header's
 * bottom) and its height. Docking starts a quarter of the way under and is
 * done three quarters in (PageGeometry.dockStep).
 */
export function dockProgress(under: number, height: number): number {
  const start = 0.25 * height;
  const travel = Math.max(0.75 * height - 4, 24);
  const p = Math.min(Math.max((under - start) / travel, 0), 1);
  return Math.round(p * 64) / 64;
}

/** The card tucking under the header: shrinks 6% toward its top edge and fades (DockRules.heroTuck). */
export function heroTuck(under: number, height: number): { readonly scale: number; readonly opacity: number } {
  if (height <= 0) return { scale: 1, opacity: 1 };
  const t = Math.min(Math.max(under / (0.75 * height), 0), 1);
  const s = Math.min(Math.max((t - 0.35) / 0.45, 0), 1);
  return { scale: 1 - 0.06 * t, opacity: 1 - s * s * (3 - 2 * s) };
}

/** The bar settling in at dock progress `p`: from 96% and 6pt up, fading in over 0.35…0.9, taking clicks from half docked. */
export function barMotion(p: number): { readonly opacity: number; readonly scale: number; readonly offset: number; readonly interactive: boolean } {
  const c = Math.min(Math.max(p, 0), 1);
  return { opacity: p <= 0 ? 0 : smoothstep(0.35, 0.9, p), scale: 0.96 + 0.04 * c, offset: 6 * (c - 1), interactive: p >= 0.5 };
}

// MARK: - Months

/** Months in order, each keeping the list's order (`newestFirst`: what results pages show). */
export function byMonth<T>(items: readonly T[], day: (item: T) => DayKey, newestFirst = false): { readonly month: DayKey; readonly items: readonly T[] }[] {
  const groups = new Map<string, { month: DayKey; items: T[] }>();
  for (const item of items) {
    const d = day(item);
    const key = `${d.year}-${d.month}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { month: { year: d.year, month: d.month, day: 1 }, items: [] }));
    g.items.push(item);
  }
  return [...groups.values()].sort((a, b) => (newestFirst ? -1 : 1) * compareDays(a.month, b.month));
}

/** "Sun" → for the readout helpers that need a weekday. */
export const weekdayShort = (d: DayKey) => weekdayLabel(d);

/** IOC code → flag, for podium lines ("SLO Garnbret" → "🇸🇮 Garnbret"). */
export function podiumEntry(entry: string): string {
  const space = entry.indexOf(" ");
  if (space < 0) return entry;
  const code = entry.slice(0, space);
  return `${flagFromIOC(code) ?? code} ${entry.slice(space + 1)}`;
}
