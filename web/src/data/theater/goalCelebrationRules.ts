/**
 * Who celebrates a soccer moment (SoccerTheater.swift `GoalCelebration.theaterOwns`,
 * `.pitchBursts`), on their own so the Live Pitch can ask without loading
 * the theater: the theater owns the moments it replays when the page shows
 * it, and the pitch bursts for the rest. `GoalCelebration` in
 * soccerTheater.ts carries these too. (pure; tested)
 */
import type { LiveMoment } from "../moments";

/** The moments the theater replays (and so celebrates): goals, saves, blocks, the woodwork, big chances. Cards stay the Live Pitch's. */
export function theaterOwns(m: LiveMoment): boolean {
  if (m.chart !== "pitch") return false;
  switch (m.kind) {
    case "goal":
    case "shotSaved":
    case "shotBlocked":
      return true;
    case "shotWide":
      return m.accents.has("woodwork") || m.accents.has("bigChance");
    default:
      return false;
  }
}

/** The Live Pitch bursts over a moment only when there's no theater to. */
export function pitchBursts(m: LiveMoment | null, theaterShown: boolean): boolean {
  if (!m) return false;
  return !theaterShown || !theaterOwns(m);
}
