/**
 * The demo harness (development only): `/?demo` serves the recorded and
 * synthetic fixtures in test/fixtures instead of the network, with live
 * games whose clocks run and whose scores change on every refresh, so live
 * states (clocks, strips, the score flash and roll) can be seen and
 * screenshotted any time of day. The Mac app's render harness, for the web.
 *
 * It never ships: main.tsx imports it only when `import.meta.env.DEV`.
 *
 * Game pages replay recorded games through their own fast lanes: MLB, the
 * NFL, CS2 (a map, round by round, once its page opens) and climbing (a lead
 * final, climber by climber). See each section below.
 */
import { setFetcherOverride, type Fetcher } from "./http";

const files = import.meta.glob<{ default: unknown }>("../../test/fixtures/*.json");

async function fixture(name: string): Promise<Record<string, unknown>> {
  const load = files[`../../test/fixtures/${name}`];
  if (!load) throw new Error(`No fixture ${name}`);
  return structuredClone((await load()).default) as Record<string, unknown>;
}

type Board = { events: Record<string, unknown>[] };

/** Refreshes per scoreboard, so every live game scores on its own rhythm. */
const polls = new Map<string, number>();
const started = Date.now();

/** Every refresh: the clocks move on and the live games score, each side in turn (never backwards). */
function animate(board: Board, path: string): Board {
  const n = polls.get(path) ?? 0;
  const elapsed = (Date.now() - started) / 1000;
  for (const e of board.events) {
    const status = e.status as { clock?: number; type: { state: string; shortDetail: string } };
    if (status.type.state !== "in") continue;
    if (path.includes("football/nfl") && e.id === footballReplayID) {
      applyFootballReplay(e);
      continue;
    }
    // Footballs and basketballs count down from the recorded reading; soccer counts up.
    if (path.includes("soccer")) {
      const minute = Math.min(67 + Math.floor(elapsed / 60), 90);
      status.clock = minute * 60;
      status.type.shortDetail = `${minute}'`;
    } else if (status.clock != null && !path.includes("baseball")) {
      const left = Math.max(190 - Math.floor(elapsed), 0);
      status.clock = left;
      status.type.shortDetail = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} - 2nd`;
    }
    if (path.includes("baseball")) {
      applyReplay(e);
      continue;
    }
    const comps = (e.competitions as { competitors: { score: string }[] }[])[0]!.competitors;
    const bump = path.includes("basketball") ? 2 : path.includes("football") ? 7 : 1;
    const [first, second] = comps;
    if (first) first.score = String(Number(first.score) + bump * Math.floor(n / 2));
    if (second) second.score = String(Number(second.score) + bump * Math.floor((n + 1) / 2));
  }
  return board;
}

// MARK: - MLB game page: a live replay (World Series Game 3, the bottom of the 9th)
//
// The game page reads the summary and the core API's situation, status and
// plays. The harness serves the recorded game cut at a cursor that moves one
// entry every 5 s, starting as Yandy Díaz comes up with two out in
// the 9th: a full-count at-bat pitch by pitch, his RBI double (the theater's
// DOUBLE, a run scoring), then the last out, held there, still live.
// `?demo&mlb=<n>` starts <n> entries in (for screenshots of a given beat).

const MLB_GAME = "401908044";

interface Replay {
  summary: Record<string, unknown>;
  plays: Record<string, unknown>[];
  /** Entries served so far (the cursor): one more every 5 s from the first core request. */
  cursor: number;
  first: number;
  started: number | null;
  end: number;
}

let replay: Replay | null = null;

async function mlbReplay(): Promise<Replay> {
  if (replay) return replay;
  const summary = await fixture("espn-mlb-summary.json");
  const plays = summary.plays as Record<string, unknown>[];
  const at = (p: Record<string, unknown>, ...keys: string[]) => keys.reduce<unknown>((v, k) => (v as Record<string, unknown> | undefined)?.[k], p);
  const start = plays.findLastIndex((p) => at(p, "type", "type") === "start-batterpitcher" && String(at(p, "text") ?? "").includes("Diaz"));
  const end = plays.findIndex((p) => at(p, "type", "type") === "end-inning" && at(p, "period", "number") === 9);
  const offset = Number(sessionStorage.getItem("scoreline.demo.mlb") ?? "0") || 0;
  const first = Math.min(Math.max(start, 0) + 1 + offset, end);
  replay = { summary, plays, cursor: first, first, started: null, end: end < 0 ? plays.length : end };
  return replay;
}

type Entry = Record<string, unknown>;
const get = (v: unknown, ...keys: (string | number)[]): unknown => keys.reduce<unknown>((x, k) => (x as Record<string | number, unknown> | undefined)?.[k], v);

/** The game as of the cursor: score, inning, count, runners. */
function replayState(r: Replay) {
  const served = r.plays.slice(0, r.cursor);
  const last = served.at(-1) as Entry;
  const half = String(get(last, "period", "type") ?? "Bottom");
  const inning = Number(get(last, "period", "number") ?? 9);
  const shortDetail = `${half.startsWith("T") ? "Top" : "Bot"} ${inning}${inning === 1 ? "st" : inning === 2 ? "nd" : inning === 3 ? "rd" : "th"}`;
  const isPitch = get(last, "pitchCoordinate") != null && get(last, "type", "type") !== "play-result";
  const count = (isPitch ? get(last, "resultCount") : get(last, "pitchCount")) as { balls?: number; strikes?: number } | undefined;
  const participants = (get(last, "participants") as { type: string; athlete: { id: string } }[] | undefined) ?? [];
  const who = (type: string) => participants.find((x) => x.type === type)?.athlete.id;
  const runner = (type: string) => (who(type) ? { playerId: Number(who(type)) } : undefined);
  const situation = {
    lastPlay: { $ref: `http://sports.core.api.espn.com/v2/sports/baseball/leagues/mlb/events/${MLB_GAME}/competitions/${MLB_GAME}/plays/${get(last, "id")}?lang=en` },
    balls: Math.min(count?.balls ?? 0, 3),
    strikes: Math.min(count?.strikes ?? 0, 2),
    outs: Number(get(last, "outs") ?? 0),
    onFirst: runner("onFirst"),
    onSecond: runner("onSecond"),
    onThird: runner("onThird"),
    batter: runner("batter") ?? (who("batter") ? { playerId: Number(who("batter")) } : undefined),
    pitcher: runner("pitcher"),
  };
  const home = Number(get(last, "homeScore") ?? 0);
  const away = Number(get(last, "awayScore") ?? 0);
  return { served, last, shortDetail, situation, home, away, inning };
}

