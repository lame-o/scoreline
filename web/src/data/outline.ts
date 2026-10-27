/**
 * Long lists as an outline (OutlineList.swift `Outline`), the decisions
 * alone: macOS's answer to a tall list is groups that collapse to a header
 * and a line of crests, and a long list with no natural groups shows its
 * first dozen and "Show All N" in place. The team picker, the college
 * standings and the long schedule lists share it. Pure, so it's tested
 * without a DOM (test/unit/outline.test.ts).
 */

/** A list with no natural groups and more rows than this… */
export const OUTLINE_THRESHOLD = 24;
/** …shows this many, then "Show All N" in place. */
export const OUTLINE_PREVIEW = 12;

/** How many rows of a flat run show before "Show All". */
export function visibleCount(count: number, showingAll: boolean): number {
  return showingAll || count <= OUTLINE_THRESHOLD ? count : Math.min(OUTLINE_PREVIEW, count);
}

/**
 * Whether a group starts expanded: the user's own choice this session, else
 * whether it holds one of their teams (picked, followed, or in the match the
 * page was opened from).
 */
export function startsExpanded(remembered: boolean | undefined, members: readonly string[], mine: ReadonlySet<string>): boolean {
  return remembered ?? members.some((m) => mine.has(m));
}

/** A crest's identity shared by a group's preview and its row, so it travels between the two: "conf:SEC|espn-ncaaf-333". */
export function crestID(group: string, item: string): string {
  return `${group}|${item}`;
}

// MARK: - Keyboard

export type OutlineSectionKind =
  /** Always open, no header stop ("Selected", short lists, search results). */
  | "plain"
  /** A header that opens and closes (a conference). */
  | "disclosure"
  /** Its first `OUTLINE_PREVIEW` rows, then a "Show All" stop (a long flat list). */
  | "capped";

/** A section as the arrow keys see it. */
export interface OutlineSection {
  readonly id: string;
  readonly kind: OutlineSectionKind;
  readonly items: readonly string[];
}

/** One stop for ↑/↓: a group's header, a row, or a "Show All". */
export type Stop =
  | { readonly kind: "header"; readonly section: string }
  | { readonly kind: "row"; readonly section: string; readonly item: string }
  | { readonly kind: "more"; readonly section: string };

/** The highlight's key, also the stop's element key: "h|SEC", "r|SEC|espn-ncaaf-333", "m|all". */
export function stopKey(stop: Stop): string {
  switch (stop.kind) {
    case "header":
      return `h|${stop.section}`;
    case "row":
      return `r|${stop.section}|${stop.item}`;
    case "more":
      return `m|${stop.section}`;
  }
}

export function parseStop(key: string | null | undefined): Stop | null {
  if (!key) return null;
  const [kind, section, ...rest] = key.split("|");
  if (kind === "h" && section != null && rest.length === 0) return { kind: "header", section };
  if (kind === "m" && section != null && rest.length === 0) return { kind: "more", section };
  if (kind === "r" && section != null && rest.length > 0) return { kind: "row", section, item: rest.join("|") };
  return null;
}

const sameStop = (a: Stop, b: Stop) => stopKey(a) === stopKey(b);

/** The stops on screen, in reading order: collapsed groups contribute their header alone; a capped run its first rows and "Show All". */
export function stops(sections: readonly OutlineSection[], expanded: ReadonlySet<string>, showingAll: ReadonlySet<string> = new Set()): Stop[] {
  return sections.flatMap((section): Stop[] => {
    switch (section.kind) {
      case "plain":
        return section.items.map((item) => ({ kind: "row", section: section.id, item }));
      case "disclosure": {
        const header: Stop = { kind: "header", section: section.id };
        return expanded.has(section.id) ? [header, ...section.items.map((item): Stop => ({ kind: "row", section: section.id, item }))] : [header];
      }
      case "capped": {
        const shown = visibleCount(section.items.length, showingAll.has(section.id));
        const rows = section.items.slice(0, shown).map((item): Stop => ({ kind: "row", section: section.id, item }));
        return shown < section.items.length ? [...rows, { kind: "more", section: section.id }] : rows;
      }
    }
  });
}

/**
 * ↑/↓ (`delta` −1/+1): the next stop, stopping at the ends. From nothing, ↓
 * starts at the top and ↑ at the bottom; from a row hidden since (its group
 * collapsed), the move starts at its group's header.
 */
export function step(current: Stop | null, delta: number, list: readonly Stop[]): Stop | null {
  if (list.length === 0) return null;
  let index = -1;
  if (current) {
    index = list.findIndex((s) => sameStop(s, current));
    if (index < 0) index = list.findIndex((s) => s.kind === "header" && s.section === current.section);
  }
  if (index < 0) return delta > 0 ? list[0]! : list[list.length - 1]!;
  return list[Math.min(Math.max(index + delta, 0), list.length - 1)]!;
}

/** What ← or → does, as an outline does it. */
export type Disclose = { readonly kind: "expand"; readonly id: string } | { readonly kind: "collapse"; readonly id: string } | { readonly kind: "highlight"; readonly stop: Stop };

/** →: opens a closed header; on an open one, steps to its first row. */
export function discloseRight(current: Stop | null, sections: readonly OutlineSection[], expanded: ReadonlySet<string>): Disclose | null {
  if (current?.kind !== "header") return null;
  const id = current.section;
  if (!expanded.has(id)) return { kind: "expand", id };
  const first = sections.find((s) => s.id === id)?.items[0];
  return first != null ? { kind: "highlight", stop: { kind: "row", section: id, item: first } } : null;
}

/** ←: closes an open header; from a row in an open group, goes to its header. */
export function discloseLeft(current: Stop | null, sections: readonly OutlineSection[], expanded: ReadonlySet<string>): Disclose | null {
  if (current?.kind === "header") return expanded.has(current.section) ? { kind: "collapse", id: current.section } : null;
  if (current?.kind === "row") {
    return sections.some((s) => s.id === current.section && s.kind === "disclosure") ? { kind: "highlight", stop: { kind: "header", section: current.section } } : null;
  }
  return null;
}

// MARK: - Session memory (DisclosureMemory)

/**
 * The groups people opened or closed, for as long as the tab lives: coming
 * back to a page finds them as left. Only explicit choices are kept; a group
 * never touched follows its default (does it hold one of your teams?).
 */
const memory = new Map<string, Map<string, boolean>>();

export const disclosureMemory = {
  choice(id: string, scope: string): boolean | undefined {
    return memory.get(scope)?.get(id);
  },
  remember(open: boolean, id: string, scope: string): void {
    let m = memory.get(scope);
    if (!m) memory.set(scope, (m = new Map()));
    m.set(id, open);
  },
  /** Tests only. */
  forget(scope: string): void {
    memory.delete(scope);
  },
};
