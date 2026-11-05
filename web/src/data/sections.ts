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
import type { EventRef, EventState, League } from "./models";
import { NBA_PATH } from "./providers/espn";

/** The WNBA reads the NBA's feed: it gets the NBA page, with the parts its data has. */
const WNBA_PATH = "basketball/wnba";

export type Section =
  /**
   * The isometric theater, live (all four sports with one): its own module,
   * above the chart it used to share a section with (Shot Chart, Live Pitch,
   * Field, At the Plate).
   */
  | "liveView"
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
export type PageKind = "soccer" | "baseball" | "nba" | "football" | "espn" | "counterStrike" | "climbing" | "none";

export function pageKind(ref: EventRef | null): PageKind {
  switch (ref?.kind) {
    case "espn":
      if (ref.sport === "soccer") return "soccer";
      if (ref.sport === "baseball") return "baseball";
      if (ref.sport === "basketball" && (ref.path === NBA_PATH || ref.path === WNBA_PATH)) return "nba";
      if (ref.sport === "football") return "football";
      return "espn";
    case "counterStrike":
      return "counterStrike";
    case "climbing":
      return "climbing";
    default:
      return "none";
  }
}

/** The page kind a league's games open on, so its page's code can be warmed before a click. */
export function leaguePageKind(league: League): PageKind {
  switch (league.source.kind) {
    case "espn":
      return pageKind({ kind: "espn", path: league.source.path, id: "", sport: league.sport });
    case "counterStrike":
      return "counterStrike";
    case "ifsc":
      return "climbing";
  }
}

/**
 * What a fan wants first, per sport and state: the live picture while it's
 * on; the story of the game once it's over. Win Probability opens every page
 * that has it, right under the Live View when there is one (the Live View,
 * live only, leads the page; Win Probability, then the chart it replays for,
 * follow it). Every sport lists the Timeline after Win Probability; a page
 * without one leaves no hole.
 */
