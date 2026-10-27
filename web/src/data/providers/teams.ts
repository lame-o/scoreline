/**
 * The teams (or, for climbing, the countries) a league can be filtered to
 * and followed from (Teams.swift `TeamCatalog.options`). IDs use the same
 * format as `Competitor.id`, so picks match events directly.
 *
 * - ESPN leagues: the league's team list, alphabetical.
 * - College football: the FBS teams the scoreboard covers, from the
 *   conference standings (the team list mixes in 600 teams from every
 *   division), by conference, Power Four first.
 * - CS2: bo3.gg's world ranking, top 60 (it tracks thousands of teams).
 * - Climbing: the climbing nations, by name as a reader sorts them.
 */
import { arr, at, int, str, type JSONValue } from "../json";
import type { Fetcher } from "../http";
import type { League } from "../models";
import { CLIMBING_NATIONS, espnTeamID, flagFromIOC } from "../teams";
import { ESPN_SITE } from "./espn";

export interface TeamOption {
  readonly id: string;
  readonly name: string;
  readonly logo: string | null;
  /** Country flag, for climbing nations. */
  readonly flag: string | null;
  /** The natural group it's listed under (a college conference). */
  readonly group: string | null;
}

/** The Power Four, in the order they're usually listed (ESPN's short names). */
export const POWER_FOUR = ["SEC", "Big Ten", "ACC", "Big 12"] as const;

export async function teamOptions(league: League, fetcher: Fetcher, signal?: AbortSignal): Promise<TeamOption[]> {
  switch (league.source.kind) {
    case "espn": {
      const path = league.source.path;
      if (path.endsWith("college-football")) {
        return collegeOptions(await fetcher(`https://site.api.espn.com/apis/v2/sports/${path}/standings`, { signal }), path);
      }
      return espnOptions(await fetcher(`${ESPN_SITE}/${path}/teams?limit=1000`, { signal }), path, league);
    }
    case "counterStrike":
      return counterStrikeOptions(await fetcher(BO3_TEAMS, { signal }));
    case "ifsc":
      return climbingOptions();
  }
}

const BO3_TEAMS = "https://api.bo3.gg/api/v1/teams?filter%5Bteams.discipline_id%5D%5Beq%5D=1&sort=rank&page%5Blimit%5D=60";

const byName = (a: TeamOption, b: TeamOption) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });

export function espnOptions(json: JSONValue, path: string, league: League): TeamOption[] {
  return arr(at(json, "sports", 0, "leagues", 0, "teams"))
    .flatMap((entry): TeamOption[] => {
      const team = at(entry, "team");
      const id = str(at(team, "id"));
      const name = str(at(team, "displayName"));
      if (!id || !name) return [];
      return [{ id: espnTeamID(path, league.sport, id), name, logo: str(at(team, "logos", 0, "href")) ?? null, flag: null, group: null }];
    })
    .sort(byName);
}

/** College teams by conference (a division's teams under their conference), Power Four first, alphabetical within. */
export function collegeOptions(json: JSONValue, path: string): TeamOption[] {
  const options: TeamOption[] = [];
  const add = (table: JSONValue, group: string) => {
    for (const e of arr(at(table, "standings", "entries"))) {
      const team = at(e, "team");
      const id = str(at(team, "id"));
      if (!id) continue;
      const name = str(at(team, "location")) ?? str(at(team, "shortDisplayName")) ?? str(at(team, "displayName")) ?? "";
      options.push({ id: espnTeamID(path, "football", id), name, logo: str(at(team, "logos", 0, "href")) ?? null, flag: null, group });
    }
  };
  for (const conference of arr(at(json, "children"))) {
    const name = str(at(conference, "shortName")) ?? str(at(conference, "name")) ?? "";
    const divisions = arr(at(conference, "children"));
    if (divisions.length === 0) add(conference, name);
    else for (const division of divisions) add(division, name);
  }
  const seen = new Set<string>();
  const unique = options.flatMap((o) => (o.group && !seen.has(o.group) ? (seen.add(o.group), [o.group]) : []));
  const order = [...POWER_FOUR.filter((p) => unique.includes(p)), ...unique.filter((g) => !(POWER_FOUR as readonly string[]).includes(g))];
  const rank = new Map(order.map((g, i) => [g, i]));
  return options
    .map((o, i) => ({ o, i }))
    .sort((a, b) => (rank.get(a.o.group ?? "") ?? Infinity) - (rank.get(b.o.group ?? "") ?? Infinity) || byName(a.o, b.o) || a.i - b.i)
    .map(({ o }) => o);
}

export function counterStrikeOptions(json: JSONValue): TeamOption[] {
  return arr(at(json, "results")).flatMap((t): TeamOption[] => {
    const id = int(at(t, "id"));
    const name = str(at(t, "name"));
    return id != null && name ? [{ id: `cs-${id}`, name, logo: str(at(t, "image_url")) ?? null, flag: null, group: null }] : [];
  });
}

export function climbingOptions(): TeamOption[] {
  return CLIMBING_NATIONS.map((n) => ({ id: `country-${n.code}`, name: n.name, logo: null, flag: flagFromIOC(n.code), group: null })).sort(byName);
}
