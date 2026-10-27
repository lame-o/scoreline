/**
 * The sections every ESPN sport shares (Visualizations.swift `LinescoreGrid`,
 * `WinProbability`, `MomentList`; DetailView.swift's latest plays, where to
 * watch and the series link). Sport pages render them with their own titles
 * and captions; each takes part in linked focus where the Mac's does.
 *
 * - `LinescoreGrid`: runs (or points) per period, then the totals. When every
 *   period fits, the columns spread across the section; when they don't
 *   (extra innings, overtimes) the periods scroll between the names and the
 *   totals, which stay put, starting at the latest period, where the game is.
 *   Each period's cell is a hover target that lights its plays (and balls).
 * - `WinProbability`: one bar, a 50% tick, and the draw (soccer) as its own segment.
 * - `MomentList`: scoring plays or key events, newest first: time, what
 *   happened, the team's crest, the score after it. Rows pin on click.
 */
import { memo, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router";
import { Icon, TeamLogo } from "../../../design/components";
import type { Broadcaster } from "../../../data/broadcasters";
import { ordinal, plural } from "../../../data/format";
import type { DetailMoment, Linescore, Stat } from "../../../data/gameDetail";
import { shortened } from "../../../data/moments";
import type { Competitor, Side } from "../../../data/models";
import { NEUTRAL, type TeamPalette } from "../../../data/teamColors";
import { matches, useFocus, useLinkedRow, useLinkedStore, type Focus } from "./linked";
import styles from "./CommonSections.module.css";

const mark = (color: string): CSSProperties => ({ background: color === NEUTRAL ? "var(--viz-neutral)" : color });

// MARK: - Line score

const HEADER_HELP: Readonly<Record<string, string>> = { R: "Runs", H: "Hits", E: "Errors", T: "Total", OT: "Overtime" };

export interface LinescoreProps {
  readonly linescore: Linescore;
  readonly topName: string;
  readonly bottomName: string;
  /** Columns at the end rendered bold (totals): 3 for baseball (R, H, E), else 1. */
  readonly totals: number;
  readonly palette: TeamPalette;
  readonly spokenTop: string;
  readonly spokenBottom: string;
}

export const LinescoreGrid = memo(function LinescoreGrid({ linescore, topName, bottomName, totals, palette, spokenTop, spokenBottom }: LinescoreProps) {
  const split = Math.max(linescore.headers.length - totals, 0);
  const periods = linescore.headers.slice(0, split);
  const totalHeaders = linescore.headers.slice(split);
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ leading: false, trailing: false });

  // Start at the latest period; the fades say "more this way", changing only as an edge is reached or left.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollLeft = el.scrollWidth;
    const read = () => {
      const next = { leading: el.scrollLeft > 1, trailing: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 };
      setEdges((e) => (e.leading === next.leading && e.trailing === next.trailing ? e : next));
    };
    read();
    el.addEventListener("scroll", read, { passive: true });
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", read);
      observer.disconnect();
    };
  }, [periods.length]);

  const rows: { side: Side; name: string; values: readonly string[]; color: string }[] = [
    { side: "top", name: topName, values: linescore.top, color: palette.top },
    { side: "bottom", name: bottomName, values: linescore.bottom, color: palette.bottom },
  ];
  return (
    <div className={styles.linescore} role="img" aria-label={spokenLinescore(linescore, totals, spokenTop, spokenBottom)}>
      <div className={styles.lsNames} aria-hidden="true">
        <span className={styles.lsHead} />
        {rows.map((r) => (
          <span key={r.side} className={styles.lsName}>
            <span className={styles.teamDot} style={mark(r.color)} />
            <span>{r.name}</span>
          </span>
        ))}
      </div>
      <div ref={scroller} className={styles.lsScroller} data-leading={edges.leading} data-trailing={edges.trailing} aria-hidden="true">
        <div className={styles.lsPeriods} style={{ gridTemplateColumns: `repeat(${periods.length}, minmax(calc(20 * var(--pt)), 1fr))` }}>
          {periods.map((h, i) => (
            <span key={`h${i}`} className={styles.lsHead} title={HEADER_HELP[h] ?? (Number.isFinite(Number(h)) ? `Period ${h}` : h)} style={{ paddingLeft: Number.isFinite(Number(h)) ? undefined : "calc(5 * var(--pt))" }}>
              {h}
            </span>
          ))}
          {rows.map((r) => periods.map((_, i) => <PeriodCell key={`${r.side}${i}`} value={r.values[i] ?? ""} period={i + 1} side={r.side} />))}
        </div>
      </div>
      <div className={styles.lsTotals} style={{ gridTemplateColumns: `repeat(${totalHeaders.length}, minmax(calc(20 * var(--pt)), auto))` }} aria-hidden="true">
        {totalHeaders.map((h) => (
          <span key={h} className={styles.lsHead} title={HEADER_HELP[h] ?? h}>
            {h}
          </span>
        ))}
        {rows.map((r) => totalHeaders.map((h, i) => (
          <span key={`${r.side}${h}`} className={styles.lsTotal}>
            {r.values[split + i] ?? ""}
          </span>
        )))}
      </div>
    </div>
  );
});

