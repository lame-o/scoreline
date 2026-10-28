/**
 * The soccer theater, for the scoring slide (ScoringSlide.swift
 * `SlideTheater.soccer`): the news moment it holds and its replay's climax,
 * the ball hitting the net, read from the script the stage replays.
 */
import type { SoccerScene, SoccerTheaterState } from "../../../../data/theater/soccerScene";
import { SoccerScript } from "../../../../data/theater/soccerScript";
import { soccerClimax } from "../../../../data/scoringSlide";
import { useSlideTheater } from "../../core/scoringSlides";

/** `scene` and `script`: what the stage shows and replays (SoccerTheater). */
export function useSlidePitch(state: SoccerTheaterState, scene: SoccerScene | null, script: SoccerScript): void {
  const news = state.news ? state.scene : null;
  useSlideTheater("pitch", news?.id ?? null, () => (news ? soccerClimax(scene?.id === news.id ? script : SoccerScript.build(news)) : null));
}
