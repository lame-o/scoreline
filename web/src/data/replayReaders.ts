/**
 * The page's replays, built (Replays.swift's builders, `FootballReplays`,
 * `BasketballReplays`, `ReplayBuilder` and `PageReplays.update`; the soccer
 * lane's `readReplays`, LiveFeeds.swift): each sport's replayable plays from
 * its plays, by the live theaters' own builders, each play read once (by ID
 * and digest), every replayable play kept so a row that appears finds its
 * replay waiting. What a finished game is missing (football's and
 * basketball's core plays, the NFL's depth charts, MLB's account) is fetched
 * once, when the page opens, and kept for the game; nothing polls.
 *
 * The Mac reads off the main actor; the web reads on the page's thread,
 * once per play, a moment after what it reads arrives (never when a play is
 * told), and loads this module (the theaters' parsers) only then, so a
 * page's chunk carries none of it.
 *
 *     const session = new ReplaySession();
 *     const { plays, numbers } = await session.update(inputs, getJSON);
 */
import { espnTeamIDs, sideMapper, type GameDetail, type SideOf } from "./gameDetail";
import type { Fetcher } from "./http";
import { arr, at, num, str, type JSONValue } from "./json";
import { baseballMoment } from "./liveFeeds/baseball";
import { momentAt, normalized, type Teams as HoopsTeams } from "./liveFeeds/basketball";
import { depthChart, footballMoment, footballPlay, footballSeason, type DrivePlay, type FootballTeams } from "./liveFeeds/football";
import { actionMoment, pitchAction, pitchScale, type PitchScale } from "./liveFeeds/soccer";
import type { ScoreEvent, Side } from "./models";
import { theater, type PlayScene } from "./mlb/playScene";
import type { Rest } from "./mlb/playScript";
import { feedURL, scheduleURL, statcastFeed, statcastGame, type StatcastAtBat } from "./mlb/statcast";
import { merged, replayValue, tipOff, type PlayReplay, type Replayable } from "./replays";
import { ADMIN, parseScene, replays as replaysInFull, typeOf } from "./theater/basketballScene";
import { FootballDepthChart, parse as parseSnap, type DepthCharts, type FootballScene } from "./theater/footballScene";
import { keepers as keepersIn, parse as parseMoment, playID as soccerPlayID, type Person } from "./theater/soccerScene";

// MARK: - Baseball

/**
 * The field a play leaves: its runners (`bases`, the live diamond's, else
 * the play's own), the next batter (`bats`); after a third out, the sides
 * changed. (PlayTheater.rest(after:); pure)
 */
export function replayRest(play: PlayScene, bases: readonly boolean[] | null, bats: Rest["bats"], batting: Side | null): Rest {
  const swapped = play.endsInning;
  const side: Side = swapped ? (play.batting === "bottom" ? "top" : "bottom") : (play.batting ?? batting ?? "top");
  return { bases: swapped ? [false, false, false] : (bases ?? play.basesAfter), bats, swapped, fieldingHome: side === "top" };
}

/**
 * Baseball, from ESPN's plays (the summary's, or the live lane's): each
 * play-result among `ids` as the theater's state would have it right after
 * (the play, and the batter up next), and the field it leaves, its own
 * runners on base. A result that isn't a play on the field (or doesn't
 * parse) isn't a replay. (Replays.baseball; pure; tested)
 */
export function baseballReplays(plays: readonly JSONValue[], ids: ReadonlySet<string>, side: SideOf, names: Readonly<Record<string, string>>): Record<string, PlayReplay> {
  const results: number[] = [];
  plays.forEach((p, i) => {
    if (str(at(p, "type", "type")) === "play-result") results.push(i);
  });
  const out: Record<string, PlayReplay> = {};
  results.forEach((index, k) => {
    const id = str(at(plays[index], "id"));
    if (id == null || !ids.has(id)) return;
    // Up to the next play: what follows it (the next batter's first pitch) says who's up.
    const end = k + 1 < results.length ? results[k + 1]! : plays.length;
    const state = theater(plays.slice(0, end), side, names);
    const play = state.play;
    if (!play || play.id !== id) return;
    out[id] = { scene: { kind: "baseball", play, rest: replayRest(play, null, state.bats, null) }, moment: baseballMoment(plays[index], side) };
  });
  return out;
}

