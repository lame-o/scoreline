/**
 * The plate umpire in the ballpark theater (PlayUmpireTests.swift, check by
 * check), against real games: World Series Game 5's pitches and plays
 * (ws-g5-plays.json with MLB's feed, statcast-849799.json), Game 3's
 * run-scoring single (mlb-ws-g3-plays.json), Game 2's out at the plate (its
 * summary, mlb-ws-g2-summary-plays.json) and Game 4's home run
 * (ws-g4-plays.json). He's behind the catcher in his own kit, in his set as
 * each pitch comes and up between them, and he makes the calls the data says
 * he made: a called strike's punch, strike three looking's punch-out, a
 * swinging strike's point, a foul's arms up, safe or out on a play at the
 * plate, a challenge's tap on the cap; nothing for a ball, nor for a home
 * run's trot.
 */
import { describe, expect, it } from "vitest";
import type { Side } from "../../src/data/models";
import { beatPitch, timeline, type BeatPitch, type PlayBeat } from "../../src/data/mlb/playBeat";
import { beatScript, idleFitting, idleScript } from "../../src/data/mlb/playBeatScript";
import { parse } from "../../src/data/mlb/playScene";
import { PlayScript, type Rest } from "../../src/data/mlb/playScript";
import { statcastAtBats } from "../../src/data/mlb/statcast";
import { Ballpark } from "../../src/data/mlb/theaterField";
import { umpire } from "../../src/data/mlb/theaterTeams";
import { fixture } from "./fixtures";

const g5 = fixture("ws-g5-plays.json") as { items: unknown[]; names: Record<string, string> };
const items = g5.items;
const names = g5.names;
const line = timeline(items, statcastAtBats(fixture("statcast-849799.json")), names);
const side = (id: string | null | undefined): Side | null => (id === "8" ? "top" : id === "30" ? "bottom" : null);
const righty: Rest = { bases: [false, false, false], bats: "R", swapped: false };
const ump = (s: PlayScript) => (s.umpire != null ? s.actors[s.umpire]! : null);
const str = (v: unknown, ...path: string[]) => path.reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], v) as string | undefined;

function play(plays: readonly unknown[], id: string, sideOf = side): PlayScript | null {
  const i = plays.findIndex((p) => str(p, "id") === id);
  const scene = i < 0 ? null : parse(plays, i, sideOf, names);
  return scene ? PlayScript.play(scene, { bases: scene.basesAfter, bats: "R", swapped: scene.endsInning }) : null;
}

describe("Where he stands", () => {
  it("stands behind the catcher in the slot on the batter's side, the last figure; not under the tarp", () => {
    const rest = PlayScript.rest(righty);
    const lefty = PlayScript.rest({ bases: [true, false, false], bats: "L", swapped: false });
    expect(ump(rest)?.team).toBe("official");
    expect(ump(rest)!.at.y).toBeLessThan(Ballpark.position(2).y);
    expect(ump(rest)!.at.x).toBeLessThan(0);
    expect(ump(lefty)!.at.x).toBeGreaterThan(0);
    expect(rest.actors.at(-1)?.role.kind).toBe("umpire");
    expect(PlayScript.rest({ ...righty, standing: { kind: "tarp" } }).umpire).toBeNull();
  });

  it("wears the umpire's kit: navy shirt, gray slacks", () => {
    const kit = umpire("dark");
    expect(kit.legs).not.toBeNull();
    expect(kit.legs).not.toBe(kit.jersey);
  });
});

describe("Each pitch", () => {
  const script = (test: (p: BeatPitch) => boolean): PlayScript => {
    const b = line.find((x) => {
      const p = beatPitch(x);
      return p != null && test(p);
    }) as PlayBeat;
    return beatScript(b, righty);
  };

  it("sets for a called strike as it comes, punches it as it pops the mitt, and is up after", () => {
    const s = script((p) => p.call === "calledStrike" && p.review == null);
    const u = ump(s)!;
    const pop = s.captions[0]!.at;
    expect(u.sets.some((w) => w.lower <= s.release! && w.upper >= s.release! && w.lower <= pop && w.upper >= pop)).toBe(true);
    expect(u.sets.some((w) => w.lower <= s.duration && w.upper >= s.duration)).toBe(false);
    expect(u.signals.map((x) => x.kind)).toEqual(["strike"]);
    expect(Math.abs(u.signals[0]!.at - pop)).toBeLessThan(0.1);
  });

  it("sets for a ball, and calls nothing", () => {
    const u = ump(script((p) => p.call === "ball" && p.review == null))!;
    expect(u.signals).toHaveLength(0);
    expect(u.sets.length).toBeGreaterThan(0);
  });

  it("puts both arms up for a foul, points for a swinging strike", () => {
    expect(ump(script((p) => p.call === "foul"))!.signals.map((x) => x.kind)).toEqual(["foul"]);
    expect(ump(script((p) => p.call === "swingingStrike"))!.signals.map((x) => x.kind)).toEqual(["swinging"]);
  });

  it("calls an overturned ball: no punch as it pops, the tap on the cap, then the strike the zone gave", () => {
    const u = ump(script((p) => p.review?.overturned === true && p.call === "calledStrike"))!;
    expect(u.signals.map((x) => x.kind)).toEqual(["challenge", "strike"]);
  });
});

