/**
 * Results (ResultsPage.swift `ResultsAgendaPage`): the schedule page facing
 * back in time. One round at a time for a league (a matchweek, a cup's
 * stage block, a football week: the round picker), one day at a time for
 * everything or a daily league (the week strip), newest first for a team
 * (its season card and results) or your teams. Same header, scopes and rows
 * as Upcoming; rounds swap in place from the cache and never animate.
 *
 * Keyboard: ↑/↓ through the rows, ←/→ the round before or after, Return
 * opens, T the latest round, ⌥1 faces Upcoming.
 */
import { useQueries } from "@tanstack/react-query";
import { Fragment, useCallback, useMemo, useRef, type CSSProperties } from "react";
import { useLocation, useNavigate } from "react-router";
import { Button, EmptyState, ErrorState, SectionTitle, type MenuEntry } from "../../design/components";
import { useWidth } from "../../design/useWidth";
import { addingDays, dayID, dayKeyOf, monthYearLabel, type DayKey } from "../../data/days";
import { filterable, type AgendaDay } from "../../data/agenda";
import { leagueWithID } from "../../data/leagues";
import { teamSource } from "../../data/providers/schedule";
import { itemTeams, scopeKey, type ResultRound, type ScheduleItem, type ScheduleTeamRef, type TeamSeason } from "../../data/schedule";
import { loadTeamSeason, scheduleSession, seasonChoices, useScheduleSession } from "../../state/schedule";
import { settings, useSettings } from "../../state/settings";
import type { NavState } from "../../app/layout";
import { AgendaFooter, AgendaSkeleton, DayHeader, GroupLabel, MoreButton, Note } from "./AgendaParts";
import { useLiveEvents } from "./live";
import { useChromeHeight, useHighlight, useRowKeys, type Highlight } from "./pageHooks";
import { PeriodPicker, WeekStrip } from "./ScheduleNavigators";
import { ScheduleHeader, ScopeChips, useScheduleNav, useScopeChips } from "./ScheduleHeader";
import { rowDetail, ScheduleRow, type RowDetail } from "./ScheduleRow";
import { RoundsList, TeamResultRow, TeamSeasonCard } from "./ResultRows";
import type { SchedulePageProps } from "./SchedulePage";
import { resultsNavigation, roundSections, stripStart, useResults, weekStep } from "./useAgenda";
import rowStyles from "./ScheduleRow.module.css";
import styles from "./Agenda.module.css";

