/**
 * The chart peek (LinkedPeek.swift `LinkedPeekHost`, `PeekCard`, `PeekPill`,
 * `PeekMotion`, `PeekArrivalFlash`). Hovering a row (a scoring play, an
 * inning, a box score line, a climber's result) whose chart is out of view
 * docks a small live copy of that chart at the edge of the viewport on the
 * chart's side, showing the same highlight, its chevron pointing at the real
 * one. The decisions (which chart, when, which edge) are pure, in
 * data/peek.ts; this draws them.
 *
 * - Nothing here draws a chart: the sport page hands over its own chart for
 *   a section (`PeekSource.chart`), and the copy renders under the same
 *   linked focus, with no moments, celebrations, footers or hit targets
 *   (`useChartPeek()` is true inside it).
 * - It waits for hover intent (260 ms), then follows at once for the rest of
 *   the hover; a pin shows it at once. It holds while the pointer is on it,
 *   and a click pins the focus and scrolls to the real chart, whose border
 *   flashes the accent as it arrives.
 * - Compact on one column (the chart's aspect at a plot 150pt tall, at the
 *   trailing edge), the chart's own column on two, a one-line readout pill
 *   on a viewport under 360pt tall.
 * - Motion: in 12pt from its edge on the standard spring with a 0.97 → 1
 *   scale and a fade; out faster, 8pt toward the edge; a new edge is a new
 *   peek. Reduce Motion: fades only. Screen readers get the rows' own words;
 *   the peek is for the eye (aria-hidden, nothing in the tab order).
 *
 *     <LinkedPeekHost source={sport.peek} kind={kind} geometry={geometry} columns={columns} shown={shown} />
 */
import { AnimatePresence, m } from "motion/react";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { GlassCard, Icon } from "../../../design/components";
import { spring, tween } from "../../../design/motion";
import { peekChartCap, peekCompactWidth, PeekController, peekHeight, peekMode, peekReadout, peekTarget, type PeekDock, type PeekFocus, type PeekInputs, type PeekPresentation } from "../../../data/peek";
import type { PageKind, Section } from "../../../data/sections";
import { DOCK_INSET, useSectionVisibility, useSurface, type PageGeometry } from "./geometry";
import { useLinkedStore, type Focus } from "./linked";
import { MomentProvider, type MomentSlot } from "./moments";
import { pointSize, useReducedMotion } from "./useMedia";
import styles from "./peek.module.css";

// MARK: - The peek's environment

const ChartPeekContext = createContext(false);

/** True inside the chart peek: a chart drops its footer and readouts (the row being read says it). */
export function useChartPeek(): boolean {
  return useContext(ChartPeekContext);
}

/** A moment slot nothing offers to: no captions or moment animations in a peek (PeekInert.moments). */
const INERT_SLOT: MomentSlot = {
  current: () => null,
  subscribe: () => () => {},
  offer: () => {},
  retract: () => {},
  remember: () => {},
  clear: () => {},
};

/** What a sport's page gives the peek (SportPage.peek). */
export interface PeekSource {
  /** What a focus can land on, by chart (marks with their readouts). */
  readonly inputs: Omit<PeekInputs, "shown">;
  /**
   * The page's own chart for a section, as its section draws it (without the
   * title, caption or a theater); list-like charts may narrow to the focus
   * (a climber and their neighbors).
   */
  readonly chart: (section: Section, focus: PeekFocus | null) => ReactNode;
  /** Width over height for a chart that keeps its shape (the pitch, the court); full width without one. */
  readonly aspect?: Partial<Record<Section, number>>;
  /** A player picked outside the linked store (the NBA's box score), shown like a pin. */
  readonly picked?: {
    readonly get: () => string | null;
    readonly subscribe: (listener: () => void) => () => void;
    readonly pick: (player: string) => void;
    readonly unpin: () => boolean;
  } | null;
}

const none = () => () => {};
const nothing = () => null;

// MARK: - Host

export function LinkedPeekHost({ source, kind, geometry, columns, shown }: { source: PeekSource | null | undefined; kind: PageKind; geometry: PageGeometry; columns: boolean; shown: readonly Section[] }) {
  if (!source) return null;
  return <Host source={source} kind={kind} geometry={geometry} columns={columns} shown={shown} />;
}

