/**
 * The List view: sections in the user's league order, My Teams first, each
 * collapsible (ScoresView.swift `list`, `sectionView`). As the list widens
 * (data/listLayout.ts, ListLayout.swift): rows show records from medium and
 * a detail lane from large; from 680pt the rows sit two up, compact, each
 * cell taking its visual row's height. Crossing the split the rows fade
 * through rather than glide (they'd pass over each other).
 */
import { useQueries } from "@tanstack/react-query";
import { LayoutGroup, m } from "motion/react";
import { useEffect, useMemo, useRef } from "react";
import { Link } from "react-router";
import { Icon, SPORT_ICON } from "../../design/components";
import { spring } from "../../design/motion";
import { gridRevealDelay, rowDetailOf, rowWidth, type PanelLayout, type RowDetail } from "../../data/listLayout";
import { espnPath } from "../../data/leagues";
import type { League } from "../../data/models";
import { schedulePath, scopeFor } from "../../data/schedule";
import type { Section } from "../../data/scoreboard";
import { ErrorCopy } from "../../design/components";
import { EventRow } from "./EventRow";
import { firstAppearances, SectionHeader, useSectionToggle } from "./sections";
import { SectionMenu } from "./SectionMenu";
import styles from "./ScoresList.module.css";

export interface ScoresListProps {
  readonly sections: readonly Section[];
  readonly collapsed: readonly string[];
  readonly quietLeagues: readonly League[];
  readonly hasFollowed: boolean;
  readonly highlight: { readonly id: string | null; readonly keyboard: boolean };
  readonly selectedID: string | null;
  /** One column or two, and each block's width class (PanelLayout). */
  readonly layout: PanelLayout;
  readonly stale: boolean;
  readonly onHover: (id: string) => void;
}

const PREVIEW_LOGOS = 7;

export function ScoresList({ sections, collapsed, quietLeagues, hasFollowed, highlight, selectedID, layout, stale, onHover }: ScoresListProps) {
  const { toggling, toggle, rearrange } = useSectionToggle();
  const detail = rowDetailOf(rowWidth(layout));
  // Crossing the split (one column ⇄ two): the rows fade in at their new places, this render only.
  const shownColumns = useRef(layout.columns);
  const reflow = shownColumns.current !== layout.columns;
  useEffect(() => {
    shownColumns.current = layout.columns;
  });
  return (
    <div className={styles.list}>
      <LayoutGroup>
        {sections.map((section) => {
          const isCollapsed = collapsed.includes(section.id);
          const linking = toggling.id === section.id;
          return (
            <m.section
              key={section.id}
              className={styles.section}
              layout={toggling.animating ? "position" : false}
              transition={spring.standard}
              aria-label={section.title}
            >
              <SectionHeader
                id={section.id}
                title={section.title}
                icon={section.sport ? SPORT_ICON[section.sport] : "star"}
                events={section.events}
                collapsed={isCollapsed}
                toggling={toggling}
                onToggle={toggle}
                maxLogos={PREVIEW_LOGOS}
                controls={`rows-${section.id}`}
                menu={<SectionMenu id={section.id} title={section.title} onToggle={() => toggle(section.id, false)} onRearrange={rearrange} />}
              />
              {isCollapsed ? null : (
                <SectionRows
                  section={section}
                  linking={linking}
                  highlight={highlight}
                  selectedID={selectedID}
                  detail={detail}
                  columns={layout.columns}
                  reflow={reflow}
                  stale={stale}
                  onHover={onHover}
                />
              )}
            </m.section>
          );
        })}
        <m.div layout={toggling.animating ? "position" : false} transition={spring.standard}>
          <Footnotes quiet={quietLeagues} hasFollowed={hasFollowed} />
        </m.div>
      </LayoutGroup>
    </div>
  );
}

