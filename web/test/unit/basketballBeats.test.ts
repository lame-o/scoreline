/**
 * The basketball theater's lighter beats and the court between plays
 * (BasketballBeatsTests.swift), check by check, on the same whole recorded
 * game: SA at UTA in overtime, 2026-10-28 (test/fixtures/nba-every-play-
 * 401909890.json, copied from the Swift app's Tests/Fixtures: all 515 core
 * plays ESPN sent, substitutions, timeouts, reviews and period ends
 * included, normalized as the live lane keeps them, each participant's part
 * and position kept). Every play parsed into what the theater tells (the
 * call, the free throw's place in its trip, who came in, who jumped), told
 * in order and kept up with the game, the choreography's facts (a free throw
 * drops through the rim from the line, a miss comes off the rim from ESPN's
 * spot to the man credited with the board, the ball changes hands on a
 * defensive board), the ends of the court (swapped at halftime, turned by
 * the viewer), the tags, and the court between plays resting sparsely. And
 * parity: the same play draws the same dice as on the Mac.
 */
import { describe, expect, it } from "vitest";
import { normalized, type Teams } from "../../src/data/liveFeeds/basketball";
import type { Point } from "../../src/data/mlb/theaterField";
import type { Side } from "../../src/data/models";
import { beatScript, beatSide, benchRight, carom, endsRight, hoopsEnds, REST_LENGTH, restOf, restScript, seenBy, stoppageWords, type HoopsEnds, type Lineup } from "../../src/data/theater/basketballBeats";
import { basketballNext, restAfter, reviewWords, statusBetween, statusDuring, type BasketballUnit } from "../../src/data/theater/basketballFlow";
import { afterSide, ballSide, basketballRecent, made, parseScene, replays, sameCall, type BasketballScene, type Call, type CallKind, type Miss } from "../../src/data/theater/basketballScene";
import { BasketballScript, basketballStamp, Hoops, view } from "../../src/data/theater/basketballScript";
import { playerPose } from "../../src/features/game/nba/theater/drawBasketball";
import { theaterFlipKey } from "../../src/features/game/core/theater/TheaterStatus";
import { fixture } from "./fixtures";
import { jointsBreak } from "./rigJoints";

type Item = Record<string, unknown>;
const game = (fixture("nba-every-play-401909890.json") as { games: { items: Item[]; home: { id: string }; away: { id: string } }[] }).games[0]!;
const items = game.items;
// The Spurs (visitors) on top, as ESPN lists them.
const teams: Teams = { topIsHome: false, topID: game.away.id, bottomID: game.home.id, topName: "Spurs", bottomName: "Jazz" };
const scenes = items.flatMap((_, i) => parseScene(items, i, teams) ?? []);
const scene = (id: string) => scenes.find((s) => s.id === id) ?? null;
const count = (kind: BasketballScene["kind"]) => scenes.filter((s) => s.kind === kind).length;
const calls = (kind: Exclude<CallKind, "other">) => scenes.filter((s) => sameCall(s.call, { kind } as Call)).length;
const flat: HoopsEnds = { topRight: true, topOpensRight: true };
const names = { top: "Spurs", bottom: "Jazz" };
const fga = scenes.filter((s) => s.shot != null && s.kind !== "freeThrow");
const RIM = { x: Hoops.rim.x, y: Hoops.rim.y, z: Hoops.rimHeight };
const gap = (a: { x: number; y: number; z: number } | null, b: { x: number; y: number; z: number }) => (a ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : Infinity);
const fromRim = (p: Point) => Math.hypot(p.x - Hoops.rim.x, p.y - Hoops.rim.y);
const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / Math.max(x.length, 1);
const caughtAt = (s: BasketballScript): Point | null => {
  const c = s.carrier(s.settle);
  return c ? s.players[c.player]!.position(s.settle) : null;
};
/** A scene's shot as the miss its board comes off. */
const missOfScene = (s: BasketballScene): Miss => ({
  spot: s.spot ?? { x: 25, y: 15 },
  shooter: s.shooter,
  value: s.value,
  close: ["layup", "dunk", "alleyOop", "putback"].includes(s.shot ?? s.kind),
  id: s.id,
  blocked: s.result === "blocked",
  freeThrow: s.kind === "freeThrow",
  distance: s.kind === "freeThrow" ? 14 : s.distance,
});

