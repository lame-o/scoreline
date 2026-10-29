/**
 * The ballpark theater between balls in play (PlayBeatTests.swift, check by
 * check) against real games: World Series Game 5 as ESPN had it
 * (ws-g5-plays.json), MLB's feed for it (statcast-849799.json, recorded with
 * STATCAST_FIELDS) and its live poll (statcast-live-849799.json,
 * STATCAST_LIVE_FIELDS); and a Brewers–Reds rain delay
 * (statcast-824468-delay.json, the at-bats round it), all copied from the
 * Swift app's Tests/Fixtures. Every pitch shows, in ESPN's order, with MLB's
 * call and flight; what came between pitches shows where it happened;
 * nothing shows twice. And the choreography's facts: a pitch ends at its
 * plate location, two real pitches at their two spots, a throw over to its
 * bag, a steal's throw to the bag he stole, the reliever named is the one who
 * jogs in, the sides change between halves, the idle life starts and ends on
 * the field as it stands.
 */
import { describe, expect, it } from "vitest";
import type { Side } from "../../src/data/models";
import {
  beatPitch,
  beatTag,
  callTag,
  catchUp,
  challengeTags,
  espnDelay,
  mlbBeat,
  mlbDelay,
  standing,
  timeline,
  type BeatPitch,
  type PlayBeat,
} from "../../src/data/mlb/playBeat";
import { BeatBuilder, beatScript, IDLE_BEATS, idleFitting, idleNext, idleScript } from "../../src/data/mlb/playBeatScript";
import { parse } from "../../src/data/mlb/playScene";
import { Actor, PlayScript, restSpot, tarpCover, type Rest } from "../../src/data/mlb/playScript";
import { isAction, isPitchEvent, STATCAST_FIELDS, STATCAST_LIVE_FIELDS, statcastAtBats, statcastLive, type PlayEvent } from "../../src/data/mlb/statcast";
import { Ballpark, type FieldPoint } from "../../src/data/mlb/theaterField";
import { fixture } from "./fixtures";

const g5 = fixture("ws-g5-plays.json") as { items: unknown[]; names: Record<string, string> };
const items = g5.items;
const names = g5.names;
const atBats = statcastAtBats(fixture("statcast-849799.json"));
const line = timeline(items, atBats, names);
const espnOnly = timeline(items, [], names);
const pitches = line.filter((b) => beatPitch(b) != null);
const pitch = (b: PlayBeat): BeatPitch | null => beatPitch(b);
const str = (v: unknown, ...path: string[]) => path.reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], v) as string | undefined;
const num = (v: unknown, ...path: string[]) => path.reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], v) as number | undefined;
const side = (id: string | null | undefined): Side | null => (id === "8" ? "top" : id === "30" ? "bottom" : null);
const field: Rest = { bases: [false, false, false], bats: "R", swapped: false };
const beats = (kind: PlayBeat["kind"]["kind"]) => line.filter((b) => b.kind.kind === kind);

