/**
 * Results for climbing and CS2 (SeasonResults.swift), following
 * Tests/SeasonResultsTests.swift: IFSC full results, ties, speed's
 * elimination final, the round a past result opens, bo3.gg placings, a
 * tournament's rounds and forfeits. Trimmed recordings from 26 Oct 2026.
 */
import { describe, expect, it } from "vitest";
import { parseCSMatches } from "../../src/data/providers/schedule";
import { counterStrikeResult } from "../../src/data/results";
import { itemEvent } from "../../src/data/schedule";
import { stepsBack } from "../../src/data/models";
import {
  best,
  displayName,
  finalLine,
  finishedSlug,
  finishedURL,
  lastScore,
  matchGroups,
  parseCategory,
  parseFinished,
  parseStage,
  parseTournamentMatches,
  placeLabel,
  resultSeasons,
  resultsTTL,
  roundEvent,
  scoreIn,
  shownGroups,
  stageName,
  standaloneEvent,
  tournamentMatchesURL,
  winners,
} from "../../src/data/seasonResults";
import { prize } from "../../src/data/seasons";
import { fixture } from "./fixtures";

const now = Date.parse("2026-10-26T17:00:00Z");
const changes = <T>(list: readonly T[]) => list.reduce<T[]>((out, x) => (out[out.length - 1] === x ? out : [...out, x]), []);

describe("an IFSC competition opened cold", () => {
  const santiago = standaloneEvent(fixture("season-ifsc-event-1489.json"), now)!;

  it("builds itself from its own detail", () => {
    expect(santiago).toMatchObject({ id: "ifsc-1489", shortName: "Santiago", startDay: { year: 2026, month: 10, day: 23 }, endDay: { year: 2026, month: 10, day: 25 }, countryCode: "CL", status: "finished" });
    const lead = santiago.categories.find((c) => c.name === "Lead Women")!;
    expect(lead.dcatID).toBe(5);
    expect(lead.rounds.map((r) => r.id)).toEqual([10451, 11360, 11362]);
    expect(lead.rounds.map((r) => r.name)).toEqual(["Qualification", "Semi-final", "Final"]);
    expect(lead.rounds[2]!.resultPath).toBe("/api/v1/category_rounds/11362/results");
    expect(lead.podiumAthletes[0]).toEqual({ athleteID: 1147, rank: 1, first: "Janja", last: "Garnbret", country: "SLO" });
    expect(santiago.categories.map((c) => c.name)).toEqual(["Speed Men", "Speed Women", "Lead Men", "Lead Women"]);
  });

  it("names every category's winner, or the first two", () => {
    expect(winners(santiago)).toBe("🥇 🇨🇳 Zhao · 🇨🇳 Deng · 🇨🇭 Utelli · 🇸🇮 Garnbret");
    expect(winners(santiago, 2)).toBe("🥇 🇨🇳 Zhao · 🇨🇳 Deng");
  });

  it("opens a finished round on the match page", () => {
    const lead = santiago.categories.find((c) => c.name === "Lead Women")!;
    const e = roundEvent(santiago, lead.name, lead.rounds[2]!, "🇸🇮 J. Garnbret")!;
    expect(e).toMatchObject({ id: "ifsc-1489-r11362", state: "final", detail: "Final", caption: "Santiago 2026", content: { kind: "field", title: "Lead Women", summary: "Final · Winner 🇸🇮 J. Garnbret" } });
    expect(e.ref).toEqual({ kind: "climbing", eventID: 1489, category: "Lead Women", resultURL: "/api/v1/category_rounds/11362/results", round: "Final", eventName: "Santiago", nextURL: null });
  });

  it("offers the current season and earlier in the results menu, newest first", () => {
    const menu = resultSeasons({ current: { id: 38, name: "2026" }, all: [{ id: 40, name: "2027" }, { id: 38, name: "2026" }, { id: 37, name: "2025" }, { id: 42, name: "2032" }] }, { year: 2026, month: 10, day: 26 });
    expect(menu.map((s) => s.name)).toEqual(["2026", "2025"]);
    expect(resultsTTL(Date.parse("2026-10-20T00:00:00Z"), Date.parse("2026-10-26T00:00:00Z"))).toBe(30 * 86_400_000);
    expect(resultsTTL(Date.parse("2026-10-25T12:00:00Z"), Date.parse("2026-10-26T00:00:00Z"))).toBe(30 * 60_000);
  });
});

