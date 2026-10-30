/**
 * The play flow on the isometric views, all four sports (PlayFlowTests.swift,
 * check by check, the same thresholds): a replay that comes in while the
 * field between plays is on screen takes over from it (theaterBridge.ts:
 * each figure from where he is, or a quick crossfade when the play starts far
 * off, and with Reduce Motion); an official on the field only while the data
 * has him doing something; and the action slowed where it ran faster than
 * life (football's snap to dead ball 1.3×, basketball's approach 1.2×,
 * soccer's build-up 1.3×), the walk-up, the hold and the reset at their own
 * pace.
 */
import { describe, expect, it } from "vitest";
import { houseCurve, sweepCurve } from "../../src/data/celebrations";
import type { JSONValue } from "../../src/data/json";
import type { FootballTeams } from "../../src/data/liveFeeds/football";
import type { Teams } from "../../src/data/liveFeeds/basketball";
import type { PlayBeat } from "../../src/data/mlb/playBeat";
import { beatScript as pitchScript, idleScript as routineScript } from "../../src/data/mlb/playBeatScript";
import { PlayScript, type Rest } from "../../src/data/mlb/playScript";
import { Ballpark, type Point } from "../../src/data/mlb/theaterField";
import { zebra } from "../../src/data/mlb/theaterTeams";
import type { Side } from "../../src/data/models";
import { footballClimax } from "../../src/data/scoringSlide";
import { beatScript, endsRight, restOf, restScript, BeatBuilder, type HoopsEnds } from "../../src/data/theater/basketballBeats";
import { parseScene, replays, type BasketballScene } from "../../src/data/theater/basketballScene";
import { BasketballScript, Hoops } from "../../src/data/theater/basketballScript";
import { basketballBridge } from "../../src/data/theater/basketballTheater";
import { FieldFacing, footballIdle, idleScript, parseStoppage } from "../../src/data/theater/footballIdle";
import { opponent, parse, type FootballScene } from "../../src/data/theater/footballScene";
import { Builder, FootballScript, Player } from "../../src/data/theater/footballScript";
import { footballBridge } from "../../src/data/theater/footballTheater";
import { PitchFacing, soccerIdle, soccerIdleScript, turnedScene, type SoccerEvent, type SoccerEventKind } from "../../src/data/theater/soccerIdle";
import { isMoment, keepers, parse as parseMoment, Pitch, SoccerLineup, type SoccerScene } from "../../src/data/theater/soccerScene";
import { buildUpPace, SoccerScript, type SoccerProp } from "../../src/data/theater/soccerScript";
import { soccerBridge } from "../../src/data/theater/soccerTheater";
import { bridgeMatch, bridgeMix, bridgePlan, bridgeTracks, TheaterBridge, type BridgeFigure, type BridgePlan } from "../../src/data/theater/theaterBridge";
import { TheaterDelays } from "../../src/data/theater/theaterDelays";
import { Pace } from "../../src/data/theater/theaterKit";
import { zebraBands } from "../../src/features/game/core/theater/rigFigure";
import { footballProjection } from "../../src/features/game/football/theater/drawFootball";
import { fixture } from "./fixtures";

type Item = Record<string, unknown>;
const nflTeams: FootballTeams = { topIsHome: false, topID: "6", bottomID: "21", homeAbbreviation: "PHI", awayAbbreviation: "DAL" };
const nfl = (fixture("mnf-dal-phi-plays.json") as { items: Item[] }).items.flatMap((i) => parse(i, nflTeams) ?? []);
const hoops: BasketballScene[] = (fixture("nba-theater-plays.json") as { games: { items: Item[]; home: { id: string; abbreviation: string }; away: { id: string; abbreviation: string } }[] }).games.flatMap((g) => {
  const teams: Teams = { topIsHome: false, topID: g.away.id, bottomID: g.home.id, topName: g.away.abbreviation, bottomName: g.home.abbreviation };
  return g.items.flatMap((_, i) => parseScene(g.items, i, teams) ?? []);
});
const matches = (fixture("soccer-theater-plays.json") as { matches: { home: { id: string }; rosters: JSONValue; clips: JSONValue[][] }[] }).matches;
const near = (a: Point, b: Point, tolerance = 0.01) => Math.hypot(a.x - b.x, a.y - b.y) <= tolerance;
const range = (from: number, to: number, step: number) => {
  const out: number[] = [];
  for (let t = from; t <= to + 1e-9; t += step) out.push(t);
  return out;
};
const figure = (group: number, kind: string, x: number, y: number): BridgeFigure => ({ group, kind, athlete: null, at: { x, y } });

