/**
 * How long each bridged replay's clock started after its play came in (the
 * idle beat's last moment, the time added in front), by play
 * (TheaterBridge.swift `TheaterDelays`; theaterBridge.ts): the scoring slide
 * that lands with a replay's climax waits that much longer, so it still
 * lands with it. Kept apart from the bridge so the scoring slide, on every
 * game page, reads it without the theaters' rig.
 *
 *     TheaterDelays.note(play.id, plan.delay);
 *     TheaterDelays.delay(slide.id); // seconds
 */
const delays = new Map<string, { readonly delay: number; readonly noted: number }>();

export const TheaterDelays = {
  note(id: string, delay: number, now: number = Date.now()): void {
    // A minute is long enough for any slide to have landed.
    for (const [key, value] of delays) if (!(now - value.noted < 60_000)) delays.delete(key);
    if (delay > 0) delays.set(id, { delay, noted: now });
    else delays.delete(id);
  },

  delay(id: string): number {
    return delays.get(id)?.delay ?? 0;
  },
};
