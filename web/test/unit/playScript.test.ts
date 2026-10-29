/**
 * The play theater's choreography (PlayTheaterTests.swift, PlayBroadcastTests.swift):
 * a throw beats the runner it retires, a home run clears the fence, every
 * replay settles to a static field; the headline; the figures; the teams
 * always dressed apart; one celebration per moment.
 */
import { describe, expect, it } from "vitest";
import { liveMoment, Tier } from "../../src/data/moments";
import { parse, type PlayScene, type SideOf } from "../../src/data/mlb/playScene";
import { PlayScript, restSpot, type Rest } from "../../src/data/mlb/playScript";
import { plateCelebration, sprayChartBursts } from "../../src/data/mlb/theaterCelebration";
import { Ballpark, samePoint, type Point } from "../../src/data/mlb/theaterField";
import { BaseballPoses } from "../../src/data/mlb/theaterPose";
import { gait, RigPoses, skeleton, vec } from "../../src/data/theater/rig";
import { pose } from "../../src/features/game/mlb/theater/drawTheater";
import { jointsBreak } from "./rigJoints";
import { APART, dress, labDistance, type Uniform } from "../../src/data/mlb/theaterTeams";
import { oklabFromHex } from "../../src/data/teamColors";
import { fixture } from "./fixtures";

const g3 = fixture("mlb-ws-g3-plays.json") as { items: unknown[]; names: Record<string, string> };
const plays = g3.items;
const names = g3.names;
const side: SideOf = (id) => (id === "8" ? "top" : id === "30" ? "bottom" : null);
const idOf = (p: unknown) => (p as { id?: string }).id;
const typeOf = (p: unknown) => (p as { type?: { type?: string } }).type?.type;

function scene(id: string): PlayScene {
  const i = plays.findIndex((p) => idOf(p) === id);
  const s = i < 0 ? null : parse(plays, i, side, names);
  if (!s) throw new Error(`No play ${id}`);
  return s;
}

const g2 = (fixture("mlb-ws-g2-summary-plays.json") as { plays: unknown[] }).plays;
const homer = (() => {
  const i = g2.findIndex((p) => idOf(p) === "4019080430005990057");
  const s = parse(g2, i, (id) => (id === "30" ? "top" : "bottom"));
  if (!s) throw new Error("No home run");
  return s;
})();

const restFor = (s: PlayScene, bases?: readonly boolean[]): Rest => ({
  bases: s.endsInning ? [false, false, false] : (bases ?? s.basesAfter),
  bats: "R",
  swapped: s.endsInning,
});
const script = (s: PlayScene, bases?: readonly boolean[]) => PlayScript.play(s, restFor(s, bases));

const groundOut = scene("4019080440005990057");
const flyOut = scene("4019080440102990057");
const dp = scene("4019080441102990057");
const looking = scene("4019080440902990057");
const swinging = scene("4019080440002990057");
const walk = scene("4019080440403990057");
const single = scene("4019080440003990057");
const double = scene("4019080440811990057");

