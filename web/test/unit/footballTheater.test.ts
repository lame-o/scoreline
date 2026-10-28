/**
 * The football theater (FootballTheaterTests.swift), check by check, on the
 * same real game: Monday Night Football, DAL at PHI
 * (test/fixtures/mnf-dal-phi-plays.json, every core play as ESPN sent it,
 * copied from the Swift app's Tests/Fixtures). ESPN's plays parsed into
 * scenes (the kind, the spots read from the home team's goal line, the hole,
 * the depth and side, the downs, the flag), what's news, the choreography (a
 * pass comes down where it was caught, a run goes through the hole it names,
 * a field goal through the uprights), the broadcast camera, the stamp, and
 * one celebration per moment; and the Mac's polish: formations from the
 * text, the ball on its hash, the try as its own beat, the stamp's corner
 * kept clear, the pace.
 */
import { describe, expect, it } from "vitest";
import { footballPlay, type FootballTeams } from "../../src/data/liveFeeds/football";
import { CameraFrame } from "../../src/data/mlb/playCamera";
import { dress } from "../../src/data/mlb/theaterTeams";
import { fieldPoint, type FieldPoint } from "../../src/data/mlb/theaterField";
import { liveMoment, Tier, type LiveMoment } from "../../src/data/moments";
import { FootballScene, kindIs, parse } from "../../src/data/theater/footballScene";
import { FootballScript, footballStamp, Gridiron, type Role, type Team } from "../../src/data/theater/footballScript";
import { FootballCelebration, footballShown, FootballTheaterWatch, footballRest, footballTheaterState, spot, spotted } from "../../src/data/theater/footballTheater";
import { HOLD_MS } from "../../src/data/theater/theaterKit";
import { playerPose } from "../../src/features/game/football/theater/drawFootball";
import { fixture } from "./fixtures";
import { jointsBreak } from "./rigJoints";

const items = (fixture("mnf-dal-phi-plays.json") as { items: Record<string, unknown>[] }).items;
// DAL (6) visiting, the top team; PHI (21) at home.
const teams: FootballTeams = { topIsHome: false, topID: "6", bottomID: "21", homeAbbreviation: "PHI", awayAbbreviation: "DAL" };
const item = (suffix: string) => items.find((i) => String(i.id).endsWith(suffix));
const scene = (suffix: string): FootballScene | null => {
  const i = item(suffix);
  return i ? parse(i, teams) : null;
};
const script = (suffix: string): FootballScript | null => {
  const s = scene(suffix);
  return s ? FootballScript.play(s) : null;
};
const stamp = (s: FootballScene | null) => (s ? footballStamp(s).parts.map((p) => p.text).join(" ") : "nil");
const range = (from: number, to: number, step: number) => {
  const out: number[] = [];
  for (let t = from; t <= to + 1e-9; t += step) out.push(t);
  return out;
};

const scenes = items.flatMap((i) => parse(i, teams) ?? []);
const all = scenes.map((s) => FootballScript.play(s));

describe("every play", () => {
  it("every snap and kick in the game is a scene; timeouts, quarter ends and the coin toss aren't", () => {
    const admin = new Set(items.filter((i) => parse(i, teams) == null).map((i) => (i.type as { text?: string } | undefined)?.text ?? ""));
    expect(scenes.length).toBe(156);
    for (const a of admin) expect(["Coin Toss", "Official Timeout", "Timeout", "End Period", "End of Half", "Two-minute warning"]).toContain(a);
  });

  it("all 156 replay as what they were: none falls back to a generic replay", () => {
    expect(scenes.filter((s) => s.kind.type === "other").map((s) => s.text)).toEqual([]);
  });

  it("every snap's spot (from the home team's goal line) matches ESPN's yards to the end zone", () => {
    const yardsToEndzone = (i: Record<string, unknown>) => (i.start as { yardsToEndzone?: number } | undefined)?.yardsToEndzone;
    const spotted = items.filter((i) => {
      const s = parse(i, teams);
      return (yardsToEndzone(i) ?? 0) > 0 && s != null && s.kind.type !== "punt" && s.kind.type !== "kickoff";
    });
    const misread = spotted.filter((i) => Math.abs(parse(i, teams)!.from - (100 - (yardsToEndzone(i) ?? 0))) > 0.01);
    expect(spotted.length).toBeGreaterThan(100);
    expect(misread.map((i) => i.text)).toEqual([]);
  });

  it("…and where the drive chart draws it", () => {
    const charted = items.flatMap((i) => {
      const s = parse(i, teams);
      const d = footballPlay(i, teams);
      return s && d ? [{ s, d }] : [];
    });
    expect(charted.length).toBe(scenes.length);
    expect(charted.every(({ s, d }) => Math.abs((s.offense === "top" ? s.from : 100 - s.from) - d.startX) < 0.01)).toBe(true);
  });
});

