/**
 * The NBA page's people (BasketballViews.swift `LeadersView`,
 * `BoxScoreView`, `InjuryReport`):
 *
 * - Leaders: points, rebounds and assists, each team's leader face to face,
 *   top team left, the higher number in full ink.
 * - Box score: one team at a time (starters, the bench by minutes, the
 *   team's line, then who hasn't played in one line); team highs in
 *   semibold; live, a dot marks the five on court. Wider layouts add columns
 *   (FG and 3PT, then FT, STL and BLK, then TO and PF).
 * - Injury report: ESPN's current report, team by team.
 *
 * Pointing at a player lights their shots on the court; a click anywhere on
 * their row picks them for the court (again to clear); a click on the name
 * opens their page. A flame marks a player on fire (4+ straight makes, live).
 */
import { memo, useMemo, useRef, useState } from "react";
import { SegmentedControl, Icon, TeamLogo } from "../../../design/components";
import { boxColumnsFor, FIRE_STREAK, injuryDetail, lastName, notPlayed, played, signed, spokenBoxLine, type BoxColumn, type BoxPlayer, type Injury, type LeaderLine } from "../../../data/basketball";
import type { Competitor, Side } from "../../../data/models";
import { widthClassOf } from "../../../data/standings";
import { espnPhoto } from "../../../data/profiles/photos";
import { useWidth } from "../../../design/useWidth";
import { PlayerLink, TeamLink, teamRefFrom, type PlayerRef } from "../../profiles/ProfileLinks";
import { PlayerPhoto } from "../../profiles/PlayerPhoto";
import { useFocus, useLinkedRow } from "../core/linked";
import { useStage, useStageStore } from "./stage";
import styles from "./Players.module.css";

type RefOf = (id: string, name: string) => PlayerRef | null;

function Flame({ streak }: { streak: number }) {
  if (streak < FIRE_STREAK) return null;
  return (
    <span className={styles.flame} title={`${streak} straight makes`}>
      <Icon name="flame" size={8} label={`${streak} straight makes`} />
    </span>
  );
}

/** A name that keeps the surname before anything truncates ("C. Cunningham", else "Cunningham"). */
function PlayerName({ name }: { name: string }) {
  const short = lastName(name);
  return short === name ? (
    <span className={styles.nameText}>{name}</span>
  ) : (
    <>
      <span className={styles.nameFull}>{name}</span>
      <span className={styles.nameShort}>{short}</span>
    </>
  );
}

// MARK: - Leaders

export const Leaders = memo(function Leaders({ lines, streaks, playerRef, path }: { lines: readonly LeaderLine[]; streaks: Readonly<Record<string, number>>; playerRef: RefOf; path: string }) {
  return (
    <ul className={styles.leaders}>
      {lines.map((line) => (
        <li key={line.category} className={styles.leaderLine} aria-label={`${line.category}: ${[line.top, line.bottom].flatMap((l) => (l ? [`${l.name} ${l.value}${(streaks[l.player ?? ""] ?? 0) >= FIRE_STREAK ? `, ${streaks[l.player!]} straight makes` : ""}`] : [])).join(", ")}`}>
          <LeaderCell leader={line.top} other={line.bottom} trailing={false} streaks={streaks} playerRef={playerRef} path={path} />
          <span className={styles.category} aria-hidden="true">
            {line.category}
          </span>
          <LeaderCell leader={line.bottom} other={line.top} trailing streaks={streaks} playerRef={playerRef} path={path} />
        </li>
      ))}
    </ul>
  );
});

