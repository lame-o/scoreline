/**
 * The profile pages' charts (ProfileCharts.swift, ResultRows.swift
 * `FormStrip`). Each answers one question and earns its place:
 *
 * - the game-log strip: "how has he been playing, and was last night normal?"
 * - the soccer match strip: results with goals and assists (counts of 0–2 make bars meaningless)
 * - the form strip: the last five results, oldest to newest
 * - rank tracks: "where does this team sit in its league?"
 * - the CS2 map pool: ratings on a shared scale
 *
 * One series, one color (the team's); state is never color alone; hover is
 * instant (no animation: it happens tens of times a minute) and reads out in
 * the footer. Geometry is in src/data/profiles/charts.ts.
 */
import { memo, useMemo, useRef, useState, type PointerEvent } from "react";
import { Link, useNavigate } from "react-router";
import {
  barMid,
  entryContext,
  formatValue,
  mapDomain,
  matchReadout,
  matchStripCount,
  monthTicks,
  nearestBar,
  overallRating,
  rankPosition,
  STRIP_HEIGHT,
  STRIP_LABEL_ROOM,
  stripLabelOf,
  stripLayout,
  stripMean,
  stripSpoken,
  stripSpreads,
  stripValues,
} from "../../data/profiles/charts";
import type { WidthClass } from "../../data/profiles/display";
import { entryValue, type GameLog, type MapStat, type TeamStat } from "../../data/profiles/models";
import type { FormMark } from "../../data/profiles/results";
import { useWidth } from "../../design/useWidth";
import styles from "./Charts.module.css";

/** The match page for a log entry or a game ("espn-401…", "cs-123"). */
export function gameHref(id: string): string {
  return `/game/${encodeURIComponent(/^(espn|cs)-/.test(id) ? id : `espn-${id}`)}`;
}

function pointsOf(e: PointerEvent<Element>, el: Element): number {
  const pt = parseFloat(getComputedStyle(document.documentElement).fontSize) / 13 || 1;
  return (e.clientX - el.getBoundingClientRect().left) / pt;
}

