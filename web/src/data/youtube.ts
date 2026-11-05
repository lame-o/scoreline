/**
 * World Climbing's YouTube pages, read as the Mac reads them
 * (ClimbingBroadcast.swift `parse`, ScheduleProvider.swift `Streams`):
 *
 * - `/live`: the stream on now, or between rounds the next one, with its
 *   start (`parseLivePage`).
 * - `/streams`: every scheduled stream, which times the rounds of a
 *   competition within the week (`parseStreamsPage`, `attachStreams`).
 *
 * Web: the Mac pins the page's "Scheduled for …" times to UTC with a
 * preference cookie. The web sends no cookies, and YouTube then writes them
 * in its own default zone, Pacific time (measured November 2026: the same
 * whatever region the page is asked for). So a scheduled stream's wall-clock
 * time is read in Pacific time, unless the live page names the same video
 * with its absolute start: then the offset between the two is the page's
 * zone, whatever it is (`streamOffset`), and every time on the page takes it.
 *
 * A page that isn't the channel's at all (a consent or bot check) is no
 * answer (`undefined`), never "nothing scheduled": what was known stays.
 */
import { covers, type ClimbingBroadcast } from "./climbingBroadcast";
import type { SeasonEvent } from "./schedule";

/** YouTube's zone for a visitor without its `tz` preference. */
export const YOUTUBE_ZONE = "America/Los_Angeles";

// MARK: - The live page (ClimbingBroadcast.parse)

function first(pattern: RegExp, text: string): string | null {
  return pattern.exec(text)?.[1] ?? null;
}

function decodeEntities(s: string): string {
  return s.replaceAll("&amp;", "&").replaceAll("&#39;", "'").replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">");
}

/**
 * The stream `/live` resolves to: null when no stream is live or
 * scheduled (the canonical link is the channel, not a video); undefined
 * when the page isn't the channel's (consent, bot check).
 */
export function parseLivePage(html: string): ClimbingBroadcast | null | undefined {
  const canonical = first(/<link rel="canonical" href="([^"]+)"/, html);
  if (canonical == null) return undefined;
  // No live or scheduled stream: the canonical link is the channel, not a video.
  if (!canonical.includes("watch?v=")) return null;
  const title = first(/<meta name="title" content="([^"]*)"/, html) ?? first(/<title>([^<]*)<\/title>/, html);
  if (title == null) return null;
  let videoID: string | null = null;
  try {
    videoID = new URL(canonical).searchParams.get("v");
  } catch {
    return null;
  }
  if (!videoID) return null;
  const isLive = first(/"isLiveNow":(true|false)/, html) === "true";
  const stamp = first(/"startTimestamp":"([^"]+)"/, html);
  const scheduled = first(/"scheduledStartTime":"(\d+)"/, html);
  const parsed = stamp ? Date.parse(stamp) : NaN;
  const start = Number.isFinite(parsed) ? parsed : scheduled ? Number(scheduled) * 1000 : null;
  return { url: `https://www.youtube.com/watch?v=${videoID}`, videoID, title: decodeEntities(title), isLive, start };
}

// MARK: - The streams tab (ScheduleProvider.Streams)

/** A scheduled stream as the streams tab lists it. */
export interface StreamSlot {
  readonly videoID: string;
  /** "Lead semi-finals | Santiago 2026" */
  readonly title: string;
  /** "Scheduled for 10/29/26, 10:45 AM" as written: the wall-clock fields, read as if UTC (ms). Its zone is the page's. */
  readonly wall: number;
}

export const slotURL = (slot: { readonly videoID: string }) => `https://www.youtube.com/watch?v=${slot.videoID}`;

/** "Scheduled for 10/29/26, 10:45 AM" (with a narrow no-break space) → its wall-clock fields, as if UTC. */
export function scheduledWall(text: string): number | null {
  if (!text.startsWith("Scheduled for ")) return null;
  const clean = text.slice("Scheduled for ".length).replace(/[  ]/g, " ").trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}), (\d{1,2}):(\d{2}) (AM|PM)$/.exec(clean);
  if (!m) return null;
  const [, month, day, year, hour, minute, half] = m;
  const h = (Number(hour) % 12) + (half === "PM" ? 12 : 0);
  return Date.UTC(2000 + Number(year), Number(month) - 1, Number(day), h, Number(minute));
}

type Node = unknown;
const isDict = (n: Node): n is Record<string, Node> => typeof n === "object" && n !== null && !Array.isArray(n);

