/**
 * A competition's page (LeagueSettingsView.swift, 34ba1dd): what's coming up
 * first (its games, competitions or tournaments, and the way into its full
 * schedule), what else it has (Explore), then its settings: following it,
 * and whether every match shows or only the teams picked here. For climbing
 * the picks are countries, whose athletes get called out. A soccer
 * competition's season has its own page (Explore's Competition): this one is
 * its settings.
 *
 * One list of teams, with one meaning: the star follows a team everywhere it
 * plays, and in Selected Teams a click picks it (a checkmark) for this
 * competition alone; otherwise a row opens its team.
 */
import { Link, useParams } from "react-router";
import { competitionPath } from "../../data/soccerCompetition";
import { FormSection, GroupBox, Icon, PageHeader, SegmentedControl, ToggleRow, formStyles } from "../../design/components";
import { hasTable, leagueWithID } from "../../data/leagues";
import type { League } from "../../data/models";
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
  useDocumentTitle(league ? league.name : null);
  const filterOn = useSettings((s) => (league ? s.filteredLeagues.includes(league.id) : false));
  if (!league) return <NotFound />;
  const climbing = league.source.kind === "ifsc";
  return (
    <div className={styles.page}>
      <PageHeader title={league.name} icon={undefined} leading={<PageBack />} />
      <div className={`${styles.column} ${styles.entrance}`}>
        {/* A soccer competition's season lives on its own page. */}
        {league.sport !== "soccer" ? <LeagueHub league={league} /> : null}
        <Explore league={league} />
        <FormSection title="In Your Scores" icon="list">
          <GroupBox>
            <FollowCompetition league={league} />
          </GroupBox>
        </FormSection>
        <LeagueOptions league={league} />
        <TeamPicks key={`${league.id}-${filterOn || climbing}`} league={league} picking={filterOn || climbing} />
      </div>
    </div>
  );
}

/** What else the league has, beside its schedule. */
function Explore({ league }: { league: League }) {
  const table = league.sport !== "soccer" && hasTable(league);
  if (!table && league.sport !== "soccer" && league.id !== "college-football" && league.id !== "mlb") return null;
  return (
    <FormSection title="Explore" icon="list">
      <GroupBox>
        {league.sport === "soccer" ? <ExploreRow to={competitionPath(league.id)} title="Competition" /> : null}
        {table ? <ExploreRow to={`/standings/${league.id}`} title="Standings" /> : null}
        {league.id === "college-football" ? <ExploreRow to="/rankings/college-football" title="Top 25" /> : null}
        {league.id === "mlb" ? <ExploreRow to={`/bracket/mlb/${new Date().getFullYear()}`} title="Postseason Bracket" /> : null}
      </GroupBox>
    </FormSection>
  );
}

function ExploreRow({ to, title }: { to: string; title: string }) {
  return (
    <Link className={styles.navRow} to={to}>
      <span className={styles.leagueName}>{title}</span>
      <Icon name="chevronRight" size={9} className={styles.chevron} />
    </Link>
  );
}

function LeagueOptions({ league }: { league: League }) {
  const s = useSettings(all);
  const climbing = league.source.kind === "ifsc";
  const filterOn = s.filteredLeagues.includes(league.id);
  return (
    <>
      <FormSection title="Show" icon="list">
        {climbing ? (
          <p className={formStyles.caption} style={{ paddingTop: 0 }}>
            Pick countries to see their best-placed athlete on each round and highlighted in the standings.
          </p>
        ) : (
          <>
            <div className={styles.segmentRow}>
              <SegmentedControl
                label="Show"
                value={filterOn ? "mine" : "all"}
                onChange={(v) => settings.setFilterOn(league.id, v === "mine")}
                options={[
                  { value: "all", label: "All Matches" },
                  { value: "mine", label: "Selected Teams" },
                ]}
              />
            </div>
            <p className={formStyles.caption}>
              {filterOn ? `Only the teams checked below show under ${league.name}.` : `Every ${league.name} match shows. Star a team to follow it everywhere it plays.`}
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

function FollowCompetition({ league }: { league: League }) {
  const on = useSettings((s) => s.enabledLeagues.includes(league.id));
  const subtitle = league.kind === "circuit" ? "Every event on the scores list. A team or a single event can be followed on its own." : "Its matches on the scores list. Teams you follow show everywhere they play.";
  return <ToggleRow title={`Follow ${league.name}`} subtitle={subtitle} checked={on} onChange={(v) => settings.setEnabled(league.id, v)} />;
}
