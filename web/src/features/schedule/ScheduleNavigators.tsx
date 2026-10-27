/**
 * The schedule's sticky date (ScheduleNavigators.swift): a week strip
 * (days), a period picker (NFL and college weeks; Results' rounds) or a month
 * bar (teams), pinned in the header under Upcoming | Results. It follows the
 * scroll (the day at the top of the agenda is selected) and jumps when
 * clicked. Keyboard moves never animate.
 */
import { memo } from "react";
import { Icon, Menu, type MenuEntry } from "../../design/components";
import { compareDays, dayID, longDayLabel, monthLabel, monthYearLabel, weekdayLabel, type DayKey } from "../../data/days";
import type { StripDot } from "../../data/agenda";
import styles from "./ScheduleNavigators.module.css";

// MARK: - Week strip

export interface WeekStripProps {
  readonly days: readonly DayKey[];
  readonly today: DayKey;
  /** The day at the top of the agenda (or the round's day). */
  readonly selected: DayKey | null;
  readonly dots: ReadonlyMap<string, StripDot>;
  readonly onSelect: (day: DayKey, viaKeyboard: boolean) => void;
  readonly onPrevious: (viaKeyboard: boolean) => void;
  readonly onNext: (viaKeyboard: boolean) => void;
  /** Days that can be picked (Results: days with a result). */
  readonly enabled?: (day: DayKey) => boolean;
}

/** "OCTOBER 2026  ‹ ›" over seven days, each with its weekday, number and dot. */
export const WeekStrip = memo(function WeekStrip({ days, today, selected, dots, onSelect, onPrevious, onNext, enabled }: WeekStripProps) {
  const first = days[0];
  const last = days[days.length - 1];
  const label =
    first && last
      ? first.month === last.month
        ? monthYearLabel(last.year, last.month)
        : `${monthLabel(first.month, "short", first.year)} – ${monthLabel(last.month, "short", last.year)} ${last.year}`
      : "";
  return (
    <div className={styles.strip} role="group" aria-label="Week">
      <div className={styles.stripHeader}>
        <span className={styles.month}>{label}</span>
        <span className={styles.flex} />
        <Arrow direction="left" label="Previous week" onClick={onPrevious} />
        <Arrow direction="right" label="Next week" onClick={onNext} />
      </div>
      <div className={styles.days}>
        {days.map((day) => {
          const key = dayID(day);
          const dot = dots.get(key);
          const isToday = compareDays(day, today) === 0;
          const can = enabled ? enabled(day) : true;
          return (
            <button
              key={key}
              type="button"
              className={styles.day}
              data-selected={selected != null && compareDays(selected, day) === 0}
              data-today={isToday}
              data-past={compareDays(day, today) < 0}
              disabled={!can}
              aria-pressed={selected != null && compareDays(selected, day) === 0}
              aria-label={`${longDayLabel(day)}${dot ? "" : ", no games"}`}
              title={longDayLabel(day)}
              onClick={(e) => onSelect(day, e.detail === 0)}
            >
              <span className={styles.weekday} aria-hidden="true">
                {weekdayLabel(day, "narrow")}
              </span>
              <span className={styles.number} aria-hidden="true">
                {day.day}
              </span>
              <span className={styles.dot} data-dot={dot ?? "none"} aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </div>
  );
});

function Arrow({ direction, label, onClick, disabled = false }: { direction: "left" | "right"; label: string; onClick: (viaKeyboard: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" className={styles.arrow} aria-label={label} title={label} disabled={disabled} onClick={(e) => onClick(e.detail === 0)}>
      <Icon name={direction === "left" ? "chevronLeft" : "chevronRight"} size={10} />
    </button>
  );
}

// MARK: - Period picker (weeks, rounds)

export interface PeriodOption {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
}

export interface PeriodPickerProps {
  readonly title: string;
  readonly detail: string | null;
  /** Menu sections, in order, each with its options in order. */
  readonly sections: readonly { readonly title: string; readonly options: readonly PeriodOption[] }[];
  readonly selected: string | null;
  readonly previousEnabled: boolean;
  readonly nextEnabled: boolean;
  /** "week", "round": the arrows' labels and spoken names. */
  readonly noun: string;
  readonly onSelect: (id: string, viaKeyboard: boolean) => void;
  readonly onPrevious: (viaKeyboard: boolean) => void;
  readonly onNext: (viaKeyboard: boolean) => void;
}

/**
 * "‹  Week 8  Oct 28 – Nov 3 ⌄  ›": a period of the season, the ones on
 * either side, and a sectioned menu of all of them. A long round drops its
 * dates before its name truncates.
 */
export function PeriodPicker({ title, detail, sections, selected, previousEnabled, nextEnabled, noun, onSelect, onPrevious, onNext }: PeriodPickerProps) {
  const entries: MenuEntry[] = sections.map((section) => ({
    kind: "section",
    title: section.title || undefined,
    items: section.options.map((o) => ({
      kind: "item" as const,
      label: o.title,
      detail: o.detail && o.detail !== o.title ? o.detail.replaceAll("-", "–") : undefined,
      checked: o.id === selected,
      onSelect: () => onSelect(o.id, false),
    })),
  }));
  const shownDetail = detail && detail !== title ? detail.replace(/(\S)-(\S)/g, "$1 – $2") : null;
  return (
    <div className={styles.period}>
      <Arrow direction="left" label={`Previous ${noun}`} onClick={onPrevious} disabled={!previousEnabled} />
      <Menu
        label={`Choose a ${noun}`}
        align="center"
        className={styles.periodMenu}
        triggerClassName={styles.periodTrigger}
        trigger={
          <>
            <span className={styles.periodTitle}>{title}</span>
            {shownDetail ? <span className={styles.periodDetail}>{shownDetail}</span> : null}
            <Icon name="chevronDown" size={8} className={styles.periodChevron} />
          </>
        }
        entries={entries}
      />
      <Arrow direction="right" label={`Next ${noun}`} onClick={onNext} disabled={!nextEnabled} />
    </div>
  );
}

// MARK: - Month bar (teams)

/** "‹  October 2026  ›" with the team's summary under it ("Chiefs · 5–0 · 1st in AFC West"). */
export function MonthBar({ month, summary, onPrevious, onNext }: { month: DayKey | null; summary: string | null; onPrevious: (viaKeyboard: boolean) => void; onNext: (viaKeyboard: boolean) => void }) {
  return (
    <div className={styles.monthBar}>
      <div className={styles.period}>
        <Arrow direction="left" label="Previous month" onClick={onPrevious} />
        <span className={styles.monthTitle} aria-live="polite">
          {month ? monthYearLabel(month.year, month.month) : " "}
        </span>
        <Arrow direction="right" label="Next month" onClick={onNext} />
      </div>
      {summary ? <p className={styles.summary}>{summary}</p> : null}
    </div>
  );
}
