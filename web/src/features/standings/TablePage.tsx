/**
 * The frame the standings, polls and bracket pages share (StandingsView,
 * RankingsView and BracketPage's `PageHeader` + `PageScrollView`): a sticky
 * header (Back on a phone; Esc everywhere) with a soft scroll edge once
 * content is underneath, then the content, capped at a readable width and
 * measured once (`useWidth`) so blocks add columns as it widens, the Mac's
 * `PanelLayout`: two columns from 680pt, each block's width class from its
 * own room (380, 460, 560pt of content).
 *
 * The content assembles like a page entrance when clicked into; keyboard
 * arrivals (`state.viaKeyboard`) and data that lands later are instant.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import { BackButton, PageHeader } from "../../design/components";
import { useWidth } from "../../design/useWidth";
import { widthClassOf, type WidthClass } from "../../data/standings";
import { useSplit, type NavState } from "../../app/layout";
import { useGoBack } from "../../app/navigation";
import styles from "./TablePage.module.css";

/** Two columns of exactly 340pt (Metrics.splitWidth). */
export const SPLIT_WIDTH = 680;
const GUTTERS = 28;

/** The page's arrangement from its width (Responsive.swift `PanelLayout.resolve`). */
export interface PageLayout {
  readonly width: number;
  readonly split: boolean;
  /** A block spanning the page. */
  readonly page: WidthClass;
  /** A block in one column (equals `page` with one column). */
  readonly column: WidthClass;
}

export function pageLayout(width: number): PageLayout {
  const split = width >= SPLIT_WIDTH;
  const page = widthClassOf(width - GUTTERS);
  return { width, split, page, column: split ? widthClassOf(width / 2 - GUTTERS) : page };
}

export function TablePage({ title, trailing, children }: { title: string; trailing?: ReactNode; children: (layout: PageLayout) => ReactNode }) {
  const split = useSplit();
  const goBack = useGoBack();
  const viaKeyboard = (useLocation().state as NavState | null)?.viaKeyboard === true;
  const content = useRef<HTMLDivElement>(null);
  const width = useWidth(content);
  const sentinel = useRef<HTMLSpanElement>(null);
  const scrolled = useScrolled(sentinel);
  return (
    <div className={styles.page} data-entrance={viaKeyboard ? "none" : "stack"}>
      <span ref={sentinel} className={styles.sentinel} aria-hidden="true" />
      <div className={styles.header} data-scrolled={scrolled}>
        <PageHeader title={title} leading={split ? null : <BackButton to="Back" onClick={() => goBack()} />} trailing={trailing} />
      </div>
      <div ref={content} className={styles.content}>
        {children(pageLayout(width))}
      </div>
    </div>
  );
}

/** Whether the page has scrolled past its top (the detail pane scrolls on its own; a phone's window does). */
function useScrolled(sentinel: React.RefObject<HTMLElement | null>): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const scroller = el.closest("main");
    const root = scroller && getComputedStyle(scroller).overflowY !== "visible" ? scroller : null;
    const observer = new IntersectionObserver(([entry]) => setScrolled(!entry?.isIntersecting), { root, threshold: 0 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [sentinel]);
  return scrolled;
}

/**
 * A titled block (Visualizations.swift `DetailSection`): the small caps
 * title, a caption under it, then the content.
 */
export function Section({ title, caption, children, className }: { title: string; caption?: string; children: ReactNode; className?: string }) {
  return (
    <section className={[styles.section, className].filter(Boolean).join(" ")} aria-label={title}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {caption ? <p className={styles.caption}>{caption}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** Static rows shaped like a table while it loads (placeholders never shimmer). */
export function SkeletonTable({ rows = 12 }: { rows?: number }) {
  return (
    <div className={styles.skeleton} aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={styles.skeletonRow}>
          <span className={styles.skeletonBlock} style={{ width: "calc(14 * var(--pt))" }} />
          <span className={styles.skeletonDisc} />
          <span className={styles.skeletonBlock} style={{ width: `calc(${70 + ((i * 37) % 60)} * var(--pt))` }} />
          <span className={styles.skeletonSpacer} />
          <span className={styles.skeletonBlock} style={{ width: "calc(60 * var(--pt))" }} />
        </div>
      ))}
    </div>
  );
}
