/**
 * A person (PlayerPage.swift): who they are, how they're playing this
 * season, their recent games and their career. Leads with this season (four
 * tiles, ranked where it means something), then the game-log strip, then the
 * sport's sections, the bio, career and the status note. One column, or two
 * from 680pt: what he's doing on the left, who he is on the right.
 *
 * The hero's photo is asked for at the hero's size from the first frame (the
 * link's thumbnail is never stretched), the monogram shows until it lands,
 * it fades in once, and it's never swapped while shown. As the hero scrolls
 * away, a compact glass bar docks under the header (DockedBar.tsx).
 *
 * The route is `/player/:id` ("nba-1966", "cs2-zywoo", "ifsc-1147"); a link
 * hands over the reference it had, so the hero paints at once.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "react-router";
import { EmptyState, ErrorState, GlassCard, IconButton } from "../../design/components";
import { competitors, type ScoreEvent } from "../../data/models";
import { aboutFacts, atLeast, COMPETITION_COLUMNS, dockDetail, dockStat, factsLine, seasonColumns, shortMonth, type WidthClass } from "../../data/profiles/display";
import { isCollege, isSupportedTeam, playerKey, playerMemoryKey, type InjuryNote, type PlayerRef } from "../../data/profiles/models";
import { initialHeroPhoto, nextHeroPhoto, photoCrop } from "../../data/profiles/photos";
import { playerFromRoute, type ProfileNavState } from "../../data/profiles/routes";
import { flagFromIOC, flagFromISO } from "../../data/teams";
import { isPhotoLoaded } from "../../state/profilePhotos";
import { usePageSession, usePlayerProfile, type PlayerView } from "../../state/profiles";
import { useScoreboard } from "../../state/scores";
import { useSplit } from "../../app/layout";
import { useDocumentTitle } from "../../app/useDocumentTitle";
import { DockedBarHost, PlayerDockBar } from "./DockedBar";
import { MapPoolBars } from "./ProfileCharts";
import { LinkOrigin, TeamLink } from "./ProfileLinks";
import { DetailSection, flagColors, Footnote, HeroGlow, lightInkOn, LiveStrip, ProfileHeader, ProfileWash, SectionColumns, StatTiles, TileSkeleton, tintOf, useProfileLayout, useTeamColors, type Slot } from "./ProfileParts";
import { PlayerPhoto } from "./PlayerPhoto";
import { AboutGrid, CareerSection, ClimbResultRows, FlowChips, GameLogSection, NoteView, PodiumRows, StatTableView } from "./PlayerSections";
import styles from "./Profile.module.css";

type Section = "season" | "gameLog" | "mapPool" | "podiums" | "results" | "note" | "competitions" | "table" | "about" | "career" | "awards";

const HERO_PHOTO = 76;

export function PlayerPage() {
  const { id: raw = "" } = useParams();
  const location = useLocation();
  const nav = (location.state as ProfileNavState | null) ?? null;
  const slug = decodeURIComponent(raw);
  const ref = useMemo<PlayerRef | null>(() => {
    const route = playerFromRoute(slug);
    if (!route) return null;
    // The link's reference when it's this person (it knows the name, photo and team): the hero paints at once.
    return nav?.player && playerKey(nav.player) === playerKey(route) ? nav.player : route;
  }, [slug, nav?.player]);
  if (!ref) return <NotAvailable />;
  return <PlayerViewPage key={playerKey(ref)} playerRef={ref} backTitle={nav?.from ?? "Scores"} viaKeyboard={nav?.viaKeyboard === true} />;
}

function NotAvailable({ retry }: { readonly retry?: () => void }) {
  const split = useSplit();
  useDocumentTitle("Player");
  return (
    <div className={styles.page}>
      <ProfileHeader split={split} backTitle="Scores" />
      {retry ? (
        <ErrorState subject="Player" onRetry={retry} />
      ) : (
        <EmptyState icon="sportscourt" title="Player Not Available" message="Scoreline doesn't have a page for this player yet." />
      )}
    </div>
  );
}

function PlayerViewPage({ playerRef: ref, backTitle, viaKeyboard }: { readonly playerRef: PlayerRef; readonly backTitle: string; readonly viaKeyboard: boolean }) {
  const split = useSplit();
  const memoryKey = playerMemoryKey(ref);
  const [session] = usePageSession(memoryKey);
  const player = usePlayerProfile(ref, { careerRequested: session.career });
  const { bio, profile, sport } = player;
  const team = bio.team ?? ref.team;
  const college = isCollege(ref);
  useDocumentTitle(bio.name || null);

  const teamColors = useTeamColors(sport === "climbing" ? null : team);
  const colors = sport === "climbing" ? flagColors(bio.country ?? ref.country) : teamColors;
  const tint = tintOf(colors);
  const lightInk = lightInkOn(tint);
  const crop = photoCrop(ref);

  // The hero's photo: one decoded at the hero's size draws at once; the bio's is taken only while the monogram shows.
  const [photo, setPhoto] = useState(() => initialHeroPhoto(ref, profile.bio?.photo ?? null, isPhotoLoaded));
  const bioPhoto = profile.bio?.photo ?? null;
  const firstBioPhoto = useRef(bioPhoto);
  useEffect(() => {
    if (bioPhoto === firstBioPhoto.current) return;
    firstBioPhoto.current = bioPhoto;
    setPhoto((current) => nextHeroPhoto(current, bioPhoto, isPhotoLoaded));
  }, [bioPhoto]);

  const inner = useRef<HTMLDivElement>(null);
  const heroWrap = useRef<HTMLDivElement>(null);
  const heroCard = useRef<HTMLDivElement>(null);
  const layout = useProfileLayout(inner);
  const scores = useScoreboard({ poll: !split });
  const live = useMemo(() => (team ? liveEventOf(scores.sections.flatMap((s) => s.events), team.id) : null), [scores.sections, team]);

  const loadedBio = profile.bio != null;
  const dockBar = useMemo(
    () => (
      <PlayerDockBar
        name={bio.name}
        photo={photo}
        crop={crop}
        tint={tint}
        lightInk={lightInk}
        detail={dockDetail(sport, bio, team, loadedBio, flagFromIOC)}
        stat={dockStat(profile.tiles)}
      />
    ),
    [bio, photo, crop, tint, lightInk, sport, team, loadedBio, profile.tiles],
  );

  const order: Section[] =
    sport === "esports" ? ["season", "gameLog", "mapPool", "about"]
      : sport === "climbing" ? ["season", "podiums", "results", "about"]
        : sport === "soccer" ? ["season", "gameLog", "competitions", "about"]
          : ["season", "gameLog", "note", "table", "about", "career", "awards"];
  const facts = useMemo(() => aboutFacts(bio, sport, college, profile), [bio, sport, college, profile]);
  const has = (s: Section): boolean => {
    switch (s) {
      case "season":
        return profile.tiles.length > 0 || !player.loaded;
      case "gameLog":
        return (profile.gameLog?.entries.length ?? 0) > 0;
      case "mapPool":
        return profile.mapPool.length > 0;
      case "podiums":
        return profile.podiums.length > 0 || profile.worldChampionships.length > 0;
      case "results":
        return profile.results.length > 0;
      case "note":
        return profile.note != null && (profile.note.published == null || Date.now() - profile.note.published < 14 * 86_400_000);
      case "competitions":
        return (profile.competitions?.rows.length ?? 0) > 0;
      case "table":
        return (profile.season?.rows.length ?? 0) > 0;
      case "about":
        return loadedBio && facts.length > 0;
      case "career":
        return sport !== "soccer" && sport !== "esports" && sport !== "climbing" && loadedBio;
      case "awards":
        return profile.awards.length > 0;
    }
  };
  const sections = order.filter(has);
  const slot = (s: Section): Slot => (s === "season" ? "span" : ["about", "career", "awards", "table"].includes(s) ? "right" : "left");

  const failedBio = player.loaded && !loadedBio;
  if (failedBio) return <NotAvailable retry={player.failed.has("bio") ? player.reload : undefined} />;

  const trailing = bio.link ? <IconButton icon="external" label="Open in Browser" onClick={() => window.open(bio.link!, "_blank", "noopener,noreferrer")} /> : null;
  return (
    <article className={styles.page} data-entrance={viaKeyboard ? "none" : "stack"}>
      <ProfileWash colors={colors} intensity={sport === "climbing" ? 0.85 : 1} />
      <ProfileHeader split={split} backTitle={backTitle} trailing={trailing} />
      <DockedBarHost hero={heroWrap} card={heroCard}>
        {dockBar}
      </DockedBarHost>
      <LinkOrigin name={bio.name || null}>
        <div className={styles.inner} ref={inner}>
          <div className={styles.heroWrap} ref={heroWrap}>
            <div className={styles.heroTuck} ref={heroCard}>
            <GlassCard variant="clear" className={styles.heroCard}>
              <h1 className="visually-hidden">{heroWords(player, ref, college)}</h1>
              <span className={styles.heroMedia} aria-hidden="true">
                <HeroGlow color={tint} diameter={94} />
                <PlayerPhoto url={photo} name={bio.name} tint={tint} size={HERO_PHOTO} crop={crop} lightInk={lightInk} priority />
              </span>
              <span className={styles.heroText}>
                <span className={styles.heroName} aria-hidden="true">
                  {bio.name || " "}
                </span>
                {bio.realName ? (
                  <span className={styles.heroReal} aria-hidden="true">
                    {bio.realName}
                  </span>
                ) : null}
                <IdentityLine player={player} playerRef={ref} />
                <FactsLine player={player} college={college} />
                {profile.injury ? <StatusLine injury={profile.injury} compact={!atLeast(layout.page, "medium")} /> : null}
              </span>
            </GlassCard>
            </div>
          </div>
          {live ? (
            <div className={styles.liveWrap}>
              <LiveStrip event={live} />
            </div>
          ) : null}
          <SectionColumns sections={sections} layout={layout} slot={slot} render={(s, width) => renderSection(s, width, player, ref, tint, memoryKey, college)} />
          {player.failed.has("gameLog") && profile.gameLog == null && sport !== "climbing" ? <Footnote text="Couldn't load the game log." onRetry={player.reload} /> : null}
        </div>
      </LinkOrigin>
    </article>
  );
}

function renderSection(s: Section, width: WidthClass, player: PlayerView, ref: PlayerRef, tint: string | null, memoryKey: string, college: boolean) {
  const { profile, sport, bio } = player;
  switch (s) {
    case "season":
      return (
        <DetailSection title={sport === "esports" ? "Form" : sport === "climbing" ? "World Cup" : "This Season"} caption={seasonCaption(player)}>
          {profile.tiles.length === 0 ? (
            <TileSkeleton />
          ) : (
            <>
              <StatTiles tiles={profile.tiles} rankSuffix={rankSuffix(sport, college)} width={width} />
              {lagging(player) ? <p className={styles.inlineNote}>Season averages update a few hours after each game.</p> : null}
            </>
          )}
        </DetailSection>
      );
    case "gameLog":
      return <GameLogSection player={player} playerRef={ref} width={width} tint={tint} memoryKey={memoryKey} />;
    case "mapPool":
      return (
        <DetailSection title="Map Pool" caption="Average bo3 rating per map, career. The line is his overall rating.">
          <MapPoolBars maps={profile.mapPool.slice(0, 9)} tint={tint} />
        </DetailSection>
      );
    case "podiums":
      return (
        <DetailSection title="Podiums" caption="World Cup podiums by discipline, then World Championships.">
          <PodiumRows podiums={profile.podiums} championships={profile.worldChampionships} />
        </DetailSection>
      );
    case "results":
      return (
        <DetailSection title="Results" caption={`${profile.resultCount} results on record, newest first.`}>
          <ClimbResultRows results={profile.results} count={profile.resultCount} memoryKey={memoryKey} />
        </DetailSection>
      );
    case "note":
      return (
        <DetailSection title="Latest" caption="From RotoWire.">
          <NoteView note={profile.note!} />
        </DetailSection>
      );
    case "competitions":
      return (
        <DetailSection title="All Competitions" caption="This season, club and country.">
          <StatTableView table={profile.competitions!} keys={COMPETITION_COLUMNS} width={width} titleWidth={140} />
        </DetailSection>
      );
    case "table":
      return (
        <DetailSection title="Season & Career" caption="This season and career, from ESPN.">
          <StatTableView table={profile.season!} keys={seasonColumns(sport, bio.positionAbbreviation)} width={width} />
        </DetailSection>
      );
    case "about":
      return (
        <DetailSection title="About" caption={sport === "esports" ? "From bo3.gg." : sport === "climbing" ? "From World Climbing (IFSC)." : "From ESPN."}>
          <AboutGrid facts={aboutFacts(bio, sport, college, profile)} />
        </DetailSection>
      );
    case "career":
      return (
        <DetailSection title="Career by Season" caption="Each season's line, from ESPN.">
          <CareerSection player={player} sport={sport} position={bio.positionAbbreviation} width={width} memoryKey={memoryKey} />
        </DetailSection>
      );
    case "awards":
      return (
        <DetailSection title="Awards" caption="Honors from ESPN.">
          <FlowChips items={profile.awards} />
        </DetailSection>
      );
  }
}

function seasonCaption(player: PlayerView): string | null {
  if (player.sport === "climbing") return "This season's World Cup ranks by discipline.";
  if (player.sport === "esports") return "bo3.gg's rating, and career kills, damage and headshots.";
  const caption = player.profile.tilesCaption;
  if (!caption) return null;
  // ESPN's "2026-27 Premier League Stats": a caption, not a title.
  const text = caption.endsWith(" Stats") ? `${caption.slice(0, -5)}stats` : caption;
  return `${text.slice(0, 1).toUpperCase()}${text.slice(1)}.`;
}

function rankSuffix(sport: PlayerView["sport"], college: boolean): string | null {
  switch (sport) {
    case "basketball":
      return "in the NBA";
    case "football":
      return college ? "in the FBS" : "in the NFL";
    case "baseball":
      return "in MLB";
    case "soccer":
      return "in the league";
    default:
      return null;
  }
}

/** The log has more games this season than the averages count (ESPN updates them hours later). */
function lagging(player: PlayerView): boolean {
  const log = player.profile.gameLog;
  if (!log || (player.sport !== "basketball" && player.sport !== "football")) return false;
  const regular = log.entries.filter((e) => !e.postseason && e.played).length;
  const season = player.profile.season;
  const i = season?.keys.indexOf("gamesPlayed") ?? -1;
  const gp = i >= 0 ? Number(season?.rows[0]?.values[i]) : NaN;
  return Number.isFinite(gp) && regular > gp;
}

