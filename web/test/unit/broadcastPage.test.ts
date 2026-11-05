/**
 * The game page's model at p (Tests/BroadcastTests.swift's page, policies,
 * floor, VAR and behind-live checks; the broadcast checks of
 * GamePresentationRegressionTests.swift), ported check by check: the hero's
 * score, the Latest list, Win Probability and the moments change at the
 * play's moment on p, not when it arrives; the tables wait for their
 * summary's watermark; a shown score never steps back; the tab and the
 * alerts follow the page for its own game only; Polymarket's ticks show at
 * their own time on p; stoppages and breaks are one phase for every surface.
 */
import { describe, expect, it } from "vitest";
import { Broadcast } from "../../src/data/broadcast/broadcast";
import { behindFromClock, behindLive } from "../../src/data/broadcast/behindLive";
import { entries, isHeldUp, liveState, policy as sportPolicy, stoppage } from "../../src/data/broadcast/lanes";
import { footballPossession, footballSituation } from "../../src/data/broadcast/presentFootball";
import { BEAT_MS, nextRedraw, oddsSchedule, shownUntil } from "../../src/data/broadcast/presentOdds";
import { PresentationClock } from "../../src/data/broadcast/presentationClock";
import { isInterval, NOTHING_PRESENTED, noteOf, presentedStatus, stoppageOf, type PresentedGame } from "../../src/data/broadcast/presentedGame";
import { parseEventTime, Stoppages, stoppageWords, type PTime } from "../../src/data/broadcast/timeline";
import { NBA_PATH, recentPlays as nbaRecentPlays } from "../../src/data/basketball";
import { EMPTY_DETAIL, type GameDetail } from "../../src/data/gameDetail";
import { arr, at, str, type JSONValue } from "../../src/data/json";
import type { FootballTeams } from "../../src/data/liveFeeds/football";
import { liveMoment, Tier } from "../../src/data/moments";
import type { Competitor, ScoreEvent, Sport } from "../../src/data/models";
import { notificationBody } from "../../src/data/notifier";
import { alertsFollowPage, menuBar } from "../../src/data/tabScore";
import { situationIsRoutine, situationLine } from "../../src/data/providers/espn";
import { iso, nbaPlay, S } from "./broadcastHelpers";
import { appCadence, FIXTURES, Recording, RecordingReplay } from "./broadcastReplay";
import { sharedFixture } from "./fixtures";

function comp(id: string, name: string, score: string | null): Competitor {
  return { id, name, abbreviation: name, score, logo: null, isWinner: false, color: null, rank: null, record: null, conferenceRecord: null, alternateColor: null };
}

function makeEvent(id: string, top: Competitor, bottom: Competitor, o: { state?: ScoreEvent["state"]; detail?: string | null; path?: string; sport?: Sport; espnID?: string } = {}): ScoreEvent {
  return {
    id,
    content: { kind: "match", top, bottom },
    state: o.state ?? "live",
    start: Date.now(),
    detail: o.detail ?? null,
    caption: null,
    link: null,
    ref: o.path ? { kind: "espn", path: o.path, id: o.espnID ?? id.replace("espn-", ""), sport: o.sport ?? "basketball" } : null,
    stage: null,
    clock: null,
    possession: null,
    liveLine: null,
    liveLineRoutine: false,
    broadcast: null,
    venue: null,
    snapshot: null,
  };
}

/** A page's model on a virtual clock (Swift: `b.automatic = false; b.time = BroadcastTime { now }`). */
function page(start: PTime) {
  const clock = { now: start };
  const b = new Broadcast();
  b.automatic = false;
  b.time = { now: () => clock.now };
  return { b, clock };
}

const scores = (e: ScoreEvent) => (e.content.kind === "match" ? [e.content.top.score, e.content.bottom.score] : []);
const nbaPolicy = () => sportPolicy("basketball", NBA_PATH);

