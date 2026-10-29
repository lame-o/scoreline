/**
 * Development only: Win Probability on real games without one being on
 * (the Mac app's render harness, for the web). GSW @ MIN (2026-10-28) and
 * Aston Villa v Manchester City (2026-10-24), from test/fixtures/odds, through
 * the real section, feed and socket path: a stand-in network serves the
 * recorded Polymarket listing, market and history cut at a running clock, and
 * a stand-in socket sends the recorded prices after it as the CLOB's own
 * `price_change` messages, so the chart glides, pulses and badges as it would
 * on a live night.
 *
 *     /dev/odds?game=nba&state=live&at=95&speed=30
 *
 * `game` nba | soccer; `state` live | final | scheduled; `at` minutes after
 * the first play (live); `speed` recorded seconds per real second (live).
 * Fixtures load lazily, so nothing here ships.
 */
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { EMPTY_DETAIL } from "../../../../data/gameDetail";
import type { Competitor, EventState, ScoreEvent, Sport } from "../../../../data/models";
import { parseOddsBasis } from "../../../../data/odds/espn";
import { teamPalette } from "../../../../data/teamColors";
import { useNow } from "../../../../state/clock";
import { setOddsEnvironment } from "../../../../state/odds";
import { useColorScheme } from "../../../../state/theme";
import type { GameContext } from "../sport";
import { WinProbabilitySection } from "./WinProbabilitySection";

const files = import.meta.glob<{ default: unknown }>("../../../../../test/fixtures/odds/*.json");
const load = async (name: string) => structuredClone((await files[`../../../../../test/fixtures/odds/${name}.json`]!()).default) as Record<string, unknown>;

interface Game {
  readonly sport: Sport;
  readonly path: string;
  readonly prefix: string;
  readonly start: number;
  readonly top: Competitor;
  readonly bottom: Competitor;
  /** Soccer lists the home side first. */
  readonly topIsHome: boolean;
}

const team = (name: string, abbreviation: string, color: string): Competitor => ({ id: null, name, abbreviation, score: null, logo: null, isWinner: false, color, rank: null, record: null, conferenceRecord: null, alternateColor: null });

const GAMES: Readonly<Record<string, Game>> = {
  nba: { sport: "basketball", path: "basketball/nba", prefix: "nba-gsw-min", start: Date.parse("2026-10-29T00:00:00Z"), top: team("Warriors", "GS", "1d428a"), bottom: team("Timberwolves", "MIN", "78be20"), topIsHome: false },
  soccer: { sport: "soccer", path: "soccer/eng.1", prefix: "epl-ast-mac", start: Date.parse("2026-10-24T11:30:00Z"), top: team("Aston Villa", "AVL", "670e36"), bottom: team("Man City", "MNC", "6cabdd"), topIsHome: true },
};

type Entry = Record<string, unknown>;
const wall = (p: unknown) => Date.parse(String((p as Entry | undefined)?.wallclock ?? ""));

/** The summary as ESPN had it at a moment: the plays (and their model) up to then. */
function cut(summary: Entry, now: number): Entry {
  const plays = ((summary.plays as Entry[] | undefined) ?? []).filter((p) => !(wall(p) > now));
  const kept = new Set(plays.map((p) => String(p.id)));
  return {
    ...summary,
    plays,
    winprobability: ((summary.winprobability as Entry[] | undefined) ?? []).filter((w) => kept.has(String(w.playId))),
    commentary: ((summary.commentary as Entry[] | undefined) ?? []).filter((c) => !(wall(c.play) > now)),
  };
}

interface Recorded {
  readonly summary: Entry;
  readonly listing: unknown;
  readonly market: unknown;
  readonly event: unknown;
  readonly histories: Readonly<Record<string, { history: { t: number; p: number }[] }>>;
}

/** What the stand-ins did, for the performance check (`window.__oddsDev`): sockets open now, requests made, messages sent. */
const activity = { open: 0, fetches: 0, messages: 0 };
if (typeof window !== "undefined") (window as unknown as { __oddsDev: typeof activity }).__oddsDev = activity;

/** A socket that replays the recorded prices after the clock as the CLOB channel's messages. */
class ReplaySocket {
  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private tokens: string[] = [];
  private readonly last = new Map<string, number>();

  constructor(
    private readonly recorded: Recorded,
    private readonly now: () => number,
  ) {
    activity.open++;
    setTimeout(() => this.onopen?.({}), 60);
  }

