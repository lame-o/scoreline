/**
 * Names on the isometric views (TheaterNames.swift), in the broadcast tag
 * the theaters already speak: the status tag's type (condensed black,
 * slanted 12°) on a slab in the color the figure wears, cut on the same
 * lean. The pointer names whoever it's over (his number on the stripe's
 * color, his SURNAME, his position); at rest the man the moment is about
 * keeps his surname over his head; a figure the theater placed without data
 * says only what's known ("SEAHAWKS · DE", "JAZZ"), and officials, umpires
 * and coaches never get one.
 *
 * Each sport's theater says who each figure in its script is and who the
 * moment is about (its `TheaterCast`, built once per script from the game's
 * own data, never guessed). This file is the pure half every theater shares:
 * the cast, each side's paint, the pointer's comings and goings, where a tag
 * goes (inside the well, clear of the status tag, the heartbeat, the turn
 * control, the stamp and the headline, the pointer's first: the key man's
 * steps under his feet when it needs the room, or waits) and the hit test
 * (from the script at t alone: each figure's spot, the lens there, a box
 * from his ground point and height; no posing). The tag itself, drawn into
 * each frame, is features/game/core/theater/theaterTags.ts.
 *
 * A tag and the play never block each other. A tag sits where the other
 * men and the ball cover it least through its stretch of the replay (over
 * his head, nudged aside, or under his feet), chosen once for the stretch
 * from the script alone (`TheaterTagPlan`), so it rides with him and never
 * wanders. Where every spot round him stays crowded, it's raised clear of the
 * crowd as a broadcast callout, by as little as clears it, on a stem down to
 * just over his head.
 *
 * Motion, Emil's and Apple's way: a tag fades in over 120 ms with a 2 pt
 * rise, ease-out, and leaves faster (100 ms); moving straight from one man
 * to the next swaps at once, as tooltips do after the first; with Reduce
 * Motion it fades without the rise. A tag never moves on its own while the
 * pointer is still: the stage keeps only who the pointer is over, changed
 * when it crosses to another man. The key man's tag, when the moment passes
 * to the next man, glides over to him in 200 ms on a strong ease-in-out, the
 * names crossfading (a crossfade alone with Reduce Motion), a function of t.
 */
import type { Rect } from "../mlb/playCamera";
import { cubicBezier, houseCurve, type Point } from "../mlb/theaterField";
import { dress, type TheaterKits } from "../mlb/theaterTeams";
import type { Side } from "../models";
import { SLIDE_LEAN, teamPaint, type SlidePaint } from "../scoringSlide";
import type { Scheme } from "../teamColors";
import { intersects, maxX, maxY } from "./theaterKit";
import type { TheaterPerson } from "./theaterPeople";

export { afterInitials, athletePerson, surname, theaterPerson, TheaterPeople, type TheaterPerson } from "./theaterPeople";

// MARK: - Who

/** Who a figure is, as far as the data says: never more. */
export type TheaterWho =
  /** Named: the play credits him, or the lineup puts him where he's drawn. */
  | { readonly kind: "known"; readonly person: TheaterPerson }
  /** A man the theater placed without data: his team and his position are all that's known ("SEAHAWKS · DE"). */
  | { readonly kind: "assumed"; readonly position: string }
  /** On the field for his team; which of them isn't known ("JAZZ"). */
  | { readonly kind: "team" };

export const known = (person: TheaterPerson): TheaterWho => ({ kind: "known", person });
export const assumed = (position: string): TheaterWho => ({ kind: "assumed", position });
export const TEAM_ONLY: TheaterWho = { kind: "team" };

export const personOf = (who: TheaterWho | undefined): TheaterPerson | null => (who?.kind === "known" ? who.person : null);

export interface CastMember {
  readonly who: TheaterWho;
  readonly side: Side;
  /**
   * Who he is across scripts (his athlete ID when he's named), so the
   * pointer's tag stays with the man, not the figure's number in the next
   * beat's script; a man the data can't name is his figure's own.
   */
  readonly id: string;
}

/** The key man from a moment on (null figure: nobody), in order. */
export interface CastKey {
  readonly from: number;
  readonly figure: number | null;
}

/** A stretch of a script's time: from `from` up to (not including) `to`. */
export interface Stretch {
  readonly from: number;
  readonly to: number;
}

/** The whole replay: the pointer's man's stretch. */
export const WHOLE: Stretch = { from: -Infinity, to: Infinity };

/** The key tag's glide at a handoff (Celebrate.sweepCurve): a strong ease-in-out. */
const sweep = cubicBezier(0.77, 0, 0.175, 1);

/**
 * Who each figure of a script is, for his side, and who the moment is
 * about: what a sport's theater says about its figures, built once per
 * script. Officials, umpires and coaches aren't in it (no tag, ever).
 */