describe("choreography", () => {
  it("6-3: the out is at first, before the runner gets there; the mark lands with the throw; a replay of 2–4 s", () => {
    const s = script(groundOut);
    const out = s.flashes.find((f) => f.beat === "out")!;
    const batterRunner = s.actors[9]!;
    const reaches = batterRunner.moves[batterRunner.moves.length - 1]?.end ?? 0;
    expect(samePoint({ x: out.point.x, y: out.point.y }, Ballpark.base(1))).toBe(true);
    expect(out.at).toBeLessThan(reaches);
    expect(s.stamp).toBeGreaterThanOrEqual(out.at);
    expect(s.flights.some((f) => samePoint({ x: f.to.x, y: f.to.y }, Ballpark.bag(1)))).toBe(true);
    expect(s.settle - 0.75).toBeGreaterThan(1.8);
    expect(s.settle - 0.75).toBeLessThan(4.2);
  });
  it("4-6-3: out at second, then at first", () => {
    const s = script(dp);
    const outs = s.flashes
      .filter((f) => f.beat === "out")
      .sort((a, b) => a.at - b.at)
      .map((f) => ({ x: f.point.x, y: f.point.y }));
    expect(outs.length).toBe(2);
    expect(samePoint(outs[0]!, Ballpark.base(2))).toBe(true);
    expect(samePoint(outs[1]!, Ballpark.base(1))).toBe(true);
  });
  it("a home run clears the fence mid-flight and lands beyond it, over the wall, both runs crossing, in about four seconds", () => {
    const s = script(homer);
    const fence = s.fence!;
    const flight = s.flights[s.batted!]!;
    const landing = Ballpark.distance({ x: flight.to.x, y: flight.to.y });
    expect(fence.at).toBeGreaterThan(flight.start);
    expect(fence.at).toBeLessThan(flight.end);
    expect(landing).toBeGreaterThan(Ballpark.fence(Ballpark.bearing({ x: flight.to.x, y: flight.to.y })));
    expect(fence.point.z).toBeGreaterThan(Ballpark.wallHeight);
    expect(s.flashes.filter((f) => f.beat === "run").length).toBe(2);
    expect(s.settle - 0.75).toBeLessThan(4.4);
  });
  it("a walk: no ball in play; the batter ends at first, leading off", () => {
    const s = script(walk);
    expect(s.batted).toBeNull();
    expect(samePoint(s.actors[9]!.position(Infinity), Ballpark.lead(1))).toBe(true);
  });
  it("looking, he doesn't swing; swinging, he does", () => {
    expect(script(looking).actors[9]!.swing).toBeNull();
    expect(script(swinging).actors[9]!.swing).not.toBeNull();
  });
  it("after a play the fielders walk back (the first baseman to hold a runner on), the ball is put away, runners lead off, the next batter steps in", () => {
    const s = script(single);
    const after = single!.basesAfter;
    for (let i = 0; i < 9; i++) expect(samePoint(s.actors[i]!.position(Infinity), restSpot({ bases: after }, i + 1))).toBe(true);
    expect(samePoint(s.actors[2]!.position(Infinity), after[0] ? Ballpark.holding : Ballpark.position(3))).toBe(true);
    expect(s.ball(Infinity)).toBeNull();
    const runners = s.actors.filter((a) => a.team === "batting" && a.opacity(Infinity) > 0.99).map((a) => a.position(Infinity));
    const want: Point[] = [Ballpark.lead(1), Ballpark.lead(2), Ballpark.box("R")];
    expect(runners.length).toBe(want.length);
    for (const p of want) expect(runners.some((r) => samePoint(r, p))).toBe(true);
  });
  it("after the third out the team that batted takes the field (the umpire stays)", () => {
    const s = script(groundOut);
    const fielders = s.actors.filter((a) => a.opacity(Infinity) > 0.99 && a.bats == null && a.team !== "official");
    expect(fielders.length).toBe(9);
    expect(fielders.every((a) => a.team === "batting")).toBe(true);
    expect(s.actors.some((a) => a.role.kind === "umpire" && a.vanish === Infinity)).toBe(true);
  });
  it("every play's figures and ball stay finite, the ball never under the grass; every replay runs 1.2–4.4 s (one with runs, told in order, up to 5.6)", { timeout: 30_000 }, () => {
    const scenes = plays.flatMap((p, i) => (typeOf(p) === "play-result" ? (parse(plays, i, side, names) ?? []) : []));
    const all = scenes.map((s) => script(s));
    all.forEach((s, i) => {
      for (let t = 0; t <= s.duration; t += 0.1) {
        for (const a of s.actors) {
          const p = a.position(t);
          expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
        }
        const ball = s.ball(t);
        if (ball) expect(Number.isFinite(ball.x) && Number.isFinite(ball.y) && Number.isFinite(ball.z) && ball.z >= -0.01).toBe(true);
      }
      // A run-scoring play tells its runs in order once the ball's been handled (playCredits.test.ts): a little longer.
      expect(s.settle - 0.75).toBeGreaterThanOrEqual(1.2);
      expect(s.settle - 0.75).toBeLessThanOrEqual(scenes[i]!.runs === 0 ? 4.4 : 5.6);
    });
  });
  it("in every play of the game, knees and elbows bend only their own way, never past folded (the poses and every blend between them)", { timeout: 60_000 }, () => {
    const scenes = plays.flatMap((p, i) => (typeOf(p) === "play-result" ? (parse(plays, i, side, names) ?? []) : []));
    const broken = scenes.flatMap((sc) => {
      const s = script(sc);
      const where = jointsBreak(s.duration, s.actors.length, (i, t) => pose(s, t, s.actors[i]!, i, s.actors[i]!.position(t), 1.1 / 8.5)[0]);
      return where ? [`${sc.text.slice(0, 30)}: ${where}`] : [];
    });
    expect(broken.slice(0, 3)).toEqual([]);
  });
  it("an unknown play with a spot still replays; a play with nothing to go on still makes a (quiet) script", () => {
    const odd = parse(
      [
        {
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
        },
      ],
      0,
      side,
    )!;
    const s = PlayScript.play(odd, { bases: [false, false, false], bats: null, swapped: false });
    expect(s.batted).not.toBeNull();
    expect(s.duration).toBeGreaterThan(1);
    expect(s.duration).toBeLessThan(7);
    const bare = parse([{ id: "y", type: { type: "play-result" }, alternativeType: { type: "brand-new-play" }, text: "" }], 0, side)!;
    expect(PlayScript.play(bare, { bases: [false, false, false], bats: null, swapped: false }).duration).toBeGreaterThan(0);
  });
});

