/**
 * Upcoming (SchedulePage.swift `AgendaPage`): what's coming up for a scope,
 * day by day. Everything you follow by week (the strip), a football league
 * by week (the picker), a daily league by its coming game days, a team or
 * your teams by month. Busy days fold like the scores list's sections, with
 * a line of crests; the day at the top lights the navigator (scroll spy).
 *
 * Keyboard: ↑/↓ move through the rows, ←/→ step the navigator (a day, a
 * week, a month), Return opens, T goes to today, ⌥2 faces Results. Keyboard
 * actions never animate; clicks fold with the crests travelling.
 */
import { LayoutGroup, m } from "motion/react";
import { useCallback, useMemo, useRef, type CSSProperties } from "react";
import { useLocation, useNavigate } from "react-router";
import { ErrorState, type MenuEntry } from "../../design/components";
import { revealDelay, spring } from "../../design/motion";
import { useWidth } from "../../design/useWidth";
import { addingDays, compareDays, dayID, dayKeyFromISO, dayKeyOf, daysBetween, mediumDayLabel, type DayKey } from "../../data/days";
import { AGENDA_PAGE, capDays, dayCountLabel, dayItems, dayLeagues, defaultOpen, filterable, form, stripDots, type AgendaDay } from "../../data/agenda";
import { plural } from "../../data/format";
import { leagueWithID } from "../../data/leagues";
import { nextGameDay } from "../../data/providers/schedule";
import { foldsDays, schedulePath, scopeFor, scopeKey, scopeNavigator, weekID, type ScheduleItem } from "../../data/schedule";
import { cachedResults, scheduleSession, useScheduleSession } from "../../state/schedule";
import { useSettings } from "../../state/settings";
import type { NavState } from "../../app/layout";
import { AgendaFooter, AgendaSkeleton, FoldingDayHeader, DayHeader, GroupLabel, handOffs, JumpLink, MoreButton, Note, ResultsLink } from "./AgendaParts";
import { ClimbingFeed } from "./climbing";
import { baseEvent, useLiveEvents } from "./live";
import { scrollToDay, scrollToTop, useChromeHeight, useDayToggle, useHighlight, useRowKeys, useScrollSpy, type DayToggling, type Highlight } from "./pageHooks";
import { MonthBar, PeriodPicker, WeekStrip } from "./ScheduleNavigators";
import { ScheduleHeader, ScopeChips, useScheduleNav, useScopeChips } from "./ScheduleHeader";
import { resultShort, rowDetail, ScheduleRow, type RowDetail } from "./ScheduleRow";
import type { SchedulePageProps } from "./SchedulePage";
import { useAgenda, type AgendaData } from "./useAgenda";
import rowStyles from "./ScheduleRow.module.css";
import styles from "./Agenda.module.css";

/** Crests a folded day's preview shows (CollapsedPreview.maxLogos at the panel's width). */
const MAX_LOGOS = 7;

