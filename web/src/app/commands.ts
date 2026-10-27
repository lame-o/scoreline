/**
 * The app's commands from the keyboard (PanelCommands.swift): the Mac's
 * ⌘R Refresh, ⌘, Settings and ⌘U Schedule, as bare keys, because the
 * browser keeps ⌘R and ⌘, for itself:
 *
 *   R   Refresh: every league, and whatever the page in front loads
 *   ,   Settings
 *   S   Schedule
 *
 * They stand aside while typing, with any modifier held, inside an open
 * menu, and for a key some page already took. Keyboard actions never
 * animate: pages reached this way arrive without an entrance.
 * (P, pin the highlighted game, lives with the scores: ScoresPage.)
 */
import { useEffect } from "react";
import { useNavigate } from "react-router";
import type { NavState } from "./layout";
import { isTyping } from "./navigation";
import { queryClient } from "../state/scores";

export type Command = "refresh" | "settings" | "schedule";

/** The command a key press asks for, or null (pure, for tests). */
export function commandFor(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "repeat" | "defaultPrevented">, typing: boolean): Command | null {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.repeat || typing) return null;
  switch (event.key) {
    case "r":
    case "R":
      return "refresh";
    case ",":
      return "settings";
    case "s":
    case "S":
      return "schedule";
    default:
      return null;
  }
}

/** Refreshes every query on screen: the scores, and the page's own data (the Mac's `refreshToken`). */
export function refreshAll(): Promise<void> {
  return queryClient.refetchQueries({ type: "active" });
}

export function useAppCommands(): void {
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const command = commandFor(event, isTyping(target) || target?.closest?.('[role="menu"]') != null);
      if (!command) return;
      event.preventDefault();
      const go = (path: string) => {
        if (window.location.pathname !== path) navigate(path, { state: { viaKeyboard: true } satisfies NavState });
      };
      if (command === "refresh") void refreshAll();
      else if (command === "settings") go("/settings");
      else go("/schedule");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);
}
