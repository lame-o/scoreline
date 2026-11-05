/**
 * The game as one broadcast, part 6: the recording loader and replay, the
 * bench's front end (BroadcastReplay.swift). A test helper on the web: the
 * unit tests and the bench (broadcastBench.test.ts) drive it.
 *
 * Reads what the feed recorder saved (tools/recorder/recorder.py), read only:
 * - `<sport>/<event>/<arrival-ms>.json.gz`: each changed summary, as it arrived;
 * - `<sport>/scores.jsonl`: the scoreboard's score and clock per event, each change;
 * - `<sport>/<event>/status.jsonl`: the core status the app polls every 5 s,
 *   each change (`{at, clock, displayClock, period, state, detail}`), since
 *   2026-10-31 01:50 PT; without it, the status comes from the scoreboard's rows;
 * - soccer: `<sport>/<event>/core/<arrival-ms>.json.gz` (`{count, offset,
 *   items}`: the newest one or two pages of core plays, each change), soccer's
 *   real slow lane (the app's theater and timeline read the core plays).
 * The recorder may still be writing, so files changed in the last few seconds
 * are skipped, and a half-written last line of a `.jsonl` is ignored.
 *
 * `RecordingReplay` feeds a recording through the real lanes (data/broadcast/
 * lanes.ts) into a `BroadcastEngine` on a virtual clock: the slow lane polled
 * at the app's cadence (or the recorder's), each poll delivering the newest
 * snapshot that had arrived by then; the scoreboard and the status at theirs;
 * and the engine's own wakes in between. Event-driven, so a game replays in a
 * second or two, and deterministic.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { BroadcastEngine, type Step } from "../../src/data/broadcast/engine";
import { entries, policy as sportPolicy, readingFromRow, readingFromStatus, summaryPlays, type BroadcastSport } from "../../src/data/broadcast/lanes";
import { emptyChange, type BindingHorizons, type BroadcastPolicy, type FastReading, type PTime, type RawPlay, type TimelineChange, type TimelineEntry } from "../../src/data/broadcast/timeline";
import { arr, at, num, str, type JSONValue } from "../../src/data/json";

/** The repository's own recordings (Tests/Fixtures/broadcast): what committed tests read. */
export const FIXTURES = join(import.meta.dirname, "..", "..", "..", "Tests", "Fixtures", "broadcast");

export interface Snapshot {
  readonly arrived: PTime;
  readonly path: string;
}

/** A recorded row (a `.jsonl` line), with its place. */
export interface Row {
  readonly json: JSONValue;
  readonly index: number;
}

/** A stretch the recorder wasn't reading this game: `lanes` (null: every lane). */
export interface Hole {
  readonly lower: PTime;
  readonly upper: PTime;
  readonly lanes: ReadonlySet<string> | null;
}

/** One recorded game. */
export class Recording {
  /** This event's scoreboard rows, oldest first. */
  rows: Row[] = [];
  /** The core status as the app polls it, each change, oldest first (empty: not recorded). */
  status: Row[] = [];
  /** Soccer's core plays, each changed look (empty: not recorded). */
  core: Snapshot[] = [];
  /**
   * The recorder's own failed fetches (`gaps.jsonl`, the event's and the sport's
   * scoreboard's; since 2026-10-31 12:22 PT): when and which lane ("summary",
   * "status", "core", "scoreboard"). Our holes, not the feed's.
   */
  gaps: { at: PTime; what: string }[] = [];
  /**
   * Whether the recorder logged its failed fetches while this game was recorded
   * (the event has a gaps.jsonl, or the sport's began before the game): then its
   * holes are explicit, and a silence in every lane is the feed's, not ours.
   */
  gapLogged = false;

  constructor(
    /** The sport's directory ("basketball_nba") and the event ID. */
    readonly sportDirectory: string,
    readonly event: string,
    readonly snapshots: Snapshot[],
  ) {}

  /** The first and last arrivals of anything recorded. */
  get span(): { lower: PTime; upper: PTime } | null {
    const times = [...this.snapshots, ...this.core].map((s) => s.arrived);
    if (times.length === 0) return null;
    return { lower: Math.min(...times), upper: Math.max(...times) };
  }