export function AgendaPage({ scope, mode, onMode, switched, crossfade }: SchedulePageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const nav = useScheduleNav();
  const data = useAgenda(scope);
  const live = useLiveEvents();
  const followed = useSettings((s) => s.followed);
  const prefs = useSettings((s) => s);
  const enabled = useSettings((s) => s.enabledLeagues);
  const key = scopeKey(scope);
  const navigator = scopeNavigator(scope);
  const folds = foldsDays(scope);
  const today = dayKeyOf(Date.now());
  const page = useRef<HTMLDivElement>(null);
  const chrome = useRef<HTMLDivElement>(null);
  const width = useWidth(page, 440);
  const chromeHeight = useChromeHeight(page, chrome);
  const { highlight, setHighlight, onHover } = useHighlight();
  const chips = useScopeChips(scope);
  const limit = useScheduleSession((s) => s.limit[`${key}:upcoming`] ?? AGENDA_PAGE);
  const opened = useScheduleSession((s) => s.openedDays[key]);
  const closed = useScheduleSession((s) => s.closedDays[key]);
  const expanded = useScheduleSession((s) => s.expanded);
  const showAll = useScheduleSession((s) => s.showAll.includes(key));
  const viaKeyboard = Boolean((location.state as NavState | null)?.viaKeyboard);

  // Rows in one column, or two from 680pt (the scores list's grid); each column's room decides its detail.
  const columns = width >= 680 && folds ? 2 : 1;
  // A team's season goes two-up by day from the same width (Agenda.module.css `.twoUp`).
  const twoUp = !folds && width >= 676;
  const detail: RowDetail = rowDetail((twoUp ? width / 2 : width / columns) - 28);

  const defaults = useMemo(() => defaultOpen(data.upcoming, today), [data.upcoming, dayID(today)]); // eslint-disable-line react-hooks/exhaustive-deps
  const isOpen = useCallback(
    (day: string) => !folds || (opened?.includes(day) ? true : closed?.includes(day) ? false : defaults.has(day)),
    [folds, opened, closed, defaults],
  );
  const { toggling, toggle, unfold } = useDayToggle(scope, isOpen);

  // Folded days build no rows; pages that don't fold (a team's) are capped instead.
  const shown = useMemo(() => (folds ? { days: [...data.upcoming], hidden: 0 } : capDays(data.upcoming, limit, false)), [folds, data.upcoming, limit]);
  const dayIDs = useMemo(() => shown.days.map((d) => dayID(d.day)), [shown.days]);
  const top = useScrollSpy(page, chromeHeight, dayIDs);
  const topDay = top ? dayKeyFromISO(top) : null;

  const followedIDs = useMemo(() => new Set(followed.map((t) => t.id)), [followed]);

  // Only rows on screen: a folded day's rows aren't built.
  const rows = useMemo(
    () =>
      shown.days
        .filter((d) => isOpen(dayID(d.day)))
        .flatMap((d) => d.groups.flatMap((g) => g.items.flatMap((i) => (expanded.includes(i.id) ? [i, ...(i.children ?? [])] : [i])))),
    [shown.days, isOpen, expanded],
  );

  const open = useCallback(
    (item: ScheduleItem, keyboard: boolean) => {
      if (item.children) {
        // A tournament day opens in place.
        scheduleSession.setExpanded(item.id, !scheduleSession.get().expanded.includes(item.id));
        return;
      }
      if (item.ref.kind === "climbing") {
        nav.drill({ kind: "climbing" }, "upcoming", keyboard);
        return;
      }
      navigate(`/game/${encodeURIComponent(item.id)}`, { state: { viaKeyboard: keyboard } satisfies NavState });
    },
    [nav, navigate],
  );

  const jump = useCallback(
    (day: DayKey, animated: boolean) => {
      // A day without games scrolls to the next one that has some.
      const target = data.upcoming.find((d) => compareDays(d.day, day) >= 0)?.day ?? data.upcoming[data.upcoming.length - 1]?.day;
      if (!target) return;
      unfold(dayID(target));
      requestAnimationFrame(() => scrollToDay(page.current, dayID(target), animated));
    },
    [data.upcoming, unfold],
  );

  const moveWindow = (days: number) => {
    const from = data.window?.from ?? today;
    scheduleSession.setWindow(scope, addingDays(from, days));
    scrollToTop(page.current, false);
  };

  const goToday = (animated: boolean) => {
    switch (navigator) {
      case "weekStrip":
        if (data.window && compareDays(data.window.from, today) !== 0) {
          scheduleSession.setWindow(scope, null);
          scrollToTop(page.current, false);
        } else if (data.upcoming[0]) jump(data.upcoming[0].day, animated);
        return;
      case "weekPicker":
        scheduleSession.setWeek(scope, null);
        return;
      default:
        if (data.upcoming[0]) jump(data.upcoming[0].day, animated);
    }
  };

  const jumpMonth = (direction: number, animated: boolean) => {
    const current = topDay ?? data.upcoming[0]?.day ?? today;
    const days = data.upcoming.map((d) => d.day);
    const ym = (d: DayKey) => d.year * 12 + d.month;
    const target = direction > 0 ? days.find((d) => ym(d) > ym(current)) : (() => {
      const before = [...days].reverse().find((d) => ym(d) < ym(current));
      return before ? days.find((d) => ym(d) === ym(before)) : undefined;
    })();
    if (target) scrollToDay(page.current, dayID(target), animated);
  };

  const step = (direction: number) => {
    switch (navigator) {
      case "weekStrip":
      case "list": {
        const days = data.upcoming.map((d) => d.day);
        const current = topDay ?? days[0] ?? today;
        const target = direction > 0 ? days.find((d) => compareDays(d, current) > 0) : [...days].reverse().find((d) => compareDays(d, current) < 0);
        if (target) {
          unfold(dayID(target));
          requestAnimationFrame(() => scrollToDay(page.current, dayID(target), false));
        } else if (navigator === "weekStrip") moveWindow(7 * direction);
        return;
      }
      case "weekPicker": {
        const i = data.weeks.findIndex((w) => data.week && weekID(w) === weekID(data.week));
        const next = data.weeks[i + direction];
        if (i >= 0 && next) scheduleSession.setWeek(scope, weekID(next));
        return;
      }
      case "monthBar":
        jumpMonth(direction, false);
    }
  };

  useRowKeys(page, {
    rows: rows.map((r) => r.id),
    highlight,
    setHighlight,
    onOpen: (id) => {
      const item = rows.find((r) => r.id === id);
      if (item) open(item, true);
    },
    onStep: step,
    onToday: () => goToday(false),
  });

  const league = scope.kind === "league" ? leagueWithID(scope.id) : undefined;
  const more: MenuEntry[] = [
    { kind: "item", label: "Today", shortcut: "T", onSelect: () => goToday(true) },
    { kind: "item", label: "Refresh", onSelect: () => data.refresh() },
    ...(league && filterable(league, prefs)
      ? [{ kind: "separator" as const }, { kind: "item" as const, label: showAll ? "Show Your Picks" : "Show All Games", onSelect: () => scheduleSession.setShowAll(scope, !showAll) }]
      : []),
  ];

  const navigatorView = (() => {
    switch (navigator) {
      case "weekStrip": {
        const from = data.window?.from ?? today;
        const days = Array.from({ length: 7 }, (_, i) => addingDays(from, i));
        const calendarDays = data.calendar ? days.filter((d) => data.calendar!.days.some((c) => compareDays(c, d) === 0)) : [];
        const dots = stripDots([...data.earlier, ...data.upcoming], followedIDs, calendarDays, (i) => Math.abs(daysBetween(today, i.day)) <= 1 && live.isLive(i));
        return (
          <WeekStrip
            days={days}
            today={today}
            selected={topDay ?? data.upcoming[0]?.day ?? from}
            dots={dots}
            onSelect={(day, keyboard) => jump(day, !keyboard)}
            onPrevious={() => moveWindow(-7)}
            onNext={() => moveWindow(7)}
          />
        );
      }
      case "weekPicker": {
        const names: Record<number, string> = { 1: "Preseason", 2: "Regular Season", 3: "Postseason" };
        const sections = [1, 2, 3, 4].flatMap((type) => {
          const list = data.weeks.filter((w) => w.seasonType === type);
          return list.length ? [{ title: names[type] ?? "Off Season", options: list.map((w) => ({ id: weekID(w), title: w.label, detail: w.detail })) }] : [];
        });
        const i = data.week ? data.weeks.findIndex((w) => weekID(w) === weekID(data.week!)) : -1;
        return (
          <PeriodPicker
            title={data.week?.label ?? "Week"}
            detail={data.week?.detail ?? null}
            sections={sections}
            selected={data.week ? weekID(data.week) : null}
            previousEnabled={i > 0}
            nextEnabled={i >= 0 && i < data.weeks.length - 1}
            noun="week"
            onSelect={(id) => scheduleSession.setWeek(scope, id)}
            onPrevious={() => step(-1)}
            onNext={() => step(1)}
          />
        );
      }
      case "monthBar":
        return (
          <MonthBar
            month={topDay ?? data.upcoming[0]?.day ?? data.earlier[data.earlier.length - 1]?.day ?? null}
            summary={scope.kind === "team" ? [scope.team.name, data.summary].filter(Boolean).join(" · ") : null}
            onPrevious={(k) => jumpMonth(-1, !k)}
            onNext={(k) => jumpMonth(1, !k)}
          />
        );
      default:
        return null;
    }
  })();

  // The first data cascades in like a page entrance; switching in place or by keyboard doesn't.
  const entrance = !switched && !viaKeyboard;
  const stack = (i: number): { className?: string; style?: CSSProperties } => (entrance ? { className: "stack-in", style: { animationDelay: `${Math.min(i, 8) * 30}ms` } } : {});

  return (
    <div className={styles.page} ref={page}>
      <ClimbingFeed enabled={scope.kind === "all" && enabled.includes("ifsc")} />
      <ScheduleHeader scope={scope} mode={mode} onMode={onMode} more={more} chromeRef={chrome}>
        {navigatorView}
      </ScheduleHeader>
      <div className={[styles.content, crossfade ? styles.crossfade : null].filter(Boolean).join(" ")}>
        {data.loading ? (
          <AgendaSkeleton />
        ) : data.failed ? (
          <ErrorState subject="Schedule" onRetry={data.refresh} />
        ) : (
          <LayoutGroup>
            {chips ? (
              <div {...stack(0)}>
                <ScopeChips
                  chips={chips}
                  selected={scope}
                  onSelect={(chip, keyboard) => (chip.drills ? nav.drill(chip.scope, mode, keyboard) : nav.scope(chip.scope, mode, keyboard))}
                />
              </div>
            ) : null}
            <div {...stack(1)}>
              <ResultsLink title={resultsTitle(scope, data)} onClick={(k) => onMode("results", k)} />
            </div>
            {data.upcoming.length === 0 ? <EmptyWeek data={data} scope={scope} onJump={(day) => scheduleSession.setWindow(scope, day)} /> : null}
            {navigator === "list" && data.upcoming[0] && daysBetween(today, data.upcoming[0].day) > 1 ? (
              <div {...stack(2)}>
                <JumpLink onClick={(k) => jump(data.upcoming[0]!.day, !k)}>
                  Next: {mediumDayLabel(data.upcoming[0].day)}
                  <span className={styles.dayDate}>in {plural(daysBetween(today, data.upcoming[0].day), "day")}</span>
                </JumpLink>
              </div>
            ) : null}
            <div className={folds ? undefined : styles.twoUp}>
              {shown.days.map((day, i) => (
                <DaySection
                  key={dayID(day.day)}
                  day={day}
                  today={today}
                  folds={folds}
                  open={isOpen(dayID(day.day))}
                  scope={scope.kind}
                  mode={mode}
                  toggling={toggling}
                  onToggle={toggle}
                  columns={columns}
                  detail={detail}
                  highlight={highlight}
                  expanded={expanded}
                  eventFor={live.eventFor}
                  onHover={onHover}
                  onSelect={open}
                  entrance={entrance ? i + 2 : null}
                />
              ))}
            </div>
            {shown.hidden > 0 ? (
              <MoreButton onClick={() => scheduleSession.showMoreUpcoming(scope, AGENDA_PAGE)}>Show {Math.min(shown.hidden, AGENDA_PAGE)} More</MoreButton>
            ) : null}
            {navigator === "list" && data.more ? (
              <MoreButton disabled={data.fetching} onClick={() => scheduleSession.moreDays(scope)}>
                {data.fetching ? "Loading…" : `Show Next ${7} Game Days`}
              </MoreButton>
            ) : null}
            {scope.kind === "all" ? <Footnotes data={data} mode={mode} /> : null}
          </LayoutGroup>
        )}
      </div>
      <AgendaFooter updated={data.updated} loading={data.fetching} stale={data.stale} action={{ label: "Today", title: "Today (T)", onClick: (k) => goToday(!k) }} />
    </div>
  );
}

