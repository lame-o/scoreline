/**
 * The basketball theater, for the scoring slide (ScoringSlide.swift
 * `SlideTheater.basketball`): the basket the theater is replaying, as its
 * replay starts (it tells every play in order, so a basket can wait its turn
 * behind a beat or two), and its replay's climax, the ball dropping through
 * the net, read from the script the stage replays.
 */
import { basketballClimax } from "../../../../data/scoringSlide";
import type { BasketballScene } from "../../../../data/theater/basketballScene";
import type { BasketballScript } from "../../../../data/theater/basketballScript";
import { useSlideTheater } from "../../core/scoringSlides";

/** `replaying` and `script`: the marquee play the stage is replaying now, and its script (null: nothing in full). */
export function useSlideCourt(replaying: BasketballScene | null, script: BasketballScript | null): void {
  useSlideTheater("court", replaying?.id ?? null, () => (script ? basketballClimax(script) : null));
}
