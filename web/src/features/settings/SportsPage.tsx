import { useState } from "react";
import { Link } from "react-router";
import { FormSection, GroupBox, Icon, PageHeader, SegmentedControl, SPORT_ICON, formStyles } from "../../design/components";
import { PageBack } from "../../app/PageBack";
import { useDocumentTitle } from "../../app/useDocumentTitle";
import { CATALOG, competitionHref, competitionKind } from "../../data/leagues";
import { SPORTS, SPORT_NAME, type Sport } from "../../data/models";
import { settings, useSettings } from "../../state/settings";
import styles from "./Settings.module.css";

export function SportsPage() {
  useDocumentTitle("Sports");
  const enabled = useSettings(s => s.enabledLeagues);
  const [sport, setSport] = useState<Sport | "all">("all");
  const [tab, setTab] = useState<"competitions" | "teams">("competitions");
  const [search, setSearch] = useState("");
  const matches = CATALOG.filter(l => (sport === "all" || l.sport === sport) && (tab !== "teams" || l.source.kind !== "ifsc") && `${l.name} ${SPORT_NAME[l.sport]} ${competitionKind(l)}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <div className={styles.page}>
    <PageHeader title="Sports" leading={<PageBack />} />
    <div className={`${styles.column} ${styles.entrance}`}>
      <div className={styles.browseControls}>
        <label className={styles.sportSelect}>Sport <select aria-label="Sport" value={sport} onChange={e => setSport(e.target.value as Sport | "all")}><option value="all">All sports</option>{SPORTS.map(s => <option key={s} value={s}>{SPORT_NAME[s]}</option>)}</select></label>
        <SegmentedControl label="Browse" value={tab} onChange={setTab} options={[{value:"competitions", label:"Competitions"},{value:"teams",label:"Teams"}]} />
      </div>
      <label className={styles.search}><Icon name="search" size={11} /><span className="visually-hidden">Search competitions</span><input type="search" placeholder="Search competitions" value={search} onChange={e => setSearch(e.target.value)} /></label>
      <p className={formStyles.caption}>{tab === "teams" ? "Choose a competition to find its teams. Team follows include all competitions." : "Open any competition to explore. Following adds its matches to Scores; alerts are separate."}</p>
      {SPORTS.map(s => {
        const leagues = matches.filter(l => l.sport === s);
        return leagues.length ? <FormSection key={s} title={SPORT_NAME[s]} icon={SPORT_ICON[s]}><GroupBox>
          {leagues.map(l => <div key={l.id} className={styles.catalogRow}>
            <Link className={styles.browseLink} to={competitionHref(l.id) + (tab === "teams" ? "?tab=teams" : "")}>
              <span className={styles.browseName}>{l.name}<span className={styles.browseDetail}>{tab === "teams" ? "Browse teams" : competitionKind(l)}</span></span><Icon name="chevronRight" size={9} />
            </Link>
            {tab === "competitions" ? <button type="button" className={styles.followButton} aria-pressed={enabled.includes(l.id)} aria-label={`${enabled.includes(l.id) ? "Unfollow" : "Follow"} ${l.name}`} onClick={() => settings.setEnabled(l.id, !enabled.includes(l.id))}><Icon name={enabled.includes(l.id) ? "star" : "starOutline"} size={13} /></button> : null}
          </div>)}
        </GroupBox></FormSection> : null;
      })}
      {matches.length === 0 ? <p className={styles.hint}>No competitions match your search.</p> : null}
    </div>
  </div>;
}