describe("the bridge's plan", () => {
  const idleMen = [figure(0, "qb", 0, -24), figure(0, "wr", 10, -20), figure(1, "cb", 12, 18), figure(2, "", 80, 0)];
  const replayMen = [figure(0, "wr", 40, -2), figure(0, "qb", 0, -15), figure(1, "cb", 40, 15), figure(1, "lb", 0, 12)];
  const roomy = bridgePlan(idleMen, replayMen, { room: 1.0, far: 40 });

  it("who becomes whom: each man the replay has, the idle's man of his kind on his side (the staff never); a man the idle didn't have fades in", () => {
    expect([...bridgeMatch(idleMen, replayMen)].sort((a, b) => a[0] - b[0])).toEqual([
      [0, 1],
      [1, 0],
      [2, 2],
    ]);
  });

  it("the bridge (0.5–0.7 s) runs inside the replay's own lead-in when it fits; only what doesn't fit is added in front", () => {
    const tight = bridgePlan(idleMen, replayMen, { room: 0.2, far: 40 });
    expect(roomy.mode).toBe("bridge");
    expect(roomy.length).toBeGreaterThanOrEqual(TheaterBridge.shortest);
    expect(roomy.length).toBeLessThanOrEqual(TheaterBridge.longest);
    expect(roomy.lead).toBe(0);
    expect(Math.abs(tight.length - roomy.length)).toBeLessThan(1e-9);
    expect(Math.abs(tight.lead - (tight.length - 0.2))).toBeLessThan(1e-9);
  });

  it("the hand-off eases on the name glide's curve, cubic-bezier(0.77, 0, 0.175, 1): from the idle at 0 to the replay at the bridge's end", () => {
    expect(roomy.weight(0)).toBe(0);
    expect(Math.abs(roomy.weight(roomy.length * 0.25) - sweepCurve(0.25))).toBeLessThan(1e-9);
    expect(Math.abs(roomy.weight(roomy.end) - 1)).toBeLessThan(1e-9);
    expect(TheaterBridge.ease(0.5)).toBe(sweepCurve(0.5));
  });

  it("an idle beat 0.3 s or less from its end finishes first (its last moment, then the bridge); one further off doesn't wait", () => {
    const finishing = bridgePlan(idleMen, replayMen, { room: 1.0, far: 40, beatLeft: 0.22 });
    const midBeat = bridgePlan(idleMen, replayMen, { room: 1.0, far: 40, beatLeft: 1.4 });
    expect(Math.abs(finishing.wait - 0.22)).toBeLessThan(1e-9);
    expect(finishing.weight(0.2)).toBe(0);
    expect(finishing.replayTime(finishing.wait + finishing.lead)).toBe(0);
    expect(midBeat.wait).toBe(0);
  });

  it("with Reduce Motion: a 0.25 s crossfade (ease-out), nothing travels, nothing waits", () => {
    const reduced = bridgePlan(idleMen, replayMen, { room: 0.2, far: 40, reduceMotion: true, beatLeft: 0.2 });
    expect(reduced.mode).toBe("crossfade");
    expect(reduced.length).toBe(TheaterBridge.crossfade);
    expect(reduced.pairs.size).toBe(0);
    expect(reduced.delay).toBe(0);
    expect(TheaterBridge.fade(0.5)).toBe(houseCurve(0.5));
  });

  it("a play that starts far from where the idle stands (the median move past the sport's far rule), or at another end: a quick crossfade instead", () => {
    const far = bridgePlan(idleMen, replayMen, { room: 1.0, far: 5 });
    const apart = bridgePlan(idleMen, replayMen, { room: 1.0, far: 40, together: false });
    expect(far.mode).toBe("crossfade");
    expect(far.moved).toBeGreaterThan(5);
    expect(apart.mode).toBe("crossfade");
    expect(far.length).toBe(TheaterBridge.crossfade);
  });

  it("a bridged replay's late start is noted for its play, so the scoring slide still lands with its climax", () => {
    TheaterDelays.note("flow-test", roomy.delay + 0.3);
    expect(Math.abs(TheaterDelays.delay("flow-test") - 0.3)).toBeLessThan(1e-9);
    expect(TheaterDelays.delay("never-bridged")).toBe(0);
  });
});

