import { describe, expect, it } from "vitest";
import {
  capitalized,
  categoryEvent,
  competitionShortName,
  fetchClimbing,
  opener,
  openerEvent,
  parseSeason,
  roundEventName,
} from "../../src/data/providers/ifsc";
import { fixture, replay } from "./fixtures";

const root = fixture("ifsc-root.json");
const season = fixture("ifsc-season.json");
const nextSeason = fixture("ifsc-season-next.json");
const event = fixture("ifsc-event.json") as { d_cats: unknown[] };
const results = fixture("ifsc-round-results.json");

describe("climbing (IFSC)", () => {
  it("in the off-season, shows the next season's opener as a whole competition", async () => {
    const fetcher = replay([
      [/\/api\/v1\/$/, root],
      [/\/seasons\/38$/, season],
      [/\/seasons\/40$/, nextSeason],
    ]);
    const now = Date.parse("2026-10-27T07:00:00Z");
    const list = await fetchClimbing([], fetcher, undefined, now);
    expect(list).toHaveLength(1);
    const [e] = list;
    expect(e!.state).toBe("scheduled");
    expect(e!.content).toEqual({ kind: "field", title: "Tokyo 2027", summary: "Tokyo, Japan" });
    expect(e!.caption).toBe("Season opener · Apr 9–11 · Boulder");
    // Local midnight of its first venue day.
    expect(new Date(e!.start).getDate()).toBe(9);
    expect(e!.ref).toMatchObject({ kind: "climbing", eventID: 1544, category: "" });
    // The proxy adds the Referer; the provider only names allowlisted URLs.
    expect(fetcher.calls.every((u) => u.startsWith("https://ifsc.results.info/api/v1/"))).toBe(true);
  });

  it("parses World Cups (not youth, continental or cancelled events) with their lanes", () => {
    const comps = parseSeason(nextSeason);
    expect(comps.map((c) => c.shortName)).toEqual(comps.map((c) => competitionShortName(c.name)));
    expect(comps[0]).toMatchObject({ eventID: 1544, shortName: "Tokyo", countryCode: "JP", lanes: ["boulder"], badge: null });
    expect(opener(comps, Date.parse("2026-10-27T00:00:00Z"))?.eventID).toBe(1544);
    expect(openerEvent(comps[0]!).id).toBe("ifsc-1544");
  });

  it("makes a category's row from its rounds and the leader of the round in focus", async () => {
    const speedMen = event.d_cats[0];
    const fetcher = replay([[/\/results$/, results]]);
    const comp = { event_id: 1489, event: "World Climbing Series Santiago 2026", ends_at: "2026-10-25 02:59:00 UTC" };
    const e = await categoryEvent(speedMen, comp, Date.parse("2026-10-23T12:00:00Z"), 0, ["USA"], fetcher, undefined, Date.parse("2026-10-27T00:00:00Z"));
    expect(e!.state).toBe("final");
    expect(e!.detail).toBe("Final");
    expect(e!.content.kind).toBe("field");
    if (e!.content.kind !== "field") return;
    expect(e!.content.title).toBe("Speed Men");
    expect(e!.content.summary).toMatch(/^Winner /);
    expect(e!.caption?.startsWith("Santiago 2026")).toBe(true);
    expect(e!.ref).toMatchObject({ kind: "climbing", eventID: 1489, category: "Speed Men", eventName: "Santiago 2026" });
  });

  it("names things as the Mac app does", () => {
    expect(capitalized("SPEED Men")).toBe("Speed Men");
    expect(capitalized("BOULDER&LEAD Women")).toBe("Boulder&Lead Women");
    expect(roundEventName("World Climbing Series Santiago 2026")).toBe("Santiago 2026");
    expect(competitionShortName("World Climbing Championship Brno 2027")).toBe("Brno");
    expect(competitionShortName("Olympic Games LA28")).toBe("LA28");
  });
});
