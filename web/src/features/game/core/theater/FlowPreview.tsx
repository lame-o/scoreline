/**
 * Development only: the play flow on the isometric views at the Mac contact
 * sheet's moments (the wave 25 play-flow harness, `sheet.png`), for
 * comparing the two side by side: each sport's hand-off from the field
 * between plays mid-blend (and its far start's crossfade), the officials'
 * beats, the zebra close up, and the football action before and after its
 * 1.3× pace. Each cell is drawn straight through the theaters' own frames
 * (the hand-off as the stage blends it) on the Mac harness's kits, scenes
 * and times, frozen, in the 312 × 156 compact well, and is a `[data-shot]`
 * panel named as the Mac harness names its render. Only the cells in the
 * page's appearance are drawn. Fixtures load lazily from test/fixtures, so
 * nothing here ships.
 *
 *     /dev/theater/flow               every cell in this appearance
 *     /dev/theater/flow?only=bridge   the cells whose name starts so
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import type { JSONValue } from "../../../../data/json";
import type { FootballTeams as LaneTeams } from "../../../../data/liveFeeds/football";
import type { PlayBeat } from "../../../../data/mlb/playBeat";
import { beatScript as pitchScript, idleScript as routineScript } from "../../../../data/mlb/playBeatScript";
import type { Rest } from "../../../../data/mlb/playScript";
import type { PlayScript } from "../../../../data/mlb/playScript";
import { dress, theaterTeams, type TheaterKits } from "../../../../data/mlb/theaterTeams";
import type { Point } from "../../../../data/mlb/theaterField";
import type { Side } from "../../../../data/models";
import { NEUTRAL, teamPalette, type Scheme } from "../../../../data/teamColors";
import { beatScript, BeatBuilder, endsRight, restOf, restScript, type HoopsEnds } from "../../../../data/theater/basketballBeats";
import { made, parseScene, replays, type BasketballScene } from "../../../../data/theater/basketballScene";
import { BasketballScript, Hoops } from "../../../../data/theater/basketballScript";
import { basketballBridge } from "../../../../data/theater/basketballTheater";
import { FieldFacing, footballIdle, FootballStatus, idleScript, type FootballIdle, type StatusNames } from "../../../../data/theater/footballIdle";
import { FootballDepthChart, parse as parseFootball, type FootballScene } from "../../../../data/theater/footballScene";
import { FootballScript } from "../../../../data/theater/footballScript";
import { footballBridge } from "../../../../data/theater/footballTheater";
import { PitchFacing, soccerIdle, soccerIdleScript, SoccerStatus, turnedScene, type SoccerEvent, type SoccerEventKind, type SoccerIdle, type SoccerNames } from "../../../../data/theater/soccerIdle";
import { isMoment, keepers, parse as parseSoccer, Pitch, SoccerLineup, type Lineups, type SoccerScene } from "../../../../data/theater/soccerScene";
import { SoccerScript } from "../../../../data/theater/soccerScript";
import { soccerBridge } from "../../../../data/theater/soccerTheater";
import { beatLeft, bridgeTracks, type BridgePlan } from "../../../../data/theater/theaterBridge";
import { useColorScheme } from "../../../../state/theme";
import { drawFrame as drawPlay, drawField, layoutLabels as playLabels } from "../../mlb/theater/drawTheater";
import { theaterInk } from "../../mlb/theater/theaterInk";
import { basketballProjection, basketballSpots, drawBasketballFrame, drawCourt, layoutLabels as courtLabels, type BasketballBridge } from "../../nba/theater/drawBasketball";
import { drawFootballFrame, drawGridiron, footballProjection, footballSpots, layoutLabels as fieldLabels, type FootballBridge } from "../../football/theater/drawFootball";
import { drawPitch, drawSoccerFrame, layoutLabels as pitchLabels, soccerProjection, type SoccerBridge } from "../../soccer/theater/drawSoccer";
import { CameraFrame } from "../../../../data/mlb/playCamera";
import { FieldProjection } from "./fieldProjection";
import { drawLayers } from "./layers";
import { TheaterStatusTag } from "./TheaterStatus";
import styles from "./TheaterWell.module.css";

type Ctx = CanvasRenderingContext2D;
type Size = { readonly width: number; readonly height: number };
const COMPACT: Size = { width: 312, height: 156 };

const files = import.meta.glob<{ default: unknown }>("../../../../../test/fixtures/{nfl-turnovers-plays,nfl-depthcharts,nfl-stoppages-plays,nba-every-play-401909890,soccer-theater-plays}.json");

async function load(name: string): Promise<unknown> {
  const f = files[`../../../../../test/fixtures/${name}.json`];
  if (!f) throw new Error(`No fixture ${name}`);
  return (await f()).default;
}

/** A tag over a cell: its words, its color, and how much of it shows (a crossfade has both). */
interface Tag {
  readonly tag: string | null;
  readonly tint: string | null;
  readonly opacity?: number;
}