describe("a category's full results", () => {
  const lead = parseCategory(fixture("season-ifsc-result-1489-5.json"));

  it("ranks every athlete with each round climbed", () => {
    expect(lead.rows).toHaveLength(48);
    expect(lead.category).toBe("Lead Women");
    expect(lead.discipline).toBe("lead");
    expect(lead.rounds.map((r) => r.short)).toEqual(["Qual.", "Semi", "Final"]);
    const garnbret = lead.rows[0]!;
    expect(garnbret).toMatchObject({ name: "Janja Garnbret", rank: 1, country: "SLO" });
    expect(garnbret.scores.map((s) => s.rank)).toEqual([1, 1, 1]);
    expect(scoreIn(garnbret, 10451)?.score).toBe("1.0");
    expect(lastScore(garnbret)?.score).toBe("TOP");
    expect(garnbret.spoken).toBe("1st, Janja Garnbret, Slovenia, final: top");
  });

  it("drops round by round: Final, Semi-final, Qualification", () => {
    const fisher = lead.rows.find((r) => r.name === "Ella Fisher")!;
    const oda = lead.rows.find((r) => r.name === "Natsumi Oda")!;
    expect([fisher.rank, fisher.stage, lastScore(fisher)?.score]).toEqual([8, "Final", "37+"]);
    expect([oda.rank, oda.stage, lastScore(oda)?.score]).toEqual([9, "Semi-final", "36+"]);
    expect(changes(lead.rows.map((r) => r.stage))).toEqual(["Final", "Semi-final", "Qualification"]);
  });

  it("repeats a tied rank, sorted by surname inside it", () => {
    const boulder = parseCategory(fixture("season-ifsc-result-1488-7.json"));
    const tied = boulder.rows.filter((r) => r.rank === 55);
    expect(boulder.rows).toHaveLength(58);
    expect(tied).toHaveLength(4);
    expect(tied.every((r) => r.tied && r.rankText === "55")).toBe(true);
    expect(boulder.rows[0]!.tied).toBe(false);
    expect(tied.map((r) => r.name)).toEqual(["Aimara Luz Baldasare Tello", "Florencia Gomez Claro", "Iris Heikkinen", "Tamara Fatima Ortiz Ruiz"]);
    expect(tied[0]!.spoken.startsWith("55th, tied, Aimara Luz Baldasare Tello, Argentina, qualification: 0")).toBe(true);
  });

  it("places speed's elimination final by heat", () => {
    const speed = parseCategory(fixture("season-ifsc-result-1489-2.json"));
    const zurloni = speed.rows.find((r) => r.name.endsWith("Zurloni"))!;
    expect(zurloni.rank).toBe(16);
    expect(lastScore(zurloni)).toMatchObject({ score: "5.43 (5.12)", placing: "Round of 16" });
    expect(zurloni.stage).toBe("Round of 16");
    expect(speed.rows.slice(0, 9).map((r) => lastScore(r)?.placing ?? "-")).toEqual(["1st", "2nd", "3rd", "4th", "Quarter-final", "Quarter-final", "Quarter-final", "Quarter-final", "Round of 16"]);
    expect(changes(speed.rows.map((r) => r.stage))).toEqual(["Final", "Quarter-final", "Round of 16", "Qualification"]);
    expect(lastScore(speed.rows.find((r) => r.rank === 52)!)?.score).toBe("10.54");
  });

  it("finds your countries' best off the podium", () => {
    const found = best(lead, new Set(["USA", "JPN"]));
    expect(found.map((b) => `${b.country} ${b.rank}`)).toEqual(["JPN 5", "USA 8"]);
    expect(found[1]!.text).toBe("🇺🇸 Ella Fisher · 8th");
    expect(best(lead, new Set(["SLO"]))).toEqual([]);
  });
});

describe("finished CS2 tournaments", () => {
  const page = parseFinished(fixture("season-bo3-finished-page0.json"));

  it("parses placings, sorted, with prize money", () => {
    expect(page.items).toHaveLength(12);
    expect(page.total).toBe(138);
    const epl = page.items.find((t) => finishedSlug(t) === "esl-pro-league-season-24")!;
    expect(epl.bo3ID).toBe(5110);
    expect(epl.event.status).toBe("finished");
    const p = epl.placements;
    expect(p).toHaveLength(16);
    expect(p[0]).toMatchObject({ place: "1st", money: 125_000, clubMoney: 170_000, team: { name: "Vitality", id: "cs-667" } });
    expect(p[1]).toMatchObject({ place: "2nd", team: { name: "MOUZ" } });
    expect(p.filter((x) => x.place === "5th–8th")).toHaveLength(4);
    expect(p[p.length - 1]!.place).toBe("15th–16th");
    expect(epl.summary).toBe("🏆 Vitality · 2nd MOUZ · $1M");
  });

  it("orders bo3.gg's shuffled lists, leaves out unnamed teams, shares top places in stages", () => {
    expect(page.items.find((t) => finishedSlug(t).startsWith("starladder"))?.placements.map((p) => p.order)).toEqual([1, 2, 3, 4, 5, 5, 7, 7]);
    const fissure = page.items.find((t) => finishedSlug(t).startsWith("fissure"))!;
    expect(fissure.placements).toHaveLength(15);
    expect(fissure.placements.filter((p) => p.place === "3rd–4th")).toHaveLength(1);
    const stage1 = page.items.find((t) => t.event.name.endsWith("Stage 1"))!;
    expect(stage1.placements[0]!.place).toBe("1st–2nd");
    expect(stage1.summary).toBe("1st–2nd B8, BetBoom");
    expect(stage1.placements.every((p) => prize(p.money) == null)).toBe(true);
    expect(stage1.title).toBe("IEM Cologne Major Stage 1");
  });

  it("leaves qualifiers out of an older page and keeps a prize without placings", () => {
    const older = parseFinished(fixture("season-bo3-finished-page2.json"));
    expect(older.items).toHaveLength(19);
    expect(older.items.some((t) => t.event.name.toLowerCase().includes("qualifier"))).toBe(false);
    expect(older.items[0]!.placements).toEqual([]);
    expect(older.items[0]!.summary).toBe("$1.22M");
  });

  it("reads names and places as words", () => {
    expect(displayName("Intel Extreme Masters Cologne Major 2026 Stage 2")).toBe("IEM Cologne Major Stage 2");
    expect(displayName("ESL Pro League Season 24")).toBe("ESL Pro League Season 24");
    expect(displayName("Esports World Cup 2026")).toBe("Esports World Cup");
    expect(["5-8th", "1-2nd", "3-4th", "25-32nd", "1st", "17-24th"].map((x) => placeLabel(x)?.place)).toEqual(["5th–8th", "1st–2nd", "3rd–4th", "25th–32nd", "1st", "17th–24th"]);
    const url = decodeURIComponent(finishedURL(1));
    for (const part of ["filter[tournaments.status][in]=finished", "sort=-end_date", "page[limit]=6", "page[offset]=6", "with=tournament_prizes", "filter[tournaments.tier][in]=s&"]) expect(url).toContain(part);
  });
});

