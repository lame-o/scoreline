/**
 * Results: ESPN boards and team schedules recorded on 26 Oct 2026 (trimmed
 * from Tests/Fixtures/results), through the pure parsers, plus synthetic
 * worst cases and the rounds. Ported from Tests/ResultsTests.swift.
 */
import { describe, expect, it } from "vitest";
import { leagueWithID } from "../../src/data/leagues";
import { parseCalendar, parseScoreboard, parseTeamSchedule } from "../../src/data/providers/schedule";
import {
  buildRounds,
  counterStrikeResult,
  csHistoryURL,
  formMark,
  isFriendly,
  latestRound,
  outcome,
  pastGameDays,
  resultSecondLine,
  roundLabel,
  roundsLayout,
  roundSummary,
  seasonLabel,
  summarizeSeason,
} from "../../src/data/results";
import { scheduleItem, scheduleTeam, resultDetail, type ScheduleItem, type ScheduleCalendar } from "../../src/data/schedule";
import { longDayLabel, type DayKey } from "../../src/data/days";
import type { Sport } from "../../src/data/models";
import { fixture } from "./fixtures";

/** Monday 26 Oct 2026, 10 AM in California: when the samples were recorded. */
const MONDAY = Date.parse("2026-10-26T17:00:00Z");

const board = (name: string, path: string, league: string, sport: Sport) => parseScoreboard(fixture(name), path, league, sport, MONDAY);
const game = (items: readonly ScheduleItem[], id: string) => items.find((i) => i.id === `espn-${id}`);
const day = (year: number, month: number, d: number): DayKey => ({ year, month, day: d });

describe("soccer results", () => {
  const items = board("sched-eng1-day.json", "soccer/eng.1", "eng.1", "soccer");

  it("reads four finals, each FT", () => {
    expect(items).toHaveLength(4);
    expect(items.every((i) => i.status === "final" && i.result?.label === "FT" && i.result.kind === "regulation")).toBe(true);
  });

  it("lists scorers by side, with details and words", () => {
    const villa = game(items, "401879256")!;
    const r = villa.result!;
    expect(r.scorers.map((s) => `${s.top ? "top" : "bottom"} ${s.name} ${s.minute}`)).toEqual(["top N. Jackson 6'", "bottom E. Haaland 52'", "top N. Jackson 60'"]);
    expect(r.details).toBe("Jackson 6', 60' · Haaland 52'");
    expect(r.gamesPlayed).toBe(8);
    expect(r.attendance).toBe(36743);
    expect(r.headline).toBe("Man City beaten by double from Villa's Jackson");
    expect(r.spoken).toBe("Aston Villa 2, Man City 1, full time, Aston Villa won. Goals: Jackson, 6th and 60th minute; Haaland, 52nd minute.");
    expect(villa.top?.winner).toBe(true);
    expect(villa.bottom?.winner).toBe(false);
  });

  it("puts an own goal under the side it counted for, and red cards last", () => {
    const r = game(items, "401878767")!.result!;
    const penders = r.scorers.find((s) => s.name === "M. Penders");
    expect(penders?.mark).toBe("ownGoal");
    expect(penders?.top).toBe(false);
    const palmer = r.scorers.find((s) => s.mark === "red");
    expect(palmer).toMatchObject({ name: "C. Palmer", minute: "80'", top: true });
    expect(r.details).toBe("Penders 77' (OG) · Tel 87' · ▮ Palmer 80'");
    expect(r.attendance).toBeNull();
  });
});