describe("kinds and what the text adds", () => {
  it("a short pass right to the back, caught a yard past the line (12 gained, 11 after the catch), pushed out: a first down", () => {
    const short = scene("9274")!;
    expect(short.kind.type).toBe("pass");
    expect([short.lane, short.depth, short.air, short.yards, short.outOfBounds, short.position("receiver"), short.firstDown]).toEqual(["right", "short", 1, 12, true, "back", true]);
    expect([short.offense, short.from, short.to]).toEqual(["bottom", 25, 37]);
  });

  it("a deep pass right: caught 22 yards downfield, out at PHI 9 (DAL's 91)", () => {
    const deep = scene("2186")!;
    expect([deep.kind.type, deep.depth, deep.air, deep.to, deep.offense]).toEqual(["pass", "deep", 22, 91, "top"]);
  });

  it("a run through left tackle, 34 yards; the holes by name; a scramble", () => {
    const run = scene("3403")!;
    expect([run.kind.type, run.lane, run.gap, run.yards, run.position("rusher")]).toEqual(["rush", "left", "tackle", 34, "back"]);
    expect([scene("9493")?.gap, scene("9168")?.gap, scene("9780")?.gap]).toEqual(["guard", "end", "middle"]);
    expect(scene("1477")?.position("rusher")).toBe("quarterback");
    expect(scene("1477")?.kind.type).toBe("rush");
  });

  it("Pierce's 5-yard touchdown run through left tackle, PHI's points", () => {
    const td = scene("1152")!;
    expect([td.kind.type, td.scoring, td.from, td.to, td.scorer, td.gap]).toEqual(["rush", "touchdown", 95, 100, "bottom", "tackle"]);
  });

  it("a sack: 8 yards lost, down at the 9, by a lineman", () => {
    const sack = scene("3888")!;
    expect([sack.kind.type, sack.yards, sack.stopped, sack.position("sackedBy")]).toEqual(["sack", -8, 9, "defensiveLine"]);
  });

  it("a 55-yard field goal (the declined flag on it doesn't count)", () => {
    const fg = scene("9213")!;
    expect(kindIs(fg.kind, "fieldGoal", true)).toBe(true);
    expect([fg.kickYards, fg.scoring, fg.penalty]).toEqual([55, "fieldGoal", null]);
  });

  it("kicks: a punt downed at the 2, a touchback, a return", () => {
    const punt = scene("1812")!;
    expect([punt.kind.type, punt.kick, punt.turn, punt.kickYards, punt.flips]).toEqual(["punt", "downed", 98, 48, true]);
    const touchback = scene("1592")!;
    expect(touchback.kind.type).toBe("kickoff");
    expect(touchback.kick).toBe("touchback");
    expect(touchback.turn ?? 0).toBeGreaterThan(100);
    const kickoff = scene("0940")!;
    expect([kickoff.kick, kickoff.turn, kickoff.returnYards, kickoff.offense]).toEqual(["returned", 90, 25, "bottom"]);
  });

  it("an interception: picked off 2 yards past the line by a linebacker, returned to DAL's 34", () => {
    const pick = scene("3701")!;
    expect([pick.kind.type, pick.turn, pick.air, pick.to, pick.flips, pick.position("returner"), pick.lane, pick.depth]).toEqual(["interception", 70, 2, 66, true, "linebacker", "right", "short"]);
  });

  it("flags: before the snap, a flag's first down, a hold walked back", () => {
    const flag = scene("9361")!;
    expect(flag.kind.type).toBe("penalty");
    expect(flag.penalty).toEqual({ name: "Neutral Zone Infraction", yards: 5, noPlay: true });
    expect([flag.to, flag.firstDown]).toEqual([92, false]);
    expect([scene("9756")?.firstDown, scene("3169")?.firstDown, scene("3169")?.to]).toEqual([true, false, 8]);
  });

  it("fourth down, incomplete: a turnover on downs", () => {
    const s = scene("3933")!;
    expect([s.onDowns, s.flips, s.kind.type]).toEqual([true, true, "incomplete"]);
  });

  it("a fumble return the review reversed: replayed as the incompletion it became", () => {
    const s = scene("2976")!;
    expect([s.kind.type, s.lane, s.depth, s.flips]).toEqual(["incomplete", "left", "short", false]);
  });

  it("returns with a hold on them: stopped, then walked back", () => {
    const kickFlag = scene("9423")!;
    expect([kickFlag.stopped, kickFlag.to, kickFlag.penalty?.noPlay]).toEqual([68, 82, false]);
    expect([scene("1916")?.kick, scene("1916")?.stopped, scene("1916")?.to]).toEqual(["downed", 49, 59]);
  });

  it("a touchdown pass with a two-point try after it: still a deep pass left", () => {
    const s = scene("3048")!;
    expect([s.scoring, s.depth, s.lane]).toEqual(["touchdown", "deep", "left"]);
  });
});

describe("stamps", () => {
  it("+12 1ST DOWN, −8 SACK, INC, FG 55 ✓, +5 TD, PUNT 48, INT, +5 FLAG, KICK 65, +25 RETURN", () => {
    const cases: [string, string, string][] = [
      ["9274", "+12 1ST DOWN", "Short right to Barkley"],
      ["3888", "−8 SACK", "By Williams"],
      ["9145", "INC", "Deep left to Lamb"],
      ["9213", "FG 55 ✓", "Aubrey"],
      ["1152", "+5 TD", "Pierce, left tackle"],
      ["1812", "PUNT 48", "Downed"],
      ["3701", "INT", "Overshown · 4 yd return"],
      ["9361", "+5 FLAG", "Neutral Zone Infraction · No play"],
      ["1592", "KICK 65", "Touchback"],
      ["0940", "+25 RETURN", "Mingo"],
    ];
    for (const [id, code, title] of cases) {
      const s = scene(id)!;
      expect([id, stamp(s), footballStamp(s).title]).toEqual([id, code, title]);
    }
  });

  it("…a score in the team's color, a sack in red, a flag in yellow", () => {
    expect(footballStamp(scene("9213")!).tone).toBe("score");
    expect(footballStamp(scene("3888")!).tone).toBe("loss");
    expect(footballStamp(scene("9361")!).tone).toBe("flag");
  });
});

describe("graceful with what it doesn't know", () => {
  const entry = (type: string, text: string, from = 40, to = 40, extra: Record<string, unknown> = {}) => ({
    id: `x${type}`,
    type: { text: type },
    text,
    statYardage: Math.trunc(to - from),
    start: { yardLine: from, down: 1, distance: 10, team: { $ref: "/teams/21" } },
    end: { yardLine: to, down: 2, distance: 10, team: { $ref: "/teams/21" } },
    ...extra,
  });

  it("an unknown play still replays: the ball from its spot to where it ended", () => {
    const odd = parse(entry("Brand New Play", "Something new happened.", 40, 46), teams)!;
    expect(odd.kind.type).toBe("other");
    expect(FootballScript.play(odd).duration).toBeGreaterThan(2);
  });

  it("a play with no team on it is left alone", () => {
    expect(parse({ id: "y", type: { text: "Rush" }, text: "", start: { yardLine: 40 }, end: { yardLine: 44 } }, teams)).toBeNull();
  });

  it("a kneel and a spike, from the text (they share a type with runs and incompletions)", () => {
    const kneel = parse(entry("Rush", "T.McKee kneels to PHI 39 for -1 yards.", 40, 39), teams)!;
    const spike = parse(entry("Pass Incompletion", "T.McKee spiked the ball to stop the clock."), teams)!;
    expect([kneel.kind.type, spike.kind.type, stamp(kneel), stamp(spike)]).toEqual(["kneel", "spike", "−1 KNEEL", "INC SPIKE"]);
  });

  it("a missed field goal: no good, wide right, FG 52 ✗", () => {
    const missed = parse(entry("Field Goal Missed", "J.Elliott 52 yard field goal is No Good, Wide Right, Center-R.Underwood.", 65, 72), teams)!;
    expect(kindIs(missed.kind, "fieldGoal", false)).toBe(true);
    expect([missed.miss, stamp(missed)]).toEqual(["wideRight", "FG 52 ✗"]);
  });
});

