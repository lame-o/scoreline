/**
 * One timeline for every sport, and it's soccer's (MatchTimeline.swift): one
 * track, each team's marks in its own lane (labeled), the game's landmarks
 * under it. Only the axis differs: match minutes when that's all a provider
 * gives, else the wall clock it shares with Win Probability (`OddsLayout` at
 * the same width), so a goal sits above the odds it moved. Pure: the axis for
 * one size (`TimelineAxis`), the periods' click targets (`timelineSpans`),
 * the key plays either side of a reading (`destination`), and what the
 * timeline says to a screen reader. Lengths are Mac points; times epoch ms.
 */
import type { DetailMoment } from "../gameDetail";
import { plural } from "../format";
import type { OddsPeriod } from "./espn";
import { OddsLayout, maxX, periodLabels } from "./chart";
import { historyStart, windowPeriod, type Domain, type MatchHistory, type OddsWindow } from "./history";
import { shortClock, SoccerClock, type TimelineMark } from "./marks";

/** The team names' column at the left. */
export const TIMELINE_GUTTER = 30;
export const TIMELINE_HEIGHT = 60;
/** Everything above the labels' row. */
export const TIMELINE_PLOT_HEIGHT = 48;

/** Each team's lane: the top team's above the track, the bottom team's below. */
export const laneY = (m: Pick<DetailMoment, "side">): number => (m.side === "bottom" ? 38 : 10);

export interface Span {
  readonly from: number;
  readonly to: number;
}

export interface AxisLabel {
  readonly text: string;
  readonly x: number;
  /** Quieter than the landmarks it sits between. */
  readonly quiet: boolean;
}

/**
 * Everything the timeline draws along its track, worked out for one size: the
 * track itself, the time played, the tinted stretches (stoppage, breaks),
 * quiet ticks, the landmarks' lines (half-time) and the labels under it all.
 */
export interface TimelineAxis {
  readonly track: Span;
  readonly now: number | null;
  readonly played: readonly Span[];
  readonly tinted: readonly Span[];
  readonly ticks: readonly number[];
  readonly landmarks: readonly number[];
  readonly labels: readonly AxisLabel[];
  /** The wall-clock scale; null on match minutes. */
  readonly layout: OddsLayout | null;
  /** Match minutes: where a minute falls. */
  readonly minuteScale: { readonly length: number; readonly width: number } | null;
}

const label = (text: string, x: number, quiet = false): AxisLabel => ({ text, x, quiet });

function minuteX(axis: Pick<TimelineAxis, "track" | "minuteScale">, minute: number): number {
  const scale = axis.minuteScale;
  if (!scale) return axis.track.from;
  return axis.track.from + scale.width * Math.min(minute / scale.length, 1);
}

/** Where a mark goes on the track, if it's on what's shown. */
export function axisX(axis: TimelineAxis, mark: TimelineMark): number | null {
  if (axis.layout) {
    const t = mark.t;
    return t != null && t >= axis.layout.domain.from && t <= axis.layout.domain.to ? axis.layout.x(t) : null;
  }
  return mark.moment.minute != null ? minuteX(axis, mark.moment.minute) : null;
}

/**
 * Match minutes: 0' to 90' (or the last minute there's been), half-time
 * marked. From large up the track has room for a tick every 15': minutes read
 * off the axis instead of being estimated between 0', HT and the end.
 *
 * The web never builds a backwards span (the Swift's `gutter...(gutter + w)`
 * traps when the view is narrower than 36pt, as on a first layout pass): the
 * track's width is held at zero or more. `gutter` grows for a long team name
 * on match minutes (core/chartLabels.tsx; the wall clock keeps 30pt, the odds'
 * own gutter, so the two align).
 */