export class TheaterCast {
  constructor(
    /** By figure (the script's index). */
    readonly members: ReadonlyMap<number, CastMember> = new Map(),
    readonly keys: readonly CastKey[] = [],
    /** The script's own (the stage's key for it): where its tags sit is chosen once for it. */
    readonly scope = "",
  ) {}

  /** One key man for the whole moment. */
  static of(members: ReadonlyMap<number, CastMember>, key: number | null, scope = ""): TheaterCast {
    return new TheaterCast(members, key == null ? [] : [{ from: -Infinity, figure: key }], scope);
  }

  /** A named man's member, or one the data knows less about (`scope`: the script's own, so an unnamed figure is never mistaken for another's). */
  static member(who: TheaterWho, side: Side, athlete: string | null | undefined, figure: number, scope: string): CastMember {
    if (who.kind === "known" && athlete) return { who, side, id: `a:${athlete}` };
    return { who, side, id: `${scope}#${figure}` };
  }

  /** The man the moment is about at t: never one the data doesn't name. */
  key(t: number): number | null {
    const figure = this.keys.findLast((k) => t >= k.from)?.figure ?? null;
    if (figure == null || personOf(this.members.get(figure)?.who) == null) return null;
    return figure;
  }

  /** The stretch of the script the key man at t is key through: until the next one. */
  stretch(t: number): Stretch {
    const i = this.keys.findLastIndex((k) => t >= k.from);
    if (i < 0) return { from: -Infinity, to: this.keys[0]?.from ?? Infinity };
    return { from: this.keys[i]!.from, to: i + 1 < this.keys.length ? this.keys[i + 1]!.from : Infinity };
  }

  /** How long the key man's tag takes to go over to the next one (or to come, or to go), in seconds. */
  static readonly handoff = 0.2;

  /**
   * Just after the key man changes, the tag on its way from the last one:
   * who had it (null: nobody named) and through what stretch, and how far
   * it's come (0…1, eased in and out, as a move across the well is). Null
   * once it's there. (pure; tested)
   */
  handoff(t: number): { from: number | null; stretch: Stretch; u: number } | null {
    const i = this.keys.findLastIndex((k) => t >= k.from);
    if (i <= 0) return null;
    const at = this.keys[i]!.from;
    if (!Number.isFinite(at) || !(t - at < TheaterCast.handoff)) return null;
    const last = this.keys[i - 1]!.figure;
    const from = last != null && personOf(this.members.get(last)?.who) != null ? last : null;
    if (from == null && this.key(t) == null) return null;
    return { from, stretch: { from: this.keys[i - 1]!.from, to: at }, u: sweep((t - at) / TheaterCast.handoff) };
  }

  /** The figure a member's id is, in this script. */
  figure(id: string | null): number | null {
    if (id == null) return null;
    for (const [figure, m] of this.members) if (m.id === id) return figure;
    return null;
  }
}

export const NO_CAST = new TheaterCast();

// MARK: - Paint

/** How a side's tags look: its name (all a man the data can't name says) and the slab's paint. */
export interface TagLabel {
  /** "Seahawks": the tag capitalizes it. */
  readonly team: string;
  readonly paint: SlidePaint;
}

export interface TheaterLabels {
  readonly top: TagLabel;
  readonly bottom: TagLabel;
}

/**
 * Each side's tags, in the color its figures wear (`dress` on this panel):
 * the slab in the shirt's own color as it's drawn (black lifted to a gray
 * on a dark panel, as the figures are), the stripe in the team's other
 * color; a team in its second color striped in its own (so a tag never
 * reads as the other side's); a team in whites labeled in its own color.
 * (pure; tested)
 */
export function theaterLabels(kits: TheaterKits | null, scheme: Scheme, teams: { readonly top: string; readonly bottom: string }): TheaterLabels {
  if (!kits) return { top: { team: teams.top, paint: teamPaint(null, null) }, bottom: { team: teams.bottom, paint: teamPaint(null, null) } };
  const dressed = dress(kits, scheme);
  const paint = (side: Side): SlidePaint => {
    const worn = dressed[side];
    const kit = kits[side];
    const rule = dressed.rule;
    if (rule.kind === "second" && rule.side === side) return teamPaint(worn.jersey ?? kit.alternate, kit.color);
    if (rule.kind === "whites" && rule.side === side) return teamPaint(kit.color, kit.alternate);
    return teamPaint(worn.jersey ?? kit.color, kit.alternate);
  };
  return { top: { team: teams.top, paint: paint("top") }, bottom: { team: teams.bottom, paint: paint("bottom") } };
}

// MARK: - The pointer

/**
 * The pointer over a theater: the man it's over (a cast member's id), and
 * his tag's comings and goings. Changed only when the pointer crosses to
 * another man; everything else is a function of the time (ms,
 * performance.now()). (pure; tested)
 */
export class TheaterPointer {
  over: string | null = null;
  since = -Infinity;
  /** Came in from no tag (it fades in); else it swapped in at once. */
  fades = false;
  /** The tag leaving as the pointer left its man, since when. */
  leaving: string | null = null;
  left = -Infinity;

