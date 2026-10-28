/**
 * The play theater against what the live feeds really do (PlayLiveTests.swift,
 * check by check, on World Series Game 4 watched live: ws-g4-plays.json as
 * ESPN finally had it, ws-g4-rewrites.json as it first posted what it later
 * rewrote, and MLB's feed, statcast-849803.json, all trimmed from the Swift
 * app's Tests/Fixtures): MLB names an at-bat's event mid-at-bat ("Mound
 * Visit") and posts a ball's hitData seconds after its result; ESPN rewrites
 * results behind the tail and replaces a challenged pitch with a new ID; and
 * the plays ESPN's text alone got wrong, in scorer's notation.
 */
import { describe, expect, it } from "vitest";
import { currentAtBat } from "../../src/data/gameDetail";
import { rereadStart, reread, rewritten } from "../../src/data/liveFeeds/baseball";
import type { Side } from "../../src/data/models";
import { parse, theater, type PlayScene } from "../../src/data/mlb/playScene";
import { PlayScript } from "../../src/data/mlb/playScript";
import { atBatOver, STATCAST_FIELDS, statcastAtBats, type StatcastAtBat } from "../../src/data/mlb/statcast";
import { Ballpark, ground } from "../../src/data/mlb/theaterField";
import { fixture } from "./fixtures";
import { ends } from "./playHelpers";

const g4 = fixture("ws-g4-plays.json") as { items: unknown[]; names: Record<string, string> };
const plays = g4.items;
const names = g4.names;
// (The lane's and the parser's side functions differ only in taking a null.)
const side = (id: string | null | undefined): Side | null => (id === "8" ? "top" : id === "30" ? "bottom" : null);
const atBats = statcastAtBats(fixture("statcast-849803.json"));
const rewrites = (fixture("ws-g4-rewrites.json") as { early: unknown[] }).early;
const idOf = (p: unknown) => (p as { id?: string }).id;
const typeOf = (p: unknown) => (p as { type?: { type?: string } }).type?.type;
const atBatIdOf = (p: unknown) => (p as { atBatId?: string }).atBatId;

function scene(id: string, measured = false): PlayScene | null {
  const i = plays.findIndex((p) => idOf(p) === id);
  const s = i < 0 ? null : parse(plays, i, side, names);
  if (s && measured) s.measured = s.measurement(atBats) ?? s.runnerMeasurement(atBats);
  return s;
}
const script = (s: PlayScene) => PlayScript.play(s, { bases: s.endsInning ? [false, false, false] : s.basesAfter, bats: "R", swapped: s.endsInning });
const at = (id: string) => plays.findIndex((p) => idOf(p) === id);
const early = new Map<string, unknown>();
for (const e of rewrites) if (idOf(e) != null && !early.has(idOf(e)!)) early.set(idOf(e)!, e);
const results = plays.flatMap((p, i) => (typeOf(p) === "play-result" ? (parse(plays, i, side, names) ?? []) : []));

describe("Statcast: over means over", () => {
  it("the feed's fields ask whether each at-bat is over (all 92 of Game 4's are, now)", () => {
    expect(STATCAST_FIELDS.split(",")).toContain("isComplete");
    expect(atBats.length).toBe(92);
    expect(atBats.every((a) => a.complete)).toBe(true);
  });
  it("an at-bat MLB has named for a mound visit isn't over; nor a groundout before its hitData has posted: asked again until it's there", () => {
    // Turang's groundout in the 8th, as the live poll caught it: MLB had named it "Mound Visit", not over.
    const turang = scene("4019080451403990057")!;
    const real = turang.atBat(atBats)!;
    const visit: StatcastAtBat = { ...real, event: "Mound Visit", batted: null, complete: false, runners: [], closing: null, inPlay: false };
    expect(turang.measurement([visit])).toBeNull();
    expect(atBatOver(visit)).toBe(false);
    const noHit: StatcastAtBat = { ...real, batted: null, complete: true, runners: [], closing: null, inPlay: true };
    expect(turang.measurement([noHit])).toBeNull();
    expect(atBatOver(noHit)).toBe(false);
    expect(turang.measurement(atBats)?.batted).not.toBeNull();
    expect(atBatOver(real)).toBe(true);
  });
  it("a walk has nothing to wait for: found once it's over", () => {
    const walks = results.filter((s) => s.kind.type === "walk");
    expect(walks.length).toBeGreaterThan(0);
    expect(walks.every((s) => s.measurement(atBats) != null && s.measurement(atBats)?.batted == null)).toBe(true);
  });
});

