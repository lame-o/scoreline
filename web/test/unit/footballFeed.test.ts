/**
 * The football fast lane (data/liveFeeds/football.ts, LiveFeeds.swift
 * `FootballFeed`) against the core API's plays of a recorded NFL game
 * (espn-nfl-core-plays.json: Giants at Texans, won in overtime), served as
 * if live: cut at a cursor, the situation standing on the last play served.
 */
import { describe, expect, it } from "vitest";
import {
  bigPlay,
  currentDrive,
  decides,
  driveContaining,
  driveSummary,
  FootballFeed,
  footballClock,
  footballMoment,
  footballPlay,
  footballSituation,
  goalToGo,
  lineToGain,
  playMoment,
  scoreBefore,
  twoMinuteDrill,
  yardsText,
  type FootballTeams,
} from "../../src/data/liveFeeds/football";
import { Tier } from "../../src/data/moments";
import { fixture } from "./fixtures";

type Item = Record<string, unknown> & { id: string; sequenceNumber: string; type: { id: string; text: string }; period: { number: number }; clock: { value: number; displayValue: string } };
interface CorePlays {
  count: number;
  pages: { page: number; pageCount: number; items: Item[] }[];
}

const core = fixture("espn-nfl-core-plays.json") as CorePlays;
const items = core.pages.flatMap((p) => p.items);
/** The Giants (19) visit the Texans (34): away first, so the top team isn't home. */
const teams: FootballTeams = { topIsHome: false, topID: "19", bottomID: "34", homeAbbreviation: "HOU", awayAbbreviation: "NYG" };
/** The play's place in the game (its last occurrence: the stretch the tests replay is the finish). */
const index = (text: string) => items.findLastIndex((i) => String(i.shortText ?? i.text ?? "").includes(text));
const BASE = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/1/competitions/1";

/** The core API as of `cursor()` plays: situation (from the last play's end), status and paged plays. */
function lane(cursor: () => number, edit: (item: Item) => Item = (i) => i) {
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    calls.push(url);
    const served = items.slice(0, cursor()).map(edit);
    const last = served.at(-1)!;
    const end = last.end as { down?: number; distance?: number; yardLine?: number };
    if (url.endsWith("/situation"))
      return {
        lastPlay: { $ref: `${BASE}/plays/${last.id}?lang=en` },
        down: end.down,
        distance: end.distance,
        yardLine: end.yardLine,
        isRedZone: (end.yardLine ?? 50) >= 80,
        homeTimeouts: 2,
        awayTimeouts: 1,
      };
    if (url.endsWith("/status")) return { clock: last.clock.value, displayClock: last.clock.displayValue, period: last.period.number, type: { state: "in", shortDetail: `${last.clock.displayValue} - ${last.period.number}` } };
    const page = Number(/page=(\d+)/.exec(url)?.[1]);
    const limit = Number(/limit=(\d+)/.exec(url)?.[1]);
    return { count: served.length, pageCount: Math.max(1, Math.ceil(served.length / limit)), items: served.slice((page - 1) * limit, page * limit) };
  };
  return { fetcher, calls };
}

const update = (feed: FootballFeed, fetcher: (url: string) => Promise<unknown>) => feed.update(fetcher, { path: "football/nfl", eventID: "1", teams });