/** The plays a baseball page's rows are about: its scoring plays and its plays list (GameDetail.swift's `replays`). */
export function baseballRows(detail: GameDetail): Set<string> {
  return new Set([...detail.moments.map((m) => m.id), ...detail.recentPlays.flatMap((p) => (p.id == null ? [] : [p.id]))]);
}

/** Each baseball replay with MLB's account of its play joined, where MLB has it (ReplayBuilder.baseball). */
export function measured(plays: Replayable, atBats: readonly StatcastAtBat[]): Record<string, PlayReplay> {
  const next: Record<string, PlayReplay> = { ...plays };
  for (const [key, replay] of Object.entries(next)) {
    const scene = replay.scene;
    if (scene.kind !== "baseball" || scene.play.measured != null) continue;
    const found = scene.play.measurement(atBats) ?? scene.play.runnerMeasurement(atBats);
    if (found) next[key] = { ...replay, scene: { ...scene, play: scene.play.copy({ measured: found }) } };
  }
  return next;
}

// MARK: - Football

/** A play's digest: the common fields, and where it starts and ends (BroadcastLanes.digest(football:)): equal exactly when they are. */
function digest(play: JSONValue, extra: readonly unknown[]): string {
  const fields: unknown[] = [
    str(at(play, "id")),
    str(at(play, "text")),
    str(at(play, "type", "id")),
    str(at(play, "type", "text")),
    str(at(play, "type", "type")),
    num(at(play, "homeScore")),
    num(at(play, "awayScore")),
    num(at(play, "scoreValue")),
    at(play, "scoringPlay"),
    str(at(play, "wallclock")),
    num(at(play, "period", "number")),
    str(at(play, "clock", "displayValue")),
    str(at(play, "team", "id")) ?? str(at(play, "team", "$ref")),
    ...arr(at(play, "participants")).flatMap((p) => [str(at(p, "athlete", "id")) ?? str(at(p, "athlete", "$ref")), str(at(p, "type"))]),
    ...extra,
  ];
  return JSON.stringify(fields);
}

const footballDigest = (play: JSONValue): string =>
  digest(play, [
    num(at(play, "start", "yardLine")),
    num(at(play, "end", "yardLine")),
    num(at(play, "start", "down")),
    num(at(play, "start", "distance")),
    at(play, "isPenalty"),
    at(play, "isTurnover"),
  ]);

/** A basketball play's digest: the common fields, and where the shot was taken (BroadcastLanes.digest(basketball:)). */
const basketballDigest = (play: JSONValue): string => digest(play, [num(at(play, "coordinate", "x")), num(at(play, "coordinate", "y")), at(play, "shootingPlay")]);

/** Play order: the feed isn't always in it; sequence numbers are. */
function sequenceOf(item: JSONValue): number {
  const s = str(at(item, "sequenceNumber"));
  const n = s != null && s.trim() !== "" ? Number(s) : num(at(item, "sequenceNumber"));
  return n != null && Number.isFinite(n) ? n : 0;
}

/**
 * Spots each snap on its hash from the one before it (oldest first; the
 * first from `previous`, or in the middle with nothing before it).
 * (FootballFeed.spot, as footballTheater.ts `spot`; kept here so this module
 * never loads the theater's drawing side.)
 */
function spot(snaps: readonly FootballScene[], previous: FootballScene | null): FootballScene[] {
  let before = previous;
  return snaps.map((snap) => {
    const spotted = snap.clone();
    spotted.hash = before?.nextHash ?? "middle";
    before = spotted;
    return spotted;
  });
}

/** Both depth charts, read (`FootballDepthChart.from`); a side whose chart doesn't read is left out. */
function readCharts(raw: Readonly<Partial<Record<Side, JSONValue>>>): DepthCharts {
  const charts: { top?: FootballDepthChart; bottom?: FootballDepthChart } = {};
  for (const side of ["top", "bottom"] as const) {
    const chart = raw[side] != null ? FootballDepthChart.from(raw[side]) : null;
    if (chart) charts[side] = chart;
  }
  return charts;
}

type RawCharts = Readonly<Partial<Record<Side, JSONValue>>>;
const NO_CHARTS: RawCharts = {};

