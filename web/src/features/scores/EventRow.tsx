/**
 * EventRow: one game in the list (EventRow.swift). Two competitor lines
 * (crest, AP rank, name, the ball, the follow star, the record when it fits,
 * the score), the line under them (the caption, or live, the situation),
 * and the status column. A finished game's loser steps back. A live score
 * change flashes the row red, with a dot before the side that scored.
 *
 * It's a link to the game, labeled with the game in words; it re-renders
 * only when its own game, highlight or selection changes.
 */
import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router";
import { Icon, LiveStatus } from "../../design/components";
import { FLASH } from "../../design/motion";
import { contextLine, countdown, clockTime, dayName, enDash, isDelayed, spokenSummary, unplayed } from "../../data/format";
import { competitorKey, eventSport, stepsBack, type Competitor, type ScoreEvent } from "../../data/models";
import { liveScoreChanged, sameEvent, scorers as findScorers } from "../../data/scoreboard";
import { useNow } from "../../state/clock";
import { useSettings } from "../../state/settings";
import type { NavState } from "../../app/layout";
import { recordFits } from "./measure";
import { TravelingLogo, travelID } from "./sections";
import styles from "./EventRow.module.css";

export interface EventRowProps {
  readonly event: ScoreEvent;
  /** Moved here by the arrow keys (it wears the accent). */
  readonly keyboard: boolean;
  /** Open in the detail pane. */
  readonly selected: boolean;
  /** Records show beside names (medium width and up). */
  readonly records: boolean;
  /** The data is stale: the live dot holds still. */
  readonly stale: boolean;
  /** Set when the row appears because its section was just expanded: text reveals after this delay. */
  readonly revealDelay?: number | null;
  /** While its section toggles: the crests that travel to and from the collapsed preview. */
  readonly travel?: { readonly section: string; readonly ids: ReadonlySet<string> } | null;
  readonly onHover: (id: string) => void;
}

function EventRowView({ event, keyboard, selected, records, stale, revealDelay, travel, onHover }: EventRowProps) {
  const followed = useSettings((s) => s.followed);
  const isFollowed = (c: Competitor) => c.id != null && followed.some((t) => t.id === c.id);
  const { flashRef, scorers } = useScoreFlash(event);
  const now = Date.now();
  const sport = eventSport(event);
  const soccer = sport === "soccer";
  const context = contextLine(event);
  const reveal = revealDelay != null ? { className: styles.reveal, style: { animationDelay: `${revealDelay}s` } as CSSProperties } : null;

  const label = [
    spokenSummary(event, sport, now),
    ...event.content.kind === "match" ? [event.content.top, event.content.bottom].filter(isFollowed).map((c) => `Following ${c.name}`) : [],
    event.state === "live" && event.liveLine ? event.liveLine : null,
    event.caption,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <Link
      to={`/game/${encodeURIComponent(event.id)}`}
      className={styles.row}
      data-nav-id={event.id}
      data-keyboard={keyboard}
      aria-current={selected ? "page" : undefined}
      aria-label={label}
      onPointerEnter={() => onHover(event.id)}
      draggable={false}
    >
      <span ref={flashRef} className={styles.flash} aria-hidden="true" />
      <span className={styles.teams} aria-hidden="true">
        {event.content.kind === "match" ? (
          <>
            <CompetitorLine event={event} c={event.content.top} records={records} soccer={soccer} followed={isFollowed(event.content.top)} scored={scorers.has(competitorKey(event.content.top))} reveal={reveal} travel={travel} />
            <CompetitorLine event={event} c={event.content.bottom} records={records} soccer={soccer} followed={isFollowed(event.content.bottom)} scored={scorers.has(competitorKey(event.content.bottom))} reveal={reveal} travel={travel} />
          </>
        ) : (
          <span className={reveal?.className} style={reveal?.style}>
            <span className={styles.fieldTitle} style={{ display: "block" }}>
              {event.content.title}
            </span>
            {event.content.summary ? (
              <span className={styles.fieldSummary} style={{ display: "block", marginTop: "calc(4 * var(--pt))" }}>
                {event.content.summary}
              </span>
            ) : null}
          </span>
        )}
        {context ? (
          <span key={context.text} className={[styles.context, reveal?.className].filter(Boolean).join(" ")} style={reveal?.style}>
            {context.text}
          </span>
        ) : null}
      </span>
      <span className={[styles.status, reveal?.className].filter(Boolean).join(" ")} style={reveal?.style} aria-hidden="true">
        <RowStatus event={event} stale={stale} />
      </span>
    </Link>
  );
}

/** A row redraws only when what it shows changes (not when the list does). */
export const EventRow = memo(EventRowView, (a, b) => {
  return (
    a.keyboard === b.keyboard &&
    a.selected === b.selected &&
    a.records === b.records &&
    a.stale === b.stale &&
    a.revealDelay === b.revealDelay &&
    a.travel === b.travel &&
    a.onHover === b.onHover &&
    sameEvent(a.event, b.event)
  );
});

