/**
 * The page's single moment slot, for React (Moments.swift `MomentCenter`):
 * one per game page, created by the page and offered each fast-lane batch.
 * A moment holds 4 s (a score 6 s), is announced politely when it's a score,
 * and goes. Charts read the slot for their own chart only, so a moment
 * re-renders the chart that shows it, not the page.
 *
 *     const moments = useMomentSlot();            // in GamePage
 *     moments.offer(feed.takeMoments());
 *     const moment = useChartMoment("plate");     // in a chart
 */
import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { wantsBurst } from "../../../data/celebrations";
import { MomentCenter, Tier, type LiveMoment, type MomentChart } from "../../../data/moments";
import { announce } from "./announce";

export interface MomentSlot {
  readonly current: () => LiveMoment | null;
  readonly subscribe: (listener: () => void) => () => void;
  readonly offer: (batch: readonly LiveMoment[]) => void;
  readonly retract: (ids: readonly string[]) => void;
  readonly remember: (ids: Iterable<string>) => void;
  readonly clear: () => void;
}

/** One slot for this page (unmounting clears it and its timers). */
export function useMomentSlot(): MomentSlot {
  const ref = useRef<MomentSlot | null>(null);
  if (!ref.current) ref.current = createSlot();
  const slot = ref.current;
  useEffect(() => () => slot.clear(), [slot]);
  return slot;
}

function createSlot(): MomentSlot {
  const center = new MomentCenter({ wantsBurst });
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const emit = () => listeners.forEach((l) => l());
  const stop = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return {
    current: () => center.current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    offer: (batch) => {
      const shown = center.offer(batch);
      if (!shown) return;
      stop();
      if (shown.tier === Tier.score) announce(`${shown.lead}. ${shown.detail}`);
      timer = setTimeout(() => {
        if (center.expire(shown.id)) emit();
      }, MomentCenter.hold(shown));
      emit();
    },
    retract: (ids) => {
      if (center.retract(ids)) {
        stop();
        emit();
      }
    },
    remember: (ids) => center.remember(ids),
    clear: () => {
      stop();
      center.clear();
      listeners.clear();
    },
  };
}

const SlotContext = createContext<MomentSlot | null>(null);

export function MomentProvider({ slot, children }: { slot: MomentSlot; children: React.ReactNode }) {
  return <SlotContext.Provider value={slot}>{children}</SlotContext.Provider>;
}

const none = () => () => {};

/** The page's moment, whatever its chart (the docked bar's news line, the hero's beats). */
export function useCurrentMoment(): LiveMoment | null {
  const slot = useContext(SlotContext);
  return useSyncExternalStore(slot ? slot.subscribe : none, () => slot?.current() ?? null, () => null);
}

/** The moment for this chart, if the page is showing one. */
export function useChartMoment(chart: MomentChart): LiveMoment | null {
  const slot = useContext(SlotContext);
  const get = useMemo(() => () => {
    const m = slot?.current() ?? null;
    return m?.chart === chart ? m : null;
  }, [slot, chart]);
  return useSyncExternalStore(slot ? slot.subscribe : none, get, () => null);
}
