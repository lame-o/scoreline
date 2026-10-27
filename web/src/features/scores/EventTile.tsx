/**
 * EventTile: a miniature of the match page's hero (Tiles.swift). Crests face
 * each other with the score between them; live large tiles sit on their
 * teams' colors with the sport's strip underneath; a large next-up tile
 * counts down; small tiles are dense (a live baseball one draws the bases
 * after the batting team's name). The tile is a link to the game; its menu
 * opens by right-click, long press, the "…" on hover or Shift-F10
 * (GameMenu.tsx). A pinned game wears a pin in its header.
 */
import { memo, type CSSProperties } from "react";
import { Link } from "react-router";
import { Icon, LiveStatus, ScoreDigits, SPORT_ICON } from "../../design/components";
import { countdown, countdownClock, clockTime, dayAndTime, dayName, enDash, isDelayed, spokenSummary, unplayed } from "../../data/format";
import { eventSport, stepsBack, type BaseState, type Competitor, type League, type ScoreEvent, type Side } from "../../data/models";
import { lastGoalLine } from "../../data/soccer";
import { sameEvent, type TileSize } from "../../data/scoreboard";
import { teamPalette, washStrength, NEUTRAL, type TeamPalette } from "../../data/teamColors";
import { FLAG_PALETTE } from "../../data/teams";
import { useNow } from "../../state/clock";
import { useIsPinned } from "../../state/pin";
import { useColorScheme } from "../../state/theme";
import { GameMenuHost } from "./GameMenu";
import { textWidth } from "./measure";
import { TravelingLogo, travelID } from "./sections";
import { hasStrip, MiniBases, stripMeaning, TileStrip } from "./TileStrips";
import styles from "./Tiles.module.css";

export interface EventTileProps {
  readonly event: ScoreEvent;
  readonly size: TileSize;
  readonly league: League | null;
  readonly followed: readonly string[];
  readonly keyboard: boolean;
  readonly selected: boolean;
  readonly stale: boolean;
  /** The room inside a tile of this size, in Mac points (decides full names or abbreviations). */
  readonly inner: number;
  readonly revealDelay: number | null;
  readonly travel: { readonly section: string; readonly ids: ReadonlySet<string> } | null;
  readonly onHover: (id: string) => void;
  readonly className?: string;
}

function EventTileView(props: EventTileProps) {
  const { event, size, league, followed, keyboard, selected, stale, revealDelay, onHover, className } = props;
  const scheme = useColorScheme();
  const pinned = useIsPinned(event.id);
  const now = Date.now();
  const sport = eventSport(event);
  const match = event.content.kind === "match" ? event.content : null;
  const palette = match ? teamPalette(match.top.color, match.bottom.color, scheme) : null;
  const reveal = revealDelay != null ? ({ className: styles.reveal, style: { animationDelay: `${revealDelay}s` } } as const) : null;
  const presentation = size === "large" ? (event.state === "live" ? "live" : "nextUp") : event.state === "live" ? "liveSmall" : "small";

  const label = [
    spokenSummary(event, sport, now),
    pinned ? "In the tab" : null,
    event.content.kind === "field" && event.content.summary ? event.content.summary : null,
    ...(match ? [match.top, match.bottom].filter((c) => c.id && followed.includes(c.id)).map((c) => `Following ${c.name}`) : []),
    event.state === "live" && event.liveLine && event.snapshot?.kind !== "football" && event.snapshot?.kind !== "baseball" ? event.liveLine : null,
    league?.name,
    stripMeaning(event),
    event.caption,
  ]
    .filter(Boolean)
    .join(", ");

  const wash = presentation === "live" ? tileWash(event, palette) : null;
  return (
    <GameMenuHost event={event} className={[styles.tileWrap, className].filter(Boolean).join(" ")} buttonClassName={styles.tileMore}>
    <Link
      to={`/game/${encodeURIComponent(event.id)}`}
      className={styles.tile}
      data-size={size}
      data-nav-id={event.id}
      data-keyboard={keyboard}
      aria-current={selected ? "page" : undefined}
      aria-label={label}
      onPointerEnter={() => onHover(event.id)}
      title={size === "small" ? tooltip(event) : undefined}
      draggable={false}
    >
      {wash ? <span className={[styles.wash, reveal?.className].filter(Boolean).join(" ")} style={{ background: wash, ...reveal?.style }} aria-hidden="true" /> : null}
      <span aria-hidden="true" style={{ display: "contents" }}>
        <TileHeader event={event} league={league} large={size === "large"} stale={stale} pinned={pinned} reveal={reveal} />
        {match && palette ? (
          presentation === "live" ? (
            <LiveLarge {...props} top={match.top} bottom={match.bottom} palette={palette} reveal={reveal} />
          ) : presentation === "nextUp" ? (
            <NextUpLarge {...props} top={match.top} bottom={match.bottom} reveal={reveal} />
          ) : (
            <Small {...props} top={match.top} bottom={match.bottom} reveal={reveal} />
          )
        ) : event.content.kind === "field" ? (
          <FieldContent event={event} title={event.content.title} summary={event.content.summary} large={size === "large"} reveal={reveal} />
        ) : null}
      </span>
    </Link>
    </GameMenuHost>
  );
}

