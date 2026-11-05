/**
 * The game's reported events on the market's wall clock (MatchHistory.swift),
 * ported check by check from Tests/MatchHistoryTests.swift, with its
 * fixtures (Tests/Fixtures): the chronology the odds share, the broadcast's
 * clip, the stable live axis, period zoom, late stamps placed without a
 * pile-up, soccer's reversed commentary, football's drive overlap and
 * turnovers, and every sport's events at the same x in both modules.
 * Times are epoch ms (the Swift's seconds × 1000).
 */
import { describe, expect, it } from "vitest";
import { OddsLayout } from "../../src/data/odds/chart";
import { chronology, inOrder, placed } from "../../src/data/odds/chronology";
import { parseOddsBasis } from "../../src/data/odds/espn";
import { effectiveWindow, emptyHistory, GAME, historyDomain, historyEnd, historyNow, historyStart, parseHistory, periodWindow, RECENT, shownUntil, timeOf } from "../../src/data/odds/history";
import { sharedFixture } from "./fixtures";

const S = 1000;
const date = (s: string) => Date.parse(s);
const origin = date("2026-11-01T18:00:00Z");

function play(id: string, stamp: string | null, o: { period?: number; clock?: string; text?: string; kind?: string; team?: string; score?: number } = {}): Record<string, unknown> {
  const value: Record<string, unknown> = { id, period: { number: o.period ?? 1 }, clock: { displayValue: o.clock ?? "12:00" }, text: o.text ?? "A play", type: { type: o.kind ?? "play" }, scoreValue: o.score ?? 0 };
  if (stamp) value.wallclock = stamp;
  if (o.team) value.team = { id: o.team };
  return value;
}

const a = play("a", "2026-11-01T18:00:00Z", { text: "Opening play" });
const b = play("b", "2026-11-01T18:01:00Z", { clock: "11:30", text: "Home team scores", team: "home", score: 2 });
const c = play("c", "2026-11-01T18:00:50Z", { clock: "11:20", text: "Clock correction" });
const d = play("d", "2026-11-01T18:20:00Z", { period: 2, text: "Second period begins" });
const e = play("e", "2026-11-01T18:40:00Z", { period: 2, clock: "0:00", text: "End of game" });
const missing = play("missing", null, { clock: "10:00", text: "Untimed score", score: 3 });
const header = { competitions: [{ competitors: [{ team: { id: "away" }, homeAway: "away" }, { team: { id: "home" }, homeAway: "home" }] }] };
const summary = { header, plays: [a, b, c, missing, d, e] };
const history = parseHistory(summary, "basketball", "away", "home");

