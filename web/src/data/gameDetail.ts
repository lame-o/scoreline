/**
 * Everything a game page can show (GameDetail.swift `GameDetail`), and
 * ESPN's summary read into it (`ESPNDetail`). Each source fills what it has;
 * the page renders only the parts that are present. "Top"/"bottom" always
 * follow the event's competitor order, so the detail lines up with the row
 * it came from.
 *
 * Fetching by ID: `fetchDetail(event)` dispatches on the event's ref (ESPN's
 * `summary?event=`, bo3.gg's match, an IFSC round). A game that isn't on any
 * scoreboard is built from its summary's header (`eventFromSummary`), so any
 * ESPN game loads, not only the scoreboard's.
 *
 *     const detail = await fetchDetail(event, getJSON, { signal });
 */
import { broadcaster, type Broadcaster } from "./broadcasters";
import { enDash, periodLabel } from "./format";
import type { Fetcher } from "./http";
import { arr, at, bool, has, num, str, type JSONValue } from "./json";
import type { Competitor, CSLive, ScoreEvent, Side, Sport } from "./models";
import { makeEvent } from "./providers/espn";
import { homeWinProbability, keyMoments as basketballMoments, NBA_STATS, parseBasketball, predictor, quarterLength, recentPlays as basketballPlays, WNBA_PATH, type Basketball } from "./basketball";

// MARK: - Model

export interface Stat {
  readonly label: string;
  readonly top: string;
  readonly bottom: string;
  /** Share of the bar belonging to the top competitor (0…1). */
  readonly topShare: number;
}

export interface Linescore {
  readonly headers: readonly string[];
  readonly top: readonly string[];
  readonly bottom: readonly string[];
}

export type MomentKind = "goal" | "ownGoal" | "yellow" | "red" | "score" | "other";

/** A key event or scoring play (GameDetail.Moment; not a live `LiveMoment`). */
export interface DetailMoment {
  readonly id: string;
  readonly kind: MomentKind;
  readonly clock: string;
  readonly text: string;
  readonly side: Side | null;
  /** Match minute, for placing it on the soccer timeline. */
  readonly minute: number | null;
  /** Score after this play, top–bottom. */
  readonly score: string | null;
  /** Inning or quarter, for linking to the line score. */
  readonly period: number | null;
}

export interface Football {
  readonly downDistance: string | null;
  /** Ball position, 0 = left (top team's) goal line, 100 = right goal line. */
  readonly ballX: number;
  /** First-down marker in the same coordinates. */
  readonly lineToGainX: number | null;
  readonly possession: Side | null;
  readonly redZone: boolean;
  readonly topTimeouts: number | null;
  readonly bottomTimeouts: number | null;
  readonly lastPlay: string | null;
}

export interface Baseball {
  readonly balls: number;
  readonly strikes: number;
  readonly outs: number;
  readonly onFirst: boolean;
  readonly onSecond: boolean;
  readonly onThird: boolean;
  readonly batter: string | null;
  readonly pitcher: string | null;
  readonly lastPlay: string | null;
  /** Who's on first, second and third, by short name, where ESPN says. */
  readonly runners: readonly [string | null, string | null, string | null];
  /** ESPN athlete IDs for the matchup (their names open their pages). */
  readonly batterID: string | null;
  readonly pitcherID: string | null;
}

export type PitchResult = "ball" | "strike" | "inPlay";
/** How a strike came. */
export type StrikeKind = "called" | "swinging" | "foul" | "foulTip";

/**
 * A pitch of the current at-bat, in ESPN's pitch coordinates (strike zone
 * ≈ x 91…141, y 148…192, inferred from where called strikes land).
 */
export interface Pitch {
  readonly id: string;
  readonly number: number;
  readonly x: number;
  readonly y: number;
  readonly result: PitchResult;
  /** ESPN's abbreviation ("FF"); shown through `pitchCode` ("FB"). */
  readonly type: string | null;
  /** Full name ("Four-seam fastball"). */
  readonly typeName: string | null;
  readonly mph: number | null;
  /** Null for a ball, a ball in play, or a strike ESPN doesn't explain (an automatic one). */
  readonly strike: StrikeKind | null;
}

/** MLB pitch codes, for when ESPN sends only the abbreviation (GameDetail.Pitch.names). */
export const PITCH_NAMES: Readonly<Record<string, string>> = {
  FF: "Four-seam", FA: "Fastball", FT: "Two-seam", SI: "Sinker", FC: "Cutter", SL: "Slider",
  ST: "Sweeper", SV: "Slurve", CU: "Curveball", KC: "Knuckle curve", CS: "Slow curve",
  CH: "Changeup", FS: "Splitter", FO: "Forkball", SC: "Screwball", KN: "Knuckleball",
  EP: "Eephus", PO: "Pitchout", IN: "Intentional ball", UN: "Unknown",
};

