/**
 * What the soccer feed says beyond where the ball went
 * (SoccerTheaterTests.swift `soccerFidelity`, check by check), read on the
 * same real clips (test/fixtures/soccer-theater-plays.json, the Swift app's):
 * every touch's credit (athlete, shirt, lineup role), each shot's contact,
 * situation and xGOT, the keeper's own actions, VAR's word on a goal
 * (Newcastle's struck off at Crystal Palace, Gabriel's confirmed), and the
 * summary's starting elevens. Then the plumbing the web adds around them:
 * the lane taking a struck-off goal back from the page's moments, the shot
 * map, the trail and the window; the theater beside it taking it off the
 * stage; the lineups reaching the theater's state.
 */
import { describe, expect, it } from "vitest";
import { parseESPNDetail } from "../../src/data/gameDetail";
import type { JSONValue } from "../../src/data/json";
import { confirmed, REVIEW_MS, SoccerFeed, struckOff, type Review } from "../../src/data/liveFeeds/soccer";
import type { ScoreEvent, Side } from "../../src/data/models";
import { isMoment, keepers, parse, Pitch, playID, readLineups, SoccerLineup, window as moveWindow, type SoccerScene } from "../../src/data/theater/soccerScene";
import { GoalCelebration, retracting, soccerKey, soccerShown, SoccerTheaterWatch, soccerTheaterState, stampDetail } from "../../src/data/theater/soccerTheater";
import { Builder, buildUpLimit, jogSpeed, SoccerScript, type ActionKind } from "../../src/data/theater/soccerScript";
import { liveMoment, Tier } from "../../src/data/moments";
import type { Point } from "../../src/data/mlb/theaterField";
import { actorPose } from "../../src/features/game/soccer/theater/drawSoccer";
import { jointsBreak } from "./rigJoints";
import { fixture } from "./fixtures";

interface Team {
  readonly id: string;
  readonly abbreviation: string;
}
interface Match {
  readonly id: string;
  readonly home: Team;
  readonly away: Team;
  readonly clips: JSONValue[][];
  readonly rosters: JSONValue[];
}
interface Clip {
  readonly plays: readonly JSONValue[];
  readonly home: string;
}

const matches = (fixture("soccer-theater-plays.json") as { matches: Match[] }).matches;
const clips: Clip[] = matches.flatMap((m) => m.clips.map((plays) => ({ plays, home: m.home.id })));
const textOf = (p: JSONValue) => ((p as { text?: string }).text ?? "") as string;
const typeOf = (p: JSONValue) => ((p as { type?: { type?: string } }).type?.type ?? "") as string;

function find(clue: string): { scene: SoccerScene; clip: Clip; index: number } | null {
  for (const clip of clips) {
    const i = clip.plays.findIndex((p) => isMoment(p) && textOf(p).includes(clue));
    if (i < 0) continue;
    const scene = parse(clip.plays, i, clip.home, keepers(clip.plays));
    if (scene) return { scene, clip, index: i };
  }
  return null;
}

const scenes: SoccerScene[] = [];
for (const clip of clips) {
  const found = keepers(clip.plays);
  clip.plays.forEach((p, i) => {
    if (!isMoment(p)) return;
    const scene = parse(clip.plays, i, clip.home, found);
    if (scene) scenes.push(scene);
  });
}
const sideOf = (m: Match) => (team: string | null): Side => (team === m.home.id ? "top" : "bottom");

describe("soccer fidelity: who, exactly", () => {
  const touches = scenes.flatMap((s) => s.touches);

  it("every touch and every shooter is credited exactly: athlete, shirt and lineup role", () => {
    expect(touches.length).toBeGreaterThan(0);
    expect(touches.every((t) => t.credit != null)).toBe(true);
    expect(scenes.every((s) => s.shooterCredit != null)).toBe(true);
  });

  it("the keeper is lineup role 1, never guessed from a name", () => {
    const his = touches.filter((t) => t.keeper);
    expect(his.length).toBeGreaterThan(0);
    expect(his.every((t) => t.credit?.keeper === true)).toBe(true);
    expect(touches.filter((t) => t.credit?.keeper === true && t.defending).every((t) => t.keeper)).toBe(true);
  });

  it("Villa's keeper: Suzuki, role 1, number 1", () => {
    const villa = clips.find((c) => c.plays.some((p) => textOf(p).includes("Rayan Cherki (Manchester City) left footed shot")));
    const suzuki = villa ? keepers(villa.plays)["362"] : undefined;
    expect(suzuki?.name).toBe("Zion Suzuki");
    expect(suzuki?.credit?.keeper).toBe(true);
    expect(suzuki?.credit?.jersey).toBe("1");
  });
});

