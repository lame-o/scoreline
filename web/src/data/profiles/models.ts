/**
 * Team and player pages: what a link carries (a reference that's enough to
 * paint the hero before anything loads) and what the pages load. A port of
 * ProfileModels.swift; everything keeps its Swift name, under a `Profile`-free
 * namespace (this module is the namespace).
 *
 * Plain, immutable, serializable data, like the scores' models: dates are
 * epoch milliseconds and absent values are `null`.
 */
import { ordinal } from "../format";
import type { EventState, Sport } from "../models";

// MARK: - References

/**
 * A team as a link knows it. `id` uses the `Competitor.id` format
 * (`espn-basketball-13`, `espn-ncaaf-130`, `espn-soccer-359`, `cs-667`), so
 * follows and highlights match it directly.
 */
export interface TeamRef {
  readonly id: string;
  readonly name: string;
  readonly logo: string | null;
  /** `League.id` when known ("eng.1", "nfl"). Soccer pages need it for the roster; without it they ask ESPN for the team's league. */
  readonly league: string | null;
  readonly color: string | null;
  readonly alternateColor: string | null;
  readonly abbreviation: string | null;
}

export function teamRef(fields: Pick<TeamRef, "id" | "name"> & Partial<TeamRef>): TeamRef {
  return {
    id: fields.id,
    name: fields.name,
    logo: fields.logo ?? null,
    league: fields.league ?? null,
    color: fields.color ?? null,
    alternateColor: fields.alternateColor ?? null,
    abbreviation: fields.abbreviation ?? null,
  };
}

/** Where the team's data lives. */
export type TeamSource =
  /** `path` is the ESPN sport/league ("basketball/nba"); null for a soccer team whose domestic league isn't known yet. */
  | { readonly kind: "espn"; readonly sport: Sport; readonly path: string | null; readonly team: string }
  | { readonly kind: "counterStrike"; readonly id: number };

/** Soccer rosters exist per domestic league only (`soccer/all/…/roster` is a 400). */
export const DOMESTIC_SOCCER_LEAGUES: ReadonlySet<string> = new Set(["eng.1", "esp.1", "ita.1", "ger.1", "fra.1", "eng.2", "usa.1"]);

export function domesticSoccerPath(league: string | null | undefined): string | null {
  return league && DOMESTIC_SOCCER_LEAGUES.has(league) ? `soccer/${league}` : null;
}

export function teamSource(ref: Pick<TeamRef, "id" | "league">): TeamSource | null {
  const { id } = ref;
  if (id.startsWith("cs-")) {
    const n = Number(id.slice(3));
    return Number.isInteger(n) && n > 0 ? { kind: "counterStrike", id: n } : null;
  }
  if (!id.startsWith("espn-")) return null;
  const team = id.split("-").pop();
  if (!team) return null;
  if (id.startsWith("espn-ncaaf-")) return { kind: "espn", sport: "football", path: "football/college-football", team };
  if (id.startsWith("espn-football-")) return { kind: "espn", sport: "football", path: "football/nfl", team };
  if (id.startsWith("espn-baseball-")) return { kind: "espn", sport: "baseball", path: "baseball/mlb", team };
  // The WNBA stays untouched: its teams get no pages.
  if (id.startsWith("espn-basketball-")) return ref.league === "wnba" ? null : { kind: "espn", sport: "basketball", path: "basketball/nba", team };
  if (id.startsWith("espn-soccer-")) return { kind: "espn", sport: "soccer", path: domesticSoccerPath(ref.league), team };
  return null;
}

/** Whether a link should appear for this team at all. */
export function isSupportedTeam(ref: Pick<TeamRef, "id" | "league">): boolean {
  return teamSource(ref) != null;
}

export function teamSport(ref: Pick<TeamRef, "id" | "league">): Sport | null {
  const source = teamSource(ref);
  return source == null ? null : source.kind === "espn" ? source.sport : "esports";
}

/** The page's name in the page-session memory. */
export function teamMemoryKey(ref: Pick<TeamRef, "id">): string {
  return `team:${ref.id}`;
}

