import { describe, expect, it } from "vitest";
import { orderLogoColors, readLogoColors, wearLogoColors } from "../../src/data/logoColors";
import { hue, oklabFromHex } from "../../src/data/teamColors";
import type { Competitor } from "../../src/data/models";

/** A 64×64 crest: `parts` of [rgba, share]. */
function crest(parts: [[number, number, number, number], number][]): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(64 * 64 * 4);
  let i = 0;
  for (const [rgba, share] of parts) {
    const count = Math.round(64 * 64 * share);
    for (let n = 0; n < count && i < pixels.length; n++, i += 4) pixels.set(rgba, i);
  }
  return pixels;
}

const hueOf = (hex: string) => hue(oklabFromHex(hex)!);

describe("logo colors", () => {
  it("reads the colors a crest is made of, strongest first, ignoring white and transparency", () => {
    const entry = readLogoColors(
      crest([
        [[200, 16, 46, 255], 0.45], // red
        [[255, 255, 255, 255], 0.25], // white
        [[0, 51, 160, 255], 0.15], // blue
        [[0, 0, 0, 0], 0.15], // transparent
      ]),
    );
    expect(entry.colors).toHaveLength(2);
    expect(hueOf(entry.colors[0]!)).toBeCloseTo(hueOf("#c8102e"), -1);
    expect(hueOf(entry.colors[1]!)).toBeCloseTo(hueOf("#0033a0"), -1);
    expect(entry.weights[0]).toBe(1);
  });

  it("finds no colors in a black-and-white crest", () => {
    expect(readLogoColors(crest([[[0, 0, 0, 255], 0.5], [[255, 255, 255, 255], 0.5]])).colors).toEqual([]);
  });

  it("lets a vivid source color tip a close second, never a navy one", () => {
    const entry = { colors: ["#f05a28", "#007ac1"], weights: [1, 0.8] };
    expect(orderLogoColors(entry, "007ac1")).toEqual(["#007ac1", "#f05a28"]);
    expect(orderLogoColors(entry, "002a5c")).toEqual(["#f05a28", "#007ac1"]);
  });

  it("dresses a competitor in its logo's colors", () => {
    const c: Competitor = { id: "x", name: "X", abbreviation: "X", score: null, logo: "u", isWinner: false, color: "002a5c", rank: null, record: null, conferenceRecord: null, alternateColor: null };
    expect(wearLogoColors(c, { colors: ["#c8102e", "#0033a0"], weights: [1, 0.4] })).toMatchObject({ color: "c8102e", alternateColor: "0033a0" });
    expect(wearLogoColors(c, { colors: [], weights: [] })).toBe(c);
  });
});
