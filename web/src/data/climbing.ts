/**
 * A climbing round's page, from the IFSC results service (GameDetail.swift
 * `ClimbingDetail`; LiveSnapshot.swift `WallState`; the rules from
 * LiveViews.swift `LeadAscentView`, `ClimbingWallView`, `BoulderScorecard`
 * and CelebrateMatch.swift `MatchRules`).
 *
 * - The round's results: the ranking; lead routes with each climber's high
 *   point ("47+" is hold 47 and moving), topped climbers placed one hold
 *   above the best high point; boulder scorecards (zone, top, attempts, the
 *   problem being climbed); who climbs next; and the starting order, of this
 *   round before anyone finishes or of the next round before it starts.
 * - `wallStateFrom`: who's on the wall, for the scores list's tiles.
 * - The rules the page draws: places as a climber rises, who they pass next
 *   and how many holds it takes, where labels go on a crowded wall, and the
 *   moments: a top, a pass, a new leader, the medal zone, the final decided,
 *   a boulder topped (a flash on the first attempt) or zoned.
 *
 *     const part = await loadClimbingDetail(resultURL, nextURL, getJSON);
 */
import { arr, at, int, str, type JSONValue } from "./json";
import { resolveURL, type Fetcher } from "./http";
import type { Athlete, DetailOptions } from "./gameDetail";
import { ordinal } from "./format";
import { liveMoment, Tier, type Accent, type LiveMoment } from "./moments";
import type { EventState } from "./models";
import { IFSC_BASE } from "./providers/ifsc";
import { flagFromIOC } from "./teams";
import { boulderCard, capitalized, climberShort, kindOf, upNext, wallRoute, type BoulderCard, type Climber, type Reach, type UpNext, type WallRoute } from "./wallState";

export { boulderCard, upNext, wallCountry, wallDomain, wallRoute, wallStateFrom } from "./wallState";

// MARK: - Model

export { holds, moving, type BoulderCard, type Climber, type Problem, type Reach, type UpNext, type WallRoute } from "./wallState";

/** What a climbing round adds to the game page's detail. */
export interface ClimbingDetailPart {
  readonly roundName: string | null;
  /** IFSC's round status: "active", "finished", "pending". */
  readonly roundStatus: string | null;
  /** "lead", "boulder", "speed" (IFSC names it). */
  readonly discipline: string | null;
  readonly ranking: readonly Athlete[];
  readonly wall: readonly WallRoute[];
  readonly upNext: UpNext | null;
  readonly boulders: readonly BoulderCard[];
  readonly boulderProblems: readonly string[];
  /** The order for a round with no results yet (rank = start position): this round before anyone finishes, or the next round. */
  readonly startlist: readonly Athlete[];
  readonly startlistRound: string | null;
}

// MARK: - Parsing (ClimbingDetail)

/** The round's ranking: "Janja Garnbret", rank, score. */
export function parseRanking(results: JSONValue): Athlete[] {
  return arr(at(results, "ranking")).flatMap((a): Athlete[] => {
    const id = int(at(a, "athlete_id")) ?? int(at(a, "id"));
    if (id == null) return [];
    const first = str(at(a, "firstname"));
    const last = str(at(a, "lastname"));
    const name = `${first ?? ""} ${capitalized(last ?? "")}`.trim();
    const score = str(at(a, "score"));
    return [{ id, rank: int(at(a, "rank")) ?? null, name, country: str(at(a, "country")) ?? null, score: score ? score : null, short: climberShort(first, last) }];
  });
}

/** Who climbs in a round with no results yet, in order (rank is the start position). */
export function parseStartlist(results: JSONValue): Athlete[] {
  return arr(at(results, "startlist"))
    .flatMap((a): Athlete[] => {
      const id = int(at(a, "athlete_id"));
      if (id == null) return [];
      const name = [str(at(a, "firstname")), capitalized(str(at(a, "lastname")) ?? "")].filter(Boolean).join(" ");
      return [{ id, rank: int(at(a, "route_start_positions", 0, "position")) ?? null, name, country: str(at(a, "country")) ?? null, score: null }];
    })
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
}

