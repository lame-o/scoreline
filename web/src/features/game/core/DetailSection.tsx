/**
 * The game page's building blocks (Visualizations.swift `DetailSection`,
 * VizKit.swift `ChartFooter`, `VizLegend`, `vizWell`):
 *
 * - `DetailSection`: a titled block: the small-caps title with its state at
 *   the trailing edge (Live, Final, the live count "2–2", or text), and a
 *   one-line caption saying what the block shows and where it comes from.
 *   `spokenCaption` is the caption in words when the visible one leans on
 *   glyphs or short names ("MIL attacks →").
 * - `VizWell`: the quiet surface behind spatial charts.
 * - `ChartFooter`: the line under a chart: its legend, or, while a mark is
 *   pointed at, that mark in words; or what just happened, while it's news.
 *   Pointing beats news; news beats the legend; the legend keeps its space,
 *   so nothing shifts.
 *
 *     <DetailSection id="atBat" title="This At-Bat" accessory={{ count: [2, 2] }}>…</DetailSection>
 */
import type { ReactNode } from "react";
import { SectionTitle, type SectionTitleProps } from "../../../design/components";
import { captioned, type LiveMoment } from "../../../data/moments";
import type { Section } from "../../../data/sections";
import styles from "./DetailSection.module.css";

export interface DetailSectionProps {
  readonly id: Section;
  readonly title: string;
  readonly caption?: string | null;
  readonly spokenCaption?: string;
  readonly accessory?: SectionTitleProps["accessory"];
  readonly children: ReactNode;
}

export function DetailSection({ id, title, caption, spokenCaption, accessory, children }: DetailSectionProps) {
  const titleID = `section-${id}`;
  return (
    <section className={styles.section} aria-labelledby={titleID} data-section={id}>
      <div className={styles.head}>
        <SectionTitle id={titleID} accessory={accessory}>
          {title}
        </SectionTitle>
        {caption ? (
          <p className={styles.caption}>
            {spokenCaption ? (
              <>
                <span aria-hidden="true">{caption}</span>
                <span className="visually-hidden">{spokenCaption}</span>
              </>
            ) : (
              caption
            )}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** The quiet surface behind spatial charts (pitch, field, zone): a faint tint in light, a plate in dark. */
export function VizWell({ children, className, padding = 10, style }: { children: ReactNode; className?: string; padding?: number; style?: React.CSSProperties }) {
  return (
    <div className={[styles.well, className].filter(Boolean).join(" ")} style={{ padding: `calc(${padding} * var(--pt))`, ...style }}>
      {children}
    </div>
  );
}

export function Legend({ children }: { children: ReactNode }) {
  return <div className={styles.legend}>{children}</div>;
}

export function LegendItem({ label, swatch }: { label: string; swatch: ReactNode }) {
  return (
    <span className={styles.legendItem}>
      <span className={styles.swatch} aria-hidden="true">
        {swatch}
      </span>
      {label}
    </span>
  );
}

export interface Readout {
  readonly lead: string;
  readonly detail: string;
}

export function ChartFooter({ readout, moment, children }: { readout: Readout | null; moment?: LiveMoment | null; children?: ReactNode }) {
  const caption = moment && captioned(moment) ? moment : null;
  const covered = readout != null || caption != null;
  return (
    <div className={styles.footer}>
      <div className={styles.footerLegend} style={{ opacity: covered ? 0 : 1 }} aria-hidden={covered}>
        {children}
      </div>
      {readout ? (
        <p className={styles.readout} key="readout">
          <strong>{readout.lead}</strong>
          {readout.detail ? <span>{`  ${readout.detail}`}</span> : null}
        </p>
      ) : caption ? (
        <MomentCaption moment={caption} />
      ) : null}
    </div>
  );
}

/** The caption line for a moment: a red dot (live), the outcome, then the play. Rises 4pt into place. */
export function MomentCaption({ moment }: { moment: LiveMoment }) {
  return (
    <p className={`${styles.readout} ${styles.moment}`} key={moment.id}>
      <span className={styles.dot} aria-hidden="true" />
      <strong>{moment.lead}</strong>
      {moment.detail ? <span>{`  ${moment.detail}`}</span> : null}
    </p>
  );
}
