/**
 * The team page's sections (TeamSections.swift, ResultsHub.swift
 * `TeamResultsSection`, TeamPage.swift's table): the next game, results and
 * form, the roster grouped the way each sport thinks of it (with the NFL's
 * depth chart), leaders, the table around the team, injuries, transactions
 * and CS2 titles. Results are the schedules layer's season (the same rows and
 * form strip as the team's results page); the table is the standings
 * page's own, seven rows around the team.
 */
import { memo, useMemo, useState } from "react";
import { Link } from "react-router";
import { Icon, LiveStatus, SegmentedControl } from "../../design/components";
import { countdown, dayAndTime } from "../../data/format";
import { atLeast, footballStatLine, profileShort, rosterColumns, rosterSubtitle, rosterValue, spokenRosterRow, type StatColumn, type WidthClass } from "../../data/profiles/display";
import { collapsedByDefault, lastName, ROSTER_GROUP_TITLE, type DepthChart, type GameRef, type RosterGroup, type RosterPlayer, type TeamLeader, type Title, type Transaction } from "../../data/profiles/models";
import { teamRef, type TeamRef } from "../../data/profiles/models";
import { teamResult } from "../../data/results";
import type { ScheduleItem, TeamSeason } from "../../data/schedule";
import { liveTable, nbaWindow, projectNBA, teamWindow, type StandingsRow } from "../../data/standings";
import { profileGameLeague } from "../../data/profiles/routes";
import type { Sport } from "../../data/models";
import { useNow } from "../../state/clock";
import { usePageSession, type TeamProfile } from "../../state/profiles";
import { useScoreboard } from "../../state/scores";
import { gameHref } from "./ProfileCharts";
import { FormReadout, FormStrip, hrefOf, itemHref, TeamResultRow } from "../schedule/ResultRows";
import { ConferenceTable, HighlightWord, NBAStandingsTable, StandingsTable, TableSelf } from "../standings/Tables";
import { linkNameClass, PlayerLink, rowLinkClass, TeamLink } from "./ProfileLinks";
import { SectionLink } from "../seasons/parts";
import { useGoToTeam } from "./GoToMenu";
import { DetailSection, GroupHeader, MoreButton, TeamCrest } from "./ProfileParts";
import { PlayerPhoto } from "./PlayerPhoto";
import styles from "./Profile.module.css";

// MARK: - Next game

/**
 * The next (or live, or last) game: the opponent, when and where to watch, and the countdown or result.
 * `path`: the team's ESPN path ("soccer/all" for a club), which the game opens under.
 */
export function NextGameRow({ game, path }: { readonly game: GameRef; readonly path: string | null }) {
  const id = game.id.startsWith("cs-") ? game.id : `espn-${game.id}`;
  // Where it's played, so the page loads off the scoreboards too (NextGameRow.open: a club's game under its own
  // competition, any other team's under the team's league; web: this was soccer's alone).
  const href = gameHref(id, game.id.startsWith("cs-") ? null : profileGameLeague(path, game.league));
  // The opponent's page from the row's context menu (TeamSections.swift: GoToTeamItem).
  const goTo = useGoToTeam(game.opponent, href);
  return (
    <>
      {/* The menu sits beside the row, not in it: its clicks mustn't reach the row's link. */}
      {goTo.menu}
      <Link to={href} className={rowLinkClass} title="Open the match" {...goTo.props}>
        <span className={styles.gameRow}>
          {game.opponent ? <TeamCrest team={game.opponent} size={22} /> : null}
          <span className={styles.rowText}>
            <span className={`${styles.gameTitle} ${linkNameClass}`}>{game.opponent ? `${game.home ? "vs" : "at"} ${game.opponent.name}` : "TBD"}</span>
            <span className={styles.rowSub}>{[dayAndTime(game.date, Date.now()), game.network, game.competition].filter(Boolean).join(" · ")}</span>
          </span>
          <span className={styles.spacer} />
          <GameTrailing game={game} eventID={id} />
        </span>
      </Link>
    </>
  );
}

