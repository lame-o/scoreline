/**
 * Game-page modules (PageModules.swift, ModuleDrag.swift's pure half): each
 * block of a match page folds in place to its header and one live glance
 * line, can be hidden on a sport's pages, and takes the sport's order. Folds,
 * hides and the order are remembered per page and module type, app-wide
 * ("nba.liveView", "soccer.pitch"): never per game, never global. A module
 * folded live stays folded in a final, where it exists: the key has no state
 * in it.
 *
 * The keys are the Mac's (ModuleKeys): `foldedModules` and `hiddenModules`,
 * each a list of "<page>.<module>" (the page's `pageKind`, the module's
 * `Section`), and `moduleOrder`, each page's modules in the user's order
 * (dragged on the page or in Customize), merged into each state's plan.
 *
 * Pure and tested (ModulesTests.swift).
 */
import { ordinal } from "./format";
import type { BoxPlayer, FlowPoint, Injury, LeaderLine, Shot } from "./basketball";
import type { DetailMoment, Linescore, Pitch, Stat } from "./gameDetail";
import { PITCH_NAMES } from "./gameDetail";
import type { EventRef, Side } from "./models";
import { shortened } from "./moments";
import { arrange, merge, pageKind, sectionOrder, type PageKind, type Section } from "./sections";

// MARK: - Keys

/** The settings keys (UserDefaults' on the Mac): each a list of module keys; the order a map of page → module IDs. */
export const MODULE_KEYS = { folded: "foldedModules", hidden: "hiddenModules", order: "moduleOrder" } as const;

/** "nba.liveView", "soccer.pitch", "baseball.atBat": the page, then the module. */
export function moduleKey(kind: PageKind, section: Section): string {
  return `${kind}.${section}`;
}

/** As the menus say it: "Hide Shot Chart on NBA Pages" (PageKind.name). */
export function pageName(kind: PageKind): string {
  switch (kind) {
    case "nba":
      return "NBA";
    case "soccer":
      return "Soccer";
    case "baseball":
      return "Baseball";
    case "football":
      return "Football";
    case "espn":
      return "Basketball";
    case "counterStrike":
      return "CS2";
    case "climbing":
      return "Climbing";
    case "none":
      return "Game";
  }
}

// MARK: - Fold, hide and order

/**
 * Folded, hidden and reordered modules, app-wide (ModuleLayout). Nothing is
 * any of them by default: a key missing from all three means shown, open
 * and in the plan's place.
 */
export interface ModuleLayout {
  readonly folded: readonly string[];
  readonly hidden: readonly string[];
  /** Per page kind ("nba"), the user's ranking of its modules. Only Restore Defaults removes one. */
  readonly order: Readonly<Record<string, readonly string[]>>;
}

export const NO_MODULES: ModuleLayout = { folded: [], hidden: [], order: {} };

const known = (kind: PageKind | null): kind is PageKind => kind != null && kind !== "none";

export function isFolded(layout: ModuleLayout, section: Section, kind: PageKind | null): boolean {
  return known(kind) && layout.folded.includes(moduleKey(kind, section));
}

export function isHidden(layout: ModuleLayout, section: Section, kind: PageKind | null): boolean {
  return known(kind) && layout.hidden.includes(moduleKey(kind, section));
}

const turned = (list: readonly string[], key: string, on: boolean) => (on ? (list.includes(key) ? list : [...list, key]) : list.filter((k) => k !== key));

/** Folds or unfolds a module on a sport's pages (a page with no kind folds nothing). */
export function fold(layout: ModuleLayout, sections: readonly Section[], kind: PageKind | null, on: boolean): ModuleLayout {
  if (!known(kind)) return layout;
  let folded = layout.folded;
  for (const section of sections) folded = turned(folded, moduleKey(kind, section), on);
  return folded === layout.folded ? layout : { ...layout, folded };
}

/** Hides or shows a module on a sport's pages. */
export function hide(layout: ModuleLayout, section: Section, kind: PageKind | null, on: boolean): ModuleLayout {
  if (!known(kind)) return layout;
  const hidden = turned(layout.hidden, moduleKey(kind, section), on);
  return hidden === layout.hidden ? layout : { ...layout, hidden };
}

