/**
 * The game page's rules (CelebrateMatch.swift `MatchRules`, `HeroBeats`;
 * DockedScorebar.swift `DockRules`): who's batting, who won, the final
 * announcement, the hero's scoreboard beats, and the docked bar's math.
 * Pure and tested; the views that draw them live in features/game/core.
 */
import { sweepCurve } from "./celebrations";
import { spokenStatus } from "./format";
import type { Competitor, Side } from "./models";

// MARK: - Baseball

/**
 * The batting team from ESPN's inning ("Top 7th": the away team; "Bot 7th":
 * home). Between halves ("Mid 7th", "End 7th") nobody is batting.
 */
export function battingSide(inning: string | null | undefined, topIsHome: boolean | null | undefined): Side | null {
  const word = inning?.toLowerCase().split(" ")[0];
  if (!word || topIsHome == null) return null;
  let homeBats: boolean;
  switch (word) {
    case "top":
    case "▲":
      homeBats = false;
      break;
    case "bot":
    case "bottom":
    case "▼":
      homeBats = true;
      break;
    default:
      return null;
  }
  return homeBats === topIsHome ? "top" : "bottom";
}

// MARK: - Final

/** The winning side from the result flags, else the higher score. */
export function winner(top: Competitor, bottom: Competitor, scores: { top: string | null; bottom: string | null }): Side | null {
  if (top.isWinner !== bottom.isWinner) return top.isWinner ? "top" : "bottom";
  const a = Number(scores.top);
  const b = Number(scores.bottom);
  if (scores.top == null || scores.bottom == null || !Number.isFinite(a) || !Number.isFinite(b) || a === b) return null;
  return a > b ? "top" : "bottom";
}

/** "Final. Lakers win, 112 to 104." / "Final. 1 to 1." for screen readers. */
export function finalAnnouncement(top: { name: string; score: string | null }, bottom: { name: string; score: string | null }, side: Side | null): string {
  const scores = [top.score, bottom.score].filter((s): s is string => s != null);
  if (!side) return scores.length === 2 ? `Final. ${scores[0]} to ${scores[1]}.` : "Final.";
  const [w, l] = side === "top" ? [top, bottom] : [bottom, top];
  if (w.score == null || l.score == null) return `Final. ${w.name} win.`;
  return `Final. ${w.name} win, ${w.score} to ${l.score}.`;
}

// MARK: - Hero beats

/**
 * The hero scoreboard's triggers. A score's digits pop (with the scorer's
 * pill) when the number actually changes: the moment can arrive before the
 * scoreboard has the score (soccer, CS2) or after it (a fast lane updates
 * both together), so whichever comes second fires the pop. The wash and the
 * decisive glint follow the moment itself. Immutable: each call returns the
 * next state.
 */
export interface HeroBeats {
  readonly pops: { readonly top: number; readonly bottom: number };
  readonly washPulses: number;
  /** The side whose wash brightens; null brightens both. */
  readonly washSide: Side | null;
  readonly glints: number;
  /** Bumped when a trophy is won on this page (a climbing final, a CS2 series). */
  readonly trophies: number;
  readonly rose: { readonly top: number | null; readonly bottom: number | null };
  readonly pending: { readonly side: Side; readonly until: number } | null;
  readonly lastDecisive: number | null;
}

export const NO_BEATS: HeroBeats = {
  pops: { top: 0, bottom: 0 },
  washPulses: 0,
  washSide: null,
  glints: 0,
  trophies: 0,
  rose: { top: null, bottom: null },
  pending: null,
  lastDecisive: null,
};

/** A number that rose this long before its moment arrived is that moment's score. */
export const BEAT_RECENT_MS = 90_000;
/** How long a moment waits for its score to reach the scoreboard. */
export const BEAT_WAIT_MS = 45_000;

function pop(b: HeroBeats, side: Side): HeroBeats {
  // Used up: a later moment waits for its own change.
  return { ...b, pops: { ...b.pops, [side]: b.pops[side] + 1 }, rose: { ...b.rose, [side]: null } };
}

/** A score-tier moment on this page. */
export function beatScore(b: HeroBeats, side: Side | null, isDecisive: boolean, now: number): HeroBeats {
  let next: HeroBeats = { ...b, washSide: side, washPulses: b.washPulses + 1 };
  if (isDecisive) next = { ...next, glints: next.glints + 1, lastDecisive: now };
  if (!side) return next;
  const rose = next.rose[side];
  if (rose != null && now - rose < BEAT_RECENT_MS) return pop(next, side);
  return { ...next, pending: { side, until: now + BEAT_WAIT_MS } };
}

/** The hero's number for `side` went up. */
export function beatScoreRose(b: HeroBeats, side: Side, now: number): HeroBeats {
  if (b.pending && b.pending.side === side && now < b.pending.until) return pop({ ...b, pending: null }, side);
  return { ...b, rose: { ...b.rose, [side]: now } };
}

/**
 * The game just ended on this page: the winner's number pops, their side of
 * the wash lifts and the glint sweeps once, unless a decisive score
 * celebrated the result moments ago.
 */
