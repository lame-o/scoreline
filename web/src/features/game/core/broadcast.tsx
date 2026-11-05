/**
 * The game as one broadcast, on the page (DetailView.swift's `broadcast`;
 * BROADCAST.md §3): one `Broadcast` (data/broadcast/broadcast.ts) per game
 * page, fed by what the page already reads, and read by everything on the
 * page that isn't a theater.
 *
 * - In: each summary as it loads (the first one of a live ESPN game starts
 *   the broadcast, its score floor what the owner could already see: the
 *   scoreboard's copy and the scores list's), the scoreboard's copy as the
 *   store polls it, and each fast lane's look, status and reads
 *   (`feedBroadcast`, from the sport pages' lane ticks).
 * - Out: the presented event (the hero, the docked bar, the tab's title and
 *   favicon, the alerts) and the presented detail (the play lists cut to
 *   what's told, the line score from the told plays, Win Probability at the
 *   last told play, the tables held per summary); the moment slot gated on
 *   p (a moment waits for its play's moment); the presentation clock (the
 *   odds chart presents its ticks at their own time on p).
 * - The page re-renders only when what's published changes (a play told, a
 *   score, a phase, the clock starting or stopping, a drift over 0.75 s):
 *   the model schedules its own next change; nothing polls, nothing ticks
 *   per frame.
 * - A hidden tab is the Mac asleep: nothing is scheduled while it's hidden,
 *   the tab's title and the alerts go back to the scoreboard's, and coming
 *   back more than 30 s later is a wake (the live edge, the floor raised to
 *   what the tab showed meanwhile).
 * - The theaters keep today's inputs until the director (CHOREOGRAPHY Phase
 *   0) reads `useTheaterSource()`.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Broadcast } from "../../../data/broadcast/broadcast";
import { behindSpoken, behindText, type BehindLive } from "../../../data/broadcast/behindLive";
import { noteOf, type PresentedGame } from "../../../data/broadcast/presentedGame";
import type { BroadcastTheaterSource } from "../../../data/broadcast/theaterSource";
import { sideMapper, type GameDetail } from "../../../data/gameDetail";
import type { JSONValue } from "../../../data/json";
import type { StatcastAtBat } from "../../../data/mlb/statcast";
import type { ScoreEvent } from "../../../data/models";
import { withLaneScores } from "../../../state/laneScores";
import { notifyPresented, presentEvent } from "../../../state/presented";
import { queryClient } from "../../../state/scores";
import { useReducedMotion } from "./useMedia";
import type { MomentSlot } from "./moments";
import styles from "./BehindLive.module.css";

/** MLB's at-bats the page's Statcast query has cached for this game (useStatcast.ts's keys), for MLB's own pitch times. */
function cachedAtBats(eventID: string): readonly StatcastAtBat[] {
  const gamePk = queryClient.getQueryData<number | null>(["statcast", "game", eventID]);
  if (gamePk == null) return [];
  return queryClient.getQueryData<{ atBats: readonly StatcastAtBat[] }>(["statcast", "feed", gamePk])?.atBats ?? [];
}

export interface PageBroadcast {
  readonly broadcast: Broadcast;
  /** This page broadcasts (a live ESPN game with a play-by-play): the presented copies differ from today's. */
  readonly active: boolean;
  /** The event at p (the scoreboard's copy while not broadcasting). */
  readonly event: ScoreEvent;
  /** The detail at p (the last load's while not broadcasting). */
  readonly detail: GameDetail | null;
  readonly presented: PresentedGame;
  /** Why play has stopped, under the clock ("Official timeout"); null otherwise. */
  readonly note: string | null;
  /** The page's moment slot, gated on p: a lane's moment waits for its play's moment. */
  readonly moments: MomentSlot;
}

/**
 * The page's broadcast: `raw` is the scoreboard's copy of the game (or the
 * summary's), `detail` the last load, `slot` the page's moment slot, `league`
 * the scoreboard's league (an alert's click opens the game there).
 */