const foul = scene("40190989028")!;
const charge = scene("401909890252")!;
const kick = scene("401909890318")!;
const travel = scene("401909890374")!;
const pick = scene("4019098908")!;
const oob = scene("401909890447")!;
const tip = scene("4019098904")!;
const sub = scene("40190989063")!;
const ft1 = scene("40190989030")!;
const ft3 = scene("401909890531")!;
const miss = scene("40190989035")!;
const board = scene("40190989036")!;

describe("every play, parsed", () => {
  it("every one of the game's 515 plays is something the theater tells", () => {
    expect(scenes.length).toBe(items.length);
    expect(items.length).toBe(515);
  });

  it("rebounds both ways, substitutions, timeouts, the ends of periods, challenges, jump balls, free throws: ESPN's counts", () => {
    expect([count("defensiveRebound"), count("offensiveRebound"), count("substitution"), count("timeout"), count("periodEnd"), count("challenge"), count("jumpBall"), count("freeThrow")]).toEqual([84, 33, 70, 13, 6, 3, 2, 40]);
  });

  it("each whistle by its call: shooting, personal, loose ball, offensive (the foul and its turnover), charge, kicked ball, goaltending", () => {
    expect([calls("shooting"), calls("personal"), calls("looseBall"), calls("offensive"), calls("charge"), calls("kickedBall"), calls("goaltending")]).toEqual([19, 13, 1, 4, 2, 2, 1]);
  });

  it("each turnover by its kind: picked off, poked loose, out of bounds, a travel, offensive goaltending, a double dribble", () => {
    expect([count("steal"), calls("badPass"), calls("lostBall"), calls("outOfBounds"), calls("traveling"), calls("offensiveGoaltending")]).toEqual([17, 10, 7, 6, 2, 1]);
    expect(scenes.some((s) => sameCall(s.call, { kind: "other", words: "DOUBLE DRIBBLE" }))).toBe(true);
  });

  it("195 field goal attempts: 83 makes and 10 blocks replay in full, the 102 misses as beats", () => {
    expect(fga.length).toBe(195);
    expect(fga.filter(made).length).toBe(83);
    expect(fga.filter((s) => s.kind === "block").length).toBe(10);
  });

  it("Wembanyama's shooting foul at ESPN's spot: on Peterson, two shots, the Jazz's ball", () => {
    expect(foul.kind).toBe("foul");
    expect(foul.call?.kind).toBe("shooting");
    expect(foul.shooter?.name).toBe("Wembanyama");
    expect(foul.drew?.name).toBe("Peterson");
    expect(foul.trip).toBe(2);
    expect(ballSide(foul)).toBe("bottom");
    expect(foul.spot).toEqual({ x: 25, y: 12 });
  });

  it("Keldon Johnson's charge: the Spurs had it, and ESPN's turnover at its clock is the same play", () => {
    expect(charge.call?.kind).toBe("charge");
    expect(charge.shooter?.name).toBe("Johnson");
    expect(charge.shooter?.role).toBe("wing");
    expect(charge.follows).toEqual(["401909890254"]);
    expect(ballSide(charge)).toBe("top");
  });

  it("Hayes's kicked ball: a violation the Spurs keep the ball on; Fox's travel: the Jazz's ball", () => {
    expect([kick.kind, kick.call?.kind, kick.shooter?.name, kick.shooter?.role, afterSide(kick)]).toEqual(["violation", "kickedBall", "Hayes", "big", "top"]);
    expect([travel.kind, travel.call?.kind, travel.shooter?.name, afterSide(travel)]).toEqual(["turnover", "traveling", "Fox", "bottom"]);
  });

  it("Bailey's pass picked off by Castle; Collier's sailed out of bounds", () => {
    expect([pick.kind, pick.call?.kind, pick.steal?.stealer?.name, pick.shooter?.name]).toEqual(["steal", "badPass", "Castle", "Bailey"]);
    expect([oob.kind, oob.call?.kind, oob.typeID]).toEqual(["turnover", "outOfBounds", 90]);
  });

  it("the opening tip: Wembanyama and Hayes, Harper came up with it for the Spurs; a substitution: Collier in for Peterson", () => {
    expect(tip.jumpers.map((p) => p.name)).toEqual(["Wembanyama", "Hayes"]);
    expect([tip.kind, tip.winner?.name, tip.offense, tip.jumpers.at(-1)?.role]).toEqual(["jumpBall", "Harper", "top", "big"]);
    expect([sub.kind, sub.subIn?.name, sub.subOut?.name, sub.offense]).toEqual(["substitution", "Collier", "Peterson", "bottom"]);
  });

  it("free throws know their place in the trip: 1 of 2, 1 of 3", () => {
    expect([ft1.attempt, ft1.attempts, made(ft1), ft3.attempt, ft3.attempts]).toEqual([1, 2, true, 1, 3]);
  });

  it("the stoppages' words: TIMEOUT · JAZZ, END OF 1ST, HALFTIME, END OF 3RD, END OF REGULATION (tied after four), END OF OT, FINAL", () => {
    const words = scenes.filter((s) => s.kind === "timeout" || s.kind === "periodEnd").map((s) => stoppageWords(s));
    for (const w of ["TIMEOUT · JAZZ", "TIMEOUT · SPURS", "END OF 1ST", "HALFTIME", "END OF 3RD", "END OF REGULATION", "END OF OT", "FINAL"]) expect(words).toContain(w);
  });

  it("a coach's challenge and its ruling: overturned, the call stands", () => {
    expect(reviewWords(scene("401909890136")!, null)).toBe("CHALLENGE · JAZZ · OVERTURNED");
    expect(reviewWords(scene("401909890428")!, null)).toBe("CHALLENGE · JAZZ · CALL STANDS");
  });

  it("a miss knows the board it ended in; the board knows the miss it came off", () => {
    expect([miss.rebound?.person?.name, miss.rebound?.offensive]).toEqual(["Wembanyama", false]);
    expect(miss.follows).toEqual(["40190989036"]);
    expect([board.kind, board.miss?.id, board.miss?.distance, board.shooter?.role]).toEqual(["defensiveRebound", "40190989035", 15, "wing"]);
  });

  it("the lane keeps each participant's position (normalized), so the theater knows a guard from a big", () => {
    const raw = { participants: [{ athlete: { $ref: "http://x/athletes/5104157?lang=en" }, position: { $ref: "http://x/positions/7?lang=en" }, type: "rebounder", order: 1 }] };
    expect(normalized(raw)).toMatchObject({ participants: [{ athlete: { id: "5104157" }, type: "rebounder", position: { id: "7" } }] });
  });
});