/** The recorded summary, cut at the cursor and live. */
function replaySummary(r: Replay): Record<string, unknown> {
  const st = replayState(r);
  const summary = structuredClone(r.summary);
  summary.plays = st.served;
  summary.situation = st.situation;
  const comp = get(summary, "header", "competitions", 0) as Entry;
  comp.status = { type: { state: "in", completed: false, shortDetail: st.shortDetail, detail: st.shortDetail, name: "STATUS_IN_PROGRESS" } };
  // Runs per half-inning, from the scoring plays served so far.
  const runs = { home: Array<number>(st.inning).fill(0), away: Array<number>(st.inning).fill(0) };
  for (const p of st.served) {
    if (get(p, "scoringPlay") !== true) continue;
    const n = Number(get(p, "period", "number")) - 1;
    const side = String(get(p, "period", "type")).startsWith("T") ? "away" : "home";
    if (n >= 0 && n < st.inning) runs[side][n]! += Number(get(p, "scoreValue") ?? 1);
  }
  for (const c of (comp.competitors as Entry[]) ?? []) {
    const side = c.homeAway === "home" ? "home" : "away";
    c.score = String(side === "home" ? st.home : st.away);
    c.winner = false;
    c.linescores = runs[side].map((v) => ({ displayValue: String(v) }));
  }
  summary.winprobability = [{ homeWinPercentage: st.home >= st.away ? 0.5 : 0.004, tiePercentage: 0 }];
  return summary;
}

/** The core API: situation (advancing the cursor), status, plays. */
async function mlbCore(path: string, search: URLSearchParams): Promise<unknown> {
  const r = await mlbReplay();
  // By the clock, not by request, so however often the lane asks, the game moves at one entry per 5 s.
  r.started ??= Date.now();
  r.cursor = Math.min(r.first + 1 + Math.floor((Date.now() - r.started) / 5000), r.end);
  if (path.endsWith("/situation")) return replayState(r).situation;
  if (path.endsWith("/status")) return { type: { state: "in", shortDetail: replayState(r).shortDetail } };
  if (path.endsWith("/plays")) {
    const served = r.plays.slice(0, r.cursor);
    const limit = Number(search.get("limit") ?? 25);
    const page = Number(search.get("page") ?? 1);
    return { count: served.length, pageCount: Math.max(1, Math.ceil(served.length / limit)), items: served.slice((page - 1) * limit, page * limit) };
  }
  return {};
}

/** The scoreboard's copy of the game follows the replay (score, inning, situation). */
function applyReplay(e: Record<string, unknown>): void {
  if (!replay || e.id !== MLB_GAME) return;
  const st = replayState(replay);
  const status = e.status as { type: { shortDetail: string; detail: string } };
  status.type.shortDetail = st.shortDetail;
  status.type.detail = st.shortDetail;
  const comp = (e.competitions as Entry[])[0]!;
  for (const c of comp.competitors as Entry[]) c.score = String(c.homeAway === "home" ? st.home : st.away);
  comp.situation = { ...st.situation, onFirst: st.situation.onFirst != null, onSecond: st.situation.onSecond != null, onThird: st.situation.onThird != null };
}

// MARK: - NFL game page: a live replay (the recorded game's finish)
//
// The football page reads the summary, the scoreboard's situation, and the
// core API's situation, status and plays. The harness serves the recorded
// game (espn-nfl-core-plays.json, `pnpm fixtures football`) cut at a cursor
// that moves one play every 5 s, from the start of the drive that set up the
// last score: the recording has the Texans' tying drive in the 2-minute drill
// (the red zone, a touchdown at 0:52), then overtime (a 42-yard run, the
// Giants' walk-off touchdown), held there, still live. `?demo&nfl=<n>` starts
// <n> plays in (for screenshots of a given beat); `?demo&nfl=final` shows the
// game as it ended. A college final between two ranked teams
// (espn-cfb-summary.json) loads off the scoreboards with `?league=college-football`.

