/**
 * The CS2 match page's lists (DetailView.swift `MapList`, `StreamList`,
 * `StreamRow`, `RosterColumns`, `CoStreamIcon`):
 *
 * - `MapList`: each map with its number, name (or "Not picked yet"), live
 *   state and rounds won, the winner's crest at the end. The live map reads
 *   bo3.gg's snapshot, which knows the map being played before the match
 *   record does; its digits roll.
 * - `StreamList`: the co-streamer first when bo3.gg lists their channel,
 *   then bo3.gg's streams, official first, five at most, each with its
 *   platform's glyph; Twitch, YouTube and Kick only (data/cs2.ts).
 * - `RosterColumns`: the two lineups side by side, a hairline between: flag,
 *   nickname and real name, each row opening the player's page; the coach
 *   below.
 * - `CoStreamBadge`: "ohnePixel is co-streaming", under the hero.
 */
import { memo } from "react";
import { Icon, LiveDot, ScoreDigits, TeamLogo } from "../../../design/components";
import { PLATFORM_NAME, platform, viewers, type CSPlayer, type Roster } from "../../../data/cs2";
import type { MapResult, Stream } from "../../../data/gameDetail";
import type { Competitor, CSLive } from "../../../data/models";
import { counterStrikePlayerRef, linkNameClass, PlayerLink, TeamLink, teamRefFrom } from "../../profiles/ProfileLinks";
import styles from "./CounterStrike.module.css";

// MARK: - Maps

export const MapList = memo(function MapList({ maps, final, live, top, bottom }: { maps: readonly MapResult[]; final: boolean; live: CSLive | null; top: Competitor; bottom: Competitor }) {
  return (
    <div className={styles.maps}>
      {maps.map((map) => (
        <MapRow key={map.number} map={map} final={final} live={live} top={top} bottom={bottom} />
      ))}
    </div>
  );
});

function MapRow({ map, final, live, top, bottom }: { map: MapResult; final: boolean; live: CSLive | null; top: Competitor; bottom: Competitor }) {
  // The live feed knows the map being played before the match record does.
  const feed = map.live && (live?.mapNumber == null || live.mapNumber === map.number) ? live : null;
  const name = map.name !== "TBD" ? map.name : (feed?.mapName ?? map.name);
  const picked = name !== "TBD";
  const t = map.topScore ?? feed?.topScore ?? null;
  const b = map.bottomScore ?? feed?.bottomScore ?? null;
  const winner = map.winner === "top" ? top : map.winner === "bottom" ? bottom : null;
  const spoken = (() => {
    const named = picked ? name : "not picked yet";
    if (t == null || b == null) return `Map ${map.number}, ${named}.`;
    return `Map ${map.number}, ${named}: ${top.name} ${t}, ${bottom.name} ${b}.${map.live ? " Live." : ""}${winner ? ` ${winner.name} won.` : ""}`;
  })();
  return (
    <div className={styles.mapRow} role="group" aria-label={spoken}>
      <span className={styles.mapNumber} aria-hidden="true">
        {map.number}
      </span>
      <span className={styles.mapName} data-picked={picked} aria-hidden="true">
        {picked ? name : "Not picked yet"}
      </span>
      {map.live ? (
        <span className={styles.mapLive} aria-hidden="true">
          <LiveDot />
          Live
        </span>
      ) : null}
      <span className={styles.spacer} />
      {t != null && b != null ? (
        <span className={styles.mapScore} aria-hidden="true">
          <span data-won={map.winner === "top"} data-lost={map.winner === "bottom"}>
            <ScoreDigits value={String(t)} live={map.live} flash={false} />
          </span>
          <span className={styles.mapDash}>–</span>
          <span data-won={map.winner === "bottom"} data-lost={map.winner === "top"}>
            <ScoreDigits value={String(b)} live={map.live} flash={false} />
          </span>
        </span>
      ) : final || map.live || picked ? (
        // An unpicked map that hasn't started needs no second "not".
        <span className={styles.mapStatus} aria-hidden="true">
          {final ? "Not played" : map.live ? "In progress" : "Not started"}
        </span>
      ) : null}
      {/* The winner's crest rather than a truncated name. */}
      <span className={styles.mapWinner} aria-hidden="true" title={winner ? `${winner.name} won ${name}` : undefined}>
        {winner ? <TeamLogo url={winner.logo} size={14} /> : null}
      </span>
    </div>
  );
}

// MARK: - Streams

const PLATFORM_ICON = { twitch: "broadcast", youtube: "play", kick: "playFill" } as const;

