/**
 * A league's teams and options (LeagueSettingsView.swift "In Your Scores"):
 * All Games | Only My Teams, the league's own options (college Top 25,
 * climbing disciplines, CS2 co-streams), and its teams to pick and follow.
 * Picking a team turns the filter on; the ★ follows a team (it shows first,
 * in My Teams). Climbing picks countries, which call out their best-placed
 * athlete on each round instead of filtering. The pick list is an outline
 * with the Mac's keys (PickList.tsx).
 */
import { useParams } from "react-router";
import { Button, FormSection, GroupBox, PageHeader, SegmentedControl, ToggleRow, formStyles } from "../../design/components";
import { leagueWithID } from "../../data/leagues";
import type { League } from "../../data/models";
import { useGoBack } from "../../app/navigation";
import { PageBack } from "../../app/PageBack";
import { useDocumentTitle } from "../../app/useDocumentTitle";
import { NotFound } from "../../app/NotFound";
import { settings, useSettings, type Settings } from "../../state/settings";
import { LeagueHub } from "../schedule/LeagueHub";
import { TeamPicks } from "./PickList";
import styles from "./Settings.module.css";

const all = (s: Settings) => s;

export function LeaguePage() {
  const { id } = useParams();
  const league = id ? leagueWithID(id) : undefined;
  const goBack = useGoBack();
  useDocumentTitle(league ? league.name : null);
  if (!league) return <NotFound />;
  return (
    <div className={styles.page}>
      <PageHeader title={league.name} icon={undefined} leading={<PageBack />} />
      <div className={`${styles.column} ${styles.entrance}`}>
        {/* What's next and what just happened lead, as on the Mac's league page (ScheduleHub, ResultsHub). */}
        <LeagueHub league={league} />
        <LeagueOptions league={league} />
        <TeamPicks league={league} />
        <div className={styles.footerActions}>
          <Button
            className={styles.destructive}
            onClick={() => {
              settings.setEnabled(league.id, false);
              goBack();
            }}
          >
            Hide {league.name}
          </Button>
        </div>
      </div>
    </div>
  );
}

function LeagueOptions({ league }: { league: League }) {
  const s = useSettings(all);
  const climbing = league.source.kind === "ifsc";
  const filterOn = s.filteredLeagues.includes(league.id);
  return (
    <>
      <FormSection title="In Your Scores" icon="list">
        {climbing ? (
          <p className={formStyles.caption} style={{ paddingTop: 0 }}>
            Pick countries to see their best-placed athlete on each round.
          </p>
        ) : (
          <>
            <div className={styles.segmentRow}>
              <SegmentedControl
                label="Show"
                value={filterOn ? "mine" : "all"}
                onChange={(v) => settings.setFilterOn(league.id, v === "mine")}
                options={[
                  { value: "all", label: "All Games" },
                  { value: "mine", label: "Only My Teams" },
                ]}
              />
            </div>
            <p className={formStyles.caption}>
              {filterOn ? `Only games involving the teams checked below appear under ${league.name}.` : `Every ${league.name} game appears. Switch to pick specific teams.`}
            </p>
          </>
        )}
      </FormSection>
      {league.id === "college-football" ? (
        <FormSection title="Options" icon="sliders">
          <GroupBox>
            <ToggleRow title="Top 25 games only" subtitle="Plus every team you follow" checked={s.collegeTop25Only} onChange={(v) => settings.set("collegeTop25Only", v)} />
          </GroupBox>
        </FormSection>
      ) : null}
      {climbing ? (
        <FormSection title="Disciplines" icon="climbing">
          <GroupBox>
            <ToggleRow title="Lead" subtitle="Height on one route, hold by hold" checked={s.climbingDisciplines.includes("lead")} onChange={() => settings.toggleDiscipline("lead")} />
            <ToggleRow title="Boulder" subtitle="Tops and zones on short problems" checked={s.climbingDisciplines.includes("boulder")} onChange={() => settings.toggleDiscipline("boulder")} />
            <ToggleRow title="Speed" subtitle="Head-to-head races up a standard wall" checked={s.climbingDisciplines.includes("speed")} onChange={() => settings.toggleDiscipline("speed")} />
          </GroupBox>
        </FormSection>
      ) : null}
      {league.source.kind === "counterStrike" ? (
        <FormSection title="Options" icon="sliders" caption="Co-stream detection arrives with CS2 game pages; the channel is kept for it.">
          <GroupBox>
            <ToggleRow title="Show co-streams" subtitle="Marks live matches this channel is streaming" checked={s.showCoStream} onChange={(v) => settings.set("showCoStream", v)} />
            <div className={formStyles.row} style={{ opacity: s.showCoStream ? 1 : 0.5 }}>
              <label htmlFor="costreamer" style={{ flex: 1 }}>
                Twitch channel
              </label>
              <input
                id="costreamer"
                className={styles.textField}
                defaultValue={s.coStreamer}
                placeholder="ohnepixel"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                disabled={!s.showCoStream}
                onBlur={(e) => settings.set("coStreamer", e.currentTarget.value.trim())}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              />
            </div>
          </GroupBox>
        </FormSection>
      ) : null}
    </>
  );
}
