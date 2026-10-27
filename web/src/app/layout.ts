/**
 * The page's arrangement. Phones get one column, like the Mac panel; from
 * 760px the scores list becomes a sidebar beside a wide detail pane (the
 * Mac app's split layouts, adapted to a browser window).
 */
import { useSyncExternalStore } from "react";

export const SPLIT_QUERY = "(min-width: 760px)";

const split = typeof window !== "undefined" ? window.matchMedia(SPLIT_QUERY) : null;

export function useSplit(): boolean {
  return useSyncExternalStore(
    (listener) => {
      split?.addEventListener("change", listener);
      return () => split?.removeEventListener("change", listener);
    },
    () => split?.matches ?? false,
    () => false,
  );
}

/** Navigation state a route reads to decide whether to animate its entrance. */
export interface NavState {
  /** Reached with the keyboard: keyboard actions never animate. */
  readonly viaKeyboard?: boolean;
}