describe("what's news", () => {
  const deep = scene("2186")!;
  const short = scene("9274")!;
  const at = deep.wallclock!;
  it("a page opened ten minutes after a play shows it as it ended; one 25 s ago replays", () => {
    const opened = footballTheaterState(deep, { play: null, news: false }, false, at + 600_000);
    expect([opened.play?.id, opened.news]).toEqual([deep.id, false]);
    expect(footballTheaterState(deep, { play: null, news: false }, false, at + 25_000).news).toBe(true);
  });
  it("a play that arrives while the page is open is news; one already showing stays what it was", () => {
    expect(footballTheaterState(deep, { play: short, news: false }, true, Number.MAX_SAFE_INTEGER).news).toBe(true);
    expect(footballTheaterState(deep, { play: deep, news: false }, true, Number.MAX_SAFE_INTEGER).news).toBe(false);
  });
  it("beside the lane: the newest snap, history on the first look, news after; a timeout after it changes nothing", () => {
    const watch = new FootballTheaterWatch();
    const upTo = (suffix: string) => items.slice(0, items.findIndex((i) => String(i.id).endsWith(suffix)) + 1);
    expect(watch.update(upTo("2186"), teams, false, Number.MAX_SAFE_INTEGER)).toBe(true);
    expect([watch.state.play?.id, watch.state.news]).toEqual([deep.id, false]);
    const next = items.findIndex((i) => String(i.id).endsWith("2186")) + 1;
    const after = items.slice(0, next + 1);
    expect(watch.update(after, teams, true, Number.MAX_SAFE_INTEGER)).toBe(parse(items[next]!, teams) != null);
    if (parse(items[next]!, teams)) expect(watch.state.news).toBe(true);
    // The same entries again (a new list, the same objects): nothing changes.
    expect(watch.update([...after], teams, true)).toBe(false);
    const timeout = { id: "t", sequenceNumber: "99999999", type: { text: "Timeout" }, start: { yardLine: 40 }, end: { yardLine: 40 } };
    expect(watch.update([...after, timeout], teams, true)).toBe(false);
  });
});