/** Where a person's data lives. */
export type PlayerSource =
  /** ESPN sport/league path: "basketball/nba", "football/college-football", "soccer/eng.1". */
  | { readonly kind: "espn"; readonly path: string }
  /** bo3.gg only accepts slugs ("zywoo"), never numeric IDs. */
  | { readonly kind: "counterStrike"; readonly slug: string }
  | { readonly kind: "ifsc" };

/** A person as a link knows them: a player, a CS2 player or a climber. */
export interface PlayerRef {
  readonly source: PlayerSource;
  /** ESPN athlete ID, bo3 player ID, IFSC athlete ID. */
  readonly id: string;
  readonly name: string;
  readonly photo: string | null;
  /** The current team, for the wash and the hero's team link. */
  readonly team: TeamRef | null;
  readonly jersey: string | null;
  readonly position: string | null;
  /** IOC (climbing) or ISO 3166 alpha-2 (CS2) country code. */
  readonly country: string | null;
}

export function playerRef(fields: Pick<PlayerRef, "source" | "id" | "name"> & Partial<PlayerRef>): PlayerRef {
  return {
    source: fields.source,
    id: fields.id,
    name: fields.name,
    photo: fields.photo ?? null,
    team: fields.team ?? null,
    jersey: fields.jersey ?? null,
    position: fields.position ?? null,
    country: fields.country ?? null,
  };
}

export function playerKey(ref: Pick<PlayerRef, "source" | "id">): string {
  switch (ref.source.kind) {
    case "espn":
      return `espn:${ref.source.path}:${ref.id}`;
    case "counterStrike":
      return `bo3:${ref.source.slug}`;
    case "ifsc":
      return `ifsc:${ref.id}`;
  }
}

export function playerMemoryKey(ref: Pick<PlayerRef, "source" | "id">): string {
  return `player:${playerKey(ref)}`;
}

/** The league slug for a player's ESPN path ("basketball/nba" → "nba"). */
export function leagueForPath(path: string): string | null {
  switch (path) {
    case "basketball/nba":
      return "nba";
    case "football/nfl":
      return "nfl";
    case "football/college-football":
      return "college-football";
    case "baseball/mlb":
      return "mlb";
    default:
      return path.startsWith("soccer/") ? path.slice(7) : null;
  }
}

export function sportOfPath(path: string): Sport {
  return path.startsWith("basketball") ? "basketball" : path.startsWith("football") ? "football" : path.startsWith("baseball") ? "baseball" : "soccer";
}

export function playerSport(ref: Pick<PlayerRef, "source">): Sport {
  switch (ref.source.kind) {
    case "espn":
      return sportOfPath(ref.source.path);
    case "counterStrike":
      return "esports";
    case "ifsc":
      return "climbing";
  }
}

export function isCollege(ref: Pick<PlayerRef, "source">): boolean {
  return ref.source.kind === "espn" && ref.source.path.endsWith("college-football");
}

// MARK: - Team data

export interface TeamHeader {
  readonly name: string;
  readonly shortName: string;
  readonly abbreviation: string | null;
  readonly logo: string | null;
  readonly color: string | null;
  readonly alternateColor: string | null;
  /** "5-1"; soccer "7-0-1" (wins–draws–losses). */
  readonly record: string | null;
  /** "1st in AFC West". Null when the source's is unreliable (MLB after the regular season). */
  readonly standing: string | null;
  /** "Andy Reid". Null for soccer, whose source lists past managers. */
  readonly coach: string | null;
  readonly venue: string | null;
  readonly city: string | null;
  /** CS2 world rank and its change. */
  readonly rank: number | null;
  readonly rankChange: number | null;
  /** Soccer: the domestic league ESPN files the team under ("eng.1"). */
  readonly leagueSlug: string | null;
  readonly link: string | null;
  readonly next: GameRef | null;
}

/** A game as the team and player pages show it: date, opponent, result. */
export interface GameRef {
  readonly id: string;
  readonly date: number;
  readonly opponent: TeamRef | null;
  readonly home: boolean;
  readonly network: string | null;
  readonly state: EventState;
  readonly teamScore: string | null;
  readonly opponentScore: string | null;
  /** "W", "L", "D" once final. */
  readonly result: string | null;
  readonly competition: string | null;
  /** CS2: the match slug (bo3.gg's match pages are addressed by it). */
  readonly slug: string | null;
}

