/**
 * The odds chart (ODDS-SPEC.md "The chart", with the Mac's decisions in
 * ODDS-DECISIONS.md; Liveline's feel: a line that glides to each new value, a
 * live end with a pulse and a value badge, a scrub crosshair). One canvas
 * (drawOdds.ts) and a few DOM layers over it:
 *
 * - The canvas draws when the data, the size, the theme or the window
 *   changes, on each frame of a 0.5 s glide to a new value (and of the 0.15 s
 *   fade as the history lands), then stops: no frame loop while nothing
 *   moves, and none off screen or in a hidden tab (a change there lands
 *   without a glide).
 * - The live end's dot, badge and momentum chevron are DOM, moved by writing
 *   their transforms during a glide (React never renders per frame); the
 *   pulse is a CSS animation (the compositor's), centered where the dot is
 *   going, hidden during its glide, running only while live and on screen.
 * - The scrub: pointer events over the plot, a crosshair at the nearest
 *   whole minute and one tooltip with every series; the same from the
 *   keyboard (a slider: keyboard focus reads the newest minute, ←/→ a minute,
 *   Shift ten, Home and End, Esc clears). While a minute is read, the live end
 *   steps back to 25%.
 * - A move of less than a point on screen (most half-cent ticks) just
 *   updates: no glide, no frames.
 *
 * Reduce Motion: no glide, no pulse, the chevron without a fade.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import {
  BADGE_HEIGHT,
  BADGE_TAIL,
  GLIDE_MS,
  MOMENTUM_HOLD_MS,
  badgeRect,
  dollars,
  gameDomain,
  glideProgress,
  heartbeat,
  hourTicks,
  momentum,
  percent,
  percentPair,
  periodGuides,
  plotIn,
  scrubTime,
  shares,
  spokenPercent,
  valueAt,
  windowDomain,
  xOf,
  yOf,
  type Domain,
  type GameState,
  type OddsWindow,
  type Plot,
} from "../../../../data/odds/chart";
import { clockAt, nearestPlay, type OddsBasis } from "../../../../data/odds/espn";
import { eventLink, type Outcome, type PricePoint } from "../../../../data/odds/polymarket";
import type { Sport } from "../../../../data/models";
import { NEUTRAL, type TeamPalette } from "../../../../data/teamColors";
import { Icon } from "../../../../design/components";
import { useNow } from "../../../../state/clock";
import type { OddsFeed, OddsSnapshot } from "../../../../state/odds";
import { useColorScheme } from "../../../../state/theme";
import { colorResolver, fitCanvas } from "../canvasColors";
import { Legend, LegendItem, VizWell } from "../DetailSection";
import { pointSize, useReducedMotion } from "../useMedia";
import { drawOdds, type Frame, type OddsInk } from "./drawOdds";
import styles from "./Odds.module.css";

const MINUTE = 60_000;
const REVEAL_MS = 150;
const BADGE_FONT = `600 10.5px ui-rounded, "SF Pro Rounded", -apple-system, BlinkMacSystemFont, system-ui, sans-serif`;
const LABEL_FONT = `500 9px -apple-system, BlinkMacSystemFont, system-ui, sans-serif`;

export interface OddsChartProps {
  readonly snapshot: OddsSnapshot;
  readonly feed: OddsFeed | null;
  readonly basis: OddsBasis;
  readonly state: GameState;
  /** The scheduled start (epoch ms). */
  readonly scheduled: number;
  readonly sport: Sport;
  readonly palette: TeamPalette;
  readonly names: { readonly top: string; readonly bottom: string };
  readonly spoken: { readonly top: string; readonly bottom: string };
  /** The window: the whole game, or the last 10 minutes. */
  readonly span: OddsWindow;
  /** Changed from the keyboard: the window jumps instead of sliding. */
  readonly instant: boolean;
  /** The section's width in points. */
  readonly width: number;
}

/** What a frame shows: the domain and the end's value(s), each eased during a glide. */
interface View {
  readonly from: number;
  readonly to: number;
  readonly value: number | null;
  readonly shares: { readonly top: number; readonly draw: number; readonly bottom: number } | null;
}

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

function blend(a: View, b: View, f: number): View {
  return {
    from: lerp(a.from, b.from, f),
    to: lerp(a.to, b.to, f),
    value: a.value != null && b.value != null ? lerp(a.value, b.value, f) : b.value,
    shares: a.shares && b.shares ? { top: lerp(a.shares.top, b.shares.top, f), draw: lerp(a.shares.draw, b.shares.draw, f), bottom: lerp(a.shares.bottom, b.shares.bottom, f) } : b.shares,
  };
}

