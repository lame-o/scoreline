/**
 * How the play theater dresses the two teams (PlayTheater.swift
 * `TeamKit`, `TheaterKits`, `Uniform`, `TheaterTeams.dress`): always told
 * apart at a glance on small figures, in either appearance.
 *
 * Colors are hex strings. A `null` accent means the page's primary ink (a
 * team with no usable color).
 */
import type { Side } from "../models";
import { chroma, hue, oklabFromHex, teamTone, toHex, type OKLab, type Scheme } from "../teamColors";

/** A team's colors as the source gives them (hex): its own and its second. */
export interface TeamKit {
  readonly color: string | null;
  readonly alternate: string | null;
}

/** Both teams' kits, top (visitors) and bottom (home). */
export interface TheaterKits {
  readonly top: TeamKit;
  readonly bottom: TeamKit;
}

/** How a team's figures are dressed. */
export interface Uniform {
  /** Body and limbs. */
  readonly jersey: string;
  /** The head: always the team's own color. */
  readonly cap: string;
  /** A rim in the team's color round light uniforms on a light field (null: the ink's halo). */
  readonly piping: string | null;
  /** Type in the team's color: a hit's stamp, the banner, the runs pill. Null: the primary ink. */
  readonly accent: string | null;
  /** An official's shirt: a few bold stripes of this color down the body, inside the figure (none: a plain jersey). */
  readonly stripes?: string | null;
  /** An official's shorts or slacks: the legs in this color (none: the jersey's). */
  readonly legs?: string | null;
}

export interface TheaterTeams {
  readonly batting: Uniform;
  readonly fielding: Uniform;
}

/** Which way the pair was dressed: their own colors, one side in its second color, or the home team in whites. */
export type DressRule = { readonly kind: "own" } | { readonly kind: "second"; readonly side: Side } | { readonly kind: "whites"; readonly side: Side };

/** Below this (OKLab distance, as each color is shown) two teams look alike on small figures. */
export const APART = 0.15;

export const labDistance = (a: OKLab, b: OKLab) => Math.hypot(a.l - b.l, a.a - b.a, a.b - b.b);

const fromLCH = (l: number, c: number, h: number): OKLab => {
  const r = (h * Math.PI) / 180;
  return { l, a: c * Math.cos(r), b: c * Math.sin(r) };
};

