/**
 * The climbing page's lists (LiveViews.swift `BoulderScorecard`,
 * `BoulderCell`; DetailView.swift `RankingList`, `ClimbingWatch`):
 *
 * - `BoulderScorecard`: how far each athlete got on each problem, the way
 *   IFSC draws it: a bar in two halves, the lower filling for the zone, the
 *   upper for the top, attempts underneath; the boulder being climbed is
 *   outlined. From large, tops and zones are totalled ("T", "Z"). Live, a
 *   half just reached sweeps up full and a top sparks (gold-rayed for a
 *   flash); when places change rows glide, each one that moved carries ▲2 or
 *   ▼1 for four seconds, and a row that climbed washes once in the accent.
 * - `RankingList`: the top 12, plus athletes from your countries placed
 *   lower, your countries highlighted. Live, the same chips and washes.
 * - `ClimbingWatch`: World Climbing's official YouTube channel.
 *
 * Every row is a linked row: pointing at it lights that climber on the wall
 * and the scorecard; a click beside the name pins them (again, or Esc,
 * unpins). The name opens the climber's page.
 */
import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { m } from "motion/react";
import { Icon, LiveDot } from "../../../design/components";
import { spring } from "../../../design/motion";
import { boulderTotals, REACH_LABEL, type BoulderCard, type Problem } from "../../../data/climbing";
import { ordinal } from "../../../data/format";
import type { Athlete } from "../../../data/gameDetail";
import type { LiveMoment } from "../../../data/moments";
import { countryName, flagFromIOC } from "../../../data/teams";
import { useSettings } from "../../../state/settings";
import { climberRef, linkNameClass, PlayerLink } from "../../profiles/ProfileLinks";
import { CelebrationStage } from "../core/CelebrationStage";
import { ChartFooter, Legend, LegendItem } from "../core/DetailSection";
import { useFocus, useLinkedRow, type Focus } from "../core/linked";
import { useChartMoment } from "../core/moments";
import { pointSize, useReducedMotion } from "../core/useMedia";
import { DeltaChip, wash } from "./marks";
import styles from "./Climbing.module.css";

/** How long a rank change is shown: a swing moment's hold. */
const DELTA_HOLD_MS = 4000;