/** "before tip-off", "before kickoff", "before the first pitch". */
export function beforeStart(sport: Sport): string {
  return sport === "basketball" ? "before tip-off" : sport === "baseball" ? "before the first pitch" : "before kickoff";
}

const css = (c: string) => (c === NEUTRAL ? "var(--viz-neutral)" : c);

/** Liveline's badge: a pill with a 4pt tail pointing left at the dot, the tail's tip at `tailY`. */
function badgePath(pill: number, h: number, tail: number, tailY: number): string {
  const r = h / 2;
  const right = tail + pill - r;
  const left = tail + r;
  const spread = 3;
  return `M${left},0 L${right},0 A${r},${r},0,0,1,${right},${h} L${left},${h} A${r},${r},0,0,1,${tail + 0.6},${Math.min(tailY + spread, h - 1)} L0,${tailY} L${tail + 0.6},${Math.max(tailY - spread, 1)} A${r},${r},0,0,1,${left},0 Z`;
}

/** sRGB components of a resolved `rgb()`/`rgba()`, composited over a surface when it's translucent. */
function opaque(color: string, surface: readonly [number, number, number]): [number, number, number] {
  const m = /rgba?\(([^)]+)\)/.exec(color);
  const [r = 0, g = 0, b = 0, a = 1] = m ? m[1]!.split(/[\s,/]+/).filter(Boolean).map(Number) : [];
  return [r * a + surface[0] * (1 - a), g * a + surface[1] * (1 - a), b * a + surface[2] * (1 - a)];
}

const relative = ([r, g, b]: readonly number[]) => {
  const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
};
const contrast = (x: number, y: number) => (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);

/** The badge's type: white where it reads (4.5:1) or beats near-black, else near-black (the scoring slide's stripe ink, held to small text). */
export function badgeInk(fill: readonly [number, number, number]): string {
  const l = relative(fill);
  const white = contrast(1, l);
  const black = contrast(relative([29, 29, 31]), l);
  return white >= 4.5 || white >= black ? "#fff" : "rgb(29, 29, 31)";
}

let measurer: CanvasRenderingContext2D | null = null;
function measure(text: string, font: string): number {
  measurer ??= document.createElement("canvas").getContext("2d");
  if (!measurer) return text.length * 6;
  measurer.font = font;
  return measurer.measureText(text).width;
}

const wallTime = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const dayTime = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
const hourOnly = new Intl.DateTimeFormat(undefined, { hour: "numeric" });

/** A move of less than a point on screen (most half-cent ticks): it just updates, no frames. */
function underAPoint(a: View, b: View, plot: Plot): boolean {
  const width = plot.right - plot.left;
  const span = Math.max(b.to - b.from, 1);
  const dx = (width * (Math.abs(b.to - a.to) + Math.abs(b.from - a.from))) / span;
  const h = plot.bottom - plot.top;
  const dy =
    a.value != null && b.value != null
      ? Math.abs(a.value - b.value) * h
      : a.shares && b.shares
        ? Math.max(Math.abs(a.shares.top - b.shares.top), Math.abs(a.shares.bottom - b.shares.bottom)) * h
        : Infinity;
  return dx < 1 && dy < 1;
}

/** Where the end's dot lands for a view: the newest point (two-way), or the middle of the leading band (soccer). */
function endOf(view: View, plot: Plot, threeWay: boolean): { x: number; y: number; leader: Outcome } | null {
  const x = plot.right;
  if (threeWay) {
    const s = view.shares;
    if (!s) return null;
    const leader: Outcome = s.top >= s.draw && s.top >= s.bottom ? "top" : s.bottom >= s.draw ? "bottom" : "draw";
    const center = leader === "top" ? s.top / 2 : leader === "draw" ? s.top + s.draw / 2 : s.top + s.draw + s.bottom / 2;
    return { x, y: plot.top + center * (plot.bottom - plot.top), leader };
  }
  if (view.value == null) return null;
  return { x, y: yOf(plot)(view.value), leader: view.value >= 0.5 ? "top" : "bottom" };
}