/** One round's results, read whole (ClimbingDetail.load(_:)). */
export function parseRound(results: JSONValue): ClimbingDetailPart {
  const athletes = arr(at(results, "ranking"));
  const routes = arr(at(results, "routes")).flatMap((r) => str(at(r, "name")) ?? []);
  const kind = kindOf(results);
  const ascents = athletes.flatMap((a) => arr(at(a, "ascents")));
  let wall: WallRoute[] = [];
  let next: UpNext | null = null;
  let boulders: BoulderCard[] = [];
  let boulderProblems: string[] = [];
  if (kind.boulder) {
    boulderProblems = routes;
    // The top 12, plus whoever is climbing if they aren't placed yet.
    const cards = athletes.flatMap((a) => boulderCard(a, routes) ?? []);
    boulders = [...cards.slice(0, 12), ...cards.slice(12).filter((c) => c.onWall)];
  } else if (!kind.speed && ascents.length > 0) {
    wall = routes.map((name) => wallRoute(name, athletes)).filter((r) => r.climbers.length > 0);
    next = upNext(results, routes[0] ?? null);
  }
  const roundName = str(at(results, "round")) ?? null;
  const ranking = parseRanking(results);
  return {
    roundName,
    roundStatus: str(at(results, "status")) ?? null,
    discipline: kind.discipline,
    ranking,
    wall,
    upNext: next,
    boulders,
    boulderProblems,
    startlist: ranking.length === 0 ? parseStartlist(results) : [],
    startlistRound: ranking.length === 0 ? roundName : null,
  };
}

const EMPTY_PART: ClimbingDetailPart = {
  roundName: null,
  roundStatus: null,
  discipline: null,
  ranking: [],
  wall: [],
  upNext: null,
  boulders: [],
  boulderProblems: [],
  startlist: [],
  startlistRound: null,
};

/**
 * A round's page (ClimbingDetail.load): its results, and the next round's
 * starting order, which IFSC publishes before the round begins.
 */
export async function loadClimbingDetail(resultURL: string | null, nextURL: string | null, fetcher: Fetcher, options: DetailOptions = {}): Promise<ClimbingDetailPart> {
  const signal = options.signal;
  const [part, next] = await Promise.all([
    resultURL ? fetcher(resolveURL(resultURL, IFSC_BASE), { signal }).then(parseRound) : Promise.resolve(EMPTY_PART),
    nextURL && nextURL !== resultURL ? fetcher(resolveURL(nextURL, IFSC_BASE), { signal }).catch(() => null) : Promise.resolve(null),
  ]);
  if (next != null) {
    const order = parseStartlist(next);
    if (order.length > 0) return { ...part, startlist: order, startlistRound: str(at(next, "round")) ?? null };
  }
  return part;
}

// MARK: - Rules

/** A medal round: "Final", not a semi- or quarter-final (MatchRules.isFinalRound). */
export function isFinalRound(name: string | null | undefined): boolean {
  const lower = name?.toLowerCase();
  if (!lower || !lower.includes("final")) return false;
  return !lower.includes("semi") && !lower.includes("quarter");
}

/** One route, everyone on its startlist has climbed, and nobody is on the wall. */
export function decided(wall: readonly WallRoute[]): boolean {
  const route = wall[0];
  if (wall.length !== 1 || !route || route.total <= 0) return false;
  return route.climbers.length >= route.total && !route.climbers.some((c) => c.onWall);
}

/** The lead plot's height scale: at least 45 holds, and a few above the best high point. A top travels to it. */
export function plotScale(route: WallRoute): number {
  const best = Math.max(0, ...route.climbers.filter((c) => !c.top).map((c) => c.height));
  return Math.max(45, Math.ceil(best + 4));
}

/** Where a climber would place if they finished at this height. */
export function place(height: number, top: boolean, done: readonly Climber[]): number {
  return 1 + done.filter((c) => c.top || (!top && c.height > height)).length;
}

/** The next finished climber above a height: who the climber passes next (level counts: a tie isn't a pass). Null when leading or topped. */
export function nextTarget(height: number, top: boolean, done: readonly Climber[]): Climber | null {
  if (top) return null;
  let best: Climber | null = null;
  for (const c of done) {
    if (!(c.top || c.height >= height)) continue;
    const v = c.top ? Infinity : c.height;
    if (!best || v < (best.top ? Infinity : best.height)) best = c;
  }
  return best;
}