  static readonly fadeIn = 120;
  static readonly fadeOut = 100;
  /** The rise as it fades in, in points. */
  static readonly rise = 2;
  /** Long enough for whatever's fading now to finish. */
  static readonly settle = Math.max(TheaterPointer.fadeIn, TheaterPointer.fadeOut) + 20;

  /** Onto a man (or off every one): whether anything changed. */
  move(id: string | null, now: number): boolean {
    if (id === this.over) return false;
    if (id != null) {
      // Straight from another man (or one still leaving): at once, as tooltips after the first.
      const showing = this.over != null || (this.leaving != null && now - this.left < TheaterPointer.fadeOut);
      this.over = id;
      this.since = now;
      this.fades = !showing;
      this.leaving = null;
    } else {
      this.leaving = this.over;
      this.left = now;
      this.over = null;
    }
    return true;
  }

  /** How far the pointer's tag has come in at `now` (0…1, eased out). */
  appear(now: number): number {
    if (!this.fades) return 1;
    return houseCurve(Math.min(Math.max((now - this.since) / TheaterPointer.fadeIn, 0), 1));
  }

  /** How much of the leaving tag is left at `now` (1…0, eased out). */
  remaining(now: number): number {
    if (this.leaving == null) return 0;
    return 1 - houseCurve(Math.min(Math.max((now - this.left) / TheaterPointer.fadeOut, 0), 1));
  }

  /** A tag is still coming in or going: the stage draws until it's done. */
  fading(now: number): boolean {
    return (this.fades && this.over != null && now - this.since < TheaterPointer.fadeIn) || (this.leaving != null && now - this.left < TheaterPointer.fadeOut);
  }
}

// MARK: - What a frame draws

/** The heartbeat's corner, or none. */
export type HeartbeatEdge = "leading" | "trailing" | null;

/**
 * The tags a frame draws over its figures, as of one instant: the pointer's
 * (the full tag), one leaving, and the key man's (his surname). Built by the
 * stage for each frame from the cast, the pointer and what to keep clear of.
 */
export interface TagFrame {
  readonly cast: TheaterCast;
  readonly labels: TheaterLabels;
  /** The pointer's man and how far in his tag is; the one leaving and how much of it is left. */
  readonly over: string | null;
  readonly appear: number;
  readonly leaving: string | null;
  readonly remaining: number;
  /** Reduce Motion: a fade, no rise. */
  readonly rise: boolean;
  /** What to keep clear of: the status tag's words, the turn control (up while the pointer's over the theater), the heartbeat's corner. */
  readonly status: string | null;
  readonly flip: boolean;
  readonly heartbeat: HeartbeatEdge;
}

/** The tags as of `now`: the pointer's state read once for the frame. */
export function tagFrame(
  cast: TheaterCast,
  labels: TheaterLabels,
  pointer: TheaterPointer,
  now: number,
  options: { readonly reduceMotion: boolean; readonly status: string | null; readonly flip: boolean; readonly heartbeat?: HeartbeatEdge },
): TagFrame {
  return {
    cast,
    labels,
    over: pointer.over,
    appear: pointer.appear(now),
    leaving: pointer.leaving,
    remaining: pointer.remaining(now),
    rise: !options.reduceMotion,
    status: options.status,
    flip: options.flip,
    heartbeat: options.heartbeat === undefined ? "trailing" : options.heartbeat,
  };
}

/** Who's tagged at t: the pointer's man, the one leaving, the key man (not when the pointer's on him). (pure; tested) */
export function shownTags(frame: TagFrame, t: number): { pointer: number | null; leaving: number | null; key: number | null } {
  const pointer = frame.cast.figure(frame.over);
  const leavingFigure = frame.remaining > 0.01 ? frame.cast.figure(frame.leaving) : null;
  const leaving = leavingFigure === pointer ? null : leavingFigure;
  const keyFigure = frame.cast.key(t);
  return { pointer, leaving, key: keyFigure === pointer ? null : keyFigure };
}

/** The key man's tag on its way over from the last one at t (not the pointer's man's). (pure; tested) */
export function tagHandoff(frame: TagFrame, t: number): { from: number | null; stretch: Stretch; u: number } | null {
  const h = frame.cast.handoff(t);
  if (!h) return null;
  return { ...h, from: h.from != null && h.from === frame.cast.figure(frame.over) ? null : h.from };
}

/** The tag's type size, from the well's height: a step under the status tag's. */
export const tagType = (height: number) => Math.min(Math.max(height * 0.046, 9), 11.5);

/**
 * How far into the picture a man coming up over the well's bottom edge is:
 * his tag comes in with the first few points of him. (pure; tested)
 */
export const tagEntering = (ask: TagAsk, size: Size) => Math.min(Math.max((size.height - 1 - ask.head.y) / 6, 0), 1);

