/**
 * Chip: a small capsule that states something: the live count ("3 Live"), a
 * state on a chart ("RED ZONE", "MAP POINT"), a neutral tag. It arrives from
 * 92% on the quick curve (never from nothing) and carries its own entrance,
 * so callers just render it (Components.swift `Motion.chip`).
 *
 *     <Chip tone="live">3 Live</Chip>
 *     <Chip tone="state">Red Zone</Chip>
 */
import type { ReactNode } from "react";
import styles from "./Chip.module.css";

export interface ChipProps {
  readonly tone?: "neutral" | "live" | "accent" | "state";
  readonly children: ReactNode;
  readonly title?: string;
  readonly className?: string;
  /** Spoken instead of the visible text ("3 games in progress"). */
  readonly label?: string;
}

export function Chip({ tone = "neutral", children, title, className, label }: ChipProps) {
  return (
    <span className={[styles.chip, styles[tone], className].filter(Boolean).join(" ")} title={title} role={label ? "status" : undefined} aria-label={label}>
      {label ? <span aria-hidden="true">{children}</span> : children}
    </span>
  );
}
