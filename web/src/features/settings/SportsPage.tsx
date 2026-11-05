/**
 * Sports (SportsView.swift, 34ba1dd): every sport, and one search across
 * their competitions, tournaments and teams. A sport's page lists its
 * leagues, cups and tournaments, then its teams. Opening a row never
 * follows anything; the star does (a competition: its games on the scores
 * list; a team: first on the list, in every competition it plays in, with
 * alerts; one tournament or event: that one alone).
 *
 * The search field is focused on open, so typing searches straight away;
 * Return opens the first thing found; Esc clears the search first, then goes
 * back. Searching loads every league's teams, four lists at a time.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { CrestStrip, DisclosureHeader, FormSection, GroupBox, Icon, OutlineBox, PageHeader, SPORT_ICON, TeamLogo, useGroupFlag, useOutline, type IconName } from "../../design/components";
import { PageBack } from "../../app/PageBack";
import { useGoBack } from "../../app/navigation";
import { useDocumentTitle } from "../../app/useDocumentTitle";
import { NotFound } from "../../app/NotFound";
import { dayRangeLabel } from "../../data/days";
import type { EditionFollow } from "../../data/following";
import { SPORTS, SPORT_NAME, type League, type Sport } from "../../data/models";
import { isSupportedTeam, teamRef } from "../../data/profiles/models";
import type { TeamOption } from "../../data/providers/teams";
import type { SeasonEvent } from "../../data/schedule";
import { followingSummary, sportLeagues, sportsSearch, teamLeagues } from "../../data/sportsSearch";
import { useClimbingSeasons, useTournaments } from "../../state/seasons";
import { settings, useSettings } from "../../state/settings";
import { loadAllTeams, loadTeams, useSportsDirectory } from "../../state/sportsDirectory";
import { LinkOrigin, TeamLink, teamHref } from "../profiles/ProfileLinks";
import { EditionStar, FollowStar } from "./FollowStar";
import { toggleTeam } from "./followTeam";
import { competitionTarget, editionTarget, sportHref } from "./targets";
import styles from "./Settings.module.css";

export { competitionTarget, editionTarget, sportHref };


// MARK: - Sports

export function SportsPage() {
  useDocumentTitle("Sports");
  const enabled = useSettings((s) => s.enabledLeagues);
  const followed = useSettings((s) => s.followed);
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;
  const directory = useSportsDirectory();
  const tournaments = useTournaments();
  const navigate = useNavigate();
  const goBack = useGoBack();
  const field = useRef<HTMLInputElement>(null);

  // Typing searches straight away; a search loads every league's teams.
  useEffect(() => field.current?.focus({ preventScroll: true }), []);
  useEffect(() => {
    if (searching) void loadAllTeams();
  }, [searching]);

  const found = useMemo(() => sportsSearch(query, directory.teams, tournaments.upcoming), [query, directory.teams, tournaments.upcoming]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      // Esc first clears a search, like any macOS search field; then it goes back.
      e.preventDefault();
      e.stopPropagation();
      if (query) setQuery("");
      else goBack();
    } else if (e.key === "Enter") {
      // Return: the first thing found.
      const league = found.competitions[0];
      const team = found.teams[0];
      if (league) navigate(competitionTarget(league));
      else if (team) {
        const ref = teamRef({ id: team.option.id, name: team.option.name, logo: team.option.logo, league: team.league.id });
        if (isSupportedTeam(ref)) navigate(teamHref(ref), { state: { team: ref } });
      }
    }
  };

  return (
    <div className={styles.page}>
      <PageHeader title="Sports" leading={<PageBack />} />
      <div className={`${styles.column} ${styles.entrance}`}>
        <label className={styles.search}>
          <Icon name="search" size={11} />
          <span className="visually-hidden">Search teams and competitions</span>
          <input ref={field} type="search" placeholder="Search teams and competitions" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKeyDown} />
        </label>
        <LinkOrigin name="Sports">
          {searching ? (
            <Results found={found} indexing={directory.indexing} query={query} />
          ) : (
            <>
              <GroupBox>
                <NavigationRow to="/following" icon="star" title="Following" value={followingSummary(enabled.length, followed.length)} />
              </GroupBox>
              <FormSection title="Sports" icon="sportscourt">
                <GroupBox>
                  {SPORTS.map((sport) => {
                    const count = enabled.filter((id) => sportLeagues(sport).some((l) => l.id === id)).length;
                    return <NavigationRow key={sport} to={sportHref(sport)} icon={SPORT_ICON[sport]} title={SPORT_NAME[sport]} value={count ? `${count} followed` : null} />;
                  })}
                </GroupBox>
              </FormSection>
            </>
          )}
        </LinkOrigin>
      </div>
    </div>
  );
}

function Results({ found, indexing, query }: { found: ReturnType<typeof sportsSearch>; indexing: boolean; query: string }) {
  const empty = found.competitions.length + found.editions.length + found.teams.length === 0;
  return (
    <>
      {found.competitions.length ? (
        <FormSection title="Competitions" icon="trophy">
          <GroupBox>
            {found.competitions.map((league) => (
              <CompetitionRow key={league.id} league={league} detail={SPORT_NAME[league.sport]} />
            ))}
          </GroupBox>
        </FormSection>
      ) : null}
      {found.editions.length ? (
        <FormSection title="Tournaments" icon="esports">
          <GroupBox>
            {found.editions.map((event) => (
              <TournamentRow key={event.id} event={event} />
            ))}
          </GroupBox>
        </FormSection>
      ) : null}
      {found.teams.length ? (
        <FormSection title="Teams" icon="person">
          <GroupBox>
            {found.teams.map((t) => (
              <TeamRow key={t.option.id} option={t.option} league={t.league} detail={t.league.name} />
            ))}
          </GroupBox>
        </FormSection>
      ) : null}
      {indexing ? (
        <p className={styles.searching} role="status">
          Looking through every team…
        </p>
      ) : empty ? (
        <p className={styles.noResults} role="status">
          <strong>No Results</strong>
          <span>Nothing matches “{query.trim()}”.</span>
        </p>
      ) : null}
    </>
  );
}

// MARK: - A sport

/** One sport: its leagues, cups and tournaments, then its teams (SportPage). */
export function SportPage() {
  const { sport: raw } = useParams();
  const sport = SPORTS.find((s) => s === raw);
  useDocumentTitle(sport ? SPORT_NAME[sport] : null);
  if (!sport) return <NotFound />;
  return <SportBody sport={sport} />;
}

