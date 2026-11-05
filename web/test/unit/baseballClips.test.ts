/**
 * The baseball theater on the engine (BaseballClips.swift), on the Mac's
 * gate fixture Tests/Fixtures/theater/baseball_mlb/ws3-synthetic (Brewers at
 * Rays, the first three half-innings: every look the recorder's format, the
 * arrivals synthesized 25-50 s after each entry's wallclock): the plays
 * arrive as the lane brings them, the director plans and splices, and every
 * frame is measured by the bench's continuity meter against the Mac's gates
 * for baseball (TheaterEngineTests.swift `theaterGates`: no hard cuts,
 * teleportMax at its ratchet 1.38, at most 0.5% of the time over the sprint,
 * overspeed at its ratchet +36%, at most 1% over the push limits, the rig's
 * planted foot not slipping). Plus the pieces: the field between pitches
 * with its quiet (GamePresentationRegressionTests.swift `breakScenes`), the
 * clips, the running order and its anchors.
 */
import { describe, expect, it } from "vitest";
import { at, type JSONValue } from "../../src/data/json";
import { DiamondClip, DiamondSequencer, DiamondSport, sameDiamondFacts, type DiamondFacts } from "../../src/data/mlb/baseballClips";
import { timeline } from "../../src/data/mlb/playBeat";
import { PlayScript, type Rest } from "../../src/data/mlb/playScript";
import { baseballArrivals, baseballKind, baseballPeriod } from "../../src/data/mlb/replayBaseball";
import { seed64 } from "../../src/data/theater/splitMix64";
import type { Span } from "../../src/data/theater/theaterEngine";
import { quantile } from "./theaterBenchMeter";
import { runEngine } from "./theaterRun";
import { FrameScratch } from "../../src/data/theater/theaterFrameScratch";
import type { PlanChain } from "../../src/data/theater/theaterPlanChain";
import { diamondFrame } from "../../src/features/game/mlb/theater/directedField";
import { directedStatus } from "../../src/features/game/mlb/theater/BaseballDirected";
import { firstLooks, recording } from "./theaterTimelines";

/** The longest stretch with nothing moving in a loop of `period` from `start` (GamePresentationRegressionTests.longestStill). */
function longestStill(beats: readonly Span[], start: number, period: number): number {
  const inside = beats
    .filter((b) => b.upper > start)
    .map((b) => ({ lower: Math.max(b.lower, start), upper: Math.min(b.upper, start + period) }))
    .sort((a, b) => a.lower - b.lower);
  const first = inside[0];
  const last = inside[inside.length - 1];
  if (!first || !last) return period;
  let longest = first.lower - start + (start + period - last.upper);
  let end = first.upper;
  for (const beat of inside.slice(1)) {
    longest = Math.max(longest, beat.lower - end);
    end = Math.max(end, beat.upper);
  }
  return longest;
}

describe("the field between pitches", () => {
  const rests: [string, Rest][] = [
    ["between pitches", { bases: [true, false, false], bats: "R", swapped: false }],
    ["between innings", { bases: [false, false, false], bats: null, swapped: false }],
    ["the tarp", { bases: [false, false, false], bats: null, swapped: false, standing: { kind: "tarp" } }],
  ];
  for (const [what, rest] of rests) {
    it(`${what}: never still past about 8 s, round to where it began, the battery and the batter and the umpire waiting`, () => {
      const script = PlayScript.quiet(rest, seed64("field"));
      const moves = script.actors.flatMap((a) => a.moves.map((m) => ({ lower: m.start, upper: m.end + 0.2 })));
      expect(longestStill(moves, 0, script.duration)).toBeLessThanOrEqual(8.2);
      for (const a of script.actors) {
        const from = a.position(0);
        const to = a.position(script.duration);
        expect(Math.hypot(to.x - from.x, to.y - from.y)).toBeLessThan(0.01);
      }
      for (const a of script.actors) {
        const waits = (a.role.kind === "fielder" && a.role.n <= 2) || a.role.kind === "batter" || a.role.kind === "umpire";
        if (waits) expect(a.moves).toHaveLength(0);
      }
    });
  }

  it("the tarp's grounds crew stands by it, out of either team's kit", () => {
    const script = PlayScript.quiet({ bases: [false, false, false], bats: null, swapped: false, standing: { kind: "tarp" } }, seed64("field"));
    expect(script.tarp?.out).toBe(true);
    expect(script.actors).toHaveLength(3);
    expect(script.actors.every((a) => a.team === "official" && a.role.kind === "coach")).toBe(true);
  });

  it("a replay's field is still as it was", () => {
    expect(PlayScript.rest({ bases: [false, false, false], bats: null, swapped: false }).duration).toBe(0);
  });

  it("as a clip it goes round its quiet, moving only while someone is", () => {
    const clip = new DiamondClip(PlayScript.quiet({ bases: [false, false, false], bats: "L", swapped: false }, seed64("field")), null, null, "rest", "top");
    expect(clip.length).toBe(Infinity);
    expect(clip.ambient).toBe(true);
    expect(clip.decisive).toBeNull();
    const d = clip.script.duration;
    expect(clip.local(d + 1.5)).toBeCloseTo(1.5, 9);
    for (let i = 0; i < clip.figures.length; i++) {
      const a = clip.position(i, 0.3);
      const b = clip.position(i, d + 0.3);
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-9);
    }
    let moving = 0;
    let still = 0;
    for (let t = 0; t < d; t += 0.25) (clip.moving(t) ? moving++ : still++);
    expect(moving).toBeGreaterThan(0);
    expect(still).toBeGreaterThan(0);
  });
});

