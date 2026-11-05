/**
 * Rearranging a game page's modules by dragging their headers
 * (ModuleDrag.swift). A press that travels past 4pt lifts the module: the
 * page folds to its headers and glances for the moment (never saved) so all
 * of it fits; the module's header rides the pointer 1:1, raised a little,
 * while the others slide out of its way; on release the order is saved for
 * the sport (`rank`, data/modules.ts) and the page opens back up around it,
 * scrolled to keep the module where it was let go. Esc puts everything back.
 * Near the viewport's top or bottom edge (below the docked bar) the page
 * scrolls.
 *
 * The module in hand is drawn twice: its header, raised, in a fixed layer
 * over the page (the lift), and the module itself, unseen, at the gap it
 * would land in (a faint well marks it). So scrolling never moves what's
 * under the pointer, and the module keeps its identity (a folded Live View
 * keeps its running order and clocks; nothing is rebuilt).
 *
 * Outside React: the pointer moves the lift by writing its transform; React
 * hears only the drag starting and ending (`compact`) and the gap moving
 * (`preview`). A mouse or a pen drags; touch scrolls, and reorders in
 * Customize.
 */
import { autoscrollSpeed, DRAG_THRESHOLD, move as moveTo, permute, slot as slotFor } from "../../../data/modules";
import { DOCK_INSET, type PageGeometry } from "./geometry";
import { pointSize, prefersReducedMotion } from "./useMedia";

/** Dragging a module's header moves it: the page as it's arranged right now. */
export interface ModuleReorder {
  /** "court": the module's ID (its fold key's second half, its section). */
  readonly id: string;
  /** The module's run, top to bottom: its column on the split page, else the page. */
  readonly run: readonly string[];
  /** Every module on the page, in the one-column order (the ranking's). */
  readonly page: readonly string[];
  /** The page's new order, saved for the sport. */
  readonly commit: (page: string[]) => void;
}

/** What React draws while a module is in hand. */
export interface DragSnapshot {
  /** The module in hand: its lift is drawn. */
  readonly id: string | null;
  /** Every module folded while one is dragged (never saved). */
  readonly compact: boolean;
  /** The page's modules in the order the drag proposes: the arrangement's ranking meanwhile. */
  readonly preview: readonly string[] | null;
  /** Its lift's column: fixed for the drag (viewport px). */
  readonly left: number;
  readonly width: number;
}

const IDLE: DragSnapshot = { id: null, compact: false, preview: null, left: 0, width: 0 };

/** The space above a module's header: open, and (closer) folded (ModuleChrome.headerInset), in points. */
export const headerInset = (folded: boolean) => (folded ? 12 : 16);

export class ModuleDrag {
  private snap: DragSnapshot = IDLE;
  private listeners = new Set<() => void>();
  /** Where the lift is drawn: its transform is written per move. */
  lift: HTMLElement | null = null;
  /** The page's sections, each `[data-module]`. */
  root: HTMLElement | null = null;

  private phase: "idle" | "pressed" | "dragging" | "settling" = "idle";
  private reorder: ModuleReorder | null = null;
  private pointerID = -1;
  private startX = 0;
  private startY = 0;
  private pointerY = 0;
  /** The pointer's height below the lift's top, as grabbed. */
  private grab = 0;
  private liftY = 0;
  private slotIndex = 0;
  private startSlot = 0;
  private startOffset = 0;
  /** The run's folded frames, measured once the page has folded (content px): its top, each other module's height. */
  private runTop: number | null = null;
  private heights: number[] = [];
  private speed = 0;
  private frame = 0;
  private lastTick = 0;
  /** A drag just ended on this press: its click mustn't fold the module. */
  private swallow = false;

  constructor(private readonly geometry: PageGeometry) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = (): DragSnapshot => this.snap;

  private set(next: Partial<DragSnapshot>) {
    this.snap = { ...this.snap, ...next };
    this.listeners.forEach((l) => l());
  }

