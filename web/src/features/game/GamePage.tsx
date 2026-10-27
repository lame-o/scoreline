/**
 * A game's page: for now the hero, a faithful start that later work builds
 * the per-sport page under (DetailView.swift `hero`). Glass over the teams'
 * colors, crests with a soft glow, the score (digits roll live), the status
 * (a ticking clock, a countdown, the final word), records and AP ranks, and
 * a star to follow each team. Below it, where to watch and the venue.
 *
 * The event comes from the scoreboard (so it stays live); a game that's
 * left the scoreboards says so until game pages fetch their own summary.
 */
import { useLocation, useParams } from "react-router";
import { BackButton, EmptyState, GlassCard, Icon, IconButton, LiveStatus, PageHeader, ScoreDigits, Skeleton, SectionTitle, TeamLogo, Button } from "../../design/components";
import { broadcaster } from "../../data/broadcasters";
import { countdown, countdownClock, dayAndTime, enDash, scoreLine, spokenStatus, spokenSummary } from "../../data/format";
import { dayKeyOf, mediumDayLabel } from "../../data/days";
import { eventSport, stepsBack, type Competitor, type ScoreEvent } from "../../data/models";
import { teamPalette, washStrength, NEUTRAL, type TeamPalette } from "../../data/teamColors";
import { useNow } from "../../state/clock";
import { useScoreboard } from "../../state/scores";
import { settings, useIsFollowing } from "../../state/settings";
import { useColorScheme } from "../../state/theme";
import { useSplit, type NavState } from "../../app/layout";
import { useGoBack } from "../../app/navigation";
import { useDocumentTitle } from "../../app/useDocumentTitle";
import styles from "./GamePage.module.css";

export function GamePage() {
  const { id: raw } = useParams();
  const id = raw ? decodeURIComponent(raw) : "";
  const scores = useScoreboard();
  const event = scores.event(id);
  const split = useSplit();
  const goBack = useGoBack();
  const scheme = useColorScheme();
  const viaKeyboard = (useLocation().state as NavState | null)?.viaKeyboard === true;
  // The tab says the game: "ARS 2–1 CHE (67')".
  useDocumentTitle(event ? statusLineShort(event) : null);

  const header = (
    <PageHeader
      leading={split ? null : <BackButton to="Scores" onClick={() => goBack()} />}
      trailing={event?.link ? <IconButton icon="external" label="Open in Browser" onClick={() => window.open(event.link!, "_blank", "noopener,noreferrer")} /> : null}
    />
  );

  if (!event) {
    return (
      <div className={styles.page}>
        {header}
        {scores.status === "loading" ? (
          <HeroSkeleton />
        ) : (
          <EmptyState
            icon="sportscourt"
            title="Game Not on the Scoreboard"
            message="This game isn't in your leagues' current scores. Game pages will soon load any game directly."
            actions={<Button onClick={() => goBack()}>Back to Scores</Button>}
          />
        )}
      </div>
    );
  }

  const palette = event.content.kind === "match" ? teamPalette(event.content.top.color, event.content.bottom.color, scheme) : null;
  return (
    <article className={styles.page} data-entrance={viaKeyboard ? "none" : "stack"} key={event.id}>
      <HeroWash palette={palette} />
      <div className={styles.inner}>
        {header}
        <div className={styles.heroWrap}>
          <GlassCard variant="clear">{event.content.kind === "match" && palette ? <MatchHero event={event} top={event.content.top} bottom={event.content.bottom} palette={palette} stale={scores.status === "offline"} /> : <FieldHero event={event} stale={scores.status === "offline"} />}</GlassCard>
        </div>
        <Details event={event} />
      </div>
    </article>
  );
}

/** "ARS 2–1 CHE (67')", "ARS v CHE": the game for a tab title. */
function statusLineShort(event: ScoreEvent): string {
  const line = scoreLine(event, true);
  return event.state === "live" ? `${line} (${event.detail ?? "Live"})` : line;
}