/** "Latest: Matchweek 8 · 10 results ›"; a team's "Last: ARS 2–0 EVE · W W W D W ›". What Results already knows (nothing loads for a link). */
function resultsTitle(scope: SchedulePageProps["scope"], data: AgendaData): string {
  if (scope.kind === "team") {
    const finals = data.earlier.flatMap(dayItems).filter((i) => i.status === "final");
    const last = finals[finals.length - 1];
    if (last) {
      const f = form(finals, scope.team.id).join(" ");
      return [`Last: ${resultShort(last) ?? mediumDayLabel(last.day)}`, f].filter(Boolean).join(" · ");
    }
    return "Results";
  }
  const known = cachedResults(scope);
  const round = known?.rounds.find((r) => r.id === known.selected);
  if (known && round) {
    const finals = known.items.filter((i) => i.status === "final").length;
    const lead = round.id === known.rounds[known.rounds.length - 1]?.id ? "Latest" : "Results";
    return `${lead}: ${round.title}${finals > 0 ? ` · ${plural(finals, "result")}` : ""}`;
  }
  return "Results";
}

function EmptyWeek({ data, scope, onJump }: { data: AgendaData; scope: SchedulePageProps["scope"]; onJump: (day: DayKey) => void }) {
  const navigator = scopeNavigator(scope);
  const text =
    navigator === "monthBar" ? "Nothing coming up." : navigator === "list" ? "No games scheduled." : navigator === "weekPicker" ? "No games this week." : scope.kind === "all" ? "Nothing on this week in your leagues." : "No games this week.";
  const next = navigator === "weekStrip" && data.window ? nextGameDay(data.calendar, addingDays(data.window.to, 1)) : null;
  return (
    <div className={styles.empty}>
      <p>{text}</p>
      {next ? <JumpLink onClick={() => onJump(next)}>Next: {mediumDayLabel(next)}</JumpLink> : null}
    </div>
  );
}

