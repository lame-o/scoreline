/**
 * The football theater's pure rules (FootballTheater.swift `FootballTheater.rest`,
 * `FootballCelebration`; LiveFeeds.swift `FootballFeed.theater`): the field
 * between plays from the live situation, which snap the theater shows and
 * whether it's news, and the one celebration per moment the theater owns
 * when the page shows it. The drawing is features/game/football/theater/.
 */
import { cueFor, presetFor, type CelebrationCue, type CelebrationLevel, type Effect } from "../celebrations";
import type { Football } from "../gameDetail";
import { at, num, str, type JSONValue } from "../json";
import type { FootballTeams } from "../liveFeeds/football";
import type { TheaterBurst } from "../mlb/theaterCelebration";
import { TheaterBurst as Burst } from "./theaterKit";
import type { Side } from "../models";
import { decisive, type LiveMoment } from "../moments";
import { parseStoppage, type FootballStoppage } from "./footballIdle";
import { FootballDepthChart, parse, type DepthCharts, type Down, type FootballScene, type FootballTheaterState } from "./footballScene";
import type { FootballScript, Rest } from "./footballScript";

// MARK: - The field between plays

/** The live situation as the field between plays: the spot and line to gain in the offense's yards (the top team attacks the right end zone). */
export function footballRest(situation: Football): { rest: Rest; offense: Side } | null {
  const side = situation.possession;
  if (!side) return null;
  const yard = (x: number) => (side === "top" ? x : 100 - x);
  return { rest: { yard: yard(situation.ballX), gain: situation.lineToGainX != null ? yard(situation.lineToGainX) : null }, offense: side };
}

/** With no situation at all: the offense at its 25, ten to go. */
export const DEFAULT_REST: Rest = { yard: 25, gain: 35 };

/**
 * What the stage shows (FootballTheater.swift `FootballTheater.shown`): a
 * play replaying (or one of the snaps queued before it, oldest first), then
 * its end until it has held (`rested`); a touchdown's try in a beat of its
 * own, the same; a new play not yet begun; otherwise null, the field between
 * snaps (footballIdle.ts). History that isn't news is never shown: on
 * opening the page, the field is the live one. `replaying`: the replay begun
 * on the stage, if any; `played`: the snaps already replayed. (pure; tested)
 */
export function footballShown(state: FootballTheaterState, replaying: string | null, rested: string | null, played: ReadonlySet<string> = new Set()): FootballScene | null {
  const play = state.play;
  if (!play) return null;
  const queue = state.queue ?? [];
  for (const scene of [...queue.filter((q) => q.id !== play.id), play]) {
    const attempt = scene.conversion;
    if (attempt && replaying === attempt.id) return rested === attempt.id ? null : attempt;
    if (replaying === scene.id) return rested === scene.id ? null : scene;
  }
  if (!state.news) return null;
  return queue.find((q) => q.id !== play.id && !played.has(q.id)) ?? play;
}

/** The next queued snap after this one (or after the try of it) that hasn't replayed (FootballStage.nextQueued). (pure; tested) */
export function nextQueued(state: FootballTheaterState, id: string, played: ReadonlySet<string>): FootballScene | null {
  const queue = state.queue ?? [];
  const base = id.endsWith("-try") ? id.slice(0, -4) : id;
  const i = queue.findIndex((q) => q.id === base);
  if (i < 0) return null;
  const attempt = queue[i]!.conversion;
  if (!id.endsWith("-try") && attempt && !played.has(attempt.id)) return null;
  return queue.slice(i + 1).find((q) => !played.has(q.id)) ?? null;
}

/** "3rd & 7 at PHI 35" → 3rd & 7; "1st & Goal" → its distance unknown (10). (FootballTheater.down; pure; tested) */
export function footballDown(text: string | null | undefined): Down | null {
  const m = text ? /^(\d)(?:st|nd|rd|th) & (\d+|Goal)/.exec(text) : null;
  if (!m) return null;
  const distance = Number(m[2]);
  return { down: Number(m[1]), distance: Number.isFinite(distance) ? distance : 10 };
}

// MARK: - What the theater shows

/** How long ago a play may have happened and still be news on a page that just opened (BaseballFeed.recent). */
export const RECENT_MS = 60_000;

