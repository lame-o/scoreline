/**
 * The football game page's data on recorded games: an NFL summary (Giants at
 * Texans, won in overtime) and a college one between two ranked teams, read
 * through ESPNDetail (data/gameDetail.ts); the scoreboard's live situation;
 * the conference window around a college game; the section plan; names in
 * play texts; the docked bar's possession toss; and football's moments in
 * the page's slot and celebration table, at the Mac's tiers.
 */
import { describe, expect, it } from "vitest";
import { cueFor, wantsBurst } from "../../src/data/celebrations";
import { eventFromSummary, footballFromBoard, parseESPNDetail, sideMapper } from "../../src/data/gameDetail";
import { knockFrames, possessionMotion, tossAt, tossDuration } from "../../src/data/matchRules";
import { liveMoment, MomentCenter, Tier, type LiveMoment } from "../../src/data/moments";
import { pageKind, sectionOrder, widePlan, wideArrangement } from "../../src/data/sections";
import { collegeWindow, parseCollege } from "../../src/data/standings";
import { namePattern, splitNames } from "../../src/features/game/football/names";
import { fixture } from "./fixtures";

const NOW = Date.parse("2026-10-27T08:00:00Z");

function nfl() {
  const summary = fixture("espn-nfl-summary.json");
  const event = eventFromSummary(summary, "football/nfl", "football", NOW)!;
  const detail = parseESPNDetail(summary, { event, path: "football/nfl", id: event.ref?.kind === "espn" ? event.ref.id : "", sport: "football" });
  return { summary, event, detail };
}

function cfb() {
  const summary = fixture("espn-cfb-summary.json");
  const event = eventFromSummary(summary, "football/college-football", "football", NOW)!;
  const detail = parseESPNDetail(summary, { event, path: "football/college-football", id: event.ref?.kind === "espn" ? event.ref.id : "", sport: "football" });
  return { summary, event, detail };
}

describe("an NFL game from its summary", () => {
  it("is a football page: away on top, the final word, the venue", () => {
    const { event, detail } = nfl();
    expect(pageKind(event.ref)).toBe("football");
    expect(event.state).toBe("final");
    if (event.content.kind !== "match") throw new Error("not a match");
    expect(event.content.top.abbreviation).toBe("NYG");
    expect(event.content.bottom.abbreviation).toBe("HOU");
    expect(detail.topIsHome).toBe(false);
    expect(detail.venue).toBeTruthy();
  });

  it("reads the score by quarter, overtime included", () => {
    const { detail } = nfl();
    expect(detail.linescore?.headers).toEqual(["1", "2", "3", "4", "OT", "T"]);
    expect(detail.linescore?.top.at(-1)).toBe("27");
    expect(detail.linescore?.bottom.at(-1)).toBe("21");
  });

  it("lists every scoring play with its quarter, the side that scored and the score after it, top first", () => {
    const { detail } = nfl();
    expect(detail.moments.length).toBe(8);
    const first = detail.moments[0]!;
    expect(first).toMatchObject({ kind: "score", clock: "Q1 11:40", side: "bottom", score: "0–3", period: 1 });
    const last = detail.moments.at(-1)!;
    // The walk-off: overtime is its own period ("OT"), linked to the line score's fifth column.
    expect(last).toMatchObject({ clock: "OT 7:25", side: "top", score: "27–21", period: 5 });
    expect(last.text).toContain("Devin Singletary 30 Yd Rush");
  });

  it("reads team stats in the Mac's order and the players' full names", () => {
    const { detail } = nfl();
    expect(detail.stats.map((s) => s.label)).toEqual(["Total Yards", "Passing Yards", "Rushing Yards", "First Downs", "Third-Down Conversions", "Turnovers", "Penalties–Yards", "Time of Possession"]);
    expect(detail.stats.every((s) => s.topShare >= 0 && s.topShare <= 1)).toBe(true);
    expect(Object.values(detail.playerNames)).toContain("Devin Singletary");
    expect(Object.values(detail.playerNames)).toContain("C.J. Stroud");
    // A final has no situation, and no Latest list (the NFL summary has no plays).
    expect(detail.football).toBeNull();
    expect(detail.recentPlays).toEqual([]);
  });
});