export interface RosterPlayer {
  readonly ref: PlayerRef;
  readonly jersey: string | null;
  /** "G", "QB", "SP", "D". */
  readonly position: string | null;
  readonly positionName: string | null;
  readonly age: number | null;
  readonly birthDate: number | null;
  readonly height: string | null;
  readonly weight: string | null;
  /** College class ("Sophomore"), hometown or nationality, by sport. */
  readonly detail: string | null;
  readonly college: string | null;
  /** "Out", "Questionable", "Injured Reserve", "Day-To-Day". */
  readonly injury: string | null;
  /** When they're expected back ("late Nov"), when the source says (FotMob, soccer). */
  readonly injuryReturn: string | null;
  /** Column key → display value (team leaders, or soccer's inline stats). */
  readonly stats: Readonly<Record<string, string>>;
  /** The source's group ("offense", "Pitchers"); grouping is decided later. */
  readonly sourceGroup: string | null;
  /** CS2: the coach and benched players. */
  readonly isCoach: boolean;
  readonly benched: boolean;
}

export type RosterGroupKind =
  | "starters" | "bench" | "out"
  | "offense" | "defense" | "specialTeams" | "injuredReserve" | "practiceSquad"
  | "rotation" | "bullpen" | "catchers" | "infielders" | "outfielders" | "designatedHitters"
  | "goalkeepers" | "defenders" | "midfielders" | "forwards"
  | "players" | "coach" | "benched";

export interface RosterGroup {
  readonly kind: RosterGroupKind;
  readonly players: readonly RosterPlayer[];
}

export const ROSTER_GROUP_TITLE: Readonly<Record<RosterGroupKind, string>> = {
  starters: "Starting Five",
  bench: "Bench",
  out: "Out",
  offense: "Offense",
  defense: "Defense",
  specialTeams: "Special Teams",
  injuredReserve: "Injured Reserve",
  practiceSquad: "Practice Squad",
  rotation: "Rotation",
  bullpen: "Bullpen",
  catchers: "Catchers",
  infielders: "Infielders",
  outfielders: "Outfielders",
  designatedHitters: "Designated Hitters",
  goalkeepers: "Goalkeepers",
  defenders: "Defenders",
  midfielders: "Midfielders",
  forwards: "Forwards",
  players: "Active",
  coach: "Coach",
  benched: "Benched",
};

export function collapsedByDefault(kind: RosterGroupKind): boolean {
  return kind === "practiceSquad" || kind === "benched";
}

/** NFL: three units, each a list of slots in depth order. */
export interface DepthChart {
  readonly units: readonly DepthUnit[];
}

export type DepthUnitKind = "offense" | "defense" | "specialTeams";
export const DEPTH_UNIT_ORDER: Readonly<Record<DepthUnitKind, number>> = { offense: 0, defense: 1, specialTeams: 2 };

export interface DepthUnit {
  readonly kind: DepthUnitKind;
  /** The formation ("3WR 1TE", "Base 4-3 D"). */
  readonly name: string;
  readonly slots: readonly DepthSlot[];
}

export interface DepthSlot {
  readonly key: string;
  /** "QB", "LT", "WR". */
  readonly label: string;
  readonly players: readonly { readonly id: string; readonly name: string }[];
}

export interface TeamLeader {
  readonly category: string;
  /** "PTS", "PASS YDS". */
  readonly label: string;
  readonly value: string;
  readonly player: PlayerRef;
}

export interface TeamStat {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly rank: number | null;
  /** "1st", "T-3rd". */
  readonly rankText: string | null;
}

export interface Transaction {
  readonly date: number | null;
  readonly text: string;
}

export interface Title {
  readonly name: string;
  readonly date: number | null;
}

/** Category → (athlete ID, display value), ranked: core team or league leaders. */
export type Leaders = Readonly<Record<string, readonly { readonly id: string; readonly value: string }[]>>;

// MARK: - Player data

