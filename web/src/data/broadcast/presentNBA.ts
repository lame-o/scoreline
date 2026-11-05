/**
 * The NBA's live marks at p (Broadcast.swift `NBALive`, `presentedNBA`): who
 * has the ball, a shot in the air, clutch time, the run on, players on fire,
 * computed from the told plays, so nothing spoils a play the page hasn't told
 * yet. With the NBA page's chunk (it reads the NBA lane's run rule).
 */
import { ball, clutch as isClutch, FIRE_STREAK, periodStart, streaks as streaksOf, type CourtPlay } from "../basketball";
import { activeRun, type Run, type Teams } from "../liveFeeds/basketball";
import type { Side } from "../models";
import type { Broadcast } from "./broadcast";
import { isFinal, remaining } from "./presentedGame";

export interface NBALive {
  readonly possession: Side | null;
  readonly inAir: boolean;
  readonly clutch: boolean;
  readonly run: Run | null;
  readonly streaks: Readonly<Record<string, number>>;
  /** Game seconds played at p (the court's trail and the flow run to here). */
  readonly elapsed: number | null;
}

export const NO_NBA_LIVE: NBALive = { possession: null, inAir: false, clutch: false, run: null, streaks: {}, elapsed: null };

const memos = new WeakMap<Broadcast, { key: string; live: NBALive }>();

/** `court`: the page's court plays, already cut to what's told. */
export function presentedNBA(broadcast: Broadcast, court: readonly CourtPlay[], teams: Teams, quarter: number): NBALive {
  const presented = broadcast.presented;
  if (!broadcast.active || isFinal(presented)) return NO_NBA_LIVE;
  const key = `${court.length}|${court.at(-1)?.id ?? ""}|${presented.told}|${presented.revision}|${presented.clock ? Math.trunc(presented.clock.elapsed * 10) : -1}`;
  const memo = memos.get(broadcast);
  if (memo?.key === key) return memo.live;
  const b = ball(court);
  const fire: Record<string, number> = {};
  for (const [id, n] of Object.entries(streaksOf(court))) if (n >= FIRE_STREAK) fire[id] = n;
  let elapsed: number | null = null;
  let clutch = false;
  const clock = presented.clock;
  if (clock) {
    elapsed = periodStart(clock.period, quarter) + clock.elapsed;
    const score = presented.score;
    if (score) {
      const margin = broadcast.topIsHome ? score.home - score.away : score.away - score.home;
      clutch = isClutch(clock.period, remaining(clock), margin);
    }
  }
  const live: NBALive = { possession: b.side, inAir: b.inAir, clutch, run: activeRun(broadcast.toldPlays, teams, quarter), streaks: fire, elapsed };
  memos.set(broadcast, { key, live });
  return live;
}
