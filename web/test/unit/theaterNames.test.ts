/**
 * The names on the isometric views (TheaterNamesTests.swift): the pure parts
 * every theater shares, on the same checks as the Mac's: a tag's surname,
 * the box score's and the rosters' men by ID, the hit test, where a tag goes
 * against the well and its furniture, how the pointer's tag comes and goes,
 * and each side's paint. Who each figure is per sport is in the
 * names*.test.ts files beside this one.
 */
import { describe, expect, it } from "vitest";
import { dress, type TheaterKits } from "../../src/data/mlb/theaterTeams";
import { labDistance } from "../../src/data/scoringSlide";
import { oklabFromHex } from "../../src/data/teamColors";
import { afterInitials, hitFigure, shownTags, surname, tagFrame, TheaterCast, theaterLabels, TheaterPeople, TheaterPointer, TheaterTagLayout, TEAM_ONLY, type TagAsk } from "../../src/data/theater/theaterNames";
import { fixture } from "./fixtures";

describe("a tag's names", () => {
  it("takes a surname, a suffix kept, and a short name past its initials", () => {
    expect(surname("Mikel Brown Jr.")).toBe("Brown Jr.");
    expect(surname("Kenneth Walker III")).toBe("Walker III");
    expect(surname("Alysson")).toBe("Alysson");
    expect(afterInitials("D. Jones Garcia")).toBe("Jones Garcia");
    expect(afterInitials("S.Barkley")).toBe("Barkley");
    expect(afterInitials("V. Mesa Jr.")).toBe("Mesa Jr.");
  });

  it("reads the box score's men by athlete ID, with their numbers and positions", () => {
    const people = TheaterPeople.boxscore(fixture("names-nba-401909890-boxscore.json"));
    const tag = (id: string) => {
      const p = people[id];
      return p ? `${p.number ?? "-"} ${p.last} ${p.position ?? "-"}` : "none";
    };
    expect(tag("5104157")).toBe("1 Wembanyama F");
    expect(tag("5037871")).toBe("2 Harper G");
    expect(Object.keys(people)).toHaveLength(26);
  });

  it("reads a squad's men from the rosters, their shirts and places", () => {
    const people = TheaterPeople.rosters(fixture("names-soccer-401879256-rosters.json"));
    const haaland = Object.values(people).find((p) => p.last === "Haaland");
    expect(haaland?.number).toBe("9");
  });
});

describe("the hit test", () => {
  const figures = [
    { index: 0, ground: { x: 100, y: 80 }, height: 24 },
    { index: 1, ground: { x: 106, y: 90 }, height: 26 },
    { index: 2, ground: { x: 200, y: 60 }, height: 6 },
  ];

  it("takes the nearer of two boxes that hold the pointer; between figures, nobody", () => {
    expect(hitFigure(figures, { x: 103, y: 70 })).toBe(1);
    expect(hitFigure(figures, { x: 99, y: 60 })).toBe(0);
    expect(hitFigure(figures, { x: 160, y: 70 })).toBeNull();
  });

  it("never makes a figure far off narrower than a fingertip, and reaches his feet", () => {
    expect(hitFigure(figures, { x: 204, y: 52 })).toBe(2);
    expect(hitFigure(figures, { x: 95, y: 81 })).toBe(0);
  });
});

describe("where a tag goes", () => {
  const well = { width: 312, height: 156 };
  const tag = { width: 70, height: 14.4 };
  const furniture = TheaterTagLayout.furniture(well, { width: 110, height: 16 }, true, "trailing");
  const ask = (x: number, top: number, feet: number, pointer: boolean): TagAsk => ({ ...tag, head: { x, y: top }, feet, pointer });
  const clearOf = (r: { x: number; y: number; width: number; height: number } | null | undefined) =>
    r != null && !furniture.some((f) => f.x < r.x + r.width && r.x < f.x + f.width && f.y < r.y + r.height && r.y < f.y + f.height);

  it("sits over his head, centred, 3 pt clear of it, and 4 pt inside the well at its edge", () => {
    expect(TheaterTagLayout.place([ask(160, 80, 104, true)], well, furniture)[0]).toEqual({ x: 125, y: 80 - 3 - 14.4, width: 70, height: 14.4 });
    expect(TheaterTagLayout.place([ask(8, 90, 120, true)], well, [])[0]?.x).toBe(4);
  });

  it("steps under his feet rather than cover the status tag; keeps clear of the turn control and the heartbeat", () => {
    const status = TheaterTagLayout.place([ask(40, 40, 66, false)], well, furniture)[0];
    expect(clearOf(status) && status!.y > 66).toBe(true);
    expect(clearOf(TheaterTagLayout.place([ask(300, 36, 60, true)], well, furniture)[0])).toBe(true);
    expect(clearOf(TheaterTagLayout.place([ask(290, 130, 150, true)], well, furniture)[0])).toBe(true);
  });

  it("lets the pointer's tag win: the key man's steps under his feet, or waits when there's no room there either", () => {
    const pair = TheaterTagLayout.place([ask(160, 80, 104, true), ask(170, 82, 106, false)], well, furniture);
    expect(pair[0]!.y + pair[0]!.height).toBeLessThanOrEqual(77);
    expect(pair[1]!.y).toBeGreaterThanOrEqual(106);
    const crowd = TheaterTagLayout.place([ask(160, 80, 104, true), ask(170, 82, 150, false)], well, furniture);
    expect(crowd[1]).toBeNull();
  });

  it("gives a man out of the well no tag, and keeps the stamp's room low at the left", () => {
    expect(TheaterTagLayout.place([ask(400, 60, 90, false)], well, [])[0]).toBeNull();
    expect(TheaterTagLayout.stamp({ width: 90, height: 40 }, well, 9)).toEqual({ x: 9, y: 156 - 7.2 - 40, width: 90, height: 40 });
  });
});

