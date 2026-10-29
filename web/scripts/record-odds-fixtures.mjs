#!/usr/bin/env node
// Records the odds chart's fixtures (test/fixtures/odds), trimmed to the
// fields data/odds/*.ts reads: two finished games, each from both sides.
//
//   pnpm fixtures odds
//
// - GSW 119–114 @ MIN, 2026-10-28 (ESPN 401909888; Polymarket
//   `nba-gsw-min-2026-10-28`): the day's NBA listing (with its sub-events,
//   which the match must skip), the moneyline by slug, the Warriors token's
//   history, and ESPN's summary (win probability, plays, DraftKings).
// - Aston Villa 2–1 Manchester City, 2026-10-24 (ESPN 401879256, the
//   `?demo` harness's live soccer match; Polymarket `epl-ast-mac-2026-10-24`):
//   the day's Premier League listing, the event's three moneyline markets,
//   their Yes tokens' histories, and ESPN's summary (commentary, DraftKings).
//
// The socket's messages (pm-socket-messages.json) were captured from the CLOB
// market channel on 2026-10-29 and trimmed by hand (each book cut to its best
// three levels): the channel only talks about markets that are trading.

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures", "odds");
const UA = "Scoreline/1.0 (web fixtures; +https://github.com/lame-o/scoreline)";
const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";
const ESPN = "https://site.api.espn.com/apis/site/v2/sports";

async function get(url) {
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function save(name, data, source) {
  await mkdir(out, { recursive: true });
  const body = { _source: source, _recorded: new Date().toISOString(), ...data };
  await writeFile(join(out, name), JSON.stringify(body) + "\n");
  console.log(`odds/${name}  ${(JSON.stringify(body).length / 1024).toFixed(1)} KB`);
}

const pick = (obj, keys) => (obj == null ? obj : Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]])));
const unix = (iso) => Math.floor(Date.parse(iso) / 1000);

const trimListing = (rows) => rows.map((e) => ({ ...pick(e, ["id", "slug", "title", "startTime"]), teams: e.teams?.map((t) => pick(t, ["name", "alias", "abbreviation", "ordering"])) }));
const trimMarket = (m) => ({ ...pick(m, ["slug", "question", "sportsMarketType", "outcomes", "clobTokenIds", "groupItemTitle", "volume"]), events: m.events?.map((e) => pick(e, ["slug"])) });

function trimSummary(s, sport) {
  const competition = s.header?.competitions?.[0] ?? {};
  // Baseball names a half (period.type) and keeps at-bat results apart from pitches (type.type); the NBA's
  // scrub names notable plays only (type.id, scoreValue: basketball.ts `isNotable`).
  const baseball = sport === "baseball";
  const basketball = sport === "basketball";
  const play = (p) => ({
    ...pick(p, ["id", "wallclock", "text", ...(basketball ? ["scoreValue"] : [])]),
    period: pick(p.period, baseball ? ["number", "type"] : ["number"]),
    clock: pick(p.clock, ["displayValue"]),
    ...(baseball ? { type: pick(p.type, ["type"]) } : basketball ? { type: pick(p.type, ["id"]) } : {}),
  });
  return {
    header: {
      id: s.header?.id,
      competitions: [{ date: competition.date, competitors: competition.competitors?.map((c) => ({ ...pick(c, ["id", "homeAway"]), team: pick(c.team, ["id", "abbreviation", "shortDisplayName", "name", "displayName", "location"]) })) }],
    },
    pickcenter: s.pickcenter?.map((p) => ({ provider: pick(p.provider, ["id", "name"]), awayTeamOdds: pick(p.awayTeamOdds, ["moneyLine"]), homeTeamOdds: pick(p.homeTeamOdds, ["moneyLine"]), drawOdds: pick(p.drawOdds, ["moneyLine"]) })),
    winprobability: s.winprobability?.map((w) => pick(w, ["homeWinPercentage", "tiePercentage", "playId"])),
    ...(sport === "soccer" ? { commentary: s.commentary?.map((c) => ({ text: c.text, play: c.play ? play(c.play) : undefined })) } : { plays: s.plays?.map(play) }),
  };
}

async function game({ name, sport, path, espnID, series, date, slug, from, to, threeWay }) {
  const listing = await get(`${GAMMA}/events?series_id=${series}&event_date=${date}&include_markets=false&limit=100`);
  await save(`pm-${name}-listing.json`, { events: trimListing(listing) }, `${GAMMA}/events?series_id=${series}&event_date=${date}&include_markets=false&limit=100`);

  let tokens;
  if (threeWay) {
    const event = await get(`${GAMMA}/events/slug/${slug}`);
    const markets = event.markets.filter((m) => m.sportsMarketType === "moneyline");
    await save(`pm-${name}-event.json`, { ...pick(event, ["id", "slug", "title", "startTime"]), markets: markets.map(trimMarket) }, `${GAMMA}/events/slug/${slug}`);
    tokens = markets.map((m) => JSON.parse(m.clobTokenIds)[JSON.parse(m.outcomes).indexOf("Yes")]);
  } else {
    const market = await get(`${GAMMA}/markets/slug/${slug}`);
    await save(`pm-${name}-market.json`, trimMarket(market), `${GAMMA}/markets/slug/${slug}`);
    tokens = [JSON.parse(market.clobTokenIds)[0]];
  }

  const histories = {};
  for (const token of tokens) {
    const h = await get(`${CLOB}/prices-history?market=${token}&startTs=${unix(from)}&endTs=${unix(to)}&fidelity=1`);
    histories[token] = { history: h.history };
  }
  await save(`pm-${name}-history.json`, { histories }, `${CLOB}/prices-history?market=<token>&startTs=${unix(from)}&endTs=${unix(to)}&fidelity=1`);

  const summary = await get(`${ESPN}/${path}/summary?event=${espnID}`);
  await save(`espn-${name}-summary.json`, trimSummary(summary, sport), `${ESPN}/${path}/summary?event=${espnID}`);
}

export async function recordOdds() {
  await game({ name: "nba-gsw-min", sport: "basketball", path: "basketball/nba", espnID: "401909888", series: 10345, date: "2026-10-28", slug: "nba-gsw-min-2026-10-28", from: "2026-10-28T23:30:00Z", to: "2026-10-29T03:00:00Z" });
  await game({ name: "epl-ast-mac", sport: "soccer", path: "soccer/eng.1", espnID: "401879256", series: 10188, date: "2026-10-24", slug: "epl-ast-mac-2026-10-24", from: "2026-10-24T11:00:00Z", to: "2026-10-24T13:40:00Z", threeWay: true });
}

if (import.meta.url === `file://${process.argv[1]}`) await recordOdds();
