/**
 * The soccer theater's pure parts (SoccerTheater.swift, and LiveFeeds.swift
 * `SoccerFeed.theater`): the broadcast camera's perspective through a
 * framing, the stamp's second line, the caption's sentences, who
 * celebrates what (`GoalCelebration`), and what the theater shows from the
 * live lane (`SoccerTheaterWatch`, the lane's `updateTheater` kept outside
 * the lane), and who's who for the names over the pitch (`soccerCast`). The
 * drawing is features/game/soccer/theater.
 */
import { cueFor, presetFor, sparks, cueDuration, type CelebrationCue, type CelebrationLevel, type Effect } from "../celebrations";
import { at, num, type JSONValue } from "../json";
import type { Side } from "../models";
import { pitchScale, REVIEW_MS, type PitchScale } from "../liveFeeds/soccer";
import { decisive, type LiveMoment } from "../moments";
import { CameraFrame } from "../mlb/playCamera";
import type { FieldPoint, Point } from "../mlb/theaterField";
import { attacksRight, goalOf, isMoment, keepers, latest, parse, Pitch, playID, readLineups, scored, type Lineups, type Person, type SoccerScene, type SoccerTheaterState } from "./soccerScene";
import { pitchBursts, theaterOwns } from "./goalCelebrationRules";
import { string } from "./soccerEntries";
import { parseEvent, parseTouch, type SoccerEvent, type SoccerIdle, type SoccerTouch } from "./soccerIdle";
import { PitchCamera, PitchFrame, type Basis, type SoccerScript } from "./soccerScript";
import { TheaterBurst } from "./theaterKit";
import { known, TEAM_ONLY, TheaterCast, theaterPerson, type CastMember, type TheaterPerson, type TheaterWho } from "./theaterNames";

export { stampDetail } from "./soccerScene";

// MARK: - Projection

/** The broadcast camera's perspective through a framing, filling the view. */
export class PitchProjection {
  readonly size: { readonly width: number; readonly height: number };
  readonly camera: PitchFrame;
  readonly basis: Basis;
  /** Points per unit of the view's tangent plane. */
  readonly focal: number;

  constructor(size: { readonly width: number; readonly height: number }, camera: PitchFrame = PitchFrame.rest) {
    this.size = size;
    this.camera = camera;
    this.basis = PitchCamera.basis(camera.camera, camera.angle);
    const half = Math.max(camera.camera.span, 1) / 2 / this.basis.distance;
    this.focal = Math.max(Math.min(size.height / 2 / half, size.width / 2 / (half * CameraFrame.aspect)), 1);
  }

  /** Behind which goal the camera is (null: the main camera, in the stand). */
  get behind(): boolean | null {
    return this.camera.angle.kind === "behind" ? this.camera.angle.right : null;
  }

  /** How far a point is from the lens, along its axis: what's further is drawn first. */
  depth(p: FieldPoint): number {
    const { eye, forward } = this.basis;
    return (p.x - eye.x) * forward.x + (p.y - eye.y) * forward.y + (p.z - eye.z) * forward.z;
  }

  point(p: FieldPoint): Point {
    const t = this.basis.tangent(p);
    return { x: this.size.width / 2 + t.u * this.focal, y: this.size.height / 2 - t.v * this.focal };
  }

  pointGround(p: Point, z = 0): Point {
    return this.point({ x: p.x, y: p.y, z });
  }

  /** Points per metre at a spot's distance from the lens. */
  scale(p: FieldPoint): number {
    const { eye, forward } = this.basis;
    return this.focal / Math.max((p.x - eye.x) * forward.x + (p.y - eye.y) * forward.y + (p.z - eye.z) * forward.z, 0.5);
  }

  /** A standing figure's height in points: a little larger than life, smaller further off, never a speck, never a giant. */
  figure(p: Point): number {
    const h = this.size.height;
    return Math.min(Math.max(2.5 * this.scale({ x: p.x, y: p.y, z: 0 }), Math.max(9, h * 0.06)), Math.max(h * 0.2, 10));
  }
}

// MARK: - Caption

/** ESPN runs a note onto the end of a sentence ("…with a cross.Goal confirmed following VAR Review."): a space between them. */
export function sentences(text: string): string {
  return text.replace(/\.(?=\p{Lu})/gu, ". ");
}

// MARK: - Celebration

