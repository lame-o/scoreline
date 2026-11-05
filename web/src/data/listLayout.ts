/**
 * The scores list as it widens (ListLayout.swift, Responsive.swift): the
 * width classes with their hysteresis, the list's arrangement (one column,
 * or a two-up grid of compact rows from 680pt), what each row shows at its
 * width (`RowDetail`), how the arrow keys move through the grid
 * (`ScoresGrid.next`) and how an expanded section's rows reveal
 * (`ScoresGrid.revealDelay`). Pure, so the decisions are testable without
 * views. Today's sidebar (340–420pt) and phone column (440pt) stay compact
 * or medium; the lane and the grid are there for a list given more room.
 */
/** Motion.stagger: 40ms between visual rows (design/motion.ts `STAGGER`). */
const STAGGER = 0.04;

/** How much room a block has, less its 14pt gutters (WidthClass): < 380, 380, 460, 560. */
export type WidthClass = "compact" | "medium" | "large" | "xlarge";

const CLASSES: readonly WidthClass[] = ["compact", "medium", "large", "xlarge"];
const FLOORS = [0, 380, 460, 560];
/** A class steps down only this far below its threshold, so a resize resting on one can't flicker. */
export const HYSTERESIS = 12;
/** Two columns of exactly 340pt. */
export const SPLIT_WIDTH = 680;
const GUTTERS = 2 * 14;

/** Up at a floor; down only `HYSTERESIS` below it (WidthClass.of(_:from:)). */
export function widthClassOf(content: number, old: WidthClass = "compact"): WidthClass {
  let k = CLASSES.indexOf(old);
  while (k + 1 < FLOORS.length && content >= FLOORS[k + 1]!) k += 1;
  while (k > 0 && content < FLOORS[k]! - HYSTERESIS) k -= 1;
  return CLASSES[k]!;
}

/** The list's arrangement, from its width (PanelLayout). */
export interface PanelLayout {
  readonly columns: 1 | 2;
  /** A block spanning the list. */
  readonly page: WidthClass;
  /** A block in one column (the page's with one column). */
  readonly column: WidthClass;
}

export const COMPACT_LAYOUT: PanelLayout = { columns: 1, page: "compact", column: "compact" };

/** PanelLayout.resolve: two columns from 680pt (held until 12pt below), each block's class from its own room. */
export function resolvePanel(width: number, old: PanelLayout = COMPACT_LAYOUT): PanelLayout {
  const split = width >= SPLIT_WIDTH - (old.columns === 2 ? HYSTERESIS : 0);
  const page = widthClassOf(width - GUTTERS, old.page);
  const column = split ? widthClassOf(width / 2 - GUTTERS, old.column) : page;
  const next: PanelLayout = { columns: split ? 2 : 1, page, column };
  return next.columns === old.columns && next.page === old.page && next.column === old.column ? old : next;
}

/**
 * How much a row shows (RowDetail): the compact row is the base; records
 * beside the names from medium (the team block stops stretching); from
 * large, a detail lane between score and status.
 */
export type RowDetail = "base" | "records" | "lane";

export function rowDetailOf(width: WidthClass): RowDetail {
  return width === "compact" ? "base" : width === "medium" ? "records" : "lane";
}

/** The room each row has: the page's in one column, a column's when split. */
export function rowWidth(layout: PanelLayout): WidthClass {
  return layout.columns === 2 ? layout.column : layout.page;
}

// MARK: - Keyboard in the scores grid (ScoresGrid)

export type GridMove = "up" | "down" | "left" | "right";

/**
 * The row to highlight next, or null when the key does nothing here (←/→ in
 * one column, an empty list) so it can pass on. One column: ↑/↓ step through
 * every row in reading order. Two columns: ↑/↓ move a whole visual row within
 * a section, keeping the column where the next section has it; ←/→ move
 * within a visual row.
 */
export function scoresGridNext(current: string | null, move: GridMove, all: readonly (readonly string[])[], columnCount: number): string | null {
  const sections = all.filter((s) => s.length > 0);
  const firstSection = sections[0];
  const lastSection = sections[sections.length - 1];
  if (!firstSection || !lastSection) return null;
  const columns = Math.max(columnCount, 1);
  if (columns === 1 && (move === "left" || move === "right")) return null;
  const s = current == null ? -1 : sections.findIndex((section) => section.includes(current));
  if (current == null || s < 0) {
    // Nothing highlighted yet: forward keys start at the top, back keys at the bottom.
    return move === "down" || move === "right" ? firstSection[0]! : lastSection[lastSection.length - 1]!;
  }
  const row = sections[s]!;
  const i = row.indexOf(current);
  if (columns === 1) {
    const flat = sections.flat();
    const index = flat.indexOf(current);
    return flat[Math.min(Math.max(index + (move === "down" ? 1 : -1), 0), flat.length - 1)]!;
  }
  const column = i % columns;
  switch (move) {
    case "left":
      return column > 0 ? row[i - 1]! : current;
    case "right":
      return column < columns - 1 && i + 1 < row.length ? row[i + 1]! : current;
    case "down": {
      if (i + columns < row.length) return row[i + columns]!;
      // The visual row below is in this section but shorter: its last cell.
      const nextRowStart = (Math.floor(i / columns) + 1) * columns;
      if (nextRowStart < row.length) return row[row.length - 1]!;
      const below = sections[s + 1];
      if (!below) return current;
      return below[column < below.length ? column : 0]!;
    }
    case "up": {
      if (i - columns >= 0) return row[i - columns]!;
      const above = sections[s - 1];
      if (!above) return current;
      const lastRowStart = Math.floor((above.length - 1) / columns) * columns;
      const target = lastRowStart + column;
      return above[target < above.length ? target : lastRowStart]!;
    }
  }
}

/**
 * When a section's rows reveal after an expand: crests lead, text follows
 * 40ms later, a visual row at a time (`STAGGER` apart, capped at 4 rows, so
 * an expand settles in about 0.45 s), the right column 20ms behind the left,
 * so the cascade reads top to bottom.
 */
export function gridRevealDelay(index: number, columnCount: number): number {
  const columns = Math.max(columnCount, 1);
  return 0.04 + Math.min(Math.floor(index / columns), 4) * STAGGER + (index % columns > 0 ? 0.02 : 0);
}