describe("MLB's events", () => {
  const events: PlayEvent[] = atBats.flatMap((a) => [...(a.events ?? [])]);
  const count = (test: (e: PlayEvent) => boolean) => events.filter(test).length;

  it("asks the feed for each event's kind, count and challenge", () => {
    expect(STATCAST_FIELDS).toContain("reviewDetails");
    expect(STATCAST_FIELDS).toContain("eventType");
    expect(STATCAST_FIELDS).toContain("count");
  });

  it("reads Game 5's 70 at-bats: 255 pitches, 9 mound visits, 9 pitching changes, a throw over to first, a step off", () => {
    expect(atBats.length).toBe(70);
    expect(count(isPitchEvent)).toBe(255);
    expect(count((e) => isAction(e, "mound_visit"))).toBe(9);
    expect(count((e) => isAction(e, "pitching_substitution"))).toBe(9);
    expect(count((e) => e.kind.kind === "pickoff" && e.kind.base === 1 && !e.kind.catcher)).toBe(1);
    expect(count((e) => e.kind.kind === "stepOff")).toBe(1);
  });

  it("reads its two ABS challenges, both overturned, each naming who asked", () => {
    const reviewed = events.filter((e) => e.review != null);
    expect(reviewed).toHaveLength(2);
    expect(reviewed.every((e) => e.review?.type === "MJ" && e.review.overturned)).toBe(true);
    expect(reviewed.map((e) => e.review?.challenger).sort()).toEqual(["Liam Hicks", "William Contreras"]);
  });

  it("reads only the at-bat under way from the live poll, the inning and the game's status", () => {
    const live = statcastLive(fixture("statcast-live-849799.json"));
    expect(live.atBat?.index).toBe(69);
    expect(live.status).toBe("Final");
    expect(live.inning).toBe(9);
    expect(live.atBat?.events?.[0]?.kind).toEqual({ kind: "action", type: "mound_visit" });
    expect(STATCAST_LIVE_FIELDS).toContain("currentPlay");
    expect(STATCAST_LIVE_FIELDS).not.toContain("allPlays");
  });
});

describe("Every pitch, in order", () => {
  const espnPitches = items.filter((p) => str(p, "summaryType") === "P" || (str(p, "text") ?? "").startsWith("Pitch"));
  const deciding = espnPitches.filter((p) => {
    const b = num(p, "resultCount", "balls") ?? 0;
    const s = num(p, "resultCount", "strikes") ?? 0;
    const type = (str(p, "type", "type") ?? "").split("---")[0] ?? "";
    return b >= 4 || s >= 3 || !["ball", "strike-looking", "strike-swinging", "foul-ball", "foul-tip", "bunted-foul", "missed-bunt"].includes(type);
  });

  it("makes every pitch that didn't end its at-bat a beat (185 of 255), in ESPN's order", () => {
    const shown = pitches.map((b) => b.id);
    const order = espnPitches.map((p) => str(p, "id")!).filter((id) => shown.includes(id));
    expect(pitches).toHaveLength(185);
    expect(pitches.length).toBe(espnPitches.length - deciding.length);
    expect(shown).toEqual(order);
  });

  it("leaves the pitch that ends an at-bat to its play: never shown twice", () => {
    const shown = new Set(pitches.map((b) => b.id));
    expect(deciding.some((p) => shown.has(str(p, "id")!))).toBe(false);
  });

  it("keeps each of the 84 plays (replayed from its scene) and each of the 18 half-innings' ends", () => {
    expect(line.filter((b) => b.kind.kind === "play")).toHaveLength(84);
    expect(beats("inningBreak")).toHaveLength(18);
  });

  it("gives every pitch its measured flight with MLB's feed; ESPN's alone, none", () => {
    expect(pitches.every((b) => pitch(b)?.flight != null)).toBe(true);
    expect(espnOnly.flatMap((b) => pitch(b) ?? []).every((p) => p.flight == null)).toBe(true);
  });

  it("reads MLB's exact calls: a foul bunt, a ball in the dirt, as well as balls, strikes and fouls", () => {
    const calls = new Set(pitches.map((b) => pitch(b)!.call));
    for (const c of ["ball", "calledStrike", "swingingStrike", "foul", "foulBunt", "ballInDirt"] as const) expect(calls.has(c)).toBe(true);
  });

  it("tags the game's first pitch: Chourio fouls off Rasmussen's four-seamer", () => {
    const first = pitches[0]!;
    const p = pitch(first)!;
    expect(p.call).toBe("foul");
    expect(p.number).toBe(1);
    expect(p.strikes).toBe(1);
    expect(p.code).toBe("FF");
    expect(first.bats).toBe("R");
    expect(first.arm).toBe("R");
    expect(callTag(p, true)).toBe(`FOUL · ${Math.round(p.mph!)} MPH FOUR-SEAM FASTBALL`);
    expect(standing(first)).toBe("TOP 1ST · 0-1 · 0 OUTS");
  });

  it("says the call and its count, the speed and MLB's name (short in a narrow well); a pitch-clock ball", () => {
    const called: BeatPitch = { call: "calledStrike", number: 3, balls: 1, strikes: 2, code: "FF", mph: 97.2, x: null, y: null, flight: null, review: null };
    expect(callTag(called, true)).toBe("STRIKE 2 · 97 MPH FOUR-SEAM FASTBALL");
    expect(callTag(called, false)).toBe("STRIKE 2 · 97 MPH FOUR-SEAM");
    expect(callTag({ ...called, call: "ball", balls: 3, code: "ST", mph: 84 }, true)).toBe("BALL 3 · 84 MPH SWEEPER");
    expect(callTag({ ...called, call: "automaticBall", balls: 1, strikes: 0, code: null, mph: null }, true)).toBe("AUTOMATIC BALL 1 · PITCH CLOCK");
  });
});

