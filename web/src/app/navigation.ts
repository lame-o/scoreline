/**
 * Going back, the Mac way: Back returns to whichever page opened this one;
 * a page opened directly (a shared link) goes back to the scores. Esc does
 * the same from anywhere except a text field.
 */
import { useCallback } from "react";
import { useNavigate } from "react-router";
import type { NavState } from "./layout";

export function useGoBack(): (viaKeyboard?: boolean) => void {
  const navigate = useNavigate();
  return useCallback(
    (viaKeyboard = false) => {
      const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
      if (idx > 0) navigate(-1);
      else navigate("/", { replace: true, state: { viaKeyboard } satisfies NavState });
    },
    [navigate],
  );
}

/** Whether a key event is aimed at a text field (shortcuts stand aside). */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
}