/**
 * "2 holds to 3rd", "1 hold to lead": what passing the next climber takes.
 * Heights are hold numbers (+0.5 for "+"), so passing 46+ means holding 47.
 * Null when leading, topped, or when only a top would do.
 */
export function holdsToGo(height: number, top: boolean, done: readonly Climber[]): string | null {
  const target = nextTarget(height, top, done);
  if (!target || target.top) return null;
  const need = target.height + 0.5;
  const count = Math.max(Math.ceil(need - height), 1);
  const at = place(need, false, done);
  return `${count} ${count === 1 ? "hold" : "holds"} to ${at === 1 ? "lead" : ordinal(at)}`;
}

/** IFSC's way of writing a height: "47", "47+", "Top". */
export function heightLabel(height: number, top: boolean): string {
  return top ? "Top" : height === Math.floor(height) ? `${height}` : `${Math.floor(height)}+`;
}

/** The climber a moment is about: "pass:<climber>:<passed>", "climb:<climber>:<route>". */
export function climberID(m: Pick<LiveMoment, "id">): number | null {
  const id = Number(m.id.split(":")[1]);
  return Number.isInteger(id) ? id : null;
}

/** The lead wall's geometry (LeadAscentView): the plot's insets and the gap between labels. */
export const ASCENT = { topInset: 18, bottomInset: 10, labelGap: 13 } as const;

/** How many labels fit down the wall, `labelGap` apart. */
export function labelCapacity(height: number): number {
  return Math.max(Math.floor((height - 8 - ASCENT.topInset) / ASCENT.labelGap) + 1, 1);
}

/**
 * Which finished climbers get a label when not all fit (a qualification
 * round's 40–80): your countries' climbers, then the best placed, up to
 * `capacity`. The rest are ticks, named on hover and when lit.
 */
export function labeled(done: readonly Climber[], yours: ReadonlySet<string>, capacity: number): Set<number> {
  if (done.length <= capacity) return new Set(done.map((c) => c.id));
  const ids = new Set(done.filter((c) => c.country != null && yours.has(c.country)).slice(0, capacity).map((c) => c.id));
  for (const c of done) if (ids.size < capacity) ids.add(c.id);
  return ids;
}

/**
 * Label heights that keep labels at least `gap` apart, top down, as close to
 * their marks as they can be, and between `ceiling` and `floor`.
 */
export function labelPositions(marks: readonly number[], gap: number, floor: number, ceiling = -Infinity): number[] {
  const out: number[] = [];
  marks.forEach((y, index) => out.push(index === 0 ? Math.max(y, ceiling) : Math.max(y, out[index - 1]! + gap)));
  // Pushed past the bottom: shift the stack back up, as far as the ceiling allows.
  const first = out[0];
  const last = out.at(-1);
  if (first != null && last != null && last > floor) {
    const shift = Math.min(last - floor, Math.max(first - ceiling, 0));
    return out.map((y) => y - shift);
  }
  return out;
}

const OMEGA = (2 * Math.PI) / 0.4;

/** `Motion.travel` (critically damped, 0.4 s) as a curve: how far along a move is `t` seconds in (Celebrate.travel). */
export function travel(t: number): number {
  if (t <= 0) return 0;
  return 1 - (1 + OMEGA * t) * Math.exp(-OMEGA * t);
}

/** When a `Motion.travel` move first reaches `fraction` of the way (Celebrate.travelTime). */
export function travelTime(fraction: number): number {
  const f = Math.min(Math.max(fraction, 0), 0.999);
  if (f <= 0) return 0;
  let low = 0;
  let high = 1.5;
  for (let i = 0; i < 32; i++) {
    const mid = (low + high) / 2;
    if (travel(mid) < f) low = mid;
    else high = mid;
  }
  return high;
}

