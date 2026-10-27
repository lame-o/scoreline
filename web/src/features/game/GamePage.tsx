/**
 * A game's page (DetailView.swift): the hero, then the sport's sections in
 * one column, or from 680pt in two (data/sections.ts), with a docked
 * scorebar that settles in as the hero scrolls away.
 *
 * The core runs what every sport shares: the event and its detail by ID
 * (`useGame`: any game loads, not only the scoreboard's), the moment slot,
 * linked focus across charts, the hero's beats, the page's geometry. Each
 * sport is a hook in `SPORT_PAGES` (core/sport.tsx explains the seam) that
 * returns its sections and runs its own fast lane.
 */
import { Suspense, use, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useParams, useSearchParams } from "react-router";
import { Button, EmptyState, IconButton, PageHeader } from "../../design/components";
import { spokenStatus, scoreLine } from "../../data/format";
import { beatFinal, beatScore, beatScoreRose, finalAnnouncement, NO_BEATS, winner, type HeroBeats } from "../../data/matchRules";
import { decisive, scorer, Tier } from "../../data/moments";
import { stepsBack, type ScoreEvent } from "../../data/models";
import { arrangement, pageKind, sectionOrder, type PlacedSection } from "../../data/sections";
import { NEUTRAL, teamPalette, type TeamPalette } from "../../data/teamColors";
import { useColorScheme } from "../../state/theme";
import { useSplit, type NavState } from "../../app/layout";
import { useGoBack } from "../../app/navigation";
import { PageBack } from "../../app/PageBack";
import { useDocumentTitle } from "../../app/useDocumentTitle";
import { announce } from "./core/announce";
import { DockedScorebar } from "./core/DockedScorebar";
import { usePageGeometry, useRemeasure, useSurface } from "./core/geometry";
import { Hero, HeroSkeleton, HeroWash } from "./core/Hero";
import { LinkedFocusProvider, LinkedFocusStore } from "./core/linked";
import { MomentProvider, useCurrentMoment, useMomentSlot } from "./core/moments";
import type { GameContext, SportPage } from "./core/sport";
import { useGame, type GameData } from "./core/useGame";
import { EMPTY_DETAIL } from "../../data/gameDetail";
import { useWidth } from "../../design/useWidth";
import { nbaPalette } from "../../data/basketball";
import { ErrorCopy } from "../../design/components";
import { sportPage } from "./sportPages";
import styles from "./GamePage.module.css";

/** Two columns from 680pt of page, with 12pt of hysteresis (PanelLayout.resolve). */
const SPLIT_WIDTH = 680;

export function GamePage() {
  const { id: raw } = useParams();
  const id = raw ? decodeURIComponent(raw) : "";
  const [search] = useSearchParams();
  const split = useSplit();
  const goBack = useGoBack();
  // Beside the sidebar, the sidebar's list polls; on a phone this page does.
  const game = useGame(id, { poll: !split, league: search.get("league") });
  const event = game.event;
  useDocumentTitle(event ? statusLineShort(event) : null);

  const header = (
    <PageHeader
      className={styles.header}
      leading={<PageBack />}
      trailing={event?.link ? <IconButton icon="external" label="Open in Browser" onClick={() => window.open(event.link!, "_blank", "noopener,noreferrer")} /> : null}
    />
  );

  if (!event) {
    return (
      <div className={styles.page}>
        {header}
        {game.status === "loading" ? (
          <HeroSkeleton />
        ) : (
          <EmptyState
            icon="sportscourt"
            title="Game Not Found"
            message="This game isn't on any scoreboard Scoreline reads, and its source didn't answer."
            actions={<Button onClick={() => goBack()}>Back to Scores</Button>}
          />
        )}
      </div>
    );
  }
  // Each sport's page is its own chunk (sportPages.ts): until it's here, the page looks as it does while the game loads.
  return (
    <Suspense
      fallback={
        <div className={styles.page}>
          {header}
          <HeroSkeleton />
        </div>
      }
    >
      <GameBody key={`${event.id}|${pageKind(event.ref)}`} game={game} event={event} header={header} split={split} />
    </Suspense>
  );
}

/** "ARS 2–1 CHE (67')", "ARS v CHE": the game for a tab title. */
function statusLineShort(event: ScoreEvent): string {
  const line = scoreLine(event, true);
  return event.state === "live" ? `${line} (${event.detail ?? "Live"})` : line;
}

