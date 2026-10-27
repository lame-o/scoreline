/**
 * GlassCard: the floating material (Glass.swift). Use it for the layer that
 * floats over content (the match hero, header controls, chips, the sidebar),
 * never for content itself, and never glass on glass.
 *
 *     <GlassCard variant="clear">…hero…</GlassCard>   // over a team-color wash
 *
 * - `card`: regular glass at the hero radius (18pt).
 * - `clear`: lets a wash behind it refract through (the hero card).
 * - `strong`: more opaque, for glass over busy content.
 * - `capsule`: a pill (chips, the Back button, segmented controls).
 * Reduce Transparency makes it solid; Increase Contrast gives it a visible edge.
 */
import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import styles from "./GlassCard.module.css";

type Variant = "card" | "clear" | "strong" | "capsule";

type Props<E extends ElementType> = {
  readonly as?: E;
  readonly variant?: Variant;
  readonly className?: string;
  readonly children?: ReactNode;
} & Omit<ComponentPropsWithoutRef<E>, "as" | "className" | "children">;

export function GlassCard<E extends ElementType = "div">({ as, variant = "card", className, children, ...rest }: Props<E>) {
  const Element: ElementType = as ?? "div";
  const classes = [styles.glass, variant !== "card" ? styles[variant] : null, className].filter(Boolean).join(" ");
  return (
    <Element className={classes} {...rest}>
      {children}
    </Element>
  );
}
