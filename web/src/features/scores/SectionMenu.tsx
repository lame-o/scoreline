/**
 * A section's menu (ScoresView.swift, the section's context menu): its
 * schedule and results, its table, standings or Top 25, and its team picks.
 * Beside the chevron on hover, and by right-click on the header.
 */
import { useNavigate } from "react-router";
import { Icon, Menu, type MenuEntry } from "../../design/components";
import { leagueWithID } from "../../data/leagues";
import { MY_TEAMS } from "../../data/scoreboard";
import { schedulePath, scopeFor } from "../../data/schedule";
import { tableLinks } from "../../data/tableLinks";
import styles from "./ScoresList.module.css";

export function SectionMenu({ id, title }: { id: string; title: string }) {
  const navigate = useNavigate();
  const go = (path: string) => () => navigate(path, { state: { from: "Scores" } });
  const league = leagueWithID(id);
  let entries: MenuEntry[];
  if (id === MY_TEAMS) {
    entries = [
      { kind: "item", label: "Schedule", icon: "calendar", onSelect: go(schedulePath({ kind: "yourTeams" })) },
      { kind: "item", label: "Results", icon: "flag", onSelect: go(schedulePath({ kind: "yourTeams" }, "results")) },
    ];
  } else if (league) {
    const scope = scopeFor(league);
    const seasonal = scope.kind === "climbing" || scope.kind === "tournaments";
    entries = [
      { kind: "item", label: seasonal ? (scope.kind === "climbing" ? "Climbing Season" : "Tournaments") : "Schedule", icon: "calendar", onSelect: go(schedulePath(scope)) },
      { kind: "item", label: "Results", icon: "flag", onSelect: go(schedulePath(scope, "results")) },
      ...tableLinks(league).map((l): MenuEntry => ({ kind: "item", label: l.label, icon: l.icon, onSelect: go(l.path) })),
      { kind: "separator" },
      { kind: "item", label: league.source.kind === "ifsc" ? "Choose Countries…" : "Choose Teams…", onSelect: go(`/settings/league/${encodeURIComponent(league.id)}`) },
    ];
  } else {
    return null;
  }
  return <Menu label={`${title} Options`} align="end" triggerClassName={styles.sectionMenuButton} trigger={<Icon name="ellipsis" size={11} />} entries={entries} />;
}