describe("choreography", () => {
  const longFlight = (s: FootballScript) => s.flights.find((f) => f.start > 1 && f.end - f.start > 0.3);
  const runnerOf = (s: FootballScript) => s.players.findIndex((_, i) => s.legs.some((l) => l.hand.kind === "carry" && l.hand.player === i && !Number.isFinite(l.until)));

  it("a deep pass comes down 22 yards downfield, in the receiver's hands, and he runs out of bounds at the 9", () => {
    const s = script("2186")!;
    const play = scene("2186")!;
    const pass = longFlight(s)!;
    expect(Math.abs(pass.to.y - Gridiron.y(play.from + 22))).toBeLessThan(0.5);
    const receiver = s.players.findIndex((p) => p.actions.some((a) => a.kind === "catchHigh" || a.kind === "catchChest"));
    const hands = s.players[receiver]!.position(pass.end);
    expect(Math.hypot(hands.x - pass.to.x, hands.y - pass.to.y)).toBeLessThan(2);
    expect(Math.abs(s.end!.y - Gridiron.y(91))).toBeLessThan(0.5);
    expect(s.end!.x).toBeGreaterThan(Gridiron.half);
  });

  it("a short pass with yards after the catch: caught 4 past the line, run on to the 52", () => {
    const s = script("2403")!;
    expect(Math.abs(longFlight(s)!.to.y - Gridiron.y(33 + 4))).toBeLessThan(0.5);
    expect(Math.abs(s.end!.y - Gridiron.y(52))).toBeLessThan(0.5);
  });

  it("a run through left tackle crosses the line between the left guard and the end, and is brought down at the 25 (DAL's 75)", () => {
    const s = script("3403")!;
    const line = Gridiron.y(scene("3403")!.from);
    const runner = runnerOf(s);
    const crossing = range(0, s.settle, 1 / 120).find((t) => s.players[runner]!.position(t).y >= line);
    const p = s.players[runner]!.position(crossing!);
    expect(p.x).toBeLessThan(-9);
    expect(p.x).toBeGreaterThan(-18);
    expect(Math.abs(s.end!.y - Gridiron.y(75))).toBeLessThan(0.5);
    expect(s.flashes.some((f) => f.beat === "hit")).toBe(true);
  });

  it("a touchdown: into the end zone, the banner as the ball crosses the goal line, both arms up", () => {
    const s = script("1152")!;
    expect(s.end!.y).toBeGreaterThan(300);
    expect(s.score!).toBeLessThan(s.stamp);
    expect(s.banner?.text).toBe("TOUCHDOWN");
    expect(s.banner?.at).toBe(s.score);
    expect(s.players.some((p) => p.holds.some((h) => h.kind === "touchdown"))).toBe(true);
  });

  it("a sack: the quarterback taken down at the 9, behind the line", () => {
    const s = script("3888")!;
    const qb = s.players.findIndex((p) => p.role === "quarterback");
    const hit = s.players[qb]!.holds.find((h) => h.kind === "down")!;
    expect(Math.abs(s.players[qb]!.position(hit.from).y - Gridiron.y(9))).toBeLessThan(0.5);
    expect(s.players.some((p) => p.team === "defense" && p.actions.some((a) => a.kind === "tackle"))).toBe(true);
  });

  const crossing = (s: FootballScript): FieldPoint | null => {
    const kick = s.flights.find((f) => f.end - f.start > 0.6);
    if (!kick) return null;
    const t = range(kick.start, kick.end, 1 / 600).find((u) => kick.point(u).y >= Gridiron.backLine);
    return t != null ? kick.point(t) : null;
  };

  it("a field goal, shot from behind the kicker: through the uprights, over the bar, and the ball is put away", () => {
    const s = script("9213")!;
    const through = crossing(s)!;
    expect(s.yaw).toBe(0);
    expect(Math.abs(through.x)).toBeLessThan(Gridiron.upright);
    expect(through.z).toBeGreaterThan(Gridiron.crossbar);
    expect(s.banner?.text).toBe("FIELD GOAL");
    expect(s.score).not.toBeNull();
    expect(s.ball(Infinity)).toBeNull();
  });

  it("a miss wide right: past the right upright, NO GOOD", () => {
    const missed = parse(
      {
        id: "miss",
        type: { text: "Field Goal Missed" },
        text: "J.Elliott 52 yard field goal is No Good, Wide Right, Center-R.Underwood.",
        statYardage: 7,
        start: { yardLine: 65, down: 1, distance: 10, team: { $ref: "/teams/21" } },
        end: { yardLine: 72, down: 2, distance: 10, team: { $ref: "/teams/21" } },
      },
      teams,
    )!;
    const s = FootballScript.play(missed);
    expect(crossing(s)!.x).toBeGreaterThan(Gridiron.upright);
    expect(s.banner?.text).toBe("NO GOOD");
  });

  it("a punt: high and long, downed at the 2 by the coverage; the new lines point the other way", () => {
    const s = script("1812")!;
    expect(Math.abs(s.end!.y - Gridiron.y(98))).toBeLessThan(0.5);
    expect(s.flights.some((f) => f.end - f.start > 1.2)).toBe(true);
    expect(s.players.some((p) => p.actions.some((a) => a.kind === "scoop"))).toBe(true);
    expect(s.next.gain!).toBeLessThan(s.next.scrimmage ?? 0);
  });

  it("a kickoff into the end zone (and no line of scrimmage on a kickoff)", () => {
    const s = script("1592")!;
    expect(s.flights.some((f) => f.to.y > 300)).toBe(true);
    expect(s.lines.scrimmage).toBeNull();
  });

  it("an interception: a defender catches it, INTERCEPTION across the top, the lines turn round", () => {
    const s = script("3701")!;
    expect(s.players.some((p) => p.team === "defense" && p.actions.some((a) => a.kind === "catchChest"))).toBe(true);
    expect(s.banner?.text).toBe("INTERCEPTION");
    expect(s.banner?.tone.kind).toBe("neutral");
    expect(s.next.gain!).toBeLessThan(s.next.scrimmage ?? 0);
  });

  it("a flag: thrown in, then 5 yards walked off, then the stamp; a return, then the hold's 10 yards walked back", () => {
    const s = script("9361")!;
    expect([s.march!.from, s.march!.to]).toEqual([Gridiron.y(87), Gridiron.y(92)]);
    expect(s.flag!.lands).toBeLessThan(s.march!.start);
    expect(s.stamp).toBeGreaterThan(s.march!.end);
    const r = script("9423")!;
    expect([r.march!.from, r.march!.to]).toEqual([Gridiron.y(68), Gridiron.y(82)]);
    expect(r.flag).not.toBeNull();
  });

  it("every play's players and ball stay finite, the ball never under the grass", () => {
    const bad = all.filter((s) =>
      range(0, s.duration, 0.1).some((t) => {
        const players = s.players.every((p) => {
          const q = p.position(t);
          return Number.isFinite(q.x) && Number.isFinite(q.y);
        });
        const b = s.ball(t);
        return !players || (b != null && !(Number.isFinite(b.x) && Number.isFinite(b.y) && b.z >= -0.01));
      }),
    );
    expect(bad.length).toBe(0);
  });

  it("in every snap of the game, knees and elbows bend only their own way, never past folded (the stances, the poses and every blend between them)", { timeout: 60_000 }, () => {
    const broken = scenes.flatMap((scene, k) => {
      const s = all[k]!;
      const where = jointsBreak(s.duration, s.players.length, (i, t) => playerPose(s, s.players[i]!, i, t, s.players[i]!.position(t), 1.1 / 8.5)[0]);
      return where ? [`${scene.text.slice(0, 30)}: ${where}`] : [];
    });
    expect(broken.slice(0, 3)).toEqual([]);
  });

  it("every replay runs 3–10 s, settle included, and its stamp lands before the field settles", () => {
    const lengths = all.map((s) => s.duration);
    expect(Math.min(...lengths)).toBeGreaterThan(3);
    expect(Math.max(...lengths)).toBeLessThan(10);
    expect(all.every((s) => Number.isFinite(s.stamp) && s.stamp < s.settle)).toBe(true);
  });

  it("after a gain both teams jog back into their places at the new line, the ball spotted there", () => {
    const s = script("9274")!;
    for (const p of s.players) {
      const q = p.position(Infinity);
      expect(Math.abs(q.y - (p.at.y + Gridiron.y(12)))).toBeLessThan(0.01);
      expect(Math.abs(q.x - p.at.x)).toBeLessThan(0.01);
    }
    expect(Math.abs(s.ball(Infinity)!.y - Gridiron.y(37))).toBeLessThan(0.01);
  });
});

