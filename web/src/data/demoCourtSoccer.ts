/**
 * The demo harness's live NBA and soccer games (development only; see
 * demo.ts). Each replays a recorded game through the game page's own lanes:
 * the summary is served cut at a cursor that moves on a clock, and so are
 * the core API's status, situation and plays, so the page's fast lane reads
 * them exactly as it reads ESPN.
 *
 * - NBA (`/game/espn-401909869?demo`): MIN @ CLE, overtime, from 18.1
 *   seconds left: a miss, free throws, Peyton Watson's two that put CLE up,
 *   then Anthony Edwards' 28-footer at the buzzer (a decisive buzzer-beater:
 *   the swish and confetti), one play every 2.5 s. `&nba=<n>` starts n plays
 *   later (`nba=16` lands the buzzer-beater about 10 s after the page opens).
 * - Soccer (`/game/espn-401879256?demo`): Aston Villa v Manchester City from
 *   51', Haaland's header at 52', then Jackson's winner at 60', one action
 *   every 1.5 s (the lane reads every 8 s). `&soccer=<n>` starts n actions
 *   later (`soccer=6` lands the header at the lane's second look, about 8 s in).
 *
 * The box score, leaders and team stats stay as recorded (the final's).
 */
const files = import.meta.glob<{ default: unknown }>("../../test/fixtures/espn-{nba,soccer}-*.json");

async function fixture<T>(name: string): Promise<T> {
  const load = files[`../../test/fixtures/${name}`];
  if (!load) throw new Error(`No fixture ${name}`);
  return structuredClone((await load()).default) as T;
}

type Entry = Record<string, unknown>;
const get = (v: unknown, ...keys: (string | number)[]): unknown => keys.reduce<unknown>((x, k) => (x as Record<string | number, unknown> | undefined)?.[k], v);
const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);

export const NBA_GAME = "401909869";
export const SOCCER_GAME = "401879256";

/** Starting offsets from the URL (`&nba=`, `&soccer=`), kept for the tab like `?demo`. */
export function rememberOffsets(params: URLSearchParams): void {
  for (const key of ["nba", "soccer"]) if (params.has(key)) sessionStorage.setItem(`scoreline.demo.${key}`, params.get(key) ?? "0");
}
const offset = (key: string) => Number(sessionStorage.getItem(`scoreline.demo.${key}`) ?? "0") || 0;

interface Replay {
  summary: Entry;
  items: Entry[];
  /** The fixture's first item's index in the game's full play list. */
  first: number;
  start: number;
  started: number | null;
  end: number;
  step: number;
}

/**
 * Items served so far: by the clock, not by request, so however often the
 * lane asks the game moves at one step per `step` ms. The clock starts with
 * the page's first core API request (the lane's first look), not the
 * scoreboard's polls.
 */
function cursor(r: Replay): number {
  return Math.min(r.start + 1 + (r.started == null ? 0 : Math.floor((Date.now() - r.started) / r.step)), r.end);
}

// MARK: - NBA

let nba: Replay | null = null;

async function nbaReplay(): Promise<Replay> {
  if (nba) return nba;
  const summary = await fixture<Entry>("espn-nba-summary.json");
  const core = await fixture<{ first: number; items: Entry[] }>("espn-nba-core-plays.json");
  // From OT 0:18.1 (ESPN's feed is clean from there); through the buzzer-beater and the end of overtime (not "End of Game": it stays live).
  const start = Math.max(core.items.findIndex((p) => get(p, "period", "number") === 5 && get(p, "clock", "displayValue") === "18.1"), 0);
  const end = core.items.findIndex((p) => get(p, "type", "id") === "402");
  nba = { summary, items: core.items, first: core.first, start: Math.min(start + offset("nba"), end - 1), started: null, end: end < 0 ? core.items.length : end, step: 2500 };
  return nba;
}

const ordinalPeriod = (p: number) => (p > 4 ? (p === 5 ? "OT" : `${p - 4}OT`) : `${p}${["th", "st", "nd", "rd"][p] ?? "th"}`);

function nbaState(r: Replay) {
  const served = r.items.slice(0, cursor(r));
  const last = served.at(-1)!;
  const period = num(get(last, "period", "number"));
  const clock = String(get(last, "clock", "displayValue") ?? "0:00");
  const parts = clock.split(":");
  const seconds = parts.length === 2 ? Number(parts[0]) * 60 + Number(parts[1]) : Number(clock);
  const ended = get(last, "type", "id") === "412";
  return { served, last, period, clock, seconds, shortDetail: ended ? `End of ${ordinalPeriod(period)}` : `${clock} - ${ordinalPeriod(period)}`, home: num(get(last, "homeScore")), away: num(get(last, "awayScore")) };
}