/** A burst on the theater's stage. */
export interface Burst {
  readonly cue: CelebrationCue;
  /** Script time it mounts (its cue's own delay comes after). */
  readonly at: number;
  /** A point on the pitch (it moves with the camera), or under the headline. */
  readonly anchor: { readonly kind: "field"; readonly point: FieldPoint } | { readonly kind: "banner" };
  /** Larger than the charts' bursts: the theater is the stage. */
  readonly scale: number;
}

export const burstEnd = (b: Burst): number => b.at + cueDuration(b.cue);

/**
 * One celebration per moment, and the theater owns the ones it replays when
 * the page shows it: a goal's fireworks burst over the net it went into,
 * with confetti off the headline (the Live Pitch only draws the shot's path);
 * a save's glint in the keeper's hands; sparks off the post. Every burst
 * goes through the page's rules (`cueFor`): the celebration level, Reduce
 * Motion, and one particle burst every 10 s. (pure; tested)
 */
export const GoalCelebration = {
  /** The moments the theater replays (and so celebrates): goals, saves, blocks, the woodwork, big chances. Cards stay the Live Pitch's. */
  theaterOwns,

  /** The Live Pitch bursts over a moment only when there's no theater to. */
  pitchBursts,

  /**
   * The theater's bursts for this moment, in script time: fireworks over
   * the net as a goal goes in (three, in gold, for a late winner or
   * equalizer) and the headline's confetti; a save's glint; the post's
   * sparks. Nothing for another moment, or when the level is Off.
   */
  theater(moment: LiveMoment | null, scene: SoccerScene, script: SoccerScript, level: CelebrationLevel, reduceMotion: boolean, height: number): Burst[] {
    // A goal VAR took back celebrates nothing.
    if (!moment || moment.id !== scene.id || moment.chart !== "pitch" || scene.review === "overturned") return [];
    const gold = scene.decisive || decisive(moment);
    const cue = (effects: readonly Effect[]): CelebrationCue | null => {
      const c = cueFor(moment, { level, reduceMotion, preset: presetFor(height), direction: Math.PI / 2, effects });
      return c && gold && scored(scene) ? { ...c, gold: true } : c;
    };
    const scale = TheaterBurst.scale(height);
    const bursts: Burst[] = [];
    const side = attacksRight(scene) ? 1.0 : -1.0;
    const net = script.impacts.find((i) => i.kind === "net");
    const hit = script.impacts.find((i) => i.kind === "save" || i.kind === "woodwork");
    if (scored(scene) && net) {
      const fireworks = cue([{ kind: "fireworks", shells: gold ? 3 : 2 }]);
      if (fireworks) {
        // Just over the net it went into.
        const over = { x: goalOf(scene).x + side * 1.5, y: Pitch.width / 2, z: 5.5 };
        bursts.push({ cue: fireworks, at: net.at - fireworks.delay, anchor: { kind: "field", point: over }, scale });
      }
      const banner = script.banners.find((b) => b.confetti);
      const confetti = banner ? cue([{ kind: "confetti", direction: Math.PI / 2, spread: (150 * Math.PI) / 180, preset: "medium" }]) : null;
      if (banner && confetti && confetti.effects.some((e) => e.kind === "confetti")) {
        bursts.push({ cue: confetti, at: banner.at + 0.1 - confetti.delay, anchor: { kind: "banner" }, scale: scale * 0.7 });
      }
    } else if (hit && (scene.outcome === "saved" || scene.outcome === "woodwork")) {
      const glint = cue([sparks(6, 11)]);
      if (glint) bursts.push({ cue: glint, at: hit.at - glint.delay, anchor: { kind: "field", point: hit.point }, scale: scale * 0.6 });
    }
    return bursts;
  },
};

// MARK: - What the theater shows

/**
 * What the stage shows (SoccerTheater.shown): a moment replaying, then its
 * end (the scorer wheeling away, the stamp) until it has held (`rested`); a
 * new moment not yet begun; otherwise null, the quiet pitch. History that
 * isn't news is never shown: moments can be twenty minutes apart, and on
 * opening the page the pitch is quiet. A goal VAR has just struck off
 * replays once more, as a NO GOAL beat. Replays go by `soccerKey`. (pure; tested)
 */
