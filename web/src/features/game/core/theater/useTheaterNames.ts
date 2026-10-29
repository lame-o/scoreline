/**
 * The pointer over a theater's well, for the names on its figures
 * (TheaterNames.swift `theaterPointer`, `theaterFading`): on each move of a
 * real hover pointer (`(hover: hover) and (pointer: fine)`), the figure under
 * it, hit-tested against the frame on screen (each figure's spot at t, no
 * posing), kept only when it crosses to another man; off every figure (or out
 * of the well) his tag goes. An official or a coach under it names nobody.
 * A phone has no hover: a tap on a man shows his full tag, a tap anywhere
 * else in the well (or a few seconds) clears it; a tap on the turn control
 * is the control's alone.
 *
 * Nothing here is React state: the theater keeps one `TheaterNames`, its
 * frames read the pointer when they're drawn, and a change asks the stage
 * for frames only while a tag fades in or out (one still frame between plays,
 * redrawn; nothing redraws while nothing moves).
 *
 *     const names = useTheaterNames(well, stage);
 *     // In the stage's paint, for the frame it draws (its script's cast, its figures at t for the hit test):
 *     const tags = names.frame(cast, labels, { status, flip: true, heartbeat: "trailing" }, () => hitFigures);
 *     drawFrame(ctx, f, { …, tags });   // drawTags after the shadows, ringFigure/ringBall before each figure and the ball
 */
import { useEffect, useState, type RefObject } from "react";
import { hitFigure, NO_CAST, tagFrame, TheaterPointer, type HeartbeatEdge, type HitFigure, type TagFrame, type TheaterCast, type TheaterLabels } from "../../../../data/theater/theaterNames";
import { prefersReducedMotion } from "../useMedia";

/** What draws the frames: draws now and keeps drawing until `until` (performance.now(), ms). TheaterStage and the baseball's renderer. */
export interface TagStage {
  animate(until: number): void;
}

/** A tapped man's tag stays this long on a phone, unless another tap clears it. */
const TAP_HOLD_MS = 4000;
/** A touch that moves further than this, or lasts longer, is a scroll or a press, not a tap. */
const TAP_SLOP = 10;
const TAP_TIME_MS = 500;

const HOVER = "(hover: hover) and (pointer: fine)";

/** Development (the render harness): the pointer held on a figure (his script index) or at a point in the well, its tag `appear` of the way in (1: settled). */
export interface NamesPose {
  readonly index?: number;
  readonly x?: number;
  readonly y?: number;
  readonly appear?: number;
}

export class TheaterNames {
  readonly pointer = new TheaterPointer();
  /** Who each figure on screen is, and where they stand: the frame last drawn's, for the hit test. */
  private cast: TheaterCast = NO_CAST;
  private figures: (() => readonly HitFigure[]) | null = null;
  /** A hover pointer is over the well: the turn control shows. */
  hovering = false;
  /** No hover here (a phone): the turn control always shows, and a tap names a man. */
  coarse = false;
  private posed: NamesPose | null = null;
  /** The well (development: where the harness's pointer is, for its picture of the arrow). */
  element: HTMLElement | null = null;

  constructor(private readonly stage: () => TagStage | null) {}

  /**
   * The tags for a frame drawn now: its script's cast, and its figures at t
   * (each one's script index, ground point and height; called only when the
   * pointer moves). `flip`: the theater has a turn control (it shows while
   * hovered, always on a phone).
   */
  frame(
    cast: TheaterCast,
    labels: TheaterLabels,
    options: { readonly status: string | null; readonly flip: boolean; readonly heartbeat?: HeartbeatEdge },
    figures: () => readonly HitFigure[],
  ): TagFrame {
    this.cast = cast;
    this.figures = figures;
    const now = performance.now();
    const posed = this.posed;
    if (posed) {
      // Held where the harness put it (on a man: on his chest, hit-tested as a pointer there is), on its own clock.
      const man = posed.index != null ? figures().find((f) => f.index === posed.index) : undefined;
      const x = man ? man.ground.x + 1 : (posed.x ?? -1);
      const y = man ? man.ground.y - man.height * 0.55 : (posed.y ?? -1);
      const p = this.pointer;
      p.over = this.at(x, y);
      p.fades = (posed.appear ?? 1) < 1;
      p.since = now - TheaterPointer.fadeIn * (posed.appear ?? 1);
      p.leaving = null;
      this.element?.setAttribute("data-pointer", `${x},${y}`);
    }
    return tagFrame(cast, labels, this.pointer, now, {
      reduceMotion: prefersReducedMotion(),
      status: options.status,
      flip: options.flip && (this.hovering || this.coarse),
      heartbeat: options.heartbeat,
    });
  }