/** Codes as fans read them: a fastball is "FB", not Statcast's "FF" (StrikeZoneView.codes). */
export function pitchCode(code: string | null | undefined): string | null {
  if (!code) return null;
  return code === "FF" || code === "FA" ? "FB" : code;
}

/** A pitch's names, longest first: full ("Four-seam fastball"), short ("Four-seam"), code ("FB") (StrikeZoneView.names). */
export function pitchNames(pitch: Pitch): readonly [string, string, string] {
  const short = pitch.type ? PITCH_NAMES[pitch.type] : undefined;
  const full = pitch.typeName ?? short ?? pitch.type ?? "Pitch";
  return [full, short ?? full, pitchCode(pitch.type) ?? short ?? full];
}

/** What the pitch did, in the list: how a strike came, not just "Strike" (StrikeZoneView.resultWord). */
export function pitchResultWord(pitch: Pitch): string {
  if (pitch.result === "ball") return "Ball";
  if (pitch.result === "inPlay") return "In play";
  switch (pitch.strike) {
    case "called":
      return "Called";
    case "swinging":
      return "Swinging";
    case "foul":
      return "Foul";
    case "foulTip":
      return "Foul tip";
    default:
      return "Strike";
  }
}

export type BattedOutcome = "single" | "extraBases" | "homeRun" | "out";

/**
 * A ball in play, in ESPN's hit coordinates (home plate ≈ (125, 205), fence
 * ≈ 165 units out: calibrated from home runs and ground outs).
 */
export interface BattedBall {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly outcome: BattedOutcome;
  /** The batting team. */
  readonly side: Side | null;
  readonly text: string;
  readonly period: number | null;
}

export interface MapResult {
  readonly number: number;
  readonly name: string;
  readonly topScore: number | null;
  readonly bottomScore: number | null;
  readonly winner: Side | null;
  readonly live: boolean;
}

export interface Stream {
  readonly id: number;
  readonly name: string;
  readonly url: string;
  readonly viewers: number;
  readonly official: boolean;
  readonly language: string | null;
}

export interface Athlete {
  readonly id: number;
  readonly rank: number | null;
  readonly name: string;
  readonly country: string | null;
  readonly score: string | null;
}

/** A CS2 tournament a match belongs to, for its bracket. */
export interface Tournament {
  readonly slug: string;
  readonly name: string;
  /** "Group Stage · Round 2", "Playoffs · Quarterfinal". */
  readonly stage: string | null;
}

/**
 * The detail page's data. Sport agents add their own parts here (NBA's
 * `basketball`, CS2's rosters and rounds, climbing's wall and scorecards)
 * as they port them; every part is optional so the page renders what's there.
 */
export interface GameDetail {
  readonly stats: readonly Stat[];
  readonly linescore: Linescore | null;
  readonly moments: readonly DetailMoment[];
  readonly recentPlays: readonly string[];
  /** Win probability for the top competitor. */
  readonly topWinProbability: number | null;
  /** Chance of a draw (soccer), so it isn't folded into either side. */
  readonly drawProbability: number | null;
  readonly football: Football | null;
  readonly baseball: Baseball | null;
  readonly atBat: readonly Pitch[];
  readonly battedBalls: readonly BattedBall[];
  /** NBA and WNBA: shot chart, game flow, leaders, box score, injuries (data/basketball.ts). */
  readonly basketball: Basketball | null;
  /**
   * Baseball, live: the summary's plays, for the play theater until the live
   * lane has spoken (`theater()` in data/mlb/playScene.ts reads them).
   */
  readonly plays: readonly JSONValue[];
  /** Whether the top (first listed) team is at home; ESPN sports only. */
  readonly topIsHome: boolean | null;
  /** Player ID → short name ("Y. Diaz"), from the box score, so the live lane can name the batter and pitcher. */
  readonly athleteNames: Readonly<Record<string, string>>;
  readonly venue: string | null;
  /** ESPN's `header.season.current`: false for a game from a past season. Null when unknown. */
  readonly seasonIsCurrent: boolean | null;
  readonly broadcast: string | null;
  /** Official broadcasters (US market, as ESPN reports them), radio last. */
  readonly broadcasters: readonly Broadcaster[];
  // CS2 (CSDetail; to port)
  readonly maps: readonly MapResult[];
  readonly streams: readonly Stream[];
  readonly csLive: CSLive | null;
  readonly tournament: Tournament | null;
  // Climbing (ClimbingDetail; to port)
  readonly ranking: readonly Athlete[];
  readonly roundName: string | null;
  readonly roundStatus: string | null;
}

export const EMPTY_DETAIL: GameDetail = {
  stats: [],
  linescore: null,
  moments: [],
  recentPlays: [],
  topWinProbability: null,
  drawProbability: null,
  football: null,
  baseball: null,
  atBat: [],
  battedBalls: [],
  basketball: null,
  plays: [],
  topIsHome: null,
  athleteNames: {},
  venue: null,
  seasonIsCurrent: null,
  broadcast: null,
  broadcasters: [],
  maps: [],
  streams: [],
  csLive: null,
  tournament: null,
  ranking: [],
  roundName: null,
  roundStatus: null,
};

