/**
 * The replay bench (BroadcastBench.swift; BROADCAST.md "How it's proven";
 * CHOREOGRAPHY §9): a recorded game through the real lanes, the timeline and
 * the presentation clock on a virtual clock, deterministic and faster than
 * real time. broadcastBench.test.ts runs it over Tests/Fixtures/broadcast and
 * asserts the gates; with `SCORELINE_RECORDINGS` set it runs over that
 * recordings folder too and prints each game's report (`SCORELINE_BENCH=grid`:
 * the q × binding horizon trade curve; `SCORELINE_BENCH=breaks`: every break).
 *
 * Per game it reports D over the game and what it's made of, the delay it
 * adds to today's scoreboard and page, how each live-ball play met its
 * binding horizon (known before it; inside it, with the lead-in compressed;
 * past its moment by up to 1.5 s, a declared micro catch-up; or beyond),
 * late tellings, corrections after presentation, stalls, skips and jumps,
 * and the safety net's applications.
 */
import { isInterval as statusIsInterval, policy as sportPolicy } from "../../src/data/broadcast/lanes";
import type { ClockEvent } from "../../src/data/broadcast/presentationClock";
import { isInterval, presentedStatus } from "../../src/data/broadcast/presentedGame";
import { horizonFor, quantile, scoreKey, type BroadcastPolicy, type GameTimeline, type Knowledge, type PTime, type RawPlay, type ScoreLine } from "../../src/data/broadcast/timeline";
import { at, num, str } from "../../src/data/json";
import { appCadence, RECORDER_CADENCE, Recording, RecordingReplay } from "./broadcastReplay";

/** How a live-ball play's arrival met its binding horizon (late binding, CHOREOGRAPHY §4.6). */
export const BINDINGS = ["beforeBind", "compressed", "microCatchUp", "beyond", "correction"] as const;
export type Binding = (typeof BINDINGS)[number];

export interface Report {
  label: string;
  snapshots: number;
  lanes: string;
  minutes: number;
  delays: { t: PTime; actual: number; target: number }[];
  lags: Record<string, number[]>;
  insertion: number[];
  /** Each scoring play told: wall time told, and when the scoreboard first had that score. */
  added: number[];
  addedApp: number[];
  knownBeforeLeadIn: Record<string, { known: number; total: number }>;
  /** Each live-ball play's arrival against its binding horizon, by kind. */
  binding: Record<string, Partial<Record<Binding, number>>>;
  /** The target's terms at the end: lag quantile, horizon, margin, samples. */
  terms: { lag: number; horizon: number; margin: number; samples: number; quantile: number };
  late: Record<string, number>;
  corrected: number;
  removedTold: number;
  revisions: number;
  removals: number;
  stalls: number[];
  skips: number[];
  jumps: number;
  wakes: number;
  safetyNet: number;
  bounds: Partial<Record<Knowledge["bound"], number>>;
  fastLag: number | null;
  told: number;
  history: number;
  /** The engine's cost per step (ingest + advance), for the report only. */
  stepTime: number[];
  /** The kinds the theater must bind (null: every live-ball kind); the rest is flow. */
  decisive: ReadonlySet<string> | null;
  /** Each new score told, behind its play's real moment: as the broadcast told it, as today's page showed it, as the scoreboard had it, and as the slow lane first had the play. */
  behindReal: { broadcast: number[]; page: number[]; board: number[]; lane: number[] };
  /** Announced plays (VAR decisions) told, by how: "onTime", "late", "correction". */
  reviews: Record<string, number>;
  /** Told scores revised down and held until the next play told (VAR overturns). */
  holds: number;
  /** Plays that change the score, told: by how ("history (jump)" is what the jump rule forbids). */
  scoring: Record<string, number>;
  /** Each jump's length (p moved), and each long stall's recovery: from the resume until D is back within 5 s of its target, with the deficit at the resume. */
  jumpLengths: number[];
  recoveries: { deficit: number; took: number }[];
  /** The recorder's holes (nothing read inside them), and the live-ball plays that landed in the look after one (their lag is ours: left out of the lags and binding). */
  holes: number;
  holeMinutes: number;
  afterOutage: number;
  /** Inside a hole and the 300 s after it (our own outage and its recovery): the jumps and stalls there, kept apart from the feed's. */
  outageJumps: number[];
  outageStalls: number;
}

