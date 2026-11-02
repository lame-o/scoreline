import { Link } from "react-router";
import type { ScoreEvent } from "../../data/models";
import { competitionLine, competitionPath, type MatchCompetition } from "../../data/soccerCompetition";
import styles from "./Settings.module.css";

/** Where a match was played, and the way to it: the competition's name from its summary, never a provider's slug. */
export function CompetitionContext({ event, competition }: { event: ScoreEvent; competition: MatchCompetition | null }) {
  const ref = event.ref;
  const ring = event.content.kind === "match" ? [event.content.top.id, event.content.bottom.id].map((id) => id?.split("-").pop() ?? null) : [];
  const href = competition ? competitionPath(competition.slug, competition.year, ring)
    : ref?.kind === "counterStrike" && ref.tournament ? `/bracket/cs2/${encodeURIComponent(ref.tournament)}?name=${encodeURIComponent(event.caption ?? "Tournament")}`
    : ref?.kind === "climbing" ? "/schedule/climbing" : null;
  const name = competition ? competitionLine(competition) : ref?.kind === "climbing" ? ref.eventName : event.caption;
  if (!href || !name) return null;
  return <div className={styles.competitionContext}><Link to={href}>{name}</Link>{competition?.note ? <span>{competition.note}</span> : null}</div>;
}
