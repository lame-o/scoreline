/**
 * Click a play, watch it (data/replays.ts, data/replayReaders.ts, each
 * sport's replay module), checked on real games, as Tests/ReplayTests.swift
 * checks it: which rows of a game page replay in the isometric view, per
 * sport (the World Series game's summary, Monday Night Football's core
 * plays, the Spurs at the Jazz, Aston Villa v Man City as the soccer lane
 * reads it); that each replay's scene is the one the live theater builds
 * for the same play; the takes it plays and which way they face; the open
 * row; and the running order of a replay's takes. The fixtures are the
 * Mac's: the MLB summary and the soccer match's core plays from
 * Tests/Fixtures (read in place), the rest copied in test/fixtures.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { JSONValue } from "../../src/data/json";
import { baseballMoment, theaterAfter } from "../../src/data/liveFeeds/baseball";
import type { Teams as HoopsTeams } from "../../src/data/liveFeeds/basketball";
import type { FootballTeams } from "../../src/data/liveFeeds/football";
import { SoccerFeed } from "../../src/data/liveFeeds/soccer";
import type { ScoreEvent } from "../../src/data/models";
import { Tier } from "../../src/data/moments";
import { parse as parsePlay, theater } from "../../src/data/mlb/playScene";
import type { Rest } from "../../src/data/mlb/playScript";
import { basketballReplays, BasketballReplays, baseballReplays, FootballReplays, footballReplays, SoccerReplays } from "../../src/data/replayReaders";
import { merged, replayPlayOf, ReplayClock, ReplayOpening, replaysSupported, type PlayReplay, type ReplayRow } from "../../src/data/replays";
import { parseScene, replays as replaysInFull, type BasketballScene } from "../../src/data/theater/basketballScene";
import { FieldFacing } from "../../src/data/theater/footballIdle";
import { parse as parseSnap, type FootballScene } from "../../src/data/theater/footballScene";
import { spot } from "../../src/data/theater/footballTheater";
import { attacksRight, type SoccerScene } from "../../src/data/theater/soccerScene";
import { SoccerTheaterWatch } from "../../src/data/theater/soccerTheater";
import { baseballTakes } from "../../src/features/game/mlb/theater/replayPlate";
import { footballTakes } from "../../src/features/game/football/theater/replayField";
import { basketballTakes } from "../../src/features/game/nba/theater/replayCourt";
import { soccerTakes } from "../../src/features/game/soccer/theater/replayPitch";
import { PageReplays } from "../../src/features/game/core/replay/pageReplays";
import { fixture, sharedFixture } from "./fixtures";

type Item = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const idOf = (p: unknown) => str((p as Item | undefined)?.id);
const typeOf = (p: unknown) => str(((p as Item).type as Item | undefined)?.type);

// MARK: - The open row

describe("the open row", () => {
  it("opens one row at a time, the same play in another list being a row of its own", () => {
    const first: ReplayRow = { section: "moments", play: "1" };
    const same: ReplayRow = { section: "plays", play: "1" };
    const other: ReplayRow = { section: "moments", play: "2" };
    let o = new ReplayOpening();
    o = o.toggle(first);
    expect(o.row).toEqual(first); // a click opens its row
    o = o.toggle(other);
    expect(o.row).toEqual(other); // opening another row closes the first: one open at a time
    o = o.toggle(other);
    expect(o.row).toBeNull(); // the open row, clicked again, closes
    o = o.toggle(first).toggle(same);
    expect(o.row).toEqual(same); // the same play in the other list is a row of its own
    const closed = o.close();
    expect(closed.closed && closed.opening.row == null && !closed.opening.close().closed).toBe(true); // Esc closes it (and says so only when something was open)
    o = closed.opening.toggle(other).keep((p) => p !== "2");
    expect(o.row).toBeNull(); // a row whose play can't replay any more closes
    o = o.toggle(first).keep(() => true);
    expect(o.row).toEqual(first); // …and one that still can stays open
  });

  it("keeps the glyph's place from the start in the four sports with an isometric view, and never in the others", () => {
    const event = (ref: ScoreEvent["ref"]): ScoreEvent => ({ id: "e", ref }) as unknown as ScoreEvent;
    expect(replaysSupported(event({ kind: "espn", path: "soccer/eng.1", id: "1", sport: "soccer" }))).toBe(true);
    expect(replaysSupported(event({ kind: "espn", path: "basketball/nba", id: "1", sport: "basketball" }))).toBe(true);
    expect(replaysSupported(event({ kind: "espn", path: "basketball/wnba", id: "1", sport: "basketball" }))).toBe(false);
    expect(replaysSupported(event({ kind: "counterStrike", slug: "x", tournament: null }))).toBe(false);
    expect(new PageReplays(event({ kind: "espn", path: "football/nfl", id: "1", sport: "football" })).supported).toBe(true);
  });

  it("closes on Esc only when something is open, and closes a row whose play is gone (PageReplays)", () => {
    const store = new PageReplays({ id: "e", ref: { kind: "espn", path: "baseball/mlb", id: "1", sport: "baseball" } } as unknown as ScoreEvent);
    const replay = { scene: { kind: "soccer" }, moment: null } as unknown as PlayReplay;
    store.update({ a: replay });
    store.toggle({ section: "moments", play: "a" });
    expect(store.open?.play).toBe("a");
    store.update({ b: replay });
    expect(store.open).toBeNull();
    expect(store.close()).toBe(false);
    store.toggle({ section: "plays", play: "b" });
    expect(store.close()).toBe(true);
  });
});

// MARK: - Running order

describe("running order", () => {
  const near = (p: { take: number; t: number }, take: number, t: number) => p.take === take && (Number.isFinite(t) ? Math.abs(p.t - t) < 1e-9 : !Number.isFinite(p.t));

  it("one take: it plays from its start, then holds as it ended", () => {
    const one = new ReplayClock([4]);
    expect(one.end).toBe(4);
    expect(near(one.position(0), 0, 0) && near(one.position(2.5), 0, 2.5) && near(one.position(4), 0, Infinity)).toBe(true);
  });

  it("a touchdown, then its try a breath (0.3 s) after, its formation standing through it; held at the try's end", () => {
    const two = new ReplayClock([5, 2]);
    expect(Math.abs(two.end - 7.3) < 1e-9).toBe(true);
    expect(near(two.position(4.9), 0, 4.9)).toBe(true);
    expect(near(two.position(5.1), 1, -0.2)).toBe(true);
    expect(near(two.position(5.3), 1, 0)).toBe(true);
    expect(near(two.position(7.2), 1, 1.9)).toBe(true);
    expect(near(two.position(9), 1, Infinity)).toBe(true);
  });
});

// MARK: - Baseball

describe("baseball", () => {
  const summary = sharedFixture("3bd207fad0c0e7da8976ca99.bin") as { plays: JSONValue[] };
  const plays = summary.plays;
  // TB (30) visiting, the top team; MIL (8) at home.
  const side = (id: string | null | undefined) => (id === "30" ? ("top" as const) : id === "8" ? ("bottom" as const) : null);
  const results = plays.flatMap((p, i) => (typeOf(p) === "play-result" ? [i] : []));
  // The page's rows: the scoring list, and the last four results (the plays list).
  const scoring = results.filter((i) => (plays[i] as Item).scoringPlay === true);
  const recent = results.slice(-4);
  const rows = new Set([...scoring, ...recent].flatMap((i) => idOf(plays[i]) ?? []));
  const built = baseballReplays(plays, rows, side, {});
  const drawable = new Set([...scoring, ...recent].filter((i) => parsePlay(plays, i, side) != null).flatMap((i) => idOf(plays[i]) ?? []));

  it("replays a row exactly when its result is a play on the field the theater parses", () => {
    expect(Object.keys(built).length).toBeGreaterThan(0);
    expect(new Set(Object.keys(built))).toEqual(drawable);
  });

  it(`replays every scoring play (${scoring.length})`, () => {
    expect(scoring.every((i) => built[idOf(plays[i]) ?? ""] != null)).toBe(true);
  });

  it('leaves a pinch hitter\'s line ("Williamson hit for Walls") as it is: it isn\'t a play', () => {
    const substitution = recent.find((i) => (str((plays[i] as Item).text) ?? "").includes(" hit for "));
    expect(substitution).toBeDefined();
    expect(built[idOf(plays[substitution!]) ?? ""]).toBeUndefined();
  });

  it("builds each replay as the scene, the field and the moment the live lane builds for the same play", () => {
    for (const [id, replay] of Object.entries(built)) {
      const i = results.findIndex((r) => idOf(plays[r]) === id);
      expect(i).toBeGreaterThanOrEqual(0);
      const end = i + 1 < results.length ? results[i + 1]! : plays.length;
      // The live path: the lane's theater on the plays as they stood (up to the next play), the field it leaves.
      const live = theaterAfter(plays.slice(0, end), null, true, Date.now(), {}, side, theater);
      const play = live.play!;
      const swapped = play.endsInning;
      const fielding = swapped ? (play.batting === "bottom" ? "top" : "bottom") : (play.batting ?? "top");
      const rest: Rest = { bases: swapped ? [false, false, false] : play.basesAfter, bats: live.bats, swapped, fieldingHome: fielding === "top" };
      expect(replay.scene).toEqual({ kind: "baseball", play, rest });
      expect(replay.moment).toEqual(baseballMoment(plays[results[i]!], side));
    }
  });

  it("leaves the sides changing after a third out; any other play leaves its own runners on base", () => {
    const scenes = Object.values(built).flatMap((r) => (r.scene.kind === "baseball" ? [r.scene] : []));
    const third = scenes.find((s) => s.play.endsInning);
    const middle = scenes.find((s) => !s.play.endsInning);
    expect(third?.rest.swapped).toBe(true);
    expect(third?.rest.bases).toEqual([false, false, false]);
    expect(middle?.rest.bases).toEqual(middle?.play.basesAfter);
    expect(middle?.rest.swapped).toBe(false);
  });

  it("plays a baseball play as one take (the diamond never turns)", () => {
    expect(Object.values(built).every((r) => r.scene.kind === "baseball" && baseballTakes(r.scene).length === 1)).toBe(true);
  });
});

// MARK: - Football

describe("football", () => {
  const items = (fixture("mnf-dal-phi-plays.json") as { items: Item[] }).items;
  // DAL (6) visiting, the top team; PHI (21) at home.
  const teams: FootballTeams = { topIsHome: false, topID: "6", bottomID: "21", homeAbbreviation: "PHI", awayAbbreviation: "DAL" };
  const scoring = items.filter((i) => i.scoringPlay === true).flatMap((i) => idOf(i) ?? []);
  const timeout = idOf(items.find((i) => (str((i.type as Item | undefined)?.text) ?? "").includes("Timeout")));
  const built = footballReplays(items, new Set([...scoring, ...(timeout ? [timeout] : [])]), teams);

  it(`replays every scoring play (${scoring.length}): each is a snap or a kick`, () => {
    expect(scoring.length).toBeGreaterThan(0);
    expect(new Set(Object.keys(built))).toEqual(new Set(scoring));
  });

  it("doesn't replay a timeout: it isn't a snap", () => {
    expect(timeout).toBeDefined();
    expect(built[timeout!]).toBeUndefined();
  });

  it("builds each replay as the snap the live lane builds, on the hash the snaps before it put it", () => {
    // The live path: the lane spots each new snap from the one before, watched from the kickoff.
    const sequence = (i: Item) => Number(str(i.sequenceNumber) ?? "") || 0;
    let shown: FootballScene | null = null;
    const live = new Map<string, FootballScene>();
    for (const item of items.map((item, offset) => ({ item, offset })).sort((a, b) => sequence(a.item) - sequence(b.item) || a.offset - b.offset).map((x) => x.item)) {
      const snap = parseSnap(item, teams);
      if (!snap) continue;
      shown = spot([snap], shown).at(-1) ?? null;
      live.set(snap.id, shown!);
    }
    for (const [id, r] of Object.entries(built)) expect(r.scene).toEqual({ kind: "football", scene: live.get(id)!.slotted({}) });
  });

  it("…with its scoring moment, what its celebration answers", () => {
    expect(Object.values(built).every((r) => r.moment?.tier === Tier.score)).toBe(true);
  });

  const touchdown = Object.values(built).flatMap((r) => (r.scene.kind === "football" && r.scene.scene.conversion ? [r.scene.scene] : []))[0];

  it("plays a touchdown, then its try, as the live theater follows it", () => {
    expect(touchdown).toBeDefined();
    const takes = footballTakes({ kind: "football", scene: touchdown! }, false);
    expect(takes).toHaveLength(2);
    expect(takes[1]!.scene.id).toBe(`${touchdown!.id}-try`);
  });

  it("faces the way the game's turn of the field puts it for the play's quarter, as live", () => {
    const takes = footballTakes({ kind: "football", scene: touchdown! }, false);
    const turned = footballTakes({ kind: "football", scene: touchdown! }, true);
    expect(takes[0]!.script.yaw).toBe(FieldFacing.yaw(touchdown!.offense, touchdown!.period, false));
    expect(turned[0]!.script.yaw).toBe(FieldFacing.yaw(touchdown!.offense, touchdown!.period, true));
    expect(takes[0]!.script.yaw).not.toBe(turned[0]!.script.yaw);
  });

  it("reads each play once: unchanged, nothing; a new snap, only it (FootballReplays)", () => {
    const reader = new FootballReplays();
    const head = items.slice(0, -10);
    expect(reader.read(head, teams)).not.toBeNull();
    expect(reader.parsedCount).toBe(head.length);
    expect(reader.read(head, teams)).toBeNull();
    expect(reader.parsedCount).toBe(0);
    const all = reader.read(items, teams)!;
    expect(reader.parsedCount).toBe(10);
    // The same replays as a reading of the whole game at once.
    expect(Object.keys(all).sort()).toEqual(Object.keys(new FootballReplays().read(items, teams)!).sort());
    for (const id of scoring) expect(all[id]).toEqual(built[id]);
  });
});

// MARK: - Basketball

describe("basketball", () => {
  const items = (fixture("nba-every-play-401909890.json") as { games: { items: JSONValue[] }[] }).games[0]!.items;
  const teams: HoopsTeams = { topIsHome: false, topID: "24", bottomID: "26", topName: "SA", bottomName: "UTAH" };
  const ids = new Set(items.flatMap((i) => idOf(i) ?? []));
  const built = basketballReplays(items, ids, teams);
  const marquee = new Set(items.flatMap((_, i) => {
    const s = parseScene(items, i, teams);
    return s && replaysInFull(s) ? [s.id] : [];
  }));

  it("replays a play exactly when the theater replays it in full", () => {
    expect(Object.keys(built).length).toBeGreaterThan(0);
    expect(new Set(Object.keys(built))).toEqual(marquee);
  });

  it("leaves rebounds, timeouts, period ends and changes as beats: their rows stay as they are", () => {
    const beats = items.flatMap((item) => {
      const s = parseScene(items, items.findIndex((x) => idOf(x) === idOf(item)), teams);
      return s && ["defensiveRebound", "timeout", "periodEnd", "substitution"].includes(s.kind) ? [s.id] : [];
    });
    expect(beats.length).toBeGreaterThan(0);
    expect(beats.every((id) => built[id] == null)).toBe(true);
  });

  it("builds each replay as the scene the live lane parses for the same play", () => {
    // The live path: the lane parses each play within its window of the newest plays.
    for (const [id, r] of Object.entries(built)) {
      const i = items.findIndex((x) => idOf(x) === id);
      const start = Math.max(i - 100, 0);
      const window = items.slice(start, Math.min(i + 6, items.length));
      expect(r.scene).toEqual({ kind: "basketball", scene: parseScene(window, i - start, teams) });
    }
  });

  it("…with its moment as it was when new", () => {
    expect(Object.values(built).filter((r) => r.moment != null).length).toBeGreaterThan(Object.keys(built).length / 2);
  });

  it("replays a run's row as its last basket", () => {
    expect(replayPlayOf("401909890312-run")).toBe("401909890312");
    expect(replayPlayOf("401909890312")).toBe("401909890312");
  });

  it("merges the game's plays and the live lane's newest: the lane's edits, then what only it has", () => {
    const run = merged([{ id: "1" }, { id: "2", text: "old" }], [{ id: "2", text: "new" }, { id: "3" }]);
    expect(run.map((p) => str((p as Item).text) ?? idOf(p))).toEqual(["1", "new", "3"]);
  });

  it("swaps the ends at halftime, as the live theater takes the broadcast's", () => {
    const scene = Object.values(built).flatMap((r) => (r.scene.kind === "basketball" ? [r.scene.scene] : []))[0]!;
    const right = (period: number) => {
      const s: BasketballScene = { ...scene, period };
      return basketballTakes({ kind: "basketball", scene: s }, false, false)[0]!.script.yaw > 0;
    };
    expect(right(1)).not.toBe(right(3));
  });

  it("reads again only from a change's reach back (BasketballReplays)", () => {
    const reader = new BasketballReplays();
    expect(reader.read(items, teams)).not.toBeNull();
    expect(reader.parsedCount).toBe(items.length);
    expect(reader.read(items, teams)).toBeNull();
    const edited = items.map((p, i) => (i === items.length - 1 ? { ...(p as Item), text: `${str((p as Item).text) ?? ""} (edited)` } : p));
    expect(reader.read(edited, teams)).not.toBeNull();
    expect(reader.parsedCount).toBeLessThanOrEqual(21);
  });
});

// MARK: - Soccer

describe("soccer", () => {
  const HOME = "362";
  // The match's core plays as the Mac's suite recorded them (Tests/Fixtures/index.txt), seven pages of 200.
  const pages = ["1bbb58f9c1945678542dc53d", "8e8f4e473432cfae635da5d1", "7a34807f60ddfdf41d6706b9", "920e262536793e928a9ec11b", "ddf21e2893b041d770a3acbb", "45e85bdc16b81df599b6b72f", "9c7910bf49edad739a64d729"];
  const feed = new SoccerFeed();
  let replays: Record<string, PlayReplay> = {};
  beforeAll(async () => {
    await feed.update(async (url) => sharedFixture(`${pages[Number(/page=(\d+)/.exec(url)![1]) - 1]}.bin`), { league: "eng.1", eventID: "401879256", homeTeamID: HOME });
    const reader = new SoccerReplays();
    reader.read(feed.takeReplayRun(), HOME, feed.struck);
    replays = reader.replays;
  });

  it("replays every shot on the shot map", () => {
    expect(feed.shots.length).toBeGreaterThan(0);
    for (const s of feed.shots) expect(replays[s.playID], s.playID).toBeDefined();
  });

  const goalsOf = () => feed.shots.filter((s) => s.kind === "goal");

  it("replays the three goals as goals, each with its goal moment", () => {
    const goals = goalsOf();
    expect(goals).toHaveLength(3);
    for (const g of goals) {
      const r = replays[g.playID];
      expect(r?.scene.kind === "soccer" && (r.scene.scene.outcome === "goal" || r.scene.scene.outcome === "ownGoal")).toBe(true);
      expect(r?.moment?.kind).toBe("goal");
    }
  });

  it("doesn't replay a pass: it isn't a moment", () => {
    expect(feed.trail.filter((a) => a.kind === "pass").every((a) => replays[a.playID] == null)).toBe(true);
  });

  it("builds the replay of the theater's latest moment as the scene the theater has", () => {
    const watch = new SoccerTheaterWatch();
    watch.update(feed.plays, HOME, false, Date.now(), { struck: feed.struck, rosters: feed.rosters, following: feed.following });
    const shown = watch.state.scene;
    expect(shown).not.toBeNull();
    expect(replays[shown!.id]?.scene).toEqual({ kind: "soccer", scene: shown });
  });

  it("turns the moment round for the second half, and for the game's turn of the pitch", () => {
    const r = replays[goalsOf()[0]!.playID]!;
    const scene = (r.scene as { scene: SoccerScene }).scene;
    const right = (flipped: boolean, period: number) => attacksRight(soccerTakes({ kind: "soccer", scene: { ...scene, period } }, flipped, {})[0]!.scene);
    expect(right(false, 1)).not.toBe(right(false, 2));
    expect(right(false, 1)).not.toBe(right(true, 1));
  });

  it("drops a goal VAR struck off (SoccerFeed.retract)", () => {
    const struck = new SoccerReplays();
    struck.read(pages.flatMap((p) => (sharedFixture(`${p}.bin`) as { items: JSONValue[] }).items), HOME, new Set());
    const id = goalsOf().at(-1)!.playID;
    expect(struck.replays[id]).toBeDefined();
    expect(struck.read(null, HOME, new Set([id]))).not.toBeNull();
    expect(struck.replays[id]).toBeUndefined();
  });
});