export function soccerShown(state: SoccerTheaterState, replaying: string | null, rested: string | null, now: number = Date.now()): SoccerScene | null {
  const struck = state.overturned;
  if (struck && struck.wallclock != null && now - struck.wallclock < REVIEW_MS + 120_000 && rested !== soccerKey(struck)) return struck;
  const scene = state.scene;
  if (!scene) return null;
  if (replaying === soccerKey(scene)) return rested === soccerKey(scene) ? null : scene;
  return state.news ? scene : null;
}

/** A moment's replay, by its play; a goal struck off by VAR replays as a beat of its own. */
export function soccerKey(scene: SoccerScene): string {
  return scene.review === "overturned" ? `${scene.id}-var` : scene.id;
}

/** BaseballFeed.recent: a moment this fresh is news even on a page that only just opened (ESPN posts plays late). */
export const RECENT_MS = 60_000;

/**
 * The theater after a look at a moment (SoccerFeed.theater). It's news if it
 * arrived after the first complete load, or if it only just happened (a page
 * opened right after it); otherwise it's history, shown as it ended. A
 * moment already showing keeps what it was. (pure; tested)
 */
export function soccerTheaterState(scene: SoccerScene, previous: SoccerTheaterState, primed: boolean, now: number): SoccerTheaterState {
  const news = scene.id === previous.scene?.id ? previous.news : primed || (scene.wallclock != null && now - scene.wallclock < RECENT_MS);
  return { ...previous, scene, news };
}

/**
 * The theater once VAR has struck goals off: one showing leaves the stage
 * (kept as `overturned`, never to replay or celebrate as a goal), and the
 * moment before it shows instead, as it ended. (SoccerFeed.retracting; pure;
 * tested)
 */
export function retracting(
  ids: ReadonlySet<string>,
  state: SoccerTheaterState,
  plays: readonly JSONValue[],
  homeTeamID: string | null,
  keepers: Readonly<Record<string, Person>>,
  scale: PitchScale = "percent",
): SoccerTheaterState {
  const shown = state.scene;
  if (!shown || !ids.has(shown.id)) return state;
  const rest = plays.filter((p) => {
    const id = playID(p);
    return id == null || !ids.has(id);
  });
  return { ...state, overturned: { ...shown, review: "overturned" }, scene: latest(rest, homeTeamID, keepers, scale), news: false };
}

/**
 * What the theater reads from the lane beside the window: the goals VAR
 * struck off (`SoccerFeed.struck`), each side's roster (`SoccerFeed.rosters`),
 * and whether the look that brought the change follows on from the last
 * (`SoccerFeed.following`; absent: it does).
 */
export interface LaneExtras {
  readonly struck?: ReadonlySet<string>;
  readonly rosters?: Readonly<Partial<Record<Side, JSONValue>>>;
  readonly following?: boolean;
}

/**
 * The lane's `updateTheater` and `retract` (LiveFeeds.swift `SoccerFeed`),
 * outside the lane: it follows the web lane's window of raw core plays
 * (`SoccerFeed.plays`, data/liveFeeds/soccer.ts) and parses a moment only
 * when one has arrived (or the one showing has been followed by its save or
 * block, or edited), with the plays before it. Entries are known by ID, as
 * the lane knows them: what's new is what the last window didn't have, and
 * one it had that's a new object was edited (the lane swaps in an entry ESPN
 * retyped or reworded). A goal the lane says VAR struck off leaves the stage
 * first (`retracting`); the summary's lineups ride along on the state. The
 * lane trims its window to the newest 80 (the Mac parses from the old window
 * plus the new plays, untrimmed: a batch of more than 80 is the only
 * difference).
 *
 *     const watch = new SoccerTheaterWatch();
 *     if (watch.update(feed.plays, homeID, wasLoaded, Date.now(), { struck: feed.struck, rosters: feed.rosters })) render(watch.state);
 */
export class SoccerTheaterWatch {
  state: SoccerTheaterState = { scene: null, news: false };
  /** Goalkeepers by team ID, as the plays reveal them. */
  private keepers: Record<string, Person> = {};
  /** The window last seen, by play ID (an entry without one, by itself). */
  private known = new Map<unknown, JSONValue>();
  /** The lane's struck-off goals already taken off the stage. */
  private struck: ReadonlySet<string> = new Set();
  private rosters: LaneExtras["rosters"] = undefined;
  private scale: PitchScale | null = null;

