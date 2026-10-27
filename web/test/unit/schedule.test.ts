/**
 * Schedules: ESPN and bo3.gg parsers, calendars, the agenda's rules (day
 * sections, folding, summaries, CS2 tournament days, climbing items,
 * filters), day arithmetic and scopes. Ported from Tests/SchedulesTests.swift
 * over fixtures trimmed from Tests/Fixtures/schedules.
 */
import { describe, expect, it } from "vitest";
import { addingDays, compactDay, dayKeyFromISO, dayKeyIn, dayRangeLabel, weekday, weekStart, type DayKey } from "../../src/data/days";
import {
  boardDays,
  caption,
  csTeamMatchesURL,
  csMatchesURL,
  monthWindows,
  nextGameDay,
  parseByes,
  parseCalendar,
  parseCSMatches,
  parseScoreboard,
  parseTeamSchedule,
  plays,
  scoreboardURL,
  teamScheduleURL,
  weekAfter,
  weekAt,
} from "../../src/data/providers/schedule";
import {
  buildAgenda,
  capDays,
  climbingItems,
  collapseTournamentDays,
  dayCountLabel,
  dayItems,
  dayLeagues,
  daySummary,
  defaultOpen,
  filterItems,
  form,
  freshness,
  splitDays,
  stripDots,
} from "../../src/data/agenda";
import { sortItems } from "../../src/data/results";
import { leagueWithID } from "../../src/data/leagues";
import {
  foldsDays,
  itemEvent,
  parseScope,
  scheduleItem,
  scheduleTeam,
  schedulePath,
  scopeNavigator,
  type ScheduleItem,
  type SeasonEvent,
} from "../../src/data/schedule";
import { DEFAULTS } from "../../src/state/settings";
import { fixture } from "./fixtures";

const RECORDED = Date.parse("2026-10-26T17:00:00Z");
const day = (year: number, month: number, d: number): DayKey => ({ year, month, day: d });
const ids = (days: Iterable<string>) => [...days].sort();

describe("days", () => {
  it("does civil arithmetic", () => {
    const d = day(2026, 10, 25);
    expect(compactDay(d)).toBe("20261025");
    expect(addingDays(d, 7)).toEqual(day(2026, 11, 1));
    expect(addingDays(d, -25)).toEqual(day(2026, 9, 30));
    expect(weekday(d)).toBe(1);
    expect(weekStart(day(2026, 10, 31))).toEqual(d);
    expect(dayKeyFromISO("2026-08-21T07:00Z")).toEqual(day(2026, 8, 21));
    expect(dayKeyIn(Date.parse("2027-01-03T05:00:00Z"), "America/New_York")).toEqual(day(2027, 1, 3));
    expect(dayRangeLabel(day(2027, 4, 9), day(2027, 4, 11))).toBe("Apr 9–11");
  });
});

