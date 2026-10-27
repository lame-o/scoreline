/**
 * The tournaments page in results mode (SeasonResultsViews.swift
 * `TournamentResultsPage`, `TournamentResultRow`, `TournamentResultsSummary`):
 * finished S-tier tournaments newest first, six at a time, each with its
 * champion; a tournament opens its results page (or, from 680pt, shows
 * beside the list).
 */
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { EmptyState, ErrorState, Icon, SectionTitle, type MenuEntry } from "../../design/components";
import { dayKeyOf, dayRangeLabel } from "../../data/days";
import { eventResultsPath } from "../../data/schedule";
import { byMonth, S_TIER_LANE, tournamentResultsSummary, type SeasonAxis } from "../../data/seasons";
import { finishedSlug, type FinishedTournament } from "../../data/seasonResults";
import { useNow } from "../../state/clock";
import { useFinishedTournaments } from "../../state/seasons";
import { ScheduleHeader } from "../schedule/ScheduleHeader";
import type { SchedulePageProps } from "../schedule/SchedulePage";
import { useReducedMotion } from "./ClimbingRows";
import { useHoverStore, useLit, type HoverStore } from "./hover";
import { Badge, MonthLabel, partStyles, SectionLink, SeasonFooter, SeasonSkeleton, TournamentLogo } from "./parts";
import { ChampionCard, PlacementsTable } from "./placements";
import { SeasonCard, SeasonDockBar, scrollToTop, scrollUnderBar, useSeasonDock } from "./SeasonCard";
import { SeasonFrame, SplitColumns, stackIn, useArrival, useFocusOnArrival, useSeasonKeys, useSeasonWidth } from "./SeasonPage";
import { useFollowedCS } from "./links";
import styles from "./rows.module.css";

const memory = { selected: null as string | null };

const resultsPath = (t: FinishedTournament) => eventResultsPath({ kind: "tournament", slug: finishedSlug(t), name: t.event.name });

