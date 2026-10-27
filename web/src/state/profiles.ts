/**
 * Team and player pages' data (ProfileStore.swift, ProfileCache.swift), on
 * TanStack Query: one query per upstream URL, keyed by the URL, so a hover's
 * prefetch, a page and Back all share one copy, each part of a page fills in
 * as it lands, and each fails on its own (the page shows the rest plus a
 * footnote). Responses stay fresh for the Mac's TTLs; the Worker's edge and
 * the browser's HTTP cache sit under that (shared/upstreams.ts).
 *
 *     const team = useTeamProfile(ref);      // header, groups, leaders, stats…
 *     const player = usePlayerProfile(ref);  // bio, tiles, game log, career…
 *     prefetchPlayer(ref);                   // a name link's dwell
 *
 * Also here: the page session (depth chart, All Games, Batting/Pitching,
 * expansions) that survives Back, and the hero photos already decoded.
 */
import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { HTTPError } from "../data/http";
import { clientRequest } from "../../shared/upstreams";
import * as bo3 from "../data/profiles/bo3";
import * as espn from "../data/profiles/espn";
import * as fotmob from "../data/profiles/fotmob";
import * as ifsc from "../data/profiles/ifsc";
import {
  domesticSoccerPath,
  emptyBio,
  EMPTY_PROFILE,
  hasPlay,
  isCollege,
  playerSport,
  teamRef,
  teamSource,
  teamSport,
  type Bio,
  type DepthChart,
  type GameLog,
  type GameRef,
  type PlayerProfile,
  type PlayerRef,
  type RosterGroup,
  type StatTile,
  type TeamHeader,
  type TeamLeader,
  type TeamRef,
  type TeamStat,
  type Title,
  type Transaction,
} from "../data/profiles/models";
import { espnPhoto, fotMobPhoto, heroPhotoURL } from "../data/profiles/photos";
import { formMarks, parseStandings, parseTeamResults, standingsPath, standingsURL, standingsWindow, teamScheduleURL, type FormMark, type StandingsRow } from "../data/profiles/results";
import type { Sport } from "../data/models";
import { preloadPhoto } from "./profilePhotos";
import { hasFailed, isAnswer, retrying } from "./retry";
import { queryClient } from "./scores";

/** How long each kind of response stays fresh (ProfileStore.swift `TTL`). */
export const TTL = {
  header: 30 * 60_000,
  roster: 6 * 3_600_000,
  leaders: 3_600_000,
  athlete: 3_600_000,
  career: 24 * 3_600_000,
  leagueLeaders: 6 * 3_600_000,
  forever: 30 * 24 * 3_600_000,
  short: 10 * 60_000,
  matches: 15 * 60_000,
  climber: 6 * 3_600_000,
  squad: 12 * 3_600_000,
} as const;

const profileKey = (url: string | null) => ["profile", url ?? ""] as const;

/**
 * Profiles always read the real feeds, even under the `?demo` harness (whose
 * stand-in fetcher only knows scoreboards): a team page in a demo shows its
 * real roster beside the demo's live strip.
 */
async function profileFetch(url: string, signal: AbortSignal): Promise<unknown> {
  const { href, cache } = clientRequest(url);
  const response = await fetch(href, { signal, cache, headers: { Accept: "application/json" } });
  if (!response.ok) throw new HTTPError(response.status, url);
  return response.json() as Promise<unknown>;
}

/**
 * One page's queries, each slot with a key of its own: a slot with no URL
 * (another sport's) is disabled, and disabled slots sharing one key made
 * TanStack's useQueries see duplicates ("might result in unexpected behavior").
 */
function distinctSlots<Q extends { queryKey: readonly unknown[]; enabled: boolean }>(queries: Q[]): Q[] {
  return queries.map((q, i) => (q.enabled ? q : { ...q, queryKey: ["profile", `off:${i}`] as const }));
}