export interface Bio {
  readonly name: string;
  readonly jersey: string | null;
  readonly position: string | null;
  readonly positionAbbreviation: string | null;
  readonly team: TeamRef | null;
  readonly photo: string | null;
  readonly active: boolean;
  readonly age: number | null;
  readonly birthDate: number | null;
  readonly birthPlace: string | null;
  readonly height: string | null;
  readonly weight: string | null;
  readonly college: string | null;
  /** "2003 · Round 1, Pick 1 · CLE". */
  readonly draft: string | null;
  /** "24th Season". */
  readonly experience: string | null;
  readonly batsThrows: string | null;
  readonly debutYear: number | null;
  readonly nationality: string | null;
  /** College: "Sophomore". */
  readonly classYear: string | null;
  readonly hometown: string | null;
  /** CS2: real name under the nickname. */
  readonly realName: string | null;
  /** CS2: when they joined the team. */
  readonly since: number | null;
  /** Climbing: federation. */
  readonly federation: string | null;
  readonly prizeMoney: number | null;
  readonly armSpan: number | null;
  readonly country: string | null;
  readonly link: string | null;
}

export function emptyBio(name: string): Bio {
  return {
    name,
    jersey: null,
    position: null,
    positionAbbreviation: null,
    team: null,
    photo: null,
    active: true,
    age: null,
    birthDate: null,
    birthPlace: null,
    height: null,
    weight: null,
    college: null,
    draft: null,
    experience: null,
    batsThrows: null,
    debutYear: null,
    nationality: null,
    classYear: null,
    hometown: null,
    realName: null,
    since: null,
    federation: null,
    prizeMoney: null,
    armSpan: null,
    country: null,
    link: null,
  };
}

export interface StatTile {
  readonly label: string;
  readonly value: string;
  /** Shown only when meaningful (≤ 25th), or a caption ("Career", "won"). */
  readonly rank: string | null;
}

export interface InjuryNote {
  readonly status: string;
  readonly detail: string | null;
  readonly returnDate: number | null;
}

/** RotoWire's status note (US sports). */
export interface Note {
  readonly headline: string;
  readonly story: string | null;
  readonly published: number | null;
}

/** A small table: the season, career or per-competition lines. */
export interface StatTable {
  readonly columns: readonly string[];
  /** The source's stat names, parallel to `columns` ("avgPoints"). */
  readonly keys: readonly string[];
  readonly rows: readonly { readonly title: string; readonly values: readonly string[] }[];
}

/** Indices of the preferred keys that exist, in that order. */
export function tableIndices(table: StatTable, preferred: readonly string[]): number[] {
  return preferred.flatMap((k) => {
    const i = table.keys.indexOf(k);
    return i >= 0 ? [i] : [];
  });
}

export interface GameLogColumn {
  readonly key: string;
  readonly label: string;
}

export interface GameLogEntry {
  readonly eventID: string;
  readonly date: number;
  readonly opponent: TeamRef | null;
  readonly home: boolean;
  /** "W", "L", "D". */
  readonly result: string | null;
  readonly teamScore: string | null;
  readonly opponentScore: string | null;
  readonly stats: Readonly<Record<string, string>>;
  readonly postseason: boolean;
  readonly competition: string | null;
  readonly played: boolean;
}

/** A stat as a number ("1,474" → 1474), or null. */
export function entryValue(e: GameLogEntry, key: string): number | null {
  const raw = e.stats[key];
  if (raw == null) return null;
  const v = Number(raw.replaceAll(",", ""));
  return raw.trim() === "" || Number.isNaN(v) ? null : v;
}

export interface GameLog {
  readonly columns: readonly GameLogColumn[];
  /** Date order, preseason excluded. */
  readonly entries: readonly GameLogEntry[];
  /** The stat the strip draws ("points", "passingYards"). */
  readonly stripKey: string | null;
  readonly stripLabel: string;
  /** MLB: the stat drawn as a ring on top of a bar (home runs). */
  readonly markKey: string | null;
  /** A fixed reference instead of the mean (Game Score: 50). */
  readonly reference: number | null;
  readonly referenceLabel: string | null;
  /** Soccer: a result strip instead of bars. */
  readonly matchStrip: boolean;
  readonly season: string | null;
  /**
   * MLB: "batting" or "pitching". ESPN offers both to every player; a log
   * asked for without one is in the player's role (pitching for a pitcher).
   */
  readonly category: string | null;
}

