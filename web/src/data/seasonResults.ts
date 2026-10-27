/**
 * Results for the two season sports (SeasonResults.swift). Climbing (IFSC):
 * past seasons, the podiums, a category's full results. CS2 (bo3.gg):
 * finished S-tier tournaments with their placings, a tournament's matches by
 * round. Pure parsers: every string a row shows is made once, here.
 */
import { compareDays, dayKeyFromISO, longDayLabel, startOfDay, type DayKey } from "./days";
import { ordinal } from "./format";
import { arr, at, int, str, type JSONValue } from "./json";
import type { ScoreEvent } from "./models";
import { abbreviate, TIER } from "./providers/counterStrike";
import { parseDate } from "./providers/espn";
import { capitalized, competitionShortName } from "./providers/ifsc";
import { BO3_API, parseCSMatches } from "./providers/schedule";
import { counterStrikeResult } from "./results";
import { scheduleTeam, sortDate, type Placement, type RoundLink, type ScheduleItem, type SeasonCategory, type SeasonEvent } from "./schedule";
import { csShortName, IFSC_BASE, ifscStatus, parseEvent, prize, seasonEvent, tournament, type SeasonList, type SeasonRef } from "./seasons";
import { countryName, flagFromIOC, isoFromIOC } from "./teams";

const HOUR = 3_600_000;
const DAY = 86_400_000;

// MARK: - Climbing: a category's full results

export interface CategoryRound {
  /** `category_round_id` */
  readonly id: number;
  /** "Qualification", "Semi-final", "Final" */
  readonly name: string;
  readonly status: string;
  /** What the match page loads (`EventRef.climbing(resultURL:)`). */
  readonly resultPath: string | null;
  /** A column header: "Qual.", "Semi", "Final". */
  readonly short: string;
}

export interface CategoryScore {
  readonly roundID: number;
  readonly rank: number | null;
  /** IFSC's text, kept as is: "TOP", "48+", "84.6", "5.43 (5.12)". */
  readonly score: string | null;
  /** Speed's elimination final: how far the athlete went ("1st", "Quarter-final"). */
  readonly placing: string | null;
}

export interface CategoryRow {
  readonly athleteID: number;
  readonly rank: number | null;
  /** Shares its rank with another athlete. */
  readonly tied: boolean;
  /** "Janja Garnbret" */
  readonly name: string;
  /** IOC code ("SLO"). */
  readonly country: string | null;
  /** In round order, only the rounds climbed. */
  readonly scores: readonly CategoryScore[];
  /** Where the field drops to an earlier round (or, in a speed final, a heat): the label over the first row of each group. */
  readonly stage: string;
  /** "1", "55", "–" */
  readonly rankText: string;
  /** "55th, tied, Aimara Luz Baldasare Tello, Argentina, qualification: 0" */
  readonly spoken: string;
}

/** The last round climbed: what the compact ranking shows. */
export const lastScore = (row: CategoryRow): CategoryScore | null => row.scores[row.scores.length - 1] ?? null;
export const scoreIn = (row: CategoryRow, round: number): CategoryScore | null => row.scores.find((s) => s.roundID === round) ?? null;

/** `/events/{id}/result/{dcat}`: every athlete in a category, with each round's rank and score. */
export interface CategoryResults {
  /** "World Climbing Series Santiago 2026" */
  readonly event: string;
  /** "Lead Women" */
  readonly category: string;
  /** "lead", "boulder", "speed" */
  readonly discipline: string;
  readonly status: string;
  readonly rounds: readonly CategoryRound[];
  readonly rows: readonly CategoryRow[];
}

/** Your countries' best athlete in a category, for the season list. */
export interface CountryBest {
  readonly athleteID: number;
  readonly country: string;
  readonly rank: number;
  /** "Ella Fisher" */
  readonly name: string;
  /** "🇺🇸 Ella Fisher · 8th" */
  readonly text: string;
}

// MARK: - IFSC seasons

