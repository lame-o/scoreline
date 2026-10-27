/**
 * The play theater's model (PlayScene.swift): one play on the field (a plate
 * appearance's result, or a runner's play between pitches), parsed from
 * ESPN's play-by-play into what the theater replays: the kind of play and
 * the ball's flight, who handled it in scorer's numbers (6-4-3), where every
 * runner went, the outs and runs, the pitch and the batter's side. Pure
 * values: the parser is tested against real plays, and the replay is a
 * function of the scene and time (playScript.ts).
 *
 * ESPN gives each at-bat a run of entries sharing an `atBatId`: pitches
 * (`summaryType` "P"; their participants are the runners as the pitch is
 * thrown) and a result (`play-result`; its participants are the runners
 * after it). Runners are matched by athlete ID across the two, so the
 * movements never depend on reading names; the text only settles who scored
 * and who was out when both happened on one play.
 *
 *     const state = theater(plays, (team) => (team === "8" ? "top" : "bottom"), names);
 *     state.play?.notation.code; // "6-4-3 DP"
 *
 * Web additions (not in the Swift model): `inning`, `top`, `batterID` and
 * `batterOccurrence`, so a play can find its Statcast at-bat (statcast.ts).
 */
import { arr, at, bool, has, int, num, str } from "../json";
import type { Side } from "../models";
import type { Point } from "./theaterField";

export type Hand = "L" | "R";

/** ESPN's `trajectory`, by name. */
export type Trajectory = "ground" | "line" | "fly" | "popUp";

const TRAJECTORIES: Readonly<Record<string, Trajectory>> = { G: "ground", L: "line", F: "fly", P: "popUp" };

export type SimpleKind =
  | "single"
  | "double"
  | "triple"
  | "homeRun"
  | "groundOut"
  | "flyOut"
  | "lineOut"
  | "popOut"
  | "foulOut"
  | "fieldersChoice"
  | "doublePlay"
  | "triplePlay"
  | "sacrificeFly"
  | "sacrificeBunt"
  | "error"
  | "hitByPitch"
  /** Runners only, between pitches. */
  | "stolenBase"
  | "caughtStealing"
  | "pickoff"
  | "wildPitch"
  | "passedBall"
  | "balk"
  | "indifference"
  /** A play we can't name: the ball goes to its spot, the runners to theirs. */
  | "other";

/** Swift's `PlayScene.Kind`: two cases carry a value. */
export type Kind =
  | { readonly type: SimpleKind }
  | { readonly type: "strikeout"; readonly looking: boolean }
  | { readonly type: "walk"; readonly intentional: boolean };

export const kindOf = (type: SimpleKind): Kind => ({ type });

/** The pitch that decided it. */
export interface ScenePitch {
  /** "FF". */
  readonly code: string | null;
  /** "Four-seam FB". */
  readonly name: string | null;
  readonly mph: number | null;
  /** ESPN pitch coordinates (zone ≈ x 91…141, y 148…192). */
  readonly x: number | null;
  readonly y: number | null;
}

/** Where the play took a runner (or the batter, from base 0). */
export type RunnerEnd =
  | { readonly kind: "base"; readonly base: number }
  | { readonly kind: "scored" }
  /** Out at a base (0: home), or where the ball was caught (null). */
  | { readonly kind: "out"; readonly at: number | null };

export interface Runner {
  readonly id: string | null;
  readonly from: number;
  readonly end: RunnerEnd;
}

export const isOut = (r: Runner) => r.end.kind === "out";

/** The scorer's mark for the play: "6-3", "F8", "6-4-3 DP". A called third strike is a K drawn backwards. */
export interface Notation {
  readonly code: string;
  readonly backwards: boolean;
}

export const notationText = (n: Notation) => (n.backwards ? "ꓘ" : n.code);

/** MLB pitch codes, for when ESPN sends only the abbreviation (GameDetail.swift `Pitch.names`). */
export const PITCH_NAMES: Readonly<Record<string, string>> = {
  FF: "Four-seam",
  FA: "Fastball",
  FT: "Two-seam",
  SI: "Sinker",
  FC: "Cutter",
  SL: "Slider",
  ST: "Sweeper",
  SV: "Slurve",
  CU: "Curveball",
  KC: "Knuckle curve",
  CS: "Slow curve",
  CH: "Changeup",
  FS: "Splitter",
  FO: "Forkball",
  SC: "Screwball",
  KN: "Knuckleball",
  EP: "Eephus",
  PO: "Pitchout",
  IN: "Intentional ball",
  UN: "Unknown",
};

