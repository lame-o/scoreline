/**
 * Broadcasters as ESPN lists them, spelled out, with their official watch
 * pages (Broadcasters.swift). Unknown broadcasters keep their name and get no
 * link. Never link unofficial streams.
 */

export type BroadcasterKind = "tv" | "streaming" | "subscription" | "radio";

export interface Broadcaster {
  readonly name: string;
  readonly kind: BroadcasterKind;
  readonly url: string | null;
}

/** ESPN's abbreviations, spelled out. */
const DISPLAY_NAMES: Readonly<Record<string, string>> = {
  "USA Net": "USA Network",
  "NFL Net": "NFL Network",
  "MLB Net": "MLB Network",
  "NBA TV": "NBA TV",
  CBSSN: "CBS Sports Network",
  FS1: "FS1",
  FS2: "FS2",
  "ESPN+": "ESPN+",
  Fox: "FOX",
  Tele: "Telemundo",
  ERADM: "ESPN Radio",
  "ESPN Radio": "ESPN Radio",
  SiriusXM: "SiriusXM",
};

/** Official watch pages. */
const WATCH_PAGES: Readonly<Record<string, string>> = {
  Peacock: "https://www.peacocktv.com/sports",
  NBC: "https://www.nbcsports.com/watch",
  NBCSN: "https://www.nbcsports.com/watch",
  "USA Net": "https://www.usanetwork.com/live",
  "USA Network": "https://www.usanetwork.com/live",
  Telemundo: "https://www.telemundo.com/deportes",
  Tele: "https://www.telemundo.com/deportes",
  Universo: "https://www.telemundo.com/deportes",
  "Paramount+": "https://www.paramountplus.com/live-tv/",
  CBS: "https://www.cbssports.com/watch/",
  CBSSN: "https://www.cbssports.com/watch/",
  Fox: "https://www.foxsports.com/live",
  FOX: "https://www.foxsports.com/live",
  FS1: "https://www.foxsports.com/live",
  FS2: "https://www.foxsports.com/live",
  "Fox Deportes": "https://www.foxsports.com/live",
  ESPN: "https://www.espn.com/watch/",
  ESPN2: "https://www.espn.com/watch/",
  ESPNU: "https://www.espn.com/watch/",
  "ESPN+": "https://www.espn.com/watch/",
  "ESPN Deportes": "https://www.espn.com/watch/",
  ABC: "https://www.espn.com/watch/",
  "NFL Net": "https://www.nfl.com/network/watch/nfl-network-live",
  "NFL+": "https://www.nfl.com/plus/",
  "Prime Video": "https://www.amazon.com/primevideo",
  "Apple TV": "https://tv.apple.com",
  "Apple TV+": "https://tv.apple.com",
  "MLS Season Pass": "https://tv.apple.com",
  Netflix: "https://www.netflix.com",
  TNT: "https://www.tntdrama.com/watchtnt",
  TBS: "https://www.tbs.com/watchtbs",
  truTV: "https://www.trutv.com/watchtrutv",
  Max: "https://www.max.com",
  "HBO Max": "https://www.max.com",
  "NBA League Pass": "https://www.nba.com/watch/league-pass-stream",
  "NBA TV": "https://www.nba.com/watch",
  "MLB.TV": "https://www.mlb.com/tv",
  "MLB Net": "https://www.mlb.com/network",
  DAZN: "https://www.dazn.com",
  Fubo: "https://www.fubo.tv",
  fuboTV: "https://www.fubo.tv",
};

export function broadcaster(name: string, type: string | null = null): Broadcaster {
  const t = (type ?? "").toLowerCase();
  const kind: BroadcasterKind = t.includes("radio")
    ? "radio"
    : t.includes("stream")
      ? "streaming"
      : t.includes("subscription")
        ? "subscription"
        : "tv";
  return { name: DISPLAY_NAMES[name] ?? name, kind, url: WATCH_PAGES[name] ?? null };
}
