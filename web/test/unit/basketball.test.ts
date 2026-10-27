/**
 * The NBA page's parsers and rules (data/basketball.ts, Basketball.swift
 * `NBADetail`, BasketballReplay.swift `CourtScene`), on a recorded overtime
 * game (MIN @ CLE, Oct 26 2026: Anthony Edwards' 28-footer at the OT buzzer).
 */
import { describe, expect, it } from "vitest";
import {
  ball,
  boxColumnsFor,
  clockLabelAt,
  courtPlay,
  courtScene,
  courtStory,
  elapsed,
  flowReadout,
  flowStory,
  isLastFreeThrow,
  isThree,
  keyMoments,
  laneLinescore,
  lastName,
  litShots,
  mergeFlow,
  mergePlays,
  mergeShots,
  notPlayed,
  parseBasketball,
  periodLabels,
  periodStart,
  plain,
  possessionAfter,
  QUARTER,
  recentPlays,
  scoreLine,
  shotText,
  shotValue,
  signed,
  spanLabel,
  spokenBoxLine,
  spot,
  streaks,
  type CourtPlay,
} from "../../src/data/basketball";
import { parseESPNDetail } from "../../src/data/gameDetail";
import { liveMoment, Tier } from "../../src/data/moments";
import type { ScoreEvent } from "../../src/data/models";
import { fixture } from "./fixtures";

const summary = fixture("espn-nba-summary.json") as { plays: unknown[] };
// MIN (16) is away: top. CLE (5) at home: bottom.
const side = (id: string | null | undefined) => (id === "16" ? ("top" as const) : id === "5" ? ("bottom" as const) : null);
const nba = parseBasketball(summary, side, false);

describe("time", () => {
  it("counts game seconds through quarters and five-minute overtimes", () => {
    expect(elapsed(1, "12:00")).toBe(0);
    expect(elapsed(2, "4:12")).toBe(720 + 720 - 252);
    expect(elapsed(4, "33.8")).toBeCloseTo(2880 - 33.8);
    expect(elapsed(5, "5:00")).toBe(2880);
    expect(elapsed(6, "0:00")).toBe(2880 + 600);
    expect(elapsed(0, "1:00")).toBeNull();
    expect(elapsed(2, "")).toBeNull();
    // The WNBA's 10-minute quarters.
    expect(elapsed(2, "10:00", QUARTER.wnba)).toBe(600);
    expect(periodStart(5, QUARTER.wnba)).toBe(2400);
  });

  it("reads a game second back as the clock showed it", () => {
    expect(clockLabelAt(0)).toBe("Q1 12:00");
    expect(clockLabelAt(720)).toBe("Q1 0:00");
    expect(clockLabelAt(721)).toBe("Q2 11:59");
    expect(clockLabelAt(2880 + 15)).toBe("OT 4:45");
    expect(clockLabelAt(2880 + 300 + 60)).toBe("2OT 4:00");
    expect(spanLabel([1440 + 320, 1440 + 525])).toBe("Q3 6:40–3:15");
    expect(spanLabel([1440 - 70, 1440 + 90])).toBe("Q2 1:10–Q3 10:30");
  });

  it("names each overtime, or all of them once when they don't fit", () => {
    const x = (t: number) => t / 10;
    expect(periodLabels(5, x, () => 10).map((l) => l.text)).toEqual(["Q1", "Q2", "Q3", "Q4", "OT"]);
    expect(periodLabels(8, x, () => 40).map((l) => l.text)).toEqual(["Q1", "Q2", "Q3", "Q4", "4OT"]);
  });
});

