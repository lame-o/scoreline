/**
 * LiveDot: the gentle "breathing" red dot of a game in progress
 * (SharedUI.swift `LiveDot`). A compositor-only CSS animation, so it costs no
 * JavaScript per frame; every dot on the page breathes in phase. It holds
 * still while the data is stale (`animated={false}`: refreshes failing, so a
 * pulse never vouches for old data) and under Reduce Motion.
 */
import { useState } from "react";
import { PULSE_PERIOD_MS } from "../motion";
import styles from "./LiveDot.module.css";

export function LiveDot({ animated = true, className }: { readonly animated?: boolean; readonly className?: string }) {
  // Start partway through the shared cycle so this dot joins the others in phase.
  const [delay] = useState(() => -(performance.now() % PULSE_PERIOD_MS));
  return (
    <span
      className={[styles.dot, animated ? null : styles.still, className].filter(Boolean).join(" ")}
      style={animated ? { animationDelay: `${delay}ms` } : undefined}
      aria-hidden="true"
    />
  );
}