function GameTrailing({ game, eventID }: { readonly game: GameRef; readonly eventID: string }) {
  const now = useNow(60_000, game.state === "scheduled");
  const scores = useScoreboard({ poll: false });
  if (game.state === "final") {
    return game.teamScore != null && game.opponentScore != null ? (
      <span className={styles.result}>
        <strong>{game.result}</strong> {`${game.teamScore}–${game.opponentScore}`}
      </span>
    ) : game.result ? (
      <span className={styles.result}>
        <strong>{game.result}</strong>
      </span>
    ) : null;
  }
  if (game.state === "live") {
    // The scores list's copy, for its ticking clock.
    const event = scores.event(eventID);
    return <LiveStatus clock={event?.clock ?? null} fallback={event?.detail ?? "Live"} size={11} />;
  }
  const text = countdown(game.date, now);
  return text ? <span className={styles.countdown}>{text}</span> : null;
}

// MARK: - Results

/**
 * The season's results (ResultsHub.swift `TeamResultsSection`): the last five
 * as a form strip with the pointed-at game named beside it, then the five
 * latest rows (the results page's own, with its details), newest first, and
 * "All Results" (the team's schedule, facing back). A mark and its row light
 * together.
 */
export function TeamResultsSection({ season, sport, details, allResults }: { readonly season: TeamSeason; readonly sport: Sport | null; readonly details: boolean; readonly allResults: string }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const caption = sport === "soccer" ? "All competitions, newest first." : sport === "esports" ? "From bo3.gg." : "This season, newest first.";
  const marks = season.form.slice(-5);
  return (
    <DetailSection id="results" title="Results" caption={caption}>
      {marks.length > 0 ? (
        <div className={styles.formLine}>
          <FormStrip marks={marks} hovered={hovered} onHover={setHovered} href={(id) => hrefOf(season.results, id)} />
          {/* The rows below already lead with the latest: the line names a pointed-at mark only. */}
          <FormReadout marks={marks} hovered={hovered} fallsBackToLatest={false} />
        </div>
      ) : null}
      <div className={styles.resultRows} onPointerLeave={() => setHovered(null)}>
        {season.results.slice(0, 5).map((item) => (
          <TeamPageResult key={item.id} item={item} team={season.team.id} details={details} lit={hovered === item.id} onHover={setHovered} />
        ))}
      </div>
      <SectionLink to={allResults} title="Every result this season">
        All Results
      </SectionLink>
    </DetailSection>
  );
}

/** A result row that also offers its opponent's page from its menu (TeamSections.swift: GoToTeamItem). */
function TeamPageResult({ item, team, details, lit, onHover }: { readonly item: ScheduleItem; readonly team: string; readonly details: boolean; readonly lit: boolean; readonly onHover: (id: string) => void }) {
  const opponent = teamResult(item, team).opponent;
  const ref = useMemo<TeamRef | null>(
    () => (opponent?.id ? teamRef({ id: opponent.id, name: opponent.name, logo: opponent.logo, abbreviation: opponent.abbreviation, league: item.league }) : null),
    [opponent?.id, opponent?.name, opponent?.logo, opponent?.abbreviation, item.league],
  );
  const goTo = useGoToTeam(ref, itemHref(item));
  return (
    <>
      {goTo.menu}
      <TeamResultRow item={item} team={team} details={details} keyboard={false} lit={lit} onHover={onHover} linkProps={goTo.props ?? undefined} />
    </>
  );
}

// MARK: - Roster

/** Each group into whichever column has fewer rows so far, in order (ListLayout.swift `GroupPlacement`): never measured, so nothing moves. */
function placeGroups(sizes: readonly number[], columns: number): number[][] {
  const placed: number[][] = Array.from({ length: Math.max(columns, 1) }, () => []);
  const rows = placed.map(() => 0);
  sizes.forEach((size, index) => {
    let target = 0;
    rows.forEach((r, k) => {
      if (r < rows[target]!) target = k;
    });
    placed[target]!.push(index);
    rows[target]! += size;
  });
  return placed;
}

