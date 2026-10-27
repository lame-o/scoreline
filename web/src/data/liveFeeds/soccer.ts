/**
 * ESPN's event-level soccer feed (LiveFeeds.swift `SoccerFeed`,
 * `PitchAction`): each pass, shot and tackle with a location. It loads a
 * match once in big pages, then each refresh fetches only plays added since
 * the last (a few kilobytes). Positions are relative to the acting team's
 * attack, so away actions are flipped onto one pitch where the home (top)
 * team attacks right. Goals, shots and cards that arrive after the first
 * complete load are news (moments for the pitch); cards have no position of
 * their own and are placed at the foul that drew them.
 *
 * Plain TypeScript, no React: fields are replaced only when they change
 * (`subscribe` to hear it; `version` changes with every change).
 */
import type { Fetcher } from "../http";
import { arr, at, bool, num, str, type JSONValue } from "../json";
import type { Side } from "../models";
import { liveMoment, shortened, Tier, type Accent, type LiveMoment, type MomentKind } from "../moments";
import { teamIDFromRef } from "./baseball";

export type ActionKind = "pass" | "shot" | "goal" | "yellow" | "red" | "other";
/** How a shot ended (goals are the `goal` kind). */
export type ShotOutcome = "saved" | "blocked" | "wide" | "woodwork";

/** One positioned action on the pitch, oriented so the home (top) team attacks right. Coordinates are 0…100 on both axes. */
export interface PitchAction {
  /** Its index in ESPN's play list. */
  readonly id: number;
  readonly kind: ActionKind;
  readonly side: Side;
  readonly x: number;
  readonly y: number;
  readonly endX: number | null;
  readonly endY: number | null;
  readonly minute: string;
  readonly text: string;
  /** ESPN's play ID, shared with the match summary's key events. */
  readonly playID: string;
  readonly shot: ShotOutcome | null;
  /** Opta's expected goals for a shot (0…1), via ESPN. */
  readonly xg: number | null;
  /** Where a shot crossed (or would have crossed) the goal line, across the mouth on the same 0…100 scale as `y`. The posts stand at about 45.2 and 54.8. */
  readonly goalY: number | null;
  /** Its height at the line; the crossbar is at about 38. */
  readonly goalZ: number | null;
  /** Goals after this play, home (top) first. */
  readonly topScore: number | null;
  readonly bottomScore: number | null;
  /** The match clock in seconds (85' = 5100), counting on through stoppage and extra time. */
  readonly clockSeconds: number | null;
}

/** A chance worth a caption even though it missed: Opta's "big chance" line. */
export const BIG_CHANCE_XG = 0.3;
/** From here on a goal that changes the result decides the match. */
export const LATE_SECONDS = 85 * 60;
/** The posts on the goal-line scale (LMD §2.4). */
export const POSTS = { near: 45.2, far: 54.8 } as const;

/** Where a shot off the woodwork struck, on the goal-line scale: the crossbar where it crossed between the posts high up, else the nearer post. */
export function woodworkY(a: PitchAction): number | null {
  if (a.shot !== "woodwork" || a.goalY == null) return null;
  const y = a.goalY;
  if (a.goalZ != null && a.goalZ >= 34 && y > POSTS.near && y < POSTS.far) return y;
  return Math.abs(y - POSTS.near) < Math.abs(y - POSTS.far) ? POSTS.near : POSTS.far;
}

/** Where a shot off the woodwork struck, on the pitch's 0…100 scale: the goal line it was heading for, at the post (or bar) it hit. */
export function woodwork(a: PitchAction): { x: number; y: number } | null {
  const y = woodworkY(a);
  if (y == null) return null;
  return { x: a.endX ?? (a.side === "top" ? 100 : 0), y };
}

/** A late goal that changes the result: an equalizer, or a winner from level. */
export function decidesMatch(a: PitchAction): boolean {
  if (a.kind !== "goal" || a.clockSeconds == null || a.clockSeconds < LATE_SECONDS || a.topScore == null || a.bottomScore == null) return false;
  const [mine, theirs] = a.side === "top" ? [a.topScore, a.bottomScore] : [a.bottomScore, a.topScore];
  return mine === theirs || mine === theirs + 1;
}

