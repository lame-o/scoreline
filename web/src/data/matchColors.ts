/**
 * One game's colors, decided once (MatchColors.swift).
 *
 * A team has its identity (the club's own color: the page's wash, the hero's
 * crests, a tile's wash) and, for this game, a kit: what its men wear on the
 * field and what every mark of theirs is drawn in, the charts, the tags, the
 * docked bar and the end zones, so the chart and the field can't name a team
 * by different colors. The kit is the match-day kit where the source has one
 * (ESPN's soccer summaries, once lineups post), else the team's own color. On
 * a clash the rule is the sport's: home keeps its kit and the away side
 * changes. Light and dark don't come into it: the decision is made once, for
 * both, and the scheme only tones what's drawn.
 *
 * Pure, and light: the scores list's tiles read it.
 */
import { at, str, type JSONValue } from "./json";
import type { ScoreEvent, Side } from "./models";
import type { Uniform } from "./mlb/theaterTeams";
import { chroma, fromLCH, hue, labDistance, oklabFromHex, teamPalette, toHex, toneLab, wornLab, type OKLab, type Scheme, type TeamPalette } from "./teamColors";

/** A team's colors as a source gives them (hex): its own and its second. */
export interface TeamKit {
  readonly color: string | null;
  readonly alternate: string | null;
}

export const NO_KIT: TeamKit = { color: null, alternate: null };

/**
 * ESPN's `uniform` (`{type, color, alternateColor}`). `type` names the kit
 * (home, away, third), not the side wearing it: it isn't read. (pure)
 */
export function teamKitFromUniform(uniform: JSONValue): TeamKit | null {
  const color = str(at(uniform, "color"));
  if (!color || !oklabFromHex(color)) return null;
  const alternate = str(at(uniform, "alternateColor"));
  return { color, alternate: alternate && oklabFromHex(alternate) ? alternate : null };
}

/**
 * How a side comes to wear what it's wearing: its own kit (the match-day kit,
 * else the team's color); away on a clash, its second color; away with no
 * second color that reads apart, white (charcoal against a pale home kit).
 */
export type Wear = "own" | "second" | "contrast";

export interface MatchTeam {
  /** The club's own colors. */
  readonly identity: TeamKit;
  /** What its men wear in this game (null: nothing known). */
  readonly color: string | null;
  /** The kit's trim; a side that changed, its own color. */
  readonly alternate: string | null;
  readonly wear: Wear;
}

export interface MatchColors {
  readonly top: MatchTeam;
  readonly bottom: MatchTeam;
  readonly home: Side;
}

/** Below this (OKLab distance, in the less forgiving scheme) two kits look alike. */
export const APART = 0.12;
export const WHITE = "ffffff";
export const CHARCOAL = "3d3d3d";

export interface MatchKits {
  readonly topKit?: TeamKit | null;
  readonly bottomKit?: TeamKit | null;
  /** Default: the bottom team, as the North American sports list them. */
  readonly home?: Side;
}

/**
 * The rule: home keeps its kit. On a clash, away changes: to its kit's
 * second color, then its team's, then white (charcoal if home is pale).
 * (pure; tested)
 */
export function matchColors(top: TeamKit, bottom: TeamKit, { topKit = null, bottomKit = null, home = "bottom" }: MatchKits = {}): MatchColors {
  const wearing = (own: TeamKit, kit: TeamKit | null): MatchTeam => ({
    identity: own,
    color: kit?.color ?? own.color,
    alternate: kit?.alternate ?? own.alternate,
    wear: "own",
  });
  let t = wearing(top, topKit);
  let b = wearing(bottom, bottomKit);
  const homeColor = (home === "top" ? t : b).color;
  const awayColor = (home === "top" ? b : t).color;
  if (homeColor == null || awayColor == null || readApart(homeColor, awayColor)) return { top: t, bottom: b, home };
  const away = home === "top" ? bottom : top;
  const seconds = [home === "top" ? bottomKit?.alternate : topKit?.alternate, away.alternate].filter((c): c is string => c != null);
  const second = seconds.find((c) => readApart(homeColor, c));
  let changed: MatchTeam;
  if (second != null) {
    changed = { identity: away, color: second, alternate: awayColor, wear: "second" };
  } else {
    const pale = (oklabFromHex(homeColor)?.l ?? 0) >= 0.6;
    changed = { identity: away, color: pale ? CHARCOAL : WHITE, alternate: away.color, wear: "contrast" };
  }
  if (home === "top") b = changed;
  else t = changed;
  return { top: t, bottom: b, home };
}

