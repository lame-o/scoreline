/**
 * The agenda's small parts (ScheduleRows.swift, SchedulePage.swift): day
 * headings (plain, or folding like the scores list's sections with a line of
 * crests), a league's label inside a day, notes ("Bye: …", "Time TBA"),
 * the quiet link to Results, Show More, the skeleton and the footer.
 */
import { memo, type CSSProperties, type MouseEvent, type ReactNode, type Ref } from "react";
import { Link } from "react-router";
import { Icon, SPORT_ICON, Skeleton } from "../../design/components";
import { compareDays, dayID, longDayLabel, mediumDayLabel, relativeDay, type DayKey } from "../../data/days";
import { dayItems, type AgendaDay } from "../../data/agenda";
import { leagueWithID } from "../../data/leagues";
import { competitors, type Competitor } from "../../data/models";
import { itemEvent, schedulePath, scopeFor, type ScheduleMode } from "../../data/schedule";
import { updatedAgo } from "../../data/format";
import { useNow } from "../../state/clock";
import { TravelingLogo, travelID } from "../scores/sections";
import styles from "./Agenda.module.css";

/** "Today  Monday, Oct 26", or just the date further out. */
export function DayTitle({ day, today }: { day: DayKey; today: DayKey }) {
  const relative = relativeDay(day, today);
  return relative ? (
    <span className={styles.dayTitle}>
      <span className={styles.relative} data-today={compareDays(day, today) === 0}>
        {relative}
      </span>
      <span className={styles.dayDate}>{longDayLabel(day)}</span>
    </span>
  ) : (
    <span className={styles.dayTitle}>
      <span className={styles.relative}>{longDayLabel(day)}</span>
    </span>
  );
}

/** A day's heading in an agenda that doesn't fold (a team's). */
export const DayHeader = memo(function DayHeader({ day, today, anchorRef }: { day: DayKey; today: DayKey; anchorRef?: Ref<HTMLHeadingElement> }) {
  return (
    <h2 className={styles.dayHeader} data-day={dayID(day)} ref={anchorRef}>
      <DayTitle day={day} today={today} />
    </h2>
  );
});

/** The section a day's crests travel within: "day-2026-10-26". */
export const daySection = (day: DayKey) => `day-${dayID(day)}`;

/** The first crests of a day, by team, in row order. */
export function dayCrests(day: AgendaDay): Competitor[] {
  const seen = new Set<string>();
  return dayItems(day)
    .flatMap((i) => competitors(itemEvent(i)))
    .filter((c) => c.logo != null && !seen.has(c.id ?? c.name) && seen.add(c.id ?? c.name));
}

/** For each row, the crests it takes from the folded preview (first appearances only). */
export function handOffs(day: AgendaDay, limit: number): Map<string, Set<string>> {
  const seen = new Set<string>();
  const out = new Map<string, Set<string>>();
  for (const item of dayItems(day)) {
    for (const c of competitors(itemEvent(item))) {
      if (!c.logo) continue;
      if (seen.size >= limit) return out;
      const id = travelID(daySection(day.day), c);
      if (seen.has(id)) continue;
      seen.add(id);
      out.set(item.id, (out.get(item.id) ?? new Set()).add(id));
    }
  }
  return out;
}

export interface FoldingDayHeaderProps {
  readonly day: AgendaDay;
  readonly today: DayKey;
  readonly open: boolean;
  /** "14 games" */
  readonly count: string;
  /** "NFL, NBA, EPL" on the calendar; null on a league's own page. */
  readonly leagues: string | null;
  /** The crests link while this day toggles by click. */
  readonly linking: boolean;
  /** Just folded: the summary waits for the crests to land. */
  readonly revealSummary: boolean;
  /** A click (not a key) is toggling: the chevron eases. */
  readonly animated: boolean;
  readonly maxLogos: number;
  readonly onToggle: (day: string, viaKeyboard: boolean) => void;
}

/**
 * A day that folds, the scores list's section header in the agenda: the
 * whole header toggles. Folded, the count joins the title and a line of the
 * day's crests and leagues stands in for its rows.
 */
export const FoldingDayHeader = memo(function FoldingDayHeader({ day, today, open, count, leagues, linking, revealSummary, animated, maxLogos, onToggle }: FoldingDayHeaderProps) {
  const id = dayID(day.day);
  const crests = open ? [] : dayCrests(day);
  const relative = relativeDay(day.day, today);
  return (
    <h2 className={styles.foldHeading} data-day={id}>
      <button
        type="button"
        className={styles.fold}
        aria-expanded={open}
        aria-controls={`day-rows-${id}`}
        data-instant={!animated}
        title={open ? `Hide ${mediumDayLabel(day.day)}` : `Show ${mediumDayLabel(day.day)}`}
        onClick={(e: MouseEvent) => onToggle(id, e.detail === 0)}
      >
        <span className={styles.foldRow}>
          <DayTitle day={day.day} today={today} />
          <span className={styles.flex} />
          {open ? null : <span className={styles.count}>{count}</span>}
          <Icon name="chevronRight" size={9} className={styles.chevron} />
        </span>
        {open ? null : (
          <span className={styles.preview} aria-hidden="true">
            {crests.length ? (
              <span className={styles.crests}>
                {crests.slice(0, maxLogos).map((c) => (
                  <TravelingLogo key={c.id ?? c.name} team={c} size={14} travelID={linking ? travelID(daySection(day.day), c) : null} />
                ))}
              </span>
            ) : null}
            {leagues ? <span className={[styles.previewSummary, revealSummary ? styles.revealLate : null].filter(Boolean).join(" ")}>{leagues}</span> : null}
          </span>
        )}
        <span className="visually-hidden">
          {relative ? `, ${relative}` : ""}, {[count, leagues].filter(Boolean).join(", ")}
        </span>
      </button>
    </h2>
  );
});