export class PlayScene {
  readonly id: string;
  kind: Kind;
  trajectory: Trajectory | null = null;
  /** Where the ball was fielded or landed, in ESPN hit coordinates (home plate ≈ (125, 205), the fence ≈ 165 out: the spray chart's calibration). */
  spot: Point | null = null;
  /** Feet, when ESPN says ("homered to center (408 feet)"). */
  distance: number | null = null;
  /** Who handled the ball, in order, by scorer's number (6-4-3). */
  fielders: number[] = [];
  /** The fielder charged with an error. */
  error: number | null = null;
  /** Every runner on the play, the batter first (from 0). */
  runners: Runner[] = [];
  outsBefore = 0;
  outsAfter = 0;
  runs = 0;
  bats: Hand | null = null;
  pitch: ScenePitch | null = null;
  batting: Side | null = null;
  /** "Turang grounded out to shortstop." */
  text = "";
  /** Epoch ms. */
  wallclock: number | null = null;
  /** The home team went ahead in the bottom of the 9th or later: the game ends on it. */
  walkOff = false;
  // Web: the half-inning and the batter, for the Statcast match.
  inning: number | null = null;
  /** The top of the inning (the visitors batting). */
  top: boolean | null = null;
  batterID: string | null = null;
  /** How many earlier plate appearances this batter had in the same half-inning (a team batting around). */
  batterOccurrence = 0;

  constructor(id: string, kind: Kind) {
    this.id = id;
    this.kind = kind;
  }

  get batter(): Runner | null {
    return this.runners.find((r) => r.from === 0) ?? null;
  }

  /** Bases taken before the play (first, second, third). */
  get basesBefore(): [boolean, boolean, boolean] {
    const on = (base: number) => this.runners.some((r) => r.from === base);
    return [on(1), on(2), on(3)];
  }

  /** Bases taken after it. */
  get basesAfter(): [boolean, boolean, boolean] {
    const on = (base: number) => this.runners.some((r) => r.end.kind === "base" && r.end.base === base);
    return [on(1), on(2), on(3)];
  }

  /** The half-inning ended on this play: the teams change sides. */
  get endsInning(): boolean {
    return this.outsAfter >= 3;
  }

  /** A play the batter put in play: the ball leaves the bat. */
  get inPlay(): boolean {
    switch (this.kind.type) {
      case "single":
      case "double":
      case "triple":
      case "homeRun":
      case "groundOut":
      case "flyOut":
      case "lineOut":
      case "popOut":
      case "foulOut":
      case "fieldersChoice":
      case "doublePlay":
      case "triplePlay":
      case "sacrificeFly":
      case "sacrificeBunt":
      case "error":
        return true;
      case "other":
        return this.spot != null;
      default:
        return false;
    }
  }

  /** The flight, from ESPN when it says, else from the kind. */
  get flight(): Trajectory {
    if (this.trajectory) return this.trajectory;
    switch (this.kind.type) {
      case "groundOut":
      case "fieldersChoice":
      case "doublePlay":
      case "sacrificeBunt":
      case "error":
        return "ground";
      case "flyOut":
      case "sacrificeFly":
      case "triple":
      case "homeRun":
      case "foulOut":
        return "fly";
      case "popOut":
        return "popUp";
      default:
        return "line";
    }
  }

  get notation(): Notation {
    const chain = this.fielders.join("-");
    const first = this.fielders[0] != null ? String(this.fielders[0]) : "";
    const tagged = (tag: string) => (chain === "" ? tag : `${tag} ${chain}`);
    const n = (code: string, backwards = false): Notation => ({ code, backwards });
    const k = this.kind;
    switch (k.type) {
      // A hit the batter stretched on an error carries it: "1B E5".
      case "single":
        return n(this.error != null ? `1B E${this.error}` : "1B");
      case "double":
        return n(this.error != null ? `2B E${this.error}` : "2B");
      case "triple":
        return n(this.error != null ? `3B E${this.error}` : "3B");
      case "homeRun":
        return n("HR");
      case "groundOut":
        return n(this.fielders.length === 1 ? `${first}U` : chain === "" ? "GO" : chain);
      case "flyOut":
        return n(`F${first}`);
      case "lineOut":
        return n(`L${first}`);
      case "popOut":
        return n(`P${first}`);
      case "foulOut":
        return n((this.trajectory === "popUp" ? "P" : "F") + first);
      case "fieldersChoice":
        return n(tagged("FC"));
      case "doublePlay":
      case "triplePlay": {
        // A ball caught in the air leads with its catch: "L6-3 DP".
        const air = { line: "L", fly: "F", popUp: "P", ground: "" }[this.flight];
        return n(`${air}${chain === "" ? "" : chain + " "}${k.type === "doublePlay" ? "DP" : "TP"}`);
      }
      case "sacrificeFly":
        return n(`SF${first}`);
      case "sacrificeBunt":
        return n(tagged("SAC"));
      case "error":
        return n(`E${this.error != null ? String(this.error) : first}`);
      case "strikeout":
        return n("K", (k as { looking: boolean }).looking);
      case "walk":
        return n((k as { intentional: boolean }).intentional ? "IBB" : "BB");
      case "hitByPitch":
        return n("HBP");
      case "stolenBase":
        return n("SB");
      case "caughtStealing":
        return n(tagged("CS"));
      case "pickoff":
        return n(tagged("PO"));
      case "wildPitch":
        return n("WP");
      case "passedBall":
        return n("PB");
      case "balk":
        return n("BK");
      case "indifference":
        return n("DI");
      case "other":
        return n("");
    }
  }

