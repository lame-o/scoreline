/**
 * The season calendars and the season pages' rules (ScheduleProvider.swift
 * IFSC and CS, ScoreStore.tracked, SeasonCard, SeasonTimeline), against
 * trimmed recordings from 25–26 Oct 2026 (test/fixtures/season-*.json). The
 * cases follow Tests/SchedulesTests.swift and Tests/DockPagesTests.swift.
 */
import { describe, expect, it } from "vitest";
import { addingDays, type DayKey } from "../../src/data/days";
import type { SeasonEvent } from "../../src/data/schedule";
import {
  barMotion,
  byMonth,
  climbingSummary,
  clocked,
  csShortName,
  currentAndNext,
  dockLine,
  dockProgress,
  dockStrip,
  heroTuck,
  ifscStatus,
  nextEvent,
  parseEvent,
  parseRegistrations,
  parseSeasonEvents,
  parseSeasonRefs,
  parseTournament,
  parseTournaments,
  previousSeasonOver,
  prize,
  readout,
  resultsSummary,
  seasonEvent,
  timelineDomain,
  timelineHit,
  timelineLayout,
  topTen,
  tournamentResultsSummary,
  tournamentsLiveSummary,
  tournamentsNextSummary,
  tournamentsURL,
  tracked,
  tracking,
  wantsDetail,
  whenText,
  type SeasonAxis,
} from "../../src/data/seasons";
import { fixture } from "./fixtures";

const recorded = Date.parse("2026-10-26T02:00:00Z");
const day = (year: number, month: number, d: number): DayKey => ({ year, month, day: d });

describe("climbing seasons (IFSC)", () => {
  const list = parseSeasonRefs(fixture("season-ifsc-root.json"));
  const y2027 = parseSeasonEvents(fixture("season-ifsc-2027.json"), recorded);
  const y2026 = parseSeasonEvents(fixture("season-ifsc-2026.json"), recorded);

  it("addresses seasons by ID: 2026 is 38 (current), 2027 is 40", () => {
    expect(list.current).toEqual({ id: 38, name: "2026" });
    expect(currentAndNext(list).map((s) => s.id)).toEqual([38, 40]);
  });

  it("parses a season: 14 competitions in 2027, opening in Tokyo", () => {
    const tokyo = y2027[0]!;
    expect(y2027).toHaveLength(14);
    expect(tokyo).toMatchObject({ shortName: "Tokyo", startDay: day(2027, 4, 9), endDay: day(2027, 4, 11), timeZone: "Asia/Tokyo", lanes: ["boulder"], countryCode: "JP" });
    const brno = y2027.find((e) => e.shortName === "Brno");
    expect(brno?.badge).toBe("World Championships");
    expect(brno?.lanes).toEqual(["lead", "speed", "boulder"]);
    expect(y2027[y2027.length - 1]).toMatchObject({ shortName: "Paris", endDay: day(2027, 9, 26) });
  });

  it("leaves out cancelled, youth, continental and para events", () => {
    expect(y2026.some((e) => e.name.toLowerCase().includes("cancelled") || e.name.includes("Youth") || e.name.includes("Oceania"))).toBe(false);
  });

  it("knows what's live from the clock: Santiago underway on Oct 25 (Pacific), finished by the 27th", () => {
    const santiago = y2026.find((e) => e.shortName === "Santiago")!;
    expect(santiago.status).toBe("live");
    expect(ifscStatus(santiago.startsAt, santiago.endsAt, Date.parse("2026-10-27T12:00:00Z"))).toBe("finished");
    expect(clocked([santiago], Date.parse("2026-10-27T12:00:00Z"))[0]!.status).toBe("finished");
    expect(nextEvent([...y2026, ...y2027], recorded)?.shortName).toBe("Santiago");
    expect(nextEvent([...y2026, ...y2027], Date.parse("2026-10-27T12:00:00Z"))?.shortName).toBe("Tokyo");
  });

  it("parses a competition's detail: categories, merged rounds, podiums", () => {
    const santiago = y2026.find((e) => e.shortName === "Santiago")!;
    const detailed = parseEvent(fixture("season-ifsc-event-1489.json"), santiago);
    const lead = detailed.rounds.filter((r) => r.discipline === "Lead");
    expect(detailed.categories).toHaveLength(4);
    expect(lead.map((r) => r.name)).toEqual(["Qualification", "Semi-final", "Final"]);
    expect(lead.every((r) => new Set(r.categories).size === 2 && r.status === "finished" && r.start.kind === "tba")).toBe(true);
    expect(detailed.categories.find((c) => c.name === "Lead Women")?.podium).toEqual(["SLO Garnbret", "ITA Rogora", "SLO Rekar"]);
    expect(detailed.detailed).toBe(true);
    const tokyo = parseEvent(fixture("season-ifsc-event-1544.json"), y2027[0]!);
    expect(tokyo.categories.map((c) => c.name)).toEqual(["Boulder Men", "Boulder Women", "Boulder Mixed"]);
    expect(tokyo.rounds).toHaveLength(1);
    expect(tokyo.rounds[0]).toMatchObject({ categories: ["Men", "Women", "Mixed"], status: "pending" });
  });

  it("counts your countries' confirmed athletes", () => {
    const athletes = (fixture("season-ifsc-registrations-1489.json") as { athletes: unknown[] }).athletes;
    expect(parseRegistrations(athletes, new Set(["USA", "SLO"]))).toEqual({ USA: 18, SLO: 5 });
  });

  it("loads details on its own only for what's live or within two weeks", () => {
    const today = day(2026, 10, 26);
    const base = seasonEvent({ id: "x", kind: { kind: "climbing", id: 1 }, name: "X", shortName: "X", startDay: addingDays(today, 10), endDay: addingDays(today, 12), lanes: ["lead"], status: "upcoming" });
    expect(wantsDetail(base, today)).toBe(true);
    expect(wantsDetail({ ...base, startDay: addingDays(today, 20) }, today)).toBe(false);
    expect(wantsDetail({ ...base, status: "finished" }, today)).toBe(false);
    expect(wantsDetail({ ...base, status: "live", startDay: addingDays(today, -1) }, today)).toBe(true);
  });
});