describe("camera", () => {
  const view = (p: FieldPoint, c: CameraFrame, yaw: number) => {
    const v = Gridiron.viewField(p, yaw);
    return { x: 0.5 + (v.x - c.x) / (c.span * CameraFrame.aspect), y: 0.5 + (v.y * 0.5 + v.z * 0.82 - c.y) / c.span };
  };
  const inView = (p: FieldPoint, c: CameraFrame, yaw: number, slack = 0) => {
    const v = view(p, c, yaw);
    return v.x >= -slack && v.x <= 1 + slack && v.y >= -slack && v.y <= 1 + slack;
  };

  it("the snap: behind the offense, all 22 in frame, the defense beyond them", () => {
    const s = script("2186")!;
    const open = s.camera.frame(0);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const offense = s.players.filter((p) => p.team === "offense").map((p) => view(fieldPoint(p.at), open, s.yaw).y);
    const defense = s.players.filter((p) => p.team === "defense").map((p) => view(fieldPoint(p.at), open, s.yaw).y);
    expect(s.players.every((p) => inView(fieldPoint(p.at), open, s.yaw, 0.02))).toBe(true);
    expect(mean(offense)).toBeLessThan(mean(defense));
  });

  it("a throw: the camera keeps the ball in frame", () => {
    const s = script("2186")!;
    const pass = s.flights.find((f) => f.start > 1 && f.end - f.start > 0.3)!;
    const frames = range(pass.start, pass.end, 1 / 60);
    const seen = frames.filter((t) => inView(pass.point(t), s.camera.frame(t), s.yaw, 0.03)).length;
    expect(seen / frames.length).toBeGreaterThan(0.9);
  });

  it("the end: the spot and the new line in frame, then it settles exactly on the rest framing", () => {
    const s = script("2186")!;
    const end = s.camera.frame(s.settle);
    expect(inView(s.end!, end, s.yaw)).toBe(true);
    expect(inView({ x: s.end!.x, y: s.next.scrimmage!, z: 0 }, end, s.yaw)).toBe(true);
    expect(CameraFrame.equal(s.camera.frame(s.duration), s.camera.rest)).toBe(true);
    expect(CameraFrame.equal(s.camera.frame(Infinity), s.camera.rest)).toBe(true);
  });

  it("a run: the camera follows the ball carrier 34 yards", () => {
    const s = script("3403")!;
    const runner = s.players.findIndex((_, i) => s.legs.some((l) => l.hand.kind === "carry" && l.hand.player === i && !Number.isFinite(l.until)));
    const carrying = range(1.2, s.stamp, 1 / 30);
    const seen = carrying.filter((t) => inView(fieldPoint(s.players[runner]!.position(t)), s.camera.frame(t), s.yaw, 0.02)).length;
    expect(seen / carrying.length).toBeGreaterThan(0.95);
  });

  it("the camera never outruns its caps on any play: pans ≤ 1.4 view-heights/s, zooms in ≤ ×3/s, out ≤ ×9/s", () => {
    let pan = 0;
    let closer = 0;
    let wider = 0;
    for (const s of all) {
      let previous = s.camera.frame(0);
      for (let i = 1; i <= Math.trunc(s.duration * 60); i++) {
        const now = s.camera.frame(i / 60);
        const p = (Math.hypot(now.x - previous.x, now.y - previous.y) * 60) / now.span;
        const z = Math.log(now.span / previous.span) * 60;
        pan = Math.max(pan, p);
        closer = Math.max(closer, -z);
        wider = Math.max(wider, z);
        previous = now;
      }
    }
    expect(pan).toBeLessThanOrEqual(1.5);
    expect(closer).toBeLessThanOrEqual(1.2);
    expect(wider).toBeLessThanOrEqual(2.3);
  });

  it("between plays: the offense set at its line, the camera at rest on it", () => {
    const rest = footballRest({ downDistance: null, ballX: 70, lineToGainX: 80, possession: "bottom", redZone: false, topTimeouts: null, bottomTimeouts: null, lastPlay: null })!;
    expect(rest.offense).toBe("bottom");
    expect(rest.rest).toEqual({ yard: 30, gain: 20 });
    const s = FootballScript.rest({ yard: 30, gain: 40 });
    expect(s.players.length).toBe(22);
    expect(s.lines).toEqual({ scrimmage: Gridiron.y(30), gain: Gridiron.y(40) });
    expect(s.players.every((p) => inView(fieldPoint(p.at), s.camera.frame(Infinity), s.yaw, 0.02))).toBe(true);
  });
});

describe("one celebration per moment", () => {
  const touchdown = scene("1152")!;
  const tdScript = script("1152")!;
  const tdMoment = (accents: ("decisive" | "bigPlay")[] = []): LiveMoment => ({
    ...liveMoment({ id: touchdown.id, chart: "field", tier: Tier.score, kind: "touchdown", lead: "Touchdown", detail: touchdown.text, side: "bottom", accents }),
    burst: true,
  });

  it("a touchdown's burst: the theater's when it's on the page, else the drive chart's", () => {
    expect(FootballCelebration.driveChartBursts(true)).toBe(false);
    expect(FootballCelebration.driveChartBursts(false)).toBe(true);
  });

  it("a touchdown: two shells over the goal line as the ball crosses it, confetti off the banner", () => {
    const full = FootballCelebration.theater(tdMoment(), touchdown, tdScript, "full", false, 306);
    const fireworks = full.find((b) => b.anchor.kind === "field")!;
    expect(fireworks.cue.effects).toEqual([{ kind: "fireworks", shells: 2 }]);
    expect(Math.abs(fireworks.at + fireworks.cue.delay - tdScript.score!)).toBeLessThan(0.001);
    expect(full.some((b) => b.anchor.kind === "banner" && b.cue.effects.some((e) => e.kind === "confetti"))).toBe(true);
  });

  it("Subtle: sparks, no confetti; Off: nothing; Reduce Motion: one bloom; the cooldown: sparks", () => {
    const subtle = FootballCelebration.theater(tdMoment(), touchdown, tdScript, "subtle", false, 306);
    expect(subtle.map((b) => b.cue.effects)).toEqual([[{ kind: "sparks", rays: 8, length: 13, base: 3 }]]);
    expect(FootballCelebration.theater(tdMoment(), touchdown, tdScript, "off", false, 306)).toEqual([]);
    const still = FootballCelebration.theater(tdMoment(), touchdown, tdScript, "full", true, 306);
    expect(still.map((b) => b.cue.effects)).toEqual([[{ kind: "bloom", radius: 22 }]]);
    const cooled = { ...tdMoment(), burst: false };
    expect(FootballCelebration.theater(cooled, touchdown, tdScript, "full", false, 306).map((b) => b.cue.effects)).toEqual([[{ kind: "sparks", rays: 8, length: 13, base: 3 }]]);
  });

  it("a game-winner: all gold; another play's moment never bursts over this one", () => {
    expect(FootballCelebration.theater(tdMoment(["decisive"]), touchdown, tdScript, "full", false, 306).every((b) => b.cue.gold)).toBe(true);
    const other = { ...liveMoment({ id: "elsewhere", chart: "field", tier: Tier.score, kind: "touchdown", lead: "Touchdown", detail: "" }), burst: true };
    expect(FootballCelebration.theater(other, touchdown, tdScript, "full", false, 306)).toEqual([]);
  });

  it("a pick six: PICK SIX, the most the theater does (three shells and confetti), for the defense", () => {
    const six = scene("3701")!.clone();
    six.scoring = "touchdown";
    six.to = 0;
    const s = FootballScript.play(six);
    const moment = { ...liveMoment({ id: six.id, chart: "field", tier: Tier.score, kind: "touchdown", lead: "Touchdown", detail: "", side: "top" }), burst: true };
    const bursts = FootballCelebration.theater(moment, six, s, "full", false, 306);
    expect(s.banner?.text).toBe("PICK SIX");
    expect(six.scorer).toBe("top");
    expect(bursts[0]?.cue.effects).toEqual([{ kind: "fireworks", shells: 3 }]);
    expect(bursts.length).toBe(2);
  });

  it("a field goal: a small pop at the crossbar", () => {
    const play = scene("9213")!;
    const s = script("9213")!;
    const moment = liveMoment({ id: play.id, chart: "field", tier: Tier.score, kind: "fieldGoal", lead: "Field goal", detail: "", side: "top" });
    const pop = FootballCelebration.theater(moment, play, s, "full", false, 306);
    expect(pop.length).toBe(1);
    expect(pop[0]!.cue.effects).toEqual([{ kind: "sparks", rays: 6, length: 16, base: 3 }]);
    expect(pop[0]!.anchor).toEqual({ kind: "field", point: s.scorePoint });
  });

  it("INTERCEPTION, TURNOVER ON DOWNS: the banner alone", () => {
    for (const [id, banner] of [
      ["3701", "INTERCEPTION"],
      ["3933", "TURNOVER ON DOWNS"],
    ] as const) {
      const play = scene(id)!;
      const s = script(id)!;
      const moment = liveMoment({ id: play.id, chart: "field", tier: Tier.swing, kind: "turnover", lead: "", detail: "" });
      expect(FootballCelebration.theater(moment, play, s, "full", false, 306)).toEqual([]);
      expect(s.banner?.text).toBe(banner);
      expect(s.banner?.confetti).toBe(false);
    }
  });
});

