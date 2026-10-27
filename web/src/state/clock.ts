/**
 * Shared tickers: `useNow(1000)` re-renders a component every second, on
 * the second, together with every other component asking for the same
 * period (so all clocks on the page tick in one frame, as the Mac app's
 * aligned TimelineViews do). Tickers stop while the tab is hidden and catch
 * up the moment it's shown.
 */
import { useCallback, useSyncExternalStore } from "react";

interface Ticker {
  now: number;
  listeners: Set<() => void>;
  timer: ReturnType<typeof setTimeout> | null;
}

const tickers = new Map<number, Ticker>();
const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

function schedule(period: number, ticker: Ticker) {
  if (ticker.timer != null || ticker.listeners.size === 0 || hidden()) return;
  // Land on the next whole period, so every ticker of this period fires together.
  const wait = period - (Date.now() % period) + 2;
  ticker.timer = setTimeout(() => {
    ticker.timer = null;
    ticker.now = Date.now();
    for (const listener of ticker.listeners) listener();
    schedule(period, ticker);
  }, wait);
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    for (const [period, ticker] of tickers) {
      if (hidden()) {
        if (ticker.timer != null) clearTimeout(ticker.timer);
        ticker.timer = null;
      } else {
        ticker.now = Date.now();
        for (const listener of ticker.listeners) listener();
        schedule(period, ticker);
      }
    }
  });
}

function ticker(period: number): Ticker {
  let t = tickers.get(period);
  if (!t) {
    t = { now: Date.now(), listeners: new Set(), timer: null };
    tickers.set(period, t);
  }
  return t;
}

/** The current time, refreshed every `period` ms (aligned). Pass `active: false` to hold still. */
export function useNow(period: number, active = true): number {
  const t = ticker(period);
  // Stable per period: a new subscribe function every render would resubscribe every render.
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!active) return () => {};
      t.listeners.add(listener);
      schedule(period, t);
      return () => {
        t.listeners.delete(listener);
        if (t.listeners.size === 0 && t.timer != null) {
          clearTimeout(t.timer);
          t.timer = null;
        }
      };
    },
    [t, period, active],
  );
  // An idle ticker's time is refreshed on read (nobody else is watching it).
  const snapshot = useCallback(() => {
    if (t.listeners.size === 0) t.now = Date.now();
    return t.now;
  }, [t]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