/** One cell: its name (the Mac render's), its appearance, its size, what's drawn, and the tags over it. */
interface Cell {
  readonly name: string;
  readonly scheme: Scheme;
  readonly size?: Size;
  readonly draw: (ctx: Ctx, scheme: Scheme) => void;
  readonly tags?: readonly Tag[];
}

/** A frame as the Mac harness composes it: what's drawn, and its tag. */
interface Frame {
  readonly draw: (ctx: Ctx) => void;
  readonly tag: Tag;
}

/** A hand-off as the Mac harness runs it: the plan, and the frame `s` seconds after the play came in. */
interface Handoff {
  readonly plan: BridgePlan;
  readonly frame: (s: number, scheme: Scheme) => Frame;
}

/** A crossfade: the two frames each partly there. */
function crossfade(replay: Frame, idle: Frame, w: number): Frame {
  return {
    draw: (ctx) =>
      drawLayers(ctx, [
        [w, replay.draw],
        [1 - w, idle.draw],
      ]),
    tag: replay.tag,
  };
}

/** A team's color as the theaters paint it (TheaterTeams.solid): its own, or a gray for one with none. */
const solid = (color: string, scheme: Scheme) => (color === NEUTRAL || !color.startsWith("#") ? (scheme === "dark" ? "#b8b8b8" : "#808080") : color);

// MARK: - Football: KC at SEA

const KC_KITS: TheaterKits = { top: { color: "e31837", alternate: "ffb612" }, bottom: { color: "002a5c", alternate: "69be28" } };
const KC_NAMES: StatusNames = { top: "Chiefs", bottom: "Seahawks", topColor: "e31837", bottomColor: "002a5c" };

function kcTeams(offense: Side, scheme: Scheme) {
  const d = dress(KC_KITS, scheme);
  return offense === "top" ? { offense: d.top, defense: d.bottom } : { offense: d.bottom, defense: d.top };
}

function kcZones(offense: Side, scheme: Scheme) {
  const palette = teamPalette("e31837", "002a5c", scheme);
  const top = { color: solid(palette.top, scheme), name: "CHIEFS" };
  const bottom = { color: solid(palette.bottom, scheme), name: "SEAHAWKS" };
  return offense === "top" ? { near: top, far: bottom } : { near: bottom, far: top };
}

function kcFrame(scene: FootballScene | null, script: FootballScript, t: number, offense: Side, scheme: Scheme, bridge: FootballBridge | null = null, tagged = true): Frame {
  const status = scene ? FootballStatus.replay(scene, script, t, KC_NAMES) : { tag: "Chiefs ball · 1st & 10", tint: "e31837" };
  return {
    draw: (ctx) => {
      const ink = theaterInk(scheme);
      const teams = kcTeams(offense, scheme);
      const zones = kcZones(offense, scheme);
      const f = footballProjection(COMPACT, script, t, bridge);
      drawGridiron(ctx, f, ink, zones.near, zones.far);
      drawFootballFrame(ctx, f, { script, t, teams, ink, labels: fieldLabels(ctx, scene, script, teams, ink, COMPACT, 1), bridge });
    },
    tag: tagged ? status : { tag: null, tint: null },
  };
}