  /** The cast member under a point in the well, by the frame on screen. */
  at(x: number, y: number): string | null {
    const figures = this.figures?.() ?? [];
    const index = hitFigure(figures, { x, y });
    return index == null ? null : (this.cast.members.get(index)?.id ?? null);
  }

  /** Onto a man (or off every one): redrawn through the fade when it changed. */
  move(id: string | null): void {
    const now = performance.now();
    if (!this.pointer.move(id, now)) return;
    this.redraw(now + TheaterPointer.settle);
  }

  /** Development: the pointer held over a figure or a point (null: let go). */
  pose(pose: NamesPose | null): void {
    this.posed = pose;
    this.hovering = pose != null;
    if (!pose) this.pointer.move(null, -Infinity);
    this.redraw();
  }

  /** Draws the frame on screen again (until `until`, while something fades). */
  redraw(until = performance.now()): void {
    this.stage()?.animate(until);
  }
}

/** One `TheaterNames` for a theater's well, following the pointer over it. */
export function useTheaterNames(well: RefObject<HTMLElement | null>, stage: RefObject<TagStage | null>): TheaterNames {
  const [names] = useState(() => new TheaterNames(() => stage.current));
  useEffect(() => {
    const el = well.current;
    if (!el) return;
    names.element = el;
    const hover = window.matchMedia(HOVER);
    const update = () => {
      names.coarse = !hover.matches;
    };
    update();
    hover.addEventListener("change", update);
    const local = (e: PointerEvent) => {
      const box = el.getBoundingClientRect();
      return { x: e.clientX - box.left, y: e.clientY - box.top };
    };
    const real = (e: PointerEvent) => e.pointerType !== "touch" && hover.matches;
    // A hover pointer: the man under it, from its first entry (no wiggle needed).
    const onMove = (e: PointerEvent) => {
      if (!real(e)) return;
      if (!names.hovering) {
        names.hovering = true;
        names.redraw();
      }
      const p = local(e);
      names.move(names.at(p.x, p.y));
    };
    const onLeave = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      names.hovering = false;
      names.move(null);
      names.redraw(performance.now() + TheaterPointer.settle);
    };
    // A tap: on a man, his tag (for a while); anywhere else in the well, none.
    let down: { x: number; y: number; at: number; id: number } | null = null;
    let clear: ReturnType<typeof setTimeout> | undefined;
    const onDown = (e: PointerEvent) => {
      down = e.pointerType === "touch" ? { x: e.clientX, y: e.clientY, at: performance.now(), id: e.pointerId } : null;
    };
    const onUp = (e: PointerEvent) => {
      const d = down;
      down = null;
      if (!d || e.pointerId !== d.id || Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_SLOP || performance.now() - d.at > TAP_TIME_MS) return;
      // The turn control's tap is its own.
      if (e.target instanceof Element && e.target.closest("button, a")) return;
      const p = local(e);
      const id = names.at(p.x, p.y);
      clearTimeout(clear);
      names.move(id);
      if (id != null) clear = setTimeout(() => names.move(null), TAP_HOLD_MS);
    };
    const onCancel = () => {
      down = null;
    };
    el.addEventListener("pointerover", onMove);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onCancel);
    return () => {
      clearTimeout(clear);
      hover.removeEventListener("change", update);
      el.removeEventListener("pointerover", onMove);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onCancel);
    };
  }, [names, well]);
  return names;
}