// MARK: - Football

const pass = nfl.find((s) => s.kind.type === "pass" && s.text.includes("short"))!;
const passOffense: Side = pass.offense!;
const replay = FootballScript.play(pass, FieldFacing.yaw(pass.offense, pass.period, false));
const lined = footballIdle({ play: null, stoppage: null, rest: { yard: pass.from, gain: null }, offense: passOffense, down: null, kickoff: false, flipped: false });
const idle = idleScript(lined);
const describePlan = (p: BridgePlan) => `${p.mode} ${p.length.toFixed(2)} s, median ${p.moved.toFixed(1)}, lead ${p.lead.toFixed(2)}, wait ${p.wait.toFixed(2)}`;

describe("football: the field between snaps into the snap's formation", () => {
  const t0 = range(7.6, 10.0, 0.2).find((t) => idle.moving(t) && footballBridge(idle, passOffense, t, replay, passOffense, false).mode === "bridge") ?? 8.4;
  const plan = footballBridge(idle, passOffense, t0, replay, passOffense, false);
  const tracks = bridgeTracks(
    plan,
    8.5,
    (j, s) => ({ at: idle.players[j]!.position(idle.idleTime(t0 + s)), heading: idle.rig[j]!.motion(idle.idleTime(t0 + s)).heading }),
    (i, s) => ({ at: replay.players[i]!.position(plan.replayTime(s)), heading: replay.rig[i]!.motion(plan.replayTime(s)).heading }),
  );

  it("a snap that comes in as the men jog to the line bridges from there, inside the formation's half second before the snap (and a little more)", () => {
    expect(plan.mode, describePlan(plan)).toBe("bridge");
    expect(plan.pairs.size).toBeGreaterThanOrEqual(20);
    expect(Math.abs(plan.lead - Math.max(plan.length - replay.leadIn, 0))).toBeLessThan(1e-9);
    expect(replay.leadIn).toBeGreaterThanOrEqual(0.5);
    expect(replay.leadIn).toBeLessThan(0.6);
  });

  it("…each man starts where the idle has him on screen and ends on his place in the formation: no jump either end", () => {
    for (const [r, i] of plan.pairs) {
      expect(tracks.has(r)).toBe(true);
      const from = idle.players[i]!.position(idle.idleTime(t0));
      const to = replay.players[r]!.position(plan.replayTime(plan.end));
      expect(near(bridgeMix(from, replay.players[r]!.position(plan.replayTime(0)), plan.weight(0)), from)).toBe(true);
      expect(near(bridgeMix(idle.players[i]!.position(idle.idleTime(t0 + plan.end)), to, plan.weight(plan.end)), to)).toBe(true);
    }
  });

  it("…the camera eases from the idle's framing to the replay's", () => {
    const size = { width: 312, height: 156 };
    const camera = (s: number) => footballProjection(size, replay, plan.replayTime(s), { script: idle, t: idle.idleTime(t0 + s), w: plan.weight(s), s, pairs: plan.pairs, tracks }).camera;
    const landed = replay.camera.frame(plan.replayTime(plan.end));
    const start = idle.camera.frame(idle.idleTime(t0));
    expect([camera(0).x, camera(0).y, camera(0).span]).toEqual([start.x, start.y, start.span]);
    expect(Math.abs(camera(plan.end - 1e-4).x - landed.x)).toBeLessThan(0.05);
    expect(Math.abs(camera(plan.end - 1e-4).span - landed.span)).toBeLessThan(0.05);
  });

  it("…the idle already at the next down's spot (six yards on), or the other team's ball: a crossfade into the formation (four yards, median)", () => {
    const walked = footballIdle({ play: null, stoppage: null, rest: { yard: pass.from + 6, gain: null }, offense: passOffense, down: null, kickoff: false, flipped: false });
    const walkedPlan = footballBridge(idleScript(walked), passOffense, 16, replay, passOffense, false);
    const otherEnd = footballIdle({ play: null, stoppage: null, rest: { yard: 100 - pass.from, gain: null }, offense: opponent(passOffense), down: null, kickoff: false, flipped: false });
    const otherPlan = footballBridge(idleScript(otherEnd), otherEnd.offense, 16, replay, passOffense, false);
    expect(walkedPlan.mode, describePlan(walkedPlan)).toBe("crossfade");
    expect(walkedPlan.moved).toBeGreaterThan(TheaterBridge.far.football);
    expect(otherPlan.mode).toBe("crossfade");
  });

  it("…with Reduce Motion, a crossfade", () => {
    expect(footballBridge(idle, passOffense, t0, replay, passOffense, true).mode).toBe("crossfade");
  });
});

