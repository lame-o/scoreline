/**
 * The climbing charts' small motions (Celebrations.swift's mark family,
 * LiveCelebrations.swift): the travel spring as a CSS easing, so a dot's
 * rise lands where `passFor` times its knocks; the knock (out, back past
 * center, damped, with a dip); the pop; the moved-up row's wash; the ▼1
 * chip; a flag's colors for the celebration stage. All transform and
 * opacity, through the Web Animations API, played once and gone.
 */
import { Icon } from "../../../design/components";
import { pillOpacity, popScale, sample } from "../../../data/celebrations";
import { travel } from "../../../data/climbing";
import { FLAG_PALETTE } from "../../../data/teams";
import type { StageColors } from "../core/CelebrationStage";
import styles from "./Climbing.module.css";

/** `Motion.travel` (critically damped, 0.4 s) as a CSS `linear()` easing over 0.6 s, where it has settled. */
export const TRAVEL_EASING = `linear(${Array.from({ length: 25 }, (_, i) => `${travel((i / 24) * 0.6).toFixed(4)} ${((i / 24) * 100).toFixed(2)}%`).join(", ")})`;

export type Level = "full" | "subtle" | "off";

/** The knock (§2.8): out, back past center, damped (0.34 s), with a dip. Half size at Subtle; nothing at Off. */
export function knock(el: Element, { amplitude = 3, dip = 0, outward = -1, delay = 0, level }: { amplitude?: number; dip?: number; outward?: number; delay?: number; level: Level }): void {
  if (level === "off") return;
  const a = level === "subtle" ? amplitude / 2 : amplitude;
  const d = level === "subtle" ? dip / 2 : dip;
  const o = outward;
  // x: (o·a, 0.05) (−0.8 o·a, 0.07) (0.5 o·a, 0.07) (−0.25 o·a, 0.07) (0, 0.08); y: dip by 0.08, home by 0.30.
  const frames: [number, number, number][] = [
    [0, 0, 0],
    [0.05, o * a, d * 0.8],
    [0.08, o * a * 0.1, d],
    [0.12, -0.8 * o * a, d * 0.72],
    [0.19, 0.5 * o * a, d * 0.3],
    [0.26, -0.25 * o * a, d * 0.08],
    [0.3, -0.06 * o * a, 0],
    [0.34, 0, 0],
  ];
  el.animate(
    frames.map(([t, x, y]) => ({ offset: t / 0.34, transform: `translate(calc(${x.toFixed(2)} * var(--pt)), calc(${y.toFixed(2)} * var(--pt)))` })),
    { duration: 340, delay: delay * 1000, easing: "ease-in-out" },
  );
}

/** A pop (§2.9): up to `peak` in 0.14 s, then a soft spring home (0.5 s). */
export function pop(el: Element, peak: number, delay = 0): void {
  el.animate(
    sample((t) => popScale(t, peak), 0.5).map(({ offset, value }) => ({ offset, transform: `scale(${value})` })),
    { duration: 500, delay: delay * 1000, easing: "linear" },
  );
}

/** A row that climbed: the accent washes in fast, holds 1.6 s and fades over 1.2 s (a quick fade with Reduce Motion). Color, not motion. */
export function wash(el: Element, reduce: boolean): void {
  const fade = reduce ? 0.3 : 1.2;
  const total = 1.75 + fade;
  el.animate(
    sample((t) => pillOpacity(t, 1, fade), total, 30).map(({ offset, value }) => ({ offset, opacity: value })),
    { duration: total * 1000, easing: "linear" },
  );
}

/** A climber's flag colors for the celebration stage (CelebrationColors.flag); the accent without one. */
export function flagColors(country: string | null | undefined): StageColors {
  const pair = country ? FLAG_PALETTE[country] : undefined;
  return pair ? { primary: `#${pair[0]}`, tint: `#${pair[1]}` } : { primary: null };
}

/** A rank change (§2.12): ▲2 in green, ▼1 in red. */
export function DeltaChip({ delta, className, style }: { delta: number; className?: string; style?: React.CSSProperties }) {
  const label = delta > 0 ? `Up ${delta}` : `Down ${-delta}`;
  return (
    <span className={[styles.delta, className].filter(Boolean).join(" ")} data-up={delta > 0} title={label} aria-label={label} role="img" style={style}>
      <Icon name={delta > 0 ? "triangleUp" : "triangleDown"} size={6} />
      {Math.abs(delta)}
    </span>
  );
}