/** Seasons that can have results, newest first: the current one and the seven before it. */
export function resultSeasons(list: SeasonList, today: DayKey): SeasonRef[] {
  const current = list.current?.name ?? String(today.year);
  return list.all
    .filter((s) => s.name <= current)
    .sort((a, b) => (a.name > b.name ? -1 : a.name < b.name ? 1 : 0))
    .slice(0, 8);
}

/** Finals barely change after two days (corrections land within ~48 h): then 30 days; until then, half an hour (ms). */
export function resultsTTL(endedAt: number | null, now: number): number {
  if (endedAt == null) return 6 * HOUR;
  if (endedAt > now) return 10 * 60_000;
  return now - endedAt > 48 * HOUR ? 30 * DAY : 30 * 60_000;
}

/** A past season's calendar is settled; the current one moves (ms). */
export function seasonTTL(name: string, current: string | null): number {
  if (current != null && name < current) return 30 * DAY;
  return 12 * HOUR;
}

/** The season's finished competitions, newest first. */
export function finished(events: readonly SeasonEvent[]): SeasonEvent[] {
  return events.filter((e) => e.status === "finished").sort((a, b) => compareDays(b.endDay, a.endDay) || compareDays(b.startDay, a.startDay));
}

// MARK: - IFSC events

/** A competition built from its own detail (`/events/{id}`), for a page opened without the season list. */
export function standaloneEvent(json: JSONValue, now: number): SeasonEvent | null {
  const id = int(at(json, "id"));
  const name = str(at(json, "name"));
  const first = dayKeyFromISO(str(at(json, "local_start_date")));
  const last = dayKeyFromISO(str(at(json, "local_end_date")));
  if (id == null || !name || !first || !last) return null;
  const startsAt = parseDate(str(at(json, "starts_at")));
  const endsAt = parseDate(str(at(json, "ends_at")));
  const lanes: string[] = [];
  for (const kind of arr(at(json, "disciplines")).flatMap((d) => str(at(d, "kind")) ?? [])) {
    const mapped = kind === "speed_relay" ? ["speed"] : kind === "boulder&lead" || kind === "combined" ? ["boulder", "lead"] : [kind];
    for (const lane of mapped) if (!lanes.includes(lane)) lanes.push(lane);
  }
  const base = seasonEvent({
    id: `ifsc-${id}`,
    kind: { kind: "climbing", id },
    name,
    shortName: competitionShortName(name),
    place: str(at(json, "location")) ?? null,
    countryCode: isoFromIOC(str(at(json, "country"))),
    startDay: first,
    endDay: last,
    startsAt,
    endsAt,
    timeZone: str(at(json, "timezone", "value")) ?? null,
    lanes,
    badge: name.includes("Olympic Games") ? "Olympic Games" : name.includes("Championship") ? "World Championships" : null,
    status: ifscStatus(startsAt, endsAt, now),
    link: `${IFSC_BASE}/event/${id}`,
  });
  return parseEvent(json, base);
}

export function categoryURL(event: number, dcat: number): string {
  return `${IFSC_BASE}/api/v1/events/${event}/result/${dcat}`;
}

/** "LEAD Women" → ("Lead Women", "lead") */
export function categoryName(raw: string): { name: string; discipline: string } {
  const space = raw.indexOf(" ");
  const discipline = (space >= 0 ? raw.slice(0, space) : raw).toLowerCase();
  const name = [capitalized(discipline), ...(space >= 0 ? [raw.slice(space + 1)] : [])].join(" ").trim();
  return { name, discipline };
}

/** "Qualification" → "Qual.", "Semi-final" → "Semi", "Final" → "Final". */
export function shortRound(name: string): string {
  switch (name.toLowerCase()) {
    case "qualification":
      return "Qual.";
    case "semi-final":
    case "semifinal":
    case "semi-finals":
      return "Semi";
    case "final":
    case "finals":
      return "Final";
    default:
      return name.slice(0, 5);
  }
}

/**
 * The elimination final: the last heat an athlete ran. The big and small
 * finals place 1st–4th; everyone else went out in a heat ("1/4" → "Quarter-final").
 */