  /** "basketball_nba" → "basketball/nba". */
  get path(): string {
    return this.sportDirectory.replaceAll("_", "/");
  }

  get sport(): BroadcastSport | null {
    switch (this.sportDirectory.split("_")[0]) {
      case "basketball":
        return "basketball";
      case "football":
        return "football";
      case "soccer":
        return "soccer";
      case "baseball":
        return "baseball";
      default:
        return null;
    }
  }

  /** The events recorded for a sport (directories with snapshots). */
  static events(root: string, sport: string): string[] {
    const dir = join(root, sport);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => statSync(join(dir, name)).isDirectory())
      .sort();
  }

  /** The sports recorded. */
  static sports(root: string): string[] {
    if (!existsSync(root)) return [];
    return readdirSync(root)
      .filter((name) => statSync(join(root, name)).isDirectory() && Recording.events(root, name).length > 0)
      .sort();
  }

  /** A recorded game, read only. Files modified in the last `settle` seconds (the recorder may still be writing them) are left out. */
  static load(root: string, sport: string, event: string, settle = 10, now: number = Date.now()): Recording {
    const dir = join(root, sport, event);
    const recording = new Recording(sport, event, Recording.gzips(dir, settle, now));
    recording.rows = Recording.scoreRows(join(root, sport, "scores.jsonl"), event);
    recording.status = Recording.lines(join(dir, "status.jsonl"));
    recording.core = Recording.gzips(join(dir, "core"), settle, now);
    const eventGaps = join(dir, "gaps.jsonl");
    const gapRows = (rows: Row[]) => rows.flatMap((row) => (num(at(row.json, "at")) != null ? [{ at: num(at(row.json, "at"))!, what: str(at(row.json, "what")) ?? "" }] : []));
    const sportGaps = gapRows(Recording.lines(join(root, sport, "gaps.jsonl")));
    const mine = gapRows(Recording.lines(eventGaps));
    const span = recording.span;
    if (span) {
      // Only the failures while this game was recorded.
      recording.gaps = [...mine, ...sportGaps].filter((g) => g.at >= span.lower && g.at <= span.upper).sort((a, b) => a.at - b.at);
      const firstSport = sportGaps.length > 0 ? Math.min(...sportGaps.map((g) => g.at)) : null;
      recording.gapLogged = existsSync(eventGaps) || (firstSport != null && firstSport <= span.lower);
    }
    return recording;
  }

  /** `<arrival-ms>.json.gz` files in a directory, oldest first, settled ones only. */
  static gzips(dir: string, settle: number, now: number): Snapshot[] {
    if (!existsSync(dir)) return [];
    const out: Snapshot[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json.gz")) continue;
      const ms = Number(name.slice(0, -".json.gz".length));
      if (!Number.isFinite(ms) || name.slice(0, -".json.gz".length).trim() === "") continue;
      const path = join(dir, name);
      if (now - statSync(path).mtimeMs < settle * 1000) continue;
      out.push({ arrived: ms / 1000, path });
    }
    return out.sort((a, b) => a.arrived - b.arrived);
  }

  /** A `.jsonl` file's rows, oldest first; a half-written last line is ignored. */
  static lines(path: string): Row[] {
    if (!existsSync(path)) return [];
    const rows: Row[] = [];
    for (const line of readFileSync(path, "utf8").split("\n")) {
      if (line === "") continue;
      try {
        rows.push({ json: JSON.parse(line) as JSONValue, index: rows.length });
      } catch {
        // A half-written line.
      }
    }
    return rows;
  }

  /** A status row in the core status's own shape, for the app's reader (`readingFromStatus`). */
  static status(row: JSONValue): JSONValue {
    return {
      clock: at(row, "clock") ?? null,
      displayClock: at(row, "displayClock") ?? null,
      period: at(row, "period") ?? null,
      type: { state: at(row, "state") ?? null, shortDetail: at(row, "detail") ?? null, detail: at(row, "detail") ?? null },
    };
  }

  /** The scoreboard rows for one event; a half-written last line is ignored. */
  static scoreRows(path: string, event: string): Row[] {
    return Recording.lines(path)
      .filter((r) => str(at(r.json, "event")) === event)
      .map((r, index) => ({ json: r.json, index }));
  }

  /**
   * The recorder's holes, so a replay doesn't take them for the feed's lag.
   * From `gaps.jsonl` when it was recorded: each failed fetch leaves its lane
   * unread until the next try (~5 s; failures in a row chain). Before that,
   * inferred: every lane silent for over 60 s while the game clock ran more
   * than 20 s across it (plays went by unread; a break or a halftime moves
   * it 0–7 s), from the status lane's clock, else the scoreboard's.
   */
  holes(p: BroadcastPolicy): Hole[] {
    const out: Hole[] = [];
    if (this.gaps.length > 0) {
      for (const lane of new Set(this.gaps.map((g) => g.what))) {
        let current: { lower: number; upper: number } | null = null;
        for (const g of this.gaps) {
          if (g.what !== lane) continue;
          const r = { lower: g.at - 0.1, upper: g.at + 5 };
          if (current && r.lower <= current.upper + 1) {
            current = { lower: current.lower, upper: Math.max(current.upper, r.upper) };
          } else {
            if (current) out.push({ ...current, lanes: new Set([lane]) });
            current = r;
          }
        }
        if (current) out.push({ ...current, lanes: new Set([lane]) });
      }
    }
    if (this.gapLogged) return out.sort((a, b) => a.lower - b.lower);
    // Recorded before the recorder logged its failures: lane silence while the clock ran.
    const activity = [
      ...[...this.snapshots, ...this.core].map((s) => s.arrived),
      ...this.status.flatMap((r) => num(at(r.json, "at")) ?? []),
      ...this.rows.flatMap((r) => num(at(r.json, "at")) ?? []),
    ].sort((a, b) => a - b);
    const clocks = this.clockReadings(p);
    const atOrBefore = (t: number) => {
      for (let k = clocks.length - 1; k >= 0; k--) if (clocks[k]!.at <= t + 0.5) return clocks[k]!.elapsed;
      return null;
    };
    const atOrAfter = (t: number) => clocks.find((c) => c.at >= t - 0.5)?.elapsed ?? null;
    for (let k = 0; k + 1 < activity.length; k++) {
      const a = activity[k]!;
      const b = activity[k + 1]!;
      if (!(b - a > 60)) continue;
      const e0 = atOrBefore(a);
      const e1 = atOrAfter(b);
      if (e0 == null || e1 == null || !(e1 - e0 > 20)) continue;
      out.push({ lower: a, upper: b, lanes: null });
    }
    return out.sort((x, y) => x.lower - y.lower);
  }

  /** The game clock as the recording saw it, as game time elapsed: the status lane's, else the scoreboard's. */
  clockReadings(p: BroadcastPolicy): { at: PTime; elapsed: number }[] {
    const total = (period: number, seconds: number) => {
      if (p.clockCountsDown === false) return seconds;
      const length = period > p.regulationPeriods && p.overtimeLength > 0 ? p.overtimeLength : p.periodLength;
      const before = Math.min(period - 1, p.regulationPeriods) * p.periodLength + Math.max(period - 1 - p.regulationPeriods, 0) * p.overtimeLength;
      return before + length - seconds;
    };
    if (this.status.length > 0) {
      return this.status.flatMap((row) => {
        const t = num(at(row.json, "at"));
        const period = num(at(row.json, "period"));
        const clock = num(at(row.json, "clock"));
        return t == null || period == null || clock == null ? [] : [{ at: t, elapsed: total(period, clock) }];
      });
    }
    return this.rows.flatMap((row) => {
      const t = num(at(row.json, "at"));
      const period = num(at(row.json, "period"));
      const display = str(at(row.json, "clock"));
      if (t == null || period == null || display == null) return [];
      if (p.clockCountsDown === false) {
        // "68'", "45'+2'": minutes.
        const minutes = display
          .split("+")
          .map((part) => part.replace(/\D/g, ""))
          .filter((digits) => digits !== "")
          .reduce((sum, digits) => sum + Number(digits), 0);
        return minutes > 0 ? [{ at: t, elapsed: minutes * 60 }] : [];
      }
      const seconds = clockSeconds(display);
      return seconds == null ? [] : [{ at: t, elapsed: total(period, seconds) }];
    });
  }

  /** A recorded look at soccer's core plays: `{count, offset, items}`. */
  coreLook(snapshot: Snapshot): JSONValue | null {
    return this.summary(snapshot);
  }

  /** A snapshot's summary. */
  summary(snapshot: Snapshot): JSONValue | null {
    try {
      return JSON.parse(gunzipSync(readFileSync(snapshot.path)).toString("utf8")) as JSONValue;
    } catch {
      return null;
    }
  }

  /** Which side the summary lists as home: (home team ID, away team ID). */
  teams(): { home: string | null; away: string | null } {
    const last = this.snapshots.at(-1);
    const summary = last ? this.summary(last) : null;
    const competitors = arr(at(summary, "header", "competitions", 0, "competitors"));
    return {
      home: str(at(competitors.find((c) => str(at(c, "homeAway")) === "home"), "team", "id")) ?? null,
      away: str(at(competitors.find((c) => str(at(c, "homeAway")) === "away"), "team", "id")) ?? null,
    };
  }
}