/**
 * The roster in its groups, with stat columns that join as the block widens;
 * the NFL's adds a Roster | Depth Chart switch. Long or rarely wanted groups
 * (the practice squad, CS2's benched) start collapsed. Choices survive Back.
 */
export function RosterSection({ team, width, tint, lightInk, memoryKey, columns }: {
  readonly team: TeamProfile;
  readonly width: WidthClass;
  readonly tint: string | null;
  readonly lightInk: boolean;
  readonly memoryKey: string;
  readonly columns: number;
}) {
  const [session, update] = usePageSession(memoryKey);
  const sport = team.sport ?? "football";
  const chart = team.depthChart;
  const collapsed = (g: RosterGroup) => collapsedByDefault(g.kind) && !session.expanded.includes(g.kind);
  return (
    <div>
      {chart ? (
        <div className={styles.controlRow}>
          <SegmentedControl<"roster" | "depth">
            label="Roster View"
            value={session.depthChart ? "depth" : "roster"}
            onChange={(v) => update({ depthChart: v === "depth" })}
            options={[
              { value: "roster", label: "Roster" },
              { value: "depth", label: "Depth Chart" },
            ]}
          />
        </div>
      ) : null}
      {session.depthChart && chart ? (
        <TwoUp sizes={chart.units.map((u) => u.slots.length + 1)} columns={columns}>
          {(indices) => <DepthChartView chart={{ units: indices.map((i) => chart.units[i]!) }} players={team.groups.flatMap((g) => g.players)} />}
        </TwoUp>
      ) : (
        <TwoUp sizes={team.groups.map((g) => (collapsed(g) ? 2 : g.players.length + 1))} columns={columns}>
          {(indices) =>
            indices.map((i, k) => {
              const g = team.groups[i]!;
              return <RosterGroupView key={g.kind} group={g} sport={sport} width={width} tint={tint} lightInk={lightInk} first={k === 0} collapsed={collapsed(g)} onExpand={() => update((s) => ({ expanded: [...s.expanded, g.kind] }))} />;
            })
          }
        </TwoUp>
      )}
    </div>
  );
}

/** Blocks in one column, or two side by side, each block in the shorter column so far. */
function TwoUp({ sizes, columns, children }: { readonly sizes: readonly number[]; readonly columns: number; readonly children: (indices: number[]) => React.ReactNode }) {
  if (columns < 2) return <div>{children(sizes.map((_, i) => i))}</div>;
  return (
    <div className={styles.twoUp}>
      {placeGroups(sizes, columns).map((indices, k) => (
        <div key={k} className={styles.twoUpColumn}>
          {children(indices)}
        </div>
      ))}
    </div>
  );
}

const RosterGroupView = memo(function RosterGroupView({ group, sport, width, tint, lightInk, first, collapsed, onExpand }: {
  readonly group: RosterGroup;
  readonly sport: Sport;
  readonly width: WidthClass;
  readonly tint: string | null;
  readonly lightInk: boolean;
  readonly first: boolean;
  readonly collapsed: boolean;
  readonly onExpand: () => void;
}) {
  // Who's out has no line to show: their group says why.
  const columns = group.kind === "out" ? [] : rosterColumns(sport, group.kind).filter((c) => atLeast(width, c.from));
  return (
    <div className={styles.group}>
      <GroupHeader title={ROSTER_GROUP_TITLE[group.kind]} columns={collapsed ? [] : columns} first={first} />
      {collapsed ? (
        <MoreButton onClick={onExpand}>{`Show ${group.players.length} ${group.players.length === 1 ? "player" : "players"}`}</MoreButton>
      ) : (
        group.players.map((p) => <RosterRow key={p.ref.id} player={p} columns={columns} sport={sport} group={group.kind} tint={tint} lightInk={lightInk} />)
      )}
    </div>
  );
});