describe("soccer fidelity: the shot", () => {
  it("Gabriel's header: Opta's head, open play, 0.98 xGOT; White's cross, by athlete ID", () => {
    const s = find("Gabriel Magalhães (Arsenal) header from very close range")!.scene;
    expect(s.shot.contact).toBe("head");
    expect(s.shot.technique).toBe("header");
    expect(s.shot.situation).toBe("openPlay");
    expect(s.shot.xgot ?? 0).toBeGreaterThan(0.9);
    expect(s.assistCredit?.athlete).toBe("241077");
    expect(s.assistKind).toBe("cross");
    expect(s.shooterCredit?.athlete).toBe("236322");
    expect(s.shooterCredit?.jersey).toBe("6");
  });

  it("…confirmed following VAR review: it stays a goal", () => {
    const s = find("Gabriel Magalhães (Arsenal) header from very close range")!.scene;
    expect(s.review).toBe("confirmed");
    expect(s.outcome).toBe("goal");
  });

  it("Cherki's shot: left foot, 0.42 xGOT, saved by the role-1 keeper where his save is logged", () => {
    const s = find("Rayan Cherki (Manchester City) left footed shot from the centre")!.scene;
    expect(s.shot.contact).toBe("leftFoot");
    expect(s.shot.xgot).toBe(0.421);
    expect(s.keeper.credit?.keeper).toBe(true);
    expect(s.keeper.at).not.toBeNull();
    expect(s.keeperActions.some((a) => a.kind === "save" && a.at.x === s.keeper.at?.x && a.at.y === s.keeper.at?.y)).toBe(true);
  });

  it("Haaland's header: a set piece, assisted by number 7", () => {
    const s = find("Erling Haaland (Manchester City) header from very close range")!.scene;
    expect(s.shot.situation).toBe("setPiece");
    expect(s.assistCredit?.jersey).toBe("7");
  });

  it("each touch keeps its real match second, for pacing: varied gaps, all inside the move's window", () => {
    expect(scenes.every((s) => s.touches.every((t) => t.clock <= s.clock && t.clock >= s.clock - moveWindow))).toBe(true);
    expect(scenes.some((s) => new Set(s.touches.slice(1).map((t, i) => t.clock - s.touches[i]!.clock)).size > 2)).toBe(true);
  });
});

describe("soccer fidelity: the keeper's actions", () => {
  it("Ndiaye's chance: Suzuki punched the corner out (and where it landed), then saved; Opta tags it from the corner, a second phase the build-up starts after", () => {
    const s = find("Iliman Ndiaye (Manchester City) left footed shot from the right side")!.scene;
    const punch = s.keeperActions[0];
    expect(s.keeperActions.map((a) => a.kind)).toEqual(["punch", "save"]);
    expect(punch?.to != null && punch.to.x > punch.at.x + 8).toBe(true);
    expect(s.shot.situation).toBe("corner");
    expect(s.start).toBe("openPlay");
  });

  it("every block is credited to the outfield player who made it", () => {
    const blocks = scenes.filter((s) => s.outcome === "blocked");
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.every((s) => s.blocker?.credit != null && !s.blocker.credit.keeper)).toBe(true);
  });
});

// The Palace clip as the feed has it now: Willock's goal retyped "deleted-after-review", and VAR's decision after it.
const palace = clips.find((c) => c.plays.some((p) => typeOf(p) === "deleted-after-review"))!;
const deleted = palace.plays.find((p) => typeOf(p) === "deleted-after-review")!;
const decision = palace.plays.find((p) => typeOf(p) === "var---referee-decision-cancelled")!;
/** Willock's goal as it read before VAR (derived from the retyped entry: its type, the scoring flag and a goal's words, the scores after it). */
const goal: JSONValue = {
  ...(deleted as object),
  type: { type: "goal", text: "Goal" },
  scoringPlay: true,
  homeScore: 0,
  awayScore: 2,
  fieldPositionX: 91.2,
  fieldPositionY: 48.5,
  goalPositionY: 50.1,
  goalPositionZ: 9.5,
  text: "Goal! Crystal Palace 0, Newcastle United 2. Joe Willock (Newcastle United) right footed shot from the centre of the box to the bottom right corner.",
};