// The same entries the Swift tests make up for what the game doesn't have.
const entry = (type: string, text: string, from = 40, to = 40) => ({
  id: `x${type}`,
  type: { text: type },
  text,
  statYardage: Math.trunc(to - from),
  start: { yardLine: from, down: 1, distance: 10, team: { $ref: "/teams/21" } },
  end: { yardLine: to, down: 2, distance: 10, team: { $ref: "/teams/21" } },
});

const lineup = (s: FootballScript, team: Team, ...roles: Role[]) => s.players.filter((p) => p.team === team && roles.includes(p.role)).map((p) => p.at);

const crossingOf = (s: FootballScript): FieldPoint | null => {
  const kick = s.flights.find((f) => f.end - f.start > 0.6);
  if (!kick) return null;
  const t = range(kick.start, kick.end, 1 / 600).find((u) => kick.point(u).y >= Gridiron.backLine);
  return t != null ? kick.point(t) : null;
};

describe("formations", () => {
  it("(Shotgun): the quarterback five yards deep, three wide, the strength to the side the pass went; the defense in its nickel", () => {
    const deep = scene("2186")!;
    const gun = script("2186")!;
    const line = Gridiron.y(deep.from);
    expect([deep.shotgun, deep.formation]).toEqual([true, "base"]);
    expect(Math.abs(lineup(gun, "offense", "quarterback")[0]!.y - (line - 15))).toBeLessThan(0.01);
    expect(lineup(gun, "defense", "corner").length).toBe(3);
    expect(lineup(gun, "offense", "tightEnd", "receiver").filter((p) => p.x > 0).length).toBe(3);
  });

  it("an extra lineman reported in as eligible: a heavy set, six on the line, no one wide, under center; eight in the box against it", () => {
    const run = scene("3403")!;
    const heavy = script("3403")!;
    const under = Gridiron.y(run.from);
    expect(run.formation).toBe("heavy");
    expect(lineup(heavy, "offense", "line").length).toBe(6);
    expect(lineup(heavy, "offense", "receiver")).toEqual([]);
    expect(Math.abs(lineup(heavy, "offense", "quarterback")[0]!.y - under)).toBeLessThan(8);
    expect(heavy.players.filter((p) => p.team === "defense" && Math.abs(p.at.x) < 26 && p.at.y - under < 30).length).toBeGreaterThanOrEqual(8);
  });

  it("a run under center: the I (a fullback in front of the back), the tight end to the side it went; base defense", () => {
    const td = script("1152")!;
    const backs = lineup(td, "offense", "back");
    expect([scene("1152")!.formation, scene("1152")!.shotgun]).toEqual(["base", false]);
    expect(backs.length).toBe(2);
    expect(backs.every((b) => Math.abs(b.x) < 0.01)).toBe(true);
    expect(lineup(td, "defense", "backer").length).toBe(3);
    expect(lineup(td, "offense", "tightEnd")[0]!.x).toBeLessThan(0);
  });

  it("the kneel: the victory formation, three backs behind the quarterback", () => {
    const k = parse(entry("Rush", "T.McKee kneels to PHI 39 for -1 yards.", 40, 39), teams)!;
    const s = FootballScript.play(k);
    const qb = lineup(s, "offense", "quarterback")[0]!;
    expect(k.formation).toBe("victory");
    expect(lineup(s, "offense", "back").length).toBe(3);
    expect(lineup(s, "offense", "receiver")).toEqual([]);
    expect(lineup(s, "offense", "back").every((b) => b.y < qb.y)).toBe(true);
  });

  it("(Empty): nobody behind the quarterback but him, dime against it; (Bunch): three receivers within a few yards, on the side it went", () => {
    const e = parse(entry("Pass Reception", "(Shotgun, Empty) T.McKee pass short right to D.Smith to PHI 46 for 6 yards (D.Bland).", 40, 46), teams)!;
    const b = parse(entry("Pass Reception", "(Shotgun, Bunch) T.McKee pass short left to A.Brown to PHI 45 for 5 yards (D.Bland).", 40, 45), teams)!;
    const empty = FootballScript.play(e);
    const bunch = FootballScript.play(b);
    const line = Gridiron.y(40);
    expect(e.formation).toBe("empty");
    expect(empty.players.filter((p) => p.team === "offense" && p.role !== "quarterback" && p.at.y < line - 6)).toEqual([]);
    expect(lineup(empty, "defense", "corner").length).toBe(4);
    const trio = lineup(bunch, "offense", "tightEnd", "receiver").filter((p) => p.x < -20);
    expect(b.formation).toBe("bunch");
    expect(trio.length).toBe(3);
    expect(Math.max(...trio.map((p) => p.x)) - Math.min(...trio.map((p) => p.x))).toBeLessThan(10);
  });
});

