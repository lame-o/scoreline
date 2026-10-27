/**
 * The climbing season in results mode (SeasonResultsViews.swift
 * `ClimbingResultsPage`, `ClimbingResultsDetail`, `ClimbingCategoryBlock`):
 * finished competitions newest first, past seasons in the title menu, each
 * competition's podiums, your countries' best and its rounds in place; a
 * category's full results one level down.
 */
import { AnimatePresence, LayoutGroup, m } from "motion/react";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Button, EmptyState, ErrorState, type MenuEntry } from "../../design/components";
import { spring, tween } from "../../design/motion";
import { dayKeyOf, dayRangeLabel } from "../../data/days";
import { ordinal } from "../../data/format";
import { eventResultsPath, type RoundLink, type SeasonCategory, type SeasonEvent } from "../../data/schedule";
import { byMonth, CLIMBING_LANES, eventFlag, resultsSummary, type SeasonAxis } from "../../data/seasons";
import { categoryCanceled, roundEvent, winnerNames, winnerShortName, type CountryBest } from "../../data/seasonResults";
import { countryName, flagFromIOC } from "../../data/teams";
import { useNow } from "../../state/clock";
import { useClimbingCountries, useClimbingResults, useYours } from "../../state/seasons";
import { ScheduleHeader } from "../schedule/ScheduleHeader";
import type { SchedulePageProps } from "../schedule/SchedulePage";
import { ClimbingEventRow, useReducedMotion } from "./ClimbingRows";
import { useHoverStore } from "./hover";
import { climberPath, gamePath } from "./links";
import { LinkButton, MonthLabel, SectionLink, SeasonFooter, SeasonSkeleton, SubLabel } from "./parts";
import { SeasonCard, SeasonDockBar, scrollToTop, scrollUnderBar, useSeasonDock } from "./SeasonCard";
import { SeasonFrame, SplitColumns, stackIn, useArrival, useFocusOnArrival, useSeasonKeys, useSeasonWidth } from "./SeasonPage";
import styles from "./rows.module.css";

const memory = { season: null as string | null, expanded: new Set<string>(), selected: null as string | null };

/** "Santiago · Oct 23–25 · 🥇 Zhao, Deng, Utelli, Garnbret" */
function readoutText(e: SeasonEvent): string {
  const names = winnerNames(e);
  return [e.shortName, dayRangeLabel(e.startDay, e.endDay), e.status === "finished" ? (names.length === 0 ? "Finished" : `🥇 ${names.join(", ")}`) : "Upcoming"].join(" · ");
}

