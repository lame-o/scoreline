/**
 * CS2 co-streams (CoStream.swift, ScoreStore.updateCoStream and
 * noteStreams): ScorelineTests.swift's "Matching" checks, check by check,
 * then decapi.me's plain-text answers (as recorded for ohnepixel, Nov 2026)
 * and the store's rule that bo3.gg's listing is definitive until the match
 * ends.
 */
import { afterEach, describe, expect, it } from "vitest";
import { coStreamAvatar, coStreamHandle, coStreamMatches, coStreamStatus, containsWord, tournamentKeywords, type CoStreamStatus } from "../../src/data/coStream";
import type { TextFetcher } from "../../src/data/http";
import type { Competitor, ScoreEvent } from "../../src/data/models";
import { streams } from "../../src/state/streams";

function comp(id: string, name: string): Competitor {
  return { id, name, abbreviation: name.slice(0, 3).toUpperCase(), score: "0", logo: null, isWinner: false, color: null, rank: null, record: null, conferenceRecord: null, alternateColor: null };
}

function m(a: string, b: string, tournament: string): ScoreEvent {
  return {
    id: `${a}-${b}`,
    content: { kind: "match", top: comp("1", a), bottom: comp("2", b) },
    state: "live",
    start: Date.now(),
    detail: null,
    caption: null,
    link: null,
    ref: { kind: "counterStrike", slug: "x", tournament },
    stage: null,
    clock: null,
    possession: null,
    liveLine: null,
    liveLineRoutine: false,
    broadcast: null,
    venue: null,
    snapshot: null,
  };
}

describe("which live matches the title points at (CoStream.matches)", () => {
  const live = [m("Natus Vincere", "G2", "PGL Masters Bucharest 2026"), m("FaZe", "Spirit", "ESL Pro League Season 22")];
  const match = (title: string, game = "Counter-Strike") => [...coStreamMatches({ live: true, title, game }, live)];

  it("finds a team named in the title", () => {
    expect(match("NAVI VS G2 MAJOR WATCHPARTY")).toEqual(["Natus Vincere-G2"]);
  });

  it("else a tournament keyword", () => {
    expect(match("PRO LEAGUE COSTREAM")).toEqual(["FaZe-Spirit"]);
    expect(tournamentKeywords(live[1]!)).toEqual(["esl", "pro"]);
    expect(tournamentKeywords(m("A", "B", "PGL Major Singapore 2026"))).toContain("major");
  });

  it("matches whole words only", () => {
    expect(match("FAZED and confused")).toEqual([]);
    expect(containsWord("g2a sponsor", "g2")).toBe(false);
    expect(containsWord("vs g2!", "g2")).toBe(true);
    expect(containsWord("x", "x")).toBe(false);
  });

  it("ignores a stream in another category, or offline", () => {
    expect(match("GOLD GOLD GOLD", "Just Chatting")).toEqual([]);
    expect([...coStreamMatches({ live: false, title: "NAVI VS G2", game: "Counter-Strike" }, live)]).toEqual([]);
  });

  it("takes a generic watch party only when one match is live", () => {
    const one = [live[0]!];
    expect([...coStreamMatches({ live: true, title: "watchparty with chat", game: "Counter-Strike 2" }, one)]).toEqual(["Natus Vincere-G2"]);
    expect(match("watchparty with chat")).toEqual([]);
  });
});

describe("decapi.me's plain-text answers", () => {
  const answers: Record<string, string> = {
    "https://decapi.me/twitch/uptime/ohnepixel": "ohnepixel is offline\n",
    "https://decapi.me/twitch/title/ohnepixel": "🔴REVISITING CLASH OF CLANS AFTER 10 YEARS #AD🔴\n",
    "https://decapi.me/twitch/game/ohnepixel": "Clash of Clans\n",
    "https://decapi.me/twitch/avatar/ohnepixel": "https://static-cdn.jtvnw.net/jtv_user_pictures/5742b015-e6ed-4f7c-a1dd-87cd88fe1eb9-profile_image-300x300.png\n",
  };
  const get: TextFetcher = async (url) => {
    const answer = answers[url];
    if (answer == null) throw new Error(`404 ${url}`);
    return answer;
  };

  it("reads offline from the uptime, and the title and game as said (recorded, Nov 2026)", async () => {
    const status = (await coStreamStatus("ohnepixel", get)) as CoStreamStatus;
    expect(status).toEqual({ live: false, title: "🔴REVISITING CLASH OF CLANS AFTER 10 YEARS #AD🔴", game: "Clash of Clans" });
    const live = await coStreamStatus("ohnepixel", async (url) => (url.includes("/uptime/") ? "2 hours, 3 minutes" : get(url)));
    expect(live?.live).toBe(true);
  });

  it("gives no status without the uptime, and no avatar that isn't a URL", async () => {
    expect(await coStreamStatus("someone", get)).toBeNull();
    expect(await coStreamAvatar("ohnepixel", get)).toMatch(/^https:\/\/static-cdn\.jtvnw\.net\//);
    expect(await coStreamAvatar("ohnepixel", async () => "User not found: ohnepixel")).toBeNull();
  });

  it("asks only for a Twitch login", () => {
    expect(coStreamHandle(" OhnePixel ")).toBe("ohnepixel");
    expect(coStreamHandle("not a handle!")).toBeNull();
    expect(coStreamHandle("")).toBeNull();
  });
});

describe("the co-stream marks (ScoreStore.coStreamingIDs)", () => {
  afterEach(() => streams.clearCoStream());

  it("keeps a bo3.gg-confirmed match until it ends, whatever the title says", () => {
    const liveIDs = new Set(["a", "b"]);
    streams.confirm("ohnepixel", "a");
    expect(streams.get().coStreaming.has("a")).toBe(true);
    streams.setCoStream("ohnepixel", new Set(["b"]), liveIDs, null);
    expect([...streams.get().coStreaming].sort()).toEqual(["a", "b"]);
    // The match ends: it leaves the marks, and the confirmation with it.
    streams.setCoStream("ohnepixel", new Set(), new Set(["b"]), null);
    expect([...streams.get().coStreaming]).toEqual([]);
    streams.setCoStream("ohnepixel", new Set(), liveIDs, null);
    expect([...streams.get().coStreaming]).toEqual([]);
  });

  it("forgets confirmations when the channel changes", () => {
    streams.confirm("ohnepixel", "a");
    streams.setCoStream("somebody", new Set(), new Set(["a"]), null);
    expect(streams.get().coStreaming.has("a")).toBe(false);
  });
});