function kcHandoff(scene: FootballScene, idle: FootballIdle, t0: number): Handoff {
  const replay = FootballScript.play(scene, FieldFacing.yaw(scene.offense, scene.period, false));
  const s0 = idleScript(idle);
  const offense = scene.offense ?? "top";
  const plan = footballBridge(s0, idle.offense, t0, replay, offense, false, beatLeft(s0.beats, t0));
  const tracks = bridgeTracks(
    plan,
    8.5,
    (j, s) => ({ at: s0.players[j]!.position(s0.idleTime(t0 + s)), heading: s0.rig[j]!.motion(s0.idleTime(t0 + s)).heading }),
    (i, s) => ({ at: replay.players[i]!.position(plan.replayTime(s)), heading: replay.rig[i]!.motion(plan.replayTime(s)).heading }),
  );
  return {
    plan,
    frame: (s, scheme) => {
      const idleT = s0.idleTime(t0 + s);
      if (s < 0) return kcFrame(null, s0, idleT, idle.offense, scheme);
      const t = plan.replayTime(s);
      const w = plan.weight(s);
      if (!(s < plan.end)) return kcFrame(scene, replay, t, offense, scheme);
      if (plan.mode === "bridge") return kcFrame(scene, replay, t, offense, scheme, { script: s0, t: idleT, w, s, pairs: plan.pairs, tracks });
      return crossfade(kcFrame(scene, replay, t, offense, scheme), kcFrame(null, s0, idleT, idle.offense, scheme), w);
    },
  };
}

// MARK: - Basketball: SA at UTAH

const SA_KITS: TheaterKits = { top: { color: "000000", alternate: "c4ced4" }, bottom: { color: "4e008e", alternate: "79a3dc" } };
const SA_ENDS: HoopsEnds = { topRight: true, topOpensRight: true };

function saFrame(scene: BasketballScene | null, script: BasketballScript, t: number, scheme: Scheme, bridge: BasketballBridge | null = null, tag: string | null = null, tagged = true): Frame {
  const side = script.side ?? "top";
  return {
    draw: (ctx) => {
      const ink = theaterInk(scheme);
      const d = dress(SA_KITS, scheme);
      const teams = side === "top" ? { offense: d.top, defense: d.bottom } : { offense: d.bottom, defense: d.top };
      const paint = { color: solid(teamPalette("000000", "4e008e", scheme).bottom, scheme), name: "JAZZ", three: Hoops.three };
      const h = basketballProjection(COMPACT, script, t, bridge);
      drawCourt(ctx, h, ink, paint);
      drawBasketballFrame(ctx, h, { script, t, teams, ink, labels: courtLabels(ctx, scene, script, teams, ink, COMPACT, 1), bridge });
    },
    tag: tagged ? { tag: tag ?? (side === "top" ? "Spurs ball" : "Jazz ball"), tint: side === "top" ? "000000" : "4e008e" } : { tag: null, tint: null },
  };
}

function saHandoff(scene: BasketballScene, rest: BasketballScript, t0: number): Handoff {
  const replay = BasketballScript.play(scene, endsRight(SA_ENDS, scene.offense));
  const plan = basketballBridge(rest, t0, replay, false, beatLeft(rest.active, t0));
  const tracks = bridgeTracks(
    plan,
    Hoops.ground,
    (j, s) => ({ at: rest.players[j]!.position(t0 + s), heading: rest.rig[j]!.motion(t0 + s).heading }),
    (i, s) => {
      const u = Math.max(plan.replayTime(s), 0);
      return { at: replay.players[i]!.position(u), heading: replay.rig[i]!.motion(u).heading };
    },
  );
  return {
    plan,
    frame: (s, scheme) => {
      if (s < 0) return saFrame(null, rest, t0 + s, scheme);
      const t = Math.max(plan.replayTime(s), 0);
      const w = plan.weight(s);
      if (!(s < plan.end)) return saFrame(scene, replay, t, scheme);
      if (plan.mode === "bridge") return saFrame(scene, replay, t, scheme, { script: rest, t: t0 + s, w, s, pairs: plan.pairs, tracks });
      return crossfade(saFrame(scene, replay, t, scheme), saFrame(null, rest, t0 + s, scheme), w);
    },
  };
}

// MARK: - Soccer: Aston Villa v Man City

const AV_KITS: TheaterKits = { top: { color: "660e36", alternate: "000000" }, bottom: { color: "99c5ea", alternate: "000000" } };
const AV_NAMES: SoccerNames = { top: "Aston Villa", bottom: "Man City", topColor: "660e36", bottomColor: "99c5ea" };

function avTeams(side: Side, scheme: Scheme) {
  const d = dress(AV_KITS, scheme);
  return side === "top" ? { attacking: d.top, defending: d.bottom } : { attacking: d.bottom, defending: d.top };
}