export const OddsChart = memo(function OddsChart({ snapshot, feed, basis, state, scheduled, sport, palette, names, spoken, span, instant, width }: OddsChartProps) {
  const scheme = useColorScheme();
  const reduceMotion = useReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const endLayer = useRef<HTMLDivElement>(null);
  const pulse = useRef<HTMLSpanElement>(null);
  const badge = useRef<HTMLDivElement>(null);
  const badgeShape = useRef<SVGPathElement>(null);
  const badgeText = useRef<HTMLSpanElement>(null);
  const chevron = useRef<HTMLSpanElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const [plotWidth, setPlotWidth] = useState(0);
  const [scrub, setScrub] = useState<number | null>(null);
  const live = state === "live";
  const final = state === "final";
  const threeWay = snapshot.market?.kind === "three-way";
  // 124pt of plot (150 from large widths), 10pt above 100% and below 0% for the dot and the badge.
  const height = (width >= 460 ? 150 : 124) + 20;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => setPlotWidth(el.clientWidth / pointSize());
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The data, as the chart reads it.
  const top = snapshot.series.top ?? [];
  const drawSeries = snapshot.series.draw ?? [];
  const bottom = snapshot.series.bottom ?? [];
  const current = snapshot.current;
  const target = useMemo((): Pick<View, "value" | "shares"> => {
    if (threeWay) {
      const a = current.top;
      const d = current.draw;
      const b = current.bottom;
      return { value: null, shares: a != null && d != null && b != null ? shares(a, d, b) : null };
    }
    return { value: current.top ?? null, shares: null };
  }, [threeWay, current]);

  const firstPrice = top[0]?.t ?? null;
  const lastPrice = Math.max(top.at(-1)?.t ?? -Infinity, drawSeries.at(-1)?.t ?? -Infinity, bottom.at(-1)?.t ?? -Infinity);
  const newest = Number.isFinite(lastPrice) ? lastPrice : null;
  const [opened] = useState(() => Date.now());
  const game = useMemo(
    () => gameDomain({ state, scheduled, start: basis.start, end: basis.end, now: opened, firstPrice, lastPrice: newest }),
    [state, scheduled, basis.start, basis.end, opened, firstPrice, newest],
  );
  const domain = useMemo(() => windowDomain(game, live ? span : "game"), [game, live, span]);
  const view: View = useMemo(() => ({ from: domain.from, to: domain.to, value: target.value, shares: target.shares }), [domain, target]);

  // The badge's widest text ("MIN 100%"), measured once, so the plot reserves room for it and it never clips.
  const showBadge = !final;
  const pillWidth = useMemo(() => {
    if (typeof document === "undefined") return 60;
    const words = [names.top, names.bottom, ...(threeWay ? ["Draw"] : [])];
    return Math.ceil(Math.max(...words.map((a) => measure(`${a} 100%`, BADGE_FONT)))) + 14;
  }, [names.top, names.bottom, threeWay]);
  const plot = useMemo(() => plotIn(Math.max(plotWidth, 1), height, pillWidth, showBadge), [plotWidth, height, pillWidth, showBadge]);

  // Concrete colors for the canvas, per theme.
  const ink = useMemo((): OddsInk | null => {
    if (typeof document === "undefined" || !box.current) return null;
    const resolve = colorResolver(box.current, scheme);
    return {
      top: resolve(css(palette.top)),
      bottom: resolve(css(palette.bottom)),
      draw: resolve("var(--viz-neutral)"),
      reference: resolve("var(--viz-reference)"),
      grid: resolve("var(--viz-grid)"),
      primary: scheme === "dark" ? "rgb(255, 255, 255)" : "rgb(0, 0, 0)",
      dark: scheme === "dark",
    };
    // plotWidth: the box exists once it's been measured.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheme, palette.top, palette.bottom, plotWidth > 0]);

  const labels = useMemo(() => {
    if (plotWidth <= 0) return [];
    // Before the game (no periods): whole hours of the wall clock.
    if (state === "scheduled") return hourTicks(domain, plot, (t) => hourOnly.format(t));
    return periodGuides(basis.periods, domain, plot, (s) => measure(s, LABEL_FONT)).labels;
  }, [basis.periods, domain, plot, plotWidth, state]);

  // MARK: Painting

  const shown = useRef<View | null>(null);
  const glide = useRef<{ from: View; to: View; start: number } | null>(null);
  const reveal = useRef<{ start: number | null; value: number }>({ start: null, value: snapshot.loaded ? 1 : 0 });
  const raf = useRef(0);
  const onScreen = useRef(false);
  const latest = useRef({ view, plot, ink, top, drawSeries, bottom, basis, threeWay, state, names, span, palette });
  latest.current = { view, plot, ink, top, drawSeries, bottom, basis, threeWay, state, names, span, palette };

  const paint = useCallback(
    (v: View) => {
      const el = canvas.current;
      const L = latest.current;
      if (!el || !L.ink || L.plot.width <= 1) return;
      const fit = fitCanvas(el);
      if (!fit) return;
      const pt = pointSize();
      fit.ctx.scale(pt, pt);
      const d: Domain = { from: v.from, to: v.to };
      // The newest price takes the glide's value, so the tip moves rather than jumping then easing.
      const withEnd = (series: readonly PricePoint[], value: number | null): readonly PricePoint[] =>
        value == null || series.length === 0 ? series : [...series.slice(0, -1), { t: series.at(-1)!.t, p: value }];
      const frame: Frame = {
        plot: L.plot,
        domain: d,
        dividers: periodGuides(L.basis.periods, d, L.plot, (s) => measure(s, LABEL_FONT)).dividers,
        endDot: L.state !== "final",
        pregame: L.span !== "10m" || L.state !== "live",
        reveal: reveal.current.value,
        body: L.threeWay
          ? { kind: "three-way", top: L.top, draw: L.drawSeries, bottom: L.bottom, end: v.shares, pregame: L.basis.pregame }
          : { kind: "two-way", series: withEnd(L.top, v.value), end: v.value, win: L.basis.win, pregame: L.basis.pregame },
      };
      const drawn = drawOdds(fit.ctx, frame, L.ink, 6 * pt * Math.min(globalThis.devicePixelRatio || 1, 3));
      shown.current = v;

      // The DOM layers follow the end.
      const end = endLayer.current;
      const tag = badge.current;
      const visible = drawn.dot != null && drawn.leader != null && L.state !== "final" && reveal.current.value > 0;
      if (end) end.style.opacity = visible ? String(reveal.current.value) : "0";
      if (tag) tag.style.opacity = visible ? String(reveal.current.value) : "0";
      if (!visible || !drawn.dot || !drawn.leader) return;
      const leaderColor = drawn.leader === "top" ? L.ink.top : drawn.leader === "bottom" ? L.ink.bottom : L.ink.draw;
      const well = scheme === "dark" ? ([10, 10, 11] as const) : ([231, 231, 234] as const);
      const rgb = opaque(leaderColor, well);
      const fill = `rgb(${rgb.map(Math.round).join(", ")})`;
      if (end) {
        end.style.transform = `translate(${drawn.dot.x * pt}px, ${drawn.dot.y * pt}px)`;
        end.style.setProperty("--lead", fill);
      }
      if (tag && badgeText.current && badgeShape.current) {
        const name = drawn.leader === "top" ? L.names.top : drawn.leader === "bottom" ? L.names.bottom : "Draw";
        // Two-way: the leader's side of the complementary pair, as the header writes it.
        const figure = L.threeWay ? (v.shares ? percent(v.shares[drawn.leader]) : null) : v.value == null ? null : percentPair(v.value)[drawn.leader === "top" ? 0 : 1];
        const text = figure == null ? "" : `${name} ${figure}`;
        if (badgeText.current.textContent !== text) badgeText.current.textContent = text;
        const pill = Math.ceil(measure(text, BADGE_FONT)) + 14;
        const rect = badgeRect(L.plot, drawn.dot, pill);
        badgeShape.current.setAttribute("d", badgePath(pill, BADGE_HEIGHT, BADGE_TAIL, rect.tail));
        badgeShape.current.parentElement?.setAttribute("viewBox", `0 0 ${rect.width} ${BADGE_HEIGHT}`);
        tag.style.width = `${rect.width * pt}px`;
        tag.style.transform = `translate(${rect.x * pt}px, ${rect.y * pt}px)`;
        badgeShape.current.style.fill = fill;
        badgeText.current.style.color = badgeInk(rgb);
      }
    },
    [scheme],
  );

  /** The pulse sits where the dot is going, hidden while it glides there. */
  const placePulse = useCallback((v: View, gliding: boolean) => {
    const el = box.current;
    if (el) el.dataset.gliding = String(gliding);
    const p = pulse.current;
    const end = endOf(v, latest.current.plot, latest.current.threeWay);
    if (!p || !end) return;
    const pt = pointSize();
    p.style.transform = `translate(${end.x * pt}px, ${end.y * pt}px)`;
    const color = end.leader === "top" ? latest.current.palette.top : end.leader === "bottom" ? latest.current.palette.bottom : NEUTRAL;
    p.style.setProperty("--lead", css(color));
  }, []);

  const frameLoop = useCallback(() => {
    const now = performance.now();
    const r = reveal.current;
    if (r.start != null) {
      const f = Math.min((now - r.start) / REVEAL_MS, 1);
      r.value = 1 - (1 - f) ** 3;
      if (f >= 1) r.start = null;
    }
    const g = glide.current;
    let v = latest.current.view;
    if (g) {
      const elapsed = now - g.start;
      v = blend(g.from, g.to, glideProgress(elapsed));
      if (elapsed >= GLIDE_MS) {
        glide.current = null;
        v = g.to;
        placePulse(v, false);
      }
    }
    paint(v);
    const moving = glide.current != null || r.start != null;
    if (moving && onScreen.current && !document.hidden) {
      raf.current = requestAnimationFrame(frameLoop);
      return;
    }
    raf.current = 0;
    if (moving) {
      // Off screen mid-motion: land it.
      glide.current = null;
      r.start = null;
      r.value = 1;
      paint(latest.current.view);
      placePulse(latest.current.view, false);
    }
  }, [paint, placePulse]);

  const kick = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(frameLoop);
  }, [frameLoop]);

  // The history landed: the line, dot and badge fade in over the frame (0.15 s).
  useEffect(() => {
    if (!snapshot.loaded || reveal.current.value >= 1 || reveal.current.start != null) return;
    if (reduceMotion || !onScreen.current || document.hidden) {
      reveal.current.value = 1;
      paint(latest.current.view);
      return;
    }
    reveal.current.start = performance.now();
    kick();
  }, [snapshot.loaded, reduceMotion, paint, kick]);

  // A new view: glide to it from what's on screen. It lands at once with Reduce Motion, off screen, in a
  // hidden tab, for a window changed from the keyboard, on the first paint and for a final; a resize or a
  // theme change repaints in place (a glide in flight picks the new geometry up on its next frame).
  const last = useRef({ version: snapshot.version, span, to: view.to });
  useLayoutEffect(() => {
    const k = last.current;
    const spanChanged = k.span !== span;
    const moved = k.version !== snapshot.version || spanChanged || k.to !== view.to;
    last.current = { version: snapshot.version, span, to: view.to };
    if (!moved && glide.current) {
      glide.current.to = view;
      return;
    }
    if (!moved || (spanChanged && instant) || reduceMotion || !onScreen.current || document.hidden || shown.current == null || final || underAPoint(shown.current, view, latest.current.plot)) {
      glide.current = null;
      paint(view);
      placePulse(view, false);
      return;
    }
    // Interrupted mid-glide: start again from where it is on screen.
    glide.current = { from: shown.current, to: view, start: performance.now() };
    placePulse(view, true);
    kick();
  }, [view, plot, ink, paint, placePulse, kick, reduceMotion, instant, snapshot.version, span, final]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  // On screen? (The pulse runs and glides play only then; a change off screen lands.)
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => {
      onScreen.current = entry?.isIntersecting ?? false;
      el.dataset.onscreen = String(onScreen.current);
      if (onScreen.current && shown.current) paint(latest.current.view);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [paint]);

  // Momentum: the chevron by the dot in the gainer's color (above for the top team or the draw, below for the
  // bottom team), on a move of 0.2 points or more, gone 5 s after the last.
  const previous = useRef(current);
  useEffect(() => {
    const before = previous.current;
    previous.current = current;
    const el = chevron.current;
    if (!el || final) return;
    let gainer: Outcome | null = null;
    if (threeWay) {
      const moves = (["top", "draw", "bottom"] as const).map((o) => ({ o, d: (current[o] ?? 0) - (before[o] ?? current[o] ?? 0) }));
      const best = moves.reduce((a, b) => (b.d > a.d ? b : a));
      gainer = best.d >= 0.002 ? best.o : null;
    } else {
      gainer = momentum(before.top ?? null, current.top ?? null);
    }
    if (!gainer) return;
    el.dataset.dir = gainer === "bottom" ? "down" : "up";
    el.style.color = css(gainer === "top" ? palette.top : gainer === "bottom" ? palette.bottom : NEUTRAL);
    el.dataset.show = "true";
    const id = setTimeout(() => {
      el.dataset.show = "false";
    }, MOMENTUM_HOLD_MS);
    return () => clearTimeout(id);
  }, [current, threeWay, final, palette.top, palette.bottom]);

  // MARK: The scrub

  const firstMinute = Math.ceil(domain.from / MINUTE) * MINUTE;
  const lastMinute = Math.max(Math.floor(domain.to / MINUTE) * MINUTE, firstMinute);
  const minutes = Math.max(Math.round((lastMinute - firstMinute) / MINUTE), 1);
  const scrubAt = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    const t = scrubTime((clientX - rect.left) / pointSize(), plot, domain);
    setScrub((s) => (s === t ? s : t));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch" && !e.isPrimary) return;
    scrubAt(e.clientX);
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    // Touch: the finger scrubs (vertical swipes still scroll the page).
    if (e.pointerType === "touch") {
      e.currentTarget.setPointerCapture(e.pointerId);
      scrubAt(e.clientX);
    }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const by = e.shiftKey ? 10 : 1;
    const base = scrub ?? lastMinute;
    let next: number | null = null;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = base - by * MINUTE;
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") next = base + by * MINUTE;
    else if (e.key === "Home") next = firstMinute;
    else if (e.key === "End") next = lastMinute;
    else if (e.key === "Escape" && scrub != null) next = null;
    else return;
    e.preventDefault();
    e.stopPropagation();
    setScrub(next == null ? null : Math.min(Math.max(next, firstMinute), lastMinute));
  };

  const readout = useMemo(() => {
    if (scrub == null) return null;
    const t = scrub;
    const clock = state === "scheduled" ? null : clockAt(basis.plays, t);
    const today = new Date(t).toDateString() === new Date().toDateString();
    const when = [clock, (state === "scheduled" && !today ? dayTime : wallTime).format(t)].filter(Boolean).join(" · ");
    const play = state === "scheduled" ? null : (nearestPlay(basis.plays, t, 150_000, basis.periods)?.text ?? null);
    if (threeWay) {
      const a = valueAt(top, t)?.p;
      const d = valueAt(drawSeries, t)?.p;
      const b = valueAt(bottom, t)?.p;
      const s = a != null && d != null && b != null ? shares(a, d, b) : null;
      const rows = s
        ? [
            { key: "top", value: `${names.top} ${percent(s.top)}`, source: null, color: css(palette.top), spoken: `${spoken.top} ${spokenPercent(s.top)}` },
            { key: "draw", value: `Draw ${percent(s.draw)}`, source: null, color: "var(--viz-neutral)", spoken: `draw ${spokenPercent(s.draw)}` },
            { key: "bottom", value: `${names.bottom} ${percent(s.bottom)}`, source: null, color: css(palette.bottom), spoken: `${spoken.bottom} ${spokenPercent(s.bottom)}` },
          ]
        : [];
      return { t, when, play, rows, mark: null as { pm: number | null; espn: number | null } | null, upper: false };
    }
    // Both rows for the side Polymarket favored at that minute.
    const pm = valueAt(top, t)?.p ?? null;
    const espn = valueAt(basis.win, t);
    const subject: "top" | "bottom" = pm == null || pm >= 0.5 ? "top" : "bottom";
    const name = subject === "top" ? names.top : names.bottom;
    const said = subject === "top" ? spoken.top : spoken.bottom;
    const side = (p: number) => (subject === "top" ? p : 1 - p);
    const rows = [
      pm != null ? { key: "polymarket", value: `${name} ${percentPair(pm)[subject === "top" ? 0 : 1]}`, source: "Polymarket", color: css(subject === "top" ? palette.top : palette.bottom), spoken: `Polymarket: ${said} ${spokenPercent(side(pm))}` } : null,
      espn ? { key: "espn", value: `${name} ${percent(side(espn.top))}`, source: "ESPN", color: "var(--label)", spoken: `ESPN: ${said} ${spokenPercent(side(espn.top))}` } : null,
    ].filter((r) => r != null);
    return { t, when, play, rows, mark: { pm, espn: espn?.top ?? null }, upper: pm != null && pm > 0.5 };
  }, [scrub, top, drawSeries, bottom, basis, threeWay, names, spoken, palette, state]);

  const x = xOf(plot, domain);
  const y = yOf(plot);
  const pt = typeof document === "undefined" ? 1 : pointSize();
  const scrubX = scrub != null ? x(scrub) : null;

  // The tooltip: 10pt right of the crosshair, flipped left when it doesn't fit; at the plot's top, or its bottom
  // when Polymarket's point is in the upper half (never over the point being read).
  useLayoutEffect(() => {
    const el = tooltip.current;
    if (!el || scrubX == null) return;
    const w = el.offsetWidth / pt;
    const flip = scrubX + 10 + w > plot.width;
    const left = flip ? scrubX - 10 - w : scrubX + 10;
    el.style.transform = `translateX(${Math.max(left, 0) * pt}px)`;
    el.dataset.edge = readout?.upper ? "bottom" : "top";
  });

  const valueText = readout ? `${readout.when}. ${readout.rows.map((r) => r.spoken).join(", ")}.${readout.play ? ` ${readout.play}.` : ""}` : undefined;
  const summary = useMemo(() => {
    if (threeWay) {
      const a = current.top;
      const d = current.draw;
      const b = current.bottom;
      if (a == null || d == null || b == null) return "";
      const s = shares(a, d, b);
      return `Polymarket gives ${spoken.top} ${spokenPercent(s.top, final)}, a draw ${spokenPercent(s.draw, final)}, ${spoken.bottom} ${spokenPercent(s.bottom, final)}.`;
    }
    const now = current.top;
    if (now == null) return "";
    const start = valueAt(top, basis.start ?? domain.from)?.p ?? top[0]?.p ?? null;
    const espn = basis.win.at(-1)?.top ?? null;
    return [
      `Polymarket gives ${spoken.top} ${spokenPercent(now, final)}${start != null ? `, from ${spokenPercent(start)} at the start` : ""}.`,
      espn != null ? `ESPN's model: ${spokenPercent(espn, final)}.` : null,
      basis.pregame ? `DraftKings before the game: ${spokenPercent(basis.pregame.top)}.` : null,
    ]
      .filter(Boolean)
      .join(" ");
  }, [threeWay, current, spoken, final, top, basis, domain.from]);

  const volume = snapshot.market?.volume;
  const slug = snapshot.market?.slug ?? null;
  const summaryID = `odds-summary-${slug ?? "x"}`;

  return (
    <div className={styles.chart}>
      <VizWell padding={8}>
        <div
          ref={box}
          className={styles.plot}
          style={{ height: `calc(${height} * var(--pt))` }}
          role="slider"
          tabIndex={0}
          aria-label={`Win probability, ${spoken.top} against ${spoken.bottom}`}
          aria-describedby={summaryID}
          aria-valuemin={0}
          aria-valuemax={minutes}
          aria-valuenow={scrub != null ? Math.round((scrub - firstMinute) / MINUTE) : minutes}
          aria-valuetext={valueText ?? "Use the arrow keys to read the chart minute by minute."}
          data-live={live}
          data-scrubbing={scrub != null}
          onPointerMove={onPointerMove}
          onPointerDown={onPointerDown}
          onPointerLeave={(e) => e.pointerType !== "touch" && setScrub(null)}
          onPointerUp={(e) => e.pointerType === "touch" && setScrub(null)}
          onPointerCancel={() => setScrub(null)}
          onKeyDown={onKeyDown}
          onFocus={(e) => e.currentTarget.matches(":focus-visible") && setScrub((s) => s ?? lastMinute)}
          onBlur={() => setScrub(null)}
        >
          <canvas ref={canvas} className={styles.canvas} aria-hidden="true" />
          <span className={styles.edge} data-edge="top" aria-hidden="true" style={{ top: `calc(${plot.top} * var(--pt))` }}>
            {names.top}
          </span>
          <span className={styles.edge} data-edge="bottom" aria-hidden="true" style={{ top: `calc(${plot.bottom} * var(--pt))` }}>
            {names.bottom}
          </span>
          {live ? <span ref={pulse} className={styles.pulse} aria-hidden="true" /> : null}
          <div ref={endLayer} className={styles.end} aria-hidden="true">
            <span className={styles.dot} />
            <span ref={chevron} className={styles.chevron} data-show="false">
              <svg viewBox="0 0 8 5" width="8" height="5">
                <path d="M1 4.1 L4 1.1 L7 4.1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </div>
          {showBadge ? (
            <div ref={badge} className={styles.badge} aria-hidden="true">
              <svg className={styles.badgeShape} preserveAspectRatio="none">
                <path ref={badgeShape} />
              </svg>
              <span ref={badgeText} className={styles.badgeText} />
            </div>
          ) : null}
          {readout && scrubX != null ? (
            <>
              <span className={styles.rule} style={{ transform: `translateX(${scrubX * pt}px)` }} aria-hidden="true" />
              {readout.mark?.espn != null ? <span className={styles.mark} data-kind="espn" style={{ transform: `translate(${scrubX * pt}px, ${y(readout.mark.espn) * pt}px)` }} aria-hidden="true" /> : null}
              {readout.mark?.pm != null ? <span className={styles.mark} style={{ transform: `translate(${scrubX * pt}px, ${y(readout.mark.pm) * pt}px)`, color: css(readout.mark.pm >= 0.5 ? palette.top : palette.bottom) }} aria-hidden="true" /> : null}
              <div ref={tooltip} className={styles.tooltip} aria-hidden="true">
                <p className={styles.tipWhen}>{readout.when}</p>
                <ul className={styles.tipRows}>
                  {readout.rows.map((r) => (
                    <li key={r.key}>
                      <span className={styles.key} data-kind={r.key} style={{ "--c": r.color } as CSSProperties} />
                      <strong>{r.value}</strong>
                      <span>{r.source ?? ""}</span>
                    </li>
                  ))}
                </ul>
                {readout.play ? <p className={styles.tipPlay}>{readout.play}</p> : null}
              </div>
            </>
          ) : null}
        </div>
        <div className={styles.periods} aria-hidden="true">
          {labels.map((l) => (
            <span key={`${l.label}-${l.x}`} style={{ left: `calc(${l.x} * var(--pt))` }}>
              {l.label}
            </span>
          ))}
        </div>
      </VizWell>
      <p id={summaryID} className="visually-hidden">
        {summary}
      </p>
      <div className={styles.footer}>
        <Legend>
          {threeWay ? (
            <>
              <LegendItem label={`${names.top} win`} swatch={<span className={styles.swatchBand} style={{ "--c": css(palette.top) } as CSSProperties} />} />
              <LegendItem label="Draw" swatch={<span className={styles.swatchBand} style={{ "--c": "var(--viz-neutral)" } as CSSProperties} />} />
              <LegendItem label={`${names.bottom} win`} swatch={<span className={styles.swatchBand} style={{ "--c": css(palette.bottom) } as CSSProperties} />} />
            </>
          ) : (
            <>
              <LegendItem label="Polymarket" swatch={<span className={styles.swatchSplit} style={{ "--a": css(palette.top), "--b": css(palette.bottom) } as CSSProperties} />} />
              {basis.win.length > 0 ? <LegendItem label="ESPN" swatch={<span className={styles.swatchLine} />} /> : null}
            </>
          )}
          {basis.pregame ? <LegendItem label="DraftKings" swatch={<span className={styles.swatchDiamond} />} /> : null}
        </Legend>
        <div className={styles.source}>
          <span className={styles.freshness}>
            {live && feed && snapshot.transport ? <Freshness feed={feed} /> : null}
            {volume != null && volume > 0 ? <span>{`${dollars(volume)} traded`}</span> : null}
          </span>
          {slug ? (
            <a href={eventLink(slug)} target="_blank" rel="noopener noreferrer" className={styles.link}>
              Polymarket
              <Icon name="external" size={9} />
            </a>
          ) : null}
        </div>
      </div>
      <OddsTable basis={basis} top={top} drawSeries={drawSeries} bottom={bottom} threeWay={threeWay} names={names} domain={domain} />
    </div>
  );
});

