/**
 * ScheduleRow: the scores list's row, continued in time (ScheduleRows.swift).
 * Teams stacked on the left, a status column on the right (time, then
 * network); the day lives in the header above, never in the row. A finished
 * game adds its result: the label, the shootout or aggregate under it, and
 * one line of story under the teams (its knockout context, else, with Show
 * Details, its scorers, pitchers or performers). The loser steps back by the
 * score. Wider rows add a lane (where it's played, what it is) and records.
 *
 * Games around today take live state from the scores list (same IDs): the
 * page hands each row its event. A row is a link to the game; a collapsed
 * tournament day is a button that opens in place; a climbing round opens the
 * season. Memoized on what it shows.
 */
import { memo, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { Icon, LiveStatus } from "../../design/components";
import { clockTime, countdown, enDash, isDelayed, spokenEventStatus, spokenResult } from "../../data/format";
import { competitorKey, stepsBack, type Competitor, type ScoreEvent } from "../../data/models";
import { RED_CARD, resultSecondLine } from "../../data/results";
import { isField, startDate, type ScheduleItem } from "../../data/schedule";
import { useNow } from "../../state/clock";
import { useSettings } from "../../state/settings";
import { recordFits } from "../scores/measure";
import { TravelingLogo, travelID } from "../scores/sections";
import styles from "./ScheduleRow.module.css";

/** What a row has room for (ListLayout.swift `RowDetail`): records from medium, a lane from large. */
export type RowDetail = "compact" | "records" | "lane";

export function rowDetail(width: number): RowDetail {
  return width >= 460 ? "lane" : width >= 380 ? "records" : "compact";
}

export interface ScheduleRowProps {
  readonly item: ScheduleItem;
  /** The item as the scores list sees it now (live), or its own event. */
  readonly event: ScoreEvent;
  readonly keyboard: boolean;
  readonly detail: RowDetail;
  /** Hide the competition when the page is that competition. */
  readonly showsCompetition: boolean;
  /** A collapsed tournament day that's open. */
  readonly expanded?: boolean;
  /** Results' Show Details: scorers, decisions or performers under the teams. */
  readonly details?: boolean;
  /** Set when the row appears because its day was just unfolded: text reveals after this delay. */
  readonly revealDelay?: number | null;
  /** While its day toggles: the crests that travel to and from the folded preview. */
  readonly travel?: { readonly section: string; readonly ids: ReadonlySet<string> } | null;
  readonly onHover: (id: string) => void;
  /** Rows that don't link to a game (a tournament day, a climbing round). */
  readonly onSelect?: (item: ScheduleItem, viaKeyboard: boolean) => void;
}

function ScheduleRowView({ item, event, keyboard, detail, showsCompetition, expanded = false, details = true, revealDelay, travel, onHover, onSelect }: ScheduleRowProps) {
  const followed = useSettings((s) => s.followed);
  const isFollowed = (c: Competitor) => c.id != null && followed.some((t) => t.id === c.id);
  const lane = detail === "lane";
  const reveal = revealDelay != null ? { className: styles.reveal, style: { animationDelay: `${revealDelay}s` } as CSSProperties } : null;
  // A game that didn't happen recedes; one that was stopped keeps its score, quietly; a forfeit's score isn't one.
  const postponed = item.status === "postponed" && item.result?.kind !== "suspended";
  const showsScores = item.result?.kind !== "forfeit";
  const quietScores = item.result?.kind === "abandoned";
  const dimmed = item.ifNecessary || item.status === "canceled";
  const caption = captionLine(item, event, showsCompetition, details);
  const label = spokenRow(item, event, showsCompetition);
  const content = (
    <>
      <span className={styles.teams} aria-hidden="true">
        {event.content.kind === "match" ? (
          <>
            <TeamLine c={event.content.top} event={event} postponed={postponed} records={detail !== "compact"} followed={isFollowed(event.content.top)} showsScore={showsScores} quiet={quietScores} reveal={reveal} travel={travel} />
            <TeamLine c={event.content.bottom} event={event} postponed={postponed} records={detail !== "compact"} followed={isFollowed(event.content.bottom)} showsScore={showsScores} quiet={quietScores} reveal={reveal} travel={travel} />
          </>
        ) : (
          <span className={reveal?.className} style={reveal?.style}>
            <span className={styles.fieldTitle}>
              {item.title}
              {item.children ? <Icon name="chevronRight" size={8} className={styles.dayChevron} data-open={expanded} /> : null}
            </span>
            {item.subtitle && !lane ? <span className={styles.fieldSubtitle}>{item.subtitle}</span> : null}
          </span>
        )}
        {!lane && caption ? (
          <span className={[styles.caption, reveal?.className].filter(Boolean).join(" ")} style={reveal?.style}>
            <Caption text={caption} />
          </span>
        ) : null}
      </span>
      {lane ? (
        <span className={[styles.lane, reveal?.className].filter(Boolean).join(" ")} style={reveal?.style} aria-hidden="true">
          <LaneLines item={item} event={event} showsCompetition={showsCompetition} details={details} />
        </span>
      ) : null}
      <span className={[styles.status, reveal?.className].filter(Boolean).join(" ")} style={reveal?.style} aria-hidden="true">
        <StatusColumn item={item} event={event} networks={lane ? 2 : 1} />
      </span>
    </>
  );
  const common = {
    className: styles.row,
    "data-nav-id": item.id,
    "data-keyboard": keyboard,
    "data-dimmed": dimmed,
    "data-lane": lane,
    "aria-label": label,
    title: item.result ? tooltip(item) : undefined,
    onPointerEnter: () => onHover(item.id),
  };
  if (onSelect || item.children || item.ref.kind === "climbing") {
    return (
      <button type="button" {...common} aria-expanded={item.children ? expanded : undefined} onClick={(e: MouseEvent) => onSelect?.(item, e.detail === 0)}>
        {content}
      </button>
    );
  }
  return (
    <Link to={`/game/${encodeURIComponent(item.id)}`} {...common} draggable={false}>
      {content}
    </Link>
  );
}

/** A row redraws when what it shows changes, not when the list does. */
export const ScheduleRow = memo(ScheduleRowView, (a, b) => {
  return (
    a.item === b.item &&
    a.event === b.event &&
    a.keyboard === b.keyboard &&
    a.detail === b.detail &&
    a.showsCompetition === b.showsCompetition &&
    a.expanded === b.expanded &&
    a.details === b.details &&
    a.revealDelay === b.revealDelay &&
    a.travel === b.travel &&
    a.onHover === b.onHover &&
    a.onSelect === b.onSelect
  );
});

function TeamLine({
  c,
  event,
  postponed,
  records,
  followed,
  showsScore,
  quiet,
  reveal,
  travel,
}: {
  c: Competitor;
  event: ScoreEvent;
  postponed: boolean;
  records: boolean;
  followed: boolean;
  showsScore: boolean;
  quiet: boolean;
  reveal: { className: string | undefined; style: CSSProperties } | null;
  travel: ScheduleRowProps["travel"];
}) {
  const crest = travel ? travelID(travel.section, c) : null;
  const dimmed = postponed || stepsBack(event, c);
  const record = c.record ? enDash(c.record) : null;
  const score = showsScore ? c.score : null;
  const showRecord = records && record != null && recordFits({ name: c.name, rank: c.rank, marks: followed ? 1 : 0, record, score });
  return (
    <span className={[styles.line, dimmed ? styles.dimmed : null].filter(Boolean).join(" ")}>
      {/* The crest stays opaque so it can travel in from the folded day's preview; only the text reveals around it. */}
      <TravelingLogo team={c} size={16} travelID={crest && travel?.ids.has(crest) ? crest : null} />
      <span className={[styles.line, reveal?.className].filter(Boolean).join(" ")} style={{ flex: 1, ...reveal?.style }}>
        <span className={styles.identity}>
          {c.rank != null ? (
            <span className={styles.rank} title={`No. ${c.rank} in the AP Top 25`}>
              {c.rank}
            </span>
          ) : null}
          <span className={styles.name}>{c.name}</span>
        </span>
        {followed ? <Icon name="star" size={7.5} className={styles.star} /> : null}
        {showRecord ? <span className={styles.record}>{record}</span> : null}
        <span className={styles.spacer} />
        {score != null ? <span className={[styles.score, quiet ? styles.quiet : null].filter(Boolean).join(" ")}>{score}</span> : null}
      </span>
    </span>
  );
}

/** A caption with the parser's red-card mark drawn as the card itself. */
function Caption({ text }: { text: string }) {
  if (!text.includes(RED_CARD)) return <>{text}</>;
  const parts = text.split(RED_CARD);
  const out: ReactNode[] = [parts[0]];
  parts.slice(1).forEach((part, i) => {
    out.push(<span key={i} className={styles.redCard} role="img" aria-label="Red card" />, part);
  });
  return <>{out}</>;
}

/**
 * The line under the teams, one line, never two: live, the situation; a
 * result, its knockout context, else (Show Details) its scorers, decisions
 * or performers; otherwise competition and notes.
 */
export function captionLine(item: ScheduleItem, event: ScoreEvent, showsCompetition: boolean, details: boolean): string | null {
  if (event.state === "live" && event.liveLine) return event.liveLine;
  const competition = showsCompetition ? item.competition : null;
  if (item.result && event.state === "final") {
    const story = item.result.context ?? (details ? item.result.details : null) ?? (item.notes.length ? item.notes.join(" · ") : null);
    return [competition, story].filter(Boolean).join(" · ") || null;
  }
  return [competition, ...item.notes].filter(Boolean).join(" · ") || null;
}

/** The wide row's middle column: where it's played over what it is; a result's details over its context. */
function LaneLines({ item, event, showsCompetition, details }: { item: ScheduleItem; event: ScoreEvent; showsCompetition: boolean; details: boolean }) {
  const competition = showsCompetition ? item.competition : null;
  let primary: string | null;
  let secondary: string | null;
  if (event.state === "live" && event.liveLine) primary = event.liveLine;
  else if (isField(item)) primary = item.subtitle;
  else if (item.result && event.state === "final" && details && (item.result.detailsWide ?? item.result.details)) primary = item.result.detailsWide ?? item.result.details;
  else primary = item.venue;
  if (item.result && event.state === "final") {
    const story = item.result.context ?? (item.notes.length ? item.notes.join(" · ") : null);
    if (competition || story) secondary = [competition, story].filter(Boolean).join(" · ");
    else if (!details || !(item.result.detailsWide ?? item.result.details)) secondary = attendance(item);
    else secondary = [item.venue?.split(" · ")[0], attendance(item)].filter(Boolean).join(" · ") || null;
  } else {
    secondary = [competition, ...item.notes].filter(Boolean).join(" · ") || null;
  }
  return (
    <span title={[primary, secondary].filter(Boolean).join("\n")}>
      {primary ? (
        <span className={styles.laneLine}>
          <Caption text={primary} />
        </span>
      ) : null}
      {secondary ? <span className={styles.laneLine}>{secondary}</span> : null}
    </span>
  );
}

function attendance(item: ScheduleItem): string | null {
  const a = item.result?.attendance;
  return a ? `Attendance ${a.toLocaleString()}` : null;
}

/**
 * Time, then network. Within three hours a countdown takes the first line;
 * games without a time say so plainly; live and final read as in the list.
 * A stopped, moved or abandoned game says so in orange (never red: red is live).
 */
function StatusColumn({ item, event, networks }: { item: ScheduleItem; event: ScoreEvent; networks: number }) {
  if (event.state === "live") return <LiveStatus clock={event.clock} fallback={event.detail ?? item.statusDetail ?? "Live"} />;
  if (event.state === "final") {
    const warns = item.status !== "canceled" && (item.status === "postponed" || item.result?.kind === "suspended" || item.result?.kind === "abandoned");
    const second = resultSecondLine(item.result);
    return (
      <>
        <span className={warns ? styles.warn : styles.final}>{finalText(item, event)}</span>
        {second ? <span className={styles.second}>{second}</span> : null}
      </>
    );
  }
  return <ScheduledStatus item={item} event={event} networks={networks} />;
}

export function finalText(item: ScheduleItem, event: ScoreEvent): string {
  if (item.result?.label) return item.result.label;
  if (item.status === "postponed") return "Postponed";
  if (item.status === "canceled") return "Canceled";
  return event.detail ?? "Final";
}

function ScheduledStatus({ item, event, networks }: { item: ScheduleItem; event: ScoreEvent; networks: number }) {
  const date = startDate(item.start);
  const near = date != null && date - Date.now() < 24 * 3_600_000;
  const now = useNow(30_000, near);
  const second = item.networks.length ? item.networks.slice(0, networks).join(" · ") : item.format;
  switch (item.start.kind) {
    case "tba":
    case "tbc":
      return (
        <span
          className={styles.soon}
          title={
            item.start.kind === "tbc"
              ? "Date and time to be confirmed"
              : item.league === "college-football"
                ? "Kickoff time not announced yet. College times are usually set 6 to 12 days ahead."
                : "Start time not announced yet"
          }
        >
          {item.start.kind === "tba" ? "TBA" : "TBC"}
        </span>
      );
    case "provisional":
      return (
        <span className={styles.provisional} title={item.start.why === "tvPicks" ? "Kickoff times are confirmed about six weeks ahead, when TV picks are made." : "Order of play not set yet."}>
          <span className={styles.time}>{clockTime(item.start.date)}</span>
          <span className={styles.second}>Provisional</span>
        </span>
      );
    case "exact": {
      const start = item.start.date;
      if (isDelayed(event, now)) {
        return (
          <>
            <span className={styles.warn}>Delayed</span>
            <span className={styles.second}>{clockTime(start)}</span>
          </>
        );
      }
      if (start < now) return <span className={styles.soon}>{isField(item) ? "Time TBA" : "Starting soon"}</span>;
      const soon = start - now < 3 * 3_600_000 ? countdown(start, now) : null;
      if (soon) {
        return (
          <>
            <span className={styles.countdown}>{soon}</span>
            <span className={styles.second}>{clockTime(start)}</span>
          </>
        );
      }
      return (
        <>
          <span className={styles.time}>{clockTime(start)}</span>
          {second ? (
            <span className={styles.second} title={item.networks.join(", ")}>
              {second}
            </span>
          ) : null}
        </>
      );
    }
  }
}

// MARK: - Words

/** "ARS 2–0 EVE", or the date when there's no score. */
export function resultShort(item: ScheduleItem): string | null {
  const { top, bottom } = item;
  if (!top || !bottom || top.score == null || bottom.score == null) return null;
  return `${top.abbreviation} ${top.score}–${bottom.score} ${bottom.abbreviation}`;
}

const spokenDay = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" });

/** What a screen reader says for a row (ScheduleSpeech.row). */
export function spokenRow(item: ScheduleItem, event: ScoreEvent, showsCompetition = true): string {
  const parts: string[] = [];
  if (item.top && item.bottom) parts.push(`${item.top.name} ${item.sport === "soccer" || item.sport === "esports" ? "versus" : "at"} ${item.bottom.name}`);
  else if (item.title) {
    parts.push(item.title);
    if (item.subtitle) parts.push(item.subtitle);
  }
  const scores = event.content.kind === "match" && event.content.top.score != null && event.content.bottom.score != null ? `${event.content.top.score} to ${event.content.bottom.score}` : null;
  const now = Date.now();
  switch (event.state) {
    case "live":
      parts.push("Live");
      if (scores) parts.push(scores);
      parts.push(spokenEventStatus(event, now));
      break;
    case "final":
      if (item.status === "postponed") parts.push("Postponed");
      else if (item.status === "canceled") parts.push("Canceled");
      else {
        if (scores) parts.push(scores);
        parts.push(spokenEventStatus(event, now));
        const r = spokenResult(event, item.sport);
        if (r) parts.push(r);
      }
      break;
    case "scheduled":
      if (isDelayed(event, now)) parts.push("Delayed");
      switch (item.start.kind) {
        case "exact":
          parts.push(clockTime(item.start.date));
          break;
        case "provisional":
          parts.push(`${clockTime(item.start.date)}, provisional`);
          break;
        case "tba":
          parts.push("time to be announced");
          break;
        case "tbc":
          parts.push("date and time to be confirmed");
          break;
      }
      if (item.networks[0]) parts.push(`on ${item.networks[0]}`);
  }
  if (item.ifNecessary) parts.push("if necessary");
  if (event.state === "final" && item.result?.spoken) {
    const day = spokenDay.format(new Date(item.day.year, item.day.month - 1, item.day.day, 12));
    return [showsCompetition && item.competition ? `${item.competition}.` : null, item.result.spoken, `${day}.`].filter(Boolean).join(" ");
  }
  parts.push(...[showsCompetition ? item.competition : null, ...item.notes].filter((p): p is string => !!p));
  return parts.join(", ");
}

/** The row's tooltip: when it started, where, who came, the recap's headline, and the details in full. */
export function tooltip(item: ScheduleItem): string {
  const parts: string[] = [];
  const date = startDate(item.start);
  if (date != null) {
    const verb = item.sport === "soccer" || item.sport === "football" ? "Kicked off" : item.sport === "basketball" ? "Tipped off" : item.sport === "baseball" ? "First pitch" : "Started";
    parts.push(`${verb} ${clockTime(date)}`);
  }
  if (item.venue) parts.push(item.venue.replaceAll(" · ", ", "));
  const r = item.result;
  if (r?.attendance) parts.push(r.attendance.toLocaleString());
  if (r?.headline) parts.push(r.headline);
  const lines = [parts.join(" · ")];
  if (r?.context) lines.push(r.context);
  const d = r?.detailsWide ?? r?.details;
  if (d) lines.push(d.replaceAll(`${RED_CARD} `, "Red card: "));
  return lines.filter(Boolean).join("\n");
}

/** Copy: "AVL 2–1 MNC · FT · Jackson 6', 60' · Haaland 52'". */
export function copyText(item: ScheduleItem): string {
  const r = item.result;
  const parts = [resultShort(item)];
  if (r) {
    parts.push([r.label, resultSecondLine(r)].filter(Boolean).join(" "));
    if (r.context) parts.push(r.context);
    if (r.details) parts.push(r.details.replaceAll(`${RED_CARD} `, "Red card "));
  }
  return parts.filter(Boolean).join(" · ");
}

export { competitorKey };