const RosterRow = memo(function RosterRow({ player, columns, sport, group, tint, lightInk }: {
  readonly player: RosterPlayer;
  readonly columns: readonly StatColumn[];
  readonly sport: Sport;
  readonly group: RosterGroup["kind"];
  readonly tint: string | null;
  readonly lightInk: boolean;
}) {
  const sub = rosterSubtitle(player, sport, group);
  const line = sport === "football" ? footballStatLine(player) : null;
  return (
    <PlayerLink player={player.ref} variant="row" label={spokenRosterRow(player, columns)}>
      <span className={styles.rosterRow}>
        <PlayerPhoto url={player.ref.photo} name={player.ref.name} tint={tint} size={28} lightInk={lightInk} />
        <span className={styles.rowText}>
          <span className={`${styles.rosterName} ${linkNameClass}`}>{player.ref.name}</span>
          <span className={styles.rowSub}>
            {sub.status ? <span className={styles.status}>{sub.status}</span> : null}
            {sub.status && sub.rest ? " · " : null}
            {sub.rest}
          </span>
        </span>
        <span className={styles.spacer} />
        {line ? <span className={styles.statLine}>{line}</span> : null}
        {columns.map((c) => {
          const v = rosterValue(player, c.key);
          return (
            <span key={c.key} className={styles.cell} data-empty={v === "–"} style={{ width: `calc(${c.width} * var(--pt))` }}>
              {v}
            </span>
          );
        })}
      </span>
    </PlayerLink>
  );
});

/**
 * The NFL's depth chart: each unit's slots in depth order, starters in
 * primary ink and backups in secondary, each name a link. As many names as
 * fit (up to three): a list scans faster than a formation diagram.
 */
