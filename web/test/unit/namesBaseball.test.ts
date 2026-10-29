/**
 * The names over the play theater's figures (TheaterNamesTests.swift §
 * Baseball), on World Series Game 2 (TB at MIL): who's in the field now from
 * the lineups (a defensive change, a man hit for), MLB's numbers by name (the
 * pitchers' too), who each figure of a play is (the play's own pitcher and
 * batter and runners by ID, an unknown fielder only his place), who it's
 * about (the batter; a runner's play's runner), the field between plays
 * from the live situation, and a pitching change's two men.
 */
import { describe, expect, it } from "vitest";
import { baseballFielders, type BaseballNow } from "../../src/data/mlb/fielders";
import type { PlayBeat } from "../../src/data/mlb/playBeat";
import { beatScript } from "../../src/data/mlb/playBeatScript";
import { playCast } from "../../src/data/mlb/playNames";
import { parse, type PlayScene, type SideOf } from "../../src/data/mlb/playScene";
import { PlayScript, type Rest } from "../../src/data/mlb/playScript";
import { folded, statcastNumbers } from "../../src/data/mlb/statcast";
import { personOf, TheaterPeople, type TheaterCast, type TheaterPerson } from "../../src/data/theater/theaterNames";
import { fixture } from "./fixtures";

const summary = fixture("names-mlb-401908043-summary.json");
const plays = (fixture("mlb-ws-g2-summary-plays.json") as { plays: unknown[] }).plays;
const side: SideOf = (id) => (id === "30" ? "top" : id === "8" ? "bottom" : null);
const fielders = baseballFielders(summary, side);
const numbers = statcastNumbers(fixture("names-mlb-849802-numbers.json"));
const people = { ...TheaterPeople.boxscore(summary), ...TheaterPeople.rosters(summary) };
// The box score's short names, as the page reads them ("W. Contreras").
const names: Record<string, string> = {};
for (const team of (summary as { boxscore: { players: { statistics: { athletes: { athlete: { id: string; shortName?: string } }[] }[] }[] } }).boxscore.players) {
  for (const group of team.statistics) for (const e of group.athletes) if (e.athlete.shortName) names[e.athlete.id] = e.athlete.shortName;
}
const now: BaseballNow = { side: "bottom", batter: "31283", pitcher: "42584", runners: ["39895", null, "35013"] };

function scene(id: string): PlayScene {
  const i = plays.findIndex((p) => (p as { id?: string }).id === id);
  const s = i < 0 ? null : parse(plays, i, side, names);
  if (!s) throw new Error(`No play ${id}`);
  return s;
}

const tag = (p: TheaterPerson | null) => (p ? `${p.number ?? "-"} ${p.last} ${p.position ?? "-"}` : "none");
const person = (cast: TheaterCast, i: number | null | undefined) => (i == null ? null : personOf(cast.members.get(i)?.who));
const rest = (s: PlayScene): Rest => ({ bases: s.basesAfter, bats: "R", swapped: false, fieldingHome: false });

describe("who's in the field now", () => {
  it("reads the lineups: Fortes catching for Tampa Bay (in for Hicks), nobody at short once Walls was hit for, Pratt at short for Milwaukee; Matz pitching, Rasmussen first", () => {
    expect(fielders.positions.top?.[2]).toBe("41674");
    expect(fielders.positions.top?.[6]).toBeUndefined();
    expect(fielders.positions.bottom?.[6]).toBe("5149101");
    expect(fielders.pitching.top).toBe("33106");
    expect(fielders.pitchers.top?.[0]).toBe("42584");
  });

  it("takes MLB's numbers by name, the pitchers' too", () => {
    expect(numbers[folded("Drew Rasmussen")]).toBe("57");
    expect(Object.keys(numbers)).toHaveLength(52);
  });
});

describe("who each figure is", () => {
  const single = scene("4019080430104990057");
  const script = PlayScript.play(single, rest(single));
  const cast = playCast(script, single, null, "bottom", fielders, people, numbers, now, single.id);
  const byRole = (kind: string, n?: number) => script.actors.findIndex((a) => a.role.kind === kind && (n == null || (a.role.kind === "fielder" && a.role.n === n)));

  it("Contreras's single is about the batter", () => {
    const key = cast.key(1);
    expect(tag(person(cast, key))).toBe("24 Contreras C");
    expect(script.actors[key!]!.role.kind).toBe("batter");
  });

  it("names the play's own pitcher with MLB's number, the catcher in now; short, unknown, only his place", () => {
    expect(tag(person(cast, byRole("fielder", 1)))).toBe("57 Rasmussen P");
    expect(tag(person(cast, byRole("fielder", 2)))).toBe("40 Fortes C");
    expect(cast.members.get(byRole("fielder", 6))?.who).toEqual({ kind: "assumed", position: "SS" });
  });

  it("names the runners the play names, by ID; the umpire gets no tag", () => {
    const runners = script.actors.flatMap((a, i) => (a.role.kind === "runner" ? [person(cast, i)?.last ?? "?"] : []));
    expect(new Set(runners)).toEqual(new Set(["Chourio", "Bauers"]));
    script.actors.forEach((a, i) => {
      if (a.role.kind === "umpire" || a.role.kind === "coach") expect(cast.members.has(i)).toBe(false);
    });
  });

  it("without MLB's numbers, the pitcher's tag has no number", () => {
    const bare = playCast(script, single, null, "bottom", fielders, people, {}, now, single.id);
    expect(tag(person(bare, byRole("fielder", 1)))).toBe("- Rasmussen P");
  });

  it("a runner's play is about the runner its text leads with: Yelich stole second, Chourio third", () => {
    const steals = scene("4019080431504060398");
    const s = PlayScript.play(steals, rest(steals));
    const c = playCast(s, steals, null, "bottom", fielders, people, numbers, now, steals.id);
    expect(person(c, c.key(1))?.last).toBe("Yelich");
    expect(s.actors[c.key(1)!]!.role.kind).toBe("runner");
  });
});

describe("between plays", () => {
  const field: Rest = { bases: [true, false, true], bats: "R", swapped: false, fieldingHome: false };

  it("makes the batter at the plate the key man, the runners on from the live situation", () => {
    const still = PlayScript.rest(field);
    const cast = playCast(still, null, null, "bottom", fielders, people, numbers, now, "field");
    expect(person(cast, cast.key(0))?.last).toBe("Yelich");
    const runners = still.actors.flatMap((a, i) => (a.role.kind === "runner" ? [person(cast, i)?.last ?? "?"] : []));
    expect(new Set(runners)).toEqual(new Set(["Contreras", "Bauers"]));
  });

  it("a pitching change: the man going off the one before the reliever, the reliever by the name the beat gives", () => {
    const change: PlayBeat = { id: "change", kind: { kind: "pitchingChange", reliever: "Booser" }, bats: null, arm: null, inning: 3, top: false, balls: 0, strikes: 0, outs: 0, wallclock: null, bases: null, news: false };
    const beat = beatScript(change, field);
    const cast = playCast(beat, null, change, "bottom", fielders, people, numbers, { side: "bottom", batter: "31283", pitcher: "42584", runners: [null, null, null] }, change.id);
    const pitchers = beat.actors.flatMap((a, i) => (a.role.kind === "fielder" && a.role.n === 1 ? [i] : []));
    expect(pitchers).toHaveLength(2);
    expect(person(cast, pitchers[0])?.last).toBe("Rasmussen");
    expect(person(cast, pitchers[1])?.last).toBe("Booser");
  });
});