function nbaSummary(r: Replay): Entry {
  const st = nbaState(r);
  const summary = structuredClone(r.summary);
  const plays = summary.plays as Entry[];
  const lastID = String(get(st.last, "id"));
  const cut = plays.findIndex((p) => String(get(p, "id")) === lastID);
  const served = cut >= 0 ? plays.slice(0, cut + 1) : plays;
  summary.plays = served;
  const ids = new Set(served.map((p) => String(get(p, "id"))));
  summary.winprobability = ((summary.winprobability as Entry[]) ?? []).filter((w) => ids.has(String(w.playId)));
  const comp = get(summary, "header", "competitions", 0) as Entry;
  comp.status = { period: st.period, clock: st.seconds, displayClock: st.clock, type: { state: "in", completed: false, shortDetail: st.shortDetail, detail: st.shortDetail, name: "STATUS_IN_PROGRESS" } };
  // Points per period, from each period's last score.
  const ends = new Map<number, { home: number; away: number }>();
  for (const p of served) ends.set(num(get(p, "period", "number")), { home: num(get(p, "homeScore")), away: num(get(p, "awayScore")) });
  for (const c of (comp.competitors as Entry[]) ?? []) {
    const side = c.homeAway === "home" ? "home" : "away";
    c.score = String(side === "home" ? st.home : st.away);
    c.winner = false;
    let before = 0;
    c.linescores = Array.from({ length: st.period }, (_, i) => {
      const at = ends.get(i + 1)?.[side] ?? before;
      const value = at - before;
      before = at;
      return { displayValue: String(value) };
    });
  }
  return summary;
}

async function nbaCore(path: string, search: URLSearchParams): Promise<unknown> {
  const r = await nbaReplay();
  r.started ??= Date.now();
  const st = nbaState(r);
  if (path.endsWith("/situation")) return { lastPlay: { $ref: `http://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events/${NBA_GAME}/competitions/${NBA_GAME}/plays/${String(get(st.last, "id"))}?lang=en` } };
  if (path.endsWith("/status")) return { clock: st.seconds, displayClock: st.clock, period: st.period, type: { state: "in", shortDetail: st.shortDetail } };
  if (path.endsWith("/plays")) return page(st.served, r.first, search);
  return {};
}

/** A page of plays as the core API serves them, with placeholders before the fixture's first play. */
function page(served: readonly Entry[], first: number, search: URLSearchParams) {
  const count = first + served.length;
  const limit = Number(search.get("limit") ?? 25);
  const pageNo = Number(search.get("page") ?? 1);
  if (limit === 1) return { count, pageCount: count, items: served.slice(-1) };
  const from = (pageNo - 1) * limit;
  const items = Array.from({ length: Math.max(0, Math.min(limit, count - from)) }, (_, i) => {
    const index = from + i;
    return index >= first ? served[index - first]! : { id: `demo-${index}` };
  });
  return { count, pageCount: Math.max(1, Math.ceil(count / limit)), items };
}

// MARK: - Soccer

let soccer: Replay | null = null;

async function soccerReplay(): Promise<Replay> {
  if (soccer) return soccer;
  const summary = await fixture<Entry>("espn-soccer-summary.json");
  const core = await fixture<{ items: Entry[] }>("espn-soccer-core-plays.json");
  // From 51' (the window recorded in full runs 48'–62'), to the end of the window.
  const start = Math.max(core.items.findIndex((p) => get(p, "period", "number") === 2 && num(get(p, "clock", "value")) >= 51 * 60), 0);
  const end = core.items.findIndex((p) => get(p, "period", "number") === 2 && num(get(p, "clock", "value")) > 62 * 60);
  soccer = { summary, items: core.items, first: 0, start: Math.min(start + offset("soccer"), Math.max(end, 1) - 1), started: null, end: end < 0 ? core.items.length : end, step: 1500 };
  return soccer;
}

function soccerState(r: Replay) {
  const served = r.items.slice(0, cursor(r));
  const last = served.at(-1)!;
  const seconds = num(get(last, "clock", "value"));
  const minute = Math.max(1, Math.ceil(seconds / 60));
  return { served, last, seconds, minute, detail: `${minute}'`, home: num(get(last, "homeScore")), away: num(get(last, "awayScore")) };
}

