/**
 * Results deeper than a row (EventResultsPage.swift): a climbing category's
 * full ranking, or a CS2 tournament's placings and matches. Opened from the
 * season pages in results mode.
 *
 *   /results/climbing/:eventID/:dcatID?category=Lead%20Women&event=Santiago
 *   /results/tournament/:slug?name=ESL%20Pro%20League%20Season%2024
 */
import { AnimatePresence, m } from "motion/react";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { BackButton, ErrorState, Icon, IconButton, Menu, PageHeader, SectionTitle, type MenuEntry } from "../../design/components";
import { tween } from "../../design/motion";
import { useWidth } from "../../design/useWidth";
import { dayRangeLabel } from "../../data/days";
import { ordinal, plural } from "../../data/format";
import { itemEvent, type ScheduleItem, type SeasonEvent } from "../../data/schedule";
import { tracking } from "../../data/seasons";
import { displayName, lastScore, roundEvent, scoreIn, shownGroups, winnerShortName, type CategoryResults, type CategoryRound, type CategoryRow } from "../../data/seasonResults";
import { countryName, flagFromIOC } from "../../data/teams";
import { useSplit } from "../../app/layout";
import { useGoBack } from "../../app/navigation";
import { useDocumentTitle } from "../../app/useDocumentTitle";
import { useCategoryResults, useClimbingCountries, useTournamentResults } from "../../state/seasons";
import { useSettings } from "../../state/settings";
import { rowDetail, ScheduleRow } from "../schedule/ScheduleRow";
import rowStyles from "../schedule/ScheduleRow.module.css";
import { climberPath, gamePath, tournamentBracketPath, useFollowedCS } from "./links";
import { SectionLink, SeasonFooter, SeasonSkeleton, SubLabel } from "./parts";
import { ChampionCard, PlacementsTable } from "./placements";
import { stackIn, useArrival } from "./SeasonPage";
import styles from "./EventResults.module.css";

export function EventResultsPage() {
  const { pathname } = useLocation();
  return pathname.startsWith("/results/climbing") ? <ClimbingCategoryPage /> : <TournamentResultsDetailPage />;
}

function useBack() {
  const split = useSplit();
  const goBack = useGoBack();
  return split ? null : <BackButton to="Back" onClick={() => goBack()} />;
}

// MARK: - Climbing: a category's full results

/** A ranking shows 40 rows, then all (a few more never hide behind a button). */
const LIMIT = 40;

type Entry = { kind: "row"; row: CategoryRow; yours: boolean } | { kind: "boundary"; label: string; at: number } | { kind: "yoursBelow" };

/**
 * "Lead Women · Santiago": the rounds (each opens the match page), then every
 * athlete. Compact: the score from the last round each climbed, the field
 * dropping to the round before under a label. Wider: one column per round.
 */
function ClimbingCategoryPage() {
  const params = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const eventID = Number(params.eventID);
  const dcat = Number(params.dcatID);
  const root = useRef<HTMLDivElement>(null);
  const width = useWidth(root, 340);
  const wide = width >= 460;
  const { entrance } = useArrival(false);
  const [showAll, setShowAll] = useState(false);
  const disciplines = useSettings((s) => s.climbingDisciplines);
  const countries = useClimbingCountries();
  const mine = useMemo(() => new Set(countries), [countries]);
  const page = useCategoryResults(eventID, dcat);
  const results = page.results;
  const categories = (page.event ? tracking(page.event, disciplines)?.categories ?? [] : []).filter((c) => c.dcatID != null);
  const name = results?.category ?? categories.find((c) => c.dcatID === dcat)?.name ?? search.get("category") ?? "Results";
  const eventName = page.event?.shortName ?? search.get("event") ?? "";
  const title = eventName ? `${name} · ${eventName}` : name;
  useDocumentTitle(title);
  const back = useBack();

  // Another category of the same competition, in place: no Back step.
  const entries: MenuEntry[] = categories.map((c) => ({
    kind: "item" as const,
    label: c.name,
    checked: c.dcatID === dcat,
    onSelect: () => {
      if (c.dcatID == null || c.dcatID === dcat) return;
      setShowAll(false);
      navigate(`/results/climbing/${eventID}/${c.dcatID}?${new URLSearchParams({ category: c.name, event: eventName })}`, { replace: true, state: { viaKeyboard: true } });
    },
  }));

  const header = (
    <PageHeader
      leading={back}
      center={
        categories.length > 1 ? (
          <Menu
            label="Choose a category"
            heading
            align="center"
            triggerClassName={styles.titleTrigger}
            trigger={
              <>
                <span className={styles.titleText}>{title}</span>
                <Icon name="chevronDown" size={8} className={styles.titleChevron} />
              </>
            }
            entries={entries}
          />
        ) : (
          <h1 className={styles.titlePlain}>{title}</h1>
        )
      }
      trailing={<IconButton icon="refresh" label="Refresh" onClick={page.refresh} />}
      className={styles.header}
    />
  );

  return (
    <div ref={root} className={styles.page}>
      {header}
      <div className={styles.content} key={dcat}>
        {results ? (
          <>
            <p {...stackIn(entrance, 0, styles.summary)}>
              {[page.event ? dayRangeLabel(page.event.startDay, page.event.endDay) : null, plural(results.rows.length, "athlete"), results.status && results.status !== "finished" ? "In progress" : null].filter(Boolean).join(" · ")}
            </p>
            <Rounds results={results} event={page.event} entrance={entrance} />
            <Ranking results={results} wide={wide} mine={mine} showAll={showAll} onShowAll={() => setShowAll(true)} entrance={entrance} />
            {results.discipline === "speed" ? <p className={styles.footnote}>Final times in seconds. In brackets, the qualification time, which orders athletes out in the same round.</p> : null}
          </>
        ) : page.status === "failed" ? (
          <ErrorState subject="Results" onRetry={page.refresh} />
        ) : (
          <RankingSkeleton />
        )}
      </div>
      <SeasonFooter updated={page.updated} stale={false} loading={page.status === "loading"} subject="results" />
    </div>
  );
}