  /** A press on a header (a mouse's primary button or a pen): it may become a drag. */
  press(event: PointerEvent, reorder: ModuleReorder): void {
    if (this.phase !== "idle" || event.button !== 0 || event.pointerType === "touch" || !reorder.run.includes(reorder.id)) return;
    this.phase = "pressed";
    this.reorder = reorder;
    this.pointerID = event.pointerId;
    this.startX = event.clientX;
    this.startY = event.clientY;
    window.addEventListener("pointermove", this.onMove, true);
    window.addEventListener("pointerup", this.onUp, true);
    window.addEventListener("pointercancel", this.onCancel, true);
  }

  /** Whether the header's click should be ignored (it ended a drag). */
  takeClick(): boolean {
    const swallowed = this.swallow;
    this.swallow = false;
    return swallowed;
  }

  dispose(): void {
    this.finish();
  }

  private onMove = (event: PointerEvent) => {
    if (event.pointerId !== this.pointerID) return;
    if (this.phase === "pressed") {
      if (Math.hypot(event.clientX - this.startX, event.clientY - this.startY) < DRAG_THRESHOLD * pointSize()) return;
      this.begin(event);
    }
    if (this.phase === "dragging") {
      event.preventDefault();
      this.move(event.clientY);
    }
  };

  private onUp = (event: PointerEvent) => {
    if (event.pointerId !== this.pointerID) return;
    if (this.phase === "dragging") {
      this.swallow = true;
      this.drop();
    } else this.finish();
  };

  private onCancel = (event: PointerEvent) => {
    if (event.pointerId !== this.pointerID) return;
    if (this.phase === "dragging") this.cancel();
    else this.finish();
  };