function SportBody({ sport }: { sport: Sport }) {
  const circuit = sportLeagues(sport, "circuit")[0];
  const leagues = teamLeagues(sport);
  return (
    <div className={styles.page}>
      <PageHeader title={SPORT_NAME[sport]} leading={<PageBack />} />
      <div className={`${styles.column} ${styles.entrance}`}>
        <LinkOrigin name={SPORT_NAME[sport]}>
          <Competitions sport={sport} kind="league" title="Leagues" icon="list" />
          <Competitions sport={sport} kind="cup" title="Cups" icon="trophy" />
          <Competitions sport={sport} kind="tournament" title="Tournaments" icon="trophy" />
          {circuit ? <Circuit league={circuit} /> : null}
          {leagues.length ? (
            <FormSection title="Teams" icon="person">
              {leagues.map((league) => (
                <TeamDirectory key={league.id} league={league} collapses={leagues.length > 1} />
              ))}
            </FormSection>
          ) : null}
        </LinkOrigin>
      </div>
    </div>
  );
}

function Competitions({ sport, kind, title, icon }: { sport: Sport; kind: League["kind"]; title: string; icon: IconName }) {
  const list = sportLeagues(sport, kind);
  return list.length ? (
    <FormSection title={title} icon={icon}>
      <GroupBox>
        {list.map((league) => (
          <CompetitionRow key={league.id} league={league} />
        ))}
      </GroupBox>
    </FormSection>
  ) : null;
}

/** A circuit (CS2's S-tier, climbing's series) is followed whole, or one event at a time. */
function Circuit({ league }: { league: League }) {
  const climbing = league.source.kind === "ifsc";
  return (
    <FormSection title={climbing ? "Competitions" : "Tournaments"} icon="trophy">
      <GroupBox>
        <CompetitionRow league={league} detail={climbing ? "Every competition" : "Every S-tier tournament"} />
        {climbing ? <ClimbingEvents /> : <CSEvents />}
      </GroupBox>
    </FormSection>
  );
}

function CSEvents() {
  const t = useTournaments();
  return (
    <>
      {t.events
        .filter((e) => e.status === "live" || e.status === "upcoming")
        .map((e) => (
          <TournamentRow key={e.id} event={e} />
        ))}
    </>
  );
}

function ClimbingEvents() {
  const c = useClimbingSeasons();
  return (
    <>
      {c.events
        .filter((e) => e.status === "live" || e.status === "upcoming")
        .map((e) => (
          <TournamentRow key={e.id} event={e} />
        ))}
    </>
  );
}

// MARK: - Rows

function NavigationRow({ to, icon, title, value }: { to: string; icon: IconName; title: string; value: string | null }) {
  return (
    <Link className={styles.navRow} to={to}>
      <span className={styles.leagueIcon}>
        <Icon name={icon} size={11} />
      </span>
      <span className={styles.leagueName}>{title}</span>
      {value ? <span className={styles.summary}>{value}</span> : null}
      <Icon name="chevronRight" size={9} className={styles.chevron} />
    </Link>
  );
}