  /** The play in two or three words, for the stamp's second line. */
  get title(): string {
    const k = this.kind;
    switch (k.type) {
      case "single":
        return "Single";
      case "double":
        return "Double";
      case "triple":
        return "Triple";
      case "homeRun":
        return this.runs === 4 ? "Grand slam" : "Home run";
      case "groundOut":
        return "Groundout";
      case "flyOut":
        return "Flyout";
      case "lineOut":
        return "Lineout";
      case "popOut":
        return "Pop out";
      case "foulOut":
        return "Foul out";
      case "fieldersChoice":
        return this.runners.some(isOut) ? "Force out" : "Fielder's choice";
      case "doublePlay":
        return "Double play";
      case "triplePlay":
        return "Triple play";
      case "sacrificeFly":
        return "Sacrifice fly";
      case "sacrificeBunt":
        return "Sacrifice";
      case "error":
        return "Error";
      case "strikeout":
        return (k as { looking: boolean }).looking ? "Strikeout looking" : "Strikeout swinging";
      case "walk":
        return (k as { intentional: boolean }).intentional ? "Intentional walk" : "Walk";
      case "hitByPitch":
        return "Hit by pitch";
      case "stolenBase":
        return "Stolen base";
      case "caughtStealing":
        return "Caught stealing";
      case "pickoff":
        return "Picked off";
      case "wildPitch":
        return "Wild pitch";
      case "passedBall":
        return "Passed ball";
      case "balk":
        return "Balk";
      case "indifference":
        return "Defensive indifference";
      case "other":
        return "";
    }
  }
}

/** What the play theater shows: the last play on the field and who's up now. */
export interface TheaterState {
  readonly play: PlayScene | null;
  /** Arrived while the page was open, or only just happened: replay it. Otherwise it's history, and shows as it ended. */
  readonly news: boolean;
  /** The batter at the plate by the side he stands on; null between innings. */
  readonly bats: Hand | null;
}

export const EMPTY_THEATER: TheaterState = { play: null, news: false, bats: null };

export type SideOf = (teamID: string | undefined) => Side | null;

// MARK: - Lenient readers (Swift `JSON.string` also reads numbers; `.int` also reads numeric strings)

function sv(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}

function iv(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number(v) : num(v);
  if (n == null || !Number.isFinite(n)) return undefined;
  return Math.trunc(n);
}

function dv(v: unknown): number | undefined {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : num(v);
  return n != null && Number.isFinite(n) ? n : undefined;
}

const typeOf = (entry: unknown) => str(at(entry, "type", "type"));

// MARK: - Parsing

/** The newest play on the field in a run of plays (lineup changes and the inning's bookkeeping aren't plays). */
export function latest(plays: readonly unknown[], side: SideOf, names: Readonly<Record<string, string>> = {}): PlayScene | null {
  for (let index = plays.length - 1; index >= 0; index--) {
    if (typeOf(plays[index]) !== "play-result") continue;
    const scene = parse(plays, index, side, names);
    if (scene) return scene;
  }
  return null;
}

/** The theater's state after these plays: the newest play, and the batter up after it (the same batter when it was a runner's play mid-at-bat). */
export function theater(plays: readonly unknown[], side: SideOf, names: Readonly<Record<string, string>> = {}): TheaterState {
  const play = latest(plays, side, names);
  let index = -1;
  if (play) {
    for (let i = plays.length - 1; i >= 0; i--) {
      if (sv(at(plays[i], "id")) === play.id) {
        index = i;
        break;
      }
    }
  }
  if (!play || index < 0) {
    let bats: Hand | null = null;
    for (let i = plays.length - 1; i >= 0; i--) {
      if (has(plays[i], "bats")) {
        bats = hand(plays[i]);
        break;
      }
    }
    return { play: null, news: false, bats };
  }
  let next: unknown;
  for (let i = plays.length - 1; i > index; i--) {
    const e = plays[i];
    if (typeOf(e) === "start-batterpitcher" || str(at(e, "summaryType")) === "P") {
      next = e;
      break;
    }
  }
  const bats = (next !== undefined ? hand(next) : null) ?? (play.batter == null && !play.endsInning ? play.bats : null);
  return { play, news: false, bats };
}

