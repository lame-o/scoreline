/** Competition hub: browse its season, follow teams globally, or set this
 * competition's scope. Each tab keeps a distinct selection meaning. */
import { Link, useParams, useSearchParams } from "react-router";
import { competitionPath } from "../../data/soccerCompetition";
import { FormSection, GroupBox, PageHeader, SegmentedControl, ToggleRow, formStyles } from "../../design/components";
import { leagueWithID } from "../../data/leagues";
import type { League } from "../../data/models";
import { competitionKind, hasTable } from "../../data/competitionCatalog";
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
  const [search, setSearch] = useSearchParams();
  const tab = ["teams", "following"].includes(search.get("tab") ?? "") ? search.get("tab")! : "overview";
  useDocumentTitle(league ? league.name : null);
  if (!league) return <NotFound />;
  return (
    <div className={styles.page}>
      <PageHeader title={league.name} icon={undefined} leading={<PageBack />} />
      <div className={`${styles.column} ${styles.entrance}`}>
        <FormSection title={competitionKind(league)} icon="trophy">
          <GroupBox><FollowCompetition league={league} /></GroupBox>
        </FormSection>
        <div className={styles.browseControls}><SegmentedControl label="Competition page" value={tab} onChange={v => setSearch(v === "overview" ? {} : {tab:v}, {replace:true})} options={[
          {value:"overview",label:"Overview"}, {value:"teams",label:league.source.kind === "ifsc" ? "Countries" : "Teams"}, {value:"following",label:"Following"}
        ]} /></div>
        {tab === "overview" ? <>
          <FormSection title="Explore" icon="list"><GroupBox>
            {league.sport === "soccer" ? <Link className={styles.catalogRow} to={competitionPath(league.id)}>Season · Rounds and Results</Link> : null}
            {hasTable(league) ? <Link className={styles.catalogRow} to={`/standings/${league.id}`}>Standings</Link> : null}
            {league.id === "college-football" ? <Link className={styles.catalogRow} to="/rankings/college-football">Top 25</Link> : null}
            {league.id === "mlb" ? <Link className={styles.catalogRow} to={`/bracket/mlb/${new Date().getFullYear()}`}>Postseason bracket</Link> : null}
            <Link className={styles.catalogRow} to={`/schedule/${league.id === "cs2" ? "tournaments" : league.id === "ifsc" ? "climbing" : league.id}`}>{league.id === "cs2" ? "Tournaments" : league.id === "ifsc" ? "Season competitions" : "Full Schedule"}</Link>
          </GroupBox></FormSection>
          <LeagueHub league={league} />
        </> : tab === "teams" ? <>
          <p className={formStyles.caption}>{league.source.kind === "ifsc" ? "Countries highlight athletes in the series. They do not hide other competitors." : "Follow teams across all competitions. This does not change which competitions you follow."}</p>
          <TeamPicks key={`${league.id}-global`} league={league} mode={league.source.kind === "ifsc" ? "scoped" : "global"} />
        </> : <>
          <LeagueOptions league={league} />
          <ScopedTeams league={league} />
        </>}

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
      <FormSection title="Competition scope" icon="list">
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
                  { value: "mine", label: "Selected Teams" },
                ]}
              />
            </div>
            <p className={formStyles.caption}>
              {filterOn ? `Only the selected teams’ ${league.name} matches appear. Team follows elsewhere remain independent.` : `Every ${league.name} game appears. Switch to pick specific teams.`}
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

function FollowCompetition({league}: {league: League}) {
  const on = useSettings(s => s.enabledLeagues.includes(league.id));
  return <ToggleRow title={`Follow ${league.name}`} subtitle={on ? "Included in Scores. Teams you follow can also appear independently." : "Explore without following. Team follows remain independent."} checked={on} onChange={v => settings.setEnabled(league.id, v)} />;
}
function ScopedTeams({league}: {league: League}) {
  const on = useSettings(s => s.filteredLeagues.includes(league.id));
  return on && league.source.kind !== "ifsc" ? <TeamPicks key={league.id} league={league} /> : null;
}
