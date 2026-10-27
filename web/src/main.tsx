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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