function LeaderCell({ leader, other, trailing, streaks, playerRef, path }: { leader: LeaderLine["top"]; other: LeaderLine["top"]; trailing: boolean; streaks: Readonly<Record<string, number>>; playerRef: RefOf; path: string }) {
  const stage = useStageStore();
  const id = leader?.player ?? null;
  const picked = useStage(stage, (s) => id != null && s.pinned === id);
  const focus = useMemo(() => ({ player: id ?? undefined }), [id]);
  const row = useLinkedRow(focus);
  const lit = useFocus((f) => id != null && f?.player === id);
  if (!leader) return <span className={styles.leaderEmpty} data-trailing={trailing}>–</span>;
  const leads = (Number(leader.value) || 0) >= (Number(other?.value) || 0);
  const photo = leader.player ? espnPhoto(path, leader.player, "small") : leader.headshot;
  return (
    <div className={styles.leader} data-trailing={trailing} data-picked={picked} data-lit={lit} onPointerEnter={row.onPointerEnter} onPointerLeave={row.onPointerLeave}>
      <button
        type="button"
        className={styles.pick}
        onClick={() => stage?.togglePin(id)}
        aria-pressed={picked}
        aria-label={picked ? "Show every player on the court" : `Show only ${leader.name}'s shots on the court`}
        title={picked ? "Show every player on the court" : `Show only ${leader.name}'s shots on the court`}
      />
      <PlayerPhoto url={photo} name={leader.name} tint={null} size={28} className={styles.headshot} />
      <span className={styles.who}>
        <span className={styles.leaderName}>
          <PlayerLink player={leader.player ? playerRef(leader.player, leader.name) : null} className={styles.link}>
            <PlayerName name={leader.name} />
          </PlayerLink>
          <Flame streak={streaks[leader.player ?? ""] ?? 0} />
        </span>
        {leader.detail ? <span className={styles.leaderDetail}>{leader.detail}</span> : null}
      </span>
      <span className={styles.value} data-leads={leads}>
        {leader.value}
      </span>
    </div>
  );
}

// MARK: - Box score

/** Stats with a team high to set in semibold. */
const RANKED = new Set(["PTS", "REB", "AST", "STL", "BLK"]);
const HIGHLIGHT = new Set(["PTS", "REB", "AST"]);

export const BoxScore = memo(function BoxScore({
  top,
  bottom,
  topName,
  bottomName,
  topTotals,
  bottomTotals,
  live,
  initial,
  streaks,
  playerRef,
}: {
  top: readonly BoxPlayer[];
  bottom: readonly BoxPlayer[];
  topName: string;
  bottomName: string;
  topTotals: Readonly<Record<string, string>>;
  bottomTotals: Readonly<Record<string, string>>;
  live: boolean;
  initial: Side;
  streaks: Readonly<Record<string, number>>;
  playerRef: RefOf;
}) {
  const [selection, setSelection] = useState<Side>(initial);
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box, 340);
  const columns = boxColumnsFor(widthClassOf(width));
  const players = selection === "top" ? top : bottom;
  const playedList = players.filter(played);
  // Just after tip-off ESPN may not have flagged the starters yet.
  const starters = playedList.filter((p) => p.starter);
  const bench = playedList.filter((p) => !p.starter);
  // Nor is "on court" right until five are marked.
  const floor = live && playedList.filter((p) => p.onCourt).length === 5;
  const out = players.filter((p) => !played(p));
  const highs: Record<string, number> = {};
  for (const label of RANKED) highs[label] = Math.max(0, ...playedList.map((p) => Number.parseInt(p.stats[label] ?? "", 10) || 0));
  const totals = selection === "top" ? topTotals : bottomTotals;
  const grid = { gridTemplateColumns: `minmax(0, 1fr) ${columns.map((c) => `calc(${c.width} * var(--pt))`).join(" ")}` };
  return (
    <div ref={box} className={styles.box}>
      <SegmentedControl
        label="Team"
        value={selection}
        options={[
          { value: "top", label: topName },
          { value: "bottom", label: bottomName },
        ]}
        onChange={(v) => setSelection(v)}
        className={styles.teamSwitch}
      />
      <div className={styles.table} role="list" aria-label={`${selection === "top" ? topName : bottomName} box score`}>
        <div className={styles.header} style={grid} aria-hidden="true">
          <span>Player</span>
          {columns.map((c) => (
            <span key={c.label} title={c.help}>
              {c.label}
            </span>
          ))}
        </div>
        {starters.map((p) => (
          <BoxRow key={p.id} p={p} columns={columns} grid={grid} highs={highs} floor={floor} live={live} streak={live ? (streaks[p.id] ?? 0) : 0} playerRef={playerRef} />
        ))}
        {bench.length > 0 && starters.length > 0 ? (
          <h3 className={styles.bench} role="listitem">
            Bench
          </h3>
        ) : null}
        {bench.map((p) => (
          <BoxRow key={p.id} p={p} columns={columns} grid={grid} highs={highs} floor={floor} live={live} streak={live ? (streaks[p.id] ?? 0) : 0} playerRef={playerRef} />
        ))}
        {Object.keys(totals).length > 0 && playedList.length > 0 ? (
          <div className={styles.totals} style={grid} role="listitem" aria-label={`Team: ${spokenBoxLine(totals, columns.filter((c) => c.label !== "MIN" && c.label !== "+/-"))}`}>
            <span aria-hidden="true">Team</span>
            {columns.map((c) => (
              <span key={c.label} aria-hidden="true">
                {c.label === "MIN" || c.label === "+/-" ? "" : (totals[c.label] ?? "–")}
              </span>
            ))}
          </div>
        ) : null}
        {out.length > 0 ? (
          <p className={styles.dnp} role="listitem">
            {notPlayed(out, live)}
          </p>
        ) : null}
      </div>
    </div>
  );
});