// MARK: - Basketball

const ends: HoopsEnds = { topRight: true, topOpensRight: true };

describe("basketball: the half-court set into the replay's", () => {
  it("a basket that comes in mid-beat of the half-court set bridges all ten from where they are; with the ball the other way (the other end), or Reduce Motion, a crossfade", () => {
    const three = hoops.find((s) => replays(s) && s.kind === "three")!;
    const replayed = BasketballScript.play(three, endsRight(ends, three.offense));
    const rest = restScript(restOf({ offense: three.offense, ends, phase: "live", seed: "flow" }));
    const beat = rest.active[1];
    const t = beat ? (beat[0] + beat[1]) / 2 : 6;
    const plan = basketballBridge(rest, t, replayed, false);
    const other = restScript(restOf({ offense: three.offense === "top" ? "bottom" : "top", ends, phase: "live", seed: "flow" }));
    expect(plan.mode, describePlan(plan)).toBe("bridge");
    expect(plan.pairs.size).toBe(10);
    expect(plan.moved).toBeLessThanOrEqual(TheaterBridge.far.basketball);
    expect(basketballBridge(other, t, replayed, false).mode).toBe("crossfade");
    expect(basketballBridge(rest, t, replayed, true).mode).toBe("crossfade");
  });
});

// MARK: - Soccer

const match = matches[0]!;
const home = match.home.id;
const lineups = SoccerLineup.lineups(match.rosters, (team) => (team === home ? "top" : "bottom"));
const moments: SoccerScene[] = match.clips.flatMap((clip) => clip.flatMap((p, i) => (isMoment(p) ? (parseMoment(clip, i, home, keepers(clip)) ?? []) : [])));

