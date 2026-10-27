/**
 * A league's team (or country) picks as an outline (LeagueSettingsView.swift
 * `PickOutline`): never one 136-row column.
 *
 * - Searching: every match, flat, across all groups (alphabetical where the
 *   list is grouped).
 * - Otherwise the picks as of opening ("Selected", open), then the rest:
 *   - 24 or fewer in all: listed in full;
 *   - natural groups (college conferences): one collapsible group each,
 *     whole (a picked team is also in its conference), in the list's order;
 *   - no groups: the rest in order, capped at its first dozen ("Show All").
 *
 * Picks are read as of opening, so rows don't jump between groups while the
 * user clicks. Pure; the keys come from data/outline.ts.
 */
import { OUTLINE_THRESHOLD, type OutlineSection, type OutlineSectionKind } from "./outline";
import type { TeamOption } from "./providers/teams";

export const PICK_SELECTED = "selected";
export const PICK_REST = "all";
export const PICK_MATCHES = "matches";
export const pickGroupID = (name: string) => `conf:${name}`;

export interface PickSection {
  readonly id: string;
  /** Shown over the rows (a plain or capped section), or as the group's header (a disclosure). */
  readonly title: string;
  readonly kind: OutlineSectionKind;
  readonly options: readonly TeamOption[];
}

export function pickSections(options: readonly TeamOption[], query: string, picks: ReadonlySet<string>, noun: string): PickSection[] {
  const grouped = options.length > OUTLINE_THRESHOLD && new Set(options.flatMap((o) => (o.group ? [o.group] : []))).size > 1;
  const q = query.trim().toLowerCase();
  if (q) {
    const matches = options.filter((o) => o.name.toLowerCase().includes(q));
    if (grouped) matches.sort((a, b) => a.name.localeCompare(b.name));
    return matches.length === 0 ? [] : [{ id: PICK_MATCHES, title: noun, kind: "plain", options: matches }];
  }
  const mine = options.filter((o) => picks.has(o.id));
  const sections: PickSection[] = mine.length === 0 ? [] : [{ id: PICK_SELECTED, title: "Selected", kind: "plain", options: mine }];
  if (grouped) {
    const order: string[] = [];
    const members = new Map<string, TeamOption[]>();
    for (const option of options) {
      const group = option.group ?? "Other";
      if (!members.has(group)) {
        order.push(group);
        members.set(group, []);
      }
      members.get(group)!.push(option);
    }
    return [...sections, ...order.map((g): PickSection => ({ id: pickGroupID(g), title: g, kind: "disclosure", options: members.get(g)! }))];
  }
  const rest = options.filter((o) => !picks.has(o.id));
  if (rest.length === 0) return sections;
  return [...sections, { id: PICK_REST, title: mine.length === 0 ? noun : `All ${noun}`, kind: options.length > OUTLINE_THRESHOLD ? "capped" : "plain", options: rest }];
}

/** The sections as the arrow keys see them. */
export function pickOutline(sections: readonly PickSection[]): OutlineSection[] {
  return sections.map((s) => ({ id: s.id, kind: s.kind, items: s.options.map((o) => o.id) }));
}
