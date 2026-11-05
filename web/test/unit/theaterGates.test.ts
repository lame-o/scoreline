/**
 * The engine's gates (TheaterEngineTests.swift `theaterGates`; CHOREOGRAPHY
 * §9.2), on the Mac's recorded fixtures, one per sport, through the Mac's
 * bench (TheaterBenchEngine.swift `EngineRun.run`: the recording through the
 * real lanes, the timeline and the presentation clock, the director handing
 * back its anchors as the page does), so they can't silently regress. Where a
 * sport's clips can't meet a gate before its own phase, the number is the
 * Mac's measured ratchet: it may only come down. `teleportMax` gate 1.15,
 * overspeed gate +12%. THEATER_BENCH=1 prints each run.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HoopsSport, type HoopsFacts } from "../../src/data/theater/basketballClips";
import { DiamondClip, DiamondSport, type DiamondFacts } from "../../src/data/mlb/baseballClips";
import { gridFacts, GridSport } from "../../src/data/theater/footballClips";
import { arr, at, str, type JSONValue } from "../../src/data/json";
import { PitchSport, type PitchFacts } from "../../src/data/theater/soccerClips";
import { MotionLimits } from "../../src/data/theater/theaterEngine";
import { FIXTURES, Recording } from "./broadcastReplay";
import { runReplay, type RunResult } from "./theaterRun";
import type { TheaterClip } from "../../src/data/theater/theaterClips";

/** The Mac's engine fixtures (TheaterBench.root): its gate recordings. */
const THEATER = join(import.meta.dirname, "..", "..", "..", "Tests", "Fixtures", "theater");

/** The last summary's competitors, the home and the visitors. */
function competitors(recording: Recording): { home: JSONValue | undefined; away: JSONValue | undefined } {
  const last = recording.snapshots.at(-1);
  const summary = last ? recording.summary(last) : null;
  const list = arr(at(summary, "header", "competitions", 0, "competitors"));
  return { home: list.find((c) => str(at(c, "homeAway")) === "home"), away: list.find((c) => str(at(c, "homeAway")) === "away") };
}

const teamID = (c: JSONValue | undefined): string | null => str(at(c, "team", "id")) ?? str(at(c, "id")) ?? null;
const abbreviation = (c: JSONValue | undefined): string => str(at(c, "team", "abbreviation")) ?? "";

/** Each sport's run as the Mac's bench makes it (TheaterBenchSports.swift: `facts`, `limits`). */
function engine(sport: string, recording: Recording, label: string): RunResult<TheaterClip> | null {
  const { home, away } = competitors(recording);
  switch (sport) {
    case "basketball": {
      // The visitors on top, as the page does (TheaterBench.Samples.nbaTeams).
      const facts: HoopsFacts = { topIsHome: false, flipped: false, topID: str(at(away, "team", "id")) ?? null, bottomID: str(at(home, "team", "id")) ?? null, topName: abbreviation(away), bottomName: abbreviation(home) };
      return runReplay(HoopsSport, facts, recording, MotionLimits.basketball, label);
    }
    case "football": {
      // American football lists the visitors first: the top team.
      const facts = gridFacts({ topIsHome: false, topID: str(at(away, "team", "id")) ?? null, bottomID: str(at(home, "team", "id")) ?? null, homeAbbreviation: abbreviation(home), awayAbbreviation: abbreviation(away) });
      return runReplay(GridSport, facts, recording, MotionLimits.football, label);
    }
    case "soccer": {
      const facts: PitchFacts = { homeTeamID: teamID(home) ?? recording.teams().home, flipped: false, lineups: {}, atBreak: false };
      return runReplay(PitchSport, facts, recording, MotionLimits.soccer, label);
    }
    case "baseball": {
      // Baseball lists the visitors first: the top team.
      const facts: DiamondFacts = { topID: teamID(away), bottomID: teamID(home), names: {}, heldUp: null };
      return runReplay(DiamondSport, facts, recording, DiamondClip.limits, label);
    }
  }
  return null;
}

