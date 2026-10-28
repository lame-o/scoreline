/**
 * The team page's sections (TeamSections.swift, ResultsHub.swift
 * `TeamResultsSection`, TeamPage.swift's table): the next game, results and
 * form, the roster grouped the way each sport thinks of it (with the NFL's
 * depth chart), leaders, the table around the team, injuries, transactions
 * and CS2 titles.
 */
import { memo } from "react";
import { Link } from "react-router";
import { Icon, LiveStatus, SegmentedControl } from "../../design/components";
import { countdown, dayAndTime } from "../../data/format";
import { atLeast, footballStatLine, profileShort, rosterColumns, rosterSubtitle, rosterValue, spokenRosterRow, type StatColumn, type WidthClass } from "../../data/profiles/display";
import { collapsedByDefault, lastName, ROSTER_GROUP_TITLE, type DepthChart, type GameRef, type RosterGroup, type RosterPlayer, type TeamLeader, type Title, type Transaction } from "../../data/profiles/models";
import type { FormMark, StandingsRow } from "../../data/profiles/results";
import type { Sport } from "../../data/models";
import { useNow } from "../../state/clock";
import { usePageSession, type TeamProfile } from "../../state/profiles";
import { useScoreboard } from "../../state/scores";
import { FormStrip, gameHref } from "./ProfileCharts";
import { linkNameClass, PlayerLink, rowLinkClass, TeamLink } from "./ProfileLinks";
import { SectionLink } from "../seasons/parts";
import { useGoToTeam } from "./GoToMenu";
import { DetailSection, GroupHeader, MoreButton, TeamCrest } from "./ProfileParts";
import { PlayerPhoto } from "./PlayerPhoto";
import styles from "./Profile.module.css";

// MARK: - Next game

