/**
 * The docked bar (PlayerPage.swift `PlayerDockBar`, DockedScorebar.swift
 * `DockedBarHost`, `HeroTuck`): as the hero card scrolls away it tucks under
 * the header (shrinking 6% toward its top edge and fading), and at the same
 * offsets a compact glass bar settles in just below the header: the hero in
 * one line, in the team's color. A click goes back to the top.
 *
 * - The motion is the scroll: transforms and opacity only, never a timer.
 * - The dock's progress is quantized to 1/64 (`dockStep`), and only the host
 *   re-renders on a step; the page never reads it, so scrolling never
 *   re-renders the page, and the bar's own content (an element the page
 *   built) doesn't render again either.
 * - The hero's tuck is written straight to its style each frame (no React).
 * - The bar is an overlay on a zero-height sticky row: it never changes the
 *   page's layout, and isn't in the document until the hero starts to go.
 * - Reduce Motion: opacity only.
 */
import { memo, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { dockMotion, dockStep, heroTuck } from "../../data/profiles/display";
import type { PhotoCrop } from "../../data/profiles/photos";
import type { StatTile } from "../../data/profiles/models";
import { PlayerPhoto } from "./PlayerPhoto";
import { scrollerOf } from "./ProfileParts";
import styles from "./Profile.module.css";

const HEADER_PT = 44;
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Hosts the bar over the page, driven by where the hero is. `hero` is the
 * hero's untransformed wrapper (measured), `card` the card that tucks.
 */
export function DockedBarHost({ hero, card, children }: { readonly hero: RefObject<HTMLElement | null>; readonly card: RefObject<HTMLElement | null>; readonly children: ReactNode }) {
  const [step, setStep] = useState(0);
  const reduce = useRef(reducedMotion());

  useEffect(() => {
    const wrapper = hero.current;
    if (!wrapper) return;
    const scroller = scrollerOf(wrapper);
    const target: HTMLElement | Window = scroller ?? window;
    let frame = 0;
    const read = () => {
      frame = 0;
      const pt = parseFloat(getComputedStyle(document.documentElement).fontSize) / 13 || 1;
      const top = scroller ? scroller.getBoundingClientRect().top : 0;
      const rect = wrapper.getBoundingClientRect();
      // How far the hero's top is below the header's bottom (negative once it's under).
      const minY = rect.top - top - HEADER_PT * pt;
      const next = dockStep(0, rect.height, -minY);
      setStep((s) => (s === next ? s : next));
      const el = card.current;
      if (el) {
        const tuck = heroTuck(minY, rect.height);
        el.style.transform = reduce.current || tuck.scale === 1 ? "" : `scale(${tuck.scale})`;
        el.style.opacity = tuck.opacity === 1 ? "" : String(tuck.opacity);
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    target.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotion = () => {
      reduce.current = media.matches;
      schedule();
    };
    media.addEventListener("change", onMotion);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      target.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      media.removeEventListener("change", onMotion);
    };
  }, [hero, card]);

  const p = step / 64;
  const motion = dockMotion(p);
  return (
    <div className={styles.dockRow} aria-hidden="true">
      {p > 0 ? (
        <div
          className={styles.dockSlot}
          style={{
            opacity: motion.opacity,
            transform: reduce.current ? undefined : `translateY(calc(${motion.offset} * var(--pt))) scale(${motion.scale})`,
            pointerEvents: motion.interactive ? "auto" : "none",
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

export interface PlayerDockBarProps {
  readonly name: string;
  readonly photo: string | null;
  readonly crop: PhotoCrop;
  readonly tint: string | null;
  readonly lightInk: boolean;
  readonly detail: string | null;
  readonly stat: StatTile | null;
}

/**
 * The hero, docked: the photo, the name, team and position and the season's
 * lead stat on one line of glass dressed in the team's color. Memoized on
 * what it shows: its host re-renders every dock step, and this doesn't.
 */
export const PlayerDockBar = memo(function PlayerDockBar({ name, photo, crop, tint, lightInk, detail, stat }: PlayerDockBarProps) {
  const toTop = () => {
    const el = document.querySelector("main");
    const scroller = el ? scrollerOf(el) : null;
    // Back to the hero (animated; instant with Reduce Motion).
    (scroller ?? window).scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
  };
  return (
    <button type="button" tabIndex={-1} className={styles.dockBar} style={{ ["--tint" as string]: tint ?? "var(--accent)" }} onClick={toTop} title="Back to top">
      <PlayerPhoto url={photo} name={name} tint={tint} size={26} crop={crop} lightInk={lightInk} />
      <span className={styles.dockLine}>
        <span className={styles.dockName}>{name}</span>
        {detail ? (
          <>
            <span className={styles.dockDot}>·</span>
            <span className={styles.dockDetail}>{detail}</span>
          </>
        ) : null}
      </span>
      {stat ? (
        <span className={styles.dockStat}>
          <span className={styles.dockValue}>{stat.value}</span>
          <span className={styles.dockLabel}>{stat.label}</span>
        </span>
      ) : null}
    </button>
  );
});