/**
 * Football's plays as replays, each read once: a play is parsed again only
 * when its digest changes, and only what follows the first change is spotted
 * and scored again (a snap's hash comes from the one before it, its moment's
 * score from the plays before it). Every snap is kept, whether or not a row
 * shows it yet, so a row that appears finds its replay waiting.
 * (FootballReplays; pure)
 */
export class FootballReplays {
  private parsed = new Map<string, { digest: string; scene: FootballScene | null; drive: DrivePlay | null }>();
  private order: { readonly id: string; readonly digest: string }[] = [];
  private spotted: FootballScene[] = [];
  private built: Record<string, PlayReplay> = {};
  private teams: { top: string | null; bottom: string | null; topIsHome: boolean } | null = null;
  private charts: RawCharts = NO_CHARTS;
  private read_: DepthCharts = {};
  /** How many plays the last read parsed (the tests'). */
  parsedCount = 0;

  /** The replays now, or null when nothing a replay reads has changed. `charts`: the depth charts as ESPN sent them. */
  read(items: readonly JSONValue[], teams: FootballTeams, charts: RawCharts = NO_CHARTS): Record<string, PlayReplay> | null {
    // The feed isn't always in play order; sequence numbers are (ties keep the feed's order).
    const ordered = items
      .map((item, offset) => ({ item, offset, s: sequenceOf(item) }))
      .sort((a, b) => a.s - b.s || a.offset - b.offset)
      .map(({ item }) => item);
    this.parsedCount = 0;
    const fresh = ordered.map((item, offset) => {
      // An entry without an ID can't be kept: its place in the game is all it has.
      const id = str(at(item, "id")) ?? `#${offset}`;
      const d = footballDigest(item);
      if (this.parsed.get(id)?.digest !== d) {
        this.parsed.set(id, { digest: d, scene: parseSnap(item, teams), drive: footballPlay(item, teams) });
        this.parsedCount += 1;
      }
      return { id, digest: d };
    });
    const same = this.teams != null && this.teams.top === teams.topID && this.teams.bottom === teams.bottomID && this.teams.topIsHome === teams.topIsHome;
    const sameCharts = charts.top === this.charts.top && charts.bottom === this.charts.bottom;
    let first = 0;
    if (same && sameCharts) {
      first = Math.min(this.order.length, fresh.length);
      for (let i = 0; i < first; i++) {
        if (this.order[i]!.id !== fresh[i]!.id || this.order[i]!.digest !== fresh[i]!.digest) {
          first = i;
          break;
        }
      }
    }
    if (first === fresh.length && this.order.length === fresh.length) return null;
    if (!sameCharts) this.read_ = readCharts(charts);
    // What came before the first change stays exactly as it was read.
    const before = new Set(fresh.slice(0, first).flatMap((r) => this.parsed.get(r.id)?.scene?.id ?? []));
    const kept: FootballScene[] = [];
    for (const s of this.spotted) {
      if (!before.has(s.id)) break;
      kept.push(s);
    }
    const running = [...kept, ...spot(fresh.slice(first).flatMap((r) => this.parsed.get(r.id)?.scene ?? []), kept.at(-1) ?? null)];
    const drives = fresh.flatMap((r) => this.parsed.get(r.id)?.drive ?? []);
    const places = new Map<string, number>();
    drives.forEach((d, i) => {
      if (!places.has(d.id)) places.set(d.id, i);
    });
    const next: Record<string, PlayReplay> = {};
    for (const [key, replay] of Object.entries(this.built)) if (before.has(key)) next[key] = replay;
    for (const scene of running.slice(kept.length)) {
      const at_ = places.get(scene.id);
      let moment = null;
      if (at_ != null) {
        let score: { home: number; away: number } | null = null;
        for (let i = at_ - 1; i >= 0; i--) {
          const d = drives[i]!;
          if (d.homeScore != null && d.awayScore != null) {
            score = { home: d.homeScore, away: d.awayScore };
            break;
          }
        }
        moment = footballMoment(drives[at_]!, score, teams.topIsHome);
      }
      next[scene.id] = { scene: { kind: "football", scene: scene.slotted(this.read_) }, moment };
    }
    this.order = fresh;
    this.spotted = running;
    this.built = next;
    this.teams = { top: teams.topID, bottom: teams.bottomID, topIsHome: teams.topIsHome };
    this.charts = charts;
    return next;
  }
}