/** "#15 · Quarterback · Chiefs" (the team is a link); "🇸🇮 Slovenia" for climbers. */
function IdentityLine({ player, playerRef: ref }: { readonly player: PlayerView; readonly playerRef: PlayerRef }) {
  const { bio, sport } = player;
  if (sport === "climbing") {
    const text = [flagFromIOC(bio.country ?? ref.country), bio.nationality].filter(Boolean).join(" ");
    return text ? (
      <span className={styles.heroSub} aria-hidden="true">
        {text}
      </span>
    ) : null;
  }
  // Long position names ("Designated Hitter") give way to their abbreviation.
  const position = (bio.position?.length ?? 0) > 12 ? (bio.positionAbbreviation ?? bio.position) : (bio.position ?? bio.positionAbbreviation);
  const parts = [bio.jersey ? `#${bio.jersey}` : null, position].filter(Boolean);
  const team = bio.team ?? ref.team;
  const loaded = player.profile.bio != null;
  if (parts.length === 0 && !team && !(loaded && sport !== "esports")) return null;
  return (
    <span className={styles.heroSub}>
      {parts.length > 0 ? <span aria-hidden="true">{parts.join(" · ") + (team || (loaded && sport !== "esports") ? " · " : "")}</span> : null}
      {team ? (
        isSupportedTeam(team) ? (
          <TeamLink team={team} className={styles.heroTeam}>
            {team.name}
          </TeamLink>
        ) : (
          <span>{team.name}</span>
        )
      ) : loaded && sport !== "esports" ? (
        <span aria-hidden="true">{bio.active ? "Free agent" : "Retired"}</span>
      ) : null}
    </span>
  );
}