/** NBADetail.seconds, as the replay reads the scoreboard's "6:54" and "33.8". */
function clockSeconds(display: string): number | null {
  const parts = display.split(":").filter((p) => p !== "");
  if (parts.length === 2) {
    const m = Number(parts[0]);
    const s = Number(parts[1]);
    return Number.isFinite(m) && Number.isFinite(s) ? m * 60 + s : null;
  }
  const n = Number(display);
  return display.trim() !== "" && Number.isFinite(n) ? n : null;
}

/** How often each lane is read, in seconds. */
export interface Cadence {
  readonly slow: number;
  readonly scoreboard: number;
  readonly status: number | null;
}

/** The app's: the slow lane every few seconds (the sport's), the scoreboard every 30 s, the core status every 5 s. */
export const appCadence = (p: BroadcastPolicy): Cadence => ({ slow: p.slowPoll, scoreboard: p.scoreboardPoll, status: p.statusPoll });

/** The recorder's own: the summary every 3 s, the scoreboard every ~10 s. */
export const RECORDER_CADENCE: Cadence = { slow: 3, scoreboard: 10, status: null };

/** Something the replay does at a virtual time. */
export type Input =
  | { readonly kind: "slow"; readonly snapshot: Snapshot | null }
  /** Soccer's core plays: the recorded look as of the poll. */
  | { readonly kind: "core"; readonly snapshot: Snapshot | null }
  | { readonly kind: "scoreboard"; readonly row: Row }
  /** The status from the scoreboard's rows (before `status.jsonl` was recorded). */
  | { readonly kind: "status"; readonly row: Row; readonly running: boolean | null }
  /** The recorded core status. */
  | { readonly kind: "statusRow"; readonly row: Row };