type Play = Entry & { id: string; period: { number: number }; clock: { value: number; displayValue: string }; end?: { down?: number; distance?: number; yardLine?: number; team?: { $ref?: string } } };

interface FootballReplay {
  summary: Entry;
  plays: Play[];
  id: string;
  homeID: string;
  awayID: string;
  first: number;
  cursor: number;
  started: number | null;
  end: number;
  /** `nfl=final`: the game as it ended, not live. */
  final: boolean;
}

let footballReplay: FootballReplay | null = null;
/** The replayed game's ESPN ID, once loaded (the scoreboard adds it, live). */
let footballReplayID: string | null = null;

const teamOf = (ref: unknown) => /\/teams\/(\d+)/.exec(String(ref ?? ""))?.[1] ?? null;
const driveOf = (p: Play) => /\/drives\/(\d+)/.exec(String(get(p, "drive", "$ref") ?? ""))?.[1] ?? null;

async function nflReplay(): Promise<FootballReplay> {
  if (footballReplay) return footballReplay;
  const [summary, core] = await Promise.all([fixture("espn-nfl-summary.json"), fixture("espn-nfl-core-plays.json")]);
  const plays = (core.pages as { items: Play[] }[]).flatMap((p) => p.items);
  const competitors = get(summary, "header", "competitions", 0, "competitors") as Entry[];
  const teamID = (side: string) => String(get(competitors.find((c) => c.homeAway === side), "team", "id") ?? "");
  // From the first snap of the drive that set up the game's last score.
  const scores = plays.flatMap((p, i) => (p.scoringPlay === true ? [i] : []));
  const setup = plays[scores.at(-2) ?? scores.at(-1) ?? 0];
  const start = Math.max(setup ? plays.findIndex((p) => driveOf(p) === driveOf(setup)) : 0, 0);
  const endOfGame = plays.findIndex((p) => get(p, "type", "text") === "End of Game");
  const end = endOfGame < 0 ? plays.length : endOfGame;
  const asked = sessionStorage.getItem("scoreline.demo.nfl") ?? "0";
  const final = asked === "final";
  const offset = Number(asked) || 0;
  const first = final ? plays.length - 1 : Math.min(start + offset, end - 1);
  footballReplay = { summary, plays, id: String(get(summary, "header", "id")), homeID: teamID("home"), awayID: teamID("away"), first, cursor: first + 1, started: null, end: final ? plays.length : end, final };
  footballReplayID = footballReplay.id;
  return footballReplay;
}

/** The cursor moves by the clock, not by request: one play every 5 s from the first look, however often the lane asks. */
function advance(r: FootballReplay): void {
  r.started ??= Date.now();
  r.cursor = Math.min(r.first + 1 + Math.floor((Date.now() - r.started) / 5000), r.end);
}

const ORD = ["", "1st", "2nd", "3rd", "4th"];

/** The game as of the cursor: score, clock, the ball and the timeouts left this half. */
function footballState(r: FootballReplay) {
  const served = r.plays.slice(0, r.cursor);
  const last = served.at(-1)!;
  const period = last.period.number;
  const display = last.clock.displayValue;
  const shortDetail = `${display} - ${period <= 4 ? ORD[period] : period === 5 ? "OT" : `${period - 4}OT`}`;
  const home = Number(last.homeScore ?? 0);
  const away = Number(last.awayScore ?? 0);
  const possession = teamOf(get(last, "end", "team", "$ref")) ?? teamOf(get(last, "team", "$ref"));
  const yardLine = Number(last.end?.yardLine ?? 50);
  const down = Number(last.end?.down ?? 0);
  const distance = Number(last.end?.distance ?? 10);
  const homeBall = possession === r.homeID;
  // Three a half (two in overtime), less those called ("Timeout #2 By Nyg At 01:00").
  const half = period <= 2 ? [1, 2] : period <= 4 ? [3, 4] : [period];
  const called = (abbreviation: string) =>
    served.filter((p) => half.includes(p.period.number) && get(p, "type", "text") === "Timeout" && String(p.shortText ?? p.text ?? "").toLowerCase().includes(`by ${abbreviation.toLowerCase()}`)).length;
  const abbreviation = (id: string) => String(get((get(r.summary, "header", "competitions", 0, "competitors") as Entry[]).find((c) => get(c, "team", "id") === id), "team", "abbreviation") ?? "");
  const allowed = period >= 5 ? 2 : 3;
  const spot = yardLine === 50 ? "50" : yardLine < 50 ? `${abbreviation(r.homeID)} ${yardLine}` : `${abbreviation(r.awayID)} ${100 - yardLine}`;
  const goal = down >= 1 && (homeBall ? 100 - yardLine : yardLine) <= distance;
  return {
    served,
    last,
    period,
    shortDetail,
    home,
    away,
    situation: {
      lastPlay: { $ref: `http://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/${r.id}/competitions/${r.id}/plays/${last.id}?lang=en`, text: String(last.shortText ?? last.text ?? "") },
      down,
      distance,
      yardLine,
      isRedZone: down >= 1 && (homeBall ? yardLine >= 80 : yardLine <= 20),
      homeTimeouts: Math.max(allowed - called(abbreviation(r.homeID)), 0),
      awayTimeouts: Math.max(allowed - called(abbreviation(r.awayID)), 0),
      possession,
      downDistanceText: down >= 1 && down <= 4 ? `${ORD[down]} & ${goal ? "Goal" : distance} at ${spot}` : undefined,
    },
  };
}