function GameBody({ game, event, header, split }: { game: GameData; event: ScoreEvent; header: ReactNode; split: boolean }) {
  const scheme = useColorScheme();
  const viaKeyboard = (useLocation().state as NavState | null)?.viaKeyboard === true;
  const moments = useMomentSlot();
  const linked = useMemo(() => new LinkedFocusStore(), []);
  useEffect(() => () => linked.dispose(), [linked]);
  const inner = useRef<HTMLDivElement>(null);
  const width = useWidth(inner, 400);
  const [columns, setColumns] = useState(false);
  const wide = width >= SPLIT_WIDTH - (columns ? 12 : 0);
  if (wide !== columns) setColumns(wide);
  const geometry = usePageGeometry(split);
  // The hero's beats: one value for the hero, the docked bar and the wash.
  const [beats, setBeats] = useState(NO_BEATS);
  // A field event's wash (a climber's flag), from its sport page.
  const [fieldWash, setFieldWash] = useState<TeamPalette | null>(null);

  // Esc drops a pin before it goes back (DetailView.back).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && linked.unpin()) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [linked]);

  const palette: TeamPalette = useMemo(
    () =>
      event.content.kind !== "match"
        ? { top: NEUTRAL, bottom: NEUTRAL }
        : // NBA and WNBA pages: a team wears its second color when the two clash (TeamPalette.nba).
          pageKind(event.ref) === "nba"
          ? nbaPalette(event.content.top, event.content.bottom, scheme)
          : teamPalette(event.content.top.color, event.content.bottom.color, scheme),
    [event.content, event.ref, scheme],
  );

  return (
    <article
      className={styles.page}
      data-entrance={viaKeyboard ? "none" : "stack"}
      ref={(el) => {
        geometry.root = el;
      }}
      onPointerLeave={() => linked.clear()}
    >
      <LinkedFocusProvider store={linked}>
        <MomentProvider slot={moments}>
          <div className={styles.washSlot}>
            <HeroWash palette={event.content.kind === "match" ? palette : fieldWash} intensity={event.content.kind === "match" ? 1 : 0.85} crossfade={event.content.kind === "field"} pulses={beats.washPulses} side={beats.washSide} />
          </div>
          <div
            ref={(el) => {
              geometry.header = el;
            }}
            className={styles.headerSlot}
          >
            {header}
          </div>
          <div className={styles.inner} ref={inner} data-columns={columns}>
            {/* The hero shows at once; the sections assemble when the detail arrives. */}
            <Loaded game={game} event={event} palette={palette} columns={columns} geometry={geometry} moments={moments} beats={beats} setBeats={setBeats} setFieldWash={setFieldWash} />
          </div>
        </MomentProvider>
      </LinkedFocusProvider>
    </article>
  );
}