describe("the summary", () => {
  it("reads every field-goal attempt toward the shooter's basket, free throws aside", () => {
    expect(nba.shots.length).toBeGreaterThan(150);
    expect(nba.shots.every((s) => s.value === 2 || s.value === 3)).toBe(true);
    expect(nba.shots.every((s) => s.x >= -5 && s.x <= 55 && s.y >= -5)).toBe(true);
    const winner = nba.shots.at(-1)!;
    expect(winner).toMatchObject({ made: true, value: 3, side: "top", period: 5, clock: "0.0", player: "4594268" });
    // Blocks name the blocker (the shot's second participant).
    expect(nba.shots.some((s) => !s.made && s.blocker != null)).toBe(true);
  });

  it("draws the game flow from tip-off, one point per change of score", () => {
    expect(nba.flow[0]).toMatchObject({ id: "tip", elapsed: 0, top: 0, bottom: 0 });
    expect(nba.flow.at(-1)).toMatchObject({ top: 125, bottom: 124, period: 5, scorer: "top" });
    for (let i = 1; i < nba.flow.length; i++) expect(nba.flow[i]!.elapsed).toBeGreaterThanOrEqual(nba.flow[i - 1]!.elapsed);
    expect(flowStory(nba.flow)).toEqual({ changes: 17, ties: 5, top: 15, bottom: 4 });
    expect(flowReadout(nba.flow.at(-1)!, "MIN", "CLE")).toEqual({ lead: "MIN +1", detail: "125–124 · OT 0.0" });
  });

  it("reads leaders, the box score (starters, bench by minutes, then DNPs) and injuries", () => {
    expect(nba.seasonLeaders).toBe(false);
    expect(nba.leaders.map((l) => l.category)).toEqual(["PTS", "REB", "AST"]);
    expect(nba.leaders[0]!.top).toMatchObject({ name: "A. Edwards", value: "47", detail: "19/34 FG", player: "4594268" });
    expect(nba.leaders[1]!.top!.detail).toBeNull();
    expect(nba.topBox.slice(0, 5).every((p) => p.starter)).toBe(true);
    expect(nba.topBox[0]!.stats).toMatchObject({ MIN: "37", PTS: "14", FG: "6-9", "+/-": "+5" });
    expect(nba.topTotals).toMatchObject({ PTS: "125", FG: "49-102" });
    expect(nba.topTotals.MIN).toBeUndefined();
    const out = nba.topBox.filter((p) => p.didNotPlay);
    expect(out.length).toBe(4);
    expect(nba.topBox.slice(-4)).toEqual(out);
    expect(notPlayed(out, false)).toBe("DNP: C. Williams, I. Evans, J. Clark, Z. Pullin · Coach's decision");
    expect(notPlayed(out.slice(0, 2), true)).toBe("Not in yet: C. Williams, I. Evans");
    expect(nba.injuries).toEqual([expect.objectContaining({ name: "D. DiVincenzo", status: "Out", detail: "Right achilles surgery", side: "top" })]);
  });

  it("tells the game's story: runs of 8+, late lead changes, each break", () => {
    const moments = keyMoments(summary, side, false);
    expect(moments.filter((m) => m.kind === "other").map((m) => m.text)).toEqual(["End of Q1", "Halftime", "End of Q3", "End of regulation", "Final"]);
    expect(moments.find((m) => m.text === "12–0 run")).toMatchObject({ side: "bottom", clock: "Q3 4:29" });
    const late = moments.filter((m) => m.text.startsWith("Lead change"));
    expect(late.every((m) => (m.period ?? 0) >= 4)).toBe(true);
    expect(late.at(-1)).toMatchObject({ side: "top", score: "125–124", clock: "OT 0.0" });
    expect(new Set(moments.map((m) => m.id)).size).toBe(moments.length);
  });

  it("reads the latest plays newest first, tidied", () => {
    const latest = recentPlays(summary.plays);
    expect(latest).toHaveLength(4);
    expect(latest[0]).toBe("OT 0.0  End of Game");
    expect(plain("LeBron James makes 26-foot jumper (Austin Reaves assists)")).toBe("LeBron James makes 26-foot jumper");
    expect(plain("Luka Doncic 's  25-foot")).toBe("Luka Doncic's 25-foot");
    expect(shotText("Mario Hezonja makes 25-foot three point jumper", "M. Hezonja")).toBe("M. Hezonja 25-ft three point jumper");
  });

  it("joins the NBA parse to the game detail (NBA stats, win probability by play)", () => {
    const event = { content: { kind: "match", top: { id: "espn-basketball-16" }, bottom: { id: "espn-basketball-5" } }, state: "final" } as unknown as ScoreEvent;
    const detail = parseESPNDetail(summary, { event, path: "basketball/nba", id: "401909869", sport: "basketball" });
    expect(detail.basketball?.shots.length).toBe(nba.shots.length);
    expect(detail.moments.at(-1)?.text).toBe("Final");
    expect(detail.stats.map((s) => s.label)).toContain("Points in the Paint");
    expect(detail.stats.find((s) => s.label === "Field Goal %")?.top).toMatch(/%$/);
    expect(detail.topWinProbability).not.toBeNull();
    expect(detail.drawProbability).toBeNull();
  });
});