/** Rank changes since the last reading, held four seconds, with each climber's wash firing once. */
function useRankShift(ranks: ReadonlyMap<number, number>, live: boolean): ReadonlyMap<number, number> {
  const last = useRef(ranks);
  const [deltas, setDeltas] = useState<ReadonlyMap<number, number>>(new Map());
  const key = [...ranks].map(([id, r]) => `${id}:${r}`).join(",");
  useEffect(() => {
    const before = last.current;
    last.current = ranks;
    // No longer live: the chips from the last change go.
    if (!live) {
      setDeltas((d) => (d.size === 0 ? d : new Map()));
      return;
    }
    const moved = new Map<number, number>();
    for (const [id, now] of ranks) {
      const was = before.get(id);
      if (was != null && was !== now) moved.set(id, was - now);
    }
    if (moved.size > 0) setDeltas(moved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, live]);
  // Held like a moment (4 s), then out; a newer change restarts the hold.
  useEffect(() => {
    if (deltas.size === 0) return;
    const timer = setTimeout(() => setDeltas(new Map()), DELTA_HOLD_MS);
    return () => clearTimeout(timer);
  }, [deltas]);
  return deltas;
}

/** A row's one-shot wash when it moves up (color, not motion: it stays with Reduce Motion; none at Off). */
function useWash(trigger: number | undefined) {
  const ref = useRef<HTMLSpanElement>(null);
  const level = useSettings((s) => s.celebrationLevel);
  const reduce = useReducedMotion();
  const seen = useRef(trigger);
  useEffect(() => {
    if (trigger === seen.current) return;
    seen.current = trigger;
    if (trigger != null && trigger > 0 && level !== "off" && ref.current) wash(ref.current, reduce);
  }, [trigger, level, reduce]);
  return ref;
}

// MARK: - Boulder scorecard

export const BoulderScorecard = memo(function BoulderScorecard({ cards, problems, yours, live }: { cards: readonly BoulderCard[]; problems: readonly string[]; yours: ReadonlySet<string>; live: boolean }) {
  const moment = useChartMoment("boulder");
  const deltas = useRankShift(new Map(cards.flatMap((c) => (c.rank != null ? [[c.id, c.rank] as const] : []))), live);
  return (
    <div className={styles.chart}>
      <div className={styles.card} role="list">
        <div className={styles.cardHead} aria-hidden="true">
          <span className={styles.cardSpacer} />
          {problems.map((p) => (
            <span key={p} className={`${styles.tick} ${styles.boulder}`} title={`Boulder ${p}`}>
              {p}
            </span>
          ))}
          <span className={`${styles.tick} ${styles.cardCount} ${styles.totals}`} title="Tops">
            T
          </span>
          <span className={`${styles.tick} ${styles.cardCount} ${styles.totals}`} title="Zones, including tops">
            Z
          </span>
          <span className={`${styles.tick} ${styles.cardPoints}`}>Pts</span>
        </div>
        {cards.map((card) => (
          <m.div key={card.id} layout="position" transition={spring.travel} role="listitem">
            <CardRow card={card} problems={problems} mine={card.country != null && yours.has(card.country)} delta={deltas.get(card.id) ?? null} moment={moment?.id.startsWith(`boulder:${card.id}:`) ? moment : null} />
          </m.div>
        ))}
      </div>
      <ChartFooter readout={null} moment={moment}>
        <Legend>
          <LegendItem label="Top" swatch={<Bar problem={{ reach: "top", tries: null, active: false }} height={14} />} />
          <LegendItem label="Zone" swatch={<Bar problem={{ reach: "zone", tries: null, active: false }} height={14} />} />
          <span className={styles.legendNote}>Numbers show attempts</span>
        </Legend>
      </ChartFooter>
    </div>
  );
});

function CardRow({ card, problems, mine, delta, moment }: { card: BoulderCard; problems: readonly string[]; mine: boolean; delta: number | null; moment: LiveMoment | null }) {
  const focus: Focus = { athlete: card.id };
  const linked = useLinkedRow(focus, { pinnable: true, links: true });
  const lit = useFocus((f) => f?.athlete === card.id);
  const washRef = useWash(delta != null && delta > 0 ? delta : undefined);
  const totals = boulderTotals(card);
  const reached = card.problems.map((p, i) => `${problems[i] ?? i + 1}: ${REACH_LABEL[p.reach]}${p.tries != null ? ` in ${p.tries}` : ""}`);
  const said = [card.rank != null ? ordinal(card.rank) : null, delta ? (delta > 0 ? `up ${delta}` : `down ${-delta}`) : null, card.name, card.onWall ? "climbing now" : null, card.score ? `${card.score} points` : null, `${totals.tops} tops, ${totals.zones} zones`, ...reached]
    .filter(Boolean)
    .join(", ");
  const ref = climberRef(card.id, card.name, { country: card.country });
  return (
    <div className={styles.cardRow} data-mine={mine} data-onwall={card.onWall} data-lit={lit} {...linked} role="group" aria-label={said}>
      <span ref={washRef} className={styles.wash} />
      <span className={styles.cardRank} aria-hidden="true">
        {card.rank ?? "–"}
      </span>
      <span className={styles.cardFlag} title={card.country ? countryName(card.country) : undefined} aria-hidden="true">
        {card.flag ?? ""}
      </span>
      {/* Every name at one size: a long one truncates. A click on it opens the climber's page. */}
      <PlayerLink player={ref} className={[styles.cardName, linkNameClass].join(" ")} title={`Go to ${card.name}`}>
        {card.name}
      </PlayerLink>
      {card.onWall ? (
        <span title="Climbing now">
          <LiveDot />
        </span>
      ) : null}
      {delta ? <DeltaChip delta={delta} className={styles.deltaIn} /> : null}
      <span className={styles.cardSpacer} />
      {card.problems.map((p, i) => (
        <Cell key={i} problem={p} label={problems[i] ?? null} moment={moment?.id.startsWith(`boulder:${card.id}:${i}:`) ? moment : null} />
      ))}
      <span className={`${styles.cardCount} ${styles.totals}`} aria-hidden="true">
        {totals.tops}
      </span>
      <span className={`${styles.cardCount} ${styles.totals}`} aria-hidden="true">
        {totals.zones}
      </span>
      <span className={styles.cardPoints} aria-hidden="true">
        {card.score?.trim() ?? ""}
      </span>
    </div>
  );
}

/** One boulder: the bar, attempts underneath, a top's sparks around it (gold-rayed for a flash); the plain ping with celebrations off. */
function Cell({ problem, label, moment }: { problem: Problem; label: string | null; moment: LiveMoment | null }) {
  const level = useSettings((s) => s.celebrationLevel);
  // A top on the first attempt is a flash, whether or not the moment says so.
  const shown = moment && moment.kind === "top" && problem.reach === "top" && problem.tries === 1 && !moment.accents.has("flash") ? { ...moment, accents: new Set([...moment.accents, "flash" as const]) } : moment;
  const pt = typeof window === "undefined" ? 1 : pointSize();
  const help = `${label ? `Boulder ${label}: ` : ""}${REACH_LABEL[problem.reach]}${problem.tries != null ? ` in ${problem.tries} ${problem.tries === 1 ? "attempt" : "attempts"}` : ""}${problem.active ? " · climbing now" : ""}`;
  return (
    <span className={styles.boulder} title={help} aria-hidden="true">
      <Bar problem={problem} height={26}>
        {shown ? (
          level === "off" ? (
            <span key={shown.id} className={`${styles.abs} ${styles.ping}`} style={{ left: "50%", top: "50%", width: "calc(16 * var(--pt))", height: "calc(16 * var(--pt))", margin: "calc(-8 * var(--pt)) 0 0 calc(-8 * var(--pt))" }} />
          ) : shown.kind === "top" ? (
            <span className={styles.cellStage}>
              <CelebrationStage moment={shown} origin={{ x: 32 * pt, y: 32 * pt }} colors={{ primary: null }} inset={0} />
            </span>
          ) : null
        ) : null}
      </Bar>
      <span className={styles.tries}>{problem.tries ?? " "}</span>
    </span>
  );
}

/** IFSC's bar: the upper half for the top, the lower for the zone (half filled for the older low zone). A half just reached sweeps up. */
function Bar({ problem, height, children }: { problem: Problem; height: number; children?: React.ReactNode }) {
  const width = Math.max(height * 0.54, 8);
  const half = (height - 2) / 2;
  const size = { "--w": `calc(${width} * var(--pt))`, "--h": `calc(${half} * var(--pt))` } as CSSProperties;
  return (
    <span className={styles.bar} data-active={problem.active} style={{ position: "relative" }}>
      <span className={styles.segment} style={size} data-filled={problem.reach === "top"}>
        <span className={styles.segmentFill} />
      </span>
      <span className={styles.segment} style={size} data-filled={problem.reach === "top" || problem.reach === "zone"} data-low={problem.reach === "lowZone"}>
        <span className={styles.segmentFill} />
      </span>
      {children}
    </span>
  );
}

// MARK: - Results and the starting order

export const RankingList = memo(function RankingList({ athletes, yours, live }: { athletes: readonly Athlete[]; yours: ReadonlySet<string>; live: boolean }) {
  const deltas = useRankShift(new Map(athletes.flatMap((a) => (a.rank != null ? [[a.id, a.rank] as const] : []))), live);
  const top = athletes.slice(0, 12);
  const below = athletes.slice(12).filter((a) => a.country != null && yours.has(a.country));
  const row = (a: Athlete) => (
    <m.li key={a.id} layout="position" transition={spring.travel}>
      <RankRow athlete={a} mine={a.country != null && yours.has(a.country)} delta={deltas.get(a.id) ?? null} />
    </m.li>
  );
  return (
    <ul className={styles.ranking}>
      {top.map(row)}
      {below.length > 0 ? (
        <li className={styles.divider} aria-hidden="true">
          Your countries
        </li>
      ) : null}
      {below.map(row)}
    </ul>
  );
});

function RankRow({ athlete: a, mine, delta }: { athlete: Athlete; mine: boolean; delta: number | null }) {
  const linked = useLinkedRow({ athlete: a.id }, { pinnable: true, links: true });
  const lit = useFocus((f) => f?.athlete === a.id);
  const washRef = useWash(delta != null && delta > 0 ? delta : undefined);
  const country = a.country ? countryName(a.country) : null;
  const said = [a.rank != null ? ordinal(a.rank) : null, delta ? (delta > 0 ? `up ${delta}` : `down ${-delta}`) : null, a.name, country, a.score ? `score ${a.score}` : null, mine ? "Your country" : null].filter(Boolean).join(", ");
  return (
    <div className={styles.rankRow} data-mine={mine} data-lit={lit} {...linked} role="group" aria-label={said}>
      <span ref={washRef} className={styles.wash} />
      <span className={styles.rankNumber} data-podium={a.rank != null && a.rank <= 3} aria-hidden="true">
        {a.rank ?? "–"}
      </span>
      {/* Flags carry the color on climbing pages. */}
      <span className={styles.rankFlag} title={country ?? undefined} aria-hidden="true">
        {flagFromIOC(a.country) ?? ""}
      </span>
      <PlayerLink player={climberRef(a.id, a.name, { country: a.country })} className={[styles.rankName, linkNameClass].join(" ")} title={`Go to ${a.name}`}>
        {a.name}
      </PlayerLink>
      {/* After the name, so nothing else in the row moves when it comes and goes. */}
      {delta ? <DeltaChip delta={delta} className={styles.deltaIn} /> : null}
      {a.score ? (
        <span className={styles.rankScore} aria-hidden="true">
          {a.score}
        </span>
      ) : null}
    </div>
  );
}

// MARK: - Watch

/**
 * World Climbing's official channel on YouTube. The Mac also finds the
 * round's own stream (live, or counting down) from the channel's `/live`
 * page; YouTube isn't on the web's upstream allowlist, so this links the
 * channel only. TODO(owner): YouTube on the allowlist for live-stream
 * detection (ClimbingBroadcast.swift).
 */
export function ClimbingWatch({ final }: { final: boolean }) {
  return (
    <div className={styles.watch}>
      <a className={styles.watchRow} href="https://www.youtube.com/@WorldClimbing/streams" target="_blank" rel="noopener noreferrer" aria-label={`World Climbing on YouTube, ${final ? "replays" : "all streams"}. Opens in a new tab.`}>
        <span className={styles.watchIcon}>
          <Icon name="play" size={12} />
        </span>
        <span className={styles.watchName}>World Climbing on YouTube</span>
        <span className={styles.watchDetail}>{final ? "Replays" : "All streams"}</span>
        <Icon name="external" size={9} className={styles.arrow} />
      </a>
    </div>
  );
}
