/**
 * The player page's sections (PlayerSections.swift): the game log (strip and
 * table, with MLB's Batting | Pitching for two-way players), stat tables, bio
 * facts, the status note, career by season, awards, and the climbing and CS2
 * specifics.
 */
import { useState } from "react";
import { Link } from "react-router";
import { SegmentedControl } from "../../design/components";
import { dayAndTime } from "../../data/format";
import { drawsStrip, entryContext, scoreText } from "../../data/profiles/charts";
import { atLeast, careerColumns, gameLogColumns, gameLogValue, profileShort, statWord, tableColumnIndices, type WidthClass } from "../../data/profiles/display";
import { podiumTotal, type ClimbResult, type GameLog, type GameLogEntry, type Note, type PlayerRef, type Podium, type StatTable } from "../../data/profiles/models";
import type { Sport } from "../../data/models";
import { usePageSession, type PlayerView } from "../../state/profiles";
import { gameHref, GameLogStrip, MatchStrip } from "./ProfileCharts";
import { linkNameClass, rowLinkClass } from "./ProfileLinks";
import { DetailSection, GroupHeader, MoreButton, TeamCrest } from "./ProfileParts";
import styles from "./Profile.module.css";

// MARK: - Game log

/**
 * MLB: the player's role first (pitching for a pitcher; ESPN's default log
 * is in the player's role); the other role only for a two-way player (the
 * other log has a game with something in it), by choice, remembered.
 */
export function GameLogSection({ player, playerRef, width, tint, memoryKey }: {
  readonly player: PlayerView;
  readonly playerRef: PlayerRef;
  readonly width: WidthClass;
  readonly tint: string | null;
  readonly memoryKey: string;
}) {
  const [session, update] = usePageSession(memoryKey);
  const main = player.profile.gameLog;
  const rolePitches = main?.category === "pitching";
  const pitching = player.otherLog == null ? rolePitches : (session.pitching ?? rolePitches);
  const log = pitching === rolePitches ? main : player.otherLog;
  const sport = player.sport;
  if (!log) return null;
  const caption = (() => {
    if (log.matchStrip) return "League matches, oldest to newest. Click one to open it.";
    if (!drawsStrip(log)) return null;
    if (sport === "esports") return `bo3 rating per match, last ${log.entries.length}. Click one to open it.`;
    if (log.stripKey === "avgGameScore") return "Game Score by start (50 is an average start). Click one to open it.";
    return `${log.stripLabel} by game this season. Click a game to open it.`;
  })();
  return (
    <DetailSection title={sport === "esports" ? "Recent Matches" : "Game Log"} caption={caption}>
      {player.otherLog ? (
        <div className={styles.controlRow}>
          <SegmentedControl<"batting" | "pitching">
            label="Category"
            value={pitching ? "pitching" : "batting"}
            onChange={(v) => update({ pitching: v === "pitching" })}
            options={[
              { value: "batting", label: "Batting" },
              { value: "pitching", label: "Pitching" },
            ]}
          />
        </div>
      ) : null}
      {log.matchStrip ? <MatchStrip log={log} width={width} /> : drawsStrip(log) ? <GameLogStrip log={log} tint={tint} /> : null}
      <GameLogTable log={log} sport={sport} position={player.bio.positionAbbreviation ?? playerRef.position} width={width} all={session.allGames} onAll={() => update({ allGames: true })} />
    </DetailSection>
  );
}

function GameLogTable({ log, sport, position, width, all, onAll }: {
  readonly log: GameLog;
  readonly sport: Sport;
  readonly position: string | null;
  readonly width: WidthClass;
  readonly all: boolean;
  readonly onAll: () => void;
}) {
  const pitching = log.category === "pitching" || log.stripKey === "avgGameScore";
  const keys = new Set(log.columns.map((c) => c.key));
  const columns = gameLogColumns(sport, position, pitching).filter((c) => atLeast(width, c.from) && (keys.has(c.key) || c.key === "cmpatt"));
  const rows = [...log.entries].reverse().slice(0, all ? log.entries.length : 5);
  return (
    <div className={styles.logTable}>
      <div className={styles.logHead} aria-hidden="true">
        <span className={styles.logGame}>Game</span>
        {columns.map((c) => (
          <span key={c.key} className={styles.cell} style={{ width: `calc(${c.width} * var(--pt))` }}>
            {c.label}
          </span>
        ))}
      </div>
      {rows.map((e) => (
        <GameLogRow key={e.eventID} entry={e} columns={columns} />
      ))}
      {!all && log.entries.length > 5 ? <MoreButton onClick={onAll}>{`All Games (${log.entries.length})`}</MoreButton> : null}
    </div>
  );
}