/** A stem's width, his `height` tall: a hairline in the compact panel's small figures, a point in its usual ones, no more in a wide well's. */
export const stemWidth = (height: number) => Math.min(Math.max(height * 0.04, 0.75), 1);

/** The ring's width past a man's own outline, `height` tall: about 1.5 pt at the compact panel, with his line weight. */
export const ringWidth = (height: number) => Math.max(height * 0.06, 1.1);

// MARK: - Placement

/**
 * Where round its man a tag goes first: over his head (its middle nudged
 * across by a share of its width), or under his feet; or raised clear of
 * the crowd round him (`lift`: how far, in his own heights), a callout on a
 * stem down to him.
 */
export interface TheaterTagSpot {
  readonly nudge: number;
  readonly under: boolean;
  readonly lift: number;
}

export const tagSpot = (nudge = 0, under = false, lift = 0): TheaterTagSpot => ({ nudge, under, lift });
const OVER = tagSpot();

interface Size {
  readonly width: number;
  readonly height: number;
}

/**
 * What a tag asks for: its size, the top of its man's head (and his
 * middle), where under his feet it could go, and whether it's the
 * pointer's; where round him it goes first (its stretch's choice) and where
 * next when that's taken (its stretch's next best, in order); and where he
 * stands and how tall, which a raised tag rides from (so it holds its height
 * over him, never bobbing with his arms).
 */
export interface TagAsk {
  readonly size: Size;
  readonly head: Point;
  readonly feet: number;
  readonly pointer: boolean;
  readonly spot?: TheaterTagSpot;
  readonly then?: readonly TheaterTagSpot[];
  readonly ground?: Point | null;
  /** His height, in points. */
  readonly height?: number;
}

/** A stem's line: from the slab's bottom edge down to just over his head. */
export interface StemLine {
  readonly from: Point;
  readonly to: Point;
}

const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
const inset = (r: Rect, dx: number, dy: number): Rect => rect(r.x + dx, r.y + dy, r.width - 2 * dx, r.height - 2 * dy);
const contains = (r: Rect, p: Point) => p.x >= r.x && p.x < maxX(r) && p.y >= r.y && p.y < maxY(r);
/** How much two rects share (0 when they don't meet). */
const overlap = (a: Rect, b: Rect) => Math.max(Math.min(maxX(a), maxX(b)) - Math.max(a.x, b.x), 0) * Math.max(Math.min(maxY(a), maxY(b)) - Math.max(a.y, b.y), 0);

