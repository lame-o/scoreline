/**
 * The grown-up Win Probability section for a game Polymarket lists
 * (OddsChart.swift `OddsSection`, `OddsHeader`, `OddsFooter`,
 * `OddsFreshness`), following Polymarket: one line per outcome on a fixed
 * 0–100% scale (OddsPlot.tsx). Its own chunk, loaded as the page looks for
 * the game's market (WinProbabilitySection.tsx).
 *
 * - The legend is the header: each outcome's chance, big (a dot for identity,
 *   the name in secondary ink, the number in primary), with ESPN's model and
 *   DraftKings' pregame line as one muted line of numbers under it, the
 *   longest wording that fits. Pointing, both read that moment.
 * - The footer: freshness while live ("Live · 4s"), the money traded and the
 *   market on Polymarket; pointing, that moment in plain words. Held, the
 *   row also offers the way through the key plays and back.
 * - The title row's control: Game | 10 min while live; zoomed to a period,
 *   the way back to the whole game.
 *
 * While the page broadcasts (BROADCAST §3) the market is shown as it stood
 * at p (each tick at its own time ≤ p), redrawn when p reaches the next tick
 * or the 15 s beat (core/odds/inspection.tsx `PresentedTime`), never polled.
 */
import { useMemo, useRef, type CSSProperties } from "react";
import { chartHead, drawColor, endsLive, lineColor, makeChartData, percents, readingAt, readingLead, splitAt, usesFinalPercentages, windowLabel, type OddsChartData, type OddsLine, type OddsReading } from "../../../../data/odds/chart";
import { pregameWords, type OddsBasis } from "../../../../data/odds/espn";
import { effectiveWindow, emptyHistory, GAME, RECENT, type OddsWindow } from "../../../../data/odds/history";
import type { TimelineMark } from "../../../../data/odds/marks";
import { eventLink, normalized, percent, traded, type OddsSplit } from "../../../../data/odds/polymarket";
import type { OddsPointer } from "../../../../data/odds/pointer";
import type { TeamPalette } from "../../../../data/teamColors";
import { NEUTRAL } from "../../../../data/teamColors";
import { Icon, SegmentedControl } from "../../../../design/components";
import { useWidth } from "../../../../design/useWidth";
import { useNow } from "../../../../state/clock";
import { oddsNow, useOddsSnapshot, type OddsFeed, type OddsSnapshot } from "../../../../state/odds";
import { useColorScheme } from "../../../../state/theme";
import { ChartFooter, DetailSection } from "../DetailSection";
import { useLinkedStore } from "../linked";
import type { GameContext } from "../sport";
import { heartbeatLabel } from "../theater/TheaterStatus";
import { useReducedMotion } from "../useMedia";
import { PinControls, textWidth, usePointer, useUntil, WholeGameLink, type PresentedTime } from "./inspection";
import { OddsPlot } from "./OddsPlot";
import styles from "./Odds.module.css";

export interface OddsSectionProps {
  readonly game: GameContext;
  readonly feed: OddsFeed;
  readonly time: PresentedTime;
  readonly pointer: OddsPointer;
  readonly marks: readonly TimelineMark[];
  /** Two sides that must read apart: the page's colors, a clash stepping to an alternate. */
  readonly palette: TeamPalette;
  /** The section is on screen (the ends pulse only while they're seen). */
  readonly seen: boolean;
}

const css = (c: string) => (c === NEUTRAL ? "var(--viz-neutral)" : c);

/** The newest split from the feed (OddsFeed.latest): US the top team and its complement; soccer the three, normalized. */
function latestSplit(snapshot: OddsSnapshot): OddsSplit | null {
  const s = snapshot.series;
  if (snapshot.market?.kind === "three-way") {
    const a = s.top?.at(-1);
    const d = s.draw?.at(-1);
    const b = s.bottom?.at(-1);
    return a && d && b ? normalized(a.p, d.p, b.p) : null;
  }
  const top = s.top?.at(-1);
  return top ? { top: top.p, draw: null, bottom: 1 - top.p } : null;
}

