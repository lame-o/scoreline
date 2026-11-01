import { settings, useSettings } from "../../state/settings";
import { editionID } from "../../data/following";
import { Link } from "react-router";
import { FormSection, GroupBox, Icon, PageHeader, formStyles } from "../../design/components";
import { PageBack } from "../../app/PageBack";
import { useDocumentTitle } from "../../app/useDocumentTitle";
import { MyTeams, YourSports } from "./SettingsPage";
import { NotificationsSection } from "./ShellSettings";
import styles from "./Settings.module.css";

export function FollowingPage() {
  useDocumentTitle("Following");
  const editions = useSettings(s => s.editions);
  return <div className={styles.page}>
    <PageHeader title="Following" leading={<PageBack />} />
    <div className={`${styles.column} ${styles.entrance}`}>
      <p className={formStyles.caption}>Your teams across competitions, plus the competitions you choose. Matches appear once when selections overlap.</p>
      <MyTeams />
      <FormSection title="Competitions" icon="trophy" caption="Drag to reorder, or focus a handle and use ↑ and ↓. Team selections here apply only to that competition.">
        <YourSports />
      </FormSection>
      {editions.length ? <FormSection title="Tournament editions & events" icon="trophy" caption="These selections follow only the named edition. Alerts are off."><GroupBox>
        {editions.map(e => <div key={editionID(e)} className={styles.catalogRow}>
          <Link className={styles.browseLink} to={e.source === "cs2" ? `/bracket/cs2/${encodeURIComponent(e.key)}?name=${encodeURIComponent(e.name)}` : "/schedule/climbing"}>{e.name}</Link>
          <button type="button" className={styles.remove} aria-label={`Unfollow ${e.name}`} onClick={() => settings.toggleEdition(e)}><Icon name="minusCircle" size={13} /></button>
        </div>)}
      </GroupBox></FormSection> : null}
      <FormSection title="Discover" icon="sportscourt"><GroupBox>
        <Link className={styles.catalogRow} to="/sports"><span className={styles.leagueName}>Browse Sports</span><Icon name="chevronRight" size={9} /></Link>
      </GroupBox></FormSection>
      <NotificationsSection />
    </div>
  </div>;
}