/**
 * Football, from ESPN's core plays: each snap among `ids`, every snap of
 * the game in play order spotted on its hash from the one before (as the
 * live lane spots each from the last, watched from the kickoff), placed on
 * the depth charts; its moment with the score going in. (Replays.football; tested)
 */
export function footballReplays(items: readonly JSONValue[], ids: ReadonlySet<string>, teams: FootballTeams, charts: RawCharts = NO_CHARTS): Record<string, PlayReplay> {
  const all = new FootballReplays().read(items, teams, charts) ?? {};
  return Object.fromEntries(Object.entries(all).filter(([id]) => ids.has(id)));
}

// MARK: - Basketball

/**
 * Where a change's scenes must be read again from: a play's scene reads the
 * plays around it, back to four court plays (past any substitutions and
 * timeouts) for a miss's rebound, and at most twenty rows.
 * (BasketballClips.swift `HoopsSport.sceneStart`; kept here so this module
 * never loads the theater engine.)
 */
export function sceneStart(first: number, json: readonly JSONValue[]): number {
  // reboundAfter reads four court plays, skipping any number of substitutions/timeouts.
  // A raw-row bound alone can leave a miss cached without its newly arrived rebound.
  let from = Math.max(first - 20, 0);
  let court = 0;
  for (let i = first - 1; i >= 0; i--) {
    if (!ADMIN.has(typeOf(json[i]) ?? 0)) court += 1;
    from = Math.min(from, i);
    if (court === 4) break;
  }
  return from;
}

/**
 * Basketball's plays as replays, each read once: a play's scene reads the
 * plays around it, so a change is read again from the sport's own reach
 * before it (`sceneStart`), and nothing earlier is. (BasketballReplays; pure)
 */
export class BasketballReplays {
  private order: { readonly id: string | null; readonly digest: string }[] = [];
  private built = new Map<number, { readonly id: string; readonly replay: PlayReplay }>();
  private teams: { top: string | null; bottom: string | null; topIsHome: boolean } | null = null;
  /** How many plays the last read parsed (the tests'). */
  parsedCount = 0;

  /** The replays now, or null when nothing a replay reads has changed. */
  read(items: readonly JSONValue[], teams: HoopsTeams): Record<string, PlayReplay> | null {
    const fresh = items.map((item) => ({ id: str(at(item, "id")) ?? null, digest: basketballDigest(item) }));
    const same = this.teams != null && this.teams.top === teams.topID && this.teams.bottom === teams.bottomID && this.teams.topIsHome === teams.topIsHome;
    let first = 0;
    if (same) {
      first = Math.min(this.order.length, fresh.length);
      for (let i = 0; i < first; i++) {
        if (this.order[i]!.id !== fresh[i]!.id || this.order[i]!.digest !== fresh[i]!.digest) {
          first = i;
          break;
        }
      }
    }
    this.parsedCount = 0;
    if (first === fresh.length && this.order.length === fresh.length) return null;
    first = sceneStart(first, items);
    for (const key of [...this.built.keys()]) if (key >= first) this.built.delete(key);
    const tip = items.length > 0 ? tipOff(items[0]) : false;
    for (let i = first; i < items.length; i++) {
      this.parsedCount += 1;
      const id = str(at(items[i], "id"));
      const scene = id != null ? parseScene(items, i, teams) : null;
      if (id == null || !scene || !replaysInFull(scene)) continue;
      this.built.set(i, { id, replay: { scene: { kind: "basketball", scene }, moment: momentAt(i, items, teams, tip) } });
    }
    this.order = fresh;
    this.teams = { top: teams.topID, bottom: teams.bottomID, topIsHome: teams.topIsHome };
    // In game order: a later play with the same ID (an edit ESPN listed twice) is the one kept.
    const out: Record<string, PlayReplay> = {};
    for (const key of [...this.built.keys()].sort((a, b) => a - b)) {
      const b = this.built.get(key)!;
      out[b.id] = b.replay;
    }
    return out;
  }
}

/**
 * Basketball, from ESPN's core plays in game order (normalized as the live
 * lane reads them): each play among `ids` that the theater replays in full;
 * its moment as it was when new. (Replays.basketball; tested)
 */
