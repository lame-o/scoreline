/** Placeholder until the page is ported. */
import { BackButton, EmptyState, PageHeader } from "../../design/components";
import { useSplit } from "../../app/layout";
import { useGoBack } from "../../app/navigation";

export function EventResultsPage() {
  const split = useSplit();
  const goBack = useGoBack();
  return (
    <div>
      <PageHeader title="Results" leading={split ? null : <BackButton to="Back" onClick={() => goBack()} />} />
      <EmptyState icon="trophy" title="Results" message="Coming soon." />
    </div>
  );
}