/** A climber's move up the wall while its moment plays: where from and to, and each climber passed with when the dot reaches them. */
export interface Pass {
  readonly moment: string;
  readonly climber: number;
  readonly from: number;
  readonly to: number;
  /** Lowest first; `at` is seconds after the moment lands. */
  readonly knocks: readonly { readonly id: number; readonly at: number }[];
  /** When the tip flips to the new height and place, and the pill pops. */
  readonly flip: number;
}

/**
 * Works out a pass (LeadAscentView.pass). Each passed mark knocks when the
 * travel spring carrying the dot brings its center across the mark; marks
 * level with each other ripple 35 ms apart. The moment's `targets` win over
 * working it out from heights. With Reduce Motion the dot jumps, so the
 * marks flash in quick order instead.
 */
export function passFor(m: Pick<LiveMoment, "id" | "targets">, climber: Climber, from: number, done: readonly Climber[], scale: number, reduceMotion: boolean): Pass {
  const to = climber.top ? scale : climber.height;
  const ids = new Set((m.targets ?? []).map(Number).filter(Number.isFinite));
  const passed = done
    .map((c, offset) => ({ c, offset }))
    .filter(({ c }) => (ids.size === 0 ? !c.top && c.height >= from && c.height < to : ids.has(c.id)))
    .sort((a, b) => a.c.height - b.c.height || a.offset - b.offset)
    .map((x) => x.c);
  const knocks: { id: number; at: number }[] = [];
  passed.forEach((c, index) => {
    let time: number;
    if (reduceMotion) {
      time = 0.08 + 0.05 * index;
    } else {
      const f = to > from ? (c.height - from) / (to - from) : 0;
      time = Math.min(Math.max(travelTime(f), 0.04), 0.45);
      const last = knocks.at(-1);
      if (last && passed[index - 1]!.height === c.height) time = last.at + 0.035;
    }
    knocks.push({ id: c.id, at: time });
  });
  // A pass flips as the last climber is passed; a top as the dot reaches TOP.
  const arrives = reduceMotion ? 0.1 : travelTime(0.85);
  const lastKnock = knocks.at(-1)?.at;
  const flip = climber.top ? Math.max(lastKnock ?? 0, arrives) : (lastKnock ?? arrives);
  return { moment: m.id, climber: climber.id, from, to, knocks, flip };
}

/** New leader (1st, with someone below) and, in a final, into the medal zone for the first time this climb. */
function standing(now: { height: number; top: boolean }, then: { height: number; top: boolean }, done: readonly Climber[], final: boolean, passedAnyone: boolean): Accent[] {
  const at = place(now.height, now.top, done);
  const was = place(then.height, then.top, done);
  const accents: Accent[] = [];
  if (at === 1 && was > 1 && passedAnyone && done.length > 0) accents.push("newLeader");
  if (final && at <= 3 && was > 3) accents.push("podium");
  return accents;
}

/** The moment ID for a climber's top on a route. */
export const topMomentID = (climber: Pick<Climber, "id">, route: Pick<WallRoute, "name">) => `climb:${climber.id}:${route.name}`;

/** The part of a detail the climbing moments read. */
export interface ClimbingState {
  readonly wall: readonly WallRoute[];
  readonly boulders: readonly BoulderCard[];
  readonly boulderProblems: readonly string[];
  readonly roundName: string | null;
}

/**
 * Since the last refresh (MatchRules.climbingMoments): tops; in a final or
 * semi (one climber at a time), the climber passing someone's high point
 * (each climber passed, lowest first, in `targets`; the climb's from…to in
 * `span`), a new leader, the medal zone, where they finished; the final
 * decided; and on boulders, a top (captioned, a flash on the first attempt)
 * or a zone (the cell fills).
 */