export function ResultsAgendaPage({ scope, mode, onMode, switched, crossfade }: SchedulePageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const nav = useScheduleNav();
  const data = useResults(scope);
  const live = useLiveEvents();
  const prefs = useSettings((s) => s);
  const details = useSettings((s) => s.resultsDetails);
  const followed = useSettings((s) => s.followed);
  const key = scopeKey(scope);
  const navigation = resultsNavigation(scope);
  const chips = useScopeChips(scope);
  const showAll = useScheduleSession((s) => s.showAll.includes(key));
  const seasonYear = useScheduleSession((s) => s.seasonYear[key] ?? null);
  const friendlies = useScheduleSession((s) => s.friendlies);
  const back = useScheduleSession((s) => Number(s.round[`${key}:back`] ?? 60));
  const page = useRef<HTMLDivElement>(null);
  const chrome = useRef<HTMLDivElement>(null);
  useChromeHeight(page, chrome);
  const width = useWidth(page, 440);
  const { highlight, setHighlight, onHover } = useHighlight();
  const today = dayKeyOf(Date.now());
  const viaKeyboard = Boolean((location.state as NavState | null)?.viaKeyboard);
  const state = data.page;
  const round = state?.rounds.find((r) => r.id === state.selected) ?? null;

  // From 680pt a league's rounds list sits beside the round (the picker leaves the chrome).
  const wide = width >= 680;
  const roundsBeside = wide && navigation === "rounds";
  const columns = wide && !roundsBeside && navigation !== "list" ? 2 : 1;
  const detail: RowDetail = rowDetail((roundsBeside ? width / 2 : width / columns) - 28);
  const fullDetail: RowDetail = rowDetail((roundsBeside ? width / 2 : width) - 28);

  const select = useCallback((id: string | null) => {
    setHighlight({ id: null, keyboard: false });
    scheduleSession.setRound(scope, id);
  }, [scope, setHighlight]);

  const step = (direction: number) => {
    if (navigation === "list" || !state) return;
    const i = state.rounds.findIndex((r) => r.id === state.selected);
    if (i < 0) return;
    const next = state.rounds[i + direction];
    if (next) return select(next.id);
    if (direction < 0 && i === 0) {
      if (scope.kind === "all") {
        // Older than the days loaded: reach 60 further back.
        writeBack(key, back + 60);
        select(`d:${dayID(addingDays(state.rounds[0]!.first, -1))}`);
      } else if (scope.kind === "league" && leagueWithID(scope.id)?.sport === "soccer") {
        // A cup: a month further back.
        select(`back:${state.selected}`);
      }
    }
  };

  const latest = () => select(null);

  const rows = useMemo(() => (navigation === "list" && scope.kind === "team" ? (state?.items ?? []) : data.days.flatMap((d) => d.groups.flatMap((g) => g.items))), [navigation, scope.kind, state, data.days]);

  useRowKeys(page, {
    rows: rows.map((r) => r.id),
    highlight,
    setHighlight,
    onOpen: (id) => navigate(`/game/${encodeURIComponent(id)}`, { state: { viaKeyboard: true } satisfies NavState }),
    onStep: step,
    onToday: navigation === "list" ? undefined : latest,
  });

  // MARK: More

  const league = scope.kind === "league" ? leagueWithID(scope.id) : undefined;
  const team = scope.kind === "team" ? scope.team : null;
  const choices = team ? seasonChoices(team) : [];
  const more: MenuEntry[] = [
    ...(navigation !== "list" ? [{ kind: "item" as const, label: "Latest", shortcut: "T", onSelect: latest }] : []),
    { kind: "item", label: "Refresh", onSelect: data.refresh },
    { kind: "separator" },
    { kind: "item", label: "Show Details", checked: details, onSelect: () => settings.set("resultsDetails", !details) },
    ...(league && filterable(league, prefs) ? [{ kind: "item" as const, label: showAll ? "Show Your Picks" : "Show All Games", onSelect: () => scheduleSession.setShowAll(scope, !showAll) }] : []),
    ...(team && choices.length
      ? [
          {
            kind: "section" as const,
            title: "Season",
            items: choices.map((c) => ({ kind: "item" as const, label: c.label, checked: c.year === seasonYear, onSelect: () => scheduleSession.setSeasonYear(scope, c.year) })),
          },
        ]
      : []),
    ...(team && teamSource(team.id)?.sport === "soccer"
      ? [{ kind: "item" as const, label: "Include Friendlies", checked: friendlies.includes(team.id), onSelect: () => scheduleSession.setFriendlies(team.id, !friendlies.includes(team.id)) }]
      : []),
  ];

  // MARK: Navigator and summary

  const summary = state && round && state.summary && state.items.length ? state.summary : null;
  const spokenSummary = round && summary ? [round.title, round.detail === round.title ? null : round.detail, summary].filter(Boolean).join(", ") : null;
  const navigatorView = (() => {
    if (!state || state.rounds.length === 0) return null;
    if (navigation === "rounds" && !roundsBeside) {
      const i = state.rounds.findIndex((r) => r.id === state.selected);
      return (
        <PeriodPicker
          title={round?.title ?? "Results"}
          detail={round?.detail ?? null}
          sections={roundSections(state.rounds)}
          selected={state.selected}
          previousEnabled={i > 0 || (scope.kind === "league" && league?.sport === "soccer")}
          nextEnabled={i >= 0 && i < state.rounds.length - 1}
          noun="round"
          onSelect={(id) => select(id)}
          onPrevious={() => step(-1)}
          onNext={() => step(1)}
        />
      );
    }
    if (navigation === "days") {
      const start = stripStart(round?.first ?? today, today);
      const byDay = new Map(state.rounds.map((r) => [dayID(r.first), r.id]));
      const dots = new Map<string, "games" | "followed">();
      for (const d of byDay.keys()) dots.set(d, "games");
      const followedIDs = new Set(followed.map((t) => t.id));
      if (round && state.items.some((i) => itemTeams(i).some((t) => t.id != null && followedIDs.has(t.id)))) dots.set(dayID(round.first), "followed");
      return (
        <WeekStrip
          days={Array.from({ length: 7 }, (_, i) => addingDays(start, i))}
          today={today}
          selected={round?.first ?? null}
          dots={dots}
          enabled={(day) => byDay.has(dayID(day))}
          onSelect={(day) => {
            const id = byDay.get(dayID(day));
            if (id) select(id);
          }}
          onPrevious={() => weekStepTo(-1)}
          onNext={() => weekStepTo(1)}
        />
      );
    }
    return null;
  })();

  function weekStepTo(direction: number) {
    if (!state) return;
    const target = weekStep(direction, round?.first ?? today, state.rounds);
    if (target) select(target.id);
  }

  const entrance = !switched && !viaKeyboard;
  const stack = (i: number): { className?: string; style?: CSSProperties } => (entrance ? { className: "stack-in", style: { animationDelay: `${Math.min(i, 8) * 30}ms` } } : {});

  // MARK: Content

  const content = (() => {
    if (data.loading) return <AgendaSkeleton days={1} rows={4} />;
    if (!state || (!state.ok && state.items.length === 0 && !state.season)) return <ErrorState subject="Results" onRetry={data.refresh} />;
    if (navigation === "list") {
      if (scope.kind === "yourTeams" && followed.length === 0) {
        return <EmptyState icon="star" title="No Teams" message="Follow a team from any game's page to see its results here." />;
      }
      return (
        <>
          {chips ? (
            <div {...stack(0)}>
              <ScopeChips chips={chips} selected={scope} onSelect={(chip, k) => (chip.drills ? nav.drill(chip.scope, mode, k) : nav.scope(chip.scope, mode, k))} />
            </div>
          ) : null}
          {team ? (
            <TeamResults team={team} wide={wide} details={details} highlight={highlight} onHover={onHover} stack={stack} />
          ) : (
            <YourTeamsResults days={data.days} more={state.more} detail={detail} details={details} highlight={highlight} onHover={onHover} eventFor={live.eventFor} stack={stack} />
          )}
        </>
      );
    }
    if (state.rounds.length === 0) {
      return (
        <EmptyState icon="flag" title="No Results Yet" message="Nothing's been played this season yet." actions={<Button onClick={() => onMode("upcoming", false)}>Show Upcoming</Button>} />
      );
    }
    const roundBody = (
      <div>
        {roundsBeside && round ? (
          <div {...stack(1)} className={[styles.roundHead, stack(1).className].filter(Boolean).join(" ")}>
            <SectionTitle>{[round.title, round.detail === round.title ? null : round.detail].filter(Boolean).join(" · ")}</SectionTitle>
            {summary ? (
              <p className={styles.summaryLine} aria-label={spokenSummary ?? undefined}>
                {summary}
              </p>
            ) : null}
          </div>
        ) : null}
        {data.placeholder && state.items.length === 0 ? (
          <AgendaSkeleton days={1} rows={4} />
        ) : state.items.length === 0 ? (
          <Note className={styles.noteTop}>No results in this round.</Note>
        ) : (
          data.days.map((day, d) => (
            <RoundDay key={d} day={day} index={d} scope={scope.kind} mode={mode} columns={roundsBeside ? 1 : columns} detail={detail} fullDetail={fullDetail} details={details} highlight={highlight} onHover={onHover} eventFor={live.eventFor} today={today} />
          ))
        )}
        {state.byes.length ? <Note>Bye: {state.byes.join(", ")}</Note> : null}
      </div>
    );
    return (
      <>
        {chips ? (
          <div {...stack(0)}>
            <ScopeChips chips={chips} selected={scope} onSelect={(chip, k) => (chip.drills ? nav.drill(chip.scope, mode, k) : nav.scope(chip.scope, mode, k))} />
          </div>
        ) : null}
        {roundsBeside ? (
          <div className={styles.besideRounds}>
            <RoundsAside rounds={state.rounds} selected={state.selected} items={state.items} league={league?.id ?? null} onSelect={(id) => select(id)} />
            {roundBody}
          </div>
        ) : (
          roundBody
        )}
      </>
    );
  })();

  return (
    <div className={styles.page} ref={page}>
      <ScheduleHeader scope={scope} mode={mode} onMode={onMode} more={more} chromeRef={chrome}>
        {navigatorView}
        {navigation !== "list" && !roundsBeside && summary ? (
          <p className={styles.summaryLine} role="heading" aria-level={2} aria-label={spokenSummary ?? undefined}>
            {summary}
          </p>
        ) : null}
      </ScheduleHeader>
      <div className={[styles.content, crossfade ? styles.crossfade : null].filter(Boolean).join(" ")} aria-busy={data.fetching}>
        {content}
      </div>
      <AgendaFooter
        updated={state?.fetchedAt ?? null}
        loading={data.fetching}
        stale={state != null && !state.ok}
        noun="results"
        action={navigation !== "list" ? { label: "Latest", title: "Latest (T)", onClick: latest } : undefined}
      />
    </div>
  );
}