describe("ESPN schedules", () => {
  it("builds board URLs: a day, a month, a week; never a range", () => {
    expect(scoreboardURL("basketball/nba", { kind: "day", day: day(2026, 11, 1) })).toMatch(/scoreboard\?dates=20261101$/);
    expect(scoreboardURL("soccer/eng.1", { kind: "month", year: 2026, month: 11 })).toMatch(/scoreboard\?dates=202611&limit=500$/);
    expect(scoreboardURL("football/nfl", { kind: "week", number: 9, seasonType: 2 })).toMatch(/scoreboard\?week=9&seasontype=2$/);
    expect(scoreboardURL("football/college-football", { kind: "week", number: 10, seasonType: 2 })).toMatch(/week=10&seasontype=2&groups=80$/);
    const months = monthWindows(day(2026, 12, 28), day(2027, 1, 3));
    expect(months).toHaveLength(2);
    expect(months.map((m) => scoreboardURL("soccer/eng.1", m).split("?")[1]).every((q) => !q?.includes("-"))).toBe(true);
    expect(teamScheduleURL("soccer/eng.1", "359", { season: 2023 })).toMatch(/schedule\?season=2023$/);
    expect(teamScheduleURL("baseball/mlb", "19", { seasonType: 2 })).toMatch(/schedule\?seasontype=2$/);
  });

  it("reads NFL week 9: byes, Madrid, Prime Video", () => {
    const json = fixture("sched-nfl-week9.json");
    const nfl = parseScoreboard(json, "football/nfl", "nfl", "football", RECORDED);
    const madrid = nfl.find((i) => i.notes.includes("NFL Madrid Game"));
    expect(parseByes(json)).toEqual(["Titans", "Steelers"]);
    expect(madrid?.venue).toBe("Santiago Bernabéu · Madrid");
    expect(madrid?.top?.abbreviation).toBe("CIN");
    expect(madrid?.networks).toEqual(["NFL Network"]);
    expect(nfl.find((i) => i.top?.abbreviation === "JAX")?.networks).toEqual(["Prime Video"]);
  });

  it("reads a team's season: flex weeks TBA on their Eastern day, the summary, venue", () => {
    const kc = parseTeamSchedule(fixture("sched-team-nfl-12.json"), "football/nfl", "nfl", "football", RECORDED);
    const week17 = kc.items.find((i) => i.week === 17);
    const week8 = kc.items.find((i) => i.week === 8);
    expect(kc.items).toHaveLength(17);
    expect(kc.byeWeek).toBe(5);
    expect(kc.summary).toBe("5–0 · 1st in AFC West");
    expect(week17?.start).toEqual({ kind: "tba" });
    expect(week17?.notes).toEqual(["Flex game: Sat, Jan 2 or Sun, Jan 3"]);
    expect(week17?.day).toEqual(day(2027, 1, 3));
    expect(week8?.start).toEqual({ kind: "exact", date: Date.parse("2026-11-01T21:25:00Z") });
    expect(week8?.networks).toEqual(["CBS"]);
    expect(week8?.venue).toBe("Empower Field at Mile High · Denver");
    expect(week8?.top?.abbreviation).toBe("KC");
    const event = itemEvent(week8!);
    expect(event.id).toBe("espn-401873033");
    expect(event.state).toBe("scheduled");
    expect(event.broadcast).toBe("CBS");
    expect(event.content.kind === "match" && event.content.top.id).toBe("espn-football-12");
  });

  it("reads the MLB postseason: series, if necessary, a rainout and its makeup", () => {
    const mlb = parseScoreboard(fixture("sched-mlb-month-202610.json"), "baseball/mlb", "mlb", "baseball", RECORDED);
    const find = (id: string) => mlb.find((i) => i.id === `espn-${id}`);
    expect(find("401908044")?.notes).toEqual(["World Series · Game 3 · MIL leads 2–0"]);
    expect(find("401908044")?.networks).toEqual(["FOX"]);
    expect(find("401908046")?.ifNecessary).toBe(true);
    expect(find("401908046")?.notes[0]?.startsWith("World Series · Game 5 · If necessary")).toBe(true);
    expect(find("401908026")?.status).toBe("postponed");
    expect(find("401908026")?.notes).toEqual(["ALCS · Game 4 · Rain, makeup Oct 18"]);
    expect(find("401908027")?.status).toBe("final");
  });

  it("reads soccer across competitions, provisional kickoffs and TBC", () => {
    const arsenal = parseTeamSchedule(fixture("sched-team-soccer-359-fixtures.json"), "soccer/all", "soccer", "soccer", RECORDED);
    const cup = sortItems(arsenal.items)[0];
    expect(cup?.competition).toBe("Carabao Cup · Fourth Round");
    expect(cup?.league).toBe("eng.league_cup");
    expect(cup?.networks).toEqual(["Paramount+"]);
    const on = (d: DayKey) => arsenal.items.find((i) => i.league === "eng.1" && compactDay(i.day) === compactDay(d));
    expect(on(day(2026, 12, 6))?.start.kind).toBe("exact");
    expect(on(day(2026, 12, 13))?.start).toMatchObject({ kind: "provisional", why: "tvPicks" });
    expect(arsenal.items.filter((i) => i.league === "uefa.champions").every((i) => i.start.kind === "exact")).toBe(true);
    const laliga = parseScoreboard(fixture("sched-esp1-month-202612.json"), "soccer/esp.1", "esp.1", "soccer", RECORDED);
    expect(laliga.length).toBeGreaterThan(0);
    expect(laliga.every((i) => i.start.kind === "tbc")).toBe(true);
  });

  it("rewrites ESPN's notes in the app's voice", () => {
    const near = Date.parse("2027-01-01T12:00:00Z");
    expect(caption("World Series - Game 5 If Necessary", near)).toBe("World Series · Game 5 · If necessary");
    expect(caption("ALCS - Game 4 Rain - Makeup on Oct 18", near)).toBe("ALCS · Game 4 · Rain, makeup Oct 18");
    expect(caption("Flex Game: 1/2 or 1/3", near)).toBe("Flex game: Sat, Jan 2 or Sun, Jan 3");
  });
});