/** Everything on that sport's pages shows again (folds stay; other sports untouched). */
export function showAll(layout: ModuleLayout, kind: PageKind): ModuleLayout {
  return { ...layout, hidden: layout.hidden.filter((k) => !k.startsWith(`${kind}.`)) };
}

/** Customize's Restore Defaults: every module shows again, in each state's own plan. Folds stay; other sports are untouched. */
export function restoreDefaults(layout: ModuleLayout, kind: PageKind): ModuleLayout {
  const { [kind]: _, ...order } = layout.order;
  return { ...showAll(layout, kind), order };
}

/** The sport's ranking (empty: the plans' order). */
export function ranking(layout: ModuleLayout, kind: PageKind | null): readonly string[] {
  return (known(kind) ? layout.order[kind] : undefined) ?? [];
}

/** A page's modules took a new order (a drag, Move Up or Down): those on the page rank in that order; every other one keeps its place. */
export function rank(layout: ModuleLayout, page: readonly string[], kind: PageKind | null): ModuleLayout {
  if (!known(kind) || page.length === 0) return layout;
  return { ...layout, order: { ...layout.order, [kind]: ranked(page, ranking(layout, kind)) } };
}

/** The page's sections without the hidden ones, in the user's order (or `proposal`, a drag's): what the page stacks and the split page places. */
export function shown(layout: ModuleLayout, sections: readonly Section[], kind: PageKind | null, proposal: readonly string[] | null = null): Section[] {
  return arrange(
    sections.filter((s) => !isHidden(layout, s, kind)),
    proposal ?? ranking(layout, kind),
  );
}

/** The sections this page would show but doesn't: the page's end names them. */
export function hiddenHere(layout: ModuleLayout, sections: readonly Section[], kind: PageKind | null): Section[] {
  return sections.filter((s) => isHidden(layout, s, kind));
}

// MARK: - Order (ModuleOrder)

export { arrange, merge };

/**
 * The sport's ranking once a page's modules took a new order: those on the
 * page rank in the page's order; every other one (live only, hidden, another
 * state's) keeps its place beside its neighbors. Nothing already ranked ever
 * falls out.
 */
export function ranked(page: readonly string[], previous: readonly string[]): string[] {
  const seen = new Set<string>();
  const base = [...previous, ...page].filter((id) => !seen.has(id) && (seen.add(id), true));
  return merge(base, page);
}

/** A run of the page (a column of the split page) in a new order: its modules take the places the run held; the other column's keep theirs. */
export function permute(sequence: readonly string[], run: readonly string[]): string[] {
  const members = new Set(run);
  const inSequence = sequence.filter((id) => members.has(id));
  if (new Set(inSequence).size !== members.size || inSequence.length !== run.length || !inSequence.every((id) => members.has(id))) return [...sequence];
  let next = 0;
  return sequence.map((id) => (members.has(id) ? run[next++]! : id));
}

/** `id` moved to `index` among the others in `run`. */
export function move(id: string, index: number, run: readonly string[]): string[] {
  const others = run.filter((x) => x !== id);
  others.splice(Math.min(Math.max(index, 0), others.length), 0, id);
  return others;
}

/** Where a dragged module lands in its run: the slot nearest its top edge. `heights`: the run's other modules, top to bottom, as they stand. */
export function slot(top: number, runTop: number, heights: readonly number[]): number {
  let y = runTop;
  let best = 0;
  let distance = Math.abs(top - runTop);
  heights.forEach((height, i) => {
    y += height;
    if (Math.abs(top - y) < distance) {
      best = i + 1;
      distance = Math.abs(top - y);
    }
  });
  return best;
}

/** Move Up or Move Down: the sport's ranking with `id` one place along its run, or null at the run's end. */
export function step(id: string, delta: number, run: readonly string[], page: readonly string[], previous: readonly string[]): string[] | null {
  const i = run.indexOf(id);
  if (i < 0 || i + delta < 0 || i + delta >= run.length) return null;
  return ranked(permute(page, move(id, i + delta, run)), previous);
}

// MARK: - Names and the Customize list

/**
 * A module's name in its menu, Customize and the page's end: the same
 * whatever the game's state ("Win Probability", not "How the Odds Moved"), so
 * the list reads the same on every game (DetailView.moduleName).
 */