describe("a college game from its summary", () => {
  it("carries both teams' AP ranks at game time and their conference records", () => {
    const { event } = cfb();
    if (event.content.kind !== "match") throw new Error("not a match");
    const ranks = [event.content.top.rank, event.content.bottom.rank];
    expect(ranks.every((r) => r != null && r >= 1 && r <= 25)).toBe(true);
    // A college team goes by its school.
    expect([event.content.top.name, event.content.bottom.name]).toContain("Texas");
  });

  it("shows the conference table around both teams: one place either side of each, within their conference", () => {
    const rows = parseCollege(fixture("standings-college.json"), "football/college-football");
    const sec = rows.filter((r) => r.group === rows.find((x) => x.name === "Texas")?.group);
    const texas = sec.find((r) => r.name === "Texas")!;
    const ole = sec.find((r) => r.name === "Ole Miss") ?? sec.find((r) => r.id !== texas.id)!;
    const ids = new Set([texas.id, ole.id]);
    const window = collegeWindow(rows, ids, 1);
    expect(window.every((r) => r.group === texas.group)).toBe(true);
    for (const id of ids) {
      const i = sec.findIndex((r) => r.id === id);
      for (const near of [sec[i - 1], sec[i], sec[i + 1]]) if (near) expect(window).toContainEqual(near);
    }
    expect(window.length).toBeLessThanOrEqual(6);
    // Wider: two places either side.
    expect(collegeWindow(rows, ids, 2).length).toBeGreaterThanOrEqual(window.length);
    // A team not in the table shows nothing.
    expect(collegeWindow(rows, new Set(["nobody"]), 1)).toEqual([]);
  });
});

describe("the scoreboard's live situation", () => {
  const event = nfl().event;
  const side = sideMapper(event);

  it("reads the spot from the home goal line, the line to gain toward the attacked end zone", () => {
    // The Texans (bottom, home) at the NYG 15 attack left: x 15, the line to gain 3 yards nearer x 0.
    const s = footballFromBoard({ yardLine: 85, distance: 3, possession: "34", downDistanceText: "2nd & 3 at NYG 15", isRedZone: true, homeTimeouts: 2, awayTimeouts: 1, lastPlay: { text: "Woody Marks 7 Yd Rush" } }, false, side)!;
    expect(s).toMatchObject({ ballX: 15, lineToGainX: 12, possession: "bottom", redZone: true, topTimeouts: 1, bottomTimeouts: 2, downDistance: "2nd & 3 at NYG 15", lastPlay: "Woody Marks 7 Yd Rush" });
    // Between downs (no team with the ball): no line to gain.
    expect(footballFromBoard({ yardLine: 35, distance: 10 }, false, side)?.lineToGainX).toBeNull();
  });
});

describe("the football section plan", () => {
  const ref = { kind: "espn", path: "football/nfl", id: "1", sport: "football" } as const;

  it("puts the field first while live, with the play theater's slot under it", () => {
    expect(sectionOrder(ref, "live").slice(0, 3)).toEqual(["field", "theater", "winProbability"]);
    expect(sectionOrder(ref, "final")).toEqual(["linescore", "moments", "stats", "table", "plays"]);
    expect(sectionOrder(ref, "scheduled")).toEqual(["table", "whereToWatch"]);
  });

  it("from 680pt, the drive on the left; the quarters beside the scoring plays they light", () => {
    const placed = wideArrangement(["field", "theater", "winProbability", "linescore", "moments", "stats", "whereToWatch"], widePlan(ref, "live"));
    const where = Object.fromEntries(placed.map((p) => [p.section, p.column]));
    expect(where).toMatchObject({ field: "left", theater: "left", stats: "left", winProbability: "right", linescore: "right", moments: "right" });
    // No theater yet: no hole.
    expect(wideArrangement(["field", "linescore"], widePlan(ref, "live")).map((p) => p.section)).toEqual(["field", "linescore"]);
  });

  it("keeps the generic ESPN page for other ESPN sports", () => {
    expect(pageKind({ kind: "espn", path: "basketball/mens-college-basketball", id: "1", sport: "basketball" })).toBe("espn");
  });
});

describe("players' names in play texts", () => {
  const { pattern, byName } = namePattern({ "1": "Jordan Love", "2": "Matthew Golden", "3": "Love", "4": "C.J. Stroud", "5": "Xavier Hutchinson" });

  it("splits a text on whole names, longest first", () => {
    expect(splitNames("Jordan Love Pass Complete for 22 Yds to Matthew Golden", pattern, byName)).toEqual([
      ["Jordan Love", "1"],
      [" Pass Complete for 22 Yds to ", null],
      ["Matthew Golden", "2"],
    ]);
    expect(splitNames("Xavier Hutchinson 3 Yd pass from C.J. Stroud (Kick)", pattern, byName).filter(([, id]) => id).map(([n]) => n)).toEqual(["Xavier Hutchinson", "C.J. Stroud"]);
    // Inside a word, a name isn't one.
    expect(splitNames("Lovely day", pattern, byName)).toEqual([["Lovely day", null]]);
    expect(splitNames("No names here", null, byName)).toEqual([["No names here", null]]);
  });
});

