/** Placeholder until the page is ported. */
import { BackButton, EmptyState, PageHeader } from "../../design/components";
import { useSplit } from "../../app/layout";
import { useGoBack } from "../../app/navigation";

export function RankingsPage() {
  const split = useSplit();
  const goBack = useGoBack();
  return (
    <div>
      <PageHeader title="Top 25" leading={split ? null : <BackButton to="Back" onClick={() => goBack()} />} />
      <EmptyState icon="list" title="Top 25" message="Coming soon." />
    </div>
  );
}