export function emptyReport(label = ""): Report {
  return {
    label,
    snapshots: 0,
    lanes: "",
    minutes: 0,
    delays: [],
    lags: {},
    insertion: [],
    added: [],
    addedApp: [],
    knownBeforeLeadIn: {},
    binding: {},
    terms: { lag: 0, horizon: 0, margin: 0, samples: 0, quantile: 0 },
    late: {},
    corrected: 0,
    removedTold: 0,
    revisions: 0,
    removals: 0,
    stalls: [],
    skips: [],
    jumps: 0,
    wakes: 0,
    safetyNet: 0,
    bounds: {},
    fastLag: null,
    told: 0,
    history: 0,
    stepTime: [],
    decisive: null,
    behindReal: { broadcast: [], page: [], board: [], lane: [] },
    reviews: {},
    holds: 0,
    scoring: {},
    jumpLengths: [],
    recoveries: [],
    holes: 0,
    holeMinutes: 0,
    afterOutage: 0,
    outageJumps: [],
    outageStalls: 0,
  };
}

const bump = (map: Record<string, number>, key: string, by = 1) => {
  map[key] = (map[key] ?? 0) + by;
};

/** Whether a play raises the score over the play before it (a goal, a basket, a run). */
export function changesScore<P>(timeline: GameTimeline<P>, id: string): boolean {
  const k = timeline.records.findIndex((r) => r.entry.id === id);
  const score = k >= 0 ? timeline.records[k]!.entry.score : null;
  if (!score) return false;
  let before: ScoreLine | null = null;
  for (let i = k - 1; i >= 0; i--) {
    if (timeline.records[i]!.entry.score) {
      before = timeline.records[i]!.entry.score;
      break;
    }
  }
  if (!before) return false;
  return score.home + score.away > before.home + before.away;
}

