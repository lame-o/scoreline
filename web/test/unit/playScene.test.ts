/**
 * The play theater's parser (PlayTheaterTests.swift): ESPN's plays parsed
 * into scenes (World Series Game 3's core plays, mlb-ws-g3-plays.json, and
 * Game 2's summary plays for its home runs), the scorer's notation, runners
 * by athlete ID, and who's up.
 */
import { describe, expect, it } from "vitest";
import { isPlay, notationText, parse, theater, type PlayScene, type SideOf } from "../../src/data/mlb/playScene";
import { fixture } from "./fixtures";

const g3 = fixture("mlb-ws-g3-plays.json") as { items: unknown[]; names: Record<string, string> };
const plays = g3.items;
const names = g3.names;
// MIL (8) at TB (30): the visitors are the top team.
const side: SideOf = (id) => (id === "8" ? "top" : id === "30" ? "bottom" : null);
const idOf = (p: unknown) => (p as { id?: string }).id;
const typeOf = (p: unknown) => (p as { type?: { type?: string } }).type?.type;

function scene(id: string, withNames: Record<string, string> = {}): PlayScene | null {
  const i = plays.findIndex((p) => idOf(p) === id);
  return i < 0 ? null : parse(plays, i, side, withNames);
}

/** "B→1 1→2": each runner from his base to where he ended (R scored, × out at, c the catch). */
function ends(s: PlayScene | null): string {
  return (s?.runners ?? [])
    .map((r) => {
      const from = r.from === 0 ? "B" : String(r.from);
      switch (r.end.kind) {
        case "base":
          return `${from}→${r.end.base}`;
        case "scored":
          return `${from}→R`;
        case "out":
          return `${from}×${r.end.at ?? "c"}`;
      }
    })
    .join(" ");
}

describe("every play", () => {
  const results = plays.flatMap((p, i) => (typeOf(p) === "play-result" ? [i] : []));
  const scenes = results.flatMap((i) => parse(plays, i, side, names) ?? []);
  const lineups = results.filter((i) => (plays[i] as { alternativeType?: { type?: string } }).alternativeType?.type === "lineup-change").length;

  it("every play-result but a lineup change is a play on the field", () => {
    expect(lineups).toBe(18);
    expect(scenes.length).toBe(results.length - lineups);
  });
  it("every Game 3 play has a scorer's mark", () => {
    expect(scenes.filter((s) => s.notation.code === "").map((s) => s.text)).toEqual([]);
  });
  it("every ball in play has its spot and trajectory", () => {
    expect(scenes.filter((s) => s.inPlay).every((s) => s.spot != null && s.trajectory != null)).toBe(true);
  });
  it("every play knows the batting team (the result's team, not the pitch's)", () => {
    expect(scenes.every((s) => s.batting != null)).toBe(true);
  });
  it("outs made match the runners put out", () => {
    const miscounted = scenes.filter((s) => s.outsAfter - s.outsBefore !== s.runners.filter((r) => r.end.kind === "out").length);
    expect(miscounted.map((s) => s.text)).toEqual([]);
  });
});