function CompetitorLine({
  event,
  c,
  records,
  soccer,
  followed,
  scored,
  reveal,
  travel,
}: {
  event: ScoreEvent;
  c: Competitor;
  records: boolean;
  soccer: boolean;
  followed: boolean;
  scored: boolean;
  reveal: { className: string | undefined; style: CSSProperties } | null;
  travel: EventRowProps["travel"];
}) {
  const crest = travel ? travelID(travel.section, c) : null;
  const dimmed = stepsBack(event, c);
  const hasBall = event.state === "live" && event.possession != null && event.possession === c.id;
  const record = c.record ? enDash(c.record) : null;
  const showRecord =
    records && record != null && recordFits({ name: c.name, rank: c.rank, marks: (hasBall ? 1 : 0) + (followed ? 1 : 0), record, score: c.score });
  const playedFinal = event.state === "final" && !unplayed(event);
  return (
    <span className={[styles.line, dimmed ? styles.dimmed : null].filter(Boolean).join(" ")}>
      {/* The crest stays put while the text reveals around it. */}
      <TravelingLogo team={c} size={16} travelID={crest && travel?.ids.has(crest) ? crest : null} />
      <span className={[styles.line, reveal?.className].filter(Boolean).join(" ")} style={{ flex: 1, ...reveal?.style }}>
        <span className={styles.identity}>
          {c.rank != null ? <span className={styles.rank}>{c.rank}</span> : null}
          <span className={styles.name}>{c.name}</span>
        </span>
        {hasBall || followed ? (
          <span className={styles.marks}>
            {hasBall ? <Icon name="football" size={8} className={styles.ball} /> : null}
            {followed ? <Icon name="star" size={7.5} className={styles.star} /> : null}
          </span>
        ) : null}
        {showRecord ? (
          <span className={styles.record} title={soccer ? "Wins, draws and losses this season" : "Season record"}>
            {record}
          </span>
        ) : null}
        <span className={styles.spacer} />
        {c.score != null ? (
          <span className={styles.score}>
            {event.state === "live" && scored ? <span className={styles.scorer} /> : null}
            {c.score}
          </span>
        ) : playedFinal ? (
          <span className={`${styles.score} ${styles.missing}`}>–</span>
        ) : null}
      </span>
    </span>
  );
}

/**
 * The status column: live, the dot and the clock; scheduled, the time and
 * its day, a countdown within three hours, "Delayed" or "Starting soon";
 * final, the source's word ("FT", "Final/OT").
 */
export function RowStatus({ event, stale }: { event: ScoreEvent; stale: boolean }) {
  switch (event.state) {
    case "live":
      return <LiveStatus clock={event.clock} fallback={event.detail ?? "Live"} animated={!stale} />;
    case "final":
      return <span className={styles.final}>{event.detail ?? "Final"}</span>;
    case "scheduled":
      return <ScheduledStatus event={event} />;
  }
}

function ScheduledStatus({ event }: { event: ScoreEvent }) {
  const now = useNow(30_000);
  if (isDelayed(event, now)) {
    return (
      <>
        <span className={styles.delayed}>Delayed</span>
        <span className={styles.day}>{clockTime(event.start)}</span>
      </>
    );
  }
  if (event.start < now) {
    // Past its listed start but not underway: a late start, or a round without a published time.
    return (
      <span className={styles.soon} title={event.content.kind === "field" ? "Start time not announced yet" : `Scheduled for ${clockTime(event.start)}`}>
        {event.content.kind === "field" ? "Time TBA" : "Starting soon"}
      </span>
    );
  }
  if (event.ref?.kind === "climbing" && event.ref.category === "") {
    // A whole competition ahead (the off-season's next opener): its first day, not a midnight placeholder.
    return (
      <>
        <span className={styles.time}>{dayName(event.start, now) ?? "Today"}</span>
        <span className={styles.day}>Starts</span>
      </>
    );
  }
  const soon = event.start - now < 3 * 3_600_000 ? countdown(event.start, now) : null;
  if (soon) {
    return (
      <>
        <span className={styles.countdown}>{soon}</span>
        <span className={styles.day}>{clockTime(event.start)}</span>
      </>
    );
  }
  const day = dayName(event.start, now);
  return (
    <>
      <span className={styles.time}>{clockTime(event.start)}</span>
      {day ? <span className={styles.day}>{day}</span> : null}
    </>
  );
}

/**
 * The row's flash: when a live score changes between two live readings, a
 * soft red wash fades in, holds 1.6s and decays over 1.2s; the scorer's dot
 * shows for exactly as long. Only while the page is visible.
 */
function useScoreFlash(event: ScoreEvent) {
  const flashRef = useRef<HTMLSpanElement>(null);
  const previous = useRef(event);
  const [scorers, setScorers] = useState<ReadonlySet<string>>(() => new Set());
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    const before = previous.current;
    previous.current = event;
    if (before === event || !liveScoreChanged(before, event) || document.visibilityState !== "visible") return;
    const el = flashRef.current;
    if (!el) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const total = FLASH.inMs + FLASH.holdMs + (reduce ? 150 : FLASH.decayMs);
    const from = Number(getComputedStyle(el).opacity) || 0;
    el.getAnimations().forEach((a) => a.cancel());
    el.animate(
      [
        { opacity: from, offset: 0, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
        { opacity: 1, offset: FLASH.inMs / total },
        { opacity: 1, offset: (FLASH.inMs + FLASH.holdMs) / total, easing: "ease-out" },
        { opacity: 0, offset: 1 },
      ],
      { duration: total, fill: "forwards" },
    );
    setScorers(findScorers(before, event));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setScorers(new Set()), total);
  }, [event]);

  return { flashRef, scorers };
}