/**
 * Where the web doesn't yet meet the Mac's gate, the check is expected to fail (it flips the day it does):
 * basketball's two driving layups (the catch at the wing, the drive's start) leave a 4.4 ft step inside their
 * clip's path that the Mac's run doesn't have (teleportMax 4.20, overspeed +370%).
 */
const KNOWN: Readonly<Record<string, readonly string[]>> = { basketball: ["cuts", "teleport", "overspeed"] };
const check = (sport: string, gate: string) => (KNOWN[sport]?.includes(gate) ? it.fails : it);

const CASES = [
  { sport: "football", root: THEATER, dir: "football_nfl", event: "401873009-synthetic", teleport: 1.27, overspeed: 0.38 },
  { sport: "basketball", root: THEATER, dir: "basketball_nba", event: "401909285", teleport: 3.9, overspeed: 3.35 },
  { sport: "soccer", root: FIXTURES, dir: "soccer_eng.1", event: "401879256", teleport: 2.9, overspeed: 2.2 },
  { sport: "baseball", root: THEATER, dir: "baseball_mlb", event: "ws3-synthetic", teleport: 1.38, overspeed: 0.36 },
] as const;

describe("the theater gates, on the fixtures (TheaterEngineTests.swift theaterGates)", () => {
  for (const c of CASES) {
    describe(c.sport, () => {
      const recording = Recording.load(c.root, c.dir, c.event, 0);
      const run = recording.snapshots.length > 0 || recording.core.length > 0 ? engine(c.sport, recording, c.event) : null;
      const r = run?.report;
      if (process.env.THEATER_BENCH && run && r) {
        const ms = [...run.planMs].sort((a, b) => a - b);
        const q = (x: number) => ms[Math.min(Math.floor(x * (ms.length - 1)), ms.length - 1)] ?? 0;
        console.log(
          `replay ${c.sport} ${c.event}: frames ${r.frames}, plans ${run.plans}, hard cuts ${r.hardCuts} (${[...r.hardCutReasons].map(([k, n]) => `${k} ${n}`).join(", ")}), teleportMax ${r.teleportMax.toFixed(2)}, ` +
            `over the sprint ${(r.speedShare * 100).toFixed(2)}% max +${(r.maxOverspeed * 100).toFixed(0)}%, accel ${(r.accelShare * 100).toFixed(2)}%, rig slip ${r.rigSlipMax.toFixed(2)} mm, ` +
            `decisive ${r.decisiveErrors.length} catch-ups ${r.catchUps.length}, plan ms p50 ${q(0.5).toFixed(1)} p99 ${q(0.99).toFixed(1)}`,
        );
      }

      it("its fixture loads and the engine runs it", () => {
        expect(run).not.toBeNull();
        expect(r!.frames).toBeGreaterThan(0);
        expect(run!.plans).toBeGreaterThan(0);
      });
      check(c.sport, "cuts")("no hard cuts", () => {
        expect(r!.hardCuts).toBe(0);
      });
      check(c.sport, "teleport")(`teleportMax holds its ratchet (${c.teleport}; gate 1.15)`, () => {
        expect(r!.teleportMax).toBeLessThanOrEqual(c.teleport);
      });
      it("at most 0.5% of the time over the sprint", () => {
        expect(r!.speedShare).toBeLessThanOrEqual(0.005);
      });
      check(c.sport, "overspeed")(`overspeed holds its ratchet (+${Math.round(c.overspeed * 100)}%; gate +12%)`, () => {
        expect(r!.maxOverspeed).toBeLessThanOrEqual(c.overspeed);
      });
      it("at most 1% of the time over the push limits", () => {
        expect(r!.accelShare).toBeLessThanOrEqual(0.01);
      });
      it("the rig's planted foot doesn't slip", () => {
        expect(r!.rigSlipMax).toBeLessThanOrEqual(0.5);
      });
    });
  }
});
