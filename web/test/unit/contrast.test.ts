/**
 * Text colors clear WCAG AA (4.5:1) on the surfaces they sit on, in both
 * themes, read straight from tokens.css. Glyph-only tokens (tertiary ink)
 * aren't text and aren't checked.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(import.meta.dirname, "..", "..", "src", "design", "tokens.css"), "utf8");
// The base :root block only (before the media and theme overrides).
const base = css.slice(css.indexOf(":root {"), css.indexOf(":root[data-theme"));

type RGBA = [number, number, number, number];

function token(name: string): { light: RGBA; dark: RGBA } {
  const match = base.match(new RegExp(`--${name}:\\s*light-dark\\((.+?),\\s*((?:rgb|#)[^;]+?)\\);`));
  if (!match) throw new Error(`No light-dark token --${name}`);
  return { light: parse(match[1]!.trim()), dark: parse(match[2]!.trim()) };
}

function parse(value: string): RGBA {
  if (value.startsWith("#")) {
    const v = Number.parseInt(value.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255, 1];
  }
  const m = value.match(/rgb\((\d+) (\d+) (\d+)(?: \/ ([\d.]+))?\)/);
  if (!m) throw new Error(`Can't parse ${value}`);
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ? Number(m[4]) : 1];
}

/** `top` composited over an opaque `bottom`. */
function over(top: RGBA, bottom: RGBA): RGBA {
  const a = top[3];
  return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a), 1];
}

function luminance([r, g, b]: RGBA): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(text: RGBA, background: RGBA): number {
  const fg = over(text, background);
  const [a, b] = [luminance(fg), luminance(background)].sort((x, y) => y - x) as [number, number];
  return (a + 0.05) / (b + 0.05);
}

const TEXT = ["label", "label-secondary", "accent-text", "live-text", "delayed-text"];

describe("text contrast", () => {
  for (const scheme of ["light", "dark"] as const) {
    const page = token("page")[scheme];
    // The sidebar: glass over the page (the ambient light is faint enough to ignore here).
    const glass = over(token("glass-fill")[scheme], page);
    // A hovered or tinted row.
    const tinted = over(token("fill-press")[scheme], glass);
    for (const name of TEXT) {
      it(`--${name} reads at 4.5:1 or better in ${scheme}`, () => {
        const ink = token(name)[scheme];
        for (const [surface, bg] of [
          ["page", page],
          ["glass", glass],
          ["a pressed row", tinted],
        ] as const) {
          expect(contrast(ink, bg), `${name} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
      });
    }
  }
});