export function OddsSection({ game, feed, time, pointer, marks, palette, seen }: OddsSectionProps) {
  const { event, detail, names, spoken } = game;
  const scheme = useColorScheme();
  const reduce = useReducedMotion();
  const linked = useLinkedStore();
  const snapshot = useOddsSnapshot(feed);
  const until = useUntil(time);
  const block = useRef<HTMLDivElement>(null);
  const width = useWidth(block);
  const state = event.state;
  const live = state === "live";
  const final = state === "final";
  const threeWay = snapshot.market?.kind === "three-way";
  const window = effectiveWindow(
    usePointer(pointer, (p) => p.window),
    state,
  );
  const basis = detail.odds;
  const history = detail.history;

  const data = useMemo(
    () => makeChartData({ feed: snapshot, basis, history: history ?? emptyHistory(basis.sport), state, window, eventStart: event.start, now: oddsNow(), until }),
    [snapshot, basis, history, state, window, event.start, until],
  );
  // Each outcome's line, in the legend's order: team lines held to their chroma floor, the draw receding.
  const lines = useMemo((): OddsLine[] => {
    const out: OddsLine[] = [{ outcome: "top", name: names.top, color: lineColor(palette.top) }];
    if (threeWay) out.push({ outcome: "draw", name: "Draw", color: drawColor(scheme) });
    out.push({ outcome: "bottom", name: names.bottom, color: lineColor(palette.bottom) });
    return out;
  }, [names.top, names.bottom, palette.top, palette.bottom, threeWay, scheme]);
  const latest = until == null ? (data ? chartHead(data)?.split : null) ?? latestSplit(snapshot) : (data ? chartHead(data)?.split : null) ?? null;
  // The market's channel is open (before the game too): its lines are live.
  const streaming = snapshot.transport != null;
  const what = threeWay ? "a line per outcome" : "a line per team";
  const caption = final ? `Polymarket's market through the game, ${what}.` : live ? `Polymarket's live market, ${what}.` : `Polymarket's market over the last day, ${what}.`;

  return (
    <DetailSection
      id="winProbability"
      title={final ? "How the Odds Moved" : "Win Probability"}
      accessory={live ? "live" : final ? "final" : undefined}
      caption={caption}
      trailing={
        data?.zoomed ? (
          <WholeGameLink pointer={pointer} />
        ) : live ? (
          <SegmentedControl<"game" | "recent">
            label="Window"
            value={window.kind === "recent" ? "recent" : "game"}
            options={[GAME, RECENT].map((w: OddsWindow) => ({ value: w.kind as "game" | "recent", label: windowLabel(w) }))}
            onChange={(value) => {
              pointer.setWindow(value === "recent" ? RECENT : GAME);
              pointer.clear(linked);
            }}
            className={styles.window}
          />
        ) : null
      }
    >
      <div ref={block} className={styles.block}>
        <OddsHeader data={data} latest={latest} lines={lines} basis={basis} names={names} spoken={spoken} state={state} espnNow={basis.win.at(-1)?.top ?? detail.topWinProbability} pointer={pointer} marks={marks} width={width} />
        <OddsPlot data={data} lines={lines} pointer={pointer} marks={marks} spoken={spoken} live={endsLive(final, streaming, seen, reduce)} width={width} scheme={scheme} />
        <OddsFooter feed={feed} snapshot={snapshot} data={data} basis={basis} pointer={pointer} marks={marks} top={names.top} live={live} ticking={seen && streaming} />
      </div>
    </DetailSection>
  );
}

// MARK: - Header

function OddsHeader({ data, latest, lines, basis, names, spoken, state, espnNow, pointer, marks, width }: {
  data: OddsChartData | null;
  latest: OddsSplit | null;
  lines: readonly OddsLine[];
  basis: OddsBasis;
  names: { top: string; bottom: string };
  spoken: { top: string; bottom: string };
  state: GameContext["event"]["state"];
  espnNow: number | null;
  pointer: OddsPointer;
  marks: readonly TimelineMark[];
  width: number;
}) {
  const moment = usePointer(pointer, (p) => p.moment);
  const reading = moment != null && data ? readingAt(moment, data, basis, marks) : null;
  const split = reading == null ? latest : reading.split;
  const finalPercentages = data ? usesFinalPercentages(data, reading?.t ?? null) : state === "final" && reading == null;
  const values = split ? percents(split, finalPercentages) : null;
  const muted = mutedLines(data, basis, names, state, espnNow);
  const shown = dedupe(reading == null ? muted : pregameOnly(basis, names, muted));
  // The longest wording that fits on one line (a wrap would orphan a source).
  const line = shown.find((l) => textWidth(l, 10.5, 400) <= width) ?? shown.at(-1) ?? null;
  return (
    <div className={styles.head}>
      <p className="visually-hidden">{spokenText(values, reading, muted, names, spoken)}</p>
      <div className={styles.legend} aria-hidden="true">
        {lines.map((l) => (
          <span key={l.outcome} className={styles.item}>
            <span className={styles.itemDot} style={{ background: css(l.color) } as CSSProperties} />
            <span className={styles.itemName}>{l.name}</span>
            <span className={styles.itemValue}>{values?.[l.outcome] != null ? `${values[l.outcome]}%` : "–"}</span>
          </span>
        ))}
      </div>
      {/* The line keeps its place while reading, so the plot never moves. */}
      <p className={styles.reference} aria-hidden="true">
        {line ?? " "}
      </p>
    </div>
  );
}

const dedupe = (lines: readonly string[]) => lines.filter((l, k) => lines.indexOf(l) === k);

/**
 * The muted line's wordings, longest first: "For GSW: ESPN 41% · DraftKings
 * 42% before tip-off", then shorter. A final looks back at where it began:
 * "GSW at tip-off: Polymarket 43% · ESPN 24% · DraftKings 42%".
 */
