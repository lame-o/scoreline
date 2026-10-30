/**
 * The football theater between snaps (FootballIdleTests.swift), check by
 * check, on the same real games: Monday Night Football's stoppages
 * (test/fixtures/mnf-dal-phi-plays.json: every timeout, TV timeout,
 * two-minute warning, quarter end and the half), college's timeouts and
 * automatic reviews (cfb-plays.json), and the NFL's challenges, replay
 * reviews and injuries (nfl-stoppages-plays.json, SF at ATL whole and four
 * other games' reviewed plays), all copied from the Swift app's
 * Tests/Fixtures. Each is parsed into what the theater shows (who called the
 * timeout, who threw the red flag and what came of it, who was hurt), and
 * choreographed: the line of scrimmage at the real yard line, the field
 * turning with the quarters, the team that called the timeout at its bench,
 * the red flag in from the challenger's, the man down with the trainers at
 * him, in sparse beats round a loop; the tag says what's happening, and
 * every snap that arrives replays.
 */
import { describe, expect, it } from "vitest";
import { FeedLooks } from "../../src/data/liveFeeds/baseball";
import type { FootballTeams } from "../../src/data/liveFeeds/football";
import type { Point } from "../../src/data/mlb/theaterField";
import { FieldFacing, footballIdle, FootballStatus, idleScript, parseStoppage, type FootballStoppage, type StatusNames, type StoppageKind } from "../../src/data/theater/footballIdle";
import { parse, sideNamed, type FootballScene } from "../../src/data/theater/footballScene";
import { FootballScript, Gridiron } from "../../src/data/theater/footballScript";
import { footballDown, footballShown, footballTheaterQueued, FootballTheaterWatch } from "../../src/data/theater/footballTheater";
import { fixture } from "./fixtures";

type Item = Record<string, unknown>;
interface Game {
  readonly away: { id: string; abbreviation: string; name: string };
  readonly home: { id: string; abbreviation: string; name: string };
  readonly items: Item[];
}

const items = (fixture("mnf-dal-phi-plays.json") as { items: Item[] }).items;
// DAL (6) visiting, the top team; PHI (21) at home.
const teams: FootballTeams = { topIsHome: false, topID: "6", bottomID: "21", homeAbbreviation: "PHI", awayAbbreviation: "DAL", homeName: "Eagles", awayName: "Cowboys" };
const item = (suffix: string) => items.find((i) => String(i.id).endsWith(suffix));
const scene = (suffix: string): FootballScene | null => {
  const i = item(suffix);
  return i ? parse(i, teams) : null;
};
const stoppage = (suffix: string): FootballStoppage | null => {
  const i = item(suffix);
  return i ? parseStoppage(i, teams) : null;
};
const near = (a: Point, b: Point, tolerance: number) => Math.hypot(a.x - b.x, a.y - b.y) <= tolerance;
const names: StatusNames = { top: "Cowboys", bottom: "Eagles", topColor: "002a5c", bottomColor: "06424d" };
const noTimeouts = { top: null, bottom: null };

const gameTeams = (g: Game): FootballTeams => ({
  topIsHome: false,
  topID: g.away.id,
  bottomID: g.home.id,
  homeAbbreviation: g.home.abbreviation,
  awayAbbreviation: g.away.abbreviation,
  homeName: g.home.name,
  awayName: g.away.name,
});
const college = (fixture("cfb-plays.json") as { games: Game[] }).games[0]!;
const collegeTeams = gameTeams(college);
const games = (fixture("nfl-stoppages-plays.json") as { games: Game[] }).games;
function reviewed(clue: string): [FootballScene, FootballTeams] | null {
  for (const g of games) {
    const i = g.items.find((x) => String(x.text ?? "").includes(clue));
    const s = i ? parse(i, gameTeams(g)) : null;
    if (s) return [s, gameTeams(g)];
  }
  return null;
}