  /**
   * After a change to the lane. `primed`: the lane had a complete load
   * before this change; a look that doesn't follow on from the last
   * (`lane.following`: it catches up after a gap) is history, as on opening
   * the page (the heartbeat still counts from it). Returns whether `state`
   * changed.
   */
  update(window: readonly JSONValue[], homeTeamID: string | null, primed: boolean, now: number = Date.now(), lane: LaneExtras = {}): boolean {
    const following = lane.following ?? true;
    let changed = false;
    // Both starting elevens, once the page has the summary.
    if (lane.rosters && lane.rosters !== this.rosters) {
      this.rosters = lane.rosters;
      const lineups = readLineups(lane.rosters);
      if (Object.keys(lineups).length > 0 && JSON.stringify(lineups) !== JSON.stringify(this.state.lineups ?? {})) {
        this.state = { ...this.state, lineups };
        changed = true;
      }
    }
    this.scale ??= pitchScale(window);
    // A goal VAR struck off goes before anything new shows.
    if (lane.struck && lane.struck !== this.struck) {
      const ids = new Set([...lane.struck].filter((id) => !this.struck.has(id)));
      this.struck = lane.struck;
      const next = retracting(ids, this.state, window, homeTeamID, this.keepers, this.scale ?? "percent");
      if (next !== this.state) {
        this.state = next;
        changed = true;
      }
    }
    // What's new since the last window (a run at its end), and what was edited in it.
    const known = new Map<unknown, JSONValue>();
    const revised = new Set<string>();
    let first = window.length;
    window.forEach((p, i) => {
      const id = playID(p);
      const key = id ?? p;
      if (!this.known.has(key)) first = Math.min(first, i);
      else if (this.known.get(key) !== p && id != null) revised.add(id);
      known.set(key, p);
    });
    this.known = known;
    const fresh = window.slice(first);
    const shown = this.state.scene?.id ?? null;
    if (fresh.length === 0 && !(shown != null && revised.has(shown))) return changed;
    const scale = this.scale ?? "percent";
    // The events, the ball's whereabouts and the half, from each new entry in turn (SoccerFeed's reads as it takes them).
    const events: SoccerEvent[] = [];
    let touch: SoccerTouch | null = null;
    let momentOrder: number | null = null;
    let period: number | null = null;
    for (let i = first; i < window.length; i++) {
      const order = this.serial++;
      const event = parseEvent(window, i, homeTeamID, order, scale);
      if (event) events.push(event);
      touch = parseTouch(window[i], homeTeamID, order, scale) ?? touch;
      if (isMoment(window[i])) momentOrder = order;
      const half = num(at(window[i], "period", "number"));
      if (half != null) period = half;
    }
    const before = this.state;
    let next = this.moment(window, first, revised, homeTeamID, primed && following, now, scale) ?? before;
    if (fresh.length > 0) {
      const wallclock = Date.parse(string(at(fresh[fresh.length - 1], "wallclock")) ?? "");
      next = {
        ...next,
        sceneOrder: next.scene?.id !== before.scene?.id && momentOrder != null ? momentOrder : (next.sceneOrder ?? null),
        events: [...(next.events ?? []), ...events].slice(-10),
        // Events that arrive with the page open are news, and play their beats.
        newsFrom: primed && following && next.newsFrom == null && events[0] ? events[0].order : (next.newsFrom ?? null),
        touch: touch ?? next.touch ?? null,
        period: period ?? next.period ?? null,
        heard: primed ? now : Number.isFinite(wallclock) ? wallclock : (next.heard ?? null),
      };
    }
    if (sameState(next, this.state)) return changed;
    this.state = next;
    return true;
  }

  /** The order of the next entry taken: later is newer (SoccerFeed's `serial`). */
  private serial = 0;

  /** The newest moment, when one has arrived (or the one showing has been followed by its save or block, or edited), with the plays before it; null when nothing changed. */
  private moment(window: readonly JSONValue[], first: number, revised: ReadonlySet<string>, homeTeamID: string | null, news: boolean, now: number, scale: PitchScale): SoccerTheaterState | null {
    Object.assign(this.keepers, keepers(window.slice(first)));
    const shown = this.state.scene?.id ?? null;
    const index = window.findLastIndex((p) => isMoment(p));
    if (index < 0) return null;
    const id = playID(window[index]);
    if (!(index >= first || (id === shown && (index >= first - 6 || (id != null && revised.has(id)))))) return null;
    const scene = parse(window, index, homeTeamID, this.keepers, scale);
    if (!scene) return null;
    return soccerTheaterState(scene, this.state, news, now);
  }
}

