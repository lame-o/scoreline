/**
 * The soccer theater (SoccerTheaterTests.swift), checked without the live
 * lane: real Premier League moments (24–25 Oct 2026,
 * test/fixtures/soccer-theater-plays.json, the Swift app's fixture: each clip
 * ESPN's core plays from 24 before a big moment to 5 after) parsed into
 * scenes (the build-up, the shot to its point in the goal mouth, who scored,
 * saved, blocked), and the choreography (every pass from the man who played
 * it to the man it found, the keeper's hands where the ball is, a goal in the
 * net, a replay that settles on the frame it holds), the camera, and who
 * celebrates what; and the Mac's polish: the angle from behind the goal,
 * the keeper once, the dive, the pace of a move, the stamp's corner kept
 * clear, bursts sized by the well. The Swift suite's pixel checks ("Drawn") live with the
 * renderer.
 */
import { describe, expect, it } from "vitest";
import type { JSONValue } from "../../src/data/json";
import { actionMoment, BIG_CHANCE_XG, pitchAction } from "../../src/data/liveFeeds/soccer";
import { liveMoment, Tier, type LiveMoment } from "../../src/data/moments";
import { CameraFrame } from "../../src/data/mlb/playCamera";
import type { FieldPoint, Point } from "../../src/data/mlb/theaterField";
import { cueBursts } from "../../src/data/celebrations";
import { attacksRight, buildUpOf, crossbar, decides, distance, isMoment, keepers, minute, parse, Pitch, scored, surname, touchLimit, type SoccerScene } from "../../src/data/theater/soccerScene";
import { goalFrame, PitchCamera, PitchFrame, room, SoccerScript } from "../../src/data/theater/soccerScript";
import { CameraFollow, TheaterBurst } from "../../src/data/theater/theaterKit";
import { buildUpLimit, loftSpeed, passSpeed } from "../../src/data/theater/soccerScript";
import { keeperSave } from "../../src/data/theater/soccerScene";
import { dot, norm, skeleton, vec, minus, type RigVector } from "../../src/data/theater/rig";
import { actorPose, PitchPose } from "../../src/features/game/soccer/theater/drawSoccer";
import { jointsBreak } from "./rigJoints";
import { GoalCelebration, PitchProjection, sentences, soccerShown, SoccerTheaterWatch, soccerTheaterState, stampDetail } from "../../src/data/theater/soccerTheater";
import { fixture } from "./fixtures";

interface Clip {
  readonly plays: readonly JSONValue[];
  readonly home: string | null;
}

const data = fixture("soccer-theater-plays.json") as { matches: { home: { id: string }; clips: JSONValue[][] }[] };
const clips: Clip[] = data.matches.flatMap((m) => m.clips.map((plays) => ({ plays, home: m.home.id })));
const textOf = (p: JSONValue) => ((p as { text?: string }).text ?? "") as string;

/** The moment whose text says this, parsed from its clip. */
function find(clue: string): { scene: SoccerScene; clip: Clip; index: number } | null {
  for (const clip of clips) {
    const i = clip.plays.findIndex((p) => isMoment(p) && textOf(p).includes(clue));
    if (i < 0) continue;
    const scene = parse(clip.plays, i, clip.home, keepers(clip.plays));
    if (scene) return { scene, clip, index: i };
  }
  return null;
}

const near = (a: Point | null | undefined, b: Point | null | undefined, tolerance = 0.5) => a != null && b != null && Math.hypot(a.x - b.x, a.y - b.y) <= tolerance;
const range = (from: number, to: number, step: number) => {
  const out: number[] = [];
  for (let t = from; t <= to + 1e-9; t += step) out.push(t);
  return out;
};
const exclusive = (from: number, to: number, step: number) => {
  const out: number[] = [];
  for (let t = from; t < to; t += step) out.push(t);
  return out;
};

// MARK: Every moment

const scenes: SoccerScene[] = [];
let moments = 0;
for (const clip of clips) {
  const found = keepers(clip.plays);
  clip.plays.forEach((p, i) => {
    if (!isMoment(p)) return;
    moments += 1;
    const scene = parse(clip.plays, i, clip.home, found);
    if (scene) scenes.push(scene);
  });
}
const scripts = scenes.map((s) => [s, SoccerScript.build(s)] as const);

const header = find("Gabriel Magalhães (Arsenal) header from very close range");
const save = find("Rayan Cherki (Manchester City) left footed shot from the centre");
const blocked = find("Erling Haaland (Manchester City) header from the centre of the box is blocked");
const post = find("Iliman Ndiaye (Manchester City) hits the left post");
const penalty = find("converts the penalty");
const ownGoal = find("Own Goal by Mike Penders");