describe("the pointer's tag, coming and going", () => {
  it("fades in over 120 ms, eased out, swaps at once from man to man, and leaves faster", () => {
    const pointer = new TheaterPointer();
    const t0 = 1_000_000;
    pointer.move("a:1", t0);
    expect(pointer.fades).toBe(true);
    expect(pointer.appear(t0)).toBe(0);
    expect(pointer.appear(t0 + 60)).toBeGreaterThan(0.6);
    expect(pointer.appear(t0 + 120)).toBe(1);
    expect(pointer.fading(t0 + 100)).toBe(true);
    expect(pointer.fading(t0 + 130)).toBe(false);
    // The same man again changes nothing (no state per move).
    expect(pointer.move("a:1", t0 + 1000)).toBe(false);
    pointer.move("a:2", t0 + 1000);
    expect(pointer.fades).toBe(false);
    expect(pointer.appear(t0 + 1000)).toBe(1);
    expect(pointer.leaving).toBeNull();
    pointer.move(null, t0 + 2000);
    expect(pointer.leaving).toBe("a:2");
    expect(pointer.remaining(t0 + 2000)).toBe(1);
    expect(pointer.remaining(t0 + 2100)).toBe(0);
    expect(pointer.fading(t0 + 2050)).toBe(true);
    expect(pointer.fading(t0 + 2110)).toBe(false);
    // Back onto a man while the last tag's still going: at once.
    pointer.move("a:3", t0 + 2050);
    expect(pointer.fades).toBe(false);
    expect(pointer.leaving).toBeNull();
  });

  it("with Reduce Motion fades without the rise; never tags the pointer's man twice", () => {
    const pointer = new TheaterPointer();
    pointer.move("s#4", 0);
    const cast = TheaterCast.of(new Map([[4, { who: TEAM_ONLY, side: "top" as const, id: "s#4" }]]), null);
    const frame = tagFrame(cast, theaterLabels(null, "dark", { top: "Jazz", bottom: "Spurs" }), pointer, 0, { reduceMotion: true, status: null, flip: false });
    expect(frame.rise).toBe(false);
    expect(shownTags(frame, 0).pointer).toBe(4);
    expect(shownTags(frame, 0).key).toBeNull();
  });

  it("names the key man only when the data names him", () => {
    const cast = TheaterCast.of(new Map([[2, { who: TEAM_ONLY, side: "top" as const, id: "s#2" }]]), 2);
    expect(cast.key(1)).toBeNull();
  });
});

describe("each side's paint", () => {
  it("is the color he's drawn in: the team in its second color labeled in it; the Spurs' black gray on a dark panel", () => {
    const kits: TheaterKits = { top: { color: "13294b", alternate: "ffc72c" }, bottom: { color: "092c5c", alternate: "8fbce6" } };
    const labels = theaterLabels(kits, "dark", { top: "Brewers", bottom: "Rays" });
    const rule = dress(kits, "dark").rule;
    expect(rule.kind).toBe("second");
    if (rule.kind === "second") {
      const worn = oklabFromHex(rule.side === "top" ? "ffc72c" : "8fbce6")!;
      expect(labDistance(worn, labels[rule.side].paint.slab)).toBeLessThan(0.2);
    }
    const spurs: TheaterKits = { top: { color: "000000", alternate: "c4ced4" }, bottom: { color: "4e008e", alternate: "79a3dc" } };
    expect(theaterLabels(spurs, "dark", { top: "Spurs", bottom: "Jazz" }).top.paint.slab.l).toBeGreaterThan(0.5);
    expect(theaterLabels(spurs, "light", { top: "Spurs", bottom: "Jazz" }).top.paint.slab.l).toBeLessThan(0.35);
  });
});