/** Where tags go. (pure; tested) */
export const TheaterTagLayout = {
  /** From the well's edges. */
  margin: 4,
  /** Between a tag and his head (or his feet), and round another tag. */
  gap: 3,
  /** How far short of him a stem stops: just over his head. */
  reach: 2.5,
  /**
   * The shortest stem worth drawing. A tag nearer him than this (over his
   * head, nudged, under his feet) is plainly his without one; a stem shorter
   * than this is a tick lost against him.
   */
  shortest: 4,

  /**
   * Each tag's place, in order (the pointer's first: it wins). Where its
   * spot puts it (over his head, or nudged aside, or under his feet; or
   * raised clear of a crowd, sunk under or slid along off what's over it),
   * inside the well and clear of the furniture; else on his other side
   * (under his feet first when he's too near the top for a tag over him);
   * else slid along off what's in the way. The pointer's always shows; any
   * other only where it and its stem are clear of the furniture and the tags
   * (and stems) already placed, else not at all (it waits for the room). A
   * man out of the well gets none.
   */
  place(asks: readonly TagAsk[], size: Size, furniture: readonly Rect[]): (Rect | null)[] {
    const L = TheaterTagLayout;
    const placed: Rect[] = [];
    const stems: Rect[] = [];
    const out: (Rect | null)[] = [];
    for (const ask of asks) {
      if (!L.inWell(ask, size)) {
        out.push(null);
        continue;
      }
      const free = (r: Rect) => {
        if (furniture.some((f) => intersects(f, r)) || placed.some((p) => intersects(inset(p, -L.gap, -L.gap + 1), r)) || stems.some((s) => intersects(s, r))) return false;
        const s = L.stem(r, ask, size);
        return s ? !placed.some((p) => intersects(p, L.stemBox(s))) : true;
      };
      const take = (r: Rect) => {
        placed.push(r);
        const s = L.stem(r, ask, size);
        if (s) stems.push(L.stemBox(s));
        out.push(r);
      };
      const [above, below] = L.sides(ask);
      const over = L.clamp(above, size);
      const under = L.clamp(below, size);
      // Kept inside the well by more than a hair, a tag would sit on his own head (or feet): only a side with room
      // (the pointer's goes anywhere as a last resort).
      const up = above.y >= L.margin - 1 ? [over] : [];
      const down = maxY(below) <= size.height - L.margin + 1 ? [under] : [];
      const first = (ask.spot ?? OVER).under ? [...down, ...up] : [...up, ...down];
      // Its spot first, then its stretch's next best (so a tag the pointer's has pushed off its place goes where the
      // crowd covers it least, not into it), then its other side, slid along.
      const candidates = [...[ask.spot ?? OVER, ...(ask.then ?? [])].flatMap((spot) => L.at(spot, ask, size, furniture)), ...first, ...first.map((r) => L.slid(r, furniture, size))];
      if (ask.pointer) candidates.push(over, under, L.slid(over, furniture, size), L.slid(under, furniture, size));
      const spot = candidates.find(free);
      if (spot) take(spot);
      // The pointer's tag always shows: off the furniture if it can be, over the others.
      else if (ask.pointer) take(candidates.find((r) => !furniture.some((f) => intersects(f, r))) ?? over);
      else out.push(null);
    }
    return out;
  },

  /**
   * Whether a tag's man is in the well (one out of it gets none; nor one
   * under its bottom edge, his head and all, whose tag held at the edge would
   * name nobody in the picture).
   */
  inWell(ask: TagAsk, size: Size): boolean {
    const well = rect(0, 0, size.width, size.height);
    return ask.head.y < size.height - 1 && (contains(inset(well, -2, -ask.size.height), ask.head) || contains(well, { x: ask.head.x, y: ask.feet }));
  },

  /** A tag's two sides of its man, as its spot nudges them: over his head and under his feet. */
  sides(ask: TagAsk): [over: Rect, under: Rect] {
    const { width, height } = ask.size;
    const x = ask.head.x + (ask.spot ?? OVER).nudge * width - width / 2;
    return [rect(x, ask.head.y - TheaterTagLayout.gap - height, width, height), rect(x, ask.feet + TheaterTagLayout.gap, width, height)];
  },

  /**
   * Where a spot puts a tag round him, if there's room on that side: over
   * his head, nudged, under his feet; or raised clear of a crowd, then sunk
   * under what's over it, or slid along off it.
   */
  at(spot: TheaterTagSpot, ask: TagAsk, size: Size, furniture: readonly Rect[]): Rect[] {
    const L = TheaterTagLayout;
    const asked: TagAsk = { ...ask, spot };
    if (spot.lift > 0) {
      const r = L.raised(asked, size);
      return r ? [r, L.sunk(r, furniture, asked), L.slid(r, furniture, size)] : [];
    }
    const [above, below] = L.sides(asked);
    if (spot.under) return maxY(below) <= size.height - L.margin + 1 ? [L.clamp(below, size)] : [];
    return above.y >= L.margin - 1 ? [L.clamp(above, size)] : [];
  },

  /**
   * A tag raised clear of a crowd: `lift` of his heights over the spot over
   * his head, a fixed offset from where he stands. Near the well's top it
   * sinks back toward him rather than leave it, never nearer than over his
   * head; null when it isn't raised, or there's no room over him at all.
   * (pure; tested)
   */
  raised(ask: TagAsk, size: Size): Rect | null {
    const L = TheaterTagLayout;
    const [above] = L.sides(ask);
    const spot = ask.spot ?? OVER;
    const ground = ask.ground;
    const height = ask.height ?? 0;
    if (!(spot.lift > 0) || !ground || !(height > 0) || !(above.y >= L.margin - 1)) return null;
    const { width, height: tall } = ask.size;
    const y = ground.y - height - L.gap - tall - spot.lift * height;
    return L.clamp(rect(ground.x + spot.nudge * width - width / 2, Math.min(Math.max(y, L.margin), above.y), width, tall), size);
  },

  /** A raised tag dropped just under the furniture it meets (the headline over the play, the status tag in its corner), still over his head. */
  sunk(r: Rect, furniture: readonly Rect[], ask: TagAsk): Rect {
    let moved = r;
    for (const f of furniture) if (intersects(f, moved)) moved = { ...moved, y: Math.max(moved.y, maxY(f) + 2) };
    return maxY(moved) <= ask.head.y - TheaterTagLayout.gap + 0.01 ? moved : r;
  },

  /** Slid along off whatever furniture it meets, toward the middle, and kept in the well. */
  slid(r: Rect, furniture: readonly Rect[], size: Size): Rect {
    let moved = r;
    for (const f of furniture) {
      if (!intersects(f, moved)) continue;
      const x = moved.x + moved.width / 2 > f.x + f.width / 2 ? maxX(f) + 2 : f.x - 2 - moved.width;
      moved = TheaterTagLayout.clamp({ ...moved, x }, size);
    }
    return moved;
  },

  /** Kept inside the well, `margin` from its edges. */
  clamp(r: Rect, size: Size): Rect {
    const m = TheaterTagLayout.margin;
    return {
      x: Math.min(Math.max(r.x, m), Math.max(size.width - m - r.width, m)),
      y: Math.min(Math.max(r.y, m), Math.max(size.height - m - r.height, m)),
      width: r.width,
      height: r.height,
    };
  },

  /**
   * A tag's stem to its man where it's raised clear of him (or pushed up off
   * what's in the way), as a broadcast callout's: straight down from its
   * bottom edge over his head (or its nearest end, inside the slab's cut
   * corner), tucked under the slab, to just over his head. None where it
   * would be shorter than `shortest` (a tag round him), or he's under the
   * well's edge (his tag held at it). (pure; tested)
   */
  stem(r: Rect, ask: TagAsk, size: Size): StemLine | null {
    const L = TheaterTagLayout;
    if (!(maxY(r) <= ask.head.y - L.reach - L.shortest) || !(ask.head.y - L.reach <= size.height - L.margin)) return null;
    // Its bottom edge runs from the leading corner to the trailing cut.
    const x = Math.min(Math.max(ask.head.x, r.x + 2), maxX(r) - r.height * SLIDE_LEAN - 2);
    return { from: { x, y: maxY(r) - 0.5 }, to: { x: ask.head.x, y: ask.head.y - L.reach } };
  },

  /** The room a stem takes, for placement: its line, a little wide. */
  stemBox(s: StemLine): Rect {
    return inset(rect(Math.min(s.from.x, s.to.x), Math.min(s.from.y, s.to.y), Math.abs(s.to.x - s.from.x), Math.abs(s.to.y - s.from.y)), -1, 0);
  },

  /**
   * The theater's furniture: the status tag at the top leading corner
   * (`status`: its size), the turn control at the top trailing one while the
   * pointer's over the theater, the heartbeat at a bottom corner.
   */
  furniture(size: Size, status: Size | null, flip: boolean, heartbeat: HeartbeatEdge): Rect[] {
    const out: Rect[] = [];
    if (status) out.push(rect(0, 8, status.width + 2, status.height + 2));
    if (flip) out.push(rect(size.width - 32, 2, 30, 30));
    if (heartbeat === "trailing") out.push(rect(size.width - 76, size.height - 24, 74, 22));
    else if (heartbeat === "leading") out.push(rect(2, size.height - 24, 74, 22));
    return out;
  },

  /** The stamp's room once it's up: `block` its size, low at a corner `inset` in. */
  stamp(block: Size, size: Size, inset: number, trailing = false): Rect {
    const bottom = size.height - inset * 0.8;
    return rect(trailing ? size.width - inset - block.width : inset, bottom - block.height, block.width, block.height);
  },

  /** The headline's room while it's up: centered across the top. */
  banner(block: Size, size: Size): Rect {
    const top = Math.max(size.height * 0.055, 9) * 0.7;
    return rect((size.width - block.width) / 2, top, block.width, block.height);
  },
};

