/**
 * Settings (ManageView.swift, AddSportsView.swift): followed teams, your
 * sports in your order (drag the handle, or focus it and use ↑/↓), every
 * league to add or remove, appearance, and the list's options. One centered
 * column, like System Settings. Later work adds notifications, celebrations
 * and the rest of the Mac's settings here (the store already holds them).
 */
import { Reorder, useDragControls } from "motion/react";
import { useEffect, useState, type KeyboardEvent } from "react";
import { Link } from "react-router";
import {
  BackButton,
  FormSection,
  GroupBox,
  Icon,
  PageHeader,
  SegmentedControl,
  SPORT_ICON,
  TeamLogo,
  Toggle,
  ToggleRow,
  formStyles,
} from "../../design/components";
import { spring } from "../../design/motion";
import { CATALOG, leagueWithID } from "../../data/leagues";
import { SPORTS, SPORT_NAME, type League } from "../../data/models";
import { useSplit } from "../../app/layout";
import { useGoBack } from "../../app/navigation";
import { useDocumentTitle } from "../../app/useDocumentTitle";
import { settings, useSettings, type CelebrationLevel, type Settings, type Theme } from "../../state/settings";
import { isSupportedTeam, teamRef } from "../../data/profiles/models";
import { LinkOrigin, linkNameClass, TeamLink } from "../profiles/ProfileLinks";
import styles from "./Settings.module.css";

const all = (s: Settings) => s;

export function SettingsPage() {
  const s = useSettings(all);
  const split = useSplit();
  const goBack = useGoBack();
  useDocumentTitle("Settings");
  return (
    <div className={styles.page}>
      <PageHeader title="Settings" leading={split ? null : <BackButton to="Scores" onClick={() => goBack()} />} />
      <div className={`${styles.column} ${styles.entrance}`}>
        <MyTeams />

        <FormSection title="Your Sports" icon="grip" caption={s.enabledLeagues.length > 1 ? "Drag to reorder, or focus a handle and use ↑ and ↓. Choose a league for its teams and options." : undefined}>
          <YourSports />
        </FormSection>

        <FormSection title="Appearance" icon="sun">
          <GroupBox>
            <div className={formStyles.row}>
              <span style={{ flex: 1 }}>Theme</span>
              <SegmentedControl<Theme>
                label="Theme"
                value={s.theme}
                onChange={(theme) => settings.set("theme", theme)}
                options={[
                  { value: "system", label: "System", icon: "display" },
                  { value: "light", label: "Light", icon: "sun" },
                  { value: "dark", label: "Dark", icon: "moon" },
                ]}
              />
            </div>
          </GroupBox>
        </FormSection>

        <FormSection title="Scores" icon="list">
          <GroupBox>
            <ToggleRow title="Show finished games" subtitle="Results from the last 18 hours" checked={s.showFinished} onChange={(v) => settings.set("showFinished", v)} />
            <ToggleRow title="Live leagues move to top" subtitle="In the list. Tiles always show live games first." checked={s.liveFirst} onChange={(v) => settings.set("liveFirst", v)} />
          </GroupBox>
        </FormSection>

        {/* Celebrations.swift `CelebrationLevelRow`: the picker on the title's line, the subtitle full width under it. */}
        <FormSection title="Live Games" icon="sparkles" caption="With Reduce Motion on, movement becomes gentle fades.">
          <GroupBox>
            <div className={formStyles.row} style={{ flexDirection: "column", alignItems: "stretch", gap: "calc(1 * var(--pt))" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "calc(8 * var(--pt))" }}>
                <span className={formStyles.rowTitle} style={{ flex: 1 }}>
                  Celebrations
                </span>
                <SegmentedControl<CelebrationLevel>
                  label="Celebrations"
                  value={s.celebrationLevel}
                  onChange={(level) => settings.set("celebrationLevel", level)}
                  options={[
                    { value: "full", label: "Full" },
                    { value: "subtle", label: "Subtle" },
                    { value: "off", label: "Off" },
                  ]}
                />
              </div>
              <span className={formStyles.rowSubtitle}>Confetti, sparks and fireworks when big plays happen</span>
            </div>
          </GroupBox>
        </FormSection>

        <FormSection title="All Sports" icon="plusCircle" caption="Data from ESPN, bo3.gg and IFSC.">
          <AllSports enabled={s.enabledLeagues} />
        </FormSection>
      </div>
    </div>
  );
}

function MyTeams() {
  const followed = useSettings((s) => s.followed);
  return (
    <FormSection title="My Teams" icon="star">
      {followed.length === 0 ? (
        <p className={styles.hint}>
          <Icon name="starOutline" size={11} />
          <span>Follow a team from its game, or with the ★ on a league's team list. It shows first, in My Teams.</span>
        </p>
      ) : (
        <LinkOrigin name="Settings">
          <GroupBox label="Followed teams">
            {followed.map((team) => (
              <div key={team.id} className={styles.teamRow}>
                {/* Logo, name and chevron open the team's page (ManageView's row link); the remove button stays its own. */}
                <TeamLink team={teamRef({ id: team.id, name: team.name, logo: team.logo })} variant="row" className={styles.teamLink}>
                  <span className={styles.teamLinkInner}>
                    <TeamLogo url={team.logo} size={16} />
                    <span className={`${styles.teamName} ${linkNameClass}`}>{team.name}</span>
                    {isSupportedTeam({ id: team.id, league: null }) ? <Icon name="chevronRight" size={9} className={styles.teamChevron} /> : null}
                  </span>
                </TeamLink>
                <button type="button" className={styles.remove} aria-label={`Unfollow ${team.name}`} title={`Unfollow ${team.name}`} onClick={() => settings.unfollow(team.id)}>
                  <Icon name="minusCircle" size={13} />
                </button>
              </div>
            ))}
          </GroupBox>
        </LinkOrigin>
      )}
    </FormSection>
  );
}

