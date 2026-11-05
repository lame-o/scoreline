/**
 * Following (Following.swift `FollowingPage`, 34ba1dd): what you follow, in
 * one place. Teams, in every competition they play in, each opening its page,
 * with its bell and its remove; competitions in their order on the scores
 * list (drag a handle, or ↑/↓ on it), and Add Competitions… into Sports;
 * single tournaments and climbing events, each opening and each removable.
 */
import { Link } from "react-router";
import { FormSection, GroupBox, Icon, PageHeader } from "../../design/components";
import { PageBack } from "../../app/PageBack";
import { useDocumentTitle } from "../../app/useDocumentTitle";
import { editionID } from "../../data/following";
import { settings, useSettings } from "../../state/settings";
import { MyTeams, YourSports } from "./SettingsPage";
import { editionTarget } from "./targets";
import styles from "./Settings.module.css";

export function FollowingPage() {
  useDocumentTitle("Following");
  const editions = useSettings((s) => s.editions);
  const competitions = useSettings((s) => s.enabledLeagues.length);
  return (
    <div className={styles.page}>
      <PageHeader title="Following" leading={<PageBack />} />
      <div className={`${styles.column} ${styles.entrance}`}>
        <MyTeams />
        <FormSection title="Competitions" icon="list" caption={competitions > 1 ? "Drag to reorder. Their order is the scores list's." : undefined}>
          <YourSports
            footer={
              <Link className={`${styles.navRow} ${styles.addRow}`} to="/sports">
                <span className={styles.leagueIcon}>
                  <Icon name="plusCircle" size={13} />
                </span>
                <span className={styles.leagueName}>Add Competitions…</span>
                <Icon name="chevronRight" size={9} className={styles.chevron} />
              </Link>
            }
          />
        </FormSection>
        {editions.length ? (
          <FormSection title="Tournaments & Events" icon="trophy" caption="Only these, not the rest of their sport.">
            <GroupBox>
              {editions.map((e) => (
                <div key={editionID(e)} className={styles.followRow}>
                  <Link className={styles.followLink} to={editionTarget(e)}>
                    <span className={styles.leagueName}>{e.name}</span>
                    <Icon name="chevronRight" size={9} className={styles.chevron} />
                  </Link>
                  <button type="button" className={styles.remove} aria-label={`Unfollow ${e.name}`} title={`Unfollow ${e.name}`} onClick={() => settings.toggleEdition(e)}>
                    <Icon name="minusCircle" size={13} />
                  </button>
                </div>
              ))}
            </GroupBox>
          </FormSection>
        ) : null}
      </div>
    </div>
  );
}