function avFrame(scene: SoccerScene | null, script: SoccerScript, t: number, side: Side, scheme: Scheme, bridge: SoccerBridge | null = null, status: Tag | null = null): Frame {
  const tag = status ?? (scene ? SoccerStatus.replay(scene, AV_NAMES) : SoccerStatus.ball(side, AV_NAMES));
  return {
    draw: (ctx) => {
      const ink = theaterInk(scheme);
      const teams = avTeams(side, scheme);
      const f = soccerProjection(COMPACT, script, t, bridge);
      drawPitch(ctx, f, ink);
      drawSoccerFrame(ctx, f, { scene, script, t, teams, ink, labels: pitchLabels(ctx, scene, script, teams, ink, COMPACT, 1), bridge });
    },
    tag: { tag: tag.tag, tint: tag.tint },
  };
}

function avHandoff(scene: SoccerScene, idle: SoccerIdle, t0: number, lineups: Lineups): Handoff {
  const drawn = PitchFacing.homeAttacksRight(scene.period, false) ? scene : turnedScene(scene);
  const replay = SoccerScript.build(drawn, lineups);
  const s0 = soccerIdleScript(idle);
  const plan = soccerBridge(s0, idle.possession, t0, replay, drawn.side, false, beatLeft(s0.beats, t0));
  const tracks = bridgeTracks(
    plan,
    2.5,
    (j, s) => ({ at: s0.actors[j]!.position(s0.idleTime(t0 + s)), heading: s0.rig[j]!.motion(s0.idleTime(t0 + s)).heading }),
    (i, s) => ({ at: replay.actors[i]!.position(plan.replayTime(s)), heading: replay.rig[i]!.motion(plan.replayTime(s)).heading }),
  );
  return {
    plan,
    frame: (s, scheme) => {
      const idleT = s0.idleTime(t0 + s);
      if (s < 0) return avFrame(null, s0, idleT, idle.possession, scheme);
      const t = plan.replayTime(s);
      const w = plan.weight(s);
      if (!(s < plan.end)) return avFrame(drawn, replay, t, drawn.side, scheme);
      if (plan.mode === "bridge") return avFrame(drawn, replay, t, drawn.side, scheme, { script: s0, t: idleT, w, s, pairs: plan.pairs, tracks, teams: avTeams(idle.possession, scheme) });
      return crossfade(avFrame(drawn, replay, t, drawn.side, scheme), avFrame(null, s0, idleT, idle.possession, scheme), w);
    },
  };
}

/** An event for the pitch between moments (SoccerEvent's defaults: no minute, no clock). */
function soccerEvent(id: string, kind: SoccerEventKind, side: Side, player: string, extra: Partial<SoccerEvent> = {}): SoccerEvent {
  return { id, kind, side, player, athlete: null, other: null, otherAthlete: null, at: null, penalty: false, minute: "", clock: 0, period: null, text: "", wallclock: null, order: 0, ...extra };
}

// MARK: - Baseball

const MLB_KITS: TheaterKits = { top: { color: "092c5c", alternate: "8fbce6" }, bottom: { color: "13294b", alternate: "ffc72c" } };
const MLB_REST: Rest = { bases: [true, false, false], bats: "R", swapped: false, fieldingHome: false };

function mlbFrame(script: PlayScript, t: number, scheme: Scheme, batting: Side = "top", bridge: { script: PlayScript; t: number; w: number; s: number; pairs: ReadonlyMap<number, number>; tracks: ReturnType<typeof bridgeTracks> } | null = null): Frame {
  return {
    draw: (ctx) => {
      const ink = theaterInk(scheme);
      const teams = theaterTeams(MLB_KITS, scheme, batting);
      const camera = script.camera.frame(t);
      const f = new FieldProjection(COMPACT, bridge ? CameraFrame.mix(bridge.script.camera.frame(bridge.t), camera, bridge.w) : camera);
      drawField(ctx, f, ink);
      drawPlay(ctx, f, { scene: null, script, t, teams, ink, labels: playLabels(ctx, { scene: null, script, teams, ink, size: COMPACT, pt: 1, statcast: null }), footer: 0, bridge });
    },
    tag: { tag: "TOP 3RD · 1-0 · 1 OUT", tint: "092c5c" },
  };
}

