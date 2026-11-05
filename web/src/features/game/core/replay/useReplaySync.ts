/**
 * Keeps a page's replays in step with what they're built from (Replays.swift
 * `ReplaySync`, `PageReplays.update`): the page's summary and the live
 * lanes, as they arrive. What's told doesn't move it: the rows look up plays
 * already read. Each sport's page calls it with its lane; it reads only on a
 * new summary or a lane's new look, a moment later, after loading the
 * builders (data/replayReaders.ts) the first time, so the page's own chunk
 * carries no parser. A finished game's missing plays are fetched once.
 *
 *     useReplaySync(game, { football: feed });
 */
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { EMPTY_DETAIL } from "../../../../data/gameDetail";
import { getJSON } from "../../../../data/http";
import type { BasketballFeed } from "../../../../data/liveFeeds/basketball";
import type { FootballFeed } from "../../../../data/liveFeeds/football";
import type { SoccerFeed } from "../../../../data/liveFeeds/soccer";
import type { ReplaySession, SharedCache } from "../../../../data/replayReaders";
import type { GameContext } from "../sport";
import { useReplays } from "./pageReplays";

/** The live lanes a page's replays read beside it (only while live, but soccer's, which reads a final once too). */
export interface ReplayLanes {
  readonly soccer?: SoccerFeed | null;
  readonly football?: FootballFeed | null;
  readonly basketball?: BasketballFeed | null;
}

const NO_NUMBERS: Readonly<Record<string, string>> = {};

export function useReplaySync(game: GameContext, lanes: ReplayLanes = {}): void {
  const store = useReplays();
  // What arrives, never what's told: while the page broadcasts, the replays are built from the last load as it is
  // (the lists show only the told plays' rows; a row finds its replay waiting).
  const { event, detail } = game.raw;
  const { palette, colors } = game;
  const live = event.state === "live";
  const loaded = detail !== EMPTY_DETAIL;
  const client = useQueryClient();
  const session = useRef<Promise<ReplaySession> | null>(null);
  const [numbers, setNumbers] = useState<Readonly<Record<string, string>>>(NO_NUMBERS);

  // Who's who, as the page has it now (the colors follow the scheme).
  const top = event.content.kind === "match" ? event.content.top : null;
  const bottom = event.content.kind === "match" ? event.content.bottom : null;
  useEffect(() => {
    if (!store?.supported) return;
    store.setContext({
      eventID: event.id,
      top,
      bottom,
      topIsHome: detail.topIsHome ?? false,
      people: detail.people,
      fielders: detail.fielders,
      rosters: detail.soccerRosters,
      numbers,
      palette,
      kits: colors,
    });
  }, [store, event.id, top, bottom, detail.topIsHome, detail.people, detail.fielders, detail.soccerRosters, numbers, palette, colors]);

  // What each lane last brought (football's and basketball's only while live, as the Mac's key).
  const { soccer, football, basketball } = lanes;
  const soccerLook = soccer?.version ?? 0;
  const footballLook = live ? (football?.version ?? 0) : 0;
  const basketballLook = live ? (basketball?.version ?? 0) : 0;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!store?.supported || !loaded) return;
    session.current ??= import("../../../../data/replayReaders").then((m) => new m.ReplaySession());
    const cache: SharedCache = (key, fetch, fresh) => client.fetchQuery({ queryKey: key, queryFn: fetch, staleTime: fresh });
    // The soccer lane's run is taken now, so a later look can't take it first.
    const run = soccer?.takeReplayRun() ?? null;
    const struck = soccer?.struck ?? new Set<string>();
    void session.current
      .then((s) =>
        s.update(
          { event, detail, soccer: soccer ? { run, struck } : null, football: live ? (football?.items ?? null) : null, basketball: live ? (basketball?.items ?? null) : null, cache },
          getJSON,
        ),
      )
      .then((result) => {
        // Applied in the order they were read: each is every replayable play as it stood.
        if (!alive.current) return;
        store.update(result.plays);
        if (result.numbers) setNumbers(result.numbers);
      })
      .catch(() => {
        // The builders or a fetch failed: the rows stay as they are, and the next update tries again.
        session.current = null;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, loaded, event.id, event.state, detail, soccerLook, footballLook, basketballLook]);
}
