/**
 * The basketball theater, for the scoring slide (ScoringSlide.swift
 * `SlideTheater.basketball`): the news basket it holds and its replay's
 * climax, the ball dropping through the net, read from the script the stage
 * replays.
 */
import { basketballClimax } from "../../../../data/scoringSlide";
import type { BasketballScene, BasketballTheaterState } from "../../../../data/theater/basketballScene";
import { BasketballScript } from "../../../../data/theater/basketballScript";
import { useSlideTheater } from "../../core/scoringSlides";

/** `play` and `script`: what the stage shows and replays (BasketballTheater). */
export function useSlideCourt(state: BasketballTheaterState, play: BasketballScene | null, script: BasketballScript): void {
  const news = state.news ? state.scene : null;
  useSlideTheater("court", news?.id ?? null, () => (news ? basketballClimax(play?.id === news.id ? script : BasketballScript.play(news)) : null));
}