/** A recording fed through the real lanes into an engine on a virtual clock. */
export class RecordingReplay {
  readonly sport: BroadcastSport;
  readonly policy: BroadcastPolicy;
  /** The recorder's holes: nothing is read inside them (the app's own outage, not the feed's lag). */
  readonly holes: Hole[];
  readonly engine: BroadcastEngine<RawPlay>;
  now: PTime = 0;
  private lastSnapshot: Snapshot | null = null;
  private lastScoreboard: FastReading | null = null;
  private lastStatus: FastReading | null = null;
  /** Each snapshot's parsed entries, by arrival (a game's 200 snapshots parse once). */
  private parsed = new Map<number, TimelineEntry<RawPlay>[]>();

  private constructor(
    readonly recording: Recording,
    sport: BroadcastSport,
    p: BroadcastPolicy,
  ) {
    this.sport = sport;
    this.policy = p;
    this.holes = recording.holes(p);
    this.engine = new BroadcastEngine<RawPlay>(sport, p);
  }

  static make(recording: Recording, p?: BroadcastPolicy): RecordingReplay | null {
    const sport = recording.sport;
    if (!sport) return null;
    return new RecordingReplay(recording, sport, p ?? sportPolicy(sport, recording.path));
  }

  /** The lane an input reads. */
  static lane(input: Input): string {
    switch (input.kind) {
      case "slow":
        return "summary";
      case "core":
        return "core";
      case "scoreboard":
      case "status":
        return "scoreboard";
      case "statusRow":
        return "status";
    }
  }