describe("knockouts", () => {
  const ucl = board("sched-ucl-two-legs.json", "soccer/uefa.champions", "uefa.champions", "soccer");

  it("reads two legs: aggregate, who went through, the winner by the score", () => {
    const spurs = game(ucl, "401862580")!;
    const r = spurs.result!;
    expect(r.leg).toBe(2);
    expect(r.aggregate).toEqual({ top: 5, bottom: 7 });
    expect(r.advances).toBe("Atlético Madrid");
    expect(spurs.top?.winner).toBe(true);
    expect(spurs.bottom?.winner).toBe(false);
    expect(resultSecondLine(r)).toBe("Agg 5–7");
    expect(r.context).toBe("Round of 16 · 2nd leg · Atlético advance 7–5 on agg.");
    expect(r.details).toBe("Kolo Muani 30' · Simons 52', 90' (P) · Álvarez 47' · Hancko 75'");
    expect(r.spoken).toContain("Round of 16, second leg: Atlético Madrid advance 7 to 5 on aggregate.");
    const firstLegs = ucl.filter((i) => i.result?.leg === 1);
    expect(firstLegs).toHaveLength(8);
    expect(firstLegs.every((i) => i.result?.aggregate == null && resultSecondLine(i.result) == null)).toBe(true);
    const sporting = game(ucl, "401862584")!.result!;
    expect(sporting.kind).toBe("extraTime");
    expect(sporting.label).toBe("AET");
    expect(sporting.advances).not.toBeNull();
  });

  it("reads a shootout: the score level, the winner by the shootout", () => {
    const wc = board("sched-wc-pens.json", "soccer/fifa.world", "fifa.world", "soccer");
    const egypt = game(wc, "760499")!;
    const p = egypt.result!;
    expect(p.kind).toBe("penalties");
    expect(p.label).toBe("Pens");
    expect(p.shootout).toEqual({ top: 2, bottom: 4 });
    expect(resultSecondLine(p)).toBe("2–4");
    expect(egypt.bottom?.winner).toBe(true);
    expect(egypt.top?.winner).toBe(false);
    expect(p.advances).toBe("Egypt");
    expect(p.scorers).toHaveLength(2);
    expect(p.context).toBe("Round of 32 · Egypt advance 4–2 on pens.");
    expect(p.spoken?.startsWith("Australia 1, Egypt 1, after penalties, Egypt won 4 to 2 on penalties. Round of 32.")).toBe(true);
    expect(game(wc, "760517")?.result?.label).toBe("AET");
    expect(game(wc, "760517")?.result?.context).toBeNull();
  });
});

describe("US sports results", () => {
  it("reads football leaders and overtime", () => {
    const nfl = board("sched-nfl-week7.json", "football/nfl", "nfl", "football");
    const giants = game(nfl, "401873016")!.result!;
    expect(giants.label).toBe("Final/OT");
    expect(giants.kind).toBe("overtime");
    expect(giants.periods).toBe(5);
    expect(giants.performers.map((p) => `${p.category} ${p.name}`)).toEqual(["passingYards J.J. McCarthy", "rushingYards C. Skattebo", "receivingYards M. Nabers"]);
    expect(giants.details).toBe("McCarthy 252 yds · Skattebo 124 rush yds, 1 TD");
    expect(giants.detailsWide).toBe("McCarthy 20/28, 252 yds · Skattebo 124 rush yds, 1 TD · Nabers 7 rec, 111 yds");
    expect(giants.spoken?.startsWith("Giants 27, Texans 21, final, overtime, Giants won.")).toBe(true);
    expect(game(nfl, "401873009")?.result).toBeNull();
  });

  it("reads double overtime in college", () => {
    const cfb = board("sched-cfb-week8.json", "football/college-football", "college-football", "football");
    const ot = cfb.find((i) => i.result?.label === "Final/2OT");
    expect(ot?.result?.periods).toBe(6);
    expect(ot?.result?.spoken).toContain("double overtime");
  });

  it("reads pitching decisions and the World Series", () => {
    const ws = board("sched-mlb-ws-g2.json", "baseball/mlb", "mlb", "baseball")[0]!.result!;
    expect(ws.decisions?.win).toEqual({ name: "A. Uribe", record: "1–0", athleteID: "4917865" });
    expect(ws.details).toBe("W Uribe (1–0) · L Wells (0–2) · S Ashby (3)");
    expect(ws.series).toBe("MIL leads 2–0");
    expect(ws.context).toBe("World Series · Game 2 · MIL leads 2–0");
    expect(ws.spoken?.startsWith("Rays 4, Brewers 5, final, Brewers won. World Series, Game 2, Milwaukee leads 2 to 0.")).toBe(true);
    const elevens = board("sched-mlb-extra.json", "baseball/mlb", "mlb", "baseball").filter((i) => i.result?.periods === 11);
    expect(elevens).toHaveLength(2);
    expect(elevens.every((i) => i.result?.kind === "overtime" && i.result.spoken?.includes("11 innings"))).toBe(true);
  });

  it("reads basketball leaders, winner first", () => {
    const nba = board("sched-nba-day.json", "basketball/nba", "nba", "basketball");
    const lakers = game(nba, "401909861")!.result!;
    expect(lakers.details).toBe("Doncic 52 pts · Markkanen 28 pts");
    expect(lakers.detailsWide).toBe("Doncic 52 pts, 8 reb, 10 ast · George 24 pts, 9 reb, 10 ast");
    const finals = board("sched-nba-finals.json", "basketball/nba", "nba", "basketball");
    expect(game(finals, "401859967")?.result?.series).toBe("NY wins 4–1");
    expect(game(finals, "401859967")?.notes).toEqual(["NBA Finals · Game 5 · NY wins 4–1"]);
  });
});