function Loaded({ game, event, palette, columns, geometry, moments, beats, setBeats, setFieldWash }: {
  game: GameData;
  event: ScoreEvent;
  palette: TeamPalette;
  columns: boolean;
  geometry: ReturnType<typeof usePageGeometry>;
  moments: ReturnType<typeof useMomentSlot>;
  beats: HeroBeats;
  setBeats: React.Dispatch<React.SetStateAction<HeroBeats>>;
  setFieldWash: (wash: TeamPalette | null) => void;
}) {
  const detail = game.detail ?? EMPTY_DETAIL;
  const loading = game.detail == null;
  const live = event.state === "live";
  const top = event.content.kind === "match" ? event.content.top : null;
  const bottom = event.content.kind === "match" ? event.content.bottom : null;
  const context: GameContext = {
    event,
    detail,
    palette,
    names: { top: top?.abbreviation ?? "", bottom: bottom?.abbreviation ?? "" },
    spoken: { top: top?.name ?? "", bottom: bottom?.name ?? "" },
    live,
    split: columns,
    moments,
    geometry,
    leagueID: game.leagueID,
    refresh: game.refresh,
  };
  // A page's kind never changes while it's mounted (the body is keyed by event and kind), so this is always the same hook.
  const useSportPage = use(sportPage(pageKind(event.ref)));
  const sport: SportPage = useSportPage(context);

  // The hero's numbers (the lane's while it's ahead).
  const scores = { top: sport.laneScores?.top ?? top?.score ?? null, bottom: sport.laneScores?.bottom ?? bottom?.score ?? null };
  useBeatTriggers(event, scores, setBeats, sport.trophy != null);
  const washTop = sport.wash?.top ?? null;
  const washBottom = sport.wash?.bottom ?? null;
  useEffect(() => {
    setFieldWash(washTop && washBottom ? { top: washTop, bottom: washBottom } : null);
  }, [washTop, washBottom, setFieldWash]);
  const surface = useSurface(geometry);
  const fallback = sport.clockFallback ?? (event.detail?.toUpperCase() === "HT" ? "Half-time" : (event.detail ?? "Live"));

  // A field event's line from the page's own lane when it says something newer (the climbing leader).
  const fieldSummary = sport.fieldSummary;
  const heroEvent = useMemo(
    () => (fieldSummary && event.content.kind === "field" && event.content.summary !== fieldSummary ? { ...event, content: { ...event.content, summary: fieldSummary } } : event),
    [event, fieldSummary],
  );

  const shown = sectionOrder(event.ref, event.state).filter((s) => sport.sections[s] != null);
  const placed = arrangement(shown, event.ref, event.state, columns);
  useRemeasure(geometry, `${placed.map((p) => p.section).join()}|${columns}`);

  return (
    <>
      <div className={styles.heroSlot}>
        <Hero
          event={heroEvent}
          palette={event.content.kind === "match" ? palette : null}
          scores={scores}
          beats={beats}
          surface={surface}
          clockFallback={fallback}
          clock={sport.clock ?? event.clock}
          liveSecond={sport.heroSecond}
          possession={sport.possession ?? null}
          possessionInAir={sport.possessionInAir ?? false}
          chip={sport.heroChip ?? null}
          note={sport.heroNote ?? null}
          staleSince={game.staleSince}
          spoken={spokenHero(heroEvent, scores, fallback, sport.heroSpoken ?? null)}
          caption={event.caption ?? detail.roundName}
          trophy={sport.trophy ?? null}
          badge={sport.heroBadge ?? null}
          heroRef={(el) => {
            geometry.hero = el;
          }}
          tuckRef={(el) => {
            geometry.tuck = el;
          }}
        />
      </div>
      <DockedScorebar
        geometry={geometry}
        event={event}
        palette={event.content.kind === "match" ? palette : null}
        scores={scores}
        beats={beats}
        surface={surface}
        clockFallback={fallback}
        clock={sport.clock ?? event.clock}
        possession={sport.possession}
        possessionInAir={sport.possessionInAir ?? false}
        stale={game.staleSince != null}
        detail={sport.dockDetail}
        lead={sport.dockLead}
        chip={sport.chip ?? null}
        slot={sport.dockSlot}
      />
      {loading ? (
        game.detailFailed ? <p className={styles.note}>{ErrorCopy.inline("match details")}</p> : null
      ) : (
        <Sections placed={placed} sections={sport.sections} columns={columns} empty={emptyMessage(event)} />
      )}
      {detail.venue ? <p className={styles.venue}>{detail.venue}</p> : null}
    </>
  );
}

/**
 * The hero's beats: a score-tier moment, the hero's number rising, the final
 * whistle while the page is open (never when it opens on a final).
 */