describe("Broadcast: the page", () => {
  it("the hero, Latest, Win Probability, the tables and the moments change at the play's moment on p, not when it arrives", () => {
    const { b, clock } = page(1100);
    const event = makeEvent("espn-1", comp("espn-basketball-1", "Away", "0"), comp("espn-basketball-2", "Home", "2"), { detail: "8:00 - 1st", path: NBA_PATH, espnID: "1" });
    b.begin(event, false);
    expect(b.active, "a live NBA game broadcasts").toBe(true);
    const shot1 = nbaPlay("p1", 1000, "11:20", 92, "Home makes jumper", 2, 0, { shooting: true, scoring: true, team: "2" });
    const board = nbaPlay("p2", 1010, "11:10", 155, "Away defensive rebound", 2, 0);
    const three = nbaPlay("p3", 1080, "10:00", 92, "Away makes 26-foot three", 2, 3, { shooting: true, scoring: true });
    const summary = (plays: JSONValue[], stat: string): GameDetail => ({
      ...EMPTY_DETAIL,
      topIsHome: false,
      broadcastPlays: entries(plays, "basketball", nbaPolicy()),
      recentPlays: nbaRecentPlays(plays),
      moments: plays.map((p) => ({ id: str(at(p, "id")) ?? "", kind: "score", clock: "", text: str(at(p, "text")) ?? "", side: null, minute: null, score: null, period: null })),
      winByPlay: { p2: { home: 0.45, tie: 0 }, p3: { home: 0.3, tie: 0 } },
      stats: [{ label: "Field Goal %", top: stat, bottom: stat, topShare: 0.5 }],
      linescore: { headers: ["1", "2", "3", "4", "T"], top: ["3", "", "", "", "3"], bottom: ["2", "", "", "", "2"] },
    });
    // The page opens on the first two plays (history); the three comes 40 s after it happened.
    b.ingestSummary(summary([shot1, board], "40"));
    let shown = b.presentEvent(event);
    expect(scores(shown), "the hero shows the score after the last told play").toEqual(["0", "2"]);
    clock.now = 1120;
    b.ingestCore([shot1, board, three]);
    b.ingestSummary(summary([shot1, board, three], "45"));
    const moment = liveMoment({ id: "p3", chart: "court", tier: Tier.swing, kind: "made", value: 3, lead: "Three", detail: "Away makes 26-foot three", side: "top" });
    expect(b.gate([moment]), "a moment waits for its play's moment on p").toEqual([]);
    const p3 = b.engine?.timeline.record("p3");
    expect(p3, "the three is on the timeline").toBeTruthy();
    // When p reaches it, as the clock plans (it may be slewing toward a new target).
    const moment3 = b.engine!.clock.wallReaching(p3!.presentAt, clock.now);
    expect(moment3, "the clock reaches the three").not.toBeNull();
    clock.now = moment3! - 1;
    b.step();
    const side = () => null;
    let d = b.presentDetail(summary([shot1, board, three], "45"), 1, side);
    shown = b.presentEvent(event);
    expect(scores(shown), "a second before its moment: not on the hero, not in Latest, no moment").toEqual(["0", "2"]);
    expect(d.recentPlays[0]).toContain("Away defensive rebound");
    expect(b.takeReleased()).toEqual([]);
    expect(Math.abs((d.topWinProbability ?? 0) - 0.55), "Win Probability is the last told play's (ESPN's per play)").toBeLessThan(1e-9);
    expect(d.stats[0]?.top, "the box score and stats are the summary p has passed (the newer waits for its watermark)").toBe("40");
    clock.now = moment3! + 0.01;
    b.step();
    d = b.presentDetail(summary([shot1, board, three], "45"), 1, side);
    shown = b.presentEvent(event);
    expect(scores(shown), "at its moment the score changes").toEqual(["3", "2"]);
    expect(d.recentPlays[0], "…and Latest and the key plays have it, together").toContain("Away makes 26-foot three");
    expect(d.moments.map((m) => m.id)).toEqual(["p1", "p2", "p3"]);
    expect(Math.abs((d.topWinProbability ?? 0) - 0.7) < 1e-9 && d.stats[0]?.top === "45", "…and Win Probability and the tables").toBe(true);
    expect(b.takeReleased().map((m) => m.id), "…and its moment is released").toEqual(["p3"]);
    expect(d.linescore?.top[0] === "3" && d.linescore?.bottom[0] === "2" && d.linescore?.top.at(-1) === "3", "the line score comes from the told plays").toBe(true);
    expect(shown.state === "live" && (shown.detail ?? "").includes("1st") && shown.clock?.period === 1, `status and clock are p's (${shown.detail})`).toBe(true);
    // A retraction: a waiting moment goes quietly; an offered one comes back down.
    clock.now += 1;
    b.gate([liveMoment({ id: "p9", chart: "court", tier: Tier.swing, kind: "missed", lead: "Miss", detail: "", side: "top" })]);
    expect(b.retract(["p9", "p3"]), "retracting: only what was offered comes back down").toEqual(["p3"]);
    b.end();
    expect(!b.active && b.presentEvent(event) === event, "closing the page: everything shows as the scoreboard has it again").toBe(true);
    // A final never broadcasts (the page shows it as today).
    const final = { ...event, id: "espn-2", state: "final" as const, detail: "Final" };
    const f = new Broadcast();
    f.begin(final, false);
    expect(f.active, "a final game doesn't broadcast").toBe(false);
  });

  it("the tab and the alerts follow the page for its own game only; the page re-renders only when what it shows changes; Polymarket's ticks show at their own time", () => {
    const a = makeEvent("espn-1", comp("t", "A", "98"), comp("b", "B", "100"), { detail: "4:00 - 4th" });
    const presented: ScoreEvent = { ...a, content: { kind: "match", top: comp("t", "A", "95"), bottom: comp("b", "B", "100") }, detail: "4:31 - 4th" };
    const other = { ...a, id: "espn-9", detail: null };
    const first = (e: ScoreEvent | null) => (e && e.content.kind === "match" ? e.content.top.score : null);
    expect(first(menuBar(a, presented)), "the tab shows the open page's presented game").toBe("95");
    expect(menuBar(other, presented)?.id === "espn-9" && first(menuBar(a, null)) === "98", "…and the scoreboard's for any other game, or once the page closes").toBe(true);
    expect(alertsFollowPage("espn-1", presented) && !alertsFollowPage("espn-9", presented), "the scoreboard's alerts wait for the page only for its own game").toBe(true);
    expect(notificationBody({ ...a, content: { kind: "match", top: comp("t", "A", "95"), bottom: comp("b", "B", "100") } }, a, Date.now()), "the presented score rising is an alert, as the scoreboard's would be").not.toBeNull();

    // The page re-renders only when what it shows changes: not while a running clock just ticks.
    const a0: PresentedGame = { ...NOTHING_PRESENTED, phase: { kind: "live" }, period: 1, told: 3, clock: { period: 1, elapsed: 100, running: true, countsDown: true, length: 720 } };
    let a1: PresentedGame = { ...a0, clock: { ...a0.clock!, elapsed: 105.2 } };
    expect(Broadcast.differs(a1, a0, 5), "a running clock ticking on its own doesn't republish").toBe(false);
    a1 = { ...a0, clock: { ...a0.clock!, elapsed: 106 } };
    expect(Broadcast.differs(a1, a0, 5), "…drifting past 0.75 s (the slew) does").toBe(true);
    expect(Broadcast.differs({ ...a0, told: 4 }, a0, 0), "a play told does").toBe(true);
    expect(Broadcast.differs({ ...a0, clock: { ...a0.clock!, running: false } }, a0, 0), "the clock stopping (a stall, a whistle) does").toBe(true);

    // Polymarket: a tick at its own time shows once p reaches it, and the chart is scheduled to redraw then.
    const c = new PresentationClock();
    c.update(1000, { target: 50, cap: Infinity });
    const ticks = [940_000, 955_000, 990_000];
    const points = ticks.map((t, i) => ({ t, p: 0.5 + i / 10 }));
    const p = c.p(1000) * 1000;
    expect(shownUntil(points, p).map((x) => x.p), "at p (950) only the tick from before it shows").toEqual([0.5]);
    const schedule = oddsSchedule(ticks, c, 1_000_000);
    expect(schedule.length === 3 && Math.abs(schedule[1]! - 1_005_010) < 1e-3 && Math.abs(schedule[2]! - 1_040_010) < 1e-3, `the chart redraws when p reaches each tick (scheduled, not polled): ${schedule}`).toBe(true);
    // OddsSection.schedule(feed:clock:now:): the next tick reached, or the 15 s beat that keeps the now line moving in a quiet market.
    expect(Math.abs(nextRedraw(ticks, c, 1_000_000) - 1_005_010), "the next tick reached comes first").toBeLessThan(1e-3);
    expect(nextRedraw([], c, 1_000_000), "a quiet market: the beat").toBe(1_000_000 + BEAT_MS);
    expect(nextRedraw([2_000_000], c, 1_000_000), "a tick far ahead: the beat first").toBe(1_000_000 + BEAT_MS);
  });
});

