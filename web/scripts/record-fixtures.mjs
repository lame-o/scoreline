#!/usr/bin/env node
// Records small, trimmed JSON fixtures for the parser tests from the live
// upstreams (straight from the source, not through the proxy):
//
//   pnpm fixtures
//
// Each response is cut down to the fields the parsers read (mirroring the
// lenient Decodable structs in Providers.swift) and a handful of events, so
// fixtures stay a few KB and readable in review. Files named
// `*.synthetic.json` are not written here: they're hand-derived live states
// (see ARCHITECTURE.md § Testing), because a recording session rarely
// coincides with a live game of every sport.

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures");
const UA = "Scoreline/1.0 (web fixtures; +https://github.com/lame-o/scoreline)";

async function get(url, headers = {}) {
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": UA, ...headers } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function save(name, data, source) {
  await mkdir(out, { recursive: true });
  const body = { _source: source, _recorded: new Date().toISOString(), ...data };
  await writeFile(join(out, name), JSON.stringify(body, null, 1) + "\n");
  console.log(`${name}  ${(JSON.stringify(body).length / 1024).toFixed(1)} KB`);
}

const pick = (obj, keys) =>
  obj == null ? obj : Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

// MARK: ESPN

function trimCompetitor(c) {
  return {
    ...pick(c, ["homeAway", "score", "winner", "curatedRank"]),
    records: c.records?.map((r) => pick(r, ["type", "summary"])),
    team: pick(c.team, ["id", "abbreviation", "shortDisplayName", "displayName", "logo", "color", "alternateColor"]),
  };
}

function trimEvent(e) {
  const comp = e.competitions?.[0] ?? {};
  return {
    ...pick(e, ["id", "date", "name", "shortName"]),
    season: pick(e.season, ["slug", "year", "type"]),
    status: { ...pick(e.status, ["clock", "displayClock", "period"]), type: pick(e.status?.type, ["state", "completed", "shortDetail", "detail", "name"]) },
    competitions: [
      {
        competitors: comp.competitors?.map(trimCompetitor),
        notes: comp.notes?.map((n) => pick(n, ["headline"])),
        series: pick(comp.series, ["summary"]),
        situation: comp.situation,
        details: comp.details?.map((d) => ({
          ...pick(d, ["type", "clock", "team", "scoringPlay", "ownGoal", "penaltyKick", "redCard"]),
          athletesInvolved: d.athletesInvolved?.map((a) => pick(a, ["shortName", "displayName"])),
        })),
        venue: pick(comp.venue, ["fullName"]),
        broadcasts: comp.broadcasts?.map((b) => pick(b, ["market", "names"])),
      },
    ],
    links: e.links?.slice(0, 2).map((l) => pick(l, ["href", "rel"])),
  };
}

