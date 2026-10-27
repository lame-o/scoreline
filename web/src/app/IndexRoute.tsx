/**
 * "/": on a phone, the scores themselves; beside the sidebar, the quiet
 * "no game selected" pane (Mail's "No Message Selected").
 */
import { EmptyState } from "../design/components";
import { ScoresPage } from "../features/scores/ScoresPage";
import { useSplit } from "./layout";
import styles from "./IndexRoute.module.css";

export function IndexRoute() {
  const split = useSplit();
  if (!split) return <ScoresPage variant="page" />;
  return (
    <div className={styles.none}>
      <EmptyState icon="sportscourt" title="No Game Selected" message="Pick a game from the list. Use ↑ and ↓ to move through the games and Return to open one." />
    </div>
  );
}