// MARK: - Names

/**
 * Who each figure is, for the names over the pitch (SoccerTheater.swift
 * § Names): all twenty-two, by athlete (the men in the move as ESPN credits
 * them, everyone else from the lineups at his formation's nominal spot, each
 * change made by then), with the squad's number and the place he plays in
 * the shape (a substitute takes the place of the man he came on for); the
 * officials and the staff nobody. A man only the idle's plain 4-4-2 knows
 * (no lineups yet) is his team's. `lineups`: as they were then. `key`: the
 * athlete the moment is about. (pure; tested)
 */
export function soccerCast(script: SoccerScript, attacking: Side, lineups: Lineups, people: Readonly<Record<string, TheaterPerson>>, key: string | null, scope: string): TheaterCast {
  const members = new Map<number, CastMember>();
  script.actors.forEach((actor, i) => {
    let side: Side;
    switch (actor.team) {
      case "attacking":
        side = attacking;
        break;
      case "defending":
        side = attacking === "top" ? "bottom" : "top";
        break;
      default:
        return;
    }
    let who: TheaterWho = TEAM_ONLY;
    const athlete = actor.athlete;
    if (athlete != null) {
      const slot = lineups[side]?.players.find((p) => p.athlete === athlete) ?? null;
      const person = people[athlete] ?? (actor.name === "" || actor.name === athlete ? null : theaterPerson(actor.name));
      if (person) {
        const place = (slot ? tagPosition(slot.position) : null) ?? (person.position != null ? tagPosition(person.position) : null);
        who = known({ ...person, position: place, number: person.number ?? slot?.jersey ?? null });
      }
    }
    members.set(i, TheaterCast.member(who, side, athlete, i, scope));
  });
  const figure = key == null ? null : script.actors.findIndex((a, i) => a.athlete === key && members.has(i));
  return TheaterCast.of(members, figure != null && figure >= 0 ? figure : null, scope);
}

/**
 * Who the pitch between moments is about: the man in the event on the
 * stage (booked, whistled, offside, coming on, down); nobody while the ball
 * just goes round. (pure; tested)
 */
export function idleKeyMan(idle: SoccerIdle): string | null {
  const e = idle.event;
  if (!e) return null;
  switch (e.kind.type) {
    case "card":
    case "foul":
    case "handball":
    case "offside":
    case "substitution":
    case "injury":
      return e.athlete;
    default:
      return null;
  }
}

/** A lineup place as a tag says it: ESPN's "G", "CD-L", "AM-R", "F" as GK, CB, AM, ST. Null for a substitute's "SUB". (pure; tested) */
export function tagPosition(espn: string): string | null {
  const p = espn.toUpperCase();
  if (p === "G" || p === "GK") return "GK";
  if (p.startsWith("CD") || p === "CB") return "CB";
  if (p.startsWith("CM")) return "CM";
  if (p.startsWith("AM")) return "AM";
  if (p.startsWith("DM")) return "DM";
  if (["F", "CF", "FW", "ST"].includes(p) || p.startsWith("CF-")) return "ST";
  if (["LB", "RB", "LWB", "RWB", "LM", "RM", "LW", "RW", "SW"].includes(p)) return p;
  return null;
}

/** `SoccerTheaterState ==`: the same moment, as parsed, the same news, the same goal struck off and the same lineups; the same events, ball and half, heard at the same time. */
function sameState(a: SoccerTheaterState, b: SoccerTheaterState): boolean {
  return (
    a.news === b.news &&
    JSON.stringify(a.scene) === JSON.stringify(b.scene) &&
    JSON.stringify(a.overturned ?? null) === JSON.stringify(b.overturned ?? null) &&
    JSON.stringify(a.lineups ?? {}) === JSON.stringify(b.lineups ?? {}) &&
    JSON.stringify(a.events ?? []) === JSON.stringify(b.events ?? []) &&
    (a.newsFrom ?? null) === (b.newsFrom ?? null) &&
    (a.sceneOrder ?? null) === (b.sceneOrder ?? null) &&
    JSON.stringify(a.touch ?? null) === JSON.stringify(b.touch ?? null) &&
    (a.period ?? null) === (b.period ?? null) &&
    (a.heard ?? null) === (b.heard ?? null)
  );
}