  /** Whether a read at `t` falls in one of the recorder's holes for that lane. */
  inHole(input: Input, t: PTime): boolean {
    const lane = RecordingReplay.lane(input);
    return this.holes.some((h) => t >= h.lower && t <= h.upper && (h.lanes?.has(lane) ?? true));
  }

  /** The inputs at the cadence, in time order (ties: slow lane first). */
  schedule(cadence: Cadence, start?: PTime, end?: PTime): { t: PTime; input: Input }[] {
    const span = this.recording.span;
    if (!span) return [];
    const begin = start ?? span.lower;
    // Past the last look the recording knows nothing: replaying on would only stall.
    const finish = end ?? span.upper + cadence.slow;
    const out: { t: PTime; input: Input }[] = [];
    // The slow lane: each poll gets the newest look that had arrived by then. Soccer's
    // is its core plays when they were recorded (its summary has only the key events).
    const soccerCore = this.sport === "soccer" && this.recording.core.length > 0;
    const looks = soccerCore ? this.recording.core : this.recording.snapshots;
    let t = begin;
    let s = 0;
    while (t <= finish && looks.length > 0) {
      while (s + 1 < looks.length && looks[s + 1]!.arrived <= t) s += 1;
      const look = looks[s]!.arrived <= t ? looks[s]! : null;
      out.push({ t, input: soccerCore ? { kind: "core", snapshot: look } : { kind: "slow", snapshot: look } });
      t += cadence.slow;
    }
    const rows = this.recording.rows;
    const rowAt = (time: PTime): Row | null => {
      let lo = 0;
      let hi = rows.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if ((num(at(rows[mid]!.json, "at")) ?? 0) <= time) lo = mid + 1;
        else hi = mid;
      }
      return lo > 0 ? rows[lo - 1]! : null;
    };
    t = begin;
    while (t <= finish) {
      const r = rowAt(t);
      if (r) out.push({ t, input: { kind: "scoreboard", row: r } });
      t += cadence.scoreboard;
    }
    if (this.recording.status.length > 0) {
      // The recorded core status, at the app's cadence (5 s; the recorder's own when it has none).
      const statuses = this.recording.status;
      t = begin;
      let k = -1;
      while (t <= finish) {
        while (k + 1 < statuses.length && (num(at(statuses[k + 1]!.json, "at")) ?? Infinity) <= t) k += 1;
        if (k >= 0) out.push({ t, input: { kind: "statusRow", row: statuses[k]! } });
        t += cadence.status ?? 5;
      }
    } else if (cadence.status != null) {
      // The status from the scoreboard's rows (before the recorder saved the core status):
      // running while the rows' clock keeps changing, stopped once they stop.
      t = begin;
      while (t <= finish) {
        const r = rowAt(t);
        if (r) {
          const arrived = num(at(r.json, "at")) ?? t;
          const previous = r.index > 0 ? str(at(rows[r.index - 1]!.json, "clock")) : undefined;
          const moving = previous != null && previous !== str(at(r.json, "clock")) && t - arrived < 12;
          out.push({ t, input: { kind: "status", row: r, running: moving } });
        }
        t += cadence.status;
      }
    }
    return out
      .map((element, offset) => ({ element, offset }))
      .filter(({ element }) => !this.inHole(element.input, element.t))
      .sort((a, b) => a.element.t - b.element.t || a.offset - b.offset)
      .map(({ element }) => element);
  }

  /** The theater's binding horizons, as the page passes them to the broadcast (the theater bench drives the replay this way). */
  setHorizons(horizons: BindingHorizons): void {
    this.engine.setHorizons(horizons);
  }

  /** The theater's solved decisive moments, as the page passes them to the broadcast. */
  setAnchors(anchors: ReadonlyMap<string, PTime>, leadIns: ReadonlyMap<string, number> = new Map()): void {
    this.engine.setAnchors(anchors, leadIns);
  }

  /** Applies one input at its time (without advancing the clock). */
  apply(input: Input, t: PTime): TimelineChange | null {
    this.now = t;
    switch (input.kind) {
      case "slow": {
        const snapshot = input.snapshot;
        if (!snapshot) return null;
        if (snapshot === this.lastSnapshot) {
          this.engine.noteRead("summary", t);
          return null;
        }
        this.lastSnapshot = snapshot;
        let list = this.parsed.get(snapshot.arrived);
        if (!list) {
          const summary = this.recording.summary(snapshot);
          if (summary == null) return null;
          const plays = summaryPlays(summary, this.sport);
          // Soccer's summary has no play list: its key events and commentary stand in.
          list = entries(plays ?? arr(at(summary, "keyEvents")), this.sport, this.policy);
          this.parsed.set(snapshot.arrived, list);
        }
        return this.engine.ingest({ lane: "summary", entries: list, coverage: "full", arrived: t });
      }
      case "core": {
        const look = input.snapshot;
        if (!look) return null;
        if (look === this.lastSnapshot) {
          this.engine.noteRead("core", t);
          return null;
        }
        this.lastSnapshot = look;
        let list = this.parsed.get(look.arrived);
        if (!list) {
          const json = this.recording.coreLook(look);
          if (json == null) return null;
          list = entries(arr(at(json, "items")), this.sport, this.policy);
          this.parsed.set(look.arrived, list);
        }
        return this.engine.ingest({ lane: "core", entries: list, coverage: "tail", arrived: t });
      }
      case "statusRow": {
        const reading = readingFromStatus(Recording.status(input.row.json), this.policy, this.lastStatus, t);
        if (reading) {
          this.lastStatus = reading;
          this.engine.observe(reading);
        }
        return null;
      }
      case "scoreboard": {
        const reading = readingFromRow(input.row.json, this.policy, this.lastScoreboard, t);
        if (reading) {
          this.lastScoreboard = reading;
          this.engine.observe(reading);
        }
        return null;
      }
      case "status": {
        const base = readingFromRow(input.row.json, this.policy, this.lastStatus, t);
        if (base) {
          const reading: FastReading = { ...base, score: null, running: input.running, source: "status" };
          this.lastStatus = reading;
          this.engine.observe(reading);
        }
        return null;
      }
    }
  }

  /**
   * Runs the replay: every input at its time, the engine's wakes between,
   * `step` after each advance (with the time and any ingest's change).
   */
  run(cadence: Cadence, step: (replay: RecordingReplay, t: PTime, result: Step<RawPlay>, change: TimelineChange | null) => void, start?: PTime, end?: PTime): void {
    const inputs = this.schedule(cadence, start, end);
    const finish = inputs.at(-1)?.t;
    if (finish == null) return;
    let i = 0;
    let t = inputs[0]?.t ?? 0;
    for (;;) {
      const wakeAt = this.engine.nextWake(t);
      if (!(i < inputs.length || (wakeAt != null && wakeAt <= finish))) break;
      const nextInput = i < inputs.length ? inputs[i]!.t : Infinity;
      const at_ = Math.min(nextInput, wakeAt ?? Infinity);
      if (!Number.isFinite(at_) || at_ > finish) break;
      t = at_;
      let change: TimelineChange | null = null;
      while (i < inputs.length && inputs[i]!.t <= t) {
        const c = this.apply(inputs[i]!.input, inputs[i]!.t);
        if (c) change = change ? merged(change, c) : c;
        i += 1;
      }
      this.now = t;
      const result = this.engine.advance(t);
      step(this, t, result, change);
    }
  }
}

function merged(a: TimelineChange, b: TimelineChange): TimelineChange {
  const out = emptyChange();
  out.added = [...a.added, ...b.added];
  out.revised = [...a.revised, ...b.revised];
  out.removed = [...a.removed, ...b.removed];
  out.correctedTold = [...a.correctedTold, ...b.correctedTold];
  out.removedTold = [...a.removedTold, ...b.removedTold];
  out.lateInsertions = [...a.lateInsertions, ...b.lateInsertions];
  return out;
}