/** A goal, shot or card as a live moment (PitchAction.moment). */
export function actionMoment(a: PitchAction): LiveMoment | null {
  const detail = shortened(a.text);
  switch (a.kind) {
    case "goal":
      return liveMoment({ id: a.playID, chart: "pitch", tier: Tier.score, kind: "goal", lead: "Goal", detail, side: a.side, accents: decidesMatch(a) ? ["decisive"] : [] });
    case "yellow":
    case "red":
      return liveMoment({ id: a.playID, chart: "pitch", tier: Tier.swing, kind: a.kind === "red" ? "redCard" : "yellowCard", lead: a.kind === "red" ? "Red card" : "Yellow card", detail, side: a.side });
    case "shot": {
      const [kind, lead]: [MomentKind, string] =
        a.shot === "saved" ? ["shotSaved", "Saved"] : a.shot === "blocked" ? ["shotBlocked", "Blocked"] : a.shot === "woodwork" ? ["shotWide", "Off the woodwork"] : ["shotWide", "Wide"];
      const accents: Accent[] = a.shot === "woodwork" ? ["woodwork"] : [];
      let caption: [string, string] = [lead, detail];
      // A big chance leads with the chance: "Big chance  0.39 xG · saved · …".
      if (a.xg != null && a.xg >= BIG_CHANCE_XG) {
        accents.push("bigChance");
        caption = ["Big chance", `${a.xg.toFixed(2)} xG · ${lead.toLowerCase()} · ${detail}`];
      }
      return liveMoment({ id: a.playID, chart: "pitch", tier: Tier.swing, kind, lead: caption[0], detail: caption[1], side: a.side, accents });
    }
    default:
      return null;
  }
}

const playID = (item: JSONValue) => str(at(item, "id")) ?? (num(at(item, "id")) != null ? String(num(at(item, "id"))) : "");
const intOf = (v: JSONValue): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null);

/**
 * How a match's feed measures the pitch. Most say 0…100 with each team
 * attacking toward x = 100; some archived matches (an older provider) say
 * 0…1 with each team attacking toward x = 0, and those are turned round onto
 * the usual scale. A web-only fix: the Mac draws them in a corner.
 */
export type PitchScale = "percent" | "unit";

/** A match's scale, from its positioned plays: any coordinate past 1.5 means percent. Null until a play has a position. */
export function pitchScale(items: readonly JSONValue[]): PitchScale | null {
  let positioned = false;
  for (const item of items) {
    for (const key of ["fieldPositionX", "fieldPositionY", "fieldPosition2X", "fieldPosition2Y"]) {
      const v = num(at(item, key));
      if (v == null || v === 0) continue;
      positioned = true;
      if (Math.abs(v) > 1.5) return "percent";
    }
  }
  return positioned ? "unit" : null;
}