export function basketballReplays(items: readonly JSONValue[], ids: ReadonlySet<string>, teams: HoopsTeams): Record<string, PlayReplay> {
  const all = new BasketballReplays().read(items, teams) ?? {};
  return Object.fromEntries(Object.entries(all).filter(([id]) => ids.has(id)));
}

// MARK: - Soccer

/** Soccer, from ESPN's core plays: the moment at `index` (a shot, a goal) with its build-up and what followed, as the theater parses it. (Replays.soccer) */
export function soccerReplay(plays: readonly JSONValue[], index: number, homeTeamID: string | null, keepers: Readonly<Record<string, Person>>, scale: PitchScale = "percent"): PlayReplay | null {
  const scene = parseMoment(plays, index, homeTeamID, keepers, scale);
  if (!scene) return null;
  const action = pitchAction(plays[index], 0, homeTeamID, scale);
  return { scene: { kind: "soccer", scene }, moment: action ? actionMoment(action) : null };
}

/**
 * Every shot and goal the soccer lane has read, as the theater would replay
 * it, by play ID: each moment in a run of plays (the window and what just
 * came: on the first look, the whole match), each read again while what
 * follows it can still change it (its save, its block, VAR); an entry that's
 * no longer a moment drops out, and a goal VAR struck off goes.
 * (SoccerFeed.readReplays and `retract`, read beside the lane.)
 */
export class SoccerReplays {
  replays: Record<string, PlayReplay> = {};
  private keepers: Record<string, Person> = {};
  private scale: PitchScale | null = null;

  /** The replays after a run (null: no run) and the goals struck off so far; null when nothing changed. */
  read(run: readonly JSONValue[] | null, homeTeamID: string | null, struck: ReadonlySet<string>): Record<string, PlayReplay> | null {
    let next: Record<string, PlayReplay> | null = null;
    if (run && run.length > 0) {
      this.scale ??= pitchScale(run);
      const known = { ...this.keepers, ...keepersIn(run) };
      next = { ...this.replays };
      for (let index = 0; index < run.length; index++) {
        const id = soccerPlayID(run[index]);
        if (id == null) continue;
        const replay = soccerReplay(run, index, homeTeamID, known, this.scale ?? "percent");
        if (replay) next[id] = replay;
        else delete next[id];
      }
      this.keepers = known;
    }
    for (const id of struck) {
      if (!(id in (next ?? this.replays))) continue;
      next ??= { ...this.replays };
      delete next[id];
    }
    if (next == null) return null;
    const was = this.replays;
    this.replays = next;
    const keys = Object.keys(next);
    return keys.length === Object.keys(was).length && keys.every((k) => next[k] === was[k]) ? null : next;
  }
}

// MARK: - The page's replays

/** What a page's replays are built from, as it stands (ReplaySync's inputs). */
export interface ReplayInputs {
  readonly event: ScoreEvent;
  readonly detail: GameDetail;
  /** Soccer: the run its lane read since the last update, and every goal VAR has struck off. */
  readonly soccer?: { readonly run: readonly JSONValue[] | null; readonly struck: ReadonlySet<string> } | null;
  /** Football, live: the lane's every entry. */
  readonly football?: readonly JSONValue[] | null;
  /** Basketball, live: the lane's newest plays. */
  readonly basketball?: readonly JSONValue[] | null;
  /** Where a fetch the live theaters make too is kept (the page's query cache: MLB's feed), so the page asks once. */
  readonly cache?: SharedCache;
}

/** A shared cache: `fetch`'s answer under `key`, fetched at most once per `fresh` ms. */
export type SharedCache = <T>(key: readonly unknown[], fetch: () => Promise<T>, fresh: number) => Promise<T>;

const uncached: SharedCache = (_key, fetch) => fetch();

export interface ReplayUpdate {
  /** Every replayable play now (null: nothing changed). */
  readonly plays: Record<string, PlayReplay> | null;
  /** Baseball: MLB's numbers by name, for the tags. */
  readonly numbers: Readonly<Record<string, string>> | null;
}

/** Finished games' core plays, the last few, kept across visits: a final doesn't change. */
const finals: { readonly event: string; readonly items: readonly JSONValue[] }[] = [];

/**
 * One page's replays: its readers (each sport's, reading each play once),
 * and what it fetched for the game (the core plays, the depth charts), kept
 * while the page is open. (PageReplays' fetching and ReplayBuilder)
 */