describe("soccer theater: every moment", () => {
  it("every goal, save, block, post and big chance in the clips parses", () => {
    expect(moments).toBeGreaterThanOrEqual(20);
    expect(scenes.length).toBe(moments);
  });

  it("every shot is struck on the pitch, in the half its team attacks (home right, as the Live Pitch draws it)", () => {
    for (const s of scenes) {
      expect(s.shot.from.x).toBeGreaterThanOrEqual(-1);
      expect(s.shot.from.x).toBeLessThanOrEqual(106);
      expect(s.shot.from.y).toBeGreaterThanOrEqual(-1);
      expect(s.shot.from.y).toBeLessThanOrEqual(69);
      expect(attacksRight(s) ? s.shot.from.x > Pitch.length / 2 : s.shot.from.x < Pitch.length / 2).toBe(true);
    }
  });

  it("most moments get a build-up (three touches or a set piece); a build-up is the last eight touches at most", () => {
    const built = scenes.filter((s) => buildUpOf(s).length >= 3 || (s.start !== "openPlay" && s.touches.length > 0) || s.start === "penalty");
    expect(built.length / Math.max(scenes.length, 1)).toBeGreaterThanOrEqual(0.6);
    expect(scenes.every((s) => buildUpOf(s).length <= touchLimit)).toBe(true);
  });

  it("a pass, a goal kick, a save entry, a corner awarded aren't moments; every shot is, a speculative miss too; a big chance missed, a volley in, a penalty saved are", () => {
    for (const type of ["pass", "goal-kick", "save", "corner-awarded"]) expect(isMoment({ type: { type }, expectedGoals: 0.05 })).toBe(false);
    expect(isMoment({ type: { type: "shot-off-target" }, expectedGoals: 0.05 })).toBe(true);
    expect(isMoment({ type: { type: "shot-off-target" }, expectedGoals: 0.61 })).toBe(true);
    expect(isMoment({ type: { type: "goal---volley" } })).toBe(true);
    expect(isMoment({ type: { type: "penalty---saved" } })).toBe(true);
  });
});

describe("soccer theater: the pitch", () => {
  it("Opta's markings land on the pitch's: the box's corner, the spot, the six-yard box", () => {
    expect(near(Pitch.metres(83, 21.1), { x: 88.5, y: 13.84 }, 0.01)).toBe(true);
    expect(near(Pitch.metres(88.5, 50), { x: 94, y: 34 }, 0.01)).toBe(true);
    expect(near(Pitch.metres(5.8, 63.2), { x: 5.5, y: 43.16 }, 0.01)).toBe(true);
  });

  it("the goal mouth: the posts at 45.2 and 54.8, the bar at 38; a ball over the line is past it", () => {
    expect(Math.abs(Pitch.across(45.2) - Pitch.posts.near)).toBeLessThan(0.01);
    expect(Math.abs(Pitch.across(54.8) - Pitch.posts.far)).toBeLessThan(0.01);
    expect(Math.abs(Pitch.height(38) - Pitch.goalHeight)).toBeLessThan(0.01);
    expect(Pitch.metres(100.8, 50).x).toBeGreaterThan(Pitch.length);
  });

  it("surnames for the stamp: particles kept, a single name whole; minutes: 68', 90+3'", () => {
    expect(surname("Gabriel Magalhães")).toBe("Magalhães");
    expect(surname("Virgil van Dijk")).toBe("van Dijk");
    expect(surname("Jan Paul van Hecke")).toBe("van Hecke");
    expect(surname("Alexis Mac Allister")).toBe("Mac Allister");
    expect(surname("Rayan")).toBe("Rayan");
    expect(minute("90'+3'")).toBe("90+3'");
    expect(minute("68'")).toBe("68'");
  });
});