/**
 * The theater after a look at the plays. Its snap is news if it arrived
 * after the first complete look, or if it only just happened (a page opened
 * right after it); otherwise it's history, shown as it ended. A snap already
 * showing keeps what it was, edits and all. (FootballFeed.theater; pure)
 */
export function footballTheaterState(scene: FootballScene, previous: FootballTheaterState, primed: boolean, now: number): FootballTheaterState {
  return {
    ...previous,
    play: scene,
    news: scene.id === previous.play?.id ? previous.news : primed || (scene.wallclock != null && now - scene.wallclock < RECENT_MS),
  };
}

/**
 * The theater after a look that brought `snaps` (oldest first, the one
 * showing among them if it was read again): the newest is its play. While
 * the page is open each new snap joins the queue in order, so a look that
 * brings two (the feed caught up, a score and its kickoff) replays both; an
 * edited snap replaces its earlier version there too. `stoppage` is
 * whatever stopped play after the newest. (FootballFeed.theater; pure; tested)
 */
export function footballTheaterQueued(snaps: readonly FootballScene[], stoppage: FootballStoppage | null, previous: FootballTheaterState, primed: boolean, now: number): FootballTheaterState {
  const last = snaps.at(-1);
  if (!last) return { ...previous, stoppage: stoppage ?? previous.stoppage ?? null };
  const next = { ...footballTheaterState(last, previous, primed, now), stoppage };
  const edited = (scene: FootballScene) => snaps.find((s) => s.id === scene.id) ?? scene;
  if (next.news && primed) {
    const shown = previous.play ? snaps.findIndex((s) => s.id === previous.play!.id) : -1;
    const fresh = shown >= 0 ? snaps.slice(shown + 1) : previous.play == null ? [last] : [...snaps];
    const queue = (previous.news ? (previous.queue ?? []) : previous.play ? [previous.play] : []).map(edited);
    for (const snap of fresh) if (!queue.some((q) => q.id === snap.id)) queue.push(snap);
    if (!queue.some((q) => q.id === last.id)) queue.push(last);
    return { ...next, queue: queue.slice(-5) };
  }
  return { ...next, queue: [last] };
}

/** The lane's depth charts, as ESPN sent them, read (`FootballDepthChart.from`); a side whose chart doesn't read is left out. */
export function readCharts(raw: Readonly<Partial<Record<Side, JSONValue>>>): DepthCharts {
  const charts: { top?: FootballDepthChart; bottom?: FootballDepthChart } = {};
  for (const side of ["top", "bottom"] as const) {
    const chart = raw[side] != null ? FootballDepthChart.from(raw[side]) : null;
    if (chart) charts[side] = chart;
  }
  return charts;
}

const sequenceOf = (item: JSONValue): number => {
  const s = str(at(item, "sequenceNumber"));
  const n = s != null ? Number(s) : num(at(item, "sequenceNumber"));
  return n != null && Number.isFinite(n) ? n : 0;
};

/**
 * Spots each snap on its hash from the one before it (oldest first; the
 * first from `previous`, or in the middle with nothing before it).
 * (FootballFeed.spot; pure)
 */
export function spot(snaps: readonly FootballScene[], previous: FootballScene | null): FootballScene[] {
  let before = previous;
  return snaps.map((snap) => {
    const spotted = snap.clone();
    spotted.hash = before?.nextHash ?? "middle";
    before = spotted;
    return spotted;
  });
}

/** The last snap in a run of entries, spotted from the few before it. (FootballFeed.spotted; pure) */
export function spotted(items: readonly JSONValue[], teams: FootballTeams): FootballScene | null {
  const recent: FootballScene[] = [];
  for (let i = items.length - 1; i >= 0 && recent.length < 6; i--) {
    const scene = parse(items[i], teams);
    if (scene) recent.push(scene);
  }
  return spot(recent.reverse(), null).at(-1) ?? null;
}

/**
 * The lane's theater, kept beside the lane (FootballFeed's `theater` and
 * `theaterSequence`): given the lane's raw entries in play order after each
 * change, the newest few snaps at or after the theater's are each spotted
 * on their hash from the one before, and the newest becomes the theater's
 * snap. The snap showing keeps the hash its own plays put it on (an edit
 * doesn't move it). An entry ESPN edited is a new object in the lane's
 * list; an unchanged one is the same object, so it changes nothing. Once
 * the lane has both teams' depth charts (NFL), every snap is placed on them
 * (`FootballScene.slotted`), the one showing too (FootballFeed.loadCharts).
 */
