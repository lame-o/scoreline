/**
 * Soccer photos, injuries and the current coach from FotMob, matched onto
 * ESPN's squads (FotMob.swift). ESPN has photos for about 1 in 20 soccer
 * players, lists no soccer injuries, and its "coach" field is a list of past
 * managers; FotMob has all three.
 *
 * FotMob is an unofficial source (a keyless web API, like ESPN's), so this is
 * enrichment only: it runs after the page has its ESPN data, never blocks it,
 * is cached (the search for 30 days at the edge, the squad for 12 hours), and
 * any failure (a changed payload, a 404, no confident match) leaves ESPN's
 * data and the monogram exactly as they were. A player is matched only when
 * the match is unambiguous (`matchMember`).
 */
import type { RosterPlayer } from "./models";
import { fotMobPhoto } from "./photos";
import { arr, at, exists, i, sAt, type JSONValue } from "./read";

const BASE = "https://www.fotmob.com/api/data";

/** FotMob's league IDs for the domestic leagues ESPN files teams under. */
export const FOTMOB_LEAGUES: Readonly<Record<string, number>> = { "eng.1": 47, "esp.1": 87, "ger.1": 54, "ita.1": 55, "fra.1": 53, "eng.2": 48, "usa.1": 130 };

/** Team search: 0.5 KB, gives the team ID with its league. */
export function searchURL(team: string): string {
  const url = new URL(`${BASE}/search/suggest`);
  url.searchParams.set("term", team);
  url.searchParams.set("lang", "en");
  return url.href;
}

/** The team page (≈90 KB; the squad is a small part of it). */
export const fotMobTeamURL = (id: number) => `${BASE}/teams?id=${id}`;

