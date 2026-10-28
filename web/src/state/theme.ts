/**
 * Appearance: the resolved color scheme (Settings → Appearance, or the
 * system's), applied to <html> so CSS `light-dark()` follows, and read in
 * JS where colors are computed (team colors fitted to the scheme). "Shapes
 * as well as color" sets `data-shapes` on <html> for the cues CSS draws;
 * canvases read `useShapes()`.
 */
import { useEffect, useSyncExternalStore } from "react";
import type { Scheme } from "../data/teamColors";
import { useSettings } from "./settings";

const darkQuery = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

function subscribeSystem(listener: () => void) {
  darkQuery?.addEventListener("change", listener);
  return () => darkQuery?.removeEventListener("change", listener);
}

function useSystemScheme(): Scheme {
  return useSyncExternalStore(
    subscribeSystem,
    () => (darkQuery?.matches ? "dark" : "light"),
    () => "light",
  );
}

/** The scheme in effect: the user's choice, else the system's. */
export function useColorScheme(): Scheme {
  const theme = useSettings((s) => s.theme);
  const system = useSystemScheme();
  return theme === "system" ? system : theme;
}

/** Applies the theme to the document (mounted once, at the root). */
export function useApplyTheme(): void {
  const theme = useSettings((s) => s.theme);
  const scheme = useColorScheme();
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") delete root.dataset.theme;
    else root.dataset.theme = theme;
    // The browser's own chrome (mobile toolbars) matches the page.
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      if (theme === "system") {
        meta.content = meta.media.includes("dark") ? "#121214" : "#f2f2f5";
      } else {
        meta.content = scheme === "dark" ? "#121214" : "#f2f2f5";
      }
    }
  }, [theme, scheme]);
}

/** Settings → Appearance → Shapes as well as color (the Mac's Differentiate Without Color). */
export function useShapes(): boolean {
  return useSettings((s) => s.differentiateWithoutColor);
}

/** Applies "Shapes as well as color" to the document, for the cues CSS draws (mounted once, at the root). */
export function useApplyShapes(): void {
  const shapes = useShapes();
  useEffect(() => {
    const root = document.documentElement;
    if (shapes) root.dataset.shapes = "true";
    else delete root.dataset.shapes;
  }, [shapes]);
}