// The Mac's gate fixture: every look as the recorder's format has them.
const looks = recording("baseball_mlb", "ws3-synthetic");
const plays = (look: JSONValue) => (at(look, "plays") as JSONValue[] | undefined) ?? [];
const competitors = at(looks[looks.length - 1]!.json, "header", "competitions", 0, "competitors") as { homeAway: string; id: string; team: { id: string } }[];
const home = competitors.find((c) => c.homeAway === "home")!;
const away = competitors.find((c) => c.homeAway === "away")!;
// Baseball lists the visitors first: the top team (TheaterBenchSports.swift `DiamondBench.facts`).
const facts: DiamondFacts = { topID: away.team.id ?? away.id, bottomID: home.team.id ?? home.id, names: {}, heldUp: null };

/** A baseball recording's plays as they arrived. */
function recordedBaseball(): ReturnType<typeof baseballArrivals> {
  const first = firstLooks(looks, plays);
  const when = new Map(first.map((f) => [at(f.play, "id") as string, f.at]));
  // In the game's order, as the summary lists them (the lane's order: an end of a half can arrive before its last pitch).
  const game = plays(looks[looks.length - 1]!.json);
  const listed = new Set(game.map((p) => at(p, "id")));
  return baseballArrivals(
    [...game, ...first.map((f) => f.play).filter((p) => !listed.has(at(p, "id")))],
    0,
    (id) => when.get(id) ?? null,
  );
}

describe("the timeline's entries", () => {
  const all = plays(looks[looks.length - 1]!.json);
  it("half-innings as periods, pitches and results live, the bookkeeping dead", () => {
    const byType = (type: string) => all.find((p) => at(p, "type", "type") === type)!;
    expect(baseballPeriod(byType("start-inning"))).toBe(2);
    expect(baseballKind(byType("ball"))).toMatchObject({ phase: "live", label: "pitch" });
    expect(baseballKind(byType("play-result"))).toMatchObject({ phase: "live", label: "result" });
    expect(baseballKind(byType("start-batterpitcher"))).toMatchObject({ phase: "dead", label: "start batterpitcher" });
    expect(baseballKind(byType("end-inning"))).toMatchObject({ phase: "dead", label: "half-inning end", stopsClock: true });
  });

  it("every entry arrives once, in the order it came", () => {
    const arrivals = recordedBaseball();
    expect(new Set(arrivals.map((a) => a.play.id)).size).toBe(arrivals.length);
    expect(arrivals.length).toBe(all.length);
    for (let i = 1; i < arrivals.length; i++) expect(arrivals[i]!.at).toBeGreaterThanOrEqual(arrivals[i - 1]!.at);
  });
});