/** One recorded game through the engine. */
export function run(recording: Recording, options: { recorder?: boolean; trace?: boolean; policy?: BroadcastPolicy } = {}): Report | null {
  const sport = recording.sport;
  if (!sport) return null;
  const replay = RecordingReplay.make(recording, options.policy ?? sportPolicy(sport, recording.path));
  if (!replay) return null;
  const policy = replay.policy;
  const cadence = options.recorder ? RECORDER_CADENCE : appCadence(policy);
  const report = emptyReport(`${recording.sportDirectory} ${recording.event}`);
  report.snapshots = recording.snapshots.length + recording.core.length;
  report.lanes = [
    recording.snapshots.length === 0 ? null : `${recording.snapshots.length} summaries`,
    recording.core.length === 0 ? null : `${recording.core.length} core looks`,
    recording.status.length === 0 ? "status from the scoreboard" : `${recording.status.length} status rows`,
  ]
    .filter(Boolean)
    .join(", ");
  const span = recording.span;
  if (span) report.minutes = (span.upper - span.lower) / 60;
  report.decisive = policy.decisive;
  // Our own outages and their recovery: the feed's numbers leave them out.
  const outageWindows = replay.holes.map((h) => ({ lower: h.lower, upper: h.upper + 300 }));
  const ours = (t: PTime) => outageWindows.some((w) => t >= w.lower && t <= w.upper);
  report.holes = replay.holes.length;
  report.holeMinutes = replay.holes.reduce((s, h) => s + (h.upper - h.lower), 0) / 60;
  // Today's page shows a lane's score while it's ahead (football, baseball, basketball);
  // soccer's page has no lane score: its hero is the scoreboard's.
  const laneScore = sport !== "soccer";
  // The scoreboard's first sighting of each score, and when the app (polling it every 30 s) would have shown it.
  const boardFirst = new Map<string, PTime>();
  for (const row of recording.rows) {
    const home = Number(str(at(row.json, "score", "home")) ?? num(at(row.json, "score", "home")));
    const away = Number(str(at(row.json, "score", "away")) ?? num(at(row.json, "score", "away")));
    const t = num(at(row.json, "at"));
    if (str(at(row.json, "state")) !== "in" || !Number.isInteger(home) || !Number.isInteger(away) || t == null) continue;
    const key = scoreKey({ home, away });
    if (!boardFirst.has(key)) boardFirst.set(key, t);
  }
  const start = span?.lower ?? 0;
  let nextSample = start;
  let lastScore: ScoreLine | null = null;
  let newestLiveBefore: PTime | null = null;
  let stallSince: PTime | null = null;
  let recovering: { since: PTime; deficit: number } | null = null;
  let stepStarted = performance.now();
  replay.run(cadence, (r, t, step, change) => {
    report.stepTime.push(performance.now() - stepStarted);
    const engine = r.engine;
    const timeline = engine.timeline;
    if (change) {
      report.revisions += change.revised.length;
      report.removals += change.removed.length;
      report.corrected += change.correctedTold.length;
      report.removedTold += change.removedTold.length;
      for (const id of change.lateInsertions) {
        const rec = timeline.record(id);
        if (!rec?.told) continue;
        if (rec.entry.kind.announced) bump(report.reviews, `${rec.told} (inserted)`);
        if (changesScore(timeline, id)) bump(report.scoring, `${rec.told} (inserted)`);
      }
      if (timeline.heldScore && timeline.heldSince === t) report.holds += 1;
      const p = engine.p(t);
      for (const id of change.added) {
        const rec = timeline.record(id);
        if (!rec || rec.backfill || rec.entry.kind.phase !== "live" || rec.entry.wallclock == null) continue;
        if (rec.afterOutage) {
          report.afterOutage += 1;
          continue;
        }
        const trusted = rec.entry.kind.phase === "live" && (rec.timeSource === "wallclock" || rec.timeSource === "statsapi") && rec.bounds == null;
        const label = trusted ? rec.entry.kind.label : `${rec.entry.kind.label} (${rec.timeSource})`;
        (report.lags[label] ??= []).push(rec.firstSeen - rec.entry.wallclock);
        if (newestLiveBefore != null) report.insertion.push(Math.max(newestLiveBefore - rec.eventTime, 0));
        // Where p was when it arrived, against its binding horizon and its moment.
        const horizon = horizonFor(timeline.horizons, rec.entry.kind);
        const behindTold = change.lateInsertions.includes(id);
        const binding: Binding =
          behindTold || p > rec.presentAt + 30
            ? "correction"
            : p <= rec.presentAt - horizon + 1e-6
              ? "beforeBind"
              : p <= rec.presentAt + 1e-6
                ? "compressed"
                : p <= rec.presentAt + 1.5
                  ? "microCatchUp"
                  : "beyond";
        const cell = (report.binding[rec.entry.kind.label] ??= {});
        cell[binding] = (cell[binding] ?? 0) + 1;
      }
      newestLiveBefore = timeline.newestLive;
    }
    if (step.knowledge) report.bounds[step.knowledge.bound] = (report.bounds[step.knowledge.bound] ?? 0) + 1;
    for (const event of step.events) {
      switch (event.kind) {
        case "stall":
          stallSince = event.at;
          break;
        case "resume":
          if (ours(event.at - event.held)) {
            report.outageStalls += 1;
            stallSince = null;
            break;
          }
          report.stalls.push(event.held);
          stallSince = null;
          if (event.held >= 30) recovering = { since: event.at, deficit: engine.clock.delay(event.at) - engine.clock.target };
          break;
        case "skip":
          report.skips.push(event.to - event.from);
          break;
        case "jump":
          if (ours(event.at)) report.outageJumps.push(event.to - event.from);
          else {
            report.jumps += 1;
            report.jumpLengths.push(event.to - event.from);
          }
          break;
        case "wake":
          report.wakes += 1;
          break;
        case "start":
          break;
      }
    }
    if (step.correction) report.safetyNet += 1;
    if (recovering && engine.clock.delay(t) <= engine.clock.target + 5) {
      report.recoveries.push({ deficit: recovering.deficit, took: t - recovering.since });
      recovering = null;
    }
    const jumped = step.events.some((e) => e.kind === "jump");
    for (const record of step.told) {
      if (record.told) {
        const how = record.told === "history" && jumped ? "history (jump)" : record.told;
        if (record.entry.kind.announced) bump(report.reviews, how);
        if (changesScore(timeline, record.entry.id)) bump(report.scoring, how);
      }
      report.told += 1;
      const label = record.entry.kind.label;
      if (record.told === "history") {
        report.history += 1;
        continue;
      }
      if (record.told === "late") bump(report.late, label);
      else if (record.told === "correction") bump(report.late, `${label} (correction)`);
      if (record.entry.kind.phase === "live" && !record.backfill) {
        const cell = (report.knownBeforeLeadIn[label] ??= { known: 0, total: 0 });
        cell.total += 1;
        if (record.firstSeen <= t - horizonFor(timeline.horizons, record.entry.kind) + 1e-6) cell.known += 1;
      }
      const score = record.entry.score;
      if (score && !(lastScore && score.home === lastScore.home && score.away === lastScore.away)) {
        // A new score (not a reversal): against the scoreboard, today's page and the real moment.
        const board = boardFirst.get(scoreKey(score));
        if (lastScore && score.home + score.away > lastScore.home + lastScore.away && board != null && !ours(t)) {
          report.added.push(t - board);
          // Today's app: the scoreboard at its next 30-s poll, or the play's own lane, whichever came first.
          const appBoard = start + Math.ceil((board - start) / policy.scoreboardPoll) * policy.scoreboardPoll;
          const page = laneScore ? Math.min(appBoard, record.firstSeen) : appBoard;
          report.addedApp.push(t - page);
          if (record.timeSource === "wallclock" || record.timeSource === "statsapi") {
            report.behindReal.broadcast.push(t - record.eventTime);
            report.behindReal.page.push(page - record.eventTime);
            report.behindReal.board.push(board - record.eventTime);
            report.behindReal.lane.push(record.firstSeen - record.eventTime);
          }
        }
        lastScore = score;
      }
    }
    while (nextSample <= t) {
      if (!ours(nextSample)) report.delays.push({ t: nextSample, actual: engine.clock.delay(nextSample), target: engine.clock.target });
      nextSample += 60;
    }
    report.fastLag = timeline.fast.lag;
    if (options.trace) {
      const p = engine.p(t);
      const k = step.knowledge;
      const f = (x: number) => `${x - start >= 0 ? "+" : ""}${(x - start).toFixed(1)}`;
      let line = `${(t - start).toFixed(1).padStart(7)} p=${f(p)} D=${(t - p).toFixed(1)} T=${engine.clock.target.toFixed(1)} cap=${f((k?.frontier ?? 0) - timeline.horizons.live)} ${k?.bound ?? "empty"} ${engine.clock.regime}`;
      if (change && change.added.length + change.revised.length + change.removed.length > 0) line += ` +${change.added.length} ~${change.revised.length} -${change.removed.length}`;
      for (const e of step.events) line += ` [${describe(e, start)}]`;
      for (const rec of step.told) if (rec.told !== "history") line += ` told(${rec.entry.kind.label} ${rec.told} @${f(rec.presentAt)} ${rec.entry.score ? `${rec.entry.score.away}–${rec.entry.score.home}` : ""})`;
      console.log(line);
    }
    stepStarted = performance.now();
  });
  if (stallSince != null) report.stalls.push(replay.now - stallSince);
  const final = replay.engine.timeline;
  report.safetyNet = final.safetyNetApplied;
  report.terms = { lag: final.lagQuantile, horizon: final.horizons.live, margin: policy.margin, samples: Math.min(final.lags.length, policy.lagWindow), quantile: policy.quantile };
  return report;
}