export function usePageBroadcast(raw: ScoreEvent, detail: GameDetail | null, slot: MomentSlot, league: string | null, open: (path: string) => void): PageBroadcast {
  const ref = useRef<Broadcast | null>(null);
  ref.current ??= new Broadcast({ statcast: cachedAtBats, log: import.meta.env.DEV ? (m) => console.debug(`Broadcast: ${m}`) : undefined });
  const broadcast = ref.current;
  useSyncExternalStore(broadcast.subscribe, () => broadcast.version, () => 0);

  const latest = useRef({ raw, league, open });
  latest.current = { raw, league, open };
  const ingested = useRef<GameDetail | null>(null);
  const observed = useRef<ScoreEvent | null>(null);

  // The page closing (or another game taking it): everything shows as today again.
  useEffect(
    () => () => {
      broadcast.end();
      ingested.current = null;
      observed.current = null;
      presentEvent(null);
    },
    [broadcast],
  );

  // The store's scoreboard copy of the game, as it polls (once per copy).
  useEffect(() => {
    if (observed.current === raw) return;
    observed.current = raw;
    broadcast.observeScoreboard(raw);
  }, [broadcast, raw]);

  // A summary loaded: the broadcast starts on a live game's first, and reads each one's plays and tables.
  useEffect(() => {
    if (!detail || ingested.current === detail) return;
    ingested.current = detail;
    if (detail.topIsHome != null) broadcast.begin(raw, detail.topIsHome, withLaneScores([raw]));
    broadcast.ingestSummary(detail);
    // Only a new load starts or feeds it; `raw` is read as it is then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [broadcast, detail]);

  // Moments whose play was just told, the tab's presented copy and the alerts: on each published change.
  useEffect(() => {
    let released = broadcast.releasedRevision;
    let shown: ScoreEvent | null = null;
    let presented = broadcast.presented;
    const changed = () => {
      if (broadcast.releasedRevision !== released) {
        released = broadcast.releasedRevision;
        slot.offer(broadcast.takeReleased());
      }
      if (!broadcast.active || document.visibilityState === "hidden") return;
      // The tab follows the presented game; so do the alerts (a floor going alone is quiet).
      const next = broadcast.presentEvent(latest.current.raw);
      const told = presented !== broadcast.presented;
      presented = broadcast.presented;
      const scores = (e: ScoreEvent) => (e.content.kind === "match" ? `${e.content.top.score}|${e.content.bottom.score}` : "");
      if (told && shown && (scores(shown) !== scores(next) || shown.state !== next.state)) {
        notifyPresented(shown, next, latest.current.league, (path) => latest.current.open(path));
      }
      shown = next;
      presentEvent(next);
    };
    changed();
    return broadcast.subscribe(changed);
  }, [broadcast, slot]);

  // A hidden tab is the machine asleep: nothing scheduled, the tab's title and the alerts back to the scoreboard's.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        broadcast.suspend();
        presentEvent(null);
      } else {
        broadcast.resume();
        if (broadcast.active) presentEvent(broadcast.presentEvent(latest.current.raw));
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [broadcast]);

  // A lane's moments wait for their play's moment on p; a retraction takes back only what was offered.
  const moments = useMemo<MomentSlot>(
    () => ({
      ...slot,
      offer: (batch) => slot.offer(broadcast.gate(batch)),
      retract: (ids) => slot.retract(broadcast.retract(ids)),
    }),
    [slot, broadcast],
  );

  const side = useMemo(() => sideMapper(raw), [raw]);
  const active = broadcast.active;
  return {
    broadcast,
    active,
    event: broadcast.presentEvent(raw),
    detail: detail ? broadcast.presentDetail(detail, 0, side) : null,
    presented: broadcast.presented,
    note: active ? noteOf(broadcast.presented) : null,
    moments,
  };
}

/** A lane as the broadcast reads it (LiveFeeds.swift's `lastLook`, `lookRevision`, `lastStatus`, `lastRead`). */
export interface BroadcastLane {
  readonly lookRevision: number;
  readonly lastLook: readonly JSONValue[];
  readonly lastStatus?: JSONValue | null;
  readonly lastRead?: number | null;
}

/**
 * Runs a fast lane's look and feeds the broadcast what it read
 * (DetailView.feedBroadcast): its status, then its new look at the plays (a
 * tail of the game), or a read with nothing new. `alwaysRead`: soccer's,
 * which notes a read whenever the look didn't change.
 */
export async function feedBroadcast(broadcast: Broadcast | null, lane: BroadcastLane, look: () => Promise<void>, alwaysRead = false): Promise<void> {
  const revision = lane.lookRevision;
  const read = lane.lastRead ?? null;
  await look();
  if (!broadcast?.active) return;
  if (lane.lastStatus !== undefined) broadcast.observeStatus(lane.lastStatus);
  if (lane.lookRevision !== revision) broadcast.ingestCore(lane.lastLook);
  else if (alwaysRead || (lane.lastRead ?? null) !== read) broadcast.noteRead();
}

// MARK: - The theater's side

const SourceContext = createContext<Broadcast | null>(null);

/** Gives the page's broadcast to its sections (the theaters' director reads it through `useTheaterSource`). */
export function BroadcastProvider({ broadcast, children }: { broadcast: Broadcast; children: ReactNode }) {
  return <SourceContext.Provider value={broadcast}>{children}</SourceContext.Provider>;
}

/** The page's broadcast, for the sport pages (null outside a game page). */
export function usePageBroadcastModel(): Broadcast | null {
  return useContext(SourceContext);
}

/**
 * What the theater director reads (data/broadcast/theaterSource.ts): the
 * page's broadcast while it broadcasts, else null (the theaters keep today's
 * inputs). Subscribe to hear a re-plan; read `p` per frame from its clock.
 */
export function useTheaterSource(): BroadcastTheaterSource | null {
  const broadcast = useContext(SourceContext);
  useSyncExternalStore(broadcast?.subscribe ?? noSubscribe, () => broadcast?.active ?? false, () => false);
  return broadcast?.active ? broadcast : null;
}

const noSubscribe = () => () => {};

// MARK: - How far behind live, on hover only (BehindLive.swift)

/**
 * The live indicator's hover (the hero's red dot and clock, the docked
 * bar's): while the pointer rests on it, a card under it says how far behind
 * live the page is ("About 55 s behind live", and a quieter "Catching up" or
 * "Waiting for the feed"). Nothing at rest. It waits for the pointer to
 * settle (80 ms, as linked hover does), grows out of the indicator (0.97 → 1
 * with a 2pt drop, on the fade's timing) and leaves faster than it came (the
 * exit's), a plain fade; with Reduce Motion, a fade in. The card is drawn
 * over the page (a portal), outside the hero's glass, so its glass never
 * blends into the hero's and nothing in the hero covers it. `read`: the
 * readout as of the hover (null: not broadcasting, no hover).
 */
export function BehindLiveHover({
  read,
  align = "center",
  below = 6,
  under,
  children,
}: {
  read: (() => BehindLive | null) | null;
  align?: "center" | "trailing";
  /** The gap from the indicator's bottom (or `under`'s) to the card's top, in points. */
  below?: number;
  /** What the card hangs under, when not the indicator itself (the docked bar: just under the bar, not over it). */
  under?: () => Element | null;
  children: ReactNode;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const intent = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [card, setCard] = useState<{ behind: BehindLive; rect: DOMRect; bottom: number; leaving: boolean } | null>(null);
  const reduce = useReducedMotion();
  const clear = () => {
    if (intent.current) clearTimeout(intent.current);
    intent.current = null;
  };
  useEffect(() => () => clear(), []);
  // A card that's leaving goes once its fade is done; scrolling takes it away at once.
  useEffect(() => {
    if (!card) return;
    if (card.leaving) {
      const timer = setTimeout(() => setCard(null), 130);
      return () => clearTimeout(timer);
    }
    const away = () => setCard(null);
    window.addEventListener("scroll", away, { capture: true, passive: true, once: true });
    return () => window.removeEventListener("scroll", away, { capture: true });
  }, [card]);
  if (!read) return <>{children}</>;
  return (
    <span
      ref={host}
      className={styles.indicator}
      data-behind-live=""
      // Over the indicator the readout is the help, not the bar's "Back to top".
      title=""
      onPointerEnter={(e) => {
        if (e.pointerType !== "mouse") return;
        clear();
        // Wait for the pointer to settle, so sweeping across the page doesn't flash it.
        intent.current = setTimeout(() => {
          const behind = read();
          const rect = host.current?.getBoundingClientRect();
          const bottom = (under?.() ?? host.current)?.getBoundingClientRect().bottom ?? rect?.bottom ?? 0;
          if (behind && rect) setCard({ behind, rect, bottom, leaving: false });
        }, 80);
      }}
      onPointerLeave={() => {
        clear();
        setCard((c) => (c ? { ...c, leaving: true } : null));
      }}
    >
      {children}
      {card && typeof document !== "undefined"
        ? createPortal(
            <span
              className={styles.card}
              data-leaving={card.leaving || undefined}
              data-reduce={reduce || undefined}
              data-align={align}
              style={{
                top: `calc(${card.bottom}px + ${below} * var(--pt))`,
                left: align === "center" ? card.rect.left + card.rect.width / 2 : undefined,
                right: align === "trailing" ? Math.max(window.innerWidth - card.rect.right, 0) : undefined,
              }}
              aria-hidden="true"
            >
              <span className={styles.text}>{behindText(card.behind)}</span>
              {card.behind.note ? <span className={styles.note}>{card.behind.note}</span> : null}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}

/** What a screen reader hears with the hero while the page broadcasts ("About 55 seconds behind live"). */
export function behindLiveSpoken(broadcast: Broadcast): string | null {
  const behind = broadcast.behind;
  return behind ? behindSpoken(behind) : null;
}
