/**
 * Team colors fitted to the page (TeamColors.swift `OKLab`, `TeamTone`;
 * Visualizations.swift `TeamPalette`; VizKit.swift `Viz.washStrength`).
 *
 * Only lightness moves (dark colors lift on a dark page, pale ones deepen on
 * a light one), so hue and saturation, the things that tell two teams apart,
 * are kept. A color with no usable hue comes back as null and is shown
 * honestly as neutral gray. Two near-identical teams: the second goes neutral.
 *
 * Team colors are for marks and washes only, never for text.
 */

export type Scheme = "light" | "dark";

export interface OKLab {
  readonly l: number;
  readonly a: number;
  readonly b: number;
}

function linear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** From sRGB components in 0…1. */
export function oklabFromRGB(red: number, green: number, blue: number): OKLab {
  const r = linear(red);
  const g = linear(green);
  const bl = linear(blue);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * bl);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * bl);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * bl);
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export function oklabFromHex(hex: string | null | undefined): OKLab | null {
  if (!hex) return null;
  const digits = hex.startsWith("#") ? hex.slice(1) : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(digits)) return null;
  const v = Number.parseInt(digits, 16);
  return oklabFromRGB(((v >> 16) & 0xff) / 255, ((v >> 8) & 0xff) / 255, (v & 0xff) / 255);
}

export const chroma = (c: OKLab) => Math.hypot(c.a, c.b);

/** Degrees, 0..<360. */
export function hue(c: OKLab): number {
  const h = (Math.atan2(c.b, c.a) * 180) / Math.PI;
  return h < 0 ? h + 360 : h;
}

function fromLCH(l: number, c: number, h: number): OKLab {
  const r = (h * Math.PI) / 180;
  return { l, a: c * Math.cos(r), b: c * Math.sin(r) };
}

function linearRGB(c: OKLab): [number, number, number] {
  const l = (c.l + 0.3963377774 * c.a + 0.2158037573 * c.b) ** 3;
  const m = (c.l - 0.1055613458 * c.a - 0.0638541728 * c.b) ** 3;
  const s = (c.l - 0.0894841775 * c.a - 1.291485548 * c.b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (c: OKLab) => linearRGB(c).every((v) => v >= -0.0001 && v <= 1.0001);

/** sRGB components in 0…1. Out-of-gamut colors keep lightness and hue and give up chroma until they fit. */
export function toRGB(color: OKLab): [number, number, number] {
  let c = color;
  if (!inGamut(c)) {
    let lo = 0;
    let hi = chroma(c);
    const h = hue(c);
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(fromLCH(c.l, mid, h))) lo = mid;
      else hi = mid;
    }
    c = fromLCH(c.l, lo, h);
  }
  const encode = (v: number) => {
    const x = Math.min(Math.max(v, 0), 1);
    return x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055;
  };
  const [r, g, b] = linearRGB(c);
  return [encode(r), encode(g), encode(b)];
}

export function toHex(c: OKLab): string {
  return `#${toRGB(c)
    .map((v) => Math.round(v * 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** A team color fitted to the scheme, or null when it has no usable hue here (TeamTone.adjust). */
export function teamTone(hex: string | null | undefined, scheme: Scheme): string | null {
  let lab = oklabFromHex(hex);
  if (!lab) return null;
  const gray = chroma(lab) < 0.03;
  if (scheme === "dark") {
    // Black has nothing to lift into.
    if (gray && lab.l < 0.3) return null;
    // 0.68: every team mark clears 3:1 against the dark chart plate.
    if (lab.l < 0.68) {
      // Lifting lightness alone washes a color out (navy would read as
      // slate), so chroma rises with it, gently, to keep its character.
      const lift = 0.68 / Math.max(lab.l, 0.2);
      lab = fromLCH(0.68, chroma(lab) * Math.min(lift ** 0.5, 1.8), hue(lab));
    } else if (lab.l > 0.86) {
      // Near-white would out-shout the other team.
      lab = { l: 0.86, a: lab.a, b: lab.b };
    }
  } else {
    if (gray && lab.l > 0.95) return null;
    // Yellow only exists light: deepened as far as other hues, it turns olive.
    // Others stop at 0.62, which keeps pale ones (sky blue) near 3.6:1 on white.
    const h = hue(lab);
    const cap = h >= 75 && h <= 115 && chroma(lab) > 0.08 ? 0.8 : 0.62;
    if (lab.l > cap) lab = fromLCH(cap, chroma(lab), h);
  }
  return toHex(lab);
}

/** Relative luminance of an sRGB hex, 0…1 (Viz.luminance: the plain weighted sum, as the Swift does). */
export function luminance(hex: string): number {
  const v = Number.parseInt(hex.replace("#", ""), 16);
  if (Number.isNaN(v)) return 0.5;
  return 0.2126 * (((v >> 16) & 0xff) / 255) + 0.7152 * (((v >> 8) & 0xff) / 255) + 0.0722 * ((v & 0xff) / 255);
}

/** The hero wash's strength for a color: very light ones (Spurs white, NaVi yellow) are capped so text over them stays legible. */
export function washStrength(hex: string, intensity = 1): number {
  return (luminance(hex) > 0.7 ? 0.4 : 0.6) * intensity;
}

/** The neutral a color falls back to (CSS variable: secondary ink). */
export const NEUTRAL = "var(--viz-neutral)";

export interface TeamPalette {
  /** A CSS color: a hex, or `NEUTRAL`. */
  readonly top: string;
  readonly bottom: string;
}

/**
 * The two teams' colors on this page (Swift `TeamPalette`). No color given:
 * the system's blue and orange. Two near-identical colors can't be told
 * apart: the second goes neutral.
 */
export function teamPalette(top: string | null, bottom: string | null, scheme: Scheme): TeamPalette {
  const resolve = (hex: string | null, fallback: string): { css: string; hex: string | null } => {
    if (!oklabFromHex(hex)) return { css: fallback, hex: null };
    const toned = teamTone(hex, scheme);
    return toned ? { css: toned, hex: toned } : { css: NEUTRAL, hex: null };
  };
  const t = resolve(top, scheme === "dark" ? "#0a84ff" : "#007aff");
  const b = resolve(bottom, scheme === "dark" ? "#ff9f0a" : "#ff9500");
  if (t.hex && b.hex) {
    const x = Number.parseInt(t.hex.slice(1), 16);
    const y = Number.parseInt(b.hex.slice(1), 16);
    const channel = (v: number, shift: number) => ((v >> shift) & 0xff) / 255;
    const distance = [16, 8, 0].reduce((sum, s) => sum + Math.abs(channel(x, s) - channel(y, s)), 0);
    if (distance < 0.35) return { top: t.css, bottom: NEUTRAL };
  }
  return { top: t.css, bottom: b.css };
}