/** "31 · 6′2″ · 225 lb"; college "Sophomore · 6′4″"; climbers "27 · 164 cm · Slovenj Gradec"; CS2 "🇫🇷 France · 25". */
function FactsLine({ player, college }: { readonly player: PlayerView; readonly college: boolean }) {
  const facts = factsLine(player.bio, player.sport, college, flagFromISO);
  return facts ? (
    <span className={styles.heroFacts} aria-hidden="true">
      {facts.text}
    </span>
  ) : null;
}

/** "Out · Hamstring · Expected back Nov 1"; narrow, "Out · Back Nov 1". */
function StatusLine({ injury, compact }: { readonly injury: InjuryNote; readonly compact: boolean }) {
  const back = injury.returnDate != null && injury.returnDate > Date.now() ? `Expected back ${new Date(injury.returnDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : null;
  const full = [injury.detail, back].filter((x): x is string => x != null);
  const parts = compact ? full.map((p) => shortMonth(p).replace("Expected back", "Back")).slice(-1) : full;
  const out = injury.status.toLowerCase().startsWith("out") || injury.status.includes("Reserve");
  return (
    <span className={styles.heroStatus} aria-hidden="true">
      <span className={out ? styles.statusOut : styles.statusWord}>{injury.status}</span>
      {parts.map((p) => ` · ${p}`).join("")}
    </span>
  );
}

/** The hero as one heading: "LeBron James, number 23, Forward, 76ers, 41 years old, 6 feet 9 inches, 250 pounds". */
function heroWords(player: PlayerView, ref: PlayerRef, college: boolean): string {
  const { bio, profile } = player;
  const team = bio.team ?? ref.team;
  const facts = factsLine(bio, player.sport, college, () => null);
  return [
    bio.name || "Player",
    bio.realName,
    player.sport === "climbing" ? bio.nationality : null,
    bio.jersey ? `number ${bio.jersey}` : null,
    bio.position ?? bio.positionAbbreviation,
    player.sport !== "climbing" ? team?.name : null,
    facts?.spoken,
    profile.injury ? [profile.injury.status, profile.injury.detail].filter(Boolean).join(", ") : null,
  ]
    .filter(Boolean)
    .join(", ");
}

function liveEventOf(events: readonly ScoreEvent[], teamID: string): ScoreEvent | null {
  return events.find((e) => e.state === "live" && competitors(e).some((c) => c.id === teamID)) ?? null;
}
