/**
 * The play theater from MLB's official account (PlayCreditsTests.swift,
 * check by check, on the same games: World Series Games 3 and 4, ESPN's
 * plays (mlb-ws-g3-plays.json, ws-g4-plays.json) and MLB's feed for each
 * (statcast-849804.json, statcast-849803.json), all trimmed from the Swift
 * app's Tests/Fixtures): every runner's legs and every fielder's credit
 * parsed; the ball to the man who fielded it, at the real spot (on through
 * the infield to an outfielder); the throws along the credited chain to the
 * putouts, errors and deflections as credited; each runner on his real path,
 * the outs at the real bases in the real order; and the story told in order,
 * the camera taking every run home. Without MLB's account, ESPN's text and
 * the inference, as before.
 */
import { describe, expect, it } from "vitest";
import { credited, effort, officialRunners, parse, type Handling, type PlayScene, type SideOf, type Throw } from "../../src/data/mlb/playScene";
import { PlayScript } from "../../src/data/mlb/playScript";
import { atBatResult, STATCAST_FIELDS, statcastAtBats, type Credit, type Movement, type StatcastAtBat } from "../../src/data/mlb/statcast";
import { Ballpark, fieldPoint, ground, samePoint, type FieldPoint } from "../../src/data/mlb/theaterField";
import { fixture } from "./fixtures";
import { ends, inView } from "./playHelpers";

interface Game {
  readonly plays: unknown[];
  readonly names: Record<string, string>;
  readonly atBats: StatcastAtBat[];
}

function load(espn: string, mlb: string): Game {
  const e = fixture(espn) as { items: unknown[]; names: Record<string, string> };
  return { plays: e.items, names: e.names, atBats: statcastAtBats(fixture(mlb)) };
}

const g3 = load("mlb-ws-g3-plays.json", "statcast-849804.json");
const g4 = load("ws-g4-plays.json", "statcast-849803.json");
// MIL (8) at TB (30) both nights.
const side: SideOf = (id) => (id === "8" ? "top" : id === "30" ? "bottom" : null);
const idOf = (p: unknown) => (p as { id?: string }).id;
const typeOf = (p: unknown) => (p as { type?: { type?: string } }).type?.type;

function sceneIn(g: Game, id: string, measured = true): PlayScene | null {
  const i = g.plays.findIndex((p) => idOf(p) === id);
  const s = i < 0 ? null : parse(g.plays, i, side, g.names);
  if (s && measured) s.measured = s.measurement(g.atBats);
  return s;
}

function scenes(g: Game): PlayScene[] {
  return g.plays.flatMap((p, i) => {
    if (typeOf(p) !== "play-result") return [];
    const s = parse(g.plays, i, side, g.names);
    if (!s) return [];
    s.measured = s.measurement(g.atBats);
    return [s];
  });
}

function script(s: PlayScene | null): PlayScript | null {
  return s ? PlayScript.play(s, { bases: s.endsInning ? [false, false, false] : s.basesAfter, bats: "R", swapped: s.endsInning }) : null;
}

const handling = (fielder: number, chain: readonly Partial<Throw>[] = [], extra: Partial<Handling> = {}): Handling => ({
  fielder,
  deflection: null,
  fumble: null,
  chain: chain.map((t) => ({ to: t.to!, base: t.base ?? null, wild: t.wild ?? false })),
  ...extra,
});

const leg = (m: Partial<Movement> & { runner: number; from: number }): Movement => ({ to: null, out: null, outNumber: null, reason: null, event: 0, credits: [], ...m });

const all3 = scenes(g3);
const all4 = scenes(g4);
const ORIGIN_FP: FieldPoint = { x: 0, y: 0, z: 0 };