const WORD: Readonly<Record<string, string>> = { W: "won", L: "lost", D: "drew", T: "tied" };

function GameLogRow({ entry: e, columns }: { readonly entry: GameLogEntry; readonly columns: ReturnType<typeof gameLogColumns> }) {
  const score = scoreText(e);
  // "Oct 25, at Seattle, lost 3 to 20, 287 yards, 2 touchdowns".
  const spoken = [
    profileShort(e.date),
    e.opponent ? `${e.home ? "versus" : "at"} ${e.opponent.name}` : null,
    e.result ? [WORD[e.result] ?? e.result, score?.replace("–", " to ")].filter(Boolean).join(" ") : null,
    ...columns.map((c) => {
      const v = gameLogValue(e.stats, c.key);
      return v === "–" ? `no ${statWord(c.label)}` : `${v} ${statWord(c.label)}`;
    }),
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <Link to={gameHref(e.eventID)} className={rowLinkClass} aria-label={spoken} title={`Open this game: ${entryContext(e)}`}>
      <span className={styles.logRow}>
        <span className={styles.date}>{profileShort(e.date)}</span>
        {e.opponent ? (
          <>
            <TeamCrest team={e.opponent} size={14} />
            <span className={`${styles.logOpponent} ${linkNameClass}`}>{`${e.home ? "vs" : "at"} ${e.opponent.abbreviation ?? e.opponent.name}`}</span>
          </>
        ) : null}
        <span className={styles.spacer} />
        {e.result ? (
          <span className={styles.result} data-draw={e.result === "D"}>
            <strong>{e.result}</strong>
            {score ? ` ${score}` : ""}
          </span>
        ) : null}
        {columns.map((c) => (
          <span key={c.key} className={styles.cell} style={{ width: `calc(${c.width} * var(--pt))` }}>
            {gameLogValue(e.stats, c.key)}
          </span>
        ))}
      </span>
    </Link>
  );
}

// MARK: - Tables

