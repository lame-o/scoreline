/**
 * Back's label and when it shows (app/backTitles.ts, RootView.swift
 * `Page.backTitle`): every page names itself the same way, whoever built it.
 */
import { describe, expect, it } from "vitest";
import { backButton, backTitleFor, type TrailEntry } from "../../src/app/backTitles";

describe("backTitleFor", () => {
  it("names each page as the Mac's Back does", () => {
    expect(backTitleFor("/")).toBe("Scores");
    expect(backTitleFor("/settings")).toBe("Settings");
    expect(backTitleFor("/settings/league/eng.1")).toBe("EPL");
    expect(backTitleFor("/settings/league/nope")).toBe("Settings");
    expect(backTitleFor("/game/espn-401873016", "?league=nfl")).toBe("Match");
    expect(backTitleFor("/standings/nba")).toBe("Table");
    expect(backTitleFor("/rankings/college-football")).toBe("Top 25");
    expect(backTitleFor("/bracket/mlb/2026")).toBe("Bracket");
    expect(backTitleFor("/schedule")).toBe("Schedule");
    expect(backTitleFor("/schedule/nfl")).toBe("Schedule");
    expect(backTitleFor("/schedule/eng.1", "?mode=results")).toBe("Results");
    expect(backTitleFor("/schedule/climbing")).toBe("Season");
    expect(backTitleFor("/schedule/tournaments")).toBe("Tournaments");
    expect(backTitleFor("/results/climbing/1489/5", "?category=Lead%20Women&event=Santiago")).toBe("Santiago");
    expect(backTitleFor("/results/tournament/esl", "?name=ESL%20Pro%20League")).toBe("ESL Pro League");
  });

  it("leaves teams and players to name themselves", () => {
    expect(backTitleFor("/team/espn-football-12")).toBeNull();
    expect(backTitleFor("/player/nba-1966")).toBeNull();
  });

  it("survives a malformed escape in a league path", () => {
    expect(backTitleFor("/settings/league/%E0%A4%A")).toBe("Settings");
  });
});

describe("backButton", () => {
  const trail: Record<number, TrailEntry> = {
    0: { path: "/", title: "Scores" },
    1: { path: "/schedule", title: "Schedule" },
    2: { path: "/game/espn-1", title: "Match" },
    3: { path: "/team/espn-football-12", title: "Chiefs" },
    4: { path: "/player/nfl-3139477", title: "Patrick Mahomes" },
    5: { path: "/game/espn-2", title: "Match", viaSidebar: true },
  };

  it("says the page it returns to", () => {
    expect(backButton(2, trail, null, false)).toEqual({ title: "Schedule", visible: true });
    expect(backButton(4, trail, null, false)).toEqual({ title: "Chiefs", visible: true });
  });

  it("goes to the scores from a page opened directly", () => {
    expect(backButton(0, {}, null, false)).toEqual({ title: "Scores", visible: true });
  });

  it("lets the opener's own word win", () => {
    expect(backButton(4, trail, "Kansas City", false).title).toBe("Kansas City");
  });

  it("says Back when it can't know", () => {
    expect(backButton(7, trail, null, false)).toEqual({ title: "Back", visible: true });
  });

  it("hides beside the sidebar only when the sidebar is where it leads", () => {
    // Opened directly, or from the scores: the sidebar is the way back.
    expect(backButton(0, {}, null, true).visible).toBe(false);
    expect(backButton(1, trail, null, true).visible).toBe(false);
    // A game picked in the sidebar while a team's page was open.
    expect(backButton(5, trail, null, true).visible).toBe(false);
    // A schedule's game, a roster's player: Back leads somewhere the sidebar isn't.
    expect(backButton(2, trail, null, true)).toEqual({ title: "Schedule", visible: true });
    expect(backButton(4, trail, null, true)).toEqual({ title: "Chiefs", visible: true });
  });
});
