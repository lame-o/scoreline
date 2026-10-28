/**
 * The play theater, for the scoring slide (ScoringSlide.swift
 * `SlideTheater.baseball`): the news play it holds and its replay's climax
 * (the ball clearing the fence, else the first runner home), read from the
 * script the stage replays; and Statcast's measurement of a home run once
 * it's in, from the queries the theater's own Statcast line keeps
 * (useStatcast.ts), so the slide asks MLB for nothing.
 */
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { ScoreEvent } from "../../../../data/models";
import type { PlayScene, TheaterState } from "../../../../data/mlb/playScene";
import { PlayScript } from "../../../../data/mlb/playScript";
import { matchScene, type StatcastAtBat, type StatcastBatted } from "../../../../data/mlb/statcast";
import { playClimax } from "../../../../data/scoringSlide";
import { useSlideTheater } from "../../core/scoringSlides";

/** Statcast's batted ball for a play, if the theater's queries have it (their keys are useStatcast.ts's). */
function batted(client: QueryClient, event: ScoreEvent, scene: PlayScene, names: Readonly<Record<string, string>>): StatcastBatted | null {
  const game = client.getQueryData<number | null>(["statcast", "game", event.id]);
  const atBats = game != null ? client.getQueryData<StatcastAtBat[]>(["statcast", "feed", game]) : undefined;
  return atBats ? (matchScene(scene, atBats, names)?.batted ?? null) : null;
}

/** `play` and `script`: what the stage shows and replays (PlayTheater). */
export function useSlidePlate(state: TheaterState, play: PlayScene | null, script: PlayScript, event: ScoreEvent, names: Readonly<Record<string, string>> = {}): void {
  const client = useQueryClient();
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
    (id) => (state.play?.id === id ? batted(client, event, state.play, names) : null),
  );
}