/** A small stat table: a title column, then the preferred columns that exist and fit; the rest join as the block widens. */
export function StatTableView({ table, keys, width, titleWidth = 104 }: { readonly table: StatTable; readonly keys: readonly [string, WidthClass][]; readonly width: WidthClass; readonly titleWidth?: number }) {
  const indices = tableColumnIndices(table.keys, table.columns.length, keys, width);
  return (
    // A list of spoken lines, not an ARIA table: each row is read whole ("2025-26: 71 games, 25.3 points"), so it has no cells.
    <div className={styles.statTable} role="list">
      <div className={styles.statHead} aria-hidden="true">
        <span style={{ minWidth: `calc(${titleWidth} * var(--pt))`, flex: 1 }} />
        {indices.map((i) => (
          <span key={i} className={styles.statCell}>
            {table.columns[i]}
          </span>
        ))}
      </div>
      {table.rows.map((row) => (
        <div
          key={row.title}
          className={styles.statRow}
          role="listitem"
          // "2025-26: 71 games, 25.3 points, 5.2 rebounds", not cell by cell.
          aria-label={`${row.title}: ${indices
            .map((i) => {
              const v = row.values[i] ?? "–";
              return v === "–" || v === "" ? `no ${statWord(table.columns[i] ?? "")}` : `${v} ${statWord(table.columns[i] ?? "")}`;
            })
            .join(", ")}`}
        >
          <span className={styles.statTitle} style={{ minWidth: `calc(${titleWidth} * var(--pt))` }} aria-hidden="true">
            {row.title}
          </span>
          {indices.map((i) => (
            <span key={i} className={styles.statCell} aria-hidden="true">
              {row.values[i] || "–"}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

// MARK: - About

export function AboutGrid({ facts }: { readonly facts: readonly [string, string][] }) {
  return (
    <dl className={styles.about}>
      {facts.map(([label, value]) => (
        <div key={label} className={styles.aboutRow}>
          <dt className={styles.aboutLabel}>{label}</dt>
          <dd className={styles.aboutValue}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// MARK: - Note, career, awards

/** RotoWire's latest: the headline, three lines of the story (a click shows the rest), when it was published. */
export function NoteView({ note }: { readonly note: Note }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={styles.note}>
      <p className={styles.noteHeadline}>{note.headline}</p>
      {note.story ? (
        <button type="button" className={styles.noteStory} data-expanded={expanded} aria-expanded={expanded} onClick={() => setExpanded((x) => !x)} title={expanded ? "Show less" : "Show the whole story"}>
          {note.story}
        </button>
      ) : null}
      {note.published != null ? <p className={styles.noteDate}>{dayAndTime(note.published, Date.now())}</p> : null}
    </div>
  );
}

/** Career by season, when asked for (it's one more request): three seasons, then all. */
export function CareerSection({ player, sport, position, width, memoryKey }: {
  readonly player: PlayerView;
  readonly sport: Sport;
  readonly position: string | null;
  readonly width: WidthClass;
  readonly memoryKey: string;
}) {
  const [session, update] = usePageSession(memoryKey);
  const table = player.career.table;
  if (!session.career) return <MoreButton onClick={() => update({ career: true })}>Show Career</MoreButton>;
  if (table) {
    const shown = session.expanded.includes("career");
    return (
      <div>
        <StatTableView table={{ ...table, rows: shown ? table.rows : table.rows.slice(0, 3) }} keys={careerColumns(sport, position)} width={width} />
        {!shown && table.rows.length > 3 ? <MoreButton onClick={() => update((s) => ({ expanded: [...s.expanded, "career"] }))}>{`All ${table.rows.length} Seasons`}</MoreButton> : null}
      </div>
    );
  }
  if (player.career.failed) return <p className={styles.inlineNote}>Couldn't load the career.</p>;
  return (
    <div className={styles.loadingRow} role="status" aria-label="Loading career">
      <span className={styles.spinner} />
    </div>
  );
}

/** Wrapping capsules ("4× Finals MVP"): four, then all. */
export function FlowChips({ items }: { readonly items: readonly string[] }) {
  const [all, setAll] = useState(false);
  return (
    <div>
      <ul className={styles.chips}>
        {(all ? items : items.slice(0, 4)).map((item) => (
          <li key={item} className={styles.awardChip}>
            {item}
          </li>
        ))}
      </ul>
      {!all && items.length > 4 ? <MoreButton onClick={() => setAll(true)}>{`All Awards (${items.length})`}</MoreButton> : null}
    </div>
  );
}

// MARK: - Climbing

const MEDALS = [
  ["gold", "#d6b038"],
  ["silver", "#b3b8bf"],
  ["bronze", "#bd7845"],
] as const;

export function PodiumRows({ podiums, championships }: { readonly podiums: readonly Podium[]; readonly championships: readonly Podium[] }) {
  const row = (p: Podium) => (
    <div key={p.discipline} className={styles.podiumRow} role="group" aria-label={`${p.discipline}: ${p.gold} gold, ${p.silver} silver, ${p.bronze} bronze`}>
      <span className={styles.podiumName} aria-hidden="true">
        {p.discipline}
      </span>
      {MEDALS.map(([name, color]) => {
        const n = p[name];
        return (
          <span key={name} className={styles.medal} title={`${n} ${name}`} aria-hidden="true" data-zero={n === 0}>
            <span className={styles.medalDot} style={{ background: color }} />
            {n}
          </span>
        );
      })}
      <span className={styles.podiumTotal} aria-hidden="true">
        {podiumTotal(p)}
      </span>
    </div>
  );
  return (
    <div className={styles.podiums}>
      {podiums.map(row)}
      {championships.length > 0 ? (
        <>
          <GroupHeader title="World Championships" />
          {championships.map(row)}
        </>
      ) : null}
    </div>
  );
}

export function ClimbResultRows({ results, count, memoryKey }: { readonly results: readonly ClimbResult[]; readonly count: number; readonly memoryKey: string }) {
  const [session, update] = usePageSession(memoryKey);
  const all = session.expanded.includes("results");
  const shown = all ? results : results.slice(0, 12);
  const seasons = [...new Set(shown.map((r) => r.season))];
  return (
    <div>
      {seasons.map((season, k) => (
        <div key={season}>
          <GroupHeader title={season} first={k === 0} />
          {shown
            .filter((r) => r.season === season)
            .map((r) => (
              <div key={`${r.season}|${r.event}|${r.discipline}|${r.category ?? ""}`} className={styles.climbRow}>
                <span className={styles.climbRank} data-podium={(r.rank ?? 99) <= 3}>
                  {r.rank ?? "–"}
                </span>
                <span className={styles.climbEvent}>{r.event}</span>
                <span className={styles.climbDiscipline}>{r.discipline}</span>
                <span className={styles.spacer} />
                <span className={styles.date}>{r.date != null ? profileShort(r.date) : ""}</span>
              </div>
            ))}
        </div>
      ))}
      {!all && results.length > 12 ? <MoreButton onClick={() => update((s) => ({ expanded: [...s.expanded, "results"] }))}>{`All Results (${count})`}</MoreButton> : null}
    </div>
  );
}