function mlbHandoff(next: PlayScript, field: PlayScript, t0: number, together: boolean, nextBatting: Side = "top"): Handoff {
  const plan = field.bridge(t0, next, together, false, field.duration - t0);
  const idleT = (s: number) => Math.min(t0 + s, field.duration);
  const tracks = bridgeTracks(
    plan,
    8.5,
    (j, s) => ({ at: field.actors[j]!.position(idleT(s)), heading: field.rig[j]!.motion(idleT(s)).heading }),
    (i, s) => ({ at: next.actors[i]!.position(plan.replayTime(s)), heading: next.rig[i]!.motion(plan.replayTime(s)).heading }),
  );
  return {
    plan,
    frame: (s, scheme) => {
      if (s < 0) return mlbFrame(field, idleT(s), scheme);
      const t = plan.replayTime(s);
      const w = plan.weight(s);
      if (!(s < plan.end)) return mlbFrame(next, t, scheme, nextBatting);
      if (plan.mode === "bridge") return mlbFrame(next, t, scheme, nextBatting, { script: field, t: idleT(s), w, s, pairs: plan.pairs, tracks });
      const main = mlbFrame(next, t, scheme, nextBatting);
      return crossfade(main, { draw: mlbFrame(field, idleT(s), scheme).draw, tag: main.tag }, w);
    },
  };
}

const pitch = (id: string, call: "ball" | "calledStrike", number: number): PlayBeat => ({
  id,
  kind: { kind: "pitch", pitch: { call, number, balls: 1, strikes: 0, code: null, mph: null, x: null, y: null, flight: null, review: null } },
  bats: null,
  arm: null,
  inning: null,
  top: null,
  balls: 1,
  strikes: 0,
  outs: 0,
  wallclock: null,
  bases: null,
  news: true,
});

// MARK: - The cells

const range = (from: number, to: number, step: number) => {
  const out: number[] = [];
  for (let t = from; t <= to + 1e-9; t += step) out.push(t);
  return out;
};
const SCHEMES: readonly Scheme[] = ["dark", "light"];

