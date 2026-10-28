/**
 * Rounds (LiveViews.swift `RoundHistoryView`, `RoundBlock`): the map round
 * by round. Each half is a block: a square per round in the winner's row,
 * marked with how it ended, and between the rows what each team spent on
 * equipment that round (up for the top team, down for the bottom). From room
 * for two halves side by side, regulation reads as one strip and overtimes
 * pair up below it (data/cs2.ts has the rules: MR12, then overtimes of six).
 *
 * Linked: a round under the pointer rings its square, lights its economy
 * column while the rest step back, and the footer says it in words ("NAVI
 * won as CT · Round 7 · Bomb defused · …"). A click (or a tap) pins it.
 *
 * Live: a round bo3.gg's score has but its round list doesn't yet slots in
 * as a provisional square (the winner's color, receded, no glyph; it pings
 * as it arrives); the round being played is outlined in red; the live block's
 * header carries MAP POINT (MATCH POINT when the map would take the series)
 * and a run of 4+ rounds. A round won pops its half's score; a map won sends
 * a wave across the winner's squares, left to right, 20 ms apart. Full only;
 * Subtle keeps the ping, Reduce Motion fades.
 */
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Icon, SegmentedControl } from "../../../design/components";
import type { IconName } from "../../../design/components";
import { popScale, sample } from "../../../data/celebrations";
import {
  blockCelebration,
  blockState,
  blockTitle,
  defaultMap,
  mapPoint,
  REASON_LABEL,
  roundReadout,
  roundSlots,
  series,
  type CSRound,
  type RoundReason,
  type RoundSlot,
} from "../../../data/cs2";
import type { MapResult } from "../../../data/gameDetail";
import { captioned, type LiveMoment } from "../../../data/moments";
import type { CSLive, Side } from "../../../data/models";
import { luminance, NEUTRAL, type TeamPalette } from "../../../data/teamColors";
import { useSettings } from "../../../state/settings";
import { ChartFooter, Legend, LegendItem, VizWell } from "../core/DetailSection";
import { useFocus, useLinkedStore, type Focus } from "../core/linked";
import { useChartMoment } from "../core/moments";
import { useReducedMotion } from "../core/useMedia";
import { FittedName } from "../core/chartLabels";
import styles from "./CounterStrike.module.css";

export const REASON_ICON: Readonly<Record<RoundReason, IconName>> = { elimination: "xmark", bombed: "flame", defused: "scissors", time: "clock" };

const selectRound = (f: Focus | null) => f?.round ?? null;

/** A team's color for a mark, and the ink that reads on it (Viz.ink(on:)). */
function teamStyle(color: string): CSSProperties {
  const neutral = color === NEUTRAL || !color.startsWith("#");
  return { "--team": neutral ? "var(--viz-neutral)" : color, "--ink": neutral ? "light-dark(#fff, #000)" : luminance(color) > 0.45 ? "#000" : "#fff" } as CSSProperties;
}

export interface RoundHistoryProps {
  readonly rounds: Readonly<Record<number, readonly CSRound[]>>;
  readonly maps: readonly MapResult[];
  /** The series' format, when bo3.gg says (MATCH POINT reads it). */
  readonly bestOf: number | null;
  readonly palette: TeamPalette;
  /** Short names (bo3.gg's acronyms first) and full names for screen readers. */
  readonly names: { readonly top: string; readonly bottom: string };
  readonly spoken: { readonly top: string; readonly bottom: string };
  /** bo3.gg's live snapshot of the map being played, when it covers the match. */
  readonly reading: CSLive | null;
}