function writeBack(key: string, value: number) {
  scheduleSession.setRoundRaw(`${key}:back`, String(value));
}

/** A round's day: its heading, then (All) its leagues, rows identified by place so a step reuses them. */
function RoundDay({ day, index, scope, mode, columns, detail, fullDetail, details, highlight, onHover, eventFor, today }: { day: AgendaDay; index: number; scope: string; mode: SchedulePageProps["mode"]; columns: number; detail: RowDetail; fullDetail: RowDetail; details: boolean; highlight: Highlight; onHover: (id: string) => void; eventFor: ReturnType<typeof useLiveEvents>["eventFor"]; today: DayKey }) {
  return (
    <section>
      <DayHeader day={day.day} today={today} />
      {day.groups.map((group, g) => (
        <Fragment key={g}>
          {scope === "all" ? <GroupLabel league={group.league} title={group.title} mode={mode} /> : null}
          <div className={[rowStyles.rows, columns === 2 && group.items.length > 1 ? styles.rows2 : null].filter(Boolean).join(" ")} data-detail={columns === 2 && group.items.length === 1 ? fullDetail : detail}>
            {group.items.map((item, r) => (
              <ScheduleRow
                key={`row-${index}.${g}.${r}`}
                item={item}
                event={eventFor(item)}
                keyboard={highlight.keyboard && highlight.id === item.id}
                detail={columns === 2 && group.items.length === 1 ? fullDetail : detail}
                showsCompetition={scope !== "league" && item.children == null}
                details={details}
                onHover={onHover}
              />
            ))}
          </div>
        </Fragment>
      ))}
    </section>
  );
}