describe("soccer: the ball going round into the move's first touch", () => {
  it("a moment whose move starts where the ball was going round bridges both elevens (the same men, by athlete); one in the other half crossfades; Reduce Motion crossfades", () => {
    let bridged = false;
    let far = false;
    let reduced = false;
    for (const scene of moments) {
      if (scene.touches.length < 2) continue;
      const drawn = PitchFacing.homeAttacksRight(scene.period, false) ? scene : turnedScene(scene);
      const replayed = SoccerScript.build(drawn, lineups);
      const start = scene.touches[0]?.at ?? scene.shot.from;
      const idleAt = (at: Point) => soccerIdle({ event: null, touch: { side: scene.side, at, order: 0, period: scene.period ?? null, clock: 0 }, scene: null, period: scene.period ?? null, lineups, flipped: false });
      const nearIdle = idleAt(start);
      const awayIdle = idleAt({ x: Pitch.length - start.x, y: start.y });
      const nearScript = soccerIdleScript(nearIdle);
      const plan = soccerBridge(nearScript, nearIdle.possession, 1, replayed, drawn.side, false);
      if (plan.mode === "bridge" && plan.pairs.size >= 20) bridged = true;
      if (soccerBridge(soccerIdleScript(awayIdle), awayIdle.possession, 1, replayed, drawn.side, false).mode === "crossfade" && Math.abs(Pitch.length - 2 * start.x) > 40) far = true;
      if (soccerBridge(nearScript, nearIdle.possession, 1, replayed, drawn.side, true).mode === "crossfade") reduced = true;
    }
    expect([bridged, far, reduced]).toEqual([true, true, true]);
  });
});

// MARK: - Baseball

const rest: Rest = { bases: [true, false, false], bats: "R", swapped: false, fieldingHome: false };
const pitchBeat = (id: string): PlayBeat => ({
  id,
  kind: { kind: "pitch", pitch: { call: "ball", number: 1, balls: 1, strikes: 0, code: null, mph: null, x: null, y: null, flight: null, review: null } },
  bats: null,
  arm: null,
  inning: null,
  top: null,
  balls: 1,
  strikes: 0,
  outs: 0,
  wallclock: null,
  bases: null,
  news: true,
});

describe("baseball: the routine between pitches into the pitch", () => {
  it("a pitch that comes in mid-routine (the runner stretching his lead) bridges every figure, the umpire too, inside the pitch's own wind-up; the other half's field, or Reduce Motion, a crossfade", () => {
    const pitch = pitchScript(pitchBeat("flow"), rest);
    const routine = routineScript("lead", rest, 3n, "R");
    const plan = routine.bridge(routine.duration / 2, pitch, true, false, routine.duration / 2);
    expect(plan.mode, describePlan(plan)).toBe("bridge");
    expect(plan.pairs.size).toBe(pitch.actors.length);
    expect(plan.lead).toBe(0);
    expect(routine.bridge(1, pitch, false, false).mode).toBe("crossfade");
    expect(routine.bridge(1, pitch, true, true).mode).toBe("crossfade");
  });
});

// MARK: - Officials: only while the data has one doing something

