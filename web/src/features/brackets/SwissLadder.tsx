/**
 * The Swiss stage as a ladder (Brackets.swift `SwissLadder`): each team's
 * result every round (filled won, outlined lost, faint still to play), its
 * record, and whether it went through. From large, each round also shows who
 * it was against. Best record first; the record-and-outcome column is as
 * wide as its widest entry in every row, so the round chips line up and the
 * team names give way, never the outcome.
 */
import { memo, useMemo } from "react";
import { TeamLogo } from "../../design/components";
import { spokenSwissRow, swissLosses, swissOrder, swissOutcome, swissWins, type BracketTeam, type SwissRow, type SwissStage } from "../../data/brackets";
import { atLeast, type WidthClass } from "../../data/standings";
import styles from "./Brackets.module.css";

export const SwissLadder = memo(function SwissLadder({ stage, ring, width }: { stage: SwissStage; ring: ReadonlySet<string>; width: WidthClass }) {
  const rows = useMemo(() => swissOrder(stage), [stage]);
  const opponents = atLeast(width, "large") && stage.rows.some((r) => r.opponents.some(Boolean));
  const rounds = Array.from({ length: stage.rounds }, (_, i) => i + 1);
  // The widest outcome sets the column ("3–1 Through").
  const outcomes = rows.map((r) => swissOutcome(r, stage));
  const statusWidth = outcomes.includes("Through") ? 74 : outcomes.includes("Out") ? 56 : 34;
  const round = opponents ? 34 : 16;
  return (
    <div className={styles.ladder}>
      <div className={styles.ladderHead} aria-hidden="true">
        <span className={styles.ladderTeam}>Team</span>
        {rounds.map((n) => (
          <span key={n} className={styles.roundHead} style={{ width: `calc(${round} * var(--pt))` }}>
            R{n}
          </span>
        ))}
        <span style={{ width: `calc(${statusWidth} * var(--pt))` }} />
      </div>
      {rows.map((row) => (
        <LadderRow key={row.team.id} row={row} stage={stage} mine={ring.has(row.team.id)} opponents={opponents} round={round} statusWidth={statusWidth} />
      ))}
      <div className={styles.ladderLegend} aria-hidden="true">
        <span className={styles.legendItem}>
          <Chip result={true} />
          Won
        </span>
        <span className={styles.legendItem}>
          <Chip result={false} />
          Lost
        </span>
        <span className={styles.legendItem}>
          <Chip result={null} />
          To play
        </span>
      </div>
    </div>
  );
});

const LadderRow = memo(function LadderRow({ row, stage, mine, opponents, round, statusWidth }: { row: SwissRow; stage: SwissStage; mine: boolean; opponents: boolean; round: number; statusWidth: number }) {
  const outcome = swissOutcome(row, stage);
  return (
    <div className={styles.ladderRow} data-mine={mine} role="group" aria-label={spokenSwissRow(row, stage, opponents)} tabIndex={-1}>
      <span className={styles.ladderTeam}>
        <TeamLogo url={row.team.logo} size={14} />
        <span className={styles.ladderName} data-mine={mine}>
          {row.team.name}
        </span>
      </span>
      {row.results.map((result, i) => (
        <span key={i} className={styles.roundCell} style={{ width: `calc(${round} * var(--pt))` }} title={roundHelp(i, result, row.opponents[i] ?? null)} aria-hidden="true">
          <Chip result={result} />
          {opponents ? (
            <span className={styles.opponent} data-pending={result == null}>
              {row.opponents[i] ? <TeamLogo url={row.opponents[i]!.logo} size={14} /> : null}
            </span>
          ) : null}
        </span>
      ))}
      <span className={styles.status} style={{ width: `calc(${statusWidth} * var(--pt))` }} aria-hidden="true">
        <span className={styles.record} data-out={outcome === "Out"}>
          {swissWins(row)}–{swissLosses(row)}
        </span>
        {outcome ? (
          <span className={outcome === "Through" ? styles.through : styles.out}>{outcome}</span>
        ) : null}
      </span>
    </div>
  );
});

function roundHelp(index: number, result: boolean | null, team: BracketTeam | null): string {
  if (!team) return `Round ${index + 1}`;
  return `Round ${index + 1}: ${result === true ? `beat ${team.name}` : result === false ? `lost to ${team.name}` : `plays ${team.name}`}`;
}

/** Filled: won. Outlined: lost. Faint: still to play. */
function Chip({ result }: { result: boolean | null }) {
  return <span className={styles.chip} data-result={result == null ? "pending" : result ? "won" : "lost"} />;
}