describe("the disciplines you follow (SeasonEvent.tracking)", () => {
  const santiago = parseEvent(fixture("season-ifsc-event-1489.json"), parseSeasonEvents(fixture("season-ifsc-2026.json"), recorded).find((e) => e.shortName === "Santiago")!);

  it("keeps only the lanes, categories and rounds you follow", () => {
    const lead = tracking(santiago, ["lead", "boulder"])!;
    expect(lead.lanes).toEqual(["lead"]);
    expect(lead.categories.length).toBeGreaterThan(0);
    expect(lead.categories.every((c) => !c.name.toLowerCase().includes("speed"))).toBe(true);
    expect(lead.rounds.every((r) => r.discipline === "Lead")).toBe(true);
  });

  it("drops a competition of only disciplines you don't follow, entirely", () => {
    expect(tracking(santiago, ["boulder"])).toBeNull();
    const season = parseSeasonEvents(fixture("season-ifsc-2027.json"), recorded);
    const boulderOnly = tracked(season, ["boulder"]);
    const speedOnly = tracked(season, ["speed"]);
    expect(boulderOnly.every((e) => e.lanes.every((l) => l === "boulder"))).toBe(true);
    expect(speedOnly.some((e) => e.shortName === "Tokyo")).toBe(false);
    expect(tracked(season, [])).toEqual([]);
  });

  it("returns the same object when nothing is cut, and leaves CS2 alone", () => {
    expect(tracking(santiago, ["boulder", "lead", "speed"])).toBe(santiago);
    const cs = seasonEvent({ id: "cs-1", kind: { kind: "tournament", slug: "major" }, name: "Major", shortName: "Major", startDay: santiago.startDay, endDay: santiago.endDay, lanes: ["s"], status: "upcoming" });
    expect(tracking(cs, [])).toBe(cs);
  });
});

describe("CS2 tournaments (bo3.gg, S-tier)", () => {
  const upcoming = parseTournaments(fixture("season-bo3-tournaments-upcoming.json"));

  it("parses S-tier tournaments onto one lane", () => {
    expect(upcoming).toHaveLength(7);
    expect(upcoming[0]).toMatchObject({ shortName: "IEM Beijing", name: "Intel Extreme Masters Beijing 2026", startDay: day(2026, 11, 2), endDay: day(2026, 11, 7) });
    expect(upcoming.every((e) => e.lanes.join() === "s")).toBe(true);
    const singapore = upcoming.find((e) => e.shortName === "PGL Major Singapore");
    expect(singapore).toMatchObject({ badge: "Major", prize: 1_250_000, format: "LAN" });
    const current = parseTournaments(fixture("season-bo3-tournaments-current.json"));
    expect(current).toHaveLength(1);
    expect(current[0]).toMatchObject({ status: "live", shortName: "PGL Masters Bucharest" });
  });

  it("asks for S-tier only, and nothing else", () => {
    const url = decodeURIComponent(tournamentsURL("upcoming"));
    expect(url).toContain("filter[tournaments.tier][in]=s&");
  });

  it("reads prizes and names as fans say them", () => {
    expect([prize(1_250_000), prize(1_000_000), prize(1_320_000), prize(100_000), prize(750), prize(0)]).toEqual(["$1.25M", "$1M", "$1.32M", "$100K", "$750", null]);
    expect(csShortName("Intel Extreme Masters Beijing 2026")).toBe("IEM Beijing");
  });

  it("fills a tournament's field from its detail", () => {
    const beijing = parseTournament(fixture("season-bo3-tournament-iem-beijing-2026.json"), upcoming[0]!);
    expect(beijing.countryCode).toBe("CN");
    expect(beijing.teams).toHaveLength(16);
    expect(topTen(beijing.teams)).toBe(6);
    expect(beijing.teams[0]!.name).toBe("Legacy");
    expect(beijing.detailed).toBe(true);
  });
});