export function describe(event: ClockEvent, start: PTime): string {
  const f = (x: PTime) => `${x - start >= 0 ? "+" : ""}${(x - start).toFixed(1)}`;
  switch (event.kind) {
    case "start":
      return `start p=${f(event.p)}`;
    case "wake":
      return `wake ${f(event.from)}→${f(event.to)}`;
    case "jump":
      return `jump ${f(event.from)}→${f(event.to)}`;
    case "skip":
      return `skip ${f(event.from)}→${f(event.to)}`;
    case "stall":
      return `stall at p=${f(event.p)}`;
    case "resume":
      return `resume after ${event.held.toFixed(1)} s`;
  }
}

export function combined(reports: readonly Report[], label: string): Report {
  const r = emptyReport(label);
  for (const x of reports) {
    r.snapshots += x.snapshots;
    r.minutes += x.minutes;
    r.delays.push(...x.delays);
    for (const [k, v] of Object.entries(x.lags)) (r.lags[k] ??= []).push(...v);
    r.insertion.push(...x.insertion);
    r.added.push(...x.added);
    r.addedApp.push(...x.addedApp);
    for (const [k, v] of Object.entries(x.binding)) {
      const cell = (r.binding[k] ??= {});
      for (const [b, n] of Object.entries(v)) cell[b as Binding] = (cell[b as Binding] ?? 0) + (n ?? 0);
    }
    r.terms = x.terms;
    for (const [k, v] of Object.entries(x.knownBeforeLeadIn)) {
      const cell = (r.knownBeforeLeadIn[k] ??= { known: 0, total: 0 });
      cell.known += v.known;
      cell.total += v.total;
    }
    for (const [k, v] of Object.entries(x.late)) bump(r.late, k, v);
    r.corrected += x.corrected;
    r.removedTold += x.removedTold;
    r.revisions += x.revisions;
    r.removals += x.removals;
    r.stalls.push(...x.stalls);
    r.skips.push(...x.skips);
    r.jumps += x.jumps;
    r.wakes += x.wakes;
    r.safetyNet += x.safetyNet;
    for (const [k, v] of Object.entries(x.bounds)) r.bounds[k as Knowledge["bound"]] = (r.bounds[k as Knowledge["bound"]] ?? 0) + (v ?? 0);
    r.told += x.told;
    r.history += x.history;
    r.stepTime.push(...x.stepTime);
    r.decisive = x.decisive;
    r.behindReal.broadcast.push(...x.behindReal.broadcast);
    r.behindReal.page.push(...x.behindReal.page);
    r.behindReal.board.push(...x.behindReal.board);
    r.behindReal.lane.push(...x.behindReal.lane);
    for (const [k, v] of Object.entries(x.reviews)) bump(r.reviews, k, v);
    r.holds += x.holds;
    for (const [k, v] of Object.entries(x.scoring)) bump(r.scoring, k, v);
    r.jumpLengths.push(...x.jumpLengths);
    r.holes += x.holes;
    r.holeMinutes += x.holeMinutes;
    r.afterOutage += x.afterOutage;
    r.outageJumps.push(...x.outageJumps);
    r.outageStalls += x.outageStalls;
    r.recoveries.push(...x.recoveries);
  }
  return r;
}