function DepthChartView({ chart, players }: { readonly chart: DepthChart; readonly players: readonly RosterPlayer[] }) {
  const byID = new Map(players.map((p) => [p.ref.id, p]));
  const unitName = { offense: "Offense", defense: "Defense", specialTeams: "Special Teams" } as const;
  return (
    <div>
      {chart.units.map((unit, k) => (
        <div key={unit.kind} className={styles.group}>
          {/* The formation after the unit ("Offense · 3WR 1TE"), unless it only repeats it ("Special Teams"). */}
          <GroupHeader title={!unit.name || unit.name.toLowerCase() === unitName[unit.kind].toLowerCase() ? unitName[unit.kind] : `${unitName[unit.kind]} · ${unit.name}`} first={k === 0} />
          {unit.slots.map((slot) => (
            <div key={slot.key} className={styles.depthRow}>
              <span className={styles.slotLabel}>{slot.label}</span>
              <span className={styles.depthNames}>
                {slot.players.slice(0, 3).map((p, i) => {
                  const player = byID.get(p.id);
                  const injury = player?.injury && ["Out", "Injured Reserve", "Doubtful"].includes(player.injury) ? player.injury : null;
                  return (
                    <span key={p.id} className={styles.depthName} data-starter={i === 0}>
                      {i > 0 ? <span className={styles.depthDot} aria-hidden="true">·</span> : null}
                      <PlayerLink player={player?.ref ?? null}>{lastName(p.name)}</PlayerLink>
                      {injury ? <span className={styles.depthInjury}>{` (${injury === "Injured Reserve" ? "IR" : injury})`}</span> : null}
                    </span>
                  );
                })}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// MARK: - Leaders

/** The team's leaders by category: the photo, the number, the name. Two across, four from large. */
export function LeadersGrid({ leaders, tint, lightInk, width }: { readonly leaders: readonly TeamLeader[]; readonly tint: string | null; readonly lightInk: boolean; readonly width: WidthClass }) {
  const columns = atLeast(width, "large") ? Math.min(4, leaders.length) : 2;
  return (
    <div className={styles.leaders} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {leaders.map((l) => (
        <PlayerLink key={l.category} player={l.player} variant="row" label={`${l.label}: ${l.player.name}, ${l.value}`}>
          <span className={styles.leader}>
            <PlayerPhoto url={l.player.photo} name={l.player.name} tint={tint} size={34} lightInk={lightInk} />
            <span className={styles.leaderText}>
              <span className={styles.leaderLabel}>{l.label}</span>
              <span className={styles.leaderValue}>{l.value}</span>
              <span className={`${styles.leaderName} ${linkNameClass}`}>{lastName(l.player.name)}</span>
            </span>
          </span>
        </PlayerLink>
      ))}
    </div>
  );
}

// MARK: - Table window

/** On a team's own page, its row is the page itself. */
const thisTeam = () => "this team";

/**
 * Seven rows of the team's own table around it, as the standings page draws
 * them (TeamPage.swift `standingsTable`): the NBA by seed, college by
 * conference record with the season's alongside, soccer's table. The others
 * open their pages; the team's own row is this page.
 */
export function TeamTable({ rows, teamID, sport, width }: { readonly rows: readonly StandingsRow[]; readonly teamID: string; readonly sport: Sport | null; readonly width: WidthClass }) {
  const ids = useMemo(() => new Set([teamID]), [teamID]);
  const table = useMemo(() => {
    switch (sport) {
      case "basketball":
        return { kind: "nba" as const, rows: nbaWindow(projectNBA(rows, []), ids, 3) };
      case "football":
        return { kind: "college" as const, rows: teamWindow(rows, teamID) };
      default:
        return { kind: "soccer" as const, rows: liveTable(teamWindow(rows, teamID), []) };
    }
  }, [rows, sport, ids, teamID]);
  return (
    <TableSelf.Provider value={teamID}>
      <HighlightWord.Provider value={thisTeam}>
        {table.kind === "nba" ? (
          <NBAStandingsTable rows={table.rows} highlight={ids} />
        ) : table.kind === "college" ? (
          <ConferenceTable group={table.rows[0]?.group ?? ""} rows={table.rows} highlight={ids} ranks={NO_RANKS} live={NO_RANKS} width={width} />
        ) : (
          <StandingsTable rows={table.rows} highlight={ids} width={width} />
        )}
      </HighlightWord.Provider>
    </TableSelf.Provider>
  );
}

const NO_RANKS: Readonly<Record<string, never>> = {};

// MARK: - Injuries, transactions, titles

export function InjuryRows({ players }: { readonly players: readonly RosterPlayer[] }) {
  return (
    <div>
      {players.map((p) => (
        <PlayerLink key={p.ref.id} player={p.ref} variant="row" label={`${p.ref.name}, ${p.position ?? ""}, ${p.injury === "Day-To-Day" ? "Day-to-day" : p.injury}`}>
          <span className={styles.injuryRow}>
            <span className={`${styles.injuryName} ${linkNameClass}`}>{p.ref.name}</span>
            <span className={styles.injuryPosition}>{p.position}</span>
            <span className={styles.spacer} />
            <span className={styles.injuryStatus} data-out={p.injury === "Out"}>
              {p.injury === "Day-To-Day" ? "Day-to-day" : p.injury}
            </span>
          </span>
        </PlayerLink>
      ))}
    </div>
  );
}

export function TransactionRows({ transactions, memoryKey }: { readonly transactions: readonly Transaction[]; readonly memoryKey: string }) {
  const [session, update] = usePageSession(memoryKey);
  const all = session.expanded.includes("transactions");
  return (
    <div className={styles.transactions}>
      {(all ? transactions : transactions.slice(0, 5)).map((t) => (
        <p key={`${t.date ?? 0}|${t.text}`} className={styles.transaction}>
          <span className={styles.transactionDate}>{t.date != null ? profileShort(t.date) : ""}</span>
          <span>{t.text}</span>
        </p>
      ))}
      {!all && transactions.length > 5 ? <MoreButton onClick={() => update((s) => ({ expanded: [...s.expanded, "transactions"] }))}>{`Show All (${transactions.length})`}</MoreButton> : null}
    </div>
  );
}

export function TitleRows({ titles }: { readonly titles: readonly Title[] }) {
  return (
    <div className={styles.titles}>
      {titles.slice(0, 5).map((t) => (
        <div key={t.name} className={styles.titleRow}>
          <Icon name="trophy" size={10} className={styles.titleIcon} />
          <span className={styles.titleName}>{t.name}</span>
          <span className={styles.spacer} />
          <span className={styles.titleDate}>{t.date != null ? new Date(t.date).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : ""}</span>
        </div>
      ))}
    </div>
  );
}