/** The enabled leagues in the user's order: drag the handle (a spring reorder), or ↑/↓ on a focused handle (instant). */
function YourSports() {
  const enabled = useSettings((s) => s.enabledLeagues);
  const [order, setOrder] = useState(enabled);
  const [dragging, setDragging] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  // Follow the store, except mid-drag (the drag owns the order until it drops).
  useEffect(() => {
    if (!dragging) setOrder(enabled);
  }, [enabled, dragging]);

  if (enabled.length === 0) {
    return (
      <p className={styles.hint}>
        <Icon name="plusCircle" size={11} />
        <span>Add a sport below and its scores appear on the list.</span>
      </p>
    );
  }

  const moveByKeyboard = (id: string, offset: number) => {
    const from = enabled.indexOf(id);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= enabled.length) return;
    settings.move(id, offset);
    setAnnouncement(`${leagueWithID(id)?.name ?? id}, position ${to + 1} of ${enabled.length}`);
  };

  return (
    <GroupBox label="Your sports, in order">
      <Reorder.Group axis="y" values={[...order]} onReorder={setOrder} className={styles.order} as="ul">
        {order.map((id) => {
          const league = leagueWithID(id);
          return league ? (
            <LeagueOrderRow
              key={id}
              league={league}
              onDragStart={() => setDragging(true)}
              onDragEnd={() => {
                setDragging(false);
                // Commit the drop: each league before the one now after it.
                settings.set("enabledLeagues", order);
              }}
              onKeyMove={(offset) => moveByKeyboard(id, offset)}
            />
          ) : null;
        })}
      </Reorder.Group>
      <span className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </span>
    </GroupBox>
  );
}

function LeagueOrderRow({ league, onDragStart, onDragEnd, onKeyMove }: { league: League; onDragStart: () => void; onDragEnd: () => void; onKeyMove: (offset: number) => void }) {
  const controls = useDragControls();
  const [dragging, setDragging] = useState(false);
  const summary = useSettings((s) => filterSummary(s, league));
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    event.stopPropagation();
    onKeyMove(event.key === "ArrowUp" ? -1 : 1);
  };
  return (
    <Reorder.Item
      value={league.id}
      dragListener={false}
      dragControls={controls}
      transition={spring.standard}
      className={styles.leagueRow}
      data-dragging={dragging}
      onDragStart={() => {
        setDragging(true);
        onDragStart();
      }}
      onDragEnd={() => {
        setDragging(false);
        onDragEnd();
      }}
    >
      <button
        type="button"
        className={styles.grip}
        aria-label={`Reorder ${league.name}`}
        title="Drag to reorder"
        onPointerDown={(e) => controls.start(e)}
        onKeyDown={onKeyDown}
      >
        <Icon name="grip" size={10} />
      </button>
      <Link to={`/settings/league/${league.id}`} className={styles.leagueLink} aria-label={`${league.name}, ${summary}`}>
        <span className={styles.leagueIcon}>
          <Icon name={SPORT_ICON[league.sport]} size={11} />
        </span>
        <span className={styles.leagueName}>{league.name}</span>
        <span className={styles.summary}>{summary}</span>
        <Icon name="chevronRight" size={9} className={styles.chevron} />
      </Link>
    </Reorder.Item>
  );
}

/** "All games", "3 teams", "No countries" (LeagueOrderRow.filterSummary). */
export function filterSummary(s: Settings, league: League): string {
  const count = (s.teamFilters[league.id] ?? []).length;
  const on = s.filteredLeagues.includes(league.id);
  if (league.source.kind === "ifsc") return !on || count === 0 ? "No countries" : count === 1 ? "1 country" : `${count} countries`;
  if (!on || count === 0) return "All games";
  return count === 1 ? "1 team" : `${count} teams`;
}

/** Every league, by sport: switch one on and it joins the end of your order. */
function AllSports({ enabled }: { enabled: readonly string[] }) {
  return (
    <>
      {SPORTS.map((sport) => {
        const leagues = CATALOG.filter((l) => l.sport === sport);
        return (
          <div key={sport} style={{ marginBottom: "calc(10 * var(--pt))" }}>
            <GroupBox label={SPORT_NAME[sport]}>
              {leagues.map((league) => (
                <CatalogRow key={league.id} league={league} on={enabled.includes(league.id)} />
              ))}
            </GroupBox>
          </div>
        );
      })}
    </>
  );
}

function CatalogRow({ league, on }: { league: League; on: boolean }) {
  const id = `catalog-${league.id}`;
  return (
    <div className={styles.catalogRow}>
      <span className={styles.leagueIcon}>
        <Icon name={SPORT_ICON[league.sport]} size={11} />
      </span>
      <span id={id} className={styles.leagueName}>
        {league.name}
      </span>
      <Toggle checked={on} onChange={(v) => settings.setEnabled(league.id, v)} labelledBy={id} />
    </div>
  );
}