describe("What came between", () => {
  const visits = beats("moundVisit");
  const changes = beats("pitchingChange");

  it("places all 9 mound visits and 9 pitching changes", () => {
    expect(visits).toHaveLength(9);
    expect(changes).toHaveLength(9);
  });

  it("makes a visit just before a change the manager's; others the catcher's or the coach's", () => {
    const coached = visits.filter((b) => b.kind.kind === "moundVisit" && b.kind.coach).map((b) => b.id);
    for (const id of ["mlb.35.0", "mlb.42.0", "mlb.45.0", "mlb.54.0"]) expect(coached).toContain(id);
    expect(visits.some((b) => b.kind.kind === "moundVisit" && !b.kind.coach)).toBe(true);
  });

  it("names each change's reliever, in order", () => {
    const relievers = changes.map((b) => (b.kind.kind === "pitchingChange" ? b.kind.reliever : null));
    expect(relievers).toEqual(["Kelly", "Cleavinger", "Wells", "Matz", "Romero", "Uribe", "Baker", "Megill", "Seymour"]);
    expect(changes.some((b) => beatTag(b, true) === "PITCHING CHANGE · ROMERO")).toBe(true);
  });

  it("places Hicks's injury delay, then Romero in, between his pitches", () => {
    const romero = line.findIndex((b) => b.id === "mlb.48.2");
    const delay = line.findIndex((b) => b.id === "mlb.48.1");
    expect(delay).toBeGreaterThanOrEqual(0);
    expect(delay).toBeLessThan(romero);
    const before = line.slice(0, delay).findLast((b) => pitch(b) != null);
    const after = line.slice(romero + 1).find((b) => pitch(b) != null || b.kind.kind === "play");
    expect(pitch(before!)?.number).toBe(1);
    expect(after && (pitch(after)?.number === 2 || after.kind.kind === "play")).toBe(true);
    expect(line[delay]!.kind).toEqual({ kind: "delay", delay: { kind: "injury", hurt: "batter" } });
  });

  it("places Kelly's throw over to first in the 5th, before the first pitch to Mitchell, with a runner on it", () => {
    const pickoffs = beats("pickoff");
    expect(pickoffs).toHaveLength(1);
    const throwOver = pickoffs[0]!;
    expect(throwOver.kind).toEqual({ kind: "pickoff", base: 1, catcher: false });
    expect(beatTag(throwOver, true)).toBe("PICKOFF ATTEMPT · FIRST");
    expect(throwOver.inning).toBe(5);
    expect(throwOver.top).toBe(true);
    expect(throwOver.bases?.[0]).toBe(true);
    const i = line.indexOf(throwOver);
    const next = line.slice(i + 1).find((b) => pitch(b) != null || b.kind.kind === "play");
    expect(next && (pitch(next)?.number === 1 || next.kind.kind === "play")).toBe(true);
  });

  it("tags the four injury delays", () => {
    const injuries = line.filter((b) => b.kind.kind === "delay" && b.kind.delay.kind === "injury");
    expect(injuries).toHaveLength(4);
    expect(injuries.every((b) => beatTag(b, true) === "INJURY DELAY")).toBe(true);
    expect(injuries[0]!.kind).toEqual({ kind: "delay", delay: { kind: "injury", hurt: "batter" } });
  });

  it("says a pinch hitter steps in", () => {
    const pinch = line.filter((b) => b.kind.kind === "batterUp" && b.kind.pinch).map((b) => beatTag(b, true));
    expect(pinch).toEqual(["PINCH HITTER · PALACIOS", "PINCH HITTER · MESA JR"]);
  });

  it("says who takes the field", () => {
    expect(beats("substitution").map((b) => beatTag(b, true))).toEqual(["DEFENSIVE SWITCH · PALACIOS · 2B", "DEFENSIVE SWITCH · MESA JR. · RF"]);
  });

  it("leaves a steal to ESPN's play (replayed from its scene), never MLB's action as well", () => {
    const steals = atBats.flatMap((a) => (a.events ?? []).filter((e) => isAction(e, "stolen_base_2b")).map((e) => `mlb.${a.index}.${e.index}`));
    expect(steals).toHaveLength(1);
    expect(line.some((b) => steals.includes(b.id))).toBe(false);
    expect(line.some((b) => b.kind.kind === "play" && (str(items.find((i) => str(i, "id") === b.id), "text") ?? "").includes("stole"))).toBe(true);
  });

  it("tells an ABS challenge: the call as made, who asked, then how it came out", () => {
    const challenged = pitches.filter((b) => pitch(b)?.review != null);
    expect(challenged).toHaveLength(2);
    const p = pitch(challenged[0]!)!;
    expect(p.call).toBe("calledStrike");
    expect(callTag(p, true, true).startsWith("BALL ")).toBe(true);
    expect(challengeTags(p)).toEqual({ asked: "ABS CHALLENGE · CONTRERAS", result: `OVERTURNED · STRIKE ${p.strikes}` });
  });

  it("says the end of a half, and it stands until play resumes", () => {
    const breaks = beats("inningBreak");
    expect(beatTag(breaks[0]!, true)).toBe("MIDDLE 1ST");
    expect(beatTag(breaks[1]!, true)).toBe("END 1ST");
    expect(standing(breaks[0]!)).toBe("MIDDLE 1ST");
  });

  it("reads a rain delay as MLB posts it (and its live status, and ESPN's)", () => {
    const rain = statcastAtBats(fixture("statcast-824468-delay.json"));
    const rainBeats = rain.flatMap((a) => (a.events ?? []).flatMap((e) => mlbBeat(e, a) ?? [])).filter((b) => b.kind.kind === "delay");
    expect(rainBeats.map((b) => b.kind)).toEqual([
      { kind: "delay", delay: { kind: "weather", why: "Rain" } },
      { kind: "delay", delay: { kind: "over" } },
    ]);
    expect(rainBeats.map((b) => beatTag(b, true))).toEqual(["RAIN DELAY", "PLAY RESUMES"]);
    expect(mlbDelay("Delayed: Rain")).toEqual({ kind: "weather", why: "Rain" });
    expect(espnDelay({ type: { name: "STATUS_RAIN_DELAY", detail: "Rain Delay" } })).toEqual({ kind: "weather", why: "Rain" });
    expect(espnDelay({ type: { name: "STATUS_IN_PROGRESS", detail: "Top 4th" } })).toBeNull();
  });
});

