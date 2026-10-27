/**
 * The outline's decisions (data/outline.ts, OutlineList.swift `Outline`):
 * which groups start open, "Show All" over 24, and the arrow keys. Ported
 * from Tests/OutlineTests.swift.
 */
import { describe, expect, it } from "vitest";
import { discloseLeft, discloseRight, disclosureMemory, parseStop, startsExpanded, step, stopKey, stops, visibleCount, type OutlineSection, type Stop } from "../../src/data/outline";

const row = (section: string, item: string): Stop => ({ kind: "row", section, item });
const header = (section: string): Stop => ({ kind: "header", section });

describe("the outline", () => {
  it("opens groups holding your teams, unless you closed them", () => {
    expect(startsExpanded(undefined, ["a", "b"], new Set(["b"]))).toBe(true);
    expect(startsExpanded(undefined, ["a", "b"], new Set(["c"]))).toBe(false);
    expect(startsExpanded(false, ["a", "b"], new Set(["b"]))).toBe(false);
    expect(startsExpanded(true, ["a"], new Set())).toBe(true);
  });

  it("remembers choices for the session, per page", () => {
    disclosureMemory.remember(true, "conf:SEC", "test");
    expect(disclosureMemory.choice("conf:SEC", "test")).toBe(true);
    expect(disclosureMemory.choice("conf:SEC", "other")).toBeUndefined();
    disclosureMemory.forget("test");
    expect(disclosureMemory.choice("conf:SEC", "test")).toBeUndefined();
  });

  it("caps long flat lists at 12 with Show All, from 25", () => {
    expect(visibleCount(24, false)).toBe(24);
    expect(visibleCount(25, false)).toBe(12);
    expect(visibleCount(59, true)).toBe(59);
    const items = Array.from({ length: 59 }, (_, i) => `cs-${i + 1}`);
    const capped: OutlineSection[] = [{ id: "all", kind: "capped", items }];
    const list = stops(capped, new Set());
    expect(list).toHaveLength(13);
    expect(list[12]).toEqual({ kind: "more", section: "all" });
    expect(stops(capped, new Set(), new Set(["all"]))).toHaveLength(59);
  });

  const sections: OutlineSection[] = [
    { id: "selected", kind: "plain", items: ["a"] },
    { id: "conf:SEC", kind: "disclosure", items: ["x", "y"] },
    { id: "conf:Big Ten", kind: "disclosure", items: ["m", "n"] },
  ];
  const list = stops(sections, new Set(["conf:Big Ten"]));

  it("lists the stops on screen: collapsed groups by their header alone", () => {
    expect(list).toEqual([row("selected", "a"), header("conf:SEC"), header("conf:Big Ten"), row("conf:Big Ten", "m"), row("conf:Big Ten", "n")]);
  });

  it("steps with ↑/↓, stopping at the ends", () => {
    expect(step(null, 1, list)).toEqual(row("selected", "a"));
    expect(step(null, -1, list)).toEqual(row("conf:Big Ten", "n"));
    expect(step(header("conf:SEC"), 1, list)).toEqual(header("conf:Big Ten"));
    expect(step(row("conf:Big Ten", "n"), 1, list)).toEqual(row("conf:Big Ten", "n"));
    // A row hidden since (its group collapsed) moves from its group's header.
    expect(step(row("conf:SEC", "y"), 1, list)).toEqual(header("conf:Big Ten"));
  });

  it("opens and closes with →/←, as an outline does", () => {
    const open = new Set(["conf:Big Ten"]);
    expect(discloseRight(header("conf:SEC"), sections, open)).toEqual({ kind: "expand", id: "conf:SEC" });
    expect(discloseRight(header("conf:Big Ten"), sections, open)).toEqual({ kind: "highlight", stop: row("conf:Big Ten", "m") });
    expect(discloseRight(row("conf:Big Ten", "m"), sections, open)).toBeNull();
    expect(discloseLeft(header("conf:Big Ten"), sections, open)).toEqual({ kind: "collapse", id: "conf:Big Ten" });
    expect(discloseLeft(header("conf:SEC"), sections, new Set())).toBeNull();
    expect(discloseLeft(row("conf:Big Ten", "n"), sections, open)).toEqual({ kind: "highlight", stop: header("conf:Big Ten") });
    expect(discloseLeft(row("selected", "a"), sections, new Set())).toBeNull();
  });

  it("round-trips stop keys", () => {
    for (const s of [...list, { kind: "more" as const, section: "all" }]) expect(parseStop(stopKey(s))).toEqual(s);
    expect(parseStop("x|y")).toBeNull();
    expect(parseStop(null)).toBeNull();
    expect(parseStop("r|team|espn|1")).toEqual(row("team", "espn|1"));
  });
});