function useBeatTriggers(event: ScoreEvent, scores: { top: string | null; bottom: string | null }, setBeats: React.Dispatch<React.SetStateAction<HeroBeats>>, trophy: boolean): void {
  const moment = useCurrentMoment();
  const seenMoment = useRef<string | null>(null);
  const lastScores = useRef(scores);
  const lastState = useRef(event.state);

  useEffect(() => {
    if (!moment || moment.tier !== Tier.score || seenMoment.current === moment.id) return;
    seenMoment.current = moment.id;
    setBeats((b) => {
      const next = beatScore(b, scorer(moment), decisive(moment), Date.now());
      // A climbing final decided: the trophy arrives with the gold.
      return decisive(moment) && moment.chart === "ascent" ? { ...next, trophies: next.trophies + 1 } : next;
    });
  }, [moment]);

  useEffect(() => {
    const was = lastScores.current;
    lastScores.current = scores;
    for (const side of ["top", "bottom"] as const) {
      const before = Number(was[side]);
      const now = Number(scores[side]);
      if (was[side] != null && scores[side] != null && Number.isFinite(before) && Number.isFinite(now) && now > before) {
        setBeats((b) => beatScoreRose(b, side, Date.now()));
      }
    }
  }, [scores.top, scores.bottom]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const was = lastState.current;
    lastState.current = event.state;
    if (was !== "live" || event.state !== "final") return;
    if (event.content.kind === "field") {
      // A field event: both sides of the wash (the flag's colors) lift.
      const summary = event.content.summary;
      setBeats((b) => beatFinal(b, null, true, trophy, Date.now()));
      announce(summary ? `Final. ${summary}` : "Final.");
      return;
    }
    const { top, bottom } = event.content;
    const side = winner(top, bottom, scores);
    setBeats((b) => beatFinal(b, side, false, trophy, Date.now()));
    announce(finalAnnouncement({ name: top.name, score: scores.top }, { name: bottom.name, score: scores.bottom }, side));
  }, [event.state]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** The sections in one column, or blocks of two columns with spans between them. */
function Sections({ placed, sections, columns, empty }: { placed: readonly PlacedSection[]; sections: SportPage["sections"]; columns: boolean; empty: string }) {
  if (placed.length === 0) return <p className={styles.empty}>{empty}</p>;
  if (!columns) {
    return (
      <div className={styles.sections}>
        {placed.map((p) => (
          <div key={p.section} className={styles.slot}>
            {sections[p.section]}
          </div>
        ))}
      </div>
    );
  }
  // Runs of left/right sections form a block; a span closes it.
  const blocks: { left: PlacedSection[]; right: PlacedSection[]; span: PlacedSection | null }[] = [];
  let current = { left: [] as PlacedSection[], right: [] as PlacedSection[], span: null as PlacedSection | null };
  for (const p of placed) {
    if (p.column === "span") {
      blocks.push({ ...current, span: p });
      current = { left: [], right: [], span: null };
    } else (p.column === "left" ? current.left : current.right).push(p);
  }
  if (current.left.length || current.right.length) blocks.push(current);
  return (
    <div className={styles.sections}>
      {blocks.map((b, i) => (
        <div key={i}>
          <div className={styles.columns}>
            <div className={styles.column}>
              {b.left.map((p) => (
                <div key={p.section} className={styles.slot}>
                  {sections[p.section]}
                </div>
              ))}
            </div>
            <div className={styles.column}>
              {b.right.map((p) => (
                <div key={p.section} className={styles.slot}>
                  {sections[p.section]}
                </div>
              ))}
            </div>
          </div>
          {b.span ? <div className={styles.slot}>{sections[b.span.section]}</div> : null}
        </div>
      ))}
    </div>
  );
}

function emptyMessage(event: ScoreEvent): string {
  const kind = event.ref?.kind;
  if (event.state === "scheduled") {
    if (kind === "counterStrike") return "Map picks appear before the match; rounds once it starts.";
    if (kind === "climbing") return "Results appear once the first round starts.";
    return "Stats and live data appear once the game starts.";
  }
  return event.state === "live" ? "Live details aren't available for this game yet." : "No further details for this game.";
}

/**
 * The hero in one sentence: "Brewers 10, Rays 1. Final. World Series, Game 3."
 * A heading, read when the page opens (DetailView.heroSpoken).
 */
function spokenHero(event: ScoreEvent, scores: { top: string | null; bottom: string | null }, clock: string, extra: string | null): string {
  if (event.content.kind !== "match") return event.content.title;
  const { top, bottom } = event.content;
  const parts: string[] = [];
  parts.push(scores.top != null && scores.bottom != null ? `${top.name} ${scores.top}, ${bottom.name} ${scores.bottom}` : `${top.name} versus ${bottom.name}`);
  if (event.state === "live") parts.push(spokenStatus(clock));
  else if (event.state === "final") {
    parts.push(spokenStatus(event.detail ?? "Final"));
    const won = stepsBack(event, bottom) ? top : stepsBack(event, top) ? bottom : null;
    if (won) parts.push(`${won.name} won`);
  } else parts.push(new Intl.DateTimeFormat(undefined, { weekday: "long", hour: "numeric", minute: "2-digit" }).format(event.start));
  if (event.caption) parts.push(event.caption);
  if (extra) parts.push(extra);
  return `${parts.join(". ")}.`;
}
