/**
 * A team (TeamPage.swift): who they are, their next game, the roster the way
 * the sport thinks of it, leaders, where they rank, the table around them,
 * injuries and moves. The match page's grammar: the team-color wash behind a
 * clear glass hero, sections in one column, or two from 680pt with the long
 * roster on the right (football's long rosters span both, groups two-up).
 *
 * The route is `/team/:id` (`?league=` for a club). A link hands over the
 * reference it had, so the hero paints the name and crest on the first frame;
 * each part fills in as it lands and fails on its own.
 */
import { useMemo, useRef } from "react";
import { useLocation, useParams, useSearchParams } from "react-router";
import { EmptyState, ErrorState, GlassCard, Icon, IconButton, Skeleton } from "../../design/components";
import { enDash, plural } from "../../data/format";
import { competitors, type ScoreEvent } from "../../data/models";
import { rankField } from "../../data/profiles/espn";
import { teamSport, type TeamRef } from "../../data/profiles/models";
import { teamFromRoute, type ProfileNavState } from "../../data/profiles/routes";
import { settings, useIsFollowing } from "../../state/settings";
import { useTeamProfile, type TeamProfile } from "../../state/profiles";
import { useScoreboard } from "../../state/scores";
import { useSplit } from "../../app/layout";
import { useOwnBackTitle } from "../../app/navigation";
import { useDocumentTitle } from "../../app/useDocumentTitle";
import { LinkOrigin } from "./ProfileLinks";
import { DetailSection, Footnote, HeroGlow, LiveStrip, ProfileHeader, ProfileWash, RosterSkeleton, SectionColumns, StatTiles, TeamCrest, tintOf, useProfileLayout, useTeamColors, lightInkOn, type Slot } from "./ProfileParts";
import { InjuryRows, LeadersGrid, NextGameRow, ResultsSection, RosterSection, StandingsWindow, TitleRows, TransactionRows } from "./TeamSections";
import { RankTrack } from "./ProfileCharts";
import type { WidthClass } from "../../data/profiles/display";
import { atLeast } from "../../data/profiles/display";
import styles from "./Profile.module.css";

type Section = "next" | "results" | "roster" | "leaders" | "stats" | "standings" | "injuries" | "transactions" | "titles" | "career";

export function TeamPage() {
  const { id: raw = "" } = useParams();
  const [search] = useSearchParams();
  const location = useLocation();
  const nav = (location.state as ProfileNavState | null) ?? null;
  const id = decodeURIComponent(raw);
  // The link's reference when it matches this page (it paints the hero at once); else one from the path.
  const ref = useMemo<TeamRef | null>(() => {
    const fromLink = nav?.team?.id === id ? nav.team : null;
    const fromRoute = teamFromRoute(id, search);
    return fromLink ? { ...fromLink, league: fromLink.league ?? fromRoute?.league ?? null } : fromRoute;
  }, [id, nav?.team, search]);
  if (!ref || teamSport(ref) == null) return <Unsupported />;
  return <TeamView key={ref.id} teamRef={ref} viaKeyboard={nav?.viaKeyboard === true} />;
}

function Unsupported() {
  const split = useSplit();
  useDocumentTitle("Team");
  return (
    <div className={styles.page}>
      <ProfileHeader />
      <EmptyState icon="star" title="No Page for This Team" message="Scoreline has pages for NFL, college football, MLB, NBA, soccer and CS2 teams." />
    </div>
  );
}