function Host({ source, kind, geometry, columns, shown }: { source: PeekSource; kind: PageKind; geometry: PageGeometry; columns: boolean; shown: readonly Section[] }) {
  const store = useLinkedStore();
  const controller = useMemo(() => new PeekController(), []);
  useEffect(() => () => controller.dispose(), [controller]);
  const reduce = useReducedMotion();
  const surface = useSurface(geometry);

  const hovered = useSyncExternalStore(store?.subscribe ?? none, store?.hovering ?? nothing, nothing);
  const pinned = useSyncExternalStore(store?.subscribe ?? none, store?.pin ?? nothing, nothing);
  const picked = useSyncExternalStore(source.picked?.subscribe ?? none, source.picked?.get ?? nothing, nothing);
  const pickedFocus = useMemo<Focus | null>(() => (picked ? { player: picked } : null), [picked]);
  const focus: Focus | null = hovered ?? pinned ?? pickedFocus;

  // The section under the pointer (a row's section is the source) and the pointer's height (for the dock's band):
  // read when the peek decides, never rendered.
  const pointerSection = useRef<Section | null>(null);
  const pointerY = useRef<number | null>(null);
  useEffect(() => {
    const over = (e: PointerEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest("[data-peek]")) return;
      pointerSection.current = (target?.closest<HTMLElement>("[data-section]")?.dataset.section as Section | undefined) ?? null;
    };
    const move = (e: PointerEvent) => {
      pointerY.current = e.clientY;
    };
    document.addEventListener("pointerover", over, { passive: true });
    window.addEventListener("pointermove", move, { passive: true });
    return () => {
      document.removeEventListener("pointerover", over);
      window.removeEventListener("pointermove", move);
    };
  }, []);

  // The page's entrance: nothing peeks for its first 350 ms.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setEntered(true), 350);
    return () => clearTimeout(timer);
  }, []);

  const [held, setHeld] = useState(false);
  const inputs = useMemo<PeekInputs>(() => ({ ...source.inputs, shown: new Set(shown) }), [source.inputs, shown]);
  const target = focus ? peekTarget(focus as PeekFocus, kind, inputs, hovered ? pointerSection.current : null) : null;
  const visibility = useSectionVisibility(geometry, target);

  // Measures in Mac points, read when they're needed.
  const viewportPt = useCallback(() => {
    const v = geometry.viewport();
    const pt = pointSize();
    return { width: (v.right - v.left) / pt, height: (v.bottom - v.top) / pt };
  }, [geometry]);

  // The card's height as drawn (a court's scrubber, a long chart), else the layout's estimate.
  const cardHeight = useRef<number | null>(null);
  const onHeight = useCallback((px: number) => {
    cardHeight.current = px;
  }, []);
  const barDown = surface === "bar";
  useEffect(() => {
    controller.pointerInBand = (dock: PeekDock) => {
      const y = pointerY.current;
      if (y == null) return false;
      const v = geometry.viewport();
      const pt = pointSize();
      const height = cardHeight.current ?? peekHeight(viewportPt(), peekMode(viewportPt(), columns)) * pt;
      // The band the card would cover, from its edge (under the docked bar at the top), plus 12pt.
      const inset = (dock === "top" ? 6 + (barDown ? DOCK_INSET - 4 : 0) : 6) * pt;
      const band = inset + height + 12 * pt;
      return dock === "top" ? y < v.top + band : y > v.bottom - band;
    };
    controller.onArrival = (section) => flashArrival(geometry, section);
  }, [controller, geometry, columns, viewportPt, barDown]);

  useLayoutEffect(() => {
    controller.update({ focus, pinned: hovered == null, target, visibility, held, blocked: !entered });
  }, [controller, focus, hovered, target, visibility, held, entered]);

  const presented = useSyncExternalStore(controller.subscribe, controller.presented, nothing);

  // Removed under the pointer (clicked, or its chart scrolled into view), the card never hears the
  // pointer leave: let go of the hold here, or the page's hover could never clear again.
  const holding = useRef(false);
  const setHold = useCallback(
    (on: boolean) => {
      if (holding.current === on) return;
      holding.current = on;
      setHeld(on);
      store?.hold(on);
    },
    [store],
  );
  useEffect(() => {
    if (!presented) setHold(false);
  }, [presented, setHold]);
  useEffect(() => () => store?.hold(false), [store]);

  if (typeof document === "undefined") return null;
  const isPinned = pinned != null || picked != null;
  const click = (p: PeekPresentation) => {
    // A hover-only focus is pinned, so the highlight survives the scroll.
    if (hovered) {
      if (hovered.player != null && p.section === "court" && source.picked) {
        if (source.picked.get() !== hovered.player) source.picked.pick(hovered.player);
      } else store?.pinFocus(hovered);
    }
    controller.expectArrival(p.section);
    setHold(false);
    geometry.scrollToSection(p.section, (DOCK_INSET + 8) * pointSize());
  };
  const unpin = () => {
    if (!store?.unpin()) source.picked?.unpin();
  };

  return createPortal(
    <AnimatePresence>
      {presented ? (
        <PeekFrame
          key={presented.dock}
          presentation={presented}
          geometry={geometry}
          columns={columns}
          barDown={barDown}
          reduce={reduce}
          onHeight={onHeight}
          viewport={viewportPt()}
          onHold={setHold}
          onClick={() => click(presented)}
        >
          {(mode, title) =>
            mode === "pill" ? (
              <PeekPill points={presented.points} readout={(focus && peekReadout(focus as PeekFocus, presented.section, inputs)) ?? { lead: title, detail: "" }} />
            ) : (
              <PeekCard title={title} points={presented.points} pinned={isPinned} onUnpin={unpin}>
                <PeekChart key={presented.section} section={presented.section} focus={focus as PeekFocus | null} source={source} mode={mode} viewport={viewportPt()} geometry={geometry} />
              </PeekCard>
            )
          }
        </PeekFrame>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

/** The chart's title as its section shows it ("Shot Map"), read from the page. */
function sectionTitle(geometry: PageGeometry, section: Section): string {
  const heading = geometry.root?.querySelector(`#section-${section}`);
  // The title's own words, not the accessory spoken after it (", Live").
  const words = heading?.querySelector(":scope > span:not([class*='icon']):not(.visually-hidden)") ?? heading;
  return words?.textContent?.trim() || "Chart";
}

/** The real chart's content box (the column mode lines up with it). */
function sectionBox(geometry: PageGeometry, section: Section): DOMRect | null {
  const el = geometry.root?.querySelector<HTMLElement>(`[data-section="${section}"]`);
  const head = el?.firstElementChild as HTMLElement | null;
  return head?.getBoundingClientRect() ?? el?.getBoundingClientRect() ?? null;
}

/**
 * Where the peek sits and how it moves: fixed to the visible pane's edge
 * (below the docked scorebar once it's down), trailing on one column, under
 * the chart's own column on two.
 */
function PeekFrame({
  presentation: p,
  geometry,
  columns,
  barDown,
  reduce,
  viewport,
  onHeight,
  onHold,
  onClick,
  children,
}: {
  presentation: PeekPresentation;
  geometry: PageGeometry;
  columns: boolean;
  barDown: boolean;
  reduce: boolean;
  viewport: { width: number; height: number };
  onHeight: (px: number) => void;
  onHold: (on: boolean) => void;
  onClick: () => void;
  children: (mode: ReturnType<typeof peekMode>, title: string) => ReactNode;
}) {
  const mode = peekMode(viewport, columns);
  const pt = pointSize();
  const v = geometry.viewport();
  const title = sectionTitle(geometry, p.section);
  const top = p.dock === "top";
  const style: React.CSSProperties = {};
  if (top) style.top = `${v.top + (6 + (barDown ? DOCK_INSET - 4 : 0)) * pt}px`;
  else style.bottom = `${window.innerHeight - v.bottom + 6 * pt}px`;
  if (mode === "column") {
    const box = sectionBox(geometry, p.section);
    style.left = `${box?.left ?? v.left}px`;
    style.width = `${Math.max(box?.width ?? (v.right - v.left) / 2, 180 * pt)}px`;
  } else {
    style.right = `${window.innerWidth - v.right + 10 * pt}px`;
  }
  const sign = top ? -1 : 1;
  const motion = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1, transition: tween.fade }, exit: { opacity: 0, transition: tween.exit } }
    : {
        initial: { opacity: 0, transform: `translateY(${12 * sign * pt}px) scale(0.97)` },
        animate: { opacity: 1, transform: "translateY(0px) scale(1)", transition: { transform: spring.standard, opacity: tween.fade } },
        exit: { opacity: 0, transform: `translateY(${8 * sign * pt}px) scale(1)`, transition: tween.exit },
      };
  const frame = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = frame.current;
    if (!el) return;
    const read = () => onHeight(el.offsetHeight);
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [onHeight]);
  return (
    <m.div
      ref={frame}
      className={styles.frame}
      data-peek=""
      data-dock={p.dock}
      style={{ ...style, transformOrigin: top ? "top center" : "bottom center" }}
      {...motion}
      aria-hidden="true"
      title={`Show the ${title}`}
      onPointerEnter={() => onHold(true)}
      onPointerLeave={() => onHold(false)}
      onClick={(e) => {
        if ((e.target as Element).closest("button")) return;
        onClick();
      }}
    >
      {children(mode, title)}
    </m.div>
  );
}