function profileQuery(url: string | null, ttl: number) {
  return {
    queryKey: profileKey(url) as readonly unknown[],
    queryFn: ({ signal }: { signal: AbortSignal }) => profileFetch(url!, signal),
    enabled: url != null,
    staleTime: ttl,
    gcTime: Math.max(ttl, 30 * 60_000),
    // A profile loads once per visit (the Mac's rule). A failure shows at once (the page, or a part's
    // footnote) and is asked again on the retry ladder while the page is open (state/retry.ts).
    // A 404 is an answer (nobody by that ID), never asked again.
    ...retrying(),
    refetchOnWindowFocus: false,
  };
}

/** Parsed once per response (raw responses can be large: a season's batting log is a megabyte). */
function useParsed<T>(query: UseQueryResult<unknown>, parse: (json: unknown) => T, deps: readonly unknown[] = []): T | null {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (query.data === undefined ? null : parse(query.data)), [query.data, ...deps]);
}

/** Answered, or failed (its retries go on behind the page, which shows what failed meanwhile). */
const settled = (q: UseQueryResult<unknown>) => !q.isLoading || hasFailed(q);

// Stable empties, so a missing part never looks like a change.
const NO_LEADERS: Readonly<Record<string, readonly { id: string; value: string }[]>> = {};
const NONE: readonly never[] = [];

// MARK: - Teams

export type TeamPart = "header" | "roster" | "leaders" | "stats";

export interface TeamProfile {
  readonly sport: Sport | null;
  /** The ESPN path the roster side reads (soccer: the domestic league, once known). */
  readonly path: string | null;
  readonly header: TeamHeader | null;
  /** The team as its players' links carry it: the link's reference with the header's name, crest and colors. */
  readonly team: TeamRef;
  readonly groups: readonly RosterGroup[];
  readonly depthChart: DepthChart | null;
  readonly leaders: readonly TeamLeader[];
  readonly stats: readonly TeamStat[];
  readonly transactions: readonly Transaction[];
  readonly titles: readonly Title[];
  readonly career: readonly StatTile[];
  readonly next: GameRef | null;
  /** This season's results, newest first (null until they land). */
  readonly results: readonly GameRef[] | null;
  readonly form: readonly FormMark[];
  readonly standings: { readonly rows: readonly StandingsRow[]; readonly first: number } | null;
  /** The roster has had its first answer (whatever it was). */
  readonly rosterLoaded: boolean;
  /** Every first request has answered. */
  readonly loaded: boolean;
  readonly failed: ReadonlySet<TeamPart>;
  /** A first request is out (the error state's "Retrying…"). */
  readonly fetching: boolean;
  readonly reload: () => void;
}

