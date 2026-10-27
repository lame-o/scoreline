/**
 * The game page's section plan (DetailView.swift `Section`, `order`,
 * `widePlan`, `wideArrangement`): which blocks a sport shows, in what order,
 * live, before and after the game; and from 680pt, the two-column page with
 * linked hover partners side by side. Pure and tested.
 *
 * A new sport adds its sections to `Section`, its single-column order to
 * `sectionOrder` and its two-column plan to `widePlan`, then renders them in
 * its page module (features/game/<sport>/).
 */
import type { EventRef, EventState } from "./models";
import { NBA_PATH } from "./providers/espn";

export type Section =
  | "field"
  | "atPlate"
  | "atBat"
  | "pitch"
  | "timeline"
  | "table"
  | "maps"
  | "rounds"
  | "rosters"
  | "winProbability"
  | "linescore"
  | "moments"
  | "stats"
  | "plays"
  | "battedBalls"
  | "wall"
  | "scorecard"
  | "climbingWatch"
  | "results"
  | "startlist"
  | "ascent"
  | "streams"
  | "whereToWatch"
  | "bracket"
  // NBA
  | "court"
  | "flow"
  | "leaders"
  | "box"
  | "injuries";

/** Which kind of page an event gets. */
export type PageKind = "soccer" | "baseball" | "nba" | "espn" | "counterStrike" | "climbing" | "none";

export function pageKind(ref: EventRef | null): PageKind {
  switch (ref?.kind) {
    case "espn":
      if (ref.sport === "soccer") return "soccer";
      if (ref.sport === "baseball") return "baseball";
      if (ref.sport === "basketball" && ref.path === NBA_PATH) return "nba";
      return "espn";
    case "counterStrike":
      return "counterStrike";
    case "climbing":
      return "climbing";
    default:
      return "none";
  }
}

/** What a fan wants first, per sport and state: the live picture while it's on; the story of the game once it's over. */
export function sectionOrder(ref: EventRef | null, state: EventState): readonly Section[] {
  switch (pageKind(ref)) {
    case "soccer":
      return state === "live"
        ? ["pitch", "timeline", "winProbability", "stats", "table", "moments", "plays", "whereToWatch"]
        : state === "final"
          ? ["timeline", "pitch", "moments", "stats", "table", "plays"]
          : ["table", "whereToWatch"];
    case "baseball":
      return state === "live"
        ? ["atPlate", "atBat", "linescore", "winProbability", "bracket", "moments", "battedBalls", "plays", "whereToWatch"]
        : state === "final"
          ? ["linescore", "bracket", "moments", "battedBalls", "plays"]
          : ["bracket", "whereToWatch"];
    case "nba":
      return state === "live"
        ? ["court", "flow", "linescore", "leaders", "moments", "box", "stats", "winProbability", "plays", "table", "injuries", "whereToWatch"]
        : state === "final"
          ? ["flow", "court", "linescore", "leaders", "box", "moments", "stats", "table"]
          : // Before tip-off: who's out, ESPN's matchup predictor, season leaders.
            ["injuries", "winProbability", "leaders", "table", "whereToWatch"];
    case "espn":
      return state === "live"
        ? ["field", "winProbability", "linescore", "moments", "stats", "table", "plays", "whereToWatch"]
        : state === "final"
          ? ["linescore", "moments", "stats", "table", "plays"]
          : ["table", "whereToWatch"];
    case "counterStrike":
      return state === "live"
        ? ["maps", "rounds", "streams", "bracket", "rosters"]
        : state === "final"
          ? ["maps", "rounds", "bracket", "rosters"]
          : ["streams", "maps", "bracket", "rosters"];
    case "climbing":
      return state === "live"
        ? ["ascent", "climbingWatch", "wall", "scorecard", "results", "startlist"]
        : state === "final"
          ? ["results", "wall", "scorecard", "climbingWatch"]
          : ["climbingWatch", "startlist", "results", "wall", "scorecard"];
    case "none":
      return [];
  }
}

/** One stretch of the two-column page: a block of two columns, or a section spanning both between blocks. */
export type WidePart =
  | { readonly kind: "columns"; readonly left: readonly Section[]; readonly right: readonly Section[] }
  | { readonly kind: "span"; readonly section: Section };

const columns = (left: readonly Section[], right: readonly Section[]): WidePart => ({ kind: "columns", left, right });

/**
 * The page from 680pt, per sport and state: blocks of two columns (each
 * listed top to bottom), with full-width sections between them. Linked hover
 * partners sit side by side: the pitch beside the timeline and key events,
 * linescore cells beside the plays they light, climbers' rows beside the lanes
 * and cards they light. A section's column never changes at runtime, so a
 * live list growing in one column never moves the other.
 */