export function minutesAxis(width: number, marks: readonly TimelineMark[], current: number | null, large: boolean, gutter = TIMELINE_GUTTER): TimelineAxis {
  const minutes = marks.flatMap((m) => (m.moment.minute != null ? [m.moment.minute] : []));
  const length = Math.max(90, Math.ceil(minutes.length > 0 ? Math.max(...minutes) : 0), current ?? 0);
  // A little room at the end, so the last mark's ring isn't clipped.
  const w = Math.max(width - gutter - 6, 0);
  const base = { track: { from: gutter, to: gutter + w }, minuteScale: { length, width: w } };
  const x = (minute: number) => minuteX(base, minute);
  const quarterHours: number[] = [];
  if (large) for (let m = 15; m < length; m += 15) if (m !== 45) quarterHours.push(m);
  const end = x(length) - 8;
  const labels = [label("0'", gutter + 6), label("HT", x(45)), label(`${Math.trunc(length)}'`, end)];
  // A tick near the end (90' in stoppage time) keeps its line, not its label.
  for (const m of quarterHours) if (end - x(m) >= 22) labels.push(label(`${Math.trunc(m)}'`, x(m), true));
  return {
    ...base,
    now: current != null ? x(current) : null,
    played: current != null ? [{ from: gutter, to: Math.max(x(current), gutter) }] : [],
    tinted: length > 90 ? [{ from: x(90), to: x(length) }] : [],
    ticks: quarterHours.map(x),
    landmarks: [x(45)],
    labels,
    layout: null,
  };
}

/** The wall clock it shares with Win Probability (MatchTimeline.WallScale). */
export interface WallScale {
  /** As presented: nothing past p. */
  readonly history: MatchHistory;
  readonly domain: Domain;
  /** Where a live game has got to. */
  readonly now: number | null;
  readonly labelWidth: number;
  readonly window: OddsWindow;
}

/**
 * The wall clock, on the plot `OddsLayout` gives Win Probability at the same
 * width: the same time at the same x, whatever the sport. `measure` gives a
 * period label's width at 9pt medium.
 */
export function wallAxis(scale: WallScale, width: number, large: boolean, measure: (text: string) => number): TimelineAxis {
  const layout = new OddsLayout(width, TIMELINE_PLOT_HEIGHT, scale.domain, scale.labelWidth, scale.now);
  const track = { from: layout.plot.x, to: maxX(layout.plot) };
  const periods = scale.history.periods;
  const stretch = (a: number, b: number): Span | null => {
    const from = Math.max(layout.x(a), layout.plot.x);
    const to = Math.min(layout.x(b), maxX(layout.plot));
    return from < to ? { from, to } : null;
  };
  let now: number | null = null;
  let played: Span[] = [];
  const tinted: Span[] = [];
  const landmarks: number[] = [];
  let ticks: number[] = [];
  let labels: AxisLabel[] = [];
  if (scale.now != null && scale.now >= scale.domain.from && scale.now <= scale.domain.to) {
    now = layout.endX;
    played = periods.flatMap((period, k) => stretch(period.start, k === periods.length - 1 ? scale.now! : period.end) ?? []);
  }
  for (let k = 0; k + 1 < periods.length; k++) {
    const rest = stretch(periods[k]!.end, periods[k + 1]!.start);
    if (rest) {
      tinted.push(rest);
      landmarks.push((rest.from + rest.to) / 2);
    }
  }
  const number = windowPeriod(scale.window);
  if (scale.history.sport === "soccer") {
    ({ ticks, labels } = soccerLandmarks(scale, layout, track, large, stretch, tinted, landmarks));
  } else if (number != null) {
    ({ ticks, labels } = zoomedLandmarks(scale, number, layout, track, landmarks));
  } else {
    labels = periodLabels(periods, layout, measure).map((l) => label(l.label, l.x));
  }
  return { track, now, played, tinted, ticks, landmarks, labels, layout, minuteScale: null };
}

/**
 * Soccer's own landmarks on the wall clock: 0', HT and the end, ticks every
 * 15' with room, the second half's stoppage tinted. Zoomed to a half: its
 * minutes, labeled every 15', with a tick every 5'. (Fills `tinted` and
 * `landmarks` in place, as the Swift's mutating method does.)
 */
