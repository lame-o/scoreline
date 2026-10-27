/**
 * What a Back button says: the name of the page it returns to (RootView.swift
 * `Page.backTitle`: "Scores", "Schedule", "Results", "Match", "Table",
 * "Top 25", "Bracket", "Season", a league's short name, a team's or a
 * player's name). Pure, so the rules are testable; app/navigation.ts keeps
 * the trail of history entries that reads them.
 */
import { leagueWithID } from "../data/leagues";

/**
 * The back title of the page at this location, or null when the path alone
 * can't name it (a team or a player: the page names itself once it knows,
 * `useOwnBackTitle`).
 */
export function backTitleFor(pathname: string, search = ""): string | null {
  const [first, second, third] = pathname.split("/").filter(Boolean);
  const params = new URLSearchParams(search);
  switch (first) {
    case undefined:
      return "Scores";
    case "settings":
      return second === "league" && third ? (leagueWithID(safeDecode(third))?.shortName ?? "Settings") : "Settings";
    case "game":
      return "Match";
    case "standings":
      return "Table";
    case "rankings":
      return "Top 25";
    case "bracket":
      return "Bracket";
    case "schedule":
      if (params.get("mode") === "results") return "Results";
      if (second === "climbing") return "Season";
      if (second === "tournaments") return "Tournaments";
      return "Schedule";
    case "results":
      // An event's results say its name ("Santiago", "ESL Pro League Season 24": ResultsContract.swift).
      return params.get("event") || params.get("name") || "Results";
    default:
      return null;
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** One visited history entry: where it was, what Back says to return there, and whether the sidebar opened it. */
export interface TrailEntry {
  readonly path: string;
  readonly title: string | null;
  readonly viaSidebar?: boolean;
}

/**
 * Back's label and whether it shows, for the page at history index `idx`.
 * `from` is the opener's own word (`state.from`), which wins. A page opened
 * directly (index 0) goes back to the scores. Beside the sidebar (`split`),
 * where the scores are always in view, Back shows only when it leads
 * somewhere the sidebar isn't: a player opened from a team's roster says
 * "‹ Chiefs", a game picked in the sidebar says nothing.
 */
export function backButton(idx: number, trail: Readonly<Record<number, TrailEntry>>, from: string | null, split: boolean): { readonly title: string; readonly visible: boolean } {
  const previous = idx > 0 ? trail[idx - 1] : undefined;
  const fromSidebar = idx <= 0 || previous?.path === "/" || trail[idx]?.viaSidebar === true;
  const title = from || (idx <= 0 ? "Scores" : (previous?.title ?? "Back"));
  return { title, visible: !split || !fromSidebar };
}