/** A located action from a core play (SoccerFeed.action), or null. */
export function pitchAction(item: JSONValue, index: number, homeTeamID: string | null, scale: PitchScale = "percent"): PitchAction | null {
  // Unit-scale feeds attack toward 0: turned round (a half turn) onto the percent scale.
  const read = (key: string) => {
    const v = num(at(item, key));
    return v == null ? undefined : scale === "unit" && v !== 0 ? 100 * (1 - v) : v;
  };
  const x = read("fieldPositionX");
  const y = read("fieldPositionY");
  const team = teamIDFromRef(str(at(item, "team", "$ref"))) ?? str(at(item, "team", "id")) ?? null;
  if (x == null || y == null || (x === 0 && y === 0) || !team) return null;
  const home = team === homeTeamID;
  // Each team's coordinates have it attacking toward x = 100. Actions over the touchline come in slightly outside 0…100; keep them on the pitch.
  const orient = (v: number | null | undefined) => (v == null ? null : Math.min(Math.max(home ? v : 100 - v, 0), 100));
  const type = str(at(item, "type", "type")) ?? "";
  // Exact types: substring matching would catch "attempted-tackle", "assists-shot", keeper saves and goal kicks. Goals by the scoring flag ("goal-kick" also starts with "goal").
  const kind: ActionKind =
    bool(at(item, "scoringPlay")) === true || type === "goal" || type.startsWith("goal---") || type === "penalty---scored" || type === "own-goal"
      ? "goal"
      : type.startsWith("shot-")
        ? "shot"
        : type === "pass" || type === "cross"
          ? "pass"
          : "other";
  const rawEndX = num(at(item, "fieldPosition2X"));
  const rawEndY = num(at(item, "fieldPosition2Y"));
  // A unit-scale shot ends on the goal line at 0, which turns round to 100.
  const endX = scale === "unit" && rawEndX != null && (rawEndX !== 0 || (rawEndY ?? 0) !== 0) ? 100 * (1 - rawEndX) : rawEndX;
  const endY = scale === "unit" && rawEndY != null && (rawEndX !== 0 || rawEndY !== 0) ? 100 * (1 - rawEndY) : rawEndY;
  const hasEnd = (endX ?? 0) !== 0 || (endY ?? 0) !== 0;
  const shotLike = kind === "shot" || kind === "goal";
  return {
    id: index,
    kind,
    side: home ? "top" : "bottom",
    x: orient(x)!,
    y: orient(y)!,
    endX: hasEnd ? orient(endX) : null,
    endY: hasEnd ? orient(endY) : null,
    minute: str(at(item, "clock", "displayValue")) ?? "",
    text: str(at(item, "shortText")) ?? str(at(item, "text")) ?? str(at(item, "type", "text")) ?? "",
    playID: playID(item),
    shot: kind !== "shot" ? null : type === "shot-on-target" ? "saved" : type === "shot-blocked" ? "blocked" : type === "shot-hit-woodwork" ? "woodwork" : "wide",
    xg: shotLike ? (num(at(item, "expectedGoals")) ?? null) : null,
    goalY: shotLike ? orient(scale === "unit" ? read("goalPositionY") : num(at(item, "goalPositionY"))) : null,
    goalZ: shotLike ? (num(at(item, "goalPositionZ")) ?? null) : null,
    topScore: intOf(at(item, "homeScore")),
    bottomScore: intOf(at(item, "awayScore")),
    clockSeconds: num(at(item, "clock", "value")) ?? null,
  };
}

/**
 * A card has no position of its own; ESPN logs the player's foul just
 * before it, so the card goes there ("Nico González Foul" → "Nico González Yellow Card").
 */
export function placedCard(item: JSONValue, index: number, recent: readonly PitchAction[]): PitchAction | null {
  const type = str(at(item, "type", "type")) ?? "";
  const text = str(at(item, "shortText"));
  if (!type.endsWith("card") || !text) return null;
  let player = text;
  for (const suffix of [" Second Yellow Card", " Yellow Card", " Red Card"]) if (player.endsWith(suffix)) player = player.slice(0, -suffix.length);
  if (player === "" || player === text) return null;
  let foul: PitchAction | undefined;
  for (let i = recent.length - 1; i >= 0; i--) if (recent[i]!.text.startsWith(player)) { foul = recent[i]; break; }
  if (!foul) return null;
  return {
    ...foul,
    id: index,
    kind: type.includes("red") ? "red" : "yellow",
    endX: null,
    endY: null,
    minute: str(at(item, "clock", "displayValue")) ?? foul.minute,
    text,
    playID: playID(item),
    shot: null,
    xg: null,
    goalY: null,
    goalZ: null,
  };
}