async function cells(): Promise<Cell[]> {
  const [turnovers, charts, stoppages, nba, soccer] = await Promise.all(["nfl-turnovers-plays", "nfl-depthcharts", "nfl-stoppages-plays", "nba-every-play-401909890", "soccer-theater-plays"].map(load));
  const out: Cell[] = [];
  const add = (name: string, frame: Frame | ((scheme: Scheme) => Frame), scheme: Scheme, size: Size = COMPACT) => {
    const f = typeof frame === "function" ? frame(scheme) : frame;
    out.push({ name: `${name}-${scheme}`, scheme, size, draw: f.draw, tags: [f.tag] });
  };
  const mid = (h: Handoff, name: string, schemes: readonly Scheme[]) => {
    const p = h.plan;
    for (const scheme of schemes) for (const f of p.mode === "bridge" ? [25, 50, 75] : [40, 75]) add(`${name}-${f}`, h.frame(p.wait + (p.length * f) / 100, scheme), scheme);
  };

  // Football: KC at SEA, on their depth charts.
  const game = (turnovers as { games: { items: Record<string, unknown>[] }[] }).games[0]!;
  const laneTeams: LaneTeams = { topIsHome: false, topID: "12", bottomID: "26", homeAbbreviation: "SEA", awayAbbreviation: "KC", homeName: "Seahawks", awayName: "Chiefs" };
  const c = (charts as { teams: Record<string, unknown> }).teams;
  const depth = { top: FootballDepthChart.from(c["12"])!, bottom: FootballDepthChart.from(c["26"])! };
  const kc = (text: string) => parseFootball(game.items.find((i) => String(i.text ?? "").includes(text))!, laneTeams)!.slotted(depth);

  // 1. The bridge, every sport, mid-blend; each far start's crossfade.
  const pass = kc("pass short middle to E.Johnson");
  const offense = pass.offense ?? "top";
  const lining = footballIdle({ play: null, stoppage: null, rest: { yard: pass.from, gain: pass.gainBefore }, offense, down: pass.before, kickoff: false, flipped: false });
  const fbT0 = range(7.6, 10.0, 0.2).find((t) => kcHandoff(pass, lining, t).plan.mode === "bridge" && idleScript(lining).moving(t)) ?? 8.4;
  mid(kcHandoff(pass, lining, fbT0), "bridge-football", SCHEMES);
  const walked = footballIdle({ play: null, stoppage: null, rest: { yard: pass.from + 6, gain: null }, offense, down: null, kickoff: false, flipped: false });
  mid(kcHandoff(pass, walked, 15.5), "far-football", ["light"]);

  const items = (nba as { games: { items: JSONValue[] }[] }).games[0]!.items;
  const saTeams = { topIsHome: false, topID: "24", bottomID: "26", topName: "SA", bottomName: "UTAH" };
  const saFirst = (match: (s: BasketballScene) => boolean): BasketballScene | null => {
    for (let i = 0; i < items.length; i++) {
      const s = parseScene(items, i, saTeams);
      if (s && match(s)) return s;
    }
    return null;
  };
  const three = saFirst((s) => replays(s) && s.kind === "three" && s.offense === "top") ?? parseScene(items, items.findIndex((i) => (i as { id?: string }).id === "40190989026"), saTeams)!;
  const rest = restScript(restOf({ offense: three.offense, ends: SA_ENDS, phase: "live", seed: "harness" }));
  const window = rest.active.length > 1 ? rest.active[1]! : (rest.active[0] ?? ([0, 1] as const));
  const bkT0 = range(window[0] + 0.2, window[1] - 0.2, 0.2).find((t) => saHandoff(three, rest, t).plan.mode === "bridge") ?? (window[0] + window[1]) / 2;
  mid(saHandoff(three, rest, bkT0), "bridge-basketball", SCHEMES);
  const other = restScript(restOf({ offense: three.offense === "top" ? "bottom" : "top", ends: SA_ENDS, phase: "live", seed: "harness" }));
  mid(saHandoff(three, other, 6), "far-basketball", ["dark"]);

  const match = (soccer as { matches: { home: { id: string }; rosters: JSONValue; clips: JSONValue[][] }[] }).matches[0]!;
  const home = match.home.id;
  const lineups = SoccerLineup.lineups(match.rosters, (team) => (team === home ? "top" : "bottom"));
  const avIdle = (event: SoccerEvent | null, touch: { side: Side; at: Point; period: number | null } | null, period: number | null = 2) =>
    soccerIdle({ event, touch: touch ? { ...touch, order: 0, clock: 0 } : null, scene: null, period, lineups, flipped: false });
  let chosen: [SoccerScene, SoccerIdle, number] | null = null;
  search: for (const clip of match.clips) {
    for (let i = 0; i < clip.length; i++) {
      if (!isMoment(clip[i]!)) continue;
      const scene = parseSoccer(clip, i, home, keepers(clip));
      if (!scene || scene.shot.penalty || scene.touches.length < 2) continue;
      const start = scene.touches[0]?.at ?? scene.shot.from;
      const idle = avIdle(null, { side: scene.side, at: start, period: scene.period ?? null }, scene.period ?? null);
      const s0 = soccerIdleScript(idle);
      for (const t of range(1, 14, 0.25)) {
        if (s0.moving(t) && avHandoff(scene, idle, t, lineups).plan.mode === "bridge") {
          chosen = [scene, idle, t];
          break search;
        }
      }
    }
  }
  if (chosen) {
    const [scene, idle, t0] = chosen;
    mid(avHandoff(scene, idle, t0, lineups), "bridge-soccer", SCHEMES);
    const start = scene.touches[0]?.at ?? scene.shot.from;
    mid(avHandoff(scene, avIdle(null, { side: scene.side, at: { x: Pitch.length - start.x, y: start.y }, period: scene.period ?? null }, scene.period ?? null), 3, lineups), "far-soccer", ["light"]);
  }

  const lead = routineScript("lead", MLB_REST, 3n, "R");
  mid(mlbHandoff(pitchScript(pitch("p1", "calledStrike", 2), MLB_REST), lead, lead.duration * 0.45, true), "bridge-baseball", SCHEMES);
  const catcher = routineScript("catcher", MLB_REST, 5n, "R");
  const otherHalf: Rest = { bases: [false, false, false], bats: "L", swapped: false, fieldingHome: true };
  mid(mlbHandoff(pitchScript(pitch("p2", "ball", 1), otherHalf), catcher, catcher.duration * 0.5, false, "bottom"), "far-baseball", ["dark"]);

  // 2. Officials.
  const hold = kc("K.Walker left tackle to SEA 39 for 6 yards");
  const held = FootballScript.play(hold, FieldFacing.yaw(hold.offense, hold.period, false));
  const flag = held.flags[0];
  if (flag) {
    [flag.thrown - 1.0, flag.thrown - 0.25, flag.thrown + 0.05, flag.lands + 0.25, flag.lands + 1.2].forEach((t, k) => {
      for (const scheme of SCHEMES) add(`flag-${k + 1}`, kcFrame(hold, held, t, hold.offense ?? "top", scheme), scheme);
    });
  }
  const huddle = idleScript(lining);
  add("idle-huddle", kcFrame(null, huddle, 3, offense, "dark"), "dark");
  add("idle-lined", kcFrame(null, huddle, (huddle.loop?.start ?? 12) + 2, offense, "light"), "light");
  type Game = { items: Record<string, unknown>[]; home: { id: string; abbreviation: string; name?: string }; away: { id: string; abbreviation: string; name?: string } };
  for (const g of (stoppages as { games: Game[] }).games) {
    const item = g.items.find((i) => String(i.text ?? "").includes("Atlanta challenged"));
    const review = item ? parseFootball(item, { topIsHome: false, topID: g.away.id, bottomID: g.home.id, homeAbbreviation: g.home.abbreviation, awayAbbreviation: g.away.abbreviation, homeName: g.home.name ?? "", awayName: g.away.name ?? "" }) : null;
    if (!review) continue;
    const idle = footballIdle({ play: review, stoppage: null, rest: { yard: review.to, gain: null }, offense: review.offense ?? "top", down: null, kickoff: false, flipped: false });
    const s = idleScript(idle);
    add("idle-challenge", kcFrame(null, s, 1.3, idle.offense, "dark"), "dark");
    add("idle-review", kcFrame(null, s, 10, idle.offense, "light"), "light");
    break;
  }
  const shooting = saFirst((s) => s.kind === "foul" && s.call?.kind === "shooting");
  if (shooting) {
    const beat = beatScript(shooting, [], SA_ENDS, null, shooting.offense);
    const w = beat.flashes.find((f) => f.beat === "whistle")?.at;
    if (w != null) [w - 0.8, w + 0.25, w + BeatBuilder.signalled + 0.5].forEach((t, k) => add(`whistle-${k + 1}`, saFrame(shooting, beat, t, "dark", null, beat.tag?.text ?? null), "dark"));
    const lane = restScript(restOf({ offense: shooting.offense, ends: SA_ENDS, phase: "lane", seed: "lane" }));
    const toss = lane.flights[0]?.start;
    if (toss != null) [toss - 0.2, toss + 1.4].forEach((t, k) => add(`lane-${k + 1}`, saFrame(null, lane, t, "dark"), "dark"));
  }
  const tip = saFirst((s) => s.kind === "jumpBall");
  if (tip) {
    const beat = beatScript(tip, [], SA_ENDS, null, tip.offense);
    [0.62, 2.2].forEach((t, k) => add(`tip-${k + 1}`, saFrame(tip, beat, t, "light", null, beat.tag?.text ?? null), "light"));
  }
  add("court-rest", saFrame(null, rest, bkT0, "light"), "light");
  const ft = saFirst((s) => s.kind === "freeThrow" && (s.attempt ?? 1) < (s.attempts ?? 1) && made(s));
  if (ft) {
    const beat = beatScript(ft, [], SA_ENDS, null, ft.offense);
    [1.0, beat.duration - 0.4].forEach((t, k) => add(`ft-${k + 1}`, saFrame(ft, beat, t, "light", null, beat.tag?.text ?? null), "light"));
  }
  const card = soccerIdleScript(avIdle(soccerEvent("x-card", { type: "card", red: false, second: false }, "bottom", "Rúben Dias", { athlete: "234878" }), null));
  [0.15, 3.0, 7.2].forEach((t, k) => {
    const scheme: Scheme = t === 3 ? "dark" : "light";
    add(`booking-${k + 1}`, avFrame(null, card, t, "top", scheme, null, { tag: "Yellow card · Dias", tint: "FFD61A" }), scheme);
  });
  const flagged = soccerIdleScript(avIdle(soccerEvent("x-off", { type: "offside" }, "top", "Ollie Watkins", { at: { x: 80, y: 30 } }), null));
  add("offside", avFrame(null, flagged, 2.5, "bottom", "dark", null, { tag: "Offside · Watkins", tint: null }), "dark");
  const board = soccerIdleScript(avIdle(soccerEvent("x-sub", { type: "substitution" }, "top", "Jadon Sancho", { other: "Morgan Rogers" }), null));
  add("substitution", avFrame(null, board, 3, "top", "light", null, { tag: "Sancho on · Rogers off", tint: null }), "light");
  const freeKick = soccerIdleScript(avIdle(soccerEvent("x-foul", { type: "foul" }, "bottom", "Rodri", { other: "John McGinn", at: { x: 62, y: 40 } }), null));
  add("foul", avFrame(null, freeKick, 2, "top", "dark", null, { tag: "Foul · Rodri", tint: null }), "dark");

  // The zebra, close up (6×, 30 pt square round each official), as the Mac harness crops it.
  const zebraCell = (name: string, frame: (scheme: Scheme) => Frame, center: Point, scheme: Scheme) => {
    const x = Math.min(Math.max(center.x - 15, 0), COMPACT.width - 30);
    const y = Math.min(Math.max(center.y - 15, 0), COMPACT.height - 30);
    const f = frame(scheme);
    out.push({
      name: `${name}-${scheme}`,
      scheme,
      size: { width: 180, height: 180 },
      draw: (ctx) => {
        ctx.scale(6, 6);
        ctx.translate(-x, -y);
        f.draw(ctx);
      },
    });
  };
  const thrower = FootballScript.play(hold);
  const thrown = thrower.flags[0];
  const official = thrower.players.findIndex((p) => p.team === "official");
  if (thrown && official >= 0) {
    const t = thrown.thrown - 0.12;
    const spot = footballSpots(thrower, t, COMPACT).figures.find((s) => s.index === official);
    const center = spot ? { x: spot.ground.x, y: spot.ground.y - spot.height * 0.5 } : { x: 156, y: 78 };
    for (const scheme of SCHEMES) zebraCell("zebra-football", (sch) => kcFrame(hold, thrower, t, hold.offense ?? "top", sch, null, false), center, scheme);
  }
  if (shooting) {
    const beat = beatScript(shooting, [], SA_ENDS, null, shooting.offense);
    const w = beat.flashes.find((f) => f.beat === "whistle")?.at;
    const ref = beat.players.findIndex((p) => p.team === "official");
    if (w != null && ref >= 0) {
      const spot = basketballSpots(beat, w + 0.25, COMPACT).figures.find((s) => s.index === ref);
      const center = spot ? { x: spot.ground.x, y: spot.ground.y - spot.height * 0.5 } : { x: 156, y: 78 };
      for (const scheme of SCHEMES) zebraCell("zebra-basketball", (sch) => saFrame(shooting, beat, w + 0.25, sch, null, null, false), center, scheme);
    }
  }

  // 3. The football action, before and after 1.3×.
  for (const [scene, label, scheme] of [
    [pass, "pass", "dark"],
    [kc("K.Walker up the middle to SEA 47"), "run", "light"],
  ] as const) {
    const o = scene.offense ?? "top";
    const yaw = FieldFacing.yaw(scene.offense, scene.period, false);
    const before = FootballScript.play(scene, yaw, 1);
    const after = FootballScript.play(scene, yaw);
    range(0.5, 0.5 + 0.45 * 6, 0.45).forEach((t, k) => {
      add(`timing-${label}-before-${k + 1}`, kcFrame(scene, before, t, o, scheme), scheme);
      add(`timing-${label}-after-${k + 1}`, kcFrame(scene, after, t, o, scheme), scheme);
    });
  }
  return out;
}

