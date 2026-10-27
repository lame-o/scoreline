/**
 * A league's table on a game page (DetailView.swift `.table`): the window
 * around this match's two teams, re-ranked live from the league's games in
 * progress (the standings layer's projection: features/standings), with a
 * link to the full table.
 *
 * - Soccer (`SoccerTableWindow`): one place either side of each team (two
 *   when the table has a wide column to itself), within their group.
 * - The NBA (`NBATableWindow`): each team's conference two seeds either side,
 *   with the play-in and lottery lines.
 *
 * Both read the scoreboard without polling it (the sidebar or the page
 * already polls), and the standings query the standings pages share.
 */
import { memo, useMemo } from "react";
import { Link } from "react-router";
import { Icon } from "../../../design/components";
import { isKnockout, type League, type ScoreEvent } from "../../../data/models";
import { liveTable, nbaWindow, projectNBA, widthClassOf, type LiveStandingsRow, type StandingsRow } from "../../../data/standings";
import { standingsPath } from "../../../data/schedule";
import { useScoreboard } from "../../../state/scores";
import { useStandings } from "../../../state/standings";
import { HighlightWord, NBAStandingsTable, StandingsTable } from "../../standings/Tables";

/** The highlighted rows on a game page are the two teams playing, not necessarily yours. */
const inThisMatch = () => "in this match";
import { DetailSection } from "../core/DetailSection";
import styles from "./GameTables.module.css";

const EMPTY: readonly ScoreEvent[] = [];

/** The league's live games, from the scoreboard (never polled here). */
export function useLeagueLive(league: League | undefined): readonly ScoreEvent[] {
  const scores = useScoreboard({ poll: false });
  const events = league ? scores.results[league.id]?.events : undefined;
  return useMemo(() => events?.filter((e) => e.state === "live") ?? EMPTY, [events]);
}

/** The table's rows, once loaded (and for a league that has one). */
export function useTableRows(league: League | undefined): readonly StandingsRow[] | null {
  const table = useStandings(league);
  return table.data && table.data.length > 0 ? table.data : null;
}

/**
 * The table around this match's two teams (`reach` places either side of
 * each), within their own group or conference, in the order the ranks read
 * (DetailView.tableWindow).
 */
export function soccerTableWindow(rows: readonly StandingsRow[], live: readonly ScoreEvent[], ids: ReadonlySet<string>, reach: number): LiveStandingsRow[] {
  let projected = liveTable(rows, live);
  // Each team's own group (both, for a cross-group game).
  const groups = new Set(projected.filter((r) => ids.has(r.id)).map((r) => r.row.group));
  if (groups.size > 0) projected = projected.filter((r) => groups.has(r.row.group));
  // With no live games the projection keeps the league's own order; group by group, in the order the ranks read.
  const order = new Map<string | null, number>();
  for (const r of projected) if (!order.has(r.row.group)) order.set(r.row.group, order.size);
  projected = [...projected].sort((a, b) => (order.get(a.row.group) ?? 0) - (order.get(b.row.group) ?? 0) || a.liveRank - b.liveRank);
  const positions = projected.flatMap((r, i) => (ids.has(r.id) ? [i] : []));
  if (positions.length === 0) return projected.slice(0, 5);
  const keep = new Set<number>();
  for (const p of positions) for (let i = p - reach; i <= p + reach; i++) if (projected[i] && projected[i]!.row.group === projected[p]!.row.group) keep.add(i);
  return projected.filter((_, i) => keep.has(i));
}

/** "Full Table ›": the link under a table window (DetailView.linkButton). */
export function FullTableLink({ to, label }: { to: string; label: string }) {
  return (
    <Link className={styles.more} to={to}>
      {label}
      <Icon name="chevronRight" size={9} />
    </Link>
  );
}

export const SoccerTableWindow = memo(function SoccerTableWindow({ league, rows, live, ids, final, recent, width }: {
  league: League;
  rows: readonly StandingsRow[];
  live: readonly ScoreEvent[];
  ids: readonly string[];
  final: boolean;
  recent: boolean;
  /** The section's width in points: two places either side from xlarge. */
  width: number;
}) {
  const wide = width >= 560;
  const window = useMemo(() => soccerTableWindow(rows, live, new Set(ids), wide ? 2 : 1), [rows, live, ids, wide]);
  const projected = live.some((e) => !isKnockout(e));
  return (
    <DetailSection
      id="table"
      title="Table"
      caption={projected ? "Projected if live scores hold. Arrows show moves from the official table." : final && !recent ? "Table today, from ESPN." : "Official table from ESPN. New results can take a few minutes."}
      accessory={projected ? "live" : undefined}
    >
      <HighlightWord.Provider value={inThisMatch}>
        <StandingsTable rows={window} highlight={new Set(ids)} width={widthClassOf(width)} />
      </HighlightWord.Provider>
      <FullTableLink to={standingsPath(league.id, ids)} label="Full Table" />
    </DetailSection>
  );
});

export const NBATableWindow = memo(function NBATableWindow({ rows, live, ids }: { rows: readonly StandingsRow[]; live: readonly ScoreEvent[]; ids: readonly string[] }) {
  const projectedRows = useMemo(() => projectNBA(rows, live), [rows, live]);
  const window = useMemo(() => nbaWindow(projectedRows, new Set(ids)), [projectedRows, ids]);
  const projected = projectedRows.some((r) => r.liveScore != null);
  if (window.length === 0) return null;
  return (
    <DetailSection
      id="table"
      title="Standings"
      caption={projected ? "Projected if live scores hold. Arrows show moves from the official seeding." : "By conference seed. Top 6 make the playoffs; 7–10 go to the play-in."}
      accessory={projected ? "live" : undefined}
    >
      <HighlightWord.Provider value={inThisMatch}>
        <NBAStandingsTable rows={window} highlight={new Set(ids)} />
      </HighlightWord.Provider>
      <FullTableLink to={standingsPath("nba", ids)} label="Full Standings" />
    </DetailSection>
  );
});