describe("the headline", () => {
  it("banners for marquee plays only: HOME RUN, DOUBLE, DOUBLE PLAY, STRIKEOUT; none for a single, a walk or a routine out", () => {
    const cases: [PlayScene, string | null, string | null][] = [
      [homer, "HOME RUN", "hit"],
      [double, "DOUBLE", "hit"],
      [dp, "DOUBLE PLAY", "out"],
      [looking, "STRIKEOUT", "strikeout"],
      [single, null, null],
      [walk, null, null],
      [groundOut, null, null],
      [flyOut, null, null],
    ];
    for (const [s, text, tone] of cases) {
      const b = script(s).banner;
      expect(b?.text ?? null).toBe(text);
      expect(b?.tone ?? null).toBe(tone);
    }
  });
  it("a home run's banner lands off the bat, holds through the trot, and clears before the replay ends", () => {
    const s = script(homer);
    const b = s.banner!;
    expect(b.at).toBeLessThan(s.fence!.at);
    expect(b.at).toBeGreaterThan(s.flights[s.batted!]!.start);
    expect(b.until + 0.3).toBeLessThanOrEqual(s.duration);
  });
  it("a double play's lands with the last out", () => {
    const s = script(dp);
    expect(s.banner!.at).toBe(s.stamp);
    expect(s.banner!.until + 0.3).toBeLessThanOrEqual(s.duration);
  });
  it("a walk-off (the home team ahead in the bottom of the 9th): WALK-OFF in gold, with confetti", () => {
    const entry = {
      id: "w",
      atBatId: "w1",
      type: { type: "play-result" },
      alternativeType: { type: "single" },
      text: "Bauers singled to left, Chourio scored.",
      team: { id: "30" },
      scoreValue: 1,
      period: { type: "Bottom", number: 9 },
      homeScore: 4,
      awayScore: 3,
      hitCoordinate: { x: 90, y: 130 },
      trajectory: "L",
      participants: [
        { type: "batter", athlete: { id: "1" } },
        { type: "onFirst", athlete: { id: "1" } },
      ],
    };
    const walkOff = parse([entry], 0, side)!;
    expect(walkOff.walkOff).toBe(true);
    const b = script(walkOff).banner!;
    expect(b.text).toBe("WALK-OFF");
    expect(b.tone).toBe("gold");
    expect(b.confetti).toBe(true);
    expect(dp.walkOff).toBe(false);
  });
});