export const RoundHistory = memo(function RoundHistory({ rounds, maps, bestOf, palette, names, spoken, reading }: RoundHistoryProps) {
  const numbers = useMemo(() => Object.keys(rounds).map(Number).sort((a, b) => a - b), [rounds]);
  const [selected, setSelected] = useState<number | null>(null);
  const current = selected != null && rounds[selected] != null ? selected : defaultMap(rounds, maps);
  const raw = useChartMoment("rounds");
  const moment = raw && captioned(raw) ? raw : null;
  const hovered = useFocus(selectRound);

  if (current == null) return null;
  const list = rounds[current] ?? [];
  const liveMap = maps.find((m) => m.number === current)?.live ?? false;
  const mapReading = reading && reading.mapNumber === current ? reading : null;
  const peak = Math.max(0, ...list.flatMap((r) => [r.topEquipment ?? 0, r.bottomEquipment ?? 0]));
  const blocks = roundSlots(list, liveMap, mapReading);
  const isLive = liveMap || mapReading != null;
  const shownRound = hovered != null ? (list.find((r) => r.number === hovered) ?? null) : null;

  // The live block's state: map point from the live score when bo3.gg covers the map, else from the squares.
  const all = blocks.flat();
  const state = isLive ? blockState(all) : null;
  const point: Side | null = !state ? null : mapReading ? (mapReading.mapEnded ? null : mapPoint(mapReading.topScore, mapReading.bottomScore)) : state.mapPoint;
  const clinch = point ? (series(current, point, maps, bestOf)?.clinched ?? false) : false;

  return (
    <div className={styles.rounds}>
      {numbers.length > 1 ? (
        <SegmentedControl
          className={styles.picker}
          label="Map"
          value={String(current)}
          options={numbers.map((n) => {
            const name = maps.find((m) => m.number === n)?.name;
            return { value: String(n), label: name && name !== "TBD" ? name : `Map ${n}` };
          })}
          onChange={(v) => setSelected(Number(v))}
        />
      ) : null}
      {list.length === 0 ? (
        <>
          <VizWell padding={0}>
            <p className={styles.note}>{pendingNote(liveMap, reading, names)}</p>
          </VizWell>
          {moment ? <ChartFooter readout={null} moment={moment} /> : null}
        </>
      ) : (
        <>
          <div className={styles.blocks}>
            {blocks.map((slots, index) => {
              const last = index === blocks.length - 1;
              return (
                <RoundBlock
                  key={`${current}-${index}`}
                  index={index}
                  slots={slots}
                  peak={peak}
                  palette={palette}
                  names={names}
                  spoken={spoken}
                  hovered={hovered}
                  celebrating={blockCelebration(moment, index, blocks, current)}
                  waveStart={moment?.side ? blocks.slice(0, index).flat().filter((s) => s.winner === moment.side).length : 0}
                  point={last && point ? { text: clinch ? "MATCH POINT" : "MAP POINT", team: point === "top" ? names.top : names.bottom, spoken: point === "top" ? spoken.top : spoken.bottom } : null}
                  streak={last && state?.streak ? { count: state.streak.count, team: state.streak.side === "top" ? spoken.top : spoken.bottom } : null}
                />
              );
            })}
          </div>
          <ChartFooter readout={shownRound ? roundReadout(shownRound, names) : null} moment={moment}>
            <Legend>
              {(["elimination", "bombed", "defused", "time"] as const).map((reason) => (
                <LegendItem
                  key={reason}
                  label={REASON_LABEL[reason]}
                  swatch={
                    <span className={styles.reasonSwatch}>
                      <Icon name={REASON_ICON[reason]} size={6.5} />
                    </span>
                  }
                />
              ))}
              {peak > 0 ? (
                <LegendItem
                  label="Equipment value"
                  swatch={
                    <span className={styles.spendSwatch}>
                      <span style={{ background: `color-mix(in srgb, ${cssColor(palette.top)} 65%, transparent)` }} />
                      <span style={{ background: `color-mix(in srgb, ${cssColor(palette.bottom)} 65%, transparent)` }} />
                    </span>
                  }
                />
              ) : null}
            </Legend>
          </ChartFooter>
        </>
      )}
    </div>
  );
});

const cssColor = (c: string) => (c === NEUTRAL ? "var(--viz-neutral)" : c);

/** A map with no rounds yet: say why, rather than draw an empty grid. */
function pendingNote(liveMap: boolean, live: CSLive | null, names: { top: string; bottom: string }): string {
  if (liveMap && live && !live.mapEnded) {
    const round = live.round != null ? ` after round ${live.round}` : "";
    return `${names.top} ${live.topScore}–${live.bottomScore} ${names.bottom}${round}. Round-by-round squares appear once bo3.gg processes the map.`;
  }
  if (liveMap) return "bo3.gg isn't covering this map live, so the round score isn't available here yet. Rounds appear after the map; the streams below are live.";
  return "Round details for this map aren't available yet.";
}

interface BlockProps {
  readonly index: number;
  readonly slots: readonly RoundSlot[];
  readonly peak: number;
  readonly palette: TeamPalette;
  readonly names: { readonly top: string; readonly bottom: string };
  readonly spoken: { readonly top: string; readonly bottom: string };
  readonly hovered: number | null;
  readonly celebrating: LiveMoment | null;
  /** A map won's wave: how many of the winner's squares come before this block. */
  readonly waveStart: number;
  readonly point: { text: string; team: string; spoken: string } | null;
  readonly streak: { count: number; team: string } | null;
}

