/**
 * Everything the ballpark theater shows between balls in play (PlayBeat.swift),
 * so a live game never looks frozen: every pitch (its call, and its real
 * flight where MLB tracked it), a throw over, a mound visit, a pitching
 * change, a pinch hitter, the teams changing sides, a challenge, a delay.
 * Each is a beat in the game's timeline, between the replays of its plays.
 *
 * ESPN's play-by-play sets the order, as the rest of the page has it: each
 * pitch as it posts, a runner's play, the at-bat's result, the end of a half.
 * MLB's feed fills in what ESPN doesn't carry, matched by half-inning, batter
 * and pitch number: a pitch's measured flight and its exact call (a foul tip,
 * a ball in the dirt), and what came between pitches (a mound visit, a throw
 * over, who came in, a challenge and how it came out, an injury delay), each
 * placed where it happened among ESPN's pitches. The pitch that ends an
 * at-bat is its play's (the replay throws it), and a runner's play is ESPN's
 * result too, so nothing is shown twice. Pure values, parsed from real games;
 * the choreography is playBeatScript.ts's.
 *
 *     const line = timeline(plays, atBats, names);   // [batterUp, pitch, pitch, play, inningBreak, …]
 *     beatTag(line[1], true);                        // "STRIKE 2 · 97 MPH FOUR-SEAM FASTBALL"
 */
import { PITCH_OFFICIAL } from "../gameDetail";
import { at, num, str } from "../json";
import { ordinal } from "../format";
import { PITCH_NAMES, bases as basesOf, halfInning, hand, participant, surname, type Hand } from "./playScene";
import { isAction, isPitchEvent, isPitchReview, type PlayEvent, type Review, type StatcastAtBat, type StatcastPitch } from "./statcast";

/** A pitch's call. */
export type Call =
  | "ball"
  | "calledStrike"
  | "swingingStrike"
  | "foul"
  | "foulTip"
  | "foulBunt"
  | "missedBunt"
  /** A ball in the dirt the catcher blocks; a swinging strike in it. */
  | "ballInDirt"
  | "swingingBlocked"
  /** A pitch-clock violation: no pitch thrown. */
  | "automaticBall"
  | "automaticStrike";

/** A pitch that didn't end the at-bat. */
export interface BeatPitch {
  readonly call: Call;
  /** Which pitch of the at-bat. */
  readonly number: number;
  /** The count after it. */
  readonly balls: number;
  readonly strikes: number;
  /** "FF", and its speed (mph). */
  readonly code: string | null;
  readonly mph: number | null;
  /** ESPN's pitch coordinates (the strike zone chart's: zone ≈ x 91…141, y 148…192). */
  readonly x: number | null;
  readonly y: number | null;
  /** The flight as MLB tracked it. */
  readonly flight: StatcastPitch | null;
  /** A challenge of its call (the automated zone). */
  readonly review: Review | null;
}

export const swung = (p: BeatPitch) => p.call === "swingingStrike" || p.call === "swingingBlocked" || p.call === "foul" || p.call === "foulTip";
export const bunted = (p: BeatPitch) => p.call === "foulBunt" || p.call === "missedBunt";
export const thrown = (p: BeatPitch) => p.call !== "automaticBall" && p.call !== "automaticStrike";

/** Who came in, or moved. */
export interface Change {
  readonly role: "pinchHitter" | "pinchRunner" | "defensive" | "moves";
  /** "Mesa Jr." (the surname, as the tag has it). */
  readonly name: string | null;
  /** The position he takes, by scorer's number (1: pitcher … 9: right field). */
  readonly position: number | null;
  /** A pinch runner's base. */
  readonly base: number | null;
}

/** Who's hurt: where the trainer goes. */
export type Hurt = "batter" | "pitcher" | "elsewhere";

export type Delay =
  | { readonly kind: "injury"; readonly hurt: Hurt }
  | { readonly kind: "onField" }
  /** "Rain", "Inclement Weather". */
  | { readonly kind: "weather"; readonly why: string }
  /** A delay that's ending, and the end of one. */
  | { readonly kind: "resuming" }
  | { readonly kind: "over" };