describe("the hash", () => {
  const onHashes = spot(scenes, null);
  const pairs = onHashes.slice(1).map((next, i) => [onHashes[i]!, next] as const);

  it("the first snap with nothing before it: in the middle; after a pass pushed out on the right, the right hash; as the feed spots it", () => {
    expect(onHashes[0]!.hash).toBe("middle");
    const i = onHashes.findIndex((s) => s.id.endsWith("9274"));
    expect(onHashes[i + 1]!.hash).toBe("right");
    const j = items.findIndex((x) => String(x.id).endsWith("9304"));
    expect(spotted(items.slice(0, j + 1), teams)?.hash).toBe("right");
  });

  it("after an incompletion: the same spot; after a score: from the middle", () => {
    const incompletions = pairs.filter(([a]) => a.kind.type === "incomplete" && !a.flips);
    expect(incompletions.length).toBeGreaterThan(0);
    expect(incompletions.every(([a, b]) => b.hash === a.hash)).toBe(true);
    const afterScores = pairs.filter(([a]) => a.scoring != null);
    expect(afterScores.length).toBeGreaterThan(0);
    expect(afterScores.every(([, b]) => b.hash === "middle")).toBe(true);
  });

  it("when the ball changes hands, the hash turns round with the offense", () => {
    const turned = new FootballScene("t", { type: "pass" }, "top", 30, 40);
    turned.lane = "left";
    turned.flips = true;
    expect(turned.nextHash).toBe("right");
    turned.flips = false;
    expect(turned.nextHash).toBe("left");
  });

  it("the ball snapped from its hash, everyone inside the sidelines, the formation round it", { timeout: 30_000 }, () => {
    const hashed = onHashes.map((s) => FootballScript.play(s));
    const onHash = onHashes.map((s, i) => [s, hashed[i]!] as const).filter(([s]) => s.kind.type !== "kickoff" && s.hash !== "middle");
    expect(onHash.length).toBeGreaterThan(30);
    expect(onHash.every(([s, script]) => Math.abs((script.ball(0)?.x ?? Infinity) - Gridiron.spot(s.hash)) < 0.01)).toBe(true);
    expect(hashed.every((s) => s.players.every((p) => Math.abs(p.at.x) < Gridiron.half))).toBe(true);
    const i = onHashes.findIndex((s) => s.id.endsWith("9274"));
    const center = hashed[i + 1]!.players.find((p) => p.role === "line" && p.team === "offense")!.at;
    expect(Math.abs(center.x - Gridiron.spot("right"))).toBeLessThan(0.01);
  });

  it("a field goal from the left hash still splits the uprights", () => {
    const kick = scene("9213")!.clone();
    kick.hash = "left";
    const s = FootballScript.play(kick);
    const through = crossingOf(s)!;
    expect(Math.abs(through.x)).toBeLessThan(Gridiron.upright);
    expect(through.z).toBeGreaterThan(Gridiron.crossbar);
    expect(s.ball(0)!.x).toBeLessThan(-5);
  });

  it("beside the lane: the snap showing keeps its hash; the next one is spotted from it", () => {
    const watch = new FootballTheaterWatch();
    const i = items.findIndex((x) => String(x.id).endsWith("9274"));
    watch.update(items.slice(0, i + 1), teams, false, Number.MAX_SAFE_INTEGER);
    const shown = watch.state.play!;
    let k = i + 1;
    while (k < items.length && !parse(items[k]!, teams)) k++;
    watch.update(items.slice(0, k + 1), teams, true, Number.MAX_SAFE_INTEGER);
    expect(watch.state.play!.hash).toBe(shown.nextHash);
  });
});

describe("the try", () => {
  it("a touchdown's extra point, from its entry: a kick from the 15 by the team that scored, its own short beat, XP ✓ by Elliott", () => {
    const play = scene("1152")!;
    const attempt = play.conversion!;
    const s = FootballScript.play(attempt);
    expect(play.attempt).toEqual({ kind: "kick", good: true, text: "J.Elliott extra point is GOOD, Center-R.Underwood, Holder-B.Mann." });
    expect(kindIs(attempt.kind, "extraPoint", true)).toBe(true);
    expect([attempt.pointAfter, attempt.from, attempt.id, attempt.offense]).toEqual(["kick", 85, `${play.id}-try`, "bottom"]);
    const through = crossingOf(s)!;
    expect(s.yaw).toBe(0);
    expect(Math.abs(through.x)).toBeLessThan(Gridiron.upright);
    expect(through.z).toBeGreaterThan(Gridiron.crossbar);
    expect(s.banner).toBeNull();
    expect([stamp(attempt), footballStamp(attempt).title]).toEqual(["XP ✓", "Elliott"]);
    expect(s.duration).toBeLessThan(3.6);
    expect(s.duration).toBeLessThan(script("9213")!.duration);
  });

  it("a two-point try: Prescott rushes left guard from the 2, and it succeeds, keeping it himself into the end zone: 2PT ✓", () => {
    const two = scene("3048")!;
    const attempt = two.conversion!;
    const s = FootballScript.play(attempt);
    expect([two.attempt?.kind, two.attempt?.good, attempt.kind.type, attempt.scoring, attempt.lane, attempt.gap, attempt.from]).toEqual(["rush", true, "rush", "touchdown", "left", "guard", 98]);
    const carrier = s.players.findIndex((_, i) => s.legs.some((l) => l.hand.kind === "carry" && l.hand.player === i && !Number.isFinite(l.until)));
    expect(s.players[carrier]!.role).toBe("quarterback");
    expect(s.end!.y).toBeGreaterThan(300);
    expect([stamp(attempt), footballStamp(attempt).title, s.banner]).toEqual(["2PT ✓", "Prescott, left guard", null]);
  });

  it("a try logged as its own entry replays as one: XP ✓ from the 15, a failed two-point pass 2PT ✗; a touchdown without its try has none", () => {
    const separate = parse(entry("Extra Point Good", "C.Dicker extra point is GOOD, Center-C.Johnson, Holder-B.Mann.", 0, 0), teams)!;
    const failed = parse(entry("Two Point Pass", "TWO-POINT CONVERSION ATTEMPT. J.Hurts pass to D.Smith is incomplete. ATTEMPT FAILS.", 98, 98), teams)!;
    expect([separate.pointAfter, separate.from, stamp(separate)]).toEqual(["kick", 85, "XP ✓"]);
    expect([failed.pointAfter, failed.kind.type, stamp(failed), FootballScript.play(failed).banner]).toEqual(["pass", "incomplete", "2PT ✗", null]);
    const bare = scene("1152")!.clone();
    bare.attempt = null;
    expect(bare.conversion).toBeNull();
  });
});