export function speedPlacing(stages: readonly JSONValue[], rank: number | null): string | null {
  const name = str(at(stages[stages.length - 1], "name"));
  if (!name) return null;
  switch (name.toLowerCase()) {
    case "final":
    case "small final":
    case "big final":
      return rank != null ? ordinal(rank) : null;
    case "1/2":
      return "Semi-final";
    case "1/4":
      return "Quarter-final";
    case "1/8":
      return "Round of 16";
    case "1/16":
      return "Round of 32";
    default:
      return name;
  }
}

const startsWithDigit = (s: string | null | undefined) => s != null && /^\d/.test(s);

function spokenScore(score: CategoryScore | null, round: string | null): string | null {
  if (!score || score.score == null) return round?.toLowerCase() ?? null;
  const value = score.score === "TOP" ? "top" : score.score;
  const place = score.placing && !startsWithDigit(score.placing) ? score.placing.toLowerCase() : null;
  return `${[round?.toLowerCase(), place].filter(Boolean).join(", ")}: ${value}`;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function parseCategory(json: JSONValue): CategoryResults {
  const { name: category, discipline } = categoryName(str(at(json, "dcat")) ?? "");
  const rounds = arr(at(json, "category_rounds")).flatMap((r): CategoryRound[] => {
    const id = int(at(r, "category_round_id"));
    if (id == null) return [];
    const name = str(at(r, "name")) ?? "Round";
    return [{ id, name, status: str(at(r, "status")) ?? "pending", resultPath: str(at(r, "result_url")) ?? null, short: shortRound(name) }];
  });
  const order = new Map(rounds.map((r, i) => [r.id, i]));
  const speed = discipline === "speed";
  const raws = arr(at(json, "ranking")).flatMap((a) => {
    const id = int(at(a, "athlete_id"));
    if (id == null) return [];
    const rank = int(at(a, "rank")) ?? null;
    const scores = arr(at(a, "rounds"))
      .flatMap((r): CategoryScore[] => {
        const roundID = int(at(r, "category_round_id"));
        if (roundID == null) return [];
        const raw = str(at(r, "score"));
        const roundRank = int(at(r, "rank")) ?? null;
        const stages = at(r, "speed_elimination_stages");
        return [{ roundID, rank: roundRank, score: raw ? raw : null, placing: speed && stages !== undefined ? speedPlacing(arr(stages), roundRank ?? rank) : null }];
      })
      .sort((x, y) => (order.get(x.roundID) ?? 0) - (order.get(y.roundID) ?? 0));
    return [{ id, rank, first: (str(at(a, "firstname")) ?? "").trim(), last: capitalized(str(at(a, "lastname")) ?? "").trim(), country: str(at(a, "country")) ?? null, scores }];
  });
  const counts = new Map<number, number>();
  for (const r of raws) if (r.rank != null) counts.set(r.rank, (counts.get(r.rank) ?? 0) + 1);
  // Ranks first; inside a tie, by surname (IFSC's order there means nothing).
  const sorted = [...raws].sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || collator.compare(a.last, b.last));
  const rows = sorted.map((raw): CategoryRow => {
    const tied = raw.rank != null && (counts.get(raw.rank) ?? 0) > 1;
    const name = raw.first ? `${raw.first} ${raw.last}` : raw.last;
    const last = raw.scores[raw.scores.length - 1] ?? null;
    const lastRound = last ? (rounds.find((r) => r.id === last.roundID) ?? null) : null;
    let stage = lastRound?.name ?? "Unranked";
    if (last?.placing && !startsWithDigit(last.placing)) stage = last.placing;
    const spoken = [raw.rank != null ? ordinal(raw.rank) : null, tied ? "tied" : null, name, raw.country ? countryName(raw.country) : null, spokenScore(last, lastRound?.name ?? null)]
      .filter(Boolean)
      .join(", ");
    return { athleteID: raw.id, rank: raw.rank, tied, name, country: raw.country, scores: raw.scores, stage, rankText: raw.rank != null ? String(raw.rank) : "–", spoken };
  });
  return { event: str(at(json, "event")) ?? "", category, discipline, status: str(at(json, "status")) ?? "", rounds, rows };
}