describe("told in order, kept up with the game", () => {
  const state = (list: readonly BasketballScene[]) => ({ plays: list, news: new Set(list.map((s) => s.id)), heard: Date.now() });
  const index = (id: string) => scenes.findIndex((s) => s.id === id);

  it("a miss is told with the board it ended in, and the board isn't told again", () => {
    const i = index("40190989035");
    const pair = state(scenes.slice(i, i + 2));
    const unit = basketballNext(null, new Set(), pair);
    expect(unit?.scene.id).toBe("40190989035");
    expect(unit?.covers).toEqual(["40190989036"]);
    expect(basketballNext("40190989035", new Set(["40190989035", "40190989036"]), pair)).toBeNull();
  });

  it("the substitutions at one stoppage are told together: SUBS · WEMBANYAMA, BRYANT +2 IN", () => {
    const i = index("401909890168");
    const unit = basketballNext(null, new Set(), state(scenes.slice(i, i + 4)))!;
    expect(unit.group.length).toBe(4);
    expect(beatScript(unit.scene, unit.group, flat, null).tag?.text).toBe("SUBS · WEMBANYAMA, BRYANT +2 IN");
  });

  it("an offensive foul's turnover is the same play, told once", () => {
    const i = index("401909890252");
    expect(basketballNext(null, new Set(), state(scenes.slice(i, i + 2)))?.covers).toEqual(["401909890254"]);
  });

  it("thirty plays at once: the least of them passed over to catch up, every replay and the newest still told, all accounted for; and the tag says so", () => {
    const burst = state(scenes.slice(120, 150));
    const told = new Set<string>();
    let cursor: string | null = null;
    const units: BasketballUnit[] = [];
    for (let unit = basketballNext(cursor, told, burst); unit; unit = basketballNext(cursor, told, burst)) {
      units.push(unit);
      cursor = unit.scene.id;
      for (const id of [unit.scene.id, ...unit.covers]) told.add(id);
    }
    const first = units[0]!;
    expect(first.skipped).toBeGreaterThan(0);
    for (const id of scenes.slice(120, 150).filter(replays).map((s) => s.id)) expect(units.some((u) => u.scene.id === id)).toBe(true);
    expect(units.at(-1)?.scene.id).toBe(scenes[149]!.id);
    for (const s of scenes.slice(120, 150)) expect(told.has(s.id)).toBe(true);
    expect(statusDuring(first, restScript({ offense: "top", ends: flat, phase: "live", from: null, seed: "rest", round: 0, outlet: false }), 0.5, names)?.text).toBe(`CATCHING UP · ${first.skipped} PLAYS`);
  });
});