describe("the stamp's corner and the pace", () => {
  it("once the stamp has landed nobody stands in its corner: not the pile as the play holds, not at rest; the move to rest rarely brushes it", () => {
    let hold = { crowded: 0, frames: 0 };
    let toRest = { crowded: 0, frames: 0 };
    let atRest = 0;
    for (const s of all) {
      if (!Number.isFinite(s.stamp) || !(s.corner.width > 0)) continue;
      const crowded = (t: number) => {
        const c = s.camera.frame(t);
        return s.players.some((p) => {
          if (!(p.opacity(t) > 0.5)) return false;
          // His figure: a couple of feet either side of him, from his feet up.
          const v = Gridiron.view(p.position(t), s.yaw);
          const left = 0.5 + (v.x - 2 - c.x) / (c.span * CameraFrame.aspect);
          const right = 0.5 + (v.x + 2 - c.x) / (c.span * CameraFrame.aspect);
          const low = 0.5 + (v.y * 0.5 - c.y) / c.span;
          const high = low + 9 / c.span;
          // (The corner as measured, less the margin it keeps beside the type.)
          return right > 0 && left < s.corner.width - 0.03 && high > 0 && low < s.corner.height;
        });
      };
      for (const t of range(s.stamp + 0.4, s.settle, 0.05)) {
        hold = { crowded: hold.crowded + (crowded(t) ? 1 : 0), frames: hold.frames + 1 };
      }
      for (const t of range(s.settle, s.duration, 0.05)) {
        toRest = { crowded: toRest.crowded + (crowded(t) ? 1 : 0), frames: toRest.frames + 1 };
      }
      if (crowded(Infinity)) atRest++;
    }
    expect(atRest).toBe(0);
    expect(hold.crowded / Math.max(hold.frames, 1)).toBeLessThan(0.005);
    expect(toRest.crowded / Math.max(toRest.frames, 1)).toBeLessThan(0.03);
  });

  it("the replays are brisk: half of them done in under 4.6 s", () => {
    const lengths = all.map((s) => s.duration).sort((a, b) => a - b);
    expect(lengths[Math.trunc(lengths.length / 2)]!).toBeLessThan(4.6);
  });
});

describe("the headline's colors", () => {
  // WCAG's relative luminance and contrast ratio.
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = ([r, g, b]: readonly number[]) => 0.2126 * lin(r! / 255) + 0.7152 * lin(g! / 255) + 0.0722 * lin(b! / 255);
  const rgb = (hex: string) => {
    const v = Number.parseInt(hex.slice(1, 7), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  };

  it("PHI's teal headline clears 4.5:1 on the theater's well in both schemes; every team's clears the 3:1 large type needs but one", () => {
    type Team = { color: string; alternateColor: string; abbreviation: string };
    const mnf = fixture("mnf-dal-phi-plays.json") as { home: Team; away: Team };
    const soccer = fixture("soccer-theater-plays.json") as { matches: { home: Team; away: Team }[] };
    const failing: string[] = [];
    const phi: number[] = [];
    for (const scheme of ["dark", "light"] as const) {
      // The page (tokens.css --page), and over it the well's plate: black at 0.45 in the dark, 0.045 in the light.
      const page = scheme === "dark" ? [0x12, 0x12, 0x14] : [0xf2, 0xf2, 0xf5];
      const a = scheme === "dark" ? 0.45 : 0.045;
      const plate = luminance(page.map((c) => c * (1 - a)));
      for (const { home, away } of [mnf, ...soccer.matches]) {
        const d = dress({ top: { color: away.color, alternate: away.alternateColor }, bottom: { color: home.color, alternate: home.alternateColor } }, scheme);
        for (const [name, u] of [
          [away.abbreviation, d.top],
          [home.abbreviation, d.bottom],
        ] as const) {
          if (!u.accent) continue;
          const l = luminance(rgb(u.accent));
          const ratio = (Math.max(l, plate) + 0.05) / (Math.min(l, plate) + 0.05);
          if (name === "PHI") phi.push(ratio);
          if (ratio < 3) failing.push(`${scheme} ${name} ${u.accent} ${ratio.toFixed(2)}`);
        }
      }
    }
    expect(phi.length).toBe(2);
    expect(Math.min(...phi)).toBeGreaterThan(4.5);
    // Manchester City's sky blue in the light, at 2.93:1 on the well's tint: the Swift's dressing
    // (TheaterTeams.dress deepens a team's type only above L 0.7) lets it through. Raised with the Mac.
    expect(failing).toEqual(["light MNC #618bae 2.93"]);
  });
});

describe("between plays", () => {
  const play = scene("9274")!;
  const td = scene("3048")!;
  const attempt = td.conversion!;

  it("opening the page on an old snap shows the game as it stands; a fresh one replays", () => {
    expect(footballShown({ play, news: false }, null, null)).toBeNull();
    expect(footballShown({ play, news: true }, null, null)).toBe(play);
  });
  it("a replay's end holds (the stamp, the ball, the players where it ended), then gives way to the live scene", () => {
    expect(footballShown({ play, news: true }, play.id, null)).toBe(play);
    expect(footballShown({ play, news: true }, play.id, play.id)).toBeNull();
  });
  it("a touchdown's try plays its own beat after the touchdown, and holds the same", () => {
    expect(attempt).toBeTruthy();
    expect(footballShown({ play: td, news: true }, attempt.id, td.id)).toEqual(attempt);
    expect(footballShown({ play: td, news: true }, attempt.id, attempt.id)).toBeNull();
  });
  it("the next snap cuts in, whatever is holding", () => {
    const next = scene("2186")!;
    expect(footballShown({ play: next, news: true }, play.id, null)).toBe(next);
  });
  it("…the game as it stands: both teams at the line, the linemen down in their stances, the blue and yellow lines, no stamp, no flight", () => {
    const live = FootballScript.rest({ yard: 40, gain: 50 });
    expect(live.lines.scrimmage).toBe(Gridiron.y(40));
    expect(live.lines.gain).toBe(Gridiron.y(50));
    expect(live.stamp).toBe(Infinity);
    expect(live.flights.length).toBe(0);
    expect(live.players.length).toBe(22);
    expect(live.players.filter((p) => p.role === "line").every((p) => p.inStance(Infinity))).toBe(true);
  });
  it("one hold for every theater: a replay's end stays 8 s", () => {
    expect(HOLD_MS).toBe(8000);
  });
});
