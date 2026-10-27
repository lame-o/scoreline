// Records the team and player pages' fixtures (`pnpm fixtures profiles`):
// small, trimmed responses for the profile parsers' tests, each cut to the
// fields ProfileProviders.swift reads. Straight from the sources, like the
// rest of record-fixtures.mjs.
//
// The subjects are chosen for the rules they exercise: an NBA star (ranked
// tiles, awards, career), an MLB starter (pitching by default, an all-zero
// batting log), Shohei Ohtani (two-way: both logs have play), an NFL team
// (grouped roster, depth chart), a Premier League club and player (squad
// stats, competitions, FotMob), a CS2 team and player, and a climber.

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures", "profiles");
const UA = "Scoreline/1.0 (web fixtures; +https://github.com/lame-o/scoreline)";

async function get(url, headers = {}) {
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": UA, ...headers } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function save(name, data, source) {
  await mkdir(out, { recursive: true });
  const body = Array.isArray(data) ? { _source: source, _recorded: new Date().toISOString(), items: data } : { _source: source, _recorded: new Date().toISOString(), ...data };
  await writeFile(join(out, name), JSON.stringify(body, null, 1) + "\n");
  console.log(`profiles/${name}  ${(JSON.stringify(body).length / 1024).toFixed(1)} KB`);
}

const pick = (obj, keys) => (obj == null ? obj : Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]])));

const SITE = "https://site.api.espn.com/apis/site/v2/sports";
const WEB = "https://site.web.api.espn.com/apis/common/v3/sports";
const CORE = "https://sports.core.api.espn.com/v2/sports";

function seasonFor(path, now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  if (path.startsWith("basketball")) return { year: m >= 8 ? y + 1 : y, type: 2 };
  if (path.startsWith("soccer")) return { year: m >= 7 ? y : y - 1, type: 1 };
  return { year: m <= 2 ? y - 1 : y, type: 2 };
}
const core = (path) => {
  const [sport, league] = path.split("/");
  return `${CORE}/${sport}/leagues/${league}`;
};

// MARK: Trimmers

const trimTeamRef = (t) => ({ ...pick(t, ["id", "displayName", "shortDisplayName", "abbreviation", "color", "alternateColor", "logo"]), logos: t?.logos?.slice(0, 1).map((l) => pick(l, ["href"])) });

function trimAthlete(json) {
  const a = json.athlete;
  return {
    athlete: {
      ...pick(a, ["id", "displayName", "jersey", "active", "age", "displayBirthPlace", "displayHeight", "displayWeight", "displayDraft", "displayExperience", "displayBatsThrows", "debutYear", "citizenship", "injuries"]),
      position: pick(a.position, ["displayName", "abbreviation"]),
      headshot: pick(a.headshot, ["href"]),
      college: pick(a.college, ["name"]),
      team: a.team ? trimTeamRef(a.team) : undefined,
      links: a.links?.filter((l) => l.rel?.includes("playercard")).map((l) => pick(l, ["rel", "href"])),
      statsSummary: a.statsSummary && { displayName: a.statsSummary.displayName, statistics: a.statsSummary.statistics?.map((s) => pick(s, ["abbreviation", "shortDisplayName", "displayValue", "rankDisplayValue"])) },
    },
  };
}

const trimCore = (a) => ({ ...pick(a, ["dateOfBirth", "age", "displayHeight", "displayWeight", "jersey"]), birthPlace: a.birthPlace, position: pick(a.position, ["displayName", "abbreviation"]), experience: a.experience, draft: pick(a.draft, ["year", "round", "selection"]) });

function trimOverview(o) {
  return {
    statistics: o.statistics && { labels: o.statistics.labels, names: o.statistics.names, splits: o.statistics.splits?.map((s) => pick(s, ["displayName", "stats"])) },
    rotowire: pick(o.rotowire, ["headline", "story", "published"]),
    awards: o.awards?.slice(0, 6).map((a) => pick(a, ["name", "displayCount"])),
  };
}