export const EventTile = memo(EventTileView, (a, b) => {
  return (
    a.size === b.size &&
    a.league?.id === b.league?.id &&
    a.keyboard === b.keyboard &&
    a.selected === b.selected &&
    a.stale === b.stale &&
    a.inner === b.inner &&
    a.revealDelay === b.revealDelay &&
    a.travel === b.travel &&
    a.onHover === b.onHover &&
    a.className === b.className &&
    a.followed.join() === b.followed.join() &&
    sameEvent(a.event, b.event)
  );
});

type Reveal = { readonly className: string | undefined; readonly style: CSSProperties } | null;

/** Team colors (or a climber's flag), 30% of the hero wash's strength: a tile is small and there are many. */
function tileWash(event: ScoreEvent, palette: TeamPalette | null): string | null {
  let left: string;
  let right: string;
  let intensity = 1;
  if (palette) {
    left = palette.top;
    right = palette.bottom;
  } else {
    const flag = event.snapshot?.kind === "climbing" ? FLAG_PALETTE[wallCountry(event) ?? ""] : undefined;
    left = flag ? `#${flag[0]}` : "var(--accent)";
    right = flag ? `#${flag[1]}` : "var(--accent)";
    intensity = flag ? 0.85 : 0.6;
  }
  const strength = (c: string) => Math.round((c.startsWith("#") ? washStrength(c, intensity) : 0.6 * intensity) * 0.3 * 100);
  const edge = Math.round(4 * intensity);
  const mix = (c: string, pct: number) => `color-mix(in srgb, ${c === NEUTRAL ? "var(--viz-neutral)" : c} ${pct}%, transparent)`;
  return `linear-gradient(to right, ${mix(left, strength(left))}, ${mix(left, edge)}, ${mix(right, edge)}, ${mix(right, strength(right))})`;
}

function wallCountry(event: ScoreEvent): string | null {
  if (event.snapshot?.kind !== "climbing") return null;
  const phase = event.snapshot.wall.phase;
  return phase.kind === "lead" ? phase.climber.athlete.country : phase.athlete.country;
}

function tooltip(event: ScoreEvent): string {
  if (event.content.kind === "match") {
    return [`${event.content.top.name} vs ${event.content.bottom.name}`, event.state === "live" ? event.liveLine : null, event.caption].filter(Boolean).join(" · ");
  }
  return [event.content.title, event.content.summary, event.caption].filter(Boolean).join(" · ");
}

// MARK: - Header

function TileHeader({ event, league, large, stale, pinned, reveal }: { event: ScoreEvent; league: League | null; large: boolean; stale: boolean; pinned: boolean; reveal: Reveal }) {
  const name = large ? league?.name : league?.shortName;
  return (
    <span className={[styles.header, reveal?.className].filter(Boolean).join(" ")} style={reveal?.style}>
      <Icon name={league ? SPORT_ICON[league.sport] : "sportscourt"} size={9.5} />
      <span className={styles.league}>{name}</span>
      <span className={styles.headerSpacer} />
      {pinned ? (
        <span className={styles.pin} title="Shown in the tab">
          <Icon name="pin" size={8.5} />
        </span>
      ) : null}
      <span className={styles.headerStatus}>
        <TileStatus event={event} large={large} stale={stale} />
      </span>
    </span>
  );
}