describe("officials", () => {
  it("football: an official in a replay only when he throws a flag; none in any other", () => {
    expect(nfl.some((s) => s.flags.length > 0)).toBe(true);
    for (const s of nfl.slice(0, 120).map((scene) => FootballScript.play(scene))) expect(s.flags.length === 0).toBe(!s.players.some((p) => p.team === "official"));
  });

  it("…in it for his throw alone, from his post: fading in as he reaches back, gone once it's down", () => {
    for (const scene of nfl.filter((s) => s.flags.length > 0).slice(0, 20)) {
      const s = FootballScript.play(scene);
      for (const p of s.players.filter((p) => p.team === "official")) {
        const thrown = p.actions.filter((a) => a.kind === "flagThrow").map((a) => a.at);
        expect(thrown.length).toBeGreaterThan(0);
        const first = Math.min(...thrown);
        const last = Math.max(...thrown);
        expect(p.opacity(first - 0.4)).toBeGreaterThan(0.99);
        expect(p.opacity(first - Builder.officialBefore - 0.01)).toBe(0);
        expect(p.opacity(last + Builder.officialAfter + Player.fade + 0.01)).toBe(0);
      }
    }
  });

  it("…and none between snaps: the huddle, the line, a timeout, a TV timeout, a challenge (no referee walking to the monitor), a man hurt, the half", () => {
    const games = (fixture("nfl-stoppages-plays.json") as { games: { items: Item[]; home: { id: string; abbreviation: string }; away: { id: string; abbreviation: string } }[] }).games;
    const idles: FootballScript[] = [idle];
    for (const g of games) {
      const teams: FootballTeams = { topIsHome: false, topID: g.away.id, bottomID: g.home.id, homeAbbreviation: g.home.abbreviation, awayAbbreviation: g.away.abbreviation };
      for (const item of g.items) {
        const play = parse(item, teams);
        const stop = parseStoppage(item, teams);
        if (play?.review == null && !(play && play.injuries.length > 0) && stop == null) continue;
        idles.push(idleScript(footballIdle({ play, stoppage: stop, rest: { yard: 40, gain: 50 }, offense: play?.offense ?? "top", down: null, kickoff: false, flipped: false })));
      }
    }
    expect(idles.length).toBeGreaterThan(10);
    expect(idles.filter((s) => s.players.some((p) => p.team === "official")).length).toBe(0);
  });

  it("basketball: no referee in a replay", () => {
    const marquees = hoops.filter(replays).slice(0, 60).map((s) => BasketballScript.play(s));
    expect(marquees.every((s) => !s.players.some((p) => p.team === "official"))).toBe(true);
  });

  it("…a referee only while he acts: in to his whistle and gone once his signal's down, the jump ball's toss, handing the ball for free throws; nobody standing under the basket or on the court between plays", () => {
    const beats = hoops
      .filter((s) => !replays(s) && s.kind !== "substitution")
      .slice(0, 260)
      .map((s) => beatScript(s, [], ends, null, s.offense));
    let refs = 0;
    for (const s of beats) {
      s.players.forEach((ref, index) => {
        if (ref.team !== "official") return;
        refs += 1;
        // Each referee does something (in to a call, signals, tosses, passes the ball), and is gone a beat after the last of it.
        const ball = s.legs.some((l) => l.hand.kind === "held" && l.hand.player === index);
        const last = Math.max(-1, ...ref.actions.map((a) => a.at), ...ref.moves.map((m) => m.end), ...(ball ? s.flights.map((f) => f.start) : []));
        expect(ref.actions.length > 0 || ref.moves.length > 0 || ball).toBe(true);
        expect(ref.leaves).toBeLessThanOrEqual(last + BeatBuilder.signalled + 0.2);
      });
    }
    expect(refs).toBeGreaterThan(0);
    expect(beats.some((s) => s.players.some((p) => p.actions.some((a) => a.kind === "toss")))).toBe(true);
    const lanes = restScript(restOf({ offense: "top", ends, phase: "lane", seed: "flow" }));
    expect(lanes.players.some((p) => p.team === "official" && p.leaves < 4)).toBe(true);
    const standing = restScript(restOf({ offense: "top", ends, phase: "lane", seed: "flow", from: lanes.lineup(lanes.duration) }));
    expect(standing.players.some((p) => p.team === "official")).toBe(false);
    expect(restScript(restOf({ offense: "top", ends, phase: "live", seed: "flow" })).players.some((p) => p.team === "official")).toBe(false);
  });

  it("soccer: the referee for a booking (the card), the assistant for an offside (the flag), the fourth official for a substitution (the board), each fading in for it and out after; nobody for a corner, a foul, a man hurt, VAR, the kick-off, the ball going round", () => {
    const event = (kind: SoccerEventKind): SoccerEvent => ({
      id: `flow-${kind.type}`,
      kind,
      side: "bottom",
      player: "Rodri",
      athlete: null,
      other: "John McGinn",
      otherAthlete: null,
      at: { x: 70, y: 30 },
      penalty: false,
      minute: "",
      clock: 0,
      period: 1,
      text: "",
      wallclock: null,
      order: 0,
    });
    const script = (kind: SoccerEventKind) => soccerIdleScript(soccerIdle({ event: event(kind), touch: null, scene: null, period: 1, lineups, flipped: false }));
    const acts: [SoccerEventKind, SoccerProp["kind"]][] = [
      [{ type: "card", red: false, second: false }, "yellowCard"],
      [{ type: "offside" }, "flag"],
      [{ type: "substitution" }, "board"],
    ];
    for (const [kind, prop] of acts) {
      const s = script(kind);
      const officials = s.actors.flatMap((a, i) => (a.team === "official" ? [i] : []));
      expect(officials.length, kind.type).toBe(1);
      const official = s.actors[officials[0]!]!;
      expect(s.props.some((p) => p.kind === prop && p.actor === officials[0])).toBe(true);
      expect(official.appear).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(official.vanish)).toBe(true);
      expect(s.props.filter((p) => p.actor === officials[0]).every((p) => p.until <= official.vanish + 0.01)).toBe(true);
    }
    const none: SoccerEventKind[] = [{ type: "corner" }, { type: "foul" }, { type: "handball" }, { type: "injury" }, { type: "varCheck" }, { type: "varDecision", words: "No penalty" }, { type: "kickoff" }, { type: "halftime" }];
    const play = soccerIdleScript(soccerIdle({ event: null, touch: null, scene: null, period: 1, lineups, flipped: false }));
    for (const s of [...none.map(script), play]) expect(s.actors.some((a) => a.team === "official")).toBe(false);
  });

  it("baseball: the plate umpire stays, behind the catcher, unchanged", () => {
    const umpires = PlayScript.rest(rest).actors.filter((a) => a.team === "official");
    expect(umpires.length).toBe(1);
    expect(umpires[0]!.role.kind).toBe("umpire");
    expect(near(umpires[0]!.at, Ballpark.umpire("R"))).toBe(true);
  });

  it("the zebra shirt: two bold black stripes across the torso (one on the smallest figures), black and white bands one width, filling it edge to edge", () => {
    const small = zebraBands(2.4);
    const large = zebraBands(5.5);
    expect(zebra("dark").stripes).not.toBeNull();
    expect([large.count, small.count]).toEqual([2, 1]);
    expect(large.black).toBe(large.white);
    expect(Math.abs(large.count * large.black + (large.count + 1) * large.white - 5.5)).toBeLessThan(1e-9);
    expect(small.black).toBeGreaterThanOrEqual(0.6);
  });
});