describe("soccer theater: moments", () => {
  it("Arsenal 2-0: Gabriel's header, home, attacking right, 68', after a nine-pass move, White's cross in the air to his head", () => {
    const s = header!.scene;
    const build = buildUpOf(s);
    expect([s.outcome, s.shot.technique, s.start, s.side, s.minute]).toEqual(["goal", "header", "openPlay", "top", "68'"]);
    expect(build.length).toBe(8);
    const last = build[build.length - 1]!;
    expect([last.kind, last.lofted, last.player]).toEqual(["cross", true, "Ben White"]);
    expect(near(last.to, s.shot.from)).toBe(true);
    expect(s.assist).toBe("Ben White");
    expect(s.shot.from.x).toBeGreaterThan(Pitch.length - Pitch.sixDepth);
    expect(distance(s)).toBe(6);
    const mouth = s.shot.mouth!;
    // To the bottom left corner: inside the posts, under the bar, to the header's left.
    expect(mouth.y > Pitch.posts.near && mouth.y < Pitch.posts.far && mouth.z < Pitch.goalHeight && mouth.y > Pitch.width / 2).toBe(true);
  });

  it("Haaland's equalizer: Fernández's free kick, Ndiaye's cross, the away side attacking left", () => {
    const s = find("Erling Haaland (Manchester City) header from very close range")!.scene;
    expect(s.start).toBe("freeKick");
    expect([s.touches[0]?.kind, s.touches[0]?.player]).toEqual(["restart", "Enzo Fernández"]);
    expect(buildUpOf(s).at(-1)?.kind).toBe("cross");
    expect(s.side).toBe("bottom");
    expect(s.shot.from.x).toBeLessThan(Pitch.sixDepth);
  });

  it("Konsa from the scramble: a corner, Gabriel's header saved by Pickford, the rebound", () => {
    const s = find("Ezri Konsa (Arsenal) right footed shot from very close range")!.scene;
    expect(s.start).toBe("corner");
    expect(s.touches.some((t) => t.kind === "shot" && t.player === "Gabriel Magalhães")).toBe(true);
    expect(s.touches.some((t) => t.defending && t.player === "Jordan Pickford")).toBe(true);
    expect(s.keeper.name).toBe("Jordan Pickford");
  });

  it("Cherki's chance: saved by Suzuki on his line, and held; its stamp: saved by Suzuki, how hard (0.42 xGOT), 13 yards out", () => {
    const s = save!.scene;
    expect(s.outcome).toBe("saved");
    expect(s.keeper.name).toBe("Zion Suzuki");
    expect(s.keeper.at!.x).toBeLessThan(Pitch.sixDepth);
    expect(s.shot.stopped!.x).toBeLessThan(2);
    expect(s.rebound).toBeNull();
    expect(stampDetail(s)).toBe("SAVED BY SUZUKI · 0.42 xGOT · 13 YD");
  });

  it("Haaland's header blocked by Maatsen, from Foden's cross", () => {
    const s = blocked!.scene;
    expect(s.outcome).toBe("blocked");
    expect(s.blocker?.name).toBe("Ian Maatsen");
    expect(s.blocker?.at).not.toBeNull();
    expect(s.shot.stopped).not.toBeNull();
    expect(s.shot.technique).toBe("header");
    expect(buildUpOf(s).at(-1)?.kind).toBe("cross");
  });

  it("Ndiaye off the left post, the ball out behind, after a six-pass move", () => {
    const s = post!.scene;
    expect(s.outcome).toBe("woodwork");
    expect(crossbar(s)).toBe(false);
    expect(s.rebound!.x).toBeLessThan(0);
    expect(buildUpOf(s).length).toBeGreaterThanOrEqual(5);
  });

  it("McBurnie's penalty: from the spot, no build-up, 12 yd", () => {
    const s = penalty!.scene;
    expect(s.start).toBe("penalty");
    expect(s.touches).toEqual([]);
    expect(s.shot.penalty).toBe(true);
    expect(near(s.shot.from, { x: Pitch.length - Pitch.spot, y: 34 }, 0.1)).toBe(true);
    expect(distance(s)).toBe(12);
  });

  it("Penders' own goal: credited to Tottenham (away, attacking left), off a corner", () => {
    const s = ownGoal!.scene;
    expect([s.outcome, s.shooter, s.side, s.start, scored(s)]).toEqual(["ownGoal", "Mike Penders", "bottom", "corner", true]);
  });

  it("Ouattara's volley: after Damsgaard's header and a Hull touch", () => {
    const s = find("Dango Ouattara (Brentford) right footed shot from very close range")!.scene;
    expect(s.shot.technique).toBe("volley");
    expect(s.touches.some((t) => t.kind === "shot" && t.player === "Mikkel Damsgaard")).toBe(true);
    expect(s.touches.some((t) => t.defending)).toBe(true);
  });

  it("Gelhardt's miss: a big chance, wide", () => {
    const s = find("Joe Gelhardt (Hull City) left footed shot from the centre of the box is close")!.scene;
    expect(s.outcome).toBe("wide");
    expect(s.shot.xg ?? 0).toBeGreaterThanOrEqual(BIG_CHANCE_XG);
    expect(stampDetail(s)).toBe("BIG CHANCE · 0.61 xG · WIDE");
  });

  it("decisive: a late equalizer or winner, not a third goal or a 60th-minute one", () => {
    const s = header!.scene;
    const at = (clock: number, top: number, bottom: number) => decides({ ...s, clock, topScore: top, bottomScore: bottom });
    expect(at(88 * 60, 2, 2)).toBe(true);
    expect(at(88 * 60, 3, 2)).toBe(true);
    expect(at(88 * 60, 3, 0)).toBe(false);
    expect(at(60 * 60, 2, 2)).toBe(false);
  });
});

describe("soccer theater: what's news", () => {
  it("a moment that arrives while the page is open, or one 25 s old; not one ten minutes old, nor one already showing", () => {
    const s = header!.scene;
    const when = s.wallclock!;
    const empty = { scene: null, news: false };
    expect(soccerTheaterState(s, empty, false, when + 600_000).news).toBe(false);
    expect(soccerTheaterState(s, empty, false, when + 25_000).news).toBe(true);
    expect(soccerTheaterState(s, { scene: save!.scene, news: false }, true, Number.MAX_SAFE_INTEGER).news).toBe(true);
    expect(soccerTheaterState(s, { scene: s, news: false }, true, Number.MAX_SAFE_INTEGER).news).toBe(false);
  });

  it("the watch follows the lane's window: history first, then a moment that arrives is news, and an older window is left alone", () => {
    const clip = header!.clip;
    const at = header!.index;
    const watch = new SoccerTheaterWatch();
    const late = Date.parse("2030-01-01T00:00:00Z");
    // The first load, up to the play before the goal: whatever moment it holds is history.
    const before = clip.plays.slice(0, at);
    watch.update(before, clip.home, false, late);
    expect(watch.state.news).toBe(false);
    expect(watch.state.scene?.id).not.toBe(header!.scene.id);
    // The same window again: nothing new.
    expect(watch.update(before, clip.home, true, late)).toBe(false);
    // The goal arrives on a primed page: news, its build-up from the window.
    const withGoal = clip.plays.slice(0, at + 1);
    expect(watch.update(withGoal, clip.home, true, late)).toBe(true);
    expect(watch.state.scene?.id).toBe(header!.scene.id);
    expect(watch.state.news).toBe(true);
    expect(buildUpOf(watch.state.scene!).length).toBe(8);
    // Plays after it that aren't moments keep it as it was.
    expect(watch.update(clip.plays.slice(0, at + 3), clip.home, true, late)).toBe(false);
    expect(watch.state.news).toBe(true);
    // On a page that opened after it (not primed, long after): history.
    const fresh = new SoccerTheaterWatch();
    fresh.update(withGoal, clip.home, false, late);
    expect(fresh.state.scene?.id).toBe(header!.scene.id);
    expect(fresh.state.news).toBe(false);
  });

  it("the look that catches up after the tab was hidden (FeedLooks) is history too: its moment and events aren't news; the heartbeat still counts from it", () => {
    const clip = header!.clip;
    const at = header!.index;
    const late = Date.parse("2030-01-01T00:00:00Z");
    const watch = new SoccerTheaterWatch();
    watch.update(clip.plays.slice(0, at), clip.home, false, late);
    expect(watch.update(clip.plays.slice(0, at + 1), clip.home, true, late + 120_000, { following: false })).toBe(true);
    expect(watch.state.scene?.id).toBe(header!.scene.id);
    expect(watch.state.news).toBe(false);
    expect(watch.state.newsFrom ?? null).toBeNull();
    expect(watch.state.heard).toBe(late + 120_000);
  });
});

