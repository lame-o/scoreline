/**
 * The game menu's items and the menu itself (GameMenu.tsx hosts it). Its
 * own chunk, loaded when the browser is idle or a menu first opens, so the
 * first paint doesn't carry it (or the team pages' link helpers).
 */
import { useNavigate } from "react-router";
import { ContextMenu, type ContextMenuPoint, type MenuEntry } from "../../design/components";
import { scoreLine, statusLine } from "../../data/format";
import { competitors, type ScoreEvent } from "../../data/models";
import { isSupportedTeam } from "../../data/profiles/models";
import type { ProfileNavState } from "../../data/profiles/routes";
import { schedulePath } from "../../data/schedule";
import { pin, useIsPinned } from "../../state/pin";
import { settings, useSettings } from "../../state/settings";
import { teamHref, teamRefFrom } from "../profiles/ProfileLinks";

/** The game's league from its source ("soccer/eng.1" → "eng.1"): a club's page needs it, and the WNBA has none. */
function leagueOfRef(event: ScoreEvent): string | null {
  if (event.ref?.kind === "counterStrike") return "cs2";
  return event.ref?.kind === "espn" ? (event.ref.path.split("/")[1] ?? null) : null;
}

/** The menu's items for a game (Mac order and words). */
export function useGameMenuEntries(event: ScoreEvent): MenuEntry[] {
  const navigate = useNavigate();
  const pinned = useIsPinned(event.id);
  const followed = useSettings((s) => s.followed);
  const go = (path: string) => () => navigate(path, { state: { from: "Scores" } });
  const entries: MenuEntry[] = [];
  const link = event.link;
  if (link) {
    entries.push({ kind: "item", label: "Open in Browser", icon: "compass", onSelect: () => void window.open(link, "_blank", "noopener,noreferrer") });
    entries.push({ kind: "separator" });
  }
  entries.push({ kind: "item", label: pinned ? "Remove from Tab" : "Show in Tab", icon: pinned ? "pinSlash" : "pin", shortcut: "P", onSelect: () => pin.toggle(event.id) });
  const teams = competitors(event).filter((c) => c.id != null);
  if (teams.length > 0) {
    entries.push({ kind: "separator" });
    for (const team of teams) {
      const following = followed.some((t) => t.id === team.id);
      entries.push({
        kind: "item",
        label: following ? `Unfollow ${team.name}` : `Follow ${team.name}`,
        icon: following ? "starSlash" : "starOutline",
        onSelect: () => settings.toggleFollow({ id: team.id!, name: team.name, logo: team.logo }),
      });
    }
    entries.push({ kind: "separator" });
    // "Go to Arsenal": the team's page, for the sports that have them (Music's wording).
    for (const team of teams) {
      const ref = teamRefFrom(team, leagueOfRef(event));
      if (isSupportedTeam(ref)) {
        entries.push({ kind: "item", label: `Go to ${team.name}`, icon: "shield", onSelect: () => navigate(teamHref(ref), { state: { team: ref, from: "Scores" } satisfies ProfileNavState }) });
      }
    }
    for (const team of teams) {
      entries.push({ kind: "item", label: `${team.name} Schedule`, icon: "calendar", onSelect: go(schedulePath({ kind: "team", team: { id: team.id!, name: team.name, logo: team.logo } })) });
    }
  }
  entries.push({ kind: "separator" });
  entries.push({ kind: "item", label: "Copy Score", icon: "copy", onSelect: () => void navigator.clipboard?.writeText(statusLine(event, Date.now())).catch(() => {}) });
  return entries;
}

export default function GameMenu({ event, at, onClose, returnFocus }: { event: ScoreEvent; at: ContextMenuPoint; onClose: () => void; returnFocus: HTMLElement | null }) {
  const entries = useGameMenuEntries(event);
  return <ContextMenu label={`${scoreLine(event, false)} Options`} at={at} entries={entries} onClose={onClose} returnFocus={returnFocus} />;
}