describe("the docked bar's possession toss", () => {
  const turnover = { kind: "turnover", age: 0.5 };

  it("tosses only for a fresh turnover whose field can't be seen; otherwise glides", () => {
    const change = { from: "top", to: "bottom" } as const;
    expect(possessionMotion(change, turnover, "hiddenAbove", "full", false)).toEqual({ kind: "toss", rise: 12, spins: true, knocks: true });
    expect(possessionMotion(change, turnover, "hiddenAbove", "subtle", false)).toEqual({ kind: "toss", rise: 6, spins: false, knocks: false });
    expect(possessionMotion(change, turnover, "hiddenAbove", "off", false)).toEqual({ kind: "glide" });
    expect(possessionMotion(change, turnover, "visible", "full", false)).toEqual({ kind: "glide" });
    expect(possessionMotion(change, { kind: "turnover", age: 3 }, "hiddenAbove", "full", false)).toEqual({ kind: "glide" });
    expect(possessionMotion(change, null, null, "full", false)).toEqual({ kind: "glide" });
    expect(possessionMotion(change, turnover, "hiddenAbove", "full", true)).toEqual({ kind: "fade" });
    expect(possessionMotion(change, turnover, null, "full", false, { catchUp: true })).toEqual({ kind: "none" });
    expect(possessionMotion({ from: null, to: "top" }, null, null, "full", false)).toEqual({ kind: "none" });
  });

  it("flies on a low arc with a turn and a quarter; a glide stays on the line", () => {
    const toss = { kind: "toss", rise: 12, spins: true, knocks: true } as const;
    expect(tossDuration(toss)).toBe(0.5);
    expect(tossAt(toss, 0)).toMatchObject({ progress: 0, lift: 0, spin: 0 });
    expect(tossAt(toss, 0.25).lift).toBeCloseTo(12, 0);
    expect(tossAt(toss, 0.5)).toMatchObject({ progress: 1, spin: 450 });
    expect(tossAt({ kind: "glide" }, 0.2).lift).toBe(0);
    expect(tossAt({ kind: "glide" }, 0.45).progress).toBe(1);
    // The landing knock: out, back past center, damped, at rest.
    const knock = knockFrames(2);
    expect(knock[0]).toEqual({ offset: 0, value: 0 });
    expect(knock[1]!.value).toBe(-2);
    expect(knock.at(-1)).toEqual({ offset: 1, value: 0 });
  });
});

describe("football's moments, at the Mac's tiers", () => {
  const m = (kind: LiveMoment["kind"], tier: LiveMoment["tier"], accents: ("decisive" | "bigPlay")[] = [], id: string = kind) => liveMoment({ id, chart: "field", tier, kind, lead: kind, detail: "", side: "top", accents });
  const options = { level: "full" as const, reduceMotion: false, preset: "short" as const, direction: -Math.PI / 2 };

  it("celebrates a touchdown with confetti (gold when it decides the game), a field goal and a big play with sparks, a safety with a bloom", () => {
    expect(wantsBurst(m("touchdown", Tier.score))).toBe(true);
    expect(cueFor({ ...m("touchdown", Tier.score), burst: true }, options)?.effects[0]?.kind).toBe("confetti");
    expect(cueFor({ ...m("touchdown", Tier.score, ["decisive"]), burst: true }, options)?.gold).toBe(true);
    expect(cueFor(m("fieldGoal", Tier.score), options)?.effects[0]).toMatchObject({ kind: "sparks", rays: 6 });
    expect(cueFor(m("safety", Tier.score), options)?.effects[0]?.kind).toBe("bloom");
    expect(cueFor(m("rush", Tier.swing, ["bigPlay"]), options)?.effects[0]).toMatchObject({ kind: "sparks", rays: 4 });
    // Marks only: turnovers, sacks, misses, flags.
    for (const kind of ["turnover", "sack", "fieldGoalMissed", "penalty", "passIncomplete"] as const) expect(cueFor(m(kind, Tier.routine), options)).toBeNull();
    // A decisive field goal gets the signature too.
    expect(cueFor({ ...m("fieldGoal", Tier.score, ["decisive"]), burst: true }, options)?.effects.some((e) => e.kind === "confetti")).toBe(true);
  });

  it("gives the slot to the touchdown over the big play that set it up, and never lets a lesser play interrupt it", () => {
    const center = new MomentCenter({ wantsBurst });
    const shown = center.offer([m("rush", Tier.swing, ["bigPlay"], "a"), m("touchdown", Tier.score, [], "b")]);
    expect(shown?.id).toBe("b");
    expect(shown?.burst).toBe(true);
    expect(center.offer([m("sack", Tier.routine, [], "c")])).toBeNull();
    // A score taken back on review leaves at once.
    expect(center.retract(["b"])).toBe(true);
    expect(MomentCenter.hold(m("touchdown", Tier.score))).toBe(6000);
    expect(MomentCenter.hold(m("turnover", Tier.swing))).toBe(4000);
  });
});