export function moduleName(section: Section, kind: PageKind | null): string {
  switch (section) {
    case "liveView":
      return "Live View";
    case "field":
      return "Field";
    case "atPlate":
      return "At the Plate";
    case "atBat":
      return "This At-Bat";
    case "pitch":
      return "Pitch";
    case "timeline":
      return "Timeline";
    case "table":
      return kind === "nba" ? "Standings" : kind === "soccer" ? "Table" : "Conference";
    case "maps":
      return "Maps";
    case "rounds":
      return "Rounds";
    case "rosters":
      return "Rosters";
    case "winProbability":
      return "Win Probability";
    case "linescore":
      return kind === "baseball" ? "Score by Inning" : kind === "nba" || kind === "football" || kind === "espn" ? "Score by Quarter" : "Score by Period";
    case "moments":
      return kind === "soccer" ? "Key Events" : kind === "nba" ? "Key Plays" : "Scoring";
    case "stats":
      return "Team Stats";
    case "plays":
      return "Latest";
    case "battedBalls":
      return "Balls in Play";
    case "wall":
      return "High Points";
    case "scorecard":
      return "Scorecard";
    case "climbingWatch":
    case "streams":
      return "Watch";
    case "results":
      return "Results";
    case "startlist":
      return "Starting Order";
    case "ascent":
      return "On the Wall";
    case "whereToWatch":
      return "Where to Watch";
    case "bracket":
      return "Bracket";
    case "court":
      return "Shot Chart";
    case "flow":
      return "Game Flow";
    case "leaders":
      return "Leaders";
    case "box":
      return "Box Score";
    case "injuries":
      return "Injury Report";
  }
}

/** Every module a sport's pages can show (DetailView.modules): the live page's order first, then what only the final or the preview has. */
export function modulesFor(ref: EventRef | null): { readonly section: Section; readonly liveOnly: boolean }[] {
  const live = sectionOrder(ref, "live");
  const final = sectionOrder(ref, "final");
  const scheduled = sectionOrder(ref, "scheduled");
  const all: Section[] = [];
  for (const section of [...live, ...final, ...scheduled]) if (!all.includes(section)) all.push(section);
  return all.map((section) => ({ section, liveOnly: live.includes(section) && !final.includes(section) && !scheduled.includes(section) }));
}

export interface CustomizeRow {
  readonly id: Section;
  readonly name: string;
  readonly liveOnly: boolean;
}

/** Customize's rows: every module the sport's pages can show, in the sport's order (DetailView.customizeRows). */
export function customizeRows(ref: EventRef | null, layout: ModuleLayout): CustomizeRow[] {
  const kind = pageKind(ref);
  const modules = modulesFor(ref);
  const liveOnly = new Map(modules.map((m) => [m.section, m.liveOnly]));
  return arrange(
    modules.map((m) => m.section),
    ranking(layout, kind),
  ).map((id) => ({ id, name: moduleName(id, kind), liveOnly: liveOnly.get(id) ?? false }));
}

/** "Hidden on NBA pages: Shot Chart, Live View" (HiddenModulesLine.text). */
export function hiddenText(names: readonly string[], page: string): string {
  return `Hidden on ${page} pages: ${names.join(", ")}`;
}

/** A header as a screen reader says it: "Shot Chart, collapsed" (ModuleHeader.spoken). */
export function spokenHeader(title: string, folded: boolean): string {
  return `${title}, ${folded ? "collapsed" : "expanded"}`;
}

/** Where a held row lands in Customize: the slot nearest where it's been dragged (CustomizeModulesSheet.index). */
export const CUSTOMIZE_PITCH = 25;
export function customizeIndex(from: number, travel: number, count: number): number {
  return Math.min(Math.max(from + Math.round(travel / CUSTOMIZE_PITCH), 0), Math.max(count - 1, 0));
}

// MARK: - The drag (ModuleDrag)

/** A press travelling past this many points lifts the module; under it, it's still the fold's click. */
export const DRAG_THRESHOLD = 4;

/**
 * Points per tick (60 a second) for a pointer at `pointer` in a viewport
 * `height` tall: within `zone` of an edge (below `topInset`, the docked bar),
 * faster the closer, up to `fastest`. (pure; tested)
 */
export function autoscrollSpeed(pointer: number, height: number, topInset: number, zone = 44, fastest = 12): number {
  if (!(height > 2 * zone)) return 0;
  const top = topInset + zone;
  const bottom = height - zone;
  if (pointer < top) return -fastest * Math.min((top - pointer) / zone, 1);
  if (pointer > bottom) return fastest * Math.min((pointer - bottom) / zone, 1);
  return 0;
}

