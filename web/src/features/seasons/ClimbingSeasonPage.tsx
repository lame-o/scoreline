/**
 * The climbing season (ClimbingSeasonPage.swift): what's live or next, the
 * season on one axis by discipline, then every competition by month.
 * Competitions open in place (rounds, your countries' athletes, links); from
 * 680pt the list and the open competition sit side by side. Results mode is
 * `ClimbingResultsPage` (SeasonResultsViews.swift).
 *
 * Only the disciplines you follow appear (Settings → Climbing): untracked
 * lanes, categories and rounds are cut, a competition of only those is gone,
 * and nothing about them is fetched (`useClimbingSeasons`).
 *
 * Round times come from World Climbing's YouTube schedule on the Mac; the
 * web can't read it (not on the allowlist), so rounds say "Time TBA".
 */
import { AnimatePresence, LayoutGroup, m } from "motion/react";
import { useCallback, useMemo, useRef, useState } from "react";
import { EmptyState, ErrorState, type MenuEntry } from "../../design/components";
import { spring, tween } from "../../design/motion";
import { dayKeyOf } from "../../data/days";
import { climbingReadout, climbingSummary, byMonth, CLIMBING_LANES, nextEvent, previousSeasonOver, type SeasonAxis } from "../../data/seasons";
import { useNow } from "../../state/clock";
import { useClimbingCountries, useClimbingSeasons } from "../../state/seasons";
import { ScheduleHeader } from "../schedule/ScheduleHeader";
import type { SchedulePageProps } from "../schedule/SchedulePage";
import { ClimbingResultsPage } from "./ClimbingResults";
import { ClimbingEventDetail, ClimbingEventRow, useReducedMotion } from "./ClimbingRows";
import { useHoverStore } from "./hover";
import { MonthLabel, SeasonFooter, SeasonSkeleton } from "./parts";
import { SeasonCard, SeasonDockBar, scrollToTop, scrollUnderBar, useSeasonDock } from "./SeasonCard";
import { SeasonFrame, SplitColumns, stackIn, useArrival, useFocusOnArrival, useSeasonKeys, useSeasonWidth } from "./SeasonPage";
import styles from "./rows.module.css";

/** Session memory, as ScheduleStore keeps it: the season picked and the competitions opened. */
const memory = { season: null as string | null, expanded: new Set<string>(), selected: null as string | null };

export function ClimbingSeasonPage(props: SchedulePageProps) {
  return props.mode === "results" ? <ClimbingResultsPage {...props} /> : <ClimbingUpcoming {...props} />;
}