/** A gray as SwiftUI's `Color(white:)` draws it. */
const white = (v: number) => {
  const c = Math.round(Math.min(Math.max(v, 0), 1) * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${c}${c}${c}`;
};

/**
 * Dresses both teams so they always contrast. Each color is first fitted to
 * the panel as the charts fit it (`teamTone`): when the two read apart
 * they're worn as they are. When they're too close (two navies), a team
 * changes into its second color, whichever separates the pair more, if it's
 * a real color that does. Failing that, the home team wears whites (light
 * against the other team's color), or in light mode charcoal against a pale
 * one; its cap keeps its own color either way. (pure; tested)
 */
export function dress(kits: TheaterKits, scheme: Scheme): { top: Uniform; bottom: Uniform; rule: DressRule } {
  const dark = scheme === "dark";
  const toned = (hex: string | null): OKLab | null => oklabFromHex(teamTone(hex, scheme));
  const gray: OKLab = { l: dark ? 0.72 : 0.5, a: 0, b: 0 };
  const own = { top: toned(kits.top.color), bottom: toned(kits.bottom.color) };
  const top = own.top ?? gray;
  const bottom = own.bottom ?? gray;
  const color = (lab: OKLab) => toHex(lab);
  // Type in a pale team color (gold) deepens on a light panel, keeping its hue.
  const accent = (lab: OKLab | null): string | null => {
    if (!lab) return null;
    return color(!dark && lab.l > 0.7 ? fromLCH(0.6, chroma(lab), hue(lab)) : lab);
  };
  // On a light panel a pale jersey (gold, sky blue) needs a rim of its own, deepened, not the white halo.
  const uniform = (lab: OKLab, accentColor: string | null): Uniform => ({
    jersey: color(lab),
    cap: color(lab),
    piping: !dark && lab.l > 0.7 ? color(fromLCH(0.42, chroma(lab), hue(lab))) : null,
    accent: accentColor,
  });
  if (labDistance(top, bottom) >= APART) {
    return { top: uniform(top, accent(own.top)), bottom: uniform(bottom, accent(own.bottom)), rule: { kind: "own" } };
  }
  // A second color: a real color (not white, black or gray) that reads apart.
  const seconds: { side: Side; lab: OKLab }[] = [];
  for (const [side, hex] of [
    ["top", kits.top.alternate],
    ["bottom", kits.bottom.alternate],
  ] as const) {
    const lab = toned(hex);
    if (lab && chroma(lab) >= 0.06) seconds.push({ side, lab });
  }
  let best: { side: Side; lab: OKLab } | null = null;
  let bestDistance = -Infinity;
  for (const s of seconds) {
    const d = s.side === "top" ? labDistance(s.lab, bottom) : labDistance(top, s.lab);
    if (d >= APART && d > bestDistance) {
      best = s;
      bestDistance = d;
    }
  }
  if (best) {
    const wearer = uniform(best.lab, accent(best.lab));
    const other = best.side === "top" ? bottom : top;
    const rest = uniform(other, accent(best.side === "top" ? own.bottom : own.top));
    return best.side === "top"
      ? { top: wearer, bottom: rest, rule: { kind: "second", side: "top" } }
      : { top: rest, bottom: wearer, rule: { kind: "second", side: "bottom" } };
  }
  // Home whites: light against dark. In light mode a pale visitor gets charcoal instead.
  const charcoal = !dark && top.l >= 0.6;
  const jersey = charcoal ? white(0.24) : white(dark ? 0.96 : 1);
  const home: Uniform = {
    jersey,
    cap: color(bottom),
    piping: dark || charcoal ? null : `${color(bottom)}e6`,
    accent: accent(own.bottom),
  };
  return { top: uniform(top, accent(own.top)), bottom: home, rule: { kind: "whites", side: "bottom" } };
}

/**
 * The officials' kits (PlayTheater.swift `Uniform.zebra`, `.referee`,
 * `.umpire`), one look per sport so they never pass for a team's men (on
 * the field only while the data has one doing something): football's and
 * basketball's zebra shirt with black trousers, soccer's
 * referee in FIFA yellow with black shorts, baseball's umpire in navy with
 * gray slacks; a black cap on each. On a light panel a pale shirt takes a
 * rim of its own, as home whites do, instead of the white halo.
 */
const OFFICIAL_CAP = white(0.12);
const BLACK_KIT = white(0.12);

/** Football's and basketball's officials: the zebra shirt (a few bold black stripes on white: rigFigure.ts `zebra`), black trousers. */
export function zebra(scheme: Scheme): Uniform {
  return { jersey: white(0.96), cap: OFFICIAL_CAP, piping: scheme === "dark" ? null : white(0.3), accent: "#ffffff", stripes: white(0.08), legs: BLACK_KIT };
}

/** Baseball's umpire: a navy shirt, gray slacks. */
export function umpire(scheme: Scheme): Uniform {
  return { jersey: "#213152", cap: OFFICIAL_CAP, piping: null, accent: "#ffffff", legs: white(scheme === "dark" ? 0.62 : 0.55) };
}

/** The referee's shirts, in the order he reaches for them. */
export const REFEREE_SHIRTS = ["#fad61a", "#db2933", "#009e99", BLACK_KIT] as const;

/**
 * Soccer's referee and his assistants: FIFA yellow with black shorts, or,
 * when yellow reads too close to either team's shirt, the first of red,
 * teal and black that reads apart from both.
 */
export function referee(shirts: readonly string[], scheme: Scheme): Uniform {
  const teams = shirts.map(oklabFromHex).filter((lab): lab is OKLab => lab !== null);
  const clearance = (hex: string) => {
    const own = oklabFromHex(hex);
    if (own === null) return 0;
    return teams.length === 0 ? Infinity : Math.min(...teams.map((t) => labDistance(own, t)));
  };
  const shirt =
    REFEREE_SHIRTS.find((hex) => clearance(hex) >= APART) ??
    REFEREE_SHIRTS.reduce((best, hex) => (clearance(hex) > clearance(best) ? hex : best), REFEREE_SHIRTS[0]);
  const lab = oklabFromHex(shirt);
  const rim = lab !== null && scheme === "light" && lab.l > 0.7 ? toHex(fromLCH(0.42, chroma(lab), hue(lab))) : null;
  return { jersey: shirt, cap: OFFICIAL_CAP, piping: rim, accent: shirt, legs: BLACK_KIT };
}

/** The pair as batting and fielding, for the play's batting side (else the live one; else the visitors, who bat first). */
export function theaterTeams(kits: TheaterKits, scheme: Scheme, batting: Side | null): TheaterTeams {
  const dressed = dress(kits, scheme);
  return (batting ?? "top") === "top" ? { batting: dressed.top, fielding: dressed.bottom } : { batting: dressed.bottom, fielding: dressed.top };
}
