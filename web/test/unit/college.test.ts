/** College football's polls (College.swift `Rankings`, `PollList`). */
import { describe, expect, it } from "vitest";
import { apRanks, fetchRankings, isFBSPoll, movement, parseRankings, perColumn, pollLabel, pollPoints, spokenPollEntry } from "../../src/data/college";
import { fixture, replay } from "./fixtures";

const PATH = "football/college-football";

describe("polls", () => {
  const polls = parseRankings(fixture("standings-rankings.json"), PATH);

  it("the AP Top 25 and the Coaches Poll; FCS and lower divisions don't show", () => {
    expect(polls.map((p) => p.name)).toEqual(["AP Top 25", "AFCA Coaches Poll"]);
    expect(polls.map((p) => pollLabel(p.name))).toEqual(["AP", "Coaches"]);
    expect(isFBSPoll("FCS Coaches Poll")).toBe(false);
    expect(isFBSPoll("AFCA Division II Coaches Poll")).toBe(false);
    expect(polls[0]!.entries).toHaveLength(25);
    expect(polls[0]!.headline).toMatch(/Week/);
  });

  it("entries: ranks, team IDs in the app's format, points and first-place votes", () => {
    const first = polls[0]!.entries[0]!;
    expect(first.rank).toBe(1);
    expect(first.teamID).toMatch(/^espn-ncaaf-\d+$/);
    expect(first.points).toBeGreaterThan(1000);
    expect(first.firstPlaceVotes).toBeGreaterThan(0);
    expect(pollPoints(first)).toMatch(/^[\d,.\s]+ \(\d+\)$/);
    expect(apRanks(polls)[first.teamID]).toBe(1);
  });

  it("movement since last week; unranked last week is new", () => {
    const parsed = parseRankings(
      {
        rankings: [
          {
            name: "AP Top 25",
            shortHeadline: "AP Poll: Week 9",
            ranks: [
              { current: 2, previous: 3, team: { id: "194", location: "Ohio State" }, points: 1681.0, firstPlaceVotes: 10 },
              { current: 25, previous: 0, team: { id: "9", location: "Arizona State" } },
            ],
          },
        ],
      },
      PATH,
    );
    const [osu, asu] = parsed[0]!.entries;
    expect(movement(osu!)).toBe(1);
    expect(osu!.points).toBe(1681);
    expect(asu!.previous).toBeNull();
    expect(movement(asu!)).toBeNull();
    expect(spokenPollEntry(asu!)).toBe("Number 25, Arizona State, new this week");
    expect(spokenPollEntry(osu!)).toContain("up 1");
  });

  it("reads down each column: 1–13, then 14–25", () => {
    expect(perColumn(25, 2)).toBe(13);
    expect(perColumn(25, 1)).toBe(25);
  });

  it("fetches through a Fetcher", async () => {
    const fetcher = replay([[/rankings$/, fixture("standings-rankings.json")]]);
    expect(await fetchRankings(PATH, fetcher)).toHaveLength(2);
    expect(fetcher.calls[0]).toBe("https://site.api.espn.com/apis/site/v2/sports/football/college-football/rankings");
  });
});