describe("the ends of the court", () => {
  const ends = (p: number, flipped = false) => hoopsEnds(p, false, flipped);

  it("the visitors attack the right basket in the first half, the left in the second and in overtime; the home team the other", () => {
    expect([1, 2, 3, 4, 5].map((p) => endsRight(ends(p), "top"))).toEqual([true, true, false, false, false]);
    expect(endsRight(ends(1), "bottom")).toBe(false);
    expect(endsRight(ends(3), "bottom")).toBe(true);
  });

  it("the viewer's turn turns every period round; with the home team on top, the visitors still open at the right", () => {
    for (const p of [1, 2, 3, 4, 5]) expect(endsRight(ends(p, true), "top")).toBe(!endsRight(ends(p), "top"));
    expect(endsRight(hoopsEnds(1, true, false), "bottom")).toBe(true);
  });

  it("each bench stays by the basket its team defends in the first half, all game", () => {
    for (const p of [1, 2, 3, 4, 5]) {
      expect(benchRight(ends(p), "top")).toBe(false);
      expect(benchRight(ends(p), "bottom")).toBe(true);
    }
  });

  it("a replay turned round plays at the left basket, the same play; the turn is remembered per game", () => {
    const dunk = scenes.find((s) => replays(s) && s.offense === "top")!;
    const right = BasketballScript.play(dunk, true);
    const left = BasketballScript.play(dunk, false);
    const center = { x: Hoops.length / 2, y: Hoops.width / 2 };
    const rimRight = (s: BasketballScript) => view(Hoops.rim, s.yaw).x > view(center, s.yaw).x;
    expect(rimRight(right)).toBe(true);
    expect(rimRight(left)).toBe(false);
    expect(right.score).toBe(left.score);
    expect(theaterFlipKey("espn-nba-401909890")).toBe("theaterFlip.espn-nba-401909890");
  });
});

