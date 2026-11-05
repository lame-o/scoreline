import { describe, expect, it } from "vitest";
import { applyTeamColors, readLogoColors } from "../../src/data/logoColors";
import { hue, oklabFromHex } from "../../src/data/teamColors";
import type { Competitor } from "../../src/data/models";
import { readableLogo } from "../../src/state/logoColors";

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
  });

  it("finds no colors in a black-and-white crest", () => {
    expect(readLogoColors(crest([[[0, 0, 0, 255], 0.5], [[255, 255, 255, 255], 0.5]])).colors).toEqual([]);
  });

  it("keeps the source's color: it's the team's, black and white included; the logo is only a fallback", () => {
    const c: Competitor = { id: "x", name: "X", abbreviation: "X", score: null, logo: "u", isWinner: false, color: "002a5c", rank: null, record: null, conferenceRecord: null, alternateColor: null };
    expect(applyTeamColors(c, undefined, { colors: ["#c8102e", "#0033a0"] })).toBe(c);
    const black = { ...c, color: "000000", alternateColor: "ffb612" };
    expect(applyTeamColors(black, undefined, { colors: ["#ffb612"] })).toBe(black);
  });

  it("a payload without colors reads what an earlier one said, else the logo's", () => {
    const bare: Competitor = { id: "x", name: "X", abbreviation: "X", score: null, logo: "u", isWinner: false, color: null, rank: null, record: null, conferenceRecord: null, alternateColor: null };
    expect(applyTeamColors(bare, { color: "d11317", alternate: "FFFFFF" }, { colors: ["#0033a0"] })).toMatchObject({ color: "d11317", alternateColor: "FFFFFF" });
    expect(applyTeamColors(bare, undefined, { colors: ["#c8102e", "#0033a0"] })).toMatchObject({ color: "c8102e", alternateColor: "0033a0" });
    expect(applyTeamColors(bare, undefined, { colors: [] })).toBe(bare);
  });

  it("reads bo3 crests from the host that sends CORS headers, ESPN's at the small size", () => {
    expect(readableLogo("https://image-proxy.bo3.gg/uploads/team/793/image/a.webp?w=64&h=64")).toBe("https://files.bo3.gg/uploads/team/793/image/a.webp");
    expect(readableLogo("https://files.bo3.gg/uploads/team/793/image/a.webp")).toBe("https://files.bo3.gg/uploads/team/793/image/a.webp");
    expect(readableLogo("https://a.espncdn.com/i/teamlogos/nfl/500/dal.png")).toMatch(/^https:\/\/a\.espncdn\.com\/combiner\/i\?img=\/i\/teamlogos\/nfl\/500\/dal\.png&w=\d+&h=\d+$/);
  });
});