describe("court plays and possession", () => {
  const play = (fields: Record<string, unknown>) => courtPlay({ id: "p", period: { number: 4 }, clock: { displayValue: "1:00" }, team: { id: "16" }, ...fields }, side, { top: 0, bottom: 0 })!;

  it("keeps the plays that move something, from their structured fields", () => {
    expect(nba.plays.length).toBeGreaterThan(nba.shots.length);
    const kinds = new Set(nba.plays.map((p) => p.kind.kind));
    for (const k of ["shot", "freeThrow", "rebound", "turnover", "foul", "periodEnd"]) expect(kinds.has(k as CourtPlay["kind"]["kind"])).toBe(true);
    expect(play({ type: { id: "155" } }).kind).toEqual({ kind: "rebound", offensive: false });
    expect(play({ type: { id: "62" }, participants: [{ athlete: { id: "1" } }, { athlete: { id: "2" } }] }).kind).toEqual({ kind: "turnover", steal: true });
    expect(play({ type: { id: "42" } }).kind).toEqual({ kind: "foul", offensive: true });
    expect(courtPlay({ id: "x", type: { id: "8" } }, side, { top: 0, bottom: 0 })).toBeNull();
  });

  it("places a rebound just off the rim toward the shot, a free throw at the line", () => {
    expect(spot(play({ type: { id: "156" }, coordinate: { x: 25, y: 20 } }))).toEqual({ x: 25, y: 4 });
    expect(spot(play({ type: { id: "98" }, shootingPlay: true }))).toEqual({ x: 25, y: 15 });
  });

  it("hands the ball over by the data spec's rule, and holds it in the air after a miss", () => {
    const made = play({ type: { id: "92" }, shootingPlay: true, scoringPlay: true, coordinate: { x: 25, y: 10 }, pointsAttempted: 2 });
    const missed = play({ type: { id: "92" }, shootingPlay: true, coordinate: { x: 25, y: 10 }, pointsAttempted: 2 });
    const board = play({ type: { id: "155" }, team: { id: "5" } });
    expect(possessionAfter(made, "top")).toBe("bottom");
    expect(possessionAfter(missed, "top")).toBeNull();
    expect(ball([missed])).toEqual({ side: "top", inAir: true });
    expect(ball([missed, board])).toEqual({ side: "bottom", inAir: false });
    expect(ball(nba.plays)).toEqual({ side: null, inAir: false });
  });

  it("knows the last free throw of a trip, and a shot's value", () => {
    expect(isLastFreeThrow({ type: { id: "98" } })).toBe(false);
    expect(isLastFreeThrow({ type: { id: "99" } })).toBe(true);
    expect(isLastFreeThrow({ type: { id: "999" }, text: "makes free throw 2 of 3" })).toBe(false);
    expect(shotValue({ pointsAttempted: 3 }, 25, 5)).toBe(3);
    expect(shotValue({}, 2, 5)).toBe(3);
    expect(isThree(25, 30)).toBe(true);
    expect(isThree(25, 10)).toBe(false);
  });

  it("counts a shooter's straight makes", () => {
    const shot = (made: boolean, player: string) => play({ type: { id: "92" }, shootingPlay: true, scoringPlay: made, coordinate: { x: 25, y: 10 }, participants: [{ athlete: { id: player } }] });
    expect(streaks([shot(true, "a"), shot(true, "a"), shot(false, "b"), shot(true, "a")])).toEqual({ a: 3 });
  });
});

describe("the replay's scene", () => {
  it("shows the shots up to the replay's moment, with the last plays trailing to the ball", () => {
    const scene = courtScene(nba.shots, nba.plays, 2900, false, false, null);
    expect(scene.style).toBe("trail");
    expect(scene.trail).toHaveLength(8);
    expect(scene.shots.every((s) => (s.elapsed ?? 0) <= 2900)).toBe(true);
    expect(scene.newest).not.toBeNull();
    expect(scene.score).toEqual({ top: 113, bottom: 116 });
  });

  it("is the whole chart once it's over, one player's shots when picked", () => {
    expect(courtScene(nba.shots, nba.plays, null, false, false, null)).toMatchObject({ style: "chart", trail: [] });
    const edwards = courtScene(nba.shots, nba.plays, null, false, false, "4594268");
    expect(edwards.shots.every((s) => s.player === "4594268")).toBe(true);
    expect(edwards.shots.filter((s) => s.made).length).toBe(19);
    expect(courtScene(nba.shots, nba.plays, 1000, false, true, null).style).toBe("playing");
  });

  it("lights what a focus means", () => {
    expect(litShots(nba.shots, { period: 5, side: "top" }).every((s) => s.period === 5 && s.side === "top")).toBe(true);
    expect(litShots(nba.shots, { span: [2880, 3180], side: "bottom" }).every((s) => s.side === "bottom")).toBe(true);
    expect(litShots(nba.shots, { play: nba.shots[3]!.id })).toEqual([nba.shots[3]]);
  });

  it("tells each shot's story at the rim", () => {
    const winner = nba.shots.at(-1)!;
    const m = liveMoment({ id: winner.id, chart: "court", tier: Tier.score, kind: "made", value: 3, lead: "Buzzer-beater", detail: "", side: "top", accents: ["buzzer", "decisive"] });
    expect(courtStory(m, null, nba.shots)).toMatchObject({ kind: "swish", lands: true, effects: null, side: "top" });
    const blocked = nba.shots.find((s) => !s.made && s.blocker)!;
    const miss = liveMoment({ id: blocked.id, chart: "court", tier: Tier.routine, kind: "missed", lead: "Miss", detail: "", side: blocked.side });
    expect(courtStory(miss, null, nba.shots)?.kind).toBe("rimOut");
    // ESPN added the block later: told again, stuffed.
    const block = liveMoment({ id: blocked.id, chart: "court", tier: Tier.swing, kind: "block", lead: "Block", detail: "", side: null });
    expect(courtStory(block, miss, nba.shots)).toMatchObject({ key: `${blocked.id}-block`, kind: "stuffed" });
    // An and-one logged after the make plays only its echo.
    const two = liveMoment({ id: winner.id, chart: "court", tier: Tier.routine, kind: "made", value: 2, lead: "Two", detail: "", side: "top" });
    const andOne = { ...two, accents: new Set(["andOne" as const]) };
    expect(courtStory(andOne, two, nba.shots)).toMatchObject({ kind: null, lands: false, effects: ["echo"] });
  });
});