function soccerLandmarks(scale: WallScale, layout: OddsLayout, track: Span, large: boolean, stretch: (a: number, b: number) => Span | null, tinted: Span[], landmarks: number[]): { ticks: number[]; labels: AxisLabel[] } {
  const periods = scale.history.periods;
  const clock = new SoccerClock(periods[0]?.start ?? scale.domain.from, periods, scale.now);
  const placed = (minutes: readonly number[]) => minutes.map((minute) => ({ minute, x: layout.x(clock.wall(minute)) })).filter((p) => p.x >= track.from && p.x <= track.to);
  const end = track.to - 8;
  if (scale.window.kind === "recent") {
    // The last 10 minutes, by the minute: no game's ends to mark.
    const now = clock.minute(scale.domain.to);
    const minutes: number[] = [];
    for (let m = Math.ceil(now / 5) * 5 - 15; m <= now; m += 5) minutes.push(m);
    const shown = placed(minutes);
    return { ticks: shown.map((p) => p.x), labels: shown.map((p) => label(`${Math.trunc(p.minute)}'`, p.x, true)) };
  }
  const number = windowPeriod(scale.window);
  if (number != null) {
    // One half: its own first minute to its last.
    const base = ({ 2: 45, 3: 90, 4: 105 } as Readonly<Record<number, number>>)[number] ?? 0;
    const regulation = ({ 1: 45, 2: 90, 3: 105, 4: 120 } as Readonly<Record<number, number>>)[number] ?? 120;
    const last = Math.max(Math.round(clock.minute(scale.domain.to)), base + 1);
    const stoppage = stretch(clock.wall(regulation), scale.domain.to);
    if (stoppage) tinted.splice(0, tinted.length, stoppage);
    const fives: number[] = [];
    for (let m = base + 5; m < last; m += 5) fives.push(m);
    const shown = placed(fives);
    const labels = [label(`${Math.trunc(base)}'`, track.from + 6), label(`${Math.trunc(last)}'`, end)];
    for (const p of shown) if (p.minute % 15 === 0 && end - p.x >= 22 && p.x - track.from >= 22) labels.push(label(`${Math.trunc(p.minute)}'`, p.x, true));
    return { ticks: shown.map((p) => p.x), labels };
  }
  // Before the second half, its break is only pencilled in.
  if (periods.length < 2) {
    const rest = stretch(clock.breakStart, clock.secondHalf);
    if (rest) {
      tinted.push(rest);
      landmarks.push((rest.from + rest.to) / 2);
    }
  }
  const halfTime = landmarks[0] ?? layout.x(clock.secondHalf);
  const stoppage = stretch(clock.wall(90), scale.domain.to);
  if (stoppage) tinted.push(stoppage);
  const final = scale.now == null;
  const length = final ? Math.max(90, Math.round(clock.minute(scale.domain.to))) : 90;
  const landmark = final ? end : Math.min(layout.x(clock.wall(90)), end);
  const labels = [label("0'", track.from + 6), label("HT", halfTime), label(`${Math.trunc(length)}'`, landmark)];
  const quarterHours: number[] = [];
  if (large) for (let m = 15; m < length; m += 15) if (m !== 45) quarterHours.push(m);
  const shown = placed(quarterHours);
  // A tick near a landmark keeps its line, not its label.
  for (const p of shown) if (landmark - p.x >= 22 && Math.abs(halfTime - p.x) >= 22) labels.push(label(`${Math.trunc(p.minute)}'`, p.x, true));
  return { ticks: shown.map((p) => p.x), labels };
}

/**
 * Zoomed to one period: its name, and what the game clock said as it went
 * by, read from the plays reported (a stopped clock is never interpolated). A
 * baseball inning has no clock: its two halves.
 */
function zoomedLandmarks(scale: WallScale, number: number, layout: OddsLayout, track: Span, landmarks: number[]): { ticks: number[]; labels: AxisLabel[] } {
  const history = scale.history;
  const events = history.events.filter((e) => e.period === number && e.t >= layout.domain.from && e.t <= layout.domain.to);
  const period = history.periods.find((p) => p.number === number);
  if (!period) return { ticks: [], labels: [] };
  if (history.sport === "baseball") {
    const turn = events.find((e) => e.clock.startsWith("Bot"));
    if (!turn) return { ticks: [], labels: [label(period.label, (track.from + track.to) / 2)] };
    const middle = layout.x(turn.t);
    landmarks.push(middle);
    return { ticks: [], labels: [label(`Top ${period.label}`, (track.from + middle) / 2), label(`Bot ${period.label}`, (middle + track.to) / 2)] };
  }
  const labels = [label(period.label, track.from + 8)];
  const ticks: number[] = [];
  // A marker every quarter of the period, at the first play reported at or under it.
  const clocks = events.flatMap((e) => {
    const reading = e.clock.split(" ").at(-1);
    const seconds = reading != null ? clockSeconds(reading) : null;
    return seconds != null ? [{ seconds, x: layout.x(e.t) }] : [];
  });
  if (clocks.length === 0) return { ticks, labels };
  const opening = Math.max(...clocks.map((c) => c.seconds));
  if (opening < 240) return { ticks, labels };
  const step = opening >= 720 ? 180 : opening >= 600 ? 150 : 60;
  let lastLabel = track.from + 8;
  for (let mark = opening - (opening % step); mark > 0; mark -= step) {
    if (!(mark < opening)) continue;
    const hit = clocks.find((c) => c.seconds <= mark);
    if (!hit) continue;
    ticks.push(hit.x);
    if (hit.x - lastLabel >= 28 && track.to - hit.x >= 14) {
      labels.push(label(`${Math.trunc(mark / 60)}:${String(mark % 60).padStart(2, "0")}`, hit.x, true));
      lastLabel = hit.x;
    }
  }
  return { ticks, labels };
}