/** Maps a source's team IDs onto the event's top/bottom order. */
export type SideOf = (teamID: string | null | undefined) => Side | null;

/** ESPN team IDs in top/bottom order ("espn-baseball-30" → "30"). */
export function espnTeamIDs(event: ScoreEvent): readonly [string | null, string | null] {
  if (event.content.kind !== "match") return [null, null];
  const last = (c: Competitor) => c.id?.split("-").pop() ?? null;
  return [last(event.content.top), last(event.content.bottom)];
}

export function sideMapper(event: ScoreEvent): SideOf {
  const [top, bottom] = espnTeamIDs(event);
  return (id) => (id == null ? null : id === top ? "top" : id === bottom ? "bottom" : null);
}

// MARK: - Fetching

export interface DetailOptions {
  readonly signal?: AbortSignal;
  readonly now?: number;
}

/** Every source's detail (DetailProvider.detail). */
export async function fetchDetail(event: ScoreEvent, fetcher: Fetcher, options: DetailOptions = {}): Promise<GameDetail> {
  const ref = event.ref;
  switch (ref?.kind) {
    case "espn":
      return fetchESPNDetail(event, ref.path, ref.id, ref.sport, fetcher, options);
    case "counterStrike":
      return fetchCSDetail(ref.slug, event, fetcher, options);
    case "climbing":
      return fetchClimbingDetail(ref.resultURL, ref.nextURL, fetcher, options);
    default:
      return EMPTY_DETAIL;
  }
}

export const summaryURL = (path: string, id: string) => `https://site.api.espn.com/apis/site/v2/sports/${path}/summary?event=${id}`;
export const scoreboardURL = (path: string) => `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard`;

/** ESPN's summary, plus the scoreboard's live situation for football and baseball (ESPNDetail.load). */
export async function fetchESPNDetail(event: ScoreEvent, path: string, id: string, sport: Sport, fetcher: Fetcher, options: DetailOptions = {}): Promise<GameDetail> {
  // The live situation (down & distance, count and bases) only exists for
  // football and baseball, and only on the scoreboard.
  const needsSituation = event.state === "live" && (sport === "football" || sport === "baseball");
  const [summary, board] = await Promise.all([
    fetcher(summaryURL(path, id), { signal: options.signal }),
    needsSituation ? fetcher(scoreboardURL(path), { signal: options.signal }).catch(() => null) : Promise.resolve(null),
  ]);
  return parseESPNDetail(summary, { event, path, id, sport, board });
}

/**
 * CS2 (CSDetail.load): bo3.gg's match with games and streams, rosters, rounds
 * and the live snapshot.
 * TODO(cs2 agent): port CSDetail (GameDetail.swift) here: maps, streams,
 * tournament, rosters, round history (with its finished-map cache) and
 * `parseLive`. Returns an empty detail until then.
 */
export async function fetchCSDetail(slug: string, _event: ScoreEvent, fetcher: Fetcher, options: DetailOptions = {}): Promise<GameDetail> {
  const match = await fetcher(`https://api.bo3.gg/api/v1/matches/${slug}?with=games,streams`, { signal: options.signal });
  return { ...EMPTY_DETAIL, roundName: str(at(match, "stage", "name")) ?? null };
}

/**
 * Climbing (ClimbingDetail.load): an IFSC round's results and the next
 * round's starting order.
 * TODO(climbing agent): port ClimbingDetail (GameDetail.swift): ranking,
 * wall routes, boulder cards, up next, startlist. Returns the ranking only.
 */
export async function fetchClimbingDetail(resultURL: string | null, _nextURL: string | null, fetcher: Fetcher, options: DetailOptions = {}): Promise<GameDetail> {
  if (!resultURL) return EMPTY_DETAIL;
  const results = await fetcher(new URL(resultURL, "https://ifsc.results.info").href, { signal: options.signal });
  const ranking = arr(at(results, "ranking")).flatMap((a): Athlete[] => {
    const id = num(at(a, "athlete_id")) ?? num(at(a, "id"));
    if (id == null) return [];
    const last = capitalized(str(at(a, "lastname")) ?? "");
    const score = str(at(a, "score"));
    return [{ id, rank: num(at(a, "rank")) ?? null, name: `${str(at(a, "firstname")) ?? ""} ${last}`, country: str(at(a, "country")) ?? null, score: score ? score : null }];
  });
  return { ...EMPTY_DETAIL, ranking, roundName: str(at(results, "round")) ?? null, roundStatus: str(at(results, "status")) ?? null };
}

const capitalized = (s: string) => s.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (m) => m.toUpperCase());

// MARK: - A game from its summary