describe("The pitch", () => {
  /** Where the ball crosses the front of the plate in a pitch's script. */
  function crossing(s: PlayScript): FieldPoint | null {
    const f = s.flights[0];
    if (!f) return null;
    let t = f.start;
    let last = f.point(t);
    while (t < f.end) {
      t += 0.0005;
      const p = f.point(t);
      if (p.y <= 17 / 12) return last.y - p.y > 0 ? p : last;
      last = p;
    }
    return null;
  }
  // (A pitch that bounced in front of the plate ends in the dirt there.)
  const measured = pitches.filter((b) => {
    const p = pitch(b)!;
    return (p.call === "calledStrike" || p.call === "ball") && (p.flight?.plate[1] ?? 0) > 0.3;
  });

  it("crosses the plate exactly where MLB measured every taken pitch, and its zone marks the spot", () => {
    let worst = 0;
    for (const b of measured) {
      const p = pitch(b)!;
      const s = beatScript(b, field);
      const x = crossing(s)!;
      worst = Math.max(worst, Math.abs(x.x - p.flight!.plate[0]), Math.abs(x.z - p.flight!.plate[1]));
      expect(s.zone?.crossing.x).toBeCloseTo(p.flight!.plate[0], 2);
      expect(s.zone?.crossing.y).toBeCloseTo(p.flight!.plate[1], 2);
    }
    expect(measured.length).toBeGreaterThan(100);
    expect(worst).toBeLessThan(0.06);
  });

  it("ends two real pitches at two different spots, each its own", () => {
    const sorted = [...measured].sort((a, b) => pitch(a)!.flight!.plate[0] - pitch(b)!.flight!.plate[0]);
    const inside = sorted[0]!;
    const away = sorted[sorted.length - 1]!;
    const a = crossing(beatScript(inside, field))!;
    const b = crossing(beatScript(away, field))!;
    expect(Math.abs(a.x - b.x)).toBeGreaterThan(2);
    expect(Math.abs(a.x - pitch(inside)!.flight!.plate[0])).toBeLessThan(0.06);
    expect(Math.abs(b.x - pitch(away)!.flight!.plate[0])).toBeLessThan(0.06);
  });

  it("ends a pitch at ESPN's plate location without MLB's flight", () => {
    const b = espnOnly.find((x) => pitch(x)?.call === "calledStrike")!;
    const p = pitch(b)!;
    const x = crossing(beatScript(b, field))!;
    const want = BeatBuilder.plateLocation(p, 0n);
    expect(p.x).not.toBeNull();
    expect(Math.abs(x.x - want.x)).toBeLessThan(0.06);
    expect(Math.abs(x.z - want.y)).toBeLessThan(0.06);
  });

  it("shapes a pitch like its type: a righty's sinker runs to his arm side and sinks, his sweeper sweeps (a lefty's mirrored)", () => {
    const base: BeatPitch = { call: "ball", number: 1, balls: 1, strikes: 0, code: "SI", mph: 95, x: null, y: null, flight: null, review: null };
    const sinker = BeatBuilder.shaped(base, "R", 1n);
    const sweeper = BeatBuilder.shaped({ ...base, code: "ST", mph: 84 }, "R", 1n);
    const lefty = BeatBuilder.shaped({ ...base, code: "ST", mph: 84 }, "L", 1n);
    const four = BeatBuilder.shaped({ ...base, code: "FF" }, "R", 1n);
    expect(sinker.acceleration[0]).toBeLessThan(0);
    expect(sweeper.acceleration[0]).toBeGreaterThan(0);
    expect(lefty.acceleration[0]).toBeLessThan(0);
    expect(sinker.release[0]).toBeLessThan(0);
    expect(lefty.release[0]).toBeGreaterThan(0);
    expect(sinker.acceleration[2]).toBeLessThan(four.acceleration[2]);
  });

  it("reads his arm slot from where the ball left his hand", () => {
    const p = (x: number, z: number) => ({ release: [x, 50, z] as [number, number, number], velocity: [0, -140, 0] as [number, number, number], acceleration: [0, 30, -20] as [number, number, number], plate: [0, 2.5] as [number, number], zone: null, mph: 95, spin: null, type: "FF" });
    expect(BeatBuilder.slot(p(-0.2, 6.6))).toBeGreaterThan(0.9);
    expect(BeatBuilder.slot(p(-3.4, 5.0))).toBeLessThan(0.15);
  });

  const batter = (s: PlayScript) => s.actors.find((a) => a.role.kind === "batter");

  it("swings through a swinging strike and takes a called one", () => {
    expect(pitches.filter((b) => pitch(b)?.call === "swingingStrike").every((b) => batter(beatScript(b, field))?.swing != null)).toBe(true);
    expect(
      pitches
        .filter((b) => pitch(b)?.call === "calledStrike")
        .every((b) => {
          const a = batter(beatScript(b, field));
          return a?.swing == null && a?.check == null;
        }),
    ).toBe(true);
  });

  it("hits every foul (contact) foul: back, or over a line; every way, and the same way every time", () => {
    const fouls = pitches.filter((b) => pitch(b)?.call === "foul");
    const scripts = fouls.map((b) => beatScript(b, field));
    const away = scripts.map((s) => s.flights[s.watch!]!.to);
    expect(away.every((p) => p.y < 0 || Math.abs(p.x) > p.y)).toBe(true);
    expect(scripts.every((s) => s.flashes.some((f) => f.beat === "contact") && batter(s)?.swing != null)).toBe(true);
    const ways = new Set(away.map((p) => (p.y < 0 ? "back" : p.x < 0 ? "left" : "right")));
    expect(ways.size).toBe(3);
    expect(beatScript(fouls[0]!, field).flights[1]!.to).toEqual(scripts[0]!.flights[1]!.to);
  });

  it("checks a swing only ever on a ball, with two strikes", () => {
    const checked = pitches.find((b) => batter(beatScript(b, field))?.check != null);
    if (checked) {
      expect(pitch(checked)?.call).toBe("ball");
      expect(pitch(checked)?.strikes).toBe(2);
    }
  });

  it("blocks a ball in the dirt, picks it up, and throws it back", () => {
    const dirt = pitches.find((b) => pitch(b)?.call === "ballInDirt")!;
    const s = beatScript(dirt, field);
    expect(s.actors[1]!.actions.filter((a) => a.kind === "scoop")).toHaveLength(2);
    expect(s.flights.length).toBeGreaterThanOrEqual(3);
  });

  it("sends a taken pitch back to the mound, its call as it pops, under 3.2 s, each runner off and back", () => {
    const taken = pitches.find((b) => pitch(b)?.call === "calledStrike")!;
    const s = beatScript(taken, { bases: [true, false, true], bats: "L", swapped: false });
    const back = s.flights[s.flights.length - 1]!;
    expect(Math.abs(back.to.x - Ballpark.position(1).x)).toBeLessThan(1);
    expect(Math.abs(back.to.y - Ballpark.position(1).y)).toBeLessThan(2);
    expect(s.captions[0]?.line).toEqual({ kind: "call", asCalled: false });
    expect(s.duration).toBeLessThan(3.2);
    const runners = s.actors.filter((a) => a.role.kind === "runner");
    expect(runners.every((r) => r.moves.length === 2 && r.position(s.duration).x === r.at.x && r.position(s.duration).y === r.at.y)).toBe(true);
  });
});

