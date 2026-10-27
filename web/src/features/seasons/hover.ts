/**
 * The competition under the pointer or the arrow keys, shared by a season
 * page's timeline, docked strip and list (Swift `HighlightState`). A store,
 * not React state: a move re-renders the two rows whose light changed and
 * the timeline, never the page.
 */
import { useRef, useSyncExternalStore } from "react";

type Listener = () => void;

export class HoverStore {
  id: string | null = null;
  /** Moved by the keys (the highlight wears the accent, and follows into view). */
  keyboard = false;
  private listeners = new Set<Listener>();

  set(id: string | null, keyboard = false) {
    if (this.id === id && this.keyboard === keyboard) return;
    this.id = id;
    this.keyboard = keyboard;
    this.listeners.forEach((l) => l());
  }

  /** The pointer left `id` (keys keep their highlight). */
  leave(id: string) {
    if (this.id === id && !this.keyboard) this.set(null);
  }

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

export function useHoverStore(): HoverStore {
  const ref = useRef<HoverStore | null>(null);
  ref.current ??= new HoverStore();
  return ref.current;
}

/** Whether `id` is lit, and by what: re-renders only when that changes. */
export function useLit(store: HoverStore, id: string): "none" | "pointer" | "keyboard" {
  return useSyncExternalStore(store.subscribe, () => (store.id !== id ? "none" : store.keyboard ? "keyboard" : "pointer"), () => "none");
}

/** The lit competition, for the timeline and the readouts. */
export function useHovered(store: HoverStore): string | null {
  return useSyncExternalStore(store.subscribe, () => store.id, () => null);
}
