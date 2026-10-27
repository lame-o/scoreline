/**
 * The docked scorebar (DockedScorebar.swift): as the hero scrolls away, a
 * compact glass bar settles in just below the header with the score, the
 * clock and one per-sport live detail (bases and outs for baseball, the down
 * for football), the way a large title becomes the inline title.
 *
 * It's an overlay on the page (a zero-height sticky slot), so it never
 * changes the page's layout. The page's geometry moves it by its quantized
 * dock progress (from 96% and 6pt up, fading in over 0.35…0.9 of the way;
 * clickable from half docked), never on a timer, so it's continuous,
 * reversible and can't fall out of sync with the scroll. Once it's the
 * scoreboard on screen it plays the score beats (the pop and the pill) and
 * ticks the clock instead of the hero. When a captioned moment's chart is
 * out of view, the status slot shows the moment instead of the clock (the
 * news line), so one moment is told in one place. A click goes back to the top.
 *
 * Screen readers skip it: the hero stays the page's one scoreboard.
 */
import { memo, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { LiveStatus, TeamLogo } from "../../../design/components";
import { countdownClock, dayAndTime } from "../../../data/format";
import { Accessory, finalText, newsLineShows, type AccessoryTier, type HeroBeats, type Surface } from "../../../data/matchRules";
import { captioned, type LiveMoment } from "../../../data/moments";
import { stepsBack, type GameClock, type ScoreEvent, type Side } from "../../../data/models";
import { sectionForChart } from "../../../data/sections";
import type { TeamPalette } from "../../../data/teamColors";
import { useNow } from "../../../state/clock";
import { useWidth } from "../../../design/useWidth";
import { useSectionVisibility, type PageGeometry } from "./geometry";
import { BeatScore } from "./Hero";
import { useCurrentMoment } from "./moments";
import { PossessionFlight, PossessionSlot, usePossessionToss } from "./possession";
import styles from "./DockedScorebar.module.css";

export interface DockedScorebarProps {
  readonly geometry: PageGeometry;
  readonly event: ScoreEvent;
  readonly palette: TeamPalette | null;
  readonly scores: { top: string | null; bottom: string | null };
  readonly beats: HeroBeats;
  readonly surface: Surface;
  readonly clockFallback: string;
  /** The live clock (a fast lane's reading, else the scoreboard's). */
  readonly clock?: GameClock | null;
  /** Football and the NBA, live: who has the ball (null: nobody yet). Absent for sports without possession. */
  readonly possession?: Side | null;
  readonly stale: boolean;
  /** The sport's live detail beside the score, given how much room there is. */
  readonly detail?: (tier: AccessoryTier) => ReactNode;
  /** One state chip (2-MIN DRILL, CLUTCH, BASES LOADED…). */
  readonly chip?: string | null;
}

/** The bar's slot: sticky under the header, zero height, so the page never moves for it. */
export function DockedScorebar(props: DockedScorebarProps) {
  const { geometry } = props;
  return (
    <div className={styles.slot}>
      <div
        className={styles.host}
        ref={(el) => {
          geometry.bar = el;
          if (el) geometry.update();
        }}
        style={{ visibility: "hidden", opacity: 0 }}
      >
        <BarContent {...props} />
      </div>
    </div>
  );
}

const BarContent = memo(function BarContent({ geometry, event, palette, scores, beats, surface, clockFallback, clock, possession, stale, detail, chip }: DockedScorebarProps) {
  const box = useRef<HTMLButtonElement>(null);
  const width = useWidth(box, 360);
  const moment = useCurrentMoment();
  const chartVisibility = useSectionVisibility(geometry, moment ? sectionForChart(moment.chart) : null);
  const news = moment && newsLineShows(captioned(moment), chartVisibility) ? moment : null;
  const digits = (s: string | null) => (s ?? "").replace(/\D/g, "").length;
  const tier = (() => {
    const w = width - 24;
    if (w < 300) return digits(scores.top) >= 3 && digits(scores.bottom) >= 3 ? Accessory.none : Accessory.glyph;
    if (w < 380) return Accessory.text;
    return Accessory.full;
  })() as AccessoryTier;
  const live = event.state === "live";
  const onBar = surface === "bar";
  // The ball beside the team that has it (football, the NBA), from the glyph tier up.
  const toss = usePossessionToss({ possession: possession ?? null, live, geometry, container: box });
  const glyph = event.ref?.kind === "espn" && event.ref.sport === "basketball" ? "basketball" : "football";
  const slots = live && possession !== undefined && tier >= Accessory.glyph;
  return (
    <button ref={box} type="button" className={styles.bar} onClick={() => geometry.scrollToTop()} title="Back to top" aria-hidden="true" tabIndex={-1}>
      <span className={styles.lead}>
        {event.content.kind === "match" ? (
          <>
            <span className={styles.team}>
              <TeamLogo url={event.content.top.logo} size={18} />
              {event.content.top.rank != null ? <span className={styles.rank}>{event.content.top.rank}</span> : null}
              <span className={styles.abbr}>{event.content.top.abbreviation}</span>
              {slots ? <PossessionSlot side="top" toss={toss} glyph={glyph} /> : null}
            </span>
            <span className={styles.scores}>
              {event.state === "scheduled" || (scores.top == null && scores.bottom == null) ? (
                <span className={styles.vs}>vs</span>
              ) : (
                <>
                  <BeatScore value={scores.top} live={live} dimmed={stepsBack(event, event.content.top)} pops={beats.pops.top} color={palette?.top ?? "var(--accent)"} active={onBar} />
                  <span className={styles.dash}>–</span>
                  <BeatScore value={scores.bottom} live={live} dimmed={stepsBack(event, event.content.bottom)} pops={beats.pops.bottom} color={palette?.bottom ?? "var(--accent)"} active={onBar} />
                </>
              )}
            </span>
            <span className={styles.team}>
              {slots ? <PossessionSlot side="bottom" toss={toss} glyph={glyph} /> : null}
              {event.content.bottom.rank != null ? <span className={styles.rank}>{event.content.bottom.rank}</span> : null}
              <span className={styles.abbr}>{event.content.bottom.abbreviation}</span>
              <TeamLogo url={event.content.bottom.logo} size={18} />
            </span>
          </>
        ) : (
          <span className={styles.abbr}>{event.content.title}</span>
        )}
      </span>
      {live ? <Accessories tier={tier} detail={detail} chip={chip ?? null} /> : <span className={styles.accessories} />}
      <span className={styles.status}>
        {news ? <NewsLine moment={news} full={tier >= Accessory.full} /> : <Status event={event} clock={clock ?? event.clock} clockFallback={clockFallback} stale={stale} ticking={onBar} />}
      </span>
      {slots ? <PossessionFlight toss={toss} glyph={glyph} /> : null}
    </button>
  );
});

/**
 * The sport's detail and the chip, as much as fits (the Mac's ViewThatFits
 * over three rows): the fullest the width tier allows, then the short text
 * with the chip, then the glyphs alone. Each row is measured off screen
 * after every render (a few spans), so a longer down or a chip arriving
 * steps down before it can clip.
 */
function Accessories({ tier, detail, chip }: { tier: AccessoryTier; detail?: (tier: AccessoryTier) => ReactNode; chip: string | null }) {
  const host = useRef<HTMLSpanElement>(null);
  const rows = useRef<HTMLSpanElement>(null);
  const [pick, setPick] = useState(0);
  const variants: { tier: AccessoryTier; chip: boolean }[] = [
    { tier, chip: true },
    { tier: Math.min(tier, Accessory.text) as AccessoryTier, chip: true },
    { tier: Math.min(tier, Accessory.glyph) as AccessoryTier, chip: false },
  ];
  const row = (v: { tier: AccessoryTier; chip: boolean }) => (
    <>
      {detail ? detail(v.tier) : null}
      {v.chip && chip && v.tier >= Accessory.text ? <span className={styles.chip}>{chip}</span> : null}
    </>
  );
  useLayoutEffect(() => {
    const room = host.current?.clientWidth ?? 0;
    const measured = [...(rows.current?.children ?? [])].map((el) => el.getBoundingClientRect().width);
    let next = measured.findIndex((w) => w <= room + 0.5);
    if (next < 0) next = measured.length - 1;
    if (next !== pick && next >= 0) setPick(next);
  });
  return (
    <span ref={host} className={styles.accessories}>
      {row(variants[Math.min(pick, 2)]!)}
      <span ref={rows} className={styles.measure} aria-hidden="true">
        {variants.map((v, i) => (
          <span key={i}>{row(v)}</span>
        ))}
      </span>
    </span>
  );
}

/** `MomentCaption`'s type: a red dot, the outcome, then (with room) the play. */
function NewsLine({ moment, full }: { moment: LiveMoment; full: boolean }) {
  return (
    <span className={styles.news} key={moment.id}>
      <span className={styles.newsDot} />
      <strong>{moment.lead}</strong>
      {full && moment.detail ? <span className={styles.newsDetail}>{moment.detail}</span> : null}
    </span>
  );
}

function Status({ event, clock, clockFallback, stale, ticking }: { event: ScoreEvent; clock: GameClock | null; clockFallback: string; stale: boolean; ticking: boolean }) {
  const now = useNow(ticking && event.state === "scheduled" ? 1000 : 60_000, event.state === "scheduled");
  switch (event.state) {
    case "live":
      return (
        <span className={styles.statusLive} key="live">
          <LiveStatus clock={event.ref?.kind === "espn" && event.ref.sport === "baseball" ? null : clock} fallback={clockFallback} size={11} animated={!stale && ticking} />
        </span>
      );
    case "final":
      return (
        <span className={styles.statusQuiet} key="final">
          {finalText(event.detail)}
        </span>
      );
    case "scheduled": {
      const detail = event.detail?.toLowerCase() ?? "";
      if (["postpon", "cancel", "suspend", "delay"].some((w) => detail.includes(w))) return <span className={styles.statusQuiet}>{event.detail}</span>;
      const clock = countdownClock(event.start, now);
      if (clock) return <span className={styles.countdown}>Starts in {clock}</span>;
      return <span className={styles.statusQuiet}>{event.start < now ? "Starting soon" : dayAndTime(event.start, now)}</span>;
    }
  }
}

/** Outs as three 4pt dots (filled: out). */
export function OutDots({ outs }: { outs: number }) {
  return (
    <span className={styles.outs}>
      {[0, 1, 2].map((i) => (
        <span key={i} data-on={i < outs} />
      ))}
    </span>
  );
}

/** The tile's 13 × 9 bases, a touch larger on the bar's glass (TileStrips.swift `MiniBases`). */
export function MiniBases({ bases }: { bases: readonly [boolean, boolean, boolean] }) {
  return (
    <span className={styles.miniBases}>
      <span data-base="second" data-on={bases[1]} />
      <span data-base="first" data-on={bases[0]} />
      <span data-base="third" data-on={bases[2]} />
    </span>
  );
}