export function climbingMoments(old: ClimbingState, next: ClimbingState): LiveMoment[] {
  const moments: LiveMoment[] = [];
  const single = next.wall.length === 1;
  const final = isFinalRound(next.roundName);
  for (const route of next.wall) {
    const before = old.wall.find((r) => r.name === route.name);
    const done = route.climbers.filter((c) => !c.onWall);
    for (const climber of route.climbers) {
      if (!climber.top) continue;
      const earlier = before?.climbers.find((c) => c.id === climber.id);
      if (!earlier || earlier.top) continue;
      if (single) {
        // A top passes everyone below it: the same knocks as a pass, all the way up.
        const others = done.filter((c) => c.id !== climber.id);
        const passed = others.filter((c) => !c.top && c.height >= earlier.height).sort((a, b) => a.height - b.height);
        moments.push(
          liveMoment({
            id: topMomentID(climber, route),
            chart: "ascent",
            tier: Tier.score,
            kind: "top",
            lead: "Top",
            detail: climber.name,
            targets: passed.map((c) => String(c.id)),
            span: [earlier.height, Math.max(earlier.height, plotScale(route))],
            accents: standing({ height: climber.height, top: true }, { height: earlier.height, top: false }, others, final, passed.length > 0),
          }),
        );
      } else {
        moments.push(liveMoment({ id: topMomentID(climber, route), chart: "wall", tier: Tier.swing, kind: "top", lead: "Top", detail: `${climber.name} · Route ${route.name}` }));
      }
    }
    if (!single || !before) continue;
    // Passing: the climber on the wall goes above someone's high point.
    const now = route.climbers.find((c) => c.onWall);
    const then = now ? before.climbers.find((c) => c.id === now.id) : undefined;
    if (now && !now.top && then && now.height > then.height) {
      const overtaken = done.filter((c) => !c.top && c.height >= then.height && c.height < now.height).sort((a, b) => a.height - b.height);
      const highest = overtaken.at(-1);
      if (highest) {
        const at = place(now.height, false, done);
        const accents = standing({ height: now.height, top: false }, { height: then.height, top: false }, done, final, true);
        const leads = accents.includes("newLeader");
        // A new leader in a final is the round's score.
        moments.push(
          liveMoment({
            id: `pass:${now.id}:${highest.id}`,
            chart: "ascent",
            tier: leads && final ? Tier.score : Tier.swing,
            kind: "passed",
            lead: leads && final ? "Takes the lead" : `Passes ${highest.name}`,
            detail: leads && final ? `${now.name} · passes ${highest.name}` : `${now.name} · ${at === 1 ? "leads" : `now ${ordinal(at)}`}`,
            targets: overtaken.map((c) => String(c.id)),
            span: [then.height, now.height],
            accents,
          }),
        );
      }
    }
    // Finished: whoever was on the wall is done (and didn't top).
    for (const climber of before.climbers) {
      if (!climber.onWall) continue;
      const after = route.climbers.find((c) => c.id === climber.id);
      if (!after || after.onWall || after.top) continue;
      const others = done.filter((c) => c.id !== after.id);
      moments.push(liveMoment({ id: `done:${after.id}`, chart: "ascent", tier: Tier.swing, kind: "finished", lead: after.label, detail: `${after.name} · ${ordinal(place(after.height, false, others))} for now` }));
    }
    // The final decided: the last starter is down. Gold, from the winner's mark.
    if (final && decided(next.wall) && !decided(old.wall)) {
      const winner = [...route.climbers].sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || (a.top ? 0 : 1) - (b.top ? 0 : 1) || b.height - a.height)[0];
      if (!winner) continue;
      // A top that decides it is the decisive moment itself (flag, knocks,
      // gold), not a second moment that would take the one celebration slot.
      const topIndex = moments.findLastIndex((m) => m.kind === "top" && m.chart === "ascent");
      if (topIndex >= 0) {
        const top = moments[topIndex]!;
        moments[topIndex] = { ...top, accents: new Set([...top.accents, "decisive"]) };
        continue;
      }
      moments.push(liveMoment({ id: `decided:${route.name}`, chart: "ascent", tier: Tier.score, kind: "finished", lead: "Final won", detail: `${winner.name} · ${winner.label}`, targets: [String(winner.id)], accents: ["decisive"] }));
    }
  }
  // Boulder: a top (captioned) or a zone (the cell fills) on any problem.
  for (const card of next.boulders) {
    const before = old.boulders.find((c) => c.id === card.id);
    if (!before) continue;
    card.problems.forEach((problem, index) => {
      if (index >= before.problems.length) return;
      const was = before.problems[index]!.reach;
      const name = next.boulderProblems[index] ?? String(index + 1);
      const tries = problem.tries == null ? null : problem.tries === 1 ? "flash" : `${ordinal(problem.tries)} attempt`;
      if (problem.reach === "top" && was !== "top") {
        moments.push(
          liveMoment({
            id: `boulder:${card.id}:${index}:top`,
            chart: "boulder",
            tier: Tier.swing,
            kind: "top",
            lead: "Top",
            detail: [`${card.name} on B${name}`, tries].filter(Boolean).join(", "),
            accents: problem.tries === 1 ? ["flash"] : [],
          }),
        );
      } else if (problem.reach === "zone" && (was === "none" || was === "lowZone")) {
        moments.push(liveMoment({ id: `boulder:${card.id}:${index}:zone`, chart: "boulder", tier: Tier.routine, kind: "zone", lead: "Zone", detail: `${card.name} on B${name}` }));
      }
    });
  }
  return moments;
}