/** "Live · 4s ·": how long since the market last said anything (TheaterHeartbeat's words). One second's tick, this text alone, only while connected. */
function Freshness({ feed }: { feed: OddsFeed }) {
  const now = useNow(1000);
  if (feed.heard == null) return null;
  return (
    <span className={styles.fresh}>
      <span className={styles.liveDot} aria-hidden="true" />
      {`${heartbeat((now - feed.heard) / 1000)} ·`}
    </span>
  );
}

/** The table twin: each period's start and the end, every series' value then. */
function OddsTable({ basis, top, drawSeries, bottom, threeWay, names, domain }: { basis: OddsBasis; top: readonly PricePoint[]; drawSeries: readonly PricePoint[]; bottom: readonly PricePoint[]; threeWay: boolean; names: { top: string; bottom: string }; domain: Domain }) {
  const moments = [...basis.periods.filter((p) => p.t >= domain.from && p.t <= domain.to).map((p) => ({ t: p.t, label: `Start of ${p.label}` })), { t: domain.to, label: "Latest" }];
  const price = (series: readonly PricePoint[], t: number) => {
    const v = valueAt(series, t);
    return v ? percent(v.p) : "–";
  };
  const model = (t: number) => {
    const v = valueAt(basis.win, t);
    return v ? percent(v.top) : "–";
  };
  return (
    <table className="visually-hidden">
      <caption>Win probability over the game</caption>
      <thead>
        <tr>
          <th scope="col">Moment</th>
          {threeWay ? (
            <>
              <th scope="col">{names.top}</th>
              <th scope="col">Draw</th>
              <th scope="col">{names.bottom}</th>
            </>
          ) : (
            <>
              <th scope="col">{`${names.top}, Polymarket`}</th>
              {basis.win.length > 0 ? <th scope="col">{`${names.top}, ESPN`}</th> : null}
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {moments.map((m) => (
          <tr key={`${m.label}-${m.t}`}>
            <th scope="row">{`${m.label}, ${wallTime.format(m.t)}`}</th>
            {threeWay ? (
              <>
                <td>{price(top, m.t)}</td>
                <td>{price(drawSeries, m.t)}</td>
                <td>{price(bottom, m.t)}</td>
              </>
            ) : (
              <>
                <td>{price(top, m.t)}</td>
                {basis.win.length > 0 ? <td>{model(m.t)}</td> : null}
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