describe("Throws and changes", () => {
  it("throws over from the pitcher to the first baseman at the bag; the runner dives back and takes his lead again", () => {
    const s = beatScript(beats("pickoff")[0]!, { bases: [true, false, false], bats: "L", swapped: false });
    const throwing = s.flights[0]!;
    expect(Math.hypot(throwing.to.x - Ballpark.bag(1).x, throwing.to.y - Ballpark.bag(1).y)).toBeLessThan(0.5);
    expect(s.actors[0]!.actions.some((a) => a.kind === "throwBall")).toBe(true);
    expect(s.actors[2]!.actions.some((a) => a.kind === "glove")).toBe(true);
    const runner = s.actors.find((a) => a.role.kind === "runner")!;
    expect(runner.diveBack).not.toBeNull();
    expect(runner.position(s.duration)).toEqual(Ballpark.lead(1));
  });

  it("throws to second on Turang's steal: he breaks for second, the catcher throws there", () => {
    const i = items.findIndex((p) => str(p, "type", "type") === "play-result" && (str(p, "text") ?? "").includes("stole second"));
    const steal = parse(items, i, side, names)!;
    const s = PlayScript.play(steal, { bases: steal.basesAfter, bats: "R", swapped: false });
    expect(steal.kind.type).toBe("stolenBase");
    expect(s.flights.slice(1).some((f) => Math.hypot(f.to.x - Ballpark.bag(2).x, f.to.y - Ballpark.bag(2).y) < 1)).toBe(true);
    expect(s.actors[1]!.actions.some((a) => a.kind === "throwBall")).toBe(true);
    const second = Ballpark.base(2);
    expect(s.actors.some((a) => a.role.kind === "runner" && a.moves.some((m) => m.path[m.path.length - 1]!.x === second.x && m.path[m.path.length - 1]!.y === second.y))).toBe(true);
  });

  it("brings Romero in from his team's bullpen to the rubber; the manager walks out, the pitcher off to his dugout", () => {
    const romero = beats("pitchingChange").find((b) => beatTag(b, true) === "PITCHING CHANGE · ROMERO")!;
    const rest: Rest = { bases: [false, false, false], bats: "R", swapped: false, fieldingHome: false };
    const s = beatScript(romero, rest);
    const reliever = s.actors.slice(9).find((a) => a.role.kind === "fielder" && a.role.n === 1)!;
    const manager = s.actors.find((a) => a.role.kind === "coach")!;
    expect(reliever.position(s.duration)).toEqual(restSpot(rest, 1));
    expect(reliever.at.x).toBeLessThan(0);
    expect(reliever.team).toBe("fielding");
    expect(s.actors[0]!.vanish).toBeLessThan(s.duration);
    expect(s.actors[0]!.moves.at(-1)!.path.at(-1)).toEqual(Ballpark.dugout(false));
    expect(manager.position(1.8).y).toBeGreaterThan(45);
    expect(manager.vanish).toBeLessThan(s.duration);
  });

  it("sends the catcher out to the mound on a visit and back behind the plate", () => {
    const visit = beats("moundVisit").find((b) => b.kind.kind === "moundVisit" && !b.kind.coach)!;
    const s = beatScript(visit, field);
    expect(s.actors[1]!.position(2.5).y).toBeGreaterThan(45);
    expect(s.actors[1]!.position(s.duration)).toEqual(restSpot(field, 2));
  });

  it("changes sides after the third out: one team jogs off to its dugout, the other comes out of theirs", () => {
    const i = items.findIndex((p) => str(p, "type", "type") === "play-result" && num(p, "outs") === 3 && str(p, "period", "type") === "Top");
    const third = parse(items, i, side, names)!;
    const rest: Rest = { bases: [false, false, false], bats: null, swapped: true, fieldingHome: false };
    const s = PlayScript.play(third, rest);
    const leaving = Ballpark.dugout(true);
    const coming = Ballpark.dugout(false);
    const toward = (a: Actor, p: { x: number; y: number }, t: number) => {
      const then = a.position(s.settle);
      const now = a.position(t);
      return Math.hypot(now.x - p.x, now.y - p.y) < Math.hypot(then.x - p.x, then.y - p.y) - 1;
    };
    const old = s.actors.slice(0, 9);
    const fresh = s.actors.filter((a) => a.team === "batting" && a.role.kind === "fielder");
    expect(old.every((a) => a.vanish < s.duration && toward(a, leaving, a.vanish))).toBe(true);
    expect(fresh).toHaveLength(9);
    for (const a of fresh) {
      if (a.role.kind !== "fielder") continue;
      const spot = restSpot(rest, a.role.n);
      expect(a.position(s.duration)).toEqual(spot);
      expect(Math.hypot(a.at.x - coming.x, a.at.y - coming.y)).toBeLessThan(Math.hypot(spot.x - coming.x, spot.y - coming.y));
    }
  });

  it("warms the team out there up between halves, nobody batting", () => {
    const middle = beats("inningBreak")[0]!;
    const warm = beatScript(middle, { bases: [false, false, false], bats: null, swapped: false, fieldingHome: false });
    expect(warm.release).not.toBeNull();
    expect(warm.flights.some((f) => f.fresh)).toBe(true);
    expect(warm.actors).toHaveLength(10);
  });

  it("clears the field and rolls the tarp out for a rain delay; it stays out while the delay stands", () => {
    const rain = statcastAtBats(fixture("statcast-824468-delay.json"));
    const weather = rain.flatMap((a) => (a.events ?? []).flatMap((e) => mlbBeat(e, a) ?? [])).find((b) => b.kind.kind === "delay")!;
    const s = beatScript(weather, field);
    expect(s.tarp?.out).toBe(true);
    expect(s.actors.every((a) => a.vanish < s.duration)).toBe(true);
    const tarp = PlayScript.rest({ ...field, standing: { kind: "tarp" } }).tarp!;
    expect(tarpCover(tarp, Infinity)).toBe(1);
  });
});

