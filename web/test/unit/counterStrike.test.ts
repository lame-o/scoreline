import { describe, expect, it } from "vitest";
import { abbreviate, listURL, makeMatchEvent, parseMatchLists, scoreURLs, TIER } from "../../src/data/providers/counterStrike";
import { fixture } from "./fixtures";

const results = (name: string) => (fixture(name) as { results: unknown[] }).results;

describe("CS2 (bo3.gg)", () => {
  it("asks for S-tier only, in every list", () => {
    expect(TIER).toBe("s");
    const urls = scoreURLs(Date.parse("2026-10-27T07:31:12Z"));
    for (const url of Object.values(urls)) expect(new URL(url).searchParams.get("filter[matches.tier][in]")).toBe("s");
  });

  it("rounds the date window to the hour, so polls share the edge cache", () => {
    const a = scoreURLs(Date.parse("2026-10-27T07:01:00Z"));
    const b = scoreURLs(Date.parse("2026-10-27T07:59:59Z"));
    expect(a).toEqual(b);
    // Strict bounds: bo3.gg ignores [gte] and [lte] on start_date (every match since 2020 comes back).
    expect(new URL(a.upcoming).searchParams.get("filter[matches.start_date][gt]")).toBe("2026-10-25T06:59:59Z");
    expect(new URL(a.upcoming).searchParams.has("filter[matches.start_date][gte]")).toBe(false);
    expect(new URL(a.finished).searchParams.get("filter[matches.start_date][lt]")).toMatch(/^2026-10-29T\d\d:00:00Z$/);
    expect(a.finished).not.toContain("%5Blte%5D");
    expect(new URL(a.finished).searchParams.get("sort")).toBe("-start_date");
    expect(listURL("current", "start_date", 20)).toContain("with=teams%2Ctournament");
  });

  it("reads upcoming matches without scores, captioned with the event and format", () => {
    const [e] = parseMatchLists([{ results: results("bo3-matches-upcoming.json") }]).sort((a, b) => a.start - b.start);
    expect(e!.state).toBe("scheduled");
    expect(e!.content.kind).toBe("match");
    if (e!.content.kind !== "match") return;
    expect(e!.content.top.score).toBeNull();
    expect(e!.content.top.id).toMatch(/^cs-\d+$/);
    expect(e!.caption).toMatch(/^PGL Masters Bucharest 2026 · Best of \d$/);
    expect(e!.link).toMatch(/^https:\/\/bo3\.gg\/matches\//);
    expect(e!.ref?.kind).toBe("counterStrike");
  });

  it("reads finished matches with a winner", () => {
    const finished = parseMatchLists([{ results: results("bo3-matches-finished.json") }]);
    expect(finished.length).toBeGreaterThan(0);
    for (const e of finished) {
      expect(e.state).toBe("final");
      if (e.content.kind !== "match" || e.detail !== "Final") continue;
      expect([e.content.top.isWinner, e.content.bottom.isWinner].filter(Boolean)).toHaveLength(1);
    }
  });

  it("prefers the live copy of a match cached in two lists, and says which map", () => {
    const live = fixture("bo3-matches-current.synthetic.json");
    const upcoming = { results: results("bo3-matches-upcoming.json") };
    const list = parseMatchLists([live, upcoming]);
    const ids = list.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const e = list.find((x) => x.state === "live")!;
    expect(e.detail).toMatch(/^Map 2 of \d$/);
    if (e.content.kind === "match") expect([e.content.top.score, e.content.bottom.score]).toEqual(["1", "0"]);
  });

  it("calls off canceled and postponed matches without a score", () => {
    const base = results("bo3-matches-upcoming.json")[0] as Record<string, unknown>;
    const canceled = makeMatchEvent({ ...base, status: "canceled" })!;
    expect(canceled.state).toBe("final");
    expect(canceled.detail).toBe("Canceled");
    if (canceled.content.kind === "match") expect(canceled.content.top.score).toBeNull();
    expect(makeMatchEvent({ ...base, status: "defwin" })!.detail).toBe("Forfeit");
    expect(makeMatchEvent({ ...base, team1: null, team2: null })).toBeNull();
  });

  it("abbreviates team names for tight spaces", () => {
    expect(abbreviate("G2")).toBe("G2");
    expect(abbreviate("FaZe")).toBe("FaZe");
    expect(abbreviate("MOUZ")).toBe("MOUZ");
    expect(abbreviate("Natus Vincere")).toBe("NV");
    expect(abbreviate("The MongolZ")).toBe("MON");
    expect(abbreviate("Team Spirit")).toBe("SPI");
    expect(abbreviate("🐺 Wolves Esports")).toBe("WOL");
  });
});
