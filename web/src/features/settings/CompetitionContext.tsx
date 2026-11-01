import { Link } from "react-router";
import type { ScoreEvent } from "../../data/models";
import { leagueForGame, leagueWithID } from "../../data/leagues";
import { inclusionReasons } from "../../data/following";
import { useSettings } from "../../state/settings";
import styles from "./Settings.module.css";
export function CompetitionContext({event}: {event: ScoreEvent}) {
  const prefs = useSettings(s => s);
  const ref = event.ref;
  const league = ref?.kind === "espn" ? leagueForGame(ref.path) : null;
  const href = ref?.kind === "espn" ? (league ? (leagueWithID(league.id) ? `/sports/competition/${league.id}` : `/competition/${league.id}`) : null)
    : ref?.kind === "counterStrike" && ref.tournament ? `/bracket/cs2/${encodeURIComponent(ref.tournament)}?name=${encodeURIComponent(event.caption ?? "Tournament")}`
    : ref?.kind === "climbing" ? "/schedule/climbing" : null;
  const name = league?.name ?? (ref?.kind === "climbing" ? ref.eventName : event.caption);
  const reasons = inclusionReasons(event,prefs);
  if (!href && !reasons.length) return null;
  return <div className={styles.competitionContext}>{href ? <Link to={href}>{name ?? "Competition"}</Link> : null}{reasons.length ? <span>{reasons.join(" · ")}</span> : null}</div>;
}