describe("Broadcast: a shown score never steps back", () => {
  const plays = [
    nbaPlay("f1", 1000, "11:00", 92, "Home makes layup", 2, 0, { shooting: true, scoring: true, team: "2" }),
    nbaPlay("f2", 1010, "10:50", 92, "Away makes three", 2, 3, { shooting: true, scoring: true }),
    nbaPlay("f3", 1050, "10:10", 92, "Home makes jumper", 4, 3, { shooting: true, scoring: true, team: "2" }),
    nbaPlay("f4", 1080, "9:40", 92, "Away makes jumper", 4, 5, { shooting: true, scoring: true }),
    nbaPlay("f5", 1095, "9:25", 92, "Home makes dunk", 6, 5, { shooting: true, scoring: true, team: "2" }),
  ];
  const summary = (upTo: number): GameDetail => ({ ...EMPTY_DETAIL, topIsHome: false, broadcastPlays: entries(plays.slice(0, upTo), "basketball", nbaPolicy()) });
  const floorPage = (away: string, home: string) => {
    const { b, clock } = page(1100);
    const event = makeEvent("espn-f", comp("espn-basketball-1", "Away", away), comp("espn-basketball-2", "Home", home), { detail: "9:40 - 1st", path: NBA_PATH, espnID: "f" });
    return { b, clock, event };
  };

  it("shown per side: max(p's score, the floor)", () => {
    expect(Broadcast.shown(S(2, 3), S(4, 1))).toEqual(S(4, 3));
    expect(Broadcast.shown(S(2, 3), null)).toEqual(S(2, 3));
  });

  it("opening behind the scoreboard: the hero keeps what the owner saw until p's score reaches it", () => {
    // The scoreboard (and the tab, the list) showed Away 5, Home 4 when the page opened; p is at 3–2.
    const { b, clock, event } = floorPage("5", "4");
    b.begin(event, false);
    b.ingestSummary(summary(2));
    expect(b.presented.score, "opening behind the scoreboard: the hero keeps what the owner saw (5–4), not p's 3–2").toEqual(S(2, 3));
    expect(scores(b.presentEvent(event))).toEqual(["5", "4"]);
    const shown: (string | null)[][] = [scores(b.presentEvent(event))];
    clock.now = 1101;
    b.ingestCore(plays);
    // The lane read every 5 s (as the app does), the model stepped at its own wakes between.
    let t = clock.now;
    while (t < 1200) {
      const read = Math.floor(t / 5) * 5 + 5;
      const next = Math.min(b.engine?.nextWake(t) ?? Infinity, read);
      t = next;
      clock.now = t;
      if (t === read) b.noteRead();
      else b.step();
      shown.push(scores(b.presentEvent(event)));
    }
    const away = shown.map((s) => Number(s[0]));
    const home = shown.map((s) => Number(s[1]));
    expect(away.slice(1).every((x, i) => away[i]! <= x) && home.slice(1).every((x, i) => home[i]! <= x), "the shown score never steps back, side by side").toBe(true);
    expect(b.floor, "p's score reached the floor: it's gone, and p's own scores show from then").toBeNull();
    expect(scores(b.presentEvent(event))).toEqual(["5", "6"]);
    const seen = shown.map((s) => s.join("-"));
    expect(seen.includes("5-4") && !seen.includes("3-4") && !seen.includes("3-2"), "while it stood, nothing below it showed").toBe(true);
  });

  it("a genuine overturn: the scoreboard takes its own score back; the floor goes with it", () => {
    const { b, clock, event } = floorPage("5", "4");
    b.begin(event, false);
    b.ingestSummary(summary(2));
    clock.now = 1102;
    b.observeScoreboard(event);
    clock.now = 1132;
    b.observeScoreboard({ ...event, content: { kind: "match", top: comp("espn-basketball-1", "Away", "3"), bottom: comp("espn-basketball-2", "Home", "4") } });
    expect(b.floor == null && scores(b.presentEvent(event)).join() === "3,2", "the scoreboard correcting downward lets the floor go (p's score shows)").toBe(true);
  });

  it("the timeout: a floor p never reaches lapses after two minutes", () => {
    const { b, clock, event } = floorPage("9", "9");
    b.begin(event, false);
    b.ingestSummary(summary(2));
    let held = true;
    for (let t = 1105; t <= 1100 + Broadcast.floorTimeout + 1; t += 5) {
      clock.now = t;
      b.noteRead();
      if (t < 1100 + Broadcast.floorTimeout - 1) held = held && b.floor != null;
    }
    clock.now = 1100 + Broadcast.floorTimeout + 1;
    b.noteRead();
    expect(held && b.floor == null, `a floor that p never reaches lapses after ${Broadcast.floorTimeout} s`).toBe(true);
  });

  it("a told reversal takes the floor with it", () => {
    const p1 = nbaPlay("r1", 1000, "11:00", 92, "Home makes layup", 2, 0, { shooting: true, scoring: true, team: "2" });
    const p2 = nbaPlay("r2", 1010, "10:50", 92, "Away makes three", 2, 3, { shooting: true, scoring: true });
    const { b, clock } = page(1100);
    const event = makeEvent("espn-r", comp("espn-basketball-1", "Away", "9"), comp("espn-basketball-2", "Home", "9"), { detail: "9:40 - 1st", path: NBA_PATH, espnID: "r" });
    b.begin(event, false);
    b.ingestSummary({ ...EMPTY_DETAIL, topIsHome: false, broadcastPlays: entries([p1, p2], "basketball", nbaPolicy()) });
    const floored = b.floor != null && b.presented.score?.home === 2 && b.presented.score.away === 3;
    // The three is taken back (the play revised to no score); the next play is told after it.
    const undone = nbaPlay("r2", 1010, "10:50", 92, "Away three overturned", 2, 0, { shooting: true, scoring: false });
    const reviewPlay = nbaPlay("r3", 1058, "10:02", 92, "Home misses jumper", 2, 0, { shooting: true, team: "2" });
    clock.now = 1105;
    b.ingestSummary({ ...EMPTY_DETAIL, topIsHome: false, broadcastPlays: entries([p1, undone, reviewPlay], "basketball", nbaPolicy()) });
    // No review entry: a scorer's fix, quiet as before (no hold); the score falls back and the floor goes.
    expect(floored && b.presented.score?.home === 2 && b.presented.score.away === 0 && b.floor == null, "a score taken back on a told play drops the floor (the score the owner saw is overturned)").toBe(true);
  });
});

