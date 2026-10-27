/**
 * Settings building blocks, System Settings style (Components.swift
 * `GroupBox`, `ToggleRow`, `GroupLabel`).
 *
 *     <FormSection title="General" icon="gear">
 *       <GroupBox>
 *         <ToggleRow title="Show finished games" subtitle="Results from the last 18 hours"
 *           checked={showFinished} onChange={(v) => settings.set("showFinished", v)} />
 *       </GroupBox>
 *     </FormSection>
 */
import { useId, type ReactNode } from "react";
import type { IconName } from "../icons";
import { SectionTitle } from "./SectionTitle";
import styles from "./Form.module.css";

export function GroupBox({ children, className, label }: { readonly children: ReactNode; readonly className?: string; readonly label?: string }) {
  return (
    <div className={[styles.group, className].filter(Boolean).join(" ")} role="group" aria-label={label}>
      {children}
    </div>
  );
}

export function FormSection({ title, icon, children, caption }: { readonly title: string; readonly icon?: IconName; readonly children: ReactNode; readonly caption?: string }) {
  return (
    <section>
      <SectionTitle icon={icon} className={styles.groupTitle}>
        {title}
      </SectionTitle>
      {children}
      {caption ? <p className={styles.caption}>{caption}</p> : null}
    </section>
  );
}

export function Row({ children, className }: { readonly children: ReactNode; readonly className?: string }) {
  return <div className={[styles.row, className].filter(Boolean).join(" ")}>{children}</div>;
}

export interface ToggleProps {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly label?: string;
  readonly labelledBy?: string;
  readonly describedBy?: string;
  readonly disabled?: boolean;
}

/** A mini switch (`role="switch"`). Space and Return flip it. */
export function Toggle({ checked, onChange, label, labelledBy, describedBy, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      disabled={disabled}
      className={styles.switch}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.knob} />
    </button>
  );
}

export interface ToggleRowProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly disabled?: boolean;
}

export function ToggleRow({ title, subtitle, checked, onChange, disabled }: ToggleRowProps) {
  const id = useId();
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <span id={`${id}-t`} className={styles.rowTitle}>
          {title}
        </span>
        {subtitle ? (
          <span id={`${id}-s`} className={styles.rowSubtitle}>
            {subtitle}
          </span>
        ) : null}
      </div>
      <Toggle checked={checked} onChange={onChange} labelledBy={`${id}-t`} describedBy={subtitle ? `${id}-s` : undefined} disabled={disabled} />
    </div>
  );
}

export const formStyles = styles;