describe("choreography", () => {
  const missBeat = beatScript(miss, [], flat, null);

  it("a made free throw leaves his hand at the line and drops through the rim, the net swinging: FREE THROW 1 OF 2", () => {
    const ft = beatScript(ft1, [], flat, null);
    const leaves = ft.release != null ? ft.ball(ft.release + 0.02) : null;
    expect(leaves != null && Math.abs(leaves.x - (Hoops.freeThrow - 0.15)) < 1.2 && Math.abs(leaves.y - 25) < 1 && leaves.z > 7).toBe(true);
    expect(gap(ft.ball(ft.score!), RIM)).toBeLessThan(0.3);
    expect(ft.net).not.toBeNull();
    expect(ft.tag?.text).toBe("FREE THROW 1 OF 2");
  });

  it("a missed last free throw is off the rim, live, and in someone's hands", () => {
    const ftMiss = scenes.find((s) => s.id.endsWith("0114"))!;
    const beat = beatScript(ftMiss, [], flat, null);
    expect(made(ftMiss)).toBe(false);
    expect(gap(beat.ball(beat.rimHit!), RIM)).toBeLessThan(1.1);
    expect(beat.score).toBeNull();
    expect(beat.carrier(beat.settle)).not.toBeNull();
  });

  it("each shooter's routine is his own: Peterson's the same every trip, the league's not all alike", () => {
    const release = (s: BasketballScene) => Math.round((beatScript(s, [], flat, null).release ?? 0) * 100);
    const peterson = new Set(scenes.filter((s) => s.kind === "freeThrow" && s.shooter?.name === "Peterson").map(release));
    const others = new Set(scenes.filter((s) => s.kind === "freeThrow" && s.shooter?.name !== "Peterson").map(release));
    expect(peterson.size).toBe(1);
    expect(others.size).toBeGreaterThan(2);
  });

  it("a miss leaves his hand at ESPN's spot, comes off the ring, and ends in a defender's hands (Wembanyama's board)", () => {
    const at = missBeat.players[0]!.position(missBeat.release!);
    const spot = Hoops.court(miss.spot!);
    expect(Math.hypot(at.x - spot.x, at.y - spot.y)).toBeLessThan(2.6);
    const ball = missBeat.ball(missBeat.rimHit!)!;
    expect(Math.abs(Math.hypot(ball.x - Hoops.rim.x, ball.y - Hoops.rim.y) - Hoops.rimRadius)).toBeLessThan(0.3);
    expect(missBeat.score).toBeNull();
    expect(missBeat.carrier(missBeat.settle)?.player ?? 0).toBeGreaterThanOrEqual(5);
  });

  it("the ball changes hands on a defensive board: the Spurs bring it up the floor into their set; a big outlets it, a guard brings it up himself", () => {
    const after = restAfter(miss, null, missBeat.lineup(missBeat.duration), flat, "bottom");
    const court = restScript(after);
    const startHolder = court.carrier(0)?.player ?? null;
    const upFloor = mean(court.players.slice(0, 5).map((p) => p.position(REST_LENGTH - 0.5).x));
    expect([after.offense, after.phase, court.side]).toEqual(["top", "live", "top"]);
    expect(startHolder != null && startHolder < 5).toBe(true);
    expect(upFloor).toBeGreaterThan(55);
    const outletTo = court.carrier(2.5)?.player ?? null;
    const guardBoard = scenes.find((s) => s.kind === "defensiveRebound" && s.shooter?.role === "guard")!;
    expect(after.outlet).toBe(true);
    expect(outletTo != null && outletTo !== startHolder).toBe(true);
    expect(court.flights.some((f) => f.start < 1.5)).toBe(true);
    expect(restAfter(guardBoard, null, null, flat, null).outlet).toBe(false);
  });

  it("Vassell's 25-foot three kicks out long to Green, Bailey's floater comes down at the rim to Wembanyama: each as its miss sends it, the same every time", () => {
    const three = scene("40190989022")!;
    const floater = scene("40190989058")!;
    const long = carom(missOfScene(three));
    const short = carom(missOfScene(floater));
    expect(fromRim(long.spot)).toBeGreaterThanOrEqual(9.5);
    expect(fromRim(short.spot)).toBeLessThanOrEqual(7);
    expect(Math.hypot(long.spot.x - short.spot.x, long.spot.y - short.spot.y)).toBeGreaterThan(4);
    const longAt = caughtAt(beatScript(three, [], flat, null))!;
    const shortAt = caughtAt(beatScript(floater, [], flat, null))!;
    expect(Math.hypot(longAt.x - long.spot.x, longAt.y - long.spot.y)).toBeLessThan(3.5);
    expect(Math.hypot(shortAt.x - short.spot.x, shortAt.y - short.spot.y)).toBeLessThan(3.5);
    expect(carom(missOfScene(three))).toEqual(long);
  });

  it("every miss of the game comes down somewhere of its own: threes long and mostly to the weak side, short misses at the rim", () => {
    const misses = fga.filter((s) => !made(s) && s.kind !== "block" && s.spot != null);
    const caroms = misses.map((s) => carom(missOfScene(s)));
    const threes = misses.map((m, i) => [m, caroms[i]!] as const).filter(([m]) => m.value === 3);
    const close = misses.map((m, i) => [m, caroms[i]!] as const).filter(([m]) => (m.distance ?? 99) < 8);
    const weak = threes.filter(([m, c]) => {
      const from = Hoops.court(m.spot!);
      return (from.y - 25) * (c.spot.y - 25) < 0 || Math.abs(from.y - 25) < 4;
    });
    let alike = 0;
    for (let a = 0; a < caroms.length; a++) for (let b = a + 1; b < caroms.length; b++) if (Math.hypot(caroms[a]!.spot.x - caroms[b]!.spot.x, caroms[a]!.spot.y - caroms[b]!.spot.y) < 0.05) alike += 1;
    expect(alike).toBe(0);
    expect(mean(threes.map(([, c]) => fromRim(c.spot)))).toBeGreaterThan(mean(close.map(([, c]) => fromRim(c.spot))) + 5);
    expect(weak.length / threes.length).toBeGreaterThan(0.5);
  });

  it("a shooting foul: the shooter up into it, the whistle, the referee's call, SHOOTING FOUL · WEMBANYAMA in the Spurs' color", () => {
    const beat = beatScript(foul, [], flat, null);
    const whistle = beat.flashes.find((f) => f.beat === "whistle");
    expect(whistle).toBeDefined();
    expect(beat.players.some((p) => p.team === "official")).toBe(true);
    expect(beat.tag).toMatchObject({ text: "SHOOTING FOUL · WEMBANYAMA", side: "top" });
    expect(Math.abs(whistle!.at - beat.tag!.at)).toBeLessThan(0.01);
    expect(beat.stamp).toBe(Infinity);
    expect(beat.players[0]!.jumps.length).toBeGreaterThan(0);
  });

  it("a charge: contact, the defender on the floor, CHARGE · JOHNSON; a bad pass picked off where ESPN put it, the stealer away with it: STL", () => {
    const chargeBeat = beatScript(charge, [], flat, null);
    expect(chargeBeat.players.slice(0, 10).some((p) => p.actions.some((a) => a.kind === "fall"))).toBe(true);
    expect(chargeBeat.tag?.text).toBe("CHARGE · JOHNSON");
    const pickBeat = beatScript(pick, [], flat, null);
    const steal = pickBeat.flashes.find((f) => f.beat === "steal")!;
    const spot = Hoops.court(pick.spot!);
    expect(Math.hypot(steal.point.x - spot.x, steal.point.y - spot.y)).toBeLessThan(1.5);
    expect(pickBeat.carrier(pickBeat.settle)?.player ?? 0).toBeGreaterThanOrEqual(5);
    expect(basketballStamp(pick).parts[0]?.text).toBe("STL");
  });

  it("a pass out of bounds ends off the floor: OUT OF BOUNDS · COLLIER; the opening tip: both jumpers up, the ball to the Spurs: TIP-OFF · HARPER", () => {
    const oobBeat = beatScript(oob, [], flat, null);
    const lying = oobBeat.ball(oobBeat.duration)!;
    expect(lying.x < 0 || lying.x > Hoops.length || lying.y < 0 || lying.y > Hoops.width).toBe(true);
    expect(oobBeat.tag?.text).toBe("OUT OF BOUNDS · COLLIER");
    const tipBeat = beatScript(tip, [], flat, null);
    expect(tipBeat.tag?.text).toBe("TIP-OFF · HARPER");
    expect([tipBeat.players[0]!.jumps.length, tipBeat.players[5]!.jumps.length]).toEqual([1, 1]);
    expect((tipBeat.carrier(tipBeat.settle)?.player ?? 9) < 5).toBe(true);
  });

  // Every beat of the game, one after another from where the last left off.
  const beats = scenes.filter((s) => !replays(s));
  const built: [BasketballScene, BasketballScript][] = [];
  {
    let from: Lineup | null = null;
    let side: Side | null = "top";
    for (const s of beats) {
      const script = beatScript(s, [], hoopsEnds(s.period, false, false), from, side);
      built.push([s, script]);
      from = script.lineup(script.duration);
      side = afterSide(s) ?? side;
    }
  }

  it(`all ${beats.length} beats of the game, one after another from where the last left off: on the floor, 1–6 s each`, () => {
    const astray = (sc: BasketballScript): string | null => {
      for (let t = 0; t <= sc.duration + 1e-9; t += 0.1) {
        for (const [i, p] of sc.players.entries()) {
          const q = p.position(t);
          if (!(Number.isFinite(q.x) && q.x > -4 && q.x < 98 && q.y > -12 && q.y < 62)) return `player ${i} at (${q.x.toFixed(1)}, ${q.y.toFixed(1)}), t ${t.toFixed(1)}`;
        }
        const b = sc.ball(t);
        if (b && b.z < 0.3) return `ball at z ${b.z.toFixed(2)}, t ${t.toFixed(1)}`;
      }
      return null;
    };
    const strays = built.flatMap(([s, sc]) => {
      const why = astray(sc);
      return why ? [`${s.text.slice(0, 36)}: ${why}`] : [];
    });
    expect(built.length).toBe(beats.length);
    expect(strays.slice(0, 4)).toEqual([]);
    const lengths = built.map(([, sc]) => sc.duration);
    expect(Math.min(...lengths)).toBeGreaterThan(0.9);
    expect(Math.max(...lengths)).toBeLessThan(6);
  });

  it("in a beat of every kind, knees and elbows bend only their own way (the referee's signals, a man on the floor too)", () => {
    const sample = new Map<string, [BasketballScene, BasketballScript]>();
    for (const pair of built) {
      const key = `${pair[0].kind}${pair[0].call ? JSON.stringify(pair[0].call) : ""}`;
      if (!sample.has(key)) sample.set(key, pair);
    }
    const broken = [...sample.values()].flatMap(([s, sc]) => {
      const where = jointsBreak(sc.duration, sc.players.length, (i, t) => playerPose(sc, sc.players[i]!, i, t, sc.players[i]!.position(t), 1.1 / Hoops.ground)[0]);
      return where ? [`${s.text.slice(0, 30)}: ${where}`] : [];
    });
    expect(broken.slice(0, 3)).toEqual([]);
  }, 120_000);
});