describe("stoppages, as ESPN posts them", () => {
  const stoppages = items.map((i) => parseStoppage(i, teams)).filter((s): s is FootballStoppage => s != null);
  const count = (kind: StoppageKind) => stoppages.filter((s) => s.kind === kind).length;

  it("every stoppage on Monday night: 10 timeouts, 15 TV timeouts, both two-minute warnings, the 1st and 3rd quarters' ends, the half", () => {
    expect([count("timeout"), count("official"), count("twoMinuteWarning"), count("endOfPeriod"), count("halftime")]).toEqual([10, 15, 2, 2, 1]);
  });

  it("…and no snap is one", () => {
    expect(items.every((i) => parse(i, teams) == null || parseStoppage(i, teams) == null)).toBe(true);
  });

  it('"Timeout #1 by PHI at 13:55.": PHI\'s first, in the 2nd (the entry\'s own team is DAL\'s, with the ball)', () => {
    const phi = stoppage("1100");
    expect(phi && { kind: phi.kind, side: phi.side, number: phi.number, period: phi.period, clock: phi.clock }).toEqual({ kind: "timeout", side: "bottom", number: 1, period: 2, clock: "13:55" });
  });

  it('"Timeout #1 by DAL at 01:24.": DAL\'s, though PHI had the ball', () => {
    const dal = stoppage("2023");
    expect([dal?.side, dal?.number]).toEqual(["top", 1]);
  });

  it('the two-minute warning at 2:00, END QUARTER 1, the half ("End of Half")', () => {
    expect(stoppage("1850")?.clock).toBe("2:00");
    expect(stoppage("2292")?.kind).toBe("halftime");
    const q = stoppage("1042");
    expect([q?.kind, q?.period]).toEqual(["endOfPeriod", 1]);
  });

  it('college\'s 21 timeouts, each its team\'s by name ("Texas A&M" too)', () => {
    const timeouts = college.items.map((i) => parseStoppage(i, collegeTeams)).filter((s): s is FootballStoppage => s?.kind === "timeout");
    const bama = timeouts.find((s) => s.text.includes("Alabama"));
    const aggies = timeouts.find((s) => s.text.includes("Texas A&M"));
    expect(timeouts.length).toBe(21);
    expect(timeouts.every((s) => s.side != null)).toBe(true);
    expect(bama?.side).not.toBe(aggies?.side);
    expect(bama?.side).toBe(sideNamed(collegeTeams, "Alabama"));
  });
});

describe("challenges, reviews, injuries", () => {
  it("Atlanta's challenge (the home team, by its city): the runner out of bounds, upheld", () => {
    expect(reviewed("Atlanta challenged")?.[0].review).toEqual({ kind: "challenge", side: "bottom", ruling: "runner was out of bounds", reversed: false });
  });

  it("the Rams' challenge at Las Vegas: the catch reversed, replayed as the incompletion it became", () => {
    const rams = reviewed("Los Angeles Rams challenged")?.[0];
    expect([rams?.review?.side, rams?.review?.reversed, rams?.review?.ruling, rams?.kind.type]).toEqual(["top", true, "pass completion", "incomplete"]);
  });

  it("New Orleans's (home, at a neutral site): incomplete reversed to a catch", () => {
    const saints = reviewed("New Orleans challenged")?.[0];
    expect([saints?.review?.side, saints?.review?.reversed, saints?.kind.type]).toEqual(["bottom", true, "pass"]);
  });

  it("the replay official's review of a backward pass: reversed", () => {
    const booth = scene("2976")?.review;
    expect([booth?.kind, booth?.ruling, booth?.reversed]).toEqual(["booth", "backward pass", true]);
  });

  it("college's automatic reviews: targeting upheld, an interception overturned", () => {
    const reviews = college.items.flatMap((i) => parse(i, collegeTeams)?.review ?? []);
    expect(reviews.length).toBe(4);
    expect(reviews.some((r) => r.ruling === "Targeting" && !r.reversed)).toBe(true);
    expect(reviews.some((r) => r.ruling === "Interception" && r.reversed)).toBe(true);
  });

  it('"PHI-Q.Mitchell was injured during the play.": PHI\'s man, by name', () => {
    const i = items.find((x) => String(x.text ?? "").includes("Q.Mitchell was injured"));
    expect(i && parse(i, teams)?.injuries).toEqual([{ side: "bottom", name: "Q.Mitchell" }]);
  });

  it('…and Cincinnati\'s B.Cook, hurt on a split sack ("BLT" is the gamebook\'s Baltimore)', () => {
    const hurt = reviewed("CIN-B.Cook was injured")?.[0].injuries[0];
    expect([hurt?.name, hurt?.side]).toEqual(["B.Cook", "top"]);
  });

  it("every snap knows its quarter and clock", () => {
    expect(scene("9274")?.period).not.toBeNull();
    expect(scene("9274")?.clock).toBeTruthy();
  });
});

