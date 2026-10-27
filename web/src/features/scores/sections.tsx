/**
 * What list sections and tile tiers share: the collapse choreography, the
 * collapsible header and its one-line preview (ScoresView.swift
 * `SectionHeader`, `CollapsedPreview`).
 *
 * Collapsing or expanding with a click: the sections below glide to their
 * new places (a layout spring), the crests travel between the preview and
 * the rows (shared layout), and the rows' text rises in, staggered. A
 * keyboard toggle, or one faster than the choreography can play, is instant.
 */
import { m } from "motion/react";
import { useCallback, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Icon, LiveDot, TeamLogo, type IconName } from "../../design/components";
import { spring } from "../../design/motion";
import { countdown, dayAndTime, plural } from "../../data/format";
import { competitors, type Competitor, type ScoreEvent } from "../../data/models";
import { useNow } from "../../state/clock";
import { settings } from "../../state/settings";
import styles from "./ScoresList.module.css";

/** Toggles faster than this skip the show (ScoresView.toggle). */
const RAPID_MS = 450;
/** How long a toggle's links (crest travel, stagger) last. */
const CHOREOGRAPHY_MS = 800;

export interface Toggling {
  /** The section or tier being toggled with the full choreography, or null. */
  readonly id: string | null;
  /** True while any toggle animates (sections glide to their new places). */
  readonly animating: boolean;
}

export function useSectionToggle() {
  const [toggling, setToggling] = useState<Toggling>({ id: null, animating: false });
  const last = useRef(0);
  const generation = useRef(0);

  const toggle = useCallback((id: string, viaKeyboard: boolean) => {
    const now = performance.now();
    const rapid = now - last.current < RAPID_MS;
    last.current = now;
    const mine = ++generation.current;
    if (viaKeyboard || rapid) {
      setToggling({ id: null, animating: false });
      settings.toggleCollapsed(id);
      return;
    }
    // Link the crests and turn layout tracking on first, so this frame records
    // where everything starts; toggle on the next frame (ScoresView.toggle).
    setToggling({ id, animating: true });
    requestAnimationFrame(() => {
      if (generation.current !== mine) {
        // Overtaken by a faster click before it began: still count it, just without the show.
        settings.toggleCollapsed(id);
        return;
      }
      settings.toggleCollapsed(id);
      window.setTimeout(() => {
        if (generation.current === mine) setToggling({ id: null, animating: false });
      }, CHOREOGRAPHY_MS);
    });
  }, []);

  return { toggling, toggle };
}

/** A crest that travels between a collapsed preview and its row while its section toggles. */
export function TravelingLogo({ team, size, travelID }: { team: Competitor; size: number; travelID: string | null }) {
  if (!travelID) return <TeamLogo url={team.logo} size={size} />;
  return (
    <m.span layoutId={travelID} layout="position" transition={spring.travel} style={{ display: "inline-flex" }}>
      <TeamLogo url={team.logo} size={size} />
    </m.span>
  );
}

/** "eng.1|espn-soccer-364": a crest's identity within a section. */
export const travelID = (section: string, c: Competitor) => `${section}|${c.id ?? c.name}`;

/** For each event, the crests appearing for the first time in the section, among those the preview shows. */
export function firstAppearances(sectionID: string, events: readonly ScoreEvent[], limit: number): Map<string, Set<string>> {
  const seen = new Set<string>();
  const result = new Map<string, Set<string>>();
  for (const e of events) {
    for (const c of competitors(e)) {
      if (!c.logo) continue;
      if (seen.size >= limit) return result;
      const id = travelID(sectionID, c);
      if (seen.has(id)) continue;
      seen.add(id);
      result.set(e.id, (result.get(e.id) ?? new Set()).add(id));
    }
  }
  return result;
}

export interface SectionHeaderProps {
  readonly id: string;
  readonly title: string;
  readonly icon: IconName;
  readonly events: readonly ScoreEvent[];
  readonly collapsed: boolean;
  readonly toggling: Toggling;
  readonly onToggle: (id: string, viaKeyboard: boolean) => void;
  /** Crests the preview shows before "N more". */
  readonly maxLogos?: number;
  readonly accessory?: ReactNode;
  readonly controls?: string;
}

/**
 * A section's (or tier's) header: the small caps label with its glyph and
 * a chevron. Collapsed, a preview hints at what's inside.
 */