describe("calendars", () => {
  it("reads game days, weeks and MLB's days off", () => {
    const epl = parseCalendar(fixture("sched-eng1-undated.json"));
    expect(epl.days).toHaveLength(77);
    expect(epl.days[0]).toEqual(day(2026, 8, 21));
    expect(nextGameDay(epl, day(2026, 10, 27))).toEqual(day(2026, 10, 31));
    const nfl = parseCalendar(fixture("sched-nfl-undated.json"));
    const regular = nfl.weeks.filter((w) => w.seasonType === 2);
    const week8 = regular.find((w) => w.number === 8)!;
    expect(regular).toHaveLength(18);
    expect(week8.detail).toBe("Oct 28-Nov 3");
    expect(nfl.weeks.some((w) => w.label === "Super Bowl")).toBe(true);
    expect(weekAt(nfl, RECORDED)?.number).toBe(7);
    expect(weekAfter(nfl, week8)?.number).toBe(9);
    const mlb = parseCalendar(fixture("sched-mlb-undated.json"));
    const off = day(2026, 10, 29);
    expect(mlb.days).toHaveLength(0);
    expect(mlb.seasonEnd).toEqual(day(2026, 11, 11));
    expect(plays(mlb, day(2026, 10, 27))).toBe(true);
    expect(plays(mlb, off)).toBe(false);
    expect(plays(mlb, day(2026, 12, 1))).toBe(false);
    expect(nextGameDay(mlb, off)).toEqual(day(2026, 10, 30));
  });

  it("asks only for the Eastern boards a week needs", () => {
    const mon = day(2026, 10, 26);
    const at = Date.parse("2026-10-26T16:00:00Z");
    // Tests run in New York: a week is seven boards.
    expect(boardDays(mon, addingDays(mon, 6), null, at)).toHaveLength(7);
    const played = [mon, addingDays(mon, 3), addingDays(mon, 5)];
    expect(boardDays(mon, addingDays(mon, 6), { days: played, offDays: null, seasonStart: null, seasonEnd: null, weeks: [] }, at)).toEqual(played);
    const mlb = parseCalendar(fixture("sched-mlb-undated.json"));
    expect(boardDays(mon, addingDays(mon, 6), mlb, at)).toEqual([26, 27, 28, 30, 31].map((d) => day(2026, 10, d)));
  });
});

