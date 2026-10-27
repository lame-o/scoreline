/**
 * Climbers' pages from the IFSC results service (ProfileProviders.swift
 * `IFSCProfiles`): bio, World Cup and World Championship podiums, every
 * result, this season's World Cup ranks and the speed personal best. The
 * Worker adds the `Referer` the service requires.
 */
import { ordinal } from "../format";
import { countryName } from "../teams";
import { emptyBio, podiumTotal, properCase, EMPTY_PROFILE, type Bio, type ClimbResult, type PlayerProfile, type Podium, type StatTile } from "./models";
import { arr, at, capitalized, i, parseDate, sAt, type JSONValue } from "./read";

const BASE = "https://ifsc.results.info/api/v1";

export const athleteURL = (id: string) => `${BASE}/athletes/${id}`;

export function discipline(kind: string): string {
  switch (kind) {
    case "boulder&lead":
      return "Boulder & Lead";
    case "speed_relay":
      return "Speed Relay";
    default:
      return capitalized(kind);
  }
}

/**
 * "World Climbing Series Santiago 2026" → "Santiago 2026"; "IFSC Climbing
 * World Championships Seoul 2025" → "Worlds Seoul 2025"; "Europe -
 * Continental Championships Munich 2022" → "Europeans Munich 2022".
 */
export function shortEvent(name: string): string {
  let t = name.trim();
  while (t.startsWith("-")) t = t.slice(1).trim();
  const renames: [string, string][] = [
    ["IFSC Climbing World Championships ", "Worlds "], ["Climbing World Championships ", "Worlds "], ["World Climbing Championships ", "Worlds "],
    ["World Climbing Championship ", "Worlds "], ["IFSC World Championships ", "Worlds "], ["Europe - Continental Championships ", "Europeans "],
    ["IFSC European Championships ", "Europeans "],
  ];
  for (const [from, to] of renames) if (t.startsWith(from)) t = to + t.slice(from.length);
  for (const prefix of ["IFSC Climbing World Cup ", "IFSC World Cup ", "World Climbing Series ", "Climbing World Cup (L) - ", "Climbing World Cup (B) - ",
    "Climbing World Cup (S) - ", "Climbing World Cup ", "IFSC "]) {
    if (t.startsWith(prefix)) t = t.slice(prefix.length);
  }
  // "Kranj (SLO) 2021" → "Kranj 2021".
  t = t.replace(/ \(([^)]{3})\)/, "");
  return t;
}

export interface ClimberData {
  readonly bio: Bio;
  readonly profile: PlayerProfile;
}

export function parseAthlete(json: JSONValue, now = Date.now()): ClimberData | null {
  const first = sAt(json, "firstname");
  const last = sAt(json, "lastname");
  if (first == null || last == null) return null;
  const country = sAt(json, "country");
  const id = i(at(json, "id"));
  const height = i(at(json, "height"));
  const bio: Bio = {
    ...emptyBio(`${first} ${properCase(last)}`),
    photo: sAt(json, "photo_url"),
    birthDate: parseDate(sAt(json, "birthday")),
    age: i(at(json, "age")),
    height: height != null ? `${height} cm` : null,
    armSpan: i(at(json, "arm_span")),
    hometown: sAt(json, "city"),
    country,
    nationality: country ? countryName(country) : null,
    federation: sAt(json, "federation", "name"),
    link: id != null ? `https://ifsc.results.info/athlete/${id}` : null,
  };
  const podiums = (value: JSONValue): Podium[] =>
    arr(value).flatMap((p) => {
      const kind = sAt(p, "discipline_kind");
      if (!kind) return [];
      const pod = { discipline: discipline(kind), gold: i(at(p, "1")) ?? 0, silver: i(at(p, "2")) ?? 0, bronze: i(at(p, "3")) ?? 0 };
      return podiumTotal(pod) > 0 ? [pod] : [];
    });
  const all = arr(at(json, "all_results"));
  const results: ClimbResult[] = all.flatMap((r) => {
    const season = sAt(r, "season");
    const event = sAt(r, "event_name");
    if (!season || !event) return [];
    return [{
      season,
      rank: i(at(r, "rank")),
      discipline: discipline(sAt(r, "discipline") ?? ""),
      event: shortEvent(event),
      date: parseDate(sAt(r, "date")),
      category: sAt(r, "category_name"),
    }];
  });
  // This season's World Cup ranks (never follow their result URLs: stale category IDs).
  const tiles: StatTile[] = [];
  const latest = arr(at(json, "cup_rankings")).at(-1);
  const season = sAt(latest, "season");
  const currentYear = new Date(now).getFullYear();
  if (latest != null && season && (Number(season) || 0) >= currentYear - 1) {
    for (const kind of ["lead", "boulder", "speed", "combined", "boulder&lead"]) {
      const rank = i(at(latest, kind, "rank"));
      if (rank != null) tiles.push({ label: discipline(kind).toUpperCase(), value: ordinal(rank), rank: `World Cup ${season}` });
    }
  }
  const pb = at(json, "speed_personal_best");
  const time = sAt(pb, "time");
  let speedBest: string | null = null;
  if (time) {
    const pbEvent = sAt(pb, "event_name");
    speedBest = [`${time} s`, pbEvent ? shortEvent(pbEvent) : null, sAt(pb, "round_name")].filter(Boolean).join(" · ");
    tiles.push({ label: "SPEED PB", value: time, rank: null });
  }
  return {
    bio,
    profile: {
      ...EMPTY_PROFILE,
      bio,
      tiles,
      podiums: podiums(at(json, "discipline_podiums")),
      worldChampionships: podiums(at(json, "world_championships_discipline_podiums")),
      results,
      resultCount: all.length,
      speedBest,
    },
  };
}