/**
 * Any game with something in it. A hitter's pitching log is empty, but a
 * pitcher's batting log lists every appearance, all zeros.
 */
export function hasPlay(log: GameLog): boolean {
  return log.entries.some((e) => Object.values(e.stats).some((v) => swiftDouble(v) > 0));
}

/** Swift's `Double(string) ?? 0`: plain decimals only (".000" is 0; "1-0" and "-" aren't numbers). */
function swiftDouble(s: string): number {
  return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s) ? Number(s) : 0;
}

export interface MapStat {
  readonly name: string;
  readonly maps: number;
  readonly rating: number;
  readonly adr: number;
}

export interface Podium {
  readonly discipline: string;
  readonly gold: number;
  readonly silver: number;
  readonly bronze: number;
}

export const podiumTotal = (p: Podium) => p.gold + p.silver + p.bronze;

export interface ClimbResult {
  readonly season: string;
  readonly rank: number | null;
  readonly discipline: string;
  readonly event: string;
  readonly date: number | null;
  readonly category: string | null;
}

export interface PlayerProfile {
  readonly bio: Bio | null;
  readonly tiles: readonly StatTile[];
  readonly tilesCaption: string | null;
  readonly injury: InjuryNote | null;
  readonly note: Note | null;
  readonly season: StatTable | null;
  /** Soccer: one row per competition. */
  readonly competitions: StatTable | null;
  readonly gameLog: GameLog | null;
  readonly awards: readonly string[];
  // CS2
  readonly mapPool: readonly MapStat[];
  readonly roles: readonly string[];
  readonly titles: readonly Title[];
  // Climbing
  readonly podiums: readonly Podium[];
  readonly worldChampionships: readonly Podium[];
  readonly results: readonly ClimbResult[];
  readonly resultCount: number;
  readonly speedBest: string | null;
}

export const EMPTY_PROFILE: PlayerProfile = {
  bio: null,
  tiles: [],
  tilesCaption: null,
  injury: null,
  note: null,
  season: null,
  competitions: null,
  gameLog: null,
  awards: [],
  mapPool: [],
  roles: [],
  titles: [],
  podiums: [],
  worldChampionships: [],
  results: [],
  resultCount: 0,
  speedBest: null,
};

// MARK: - Display helpers

/** "Tied-13th" → "T-13th"; null past 25th (a rank that far down isn't context). */
export function profileRank(text: string | null | undefined, limit = 25): { rank: number; text: string } | null {
  if (!text) return null;
  const digits = text.replace(/\D/g, "");
  const n = digits ? Number(digits) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > limit) return null;
  return { rank: n, text: text.replace("Tied-", "T-") };
}

const SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "v"]);

/**
 * Initials for a monogram: first and last word ("LJ"); one-word names and
 * nicknames give one letter. Suffixes (Jr., III) don't count.
 */
export function initials(name: string): string {
  const words = name.split(" ").filter((w) => w.length > 0 && !SUFFIXES.has(w.toLowerCase()));
  const first = words[0]?.[0];
  if (!first) return "";
  const last = words.length > 1 ? words[words.length - 1]?.[0] : undefined;
  return (last ? first + last : first).toUpperCase();
}

/** "GARNBRET" → "Garnbret"; "TRI RAMADANI" → "Tri Ramadani". */
export function properCase(s: string): string {
  return s
    .split(" ")
    .filter((w) => w.length > 0)
    .map((word) =>
      word
        .split("-")
        .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
        .join("-"),
    )
    .join(" ");
}

/** "Kenneth Walker III" → "Walker III"; "Patrick Mahomes" → "Mahomes". */
export function lastName(name: string): string {
  const words = name.split(" ").filter(Boolean);
  if (words.length <= 1) return name;
  const last = words[words.length - 1]!;
  if (["Jr.", "Sr.", "II", "III", "IV"].includes(last) && words.length > 2) return words.slice(-2).join(" ");
  return words.slice(1).join(" ");
}

/** Swift `Ordinal.string`. */
export const ordinalString = ordinal;