export const StreamList = memo(function StreamList({ streams, coStream }: { streams: readonly Stream[]; coStream: { name: string; url: string } | null }) {
  return (
    <ul className={styles.streams}>
      {coStream ? (
        <li>
          <a className={styles.stream} data-highlight="true" href={coStream.url} target="_blank" rel="noopener noreferrer" aria-label={`Twitch, ${coStream.name}, co-streaming. Opens in a new tab.`} title="Watch on Twitch">
            <span className={styles.streamIcon}>
              <CoStreamIcon />
            </span>
            <span className={styles.streamName}>{coStream.name}</span>
            <span className={styles.streamDetail}>Co-streaming</span>
            <Icon name="external" size={9} className={styles.arrow} />
          </a>
        </li>
      ) : null}
      {streams.slice(0, 5).map((s) => {
        const where = platform(s.url);
        const detail = [s.official ? "Official" : null, s.language?.toUpperCase() ?? null, viewers(s.viewers)].filter(Boolean).join(" · ");
        const said = [where ? PLATFORM_NAME[where] : null, s.name, detail.replaceAll(" · ", ", ")].filter(Boolean).join(", ");
        return (
          <li key={s.id}>
            <a className={styles.stream} href={s.url} target="_blank" rel="noopener noreferrer" aria-label={`${said}. Opens in a new tab.`} title={`Open ${new URL(s.url).hostname.replace(/^www\./, "")}`}>
              <span className={styles.streamIcon} data-platform={where ?? undefined} title={where ? PLATFORM_NAME[where] : "Stream"}>
                <Icon name={where ? PLATFORM_ICON[where] : "tv"} size={11} />
              </span>
              <span className={styles.streamName}>{s.name}</span>
              <span className={styles.streamDetail}>{detail}</span>
              <Icon name="external" size={9} className={styles.arrow} />
            </a>
          </li>
        );
      })}
    </ul>
  );
});

/** The co-streamer's mark: a live glyph in a purple ring. (The Mac shows their Twitch avatar, read through decapi.me.) */
function CoStreamIcon() {
  return (
    <span className={styles.coIcon} aria-hidden="true">
      <Icon name="broadcast" size={9} />
    </span>
  );
}

/** "ohnePixel is co-streaming ↗", a glass capsule under the hero that opens their channel. */
export function CoStreamBadge({ name, url }: { name: string; url: string }) {
  return (
    <div className={styles.badgeRow}>
      <a className={styles.badge} href={url} target="_blank" rel="noopener noreferrer" title="Watch on Twitch">
        <CoStreamIcon />
        {name} is co-streaming
        <Icon name="external" size={8.5} className={styles.arrow} />
      </a>
    </div>
  );
}

// MARK: - Rosters

export const RosterColumns = memo(function RosterColumns({ top, bottom, topTeam, bottomTeam }: { top: Roster; bottom: Roster; topTeam: Competitor; bottomTeam: Competitor }) {
  return (
    <div className={styles.rosters}>
      <RosterColumn roster={top} team={topTeam} />
      <span className={styles.rosterRule} aria-hidden="true" />
      <RosterColumn roster={bottom} team={bottomTeam} />
    </div>
  );
});

function RosterColumn({ roster, team }: { roster: Roster; team: Competitor }) {
  const ref = teamRefFrom(team, "cs2");
  return (
    <div className={styles.roster} role="group" aria-label={`${team.name} lineup`}>
      <div className={styles.rosterTeam}>
        <TeamLogo url={team.logo} size={14} />
        <TeamLink team={ref}>{team.name}</TeamLink>
      </div>
      {roster.players.length === 0 && roster.coach == null ? <p className={styles.empty}>Lineup not available.</p> : null}
      {roster.players.map((p) => (
        <PlayerRow key={p.id} player={p} team={ref} />
      ))}
      {roster.coach ? (
        <div className={styles.coach} title={[roster.coach.nickname, roster.coach.realName].filter(Boolean).join(" — ")} aria-label={`Coach, ${roster.coach.nickname}`} role="group">
          <span className={styles.flag} aria-hidden="true">
            {roster.coach.flag ?? ""}
          </span>
          <span className={styles.playerText} aria-hidden="true">
            {/* Drawn in caps, read as written ("Coach"). */}
            <span className={styles.coachLabel}>Coach</span>
            <span className={styles.coachName}>{roster.coach.nickname}</span>
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** A player opens their page (bo3.gg's, by slug): the whole row is the link. */
function PlayerRow({ player: p, team }: { player: CSPlayer; team: ReturnType<typeof teamRefFrom> }) {
  const ref = p.slug ? counterStrikePlayerRef(p.slug, p.nickname, { id: String(p.id), photo: p.photo, country: p.country, team }) : null;
  const content = (
    <>
      <span className={styles.flag} aria-hidden="true">
        {p.flag ?? ""}
      </span>
      <span className={styles.playerText}>
        <span className={[styles.nickname, linkNameClass].join(" ")}>{p.nickname}</span>
        {p.realName ? <span className={styles.realName}>{p.realName}</span> : null}
      </span>
    </>
  );
  return ref ? (
    <PlayerLink player={ref} variant="row" className={styles.player} label={[p.nickname, p.realName].filter(Boolean).join(", ")} title={`Open ${p.nickname}`}>
      {content}
    </PlayerLink>
  ) : (
    <div className={styles.player} title={[p.nickname, p.realName].filter(Boolean).join(" — ")}>
      {content}
    </div>
  );
}