/** A game log cut to its last `keep` games per season type (and their events). */
function trimGameLog(g, keep = 6) {
  const seasonTypes = (g.seasonTypes ?? []).map((t) => {
    let left = keep;
    const categories = (t.categories ?? []).map((c) => {
      const events = (c.events ?? []).slice(0, Math.max(0, left)).map((e) => pick(e, ["eventId", "stats"]));
      left -= events.length;
      return { ...pick(c, ["displayName"]), events };
    }).filter((c) => c.events.length > 0);
    return { displayName: t.displayName, categories };
  });
  const ids = new Set(seasonTypes.flatMap((t) => t.categories.flatMap((c) => c.events.map((e) => e.eventId))));
  const events = Object.fromEntries(Object.entries(g.events ?? {}).filter(([id]) => ids.has(id)).map(([id, e]) => [id, {
    ...pick(e, ["gameDate", "homeTeamId", "awayTeamId", "homeTeamScore", "awayTeamScore", "gameResult", "leagueShortName", "leagueName"]),
    opponent: pick(e.opponent, ["id", "displayName", "abbreviation", "logo"]),
  }]));
  return { filters: g.filters?.map((f) => pick(f, ["name", "value"])), names: g.names, labels: g.labels, events, seasonTypes };
}

function trimCareer(s) {
  const c = s.categories?.[0];
  const statistics = (c?.statistics ?? []).slice(-4).map((x) => ({ ...pick(x, ["teamId", "stats"]), season: pick(x.season, ["displayName"]) }));
  const used = new Set(statistics.map((x) => x.teamId));
  const teams = Object.fromEntries(Object.entries(s.teams ?? {}).filter(([, t]) => used.has(t.id)).map(([k, t]) => [k, pick(t, ["id", "abbreviation"])]));
  return { teams, categories: [{ ...pick(c, ["name", "labels", "names"]), statistics }] };
}

function trimRosterAthlete(a) {
  return {
    ...pick(a, ["id", "displayName", "jersey", "age", "dateOfBirth", "displayHeight", "displayWeight", "citizenship"]),
    position: pick(a.position, ["abbreviation", "displayName"]),
    headshot: a.headshot ? pick(a.headshot, ["href"]) : undefined,
    college: a.college ? pick(a.college, ["name"]) : undefined,
    experience: a.experience,
    injuries: a.injuries?.slice(0, 1).map((i) => pick(i, ["status"])),
    statistics: a.statistics && { splits: { categories: a.statistics.splits?.categories?.map((c) => ({ stats: c.stats?.filter((s) => ["appearances", "totalGoals", "goalAssists", "saves", "goalsConceded", "totalShots"].includes(s.name)).map((s) => pick(s, ["name", "displayValue"])) })) } },
  };
}

function trimRoster(r, perGroup = 4, prefer = () => 0) {
  const athletes = (r.athletes ?? []).map((entry) =>
    entry.items
      ? { position: entry.position, items: [...entry.items].sort((a, b) => prefer(b) - prefer(a)).slice(0, perGroup).map(trimRosterAthlete) }
      : trimRosterAthlete(entry),
  );
  return { athletes: athletes.filter((a) => !a.items || a.items.length > 0), coach: r.coach?.map((c) => pick(c, ["firstName", "lastName"])), season: pick(r.season, ["year"]) };
}

function trimHeader(t) {
  const e = t.nextEvent?.[0];
  return {
    team: {
      ...pick(t, ["id", "displayName", "shortDisplayName", "abbreviation", "color", "alternateColor", "standingSummary", "leagueAbbrev"]),
      logos: t.logos?.slice(0, 1).map((l) => pick(l, ["href"])),
      record: { items: t.record?.items?.map((i) => pick(i, ["type", "summary"])) },
      franchise: { venue: { fullName: t.franchise?.venue?.fullName, address: pick(t.franchise?.venue?.address, ["city"]) } },
      links: t.links?.filter((l) => l.rel?.includes("clubhouse")).map((l) => pick(l, ["rel", "href"])),
      nextEvent: e ? [trimScheduleEvent(e)] : [],
    },
  };
}