/** A card as a moment, from the card entry alone (its foul isn't in: late, or out of order). */
export function cardMoment(item: JSONValue, homeTeamID: string | null): LiveMoment | null {
  const type = str(at(item, "type", "type")) ?? "";
  if (!(type.endsWith("card") || bool(at(item, "yellowCard")) === true || bool(at(item, "redCard")) === true)) return null;
  const red = type.includes("red") || bool(at(item, "redCard")) === true;
  const team = teamIDFromRef(str(at(item, "team", "$ref")));
  const text = str(at(item, "shortText")) ?? str(at(item, "text")) ?? "";
  return liveMoment({ id: playID(item), chart: "pitch", tier: Tier.swing, kind: red ? "redCard" : "yellowCard", lead: red ? "Red card" : "Yellow card", detail: shortened(text), side: team ? (team === homeTeamID ? "top" : "bottom") : null });
}

export interface SoccerUpdate {
  /** The league's slug ("eng.1"). */
  readonly league: string;
  readonly eventID: string;
  /** Soccer lists the home side first: the top competitor's ESPN team ID. */
  readonly homeTeamID: string | null;
  readonly signal?: AbortSignal;
}

/** The first load takes the match in big pages; later refreshes ask for small ones. */
const FIRST_PAGE_SIZE = 200;
const UPDATE_PAGE_SIZE = 25;
const TRAIL_LENGTH = 10;
/** Raw core plays kept for the play theater (SoccerScene reads every touch's positions and each shot's goal position). */
export const THEATER_WINDOW = 80;

export class SoccerFeed {
  /** The last 10 located actions (the live trail). */
  trail: readonly PitchAction[] = [];
  /** Every shot and goal so far. */
  shots: readonly PitchAction[] = [];
  /** Cards, placed where the foul that drew them happened, by play ID. */
  cards: Readonly<Record<string, PitchAction>> = {};
  /**
   * The newest core plays as ESPN sends them (about 80), in order: every
   * touch with `fieldPositionX/Y`, `fieldPosition2X/Y`, and `goalPositionY/Z`
   * for shots. TODO(soccer theater): the play theater (SoccerScene.swift,
   * SoccerScript.swift) reads its build-ups from here.
   */
  plays: readonly JSONValue[] = [];
  loaded = false;
  version = 0;

  private moments: LiveMoment[] = [];
  /** Whether this page has had a complete load: before it, everything is history. */
  private primed = false;
  /** The last few located actions, so a card can be put at its foul. */
  private recent: PitchAction[] = [];
  private fetched = 0;
  private scale: PitchScale | null = null;
  private inflight: Promise<void> | null = null;
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** One look: only actions added since the last. One update at a time. */
  async update(fetcher: Fetcher, options: SoccerUpdate): Promise<void> {
    while (this.inflight) await this.inflight.catch(() => {});
    if (options.signal?.aborted) return;
    this.inflight = this.look(fetcher, options);
    try {
      await this.inflight;
    } finally {
      this.inflight = null;
    }
  }

  private async look(fetcher: Fetcher, { league, eventID, homeTeamID, signal }: SoccerUpdate): Promise<void> {
    const base = `https://sports.core.api.espn.com/v2/sports/soccer/leagues/${league}/events/${eventID}/competitions/${eventID}/plays`;
    const size = this.loaded ? UPDATE_PAGE_SIZE : FIRST_PAGE_SIZE;
    let page = Math.floor(this.fetched / size) + 1;
    const pages: { page: number; items: readonly JSONValue[] }[] = [];
    let complete = false;
    const get = (n: number) => fetcher(`${base}?limit=${size}&page=${n}`, { signal }).catch(() => null);
    while (!signal?.aborted) {
      const json = await get(page);
      if (json == null) break;
      const items = arr(at(json, "items"));
      pages.push({ page, items });
      const pageCount = intOf(at(json, "pageCount")) ?? page;
      if (page >= pageCount || items.length === 0) {
        complete = true;
        break;
      }
      // The first load knows how many pages there are: the rest come in together (the Mac reads them one by one).
      if (!this.loaded && pageCount > page + 1) {
        const rest = await Promise.all(Array.from({ length: pageCount - page }, (_, i) => get(page + 1 + i)));
        if (rest.some((r) => r == null)) break;
        rest.forEach((r, i) => pages.push({ page: page + 1 + i, items: arr(at(r, "items")) }));
        complete = true;
        break;
      }
      page += 1;
    }
    if (signal?.aborted) return;
    this.read(pages, size, complete, homeTeamID);
  }