describe("The idle life", () => {
  const between: Rest = { bases: [false, false, false], bats: null, swapped: false };
  const busy: Rest = { bases: [true, false, true], bats: "L", swapped: false };

  it("makes a move every 4.5–8 s, never the same twice running, the same every time", () => {
    const picks = Array.from({ length: 40 }, (_, n) => idleNext(n, busy, false, 7n)!);
    expect(picks.every((p, i) => i === 0 || p.beat !== picks[i - 1]!.beat)).toBe(true);
    expect(picks.every((p) => p.wait >= 4.5 && p.wait <= 8)).toBe(true);
    expect(new Set(picks.map((p) => p.beat)).size).toBeGreaterThanOrEqual(4);
    expect(Array.from({ length: 40 }, (_, n) => idleNext(n, busy, false, 7n)!.beat)).toEqual(picks.map((p) => p.beat));
  });

  it("only makes moves that fit: warm-ups between halves, a lead off with a runner on, nothing under the tarp", () => {
    expect(idleFitting(between, true).every((k) => ["warmup", "infield", "outfield", "weight", "brush"].includes(k))).toBe(true);
    expect(idleFitting(field, false)).not.toContain("lead");
    expect(idleFitting(busy, false)).toContain("lead");
    expect(idleNext(0, { ...field, standing: { kind: "tarp" } }, false, 1n)).toBeNull();
  });

  it("keeps each move short, starting and ending on the field as it stands", () => {
    const still = PlayScript.rest(busy);
    const moves = IDLE_BEATS.filter((k) => k !== "trainer").map((k) => idleScript(k, ["warmup", "infield", "outfield", "brush"].includes(k) ? between : busy, 3n));
    for (const m of moves) {
      expect(m.duration).toBeLessThanOrEqual(3);
      for (const a of m.actors) {
        expect(a.position(0)).toEqual(a.at);
        expect(a.position(m.duration)).toEqual(a.at);
      }
    }
    expect(moves[0]!.actors).toHaveLength(still.actors.length);
  });
});

describe("The queue", () => {
  const p = (id: string): PlayBeat => ({ id, kind: { kind: "pitch", pitch: { call: "ball", number: 1, balls: 1, strikes: 0, code: null, mph: null, x: null, y: null, flight: null, review: null } }, bats: null, arm: null, inning: null, top: null, balls: 0, strikes: 0, outs: 0, wallclock: null, bases: null, news: true });
  const backlog = [...Array.from({ length: 9 }, (_, i) => p(`p${i + 1}`)), { ...p("visit"), kind: { kind: "moundVisit", coach: false } } as PlayBeat];

  it("plays a backlog's last few pitches, and everything else", () => {
    expect(catchUp(backlog).map((b) => b.id)).toEqual(["p6", "p7", "p8", "p9", "visit"]);
    expect(catchUp(backlog.slice(0, 4))).toHaveLength(4);
  });

  it("puts a waiting play first (a scoring slide keeps time with its replay), what came after it after", () => {
    const withPlay = [...backlog.slice(0, 3), { ...p("play"), kind: { kind: "play" } } as PlayBeat, backlog[3]!];
    expect(catchUp(withPlay).map((b) => b.id)).toEqual(["play", "p4"]);
  });
});