describe("the football fast lane", () => {
  it("reads the whole game on its first look: plays in order, the drive, the score and the ball, no moments", async () => {
    const at = index("Xavier Hutchinson 10 Yd Rush") + 1;
    const { fetcher, calls } = lane(() => at);
    const feed = new FootballFeed();
    let renders = 0;
    feed.subscribe(() => renders++);
    await update(feed, fetcher);
    expect(feed.loaded).toBe(true);
    expect(renders).toBe(1);
    // Stoppages (timeouts, the two-minute warning, ends of quarters) aren't snaps.
    expect(feed.plays.some((p) => p.type === "Two-minute warning" || p.type === "Official Timeout")).toBe(false);
    expect(feed.plays.map((p) => p.sequence)).toEqual([...feed.plays.map((p) => p.sequence)].sort((a, b) => a - b));
    // The Texans' tying drive: from midfield after the punt return, in the red zone.
    const drive = feed.drive;
    expect(drive.length).toBeGreaterThan(4);
    expect(drive.every((p) => p.side === "bottom")).toBe(true);
    expect(drive.at(-1)?.text).toContain("Xavier Hutchinson 10 Yd Rush");
    expect(feed.score).toEqual({ home: 14, away: 21 });
    expect(feed.possession).toBe("bottom");
    // 1st & 5 at the NYG 5: goal to go, so no line to gain; the ball 5 yards from the Giants' (left) goal line.
    expect(feed.situation).toMatchObject({ downDistance: "1st & Goal at NYG 5", ballX: 5, lineToGainX: null, possession: "bottom", redZone: true, topTimeouts: 1, bottomTimeouts: 2 });
    expect(feed.clock).toBe("2:00 - 4th");
    expect(feed.takeMoments()).toEqual([]);
    // Every entry as ESPN sent it, stoppages too, in play order: the play theater's parser reads them.
    expect(feed.items.length).toBe(at);
    expect(feed.items.map((i) => Number((i as { sequenceNumber: string }).sequenceNumber))).toEqual([...feed.items.map((i) => Number((i as { sequenceNumber: string }).sequenceNumber))].sort((a, b) => a - b));
    // Every page, once.
    expect(calls.filter((c) => c.includes("/plays?")).length).toBe(Math.ceil(at / 50));
  });

  it("asks for plays again only when the last play changed", async () => {
    const at = index("Woody Marks 7 Yd Rush") + 1;
    const { fetcher, calls } = lane(() => at);
    const feed = new FootballFeed();
    await update(feed, fetcher);
    const before = calls.length;
    await update(feed, fetcher);
    expect(calls.length - before).toBe(2);
  });

  it("offers each new snap as it happens: the touchdown, the big play, the decisive score in overtime", async () => {
    let cursor = index("Woody Marks 3 Yd Rush") + 1;
    const { fetcher } = lane(() => cursor);
    const feed = new FootballFeed();
    await update(feed, fetcher);
    expect(feed.takeMoments()).toEqual([]);

    // The tying touchdown: the Texans' (bottom) end zone is the left one, so a score at x 0 is theirs.
    cursor = index("Xavier Hutchinson 3 Yd pass") + 1;
    await update(feed, fetcher);
    const td = feed.takeMoments().find((m) => m.kind === "touchdown");
    expect(td).toMatchObject({ chart: "field", tier: Tier.score, lead: "Touchdown", side: "bottom" });
    // It ties the game: not decisive.
    expect(td?.accents.has("decisive")).toBe(false);
    // After a score ESPN parks the kickoff as a "1st & 10": it isn't one.
    expect(feed.situation?.downDistance).toBe("Kickoff");

    // Overtime: 42 yards on the ground, then the walk-off.
    cursor = index("Cam Skattebo 42 Yd Rush") + 1;
    await update(feed, fetcher);
    const big = feed.takeMoments().find((m) => m.accents.has("bigPlay"));
    expect(big).toMatchObject({ tier: Tier.swing, lead: "Big play +42", side: "top" });
    expect(big?.accents.has("bigPlay")).toBe(true);

    cursor = index("Devin Singletary 30 Yd Rush") + 1;
    await update(feed, fetcher);
    const winner = feed.takeMoments().find((m) => m.kind === "touchdown");
    expect(winner).toMatchObject({ side: "top", tier: Tier.score });
    expect(winner?.accents.has("decisive")).toBe(true);
    expect(feed.score).toEqual({ home: 21, away: 27 });
    expect(feed.clock).toBe("7:25 - OT");
  });

  it("takes back a score edited away on review", async () => {
    const td = items[index("Xavier Hutchinson 3 Yd pass")]!.id;
    let cursor = index("Xavier Hutchinson 3 Yd pass") + 1;
    let overturned = false;
    const { fetcher } = lane(
      () => cursor,
      (i) => (overturned && i.id === td ? { ...i, scoringPlay: false, scoringType: undefined, type: { id: "3", text: "Pass Incompletion" } } : i),
    );
    const feed = new FootballFeed();
    await update(feed, fetcher);
    overturned = true;
    cursor += 1;
    await update(feed, fetcher);
    expect(feed.takeRetractions()).toEqual([td]);
  });

  it("holds a new spot back until the play that put it there has arrived (briefly)", async () => {
    let time = 0;
    let cursor = index("Woody Marks 6 Yd Rush") + 1;
    let lag = 0;
    const { fetcher } = lane(() => cursor);
    // The play feed trails the situation by `lag` plays.
    const trailing = async (url: string) => (url.includes("/plays?") ? lane(() => cursor - lag).fetcher(url) : fetcher(url));
    const feed = new FootballFeed(() => time);
    await update(feed, trailing);
    const spot = feed.situation?.ballX;
    cursor += 1;
    lag = 1;
    await update(feed, trailing);
    expect(feed.situation?.ballX).toBe(spot);
    time = 16_000;
    await update(feed, trailing);
    expect(feed.situation?.ballX).not.toBe(spot);
  });

  it("learns whether the clock runs from two readings", async () => {
    let time = 0;
    let cursor = index("Woody Marks 3 Yd Rush") + 1;
    const { fetcher } = lane(() => cursor);
    const feed = new FootballFeed(() => time);
    await update(feed, fetcher);
    expect(feed.gameClock?.running).toBe(false);
    time = 5000;
    cursor += 1;
    await update(feed, fetcher);
    expect(feed.gameClock).toMatchObject({ running: true, period: 4, direction: "down" });
  });
});

