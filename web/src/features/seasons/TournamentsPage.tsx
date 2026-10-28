/**
 * CS2's calendar, S-tier only (TournamentsPage.swift): the tournament
 * underway, the coming months on one axis, then every tournament by month.
 * A drawn tournament opens its bracket; one that isn't drawn yet opens in
 * place (the field, the prize money). Results mode is `TournamentResultsPage`.
 */
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, LayoutGroup, m } from "motion/react";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { EmptyState, ErrorState, Icon, LiveDot, TeamLogo, type MenuEntry } from "../../design/components";
import { spring, tween } from "../../design/motion";
import { addingDays, compareDays, dayKeyOf, dayRangeLabel } from "../../data/days";
import { dayAndTime, plural } from "../../data/format";
import { competitors, type ScoreEvent } from "../../data/models";
import type { SeasonEvent } from "../../data/schedule";
import { byMonth, eventFlag, isDrawn, prize, S_TIER_LANE, topTen, tournamentReadout, tournamentsLiveSummary, tournamentsNextSummary, type SeasonAxis } from "../../data/seasons";
import { useNow } from "../../state/clock";
import { scoresKey } from "../../state/scores";
import { useTournaments } from "../../state/seasons";
import { textWidth } from "../scores/measure";
import { ScheduleHeader } from "../schedule/ScheduleHeader";
import type { SchedulePageProps } from "../schedule/SchedulePage";
import { useReducedMotion } from "./ClimbingRows";
import { useHoverStore, useLit, type HoverStore } from "./hover";
import { Badge, LinkButton, MonthLabel, partStyles, SectionLink, SeasonFooter, SeasonSkeleton, TournamentLogo } from "./parts";
import { SeasonCard, SeasonDockBar, scrollToTop, scrollUnderBar, useSeasonDock } from "./SeasonCard";
import { SeasonFrame, SplitColumns, stackIn, useArrival, useFocusOnArrival, useSeasonKeys, useSeasonWidth } from "./SeasonPage";
import { TournamentResultsPage } from "./TournamentResults";
import { tournamentBracketPath, useFollowedCS } from "./links";
import styles from "./rows.module.css";

const memory = { expanded: new Set<string>(), selected: null as string | null };

export function TournamentsPage(props: SchedulePageProps) {
  return props.mode === "results" ? <TournamentResultsPage {...props} /> : <TournamentsUpcoming {...props} />;
}

/** The scores list's CS2 games, read from its cache (never fetched or polled from here). */
function useCachedCS2(): readonly ScoreEvent[] {
  const q = useQuery<ScoreEvent[]>({ queryKey: scoresKey("cs2", []), queryFn: () => Promise.reject(new Error("read only")), enabled: false });
  return q.data ?? [];
}

/** The live tournament's next (or live) match, from the scores list's CS2 games: your teams' first. */
function nextMatch(e: SeasonEvent, games: readonly ScoreEvent[], followed: ReadonlySet<string>): ScoreEvent | null {
  const matches = games.filter((g) => g.caption?.startsWith(e.name));
  const mine = matches.filter((g) => competitors(g).some((c) => c.id != null && followed.has(c.id)));
  const pick = (list: readonly ScoreEvent[]) => list.find((g) => g.state === "live") ?? [...list].filter((g) => g.state === "scheduled").sort((a, b) => a.start - b.start)[0] ?? null;
  return pick(mine) ?? pick(matches);
}

function matchLine(m: ScoreEvent | null, now: number): { state: ScoreEvent["state"]; teams: string[]; when: string } | null {
  if (!m) return null;
  return { state: m.state, teams: competitors(m).map((c) => c.name), when: dayAndTime(m.start, now) };
}