describe("figures", () => {
  it("the pitcher's delivery and the batter's swing are on the clock", () => {
    const s = script(dp);
    expect(s.release).not.toBeNull();
    expect(s.actors[9]!.swing).not.toBeNull();
  });
  it("a 4-6-3: the second baseman throws, the shortstop takes it and throws, the first baseman gloves it; the runner slides into second", () => {
    const s = script(dp);
    expect(s.actors[3]!.actions.some((a) => a.kind === "throwBall")).toBe(true);
    expect(s.actors[5]!.actions.some((a) => a.kind === "glove")).toBe(true);
    expect(s.actors[5]!.actions.some((a) => a.kind === "throwBall")).toBe(true);
    expect(s.actors[2]!.actions.some((a) => a.kind === "glove")).toBe(true);
    expect(s.actors.some((a) => a.role.kind === "runner" && a.slide != null)).toBe(true);
  });
  it("a grounder kicks up dust where it hops; a fly doesn't", () => {
    expect(script(groundOut).puffs.length).toBeGreaterThan(0);
    expect(script(flyOut).puffs.length).toBe(0);
  });
  it("every pose stands on the ground, head up", () => {
    const striding = [0.0, 0.3, 0.6].map((phase) => gait({ heading: 0, phase, speed: 6, push: 0, weight: 1 }, { left: vec(0.1, 0.06, 0), right: vec(-0.15, -0.06, 0.2) }));
    const B = BaseballPoses;
    for (const p of [...striding, B.slide, B.stride, B.deliver, B.stance, B.finish, RigPoses.catchHigh, RigPoses.scoop, B.squat, B.lead, B.set, B.kick]) {
      const k = skeleton(p);
      expect(Math.min(k.feet[0].z, k.feet[1].z)).toBeLessThanOrEqual(0.01);
      expect(k.head.z).toBeGreaterThan(k.hip.z);
    }
  });
});

describe("teams, always apart", () => {
  const apart = (a: Uniform, b: Uniform) => labDistance(oklabFromHex(a.jersey)!, oklabFromHex(b.jersey)!) >= APART;
  const navies = { top: { color: "13294b", alternate: null }, bottom: { color: "092c5c", alternate: null } };
  const espn = { top: { color: "13294b", alternate: "ffc52f" }, bottom: { color: "092c5c", alternate: "8fbce6" } };
  for (const scheme of ["dark", "light"] as const) {
    it(`${scheme}: two navies with no second colors: the home team wears whites`, () => {
      const plain = dress(navies, scheme);
      expect(plain.rule).toEqual({ kind: "whites", side: "bottom" });
      expect(apart(plain.top, plain.bottom)).toBe(true);
    });
    it(`${scheme}: Brewers and Rays navies: the Brewers change into gold (their second color), not gray`, () => {
      const dressed = dress(espn, scheme);
      expect(dressed.rule).toEqual({ kind: "second", side: "top" });
      expect(apart(dressed.top, dressed.bottom)).toBe(true);
    });
    it(`${scheme}: navy and red read apart as they are`, () => {
      const rivals = dress({ top: { color: "0c2340", alternate: null }, bottom: { color: "bd3039", alternate: null } }, scheme);
      expect(rivals.rule).toEqual({ kind: "own" });
      expect(apart(rivals.top, rivals.bottom)).toBe(true);
    });
    it(`${scheme}: two blues whose second colors are white and silver: whites`, () => {
      const blank = dress({ top: { color: "005a9c", alternate: "ffffff" }, bottom: { color: "004687", alternate: "c0c0c0" } }, scheme);
      expect(blank.rule).toEqual({ kind: "whites", side: "bottom" });
      expect(apart(blank.top, blank.bottom)).toBe(true);
    });
  }
  it("light: whites carry piping in the team's color (a white halo wouldn't show them)", () => {
    expect(dress(navies, "light").bottom.piping).not.toBeNull();
  });
  it("light: two golds: the home team in charcoal, dark against light", () => {
    const pale = dress({ top: { color: "fdb827", alternate: null }, bottom: { color: "ffc52f", alternate: null } }, "light");
    expect(pale.rule).toEqual({ kind: "whites", side: "bottom" });
    expect(apart(pale.top, pale.bottom)).toBe(true);
  });
  it("dark: two black teams (gray on a dark panel) still read apart", () => {
    const black = dress({ top: { color: "000000", alternate: null }, bottom: { color: "27251f", alternate: null } }, "dark");
    expect(apart(black.top, black.bottom)).toBe(true);
  });
});