describe("soccer theater: between moments", () => {
  const s = header!.scene;
  it("opening the page on an old moment shows the quiet pitch; a fresh one replays", () => {
    expect(soccerShown({ scene: s, news: false }, null, null)).toBeNull();
    expect(soccerShown({ scene: s, news: true }, null, null)).toBe(s);
  });
  it("a moment's end holds (the scorer wheeling away, the stamp), then the pitch goes quiet", () => {
    expect(soccerShown({ scene: s, news: true }, s.id, null)).toBe(s);
    expect(soccerShown({ scene: s, news: true }, s.id, s.id)).toBeNull();
  });
  it("…the quiet pitch: nobody on it, no ball, no trail, no stamp", () => {
    const quiet = new SoccerScript();
    expect(quiet.actors.length).toBe(0);
    expect(quiet.flights.length).toBe(0);
    expect(quiet.stamp).toBe(Infinity);
    expect(quiet.banners.length).toBe(0);
  });
});

describe("soccer theater: choreography", () => {
  it("every moment's players and ball stay finite, the ball never under the grass", () => {
    for (const [, s] of scripts) {
      for (const t of range(0, s.duration, 0.05)) {
        for (const a of s.actors) {
          const p = a.position(t);
          expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
        }
        const b = s.ball(t);
        if (b) expect(Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.z) && b.z >= -0.01).toBe(true);
      }
    }
  });

  it("in every moment, knees and elbows bend only their own way, never past folded (the strikes, the dives and every blend between them)", { timeout: 60_000 }, () => {
    const broken = scripts.flatMap(([scene, s]) => {
      const where = jointsBreak(s.duration, s.actors.length, (i, t) => actorPose(s, s.actors[i]!, i, t, s.actors[i]!.position(t), 1.1 / 2.5)[0]);
      return where ? [`${scene.shooter}: ${where}`] : [];
    });
    expect(broken.slice(0, 3)).toEqual([]);
  });

  it("every replay runs 3–11 s", () => {
    const lengths = scripts.map(([, s]) => s.duration);
    expect(Math.min(...lengths)).toBeGreaterThanOrEqual(3);
    expect(Math.max(...lengths)).toBeLessThanOrEqual(11);
  });

  it("the ball never jumps between flights (a cross arrives at the head that meets it)", () => {
    const jumps = scripts.filter(([, s]) =>
      s.flights.slice(1).some((b, i) => {
        const a = s.flights[i]!;
        return b.start <= a.end + 0.2 && Math.abs(b.from.z - a.to.z) > 0.3 && Math.hypot(b.from.x - a.to.x, b.from.y - a.to.y) < 1.5;
      }),
    );
    expect(jumps.map(([scene]) => scene.shooter)).toEqual([]);
  });

  it("the ball's flights run in order, the shot at the strike", () => {
    for (const [, s] of scripts) {
      expect(s.flights.slice(1).every((b, i) => s.flights[i]!.start <= b.start + 1e-9)).toBe(true);
      expect(s.shot != null && s.flights[s.shot]!.start === s.strike).toBe(true);
    }
  });

  it("every pass leaves a player's feet and finds one standing where ESPN says", () => {
    const passes = scripts.flatMap(([scene, s]) => s.flights.filter((f) => f.kind === "pass" && f.end <= s.strike).map((f) => [scene, s, f] as const));
    const played = passes.filter(([, s, f]) => s.actors.some((a) => near(a.position(f.start), f.from, 0.6))).length;
    const lost = passes.filter(([, s, f]) => !s.actors.some((a) => near(a.position(f.end), f.to, 0.6)));
    expect(passes.length).toBeGreaterThan(30);
    expect(played).toBe(passes.length);
    expect(lost.map(([scene, , f]) => `${scene.shooter} ${f.to.x},${f.to.y} at ${f.end}`)).toEqual([]);
  });

  it("a man running with it keeps it at his feet", () => {
    const carries = scripts.flatMap(([, s]) => s.flights.filter((f) => f.kind === "carry" && f.end > f.start + 0.05).map((f) => [s, f] as const));
    const loose = carries.filter(([s, f]) => !range(f.start, f.end, 0.05).every((t) => s.actors.some((a) => near(a.position(t), f.point(t), 0.6))));
    expect(loose.length).toBe(0);
  });

  it("a goal: the header flies from head height to the exact point in the mouth, into the net, which ripples; GOAL lands as it goes in, then the stamp; the scorer wheels away, arms up", () => {
    const s = header!.scene;
    const script = SoccerScript.build(s);
    const shot = script.flights[script.shot!]!;
    expect([shot.to.x, shot.to.y, shot.to.z]).toEqual([Pitch.length, s.shot.mouth!.y, s.shot.mouth!.z]);
    expect(shot.from.z).toBeGreaterThan(1.5);
    const rest = script.ball(Infinity)!;
    expect(rest.x > Pitch.length && rest.z < 0.5).toBe(true);
    expect(script.impacts.some((i) => i.kind === "net")).toBe(true);
    expect(script.banners.map((b) => b.text)).toEqual(["GOAL"]);
    expect([script.banners[0]!.tone, script.banners[0]!.confetti]).toEqual(["team", true]);
    expect(script.banners[0]!.at).toBeGreaterThanOrEqual(script.arrive);
    expect(script.stamp).toBeGreaterThan(script.arrive);
    const scorer = script.actors.find((a) => a.name === s.shooter && a.team === "attacking")!;
    expect(scorer.actions.some((a) => a.kind === "celebrate")).toBe(true);
    const end = scorer.position(Infinity);
    expect(Math.hypot(end.x - s.shot.from.x, end.y - s.shot.from.y)).toBeGreaterThan(6);
    expect(SoccerScript.build({ ...s, decisive: true }).banners[0]?.tone).toBe("gold");
    expect(stampDetail(s)).toBe("ASSISTED BY WHITE · HEADER · 6 YD");
  });

  it("a save: the keeper's hands are where the ball is when it gets there, and he holds on; SAVE, in neutral ink", () => {
    const script = SoccerScript.build(save!.scene);
    const end = script.flights[script.shot!]!.to;
    const keeper = script.actors.find((a) => a.role === "keeper")!;
    const hands: FieldPoint = keeper.dive?.target ?? { ...keeper.position(script.arrive), z: 0 };
    expect(Math.hypot(end.x - hands.x, end.y - hands.y)).toBeLessThan(1);
    expect(script.heldBy).not.toBeNull();
    expect(script.impacts.some((i) => i.kind === "save" && i.at === script.arrive)).toBe(true);
    expect(script.banners.map((b) => b.text)).toEqual(["SAVE"]);
    expect(script.banners[0]!.tone).toBe("neutral");
  });

  it("a block: the shot stops at the defender in its way; no headline", () => {
    const script = SoccerScript.build(blocked!.scene);
    const end = script.flights[script.shot!]!.to;
    expect(script.actors.some((a) => a.team === "defending" && a.role === "outfield" && near(a.position(script.arrive), end, 0.6))).toBe(true);
    expect(script.banners).toEqual([]);
    expect(script.impacts.some((i) => i.kind === "block")).toBe(true);
  });

  it("the woodwork: onto the post, which rings: OFF THE POST", () => {
    const script = SoccerScript.build(post!.scene);
    const end = script.flights[script.shot!]!.to;
    expect(Math.abs(end.y - Pitch.posts.near) < 0.01 || Math.abs(end.y - Pitch.posts.far) < 0.01).toBe(true);
    expect(script.impacts.some((i) => i.kind === "woodwork")).toBe(true);
    expect(script.banners[0]?.text).toBe("OFF THE POST");
  });

  it("a penalty: PENALTY as it's set, then GOAL, one at a time; the taker runs up to it from the edge of the D; the keeper on his line", () => {
    const s = penalty!.scene;
    const script = SoccerScript.build(s);
    expect(script.banners.map((b) => b.text)).toEqual(["PENALTY", "GOAL"]);
    expect(script.banners[0]!.until).toBeLessThan(script.banners[1]!.at);
    const taker = script.actors.find((a) => a.name === s.shooter)!;
    const start = taker.position(0);
    expect(Math.hypot(start.x - s.shot.from.x, start.y - s.shot.from.y)).toBeGreaterThan(2);
    expect(near(taker.position(script.strike), s.shot.from, 0.6)).toBe(true);
    const keeper = script.actors.find((a) => a.role === "keeper")!;
    expect(Math.abs(keeper.position(script.strike).x - Pitch.length)).toBeLessThan(0.6);
  });

  it("an own goal: OWN GOAL, the defender who turned it in, in his own net", () => {
    const s = ownGoal!.scene;
    const script = SoccerScript.build(s);
    expect(script.banners[0]?.text).toBe("OWN GOAL");
    expect(script.actors.some((a) => a.name === s.shooter && a.team === "defending")).toBe(true);
    expect(script.ball(Infinity)!.x).toBeLessThan(0);
  });
});

