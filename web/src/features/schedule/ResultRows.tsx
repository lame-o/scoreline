/**
 * Results, row by row (ResultRows.swift): a team's side of a result, the
 * form strip (W filled, D tinted, L outlined: weight carries the outcome,
 * red stays reserved for live), the readout of the pointed-at game, a team's
 * season card, the team's-eye result row, and (beside the round from 680pt)
 * the season's rounds with your teams' results in them.
 */
import { memo, useState } from "react";
import { Link } from "react-router";
import { Icon, TeamLogo } from "../../design/components";
import { compareDays, shortDayLabel } from "../../data/days";
import { enDash } from "../../data/format";
import type { Sport } from "../../data/models";
import { RED_CARD, spokenTeamResult, teamResult } from "../../data/results";
import { itemTeams, type FormMark, type ResultRound, type ScheduleItem, type ScheduleTeam, type TeamSeason } from "../../data/schedule";
import { tooltip } from "./ScheduleRow";
import styles from "./ResultRows.module.css";

// MARK: - Form strip

/**
 * A team's last results as letters in ink, oldest on the left. Pointing at a
 * mark rings it and names the game in the readout; clicking opens it.
 */
export function FormStrip({ marks, hovered, onHover, href }: { marks: readonly FormMark[]; hovered: string | null; onHover: (id: string | null) => void; href: (id: string) => string }) {
  return (
    // A labeled group of links: a link given the listitem role stops being a link.
    <div className={styles.strip} role="group" aria-label={`Form, last ${marks.length}, oldest to newest`} onPointerLeave={() => onHover(null)}>
      {marks.map((mark, i) => (
        <Link
          key={`${mark.itemID}-${i}`}
          to={href(mark.itemID)}
          className={styles.mark}
          data-letter={mark.letter}
          data-lit={hovered === mark.itemID}
          aria-label={mark.spoken}
          title={mark.readout}
          onPointerEnter={() => onHover(mark.itemID)}
          onFocus={() => onHover(mark.itemID)}
          onBlur={() => onHover(null)}
        >
          {mark.letter}
        </Link>
      ))}
    </div>
  );
}

/** The readout under a form strip: the pointed-at game, else the latest. */
function FormReadout({ marks, hovered }: { marks: readonly FormMark[]; hovered: string | null }) {
  const mark = marks.find((m) => m.itemID === hovered) ?? marks[marks.length - 1];
  return (
    <p className={styles.readout} aria-hidden="true">
      {mark?.readout ?? ""}
    </p>
  );
}

const gameHref = (id: string) => `/game/${encodeURIComponent(id)}`;

// MARK: - Team season card

/** A team's season at a glance: record and standing, the counts, goals (points, runs) for and against, and the form strip. */
export const TeamSeasonCard = memo(function TeamSeasonCard({ season, sport }: { season: TeamSeason; sport: Sport | null }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const resolved = sport ?? season.results[0]?.sport ?? null;
  const standing = [season.record ? enDash(season.record) : null, season.isCurrent ? season.standing : null].filter(Boolean).join(" · ");
  const counts = [`${season.played} played`, `W ${season.won}`, ...(resolved === "soccer" || season.drawn > 0 ? [`${resolved === "soccer" ? "D" : "T"} ${season.drawn}`] : []), `L ${season.lost}`].join(" · ");
  const draws = resolved === "soccer" ? "drawn" : "tied";
  const spoken = `${season.played} played, ${season.won} won, ${season.drawn > 0 || resolved === "soccer" ? `${season.drawn} ${draws}, ` : ""}${season.lost} lost`;
  const noun = resolved === "soccer" ? "Goals" : resolved === "baseball" ? "Runs" : resolved === "esports" ? "Maps" : "Points";
  const marks = season.form.slice(-5);
  return (
    <section className={styles.card} aria-label={`${season.team.name}, ${season.season}`}>
      <h2 className={styles.cardTitle}>
        <TeamLogo url={season.team.logo} size={16} />
        <span>
          {season.team.name} · {season.season}
        </span>
      </h2>
      {standing ? <p className={styles.cardLine}>{standing}</p> : null}
      <p className={styles.cardLine} aria-label={spoken}>
        {resolved === "soccer" ? <span className={styles.cardLabel}>All competitions </span> : null}
        {counts}
      </p>
      {season.scoredFor != null && season.scoredAgainst != null && season.played > 0 ? (
        <p className={styles.cardLine}>
          {noun} {season.scoredFor}–{season.scoredAgainst}
        </p>
      ) : null}
      {marks.length ? (
        <>
          <div className={styles.formRow}>
            <span className={styles.formLabel} aria-hidden="true">
              Form
            </span>
            <FormStrip marks={marks} hovered={hovered} onHover={setHovered} href={gameHref} />
          </div>
          <FormReadout marks={marks} hovered={hovered} />
        </>
      ) : null}
    </section>
  );
});

// MARK: - Team result row

const spokenDate = new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" });

/**
 * A result from the team's side, as a game log reads: date, opponent crest,
 * "vs Everton" / "at Bayern", and "W 2–0"; a second line names the
 * competition and the game's details.
 */