function TeamView({ teamRef: ref, viaKeyboard }: { readonly teamRef: TeamRef; readonly viaKeyboard: boolean }) {
  const split = useSplit();
  const team = useTeamProfile(ref);
  const inner = useRef<HTMLDivElement>(null);
  const layout = useProfileLayout(inner);
  const header = team.header;
  const name = header?.name ?? (ref.name || null);
  const shortName = header?.shortName ?? (ref.name || "Team");
  useDocumentTitle(name);
  // Pages this one opens say "‹ Chiefs" (the same name its links carry, LinkOrigin).
  useOwnBackTitle(shortName);
  const colors = useTeamColors(team.team, header);
  const tint = tintOf(colors);
  const scores = useScoreboard({ poll: !split });
  const live = useMemo(() => liveEventOf(scores.sections.flatMap((s) => s.events), ref.id), [scores.sections, ref.id]);
  const following = useIsFollowing(ref.id);
  const sport = team.sport;

  const order: Section[] = sport === "esports" ? ["next", "results", "roster", "career", "titles"] : ["next", "results", "roster", "leaders", "stats", "standings", "injuries", "transactions"];
  const injured = useMemo(() => injuredOf(team), [team]);
  const has = (s: Section): boolean => {
    switch (s) {
      case "next":
        return team.next != null;
      case "results":
        return (team.results?.length ?? 0) > 0;
      case "roster":
        return team.groups.length > 0 || !team.rosterLoaded;
      case "leaders":
        return team.leaders.length >= 2;
      case "stats":
        return team.stats.some((x) => x.rank != null);
      case "standings":
        return team.standings != null;
      case "injuries":
        return injured.length > 0;
      case "transactions":
        return team.transactions.length > 0;
      case "titles":
        return team.titles.length > 0;
      case "career":
        return team.career.length > 0;
    }
  };
  // A football roster (50 to 120 players) would run thousands of points down one column: it spans both, last.
  const rosterSpans = layout.split && sport === "football";
  const shown = order.filter(has);
  const sections = rosterSpans ? [...shown.filter((s) => s !== "roster"), ...shown.filter((s) => s === "roster")] : shown;
  const slot = (s: Section): Slot => {
    if (s === "roster" && rosterSpans) return "span";
    const right: Section[] = rosterSpans ? ["injuries", "transactions"] : ["roster", "injuries"];
    return right.includes(s) ? "right" : "left";
  };

  const trailing = (
    <>
      <IconButton
        icon={following ? "star" : "starOutline"}
        label={following ? `Unfollow ${shortName}` : `Follow ${shortName}`}
        active={following}
        className={following ? styles.followOn : undefined}
        onClick={() => settings.toggleFollow({ id: ref.id, name: shortName, logo: header?.logo ?? ref.logo })}
      />
      {header?.link ? <IconButton icon="external" label="Open in Browser" onClick={() => window.open(header.link!, "_blank", "noopener,noreferrer")} /> : null}
    </>
  );

  const failedEverything = team.loaded && header == null && team.groups.length === 0;
  return (
    <article className={styles.page} data-entrance={viaKeyboard ? "none" : "stack"}>
      <ProfileWash colors={colors} />
      <ProfileHeader trailing={trailing} />
      <LinkOrigin name={shortName}>
        <div className={styles.inner} ref={inner}>
          <div className={styles.heroWrap}>
            <GlassCard variant="clear" className={styles.heroCard}>
              <h1 className="visually-hidden">{[name ?? "Team", summaryWords(team)].filter(Boolean).join(", ")}</h1>
              <span className={styles.heroMedia} aria-hidden="true">
                <HeroGlow color={tint} diameter={60} />
                {header || ref.logo || team.loaded ? (
                  <TeamCrest team={{ logo: header?.logo ?? ref.logo, abbreviation: header?.abbreviation ?? ref.abbreviation }} size={46} />
                ) : (
                  // A page opened from its URL: a quiet disc until the crest is known.
                  <Skeleton circle width={46} height={46} />
                )}
              </span>
              <span className={styles.heroText} aria-hidden="true">
                <span className={styles.heroNameLine}>
                  {name ? <span className={styles.heroName}>{name}</span> : <Skeleton width={150} height={14} className={styles.heroSkeleton} />}
                  {following ? <Icon name="star" size={8} className={styles.heroStar} /> : null}
                </span>
                {summaryLine(team)}
                {header?.coach ? <span className={styles.heroCoach}>{`${sport === "baseball" ? "Manager" : "Coach"} ${header.coach}`}</span> : null}
              </span>
            </GlassCard>
          </div>
          {live ? (
            <div className={styles.liveWrap}>
              <LiveStrip event={live} />
            </div>
          ) : null}
          {failedEverything ? (
            <ErrorState subject="Team" onRetry={team.reload} />
          ) : (
            <SectionColumns sections={sections} layout={layout} slot={slot} render={(s, width) => renderSection(s, width, team, tint, lightInkOn(tint), ref, rosterSpans, injured)} />
          )}
          <TeamFooter team={team} />
        </div>
      </LinkOrigin>
    </article>
  );
}