export function sectionOrder(ref: EventRef | null, state: EventState): readonly Section[] {
  switch (pageKind(ref)) {
    case "soccer":
      return state === "live"
        ? ["liveView", "winProbability", "timeline", "pitch", "stats", "table", "bracket", "moments", "plays", "whereToWatch"]
        : state === "final"
          ? ["winProbability", "timeline", "pitch", "moments", "stats", "table", "bracket", "plays"]
          : ["winProbability", "table", "bracket", "whereToWatch"];
    case "baseball":
      return state === "live"
        ? ["liveView", "winProbability", "timeline", "atPlate", "atBat", "linescore", "bracket", "moments", "battedBalls", "plays", "whereToWatch"]
        : state === "final"
          ? ["winProbability", "timeline", "linescore", "bracket", "moments", "battedBalls", "plays"]
          : ["winProbability", "bracket", "whereToWatch"];
    case "nba":
      return state === "live"
        ? ["liveView", "winProbability", "timeline", "court", "flow", "linescore", "leaders", "moments", "box", "stats", "plays", "table", "injuries", "whereToWatch"]
        : state === "final"
          ? ["winProbability", "timeline", "flow", "court", "linescore", "leaders", "box", "moments", "stats", "table"]
          : // Before tip-off: the matchup predictor, who's out, season leaders.
            ["winProbability", "injuries", "leaders", "table", "whereToWatch"];
    case "football":
    case "espn":
      // The Mac's ESPN order (DetailView `.espn`): football's Live View over its Field.
      return state === "live"
        ? ["liveView", "winProbability", "timeline", "field", "linescore", "moments", "stats", "table", "plays", "whereToWatch"]
        : state === "final"
          ? ["winProbability", "timeline", "linescore", "moments", "stats", "table", "plays"]
          : ["winProbability", "table", "whereToWatch"];
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
 * live list growing in one column never moves the other. Win Probability is
 * at or near the top of its column: just under the court in the NBA (the
 * court stays beside the box score) and under the timeline on a soccer final
 * (it stays beside the shot map).
 */
export function widePlan(ref: EventRef | null, state: EventState): readonly WidePart[] {
  switch (pageKind(ref)) {
    case "soccer":
      return state === "live"
        ? [columns(["liveView", "pitch", "stats", "plays"], ["winProbability", "timeline", "moments", "table", "bracket", "whereToWatch"])]
        : state === "final"
          ? [columns(["pitch", "stats"], ["timeline", "winProbability", "moments", "table", "bracket", "plays"])]
          : [columns(["table", "bracket"], ["winProbability", "whereToWatch"])];
    case "baseball":
      return state === "live"
        ? [columns(["liveView", "atPlate", "atBat", "battedBalls"], ["winProbability", "timeline", "linescore", "moments", "bracket", "plays", "whereToWatch"])]
        : state === "final"
          ? [columns(["linescore", "battedBalls"], ["winProbability", "timeline", "moments", "bracket", "plays"])]
          : [columns(["bracket"], ["winProbability", "whereToWatch"])];
    case "nba":
      // The game's story on the left, its numbers on the right. The box score
      // opens the right column, beside the court: clicking a player shows only
      // their shots without scrolling, and the leaders below it light the same
      // player on both.
      return state === "live"
        ? [columns(["liveView", "court", "winProbability", "timeline", "flow", "linescore", "moments", "plays", "table"], ["box", "leaders", "stats", "injuries", "whereToWatch"])]
        : state === "final"
          ? [columns(["flow", "court", "winProbability", "timeline", "linescore", "moments", "table"], ["box", "leaders", "stats", "injuries"])]
          : // Before tip-off: who's out and how it shapes up, beside the standings.
            [columns(["winProbability", "injuries", "leaders"], ["table", "whereToWatch"])];
    case "football":
    case "espn":
      // The drive and its numbers on the left; the score's story on the right, the quarters beside the scoring plays they light.
      return state === "live"
        ? [columns(["liveView", "field", "stats", "plays"], ["winProbability", "timeline", "linescore", "moments", "table", "whereToWatch"])]
        : state === "final"
          ? [columns(["linescore", "stats"], ["winProbability", "timeline", "moments", "table", "plays"])]
          : [columns(["table"], ["winProbability", "whereToWatch"])];
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
 *
 * `ranking` (the user's order, data/modules.ts) applies within each column:
 * a column keeps its modules, so the designed pairs stay side by side, and
 * stacks them in the ranking's relative order (`merge`, the plan's column
 * order as the default).
 */
export function wideArrangement(shown: readonly Section[], plan: readonly WidePart[], ranking: readonly string[] = []): PlacedSection[] {
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
      let left = arrange(
        part.left.filter((s) => visible.has(s)),
        ranking,
      );
      let right = arrange(
        part.right.filter((s) => visible.has(s)),
        ranking,
      );
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

/** The shown sections and where each goes: the one-column order; the sport's plan when split, each column in the sport's order. */
export function arrangement(shown: readonly Section[], ref: EventRef | null, state: EventState, split: boolean, ranking: readonly string[] = []): PlacedSection[] {
  if (!split) return shown.map((section, rank) => ({ section, column: "single", rank }));
  return wideArrangement(shown, widePlan(ref, state), ranking);
}

/**
 * The page's runs as arranged: each column of the split page, else the whole
 * page. A dragged module moves within its run.
 */
export function runs(placed: readonly PlacedSection[]): Section[][] {
  const out: Section[][] = [];
  let current: Section[] = [];
  let column: Column | null = null;
  for (const p of placed) {
    if (p.column !== column) {
      if (current.length > 0) out.push(current);
      current = [];
      column = p.column;
    }
    current.push(p.section);
  }
  if (current.length > 0) out.push(current);
  return out;
}

/** The chart whose moments a section captions (DockRules.chart): folded, its glance carries them. */
export function chartForSection(section: Section): string | null {
  switch (section) {
    case "field":
      return "field";
    case "pitch":
      return "pitch";
    case "atPlate":
      return "plate";
    case "battedBalls":
      return "spray";
    case "rounds":
      return "rounds";
    case "wall":
      return "wall";
    case "ascent":
      return "ascent";
    case "scorecard":
      return "boulder";
    case "court":
      return "court";
    default:
      return null;
  }
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

// MARK: - The user's order (ModuleOrder.merge; data/modules.ts has the rest)

/**
 * A page's modules, `defaults` (what's on it, in this state's plan), sorted
 * by `ranking`. A module the user never ranked keeps its default spot beside
 * its default neighbors: it follows the nearest ranked module above it in the
 * plan, or, when none is above it, leads the first one. Duplicates and IDs
 * not on the page are ignored.
 */
export function merge<T>(defaults: readonly T[], ranking: readonly T[]): T[] {
  const rankOf = new Map<T, number>();
  ranking.forEach((id, i) => {
    if (!rankOf.has(id)) rankOf.set(id, i);
  });
  const firstRanked = defaults.find((id) => rankOf.has(id));
  if (firstRanked === undefined) return [...defaults];
  const ranked = defaults.filter((id) => rankOf.has(id)).sort((a, b) => rankOf.get(a)! - rankOf.get(b)!);
  const leading: T[] = [];
  const following = new Map<T, T[]>();
  let anchor: T | undefined;
  let anchored = false;
  for (const id of defaults) {
    if (rankOf.has(id)) {
      anchor = id;
      anchored = true;
    } else if (anchored) {
      following.set(anchor as T, [...(following.get(anchor as T) ?? []), id]);
    } else {
      leading.push(id);
    }
  }
  const result: T[] = [];
  for (const id of ranked) {
    if (id === firstRanked) result.push(...leading);
    result.push(id, ...(following.get(id) ?? []));
  }
  return result;
}

/** Sections sorted by a ranking of their IDs (`merge`). */
export function arrange(sections: readonly Section[], by: readonly string[]): Section[] {
  if (by.length === 0) return [...sections];
  return merge(sections as readonly string[], by) as Section[];
}
