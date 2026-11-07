/**
 * World Climbing's YouTube stream and what it says about the climbing rows
 * (ClimbingBroadcast.swift, ScoreStore.swift `broadcast(for:)`,
 * `applyBroadcast`, `updateBroadcast`'s cadence). World Climbing streams
 * nearly every World Cup round on YouTube. The channel's `/live` page
 * resolves to the stream that's on now, or between rounds the next
 * scheduled one with its start time. That's both the live signal and the
 * schedule (the IFSC results service doesn't publish round start times).
 *
 * The rules only: small, so the scores list carries them. The pages'
 * parsers are in `youtube.ts`, loaded with whatever reads them.
 */
import type { ScoreEvent } from "./models";

/** The channel's streams: the link every climbing page offers. */
export const CHANNEL_URL = "https://www.youtube.com/@WorldClimbing/streams";
/** The stream on now, or the next one. */
export const LIVE_URL = "https://www.youtube.com/@WorldClimbing/live";

export interface ClimbingBroadcast {
  /** "https://www.youtube.com/watch?v=…" */
  readonly url: string;
  readonly videoID: string;
  /** "Lead semi-finals | Santiago 2026" */
  readonly title: string;
  readonly isLive: boolean;
  /** Epoch ms: when it started, or is scheduled to. */
  readonly start: number | null;
}

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/**
 * Whether a stream's title covers a climbing row: same city, same
 * discipline, and (when known) same round. "Lead semi-finals | Santiago
 * 2026" covers both Lead Men and Lead Women semi-finals.
 */
export function covers(title: string, category: string, round: string | null, eventName: string): boolean {
  const t = title.toLowerCase();
  const city = cityOf(eventName);
  if (!city || !t.includes(city)) return false;
  const discipline = category.toLowerCase().split(" ").filter(Boolean)[0];
  if (discipline && !t.includes(discipline)) {
    // Combined events stream as "Boulder & Lead".
    if (!category.toLowerCase().includes("&") && !category.toLowerCase().includes("combined")) return false;
  }
  if (round == null) return true;
  const r = round.toLowerCase();
  if (r.includes("semi")) return t.includes("semi");
  if (r.includes("final")) return t.includes("final") && !t.includes("semi");
  if (r.includes("qualif")) return t.includes("qualif");
  return true;
}

/** The city in an event's name: the word before its year ("Nations Grand Finale Fukuoka 2026" → "fukuoka"), else its first word. */
function cityOf(eventName: string): string | undefined {
  const words = eventName.toLowerCase().split(" ").filter(Boolean);
  return words.length >= 2 && /^\d{4}$/.test(words.at(-1)!) ? words.at(-2) : words[0];
}

/** A round's place in a competition: qualification, then semi-final, then final. */
function stage(name: string): number | null {
  const n = name.toLowerCase();
  if (n.includes("semi")) return 1;
  if (n.includes("qualif")) return 0;
  if (n.includes("final")) return 2;
  return null;
}

const ROUND_NAMES = ["Qualification", "Semi-final", "Final"] as const;

/**
 * The later round a live stream shows for a row IFSC still has waiting on
 * an earlier one, as IFSC names it: "Boulder Mixed Team finals | Fukuoka
 * 2026" over a Boulder Mixed row with nothing started (IFSC left every
 * Fukuoka round "pending" through its finals). Only for a row with no round
 * underway or done, and not across genders: the stream is the better word.
 */
export function streamedRound(event: ScoreEvent, b: ClimbingBroadcast): string | null {
  const ref = event.ref;
  if (!b.isLive || ref?.kind !== "climbing" || event.state !== "scheduled" || ref.resultURL != null || ref.round == null) return null;
  const streamed = stage(b.title);
  const waiting = stage(ref.round);
  if (streamed == null || waiting == null || streamed <= waiting) return null;
  if (!covers(b.title, ref.category, null, ref.eventName)) return null;
  const t = b.title.toLowerCase();
  const c = ref.category.toLowerCase();
  for (const gender of ["women", "men"]) {
    if (new RegExp(`\\b${gender}\\b`).test(t) && !new RegExp(`\\b${gender}\\b`).test(c)) return null;
  }
  return ROUND_NAMES[streamed]!;
}

