/**
 * The page's single moment slot, for React (Moments.swift `MomentCenter`):
 * one per game page, created by the page and offered each fast-lane batch.
 * A moment holds 4 s (a score 6 s), is announced politely when it's a score
 * (unless the page's scoring slide tells it: core/scoringSlides.tsx), plays
 * its sound when Settings asks for sounds (core/sound.ts), and goes. Charts read the slot for their own chart only, so a moment
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
import { playCelebrationSound } from "./sound";

export interface MomentSlot {
  readonly current: () => LiveMoment | null;
  readonly subscribe: (listener: () => void) => () => void;
  readonly offer: (batch: readonly LiveMoment[]) => void;
  readonly retract: (ids: readonly string[]) => void;
  readonly remember: (ids: Iterable<string>) => void;
  readonly clear: () => void;
  /** The page's scoring slides (core/scoringSlides.tsx), which take each batch's scores first. */
  readonly attach?: (slides: SlideTaker | null) => void;
}

/**
 * What the slot asks of the page's scoring slides (DetailView.offer): the
 * scores among a batch join their line and are announced there, so the slot
 * stays quiet for them; then, once the slot has had the batch and given out
 * the page's burst, each learns whether the burst is its own and when to show.
 */
export interface SlideTaker {
  /** The IDs that joined the line (each makes its own announcement). */
  take(batch: readonly LiveMoment[]): ReadonlySet<string>;
  /** `granted`: the slot's moment after the batch; `claim` takes the page's burst cooldown for a moment no chart bursts for. */
  schedule(ids: ReadonlySet<string>, granted: LiveMoment | null, claim: () => boolean): void;
  retract(ids: readonly string[]): void;
}

const NONE: ReadonlySet<string> = new Set();

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
  let slides: SlideTaker | null = null;
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
      // The scoring slides take the scores first (and announce them).
      const slid = slides && batch.length > 0 ? slides.take(batch) : NONE;
      const shown = center.offer(batch);
      if (shown) {
        // Same call as the visual, so sound and picture start together (opt-in, off by default).
        playCelebrationSound(shown);
        stop();
        if (shown.tier === Tier.score && !slid.has(shown.id)) announce(`${shown.lead}. ${shown.detail}`);
        timer = setTimeout(() => {
          if (center.expire(shown.id)) emit();
        }, MomentCenter.hold(shown));
        emit();
      }
      if (slides && slid.size > 0) slides.schedule(slid, center.current, () => center.claimBurst());
    },
    retract: (ids) => {
      slides?.retract(ids);
      if (center.retract(ids)) {
        stop();
        emit();
      }
    },
    remember: (ids) => center.remember(ids),
    attach: (taker) => {
      slides = taker;
    },
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