/**
 * The event a summary describes, for a game that isn't on any scoreboard the
 * app reads (an old game, another league's). The summary's header has the
 * scoreboard's shape with a few differences (logos as a list, `record` for
 * `records`, the note as `gameNote`, the season type as a number), so it's
 * reshaped and read by the scoreboard's own `makeEvent`.
 */
export function eventFromSummary(summary: JSONValue, path: string, sport: Sport, now: number): ScoreEvent | null {
  const header = at(summary, "header");
  const competition = at(header, "competitions", 0);
  if (!competition) return null;
  const competitors = arr(at(competition, "competitors")).map((c) => {
    const team = at(c, "team") as Record<string, unknown> | undefined;
    const logos = arr(at(team, "logos"));
    const logo = str(at(team, "logo")) ?? str(at(logos.find((l) => arr(at(l, "rel")).includes("default")) ?? logos[0], "href"));
    // The header has no short name: a college team goes by its school ("Michigan"), the rest by name ("Rays").
    const short = str(at(team, "shortDisplayName")) ?? (path.endsWith("college-football") ? str(at(team, "location")) : str(at(team, "name")));
    return {
      ...(c as Record<string, unknown>),
      team: { ...(team ?? {}), logo, shortDisplayName: short },
      records: at(c, "records") ?? at(c, "record"),
    };
  });
  const seasonType = num(at(header, "season", "type"));
  const note = str(at(header, "gameNote"));
  const shaped = {
    id: str(at(header, "id")) ?? str(at(competition, "id")),
    date: str(at(competition, "date")),
    status: at(competition, "status"),
    links: at(header, "links"),
    season: { slug: seasonType === 3 ? "post-season" : seasonType === 1 ? "preseason" : "regular-season" },
    competitions: [
      {
        ...(competition as Record<string, unknown>),
        competitors,
        notes: note ? [{ headline: note }] : at(competition, "notes"),
        venue: at(summary, "gameInfo", "venue") ?? at(competition, "venue"),
        broadcasts: arr(at(competition, "broadcasts")).map((b) => ({ ...(b as Record<string, unknown>), names: [str(at(b, "media", "shortName"))].filter(Boolean) })),
        series: arr(at(competition, "series")).find((s) => str(at(s, "type")) === "current") ?? at(competition, "series", 0),
      },
    ],
  };
  return makeEvent(shaped, sport, path, now);
}

// MARK: - ESPN summary

export interface ESPNDetailInputs {
  readonly event: ScoreEvent;
  readonly path: string;
  readonly id: string;
  readonly sport: Sport;
  /** The league's scoreboard, for the live situation (football, baseball). */
  readonly board?: JSONValue;
}