/** Places gained (positive) or lost per athlete ID between two live readings of the same round. New and unranked athletes have none. */
export function rankDeltas(old: readonly Athlete[], next: readonly Athlete[]): Map<number, number> {
  const before = new Map<number, number>();
  for (const a of old) if (a.rank != null && !before.has(a.id)) before.set(a.id, a.rank);
  const deltas = new Map<number, number>();
  for (const a of next) {
    const was = before.get(a.id);
    if (a.rank == null || was == null || was === a.rank) continue;
    deltas.set(a.id, was - a.rank);
  }
  return deltas;
}

/** Tops, and zones (a top counts as a zone too). */
export function boulderTotals(card: Pick<BoulderCard, "problems">): { tops: number; zones: number } {
  return { tops: card.problems.filter((p) => p.reach === "top").length, zones: card.problems.filter((p) => p.reach === "top" || p.reach === "zone").length };
}

export const REACH_LABEL: Readonly<Record<Reach, string>> = { top: "Top", zone: "Zone", lowZone: "Low zone", none: "No zone" };

/** IFSC marks a round active hours early; it's live once the page's event is. */
export const roundLive = (d: Pick<ClimbingDetailPart, "roundStatus">, state: EventState): boolean => d.roundStatus === "active" && state === "live";

/**
 * The hero's line from the round's own ranking, worded as the scores list
 * words it from the same IFSC results (Providers.swift's summary): "Final ·
 * Leader 🇸🇮 L. Rakovec". The page reads the round every 4 s and the list's
 * copy can lag it by a poll, so the hero's leader and the results' first
 * place always agree. A climber still on the wall has no place yet: the
 * ascent shows her provisional one, as the Mac's does. Null when the round
 * isn't live or nobody is placed (the scoreboard's line stands).
 */
export function liveFieldSummary(d: Pick<ClimbingDetailPart, "roundName" | "roundStatus" | "ranking">, state: EventState): string | null {
  if (!roundLive(d, state)) return null;
  const first = d.ranking.find((a) => a.rank === 1);
  if (!first) return null;
  const leader = [flagFromIOC(first.country), first.short ?? first.name].filter(Boolean).join(" ");
  return [d.roundName, `Leader ${leader}`].filter(Boolean).join(" · ");
}

/**
 * The country the page is dressed in (DetailView.washCountry): whoever is on
 * the wall while live, else the round's leader or winner.
 */
export function washCountry(d: Pick<ClimbingDetailPart, "wall" | "boulders" | "ranking">, live: boolean): string | null {
  if (live) {
    const climber = d.wall.flatMap((r) => r.climbers).find((c) => c.onWall);
    if (climber) return climber.country;
    const card = d.boulders.find((c) => c.onWall);
    if (card) return card.country;
  }
  return d.ranking.find((a) => a.rank === 1)?.country ?? null;
}

/** "J. Garnbret" → "Garnbret"; single names stay (MatchMark.surname). */
export function surname(name: string): string {
  const parts = name.split(" ");
  return parts.length > 1 && parts[0]!.endsWith(".") ? parts.slice(1).join(" ") : name;
}