/** Lowercased tokens with accents and punctuation removed, so "Martin Ødegaard" and "Martin Odegaard", or "O’Neill" and "O'Neill", compare equal. */
export function tokens(name: string): string[] {
  const special: Record<string, string> = { ø: "o", Ø: "o", æ: "ae", Æ: "ae", ß: "ss", đ: "d", Đ: "d", ł: "l", Ł: "l", ı: "i", œ: "oe", Œ: "oe", þ: "th" };
  const mapped = [...name].map((c) => special[c] ?? c).join("");
  const folded = mapped.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  return folded
    .split(/[ -]/)
    .map((t) => t.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((t) => t.length > 0);
}

/** The team among the search suggestions: same league first, then the exact name. */
export function parseTeamID(json: JSONValue, name: string, league: string | null): number | null {
  const teams = arr(json)
    .flatMap((group) => [...arr(at(group, "suggestions"))])
    .filter((t) => sAt(t, "type") === "team");
  const wanted = league ? FOTMOB_LEAGUES[league] : undefined;
  if (wanted != null) {
    const t = teams.find((x) => i(at(x, "leagueId")) === wanted);
    if (t) return i(at(t, "id"));
  }
  const key = tokens(name).join(" ");
  const exact = teams.find((x) => tokens(sAt(x, "name") ?? "").join(" ") === key);
  return exact ? i(at(exact, "id")) : null;
}

export interface FotMobMember {
  readonly id: number;
  readonly name: string;
  readonly shirt: number | null;
  /** "Late November 2026", "Doubtful"; null when fit. */
  readonly injury: string | null;
}

export interface FotMobSquad {
  readonly members: readonly FotMobMember[];
  readonly coach: string | null;
}

export function parseSquad(json: JSONValue): FotMobSquad | null {
  const groups = arr(at(json, "squad", "squad"));
  if (groups.length === 0) return null;
  const members: FotMobMember[] = [];
  let coach: string | null = null;
  for (const group of groups) {
    const isCoach = sAt(group, "title") === "coach";
    for (const m of arr(at(group, "members"))) {
      const id = i(at(m, "id"));
      const name = sAt(m, "name");
      if (id == null || !name) continue;
      if (isCoach) {
        coach = coach ?? name;
        continue;
      }
      const injured = exists(at(m, "injury"));
      members.push({ id, name, shirt: i(at(m, "shirtNumber")), injury: injured ? (sAt(m, "injury", "expectedReturn") ?? "Injured") : null });
    }
  }
  return { members, coach };
}

/**
 * The squad member who is this ESPN player, or null unless the match is unambiguous:
 * - the same name (accents and punctuation aside), or the same names in another order;
 * - the same shirt number and a shared name ("Gabriel" #6 is "Gabriel Magalhães" #6);
 * - the same surname with a compatible first initial, when only one member qualifies.
 * Two members tied at the best score below a shirt-number match means no match.
 */
export function matchMember(name: string, jersey: string | null, members: readonly FotMobMember[]): FotMobMember | null {
  const target = tokens(name);
  if (target.length === 0) return null;
  const shirtN = jersey != null && /^\d+$/.test(jersey) ? Number(jersey) : null;
  const targetSet = new Set(target);
  const sameSet = (a: string[]) => a.length > 0 && new Set(a).size === targetSet.size && a.every((t) => targetSet.has(t));
  const shares = (a: string[]) => a.some((t) => targetSet.has(t));
  const scored: [FotMobMember, number][] = [];
  for (const m of members) {
    const t = tokens(m.name);
    if (t.length === 0) continue;
    let score: number;
    if (t.length === target.length && t.every((x, k) => x === target[k])) score = 100;
    else if (sameSet(t)) score = 95;
    else if (shirtN != null && m.shirt === shirtN && shares(t)) score = 90;
    else if (t.at(-1) === target.at(-1) && t.length > 1 && target.length > 1 && t[0]?.[0] === target[0]?.[0]) score = 70;
    // A one-word name ("Gabriel") without shirt numbers to confirm it: weak.
    else if ((t.length === 1 || target.length === 1) && shares(t) && (shirtN == null || m.shirt == null)) score = 60;
    else continue;
    scored.push([m, score]);
  }
  let best: [FotMobMember, number] | null = null;
  for (const entry of scored) if (!best || entry[1] > best[1]) best = entry;
  if (!best || best[1] < 70) return null;
  if (best[1] < 90 && scored.filter((x) => x[1] === best[1]).length > 1) return null;
  return best[0];
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** FotMob's injury, as the pages show one: "Doubtful", or "Out" with the expected return. */
export function memberInjury(m: FotMobMember): { status: string; detail: string | null } | null {
  const text = m.injury;
  if (!text) return null;
  if (text.toLowerCase().includes("doubtful")) return { status: "Doubtful", detail: null };
  // "Late November 2026" → "Expected back late November".
  const words = text.split(" ").filter((w) => w.length > 0 && !/^\d+$/.test(w));
  let back: string | null = null;
  if (words.length > 0) {
    back = `Expected back ${words.join(" ").toLowerCase()}`;
    for (const month of MONTHS) back = back.replaceAll(month.toLowerCase(), month);
  }
  return { status: "Out", detail: text === "Injured" ? null : back };
}

/** "late November" → "late Nov". */
export function shortMonths(text: string): string {
  const months: Record<string, string> = { January: "Jan", February: "Feb", March: "Mar", April: "Apr", August: "Aug", September: "Sep", October: "Oct", November: "Nov", December: "Dec" };
  return Object.entries(months).reduce((t, [long, short]) => t.replaceAll(long, short), text);
}

/**
 * FotMob's photos (where ESPN has none), injuries (ESPN lists none for soccer)
 * matched player by player; unmatched players keep their monograms.
 */
export function applySquad(players: readonly RosterPlayer[], squad: FotMobSquad): readonly RosterPlayer[] {
  let changed = false;
  const next = players.map((p) => {
    const m = matchMember(p.ref.name, p.jersey, squad.members);
    if (!m) return p;
    changed = true;
    // FotMob's face crops for everyone matched, so the squad reads as one set (ESPN has a few, framed differently).
    let player: RosterPlayer = { ...p, ref: { ...p.ref, photo: fotMobPhoto(m.id) } };
    const injury = p.injury == null ? memberInjury(m) : null;
    if (injury) player = { ...player, injury: injury.status, injuryReturn: injury.detail?.replace("Expected back ", "") ?? null };
    return player;
  });
  return changed ? next : players;
}