describe("MLB's account, parsed", () => {
  it("a play's legs: Contreras singles, then out stretching at second (9 to 6), the second out; Bauers home from second", () => {
    const contreras = g3.atBats.find((a) => a.inning === 3 && a.top && a.batter === "William Contreras")!;
    const legs = atBatResult(contreras);
    expect(legs.length).toBe(6);
    expect(legs.filter((m) => m.runner === legs[0]!.runner).map((m) => m.to)).toEqual([1, null]);
    const last = legs[legs.length - 1]!;
    expect([last.out, last.outNumber, last.reason]).toEqual([2, 2, "r_out_stretching"]);
    expect(last.credits.map((c) => c.position)).toEqual([9, 9, 6]);
    expect(last.credits[last.credits.length - 1]?.kind).toBe("putout");
    const bauers = legs.filter((m) => m.runner === legs.find((x) => x.from === 2)?.runner);
    expect(bauers.map((m) => m.to)).toEqual([3, 4]);
    // …and the ball's fielder (MLB's location): the right fielder.
    expect(contreras.batted?.fielder).toBe(9);
  });
  it("a steal between pitches is the at-bat's, but not its result's: the walk's legs are the batter's alone", () => {
    const yelich = g3.atBats.find((a) => a.inning === 5 && a.top && a.batter === "Christian Yelich")!;
    const result = atBatResult(yelich);
    expect(yelich.runners.length).toBe(2);
    expect(result.length).toBe(1);
    expect([result[0]!.from, result[0]!.to]).toEqual([0, 1]);
  });
  it("the feed's fields ask for the runners, their credits and the ball's fielder", () => {
    for (const field of ["runners", "credits", "location"]) expect(STATCAST_FIELDS.split(",")).toContain(field);
  });
  it("every plate appearance in Game 4 finds its MLB at-bat", () => {
    const appearances = all4.filter((s) => s.appearance != null);
    expect(appearances.length).toBeGreaterThan(0);
    expect(appearances.filter((s) => s.measurement(g4.atBats) == null).map((s) => s.text)).toEqual([]);
  });
});

describe("the handling, credited", () => {
  it("6-3, 4-6-3, 3U, F9, out stretching, 1B E5, a deflection, strike three", () => {
    // 6-3: the shortstop fields it, the throw to first.
    expect(sceneIn(g3, "4019080440005990057")?.handling).toEqual(handling(6, [{ to: 3, base: 1 }]));
    // 4-6-3: second to short at second (the first out), short to first (the second).
    expect(sceneIn(g3, "4019080441102990057")?.handling).toEqual(handling(4, [{ to: 6, base: 2 }, { to: 3, base: 1 }]));
    // 3U: the first baseman takes it to the bag himself (no toss to the pitcher).
    expect(sceneIn(g3, "4019080441303990057")?.handling).toEqual(handling(3, [{ to: 3, base: 1 }]));
    // F9: the catch is the out, no throw.
    expect(sceneIn(g3, "4019080440102990057")?.handling).toEqual(handling(9));
    // A single, the batter out stretching: fielded by the right fielder, his throw to the shortstop at second.
    expect(sceneIn(g3, "4019080440405990057")?.handling).toEqual(handling(9, [{ to: 6, base: 2 }]));
    // 1B E5: the third baseman fields it, and his throw to first gets away.
    expect(sceneIn(g3, "4019080441002990057")?.handling).toEqual(handling(5, [{ to: 3, base: 1, wild: true }]));
    // A double off the third baseman's glove: deflected by him, fielded by the left fielder.
    expect(sceneIn(g3, "4019080440808990057")?.handling).toEqual(handling(7, [], { deflection: 5 }));
    // Strike three: the catcher's, no throw.
    expect(sceneIn(g3, "4019080440902990057")?.handling?.chain).toEqual([]);
    // Without MLB's account, no handling: infer it.
    expect(sceneIn(g3, "4019080440005990057", false)?.handling).toBeNull();
  });
});

