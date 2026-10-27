/**
 * A league's teams and options (LeagueSettingsView.swift "In Your Scores"):
 * All Games | Only My Teams, the league's own options (college Top 25,
 * climbing disciplines, CS2 co-streams), and its teams to pick and follow.
 * Picking a team turns the filter on; the ★ follows a team (it shows first,
 * in My Teams). Climbing picks countries, which call out their best-placed
 * athlete on each round instead of filtering.
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useParams } from "react-router";
import { BackButton, Button, ErrorCopy, FormSection, GroupBox, Icon, PageHeader, SegmentedControl, Skeleton, TeamLogo, ToggleRow, formStyles } from "../../design/components";
import { leagueWithID } from "../../data/leagues";
import type { League } from "../../data/models";
import { getJSON } from "../../data/http";
import { teamOptions, type TeamOption } from "../../data/providers/teams";
import { useGoBack } from "../../app/navigation";
import { useDocumentTitle } from "../../app/useDocumentTitle";
import { NotFound } from "../../app/NotFound";
import { settings, useSettings, type Settings } from "../../state/settings";
import styles from "./Settings.module.css";

const all = (s: Settings) => s;
/** Past this many teams, a search field leads the list (focused when it appears). */
const SEARCH_FROM = 12;

export function LeaguePage() {
  const { id } = useParams();
  const league = id ? leagueWithID(id) : undefined;
  const goBack = useGoBack();
  useDocumentTitle(league ? league.name : null);
  if (!league) return <NotFound />;
  return (
    <div className={styles.page}>
      <PageHeader title={league.name} icon={undefined} leading={<BackButton to="Settings" onClick={() => goBack()} />} />
      <div className={`${styles.column} ${styles.entrance}`}>
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

function TeamPicks({ league }: { league: League }) {
  const s = useSettings(all);
  const climbing = league.source.kind === "ifsc";
  const noun = climbing ? "Countries" : "Teams";
  const query = useQuery({
    queryKey: ["teams", league.id],
    queryFn: ({ signal }) => teamOptions(league, getJSON, signal),
    staleTime: 6 * 3_600_000,
  });
  const [search, setSearch] = useState("");
  const picks = s.teamFilters[league.id] ?? [];
  const options = query.data ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? options.filter((o) => o.name.toLowerCase().includes(q)) : options;
  }, [options, search]);
  const selected = filtered.filter((o) => picks.includes(o.id));
  const rest = filtered.filter((o) => !picks.includes(o.id));

  return (
    <FormSection title={noun} icon={climbing ? "flag" : "star"}>
      {options.length > SEARCH_FROM ? (
        <label className={styles.search}>
          <Icon name="ellipsis" size={10} />
          <span className="visually-hidden">Search {noun.toLowerCase()}</span>
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${noun.toLowerCase()}`} autoComplete="off" />
        </label>
      ) : null}
      {query.isPending ? (
        <GroupBox>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className={styles.skeletonRow} role={i === 0 ? "status" : undefined} aria-label={i === 0 ? `Loading ${noun.toLowerCase()}` : undefined}>
              <Skeleton circle width={16} height={16} />
              <Skeleton width={100 + ((i * 37) % 60)} height={9} />
            </div>
          ))}
        </GroupBox>
      ) : query.isError ? (
        <p className={formStyles.caption}>
          Couldn't load {noun.toLowerCase()}. {ErrorCopy.message}{" "}
          <Button onClick={() => void query.refetch()} style={{ marginLeft: "calc(6 * var(--pt))" }}>
            {ErrorCopy.retry}
          </Button>
        </p>
      ) : (
        <>
          {selected.length > 0 ? <PickGroup title="Selected" options={selected} league={league} picks={picks} followed={s.followed.map((t) => t.id)} /> : null}
          <PickGroup title={selected.length > 0 ? `All ${noun}` : null} options={rest} league={league} picks={picks} followed={s.followed.map((t) => t.id)} />
        </>
      )}
    </FormSection>
  );
}

function PickGroup({ title, options, league, picks, followed }: { title: string | null; options: readonly TeamOption[]; league: League; picks: readonly string[]; followed: readonly string[] }) {
  // College: grouped under their conferences.
  const groups = useMemo(() => {
    const out: { group: string | null; options: TeamOption[] }[] = [];
    for (const o of options) {
      const last = out[out.length - 1];
      if (last && last.group === o.group) last.options.push(o);
      else out.push({ group: o.group, options: [o] });
    }
    return out;
  }, [options]);
  if (options.length === 0) return null;
  return (
    <div style={{ marginTop: "calc(8 * var(--pt))" }}>
      {title ? <p className={styles.conference}>{title}</p> : null}
      {groups.map((g) => (
        <div key={g.group ?? "all"}>
          {g.group && groups.length > 1 ? <p className={styles.conference}>{g.group}</p> : null}
          <GroupBox>
            {g.options.map((o) => (
              <PickRow key={o.id} option={o} league={league} picked={picks.includes(o.id)} following={followed.includes(o.id)} />
            ))}
          </GroupBox>
        </div>
      ))}
    </div>
  );
}

function PickRow({ option, league, picked, following }: { option: TeamOption; league: League; picked: boolean; following: boolean }) {
  const climbing = league.source.kind === "ifsc";
  return (
    <div className={styles.teamRow} style={{ paddingLeft: 0 }}>
      <button type="button" className={styles.pick} role="checkbox" aria-checked={picked} onClick={() => settings.togglePick(league.id, option.id)}>
        <span className={styles.check}>{picked ? <Icon name="check" size={11} /> : null}</span>
        {option.flag ? <span className={styles.flag}>{option.flag}</span> : <TeamLogo url={option.logo} size={16} />}
        <span className={styles.teamName}>{option.name}</span>
      </button>
      {climbing ? null : (
        <button
          type="button"
          className={styles.remove}
          style={{ color: following ? "var(--star)" : undefined }}
          aria-pressed={following}
          aria-label={following ? `Unfollow ${option.name}` : `Follow ${option.name}`}
          title={following ? `Unfollow ${option.name}` : `Follow ${option.name}`}
          onClick={() => settings.toggleFollow({ id: option.id, name: option.name, logo: option.logo })}
        >
          <Icon name={following ? "star" : "starOutline"} size={11} />
        </button>
      )}
    </div>
  );
}