/** Under the calendar: quiet leagues, with their next game day when the calendar knows it. */
function Footnotes({ data, mode }: { data: AgendaData; mode: SchedulePageProps["mode"] }) {
  const navigate = useNavigate();
  if (data.quiet.length === 0) return null;
  const withNext = data.quiet.filter((l) => data.nextDay.has(l.id));
  const without = data.quiet.filter((l) => !data.nextDay.has(l.id));
  return (
    <div className={styles.footnotes}>
      {withNext.map((l) => (
        <button
          key={l.id}
          type="button"
          className={styles.footnoteLink}
          title={`${l.name} schedule`}
          onClick={() => navigate(schedulePath(scopeFor(l), mode))}
        >
          {l.name}: next {mediumDayLabel(data.nextDay.get(l.id)!)}
        </button>
      ))}
      {without.length ? <p>No games this week: {without.map((l) => l.name).join(", ")}</p> : null}
    </div>
  );
}

interface DaySectionProps {
  readonly day: AgendaDay;
  readonly today: DayKey;
  readonly folds: boolean;
  readonly open: boolean;
  readonly scope: SchedulePageProps["scope"]["kind"];
  readonly mode: SchedulePageProps["mode"];
  readonly toggling: DayToggling;
  readonly onToggle: (day: string, viaKeyboard: boolean) => void;
  readonly columns: number;
  readonly detail: RowDetail;
  readonly highlight: Highlight;
  readonly expanded: readonly string[];
  readonly eventFor: (item: ScheduleItem) => ReturnType<typeof baseEvent>;
  readonly onHover: (id: string) => void;
  readonly onSelect: (item: ScheduleItem, viaKeyboard: boolean) => void;
  /** The entrance cascade's index, or null (no entrance). */
  readonly entrance: number | null;
}