describe("the runners, official", () => {
  it("every Game 3 and 4 runner goes where MLB's legs took him; ESPN's account agrees but for two it can't know (Game 4's third strikes dropped and thrown to first)", () => {
    const disagree = [...all3, ...all4].filter((s) => s.measured != null && ends(s.official.runners) !== ends(s.runners));
    expect(disagree.map((s) => s.id)).toEqual(["4019080451503990057", "4019080451903990057"]);
  });
  it("…with the order of the outs, and a wait at first for a throw that got away", () => {
    expect(sceneIn(g3, "4019080440405990057")?.official.runners[0]?.outNumber).toBe(2);
    expect(sceneIn(g3, "4019080441002990057")?.official.runners[0]?.waits).toBe(1);
  });
  it("the batter's out on a fly is at the catch (MLB's \"1B\" is a placeholder)", () => {
    const fly = leg({ runner: 1, from: 0, out: 1, outNumber: 1, credits: [{ position: 8, kind: "putout" }] });
    expect(ends(officialRunners([{ id: "b", from: 0, end: { kind: "base", base: 1 } }], [fly], true, false))).toBe("B×c");
  });
  it("a runner only MLB has joins the play; the batter MLB doesn't list keeps ESPN's account", () => {
    const missing = leg({ runner: 2, from: 2, to: 3, reason: "r_adv_play" });
    expect(ends(officialRunners([{ id: "b", from: 0, end: { kind: "base", base: 1 } }], [missing], false, false))).toBe("B→1 2→3");
  });
  it("an account still being posted (fewer runs than ESPN's): ESPN's runners, and the handling inferred", () => {
    const partial = sceneIn(g3, "4019080440806990057")!;
    partial.measured = { ...partial.measured!, movements: partial.measured!.movements.filter((m) => m.to !== 4) };
    expect(partial.legs).toBeNull();
    expect(partial.official.runners).toEqual(partial.runners);
    expect(partial.handling).toBeNull();
  });
});

describe("the owner's two plays (Game 4, top of the 4th)", () => {
  it("Frelick's single through the right side: the right fielder fields it on the grass, on its line through MLB's spot", () => {
    const sc = script(sceneIn(g4, "4019080450603990057"))!;
    const flight = sc.flights[sc.batted!]!;
    const end = ground(flight.to);
    const gather = sc.actors[8]!.actions.find((a) => a.kind === "scoop");
    expect(Ballpark.distance(end)).toBeGreaterThan(200);
    expect(gather != null && Math.abs(gather.at - flight.end) < 0.001).toBe(true);
    const at = sc.actors[8]!.position(flight.end);
    expect(Math.hypot(at.x - end.x, at.y - end.y)).toBeLessThan(1);
    const mlbSpot = Ballpark.feet({ x: 151.11, y: 162.18 });
    expect(Math.abs(Ballpark.bearing(end) - Ballpark.bearing(mlbSpot)) * Ballpark.distance(mlbSpot)).toBeLessThan(1.5);
    // The first baseman reaches for it as it goes by (the pitcher, too far away, doesn't).
    expect(sc.actors[2]!.actions.some((a) => a.kind === "scoop" && a.at < flight.end)).toBe(true);
    expect(sc.actors[0]!.actions.some((a) => a.kind === "scoop")).toBe(false);
    // Nobody fields it on the infield and throws to first.
    expect(sc.flights.some((f) => samePoint(ground(f.to), Ballpark.bag(1)))).toBe(false);
    expect(sc.actors[3]!.actions.some((a) => a.kind === "throwBall")).toBe(false);
  });
  it("Pratt's double, Frelick in from first: the hit, the left fielder gathers it, Frelick crosses, then Pratt pulls into second, the camera on each", () => {
    const sc = script(sceneIn(g4, "4019080450604990057"))!;
    const run = sc.flashes.find((f) => f.beat === "run")!;
    const gathered = sc.actors[6]!.actions.find((a) => a.kind === "scoop")?.at ?? Infinity;
    const second = sc.actors[9]!.moves.find((m) => samePoint(m.path[m.path.length - 1]!, Ballpark.base(2)))?.end ?? 0;
    expect(sc.flights[sc.batted!]!.start).toBeLessThan(gathered);
    expect(gathered).toBeLessThan(run.at);
    expect(run.at).toBeLessThan(second);
    const frame = sc.camera.frame(run.at);
    const runner = sc.actors.findIndex((a) => a.role.kind === "runner");
    expect(inView(ORIGIN_FP, frame)).toBe(true);
    expect(inView(fieldPoint(sc.actors[runner < 0 ? 10 : runner]!.position(run.at - 0.05)), frame)).toBe(true);
    expect(inView(fieldPoint(Ballpark.base(2)), sc.camera.frame(second))).toBe(true);
    // The mark (+1) once he's in, all in under 8 s.
    expect(sc.stamp).toBeGreaterThanOrEqual(run.at);
    expect(sc.duration).toBeLessThan(8.5);
  });
});

