import { describe, expect, it } from "vitest";
import { cueDuration, cueFor, particles, PARTICLE_CAP, popScale, pillOpacity, presetFor, seed, washPulse, wantsBurst, glintProgress } from "../../src/data/celebrations";
import {
  accessoryTier,
  barOpacity,
  battingSide,
  beatFinal,
  beatScore,
  beatScoreRose,
  dockStep,
  downAndSpot,
  finalAnnouncement,
  heroTuck,
  NO_BEATS,
  shortInning,
  surfaceAt,
  visibility,
} from "../../src/data/matchRules";
import { liveMoment, MomentCenter, shortened, Tier, type LiveMoment } from "../../src/data/moments";
import { arrangement, sectionOrder, wideArrangement, widePlan } from "../../src/data/sections";
import type { EventRef } from "../../src/data/models";

const mlb: EventRef = { kind: "espn", path: "baseball/mlb", id: "1", sport: "baseball" };
const soccer: EventRef = { kind: "espn", path: "soccer/eng.1", id: "1", sport: "soccer" };

describe("the section plan", () => {
  it("orders baseball's sections like the Mac, live and final", () => {
    expect(sectionOrder(mlb, "live")).toEqual(["atPlate", "atBat", "linescore", "winProbability", "bracket", "moments", "battedBalls", "plays", "whereToWatch"]);
    expect(sectionOrder(mlb, "final")).toEqual(["linescore", "bracket", "moments", "battedBalls", "plays"]);
  });

  it("puts linked partners side by side from 680pt", () => {
    const placed = wideArrangement(sectionOrder(mlb, "live"), widePlan(mlb, "live"));
    const left = placed.filter((p) => p.column === "left").map((p) => p.section);
    const right = placed.filter((p) => p.column === "right").map((p) => p.section);
    expect(left).toEqual(["atPlate", "atBat", "battedBalls"]);
    expect(right).toEqual(["linescore", "winProbability", "moments", "bracket", "plays", "whereToWatch"]);
    // Reading order runs down the left column, then the right.
    expect(placed.map((p) => p.rank)).toEqual(placed.map((_, i) => i));
  });

  it("never leaves a column empty, and an unlisted section joins the last block's right column", () => {
    const plan = widePlan(soccer, "scheduled");
    expect(wideArrangement(["whereToWatch"], plan)).toEqual([{ section: "whereToWatch", column: "left", rank: 0 }]);
    const two = wideArrangement(["linescore", "battedBalls"], widePlan(mlb, "final"));
    expect(two.map((p) => p.column)).toEqual(["left", "right"]);
    const extra = wideArrangement(["linescore", "stats"], widePlan(mlb, "final"));
    expect(extra.find((p) => p.section === "stats")?.column).toBe("right");
  });

  it("is one column on a phone", () => {
    expect(arrangement(["atPlate", "atBat"], mlb, "live", false).map((p) => p.column)).toEqual(["single", "single"]);
  });
});

