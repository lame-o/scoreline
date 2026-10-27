/**
 * This At-Bat (LiveViews.swift `StrikeZoneView`): each pitch where it crossed
 * the zone, numbered in order, beside the list of pitches with their type,
 * speed and what they did (Called, Swinging, Foul, Foul tip, Ball, In play).
 * Balls are rings, strikes and balls in play are filled, so the result never
 * depends on color alone. A fastball is "FB".
 *
 * Linked: pointing at a pitch (on the zone or in the list) rings it and
 * steps the others back; a click on a row pins it. The zone's lines stop
 * short of the latest and the focused pitch. A strikeout flashes the zone
 * red and pops strike three; a walk flashes it green.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { pitchNames, pitchResultWord, type Pitch } from "../../../data/gameDetail";
import { popScale, sample } from "../../../data/celebrations";
import { useSettings } from "../../../state/settings";
import { textWidth } from "../../scores/measure";
import { VizWell } from "../core/DetailSection";
import { useFocus, useLinkedRow, useLinkedStore } from "../core/linked";
import { useChartMoment } from "../core/moments";
import { useReducedMotion } from "../core/useMedia";
import styles from "./StrikeZone.module.css";

// ESPN pitch coordinates around the zone (zone: x 91…141, y 148…192).
const DOMAIN_X = [56, 176] as const;
const DOMAIN_Y = [128, 226] as const;
const ZONE = { x0: 91, y0: 148, x1: 141, y1: 192 };

/** One step up from large: more room between pitches, the same 16pt marks. */
export function plotSize(widthPt: number): { width: number; height: number } {
  return widthPt >= 460 ? { width: 150, height: 188 } : { width: 120, height: 150 };
}

/** The result column fits its longest word ("Swinging") from the first pitch, so nothing moves when one arrives. */
const RESULT_WIDTH = Math.max(...["Swinging", "Foul tip", "In play"].map((w) => textWidth(w, 10)));

/** The longest of a pitch's names that fits `room` (StrikeZoneView.name). */
export function fittedName(names: readonly string[], room: number): string {
  return names.find((n) => textWidth(n, 11, 600) <= room) ?? names[names.length - 1]!;
}