function renderSection(s: Section, width: WidthClass, team: TeamProfile, tint: string | null, lightInk: boolean, ref: TeamRef, rosterSpans: boolean, injured: TeamProfile["groups"][number]["players"]) {
  const sport = team.sport;
  switch (s) {
    case "next": {
      const game = team.next!;
      return (
        <DetailSection title={game.state === "final" ? "Last Game" : game.state === "live" ? "Now" : "Next"} accessory={game.state === "live" ? "live" : undefined}>
          <NextGameRow game={game} />
        </DetailSection>
      );
    }
    case "results":
      return <ResultsSection results={team.results ?? []} form={team.form} sport={sport} />;
    case "roster":
      return (
        <DetailSection title={sport === "soccer" ? "Squad" : sport === "esports" ? "Players" : "Roster"} caption={rosterCaption(sport)}>
          {team.groups.length === 0 ? <RosterSkeleton /> : <RosterSection team={team} width={width} tint={tint} lightInk={lightInk} memoryKey={`team:${ref.id}`} columns={rosterSpans ? 2 : 1} />}
        </DetailSection>
      );
    case "leaders":
      return (
        <DetailSection title="Leaders" caption={sport === "basketball" ? "Per game." : sport === "baseball" ? "Regular season." : "This season."}>
          <LeadersGrid leaders={team.leaders} tint={tint} lightInk={lightInk} width={width} />
        </DetailSection>
      );
    case "stats": {
      const ranked = team.stats.filter((x) => x.rank != null).slice(0, atLeast(width, "large") ? 8 : 6);
      return (
        <DetailSection title="Team Stats" caption="Where they rank in the league this season.">
          <div>
            {ranked.map((stat) => (
              <RankTrack key={stat.key} stat={stat} field={rankField(sport)} tint={tint} />
            ))}
          </div>
        </DetailSection>
      );
    }
    case "standings":
      return (
        <DetailSection title={sport === "soccer" ? "Table" : ref.id.startsWith("espn-ncaaf-") ? "Conference" : "Standings"} caption="Official table from ESPN. New results can take a few minutes.">
          <StandingsWindow window={team.standings!} teamID={ref.id} sport={sport} width={width} league={team.team.league} />
        </DetailSection>
      );
    case "injuries":
      return (
        <DetailSection title="Injury Report" caption="Game-week statuses from ESPN.">
          <InjuryRows players={injured} />
        </DetailSection>
      );
    case "transactions":
      return (
        <DetailSection title="Transactions" caption="Signings, trades and releases from ESPN.">
          <TransactionRows transactions={team.transactions} memoryKey={`team:${ref.id}`} />
        </DetailSection>
      );
    case "titles":
      return (
        <DetailSection title="Titles" caption={`${plural(team.titles.length, "tournament win")} on record.`}>
          <TitleRows titles={team.titles} />
        </DetailSection>
      );
    case "career":
      return (
        <DetailSection title="Record" caption="Every match bo3.gg has tracked.">
          <StatTiles tiles={team.career} width={width} />
        </DetailSection>
      );
  }
}

function rosterCaption(sport: TeamProfile["sport"]): string | null {
  switch (sport) {
    case "basketball":
      return "Per-game averages this season.";
    case "football":
      return "Season totals. Starters first at each position.";
    case "baseball":
      return "Regular-season stats.";
    case "soccer":
      return "League appearances, goals and assists.";
    case "esports":
      return "Each player's bo3.gg rating over six months.";
    default:
      return null;
  }
}

/** "3–0 · 1st in Pacific Division"; CS2 "World #3 · ▲ 2", the arrow green or red as in the standings. */
function summaryLine(team: TeamProfile) {
  const h = team.header;
  if (!h) return team.loaded ? null : <Skeleton width={130} height={9} className={styles.heroSkeleton} />;
  if (h.rank != null) {
    const change = h.rankChange ?? 0;
    return (
      <span className={styles.heroSummary}>
        {`World #${h.rank}`}
        {change !== 0 ? (
          <>
            {" · "}
            <span className={change > 0 ? styles.rankUp : styles.rankDown}>{change > 0 ? "▲" : "▼"}</span>
            {` ${Math.abs(change)}`}
          </>
        ) : null}
      </span>
    );
  }
  const text = [h.record ? enDash(h.record) : null, h.standing].filter(Boolean).join(" · ");
  return text ? <span className={styles.heroSummary}>{text}</span> : null;
}

function summaryWords(team: TeamProfile): string | null {
  const h = team.header;
  if (!h) return null;
  if (h.rank != null) {
    const change = h.rankChange ?? 0;
    return change === 0 ? `World number ${h.rank}` : `World number ${h.rank}, ${change > 0 ? "up" : "down"} ${Math.abs(change)}`;
  }
  return [h.record, h.standing, h.coach ? `${team.sport === "baseball" ? "Manager" : "Coach"} ${h.coach}` : null].filter(Boolean).join(", ") || null;
}

/** NBA's Out group already lists who's out; football's IR group its long-term injuries. */
function injuredOf(team: TeamProfile) {
  if (team.sport !== "football" && team.sport !== "basketball") return [];
  const statuses = new Set(["Out", "Questionable", "Doubtful", "Day-To-Day"]);
  return team.groups
    .filter((g) => !["out", "injuredReserve", "practiceSquad"].includes(g.kind))
    .flatMap((g) => g.players)
    .filter((p) => statuses.has(p.injury ?? ""));
}

function liveEventOf(events: readonly ScoreEvent[], teamID: string): ScoreEvent | null {
  return events.find((e) => e.state === "live" && competitors(e).some((c) => c.id === teamID)) ?? null;
}

function TeamFooter({ team }: { readonly team: TeamProfile }) {
  const failures = team.header
    ? [team.failed.has("roster") ? "the roster" : null, team.failed.has("leaders") ? "leaders" : null, team.failed.has("stats") ? "team stats" : null].filter(Boolean)
    : [];
  const list = failures.length > 1 ? `${failures.slice(0, -1).join(", ")} or ${failures.at(-1)}` : failures[0];
  const venue = team.header?.venue ? [team.header.venue, team.header.city].filter(Boolean).join(" · ") : null;
  return (
    <>
      {list ? <Footnote text={`Couldn't load ${list}.`} onRetry={team.reload} /> : null}
      {venue ? <p className={styles.venue}>{venue}</p> : null}
    </>
  );
}

