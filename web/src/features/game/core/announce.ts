/**
 * Polite announcements for screen readers (SharedUI.swift `Announcer`): game
 * pages only, never the list. One shared live region, appended to the body
 * once; each message replaces the last.
 */
let region: HTMLElement | null = null;

export function announce(message: string): void {
  if (typeof document === "undefined" || !message) return;
  if (!region) {
    region = document.createElement("div");
    region.setAttribute("aria-live", "polite");
    region.setAttribute("aria-atomic", "true");
    region.className = "visually-hidden";
    document.body.append(region);
  }
  // Cleared first, so the same words twice are still read.
  region.textContent = "";
  const el = region;
  requestAnimationFrame(() => (el.textContent = message));
}