describe("soccer fidelity: VAR", () => {
  const willock: Review = { id: "54282228", team: "361", scorer: "259517", clock: 3068, index: 0, since: 0 };
  const osula: Review = { id: "54281457", team: "361", scorer: "319431", clock: 2810, index: 0, since: 0 };

  it("Willock's goal struck off: its entry retyped \"deleted-after-review\", and VAR's \"No Goal\" naming him; Osula's, four minutes before, stands", () => {
    expect([...struckOff([willock, osula], [deleted])]).toEqual(["54282228"]);
    expect([...struckOff([willock, osula], [decision])]).toEqual(["54282228"]);
    expect(struckOff([osula], palace.plays).size).toBe(0);
  });

  it("…a goal struck off is no moment: it never replays", () => {
    expect(palace.plays.some((p) => isMoment(p) && playID(p) === "54282228")).toBe(false);
  });

  it("a goal struck off while it shows leaves the stage (kept aside as overturned), and what came before shows as it ended", () => {
    const found = find("William Osula (Newcastle United)")!;
    const m = matches.find((x) => x.id === "401879254")!;
    const lineups = SoccerLineup.lineups(m.rosters, sideOf(m));
    const showing = { scene: found.scene, news: true, lineups };
    const next = retracting(new Set([found.scene.id]), showing, found.clip.plays, found.clip.home, keepers(found.clip.plays));
    expect(next.scene?.id).not.toBe(found.scene.id);
    expect(next.news).toBe(false);
    expect(next.overturned?.id).toBe(found.scene.id);
    expect(next.overturned?.review).toBe("overturned");
    expect(next.lineups).toBe(lineups);
    expect(Object.keys(lineups).length).toBe(2);
    // Not the one showing: nothing changes.
    expect(retracting(new Set(["1"]), showing, found.clip.plays, found.clip.home, {})).toBe(showing);
  });

  it("\"Goal confirmed following VAR Review.\" settles it", () => {
    expect(confirmed({ type: { type: "goal---header" }, scoringPlay: true, text: "Goal! … with a cross.Goal confirmed following VAR Review." })).toBe(true);
    expect(confirmed({ type: { type: "pass" }, text: "Goal confirmed following VAR Review." })).toBe(false);
  });
});

describe("soccer fidelity: lineups", () => {
  const shapes = new Map<string, SoccerLineup>();
  for (const m of matches) {
    const lineups = SoccerLineup.lineups(m.rosters, sideOf(m));
    for (const side of ["top", "bottom"] as const) {
      const lineup = lineups[side];
      if (lineup) shapes.set((side === "top" ? m.home : m.away).abbreviation, lineup);
    }
  }
  const at = (team: string, position: string) => shapes.get(team)?.players.find((p) => p.position === position);

  it("all fourteen starting elevens, every man with a spot on the pitch", () => {
    expect(shapes.size).toBe(14);
    for (const l of shapes.values()) {
      expect(l.players.length).toBe(11);
      expect(l.players.every((p) => p.spot.x >= 0 && p.spot.x <= 100 && p.spot.y >= 0 && p.spot.y <= 100)).toBe(true);
    }
  });

  it("Arsenal's 4-2-3-1: RM and LM are the holding pair, central; three behind the striker; the back four", () => {
    expect(shapes.get("ARS")?.formation).toBe("4-2-3-1");
    const pair = [at("ARS", "RM"), at("ARS", "LM")];
    expect(pair.every((p) => p != null && p.line === 2 && p.spot.y >= 30 && p.spot.y <= 70)).toBe(true);
    expect(pair[0]!.spot.y).toBeLessThan(pair[1]!.spot.y);
    expect([at("ARS", "AM-R"), at("ARS", "AM"), at("ARS", "AM-L")].map((p) => p?.spot.y)).toEqual([28, 50, 72]);
    expect(at("ARS", "RB")?.line).toBe(1);
    expect(at("ARS", "RB")!.spot.y).toBeLessThan(20);
    expect(at("ARS", "F")?.line).toBe(4);
    expect(at("ARS", "G")?.line).toBe(0);
  });

  it("Chelsea's 3-4-2-1: the same RM and LM are the wing-backs, out wide; three at the back", () => {
    const che = shapes.get("CHE")!;
    expect(che.formation).toBe("3-4-2-1");
    expect(at("CHE", "RM")?.line).toBe(2);
    expect(at("CHE", "RM")!.spot.y).toBeLessThan(20);
    expect(at("CHE", "LM")?.line).toBe(2);
    expect(at("CHE", "LM")!.spot.y).toBeGreaterThan(80);
    expect(at("CHE", "CF-R")?.line).toBe(3);
    expect(at("CHE", "F")?.line).toBe(4);
    expect(che.players.filter((p) => p.line === 1).length).toBe(3);
  });

  it("Hull's 5-4-1: five at the back, one up", () => {
    const hul = shapes.get("HUL")!;
    expect(hul.formation).toBe("5-4-1");
    expect(hul.players.filter((p) => p.line === 1).length).toBe(5);
    expect(at("HUL", "F")?.line).toBe(3);
  });

  it("on the pitch: the striker past halfway toward the goal his team attacks, the keeper on his line", () => {
    const ars = shapes.get("ARS")!;
    const striker = at("ARS", "F")!;
    const keeper = at("ARS", "G")!;
    expect(ars.spot(striker.athlete, true)!.x).toBeGreaterThan(Pitch.length / 2);
    expect(ars.spot(striker.athlete, false)!.x).toBeLessThan(Pitch.length / 2);
    expect(ars.spot(keeper.athlete, true)!.x).toBeLessThan(Pitch.sixDepth);
  });

  it("the lineups ride along on the theater's state", () => {
    const m = matches[0]!;
    const lineups = SoccerLineup.lineups(m.rosters, sideOf(m));
    expect(soccerTheaterState(scenes[0]!, { scene: null, news: false, lineups }, true, Date.now()).lineups).toBe(lineups);
  });
});

// MARK: - The plumbing (web): the lane, the theater beside it, the page's summary