describe("soccer theater: the camera", () => {
  const size = { width: 640, height: 320 };
  const inView = (p: FieldPoint, frame: PitchFrame, slack = 0) => {
    const q = new PitchProjection(size, frame).point(p);
    return q.x >= -slack * size.width && q.x <= size.width * (1 + slack) && q.y >= -slack * size.height && q.y <= size.height * (1 + slack);
  };

  it("rides the ball through every build-up", () => {
    let seen = 0;
    let total = 0;
    for (const [, s] of scripts) {
      for (const t of exclusive(0.4, s.strike, 1 / 30)) {
        const ball = s.ball(t);
        if (!ball) continue;
        total += 1;
        if (inView(ball, s.frame(t), 0.02)) seen += 1;
      }
    }
    expect(total).toBeGreaterThan(500);
    expect(seen / total).toBeGreaterThan(0.97);
  });

  it("…and has the goal mouth in frame as the shot gets there", () => {
    const missed = scripts.filter(([scene, s]) => !goalFrame(attacksRight(scene)).slice(0, 4).every((p) => inView(p, s.frame(s.arrive), 0.02)));
    expect(missed.map(([scene]) => scene.shooter)).toEqual([]);
  });

  it("…pushing in for the shot, never out (but for a shot from distance, which needs the width)", () => {
    const wider = scripts.filter(([scene, s]) => {
      if (distance(scene) > 25) return false;
      const buildUp = exclusive(0.4, Math.max(s.strike - 0.6, 0.41), 0.1).map((t) => s.frame(t).span);
      return !(buildUp.length === 0 || s.frame(s.arrive).span <= Math.max(...buildUp) + 0.5);
    });
    expect(wider.map(([scene]) => scene.shooter)).toEqual([]);
  });

  it("it ends on the goal and the scorer, and holds that frame from the moment the play has settled", () => {
    const s = header!.scene;
    const script = SoccerScript.build(s);
    const end = script.frame(Infinity);
    const scorer = script.actors.find((a) => a.name === s.shooter)!;
    expect(goalFrame(true).slice(0, 4).every((p) => inView(p, end))).toBe(true);
    expect(inView({ ...scorer.position(Infinity), z: 0 }, end)).toBe(true);
    const settled = script.frame(script.settle);
    expect(CameraFrame.equal(script.frame(script.duration), end)).toBe(true);
    expect(Math.hypot(settled.x - end.x, settled.y - end.y)).toBeLessThan(0.01);
    expect(Math.abs(settled.span - end.span)).toBeLessThan(0.01);
  });

  it("never pans faster than 1.4 view-heights a second", () => {
    for (const [, s] of scripts) {
      for (let i = 1; i < s.camera.length; i++) {
        const a = s.camera[i - 1]!;
        const b = s.camera[i]!;
        expect(Math.hypot(b.x - a.x, b.y - a.y) * CameraFollow.rate).toBeLessThanOrEqual(1.45 * a.span + 0.01);
      }
    }
  });

  it("no closer than it's asked", () => {
    expect(PitchCamera.fitting([room({ x: 52.5, y: 34, z: 0 }, true)], CameraFrame.headroom, 12).span).toBeGreaterThanOrEqual(12);
  });
});

