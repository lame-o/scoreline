/** Placeholder until the page is ported. */
import { EmptyState } from "../../design/components";
import { ScheduleHeader } from "../schedule/ScheduleHeader";
import type { SchedulePageProps } from "../schedule/SchedulePage";

export function TournamentsPage({ scope, mode, onMode }: SchedulePageProps) {
  return (
    <div>
      <ScheduleHeader scope={scope} mode={mode} onMode={onMode} />
      <EmptyState icon="calendar" title="Tournaments" message="Coming soon." />
    </div>
  );
}