/** One inning's cell: reads the focus itself, so a hover re-renders one cell, not the grid. */
function PeriodCell({ value, period, side }: { value: string; period: number; side: Side }) {
  const store = useLinkedStore();
  const lit = useFocus((f) => f != null && f.period === period && (f.side == null || f.side === side));
  const focus: Focus = { period, side };
  return (
    <span
      className={styles.lsCell}
      data-lit={lit}
      onPointerEnter={(e) => e.pointerType === "mouse" && store?.hover(focus, true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && store?.hover(focus, false)}
    >
      {value}
    </span>
  );
}

/**
 * "Yankees: 5 runs, 9 hits, 1 error. By inning: 0, 2, 0, 1." Totals first:
 * that's the question. (LinescoreGrid.spoken)
 */
export function spokenLinescore(line: Linescore, totals: number, top: string, bottom: string): string {
  const split = Math.max(line.headers.length - totals, 0);
  const innings = line.headers.includes("R");
  const side = (name: string, values: readonly string[]) => {
    const sums = line.headers.slice(split).map((header, i) => {
      const n = Number(values[split + i]) || 0;
      switch (header) {
        case "R":
          return plural(n, "run");
        case "H":
          return plural(n, "hit");
        case "E":
          return plural(n, "error");
        default:
          return plural(n, "point");
      }
    });
    const periods = line.headers.slice(0, split).flatMap((header, i) => {
      const value = values[i];
      if (!value) return [];
      if (Number.isFinite(Number(header))) return [value];
      const extra = header === "OT" ? "overtime" : header.endsWith("OT") ? `overtime ${header.slice(0, -2)}` : header;
      return [`${extra} ${value}`];
    });
    return `${name}: ${sums.join(", ")}.` + (periods.length ? ` By ${innings ? "inning" : "period"}: ${periods.join(", ")}.` : "");
  };
  return `${side(top, line.top)} ${side(bottom, line.bottom)}`;
}

// MARK: - Win probability

export const WinProbability = memo(function WinProbability({ topShare, draw, topName, bottomName, palette, spokenTop, spokenBottom }: {
  topShare: number;
  draw: number | null;
  topName: string;
  bottomName: string;
  palette: TeamPalette;
  spokenTop: string;
  spokenBottom: string;
}) {
  const bottomShare = Math.max(1 - topShare - (draw ?? 0), 0);
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const label = `Win probability from ESPN: ${spokenTop} ${pct(topShare)}${draw != null ? `, draw ${pct(draw)}` : ""}, ${spokenBottom} ${pct(bottomShare)}.`;
  // Each side is a full-width capsule slid into place, so a change glides on the compositor.
  const topEnd = topShare;
  const bottomStart = topShare + (draw ?? 0);
  return (
    <div className={styles.winProb} role="img" aria-label={label}>
      <div className={styles.wpLabels} aria-hidden="true">
        <span className={styles.wpLabel}>
          <span className={styles.teamDot} style={mark(palette.top)} />
          {topName} {pct(topShare)}
        </span>
        {draw != null ? (
          <span className={styles.wpLabel}>
            <span className={styles.teamDot} style={mark(NEUTRAL)} />
            Draw {pct(draw)}
          </span>
        ) : null}
        <span className={styles.wpLabel}>
          {pct(bottomShare)} {bottomName}
          <span className={styles.teamDot} style={mark(palette.bottom)} />
        </span>
      </div>
      <div className={styles.wpTrack} aria-hidden="true">
        <span className={styles.wpBar} style={{ ...mark(palette.top), transform: `translateX(calc(${(topEnd - 1) * 100}% - var(--gap)))` }} />
        {draw != null ? (
          <span className={styles.wpDraw} style={{ left: `calc(${topEnd * 100}% + var(--gap))`, width: `calc(${draw * 100}% - 2 * var(--gap))` }} />
        ) : null}
        <span className={styles.wpBar} style={{ ...mark(palette.bottom), transform: `translateX(calc(${bottomStart * 100}% + var(--gap)))` }} />
        <span className={styles.wpTick} />
      </div>
    </div>
  );
});

// MARK: - Team stats

/**
 * Team stats as split bars (Visualizations.swift `StatBars`): the leader's
 * side in full team color, the other side faded; a zero draws nothing. From
 * xlarge, two columns filled row by row in ESPN's order.
 */
export const StatBars = memo(function StatBars({ stats, palette, spokenTop, spokenBottom }: { stats: readonly Stat[]; palette: TeamPalette; spokenTop: string; spokenBottom: string }) {
  return (
    <ul className={styles.stats}>
      {stats.map((stat) => {
        const topLeads = stat.topShare > 0.5;
        const bottomLeads = stat.topShare < 0.5;
        const leader = topLeads ? spokenTop : bottomLeads ? spokenBottom : null;
        const zero = (v: string) => Number.parseFloat(v) === 0;
        return (
          <li key={stat.label} className={styles.stat} aria-label={`${stat.label}: ${spokenTop} ${stat.top}, ${spokenBottom} ${stat.bottom}.${leader ? ` ${leader} leads.` : ""}`}>
            <span className={styles.statValues} aria-hidden="true">
              <span data-leads={topLeads}>{stat.top}</span>
              <span className={styles.statLabel}>{stat.label}</span>
              <span data-leads={bottomLeads}>{stat.bottom}</span>
            </span>
            <SplitBar share={stat.topShare} palette={palette} topZero={zero(stat.top)} bottomZero={zero(stat.bottom)} />
          </li>
        );
      })}
    </ul>
  );
});

/** Two bars meeting at the share, each a full-width capsule slid into place (a change glides on the compositor). */
export function SplitBar({ share, palette, topZero = false, bottomZero = false }: { share: number; palette: TeamPalette; topZero?: boolean; bottomZero?: boolean }) {
  const tie = Math.abs(share - 0.5) < 0.001;
  const gap = topZero || bottomZero ? 0 : 1;
  const opacity = (leads: boolean) => (tie ? 0.75 : leads ? 1 : 0.4);
  return (
    <span className={styles.splitBar} aria-hidden="true" style={{ "--gap": `calc(${gap} * var(--pt))` } as CSSProperties}>
      {topZero && bottomZero ? <span className={styles.splitTrack} /> : null}
      {!topZero ? (
        <span className={styles.splitSegment} style={{ ...mark(palette.top), opacity: opacity(share > 0.5), transform: `translateX(calc(${((bottomZero ? 1 : share) - 1) * 100}% - var(--gap)))` }} />
      ) : null}
      {!bottomZero ? (
        <span className={styles.splitSegment} style={{ ...mark(palette.bottom), opacity: opacity(share < 0.5), transform: `translateX(calc(${(topZero ? 0 : share) * 100}% + var(--gap)))` }} />
      ) : null}
    </span>
  );
}

// MARK: - Scoring plays and key events

/** "7th Inning" → "7th"; soccer minutes and football clocks pass through (MomentList.shortClock). */
export const shortClock = (clock: string) => clock.replace(" Inning", "");

/** Soccer: the icon already says goal or card, so the row is the player (MomentList.headline). */
export const headline = (m: DetailMoment) => (["goal", "ownGoal", "yellow", "red"].includes(m.kind) ? shortened(m.text) : m.text);

export const MomentList = memo(function MomentList({ moments, topName, bottomName, topTeam, bottomTeam, renderText }: {
  moments: readonly DetailMoment[];
  topName: string;
  bottomName: string;
  topTeam: Competitor | null;
  bottomTeam: Competitor | null;
  /** The play's words with its players' names as links (football); the rows then pin on a click beside them. */
  renderText?: (m: DetailMoment, text: string) => ReactNode;
}) {
  // Soccer goals don't come with the score; count it up (skipped with an own goal, whose side ESPN leaves ambiguous).
  const running = new Map<string, string>();
  if (!moments.some((m) => m.kind === "ownGoal")) {
    let top = 0;
    let bottom = 0;
    for (const m of moments) {
      if (m.kind !== "goal" || m.score != null) continue;
      if (m.side === "top") top++;
      else if (m.side === "bottom") bottom++;
      else continue;
      running.set(m.id, `${top}–${bottom}`);
    }
  }
  const wide = moments.every((m) => shortClock(m.clock).length <= 6) ? 38 : 52;
  const showsIcons = moments.some((m) => m.kind !== "score" && m.kind !== "other");
  return (
    <ul className={styles.moments} style={{ "--clock": `calc(${wide} * var(--pt))` } as CSSProperties}>
      {[...moments].reverse().map((m) => (
        <MomentRow key={m.id} m={m} score={m.score ?? running.get(m.id) ?? null} keepsScoreColumn={running.size > 0 || moments.some((x) => x.score != null)} showsIcon={showsIcons} names={[topName, bottomName]} teams={[topTeam, bottomTeam]} renderText={renderText} />
      ))}
    </ul>
  );
});

function MomentRow({ m, score, keepsScoreColumn, showsIcon, names, teams, renderText }: {
  m: DetailMoment;
  score: string | null;
  keepsScoreColumn: boolean;
  showsIcon: boolean;
  names: [string, string];
  teams: [Competitor | null, Competitor | null];
  renderText?: (m: DetailMoment, text: string) => ReactNode;
}) {
  const focus: Focus = { play: m.id, period: m.period ?? undefined, side: m.side };
  const row = useLinkedRow(focus, { pinnable: true, links: renderText != null });
  const lit = useFocus((f) => matches(f, { play: m.id, period: m.period, side: m.side }));
  const team = m.side === "top" ? teams[0] : m.side === "bottom" ? teams[1] : null;
  const name = m.side === "top" ? names[0] : m.side === "bottom" ? names[1] : "";
  const points = score?.split("–");
  const spoken = [shortClock(m.clock), m.text, team?.name ?? (name || null), points?.length === 2 ? `${teams[0]?.name ?? names[0]} ${points[0]}, ${teams[1]?.name ?? names[1]} ${points[1]}` : null]
    .filter(Boolean)
    .join(", ");
  // The list item stays a list item; the row inside is what pins (a button,
  // unless it holds links), so the list keeps its semantics either way.
  return (
    <li className={styles.momentItem} aria-label={row.role ? undefined : spoken}>
      <div className={styles.momentRow} data-lit={lit} {...row} aria-label={row.role ? spoken : undefined}>
      <span className={styles.momentClock} title={m.clock}>
        {shortClock(m.clock)}
      </span>
      {showsIcon ? <span className={styles.momentIcon} data-kind={m.kind} /> : null}
      <span className={styles.momentText}>{renderText ? renderText(m, headline(m)) : headline(m)}</span>
      {m.side ? (
        <span className={styles.momentTeam} title={team?.name ?? name}>
          {team?.logo ? <TeamLogo url={team.logo} size={14} /> : <span className={styles.momentAbbr}>{name}</span>}
        </span>
      ) : null}
      {score ? <span className={styles.momentScore}>{score}</span> : keepsScoreColumn ? <span className={styles.momentScore} /> : null}
      </div>
    </li>
  );
}

// MARK: - Latest plays, where to watch, the series

export const LatestPlays = memo(function LatestPlays({ plays }: { plays: readonly string[] }) {
  return (
    <ul className={styles.plays}>
      {plays.map((p, i) => (
        <li key={`${i}-${p}`}>{p}</li>
      ))}
    </ul>
  );
});

const KIND_WORD: Readonly<Record<Broadcaster["kind"], string>> = { tv: "TV", streaming: "Streaming", subscription: "Subscription", radio: "Radio" };

export const WhereToWatch = memo(function WhereToWatch({ broadcasters }: { broadcasters: readonly Broadcaster[] }) {
  return (
    <ul className={styles.watch}>
      {broadcasters.map((b) => {
        const body = (
          <>
            <Icon name={b.kind === "radio" ? "radio" : b.kind === "tv" ? "tv" : "play"} size={11} className={styles.watchIcon} />
            <span className={styles.watchName}>{b.name}</span>
            <span className={styles.watchKind}>{KIND_WORD[b.kind]}</span>
            {b.url ? <Icon name="external" size={9} className={styles.watchIcon} /> : null}
          </>
        );
        return (
          <li key={b.name}>
            {b.url ? (
              <a className={styles.watchRow} href={b.url} target="_blank" rel="noopener noreferrer">
                {body}
              </a>
            ) : (
              <span className={styles.watchRow}>{body}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
});

/** "World Series" with "Bracket ›": the postseason bracket, the match's teams ringed (DetailView's `.bracket`). */
export function SeriesLink({ title, to }: { title: string; to: string }) {
  return (
    <Link className={styles.series} to={to}>
      <Icon name="trophy" size={12} className={styles.watchIcon} />
      <span className={styles.seriesTitle}>{title}</span>
      <span className={styles.seriesMore}>
        Bracket <Icon name="chevronRight" size={9} />
      </span>
    </Link>
  );
}

/** "Bottom of the 7th inning" for an inning number (spoken helpers). */
export const inningWords = (n: number | null) => (n == null ? null : `${ordinal(n)} inning`);