describe("rules", () => {
  it("tells who's batting from the inning", () => {
    expect(battingSide("Top 7th", false)).toBe("top");
    expect(battingSide("Bot 7th", false)).toBe("bottom");
    expect(battingSide("Mid 7th", false)).toBeNull();
    expect(battingSide("Top 1st", null)).toBeNull();
  });

  it("announces the final in words", () => {
    expect(finalAnnouncement({ name: "Brewers", score: "10" }, { name: "Rays", score: "1" }, "top")).toBe("Final. Brewers win, 10 to 1.");
    expect(finalAnnouncement({ name: "A", score: "1" }, { name: "B", score: "1" }, null)).toBe("Final. 1 to 1.");
  });

  it("pops the hero's digits when the second of the moment and the number arrives", () => {
    let b = beatScore(NO_BEATS, "top", false, 1000);
    expect(b.pops.top).toBe(0);
    expect(b.washPulses).toBe(1);
    b = beatScoreRose(b, "top", 2000);
    expect(b.pops.top).toBe(1);
    // The other order: the number first, then the moment.
    let c = beatScoreRose(NO_BEATS, "bottom", 1000);
    c = beatScore(c, "bottom", true, 5000);
    expect(c.pops.bottom).toBe(1);
    expect(c.glints).toBe(1);
    // A decisive score just celebrated the result: the final whistle stays quiet.
    const d = beatFinal(c, "bottom", false, false, 10_000);
    expect(d.glints).toBe(1);
    const e = beatFinal(NO_BEATS, "top", false, false, 10_000);
    expect(e.pops.top).toBe(1);
    expect(e.glints).toBe(1);
  });

  it("docks the bar over three quarters of the hero, in 64 steps", () => {
    expect(dockStep(0, 200, 0)).toBe(0);
    expect(dockStep(0, 200, 50)).toBe(0);
    expect(dockStep(0, 200, 50 + 146)).toBe(64);
    expect(surfaceAt(0.49)).toBe("hero");
    expect(surfaceAt(0.5)).toBe("bar");
    expect(barOpacity(0)).toBe(0);
    expect(barOpacity(1)).toBe(1);
    const tuck = heroTuck(-150, 200);
    expect(tuck.scale).toBeCloseTo(0.94);
    expect(tuck.opacity).toBe(0);
    expect(heroTuck(0, 200)).toEqual({ scale: 1, opacity: 1 });
  });

  it("formats the bar's small text", () => {
    expect(shortInning("Top 7th")).toBe("▲7");
    expect(shortInning("Bot 12th")).toBe("▼12");
    expect(shortInning("Mid 7th")).toBe("Mid 7");
    expect(shortInning("Final")).toBe("Final");
    expect(downAndSpot("3rd & 7 at SF 25")).toEqual({ down: "3rd & 7", spot: "at SF 25" });
    expect(accessoryTier(340, 3, 3)).toBe(0);
    expect(accessoryTier(340, 1, 1)).toBe(1);
    expect(accessoryTier(400, 1, 1)).toBe(2);
    expect(accessoryTier(600, 1, 1)).toBe(3);
  });

  it("tells whether a section is on screen, with hysteresis", () => {
    const view = { top: 0, height: 600 };
    expect(visibility({ top: 100, height: 200 }, view, 0)).toBe("visible");
    expect(visibility({ top: 900, height: 200 }, view, 0)).toBe("hiddenBelow");
    expect(visibility({ top: -300, height: 200 }, view, 0)).toBe("hiddenAbove");
    expect(visibility({ top: -100, height: 200 }, view, 0)).toBe("partialAbove");
    // Taller than the viewport and filling it: you're inside it.
    expect(visibility({ top: -100, height: 2000 }, view, 0)).toBe("visible");
  });
});

const moment = (id: string, tier: Tier, extra: Partial<LiveMoment> = {}): LiveMoment => ({
  ...liveMoment({ id, chart: "plate", tier, kind: tier === Tier.score ? "runScored" : "hit", lead: id, detail: "" }),
  ...extra,
});

describe("the moment slot", () => {
  it("takes the most important, never interrupts a greater one, and never repeats", () => {
    let now = 0;
    const center = new MomentCenter({ wantsBurst: () => false, now: () => now });
    expect(center.offer([moment("a", Tier.swing), moment("b", Tier.score), moment("c", Tier.routine)])?.id).toBe("b");
    expect(center.offer([moment("d", Tier.swing)])).toBeNull();
    expect(center.current?.id).toBe("b");
    expect(center.offer([moment("b", Tier.score)])).toBeNull();
    center.expire("b");
    // Edited into something bigger: news again.
    expect(center.offer([moment("a", Tier.score)])?.id).toBe("a");
    now += 1;
  });

  it("plays only the newest score of a catch-up, and never bursts it", () => {
    const center = new MomentCenter({ wantsBurst: () => true, now: () => 0 });
    const batch = ["a", "b", "c", "d"].map((id) => moment(id, Tier.score));
    const shown = center.offer(batch);
    expect(shown?.id).toBe("d");
    expect(shown?.burst).toBe(false);
  });

  it("holds bursts to one every 10 seconds", () => {
    let now = 0;
    const center = new MomentCenter({ wantsBurst: () => true, now: () => now });
    expect(center.offer([moment("a", Tier.score)])?.burst).toBe(true);
    center.expire("a");
    now = 5000;
    expect(center.offer([moment("b", Tier.score)])?.burst).toBe(false);
    center.expire("b");
    now = 15_000;
    expect(center.offer([moment("c", Tier.score)])?.burst).toBe(true);
  });

  it("shortens goal and card wording", () => {
    expect(shortened("Harvey Barnes Goal")).toBe("Harvey Barnes");
    expect(shortened("Aitor Paredes Goal - Header")).toBe("Aitor Paredes (header)");
    expect(shortened("Fer Niño Penalty - Scored")).toBe("Fer Niño (pen)");
    expect(shortened("Something else")).toBe("Something else");
  });
});