export class FootballTheaterWatch {
  state: FootballTheaterState = { play: null, news: false };
  /** The sequence number of the theater's snap: an older entry never replaces it. */
  private sequence = -1;
  /** The newest entry heard, and when (the heartbeat): its wallclock on the first look, then the moment it arrived. */
  private heardSequence = -1;
  private heard: number | null = null;
  private item: JSONValue = undefined;
  private items: readonly JSONValue[] | null = null;
  private rawCharts: Readonly<Partial<Record<Side, JSONValue>>> = NO_CHARTS;
  private charts: DepthCharts = {};

  /**
   * `primed`: the lane had a complete look before this change; `charts`:
   * the lane's depth charts as ESPN sent them (`FootballFeed.charts`). True
   * when the state changed.
   */
  update(items: readonly JSONValue[], teams: FootballTeams, primed: boolean, now: number = Date.now(), charts: Readonly<Partial<Record<Side, JSONValue>>> = NO_CHARTS): boolean {
    let changed = false;
    if (charts !== this.rawCharts) {
      this.rawCharts = charts;
      const found = readCharts(charts);
      if (Object.keys(found).length > 0) {
        // The snap showing, placed on them.
        this.charts = found;
        this.state = { ...this.state, charts: found, play: this.state.play?.slotted(found) ?? null, queue: this.state.queue?.map((q) => q.slotted(found)) };
        changed = true;
      }
    }
    if (items === this.items) return changed;
    this.items = items;
    // The heartbeat: when the feed last brought anything new.
    let newest: { sequence: number; item: JSONValue } | null = null;
    for (let i = items.length - 1; i >= 0; i--) {
      const sequence = sequenceOf(items[i]);
      if (sequence <= this.heardSequence) break;
      if (!newest || sequence > newest.sequence) newest = { sequence, item: items[i] };
    }
    if (newest) {
      this.heardSequence = newest.sequence;
      const wallclock = Date.parse(str(at(newest.item, "wallclock")) ?? "");
      this.heard = primed ? now : Number.isFinite(wallclock) ? wallclock : this.heard;
    }
    // The newest few snaps, oldest first: each is spotted on its hash from the one before.
    const recent: { scene: FootballScene; sequence: number; item: JSONValue }[] = [];
    let unchanged = false;
    for (let i = items.length - 1; i >= 0 && recent.length < 5; i--) {
      const item = items[i];
      const sequence = sequenceOf(item);
      if (sequence < this.sequence) break;
      if (recent.length === 0 && item === this.item) {
        unchanged = true;
        break;
      }
      const scene = parse(item, teams)?.slotted(this.charts);
      if (scene) recent.push({ scene, sequence, item });
    }
    recent.reverse();
    // What stopped play after the newest snap (a timeout, a TV timeout, the quarter's end), if anything has: the newest entry after it.
    const after = recent.at(-1)?.sequence ?? this.sequence;
    let last: { sequence: number; item: JSONValue } | null = null;
    for (let i = items.length - 1; i >= 0; i--) {
      const sequence = sequenceOf(items[i]);
      if (sequence <= after) break;
      if (!last || sequence > last.sequence) last = { sequence, item: items[i] };
    }
    const stoppage = last ? parseStoppage(last.item, teams) : null;
    const snap = unchanged ? undefined : recent.at(-1);
    if (!snap) {
      if (this.state.heard === this.heard && (stoppage == null || stoppage.id === this.state.stoppage?.id)) return changed;
      this.state = { ...this.state, heard: this.heard, stoppage: stoppage ?? this.state.stoppage ?? null };
      return true;
    }
    this.sequence = snap.sequence;
    this.item = snap.item;
    const snaps = recent.map((r) => r.scene);
    const shown = this.state.play;
    const i = shown ? snaps.findIndex((x) => x.id === shown.id) : -1;
    let placed: FootballScene[];
    if (shown && i >= 0) {
      const kept = snaps[i]!.clone();
      kept.hash = shown.hash;
      placed = [kept, ...spot(snaps.slice(i + 1), kept)];
    } else {
      placed = spot(snaps, shown);
    }
    if (placed.length === 0) return changed;
    this.state = { ...footballTheaterQueued(placed, stoppage, this.state, primed, now), heard: this.heard };
    return true;
  }
}