describe("between plays", () => {
  const missBeat = beatScript(miss, [], flat, null);

  it("between plays something small happens every few seconds, briefly, and nothing moves in between (no redraw)", () => {
    const live = restScript({ offense: "top", ends: flat, phase: "live", from: seenBy(missBeat.lineup(missBeat.duration), "top"), seed: "a", round: 0, outlet: false });
    const opening = live.active[0]?.[1] ?? 0;
    const later = live.active.slice(1);
    const moving = later.reduce((n, [a, b]) => n + (b - a), 0);
    expect(later.length).toBeGreaterThan(0);
    expect(moving / (REST_LENGTH - opening)).toBeLessThan(0.4);
    for (let k = 0; k + 1 < later.length; k++) {
      expect(later[k + 1]![0] - later[k]![1]).toBeGreaterThanOrEqual(3);
      const t1 = later[k]![1] + 0.2;
      const t2 = later[k + 1]![0] - 0.1;
      for (const p of live.players) expect(p.position(t1)).toEqual(p.position(t2));
      expect(live.ball(t1)).toEqual(live.ball(t2));
    }
  });

  it("a timeout: the whistle, TIMEOUT · JAZZ, both teams to their benches and there till play resumes", () => {
    const timeout = scenes.find((s) => s.kind === "timeout")!;
    const toBeat = beatScript(timeout, [], flat, missBeat.lineup(missBeat.duration));
    const benches = restScript(restAfter(timeout, null, toBeat.lineup(toBeat.duration), flat, "bottom"));
    // Off the near sideline, as drawn (the frame is turned half round when the play's at the left basket).
    const right = endsRight(flat, benches.side);
    expect(toBeat.tag?.text).toBe("TIMEOUT · JAZZ");
    expect(benches.formation).toBe("benches");
    for (const p of benches.players.slice(0, 10)) {
      const y = p.position(REST_LENGTH).y;
      expect((right ? y : Hoops.width - y) < 0).toBe(true);
      const a = p.position((benches.active[0]?.[1] ?? 0) + 0.1);
      const b = p.position(REST_LENGTH);
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(2);
    }
  });

  it("at the half the floor empties", () => {
    const half = scenes.find((s) => s.kind === "periodEnd" && s.period === 2)!;
    const empty = restScript(restAfter(half, null, missBeat.lineup(missBeat.duration), flat, null));
    expect(empty.formation).toBe("offCourt");
    expect(empty.players.every((p) => p.opacity(empty.duration) === 0)).toBe(true);
  });

  it("the tag between plays: TIMEOUT · JAZZ, HALFTIME, SPURS BALL in the Spurs' color, FREE THROWS · JAZZ", () => {
    const timeout = scenes.find((s) => s.kind === "timeout")!;
    const half = scenes.find((s) => s.kind === "periodEnd" && s.period === 2)!;
    const after = restAfter(miss, null, missBeat.lineup(missBeat.duration), flat, "bottom");
    expect(statusBetween(timeout, null, names)?.text).toBe("TIMEOUT · JAZZ");
    expect(statusBetween(half, null, names)?.text).toBe("HALFTIME");
    expect(statusBetween(miss, after, names)).toEqual({ text: "SPURS BALL", side: "top" });
    expect(statusBetween(foul, restAfter(foul, null, null, flat, null), names)?.text).toBe("FREE THROWS · JAZZ");
  });

  it("a shooting foul leads to the lane, the man fouled at the line with the ball, and the free throw starts where they stand", () => {
    const foulBeat = beatScript(foul, [], flat, null);
    const lane = restScript(restAfter(foul, null, foulBeat.lineup(foulBeat.duration), flat, null));
    const ft = beatScript(ft1, [], flat, lane.lineup(REST_LENGTH));
    expect(lane.formation).toBe("lane");
    expect(lane.carrier(REST_LENGTH)?.player).toBe(0);
    expect(ft.players.slice(0, 10).map((p) => p.at)).toEqual(lane.lineup(REST_LENGTH).at);
  });
});

