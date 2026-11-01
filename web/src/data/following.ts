import { competitors, type ScoreEvent } from "./models";
import type { ListPreferences } from "./scoreboard";

/** An individual edition, never a subscription to every event in its sport. */
export interface EditionFollow { readonly source: "cs2" | "ifsc"; readonly key: string; readonly name: string }
export const editionID = (e: EditionFollow) => `${e.source}:${e.key}`;
export function sanitizeEditions(raw: unknown): EditionFollow[] {
  if (!Array.isArray(raw)) return [];
  const out = new Map<string, EditionFollow>();
  for (const e of raw) {
    if (!e || typeof e !== "object" || typeof e.name !== "string" || !e.name.trim() || typeof e.key !== "string") continue;
    if (e.source === "cs2" ? !/^[a-z0-9][a-z0-9-]{0,199}$/.test(e.key) : e.source !== "ifsc" || !/^[1-9][0-9]{0,9}$/.test(e.key)) continue;
    const item = {source:e.source, key:e.key, name:e.name.slice(0,200)} as EditionFollow;
    out.set(editionID(item), item);
  }
  return [...out.values()];
}
export function matchesEdition(event: ScoreEvent, edition: EditionFollow): boolean {
  return edition.source === "cs2" ? event.ref?.kind === "counterStrike" && event.ref.tournament === edition.key
    : event.ref?.kind === "climbing" && String(event.ref.eventID) === edition.key;
}
export function followedEdition(event: ScoreEvent, prefs: Pick<ListPreferences, "editions">): boolean {
  return (prefs.editions ?? []).some(e => matchesEdition(event, e));
}
export function pollingIDs(prefs: ListPreferences): string[] {
  const ids = [...prefs.enabledLeagues, ...(prefs.editions ?? []).map(e => e.source)];
  // Team follows are independent of competition follows. Poll their home boards as well.
  for (const team of prefs.followed) {
    const id = team.id.startsWith("cs-") ? "cs2" : team.id.startsWith("espn-ncaaf-") ? "college-football" : team.id.startsWith("espn-football-") ? "nfl" : team.id.startsWith("espn-baseball-") ? "mlb" : team.id.startsWith("espn-wnba-") ? "wnba" : team.id.startsWith("espn-basketball-") ? "nba" : null;
    if (id) ids.push(id);
  }
  return [...new Set(ids)];
}
export function alertsFor(event: ScoreEvent, prefs: ListPreferences & {notifyFollowed: boolean; mutedTeams: readonly string[]}): boolean {
  return prefs.notifyFollowed && competitors(event).some(c => c.id != null && prefs.followed.some(t => t.id === c.id) && !prefs.mutedTeams.includes(c.id));
}
export function inclusionReasons(event: ScoreEvent, prefs: ListPreferences): string[] {
  const reasons = prefs.followed.filter(t => competitors(event).some(c => c.id === t.id)).map(t => `Following ${t.name} · All competitions`);
  reasons.push(...(prefs.editions ?? []).filter(e => matchesEdition(event,e)).map(e => `Following ${e.name}`));
  return reasons;
}
