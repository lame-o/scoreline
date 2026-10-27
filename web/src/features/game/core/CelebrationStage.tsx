/**
 * The chart's celebration stage (Celebrations.swift `CelebrationStage`): a
 * canvas over the chart's marks, clipped to its well, that plays one burst
 * per moment and removes itself. requestAnimationFrame runs only while the
 * burst plays; the particles are a pure function of time
 * (data/celebrations.ts), so a dropped frame never changes where anything is.
 *
 * Draws nothing at Off; a soft bloom with Reduce Motion; sparks for confetti
 * and fireworks at Subtle or inside the 10 s cooldown. Pointing wins: when
 * the pointer was on a chart as the moment arrived it doesn't play, and when
 * it arrives mid-burst the burst fades out.
 *
 *     <CelebrationStage moment={moment} origin={{ x, y }} colors={{ primary: color }} />
 */
import { useEffect, useRef } from "react";
import { cueDuration, cueFor, drawParticles, particles, presetFor, type CelebrationCue, type CelebrationPalette, type Effect } from "../../../data/celebrations";
import type { LiveMoment } from "../../../data/moments";
import { useSettings } from "../../../state/settings";
import { useLinkedStore } from "./linked";
import { pointSize, useReducedMotion } from "./useMedia";

export interface StageColors {
  /** The scorer's color; NEUTRAL or null takes the accent. */
  readonly primary: string | null;
  /** A second color (a flag's); defaults to the primary mixed 40% with white. */
  readonly tint?: string | null;
}

export interface CelebrationStageProps {
  readonly moment: LiveMoment | null;
  /** Where it happened, in the stage's coordinates (CSS px from its top-left, inside the inset). */
  readonly origin: { x: number; y: number } | null;
  readonly colors: StageColors;
  /** Which way confetti flies, radians (y down). */
  readonly direction?: number;
  /** The well padding the stage reaches out over (it's clipped to the well's rounded rect). */
  readonly inset?: number;
  /** Replaces the table's effects (still filtered by level, Reduce Motion and the cooldown). */
  readonly effects?: readonly Effect[];
  /** Overrides the stage's height for the confetti preset. */
  readonly presetHeight?: number;
  /** Seconds to wait after mount (a ball's flight landing first). */
  readonly delay?: number;
  /** Radius of the clip (the well's corners). */
  readonly radius?: number;
}

/** Resolves the page's tokens to colors once per burst (the canvas can't read `var()`). */
export function resolvePalette(el: Element, colors: StageColors): CelebrationPalette {
  const style = getComputedStyle(el);
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const resolve = (value: string | null | undefined, fallback: string): string => {
    if (!value || value.startsWith("var(")) return fallback;
    return value;
  };
  const probe = (css: string): string => {
    // light-dark() and color-mix() resolve through a computed style.
    const span = document.createElement("span");
    span.style.color = css;
    span.style.display = "none";
    el.append(span);
    const out = getComputedStyle(span).color;
    span.remove();
    return out;
  };
  const accent = probe("var(--accent)");
  const primary = resolve(colors.primary, accent);
  const tint = colors.tint ? resolve(colors.tint, accent) : probe(`color-mix(in srgb, ${primary} 60%, white)`);
  return {
    primary,
    tint,
    neutral: probe("var(--viz-neutral)"),
    gold: probe("var(--star)") || token("--star", "#ffd60a"),
    glint: probe("light-dark(rgb(0 0 0 / 0.8), rgb(255 255 255 / 0.8))"),
    edge: probe("light-dark(rgb(0 0 0 / 0.5), rgb(255 255 255 / 0.5))"),
  };
}

export function CelebrationStage({ moment, origin, colors, direction = -Math.PI / 2, inset = 10, effects, presetHeight, delay = 0, radius = 12 }: CelebrationStageProps) {
  const level = useSettings((s) => s.celebrationLevel);
  const reduceMotion = useReducedMotion();
  const canvas = useRef<HTMLCanvasElement>(null);
  const linked = useLinkedStore();
  const latest = useRef({ origin, colors, effects, direction, presetHeight, inset, delay });
  latest.current = { origin, colors, effects, direction, presetHeight, inset, delay };
  const id = moment?.id ?? null;
  const momentRef = useRef(moment);
  momentRef.current = moment;

  useEffect(() => {
    const el = canvas.current;
    const m = momentRef.current;
    const { origin: at, colors: c, effects: e, direction: dir, presetHeight: ph, inset: pad, delay: wait } = latest.current;
    if (!el || !m || !at) return;
    // The pointer was on a chart as the moment arrived: pointing wins.
    if (linked?.focus()) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const cue: CelebrationCue | null = cueFor(m, { level, reduceMotion, preset: presetFor(ph ?? rect.height / pointSize() - 2 * pad), direction: dir, effects: e });
    if (!cue) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    el.width = Math.round(rect.width * dpr);
    el.height = Math.round(rect.height * dpr);
    const palette = resolvePalette(el, c);
    // Drawn in Mac points, like the Swift stage: origins arrive in CSS pixels.
    const pt = pointSize();
    const point = { x: at.x / pt + pad, y: at.y / pt + pad };
    const total = cueDuration(cue) + wait;
    let start: number | null = null;
    let frame = 0;
    let fading = false;
    el.style.opacity = "1";
    const draw = (now: number) => {
      start ??= now;
      const t = (now - start) / 1000 - wait;
      ctx.setTransform(dpr * pt, 0, 0, dpr * pt, 0, 0);
      ctx.clearRect(0, 0, rect.width / pt, rect.height / pt);
      if (t >= 0) drawParticles(ctx, particles(cue, point, t), palette);
      if ((now - start) / 1000 < total + 0.05) frame = requestAnimationFrame(draw);
      else ctx.clearRect(0, 0, rect.width / pt, rect.height / pt);
    };
    frame = requestAnimationFrame(draw);
    // The pointer arrives mid-burst: it fades out (Motion.exit) and stops.
    const unsubscribe = linked?.subscribe(() => {
      if (fading || !linked.focus()) return;
      fading = true;
      el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: "cubic-bezier(0.23, 1, 0.32, 1)", fill: "forwards" }).finished.then(
        () => {
          cancelAnimationFrame(frame);
          ctx.clearRect(0, 0, el.width, el.height);
        },
        () => {},
      );
    });
    return () => {
      cancelAnimationFrame(frame);
      unsubscribe?.();
      ctx.clearRect(0, 0, el.width, el.height);
      el.getAnimations().forEach((a) => a.cancel());
    };
    // One burst per moment: a new ID starts it; nothing else does.
  }, [id, level, reduceMotion, linked]);

  return (
    <canvas
      ref={canvas}
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: `calc(${-inset} * var(--pt))`,
        width: `calc(100% + ${2 * inset} * var(--pt))`,
        height: `calc(100% + ${2 * inset} * var(--pt))`,
        pointerEvents: "none",
        borderRadius: `calc(${radius} * var(--pt))`,
        overflow: "hidden",
      }}
    />
  );
}