export function summary(values: readonly number[]): string {
  if (values.length === 0) return "none";
  const q = (p: number) => quantile(values, p).toFixed(1);
  return `n=${values.length} p50=${q(0.5)} p90=${q(0.9)} p95=${q(0.95)} max=${Math.max(...values).toFixed(1)}`;
}

/** Binding counts (BINDINGS order): every live-ball kind, or decisive and flow apart. */
export function bindingSplit(r: Report): [string, number[]][] {
  const counts = (keep: (label: string) => boolean) => BINDINGS.map((b) => Object.entries(r.binding).reduce((sum, [label, cell]) => sum + (keep(label) ? (cell[b] ?? 0) : 0), 0));
  const decisive = r.decisive;
  if (!decisive) return [["live-ball plays", counts(() => true)]];
  return [
    [`decisive plays (${[...decisive].sort().join(", ")})`, counts((l) => decisive.has(l))],
    ["flow (the rest live-ball)", counts((l) => !decisive.has(l))],
  ];
}

const pct = (n: number, all: number) => ((n / Math.max(all, 1)) * 100).toFixed(1);

export function render(r: Report): string {
  const lines = ["", `== ${r.label}: ${r.snapshots} looks over ${Math.round(r.minutes)} min${r.lanes ? ` (${r.lanes})` : ""}`];
  const actual = r.delays.map((d) => d.actual).filter(Number.isFinite);
  const target = r.delays.map((d) => d.target);
  lines.push(`  D actual: ${summary(actual)}`);
  lines.push(`  D target: ${summary(target)}`);
  lines.push(
    `  D's terms (at the end): live-ball lag q${(r.terms.quantile * 100).toFixed(0)} ${r.terms.lag.toFixed(1)} s (window of ${r.terms.samples} plays) + binding horizon ${r.terms.horizon.toFixed(1)} s + margin ${r.terms.margin.toFixed(1)} s = ${(r.terms.lag + r.terms.horizon + r.terms.margin).toFixed(1)} s`,
  );
  if (r.delays.length > 0) {
    const start = r.delays[0]!.t;
    const step = Math.max(Math.floor(r.delays.length / 12), 1);
    const samples = r.delays.filter((_, i) => i % step === 0);
    lines.push(`  D over the game (min: actual/target): ${samples.map((d) => `${Math.trunc((d.t - start) / 60)}:${d.actual.toFixed(0)}/${d.target.toFixed(0)}`).join("  ")}`);
  }
  const liveLags = Object.values(r.lags).flat();
  const trustedLags = Object.entries(r.lags)
    .filter(([k]) => !k.includes("("))
    .flatMap(([, v]) => v);
  lines.push(`  live-ball lag (first seen − wallclock): ${summary(liveLags)}; trusted event times only: ${summary(trustedLags)}`);
  for (const [label, values] of Object.entries(r.lags).sort(([a], [b]) => a.localeCompare(b))) lines.push(`    ${label}: ${summary(values)}`);
  lines.push(`  late insertion behind the newest live play: ${summary(r.insertion)}`);
  lines.push(`  added delay vs the scoreboard (recorded, ~10 s polls): ${summary(r.added)}`);
  lines.push(`  added delay vs today's page (scoreboard every 30 s, or the play's lane): ${summary(r.addedApp)}`);
  const real = r.behindReal;
  if (real.broadcast.length > 0) {
    const p50 = (v: number[]) => quantile(v, 0.5).toFixed(0);
    lines.push(
      `  each new score behind its real moment (p50, s; n=${real.broadcast.length}): the broadcast ${p50(real.broadcast)}, today's page ${p50(real.page)}, the scoreboard ${p50(real.board)}, the slow lane's first sight ${p50(real.lane)}`,
    );
  }
  if (r.holes > 0) {
    lines.push(`  the recorder's holes: ${r.holes}, ${r.holeMinutes.toFixed(0)} min in all (nothing read in them); live-ball plays landing after one, left out of lag and binding: ${r.afterOutage}`);
    lines.push(`    inside them and 300 s after: jumps ${r.outageJumps.length === 0 ? "none" : r.outageJumps.map((j) => `${j.toFixed(0)} s`).join(", ")}, stalls ${r.outageStalls}`);
  }
  if (Object.keys(r.scoring).length > 0) lines.push(`  scoring plays told: ${Object.entries(r.scoring).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  if (r.jumpLengths.length > 0 || r.recoveries.length > 0) {
    lines.push(
      `  jumps (p moved, s): ${r.jumpLengths.map((j) => j.toFixed(0)).join(", ")}; long stalls' recovery (deficit at resume → back within 5 s of target): ${r.recoveries.map((x) => `${x.deficit.toFixed(0)} s → ${x.took.toFixed(0)} s`).join(", ")}`,
    );
  }
  if (Object.keys(r.reviews).length > 0 || r.holds > 0) {
    lines.push(`  announced (VAR decisions) told: ${Object.entries(r.reviews).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k} ${v}`).join(", ")}; told scores held for a reversal: ${r.holds}`);
  }
  const known = Object.values(r.knownBeforeLeadIn).reduce((a, c) => [a[0]! + c.known, a[1]! + c.total], [0, 0]);
  lines.push(
    `  live-ball plays known before their lead-in: ${known[0]}/${known[1]} (${pct(known[0]!, known[1]!)}%)  ${Object.entries(r.knownBeforeLeadIn)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k} ${v.known}/${v.total}`)
      .join(", ")}`,
  );
  for (const [name, bound] of bindingSplit(r)) {
    const all = bound.reduce((a, b) => a + b, 0);
    lines.push(
      `  ${name} vs their binding horizon (n=${all}): known before ${pct(bound[0]!, all)}%, lead-in compressed ${pct(bound[1]!, all)}%, micro catch-up ≤1.5 s ${pct(bound[2]!, all)}%, beyond ${pct(bound[3]!, all)}%, corrections ${pct(bound[4]!, all)}%`,
    );
  }
  lines.push(`  told: ${r.told} (${r.history} as history); late: ${Object.keys(r.late).length === 0 ? "none" : Object.entries(r.late).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  lines.push(`  revisions: ${r.revisions} (${r.corrected} after told), removals: ${r.removals} (${r.removedTold} after told)`);
  lines.push(`  stalls per hour: ${(r.minutes > 0 ? r.stalls.length / (r.minutes / 60) : 0).toFixed(1)}`);
  lines.push(`  stalls: ${r.stalls.length} (${summary(r.stalls)}); skips: ${r.skips.length} (total ${r.skips.reduce((a, b) => a + b, 0).toFixed(0)} s); jumps: ${r.jumps}; wakes: ${r.wakes}`);
  lines.push(`  safety net applied: ${r.safetyNet}${r.fastLag != null ? `; fast-lane lag ${r.fastLag.toFixed(1)} s` : ""}`);
  if (r.stepTime.length > 0) lines.push(`  engine per step (ingest + advance): p50 ${quantile(r.stepTime, 0.5).toFixed(2)} ms, p99 ${quantile(r.stepTime, 0.99).toFixed(2)} ms over ${r.stepTime.length} steps`);
  lines.push(`  watermark bound (per step): ${Object.entries(r.bounds).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  return lines.join("\n");
}

/** The trade curve: q × binding horizon, per sport over its recorded games (`--grid`). */
export function trade(games: readonly Recording[], recorder = false): string {
  const quantiles = [0.8, 0.85, 0.9, 0.95];
  const horizons = [2, 3, 4, 6];
  const bySport = new Map<string, Recording[]>();
  for (const g of games) if (g.snapshots.length + g.core.length >= 3) (bySport.get(g.sportDirectory) ?? bySport.set(g.sportDirectory, []).get(g.sportDirectory)!).push(g);
  const out: string[] = [];
  for (const [sport, recordings] of [...bySport].sort(([a], [b]) => a.localeCompare(b))) {
    const first = recordings[0]!;
    const base = sportPolicy(first.sport!, first.path);
    for (const sizing of base.decisive == null ? [base.sizeOnDecisive] : [false, true]) {
      const how = base.decisive == null ? "" : sizing ? " — (b) D sized on decisive kinds only" : " — (a) D sized on every live-ball kind";
      out.push("", `== ${sport}: ${recordings.length} games, the app's cadence; margin ${base.margin} s${how}`);
      out.push(`   q   horizon |  D p50  D p90 | added vs page p50  p90 | behind real p50 | after bind  micro≤1.5s  beyond  corrections${base.decisive == null ? "" : " (decisive kinds) | flow late"} | stalls/h`);
      for (const q of quantiles) {
        for (const h of horizons) {
          const p = { ...base, sizeOnDecisive: sizing, quantile: q, horizons: { live: h, byKind: {} } };
          const r = combined(recordings.flatMap((rec) => run(rec, { recorder, policy: p }) ?? []), sport);
          const actual = r.delays.map((d) => d.actual).filter(Number.isFinite);
          const split = bindingSplit(r);
          const bound = split[0]![1];
          const all = Math.max(bound.reduce((a, b) => a + b, 0), 1);
          const pc = (v: number[], x: number) => (v.length === 0 ? NaN : quantile(v, x));
          let line = `  ${q.toFixed(2)}  ${h.toFixed(1).padStart(4)} s  | ${pc(actual, 0.5).toFixed(1).padStart(6)} ${pc(actual, 0.9).toFixed(1).padStart(6)} | ${pc(r.addedApp, 0.5).toFixed(1).padStart(13)} ${pc(r.addedApp, 0.9).toFixed(1).padStart(5)} | ${pc(r.behindReal.broadcast, 0.5).toFixed(1).padStart(15)} | ${(((bound[1]! + bound[2]! + bound[3]!) / all) * 100).toFixed(1).padStart(8)}% ${((bound[2]! / all) * 100).toFixed(1).padStart(9)}% ${((bound[3]! / all) * 100).toFixed(1).padStart(6)}% ${((bound[4]! / all) * 100).toFixed(1).padStart(10)}%`;
          if (split.length > 1) {
            const flow = split[1]![1];
            line += ` | ${(((flow[3]! + flow[4]!) / Math.max(flow.reduce((a, b) => a + b, 0), 1)) * 100).toFixed(1).padStart(8)}%`;
          }
          line += ` | ${(r.minutes > 0 ? r.stalls.length / (r.minutes / 60) : 0).toFixed(1).padStart(6)}`;
          out.push(line);
        }
      }
    }
  }
  return out.join("\n");
}

/**
 * Every break in the recordings, as the page presents it (`--breaks`): from the
 * status's word (its lag taken off) to the next period's, what the hero says,
 * and how long after the status ESPN's own entry came.
 */
export function breaks(games: readonly Recording[]): { lines: string[]; failed: number; total: number } {
  let failed = 0;
  let total = 0;
  const lines: string[] = [];
  for (const recording of games) {
    const rows = recording.status.map((r) => r.json);
    const replay = RecordingReplay.make(recording);
    if (!replay || !rows.some((r) => statusIsInterval(str(at(r, "detail"))))) continue;
    const seen: { p: number; status: string; interval: boolean }[] = [];
    const firstEnd = new Map<number, PTime>();
    const regulation = replay.policy.regulationPeriods;
    replay.run(appCadence(replay.policy), (r, t) => {
      const game = r.engine.presented(t);
      seen.push({ p: r.engine.p(t), status: presentedStatus(game, replay.sport, regulation), interval: isInterval(game) });
      for (const record of r.engine.timeline.records) {
        const ended = record.entry.kind.endsPeriod;
        if (ended != null && !firstEnd.has(ended)) firstEnd.set(ended, t);
      }
    });
    const lag = replay.engine.timeline.fastLag;
    rows.forEach((row, k) => {
      if (!statusIsInterval(str(at(row, "detail"))) || (k > 0 && statusIsInterval(str(at(rows[k - 1], "detail"))))) return;
      const atTime = num(at(row, "at"));
      const period = num(at(row, "period"));
      const back = num(at(rows.slice(k).find((x) => !statusIsInterval(str(at(x, "detail"))) && str(at(x, "state")) === "in"), "at"));
      if (atTime == null || period == null || back == null) return;
      const during = seen.filter((s) => s.p >= atTime - lag + 3 && s.p < back - lag - 10);
      if (during.length === 0) return;
      const right = during.filter((s) => s.interval).length;
      const words = [...new Set(during.map((s) => s.status))].sort().slice(0, 4).join(", ");
      const entry = firstEnd.has(period) ? `${(firstEnd.get(period)! - atTime).toFixed(0).padStart(5)} s` : "  never";
      const share = right / during.length;
      total += 1;
      if (share < 0.98) failed += 1;
      lines.push(`${share < 0.98 ? "✗" : "✓"} ${recording.event.padEnd(12)} ${(str(at(row, "detail")) ?? "").padEnd(22)} ${(back - atTime).toFixed(0).padStart(5)} s long, entry ${entry} after the status, in the break ${(share * 100).toFixed(1)}% of it: ${words}`);
    });
  }
  lines.push("", `${total - failed} of ${total} breaks read as breaks throughout`);
  return { lines, failed, total };
}

/** Every recorded game under a root (directories with snapshots), loaded read only. */
export function recordings(root: string, only?: string): Recording[] {
  const out: Recording[] = [];
  for (const sport of Recording.sports(root)) {
    for (const event of Recording.events(root, sport)) {
      if (only && only !== sport && only !== `${sport}/${event}`) continue;
      out.push(Recording.load(root, sport, event));
    }
  }
  return out;
}
