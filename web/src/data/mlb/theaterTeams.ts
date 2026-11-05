/**
 * How the theaters dress the two teams (PlayTheater.swift `TheaterKits`,
 * `Uniform`, `TheaterTeams.dress`): as the game's colors have them
 * (data/matchColors.ts, decided once), toned for this page.
 *
 * Colors are hex strings. A `null` accent means the page's primary ink (a
 * team with no usable color).
 */
import type { Side } from "../models";
import { APART, matchColors, uniform, type MatchColors } from "../matchColors";
import { chroma, hue, labDistance, oklabFromHex, toHex, type OKLab, type Scheme } from "../teamColors";

export type { TeamKit } from "../matchColors";
export { APART } from "../matchColors";
export { labDistance } from "../teamColors";

/** The theaters' name for a game's colors (`MatchColors`): what each side wears. */
export type TheaterKits = MatchColors;

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

/** Both sides as this game has them, toned for this page. (pure; tested) */
export function dress(kits: TheaterKits, scheme: Scheme): { top: Uniform; bottom: Uniform } {
  return { top: uniform(kits.top, scheme), bottom: uniform(kits.bottom, scheme) };
}

/**
 * Kits from two teams' colors alone (the dev previews' and the tests'
 * shorthand), decided by the game's rule: the visitors on top, home below
 * unless said otherwise.
 */
export function kitsOf(
  top: { readonly color: string | null; readonly alternate: string | null },
  bottom: { readonly color: string | null; readonly alternate: string | null },
  home: Side = "bottom",
): TheaterKits {
  return matchColors(top, bottom, { home });
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
