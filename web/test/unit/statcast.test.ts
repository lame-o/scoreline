/**
 * MLB's Statcast feed (StatcastTests.swift; statcast-849804.json: World
 * Series Game 3, trimmed): at-bats and their batted balls, each pitch's
 * flight landing where Statcast measured it crossing the plate, ESPN's
 * results matched to their at-bats, and the ESPN game found in MLB's schedule.
 */
import { describe, expect, it } from "vitest";
import { parse, type SideOf } from "../../src/data/mlb/playScene";
import { battedLine, match, matchScene, pitchPosition, plateTime, scheduleURL, statcastAtBats, statcastGame } from "../../src/data/mlb/statcast";
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
  it("a parsed play finds its at-bat (web): the line on the stamp", () => {
    const g3 = fixture("mlb-ws-g3-plays.json") as { items: unknown[]; names: Record<string, string> };
    const side: SideOf = (id) => (id === "8" ? "top" : id === "30" ? "bottom" : null);
    const i = g3.items.findIndex((p) => (p as { id?: string }).id === "4019080440005990057");
    const groundOut = parse(g3.items, i, side, g3.names)!;
    const found = matchScene(groundOut, atBats, g3.names);
    expect(found?.inning).toBe(1);
    expect(found?.top).toBe(true);
    expect(found?.batted).not.toBeNull();
    // Without names, the text's leading capitalized words stand in.
    expect(matchScene(groundOut, atBats, {})?.index).toBe(found?.index);
  });
});
