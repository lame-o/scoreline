/** Placeholder until the page is ported. */
import { EmptyState } from "../../design/components";
import { ScheduleHeader } from "./ScheduleHeader";
import type { SchedulePageProps } from "./SchedulePage";

export function ResultsAgendaPage({ scope, mode, onMode }: SchedulePageProps) {
  return (
    <div>
      <ScheduleHeader scope={scope} mode={mode} onMode={onMode} />
      <EmptyState icon="calendar" title="Results" message="Coming soon." />
    </div>
  );
}