describe("the running order", () => {
  const arrivals = recordedBaseball();
  // The timeline in the game's order.
  const timelinePlays = arrivals.map((a) => a.play).sort((a, b) => a.order - b.order);

  it("each beat lands on its entry's anchor; a play's replay told from its scene", () => {
    const sequencer = new DiamondSequencer(timelinePlays, new Set(), facts);
    const units = sequencer.units(new Set());
    expect(units.length).toBe(sequencer.beats.length);
    const ids = new Set(timelinePlays.map((p) => p.id));
    for (const u of units) {
      expect(u.anchor).toBe(DiamondSequencer.entry(u.scene));
      expect(ids.has(u.anchor!)).toBe(true);
    }
    const play = units.find((u) => u.scene.kind.kind === "play")!;
    expect(play.lead).toBe(0.9);
    const clip = sequencer.clip(play, 0, null!);
    expect(clip.kind).toBe("play");
    expect(clip.scene?.id).toBe(DiamondSequencer.entry(play.scene));
    expect(clip.decisive).not.toBeNull();
    const pitch = units.find((u) => u.scene.kind.kind === "pitch")!;
    expect(pitch.lead).toBe(0.4);
    const beat = sequencer.clip(pitch, 0, null!);
    expect(beat.kind).toBe("beat");
    expect(beat.decisive).toBeCloseTo((beat.script.release ?? 0) + 0.45, 9);
  });

  it("history isn't told again; the third out changes sides", () => {
    const history = new Set(timelinePlays.slice(0, 12).map((p) => p.id));
    const sequencer = new DiamondSequencer(timelinePlays, history, facts);
    expect(sequencer.units(new Set()).every((u) => !history.has(DiamondSequencer.entry(u.scene)))).toBe(true);
    const third = sequencer.beats.find((b) => b.kind.kind === "play" && b.outs >= 3)!;
    expect(sequencer.batting(third)).toBe(third.top ? "bottom" : "top");
    const brk = sequencer.beats.find((b) => b.kind.kind === "inningBreak")!;
    expect(sequencer.restFor(brk).bats).toBeNull();
  });

  it("a game held up rolls the tarp out first, then off once it's over", () => {
    const held = new DiamondSequencer(timelinePlays, new Set(), { ...facts, heldUp: "Rain Delay" });
    const first = held.units(new Set())[0]!;
    expect(first.id).toBe("status-delay");
    expect(first.scene.kind).toEqual({ kind: "delay", delay: { kind: "weather", why: "Rain" } });
    const over = new DiamondSequencer(timelinePlays, new Set(), facts).units(new Set(["status-delay"]))[0]!;
    expect(over.id).toBe("status-delay-over");
    expect(held.field(0).script.tarp?.out).toBe(true);
  });

  it("facts compare by value, the names too", () => {
    expect(sameDiamondFacts({ ...facts, names: { a: "B" } }, { ...facts, names: { a: "B" } })).toBe(true);
    expect(sameDiamondFacts(facts, { ...facts, heldUp: "Rain Delay" })).toBe(false);
  });

  it("the timeline reads the same beats the stage's does", () => {
    expect(new DiamondSequencer(timelinePlays, new Set(), facts).beats).toEqual(timeline(timelinePlays.map((p) => p.play.json), [], {}));
  });
});

