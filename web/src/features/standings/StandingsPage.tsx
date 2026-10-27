/**
 * A league's full table, re-ranked live from games in progress
 * (StandingsView.swift). Soccer: one table (or its groups), with zones at
 * xlarge. The NBA: both conferences by seed with the play-in and lottery
 * lines. College football: a dozen conference tables as an outline, each
 * collapsed to its header and its leader, open where a team is yours
 * (followed, or in the match it was opened from: `?ring=`). On a wide page
 * grouped tables sit in two columns.
 *
 *     /standings/eng.1      /standings/nba      /standings/college-football?ring=espn-ncaaf-26
 */
import { memo, useCallback, useMemo } from "react";
import { useParams, useSearchParams } from "react-router";
import { DisclosureHeader, EmptyState, ErrorState, OutlineGlide, StaleNote, useGroupFlag, useOutline, type OutlineStore } from "../../design/components";
import { leagueWithID } from "../../data/leagues";
import type { League, ScoreEvent } from "../../data/models";
import {
  collegeOrder,
  leaderSpoken,
  liveScores,
  liveTable,
  projectNBA,
  tableGroups,
  tableKind,
  type StandingsRow,
  type TableGroup,
  type WidthClass,
} from "../../data/standings";
import { apRanks } from "../../data/college";
import { useScoreboard } from "../../state/scores";
import { useSettings } from "../../state/settings";
import { loadState } from "../../state/retry";
import { useRankings, useStandings } from "../../state/standings";
import { useSplit } from "../../app/layout";
import { useDocumentTitle } from "../../app/useDocumentTitle";
import { NotFound } from "../../app/NotFound";
import { ConferenceTable, GroupColumns, HighlightWord, LeaderLine, NBAStandingsTable, ProjectedNote, StandingsTable } from "./Tables";
import { SkeletonTable, TablePage, type PageLayout } from "./TablePage";
import styles from "./StandingsPage.module.css";

const EMPTY: readonly ScoreEvent[] = [];
const followedIDs = (s: { followed: readonly { id: string }[] }) => s.followed;

export function StandingsPage() {
  const { league: id } = useParams();
  const league = id ? leagueWithID(id) : undefined;
  useDocumentTitle(league ? `${league.name} Standings` : "Standings");
  if (!league) return <NotFound />;
  return <Standings league={league} />;
}

function Standings({ league }: { league: League }) {
  const [search] = useSearchParams();
  const split = useSplit();
  const focus = useMemo(() => new Set((search.get("ring") ?? "").split(",").filter(Boolean)), [search]);
  const followed = useSettings(followedIDs);
  const mine = useMemo(() => new Set(followed.map((t) => t.id)), [followed]);
  const highlight = useMemo(() => new Set([...mine, ...focus]), [mine, focus]);
  // A ringed team from the match this was opened from isn't necessarily yours.
  const word = useCallback((id: string) => (mine.has(id) ? "your team" : "in this match"), [mine]);
  const table = useStandings(league);
  const load = loadState(table);
  const kind = tableKind(league);
  // Beside the sidebar its list polls; on a phone this page does.
  const scores = useScoreboard({ poll: !split });
  const events = scores.results[league.id]?.events;
  const live = useMemo(() => events?.filter((e) => e.state === "live") ?? EMPTY, [events]);

  return (
    <HighlightWord.Provider value={word}>
      <TablePage title={league.name} footer={load.stale ? <StaleNote updated={load.updated} subject="table" /> : null}>
        {(layout) =>
          kind === "none" ? (
            <EmptyState icon="list" title="No Table Yet" message={`${league.name} doesn't have a table in Scoreline.`} />
          ) : load.failed ? (
            <ErrorState subject="Table" retriesAutomatically retrying={load.retrying} onRetry={() => void table.refetch()} />
          ) : load.loading ? (
            <SkeletonTable rows={kind === "nba" ? 15 : 20} />
          ) : !table.data || table.data.length === 0 ? (
            <EmptyState icon="list" title="No Table Yet" message={`${league.name} hasn't published a table yet.`} />
          ) : kind === "college" ? (
            <College league={league} rows={table.data} live={live} focus={focus} mine={mine} highlight={highlight} layout={layout} />
          ) : kind === "nba" ? (
            <NBA rows={table.data} live={live} highlight={highlight} layout={layout} />
          ) : (
            <Soccer rows={table.data} live={live} highlight={highlight} layout={layout} />
          )
        }
      </TablePage>
    </HighlightWord.Provider>
  );
}

// MARK: - Soccer