/** One half (or overtime): its title and score, the two rows, the economy band between them, column by column. */
function RoundBlock({ index, slots, peak, palette, names, spoken, hovered, celebrating, waveStart, point, streak }: BlockProps) {
  const store = useLinkedStore();
  const level = useSettings((s) => s.celebrationLevel);
  const reduce = useReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  const score = useRef<HTMLSpanElement>(null);
  const topWins = slots.filter((s) => s.winner === "top").length;
  const bottomWins = slots.filter((s) => s.winner === "bottom").length;
  const title = blockTitle(index);

  // A round won: the half's score pops. A map won: the winner's squares pop left to right, 20 ms apart.
  const seen = useRef(celebrating?.id ?? null);
  useEffect(() => {
    const m = celebrating;
    if (!m || m.id === seen.current) return;
    seen.current = m.id;
    if (level !== "full" || reduce) return;
    const pop = (el: Element, scale: number, delay: number) =>
      el.animate(
        sample((t) => popScale(t, scale), 0.5).map(({ offset, value }) => ({ offset, transform: `scale(${value})` })),
        { duration: 500, delay: delay * 1000, easing: "linear" },
      );
    if (m.kind === "roundWon" && score.current) pop(score.current, 1.15, 0);
    if (m.kind === "mapWon" && m.side && box.current) {
      box.current.querySelectorAll(`[data-side="${m.side}"][data-won="true"]`).forEach((el, i) => pop(el, 1.18, 0.02 * (waveStart + i)));
    }
  }, [celebrating, level, reduce, waveStart]);

  const hover = (number: number) => ({
    onPointerEnter: (e: React.PointerEvent) => e.pointerType === "mouse" && store?.hover({ round: number }, true),
    onPointerLeave: (e: React.PointerEvent) => e.pointerType === "mouse" && store?.hover({ round: number }, false),
    onClick: () => store?.togglePin({ round: number }),
  });
  const light = (number: number) => (hovered == null ? undefined : hovered === number ? "lit" : "receded");
  const fresh = celebrating?.kind === "roundWon" ? Number(celebrating.id.split(":")[2]) : null;

  const row = (side: Side) => (
    <div className={styles.row} style={teamStyle(side === "top" ? palette.top : palette.bottom)}>
      <span className={styles.rowName} aria-hidden="true">
        {/* bo3.gg's acronym is short; a team without one is named whole: shrunk, then cut (core/chartLabels.tsx). */}
        <FittedName text={side === "top" ? names.top : names.bottom} room={28} />
      </span>
      {slots.map((slot) => {
        const won = slot.winner === side;
        const state = slot.kind === "next" ? undefined : light(slot.number);
        if (slot.kind === "played") {
          return (
            <span key={slot.number} className={styles.cell} data-side={side} data-won={won} data-lit={state === "lit"} data-receded={state === "receded"} {...hover(slot.number)}>
              {won ? <Icon name={REASON_ICON[slot.round.reason]} size={8} /> : null}
            </span>
          );
        }
        if (slot.kind === "provisional") {
          const arriving = won && fresh === slot.number;
          return (
            <span
              key={slot.number}
              className={[styles.cell, arriving ? styles.slotIn : null].filter(Boolean).join(" ")}
              data-kind="provisional"
              data-side={side}
              data-won={won}
              data-receded={state === "receded"}
              title={`Round ${slot.number}: ${slot.winner === "top" ? names.top : names.bottom} won (details to come)`}
            >
              {arriving && level !== "off" ? <span key={celebrating?.id} className={styles.ping} /> : null}
            </span>
          );
        }
        return <span key={slot.number} className={styles.cell} data-kind="next" title={`Round ${slot.number}, being played now`} />;
      })}
    </div>
  );

  const said = `${title}: ${spoken.top} ${topWins}, ${spoken.bottom} ${bottomWins}.${point ? ` ${point.text === "MATCH POINT" ? "Match" : "Map"} point ${point.spoken}.` : ""}${streak ? ` ${streak.team} ${streak.count} straight.` : ""}`;
  return (
    <div ref={box} className={styles.block} role="group" aria-label={said}>
      <div className={styles.blockHead} aria-hidden="true">
        <span className={styles.blockHeadGutter} />
        <span className={styles.blockHeadInner}>
          <span className={styles.blockTitle}>{title}</span>
          <span className={styles.spacer} />
          {streak ? (
            <span className={styles.streak} title={`${streak.team} won the last ${streak.count} rounds`}>
              <Icon name="flame" size={7} className={styles.ember} />
              {streak.count} straight
            </span>
          ) : null}
          {point ? (
            <span className={styles.chip} title={`${point.team} one round from ${point.text === "MATCH POINT" ? "the match" : "the map"}`}>
              {point.text}
            </span>
          ) : null}
          <span ref={score} className={styles.halfScore}>
            {topWins} – {bottomWins}
          </span>
        </span>
      </div>
      <div aria-hidden="true">{row("top")}</div>
      {peak > 0 ? (
        <div className={styles.band} aria-hidden="true">
          <span className={styles.bandGutter} />
          {slots.map((slot) => {
            if (slot.kind !== "played") return <span key={slot.number} className={styles.spend} />;
            const r = slot.round;
            const state = light(r.number);
            return (
              <span key={slot.number} className={styles.spend} data-receded={state === "receded"} {...hover(r.number)}>
                <Spend value={r.topEquipment} peak={peak} color={palette.top} />
                <Spend value={r.bottomEquipment} peak={peak} color={palette.bottom} />
              </span>
            );
          })}
        </div>
      ) : null}
      <div aria-hidden="true">{row("bottom")}</div>
    </div>
  );
}

/** One team's spend for a round: up to 8pt against the map's peak, rounded at the data end only. */
function Spend({ value, peak, color }: { value: number | null; peak: number; color: string }) {
  const share = peak > 0 ? (8 * (value ?? 0)) / peak / 8.5 : 0;
  return (
    <span className={styles.spendHalf} style={teamStyle(color)}>
      <span className={styles.spendBar} style={{ transform: `scaleY(${share})` }} />
    </span>
  );
}