  /** Pages of plays read (pure apart from the feed's own state; tests call it with recorded pages). */
  read(pages: readonly { page: number; items: readonly JSONValue[] }[], size: number, complete: boolean, homeTeamID: string | null): void {
    const fresh: PitchAction[] = [];
    const raw: JSONValue[] = [];
    const newCards: Record<string, PitchAction> = {};
    const unplaced: LiveMoment[] = [];
    this.scale ??= pitchScale(pages.flatMap((p) => p.items));
    const scale = this.scale ?? "percent";
    for (const { page, items } of pages) {
      items.forEach((item, offset) => {
        const index = (page - 1) * size + offset;
        if (index < this.fetched) return;
        raw.push(item);
        const action = pitchAction(item, index, homeTeamID, scale);
        if (action) {
          fresh.push(action);
          this.recent = [...this.recent, action].slice(-6);
          return;
        }
        const card = placedCard(item, index, this.recent);
        if (card) {
          newCards[card.playID] = card;
          return;
        }
        // Its foul isn't in (late, or out of order): still news, just not placed.
        const m = cardMoment(item, homeTeamID);
        if (m) unplaced.push(m);
      });
      this.fetched = Math.max(this.fetched, (page - 1) * size + items.length);
    }
    // Until this page has had a complete load it's history; after, goals, shots and cards are news.
    if (this.primed) this.moments.push(...fresh.flatMap((a) => actionMoment(a) ?? []), ...Object.values(newCards).flatMap((a) => actionMoment(a) ?? []), ...unplaced);
    if (complete) this.primed = true;
    let changed = !this.loaded;
    this.loaded = true;
    if (raw.length > 0) {
      this.plays = [...this.plays, ...raw].slice(-THEATER_WINDOW);
      changed = true;
    }
    if (Object.keys(newCards).length > 0) {
      this.cards = { ...this.cards, ...newCards };
      changed = true;
    }
    if (fresh.length > 0) {
      const shots = fresh.filter((a) => a.kind === "shot" || a.kind === "goal");
      if (shots.length > 0) this.shots = [...this.shots, ...shots];
      this.trail = [...this.trail, ...fresh].slice(-TRAIL_LENGTH);
      changed = true;
    }
    if (changed) {
      this.version += 1;
      for (const l of this.listeners) l();
    }
  }

  /** The moments since the last call. */
  takeMoments(): LiveMoment[] {
    const out = this.moments;
    this.moments = [];
    return out;
  }
}

// MARK: - The pitch's small rules (PitchView)

/** "AVL 12 shots, 2 goals · MCI 9 shots, 1 goal". */
export function shotSummary(shots: readonly PitchAction[], topName: string, bottomName: string): string {
  const line = (side: Side, name: string) => {
    const mine = shots.filter((s) => s.side === side);
    const goals = mine.filter((s) => s.kind === "goal").length;
    return `${name} ${mine.length} ${mine.length === 1 ? "shot" : "shots"}, ${goals} ${goals === 1 ? "goal" : "goals"}`;
  };
  return `${line("top", topName)} · ${line("bottom", bottomName)}`;
}

/** The room the focused mark keeps clear around it (a card sits on its own). */
export function focusRoom(a: PitchAction): number | null {
  switch (a.kind) {
    case "yellow":
    case "red":
      return null;
    case "pass":
    case "other":
      return 7;
    default:
      return 10;
  }
}

/** "67'" → 67, "90'+5'" → 95, "HT" → 45 (DetailView.soccerMinute). */
export function soccerMinute(detail: string | null): number | null {
  if (!detail) return null;
  if (detail.toUpperCase() === "HT") return 45;
  const numbers = detail.split(/\D+/).filter(Boolean).map(Number);
  return numbers.length === 0 ? null : numbers.reduce((a, b) => a + b, 0);
}
