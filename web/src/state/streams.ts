/**
 * What's streaming, as ScoreStore holds it beside the scores
 * (`climbingBroadcast`, `coStreamingIDs`, `coStreamerAvatar`): World
 * Climbing's stream on YouTube, and the live CS2 matches the co-streamer
 * (Settings → CS2, ohnePixel by default) is showing on Twitch, with their
 * avatar. The shell's watcher (state/streamWatch.ts, beside every page)
 * keeps it; rows, tiles and pages read it by selector, so a change redraws
 * only the marks it changes (EventRow.swift's StatusView reads it the same
 * way).
 *
 *     const coStreaming = useStreams((s) => s.coStreaming.has(event.id));
 *     const live = useStreams((s) => liveOnYouTube(event, s.climbing));
 */
import { useSyncExternalStore } from "react";
import type { ClimbingBroadcast } from "../data/climbingBroadcast";

export interface StreamState {
  /** World Climbing's current or next stream, while a competition is near and climbing is shown. */
  readonly climbing: ClimbingBroadcast | null;
  /** Live CS2 matches the co-streamer is showing. */
  readonly coStreaming: ReadonlySet<string>;
  /** The co-streamer's Twitch avatar (a URL), once read. */
  readonly avatar: string | null;
  /** The channel these are for ("ohnepixel"). */
  readonly handle: string;
}

const NONE: ReadonlySet<string> = new Set();
let state: StreamState = { climbing: null, coStreaming: NONE, avatar: null, handle: "" };
const listeners = new Set<() => void>();

/** Live matches bo3.gg lists the channel for (ScoreStore.confirmedCoStreams): definitive, per channel. */
let confirmed = { handle: "", ids: new Set<string>() };

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id));
}

function publish(next: StreamState) {
  if (next.climbing === state.climbing && next.avatar === state.avatar && next.handle === state.handle && sameSet(next.coStreaming, state.coStreaming)) return;
  state = { ...next, coStreaming: sameSet(next.coStreaming, state.coStreaming) ? state.coStreaming : next.coStreaming };
  for (const l of listeners) l();
}

export const streams = {
  get: (): StreamState => state,
  setClimbing(climbing: ClimbingBroadcast | null) {
    publish({ ...state, climbing });
  },
  /** The co-stream as the watcher last worked it out: its matches by title, plus those bo3.gg confirmed that are still live. */
  setCoStream(handle: string, ids: ReadonlySet<string>, liveIDs: ReadonlySet<string>, avatar: string | null) {
    if (confirmed.handle !== handle) confirmed = { handle, ids: new Set() };
    for (const id of confirmed.ids) if (!liveIDs.has(id)) confirmed.ids.delete(id);
    publish({ ...state, handle, avatar, coStreaming: new Set([...ids, ...confirmed.ids].filter((id) => liveIDs.has(id))) });
  },
  /**
   * The match page found the channel among bo3.gg's streams for a live match
   * (ScoreStore.noteStreams): co-streaming, for certain, until it ends.
   */
  confirm(handle: string, eventID: string) {
    if (confirmed.handle !== handle) confirmed = { handle, ids: new Set() };
    if (confirmed.ids.has(eventID)) return;
    confirmed.ids.add(eventID);
    if (state.handle === handle || state.handle === "") publish({ ...state, handle, coStreaming: new Set([...state.coStreaming, eventID]) });
  },
  /** Co-streams off, or no live match: nothing is co-streamed. */
  clearCoStream() {
    publish({ ...state, coStreaming: NONE });
  },
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A slice of what's streaming; re-renders only when the slice changes (return primitives or stored values). */
export function useStreams<T>(select: (s: StreamState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => select(state),
    () => select(state),
  );
}