export function ClimbingResultsPage({ scope, mode, onMode, switched, crossfade }: SchedulePageProps) {
  const root = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const hover = useHoverStore();
  const { split, width } = useSeasonWidth(root);
  const { entrance } = useArrival(switched);
  const reduce = useReducedMotion();
  const [chosen, setChosen] = useState<string | null>(memory.season);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(memory.expanded));
  const [selectedID, setSelectedID] = useState<string | null>(memory.selected);
  const [animating, setAnimating] = useState(false);
  const data = useClimbingResults(chosen);
  const countries = useClimbingCountries();
  const today = dayKeyOf(useNow(60_000));
  const finished = data.finished;
  const selected = finished.find((e) => e.id === selectedID) ?? finished[0] ?? null;

  const summary = resultsSummary(data.season, finished.length, data.events.length);
  const axis = useMemo<SeasonAxis>(() => {
    const present = new Set(data.events.flatMap((e) => e.lanes));
    return {
      events: data.events,
      lanes: CLIMBING_LANES.filter((l) => present.has(l.id)),
      today,
      next: null,
      selected: split ? (selected?.id ?? null) : null,
      readouts: Object.fromEntries(data.events.map((e) => [e.id, readoutText(e)])),
      resting: split ? (selected?.id ?? null) : (finished[0]?.id ?? null),
    };
  }, [data.events, finished, split, selected?.id, today.year, today.month, today.day]); // eslint-disable-line react-hooks/exhaustive-deps

  const months = useMemo(() => byMonth(finished, (e) => e.startDay, true), [finished]);
  const ids = useMemo(() => months.flatMap((g) => g.items.map((e) => e.id)), [months]);

  const toggle = useCallback(
    (id: string, open: boolean | undefined, viaKeyboard: boolean) => {
      setExpanded((current) => {
        const isOpen = current.has(id);
        const want = open ?? !isOpen;
        if (want === isOpen) return current;
        const next = new Set(current);
        if (want) next.add(id);
        else next.delete(id);
        memory.expanded = next;
        return next;
      });
      if (!viaKeyboard && !reduce) {
        setAnimating(true);
        window.setTimeout(() => setAnimating(false), 450);
      }
    },
    [reduce],
  );
  const select = useCallback(
    (id: string, viaKeyboard = false) => {
      if (!finished.some((e) => e.id === id)) return;
      if (split) {
        memory.selected = id;
        setSelectedID(id);
      } else toggle(id, undefined, viaKeyboard);
    },
    [finished, split, toggle],
  );
  const reveal = useCallback(
    (id: string) => {
      if (!finished.some((e) => e.id === id)) return;
      if (split || !expanded.has(id)) select(id);
      const row = root.current?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`);
      if (row) scrollUnderBar(row, barRef.current?.parentElement?.parentElement ?? null, !reduce);
    },
    [finished, split, expanded, select, reduce],
  );

  const onKeyDown = useSeasonKeys(root, { hover, ids, split, onSelect: (id) => select(id, true), onToggle: (id, open) => toggle(id, open, true) });
  useFocusOnArrival(root);
  const ready = data.status === "ready" && finished.length > 0;
  useSeasonDock(cardRef, barRef, ready);

  const titleEntries: MenuEntry[] | undefined =
    data.menu.length > 1
      ? data.menu.map((name) => ({
          kind: "item" as const,
          label: `${name} Season`,
          checked: name === data.season,
          onSelect: () => {
            memory.season = name;
            memory.selected = null;
            setSelectedID(null);
            setChosen(name);
          },
        }))
      : undefined;
  const more: MenuEntry[] = [{ kind: "item", label: "Refresh", icon: "refresh", onSelect: data.refresh }];
  const textRoom = (split ? width / 2 : width) - 12 - 16 - 20 - 10 - 76 - 24;

  const list = (expandable: boolean) => (
    <LayoutGroup>
      {months.map((group, gi) => (
        <m.div key={`${group.month.year}-${group.month.month}`} layout={animating ? "position" : false} transition={spring.standard}>
          <MonthLabel month={group.month} {...stackIn(entrance, gi + 1)} />
          {group.items.map((e) => {
            const open = expandable ? expanded.has(e.id) : selected?.id === e.id;
            return (
              <div key={e.id} className={styles.rowWrap}>
                <ClimbingEventRow event={e} open={open} chevron={expandable} hover={hover} textRoom={textRoom} onSelect={select} />
                <AnimatePresence initial={false}>
                  {expandable && open ? (
                    <m.div key="detail" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: tween.exit }} transition={reduce ? tween.fade : tween.reveal}>
                      <ClimbingResultsDetail event={e} countries={countries} inline wide={width >= 460} />
                    </m.div>
                  ) : null}
                </AnimatePresence>
              </div>
            );
          })}
        </m.div>
      ))}
    </LayoutGroup>
  );

  return (
    <SeasonFrame
      rootRef={root}
      label="Climbing results"
      onKeyDown={onKeyDown}
      crossfade={crossfade}
      contentKey={mode}
      header={
        <ScheduleHeader scope={scope} mode={mode} onMode={onMode} title={data.season ? `${data.season} Season` : "Climbing Results"} titleEntries={titleEntries} more={more}>
          {ready ? <SeasonDockBar summary={summary} axis={axis} hover={hover} onSelect={reveal} barRef={barRef} onTop={() => scrollToTop(root.current, !reduce)} /> : null}
        </ScheduleHeader>
      }
      footer={<SeasonFooter updated={data.updated} stale={false} loading={data.fetching} subject="results" />}
    >
      {data.status === "loading" ? (
        <SeasonSkeleton label="Loading results" />
      ) : data.events.length === 0 && data.status === "failed" ? (
        <ErrorState subject="Results" onRetry={data.refresh} />
      ) : finished.length === 0 ? (
        <EmptyState icon="flag" title="No Results Yet" message={`No finished competitions in ${data.season ?? "this season"} yet.`} actions={<Button onClick={() => onMode("upcoming", false)}>Show Upcoming</Button>} />
      ) : (
        <>
          <div {...stackIn(entrance, 0)}>
            <SeasonCard cardRef={cardRef} summary={summary} axis={axis} hover={hover} onSelect={(id) => select(id)} />
          </div>
          {split ? (
            <SplitColumns list={list(false)} detail={selected ? <ClimbingResultsDetail key={selected.id} event={selected} countries={countries} showsHeader wide={width / 2 >= 460} /> : null} />
          ) : (
            list(true)
          )}
        </>
      )}
    </SeasonFrame>
  );
}

// MARK: - A finished competition, open

/** An open competition, finished: each category's podium, your countries' best, its rounds (each opens the match page). */
export function ClimbingResultsDetail({ event: e, countries, showsHeader = false, inline = false, wide = false }: { event: SeasonEvent; countries: readonly string[]; showsHeader?: boolean; inline?: boolean; wide?: boolean }) {
  const yours = useYours(e.detailed ? e : null, countries);
  const mine = useMemo(() => new Set(countries), [countries]);
  return (
    <div className={[styles.openDetail, inline ? styles.inline : null].filter(Boolean).join(" ")} style={{ gap: "calc(12 * var(--pt))" }}>
      {showsHeader ? (
        <div className={styles.detailHeader} style={{ paddingBottom: 0 }}>
          <h2 className={styles.detailTitle}>
            {eventFlag(e) ? <span className={styles.detailFlag} aria-hidden="true">{eventFlag(e)}</span> : null}
            <span>{e.shortName}</span>
          </h2>
          <p className={styles.meta}>{[e.place, dayRangeLabel(e.startDay, e.endDay)].filter(Boolean).join(" · ")}</p>
        </div>
      ) : null}
      {!e.detailed ? (
        <p className={styles.note} role="status">
          Loading results…
        </p>
      ) : e.categories.length === 0 ? (
        <p className={styles.note}>No results published.</p>
      ) : (
        <div className={[styles.categories, wide ? styles.categoriesWide : null].filter(Boolean).join(" ")}>
          {e.categories.map((c) => (
            <ClimbingCategoryBlock key={c.name} event={e} category={c} best={c.dcatID != null ? (yours[c.dcatID] ?? []) : []} countries={mine} />
          ))}
        </div>
      )}
      {e.link ? (
        <div className={styles.links}>
          <LinkButton title="ifsc.results.info" href={e.link} />
        </div>
      ) : null}
    </div>
  );
}

const MEDALS: Readonly<Record<number, string>> = { 1: "🥇", 2: "🥈", 3: "🥉" };

/** One category of a finished competition: "LEAD WOMEN · All Results ›", the podium, your countries, the rounds. */
const ClimbingCategoryBlock = memo(function ClimbingCategoryBlock({ event: e, category: c, best, countries }: { event: SeasonEvent; category: SeasonCategory; best: readonly CountryBest[]; countries: ReadonlySet<string> }) {
  const navigate = useNavigate();
  const canceled = categoryCanceled(c);
  const rounds = c.rounds.filter((r) => r.status === "finished" && r.resultPath);
  const winner = (round: RoundLink) => {
    const a = c.podiumAthletes.find((x) => x.rank === 1);
    return round.id === c.rounds[c.rounds.length - 1]?.id && a ? winnerShortName(a.first, a.last, a.country) : null;
  };
  const eventID = e.kind.kind === "climbing" ? e.kind.id : null;
  return (
    <div className={styles.category}>
      <div className={styles.categoryHead}>
        <SubLabel>{c.name}</SubLabel>
        {!canceled && c.dcatID != null && eventID != null ? (
          <SectionLink to={eventResultsPath({ kind: "climbing", eventID, dcatID: c.dcatID, category: c.name, eventName: e.shortName })} title={`Every athlete in ${c.name}`}>
            All Results
          </SectionLink>
        ) : null}
      </div>
      {c.podiumAthletes.length > 0 ? (
        c.podiumAthletes.map((a) => <AthleteLine key={a.athleteID} rank={a.rank} name={[a.first, a.last].filter(Boolean).join(" ")} country={a.country} id={a.athleteID} mine={a.country != null && countries.has(a.country)} />)
      ) : c.podium.length > 0 ? (
        <p className={[styles.note, styles.wrap2].join(" ")}>{c.podium.join(", ")}</p>
      ) : (
        <p className={styles.note}>{canceled ? "Canceled." : "No podium published."}</p>
      )}
      {/* Your countries' best below the podium, in the podium's grammar ("8th 🇺🇸 Ella Fisher"). */}
      {best.map((b) => (
        <AthleteLine key={b.athleteID} rank={b.rank} name={b.name} country={b.country} id={b.athleteID} mine />
      ))}
      {rounds.length > 0 ? (
        <div className={styles.roundLinks}>
          {rounds.map((r) => (
            <SectionLink
              key={r.id}
              title={`Open the ${c.name} ${r.name.toLowerCase()}`}
              onClick={() => {
                const ev = roundEvent(e, c.name, r, winner(r));
                if (ev) navigate(gamePath(ev.id), { state: { event: ev } });
              }}
            >
              {r.name}
            </SectionLink>
          ))}
        </div>
      ) : null}
    </div>
  );
});

/** "🥇 🇸🇮 Janja Garnbret"; off the podium, the place in words ("8th"). The name opens the climber's page. */
function AthleteLine({ rank, name, country, id, mine }: { rank: number; name: string; country: string | null; id: number; mine: boolean }) {
  return (
    <p className={styles.athlete} aria-label={[ordinal(rank), name, country ? countryName(country) : null, mine ? "Your country" : null].filter(Boolean).join(", ")}>
      {MEDALS[rank] ? (
        <span className={styles.medal} aria-hidden="true">
          {MEDALS[rank]}
        </span>
      ) : (
        <span className={styles.place} aria-hidden="true">
          {ordinal(rank)}
        </span>
      )}
      <span className={styles.athleteFlag} title={country ? countryName(country) : undefined} aria-hidden="true">
        {flagFromIOC(country) ?? ""}
      </span>
      <Link className={styles.athleteName} data-mine={mine} to={climberPath(id, name, country)}>
        {name}
      </Link>
    </p>
  );
}
