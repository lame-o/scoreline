/**
 * The docked bar's possession slots (DockedScorebar.swift `slot`,
 * `PossessionToss`): football and the NBA put a small ball beside the team
 * that has it, in a slot that keeps its width whoever has the ball, so
 * nothing moves when it changes hands.
 *
 * When it does change hands, live, the ball travels between the slots: it
 * glides (the travel spring), or for a turnover whose field can't be seen it's
 * tossed on a low arc, spinning a turn and a quarter and landing with a small
 * knock (Full; a lower arc without the spin or knock at Subtle). Reduce
 * Motion crossfades the two slots; a catch-up, the first data or a game that
 * isn't live swaps at once. One glyph that changes owner: the old slot's is
 * gone from the start, the new slot's appears as the ball lands.
 *
 *     const toss = usePossessionToss({ possession, live, geometry });
 *     <PossessionSlot side="top" toss={toss} glyph="football" />
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Icon, type IconName } from "../../../design/components";
import { knockFrames, KNOCK_SECONDS, possessionMotion, tossAt, tossDuration, type PossessionMotion } from "../../../data/matchRules";
import type { Side } from "../../../data/models";
import { useSettings } from "../../../state/settings";
import type { PageGeometry } from "./geometry";
import { useCurrentMoment } from "./moments";
import { prefersReducedMotion } from "./useMedia";
import styles from "./DockedScorebar.module.css";

export interface PossessionToss {
  readonly possession: Side | null;
  /** The side whose glyph waits for the ball in flight to land. */
  readonly landing: Side | null;
  /** How the last change moved: the slots' CSS transitions follow it. */
  readonly motion: PossessionMotion["kind"];
  readonly slots: RefObject<Record<Side, HTMLSpanElement | null>>;
  readonly flight: RefObject<HTMLSpanElement | null>;
}

/** A change this soon after the bar mounted is the page catching up, not news. */
const CATCH_UP_MS = 1500;

export function usePossessionToss({ possession, live, geometry, container }: { possession: Side | null; live: boolean; geometry: PageGeometry; container: RefObject<HTMLElement | null> }): PossessionToss {
  const level = useSettings((s) => s.celebrationLevel);
  const moment = useCurrentMoment();
  const slots = useRef<Record<Side, HTMLSpanElement | null>>({ top: null, bottom: null });
  const flight = useRef<HTMLSpanElement | null>(null);
  const previous = useRef(possession);
  const mounted = useRef(0);
  const seen = useRef<{ id: string; at: number } | null>(null);
  const [state, setState] = useState<{ landing: Side | null; motion: PossessionMotion["kind"] }>({ landing: null, motion: "none" });

  useEffect(() => {
    mounted.current = performance.now();
  }, []);
  // When the moment on show arrived: a toss needs a turnover from the last two seconds.
  if (moment && seen.current?.id !== moment.id) seen.current = { id: moment.id, at: performance.now() };

  useLayoutEffect(() => {
    const from = previous.current;
    previous.current = possession;
    if (!from || !possession || from === possession) return;
    const now = performance.now();
    const motion = possessionMotion(
      { from, to: possession },
      moment && seen.current?.id === moment.id ? { kind: moment.kind, age: (now - seen.current.at) / 1000 } : null,
      geometry.visibilityOf("field"),
      level,
      prefersReducedMotion(),
      { live, catchUp: now - mounted.current < CATCH_UP_MS },
    );
    const a = slots.current[from];
    const b = slots.current[possession];
    const ball = flight.current;
    const box = container.current;
    if ((motion.kind !== "glide" && motion.kind !== "toss") || !a || !b || !ball || !box) {
      setState({ landing: null, motion: motion.kind });
      return;
    }
    // The ball flies over the bar between the two slots' centers.
    const frame = box.getBoundingClientRect();
    const center = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2 - frame.left, y: r.top + r.height / 2 - frame.top };
    };
    const start = center(a);
    const end = center(b);
    const pt = parseFloat(getComputedStyle(document.documentElement).fontSize) / 13 || 1;
    const duration = tossDuration(motion);
    const steps = Math.ceil(duration * 60);
    const keyframes = Array.from({ length: steps + 1 }, (_, i) => {
      const t = (i / steps) * duration;
      const v = tossAt(motion, t);
      const x = start.x + (end.x - start.x) * v.progress;
      const y = start.y + (end.y - start.y) * v.progress - v.lift * pt;
      return { offset: i / steps, transform: `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${v.spin}deg)`, opacity: 1 };
    });
    setState({ landing: possession, motion: motion.kind });
    const animation = ball.animate(keyframes, { duration: duration * 1000, easing: "linear" });
    let cancelled = false;
    animation.finished.then(
      () => {
        if (cancelled) return;
        setState((s) => (s.landing === possession ? { ...s, landing: null } : s));
        // The landing knock, on the glyph that's now there.
        const glyph = slots.current[possession]?.firstElementChild as HTMLElement | null;
        if (motion.kind === "toss" && motion.knocks && glyph) {
          glyph.animate(
            knockFrames(2).map(({ offset, value }) => ({ offset, transform: `translateY(${value * pt}px)` })),
            { duration: KNOCK_SECONDS * 1000, easing: "ease-in-out" },
          );
        }
      },
      () => {},
    );
    return () => {
      cancelled = true;
      animation.cancel();
    };
    // Only a change of hands starts a flight; the moment and settings are read as it happens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [possession]);

  return { possession, landing: state.landing, motion: state.motion, slots, flight };
}

/** One team's slot: the ball when it's theirs (hidden while it's still in the air). */
export function PossessionSlot({ side, toss, glyph }: { side: Side; toss: PossessionToss; glyph: IconName }) {
  const on = toss.possession === side && toss.landing !== side;
  return (
    <span
      className={styles.possession}
      data-on={on}
      data-motion={toss.motion}
      ref={(el) => {
        toss.slots.current[side] = el;
      }}
    >
      <Icon name={glyph} size={9} />
    </span>
  );
}

/** The ball in flight, over the bar's content. */
export function PossessionFlight({ toss, glyph }: { toss: PossessionToss; glyph: IconName }) {
  return (
    <span className={styles.flight} ref={toss.flight} aria-hidden="true">
      <Icon name={glyph} size={9} />
    </span>
  );
}