describe("one celebration per moment", () => {
  const s = script(homer);
  const moment = { ...liveMoment({ id: homer.id, chart: "plate", tier: Tier.score, kind: "homeRun", lead: "Home run", detail: homer.text }), burst: true };

  it("a home run's fireworks: the theater's when it's on the page, else the spray chart's", () => {
    expect(sprayChartBursts(true)).toBe(false);
    expect(sprayChartBursts(false)).toBe(true);
  });
  it("the theater's home run: two shells bursting at the wall as the ball clears it, and confetti off the banner", () => {
    const full = plateCelebration(moment, homer, s, "full", false, 156);
    const fireworks = full.find((b) => b.anchor.kind === "field")!;
    expect(fireworks.cue.effects).toEqual([{ kind: "fireworks", shells: 2 }]);
    expect(Math.abs(fireworks.at + fireworks.cue.delay - s.fence!.at)).toBeLessThan(0.001);
    expect(fireworks.anchor).toEqual({ kind: "field", point: s.fence!.point });
    expect(full.some((b) => b.anchor.kind === "banner" && b.cue.effects.some((e) => e.kind === "confetti"))).toBe(true);
  });
  it("Subtle: sparks at the wall, no confetti; Off: nothing; Reduce Motion: one bloom", () => {
    const subtle = plateCelebration(moment, homer, s, "subtle", false, 156);
    expect(subtle.length).toBe(1);
    expect(subtle[0]!.cue.effects).toEqual([{ kind: "sparks", rays: 8, length: 13, base: 3 }]);
    expect(plateCelebration(moment, homer, s, "off", false, 156)).toEqual([]);
    const still = plateCelebration(moment, homer, s, "full", true, 156);
    expect(still.length).toBe(1);
    expect(still[0]!.cue.effects).toEqual([{ kind: "bloom", radius: 22 }]);
  });
  it("inside the page's 10 s cooldown: sparks, no confetti", () => {
    const cooled = { ...moment, burst: false };
    expect(plateCelebration(cooled, homer, s, "full", false, 156).map((b) => b.cue.effects)).toEqual([[{ kind: "sparks", rays: 8, length: 13, base: 3 }]]);
  });
  it("a grand slam: three shells, all gold; another play's moment never bursts over this one", () => {
    const slam = { ...moment, accents: new Set(["grandSlam"] as const) };
    const slams = plateCelebration(slam, homer, s, "full", false, 156);
    expect(slams[0]!.cue.effects).toEqual([{ kind: "fireworks", shells: 3 }]);
    expect(slams.every((b) => b.cue.gold)).toBe(true);
    const other = { ...moment, id: "elsewhere" };
    expect(plateCelebration(other, homer, s, "full", false, 156)).toEqual([]);
  });
  it("a triple: TRIPLE across the top, with confetti off it, landing as he reaches third (sliding in)", () => {
    const triple = parse(plays, plays.findIndex((p) => idOf(p) === "4019080440811990057"), side, names)!;
    triple.kind = { type: "triple" };
    triple.runners = triple.runners.map((r) => (r.from === 0 ? { id: r.id, from: 0, end: { kind: "base", base: 3 } } : r));
    const t = script(triple);
    const m = { ...liveMoment({ id: triple.id, chart: "plate", tier: Tier.score, kind: "runScored", lead: "Run scores", detail: "", accents: ["triple"] }), burst: true };
    const bursts = plateCelebration(m, triple, t, "full", false, 156);
    expect(t.banner?.text).toBe("TRIPLE");
    expect(t.banner?.confetti).toBe(true);
    expect(bursts.length).toBe(1);
    expect(bursts[0]!.anchor).toEqual({ kind: "banner" });
    const reach = t.actors[9]!.moves.find((mv) => {
      const last = mv.path[mv.path.length - 1];
      return last != null && samePoint(last, Ballpark.base(3));
    })?.end;
    expect(Math.abs(t.banner!.at - (reach ?? 0))).toBeLessThan(0.001);
    expect(t.actors[9]!.slide).not.toBeNull();
  });
});