/** Live: the dot and clock. Scheduled and final follow the list's rules, so both views agree. */
function TileStatus({ event, large, stale }: { event: ScoreEvent; large: boolean; stale: boolean }) {
  const now = useNow(30_000, event.state === "scheduled");
  switch (event.state) {
    case "live":
      return <LiveStatus clock={event.clock} fallback={event.detail ?? "Live"} size={large ? 11 : 10.5} animated={!stale} />;
    case "final":
      // A postponed game says so in the center; the header doesn't repeat it.
      if (event.content.kind === "match" && event.content.top.score == null && event.content.bottom.score == null) return null;
      return <span title={event.detail ?? "Final"}>{event.detail ?? "Final"}</span>;
    case "scheduled": {
      if (large) return <span>{dayAndTime(event.start, now)}</span>;
      if (isDelayed(event, now)) return <span>{clockTime(event.start)}</span>;
      if (event.start < now) return null;
      if (event.start - now < 3 * 3_600_000) return <span>{clockTime(event.start)}</span>;
      return <span>{dayName(event.start, now)}</span>;
    }
  }
}

// MARK: - Face-offs

type FaceProps = EventTileProps & { top: Competitor; bottom: Competitor; reveal: Reveal };

function ball(event: ScoreEvent, top: Competitor, bottom: Competitor): Side | null {
  if (event.state !== "live" || !event.possession) return null;
  return event.possession === top.id ? "top" : event.possession === bottom.id ? "bottom" : null;
}

/** Large: whether both full names fit their columns (both sides always use the same form). */
function fullNamesFit(top: Competitor, bottom: Competitor, inner: number, followed: readonly string[], ballSide: Side | null): boolean {
  const column = (Math.min(inner, 360) - 6 * 2 - 90) / 2;
  const fits = (c: Competitor, side: Side) => {
    let used = textWidth(c.name, 11.5, 500);
    if (c.rank != null) used += textWidth(String(c.rank), 10, 600) + 3;
    if (ballSide === side) used += 12;
    if (c.id && followed.includes(c.id)) used += 11;
    return used <= column;
  };
  return fits(top, "top") && fits(bottom, "bottom");
}

function NameLine({ c, full, followed, hasBall, dimmed, bases = null }: { c: Competitor; full: boolean; followed: boolean; hasBall: boolean; dimmed: boolean; bases?: BaseState | null }) {
  return (
    <span className={[styles.nameLine, dimmed ? styles.dimmed : null].filter(Boolean).join(" ")}>
      {c.rank != null ? <span className={styles.rank}>{c.rank}</span> : null}
      <span className={styles.name}>{full ? c.name : c.abbreviation}</span>
      {bases ? <MiniBases state={bases} /> : null}
      {hasBall ? <Icon name="football" size={8} className={styles.ball} /> : null}
      {followed ? <Icon name="star" size={7.5} className={styles.star} /> : null}
    </span>
  );
}

function Crest({ c, size, props }: { c: Competitor; size: number; props: FaceProps }) {
  const id = props.travel ? travelID(props.travel.section, c) : null;
  return <TravelingLogo team={c} size={size} travelID={id && props.travel?.ids.has(id) ? id : null} />;
}

/** The score between the crests: digits roll and a scorer's number flashes (live); three digits step down a size. */
function TileScore({ event, top, bottom, large }: { event: ScoreEvent; top: Competitor; bottom: Competitor; large: boolean }) {
  const tight = Math.max(top.score?.length ?? 0, bottom.score?.length ?? 0) >= 3;
  const size = large ? (tight ? 24 : 28) : tight ? 15 : 20;
  const gap = large ? (tight ? 3 : 6) : tight ? 0 : 2;
  const live = event.state === "live";
  return (
    <span className={styles.score} style={{ fontSize: `calc(${size} * var(--pt))`, gap: `calc(${gap} * var(--pt))` }}>
      <ScoreDigits value={top.score} live={live} dimmed={stepsBack(event, top)} />
      <span className={styles.dash}>–</span>
      <ScoreDigits value={bottom.score} live={live} dimmed={stepsBack(event, bottom)} />
    </span>
  );
}