describe("Broadcast: how far behind live, on the page", () => {
  it("none until broadcasting; then the clock's delay, rounded", () => {
    const { b, clock } = page(1100);
    expect(b.behind, "not broadcasting: no readout").toBeNull();
    const event = makeEvent("espn-h", comp("espn-basketball-1", "Away", "3"), comp("espn-basketball-2", "Home", "2"), { detail: "10:50 - 1st", path: NBA_PATH, espnID: "h" });
    b.begin(event, false);
    b.ingestSummary({
      ...EMPTY_DETAIL,
      topIsHome: false,
      broadcastPlays: entries(
        [
          nbaPlay("h1", 1000, "11:00", 92, "Home makes layup", 2, 0, { shooting: true, scoring: true, team: "2" }),
          nbaPlay("h2", 1010, "10:50", 92, "Away makes three", 2, 3, { shooting: true, scoring: true }),
        ],
        "basketball",
        nbaPolicy(),
      ),
    });
    clock.now = 1101;
    b.step();
    const expected = behindFromClock(b.clock.delay(clock.now), b.clock.regime);
    expect(b.behind, "broadcasting: the clock's delay, rounded").toEqual(expected);
    expect(b.behind?.seconds ?? 0).toBeGreaterThanOrEqual(45);
    expect(behindLive(55).seconds).toBe(55);
  });
});