export function StrikeZone({ pitches, width }: { pitches: readonly Pitch[]; width: number }) {
  const plot = plotSize(width);
  const store = useLinkedStore();
  const moment = useChartMoment("plate");
  const level = useSettings((s) => s.celebrationLevel);
  const reduce = useReducedMotion();
  const focused = useFocus((f) => f?.play ?? null);
  const latest = pitches.at(-1)?.id ?? null;
  const verdict = moment?.kind === "strikeout" ? "strikeout" : moment?.kind === "walk" ? "walk" : null;

  const map = (x: number, y: number) => ({
    x: Math.min(Math.max((plot.width * (x - DOMAIN_X[0])) / (DOMAIN_X[1] - DOMAIN_X[0]), 8), plot.width - 8),
    y: Math.min(Math.max((plot.height * (y - DOMAIN_Y[0])) / (DOMAIN_Y[1] - DOMAIN_Y[0]), 8), plot.height - 8),
  });
  const z0 = map(ZONE.x0, ZONE.y0);
  const z1 = map(ZONE.x1, ZONE.y1);
  const zone = { x: z0.x, y: z0.y, w: z1.x - z0.x, h: z1.y - z0.y };
  const plateTop = zone.y + zone.h + 14;
  const mid = zone.x + zone.w / 2;

  // The punch-out: strike three pops 1 → 1.3 → 1.
  const marks = useRef(new Map<string, HTMLElement>());
  useEffect(() => {
    if (moment?.kind !== "strikeout" || !latest || level !== "full" || reduce) return;
    marks.current.get(latest)?.animate(
      sample((t) => popScale(t, 1.3), 0.5).map(({ offset, value }) => ({ offset, transform: `translate(-50%, -50%) scale(${value})` })),
      { duration: 500 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moment?.id]);

  // The room the list has for a pitch's name (whole points, written only when it changes).
  const list = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(Infinity);
  const fixed = useMemo(() => {
    const speed = Math.max(0, ...pitches.map((p) => (p.mph != null ? textWidth(String(p.mph), 11) : 0)));
    return 10 + 16 + 2 + RESULT_WIDTH + 5 * 6 + speed;
  }, [pitches]);
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const read = () => {
      const pt = parseFloat(getComputedStyle(document.documentElement).fontSize) / 13 || 1;
      const next = Math.floor(el.clientWidth / pt - fixed);
      setRoom((r) => (r === next ? r : next));
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [fixed]);

  // The lines stop short of the latest and the focused pitch.
  const clear = [latest, focused].filter((id, i, a): id is string => id != null && a.indexOf(id) === i).flatMap((id) => {
    const p = pitches.find((x) => x.id === id);
    return p ? [map(p.x, p.y)] : [];
  });
  const maskID = `zone-clear-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <div className={styles.atBat} role="img" aria-label={spoken(pitches)}>
      <VizWell className={styles.well} style={{ width: `calc(${plot.width + 20} * var(--pt))` }}>
        <div className={styles.plot} style={{ width: `calc(${plot.width} * var(--pt))`, height: `calc(${plot.height} * var(--pt))` }}>
          <svg viewBox={`0 0 ${plot.width} ${plot.height}`} className={styles.lines} aria-hidden="true">
            <defs>
              <mask id={maskID}>
                <rect x={-20} y={-20} width={plot.width + 40} height={plot.height + 40} fill="white" />
                {clear.map((c, i) => (
                  <circle key={i} cx={c.x} cy={c.y} r={10} fill="black" />
                ))}
              </mask>
            </defs>
            <g mask={`url(#${maskID})`}>
              {[1, 2].map((i) => (
                <g key={i} className={styles.grid}>
                  <line x1={zone.x + (zone.w * i) / 3} y1={zone.y} x2={zone.x + (zone.w * i) / 3} y2={zone.y + zone.h} />
                  <line x1={zone.x} y1={zone.y + (zone.h * i) / 3} x2={zone.x + zone.w} y2={zone.y + (zone.h * i) / 3} />
                </g>
              ))}
              <rect className={styles.zone} x={zone.x} y={zone.y} width={zone.w} height={zone.h} rx={2} />
              {/* Home plate, catcher's view. */}
              <path className={styles.homePlate} d={`M${mid - 18} ${plateTop}h36v5l-18 6-18-6z`} />
            </g>
            {verdict ? <rect key={moment!.id} className={styles.verdict} data-verdict={verdict} x={zone.x} y={zone.y} width={zone.w} height={zone.h} rx={2} /> : null}
          </svg>
          {pitches.map((p) => {
            const at = map(p.x, p.y);
            const isFocused = focused === p.id;
            const z = isFocused ? 2 : p.id === latest ? 1 : 0;
            return (
              <span
                key={p.id}
                ref={(el) => {
                  if (el) marks.current.set(p.id, el);
                  else marks.current.delete(p.id);
                }}
                className={styles.mark}
                data-result={p.result}
                data-focused={isFocused}
                data-receded={focused != null && !isFocused}
                style={{ left: `calc(${at.x} * var(--pt))`, top: `calc(${at.y} * var(--pt))`, zIndex: z } as CSSProperties}
                onPointerEnter={(e) => e.pointerType === "mouse" && store?.hover({ play: p.id }, true)}
                onPointerLeave={(e) => e.pointerType === "mouse" && store?.hover({ play: p.id }, false)}
              >
                <span className={styles.number}>{p.number}</span>
              </span>
            );
          })}
        </div>
      </VizWell>
      <div className={styles.list} ref={list}>
        {[...pitches].reverse().map((p) => (
          <PitchRow key={p.id} pitch={p} latest={p.id === latest} room={room} />
        ))}
        {pitches.length === 0 ? <p className={styles.waiting}>Waiting for the first pitch</p> : null}
      </div>
    </div>
  );
}

function PitchRow({ pitch, latest, room }: { pitch: Pitch; latest: boolean; room: number }) {
  const row = useLinkedRow({ play: pitch.id }, { pinnable: true });
  const lit = useFocus((f) => f?.play === pitch.id);
  const names = pitchNames(pitch);
  return (
    <div className={styles.row} data-lit={lit} data-latest={latest} {...row} aria-label={`Pitch ${pitch.number}, ${names[0]}${pitch.mph != null ? `, ${pitch.mph} miles per hour` : ""}, ${spokenResult(pitch)}`}>
      <span className={styles.rowMark} data-result={pitch.result} />
      <span className={styles.rowNumber}>{pitch.number}</span>
      <span className={styles.rowName} title={names[0]}>
        {fittedName(names, room)}
      </span>
      <span className={styles.rowSpeed}>{pitch.mph ?? ""}</span>
      <span className={styles.rowResult} style={{ width: `calc(${RESULT_WIDTH} * var(--pt))` }}>
        {pitchResultWord(pitch)}
      </span>
    </div>
  );
}

function spokenResult(p: Pitch): string {
  if (p.result === "strike" && p.strike === "called") return "called strike";
  if (p.result === "strike" && p.strike === "swinging") return "swinging strike";
  if (p.result === "strike" && p.strike === "foul") return "foul ball";
  return pitchResultWord(p).toLowerCase();
}

function spoken(pitches: readonly Pitch[]): string {
  const last = pitches.at(-1);
  if (!last) return "No pitches yet this at-bat.";
  const speed = last.mph != null ? `, ${last.mph} miles per hour` : "";
  return `${pitches.length} pitches this at-bat. Latest: pitch ${last.number}, ${last.typeName ?? "pitch"}${speed}, ${spokenResult(last)}.`;
}