describe("every play, against MLB's account", () => {
  it("every ball in play in Games 3 and 4 goes to the man MLB credits with fielding it, and every credited throw to its man, the outs at the credited bases in order", () => {
    let firsts = 0;
    let firstsOK = 0;
    let chains = 0;
    let chainsOK = 0;
    const misses: string[] = [];
    for (const s of [...all3, ...all4]) {
      if (!s.inPlay || s.kind.type === "homeRun") continue;
      const h = s.handling;
      const sc = script(s);
      if (!h || !sc || sc.batted == null) continue;
      const b = sc.batted;
      const flight = sc.flights[b]!;
      let first: number | null = null;
      let firstAt = Infinity;
      for (let i = 0; i < 9; i++) {
        for (const a of sc.actors[i]!.actions) {
          if ((a.kind === "catchHigh" || a.kind === "scoop" || a.kind === "glove") && a.at >= flight.end - 0.01 && a.at < firstAt) {
            first = i;
            firstAt = a.at;
          }
        }
      }
      firsts += 1;
      if (first === h.fielder - 1) firstsOK += 1;
      else misses.push(`first: ${s.text}`);
      // Each throw to the credited man, and the outs at the credited bases in the credited order.
      const throwsTo = sc.flights.flatMap((f, j) => {
        if (j <= b) return [];
        for (let i = 0; i < 9; i++) if (sc.actors[i]!.actions.some((a) => a.kind === "glove" && Math.abs(a.at - f.end) < 0.001)) return [i + 1];
        return [];
      });
      // (A putout he makes himself is a carry, not a throw.)
      let holder = h.fielder;
      const want: number[] = [];
      for (const t of h.chain) {
        if (t.wild) continue;
        if (t.to !== holder) want.push(t.to);
        holder = t.to;
      }
      const outs = sc.flashes.filter((f) => f.beat === "out").sort((x, y) => x.at - y.at).map((f) => ground(f.point));
      const bases = h.chain.filter((t) => !t.wild && t.base != null).map((t) => Ballpark.base(t.base!));
      if (h.chain.length === 0) continue;
      chains += 1;
      const sameOuts = outs.length === bases.length && outs.every((p, i) => samePoint(p, bases[i]!));
      if (JSON.stringify(throwsTo.slice(0, want.length)) === JSON.stringify(want) && sameOuts) chainsOK += 1;
      else misses.push(`chain: ${s.text} ${JSON.stringify(throwsTo)}/${JSON.stringify(want)} ${outs.length}/${bases.length}`);
    }
    expect(misses).toEqual([]);
    expect(firsts).toBeGreaterThan(70);
    expect(firstsOK).toBe(firsts);
    expect(chains).toBeGreaterThan(15);
    expect(chainsOK).toBe(chains);
    // The Swift's numbers on the same games.
    expect([firstsOK, firsts, chainsOK, chains]).toEqual([FIRSTS, FIRSTS, CHAINS, CHAINS]);
  });
  it("the scorer's chain credited (who fielded it, each man who took a throw)", () => {
    expect(credited(handling(1, [{ to: 3 }, { to: 6 }, { to: 4, base: 2 }]))).toEqual([1, 3, 6, 4]);
    expect(credited(handling(5, [{ to: 3, base: 1, wild: true }]))).toEqual([5]);
  });
});

/** PlayCreditsTests.swift's counts on Games 3 and 4, as the Mac's suite prints them at 4178670: every ball in play with MLB's account (119/119), every one with a credited throw (41/41). */
const FIRSTS = 119;
const CHAINS = 41;