/** The recorded summary, cut at the cursor and live: the score by quarter, the scoring plays and win probability so far. */
function footballSummary(r: FootballReplay): Entry {
  if (r.final) return structuredClone(r.summary);
  const st = footballState(r);
  const summary = structuredClone(r.summary);
  const comp = get(summary, "header", "competitions", 0) as Entry;
  comp.status = { clock: st.last.clock.value, displayClock: st.last.clock.displayValue, period: st.period, type: { state: "in", completed: false, shortDetail: st.shortDetail, detail: st.shortDetail, name: "STATUS_IN_PROGRESS" } };
  // Points per quarter: the score at the end of each, less the one before.
  const after = (period: number, side: "homeScore" | "awayScore") => Number(st.served.findLast((p) => p.period.number <= period)?.[side] ?? 0);
  for (const c of comp.competitors as Entry[]) {
    const side = c.homeAway === "home" ? "homeScore" : "awayScore";
    c.score = String(side === "homeScore" ? st.home : st.away);
    c.winner = false;
    c.linescores = Array.from({ length: st.period }, (_, i) => ({ displayValue: String(after(i + 1, side) - after(i, side)) }));
  }
  const served = new Set(st.served.map((p) => p.id));
  summary.scoringPlays = (summary.scoringPlays as Entry[]).filter((p) => served.has(String(p.id)));
  summary.winprobability = (summary.winprobability as Entry[]).filter((w) => served.has(String(w.playId)));
  return summary;
}

/** The core API: situation (advancing the cursor), status, plays. */
async function footballCore(path: string, search: URLSearchParams): Promise<unknown> {
  const r = await nflReplay();
  advance(r);
  const st = footballState(r);
  if (path.endsWith("/situation")) {
    const { lastPlay, down, distance, yardLine, isRedZone, homeTimeouts, awayTimeouts } = st.situation;
    return { lastPlay: { $ref: lastPlay.$ref }, down, distance, yardLine, isRedZone, homeTimeouts, awayTimeouts };
  }
  if (path.endsWith("/status") && r.final) return { clock: 0, displayClock: "0:00", period: st.period, type: { state: "post", completed: true, shortDetail: "Final/OT" } };
  if (path.endsWith("/status")) return { clock: st.last.clock.value, displayClock: st.last.clock.displayValue, period: st.period, type: { state: "in", completed: false, shortDetail: st.shortDetail } };
  if (path.endsWith("/plays")) {
    const limit = Number(search.get("limit") ?? 25);
    const page = Number(search.get("page") ?? 1);
    return { count: st.served.length, pageCount: Math.max(1, Math.ceil(st.served.length / limit)), items: st.served.slice((page - 1) * limit, page * limit) };
  }
  return {};
}

/** The replayed game as a scoreboard event, live (the scores list and the page's full load read it). */
async function footballBoardEvent(): Promise<Entry> {
  const r = await nflReplay();
  const header = get(r.summary, "header") as Entry;
  const comp = get(header, "competitions", 0) as Entry;
  return {
    id: r.id,
    date: comp.date,
    season: { slug: "regular-season", type: 2 },
    status: { type: { state: "in" } },
    competitions: [
      {
        competitors: (comp.competitors as Entry[]).map((c) => {
          const team = c.team as Entry;
          const logos = (team.logos as { href: string; rel: string[] }[] | undefined) ?? [];
          return {
            homeAway: c.homeAway,
            score: "0",
            records: c.record,
            team: { ...team, shortDisplayName: team.name, logo: logos.find((l) => l.rel.includes("default"))?.href ?? logos[0]?.href },
          };
        }),
        broadcasts: [{ market: "national", names: ["FOX"] }],
        venue: { fullName: get(r.summary, "gameInfo", "venue", "fullName") },
      },
    ],
    links: header.links,
  };
}

/** The scoreboard's copy of the game follows the replay (score, clock, situation). */
function applyFootballReplay(e: Entry): void {
  if (!footballReplay) return;
  const st = footballState(footballReplay);
  if (footballReplay.final) {
    e.status = get(footballReplay.summary, "header", "competitions", 0, "status");
    for (const c of (e.competitions as Entry[])[0]!.competitors as Entry[]) c.score = String(c.homeAway === "home" ? st.home : st.away);
    return;
  }
  e.status = { clock: st.last.clock.value, displayClock: st.last.clock.displayValue, period: st.period, type: { state: "in", completed: false, shortDetail: st.shortDetail, detail: st.shortDetail, name: "STATUS_IN_PROGRESS" } };
  const comp = (e.competitions as Entry[])[0]!;
  for (const c of comp.competitors as Entry[]) c.score = String(c.homeAway === "home" ? st.home : st.away);
  comp.situation = st.situation;
}

