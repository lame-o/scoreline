/**
 * Climbing's rows and the open competition (ClimbingSeasonPage.swift
 * `ClimbingEventRow`, `ClimbingEventDetail`), shared by the season page in
 * both modes and anything that lists competitions.
 */
import { memo, useState } from "react";
import { Icon, LiveDot } from "../../design/components";
import { dayKeyOf, dayRangeLabel, type DayKey } from "../../data/days";
import { capitalized } from "../../data/providers/ifsc";
import type { SeasonEvent } from "../../data/schedule";
import { capitalizedFirst, eventFlag, podiumEntry } from "../../data/seasons";
import { winners } from "../../data/seasonResults";
import { flagFromIOC } from "../../data/teams";
import { textWidth } from "../scores/measure";
import { useLit, type HoverStore } from "./hover";
import { Badge, LinkButton, partStyles, SubLabel } from "./parts";
import styles from "./rows.module.css";

export function useReducedMotion(): boolean {
  const [reduce] = useState(() => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  return reduce;
}

// MARK: - Rows

export interface ClimbingEventRowProps {
  readonly event: SeasonEvent;
  readonly open: boolean;
  /** Opens in place (a chevron) rather than beside the list. */
  readonly chevron: boolean;
  readonly hover: HoverStore;
  /** Points of room for the text column, to choose the longest winners line that fits. */
  readonly textRoom: number;
  readonly onSelect: (id: string, viaKeyboard?: boolean) => void;
  /** "This weekend", "In 5 months" (a sport's page). */
  readonly relative?: string | null;
}

function detailLine(e: SeasonEvent): string {
  if (e.status === "live") {
    const active = e.rounds.find((r) => r.status === "active");
    return `Live${active ? ` · ${active.discipline} ${active.name.toLowerCase()}` : ""}`;
  }
  if (e.status === "finished") return winners(e, 2) ?? "Finished";
  const parts = [e.lanes.map(capitalized).join(" · ")];
  const regs = Object.entries(e.registered)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, n]) => `${flagFromIOC(code) ?? code} ${n}`);
  if (regs.length > 0) parts.push(`${regs.join(" ")} registered`);
  if (e.place && !e.place.startsWith(e.shortName)) parts.unshift(e.place);
  return parts.filter(Boolean).join(" · ");
}

/** A competition: flag, name and badge, what it's about (or its winners), its dates. */
export const ClimbingEventRow = memo(function ClimbingEventRow({ event: e, open, chevron, hover, textRoom, onSelect, relative = null }: ClimbingEventRowProps) {
  const lit = useLit(hover, e.id);
  let line = detailLine(e);
  if (e.status === "finished") {
    // Every category's winner when they fit on the line, else the first two.
    const all = winners(e);
    if (all && textWidth(all, 11) <= textRoom) line = all;
  }
  const label = [e.shortName, e.badge, dayRangeLabel(e.startDay, e.endDay), relative, line.replace("🥇 ", "Winners: ")].filter(Boolean).join(", ");
  return (
    <button
      type="button"
      className={[partStyles.row, e.status === "canceled" ? styles.canceled : null].filter(Boolean).join(" ")}
      data-row-id={e.id}
      data-lit={lit}
      data-selected={!chevron && open}
      aria-expanded={chevron ? open : undefined}
      aria-current={!chevron && open ? "true" : undefined}
      aria-label={label}
      onClick={(ev) => onSelect(e.id, ev.detail === 0)}
      onPointerEnter={(ev) => ev.pointerType === "mouse" && hover.set(e.id)}
      onPointerLeave={() => hover.leave(e.id)}
    >
      <span className={styles.flag} aria-hidden="true">
        {eventFlag(e) ?? "🏳️"}
      </span>
      <span className={styles.text} aria-hidden="true">
        <span className={styles.titleLine}>
          <span className={styles.title}>
            {e.status === "live" ? <LiveDot /> : null}
            <span>{e.shortName}</span>
          </span>
          {e.badge ? <Badge>{e.badge}</Badge> : null}
        </span>
        <span className={[styles.detail, e.status === "live" ? styles.live : null].filter(Boolean).join(" ")}>{line}</span>
      </span>
      <span className={[styles.dates, e.status === "finished" ? styles.datesFinished : null].filter(Boolean).join(" ")} aria-hidden="true">
        {dayRangeLabel(e.startDay, e.endDay)}
        {relative ? <span className={[styles.relative, e.status === "live" ? styles.live : null].filter(Boolean).join(" ")}>{relative}</span> : null}
      </span>
      {chevron ? <Icon name="chevronRight" size={9} className={partStyles.rowChevron} /> : null}
    </button>
  );
});

// MARK: - The open competition

