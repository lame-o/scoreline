/**
 * The football theater, for the scoring slide (ScoringSlide.swift
 * `SlideTheater.football`): the news snap it holds and its replay's climax,
 * the ball crossing the goal line (or over the crossbar), read from the
 * script the stage replays.
 */
import type { FootballScene, FootballTheaterState } from "../../../../data/theater/footballScene";
import { FootballScript } from "../../../../data/theater/footballScript";
import { footballClimax } from "../../../../data/scoringSlide";
import { useSlideTheater } from "../../core/scoringSlides";

/** `play` and `script`: what the stage shows and replays (FootballTheater). */
export function useSlideField(state: FootballTheaterState, play: FootballScene | null, script: FootballScript): void {
  const news = state.news ? state.play : null;
  useSlideTheater("field", news?.id ?? null, () => (news ? footballClimax(play?.id === news.id ? script : FootballScript.play(news)) : null));
}