describe("ESPN's rewrites", () => {
  it("each look reads again from the previous at-bat's first entry, and finds the result ESPN rewrote, the entry it dropped, and the new ones", () => {
    // DeLuca's fielder's choice, first posted as a walk ("Official Scorer Ruling Pending") and rewritten two minutes later.
    const fc = at("4019080450703990057");
    const before = plays.slice(0, fc + 1);
    before[fc] = early.get("4019080450703990057") ?? before[fc];
    const out = early.get("4019080450703030072");
    if (out) before.splice(fc, 0, out);
    const window = before.slice(-80);
    const start = before.length - window.length;
    const from = rereadStart(window)!;
    expect(from).not.toBeNull();
    expect(atBatIdOf(window[from])).toBe("4019080450702");
    expect(window.slice(from).every((e) => ["4019080450702", "4019080450703"].includes(atBatIdOf(e) ?? ""))).toBe(true);
    const fresh = plays.slice(start + from, fc + 4);
    const look = reread(window, from, fresh);
    expect(look.revised.map((r) => idOf(r.new))).toEqual(["4019080450703990057"]);
    expect(look.gone).toEqual(["4019080450703030072"]);
    expect(look.new.length).toBe(3);
    expect(look.window.length).toBe(from + fresh.length);
    // …so the theater's walk becomes the fielder's choice it was (the same play, the scorer's ruling in).
    const was = theater(window, side, names).play;
    const now = theater(look.window.slice(0, fc - start + 1), side, names).play;
    expect(was?.kind.type).toBe("walk");
    expect(now?.kind.type).toBe("fieldersChoice");
    expect(now?.id).toBe(was?.id);
  });
  it("a steal rewritten as caught stealing replays as CS 2-4 once read again", () => {
    const cs = at("4019080451604030298");
    const stale = plays.slice(0, cs + 1);
    stale[cs] = early.get("4019080451604030298") ?? stale[cs];
    const staleScene = theater(stale.slice(-80), side, names).play;
    const fixed = theater(plays.slice(0, cs + 1).slice(-80), side, names).play;
    expect(staleScene?.kind.type).toBe("stolenBase");
    expect(fixed?.kind.type).toBe("caughtStealing");
    expect(fixed?.notation.code).toBe("CS 2-4");
  });
  it("a pitch replaced by a new ID: the old one's gone, the new one counts, This At-Bat as ESPN has it now", () => {
    // A challenged pitch replaced in place with a new ID (ball, confirmed → strike, overturned).
    const challenged = at("4019080450605030091");
    const pitched = plays.slice(0, challenged + 3);
    pitched[challenged] = early.get("4019080450605030090") ?? pitched[challenged];
    const pitchWindow = pitched.slice(-80);
    const from = rereadStart(pitchWindow)!;
    const offset = pitched.length - pitchWindow.length;
    const look = reread(pitchWindow, from, plays.slice(offset + from, challenged + 3));
    expect(look.gone).toEqual(["4019080450605030090"]);
    expect(look.new.map(idOf)).toEqual(["4019080450605030091"]);
    expect(look.window.some((e) => idOf(e) === "4019080450605030090")).toBe(false);
    expect(currentAtBat(look.window).length).toBe(currentAtBat(plays.slice(0, challenged + 3).slice(-80)).length);
  });
  it("moments: a rewrite into something bigger is news again; into something else, the old one's taken back", () => {
    // The run that scored on the pending ruling still scores: its moment stands.
    const fc = at("4019080450703990057");
    const scored = rewritten(early.get("4019080450703990057")!, plays[fc], side);
    expect(scored.offer?.kind).toBe("runScored");
    expect(scored.retract).toBe(false);
    const single = { id: "r", type: { type: "play-result" }, alternativeType: { type: "single" }, text: "Díaz singled to left.", team: { id: "30" } };
    const out = { id: "r", type: { type: "play-result" }, alternativeType: { type: "ground-out" }, text: "Díaz grounded out to third.", team: { id: "30" } };
    const taken = rewritten(single, out, side);
    const raised = rewritten(out, single, side);
    expect(taken.retract).toBe(true);
    expect(taken.offer?.kind).toBe("outInPlay");
    expect(raised.retract).toBe(true);
    expect(raised.offer?.kind).toBe("hit");
  });
});