describe("celebrations", () => {
  const homer = (accents: string[] = [], burst = true): LiveMoment => ({
    ...liveMoment({ id: "hr1", chart: "plate", tier: Tier.score, kind: "homeRun", lead: "Home run", detail: "", accents: accents as never }),
    burst,
  });
  const options = { level: "full" as const, reduceMotion: false, preset: presetFor(150), direction: -Math.PI / 2 };

  it("sets off fireworks for a home run: more shells for a slam or a walk-off", () => {
    expect(cueFor(homer(), options)?.effects).toEqual([{ kind: "fireworks", shells: 1 }]);
    expect(cueFor(homer(["grandSlam"]), options)?.effects).toEqual([{ kind: "fireworks", shells: 2 }]);
    const off = cueFor(homer(["decisive"]), options)!;
    expect(off.effects).toEqual([{ kind: "fireworks", shells: 3 }]);
    expect(off.gold).toBe(true);
    expect(wantsBurst(homer())).toBe(true);
  });

  it("trades bursts for sparks at Subtle and inside the cooldown; a bloom with Reduce Motion; nothing at Off", () => {
    expect(cueFor(homer(), { ...options, level: "subtle" })?.effects[0]).toMatchObject({ kind: "sparks", rays: 8 });
    expect(cueFor(homer([], false), options)?.effects[0]).toMatchObject({ kind: "sparks", rays: 8 });
    expect(cueFor(homer(), { ...options, reduceMotion: true })?.effects).toEqual([{ kind: "bloom", radius: 22 }]);
    expect(cueFor(homer(), { ...options, level: "off" })).toBeNull();
  });

  it("draws any frame on its own, the same every time, within the cap", () => {
    const cue = cueFor(homer(["decisive"]), options)!;
    const a = particles(cue, { x: 50, y: 50 }, 0.6);
    const b = particles(cue, { x: 50, y: 50 }, 0.6);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
    expect(a.length).toBeLessThanOrEqual(PARTICLE_CAP);
    // Nothing before the delay; nothing after it ends.
    expect(particles(cue, { x: 0, y: 0 }, 0.1)).toEqual([]);
    expect(particles(cue, { x: 0, y: 0 }, cueDuration(cue) + 0.01)).toEqual([]);
    expect(seed("hr1")).toBe(seed("hr1"));
    expect(seed("hr1")).not.toBe(seed("hr2"));
  });

  it("confetti stays under the cap, even gold with its second wave", () => {
    const goal: LiveMoment = { ...liveMoment({ id: "g", chart: "pitch", tier: Tier.score, kind: "goal", lead: "Goal", detail: "", accents: ["decisive"] }), burst: true };
    const cue = cueFor(goal, { ...options, preset: "tall" })!;
    for (const t of [0.45, 0.7, 1.0]) expect(particles(cue, { x: 0, y: 0 }, t).length).toBeLessThanOrEqual(PARTICLE_CAP);
  });

  it("keyframes rest where they started", () => {
    expect(popScale(0, 1.12)).toBe(1);
    expect(popScale(0.14, 1.12)).toBeCloseTo(1.12);
    expect(popScale(0.6, 1.12)).toBe(1);
    expect(pillOpacity(1)).toBe(1);
    expect(pillOpacity(3.5)).toBe(0);
    expect(washPulse(0.4)).toBe(1);
    expect(washPulse(2)).toBe(0);
    expect(glintProgress(0.2)).toBe(0);
    expect(glintProgress(1)).toBe(1);
  });
});

describe("the fast lane's cadence", () => {
  it("waits out the rest of its interval when the tab comes back early", async () => {
    const { laneDelay } = await import("../../src/features/game/core/sport");
    // The last tick ended 1.5 s ago on a 5 s lane: the next waits 3.5 s, not none.
    expect(laneDelay(10_000, 11_500, 5000)).toBe(3500);
    // A full interval (or more) since: at once.
    expect(laneDelay(10_000, 15_000, 5000)).toBe(0);
    expect(laneDelay(10_000, 60_000, 8000)).toBe(0);
    // Never run yet: at once.
    expect(laneDelay(-Infinity, 1000, 4000)).toBe(0);
  });
});
