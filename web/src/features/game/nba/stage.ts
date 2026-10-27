/**
 * The NBA page's shared replay and picked player (BasketballReplay.swift
 * `NBAStage`). The court's scrubber and the game flow write the replay time;
 * box-score rows and leaders pick a player (the court then shows only their
 * shots). One per page, outside React.
 *
 * State changes (play, pause, seek, pick) reach React through `useStage`;
 * a running replay's frames never do. While it plays, one
 * requestAnimationFrame loop computes the time from the clock and hands it
 * to the frame listeners (the court and the flow draw straight to their
 * canvases), so a replay costs no renders. It runs only while playing.
 *
 *     const stage = useStageStore();
 *     const pinned = useStage(stage, (s) => s.pinned);
 *     useEffect(() => stage.onFrame((t) => draw(t)), [stage]);
 */
import { createContext, useContext, useSyncExternalStore } from "react";

export interface Playback {
  readonly from: number;
  /** performance.now() when it started. */
  readonly started: number;
  /** Where it stops: the end of a final, or "now" in a live game. */
  readonly end: number;
  /** Game seconds per second. */
  readonly rate: number;
}

export interface StageState {
  /** The player picked from the box score or leaders (ESPN athlete ID). */
  readonly pinned: string | null;
  /** A paused replay's game second (null while not replaying, or while playing). */
  readonly paused: number | null;
  readonly playback: Playback | null;
}

/** Game seconds per second of replay: regulation in 24 seconds (NBAStage.rate). */
export const REPLAY_RATE = 2880 / 24;

export const playbackTime = (p: Playback, now: number) => Math.min(p.from + Math.max(0, now - p.started) / 1000 * p.rate, p.end);

export class NBAStage {
  private state: StageState = { pinned: null, paused: null, playback: null };
  private listeners = new Set<() => void>();
  private frames = new Set<(t: number) => void>();
  private raf = 0;
  /** Reduce Motion: the replay steps twice a second instead of running. */
  stepped = false;

  get = (): StageState => this.state;
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  /** A replay frame's listener (the game second); returns its remover. */
  onFrame(l: (t: number) => void): () => void {
    this.frames.add(l);
    return () => this.frames.delete(l);
  }

  private set(next: Partial<StageState>) {
    this.state = { ...this.state, ...next };
    for (const l of this.listeners) l();
  }

  get replaying(): boolean {
    return this.state.paused != null || this.state.playback != null;
  }

  /** The replay's game second now (null: not replaying). */
  time(now = performance.now()): number | null {
    const p = this.state.playback;
    return p ? playbackTime(p, now) : this.state.paused;
  }

  /** Picks a player, or clears them if they're already picked. */
  togglePin(player: string | null) {
    this.set({ pinned: player == null || this.state.pinned === player ? null : player });
  }

  /** Whether there was a pick to drop. */
  unpin(): boolean {
    if (this.state.pinned == null) return false;
    this.set({ pinned: null });
    return true;
  }

  /** Holds the replay at `t`; at or past `end` there's nothing to replay, so it's the whole game (or live) again. */
  seek(t: number, end: number) {
    this.stop();
    this.set({ playback: null, paused: t >= end ? null : Math.max(0, t) });
  }

  /** Runs the replay from `from` to `end`, then hands back to the whole game. */
  play(from: number, end: number, rate = REPLAY_RATE) {
    if (end - from <= 1 || rate <= 0) return;
    this.stop();
    const playback: Playback = { from, started: performance.now(), end, rate };
    this.set({ paused: null, playback });
    let last = -1;
    const tick = (now: number) => {
      if (this.state.playback !== playback) return;
      const t = playbackTime(playback, now);
      if (t >= end) {
        this.raf = 0;
        this.set({ playback: null });
        return;
      }
      const shown = this.stepped ? Math.floor((now - playback.started) / 500) : t;
      if (shown !== last) {
        last = shown;
        for (const l of this.frames) l(t);
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  pause(now = performance.now()) {
    const p = this.state.playback;
    if (!p) return;
    this.stop();
    this.set({ paused: playbackTime(p, now), playback: null });
  }

  /** Back to the whole game (or live). */
  exit() {
    this.stop();
    if (this.state.playback || this.state.paused != null) this.set({ playback: null, paused: null });
  }

  dispose() {
    this.stop();
    this.listeners.clear();
    this.frames.clear();
  }

  private stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}

const StageContext = createContext<NBAStage | null>(null);
export const StageProvider = StageContext.Provider;

export function useStageStore(): NBAStage | null {
  return useContext(StageContext);
}

const none = () => () => {};
const empty: StageState = { pinned: null, paused: null, playback: null };

/** A slice of the stage; return a primitive so the reader re-renders only when its answer changes. */
export function useStage<T>(stage: NBAStage | null, select: (s: StageState) => T): T {
  return useSyncExternalStore(stage ? stage.subscribe : none, () => select(stage ? stage.get() : empty), () => select(empty));
}