describe("Plays", () => {
  const find = (text: string) => str(items.find((p) => str(p, "type", "type") === "play-result" && (str(p, "text") ?? "").includes(text)), "id")!;

  it("punches out strike three looking (Chourio, the game's first out) as it pops the mitt", () => {
    const s = play(items, find("struck out looking"))!;
    const u = ump(s)!;
    const pop = s.flashes.find((f) => f.beat === "catchBall")!.at;
    expect(u.signals.map((x) => x.kind)).toEqual(["punchOut"]);
    expect(Math.abs(u.signals[0]!.at - pop)).toBeLessThan(0.15);
    expect(u.sets.some((w) => w.lower <= pop && w.upper >= pop)).toBe(true);
  });

  it("points at strike three swinging", () => {
    expect(ump(play(items, find("struck out swinging"))!)!.signals.map((x) => x.kind)).toEqual(["swinging"]);
  });

  it("goes up the line and calls Chourio safe as he scores on Yelich's single (Game 3), then back behind the plate", () => {
    const g3 = (fixture("mlb-ws-g3-plays.json") as { items: unknown[] }).items;
    const s = play(g3, "4019080440404990057")!;
    const u = ump(s)!;
    const run = s.flashes.find((f) => f.beat === "run")!;
    expect(u.signals.some((x) => x.kind === "safe" && Math.abs(x.at - run.at) < 0.1 && x.toward.x === 0 && x.toward.y === 0)).toBe(true);
    expect(u.position(run.at).x).toBeLessThan(-5);
    expect(u.position(s.duration)).toEqual(Ballpark.umpire("R"));
  });

  it("calls Hicks out at home (Game 2), the hammer as the tag goes down", () => {
    const g2 = (fixture("mlb-ws-g2-summary-plays.json") as { plays: unknown[] }).plays;
    const s = play(g2, "4019080431004990057", (id) => (id === "30" ? "top" : "bottom"))!;
    const u = ump(s)!;
    const out = s.flashes.find((f) => f.beat === "out" && Math.hypot(f.point.x, f.point.y) < 3)!;
    expect(u.signals.some((x) => x.kind === "out" && Math.abs(x.at - out.at) < 0.1)).toBe(true);
    expect(u.signals.some((x) => x.kind === "safe")).toBe(false);
  });

  it("makes no call on a home run's trot (Pratt, Game 4)", () => {
    const g4 = (fixture("ws-g4-plays.json") as { items: unknown[] }).items;
    const s = play(g4, "4019080452201990057")!;
    expect(s.fence).not.toBeNull();
    expect(ump(s)!.signals).toHaveLength(0);
  });
});

describe("Between pitches", () => {
  it("may dust off the plate between halves (not with a batter in)", () => {
    expect(idleFitting({ bases: [false, false, false], bats: null, swapped: false }, true)).toContain("brush");
    expect(idleFitting(righty, false)).not.toContain("brush");
  });

  it("goes round the catcher to the plate, bends over it, and back", () => {
    const brush = idleScript("brush", { bases: [false, false, false], bats: null, swapped: false }, 5n);
    const u = ump(brush)!;
    expect(u.position(0)).toEqual(u.at);
    expect(u.position(brush.duration)).toEqual(u.at);
    expect(u.position(1.25).y).toBeGreaterThan(1);
    expect(u.actions.some((a) => a.kind === "scoop")).toBe(true);
    expect(brush.duration).toBeLessThanOrEqual(3);
  });

  it("stays when the sides change, behind the plate", () => {
    const id = str(items.find((p) => str(p, "type", "type") === "play-result" && (p as { outs?: number }).outs === 3), "id")!;
    const u = ump(play(items, id)!)!;
    expect(u.vanish).toBe(Infinity);
    expect(u.position(Infinity)).toEqual(Ballpark.umpire("R"));
  });
});