describe("soccer theater: behind the goal", () => {
  const size = { width: 640, height: 320 };
  const inView = (p: FieldPoint, frame: PitchFrame, slack = 0) => {
    const q = new PitchProjection(size, frame).point(p);
    return q.x >= -slack * size.width && q.x <= size.width * (1 + slack) && q.y >= -slack * size.height && q.y <= size.height * (1 + slack);
  };
  const onTarget = scripts.filter(([scene]) => scene.outcome === "goal" || scene.outcome === "saved");

  it("a shot on target cuts behind the net just after the strike, holds through the finish, and is back before the stamp", () => {
    const cuts = onTarget.filter(([scene, s]) => {
      const r = s.reverse;
      if (!r) return false;
      const at = s.frame(s.arrive).angle;
      return r.from > s.strike && r.from < s.strike + 0.2 && r.until > s.arrive + 0.5 && r.until < s.stamp && r.right === attacksRight(scene) && at.kind === "behind" && at.right === attacksRight(scene) && s.frame(r.until).angle.kind === "stand";
    });
    expect(onTarget.length).toBeGreaterThanOrEqual(8);
    expect(cuts.length).toBe(onTarget.length);
  });

  it("…a block, a miss, the woodwork and an own goal stay on the main camera", () => {
    expect(scripts.filter(([scene]) => scene.outcome !== "goal" && scene.outcome !== "saved").every(([, s]) => s.reverse == null)).toBe(true);
  });

  it("…from there: the goal mouth, the keeper and where the ball ends up, all in view", () => {
    const seen = onTarget.filter(([scene, s]) => {
      const f = s.frame(s.arrive);
      const keeper = s.actors.find((a) => a.role === "keeper");
      return (
        goalFrame(attacksRight(scene)).slice(0, 4).every((p) => inView(p, f, 0.02)) &&
        keeper != null &&
        inView({ ...keeper.position(s.strike), z: 0 }, f, 0.02) &&
        s.shot != null &&
        inView(s.flights[s.shot]!.to, f)
      );
    });
    expect(seen.length).toBe(onTarget.length);
  });

  it("…a camera held still in the stand behind the net, above the bar", () => {
    const script = SoccerScript.build(header!.scene);
    const r = script.reverse!;
    const still = exclusive(r.from, r.until, 0.05).every((t) => PitchFrame.equal(script.frame(t), script.frame(r.from)));
    const eye = PitchCamera.eye(r.frame, { kind: "behind", right: true });
    expect(still).toBe(true);
    expect(eye.x).toBeGreaterThan(Pitch.length + 2);
    expect(eye.z).toBeGreaterThan(Pitch.goalHeight);
  });
});

