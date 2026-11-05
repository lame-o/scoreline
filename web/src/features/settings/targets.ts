/**
 * Where Sports' and Following's rows go (RootView.swift `openCompetition`,
 * `openEdition`): light, so either page links without loading the other.
 */
import type { EditionFollow } from "../../data/following";
import { competitionHref } from "../../data/leagues";
import type { League, Sport } from "../../data/models";
import { competitionPath } from "../../data/soccerCompetition";

/** A competition chosen in Sports: a soccer competition's season, any other's page. */
export const competitionTarget = (league: League) => (league.sport === "soccer" ? competitionPath(league.id) : competitionHref(league.id));

/** A followed tournament or event: its bracket, or the climbing season it's in. */
export const editionTarget = (edition: EditionFollow) => (edition.source === "cs2" ? `/bracket/cs2/${encodeURIComponent(edition.key)}?name=${encodeURIComponent(edition.name)}` : "/schedule/climbing");

/** One sport's page: its leagues, cups, tournaments and teams. */
export const sportHref = (sport: Sport) => `/sports/${sport}`;