export function TournamentResultsPage({ scope, mode, onMode, switched, crossfade }: SchedulePageProps) {
  const navigate = useNavigate();
  const root = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const hover = useHoverStore();
  const { split } = useSeasonWidth(root);
  const { entrance } = useArrival(switched);
  const reduce = useReducedMotion();
  const followed = useFollowedCS();
  const [selectedID, setSelectedID] = useState<string | null>(memory.selected);
  const data = useFinishedTournaments();
  const today = dayKeyOf(useNow(60_000));
  const selected = data.items.find((t) => t.event.id === selectedID) ?? data.items[0] ?? null;

  const summary = tournamentResultsSummary(data.items.map((t) => t.event));
  const axis = useMemo<SeasonAxis>(
    () => ({
      events: data.items.map((t) => t.event),
      lanes: S_TIER_LANE,
      today,
      next: null,
      selected: split ? (selected?.event.id ?? null) : null,
      readouts: Object.fromEntries(data.items.map((t) => [t.event.id, [t.title, dayRangeLabel(t.event.startDay, t.event.endDay), t.summary?.split(" · ")[0]].filter(Boolean).join(" · ")])),
      resting: split ? (selected?.event.id ?? null) : (data.items[0]?.event.id ?? null),
    }),
    [data.items, split, selected?.event.id, today.year, today.month, today.day], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const months = useMemo(() => byMonth(data.items, (t) => t.event.startDay, true), [data.items]);
  const ids = useMemo(() => months.flatMap((g) => g.items.map((t) => t.event.id)), [months]);

  /** On the timeline or a row: beside the list (split), else its results page. */
  const open = useCallback(
    (id: string) => {
      const t = data.items.find((x) => x.event.id === id);
      if (!t) return;
      if (split) {
        memory.selected = id;
        setSelectedID(id);
      } else navigate(resultsPath(t));
    },
    [data.items, split, navigate],
  );
  const reveal = useCallback(
    (id: string) => {
      open(id);
      if (!split) return;
      const row = root.current?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`);
      if (row) scrollUnderBar(row, barRef.current?.parentElement?.parentElement ?? null, !reduce);
    },
    [open, split, reduce],
  );

  const onKeyDown = useSeasonKeys(root, {
    hover,
    ids,
    split,
    onSelect: (id) => {
      memory.selected = id;
      setSelectedID(id);
    },
    onActivate: (id) => {
      const t = data.items.find((x) => x.event.id === id);
      if (!t) return;
      if (split) setSelectedID(id);
      else navigate(resultsPath(t), { state: { viaKeyboard: true } });
    },
  });
  useFocusOnArrival(root);
  const ready = data.status === "ready" && data.items.length > 0;
  useSeasonDock(cardRef, barRef, ready);
  const more: MenuEntry[] = [{ kind: "item", label: "Refresh", icon: "refresh", onSelect: data.refresh }];

  const list = (
    <div>
      {months.map((group, gi) => (
        <div key={`${group.month.year}-${group.month.month}`}>
          <MonthLabel month={group.month} {...stackIn(entrance, gi + 1)} />
          {group.items.map((t) => (
            <TournamentResultRow key={t.event.id} tournament={t} followed={followed} hover={hover} selected={split && selected?.event.id === t.event.id} chevron={!split} onOpen={open} />
          ))}
        </div>
      ))}
      {data.more ? (
        <div className={styles.more}>
          <button type="button" className={styles.moreButton} onClick={data.loadMore} disabled={data.loadingMore}>
            {data.loadingMore ? "Loading…" : "Show Earlier"}
          </button>
        </div>
      ) : null}
    </div>
  );

  return (
    <SeasonFrame
      rootRef={root}
      label="Tournament results"
      onKeyDown={onKeyDown}
      crossfade={crossfade}
      contentKey={mode}
      header={
        <ScheduleHeader scope={scope} mode={mode} onMode={onMode} title="Tournaments" more={more}>
          {ready ? <SeasonDockBar summary={summary} axis={axis} hover={hover} onSelect={reveal} barRef={barRef} onTop={() => scrollToTop(root.current, !reduce)} /> : null}
        </ScheduleHeader>
      }
      footer={<SeasonFooter updated={data.updated} stale={data.stale} loading={data.status === "loading"} subject="results" />}
    >
      {data.status === "loading" ? (
        <SeasonSkeleton label="Loading results" />
      ) : data.items.length === 0 && data.status === "failed" ? (
        <ErrorState subject="Results" retriesAutomatically retrying={data.fetching} onRetry={data.refresh} />
      ) : data.items.length === 0 ? (
        <EmptyState icon="trophy" title="No Results" message="No finished S-tier tournaments yet." />
      ) : (
        <>
          <div {...stackIn(entrance, 0)}>
            <SeasonCard cardRef={cardRef} summary={summary} axis={axis} hover={hover} onSelect={open} />
          </div>
          {split ? <SplitColumns list={list} detail={selected ? <TournamentResultsSummary key={selected.event.id} tournament={selected} followed={followed} /> : null} /> : list}
        </>
      )}
    </SeasonFrame>
  );
}

/** "★ G2 12th–14th" */
function yoursLine(t: FinishedTournament, followed: ReadonlySet<string>): string | null {
  if (followed.size === 0) return null;
  const mine = t.placements.filter((p) => p.team.id != null && followed.has(p.team.id));
  return mine.length > 0 ? mine.map((p) => `★ ${p.team.name} ${p.place}`).join(" · ") : null;
}

/** A finished tournament: its name, "🏆 Vitality · 2nd MOUZ · $1M", and where your teams placed. */
export const TournamentResultRow = memo(function TournamentResultRow({
  tournament: t,
  followed,
  hover,
  selected,
  chevron,
  onOpen,
}: {
  tournament: FinishedTournament;
  followed: ReadonlySet<string>;
  hover: HoverStore;
  selected: boolean;
  chevron: boolean;
  onOpen: (id: string) => void;
}) {
  const lit = useLit(hover, t.event.id);
  const e = t.event;
  const yours = yoursLine(t, followed);
  const range = dayRangeLabel(e.startDay, e.endDay);
  const spoken = t.summary?.replace("🏆 ", "Won by ").replaceAll("–", " to ");
  return (
    <button
      type="button"
      className={partStyles.row}
      data-row-id={e.id}
      data-lit={lit}
      data-selected={selected}
      aria-label={[e.name, range, spoken, yours?.replaceAll("★ ", "")].filter(Boolean).join(", ")}
      title={e.name}
      onClick={() => onOpen(e.id)}
      onPointerEnter={(ev) => ev.pointerType === "mouse" && hover.set(e.id)}
      onPointerLeave={() => hover.leave(e.id)}
    >
      <TournamentLogo url={e.logo} size={20} />
      <span className={styles.text} aria-hidden="true">
        <span className={styles.titleLine}>
          <span className={styles.title}>
            <span>{t.title}</span>
          </span>
          {e.badge && !t.title.includes(e.badge) ? <Badge>{e.badge}</Badge> : null}
        </span>
        <span className={styles.detail}>{t.summary ?? "Results not published"}</span>
        {yours ? <span className={[styles.detail, styles.detailSmall, styles.wrap2].join(" ")}>{yours}</span> : null}
      </span>
      <span className={[styles.dates, styles.datesFinished].join(" ")} aria-hidden="true">
        {range}
      </span>
      {chevron ? <Icon name="chevronRight" size={9} className={partStyles.rowChevron} /> : null}
    </button>
  );
});

/** Beside the list (split): the champion, the placings, and the way to the full results. */
function TournamentResultsSummary({ tournament: t, followed }: { tournament: FinishedTournament; followed: ReadonlySet<string> }) {
  const path = resultsPath(t);
  return (
    <div className={styles.openDetail} style={{ gap: "calc(12 * var(--pt))", padding: "0 calc(10 * var(--pt))" }}>
      <h2 className={styles.detailTitle} style={{ padding: "0 calc(4 * var(--pt))" }}>
        <span>{t.title}</span>
      </h2>
      <ChampionCard tournament={t} final={null} />
      <div style={{ padding: "calc(4 * var(--pt)) calc(4 * var(--pt)) 0" }}>
        <SectionTitle trailing={<SectionLink to={path} title="Matches by round and the bracket">Full Results</SectionLink>}>Placements</SectionTitle>
        <div style={{ paddingTop: "calc(4 * var(--pt))" }}>
          {t.placements.length === 0 ? (
            <p className={styles.note}>Placings aren't published for this tournament.</p>
          ) : (
            <>
              <PlacementsTable placements={t.placements.slice(0, 12)} followed={followed} />
              {t.placements.length > 12 ? (
                <div className={styles.more} style={{ paddingTop: "calc(6 * var(--pt))" }}>
                  <SectionLink to={path}>{`All ${t.placements.length} Placings`}</SectionLink>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