// MARK: - Where round him

/**
 * A moment of a replay as the tags see it: each figure's spot on screen (his
 * ground point, his height there) and the ball's, from the script at t
 * through the camera, no posing; and what else stands over the surface and
 * plays over a tag (a basket's glass, rim and net), kept clear of as a man is.
 */
export interface TheaterSpots {
  readonly figures: readonly HitFigure[];
  readonly ball: Point | null;
  readonly fixtures?: readonly Rect[];
}

/** A replay as the tags see it: how long it runs, and each moment of it. */
export interface TheaterReplay {
  readonly length: number;
  readonly at: (t: number) => TheaterSpots;
}

/**
 * `start + i·step` as Swift's floating-point stride takes it: a fused
 * multiply-add (one rounding), so the samples land where the Mac's do, the
 * stretch's last one included or not alike.
 */
function strideAt(start: number, i: number, step: number): number {
  const p = i * step;
  // The product's rounding error, exactly (Dekker's split).
  const split = (a: number) => {
    const c = 134217729 * a;
    const hi = c - (c - a);
    return [hi, a - hi] as const;
  };
  const [ah, al] = split(i);
  const [bh, bl] = split(step);
  const e = ah * bh - p + ah * bl + al * bh + al * bl;
  const s = start + p;
  const z = s - start;
  const f = start - (s - z) + (p - z);
  return s + (f + e);
}

const LIFTS = [0.5, 0.75, 1, 1.25, 1.5] as const;
const RAISE = 0.06;
const PER_HEIGHT = 0.06;

/** Each stretch's ranking, kept: by the replay's scope, the man, his stretch, the well and the tag (NSCache's count limit). */
const chosen = new Map<string, readonly TheaterTagSpot[]>();

/**
 * Where each tag sits round its man, so the play and the names never block
 * each other: of the spots round him, the one the other men and the ball
 * cover least through his stretch of the replay (while he's the key man; the
 * whole replay under the pointer), sampled ten times a second from the script
 * alone. Chosen once per stretch, so a tag never wanders mid-play; a man
 * passing through (a brief crossing) never moves it, since each spot past the
 * first costs a little (the ring takes those); a crowd he stands behind does.
 * Where every spot round him stays crowded, it's raised over the crowd on a
 * stem, by as little as clears it. (pure; tested)
 */