const g2 = (fixture("mlb-ws-g2-summary-plays.json") as { plays: unknown[] }).plays;
const homer = (() => {
  const i = g2.findIndex((p) => idOf(p) === "4019080430005990057");
  return parse(g2, i, (id) => (id === "30" ? "top" : "bottom"));
})();

describe("the story in order, the camera on every run", () => {
  it("the camera never leaves a run scoring (or an out) off screen, with and without MLB; replays stay short", { timeout: 60_000 }, () => {
    const offscreen: string[] = [];
    const outsUnseen: string[] = [];
    const long: string[] = [];
    const everything = [...all3, ...all4].flatMap((s) => [s, s.copy({ measured: null })]);
    if (homer) everything.push(homer);
    for (const s of everything) {
      const sc = script(s)!;
      for (const run of sc.flashes.filter((f) => f.beat === "run")) {
        const frame = sc.camera.frame(run.at);
        const crossing = sc.actors.flatMap((a, i) => (a.team === "batting" && Math.abs(a.vanish - run.at - 0.15) < 0.01 ? [i] : []));
        if (!inView(ORIGIN_FP, frame) || !crossing.every((i) => inView(fieldPoint(sc.actors[i]!.position(run.at - 0.1)), frame, 0.03))) {
          offscreen.push(`${s.text} at ${run.at.toFixed(2)}`);
        }
      }
      for (const out of sc.flashes.filter((f) => f.beat === "out")) {
        if (!inView(out.point, sc.camera.frame(out.at), 0.03)) outsUnseen.push(`${s.text} at ${out.at.toFixed(2)}`);
      }
      if (sc.settle - 0.75 > (s.runs > 1 ? 7.0 : 5.6)) long.push(`${s.text} ${(sc.settle - 0.75).toFixed(2)}`);
    }
    expect(offscreen).toEqual([]);
    expect(outsUnseen).toEqual([]);
    expect(long).toEqual([]);
  });
  it("a two-run single: each run crosses after the ball's gathered, a beat apart", () => {
    const sc = script(sceneIn(g3, "4019080440806990057"))!;
    const runs = sc.flashes.filter((f) => f.beat === "run").map((f) => f.at).sort((a, b) => a - b);
    const gathered = sc.actors[5]!.actions.find((a) => a.kind === "scoop")?.at ?? Infinity;
    expect(runs.length).toBe(2);
    expect(runs[0]!).toBeGreaterThan(gathered);
    expect(runs[1]! - runs[0]!).toBeGreaterThanOrEqual(0.55);
  });
  it("a two-run home run: the runner home ahead of the batter, both after the cut to the trot", () => {
    const sc = script(homer)!;
    const cut = sc.shots.find((s) => s.cut)!;
    const runs = sc.flashes.filter((f) => f.beat === "run").map((f) => f.at).sort((a, b) => a - b);
    expect(runs.length).toBe(2);
    expect(runs.every((r) => r > cut.from)).toBe(true);
    expect(sc.actors[9]!.vanish).toBeGreaterThan(runs[0]! + 0.15);
    expect(sc.settle - 0.75).toBeLessThan(4.8);
  });
  it("three runs on a double: each crosses a beat apart, and the replay still settles in about 7 s", () => {
    const s = sceneIn(g3, "4019080440808990057")!;
    const m = s.measured!;
    s.runners.splice(1, 0, { id: "x", from: 3, end: { kind: "scored" } });
    s.runs = 3;
    s.measured = { ...m, movements: [...m.movements, leg({ runner: 99, from: 3, to: 4, reason: "r_adv_force" })] };
    const sc = script(s)!;
    const runs = sc.flashes.filter((f) => f.beat === "run").map((f) => f.at).sort((a, b) => a - b);
    expect(runs.length).toBe(3);
    expect(runs.slice(1).every((r, i) => r - runs[i]! >= 0.55)).toBe(true);
    expect(sc.duration).toBeLessThan(9);
    expect(sc.settle - 0.75).toBeLessThan(7);
  });
});

