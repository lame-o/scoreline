/**
 * SegmentedControl: one choice of a few, macOS style: a capsule track with a
 * thumb that glides to the selection (List | Tiles, All Games | Only My
 * Teams). A radio group for assistive tech; ←/→ move the choice, instantly
 * (keyboard actions never animate).
 *
 *     <SegmentedControl label="View" value={view} onChange={setView}
 *       options={[{ value: "list", label: "List", icon: "list" }, …]} iconsOnly />
 */
import { useRef, useState, type KeyboardEvent } from "react";
import { Icon, type IconName } from "../icons";
import styles from "./SegmentedControl.module.css";

export interface SegmentOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly icon?: IconName;
}

export interface SegmentedControlProps<T extends string> {
  /** The group's accessible name ("View"). */
  readonly label: string;
  readonly value: T;
  readonly options: readonly SegmentOption<T>[];
  /** `viaKeyboard`: chosen with the arrow keys (whatever it changes shouldn't animate). */
  readonly onChange: (value: T, viaKeyboard: boolean) => void;
  /** Show only the icons (the label is still spoken and shown as a tooltip). */
  readonly iconsOnly?: boolean;
  readonly className?: string;
}

export function SegmentedControl<T extends string>({ label, value, options, onChange, iconsOnly = false, className }: SegmentedControlProps<T>) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const [instant, setInstant] = useState(false);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const choose = (i: number, viaKeyboard: boolean) => {
    const option = options[i];
    if (!option) return;
    setInstant(viaKeyboard);
    onChange(option.value, viaKeyboard);
    if (viaKeyboard) buttons.current[i]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    event.stopPropagation();
    choose((index + step + options.length) % options.length, true);
  };

  return (
    <div
      className={[styles.track, iconsOnly ? styles.compact : null, className].filter(Boolean).join(" ")}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      <span
        className={styles.thumb}
        data-instant={instant}
        aria-hidden="true"
        style={{ width: `calc((100% - 4 * var(--pt)) / ${options.length})`, transform: `translateX(${index * 100}%)` }}
      />
      {options.map((option, i) => (
        <button
          key={option.value}
          ref={(el) => {
            buttons.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={i === index}
          aria-label={iconsOnly ? option.label : undefined}
          title={iconsOnly ? option.label : undefined}
          tabIndex={i === index ? 0 : -1}
          className={styles.option}
          onClick={() => choose(i, false)}
        >
          {option.icon ? <Icon name={option.icon} size={11} /> : null}
          {iconsOnly ? null : option.label}
        </button>
      ))}
    </div>
  );
}
