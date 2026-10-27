/**
 * The CS2 match page's data (data/cs2.ts, GameDetail.swift `CSDetail`;
 * CelebrateMatch.swift's CS2 rules; LiveViews.swift `RoundHistoryView`'s
 * rules) on a recorded match: G2 1–2 DENDELE at PGL Masters Bucharest 2026,
 * three maps, the second to overtime (`pnpm fixtures matches`).
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  blockCelebration,
  blockState,
  blockTitle,
  chunks,
  clearRoundCache,
  coStreamListed,
  coStreamerName,
  coStreamerURL,
  csMoments,
  defaultMap,
  loadCSDetail,
  loadCSMatch,
  mapPoint,
  mapTarget,
  mapsCaption,
  matchByIDURL,
  newerReading,
  parseMatch,
  parseRoster,
  parseRounds,
  parseStreams,
  platform,
  pointChip,
  provisional,
  roundReadout,
  roundSlots,
  series,
  viewers,
  type CSRound,
} from "../../src/data/cs2";
import { fetchDetail, type MapResult } from "../../src/data/gameDetail";
import type { CSLive, ScoreEvent, Side } from "../../src/data/models";
import { makeMatchEvent } from "../../src/data/providers/counterStrike";
import { csLiveLine, mapName, parseLive } from "../../src/data/providers/csLive";
import { fixture, replay } from "./fixtures";

const MATCH = "g2-vs-dendele-cs-26-10-2026";
const routes = (): [RegExp, unknown][] => [
  [/\/matches\/g2-vs-dendele/, fixture("bo3-detail-match.json")],
  [/\/games\/190577$/, fixture("bo3-detail-game-1.json")],
  [/\/games\/190576$/, fixture("bo3-detail-game-2.json")],
  [/\/games\/190575$/, fixture("bo3-detail-game-3.json")],
  [/\/teams\/g2\?/, fixture("bo3-detail-team-g2.json")],
  [/\/teams\/dendele-cs\?/, fixture("bo3-detail-team-dendele-cs.json")],
];

function event(state: ScoreEvent["state"] = "final"): ScoreEvent {
  const e = makeMatchEvent({ ...(fixture("bo3-detail-match.json") as object), status: state === "live" ? "current" : "finished", tournament: { name: "PGL Masters Bucharest 2026" } })!;
  return e;
}

const live = (t: number, b: number, { ended = false, map = 2 }: { ended?: boolean; map?: number } = {}): CSLive => ({
  mapName: "Mirage",
  mapNumber: map,
  round: t + b,
  topScore: t,
  bottomScore: b,
  topSide: "CT",
  bottomSide: "T",
  mapEnded: ended,
});
const map = (number: number, winner: Side | null, isLive = false): MapResult => ({ number, name: `Map ${number}`, topScore: null, bottomScore: null, winner, live: isLive });
const round = (number: number, winner: Side): CSRound => ({ number, winner, winnerSide: null, reason: "elimination", topEquipment: null, bottomEquipment: null });

beforeEach(() => clearRoundCache());

describe("CS2 match: the record", () => {
  const parsed = parseMatch(fixture("bo3-detail-match.json"));

  it("orders maps by number, with each map's score in the match's top/bottom order", () => {
    expect(parsed.maps.map((m) => m.name)).toEqual(["Nuke", "Ancient", "Inferno"]);
    // G2 is team1 (top). DENDELE took Nuke 13–5, G2 Ancient 16–14 in overtime, DENDELE Inferno.
    expect(parsed.maps[0]).toEqual({ number: 1, name: "Nuke", topScore: 5, bottomScore: 13, winner: "bottom", live: false });
    expect(parsed.maps[1]).toMatchObject({ topScore: 16, bottomScore: 14, winner: "top" });
    expect(parsed.top).toEqual({ id: 793, name: "G2", slug: "g2" });
  });

  it("names the tournament and the stage, the tournament's name taken out of the stage", () => {
    expect(parsed.tournament).toEqual({ slug: "pgl-masters-bucharest-2026", name: "PGL Masters Bucharest 2026", stage: "Group Stage · Round 3" });
  });

  it("lists streams official first, then English, then by viewers, on Twitch, YouTube and Kick only", () => {
    expect(parsed.streams.slice(0, 5).map((s) => s.name)).toEqual(["PGL_CS2", "pglcs2", "PGL 2", "gaules", "Gaules"]);
    const odd = parseStreams([
      { id: 1, name: "Pirate", raw_url: "https://example-streams.net/cs2", viewers_number: 9000, official: true },
      { id: 2, name: "Plain", raw_url: "http://www.twitch.tv/x" },
      { id: 3, name: "Lookalike", raw_url: "https://twitch.tv.evil.example/x" },
      { id: 4, raw_url: "https://www.twitch.tv/ohnepixel/" },
    ]);
    expect(odd.map((s) => s.name)).toEqual(["ohnepixel"]);
    expect(platform("https://youtu.be/abc")).toBe("youtube");
    expect(platform("https://m.twitch.tv/x")).toBe("twitch");
    expect(platform("not a url")).toBeNull();
    expect(viewers(241_300)).toBe("241.3K watching");
    expect(viewers(0)).toBeNull();
  });

  it("notices the co-streamer's own channel, exactly", () => {
    const streams = parseStreams([{ id: 1, raw_url: "https://www.twitch.tv/OhnePixel" }, { id: 2, raw_url: "https://kick.com/ohnepixel" }]);
    expect(coStreamListed(streams, "ohnepixel")).toBe(true);
    expect(coStreamListed(streams, "ohnepixel2")).toBe(false);
    expect(coStreamListed(parseStreams([{ id: 2, raw_url: "https://kick.com/ohnepixel" }]), "ohnepixel")).toBe(false);
    expect(coStreamerName("ohnepixel")).toBe("ohnePixel");
    expect(coStreamerURL("ohnePixel")).toBe("https://www.twitch.tv/ohnepixel");
    expect(coStreamerURL("not a handle!")).toBeNull();
  });

  it("asks for a match by ID, S-tier only", () => {
    const url = new URL(matchByIDURL(132237));
    expect(url.searchParams.get("filter[matches.id][eq]")).toBe("132237");
    expect(url.searchParams.get("filter[matches.tier][in]")).toBe("s");
  });
});

describe("CS2 match: rosters and rounds", () => {
  it("keeps the active five and the coach, with flags and slugs", () => {
    const g2 = parseRoster(fixture("bo3-detail-team-g2.json"));
    expect(g2.acronym).toBe("G2");
    expect(g2.players.map((p) => p.nickname)).toEqual(["huNter-", "Nertz", "HeavyGod", "r1nkle", "MATYS"]);
    expect(g2.coach?.nickname).toBe("sAw");
    expect(g2.players[0]).toMatchObject({ country: "BA", flag: "🇧🇦" });
    expect(g2.players.every((p) => p.slug)).toBe(true);
    // No acronym on bo3.gg: the page derives one.
    expect(parseRoster(fixture("bo3-detail-team-dendele-cs.json")).acronym).toBeNull();
    expect(parseRoster({ players: [{ id: 1, nickname: "old", status: 2 }] }).players).toEqual([]);
  });

  it("reads each round's winner by clan (\"G2 Esports\" is G2), how it ended and what each side spent", () => {
    const rounds = parseRounds(fixture("bo3-detail-game-1.json"), { id: 793, name: "G2" }, { id: 24956, name: "DENDELE" });
    expect(rounds).toHaveLength(18);
    expect(rounds.filter((r) => r.winner === "bottom")).toHaveLength(13);
    expect(rounds.filter((r) => r.winner === "top")).toHaveLength(5);
    expect(rounds[0]).toMatchObject({ number: 1, winner: "bottom", winnerSide: "T", reason: "elimination" });
    expect(rounds.every((r) => r.topEquipment != null && r.bottomEquipment != null)).toBe(true);
    expect(new Set(rounds.map((r) => r.reason))).toEqual(new Set(["elimination", "bombed", "defused", "time"]));
    // A name match stands in when the clans carry no team IDs.
    const anonymous = parseRounds({ game_rounds: [{ round_number: 1, winner_clan_name: "G2 Esports" }] }, { id: null, name: "G2" }, { id: null, name: "DENDELE" });
    expect(anonymous[0]!.winner).toBe("top");
  });

  it("loads the whole page in parallel, overtime included", async () => {
    const fetcher = replay(routes());
    const detail = await fetchDetail(event(), fetcher);
    expect(detail.maps).toHaveLength(3);
    expect(Object.keys(detail.rounds).map(Number)).toEqual([1, 2, 3]);
    expect(detail.rounds[2]).toHaveLength(30);
    expect(chunks(detail.rounds[2]!).map((b) => b.length)).toEqual([12, 12, 6]);
    expect(detail.topRoster.players).toHaveLength(5);
    expect(detail.bottomRoster.coach?.nickname).toBe("coachi");
    expect(detail.csLive).toBeNull();
    expect(detail.roundName).toBeNull();
    expect(fetcher.calls.some((u) => u.includes("/live/"))).toBe(false);
  });

  it("fetches finished maps' rounds once, and leaves out what fails", async () => {
    const fetcher = replay(routes());
    await loadCSDetail(MATCH, event(), fetcher);
    const again = replay(routes().filter(([p]) => !String(p).includes("teams\\/g2")));
    const second = await loadCSMatch(MATCH, event(), again);
    expect(again.calls.filter((u) => u.includes("/games/"))).toHaveLength(0);
    expect(second.part.topRoster.players).toEqual([]);
    expect(second.part.bottomRoster.players).toHaveLength(5);
    expect(second.event?.id).toBe("cs-132237");
  });

  it("reads the live snapshot while live, oriented by the fixture's team IDs", async () => {
    const snapshot = fixture("bo3-live-snapshot.synthetic.json");
    const fetcher = replay([[/\/live\/matches\/132237\//, { ...(snapshot as object), team_one: { score: 4, side: "CT", fixture: { team_id: 24956 } }, team_two: { score: 9, side: "T", fixture: { team_id: 793 } } }], ...routes()]);
    const detail = await fetchDetail(event("live"), fetcher);
    expect(detail.csLive).toMatchObject({ topScore: 9, bottomScore: 4, topSide: "T", bottomSide: "CT", mapNumber: 2 });
    expect(csLiveLine(detail.csLive!)).toBe("Mirage 9–4");
  });
});

describe("CS2 live: the shared snapshot parser", () => {
  it("is the scores list's parser (one CSLive)", () => {
    const live = parseLive(fixture("bo3-live-snapshot.synthetic.json"), 790, 3598)!;
    expect(live).toEqual({ mapName: "Mirage", mapNumber: 2, round: 14, topScore: 5, bottomScore: 8, topSide: "T", bottomSide: "CT", mapEnded: false });
    expect(parseLive({ status: "not_found" }, 1, 2)).toBeNull();
    expect(mapName("de_dust2")).toBe("Dust II");
  });
});

describe("CS2 rules", () => {
  it("first to 13, then 16, 19, 22 through overtime; map point one short of it", () => {
    expect([[11, 10], [12, 12], [14, 13], [15, 15], [17, 16], [18, 18]].map(([t, b]) => mapTarget(t!, b!))).toEqual([13, 16, 16, 19, 19, 22]);
    expect(mapPoint(12, 11)).toBe("top");
    expect(mapPoint(11, 12)).toBe("bottom");
    expect(mapPoint(12, 12)).toBeNull();
    expect(mapPoint(15, 14)).toBe("top");
    expect(mapPoint(15, 15)).toBeNull();
    expect(mapPoint(17, 18)).toBe("bottom");
    expect(mapPoint(12, 3)).toBe("top");
    expect(mapPoint(0, 0)).toBeNull();
    expect(mapPoint(3, 2)).toBeNull();
  });

  it("knows a series: 2–0 in a best of 3 clinches, 1–1 doesn't, a best of 1 does", () => {
    const bo3 = [map(1, "top"), map(2, null, true), map(3, null)];
    expect(series(2, "top", bo3)).toEqual({ wins: 2, losses: 0, clinched: true });
    expect(series(2, "bottom", bo3)?.clinched).toBe(false);
    expect(series(1, "bottom", [map(1, null, true)])?.clinched).toBe(true);
    expect(series(1, "top", [])).toBeNull();
    // A decided best of three lists only the maps it played: the format, not the list, says what wins it.
    expect(series(1, "top", [map(1, null, true)], 3)?.clinched).toBe(false);
    expect(mapsCaption([map(1, "top"), map(2, "top")], 3)).toBe("Best of 3: first to 2 maps wins. Rounds won on each map.");
    expect(parseMatch(fixture("bo3-detail-match.json")).bestOf).toBe(3);
  });

  it("says MATCH POINT when the map point would take the series, else MAP POINT", () => {
    const bo3 = [map(1, "top"), map(2, null, true), map(3, null)];
    expect(pointChip(live(12, 9), bo3)).toEqual({ text: "MATCH POINT", side: "top" });
    expect(pointChip(live(9, 12), bo3)).toEqual({ text: "MAP POINT", side: "bottom" });
    expect(pointChip(live(10, 9), bo3)).toBeNull();
    expect(pointChip(live(12, 9, { ended: true }), bo3)).toBeNull();
    expect(pointChip(null, bo3)).toBeNull();
  });

  it("makes moments: a round, a map, the series (decisive); never a new map", () => {
    const bo3 = [map(1, "top"), map(2, null, true), map(3, null)];
    const names = { top: "NAVI", bottom: "FaZe" };
    const won = csMoments(live(12, 9), live(13, 9, { ended: true }), names, bo3);
    expect(won).toHaveLength(1);
    expect(won[0]).toMatchObject({ kind: "mapWon", tier: 3, side: "top", lead: "Series won", detail: "NAVI take Mirage 13–9 and the series 2–0", chart: "rounds" });
    expect(won[0]!.accents.has("decisive")).toBe(true);
    const level = csMoments(live(9, 12), live(9, 13, { ended: true }), names, bo3);
    expect(level[0]).toMatchObject({ lead: "Map won", side: "bottom" });
    expect(level[0]!.accents.has("decisive")).toBe(false);
    const r = csMoments(live(11, 10), live(12, 10), names, bo3);
    expect(r[0]).toMatchObject({ kind: "roundWon", tier: 2, id: "cs:2:22", lead: "Round 22", detail: "NAVI won · 12–10" });
    expect(csMoments(live(11, 10, { map: 1 }), live(0, 0, { map: 2 }), names, bo3)).toEqual([]);
    expect(csMoments(live(11, 10), live(11, 10), names, bo3)).toEqual([]);
    expect(csMoments(live(5, 5), live(6, 6), names, bo3)).toEqual([]);
    const single = csMoments(live(12, 9, { map: 1 }), live(13, 9, { ended: true, map: 1 }), names, [map(1, null, true)]);
    expect(single[0]!.lead).toBe("Match won");
  });

  it("keeps whichever reading is further on", () => {
    expect(newerReading(live(5, 4), live(5, 3))).toBe(true);
    expect(newerReading(live(5, 3), live(5, 4))).toBe(false);
    expect(newerReading(live(0, 0, { map: 3 }), live(12, 12, { map: 2 }))).toBe(true);
    expect(newerReading(live(13, 9, { ended: true }), live(13, 9))).toBe(true);
    expect(newerReading(live(5, 5), live(5, 5))).toBe(false);
  });
});

describe("CS2 round grid", () => {
  const rounds = [round(1, "top"), round(2, "bottom"), round(3, "top")];
  const reading = (t: number, b: number): CSLive => ({ mapName: null, mapNumber: 1, round: null, topScore: t, bottomScore: b, topSide: null, bottomSide: null, mapEnded: false });

  it("slots in rounds the score has but the list doesn't, only when they all went one way", () => {
    const one = provisional(rounds, reading(3, 1));
    expect(one).toEqual([{ number: 4, winner: "top" }]);
    expect(provisional(rounds, reading(2, 3)).map((p) => p.number)).toEqual([4, 5]);
    expect(provisional(rounds, reading(3, 2))).toEqual([]);
    expect(provisional(rounds, reading(2, 1))).toEqual([]);
    expect(provisional(rounds, null)).toEqual([]);
  });

  it("adds the round being played while the map is live, and reads the live block's state", () => {
    const slots = roundSlots(rounds, true, reading(3, 1)).flat();
    expect(slots.map((s) => s.kind)).toEqual(["played", "played", "played", "provisional", "next"]);
    expect(slots.at(-1)!.number).toBe(5);
    expect(roundSlots(rounds, true, { ...reading(2, 1), mapEnded: true }).flat().some((s) => s.kind === "next")).toBe(false);
    const run = [round(1, "bottom"), ...[2, 3, 4, 5, 6].map((n) => round(n, "top"))];
    expect(blockState(roundSlots(run, false).flat())).toEqual({ mapPoint: null, streak: { count: 5, side: "top" } });
    const point = Array.from({ length: 23 }, (_, i) => round(i + 1, i < 12 ? "top" : "bottom")).slice(0, 23);
    expect(blockState(roundSlots(point, false).flat()).mapPoint).toBe("top");
    expect([0, 1, 2, 3].map(blockTitle)).toEqual(["1st half", "2nd half", "Overtime 1", "Overtime 2"]);
  });

  it("plays a round in its block, a map in the last, a series in every one", () => {
    const blocks = roundSlots(Array.from({ length: 14 }, (_, i) => round(i + 1, "top")), true);
    const m = (id: string, kind: "roundWon" | "mapWon", decisive = false) => ({ ...csMoments(live(0, 0), live(1, 0), { top: "A", bottom: "B" }, [])[0]!, id, kind, accents: new Set(decisive ? (["decisive"] as const) : []) });
    expect(blockCelebration(m("cs:1:14", "roundWon"), 1, blocks, 1)).not.toBeNull();
    expect(blockCelebration(m("cs:1:14", "roundWon"), 0, blocks, 1)).toBeNull();
    expect(blockCelebration(m("cs:2:14", "roundWon"), 1, blocks, 1)).toBeNull();
    expect(blockCelebration(m("cs:1:end", "mapWon"), 0, blocks, 1)).toBeNull();
    expect(blockCelebration(m("cs:1:end", "mapWon"), 1, blocks, 1)).not.toBeNull();
    expect(blockCelebration(m("cs:1:end", "mapWon", true), 0, blocks, 1)).not.toBeNull();
  });

  it("says a round in words, values first", () => {
    const r: CSRound = { number: 7, winner: "top", winnerSide: "CT", reason: "defused", topEquipment: 24_350, bottomEquipment: 4100 };
    expect(roundReadout(r, { top: "G2", bottom: "DEN" })).toEqual({ lead: "G2 won as CT", detail: "Round 7 · Bomb defused · G2 $24,350 · DEN $4,100" });
  });

  it("opens on the live map, else the latest; captions the format", () => {
    const rs = { 1: [round(1, "top")], 2: [round(1, "top")] };
    expect(defaultMap(rs, [map(1, "top"), map(2, null, true), map(3, null)])).toBe(2);
    expect(defaultMap(rs, [map(1, "top"), map(2, "top")])).toBe(2);
    expect(defaultMap({}, [])).toBeNull();
    expect(mapsCaption([map(1, null), map(2, null), map(3, null)])).toBe("Best of 3: first to 2 maps wins. Rounds won on each map.");
    expect(mapsCaption([map(1, null)])).toBe("Rounds won on each map.");
  });
});