/** Every `content` string under a node, in document order. */
function texts(node: Node, out: string[]): void {
  if (isDict(node)) {
    if (typeof node.content === "string") out.push(node.content);
    for (const value of Object.values(node)) texts(value, out);
  } else if (Array.isArray(node)) {
    for (const value of node) texts(value, out);
  }
}

/** The lockup's title (metadata.lockupMetadataViewModel.title.content). */
function titleText(lockup: Record<string, Node>): string | null {
  const metadata = isDict(lockup.metadata) ? lockup.metadata.lockupMetadataViewModel : null;
  const title = isDict(metadata) ? metadata.title : null;
  return isDict(title) && typeof title.content === "string" ? title.content : null;
}

/**
 * Every scheduled stream on the channel's Live tab, soonest first; undefined
 * when the page has no data to read (a consent or bot page).
 */
export function parseStreamsPage(html: string): StreamSlot[] | undefined {
  const marker = "var ytInitialData = ";
  const start = html.indexOf(marker);
  if (start < 0) return undefined;
  const end = html.indexOf(";</script>", start + marker.length);
  if (end < 0) return undefined;
  let root: Node;
  try {
    root = JSON.parse(html.slice(start + marker.length, end));
  } catch {
    return undefined;
  }
  const slots: StreamSlot[] = [];
  const walk = (node: Node): void => {
    if (isDict(node)) {
      const lockup = node.lockupViewModel;
      if (isDict(lockup) && typeof lockup.contentId === "string") {
        const found: string[] = [];
        texts(lockup, found);
        const title = titleText(lockup) ?? found[0];
        const wall = found.map(scheduledWall).find((d) => d != null);
        if (title && wall != null) slots.push({ videoID: lockup.contentId, title, wall });
        return;
      }
      for (const value of Object.values(node)) walk(value);
    } else if (Array.isArray(node)) {
      for (const value of node) walk(value);
    }
  };
  walk(root);
  const seen = new Set<string>();
  return slots.filter((s) => !seen.has(s.videoID) && seen.add(s.videoID)).sort((a, b) => a.wall - b.wall);
}

// MARK: - The page's zone (web)

/** A zone's offset from UTC at an instant, in ms (Pacific in November: −8 h). */
export function zoneOffset(instant: number, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUTC = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUTC - Math.floor(instant / 1000) * 1000;
}

/** Wall-clock fields (as if UTC) in a zone → the instant. */
export function wallToInstant(wall: number, zone: string): number {
  let instant = wall - zoneOffset(wall, zone);
  // Across a change of offset, the second reading is the one for that wall clock.
  instant = wall - zoneOffset(instant, zone);
  return instant;
}

const QUARTER_HOUR = 15 * 60_000;

/**
 * The page's zone as an offset (wall minus instant, ms), when the live page
 * names an upcoming stream the streams tab also lists: its absolute start
 * against its wall-clock one, to the quarter hour. Null otherwise.
 */
export function streamOffset(slots: readonly StreamSlot[], live: ClimbingBroadcast | null): number | null {
  if (!live || live.isLive || live.start == null) return null;
  const slot = slots.find((s) => s.videoID === live.videoID);
  if (!slot) return null;
  return Math.round((slot.wall - live.start) / QUARTER_HOUR) * QUARTER_HOUR;
}

/** A slot's start: by the page's measured offset, else read in YouTube's default zone. */
export function slotStart(slot: StreamSlot, offset: number | null): number {
  return offset != null ? slot.wall - offset : wallToInstant(slot.wall, YOUTUBE_ZONE);
}

// MARK: - Rounds (Streams.attach)

/**
 * Gives each round the stream that covers it ("Lead semi-finals | Santiago
 * 2026" covers the men's and the women's semi-final): its start, and its
 * link for the Watch buttons.
 */
export function attachStreams(slots: readonly StreamSlot[], offset: number | null, event: SeasonEvent): SeasonEvent {
  if (slots.length === 0 || event.kind.kind !== "climbing") return event;
  const name = `${event.shortName} ${event.startDay.year}`;
  let changed = false;
  const rounds = event.rounds.map((round) => {
    const category = `${round.discipline} ${round.categories[0] ?? ""}`;
    const slot = slots.findLast((s) => covers(s.title, category, round.name, name));
    if (!slot) return round;
    changed = true;
    return { ...round, start: { kind: "exact" as const, date: slotStart(slot, offset) }, stream: slotURL(slot) };
  });
  return changed ? { ...event, rounds } : event;
}
