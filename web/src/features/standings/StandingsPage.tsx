/** Placeholder until the page is ported. */
import { BackButton, EmptyState, PageHeader } from "../../design/components";
import { useSplit } from "../../app/layout";
import { useGoBack } from "../../app/navigation";

export function StandingsPage() {
  const split = useSplit();
  const goBack = useGoBack();
  return (
    <div>
      <PageHeader title="Standings" leading={split ? null : <BackButton to="Back" onClick={() => goBack()} />} />
      <EmptyState icon="list" title="Standings" message="Coming soon." />
    </div>
  );
}