/** Nothing known of either side: both drawn in the page's grays. */
export const NO_KITS: MatchColors = matchColors(NO_KIT, NO_KIT);

/** Soccer lists the home side first; the North American sports, away first (Event.listsHomeFirst). */
export function listsHomeFirst(event: ScoreEvent): boolean {
  return event.ref?.kind === "espn" && event.ref.sport === "soccer";
}

/**
 * A game's colors (`topIsHome`: as its summary says; else as its sport lists
 * its teams). Null for a field event. Each team's match-day kit is its
 * competitor's `kit`, where the page's summary has one.
 */
export function eventColors(event: ScoreEvent, topIsHome: boolean | null = null): MatchColors | null {
  if (event.content.kind !== "match") return null;
  const { top, bottom } = event.content;
  return matchColors(
    { color: top.color, alternate: top.alternateColor },
    { color: bottom.color, alternate: bottom.alternateColor },
    { topKit: top.kit ?? null, bottomKit: bottom.kit ?? null, home: (topIsHome ?? listsHomeFirst(event)) ? "top" : "bottom" },
  );
}

/**
 * Whether two colors can be told apart in both schemes, as marks on a chart
 * and as men on a field. (pure; tested)
 */
export function readApart(a: string, b: string): boolean {
  const x = oklabFromHex(a);
  const y = oklabFromHex(b);
  if (!x || !y) return true;
  return (["dark", "light"] as const).every((scheme) => {
    // A color with no usable hue on this page is a gray mark (`NEUTRAL`).
    const gray: OKLab = { l: scheme === "dark" ? 0.62 : 0.5, a: 0, b: 0 };
    const marks = labDistance(toneLab(x, scheme) ?? gray, toneLab(y, scheme) ?? gray);
    return marks >= APART && labDistance(wornLab(x, scheme), wornLab(y, scheme)) >= APART;
  });
}

// MARK: On this page

/** What each side wears, as marks: the charts, the dock, the end zones. */
export function matchPalette(colors: MatchColors, scheme: Scheme): TeamPalette {
  return teamPalette(colors.top.color, colors.bottom.color, scheme);
}

/** The clubs' own colors: the wash and the crests. */
export function identityPalette(colors: MatchColors, scheme: Scheme): TeamPalette {
  return teamPalette(colors.top.identity.color, colors.bottom.identity.color, scheme);
}

/**
 * A side dressed for this page (`MatchColors.Team.uniform`). A pale jersey
 * on a light page takes a rim of its own, deepened, not the white halo; a
 * side in a contrast kit keeps its color at the cap and the trim. A null
 * accent is the page's primary ink. (pure; tested)
 */
export function uniform(team: MatchTeam, scheme: Scheme): Uniform {
  const dark = scheme === "dark";
  const gray: OKLab = { l: dark ? 0.72 : 0.5, a: 0, b: 0 };
  const lab = oklabFromHex(team.color);
  const worn = lab ? wornLab(lab, scheme) : gray;
  // Type in the team's color: a pale one deepens on a light page, keeping its hue; black or white on its own page reads as ink.
  const ownLab = oklabFromHex(team.wear === "contrast" ? team.identity.color : team.color);
  const own = ownLab ? toneLab(ownLab, scheme) : null;
  const accent = own ? toHex(!dark && own.l > 0.7 ? fromLCH(0.6, chroma(own), hue(own)) : own) : null;
  if (team.wear === "contrast") {
    const color = toHex(own ?? gray);
    return { jersey: toHex(worn), cap: color, piping: dark || worn.l < 0.5 ? null : `${color}e6`, accent };
  }
  return {
    jersey: toHex(worn),
    cap: toHex(worn),
    piping: !dark && worn.l > 0.7 ? toHex(fromLCH(0.42, chroma(worn), hue(worn))) : null,
    accent,
  };
}