/** The stream for a climbing row, if World Climbing's current or next stream covers it (ScoreStore.broadcast(for:)). */
export function broadcastFor(event: ScoreEvent, b: ClimbingBroadcast | null): ClimbingBroadcast | null {
  const ref = event.ref;
  if (!b || ref?.kind !== "climbing") return null;
  return covers(b.title, ref.category, ref.round, ref.eventName) ? b : null;
}

/**
 * A row the stream marks "Live on YouTube". Web: not a round that's over,
 * though the stream it shared runs on (the men's final, done, while the
 * women's is climbed in the same stream); the Mac marks it as well.
 */
export function liveOnYouTube(event: ScoreEvent, b: ClimbingBroadcast | null): boolean {
  return event.state !== "final" && broadcastFor(event, b)?.isLive === true;
}

/**
 * The page is about 1.3 MB: only look while a competition is underway or
 * starts within two days (the season has a dozen events).
 */
export function competitionNear(events: readonly ScoreEvent[], now: number): boolean {
  return events.some((e) => e.state !== "final" && e.start < now + 2 * DAY);
}

/** Checked every 10 minutes normally, every minute around a scheduled start, and every 2 minutes while live. In ms. */
export function broadcastInterval(b: ClimbingBroadcast | null, now: number): number {
  if (b?.isLive) return 2 * MINUTE;
  if (b?.start != null && Math.abs(b.start - now) < 15 * MINUTE) return MINUTE;
  return 10 * MINUTE;
}

/**
 * A live stream marks its rounds live (IFSC's own flags lag); an upcoming
 * one gives them a real start time to count down to. Rows the stream
 * doesn't cover, and finished ones, come back as they were (the same
 * objects, so they don't re-render).
 */
export function applyBroadcast(events: readonly ScoreEvent[], b: ClimbingBroadcast | null, now: number): readonly ScoreEvent[] {
  if (!b) return events;
  let changed = false;
  const out = events.map((event) => {
    const next = overlay(event, b, now);
    if (next !== event) changed = true;
    return next;
  });
  return changed ? out : events;
}

/** Each row's last overlay, so an unchanged one keeps its identity across recomputes (and doesn't re-render). */
const overlays = new WeakMap<ScoreEvent, ScoreEvent>();

function overlay(event: ScoreEvent, b: ClimbingBroadcast, now: number): ScoreEvent {
  // IFSC stuck before a round the stream is showing: the row moves on to it.
  const advanced = streamedRound(event, b);
  const row = advanced != null && event.ref?.kind === "climbing" ? { ...event, ref: { ...event.ref, round: advanced, nextURL: null } } : event;
  if (row.state === "final" || !broadcastFor(row, b) || row.ref?.kind !== "climbing" || row.content.kind !== "field") return event;
  const out = overlaid(row, row.ref.round, row.content, b, now);
  if (out === event) return event;
  const kept = overlays.get(event);
  if (kept && kept.state === out.state && kept.start === out.start && kept.detail === out.detail && roundOf(kept) === roundOf(out) && sameContent(kept, out)) return kept;
  overlays.set(event, out);
  return out;
}

function roundOf(e: ScoreEvent): string | null {
  return e.ref?.kind === "climbing" ? e.ref.round : null;
}

function sameContent(a: ScoreEvent, b: ScoreEvent): boolean {
  return a.content.kind === "field" && b.content.kind === "field" && a.content.title === b.content.title && a.content.summary === b.content.summary;
}

function overlaid(event: ScoreEvent, round: string | null, content: { title: string; summary: string }, b: ClimbingBroadcast, now: number): ScoreEvent {
  // IFSC opens a round hours before the first climber. Until someone has
  // finished (no leader yet), the stream's start is the real one.
  if (!b.isLive && b.start != null && b.start > now + 15 * MINUTE && event.state === "live" && !content.summary.includes("Leader")) {
    return { ...event, state: "scheduled", start: b.start, content: { kind: "field", title: content.title, summary: `${round ?? "Next round"} next` }, detail: null, clock: null };
  }
  if (b.isLive) {
    // Web: a round IFSC already has live keeps its own line ("Final · Leader …"); the stream marks the rest live.
    if (event.state === "live") return event;
    return { ...event, state: "live", content: { kind: "field", title: content.title, summary: round ?? "Live" }, detail: "Live" };
  }
  if (b.start != null && b.start > now - HOUR && event.state === "scheduled" && event.start !== b.start) {
    return { ...event, start: b.start };
  }
  return event;
}