/** The category's rounds, latest first: each opens the match page. */
function Rounds({ results: r, event, entrance }: { results: CategoryResults; event: SeasonEvent | null; entrance: boolean }) {
  const navigate = useNavigate();
  const open = r.rounds.filter((x) => x.status !== "pending" && x.status !== "not_started" && x.resultPath);
  if (!event || open.length === 0) return null;
  const winner = (round: CategoryRound) => {
    const row = r.rows.find((x) => scoreIn(x, round.id)?.rank === 1);
    if (!row) return null;
    const space = row.name.indexOf(" ");
    return winnerShortName(space >= 0 ? row.name.slice(0, space) : "", space >= 0 ? row.name.slice(space + 1) : row.name, row.country);
  };
  return (
    <section {...stackIn(entrance, 1, styles.rounds)} aria-label="Rounds">
      <SectionTitle>Rounds</SectionTitle>
      <div className={styles.roundLinks}>
        {[...open].reverse().map((round) => (
          <SectionLink
            key={round.id}
            title={`Open the ${round.name.toLowerCase()}: ranking, wall and scorecards`}
            onClick={() => {
              const ev = roundEvent(event, r.category, { id: round.id, name: round.name, status: round.status, resultPath: round.resultPath }, winner(round));
              if (ev) navigate(gamePath(ev.id), { state: { event: ev } });
            }}
          >
            {round.name}
          </SectionLink>
        ))}
      </div>
    </section>
  );
}

