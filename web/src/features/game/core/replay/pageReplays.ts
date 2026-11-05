/**
 * The match page's replays (Replays.swift `PageReplays`): which row is open,
 * each replayable play by ID, and who's who. Rows read it; the page writes it
 * (`update`) as its sources change (useReplaySync.ts). Held outside React,
 * like linked focus: a row subscribes to its own answer (`useReplayRow`), so
 * new replays re-render only the rows whose answer changed, and opening one
 * re-renders that row and the one it closed.
 *
 *     const replays = useMemo(() => new PageReplays(event, geometry), [event.id]);
 *     <ReplaysProvider store={replays}>…</ReplaysProvider>
 */
import { createContext, createElement, useCallback, useContext, useSyncExternalStore, type ReactNode } from "react";
import type { ScoreEvent } from "../../../../data/models";
import { ReplayOpening, replaysSupported, replayValue, sameRow, type PlayReplay, type Replayable, type ReplayContext, type ReplayRow } from "../../../../data/replays";
import type { PageGeometry } from "../geometry";

/** How a row was opened: a click unfolds it; the keyboard opens it at once (keyboard actions never animate). */
export type ReplayVia = "pointer" | "keyboard";

export class PageReplays {
  /** The sport has an isometric view: its lists keep a place for the play glyph. */
  readonly supported: boolean;
  /** Where the open well is brought into view. */
  readonly geometry: PageGeometry | null;
  private opening = new ReplayOpening();
  private plays: Replayable = {};
  private contextValue: ReplayContext | null = null;
  /** How the open row was opened. */
  via: ReplayVia = "pointer";
  private listeners = new Set<() => void>();

  /** `event`: the page's game, whose sport says whether its lists keep a place for the play glyph from the start. */
  constructor(event: ScoreEvent | null, geometry: PageGeometry | null = null) {
    this.supported = replaysSupported(event);
    this.geometry = geometry;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit(): void {
    for (const l of this.listeners) l();
  }

  get open(): ReplayRow | null {
    return this.opening.row;
  }

  get context(): ReplayContext | null {
    return this.contextValue;
  }

  replay(play: string): PlayReplay | null {
    return this.plays[play] ?? null;
  }

  toggle(row: ReplayRow, via: ReplayVia = "pointer"): void {
    this.via = via;
    this.opening = this.opening.toggle(row);
    this.emit();
  }

  /** Esc: whether there was a row to close. A focus inside its well goes back to its row (`takeRefocus`). */
  close(via: ReplayVia = "keyboard"): boolean {
    const { opening, closed } = this.opening.close();
    if (!closed) return false;
    const active = typeof document === "undefined" ? null : document.activeElement;
    this.refocus = active?.closest("[data-replay-slot]")?.id ?? null;
    this.via = via;
    this.opening = opening;
    this.emit();
    return true;
  }

  /** The slot (by its ID) whose well had the focus when Esc closed it. */
  private refocus: string | null = null;

  /** Whether `slot`'s well had the focus as it closed (said once). */
  takeRefocus(slot: string): boolean {
    if (this.refocus !== slot) return false;
    this.refocus = null;
    return true;
  }

  /** Who's who, as the page has it now. */
  setContext(context: ReplayContext): void {
    if (this.contextValue && shallowSame(this.contextValue, context)) return;
    this.contextValue = context;
    this.emit();
  }

  /**
   * The page's replays now (null: unchanged). The open row's replay keeps
   * its object while it reads the same, so the well doesn't start over; a
   * row whose play can't replay any more closes.
   */
  update(plays: Replayable | null): void {
    if (plays == null) return;
    const open = this.opening.row?.play;
    const was = open != null ? this.plays[open] : undefined;
    const now = open != null ? plays[open] : undefined;
    this.plays = was && now && was !== now && replayValue(was) === replayValue(now) ? { ...plays, [open!]: was } : plays;
    this.opening = this.opening.keep((play) => this.plays[play] != null);
    this.emit();
  }

  /** The render harness and the click tests: replays, who's who, and the row open, as given (PageReplays.preview). */
  preview(plays: Replayable, context: ReplayContext, open: ReplayRow | null): void {
    this.plays = plays;
    this.contextValue = context;
    this.opening = open ? new ReplayOpening(open) : new ReplayOpening();
    this.emit();
  }
}

function shallowSame(a: object, b: object): boolean {
  const ka = Object.keys(a) as (keyof typeof a)[];
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

const ReplaysContext = createContext<PageReplays | null>(null);

export function ReplaysProvider({ store, children }: { store: PageReplays; children: ReactNode }) {
  return createElement(ReplaysContext.Provider, { value: store }, children);
}

export function useReplays(): PageReplays | null {
  return useContext(ReplaysContext);
}

/** A row's part in the replays: whether its sport has them, whether its play replays, and whether it's the open one. */
export interface RowReplay {
  readonly supported: boolean;
  readonly replayable: boolean;
  readonly open: boolean;
  /** Opens it (closing any other) or closes it. */
  readonly toggle: (via: ReplayVia) => void;
}

const none = () => () => {};

/** A row's answer, re-rendering it only when that changes. `row` null: a line about no play. */
export function useReplayRow(row: ReplayRow | null): RowReplay {
  const store = useReplays();
  const section = row?.section;
  const play = row?.play;
  const snapshot = useCallback(() => {
    if (!store || play == null || section == null) return 0;
    const open = sameRow(store.open, { section, play });
    return (store.replay(play) != null ? 1 : 0) | (open ? 2 : 0);
  }, [store, section, play]);
  const bits = useSyncExternalStore(store ? store.subscribe : none, snapshot, () => 0);
  const toggle = useCallback(
    (via: ReplayVia) => {
      if (store && section != null && play != null) store.toggle({ section, play }, via);
    },
    [store, section, play],
  );
  return { supported: store?.supported ?? false, replayable: (bits & 1) !== 0, open: (bits & 2) !== 0, toggle };
}

/** The open row's replay and who's who, for its well (null while closed or unbuilt). */
export function useOpenReplay(row: ReplayRow): { readonly replay: PlayReplay; readonly context: ReplayContext } | null {
  const store = useReplays();
  const replay = useSyncExternalStore(store ? store.subscribe : none, () => (store && sameRow(store.open, row) ? store.replay(row.play) : null), () => null);
  const context = useSyncExternalStore(store ? store.subscribe : none, () => store?.context ?? null, () => null);
  return replay && context ? { replay, context } : null;
}