export const TheaterTagPlan = {
  /**
   * The spots, most wanted first, and what each costs over the first (as a
   * share of the tag covered through the stretch): over his head; nudged a
   * quarter or nearly half its width (his head still under it); under his
   * feet, the same; then raised over him as a callout, each height with the
   * same nudges (a little more for each).
   */
  spots: [
    [tagSpot(), 0],
    [tagSpot(-0.25), 0.06],
    [tagSpot(0.25), 0.06],
    [tagSpot(0, true), 0.09],
    [tagSpot(-0.45), 0.12],
    [tagSpot(0.45), 0.12],
    [tagSpot(-0.25, true), 0.14],
    [tagSpot(0.25, true), 0.14],
    [tagSpot(-0.45, true), 0.2],
    [tagSpot(0.45, true), 0.2],
    ...LIFTS.flatMap((lift) =>
      (
        [
          [0, 0],
          [-0.25, 0.02],
          [0.25, 0.02],
          [-0.45, 0.04],
          [0.45, 0.04],
        ] as const
      ).map(([nudge, more]) => [tagSpot(nudge, false, lift), RAISE + PER_HEIGHT * lift + more] as const),
    ),
  ] as readonly (readonly [TheaterTagSpot, number])[],

  /**
   * How high a callout goes over his head, in his heights: half of one up to
   * one and a half, in steps, so it stops at the first that clears the crowd
   * (any higher and its stem outgrows the men it names).
   */
  lifts: LIFTS,
  /**
   * A tag rises only where the best spot round him stays covered more than
   * this through the stretch: a crowd he's in, not a man passing (the ring
   * takes those).
   */
  crowded: 0.12,
  /** What a callout costs over a tag round him, and each of his heights it rises, so it goes no higher than clears the crowd. */
  raise: RAISE,
  perHeight: PER_HEIGHT,
  /** Samples a second. */
  rate: 10,
  /** The ball covers more than its size: it's what the eye follows. */
  ballWeight: 3,

  /** A man on screen from his ground point and height: what a tag over him would cover. */
  body(ground: Point, height: number): Rect {
    return rect(ground.x - height * 0.3, ground.y - height * 1.04, height * 0.6, height * 1.1);
  },

  /**
   * How much of a tag at `r` the ball covers at a moment: its box there
   * (`g` round it), or the path it flew since the last moment (as wide as
   * its box), whichever's more, so a ball in flight is counted all along its
   * way, never only where the samples land. (pure; tested)
   */
  ball(r: Rect, p: Point, q: Point | null, g: number): number {
    const area = overlap(r, rect(p.x - g, p.y - g, 2 * g, 2 * g));
    if (!q) return area;
    // The flight's length inside the tag grown by the ball's reach (Liang–Barsky).
    const grown = inset(r, -g, -g);
    const dx = p.x - q.x;
    const dy = p.y - q.y;
    let t0 = 0;
    let t1 = 1;
    for (const [n, e] of [
      [-dx, q.x - grown.x],
      [dx, maxX(grown) - q.x],
      [-dy, q.y - grown.y],
      [dy, maxY(grown) - q.y],
    ] as const) {
      if (Math.abs(n) < 1e-9) {
        if (e < 0) return area;
      } else if (n < 0) t0 = Math.max(t0, e / n);
      else t1 = Math.min(t1, e / n);
    }
    if (!(t1 > t0)) return area;
    return Math.max(area, (t1 - t0) * Math.hypot(dx, dy) * 2 * g);
  },

  /** What a tag asks of placement round a man at a moment (his ground point and height there; no posing), at `spot`. */
  ask(spot: TheaterTagSpot, tag: Size, ground: Point, height: number, pointer: boolean): TagAsk {
    return { size: tag, head: { x: ground.x, y: ground.y - height }, feet: ground.y + Math.max(height * 0.1, 2), pointer, spot, ground, height };
  },

  /** The spot for man `man`'s tag, `tag` big, through `stretch` of a replay in a well `size`, kept clear of the corners that never move (`furniture`). (pure; tested) */
  choose(man: number, tag: Size, pointer: boolean, stretch: Stretch, size: Size, furniture: readonly Rect[], replay: TheaterReplay): TheaterTagSpot {
    return TheaterTagPlan.rank(man, tag, pointer, stretch, size, furniture, replay)[0]!;
  },

  /**
   * Every spot for man `man`'s tag through `stretch`, most wanted first: at
   * each moment, where placement would put it at each spot and how much of
   * it the other men and the ball would cover (all of it when it wouldn't
   * show; nothing counted while he's out of the well); the least covered once
   * its cost is counted first (the first of equals). Raised only where every
   * spot round him stays crowded. (pure; tested)
   */
  rank(man: number, tag: Size, pointer: boolean, stretch: Stretch, size: Size, furniture: readonly Rect[], replay: TheaterReplay): TheaterTagSpot[] {
    const P = TheaterTagPlan;
    const from = Math.min(Math.max(stretch.from, 0), replay.length);
    const to = Math.max(Math.min(stretch.to, replay.length), from);
    // Each moment once: where he is, what the others (and a basket) cover, where the ball is and was the moment before.
    const moments: { ground: Point; height: number; others: Rect[]; ball: { at: Point; from: Point | null } | null }[] = [];
    let flown: Point | null = null;
    for (let i = 0; ; i++) {
      const t = strideAt(from, i, 1 / P.rate);
      if (t > to) break;
      const moment = replay.at(t);
      const him = moment.figures.find((f) => f.index === man);
      if (him) {
        const others: Rect[] = [];
        for (const f of moment.figures) if (f.index !== man) others.push(P.body(f.ground, f.height));
        if (moment.fixtures) others.push(...moment.fixtures);
        moments.push({ ground: him.ground, height: him.height, others, ball: moment.ball ? { at: moment.ball, from: flown } : null });
      }
      flown = moment.ball;
    }
    const scored: { spot: TheaterTagSpot; covered: number; score: number; k: number }[] = [];
    P.spots.forEach(([spot, cost], k) => {
      let covered = 0;
      let seen = 0;
      for (const m of moments) {
        const ask = P.ask(spot, tag, m.ground, m.height, pointer);
        if (!TheaterTagLayout.inWell(ask, size)) continue;
        seen += 1;
        const r = TheaterTagLayout.place([ask], size, furniture)[0];
        if (!r) {
          covered += 1;
          continue;
        }
        let area = 0;
        for (const other of m.others) area += overlap(r, other);
        if (m.ball) area += P.ball(r, m.ball.at, m.ball.from, Math.max(m.height * 0.15, 2.5)) * P.ballWeight;
        covered += Math.min(area / Math.max(r.width * r.height, 1), 1);
      }
      const share = seen > 0 ? covered / seen : 0;
      scored.push({ spot, covered: share, score: share + cost, k });
    });
    // (To a millionth, so equals stay in the order they're wanted.)
    const ranked = scored.sort((a, b) => Math.round(a.score * 1e6) - Math.round(b.score * 1e6) || a.k - b.k);
    // Raised only where every spot round him stays crowded: else the best of those first (the callouts still next, for
    // when the pointer's tag has it).
    const near = ranked.findIndex((s) => s.spot.lift === 0);
    if (near >= 0 && ranked[near]!.covered < P.crowded) ranked.unshift(...ranked.splice(near, 1));
    return ranked.map((s) => s.spot);
  },

  /**
   * `rank`, each stretch's once: by the replay (its cast's scope), the man,
   * his stretch, the well and the tag. Kept clear of the corners that stay
   * put through a replay (the turn control's, whether it's up or not, and
   * the heartbeat's): the status tag's words change and the stamp and the
   * headline come and go, so placement keeps clear of those as they do.
   */
  ranked(man: number, tag: Size, pointer: boolean, stretch: Stretch, size: Size, heartbeat: HeartbeatEdge, replay: TheaterReplay, scope: string): readonly TheaterTagSpot[] {
    const corner = heartbeat == null ? "-" : heartbeat === "leading" ? "L" : "T";
    const key = `${scope}|${man}|${pointer}|${stretch.from}|${Math.trunc(size.width)}×${Math.trunc(size.height)}|${Math.trunc(tag.width * 2)}×${Math.trunc(tag.height * 2)}|${corner}`;
    const kept = chosen.get(key);
    if (kept) return kept;
    const ranked = TheaterTagPlan.rank(man, tag, pointer, stretch, size, TheaterTagLayout.furniture(size, null, true, heartbeat), replay);
    if (chosen.size >= 200) chosen.delete(chosen.keys().next().value!);
    chosen.set(key, ranked);
    return ranked;
  },
};

// MARK: - Hit test

/** A figure as the hit test sees him: his script index, the screen point under him and his height there, from the script at t. */
export interface HitFigure {
  readonly index: number;
  readonly ground: Point;
  readonly height: number;
}

/**
 * The figure under the pointer: of the boxes round each figure (from his
 * ground point, his height up, never narrower than a fingertip), the one
 * nearest the lens that holds it. (pure; tested)
 */
export function hitFigure(figures: readonly HitFigure[], p: Point): number | null {
  let best: { index: number; depth: number } | null = null;
  for (const f of figures) {
    const w = Math.max(f.height * 0.62, 10);
    const h = Math.max(f.height * 1.14, 16);
    const box = rect(f.ground.x - w / 2, f.ground.y - h + f.height * 0.06, w, h);
    if (!contains(box, p)) continue;
    // Lower on screen is nearer: he's drawn over whoever's behind.
    if (f.ground.y > (best?.depth ?? -Infinity)) best = { index: f.index, depth: f.ground.y };
  }
  return best?.index ?? null;
}