// MARK: - Pace: the action slowed, the rest at its own pace

describe("pace", () => {
  const paced = (scene: FootballScene) => {
    const yaw = FieldFacing.yaw(scene.offense, scene.period, false);
    return [FootballScript.play(scene, yaw, 1), FootballScript.play(scene, yaw)] as const;
  };
  const run = nfl.find((s) => s.kind.type === "rush" && s.scoring == null && s.to - s.from > 3)!;

  for (const [scene, what] of [
    [pass, "a pass"],
    [run, "a run"],
  ] as const) {
    it(`football, ${what}: from the snap to the ball being dead 1.3× slower (the throw, its flight, the run, the stop), the walk-up before it, the hold on the stamp and the jog back as they were`, () => {
      const [laid, played] = paced(scene);
      const sets = laid.players.flatMap((p) => (p.set != null ? [p.set] : []));
      const snap = sets.length > 0 ? Math.min(...sets) : 0.5;
      const k = FootballScript.actionPace;
      laid.players.forEach((p, i) => expect(near(p.position(snap * 0.9), played.players[i]!.position(snap * 0.9))).toBe(true));
      const flights = laid.flights.flatMap((f, i) => (f.start > snap + 0.01 && f.end < laid.stamp - 0.3 ? [[f, played.flights[i]!] as const] : []));
      expect(flights.length > 0 || scene.kind.type === "rush").toBe(true);
      for (const [l, p] of flights) {
        expect(Math.abs(p.end - p.start - (l.end - l.start) * k)).toBeLessThan(0.01);
        expect(Math.abs(p.start - snap - (l.start - snap) * k)).toBeLessThan(0.01);
      }
      const hit = (s: FootballScript) => s.flashes.findLast((f) => f.beat === "hit" || f.beat === "catchBall")?.at ?? s.stamp;
      expect(Math.abs(hit(played) - snap - (hit(laid) - snap) * k)).toBeLessThan(0.02);
      expect(Math.abs(played.settle - played.stamp - (laid.settle - laid.stamp))).toBeLessThan(0.01);
      expect(Math.abs(played.duration - played.settle - (laid.duration - laid.settle))).toBeLessThan(0.35);
      expect(Math.abs(played.local(snap + (hit(laid) - snap) * k) - hit(laid))).toBeLessThan(0.01);
    });
  }

  it("the stretch: nothing before the snap moves, the action runs 1.3× slower, everything after it comes as much later; a pose keyed off an action plays on its laid-out clock", () => {
    const pace = new Pace(0.5, 2.5, 1.3);
    expect(pace.stretched(0.3)).toBe(0.3);
    expect(Math.abs(pace.stretched(1.5) - 1.8)).toBeLessThan(1e-9);
    expect(Math.abs(pace.stretched(3) - 3.6)).toBeLessThan(1e-9);
    for (const t of [0.2, 0.9, 2.2, 3.1, 5]) expect(Math.abs(pace.laidOut(pace.stretched(t)) - t)).toBeLessThan(1e-9);
  });

  it("…the headline, the stamp and the scoring slide's climax all keep time with the slowed play", () => {
    const touchdown = nfl.find((s) => s.scoring === "touchdown" && s.kind.type === "pass")!;
    const [laid, played] = paced(touchdown);
    expect(played.score).not.toBeNull();
    expect(Math.abs(played.banner!.at - played.score!)).toBeLessThan(0.01);
    expect(played.stamp).toBeGreaterThan(laid.stamp);
    expect(footballClimax(played)).toBe(played.score);
  });

  it("basketball: the approach (the set to the shooter gathering) 1.2× slower; the shot's flight (gravity's time), the stamp after it, as they were", () => {
    const three = hoops.find((s) => replays(s) && s.kind === "three" && s.assister != null)!;
    const laid = BasketballScript.play(three, null, 1);
    const played = BasketballScript.play(three);
    const k = BasketballScript.approachPace;
    const shot = (s: BasketballScript) => s.flights.find((f) => Math.abs(f.to.z - Hoops.rimHeight) < 0.4)!;
    expect(Math.abs(laid.leadIn - played.leadIn)).toBeLessThan(1e-9);
    expect(Math.abs((played.release ?? 0) - 0.55 - played.leadIn - ((laid.release ?? 0) - 0.55 - laid.leadIn) * k)).toBeLessThan(0.01);
    expect(Math.abs(shot(played).end - shot(played).start - (shot(laid).end - shot(laid).start))).toBeLessThan(1e-9);
    expect(Math.abs(played.stamp - (played.release ?? 0) - (laid.stamp - (laid.release ?? 0)))).toBeLessThan(0.01);
  });

  it("soccer: the build-up (the first pass to the strike) 1.3× slower; the shot, the payoff and the stamp at their own pace", () => {
    const move = moments.find((s) => s.touches.length >= 3 && !s.shot.penalty)!;
    const laid = SoccerScript.build(move, lineups, 1);
    const played = SoccerScript.build(move, lineups);
    const first = laid.flights.find((f) => f.end - f.start > 0.05)?.start ?? 0;
    expect(Math.abs(played.strike - first - (laid.strike - first) * buildUpPace)).toBeLessThan(0.01);
    expect(Math.abs(played.arrive - played.strike - (laid.arrive - laid.strike))).toBeLessThan(1e-9);
    expect(Math.abs(played.stamp - played.arrive - (laid.stamp - laid.arrive))).toBeLessThan(1e-9);
  });
});
