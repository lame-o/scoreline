/**
 * The header's controls and the small push button.
 *
 * - `IconButton`: a 28pt glass circle with a glyph and a spoken label; the
 *   tooltip adds a shortcut when there is one (Components.swift `IconButton`).
 * - `BackButton`: "‹ Scores", the glass capsule that goes back; Esc does the
 *   same from anywhere (the app's keyboard layer), so the button names it.
 * - `Button`: a small push button for Settings and empty states.
 *
 *     <IconButton icon="refresh" label="Refresh" turns={turns} onClick={refresh} />
 *     <BackButton to="Scores" onClick={back} />
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "../icons";
import styles from "./Controls.module.css";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  readonly icon: IconName;
  /** What the button does, in Title Case ("Open in Browser"). */
  readonly label: string;
  /** Shown in the tooltip only ("Esc"). */
  readonly shortcut?: string;
  /** Each increment turns the glyph once (a click's feedback). */
  readonly turns?: number;
  /** A toggle that's on (accent ink). */
  readonly active?: boolean;
}

export function IconButton({ icon, label, shortcut, turns, active, className, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      className={[styles.iconButton, className].filter(Boolean).join(" ")}
      aria-label={label}
      aria-pressed={active}
      title={shortcut ? `${label} (${shortcut})` : label}
      {...rest}
    >
      <Icon name={icon} size={12} className={turns != null ? styles.turn : undefined} style={turns != null ? { transform: `rotate(${turns * 360}deg)` } : undefined} />
    </button>
  );
}

export function BackButton({ to, onClick }: { readonly to: string; readonly onClick: () => void }) {
  return (
    <button type="button" className={styles.back} onClick={onClick} title={`Back to ${to} (Esc)`} aria-label={`Back to ${to}`}>
      <Icon name="chevronLeft" size={11} />
      <span>{to}</span>
    </button>
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly tone?: "default" | "accent";
  readonly children: ReactNode;
}

export function Button({ tone = "default", className, children, ...rest }: ButtonProps) {
  return (
    <button type="button" className={[styles.button, tone === "accent" ? styles.accentButton : null, className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </button>
  );
}

export interface PageHeaderProps {
  readonly title?: string;
  readonly icon?: IconName;
  readonly leading?: ReactNode;
  readonly trailing?: ReactNode;
  /** Replaces the title with a control that is the page's heading (a title menu). */
  readonly center?: ReactNode;
  readonly className?: string;
}

/**
 * PageHeader: Back on the leading side, the page's title centered on the bar
 * (truncating rather than running into a button), buttons trailing. The
 * title is the page's top heading.
 *
 *     <PageHeader title="Settings" leading={<BackButton to="Scores" onClick={back} />} />
 */
export function PageHeader({ title, icon, leading, trailing, center, className }: PageHeaderProps) {
  return (
    <header className={[styles.header, className].filter(Boolean).join(" ")}>
      <div className={styles.leading}>{leading}</div>
      {center ? (
        <div className={styles.center}>{center}</div>
      ) : title ? (
        <h1 className={styles.title}>
          {icon ? <Icon name={icon} size={11} className={styles.titleIcon} /> : null}
          <span>{title}</span>
        </h1>
      ) : (
        <span />
      )}
      <div className={styles.trailing}>{trailing}</div>
    </header>
  );
}
