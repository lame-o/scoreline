/**
 * The List view: sections in the user's league order, My Teams first, each
 * collapsible (ScoresView.swift `list`, `sectionView`). Rows show records
 * from the Mac's medium width.
 */
import { LayoutGroup, m } from "motion/react";
import { useMemo } from "react";
import { Icon, SPORT_ICON } from "../../design/components";
import { revealDelay, spring } from "../../design/motion";
import { espnPath } from "../../data/leagues";
import type { League } from "../../data/models";
import type { Section } from "../../data/scoreboard";
import { ErrorCopy } from "../../design/components";
import { EventRow } from "./EventRow";
import { firstAppearances, SectionHeader, useSectionToggle } from "./sections";
import styles from "./ScoresList.module.css";

export interface ScoresListProps {
  readonly sections: readonly Section[];
  readonly collapsed: readonly string[];
  readonly quietLeagues: readonly League[];
  readonly hasFollowed: boolean;
  readonly highlight: { readonly id: string | null; readonly keyboard: boolean };
  readonly selectedID: string | null;
  readonly records: boolean;
  readonly stale: boolean;
  readonly onHover: (id: string) => void;
}

const PREVIEW_LOGOS = 7;

export function ScoresList({ sections, collapsed, quietLeagues, hasFollowed, highlight, selectedID, records, stale, onHover }: ScoresListProps) {
  const { toggling, toggle } = useSectionToggle();
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
              />
              {isCollapsed ? null : (
                <SectionRows
                  section={section}
                  linking={linking}
                  highlight={highlight}
                  selectedID={selectedID}
                  records={records}
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
  records,
  stale,
  onHover,
}: {
  section: Section;
  linking: boolean;
  highlight: ScoresListProps["highlight"];
  selectedID: string | null;
  records: boolean;
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
    <div className={styles.rows} id={`rows-${section.id}`}>
      {section.failed ? <p className={styles.error} style={{ gridColumn: "1 / -1" }}>{ErrorCopy.inline(section.title)}</p> : null}
      {section.events.map((event, index) => (
          <EventRow
            key={event.id}
            event={event}
            keyboard={highlight.keyboard && highlight.id === event.id}
            selected={selectedID === event.id}
            records={records}
            stale={stale}
            revealDelay={linking ? revealDelay(index) : null}
            travel={travel?.get(event.id) ?? null}
            onHover={onHover}
          />
      ))}
    </div>
  );
}

/**
 * Under the list: which leagues are quiet (and over what period: daily
 * leagues today and tomorrow, weekly ones this week), and until a team is
 * followed, how to follow one.
 */
export function Footnotes({ quiet, hasFollowed }: { quiet: readonly League[]; hasFollowed: boolean }) {
  const weekly = quiet.filter((l) => l.source.kind === "espn" && l.source.weekly);
  const daily = quiet.filter((l) => !weekly.includes(l) && (espnPath(l) != null || l.source.kind !== "espn"));
  if (weekly.length === 0 && daily.length === 0 && hasFollowed) return null;
  return (
    <div className={styles.footnotes}>
      {daily.length > 0 ? <p>No games today or tomorrow: {daily.map((l) => l.name).join(", ")}</p> : null}
      {weekly.length > 0 ? <p>No games this week: {weekly.map((l) => l.name).join(", ")}</p> : null}
      {hasFollowed ? null : (
        <p className={styles.hint}>
          <Icon name="starOutline" size={10} />
          <span>Open a game to follow its teams. They show first, in My Teams.</span>
        </p>
      )}
    </div>
  );
}