describe("team seasons", () => {
  const parsed = parseTeamSchedule(fixture("sched-team-soccer-359-results.json"), "soccer/all", "soccer", "soccer", MONDAY);
  const arsenal = { id: "espn-soccer-359", name: "Arsenal", logo: null };

  it("tells friendlies apart and settles a friendly's shootout", () => {
    const friendlies = parsed.items.filter(isFriendly);
    expect(friendlies).toHaveLength(4);
    expect(new Set(friendlies.map((f) => f.league))).toEqual(new Set(["club.friendly", "friendly.emirates_cup"]));
    const dortmund = parsed.items.find((i) => i.id === "espn-401881706")!;
    expect(dortmund.top?.winner).toBe(false);
    expect(dortmund.bottom?.winner).toBe(true);
    expect(dortmund.result?.shootout).toEqual({ top: 5, bottom: 4 });
    const o = outcome(dortmund, arsenal.id)!;
    expect(formMark(dortmund, o.letter, o.mine, o.other).readout).toContain("L 2–3 · won 5–4 on pens");
    expect(parsed.items.find((i) => i.id === "espn-401886555")?.result?.context).toBe("Arsenal win 4–3 on pens.");
  });

  it("summarizes a season", () => {
    const season = summarizeSeason(parsed.items, arsenal, "2026–27", true, parsed.summary);
    expect([season.played, season.won, season.drawn, season.lost]).toEqual([13, 11, 1, 1]);
    expect([season.scoredFor, season.scoredAgainst]).toEqual([26, 9]);
    expect(season.record).toBe("7–0–1");
    expect(season.standing).toBe("2nd in Premier League");
    expect(season.form.slice(-5).map((m) => m.letter)).toEqual(["W", "W", "W", "D", "W"]);
    expect(season.form).toHaveLength(10);
    expect(season.form[9]?.readout).toBe("Sat, Oct 24 · W 2–0 vs Everton · Premier League");
    expect(season.form[9]?.spoken).toBe("October 24, won 2 to 0 against Everton");
    expect(season.results[0]?.id).toBe("espn-401878768");
    expect(summarizeSeason(parsed.items, arsenal, "2026–27", true, parsed.summary, true).played).toBe(17);
  });

  it("computes a past season's record", () => {
    const kc = parseTeamSchedule(fixture("sched-team-nfl-12-2024.json"), "football/nfl", "nfl", "football", MONDAY);
    const chiefs = summarizeSeason(kc.items, { id: "espn-football-12", name: "Chiefs", logo: null }, "2024", false, kc.summary);
    expect(kc.items).toHaveLength(17);
    expect(kc.summary).toBe("5–1 · 1st in AFC West");
    expect(chiefs.record).toBe("15–2");
    expect(chiefs.standing).toBeNull();
  });

  it("labels seasons and builds history URLs", () => {
    expect(seasonLabel(2023, "soccer", "eng.1")).toBe("2023–24");
    expect(seasonLabel(2024, "basketball", "nba")).toBe("2023–24");
    expect(seasonLabel(2024, "football", "nfl")).toBe("2024");
    const cs = decodeURIComponent(csHistoryURL([667], 1));
    expect(cs).toContain("filter[matches.team_ids][overlap]=667");
    expect(cs).toContain("filter[matches.status][in]=finished,defwin");
    expect(cs).toContain("filter[matches.tier][in]=s");
    expect(cs).toContain("page[offset]=20");
  });
});