/** The rounds beside the round, with your teams' seasons in this league (form, inline results). */
function RoundsAside({ rounds, selected, items, league, onSelect }: { rounds: readonly ResultRound[]; selected: string | null; items: readonly ScheduleItem[]; league: string | null; onSelect: (id: string) => void }) {
  const followed = useSettings((s) => s.followed);
  const mine = useMemo(() => {
    const ids = new Set(followed.map((t) => t.id));
    const seen = new Set<string>();
    return items
      .flatMap(itemTeams)
      .filter((t) => t.id != null && ids.has(t.id) && !seen.has(t.id) && seen.add(t.id))
      .slice(0, 3)
      .map((t): ScheduleTeamRef => ({ id: t.id!, name: t.name, logo: t.logo, league }));
  }, [items, followed, league]);
  const seasons = useQueries({
    queries: mine.map((team) => ({ queryKey: ["results", "aside", team.id], queryFn: () => loadTeamSeason(team, null, 20, false), staleTime: 60_000 })),
  });
  const list = seasons.flatMap((q) => (q.data?.season ? [q.data.season] : [])) as TeamSeason[];
  return <RoundsList sections={roundSections(rounds)} rounds={rounds} selected={selected} seasons={list} onSelect={(id) => onSelect(id)} />;
}

/** A team's season card, then its results newest first by month. */
function TeamResults({ team, wide, details, highlight, onHover, stack }: { team: ScheduleTeamRef; wide: boolean; details: boolean; highlight: Highlight; onHover: (id: string) => void; stack: (i: number) => { className?: string; style?: CSSProperties } }) {
  const data = useResults({ kind: "team", team });
  const year = useScheduleSession((s) => s.seasonYear[`team:${team.id}`] ?? null);
  const page = data.page;
  if (!page) return null;
  const season = page.season;
  const items = page.items;
  const months: ScheduleItem[][] = [];
  for (const item of items) {
    const last = months[months.length - 1]?.[0];
    if (last && last.day.year === item.day.year && last.day.month === item.day.month) months[months.length - 1]!.push(item);
    else months.push([item]);
  }
  const card = season ? (
    <div {...stack(1)}>
      <TeamSeasonCard season={season} sport={teamSource(team.id)?.sport ?? null} />
    </div>
  ) : null;
  const list =
    items.length === 0 ? (
      <Note className={styles.noteTop}>{year == null ? `No results for ${team.name} yet this season.` : `No results for ${team.name} in ${season?.season ?? "that season"}.`}</Note>
    ) : (
      <>
        {months.map((month, i) => (
          <section key={`${month[0]!.day.year}-${month[0]!.day.month}`} {...stack(i + 2)}>
            <h3 className={styles.monthLabel}>{monthYearLabel(month[0]!.day.year, month[0]!.day.month)}</h3>
            {month.map((item) => (
              <TeamResultRow key={item.id} item={item} team={team.id} details={details} keyboard={highlight.keyboard && highlight.id === item.id} onHover={onHover} />
            ))}
          </section>
        ))}
        {page.more ? <MoreButton onClick={() => scheduleSession.showMore({ kind: "team", team })}>Show 20 More</MoreButton> : null}
      </>
    );
  return wide ? (
    <div className={styles.besideRounds}>
      <div>{card}</div>
      <div>{list}</div>
    </div>
  ) : (
    <>
      {card}
      {list}
    </>
  );
}

