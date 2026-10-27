/**
 * What runs beside every page, as the Mac's ScoreStore and menu bar item
 * run beside its panel (loaded after the first paint; renders nothing):
 *
 * - The shell's scoreboard reader (`poll: "auto"`): it polls whenever no
 *   page does (Settings on a phone), and keeps polling a hidden tab while
 *   the tab title or alerts need the news.
 * - The tab's live score (MenuBarLabel.swift): the title and favicon show
 *   the pinned game, else a followed team's live game, or its final for ten
 *   minutes. A pin lets go four hours after its game, once it's over.
 * - Alerts for followed teams (Notifier.swift): each poll is compared with
 *   the last; a start, a score and a final each post one alert per game.
 *   A click (here, or through the service worker) opens the game.
 */
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { pollAlerts } from "../data/notifier";
import { involvesFollowed } from "../data/scoreboard";
import { scoreLine } from "../data/format";
import type { ScoreEvent } from "../data/models";
import { faviconScore, pinExpired, RECENT_FINAL_MS, tabEvent, tabTitle } from "../data/tabScore";
import { gameHref } from "../features/game/core/useGame";
import { useNow } from "../state/clock";
import { postAlert, useNotificationPermission } from "../state/notifications";
import { pin, usePinnedID } from "../state/pin";
import { useScoreboard } from "../state/scores";
import { useSettings } from "../state/settings";
import { setFaviconScore } from "./favicon";
import { setTitleScore } from "./useDocumentTitle";

export default function LiveServices() {
  const navigate = useNavigate();
  const followed = useSettings((s) => s.followed);
  const notify = useSettings((s) => s.notifyFollowed);
  const scoreInTitle = useSettings((s) => s.scoreInTitle);
  const pinnedID = usePinnedID();
  const permission = useNotificationPermission();
  const alerting = notify && permission === "granted" && followed.length > 0;
  const background = pinnedID != null || alerting || (scoreInTitle && followed.length > 0);
  const scores = useScoreboard({ poll: "auto", background });
  const now = useNow(60_000);

  // Every event once, in the user's league order (the first live followed game wins the title).
  const events = useRef<ScoreEvent[]>([]);
  const previous = useRef<Map<string, ScoreEvent> | null>(null);
  const recentFinals = useRef(new Map<string, number>());

  useEffect(() => {
    const prefs = scores.settings;
    const all = prefs.enabledLeagues.flatMap((id) => scores.results[id]?.events ?? []);
    events.current = all;
    const before = previous.current;
    previous.current = new Map(all.map((e) => [e.id, e]));
    if (!before) return;
    const at = Date.now();
    const mine = (e: ScoreEvent) => involvesFollowed(prefs, e);
    for (const e of all) {
      const was = before.get(e.id);
      if (!was || was.state === "final" || e.state !== "final") continue;
      if (was.state === "live" && (mine(e) || e.id === pin.get())) recentFinals.current.set(e.id, at);
    }
    if (!alerting) return;
    for (const alert of pollAlerts(before, all, mine, at)) {
      void postAlert(alert, { path: gameHref(alert.tag, scores.leagueOf(alert.tag)), open: (path) => navigate(path) });
    }
    // Only a change of data brings news; `alerting` is read as it is then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scores.results]);

  // The tab's title and favicon.
  useEffect(() => {
    for (const [id, at] of recentFinals.current) if (now - at > RECENT_FINAL_MS) recentFinals.current.delete(id);
    const pinned = pinnedID ? events.current.find((e) => e.id === pinnedID) : undefined;
    if (pinned && pinExpired(pinned, Date.now())) pin.clear();
    const event = tabEvent(events.current, {
      pinnedID,
      isFollowed: (e) => involvesFollowed(scores.settings, e),
      recentFinals: recentFinals.current,
      scoreInTitle,
      now: Date.now(),
    });
    setTitleScore(event ? { text: tabTitle(event), line: scoreLine(event, true) } : null);
    setFaviconScore(event ? faviconScore(event) : null);
  }, [scores.results, scores.settings, pinnedID, scoreInTitle, now]);

  useEffect(() => () => {
    setTitleScore(null);
    setFaviconScore(null);
  }, []);

  // A notification clicked while this tab was in the background (sw.js): open its game here.
  useEffect(() => {
    const sw = navigator.serviceWorker;
    if (!sw) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; path?: string } | null;
      if (data?.type === "open" && typeof data.path === "string" && data.path.startsWith("/")) navigate(data.path);
    };
    sw.addEventListener("message", onMessage);
    return () => sw.removeEventListener("message", onMessage);
  }, [navigate]);

  return null;
}