function ClimbingUpcoming({ scope, mode, onMode, switched, crossfade }: SchedulePageProps) {
  const root = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const hover = useHoverStore();
  const { split, width } = useSeasonWidth(root);
  const { entrance } = useArrival(switched);
  const reduce = useReducedMotion();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(memory.expanded));
  const [selectedID, setSelectedID] = useState<string | null>(memory.selected);
  const [chosen, setChosen] = useState<string | null>(memory.season);
  const [animating, setAnimating] = useState(false);
  const opened = useMemo(() => [...expanded, ...(selectedID ? [selectedID] : [])], [expanded, selectedID]);
  const data = useClimbingSeasons(opened);
  const countries = useClimbingCountries();
  const today = dayKeyOf(useNow(60_000));

  const season = chosen && data.seasons.includes(chosen) ? chosen : (data.defaultSeason ?? data.seasons[data.seasons.length - 1] ?? null);
  const events = useMemo(() => (season ? (data.bySeason[season] ?? []) : []), [data.bySeason, season]);
  const live = data.events.find((e) => e.status === "live") ?? null;
  const next = nextEvent(data.events.filter((e) => e.status === "upcoming"), Date.now());
  const selected = events.find((e) => e.id === (selectedID ?? live?.id ?? next?.id)) ?? events[0] ?? null;

  const summary = climbingSummary(live, next, previousSeasonOver(live, next, data.seasons, data.bySeason), today);
  const axis = useMemo<SeasonAxis>(() => {
    const present = new Set(events.flatMap((e) => e.lanes));
    const current = events.find((e) => e.status === "live") ?? events.find((e) => e.id === next?.id);
    return {
      events,
      lanes: CLIMBING_LANES.filter((l) => present.has(l.id)),
      today,
      next: live ? null : (next?.id ?? null),
      selected: split ? (selected?.id ?? null) : null,
      readouts: Object.fromEntries(events.map((e) => [e.id, climbingReadout(e)])),
      resting: current?.id ?? (split ? (selected?.id ?? null) : null),
    };
  }, [events, today.year, today.month, today.day, live?.id, next?.id, split, selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const months = useMemo(() => byMonth(events, (e) => e.startDay), [events]);
  const ids = useMemo(() => months.flatMap((g) => g.items.map((e) => e.id)), [months]);

  const toggle = useCallback(
    (id: string, open: boolean | undefined, viaKeyboard: boolean) => {
      setExpanded((current) => {
        const isOpen = current.has(id);
        const want = open ?? !isOpen;
        if (want === isOpen) return current;
        const nextSet = new Set(current);
        if (want) nextSet.add(id);
        else nextSet.delete(id);
        memory.expanded = nextSet;
        return nextSet;
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
      if (split) {
        memory.selected = id;
        setSelectedID(id);
      } else toggle(id, undefined, viaKeyboard);
    },
    [split, toggle],
  );

  const reveal = useCallback(
    (id: string) => {
      if (!events.some((e) => e.id === id)) return;
      if (split || !expanded.has(id)) select(id);
      const row = root.current?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`);
      if (row) scrollUnderBar(row, barRef.current?.parentElement?.parentElement ?? null, !reduce);
    },
    [events, split, expanded, select, reduce],
  );

  const onKeyDown = useSeasonKeys(root, { hover, ids, split, onSelect: (id) => select(id, true), onToggle: (id, open) => toggle(id, open, true) });
  useFocusOnArrival(root);
  const ready = data.status === "ready" && events.length > 0;
  useSeasonDock(cardRef, barRef, ready);

  const titleEntries: MenuEntry[] | undefined =
    data.seasons.length > 1
      ? data.seasons.map((name) => ({
          kind: "item" as const,
          label: `${name} Season`,
          checked: name === season,
          onSelect: () => {
            memory.season = name;
            setChosen(name);
          },
        }))
      : undefined;
  const more: MenuEntry[] = [
    { kind: "item", label: "Refresh", icon: "refresh", onSelect: data.refresh },
    { kind: "item", label: "Open ifsc.results.info", icon: "external", onSelect: () => window.open("https://ifsc.results.info/", "_blank", "noopener,noreferrer") },
  ];
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
                      <ClimbingEventDetail event={e} countries={countries} inline wide={width >= 460} />
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
      label="Climbing season"
      onKeyDown={onKeyDown}
      crossfade={crossfade}
      contentKey={mode}
      header={
        <ScheduleHeader scope={scope} mode={mode} onMode={onMode} title={season ? `${season} Season` : "Climbing Season"} titleEntries={titleEntries} more={more}>
          {ready ? <SeasonDockBar summary={summary} axis={axis} hover={hover} onSelect={reveal} barRef={barRef} onTop={() => scrollToTop(root.current, !reduce)} /> : null}
        </ScheduleHeader>
      }
      footer={<SeasonFooter updated={data.updated} stale={data.stale} loading={data.fetching} />}
    >
      {data.status === "loading" ? (
        <SeasonSkeleton />
      ) : events.length === 0 && data.status === "failed" ? (
        <ErrorState subject="Calendar" retriesAutomatically retrying={data.fetching} onRetry={data.refresh} />
      ) : events.length === 0 ? (
        <EmptyState icon="climbing" title="No Competitions" message={data.events.length === 0 && data.seasons.length > 0 ? "No competitions in the disciplines you follow. Choose them in Settings → Climbing." : "The next season's calendar isn't published yet."} />
      ) : (
        <>
          <div {...stackIn(entrance, 0)}>
            <SeasonCard cardRef={cardRef} summary={summary} axis={axis} hover={hover} onSelect={(id) => select(id)} />
          </div>
          {split ? (
            <SplitColumns
              list={list(false)}
              detail={selected ? <ClimbingEventDetail key={selected.id} event={selected} countries={countries} showsHeader wide={width / 2 >= 460} /> : null}
            />
          ) : (
            list(true)
          )}
        </>
      )}
    </SeasonFrame>
  );
}