/** Every followed team's results of the last month, newest first, head to head. */
function YourTeamsResults({ days, more, detail, details, highlight, onHover, eventFor, stack }: { days: readonly AgendaDay[]; more: boolean; detail: RowDetail; details: boolean; highlight: Highlight; onHover: (id: string) => void; eventFor: ReturnType<typeof useLiveEvents>["eventFor"]; stack: (i: number) => { className?: string; style?: CSSProperties } }) {
  const today = dayKeyOf(Date.now());
  if (days.length === 0) return <Note className={styles.noteTop}>No results for your teams in the last 30 days.</Note>;
  return (
    <>
      {days.map((day, i) => (
        <section key={dayID(day.day)} {...stack(i + 1)}>
          <DayHeader day={day.day} today={today} />
          <div className={rowStyles.rows} data-detail={detail}>
            {day.groups.flatMap((g) => g.items).map((item) => (
              <ScheduleRow key={item.id} item={item} event={eventFor(item)} keyboard={highlight.keyboard && highlight.id === item.id} detail={detail} showsCompetition details={details} onHover={onHover} />
            ))}
          </div>
        </section>
      ))}
      {more ? <MoreButton onClick={() => scheduleSession.showMore({ kind: "yourTeams" })}>Show 20 More</MoreButton> : null}
    </>
  );
}