/** "Lead · Men, Women   Speed · Men, Women" */
function categoriesLine(e: SeasonEvent): string {
  const by = new Map<string, string[]>();
  for (const c of e.categories) {
    const [discipline = "", ...rest] = c.name.split(" ");
    const list = by.get(discipline) ?? [];
    if (rest[0]) list.push(rest[0]);
    by.set(discipline, list);
  }
  return [...by.keys()]
    .sort()
    .map((d) => `${d} · ${(by.get(d) ?? []).join(", ")}`)
    .join("   ");
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

/** An open competition: rounds by day (times in your zone when known), podiums, your countries, links. */
export function ClimbingEventDetail({ event: e, countries, showsHeader = false, inline = false, wide = false }: { event: SeasonEvent; countries: readonly string[]; showsHeader?: boolean; inline?: boolean; wide?: boolean }) {
  const podiums = e.categories.filter((c) => c.podium.length > 0);
  const timed = e.rounds.filter((r) => r.start.kind === "exact" || r.start.kind === "provisional");
  const untimed = e.rounds.filter((r) => r.start.kind === "tba" || r.start.kind === "tbc");
  const programmeless = e.status === "upcoming" && e.rounds.every((r) => r.status === "pending" && (r.start.kind === "tba" || r.start.kind === "tbc"));
  const regs = Object.entries(e.registered).sort(([, a], [, b]) => b - a);
  const days = new Map<string, { day: DayKey; rounds: typeof timed }>();
  for (const r of timed) {
    const date = r.start.kind === "exact" || r.start.kind === "provisional" ? r.start.date : 0;
    const d = dayKeyOf(date);
    const key = `${d.year}-${d.month}-${d.day}`;
    const g = days.get(key) ?? { day: d, rounds: [] };
    g.rounds.push(r);
    days.set(key, g);
  }
  return (
    <div className={[styles.openDetail, inline ? styles.inline : null].filter(Boolean).join(" ")}>
      {showsHeader ? (
        <div className={styles.detailHeader}>
          <h2 className={styles.detailTitle}>
            {eventFlag(e) ? <span className={styles.detailFlag} aria-hidden="true">{eventFlag(e)}</span> : null}
            <span>{e.shortName}</span>
            {e.badge ? <Badge>{e.badge}</Badge> : null}
          </h2>
          <p className={styles.meta}>{[e.place, dayRangeLabel(e.startDay, e.endDay), e.lanes.map(capitalized).join(" · ")].filter(Boolean).join(" · ")}</p>
        </div>
      ) : null}
      {!e.detailed ? (
        <p className={styles.note} role="status">
          Loading rounds…
        </p>
      ) : programmeless ? (
        <>
          <p className={styles.callout}>{categoriesLine(e)}</p>
          <p className={styles.note}>Programme not published yet. Rounds appear about a week before.</p>
        </>
      ) : (
        <>
          {[...days.values()].map((g) => (
            <div key={`${g.day.year}-${g.day.month}-${g.day.day}`}>
              <SubLabel className={styles.subLabelGap}>{new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(new Date(g.day.year, g.day.month - 1, g.day.day, 12))}</SubLabel>
              {g.rounds.map((r) => (
                <RoundLine key={`${r.discipline}|${r.name}`} round={r} wide={wide} zone={e.timeZone} place={e.shortName} />
              ))}
            </div>
          ))}
          {untimed.length > 0 ? (
            <div>
              {timed.length > 0 ? <SubLabel className={styles.subLabelGap}>Time TBA</SubLabel> : null}
              {untimed.map((r) => (
                <RoundLine key={`${r.discipline}|${r.name}`} round={r} wide={wide} zone={e.timeZone} place={e.shortName} />
              ))}
            </div>
          ) : null}
        </>
      )}
      {podiums.length > 0 ? (
        <div className={styles.podiums}>
          <SubLabel>Podiums</SubLabel>
          {podiums.map((c) => (
            <p key={c.name} className={styles.podiumLine}>
              <span>{c.name}</span>
              <span>{c.podium.map(podiumEntry).join(", ")}</span>
            </p>
          ))}
        </div>
      ) : null}
      {regs.length > 0 && countries.length > 0 ? (
        <p className={styles.note}>
          Your countries: {regs.map(([code, n]) => `${flagFromIOC(code) ?? code} ${n}`).join(" · ")} registered
        </p>
      ) : null}
      <div className={styles.links}>
        {e.link ? <LinkButton title="ifsc.results.info" href={e.link} /> : null}
        {e.infoSheet && e.status !== "finished" ? <LinkButton title="Info sheet" href={e.infoSheet} /> : null}
      </div>
    </div>
  );
}

function RoundLine({ round: r, wide, zone, place }: { round: SeasonEvent["rounds"][number]; wide: boolean; zone: string | null; place: string }) {
  const date = r.start.kind === "exact" || r.start.kind === "provisional" ? r.start.date : null;
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <p className={styles.roundLine}>
      {r.status === "active" ? <LiveDot /> : null}
      <span className={[styles.roundName, r.status === "finished" ? styles.roundDone : null].filter(Boolean).join(" ")}>{capitalizedFirst(`${r.discipline} ${r.name.toLowerCase()}`)}</span>
      {r.categories.length > 0 ? <span className={styles.roundCats}>{r.categories.join(", ")}</span> : null}
      {date != null ? (
        <span className={styles.roundWhen}>
          {timeFormat.format(date)}
          {wide && zone && zone !== local ? ` · ${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: zone }).format(date)} in ${place}` : ""}
        </span>
      ) : (
        <span className={styles.roundWhen}>{r.status === "finished" ? "Finished" : r.status === "active" ? "Underway" : "Time TBA"}</span>
      )}
    </p>
  );
}
