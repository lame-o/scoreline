/**
 * Small pieces the season pages share (ClimbingSeasonPage.swift `MonthLabel`,
 * `LinkButton`, `SeasonFooter`, `SeasonSkeleton`; TournamentsPage.swift
 * `TournamentLogo`; SharedUI.swift `SectionLink`; ProfileLinks.swift
 * `SubLabel`), and the row styles every season row wears.
 */
import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router";
import { Icon, SectionTitle, TeamLogo } from "../../design/components";
import { clockTime, updatedAgo } from "../../data/format";
import { monthYearLabel, type DayKey } from "../../data/days";
import { useNow } from "../../state/clock";
import styles from "./parts.module.css";

export { styles as partStyles };

/** "October 2026", a section over each month's competitions. */
export function MonthLabel({ month, className, style }: { month: DayKey; className?: string; style?: CSSProperties }) {
  return (
    <div className={[styles.month, className].filter(Boolean).join(" ")} style={style}>
      <SectionTitle>{monthYearLabel(month.year, month.month)}</SectionTitle>
    </div>
  );
}

/** "WORLD CHAMPIONSHIPS": a small capsule that never truncates. */
export function Badge({ children }: { children: string }) {
  return <span className={styles.badge}>{children}</span>;
}

/** A small caps label inside a detail ("PODIUMS", "SAT, OCT 24"). */
export function SubLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <h3 className={[styles.subLabel, className].filter(Boolean).join(" ")}>{children}</h3>;
}

/** "All Results ›": a quiet text link, brighter under the pointer. A button, or a link with `to`. */
export function SectionLink({ children, onClick, to, title, icon = "chevronRight" }: { children: string; onClick?: () => void; to?: string; title?: string; icon?: "chevronRight" | "external" }) {
  const inner = (
    <>
      {children}
      <Icon name={icon} size={8} />
    </>
  );
  if (to) {
    return (
      <Link className={styles.sectionLink} to={to} title={title ?? children}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" className={styles.sectionLink} onClick={onClick} title={title ?? children}>
      {inner}
    </button>
  );
}

/** "ifsc.results.info ↗": an official page, in a new tab. */
export function LinkButton({ title, href }: { title: string; href: string }) {
  return (
    <a className={styles.linkButton} href={href} target="_blank" rel="noreferrer noopener" title={href}>
      {title}
      <Icon name="external" size={8} />
    </a>
  );
}

/**
 * A tournament's logo, or a trophy when bo3.gg has none. bo3.gg's logos are
 * drawn for dark pages (many are white), so in light mode they sit on a
 * small dark tile.
 */
export function TournamentLogo({ url, size }: { url: string | null; size: number }) {
  const box = `calc(${size} * var(--pt))`;
  if (!url) {
    return (
      <span className={styles.trophy} style={{ width: box, height: box }} aria-hidden="true">
        <Icon name="trophy" size={size * 0.6} />
      </span>
    );
  }
  return (
    <span className={styles.logoTile} style={{ width: box, height: box, borderRadius: `calc(${size * 0.24} * var(--pt))` }} aria-hidden="true">
      <TeamLogo url={url} size={Math.round(size * 0.78)} className={styles.logoInTile} />
    </span>
  );
}

/** "Updated 2 minutes ago", or that the data is saved, not fresh. */
export function SeasonFooter({ updated, stale, loading, subject = "calendar" }: { updated: number | null; stale: boolean; loading: boolean; subject?: string }) {
  const now = useNow(30_000);
  let text = "";
  if (updated == null) text = loading ? "Updating…" : "";
  else if (stale) text = `Can't connect · Showing ${subject} from ${clockTime(updated)}`;
  else text = updatedAgo(updated, now);
  return (
    <footer className={styles.footer}>
      {stale && updated != null ? <Icon name="wifiSlash" size={9.5} /> : null}
      <span>{text}</span>
    </footer>
  );
}

/** A static timeline frame and event rows while the calendar loads. */
export function SeasonSkeleton({ label = "Loading calendar" }: { label?: string }) {
  return (
    <div className={styles.skeleton} role="status" aria-label={label}>
      <span className={styles.skeletonCard} />
      {[0, 1, 2].map((row) => (
        <span key={row} className={styles.skeletonLane} style={{ marginTop: row === 0 ? "calc(18 * var(--pt))" : "calc(9 * var(--pt))" }}>
          <span style={{ width: "calc(36 * var(--pt))" }} />
          <span style={{ width: `calc(${60 + row * 40} * var(--pt))`, marginLeft: `calc(${row * 30} * var(--pt))` }} />
        </span>
      ))}
      {[0, 1, 2, 3].map((row) => (
        <span key={`r${row}`} className={styles.skeletonRow}>
          <span className={styles.skeletonDot} />
          <span className={styles.skeletonLines}>
            <span style={{ width: "calc(90 * var(--pt))" }} />
            <span style={{ width: "calc(150 * var(--pt))", height: "calc(7 * var(--pt))" }} />
          </span>
          <span style={{ width: "calc(50 * var(--pt))", marginLeft: "auto" }} />
        </span>
      ))}
    </div>
  );
}