function LiveLarge(props: FaceProps & { palette: TeamPalette }) {
  const { event, top, bottom, followed, inner, palette, reveal } = props;
  const side = ball(event, top, bottom);
  const full = fullNamesFit(top, bottom, inner, followed, side);
  const strip = hasStrip(event);
  const line = liveText(event);
  return (
    <>
      <span className={styles.fill} />
      <span className={styles.faceoff}>
        <span className={styles.column}>
          <Crest c={top} size={34} props={props} />
          <span className={reveal?.className} style={reveal?.style}>
            <NameLine c={top} full={full} followed={!!top.id && followed.includes(top.id)} hasBall={side === "top"} dimmed={false} />
          </span>
        </span>
        <span className={[styles.center, reveal?.className].filter(Boolean).join(" ")} style={reveal?.style}>
          <TileScore event={event} top={top} bottom={bottom} large />
        </span>
        <span className={styles.column}>
          <Crest c={bottom} size={34} props={props} />
          <span className={reveal?.className} style={reveal?.style}>
            <NameLine c={bottom} full={full} followed={!!bottom.id && followed.includes(bottom.id)} hasBall={side === "bottom"} dimmed={false} />
          </span>
        </span>
      </span>
      <span className={styles.fill} />
      <span className={reveal?.className} style={reveal?.style}>
        {strip ? <TileStrip event={event} palette={palette} /> : null}
        {line ? (
          <span className={styles.detail} style={{ display: "block", marginTop: strip ? "calc(3 * var(--pt))" : 0 }}>
            {line}
          </span>
        ) : null}
      </span>
    </>
  );
}

/** The strip's words: the sport's live text, then the row's live line, then the caption. */
function liveText(event: ScoreEvent): string | null {
  const s = event.snapshot;
  switch (s?.kind) {
    case "baseball": {
      const matchup = [s.bases.batter ? `${s.bases.batter} batting` : null, s.bases.pitcher ? `${s.bases.pitcher} pitching` : null].filter(Boolean);
      if (matchup.length > 0) return matchup.join(" · ");
      break;
    }
    case "soccer":
      return lastGoalLine(s.marks) ?? event.caption;
    case "basketball":
      return event.liveLine ?? s.lastPlay ?? event.caption;
    case "counterStrike":
      return event.caption;
    default:
      break;
  }
  return event.liveLine ?? event.caption;
}

function NextUpLarge(props: FaceProps) {
  const { event, top, bottom, followed, inner, reveal } = props;
  const full = fullNamesFit(top, bottom, inner, followed, null);
  const column = (c: Competitor) => (
    <span className={styles.column}>
      <Crest c={c} size={34} props={props} />
      <span className={reveal?.className} style={{ ...reveal?.style, display: "flex", flexDirection: "column", alignItems: "center", gap: "calc(3 * var(--pt))", maxWidth: "100%" }}>
        <NameLine c={c} full={full} followed={!!c.id && followed.includes(c.id)} hasBall={false} dimmed={false} />
        {c.record ? <span className={styles.record}>{enDash(c.record)}</span> : null}
      </span>
    </span>
  );
  return (
    <>
      <span className={styles.fill} />
      <span className={styles.faceoff}>
        {column(top)}
        <span className={[styles.center, reveal?.className].filter(Boolean).join(" ")} style={reveal?.style}>
          <NextUpCountdown start={event.start} field={false} delayed={event.detail === "Delayed"} />
        </span>
        {column(bottom)}
      </span>
      <span className={styles.fill} />
      {event.caption ? (
        <span className={[styles.detail, reveal?.className].filter(Boolean).join(" ")} style={reveal?.style}>
          {event.caption}
        </span>
      ) : null}
    </>
  );
}

/** "in 2h 26m", refreshed every 30s; inside the last hour, a ticking "Starts in 14:33". */
function NextUpCountdown({ start, field, delayed }: { start: number; field: boolean; delayed: boolean }) {
  const lastHour = start - Date.now() < 3_600_000 && start > Date.now();
  const now = useNow(lastHour ? 1000 : 30_000);
  const seconds = (start - now) / 1000;
  let text: string;
  if (delayed && seconds <= 0) text = "Delayed";
  else if (seconds <= 0) text = field ? "Up next" : "Starting soon";
  else if (seconds < 3600) text = `Starts in ${countdownClock(start, now) ?? ""}`;
  else text = countdown(start, now) ?? dayAndTime(start, now);
  return <span className={[styles.countdown, delayed && seconds <= 0 ? styles.delayed : null].filter(Boolean).join(" ")}>{text}</span>;
}