// MARK: - CS2 match page: a live replay (Liquid–Aurora, map 2, Inferno)
//
// The scoreboard's live match (bo3-matches-current.synthetic.json: Liquid
// 1–0 Aurora, a best of three) plays out map 2 from a recorded map (Liquid's
// 13–8 Inferno against Legacy at PGL Masters Bucharest 2026, Legacy standing
// in as Aurora): one round every 5 s through the page's own fast lane (bo3.gg's
// last snapshot), from 6–6 by default: five straight, MATCH POINT at 12–7,
// the map and the series. The round list lags the snapshot by a round, so
// the newest square slots in provisionally first. Ten seconds after the map,
// the scoreboard has the match final, 2–0. `?demo&cs=<n>` starts n rounds in.

const CS_MATCH = { id: 132240, slug: "liquid-vs-aurora-gaming-27-10-2026", liquid: 790, aurora: 3598, legacy: 8118 } as const;

interface CSReplay {
  match: Record<string, unknown>;
  map1: Record<string, unknown>;
  map2: Record<string, unknown>;
  rounds: Record<string, unknown>[];
  first: number;
  started: number | null;
}

let csReplay: CSReplay | null = null;

/** Legacy becomes Aurora (the demo's live match), everywhere a game names its clan. */
function asAurora<T>(value: T): T {
  return JSON.parse(JSON.stringify(value).replaceAll('"Legacy"', '"Aurora"').replaceAll(`"team_id":${CS_MATCH.legacy}`, `"team_id":${CS_MATCH.aurora}`)) as T;
}

async function csDemo(): Promise<CSReplay> {
  if (csReplay) return csReplay;
  const [match, map1, map2] = await Promise.all([fixture("bo3-demo-match.json"), fixture("bo3-demo-game-1.json"), fixture("bo3-demo-game-2.json")]);
  const offset = Number(sessionStorage.getItem("scoreline.demo.cs") ?? "11") || 0;
  const rounds = (map2.game_rounds as Record<string, unknown>[]).map(asAurora);
  csReplay = { match, map1: asAurora(map1), map2: asAurora(map2), rounds, first: Math.min(Math.max(offset, 0), rounds.length - 1), started: null };
  return csReplay;
}

/** Rounds played on map 2 so far: one more every 5 s from the first look. */
function csPlayed(r: CSReplay): number {
  r.started ??= Date.now();
  return Math.min(r.first + 1 + Math.floor((Date.now() - r.started) / 5000), r.rounds.length);
}

/** Whether the demo match is over (ten seconds after its last round). */
function csFinal(r: CSReplay): boolean {
  return r.started != null && Date.now() - r.started > (r.rounds.length - r.first) * 5000 + 10_000;
}

function csScore(r: CSReplay, played: number): { liquid: number; aurora: number } {
  const done = r.rounds.slice(0, played);
  const liquid = done.filter((x) => x.winner_clan_name === "Team Liquid").length;
  return { liquid, aurora: done.length - liquid };
}

/** The match record: map 1 Liquid's, map 2 live (or over), map 3 to come. */
async function csMatch(): Promise<unknown> {
  const r = await csDemo();
  const played = csPlayed(r);
  const ended = played >= r.rounds.length;
  const final = csFinal(r);
  const score = csScore(r, played);
  const games = (r.match.games as Record<string, unknown>[]).map(asAurora);
  const map1 = games.find((g) => g.number === 1)!;
  const map2 = games.find((g) => g.number === 2)!;
  return {
    ...asAurora(r.match),
    id: CS_MATCH.id,
    slug: CS_MATCH.slug,
    status: final ? "finished" : "current",
    team1_score: ended ? 2 : 1,
    team2_score: 0,
    winner_team_id: final ? CS_MATCH.liquid : null,
    team2: { id: CS_MATCH.aurora, slug: "aurora-gaming", name: "Aurora", image_url: "https://files.bo3.gg/uploads/team/3598/image/webp-49b8df76b0d121cc89c760c1ec16ebea.webp" },
    team2_id: CS_MATCH.aurora,
    games: [
      map1,
      ended ? map2 : { ...map2, status: "current", state: "live", winner_clan_score: null, loser_clan_score: null, winner_team_clan: { team_id: score.liquid >= score.aurora ? CS_MATCH.liquid : CS_MATCH.aurora } },
      { id: 190599, number: 3, map_name: null, status: ended ? "defwin" : "upcoming", state: null },
    ],
  };
}

/** A finished match's page (G2 1–2 DENDELE, recorded whole: three maps, the second to overtime). */
const CS_FINAL = { slug: "g2-vs-dendele-cs-26-10-2026", games: { 190577: 1, 190576: 2, 190575: 3 } as Record<number, number> } as const;

async function csGame(id: number): Promise<unknown> {
  const recorded = CS_FINAL.games[id];
  if (recorded) return fixture(`bo3-detail-game-${recorded}.json`);
  const r = await csDemo();
  if (id === Number(r.map1.id)) return r.map1;
  const played = csPlayed(r);
  // The round list lags the live score by a round (bo3.gg processes rounds after they end).
  const listed = played >= r.rounds.length ? played : Math.max(played - 1, 0);
  return { ...r.map2, status: played >= r.rounds.length ? "finished" : "current", game_rounds: r.rounds.slice(0, listed) };
}

