/**
 * The play theater, for the scoring slide (ScoringSlide.swift
 * `SlideTheater.baseball`): the news play it holds (published once MLB's
 * account has measured it, or after the hold: useStatcast.ts
 * `useMeasuredTheater`) and its replay's climax (the ball clearing the
 * fence, else the first runner home), read from the script the stage
 * replays; and Statcast's measurement of the ball, for the slide's distance
 * and exit velocity.
 */
import type { PlayScene, TheaterState } from "../../../../data/mlb/playScene";
import { PlayScript } from "../../../../data/mlb/playScript";
import { playClimax } from "../../../../data/scoringSlide";
import { useSlideTheater } from "../../core/scoringSlides";

/** `state`: the theater's (measured) state; `play` and `script`: what the stage shows and replays (PlayTheater). */
export function useSlidePlate(state: TheaterState, play: PlayScene | null, script: PlayScript): void {
  const news = state.news ? state.play : null;
  useSlideTheater(
    "plate",
    news?.id ?? null,
    () => {
      if (!news) return null;
      if (play?.id === news.id) return playClimax(script);
      // Not on the stage (yet): its own script, settling as the play left the bases.
      return playClimax(PlayScript.play(news, { bases: news.endsInning ? [false, false, false] : news.basesAfter, bats: state.bats, swapped: news.endsInning }));
    },
    (id) => (state.play?.id === id ? (state.play.measured?.batted ?? null) : null),
  );
}