describe("the director on the recording", () => {
  const arrivals = recordedBaseball();
  const from = looks[0]!.at;
  const until = looks[looks.length - 1]!.at + 30;
  // Every sixth frame through the painter (the Mac's bench poses every frame with DiamondPainter): what it drew.
  const painted = { frames: 0, figures: 0, extras: 0, teams: new Set<string>(), tags: new Set<string>(), playTags: 0, bad: [] as string[] };
  let n = 0;
  const paint = (T: number, chain: PlanChain<DiamondClip>, scratch: FrameScratch) => {
    if (n++ % 6 !== 0) return;
    const drawn = diamondFrame(chain, scratch, { width: 640, height: 320 });
    if (!drawn) return;
    const { clip, world } = drawn;
    painted.frames += 1;
    painted.figures += world.figures.size;
    painted.extras += world.extras.length;
    if (world.figures.size + world.extras.length > scratch.count) painted.bad.push(`T=${T.toFixed(2)} more drawn than the engine has`);
    for (const [i, w] of world.figures) {
      if (!(i < clip.script.actors.length)) painted.bad.push(`T=${T.toFixed(2)} figure ${i} past the clip's men`);
      const finite = [w.at.x, w.at.y, w.heading, w.body.hip.z, w.body.left.x, w.body.right.y, w.body.turn].every(Number.isFinite);
      if (!finite) painted.bad.push(`T=${T.toFixed(2)} figure ${i} not finite`);
    }
    for (const e of world.extras) painted.teams.add(e.team);
    if (!(world.camera.span > 0) || !Number.isFinite(world.camera.x)) painted.bad.push(`T=${T.toFixed(2)} camera`);
    let beat = null;
    const plan = chain.plans[scratch.plan]!.plan;
    for (let i = drawn.placement; i >= 0 && !beat; i--) beat = plan.placements[i]!.clip.beat;
    const said = directedStatus(clip, drawn.t, beat, true);
    if (clip.kind === "play" && said.text != null) painted.playTags += 1;
    if (said.text) painted.tags.add(said.text);
  };
  // The clock 55 s behind: every entry (arriving up to 50 s after its wallclock) in before its pitch's 4 s horizon.
  const run = runEngine(DiamondSport, facts, arrivals, from, until, 55, DiamondClip.limits, "baseball ws3-synthetic", null, { frame: paint });
  const r = run.report;
  if (process.env.THEATER_BENCH) {
    console.log(
      `${r.label}: frames ${r.frames}, plans ${run.plans}, hard cuts ${r.hardCuts} (${[...r.hardCutReasons].join(", ")}), teleportMax ${r.teleportMax.toFixed(2)}, ` +
        `over the sprint ${(r.speedShare * 100).toFixed(2)}% max +${(r.maxOverspeed * 100).toFixed(0)}%, accel ${(r.accelShare * 100).toFixed(2)}%, rig slip ${r.rigSlipMax.toFixed(2)} mm, ` +
        `decisive p95 ${quantile(r.decisiveErrors.map(Math.abs), 0.95).toFixed(3)} s max ${Math.max(...r.decisiveErrors.map(Math.abs)).toFixed(3)} s, catch-ups ${r.catchUps.length}, ` +
        `plan ms p50 ${quantile(run.planMs, 0.5).toFixed(1)} p99 ${quantile(run.planMs, 0.99).toFixed(1)}, ` +
        `overspeed by cause ${[...r.maxOverspeedBySource].map(([k, v]) => `${k} +${(v * 100).toFixed(0)}%`).join(", ")}\n${r.jumpLog.join("\n")}`,
    );
  }

  it("plans and tells every entry that came in", () => {
    expect(run.plans).toBeGreaterThan(3);
    expect(run.decisive.size).toBeGreaterThan(20);
  });

  it("the gates: no hard cuts, nobody outruns his legs for long, the planted foot holds", () => {
    const why = [...r.hardCutReasons].join(", ") + "\n" + r.jumpLog.join("\n");
    expect(r.hardCuts, why).toBe(0);
    expect(r.teleportMax, "teleportMax holds its ratchet (1.38 on the Mac; gate 1.15)").toBeLessThanOrEqual(1.38);
    expect(r.speedShare, "at most 0.5% of the time over the sprint").toBeLessThanOrEqual(0.005);
    expect(r.maxOverspeed, "overspeed holds its ratchet (+36% on the Mac; gate +12%)").toBeLessThanOrEqual(0.36);
    expect(r.accelShare, "at most 1% of the time over the push limits").toBeLessThanOrEqual(0.01);
    expect(r.rigSlipMax, "the rig's planted foot doesn't slip").toBeLessThanOrEqual(0.5);
  });

  it("decisive moments land on their anchors (p95 ≤ 0.05 s, max ≤ 0.25 s), catch-ups apart", () => {
    const abs = r.decisiveErrors.map(Math.abs);
    expect(abs.length).toBeGreaterThan(10);
    expect(quantile(abs, 0.95), `p95 ${quantile(abs, 0.95)}`).toBeLessThanOrEqual(0.05);
    expect(Math.max(...abs), `max ${Math.max(...abs)}`).toBeLessThanOrEqual(0.25);
  });

  it("determinism: the same arrivals, the same plans", { timeout: 60_000 }, () => {
    const again = runEngine(DiamondSport, facts, arrivals, from, until, 55, DiamondClip.limits, "again");
    expect(again.plans).toBe(run.plans);
    expect([...again.decisive]).toEqual([...run.decisive]);
    expect(again.report.teleportMax).toBe(r.teleportMax);
  });

  it("the painter: the clip in charge's figures where the engine has his men, the others in their own kit, the tag as today's", () => {
    expect(painted.bad.slice(0, 5)).toEqual([]);
    expect(painted.frames).toBeGreaterThan(10_000);
    expect(painted.figures / painted.frames).toBeGreaterThan(9);
    // Men on their way to the next clip, or leaving, in their own kit: never a third team.
    expect(painted.extras).toBeGreaterThan(0);
    expect([...painted.teams].every((t) => t === "batting" || t === "fielding" || t === "official")).toBe(true);
    // Nothing while a play replays; a pitch's call, the count, the end of a half otherwise.
    expect(painted.playTags).toBe(0);
    expect([...painted.tags].some((t) => t.includes("·"))).toBe(true);
    expect(painted.tags.has("MID 2ND") && painted.tags.has("END 1ST"), [...painted.tags].join(" / ")).toBe(true);
  });
});