async function espn(name, path, query = "", limit = 4, prefer = () => 0) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard${query}`;
  const board = await get(url);
  const events = [...(board.events ?? [])].sort((a, b) => prefer(b) - prefer(a)).slice(0, limit).map(trimEvent);
  await save(name, { events }, url);
}

// MARK: bo3.gg

const bo3Base = "https://api.bo3.gg/api/v1/matches";
function bo3URL(status, sort, limit, { after, before } = {}) {
  const u = new URL(bo3Base);
  u.searchParams.set("filter[matches.discipline_id][eq]", "1");
  u.searchParams.set("filter[matches.status][in]", status);
  u.searchParams.set("filter[matches.tier][in]", "s");
  u.searchParams.set("sort", sort);
  u.searchParams.set("page[limit]", String(limit));
  u.searchParams.set("with", "teams,tournament");
  if (after) u.searchParams.set("filter[matches.start_date][gte]", after.toISOString());
  if (before) u.searchParams.set("filter[matches.start_date][lte]", before.toISOString());
  return u.href;
}
const trimMatch = (m) => ({
  ...pick(m, ["id", "slug", "status", "bo_type", "start_date", "team1_score", "team2_score", "winner_team_id", "tier"]),
  team1: pick(m.team1, ["id", "name", "image_url"]),
  team2: pick(m.team2, ["id", "name", "image_url"]),
  tournament: pick(m.tournament, ["name"]),
});
async function bo3(name, url, limit = 4) {
  const page = await get(url);
  await save(name, { results: (page.results ?? []).slice(0, limit).map(trimMatch) }, url);
}

// MARK: IFSC

const IFSC = "https://ifsc.results.info";
const ifscHeaders = { Referer: "https://ifsc.results.info/" };
async function ifsc() {
  const rootURL = `${IFSC}/api/v1/`;
  const root = await get(rootURL, ifscHeaders);
  // The current season and the one after it: what the off-season opener reads.
  const wanted = [root.current?.season, String(Number(root.current?.season) + 1)];
  const seasons = (root.seasons ?? []).filter((s) => wanted.includes(s.name)).map((s) => pick(s, ["id", "name", "url"]));
  await save(
    "ifsc-root.json",
    { current: { ...pick(root.current, ["id", "season", "url"]), leagues: root.current?.leagues?.slice(0, 3).map((l) => pick(l, ["id", "league_id", "name", "url"])) }, seasons },
    rootURL,
  );

  const seasonURL = `${IFSC}${root.current.url}`;
  const season = await get(seasonURL, ifscHeaders);
  const worldCupLeague = root.current.leagues.find((l) => l.league_id === 1);
  const wc = season.events.filter((e) => e.league_season_id === worldCupLeague.id);
  const keep = [...wc.slice(0, 1), ...wc.slice(-3)];
  const trimSeasonEvent = (e) => ({
    ...pick(e, ["event", "event_id", "league_season_id", "location", "country", "starts_at", "ends_at", "local_start_date", "local_end_date", "timezone", "url", "is_paraclimbing_event"]),
    disciplines: e.disciplines?.map((d) => pick(d, ["kind"])),
  });
  await save("ifsc-season.json", { name: season.name, leagues: season.leagues?.slice(0, 2), events: keep.map(trimSeasonEvent) }, seasonURL);

  // The season after (the off-season's next opener), when it's published.
  const next = (root.seasons ?? []).find((s) => s.name === String(Number(root.current.season) + 1));
  if (next) {
    const nextURL = `${IFSC}/api/v1/seasons/${next.id}`;
    const ns = await get(nextURL, ifscHeaders);
    const nl = ns.leagues?.find((l) => l.name?.startsWith("World Cups"));
    const nid = nl ? Number(nl.url.split("/").pop()) : null;
    const nev = (ns.events ?? []).filter((e) => e.league_season_id === nid).slice(0, 3);
    await save("ifsc-season-next.json", { name: ns.name, leagues: ns.leagues?.slice(0, 2), events: nev.map(trimSeasonEvent) }, nextURL);
  }

  // The last finished World Cup: its categories and one round's results.
  const done = [...wc].reverse().find((e) => new Date(e.ends_at.replace(" UTC", "Z").replace(" ", "T")) < new Date());
  const eventURL = `${IFSC}/api/v1/events/${done.event_id}`;
  const event = await get(eventURL, ifscHeaders);
  const cats = (event.d_cats ?? []).slice(0, 3).map((c) => ({
    ...pick(c, ["dcat_id", "dcat_name"]),
    category_rounds: c.category_rounds?.map((r) => pick(r, ["category_round_id", "name", "status", "status_as_of", "result_url"])),
  }));
  await save("ifsc-event.json", { ...pick(event, ["id", "name"]), d_cats: cats }, eventURL);

  const round = cats.flatMap((c) => c.category_rounds ?? []).find((r) => r.result_url && r.status === "finished");
  if (round) {
    const resultURL = `${IFSC}${round.result_url}`;
    const results = await get(resultURL, ifscHeaders);
    await save(
      "ifsc-round-results.json",
      {
        ...pick(results, ["id", "event", "discipline", "status", "status_as_of", "category", "round"]),
        routes: results.routes?.map((r) => pick(r, ["id", "name"])),
        ranking: results.ranking?.slice(0, 6).map((a) => ({ ...pick(a, ["athlete_id", "rank", "firstname", "lastname", "country", "score"]), ascents: a.ascents?.slice(0, 2) })),
        startlist: results.startlist?.slice(0, 3),
      },
      resultURL,
    );
  }
}

// MARK: Team lists (Settings → a league's teams)

async function teams() {
  const nflURL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams?limit=1000";
  const nfl = await get(nflURL);
  const trimTeam = (entry) => ({ team: { ...pick(entry.team, ["id", "displayName", "abbreviation"]), logos: entry.team?.logos?.slice(0, 1).map((l) => pick(l, ["href"])) } });
  await save("espn-nfl-teams.json", { sports: [{ leagues: [{ teams: nfl.sports[0].leagues[0].teams.slice(0, 4).map(trimTeam) }] }] }, nflURL);

  const collegeURL = "https://site.api.espn.com/apis/v2/sports/football/college-football/standings";
  const college = await get(collegeURL);
  const trimEntry = (e) => ({ team: { ...pick(e.team, ["id", "location", "displayName", "abbreviation"]), logos: e.team?.logos?.slice(0, 1).map((l) => pick(l, ["href"])) } });
  const wanted = ["Big Ten", "SEC", "American"];
  const children = college.children
    .filter((c) => wanted.includes(c.shortName ?? c.abbreviation))
    .map((c) => ({ ...pick(c, ["name", "shortName"]), standings: { entries: c.standings?.entries?.slice(0, 3).map(trimEntry) } }));
  await save("espn-college-standings.json", { children }, collegeURL);

  const bo3URL = "https://api.bo3.gg/api/v1/teams?filter%5Bteams.discipline_id%5D%5Beq%5D=1&sort=rank&page%5Blimit%5D=60";
  const bo3 = await get(bo3URL);
  await save("bo3-teams.json", { results: bo3.results.slice(0, 4).map((t) => pick(t, ["id", "name", "image_url", "rank"])) }, bo3URL);
}

// MARK: Run
//
// `pnpm fixtures` records everything; `pnpm fixtures ifsc` (or espn, bo3, teams) one source.
const only = process.argv[2];
const want = (source) => !only || only === source;

const now = Date.now();
const hour = 3_600_000;
const rankedGames = (e) => (e.competitions?.[0]?.competitors ?? []).filter((c) => (c.curatedRank?.current ?? 99) <= 25).length;

if (want("espn")) {
  await espn("espn-eng1-scoreboard.json", "soccer/eng.1", "", 3);
  await espn("espn-nfl-scoreboard.json", "football/nfl", "", 3);
  await espn("espn-college-football-scoreboard.json", "football/college-football", "?groups=80", 4, rankedGames);
  await espn("espn-mlb-scoreboard.json", "baseball/mlb", "", 2);
  await espn("espn-nba-scoreboard.json", "basketball/nba", "", 3);
}
if (want("bo3")) {
  await bo3("bo3-matches-upcoming.json", bo3URL("upcoming,postponed", "start_date", 12, { after: new Date(now - 48 * hour) }));
  await bo3("bo3-matches-finished.json", bo3URL("finished,defwin,canceled", "-start_date", 12, { before: new Date(now + 48 * hour) }));
}
if (want("ifsc")) await ifsc();
if (want("teams")) await teams();