/** A lane served one clip's plays as pages, as ESPN has them now (a clock the test moves). */
function lane(served: () => readonly JSONValue[]) {
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    calls.push(url);
    const all = served();
    const page = Number(/page=(\d+)/.exec(url)?.[1]);
    const limit = Number(/limit=(\d+)/.exec(url)?.[1]);
    return { count: all.length, pageCount: Math.max(1, Math.ceil(all.length / limit)), items: all.slice((page - 1) * limit, page * limit) };
  };
  return { calls, fetcher };
}

describe("soccer fidelity: a goal struck off, on the page", () => {
  const at = palace.plays.indexOf(deleted);
  const before = palace.plays.slice(0, at);
  /** The plays as the page reads them: up to the goal; then VAR's decision with the goal retyped. */
  let stage: "goal" | "struck" = "goal";
  // The fixture drops a score of 0 (its trimming); the feed sends it.
  const served = () => (stage === "goal" ? [...before, goal] : [...before, deleted, { ...(decision as object), homeScore: 0 }]);
  const update = (feed: SoccerFeed, f: ReturnType<typeof lane>) => feed.update(f.fetcher, { league: "eng.1", eventID: "401879254", homeTeamID: palace.home });

  it("the lane takes it back: off the shot map, the trail and the window; the page's moment retracted; the theater's stage on what came before", async () => {
    let now = Date.parse("2026-10-25T15:07:51Z");
    const feed = new SoccerFeed(() => now);
    const f = lane(served);
    const watch = new SoccerTheaterWatch();
    const follow = (primed: boolean) => watch.update(feed.plays, palace.home, primed, now, { struck: feed.struck, rosters: feed.rosters });
    // The first look, a few seconds after the goal: history, but open to review (its wallclock is recent).
    stage = "goal";
    await update(feed, f);
    follow(false);
    expect(feed.shots.some((s) => s.playID === "54282228" && s.kind === "goal")).toBe(true);
    expect(watch.state.scene?.id).toBe("54282228");
    // It replays (it only just happened).
    expect(watch.state.news).toBe(true);
    expect(feed.takeMoments()).toEqual([]);
    // VAR: the goal retyped, the decision after it. The lane reads its page again.
    now += 70_000;
    stage = "struck";
    await update(feed, f);
    expect(f.calls.at(-1)).toContain("page=");
    expect(feed.takeRetractions()).toEqual(["54282228"]);
    expect(feed.takeRetractions()).toEqual([]);
    expect([...feed.struck]).toEqual(["54282228"]);
    expect(feed.shots.some((s) => s.playID === "54282228")).toBe(false);
    expect(feed.trail.some((s) => s.playID === "54282228")).toBe(false);
    expect(feed.plays.some((p) => playID(p) === "54282228" && typeOf(p) === "goal")).toBe(false);
    // The lane's score counted it: the decision's own score now (0–1), not 0–2.
    expect(feed.score).toEqual({ top: 0, bottom: 1 });
    // No new moment for it, and the theater takes it off the stage, never to celebrate it.
    expect(feed.takeMoments().some((m) => m.id === "54282228")).toBe(false);
    expect(follow(true)).toBe(true);
    expect(watch.state.scene?.id).not.toBe("54282228");
    expect(watch.state.news).toBe(false);
    expect(watch.state.overturned?.id).toBe("54282228");
    expect(watch.state.overturned?.review).toBe("overturned");
    expect(soccerShown(watch.state, "54282228", null)).toBeNull();
    // Nothing more: nothing changes.
    expect(follow(true)).toBe(false);
  });

  it("struck off before the page ever showed it: it never arrives", async () => {
    stage = "struck";
    const now = Date.parse("2026-10-25T15:09:30Z");
    const feed = new SoccerFeed(() => now);
    // On a page already open: the goal and VAR's decision in the same look.
    stage = "goal";
    const f = lane(() => before);
    await feed.update(f.fetcher, { league: "eng.1", eventID: "401879254", homeTeamID: palace.home });
    const g = lane(() => [...before, goal, decision]);
    await feed.update(g.fetcher, { league: "eng.1", eventID: "401879254", homeTeamID: palace.home });
    expect(feed.takeRetractions()).toEqual(["54282228"]);
    expect(feed.takeMoments().some((m) => m.id === "54282228")).toBe(false);
    expect(feed.shots.some((s) => s.playID === "54282228")).toBe(false);
    expect(feed.plays.some((p) => playID(p) === "54282228")).toBe(false);
  });

  it("a goal confirmed by VAR stays: its review closes, nothing is taken back", async () => {
    let now = Date.parse("2026-10-25T15:07:51Z");
    const feed = new SoccerFeed(() => now);
    const f1 = lane(() => [...before, goal]);
    await feed.update(f1.fetcher, { league: "eng.1", eventID: "401879254", homeTeamID: palace.home });
    now += 60_000;
    const stood = { ...(goal as object), text: `${textOf(goal)}Goal confirmed following VAR Review.` };
    const f2 = lane(() => [...before, stood]);
    await feed.update(f2.fetcher, { league: "eng.1", eventID: "401879254", homeTeamID: palace.home });
    expect(feed.takeRetractions()).toEqual([]);
    expect(feed.shots.some((s) => s.playID === "54282228" && s.kind === "goal")).toBe(true);
    // The window takes the reworded entry.
    expect(textOf(feed.plays.find((p) => playID(p) === "54282228"))).toContain("confirmed following VAR");
    // Its review is closed: a later "No Goal" can't take it back.
    now += 30_000;
    const f3 = lane(() => [...before, stood, decision]);
    await feed.update(f3.fetcher, { league: "eng.1", eventID: "401879254", homeTeamID: palace.home });
    expect(feed.takeRetractions()).toEqual([]);
  });

  it("a review stays open five minutes, then the lane reads only the tail again", async () => {
    let now = Date.parse("2026-10-25T15:07:51Z");
    const feed = new SoccerFeed(() => now);
    const many = [...before, goal, ...Array.from({ length: 60 }, (_, i) => ({ id: `x${i}`, type: { type: "pass" }, team: { $ref: "/teams/384" }, clock: { value: 3100 + i } }))];
    const f = lane(() => many);
    await feed.update(f.fetcher, { league: "eng.1", eventID: "401879254", homeTeamID: palace.home });
    now += 60_000;
    await feed.update(f.fetcher, { league: "eng.1", eventID: "401879254", homeTeamID: palace.home });
    // The goal sits on the first page of 25: read again from there.
    expect(f.calls.some((u, i) => i > 0 && u.endsWith("limit=25&page=1"))).toBe(true);
    const asked = f.calls.length;
    now += REVIEW_MS + 1;
    await feed.update(f.fetcher, { league: "eng.1", eventID: "401879254", homeTeamID: palace.home });
    expect(f.calls.slice(asked).some((u) => u.endsWith("limit=25&page=1"))).toBe(false);
  });
});

