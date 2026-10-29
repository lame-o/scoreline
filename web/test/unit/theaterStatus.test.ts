/**
 * The theaters' status pieces (ScoringSlideTests.swift's heartbeat checks,
 * TheaterOrientation): the heartbeat's words and the flip's storage key.
 */
import { describe, expect, it } from "vitest";
import { heartbeatLabel, statusTagSize, theaterFlipKey } from "../../src/features/game/core/theater/TheaterStatus";

describe("theater status", () => {
  it("says the feed is live, then that it's waiting", () => {
    expect(heartbeatLabel(4, "ESPN")).toBe("Live · 4s");
    expect(heartbeatLabel(59, "ESPN")).toBe("Live · 59s");
    expect(heartbeatLabel(125, "ESPN")).toBe("Waiting for ESPN · 2m");
  });

  it("sizes the tag from the well and keys the flip by game", () => {
    expect(statusTagSize(100)).toBe(10);
    expect(statusTagSize(220)).toBeCloseTo(11.44);
    expect(statusTagSize(400)).toBe(14);
    expect(theaterFlipKey("401909890")).toBe("theaterFlip.401909890");
  });
});
