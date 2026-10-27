/**
 * The tab's title for a page: "Settings · Scoreline", "ARS 2–1 CHE · Scoreline".
 * Restores the app's own title when the page goes away.
 */
import { useEffect } from "react";

export const APP_TITLE = "Scoreline";

export function useDocumentTitle(title: string | null): void {
  useEffect(() => {
    document.title = title ? `${title} · ${APP_TITLE}` : APP_TITLE;
    return () => {
      document.title = APP_TITLE;
    };
  }, [title]);
}