export const TeamResultRow = memo(function TeamResultRow({ item, team, details, keyboard, onHover }: { item: ScheduleItem; team: string; details: boolean; keyboard: boolean; onHover: (id: string) => void }) {
  const r = teamResult(item, team);
  const story = item.result?.context ?? (details ? item.result?.details : null);
  const second = [item.competition, story].filter(Boolean).join(" · ") || null;
  const spoken = [
    spokenDate.format(new Date(item.day.year, item.day.month - 1, item.day.day, 12)),
    r.opponent ? `${r.home ? "versus" : "at"} ${r.opponent.name}` : null,
    (() => {
      const s = spokenTeamResult(r);
      return s ? s + (r.shootout ? " after penalties" : "") : null;
    })(),
    item.status === "postponed" ? "postponed" : null,
    second?.replaceAll(`${RED_CARD} `, "red card "),
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <Link to={gameHref(item.id)} className={styles.teamRow} data-nav-id={item.id} data-keyboard={keyboard} aria-label={spoken} title={tooltip(item)} onPointerEnter={() => onHover(item.id)}>
      <span className={styles.teamLine} aria-hidden="true">
        <span className={styles.date}>{shortDayLabel(item.day)}</span>
        <TeamLogo url={r.opponent?.logo ?? null} size={14} />
        <span className={styles.opponent}>
          {r.home ? "vs" : "at"} {r.opponent?.name ?? "TBD"}
        </span>
        <span className={styles.flex} />
        {item.status === "postponed" || item.status === "canceled" ? (
          <span className={item.status === "canceled" ? styles.quiet : styles.warn}>{item.result?.label ?? (item.status === "canceled" ? "Canceled" : "Postponed")}</span>
        ) : r.letter ? (
          <span className={styles.outcome} data-lost={r.letter === "L"}>
            <strong>{r.letter}</strong>
            {r.score ? ` ${r.score}` : ""}
            {r.shootout ? <span className={styles.quiet}> (P)</span> : null}
          </span>
        ) : (
          <span className={styles.quiet}>{item.result?.label ?? item.statusDetail ?? ""}</span>
        )}
      </span>
      {second ? (
        <span className={styles.teamSecond} aria-hidden="true">
          {second.includes(RED_CARD)
            ? second.split(RED_CARD).flatMap((part, i) => (i === 0 ? [part] : [<span key={i} className={styles.redCard} />, part]))
            : second}
        </span>
      ) : null}
    </Link>
  );
});

// MARK: - Rounds beside the round (split)

/**
 * Beside the round (from 680pt): the season's rounds newest first, each
 * with your teams' result in it ("ARS W 2–0"), the selected one lit; then
 * your teams' form. Clicking a round selects it in place.
 */
export function RoundsList({ sections, rounds, selected, seasons, onSelect }: { sections: readonly { title: string; options: readonly { id: string; title: string; detail: string }[] }[]; rounds: readonly ResultRound[]; selected: string | null; seasons: readonly TeamSeason[]; onSelect: (id: string, viaKeyboard: boolean) => void }) {
  const inline = (id: string) => {
    const round = rounds.find((r) => r.id === id);
    if (!round) return null;
    const parts = seasons.flatMap((season) => {
      const item = season.results.find((i) => compareDays(round.first, i.day) <= 0 && compareDays(i.day, round.last) <= 0);
      if (!item) return [];
      const r = teamResult(item, season.team.id);
      if (!r.letter) return [];
      const code = itemTeams(item).find((t) => t.id === season.team.id)?.abbreviation ?? "";
      return [[code, r.letter, r.score].filter(Boolean).join(" ")];
    });
    return parts.length ? parts.join(" · ") : null;
  };
  return (
    <nav className={styles.rounds} aria-label="Rounds">
      {sections.map((section, i) => (
        <div key={section.title || i}>
          {section.title ? <h2 className={styles.roundsTitle}>{section.title}</h2> : null}
          {section.options.map((o) => {
            const mine = inline(o.id);
            return (
              <button key={o.id} type="button" className={styles.round} aria-current={o.id === selected ? "true" : undefined} onClick={(e) => onSelect(o.id, e.detail === 0)}>
                <span className={styles.roundTitle}>{o.title}</span>
                {o.detail && o.detail !== o.title ? <span className={styles.roundDetail}>{o.detail}</span> : null}
                <span className={styles.flex} />
                {mine ? <span className={styles.roundMine}>{mine}</span> : null}
              </button>
            );
          })}
        </div>
      ))}
      {seasons.length ? (
        <div className={styles.yourTeams}>
          <h2 className={styles.roundsTitle}>
            <Icon name="star" size={8.5} /> Your Teams · Form
          </h2>
          {seasons.map((s) => (
            <YourTeamForm key={s.team.id} season={s} />
          ))}
        </div>
      ) : null}
    </nav>
  );
}

/** A followed team's line under the rounds: crest, name, the last ten as a form strip, its standing. */
function YourTeamForm({ season }: { season: TeamSeason }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const marks = season.form.slice(-10);
  return (
    <div className={styles.yourTeam}>
      <span className={styles.yourTeamLine}>
        <TeamLogo url={season.team.logo} size={14} />
        <span className={styles.yourTeamName}>{season.team.name}</span>
        <span className={styles.flex} />
        {season.standing ? <span className={styles.roundDetail}>{season.standing.split(" in ")[0]}</span> : null}
      </span>
      <FormStrip marks={marks} hovered={hovered} onHover={setHovered} href={gameHref} />
      <FormReadout marks={marks} hovered={hovered} />
    </div>
  );
}