/** The play-result at `index`, with what led to it. Null for anything that isn't a play on the field. */
export function parse(plays: readonly unknown[], index: number, side: SideOf, names: Readonly<Record<string, string>> = {}): PlayScene | null {
  const result = plays[index];
  const id = sv(at(result, "id"));
  if (typeOf(result) !== "play-result" || id == null) return null;
  const k = kind(str(at(result, "alternativeType", "type")) ?? "", str(at(result, "text")) ?? "", bool(at(result, "doublePlay")) === true, bool(at(result, "triplePlay")) === true);
  if (!k) return null;
  const atBat = sv(at(result, "atBatId"));
  const half = halfInning(result);

  // Back through the plays: the at-bat's entries (newest first), and the
  // play before this one in the half-inning, for the outs before it.
  const earlier: unknown[] = [];
  let previous: unknown;
  let previousKnown = false;
  for (let i = index - 1; i >= 0; i--) {
    const entry = plays[i];
    const sameAtBat = atBat != null && sv(at(entry, "atBatId")) === atBat;
    if (sameAtBat) earlier.push(entry);
    if (!previousKnown) {
      if (isPlay(entry)) {
        if (halfInning(entry) === half) previous = entry;
        previousKnown = true;
      } else if (typeOf(entry) === "start-inning") {
        previousKnown = true;
      }
    }
    if (previousKnown && !sameAtBat) break;
  }
  const pitchEntry = earlier.find((e) => str(at(e, "summaryType")) === "P");

  const scene = new PlayScene(id, k);
  scene.text = str(at(result, "text")) ?? "";
  scene.batting = side(sv(at(result, "team", "id")));
  const rawTrajectory = str(at(result, "trajectory")) ?? (pitchEntry !== undefined ? str(at(pitchEntry, "trajectory")) : undefined);
  scene.trajectory = rawTrajectory != null ? (TRAJECTORIES[rawTrajectory] ?? null) : null;
  const hit = has(result, "hitCoordinate") ? at(result, "hitCoordinate") : pitchEntry !== undefined ? at(pitchEntry, "hitCoordinate") : undefined;
  const hx = dv(at(hit, "x"));
  const hy = dv(at(hit, "y"));
  if ((scene.inPlay || k.type === "other") && hx != null && hy != null) scene.spot = { x: hx, y: hy };
  if (!scene.inPlay) scene.trajectory = null;
  const feet = /\((\d+) feet\)/.exec(scene.text);
  scene.distance = feet?.[1] != null ? Number(feet[1]) : null;
  scene.bats = hand(result) ?? (pitchEntry !== undefined ? hand(pitchEntry) : null);
  if (pitchEntry !== undefined) {
    const code = str(at(pitchEntry, "pitchType", "abbreviation")) ?? null;
    scene.pitch = {
      code,
      name: str(at(pitchEntry, "pitchType", "text")) ?? (code != null ? (PITCH_NAMES[code] ?? null) : null),
      mph: iv(at(pitchEntry, "pitchVelocity")) ?? null,
      x: dv(at(pitchEntry, "pitchCoordinate", "x")) ?? null,
      y: dv(at(pitchEntry, "pitchCoordinate", "y")) ?? null,
    };
  }
  const wallclock = str(at(result, "wallclock"));
  const time = wallclock != null ? Date.parse(wallclock) : Number.NaN;
  scene.wallclock = Number.isFinite(time) ? time : null;
  scene.runs = Math.max(iv(at(result, "scoreValue")) ?? 0, 0);
  scene.walkOff = scene.runs > 0 && walkOff(result);
  scene.outsAfter = Math.min(Math.max(iv(at(result, "outs")) ?? 0, 0), 3);

  // Fielders: the scorer's version names every one in order; the short
  // text (all the summary carries) names the first, and a relay.
  const scorerText = str(at(result, "shortAlternativeText"));
  const scorer = scorerText != null ? fieldersFromScorer(scorerText) : { chain: [], error: null };
  const short = fieldersFromText(scene.text);
  scene.fielders = scorer.chain.length === 0 ? short.chain : scorer.chain;
  scene.error = scorer.error ?? short.error;
  // A ground ball (or a bunt) the text credits to one infielder went on to first.
  if (
    (k.type === "groundOut" || k.type === "doublePlay" || k.type === "sacrificeBunt") &&
    scene.flight === "ground" &&
    scene.fielders.length === 1 &&
    scene.fielders[0] !== 3 &&
    !scene.text.includes("unassisted")
  ) {
    scene.fielders.push(3);
  }

  // Runners: before from the entry nearest the result (a pitch's
  // participants, or a runner's play earlier in the at-bat), after from
  // the result itself.
  const nearest = earlier.find((e) => str(at(e, "summaryType")) === "P" || typeOf(e) === "start-batterpitcher" || isPlay(e));
  const before = nearest !== undefined ? bases(nearest) : previous !== undefined ? bases(previous) : new Map<number, string>();
  const made = expectedOuts(k);
  scene.outsBefore = previous !== undefined ? Math.min(Math.max(iv(at(previous, "outs")) ?? 0, 0), 2) : Math.max(scene.outsAfter - made, 0);
  // A count that doesn't add up (a rewritten entry): trust the kind.
  if (made > 0 && scene.outsBefore >= scene.outsAfter) scene.outsBefore = Math.max(scene.outsAfter - made, 0);
  scene.runners = movements(
    k,
    scene.inPlay && scene.flight !== "ground",
    before,
    bases(result),
    participant(result, "batter"),
    scene.outsAfter - scene.outsBefore,
    scene.runs,
    scene.text,
    names,
  );
  // A force the text credits to one fielder: whoever covered the base took the throw.
  if (k.type === "fieldersChoice" && scene.fielders.length === 1) {
    const forced = scene.runners.find((r) => r.end.kind === "out" && r.end.at != null && r.from > 0);
    if (forced && forced.end.kind === "out" && forced.end.at != null) scene.fielders.push(coverer(forced.end.at, scene.fielders[0] ?? 0));
  }

  // Web: the half-inning and the batter's plate appearance in it, for Statcast.
  scene.inning = iv(at(result, "period", "number")) ?? null;
  const halfType = str(at(result, "period", "type"))?.toLowerCase();
  scene.top = halfType == null ? null : halfType.startsWith("top");
  scene.batterID = participant(result, "batter");
  if (scene.batterID != null) {
    let count = 0;
    for (let i = 0; i < index; i++) {
      const e = plays[i];
      if (typeOf(e) === "play-result" && halfInning(e) === half && isPlay(e) && participant(e, "batter") === scene.batterID) count++;
    }
    scene.batterOccurrence = count;
  }
  return scene;
}