describe("which way the field faces", () => {
  it("the top team attacks right in the 1st and 3rd (and overtime), left in the 2nd and 4th: the ends change every quarter", () => {
    expect([1, 2, 3, 4, 5].map((p) => FieldFacing.topAttacksRight(p, false))).toEqual([true, false, true, false, true]);
  });

  it("turned to match the TV: the other way, and still changing ends every quarter", () => {
    expect([FieldFacing.topAttacksRight(1, true), FieldFacing.topAttacksRight(2, true)]).toEqual([false, true]);
  });

  it("attacking the screen's right the field looks up and to the right; the other team, up and to the left", () => {
    expect(FieldFacing.yaw("top", 1, false)).toBeGreaterThan(0);
    expect(FieldFacing.yaw("bottom", 1, false)).toBeLessThan(0);
    expect(FieldFacing.yaw("bottom", 2, false)).toBeGreaterThan(0);
  });

  it("a snap replays either way round: up the field to the screen's right, or its left", () => {
    const play = scene("9274")!;
    const left = FootballScript.play(play, -Gridiron.yaw);
    const right = FootballScript.play(play, Gridiron.yaw);
    const downfield = (s: FootballScript) => Gridiron.view({ x: 0, y: 100 }, s.yaw).x - Gridiron.view({ x: 0, y: 0 }, s.yaw).x;
    expect(downfield(right)).toBeGreaterThan(0);
    expect(downfield(left)).toBeLessThan(0);
    expect(left.players.length).toBe(right.players.length);
    expect(left.duration).toBeGreaterThan(2);
  });
});

