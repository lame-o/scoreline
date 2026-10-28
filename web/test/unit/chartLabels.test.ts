/**
 * Team labels in charts fit their room (data/chartLabels.ts): ESPN's 2–5
 * letters as they are, longer ones shrunk to 80%, then cut at a whole
 * character with an ellipsis; a gutter grows a little for a long label.
 * The worst cases are break-ui's: a club's whole name, one letter, an
 * unbreakable string, accents, flags and other scripts, empty.
 */
import { describe, expect, it } from "vitest";
import { fitLabel, graphemes, labelGutter, type Measure } from "../../src/data/chartLabels";

/** About SF's caps at 600: 0.68 of the size per character (an ellipsis counts as one). */
const measure: Measure = (text, size) => graphemes(text).length * size * 0.68;

describe("fitLabel", () => {
  it("leaves ESPN's abbreviations alone", () => {
    for (const abbr of ["MCI", "LIV", "WOLV", "UMASS"]) {
      // A 30pt gutter keeps 24pt for its label; five caps at 9pt are 30.6pt wide, four are 24.5.
      const fit = fitLabel(abbr, 31, measure);
      expect(fit).toEqual({ text: abbr, size: 9, cut: false });
    }
  });

  it("shrinks a label that's a little long, no further than 80%", () => {
    const fit = fitLabel("WOLVES", 34, measure);
    expect(fit.cut).toBe(false);
    expect(fit.size).toBeLessThan(9);
    expect(fit.size).toBeGreaterThanOrEqual(9 * 0.8);
    expect(measure(fit.text, fit.size, 600)).toBeLessThanOrEqual(34);
  });

  it("cuts a long one at 80% with an ellipsis, and it fits", () => {
    const fit = fitLabel("WOLVERHAMPTON", 24, measure);
    expect(fit.cut).toBe(true);
    expect(fit.size).toBeCloseTo(7.2);
    expect(fit.text.endsWith("…")).toBe(true);
    expect("WOLVERHAMPTON".startsWith(fit.text.slice(0, -1))).toBe(true);
    expect(measure(fit.text, fit.size, 600)).toBeLessThanOrEqual(24);
  });

  it("never splits a flag, an accent or a character of another script", () => {
    const flags = fitLabel("🇸🇮🇯🇵🇺🇸🇫🇷🇮🇹", 20, measure);
    expect(flags.cut).toBe(true);
    // Every flag kept is whole: an even number of regional indicators before the ellipsis.
    expect([...flags.text.slice(0, -1)].length % 2).toBe(0);
    const accented = fitLabel("Borussiamönchengladbach", 30, measure);
    expect(accented.text.normalize("NFC")).toBe(accented.text);
    const decomposed = "Málaga Club de Fútbol";
    const cut = fitLabel(decomposed, 24, measure);
    expect(cut.text.slice(0, -1).endsWith("́")).toBe(false);
    const cjk = fitLabel("横浜F・マリノス", 22, measure);
    expect(cjk.cut).toBe(true);
    expect(measure(cjk.text, cjk.size, 600)).toBeLessThanOrEqual(22);
  });

  it("doesn't end a cut on a space or punctuation", () => {
    const fit = fitLabel("AB. CDEFGHIJ", 26, measure);
    expect(fit.text).toMatch(/[^\s.,·:;–—-]…$/u);
  });

  it("keeps one character when nothing more fits", () => {
    expect(fitLabel("WOLVERHAMPTON", 6, measure).text).toBe("W…");
  });

  it("passes empty and one-letter labels through", () => {
    expect(fitLabel("", 24, measure)).toEqual({ text: "", size: 9, cut: false });
    expect(fitLabel("  ", 24, measure).text).toBe("");
    expect(fitLabel("A", 24, measure)).toEqual({ text: "A", size: 9, cut: false });
  });
});

describe("labelGutter", () => {
  it("is the Mac's 30pt for ESPN's abbreviations", () => {
    expect(labelGutter(["MCI", "AVL"], measure)).toBe(30);
    expect(labelGutter(["", ""], measure)).toBe(30);
  });

  it("grows for a long label, never past 44pt", () => {
    const g = labelGutter(["MCI", "WOLVES"], measure);
    expect(g).toBeGreaterThan(30);
    expect(g).toBeLessThanOrEqual(44);
    expect(labelGutter(["WOLVERHAMPTON", "BORUSSIAMÖNCHENGLADBACH"], measure)).toBe(44);
  });
});