describe("worst cases", () => {
  const side = (id: string, name: string, score: string, homeAway: string, winner: boolean) => ({
    homeAway,
    score,
    winner,
    team: { id, shortDisplayName: name, displayName: name, abbreviation: name.slice(0, 3).toUpperCase() },
  });
  const synthetic = (id: string, status: string, short: string, o: { completed?: boolean; period?: number; home: [string, string, string]; away: [string, string, string]; winner?: string; details?: unknown[]; notes?: string[] }) => ({
    id,
    date: "2026-12-26T15:00Z",
    competitions: [
      {
        competitors: [side(...o.home, "home", o.winner === o.home[0]), side(...o.away, "away", o.winner === o.away[0])],
        details: o.details ?? [],
        notes: (o.notes ?? []).map((headline) => ({ headline })),
        status: { period: o.period ?? 2, type: { name: status, state: "post", completed: o.completed ?? true, shortDetail: short } },
      },
    ],
  });
  const goal = (team: string, short: string, id: string, minute: string) => ({ scoringPlay: true, team: { id: team }, clock: { displayValue: minute }, athletesInvolved: [{ shortName: short, id, team: { id: team } }] });
  const W: [string, string, string] = ["10", "Wolves", "1"];
  const L: [string, string, string] = ["20", "Leeds", "1"];
  const zero = (t: [string, string, string]): [string, string, string] => [t[0], t[1], "0"];
  const soccer = parseScoreboard(
    {
      events: [
        synthetic("1", "STATUS_FULL_TIME", "FT", { home: W, away: L, details: [goal("10", "N. Jackson", "a", "6'"), goal("20", "B. Jackson", "b", "52'")] }),
        synthetic("2", "STATUS_FULL_TIME", "FT", { home: zero(W), away: zero(L) }),
        synthetic("3", "STATUS_ABANDONED", "Abandoned", { completed: false, home: W, away: zero(L) }),
        synthetic("4", "STATUS_FORFEIT", "Forfeit", { home: W, away: zero(L), winner: "10" }),
        synthetic("5", "STATUS_POSTPONED", "Postponed", { completed: false, home: zero(W), away: zero(L), notes: ["Snow"] }),
        synthetic("6", "STATUS_FINAL_PEN", "FT-Pens", { period: 5, home: zero(W), away: zero(L), winner: "20", notes: ["Leeds advance 5-4 on penalties"] }),
        synthetic("w", "STATUS_WALKOVER", "W/O", { completed: false, home: zero(W), away: zero(L), winner: "20" }),
        synthetic("c", "STATUS_CANCELED", "Canceled", { completed: false, home: zero(W), away: zero(L) }),
      ],
    },
    "soccer/eng.1",
    "eng.1",
    "soccer",
    MONDAY,
  );

  it("keeps initials for two people with one surname, and says a draw", () => {
    const g = game(soccer, "1")!;
    expect(g.result?.details).toBe("N. Jackson 6' · B. Jackson 52'");
    expect(g.top?.winner).toBe(false);
    expect(g.result?.spoken).toContain("draw");
    expect(game(soccer, "2")?.result).toMatchObject({ details: null, context: null });
  });

  it("handles abandoned, forfeits, walkovers, postponed and canceled games", () => {
    expect(game(soccer, "3")).toMatchObject({ status: "final", result: { kind: "abandoned", label: "Abandoned", context: "Abandoned · score at the time" }, top: { score: "1", winner: false } });
    expect(game(soccer, "4")).toMatchObject({ result: { kind: "forfeit", label: "Forfeit", context: "Awarded to Wolves" }, top: { score: null, winner: true } });
    expect(game(soccer, "5")).toMatchObject({ status: "postponed", result: { label: "Postponed", context: "Snow" }, top: { score: null } });
    expect(game(soccer, "w")).toMatchObject({ status: "final", result: { kind: "forfeit", context: "Awarded to Leeds" }, top: { score: null }, bottom: { winner: true } });
    expect(game(soccer, "c")).toMatchObject({ status: "canceled", result: { label: "Canceled", spoken: "Wolves versus Leeds, canceled." }, top: { score: null } });
    expect(game(soccer, "6")?.result?.shootout).toEqual({ top: 4, bottom: 5 });
    expect(game(soccer, "6")?.bottom?.winner).toBe(true);
  });

  it("says long games and ties", () => {
    const long = {
      events: [
        synthetic("7", "STATUS_FINAL", "Final/19", { period: 19, home: ["1", "Mets", "4"], away: ["2", "Orioles", "3"] }),
        synthetic("8", "STATUS_FINAL", "Final/7OT", { period: 11, home: ["3", "Illinois", "20"], away: ["4", "Penn State", "18"] }),
        synthetic("9", "STATUS_FINAL", "Final/OT", { period: 5, home: ["5", "Giants", "20"], away: ["6", "Eagles", "20"] }),
      ],
    };
    const mlb = parseScoreboard(long, "baseball/mlb", "mlb", "baseball", MONDAY);
    expect(game(mlb, "7")?.result?.spoken).toContain("19 innings");
    const football = parseScoreboard(long, "football/nfl", "nfl", "football", MONDAY);
    expect(game(football, "8")?.result?.spoken).toContain("7th overtime");
    expect(game(football, "9")?.top?.winner).toBe(false);
    expect(game(football, "9")?.result?.spoken).toContain("tie");
  });

  it("drops a CS2 forfeit's fake score", () => {
    const defwin = scheduleItem({
      id: "cs-1",
      sport: "esports",
      league: "cs2",
      day: day(2026, 10, 29),
      start: { kind: "exact", date: MONDAY },
      status: "final",
      statusDetail: "Forfeit",
      top: scheduleTeam({ id: "cs-1", name: "G2", abbreviation: "G2", score: "1", winner: true }),
      bottom: scheduleTeam({ id: "cs-2", name: "Vexar", abbreviation: "VEX", score: "0" }),
      ref: { kind: "counterStrike", slug: "g2-vs-vexar", tournament: null },
    });
    const awarded = counterStrikeResult(defwin);
    expect(awarded.top?.score).toBeNull();
    expect(awarded.result).toMatchObject({ kind: "forfeit", context: "Awarded to G2", spoken: "G2 versus Vexar, forfeit, awarded to G2." });
    expect(roundSummary([awarded], "esports")).toBe("1 result");
    expect(roundSummary([game(soccer, "5")!], "soccer")).toBe("Postponed");
    expect(roundSummary([game(soccer, "5")!, game(soccer, "5")!, game(soccer, "5")!], "soccer")).toBe("All 3 games postponed");
  });
});