/** The next (or live, or last) game: the opponent, when and where to watch, and the countdown or result. */
export function NextGameRow({ game }: { readonly game: GameRef }) {
  const id = game.id.startsWith("cs-") ? game.id : `espn-${game.id}`;
  // The opponent's page from the row's context menu (TeamSections.swift: GoToTeamItem).
  const goTo = useGoToTeam(game.opponent, gameHref(id));
  return (
    <>
      {/* The menu sits beside the row, not in it: its clicks mustn't reach the row's link. */}
      {goTo.menu}
      <Link to={gameHref(id)} className={rowLinkClass} title="Open the match" {...goTo.props}>
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

/** The season's results: the last five as a form strip, then the latest rows, newest first, and "All Results" (the team's schedule, facing back). */
export function ResultsSection({ results, form, sport, allResults = null }: { readonly results: readonly GameRef[]; readonly form: readonly FormMark[]; readonly sport: Sport | null; readonly allResults?: string | null }) {
  const caption = sport === "soccer" ? "All competitions, newest first." : sport === "esports" ? "From bo3.gg." : "This season, newest first.";
  return (
    <DetailSection title="Results" caption={caption}>
      {form.length > 0 ? <FormStrip marks={form} /> : null}
      <div className={styles.resultRows}>
        {results.slice(0, 5).map((g) => (
          <ResultRow key={g.id} game={g} />
        ))}
      </div>
      {allResults ? (
        <SectionLink to={allResults} title="Every result this season">
          All Results
        </SectionLink>
      ) : null}
    </DetailSection>
  );
}

const WORD: Readonly<Record<string, string>> = { W: "won", L: "lost", D: "drew", T: "tied" };

function ResultRow({ game }: { readonly game: GameRef }) {
  const score = game.teamScore != null && game.opponentScore != null ? `${game.teamScore}–${game.opponentScore}` : null;
  const spoken = [
    profileShort(game.date),
    game.opponent ? `${game.home ? "versus" : "at"} ${game.opponent.name}` : null,
    [WORD[game.result ?? ""] ?? game.result, score?.replace("–", " to ")].filter(Boolean).join(" "),
    game.competition,
  ]
    .filter(Boolean)
    .join(", ");
  const goTo = useGoToTeam(game.opponent, gameHref(game.id));
  return (
    <>
      {goTo.menu}
      <Link to={gameHref(game.id)} className={rowLinkClass} aria-label={spoken} title="Open the match" {...goTo.props}>
        <span className={styles.resultRow}>
          <span className={styles.resultLine}>
            <span className={styles.date}>{profileShort(game.date)}</span>
            {game.opponent ? <TeamCrest team={game.opponent} size={14} /> : null}
            <span className={`${styles.opponent} ${linkNameClass}`}>{game.opponent ? `${game.home ? "vs" : "at"} ${game.opponent.name}` : "TBD"}</span>
            <span className={styles.spacer} />
            <span className={styles.result} data-lost={game.result === "L"}>
              <strong>{game.result}</strong>
              {score ? ` ${score}` : ""}
            </span>
          </span>
          {game.competition ? <span className={styles.resultCaption}>{game.competition}</span> : null}
        </span>
      </Link>
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

/** Seven rows of the team's own table around it, the team's row marked; the others open their pages. */
export function StandingsWindow({ window: table, teamID, sport, width, league }: {
  readonly window: { readonly rows: readonly StandingsRow[]; readonly first: number };
  readonly teamID: string;
  readonly sport: Sport | null;
  readonly width: WidthClass;
  readonly league: string | null;
}) {
  const columns: { key: string; label: string; width: number; title: string }[] =
    sport === "basketball"
      ? [{ key: "total", label: "W-L", width: 40, title: "Wins and losses" }, { key: "winPercent", label: "PCT", width: 38, title: "Win percentage" }, { key: "gamesBehind", label: "GB", width: 30, title: "Games behind the conference leader" }]
      : sport === "football"
        ? [{ key: "vsconf", label: "CONF", width: 40, title: "Conference record" }, { key: "total", label: "OVR", width: 40, title: "Overall record" }, ...(atLeast(width, "medium") ? [{ key: "streak", label: "STRK", width: 36, title: "Streak" }] : [])]
        : soccerColumns(width);
  const rank = (row: StandingsRow, i: number) => (sport === "basketball" ? (row.stats.playoffSeed ?? String(table.first + i + 1)) : String(table.first + i + 1));
  return (
    <div className={styles.table} role="table" aria-label="Standings">
      <div className={styles.tableHead} role="row">
        <span className={styles.tableRank} role="columnheader" title={sport === "basketball" ? "Seed" : "Position"}>
          #
        </span>
        <span className={styles.tableTeam} role="columnheader">
          Team
        </span>
        {columns.map((c) => (
          <span key={c.key} role="columnheader" className={styles.tableCell} style={{ width: `calc(${c.width} * var(--pt))` }} title={c.title}>
            {c.label}
          </span>
        ))}
      </div>
      {table.rows.map((row, i) => {
        const own = row.id === teamID;
        const cells = (
          <span className={styles.tableRow} data-own={own} role="row">
            <span className={styles.tableRank} role="cell">
              {rank(row, i)}
            </span>
            <span className={styles.tableTeam} role="cell">
              <TeamCrest team={{ logo: row.logo, abbreviation: row.abbreviation }} size={14} />
              <span className={styles.tableName}>{row.name}</span>
            </span>
            {columns.map((c) => (
              <span key={c.key} role="cell" className={styles.tableCell} style={{ width: `calc(${c.width} * var(--pt))` }}>
                {(row.stats[c.key] ?? "–").replace(/^(\d+)-(\d+)(-(\d+))?$/, (m) => m.replaceAll("-", "–"))}
              </span>
            ))}
          </span>
        );
        return own ? (
          <div key={row.id} className={styles.tableOwn}>
            {cells}
          </div>
        ) : (
          <TeamLink key={row.id} team={{ id: row.id, name: row.name, logo: row.logo, league, color: null, alternateColor: null, abbreviation: row.abbreviation }} variant="row" className={styles.tableLink}>
            {cells}
          </TeamLink>
        );
      })}
    </div>
  );
}

/** Soccer: compact keeps P, GD, Pts; each step adds the next most useful pair (LiveViews.swift `StandingsTable.Column`). */
function soccerColumns(width: WidthClass) {
  const all = {
    played: { key: "gamesPlayed", label: "P", width: 22, title: "Played" },
    won: { key: "wins", label: "W", width: 20, title: "Won" },
    drawn: { key: "ties", label: "D", width: 20, title: "Drawn" },
    lost: { key: "losses", label: "L", width: 20, title: "Lost" },
    gf: { key: "pointsFor", label: "GF", width: 24, title: "Goals for" },
    ga: { key: "pointsAgainst", label: "GA", width: 24, title: "Goals against" },
    gd: { key: "pointDifferential", label: "GD", width: 32, title: "Goal difference" },
    pts: { key: "points", label: "Pts", width: 32, title: "Points" },
  };
  if (atLeast(width, "large")) return [all.played, all.won, all.drawn, all.lost, all.gf, all.ga, all.gd, all.pts];
  if (atLeast(width, "medium")) return [all.played, all.won, all.drawn, all.lost, all.gd, all.pts];
  return [all.played, all.gd, all.pts];
}

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

