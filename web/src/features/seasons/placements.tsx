/**
 * A finished CS2 tournament's champion and placings (EventResultsPage.swift
 * `ChampionCard`, `PlacementsTable`): "🏆 Vitality · Champions", how the
 * final went and the tournament's facts; then place (on a tie group's first
 * row only), team (opens its page) and prize money. Followed teams are
 * starred and highlighted, as in the list.
 */
import { memo } from "react";
import { Link } from "react-router";
import { Icon, TeamLogo } from "../../design/components";
import { dayRangeLabel } from "../../data/days";
import { plural } from "../../data/format";
import type { Placement } from "../../data/schedule";
import { eventFlag, prize } from "../../data/seasons";
import { lastPlace, type FinishedTournament } from "../../data/seasonResults";
import { textWidth } from "../scores/measure";
import { csTeamPath } from "./links";
import { TournamentLogo } from "./parts";
import styles from "./placements.module.css";

/** "Oct 3–11 · 🇩🇪 Cologne, Germany · LAN · $1M · 16 teams" */
function facts(t: FinishedTournament): string {
  const e = t.event;
  const parts = [dayRangeLabel(e.startDay, e.endDay)];
  if (e.place) parts.push([eventFlag(e), e.place].filter(Boolean).join(" "));
  if (e.format) parts.push(e.format);
  const money = prize(e.prize);
  if (money) parts.push(money);
  // The field's size, when the placings account for all of it ("15th–16th" of 16).
  const last = t.placements[t.placements.length - 1];
  if (last && lastPlace(last) === t.placements.length) parts.push(plural(t.placements.length, "team"));
  return parts.join(" · ");
}

export function ChampionCard({ tournament: t, final }: { tournament: FinishedTournament; final: string | null }) {
  const top = t.placements[0];
  const shared = top ? t.placements.filter((p) => p.order === top.order) : [];
  const champion = top && shared.length === 1 ? top : null;
  return (
    <div className={styles.champion}>
      {champion ? <TeamLogo url={champion.team.logo} size={28} /> : <TournamentLogo url={t.event.logo} size={28} />}
      <div className={styles.championText}>
        {champion && champion.place === "1st" ? (
          <>
            <p className={styles.championLine}>
              <span aria-hidden="true">🏆</span>
              <Link className={styles.championName} to={csTeamPath(champion.team)}>
                {champion.team.name}
              </Link>
              <span className={styles.championWord}>Champions</span>
            </p>
            {final ? <p className={styles.final}>{final}</p> : null}
          </>
        ) : top ? (
          // A qualification stage: its top places go through together.
          <p className={styles.sharedLine}>{`${top.place}: ${shared.map((p) => p.team.name).join(", ")}`}</p>
        ) : (
          <>
            <p className={styles.sharedLine}>{t.event.name}</p>
            <p className={styles.facts}>Results not published yet.</p>
          </>
        )}
        <p className={styles.facts}>{facts(t)}</p>
      </div>
    </div>
  );
}

/** The widest place label ("17th–24th"), measured once per table. */
function placeWidth(placements: readonly Placement[]): number {
  const widest = [...new Set(placements.map((p) => p.place))].reduce((w, place) => Math.max(w, textWidth(place, 11, 600)), 0);
  return Math.min(Math.max(Math.ceil(widest) + 4, 30), 80);
}

export function PlacementsTable({ placements, followed }: { placements: readonly Placement[]; followed: ReadonlySet<string> }) {
  const showsMoney = placements.some((p) => prize(p.money) != null);
  const width = placeWidth(placements);
  return (
    <ol className={styles.table} style={{ ["--place-width" as string]: `calc(${width} * var(--pt))` }}>
      {placements.map((p, i) => {
        const first = i === 0 || placements[i - 1]!.place !== p.place;
        return <PlacementRow key={`${p.team.id ?? p.team.name}-${i}`} placement={p} showsPlace={first} gap={first && i > 0} showsMoney={showsMoney} followed={p.team.id != null && followed.has(p.team.id)} />;
      })}
    </ol>
  );
}

const PlacementRow = memo(function PlacementRow({ placement: p, showsPlace, gap, showsMoney, followed }: { placement: Placement; showsPlace: boolean; gap: boolean; showsMoney: boolean; followed: boolean }) {
  const money = prize(p.money);
  const club = prize(p.clubMoney);
  return (
    <li className={styles.row} data-followed={followed} data-gap={gap}>
      <span className={[styles.place, p.order <= 3 ? styles.podium : null].filter(Boolean).join(" ")}>
        {showsPlace ? p.place : <span className="visually-hidden">{p.place}</span>}
      </span>
      <TeamLogo url={p.team.logo} size={16} />
      <Link className={styles.team} to={csTeamPath(p.team)}>
        {p.team.name}
      </Link>
      {followed ? <Icon name="star" size={7} className={styles.star} label="Following" /> : null}
      <span className={styles.spacer} />
      {showsMoney && money ? (
        <span className={styles.money} title={club ? `Club prize ${club}` : "Prize money"}>
          {money}
        </span>
      ) : null}
    </li>
  );
});