describe("soccer fidelity: the lineups reach the theater", () => {
  const m = matches.find((x) => x.home.abbreviation === "ARS")!;

  it("the summary's rosters, by side (GameDetail's `soccerRosters`), read as both starting elevens", () => {
    const event = {
      id: m.id,
      content: { kind: "match", top: { id: `espn-${m.home.id}` }, bottom: { id: `espn-${m.away.id}` } },
    } as unknown as ScoreEvent;
    const detail = parseESPNDetail({ rosters: m.rosters }, { event, path: "soccer/eng.1", id: m.id, sport: "soccer" });
    expect(Object.keys(detail.soccerRosters).sort()).toEqual(["bottom", "top"]);
    const lineups = readLineups(detail.soccerRosters);
    expect(lineups.top?.team).toBe(m.home.id);
    expect(lineups.top?.formation).toBe("4-2-3-1");
    expect(lineups.bottom?.team).toBe(m.away.id);
  });

  it("the lane carries them to the theater beside it, once, and keeps them as moments come", async () => {
    const rosters = { top: m.rosters.find((r) => (r as { team: { id: string } }).team.id === m.home.id), bottom: m.rosters.find((r) => (r as { team: { id: string } }).team.id === m.away.id) };
    const clip = clips.find((c) => c.home === m.home.id)!;
    const feed = new SoccerFeed();
    let renders = 0;
    feed.subscribe(() => renders++);
    const f = lane(() => clip.plays);
    await feed.update(f.fetcher, { league: "eng.1", eventID: m.id, homeTeamID: m.home.id, rosters });
    expect(feed.rosters).toBe(rosters);
    const watch = new SoccerTheaterWatch();
    expect(watch.update(feed.plays, m.home.id, false, Date.UTC(2030, 0, 1), { struck: feed.struck, rosters: feed.rosters })).toBe(true);
    expect(watch.state.lineups?.top?.formation).toBe("4-2-3-1");
    expect(watch.state.scene).not.toBeNull();
    // The same rosters again (a new summary, the same elevens): no new render.
    const seen = renders;
    await feed.update(f.fetcher, { league: "eng.1", eventID: m.id, homeTeamID: m.home.id, rosters: JSON.parse(JSON.stringify(rosters)) });
    expect(renders).toBe(seen);
    expect(watch.update(feed.plays, m.home.id, true, Date.UTC(2030, 0, 1), { struck: feed.struck, rosters: feed.rosters })).toBe(false);
  });
});

/**
 * The choreography reading every field, on the same real clips
 * (SoccerTheaterTests.swift `soccerSequencing`): all 22 in their lineups'
 * shape, each touch at its real pace, the foot or head Opta logs, the
 * assist's kind, the keeper's own actions (Petrovic's punch from a corner,
 * mid-move, in the clip that made the ball jump), a set piece's crowded box,
 * and VAR's NO GOAL.
 */