function trimScheduleEvent(e) {
  const c = e.competitions?.[0] ?? {};
  return {
    ...pick(e, ["id", "date"]),
    league: pick(e.league, ["abbreviation", "slug"]),
    seasonType: pick(e.seasonType, ["type"]),
    competitions: [{
      status: { type: pick(c.status?.type, ["state", "name"]) },
      broadcasts: c.broadcasts?.slice(0, 1).map((b) => ({ media: pick(b.media, ["shortName"]) })),
      competitors: c.competitors?.map((x) => ({ ...pick(x, ["homeAway", "winner"]), score: x.score?.displayValue != null ? { displayValue: x.score.displayValue } : x.score, team: trimTeamRef(x.team) })),
    }],
  };
}

function trimDepth(d, keys = ["qb", "rb", "wr1", "lt", "lde", "mlb", "pk"]) {
  return {
    depthchart: d.depthchart.map((u) => ({
      name: u.name,
      positions: Object.fromEntries(Object.entries(u.positions).filter(([k]) => keys.includes(k)).map(([k, p]) => [k, { position: pick(p.position, ["abbreviation"]), athletes: p.athletes.slice(0, 2).map((a) => pick(a, ["id", "displayName"])) }])),
    })),
  };
}

const trimLeaders = (l, categories, n = 3) => ({
  categories: l.categories.filter((c) => !categories || categories.includes(c.name)).map((c) => ({ name: c.name, leaders: c.leaders.slice(0, n).map((x) => ({ displayValue: x.displayValue, athlete: { $ref: x.athlete?.$ref } })) })),
});

const trimStandings = (s, keys) => {
  const trimEntries = (std) => ({ entries: std.entries.map((e) => ({ team: { ...pick(e.team, ["id", "abbreviation", "shortDisplayName", "displayName"]), logos: e.team.logos?.slice(0, 1).map((l) => pick(l, ["href"])) }, stats: e.stats.filter((x) => keys.includes(x.type) || keys.includes(x.name)).map((x) => pick(x, ["name", "type", "displayValue", "summary"])) })) });
  return s.children ? { children: s.children.map((c) => ({ ...pick(c, ["name", "abbreviation", "shortName"]), standings: trimEntries(c.standings) })) } : { standings: trimEntries(s.standings) };
};

// MARK: Run