/** A league's label inside a day (All scope): it opens the league's own schedule, facing the same way. */
export function GroupLabel({ league, title, mode, style, className }: { league: string; title: string; mode: ScheduleMode; style?: CSSProperties; className?: string }) {
  const l = leagueWithID(league);
  const icon = l ? SPORT_ICON[l.sport] : "calendar";
  const label = (
    <>
      <span className={styles.groupIcon}>
        <Icon name={icon} size={9.5} />
      </span>
      <span>{title}</span>
    </>
  );
  if (!l) {
    return (
      <h3 className={[styles.groupLabel, className].filter(Boolean).join(" ")} style={style}>
        {label}
      </h3>
    );
  }
  return (
    <h3 className={[styles.groupHeading, className].filter(Boolean).join(" ")} style={style}>
      <Link to={schedulePath(scopeFor(l), mode)} className={styles.groupLabel} title={`${title} schedule`}>
        {label}
        <Icon name="chevronRight" size={7.5} className={styles.groupChevron} />
      </Link>
    </h3>
  );
}

/** A small line in the agenda's voice (byes, "Time TBA", footnotes). */
export function Note({ children, style, className }: { children: ReactNode; style?: CSSProperties; className?: string }) {
  return (
    <p className={[styles.note, className].filter(Boolean).join(" ")} style={style}>
      {children}
    </p>
  );
}

/** Upcoming's one line to Results: quiet text, a chevron, brighter under the pointer. Switches the mode in place. */
export function ResultsLink({ title, onClick }: { title: string; onClick: (viaKeyboard: boolean) => void }) {
  return (
    <button type="button" className={styles.resultsLink} title="Results (⌥2)" aria-label={`${title}. Show results`} onClick={(e) => onClick(e.detail === 0)}>
      <span className={styles.resultsLinkText}>{title}</span>
      <Icon name="chevronRight" size={8.5} />
    </button>
  );
}

/** "Show 40 More", "Show Next 7 Game Days". */
export function MoreButton({ children, onClick, disabled = false }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className={styles.more} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

/** "Next: Sat, Oct 31 in 5 days ›" */
export function JumpLink({ children, onClick }: { children: ReactNode; onClick: (viaKeyboard: boolean) => void }) {
  return (
    <button type="button" className={styles.jump} onClick={(e) => onClick(e.detail === 0)}>
      {children}
      <Icon name="chevronRight" size={8.5} />
    </button>
  );
}

/** Placeholder rows shaped like the agenda's, so a first load doesn't jump. Static. */
export function AgendaSkeleton({ days = 2, rows = 3 }: { days?: number; rows?: number }) {
  return (
    <div className={styles.skeleton} aria-label="Loading schedule" role="status">
      {Array.from({ length: days }, (_, d) => (
        <div key={d}>
          <Skeleton width={120} height={9} className={styles.skeletonDay} />
          {Array.from({ length: rows }, (_, r) => (
            <div key={r} className={styles.skeletonRow}>
              <div className={styles.skeletonTeams}>
                {[0, 1].map((i) => (
                  <span key={i} className={styles.skeletonLine}>
                    <Skeleton width={14} height={14} circle />
                    <Skeleton width={110} height={9} />
                  </span>
                ))}
              </div>
              <div className={styles.skeletonStatus}>
                <Skeleton width={48} height={9} />
                <Skeleton width={32} height={7} />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

const zone = (() => {
  try {
    return new Intl.DateTimeFormat(undefined, { timeZoneName: "short" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
})();

/**
 * "Updated 5 minutes ago · Times in PDT", or that the data is saved, not
 * fresh. Re-read every 30 seconds; the action (Today, Latest) trails.
 */
export function AgendaFooter({ updated, loading, stale, noun = "schedule", action }: { updated: number | null; loading: boolean; stale: boolean; noun?: string; action?: { label: string; title: string; onClick: (viaKeyboard: boolean) => void } }) {
  const now = useNow(30_000);
  let text: string;
  if (updated == null) text = loading ? "Updating…" : `Times in ${zone}`;
  else if (stale) text = `Can't connect · Showing ${noun} from ${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(updated)}`;
  else if (loading) text = "Updating…";
  else text = `${updatedAgo(updated, now)} · Times in ${zone}`;
  return (
    <footer className={styles.footer}>
      <span className={styles.updated}>
        {stale && updated != null ? <Icon name="wifiSlash" size={10} /> : null}
        {text}
      </span>
      <span className={styles.flex} />
      {action ? (
        <button type="button" className={styles.footerAction} title={action.title} onClick={(e) => action.onClick(e.detail === 0)}>
          {action.label}
        </button>
      ) : null}
    </footer>
  );
}