function mutedLines(data: OddsChartData | null, basis: OddsBasis, names: { top: string; bottom: string }, state: GameContext["event"]["state"], espnNow: number | null): string[] {
  const pregame = pregameWords(basis.sport);
  const dk = basis.pregame;
  if (dk && dk.draw != null) {
    const p = percents({ top: dk.top, draw: dk.draw, bottom: dk.bottom });
    const split = `${names.top} ${p.top ?? 0}% · Draw ${p.draw ?? 0}% · ${names.bottom} ${p.bottom ?? 0}%`;
    return [`DraftKings ${pregame}: ${split}`, `DraftKings: ${split}`];
  }
  if (state === "final") {
    const parts: string[] = [];
    const pm = basis.start != null && data ? splitAt(data, basis.start) : null;
    if (pm) parts.push(`Polymarket ${percent(pm.top)}%`);
    const espn = basis.win[0] ? `ESPN ${percent(basis.win[0].top)}%` : null;
    const book = dk ? `DraftKings ${percent(dk.top)}%` : null;
    const lead = `${names.top} ${pregame.replace("before ", "at ")}: `;
    const full = [...parts, ...[espn, book].filter((x): x is string => x != null)];
    if (full.length === 0) return [];
    return [full, [...parts, ...(book ? [book] : [])], parts].filter((x) => x.length > 0).map((x) => lead + x.join(" · "));
  }
  const parts = [espnNow != null ? `ESPN ${percent(espnNow)}%` : null, dk ? `DraftKings ${percent(dk.top)}%` : null].filter((x): x is string => x != null);
  if (parts.length === 0) return [];
  const short = `For ${names.top}: ${parts.join(" · ")}`;
  return dk == null ? [short] : [`${short} ${pregame}`, short];
}

/** While reading a moment, today's ESPN number would be the wrong game: only what doesn't change with the moment (DraftKings before the game). */
function pregameOnly(basis: OddsBasis, names: { top: string }, muted: readonly string[]): string[] {
  const dk = basis.pregame;
  if (!dk) return [];
  return dk.draw != null ? [...muted] : [`For ${names.top}: DraftKings ${percent(dk.top)}% ${pregameWords(basis.sport)}`];
}

function spokenText(values: Partial<Record<"top" | "draw" | "bottom", number>> | null, reading: OddsReading | null, muted: readonly string[], names: { top: string; bottom: string }, spoken: { top: string; bottom: string }): string {
  if (!values) return reading == null ? "Polymarket odds loading." : "No odds at this moment.";
  let text = `Polymarket${reading == null ? "" : " at this moment"}: ${spoken.top} ${values.top ?? 0} percent`;
  if (values.draw != null) text += `, draw ${values.draw} percent`;
  text += `, ${spoken.bottom} ${values.bottom ?? 0} percent.`;
  if (reading?.espn != null) text += ` ESPN's model: ${percent(reading.espn)} percent for ${spoken.top}.`;
  else if (reading == null && muted[0]) text += ` ${muted[0].replaceAll(names.top, spoken.top).replaceAll(names.bottom, spoken.bottom)}.`;
  return text;
}

// MARK: - Footer

function OddsFooter({ feed, snapshot, data, basis, pointer, marks, top, live, ticking }: {
  feed: OddsFeed;
  snapshot: OddsSnapshot;
  data: OddsChartData | null;
  basis: OddsBasis;
  pointer: OddsPointer;
  marks: readonly TimelineMark[];
  top: string;
  live: boolean;
  ticking: boolean;
}) {
  const moment = usePointer(pointer, (p) => p.moment);
  const reading = moment != null && data ? readingAt(moment, data, basis, marks) : null;
  const slug = snapshot.market?.slug ?? null;
  const money = traded(snapshot.market?.volume);
  return (
    <div className={styles.footer}>
      <div className={styles.footerMain}>
        <ChartFooter readout={reading && data ? { lead: readingLead(reading, top, usesFinalPercentages(data, reading.t)), detail: reading.split == null ? "No odds at this moment" : (reading.play?.text ?? "") } : null}>
          <div className={styles.source}>
            <span className={styles.freshness}>{live && ticking ? <Freshness feed={feed} money={money} /> : money}</span>
            {slug ? (
              <a href={eventLink(slug)} target="_blank" rel="noopener noreferrer" className={styles.link}>
                Polymarket
                <Icon name="external" size={9} />
              </a>
            ) : null}
          </div>
        </ChartFooter>
      </div>
      <PinControls marks={marks} range={data?.domain ?? null} pointer={pointer} />
    </div>
  );
}

/** "Live · 4s · $4.1M traded" (the theaters' heartbeat words), ticking once a second only while live and on screen. */
function Freshness({ feed, money }: { feed: OddsFeed; money: string | null }) {
  const now = useNow(1000);
  if (feed.heard == null) return <>{money}</>;
  return (
    <span className={styles.fresh}>
      <span className={styles.liveDot} aria-hidden="true" />
      {[heartbeatLabel(Math.max(Math.floor((now - feed.heard) / 1000), 0), "Polymarket"), money].filter(Boolean).join(" · ")}
    </span>
  );
}