/** ESPNDetail.load's parsing, as a pure function of the summary (and the scoreboard while live). */
export function parseESPNDetail(summary: JSONValue, { event, path, id, sport, board }: ESPNDetailInputs): GameDetail {
  const [topID, bottomID] = espnTeamIDs(event);
  const side = sideMapper(event);

  const competition = at(summary, "header", "competitions", 0);
  const competitors = arr(at(competition, "competitors"));
  const topComp = competitors.find((c) => str(at(c, "team", "id")) === topID);
  const bottomComp = competitors.find((c) => str(at(c, "team", "id")) === bottomID);
  const topIsHome = topComp ? str(at(topComp, "homeAway")) === "home" : null;

  const seen = new Set<string>();
  const broadcasters = arr(at(competition, "broadcasts"))
    .flatMap((b): Broadcaster[] => {
      const name = str(at(b, "media", "shortName")) ?? str(at(b, "media", "callLetters"));
      if (!name || seen.has(name)) return [];
      seen.add(name);
      return [broadcaster(name, str(at(b, "type", "shortName")) ?? null)];
    })
    // Radio last: most people are looking for a picture.
    .sort((a, b) => (a.kind === "radio" ? 1 : 0) - (b.kind === "radio" ? 1 : 0));

  let topWinProbability: number | null = null;
  let drawProbability: number | null = null;
  // Win probability is reported for the home side.
  const latest = arr(at(summary, "winprobability")).at(-1);
  const home = num(at(latest, "homeWinPercentage"));
  if (home != null) {
    const tie = num(at(latest, "tiePercentage")) ?? 0;
    topWinProbability = topIsHome ? home : Math.max(1 - home - tie, 0);
    drawProbability = tie > 0 ? tie : null;
  }

  let moments: DetailMoment[] = [];
  let recentPlays: string[] = [];
  let atBat: Pitch[] = [];
  let battedBallsList: BattedBall[] = [];
  let plays: readonly JSONValue[] = [];
  const athleteNames: Record<string, string> = {};
  let basketball: Basketball | null = null;

  // The NBA and WNBA have their own page (data/basketball.ts); other basketball reads like the rest.
  switch (sport === "basketball" && (path === NBA_PATH_ || path === WNBA_PATH) ? "nba" : sport) {
    case "soccer":
      moments = arr(at(summary, "keyEvents")).flatMap((e) => soccerMoment(e, side) ?? []);
      recentPlays = arr(at(summary, "commentary"))
        .slice(-4)
        .reverse()
        .flatMap((c) => {
          const t = str(at(c, "text"));
          if (!t) return [];
          const time = str(at(c, "time", "displayValue")) ?? "";
          return [time ? `${time}  ${t}` : t];
        });
      break;
    case "baseball": {
      plays = arr(at(summary, "plays"));
      moments = plays
        .filter((p) => bool(at(p, "scoringPlay")) === true)
        .map((p, i) => ({
          id: str(at(p, "id")) ?? `score-${i}`,
          kind: "score" as const,
          clock: str(at(p, "period", "displayValue")) ?? "",
          text: str(at(p, "text")) ?? "",
          side: side(str(at(p, "team", "id"))),
          minute: null,
          score: scoreAfter(p, topIsHome === true),
          period: num(at(p, "period", "number")) ?? null,
        }));
      recentPlays = plays
        .filter((p) => str(at(p, "type", "type")) === "play-result")
        .slice(-4)
        .reverse()
        .flatMap((p) => str(at(p, "text")) ?? []);
      atBat = currentAtBat(plays);
      battedBallsList = battedBalls(plays, side);
      for (const team of arr(at(summary, "boxscore", "players"))) {
        for (const group of arr(at(team, "statistics"))) {
          for (const entry of arr(at(group, "athletes"))) {
            const athlete = at(entry, "athlete");
            const aid = str(at(athlete, "id"));
            const name = str(at(athlete, "shortName")) ?? str(at(athlete, "displayName"));
            if (aid && name) athleteNames[aid] = name;
          }
        }
      }
      // Only a live game's theater replays; the window is the last 80 plays (BaseballFeed.windowSize).
      if (event.state !== "live") plays = [];
      else plays = plays.slice(-80);
      break;
    }
    case "nba": {
      // The NBA page (the WNBA reads the same feed, with 10-minute quarters).
      basketball = parseBasketball(summary, side, topIsHome === true, quarterLength(path));
      moments = basketballMoments(summary, side, topIsHome === true);
      // Game order is array order (sequence numbers aren't).
      recentPlays = basketballPlays(arr(at(summary, "plays")));
      // Joined to the plays by ID; before tip-off, ESPN's matchup predictor stands in.
      const home = homeWinProbability(summary);
      if (home != null) {
        topWinProbability = topIsHome ? home : 1 - home;
        drawProbability = null;
      }
      topWinProbability ??= predictor(summary, topIsHome === true);
      break;
    }
    default:
      moments = arr(at(summary, "scoringPlays")).map((p, i) => {
        const n = num(at(p, "period", "number"));
        const period = n != null ? periodLabel(n, sport) : "";
        const clock = str(at(p, "clock", "displayValue")) ?? "";
        return {
          id: str(at(p, "id")) ?? `score-${i}`,
          kind: "score" as const,
          clock: [period, clock].filter(Boolean).join(" "),
          text: str(at(p, "text")) ?? str(at(p, "type", "text")) ?? "",
          side: side(str(at(p, "team", "id"))),
          minute: null,
          score: scoreAfter(p, topIsHome === true),
          period: n ?? null,
        };
      });
      recentPlays = arr(at(summary, "plays"))
        .slice(-4)
        .reverse()
        .flatMap((p) => str(at(p, "text")) ?? []);
  }

  let football: Football | null = null;
  let baseball: Baseball | null = null;
  const situation = arr(at(board, "events")).find((e) => str(at(e, "id")) === id);
  const s = at(situation, "competitions", 0, "situation");
  if (s != null && typeof s === "object") {
    if (sport === "football") football = footballFromBoard(s, topIsHome === true, side);
    if (sport === "baseball") {
      const b = baseballFromBoard(s);
      // The scoreboard only says a base is taken; the summary says by whom.
      baseball = b ? { ...b, runners: runners(at(summary, "situation"), athleteNames) } : null;
    }
    const last = str(at(s, "lastPlay", "text"));
    if (recentPlays.length === 0 && last) recentPlays = [last];
  }

  return {
    ...EMPTY_DETAIL,
    venue: str(at(summary, "gameInfo", "venue", "fullName")) ?? null,
    seasonIsCurrent: bool(at(summary, "header", "season", "current")) ?? null,
    broadcast: str(at(competition, "broadcasts", 0, "media", "shortName")) ?? null,
    broadcasters,
    topIsHome,
    stats: stats(summary, sport, topID, bottomID, path),
    linescore: sport !== "soccer" && topComp && bottomComp ? linescore(topComp, bottomComp, sport) : null,
    topWinProbability,
    drawProbability,
    moments,
    recentPlays,
    atBat,
    battedBalls: battedBallsList,
    basketball,
    plays,
    athleteNames,
    football,
    baseball,
  };
}