/** The compact (or column) peek: glass with a solid plate under the chart (charts on glass wash out), a header naming it with a chevron toward it, and an unpin chip while pinned. */
function PeekCard({ title, points, pinned, onUnpin, children }: { title: string; points: "above" | "below"; pinned: boolean; onUnpin: () => void; children: ReactNode }) {
  return (
    <GlassCard variant="strong" className={styles.card}>
      <div className={styles.head}>
        <span className={styles.chevron} data-points={points}>
          <Icon name="chevronDown" size={9} />
        </span>
        <span className={styles.title}>{title}</span>
        <span className={styles.flex} />
        {pinned ? (
          <button type="button" className={styles.unpin} onClick={onUnpin} title="Unpin" tabIndex={-1}>
            <Icon name="xmark" size={8} />
          </button>
        ) : null}
      </div>
      <div className={styles.plate}>{children}</div>
    </GlassCard>
  );
}

/** The page's chart in the peek's environment: same focus (and NBA stage), no moments, celebrations, entrances, footers or hit targets. */
function PeekChart({ section, focus, source, mode, viewport, geometry }: { section: Section; focus: PeekFocus | null; source: PeekSource; mode: "compact" | "column"; viewport: { width: number; height: number }; geometry: PageGeometry }) {
  const aspect = source.aspect?.[section] ?? null;
  const pt = pointSize();
  const width = mode === "compact" ? peekCompactWidth(viewport, aspect) - 20 : Math.max((sectionBox(geometry, section)?.width ?? 360 * pt) / pt - 20, 160);
  const cap = mode === "compact" ? peekChartCap(viewport) : 0.45 * viewport.height;
  return (
    <div className={styles.chart} style={{ width: `calc(${width} * var(--pt))`, maxHeight: `calc(${cap} * var(--pt))` }} inert>
      <ChartPeekContext.Provider value={true}>
        <MomentProvider slot={INERT_SLOT}>{source.chart(section, focus)}</MomentProvider>
      </ChartPeekContext.Provider>
    </div>
  );
}

