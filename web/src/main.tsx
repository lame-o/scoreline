/**
 * Entry: styles, then the app. Everything else starts in app/App.tsx.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./design/tokens.css";
import "./design/base.css";
import { App } from "./app/App";

// Development only: `/?demo` replays fixtures with live games (src/data/demo.ts).
if (import.meta.env.DEV) {
  const { installDemo } = await import("./data/demo");
  installDemo();
}

// The offline shell and notification clicks (public/sw.js). Production only:
// in development it would cache what Vite serves fresh.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js").catch(() => {}), { once: true });
}

// A page open across a deploy asks for chunks the new deploy doesn't have
// (404s, worker/index.ts): load the new version once rather than fail. The
// flag stops a loop if the chunk is missing for another reason.
window.addEventListener("vite:preloadError", (event) => {
  try {
    if (sessionStorage.getItem("scoreline:reloaded-for-chunks")) return;
    sessionStorage.setItem("scoreline:reloaded-for-chunks", "1");
  } catch {
    return;
  }
  event.preventDefault();
  location.reload();
});
window.addEventListener("load", () => setTimeout(() => {
  try {
    sessionStorage.removeItem("scoreline:reloaded-for-chunks");
  } catch {
    // Storage blocked: nothing was set.
  }
}, 10_000), { once: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
