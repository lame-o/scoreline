/**
 * Where a game page's sections are relative to what's on screen, and how far
 * its hero has slid under the header (PageGeometry.swift, DockedScorebar.swift
 * `HeroTuck`, `dockMotion`).
 *
 * Scrolling never renders React. One passive scroll listener, throttled to a
 * frame, turns each position into small values: the dock step (1/64 of the
 * way), the hero's tuck (also in 1/64 steps) and which sections are hidden.
 * The bar and the hero card are moved by writing `transform` and `opacity` on
 * their elements, only when a step changes; React hears only coarse changes
 * (the scoreboard surface flipping at half docked, a section crossing a
 * visibility threshold).
 *
 *     const geometry = usePageGeometry(split);
 *     <div ref={geometry.heroRef}> … <div ref={geometry.tuckRef}>card</div></div>
 *     <div ref={geometry.barRef}>docked bar</div>
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import { barOffset, barOpacity, barScale, dockStep, heroTuck, surfaceAt, visibility, type Surface, type Visibility } from "../../../data/matchRules";
import { prefersReducedMotion } from "./useMedia";

/** Height of the docked scorebar plus its gap: the top of the viewport it covers once docked (pt). */
export const DOCK_INSET = 48;

export class PageGeometry {
  hero: HTMLElement | null = null;
  tuck: HTMLElement | null = null;
  bar: HTMLElement | null = null;
  root: HTMLElement | null = null;
  header: HTMLElement | null = null;
  private scroller: HTMLElement | Window = window;
  private step = -1;
  private tuckStep = -1;
  private frame = 0;
  private surfaceValue: Surface = "hero";
  private visibilityMap = new Map<string, Visibility>();
  private surfaceListeners = new Set<() => void>();
  private visibilityListeners = new Set<() => void>();
  private detach: (() => void) | null = null;

  surface = (): Surface => this.surfaceValue;
  visibilityOf = (section: string): Visibility | null => this.visibilityMap.get(section) ?? null;

  subscribeSurface = (l: () => void) => {
    this.surfaceListeners.add(l);
    return () => this.surfaceListeners.delete(l);
  };

  subscribeVisibility = (l: () => void) => {
    this.visibilityListeners.add(l);
    return () => this.visibilityListeners.delete(l);
  };

  attach(scroller: HTMLElement | Window): void {
    this.detach?.();
    this.scroller = scroller;
    const onScroll = () => {
      if (this.frame) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.update();
      });
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    const observer = new ResizeObserver(onScroll);
    if (this.root) observer.observe(this.root);
    this.detach = () => {
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      observer.disconnect();
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    };
    this.step = -1;
    this.tuckStep = -1;
    this.update();
  }

  dispose(): void {
    this.detach?.();
    this.detach = null;
  }

  /** The top of the visible area, under the sticky header (CSS px, viewport coordinates). */
  private viewportTop(): number {
    const base = this.scroller instanceof Window ? 0 : this.scroller.getBoundingClientRect().top;
    return base + (this.header?.getBoundingClientRect().height ?? 0);
  }

  private viewportBottom(): number {
    return this.scroller instanceof Window ? window.innerHeight : this.scroller.getBoundingClientRect().bottom;
  }

  /** One scroll position: the dock step, the hero's tuck, the sections' visibility. */
  update(): void {
    // Content under the header: its soft scroll edge shows (written only when it changes).
    const offset = this.scroller instanceof Window ? window.scrollY : this.scroller.scrollTop;
    const scrolled = String(offset > 1);
    if (this.header && this.header.dataset.scrolled !== scrolled) this.header.dataset.scrolled = scrolled;
    const top = this.viewportTop();
    const reduce = prefersReducedMotion();
    if (this.hero) {
      const rect = this.hero.getBoundingClientRect();
      // How far the hero has gone under the header: the Mac's scroll offset against its frame.
      const step = dockStep(0, rect.height, top - rect.top);
      if (step !== this.step) {
        this.step = step;
        const p = step / 64;
        if (this.bar) {
          const s = this.bar.style;
          s.opacity = String(barOpacity(p));
          s.transform = reduce ? "none" : `translateY(calc(${barOffset(p)} * var(--pt))) scale(${barScale(p)})`;
          s.visibility = p > 0 ? "visible" : "hidden";
          s.pointerEvents = p >= 0.5 ? "auto" : "none";
        }
        const surface = surfaceAt(p);
        if (surface !== this.surfaceValue) {
          this.surfaceValue = surface;
          this.surfaceListeners.forEach((l) => l());
        }
      }
      // The hero shrinks 6% toward its top edge and fades as it tucks (opacity only with Reduce Motion).
      const minY = rect.top - top;
      const t = Math.min(Math.max(-minY / (0.75 * rect.height), 0), 1);
      const tuckStep = Math.round(t * 64);
      if (tuckStep !== this.tuckStep && this.tuck) {
        this.tuckStep = tuckStep;
        const tuck = heroTuck((-tuckStep / 64) * 0.75 * rect.height, rect.height);
        this.tuck.style.opacity = String(tuck.opacity);
        this.tuck.style.transform = reduce || tuckStep === 0 ? "" : `scale(${tuck.scale})`;
      }
    }
    // Once docked, the bar covers the top of the viewport.
    const pt = parseFloat(getComputedStyle(document.documentElement).fontSize) / 13 || 1;
    const inset = this.step >= 32 ? DOCK_INSET * pt : 0;
    const bottom = this.viewportBottom();
    let changed = false;
    if (this.root) {
      for (const el of this.root.querySelectorAll<HTMLElement>("[data-section]")) {
        const id = el.dataset.section!;
        const r = el.getBoundingClientRect();
        const v = visibility({ top: r.top, height: r.height }, { top, height: bottom - top }, inset);
        if (this.visibilityMap.get(id) !== v) {
          this.visibilityMap.set(id, v);
          changed = true;
        }
      }
    }
    if (changed) this.visibilityListeners.forEach((l) => l());
  }

  /** Back to the top: the hero again (smooth; instant with Reduce Motion). */
  scrollToTop(): void {
    this.scroller.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }
}

/** The page's geometry, attached to whichever element scrolls it (the detail pane beside the sidebar, else the window). */
export function usePageGeometry(split: boolean, deps: readonly unknown[] = []): PageGeometry {
  const ref = useRef<PageGeometry | null>(null);
  if (!ref.current) ref.current = new PageGeometry();
  const geometry = ref.current;
  useEffect(() => {
    const scroller = split ? (document.getElementById("main") ?? window) : window;
    geometry.attach(scroller);
    return () => geometry.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry, split, ...deps]);
  return geometry;
}

/** Which scoreboard is on screen: the hero until the bar is half docked. */
export function useSurface(geometry: PageGeometry): Surface {
  return useSyncExternalStore(geometry.subscribeSurface, geometry.surface, () => "hero" as Surface);
}

/** A section's visibility (re-renders only when it crosses a threshold). */
export function useSectionVisibility(geometry: PageGeometry, section: string | null): Visibility | null {
  return useSyncExternalStore(geometry.subscribeVisibility, () => (section ? geometry.visibilityOf(section) : null), () => null);
}

/** Re-measures after layout changes that don't scroll (sections arriving). */
export function useRemeasure(geometry: PageGeometry, key: unknown): void {
  useEffect(() => {
    const frame = requestAnimationFrame(() => geometry.update());
    return () => cancelAnimationFrame(frame);
  }, [geometry, key]);
}