describe("what ESPN's text alone got wrong", () => {
  it("a steal and the catcher's throwing error: 1→3 (\"safe at third\"), marked SB E2", () => {
    const steal = scene("4019080450004040298")!;
    expect(ends(steal.runners)).toBe("1→3");
    expect(steal.notation.code).toBe("SB E2");
  });
  it("a pickoff caught stealing: no pitch, the pitcher's throw (not the catcher's), titled \"Picked off\"", () => {
    const s = scene("4019080450705040298")!;
    const sc = script(s);
    expect(s.title).toBe("Picked off");
    expect(sc.release).toBeNull();
    expect(sc.actors[0]!.actions.some((a) => a.kind === "throwBall")).toBe(true);
    expect(sc.actors[1]!.actions.some((a) => a.kind === "throwBall")).toBe(false);
  });
  it("a liner into a double play: the batter out on the catch, the runner doubled off first; L4-3 DP", () => {
    const lined = scene("4019080451102990057")!;
    expect(ends(lined.runners)).toBe("B×c 1×1");
    expect(lined.notation.code).toBe("L4-3 DP");
  });
  it("a grounder to second spotted at the plate (an upstream glitch): fielded where the second baseman plays", () => {
    // "DeLuca grounded out to second", as ESPN and MLB first placed it: at the plate.
    const s = scene("4019080451302990057")!;
    s.spot = { x: 126, y: 204 };
    const sc = script(s);
    const to = ground(sc.flights[sc.batted!]!.to);
    const second = Ballpark.position(4);
    expect(Math.hypot(to.x - second.x, to.y - second.y)).toBeLessThan(20);
    expect(sc.actors[3]!.actions.some((a) => a.kind === "scoop")).toBe(true);
  });
  it("the walk-off single in the 12th: WALK-OFF as Fortes crosses", () => {
    const s = scene("4019080452305990057", true)!;
    const sc = script(s);
    const run = sc.flashes.find((f) => f.beat === "run")!;
    expect(s.walkOff).toBe(true);
    expect(sc.banner?.text).toBe("WALK-OFF");
    expect(Math.abs((sc.banner?.at ?? 0) - run.at)).toBeLessThan(0.001);
    expect(s.measured?.movements.length).toBeGreaterThan(0);
  });
});

describe("scorer's notation", () => {
  it("every Game 4 mark is scorer's notation (6-3, 4-6-3 DP, L4-3 DP, 3U, F8, K, SB, CS 2-4, FC 6-4, HR…)", () => {
    const pattern =
      /^(1B|2B|3B)( E[1-9])?$|^HR$|^K( 2-3)?$|^BB$|^IBB$|^HBP$|^SB( E[1-9])?$|^(CS|PO)( [1-9](-[1-9])*)?$|^WP$|^PB$|^BK$|^DI$|^[1-9](-[1-9])+$|^[1-9]U$|^[FLP][1-9]$|^FC( [1-9](-[1-9])*)?$|^[LFP]?[1-9](-[1-9])* (DP|TP)$|^SF[1-9]$|^SAC( [1-9](-[1-9])*)?$|^E[1-9]$/;
    const marks = results.map((s) => s.notation.code);
    expect(marks.length).toBeGreaterThan(0);
    expect(marks.filter((m) => !pattern.test(m))).toEqual([]);
  });
});
