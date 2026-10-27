/**
 * Tables, polls and brackets as the app holds them (ScoreStore.standings,
 * RankingsCache, BracketCache): one TanStack Query each, shared by every
 * page that reads it. Tables and polls change when games end, so ten
 * minutes of reuse is plenty fresh; live movement is projected on top from
 * the scoreboard. Brackets are reused for a minute, and while a matchup is
 * live they refresh every minute.
 *
 *     const table = useStandings(league);
 *     const polls = useRankings("football/college-football");
 *     const bracket = useBracket({ kind: "csTournament", slug, name });
 */
import { useQuery } from "@tanstack/react-query";
import { getJSON } from "../data/http";
import type { League } from "../data/models";
import { fetchStandings, tableKind } from "../data/standings";
import { fetchRankings } from "../data/college";
import { loadPostseason, loadTournament, type TournamentBrackets } from "../data/brackets";
import type { BracketSource } from "../data/schedule";

const TEN_MINUTES = 10 * 60_000;

export function useStandings(league: League | undefined) {
  return useQuery({
    queryKey: ["standings", league?.id ?? ""],
    queryFn: ({ signal }) => fetchStandings(league!, getJSON, signal),
    enabled: league != null && tableKind(league) !== "none",
    staleTime: TEN_MINUTES,
    refetchInterval: TEN_MINUTES,
    refetchIntervalInBackground: false,
  });
}

export function useRankings(path: string | null) {
  return useQuery({
    queryKey: ["rankings", path ?? ""],
    queryFn: ({ signal }) => fetchRankings(path!, getJSON, signal),
    enabled: path != null,
    staleTime: TEN_MINUTES,
  });
}

function hasLive(data: TournamentBrackets | undefined): boolean {
  if (!data) return false;
  const tree = data.bracket ? Object.values(data.bracket.matches).some((m) => m.live) || data.bracket.extra.some((e) => e.match.live) : false;
  return tree;
}

export function useBracket(source: BracketSource | null) {
  return useQuery({
    queryKey: ["bracket", source?.kind ?? "", source?.kind === "espnPostseason" ? `${source.path}:${source.year}` : (source?.slug ?? "")],
    queryFn: ({ signal }) =>
      source!.kind === "espnPostseason" ? loadPostseason(source!.path, source!.year, getJSON, Date.now(), signal) : loadTournament(source!.slug, getJSON, Date.now(), signal),
    enabled: source != null,
    staleTime: 60_000,
    refetchInterval: (query) => (hasLive(query.state.data) ? 60_000 : false),
    refetchIntervalInBackground: false,
  });
}