export function widePlan(ref: EventRef | null, state: EventState): readonly WidePart[] {
  switch (pageKind(ref)) {
    case "soccer":
      return state === "live"
        ? [columns(["pitch", "stats", "plays"], ["timeline", "moments", "winProbability", "table", "whereToWatch"])]
        : state === "final"
          ? [columns(["pitch", "stats"], ["timeline", "moments", "table", "plays"])]
          : [columns(["table"], ["whereToWatch"])];
    case "baseball":
      return state === "live"
        ? [columns(["atPlate", "atBat", "battedBalls"], ["linescore", "winProbability", "moments", "bracket", "plays", "whereToWatch"])]
        : state === "final"
          ? [columns(["linescore", "battedBalls"], ["moments", "bracket", "plays"])]
          : [columns(["bracket"], ["whereToWatch"])];
    case "nba":
      // The game's story on the left, its numbers on the right. The box score
      // opens the right column, beside the court.
      return state === "live"
        ? [columns(["court", "flow", "winProbability", "linescore", "moments", "plays", "table"], ["box", "leaders", "stats", "injuries", "whereToWatch"])]
        : state === "final"
          ? [columns(["flow", "court", "linescore", "moments", "table"], ["box", "leaders", "stats", "injuries"])]
          : [columns(["injuries", "winProbability", "leaders"], ["table", "whereToWatch"])];
    case "espn":
      return state === "live"
        ? [columns(["field", "stats", "plays"], ["winProbability", "linescore", "moments", "table", "whereToWatch"])]
        : state === "final"
          ? [columns(["linescore", "stats"], ["moments", "table", "plays"])]
          : [columns(["table"], ["whereToWatch"])];
    case "counterStrike":
      return state === "live"
        ? [columns(["maps", "rounds"], ["streams", "bracket", "rosters"])]
        : state === "final"
          ? [columns(["maps", "rounds"], ["bracket", "rosters"])]
          : [columns(["streams", "maps"], ["bracket", "rosters"])];
    case "climbing":
      return state === "live"
        ? [columns(["ascent", "wall", "scorecard"], ["climbingWatch", "results", "startlist"])]
        : state === "final"
          ? [columns(["wall", "scorecard"], ["results", "climbingWatch"])]
          : [columns(["wall", "scorecard"], ["climbingWatch", "startlist", "results"])];
    case "none":
      return [];
  }
}

export type Column = "single" | "left" | "right" | "span";

/** A shown section and its place on the page (`rank` is its reading order). */
export interface PlacedSection {
  readonly section: Section;
  readonly column: Column;
  readonly rank: number;
}

/**
 * The shown sections in the order the split page lays them out: block by
 * block, the left column then the right, then the span that closes it. That
 * is also the reading order. A section the plan doesn't list joins the right
 * column of the last block, in single-column order; one with nothing to show
 * leaves no hole. A block never leaves a whole column empty: the other column
 * lends it a section.
 */
export function wideArrangement(shown: readonly Section[], plan: readonly WidePart[]): PlacedSection[] {
  const listed = new Set(plan.flatMap((p) => (p.kind === "columns" ? [...p.left, ...p.right] : [p.section])));
  const unlisted = shown.filter((s) => !listed.has(s));
  const parts = [...plan];
  if (unlisted.length > 0) {
    let last = -1;
    parts.forEach((p, i) => {
      if (p.kind === "columns") last = i;
    });
    const block = parts[last];
    if (block && block.kind === "columns") parts[last] = columns(block.left, [...block.right, ...unlisted]);
    else parts.push(columns([], unlisted));
  }
  const visible = new Set(shown);
  const placed: PlacedSection[] = [];
  const place = (sections: readonly Section[], column: Column) => {
    for (const section of sections) placed.push({ section, column, rank: placed.length });
  };
  for (const part of parts) {
    if (part.kind === "columns") {
      let left = part.left.filter((s) => visible.has(s));
      let right = part.right.filter((s) => visible.has(s));
      if (left.length === 0 && right.length > 0) {
        left = [right[0]!];
        right = right.slice(1);
      } else if (right.length === 0 && left.length > 1) {
        right = [left.at(-1)!];
        left = left.slice(0, -1);
      }
      place(left, "left");
      place(right, "right");
    } else if (visible.has(part.section)) {
      place([part.section], "span");
    }
  }
  return placed;
}

/** The shown sections and where each goes: the sport's order in one column; its plan when split. */
export function arrangement(shown: readonly Section[], ref: EventRef | null, state: EventState, split: boolean): PlacedSection[] {
  if (!split) return shown.map((section, rank) => ({ section, column: "single", rank }));
  return wideArrangement(shown, widePlan(ref, state));
}

/** The section that shows (and captions) a chart's moments (DockRules.section). */
export function sectionForChart(chart: string): Section {
  switch (chart) {
    case "field":
      return "field";
    case "pitch":
      return "pitch";
    case "plate":
      return "atPlate";
    case "spray":
      return "battedBalls";
    case "rounds":
      return "rounds";
    case "wall":
      return "wall";
    case "ascent":
      return "ascent";
    case "boulder":
      return "scorecard";
    default:
      return "court";
  }
}