/** A day: its heading (folding or plain), then its leagues' rows; byes and "Time TBA" notes. */
function DaySection({ day, today, folds, open, scope, mode, toggling, onToggle, columns, detail, highlight, expanded, eventFor, onHover, onSelect, entrance }: DaySectionProps) {
  const id = dayID(day.day);
  const linking = toggling.linking === id;
  const just = toggling.just === id;
  const travel = useMemo(() => (linking ? handOffs(day, MAX_LOGOS) : null), [linking, day]);
  const order = useMemo(() => (just && open ? new Map(dayItems(day).map((item, i) => [item.id, i])) : null), [just, open, day]);
  const delay = (itemID: string | undefined) => (itemID && order?.has(itemID) ? revealDelay(order.get(itemID)!) : null);
  const reveal = (itemID: string | undefined): { className?: string; style?: CSSProperties } => {
    const d = delay(itemID);
    return d != null ? { className: rowStyles.reveal, style: { animationDelay: `${d}s` } } : {};
  };
  return (
    <m.section layout={toggling.animating ? "position" : false} transition={spring.standard} className={entrance != null ? "stack-in" : undefined} style={entrance != null ? { animationDelay: `${Math.min(entrance, 8) * 30}ms` } : undefined} aria-label={id}>
      {folds ? (
        <FoldingDayHeader
          day={day}
          today={today}
          open={open}
          count={dayCountLabel(day)}
          leagues={scope === "all" ? dayLeagues(day) : null}
          linking={linking}
          revealSummary={just && !open}
          animated={toggling.animating}
          maxLogos={MAX_LOGOS}
          onToggle={onToggle}
        />
      ) : (
        <DayHeader day={day.day} today={today} />
      )}
      {open ? (
        <div id={`day-rows-${id}`} className={styles.dayRows}>
          {day.groups.map((group) => {
            const timed = group.items.filter((i) => i.start.kind === "exact" || i.start.kind === "provisional");
            const untimed = group.items.filter((i) => !(i.start.kind === "exact" || i.start.kind === "provisional"));
            return (
              <div key={group.league}>
                {scope === "all" ? <GroupLabel league={group.league} title={group.title} mode={mode} {...reveal(group.items[0]?.id)} /> : null}
                <Rows items={timed} {...{ columns, detail, highlight, expanded, eventFor, onHover, onSelect, travel, delay, scope, day: id }} />
                {untimed.length ? (
                  <>
                    {timed.length ? <Note {...reveal(untimed[0]?.id)}>Time TBA</Note> : null}
                    <Rows items={untimed} {...{ columns, detail, highlight, expanded, eventFor, onHover, onSelect, travel, delay, scope, day: id }} />
                  </>
                ) : null}
              </div>
            );
          })}
          {day.byes.length ? <Note {...reveal(dayItems(day).at(-1)?.id)}>Bye: {day.byes.join(", ")}</Note> : null}
        </div>
      ) : null}
    </m.section>
  );
}