export function beatFinal(b: HeroBeats, side: Side | null, bothSides: boolean, trophy: boolean, now: number): HeroBeats {
  let next = trophy ? { ...b, trophies: b.trophies + 1 } : b;
  if (next.lastDecisive != null && now - next.lastDecisive < BEAT_RECENT_MS) return next;
  if (side) next = { ...pop(next, side), washSide: side, washPulses: next.washPulses + 1 };
  else if (bothSides) next = { ...next, washSide: null, washPulses: next.washPulses + 1 };
  return { ...next, glints: next.glints + 1 };
}

// MARK: - Docked scorebar (DockRules)

/** Which scoreboard owns the beats (digit pop, pill, glint). */
export type Surface = "hero" | "bar";

/**
 * The hero docks once a quarter of it has slid under the header, over the
 * next three quarters of its height: 0…64 (PageGeometry.dockStep).
 */
export function dockStep(heroTop: number, heroHeight: number, offset: number): number {
  const start = heroTop + 0.25 * heroHeight;
  const travel = Math.max(0.75 * heroHeight - 4, 24);
  const p = Math.min(Math.max((offset - start) / travel, 0), 1);
  return Math.round(p * 64);
}

export const surfaceAt = (p: number): Surface => (p >= 0.5 ? "bar" : "hero");

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * The bar, from p. Opacity ramps over 0.35…0.9: the hero has faded out by
 * p ≈ 0.45, and a later ramp left a stretch where neither scoreboard showed.
 */
export const barOpacity = (p: number) => (p <= 0 ? 0 : smoothstep(0.35, 0.9, p));
export const barScale = (p: number) => 0.96 + 0.04 * Math.min(Math.max(p, 0), 1);
export const barOffset = (p: number) => -6 * (1 - Math.min(Math.max(p, 0), 1));

/** The hero tucking under the header, from its top in the viewport: shrinks 6% toward its top edge and fades. */
export function heroTuck(minY: number, height: number): { scale: number; opacity: number } {
  if (height <= 0) return { scale: 1, opacity: 1 };
  const t = Math.min(Math.max(-minY / (0.75 * height), 0), 1);
  const s = Math.min(Math.max((t - 0.35) / 0.45, 0), 1);
  return { scale: 1 - 0.06 * t, opacity: 1 - s * s * (3 - 2 * s) };
}

/** How much per-sport detail fits beside the score. */
export type AccessoryTier = 0 | 1 | 2 | 3;
export const Accessory = { none: 0, glyph: 1, text: 2, full: 3 } as const;

/** At the compact width a three-digit score on both sides leaves no room for the accessory. */
export function accessoryTier(widthPt: number, topDigits: number, bottomDigits: number): AccessoryTier {
  if (widthPt < 380) return topDigits >= 3 && bottomDigits >= 3 ? Accessory.none : Accessory.glyph;
  if (widthPt < 460) return Accessory.text;
  return Accessory.full;
}

/** ESPN's inning in two characters: "Top 7th" → "▲7", "Bot 7th" → "▼7", "Mid 7th" → "Mid 7", "End 7th" → "End 7". */
export function shortInning(text: string | null | undefined): string | null {
  if (!text) return null;
  const words = text.split(" ").filter(Boolean);
  const n = Number((words[1] ?? "").replace(/\D/g, ""));
  if (words.length < 2 || !words[1]?.match(/\d/) || !Number.isFinite(n)) return text;
  switch (words[0]!.toLowerCase()) {
    case "top":
      return `▲${n}`;
    case "bot":
    case "bottom":
      return `▼${n}`;
    case "mid":
      return `Mid ${n}`;
    case "end":
      return `End ${n}`;
    default:
      return text;
  }
}

/** "3rd & 7 at SF 25" → ["3rd & 7", "at SF 25"]. */
export function downAndSpot(text: string | null | undefined): { down: string; spot: string | null } | null {
  if (!text) return null;
  const i = text.indexOf(" at ");
  if (i < 0) return { down: text, spot: null };
  return { down: text.slice(0, i), spot: `at ${text.slice(i + 4)}` };
}

/** A final's status in words while they're short ("Full time", "Final, overtime"), else the compact form. */
export function finalText(detail: string | null | undefined): string {
  const raw = detail ?? "Final";
  const words = spokenStatus(raw);
  return words.length <= 15 ? words : raw;
}

/** The moment the bar's status slot shows instead of the clock: a captioned moment whose chart can't be seen. */
export function newsLineShows(captioned: boolean, chartVisibility: Visibility | null): boolean {
  if (!captioned) return false;
  return !(chartVisibility === "visible" || chartVisibility === "partialAbove");
}

// MARK: - Section visibility (PageGeometry.visibility)

export type Visibility = "visible" | "partialAbove" | "partialBelow" | "hiddenAbove" | "hiddenBelow";

/**
 * How much of a section is on screen: visible at 60% or more, hidden at 40%
 * or less (hysteresis without memory). A section taller than the viewport
 * counts as fully visible while it fills it.
 */
