/**
 * Placeholders and empty states (Components.swift `EmptyState`, SharedUI.swift
 * `ErrorState`, `ErrorCopy`).
 *
 * - `Skeleton`: a static block shaped like what's coming. Placeholders hold
 *   the layout, so real content lands without a jump; they never shimmer.
 * - `EmptyState`: a glyph, a title, a sentence and actions, centered.
 * - `ErrorState`: a load that failed, in the app's one wording, with Try Again.
 *   A page that keeps trying on its own (state/retry.ts) says so, and a quiet
 *   "Retrying…" shows while an attempt is out, held a moment so a fast
 *   failure doesn't blink it.
 * - `StaleNote`: data on screen whose refresh failed: "Can't connect ·
 *   Showing table from 10:42 AM" (the Mac's UpdatedLabel, offline).
 *
 *     <ErrorState subject="Scores" retriesAutomatically onRetry={refresh} />
 *     <ErrorState subject="Table" retriesAutomatically retrying={load.retrying} onRetry={refetch} />
 *     {load.stale ? <StaleNote updated={load.updated} subject="table" /> : null}
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { clockTime } from "../../data/format";
import { Icon, type IconName } from "../icons";
import { Button } from "./Controls";
import styles from "./States.module.css";

export interface SkeletonProps {
  /** Mac points (or any CSS length as a string). */
  readonly width?: number | string;
  readonly height?: number | string;
  readonly circle?: boolean;
  readonly radius?: number;
  readonly className?: string;
  readonly style?: CSSProperties;
}

const pt = (v: number | string | undefined) => (typeof v === "number" ? `calc(${v} * var(--pt))` : v);

export function Skeleton({ width, height = 9, circle, radius, className, style }: SkeletonProps) {
  return (
    <span
      className={[styles.skeleton, circle ? styles.circle : null, className].filter(Boolean).join(" ")}
      style={{ width: pt(width), height: pt(height), borderRadius: radius != null ? pt(radius) : undefined, ...style }}
      aria-hidden="true"
    />
  );
}

export interface EmptyStateProps {
  readonly icon: IconName;
  readonly title: string;
  readonly message: string;
  readonly actions?: ReactNode;
  /** A quiet line under the actions. */
  readonly note?: ReactNode;
  readonly className?: string;
  /** 1 when the state is the whole page (the split view's empty pane), so the page still has its h1. */
  readonly level?: 1 | 2;
}

export function EmptyState({ icon, title, message, actions, note, className, level = 2 }: EmptyStateProps) {
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <div className={[styles.empty, className].filter(Boolean).join(" ")}>
      <Icon name={icon} size={26} className={styles.emptyIcon} />
      <Heading className={styles.emptyTitle}>{title}</Heading>
      <p className={styles.emptyMessage}>{message}</p>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
      {note}
    </div>
  );
}

/** The words for a load that failed, the same on every page. */
export const ErrorCopy = {
  title: (subject: string) => `Can't Load ${subject}`,
  message: "Check your internet connection and try again.",
  automatic: "Check your internet connection. Scoreline will try again automatically.",
  retry: "Try Again",
  /** A section inside a page that keeps working. */
  inline: (subject: string) => `Couldn't load ${subject}. Trying again shortly.`,
  /** While a page's automatic attempt is out. */
  retrying: "Retrying…",
  /** Data on screen whose refresh failed (the Mac's offline UpdatedLabel). */
  stale: (subject: string, updated: number) => `Can't connect · Showing ${subject} from ${clockTime(updated)}`,
} as const;

export interface ErrorStateProps {
  readonly subject: string;
  /** 1 when the error is the whole page (nothing else on it carries the h1). */
  readonly level?: 1 | 2;
  readonly retriesAutomatically?: boolean;
  /** An attempt is out (with `retriesAutomatically`): the quiet "Retrying…" under Try Again. */
  readonly retrying?: boolean;
  readonly onRetry: () => void;
  readonly icon?: IconName;
}

/** How long "Retrying…" stays once shown: an attempt that fails in 80 ms reads as a calm beat, not a blink. */
const RETRYING_HOLD = 1200;

export function ErrorState({ subject, retriesAutomatically = false, retrying = false, onRetry, icon = "wifiSlash", level }: ErrorStateProps) {
  const showing = useHeld(retriesAutomatically && retrying, RETRYING_HOLD);
  return (
    <div role="alert">
      <EmptyState
        level={level}
        icon={icon}
        title={ErrorCopy.title(subject)}
        message={retriesAutomatically ? ErrorCopy.automatic : ErrorCopy.message}
        actions={<Button onClick={onRetry}>{ErrorCopy.retry}</Button>}
        note={
          retriesAutomatically ? (
            // The message already says it retries; the note is for the eye, not announced every attempt.
            <span className={styles.retrying} data-showing={showing} aria-hidden="true">
              {ErrorCopy.retrying}
            </span>
          ) : null
        }
      />
    </div>
  );
}

/** True from when `value` turns true until it has been false and `hold` ms have passed since it turned true. */
function useHeld(value: boolean, hold: number): boolean {
  const [since, setSince] = useState<number | null>(null);
  useEffect(() => {
    if (value) {
      setSince((s) => s ?? Date.now());
      return;
    }
    if (since == null) return;
    const left = since + hold - Date.now();
    if (left <= 0) {
      setSince(null);
      return;
    }
    const timer = setTimeout(() => setSince(null), left);
    return () => clearTimeout(timer);
  }, [value, since, hold]);
  return value || since != null;
}

/** "Can't connect · Showing table from 10:42 AM": data on screen whose refresh failed. */
export function StaleNote({ updated, subject, className }: { readonly updated: number | null; readonly subject: string; readonly className?: string }) {
  if (updated == null) return null;
  return (
    <p className={[styles.stale, className].filter(Boolean).join(" ")}>
      <Icon name="wifiSlash" size={10} />
      <span>{ErrorCopy.stale(subject, updated)}</span>
    </p>
  );
}