function Small(props: FaceProps) {
  const { event, top, bottom, followed, inner, reveal } = props;
  const side = ball(event, top, bottom);
  const dimTop = stepsBack(event, top);
  const dimBottom = stepsBack(event, bottom);
  // Live baseball: the bases after the batting team's name (the away side bats in the top of an inning).
  const bases = event.state === "live" && event.snapshot?.kind === "baseball" ? event.snapshot.bases : null;
  const batting: Side | null = bases ? (/^(bot|mid)/i.test(event.detail ?? "") ? "bottom" : "top") : null;
  const nameWidth = (c: Competitor, side: Side) =>
    textWidth(c.name, 10, 500) + (c.rank != null ? textWidth(String(c.rank), 9, 600) + 3 : 0) + (c.id && followed.includes(c.id) ? 11 : 0) + (batting === side ? 17 : 0);
  const full = nameWidth(top, "top") + nameWidth(bottom, "bottom") + 10 <= inner;
  return (
    <>
      <span className={styles.fill} />
      <span className={styles.smallFaceoff}>
        <span className={styles.smallRow}>
          <Crest c={top} size={28} props={props} />
          <span className={[styles.center, reveal?.className].filter(Boolean).join(" ")} style={reveal?.style}>
            <SmallCenter event={event} top={top} bottom={bottom} />
          </span>
          <Crest c={bottom} size={28} props={props} />
        </span>
        <span className={[styles.smallNames, reveal?.className].filter(Boolean).join(" ")} style={reveal?.style}>
          <NameLine c={top} full={full} followed={!!top.id && followed.includes(top.id)} hasBall={side === "top"} dimmed={dimTop} bases={batting === "top" ? bases : null} />
          <NameLine c={bottom} full={full} followed={!!bottom.id && followed.includes(bottom.id)} hasBall={side === "bottom"} dimmed={dimBottom} bases={batting === "bottom" ? bases : null} />
        </span>
      </span>
    </>
  );
}

function SmallCenter({ event, top, bottom }: { event: ScoreEvent; top: Competitor; bottom: Competitor }) {
  const now = useNow(30_000, event.state === "scheduled");
  if (event.state !== "scheduled") {
    if (top.score == null && bottom.score == null && unplayed(event)) return <span className={styles.note}>{event.detail ?? "Postponed"}</span>;
    return <TileScore event={event} top={top} bottom={bottom} large={false} />;
  }
  if (isDelayed(event, now)) return <span className={`${styles.note} ${styles.delayed}`}>Delayed</span>;
  if (event.start < now) return <span className={styles.note}>Starting soon</span>;
  const soon = event.start - now < 3 * 3_600_000 ? countdown(event.start, now) : null;
  if (soon) return <span className={styles.smallCountdown}>{soon}</span>;
  return <span className={styles.smallTime}>{clockTime(event.start)}</span>;
}

// MARK: - Field events (climbing)

function FieldContent({ event, title, summary, large, reveal }: { event: ScoreEvent; title: string; summary: string; large: boolean; reveal: Reveal }) {
  const ref = event.ref?.kind === "climbing" ? event.ref : null;
  const subtitle = ref ? [ref.round, ref.eventName].filter(Boolean).join(" · ") : summary;
  if (large) {
    const detail = summary && !(ref?.round && summary === ref.round) ? summary : event.caption;
    return (
      <span className={reveal?.className} style={{ ...reveal?.style, display: "contents" }}>
        <span className={styles.fill} />
        <span className={styles.fieldRow}>
          <span className={styles.fieldGlyph}>
            <Icon name="climbing" size={22} />
          </span>
          <span className={styles.fieldText}>
            <span className={styles.fieldTitle}>{title}</span>
            <span className={styles.fieldSubtitle}>{subtitle || event.caption}</span>
          </span>
          {event.state !== "live" ? <NextUpCountdown start={event.start} field delayed={false} /> : null}
        </span>
        <span className={styles.fill} />
        {detail ? <span className={styles.detail}>{detail}</span> : null}
      </span>
    );
  }
  return (
    <span className={reveal?.className} style={{ ...reveal?.style, display: "contents" }}>
      <span className={styles.fill} />
      <span className={styles.smallTitle}>{title}</span>
      <span className={styles.smallLine}>{summary || event.caption}</span>
    </span>
  );
}