describe("Game presentation: breaks and stoppages, one phase for every surface", () => {
  it("opening a Steelers–Browns game at halftime presents halftime, and a third-quarter kickoff clears it", () => {
    const fixture = sharedFixture("nfl-cle-pit-halftime.json");
    const items = arr(at(fixture, "items"));
    const p = sportPolicy("football", "football/nfl");
    const list = entries(items, "football", p);
    expect(list.length, "Steelers–Browns halftime capture loads").toBe(95);
    const start = parseEventTime("2026-11-01T19:43:00Z")!;
    const { b, clock } = page(start);
    const event: ScoreEvent = {
      ...makeEvent("espn-401873027", comp("espn-football-5", "Browns", "6"), comp("espn-football-23", "Steelers", "20"), { detail: "Halftime", path: "football/nfl", sport: "football", espnID: "401873027" }),
      clock: { seconds: 0, sampledAt: start * 1000, period: 2, direction: "down", display: "Halftime", running: false },
    };
    b.begin(event, false);
    b.ingestSummary({ ...EMPTY_DETAIL, topIsHome: false, broadcastPlays: list });
    expect(b.presentEvent(event).detail === "Halftime" && b.presented.phase.kind === "interval" && b.presented.phase.period === 2, `opening at halftime immediately presents halftime, not the first-quarter timeout (${b.presentEvent(event).detail})`).toBe(true);
    const later = b.engine?.timeline.records.filter((r) => r.presentAt > clock.now) ?? [];
    expect(later.map((r) => r.entry.id), "historical stopped-clock plays are not rescheduled after the page opens").toEqual([]);
    b.observeStatus(at(fixture, "status"));
    b.ingestCore(items);
    expect(b.presentEvent(event).detail, "core and status refresh keep the same halftime state").toBe("Halftime");
    expect(isInterval(b.presented) && noteOf(b.presented) == null && b.presentEvent(event).clock == null, "the break has one status and no running game clock").toBe(true);
    const teams: FootballTeams = { topIsHome: false, topID: "5", bottomID: "23", homeAbbreviation: "PIT", awayAbbreviation: "CLE", homeName: "Steelers", awayName: "Browns" };
    expect(footballPossession(b, teams), "halftime does not claim anyone has possession").toBeNull();
    const stale = { downDistance: "1st & 10", ballX: 34, lineToGainX: 44, possession: "top" as const, redZone: false, topTimeouts: 0, bottomTimeouts: 0, lastPlay: "END QUARTER 2" };
    const paused = footballSituation(b, teams, stale);
    expect(paused != null && paused.possession == null && paused.downDistance == null && paused.lineToGainX == null, "the halftime field clears stale possession and down-and-distance").toBe(true);
    clock.now += 180;
    const resumed = { ...(items.at(-1) as Record<string, unknown>), id: "test-second-half-kickoff", sequenceNumber: "230000", period: { number: 3 }, clock: { displayValue: "15:00" }, type: { id: "53", text: "Kickoff" }, text: "Second-half kickoff returned to the 30-yard line.", wallclock: iso(clock.now - 90) };
    b.ingestCore([...items, resumed]);
    // An arriving play retains the broadcast's normal presentation delay.
    // Continue successful polls until its scheduled moment is reached.
    for (let k = 0; k < 6; k++) {
      clock.now += 5;
      b.noteRead();
    }
    expect(b.presented.phase.kind === "live" && b.presented.period === 3 && noteOf(b.presented) == null, `a third-quarter kickoff clears halftime when its presentation moment arrives (${b.presented.phase.kind}, last ${b.presented.lastID})`).toBe(true);
    b.end();
  });

  it("stoppages: what every surface reads, through a page's real lanes, in each sport", () => {
    const base = parseEventTime("2026-11-01T19:00:00Z")!;
    const stamp = (t: number) => iso(base + t);
    /** A page opened on these plays (ESPN's shapes), with the status coming in for a while. */
    const run = (sport: Sport, path: string, plays: JSONValue[], status?: JSONValue) => {
      const { b, clock } = page(base + 200);
      const event = makeEvent("espn-1", comp(`espn-${sport}-1`, "A", "1"), comp(`espn-${sport}-2`, "B", "2"), { path, sport, espnID: "1" });
      b.begin(event, sport === "soccer");
      b.ingestCore(plays);
      for (let k = 0; k < 40; k++) {
        clock.now += 5;
        if (status) b.observeStatus(status);
        b.noteRead();
      }
      const shown = b.presentEvent(event);
      const game = b.presented;
      b.end();
      return { shown, game };
    };
    const nba = (id: string, type: number, text: string, t: number, o: { clock?: string; shot?: boolean; people?: number } = {}) => ({
      id,
      type: { id: String(type), text },
      period: { number: 2 },
      clock: { displayValue: o.clock ?? "5:23" },
      wallclock: stamp(t),
      text,
      shootingPlay: o.shot ?? false,
      participants: Array.from({ length: o.people ?? 0 }, () => ({ athlete: { id: "1" } })),
    });
    const path = "basketball/nba";
    const shot = nba("1", 92, "Jumper", 0, { clock: "5:40", shot: true, people: 1 });
    let game = run("basketball", path, [shot, nba("2", 16, "Full Timeout", 10)]).game;
    expect(stoppageOf(game)?.kind === "timeout" && noteOf(game) === "Timeout", `NBA: a full timeout (${game.phase.kind})`).toBe(true);
    game = run("basketball", path, [shot, nba("2", 16, "Full Timeout", 10), nba("3", 584, "Substitution", 12)]).game;
    expect(stoppageOf(game)?.kind, "NBA: a substitution in a timeout doesn't end it").toBe("timeout");
    game = run("basketball", path, [shot, nba("2", 16, "Full Timeout", 10), nba("3", 92, "Jumper", 30, { clock: "5:10", shot: true, people: 1 })]).game;
    expect(game.phase.kind, "NBA: the next shot ends it").toBe("live");
    game = run("basketball", path, [shot, nba("2", 215, "Coach's Challenge (Stands)", 10)]).game;
    expect(noteOf(game), "NBA: a challenge").toBe("Under review");

    const soccer = (id: string, type: string, text: string, t: number, located = false) => {
      const p: Record<string, unknown> = { id, type: { type }, period: { number: 1 }, clock: { value: 1800 + t, displayValue: "31'" }, wallclock: stamp(t), text };
      if (located) {
        p.fieldPositionX = 0.5;
        p.fieldPositionY = 0.5;
      }
      return p;
    };
    const pass = soccer("1", "pass", "", 0, true);
    game = run("soccer", "soccer/eng.1", [pass, soccer("2", "start-delay", "", 10), soccer("3", "start-delay", "Delay in match because of an injury to A (B).", 10)]).game;
    expect(noteOf(game), "soccer: a delay for a man down (ESPN logs it twice; one says why)").toBe("Delay in match");
    game = run("soccer", "soccer/eng.1", [pass, soccer("2", "start-delay", "Delay in match for a VAR check.", 10), soccer("3", "substitution", "", 12)]).game;
    expect(noteOf(game), "soccer: VAR, through a substitution").toBe("VAR check");
    game = run("soccer", "soccer/eng.1", [pass, soccer("2", "start-delay", "Delay in match.", 10), soccer("3", "end-delay", "Delay over.", 30)]).game;
    expect(game.phase.kind, "soccer: the delay's over").toBe("live");

    const mlb = (id: string, type: string, text: string, t: number, half = "top") => ({ id, type: { type }, period: { number: 5, type: half }, wallclock: stamp(t), text, atBatId: `400000${id}` });
    const pitch = mlb("1", "ball", "Ball 1", 0);
    game = run("baseball", "baseball/mlb", [pitch, mlb("2", "play-result", "Rodriguez relieved Vásquez", 10), mlb("3", "start-batterpitcher", "", 12)]).game;
    expect(noteOf(game), "MLB: a pitching change, as ESPN logs it").toBe("Pitching change");
    game = run("baseball", "baseball/mlb", [pitch, mlb("2", "play-result", "Rodriguez relieved Vásquez", 10), mlb("3", "strike-looking", "Strike 1", 40)]).game;
    expect(game.phase.kind, "MLB: the next pitch ends it").toBe("live");
    const middle = run("baseball", "baseball/mlb", [pitch, mlb("2", "end-inning", "", 10)]);
    expect(middle.game.phase.kind === "interval" && middle.game.phase.period === 9 && middle.shown.detail === "Mid 5th" && noteOf(middle.game) == null, `MLB: between innings (${middle.shown.detail})`).toBe(true);

    // ESPN's status when a game's held up: its words survive, over the clock and the tag.
    const held = arr(sharedFixture("espn-status-held-up.json"));
    expect(held.length, "the held-up statuses load").toBe(5);
    for (const status of held) {
      const words = str(at(status, "type", "shortDetail")) ?? "";
      expect(liveState(words), `${words}: held up, in ESPN's words`).toEqual({ kind: "stopped", words });
      const sport: Sport = str(at(status, "sport")) === "football" ? "football" : "baseball";
      const plays =
        sport === "baseball" ? [pitch] : [{ id: "1", type: { id: "24", text: "Pass Reception" }, period: { number: 2 }, sequenceNumber: "1", clock: { displayValue: "7:18" }, wallclock: stamp(0), text: "Pass" }];
      const delayed = run(sport, sport === "baseball" ? "baseball/mlb" : "football/nfl", plays, status);
      expect(delayed.shown.detail === words && delayed.shown.clock == null && noteOf(delayed.game) == null, `${words}: the status says so, with no clock under it (${delayed.shown.detail} ${delayed.game.phase.kind})`).toBe(true);
    }
    expect(!isHeldUp("4:12 - 3rd") && !isHeldUp("Half-time") && !isHeldUp("67'"), "a game in play isn't held up").toBe(true);
    expect(stoppageWords(Stoppages.officialTimeout), "the docked bar says what the hero says, not a stale down").toBe("Official timeout");
    expect(
      stoppage("Official Timeout")?.kind === "officialTimeout" && stoppage("Full Timeout")?.kind === "timeout" && stoppage("Two-minute warning")?.kind === "twoMinuteWarning" && stoppage("Rush") == null,
      "one table, every sport",
    ).toBe(true);
  });

  it("the scores list's row says the same word (Providers.swift's line, 11de4c0)", () => {
    const sit = (type: string, extra: Record<string, unknown> = {}) => ({ lastPlay: { type: { text: type, id: "16" }, text: "Timeout" }, ...extra });
    expect(situationLine(sit("Official Timeout", { downDistanceText: "3rd & 7 at CLE 40" }), "football", "football/nfl"), "a timeout reads ahead of the stale down it left").toBe("Official timeout");
    expect(situationLine(sit("Two-minute warning"), "football", "football/nfl")).toBe("Two-minute warning");
    expect(situationLine(sit("Full Timeout"), "basketball", NBA_PATH), "NBA: the stoppage, not the play's line").toBe("Timeout");
    expect(situationIsRoutine(sit("Full Timeout")), "…and it isn't routine (the row says it)").toBe(false);
    expect(situationLine(sit("Pitching Change", { outs: 1 }), "baseball", "baseball/mlb")).toBe("Pitching change");
    expect(situationLine({ lastPlay: { type: { text: "Pass Reception" } }, downDistanceText: "1st & 10 at PIT 25" }, "football", "football/nfl"), "in play: the down").toBe("1st & 10 at PIT 25");
  });

  it("soccer's half-time on a real recording where ESPN posted the entry 17 minutes after its status said HT", () => {
    const recording = Recording.load(FIXTURES, "soccer_usa.1", "761921", 0);
    const replay = RecordingReplay.make(recording);
    expect(replay, "the half-time window replays").not.toBeNull();
    const rows = recording.status.map((r) => r.json);
    const ht = at(rows.find((r) => str(at(r, "detail")) === "HT"), "at") as number | undefined;
    const back = at(
      rows.find((r) => ((at(r, "at") as number) ?? 0) > (ht ?? Infinity) && str(at(r, "detail")) !== "HT"),
      "at",
    ) as number | undefined;
    expect(ht != null && back != null, "the recording has its break").toBe(true);
    expect(back! - ht!, "ESPN's status says HT for a quarter of an hour").toBeGreaterThan(900);
    const seen: { p: number; status: string; interval: boolean }[] = [];
    replay!.run(appCadence(replay!.policy), (r, t) => {
      const game = r.engine.presented(t);
      seen.push({ p: r.engine.p(t), status: presentedStatus(game, "soccer", 2), interval: isInterval(game) });
    });
    const lag = replay!.engine.timeline.fastLag;
    // The break on p: from the status's first word, its lag taken off, until the second half's first play is told.
    const fromIndex = seen.findIndex((s) => !(s.p < ht! - lag + 6));
    const from = fromIndex >= 0 ? seen.slice(fromIndex) : [];
    const duringEnd = from.findIndex((s) => !(s.interval && s.status === "Half-time"));
    const during = duringEnd >= 0 ? from.slice(0, duringEnd) : from;
    const heldFor = (during.at(-1)?.p ?? 0) - (during[0]?.p ?? 0);
    expect(from.length > 0 && from[0]!.interval && heldFor > back! - ht! - 60, `through the whole break the hero says Half-time (${Math.round(heldFor)} s of ${Math.round(back! - ht!)} s, then ${from[during.length]?.status})`).toBe(true);
    const minutes = seen.flatMap((s) => (s.status.startsWith("45'+") ? [Number(/^\d+/.exec(s.status.slice(4))?.[0] ?? 0)] : []));
    expect(Math.max(0, ...minutes), "the clock never climbs through it").toBeLessThanOrEqual(12);
    const last = seen.at(-1)!;
    expect(!last.interval && last.status.endsWith("'") && from.slice(during.length).every((s) => !s.interval), `and the second half takes over, for good (${last.status})`).toBe(true);
  });
});