/** The team colors behind the page's top, melting into the page (HeroWash). Climbing: the accent, softly. */
function HeroWash({ palette }: { palette: TeamPalette | null }) {
  const left = palette?.top ?? "var(--accent)";
  const right = palette?.bottom ?? "var(--accent)";
  const intensity = palette ? 1 : 0.6;
  const strength = (c: string) => Math.round((c.startsWith("#") ? washStrength(c, intensity) : 0.6 * intensity) * 100);
  const mix = (c: string, pct: number) => `color-mix(in srgb, ${c === NEUTRAL ? "var(--viz-neutral)" : c} ${pct}%, transparent)`;
  const inner = Math.round(12 * intensity);
  return (
    <div className={styles.wash} aria-hidden="true">
      <div className={styles.washBase} />
      <div className={styles.washColors} style={{ background: `linear-gradient(to right, ${mix(left, strength(left))}, ${mix(left, inner)}, ${mix(right, inner)}, ${mix(right, strength(right))})` }} />
    </div>
  );
}

function MatchHero({ event, top, bottom, palette, stale }: { event: ScoreEvent; top: Competitor; bottom: Competitor; palette: TeamPalette; stale: boolean }) {
  const scored = top.score != null || bottom.score != null;
  return (
    <div className={styles.hero}>
      {/* The hero is the page's heading: one spoken summary. */}
      <h1 className="visually-hidden">{spokenSummary(event, eventSport(event), Date.now())}</h1>
      {event.caption ? <p className={styles.caption}>{event.caption}</p> : null}
      <div className={styles.scoreboard}>
        <TeamColumn event={event} c={top} color={palette.top} />
        <div className={styles.center}>
          {scored ? (
            <span className={styles.score}>
              <ScoreDigits value={top.score} live={event.state === "live"} dimmed={stepsBack(event, top)} />
              <span className={styles.dash}>–</span>
              <ScoreDigits value={bottom.score} live={event.state === "live"} dimmed={stepsBack(event, bottom)} />
            </span>
          ) : null}
          <HeroStatus event={event} stale={stale} />
        </div>
        <TeamColumn event={event} c={bottom} color={palette.bottom} />
      </div>
    </div>
  );
}

function TeamColumn({ event, c, color }: { event: ScoreEvent; c: Competitor; color: string }) {
  const following = useIsFollowing(c.id);
  const hasBall = event.state === "live" && event.possession != null && event.possession === c.id;
  const glow = color === NEUTRAL ? "var(--viz-neutral)" : color;
  const g = (pct: number) => `color-mix(in srgb, ${glow} ${pct}%, transparent)`;
  return (
    <div className={styles.team}>
      <span className={styles.crest}>
        <span
          className={styles.glow}
          style={{ background: `radial-gradient(circle, ${g(35)} 0%, ${g(33)} 25%, ${g(17)} 34%, ${g(5)} 42%, transparent 50%)` }}
          aria-hidden="true"
        />
        <TeamLogo url={c.logo} size={34} />
      </span>
      <span className={styles.nameLine}>
        {c.rank != null ? <span className={styles.rank}>{c.rank}</span> : null}
        <span className={[styles.name, stepsBack(event, c) ? styles.dimmed : null].filter(Boolean).join(" ")}>{c.name}</span>
        {hasBall ? <Icon name="football" size={8} className={styles.ball} label="Has the ball" /> : null}
        {c.id ? (
          <button
            type="button"
            className={styles.follow}
            aria-pressed={following}
            aria-label={following ? `Unfollow ${c.name}` : `Follow ${c.name}`}
            title={following ? `Unfollow ${c.name}` : `Follow ${c.name}`}
            onClick={() => settings.toggleFollow({ id: c.id!, name: c.name, logo: c.logo })}
          >
            <Icon name={following ? "star" : "starOutline"} size={9} />
          </button>
        ) : null}
      </span>
      {c.record ? <span className={styles.record}>{[enDash(c.record), c.conferenceRecord ? `${enDash(c.conferenceRecord)} conf` : null].filter(Boolean).join(" · ")}</span> : null}
    </div>
  );
}