describe("match history", () => {
  it("places only reported wall times, in a conservative order, with the provider's teams", () => {
    expect(history.events.map((x) => x.id), "only reported wall times get placed; an untimed score stays unplaced").toEqual(["a", "b", "c", "d", "e"]);
    expect(history.events[1]!.side, "events preserve provider team identity").toBe("bottom");
    expect(history.events[2]!.t, "a backwards wall stamp is ordered conservatively").toBe(origin + 60 * S);
    const baseline = parseOddsBasis(summary, "basketball", true);
    const chrono = chronology(summary, "basketball");
    expect(baseline.periods, "the ESPN odds baseline and event history use exactly the same chronology").toEqual(history.periods);
    expect(chrono.map((x) => x.t)).toEqual(history.events.map((x) => x.t));
    expect([timeOf(history, "b"), timeOf(history, "b-run"), timeOf(history, "nope")], "a play's time by its ID; an NBA run's moment is its last basket").toEqual([origin + 60 * S, origin + 60 * S, null]);
  });

  it("clips at the broadcast's boundary: events, future periods and period ends", () => {
    const shown = shownUntil(history, origin + 30 * S);
    expect(shown.events.map((x) => x.id), "the broadcast boundary clips events, future periods and period ends").toEqual(["a"]);
    expect(shown.periods).toHaveLength(1);
    expect(shown.periods[0]!.end).toBe(origin + 30 * S);
    const before = shownUntil(history, origin - S);
    expect(before.events.length + before.periods.length, "before the first event no future game clock or period is exposed").toBe(0);
    expect(shownUntil(history, origin + 9000 * S), "nothing past the boundary: the history as it is").toBe(history);
    const finalDomain = historyDomain(history, "final", GAME, origin - 900 * S, origin + 9000 * S);
    expect(finalDomain, "final history ends at the last play, regardless of later market settlement").toEqual({ from: origin, to: origin + 2400 * S });
  });

  it("keeps a live axis the game's usual length, and still as the game goes on", () => {
    const pace = history.pace.game;
    const early = shownUntil(history, origin + 600 * S);
    const later = shownUntil(history, origin + 2000 * S);
    const earlyDomain = historyDomain(early, "live", GAME, origin, origin + 590 * S, origin + 600 * S);
    const laterDomain = historyDomain(later, "live", GAME, origin, origin + 1990 * S, origin + 2000 * S);
    expect(earlyDomain, "a live game's axis stays put: first play to its usual length, however far it's got").toEqual({ from: origin, to: origin + pace });
    expect(laterDomain).toEqual(earlyDomain);
    expect(historyNow(early, origin, origin + 590 * S, origin + 600 * S), "now: what's presented").toBe(origin + 600 * S);
    expect(historyNow(history, origin, origin + 2500 * S), "or without a broadcast the newest thing heard").toBe(origin + 2500 * S);
    const long = historyDomain(history, "live", GAME, origin, origin + pace + 60 * S);
    const longer = historyDomain(history, "live", GAME, origin, origin + pace + 120 * S);
    expect(long.to, "past its usual length (overtime, a delay) it grows by a quarter hour, not a tick at a time").toBe(origin + pace + 900 * S);
    expect(longer).toEqual(long);
    expect(historyDomain(history, "live", RECENT, origin, origin + 2500 * S), "10 min slides with the newest moment").toEqual({ from: origin + 1900 * S, to: origin + 2500 * S });
    const delayed = historyDomain(history, "live", GAME, origin, origin + 5000 * S, origin + 30 * S);
    expect(delayed, "a future market tick cannot move the axis or the now line past the broadcast").toEqual({ from: origin, to: origin + pace });
    expect(historyNow(history, origin, origin + 5000 * S, origin + 30 * S)).toBe(origin + 30 * S);
    const empty = emptyHistory("soccer");
    const emptyRange = historyDomain(empty, "live", GAME, origin, null, origin - 300 * S);
    expect(emptyRange.from < emptyRange.to && emptyRange.from === origin - 301 * S, "opening before kickoff retains a valid finite domain without exposing future timestamps").toBe(true);
  });

  it("zooms both modules to a period through the same function", () => {
    const pace = history.pace;
    const finalDomain = historyDomain(history, "final", GAME, origin - 900 * S, origin + 9000 * S);
    expect(historyDomain(history, "final", periodWindow(1), origin), "a final's period runs from its first play to its last").toEqual({ from: origin, to: origin + 60 * S });
    const secondLive = historyDomain(history, "live", periodWindow(2), origin, origin + 2410 * S);
    expect(secondLive, "the period under way is its usual length, like the game's").toEqual({ from: origin + 1200 * S, to: origin + 1200 * S + pace.game / pace.periods });
    expect(historyDomain(history, "final", periodWindow(9), origin), "a period the game doesn't have: the whole game").toEqual(finalDomain);
    expect(
      [effectiveWindow(RECENT, "final"), effectiveWindow(periodWindow(2), "final"), effectiveWindow(periodWindow(2), "scheduled"), effectiveWindow(RECENT, "live")],
      "only a live game has a last 10 minutes; a final zooms; before the game, nothing to zoom to",
    ).toEqual([GAME, periodWindow(2), GAME, RECENT]);
  });

  it("never lets one late stamp drag the plays after it to its time", () => {
    const t0 = origin;
    const late = placed([t0, t0 + 10 * S, t0 + 300 * S, t0 + 20 * S, t0 + 30 * S, t0 + 40 * S, t0 + 310 * S]);
    expect(late, "a forward stamp moves to its neighbors; the plays after it keep their own times, no pile-up").toEqual([t0, t0 + 10 * S, t0 + 20 * S, t0 + 20 * S, t0 + 30 * S, t0 + 40 * S, t0 + 310 * S]);
    expect(inOrder([t0, t0 + 60 * S, t0 + 50 * S, t0 + 1200 * S]), "between runs of the same length, the earlier play stands").toEqual([true, true, false, true]);
    expect(placed([]), "no plays").toEqual([]);
    expect(placed([t0]), "one play").toEqual([t0]);
    const ordered = Array.from({ length: 50 }, (_, k) => t0 + k * S);
    expect(placed(ordered), "stamps in order stand as reported").toEqual(ordered);
  });

  it("sorts soccer's reversed commentary by wall time and joins key events by play ID", () => {
    const kickoff = play("kickoff", "2026-11-01T18:00:00Z", { clock: "", text: "First Half begins.", kind: "kickoff" });
    const goal = play("goal", "2026-11-01T18:22:00Z", { clock: "22'", text: "Goal! Home 1, Away 0." });
    const second = play("second", "2026-11-01T19:02:00Z", { period: 2, clock: "45'", text: "Second Half begins." });
    const keyGoal = { ...goal, type: { type: "goal" }, team: { id: "home" }, homeScore: 1, awayScore: 0 };
    const untimedGoal = play("untimed", null, { period: 2, clock: "90'+3'", text: "Untimed goal", kind: "goal" });
    const soccer = { header, commentary: [second, goal, kickoff].map((p) => ({ play: p, text: p.text })), keyEvents: [keyGoal, untimedGoal] };
    const match = parseHistory(soccer, "soccer", "home", "away");
    expect(match.events.map((x) => x.id), "reversed soccer commentary sorts by wall time").toEqual(["kickoff", "goal", "second"]);
    expect(match.events[1]!.side, "and joins key events by stable play ID").toBe("top");
    expect([match.events[1]!.clock, match.events[2]!.clock], "soccer keeps its game minute labels").toEqual(["22'", "45'"]);
    expect(match.events[2]!.t - match.events[1]!.t, "and actual halftime gap; untimed added-time goal is not guessed").toBe(2400 * S);
    expect(parseHistory(soccer, "soccer", "home", "away").events.map((x) => x.id), "event identities survive identical refreshes").toEqual(match.events.map((x) => x.id));
  });

  it("reads football's drives without the current drive's overlap, baseball's half-innings and college halves", () => {
    const football = { drives: { previous: [{ plays: [a, b] }], current: { plays: [b, d] } } };
    const nfl = parseHistory(football, "football", "away", "home");
    expect(nfl.events.map((x) => x.id), "NFL and college drive/current-drive overlap does not duplicate timeline events").toEqual(["a", "b", "d"]);
    expect(nfl.events.at(-1)!.clock).toBe("Q2 12:00");
    const inning = { ...b, period: { number: 10, type: "bottom" } };
    const mlb = parseHistory({ plays: [inning] }, "baseball", "away", "home");
    expect([mlb.events[0]!.clock, mlb.periods[0]!.label], "baseball uses inning/half-inning labels including extra innings").toEqual(["Bot 10th", "10"]);
    const college = parseHistory(summary, "basketball", "away", "home", "basketball/mens-college-basketball");
    expect(college.periods.map((p) => p.label), "college basketball labels halves without relabeling NBA/WNBA quarters").toEqual(["H1", "H2"]);
    expect(parseHistory(summary, "esports", null, null).events.length + parseHistory(summary, "climbing", null, null).events.length, "providers without absolute event times do not fabricate market-aligned CS/climbing history").toBe(0);
  });

  describe("real recorded games", () => {
    const nbaJSON = sharedFixture("odds/espn-nba-401909888.json") as { plays: { wallclock?: string }[] };
    const nba = parseHistory(nbaJSON, "basketball", "9", "16");
    const nbaOdds = parseOddsBasis(nbaJSON, "basketball", false);
    const eplJSON = sharedFixture("odds/espn-epl-401879252.json");
    const epl = parseHistory(eplJSON, "soccer", null, null);
    const eplOdds = parseOddsBasis(eplJSON, "soccer", false);
    const nflFixture = sharedFixture("nfl-cle-pit-halftime.json") as { items: unknown[] };
    const actualNFL = parseHistory({ plays: nflFixture.items }, "football", null, null);
    const mlbFixture = sharedFixture("ws-g5-plays.json") as { items: unknown[] };
    const actualMLB = parseHistory({ plays: mlbFixture.items }, "baseball", null, null);
    const college = parseHistory(summary, "basketball", "away", "home", "basketball/mens-college-basketball");

    it("GSW–MIN: 552 events in order, only the plays out of order moved, the odds chart's four periods", () => {
      const stamps = nbaJSON.plays.flatMap((p) => (p.wallclock ? [Date.parse(p.wallclock)] : []));
      const moved = stamps.filter((s, k) => s !== nba.events[k]?.t).length;
      expect(nba.events).toHaveLength(552);
      expect(moved).toBeGreaterThan(0);
      expect(moved).toBeLessThan(23);
      expect(nba.events.every((x, k) => k === 0 || nba.events[k - 1]!.t <= x.t)).toBe(true);
      expect(nba.periods).toEqual(nbaOdds.periods);
      expect(historyEnd(nba)).toBe(date("2026-10-29T02:43:59Z"));
    });

    it("Man Utd–Bournemouth: kickoff through final whistle, identical wall-time periods, one event per ID", () => {
      expect(historyStart(epl)).toBe(date("2026-10-25T14:00:42Z"));
      expect(historyEnd(epl)).toBe(date("2026-10-25T15:54:12Z"));
      expect(epl.periods).toEqual(eplOdds.periods);
      expect(new Set(epl.events.map((x) => x.id)).size, "real soccer commentary/key-event overlap keeps one monotonic event per provider ID").toBe(epl.events.length);
      expect(epl.events.every((x, k) => k === 0 || epl.events[k - 1]!.t <= x.t)).toBe(true);
    });

    it("Browns–Steelers at halftime: the first two quarters; the World Series: all nine innings", () => {
      expect(actualNFL.events.length).toBeGreaterThan(0);
      expect(actualNFL.periods.map((p) => p.number)).toEqual([1, 2]);
      expect(actualMLB.events.length).toBeGreaterThan(0);
      expect(actualMLB.periods).toHaveLength(9);
    });

    it("Raiders–Jets: the interception, in the lane of the team that threw it", () => {
      const turnovers = parseHistory(sharedFixture("odds/espn-nfl-401873029.json"), "football", "13", "20").events.filter((x) => x.turnover);
      expect(turnovers).toHaveLength(1);
      expect(turnovers[0]!.side).toBe("bottom");
      expect(turnovers[0]!.text).toContain("INTERCEPTED");
    });

    it("maps every timestamp to the identical horizontal coordinate in the two separate modules", () => {
      for (const [name, sample] of [["soccer", epl], ["NBA", nba], ["NFL", actualNFL], ["MLB", actualMLB], ["college", college]] as const) {
        const domain = historyDomain(sample, "final", GAME, origin);
        const odds = new OddsLayout(500, 150, domain, 70);
        const timeline = new OddsLayout(500, 80, domain, 70);
        expect(
          sample.events.every((x) => Math.abs(odds.x(x.t) - timeline.x(x.t)) < 0.0001) && odds.plot.x === timeline.plot.x && odds.plot.width === timeline.plot.width,
          `${name}: separate odds/event modules map every timestamp to the identical horizontal coordinate`,
        ).toBe(true);
      }
    });
  });
});
