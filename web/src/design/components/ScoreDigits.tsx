/**
 * ScoreDigits: one side's score. Live, a change rolls the digits that
 * changed (up for a rise, down for a correction) and flashes a soft red pill
 * behind the number that fades in, holds 1.6s and decays over 1.2s on its own
 * (Tiles.swift `LiveDigits`, `DigitFlash`, `TileFlash`). Finals never
 * change, so they're plain text. Reduce Motion: a cross-fade, and the pill
 * fades quickly.
 *
 *     <ScoreDigits value={top.score} live={event.state === "live"} dimmed={stepsBack(event, top)} />
 */
import { useEffect, useRef, useState } from "react";
import { FLASH } from "../motion";
import styles from "./ScoreDigits.module.css";

export interface ScoreDigitsProps {
  readonly value: string | null;
  readonly live?: boolean;
  readonly dimmed?: boolean;
  /** Flash the pill on a change (tiles); rows flash the whole row instead. */
  readonly flash?: boolean;
  readonly className?: string;
}

interface Roll {
  readonly value: string | null;
  readonly previous: string | null;
  readonly direction: 1 | -1;
  readonly generation: number;
}

export function ScoreDigits({ value, live = false, dimmed = false, flash = true, className }: ScoreDigitsProps) {
  const [roll, setRoll] = useState<Roll>({ value, previous: null, direction: 1, generation: 0 });
  // A new value during render: start the roll in the same frame, never a frame late.
  if (roll.value !== value) {
    const rose = Number(value) >= Number(roll.value);
    setRoll({ value, previous: live && roll.value != null ? roll.value : null, direction: rose ? 1 : -1, generation: roll.generation + 1 });
  }

  const pill = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (roll.previous == null || !flash || !pill.current) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const decay = reduce ? 150 : FLASH.decayMs;
    const total = FLASH.inMs + FLASH.holdMs + decay;
    // Start from wherever an earlier flash is, so a quick second score never blinks.
    const from = Number(getComputedStyle(pill.current).opacity) || 0;
    pill.current.getAnimations().forEach((a) => a.cancel());
    pill.current.animate(
      [
        { opacity: from, offset: 0, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
        { opacity: 1, offset: FLASH.inMs / total },
        { opacity: 1, offset: (FLASH.inMs + FLASH.holdMs) / total, easing: "ease-out" },
        { opacity: 0, offset: 1 },
      ],
      { duration: total, fill: "forwards" },
    );
  }, [roll.generation, roll.previous, flash]);

  const text = value ?? "–";
  const classes = [styles.score, dimmed ? styles.dimmed : null, className].filter(Boolean).join(" ");
  if (!live && roll.previous == null) {
    return <span className={classes}>{text}</span>;
  }

  const previous = roll.previous ?? "";
  const width = Math.max(text.length, previous.length);
  const now = text.padStart(width, " ");
  const before = previous.padStart(width, " ");
  const up = roll.direction === 1;
  return (
    <span className={classes}>
      {flash ? <span ref={pill} className={styles.flash} aria-hidden="true" /> : null}
      <span className="visually-hidden">{text}</span>
      <span aria-hidden="true" style={{ display: "inline-flex" }}>
        {[...now].map((char, i) => {
          const changed = roll.previous != null && char !== before[i];
          if (!changed) return char === " " ? null : <span key={`s${i}`}>{char}</span>;
          return (
            <span key={`r${i}-${roll.generation}`} className={styles.slot}>
              <span className={up ? styles.inUp : styles.inDown}>{char === " " ? "" : char}</span>
              {before[i] && before[i] !== " " ? (
                <span
                  className={`${styles.out} ${up ? styles.outUp : styles.outDown}`}
                  onAnimationEnd={() => setRoll((r) => (r.generation === roll.generation ? { ...r, previous: null } : r))}
                >
                  {before[i]}
                </span>
              ) : null}
            </span>
          );
        })}
      </span>
    </span>
  );
}