  /** Esc, whatever has focus: everything goes back where it was. */
  private onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || this.phase !== "dragging") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.swallow = true;
    this.cancel();
  };

  private element(id: string): HTMLElement | null {
    return this.root?.querySelector<HTMLElement>(`[data-module="${CSS.escape(id)}"]`) ?? null;
  }

  private begin(event: PointerEvent): void {
    const reorder = this.reorder;
    const el = reorder ? this.element(reorder.id) : null;
    if (!reorder || !el) return this.finish();
    const rect = el.getBoundingClientRect();
    const pt = pointSize();
    this.phase = "dragging";
    this.startOffset = this.geometry.scrollOffset();
    this.startSlot = this.slotIndex = reorder.run.indexOf(reorder.id);
    this.pointerY = event.clientY;
    // The lift's header sits where it was grabbed (folded, 12pt down its block).
    this.grab = this.startY - rect.top - (headerInset(false) - headerInset(true)) * pt;
    this.liftY = this.pointerY - this.grab;
    this.runTop = null;
    document.documentElement.dataset.moduleDrag = "true";
    window.addEventListener("keydown", this.onKey, true);
    this.set({ id: reorder.id, compact: true, preview: null, left: rect.left, width: rect.width });
    this.place();
    // Once the folded page has laid out: keep the gap under the lift, and measure the run as it stands.
    requestAnimationFrame(() => requestAnimationFrame(() => this.anchor()));
  }

  /** The page has folded: it scrolls so the module's gap is under its lift; where it can't, the lift glides onto its gap. */
  private anchor(): void {
    const reorder = this.reorder;
    const gap = reorder ? this.element(reorder.id) : null;
    if (this.phase !== "dragging" || !reorder || !gap) return;
    const offset = this.geometry.scrollOffset();
    const target = offset + gap.getBoundingClientRect().top - this.liftY;
    this.geometry.scrollTo(target);
    const residual = gap.getBoundingClientRect().top - this.liftY;
    if (Math.abs(residual) > 0.5) {
      this.grab -= residual;
      this.liftY += residual;
      this.place(!prefersReducedMotion());
    }
    this.measure();
    this.retarget();
    this.autoscroll();
  }

  /** The run's folded frames, in content coordinates. */
  private measure(): void {
    const reorder = this.reorder;
    if (!reorder) return;
    const offset = this.geometry.scrollOffset();
    const frames = reorder.run.map((id) => this.element(id)?.getBoundingClientRect() ?? null);
    if (frames.some((f) => f == null)) return;
    this.runTop = Math.min(...frames.map((f) => f!.top)) + offset;
    this.heights = reorder.run.flatMap((id, i) => (id === reorder.id ? [] : [frames[i]!.height]));
  }

  private move(y: number): void {
    this.pointerY = y;
    this.liftY = y - this.grab;
    this.place();
    this.retarget();
    this.autoscroll();
  }

  /** Writes the lift's place (a glide onto its gap: on `standard`'s curve). */
  private place(glide = false): void {
    const el = this.lift;
    if (!el) return;
    el.style.transition = glide ? "transform 300ms var(--ease-out)" : "none";
    el.style.transform = `translate3d(0, ${this.liftY}px, 0) scale(1.02)`;
  }

  /** Moves the gap to the slot nearest the lift (the others slide on `standard`; Reduce Motion: in place). */
  private retarget(): void {
    const reorder = this.reorder;
    if (this.phase !== "dragging" || !reorder || this.runTop == null) return;
    const next = slotFor(this.liftY + this.geometry.scrollOffset(), this.runTop, this.heights);
    if (next === this.slotIndex) return;
    this.slotIndex = next;
    this.set({ preview: permute(reorder.page, moveTo(reorder.id, next, reorder.run)) });
  }

  /** Near an edge the page scrolls, faster the closer (60 ticks a second, whatever the display's rate). */
  private autoscroll(): void {
    if (this.phase !== "dragging") return this.stopAutoscroll();
    const view = this.geometry.viewport();
    const pt = pointSize();
    this.speed = autoscrollSpeed((this.pointerY - view.top) / pt, (view.bottom - view.top) / pt, this.geometry.docked() ? DOCK_INSET : 0) * pt;
    if (this.speed === 0) return this.stopAutoscroll();
    if (this.frame) return;
    this.lastTick = performance.now();
    const tick = (now: number) => {
      this.frame = 0;
      if (this.phase !== "dragging" || this.speed === 0) return;
      const dt = Math.min((now - this.lastTick) / (1000 / 60), 3);
      this.lastTick = now;
      const before = this.geometry.scrollOffset();
      this.geometry.scrollTo(before + this.speed * dt);
      if (this.geometry.scrollOffset() !== before) this.retarget();
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private stopAutoscroll(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.speed = 0;
  }

  /** Released: the order is saved, and the page opens back up with the module's header under the lift, as far as it can scroll. */
  private drop(): void {
    const reorder = this.reorder;
    if (!reorder) return this.finish();
    if (this.slotIndex !== this.startSlot) reorder.commit(permute(reorder.page, moveTo(reorder.id, this.slotIndex, reorder.run)));
    this.settle(() => {
      const el = this.element(reorder.id);
      if (!el) return this.geometry.scrollOffset();
      return this.geometry.scrollOffset() + el.getBoundingClientRect().top + (headerInset(false) - headerInset(true)) * pointSize() - this.liftY;
    });
  }

  /** Esc, or the system took the pointer: back where it was, scroll included. */
  private cancel(): void {
    const offset = this.startOffset;
    this.settle(() => offset);
  }

  /** The page opens; once it has laid out, it scrolls to `target()` and the lift fades (Reduce Motion: at once). */
  private settle(target: () => number): void {
    this.stopAutoscroll();
    this.phase = "settling";
    this.set({ compact: false, preview: null });
    requestAnimationFrame(() => {
      this.geometry.scrollTo(target());
      const el = this.lift;
      if (el && !prefersReducedMotion()) {
        el.style.transition = "opacity 120ms var(--ease-out), transform 120ms var(--ease-out)";
        el.style.opacity = "0";
        el.style.transform = `translate3d(0, ${this.liftY}px, 0) scale(1)`;
        window.setTimeout(() => this.finish(), 120);
      } else this.finish();
    });
  }

  private finish(): void {
    this.stopAutoscroll();
    window.removeEventListener("pointermove", this.onMove, true);
    window.removeEventListener("pointerup", this.onUp, true);
    window.removeEventListener("pointercancel", this.onCancel, true);
    window.removeEventListener("keydown", this.onKey, true);
    delete document.documentElement.dataset.moduleDrag;
    const wasDragging = this.phase === "dragging" || this.phase === "settling";
    this.phase = "idle";
    this.reorder = null;
    this.pointerID = -1;
    this.runTop = null;
    if (wasDragging || this.snap !== IDLE) this.set(IDLE);
  }
}