function SectionRows({
  section,
  linking,
  highlight,
  selectedID,
  detail,
  columns,
  reflow,
  stale,
  onHover,
}: {
  section: Section;
  linking: boolean;
  highlight: ScoresListProps["highlight"];
  selectedID: string | null;
  detail: RowDetail;
  columns: 1 | 2;
  reflow: boolean;
  stale: boolean;
  onHover: (id: string) => void;
}) {
  // Crests that travel from the preview, only while this section toggles (each link costs a measurement).
  const travel = useMemo(() => {
    if (!linking) return null;
    const map = firstAppearances(section.id, section.events, PREVIEW_LOGOS);
    return new Map([...map].map(([id, ids]) => [id, { section: section.id, ids }]));
  }, [linking, section]);
  return (
    // Keyed by the column count: crossing the split, the rows fade in at their new places (ScoresView.reflow).
    <div key={columns} className={styles.rows} id={`rows-${section.id}`} data-detail={detail} data-columns={columns} data-reflow={reflow || undefined}>
      {section.failed ? <p className={styles.error} style={{ gridColumn: "1 / -1" }}>{ErrorCopy.inline(section.title)}</p> : null}
      {section.events.map((event, index) => (
          <EventRow
            key={event.id}
            event={event}
            keyboard={highlight.keyboard && highlight.id === event.id}
            selected={selectedID === event.id}
            detail={detail}
            stale={stale}
            revealDelay={linking ? gridRevealDelay(index, columns) : null}
            travel={travel?.get(event.id) ?? null}
            onHover={onHover}
          />
      ))}
    </div>
  );
}

/**
 * Under the list: which leagues are quiet (and over what period: daily
 * leagues today and tomorrow, weekly ones this week); a quiet league whose
 * calendar knows its next game day links to its schedule ("Premier League:
 * next Sat, Nov 1"); and until a team is followed, how to follow one.
 */
export function Footnotes({ quiet, hasFollowed }: { quiet: readonly League[]; hasFollowed: boolean }) {
  const next = useNextGameDays(quiet);
  const known = quiet.filter((l) => next.has(l.id));
  const rest = quiet.filter((l) => !next.has(l.id));
  const weekly = rest.filter((l) => l.source.kind === "espn" && l.source.weekly);
  const daily = rest.filter((l) => !weekly.includes(l) && (espnPath(l) != null || l.source.kind !== "espn"));
  if (known.length === 0 && weekly.length === 0 && daily.length === 0 && hasFollowed) return null;
  return (
    <div className={styles.footnotes}>
      {known.map((l) => (
        <p key={l.id}>
          <Link className={styles.footnoteLink} to={schedulePath(scopeFor(l))} state={{ from: "Scores" }} title={`${l.name} schedule`}>
            {l.name}: next {next.get(l.id)}
          </Link>
        </p>
      ))}
      {daily.length > 0 ? <p>No games today or tomorrow: {daily.map((l) => l.name).join(", ")}</p> : null}
      {weekly.length > 0 ? <p>No games this week: {weekly.map((l) => l.name).join(", ")}</p> : null}
      {hasFollowed ? null : (
        <p className={styles.hint}>
          <Icon name="starOutline" size={10} />
          {/* Teaches the one hidden gesture until it's been used (the Mac's hint, in the web's words). */}
          <span>
            <span className={styles.pointerOnly}>Right-click</span>
            <span className={styles.touchOnly}>Touch and hold</span> a game to follow a team or show its score in the tab.
          </span>
        </p>
      )}
    </div>
  );
}

const CALENDAR_HOURS = 12 * 3_600_000;

/**
 * Quiet ESPN leagues' next game day ("Sat, Nov 1"), from their season
 * calendars (the schedule pages' cache; ScheduleStore.loadCalendars). The
 * schedule code loads on demand, only when a league is quiet.
 */
function useNextGameDays(quiet: readonly League[]): ReadonlyMap<string, string> {
  const today = new Date().toDateString();
  const leagues = quiet.filter((l) => l.source.kind === "espn" && espnPath(l) != null);
  const queries = useQueries({
    queries: leagues.map((league) => ({
      queryKey: ["footnote", league.id, today],
      queryFn: async () => {
        const [{ fetchCalendar }, { nextDayAfterWindow }, { mediumDayLabel }] = await Promise.all([import("../../state/schedule"), import("../../data/providers/schedule"), import("../../data/days")]);
        const calendar = await fetchCalendar(espnPath(league)!);
        const day = nextDayAfterWindow(calendar, league.source.kind === "espn" && league.source.weekly, Date.now());
        return day ? mediumDayLabel(day) : null;
      },
      staleTime: CALENDAR_HOURS,
      gcTime: CALENDAR_HOURS,
      retry: 1,
    })),
  });
  const version = queries.map((q) => q.dataUpdatedAt).join();
  return useMemo(() => {
    const map = new Map<string, string>();
    leagues.forEach((l, i) => {
      const day = queries[i]?.data;
      if (day) map.set(l.id, day);
    });
    return map;
    // `version` stands for the queries' data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, leagues.map((l) => l.id).join()]);
}