/** Each highlighted country's best athlete off the podium (the podium lines already name the top three). */
export function best(results: CategoryResults, countries: ReadonlySet<string>): CountryBest[] {
  if (countries.size === 0) return [];
  const seen = new Set<string>();
  const out: CountryBest[] = [];
  for (const row of results.rows) {
    if (!row.country || !countries.has(row.country) || row.rank == null || seen.has(row.country)) continue;
    seen.add(row.country);
    if (row.rank <= 3) continue;
    out.push({ athleteID: row.athleteID, country: row.country, rank: row.rank, name: row.name, text: `${flagFromIOC(row.country) ?? row.country} ${row.name} · ${ordinal(row.rank)}` });
  }
  return out;
}

/** A finished round as the match page opens it. */
export function roundEvent(event: SeasonEvent, category: string, round: RoundLink, winner: string | null = null): ScoreEvent | null {
  if (event.kind.kind !== "climbing" || !round.resultPath) return null;
  const eventID = event.kind.id;
  const summaryLine = [round.name, winner ? `Winner ${winner}` : null].filter(Boolean).join(" · ");
  return {
    id: `ifsc-${eventID}-r${round.id}`,
    content: { kind: "field", title: category, summary: summaryLine },
    state: round.status === "active" ? "live" : "final",
    start: event.startsAt ?? startOfDay(event.startDay),
    detail: round.name,
    caption: `${event.shortName} ${event.startDay.year}`,
    link: event.link,
    ref: { kind: "climbing", eventID, category, resultURL: round.resultPath, round: round.name, eventName: event.shortName, nextURL: null },
    stage: null,
    clock: null,
    possession: null,
    liveLine: null,
    liveLineRoutine: false,
    broadcast: null,
    venue: null,
    snapshot: null,
  };
}

/** "🇸🇮 J. Garnbret": a round's winner, short. */
export function winnerShortName(first: string, last: string, country: string | null): string {
  const initial = first ? `${first[0]}. ` : "";
  return [flagFromIOC(country), initial + last].filter(Boolean).join(" ");
}

/** "🥇 🇨🇳 Zhao · 🇨🇳 Deng · 🇨🇭 Utelli · 🇸🇮 Garnbret": every category's winner. */
export function winners(event: SeasonEvent, limit: number | null = null): string | null {
  const names = event.categories.flatMap((c) => {
    const a = c.podiumAthletes.find((x) => x.rank === 1);
    if (a) return [[flagFromIOC(a.country), a.last].filter(Boolean).join(" ")];
    const entry = c.podium[0];
    if (!entry) return [];
    const space = entry.indexOf(" ");
    return [space >= 0 ? `${flagFromIOC(entry.slice(0, space)) ?? entry.slice(0, space)} ${entry.slice(space + 1)}` : entry];
  });
  if (names.length === 0) return null;
  return `🥇 ${(limit != null ? names.slice(0, limit) : names).join(" · ")}`;
}

/** Every category winner's surname, for the timeline's readout. */
export function winnerNames(event: SeasonEvent): string[] {
  return event.categories.flatMap((c) => {
    const a = c.podiumAthletes.find((x) => x.rank === 1);
    if (a) return [a.last];
    const entry = c.podium[0];
    if (!entry) return [];
    const space = entry.indexOf(" ");
    return [space >= 0 ? entry.slice(space + 1) : entry];
  });
}

/** Every round called off (weather, a wall that failed): nothing to rank. */
export function categoryCanceled(c: SeasonCategory): boolean {
  return c.rounds.length > 0 && c.rounds.every((r) => r.status === "canceled" || r.status === "cancelled");
}

// MARK: - bo3.gg: finished tournaments

/** A finished tournament as the results list shows it: the tournament and its placings. */
export interface FinishedTournament {
  /** bo3.gg's numeric ID (its match list is filtered by it). */
  readonly bo3ID: number;
  readonly event: SeasonEvent;
  /** Sorted by place; teams bo3.gg hasn't named are left out. */
  readonly placements: readonly Placement[];
  /** "IEM Cologne Major Stage 2": the name fans use, without a year the dates give. */
  readonly title: string;
  /** "🏆 Vitality · 2nd MOUZ · $1M" */
  readonly summary: string | null;
}

