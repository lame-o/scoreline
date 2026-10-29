/**
 * The officials' kits (TheaterRigTests.swift, "officials' kits"): the
 * referee in yellow with black shorts, red when a team wears yellow, teal
 * when red's taken too; the zebra with black trousers; pale shirts rimmed on
 * a light panel.
 */
import { describe, expect, it } from "vitest";
import { REFEREE_SHIRTS, referee, umpire, zebra } from "../../src/data/mlb/theaterTeams";

describe("officials' kits", () => {
  const navy = "#1a2659";
  const red = "#cc1a26";
  const villarrealYellow = "#fcdb1a";

  it("puts the referee in yellow unless a team wears it", () => {
    expect(referee([navy, red], "dark").jersey).toBe(REFEREE_SHIRTS[0]);
    expect(referee([villarrealYellow, navy], "dark").jersey).toBe(REFEREE_SHIRTS[1]);
    expect(referee([villarrealYellow, REFEREE_SHIRTS[1]], "light").jersey).toBe(REFEREE_SHIRTS[2]);
    expect(referee([navy, red], "dark").legs).not.toBeNull();
  });

  it("rims a pale shirt on a light panel only", () => {
    expect(referee([navy], "dark").piping).toBeNull();
    expect(referee([navy], "light").piping).not.toBeNull();
    expect(zebra("light").piping).not.toBeNull();
    expect(zebra("dark").piping).toBeNull();
  });

  it("dresses the zebra and the umpire", () => {
    expect(zebra("dark").stripes).not.toBeNull();
    expect(zebra("dark").legs).not.toBeNull();
    expect(umpire("dark").legs).not.toBe(umpire("dark").jersey);
  });
});