describe("soccer theater: every touch in the order and at the pace it happened", () => {
  interface Sequenced {
    readonly plays: readonly JSONValue[];
    readonly home: string;
    readonly lineups: ReturnType<typeof SoccerLineup.lineups>;
  }
  const sequenced: Sequenced[] = matches.flatMap((m) => {
    const lineups = SoccerLineup.lineups(m.rosters, sideOf(m));
    return m.clips.map((plays) => ({ plays, home: m.home.id, lineups }));
  });
  const findIn = (clue: string): { scene: SoccerScene; clip: Sequenced } | null => {
    for (const clip of sequenced) {
      const i = clip.plays.findIndex((p) => isMoment(p) && textOf(p).includes(clue));
      if (i < 0) continue;
      const scene = parse(clip.plays, i, clip.home, keepers(clip.plays));
      if (scene) return { scene, clip };
    }
    return null;
  };
  const near = (a: Point | null | undefined, b: Point | null | undefined, tolerance: number) => a != null && b != null && Math.hypot(a.x - b.x, a.y - b.y) <= tolerance;
  const acts = (script: SoccerScript, kind: ActionKind) => script.actors.flatMap((a) => a.actions.filter((x) => x.kind === kind));

  it("Cunha's chance: Petrovic punches Mount's corner from over his head, to where the feed says it landed", () => {
    const found = findIn("Matheus Cunha (Manchester United) header")!;
    expect(found).not.toBeNull();
    const { scene: s, clip } = found;
    const script = SoccerScript.build(s, clip.lineups);
    const keeper = script.actors.findIndex((a) => a.team === "defending" && a.role === "keeper");
    const punch = s.keeperActions.find((a) => a.kind === "punch");
    const punched = keeper >= 0 ? script.actors[keeper]!.actions.find((a) => a.kind === "punch") : undefined;
    const away = punched ? script.flights.find((f) => Math.abs(f.start - punched.at) < 0.01) : undefined;
    expect(punch).toBeDefined();
    expect(punched).toBeDefined();
    expect(Math.abs(away!.from.z - 2.5)).toBeLessThan(0.01);
    expect(near(away!.to, punch!.to, 0.5)).toBe(true);
  });

  it("…the header from his head, met there by the ball that came to it: no flight starts higher or lower than the last came down; the duels before it in the air, up for them", () => {
    const { scene: s, clip } = findIn("Matheus Cunha (Manchester United) header")!;
    const script = SoccerScript.build(s, clip.lineups);
    const shot = script.shot != null ? script.flights[script.shot] : undefined;
    let into: (typeof script.flights)[number] | undefined;
    for (const f of script.flights) if (f.end <= script.strike + 0.01 && f.kind !== "shot") into = f;
    expect(Math.abs(shot!.from.z - 1.95)).toBeLessThan(0.01);
    expect(Math.abs(into!.to.z - 1.95)).toBeLessThan(0.01);
    const jumps = script.flights.slice(1).filter((b, k) => {
      const a = script.flights[k]!;
      return b.start <= a.end + 0.2 && Math.hypot(b.from.x - a.to.x, b.from.y - a.to.y) < 1.5 && !(Math.abs(b.from.z - a.to.z) < 0.01);
    });
    expect(jumps.map((f) => `${f.from.z.toFixed(2)}`)).toEqual([]);
    expect(script.actors.some((a) => a.actions.some((x) => x.kind === "aerial"))).toBe(true);
  });

  it("Cherki strikes it with his left foot, as Opta logs it (the strike mirrored); Gabriel with his head", () => {
    const { scene: s } = findIn("Rayan Cherki (Manchester City) left footed shot from the centre")!;
    const script = SoccerScript.build(s);
    const strike = acts(script, "kick").find((a) => Math.abs(a.at - script.strike) < 0.01);
    expect(s.shot.contact).toBe("leftFoot");
    expect(strike?.left).toBe(true);
    const gabriel = SoccerScript.build(findIn("Gabriel Magalhães (Arsenal) header from very close range")!.scene);
    expect(acts(gabriel, "header").some((a) => Math.abs(a.at - gabriel.strike) < 0.01)).toBe(true);
  });

  it("every move at its real pace: each touch's beat its gap on the match clock, squeezed by one factor to fit five seconds, never quicker than the ball can go; and a move that fits plays in real time", () => {
    let proportional = 0;
    let measured = 0;
    let realTime = 0;
    let short = 0;
    for (const clip of sequenced) {
      clip.plays.forEach((p, i) => {
        if (!isMoment(p)) return;
        const s = parse(clip.plays, i, clip.home, keepers(clip.plays));
        if (!s || s.shot.penalty) return;
        const b = new Builder(s);
        const touches = b.shown(s.touches);
        if (touches.length < 2) return;
        const plan = b.beats(touches);
        const gaps = b.gaps(touches);
        const floors = touches.map((_, k) => b.least(touches, k));
        measured += 1;
        // Where the speed limits don't bind, each beat is its real gap times one factor.
        const free = touches.map((_, k) => k).filter((k) => plan.beats[k]! > floors[k]! + 1e-6);
        if (free.every((k) => Math.abs(plan.beats[k]! - gaps[k]! * plan.compression) < 1e-6) && plan.beats.reduce((a, x) => a + x, 0) <= buildUpLimit + 0.01) proportional += 1;
        if (touches.reduce((sum, _, k) => sum + Math.max(gaps[k]!, floors[k]!), 0) <= buildUpLimit) {
          short += 1;
          if (plan.compression === 1 && touches.every((_, k) => plan.beats[k] === Math.max(gaps[k]!, floors[k]!))) realTime += 1;
        }
      });
    }
    console.log(`    pace: ${proportional} of ${measured} proportional; ${realTime} of ${short} in real time`);
    expect(measured).toBeGreaterThanOrEqual(15);
    expect(proportional).toBe(measured);
    expect(short).toBeGreaterThan(0);
    expect(realTime).toBe(short);
  });

  it("Gvardiol's headed pass to Fernández: he heads it on, the ball coming to him at head height", () => {
    const { scene: s, clip } = findIn("Enzo Fernández (Manchester City) right footed shot from the centre of the box is blocked")!;
    const script = SoccerScript.build(s, clip.lineups);
    const assister = script.actors.find((a) => a.athlete != null && a.athlete === s.assistCredit?.athlete);
    const header = assister?.actions.find((a) => a.kind === "header" || a.kind === "aerial");
    let into: (typeof script.flights)[number] | undefined;
    if (header) for (const f of script.flights) if (Math.abs(f.end - header.at) < 0.4 && f.end <= header.at + 0.01) into = f;
    expect(s.assistKind).toBe("headedPass");
    expect(header).toBeDefined();
    expect(Math.abs(into!.to.z - 1.9)).toBeLessThan(0.01);
  });

  it("a through ball: played into space, and he runs onto it at speed", () => {
    const { scene, clip } = findIn("Harvey Barnes (Newcastle United)")!;
    const before = SoccerScript.build(scene, clip.lineups);
    const through = SoccerScript.build({ ...scene, assistKind: "throughBall" }, clip.lineups);
    const pace = (script: SoccerScript) => {
      let pass: (typeof script.flights)[number] | undefined;
      for (const f of script.flights) if (f.kind === "pass" && f.end <= script.strike + 0.01) pass = f;
      if (!pass) return 0;
      const runner = script.actors.find((a) => near(a.position(pass.end), pass.to, 0.6) && a.team === "attacking");
      if (!runner) return 0;
      const a = runner.position(pass.end - 0.15);
      const b = runner.position(pass.end);
      return Math.hypot(b.x - a.x, b.y - a.y) / 0.15;
    };
    console.log(`    through ball: ${pace(through).toFixed(1)} m/s vs ${pace(before).toFixed(1)}`);
    expect(pace(through)).toBeGreaterThan(4);
    expect(pace(through)).toBeGreaterThan(pace(before));
  });

  it("Gabriel's header with both elevens: 22 on the pitch, one keeper each, every man who touched the ball once, as himself; Everton's back line deep, the shape at a jog, the attack onside", () => {
    const { scene: s, clip } = findIn("Gabriel Magalhães (Arsenal) header from very close range")!;
    const script = SoccerScript.build(s, clip.lineups);
    const attackers = script.actors.filter((a) => a.team === "attacking");
    const defenders = script.actors.filter((a) => a.team === "defending");
    const athletes = script.actors.flatMap((a) => a.athlete ?? []);
    expect(attackers.length).toBe(11);
    expect(defenders.length).toBe(11);
    expect(script.actors.filter((a) => a.role === "keeper").length).toBe(2);
    expect(new Set(athletes).size).toBe(athletes.length);
    expect(s.touches.every((t) => (t.credit ? athletes.includes(t.credit.athlete) : true))).toBe(true);
    const t = script.strike;
    const shaped = script.actors.filter((a) => a.shaped);
    const backLine = new Set(clip.lineups.bottom?.players.filter((p) => p.line === 1).map((p) => p.athlete) ?? []);
    const back = defenders.filter((a) => a.shaped && a.athlete != null && backLine.has(a.athlete));
    const xs = back.map((a) => a.position(t).x);
    console.log(`    Everton's back line at the cross: ${JSON.stringify(xs.map((x) => Math.trunc(x)))}`);
    expect(back.length).toBeGreaterThan(0);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(8);
    expect(xs.every((x) => x > Pitch.length - 30)).toBe(true);
    const fastest = Math.max(0, ...shaped.flatMap((a) => a.moves.map((m) => m.length / Math.max(m.end - m.start, 0.01))));
    expect(fastest).toBeLessThanOrEqual(jogSpeed + 0.01);
    const goalSide = script.actors.filter((a) => a.team === "defending" && a.role !== "keeper").map((a) => a.position(t).x).sort((a, b) => b - a);
    const offside = goalSide.length > 1 ? goalSide[0]! : Pitch.length;
    const ball = script.ball(t)?.x ?? 0;
    expect(attackers.filter((a) => a.shaped).every((a) => a.position(t).x <= Math.max(offside, ball) + 1.5)).toBe(true);
  });

  it("a corner: Everton packed into its box (all but one up the pitch) as it's swung in", () => {
    const { scene: s, clip } = findIn("Ezri Konsa (Arsenal) right footed shot from very close range")!;
    const script = SoccerScript.build(s, clip.lineups);
    const box = script.actors.filter((a) => a.team === "defending" && a.shaped && a.role !== "keeper");
    const inside = box.filter((a) => {
      const p = a.position(0.2);
      return p.x > Pitch.length - Pitch.boxDepth - 1 && Math.abs(p.y - Pitch.width / 2) < Pitch.boxWidth / 2 + 2;
    });
    expect(s.start).toBe("corner");
    expect(box.length).toBeGreaterThanOrEqual(8);
    expect(inside.length).toBeGreaterThanOrEqual(box.length - 1);
  });

  it("a goal from a set piece says so, as Opta tags it", () => {
    const { scene: s } = findIn("Erling Haaland (Manchester City) header from very close range")!;
    expect(stampDetail(s)).toContain("SET PIECE");
    expect(stampDetail(s).startsWith("ASSISTED BY")).toBe(true);
  });

  it("Osula's goal struck off by VAR: it goes in, he wheels away, and NO GOAL lands (no confetti, no celebration, no fireworks); replayed once more while the decision is fresh, then the pitch goes quiet", () => {
    const { scene: osula, clip } = findIn("William Osula (Newcastle United)")!;
    const when = osula.wallclock!;
    const showing = { scene: osula, news: true, lineups: clip.lineups };
    const struck = retracting(new Set([osula.id]), showing, clip.plays, clip.home, keepers(clip.plays));
    const off = struck.overturned!;
    expect(off).toBeDefined();
    const script = SoccerScript.build(off, clip.lineups);
    const scorer = script.actors.find((a) => a.athlete === osula.shooterCredit?.athlete);
    expect(script.banners.map((b) => b.text)).toEqual(["NO GOAL"]);
    expect(script.banners.every((b) => !b.confetti && b.tone === "neutral")).toBe(true);
    expect(script.impacts.some((i) => i.kind === "net")).toBe(true);
    expect(scorer?.actions.some((a) => a.kind === "dejected")).toBe(true);
    expect(scorer?.actions.some((a) => a.kind === "celebrate")).toBe(false);
    expect(stampDetail(off)).toBe("GOAL OVERTURNED BY VAR");
    const m = { ...liveMoment({ id: off.id, chart: "pitch", tier: Tier.score, kind: "goal", lead: "Goal", detail: "" }), burst: true };
    expect(GoalCelebration.theater(m, off, script, "full", false, 320)).toEqual([]);
    expect(soccerShown(struck, null, null, when + 150_000)).toBe(off);
    expect(soccerShown(struck, soccerKey(off), soccerKey(off), when + 150_000)).toBeNull();
    expect(soccerShown(struck, null, null, when + 3_600_000)).toBeNull();
    expect(soccerKey(off)).not.toBe(off.id);
  });

  const full: [SoccerScene, SoccerScript][] = [];
  for (const clip of sequenced) {
    const found = keepers(clip.plays);
    clip.plays.forEach((p, i) => {
      if (!isMoment(p)) return;
      const scene = parse(clip.plays, i, clip.home, found);
      if (scene) full.push([scene, SoccerScript.build(scene, clip.lineups)]);
    });
  }

  it("every moment with its lineups: eleven a side, everyone on the pitch, every frame", () => {
    const eleven = (s: SoccerScript, team: "attacking" | "defending") => s.actors.filter((a) => a.team === team).length === 11;
    const whole = full.filter(([, s]) => eleven(s, "attacking") && eleven(s, "defending"));
    const onPitch = (p: Point) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x > -6 && p.x < Pitch.length + 6 && p.y > -4 && p.y < Pitch.width + 4;
    const finite = full.every(([, s]) => {
      for (let k = 0; k * 0.05 <= s.duration; k++) if (!s.actors.every((a) => onPitch(a.position(k * 0.05)))) return false;
      return true;
    });
    console.log(`    with both elevens: ${whole.length} of ${full.length}`);
    expect(whole.length).toBe(full.length);
    expect(finite).toBe(true);
  });

  it("the new poses (a leap for a header, the keeper's punch and claim, a left foot's strike), every blend: knees and elbows bend their own way", { timeout: 180_000 }, () => {
    const broken = full.flatMap(([scene, s]) => {
      const where = jointsBreak(s.duration, s.actors.length, (i, t) => actorPose(s, s.actors[i]!, i, t, s.actors[i]!.position(t), 1.1 / 2.5)[0]);
      return where ? [`${scene.shooter}: ${where}`] : [];
    });
    expect(broken.slice(0, 3)).toEqual([]);
  });
});
