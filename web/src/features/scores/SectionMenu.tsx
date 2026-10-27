/**
 * A section's menu (ScoresView.swift, the section's context menu): Collapse
 * or Expand; its schedule and results, its table, standings or Top 25, and
 * its team picks; then Move Up, Move Down and Hide, which rearrange the
 * list (the sections glide to their places). Beside the chevron on hover
 * (always on touch), by right-click on the header, and by a long press.
 */
import { useNavigate } from "react-router";
import { Icon, Menu, type MenuEntry } from "../../design/components";
import { leagueWithID } from "../../data/leagues";
import { MY_TEAMS } from "../../data/scoreboard";
import { schedulePath, scopeFor } from "../../data/schedule";
import { tableLinks } from "../../data/tableLinks";
import { settings, useSettings } from "../../state/settings";
import styles from "./ScoresList.module.css";

export interface SectionMenuProps {
  readonly id: string;
  readonly title: string;
  /** Folds or unfolds the section (the header's own toggle). */
  readonly onToggle?: () => void;
  /** Runs a change of order with the sections gliding to their places. */
  readonly onRearrange?: (change: () => void) => void;
}

export function SectionMenu({ id, title, onToggle, onRearrange }: SectionMenuProps) {
  const navigate = useNavigate();
  const collapsed = useSettings((s) => s.collapsed.includes(id));
  const order = useSettings((s) => s.enabledLeagues);
  const go = (path: string) => () => navigate(path, { state: { from: "Scores" } });
  const rearrange = (change: () => void) => () => (onRearrange ? onRearrange(change) : change());
  const league = leagueWithID(id);
  const fold: MenuEntry[] = onToggle ? [{ kind: "item", label: collapsed ? "Expand" : "Collapse", icon: collapsed ? "chevronDown" : "chevronRight", onSelect: onToggle }] : [];
  let entries: MenuEntry[];
  if (id === MY_TEAMS) {
    entries = [
      ...fold,
      { kind: "item", label: "Schedule", icon: "calendar", onSelect: go(schedulePath({ kind: "yourTeams" })) },
      { kind: "item", label: "Results", icon: "flag", onSelect: go(schedulePath({ kind: "yourTeams" }, "results")) },
    ];
  } else if (league) {
    const scope = scopeFor(league);
    const seasonal = scope.kind === "climbing" || scope.kind === "tournaments";
    const at = order.indexOf(league.id);
    entries = [
      ...fold,
      { kind: "item", label: seasonal ? (scope.kind === "climbing" ? "Climbing Season" : "Tournaments") : "Schedule", icon: "calendar", onSelect: go(schedulePath(scope)) },
      { kind: "item", label: "Results", icon: "flag", onSelect: go(schedulePath(scope, "results")) },
      ...tableLinks(league).map((l): MenuEntry => ({ kind: "item", label: l.label, icon: l.icon, onSelect: go(l.path) })),
      { kind: "item", label: league.source.kind === "ifsc" ? "Choose Countries…" : "Choose Teams…", icon: "sliders", onSelect: go(`/settings/league/${encodeURIComponent(league.id)}`) },
      { kind: "separator" },
      { kind: "item", label: "Move Up", icon: "arrowUp", disabled: at <= 0, onSelect: rearrange(() => settings.move(league.id, -1)) },
      { kind: "item", label: "Move Down", icon: "arrowDown", disabled: at < 0 || at >= order.length - 1, onSelect: rearrange(() => settings.move(league.id, 1)) },
      { kind: "separator" },
      { kind: "item", label: `Hide ${league.name}`, icon: "eyeSlash", onSelect: rearrange(() => settings.setEnabled(league.id, false)) },
    ];
  } else {
    return null;
  }
  return <Menu label={`${title} Options`} align="end" triggerClassName={styles.sectionMenuButton} trigger={<Icon name="ellipsis" size={11} />} entries={entries} />;
}