/**
 * Who takes a throw at a base (0: home) from a fielder: the first baseman at
 * first, the middle infielder not fielding it at second, the third baseman at
 * third, the catcher at home; the pitcher when the usual man threw it.
 */
export function coverer(base: number, fielder: number): number {
  switch (base) {
    case 1:
      return fielder === 3 ? 1 : 3;
    case 2:
      return [4, 3, 9].includes(fielder) ? 6 : 4;
    case 3:
      return fielder === 5 ? 6 : 5;
    default:
      return fielder === 2 ? 1 : 2;
  }
}

/** A result that's a play on the field (not a lineup change). */
export function isPlay(entry: unknown): boolean {
  return typeOf(entry) === "play-result" && kind(str(at(entry, "alternativeType", "type")) ?? "", "", false, false) != null;
}

/** The result's kind, from ESPN's structured type; null for a play that isn't one on the field (a substitution). */
export function kind(type: string, text: string, doublePlay: boolean, triplePlay: boolean): Kind | null {
  const t = type.toLowerCase();
  if (t === "" || ["lineup", "substitut", "pitching-change", "defensive-switch", "start-", "end-"].some((s) => t.includes(s))) return null;
  if (triplePlay || t.includes("triple-play")) return kindOf("triplePlay");
  // A strikeout with a runner thrown out is still the batter's strikeout.
  if (t.startsWith("strike") || t.includes("missed-bunt") || t.includes("strikeout")) {
    return { type: "strikeout", looking: t.includes("looking") || text.includes("called out on strikes") || text.includes("struck out looking") };
  }
  if (doublePlay || t.includes("double-play")) return kindOf("doublePlay");
  if (t.includes("intent")) return { type: "walk", intentional: true };
  if (t.startsWith("ball") || t.includes("walk")) return { type: "walk", intentional: false };
  if (t.includes("hit-by-pitch")) return kindOf("hitByPitch");
  if (t.includes("home-run")) return kindOf("homeRun");
  if (t.includes("triple")) return kindOf("triple");
  if (t.includes("double")) return kindOf("double");
  if (t.includes("single")) return kindOf("single");
  if (t.includes("sacrifice-fly") || t.includes("sac-fly")) return kindOf("sacrificeFly");
  if (t.includes("sacrifice") || t.includes("sac-bunt")) return kindOf("sacrificeBunt");
  if (t.includes("fielders-choice")) return kindOf("fieldersChoice");
  if (t.includes("caught-stealing")) return kindOf("caughtStealing");
  if (t.includes("error")) return kindOf("error");
  if (t.includes("ground-out") || t.includes("groundout")) return kindOf("groundOut");
  if (t.includes("fly-out") || t.includes("flyout")) return kindOf("flyOut");
  if (t.includes("line-out") || t.includes("lineout")) return kindOf("lineOut");
  if (t.includes("pop-out") || t.includes("popout")) return kindOf("popOut");
  if (t.includes("foul-out")) return kindOf("foulOut");
  if (t.includes("stolen-base") || t.includes("steal")) return kindOf("stolenBase");
  if (t.includes("pickoff") || t.includes("picked-off")) return kindOf("pickoff");
  if (t.includes("wild-pitch")) return kindOf("wildPitch");
  if (t.includes("passed-ball")) return kindOf("passedBall");
  if (t.includes("balk")) return kindOf("balk");
  if (t.includes("indifference")) return kindOf("indifference");
  return kindOf("other");
}