describe("snaps", () => {
  const plays = items.flatMap((i) => footballPlay(i, teams) ?? []);

  it("places each snap on the field from the top team's goal line", () => {
    const rush = plays.find((p) => p.text === "Cam Skattebo 42 Yd Rush")!;
    // ESPN's 72 → 30 counts from the home (Texans') goal line; x runs from the Giants' (left) one:
    // 28 → 70, 42 yards toward the Texans' end zone on the right.
    expect(rush).toMatchObject({ side: "top", startX: 28, endX: 70, kind: "rush", yards: 42, downDistance: "2nd & 1", period: 5 });
    expect(bigPlay(rush)).toBe(true);
    expect(rush.driveID).toMatch(/^\d+$/);
  });

  it("classifies by type, never by the text (spikes and kneels aside)", () => {
    const base = plays.find((p) => p.typeID === "5")!;
    expect(playMoment({ ...base, text: "P.Mahomes kneels to KC 30 for -1 yards." })).toBeNull();
    expect(playMoment({ ...base, typeID: "3", text: "P.Mahomes spiked the ball to stop the clock." })).toBeNull();
    expect(playMoment({ ...base, typeID: "26" })).toMatchObject({ kind: "turnover", lead: "Interception" });
    expect(playMoment({ ...base, typeID: "29" })).toMatchObject({ kind: "turnover", lead: "Fumble lost" });
    expect(playMoment({ ...base, typeID: "18" })).toMatchObject({ kind: "fieldGoalMissed", tier: Tier.swing });
    expect(playMoment({ ...base, typeID: "7" })).toMatchObject({ kind: "sack", tier: Tier.routine });
    expect(playMoment({ ...base, typeID: "8" })).toMatchObject({ kind: "penalty", lead: "Flag" });
    expect(playMoment({ ...base, scoring: "safety" })).toMatchObject({ kind: "safety", tier: Tier.score });
    // A penalty's yardage is never a big play.
    expect(bigPlay({ ...base, kind: "penalty", yards: 25 })).toBe(false);
  });

  it("gives a touchdown to whoever owns the end zone it reached (a pick-six scores for the defense)", () => {
    const base = plays.find((p) => p.typeID === "68")!;
    const pickSix = { ...base, side: "top" as const, endX: 0, scoring: "touchdown" };
    expect(footballMoment(pickSix)?.side).toBe("bottom");
  });

  it("calls a late go-ahead score decisive, not a tying one", () => {
    const late = plays.find((p) => p.text.startsWith("Devin Singletary 30 Yd Rush"))!;
    expect(decides(late, { home: 21, away: 21 }, false)).toBe(true);
    expect(decides(late, { home: 21, away: 27 }, false)).toBe(false);
    expect(decides({ ...late, period: 3 }, { home: 21, away: 21 }, false)).toBe(false);
    expect(scoreBefore(late, plays)).toEqual({ home: 21, away: 21 });
  });

  it("keeps the scoring drive together", () => {
    const td = plays.find((p) => p.text.startsWith("Xavier Hutchinson 3 Yd pass"))!;
    const drive = driveContaining(plays, td.id)!;
    expect(drive.at(-1)?.id).toBe(td.id);
    expect(drive[0]?.text).toBe("Woody Marks 3 Yd Rush");
    expect(currentDrive(plays).at(-1)?.text).toContain("Devin Singletary 30 Yd Rush");
    expect(driveSummary(drive.filter((p) => p.kind !== "kick"), drive, "bottom", { top: "NYG", bottom: "HOU" })).toBe("HOU drive · 9 plays · 48 yards");
  });
});