/** Live: the dot and clock. Scheduled: a countdown inside a day, then the day and time. Final: the word and the date. */
function HeroStatus({ event, stale }: { event: ScoreEvent; stale: boolean }) {
  const soon = event.state === "scheduled" && event.start - Date.now() < 86_400_000;
  const now = useNow(soon ? 1000 : 30_000, event.state === "scheduled");
  switch (event.state) {
    case "live":
      return (
        <div className={styles.status}>
          <LiveStatus clock={event.clock} fallback={event.detail?.toUpperCase() === "HT" ? "Half-time" : (event.detail ?? "Live")} size={11.5} animated={!stale} />
          {event.liveLine ? <span className={styles.statusSecond}>{event.liveLine}</span> : null}
        </div>
      );
    case "scheduled": {
      const clock = countdownClock(event.start, now);
      return (
        <div className={styles.status}>
          {event.detail === "Delayed" && event.start < now ? (
            <span className={styles.finalWord} style={{ color: "var(--delayed-text)" }}>
              Delayed
            </span>
          ) : clock ? (
            <span className={styles.countdown}>Starts in {clock}</span>
          ) : (
            <span className={styles.countdown}>{countdown(event.start, now) ?? "Upcoming"}</span>
          )}
          <span className={styles.statusSecond}>{dayAndTime(event.start, now)}</span>
        </div>
      );
    }
    case "final":
      return (
        <div className={styles.status}>
          <span className={styles.finalWord}>{spokenStatus(event.detail ?? "Final")}</span>
          <span className={styles.statusSecond}>{mediumDayLabel(dayKeyOf(event.start))}</span>
        </div>
      );
  }
}

function FieldHero({ event, stale }: { event: ScoreEvent; stale: boolean }) {
  if (event.content.kind !== "field") return null;
  return (
    <div className={styles.fieldHero}>
      {event.caption ? <p className={styles.caption} style={{ padding: 0 }}>{event.caption}</p> : null}
      <h1 className={styles.fieldTitle}>{event.content.title}</h1>
      {event.content.summary ? <p className={styles.fieldSummary}>{event.content.summary}</p> : null}
      <div style={{ paddingTop: "calc(4 * var(--pt))" }}>
        <HeroStatus event={event} stale={stale} />
      </div>
    </div>
  );
}

/** Where to watch and where it's played; the rest of the page lands here next. */
function Details({ event }: { event: ScoreEvent }) {
  const networks = event.broadcast ? event.broadcast.split(" · ").map((n) => broadcaster(n)) : [];
  return (
    <div className={styles.sections}>
      {networks.length > 0 || event.venue ? (
        <section>
          <SectionTitle>Game</SectionTitle>
          <dl className={styles.facts}>
            {networks.length > 0 ? (
              <>
                <dt className={styles.factLabel}>Where to watch</dt>
                <dd style={{ margin: 0 }}>
                  {networks.map((b, i) => (
                    <span key={b.name}>
                      {i > 0 ? " · " : null}
                      {b.url ? (
                        <a className={styles.watch} href={b.url} target="_blank" rel="noopener noreferrer">
                          {b.name}
                        </a>
                      ) : (
                        b.name
                      )}
                    </span>
                  ))}
                </dd>
              </>
            ) : null}
            {event.venue ? (
              <>
                <dt className={styles.factLabel}>Venue</dt>
                <dd style={{ margin: 0 }}>{event.venue}</dd>
              </>
            ) : null}
          </dl>
        </section>
      ) : null}
      <p className={styles.note}>The full game page (live charts, plays, stats and tables for each sport) is on its way.</p>
    </div>
  );
}

function HeroSkeleton() {
  return (
    <div className={styles.heroWrap}>
      <GlassCard variant="clear">
        <div className={styles.hero} role="status" aria-label="Loading game">
          <Skeleton width={120} height={8} />
          <div className={styles.scoreboard} style={{ gap: "calc(40 * var(--pt))", padding: "calc(8 * var(--pt)) 0" }}>
            <Skeleton circle width={34} height={34} />
            <Skeleton width={70} height={24} />
            <Skeleton circle width={34} height={34} />
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