/** A competition: the row opens it, the star on it follows it. */
function CompetitionRow({ league, detail }: { league: League; detail?: string }) {
  const on = useSettings((s) => s.enabledLeagues.includes(league.id));
  return (
    <div className={styles.followRow}>
      <Link className={styles.followLink} to={competitionTarget(league)}>
        <span className={styles.browseName}>
          <span>{league.name}</span>
          {detail ? <span className={styles.browseDetail}>{detail}</span> : null}
        </span>
      </Link>
      <FollowStar following={on} name={league.name} help={`Follow ${league.name}: its games on the scores list`} onToggle={() => settings.setEnabled(league.id, !on)} />
      <Icon name="chevronRight" size={9} className={styles.rowChevron} />
    </div>
  );
}

/** A team: the row opens its page where it has one, the star follows it everywhere it plays. */
function TeamRow({ option, league, detail }: { option: TeamOption; league: League; detail?: string }) {
  const on = useSettings((s) => s.followed.some((t) => t.id === option.id));
  const ref = teamRef({ id: option.id, name: option.name, logo: option.logo, league: league.id });
  const page = isSupportedTeam(ref);
  return (
    <div className={styles.followRow}>
      <TeamLink team={ref} className={styles.followLink}>
        <TeamLogo url={option.logo} size={18} />
        <span className={styles.browseName}>
          <span>{option.name}</span>
          {detail ? <span className={styles.browseDetail}>{detail}</span> : null}
        </span>
      </TeamLink>
      <FollowStar following={on} name={option.name} help={`Follow ${option.name}: first on the scores list, in every competition, with alerts`} onToggle={() => toggleTeam(option)} />
      {page ? <Icon name="chevronRight" size={9} className={styles.rowChevron} /> : <span className={styles.rowChevron} />}
    </div>
  );
}

/** One CS2 tournament or climbing competition, followed on its own. */
function TournamentRow({ event }: { event: SeasonEvent }) {
  const edition: EditionFollow = event.kind.kind === "tournament" ? { source: "cs2", key: event.kind.slug, name: event.name } : { source: "ifsc", key: String(event.kind.id), name: event.name };
  return (
    <div className={styles.followRow}>
      <Link className={styles.followLink} to={editionTarget(edition)}>
        {event.kind.kind === "tournament" ? <TeamLogo url={event.logo} size={18} /> : null}
        <span className={styles.browseName}>
          <span>{event.name}</span>
          <span className={`${styles.browseDetail} tabular`}>{dayRangeLabel(event.startDay, event.endDay)}</span>
        </span>
        {event.status === "live" ? <span className={styles.liveDot} aria-label="Live" /> : null}
      </Link>
      <EditionStar edition={edition} />
      <Icon name="chevronRight" size={9} className={styles.rowChevron} />
    </div>
  );
}

/**
 * A league's teams under a sport: a group that opens with a line of crests
 * where the sport has several leagues, the list itself where it has one.
 */
function TeamDirectory({ league, collapses }: { league: League; collapses: boolean }) {
  const directory = useSportsDirectory();
  const options = directory.teams[league.id];
  useEffect(() => void loadTeams(league), [league]);
  const groups = useMemo(() => (collapses ? [{ id: league.id, members: [] as string[] }] : []), [collapses, league.id]);
  const outline = useOutline(`sports.${league.id}`, groups, EMPTY);
  const flag = useGroupFlag(outline, league.id);
  const failed = directory.failed.has(league.id);
  const rows = failed ? (
    <p className={styles.directoryNote}>
      Couldn't load {league.name}'s teams.{" "}
      <button type="button" className={styles.inlineButton} onClick={() => void loadTeams(league)}>
        Try Again
      </button>
    </p>
  ) : !options ? (
    <p className={styles.directoryNote} role="status">
      Loading teams…
    </p>
  ) : (
    <OutlineBox>
      <GroupBox>
        {options.map((option) => (
          <TeamRow key={option.id} option={option} league={league} />
        ))}
      </GroupBox>
    </OutlineBox>
  );
  if (!collapses) return rows;
  return (
    <div className={styles.directory}>
      <DisclosureHeader
        title={league.name}
        count={options?.length ?? 0}
        noun="team"
        open={flag.open}
        animated={flag.animating}
        onToggle={(keyboard) => outline.toggle(league.id, keyboard)}
        preview={<CrestStrip group={league.id} crests={(options ?? []).slice(0, 9).map((o) => ({ id: o.id, name: o.name, logo: o.logo }))} linking={flag.animating} />}
      />
      {flag.open ? rows : null}
    </div>
  );
}

const EMPTY: ReadonlySet<string> = new Set();