export function visibility(frame: { top: number; height: number }, visible: { top: number; height: number }, topInset: number): Visibility {
  const vTop = visible.top + topInset;
  const vHeight = Math.max(visible.height - topInset, 0);
  if (frame.height <= 0 || vHeight <= 0) return "visible";
  const shown = Math.max(0, Math.min(frame.top + frame.height, vTop + vHeight) - Math.max(frame.top, vTop));
  const fraction = shown / Math.min(frame.height, vHeight);
  const above = frame.top + frame.height / 2 < vTop + vHeight / 2;
  if (fraction >= 0.6) return "visible";
  if (fraction <= 0.4) return above ? "hiddenAbove" : "hiddenBelow";
  return above ? "partialAbove" : "partialBelow";
}

// MARK: - The possession toss (DockRules.shouldToss, PossessionToss)

/** How the bar's possession glyph moves when the ball changes hands. */
export type PossessionMotion =
  /** An instant swap (first data, a game that isn't live, a catch-up). */
  | { readonly kind: "none" }
  /** Reduce Motion: the old glyph fades out, the new one fades in. */
  | { readonly kind: "fade" }
  /** Glides across (the travel spring, no bounce). */
  | { readonly kind: "glide" }
  /** Tossed across on an arc `rise` points high, spinning a turn and a quarter and landing with a small knock (each by level). */
  | { readonly kind: "toss"; readonly rise: number; readonly spins: boolean; readonly knocks: boolean };

/**
 * The football is tossed only for a turnover whose field can't be seen (the
 * field plays its own turnover beat when it can); any other change of
 * possession glides. `moment` is the moment on show and how long ago it
 * arrived (seconds).
 */
export function possessionMotion(
  change: { readonly from: Side | null; readonly to: Side | null },
  moment: { readonly kind: string; readonly age: number } | null,
  fieldVisibility: Visibility | null,
  level: "full" | "subtle" | "off",
  reduceMotion: boolean,
  { live = true, catchUp = false }: { live?: boolean; catchUp?: boolean } = {},
): PossessionMotion {
  if (!change.from || !change.to || change.from === change.to) return { kind: "none" };
  if (!live || catchUp) return { kind: "none" };
  if (reduceMotion) return { kind: "fade" };
  const turnover = moment != null && moment.kind === "turnover" && moment.age <= 2;
  if (!turnover || fieldVisibility === "visible") return { kind: "glide" };
  switch (level) {
    case "full":
      return { kind: "toss", rise: 12, spins: true, knocks: true };
    case "subtle":
      return { kind: "toss", rise: 6, spins: false, knocks: false };
    case "off":
      return { kind: "glide" };
  }
}

/** A toss takes 0.5 s on the sweep curve; a glide, the travel spring's 0.45 s. */
export const tossDuration = (motion: PossessionMotion): number => (motion.kind === "toss" ? 0.5 : 0.45);

/** Celebrate.sweepCurve: on-screen movement eases in and out. */
const tossSweep = (x: number) => sweepCurve(Math.min(Math.max(x, 0), 1));

/**
 * The ball in flight at `t` seconds: how far across (0…1), how high above
 * the line between the slots (points; the arc's apex is `rise`), and its spin
 * (degrees). A glide follows the travel spring and never leaves the line.
 */
export function tossAt(motion: PossessionMotion, t: number): { progress: number; lift: number; spin: number } {
  if (motion.kind === "toss") {
    const s = tossSweep(t / 0.5);
    return { progress: s, lift: 4 * motion.rise * s * (1 - s), spin: motion.spins ? 450 * Math.min(Math.max(t / 0.5, 0), 1) : 0 };
  }
  // Critically damped, settling in 0.4 s (Spring(duration: 0.4, bounce: 0)).
  const omega = (2 * Math.PI) / 0.4;
  const u = Math.max(t, 0);
  return { progress: t >= 0.45 ? 1 : 1 - (1 + omega * u) * Math.exp(-omega * u), lift: 0, spin: 0 };
}

/** The knock (§2.8): out, back past center, damped (0.34 s); `outward` is the first move's sign. */
export const knockSteps = (amplitude: number, outward = -1): readonly { readonly value: number; readonly duration: number }[] => [
  { value: outward * amplitude, duration: 0.05 },
  { value: -0.8 * outward * amplitude, duration: 0.07 },
  { value: 0.5 * outward * amplitude, duration: 0.07 },
  { value: -0.25 * outward * amplitude, duration: 0.07 },
  { value: 0, duration: 0.08 },
];

/** Knock steps as WAAPI offsets (0…1) and values, starting at rest. */
export function knockFrames(amplitude: number, outward = -1): { offset: number; value: number }[] {
  const steps = knockSteps(amplitude, outward);
  const total = steps.reduce((t, s) => t + s.duration, 0);
  let at = 0;
  return [{ offset: 0, value: 0 }, ...steps.map((s) => ({ offset: (at += s.duration) / total, value: s.value }))];
}

/** A knock lasts 0.34 s. */
export const KNOCK_SECONDS = 0.34;