/** bo3.gg's last snapshot, Aurora listed first (the feed's order isn't the match's). Null until the page has opened. */
async function csSnapshot(): Promise<unknown> {
  const r = await csDemo();
  if (r.started == null) return null;
  const played = csPlayed(r);
  const score = csScore(r, played);
  const liquidT = played < 12;
  return {
    map_name: "de_inferno",
    game_number: 2,
    round_number: Math.min(played + 1, r.rounds.length),
    game_ended: played >= r.rounds.length,
    team_one: { score: score.aurora, side: liquidT ? "CT" : "TERRORIST", fixture: { team_id: CS_MATCH.aurora } },
    team_two: { score: score.liquid, side: liquidT ? "TERRORIST" : "CT", fixture: { team_id: CS_MATCH.liquid } },
  };
}

/** The scoreboard's lists follow the replay: live 1–0, then 2–0 and final. */
async function csList(status: string): Promise<unknown> {
  const r = csReplay;
  const final = r ? csFinal(r) : false;
  const current = await fixture("bo3-matches-current.synthetic.json");
  const live = (current.results as Record<string, unknown>[])[0]!;
  if (status === "current") return final ? { results: [] } : current;
  if (status.startsWith("upcoming")) return fixture("bo3-matches-upcoming.json");
  const finished = await fixture("bo3-matches-finished.json");
  if (!final) return finished;
  return { results: [{ ...live, status: "finished", team1_score: 2, team2_score: 0, winner_team_id: CS_MATCH.liquid }, ...(finished.results as unknown[])] };
}

// MARK: - Climbing round page: a live lead final (Santiago 2026, Lead Women)
//
// Santiago's competition is on (its dates moved to today), and its Lead
// Women Final (round 11362, recorded) is climbed again: each climber in the
// starting order rises a few holds every 4 s to the high point they reached,
// then the next one starts, through the page's own fast lane (the round's
// results, refreshed). Passes, the new leader, the podium places and, last,
// Janja Garnbret's top deciding the final; then the round is finished.
// Lead Men's final and Salt Lake City's Boulder Women final show as finals.
// `?demo&climb=<n>` starts n steps in.

const CLIMB = { event: 1489, final: 11362 } as const;

interface ClimbReplay {
  results: Record<string, unknown>;
  /** The climbers in starting order, with the heights they reach, frame by frame. */
  frames: { order: number; height: number; label: string; top: boolean; done: boolean }[];
  first: number;
  started: number | null;
}

let climbReplay: ClimbReplay | null = null;

async function climbDemo(): Promise<ClimbReplay> {
  if (climbReplay) return climbReplay;
  const results = await fixture("ifsc-round-lead-final.json");
  const ranking = results.ranking as Record<string, unknown>[];
  const order = (results.startlist as Record<string, unknown>[])
    .map((s) => ({ id: s.athlete_id as number, position: ((s.route_start_positions as { position: number }[])[0]?.position ?? 0) }))
    .sort((a, b) => a.position - b.position);
  const frames: ClimbReplay["frames"] = [];
  order.forEach((o, index) => {
    const a = ranking.find((x) => x.athlete_id === o.id)!;
    const ascent = (a.ascents as Record<string, unknown>[])[0]!;
    const top = ascent.top === true;
    const label = String(ascent.score ?? "0");
    const final = top ? 49 : Number.parseFloat(label) + (label.endsWith("+") ? 0.5 : 0);
    // Five steps up the wall, the high point while still on it, then the result.
    for (let step = 1; step <= 5; step++) {
      const h = Math.floor((final * step) / 6);
      frames.push({ order: index, height: h, label: String(h), top: false, done: false });
    }
    if (!top) frames.push({ order: index, height: final, label, top: false, done: false });
    frames.push({ order: index, height: final, label: top ? "TOP" : label, top, done: true });
  });
  const offset = Number(sessionStorage.getItem("scoreline.demo.climb") ?? "0") || 0;
  climbReplay = { results, frames, first: Math.min(Math.max(offset, 0), frames.length - 1), started: null };
  return climbReplay;
}

function climbFrame(r: ClimbReplay): number {
  r.started ??= Date.now();
  return Math.min(r.first + Math.floor((Date.now() - r.started) / 4000), r.frames.length);
}