export const finishedSlug = (t: FinishedTournament) => (t.event.kind.kind === "tournament" ? t.event.kind.slug : t.event.id);

export interface FinishedPage {
  readonly items: readonly FinishedTournament[];
  /** bo3.gg's count for the whole query (qualifiers included). */
  readonly total: number;
}

/** Six with placings is about 70 KB gzipped: a page at a time. */
export const PAGE_SIZE = 6;

export function finishedURL(page: number, limit: number = PAGE_SIZE): string {
  const url = new URL(`${BO3_API}/tournaments`);
  url.searchParams.set("filter[tournaments.discipline_id][eq]", "1");
  url.searchParams.set("filter[tournaments.status][in]", "finished");
  url.searchParams.set("filter[tournaments.tier][in]", TIER);
  url.searchParams.set("sort", "-end_date");
  url.searchParams.set("page[limit]", String(limit));
  url.searchParams.set("page[offset]", String(page * limit));
  url.searchParams.set("with", "tournament_prizes");
  return url.href;
}

/** One tournament with its placings, by slug: a page opened cold (the detail endpoint is 73 KB; this is about 12). */
export function slugURL(slug: string): string {
  const url = new URL(`${BO3_API}/tournaments`);
  url.searchParams.set("filter[tournaments.slug][eq]", slug);
  url.searchParams.set("with", "tournament_prizes");
  return url.href;
}

export function parseFinished(json: JSONValue): FinishedPage {
  const items = arr(at(json, "results")).flatMap((t): FinishedTournament[] => {
    const id = int(at(t, "id"));
    const parsed = tournament(t);
    // Qualifiers are tournaments of their own; their results aren't news.
    if (id == null || !parsed || parsed.name.toLowerCase().includes("qualifier")) return [];
    const event: SeasonEvent = parsed.status === "canceled" ? parsed : { ...parsed, status: "finished" };
    const p = placements(arr(at(t, "tournament_prizes")));
    return [{ bo3ID: id, event, placements: p, title: displayName(event.name), summary: finishedSummary(p, event.prize) }];
  });
  return { items, total: int(at(json, "total", "count")) ?? items.length };
}

/** "Intel Extreme Masters Cologne Major 2026 Stage 2" → "IEM Cologne Major Stage 2" (a year mid-name goes too). */
export function displayName(name: string): string {
  const words = csShortName(name).split(" ");
  const kept = words.filter((w) => !(/^\d{4}$/.test(w) && Number(w) >= 1990 && Number(w) <= 2100));
  return kept.length >= 2 ? kept.join(" ") : words.join(" ");
}

export function placements(prizes: readonly JSONValue[]): Placement[] {
  return prizes
    .flatMap((p, index): { index: number; placement: Placement }[] => {
      const t = at(p, "teams");
      const id = int(at(t, "id")) ?? int(at(p, "team_id"));
      const name = str(at(t, "name"));
      const label = placeLabel(str(at(p, "place")));
      if (id == null || !name || !label) return [];
      const team = scheduleTeam({ id: `cs-${id}`, name, abbreviation: abbreviate(name), logo: str(at(t, "image_url")) ?? null, rank: int(at(t, "rank")) ?? null });
      return [{ index, placement: { place: label.place, order: label.order, team, money: int(at(p, "money")) ?? null, clubMoney: int(at(p, "club_money")) ?? null } }];
    })
    .sort((a, b) => a.placement.order - b.placement.order || a.index - b.index)
    .map((x) => x.placement);
}