describe("throws that get away, relays, a runner thrown out at home", () => {
  it("1B E5: the throw sails past first; the batter, there already, goes on to second as it gets by", () => {
    const sc = script(sceneIn(g3, "4019080441002990057"))!;
    const wild = sc.flights.find((f) => f.from.z === 5 && f.to.z === 0);
    const batter = sc.actors[9]!;
    const atFirst = batter.moves.find((m) => samePoint(m.path[m.path.length - 1]!, Ballpark.base(1)))?.end ?? Infinity;
    const onward = batter.moves.find((m) => samePoint(m.path[m.path.length - 1]!, Ballpark.base(2)))?.start ?? 0;
    expect(wild).toBeDefined();
    expect(sc.flashes.every((f) => f.beat !== "out")).toBe(true);
    expect(atFirst).toBeLessThan(onward);
    expect(onward).toBeGreaterThanOrEqual(wild!.start + (wild!.end - wild!.start) / 1.3 - 0.12);
  });
  it("a relay home (Games 1 and 2's credits, on Game 3's double): left to short (the cutoff), short to the catcher; the runner out at the plate, and no run", () => {
    const s = sceneIn(g3, "4019080440809990057")!;
    const m = s.measured!;
    const relay: Credit[] = [
      { position: 7, kind: "assist" },
      { position: 7, kind: "outfieldAssist" },
      { position: 6, kind: "assist" },
      { position: 2, kind: "putout" },
    ];
    s.measured = {
      ...m,
      movements: m.movements.map((x) => (x.from === 3 ? leg({ runner: x.runner, from: 3, out: 4, outNumber: 1, reason: "r_thrown_out", event: x.event, credits: relay }) : x)),
    };
    s.runners = s.runners.map((r) => (r.from === 2 ? { id: r.id, from: 2, end: { kind: "out", at: 0 } } : r));
    s.runs = 0;
    expect(s.handling?.chain).toEqual([
      { to: 6, base: null, wild: false },
      { to: 2, base: 0, wild: false },
    ]);
    const sc = script(s)!;
    const out = sc.flashes.find((f) => f.beat === "out")!;
    const runner = sc.actors.findIndex((a) => a.role.kind === "runner");
    expect(samePoint(ground(out.point), Ballpark.base(0))).toBe(true);
    expect(sc.actors[5]!.actions.some((a) => a.kind === "throwBall")).toBe(true);
    expect(sc.actors[runner < 0 ? 10 : runner]!.vanish).toBeGreaterThan(out.at);
    expect(sc.flashes.every((f) => f.beat !== "run")).toBe(true);
  });
});

describe("Game 4's odd ones: a third strike dropped, a rundown, a throw that let a run in", () => {
  it("strike three dropped (\"catcher to first baseman\"): the catcher's throw, the batter out at first, marked K 2-3", () => {
    const dropped = sceneIn(g4, "4019080451503990057")!;
    expect(dropped.handling).toEqual(handling(2, [{ to: 3, base: 1 }]));
    expect(ends(dropped.official.runners)).toBe("B×1");
    expect(dropped.notation.code).toBe("K 2-3");
    expect(sceneIn(g3, "4019080440902990057")?.notation.code).toBe("K");
    const sc = script(dropped)!;
    const outs = sc.flashes.filter((f) => f.beat === "out");
    const out = outs[outs.length - 1]!;
    // He runs for it, a step behind the throw.
    expect(samePoint(ground(out.point), Ballpark.base(1))).toBe(true);
    expect(sc.actors[1]!.actions.some((a) => a.kind === "throwBall")).toBe(true);
    expect(sc.actors[9]!.position(out.at).x).toBeGreaterThan(40);
  });
  it("a pickoff into a rundown: pitcher to first, to short, to second for the tag; CS 1-3-6-4 from MLB's credits", () => {
    const bare = sceneIn(g4, "4019080450705040298", false)!;
    const rundown = bare.copy({ measured: bare.runnerMeasurement(g4.atBats) });
    expect(rundown.handling).toEqual(handling(1, [{ to: 3 }, { to: 6 }, { to: 4, base: 2 }]));
    expect(rundown.notation.code).toBe("CS 1-3-6-4");
    // ESPN's text names no one: CS alone.
    expect(bare.notation.code).toBe("CS");
    const sc = script(rundown)!;
    for (const i of [0, 2, 5]) expect(sc.actors[i]!.actions.some((a) => a.kind === "throwBall")).toBe(true);
    expect(sc.actors[3]!.actions.some((a) => a.kind === "glove")).toBe(true);
    const outs = sc.flashes.filter((f) => f.beat === "out").map((f) => ground(f.point));
    expect(outs.length).toBe(1);
    expect(samePoint(outs[0]!, Ballpark.base(2))).toBe(true);
  });
  it("a fielder's choice the third baseman throws away: to third, past it, and the runner from second comes on home", () => {
    const fc = sceneIn(g4, "4019080450703990057")!;
    expect(fc.handling).toEqual(handling(5, [{ to: 6, base: 3, wild: true }]));
    expect(fc.official.runners.find((r) => r.from === 2)?.waits).toBe(3);
  });
});