function soccerSummary(r: Replay): Entry {
  const st = soccerState(r);
  const summary = structuredClone(r.summary);
  const before = (clock: unknown, period: unknown) => num(period) < 2 || num(get(clock, "value")) <= st.seconds;
  summary.keyEvents = ((summary.keyEvents as Entry[]) ?? []).filter((e) => before(e.clock, get(e, "period", "number")) && !["end-regular-time"].includes(String(get(e, "type", "type"))));
  summary.commentary = ((summary.commentary as Entry[]) ?? []).filter((c) => {
    const v = num(get(c, "time", "value"));
    return v > 0 && v <= st.seconds;
  });
  const comp = get(summary, "header", "competitions", 0) as Entry;
  comp.status = { period: 2, clock: st.seconds, displayClock: st.detail, type: { state: "in", completed: false, shortDetail: st.detail, detail: st.detail, name: "STATUS_SECOND_HALF" } };
  for (const c of (comp.competitors as Entry[]) ?? []) {
    c.score = String(c.homeAway === "home" ? st.home : st.away);
    c.winner = false;
  }
  return summary;
}

async function soccerCore(search: URLSearchParams): Promise<unknown> {
  const r = await soccerReplay();
  r.started ??= Date.now();
  const st = soccerState(r);
  return page(st.served, 0, search);
}

/** The replayed match as a scoreboard event (built from the summary's header), live. */
function soccerEvent(r: Replay): Entry {
  const st = soccerState(r);
  const header = get(r.summary, "header") as Entry;
  const comp = get(header, "competitions", 0) as Entry;
  return {
    id: SOCCER_GAME,
    date: comp.date,
    name: "Manchester City at Aston Villa",
    shortName: "MNC @ AVL",
    season: { slug: "2026-27-english-premier-league", year: 2026 },
    status: { clock: st.seconds, displayClock: st.detail, period: 2, type: { state: "in", completed: false, shortDetail: st.detail, detail: st.detail, name: "STATUS_SECOND_HALF" } },
    competitions: [
      {
        competitors: ((comp.competitors as Entry[]) ?? []).map((c) => ({
          homeAway: c.homeAway,
          score: String(c.homeAway === "home" ? st.home : st.away),
          winner: false,
          records: c.record,
          team: { ...(c.team as Entry), logo: get(c, "team", "logos", 0, "href") },
        })),
        venue: get(r.summary, "gameInfo", "venue"),
      },
    ],
    links: header.links,
  };
}

// MARK: - The harness's hooks

/** Answers the replayed games' summaries and core API calls; undefined for anything else. */
export async function courtSoccerDemo(u: URL): Promise<unknown> {
  const path = u.pathname;
  if (u.host === "site.api.espn.com" && path.endsWith("/basketball/nba/summary") && u.searchParams.get("event") === NBA_GAME) return nbaSummary(await nbaReplay());
  if (u.host === "sports.core.api.espn.com" && path.includes(`/basketball/leagues/nba/events/${NBA_GAME}/`)) return nbaCore(path, u.searchParams);
  if (u.host === "site.api.espn.com" && path.endsWith("/soccer/eng.1/summary") && u.searchParams.get("event") === SOCCER_GAME) return soccerSummary(await soccerReplay());
  if (u.host === "sports.core.api.espn.com" && path.includes(`/soccer/leagues/eng.1/events/${SOCCER_GAME}/`) && path.endsWith("/plays")) return soccerCore(u.searchParams);
  return undefined;
}

/** The scoreboards follow the replays: the NBA game's score and clock, and the soccer match joins the Premier League's board. */
export async function patchBoard(board: { events: Entry[] }, path: string): Promise<void> {
  if (path.includes("basketball/nba")) {
    const r = await nbaReplay();
    const st = nbaState(r);
    const e = board.events.find((x) => x.id === NBA_GAME);
    if (!e) return;
    e.status = { clock: st.seconds, displayClock: st.clock, period: st.period, type: { state: "in", completed: false, shortDetail: st.shortDetail, detail: st.shortDetail, name: "STATUS_IN_PROGRESS" } };
    for (const c of (get(e, "competitions", 0, "competitors") as Entry[]) ?? []) {
      c.score = String(c.homeAway === "home" ? st.home : st.away);
      c.winner = false;
    }
  } else if (path.includes("soccer/eng.1")) {
    const r = await soccerReplay();
    board.events = [soccerEvent(r), ...board.events.filter((x) => x.id !== SOCCER_GAME)];
  }
}

/** Starts both replays' clocks when the harness turns on. */
export function warm(): void {
  void nbaReplay();
  void soccerReplay();
}
