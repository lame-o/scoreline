/**
 * The theater's colors (PlayTheater.swift `TheaterInk`): the field is
 * tinted, not painted, grass and clay at low strength, so team colors carry
 * the figures, in either appearance. Resolved once per scheme (never per
 * frame) into CSS color strings and RGB triples for alpha drawn per beat.
 */
import { oklabFromHex, toHex } from "../../../../data/teamColors";

export type RGB = readonly [number, number, number];

export const rgba = (c: RGB, a: number) => `rgb(${c[0]} ${c[1]} ${c[2]} / ${Math.max(0, Math.min(1, a)).toFixed(3)})`;

/** SwiftUI's `Color(hue:saturation:brightness:)` (all 0…1) as 0…255 RGB. */
export function hsb(h: number, s: number, v: number): RGB {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const [r, g, b] = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ][((i % 6) + 6) % 6]!;
  return [Math.round(r! * 255), Math.round(g! * 255), Math.round(b! * 255)];
}

export function hexRGB(hex: string): RGB {
  const v = Number.parseInt(hex.replace("#", "").slice(0, 6), 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

/** Part way from one hex color to another, in OKLab (SwiftUI's perceptual `mix`). */
export function mixHex(a: string, b: string, by: number): string {
  const x = oklabFromHex(a.slice(0, 7));
  const y = oklabFromHex(b.slice(0, 7));
  if (!x || !y) return a;
  return toHex({ l: x.l + (y.l - x.l) * by, a: x.a + (y.a - x.a) * by, b: x.b + (y.b - x.b) * by });
}

export interface TheaterInk {
  readonly dark: boolean;
  readonly grass: string;
  readonly infield: string;
  readonly dirt: string;
  /** The warning track: the clay at 70%. */
  readonly track: string;
  readonly chalk: string;
  readonly chalkBoxes: string;
  readonly wall: string;
  readonly wallTop: string;
  readonly stands: string;
  /** The foul poles: the system yellow. */
  readonly pole: string;
  readonly shadow: RGB;
  readonly shadowAlpha: number;
  /** The rim that separates a figure from the lines under it. */
  readonly halo: string;
  readonly ball: RGB;
  readonly ballEdge: string;
  /** Round the ball: light in the dark, a soft shade in the light. */
  readonly glow: RGB;
  readonly glowAlpha: number;
  readonly trace: RGB;
  /** What a grounder kicks up. */
  readonly dust: RGB;
  /** The lighter stripes of the mowing. */
  readonly mow: string;
  /** Gold type: the system yellow in the dark, a deep amber that reads on a light panel. */
  readonly gold: string;
  readonly bat: string;
  /** The page's ink (Color.primary) and its secondary. */
  readonly primary: RGB;
  readonly primaryAlpha: number;
  readonly secondary: string;
  readonly red: RGB;
  readonly orange: RGB;
  readonly accent: string;
  readonly yellow: string;
}

export function theaterInk(scheme: "light" | "dark"): TheaterInk {
  const dark = scheme === "dark";
  const ink: RGB = dark ? [255, 255, 255] : [0, 0, 0];
  const primary = (a: number) => rgba(ink, a);
  const grass = hsb(0.36, dark ? 0.42 : 0.38, dark ? 0.62 : 0.6);
  const infield = hsb(0.36, dark ? 0.42 : 0.38, dark ? 0.66 : 0.62);
  const dirt = hsb(0.075, dark ? 0.38 : 0.42, dark ? 0.82 : 0.78);
  const dirtAlpha = dark ? 0.22 : 0.3;
  const chalkAlpha = dark ? 0.55 : 0.95;
  const yellow = dark ? "#ffd60a" : "#ffcc00";
  return {
    dark,
    grass: rgba(grass, 0.2),
    infield: rgba(infield, 0.26),
    dirt: rgba(dirt, dirtAlpha),
    track: rgba(dirt, dirtAlpha * 0.7),
    chalk: rgba([255, 255, 255], chalkAlpha),
    chalkBoxes: rgba([255, 255, 255], chalkAlpha * 0.6),
    wall: primary(dark ? 0.1 : 0.07),
    wallTop: primary(dark ? 0.3 : 0.22),
    stands: primary(dark ? 0.045 : 0.035),
    pole: `${yellow}d9`,
    shadow: [0, 0, 0],
    shadowAlpha: dark ? 0.42 : 0.16,
    halo: dark ? "rgb(0 0 0 / 0.5)" : "rgb(255 255 255 / 0.9)",
    ball: [255, 255, 255],
    ballEdge: dark ? "rgb(0 0 0 / 0.35)" : "rgb(0 0 0 / 0.45)",
    glow: dark ? [255, 255, 255] : [0, 0, 0],
    glowAlpha: dark ? 1 : 0.5,
    trace: ink,
    dust: hsb(0.08, dark ? 0.25 : 0.35, dark ? 0.85 : 0.62),
    mow: dark ? "rgb(255 255 255 / 0.014)" : "rgb(255 255 255 / 0.11)",
    gold: dark ? yellow : "#c78500",
    bat: rgba(hsb(0.09, 0.35, 0.85), 1),
    primary: ink,
    primaryAlpha: dark ? 0.88 : 0.86,
    secondary: dark ? "rgb(255 255 255 / 0.58)" : "rgb(0 0 0 / 0.56)",
    red: dark ? [255, 69, 58] : [255, 59, 48],
    orange: dark ? [255, 159, 10] : [255, 149, 0],
    accent: dark ? "#0a84ff" : "#007aff",
    yellow,
  };
}