export class ReplaySession {
  private football = new FootballReplays();
  private basketball = new BasketballReplays();
  private soccer = new SoccerReplays();
  private baseball: { from: Record<string, PlayReplay>; atBats: number; built: Record<string, PlayReplay> } | null = null;
  private archive: { readonly event: string; readonly items: Promise<readonly JSONValue[]> } | null = null;
  private charts: { readonly event: string; readonly found: Promise<RawCharts> } | null = null;

  /**
   * The page's replays now: built from what the page has, fetching what a
   * game is missing once. Every replayable play is kept (the rows look
   * theirs up), so a play told is already here.
   */
  async update(inputs: ReplayInputs, fetcher: Fetcher): Promise<ReplayUpdate> {
    const { event, detail } = inputs;
    const ref = event.ref;
    if (ref?.kind !== "espn") return { plays: null, numbers: null };
    const live = event.state === "live";
    switch (ref.sport) {
      case "baseball": {
        const side = sideMapper(event);
        const plays = this.keepSame(baseballReplays(detail.replayPlays, baseballRows(detail), side, detail.athleteNames));
        // MLB's account of each play: its feed fetched once for the game (the live theater keeps it current).
        const feed = Object.keys(plays).length > 0 ? await statcastOf(event, fetcher, inputs.cache ?? uncached) : null;
        return { plays: this.joinBaseball(plays, feed?.atBats ?? []), numbers: feed?.numbers ?? null };
      }
      case "soccer":
        return { plays: this.soccer.read(inputs.soccer?.run ?? null, espnTeamIDs(event)[0], inputs.soccer?.struck ?? new Set()), numbers: null };
      case "football": {
        const topIsHome = detail.topIsHome;
        if (topIsHome == null) return { plays: null, numbers: null };
        const teams = footballTeams(event, topIsHome);
        const league = ref.path.split("/").pop() ?? ref.path;
        const items =
          live && inputs.football && inputs.football.length > 0
            ? inputs.football
            : await this.archived(event, `https://sports.core.api.espn.com/v2/sports/football/leagues/${league}/events/${ref.id}/competitions/${ref.id}/plays`, (x) => x, fetcher);
        const charts = league === "nfl" ? await this.depthCharts(event, teams, fetcher) : NO_CHARTS;
        return { plays: this.football.read(items, teams, charts), numbers: null };
      }
      case "basketball": {
        const topIsHome = detail.topIsHome;
        if (topIsHome == null || ref.path !== "basketball/nba") return { plays: null, numbers: null };
        const items = await this.archived(event, `https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events/${ref.id}/competitions/${ref.id}/plays`, normalized, fetcher);
        const teams = hoopsTeams(event, topIsHome);
        return { plays: this.basketball.read(merged(items, live ? (inputs.basketball ?? []) : []), teams), numbers: null };
      }
      default:
        return { plays: null, numbers: null };
    }
  }

  /** Baseball's come built, with the page's summary: what's added here is MLB's account of each (ReplayBuilder.baseball). */
  private joinBaseball(plays: Record<string, PlayReplay>, atBats: readonly StatcastAtBat[]): Record<string, PlayReplay> | null {
    const b = this.baseball;
    if (b && b.atBats === atBats.length && sameReplays(b.from, plays)) return null;
    const next = this.keepSame(measured(plays, atBats));
    const changed = !b || !sameReplays(b.built, next);
    this.baseball = { from: plays, atBats: atBats.length, built: next };
    return changed ? next : null;
  }

  /** Baseball's replays are read again with each summary: one that reads the same is the one already built (Swift compares them by value). */
  private kept = new Map<string, { readonly key: string; readonly replay: PlayReplay }>();
  private keepSame(plays: Record<string, PlayReplay>): Record<string, PlayReplay> {
    const out: Record<string, PlayReplay> = {};
    for (const [id, replay] of Object.entries(plays)) {
      const key = replayValue(replay);
      const was = this.kept.get(id);
      if (was && was.key === key) out[id] = was.replay;
      else {
        this.kept.set(id, { key, replay });
        out[id] = replay;
      }
    }
    return out;
  }