describe("the season card and the docked bar", () => {
  const ev = (id: string, m: number, d0: number, d1: number, lanes: string[] = ["boulder"], status: SeasonEvent["status"] = "finished") =>
    seasonEvent({ id, kind: { kind: "climbing", id: Number(id.slice(1)) }, name: id, shortName: id.toUpperCase(), startDay: day(2026, m, d0), endDay: day(2026, m, d1), lanes, status });
  const season = [ev("e3", 6, 10, 12, ["lead"]), ev("e1", 4, 9, 11), ev("e2", 4, 11, 13, ["lead", "speed"]), ev("e4", 9, 20, 28, ["lead", "boulder", "speed"], "upcoming")];
  const axis: SeasonAxis = { events: season, lanes: [], today: day(2026, 7, 1), next: "e4", selected: null, readouts: { e1: "E1 · Apr 9–11", e4: "E4 · Sep 20–28" }, resting: "e4" };

  it("reads out what's under the pointer, else what's resting", () => {
    expect(readout(axis, "e1")).toBe("E1 · Apr 9–11");
    expect(readout(axis, null)).toBe("E4 · Sep 20–28");
    expect(readout(axis, "nope")).toBe("E4 · Sep 20–28");
    expect(readout({ ...axis, resting: null }, null)).toBeNull();
    const s = { headline: "Next: E4", subline: "Sep 20–28 · in 81 days", live: false, sublineLive: false };
    expect(dockLine(s, null, axis)).toEqual({ lead: "Next: E4", trail: "Sep 20–28 · in 81 days" });
    expect(dockLine(s, "e1", axis)).toEqual({ lead: "E1 · Apr 9–11", trail: null });
  });

  it("lays the strip out: one mark per competition, in date order, clear of each other", () => {
    const domain = timelineDomain(season, axis.today);
    expect(domain).toEqual([day(2026, 4, 1), day(2026, 9, 30)]);
    const marks = dockStrip(season, domain, 300);
    expect(marks.map((m) => m.event)).toEqual(["e1", "e2", "e3", "e4"]);
    expect(marks.every((m) => m.width >= 4 && m.y >= 0 && m.y + m.height <= 10 && m.x + m.width <= 304)).toBe(true);
    for (let i = 1; i < marks.length; i++) expect(marks[i]!.x).toBeGreaterThanOrEqual(marks[i - 1]!.x + marks[i - 1]!.width + 1.5 - 0.001);
    expect(marks[3]!.width).toBeGreaterThan(marks[0]!.width);
    expect(timelineHit(marks, marks[2]!.x + marks[2]!.width / 2, 5, 10)).toBe("e3");
    expect(timelineHit(marks, marks[3]!.x + marks[3]!.width + 40, 5, 10)).toBeNull();
  });

  it("lays the timeline out by lane: each competition in each of its disciplines", () => {
    const lanes = [
      { id: "boulder", label: "Boulder" },
      { id: "lead", label: "Lead" },
    ];
    const marks = timelineLayout(season, lanes, timelineDomain(season, axis.today), 300);
    expect(marks.filter((m) => m.lane === "boulder").map((m) => m.event)).toEqual(["e1", "e4"]);
    expect(marks.filter((m) => m.lane === "lead").map((m) => m.event)).toEqual(["e2", "e3", "e4"]);
    expect(marks.every((m) => m.width >= 6)).toBe(true);
  });

  it("docks in 1/64 steps from a quarter under to three quarters, as the card tucks and fades", () => {
    expect(dockProgress(0, 120)).toBe(0);
    expect(dockProgress(30, 120)).toBe(0);
    expect(dockProgress(200, 120)).toBe(1);
    expect(dockProgress(60, 120) * 64).toBe(Math.round(dockProgress(60, 120) * 64));
    expect(heroTuck(0, 120)).toEqual({ scale: 1, opacity: 1 });
    expect(heroTuck(90, 120).scale).toBeCloseTo(0.94);
    expect(heroTuck(90, 120).opacity).toBe(0);
    expect(barMotion(0)).toMatchObject({ opacity: 0, interactive: false });
    expect(barMotion(1)).toMatchObject({ opacity: 1, scale: 1, offset: 0, interactive: true });
    expect(barMotion(0.5).interactive).toBe(true);
  });

  it("groups by month, oldest or newest first", () => {
    expect(byMonth(season, (e) => e.startDay).map((g) => g.month.month)).toEqual([6, 4, 9].sort((a, b) => a - b));
    expect(byMonth(season, (e) => e.startDay, true).map((g) => g.items.map((e) => e.id))).toEqual([["e4"], ["e3"], ["e1", "e2"]]);
  });
});