describe("rounds", () => {
  const epl = leagueWithID("eng.1")!;
  const today = day(2026, 10, 26);
  const calendar = parseCalendar(fixture("sched-eng1-undated.json"));
  const items = [...board("sched-eng1-month-202608.json", "soccer/eng.1", "eng.1", "soccer"), ...board("sched-eng1-month-202610.json", "soccer/eng.1", "eng.1", "soccer")];

  it("lays out matchweeks where loaded, dates until they load", () => {
    const layout = roundsLayout(calendar.days, items, calendar, epl, today);
    expect(layout.rounds.map(roundLabel)).toEqual([
      "Matchweek 1 · Aug 21–24",
      "Matchweek 2 · Aug 28–31",
      "Sep 4–6",
      "Sep 12–14",
      "Sep 18–20",
      "Matchweek 6 · Oct 10–12",
      "Matchweek 7 · Oct 17–19",
      "Matchweek 8 · Oct 23–25",
    ]);
    const mw8 = layout.rounds[layout.rounds.length - 1]!;
    expect(mw8).toMatchObject({ kind: "matchweek", section: "2026–27", played: 10, total: 10 });
    expect(layout.members.get(mw8.id)).toHaveLength(10);
    expect(layout.rounds[2]).toMatchObject({ kind: "dates", played: null });
    expect(buildRounds(calendar.days, items, calendar, epl, today, MONDAY).map((r) => r.id)).toEqual(layout.rounds.map((r) => r.id));
    expect(roundSummary(layout.members.get(mw8.id) ?? [], "soccer")).toBe("10 results · 19 goals");
  });

  const synthetic = (id: string, d: DayKey, gamesPlayed: number | null, leg: number | null = null) =>
    scheduleItem({
      id,
      sport: "soccer",
      league: "eng.1",
      day: d,
      start: { kind: "exact", date: Date.UTC(d.year, d.month - 1, d.day, 15) },
      status: "final",
      top: scheduleTeam({ id: `a${id}`, name: "A", score: "1" }),
      bottom: scheduleTeam({ id: `b${id}`, name: "B", score: "0" }),
      ref: { kind: "espn", path: "soccer/eng.1", id },
      result: resultDetail({ label: "FT", leg, gamesPlayed }),
    });

  it("splits a holiday run of two matchweeks, not a rearranged game", () => {
    const boxing = [26, 27, 28, 29, 30].map((d) => day(2026, 12, d));
    const run = [...Array.from({ length: 10 }, (_, i) => synthetic(`h18-${i}`, boxing[Math.floor(i / 4)]!, 18)), ...Array.from({ length: 10 }, (_, i) => synthetic(`h19-${i}`, boxing[2 + Math.floor(i / 4)]!, 19))];
    const split = roundsLayout(boxing, run, null, epl, day(2027, 1, 2));
    expect(split.rounds.map(roundLabel)).toEqual(["Matchweek 18 · Dec 26–28", "Matchweek 19 · Dec 28–30"]);
    expect(split.rounds.every((r) => split.members.get(r.id)?.length === 10)).toBe(true);
    const january = [9, 10, 11].map((d) => day(2027, 1, d));
    const rearranged = [...Array.from({ length: 9 }, (_, i) => synthetic(`j${i}`, january[i % 3]!, 21)), synthetic("j9", january[1]!, 20)];
    const one = roundsLayout(january, rearranged, null, epl, day(2027, 1, 12));
    expect(one.rounds.map((r) => r.title)).toEqual(["Matchweek 21"]);
  });

  it("names cup stages and legs", () => {
    const ucl = leagueWithID("uefa.champions")!;
    const uclCalendar = parseCalendar(fixture("sched-ucl-calendar.json"));
    const md3 = roundsLayout([], board("sched-ucl-day.json", "soccer/uefa.champions", "uefa.champions", "soccer"), uclCalendar, ucl, today);
    expect(md3.rounds.map((r) => r.title)).toEqual(["League Phase · Matchday 3"]);
    expect(md3.rounds[0]).toMatchObject({ section: "League Phase", kind: "stage" });
    const march: ScheduleCalendar = { days: [], offDays: null, seasonStart: null, seasonEnd: null, weeks: [{ label: "Rd of 16", detail: "", number: 3, seasonType: 2, start: Date.parse("2026-03-09T08:00:00Z"), end: Date.parse("2026-04-06T06:59:00Z") }] };
    const r16 = roundsLayout([], board("sched-ucl-two-legs.json", "soccer/uefa.champions", "uefa.champions", "soccer"), march, ucl, today);
    expect(r16.rounds.map(roundLabel)).toEqual(["Round of 16 · 1st legs · Mar 10–11", "Round of 16 · 2nd legs · Mar 17–18"]);
  });

  it("steps football weeks, and keeps the last week with a final", () => {
    const nflCalendar = parseCalendar(fixture("sched-nfl-undated.json"));
    const nfl = leagueWithID("nfl")!;
    const weeks = buildRounds([], [], nflCalendar, nfl, today, MONDAY);
    expect(weeks[weeks.length - 1]).toMatchObject({ title: "Week 7", week: 7, seasonType: 2, detail: "Oct 21–27", section: "Regular Season" });
    expect(weeks[0]?.title).toBe("Week 1");
    const wednesday = buildRounds([], [], nflCalendar, nfl, today, Date.parse("2026-10-28T12:00:00Z"));
    expect(latestRound(wednesday, (r) => (r.week === 8 ? false : true))?.title).toBe("Week 7");
  });

  it("finds daily leagues' game days, skipping days off", () => {
    const mlbCalendar = parseCalendar(fixture("sched-mlb-undated.json"));
    const days = pastGameDays(mlbCalendar, today);
    expect(days.slice(-3)).toEqual([day(2026, 10, 23), day(2026, 10, 24), today]);
    const mlbRounds = buildRounds(days, [], mlbCalendar, leagueWithID("mlb")!, today, MONDAY);
    expect(latestRound(mlbRounds, (r) => (r.first.day === 26 ? false : null))?.first).toEqual(day(2026, 10, 24));
    expect(mlbRounds[mlbRounds.length - 1]?.title).toBe(longDayLabel(today));
  });
});
