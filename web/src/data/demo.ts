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
    const comps = (e.competitions as { competitors: { score: string }[] }[])[0]!.competitors;
    const bump = path.includes("basketball") ? 2 : path.includes("football") ? 7 : 1;
    const [first, second] = comps;
    if (first) first.score = String(Number(first.score) + bump * Math.floor(n / 2));
    if (second) second.score = String(Number(second.score) + bump * Math.floor((n + 1) / 2));
  }
  return board;
}

const demo: Fetcher = async (url) => {
  const u = new URL(url);
  const path = u.pathname;
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
  // Tables and polls: recorded, so live games re-rank them (features/standings).
  if (u.host === "site.api.espn.com" && path.endsWith("/standings")) {
    if (path.includes("soccer/eng.1")) return fixture("standings-eng1.json");
    if (path.includes("basketball/nba")) return fixture("standings-nba.json");
    if (path.includes("college-football")) return fixture("standings-college.json");
  }
  if (u.host === "site.api.espn.com" && path.endsWith("/rankings")) return fixture("standings-rankings.json");
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
  const asked = new URLSearchParams(location.search).has("demo");
  if (asked) sessionStorage.setItem("scoreline.demo", "1");
  if (!asked && sessionStorage.getItem("scoreline.demo") !== "1") return false;
  setFetcherOverride(demo);
  return true;
}