  send(data: string): void {
    if (data === "PING") {
      setTimeout(() => this.onmessage?.({ data: "PONG" }), 30);
      return;
    }
    this.tokens = (JSON.parse(data) as { assets_ids: string[] }).assets_ids;
    this.timer = setInterval(() => this.tick(), 700);
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.timer || this.tokens.length) activity.open--;
    this.timer = null;
    this.tokens = [];
  }

  private tick(): void {
    const t = this.now();
    const changes = this.tokens.flatMap((token) => {
      const h = this.recorded.histories[token]?.history ?? [];
      const at = h.filter((x) => x.t * 1000 <= t).at(-1);
      if (!at || this.last.get(token) === at.p) return [];
      this.last.set(token, at.p);
      // A cent-wide book around the recorded price: its midpoint is the price.
      return [{ asset_id: token, best_bid: (at.p - 0.005).toFixed(4), best_ask: (at.p + 0.005).toFixed(4), price: String(at.p), side: "BUY", size: "100" }];
    });
    if (!changes.length) return;
    activity.messages++;
    this.onmessage?.({ data: JSON.stringify({ event_type: "price_change", timestamp: String(Math.round(t)), price_changes: changes }) });
  }
}

export function OddsPreview() {
  const [params] = useSearchParams();
  const which = params.get("game") === "soccer" ? "soccer" : "nba";
  const game = GAMES[which]!;
  const state = (["live", "final", "scheduled"].includes(params.get("state") ?? "") ? params.get("state") : "live") as EventState;
  const at = Number(params.get("at") ?? (which === "soccer" ? 60 : 95));
  const speed = Number(params.get("speed") ?? 30);
  const scheme = useColorScheme();
  const [recorded, setRecorded] = useState<Recorded | null>(null);

  useEffect(() => {
    void (async () => {
      const [summary, listing, history, second] = await Promise.all([
        load(`espn-${game.prefix}-summary`),
        load(`pm-${game.prefix}-listing`),
        load(`pm-${game.prefix}-history`),
        load(game.sport === "soccer" ? `pm-${game.prefix}-event` : `pm-${game.prefix}-market`),
      ]);
      setRecorded({ summary, listing: listing.events, market: second, event: second, histories: history.histories as Recorded["histories"] });
    })();
  }, [game]);

  // The clock: live runs from `at` minutes into the game at `speed`; a final sits after the end; before the game, 20 minutes before it.
  const clock = useMemo(() => {
    if (!recorded) return null;
    const basis = parseOddsBasis(recorded.summary, game.sport, game.topIsHome);
    const origin = Date.now();
    const from = state === "live" ? (basis.start ?? game.start) + at * 60_000 : state === "final" ? (basis.end ?? game.start) + 3_600_000 : game.start - 20 * 60_000;
    const rate = state === "live" ? speed : 1;
    return () => from + (Date.now() - origin) * rate;
  }, [recorded, game, state, at, speed]);

  // The stand-in network and socket, before the section mounts.
  const ready = useMemo(() => {
    if (!recorded || !clock) return false;
    setOddsEnvironment({
      now: clock,
      fetcher: async (url) => {
        activity.fetches++;
        const u = new URL(url);
        if (u.pathname === "/events") return recorded.listing;
        if (u.pathname.startsWith("/markets/slug/")) return recorded.market;
        if (u.pathname.startsWith("/events/slug/")) return recorded.event;
        if (u.pathname === "/prices-history") {
          const token = u.searchParams.get("market") ?? "";
          const from = Number(u.searchParams.get("startTs")) * 1000;
          const now = clock();
          return { history: (recorded.histories[token]?.history ?? []).filter((x) => x.t * 1000 >= from && x.t * 1000 <= now) };
        }
        if (u.pathname === "/midpoint") return { mid: "0.5" };
        throw new Error(`No stand-in for ${url}`);
      },
      socket: () => new ReplaySocket(recorded, clock) as never,
    });
    return true;
  }, [recorded, clock]);

  const now = useNow(2000);
  const context = useMemo((): GameContext | null => {
    if (!recorded || !clock || !ready) return null;
    const t = clock();
    const event: ScoreEvent = {
      id: `dev-odds-${which}-${state}`,
      content: { kind: "match", top: game.top, bottom: game.bottom },
      state,
      start: game.start,
      detail: null,
      caption: null,
      link: null,
      ref: { kind: "espn", path: game.path, id: "dev", sport: game.sport },
      stage: null,
      clock: null,
      possession: null,
      liveLine: null,
      liveLineRoutine: false,
      broadcast: null,
      venue: null,
      snapshot: null,
    };
    const summary = state === "scheduled" ? { ...cut(recorded.summary, -Infinity), winprobability: [] } : cut(recorded.summary, t);
    return {
      event,
      detail: { ...EMPTY_DETAIL, topIsHome: game.topIsHome, odds: parseOddsBasis(summary, game.sport, game.topIsHome) },
      palette: teamPalette(game.top.color, game.bottom.color, scheme),
      names: { top: game.top.abbreviation, bottom: game.bottom.abbreviation },
      spoken: { top: game.top.name, bottom: game.bottom.name },
      live: state === "live",
      split: false,
    } as unknown as GameContext;
    // `now`: the ESPN half moves on with the clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorded, clock, ready, which, state, game, scheme, Math.floor(now / 2000)]);

  if (!context) return null;
  return (
    <div style={{ maxWidth: "calc(560 * var(--pt))", margin: "0 auto", paddingBottom: "calc(40 * var(--pt))" }}>
      <WinProbabilitySection game={context} />
    </div>
  );
}