describe("kinds and notation", () => {
  const single = scene("4019080440003990057");
  const groundOut = scene("4019080440005990057");

  it("a single on a fly ball to the left fielder", () => {
    expect(single?.kind).toEqual({ type: "single" });
    expect(single?.notation.code).toBe("1B");
    expect(single?.trajectory).toBe("fly");
    expect(single?.spot).toEqual({ x: 64, y: 142 });
    expect(single?.fielders).toEqual([7]);
  });
  it("…the batter to first, the runner from first to second", () => {
    expect(ends(single)).toBe("B→1 1→2");
    expect(single?.outsBefore).toBe(1);
    expect(single?.outsAfter).toBe(1);
  });
  it("…batting left-handed, off a 95 mph four-seamer, for the top team", () => {
    expect(single?.bats).toBe("L");
    expect(single?.pitch?.code).toBe("FF");
    expect(single?.pitch?.mph).toBe(95);
    expect(single?.batting).toBe("top");
  });
  it("grounds out, shortstop to first baseman: 6-3", () => {
    expect(groundOut?.notation.code).toBe("6-3");
    expect(groundOut?.kind.type).toBe("groundOut");
    expect(groundOut?.flight).toBe("ground");
  });
  it("…the batter out at first; the runners stranded as the inning ends", () => {
    expect(ends(groundOut)).toBe("B×1 2→2 1→1");
    expect(groundOut?.endsInning).toBe(true);
  });
  it("3U, P6, F9, L7, and foul outs by trajectory", () => {
    expect(scene("4019080441303990057")?.notation.code).toBe("3U");
    expect(scene("4019080440004990057")?.notation.code).toBe("P6");
    expect(scene("4019080440004990057")?.trajectory).toBe("popUp");
    expect(scene("4019080440102990057")?.notation.code).toBe("F9");
    expect(scene("4019080440203990057")?.notation.code).toBe("L7");
    expect(scene("4019080441602990057")?.notation.code).toBe("P3");
    expect(scene("4019080441402990057")?.notation.code).toBe("F7");
  });
  it("a force at second: FC 6-4, the runner from first out at second", () => {
    const force = scene("4019080440103990057");
    expect(force?.notation.code).toBe("FC 6-4");
    expect(ends(force)).toBe("B→1 1×2");
  });
  it("a 4-6-3 double play: both outs, the lead runner's at second", () => {
    const dp = scene("4019080441102990057");
    expect(dp?.notation.code).toBe("4-6-3 DP");
    expect(dp?.outsBefore).toBe(0);
    expect(dp?.outsAfter).toBe(2);
    expect(ends(dp)).toBe("B×1 1×2");
  });
  it("called out on strikes: a K drawn backwards", () => {
    const looking = scene("4019080440902990057");
    expect(looking?.kind).toEqual({ type: "strikeout", looking: true });
    expect(looking?.notation.backwards).toBe(true);
    expect(looking ? notationText(looking.notation) : "").toBe("ꓘ");
  });
  it("struck out swinging (on a foul tip): K, out at the plate, the runner holds", () => {
    const swinging = scene("4019080440002990057");
    expect(swinging?.notation.code).toBe("K");
    expect(swinging?.notation.backwards).toBe(false);
    expect(ends(swinging)).toBe("B×0 1→1");
  });
  it("an overturned call that stands as strike three is still looking", () => {
    expect(scene("4019080440702990057")?.kind).toEqual({ type: "strikeout", looking: true });
  });
  it("a walk forces the runner from first to second; HBP", () => {
    const walk = scene("4019080440403990057");
    expect(walk?.notation.code).toBe("BB");
    expect(ends(walk)).toBe("B→1 1→2");
    expect(scene("4019080441604990057")?.notation.code).toBe("HBP");
  });
  it("caught stealing from the text's relay clause: CS 2-4, CS 2-6", () => {
    expect(scene("4019080440104040298")?.notation.code).toBe("CS 2-4");
    expect(ends(scene("4019080440104040298"))).toBe("1×2");
    expect(scene("4019080440204050298")?.notation.code).toBe("CS 2-6");
  });
  it("a stolen base: no batter on it, the runner to second; DI", () => {
    const steal = scene("4019080440804050298");
    expect(steal?.notation.code).toBe("SB");
    expect(ends(steal)).toBe("1→2");
    expect(steal?.batter).toBeNull();
    expect(scene("4019080441704020298")?.notation.code).toBe("DI");
  });
  it("an infield single and a throwing error: 1B E5, the batter to second", () => {
    const error = scene("4019080441002990057");
    expect(error?.notation.code).toBe("1B E5");
    expect(ends(error)).toBe("B→2");
  });
  it("a deflection isn't a fielding credit (doubles to left, deflected by the third baseman)", () => {
    expect(scene("4019080440808990057")?.fielders).toEqual([7]);
  });
  it("a single, a run home, the batter thrown out stretching (9-6), the runner to third: by surname", () => {
    const stretch = scene("4019080440405990057", names);
    expect(stretch?.fielders).toEqual([9, 6]);
    expect(ends(stretch)).toBe("B×2 2→R 1→3");
    expect(stretch?.runs).toBe(1);
  });
  it("…without names, still one out and one run (the lead runner scores)", () => {
    const s = scene("4019080440405990057");
    expect(s?.runners.filter((r) => r.end.kind === "out").length).toBe(1);
    expect(s?.runners.filter((r) => r.end.kind === "scored").length).toBe(1);
  });
  it("two runs score on an infield single", () => {
    const twoRuns = scene("4019080440806990057", names);
    expect(ends(twoRuns)).toBe("B→1 3→R 2→R 1→2");
    expect(twoRuns?.runs).toBe(2);
  });
});

