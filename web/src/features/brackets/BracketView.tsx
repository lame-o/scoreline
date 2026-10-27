/**
 * The tree (Brackets.swift `BracketView`, `BracketCell`): round names over
 * their columns, connector lines from each matchup to the one its winner
 * plays in (a decided matchup's line drawn stronger: the winner's path), and
 * a readout of the pointed-at matchup underneath, in place of the legend.
 * Columns share the width up to 180pt each; past that the tree and its
 * footer center as a unit. Cells from 120pt show team names instead of
 * abbreviations. Below 96pt (a 32-team bracket on a phone) the tree keeps
 * that width and scrolls sideways, opening on the round being played.
 *
 * Every matchup is its own focusable element, in reading order (round by
 * round, top to bottom), labeled in words. The geometry is worked out once
 * per bracket, never on a hover: a hover re-renders the two cells it lights
 * and the footer, never the tree or its lines.
 */
import { memo, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { LiveDot, TeamLogo } from "../../design/components";
import { useWidth } from "../../design/useWidth";
import {
  BRACKET,
  bracketLayout,
  cellWidth,
  focusColumn,
  isRinged,
  maxTreeWidth,
  readingOrder,
  readout,
  spokenBracket,
  spokenMatch,
  treeWidth,
  type Bracket,
  type BracketLayout,
  type BracketMatch,
  type BracketSide,
  type BracketTeam,
} from "../../data/brackets";
import styles from "./Brackets.module.css";

const px = (n: number) => `calc(${n} * var(--pt))`;

export function BracketView({ bracket, ring }: { bracket: Bracket; ring: ReadonlySet<string> }) {
  const frame = useRef<HTMLDivElement>(null);
  const width = useWidth(frame);
  const layout = useMemo(() => bracketLayout(bracket), [bracket]);
  const order = useMemo(() => readingOrder(layout), [layout]);
  const [hovered, setHovered] = useState<string | null>(null);
  const rounds = bracket.rounds.length;
  const fitted = cellWidth(width, rounds);
  const scrolls = fitted < BRACKET.minCell;
  const cell = scrolls ? BRACKET.minCell : fitted;
  const names = cell >= BRACKET.namesFrom;
  const anyRinged = useMemo(() => Object.values(bracket.matches).some((m) => isRinged(m, ring)), [bracket, ring]);
  const scroller = useRef<HTMLDivElement>(null);

  // A scrolled tree opens on the round being played (once per bracket).
  const opened = useRef<Bracket | null>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!scrolls || !el || opened.current === bracket) return;
    opened.current = bracket;
    // Centered on that round's column (whole at either end), instantly: arriving never animates a scroll.
    const column = focusColumn(bracket, layout);
    // Points to pixels (1pt is a 13th of the root size).
    const point = parseFloat(getComputedStyle(document.documentElement).fontSize) / 13 || 1;
    const center = (column * (cell + BRACKET.gap) + cell / 2) * point;
    el.scrollLeft = Math.max(0, Math.min(center - el.clientWidth / 2 + parseFloat(getComputedStyle(el).paddingLeft), el.scrollWidth - el.clientWidth));
  }, [scrolls, bracket, layout, cell]);

  const hoveredMatch = hovered ? bracket.matches[hovered] : undefined;
  const tree = (
    <div className={styles.tree} style={{ width: px(treeWidth(cell, rounds)), height: px(BRACKET.header + layout.height) }}>
      {bracket.rounds.map((name, i) => (
        <span key={i} className={styles.roundName} style={{ width: px(cell), transform: `translateX(${px(i * (cell + BRACKET.gap))})` }} aria-hidden="true">
          {name}
        </span>
      ))}
      <Connectors bracket={bracket} layout={layout} cell={cell} />
      {order.map((id) => {
        const match = bracket.matches[id];
        const slot = layout.slots[id];
        if (!match || !slot) return null;
        return (
          <BracketCell
            key={id}
            match={match}
            round={bracket.rounds[slot.column] ?? ""}
            ringed={isRinged(match, ring)}
            hovered={hovered === id}
            names={names}
            width={cell}
            x={slot.column * (cell + BRACKET.gap)}
            y={BRACKET.header + slot.center - BRACKET.cellHeight / 2}
            onHover={setHovered}
          />
        );
      })}
    </div>
  );

  return (
    <div className={styles.bracket} style={{ maxWidth: px(maxTreeWidth(rounds)) }} role="group" aria-label={spokenBracket(bracket)}>
      <div ref={frame} className={styles.frame}>
        {scrolls ? (
          <div ref={scroller} className={styles.scroller}>
            {tree}
          </div>
        ) : (
          tree
        )}
      </div>
      <Footer readout={hoveredMatch ? readout(hoveredMatch) : null} ringed={anyRinged} />
      {bracket.extra.map(({ title, match }) => (
        <div key={match.id} className={styles.extra}>
          <span className={styles.extraTitle}>{title}</span>
          {/* Names when the tree shows them, so the two read alike. */}
          <BracketCell match={match} round={title} ringed={isRinged(match, ring)} hovered={hovered === match.id} names={names} width={150} onHover={setHovered} />
        </div>
      ))}
    </div>
  );
}

