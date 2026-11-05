/**
 * The star everywhere something can be followed (Following.swift
 * `FollowStar`, `EditionStar`): outlined, then filled in the star's yellow;
 * its own 22pt target, so a row's click still opens the row.
 *
 *     <FollowStar following={on} name="Premier League" help="Follow Premier League: its games on the scores list" onToggle={…} />
 *     <EditionStar edition={{ source: "cs2", key: slug, name }} />
 */
import { Icon } from "../../design/components";
import { editionID, type EditionFollow } from "../../data/following";
import { settings, useSettings } from "../../state/settings";
import styles from "./Settings.module.css";

export function FollowStar({ following, name, help, onToggle }: { following: boolean; name: string; help?: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={styles.star}
      data-on={following}
      aria-pressed={following}
      aria-label={following ? `Unfollow ${name}` : `Follow ${name}`}
      title={following ? `Unfollow ${name}` : (help ?? `Follow ${name}`)}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
    >
      <Icon name={following ? "star" : "starOutline"} size={12} />
    </button>
  );
}

/** The star on one tournament or climbing event: that one alone, never its whole sport. */
export function EditionStar({ edition }: { edition: EditionFollow }) {
  const on = useSettings((s) => s.editions.some((e) => editionID(e) === editionID(edition)));
  return <FollowStar following={on} name={edition.name} help={`Follow ${edition.name} only`} onToggle={() => settings.toggleEdition(edition)} />;
}
