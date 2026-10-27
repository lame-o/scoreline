/**
 * A league's page leads with what's next and what just happened
 * (ScheduleHub.swift `LeagueUpcomingSection`, ResultsHub.swift
 * `LeagueResultsSection`): a daily league's coming games, a football week,
 * climbing's next competitions, CS2's next tournaments; then the latest
 * round, your teams first. "Full Schedule" and "All Results" open the
 * season views, so nobody clicks through days to find the next thing.
 * The data is the schedule pages' own (one cache).
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef } from "react";
import { Link } from "react-router";
import { SectionTitle } from "../../design/components";
import { useWidth } from "../../design/useWidth";
import { dayID, dayKeyOf, daysBetween, dayRangeLabel, mediumDayLabel, relativeDay, type DayKey } from "../../data/days";
import { dayItems, hubResults, hubUpcoming, relativeWhen, HUB_LIMIT } from "../../data/agenda";
import { plural } from "../../data/format";
import type { League } from "../../data/models";
import { eventResultsPath, schedulePath, scopeFor, scopeKey, type ScheduleItem } from "../../data/schedule";
import { flagFromISO } from "../../data/teams";
import { loadLeagueResults } from "../../state/schedule";
import { useClimbingSeasons, useFinishedTournaments, useTournaments } from "../../state/seasons";
import { finishedSlug } from "../../data/seasonResults";
import { useSettings } from "../../state/settings";
import { SectionLink } from "../seasons/parts";
import { Note } from "./AgendaParts";
import { useLiveEvents } from "./live";
import { useHighlight } from "./pageHooks";
import { rowDetail, ScheduleRow } from "./ScheduleRow";
import { useAgenda } from "./useAgenda";
import rowStyles from "./ScheduleRow.module.css";
import styles from "./LeagueHub.module.css";

export function LeagueHub({ league }: { league: League }) {
  switch (league.source.kind) {
    case "espn":
      return (
        <>
          <ESPNUpcoming league={league} />
          <ESPNResults league={league} />
        </>
      );
    case "ifsc":
      return <ClimbingUpcoming league={league} />;
    case "counterStrike":
      return <TournamentsUpcoming league={league} />;
  }
}

function Header({ title, link, linkTitle, to, caption }: { title: string; link: string; linkTitle: string; to: string; caption: string | null }) {
  return (
    <div className={styles.header}>
      <SectionTitle trailing={<SectionLink to={to} title={linkTitle}>{link}</SectionLink>}>{title}</SectionTitle>
      {caption ? <p className={styles.caption}>{caption}</p> : null}
    </div>
  );
}

/** Rows by day, with a small day label over each. */
function DayRows({ items, details }: { items: readonly ScheduleItem[]; details: boolean }) {
  const live = useLiveEvents();
  const { highlight, onHover } = useHighlight();
  const root = useRef<HTMLDivElement>(null);
  const detail = rowDetail(useWidth(root, 440) - 28);
  const today = dayKeyOf(Date.now());
  const days = new Map<string, { day: DayKey; items: ScheduleItem[] }>();
  for (const item of items) {
    const key = dayID(item.day);
    const entry = days.get(key) ?? { day: item.day, items: [] };
    entry.items.push(item);
    days.set(key, entry);
  }
  return (
    <div ref={root}>
      {[...days.values()].map(({ day, items: rows }) => (
        <section key={dayID(day)}>
          <h3 className={styles.dayLabel}>{[relativeDay(day, today), mediumDayLabel(day)].filter(Boolean).join(" · ")}</h3>
          <div className={rowStyles.rows} data-detail={detail}>
            {rows.map((item) => (
              <ScheduleRow key={item.id} item={item} event={live.eventFor(item)} keyboard={highlight.keyboard && highlight.id === item.id} detail={detail} showsCompetition={false} details={details} onHover={onHover} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function HubSkeleton() {
  return <div className={styles.skeleton} aria-label="Loading" role="status" />;
}

// MARK: - ESPN leagues

function ESPNUpcoming({ league }: { league: League }) {
  const scope = scopeFor(league);
  const data = useAgenda(scope);
  const followed = useSettings((s) => s.followed);
  const today = dayKeyOf(Date.now());
  const items = useMemo(() => hubUpcoming(data.upcoming.flatMap(dayItems), new Set(followed.map((t) => t.id))), [data.upcoming, followed]);
  const weekly = league.source.kind === "espn" && league.source.weekly;
  let caption: string | null = null;
  if (!data.loading) {
    if (weekly && data.week) {
      const left = data.upcoming.flatMap(dayItems).filter((i) => i.status !== "final").length;
      caption = [data.week.label, data.week.detail.replaceAll("-", "–"), left > 0 ? `${plural(left, "game")} to play` : "All played"].filter(Boolean).join(" · ");
    } else {
      const first = data.upcoming.find((d) => dayItems(d).some((i) => i.status !== "final"));
      if (first) {
        const when = relativeDay(first.day, today) ?? `${mediumDayLabel(first.day)} · in ${plural(daysBetween(today, first.day), "day")}`;
        caption = `${when} · ${plural(dayItems(first).length, "game")}`;
      }
    }
  }
  return (
    <section className={styles.section} aria-label="Upcoming">
      <Header title="Upcoming" link="Full Schedule" linkTitle={weekly ? "Week by week" : "Every coming game day"} to={schedulePath(scope)} caption={caption} />
      {data.loading ? <HubSkeleton /> : data.failed ? <Note>Couldn't load the schedule. Check your internet connection.</Note> : items.length === 0 ? <Note>No games scheduled.</Note> : <DayRows items={items} details={false} />}
    </section>
  );
}

function ESPNResults({ league }: { league: League }) {
  const scope = scopeFor(league);
  const followed = useSettings((s) => s.followed);
  const details = useSettings((s) => s.resultsDetails);
  // The latest round, whatever the Results page has open.
  const query = useQuery({ queryKey: ["results", scopeKey(scope), "hub"], queryFn: () => loadLeagueResults(league, null, null), staleTime: 60_000 });
  const page = query.data;
  const round = page?.rounds.find((r) => r.id === page.selected) ?? null;
  const played = (page?.items ?? []).filter((i) => i.status === "final" || i.status === "postponed" || i.status === "canceled");
  const rows = useMemo(() => hubResults(page?.items ?? [], new Set(followed.map((t) => t.id))), [page, followed]);
  const shown = Math.min(played.length, HUB_LIMIT);
  const caption = round ? [round.title, round.title.includes(round.detail) ? null : round.detail, shown < played.length ? `${shown} of ${played.length} shown` : plural(played.length, "result")].filter(Boolean).join(" · ") : null;
  return (
    <section className={styles.section} aria-label="Results">
      <Header title="Results" link="All Results" linkTitle={league.source.kind === "espn" && league.source.weekly ? "Week by week" : "Round by round"} to={schedulePath(scope, "results")} caption={caption} />
      {/* A round that didn't load (offline, ESPN down) isn't a season without results. */}
      {query.isPending ? <HubSkeleton /> : query.isError || (page && !page.ok && rows.length === 0) ? <Note>Couldn't load the results. Check your internet connection.</Note> : rows.length === 0 ? <Note>No results yet this season.</Note> : <DayRows items={rows} details={details} />}
    </section>
  );
}

// MARK: - Climbing and CS2

function ClimbingUpcoming({ league }: { league: League }) {
  const seasons = useClimbingSeasons();
  const today = dayKeyOf(Date.now());
  const next = seasons.events.filter((e) => e.status === "live" || e.status === "upcoming").slice(0, 4);
  // The last two finished competitions (the season pages hold their podiums).
  const done = seasons.events.filter((e) => e.status === "finished").slice(-2).reverse();
  const lastDone = done[0];
  const first = next[0];
  const caption = first
    ? first.status === "live"
      ? `Live now: ${[flagFromISO(first.countryCode), first.shortName].filter(Boolean).join(" ")} · ${dayRangeLabel(first.startDay, first.endDay)}`
      : `Next: ${[flagFromISO(first.countryCode), first.shortName].filter(Boolean).join(" ")} · ${dayRangeLabel(first.startDay, first.endDay)} · ${relativeWhen(first.startDay, first.endDay, today).toLowerCase()}`
    : null;
  const scope = scopeFor(league);
  return (
    <>
      <section className={styles.section} aria-label="Upcoming">
        <Header title="Upcoming" link="Full Schedule" linkTitle="The season: every competition by month" to={schedulePath(scope)} caption={caption} />
        {seasons.status === "loading" ? (
          <HubSkeleton />
        ) : next.length === 0 ? (
          <Note>{seasons.status === "failed" ? "Couldn't load the calendar. Check your internet connection." : "The next season's calendar isn't published yet."}</Note>
        ) : (
          <div className={styles.seasonRows}>
            {next.map((e) => (
              <SeasonRowLink key={e.id} to={schedulePath(scope)} flag={flagFromISO(e.countryCode)} title={e.shortName} detail={[dayRangeLabel(e.startDay, e.endDay), e.lanes.map((l) => l[0]!.toUpperCase() + l.slice(1)).join(" · ")].join(" · ")} when={relativeWhen(e.startDay, e.endDay, today)} />
            ))}
          </div>
        )}
      </section>
      <section className={styles.section} aria-label="Results">
        <Header title="Results" link="All Results" linkTitle="Every competition" to={schedulePath(scope, "results")} caption={lastDone ? `Last: ${[flagFromISO(lastDone.countryCode), lastDone.shortName].filter(Boolean).join(" ")} · ${dayRangeLabel(lastDone.startDay, lastDone.endDay)}` : null} />
        {done.length ? (
          <div className={styles.seasonRows}>
            {done.map((e) => (
              <SeasonRowLink key={e.id} to={schedulePath(scope, "results")} flag={flagFromISO(e.countryCode)} title={e.shortName} detail={[dayRangeLabel(e.startDay, e.endDay), e.lanes.map((l) => l[0]!.toUpperCase() + l.slice(1)).join(" · ")].join(" · ")} when="Finished" />
            ))}
          </div>
        ) : null}
      </section>
    </>
  );
}

function TournamentsUpcoming({ league }: { league: League }) {
  const tournaments = useTournaments();
  const finished = useFinishedTournaments();
  const today = dayKeyOf(Date.now());
  const next = [...tournaments.events].sort((a, b) => (a.status === "live" ? 0 : 1) - (b.status === "live" ? 0 : 1)).slice(0, 4);
  const first = next[0];
  const caption = first ? (first.status === "live" ? `Live now: ${first.shortName}` : `Next: ${first.shortName} · ${dayRangeLabel(first.startDay, first.endDay)}`) : null;
  const scope = scopeFor(league);
  return (
    <>
      <section className={styles.section} aria-label="Upcoming">
        <Header title="Upcoming" link="Full Schedule" linkTitle="Every upcoming tournament" to={schedulePath(scope)} caption={caption} />
        {tournaments.status === "loading" ? (
          <HubSkeleton />
        ) : next.length === 0 ? (
          <Note>{tournaments.status === "failed" ? "Couldn't load tournaments. Check your internet connection." : "No tournaments announced."}</Note>
        ) : (
          <div className={styles.seasonRows}>
            {next.map((e) => (
              <SeasonRowLink key={e.id} to={schedulePath(scope)} flag={flagFromISO(e.countryCode)} title={e.shortName} detail={[dayRangeLabel(e.startDay, e.endDay), e.badge].filter(Boolean).join(" · ")} when={relativeWhen(e.startDay, e.endDay, today)} />
            ))}
          </div>
        )}
      </section>
      <section className={styles.section} aria-label="Results">
        <Header title="Results" link="All Results" linkTitle="Every tournament" to={schedulePath(scope, "results")} caption={null} />
        {finished.items.length ? (
          <div className={styles.seasonRows}>
            {finished.items.slice(0, 2).map((t) => (
              <SeasonRowLink key={t.event.id} to={eventResultsPath({ kind: "tournament", slug: finishedSlug(t), name: t.event.name })} flag={null} title={t.title} detail={t.summary ?? dayRangeLabel(t.event.startDay, t.event.endDay)} when={dayRangeLabel(t.event.startDay, t.event.endDay)} />
            ))}
          </div>
        ) : null}
      </section>
    </>
  );
}

/** A competition or tournament: flag, name, dates, and when ("This weekend"). Opens the season page. */
function SeasonRowLink({ to, flag, title, detail, when }: { to: string; flag: string | null; title: string; detail: string; when: string }) {
  return (
    <Link to={to} className={styles.seasonRow} >
      <span className={styles.seasonText}>
        <span className={styles.seasonTitle}>
          {flag ? <span aria-hidden="true">{flag} </span> : null}
          {title}
        </span>
        <span className={styles.seasonDetail}>{detail}</span>
      </span>
      <span className={styles.when}>{when}</span>
    </Link>
  );
}