export async function recordProfiles() {
  // NBA: a star's page, a team's page.
  const nba = "basketball/nba";
  const ns = seasonFor(nba);
  await save("espn-nba-athlete.json", trimAthlete(await get(`${WEB}/${nba}/athletes/1966`)), `${WEB}/${nba}/athletes/1966`);
  await save("espn-nba-core-athlete.json", trimCore(await get(`${core(nba)}/athletes/1966`)), `${core(nba)}/athletes/1966`);
  await save("espn-nba-overview.json", trimOverview(await get(`${WEB}/${nba}/athletes/1966/overview`)), `${WEB}/${nba}/athletes/1966/overview`);
  await save("espn-nba-gamelog.json", trimGameLog(await get(`${WEB}/${nba}/athletes/1966/gamelog`), 8), `${WEB}/${nba}/athletes/1966/gamelog`);
  await save("espn-nba-career.json", trimCareer(await get(`${WEB}/${nba}/athletes/1966/stats`)), `${WEB}/${nba}/athletes/1966/stats`);
  await save("espn-nba-team.json", trimHeader((await get(`${SITE}/${nba}/teams/13`)).team), `${SITE}/${nba}/teams/13`);
  const lakers = await get(`${SITE}/${nba}/teams/13/roster`);
  await save("espn-nba-roster.json", trimRoster(lakers, 99), `${SITE}/${nba}/teams/13/roster`);
  const depthURL = `${core(nba)}/seasons/${ns.year}/teams/13/depthcharts`;
  const depth = await get(depthURL);
  await save("espn-nba-depth.json", { items: depth.items?.slice(0, 1).map((i) => ({ positions: Object.fromEntries(Object.entries(i.positions).map(([k, p]) => [k, { athletes: p.athletes.map((a) => ({ athlete: { $ref: a.athlete.$ref } })) }])) })) }, depthURL);
  const leadersURL = `${core(nba)}/seasons/${ns.year}/types/${ns.type}/teams/13/leaders`;
  await save("espn-nba-team-leaders.json", trimLeaders(await get(leadersURL), ["pointsPerGame", "reboundsPerGame", "assistsPerGame", "blocksPerGame", "minutesPerGame", "fieldGoalPercentage"], 15), leadersURL);
  const statsURL = `${core(nba)}/seasons/${ns.year}/types/${ns.type}/teams/13/statistics`;
  const stats = await get(statsURL);
  await save("espn-nba-team-stats.json", { splits: { categories: stats.splits.categories.map((c) => ({ name: c.name, stats: c.stats.filter((s) => ["fieldGoalPct", "threePointPct", "trueShootingPct", "assists", "reboundRate", "steals", "blocks", "turnovers"].includes(s.name)).map((s) => pick(s, ["name", "displayValue", "rankDisplayValue"])) })) } }, statsURL);
  const txURL = `${SITE}/${nba}/transactions?team=13&limit=20`;
  await save("espn-nba-transactions.json", { transactions: (await get(txURL)).transactions?.slice(0, 4).map((t) => pick(t, ["date", "description"])) }, txURL);
  const leagueURL = `${core(nba)}/seasons/${ns.year}/types/${ns.type}/leaders?limit=25`;
  await save("espn-nba-league-leaders.json", trimLeaders(await get(leagueURL), ["pointsPerGame", "assistsPerGame", "reboundsPerGame"], 25), leagueURL);
  const scheduleURL = `${SITE}/${nba}/teams/13/schedule`;
  await save("espn-nba-schedule.json", { events: (await get(scheduleURL)).events.slice(0, 6).map(trimScheduleEvent) }, scheduleURL);
  const nbaStandingsURL = "https://site.api.espn.com/apis/v2/sports/basketball/nba/standings";
  await save("espn-nba-standings.json", trimStandings(await get(nbaStandingsURL), ["total", "playoffSeed", "winPercent", "gamesBehind", "streak"]), nbaStandingsURL);

  // MLB: a starter (pitching by default; a batting log of all-zero appearances) and Ohtani (two-way).
  const mlb = "baseball/mlb";
  await save("espn-mlb-pitcher-gamelog.json", trimGameLog(await get(`${WEB}/${mlb}/athletes/33190/gamelog`)), `${WEB}/${mlb}/athletes/33190/gamelog`);
  await save("espn-mlb-pitcher-batting.json", trimGameLog(await get(`${WEB}/${mlb}/athletes/33190/gamelog?category=batting`)), `${WEB}/${mlb}/athletes/33190/gamelog?category=batting`);
  await save("espn-mlb-twoway-gamelog.json", trimGameLog(await get(`${WEB}/${mlb}/athletes/39832/gamelog`)), `${WEB}/${mlb}/athletes/39832/gamelog`);
  await save("espn-mlb-twoway-pitching.json", trimGameLog(await get(`${WEB}/${mlb}/athletes/39832/gamelog?category=pitching`)), `${WEB}/${mlb}/athletes/39832/gamelog?category=pitching`);
  await save("espn-mlb-twoway-athlete.json", trimAthlete(await get(`${WEB}/${mlb}/athletes/39832`)), `${WEB}/${mlb}/athletes/39832`);

  // NFL: a team with a depth chart, a quarterback.
  const nfl = "football/nfl";
  await save("espn-nfl-team.json", trimHeader((await get(`${SITE}/${nfl}/teams/12`)).team), `${SITE}/${nfl}/teams/12`);
  const chiefs = await get(`${SITE}/${nfl}/teams/12/roster`);
  const stars = new Set(["3139477", "3055899", "4426659"]);
  await save("espn-nfl-roster.json", trimRoster(chiefs, 4, (a) => (stars.has(a.id) ? 1 : 0)), `${SITE}/${nfl}/teams/12/roster`);
  await save("espn-nfl-depthchart.json", trimDepth(await get(`${SITE}/${nfl}/teams/12/depthcharts`)), `${SITE}/${nfl}/teams/12/depthcharts`);
  await save("espn-nfl-gamelog.json", trimGameLog(await get(`${WEB}/${nfl}/athletes/3139477/gamelog`)), `${WEB}/${nfl}/athletes/3139477/gamelog`);
  await save("espn-nfl-athlete.json", trimAthlete(await get(`${WEB}/${nfl}/athletes/3139477`)), `${WEB}/${nfl}/athletes/3139477`);

  // Soccer: a club (squad stats; its league from the header) and a player (competitions, the match strip).
  await save("espn-soccer-team.json", trimHeader((await get(`${SITE}/soccer/all/teams/359`)).team), `${SITE}/soccer/all/teams/359`);
  const arsenal = await get(`${SITE}/soccer/eng.1/teams/359/roster`);
  await save("espn-soccer-roster.json", { ...trimRoster({ ...arsenal, athletes: arsenal.athletes.filter((a) => ["196176", "236322", "238262", "203669", "280555", "277385", "282716"].includes(a.id)) }), coach: arsenal.coach?.slice(0, 1) }, `${SITE}/soccer/eng.1/teams/359/roster`);
  await save("espn-soccer-overview.json", trimOverview(await get(`${WEB}/soccer/eng.1/athletes/280555/overview`)), `${WEB}/soccer/eng.1/athletes/280555/overview`);
  await save("espn-soccer-gamelog.json", trimGameLog(await get(`${WEB}/soccer/eng.1/athletes/280555/gamelog`), 8), `${WEB}/soccer/eng.1/athletes/280555/gamelog`);
  await save("espn-soccer-athlete.json", trimAthlete(await get(`${WEB}/soccer/eng.1/athletes/280555`)), `${WEB}/soccer/eng.1/athletes/280555`);
  const engURL = "https://site.api.espn.com/apis/v2/sports/soccer/eng.1/standings";
  await save("espn-eng1-standings.json", trimStandings(await get(engURL), ["gamesPlayed", "wins", "ties", "losses", "pointsFor", "pointsAgainst", "pointDifferential", "points"]), engURL);
  const soccerScheduleURL = `${SITE}/soccer/all/teams/359/schedule`;
  const soccerSchedule = await get(soccerScheduleURL);
  await save("espn-soccer-schedule.json", { events: [...soccerSchedule.events.slice(0, 5), ...soccerSchedule.events.filter((e) => e.league?.slug?.includes("friendly")).slice(0, 1)].map(trimScheduleEvent) }, soccerScheduleURL);

  // FotMob: the club's search and squad (photos, injuries, the coach).
  const searchURL = "https://www.fotmob.com/api/data/search/suggest?term=Arsenal&lang=en";
  await save("fotmob-search.json", (await get(searchURL)).map((g) => ({ suggestions: g.suggestions?.slice(0, 3).map((s) => pick(s, ["type", "id", "name", "leagueId"])) })), searchURL);
  const fotTeamURL = "https://www.fotmob.com/api/data/teams?id=9825";
  const fot = await get(fotTeamURL);
  await save("fotmob-team.json", { squad: { squad: fot.squad.squad.map((g) => ({ title: g.title, members: g.members.slice(0, 4).map((m) => pick(m, ["id", "name", "shirtNumber", "injury"])).concat(g.members.filter((m) => m.injury).slice(0, 1).map((m) => pick(m, ["id", "name", "shirtNumber", "injury"]))) })) } }, fotTeamURL);

  // CS2: Vitality and ZywOo.
  const bo3 = "https://api.bo3.gg/api/v1";
  const lookupURL = `${bo3}/teams?filter%5Bteams.id%5D%5Beq%5D=667`;
  await save("bo3-team-lookup.json", { results: (await get(lookupURL)).results.map((r) => pick(r, ["id", "slug", "name"])) }, lookupURL);
  const team = await get(`${bo3}/teams/vitality?with=players.country`);
  await save("bo3-team.json", {
    ...pick(team, ["id", "name", "slug", "acronym", "image_url", "rank", "rank_diff"]),
    players: team.players.map((p) => ({ ...pick(p, ["id", "slug", "nickname", "first_name", "last_name", "status", "is_coach", "six_month_avg_rating", "birthday", "image_url"]), country: pick(p.country, ["code", "name"]) })),
    achievements: team.achievements.slice(0, 6).map((a) => ({ ...pick(a, ["date", "title"]), tournament: pick(a.tournament, ["name", "tier"]) })),
  }, `${bo3}/teams/vitality?with=players.country`);
  await save("bo3-team-stats.json", await get(`${bo3}/teams/vitality/general_stats`), `${bo3}/teams/vitality/general_stats`);
  const trimMatch = (m) => ({ ...pick(m, ["id", "slug", "status", "bo_type", "start_date", "team1_id", "team2_id", "team1_score", "team2_score", "winner_team_id"]), team1: pick(m.team1, ["id", "name", "image_url", "acronym"]), team2: pick(m.team2, ["id", "name", "image_url", "acronym"]), tournament: pick(m.tournament, ["name"]) });
  const upcomingURL = `${bo3}/matches?filter%5Bmatches.team_ids%5D%5Boverlap%5D=667&filter%5Bmatches.status%5D%5Bin%5D=upcoming%2Ccurrent&filter%5Bmatches.tier%5D%5Bin%5D=s&sort=start_date&page%5Blimit%5D=3&with=teams%2Ctournament`;
  await save("bo3-team-upcoming.json", { results: (await get(upcomingURL)).results.slice(0, 1).map(trimMatch) }, upcomingURL);
  const historyURL = `${bo3}/matches?filter%5Bmatches.team_ids%5D%5Boverlap%5D=667&filter%5Bmatches.status%5D%5Bin%5D=finished%2Cdefwin&filter%5Bmatches.tier%5D%5Bin%5D=s&sort=-start_date&page%5Blimit%5D=20&page%5Boffset%5D=0&with=teams%2Ctournament`;
  await save("bo3-team-history.json", { results: (await get(historyURL)).results.slice(0, 4).map(trimMatch) }, historyURL);
  const player = await get(`${bo3}/players/zywoo`);
  await save("bo3-player.json", { ...pick(player, ["nickname", "slug", "first_name", "last_name", "image_url", "birthday", "joined_team_at", "total_prize", "is_coach", "six_month_avg_rating"]), country: pick(player.country, ["code", "name"]), team: pick(player.team, ["id", "name", "image_url", "acronym"]) }, `${bo3}/players/zywoo`);
  await save("bo3-player-general.json", await get(`${bo3}/players/zywoo/general_stats`), `${bo3}/players/zywoo/general_stats`);
  await save("bo3-player-accuracy.json", await get(`${bo3}/players/zywoo/accuracy_stats`), `${bo3}/players/zywoo/accuracy_stats`);
  const matches = await get(`${bo3}/players/zywoo/matches_list_stats/general?limit=10`);
  await save("bo3-player-matches.json", matches.slice(0, 6).map((m) => ({ ...pick(m, ["match_id", "match_slug", "match_start_date", "game_wins", "game_numbers", "for_game_map_name", "rounds_count", "enemy_team_id", "enemy_team_name", "enemy_team_image_url", "tournament_slug"]), stats: m.stats?.slice(0, 1).map((s) => pick(s, ["player_rating", "kills", "death", "damage", "headshots"])) })), `${bo3}/players/zywoo/matches_list_stats/general?limit=10`);
  await save("bo3-player-maps.json", await get(`${bo3}/players/zywoo/map_stats`), `${bo3}/players/zywoo/map_stats`);
  await save("bo3-player-roles.json", await get(`${bo3}/players/zywoo/player_roles`), `${bo3}/players/zywoo/player_roles`);

  // Climbing: Janja Garnbret.
  const ifscURL = "https://ifsc.results.info/api/v1/athletes/1147";
  const climber = await get(ifscURL, { Referer: "https://ifsc.results.info/" });
  await save("ifsc-athlete.json", {
    ...pick(climber, ["id", "firstname", "lastname", "birthday", "age", "height", "arm_span", "city", "country", "photo_url", "speed_personal_best", "discipline_podiums", "world_championships_discipline_podiums"]),
    federation: pick(climber.federation, ["name"]),
    cup_rankings: climber.cup_rankings?.slice(-2),
    all_results: climber.all_results?.slice(0, 14).map((r) => pick(r, ["season", "rank", "discipline", "event_name", "date", "category_name"])),
  }, ifscURL);
}