describe("the agenda", () => {
  const kc = parseTeamSchedule(fixture("sched-team-nfl-12.json"), "football/nfl", "nfl", "football", RECORDED);
  const cup = parseTeamSchedule(fixture("sched-team-soccer-359-fixtures.json"), "soccer/all", "soccer", "soccer", RECORDED);

  it("groups days by league in the user's order; cup ties sit with their sport", () => {
    const days = buildAgenda([...kc.items, ...cup.items], ["eng.1", "nfl"], true);
    const find = (d: DayKey) => days.find((x) => compactDay(x.day) === compactDay(d));
    expect(find(day(2026, 11, 1))?.groups.map((g) => g.league)).toEqual(["eng.1", "nfl"]);
    expect(find(day(2026, 10, 27))?.groups[0]?.league).toBe("eng.1");
    const jan3 = dayItems(find(day(2027, 1, 3))!);
    expect(jan3[jan3.length - 1]?.start.kind).toBe("tba");
    const split = splitDays(days, day(2026, 10, 25));
    expect(split.upcoming[0]?.day).toEqual(day(2026, 10, 25));
    const results = parseTeamSchedule(fixture("sched-team-soccer-359-results.json"), "soccer/all", "soccer", "soccer", RECORDED);
    const f = form(results.items, "espn-soccer-359");
    expect(f).toHaveLength(5);
    expect(f.every((l) => ["W", "D", "L"].includes(l))).toBe(true);
  });

  const mon = day(2026, 10, 26);
  const item = (id: string, d: DayKey, league = "nba", field = false): ScheduleItem =>
    scheduleItem({
      id,
      sport: field ? "climbing" : "basketball",
      league,
      day: d,
      start: { kind: "tba" },
      status: "scheduled",
      top: field ? null : scheduleTeam({ id: `${id}a`, name: "A" }),
      bottom: field ? null : scheduleTeam({ id: `${id}b`, name: "B" }),
      title: field ? "Round" : null,
      ref: field ? { kind: "climbing", eventID: 1 } : { kind: "espn", path: "basketball/nba", id },
    });
  const days = (counts: number[], from = mon) =>
    buildAgenda(
      counts.flatMap((count, offset) => Array.from({ length: count }, (_, i) => item(`g${offset}-${i}`, addingDays(from, offset)))),
      ["nba"],
      true,
    );
  const keys = (list: DayKey[]) => ids(list.map((d) => `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`));

  it("opens today and the next game day, folding the rest", () => {
    expect(ids(defaultOpen(days([10, 8, 9, 12, 11, 14, 13]), mon))).toEqual(keys([mon, addingDays(mon, 1)]));
    expect(ids(defaultOpen(days([0, 0, 0, 1, 0, 0, 13], addingDays(mon, -1)), mon))).toEqual(keys([addingDays(mon, 2), addingDays(mon, 5)]));
    expect(defaultOpen(days([1, 1, 1, 1, 1]), mon).size).toBe(3);
    expect(ids(defaultOpen(days([0, 0, 4, 5]), mon))).toEqual(keys([addingDays(mon, 2), addingDays(mon, 3)]));
  });

  it("says a folded day in one line", () => {
    const mixed = buildAgenda([item("a", mon), item("b", mon), item("c", mon, "eng.1"), item("d", mon, "ifsc", true)], ["eng.1", "nba", "ifsc"], true);
    expect(daySummary(mixed[0]!, true)).toBe("3 games · 1 event · EPL, NBA, Climbing");
    expect(dayCountLabel(mixed[0]!)).toBe("3 games · 1 event");
    expect(dayLeagues(mixed[0]!)).toBe("EPL, NBA, Climbing");
    expect(daySummary(days([10])[0]!, false)).toBe("10 games");
  });

  it("caps a long season", () => {
    const capped = capDays(days([20, 20, 20]), 40, false);
    expect(capped.days).toHaveLength(2);
    expect(capped.hidden).toBe(20);
    expect(capDays(days([5]), 40, false).hidden).toBe(0);
  });

  it("folds CS2 tournament days, keeping followed teams' matches", () => {
    const matches = parseCSMatches(fixture("sched-bo3-tournament-matches.json"), RECORDED);
    const folded = collapseTournamentDays(matches, new Set(["cs-793"]));
    const tournamentDay = folded.find((i) => i.children != null);
    expect(folded).toHaveLength(2);
    expect(folded.some((i) => i.children == null && [i.top, i.bottom].some((t) => t?.id === "cs-793"))).toBe(true);
    expect(tournamentDay?.children).toHaveLength(7);
    expect(tournamentDay?.subtitle?.startsWith("7 matches")).toBe(true);
    expect(matches.every((m) => m.start.kind === "provisional" || m.start.kind === "exact")).toBe(true);
  });

  it("reads followed teams' bo3 matches and S-tier URLs", () => {
    const teams = parseCSMatches(fixture("sched-bo3-teams-upcoming.json"), RECORDED);
    const g2 = teams.find((m) => m.top?.name === "G2" || m.bottom?.name === "G2");
    expect(teams).toHaveLength(5);
    expect(g2?.start).toEqual({ kind: "exact", date: Date.parse("2026-10-26T17:00:00Z") });
    const url = decodeURIComponent(csTeamMatchesURL([793, 667]));
    expect(url).toContain("filter[matches.team_ids][overlap]=667,793");
    expect(url).toContain("filter[matches.tier][in]=s&");
    // The week's window rounds to the hour, so every visitor shares one cached copy.
    const a = csMatchesURL(Date.parse("2026-10-26T17:12:45Z"), Date.parse("2026-11-02T17:12:45Z"));
    const b = csMatchesURL(Date.parse("2026-10-26T17:55:01Z"), Date.parse("2026-11-02T17:55:01Z"));
    expect(a).toBe(b);
    expect(decodeURIComponent(a)).toContain("start_date][gt]=2026-10-26T16:59:59Z");
  });

  it("lists a climbing competition's rounds, or its days", () => {
    const event: SeasonEvent = {
      id: "ifsc-1489",
      kind: { kind: "climbing", id: 1489 },
      name: "World Climbing Series Santiago 2026",
      shortName: "Santiago",
      place: "Santiago, Chile",
      countryCode: "CL",
      startDay: day(2026, 10, 24),
      endDay: day(2026, 10, 26),
      startsAt: null,
      endsAt: null,
      timeZone: "America/Santiago",
      lanes: ["lead", "speed"],
      badge: null,
      prize: null,
      format: null,
      logo: null,
      status: "live",
      categories: [],
      rounds: [{ name: "Final", discipline: "Lead", categories: ["Men", "Women"], start: { kind: "exact", date: Date.parse("2026-10-26T22:00:00Z") }, stream: null, status: "pending" }],
      teams: [],
      registered: {},
      link: "https://ifsc.results.info/event/1489",
      infoSheet: null,
      stages: 0,
      detailed: true,
    };
    const items = climbingItems(event, day(2026, 10, 20), day(2026, 10, 30));
    expect(items.map((i) => i.title)).toEqual(["Lead final", "Santiago · Day 1 of 3", "Santiago · Day 2 of 3"]);
    expect(items[0]?.subtitle).toBe("🇨🇱 Santiago · Men & Women");
    expect(items[1]?.subtitle).toBe("🇨🇱 Lead · Speed");
  });

  it("filters as the scores list does", () => {
    const cfb = parseScoreboard(fixture("sched-cfb-week8.json"), "football/college-football", "college-football", "football", RECORDED);
    const college = leagueWithID("college-football")!;
    const ranked = cfb.filter((i) => [i.top, i.bottom].some((t) => t?.rank != null));
    expect(filterItems(cfb, college, DEFAULTS, false)).toHaveLength(ranked.length);
    expect(filterItems(cfb, college, DEFAULTS, true)).toHaveLength(cfb.length);
    const nfl = leagueWithID("nfl")!;
    const kcOnly = { ...DEFAULTS, filteredLeagues: ["nfl"], teamFilters: { nfl: ["espn-football-12"] } };
    expect(filterItems(kc.items, nfl, kcOnly, false)).toHaveLength(17);
    const week7 = parseScoreboard(fixture("sched-nfl-week7.json"), "football/nfl", "nfl", "football", RECORDED);
    expect(filterItems(week7, nfl, kcOnly, false).every((i) => [i.top, i.bottom].some((t) => t?.id === "espn-football-12"))).toBe(true);
  });

  it("dots the strip: games, followed, live", () => {
    const list = days([2, 1]);
    const dots = stripDots(list, new Set(["g1-0a"]), [addingDays(mon, 3)], (i) => i.id === "g0-1");
    expect(dots.get("2026-10-26")).toBe("live");
    expect(dots.get("2026-10-27")).toBe("followed");
    expect(dots.get("2026-10-29")).toBe("games");
  });

  it("keeps settled days fresh longer", () => {
    expect(freshness(day(2026, 10, 20), mon)).toBe(30 * 86_400_000);
    expect(freshness(day(2026, 10, 28), mon)).toBe(30 * 60_000);
    expect(freshness(day(2026, 12, 28), mon)).toBe(6 * 3_600_000);
  });
});

