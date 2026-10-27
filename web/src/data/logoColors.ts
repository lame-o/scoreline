/**
 * Each team's own colors, read from its logo (TeamColors.swift `read`,
 * `dominant`, `order`): the colors the crest reads as, ignoring white,
 * black, grays and transparency, strongest first. Sources give at most one
 * team color, often a stock navy half a league shares, and none at all for
 * CS2, so the logo is the better witness. Pure: pixels in, colors out.
 */
import type { Competitor } from "./models";
import { chroma, hue, oklabFromHex, oklabFromRGB, toHex, type OKLab } from "./teamColors";

export interface LogoColors {
  /** Up to three clearly different colors ("#c8102e"), strongest first. Empty: a black-and-white crest. */
  readonly colors: readonly string[];
  /** How strongly the logo reads as each, relative to the first (1). */
  readonly weights: readonly number[];
}

const distance = (x: OKLab, y: OKLab) => Math.hypot(x.l - y.l, x.a - y.a, x.b - y.b);

function hueGap(x: number, y: number): number {
  const d = Math.abs(x - y);
  return d > 180 ? 360 - d : d;
}

/** Navy (dark and muted) counts for less than the gold or Beale Street blue it frames, which is the color people see. */
function vividness(c: OKLab): number {
  const navy = c.l < 0.4 && chroma(c) < 0.11 ? 0.5 : 1;
  return Math.min(Math.max(chroma(c) / 0.12, 0.35), 1.5) * navy;
}

/** Another hue, or far lighter or darker: not a second shade of the same gold. */
function distinct(x: OKLab, y: OKLab): boolean {
  return hueGap(hue(x), hue(y)) >= 30 || Math.abs(x.l - y.l) >= 0.22;
}

interface Found {
  readonly color: OKLab;
  readonly count: number;
  readonly weight: number;
}

/**
 * The color the logo reads as: bin by hue and lightness, take the heaviest
 * bin, then average everything near its mean so a color straddling two bins
 * isn't split.
 */
function dominant(colors: readonly OKLab[]): Found | null {
  if (colors.length === 0) return null;
  const bins = new Map<number, { weight: number; l: number; a: number; b: number; n: number }>();
  for (const c of colors) {
    const key = Math.floor(hue(c) / 20) * 4 + Math.min(Math.floor(c.l / 0.25), 3);
    const bin = bins.get(key) ?? { weight: 0, l: 0, a: 0, b: 0, n: 0 };
    bin.weight += vividness(c);
    bin.l += c.l;
    bin.a += c.a;
    bin.b += c.b;
    bin.n += 1;
    bins.set(key, bin);
  }
  let top: { weight: number; l: number; a: number; b: number; n: number } | null = null;
  for (const bin of bins.values()) if (!top || bin.weight > top.weight) top = bin;
  if (!top) return null;
  const center = { l: top.l / top.n, a: top.a / top.n, b: top.b / top.n };
  const near = colors.filter((c) => distance(c, center) <= 0.09);
  if (near.length === 0) return { color: center, count: top.n, weight: top.weight };
  const n = near.length;
  const mean = { l: near.reduce((s, c) => s + c.l, 0) / n, a: near.reduce((s, c) => s + c.a, 0) / n, b: near.reduce((s, c) => s + c.b, 0) / n };
  return { color: mean, count: n, weight: near.reduce((s, c) => s + vividness(c), 0) };
}

/** Reads straight-alpha RGBA pixels (canvas `getImageData`). */
export function readLogoColors(pixels: Uint8ClampedArray | readonly number[]): LogoColors {
  let opaque = 0;
  const colors: OKLab[] = [];
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    // Antialiased edges are a blend with the background: skip them.
    if (pixels[i + 3]! / 255 <= 0.7) continue;
    opaque += 1;
    const lab = oklabFromRGB(pixels[i]! / 255, pixels[i + 1]! / 255, pixels[i + 2]! / 255);
    if (chroma(lab) >= 0.04) colors.push(lab);
  }
  // A sliver of color in a black-and-white crest isn't the team's color.
  if (opaque === 0 || colors.length / opaque < 0.04) return { colors: [], weights: [] };

  const found: Found[] = [];
  let rest = colors;
  for (let i = 0; i < 6 && found.length < 3; i++) {
    const next = dominant(rest);
    if (!next) break;
    const first = found[0];
    if (first && next.count < Math.max(first.count / 8, 12)) break;
    if (found.every((f) => distinct(next.color, f.color))) found.push(next);
    rest = rest.filter((c) => distance(c, next.color) > 0.1);
  }
  // Found in bin order; a later color can turn out heavier once its neighbors are gathered in.
  found.sort((a, b) => b.weight - a.weight);
  const top = found[0]?.weight ?? 1;
  return { colors: found.map((f) => toHex(f.color)), weights: found.map((f) => Math.round((f.weight / top) * 100) / 100) };
}

/**
 * The logo's colors in the order a team wears them. When the logo reads
 * almost as strongly as the source's own color as its first one, the
 * source's tips it (Thunder blue over the sunset band). A navy source color
 * never does: that's the shade half a league shares.
 */
export function orderLogoColors(entry: LogoColors, source: string | null): string[] {
  const colors = [...entry.colors];
  const s = oklabFromHex(source);
  if (!s || !(chroma(s) >= 0.12 || (s.l >= 0.4 && chroma(s) >= 0.06))) return colors;
  const match = colors.findIndex((hex, i) => {
    if (i === 0) return false;
    const lab = oklabFromHex(hex);
    return lab != null && hueGap(hue(lab), hue(s)) <= 25 && Math.abs(lab.l - s.l) <= 0.25;
  });
  if (match < 1 || (entry.weights[match] ?? 0) < 0.6) return colors;
  colors.unshift(...colors.splice(match, 1));
  return colors;
}

/** The competitor wearing its logo's colors, when they're known and not black and white. */
export function wearLogoColors(c: Competitor, entry: LogoColors | undefined): Competitor {
  if (!entry || entry.colors.length === 0) return c;
  const colors = orderLogoColors(entry, c.color);
  const color = colors[0]!.replace("#", "");
  const alternate = colors[1]?.replace("#", "") ?? c.alternateColor;
  return color === c.color && alternate === c.alternateColor ? c : { ...c, color, alternateColor: alternate };
}
