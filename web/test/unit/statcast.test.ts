/**
 * MLB's Statcast feed (StatcastTests.swift; statcast-849804.json: World
 * Series Game 3, trimmed): at-bats and their batted balls, each pitch's
 * flight landing where Statcast measured it crossing the plate, ESPN's
 * results matched to their at-bats, and the ESPN game found in MLB's schedule.
 */
import { describe, expect, it } from "vitest";
import { parse, type SideOf } from "../../src/data/mlb/playScene";
import { battedLine, match, pitchPosition, plateTime, scheduleURL, statcastAtBats, statcastGame } from "../../src/data/mlb/statcast";
import { fixture } from "./fixtures";

const atBats = statcastAtBats(fixture("statcast-849804.json"));
const schedule = fixture("statcast-schedule-20261026.json");

describe("Statcast", () => {
  it("every at-bat of the game, in order", () => {
    expect(atBats.length).toBe(76);
    expect(atBats[0]?.inning).toBe(1);
    expect(atBats[0]?.top).toBe(true);
  });
  it("a batted ball: exit velocity, launch angle, distance, trajectory, and the readout line", () => {
    const chourio = atBats.find((a) => a.batter === "Jackson Chourio" && a.batted != null);
    expect(chourio?.batted?.launchSpeed).toBe(104.4);
    expect(chourio?.batted?.launchAngle).toBe(12);
    expect(chourio?.batted?.distance).toBe(273);
    expect(chourio?.batted?.trajectory).toBe("line_drive");
    expect(chourio?.batted ? battedLine(chourio.batted) : null).toBe("104.4 MPH · 12° · 273 FT");
  });
  it("a grounder's line leaves off its distance (only its first hop): Swift's `readout`", () => {
    const turang = match(1, true, "Turang", atBats)!;
    expect(battedLine(turang.batted!, false)).toBe("67.0 MPH · \u221229°");
    expect(battedLine(turang.batted!)?.endsWith(" FT")).toBe(true);
  });
  it("each at-bat says whether it's over, which event ended it and whether that was put in play", () => {
    expect(atBats.every((a) => a.complete && a.closing != null)).toBe(true);
    const turang = match(1, true, "Turang", atBats)!;
    expect(turang.inPlay).toBe(true);
    expect(turang.batted?.fielder).toBe(6);
  });
  it("each pitch's flight lands on its measured plate location (within an inch), in 0.3–0.6 s", () => {
    const pitches = atBats.flatMap((a) => a.pitches);
    expect(pitches.length).toBeGreaterThan(250);
    let worst = 0;
    for (const p of pitches) {
      const t = plateTime(p);
      expect(t).not.toBeNull();
      const at = pitchPosition(p, t!);
      worst = Math.max(worst, Math.abs(at[0] - p.plate[0]), Math.abs(at[2] - p.plate[1]));
      expect(t!).toBeGreaterThan(0.3);
      expect(t!).toBeLessThan(0.6);
    }
    expect(worst).toBeLessThan(1 / 12);
  });
  it("an ESPN result finds its at-bat by half-inning and surname", () => {
    const turang = match(1, true, "Turang", atBats);
    expect(turang?.batted?.launchSpeed).toBe(67);
    expect(turang?.batted?.trajectory).toBe("ground_ball");
  });
  it("the right half-inning only, accents and case aside", () => {
    expect(match(1, true, "Diaz", atBats)).toBeNull();
    expect(match(1, false, "Díaz", atBats)?.batter).toBe("Yandy Díaz");
    expect(match(1, false, "diaz", atBats)?.batter).toBe("Yandy Díaz");
  });
  it("the ESPN game in MLB's schedule, by both teams", () => {
    expect(statcastGame(schedule, ["Brewers", "Rays"])).toBe(849804);
    expect(statcastGame(schedule, ["Brewers", "Dodgers"])).toBeNull();
  });
  it("a late game is on its Eastern date in MLB's schedule", () => {
    expect(scheduleURL(Date.parse("2026-10-27T02:10:00Z")).endsWith("date=2026-10-26")).toBe(true);
  });
});

