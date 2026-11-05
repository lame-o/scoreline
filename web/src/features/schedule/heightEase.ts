/**
 * The mode switch's height easing (SchedulePage.swift: Upcoming | Results
 * resizes the Mac's panel to the new content, its bottom edge gliding while
 * the content crossfades). A web page doesn't resize its window, and
 * animating the content's height would lay the page out every frame. So the
 * new content takes its height at once, in one layout, and only what shows
 * the change moves, on the compositor and the paint:
 *
 * - growing, the new content is revealed down to its full height (a clip
 *   that opens from the old height) while the footer glides down from where
 *   it was;
 * - shrinking, the footer glides up from where it was to its new place.
 *
 * On the Mac's standard spring's 0.3 s, the strong ease-out. A click only
 * (keys switch instantly, as on the Mac); with Reduce Motion the crossfade
 * alone. The page that's leaving notes its content's height
 * (`rememberContentHeight`, from the switch's click); the page arriving
 * eases from it once its first layout has its data (`useHeightEase`).
 */
import { useLayoutEffect, type RefObject } from "react";

/** The content block a schedule page's mode replaces (`data-mode-content`). */
export const MODE_CONTENT = "data-mode-content";

let pending: { height: number; at: number } | null = null;

/** Before a click's mode switch: the content's height now, for the arriving page to ease from. */
export function rememberContentHeight(): void {
  const el = document.querySelector<HTMLElement>(`[${MODE_CONTENT}]`);
  pending = el ? { height: el.getBoundingClientRect().height, at: performance.now() } : null;
}

const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
const DURATION = 300;

/**
 * After the new content's first layout with its data (`ready`), ease from the
 * remembered height to this one. Waits at most a second for the data: a page
 * that had to show its placeholder first has already moved.
 */
export function useHeightEase(content: RefObject<HTMLElement | null>, crossfade: boolean, ready: boolean): void {
  useLayoutEffect(() => {
    if (!crossfade || !ready || !pending) return;
    const { height: from, at } = pending;
    pending = null;
    const el = content.current;
    if (!el || performance.now() - at > 1000 || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const to = el.getBoundingClientRect().height;
    const delta = to - from;
    if (Math.abs(delta) < 2) return;
    const timing = { duration: DURATION, easing: EASE_OUT };
    // What follows the content (the footer) starts where it stood and glides to its new place.
    const after = el.nextElementSibling;
    if (after instanceof HTMLElement) after.animate([{ transform: `translateY(${-delta}px)` }, { transform: "translateY(0)" }], timing);
    // Growing: the new rows are revealed down to the new edge, never drawn past the old one first.
    if (delta > 0) el.animate([{ clipPath: `inset(0 0 ${delta}px 0)` }, { clipPath: "inset(0 0 0 0)" }], timing);
    // Each switch eases once; a re-render with the data already shown doesn't.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
}