const NO_CHARTS: Readonly<Partial<Record<Side, JSONValue>>> = {};

// MARK: - Celebration

/** A burst on the theater's stage, in whose colors. */
export interface FootballBurst extends TheaterBurst {
  /** Whose colors it wears. */
  readonly side: Side | null;
}

const DEG = Math.PI / 180;

/**
 * One celebration per moment, and the theater owns its plays' when the page
 * shows it (the drive chart keeps its marks and bursts nothing): a
 * touchdown's fireworks over the goal line it crossed with confetti off the
 * banner, a pick six's at the maximum, a field goal's small pop at the
 * crossbar, a big play's sparks where he was stopped. Turnovers, a safety
 * and fourth down get their banner alone. Every burst goes through the
 * page's rules (`cueFor`): the celebration level, Reduce Motion, and one
 * particle burst every 10 s. (pure; tested)
 */
export const FootballCelebration = {
  /** The drive chart bursts only when there's no theater to. */
  driveChartBursts(theaterShown: boolean): boolean {
    return !theaterShown;
  },

  /** The theater's bursts for this play's moment, in script time. Nothing for another play's moment, or when the level is Off. */
  theater(moment: LiveMoment | null, play: FootballScene, script: FootballScript, level: CelebrationLevel, reduceMotion: boolean, height: number): FootballBurst[] {
    if (!moment || moment.id !== play.id || moment.chart !== "field") return [];
    const gold = decisive(moment);
    const cue = (effects?: readonly Effect[]): CelebrationCue | null => {
      const c = cueFor(moment, { level, reduceMotion, preset: presetFor(height), direction: 90 * DEG, effects });
      return c && gold ? { ...c, gold: true } : c;
    };
    const scale = Burst.scale(height);
    const bursts: FootballBurst[] = [];
    switch (moment.kind) {
      case "touchdown": {
        const at = script.score;
        const point = script.scorePoint;
        if (at == null || !point) return [];
        // The shells burst over the goal line as the ball crosses: two, three for a pick six or a game-winner.
        const shells = play.pickSix || decisive(moment) ? 3 : 2;
        const fireworks = cue([{ kind: "fireworks", shells }]);
        if (fireworks) bursts.push({ cue: fireworks, at: at - fireworks.delay, anchor: { kind: "field", point: { x: point.x, y: point.y, z: 24 } }, scale, side: play.scorer });
        // The banner's confetti: only ever confetti (Subtle, the cooldown and Reduce Motion leave the banner alone).
        if (script.banner?.confetti) {
          const confetti = cue([{ kind: "confetti", direction: 90 * DEG, spread: (play.pickSix ? 170 : 150) * DEG, preset: "medium" }]);
          if (confetti && confetti.effects.some((e) => e.kind === "confetti")) {
            bursts.push({ cue: confetti, at: at + 0.12 - confetti.delay, anchor: { kind: "banner" }, scale: scale * (play.pickSix ? 0.85 : 0.7), side: play.scorer });
          }
        }
        break;
      }
      case "fieldGoal": {
        // A small pop at the crossbar as the ball goes over it.
        const at = script.score;
        const point = script.scorePoint;
        const pop = cue();
        if (at == null || !point || !pop) return [];
        bursts.push({ cue: pop, at: at - pop.delay, anchor: { kind: "field", point }, scale: scale * 0.8, side: play.scorer });
        break;
      }
      case "passComplete":
      case "rush": {
        const end = script.end;
        if (!moment.accents.has("bigPlay") || !end) return [];
        const sparks = cue();
        if (!sparks) return [];
        bursts.push({ cue: sparks, at: script.stamp - 0.1 - sparks.delay, anchor: { kind: "field", point: { x: end.x, y: end.y, z: 4 } }, scale: scale * 0.7, side: play.offense });
        break;
      }
      default:
        // Turnovers, a safety, a miss, fourth down: the banner alone.
        break;
    }
    return bursts;
  },
};