  /** The game's core plays, every page, fetched once (a final's kept for later visits); a page that fails ends the run there. */
  private archived(event: ScoreEvent, base: string, normalize: (item: JSONValue) => JSONValue, fetcher: Fetcher): Promise<readonly JSONValue[]> {
    if (this.archive?.event === event.id) return this.archive.items;
    const kept = finals.find((f) => f.event === event.id);
    if (kept) return Promise.resolve(kept.items);
    const items = (async () => {
      const out: JSONValue[] = [];
      for (let page = 1; ; page++) {
        const json = await fetcher(`${base}?limit=400&page=${page}`).catch(() => null);
        if (json == null) break;
        out.push(...arr(at(json, "items")).map((item) => normalize(item)));
        if (page >= (num(at(json, "pageCount")) ?? page)) break;
      }
      if (out.length === 0) {
        // Nothing came: asked again with the next update.
        if (this.archive?.event === event.id) this.archive = null;
        return out;
      }
      if (event.state === "final") {
        const i = finals.findIndex((f) => f.event === event.id);
        if (i >= 0) finals.splice(i, 1);
        finals.push({ event: event.id, items: out });
        if (finals.length > 4) finals.shift();
      }
      return out;
    })();
    this.archive = { event: event.id, items };
    return items;
  }

  /** Both NFL depth charts (the live lane's, cached for the day). */
  private depthCharts(event: ScoreEvent, teams: FootballTeams, fetcher: Fetcher): Promise<RawCharts> {
    if (this.charts?.event === event.id) return this.charts.found;
    const season = footballSeason(event.start);
    const now = Date.now();
    const found = Promise.all([depthChart(fetcher, teams.topID, season, now), depthChart(fetcher, teams.bottomID, season, now)]).then(([top, bottom]) => {
      const out: { top?: JSONValue; bottom?: JSONValue } = {};
      if (top != null) out.top = top;
      if (bottom != null) out.bottom = bottom;
      return out;
    });
    this.charts = { event: event.id, found };
    return found;
  }
}

function sameReplays(a: Replayable, b: Replayable): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

/** MLB's feed for an ESPN game, through the page's query cache (the play theater's own queries: one fetch for both). */
async function statcastOf(event: ScoreEvent, fetcher: Fetcher, cache: SharedCache): Promise<ReturnType<typeof statcastFeed> | null> {
  const ref = event.ref;
  const teams = event.content.kind === "match" ? [event.content.top.name, event.content.bottom.name] : [];
  if (ref?.kind !== "espn" || !ref.path.endsWith("/mlb") || teams.length !== 2) return null;
  try {
    const game = await cache(["statcast", "game", event.id], async () => statcastGame(await fetcher(scheduleURL(event.start)), teams), Infinity);
    if (game == null) return null;
    return await cache(["statcast", "feed", game], async () => statcastFeed(await fetcher(feedURL(game))), event.state === "final" ? Infinity : 60_000);
  } catch {
    return null;
  }
}

/** An event's football teams: ESPN team IDs, codes and names, home from the summary (FootballFeed.Teams(event:)). */
export function footballTeams(event: ScoreEvent, homeIsTop: boolean): FootballTeams {
  const [topID, bottomID] = espnTeamIDs(event);
  const top = event.content.kind === "match" ? event.content.top : null;
  const bottom = event.content.kind === "match" ? event.content.bottom : null;
  return {
    topIsHome: homeIsTop,
    topID,
    bottomID,
    homeAbbreviation: (homeIsTop ? top : bottom)?.abbreviation ?? "",
    awayAbbreviation: (homeIsTop ? bottom : top)?.abbreviation ?? "",
    homeName: (homeIsTop ? top : bottom)?.name ?? "",
    awayName: (homeIsTop ? bottom : top)?.name ?? "",
  };
}

/** An event's basketball teams, by ESPN team ID and code (BasketballFeed.Teams(event:)). */
export function hoopsTeams(event: ScoreEvent, topIsHome: boolean): HoopsTeams {
  const [topID, bottomID] = espnTeamIDs(event);
  const top = event.content.kind === "match" ? event.content.top : null;
  const bottom = event.content.kind === "match" ? event.content.bottom : null;
  return { topIsHome, topID, bottomID, topName: top?.abbreviation ?? "", bottomName: bottom?.abbreviation ?? "" };
}