describe("between snaps", () => {
  const rest = { yard: 37, gain: 47 };
  const first = footballIdle({ play: scene("9274"), stoppage: null, rest, offense: "bottom", down: { down: 1, distance: 10 }, kickoff: false, flipped: false });
  const between = idleScript(first);
  const center = between.players.findIndex((p) => p.key === "c");
  const loop = between.loop!;

  it("between snaps: the line of scrimmage at the real yard line (PHI's 37), the line to gain at the 47, the ball on the spot", () => {
    expect(first.phase.kind).toBe("between");
    expect(between.lines.scrimmage).toBe(Gridiron.y(37));
    expect(between.lines.gain).toBe(Gridiron.y(47));
    expect(Math.abs(between.ball(0)!.y - Gridiron.y(37))).toBeLessThan(0.01);
  });

  it("the huddle a few yards behind the ball, then the center over it at the line for the snap", () => {
    expect(center).toBeGreaterThanOrEqual(0);
    const huddled = between.players[center]!.position(5);
    const lined = between.players[center]!.position(loop.start);
    expect(huddled.y).toBeLessThan(Gridiron.y(37) - 12);
    expect(near(lined, between.players[center]!.at, 0.5)).toBe(true);
    expect(Math.abs(lined.y - (Gridiron.y(37) - 2))).toBeLessThan(0.5);
  });

  it("the looks before the snap come round: the loop ends where it began, and the idle's clock goes round it", () => {
    expect(between.players.every((p) => near(p.position(loop.start), p.position(loop.start + loop.period), 0.5))).toBe(true);
    expect(Math.abs(between.idleTime(loop.start + loop.period * 3 + 2) - (loop.start + 2))).toBeLessThan(1e-6);
    expect(between.idleTime(1.5)).toBe(1.5);
  });

  it("sparse beats: something moves for a few seconds of each loop, and between beats nothing does", () => {
    const moving = between.beats.filter(([a]) => a >= loop.start && a < loop.start + loop.period).reduce((sum, [a, b]) => sum + b - a, 0);
    expect(moving).toBeLessThan(loop.period * 0.45);
    expect(moving).toBeGreaterThan(3);
    for (let t = loop.start; t < loop.start + loop.period; t += 0.25) {
      if (between.moving(t)) continue;
      const still = between.players.every((p) => near(p.position(t), p.position(t + 0.2), 0.01)) || between.moving(t + 0.2);
      expect(still, `still at ${t}`).toBe(true);
    }
  });

  it("…and the next beat after the last comes round the loop", () => {
    expect(between.nextBeat(loop.start + loop.period - 0.01)!).toBeGreaterThan(loop.start + loop.period);
  });

  it("with no snap of its own to go on: the gun on 3rd & 9, a heavy set under center at the 1", () => {
    const gun = footballIdle({ play: null, stoppage: null, rest, offense: "bottom", down: { down: 3, distance: 9 }, kickoff: false, flipped: false });
    const goalLine = footballIdle({ play: null, stoppage: null, rest: { yard: 99, gain: null }, offense: "bottom", down: { down: 1, distance: 1 }, kickoff: false, flipped: false });
    expect(gun.shotgun).toBe(true);
    expect(["base", "empty"]).toContain(gun.formation);
    expect([goalLine.formation, goalLine.shotgun]).toEqual(["heavy", false]);
  });

  it("…else the set the offense just ran", () => {
    const last = scene("9274")!;
    const own = footballIdle({ play: last, stoppage: null, rest, offense: last.offense ?? "bottom", down: null, kickoff: false, flipped: false });
    expect([own.shotgun, own.formation]).toEqual([last.shotgun, last.formation]);
  });

  it("seeded by the entry: the same aftermath always plays the same, another differently", () => {
    const other = footballIdle({ play: scene("3403"), stoppage: null, rest, offense: "bottom", down: null, kickoff: false, flipped: false });
    const again = idleScript(first);
    const at = (s: FootballScript, t: number) => s.players.map((p) => p.position(t));
    expect(at(again, 5)).toEqual(at(between, 5));
    expect(at(again, loop.start + 7)).toEqual(at(between, loop.start + 7));
    expect(again.beats).toEqual(between.beats);
    expect(other.seed).not.toBe(first.seed);
    expect(at(idleScript(other), 5)).not.toEqual(at(between, 5));
  });

  it("PHI's timeout: its men at its own bench (the home team's, across the field), DAL's waiting on the field; tagged in the Eagles' color", () => {
    const stop = stoppage("1100")!;
    const idle = footballIdle({ play: scene("1089") ?? scene("9274"), stoppage: stop, rest: { yard: 91, gain: null }, offense: "bottom", down: { down: 3, distance: 7 }, kickoff: false, flipped: false });
    const s = idleScript(idle);
    const offense = s.players.filter((p) => p.team === "offense");
    const defense = s.players.filter((p) => p.team === "defense");
    expect(idle.phase).toEqual({ kind: "timeout", side: "bottom" });
    expect(offense.every((p) => Math.abs(p.position(8.5).x) > Gridiron.half - 25)).toBe(true);
    expect(defense.every((p) => Math.abs(p.position(8.5).x) < 40)).toBe(true);
    expect(offense.every((p) => p.position(8.5).x > 0 === idle.bench > 0)).toBe(true);
    const status = FootballStatus.idle(idle, stop, s, 12, names, "3rd & 7 at DAL 9", { top: 3, bottom: 2 });
    expect(status).toEqual({ tag: "Timeout · Eagles · 2 left", tint: "06424d" });
    const back = FootballStatus.idle(idle, stop, s, s.loop!.start + 1, names, "3rd & 7 at DAL 9", { top: 3, bottom: 2 });
    expect(back.tag).toBe("Eagles ball · 3rd & 7");
  });

  it("a TV timeout: the field empties to both sidelines, tagged COMMERCIAL BREAK; at 2:00, TWO-MINUTE WARNING", () => {
    const stop = stoppage("9229")!;
    const two = stoppage("1850")!;
    const idle = footballIdle({ play: null, stoppage: stop, rest, offense: "top", down: null, kickoff: false, flipped: false });
    const s = idleScript(idle);
    expect(idle.phase.kind).toBe("commercial");
    expect(s.players.filter((p) => p.team === "offense" || p.team === "defense").every((p) => Math.abs(p.position(8.5).x) > Gridiron.half - 25)).toBe(true);
    expect(FootballStatus.idle(idle, stop, s, 12, names, null, noTimeouts).tag).toBe("Commercial break");
    expect(FootballStatus.idle(idle, two, s, 12, names, null, noTimeouts).tag).toBe("Two-minute warning");
  });

  it("END QUARTER 1: the field turns from the 1st quarter's way to the 2nd's as the teams change ends, tagged END OF 1ST", () => {
    const stop = stoppage("1042")!;
    const idle = footballIdle({ play: null, stoppage: stop, rest: { yard: 88, gain: 98 }, offense: "bottom", down: null, kickoff: false, flipped: false });
    const s = idleScript(idle);
    expect(s.turn).not.toBeNull();
    expect(Math.abs(s.yawAt(0) - FieldFacing.yaw("bottom", 1, false))).toBeLessThan(1e-9);
    expect(Math.abs(s.yawAt(s.turn!.end + 0.1) - FieldFacing.yaw("bottom", 2, false))).toBeLessThan(1e-9);
    expect(s.yawAt(0) * s.yawAt(s.duration)).toBeLessThan(0);
    expect(FootballStatus.idle(idle, stop, s, 2, names, null, noTimeouts).tag).toBe("End of 1st");
    const flipped = footballIdle({ play: null, stoppage: stop, rest: { yard: 88, gain: 98 }, offense: "bottom", down: null, kickoff: false, flipped: true });
    expect(flipped.yaw).toBe(-idle.yaw);
    expect(flipped.phase).toEqual({ kind: "quarter", turnTo: -FieldFacing.yaw("bottom", 2, false) });
  });

  it("halftime: both teams and the officials off, the field empty, HALFTIME", () => {
    const stop = stoppage("2292")!;
    const idle = footballIdle({ play: null, stoppage: stop, rest, offense: "top", down: null, kickoff: false, flipped: false });
    const s = idleScript(idle);
    expect(idle.phase.kind).toBe("off");
    expect(s.players.every((p) => p.opacity(s.duration) < 0.01)).toBe(true);
    expect(s.ball(s.duration)).toBeNull();
    expect(FootballStatus.idle(idle, stop, s, 3, names, null, noTimeouts).tag).toBe("Halftime");
  });

  it("Q.Mitchell hurt: a PHI man (the defense) down, two trainers out to him from the bench, helped off with them, tagged in the Eagles' color", () => {
    const i = items.find((x) => String(x.text ?? "").includes("Q.Mitchell was injured"))!;
    const mitchell = parse(i, teams)!;
    const idle = footballIdle({ play: mitchell, stoppage: null, rest, offense: "top", down: null, kickoff: false, flipped: false });
    const s = idleScript(idle);
    const hurt = s.players.findIndex((p) => p.holds.some((h) => h.kind === "down"));
    const trainers = s.players.filter((p) => p.team === "staff");
    expect(idle.phase).toEqual({ kind: "injury", hurt: { side: "bottom", name: "Q.Mitchell" } });
    expect(s.players[hurt]?.team).toBe("defense");
    expect(trainers.length).toBe(2);
    expect(trainers.every((p) => near(p.position(10), s.players[hurt]!.position(10), 7))).toBe(true);
    expect(s.players[hurt]!.opacity(40)).toBeLessThan(0.01);
    expect(trainers.every((p) => p.opacity(40) < 0.01)).toBe(true);
    expect(FootballStatus.idle(idle, null, s, 10, names, null, noTimeouts)).toEqual({ tag: "Injury · Q.Mitchell", tint: "06424d" });
  });

  it("Atlanta's red flag thrown in from its own bench; the referee at the replay monitor on the near sideline; CHALLENGE · FALCONS, UNDER REVIEW, RULING STANDS", () => {
    const [play] = reviewed("Atlanta challenged")!;
    const idle = footballIdle({ play, stoppage: null, rest: { yard: 99, gain: null }, offense: "bottom", down: null, kickoff: false, flipped: false });
    const s = idleScript(idle);
    const red = s.flags.find((f) => f.red)!;
    expect(red.from.x > 0).toBe(idle.bench > 0);
    expect(Math.abs(red.to.x)).toBeLessThan(Gridiron.half);
    expect(red.lands).toBeLessThan(2);
    const ref = s.players.find((p) => p.team === "official")!;
    expect(Math.abs(ref.position(10).x)).toBeGreaterThan(Gridiron.half);
    expect(ref.position(10).x * FieldFacing.near(s.yaw)).toBeGreaterThan(0);
    const atlNames: StatusNames = { top: "49ers", bottom: "Falcons", topColor: "aa0000", bottomColor: "a71930" };
    const tags = [2, 10, 18].map((t) => FootballStatus.idle(idle, null, s, t, atlNames, null, noTimeouts).tag);
    expect(tags).toEqual(["Challenge · Falcons", "Under review · runner was out of bounds", "Ruling stands"]);
  });

  it("the Rams' challenge won: REVERSED", () => {
    const [rams] = reviewed("Los Angeles Rams challenged")!;
    const idle = footballIdle({ play: rams, stoppage: null, rest, offense: "top", down: null, kickoff: false, flipped: false });
    expect(FootballStatus.idle(idle, null, idleScript(idle), 18, names, null, noTimeouts).tag).toBe("Reversed");
  });

  it("after Pierce's touchdown: PHI lined up to kick off from its 35, no lines on the field", () => {
    const td = scene("1152")!;
    const idle = footballIdle({ play: td, stoppage: null, rest: { yard: 65, gain: null }, offense: "top", down: null, kickoff: true, flipped: false });
    const s = idleScript(idle);
    expect([idle.phase.kind, idle.offense, idle.yard, s.lines.scrimmage]).toEqual(["kickoff", td.scorer, 35, null]);
    expect(s.players.some((p) => p.role === "kicker")).toBe(true);
    expect(Math.abs(s.ball(0)!.y - Gridiron.y(35))).toBeLessThan(0.01);
  });
});