/** How far along `spring.standard` (0.3 s, critically damped) `t` seconds in is; 1 from twice its duration. (pure; tested) */
export function springProgress(t: number, duration = 0.3): number {
  if (!(t < 2 * duration)) return 1;
  const omega = (2 * Math.PI) / duration;
  return Math.max(0, 1 - (1 + omega * t) * Math.exp(-omega * t));
}

// MARK: - Glances (ModuleGlance)

/** One side's chance: a dot in its color, the name, the number. */
export interface GlancePart {
  readonly color: string;
  readonly name: string;
  readonly value: string;
}

/**
 * A folded module's one line: the value first, then what it is, in the
 * module's own terms ("GSW +5 · 9 lead changes · 6 ties"). Built from the
 * same data as the module, so it updates live.
 */
export type ModuleGlance = { readonly kind: "text"; readonly lead: string; readonly detail: string } | { readonly kind: "parts"; readonly parts: readonly GlancePart[] };

export const glanceText = (lead: string, detail = ""): ModuleGlance => ({ kind: "text", lead, detail });

/** What a screen reader hears as the folded header's description. */
export function spokenGlance(g: ModuleGlance): string {
  return g.kind === "text" ? [g.lead, g.detail].filter((s) => s.length > 0).join(", ") : g.parts.map((p) => `${p.name} ${p.value}`).join(", ");
}

/** "Stephen Curry" → "Curry"; "Jaime Jaquez Jr." → "Jaquez". */
export function surname(name: string): string {
  const suffixes = new Set(["Jr.", "Jr", "Sr.", "Sr", "II", "III", "IV", "V"]);
  const words = name.split(" ").filter((w) => w.length > 0);
  return [...words].reverse().find((w) => !suffixes.has(w)) ?? name;
}

/** A plays-list line ("Q4 2:30  Stephen Curry makes…", "67'  Corner…"): its time leads, the play follows. A line without one is all detail. */
export function playGlance(line: string): ModuleGlance {
  const gap = line.indexOf("  ");
  if (gap < 0) return glanceText("", line);
  const lead = line.slice(0, gap).trim();
  const rest = line.slice(gap + 2).trim();
  return lead.length === 0 ? glanceText("", rest) : glanceText(lead, rest);
}

const momentHeadline = (m: DetailMoment) => (["goal", "ownGoal", "yellow", "red"].includes(m.kind) ? shortened(m.text) : m.text);

/** Key events (soccer: the newest goal, else the newest event), key plays and scoring: the newest, its time first. */
export function newestGlance(moments: readonly DetailMoment[], soccer: boolean): ModuleGlance | null {
  const goals = moments.filter((m) => m.kind === "goal" || m.kind === "ownGoal");
  const m = (soccer ? goals.at(-1) : undefined) ?? moments.at(-1);
  if (!m) return null;
  let what = momentHeadline(m);
  if (soccer) {
    if (m.kind === "goal" || m.kind === "ownGoal") what = `Goal! ${what}`;
    else if (m.kind === "red") what = `Red card: ${what}`;
    else if (m.kind === "yellow") what = `Yellow card: ${what}`;
  }
  if (m.score) what += `, ${m.score}`;
  return glanceText(m.clock, what);
}

/** Field goals and threes, each made of attempted. */
export interface Shooting {
  readonly made: number;
  readonly attempts: number;
  readonly threesMade: number;
  readonly threesAttempted: number;
}

const madeOf = (line: string | null | undefined): { made: number; attempts: number } | null => {
  const m = line?.match(/^(\d+)-(\d+)$/);
  return m ? { made: Number(m[1]), attempts: Number(m[2]) } : null;
};

/** From the box score's totals ("38-82", "14-33"), when it has them. */
export function shootingFromTotals(fg: string | null | undefined, threes: string | null | undefined): Shooting | null {
  const f = madeOf(fg);
  if (!f) return null;
  const t = madeOf(threes);
  return { made: f.made, attempts: f.attempts, threesMade: t?.made ?? 0, threesAttempted: t?.attempts ?? 0 };
}