// MARK: Baseball

/** ESPN situations name each runner by `playerId` (the box score has the names). */
export function runners(s: JSONValue, names: Readonly<Record<string, string>>): readonly [string | null, string | null, string | null] {
  const name = (base: string) => {
    const pid = num(at(s, base, "playerId"));
    return pid != null ? (names[String(pid)] ?? null) : null;
  };
  return [name("onFirst"), name("onSecond"), name("onThird")];
}

/** Pitches of the at-bat in progress, or the last completed one between batters. */
export function currentAtBat(plays: readonly JSONValue[]): Pitch[] {
  const ends = plays.flatMap((p, i) => (str(at(p, "type", "type")) === "end-batterpitcher" ? [i] : []));
  let slice: readonly JSONValue[];
  const last = ends.at(-1);
  if (last != null && last === plays.length - 1) {
    const previous = ends.length > 1 ? ends.at(-2)! + 1 : 0;
    slice = plays.slice(previous, last);
  } else {
    slice = plays.slice(last != null ? last + 1 : 0);
  }
  // Pitch events only ("Pitch 3 : Ball"), not the result line that repeats the location.
  const pitches = slice.filter((p) => has(p, "pitchCoordinate") && at(p, "pitchCoordinate") != null && (str(at(p, "summaryType")) === "P" || (str(at(p, "text")) ?? "").startsWith("Pitch")));
  return pitches.flatMap((p, index): Pitch[] => {
    const x = num(at(p, "pitchCoordinate", "x"));
    const y = num(at(p, "pitchCoordinate", "y"));
    if (x == null || y == null) return [];
    const type = str(at(p, "type", "type")) ?? "";
    // A caught foul ("foul-out") is a ball in play, not a strike.
    const strike: StrikeKind | null = type.startsWith("foul-out")
      ? null
      : type.startsWith("foul")
        ? type.includes("tip")
          ? "foulTip"
          : "foul"
        : type.startsWith("strike-swinging") || type.includes("missed-bunt")
          ? "swinging"
          : type.startsWith("strike-looking")
            ? "called"
            : null;
    const result: PitchResult = strike != null || type.includes("strike") ? "strike" : type.includes("ball") || type.includes("hit-by-pitch") ? "ball" : "inPlay";
    const code = str(at(p, "pitchType", "abbreviation")) ?? null;
    return [
      {
        id: str(at(p, "id")) ?? String(index),
        number: index + 1,
        x,
        y,
        result,
        type: code,
        typeName: str(at(p, "pitchType", "text")) ?? (code ? (PITCH_NAMES[code] ?? null) : null),
        mph: intOf(at(p, "pitchVelocity")),
        strike,
      },
    ];
  });
}

const HITS: Readonly<Record<string, BattedOutcome>> = { single: "single", double: "extraBases", triple: "extraBases", "home-run": "homeRun" };
const OUTS = new Set([
  "ground-out",
  "fly-out",
  "line-out",
  "pop-out",
  "foul-out",
  "sacrifice",
  "bunt-ground-out",
  "batters-fielders-choice---runner-out",
  "batter-reached-on-error---batter-to-first",
]);

/**
 * Every ball in play. The ball in play is the pitch; the scoring play is the
 * at-bat's result entry. Keyed by the result's ID, a ball matches its scoring
 * play. The result also names the batting team: the pitch names the pitching one.
 */
export function battedBalls(plays: readonly JSONValue[], side: SideOf): BattedBall[] {
  const results = new Map<string, { id: string; team: string | null }>();
  for (const p of plays) {
    if (str(at(p, "type", "type")) !== "play-result") continue;
    const atBat = str(at(p, "atBatId"));
    const pid = str(at(p, "id"));
    if (atBat && pid) results.set(atBat, { id: pid, team: str(at(p, "team", "id")) ?? null });
  }
  return plays.flatMap((p, i): BattedBall[] => {
    const type = str(at(p, "type", "type")) ?? "";
    const outcome = HITS[type] ?? (OUTS.has(type) ? "out" : null);
    const x = num(at(p, "hitCoordinate", "x"));
    const y = num(at(p, "hitCoordinate", "y"));
    if (!outcome || x == null || y == null) return [];
    // Wait for the at-bat's result, so a ball keeps one ID (and its batting team) from the start.
    let id: string;
    let batting: string | null;
    const atBat = str(at(p, "atBatId"));
    if (atBat) {
      const result = results.get(atBat);
      if (!result) return [];
      ({ id, team: batting } = result);
    } else {
      id = str(at(p, "id")) ?? `ball-${i}`;
      batting = str(at(p, "team", "id")) ?? null;
    }
    return [{ id, x, y, outcome, side: side(batting), text: str(at(p, "type", "text")) ?? "", period: num(at(p, "period", "number")) ?? null }];
  });
}