function Ranking({ results: r, wide, mine, showAll, onShowAll, entrance }: { results: CategoryResults; wide: boolean; mine: ReadonlySet<string>; showAll: boolean; onShowAll: () => void; entrance: boolean }) {
  const all = showAll || r.rows.length <= LIMIT + 5;
  const entries = useMemo(() => {
    const shown = all ? r.rows : r.rows.slice(0, LIMIT);
    const out: Entry[] = [];
    let stage = shown[0]?.stage;
    shown.forEach((row, index) => {
      if (!wide && index > 0 && row.stage !== stage) {
        out.push({ kind: "boundary", label: row.stage, at: index });
        stage = row.stage;
      }
      out.push({ kind: "row", row, yours: row.country != null && mine.has(row.country) });
    });
    if (!all) {
      // Your countries' athletes further down stay in view.
      const below = r.rows.slice(LIMIT).filter((row) => row.country != null && mine.has(row.country));
      if (below.length > 0) {
        out.push({ kind: "yoursBelow" });
        for (const row of below) out.push({ kind: "row", row, yours: true });
      }
    }
    return out;
  }, [r, wide, mine, all]);
  const column = r.discipline === "speed" ? 78 : 58;
  const rounds = wide ? r.rounds : null;
  return (
    <section {...stackIn(entrance, 2, [styles.ranking, wide ? styles.rankingWide : null].filter(Boolean).join(" "))} aria-label="Ranking">
      <div className={styles.groupHeader} aria-hidden="true">
        <SubLabel>Ranking</SubLabel>
        <span className={styles.columns}>
          {rounds ? (
            rounds.map((x) => (
              <span key={x.id} style={{ width: `calc(${column} * var(--pt))` }}>
                {x.short}
              </span>
            ))
          ) : (
            <span>{r.rows[0]?.stage ?? ""}</span>
          )}
        </span>
      </div>
      <ol className={styles.rows}>
        {entries.map((entry) =>
          entry.kind === "row" ? (
            <RankingRow key={`a${entry.row.athleteID}`} row={entry.row} yours={entry.yours} rounds={rounds} column={column} />
          ) : entry.kind === "boundary" ? (
            <li key={`b${entry.at}`} className={styles.boundary} aria-hidden="true">
              <span className={styles.rule} />
              <SubLabel>{entry.label}</SubLabel>
            </li>
          ) : (
            <li key="yours" className={styles.yoursBelow} aria-hidden="true">
              <span>Your countries</span>
              <span className={styles.rule} />
            </li>
          ),
        )}
      </ol>
      <AnimatePresence initial={false}>
        {!showAll && r.rows.length > LIMIT + 5 ? (
          <m.div key="more" className={styles.more} exit={{ opacity: 0, transition: tween.exit }}>
            <button type="button" className={styles.moreButton} onClick={onShowAll}>
              Show All {r.rows.length}
            </button>
          </m.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}

/** One athlete: rank, flag, name (opens their page), and the score from the last round they climbed, or every round's when wide. */
const RankingRow = memo(function RankingRow({ row, yours, rounds, column }: { row: CategoryRow; yours: boolean; rounds: readonly CategoryRound[] | null; column: number }) {
  const last = lastScore(row);
  return (
    <li className={styles.row} data-yours={yours} data-wide={rounds != null} aria-label={row.spoken + (yours ? ", your country" : "")}>
      <span className={[styles.rank, row.rank != null && row.rank <= 3 ? styles.top : null].filter(Boolean).join(" ")} aria-hidden="true">
        {row.rankText}
      </span>
      <span className={styles.flag} title={row.country ? countryName(row.country) : undefined} aria-hidden="true">
        {flagFromIOC(row.country) ?? ""}
      </span>
      <Link className={styles.name} to={climberPath(row.athleteID, row.name, row.country)} title={row.name}>
        {row.name}
      </Link>
      <span className={styles.spacer} />
      {rounds ? (
        rounds.map((round) => {
          const s = scoreIn(row, round.id);
          const under = s ? (s.placing && !/^\d/.test(s.placing) ? s.placing : s.rank != null ? ordinal(s.rank) : " ") : " ";
          return (
            <span key={round.id} className={styles.cell} style={{ width: `calc(${column} * var(--pt))` }} aria-hidden="true">
              <span>{s?.score ?? " "}</span>
              <span className={styles.cellRank}>{under}</span>
            </span>
          );
        })
      ) : (
        <span className={styles.score} aria-hidden="true">
          {last?.score ?? "–"}
        </span>
      )}
    </li>
  );
});

/** Static rank rows while a ranking loads. */
function RankingSkeleton() {
  return (
    <div className={styles.skeleton} role="status" aria-label="Loading results">
      <span style={{ width: "calc(170 * var(--pt))", height: "calc(8 * var(--pt))", marginTop: "calc(8 * var(--pt))" }} />
      <span style={{ width: "calc(60 * var(--pt))", height: "calc(7 * var(--pt))", marginTop: "calc(20 * var(--pt))" }} />
      {Array.from({ length: 8 }, (_, row) => (
        <span key={row} className={styles.skeletonRow}>
          <span style={{ width: "calc(14 * var(--pt))" }} />
          <span style={{ width: "calc(12 * var(--pt))", borderRadius: "50%" }} />
          <span style={{ width: `calc(${110 + ((row * 37) % 60)} * var(--pt))` }} />
          <span style={{ width: "calc(30 * var(--pt))", marginLeft: "auto" }} />
        </span>
      ))}
    </div>
  );
}

// MARK: - CS2: a tournament's results

/** Placings shown before "Show All"; matches shown (whole rounds) before "Show All". */
const PLACINGS = 8;
const MATCHES = 16;

/** "ESL Pro League Season 24": the champion, the placings with prize money, and every match by round, newest first. Bracket › opens the tree. */
function TournamentResultsDetailPage() {
  const { slug: raw } = useParams();
  const slug = raw ? decodeURIComponent(raw) : "";
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const root = useRef<HTMLDivElement>(null);
  const width = useWidth(root, 340);
  const split = width >= 680;
  const { entrance } = useArrival(false);
  const followed = useFollowedCS();
  const [allPlacements, setAllPlacements] = useState(false);
  const [allMatches, setAllMatches] = useState(false);
  const page = useTournamentResults(slug);
  const t = page.tournament;
  const name = t?.event.name ?? search.get("name") ?? "Tournament";
  useDocumentTitle(displayName(name));
  const back = useBack();
  const bracket = t ? tournamentBracketPath(t.event, followed) : null;
  const onHover = useCallback(() => {}, []);

  const more: MenuEntry[] = [
    ...(bracket ? [{ kind: "item" as const, label: "Bracket", icon: "trophy" as const, onSelect: () => navigate(bracket) }] : []),
    ...(t?.event.link ? [{ kind: "item" as const, label: "Open in Browser", icon: "external" as const, onSelect: () => window.open(t.event.link!, "_blank", "noopener,noreferrer") }] : []),
    { kind: "separator" as const },
    { kind: "item" as const, label: "Refresh", icon: "refresh" as const, onSelect: page.refresh },
  ];

  const placements = t ? (
    <section {...stackIn(entrance, 1, styles.block)} aria-label="Placements">
      <SectionTitle trailing={page.matches > 0 && bracket ? <SectionLink to={bracket} title="Open the bracket">Bracket</SectionLink> : undefined}>Placements</SectionTitle>
      <div className={styles.blockBody}>
        {t.placements.length === 0 ? (
          <p className={styles.note}>Placings aren't published for this tournament.</p>
        ) : (
          (() => {
            // Beside the matches there's room for a 16-team field.
            const limit = split ? 16 : PLACINGS;
            const cut = allPlacements || t.placements.length <= limit + 2 ? t.placements.length : limit;
            return (
              <>
                <PlacementsTable placements={t.placements.slice(0, cut)} followed={followed} />
                {cut < t.placements.length ? (
                  <div className={styles.more}>
                    <button type="button" className={styles.moreButton} onClick={() => setAllPlacements(true)}>
                      Show All {t.placements.length}
                    </button>
                  </div>
                ) : null}
              </>
            );
          })()
        )}
      </div>
    </section>
  ) : null;

  const groups = shownGroups(page.groups, MATCHES, allMatches);
  const detail = rowDetail(split ? width / 2 - 12 : width - 12);
  const matches = (
    <section {...stackIn(entrance, 2, styles.matches)} aria-label="Matches">
      <div className={styles.matchesTitle}>
        <SectionTitle>Matches</SectionTitle>
      </div>
      {page.matchesStatus === "loading" ? (
        <p className={styles.note} role="status" style={{ padding: "calc(8 * var(--pt)) var(--gutter)" }}>
          Loading matches…
        </p>
      ) : page.groups.length === 0 ? (
        <p className={styles.note} style={{ padding: "calc(8 * var(--pt)) var(--gutter)" }}>
          {page.matchesStatus === "failed" ? "Couldn't load the matches." : "No matches listed for this tournament."}
        </p>
      ) : (
        <>
          {groups.map((g) => (
            <div key={g.id}>
              <SubLabel className={styles.groupTitle}>{g.title}</SubLabel>
              <div className={rowStyles.rows} data-detail={detail}>
                {g.items.map((item) => (
                  <MatchRow key={item.id} item={item} keyboard={false} detail={detail} onHover={onHover} />
                ))}
              </div>
            </div>
          ))}
          {groups.length < page.groups.length ? (
            <div className={styles.more}>
              <button type="button" className={styles.moreButton} onClick={() => setAllMatches(true)}>
                Show All {page.matches} Matches
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );

  return (
    <div ref={root} className={styles.page}>
      <PageHeader
        leading={back}
        title={displayName(name)}
        trailing={<Menu label="More" align="end" triggerClassName={styles.more28} trigger={<Icon name="ellipsis" size={12} />} entries={more} />}
        className={styles.header}
      />
      <div className={styles.content}>
        {t ? (
          split ? (
            // Split: who placed where on the left, how they got there on the right.
            <div className={styles.split}>
              <div>
                <div {...stackIn(entrance, 0, styles.cardWrap)}>
                  <ChampionCard tournament={t} final={page.final} />
                </div>
                {placements}
              </div>
              <div>{matches}</div>
            </div>
          ) : (
            <>
              <div {...stackIn(entrance, 0, styles.cardWrap)}>
                <ChampionCard tournament={t} final={page.final} />
              </div>
              {placements}
              {matches}
            </>
          )
        ) : page.status === "failed" ? (
          <ErrorState subject="Results" onRetry={page.refresh} />
        ) : (
          <SeasonSkeleton label="Loading results" />
        )}
      </div>
      <SeasonFooter updated={page.updated} stale={false} loading={page.status === "loading"} subject="results" />
    </div>
  );
}

/** A match as the scores list's row, its result read (a forfeit without bo3.gg's fake 1–0). */
const MatchRow = memo(function MatchRow({ item, keyboard, detail, onHover }: { item: ScheduleItem; keyboard: boolean; detail: ReturnType<typeof rowDetail>; onHover: (id: string) => void }) {
  const event = useMemo(() => itemEvent(item), [item]);
  return <ScheduleRow item={item} event={event} keyboard={keyboard} detail={detail} showsCompetition={false} onHover={onHover} />;
});
