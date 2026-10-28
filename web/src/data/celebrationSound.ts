/**
 * Opt-in sounds for the open game page (Celebrations.swift
 * `CelebrationSound`): off by default (Settings → Live Games → Sounds), never
 * with Celebrations off, at most one every 8 s, and only for what the page
 * you're watching celebrates: a soft pop for a score, glass for a decisive
 * one, nothing below score tier. It plays from the same call as the visual
 * (MomentCenter.show), so sound and picture start together.
 *
 * The Mac plays the system's Pop and Glass; the web synthesizes both
 * (features/game/core/sound.ts), so nothing is downloaded.
 *
 *     const choice = celebrationSound(moment)       // { name: "glass", volume: 0.3 }
 *     if (choice && gate.allow(Date.now())) play(choice)
 */
import { decisive, Tier, type LiveMoment } from "./moments";

export type SoundName = "pop" | "glass";

export interface SoundChoice {
  readonly name: SoundName;
  /** The Mac's NSSound volume (0…1). */
  readonly volume: number;
}

/** What would play for a moment: glass for a decisive score, a pop for a score, nothing below score tier. */
export function celebrationSound(m: LiveMoment): SoundChoice | null {
  if (m.tier !== Tier.score) return null;
  return decisive(m) ? { name: "glass", volume: 0.3 } : { name: "pop", volume: 0.25 };
}

/** Sounds play only when asked for, and never with Celebrations off. */
export function soundsEnabled(settings: { readonly celebrationSounds: boolean; readonly celebrationLevel: string }): boolean {
  return settings.celebrationSounds && settings.celebrationLevel !== "off";
}

/** At most one sound every 8 s, across pages (the Mac's static `last`). */
export class SoundGate {
  static readonly COOLDOWN = 8000;
  private last: number | null = null;

  /** Whether a sound may play now; if so, it counts as played. */
  allow(now: number): boolean {
    if (this.last != null && now - this.last < SoundGate.COOLDOWN) return false;
    this.last = now;
    return true;
  }
}