export type BeatKind =
  /** A play replayed from its scene (the at-bat's result, a runner's play): `TheaterState.play` when it's the newest. */
  | { readonly kind: "play" }
  | { readonly kind: "pitch"; readonly pitch: BeatPitch }
  /** The batter steps in (a pinch hitter, said so). */
  | { readonly kind: "batterUp"; readonly name: string | null; readonly pinch: boolean }
  /** A throw over to a base, the pitcher's (or the catcher's after a pitch). */
  | { readonly kind: "pickoff"; readonly base: number; readonly catcher: boolean }
  | { readonly kind: "stepOff" }
  /** The batter steps out. */
  | { readonly kind: "timeout" }
  /** The catcher, or the pitching coach (or the manager, come to make a change). */
  | { readonly kind: "moundVisit"; readonly coach: boolean }
  | { readonly kind: "pitchingChange"; readonly reliever: string | null }
  | { readonly kind: "substitution"; readonly change: Change }
  /** The end of a half: the middle of the inning or its end. */
  | { readonly kind: "inningBreak"; readonly middle: boolean; readonly inning: number }
  | { readonly kind: "review"; readonly review: Review }
  | { readonly kind: "delay"; readonly delay: Delay };

export interface PlayBeat {
  readonly id: string;
  readonly kind: BeatKind;
  readonly bats: Hand | null;
  readonly arm: Hand | null;
  /** The half-inning, and the team at bat in it (MLB's visitors bat in the top). */
  readonly inning: number | null;
  readonly top: boolean | null;
  /** The game after it: the count and the outs. */
  readonly balls: number;
  readonly strikes: number;
  readonly outs: number;
  readonly wallclock: number | null;
  /** Who's on (first, second, third) as it happens (null: ESPN didn't say). */
  readonly bases: readonly boolean[] | null;
  /** Arrived while the page was open: shown as it comes. Otherwise it's history. */
  readonly news: boolean;
}

function beatOf(id: string, kind: BeatKind, fields: Partial<Omit<PlayBeat, "id" | "kind">> = {}): PlayBeat {
  return { id, kind, bats: null, arm: null, inning: null, top: null, balls: 0, strikes: 0, outs: 0, wallclock: null, bases: null, news: false, ...fields };
}

export const isPlayBeat = (b: PlayBeat) => b.kind.kind === "play";
export const beatPitch = (b: PlayBeat | null | undefined): BeatPitch | null => (b && b.kind.kind === "pitch" ? b.kind.pitch : null);
export const batting = (b: PlayBeat): "top" | "bottom" | null => (b.top == null ? null : b.top ? "top" : "bottom");

/** A stoppage: it stands until the next thing happens, and the tag says so. */
export function stands(b: PlayBeat): boolean {
  switch (b.kind.kind) {
    case "moundVisit":
    case "pitchingChange":
    case "substitution":
    case "inningBreak":
    case "review":
      return true;
    case "delay":
      return b.kind.delay.kind !== "over";
    default:
      return false;
  }
}

/** FNV-1a: stable across loads (a number from the beat's ID: what varies where the data is silent). */
export function seedOf(s: string): bigint {
  let h = 0xcbf29ce484222325n;
  const bytes = new TextEncoder().encode(s);
  for (const b of bytes) h = ((h ^ BigInt(b)) * 0x100000001b3n) & 0xffffffffffffffffn;
  return h;
}

// MARK: - The timeline

/**
 * The game in order from ESPN's plays: each pitch, the batter stepping in,
 * each play (a marker: its scene is the theater's), the end of each half;
 * and MLB's events placed among them, matched by half-inning, batter and
 * pitch number. Without MLB (or before it has the at-bat), ESPN's alone: its
 * pitches, a new pitcher from who's pitching, the challenge in a pitch's
 * type. (pure; tested)
 */