export function FlowPreview() {
  const [params] = useSearchParams();
  const only = params.get("only") ?? "";
  const scheme = useColorScheme();
  const [all, setAll] = useState<Cell[] | null>(null);
  useEffect(() => {
    let live = true;
    void cells().then((c) => {
      if (live) setAll(c);
    });
    return () => {
      live = false;
    };
  }, []);
  if (!all) return <p>Loading…</p>;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, padding: 16 }}>
      {all
        .filter((c) => c.scheme === scheme && c.name.startsWith(only))
        .map((c) => (
          <Panel key={c.name} cell={c} />
        ))}
    </div>
  );
}

function Panel({ cell }: { cell: Cell }): ReactNode {
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = cell.size ?? COMPACT;
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.round(size.width * dpr);
    el.height = Math.round(size.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cell.draw(ctx, cell.scheme);
  }, [cell, size.width, size.height]);
  return (
    <div data-shot={cell.name} className={styles.well} style={{ width: size.width, height: size.height, aspectRatio: "auto", flex: "none" }}>
      <canvas ref={canvas} className={styles.canvas} />
      {(cell.tags ?? []).map((t, k) => (
        <div key={k} style={{ opacity: t.opacity ?? 1 }}>
          <TheaterStatusTag tag={t.tag} tint={t.tint} height={size.height} />
        </div>
      ))}
    </div>
  );
}
