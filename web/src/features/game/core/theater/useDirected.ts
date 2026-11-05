/**
 * A directed theater's conversation with the page's broadcast
 * (TheaterView.swift `directed`, `TheaterDirecting`): it reads the timeline
 * (re-planning at each revision) and the clock (its events: a hold, a
 * resume, a skip or a jump re-plans), hands back its binding horizons and
 * solved anchors (one truth for the score, the lists and the court), and its
 * scoring cues for the slides (`TheaterCues`). Gone from the page, no theater
 * schedules the plays any more: nothing waits for its anchors.
 *
 *     const director = useDirector(() => new TheaterDirector(HoopsSport, facts), eventId);
 *     useDirected(director, source, facts, cues);
 */
import { useEffect, useMemo, useState } from "react";
import type { TheaterClip } from "../../../../data/theater/theaterClips";
import type { TheaterDirector } from "../../../../data/theater/theaterDirector";
import { sameEvent, type BroadcastTheaterSource, type ClockEvent, type TheaterClock } from "../../../../data/theater/theaterSource";
import type { TheaterCues } from "../../../../data/theater/theaterView";

/** The default binding horizon for live-ball kinds a sport doesn't name (GameTimeline.swift `BindingHorizons().live`). */
const LIVE_HORIZON = 2.5;

/** One director for the page (made once per `key`, disposed with it). */
export function useDirector<D extends { dispose(): void; revive(): void }>(make: () => D, key: string): D {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const director = useMemo(make, [key]);
  useEffect(() => {
    director.revive();
    return () => director.dispose();
  }, [director]);
  return director;
}

/**
 * When the broadcast last brought a play (epoch ms), for the heartbeat
 * ("Live · 4s"; the Mac's `feed.theater.heard`): `given` when the page knows
 * it, else the moment the source's plays last changed while the theater was up.
 */
export function useHeard(source: BroadcastTheaterSource | null, given: number | null): number | null {
  const [heard, setHeard] = useState<number | null>(null);
  useEffect(() => {
    if (!source) return;
    let revision = source.revision;
    return source.subscribe(() => {
      if (source.revision === revision) return;
      revision = source.revision;
      setHeard(Date.now());
    });
  }, [source]);
  return given ?? heard;
}

export function useDirected<Clip extends TheaterClip, Play, Facts, Context>(
  director: TheaterDirector<Clip, Play, Facts, Context>,
  source: BroadcastTheaterSource | null,
  facts: Facts,
  cues: TheaterCues | null,
): void {
  // The viewer turned the court (the facts changed): re-plan.
  useEffect(() => {
    director.factsDidChange(facts);
  });

  useEffect(() => {
    if (!source) return;
    source.setBindingHorizons({ live: LIVE_HORIZON, byKind: director.sport.horizons });
    // The source's wall: the page's, or a virtual one.
    if (source.now) director.now = () => source.now!();
    let lastEvent: ClockEvent | null = null;
    let clock: TheaterClock | null = null;
    let revision: number | null = null;
    /** Hands the director the clock's events since the last it had. */
    const clockChanged = (c: TheaterClock) => {
      const events = c.events;
      let fresh: readonly ClockEvent[] = events;
      if (lastEvent) {
        const last = lastEvent;
        const i = events.findLastIndex((e) => sameEvent(e, last));
        if (i >= 0) fresh = events.slice(i + 1);
      }
      lastEvent = events[events.length - 1] ?? null;
      director.clockDidChange(c, fresh);
    };
    const publish = () => source.setAnchors(director.anchors, director.covering, director.leadIns);
    const sync = () => {
      if (source.clock !== clock) {
        clock = source.clock;
        clockChanged(clock);
        // The clock re-planned: where T reaches each decisive frame on p moved with it.
        publish();
      }
      if (source.revision !== revision) {
        revision = source.revision;
        director.timelineDidChange(source.snapshot());
      }
    };
    sync();
    const offSource = source.subscribe(sync);
    let chainRevision = director.chain.revision;
    const offDirector = director.subscribe(() => {
      if (director.chain.revision === chainRevision) return;
      chainRevision = director.chain.revision;
      publish();
      cues?.publish(director.chain, (w) => director.time(w));
    });
    return () => {
      offSource();
      offDirector();
      // No theater schedules the plays any more: nothing waits for its anchors.
      source.setAnchors(director.anchors, null, new Map());
    };
  }, [director, source, cues]);
}
