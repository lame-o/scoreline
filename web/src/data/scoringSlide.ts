/**
 * The scoring slide (ScoringSlide.swift): a team scores on the open game
 * page and a broadcast lower third in its colors slides in from its side of
 * the hero (the left team's from the left) while the scoreboard steps aside,
 * says who and when (BREWERS · TOP 12TH), what happened in type that reads
 * across a room (HOME RUN, TOUCHDOWN, GOAL), what it was worth, who did it
 * and the new score, holds, and slides back out the way it came. Information
 * first: only scores that arrive while the page is open (never history), one
 * at a time in the order they happened, timed to the play theater's climax
 * when the theater is on screen replaying the play, and one celebration per
 * moment (the confetti stays a single burst, played wherever it's seen).
 *
 * This file is the pure part (tested): which moments slide and their words
 * per sport, the kicker and the tally, the side, the tier, the paint, the
 * theater's timing, who bursts, the line they wait in, and the motion's
 * timeline.
 * features/game/core/scoringSlides.tsx plays them.
 *
 *     const slide = makeSlide(moment, context);   // null: not one of its sport's scores
 *     slidePaint(slide);                          // the slab, the stripe, white or black type
 */
import { clockLabel } from "./basketball";
import { houseCurve, bezier } from "./celebrations";
import { surname } from "./climbing";
import { series } from "./cs2";
import { ordinal, overtime, periodLabel } from "./format";
import type { MapResult } from "./gameDetail";
import type { StatcastBatted } from "./mlb/statcast";
import type { Side } from "./models";
import { decisive, opposite, scorer, Tier, type LiveMoment } from "./moments";
import type { ScoringFacts } from "./scoringFacts";
import { chroma, hue, oklabFromHex, toRGB, type OKLab } from "./teamColors";
import { FLAG_PALETTE, flagFromIOC } from "./teams";
import type { Climber } from "./wallState";

// MARK: - Teams and context

/** A side of the page, as a slide wears it. */
export interface SlideTeam {
  /** "Brewers". */
  readonly name: string;
  /** "MIL". */
  readonly abbreviation: string;
  readonly logo?: string | null;
  /** Its own color and its second (hex). */
  readonly color?: string | null;
  readonly alternate?: string | null;
}

/** What the page knows that its moments don't: who's who, the round, the series. */
export interface SlideContext {
  readonly top?: SlideTeam | null;
  readonly bottom?: SlideTeam | null;
  /** Climbing: the round is a final (tops and new leaders slide only there). */
  readonly final?: boolean;
  /** Climbing: everyone on the route, by ID. */
  readonly climbers?: ReadonlyMap<number, Climber>;
  /** CS2: the series' maps, for the maps score after one is won, and how many it's played over. */
  readonly maps?: readonly MapResult[];
  readonly bestOf?: number | null;
}

const teamOf = (c: SlideContext, side: Side | null): SlideTeam | null => (side === "top" ? (c.top ?? null) : side === "bottom" ? (c.bottom ?? null) : null);

// MARK: - Slide

/**
 * How big it plays. A normal score slides; a big one (a home run, a
 * touchdown, a goal) adds the sheen and a spark at the logo; the top tier (a
 * grand slam, a walk-off, a pick six, a late winner, a buzzer-beater, a
 * match won) adds the confetti, when the page's one burst is the slide's,
 * and holds longer.
 */
export const SlideTier = { normal: 0, big: 1, top: 2 } as const;
export type SlideTier = (typeof SlideTier)[keyof typeof SlideTier];

/** One slide: everything it says and wears, decided from its moment. */
export interface ScoringSlide {
  readonly id: string;
  /** The scorer's side of the hero: it enters from there (null, climbing: from the leading edge). */
  readonly side: Side | null;
  readonly tier: SlideTier;
  /** "HOME RUN", in heavy condensed caps. */
  readonly headline: string;
  /** A shorter headline for a narrow page ("WALK-OFF HR"). */
  readonly short: string | null;
  /** The chip: what it was worth ("+2"), or a place ("1ST"); null without one. */
  readonly chip: string | null;
  /** Who and how: "Hicks · 411 ft · Caminero scores". */
  readonly subline: string;
  /** The new score, the scorer's first: "MIL 5–2". */
  readonly score: string | null;
  /** The tab over the bar: the team and when ("Brewers · Top 12th"); null with neither. */
  readonly kicker: string | null;
  /** The new score as two rows at the bar's far end, the scorer's first; null without both teams and the score. */
  readonly tally: SlideTally | null;
  /** Its one announcement: "Brewers RBI single, Yelich, 1 run, Brewers lead 1 to 0". */
  readonly spoken: string;
  /** Whose colors and logo it wears. */
  readonly team: SlideTeam | null;
  /** Climbing: the climber's flag, and the country whose colors it wears. */
  readonly flag: string | null;
  readonly country: string | null;
  /** The moment it tells (its celebration's cue reads it). */
  readonly moment: LiveMoment;
  /** It plays the page's confetti for its moment (decided as it's queued). */
  readonly confetti: boolean;
}

/** A side's row in the tally: "MIL 3". */
export interface SlideTallyRow {
  readonly team: string;
  readonly score: number;
}

/** The new score, the scorer's row first. */
export interface SlideTally {
  readonly mine: SlideTallyRow;
  readonly theirs: SlideTallyRow;
}

/** Seconds on screen once the wipe has landed, before it leaves. */
export const slideHold = (s: Pick<ScoringSlide, "tier">): number => (s.tier === SlideTier.top ? 6 : 4.5);

/** The edge it comes in from and leaves by. */
export const slideEdge = (s: Pick<ScoringSlide, "side">): "leading" | "trailing" => (s.side === "bottom" ? "trailing" : "leading");

export function slidePaint(s: Pick<ScoringSlide, "country" | "team">): SlidePaint {
  if (s.country != null) return flagPaint(s.country);
  return teamPaint(s.team?.color ?? null, s.team?.alternate ?? null);
}

// MARK: - Which moments slide, and what they say

/**
 * The slide for a moment, or null when the moment isn't one of its sport's
 * scores. Baseball: any run. Football: a touchdown, field goal or safety
 * (the try in the touchdown's line). Soccer: a goal. NBA: only what the page
 * already ranks highest (a buzzer-beater, a clutch go-ahead, a run of 12 or
 * more), never every basket. CS2: a map or the match won. Climbing, in a
 * final: a top, a new leader, the final won. `batted` is Statcast's
 * measurement of a home run, once it's in. (pure; tested)
 */
export function makeSlide(m: LiveMoment, context: SlideContext, batted: StatcastBatted | null = null): ScoringSlide | null {
  const slide = sportSlide(m, context, batted);
  if (!slide?.side) return slide;
  return { ...slide, kicker: slideKicker(slide.team, slidePeriod(m)), tally: slideTally(slide.side, m.facts, context) };
}

