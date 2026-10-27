/**
 * The tab's title: the page's ("Settings · Scoreline"), led by a live score
 * when the tab carries one (the pinned game, or a followed team's live
 * game: app/LiveServices.tsx): "ARS 2–1 CHE · 67' · Settings". A page that
 * is that game already says it, so its own title stands.
 * Restores the app's own title when the page goes away.
 */
import { useEffect } from "react";

export const APP_TITLE = "Scoreline";

/** The live score the tab leads with: the full text, and the score line pages start their titles with. */
export interface TitleScore {
  readonly text: string;
  readonly line: string;
}

let page: string | null = null;
let score: TitleScore | null = null;

/** The title for a page and a live score (pure). */
export function composeTitle(pageTitle: string | null, live: TitleScore | null): string {
  if (live && !(pageTitle?.startsWith(live.line) ?? false)) return `${live.text} · ${pageTitle ?? APP_TITLE}`;
  return pageTitle ? `${pageTitle} · ${APP_TITLE}` : APP_TITLE;
}

function apply() {
  if (typeof document === "undefined") return;
  const next = composeTitle(page, score);
  if (document.title !== next) document.title = next;
}

/** The live score for the tab, or null (LiveServices). */
export function setTitleScore(next: TitleScore | null): void {
  if (next?.text === score?.text && next?.line === score?.line) return;
  score = next;
  apply();
}

export function useDocumentTitle(title: string | null): void {
  useEffect(() => {
    page = title;
    apply();
    return () => {
      page = null;
      apply();
    };
  }, [title]);
}
