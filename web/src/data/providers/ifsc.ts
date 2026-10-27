/**
 * Climbing from the IFSC results service (World Climbing). A port of
 * Providers.swift `IFSC` (rows per category while a competition is on, else
 * the next competition) and, for the off-season, ScheduleProvider.swift
 * `IFSC.nextSeasonOpener` with the season parsing it needs.
 *
 * The service answers only with its own Referer, which the proxy adds
 * (shared/upstreams.ts). Seasons are addressed by ID, not year.
 */
import { dayKeyFromISO, dayRangeLabel, compareDays, startOfDay, type DayKey } from "../days";
import { ordinal } from "../format";
import { arr, at, bool, int, str, type JSONValue } from "../json";
import { resolveURL, type Fetcher } from "../http";
import type { EventState, LiveSnapshot, ScoreEvent } from "../models";
import { flagFromIOC, isoFromIOC } from "../teams";
import { capitalized, wallStateFrom } from "../wallState";
import { parseDate } from "./espn";

export const IFSC_BASE = "https://ifsc.results.info";
const ROOT = `${IFSC_BASE}/api/v1/`;
/** World Cups & World Championships. */
const WORLD_CUP_LEAGUE = 1;
const HOUR = 3_600_000;

const abs = (path: string) => resolveURL(path, IFSC_BASE);

// MARK: - Scores

export async function fetchClimbing(countries: readonly string[], fetcher: Fetcher, signal?: AbortSignal, now = Date.now()): Promise<ScoreEvent[]> {
  const root = await fetcher(ROOT, { signal });
  const seasonPath = str(at(root, "current", "url"));
  const leagueSeason = int(at(arr(at(root, "current", "leagues")).find((l) => int(at(l, "league_id")) === WORLD_CUP_LEAGUE), "id"));
  if (!seasonPath || leagueSeason == null) return [];

  const season = await fetcher(abs(seasonPath), { signal });
  const comps = arr(at(season, "events")).filter(
    (e) => int(at(e, "league_season_id")) === leagueSeason && !(str(at(e, "event")) ?? "").toLowerCase().includes("cancelled"),
  );

  const output: ScoreEvent[] = [];
  // Events underway, or finished within the last day, are shown round by round.
  const active = comps.filter((c) => {
    const s = parseDate(str(at(c, "starts_at")));
    const e = parseDate(str(at(c, "ends_at")));
    return s != null && e != null && s <= now && now <= e + 24 * HOUR;
  });
  for (const comp of active) output.push(...(await categoryEvents(comp, countries, fetcher, signal, now)));

  if (output.length > 0) return output;

  // Otherwise surface the next competition so the section isn't empty. Once
  // the season is over, that's the next season's opener.
  const allStarted = comps.every((c) => (parseDate(str(at(c, "starts_at"))) ?? -Infinity) <= now);
  if (allStarted) {
    const opener = await nextSeasonOpener(root, fetcher, signal, now);
    return opener ? [opener] : [];
  }
  const next = comps
    .flatMap((c) => {
      const start = parseDate(str(at(c, "starts_at")));
      return start != null && start > now ? [{ c, start }] : [];
    })
    .sort((a, b) => a.start - b.start)[0];
  if (!next) return [];
  const eventID = int(at(next.c, "event_id")) ?? 0;
  const name = roundEventName(str(at(next.c, "event")));
  return [
    blankEvent({
      id: `ifsc-${eventID}`,
      content: { kind: "field", title: name, summary: str(at(next.c, "location")) ?? "" },
      state: "scheduled",
      start: next.start,
      link: `${IFSC_BASE}/event/${eventID}`,
      ref: { kind: "climbing", eventID, category: "", resultURL: null, round: null, eventName: name, nextURL: null },
    }),
  ];
}

/** One row per category (in the event's order), each read in parallel; a failed category drops out. */
async function categoryEvents(comp: JSONValue, countries: readonly string[], fetcher: Fetcher, signal: AbortSignal | undefined, now: number): Promise<ScoreEvent[]> {
  const eventID = int(at(comp, "event_id")) ?? 0;
  const detail = await fetcher(abs(`/api/v1/events/${eventID}`), { signal });
  const start = parseDate(str(at(comp, "starts_at"))) ?? now;
  const cats = arr(at(detail, "d_cats"));
  const results = await Promise.allSettled(cats.map((cat, index) => categoryEvent(cat, comp, start, index, countries, fetcher, signal, now)));
  return results.flatMap((r) => (r.status === "fulfilled" && r.value ? [r.value] : []));
}