describe("the situation, the clock and the chips", () => {
  it("reads the spot from the home goal line", () => {
    const s = footballSituation({ yardLine: 85, down: 2, distance: 3, isRedZone: true, homeTimeouts: 1, awayTimeouts: 3 }, "34", teams, "Woody Marks 7 Yd Rush");
    expect(s).toEqual({ downDistance: "2nd & 3 at NYG 15", ballX: 15, lineToGainX: 12, possession: "bottom", redZone: true, topTimeouts: 3, bottomTimeouts: 1, lastPlay: "Woody Marks 7 Yd Rush" });
    expect(footballSituation({ yardLine: 50, down: 1, distance: 10 }, "19", teams, null)?.downDistance).toBe("1st & 10 at 50");
    expect(footballSituation({ down: 1 }, "19", teams, null)).toBeNull();
  });

  it("shares the tiles' geometry", () => {
    expect(goalToGo(95, 5, true)).toBe(true);
    expect(goalToGo(5, 5, false)).toBe(true);
    expect(goalToGo(90, 5, true)).toBe(false);
    expect(lineToGain(98, 10, "top")).toBe(100);
    expect(lineToGain(4, 10, "bottom")).toBe(0);
  });

  it("names the period", () => {
    const status = (period: number, shortDetail = "", state = "in") => ({ displayClock: "4:02", period, type: { state, shortDetail } });
    expect(footballClock(status(1))).toBe("4:02 - 1st");
    expect(footballClock(status(5))).toBe("4:02 - OT");
    expect(footballClock(status(6))).toBe("4:02 - 2OT");
    expect(footballClock(status(2, "Halftime"))).toBe("Halftime");
    expect(footballClock(status(4, "Final", "post"))).toBeNull();
    expect(footballClock({ displayClock: "15:00", period: 0 })).toBeNull();
  });

  it("calls the 2-MIN DRILL: two minutes or less, the team with the ball down by one score", () => {
    expect(twoMinuteDrill(4, 110, "bottom", 21, 14)).toBe(true);
    expect(twoMinuteDrill(4, 110, "top", 21, 14)).toBe(false);
    expect(twoMinuteDrill(4, 110, "bottom", 23, 14)).toBe(false);
    expect(twoMinuteDrill(4, 130, "bottom", 21, 14)).toBe(false);
    expect(twoMinuteDrill(3, 110, "bottom", 21, 14)).toBe(false);
    expect(twoMinuteDrill(5, 90, "bottom", 21, 20)).toBe(true);
    expect(twoMinuteDrill(4, 0, "bottom", 21, 14)).toBe(false);
    expect(twoMinuteDrill(4, 100, null, 21, 14)).toBe(false);
  });

  it("writes yards as the Mac does", () => {
    expect(yardsText(12)).toBe("+12");
    expect(yardsText(-3)).toBe("−3");
    expect(yardsText(0)).toBeNull();
  });
});