describe("parity: the same dice as on the Mac", () => {
  // The Mac's review harness's numbers (the hoops review sheets, from main): each beat built from the court it interrupts, play on, a beat of it run.
  const before = (s: BasketballScene, side: Side): Lineup => {
    const rest = restScript(restOf({ offense: side, ends: hoopsEnds(s.period, false, false), phase: "live", from: null, seed: `pre-${s.id}` }));
    return rest.lineup((rest.active[1]?.[1] ?? 6) + 0.5);
  };
  const beatOf = (s: BasketballScene, side = beatSide(s, null, "top")) => beatScript(s, [], hoopsEnds(s.period, false, false), before(s, side), side);
  const bySuffix = (suffix: string) => scenes.find((s) => s.id.endsWith(suffix))!;

  it("each miss and whistle lasts what it lasts on the Mac, to the hundredth, its shot leaving his hand when it does", () => {
    const suffixes = ["9022", "9058", "9050", "9056", "9035", "9018", "0656", "0252", "0240", "0642", "0312"];
    expect(suffixes.map((x) => beatOf(bySuffix(x)).duration.toFixed(2))).toEqual(["4.15", "4.62", "3.40", "3.37", "5.26", "2.69", "3.40", "3.50", "2.50", "3.08", "4.17"]);
    // Vassell's three: up at 1.01 s, off the rim at 2.29 s (the sheet's 1.03 and 2.35).
    const three = beatOf(bySuffix("9022"));
    expect([(three.release! + 0.02).toFixed(2), (three.rimHit! + 0.06).toFixed(2)]).toEqual(["1.03", "2.35"]);
  });

  it("the court between plays has its sparse beats when the Mac's does", () => {
    const miss = bySuffix("9035");
    const missBeat = beatOf(miss, "bottom");
    const court = restScript(restAfter(miss, null, missBeat.lineup(missBeat.duration), hoopsEnds(1, false, false), null));
    expect(court.active.slice(1).map(([a, b]) => ((a + b) / 2).toFixed(2))).toEqual(["10.67", "17.77", "23.77"]);
  });
});

describe("the theater state the lane keeps", () => {
  it("every kind of play is read, the newest forty", () => {
    const recent = basketballRecent(items, teams);
    expect(recent.length).toBe(40);
    expect(recent.at(-1)?.id).toBe(items.at(-1)!.id);
  });
});