interface Round {
  readonly name: string | undefined;
  readonly status: string | undefined;
  readonly statusAsOf: string | undefined;
  readonly resultURL: string | undefined;
}

/** A category's row: its round underway (or last, or next), the leader and your best-placed athlete. */
export async function categoryEvent(
  cat: JSONValue,
  comp: JSONValue,
  start: number,
  index: number,
  countries: readonly string[],
  fetcher: Fetcher,
  signal: AbortSignal | undefined,
  now: number,
): Promise<ScoreEvent | null> {
  const rounds: Round[] = arr(at(cat, "category_rounds")).map((r) => ({
    name: str(at(r, "name")),
    status: str(at(r, "status")),
    statusAsOf: str(at(r, "status_as_of")),
    resultURL: str(at(r, "result_url")),
  }));
  if (rounds.length === 0) return null;

  // A round counts as live only if upstream touched it recently; stale
  // "active" flags linger for days after some rounds finish.
  const live = rounds.find((r) => {
    if (r.status !== "active") return false;
    const asOf = parseDate(r.statusAsOf);
    return asOf == null ? true : asOf > now - 12 * HOUR;
  });
  const lastFinished = [...rounds].reverse().find((r) => r.status === "finished");
  const next = rounds.find((r) => r.status !== "finished" && r.name !== live?.name);

  // Upstream occasionally leaves a round "active" after the event wraps up.
  const endsAt = parseDate(str(at(comp, "ends_at")));
  const ended = endsAt != null && endsAt < now;
  const state: EventState = live && !ended ? "live" : !next || ended ? "final" : "scheduled";
  const focus = live ?? lastFinished;

  const short = (first: string | undefined, last: string | undefined) => `${first ? `${[...first][0]}. ` : ""}${capitalized(last ?? "")}`;
  let leader: string | null = null;
  let yours: string | null = null;
  let snapshot: LiveSnapshot | null = null;
  if (focus?.resultURL) {
    const results = await fetcher(abs(focus.resultURL), { signal });
    // Read leniently: the same response also says who's on the wall, for tiles.
    if (state === "live") {
      const wall = wallStateFrom(results);
      if (wall) snapshot = { kind: "climbing", wall };
    }
    // No ranking yet (a round not underway): no leader.
    const ranking = arr(at(results, "ranking")).map((a) => ({
      rank: int(at(a, "rank")),
      firstname: str(at(a, "firstname")),
      lastname: str(at(a, "lastname")),
      country: str(at(a, "country")),
    }));
    const first = ranking.find((a) => a.rank === 1);
    if (first) leader = [flagFromIOC(first.country), short(first.firstname, first.lastname)].filter(Boolean).join(" ");
    // Best-placed athlete from the user's countries, e.g. "🇺🇸 J. Grupper 7th in qualification".
    const i = ranking.findIndex((a) => a.country != null && countries.includes(a.country));
    if (i >= 0) {
      const athlete = ranking[i]!;
      const place = athlete.rank ?? i + 1;
      const round = focus.name ? ` in ${focus.name.toLowerCase()}` : "";
      yours = [flagFromIOC(athlete.country) ?? athlete.country, short(athlete.firstname, athlete.lastname), ordinal(place) + round].filter(Boolean).join(" ");
    }
  }

  const round = focus?.name ?? next?.name ?? "";
  let summary: string;
  if (state === "live") summary = [round, leader ? `Leader ${leader}` : null].filter(Boolean).join(" · ");
  else if (state === "final") summary = leader ? `Winner ${leader}` : "Finished";
  // Standings for the finished round are one click away on the detail page.
  else summary = next ? `${next.name ?? "Next round"} next` : "";

  const eventID = int(at(comp, "event_id")) ?? 0;
  const category = capitalized(str(at(cat, "dcat_name")) ?? "");
  const eventName = roundEventName(str(at(comp, "event")));
  return blankEvent({
    id: `ifsc-${eventID}-${index}`,
    content: { kind: "field", title: category, summary },
    state,
    start,
    detail: state === "final" ? "Final" : null,
    caption: [eventName, yours].filter(Boolean).join(" · "),
    link: `${IFSC_BASE}/event/${eventID}`,
    ref: {
      kind: "climbing",
      eventID,
      category,
      resultURL: focus?.resultURL ?? null,
      round: (live ?? next)?.name ?? null,
      eventName,
      nextURL: live ? null : (next?.resultURL ?? null),
    },
    snapshot,
  });
}