/** bo3.gg's "5-8th" → ("5th–8th", 5); "1st" → ("1st", 1); "25-32nd" → ("25th–32nd", 25). */
export function placeLabel(raw: string | null | undefined): { place: string; order: number } | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const parts = trimmed.split("-");
  const lead = (s: string) => {
    const m = /^\d+/.exec(s);
    return m ? Number(m[0]) : null;
  };
  const first = lead(parts[0]!);
  if (first == null) return { place: trimmed, order: Number.MAX_SAFE_INTEGER };
  const second = parts.length === 2 ? lead(parts[1]!) : null;
  if (second != null) return { place: `${ordinal(first)}–${ordinal(second)}`, order: first };
  return { place: ordinal(first), order: first };
}

/** "🏆 Vitality · 2nd MOUZ · $1M"; a qualification stage's shared top places read "1st–2nd FUT, Spirit". */
export function finishedSummary(p: readonly Placement[], amount: number | null): string | null {
  const parts: string[] = [];
  const first = p[0];
  if (first) {
    if (first.place === "1st") {
      parts.push(`🏆 ${first.team.name}`);
      const second = p.find((x) => x.order === 2);
      if (second) parts.push(`${second.place} ${second.team.name}`);
    } else {
      parts.push(`${first.place} ${p.filter((x) => x.order === first.order).map((x) => x.team.name).join(", ")}`);
    }
  }
  const money = prize(amount);
  if (money) parts.push(money);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** "15th–16th" → 16; "4th" → 4. */
export function lastPlace(p: Placement): number {
  const end = p.place.split("–").pop() ?? "";
  const m = /^\d+/.exec(end);
  return m ? Number(m[0]) : p.order;
}

// MARK: - bo3.gg: a tournament's matches

/** A tournament's match list page, with where each match sits. */
export interface TournamentMatches {
  readonly items: readonly ScheduleItem[];
  /** Item ID → stage and round IDs. */
  readonly stage: Readonly<Record<string, number>>;
  readonly round: Readonly<Record<string, number>>;
  readonly total: number;
}

export function tournamentMatchesURL(id: number, offset = 0): string {
  const url = new URL(`${BO3_API}/matches`);
  url.searchParams.set("filter[matches.tournament_id][eq]", String(id));
  url.searchParams.set("page[limit]", "100");
  url.searchParams.set("page[offset]", String(offset));
  url.searchParams.set("with", "teams");
  return url.href;
}

export function parseTournamentMatches(json: JSONValue, now: number): TournamentMatches {
  const stage: Record<string, number> = {};
  const round: Record<string, number> = {};
  for (const m of arr(at(json, "results"))) {
    const id = int(at(m, "id"));
    if (id == null) continue;
    const s = int(at(m, "stage_id"));
    const r = int(at(m, "round_id"));
    if (s != null) stage[`cs-${id}`] = s;
    if (r != null) round[`cs-${id}`] = r;
  }
  // Every final labeled, a forfeit without bo3.gg's fake 1–0.
  return { items: parseCSMatches(json, now).map(counterStrikeResult), stage, round, total: int(at(json, "total", "count")) ?? 0 };
}

/** A tournament stage's name and its rounds' names (`/stages/{id}`, matches dropped). */
export interface StageInfo {
  readonly id: number;
  /** "ESL Pro League Season 24 Group Stage" */
  readonly title: string;
  /** "swiss", "group", "playoff" */
  readonly format: string;
  readonly sequence: number | null;
  readonly rounds: readonly { readonly id: number; readonly name: string; readonly index: number }[];
}

export const stageURL = (id: number) => `${BO3_API}/stages/${id}`;

export function parseStage(json: JSONValue): StageInfo | null {
  const id = int(at(json, "id"));
  if (id == null) return null;
  const rounds = arr(at(json, "rounds")).flatMap((r) => {
    // Trimmed or older responses carry no round ID: its matches still say it.
    const rid = int(at(r, "id")) ?? int(at(r, "matches", 0, "round_id"));
    if (rid == null) return [];
    return [{ id: rid, name: str(at(r, "name")) ?? `Round ${int(at(r, "round_index")) ?? 0}`, index: int(at(r, "round_index")) ?? 0 }];
  });
  return { id, title: str(at(json, "title")) ?? "", format: str(at(json, "format_type")) ?? "", sequence: int(at(json, "sequence_number")) ?? null, rounds };
}

/** "ESL Pro League Season 24 Group Stage" (swiss) → "Swiss"; "… Playoffs" → "Playoffs". */
export function stageName(stage: StageInfo, tournamentName: string): string {
  if (stage.format === "swiss") return "Swiss";
  let title = stage.title;
  for (const prefix of [tournamentName, csShortName(tournamentName)]) {
    if (title.startsWith(prefix)) {
      title = title.slice(prefix.length).trim();
      break;
    }
  }
  return title || capitalized(stage.format);
}

/** The matches of one stage round, as the tournament page lists them. */
export interface MatchGroup {
  readonly id: string;
  /** "Grand final", "Swiss · Round 5" */
  readonly title: string;
  /** Start order. */
  readonly items: readonly ScheduleItem[];
  /** The round's last start: groups list newest first by it. */
  readonly last: number;
}

const cap1 = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1);

