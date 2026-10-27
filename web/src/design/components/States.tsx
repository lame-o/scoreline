/**
 * Placeholders and empty states (Components.swift `EmptyState`, SharedUI.swift
 * `ErrorState`, `ErrorCopy`).
 *
 * - `Skeleton`: a static block shaped like what's coming. Placeholders hold
 *   the layout, so real content lands without a jump; they never shimmer.
 * - `EmptyState`: a glyph, a title, a sentence and actions, centered.
 * - `ErrorState`: a load that failed, in the app's one wording, with Try Again.
 *
 *     <ErrorState subject="Scores" retriesAutomatically onRetry={refresh} />
 */
import type { CSSProperties, ReactNode } from "react";
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
  readonly className?: string;
  /** 1 when the state is the whole page (the split view's empty pane), so the page still has its h1. */
  readonly level?: 1 | 2;
}

export function EmptyState({ icon, title, message, actions, className, level = 2 }: EmptyStateProps) {
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <div className={[styles.empty, className].filter(Boolean).join(" ")}>
      <Icon name={icon} size={26} className={styles.emptyIcon} />
      <Heading className={styles.emptyTitle}>{title}</Heading>
      <p className={styles.emptyMessage}>{message}</p>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
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
} as const;

export interface ErrorStateProps {
  readonly subject: string;
  /** 1 when the error is the whole page (nothing else on it carries the h1). */
  readonly level?: 1 | 2;
  readonly retriesAutomatically?: boolean;
  readonly onRetry: () => void;
  readonly icon?: IconName;
}

export function ErrorState({ subject, retriesAutomatically = false, onRetry, icon = "wifiSlash", level }: ErrorStateProps) {
  return (
    <div role="alert">
      <EmptyState
        level={level}
        icon={icon}
        title={ErrorCopy.title(subject)}
        message={retriesAutomatically ? ErrorCopy.automatic : ErrorCopy.message}
        actions={<Button onClick={onRetry}>{ErrorCopy.retry}</Button>}
      />
    </div>
  );
}