export function timeline(window: readonly unknown[], mlb: readonly StatcastAtBat[], names: Readonly<Record<string, string>>): PlayBeat[] {
  const out: PlayBeat[] = [];
  const emitted = new Set<string>();
  const emit = (beat: PlayBeat) => {
    if (emitted.has(beat.id)) return;
    emitted.add(beat.id);
    out.push(beat);
  };
  // Each half's pitcher, as ESPN names him: a new one is a change (when MLB hasn't said).
  const pitchers = new Map<boolean, string>();
  // The at-bat under way: ESPN's, MLB's, how far its pitches have come.
  let atBat: string | null = null;
  let matched: StatcastAtBat | null = null;
  let lastPitch = 0;
  let balls = 0;
  let strikes = 0;
  // The outs as the half stands (ESPN's own field on a pitch is the outs after the at-bat).
  let outs = 0;
  // Who's on, as ESPN's entries list the runners (each pitch's as it's thrown, a result's after it).
  let bases: boolean[] | null = null;
  const occurrences = occurrencesOf(window, names);

  const topOf = (e: unknown): boolean | null => {
    const t = str(at(e, "period", "type"));
    return t == null ? null : t.toLowerCase().startsWith("top");
  };
  const base = (e: unknown, id: string, kind: BeatKind): PlayBeat => {
    const arm = str(at(e, "pitches", "abbreviation"));
    const wall = str(at(e, "wallclock"));
    const time = wall != null ? Date.parse(wall) : NaN;
    return beatOf(id, kind, {
      bats: hand(e),
      arm: arm === "L" || arm === "R" ? arm : null,
      inning: intOf(at(e, "period", "number")),
      top: topOf(e),
      balls,
      strikes,
      outs,
      wallclock: Number.isFinite(time) ? time : null,
      bases: kind.kind === "play" ? null : bases,
    });
  };
  const changed = () => matched?.events?.some((e) => isAction(e, "pitching_substitution")) === true;
  /** MLB's events in the at-bat up to (not including) its pitch `number`. */
  const mlbEvents = (number: number) => {
    const m = matched;
    if (!m) return;
    const events = m.events ?? [];
    const cut = events.find((e) => isPitchEvent(e) && e.pitchNumber === number)?.index ?? null;
    for (const e of events) {
      if (isPitchEvent(e) || (cut != null && !(e.index < cut))) continue;
      const beat = mlbBeat(e, m);
      if (!beat || beat.kind.kind === "batterUp") continue;
      emit({ ...beat, bases });
    }
  };

  for (const e of window) {
    const type = str(at(e, "type", "type")) ?? "";
    const id = str(at(e, "id")) ?? "";
    const entryAtBat = str(at(e, "atBatId")) ?? null;
    if (participant(e, "pitcher") != null) {
      const on = basesOf(e);
      bases = [1, 2, 3].map((b) => on.has(b));
    }
    if (type === "end-inning" || type === "start-inning") {
      bases = [false, false, false];
      outs = 0;
    }
    // A play's outs are the outs after it.
    if (type === "play-result") outs = intOf(at(e, "outs")) ?? outs;
    if (type === "start-batterpitcher") {
      const pitcher = participant(e, "pitcher");
      const half = topOf(e) ?? true;
      if (entryAtBat !== atBat) {
        atBat = entryAtBat;
        lastPitch = 0;
        balls = 0;
        strikes = 0;
        matched = matchAtBat(e, names, occurrences, mlb);
      }
      // ESPN's own word on a new pitcher, when MLB hasn't said.
      const before = pitchers.get(half);
      if (pitcher != null && before != null && before !== pitcher && !changed()) {
        const name = names[pitcher];
        emit(base(e, `${id}.change`, { kind: "pitchingChange", reliever: name != null ? surname(name) : null }));
      }
      if (pitcher != null) pitchers.set(half, pitcher);
      const events = matched?.events ?? [];
      const firstPitch = events.find(isPitchEvent)?.index ?? Infinity;
      const pinch = events.some((x) => isAction(x, "offensive_substitution") && x.position === "PH" && x.index < firstPitch);
      mlbEvents(1);
      const batter = participant(e, "batter");
      const name = batter != null ? names[batter] : undefined;
      emit(base(e, id, { kind: "batterUp", name: name != null ? surname(name) : null, pinch }));
    } else if (type === "play-result") {
      // An at-bat's result: the next starts from nothing (a runner's play leaves the count as it was).
      const result = participant(e, "batter") != null;
      if (result) {
        balls = 0;
        strikes = 0;
      }
      emit(base(e, id, { kind: "play" }));
      // A manager's challenge of the result, and how it came out.
      const r = matched?.review;
      if (result && r && !isPitchReview(r)) emit(base(e, `${id}.review`, { kind: "review", review: r }));
    } else if (type === "end-inning") {
      // ESPN's half here is "Mid" (the top's over) or "End".
      const inning = intOf(at(e, "period", "number"));
      if (inning == null) continue;
      const half = (str(at(e, "period", "type")) ?? "").toLowerCase();
      emit({ ...base(e, id, { kind: "inningBreak", middle: half.startsWith("mid") || half.startsWith("top"), inning }), outs: 3 });
    } else {
      if (!(str(at(e, "summaryType")) === "P" || (str(at(e, "text")) ?? "").startsWith("Pitch"))) continue;
      if (entryAtBat !== atBat) {
        // Pitches with no start in the window: the at-bat's still this one.
        atBat = entryAtBat;
        lastPitch = 0;
        matched = matchAtBat(e, names, occurrences, mlb);
      }
      const number = intOf(at(e, "atBatPitchNumber")) ?? lastPitch + 1;
      mlbEvents(number);
      // A new pitcher mid-at-bat, by ESPN's word.
      const half = topOf(e) ?? true;
      const pitcher = participant(e, "pitcher");
      if (pitcher != null) {
        const before = pitchers.get(half);
        if (before != null && before !== pitcher && !changed()) {
          const name = names[pitcher];
          emit(base(e, `${id}.change`, { kind: "pitchingChange", reliever: name != null ? surname(name) : null }));
        }
        pitchers.set(half, pitcher);
      }
      lastPitch = number;
      // ESPN's count after the pitch (its `pitchCount` is the count it was thrown on).
      const b = intOf(at(e, "resultCount", "balls"));
      const s = intOf(at(e, "resultCount", "strikes"));
      if (b != null && s != null) {
        balls = b;
        strikes = s;
      }
      const p = pitchOf(e, number, matched);
      if (!p) continue;
      balls = p.balls;
      strikes = p.strikes;
      emit(base(e, id, { kind: "pitch", pitch: p }));
    }
  }
  // The at-bat under way: what MLB has after ESPN's last pitch, up to its next one (still in order).
  if (matched) mlbEvents(lastPitch + 1);
  return out;
}