/** PlayStatcastTests.swift's matching, on the same fixtures (ESPN's Game 3 plays, trimmed). */
describe("a play's own at-bat in MLB's feed", () => {
  const g3 = fixture("mlb-ws-g3-plays.json") as { items: unknown[]; names: Record<string, string> };
  const plays = g3.items;
  const side: SideOf = (id) => (id === "8" ? "top" : id === "30" ? "bottom" : null);
  const results = plays.flatMap((p, i) => ((p as { type?: { type?: string } }).type?.type === "play-result" ? [i] : []));
  const scenes = results.flatMap((i) => parse(plays, i, side, g3.names) ?? []);
  const scene = (id: string, names = g3.names) => {
    const i = plays.findIndex((p) => (p as { id?: string }).id === id);
    return parse(plays, i, side, names)!;
  };
  const measured = (id: string) => {
    const s = scene(id);
    s.measured = s.measurement(atBats);
    return s;
  };

  it("every plate appearance in Game 3 finds its Statcast at-bat", () => {
    const appearances = scenes.filter((s) => s.appearance != null);
    expect(appearances.length).toBe(74);
    expect(appearances.filter((s) => s.measurement(atBats) == null).map((s) => s.text)).toEqual([]);
    // A runner's play has nobody batting: nothing to look up as one.
    expect(scenes.filter((s) => s.batter == null).every((s) => s.appearance == null && s.measurement(atBats) == null)).toBe(true);
    // …and without the box score's names, by the surname the result's text opens with.
    const bare = results.flatMap((i) => parse(plays, i, side) ?? []).filter((s) => s.appearance != null);
    expect(bare.length).toBe(74);
    expect(bare.every((s) => s.measurement(atBats) != null)).toBe(true);
  });
  it("Turang's 6-3 in the top of the 1st: his at-bat, a 67 mph grounder; \"V. Mesa Jr.\" is \"Victor Mesa Jr.\"", () => {
    const turang = measured("4019080440005990057");
    expect(turang.appearance).toEqual({ inning: 1, top: true, surname: "Turang", occurrence: 0, runnerPlay: null });
    expect(turang.measured?.batted?.launchSpeed).toBe(67);
    expect(turang.measured?.batted?.trajectory).toBe("ground_ball");
    const mesa = measured("4019080440501990057");
    expect(mesa.appearance?.surname).toBe("Mesa Jr");
    expect(mesa.measured?.batted?.launchSpeed).toBe(100.7);
  });
  it("a team that bats around: each batter's second trip is his own", () => {
    const hamilton = measured("4019080440810990057");
    expect(hamilton.appearance?.occurrence).toBe(1);
    expect(hamilton.measured?.batted?.launchSpeed).toBe(96.5);
    expect(measured("4019080440801990057").measured?.batted?.launchSpeed).toBe(79.6);
    const chourio = measured("4019080440811990057");
    expect(chourio.appearance?.occurrence).toBe(1);
    expect(chourio.measured?.batted?.distance).toBe(353);
  });
  it("a strikeout: no ball in play, the deciding pitch as tracked", () => {
    const looking = measured("4019080440902990057");
    expect(looking.measured?.batted).toBeNull();
    expect(looking.measured?.pitch?.type).toBe("SI");
    expect(looking.measured?.pitch?.spin).toBe(2141);
  });
  it("ESPN's account and Statcast's must agree, or the theater keeps to ESPN's", () => {
    const wrong = scene("4019080440001990057");
    wrong.kind = { type: "double" };
    expect(wrong.measurement(atBats)).toBeNull();
    wrong.kind = { type: "single" };
    wrong.spot = { x: 40, y: 100 };
    expect(wrong.measurement(atBats)).toBeNull();
    expect(scene("4019080440001990057").measurement([])).toBeNull();
  });
  it("an at-bat MLB hasn't finished posting isn't measured yet", () => {
    const partial = atBats.find((a) => a.batter === "Jackson Chourio")!;
    const unfinished = { ...partial, event: null, batted: null };
    expect(scene("4019080440001990057").measurement([unfinished])).toBeNull();
  });
});