/** Outs a play of this kind makes, when the play before isn't at hand. */
export function expectedOuts(k: Kind): number {
  switch (k.type) {
    case "groundOut":
    case "flyOut":
    case "lineOut":
    case "popOut":
    case "foulOut":
    case "fieldersChoice":
    case "sacrificeFly":
    case "sacrificeBunt":
    case "strikeout":
    case "caughtStealing":
    case "pickoff":
      return 1;
    case "doublePlay":
      return 2;
    case "triplePlay":
      return 3;
    default:
      return 0;
  }
}

/** Scorer's numbers by the scorer's names for the positions. */
export const POSITIONS: readonly (readonly [string, number])[] = [
  ["pitcher", 1],
  ["catcher", 2],
  ["first baseman", 3],
  ["second baseman", 4],
  ["third baseman", 5],
  ["shortstop", 6],
  ["left fielder", 7],
  ["center fielder", 8],
  ["right fielder", 9],
];

export interface FielderChain {
  readonly chain: number[];
  readonly error: number | null;
}

/**
 * "grounds out, shortstop Taylor Walls to first baseman Ryan Vilade" → [6, 3].
 * A deflection isn't a fielding credit; the fielder named for an error is
 * the error, not the chain.
 */
export function fieldersFromScorer(text: string): FielderChain {
  const found: { at: number; number: number }[] = [];
  for (const [name, number] of POSITIONS) {
    let from = 0;
    for (;;) {
      const i = text.indexOf(name, from);
      if (i < 0) break;
      found.push({ at: i, number });
      from = i + name.length;
    }
  }
  const chain: number[] = [];
  let error: number | null = null;
  for (const { at: position, number } of found.sort((a, b) => a.at - b.at)) {
    const lead = text.slice(Math.max(0, position - 14), position);
    if (lead.endsWith("error by ")) {
      error = error ?? number;
      continue;
    }
    if (lead.endsWith("deflected by ")) continue;
    if (chain[chain.length - 1] !== number) chain.push(number);
  }
  return { chain, error };
}

const WORDS: Readonly<Record<string, number>> = {
  pitcher: 1,
  catcher: 2,
  first: 3,
  second: 4,
  third: 5,
  shortstop: 6,
  left: 7,
  center: 8,
  right: 9,
  "left center": 8,
  "right center": 8,
};

/**
 * The short text's positions: "Turang grounded out to shortstop." → [6]; a
 * relay clause, "…, second to shortstop to first, …" → [4, 6, 3].
 */
export function fieldersFromText(text: string): FielderChain {
  const parts = clauses(text);
  let error: number | null = null;
  const m = /error by (pitcher|catcher|first baseman|second baseman|third baseman|shortstop|left fielder|center fielder|right fielder)/.exec(text);
  if (m) error = POSITIONS.find(([name]) => name === m[1])?.[1] ?? null;
  for (const clause of parts.slice(1)) {
    const steps = clause.split(" to ");
    const numbers = steps.flatMap((s) => (WORDS[s] != null ? [WORDS[s]] : []));
    if (steps.length >= 2 && numbers.length === steps.length) return { chain: numbers, error };
  }
  const first = parts[0];
  const end = first != null ? /(?:to|by) (left center|right center|pitcher|catcher|first|second|third|shortstop|left|center|right)$/.exec(first) : null;
  if (!end?.[1]) return { chain: [], error };
  const number = WORDS[end[1]];
  return { chain: number != null ? [number] : [], error };
}

