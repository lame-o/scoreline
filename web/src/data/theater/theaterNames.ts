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
 * Motion, Emil's and Apple's way: a tag fades in over 120 ms with a 2 pt
 * rise, ease-out, and leaves faster (100 ms); moving straight from one man
 * to the next swaps at once, as tooltips do after the first; with Reduce
 * Motion it fades without the rise. A tag never moves on its own while the
 * pointer is still: the stage keeps only who the pointer is over, changed
 * when it crosses to another man.
 */
import type { Rect } from "../mlb/playCamera";
import { houseCurve, type Point } from "../mlb/theaterField";
import { dress, type TheaterKits } from "../mlb/theaterTeams";
import type { Side } from "../models";
import { teamPaint, type SlidePaint } from "../scoringSlide";
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
  ) {}

  /** One key man for the whole moment. */
  static of(members: ReadonlyMap<number, CastMember>, key: number | null): TheaterCast {
    return new TheaterCast(members, key == null ? [] : [{ from: -Infinity, figure: key }]);
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

/** The tag's type size, from the well's height: a step under the status tag's. */
export const tagType = (height: number) => Math.min(Math.max(height * 0.046, 9), 11.5);

// MARK: - Placement

/** What a tag asks for: its size, the top of its man's head (and his middle), where under his feet it could go, and whether it's the pointer's. */
export interface TagAsk {
  readonly width: number;
  readonly height: number;
  readonly head: Point;
  readonly feet: number;
  readonly pointer: boolean;
}

interface Size {
  readonly width: number;
  readonly height: number;
}

const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
const inset = (r: Rect, dx: number, dy: number): Rect => rect(r.x + dx, r.y + dy, r.width - 2 * dx, r.height - 2 * dy);
const contains = (r: Rect, p: Point) => p.x >= r.x && p.x < maxX(r) && p.y >= r.y && p.y < maxY(r);

/** Where tags go. (pure; tested) */
export const TheaterTagLayout = {
  /** From the well's edges. */
  margin: 4,
  /** Between a tag and his head (or his feet), and round another tag. */
  gap: 3,

  /**
   * Each tag's place, in order (the pointer's first: it wins). Over his
   * head, inside the well and clear of the furniture; else under his feet
   * (first, when he's too near the top for a tag over him); else slid along
   * off what's in the way. The pointer's always shows; any other only where
   * it's clear of the furniture and the tags already placed, else not at all
   * (it waits for the room). A man out of the well gets none.
   */
  place(asks: readonly TagAsk[], size: Size, furniture: readonly Rect[]): (Rect | null)[] {
    const { margin, gap } = TheaterTagLayout;
    const placed: Rect[] = [];
    const out: (Rect | null)[] = [];
    const well = rect(0, 0, size.width, size.height);
    for (const ask of asks) {
      if (!contains(inset(well, -2, -ask.height), ask.head) && !contains(well, { x: ask.head.x, y: ask.feet })) {
        out.push(null);
        continue;
      }
      const free = (r: Rect) => !furniture.some((f) => intersects(f, r)) && !placed.some((p) => intersects(inset(p, -gap, -gap + 1), r));
      const above = rect(ask.head.x - ask.width / 2, ask.head.y - gap - ask.height, ask.width, ask.height);
      const below = rect(above.x, ask.feet + gap, ask.width, ask.height);
      const over = TheaterTagLayout.clamp(above, size);
      const under = TheaterTagLayout.clamp(below, size);
      // Kept inside the well by more than a hair, a tag would sit on his own head (or feet): only a side with room
      // (the pointer's goes anywhere as a last resort).
      const sides = [...(above.y >= margin - 1 ? [over] : []), ...(maxY(below) <= size.height - margin + 1 ? [under] : [])];
      const candidates = [...sides, ...sides.map((r) => TheaterTagLayout.slid(r, furniture, size))];
      if (ask.pointer) candidates.push(over, under, TheaterTagLayout.slid(over, furniture, size), TheaterTagLayout.slid(under, furniture, size));
      const spot = candidates.find(free);
      if (spot) {
        placed.push(spot);
        out.push(spot);
      } else if (ask.pointer) {
        // The pointer's tag always shows: off the furniture if it can be, over the others.
        const clear = candidates.find((r) => !furniture.some((f) => intersects(f, r))) ?? over;
        placed.push(clear);
        out.push(clear);
      } else {
        out.push(null);
      }
    }
    return out;
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