function Soccer({ rows, live, highlight, layout }: { rows: readonly StandingsRow[]; live: readonly ScoreEvent[]; highlight: ReadonlySet<string>; layout: PageLayout }) {
  const projected = useMemo(() => liveTable(rows, live), [rows, live]);
  const groups = useMemo(() => tableGroups(projected, (r) => r.row.group), [projected]);
  const moving = projected.some((r) => r.liveScore != null);
  return (
    <>
      {moving ? <ProjectedNote>Projected if live scores hold. Arrows show moves from the official table.</ProjectedNote> : null}
      {layout.split && groups.length > 1 ? (
        <GroupColumns groups={groups} render={(g) => <StandingsTable rows={g.rows} highlight={highlight} width={layout.column} />} />
      ) : (
        // A single table spans the page and adds columns as it widens.
        <div className={styles.single}>
          <StandingsTable rows={projected} highlight={highlight} width={layout.page} />
        </div>
      )}
    </>
  );
}

// MARK: - NBA

function NBA({ rows, live, highlight, layout }: { rows: readonly StandingsRow[]; live: readonly ScoreEvent[]; highlight: ReadonlySet<string>; layout: PageLayout }) {
  // Both conferences by seed, re-ranked if live scores held.
  const projected = useMemo(() => projectNBA(rows, live), [rows, live]);
  const groups = useMemo(() => tableGroups(projected, (r) => r.row.group), [projected]);
  const moving = projected.some((r) => r.liveScore != null);
  return (
    <>
      {moving ? <ProjectedNote>Projected if live scores hold. Arrows show moves from the official seeding.</ProjectedNote> : null}
      {layout.split && groups.length > 1 ? (
        <GroupColumns groups={groups} render={(g) => <NBAStandingsTable rows={g.rows} highlight={highlight} />} />
      ) : (
        <div className={styles.single}>
          <NBAStandingsTable rows={projected} highlight={highlight} />
        </div>
      )}
    </>
  );
}

// MARK: - College

function College({
  league,
  rows,
  live,
  focus,
  mine,
  highlight,
  layout,
}: {
  league: League;
  rows: readonly StandingsRow[];
  live: readonly ScoreEvent[];
  focus: ReadonlySet<string>;
  mine: ReadonlySet<string>;
  highlight: ReadonlySet<string>;
  layout: PageLayout;
}) {
  const path = league.source.kind === "espn" ? league.source.path : null;
  const polls = useRankings(path);
  const ranks = useMemo(() => apRanks(polls.data ?? []), [polls.data]);
  const scores = useMemo(() => liveScores(live), [live]);
  // The match's conferences first, then followed teams'; the rest in ESPN's order.
  const groups = useMemo(() => tableGroups(collegeOrder(rows, focus, mine), (r) => r.group), [rows, focus, mine]);
  const members = useMemo(() => groups.map((g) => ({ id: g.title, members: g.rows.map((r) => r.id) })), [groups]);
  // Conferences holding a followed team, or one from the match, start open; the rest closed (or as left this session).
  const outline = useOutline(`standings.${league.id}`, members, highlight);
  const width = layout.split ? layout.column : layout.page;
  const render = (g: TableGroup<StandingsRow>) => <ConferenceSection key={g.title} outline={outline} group={g} highlight={highlight} ranks={ranks} live={scores} width={width} />;
  return (
    <div className={styles.outline}>
      {layout.split && groups.length > 1 ? (
        <GroupColumns groups={groups} titles={false} render={render} />
      ) : (
        groups.map(render)
      )}
    </div>
  );
}

/**
 * One conference (or division) as an outline group: its header and,
 * collapsed, who leads it; open, its table. It subscribes to its own flag
 * only, so opening one conference re-renders that conference alone, and a
 * closed conference never builds its table.
 */
const ConferenceSection = memo(function ConferenceSection({
  outline,
  group,
  highlight,
  ranks,
  live,
  width,
}: {
  outline: OutlineStore;
  group: TableGroup<StandingsRow>;
  highlight: ReadonlySet<string>;
  ranks: Readonly<Record<string, number>>;
  live: Readonly<Record<string, string>>;
  width: WidthClass;
}) {
  const flag = useGroupFlag(outline, group.title);
  const leader = group.rows[0];
  const id = `conf-${group.title.replace(/\W+/g, "-")}`;
  return (
    <OutlineGlide outline={outline} as="section" aria-label={group.title}>
      <DisclosureHeader
        title={group.title}
        count={group.rows.length}
        showsCount={false}
        open={flag.open}
        animated={flag.animating}
        controls={id}
        spokenPreview={leader ? leaderSpoken(leader, ranks[leader.id]) : undefined}
        onToggle={(viaKeyboard) => outline.toggle(group.title, viaKeyboard)}
        preview={leader ? <LeaderLine group={group.title} row={leader} rank={ranks[leader.id]} linking={flag.animating} reveal={flag.animating && !flag.revealing} /> : null}
      />
      {flag.open ? (
        <div id={id} className={styles.conference}>
          <ConferenceTable group={group.title} rows={group.rows} highlight={highlight} ranks={ranks} live={live} width={width} revealing={flag.revealing} linking={flag.animating} />
        </div>
      ) : null}
    </OutlineGlide>
  );
});