/** The readout under a chart: the pointed-at mark (its value, then what it was), else the legend. */
function ChartFooter({ readout, children }: { readonly readout: { lead: string; detail: string } | null; readonly children: React.ReactNode }) {
  return (
    <div className={styles.footer}>
      <div className={styles.legend} data-hidden={readout != null}>
        {children}
      </div>
      {readout ? (
        <div className={styles.readout} aria-hidden="true">
          <strong>{readout.lead}</strong>
          {readout.detail ? <span>{`  ${readout.detail}`}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

// MARK: - Game-log strip

/**
 * Bars left to right in date order, against the largest value; the dashed
 * line is the mean of the bars shown (ESPN's season average lags), or a fixed
 * reference (Game Score's 50). MLB hitters: a ring over a game with a home
 * run (shape, not color). Click a bar to open the game.
 */
export const GameLogStrip = memo(function GameLogStrip({ log, tint }: { readonly log: GameLog; readonly tint: string | null }) {
  const navigate = useNavigate();
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box, 300);
  const [hovered, setHovered] = useState<number | null>(null);
  const values = useMemo(() => stripValues(log), [log]);
  const spread = stripSpreads(log);
  const plotWidth = Math.max(0, width - STRIP_LABEL_ROOM);
  const ceiling = log.reference != null ? log.reference * 1.15 : null;
  const bars = useMemo(() => stripLayout(values, plotWidth, STRIP_HEIGHT - 6, ceiling, spread), [values, plotWidth, ceiling, spread]);
  const top = Math.max(0, ...values.filter((v): v is number => v != null), ceiling ?? 0, 1);
  const reference = log.reference ?? stripMean(values);
  const label = stripLabelOf(log);
  const ticks = useMemo(() => monthTicks(log.entries, bars), [log.entries, bars]);
  const color = tint ?? "var(--accent)";
  const entries = log.entries;
  const last = entries.at(-1);
  const readout =
    hovered != null && entries[hovered]
      ? { lead: entries[hovered]!.played ? `${entries[hovered]!.stats[log.stripKey ?? ""] ?? "0"} ${label}` : "Didn't play", detail: entryContext(entries[hovered]!) }
      : null;
  const base = STRIP_HEIGHT;
  const refY = reference != null && reference > 0 ? base - (reference / top) * (base - 6) : null;

  return (
    <div className={styles.strip} ref={box}>
      <svg
        className={styles.plot}
        role="img"
        aria-label={stripSpoken(log)}
        viewBox={`0 0 ${width} ${STRIP_HEIGHT + 1}`}
        style={{ width: `calc(${width} * var(--pt))`, height: `calc(${STRIP_HEIGHT + 1} * var(--pt))` }}
        onPointerMove={(e) => {
          const i = nearestBar(bars, pointsOf(e, e.currentTarget));
          if (i !== hovered) setHovered(i);
        }}
        onPointerLeave={() => setHovered(null)}
        onClick={(e) => {
          const i = nearestBar(bars, pointsOf(e as unknown as PointerEvent<Element>, e.currentTarget));
          const entry = i != null ? entries[i] : undefined;
          if (entry) navigate(gameHref(entry.eventID));
        }}
        data-clickable={hovered != null}
      >
        <title>{`${label} by game. Click a game to open it.`}</title>
        <rect x={0} y={base - 0.5} width={plotWidth} height={1} className={styles.baseline} />
        {bars.map((bar, i) => {
          const dim = hovered != null && hovered !== i;
          if (!bar.played) return <rect key={i} x={bar.x} y={base - 3} width={bar.width} height={3} rx={1} className={styles.track} />;
          const zero = (values[i] ?? 0) <= 0;
          const y = base - bar.height;
          const r = Math.min(2, bar.width / 2, bar.height);
          const mark = log.markKey != null && (entryValue(entries[i]!, log.markKey) ?? 0) > 0;
          const ring = Math.min(3, bar.width / 2 + 1);
          return (
            <g key={i} opacity={(zero ? 0.45 : 1) * (dim ? 0.55 : 1)}>
              <path d={`M${bar.x},${base} V${y + r} Q${bar.x},${y} ${bar.x + r},${y} H${bar.x + bar.width - r} Q${bar.x + bar.width},${y} ${bar.x + bar.width},${y + r} V${base} Z`} fill={color} />
              {mark ? <circle cx={barMid(bar)} cy={y - ring - 2} r={ring - 0.75} className={styles.ring} /> : null}
            </g>
          );
        })}
        {refY != null ? (
          <>
            <line x1={0} x2={plotWidth} y1={refY} y2={refY} className={styles.reference} />
            <text x={plotWidth + 6} y={refY} className={styles.refLabel} dominantBaseline="middle">
              {log.referenceLabel ?? `avg ${formatValue(reference!)}`}
            </text>
          </>
        ) : null}
      </svg>
      {ticks.length > 0 ? (
        <div className={styles.ticks} aria-hidden="true">
          {ticks.map((t) => (
            <span key={t.index} style={{ left: `calc(${bars[t.index]!.x} * var(--pt))` }}>
              {t.label}
            </span>
          ))}
        </div>
      ) : null}
      <ChartFooter readout={readout}>
        {last ? (
          <span className={styles.last}>
            <span className={styles.lastLabel}>Last: </span>
            <strong>{`${last.stats[log.stripKey ?? ""] ?? "–"} ${label}`}</strong>
            <span className={styles.lastContext}>{`  ${entryContext(last)}`}</span>
          </span>
        ) : null}
      </ChartFooter>
    </div>
  );
});


// MARK: - Soccer match strip

/** One cell per match: the result letter, then a dot per goal (filled) and per assist (ring). Goalkeepers: a dot for a clean sheet. */
export const MatchStrip = memo(function MatchStrip({ log, width }: { readonly log: GameLog; readonly width: WidthClass }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const shown = log.entries.slice(-matchStripCount(width));
  const pointed = hovered ? shown.find((e) => e.eventID === hovered) : undefined;
  const cleanSheets = log.stripKey === "cleanSheet";
  return (
    <div className={styles.matchStrip}>
      {/* A labeled group of links (each opens its game); a link given the listitem role stops being a link. */}
      <div className={styles.cells} role="group" aria-label={`Last ${shown.length} matches: ${shown.map((e) => e.result ?? "–").join(" ")}.`}>
        {shown.map((e) => {
          const primary = Math.min(3, Math.trunc(entryValue(e, log.stripKey ?? "") ?? 0));
          const secondary = Math.min(3 - primary, Math.trunc(entryValue(e, log.markKey ?? "") ?? 0));
          return (
            <Link
              key={e.eventID}
              to={gameHref(e.eventID)}
              className={styles.cell}
              data-dim={hovered != null && hovered !== e.eventID}
              aria-label={`${entryContext(e)}, ${matchReadout(log, e)}`}
              onPointerEnter={() => setHovered(e.eventID)}
              onPointerLeave={() => setHovered((h) => (h === e.eventID ? null : h))}
            >
              <span className={styles.letter} data-draw={e.result === "D"}>
                {e.result ?? "–"}
              </span>
              <span className={styles.dots}>
                {Array.from({ length: primary }, (_, k) => (
                  <span key={`g${k}`} className={styles.dot} />
                ))}
                {Array.from({ length: Math.max(0, secondary) }, (_, k) => (
                  <span key={`a${k}`} className={styles.ringDot} />
                ))}
              </span>
            </Link>
          );
        })}
      </div>
      <ChartFooter readout={pointed ? { lead: matchReadout(log, pointed), detail: entryContext(pointed) } : null}>
        <span className={styles.legendItem}>
          <span className={styles.dot} /> {cleanSheets ? "Clean sheet" : "Goal"}
        </span>
        {cleanSheets ? null : (
          <span className={styles.legendItem}>
            <span className={styles.ringDot} /> Assist
          </span>
        )}
      </ChartFooter>
    </div>
  );
});

// MARK: - Form strip

/** The last results as marks: a win filled, a draw shaded, a loss outlined (never color alone). The pointed-at mark reads out beside. */
export function FormStrip({ marks }: { readonly marks: readonly FormMark[] }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const pointed = marks.find((m) => m.id === hovered);
  return (
    <div className={styles.form}>
      {/* A labeled group of links, as the schedule's form strip (ResultRows.FormStrip). */}
      <div className={styles.marks} role="group" aria-label={`Form, last ${marks.length}, oldest to newest`}>
        {marks.map((m) => (
          <Link
            key={m.id}
            to={gameHref(m.id)}
            className={styles.mark}
            data-letter={m.letter}
            data-lit={hovered === m.id}
            aria-label={m.spoken}
            title={m.readout}
            onPointerEnter={() => setHovered(m.id)}
            onPointerLeave={() => setHovered((h) => (h === m.id ? null : h))}
            onFocus={() => setHovered(m.id)}
            onBlur={() => setHovered((h) => (h === m.id ? null : h))}
          >
            {m.letter}
          </Link>
        ))}
      </div>
      <span className={styles.formReadout} aria-hidden="true">
        {pointed?.readout ?? ""}
      </span>
    </div>
  );
}

// MARK: - Rank track

/** Where a team sits among the league on one stat: a dot on a 1…N track, best on the left, with the value and rank as text. */
export function RankTrack({ stat, field, tint }: { readonly stat: TeamStat; readonly field: number; readonly tint: string | null }) {
  const x = stat.rank != null ? rankPosition(stat.rank, field) : null;
  return (
    <div className={styles.rankRow} role="group" aria-label={`${stat.label}, ${stat.value}${stat.rank != null ? `, ${ordinalOf(stat.rank)} of ${field}` : ""}`}>
      <span className={styles.rankLabel} aria-hidden="true">
        {stat.label}
      </span>
      <span className={styles.rankValue} aria-hidden="true">
        {stat.value}
      </span>
      <svg className={styles.rankTrack} viewBox="0 0 84 12" aria-hidden="true">
        <rect x={0} y={4} width={84} height={4} rx={2} className={styles.track} />
        {x != null ? <circle cx={3.5 + x * 77} cy={6} r={3.5} fill={tint ?? "var(--accent)"} /> : null}
      </svg>
      <span className={styles.rankText} aria-hidden="true">
        {stat.rankText ?? "–"}
      </span>
    </div>
  );
}

function ordinalOf(n: number): string {
  const mod100 = n % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

// MARK: - Map pool

/**
 * Average bo3 rating per map, best first, as dots on a shared scale (the
 * ratings sit close together, so bars from zero would hide the differences).
 * The line is his overall rating; the number of maps is a label, never a
 * second mark; small samples step back.
 */
export function MapPoolBars({ maps, tint }: { readonly maps: readonly MapStat[]; readonly tint: string | null }) {
  const [lo, hi] = mapDomain(maps);
  const span = Math.max(hi - lo, 0.01);
  const overall = overallRating(maps);
  const at = (v: number) => `calc((100% - 7 * var(--pt)) * ${Math.min(Math.max((v - lo) / span, 0), 1)})`;
  return (
    <div className={styles.mapPool}>
      {maps.map((m) => (
        <div key={m.name} className={styles.mapRow} data-small={m.maps < 10} role="group" aria-label={`${m.name}: rating ${m.rating.toFixed(2)} over ${m.maps} maps`}>
          <span className={styles.mapName} aria-hidden="true">
            {m.name}
          </span>
          <span className={styles.mapTrack} aria-hidden="true">
            <span className={styles.mapOverall} style={{ left: `calc(${at(overall)} + 3 * var(--pt))` }} />
            <span className={styles.mapDot} style={{ left: at(m.rating), background: tint ?? "var(--accent)" }} />
          </span>
          <span className={styles.mapRating} aria-hidden="true">
            {m.rating.toFixed(2)}
          </span>
          <span className={styles.mapCount} aria-hidden="true">
            {`${m.maps} maps`}
          </span>
        </div>
      ))}
    </div>
  );
}