/** The final as of the cursor: who has climbed (and their places), who's on the wall, who waits. */
async function climbResults(): Promise<unknown> {
  const r = await climbDemo();
  const cursor = climbFrame(r);
  const finished = cursor >= r.frames.length;
  const results = structuredClone(r.results);
  const order = (results.startlist as Record<string, unknown>[])
    .map((s) => ({ id: s.athlete_id as number, position: ((s.route_start_positions as { position: number }[])[0]?.position ?? 0) }))
    .sort((a, b) => a.position - b.position);
  const current = r.frames[Math.min(cursor, r.frames.length - 1)]!;
  const shownUpTo = finished ? order.length : current.order;
  const ranking = results.ranking as Record<string, unknown>[];
  const state = new Map<number, { height: number; label: string; top: boolean; active: boolean } | null>();
  order.forEach((o, i) => {
    if (i < shownUpTo || finished) {
      const last = [...r.frames].reverse().find((f) => f.order === i && f.done)!;
      state.set(o.id, { height: last.height, label: last.label, top: last.top, active: false });
    } else if (i === current.order) {
      state.set(o.id, current.done ? { height: current.height, label: current.label, top: current.top, active: false } : { height: current.height, label: current.label, top: false, active: true });
    } else state.set(o.id, null);
  });
  const done = [...state.entries()].filter(([, v]) => v && !v.active) as [number, { height: number; top: boolean }][];
  const rankOf = (id: number) => {
    const me = state.get(id);
    if (!me || me.active) return null;
    return 1 + done.filter(([other, v]) => other !== id && (v.top && !me.top ? true : !me.top && v.height > me.height)).length;
  };
  for (const a of ranking) {
    const v = state.get(a.athlete_id as number) ?? null;
    const ascent = (a.ascents as Record<string, unknown>[])[0]!;
    a.active = v?.active ?? false;
    a.rank = rankOf(a.athlete_id as number);
    a.score = v ? v.label : "";
    ascent.score = v ? v.label : "";
    ascent.top = v?.top ?? false;
    ascent.plus = v ? v.label.endsWith("+") : false;
    ascent.status = !v ? "pending" : v.active ? "active" : "confirmed";
    ascent.rank = a.rank;
  }
  ranking.sort((x, y) => ((x.rank as number | null) ?? 99) - ((y.rank as number | null) ?? 99));
  results.status = finished ? "finished" : "active";
  results.status_as_of = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
  return results;
}

const ifscTime = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 19) + " UTC";

/** The season with Santiago on now (and Salt Lake City just over). */
async function climbSeason(): Promise<unknown> {
  const season = await fixture("ifsc-season.json");
  const now = Date.now();
  for (const e of season.events as Record<string, unknown>[]) {
    if (e.event_id === CLIMB.event) {
      e.starts_at = ifscTime(now - 2 * 86_400_000);
      e.ends_at = ifscTime(now + 86_400_000);
    } else if (e.event_id === 1488) {
      // Its final this morning: on the scores among the day's finals.
      e.starts_at = ifscTime(now - 10 * 3_600_000);
      e.ends_at = ifscTime(now - 2 * 3_600_000);
    }
  }
  return season;
}

async function climbEvent(id: number): Promise<unknown> {
  const now = Date.now();
  if (id === 1488) {
    return { id, name: "World Climbing Series Salt Lake City 2026", d_cats: [{ dcat_id: 7, dcat_name: "BOULDER Women", category_rounds: [{ category_round_id: 11031, name: "Final", status: "finished", status_as_of: ifscTime(now - 3 * 3_600_000), result_url: "/api/v1/category_rounds/11031/results" }] }] };
  }
  const r = climbReplay;
  const over = r ? climbFrame(r) >= r.frames.length : false;
  const event = await fixture("ifsc-event.json");
  const round = (id: number, name: string, status = "finished") => ({ category_round_id: id, name, status, status_as_of: ifscTime(now - 3_600_000), result_url: `/api/v1/category_rounds/${id}/results` });
  return {
    ...event,
    d_cats: [
      { dcat_id: 5, dcat_name: "LEAD Women", category_rounds: [round(10451, "Qualification"), round(11360, "Semi-final"), { ...round(CLIMB.final, "Final", over ? "finished" : "active"), status_as_of: ifscTime(now) }] },
      { dcat_id: 1, dcat_name: "LEAD Men", category_rounds: [round(10450, "Qualification"), round(11359, "Semi-final"), round(11361, "Final")] },
      ...((event.d_cats as Record<string, unknown>[]).filter((c) => String(c.dcat_name).startsWith("SPEED"))),
    ],
  };
}

async function climbRound(path: string): Promise<unknown> {
  const id = Number(/category_rounds\/(\d+)/.exec(path)?.[1]);
  if (id === CLIMB.final) return climbResults();
  if (id === 11361) return fixture("ifsc-round-lead-final-men.json");
  if (id === 10451) return fixture("ifsc-round-lead-qualification.json");
  if (id === 11031) return fixture("ifsc-round-boulder-final.json");
  return fixture("ifsc-round-results.json");
}