/** Counted from the shots on the chart, one side's. */
export function shootingFromShots(shots: readonly Pick<Shot, "made" | "value" | "side">[], side: Side): Shooting {
  let made = 0;
  let attempts = 0;
  let threesMade = 0;
  let threesAttempted = 0;
  for (const shot of shots) {
    if (shot.side !== side) continue;
    attempts += 1;
    if (shot.made) made += 1;
    if (shot.value === 3) {
      threesAttempted += 1;
      if (shot.made) threesMade += 1;
    }
  }
  return { made, attempts, threesMade, threesAttempted };
}

const shootingPercent = (s: Shooting) => (s.attempts > 0 ? Math.round((s.made / s.attempts) * 100) : 0);

/** The shot chart: "GSW 46% FG", then "14 of 33 from three · MIN 43%, 11 of 31". */
export function shootingGlance(top: Shooting, bottom: Shooting, names: { readonly top: string; readonly bottom: string }): ModuleGlance {
  if (top.attempts + bottom.attempts === 0) return glanceText("", "No shots yet");
  return glanceText(
    `${names.top} ${shootingPercent(top)}% FG`,
    `${top.threesMade} of ${top.threesAttempted} from three · ${names.bottom} ${shootingPercent(bottom)}%, ${bottom.threesMade} of ${bottom.threesAttempted}`,
  );
}

/** Lead changes (the leader switching sides) and ties (the score drawing level after a lead), as ESPN counts them; 0–0 at tip-off isn't a tie. */
export function flowCounts(points: readonly Pick<FlowPoint, "top" | "bottom">[]): { changes: number; ties: number } {
  let changes = 0;
  let ties = 0;
  let leader = 0;
  let previous = 0;
  for (const p of points) {
    const sign = Math.sign(p.top - p.bottom);
    if (sign === 0 && previous !== 0) ties += 1;
    if (sign !== 0) {
      if (leader !== 0 && sign !== leader) changes += 1;
      leader = sign;
    }
    previous = sign;
  }
  return { changes, ties };
}

/** The game flow: who leads and by how much, then the lead changes and ties. */
export function flowGlance(points: readonly Pick<FlowPoint, "top" | "bottom">[], names: { readonly top: string; readonly bottom: string }): ModuleGlance | null {
  const last = points.at(-1);
  if (!last) return null;
  const margin = last.top - last.bottom;
  const lead = margin === 0 ? `Tied ${last.top}–${last.bottom}` : `${margin > 0 ? names.top : names.bottom} +${Math.abs(margin)}`;
  const { changes, ties } = flowCounts(points);
  const changed = changes === 0 ? "No lead changes" : changes === 1 ? "1 lead change" : `${changes} lead changes`;
  const tied = ties === 0 ? null : ties === 1 ? "1 tie" : `${ties} ties`;
  return glanceText(lead, [changed, tied].filter((x): x is string => x != null).join(" · "));
}

/** The line score: the latest period, then its score ("Q4", "GSW 27–21 MIN this quarter"). */
export function linescoreGlance(line: Linescore, names: { readonly top: string; readonly bottom: string }, baseball: boolean, live: boolean): ModuleGlance | null {
  const totals = new Set(["T", "R", "H", "E"]);
  const periods = line.headers.map((h, i) => i).filter((i) => !totals.has(line.headers[i]!) && i < line.top.length && i < line.bottom.length);
  const i = [...periods].reverse().find((i) => (line.top[i] ?? "") !== "" || (line.bottom[i] ?? "") !== "");
  if (i === undefined) return null;
  const header = line.headers[i]!;
  const n = /^\d+$/.test(header) ? Number(header) : null;
  const label = n != null ? (baseball ? ordinal(n) : n <= 4 ? `Q${n}` : n === 5 ? "OT" : `OT${n - 4}`) : header;
  const t = line.top[i] || "0";
  const b = line.bottom[i] || "0";
  return glanceText(label, `${names.top} ${t}–${b} ${names.bottom}${live ? (baseball ? " this inning" : " this quarter") : ""}`);
}

/** The leaders: the game's top scorer, then the other side's. */
export function leadersGlance(lines: readonly LeaderLine[]): ModuleGlance | null {
  const line = lines[0];
  if (!line) return null;
  const both = [line.top, line.bottom].filter((l): l is NonNullable<typeof l> => l != null).sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0));
  const first = both[0];
  if (!first) return null;
  return glanceText(
    `${surname(first.name)} ${first.value}`,
    both
      .slice(1)
      .map((l) => `${surname(l.name)} ${l.value}`)
      .join(" · "),
  );
}