/** The docked bar's climber line: on the wall now, else up next, else the round's winner (DockBar.climber). */
export interface DockClimber {
  /** "Up next", "Winner"; null while someone climbs. */
  readonly prefix: string | null;
  readonly flag: string | null;
  readonly name: string;
  /** Lead: the high point ("28+", "Top"), and where that puts them now. */
  readonly height: string | null;
  readonly place: number | null;
  /** Boulder: the problem they're on ("B3") and their tally ("2T 3Z"). */
  readonly boulder: string | null;
  readonly tally: string | null;
}

export function dockClimber(d: Pick<ClimbingDetailPart, "wall" | "boulders" | "boulderProblems" | "upNext" | "ranking">, state: EventState): DockClimber | null {
  const base = { prefix: null, height: null, place: null, boulder: null, tally: null };
  if (state === "live") {
    for (const route of d.wall) {
      const c = route.climbers.find((x) => x.onWall);
      if (!c) continue;
      const done = route.climbers.filter((x) => !x.onWall && x.id !== c.id);
      return { ...base, flag: c.flag ?? flagFromIOC(c.country), name: surname(c.name), height: c.label, place: place(c.height, c.top, done) };
    }
    const card = d.boulders.find((c) => c.onWall);
    if (card) {
      const on = card.problems.findIndex((p) => p.active);
      const problem = on >= 0 ? (d.boulderProblems[on] ?? String(on + 1)) : null;
      const totals = boulderTotals(card);
      return { ...base, flag: card.flag ?? flagFromIOC(card.country), name: surname(card.name), boulder: problem ? `B${problem}` : null, tally: `${totals.tops}T ${totals.zones}Z` };
    }
    if (d.upNext) return { ...base, prefix: "Up next", flag: d.upNext.flag, name: surname(d.upNext.name) };
  }
  const winner = d.ranking.find((a) => a.rank === 1);
  if ((state === "final" || decided(d.wall)) && winner) return { ...base, prefix: "Winner", flag: flagFromIOC(winner.country), name: surname(winner.name) };
  return null;
}

/** Which round the wall shows, and why, so a previous round is never mistaken for the current one (DetailView.wallCaption). */
export function wallCaption(d: Pick<ClimbingDetailPart, "roundName" | "roundStatus">, event: { state: EventState; start: number; round: string | null }, when: (start: number) => string): string {
  const shown = d.roundName ?? "This round";
  if (roundLive(d, event.state)) return `Live from the ${shown.toLowerCase()}. Bars rise as climbers move up.`;
  if (event.round && event.round !== d.roundName && event.state !== "final") {
    if (event.state === "live") return `${event.round} results aren't in yet. Showing ${shown.toLowerCase()}.`;
    const starts = event.start > Date.now() ? ` starts ${when(event.start)},` : "";
    return `Final heights from ${shown.toLowerCase()}. ${event.round}${starts} and this switches to it live.`;
  }
  return `${shown}: how high each climber got. Top 8 per route.`;
}

/** The results' caption: how this discipline scores (DetailView.resultsCaption). */
export function resultsCaption(category: string, roundName: string | null): string {
  const c = category.toLowerCase();
  const round = (roundName ?? "").toLowerCase();
  if (c.includes("speed")) return round.includes("qualif") ? "Fastest time in seconds. Lower is better." : "Places come from head-to-head races, not the fastest time. Seconds; earlier best in brackets.";
  if (c.includes("boulder")) return "Points for tops and zones, less for extra attempts.";
  if (round.includes("qualif")) return "Score combines places on both routes. Lower is better.";
  return "Score is the highest hold reached. Top means finished.";
}

/** Gold, silver, bronze, for a place on a final's podium. */
export const medalName = (place: number): "gold" | "silver" | "bronze" | null => (place === 1 ? "gold" : place === 2 ? "silver" : place === 3 ? "bronze" : null);

/** The ranking list: the top 12, plus athletes from your countries placed lower (RankingList). */
export function rankingRows(athletes: readonly Athlete[], countries: ReadonlySet<string>): { top: readonly Athlete[]; yoursBelow: readonly Athlete[] } {
  return { top: athletes.slice(0, 12), yoursBelow: athletes.slice(12).filter((a) => a.country != null && countries.has(a.country)) };
}