/** A short viewport's peek: the chevron and the chart's readout in a capsule. */
function PeekPill({ points, readout }: { points: "above" | "below"; readout: { lead: string; detail: string } }) {
  return (
    <GlassCard variant="capsule" className={styles.pill}>
      <span className={styles.chevron} data-points={points}>
        <Icon name="chevronDown" size={9} />
      </span>
      <span className={styles.pillText}>
        <strong>{readout.lead}</strong>
        {readout.detail ? <span>{`  ${readout.detail}`}</span> : null}
      </span>
    </GlassCard>
  );
}

// MARK: - The real chart's arrival flash

/** The clicked peek's chart, arriving in view: its border flashes the accent once (color only, so it plays with Reduce Motion too). */
function flashArrival(geometry: PageGeometry, section: Section): void {
  const el = geometry.root?.querySelector<HTMLElement>(`[data-section="${section}"]`);
  if (!el || typeof el.animate !== "function") return;
  el.animate(
    [
      { borderRadius: "calc(12 * var(--pt))", boxShadow: "inset 0 0 0 calc(1.5 * var(--pt)) color-mix(in srgb, var(--accent) 50%, transparent)" },
      { borderRadius: "calc(12 * var(--pt))", boxShadow: "inset 0 0 0 calc(1.5 * var(--pt)) color-mix(in srgb, var(--accent) 0%, transparent)" },
    ],
    { duration: 600, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
  );
}
