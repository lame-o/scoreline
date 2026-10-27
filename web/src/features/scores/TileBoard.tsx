/**
 * The Tiles view: exactly the list's games, regrouped by state (Live, Your
 * Teams, Up Next, Final), each tier a band of large tiles then small ones
 * (TileBoard.swift). Column counts follow the board's width like the Mac
 * panel's layout classes; tiers collapse like sections.
 */
import { LayoutGroup, m } from "motion/react";
import { useMemo, useRef } from "react";
import { Link } from "react-router";
import { Icon, type IconName } from "../../design/components";
import { revealDelay, spring } from "../../design/motion";
import type { League } from "../../data/models";
import { planTiles, TIER_TITLE, tierID, type Board, type TierKind, type TierPlan } from "../../data/scoreboard";
import { EventTile } from "./EventTile";
import { useWidth } from "../../design/useWidth";
import { Footnotes } from "./ScoresList";
import { firstAppearances, SectionHeader, useSectionToggle } from "./sections";
import styles from "./Tiles.module.css";

const TIER_ICON: Readonly<Record<TierKind, IconName>> = { live: "sparkles", mine: "star", next: "clock", final: "flag" };
const PREVIEW_LOGOS = 7;

export interface TileBoardProps {
  readonly board: Board;
  readonly collapsed: readonly string[];
  readonly followed: readonly string[];
  readonly quietLeagues: readonly League[];
  readonly hasFollowed: boolean;
  readonly highlight: { readonly id: string | null; readonly keyboard: boolean };
  readonly selectedID: string | null;
  readonly stale: boolean;
  readonly onHover: (id: string) => void;
}

/** TileMetrics: never one small column; 3 from the large width class, 4 and 2 large when split. */
function columns(width: number): { large: number; small: number } {
  const content = width - 28;
  if (width >= 680) return { large: 2, small: 4 };
  return { large: 1, small: content >= 460 ? 3 : 2 };
}

export function TileBoard({ board, collapsed, followed, quietLeagues, hasFollowed, highlight, selectedID, stale, onHover }: TileBoardProps) {
  const { toggling, toggle } = useSectionToggle();
  const ref = useRef<HTMLDivElement>(null);
  // The board's width in Mac points: one observer for the whole board, read only when it changes.
  const width = useWidth(ref);
  const cols = columns(width);
  const plans = useMemo(() => planTiles(board, cols.large, Date.now()), [board, cols.large]);
  const gridWidth = width - 20;
  const inner = {
    large: (cols.large >= 2 ? (gridWidth - 8) / 2 : gridWidth) - 24,
    small: (gridWidth - 8 * (cols.small - 1)) / cols.small - 20,
  };

  return (
    <div className={styles.board} ref={ref}>
      <LayoutGroup>
        {plans.map((plan) => {
          const id = tierID(plan.tier.kind);
          const isCollapsed = collapsed.includes(id);
          return (
            <m.section key={id} layout={toggling.animating ? "position" : false} transition={spring.standard} aria-label={TIER_TITLE[plan.tier.kind]}>
              <SectionHeader
                id={id}
                title={TIER_TITLE[plan.tier.kind]}
                icon={TIER_ICON[plan.tier.kind]}
                events={plan.tiles.map((t) => t.event)}
                collapsed={isCollapsed}
                toggling={toggling}
                onToggle={toggle}
                maxLogos={PREVIEW_LOGOS}
                controls={`tiles-${id}`}
                link={plan.tier.kind === "next" ? <ScheduleLink /> : undefined}
              />
              {isCollapsed ? null : (
                <TierTiles
                  plan={plan}
                  id={id}
                  cols={cols}
                  inner={inner}
                  board={board}
                  followed={followed}
                  linking={toggling.id === id}
                  highlight={highlight}
                  selectedID={selectedID}
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

/** Up Next's "Schedule ›": the agenda beyond the next 36 hours (TileBoard.onOpenSchedule). */
function ScheduleLink() {
  return (
    <Link className={styles.scheduleLink} to="/schedule" state={{ from: "Scores" }} title="Schedule (S)">
      Schedule
      <Icon name="chevronRight" size={8} />
    </Link>
  );
}

function TierTiles({
  plan,
  id,
  cols,
  inner,
  board,
  followed,
  linking,
  highlight,
  selectedID,
  stale,
  onHover,
}: {
  plan: TierPlan;
  id: string;
  cols: { large: number; small: number };
  inner: { large: number; small: number };
  board: Board;
  followed: readonly string[];
  linking: boolean;
  highlight: TileBoardProps["highlight"];
  selectedID: string | null;
  stale: boolean;
  onHover: (id: string) => void;
}) {
  const travel = useMemo(() => {
    if (!linking) return null;
    const map = firstAppearances(id, plan.tiles.map((t) => t.event), PREVIEW_LOGOS);
    return new Map([...map].map(([eventID, ids]) => [eventID, { section: id, ids }]));
  }, [linking, id, plan]);
  const large = plan.tiles.filter((t) => t.size === "large");
  const small = plan.tiles.filter((t) => t.size === "small");
  const tile = (t: TierPlan["tiles"][number], index: number, className?: string) => (
    <EventTile
      key={t.event.id}
      event={t.event}
      size={t.size}
      league={board.league.get(t.event.id) ?? null}
      followed={followed}
      keyboard={highlight.keyboard && highlight.id === t.event.id}
      selected={selectedID === t.event.id}
      stale={stale}
      inner={t.size === "large" ? inner.large : inner.small}
      revealDelay={linking ? revealDelay(Math.floor(index / Math.max(1, t.size === "large" ? cols.large : cols.small))) : null}
      travel={travel?.get(t.event.id) ?? null}
      onHover={onHover}
      className={className}
    />
  );
  return (
    <div id={`tiles-${id}`}>
      {large.length > 0 ? (
        <div className={`${styles.grid} ${styles.large}`} style={{ gridTemplateColumns: `repeat(${cols.large}, minmax(0, 1fr))` }}>
          {large.map((t, i) => tile(t, i, plan.heroFirst && i === 0 ? styles.span : undefined))}
        </div>
      ) : null}
      {small.length > 0 ? (
        <div className={`${styles.grid} ${styles.small}`} style={{ gridTemplateColumns: `repeat(${cols.small}, minmax(0, 1fr))` }}>
          {small.map((t, i) => tile(t, i + large.length))}
        </div>
      ) : null}
    </div>
  );
}
