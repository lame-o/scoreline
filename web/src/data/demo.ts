/**
 * The demo harness (development only): `/?demo` serves the recorded and
 * synthetic fixtures in test/fixtures instead of the network, with live
 * games whose clocks run and whose scores change on every refresh, so live
 * states (clocks, strips, the score flash and roll) can be seen and
 * screenshotted any time of day. The Mac app's render harness, for the web.
 *
 * It never ships: main.tsx imports it only when `import.meta.env.DEV`.
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

const demo: Fetcher = async (url) => {
  const u = new URL(url);
  const path = u.pathname;
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
    if (path.includes("football/nfl")) return live("espn-nfl-live.synthetic.json", "espn-nfl-scoreboard.json");
    if (path.includes("baseball/mlb")) return live("espn-mlb-live.synthetic.json", "espn-mlb-scoreboard.json");
    if (path.includes("soccer/eng.1")) return live("espn-eng1-live.synthetic.json", "espn-eng1-scoreboard.json");
    if (path.includes("basketball/nba")) return live("espn-nba-live.synthetic.json", "espn-nba-scoreboard.json");
    if (path.includes("college-football")) return fixture("espn-college-football-scoreboard.json");
    return { events: [] };
  }
  if (u.host === "api.bo3.gg" && path.endsWith("/matches")) {
    const status = u.searchParams.get("filter[matches.status][in]") ?? "";
    if (status === "current") return fixture("bo3-matches-current.synthetic.json");
    if (status.startsWith("upcoming")) return fixture("bo3-matches-upcoming.json");
    return fixture("bo3-matches-finished.json");
  }
  if (u.host === "ifsc.results.info") {
    if (path === "/api/v1/") return fixture("ifsc-root.json");
    if (path === "/api/v1/seasons/38") return fixture("ifsc-season.json");
    if (path === "/api/v1/seasons/40") return fixture("ifsc-season-next.json");
    if (path.startsWith("/api/v1/events/")) return fixture("ifsc-event.json");
    return fixture("ifsc-round-results.json");
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
  if (!asked && sessionStorage.getItem("scoreline.demo") !== "1") return false;
  setFetcherOverride(demo);
  void mlbReplay();
  return true;
}