/** Swift's `String.capitalized` (data/wallState.ts, which tiles read without this module's season code). */
export { capitalized };

/** "World Climbing Series Santiago 2026" → "Santiago 2026" (Providers.swift `IFSC.shortName`). */
export function roundEventName(name: string | undefined): string {
  if (!name) return "";
  for (const prefix of ["IFSC World Cup ", "World Climbing Series ", "IFSC "]) {
    if (name.startsWith(prefix)) return name.slice(prefix.length);
  }
  return name;
}

// MARK: - The off-season's next opener (ScheduleProvider.swift `IFSC`)

/** A competition in a season's calendar (a subset of Swift's `SeasonEvent`, `.climbing` kind). */
export interface ClimbingCompetition {
  readonly eventID: number;
  /** "World Climbing Series Tokyo 2027" */
  readonly name: string;
  /** "Tokyo" */
  readonly shortName: string;
  /** "Tokyo, Japan" */
  readonly place: string | null;
  /** ISO alpha-2, for the flag. */
  readonly countryCode: string | null;
  /** Venue-local dates, never converted. */
  readonly startDay: DayKey;
  readonly endDay: DayKey;
  readonly startsAt: number | null;
  readonly endsAt: number | null;
  readonly timeZone: string | null;
  /** "boulder", "lead", "speed". */
  readonly lanes: readonly string[];
  /** "World Championships", "Olympic Games". */
  readonly badge: string | null;
  readonly link: string;
}

/**
 * "World Climbing Series Tokyo 2027" → "Tokyo"; "World Climbing Championship
 * Brno 2027" → "Brno"; "Olympic Games LA28" → "LA28".
 */
export function competitionShortName(name: string): string {
  let s = name;
  for (const prefix of [
    "World Climbing Series ",
    "IFSC World Cup ",
    "World Climbing Championship ",
    "IFSC Climbing World Championships ",
    "IFSC ",
    "Olympic Games ",
    "World Climbing ",
  ]) {
    if (s.startsWith(prefix)) {
      s = s.slice(prefix.length);
      break;
    }
  }
  const last = s.split(" ").pop() ?? "";
  if (/^\d{4}$/.test(last)) s = s.slice(0, -5);
  return s || name;
}

/** World Cups and the World Championships (plus the Olympics), without cancelled, youth, continental or para events. */
export function parseSeason(season: JSONValue): ClimbingCompetition[] {
  // A season's leagues carry only a name and a URL; the ID is the URL's last part.
  const worldCup = new Set<number>();
  const games = new Set<number>();
  for (const league of arr(at(season, "leagues"))) {
    const name = str(at(league, "name"));
    const id = Number(str(at(league, "url"))?.split("/").pop());
    if (!name || !Number.isInteger(id)) continue;
    if (name.startsWith("World Cups")) worldCup.add(id);
    if (name === "Games") games.add(id);
  }
  return arr(at(season, "events"))
    .flatMap((e): ClimbingCompetition[] => {
      const id = int(at(e, "event_id"));
      const name = str(at(e, "event"));
      const leagueSeason = int(at(e, "league_season_id"));
      if (id == null || !name || leagueSeason == null) return [];
      const olympic = games.has(leagueSeason) && name.includes("Olympic Games");
      const first = dayKeyFromISO(str(at(e, "local_start_date")));
      const last = dayKeyFromISO(str(at(e, "local_end_date")));
      if (!(worldCup.has(leagueSeason) || olympic) || name.toLowerCase().includes("cancelled") || bool(at(e, "is_paraclimbing_event")) === true || !first || !last) {
        return [];
      }
      const lanes: string[] = [];
      for (const kind of arr(at(e, "disciplines")).flatMap((d) => str(at(d, "kind")) ?? [])) {
        const mapped = kind === "speed_relay" ? ["speed"] : kind === "boulder&lead" || kind === "combined" ? ["boulder", "lead"] : [kind];
        for (const lane of mapped) if (!lanes.includes(lane)) lanes.push(lane);
      }
      return [
        {
          eventID: id,
          name,
          shortName: competitionShortName(name),
          place: str(at(e, "location")) ?? null,
          countryCode: isoFromIOC(str(at(e, "country"))),
          startDay: first,
          endDay: last,
          startsAt: parseDate(str(at(e, "starts_at"))),
          endsAt: parseDate(str(at(e, "ends_at"))),
          timeZone: str(at(e, "timezone", "value")) ?? null,
          lanes,
          badge: olympic ? "Olympic Games" : name.includes("Championship") ? "World Championships" : null,
          link: `${IFSC_BASE}/event/${id}`,
        },
      ];
    })
    .sort((a, b) => compareDays(a.startDay, b.startDay));
}