describe("merging the live lane", () => {
  it("splices the lane's plays over the summary's from the first it shares", () => {
    const summary = nba.plays.slice(0, 100);
    const lane = nba.plays.slice(90, 120);
    expect(mergePlays(summary, lane).map((p) => p.id)).toEqual(nba.plays.slice(0, 120).map((p) => p.id));
    // An edit deletes a play the summary still has.
    const edited = lane.filter((_, i) => i !== 3);
    expect(mergePlays(summary, edited).some((p) => p.id === lane[3]!.id)).toBe(false);
  });

  it("adds only what's newer for shots and flow", () => {
    const shots = mergeShots(nba.shots.slice(0, 50), nba.shots[49]!.elapsed, nba.shots.slice(45, 60));
    expect(shots.map((s) => s.id)).toEqual(nba.shots.slice(0, 60).map((s) => s.id));
    const flow = mergeFlow(nba.flow.slice(0, 40), nba.flow.slice(38, 50));
    expect(flow.map((p) => p.id)).toEqual(nba.flow.slice(0, 50).map((p) => p.id));
  });

  it("puts the lane's points in T and the current period's cell, never behind", () => {
    const line = { headers: ["1", "2", "3", "4", "T"], top: ["20", "25", "30", "10", "85"], bottom: ["22", "21", "28", "8", "79"] };
    expect(laneLinescore(line, { top: 88, bottom: 81 }, 4)).toEqual({ ...line, top: ["20", "25", "30", "13", "88"], bottom: ["22", "21", "28", "10", "81"] });
    expect(laneLinescore(line, { top: 80, bottom: 79 }, 4)).toBe(line);
    // Across a break only T moves.
    expect(laneLinescore(line, { top: 88, bottom: 81 }, 5).top).toEqual(["20", "25", "30", "10", "88"]);
  });
});

describe("small formats", () => {
  it("formats names, scores and box lines", () => {
    expect(lastName("C. Cunningham")).toBe("Cunningham");
    expect(lastName("Nikola Jokić")).toBe("Nikola Jokić");
    expect(scoreLine(78, 71, "LAL", "BOS")).toBe("LAL 78–71");
    expect(scoreLine(74, 74, "LAL", "BOS")).toBe("Tied 74–74");
    expect(signed("-15")).toBe("−15");
    expect(boxColumnsFor("compact").map((c) => c.label)).toEqual(["MIN", "PTS", "REB", "AST", "+/-"]);
    expect(boxColumnsFor("xlarge")).toHaveLength(12);
    expect(spokenBoxLine({ PTS: "12", FG: "4-9", "+/-": "+3" }, boxColumnsFor("medium"))).toBe("12 points, 4 of 9 field goals, plus-minus +3");
  });
});

describe("team colors", () => {
  it("lets a team wear its second color when the two clash", async () => {
    const { nbaPalette, colorDifference } = await import("../../src/data/basketball");
    // Lakers purple beside Jazz purple: the Jazz (at home) wear their second color.
    const lakers = { color: "552583", alternateColor: "fdb927" };
    const jazz = { color: "4e008e", alternateColor: "79a3dc" };
    const p = nbaPalette(lakers, jazz, "light");
    expect(colorDifference(p.top, p.bottom)).toBeGreaterThanOrEqual(0.45);
    // Colors already apart stay as they are.
    const celtics = { color: "008348", alternateColor: "000000" };
    const { teamPalette } = await import("../../src/data/teamColors");
    expect(nbaPalette(lakers, celtics, "dark")).toEqual(teamPalette(lakers.color, celtics.color, "dark"));
  });
});