describe("a diving catch", () => {
  it("the left fielder at full stretch, the glove to the ball low; a leap when it says leaping; nothing when it doesn't", () => {
    const s = sceneIn(g3, "4019080440203990057")!;
    s.effort = effort("Frelick lines out to left fielder Chandler Simpson on a diving catch.");
    const dive = script(s)!.actors[6]!.dive;
    expect(s.effort).toBe("diving");
    expect(dive).not.toBeNull();
    expect(dive!.target.z).toBeLessThanOrEqual(1.5);
    expect(script(s)!.actors[6]!.actions.some((a) => a.kind === "scoop" && Math.abs(a.at - dive!.reach) < 0.001)).toBe(true);
    expect(effort("leaping catch at the wall")).toBe("leaping");
    expect(effort("Díaz lined out to left.")).toBeNull();
    expect(script(sceneIn(g3, "4019080440203990057"))!.actors.every((a) => a.dive == null)).toBe(true);
  });
});

describe("plays between pitches", () => {
  const runnersOnly = (plays: readonly PlayScene[], g: Game) => plays.filter((s) => s.batter == null).map((s) => s.copy({ measured: s.runnerMeasurement(g.atBats) }));
  const runnerPlays = [...runnersOnly(all3, g3), ...runnersOnly(all4, g4)];
  it("every runner's play between pitches (steals, caught stealing, a wild pitch, indifference) finds its legs in MLB's feed", () => {
    expect(runnerPlays.length).toBeGreaterThanOrEqual(6);
    expect(runnerPlays.filter((s) => s.legs == null).map((s) => s.text)).toEqual([]);
  });
  it("Yelich's steal and the catcher's throwing error: MLB's legs take him to third; the throw to second got away", () => {
    const steal = runnerPlays.find((s) => s.id === "4019080450004040298")!;
    expect(ends(steal.runners)).toBe("1→3");
    expect(ends(steal.official.runners)).toBe("1→3");
    expect(steal.official.runners[0]?.waits).toBe(2);
    expect(steal.handling).toEqual(handling(2, [{ to: 4, base: 2, wild: true }]));
    // A caught stealing, catcher to shortstop at second.
    const cs = runnerPlays.find((s) => s.text.includes("caught stealing, catcher to shortstop") || s.notation.code === "CS 2-6");
    expect(cs?.handling).toEqual(handling(2, [{ to: 6, base: 2 }]));
    const sc = script(steal)!;
    const runner = sc.actors.findIndex((a) => a.role.kind === "runner");
    const moves = sc.actors[runner]!.moves.slice(0, 2);
    const wild = sc.flights.find((f) => f.to.z === 0 && f.from.z === 5);
    // The throw to second gets past the bag, and Yelich, there, goes on to third.
    expect(moves.length).toBe(2);
    expect(samePoint(moves[0]!.path[moves[0]!.path.length - 1]!, Ballpark.base(2))).toBe(true);
    expect(samePoint(moves[1]!.path[moves[1]!.path.length - 1]!, Ballpark.base(3))).toBe(true);
    expect(moves[1]!.start).toBeGreaterThanOrEqual(wild!.start + (wild!.end - wild!.start) / 1.3 - 0.12);
  });
});
