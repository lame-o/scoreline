/**
 * SectionTitle: a section's title row in small caps, secondary ink, as a
 * heading the screen reader's rotor finds (SharedUI.swift `SectionTitle`,
 * Components.swift `GroupLabel`). The caps are drawn by CSS, so it's read
 * as written ("Premier League", not letter by letter).
 *
 *     <SectionTitle icon="soccer">Premier League</SectionTitle>
 *     <SectionTitle accessory="live">Timeline</SectionTitle>
 *     <SectionTitle trailing={<SectionLink …/>}>Upcoming</SectionTitle>
 *
 * `accessory` is the section's state at the trailing edge (Live, Final, or
 * text) and is read with the title; `trailing` holds controls.
 */
import type { ReactNode } from "react";
import { Icon, type IconName } from "../icons";
import { LiveDot } from "./LiveDot";
import styles from "./SectionTitle.module.css";

export interface SectionTitleProps {
  readonly children: string;
  readonly icon?: IconName;
  readonly accessory?: "live" | "final" | { readonly text: string };
  readonly trailing?: ReactNode;
  /** Heading level for the document outline. */
  readonly level?: 2 | 3;
  readonly className?: string;
  readonly id?: string;
}

export function SectionTitle({ children, icon, accessory, trailing, level = 2, className, id }: SectionTitleProps) {
  const Heading = level === 2 ? "h2" : "h3";
  const spoken = accessory === "live" ? "Live" : accessory === "final" ? "Final" : accessory?.text;
  return (
    <div className={[styles.row, className].filter(Boolean).join(" ")}>
      <Heading className={styles.title} id={id}>
        {icon ? (
          <span className={styles.icon}>
            <Icon name={icon} size={10.5} />
          </span>
        ) : null}
        <span>{children}</span>
        {spoken ? <span className="visually-hidden">, {spoken}</span> : null}
      </Heading>
      <span className={styles.spacer} />
      {accessory ? (
        <span className={styles.accessory} aria-hidden="true">
          {accessory === "live" ? (
            <span className={styles.live}>
              <LiveDot />
              Live
            </span>
          ) : accessory === "final" ? (
            "Final"
          ) : (
            accessory.text
          )}
        </span>
      ) : null}
      {trailing}
    </div>
  );
}