function sportSlide(m: LiveMoment, context: SlideContext, batted: StatcastBatted | null): ScoringSlide | null {
  switch (m.chart) {
    case "plate":
      return baseball(m, context, batted);
    case "field":
      return football(m, context);
    case "pitch":
      return soccer(m, context);
    case "court":
      return basketball(m, context);
    case "rounds":
      return counterStrike(m, context);
    case "ascent":
      return climbing(m, context);
    default:
      return null;
  }
}

/** "Brewers · Top 12th": who and when, either alone; null with neither. (pure; tested) */
export function slideKicker(team: SlideTeam | null, when: string | null): string | null {
  const parts = [team?.name, when].filter((p): p is string => p != null && p.length > 0);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Both rows of the new score, the scorer's first, once both teams and the score are known. (pure; tested) */
export function slideTally(side: Side, facts: ScoringFacts | undefined, c: SlideContext): SlideTally | null {
  const top = facts?.top;
  const bottom = facts?.bottom;
  const me = teamOf(c, side);
  const them = teamOf(c, opposite(side));
  if (top == null || bottom == null || !me || !them) return null;
  const [mine, theirs] = side === "top" ? [top, bottom] : [bottom, top];
  return { mine: { team: me.abbreviation, score: mine }, theirs: { team: them.abbreviation, score: theirs } };
}

/**
 * When a score happened, as the kicker says it: "Top 12th", "Bot 9th" (an
 * unknown half: "12th Inn"), "2nd Qtr", "OT", "2OT", "67'"; null where the
 * sport has no period to name (CS2, climbing). (pure; tested)
 */
export function slidePeriod(m: LiveMoment): string | null {
  const f = m.facts;
  switch (m.chart) {
    case "plate": {
      const n = f?.period;
      if (n == null) return null;
      const half = f?.half?.toLowerCase();
      return half === "top" ? `Top ${ordinal(n)}` : half === "bottom" ? `Bot ${ordinal(n)}` : `${ordinal(n)} Inn`;
    }
    case "field":
    case "court": {
      const n = f?.period;
      if (n == null) return null;
      return n > 4 ? overtime(n - 4) : `${ordinal(n)} Qtr`;
    }
    case "pitch":
      return minuteMark(f?.clock ?? null);
    default:
      return null;
  }
}

/**
 * "MIL 5–2" (the scorer's number first) and how it's said where the game
 * stands ("Brewers lead 5 to 2", "tied 1 to 1").
 */
export function standing(side: Side | null, facts: ScoringFacts | undefined, c: SlideContext): { line: string | null; spoken: string | null } {
  const top = facts?.top;
  const bottom = facts?.bottom;
  if (!side || top == null || bottom == null) return { line: null, spoken: null };
  const [mine, theirs] = side === "top" ? [top, bottom] : [bottom, top];
  const me = teamOf(c, side);
  const them = teamOf(c, opposite(side));
  const line = me ? `${me.abbreviation} ${mine}–${theirs}` : `${mine}–${theirs}`;
  const spoken =
    mine === theirs ? `tied ${mine} to ${theirs}` : mine > theirs ? `${me?.name ?? "they"} lead ${mine} to ${theirs}` : `${them?.name ?? "they"} lead ${theirs} to ${mine}`;
  return { line, spoken };
}

function spokenOf(parts: readonly (string | null | undefined)[]): string {
  return parts.filter((p): p is string => p != null && p.length > 0).join(", ");
}

/** "Brewers home run": the team's name and what it did, as one phrase. */
const named = (team: SlideTeam | null, said: string) => [team?.name, said].filter((p): p is string => p != null).join(" ");

const joined = (parts: readonly (string | null | undefined)[]) => parts.filter((p): p is string => p != null).join(" · ");

function slide(fields: Omit<ScoringSlide, "short" | "chip" | "score" | "kicker" | "tally" | "team" | "flag" | "country" | "confetti"> & Partial<ScoringSlide>): ScoringSlide {
  return { short: null, chip: null, score: null, kicker: null, tally: null, team: null, flag: null, country: null, confetti: false, ...fields };
}

/** Swift's `.rounded()`: halves away from zero. */
const rounded = (v: number) => Math.sign(v) * Math.round(Math.abs(v));

// MARK: Baseball

function baseball(m: LiveMoment, c: SlideContext, batted: StatcastBatted | null): ScoringSlide | null {
  if (m.tier !== Tier.score || (m.kind !== "homeRun" && m.kind !== "runScored")) return null;
  const text = m.facts?.text ?? m.detail;
  const play = readBaseballPlay(text);
  const homer = m.kind === "homeRun";
  const runs = Math.max(m.facts?.value ?? play.scorers.length + (homer ? 1 : 0), 1);
  // The lane marks a walk-off decisive.
  const walkOff = decisive(m);
  let headline: string;
  let short: string | null = null;
  let said: string;
  if (homer) {
    // Baseball's own words: HOME RUN, 2-RUN HOMER, GRAND SLAM, WALK-OFF HOME RUN (HR, as the box score has it, when narrow).
    if (runs === 4 && walkOff) [headline, said] = ["WALK-OFF GRAND SLAM", "walk-off grand slam"];
    else if (runs === 4) [headline, said] = ["GRAND SLAM", "grand slam"];
    else if (walkOff) [headline, short, said] = ["WALK-OFF HOME RUN", "WALK-OFF HR", "walk-off home run"];
    else if (runs === 1) [headline, said] = ["HOME RUN", "home run"];
    else [headline, said] = [`${runs}-RUN HOMER`, `${runs}-run homer`];
  } else {
    const hit = baseballHit(m.facts?.type ?? null, text);
    if (walkOff) headline = hit ? `WALK-OFF ${hit}` : "WALK-OFF";
    else if (hit === "SAC FLY") headline = runs > 1 ? `${runs}-RUN SAC FLY` : "SAC FLY";
    else if (hit) headline = runs > 1 ? `${runs}-RUN ${hit}` : `RBI ${hit}`;
    else headline = runs > 1 ? `${runs} RUNS SCORE` : "RUN SCORES";
    said = headline.toLowerCase().replaceAll("rbi", "RBI");
  }
  const parts: string[] = [];
  if (homer) {
    parts.push(play.batter ?? play.action);
    const feet = batted?.distance != null ? rounded(batted.distance) : play.feet;
    if (feet != null) parts.push(`${feet} ft`);
    // Statcast's exit velocity, labeled as Statcast labels it.
    if (batted?.launchSpeed != null) parts.push(`EV ${batted.launchSpeed.toFixed(1)} mph`);
  } else {
    parts.push(play.action);
  }
  const scored = scoredLine(play.scorers);
  if (scored) parts.push(scored);
  const side = m.side;
  const team = teamOf(c, side);
  const stands = standing(side, m.facts, c);
  return slide({
    id: m.id,
    side,
    tier: walkOff || (homer && runs === 4) ? SlideTier.top : homer ? SlideTier.big : SlideTier.normal,
    headline,
    short,
    chip: `+${runs}`,
    subline: parts.join(" · "),
    score: stands.line,
    spoken: spokenOf([named(team, said), play.batter, runs === 1 ? "1 run" : `${runs} runs`, stands.spoken]),
    team,
    moment: m,
  });
}

// MARK: Football

function football(m: LiveMoment, c: SlideContext): ScoringSlide | null {
  if (m.tier !== Tier.score || (m.kind !== "touchdown" && m.kind !== "fieldGoal" && m.kind !== "safety")) return null;
  // A safety's moment is the offense's; its points are the defense's.
  const side = scorer(m);
  const team = teamOf(c, side);
  const play = readFootballPlay(m.facts?.text ?? m.detail);
  const pickSix = m.kind === "touchdown" && play.how?.kind === "interception";
  let headline: string;
  let short: string | null = null;
  let said: string;
  if (m.kind === "touchdown" && pickSix) [headline, said] = ["PICK SIX", "pick six"];
  else if (m.kind === "touchdown") [headline, short, said] = decisive(m) ? ["GO-AHEAD TOUCHDOWN", "GO-AHEAD TD", "go-ahead touchdown"] : ["TOUCHDOWN", null, "touchdown"];
  else if (m.kind === "fieldGoal") [headline, short, said] = decisive(m) ? ["GO-AHEAD FIELD GOAL", "GO-AHEAD FG", "go-ahead field goal"] : ["FIELD GOAL", null, "field goal"];
  else [headline, said] = ["SAFETY", "safety"];
  const value = m.facts?.value;
  const points = value != null && value > 0 ? value : footballPoints(play, m.kind);
  const line = footballLine(play) ?? m.detail;
  const stands = standing(side, m.facts, c);
  return slide({
    id: m.id,
    side,
    tier: pickSix || decisive(m) ? SlideTier.top : m.kind === "touchdown" ? SlideTier.big : SlideTier.normal,
    headline,
    short,
    chip: `+${points}`,
    subline: joined([line, tryLine(play.attempt)]),
    score: stands.line,
    spoken: spokenOf([named(team, said), line.replaceAll("-yd ", "-yard "), trySpoken(play.attempt), stands.spoken]),
    team,
    moment: m,
  });
}

// MARK: Soccer

function soccer(m: LiveMoment, c: SlideContext): ScoringSlide | null {
  if (m.kind !== "goal") return null;
  const goal = readSoccerGoal(m.detail, m.facts?.text ?? null, m.facts?.type ?? null);
  // ESPN's team on an own goal is sometimes the scorer's: the line's own words say whose it is.
  const side = goal.beneficiary ?? m.side;
  const team = teamOf(c, side);
  let headline: string;
  let short: string | null = null;
  let said: string;
  const top = m.facts?.top;
  const bottom = m.facts?.bottom;
  if (decisive(m) && top != null && bottom != null) {
    // A late goal that changes the result: level is an equalizer, ahead a winner.
    [headline, short, said] = top === bottom ? ["LATE EQUALIZER", "EQUALIZER", "late equalizer"] : ["LATE WINNER", "WINNER", "late winner"];
  } else if (goal.ownGoal) [headline, said] = ["OWN GOAL", "own goal"];
  else if (goal.penalty) [headline, said] = ["PENALTY", "penalty"];
  else [headline, said] = ["GOAL", "goal"];
  const minute = minuteMark(m.facts?.clock ?? null);
  const stands = standing(side, m.facts, c);
  const by = goal.team ? `${goal.scorer}, ${goal.team}` : goal.scorer;
  const assist = goal.assist ? `assisted by ${goal.assist}` : null;
  return slide({
    id: m.id,
    side,
    tier: decisive(m) ? SlideTier.top : SlideTier.big,
    headline,
    short,
    chip: "+1",
    // The minute is in the kicker.
    subline: joined([by, goal.how, assist]),
    score: stands.line,
    spoken: spokenOf([named(team, said), by, goal.how, assist, spokenMinute(minute), stands.spoken]),
    team,
    moment: m,
  });
}

// MARK: Basketball

function basketball(m: LiveMoment, c: SlideContext): ScoringSlide | null {
  const side = m.side;
  const team = teamOf(c, side);
  // "Paul George 26-ft three point jumper", without the lead change's or run's score.
  const parts = m.detail.split(" · ");
  let shot = parts[0] ?? m.detail;
  let headline: string;
  let short: string | null = null;
  let chip: string | null;
  let tier: SlideTier;
  let when: string | null;
  const facts = m.facts;
  if (m.kind === "made" && m.accents.has("buzzer")) {
    headline = "BUZZER-BEATER";
    chip = `+${facts?.value ?? m.value ?? 2}`;
    tier = SlideTier.top;
    when = facts?.period != null ? `end of ${periodLabel(facts.period, "basketball")}` : null;
  } else if (m.kind === "leadChange" && m.accents.has("clutch")) {
    const value = facts?.value ?? 2;
    headline = value >= 3 ? "GO-AHEAD 3-POINTER" : value === 1 ? "GO-AHEAD FREE THROW" : "GO-AHEAD BASKET";
    short = value === 1 ? "GO-AHEAD FT" : null;
    chip = `+${value}`;
    tier = SlideTier.big;
    when = facts?.period != null ? clockLabel(facts.period, facts.clock ?? "") : null;
  } else if (m.kind === "run") {
    // "12–0 run": only the big ones (the page's milestones from 12 on).
    const match = /^(\d+)–(\d+)/.exec(m.lead);
    if (!match) return null;
    const larger = Number(match[1]);
    const smaller = Number(match[2]);
    if (larger - smaller < 12) return null;
    headline = `${larger}–${smaller} RUN`;
    chip = null;
    tier = SlideTier.normal;
    when = null;
    // "NY · Josh Hart layup": the team, then the basket that made it.
    shot = parts.length > 1 ? parts[1]! : shot;
  } else {
    return null;
  }
  const stands = standing(side, facts, c);
  return slide({
    id: m.id,
    side,
    tier,
    headline,
    short,
    chip,
    subline: joined([shot, when]),
    score: stands.line,
    spoken: spokenOf([named(team, headline.toLowerCase()), shot, stands.spoken]),
    team,
    moment: m,
  });
}

// MARK: CS2

function counterStrike(m: LiveMoment, c: SlideContext): ScoringSlide | null {
  if (m.kind !== "mapWon" || !m.side) return null;
  const side = m.side;
  const team = teamOf(c, side);
  // "NAVI take Mirage 13–9 and the series 2–0" (the map's score top team first).
  const map = / take (.+?) (\d+)–(\d+)/.exec(m.detail);
  const rounds = map ? (side === "top" ? [map[2]!, map[3]!] : [map[3]!, map[2]!]) : null;
  const field = m.id.split(":")[1];
  const number = field != null && /^\d+$/.test(field) ? Number(field) : null;
  const s = number != null ? series(number, side, c.maps ?? [], c.bestOf ?? null) : null;
  const mapLine = map && rounds ? `${map[1]} ${rounds[0]}–${rounds[1]}` : null;
  const won = decisive(m);
  return slide({
    id: m.id,
    side,
    tier: won ? SlideTier.top : SlideTier.big,
    headline: won ? "MATCH WON" : "MAP WON",
    chip: "+1",
    subline: joined([mapLine, s ? `maps ${s.wins}–${s.losses}` : null]),
    score: s ? [team?.abbreviation, `${s.wins}–${s.losses}`].filter((p): p is string => p != null).join(" ") : null,
    spoken: spokenOf([
      team ? `${team.name} win ${map ? map[1] : "the map"}` : null,
      rounds ? `${rounds[0]} to ${rounds[1]}` : null,
      won ? "and the match" : null,
      s ? `${s.wins} maps to ${s.losses}` : null,
    ]),
    team,
    moment: m,
  });
}

// MARK: Climbing

function climbing(m: LiveMoment, c: SlideContext): ScoringSlide | null {
  if (!c.final || m.tier !== Tier.score) return null;
  // "climb:12:1" (a top), "pass:12:7" (a pass), "decided:1" (its winner in targets).
  const fields = m.id.split(":");
  const whole = (s: string | undefined) => (s != null && /^-?\d+$/.test(s) ? Number(s) : null);
  const id = m.kind === "finished" ? whole(m.targets?.[0]) : fields.length > 1 ? whole(fields[1]) : null;
  const climber = id != null ? c.climbers?.get(id) : undefined;
  const name = climber?.name ?? m.detail.split(" · ")[0] ?? m.detail;
  let headline: string;
  let tier: SlideTier = SlideTier.big;
  let chip: string | null = null;
  let note: string | null;
  if (m.kind === "top") {
    headline = "TOP";
    if (decisive(m)) {
      tier = SlideTier.top;
      chip = "1ST";
      note = "wins the final";
    } else if (m.accents.has("newLeader")) {
      chip = "1ST";
      note = "new leader";
    } else {
      note = m.accents.has("podium") ? "into the medals" : null;
    }
  } else if (m.kind === "passed" && m.accents.has("newLeader")) {
    headline = "NEW LEADER";
    chip = "1ST";
    const passed = (m.targets ?? []).flatMap((t) => {
      const n = whole(t);
      const who = n != null ? c.climbers?.get(n)?.name : undefined;
      return who ? [who] : [];
    });
    const last = passed.at(-1);
    note = last ? `passes ${surname(last)}` : null;
  } else if (m.kind === "finished" && decisive(m)) {
    headline = "GOLD";
    tier = SlideTier.top;
    chip = "1ST";
    note = climber?.label ?? null;
  } else {
    return null;
  }
  return slide({
    id: m.id,
    side: null,
    tier,
    headline,
    chip,
    subline: joined([name, note]),
    spoken: spokenOf([headline.slice(0, 1) + headline.slice(1).toLowerCase(), name, note]),
    flag: climber?.flag ?? flagFromIOC(climber?.country ?? null),
    country: climber?.country ?? "",
    moment: m,
  });
}

// MARK: - Reading the feeds' words

/**
 * ESPN's account of a run-scoring play, read for the slide: the batter and
 * what he did (in the present tense, as a broadcast says it), how far a home
 * run went, and who scored. (pure; tested)
 */
export interface BaseballPlay {
  readonly batter: string | null;
  /** "Yelich singles to left"; the clause as written when it can't be read. */
  readonly action: string;
  /** A home run's distance, as ESPN gives it ("(411 feet)"). */
  readonly feet: number | null;
  /** Who crossed the plate, in order (the batter's own run on a home run isn't listed). */
  readonly scorers: readonly string[];
}

const PRESENT = new Map<string, string>([
  ["homered", "homers"],
  ["singled", "singles"],
  ["doubled", "doubles"],
  ["tripled", "triples"],
  ["walked", "walks"],
  ["reached", "reaches"],
  ["grounded", "grounds"],
  ["flied", "flies"],
  ["lined", "lines"],
  ["popped", "pops"],
  ["hit", "hits"],
  ["struck", "strikes"],
  ["was", "is"],
  ["sacrificed", "sacrifices"],
  ["bunted", "bunts"],
  ["fouled", "fouls"],
  ["safe", "safe"],
  ["intentionally", "intentionally"],
]);

export function readBaseballPlay(text: string): BaseballPlay {
  const trimmed = text.trim();
  const sentence = trimmed.endsWith(".") ? trimmed.slice(0, -1) : trimmed;
  let main: string | null = null;
  const scorers: string[] = [];
  // Names listed ahead of a "scored": "McMahon, Jones, and Goldschmidt scored".
  let listed: string[] = [];
  for (const clause of sentence.split(", ")) {
    if (clause.includes(" scored")) {
      // "Chourio scored and Yelich scored", "Jones and Goldschmidt scored", "Pratt scored on error".
      for (const part of clause.split(" and ")) {
        const name = part.startsWith("and ") ? part.slice(4) : part;
        const r = name.indexOf(" scored");
        if (r >= 0) {
          scorers.push(...listed, name.slice(0, r));
          listed = [];
        } else if (name.length > 0) {
          listed.push(name);
        }
      }
    } else if (main == null) {
      main = clause;
    } else if (isName(clause)) {
      listed.push(clause);
    } else {
      listed = [];
    }
  }
  let clause = main ?? sentence;
  let feet: number | null = null;
  const distance = / ?\((\d+) feet\)/.exec(clause);
  if (distance) {
    feet = Number(distance[1]);
    clause = clause.slice(0, distance.index) + clause.slice(distance.index + distance[0].length);
  }
  const words = clause.split(" ").filter((w) => w.length > 0);
  const i = words.findIndex((w) => PRESENT.has(w.toLowerCase()));
  if (i > 0) {
    return { batter: words.slice(0, i).join(" "), action: [...words.slice(0, i), PRESENT.get(words[i]!.toLowerCase())!, ...words.slice(i + 1)].join(" "), feet, scorers };
  }
  return { batter: null, action: clause, feet, scorers };
}

/** A clause that's only a name, one of a list ("Jones", "J.D. Martinez", "De La Cruz"): a few capitalized words, no verb. */
export function isName(clause: string): boolean {
  const words = clause.split(" ").filter((w) => w.length > 0);
  return words.length > 0 && words.length <= 4 && words.every((w) => /^\p{Lu}/u.test(w) || ["de", "la", "del", "van", "von"].includes(w));
}

/** "Caminero scores", "Chourio and Yelich score", "Chourio, Yelich and Turang score". */
export function scoredLine(names: readonly string[]): string | null {
  const last = names.at(-1);
  if (last == null) return null;
  if (names.length === 1) return `${last} scores`;
  return `${names.slice(0, -1).join(", ")} and ${last} score`;
}

/**
 * The hit in a headline ("SINGLE", "SAC FLY"), from the play's own kind (or,
 * on a trimmed feed, its verb); null for a run scored any other way.
 */
export function baseballHit(type: string | null, text: string): string | null {
  switch (type) {
    case "single":
    case "bunt-single":
      return "SINGLE";
    case "double":
    case "ground-rule-double":
      return "DOUBLE";
    case "triple":
      return "TRIPLE";
    case "sacrifice-fly":
      return "SAC FLY";
    case null:
      break;
    default:
      return null;
  }
  const lower = text.toLowerCase();
  if (lower.includes("sacrifice fly")) return "SAC FLY";
  for (const [verb, hit] of [
    ["singled", "SINGLE"],
    ["infield single", "SINGLE"],
    ["doubled", "DOUBLE"],
    ["tripled", "TRIPLE"],
  ] as const) {
    if (lower.includes(verb)) return hit;
  }
  return null;
}

/** How a football score was scored. */
export type FootballHow =
  | { readonly kind: "run" | "pass" | "interception" | "fumble" | "puntReturn" | "kickoffReturn" | "fieldGoal" }
  | { readonly kind: "other"; readonly words: string };

/** The try after a touchdown: a kick, or two points by pass or by run. */
export type FootballTry = { readonly kind: "kick"; readonly good: boolean } | { readonly kind: "twoPoint"; readonly good: boolean; readonly pass: boolean };

/**
 * ESPN's short line for a football score, read for the slide ("Dameon
 * Pierce 5 Yd Rush (Jake Elliott Kick)"): who, how far, how, the passer, and
 * the try after a touchdown. (pure; tested)
 */
export interface FootballPlay {
  readonly who: string | null;
  readonly yards: number | null;
  readonly how: FootballHow | null;
  readonly passer: string | null;
  /** The try, once ESPN has added it. */
  readonly attempt: FootballTry | null;
}

export function readFootballPlay(short: string): FootballPlay {
  let main = short.trim();
  let attempt: FootballTry | null = null;
  const open = main.lastIndexOf("(");
  if (main.endsWith(")") && open >= 0) {
    attempt = footballAttempt(main.slice(open + 1, -1));
    main = main.slice(0, open).trim();
  }
  const match = /^(.+?) (\d+) Yd (.+)$/.exec(main);
  if (!match) return { who: null, yards: null, how: null, passer: null, attempt };
  const rest = match[3]!;
  const lower = rest.toLowerCase();
  let how: FootballHow;
  let passer: string | null = null;
  if (lower.startsWith("pass from ")) {
    how = { kind: "pass" };
    passer = rest.slice("pass from ".length);
  } else if (lower === "rush" || lower === "run") how = { kind: "run" };
  else if (lower.includes("interception")) how = { kind: "interception" };
  else if (lower.includes("fumble")) how = { kind: "fumble" };
  else if (lower.includes("punt return")) how = { kind: "puntReturn" };
  else if (lower.includes("kickoff return") || lower.includes("kick return")) how = { kind: "kickoffReturn" };
  else if (lower.includes("field goal")) how = { kind: "fieldGoal" };
  else how = { kind: "other", words: lower };
  return { who: match[1]!, yards: Number(match[2]), how, passer, attempt };
}

/** "(Jake Elliott Kick)", "(Kick Failed)", "(Dak Prescott Run for Two-Point Conversion)", "(Two-Point Pass Conversion Failed)". */
export function footballAttempt(text: string): FootballTry | null {
  const lower = text.toLowerCase();
  const failed = lower.includes("fail") || lower.includes("no good") || lower.includes("blocked") || lower.includes("missed");
  if (lower.includes("two-point") || lower.includes("two point") || lower.includes("2-pt")) return { kind: "twoPoint", good: !failed, pass: lower.includes("pass") };
  if (lower.includes("kick") || lower.includes("pat") || lower.includes("extra point")) return { kind: "kick", good: !failed };
  return null;
}

/** "D. Pierce 5-yd run", "C. Lamb 16-yd pass from D. Prescott", "B. Aubrey from 55 yards". */
export function footballLine(play: FootballPlay): string | null {
  const { who, yards, how } = play;
  if (who == null || yards == null || how == null) return null;
  const name = initialed(who);
  switch (how.kind) {
    case "run":
      return `${name} ${yards}-yd run`;
    case "pass":
      return `${name} ${yards}-yd pass${play.passer != null ? ` from ${initialed(play.passer)}` : ""}`;
    case "interception":
      return `${name} ${yards}-yd interception return`;
    case "fumble":
      return `${name} ${yards}-yd fumble return`;
    case "puntReturn":
      return `${name} ${yards}-yd punt return`;
    case "kickoffReturn":
      return `${name} ${yards}-yd kickoff return`;
    case "fieldGoal":
      return `${name} from ${yards} yards`;
    case "other":
      return `${name} ${yards}-yd ${how.words}`;
  }
}

/** The try in the NFL's words: "PAT good", "PAT no good", "2-pt conversion good" (or no good); null until the try is in. */
export function tryLine(attempt: FootballTry | null): string | null {
  if (!attempt) return null;
  if (attempt.kind === "kick") return attempt.good ? "PAT good" : "PAT no good";
  return attempt.good ? "2-pt conversion good" : "2-pt conversion no good";
}

export function trySpoken(attempt: FootballTry | null): string | null {
  if (!attempt) return null;
  if (attempt.kind === "kick") return attempt.good ? "extra point good" : "extra point no good";
  return attempt.good ? `two-point conversion good, by ${attempt.pass ? "pass" : "run"}` : "two-point conversion no good";
}

/** What the play was worth when the feed doesn't say: a touchdown and its try, a field goal, a safety. */
export function footballPoints(play: FootballPlay, kind: LiveMoment["kind"]): number {
  if (kind === "touchdown") {
    const a = play.attempt;
    if (a?.kind === "kick" && a.good) return 7;
    if (a?.kind === "twoPoint" && a.good) return 8;
    return 6;
  }
  return kind === "fieldGoal" ? 3 : 2;
}

/**
 * A goal as the slide tells it: the scorer (and, for an own goal, his team),
 * how it went in, and the assist, from the moment's caption and ESPN's
 * commentary line. (pure; tested)
 */
export interface SoccerGoal {
  readonly scorer: string;
  /** An own goal's scorer's own team. */
  readonly team: string | null;
  /** "header", "right foot", "volley", "penalty"; null when the line doesn't say. */
  readonly how: string | null;
  readonly assist: string | null;
  readonly ownGoal: boolean;
  readonly penalty: boolean;
  /**
   * An own goal's beneficiary, when the line names the scorer's team and the
   * score ("Own Goal by Mike Penders, Chelsea. Chelsea 0, Tottenham Hotspur 1."):
   * the home team is named first.
   */
  readonly beneficiary: Side | null;
}

/**
 * `caption`: the moment's ("Erling Haaland (header)", "Mike Penders (OG)",
 * "Oliver McBurnie (pen)"). `text`: "Goal! Aston Villa 1, Manchester City 1.
 * Erling Haaland (Manchester City) header from very close range … Assisted by
 * Iliman Ndiaye with a cross …".
 */
export function readSoccerGoal(caption: string, text: string | null, type: string | null): SoccerGoal {
  let scorer = caption.split(" (")[0] ?? caption;
  let team: string | null = null;
  let beneficiary: Side | null = null;
  let how: string | null = null;
  const line = text ?? "";
  const lower = line.toLowerCase();
  const ownGoal = type === "own-goal" || caption.endsWith("(OG)") || lower.startsWith("own goal");
  const penalty = type === "penalty---scored" || caption.endsWith("(pen)") || lower.includes("converts the penalty");
  const scored = ownGoal ? /Own Goal by (.+?), (.+?)\. (.+?) \d+, (.+?) \d+\./.exec(line) : null;
  const plain = ownGoal && !scored ? /Own Goal by (.+?), (.+?)\./.exec(line) : null;
  if (scored) {
    scorer = scored[1]!;
    team = scored[2]!;
    beneficiary = scored[2] === scored[3] ? "bottom" : scored[2] === scored[4] ? "top" : null;
  } else if (plain) {
    scorer = plain[1]!;
    team = plain[2]!;
  }
  if (penalty) {
    how = "penalty";
  } else if (!ownGoal) {
    switch (type) {
      case "goal---header":
        how = "header";
        break;
      case "goal---volley":
        how = "volley";
        break;
      case "goal---free-kick":
        how = "free kick";
        break;
      default:
        how = lower.includes(") header") ? "header" : lower.includes("left footed") ? "left foot" : lower.includes("right footed") ? "right foot" : null;
    }
  }
  const assisted = /Assisted by (.+?)(?: with | following |\.|$)/.exec(line);
  return { scorer, team, how, assist: assisted ? assisted[1]! : null, ownGoal, penalty, beneficiary };
}

// MARK: Small words the slides share

/** "Dameon Pierce" → "D. Pierce"; a single name stays as it is. */
export function initialed(name: string): string {
  const words = name.split(" ").filter((w) => w.length > 0);
  const first = [...(words[0] ?? "")][0];
  if (words.length <= 1 || first == null) return name;
  return `${first}. ${words.slice(1).join(" ")}`;
}

/** The minute as soccer writes it: "37'", stoppage time "90+3'" (ESPN sends "90'+3'"). */
export function minuteMark(clock: string | null): string | null {
  if (!clock) return null;
  const mark = clock.replaceAll("'+", "+");
  return mark.endsWith("'") || !/\d/.test(mark) ? mark : `${mark}'`;
}

/** "52'" → "52nd minute"; stoppage time ("90+3'") as the minute it is (93rd). */
export function spokenMinute(clock: string | null): string | null {
  if (clock == null) return null;
  const numbers = clock.split(/\D+/).filter((s) => s.length > 0).map(Number);
  if (numbers.length === 0) return null;
  return `${ordinal(numbers.reduce((a, b) => a + b, 0))} minute`;
}

// MARK: - Paint

/**
 * The slab's paint: the team's own color (its second when the first is too
 * dark or too light to read as a color), white or black type on it,
 * whichever reads, and the wipe's stripe in the other color. Colors are
 * moved in OKLab, so only lightness changes and the team stays itself.
 * (pure; tested)
 */
export interface SlidePaint {
  readonly slab: OKLab;
  readonly stripe: OKLab;
  /** White type: the slab is dark (and logos take their dark-background variant). */
  readonly lightInk: boolean;
}

const gray = (l: number): OKLab => ({ l, a: 0, b: 0 });
const lch = (l: number, c: number, h: number): OKLab => ({ l, a: c * Math.cos((h * Math.PI) / 180), b: c * Math.sin((h * Math.PI) / 180) });
export const labDistance = (x: OKLab, y: OKLab) => Math.hypot(x.l - y.l, x.a - y.a, x.b - y.b);
/** Near black or near white, with no hue to speak of. */
const neutral = (lab: OKLab) => chroma(lab) < 0.04 && (lab.l < 0.25 || lab.l > 0.93);
/** A color with a hue (not white, black or gray). */
const real = (lab: OKLab) => chroma(lab) >= 0.05;

export function teamPaint(hex: string | null, alternate: string | null): SlidePaint {
  const own = oklabFromHex(hex);
  const second = oklabFromHex(alternate);
  let slab = own ?? lch(0.56, 0.16, 255);
  let stripe: OKLab | null = second;
  if (neutral(slab) && second && real(second)) {
    // Black or white with a real second color: wear the second, keep the first as the stripe.
    stripe = slab;
    slab = second;
  }
  if (neutral(slab)) {
    // Still black or white: charcoal, or white with dark type.
    slab = slab.l < 0.5 ? gray(0.27) : gray(0.97);
  } else {
    // Dark enough to read as the color on a dark panel, never past pale.
    slab = lch(Math.min(Math.max(slab.l, 0.32), 0.92), chroma(slab), hue(slab));
  }
  const ink = lightInk(slab);
  if (!stripe || labDistance(stripe, slab) < 0.12) stripe = ink ? gray(0.98) : gray(0.18);
  return { slab, stripe, lightInk: ink };
}

/** A climber's: the flag's two colors (white for a one-color flag's stripe). */
export function flagPaint(ioc: string | null): SlidePaint {
  const pair = ioc ? FLAG_PALETTE[ioc] : undefined;
  const first = pair ? oklabFromHex(pair[0]) : null;
  const second = pair ? oklabFromHex(pair[1]) : null;
  if (!first || !second) return teamPaint(null, null);
  return { slab: first, stripe: labDistance(second, first) < 0.12 ? gray(0.98) : second, lightInk: lightInk(first) };
}

/** WCAG relative luminance of an OKLab color. */
export function luminanceOf(lab: OKLab): number {
  const [r, g, b] = toRGB(lab);
  const linear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** The ink's luminance: white, or the near-black of `Color(white: 0.08)`. */
const INK_DARK = 0.08;
const inkLuminance = (light: boolean) => (light ? 1 : (INK_DARK <= 0.04045 ? INK_DARK / 12.92 : ((INK_DARK + 0.055) / 1.055) ** 2.4));

/** WCAG contrast of white and of near-black type on the slab: white when it reaches 4:1 (the headline is large type) or beats black. */
export function lightInk(slab: OKLab): boolean {
  const luminance = luminanceOf(slab);
  const white = 1.05 / (luminance + 0.05);
  const black = (luminance + 0.05) / 0.05;
  return white >= 4 || white > black;
}

/** The type's contrast on the slab (WCAG). */
export function inkContrast(p: SlidePaint): number {
  const slab = luminanceOf(p.slab);
  const ink = inkLuminance(p.lightInk);
  return (Math.max(slab, ink) + 0.05) / (Math.min(slab, ink) + 0.05);
}

/**
 * How strongly the small type (the tally's other row at 0.55) is inked: the
 * softer ink asked for where it still clears 4.5:1 on the slab, else the
 * next step up (0.7, 0.86) that does, else full. A web addition: its small
 * type is held to the page's text contrast.
 */
export function smallInk(p: SlidePaint, alpha: number): number {
  const slab = toRGB(p.slab);
  // The ink at `alpha` over the slab, composited as the page does (in sRGB): white, or #141414.
  const ink = p.lightInk ? 1 : 20 / 255;
  const back = srgbLuminance(slab);
  const clears = (a: number) => {
    const mixed = srgbLuminance(slab.map((c) => ink * a + c * (1 - a)));
    return (Math.max(back, mixed) + 0.05) / (Math.min(back, mixed) + 0.05) >= 4.5;
  };
  return [alpha, 0.7, 0.86].find((a) => a >= alpha && clears(a)) ?? 1;
}

const linearOf = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const srgbLuminance = (rgb: readonly number[]) => 0.2126 * linearOf(rgb[0]!) + 0.7152 * linearOf(rgb[1]!) + 0.0722 * linearOf(rgb[2]!);
const contrast = (x: number, y: number) => (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);

/** The dark ink, #141414 (`Color(white: 0.08)`). */
const NEAR_BLACK: OKLab = oklabFromHex("141414") ?? gray(0.19);

/**
 * The type on the second color (the kicker tab and the chip): the slab's own
 * color where it reads there (4.5:1, the kicker being small type), else
 * near-black or white, whichever reads better. (pure; tested)
 */
export function kickerInk(p: SlidePaint): OKLab {
  const back = luminanceOf(p.stripe);
  if (contrast(back, luminanceOf(p.slab)) >= 4.5) return p.slab;
  return contrast(back, inkLuminance(false)) >= contrast(back, 1) ? NEAR_BLACK : gray(1);
}

/** The same color, lighter (or darker, negative), its hue and chroma kept. */
export const lifted = (lab: OKLab, by: number): OKLab => ({ l: Math.min(Math.max(lab.l + by, 0), 1), a: lab.a, b: lab.b });

// MARK: - Timing

/** The wipe starts this long before the theater's climax, so it lands with it (seconds). */
export const CLIMAX_LEAD = 0.2;

/** A baseball replay's climax: the ball clearing the fence, else the first runner home. */
export function playClimax(script: { readonly fence: { readonly at: number } | null; readonly flashes: readonly { readonly beat: string; readonly at: number }[] }): number | null {
  return script.fence?.at ?? script.flashes.find((f) => f.beat === "run")?.at ?? null;
}

/** Football: the ball crossing the goal line (or over the crossbar). */
export function footballClimax(script: { readonly score: number | null }): number | null {
  return script.score;
}

/** Soccer: the ball hitting the net. */
export function soccerClimax(script: { readonly impacts: readonly { readonly kind: string; readonly at: number }[] }): number | null {
  return script.impacts.find((i) => i.kind === "net")?.at ?? null;
}

/** Basketball: the ball through the net (the court theater's script, once the web has it). */
export function basketballClimax(script: { readonly score: number | null }): number | null {
  return script.score;
}

/** From the theater's replay starting to the wipe starting (seconds). */
export function slideLead(climax: number | null): number {
  return Math.max((climax ?? 0) - CLIMAX_LEAD, 0);
}

// MARK: - Who bursts

/**
 * Whether a top-tier slide plays the page's confetti for its moment. One
 * burst per moment, where it's seen: the theater or chart that owns the
 * moment plays the burst the page granted it when it's on screen; otherwise
 * the slide does. A moment no chart bursts for (a CS2 match won) claims the
 * page's cooldown for the slide. (pure; tested)
 */
export function playsConfetti(tier: SlideTier, granted: boolean, pageBursts: boolean, ownerVisible: boolean, claim: () => boolean): boolean {
  if (tier !== SlideTier.top) return false;
  if (granted) return !ownerVisible;
  return !pageBursts && claim();
}

// MARK: - The line

/**
 * The slides waiting their turn, in the order their scores happened: one on
 * screen at a time, a catch-up only its newest (old news by the time it
 * lands), at most three waiting, and never the same play twice. (pure; tested)
 */
export class SlideLine {
  static readonly capacity = 3;
  private queue: ScoringSlide[] = [];
  /** Every ID offered, so an edited play offered again never slides twice. */
  private taken = new Set<string>();

  get waiting(): readonly ScoringSlide[] {
    return this.queue;
  }

  /** One update's slides, in play order. Returns those that joined. */
  offer(slides: readonly ScoringSlide[], catchUp: boolean): ScoringSlide[] {
    const fresh = slides.filter((s) => !this.taken.has(s.id));
    for (const s of fresh) this.taken.add(s.id);
    let joining: ScoringSlide[] = fresh;
    if (catchUp) {
      const pick = fresh.findLast((s) => s.tier === SlideTier.top) ?? fresh.at(-1);
      joining = pick ? [pick] : [];
    }
    this.queue.push(...joining);
    // Too many: the oldest that isn't top tier gives way.
    while (this.queue.length > SlideLine.capacity) {
      const i = this.queue.findIndex((s) => s.tier < SlideTier.top);
      this.queue.splice(i >= 0 ? i : 0, 1);
    }
    return joining.filter((s) => this.queue.some((w) => w.id === s.id));
  }

  get first(): ScoringSlide | null {
    return this.queue[0] ?? null;
  }

  next(): ScoringSlide | null {
    return this.queue.shift() ?? null;
  }

  retract(ids: ReadonlySet<string>): void {
    this.queue = this.queue.filter((s) => !ids.has(s.id));
  }

  /** Nobody's waiting any more (the page went away); what was offered stays offered. */
  drain(): void {
    this.queue = [];
  }

  carries(id: string): boolean {
    return this.taken.has(id);
  }
}

// MARK: - Motion

/**
 * The lower third's motion, layer by layer (ScoringSlideView.swift): each
 * move a window of seconds from the slide starting and its curve. In: the
 * kicker, the slab and the detail strip from off their entering edge, one
 * after another; the logo pops; the headline and the subline are revealed
 * behind an edge on the type's own lean; the tally rises; the chip pops; one
 * sheen crosses the slab. Nothing moves during the hold. Out: the detail
 * strip first, then the slab, then the kicker, back the way they came, the
 * chip fading as they go. Reduce Motion crossfades it. (pure; tested)
 */
export type SlideLayer = "kicker" | "slab" | "detail" | "logo" | "headline" | "subline" | "tally" | "chip" | "sheen";

export type SlideCurve = "out" | "away" | "pop" | "sweep";

/** One layer's move: from `at` to `until` seconds, on its curve. */
export interface SlideBeat {
  readonly at: number;
  readonly until: number;
  readonly curve: SlideCurve;
}

/** The curves' control points (CSS `cubic-bezier`): a crisp ease-out, leaving, a pop with a little overshoot, a band across. */
export const SLIDE_CURVES: Readonly<Record<SlideCurve, readonly [number, number, number, number]>> = {
  out: [0.23, 1, 0.32, 1],
  away: [0.55, 0, 0.85, 0.36],
  pop: [0.34, 1.5, 0.64, 1],
  sweep: [0.42, 0, 0.58, 1],
};

const CURVES: Readonly<Record<SlideCurve, (x: number) => number>> = {
  out: bezier(...SLIDE_CURVES.out),
  away: bezier(...SLIDE_CURVES.away),
  pop: bezier(...SLIDE_CURVES.pop),
  sweep: bezier(...SLIDE_CURVES.sweep),
};

/** In, from the slide starting. */
export const SLIDE_IN: Readonly<Record<SlideLayer, SlideBeat>> = {
  kicker: { at: 0, until: 0.26, curve: "out" },
  slab: { at: 0.05, until: 0.44, curve: "out" },
  detail: { at: 0.12, until: 0.5, curve: "out" },
  logo: { at: 0.22, until: 0.52, curve: "pop" },
  headline: { at: 0.24, until: 0.56, curve: "out" },
  subline: { at: 0.3, until: 0.64, curve: "out" },
  tally: { at: 0.36, until: 0.6, curve: "out" },
  chip: { at: 0.44, until: 0.7, curve: "pop" },
  sheen: { at: 0.34, until: 1.05, curve: "sweep" },
};

/** Out, from the exit starting. The slab's logo, type, tally and sheen ride out with it, and the subline with its strip. */
export const SLIDE_OUT: Readonly<Partial<Record<SlideLayer, SlideBeat>>> = {
  detail: { at: 0, until: 0.28, curve: "away" },
  slab: { at: 0.04, until: 0.32, curve: "away" },
  kicker: { at: 0.08, until: 0.36, curve: "away" },
  chip: { at: 0, until: 0.12, curve: "away" },
};

export const SlideMotion = {
  /** Everything has landed (the chip's pop is the last): the hold counts from here, as on the Mac. */
  land: 0.7,
  /** The exit, start to gone (the kicker leaves last, by 0.36 s). */
  exitLength: 0.38,
  /** The spark and the confetti fly at the logo as it pops. */
  burstAt: 0.3,
  /** Reduce Motion's crossfade, in and out. */
  fadeIn: 0.25,
  fadeOut: 0.2,
  /** The hero's scoreboard steps aside as the slide comes in, and comes back once it has gone. */
  heroOut: 0.18,
  heroBack: 0.25,
} as const;

/** Where each layer is at one instant: 0 off (or not yet revealed), 1 home; `opacity` is Reduce Motion's crossfade. */
export type SlidePose = Readonly<Record<SlideLayer | "opacity", number>>;

const LAYERS = Object.keys(SLIDE_IN) as SlideLayer[];
const posed = (value: (layer: SlideLayer) => number, opacity: number): SlidePose =>
  Object.fromEntries([...LAYERS.map((l) => [l, value(l)] as const), ["opacity", opacity] as const]) as SlidePose;

export const POSE_OFF: SlidePose = posed(() => 0, 1);
export const POSE_HOME: SlidePose = posed(() => 1, 1);

/** How far along a beat is at t: 0 before it, 1 after, on its curve between. */
export function beatAt(beat: SlideBeat, t: number): number {
  if (t <= beat.at) return 0;
  if (t >= beat.until) return 1;
  return CURVES[beat.curve]((t - beat.at) / (beat.until - beat.at));
}

/** The pose `t` seconds after the slide began: in, the hold (still), then out. */
export function slidePose(t: number, hold: number, reduceMotion: boolean): SlidePose {
  const out = SlideMotion.land + hold;
  const leaving = t >= out;
  if (reduceMotion) {
    const opacity = leaving ? 1 - houseCurve(Math.min((t - out) / SlideMotion.fadeOut, 1)) : houseCurve(Math.min(Math.max(t, 0) / SlideMotion.fadeIn, 1));
    return posed(() => 1, opacity);
  }
  return posed((l) => {
    if (!leaving) return beatAt(SLIDE_IN[l], t);
    const away = SLIDE_OUT[l];
    return away ? 1 - beatAt(away, t - out) : 1;
  }, 1);
}

/** Seconds from a slide beginning to its exit being done. */
export const slideLength = (hold: number) => SlideMotion.land + hold + SlideMotion.exitLength;

// MARK: - Metrics

/**
 * The lower third's sizes by the page's width class (pt): the kicker tab's,
 * the slab's and the detail strip's heights and the headline's size;
 * everything else (the logo and its zone, the tally, the chip, the insets)
 * scales with the slab from the medium width's, the mockup's 54.
 */
export interface SlideMetrics {
  readonly kicker: number;
  readonly slab: number;
  readonly detail: number;
  readonly headline: number;
  readonly scale: number;
}

const metrics = (kicker: number, slab: number, detail: number, headline: number): SlideMetrics => ({ kicker, slab, detail, headline, scale: slab / 54 });

export const SLIDE_METRICS: Readonly<Record<"compact" | "medium" | "large" | "xlarge", SlideMetrics>> = {
  compact: metrics(18, 48, 19, 36),
  medium: metrics(20, 54, 21, 42),
  large: metrics(21, 58, 22, 46),
  xlarge: metrics(22, 62, 23, 50),
};

/** The page's width class from its width in points (the Mac's thresholds: 380, 460, 560). */
export function slideMetrics(pageWidth: number): SlideMetrics {
  return pageWidth >= 560 ? SLIDE_METRICS.xlarge : pageWidth >= 460 ? SLIDE_METRICS.large : pageWidth >= 380 ? SLIDE_METRICS.medium : SLIDE_METRICS.compact;
}

/** The graphic's height: the kicker, the slab and the detail strip stacked. */
export const slideHeight = (m: SlideMetrics) => m.kicker + m.slab + m.detail;

/** The italic's lean (SF Pro Italic: 12°): every slanted edge and every reveal runs this far across per point of height. */
export const SLIDE_LEAN = Math.tan((12 * Math.PI) / 180);

/** The slab reaches at most this far from its entering edge (pt): a lower third, not a banner. */
export const SLAB_MAX = 560;

/** Logos are drawn at one size and scaled, so one decode serves every width (pt). */
export const LOGO_BASE = 58;