/** The scoreboard's live baseball situation (ESPNDetail.baseball). */
export function baseballFromBoard(s: JSONValue): Baseball | null {
  if (!has(s, "outs") && !has(s, "balls")) return null;
  const pid = (role: string) => str(at(s, role, "athlete", "id")) ?? (num(at(s, role, "playerId")) != null ? String(num(at(s, role, "playerId"))) : null);
  return {
    balls: intOf(at(s, "balls")) ?? 0,
    strikes: intOf(at(s, "strikes")) ?? 0,
    outs: intOf(at(s, "outs")) ?? 0,
    onFirst: bool(at(s, "onFirst")) ?? false,
    onSecond: bool(at(s, "onSecond")) ?? false,
    onThird: bool(at(s, "onThird")) ?? false,
    batter: str(at(s, "batter", "athlete", "shortName")) ?? str(at(s, "batter", "athlete", "displayName")) ?? null,
    pitcher: str(at(s, "pitcher", "athlete", "shortName")) ?? str(at(s, "pitcher", "athlete", "displayName")) ?? null,
    lastPlay: str(at(s, "lastPlay", "text")) ?? null,
    runners: [null, null, null],
    batterID: pid("batter"),
    pitcherID: pid("pitcher"),
  };
}

// MARK: Pieces

const PREFERRED_STATS: Partial<Record<Sport, readonly [string, string][]>> = {
  soccer: [
    ["possessionPct", "Possession"],
    ["totalShots", "Shots"],
    ["shotsOnTarget", "Shots on Target"],
    ["wonCorners", "Corners"],
    ["saves", "Saves"],
    ["foulsCommitted", "Fouls"],
    ["yellowCards", "Yellow Cards"],
    ["redCards", "Red Cards"],
  ],
  football: [
    ["totalYards", "Total Yards"],
    ["netPassingYards", "Passing Yards"],
    ["rushingYards", "Rushing Yards"],
    ["firstDowns", "First Downs"],
    ["thirdDownEff", "Third-Down Conversions"],
    ["turnovers", "Turnovers"],
    ["totalPenaltiesYards", "Penalties–Yards"],
    ["possessionTime", "Time of Possession"],
  ],
  basketball: [
    ["fieldGoalPct", "Field Goal %"],
    ["threePointFieldGoalPct", "3-Point %"],
    ["freeThrowPct", "Free Throw %"],
    ["totalRebounds", "Rebounds"],
    ["assists", "Assists"],
    ["turnovers", "Turnovers"],
    ["steals", "Steals"],
    ["blocks", "Blocks"],
  ],
};

/** Team stats as split bars (ESPNDetail.stats). TODO(nba agent): the NBA's own list (`nbaStats`). */
export function stats(summary: JSONValue, sport: Sport, topID: string | null, bottomID: string | null, path = ""): Stat[] {
  const teams = arr(at(summary, "boxscore", "teams"));
  const top = teams.find((t) => str(at(t, "team", "id")) === topID);
  const bottom = teams.find((t) => str(at(t, "team", "id")) === bottomID);
  if (!top || !bottom) return [];
  const values = (team: JSONValue) => {
    const map = new Map<string, string>();
    for (const s of arr(at(team, "statistics"))) {
      const name = str(at(s, "name"));
      const value = str(at(s, "displayValue"));
      if (name && value != null) map.set(name, value);
    }
    return map;
  };
  const t = values(top);
  const b = values(bottom);
  // NBA (not WNBA): shooting, the hustle numbers and how the game was won (GameDetail.nbaStats).
  const nba = path === NBA_PATH_;
  const wanted =
    (nba ? NBA_STATS : null) ??
    PREFERRED_STATS[sport] ??
    arr(at(top, "statistics")).flatMap((s): [string, string][] => {
      const name = str(at(s, "name"));
      return name ? [[name, str(at(s, "label")) ?? name]] : [];
    });
  return wanted.slice(0, nba ? NBA_STATS.length : 8).flatMap(([key, label]): Stat[] => {
    const tv = t.get(key);
    const bv = b.get(key);
    if (tv == null || bv == null) return [];
    const tn = magnitude(tv);
    const bn = magnitude(bv);
    if (tn == null && bn == null) return [];
    const total = (tn ?? 0) + (bn ?? 0);
    // ESPN's NBA percentages are bare numbers ("45").
    const suffix = key === "possessionPct" || (nba && key.endsWith("Pct")) ? "%" : "";
    return [{ label, top: tv + suffix, bottom: bv + suffix, topShare: total > 0 ? Math.min(Math.max((tn ?? 0) / total, 0), 1) : 0.5 }];
  });
}

/**
 * Comparable number from display values like "8-12", "31:22", "45.5", "5-45".
 * Never negative: bars compare sizes, and "-2" rushing yards draws as none.
 */
