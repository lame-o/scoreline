/**
 * A football clip runs on its script's own clock (FootballClipClockTests.swift,
 * check by check, its thresholds): the ball to the frame, the credited man
 * meeting it exactly, and nobody else slowing the game down for a man the
 * script asked too much of. On Monday Night Football's plays
 * (mnf-dal-phi-plays.json): a deep pass, a punt, a rush, a completion and a
 * touchdown.
 */
import { describe, expect, it } from "vitest";
import type { FootballTeams } from "../../src/data/liveFeeds/football";
import { GridClip } from "../../src/data/theater/footballClips";
import type { FootballIdle } from "../../src/data/theater/footballIdle";
import { idleScript } from "../../src/data/theater/footballIdle";
import { parse } from "../../src/data/theater/footballScene";
import { FootballScript, Gridiron } from "../../src/data/theater/footballScript";
import { ClipPlacement } from "../../src/data/theater/theaterClips";
import { MotionLimits } from "../../src/data/theater/theaterEngine";
import { FrameScratch } from "../../src/data/theater/theaterFrameScratch";
import { BakedPlan, Plan, PlanChain } from "../../src/data/theater/theaterPlanChain";
import { gridFrame } from "../../src/features/game/football/theater/directedField";
import { fixture } from "./fixtures";

type Item = Record<string, unknown>;
const items = (fixture("mnf-dal-phi-plays.json") as { items: Item[] }).items;
const teams: FootballTeams = { topIsHome: false, topID: "6", bottomID: "21", homeAbbreviation: "PHI", awayAbbreviation: "DAL" };
const BALL_KINDS = new Set(["catchHigh", "catchChest", "throwBall", "handoff", "kick", "scoop"]);

describe("a football clip on its script's own clock", () => {
  for (const [name, suffix] of [
    ["deep pass", "2186"],
    ["punt", "1812"],
    ["rush", "63"],
    ["completion", "85"],
    ["touchdown", "385"],
  ] as const) {
    it(`${name}: the clip is its script, the ball to the frame, every contact where it was, nobody far past his sprint`, () => {
      const raw = items.find((i) => String(i.id).endsWith(suffix));
      const scene = raw ? parse(raw, teams) : null;
      expect(scene, `${name}: recorded play parses`).not.toBeNull();
      const script = FootballScript.play(scene!);
      const clip = new GridClip(script, scene, null, scene!.offense ?? "top");
      expect(clip.length, "the clip is as long as its script, at its pace").toBe(script.duration);
      expect(clip.still).toBe(script.leadIn);
      for (let t = 0; t <= script.duration; t += 0.1) expect(clip.local(t), "the script's clock is the clip's").toBe(t);

      const placement = new ClipPlacement(clip, 100, 100, clip.figures.map((_, i) => i));
      const plan = new Plan<GridClip>(1, 100, 100 + clip.length, null, [placement], new Map());
      // Only the free-ball painter is under test here.
      const baked = new BakedPlan(plan, [], new Float32Array(0), new Float32Array(0), [], [], []);
      const chain = new PlanChain<GridClip>();
      chain.splice(baked, 100);
      const scratch = new FrameScratch();
      scratch.plan = 0;
      scratch.placement = 0;
      scratch.ballKind = "clip";
      scratch.ballPlacement = 0;
      let maximumError = 0;
      let compared = 0;
      for (const flight of script.flights) {
        for (const fraction of [0.2, 0.5, 0.8]) {
          const t = flight.start + (flight.end - flight.start) * fraction;
          const expected = script.ball(t);
          if (script.carrier(t) != null || script.flight(t) == null || !expected) continue;
          scratch.p = placement.offset + t;
          Object.assign(scratch.camera, clip.camera(t));
          const drawn = gridFrame(chain, scratch, { width: 540, height: 270 });
          const ball = drawn?.world.ball;
          expect(ball?.kind, `${name}: a flight stays in the air at fraction ${fraction}`).toBe("free");
          if (ball?.kind !== "free") continue;
          maximumError = Math.max(maximumError, Math.hypot(ball.at.x - expected.x, ball.at.y - expected.y) + Math.abs(ball.at.z - expected.z));
          compared += 1;
          expect(ball.flying, `${name}: the flight reads as one`).toBe(true);
        }
      }
      expect(script.flights.length === 0 || (compared > 0 && maximumError < 1e-6), `every flight sample is the script's ball at the script's time: samples ${compared}, error ${maximumError}`).toBe(true);

      // Every ball contact where the script has it, credited tackles too.
      let contactError = 0;
      script.players.forEach((player, i) => {
        const path = clip.paths[i];
        if (!path) return;
        for (const action of player.actions) {
          if (!(BALL_KINDS.has(action.kind) || (script.credits.has(i) && (action.kind === "tackle" || action.kind === "strip")))) continue;
          const was = player.position(action.at);
          const now = path.position(action.at);
          contactError = Math.max(contactError, Math.hypot(was.x - now.x, was.y - now.y));
        }
      });
      expect(contactError, `every contact is exactly where it was: off by ${contactError}`).toBeLessThan(1e-6);

      // Nobody outruns his legs: the far men at the reset end short instead of gliding home.
      let fastest = 0;
      clip.paths.forEach((path, i) => {
        if (!path) return;
        const p = script.players[i]!;
        const sprint = MotionLimits.football.band(p.team === "official" || p.team === "staff" ? "official" : p.role === "line" || p.role === "front" ? "line" : "skill").sprint;
        for (let u = 0; u <= script.duration; u += 1 / 120) {
          const v = path.velocity(u);
          fastest = Math.max(fastest, Math.hypot(v.x, v.y) / sprint);
        }
      });
      if (process.env.THEATER_BENCH) console.log(`${name}: flight samples ${compared}, error ${maximumError.toExponential(1)}; contacts off by ${contactError.toExponential(1)}; fastest ${fastest.toFixed(3)}× the sprint`);
      // A ratchet, not the gate (+12%): a contact too far for his legs still wins.
      expect(fastest, `nobody runs far past his sprint: worst ${fastest}`).toBeLessThanOrEqual(1.5);
    });
  }

  it("the field between snaps keeps its own clock too", () => {
    // FootballIdle(phase: .between, offense: .top, yard: 41, gain: 45), the rest as the Swift struct's defaults.
    const idle: FootballIdle = {
      phase: { kind: "between" },
      offense: "top",
      yard: 41,
      gain: 45,
      hash: "middle",
      formation: "base",
      shotgun: true,
      strong: "right",
      front: null,
      yaw: Gridiron.yaw,
      bench: 1,
      seed: 0n,
      settled: false,
    };
    const clip = new GridClip(idleScript(idle), null, idle, "top");
    expect(clip.length).toBe(Infinity);
    expect(clip.still).toBe(0);
  });
});