/** The box score: live, who's on the floor (the side shown first); else its starters. */
export function boxGlance(players: readonly Pick<BoxPlayer, "name" | "onCourt" | "starter">[], live: boolean): ModuleGlance | null {
  const five = players.filter((p) => (live ? p.onCourt : p.starter));
  if (five.length === 0) return null;
  return glanceText(live ? "On court" : "Starters", five.map((p) => surname(p.name)).join(", "));
}

/** Team stats: the first three, as the bars list them. */
export function statsGlance(stats: readonly Stat[]): ModuleGlance | null {
  const first = stats[0];
  if (!first) return null;
  const pair = (s: Stat) => `${s.label} ${s.top}–${s.bottom}`;
  return glanceText(pair(first), stats.slice(1, 3).map(pair).join(" · "));
}

/** A table: where each team stands, the higher first ("GSW 3rd", "MIN 7th"). */
export function standingsGlance(places: readonly { readonly name: string; readonly rank: number }[]): ModuleGlance | null {
  const sorted = [...places].sort((a, b) => a.rank - b.rank);
  const first = sorted[0];
  if (!first) return null;
  return glanceText(
    `${first.name} ${ordinal(first.rank)}`,
    sorted
      .slice(1)
      .map((p) => `${p.name} ${ordinal(p.rank)}`)
      .join(" · "),
  );
}

/** Who's out ("3 out", "Kuminga, Moody, Reid"), else how many are listed. */
export function injuriesGlance(list: readonly Pick<Injury, "name" | "status">[]): ModuleGlance | null {
  if (list.length === 0) return null;
  const out = list.filter((i) => i.status.toLowerCase().startsWith("out"));
  const named = out.length === 0 ? list : out;
  return glanceText(out.length === 0 ? `${list.length} listed` : `${out.length} out`, named.map((i) => surname(i.name)).join(", "));
}

/** Where to watch: the first broadcaster, then the rest ("ESPN", "and Prime Video"). */
export function broadcastersGlance(names: readonly string[]): ModuleGlance | null {
  const first = names[0];
  if (!first) return null;
  const rest = names.length === 2 ? `and ${names[1]}` : names.length > 2 ? `and ${names.length - 1} more` : "";
  return glanceText(first, rest);
}

/** This at-bat: the newest pitch ("Pitch 3", "97 mph four-seam, foul"). */
export function atBatGlance(pitches: readonly Pitch[]): ModuleGlance {
  const p = pitches.reduce<Pitch | null>((best, x) => (best == null || x.number > best.number ? x : best), null);
  if (!p) return glanceText("", "Waiting for the first pitch");
  const kind = (p.type ? PITCH_NAMES[p.type] : undefined)?.toLowerCase() ?? p.typeName?.toLowerCase() ?? null;
  const result =
    p.result === "ball"
      ? "ball"
      : p.result === "inPlay"
        ? "in play"
        : p.strike === "called"
          ? "called strike"
          : p.strike === "swinging"
            ? "swinging strike"
            : p.strike === "foul"
              ? "foul"
              : p.strike === "foulTip"
                ? "foul tip"
                : "strike";
  const pitch = [p.mph != null ? `${p.mph} mph` : null, kind].filter((x): x is string => x != null).join(" ");
  return glanceText(`Pitch ${p.number}`, pitch.length === 0 ? result : `${pitch}, ${result}`);
}

/** At the plate: the outs, then the runners and the matchup. */
export function atPlateGlance(outs: number, bases: readonly boolean[], batter: string | null, pitcher: string | null): ModuleGlance {
  const on = bases.map((b, i) => (b ? ordinal(i + 1) : null)).filter((x): x is string => x != null);
  const runners = on.length === 3 ? "Bases loaded" : on.length === 0 ? "Bases empty" : on.length === 1 ? `Runner on ${on[0]}` : `Runners on ${on.join(" and ")}`;
  const matchup = batter && pitcher ? `${surname(batter)} vs. ${surname(pitcher)}` : null;
  return glanceText(outs === 1 ? "1 out" : `${outs} outs`, [runners, matchup].filter((x): x is string => x != null).join(" · "));
}