/** The first competition that hasn't started, if none is underway. */
export function opener(events: readonly ClimbingCompetition[], now: number): ClimbingCompetition | null {
  const live = events.some((e) => (e.startsAt ?? Infinity) <= now && now <= (e.endsAt ?? -Infinity));
  if (live) return null;
  return events.filter((e) => (e.startsAt ?? startOfDay(e.startDay)) > now).sort((a, b) => compareDays(a.startDay, b.startDay))[0] ?? null;
}

/**
 * A whole upcoming competition as the scores list shows one: its name and
 * place, its venue dates and disciplines. It starts at local midnight of its
 * first (venue) day, so the day the row names is right.
 */
export function openerEvent(c: ClimbingCompetition): ScoreEvent {
  const title = `${c.shortName} ${c.startDay.year}`;
  const caption = [c.badge ?? "Season opener", dayRangeLabel(c.startDay, c.endDay), c.lanes.map(capitalized).join(" · ")].filter(Boolean).join(" · ");
  return blankEvent({
    id: `ifsc-${c.eventID}`,
    content: { kind: "field", title, summary: c.place ?? "" },
    state: "scheduled",
    start: startOfDay(c.startDay),
    caption,
    link: c.link,
    ref: { kind: "climbing", eventID: c.eventID, category: "", resultURL: null, round: null, eventName: title, nextURL: null },
  });
}

/** The current season and the one after it (by name), when published. */
async function nextSeasonOpener(root: JSONValue, fetcher: Fetcher, signal: AbortSignal | undefined, now: number): Promise<ScoreEvent | null> {
  const seasons = arr(at(root, "seasons")).flatMap((s) => {
    const id = int(at(s, "id"));
    const name = str(at(s, "name"));
    return id != null && name ? [{ id, name }] : [];
  });
  const currentID = int(at(root, "current", "id"));
  const current = seasons.find((s) => s.id === currentID) ?? seasons.find((s) => s.name === str(at(root, "current", "season")));
  const sorted = [...seasons].sort((a, b) => a.name.localeCompare(b.name));
  const next = current ? seasons.find((s) => s.name === String(Number(current.name) + 1)) : undefined;
  const wanted = current ? [current, ...(next ? [next] : [])] : sorted.slice(-2);
  const events: ClimbingCompetition[] = [];
  for (const season of wanted) {
    try {
      events.push(...parseSeason(await fetcher(abs(`/api/v1/seasons/${season.id}`), { signal })));
    } catch {
      // A season that won't load just isn't searched.
    }
  }
  const found = opener(events, now);
  return found ? openerEvent(found) : null;
}

// MARK: - Helpers

function blankEvent(e: Pick<ScoreEvent, "id" | "content" | "state" | "start"> & Partial<ScoreEvent>): ScoreEvent {
  return {
    detail: null,
    caption: null,
    link: null,
    ref: null,
    stage: null,
    clock: null,
    possession: null,
    liveLine: null,
    liveLineRoutine: false,
    broadcast: null,
    venue: null,
    snapshot: null,
    ...e,
  };
}