function TournamentsUpcoming({ scope, mode, onMode, switched, crossfade }: SchedulePageProps) {
  const navigate = useNavigate();
  const root = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const hover = useHoverStore();
  const { split, width } = useSeasonWidth(root);
  const { entrance } = useArrival(switched);
  const reduce = useReducedMotion();
  const followed = useFollowedCS();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(memory.expanded));
  const [selectedID, setSelectedID] = useState<string | null>(memory.selected);
  const [animating, setAnimating] = useState(false);
  const opened = useMemo(() => [...expanded, ...(selectedID ? [selectedID] : [])], [expanded, selectedID]);
  const data = useTournaments(opened);
  const games = useCachedCS2();
  const now = useNow(60_000);
  const today = dayKeyOf(now);
  const live = data.current[0] ?? null;
  const selected = data.events.find((e) => e.id === (selectedID ?? data.upcoming[0]?.id)) ?? data.events[0] ?? null;

  const summary = live ? tournamentsLiveSummary(live, matchLine(nextMatch(live, games, followed), now)) : tournamentsNextSummary(data.upcoming[0] ?? null, today);
  const axis = useMemo<SeasonAxis>(() => {
    const horizon = addingDays(today, 365);
    return {
      events: data.events.filter((e) => compareDays(e.startDay, horizon) <= 0),
      lanes: S_TIER_LANE,
      today,
      next: data.upcoming[0]?.id ?? null,
      selected: split ? (selected?.id ?? null) : null,
      readouts: Object.fromEntries(data.events.map((e) => [e.id, tournamentReadout(e)])),
      resting: data.upcoming[0]?.id ?? null,
    };
  }, [data.events, data.upcoming, split, selected?.id, today.year, today.month, today.day]); // eslint-disable-line react-hooks/exhaustive-deps

  const months = useMemo(() => byMonth(data.upcoming, (e) => e.startDay), [data.upcoming]);
  const ids = useMemo(() => months.flatMap((g) => g.items.map((e) => e.id)), [months]);

  const openBracket = useCallback((e: SeasonEvent) => {
    const path = tournamentBracketPath(e, followed);
    if (path) navigate(path);
  }, [followed, navigate]);

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

  /** Drawn: straight to the bracket. Not yet: open in place (or beside the list). */
  const select = useCallback(
    (id: string, viaKeyboard = false) => {
      const e = data.events.find((x) => x.id === id);
      if (!e) return;
      if (isDrawn(e)) return openBracket(e);
      if (split) {
        memory.selected = id;
        setSelectedID(id);
      } else toggle(id, undefined, viaKeyboard);
    },
    [data.events, openBracket, split, toggle],
  );

  const reveal = useCallback(
    (id: string) => {
      const e = data.events.find((x) => x.id === id);
      if (!e) return;
      if (isDrawn(e) || split || !expanded.has(id)) select(id);
      if (!isDrawn(e)) {
        const row = root.current?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`);
        if (row) scrollUnderBar(row, barRef.current?.parentElement?.parentElement ?? null, !reduce);
      }
    },
    [data.events, split, expanded, select, reduce],
  );

  const onKeyDown = useSeasonKeys(root, {
    hover,
    ids,
    split,
    onSelect: (id) => {
      const e = data.events.find((x) => x.id === id);
      if (e && !isDrawn(e)) select(id, true);
    },
    onToggle: (id, open) => {
      const e = data.events.find((x) => x.id === id);
      if (e && !isDrawn(e)) toggle(id, open, true);
    },
    onActivate: (id) => select(id, true),
  });
  useFocusOnArrival(root);
  const ready = data.status === "ready" && data.events.length > 0;
  useSeasonDock(cardRef, barRef, ready);

  const more: MenuEntry[] = [
    { kind: "item", label: "Refresh", icon: "refresh", onSelect: data.refresh },
    { kind: "item", label: "Open bo3.gg", icon: "external", onSelect: () => window.open("https://bo3.gg/tournaments", "_blank", "noopener,noreferrer") },
  ];
  const textRoom = (split ? width / 2 : width) - 12 - 16 - 20 - 10 - 76 - 24;

  const list = (expandable: boolean) => (
    <LayoutGroup>
      {months.map((group, gi) => (
        <m.div key={`${group.month.year}-${group.month.month}`} layout={animating ? "position" : false} transition={spring.standard}>
          <MonthLabel month={group.month} {...stackIn(entrance, gi + 2)} />
          {group.items.map((e) => {
            const open = expandable ? expanded.has(e.id) : selected?.id === e.id;
            return (
              <div key={e.id} className={styles.rowWrap}>
                <TournamentRow event={e} followed={followed} open={open} chevron={expandable} hover={hover} textRoom={textRoom} onSelect={select} />
                <AnimatePresence initial={false}>
                  {expandable && open && !isDrawn(e) ? (
                    <m.div key="detail" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: tween.exit }} transition={reduce ? tween.fade : tween.reveal}>
                      <TournamentDetail event={e} followed={followed} inline wide={width >= 460} onBracket={() => openBracket(e)} />
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
      label="Tournaments"
      onKeyDown={onKeyDown}
      crossfade={crossfade}
      contentKey={mode}
      header={
        <ScheduleHeader scope={scope} mode={mode} onMode={onMode} title="Tournaments" more={more}>
          {ready ? <SeasonDockBar summary={summary} axis={axis} hover={hover} onSelect={reveal} barRef={barRef} onTop={() => scrollToTop(root.current, !reduce)} /> : null}
        </ScheduleHeader>
      }
      footer={<SeasonFooter updated={data.updated} stale={data.stale} loading={data.fetching} />}
    >
      {data.status === "loading" ? (
        <SeasonSkeleton />
      ) : data.events.length === 0 && data.status === "failed" ? (
        <ErrorState subject="Tournaments" retriesAutomatically retrying={data.fetching} onRetry={data.refresh} />
      ) : data.events.length === 0 ? (
        <EmptyState icon="esports" title="No Tournaments" message="No S-tier tournaments are scheduled." />
      ) : (
        <>
          <div {...stackIn(entrance, 0)}>
            <SeasonCard
              cardRef={cardRef}
              summary={summary}
              axis={axis}
              hover={hover}
              onSelect={(id) => select(id)}
              accessory={live ? <SectionLink onClick={() => openBracket(live)} title="Open the bracket">Bracket</SectionLink> : null}
            />
          </div>
          {/* Another tournament underway at the same time (rare): its own card. */}
          {data.current.slice(1).map((e, i) => (
            <div key={e.id} {...stackIn(entrance, i + 1)}>
              <CurrentTournamentCard event={e} next={nextMatch(e, games, followed)} now={now} onBracket={() => openBracket(e)} />
            </div>
          ))}
          {split ? (
            <SplitColumns
              list={list(false)}
              detail={selected ? <TournamentDetail key={selected.id} event={selected} followed={followed} showsHeader wide={width / 2 >= 460} onBracket={() => openBracket(selected)} /> : null}
            />
          ) : (
            list(true)
          )}
        </>
      )}
    </SeasonFrame>
  );
}

// MARK: - Pieces

function CurrentTournamentCard({ event: e, next, now, onBracket }: { event: SeasonEvent; next: ScoreEvent | null; now: number; onBracket: () => void }) {
  const teams = next ? competitors(next).map((c) => c.name).join(" v ") : "";
  const line = next?.state === "live" ? `Live: ${teams}` : next?.state === "scheduled" ? `Next: ${teams} · ${dayAndTime(next.start, now)}` : null;
  return (
    <div className={styles.currentCard}>
      <TournamentLogo url={e.logo} size={28} />
      <div className={styles.currentText}>
        <p className={styles.currentTitle}>
          <LiveDot />
          <span>{e.shortName}</span>
          <SectionLink onClick={onBracket} title="Open the bracket">
            Bracket
          </SectionLink>
        </p>
        <p className={styles.detail}>{[dayRangeLabel(e.startDay, e.endDay), prize(e.prize)].filter(Boolean).join(" · ")}</p>
        {line ? <p className={[styles.nextLine, next?.state === "live" ? styles.live : null].filter(Boolean).join(" ")}>{line}</p> : null}
      </div>
    </div>
  );
}

/** "$1.25M · 16 teams · LAN · 🇵🇱 Katowice, Poland"; without the city, the flag alone places it. */
function placeLine(e: SeasonEvent, city: boolean): string {
  const parts: string[] = [];
  const money = prize(e.prize);
  if (money) parts.push(money);
  if (e.teams.length > 0) parts.push(plural(e.teams.length, "team"));
  if (e.format) parts.push(e.format);
  if (e.place) {
    const flag = eventFlag(e);
    if (city) parts.push([flag, e.place].filter(Boolean).join(" "));
    else if (flag) parts.push(flag);
  }
  return parts.join(" · ");
}

/** Your teams in the field, and how many of the world's top 10. */
function fieldLine(e: SeasonEvent, followed: ReadonlySet<string>): string | null {
  if (e.teams.length === 0) return null;
  const yours = e.teams.filter((t) => t.id != null && followed.has(t.id)).map((t) => `${t.name} ★`);
  const top = topTen(e.teams);
  const parts = [...yours, ...(top > 0 ? [`${top} of the top 10`] : [])];
  return parts.length > 0 ? parts.join(" · ") : null;
}

export const TournamentRow = memo(function TournamentRow({
  event: e,
  followed,
  open,
  chevron,
  hover,
  textRoom,
  onSelect,
  relative = null,
}: {
  event: SeasonEvent;
  followed: ReadonlySet<string>;
  open: boolean;
  chevron: boolean;
  hover: HoverStore;
  textRoom: number;
  onSelect: (id: string, viaKeyboard?: boolean) => void;
  relative?: string | null;
}) {
  const lit = useLit(hover, e.id);
  const drawn = isDrawn(e);
  // What tells tournaments apart leads (prize, field size, format); the city gives way first, keeping its flag.
  const full = placeLine(e, true);
  const place = textWidth(full, 11) <= textRoom ? full : placeLine(e, false);
  const field = fieldLine(e, followed);
  const range = dayRangeLabel(e.startDay, e.endDay);
  return (
    <button
      type="button"
      className={partStyles.row}
      data-row-id={e.id}
      data-lit={lit}
      data-selected={!chevron && open}
      aria-expanded={chevron && !drawn ? open : undefined}
      aria-label={[e.shortName, range, relative, full, field?.replaceAll(" ★", ", following")].filter(Boolean).join(", ")}
      title={drawn ? "Open the bracket" : "Show the field"}
      onClick={(ev) => onSelect(e.id, ev.detail === 0)}
      onPointerEnter={(ev) => ev.pointerType === "mouse" && hover.set(e.id)}
      onPointerLeave={() => hover.leave(e.id)}
    >
      <TournamentLogo url={e.logo} size={20} />
      <span className={styles.text} aria-hidden="true">
        <span className={styles.titleLine}>
          <span className={styles.title}>
            {e.status === "live" ? <LiveDot /> : null}
            <span>{e.shortName}</span>
          </span>
          {/* "PGL Major Singapore" says it already. */}
          {e.badge && !e.shortName.includes(e.badge) ? <Badge>{e.badge}</Badge> : null}
        </span>
        {place ? <span className={styles.detail}>{place}</span> : null}
        {field ? <span className={[styles.detail, styles.detailSmall].join(" ")}>{field}</span> : null}
      </span>
      <span className={styles.dates} aria-hidden="true">
        {range}
        {relative ? <span className={[styles.relative, e.status === "live" ? styles.live : null].filter(Boolean).join(" ")}>{relative}</span> : null}
      </span>
      {chevron ? <Icon name="chevronRight" size={9} className={partStyles.rowChevron} style={drawn ? { transform: "none" } : undefined} /> : null}
    </button>
  );
});

/** A tournament not drawn yet: the field (top-ranked first) and the prize money. */
function TournamentDetail({ event: e, followed, showsHeader = false, inline = false, wide = false, onBracket }: { event: SeasonEvent; followed: ReadonlySet<string>; showsHeader?: boolean; inline?: boolean; wide?: boolean; onBracket: () => void }) {
  return (
    <div className={[styles.openDetail, inline ? styles.inlineWide : null].filter(Boolean).join(" ")} style={{ gap: "calc(8 * var(--pt))" }}>
      {showsHeader ? (
        <div className={styles.currentCard} style={{ margin: 0, padding: 0, background: "none" }}>
          <TournamentLogo url={e.logo} size={28} />
          <div className={styles.currentText}>
            <h2 className={styles.detailTitle}>
              <span>{e.name}</span>
            </h2>
            <p className={styles.meta}>{[dayRangeLabel(e.startDay, e.endDay), e.place ? [eventFlag(e), e.place].filter(Boolean).join(" ") : null, e.format, prize(e.prize)].filter(Boolean).join(" · ")}</p>
          </div>
        </div>
      ) : null}
      {!e.detailed ? (
        <p className={styles.note} role="status">
          Loading the field…
        </p>
      ) : e.teams.length === 0 ? (
        <p className={styles.note}>Teams and format not announced yet.</p>
      ) : (
        <ul className={[styles.field, wide ? styles.fieldWide : null].filter(Boolean).join(" ")} aria-label="The field">
          {e.teams.map((t) => (
            <li key={t.id ?? t.name} className={styles.fieldTeam} title={t.rank != null ? `${t.name} · No. ${t.rank} on bo3.gg` : t.name}>
              <TeamLogo url={t.logo} size={14} />
              <span>{t.name}</span>
              {t.id != null && followed.has(t.id) ? <Icon name="star" size={7} className={styles.star} label="Following" /> : null}
            </li>
          ))}
        </ul>
      )}
      <div className={styles.links}>
        {e.stages > 0 ? (
          <button type="button" className={styles.openBracket} onClick={onBracket}>
            Open Bracket
          </button>
        ) : null}
        {e.link ? <LinkButton title="bo3.gg" href={e.link} /> : null}
      </div>
    </div>
  );
}
