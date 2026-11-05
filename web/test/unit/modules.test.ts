/**
 * Game-page modules (ModulesTests.swift, check by check): the keys a fold, a
 * hide or an order is kept under (the Mac's), what's folded or hidden by
 * default, how hidden modules leave the page before the split page places
 * it, the Live View's and Win Probability's places, what each folded module
 * says, and how the user's order merges into each state's plan (and survives
 * a reload).
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { DetailMoment, Pitch, Stat } from "../../src/data/gameDetail";
import type { EventRef } from "../../src/data/models";
import {
  arrange,
  atBatGlance,
  atPlateGlance,
  autoscrollSpeed,
  boxGlance,
  broadcastersGlance,
  chancesGlance,
  customizeIndex,
  customizeRows,
  CUSTOMIZE_PITCH,
  fieldGlance,
  flowCounts,
  flowGlance,
  fold,
  hiddenHere,
  hiddenText,
  hide,
  injuriesGlance,
  isFolded,
  isHidden,
  leadersGlance,
  linescoreGlance,
  merge,
  MODULE_KEYS,
  moduleKey,
  moduleName,
  modulesFor,
  move,
  newestGlance,
  NO_MODULES,
  pageName,
  permute,
  playGlance,
  rank,
  ranked,
  ranking,
  restoreDefaults,
  shootingFromShots,
  shootingFromTotals,
  shootingGlance,
  showAll,
  shown,
  slot,
  spokenGlance,
  spokenHeader,
  springProgress,
  standingsGlance,
  statsGlance,
  step,
  surname,
  timelineGlance,
  type ModuleGlance,
  type ModuleLayout,
} from "../../src/data/modules";
import { chartForSection, pageKind, sectionForChart, sectionOrder, wideArrangement, widePlan, type Section, type WidePart } from "../../src/data/sections";
import { DEFAULTS, getSettings, sanitize, settings } from "../../src/state/settings";

type S = Section;
const espn = (path: string, sport: "basketball" | "soccer" | "baseball" | "football"): EventRef => ({ kind: "espn", path, id: "1", sport });
const nbaRef = espn("basketball/nba", "basketball");
const soccerRef = espn("soccer/eng.1", "soccer");
const mlbRef = espn("baseball/mlb", "baseball");
const nflRef = espn("football/nfl", "football");

const line = (g: ModuleGlance | null) => (g == null ? "nil" : g.kind === "text" ? `${g.lead}|${g.detail}` : g.parts.map((p) => `${p.name} ${p.value}`).join("|"));

describe("keys", () => {
  it("page then module, as the Mac names them (nba.liveView, soccer.pitch)", () => {
    expect([moduleKey("nba", "liveView"), moduleKey("soccer", "pitch"), moduleKey("baseball", "atBat"), moduleKey("nba", "winProbability")]).toEqual(["nba.liveView", "soccer.pitch", "baseball.atBat", "nba.winProbability"]);
  });
  it("prefs keys: foldedModules, hiddenModules, moduleOrder", () => {
    expect(MODULE_KEYS).toEqual({ folded: "foldedModules", hidden: "hiddenModules", order: "moduleOrder" });
    expect(Object.keys(DEFAULTS)).toEqual(expect.arrayContaining(["foldedModules", "hiddenModules", "moduleOrder"]));
  });
  it("per sport: the NFL and college share football's; the WNBA has the NBA page on the web (the Mac's generic one)", () => {
    expect(pageKind(nbaRef)).toBe("nba");
    expect(pageKind(soccerRef)).toBe("soccer");
    expect(pageKind(mlbRef)).toBe("baseball");
    expect(pageKind(nflRef)).toBe("football");
    expect(pageKind(espn("football/college-football", "football"))).toBe("football");
    expect(pageKind(espn("basketball/wnba", "basketball"))).toBe("nba");
    expect(pageKind({ kind: "counterStrike", slug: "a", tournament: null })).toBe("counterStrike");
    expect(pageKind(null)).toBe("none");
  });
  it("menus name the sport's pages (NBA, Soccer)", () => {
    expect([pageName("nba"), pageName("soccer")]).toEqual(["NBA", "Soccer"]);
  });
});

describe("fold and hide state", () => {
  it("by default every module is shown and open; a fold is one key, per sport, with no game or state in it", () => {
    let layout: ModuleLayout = NO_MODULES;
    const everything: S[] = ["liveView", "court", "flow", "winProbability", "plays", "pitch", "atBat"];
    expect(everything.every((s) => !isFolded(layout, s, "nba") && !isHidden(layout, s, "nba"))).toBe(true);
    layout = fold(layout, ["liveView"], "nba", true);
    expect(isFolded(layout, "liveView", "nba") && !isFolded(layout, "liveView", "baseball") && !isFolded(layout, "court", "nba")).toBe(true);
    expect(layout.folded).toEqual(["nba.liveView"]);
    layout = fold(layout, ["liveView"], "nba", false);
    expect(layout.folded).toEqual([]);
    layout = fold(layout, ["court"], null, true);
    expect(layout.folded).toEqual([]);
    expect(isFolded(layout, "court", null)).toBe(false);
  });

  it("hidden modules leave the page, the rest keep their order; the end names them; per sport; Restore Defaults is that sport's alone", () => {
    let layout = hide(hide(NO_MODULES, "court", "nba", true), "pitch", "soccer", true);
    const page: S[] = ["liveView", "court", "flow", "linescore"];
    expect(shown(layout, page, "nba")).toEqual(["liveView", "flow", "linescore"]);
    expect(hiddenHere(layout, page, "nba")).toEqual(["court"]);
    expect(shown(layout, page, "baseball")).toEqual(page);
    layout = showAll(layout, "nba");
    expect(layout.hidden).toEqual(["soccer.pitch"]);
    expect(hiddenText(["Shot Chart", "Live View"], "NBA")).toBe("Hidden on NBA pages: Shot Chart, Live View");
    expect([spokenHeader("Shot Chart", true), spokenHeader("Shot Chart", false)]).toEqual(["Shot Chart, collapsed", "Shot Chart, expanded"]);
  });
});

const left = (plan: readonly WidePart[]): S[] => (plan.find((p) => p.kind === "columns") as Extract<WidePart, { kind: "columns" }> | undefined)?.left.slice() ?? [];

describe("the Live View's place, and the split page", () => {
  for (const [ref, chart, name] of [
    [nbaRef, "court", "NBA"],
    [soccerRef, "pitch", "soccer"],
    [mlbRef, "atPlate", "baseball"],
    [nflRef, "field", "football"],
  ] as const) {
    it(`${name} live: the Live View first, Win Probability and Timeline next, then ${moduleName(chart, pageKind(ref))}; live only; above its chart on the split page`, () => {
      const live = sectionOrder(ref, "live");
      expect(live.slice(0, 4)).toEqual(["liveView", "winProbability", "timeline", chart]);
      expect(sectionOrder(ref, "final")).not.toContain("liveView");
      expect(sectionOrder(ref, "scheduled")).not.toContain("liveView");
      const l = left(widePlan(ref, "live"));
      expect(l[l.indexOf("liveView") + 1]).toBe(chart);
    });
  }
  it("no theater, no Live View (CS2)", () => {
    expect(sectionOrder({ kind: "counterStrike", slug: "a", tournament: null }, "live")).not.toContain("liveView");
  });

  it("Customize lists every state's modules once, live order first, marking the live-only ones; names don't change with the state", () => {
    const nba = modulesFor(nbaRef);
    const live = new Map(nba.map((m) => [m.section, m.liveOnly]));
    expect(nba[0]?.section).toBe("liveView");
    expect([live.get("liveView"), live.get("court"), live.get("injuries"), live.get("plays")]).toEqual([true, false, false, true]);
    expect(new Set(nba.map((m) => m.section)).size).toBe(nba.length);
    expect([moduleName("winProbability", "nba"), moduleName("moments", "soccer"), moduleName("table", "nba")]).toEqual(["Win Probability", "Key Events", "Standings"]);
  });

  it("hidden modules come out before the split page places what's left: an emptied column borrows a section; the Live View hidden, the court leads again", () => {
    let layout: ModuleLayout = NO_MODULES;
    for (const s of ["box", "leaders", "stats", "injuries", "whereToWatch"] as const) layout = hide(layout, s, "nba", true);
    const placed = wideArrangement(shown(layout, sectionOrder(nbaRef, "live"), "nba"), widePlan(nbaRef, "live"));
    expect(placed.some((p) => p.section === "box")).toBe(false);
    expect(placed.filter((p) => p.column === "right").length).toBeGreaterThan(0);
    layout = hide(NO_MODULES, "liveView", "nba", true);
    const noTheater = wideArrangement(shown(layout, sectionOrder(nbaRef, "live"), "nba"), widePlan(nbaRef, "live"));
    expect(noTheater[0]).toMatchObject({ section: "court", column: "left" });
  });
});

describe("glances", () => {
  const names = { top: "GSW", bottom: "MIN" };
  it("Live View and Latest: the newest play, its time first", () => {
    expect(line(playGlance("Q4 2:30  Stephen Curry makes 3-foot two point shot"))).toBe("Q4 2:30|Stephen Curry makes 3-foot two point shot");
    expect(line(playGlance("Match ends, Brentford 1, Arsenal 2."))).toBe("|Match ends, Brentford 1, Arsenal 2.");
  });
  it("Shot Chart: FG% and threes, from the box score's totals or counted from the chart's shots", () => {
    const gsw = { made: 38, attempts: 82, threesMade: 14, threesAttempted: 33 };
    const min = { made: 35, attempts: 81, threesMade: 11, threesAttempted: 31 };
    expect(line(shootingGlance(gsw, min, names))).toBe("GSW 46% FG|14 of 33 from three · MIN 43%, 11 of 31");
    expect(shootingFromTotals("38-82", "14-33")).toEqual(gsw);
    const shots = [
      { made: true, value: 3, side: "top" as const },
      { made: false, value: 2, side: "top" as const },
      { made: true, value: 2, side: "bottom" as const },
    ];
    expect(shootingFromShots(shots, "top")).toEqual({ made: 1, attempts: 2, threesMade: 1, threesAttempted: 1 });
  });
  it("Game Flow: the margin, then lead changes and ties, as ESPN counts them", () => {
    const point = (top: number, bottom: number) => ({ top, bottom });
    const flow = [point(2, 0), point(2, 2), point(2, 4), point(5, 4), point(5, 5), point(7, 5), point(9, 5), point(9, 4)];
    expect(flowCounts(flow)).toEqual({ changes: 2, ties: 2 });
    expect(line(flowGlance(flow, names))).toBe("GSW +5|2 lead changes · 2 ties");
    expect(line(flowGlance([point(0, 3)], names))).toBe("MIN +3|No lead changes");
  });
  it("Score by Quarter and by Inning: the latest period; overtime, final", () => {
    expect(line(linescoreGlance({ headers: ["1", "2", "3", "4", "T"], top: ["30", "34", "29", "27", "120"], bottom: ["23", "25", "33", "21", "102"] }, names, false, true))).toBe("Q4|GSW 27–21 MIN this quarter");
    expect(
      line(
        linescoreGlance(
          { headers: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "R", "H", "E"], top: ["0", "1", "0", "2", "0", "0", "1", "", "", "4", "9", "0"], bottom: ["1", "0", "0", "0", "2", "0", "0", "", "", "3", "6", "1"] },
          { top: "MIL", bottom: "TB" },
          true,
          true,
        ),
      ),
    ).toBe("7th|MIL 1–0 TB this inning");
    expect(line(linescoreGlance({ headers: ["1", "2", "3", "4", "5", "T"], top: ["1", "1", "1", "1", "9", "13"], bottom: ["1", "1", "1", "1", "4", "8"] }, names, false, false))).toBe("OT|GSW 9–4 MIN");
  });
  it("Leaders, surnames, the injury report, where to watch, team stats, a table", () => {
    const leader = (name: string, value: string) => ({ name, value, headshot: null, player: null, detail: null });
    expect(line(leadersGlance([{ category: "Points", top: leader("Stephen Curry", "31"), bottom: leader("Anthony Edwards", "34") }]))).toBe("Edwards 34|Curry 31");
    expect([surname("Jaime Jaquez Jr."), surname("Nikola Jokić")]).toEqual(["Jaquez", "Jokić"]);
    const injuries = [
      { name: "Jonathan Kuminga", status: "Out" },
      { name: "Moses Moody", status: "Day-To-Day" },
      { name: "Cam Reddish", status: "Out For Season" },
    ];
    expect(line(injuriesGlance(injuries))).toBe("2 out|Kuminga, Reddish");
    expect([line(broadcastersGlance(["ESPN", "Prime Video"])), line(broadcastersGlance(["Peacock", "USA", "Telemundo"]))]).toEqual(["ESPN|and Prime Video", "Peacock|and 2 more"]);
    const stat = (label: string, top: string, bottom: string): Stat => ({ label, top, bottom, topShare: 0.5 });
    expect(line(statsGlance([stat("Rebounds", "41", "38"), stat("Assists", "27", "22"), stat("Turnovers", "11", "14"), stat("Steals", "8", "6")]))).toBe("Rebounds 41–38|Assists 27–22 · Turnovers 11–14");
    expect(line(standingsGlance([{ name: "MIN", rank: 7 }, { name: "GSW", rank: 3 }]))).toBe("GSW 3rd|MIN 7th");
    expect(line(boxGlance([{ name: "Stephen Curry", onCourt: true, starter: true }, { name: "Buddy Hield", onCourt: false, starter: false }], true))).toBe("On court|Curry");
  });
  it("This At-Bat: the newest pitch; between batters; At the Plate; the Field", () => {
    const pitch = (id: string, number: number, result: Pitch["result"], type: string, typeName: string, mph: number, strike: Pitch["strike"] = null): Pitch => ({ id, number, x: 0, y: 0, result, type, typeName, mph, strike });
    const pitches = [pitch("1", 1, "ball", "SL", "Slider", 88), pitch("3", 3, "strike", "FF", "Four-seam fastball", 97, "foul"), pitch("2", 2, "strike", "CH", "Changeup", 86, "called")];
    expect(line(atBatGlance(pitches))).toBe("Pitch 3|97 mph four-seam, foul");
    expect(line(atBatGlance([]))).toBe("|Waiting for the first pitch");
    expect(line(atPlateGlance(1, [true, false, true], "Christian Yelich", "Pete Fairbanks"))).toBe("1 out|Runners on 1st and 3rd · Yelich vs. Fairbanks");
    expect(line(atPlateGlance(2, [true, true, true], null, null))).toBe("2 outs|Bases loaded");
    expect(line(fieldGlance("KC", "2nd & 7 at SEA 34", 6))).toBe("KC ball|2nd & 7 at SEA 34 · 6 plays this drive");
  });
  it("Key Events: the newest goal, not a later card; Timeline: the score, then each goal", () => {
    const moments: DetailMoment[] = [
      { id: "a", kind: "goal", clock: "38'", text: "Antoine Semenyo Goal", side: "bottom", minute: 38, score: "0-1", period: null },
      { id: "b", kind: "yellow", clock: "61'", text: "Casemiro Yellow Card", side: "top", minute: 61, score: null, period: null },
    ];
    expect(line(newestGlance(moments, true))).toBe("38'|Goal! Antoine Semenyo, 0-1");
    expect(line(timelineGlance(moments, "0–1"))).toBe("0–1|38' Antoine Semenyo");
  });
  it("Win Probability: each side's chance, color-keyed (no draw in a two-way market); read as the header's description", () => {
    const chances = chancesGlance({ top: 0.962, draw: null, bottom: 0.038 }, false, { color: "#ff0", name: "GSW" }, "#888", { color: "#00f", name: "MIN" });
    expect(line(chances)).toBe("GSW 96%|MIN 4%");
    expect(spokenGlance(chances)).toBe("GSW 96%, MIN 4%");
    const three = chancesGlance({ top: 0.04, draw: 0.11, bottom: 0.85 }, false, { color: "#f00", name: "MUN" }, "#888", { color: "#f00", name: "BOU" });
    expect(line(three)).toBe("MUN 4%|Draw 11%|BOU 85%");
    expect(spokenGlance({ kind: "text", lead: "GSW +5", detail: "9 lead changes" })).toBe("GSW +5, 9 lead changes");
  });
});

describe("what's seen while folded", () => {
  it("each chart's section carries its moments when folded; the Live View captions none", () => {
    for (const chart of ["field", "pitch", "plate", "spray", "rounds", "wall", "ascent", "boulder", "court"]) expect(chartForSection(sectionForChart(chart))).toBe(chart);
    expect(chartForSection("liveView")).toBeNull();
  });
});

describe("Win Probability's default place", () => {
  const generic = espn("basketball/mens-college-basketball", "basketball");
  for (const [ref, name] of [
    [nbaRef, "NBA"],
    [soccerRef, "soccer"],
    [mlbRef, "baseball"],
    [nflRef, "football"],
    [generic, "basketball"],
  ] as const) {
    it(`${name}: right under the Live View live, first before the game and in the final`, () => {
      const live = sectionOrder(ref, "live");
      expect(live.indexOf("winProbability")).toBe(1);
      expect(live[0]).toBe("liveView");
      expect(sectionOrder(ref, "final")[0]).toBe("winProbability");
      expect(sectionOrder(ref, "scheduled")[0]).toBe("winProbability");
    });
  }
  it("no Live View on the page: Win Probability is the first module, under the score", () => {
    expect(shown(hide(NO_MODULES, "liveView", "espn", true), sectionOrder(generic, "live"), "espn")[0]).toBe("winProbability");
  });
  const column = (ref: EventRef, state: "live" | "final" | "scheduled"): S[] => {
    for (const part of widePlan(ref, state)) {
      if (part.kind !== "columns") continue;
      if (part.left.includes("winProbability")) return [...part.left];
      if (part.right.includes("winProbability")) return [...part.right];
    }
    return [];
  };
  for (const [ref, name] of [
    [nbaRef, "NBA"],
    [soccerRef, "soccer"],
    [mlbRef, "baseball"],
    [nflRef, "football"],
  ] as const) {
    for (const state of ["live", "final", "scheduled"] as const) {
      it(`${name} ${state} split page: Win Probability at or near the top of its column`, () => {
        const col = column(ref, state).filter((s) => s !== "liveView");
        // The NBA final keeps the flow, then the court beside the box score: Win Probability is third.
        expect(col.indexOf("winProbability")).toBeLessThanOrEqual(pageKind(ref) === "nba" && state === "final" ? 2 : 1);
        expect(col.indexOf("winProbability")).toBeGreaterThanOrEqual(0);
      });
    }
  }
  it("NBA split page: the court stays beside the box score, Win Probability just under it; soccer: a final's timeline beside the shot map, live Win Probability tops the column", () => {
    expect(column(nbaRef, "live").slice(0, 3)).toEqual(["liveView", "court", "winProbability"]);
    expect(column(nbaRef, "final").slice(0, 3)).toContain("court");
    expect(column(soccerRef, "final")[0]).toBe("timeline");
    expect(column(soccerRef, "live")[0]).toBe("winProbability");
  });
});

describe("the user's order", () => {
  it("merges a ranking into the plan", () => {
    expect(merge(["a", "b", "c"], [])).toEqual(["a", "b", "c"]);
    expect(merge(["a", "b", "c"], ["c", "a", "b"])).toEqual(["c", "a", "b"]);
    // Never ranked: a module follows the ranked one above it in the plan, or leads the first one.
    expect(merge(["a", "b", "c", "d"], ["d", "b"])).toEqual(["d", "a", "b", "c"]);
    expect(merge(["a", "b"], ["x", "b", "b", "a"])).toEqual(["b", "a"]);
  });

  it("a final's ranking carries to the live page (the Live View still leads Win Probability); a live one to the final, without what only a live page has", () => {
    const finalRanking = ["box", "flow", "court", "winProbability", "linescore", "leaders", "moments", "stats", "table"];
    expect(arrange(sectionOrder(nbaRef, "live"), finalRanking)).toEqual(["box", "flow", "court", "liveView", "winProbability", "timeline", "linescore", "leaders", "moments", "stats", "plays", "table", "injuries", "whereToWatch"]);
    const liveRanking = ["box", ...sectionOrder(nbaRef, "live").filter((s) => s !== "box")];
    expect(arrange(sectionOrder(nbaRef, "final"), liveRanking)).toEqual(["box", "winProbability", "timeline", "court", "flow", "linescore", "leaders", "moments", "stats", "table"]);
  });

  it("a page's new order folds into the ranking without dropping what isn't on it", () => {
    expect(ranked(["flow", "court", "box"], ["liveView", "court", "flow", "plays", "box"])).toEqual(["flow", "plays", "liveView", "court", "box"]);
    expect(new Set(ranked(["a"], ["x", "y"]))).toEqual(new Set(["a", "x", "y"]));
    expect(ranked(["flow", "court", "box"], [])).toEqual(["flow", "court", "box"]);
  });

  it("columns: a run's new order takes the run's places; move, clamped; the gap's slot", () => {
    expect(permute(["a", "X", "b", "Y", "c"], ["c", "a", "b"])).toEqual(["c", "X", "a", "Y", "b"]);
    expect(move("c", 0, ["a", "b", "c"])).toEqual(["c", "a", "b"]);
    expect(move("a", 9, ["a", "b", "c"])).toEqual(["b", "c", "a"]);
    expect([slot(0, 0, [40, 40]), slot(21, 0, [40, 40]), slot(19, 0, [40, 40]), slot(500, 0, [40, 40]), slot(-90, 0, [40, 40])]).toEqual([0, 1, 0, 2, 0]);
  });

  it("Move Up and Move Down: one place along the run, nothing at its ends; on the split page, within the column", () => {
    const page = ["liveView", "court", "flow", "box"];
    expect(step("liveView", -1, page, page, [])).toBeNull();
    expect(step("box", 1, page, page, [])).toBeNull();
    expect(step("flow", -1, page, page, [])).toEqual(["liveView", "flow", "court", "box"]);
    expect(step("court", 1, page, page, [])).toEqual(["liveView", "flow", "court", "box"]);
    expect(step("flow", -1, ["court", "flow"], ["court", "box", "flow", "leaders"], [])).toEqual(["flow", "box", "court", "leaders"]);
  });

  it("autoscroll: within 44pt of an edge (below the docked bar), faster nearer it; the settle's spring", () => {
    expect([autoscrollSpeed(300, 600, 0), autoscrollSpeed(0, 600, 0), autoscrollSpeed(578, 600, 0)]).toEqual([0, -12, 6]);
    expect(autoscrollSpeed(60, 600, 48)).toBeLessThan(0);
    expect(springProgress(0)).toBe(0);
    expect(springProgress(0.3)).toBeGreaterThan(0.98);
    expect(springProgress(0.6)).toBe(1);
    expect(springProgress(0.1)).toBeLessThan(springProgress(0.15));
  });
});

describe("the order on the page", () => {
  it("hidden modules are filtered out; the rest follow the ranking; hiding keeps a module's rank; another sport keeps its plan", () => {
    let layout = rank(NO_MODULES, ["box", "court", "flow"], "nba");
    layout = hide(layout, "court", "nba", true);
    const final = shown(layout, sectionOrder(nbaRef, "final"), "nba");
    expect(final).not.toContain("court");
    expect(final.indexOf("box")).toBeLessThan(final.indexOf("flow"));
    expect(ranking(layout, "nba")).toContain("court");
    expect(shown(layout, sectionOrder(nbaRef, "final"), "soccer")[0]).toBe("winProbability");
  });

  it("split page: a module never changes column, however it's ranked; within each column, the ranking's relative order; no ranking, as designed", () => {
    const layout = rank(NO_MODULES, ["box", "table", "moments", "stats", "leaders", "court", "liveView", "winProbability", "flow", "linescore", "plays"], "nba");
    const order = shown(layout, sectionOrder(nbaRef, "live"), "nba");
    const placed = wideArrangement(order, widePlan(nbaRef, "live"), ranking(layout, "nba"));
    const l = placed.filter((p) => p.column === "left").map((p) => p.section);
    const r = placed.filter((p) => p.column === "right").map((p) => p.section);
    expect(new Set(l)).toEqual(new Set(["liveView", "court", "winProbability", "timeline", "flow", "linescore", "moments", "plays", "table"]));
    expect(new Set(r)).toEqual(new Set(["box", "leaders", "stats", "injuries", "whereToWatch"]));
    expect(l).toEqual(["table", "moments", "court", "liveView", "winProbability", "timeline", "flow", "linescore", "plays"]);
    expect(r).toEqual(["box", "stats", "injuries", "whereToWatch", "leaders"]);
    expect(wideArrangement(order, widePlan(nbaRef, "live")).map((p) => p.section)).toEqual(wideArrangement(sectionOrder(nbaRef, "live"), widePlan(nbaRef, "live")).map((p) => p.section));
  });

  it("Restore Defaults: the sport's order and hidden modules reset; folds and other sports stay; restored, a page is in its plan's order", () => {
    let layout = rank(NO_MODULES, ["box", "court", "flow"], "nba");
    layout = rank(layout, ["pitch", "timeline"], "soccer");
    layout = fold(layout, ["box"], "nba", true);
    layout = hide(layout, "box", "nba", true);
    layout = restoreDefaults(layout, "nba");
    expect(ranking(layout, "nba")).toEqual([]);
    expect(layout.hidden).toEqual([]);
    expect(isFolded(layout, "box", "nba")).toBe(true);
    expect(ranking(layout, "soccer")).toEqual(["pitch", "timeline"]);
    expect(shown(layout, sectionOrder(nbaRef, "final"), "nba")).toEqual(sectionOrder(nbaRef, "final"));
  });
});

describe("the order survives a reload", () => {
  beforeEach(() => settings.reset());
  it("dragged live, Box Score to the top: read back from storage, it carries to the final; hiding, showing and folding keep it; Restore Defaults clears it", () => {
    const dragged = move("box", 0, sectionOrder(nbaRef, "live"));
    settings.setModules((l) => fold(rank(l, dragged, "nba"), ["court"], "nba", true));
    // A reload: the settings as stored, read back.
    const stored = () => {
      const s = sanitize(JSON.parse(JSON.stringify(getSettings())));
      return { folded: s.foldedModules, hidden: s.hiddenModules, order: s.moduleOrder } as ModuleLayout;
    };
    expect(ranking(stored(), "nba")).toEqual(dragged);
    expect(isFolded(stored(), "court", "nba")).toBe(true);
    expect(shown(stored(), sectionOrder(nbaRef, "final"), "nba")[0]).toBe("box");
    settings.setModules((l) => hide(l, "box", "nba", true));
    settings.setModules((l) => hide(l, "box", "nba", false));
    settings.setModules((l) => fold(l, ["court"], "nba", false));
    expect(ranking(stored(), "nba")).toEqual(dragged);
    settings.setModules((l) => restoreDefaults(l, "nba"));
    expect(ranking(stored(), "nba")).toEqual([]);
    expect(getSettings().moduleOrder.nba).toBeUndefined();
  });
});

describe("Customize", () => {
  it("lists the modules in the plan's order by default; a held row lands in the slot nearest the pointer; its order is the page's", () => {
    let layout: ModuleLayout = NO_MODULES;
    const rows = customizeRows(nbaRef, layout).map((r) => r.id);
    expect(rows).toEqual(modulesFor(nbaRef).map((m) => m.section));
    const to = customizeIndex(0, 2 * CUSTOMIZE_PITCH + 6, rows.length);
    expect(to).toBe(2);
    expect(customizeIndex(1, -400, rows.length)).toBe(0);
    expect(customizeIndex(1, 9_999, rows.length)).toBe(rows.length - 1);
    layout = rank(layout, move(rows[0]!, to, rows), "nba");
    const after = customizeRows(nbaRef, layout);
    expect(after.map((r) => r.id)[2]).toBe(rows[0]);
    expect(after.find((r) => r.id === "plays")?.liveOnly).toBe(true);
    const live = new Set<string>(sectionOrder(nbaRef, "live"));
    expect(shown(layout, sectionOrder(nbaRef, "live"), "nba")).toEqual(after.map((r) => r.id).filter((id) => live.has(id)));
  });
});