function intOf(v: unknown): number | null {
  const n = num(v);
  return n != null ? Math.trunc(n) : null;
}

/**
 * Each at-bat's trip number in its half, counted back from the half's last
 * in the window (MLB's feed has them all): the newest is his latest,
 * whatever the window has cut off before it.
 */
export function occurrencesOf(window: readonly unknown[], names: Readonly<Record<string, string>>): Map<string, number> {
  void names;
  const seen = new Map<string, number>();
  const out = new Map<string, number>();
  for (let i = window.length - 1; i >= 0; i--) {
    const e = window[i];
    if (str(at(e, "type", "type")) !== "start-batterpitcher") continue;
    const id = str(at(e, "atBatId"));
    const batter = participant(e, "batter");
    if (id == null || out.has(id) || batter == null) continue;
    const key = halfInning(e) + batter;
    out.set(id, -(seen.get(key) ?? 0) - 1);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return out;
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replaceAll(".", "")
    .trim();

/** MLB's at-bat for ESPN's: the same half, the batter by surname, his nth trip counted back from his latest. */
export function matchAtBat(e: unknown, names: Readonly<Record<string, string>>, occurrences: ReadonlyMap<string, number>, mlb: readonly StatcastAtBat[]): StatcastAtBat | null {
  const inning = intOf(at(e, "period", "number"));
  const batter = participant(e, "batter");
  const short = batter != null ? names[batter] : undefined;
  if (inning == null || short == null) return null;
  const name = fold(surname(short));
  const top = (str(at(e, "period", "type")) ?? "").toLowerCase().startsWith("top");
  const theirs = mlb.filter((a) => a.inning === inning && a.top === top && fold(a.batter).endsWith(name));
  const id = str(at(e, "atBatId"));
  const back = (id != null ? occurrences.get(id) : undefined) ?? -1;
  return theirs[theirs.length + back] ?? null;
}

/**
 * ESPN's pitch with MLB's (by number), when it didn't end the at-bat: the
 * call (MLB's exact code over ESPN's type), the count after it, the type and
 * speed, the plate location, the measured flight, a challenge. Null for the
 * at-bat's last pitch (its play throws it). (pure; tested)
 */
export function pitchOf(e: unknown, number: number, mlb: StatcastAtBat | null): BeatPitch | null {
  const type = str(at(e, "type", "type")) ?? "";
  const m = mlb?.events?.find((x) => isPitchEvent(x) && x.pitchNumber === number) ?? null;
  const ESPN_CALLS: Readonly<Record<string, Call>> = {
    ball: "ball",
    "intentional-ball": "ball",
    pitchout: "ball",
    "strike-looking": "calledStrike",
    "strike-swinging": "swingingStrike",
    "foul-ball": "foul",
    "foul-tip": "foulTip",
    "bunted-foul": "foulBunt",
    "foul-bunt": "foulBunt",
    "missed-bunt": "missedBunt",
  };
  let call: Call | null = ESPN_CALLS[type.split("---")[0] ?? type] ?? null;
  if (m) {
    if (m.kind.kind === "pitch") {
      const MLB_CALLS: Readonly<Record<string, Call>> = {
        B: "ball",
        P: "ball",
        I: "ball",
        "*B": "ballInDirt",
        C: "calledStrike",
        S: "swingingStrike",
        Q: "swingingStrike",
        W: "swingingBlocked",
        F: "foul",
        R: "foul",
        T: "foulTip",
        L: "foulBunt",
        M: "missedBunt",
      };
      // In play or a hit batter: the play's.
      const mapped = MLB_CALLS[m.kind.code];
      if (!mapped) return null;
      call = mapped;
    } else if (m.kind.kind === "automatic") {
      call = m.kind.ball ? "automaticBall" : "automaticStrike";
    }
  }
  if (!call) return null;
  const balls = intOf(at(e, "resultCount", "balls")) ?? m?.balls ?? 0;
  const strikes = intOf(at(e, "resultCount", "strikes")) ?? m?.strikes ?? 0;
  // Ball four or strike three ends it: the play's.
  if (balls >= 4 || strikes >= 3) return null;
  let r = m?.review ?? null;
  if (r == null && (type.endsWith("---overturned") || type.endsWith("---confirmed"))) {
    r = { overturned: type.endsWith("---overturned"), inProgress: false, type: "MJ", challenger: null, team: null };
  }
  return {
    call,
    number,
    balls,
    strikes,
    code: m?.type ?? str(at(e, "pitchType", "abbreviation")) ?? null,
    mph: m?.mph ?? num(at(e, "pitchVelocity")) ?? null,
    x: num(at(e, "pitchCoordinate", "x")) ?? null,
    y: num(at(e, "pitchCoordinate", "y")) ?? null,
    flight: m?.flight ?? null,
    review: r,
  };
}

/**
 * One of MLB's events between pitches as a beat, by its structured type;
 * names from its description. Null for what isn't one: a pitch, a runner's
 * play (ESPN's result replays it), the game's bookkeeping. (pure; tested)
 */
export function mlbBeat(e: PlayEvent, m: StatcastAtBat): PlayBeat | null {
  let kind: BeatKind;
  switch (e.kind.kind) {
    case "pitch":
    case "automatic":
      return null;
    case "pickoff":
      // An attempt (a throw that got away, or the out, is the runner's play: ESPN's).
      if (e.kind.base == null || !(e.description?.toLowerCase().includes("attempt") ?? true)) return null;
      kind = { kind: "pickoff", base: e.kind.base, catcher: e.kind.catcher };
      break;
    case "stepOff":
      kind = { kind: "stepOff" };
      break;
    case "action":
      switch (e.kind.type) {
        case "mound_visit":
          kind = { kind: "moundVisit", coach: visitByCoach(e, m) };
          break;
        case "pitching_substitution": {
          const name = nameIn(e.description);
          kind = { kind: "pitchingChange", reliever: name != null ? tagName(name) : null };
          break;
        }
        case "offensive_substitution": {
          const name = nameIn(e.description);
          kind =
            e.position === "PR"
              ? { kind: "substitution", change: { role: "pinchRunner", name: name != null ? tagName(name) : null, position: null, base: baseOf(e.replaced, m) } }
              : { kind: "batterUp", name: name != null ? tagName(name) : null, pinch: true };
          break;
        }
        case "defensive_substitution":
        case "defensive_switch": {
          // The designated hitter's bookkeeping: nobody moves on the field.
          if (e.position === "DH") return null;
          const name = nameIn(e.description);
          kind = {
            kind: "substitution",
            change: {
              role: e.kind.type === "defensive_switch" ? "moves" : "defensive",
              name: name != null ? tagName(name) : null,
              position: e.position != null ? positionOf(e.position) : null,
              base: null,
            },
          };
          break;
        }
        case "batter_timeout":
          kind = { kind: "timeout" };
          break;
        case "game_advisory": {
          const d = delayOf(e.description, e.player, m);
          if (!d) return null;
          kind = { kind: "delay", delay: d };
          break;
        }
        default:
          return null;
      }
  }
  return beatOf(`mlb.${m.index}.${e.index}`, kind, {
    bats: m.batSide ?? null,
    arm: m.pitchHand ?? null,
    inning: m.inning,
    top: m.top,
    balls: e.balls ?? 0,
    strikes: e.strikes ?? 0,
    outs: e.outs ?? 0,
    wallclock: e.start,
  });
}

/**
 * Who went out: a visit just before a change is the manager's (he's come to
 * make it); one just after, or mid-count, the catcher's (a word with the new
 * man, or about this hitter); at the start of an at-bat, the pitching
 * coach's or the catcher's (MLB doesn't say: one or the other, the same
 * every time).
 */
export function visitByCoach(e: PlayEvent, m: StatcastAtBat): boolean {
  const events = m.events ?? [];
  const after = events.find((x) => x.index > e.index && !isAction(x, "batter_timeout"));
  if (after && isAction(after, "pitching_substitution")) return true;
  const before = [...events].reverse().find((x) => x.index < e.index && !isAction(x, "batter_timeout"));
  if (before && isAction(before, "pitching_substitution")) return false;
  if ((e.balls ?? 0) + (e.strikes ?? 0) > 0) return false;
  return seedOf(`${m.index}.${e.index}`) % 5n < 3n;
}

/** A delay from MLB's advisory: an injury (the batter's, the pitcher's, someone else's), the field, the weather, and play resuming. */
export function delayOf(description: string | null, player: number | null, m: StatcastAtBat): Delay | null {
  const d = description;
  if (d == null) return null;
  if (d.startsWith("Injury Delay")) {
    const hurt: Hurt = player == null ? "elsewhere" : player === m.batterID ? "batter" : player === m.pitcherID ? "pitcher" : "elsewhere";
    return { kind: "injury", hurt };
  }
  if (d.startsWith("On-field Delay")) return { kind: "onField" };
  const prefix = "Status Change - ";
  if (!d.startsWith(prefix)) return null;
  const status = d.slice(prefix.length);
  if (status.startsWith("Delayed: About to Resume")) return { kind: "resuming" };
  if (status.startsWith("Delayed: ") || status.startsWith("Delayed Start: ")) {
    const i = status.indexOf(":");
    return { kind: "weather", why: status.slice(i + 1).trim() };
  }
  if (status.startsWith("In Progress") && (m.events ?? []).some((x) => x.description?.startsWith("Status Change - Delayed") === true)) return { kind: "over" };
  return null;
}

/**
 * The name a substitution's description gives: "Pitching Change: JoJo
 * Romero replaces Dustin May." → "JoJo Romero"; "Victor Mesa Jr. remains in
 * the game as the right fielder." → "Victor Mesa Jr.".
 */
export function nameIn(description: string | null): string | null {
  if (description == null) return null;
  let d = description;
  // "Defensive switch from second base to shortstop for Ben Williamson."
  if (d.startsWith("Defensive switch from ")) {
    const i = d.indexOf(" for ");
    if (i >= 0) d = d.slice(i + 5);
  }
  for (const prefix of ["Pitching Change: ", "Offensive Substitution: ", "Defensive Substitution: "]) if (d.startsWith(prefix)) d = d.slice(prefix.length);
  for (const prefix of ["Pinch-hitter ", "Pinch-runner ", "Pinch hitter ", "Pinch runner "]) if (d.startsWith(prefix)) d = d.slice(prefix.length);
  for (const stop of [" replaces ", " remains ", " moves ", " is now ", " in as ", ","]) {
    const i = d.indexOf(stop);
    if (i >= 0) d = d.slice(0, i);
  }
  const name = d.replace(/^[ .]+|[ .]+$/g, "");
  return name === "" ? null : name;
}

/** A full name's surname for a tag: "JoJo Romero" → "Romero"; "Victor Mesa Jr." → "Mesa Jr."; a short name its surname. */
export function tagName(name: string): string {
  const parts = name.split(" ").filter((p) => p !== "");
  if (parts.length <= 1) return name;
  const suffixes = new Set(["Jr.", "Jr", "Sr.", "Sr", "II", "III", "IV"]);
  const last = parts[parts.length - 1]!;
  if (suffixes.has(last) && parts.length > 2) return `${parts[parts.length - 2]} ${last.endsWith(".") || last.startsWith("I") ? last : `${last}.`}`;
  return last;
}

/** A position's abbreviation as a scorer's number ("RF" → 9). */
export function positionOf(abbreviation: string): number | null {
  return ({ P: 1, C: 2, "1B": 3, "2B": 4, "3B": 5, SS: 6, LF: 7, CF: 8, RF: 9 } as Record<string, number>)[abbreviation] ?? null;
}

/** The base a replaced runner stood on: where his last leg in the at-bat ended. */
export function baseOf(runner: number | null, m: StatcastAtBat): number | null {
  if (runner == null) return null;
  for (let i = m.runners.length - 1; i >= 0; i--) {
    const leg = m.runners[i]!;
    if (leg.runner === runner && (leg.to ?? 0) < 4) return leg.to;
  }
  return null;
}

/**
 * What's still to come, caught up: a play goes first (its replay is what a
 * scoring slide keeps time with: what came before it is passed over); a
 * backlog of pitches (the feed was slow) plays only its last few; everything
 * else plays, in order. (pure; tested)
 */
export function catchUp(pending: readonly PlayBeat[]): readonly PlayBeat[] {
  let play = -1;
  for (let i = pending.length - 1; i >= 0; i--) {
    if (isPlayBeat(pending[i]!)) {
      play = i;
      break;
    }
  }
  if (play > 0) return catchUp(pending.slice(play));
  const pitches = pending.filter((b) => b.kind.kind === "pitch");
  if (pitches.length <= 5) return pending;
  const keep = new Set(pitches.slice(-4).map((b) => b.id));
  return pending.filter((b) => b.kind.kind !== "pitch" || keep.has(b.id));
}

// MARK: - What the tag says

/** "TOP 7TH", "BOT 7TH". */
export function halfTag(inning: number | null, top: boolean | null): string | null {
  if (inning == null || top == null) return null;
  return `${top ? "TOP" : "BOT"} ${ordinal(inning).toUpperCase()}`;
}

/**
 * The game as it stands after this beat, for the tag between pitches: "TOP
 * 7TH · 1-2 · 2 OUTS" (and the end of a half, a stoppage, while it stands).
 * (pure; tested)
 */
export function standing(b: PlayBeat): string | null {
  if (stands(b)) {
    const tag = beatTag(b, true);
    if (tag != null) return tag;
  }
  const outs = Math.min(b.outs, 3);
  const parts = [halfTag(b.inning, b.top), outs >= 3 ? null : `${b.balls}-${b.strikes}`, `${outs} OUT${outs === 1 ? "" : "S"}`].filter((p): p is string => p != null);
  return parts.length === 0 ? null : parts.join(" · ");
}

/** What the tag says as this beat plays (a pitch's, its call). `wide`: room for MLB's full pitch names. (pure; tested) */
export function beatTag(b: PlayBeat, wide: boolean): string | null {
  const k = b.kind;
  switch (k.kind) {
    case "play":
      return null;
    case "pitch":
      return callTag(k.pitch, wide);
    case "batterUp":
      return k.name != null ? `${k.pinch ? "PINCH HITTER" : "NOW BATTING"} · ${k.name.toUpperCase()}` : null;
    case "pickoff":
      return `${k.catcher ? "SNAP THROW" : "PICKOFF ATTEMPT"} · ${["", "FIRST", "SECOND", "THIRD"][Math.min(Math.max(k.base, 1), 3)]}`;
    case "stepOff":
      return "STEP OFF";
    case "timeout":
      return null;
    case "moundVisit":
      return "MOUND VISIT";
    case "pitchingChange":
      return ["PITCHING CHANGE", k.reliever?.toUpperCase() ?? null].filter((p): p is string => p != null).join(" · ");
    case "substitution": {
      const what = { pinchHitter: "PINCH HITTER", pinchRunner: "PINCH RUNNER", defensive: "DEFENSIVE SUB", moves: "DEFENSIVE SWITCH" }[k.change.role];
      const position = k.change.position != null ? ["", "P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"][Math.min(Math.max(k.change.position, 1), 9)]! : null;
      return [what, k.change.name?.toUpperCase() ?? null, position].filter((p): p is string => p != null).join(" · ");
    }
    case "inningBreak":
      return `${k.middle ? "MIDDLE" : "END"} ${ordinal(k.inning).toUpperCase()}`;
    case "review":
      if (k.review.inProgress) return "REVIEW · UNDER WAY";
      return `REVIEW · ${k.review.overturned ? "OVERTURNED" : "CALL STANDS"}`;
    case "delay":
      return delayTag(k.delay);
  }
}

export function delayTag(d: Delay): string {
  switch (d.kind) {
    case "injury":
      return "INJURY DELAY";
    case "onField":
      return "ON-FIELD DELAY";
    case "weather":
      return d.why.toLowerCase().includes("rain") ? "RAIN DELAY" : "WEATHER DELAY";
    case "resuming":
      return "DELAY · ABOUT TO RESUME";
    case "over":
      return "PLAY RESUMES";
  }
}

/**
 * A pitch's call as the tag says it: the call and the count it makes, then
 * the speed and MLB's name for it: "STRIKE 2 · 97 MPH FOUR-SEAM FASTBALL",
 * "BALL 3 · 88 MPH SLIDER", "FOUL · 99 MPH SINKER". In a narrow well the
 * name is the short one ("FOUR-SEAM"). A challenged call, as it was made
 * (`asCalled`): `challengeTags` says the rest.
 */
export function callTag(p: BeatPitch, wide: boolean, asCalled = false): string {
  let call = p.call;
  let balls = p.balls;
  let strikes = p.strikes;
  if (asCalled && p.review?.overturned) {
    // The umpire's call before the zone overturned it.
    if (call === "calledStrike") {
      call = "ball";
      balls += 1;
      strikes -= 1;
    } else if (call === "ball") {
      call = "calledStrike";
      strikes += 1;
      balls -= 1;
    }
  }
  const head = {
    ball: `BALL ${balls}`,
    ballInDirt: `BALL ${balls}`,
    calledStrike: `STRIKE ${strikes}`,
    swingingStrike: `STRIKE ${strikes} SWINGING`,
    swingingBlocked: `STRIKE ${strikes} SWINGING`,
    foul: "FOUL",
    foulTip: `FOUL TIP · STRIKE ${strikes}`,
    foulBunt: `FOUL BUNT · STRIKE ${strikes}`,
    missedBunt: `MISSED BUNT · STRIKE ${strikes}`,
    automaticBall: `AUTOMATIC BALL ${balls} · PITCH CLOCK`,
    automaticStrike: `AUTOMATIC STRIKE ${strikes} · PITCH CLOCK`,
  }[call];
  if (!thrown(p)) return head;
  const names = wide ? PITCH_OFFICIAL : PITCH_NAMES;
  const name = p.code != null ? names[p.code]?.toUpperCase() : undefined;
  const speed = p.mph != null ? `${Math.sign(p.mph) * Math.round(Math.abs(p.mph))} MPH` : null;
  const tail = [speed, name].filter((x): x is string => x != null).join(" ");
  return tail === "" ? head : `${head} · ${tail}`;
}

/** A challenged pitch's second and third words: who challenged, then how it came out ("ABS CHALLENGE · HICKS", "OVERTURNED · STRIKE 1"). */
export function challengeTags(p: BeatPitch): { asked: string; result: string } | null {
  const r = p.review;
  if (!r) return null;
  const asked = ["ABS CHALLENGE", r.challenger != null ? tagName(r.challenger).toUpperCase() : null].filter((x): x is string => x != null).join(" · ");
  const now = p.call === "ball" || p.call === "ballInDirt" ? `BALL ${p.balls}` : `STRIKE ${p.strikes}`;
  return { asked, result: r.overturned ? `OVERTURNED · ${now}` : `CALL STANDS · ${now}` };
}

/** A caption line's words as this beat plays (playBeatScript.ts times them). (pure; tested) */
export type CaptionLine = { readonly kind: "tag" } | { readonly kind: "call"; readonly asCalled: boolean } | { readonly kind: "challenge" } | { readonly kind: "outcome" };

export function captionText(b: PlayBeat, line: CaptionLine, wide: boolean): string | null {
  const p = beatPitch(b);
  switch (line.kind) {
    case "tag":
      return beatTag(b, wide);
    case "call":
      return p ? callTag(p, wide, line.asCalled) : beatTag(b, wide);
    case "challenge":
      return p ? (challengeTags(p)?.asked ?? null) : null;
    case "outcome":
      return p ? (challengeTags(p)?.result ?? null) : null;
  }
}

/** A delay as ESPN's status has it ("STATUS_RAIN_DELAY", "STATUS_DELAYED": "Rain Delay"). (pure; tested) */
export function espnDelay(status: unknown): Delay | null {
  const name = str(at(status, "type", "name"));
  if (name == null || !name.includes("DELAY")) return null;
  const detail = str(at(status, "type", "detail")) ?? str(at(status, "type", "shortDetail")) ?? "";
  return { kind: "weather", why: name.includes("RAIN") || detail.toLowerCase().includes("rain") ? "Rain" : detail };
}

/** A delay as MLB's live status has it ("Delayed: Rain"): before ESPN's, it's the game's own. */
export function mlbDelay(status: string | null): Delay | null {
  if (status == null || !status.startsWith("Delayed")) return null;
  const i = status.indexOf(":");
  const why = i >= 0 ? status.slice(i + 1).trim() : "";
  return why.startsWith("About to Resume") ? { kind: "resuming" } : { kind: "weather", why };
}
