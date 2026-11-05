/**
 * Which theater a host shows (each sport's TheaterView host, the Mac's
 * `if let source, source.active`): while the page broadcasts the game, the
 * one on the choreography engine, reading the page's broadcast; otherwise
 * today's, which tells the lane's plays as they come. Kept apart from the
 * director so the page's own chunk carries none of the engine.
 *
 *     const directed = usePageDirected();
 *     directed ? <BasketballDirected source={directed.source} cues={directed.cues} holding={directed.holding} … /> : <BasketballTheater … />
 */
import { useMemo, useSyncExternalStore } from "react";
import type { Broadcast } from "../../../../data/broadcast/broadcast";
import { isInterval, stoppageOf } from "../../../../data/broadcast/presentedGame";
import type { BroadcastTheaterSource } from "../../../../data/broadcast/theaterSource";
import type { TheaterCues } from "../../../../data/theater/theaterView";
import { usePageBroadcastModel, useTheaterSource } from "../broadcast";

/** The page's broadcast while it runs, and the slides' cues: a theater on the engine. */
export interface Directed {
  readonly source: BroadcastTheaterSource;
  /** The slides' cues (null: the theater keeps its own, which the slides read). */
  readonly cues: TheaterCues | null;
  /** A game held up says so over anything else, in ESPN's words ("Rain Delay"): TheaterStatus.holding. */
  readonly holding?: string | null;
  /** At a break as presented (the half, between periods): soccer's teams go off without waiting for ESPN's entry. */
  readonly interval?: boolean;
}

/** What a held game says (TheaterStatus.holding: only the game's own status, never a timeout's words). */
export function heldWords(broadcast: Broadcast | null): string | null {
  const stoppage = broadcast ? stoppageOf(broadcast.presented) : null;
  return stoppage?.kind === "status" ? stoppage.words : null;
}

const noSubscribe = () => () => {};

/** The page's broadcast while it broadcasts (null: today's theater), with what a held game says and whether it's at a break. */
export function usePageDirected(): Directed | null {
  const source = useTheaterSource();
  const broadcast = usePageBroadcastModel();
  const subscribe = broadcast?.subscribe ?? noSubscribe;
  const holding = useSyncExternalStore(subscribe, () => heldWords(broadcast), () => null);
  const interval = useSyncExternalStore(subscribe, () => (broadcast ? isInterval(broadcast.presented) : false), () => false);
  return useMemo(() => (source ? { source, cues: null, holding, interval } : null), [source, holding, interval]);
}