describe("the summary's plays (Game 2): no scorer's text, ids instead of links", () => {
  const g2 = (fixture("mlb-ws-g2-summary-plays.json") as { plays: unknown[] }).plays;
  const side2: SideOf = (id) => (id === "30" ? "top" : id === "8" ? "bottom" : null);
  const scene2 = (id: string) => {
    const i = g2.findIndex((p) => idOf(p) === id);
    return i < 0 ? null : parse(g2, i, side2);
  };
  const byText = (pred: (t: string) => boolean) => {
    const p = g2.find((e) => pred((e as { text?: string }).text ?? ""));
    return p ? scene2(idOf(p)!) : null;
  };

  it("a two-run home run, 411 feet", () => {
    const homer = scene2("4019080430005990057");
    expect(homer?.kind.type).toBe("homeRun");
    expect(homer?.distance).toBe(411);
    expect(homer?.runs).toBe(2);
    expect(ends(homer)).toBe("B→R 1→R");
    expect(homer?.trajectory).toBe("fly");
    expect(homer?.batting).toBe("top");
  });
  it("a solo home run, 408 feet", () => {
    expect(scene2("4019080431101990057")?.distance).toBe(408);
    expect(ends(scene2("4019080431101990057"))).toBe("B→R");
  });
  it("a sacrifice bunt to the pitcher went to first: SAC 1-3", () => {
    const sacrifice = byText((t) => t.startsWith("Walls hit sacrifice bunt"));
    expect(sacrifice?.notation.code).toBe("SAC 1-3");
    expect(ends(sacrifice)).toBe("B×1 1→2");
  });
  it("a force at home: the catcher took the throw (FC 6-2)", () => {
    const home = byText((t) => t.includes("Chourio out at home"));
    expect(home?.notation.code).toBe("FC 6-2");
    expect(ends(home)).toBe("B→1 3×0 2→3");
  });
  it("every Game 2 play has a mark", () => {
    const all = g2.flatMap((_, i) => parse(g2, i, side2) ?? []);
    expect(all.length).toBeGreaterThan(60);
    expect(all.every((s) => s.notation.code !== "")).toBe(true);
  });
});

describe("graceful with what it doesn't know", () => {
  it("an unknown play with a spot: the ball to its spot, the batter to first", () => {
    const unknown = {
      id: "x",
      atBatId: "a",
      type: { type: "play-result" },
      alternativeType: { type: "brand-new-play" },
      text: "Something new happened.",
      team: { id: "8" },
      hitCoordinate: { x: 150, y: 100 },
      participants: [
        { type: "batter", athlete: { id: "1" } },
        { type: "onFirst", athlete: { id: "1" } },
      ],
    };
    const odd = parse([unknown], 0, side);
    expect(odd?.kind.type).toBe("other");
    expect(odd?.inPlay).toBe(true);
    expect(ends(odd)).toBe("B→1");
  });
  it("a lineup change isn't a play", () => {
    expect(parse([{ id: "z", type: { type: "play-result" }, alternativeType: { type: "lineup-change" } }], 0, side)).toBeNull();
    expect(isPlay({ id: "z", type: { type: "play-result" }, alternativeType: { type: "lineup-change" } })).toBe(false);
  });
});

describe("who's up", () => {
  const index = (id: string) => plays.findIndex((p) => idOf(p) === id);

  it("the next batter's side, from his first entry (Contreras bats right)", () => {
    const through = index("4019080440003990057");
    // Up to the next batter's first entry (the Swift test's `through + 2`, before the fixture was pruned).
    const next = plays.findIndex((p, i) => i > through && typeOf(p) === "start-batterpitcher");
    const state = theater(plays.slice(0, next + 1), side, names);
    expect(state.play?.id).toBe("4019080440003990057");
    expect(state.news).toBe(false);
    expect(state.bats).toBe("R");
  });
  it("after a steal the same batter is still up (Yelich, left)", () => {
    const steal = index("4019080440804050298");
    const state = theater(plays.slice(0, steal + 1), side);
    expect(state.play?.kind.type).toBe("stolenBase");
    expect(state.bats).toBe("L");
  });
  it("after the third out nobody's in the box yet", () => {
    const end = index("4019080440005990057");
    expect(theater(plays.slice(0, end + 1), side).bats).toBeNull();
  });
  it("the half-inning and the batter's plate appearance, for Statcast", () => {
    const single = scene("4019080440003990057");
    expect(single?.inning).toBe(1);
    expect(single?.top).toBe(true);
    expect(single?.batterID).not.toBeNull();
    expect(single?.batterOccurrence).toBe(0);
  });
});