/** A play's text in clauses: at commas, and at sentence ends (not after "Jr." mid-sentence). */
export function clauses(text: string): string[] {
  return text
    .split(/,\s*|\.(?=\s+[A-Z]|\s*$)/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/** Bases by athlete ID, from an entry's participants. */
export function bases(entry: unknown): Map<number, string> {
  const out = new Map<number, string>();
  for (const [base, role] of [
    [1, "onFirst"],
    [2, "onSecond"],
    [3, "onThird"],
  ] as const) {
    const id = participant(entry, role);
    if (id != null) out.set(base, id);
  }
  return out;
}

/** A participant's athlete ID: the summary's `athlete.id`, or the core feed's link (".../athletes/4917869?lang=en"). */
export function participant(entry: unknown, role: string): string | null {
  const p = arr(at(entry, "participants")).find((q) => str(at(q, "type")) === role);
  if (p === undefined) return null;
  const id = sv(at(p, "athlete", "id"));
  if (id != null) return id;
  const ref = str(at(p, "athlete", "$ref"));
  if (ref == null) return null;
  const i = ref.indexOf("/athletes/");
  if (i < 0) return null;
  const digits = /^\d*/.exec(ref.slice(i + "/athletes/".length))?.[0] ?? "";
  return digits === "" ? null : digits;
}

/**
 * The home team takes the lead in the bottom of the 9th or later: the game
 * is over. A scoring result's score fields are the score after it.
 */
export function walkOff(entry: unknown): boolean {
  if (str(at(entry, "period", "type"))?.toLowerCase().startsWith("bot") !== true) return false;
  const inning = iv(at(entry, "period", "number"));
  const home = iv(at(entry, "homeScore"));
  const away = iv(at(entry, "awayScore"));
  if (inning == null || inning < 9 || home == null || away == null) return false;
  const runs = iv(at(entry, "scoreValue")) ?? 1;
  return home > away && home - runs <= away;
}

export function hand(entry: unknown): Hand | null {
  const raw = str(at(entry, "bats", "abbreviation"));
  return raw === "L" || raw === "R" ? raw : null;
}

export function halfInning(entry: unknown): string {
  return `${str(at(entry, "period", "type")) ?? ""}${int(at(entry, "period", "number")) ?? 0}`;
}

/** "J. Chourio" → "Chourio"; "V. Mesa Jr." → "Mesa Jr". */
export function surname(name: string): string {
  const words = name.split(" ").filter((w) => w !== "");
  let i = 0;
  while (i < words.length && words[i]!.endsWith(".") && words[i]!.length <= 3) i++;
  const rest = words.slice(i);
  return (rest.length === 0 ? name : rest.join(" ")).replace(/^\.+|\.+$/g, "");
}

/**
 * Where each runner went. A runner on a base after the play went there;
 * one who isn't scored or was put out. Runs and outs say how many of each;
 * the text says which ("Bauers scored", "Díaz out at second"), by surname.
 * When it can't, the batter makes his own out, runs go to the lead runners
 * and outs to the trailing (forced) ones.
 */
export function movements(
  k: Kind,
  air: boolean,
  before: ReadonlyMap<number, string>,
  after: ReadonlyMap<number, string>,
  batter: string | null,
  outs: number,
  runs: number,
  text: string,
  names: Readonly<Record<string, string>>,
): Runner[] {
  // A runner's play mid-at-bat has no batter on it.
  const starts: { id: string | null; from: number }[] = [
    ...(batter != null ? [{ id: batter as string | null, from: 0 }] : []),
    ...[...before.entries()].sort((a, b) => b[0] - a[0]).map(([from, id]) => ({ id: id as string | null, from })),
  ];
  if (k.type === "homeRun") return starts.map((s) => ({ id: s.id, from: s.from, end: { kind: "scored" } }));
  const landed = new Map<string, number>();
  for (const [base, id] of after) landed.set(id, Math.max(landed.get(id) ?? -Infinity, base));
  const runners: Runner[] = [];
  const gone: { id: string | null; from: number }[] = [];
  for (const start of starts) {
    const base = start.id != null ? landed.get(start.id) : undefined;
    if (start.id != null && base != null && base >= start.from) {
      runners.push({ id: start.id, from: start.from, end: { kind: "base", base } });
    } else {
      gone.push(start);
    }
  }
  let runsLeft = Math.max(runs, 0);
  let outsLeft = Math.max(outs, 0);
  const parts = clauses(text);
  const surnameOf = (id: string | null): string | null => {
    if (id == null) return null;
    const name = names[id];
    return name == null ? null : surname(name);
  };
  const baseIn = (clause: string): number | null => {
    const m = /(?:at|stealing|off) (first|1st|second|2nd|third|3rd|home)/.exec(clause);
    if (!m?.[1]) return null;
    return ({ first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, home: 0 } as Record<string, number>)[m[1]] ?? null;
  };
  const outBase = (from: number): number | null => {
    if (from === 0) {
      switch (k.type) {
        case "strikeout":
          return 0;
        case "flyOut":
        case "lineOut":
        case "popOut":
        case "foulOut":
        case "sacrificeFly":
          return null;
        default:
          return 1;
      }
    }
    switch (k.type) {
      case "pickoff":
        return from;
      // Doubled off on a catch: back at the base he left; else forced at the next.
      case "doublePlay":
      case "triplePlay":
      case "flyOut":
      case "lineOut":
      case "popOut":
        return air ? from : (from + 1) % 4;
      default:
        return (from + 1) % 4;
    }
  };
  // By the text first.
  const unresolved: { id: string | null; from: number }[] = [];
  for (const runner of gone) {
    const name = surnameOf(runner.id);
    const scored = name != null ? parts.some((c) => c.includes(name) && c.includes("scor")) : false;
    const out = name != null ? parts.find((c) => c.includes(name) && [" out", "caught stealing", "picked off", "doubled off"].some((w) => c.includes(w))) : undefined;
    if (scored && runsLeft > 0) {
      runners.push({ id: runner.id, from: runner.from, end: { kind: "scored" } });
      runsLeft -= 1;
    } else if (out !== undefined && outsLeft > 0) {
      runners.push({ id: runner.id, from: runner.from, end: { kind: "out", at: baseIn(out) ?? outBase(runner.from) } });
      outsLeft -= 1;
    } else {
      unresolved.push(runner);
    }
  }
  // Then by rule.
  const batterIndex = unresolved.findIndex((r) => r.from === 0);
  if (batterOut(k) && outsLeft > 0 && batterIndex >= 0) {
    runners.push({ id: unresolved[batterIndex]!.id, from: 0, end: { kind: "out", at: outBase(0) } });
    unresolved.splice(batterIndex, 1);
    outsLeft -= 1;
  }
  for (const runner of unresolved.filter((r) => r.from > 0).sort((a, b) => b.from - a.from)) {
    if (runsLeft <= 0) break;
    runners.push({ id: runner.id, from: runner.from, end: { kind: "scored" } });
    const i = unresolved.findIndex((r) => r.from === runner.from);
    if (i >= 0) unresolved.splice(i, 1);
    runsLeft -= 1;
  }
  for (const runner of [...unresolved].sort((a, b) => a.from - b.from)) {
    if (outsLeft > 0) {
      runners.push({ id: runner.id, from: runner.from, end: { kind: "out", at: outBase(runner.from) } });
      outsLeft -= 1;
    } else if (runner.from > 0) {
      // Unaccounted for (the inning ended around him): he stays.
      runners.push({ id: runner.id, from: runner.from, end: { kind: "base", base: runner.from } });
    } else {
      const reached = reachedBase(k);
      if (reached != null) {
        // A batter the result left off the bases (ESPN drops him at the third out).
        runners.push({ id: runner.id, from: 0, end: { kind: "base", base: reached } });
      } else {
        runners.push({ id: runner.id, from: 0, end: { kind: "out", at: outBase(0) } });
      }
    }
  }
  // The batter first, then from the lead runner back.
  return runners.sort((a, b) => {
    if (a.from === 0 && b.from === 0) return 0;
    if (a.from === 0) return -1;
    if (b.from === 0) return 1;
    return b.from - a.from;
  });
}

/** The batter's own out: a strikeout, or a ball caught or thrown to first. */
function batterOut(k: Kind): boolean {
  switch (k.type) {
    case "groundOut":
    case "flyOut":
    case "lineOut":
    case "popOut":
    case "foulOut":
    case "doublePlay":
    case "triplePlay":
    case "sacrificeFly":
    case "sacrificeBunt":
    case "strikeout":
      return true;
    default:
      return false;
  }
}

function reachedBase(k: Kind): number | null {
  switch (k.type) {
    case "single":
    case "walk":
    case "hitByPitch":
    case "fieldersChoice":
    case "error":
    case "other":
      return 1;
    case "double":
      return 2;
    case "triple":
      return 3;
    default:
      return null;
  }
}
