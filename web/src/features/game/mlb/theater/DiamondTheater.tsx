/**
 * The baseball theater's place in At the Plate (PlayTheater.swift's host):
 * while the page broadcasts the game, the one on the choreography engine
 * (`source.active`: PlayDirectedStage, BaseballDirected), its facts the
 * page's (DetailView.swift: the teams' ESPN IDs, the box score's names);
 * otherwise today's, which tells the lane's plays as they come. Each loads
 * as its own chunk. `directed` overrides the page's (null: today's).
 *
 *     <DiamondTheater state={theater} bases={bases} batting={batting} palette={palette} kits={kits} event={event} … />
 */
import { lazy, useMemo } from "react";
import { espnTeamIDs } from "../../../../data/gameDetail";
import type { TheaterPerson } from "../../../../data/theater/theaterPeople";
import { usePageDirected, type Directed } from "../../core/theater/pageDirected";
import type { PlayTheaterProps } from "./PlayTheater";

const PlayTheater = lazy(() => import("./PlayTheater").then((m) => ({ default: m.PlayTheater })));
const BaseballDirected = lazy(() => import("./BaseballDirected").then((m) => ({ default: m.BaseballDirectedLive })));

const NO_PEOPLE: Readonly<Record<string, TheaterPerson>> = {};

export function DiamondTheater({ directed: given, ...props }: PlayTheaterProps & { readonly directed?: Directed | null }) {
  const page = usePageDirected();
  const directed = given === undefined ? page : given;
  const people = props.people ?? NO_PEOPLE;
  // The box score's names (DiamondFacts.names: `d.people.mapValues(\.name)`).
  const names = useMemo(() => Object.fromEntries(Object.entries(people).map(([id, p]) => [id, p.name])), [people]);
  if (!directed) return <PlayTheater {...props} />;
  const [topID, bottomID] = espnTeamIDs(props.event);
  return (
    <BaseballDirected
      source={directed.source}
      cues={directed.cues}
      kits={props.kits}
      topID={topID}
      bottomID={bottomID}
      topTeam={props.topTeam}
      bottomTeam={props.bottomTeam}
      names={names}
      eventId={props.event.id}
      people={people}
      fielders={props.fielders}
      heard={props.heard ?? null}
      holding={directed.holding ?? null}
      event={props.event}
      lane={props.state}
    />
  );
}
