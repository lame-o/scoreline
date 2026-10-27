import { describe, expect, it } from "vitest";
import { clockReading, clockText } from "../../src/data/clock";
import {
  countdown,
  countdownClock,
  dayAndTime,
  dayName,
  ordinal,
  periodLabel,
  plural,
  spokenRecord,
  spokenStatus,
  updatedAgo,
} from "../../src/data/format";
import { lastGoalLine, markMinute, reconcileMarks } from "../../src/data/soccer";
import type { GameClock, MatchMark } from "../../src/data/models";

// Tuesday, Oct 27 2026, 2:00 PM in New York (the tests' zone).
const NOW = Date.parse("2026-10-27T18:00:00Z");
const HOUR = 3_600_000;

describe("words", () => {
  it("says ordinals and plurals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st", "111th"]);
    expect(plural(1, "game")).toBe("1 game");
    expect(plural(3, "match")).toBe("3 matches");
    expect(plural(2, "category", "categories")).toBe("2 categories");
  });

  it("names periods the one way: Q3, OT, 2OT; innings plain", () => {
    expect(periodLabel(3, "basketball")).toBe("Q3");
    expect(periodLabel(5, "basketball")).toBe("OT");
    expect(periodLabel(6, "football")).toBe("2OT");
    expect(periodLabel(3, "football", "ordinal")).toBe("3rd");
    expect(periodLabel(7, "baseball")).toBe("7");
  });

  it("turns source shorthand into words for screen readers", () => {
    expect(spokenStatus("67'")).toBe("67th minute");
    expect(spokenStatus("45'+2'")).toBe("45th minute plus 2");
    expect(spokenStatus("3:10 - 2nd")).toBe("3:10 left in the 2nd");
    expect(spokenStatus("0:31 - 2OT")).toBe("0:31 left in double overtime");
    expect(spokenStatus("Top 5th")).toBe("Top of the 5th");
    expect(spokenStatus("Bot 9th")).toBe("Bottom of the 9th");
    expect(spokenStatus("FT")).toBe("Full time");
    expect(spokenStatus("Final/OT")).toBe("Final, overtime");
    expect(spokenStatus("Final/10")).toBe("Final, 10 innings");
    expect(spokenStatus("Rain Delay")).toBe("Rain Delay");
    expect(spokenRecord("5-1-2", true)).toBe("5 wins, 1 draw, 2 losses");
    expect(spokenRecord("7–1", false)).toBe("7 wins, 1 loss");
  });
});

describe("times and days", () => {
  it("says the day the way macOS does", () => {
    expect(dayName(NOW + HOUR, NOW)).toBeNull();
    expect(dayName(NOW + 24 * HOUR, NOW)).toBe("Tomorrow");
    expect(dayName(NOW - 24 * HOUR, NOW)).toBe("Yesterday");
    expect(dayName(NOW + 3 * 24 * HOUR, NOW)).toBe("Friday");
    expect(dayName(NOW + 9 * 24 * HOUR, NOW)).toBe("Nov 5");
    expect(dayAndTime(NOW + HOUR, NOW)).toBe("Today 3:00 PM");
    expect(dayAndTime(NOW + 24 * HOUR, NOW)).toBe("Tomorrow 2:00 PM");
    // US clocks go back on Nov 1, so the same instant reads an hour earlier.
    expect(dayAndTime(NOW + 9 * 24 * HOUR, NOW)).toBe("Nov 5, 1:00 PM");
  });

  it("counts down inside a day", () => {
    expect(countdown(NOW + 30_000, NOW)).toBe("Starting");
    expect(countdown(NOW + 25 * 60_000, NOW)).toBe("in 25 min");
    expect(countdown(NOW + 200 * 60_000, NOW)).toBe("in 3h 20m");
    expect(countdown(NOW + 25 * HOUR, NOW)).toBeNull();
    expect(countdown(NOW - 2 * 60_000, NOW)).toBeNull();
    expect(countdownClock(NOW + (2 * 3600 + 14 * 60 + 33) * 1000, NOW)).toBe("2:14:33");
    expect(countdownClock(NOW + (14 * 60 + 33) * 1000, NOW)).toBe("14:33");
    expect(updatedAgo(NOW - 20_000, NOW)).toBe("Updated just now");
    expect(updatedAgo(NOW - 5 * 60_000, NOW)).toBe("Updated 5 minutes ago");
  });
});

describe("game clocks", () => {
  const down: GameClock = { seconds: 190, sampledAt: NOW, period: 2, direction: "down", display: "3:10 - 2nd", running: true };

  it("ticks a running countdown and holds past the horizon", () => {
    expect(clockText(down, NOW + 10_000)).toBe("3:00 - 2nd");
    expect(clockText(down, NOW + 600_000)).toBe("1:40 - 2nd");
    expect(clockText({ ...down, running: false }, NOW + 10_000)).toBe("3:10 - 2nd");
  });

  it("counts soccer minutes up into stoppage time", () => {
    const up: GameClock = { seconds: 4020, sampledAt: NOW, period: 2, direction: "up", display: "67'", running: true };
    expect(clockText(up, NOW + 60_000)).toBe("68'");
    const late: GameClock = { seconds: 5370, sampledAt: NOW, period: 2, direction: "up", display: "90'+1'", running: true };
    expect(clockText(late, NOW + 60_000)).toBe("90'+2'");
  });

  it("infers running from two readings", () => {
    const first = { ...down, running: false };
    expect(clockReading({ ...first, seconds: 180, display: "3:00 - 2nd", sampledAt: NOW + 10_000 }, first).running).toBe(true);
    expect(clockReading({ ...first, sampledAt: NOW + 10_000 }, first)).toEqual(first);
  });
});

describe("soccer marks", () => {
  const mark = (kind: MatchMark["kind"], minute: number, side: MatchMark["side"]): MatchMark => ({ kind, minute, side, player: "B. Saka", clock: `${minute}'` });

  it("reads minutes with stoppage time", () => {
    expect(markMinute("45'+2'")).toBe(47);
    expect(markMinute("64'")).toBe(64);
    expect(markMinute("")).toBeNull();
  });

  it("credits own goals so each side's count matches its score", () => {
    const marks = [mark("goal", 10, "top"), mark("ownGoal", 30, "top")];
    // 1–1: the own goal must be the bottom side's.
    expect(reconcileMarks(marks, 1, 1).map((m) => m.side)).toEqual(["top", "bottom"]);
    // 2–0: the source's side already adds up.
    expect(reconcileMarks(marks, 2, 0).map((m) => m.side)).toEqual(["top", "top"]);
    // Counts that can't add up: no side.
    expect(reconcileMarks(marks, 3, 3)[1]!.side).toBeNull();
    expect(lastGoalLine(marks)).toBe("Saka 30' (OG)");
  });
});