const demo: Fetcher = async (url) => {
  const u = new URL(url);
  const path = u.pathname;
  if (u.host === "site.api.espn.com" && path.endsWith("/football/nfl/summary") && u.searchParams.get("event") === (await nflReplay()).id) {
    return footballSummary(await nflReplay());
  }
  if (u.host === "sports.core.api.espn.com" && path.includes(`/football/leagues/nfl/events/${(await nflReplay()).id}/`)) {
    return footballCore(path, u.searchParams);
  }
  if (u.host === "site.api.espn.com" && path.endsWith("/football/college-football/summary")) {
    const cfb = await fixture("espn-cfb-summary.json");
    if (u.searchParams.get("event") === String(get(cfb, "header", "id"))) return cfb;
  }
  if (u.host === "site.api.espn.com" && path.endsWith("/baseball/mlb/summary") && u.searchParams.get("event") === MLB_GAME) {
    return replaySummary(await mlbReplay());
  }
  if (u.host === "sports.core.api.espn.com" && path.includes(`/baseball/leagues/mlb/events/${MLB_GAME}/`)) {
    return mlbCore(path, u.searchParams);
  }
  if (u.host === "site.api.espn.com" && path.endsWith("/scoreboard")) {
    if (!u.searchParams.has("dates")) polls.set(path, (polls.get(path) ?? -1) + 1);
    const live = (name: string, recorded: string) =>
      Promise.all([fixture(name), fixture(recorded)]).then(([a, b]) => animate({ events: [...(a.events as []), ...(b.events as [])] }, path));
    if (path.includes("football/nfl")) {
      const replayed = await footballBoardEvent();
      return Promise.all([fixture("espn-nfl-live.synthetic.json"), fixture("espn-nfl-scoreboard.json")]).then(([a, b]) =>
        animate({ events: [replayed, ...(a.events as []), ...(b.events as [])] }, path),
      );
    }
    if (path.includes("baseball/mlb")) return live("espn-mlb-live.synthetic.json", "espn-mlb-scoreboard.json");
    if (path.includes("soccer/eng.1")) return live("espn-eng1-live.synthetic.json", "espn-eng1-scoreboard.json");
    if (path.includes("basketball/nba")) return live("espn-nba-live.synthetic.json", "espn-nba-scoreboard.json");
    if (path.includes("college-football")) return fixture("espn-college-football-scoreboard.json");
    return { events: [] };
  }
  // Tables and polls: recorded, so live games re-rank them (features/standings).
  if (u.host === "site.api.espn.com" && path.endsWith("/standings")) {
    if (path.includes("soccer/eng.1")) return fixture("standings-eng1.json");
    if (path.includes("basketball/nba")) return fixture("standings-nba.json");
    if (path.includes("college-football")) return fixture("standings-college.json");
  }
  if (u.host === "site.api.espn.com" && path.endsWith("/rankings")) return fixture("standings-rankings.json");
  // The CS2 page's replay, once its page has opened (the scores list's race until then).
  if (u.host === "api.bo3.gg" && path === `/api/v1/live/matches/${CS_MATCH.id}/last_snapshot`) {
    const snapshot = await csSnapshot();
    if (snapshot) return snapshot;
  }
  // CS2's live round: the race moves a round per refresh, then a map is won and it starts over.
  if (u.host === "api.bo3.gg" && path.includes("/live/matches/") && path.endsWith("/last_snapshot")) {
    const n = (polls.get(path) ?? -1) + 1;
    polls.set(path, n);
    const snap = await fixture("bo3-live-snapshot.synthetic.json");
    const one = snap.team_one as { score: number };
    const two = snap.team_two as { score: number };
    one.score = (one.score + Math.floor((n + 1) / 2)) % 14;
    two.score = (two.score + Math.floor(n / 2)) % 14;
    snap.round_number = one.score + two.score + 1;
    return snap;
  }
  if (u.host === "api.bo3.gg" && path.endsWith("/matches")) {
    // A match by ID (a page opened off the scoreboards): the demo's, when it's asked for.
    if (u.searchParams.get("filter[matches.id][eq]") === String(CS_MATCH.id)) return { results: [await csMatch()] };
    return csList(u.searchParams.get("filter[matches.status][in]") ?? "");
  }
  if (u.host === "api.bo3.gg") {
    if (path === `/api/v1/matches/${CS_MATCH.slug}`) return csMatch();
    const game = /\/games\/(\d+)$/.exec(path);
    if (game) return csGame(Number(game[1]));
    if (path === `/api/v1/matches/${CS_FINAL.slug}`) return fixture("bo3-detail-match.json");
    if (path === "/api/v1/teams/g2") return fixture("bo3-detail-team-g2.json");
    if (path === "/api/v1/teams/dendele-cs") return fixture("bo3-detail-team-dendele-cs.json");
    if (path === "/api/v1/teams/liquid") return fixture("bo3-demo-team-liquid.json");
    if (path === "/api/v1/teams/aurora-gaming") return fixture("bo3-demo-team-aurora-gaming.json");
  }
  if (u.host === "ifsc.results.info") {
    if (path === "/api/v1/") return fixture("ifsc-root.json");
    if (path === "/api/v1/seasons/38") return climbSeason();
    if (path === "/api/v1/seasons/40") return fixture("ifsc-season-next.json");
    if (path.startsWith("/api/v1/events/")) return climbEvent(Number(path.split("/").pop()));
    return climbRound(path);
  }
  // Team lists and anything else: empty, as an upstream with nothing to say.
  return { events: [], results: [], sports: [], children: [] };
};

/** Turns the harness on for this tab when the URL asks (`?demo`), and keeps it on across navigation. */
export function installDemo(): boolean {
  const params = new URLSearchParams(location.search);
  const asked = params.has("demo");
  if (asked) sessionStorage.setItem("scoreline.demo", "1");
  if (params.has("mlb")) sessionStorage.setItem("scoreline.demo.mlb", params.get("mlb") ?? "0");
  if (params.has("nfl")) sessionStorage.setItem("scoreline.demo.nfl", params.get("nfl") ?? "0");
  if (params.has("cs")) sessionStorage.setItem("scoreline.demo.cs", params.get("cs") ?? "11");
  if (params.has("climb")) sessionStorage.setItem("scoreline.demo.climb", params.get("climb") ?? "0");
  if (!asked && sessionStorage.getItem("scoreline.demo") !== "1") return false;
  setFetcherOverride(demo);
  void mlbReplay();
  void nflReplay();
  void csDemo();
  void climbDemo();
  return true;
}
