/**
 * Following a team from a star (ScoreStore.toggleFollow): everywhere it plays,
 * first on the scores list, with alerts; the very first follow asks the
 * browser to send them (a star's click is the gesture a permission prompt
 * needs), as the Mac asks on its first follow.
 */
import type { TeamOption } from "../../data/providers/teams";
import { requestNotificationPermission } from "../../state/notifications";
import { getSettings, settings } from "../../state/settings";

export function toggleTeam(option: Pick<TeamOption, "id" | "name" | "logo">): void {
  const first = getSettings().followed.length === 0;
  settings.toggleFollow({ id: option.id, name: option.name, logo: option.logo });
  if (first && getSettings().followed.length === 1 && getSettings().notifyFollowed) void requestNotificationPermission();
}
