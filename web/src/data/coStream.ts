/**
 * Which live CS2 matches a streamer (ohnePixel by default) is co-streaming
 * (CoStream.swift). Two signals:
 *  1. bo3.gg lists the channel among a match's streams (definitive, seen when
 *     a match's detail page loads: `coStreamListed` in cs2.ts, `streams.confirm`).
 *  2. The channel is live on Twitch in Counter-Strike and its title names a
 *     team or the tournament of a live match (`coStreamMatches`).
 *
 * The Twitch status and avatar come keyless from decapi.me's plain-text
 * endpoints (the owner approved it), through the proxy.
 */
import type { TextFetcher } from "./http";
import { competitors, type ScoreEvent } from "./models";

export interface CoStreamStatus {
  readonly live: boolean;
  readonly title: string;
  readonly game: string;
}

const DECAPI = "https://decapi.me/twitch";

/** "ohnePixel" for the default, else the handle as typed (ScoreStore.coStreamerName). */
export const coStreamerName = (handle: string): string => (handle.trim().toLowerCase() === "ohnepixel" ? "ohnePixel" : handle.trim());

/** The channel on Twitch (ScoreStore.coStreamerURL), or null for anything that isn't a login. */
export const coStreamerURL = (handle: string): string | null => {
  const h = handle.trim().toLowerCase();
  return /^[a-z0-9_]{2,25}$/.test(h) ? `https://www.twitch.tv/${h}` : null;
};

/** A Twitch login as decapi.me takes it ("ohnepixel"), or null for anything else. */
export function coStreamHandle(typed: string): string | null {
  const h = typed.trim().toLowerCase();
  return /^[a-z0-9_]{1,25}$/.test(h) ? h : null;
}

/** Keyless Twitch status via decapi.me; null when the uptime can't be read (the title and game are best effort). */
export async function coStreamStatus(channel: string, get: TextFetcher, signal?: AbortSignal): Promise<CoStreamStatus | null> {
  const read = (endpoint: string) =>
    get(`${DECAPI}/${endpoint}/${channel}`, { signal }).then(
      (t) => t.trim(),
      () => null,
    );
  const [uptime, title, game] = await Promise.all([read("uptime"), read("title"), read("game")]);
  if (uptime == null) return null;
  return { live: !uptime.toLowerCase().includes("offline"), title: title ?? "", game: game ?? "" };
}

/** The channel's avatar (a Twitch CDN URL), or null. */
export async function coStreamAvatar(channel: string, get: TextFetcher, signal?: AbortSignal): Promise<string | null> {
  try {
    const text = (await get(`${DECAPI}/avatar/${channel}`, { signal })).trim();
    return text.startsWith("https://") ? text : null;
  } catch {
    return null;
  }
}

/** IDs of the live matches the stream title points at. */
export function coStreamMatches(status: CoStreamStatus, liveMatches: readonly ScoreEvent[]): Set<string> {
  if (!status.live || !status.game.toLowerCase().includes("counter-strike")) return new Set();
  const title = status.title.toLowerCase();

  // A team named in the title is the strongest signal.
  const byTeam = liveMatches.filter((event) => competitors(event).some((c) => [c.name, c.abbreviation].some((n) => containsWord(title, n.toLowerCase()))));
  if (byTeam.length > 0) return new Set(byTeam.map((e) => e.id));

  // Otherwise a tournament keyword ("Major", "IEM", "Cologne"…).
  const byTournament = liveMatches.filter((event) => tournamentKeywords(event).some((k) => containsWord(title, k)));
  if (byTournament.length > 0) return new Set(byTournament.map((e) => e.id));

  // A generic watch-party title with exactly one live match is unambiguous.
  const watchWords = ["watch", "watchparty", "costream", "co-stream", "co stream"];
  if (liveMatches.length === 1 && watchWords.some((w) => title.includes(w))) return new Set([liveMatches[0]!.id]);
  return new Set();
}

const GENERIC_WORDS = new Set(["season", "series", "stage", "group", "open", "online", "2025", "2026", "2027", "cup", "league"]);

export function tournamentKeywords(event: ScoreEvent): string[] {
  if (event.ref?.kind !== "counterStrike" || !event.ref.tournament) return [];
  const tournament = event.ref.tournament;
  const words = tournament.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const keywords = words.filter((w) => w.length >= 3 && !GENERIC_WORDS.has(w));
  if (tournament.toLowerCase().includes("major")) keywords.push("major");
  return keywords;
}

/** Whole-word match so "g2" doesn't fire on "g2a" and "faze" not on "fazed". */
export function containsWord(text: string, word: string): boolean {
  if (word.length < 2) return false;
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).test(text);
}