/** "9:16" → 556 (Swift's `Int` of each part: digits only). */
export function clockSeconds(clock: string): number | null {
  const parts = clock.split(":").flatMap((p) => (/^[+-]?\d+$/.test(p) ? [Number(p)] : []));
  return parts.length === 2 ? parts[0]! * 60 + parts[1]! : null;
}

// MARK: - Time scale (TimelinePeriod)

/** A period along the axis, for its label's click. */
export interface TimelinePeriod {
  readonly number: number;
  readonly label: string;
  readonly x: Span;
  readonly time: Domain;
}

/** Each period on show, from its start to the next one's. A period still going has the rest of the axis. */
export function timelineSpans(periods: readonly OddsPeriod[], layout: OddsLayout, runsOn: boolean): TimelinePeriod[] {
  return periods.flatMap((period, k) => {
    const last = k === periods.length - 1;
    const from = Math.max(layout.x(period.start), layout.plot.x);
    const to = last && runsOn ? maxX(layout.plot) : Math.min(layout.x(last ? period.end : periods[k + 1]!.start), maxX(layout.plot));
    if (!(from < to)) return [];
    return [{ number: period.number, label: period.label, x: { from, to }, time: { from: period.start, to: Math.max(period.end, period.start) } }];
  });
}

// MARK: - Inspection's pure parts (MatchInspectionActions, TimelineReadingValue)

/** The next or previous key play from the reading (or the game's ends). */
export function destination(forward: boolean, marks: readonly TimelineMark[], from: number | null): TimelineMark | null {
  if (forward) return marks.find((m) => m.t != null && m.t > (from ?? -Infinity)) ?? null;
  for (let k = marks.length - 1; k >= 0; k--) {
    const t = marks[k]!.t;
    if (t != null && t < (from ?? Infinity)) return marks[k]!;
  }
  return null;
}

/** What the timeline's reading says: the last key play at or before it, "Latest", or "Before the first key play" (TimelineReadingValue). */
export function readingValue(marks: readonly TimelineMark[], at: number | null): string {
  if (at == null) return "Latest";
  let mark: TimelineMark | null = null;
  for (const m of marks) if (m.t != null && m.t <= at) mark = m;
  return mark ? `${shortClock(mark.moment.clock)}, ${mark.moment.text}` : "Before the first key play";
}

/** What the timeline says as a whole (MatchTimeline.accessibilityText). */
export function timelineSpoken(marks: readonly TimelineMark[], current: number | null, wall: Pick<WallScale, "history" | "now" | "domain"> | null): string {
  const count = (kind: DetailMoment["kind"]) => marks.filter((m) => m.moment.kind === kind).length;
  const scores = count("score");
  const turnovers = count("turnover");
  if (scores > 0 || turnovers > 0) return `Timeline: ${plural(scores, "key play")}` + (turnovers > 0 ? `, ${plural(turnovers, "turnover")}.` : ".");
  let to = current != null ? ` to ${Math.trunc(current)} minutes` : "";
  if (wall && wall.now != null && wall.history.sport === "soccer") {
    const clock = new SoccerClock(historyStart(wall.history) ?? wall.domain.from, wall.history.periods, wall.now);
    to = ` to ${Math.trunc(clock.minute(wall.now))} minutes`;
  }
  // The web says "1 goal" (the Swift writes "1 goals").
  return `Timeline${to}: ${plural(count("goal") + count("ownGoal"), "goal")}, ${plural(count("yellow"), "yellow card")}, ${plural(count("red"), "red card")}.`;
}