/** Rows in one column, or two (the scores list's grid); an open tournament day lists its matches right after it. */
function Rows({
  items,
  columns,
  detail,
  highlight,
  expanded,
  eventFor,
  onHover,
  onSelect,
  travel,
  delay,
  scope,
}: {
  items: readonly ScheduleItem[];
  columns: number;
  detail: RowDetail;
  highlight: Highlight;
  expanded: readonly string[];
  eventFor: (item: ScheduleItem) => ReturnType<typeof baseEvent>;
  onHover: (id: string) => void;
  onSelect: (item: ScheduleItem, viaKeyboard: boolean) => void;
  travel: Map<string, Set<string>> | null;
  delay: (id: string) => number | null;
  scope: string;
  day: string;
}) {
  if (items.length === 0) return null;
  const shown = items.flatMap((i) => (expanded.includes(i.id) ? [i, ...(i.children ?? [])] : [i]));
  return (
    <div className={[rowStyles.rows, columns === 2 ? styles.rows2 : null].filter(Boolean).join(" ")} data-detail={detail}>
      {shown.map((item) => (
        <ScheduleRow
          key={item.id}
          item={item}
          event={eventFor(item)}
          keyboard={highlight.keyboard && highlight.id === item.id}
          detail={detail}
          showsCompetition={scope !== "league" && item.children == null}
          expanded={expanded.includes(item.id)}
          revealDelay={delay(item.id)}
          travel={travel?.has(item.id) ? { section: `day-${item.day.year}-${String(item.day.month).padStart(2, "0")}-${String(item.day.day).padStart(2, "0")}`, ids: travel.get(item.id)! } : null}
          onHover={onHover}
          onSelect={item.children || item.ref.kind === "climbing" ? onSelect : undefined}
        />
      ))}
    </div>
  );
}