export function magnitude(value: string): number | null {
  if (value.includes(":")) {
    const parts = value.split(":").map(Number);
    return parts.length === 2 && parts.every(Number.isFinite) ? parts[0]! * 60 + parts[1]! : null;
  }
  const n = Number(value);
  if (value.trim() !== "" && Number.isFinite(n)) return Math.max(n, 0);
  const first = Number(value.split("-")[0]);
  return value.split("-")[0] !== "" && Number.isFinite(first) ? Math.max(first, 0) : null;
}

export function linescore(top: JSONValue, bottom: JSONValue, sport: Sport): Linescore | null {
  const tl = arr(at(top, "linescores"));
  const bl = arr(at(bottom, "linescores"));
  const periods = Math.max(tl.length, bl.length);
  if (periods === 0) return null;
  const cell = (lines: readonly JSONValue[], i: number) => (i < lines.length ? (str(at(lines[i], "displayValue")) ?? "–") : "");
  const headers = Array.from({ length: periods }, (_, i) => periodLabel(i + 1, sport, "header"));
  const topRow = Array.from({ length: periods }, (_, i) => cell(tl, i));
  const bottomRow = Array.from({ length: periods }, (_, i) => cell(bl, i));
  headers.push(sport === "baseball" ? "R" : "T");
  topRow.push(str(at(top, "score")) ?? "");
  bottomRow.push(str(at(bottom, "score")) ?? "");
  if (sport === "baseball") {
    headers.push("H", "E");
    topRow.push(numText(at(top, "hits")), numText(at(top, "errors")));
    bottomRow.push(numText(at(bottom, "hits")), numText(at(bottom, "errors")));
  }
  return { headers, top: topRow, bottom: bottomRow };
}

/** "3–1": the score after a play, top first. */
export function scoreAfter(play: JSONValue, topIsHome: boolean): string | null {
  const away = intOf(at(play, "awayScore"));
  const home = intOf(at(play, "homeScore"));
  if (away == null || home == null) return null;
  return topIsHome ? `${home}–${away}` : `${away}–${home}`;
}

export function soccerMoment(e: JSONValue, side: SideOf): DetailMoment | null {
  const type = str(at(e, "type", "type")) ?? "";
  let kind: MomentKind;
  switch (type) {
    case "goal":
    case "penalty---scored":
    case "goal---header":
    case "goal---free-kick":
      kind = "goal";
      break;
    case "own-goal":
      kind = "ownGoal";
      break;
    case "yellow-card":
      kind = "yellow";
      break;
    case "red-card":
    case "yellow-red-card":
      kind = "red";
      break;
    default:
      // Any other scoring play ESPN tags (e.g. new goal subtypes) still counts.
      if (bool(at(e, "scoringPlay")) !== true) return null;
      kind = "goal";
  }
  const seconds = num(at(e, "clock", "value"));
  return {
    id: str(at(e, "id")) ?? `${type}-${seconds ?? 0}`,
    kind,
    clock: str(at(e, "clock", "displayValue")) ?? "",
    text: str(at(e, "shortText")) ?? str(at(e, "text")) ?? str(at(e, "type", "text")) ?? "",
    side: side(str(at(e, "team", "id"))),
    minute: seconds != null ? seconds / 60 : null,
    score: null,
    period: null,
  };
}

/** The scoreboard's live football situation (ESPNDetail.football). */
export function footballFromBoard(s: JSONValue, topIsHome: boolean, side: SideOf): Football | null {
  const yardLine = num(at(s, "yardLine"));
  if (yardLine == null) return null;
  const possession = side(str(at(s, "possession")));
  // `yardLine` counts from the home team's goal line ("PIT 1" with the Saints
  // at home is 99). The top team defends the left end zone and attacks right,
  // so x runs from the top team's goal line.
  const ballX = topIsHome ? yardLine : 100 - yardLine;
  const distance = num(at(s, "distance"));
  const lineToGain = distance == null ? null : possession === "bottom" ? Math.max(ballX - distance, 0) : Math.min(ballX + distance, 100);
  return {
    downDistance: str(at(s, "downDistanceText")) ?? str(at(s, "shortDownDistanceText")) ?? null,
    ballX,
    lineToGainX: possession == null ? null : lineToGain,
    possession,
    redZone: bool(at(s, "isRedZone")) ?? false,
    topTimeouts: intOf(at(s, topIsHome ? "homeTimeouts" : "awayTimeouts")),
    bottomTimeouts: intOf(at(s, topIsHome ? "awayTimeouts" : "homeTimeouts")),
    lastPlay: str(at(s, "lastPlay", "text")) ?? null,
  };
}

/** A whole number from a number or a numeric string (Swift's lenient `JSON.int`). */
export function intOf(value: JSONValue): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** A number or string as display text ("3"). */
function numText(value: JSONValue): string {
  return typeof value === "number" ? String(value) : (str(value) ?? "");
}

const NBA_PATH_ = "basketball/nba";

/** "MIL leads series 2-0" with an en dash (shared by the series caption). */
export const seriesText = (summary: string) => enDash(summary);