describe("the tag during a snap", () => {
  it("before the flag: the ball and the down; the flag down: FLAG · PASS INTERFERENCE, DEFENSE · 17 YDS, in the flag's yellow", () => {
    const dpi = scene("3335")!.clone();
    dpi.hash = "middle";
    const s = FootballScript.play(dpi);
    const flag = s.flags[0]!;
    expect(FootballStatus.replay(dpi, s, flag.lands - 0.1, names).tag?.startsWith("Cowboys ball · ")).toBe(true);
    expect(FootballStatus.replay(dpi, s, flag.lands + 0.1, names)).toEqual({ tag: "Flag · Pass Interference, Defense · 17 yds", tint: FootballStatus.flagYellow });
  });

  it("…a hold: FLAG · HOLDING, OFFENSE · 7 YDS", () => {
    expect(FootballStatus.flagTag(scene("3169")!)).toBe("Flag · Holding, Offense · 7 yds");
  });
});

describe("every snap replays", () => {
  const snaps = ["9274", "3403", "1477"].map((s) => scene(s)!);
  const now = Date.now();
  let state = footballTheaterQueued([snaps[0]!], null, { play: null, news: false }, true, now);
  state = footballTheaterQueued(snaps, null, state, true, now);

  it("two snaps in one look: both queue behind the first, in order", () => {
    expect(state.play?.id).toBe(snaps[2]!.id);
    expect(state.queue?.map((q) => q.id)).toEqual(snaps.map((s) => s.id));
  });

  it("…each replays in turn, then the field between snaps", () => {
    expect(footballShown(state, null, null, new Set([snaps[0]!.id]))?.id).toBe(snaps[1]!.id);
    expect(footballShown(state, snaps[1]!.id, null, new Set([snaps[0]!.id, snaps[1]!.id]))?.id).toBe(snaps[1]!.id);
    expect(footballShown(state, snaps[2]!.id, snaps[2]!.id, new Set(snaps.map((s) => s.id)))).toBeNull();
  });

  it("the look after the tab was hidden and shown again catches up (history, like opening the page); the next follows on", () => {
    const gaps = new FeedLooks();
    const t0 = Date.now();
    const looked = [gaps.follows(t0), gaps.follows(t0 + 6_000), gaps.follows(t0 + 126_000), gaps.follows(t0 + 132_000)];
    expect(looked).toEqual([true, true, false, true]);
  });

  it("…so the lane's watch takes that look as history: only its newest snap, replayed only if it only just happened; the heartbeat still counts from it", () => {
    const at = items.flatMap((item, i) => (parse(item, teams) ? [i] : []));
    const look = (following: boolean) => {
      const watch = new FootballTheaterWatch();
      watch.update(items.slice(0, at[0]! + 1), teams, false, now);
      watch.update(items.slice(0, at[3]! + 1), teams, true, now + 120_000, undefined, following);
      return watch.state;
    };
    const back = look(false);
    expect(back.news).toBe(false);
    expect(back.queue?.map((q) => q.id)).toEqual([back.play!.id]);
    expect(back.heard).toBe(now + 120_000);
    const on = look(true);
    expect(on.news).toBe(true);
    expect(on.queue?.length).toBeGreaterThan(2);
  });

  it("history (the page just opened) queues nothing", () => {
    const history = footballTheaterQueued(snaps, null, { play: null, news: false }, false, Number.MAX_SAFE_INTEGER);
    expect(history.news).toBe(false);
    expect(history.queue?.map((q) => q.id)).toEqual([snaps[2]!.id]);
  });

  it("a timeout after the snap: on the theater's state with the snap", () => {
    const stop = stoppage("1100")!;
    const stopped = footballTheaterQueued([], stop, state, true, now);
    expect(stopped.stoppage).toEqual(stop);
    expect(stopped.play).toBe(state.play);
  });

  it("the situation's down: 3rd & 7, 1st & Goal; a kickoff has none", () => {
    expect(footballDown("3rd & 7 at PHI 35")).toEqual({ down: 3, distance: 7 });
    expect(footballDown("1st & Goal at DAL 4")?.down).toBe(1);
    expect(footballDown("Kickoff")).toBeNull();
  });

  it("the lane's watch: a timeout posted after the last snap is the theater's stoppage, and the heartbeat counts from the newest entry", () => {
    const until = items.findIndex((i) => String(i.id).endsWith("1100"));
    const watch = new FootballTheaterWatch();
    watch.update(items.slice(0, until + 1), teams, false, now);
    expect(watch.state.stoppage?.id).toBe(String(items[until]!.id));
    expect(watch.state.stoppage?.side).toBe("bottom");
    expect(watch.state.heard).toBe(Date.parse(String(items[until]!.wallclock)));
    // The next snap clears it, and is news once the lane is primed.
    const next = items.slice(0, until + 1).concat(items.slice(until + 1).filter((i) => parse(i, teams) != null).slice(0, 1));
    watch.update(next, teams, true, now + 5000);
    expect(watch.state.stoppage ?? null).toBeNull();
    expect(watch.state.news).toBe(true);
    expect(watch.state.heard).toBe(now + 5000);
  });
});