export function useTeamProfile(ref: TeamRef): TeamProfile {
  const source = teamSource(ref);
  const sport = teamSport(ref);
  const e = source?.kind === "espn" ? source : null;
  const cs = source?.kind === "counterStrike" ? source : null;

  // ESPN: the header first (a soccer team's league comes with it), the roster side beside it.
  const headerQ = useQuery(profileQuery(e ? espn.teamURL(e.path, e.team) : null, TTL.header));
  const espnHeader = useParsed(headerQ, (json) => (e ? espn.parseHeader(json, e.sport, e.path, e.team) : null), [e?.team]);
  const path = e ? (e.path ?? domesticSoccerPath(espnHeader?.leagueSlug)) : null;

  // CS2: bo3.gg addresses teams by slug; the link knows the ID.
  const lookupQ = useQuery(profileQuery(cs ? bo3.teamLookupURL(cs.id) : null, TTL.forever));
  const slug = useParsed(lookupQ, bo3.parseSlug);

  const urls = {
    roster: e && path ? espn.rosterURL(path, e.team) : null,
    depth: e && path ? espn.depthURL(path, e.team) : null,
    leaders: e && path ? espn.leadersURL(path, e.team) : null,
    stats: e && path ? espn.teamStatsURL(path, e.team) : null,
    transactions: e && path ? espn.transactionsURL(path, e.team) : null,
    schedule: e ? teamScheduleURL(e.sport, path ?? "soccer/all", e.team) : cs ? bo3.historyURL(cs.id) : null,
    standings: e ? (() => {
      const table = standingsPath(e.sport, ref.id, path);
      return table ? standingsURL(table) : null;
    })() : null,
    csTeam: slug ? bo3.teamURL(slug) : null,
    csCareer: slug ? bo3.teamStatsURL(slug) : null,
    csNext: cs ? bo3.upcomingURL(cs.id) : null,
  };
  const [rosterQ, depthQ, leadersQ, statsQ, transactionsQ, scheduleQ, standingsQ, csTeamQ, csCareerQ, csNextQ] = useQueries({
    queries: distinctSlots([
      profileQuery(urls.roster, TTL.roster),
      profileQuery(urls.depth, TTL.roster),
      profileQuery(urls.leaders, TTL.leaders),
      profileQuery(urls.stats, TTL.leaders),
      profileQuery(urls.transactions, TTL.leaders),
      profileQuery(urls.schedule, cs ? 30 * 60_000 : TTL.header),
      profileQuery(urls.standings, 10 * 60_000),
      profileQuery(urls.csTeam, TTL.leaders),
      profileQuery(urls.csCareer, TTL.roster),
      profileQuery(urls.csNext, TTL.short),
    ]),
  }) as UseQueryResult<unknown>[];

  const csTeam = useParsed(csTeamQ!, (json) => bo3.parseTeam(json, ref), [ref.id]);
  const header = espnHeader ?? csTeam?.header ?? null;

  // The team as its players' links carry it, so a player page paints its wash at once.
  const team = useMemo<TeamRef>(
    () => ({
      ...ref,
      name: header?.shortName ?? ref.name,
      logo: header?.logo ?? ref.logo,
      color: header?.color ?? ref.color,
      alternateColor: header?.alternateColor ?? ref.alternateColor,
      abbreviation: header?.abbreviation ?? ref.abbreviation,
      league: ref.league ?? (path ? espn.leagueForPath(path) : null),
    }),
    [ref, header, path],
  );

  const roster = useParsed(rosterQ!, (json) => (e && path ? espn.parseRoster(json, e.sport, path, team) : null), [path, team]);
  const depth = useParsed(depthQ!, (json) => {
    if (path === "football/nfl") {
      const chart = espn.parseDepthChart(json);
      // The chart also orders the roster within each position (starters first).
      const order: Record<string, string[]> = {};
      for (const slot of chart?.units.flatMap((u) => u.slots) ?? []) if (!(slot.key in order)) order[slot.key] = slot.players.map((p) => p.id);
      return { chart, order };
    }
    return { chart: null, order: espn.parseCoreDepth(json) };
  }, [path]);
  const leaderValues = useParsed(leadersQ!, espn.parseLeaders) ?? NO_LEADERS;

  // Soccer: FotMob's photos, injuries and coach, after the page has ESPN's (never blocks it).
  const fotMobName = e?.sport === "soccer" && headerQ.isSuccess ? (espnHeader?.name ?? ref.name) : null;
  const squad = useFotMobSquad(fotMobName, espnHeader?.leagueSlug ?? ref.league);

  const players = useMemo(() => {
    const list = roster?.players ?? csTeam?.players ?? NONE;
    return squad ? fotmob.applySquad(list, squad) : list;
  }, [roster, csTeam, squad]);

  const groups = useMemo<readonly RosterGroup[]>(() => {
    if (csTeam) {
      const active = csTeam.players.filter((p) => !p.isCoach && !p.benched);
      return [
        { kind: "players" as const, players: active },
        { kind: "coach" as const, players: csTeam.players.filter((p) => p.isCoach) },
        { kind: "benched" as const, players: csTeam.players.filter((p) => p.benched && !p.isCoach) },
      ].filter((g) => g.players.length > 0);
    }
    if (!sport || players.length === 0) return NONE;
    return espn.groupRoster(sport, players, leaderValues, depth?.order ?? {});
  }, [csTeam, sport, players, leaderValues, depth]);

  const leaders = useMemo(() => (sport && !csTeam ? espn.teamLeaders(sport, leaderValues, players) : NONE), [sport, csTeam, leaderValues, players]);
  const stats = useParsed(statsQ!, (json) => (sport ? espn.parseTeamStats(json, sport) : NONE), [sport]) ?? NONE;
  const transactions = useParsed(transactionsQ!, espn.parseTransactions) ?? NONE;
  const career = useParsed(csCareerQ!, bo3.parseTeamCareer) ?? NONE;
  const csNext = useParsed(csNextQ!, (json) => (cs ? bo3.parseNextMatch(json, cs.id) : null), [cs?.id]);

  const results = useParsed(scheduleQ!, (json) => {
    if (cs) return bo3.parseHistory(json, cs.id);
    return e ? parseTeamResults(json, e.sport, path ?? "soccer/all", e.team) : [];
  }, [path]);
  const standings = useParsed(standingsQ!, (json) => {
    const table = e ? standingsPath(e.sport, ref.id, path) : null;
    if (!e || !table) return null;
    const window = standingsWindow(parseStandings(json, table, e.sport), ref.id, { bySeed: e.sport === "basketball" });
    return window.rows.length > 0 ? window : null;
  }, [path, ref.id]);

  const headerWithCoach = useMemo<TeamHeader | null>(() => {
    if (!header) return null;
    const coach = header.coach ?? roster?.coach ?? squad?.coach ?? null;
    return coach === header.coach ? header : { ...header, coach };
  }, [header, roster, squad]);

  const failed = useMemo(() => {
    const out = new Set<TeamPart>();
    // Failed with nothing to show: a refresh failing under data the page shows isn't a failed part.
    if (hasFailed(headerQ) || hasFailed(csTeamQ!) || hasFailed(lookupQ) || (lookupQ.isSuccess && slug == null) || (source == null)) out.add("header");
    if (hasFailed(rosterQ!) || (rosterQ!.isSuccess && (roster?.players.length ?? 0) === 0)) out.add("roster");
    // A soccer team whose league isn't one with rosters.
    if (e && e.path == null && headerQ.isSuccess && path == null) out.add("roster");
    if (hasFailed(leadersQ!)) out.add("leaders");
    if (hasFailed(statsQ!)) out.add("stats");
    return out;
  }, [headerQ, csTeamQ, lookupQ, slug, source, rosterQ, roster, e, path, leadersQ, statsQ]);

  const form = useMemo(() => formMarks(results ?? NONE), [results]);
  const primary = [headerQ, lookupQ, rosterQ!, csTeamQ!, leadersQ!, statsQ!];
  const loaded = primary.every(settled) && !(e && e.path == null && !headerQ.isFetched && !hasFailed(headerQ));
  const reload = useCallback(() => {
    void queryClient.refetchQueries({ predicate: (q) => q.queryKey[0] === "profile" && Object.values(urls).includes(String(q.queryKey[1])) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(urls)]);

  return {
    sport,
    path,
    header: headerWithCoach,
    team,
    groups,
    depthChart: depth?.chart ?? null,
    leaders,
    stats,
    transactions,
    titles: csTeam?.titles ?? NONE,
    career,
    next: csNext ?? header?.next ?? null,
    results,
    form,
    standings,
    rosterLoaded: settled(rosterQ!) && settled(csTeamQ!) && (e == null || path != null || headerQ.isFetched),
    loaded,
    failed,
    fetching: primary.some((q) => q.isFetching),
    reload,
  };
}

/** A soccer team's FotMob squad: search (30 days) then the team page (12 hours). Null on any failure. */
function useFotMobSquad(name: string | null, league: string | null): fotmob.FotMobSquad | null {
  const searchQ = useQuery(profileQuery(name ? fotmob.searchURL(name) : null, TTL.forever));
  const id = useParsed(searchQ, (json) => (name ? fotmob.parseTeamID(json, name, league) : null), [name, league]);
  const teamQ = useQuery(profileQuery(id != null ? fotmob.fotMobTeamURL(id) : null, TTL.squad));
  return useParsed(teamQ, fotmob.parseSquad);
}

// MARK: - Players

export type PlayerPart = "bio" | "season" | "gameLog";

export interface PlayerView {
  readonly sport: Sport;
  /** The bio, or what the link knew while it loads. */
  readonly bio: Bio;
  readonly profile: PlayerProfile;
  /** MLB: the log in the player's other role, only when they've played it this season (two-way players). */
  readonly otherLog: GameLog | null;
  readonly career: { readonly table: PlayerProfile["season"]; readonly loading: boolean; readonly failed: boolean };
  readonly loaded: boolean;
  readonly failed: ReadonlySet<PlayerPart>;
  /** A first request is out (the error state's "Retrying…"). */
  readonly fetching: boolean;
  readonly reload: () => void;
}

/** The bio while it loads: what the link knew. */
export function linkBio(ref: PlayerRef): Bio {
  return { ...emptyBio(ref.name), photo: ref.photo, team: ref.team, jersey: ref.jersey, positionAbbreviation: ref.position, country: ref.country };
}

/** The first request a player page makes, by source (prefetch warms it). */
function firstPlayerURL(ref: PlayerRef): string {
  switch (ref.source.kind) {
    case "espn":
      // College's v3 athlete embeds every conference's standings (428 KB): the core athlete covers the bio.
      return isCollege(ref) ? espn.coreAthleteURL(ref.source.path, ref.id) : espn.athleteURL(ref.source.path, ref.id);
    case "counterStrike":
      return bo3.playerURL(ref.source.slug);
    case "ifsc":
      return ifsc.athleteURL(ref.id);
  }
}

export function usePlayerProfile(ref: PlayerRef, options: { careerRequested: boolean }): PlayerView {
  const sport = playerSport(ref);
  const espnPath = ref.source.kind === "espn" ? ref.source.path : null;
  const slug = ref.source.kind === "counterStrike" ? ref.source.slug : null;
  const college = isCollege(ref);

  const [athleteQ, coreQ, overviewQ, gameLogQ, leagueLeadersQ, csPlayerQ, csGeneralQ, csAccuracyQ, csMatchesQ, csMapsQ, csRolesQ, climberQ] = useQueries({
    queries: distinctSlots([
      profileQuery(espnPath && !college ? espn.athleteURL(espnPath, ref.id) : null, TTL.athlete),
      profileQuery(espnPath ? espn.coreAthleteURL(espnPath, ref.id) : null, TTL.career),
      profileQuery(espnPath ? espn.overviewURL(espnPath, ref.id) : null, TTL.athlete),
      profileQuery(espnPath ? espn.gamelogURL(espnPath, ref.id) : null, TTL.athlete),
      profileQuery(espnPath && (espnPath === "basketball/nba" || espnPath.startsWith("soccer/")) ? espn.leagueLeadersURL(espnPath) : null, TTL.leagueLeaders),
      profileQuery(slug ? bo3.playerURL(slug) : null, TTL.leaders),
      profileQuery(slug ? bo3.generalURL(slug) : null, TTL.roster),
      profileQuery(slug ? bo3.accuracyURL(slug) : null, TTL.roster),
      profileQuery(slug ? bo3.matchesURL(slug) : null, TTL.matches),
      profileQuery(slug ? bo3.mapsURL(slug) : null, TTL.roster),
      profileQuery(slug ? bo3.rolesURL(slug) : null, TTL.roster),
      profileQuery(ref.source.kind === "ifsc" ? ifsc.athleteURL(ref.id) : null, TTL.climber),
    ]),
  }) as UseQueryResult<unknown>[];

  const athlete = useParsed(athleteQ!, (json) => (espnPath ? espn.parseAthlete(json, espnPath) : null), [espnPath]);
  const coreData = coreQ!.data;
  // College reads its bio from the core athlete, which names the team only by reference: a page opened
  // from its URL (no link to say the team) asks for the team's header, for the wash and the team link.
  const coreTeamID = college && !ref.team && coreData !== undefined ? espn.coreAthleteTeamID(coreData) : null;
  const coreTeamQ = useQuery(profileQuery(coreTeamID && espnPath ? espn.teamURL(espnPath, coreTeamID) : null, TTL.header));
  const coreTeam = useParsed(coreTeamQ, (json) => {
    if (!coreTeamID || !espnPath) return null;
    const h = espn.parseHeader(json, "football", espnPath, coreTeamID);
    return h ? teamRef({ id: `espn-ncaaf-${coreTeamID}`, name: h.shortName, logo: h.logo, league: "college-football", color: h.color, alternateColor: h.alternateColor, abbreviation: h.abbreviation }) : null;
  }, [coreTeamID, espnPath]);
  const overview = useParsed(overviewQ!, (json) => espn.parseOverview(json, sport), [sport]);
  const gameLog = useParsed(gameLogQ!, (json) => (espnPath ? espn.parseGameLog(json, espnPath, ref.position) : null), [espnPath, ref.position]);
  const leagueLeaders = useParsed(leagueLeadersQ!, espn.parseLeaders);
  const csPlayer = useParsed(csPlayerQ!, (json) => bo3.parsePlayer(json));
  const csGeneral = useParsed(csGeneralQ!, bo3.parseGeneral);
  const csHeadshots = useParsed(csAccuracyQ!, bo3.parseHeadshotShare);
  const csMatches = useParsed(csMatchesQ!, bo3.parseMatches);
  const csMaps = useParsed(csMapsQ!, bo3.parseMaps);
  const csRoles = useParsed(csRolesQ!, bo3.parseRoles);
  const climber = useParsed(climberQ!, (json) => ifsc.parseAthlete(json));

  // MLB: the log in the player's other role, kept only if they've played it this season (ESPN offers
  // pitching even to a first baseman, and batting to a pitcher who never came to the plate).
  const role = espnPath === "baseball/mlb" ? gameLog?.category : null;
  const other = role ? (role === "pitching" ? "batting" : "pitching") : null;
  const otherQ = useQuery(profileQuery(other && espnPath ? espn.gamelogURL(espnPath, ref.id, other) : null, TTL.athlete));
  const otherLog = useParsed(otherQ, (json) => {
    if (!espnPath || !other) return null;
    const log = espn.parseGameLog(json, espnPath, other === "pitching" ? "SP" : null, other === "pitching");
    return log && hasPlay(log) ? log : null;
  }, [espnPath, other]);

  // Career by season, when its section asks (ESPN's US sports).
  const careerQ = useQuery(profileQuery(options.careerRequested && espnPath && !espnPath.startsWith("soccer") ? espn.careerURL(espnPath, ref.id) : null, TTL.career));
  const careerTable = useParsed(careerQ, espn.parseCareer);

  const profile = useMemo<PlayerProfile>(() => {
    if (climber) return climber.profile;
    if (csPlayer || slug) {
      return {
        ...EMPTY_PROFILE,
        bio: csPlayer?.bio ?? null,
        tiles: bo3.csTiles(csPlayer?.rating ?? null, csGeneral?.kd ?? null, csGeneral?.adr ?? null, csHeadshots),
        gameLog: csMatches,
        mapPool: csMaps ?? NONE,
        roles: csRoles ?? NONE,
      };
    }
    let bio: Bio | null = null;
    let tiles: readonly StatTile[] = [];
    let tilesCaption: string | null = null;
    let injury: PlayerProfile["injury"] = null;
    if (athlete) {
      bio = athlete.bio;
      if (coreData !== undefined) bio = espn.mergeCoreAthlete(coreData, bio);
      if (bio.team == null) bio = { ...bio, team: ref.team };
      tiles = athlete.tiles;
      tilesCaption = athlete.tilesCaption;
      injury = athlete.injury;
    } else if (college && coreData !== undefined && espnPath) {
      let team = ref.team ?? coreTeam;
      // A link without the team's colors still gets them, from its logo (ESPN files college logos by ID).
      if (team && team.logo == null) {
        const source = teamSource(team);
        if (source?.kind === "espn") team = { ...team, logo: `https://a.espncdn.com/i/teamlogos/ncaa/500/${source.team}.png` };
      }
      bio = espn.mergeCoreAthlete(coreData, { ...emptyBio(ref.name), photo: espnPhoto(espnPath, ref.id, "hero"), team });
    }
    if (college && tiles.length === 0 && overview?.season) {
      const fill = espn.collegeTiles(overview.season, bio?.positionAbbreviation ?? ref.position);
      if (fill) {
        tiles = fill.tiles;
        tilesCaption = fill.caption;
      }
    }
    if (leagueLeaders && espnPath) tiles = espn.applyLeagueRanks(tiles, leagueLeaders, espnPath, ref.id);
    return {
      ...EMPTY_PROFILE,
      bio,
      tiles,
      tilesCaption,
      injury,
      season: overview?.season ?? null,
      competitions: overview?.competitions ?? null,
      note: overview?.note ?? null,
      awards: overview?.awards ?? NONE,
      gameLog,
    };
  }, [climber, csPlayer, slug, csGeneral, csHeadshots, csMatches, csMaps, csRoles, athlete, coreData, coreTeam, college, espnPath, ref, overview, leagueLeaders, gameLog]);

  // Soccer: FotMob's photo, and its injury when ESPN has none (never blocks the page).
  const fotTeam = sport === "soccer" && profile.bio ? (profile.bio.team ?? ref.team) : null;
  const squad = useFotMobSquad(fotTeam?.name ?? null, fotTeam?.league ?? null);
  const member = useMemo(
    () => (squad && profile.bio ? fotmob.matchMember(profile.bio.name, profile.bio.jersey ?? ref.jersey, squad.members) : null),
    [squad, profile.bio, ref.jersey],
  );
  const withFotMob = useMemo<PlayerProfile>(() => {
    if (!member || !profile.bio) return profile;
    const injury = profile.injury ?? (() => {
      const i = fotmob.memberInjury(member);
      return i ? { status: i.status, detail: i.detail, returnDate: null } : null;
    })();
    // The same face crop as on the squad list.
    return { ...profile, bio: { ...profile.bio, photo: fotMobPhoto(member.id) }, injury };
  }, [profile, member]);

  const failed = useMemo(() => {
    const out = new Set<PlayerPart>();
    // A 404 is the source answering that there's nobody by that ID: not a failure to retry (the page says so).
    const failedRequest = (q: UseQueryResult<unknown>) => hasFailed(q) && !isAnswer(q.error);
    if (failedRequest(athleteQ!) || (college && failedRequest(coreQ!)) || failedRequest(csPlayerQ!) || failedRequest(climberQ!)) out.add("bio");
    if (hasFailed(overviewQ!)) out.add("season");
    // An empty log (a player yet to appear) is an answer, not a failure: retrying wouldn't help.
    if (failedRequest(gameLogQ!) || failedRequest(csMatchesQ!)) out.add("gameLog");
    return out;
  }, [athleteQ, college, coreQ, csPlayerQ, climberQ, overviewQ, gameLogQ, csMatchesQ]);

  const primary = [athleteQ!, coreQ!, overviewQ!, gameLogQ!, csPlayerQ!, csGeneralQ!, csMatchesQ!, climberQ!];
  const reload = useCallback(() => {
    void queryClient.refetchQueries({ predicate: (q) => q.queryKey[0] === "profile" && String(q.queryKey[1]).includes(ref.source.kind === "counterStrike" ? `/players/${slug}` : `/${ref.id}`) });
  }, [ref, slug]);

  const fallbackBio = useMemo(() => linkBio(ref), [ref]);
  return {
    sport,
    bio: withFotMob.bio ?? fallbackBio,
    profile: withFotMob,
    otherLog,
    career: { table: careerTable, loading: careerQ.isLoading && !hasFailed(careerQ), failed: hasFailed(careerQ) },
    loaded: primary.every(settled),
    failed,
    fetching: primary.some((q) => q.isFetching),
    reload,
  };
}

// MARK: - Prefetch (ProfileStore.swift `prefetch`)

const prefetchLog: number[] = [];
const asked = new Map<string, number>();

/** A connection that costs, or a user who asked to save data: no speculative requests. */
function frugal(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return connection?.saveData === true || connection?.effectiveType === "2g" || connection?.effectiveType === "slow-2g";
}

/** The first request of a page, after a hover dwell: never on a frugal connection, at most six a minute, once per URL while fresh. */
function prefetchURL(url: string, ttl: number): void {
  const now = Date.now();
  if ((asked.get(url) ?? -Infinity) > now - ttl || frugal()) return;
  const state = queryClient.getQueryState(profileKey(url));
  if (state?.dataUpdatedAt && now - state.dataUpdatedAt < ttl) return;
  while (prefetchLog.length > 0 && prefetchLog[0]! < now - 60_000) prefetchLog.shift();
  if (prefetchLog.length >= 6) return;
  prefetchLog.push(now);
  asked.set(url, now);
  void queryClient.prefetchQuery(profileQuery(url, ttl));
}

export function prefetchTeam(ref: TeamRef): void {
  const source = teamSource(ref);
  if (source?.kind === "espn") prefetchURL(espn.teamURL(source.path, source.team), TTL.header);
  else if (source?.kind === "counterStrike") prefetchURL(bo3.teamLookupURL(source.id), TTL.forever);
}

export function prefetchPlayer(ref: PlayerRef): void {
  prefetchURL(firstPlayerURL(ref), ref.source.kind === "espn" ? TTL.athlete : TTL.leaders);
  // The hero's photo too (a few KB, decoded once and kept): a click after the
  // pointer rested draws it sharp on the page's first frame.
  const photo = heroPhotoURL(ref);
  if (photo && !frugal()) preloadPhoto(photo);
}

export { isPhotoLoaded, isPhotoMissing, markPhoto, preloadPhoto } from "./profilePhotos";

// MARK: - Page session (ProfileStore.swift `PageSession`)

export interface PageSession {
  readonly depthChart: boolean;
  readonly allGames: boolean;
  /** MLB: null shows the player's role (pitching for a pitcher). */
  readonly pitching: boolean | null;
  readonly expanded: readonly string[];
  readonly career: boolean;
}

const EMPTY_SESSION: PageSession = { depthChart: false, allGames: false, pitching: null, expanded: [], career: false };
const sessions = new Map<string, PageSession>();
const sessionListeners = new Set<() => void>();

/** Per-page choices that survive Back (the depth chart, All Games, the MLB category, expansions). */
export function usePageSession(key: string): [PageSession, (change: Partial<PageSession> | ((s: PageSession) => Partial<PageSession>)) => void] {
  const session = useSyncExternalStore(
    (listener) => {
      sessionListeners.add(listener);
      return () => sessionListeners.delete(listener);
    },
    () => sessions.get(key) ?? EMPTY_SESSION,
    () => EMPTY_SESSION,
  );
  const update = useCallback(
    (change: Partial<PageSession> | ((s: PageSession) => Partial<PageSession>)) => {
      const current = sessions.get(key) ?? EMPTY_SESSION;
      sessions.set(key, { ...current, ...(typeof change === "function" ? change(current) : change) });
      for (const listener of sessionListeners) listener();
    },
    [key],
  );
  return [session, update];
}