describe("a tournament's matches by round", () => {
  const matches = parseTournamentMatches(fixture("season-bo3-matches-5110.json"), now);
  const stages = ["season-bo3-stage-10851.json", "season-bo3-stage-10850.json", "season-bo3-stage-10897.json"].map((f) => parseStage(fixture(f))!);
  const groups = matchGroups(matches, stages, "ESL Pro League Season 24");

  it("knows each match's stage and round", () => {
    expect(matches.items).toHaveLength(41);
    expect(matches.total).toBe(41);
    expect(Object.keys(matches.stage)).toHaveLength(41);
    expect(matches.round["cs-130754"]).toBe(40473);
    expect(stages[0]!.format).toBe("swiss");
    expect(stages[0]!.rounds).toHaveLength(5);
    expect(stages[2]!.rounds[0]!.name).toBe("3rd place");
  });

  it("lists rounds newest first: the final, 3rd place, semis, quarters, then Swiss rounds 5 to 1", () => {
    expect(groups.slice(0, 4).map((g) => g.title)).toEqual(["Grand final", "3rd place", "Semifinal", "Quarterfinal"]);
    expect(groups.slice(4).map((g) => g.title)).toEqual([5, 4, 3, 2, 1].map((n) => `Swiss · Round ${n}`));
    expect(groups[0]!.items).toHaveLength(1);
    expect(groups.reduce((n, g) => n + g.items.length, 0)).toBe(41);
    expect(shownGroups(groups, 16, false).reduce((n, g) => n + g.items.length, 0)).toBeGreaterThanOrEqual(16);
    expect(shownGroups(groups, 16, true)).toBe(groups);
  });

  it("names a group stage and takes a round's ID from its matches when it has none", () => {
    const trimmed = parseStage({ id: 1, title: "X Group Stage", format_type: "group", rounds: [{ name: "Round 1", round_index: 1, matches: [{ round_id: 77 }] }] })!;
    expect(trimmed.rounds[0]!.id).toBe(77);
    expect(stageName(trimmed, "X")).toBe("Group Stage");
  });

  it("says how the champion won the final", () => {
    const epl = parseFinished(fixture("season-bo3-finished-page0.json")).items.find((t) => t.bo3ID === 5110)!;
    expect(finalLine(epl, groups)).toBe("beat MOUZ 3–0 in the grand final");
    const url = decodeURIComponent(tournamentMatchesURL(5110, 100));
    for (const part of ["filter[matches.tournament_id][eq]=5110", "page[limit]=100", "page[offset]=100"]) expect(url).toContain(part);
  });

  it("labels every final, and a forfeit hides bo3.gg's fake 1–0", () => {
    expect(matches.items.every((m) => m.result?.label === "Final")).toBe(true);
    const forfeits = parseCSMatches(fixture("season-bo3-matches-defwin.json"), now).map(counterStrikeResult);
    const vexar = forfeits[0]!;
    expect(forfeits).toHaveLength(3);
    expect(vexar).toMatchObject({ status: "final", statusDetail: "Forfeit" });
    expect(vexar.result).toMatchObject({ kind: "forfeit", label: "Forfeit", context: "Awarded to Vexar" });
    expect(vexar.top?.score).toBeNull();
    const event = itemEvent(vexar);
    expect(event.content.kind === "match" && stepsBack(event, event.content.bottom)).toBe(true);
  });
});