/** The field: who has the ball, the down, and the drive so far. */
export function fieldGlance(possession: string | null, downDistance: string | null, plays: number): ModuleGlance {
  const drive = plays > 0 ? (plays === 1 ? "1 play this drive" : `${plays} plays this drive`) : null;
  if (!possession) return glanceText(downDistance ?? "", drive ?? "");
  return glanceText(`${possession} ball`, [downDistance, drive].filter((x): x is string => x != null).join(" · "));
}

/** Soccer's shot map: shots, then shots on target. */
export function shotMapGlance(shots: readonly { readonly side: Side | null; readonly onTarget: boolean }[]): ModuleGlance {
  const count = (side: Side, onTarget: boolean) => shots.filter((s) => s.side === side && (!onTarget || s.onTarget)).length;
  return glanceText(`Shots ${count("top", false)}–${count("bottom", false)}`, `On target ${count("top", true)}–${count("bottom", true)}`);
}

/** The soccer timeline: the score, then each goal's minute and scorer. */
export function timelineGlance(moments: readonly DetailMoment[], score: string | null): ModuleGlance {
  const goals = moments.filter((m) => m.kind === "goal" || m.kind === "ownGoal");
  const detail = goals.length === 0 ? "No goals yet" : goals.map((m) => `${m.clock} ${momentHeadline(m)}`).join(" · ");
  return glanceText(score ?? "", detail);
}

/** Every other sport's timeline: the score, then its newest mark's clock and words (DetailView's `.timeline` glance). */
export function keyPlaysGlance(last: Pick<DetailMoment, "clock" | "text"> | null, score: string): ModuleGlance {
  const detail = last ? [last.clock, last.text].filter((s) => s.length > 0).join(" · ") : "No key plays yet";
  return glanceText(score, detail);
}

/**
 * Whole percents that add to 100 (largest remainder); held off 0 and 100
 * until the game is decided, what that adds coming off the biggest
 * (OddsSplit.percents).
 */
export function splitPercents(shares: readonly number[], final: boolean): number[] {
  const clean = shares.map((s) => Math.max(s, 0));
  const total = clean.reduce((a, b) => a + b, 0);
  const exact = clean.map((s) => (total > 0 ? (s / total) * 100 : 100 / clean.length));
  const whole = exact.map((e) => Math.floor(e));
  const remainders = exact.map((e, i) => e - whole[i]!);
  const order = exact
    .map((_, i) => i)
    .sort((a, b) => {
      if (Math.abs(remainders[a]! - remainders[b]!) > 1e-9) return remainders[b]! - remainders[a]!;
      return exact[a] !== exact[b] ? exact[b]! - exact[a]! : a - b;
    });
  const short = Math.max(100 - whole.reduce((a, b) => a + b, 0), 0);
  for (const i of order.slice(0, short)) whole[i]! += 1;
  if (!final) {
    for (let i = 0; i < whole.length; i++) whole[i] = Math.min(Math.max(whole[i]!, 1), 99);
    while (whole.reduce((a, b) => a + b, 0) > 100) {
      let max = 0;
      whole.forEach((w, i) => {
        if (w > whole[max]!) max = i;
      });
      whole[max]! -= 1;
    }
  }
  return whole;
}

/** Each side's chance, keyed by its color ("GSW 96%", "MIN 4%"); a draw between. */
export function chancesGlance(
  split: { readonly top: number; readonly draw: number | null; readonly bottom: number },
  final: boolean,
  top: { readonly color: string; readonly name: string },
  draw: string | null,
  bottom: { readonly color: string; readonly name: string },
): ModuleGlance {
  const threeWay = split.draw != null && draw != null;
  const percents = splitPercents(threeWay ? [split.top, split.draw!, split.bottom] : split.draw != null ? [split.top, split.draw, split.bottom] : [split.top, split.bottom], final);
  const topValue = percents[0]!;
  const bottomValue = percents.at(-1)!;
  const parts: GlancePart[] = [{ color: top.color, name: top.name, value: `${topValue}%` }];
  if (threeWay) parts.push({ color: draw!, name: "Draw", value: `${percents[1]}%` });
  parts.push({ color: bottom.color, name: bottom.name, value: `${bottomValue}%` });
  return { kind: "parts", parts };
}
