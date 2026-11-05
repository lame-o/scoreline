/**
 * The open game page's presented copy of its game (ScoreStore.swift
 * `presentedEvent`, `present`, `notifyPresented`; BROADCAST.md §3): while a
 * game's page broadcasts, the tab's title and favicon follow what the page
 * presents (data/tabScore.ts `menuBar`), so nothing in the tab strip spoils a
 * play the page hasn't told yet; the scoreboard's alerts for that game wait
 * (`alertsFollowPage`), and the page sends them from its presented changes.
 * Any other game, or once the page closes or its tab hides, the scoreboard's.
 *
 * One page broadcasts at a time; the page sets it (features/game/core/
 * broadcast.tsx), the shell reads it (app/LiveServices.tsx). Outside React.
 */
import { useSyncExternalStore } from "react";
import { alertsFor } from "../data/following";
import { gameHref } from "../data/gameHref";
import type { ScoreEvent } from "../data/models";
import { alertFor } from "../data/notifier";
import { postAlert } from "./notifications";
import { getSettings } from "./settings";

let presented: ScoreEvent | null = null;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The page's presented game moved (or the page closed: null). The tab follows it. */
export function presentEvent(event: ScoreEvent | null): void {
  if (presented === event) return;
  presented = event;
  for (const l of [...listeners]) l();
}

export function getPresentedEvent(): ScoreEvent | null {
  return presented;
}

/** The open page's presented game, for the shell. */
export function usePresentedEvent(): ScoreEvent | null {
  return useSyncExternalStore(subscribe, getPresentedEvent, () => null);
}

/**
 * The page's presented game changed: its alert, as the scoreboard's would be
 * (a followed team's, with alerts on). `league` routes the click to the game.
 */
export function notifyPresented(before: ScoreEvent, after: ScoreEvent, league: string | null, open: (path: string) => void): void {
  if (!alertsFor(after, getSettings())) return;
  const alert = alertFor(before, after, Date.now());
  if (alert) void postAlert(alert, { path: gameHref(after.id, league), open });
}
