/** Placeholder until the page is ported. */
import { EmptyState } from "../../design/components";
import { ScheduleHeader } from "./ScheduleHeader";
import type { SchedulePageProps } from "./SchedulePage";

export function AgendaPage({ scope, mode, onMode }: SchedulePageProps) {
  return (
    <div>
      <ScheduleHeader scope={scope} mode={mode} onMode={onMode} />
      <EmptyState icon="calendar" title="Schedule" message="Coming soon." />
    </div>
  );
}