export function SectionHeader({ id, title, icon, events, collapsed, toggling, onToggle, maxLogos = 7, accessory, controls }: SectionHeaderProps) {
  const linking = toggling.id === id;
  const onClick = (event: MouseEvent) => onToggle(id, event.detail === 0);
  return (
    <h2 className={styles.heading}>
      <button
        type="button"
        className={styles.header}
        aria-expanded={!collapsed}
        aria-controls={controls}
        data-instant={!toggling.animating}
        onClick={onClick}
        title={collapsed ? `Show ${title}` : `Hide ${title}`}
      >
        <span className={styles.headerRow}>
          <span className={styles.groupLabel}>
            <span className={styles.groupIcon}>
              <Icon name={icon} size={9.5} />
            </span>
            {title}
          </span>
          {accessory}
          <Icon name="chevronRight" size={9} className={styles.chevron} />
        </span>
        {collapsed && events.length > 0 ? (
          <>
            <CollapsedPreview sectionID={id} events={events} maxLogos={maxLogos} linking={linking} revealSummary={linking} />
            <span className="visually-hidden">, {spokenPreview(events, Date.now())}</span>
          </>
        ) : null}
      </button>
    </h2>
  );
}

/** One line under a collapsed header: the teams inside, then what's happening (live, or when the next game starts). */
export function CollapsedPreview({
  sectionID,
  events,
  maxLogos,
  linking,
  revealSummary,
}: {
  sectionID: string;
  events: readonly ScoreEvent[];
  maxLogos: number;
  linking: boolean;
  revealSummary: boolean;
}) {
  const seen = new Set<string>();
  const teams = events.flatMap(competitors).filter((c) => c.logo && !seen.has(c.id ?? c.name) && seen.add(c.id ?? c.name));
  const field = events[0]?.content.kind === "field";
  return (
    <span className={styles.preview} aria-hidden="true">
      {teams.length > 0 ? (
        <span className={styles.crests}>
          {teams.slice(0, maxLogos).map((team) => (
            <TravelingLogo key={team.id ?? team.name} team={team} size={14} travelID={linking ? travelID(sectionID, team) : null} />
          ))}
          {teams.length > maxLogos ? <span className={styles.more}>{teams.length - maxLogos} more</span> : null}
        </span>
      ) : field ? (
        <span className={styles.categories}>{plural(events.length, "category", "categories")}</span>
      ) : null}
      <PreviewSummary events={events} className={revealSummary ? styles.revealSummary : undefined} />
    </span>
  );
}

function PreviewSummary({ events, className }: { events: readonly ScoreEvent[]; className?: string }) {
  const now = useNow(30_000);
  const live = events.filter((e) => e.state === "live").length;
  return (
    <span className={[styles.previewSummary, className].filter(Boolean).join(" ")}>
      {live > 0 ? (
        <>
          <LiveDot />
          <span className={styles.previewLive}>{live} Live</span>
        </>
      ) : (
        previewStatus(events, now)
      )}
    </span>
  );
}

/** "Starts in 2h 9m", "Tomorrow 7:00 AM", or "3 results" (CollapsedPreview.status). */
export function previewStatus(events: readonly ScoreEvent[], now: number): string {
  const next = events.filter((e) => e.state === "scheduled" && e.start > now).sort((a, b) => a.start - b.start)[0];
  if (next) {
    if (next.start - now < 3 * 3_600_000) {
      const c = countdown(next.start, now);
      if (c) return c === "Starting" ? "Starting" : `Starts ${c}`;
    }
    return dayAndTime(next.start, now);
  }
  if (events.some((e) => e.state === "scheduled")) return events[0]?.content.kind === "field" ? "Time TBA" : "Starting soon";
  return plural(events.filter((e) => e.state === "final").length, "result");
}

/** What a collapsed section holds, in words. */
export function spokenPreview(events: readonly ScoreEvent[], now: number): string {
  const live = events.filter((e) => e.state === "live").length;
  if (live > 0) return `${plural(live, "game")} in progress`;
  const next = events.filter((e) => e.state === "scheduled" && e.start > now).sort((a, b) => a.start - b.start)[0];
  if (next) return `Next starts ${dayAndTime(next.start, now)}`;
  if (events.some((e) => e.state === "scheduled")) return events[0]?.content.kind === "field" ? "Time to be announced" : "Starting soon";
  return plural(events.filter((e) => e.state === "final").length, "result");
}
