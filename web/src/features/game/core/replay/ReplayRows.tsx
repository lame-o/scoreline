/**
 * A play replayed under its row (ReplayWell.swift's rows; Replays.swift says
 * which plays can): the row's hover glyph, the click that opens and closes
 * it, and the place under the row the well unfolds into. A row whose play
 * can't replay is left exactly as it is.
 *
 * - A click opens it under the row (closing any other row's) and pins the
 *   play on the charts at the same time, as the row's click always has; a
 *   click again (or Esc) closes it. From the keyboard: Return or Space on a
 *   row that's a button; on a row holding links (football's names), its
 *   glyph is a button of its own ("Watch Replay").
 * - Opening travels like a group opening in the lists (the space under the
 *   row opens as the well is revealed from its top, opaque before it's all
 *   there); closing is quicker. The keyboard opens and closes it at once;
 *   with Reduce Motion it's a short fade.
 * - Once open it's brought into view below the docked scorebar, if it isn't.
 * - The well itself (ReplayWell.tsx, and the sport's drawing) is its own
 *   chunk, fetched as the pointer reaches a row that replays.
 *
 *     const replay = useReplayRow({ section: "moments", play: id });
 *     <div {...replayRowProps(rowProps, replay, links)}>… <ReplayGlyph replay={replay} /></div>
 *     <ReplaySlot row={row} replay={replay} />
 */
