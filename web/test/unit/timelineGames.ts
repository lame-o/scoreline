/**
 * Real games as the page has them (MatchTimelineTests.swift `TimelineGame`,
 * `timelineGames()`): the same parser, the same marks, their market, from
 * the Swift suite's fixtures (Tests/Fixtures). A test helper.
 */
import { parseESPNDetail, type GameDetail } from "../../src/data/gameDetail";
import type { EventState, ScoreEvent, Sport } from "../../src/data/models";
import { emptyHistory, historyEnd, historyStart, playOf, shownUntil, type MatchHistory } from "../../src/data/odds/history";
import { timelineMarks } from "../../src/data/odds/marks";
import { parseHistory as parsePrices, type Market, type Outcome, type PricePoint } from "../../src/data/odds/polymarket";
import { sharedFixture } from "./fixtures";

export interface TimelineGame {
  readonly name: string;
  readonly event: ScoreEvent;
  readonly detail: GameDetail;
  readonly market: Market;
  readonly series: Partial<Record<Outcome, readonly PricePoint[]>>;
  readonly names: { readonly top: string; readonly bottom: string };
}

export const historyOf = (game: TimelineGame): MatchHistory => game.detail.history ?? emptyHistory("soccer");

const START = 1_800_000_000_000;

function makeEvent(id: string, path: string, sport: Sport, top: [string, string], bottom: [string, string], state: EventState = "final"): ScoreEvent {
  const team = ([teamID, code]: [string, string]) => ({ id: `espn-${sport}-${teamID}`, name: code, abbreviation: code, score: null, logo: null, isWinner: false, color: null, rank: null, record: null, conferenceRecord: null, alternateColor: null });
  return {
    id: `espn-${id}`,
    content: { kind: "match", top: team(top), bottom: team(bottom) },
    state,
    start: START,
    detail: null,
    caption: null,
    link: null,
    ref: { kind: "espn", path, id, sport },
    stage: null,
    clock: null,
    possession: null,
    liveLine: null,
    liveLineRoutine: false,
    broadcast: null,
    venue: null,
    snapshot: null,
  } as unknown as ScoreEvent;
}

function game(name: string, id: string, path: string, sport: Sport, top: [string, string], bottom: [string, string], summary: unknown, tokens: [string, Outcome][], series: Partial<Record<Outcome, readonly PricePoint[]>> | null): TimelineGame {
  const event = makeEvent(id, path, sport, top, bottom);
  const detail = parseESPNDetail(summary, { event, path, id, sport });
  const market: Market = { slug: id, kind: tokens.length === 3 ? "three-way" : "two-way", tokens: tokens.map(([token, outcome]) => ({ token, outcome })), volume: null, start: START };
  // A market where there's no recording: a plain line over the game.
  const h = detail.history;
  const from = (h && historyStart(h)) ?? START;
  const to = (h && historyEnd(h)) ?? START + 3_600_000;
  const flat: PricePoint[] = [];
  for (let t = from; t <= to; t += 60_000) flat.push({ t, p: 0.4 + 0.2 * Math.sin(t / 1000 / 900) });
  return { name, event, detail, market, series: series ?? { top: flat }, names: { top: top[1], bottom: bottom[1] } };
}

let cached: TimelineGame[] | null = null;

export function timelineGames(): TimelineGame[] {
  if (cached) return cached;
  const eplHistory = sharedFixture("odds/pm-epl-mun-bou-history.json") as Record<string, unknown>;
  const eplTokens = Object.keys(eplHistory).sort();
  const eplSeries: Partial<Record<Outcome, readonly PricePoint[]>> = {};
  const outcomes: Outcome[] = ["top", "draw", "bottom"];
  eplTokens.forEach((key, k) => (eplSeries[outcomes[k]!] = parsePrices({ history: eplHistory[key] })));
  // The NBA's whole game, every field Key Plays reads; its plays a steady 20 seconds apart.
  const nbaFixture = sharedFixture("nba-plays-401909095.json") as { home: string; away: string; items: Record<string, unknown>[] };
  const nbaHeader = { competitions: [{ competitors: [{ team: { id: nbaFixture.away }, homeAway: "away" }, { team: { id: nbaFixture.home }, homeAway: "home" }] }] };
  const nbaPlays = nbaFixture.items.map((play, index) => ({ ...play, wallclock: new Date(START + index * 20_000).toISOString().replace(".000Z", "Z") }));
  const mlbHeader = { competitions: [{ competitors: [{ team: { id: "8" }, homeAway: "away" }, { team: { id: "30" }, homeAway: "home" }] }] };
  cached = [
    game("soccer", "401879252", "soccer/eng.1", "soccer", ["360", "MUN"], ["349", "BOU"], sharedFixture("odds/espn-epl-401879252.json"), eplTokens.map((t, k) => [t, outcomes[k]!]), eplSeries),
    game("NFL", "401873029", "football/nfl", "football", ["13", "LV"], ["20", "NYJ"], sharedFixture("odds/espn-nfl-401873029.json"), [["nfl", "top"]], null),
    game("NBA", "401909095", "basketball/nba", "basketball", [nbaFixture.away, "AWAY"], [nbaFixture.home, "HOME"], { plays: nbaPlays, header: nbaHeader }, [["nba", "top"]], null),
    game("MLB", "401908046", "baseball/mlb", "baseball", ["8", "MIL"], ["30", "TB"], { plays: (sharedFixture("ws-g5-plays.json") as { items: unknown[] }).items, header: mlbHeader }, [["mlb", "top"]], null),
  ];
  return cached;
}

export function gameNamed(name: string): TimelineGame {
  const found = timelineGames().find((g) => g.name === name);
  if (!found) throw new Error(`no recorded game ${name}`);
  return found;
}

/** The page at `fraction` of the game: what's been presented, as a live page has it. */
export function liveAt(g: TimelineGame, fraction: number): { game: TimelineGame; now: number } {
  const h = historyOf(g);
  const start = historyStart(h) ?? g.event.start;
  const end = historyEnd(h) ?? start;
  const now = start + (end - start) * fraction;
  const history = shownUntil(h, now);
  const told = new Set(history.events.map((e) => e.id));
  const detail: GameDetail = { ...g.detail, history, moments: g.detail.moments.filter((m) => told.has(playOf(m.id))) };
  const series: Partial<Record<Outcome, readonly PricePoint[]>> = {};
  for (const [o, points] of Object.entries(g.series) as [Outcome, readonly PricePoint[]][]) series[o] = points.filter((p) => p.t <= now);
  return { game: { ...g, event: { ...g.event, state: "live" }, detail, series }, now };
}

export const marksOf = (g: TimelineGame) => timelineMarks(g.detail);