describe("soccer theater: the keeper, once", () => {
  it("with no keeper's name known yet, the keeper is never drawn twice", { timeout: 30_000 }, () => {
    const twice: string[] = [];
    for (const clip of clips) {
      clip.plays.forEach((p, i) => {
        if (!isMoment(p)) return;
        const scene = parse(clip.plays, i, clip.home, {});
        if (!scene) return;
        const s = SoccerScript.build(scene);
        const his = new Set(scene.touches.filter((t) => t.keeper).map((t) => t.player));
        if (s.actors.filter((a) => a.role === "keeper").length !== 1 || s.actors.some((a) => a.team === "defending" && a.role === "outfield" && his.has(a.name))) twice.push(scene.shooter);
      });
    }
    expect(twice).toEqual([]);
  });

  it("Konsa's goal, Pickford unknown: his save of Gabriel's header makes him the keeper, once", () => {
    const clue = "Ezri Konsa (Arsenal) right footed shot from very close range";
    const found = find(clue)!;
    const unknown = parse(found.clip.plays, found.index, found.clip.home, {})!;
    const s = SoccerScript.build(unknown);
    expect(unknown.keeper.name).toBe("Jordan Pickford");
    expect(s.actors.filter((a) => a.name === "Jordan Pickford").length).toBe(1);
    expect(s.actors.find((a) => a.role === "keeper")?.name).toBe("Jordan Pickford");
  });

  it("…but the save credited after a block is the blocker's, not the keeper's", () => {
    const typeOf = (p: JSONValue) => (p as { type?: { type?: string } }).type?.type;
    const blockedSaves = clips.flatMap((clip) =>
      clip.plays.flatMap((p, i) => {
        if (typeOf(p) !== "save") return [];
        const after = clip.plays.slice(Math.max(i - 3, 0), i).some((q) => typeOf(q) === "shot-blocked" && !textOf(q).includes(" saved "));
        return after ? [{ clip, i }] : [];
      }),
    );
    expect(blockedSaves.length).toBeGreaterThan(0);
    expect(blockedSaves.every(({ clip, i }) => !keeperSave(clip.plays, i))).toBe(true);
  });
});

describe("soccer theater: the dive", () => {
  it("at full stretch: one line from the trailing foot through the body to the leading hand, beyond his head; leaning for a top corner, flat along the grass", () => {
    // Toward a ball on his left at 0.6 (a top corner) to 1.8 rad (along the grass) off upright, a little in front of him.
    const over = (a: number): RigVector => vec(0.15 * Math.sin(a), 0.8 * Math.sin(a), 0.8 * Math.cos(a));
    for (const a of [0.6, 0.9, 1.2, 1.5, 1.8]) {
      const k = skeleton(PitchPose.stretch(over(a)));
      const o = over(a);
      const line = vec(o.x / norm(o), o.y / norm(o), o.z / norm(o));
      const along = (p: RigVector, q: RigVector) => dot(minus(q, p), line) / norm(minus(q, p));
      expect(along(k.hip, k.neck)).toBeGreaterThan(0.99);
      expect(along(k.neck, k.hands[1])).toBeGreaterThan(0.97);
      expect(along(k.feet[1], k.hip)).toBeGreaterThan(0.97);
      expect(dot(minus(k.hands[1], k.hip), line)).toBeGreaterThan(dot(minus(k.head, k.hip), line));
    }
    expect(PitchPose.stretch(over(0.7)).bank).toBeLessThan(PitchPose.stretch(over(1.6)).bank);
  });

  it("…a dive takes half a second, whatever the shot's flight: from distance he reads it first", () => {
    const dives = scripts.flatMap(([, s]) => {
      const d = s.actors.find((a) => a.dive != null)?.dive;
      return d ? [{ s, d }] : [];
    });
    expect(dives.length).toBeGreaterThanOrEqual(8);
    expect(dives.every(({ s, d }) => d.reach - d.start <= 0.61 && d.start >= s.strike)).toBe(true);
  });
});

describe("soccer theater: the pace of a move", () => {
  it("a nine-pass move, as a replay cuts it: picked up a few passes in, the early ones hurried, White's cross at the game's pace, the header inside 5.6 s", () => {
    const s = header!.scene;
    const script = SoccerScript.build(s);
    const passes = script.flights.filter((f) => f.kind === "pass" && f.end <= script.strike + 0.01);
    const cross = passes[passes.length - 1]!;
    const d = Math.hypot(cross.to.x - cross.from.x, cross.to.y - cross.from.y);
    const full = Math.min(Math.max(d / loftSpeed + 0.25, 0.6), 1.5);
    const early = passes.slice(0, -2).map((f) => (f.end - f.start) / Math.min(Math.max(Math.hypot(f.to.x - f.from.x, f.to.y - f.from.y) / passSpeed, 0.28), 1.1));
    const closing = (cross.end - cross.start) / full;
    const first = script.flights[0]!;
    const opens = s.touches.findIndex((t) => near(t.at, first.from, 0.1));
    expect(script.strike).toBeLessThan(5.6);
    expect(closing).toBeGreaterThan(0.99);
    expect(early.every((x) => x < 0.95)).toBe(true);
    expect(opens).toBeGreaterThan(0);
  });

  it("no pass so hurried it reads as a jump; every build-up comes in around five seconds", () => {
    expect(scripts.every(([, s]) => s.flights.filter((f) => f.kind === "pass").every((f) => f.end - f.start >= 0.2 - 1e-9))).toBe(true);
    expect(scripts.every(([scene, s]) => s.strike <= (scene.start === "openPlay" ? 0.5 : 1.3) + buildUpLimit + 0.6)).toBe(true);
  });
});