/** The lines, drawn once per bracket and width: hovering never redraws them. */
const Connectors = memo(function Connectors({ bracket, layout, cell }: { bracket: Bracket; layout: BracketLayout; cell: number }) {
  const paths: { d: string; decided: boolean }[] = [];
  const x = (column: number) => column * (cell + BRACKET.gap);
  for (const [id, slot] of Object.entries(layout.slots)) {
    const match = bracket.matches[id];
    if (!match) continue;
    for (const feeder of match.feeders) {
      const from = layout.slots[feeder];
      const feederMatch = bracket.matches[feeder];
      if (!from || !feederMatch) continue;
      const sx = x(from.column) + cell;
      const sy = BRACKET.header + from.center;
      const ex = x(slot.column);
      const ey = BRACKET.header + slot.center;
      const mid = sx + BRACKET.gap / 2;
      // A decided matchup's line carries its winner forward.
      paths.push({ d: `M${sx} ${sy}H${mid}V${ey}H${ex}`, decided: feederMatch.winner != null });
    }
  }
  const w = treeWidth(cell, bracket.rounds.length);
  const h = BRACKET.header + layout.height;
  return (
    <svg className={styles.lines} viewBox={`0 0 ${w} ${h}`} style={{ width: px(w), height: px(h) }} aria-hidden="true" focusable="false">
      {paths.map((p, i) => (
        <path key={i} d={p.d} className={p.decided ? styles.path : styles.line} />
      ))}
    </svg>
  );
});

/** One matchup: two rows (crest, short name, maps or games won), the winner in full weight, the loser stepping back, a live one marked. */
const BracketCell = memo(function BracketCell({
  match,
  round,
  ringed,
  hovered,
  names,
  width,
  x,
  y,
  onHover,
}: {
  match: BracketMatch;
  round: string;
  ringed: boolean;
  hovered: boolean;
  names: boolean;
  /** Points. With `x` and `y`, placed in the tree; without, in the flow (a 3rd-place match). */
  width: number;
  x?: number;
  y?: number;
  onHover: (id: string | null) => void;
}) {
  const style: CSSProperties =
    x != null && y != null
      ? { width: px(width), height: px(BRACKET.cellHeight), transform: `translate(${px(x)}, ${px(y)})` }
      : { position: "relative", width: px(width), height: px(BRACKET.cellHeight) };
  return (
    <div
      className={styles.cell}
      style={style}
      data-ringed={ringed}
      data-hovered={hovered}
      tabIndex={0}
      role="group"
      aria-label={spokenMatch(match, round)}
      onPointerEnter={() => onHover(match.id)}
      onPointerLeave={() => onHover(null)}
      onFocus={() => onHover(match.id)}
      onBlur={() => onHover(null)}
    >
      <Side team={match.top} score={match.topScore} side="top" winner={match.winner} names={names} />
      <span className={styles.divider} />
      <Side team={match.bottom} score={match.bottomScore} side="bottom" winner={match.winner} names={names} />
      {match.live ? (
        <span className={styles.live}>
          <LiveDot />
        </span>
      ) : null}
    </div>
  );
});

function Side({ team, score, side, winner, names }: { team: BracketTeam | null; score: number | null; side: BracketSide; winner: BracketSide | null; names: boolean }) {
  const won = winner === side;
  const lost = winner != null && !won;
  return (
    <span className={styles.side} data-won={won} data-lost={lost} data-tbd={team == null} title={team?.name}>
      {team ? <TeamLogo url={team.logo} size={12} /> : <span className={styles.placeholder} />}
      <span className={styles.team}>{(names ? team?.name : team?.abbreviation) ?? "TBD"}</span>
      {score != null ? <span className={styles.score}>{score}</span> : null}
    </span>
  );
}

/** The pointed-at matchup, else the legend (which keeps its space). */
function Footer({ readout, ringed }: { readout: { lead: string; detail: string } | null; ringed: boolean }) {
  return (
    <div className={styles.footer}>
      <div className={styles.legend} data-hidden={readout != null} aria-hidden={readout != null}>
        {ringed ? (
          <span className={styles.legendItem}>
            <span className={styles.ringSwatch} />
            This matchup
          </span>
        ) : null}
        <span className={styles.legendItem}>
          <span className={styles.pathSwatch} />
          Winner's path
        </span>
      </div>
      {readout ? (
        <p className={styles.readout}>
          <span className={styles.readoutLead}>{readout.lead}</span>
          {readout.detail ? <span className={styles.readoutDetail}>{readout.detail}</span> : null}
        </p>
      ) : null}
    </div>
  );
}