describe("summaries", () => {
  const today = day(2026, 10, 26);
  it("says when: today, tomorrow, a weekday within the week, else in days", () => {
    expect(whenText(today, today)).toBe("starts today");
    expect(whenText(addingDays(today, 1), today)).toBe("starts tomorrow");
    expect(whenText(addingDays(today, 3), today)).toMatch(/^starts /);
    expect(whenText(addingDays(today, 12), today)).toBe("in 12 days");
  });

  it("climbing: live, between seasons, next, done", () => {
    const santiago = seasonEvent({ id: "e9", kind: { kind: "climbing", id: 9 }, name: "E9", shortName: "E9", countryCode: "CL", startDay: day(2026, 10, 23), endDay: day(2026, 10, 25), lanes: ["lead"], status: "live" });
    expect(climbingSummary(santiago, null, null, today)).toEqual({ headline: "Live now · 🇨🇱 E9", subline: "Oct 23–25 · Lead", live: true, sublineLive: false });
    const tokyo = seasonEvent({ id: "t", kind: { kind: "climbing", id: 1544 }, name: "Tokyo", shortName: "Tokyo", countryCode: "JP", startDay: day(2027, 4, 9), endDay: day(2027, 4, 11), lanes: ["boulder"], status: "upcoming" });
    const between = climbingSummary(null, tokyo, "2026", today);
    expect(between).toMatchObject({ live: false, headline: "2026 season complete", subline: "2027 starts Apr 9 in Tokyo · 165 days" });
    expect(climbingSummary(null, tokyo, null, today)).toMatchObject({ headline: "Next: 🇯🇵 Tokyo", subline: "Apr 9–11 · in 165 days" });
    expect(climbingSummary(null, null, null, today).headline).toBe("Season complete");
    const done = { ...santiago, status: "finished" as const };
    expect(previousSeasonOver(null, tokyo, ["2026", "2027"], { "2026": [done] })).toBe("2026");
    expect(previousSeasonOver(null, tokyo, ["2026", "2027"], { "2026": [{ ...santiago, status: "upcoming" }] })).toBeNull();
  });

  it("results: the season done, or how far along", () => {
    expect(resultsSummary("2026", 10, 10)).toMatchObject({ headline: "2026 season complete", subline: "10 competitions" });
    expect(resultsSummary("2026", 7, 10).subline).toBe("7 of 10 competitions finished");
  });

  it("CS2: what's next, what's underway, and how many results", () => {
    const beijing = seasonEvent({ id: "cs-1", kind: { kind: "tournament", slug: "iem-beijing-2026" }, name: "IEM Beijing", shortName: "IEM Beijing", startDay: day(2026, 11, 2), endDay: day(2026, 11, 7), lanes: ["s"], status: "upcoming", prize: 1_250_000 });
    expect(tournamentsNextSummary(beijing, today)).toMatchObject({ headline: "Next: IEM Beijing", subline: "Nov 2–7 · in 7 days · $1.25M" });
    expect(tournamentsNextSummary(null, today).headline).toBe("No S-tier tournaments ahead");
    const live = { ...beijing, status: "live" as const };
    expect(tournamentsLiveSummary(live, { state: "live", teams: ["G2", "Vitality"], when: "" })).toEqual({ headline: "Live now · IEM Beijing", subline: "Live: G2 v Vitality", live: true, sublineLive: true });
    expect(tournamentsLiveSummary(live, null)).toMatchObject({ subline: "Nov 2–7 · $1.25M", sublineLive: false });
    const other = seasonEvent({ id: "e1", kind: { kind: "climbing", id: 1 }, name: "E1", shortName: "E1", startDay: day(2026, 5, 3), endDay: day(2026, 5, 9), lanes: [], status: "finished" });
    expect(tournamentResultsSummary([live, other])).toMatchObject({ headline: "2 S-tier tournaments", subline: "Since May 2026" });
    expect(tournamentResultsSummary([live]).headline).toBe("1 S-tier tournament");
    expect(tournamentResultsSummary([]).headline).toBe("No S-tier results yet");
  });
});