import { AnimatePresence, m, type Variants } from "motion/react";
import { lazy, Suspense, useEffect, useId, useRef, type ComponentType, type FocusEvent, type HTMLAttributes, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { EASE_OUT, spring } from "../../../../design/motion";
import type { PlayReplay, ReplayContext, ReplayRow } from "../../../../data/replays";
import { useReducedMotion } from "../useMedia";
import { useOpenReplay, useReplays, type ReplayVia, type RowReplay } from "./pageReplays";
import type { ReplaySport } from "./replayDrawing";
import styles from "./Replay.module.css";

// MARK: - The well, by sport (each its own chunk, the well's frame shared)

type Kind = PlayReplay["scene"]["kind"];
type WellProps = { readonly replay: PlayReplay; readonly context: ReplayContext; readonly via: ReplayVia };

const SPORTS: Record<Kind, () => Promise<ReplaySport<unknown>>> = {
  baseball: () => import("../../mlb/theater/replayPlate").then((m) => m.baseballReplay as ReplaySport<unknown>),
  football: () => import("../../football/theater/replayField").then((m) => m.footballReplay as ReplaySport<unknown>),
  basketball: () => import("../../nba/theater/replayCourt").then((m) => m.basketballReplay as ReplaySport<unknown>),
  soccer: () => import("../../soccer/theater/replayPitch").then((m) => m.soccerReplay as ReplaySport<unknown>),
};

const wells = new Map<Kind, ComponentType<WellProps>>();

/** A sport's well: the shared frame and the sport's drawing, fetched together. */
function wellFor(kind: Kind): ComponentType<WellProps> {
  let well = wells.get(kind);
  if (!well) {
    well = lazy(() =>
      Promise.all([import("./ReplayWell"), SPORTS[kind]()]).then(([frame, sport]) => ({
        default: (props: WellProps) => <frame.ReplayWell {...props} sport={sport} />,
      })),
    );
    wells.set(kind, well);
  }
  return well;
}

/** Fetches a sport's well before it's asked for (the pointer on a row that replays), so a click rarely waits. */
export function warmReplayWell(kind: Kind | null | undefined): void {
  if (!kind) return;
  void import("./ReplayWell");
  void SPORTS[kind]();
}

// MARK: - Rows

/**
 * A replayable row's props over its linked row's (`useLinkedRow`): a click
 * (beside its links) opens or closes the replay as well as pinning; Return
 * or Space on a row that's a button does the same, at once. A row that
 * doesn't replay keeps its own props.
 */
export function replayRowProps<T extends HTMLAttributes<HTMLElement>>(props: T, replay: RowReplay, slot: string, warm: () => void): T {
  if (!replay.replayable) return props;
  const button = props.role === "button";
  return {
    ...props,
    "data-replay": replay.open ? "open" : "ready",
    onClick: (e: MouseEvent<HTMLElement>) => {
      props.onClick?.(e);
      // A name's link opens its page; the glyph's button is its own.
      if ((e.target as Element).closest("a, button") && e.target !== e.currentTarget) return;
      replay.toggle(e.detail === 0 ? "keyboard" : "pointer");
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      props.onKeyDown?.(e);
      if (button && e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) replay.toggle("keyboard");
    },
    onPointerEnter: (e: PointerEvent<HTMLElement>) => {
      props.onPointerEnter?.(e);
      warm();
    },
    onFocus: (e: FocusEvent<HTMLElement>) => {
      props.onFocus?.(e);
      warm();
    },
    ...(button ? { "aria-expanded": replay.open, ...(replay.open ? { "aria-controls": slot } : {}) } : {}),
  };
}

const PlayGlyph = () => (
  <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" focusable="false" className={styles.triangle}>
    <path d="M2.5 1.4v7.2L8.6 5z" fill="currentColor" />
  </svg>
);

/**
 * The play glyph at a replayable row's trailing edge, while the pointer's on
 * the row (hover is instant, as a row's wash is). Lists in a sport with an
 * isometric view keep its place on every row, so the columns stay put
 * whether a row replays or not. On a row holding links it's the keyboard's
 * way in: a button of its own, shown when focused.
 */
export function ReplayGlyph({ replay, button = false, slot }: { replay: RowReplay; button?: boolean; slot?: string }) {
  if (!replay.supported) return null;
  if (button && replay.replayable) {
    return (
      <button
        type="button"
        className={`${styles.glyph} ${styles.glyphButton}`}
        data-open={replay.open}
        aria-label={replay.open ? "Close Replay" : "Watch Replay"}
        aria-expanded={replay.open}
        aria-controls={replay.open ? slot : undefined}
        onClick={(e) => {
          e.stopPropagation();
          replay.toggle(e.detail === 0 ? "keyboard" : "pointer");
        }}
      >
        <PlayGlyph />
      </button>
    );
  }
  return (
    <span className={styles.glyph} data-open={replay.open} aria-hidden="true">
      {replay.replayable ? <PlayGlyph /> : null}
    </span>
  );
}

// MARK: - The place under the row

interface Unfold {
  readonly via: ReplayVia;
  readonly reduce: boolean;
}

/** The well revealed from its top as the space under the row opens (and hidden the same way as it closes), opaque before it's all there. */
const UNFOLD: Variants = {
  closed: ({ via, reduce }: Unfold) => ({
    height: 0,
    opacity: 0,
    transition: via === "keyboard" ? { duration: 0 } : reduce ? { height: { duration: 0 }, opacity: { duration: 0.12, ease: EASE_OUT } } : { height: spring.standard, opacity: { duration: 0.19, delay: 0.06, ease: EASE_OUT } },
  }),
  open: ({ via, reduce }: Unfold) => ({
    height: "auto",
    opacity: 1,
    transition: via === "keyboard" ? { duration: 0 } : reduce ? { height: { duration: 0 }, opacity: { duration: 0.15, ease: EASE_OUT } } : { height: spring.travel, opacity: { duration: 0.25, ease: EASE_OUT } },
  }),
};

/**
 * Where a row's replay opens: under it, the row's list's width. `inset`: the
 * row's list runs 6pt past the column each side (its washes do); the well
 * stays in the column. Focus inside it when it closes goes back to the row.
 */
export function ReplaySlot({ row, open, id, inset = false, returnFocus }: { row: ReplayRow; open: boolean; id: string; inset?: boolean; returnFocus: () => void }) {
  const store = useReplays();
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const custom: Unfold = { via: store?.via ?? "pointer", reduce };
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open && ref.current?.contains(document.activeElement)) returnFocus();
    wasOpen.current = open;
  }, [open, returnFocus]);
  return (
    <AnimatePresence initial={false} custom={custom}>
      {open ? (
        <m.div key="replay" ref={ref} id={id} className={inset ? `${styles.slot} ${styles.inset}` : styles.slot} variants={UNFOLD} custom={custom} initial="closed" animate="open" exit="closed">
          <OpenWell row={row} via={custom.via} />
        </m.div>
      ) : null}
    </AnimatePresence>
  );
}

/** The open row's well, once its replay and who's who are here; brought into view below the docked scorebar once it has opened. */
function OpenWell({ row, via }: { row: ReplayRow; via: ReplayVia }) {
  const open = useOpenReplay(row);
  const store = useReplays();
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (ref.current) store?.geometry?.reveal(ref.current, 8, !reduce && via === "pointer");
    }, reduce || via === "keyboard" ? 200 : 420);
    return () => clearTimeout(timer);
  }, [store, reduce, via]);
  const Well = open ? wellFor(open.replay.scene.kind) : null;
  return (
    <div ref={ref} className={styles.pad}>
      {open && Well ? (
        <Suspense fallback={<div className={styles.placeholder} aria-hidden="true" />}>
          <Well replay={open.replay} context={open.context} via={via} />
        </Suspense>
      ) : (
        <div className={styles.placeholder} aria-hidden="true" />
      )}
    </div>
  );
}

/** The slot's ID for a row (aria-controls). */
export function useSlotID(): string {
  return `replay-${useId().replace(/:/g, "")}`;
}