/**
 * Matches by stage round, newest round first, start order inside. A playoff
 * round says its own name ("Grand final"); a Swiss or group round gets its
 * stage ("Swiss · Round 5"). Without stage data, by day.
 */
export function matchGroups(matches: TournamentMatches, stages: readonly StageInfo[], tournamentName: string): MatchGroup[] {
  const rounds = new Map<number, { stage: StageInfo; round: StageInfo["rounds"][number] }>();
  for (const stage of stages) for (const round of stage.rounds) rounds.set(round.id, { stage, round });
  const buckets = new Map<string, { title: string; items: ScheduleItem[] }>();
  for (const item of matches.items) {
    const rid = matches.round[item.id];
    const found = rid != null ? rounds.get(rid) : undefined;
    let key: string;
    let title: string;
    if (rid != null && found) {
      key = `r${rid}`;
      title = found.stage.format === "playoff" ? cap1(found.round.name) : `${stageName(found.stage, tournamentName)} · ${cap1(found.round.name)}`;
    } else {
      key = `d${item.day.year}-${item.day.month}-${item.day.day}`;
      title = longDayLabel(item.day);
    }
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { title, items: [] }));
    b.items.push(item);
  }
  return [...buckets]
    .map(([id, b]) => {
      const items = [...b.items].sort((x, y) => sortDate(x) - sortDate(y));
      return { id, title: b.title, items, last: items.length > 0 ? sortDate(items[items.length - 1]!) : -Infinity };
    })
    .sort((a, b) => b.last - a.last);
}

/** "beat MOUZ 3–0 in the grand final": the champion's last match against the runner-up. */
export function finalLine(t: FinishedTournament, groups: readonly MatchGroup[]): string | null {
  const first = t.placements[0];
  const second = t.placements.find((p) => p.order === 2);
  if (!first || first.place !== "1st" || !second) return null;
  const pair = new Set([first.team.id, second.team.id].filter(Boolean));
  for (const g of groups) {
    const match = [...g.items].reverse().find((m) => {
      const ids = new Set([m.top?.id, m.bottom?.id].filter(Boolean));
      return ids.size === pair.size && [...pair].every((id) => ids.has(id));
    });
    if (!match) continue;
    const round = g.title.includes("·") ? "" : ` in the ${g.title.toLowerCase()}`;
    if (match.result?.kind === "forfeit") return `beat ${second.team.name} by forfeit${round}`;
    const mine = match.top?.id === first.team.id ? match.top : match.bottom;
    const theirs = match.top?.id === first.team.id ? match.bottom : match.top;
    if (mine?.score == null || theirs?.score == null) return `beat ${second.team.name}${round}`;
    return `beat ${second.team.name} ${mine.score}–${theirs.score}${round}`;
  }
  return null;
}

/** Whole rounds, newest first, until about `limit` matches are on screen. */
export function shownGroups(groups: readonly MatchGroup[], limit: number, all: boolean): readonly MatchGroup[] {
  if (all) return groups;
  const shown: MatchGroup[] = [];
  let count = 0;
  for (const g of groups) {
    if (count >= limit && shown.length > 0) break;
    shown.push(g);
    count += g.items.length;
  }
  return shown;
}