describe("soccer theater: the stamp's corner and bursts by the well", () => {
  const size = { width: 640, height: 320 };

  it("once the stamp has landed, nobody stands in its corner (a teammate running to the scorer)", () => {
    const crowded = scripts.map(([, s]) =>
      range(s.stamp + 0.4, s.duration, 0.05).filter((t) => {
        const f = new PitchProjection(size, s.frame(t));
        return s.actors.some((a) => {
          const foot = f.point({ ...a.position(t), z: 0 });
          const x = foot.x / size.width;
          const y = foot.y / size.height;
          const across = s.cornerRight ? x > 1 - s.corner.width + 0.02 : x < s.corner.width - 0.02;
          return across && x > 0 && x < 1 && y > 1 - s.corner.height + 0.03 && y < 1;
        });
      }).length,
    );
    expect(crowded.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("a celebration grows with the well, and starts far enough inside it not to be cut off, clear of the headline", () => {
    const compact = TheaterBurst.scale(156);
    const roomy = TheaterBurst.scale(306);
    expect(compact).toBeGreaterThan(2.5);
    expect(roomy / compact).toBeGreaterThan(1.55);
    expect(roomy / compact).toBeLessThan(1.96);
    const kept = TheaterBurst.inside({ x: -20, y: -10 }, { width: 312, height: 156 });
    expect(kept.x).toBeGreaterThanOrEqual(46);
    expect(kept.y).toBeGreaterThanOrEqual(156 * 0.36);
  });
});

describe("soccer theater: who celebrates", () => {
  const goalMoment = liveMoment({ id: "g", chart: "pitch", tier: Tier.score, kind: "goal", lead: "Goal", detail: "" });
  const woodwork = liveMoment({ id: "p", chart: "pitch", tier: Tier.swing, kind: "shotWide", lead: "Off the woodwork", detail: "", accents: ["woodwork"] });
  const wide = liveMoment({ id: "w", chart: "pitch", tier: Tier.swing, kind: "shotWide", lead: "Wide", detail: "" });
  const card = liveMoment({ id: "c", chart: "pitch", tier: Tier.swing, kind: "yellowCard", lead: "Yellow card", detail: "" });

  it("the theater owns goals, saves, blocks, the woodwork and big chances; not cards or a plain miss", () => {
    expect(GoalCelebration.theaterOwns(goalMoment)).toBe(true);
    expect(GoalCelebration.theaterOwns(woodwork)).toBe(true);
    expect(GoalCelebration.theaterOwns(wide)).toBe(false);
    expect(GoalCelebration.theaterOwns(card)).toBe(false);
  });

  it("…so the Live Pitch only bursts for a goal when the theater isn't on the page", () => {
    expect(GoalCelebration.pitchBursts(goalMoment, true)).toBe(false);
    expect(GoalCelebration.pitchBursts(goalMoment, false)).toBe(true);
    expect(GoalCelebration.pitchBursts(card, true)).toBe(true);
  });

  const momentOf = (found: NonNullable<typeof header>): LiveMoment => {
    const a = pitchAction(found.clip.plays[found.index], 0, found.clip.home)!;
    return { ...actionMoment(a)!, burst: true };
  };

  it("a goal's fireworks burst over the net as it goes in, with confetti off GOAL; none at Off; a bloom with Reduce Motion; sparks inside the cooldown; three shells in gold for a late winner; nothing for another moment", () => {
    const s = header!.scene;
    const script = SoccerScript.build(s);
    const m = momentOf(header!);
    const bursts = GoalCelebration.theater(m, s, script, "full", false, 320);
    const net = script.impacts.find((i) => i.kind === "net")!.at;
    const fireworks = bursts.find((b) => b.cue.effects.some((e) => e.kind === "fireworks"))!;
    expect(Math.abs(fireworks.at + fireworks.cue.delay - net)).toBeLessThan(0.01);
    expect(fireworks.cue.effects).toContainEqual({ kind: "fireworks", shells: 2 });
    expect(bursts.some((b) => b.anchor.kind === "banner")).toBe(true);
    expect(GoalCelebration.theater(m, s, script, "off", false, 320)).toEqual([]);
    const calmed = GoalCelebration.theater(m, s, script, "full", true, 320);
    expect(calmed.length).toBeGreaterThan(0);
    expect(calmed.every((b) => b.cue.effects.every((e) => e.kind === "bloom"))).toBe(true);
    expect(GoalCelebration.theater({ ...m, burst: false }, s, script, "full", false, 320).every((b) => !cueBursts(b.cue))).toBe(true);
    const late = { ...s, decisive: true };
    const gold = GoalCelebration.theater(m, late, SoccerScript.build(late), "full", false, 320);
    expect(gold.some((b) => b.cue.gold && b.cue.effects.some((e) => e.kind === "fireworks" && e.shells === 3))).toBe(true);
    expect(GoalCelebration.theater(goalMoment, s, script, "full", false, 320)).toEqual([]);
  });

  it("a save glints in the keeper's hands (sparks, no confetti)", () => {
    const m = momentOf(save!);
    const bursts = GoalCelebration.theater(m, save!.scene, SoccerScript.build(save!.scene), "full", false, 320);
    expect(bursts.length).toBe(1);
    expect(bursts[0]!.cue.glint).toBe(true);
    expect(cueBursts(bursts[0]!.cue)).toBe(false);
  });
});

describe("soccer theater: the caption", () => {
  it("puts a space where ESPN ran two sentences together", () => {
    expect(sentences("with a cross.Goal confirmed following VAR Review.")).toBe("with a cross. Goal confirmed following VAR Review.");
    expect(sentences("0.39 xG.")).toBe("0.39 xG.");
  });
});
