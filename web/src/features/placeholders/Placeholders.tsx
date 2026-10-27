/**
 * Clean placeholders for the pages later work builds: each has its header,
 * its place in navigation, and a sentence about what's coming. Replace one
 * by pointing its route (app/App.tsx) at the real page.
 */
import { useParams } from "react-router";
import { EmptyState, PageHeader, type IconName } from "../../design/components";
import { leagueWithID } from "../../data/leagues";
import { PageBack } from "../../app/PageBack";
import { useDocumentTitle } from "../../app/useDocumentTitle";

function Placeholder({ title, icon, heading, message }: { title: string; icon: IconName; heading: string; message: string }) {
  useDocumentTitle(title);
  return (
    <div>
      <PageHeader title={title} leading={<PageBack />} />
      <EmptyState icon={icon} title={heading} message={message} />
    </div>
  );
}

export function SchedulePlaceholder() {
  const { scope } = useParams();
  const league = scope ? leagueWithID(scope) : undefined;
  return (
    <Placeholder
      title={league ? `${league.name} Schedule` : "Schedule"}
      icon="calendar"
      heading="Schedules Are Coming"
      message="What's coming up and what just happened, for every league and team you follow, with week, day and month pickers."
    />
  );
}

export function StandingsPlaceholder() {
  const { league: id } = useParams();
  const league = id ? leagueWithID(id) : undefined;
  return <Placeholder title={league ? `${league.name} Standings` : "Standings"} icon="list" heading="Standings Are Coming" message="League tables that move with live scores, conference standings, polls and playoff brackets." />;
}

export function TeamPlaceholder() {
  return <Placeholder title="Team" icon="star" heading="Team Pages Are Coming" message="Results, roster, leaders, stats and the table for every team." />;
}

export function PlayerPlaceholder() {
  return <Placeholder title="Player" icon="sportscourt" heading="Player Pages Are Coming" message="Season stats, game logs, career and awards for every player." />;
}
