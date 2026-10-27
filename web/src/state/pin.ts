/**
 * The pinned game: the web's "Show in Menu Bar" (ScoreStore.pinnedID,
 * togglePin). One game per tab, whose score the tab's title and favicon
 * carry (state/tabScore.ts); it also leads the Live tier after your teams,
 * and its CS2 row reads the live round. Kept for the tab's session
 * (sessionStorage), as the Mac keeps it until quit; it lets go four hours
 * after a finished game started (`pinExpired`).
 *
 *     const pinned = useIsPinned(event.id);
 *     pin.toggle(event.id);
 */
import { useSyncExternalStore } from "react";

const KEY = "scoreline.pinned";

function read(): string | null {
  try {
    return globalThis.sessionStorage?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
}

let current: string | null = read();
const listeners = new Set<() => void>();

function write(next: string | null) {
  if (next === current) return;
  current = next;
  try {
    if (next) globalThis.sessionStorage?.setItem(KEY, next);
    else globalThis.sessionStorage?.removeItem(KEY);
  } catch {
    // Storage blocked: the pin still holds for this page's life.
  }
  for (const l of listeners) l();
}

export const pin = {
  get: (): string | null => current,
  /** Pins a game, or unpins it if it's the pinned one (one at a time). */
  toggle(id: string) {
    write(current === id ? null : id);
  },
  clear() {
    write(null);
  },
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePinnedID(): string | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}

/** Whether this game is pinned; re-renders only when that answer changes. */
export function useIsPinned(id: string): boolean {
  return useSyncExternalStore(subscribe, () => current === id, () => false);
}