describe("scopes", () => {
  it("navigates by week, game days or month, and folds days on busy pages", () => {
    expect(scopeNavigator({ kind: "league", id: "nba" })).toBe("list");
    expect(scopeNavigator({ kind: "league", id: "eng.1" })).toBe("list");
    expect(scopeNavigator({ kind: "league", id: "nfl" })).toBe("weekPicker");
    expect(scopeNavigator({ kind: "all" })).toBe("weekStrip");
    expect(scopeNavigator({ kind: "yourTeams" })).toBe("monthBar");
    expect(foldsDays({ kind: "all" })).toBe(true);
    expect(foldsDays({ kind: "team", team: { id: "x", name: "X", logo: null } })).toBe(false);
  });

  it("round-trips through URLs", () => {
    const team = { kind: "team" as const, team: { id: "espn-football-12", name: "Chiefs", logo: null } };
    expect(schedulePath({ kind: "all" })).toBe("/schedule");
    expect(schedulePath({ kind: "league", id: "nfl" }, "results")).toBe("/schedule/nfl?mode=results");
    expect(schedulePath(team)).toBe("/schedule/team/espn-football-12?name=Chiefs");
    expect(parseScope("team", "espn-football-12", new URLSearchParams("name=Chiefs"))).toEqual(team);
    expect(parseScope("ifsc", undefined, new URLSearchParams())).toEqual({ kind: "climbing" });
    expect(parseScope("cs2", undefined, new URLSearchParams())).toEqual({ kind: "tournaments" });
    expect(parseScope("nope", undefined, new URLSearchParams())).toBeNull();
  });
});
