/**
 * World Climbing's YouTube stream (ClimbingBroadcast.swift, ScheduleProvider
 * `Streams`, ScoreStore's broadcast overlay): ScorelineTests.swift's "CS2
 * live feed" YouTube checks and SchedulesTests.swift `scheduleStreams`,
 * check by check, on the recorded pages (test/fixtures/youtube: the
 * channel today, and the Mac's recording of Oct 25 with Santiago's lead
 * semi-finals and finals scheduled), plus the web's own: the page's zone,
 * and consent or bot pages read as no answer.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyBroadcast, broadcastFor, broadcastInterval, competitionNear, covers, liveOnYouTube, type ClimbingBroadcast } from "../../src/data/climbingBroadcast";
import type { ScoreEvent } from "../../src/data/models";
import { parseEvent, parseSeasonEvents } from "../../src/data/seasons";
import { attachStreams, parseLivePage, parseStreamsPage, scheduledWall, slotStart, streamOffset, wallToInstant, zoneOffset } from "../../src/data/youtube";
import { fixture } from "./fixtures";

const page = (name: string) => readFileSync(join(import.meta.dirname, "..", "fixtures", "youtube", name), "utf8");
const HOUR = 3_600_000;

describe("the live page (ClimbingBroadcast.parse)", () => {
  it("reads the stream it resolves to: title, live or not, start", () => {
    // ScorelineTests.swift: "YouTube live page parse".
    const html = `<link rel="canonical" href="https://www.youtube.com/watch?v=abc123"><meta name="title" content="Lead semi-finals | Santiago 2026">
"isLiveNow":false,"startTimestamp":"2026-10-25T13:00:00+00:00"`;
    const b = parseLivePage(html);
    expect(b?.title).toBe("Lead semi-finals | Santiago 2026");
    expect(b?.isLive).toBe(false);
    expect(b?.start).toBe(Date.parse("2026-10-25T13:00:00Z"));
    expect(b?.url).toBe("https://www.youtube.com/watch?v=abc123");
    expect(covers(b!.title, "Lead Women", "Semi-final", "Santiago 2026")).toBe(true);
    // "semis aren't finals"
    expect(covers(b!.title, "Lead Women", "Final", "Santiago 2026")).toBe(false);
  });

  it("finds nothing when the channel has no stream on or scheduled (recorded, Nov 5)", () => {
    expect(parseLivePage(`<link rel="canonical" href="https://www.youtube.com/channel/X">`)).toBeNull();
    expect(parseLivePage(page("live-2026-11-05.html"))).toBeNull();
  });

  it("reads a stream on now, its title unescaped", () => {
    const b = parseLivePage(page("live-now.synthetic.html"))!;
    expect(b).toMatchObject({ videoID: "DmfiYuZ7PMg", title: "Lead finals & awards | Santiago 2026", isLive: true, start: Date.parse("2026-10-25T22:00:00Z") });
  });

  it("takes a consent or bot page as no answer, never as nothing scheduled", () => {
    expect(parseLivePage(page("consent.synthetic.html"))).toBeUndefined();
    expect(parseStreamsPage(page("consent.synthetic.html"))).toBeUndefined();
  });
});

describe("the streams tab (ScheduleProvider.Streams)", () => {
  it("reads \"Scheduled for\" with a narrow no-break space as its wall clock", () => {
    expect(scheduledWall("Scheduled for 10/29/26, 10:45 AM")).toBe(Date.parse("2026-10-29T10:45:00Z"));
    expect(scheduledWall("Scheduled for 11/7/26, 12:00 PM")).toBe(Date.parse("2026-11-07T12:00:00Z"));
    expect(scheduledWall("Scheduled for 11/7/26, 12:30 AM")).toBe(Date.parse("2026-11-07T00:30:00Z"));
    expect(scheduledWall("Streamed 6h ago")).toBeNull();
  });

  it("lists World Climbing's scheduled streams on Oct 25: the lead semi-finals and finals, soonest first", () => {
    const slots = parseStreamsPage(page("streams-2026-10-25.html"))!;
    expect(slots.map((s) => s.title)).toEqual(["Lead semi-finals | Santiago 2026", "Lead finals | Santiago 2026"]);
    expect(slots[1]!.wall - slots[0]!.wall).toBe(9 * HOUR);
  });

  it("lists none between competitions (recorded, Nov 5): past streams aren't scheduled", () => {
    expect(parseStreamsPage(page("streams-2026-11-05.html"))).toEqual([]);
  });
});

describe("the page's zone (web: no cookie pins it)", () => {
  it("reads YouTube's default zone, Pacific, across the change of offset", () => {
    // Measured Nov 2026: NASA's "Scheduled for 11/7/26, 2:00 PM" is its watch page's 22:00 UTC.
    expect(wallToInstant(Date.parse("2026-11-07T14:00:00Z"), "America/Los_Angeles")).toBe(Date.parse("2026-11-07T22:00:00Z"));
    expect(wallToInstant(Date.parse("2026-10-25T06:00:00Z"), "America/Los_Angeles")).toBe(Date.parse("2026-10-25T13:00:00Z"));
    expect(zoneOffset(Date.parse("2026-07-01T12:00:00Z"), "Europe/Paris")).toBe(2 * HOUR);
  });

  it("measures the page's zone against the live page when both name the next stream", () => {
    const slots = parseStreamsPage(page("streams-2026-10-25.html"))!;
    const live = parseLivePage(page("live-scheduled.synthetic.html"))!;
    const offset = streamOffset(slots, live);
    expect(offset).toBe(-7 * HOUR);
    expect(slotStart(slots[0]!, offset)).toBe(Date.parse("2026-10-25T13:00:00Z"));
    expect(slotStart(slots[1]!, offset)).toBe(Date.parse("2026-10-25T22:00:00Z"));
    // A page in another zone is still read right: whatever its offset, the live page's start wins.
    const utc = slots.map((s) => ({ ...s, wall: s.wall + 7 * HOUR }));
    expect(slotStart(utc[0]!, streamOffset(utc, live))).toBe(Date.parse("2026-10-25T13:00:00Z"));
    // Nothing to measure against: a stream already live, or one the tab doesn't list.
    expect(streamOffset(slots, parseLivePage(page("live-now.synthetic.html"))!)).toBeNull();
    expect(streamOffset([], live)).toBeNull();
  });
});

describe("rounds timed by their streams (Streams.attach)", () => {
  const recorded = Date.parse("2026-10-26T02:00:00Z");
  const santiago = parseEvent(fixture("season-ifsc-event-1489.json"), parseSeasonEvents(fixture("season-ifsc-2026.json"), recorded).find((e) => e.shortName === "Santiago")!);
  const slots = parseStreamsPage(page("streams-2026-10-25.html"))!;

  it("times the lead semi-final and final, nine hours apart, with a Watch link; qualification stays TBA", () => {
    const timed = attachStreams(slots, null, santiago);
    const lead = (name: string) => timed.rounds.find((r) => r.discipline === "Lead" && r.name === name)!;
    const semi = lead("Semi-final");
    const final = lead("Final");
    expect(semi.start.kind).toBe("exact");
    expect(final.start.kind).toBe("exact");
    if (semi.start.kind === "exact" && final.start.kind === "exact") {
      expect(final.start.date - semi.start.date).toBe(9 * HOUR);
      expect(semi.start.date).toBe(Date.parse("2026-10-25T13:00:00Z"));
    }
    expect(semi.stream).toBe("https://www.youtube.com/watch?v=N0_hEyRgWuk");
    expect(lead("Qualification").start.kind).toBe("tba");
    expect(lead("Qualification").stream).toBeNull();
  });

  it("leaves a competition no stream covers as it was", () => {
    expect(attachStreams(slots, null, { ...santiago, shortName: "Tokyo" })).toEqual({ ...santiago, shortName: "Tokyo" });
    expect(attachStreams([], null, santiago)).toBe(santiago);
  });
});

describe("the scores list's rows (ScoreStore.applyBroadcast)", () => {
  const now = Date.parse("2026-10-25T12:30:00Z");
  const row = (over: Partial<ScoreEvent> & { round?: string | null; category?: string; summary?: string }): ScoreEvent => ({
    id: over.id ?? "ifsc-11360",
    content: { kind: "field", title: over.category ?? "Lead Women", summary: over.summary ?? "Semi-final next" },
    state: over.state ?? "scheduled",
    start: over.start ?? now + 6 * HOUR,
    detail: null,
    caption: "Santiago",
    link: null,
    ref: { kind: "climbing", eventID: 1489, category: over.category ?? "Lead Women", resultURL: null, round: over.round === undefined ? "Semi-final" : over.round, eventName: "Santiago 2026", nextURL: null },
    stage: null,
    clock: null,
    possession: null,
    liveLine: null,
    liveLineRoutine: false,
    broadcast: null,
    venue: null,
    snapshot: null,
  });
  const upcoming: ClimbingBroadcast = { url: "https://www.youtube.com/watch?v=N0_hEyRgWuk", videoID: "N0_hEyRgWuk", title: "Lead semi-finals | Santiago 2026", isLive: false, start: now + 30 * 60_000 };
  const onNow: ClimbingBroadcast = { ...upcoming, isLive: true, start: now - 10 * 60_000 };

  it("finds the stream for a row by city, discipline and round", () => {
    expect(broadcastFor(row({}), upcoming)).toBe(upcoming);
    expect(broadcastFor(row({ category: "Boulder Women" }), upcoming)).toBeNull();
    expect(broadcastFor(row({ round: "Final" }), upcoming)).toBeNull();
    expect(liveOnYouTube(row({}), onNow)).toBe(true);
    expect(liveOnYouTube(row({}), upcoming)).toBe(false);
    // A round that's over isn't streaming, though its stream runs on.
    expect(liveOnYouTube(row({ state: "final" }), onNow)).toBe(false);
  });

  it("gives an upcoming round the stream's start, and marks it live when the stream is", () => {
    const [timed] = applyBroadcast([row({})], upcoming, now);
    expect(timed!.start).toBe(upcoming.start);
    const [live] = applyBroadcast([row({})], onNow, now);
    expect(live).toMatchObject({ state: "live", detail: "Live", content: { kind: "field", summary: "Semi-final" } });
  });

  it("holds a round IFSC opened hours early as scheduled until the stream starts, unless someone's finished", () => {
    const early = row({ state: "live", summary: "Semi-final" });
    const later: ClimbingBroadcast = { ...upcoming, start: now + 2 * HOUR };
    expect(applyBroadcast([early], later, now)[0]).toMatchObject({ state: "scheduled", start: later.start, content: { summary: "Semi-final next" } });
    const leading = row({ state: "live", summary: "Semi-final · Leader 🇸🇮 J. Garnbret" });
    expect(applyBroadcast([leading], later, now)[0]).toBe(leading);
  });

  it("leaves finals, rows it doesn't cover and unchanged lists exactly as they were", () => {
    const rows = [row({ state: "final", summary: "Winner 🇸🇮 J. Garnbret" }), row({ id: "b", category: "Boulder Men" })];
    expect(applyBroadcast(rows, onNow, now)).toBe(rows);
    expect(applyBroadcast(rows, null, now)).toBe(rows);
    // A row it overlays keeps its identity from one recompute to the next.
    const one = [row({})];
    expect(applyBroadcast(one, upcoming, now)[0]).toBe(applyBroadcast(one, upcoming, now + 60_000)[0]);
  });

  it("looks only while a competition is near, as often as the Mac", () => {
    expect(competitionNear([row({ start: now + 3 * 86_400_000 })], now)).toBe(false);
    expect(competitionNear([row({ start: now + 86_400_000 })], now)).toBe(true);
    expect(competitionNear([row({ state: "final", start: now - HOUR })], now)).toBe(false);
    expect(broadcastInterval(onNow, now)).toBe(2 * 60_000);
    expect(broadcastInterval(upcoming, now + 20 * 60_000)).toBe(60_000);
    expect(broadcastInterval(upcoming, now - 2 * HOUR)).toBe(10 * 60_000);
    expect(broadcastInterval(null, now)).toBe(10 * 60_000);
  });
});