function BoxRow({ p, columns, grid, highs, floor, live, streak, playerRef }: { p: BoxPlayer; columns: readonly BoxColumn[]; grid: React.CSSProperties; highs: Record<string, number>; floor: boolean; live: boolean; streak: number; playerRef: RefOf }) {
  const stage = useStageStore();
  const picked = useStage(stage, (s) => s.pinned === p.id);
  const focus = useMemo(() => ({ player: p.id }), [p.id]);
  const row = useLinkedRow(focus);
  const lit = useFocus((f) => f?.player === p.id);
  const onCourt = floor && p.onCourt;
  const onFire = streak >= FIRE_STREAK;
  const spoken = `${p.name}${onCourt ? ", on court" : ""}${onFire ? `, ${streak} straight makes` : ""}: ${p.stats.MIN ?? "0"} minutes, ${spokenBoxLine(p.stats, columns.filter((c) => c.label !== "MIN"))}`;
  return (
    <div className={styles.row} style={grid} data-picked={picked} data-lit={lit} role="listitem" onPointerEnter={row.onPointerEnter} onPointerLeave={row.onPointerLeave}>
      <button type="button" className={styles.pick} onClick={() => stage?.togglePin(p.id)} aria-pressed={picked} aria-label={spoken} title={picked ? "Show every player on the court" : `Show only ${p.name}'s shots on the court`} />
      <span className={styles.player}>
        {live ? <span className={styles.court} data-on={onCourt} title={onCourt ? "On court" : undefined} /> : null}
        <PlayerLink player={playerRef(p.id, p.name)} className={styles.link}>
          <PlayerName name={p.name} />
        </PlayerLink>
        <Flame streak={streak} />
      </span>
      {columns.map((c) => {
        const text = p.stats[c.label] ?? "";
        if (c.label === "MIN") return <span key={c.label} className={styles.quiet} aria-hidden="true">{text}</span>;
        if (c.label === "+/-") return <span key={c.label} className={styles.quiet} aria-hidden="true">{signed(text)}</span>;
        if (RANKED.has(c.label)) {
          const value = Number.parseInt(text, 10) || 0;
          const high = highs[c.label] ?? 0;
          return (
            <span key={c.label} aria-hidden="true" data-high={HIGHLIGHT.has(c.label) && value === high && high > 0}>
              {value}
            </span>
          );
        }
        return <span key={c.label} aria-hidden="true">{text || "–"}</span>;
      })}
    </div>
  );
}

// MARK: - Injuries

export const InjuryReport = memo(function InjuryReport({ injuries, top, bottom, leagueID, playerRef }: { injuries: readonly Injury[]; top: Competitor | null; bottom: Competitor | null; leagueID: string | null; playerRef: RefOf }) {
  return (
    <div className={styles.injuries}>
      {(["top", "bottom"] as const).map((side) => {
        const team = side === "top" ? top : bottom;
        const list = injuries.filter((i) => i.side === side);
        return (
          <div key={side} className={styles.injuryGroup}>
            <h3 className={styles.injuryTeam}>
              {team ? <TeamLogo url={team.logo} size={14} /> : null}
              {team ? <TeamLink team={teamRefFrom(team, leagueID)}>{team.name}</TeamLink> : null}
            </h3>
            {list.length === 0 ? <p className={styles.injuryNone}>No injuries reported.</p> : null}
            <ul>
              {list.map((i) => {
                const detail = injuryDetail(i);
                const out = i.status.startsWith("Out");
                return (
                  <li key={i.id} className={styles.injury}>
                    <span className={styles.injuryWho}>
                      <PlayerLink player={playerRef(i.id, i.name)} className={styles.injuryName}>
                        {i.name}
                      </PlayerLink>
                      {detail ? <span className={styles.injuryDetail}>{detail}</span> : null}
                    </span>
                    <span className={styles.injuryStatus} data-out={out}>
                      {i.status}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
});
