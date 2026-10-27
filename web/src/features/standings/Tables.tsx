/**
 * League tables: the soccer table (LiveViews.swift `StandingsTable`), the
 * NBA's seeds (BasketballViews.swift `NBAStandingsTable`) and a college
 * conference (College.swift `ConferenceTable`, `ConferenceLeaderLine`),
 * plus the pieces they share: the movement arrow, the live score, the
 * projected note, the gap mark and zone lines, and two-column placement
 * (StandingsView.swift `GroupColumns`).
 *
 * Wider tables add columns, never bigger type. Rows glide to their projected
 * places when live results change the order (a layout spring, never a
 * bounce; Reduce Motion skips it). Each row is a link to the team's page,
 * labeled with the row in words.
 */
import { m } from "motion/react";
import { createContext, Fragment, memo, useContext, type CSSProperties, type ReactNode } from "react";
import { Icon, LiveDot, OutlineCrest, TeamLogo, outlineReveal } from "../../design/components";
import { spring } from "../../design/motion";
import {
  COLLEGE_KEY,
  COLUMN_HELP,
  COLUMN_TITLE,
  COLUMN_WIDTH,
  columnValue,
  conferenceColumns,
  groupColumns,
  leaderKind,
  leaderRecords,
  nbaZone,
  showsZones,
  spokenConferenceRow,
  spokenNBARow,
  spokenTableRow,
  tableColumns,
  zoneBoundary,
  type LiveStandingsRow,
  type NBALiveRow,
  type StandingsRow,
  type TableColumn,
  type TableGroup,
  type WidthClass,
} from "../../data/standings";
import { teamRef } from "../../data/profiles/models";
import { TeamLink } from "../profiles/ProfileLinks";
import styles from "./Tables.module.css";

const pt = (n: number): CSSProperties => ({ width: `calc(${n} * var(--pt))` });

// MARK: - Shared pieces

/** ▲2 / ▼1 against the official table or seeding; nothing when unchanged. */
export function Movement({ value, against = "the official table", count = false }: { value: number | null; against?: string; count?: boolean }) {
  if (!value) return null;
  const up = value > 0;
  return (
    <span className={up ? styles.up : styles.down} title={up ? `Up ${value} from ${against}` : `Down ${-value} from ${against}`}>
      <Icon name={up ? "triangleUp" : "triangleDown"} size={6.5} />
      {count ? Math.abs(value) : null}
    </span>
  );
}

/** "● 2–1": this team is playing now. */
export function LiveScore({ score }: { score: string }) {
  return (
    <span className={styles.liveScore} title="Playing now">
      <LiveDot />
      <span>{score}</span>
    </span>
  );
}

/** Spans the page above the tables while live scores move them. */
export function ProjectedNote({ children }: { children: string }) {
  return (
    <p className={styles.projected}>
      <LiveDot />
      <span>{children}</span>
    </p>
  );
}

/** Rows skipped (a window around two teams): mark the gap. */
function Gap() {
  return (
    <div className={styles.gap} title="Teams in between hidden" aria-hidden="true">
      <Icon name="ellipsis" size={9} />
    </div>
  );
}

/** A hairline where a zone begins, labeled with what its places earn (unlabeled where mid-table resumes). */
function ZoneLine({ label, help }: { label: string | null; help?: string }) {
  return (
    <div className={styles.zone} data-labeled={label != null} title={help ?? label ?? undefined} aria-hidden="true">
      {label ? <span className={styles.zoneLabel}>{label}</span> : null}
      <span className={styles.zoneRule} />
    </div>
  );
}

/**
 * What a highlighted row says after its line: "your team" for a followed
 * team; a game page's table says "in this match" for the two teams playing,
 * and the standings page says that for the match it was opened from (`?ring=`).
 */
export const HighlightWord = createContext<(id: string) => string>(() => "your team");

/** A table's groups sit under the page's h1, or under a column's h2 title (GroupColumns): headings never skip a level. */
const UnderColumnTitle = createContext(false);

function GroupLabel({ title, first }: { title: string; first: boolean }) {
  const Heading = useContext(UnderColumnTitle) ? "h3" : "h2";
  return (
    <Heading className={styles.groupLabel} data-first={first}>
      {title}
    </Heading>
  );
}

/**
 * A row that glides to its place when the order changes (only then: the
 * layout is measured when `order` changes, never on a resize); a link to the team.
 */
function TableRow({ id, label, mine, order, children, reveal }: { id: string; label: string; mine: boolean; order: string; children: ReactNode; reveal?: { className?: string; style?: CSSProperties } }) {
  return (
    <m.div layout="position" layoutDependency={order} transition={spring.travel} className={[styles.rowWrap, reveal?.className].filter(Boolean).join(" ")} style={reveal?.style}>
      {/* The row opens the team's page (TeamRowLink); a dwell prefetches it. */}
      <TeamLink team={teamRef({ id, name: "" })} variant="plain" className={styles.row} dataset={{ mine }} label={label} draggable={false}>
        {children}
      </TeamLink>
    </m.div>
  );
}

function Name({ name, mine, rank }: { name: string; mine: boolean; rank?: number | null }) {
  return (
    <span className={styles.identity}>
      {rank != null ? (
        <span className={styles.apRank} title={`No. ${rank} in the AP Top 25`}>
          {rank}
        </span>
      ) : null}
      <span className={styles.name} data-mine={mine}>
        {name}
      </span>
    </span>
  );
}

// MARK: - Soccer (StandingsTable)

/**
 * A league table that re-ranks live, with movement arrows against the
 * official table. W-D-L from medium, goals for and against from large, and at
 * xlarge the zones the places earn, as labeled hairlines where each begins.
 */
export const StandingsTable = memo(function StandingsTable({ rows, highlight, width }: { rows: readonly LiveStandingsRow[]; highlight: ReadonlySet<string>; width: WidthClass }) {
  const columns = tableColumns(width);
  const zones = showsZones(width, rows);
  const grouped = new Set(rows.map((r) => r.row.group).filter(Boolean)).size > 1;
  const order = rows.map((r) => r.id).join(",");
  return (
    <div className={styles.table}>
      <div className={styles.head} aria-hidden="true">
        <span style={pt(30)} title="Position">
          #
        </span>
        <span className={styles.teamHead}>Team</span>
        {columns.map((c) => (
          <span key={c} className={styles.num} style={pt(COLUMN_WIDTH[c])} title={COLUMN_HELP[c]}>
            {COLUMN_TITLE[c]}
          </span>
        ))}
      </div>
      {rows.map((r, index) => {
        const prev = rows[index - 1];
        const newGroup = grouped && r.row.group !== (prev?.row.group ?? null) && r.row.group != null;
        const boundary = zones ? zoneBoundary(index, rows) : null;
        return (
          <Fragment key={r.id}>
            {newGroup ? <GroupLabel title={r.row.group!} first={index === 0} /> : prev && prev.position + 1 < r.position ? <Gap /> : null}
            {boundary ? <ZoneLine label={boundary.label} /> : null}
            <SoccerRow r={r} columns={columns} zones={zones} mine={highlight.has(r.id)} order={order} />
          </Fragment>
        );
      })}
    </div>
  );
});

const SoccerRow = memo(function SoccerRow({ r, columns, zones, mine, order }: { r: LiveStandingsRow; columns: readonly TableColumn[]; zones: boolean; mine: boolean; order: string }) {
  const word = useContext(HighlightWord);
  return (
    <TableRow id={r.id} label={spokenTableRow(r, columns, zones, false) + (mine ? `, ${word(r.id)}` : "")} mine={mine} order={order}>
      <span className={styles.rank} style={pt(30)}>
        <span>{r.liveRank}</span>
        <Movement value={r.movement} />
      </span>
      <TeamLogo url={r.row.logo} size={15} />
      <Name name={r.row.name} mine={mine} />
      {r.liveScore ? <LiveScore score={r.liveScore} /> : null}
      <span className={styles.spacer} />
      {columns.map((c) => (
        <span key={c} className={c === "points" ? styles.points : styles.cell} style={pt(COLUMN_WIDTH[c])}>
          {columnValue(c, r)}
        </span>
      ))}
    </TableRow>
  );
});

// MARK: - NBA (NBAStandingsTable)

/**
 * NBA conference standings by seed, re-ranked live, with movement arrows
 * against the official seeding. Hairlines mark the play-in (7–10) and the
 * lottery (11–15).
 */
export const NBAStandingsTable = memo(function NBAStandingsTable({ rows, highlight }: { rows: readonly NBALiveRow[]; highlight: ReadonlySet<string> }) {
  const grouped = new Set(rows.map((r) => r.row.group).filter(Boolean)).size > 1;
  const order = rows.map((r) => r.id).join(",");
  return (
    <div className={styles.table}>
      <div className={styles.head} aria-hidden="true">
        <span style={pt(30)} title="Seed">
          #
        </span>
        <span className={styles.teamHead}>Team</span>
        <span className={styles.num} style={pt(40)} title="Wins and losses">
          W-L
        </span>
        <span className={styles.num} style={pt(36)} title="Win percentage">
          PCT
        </span>
        <span className={styles.num} style={pt(28)} title="Games behind the conference leader">
          GB
        </span>
      </div>
      {rows.map((r, index) => {
        const prev = rows[index - 1];
        const sameGroup = prev?.row.group === r.row.group;
        const zone = prev && sameGroup && prev.liveRank + 1 >= r.liveRank ? nbaZone(prev.liveRank) : null;
        return (
          <Fragment key={r.id}>
            {grouped && !sameGroup && r.row.group ? (
              <GroupLabel title={r.row.group} first={index === 0} />
            ) : prev && sameGroup && prev.liveRank + 1 < r.liveRank ? (
              <Gap />
            ) : zone ? (
              <ZoneLine label={zone.label} help={zone.help} />
            ) : null}
            <NBARow r={r} mine={highlight.has(r.id)} order={order} />
          </Fragment>
        );
      })}
    </div>
  );
});

const NBARow = memo(function NBARow({ r, mine, order }: { r: NBALiveRow; mine: boolean; order: string }) {
  const word = useContext(HighlightWord);
  return (
    <TableRow id={r.id} label={spokenNBARow(r) + (mine ? `, ${word(r.id)}` : "")} mine={mine} order={order}>
      <span className={styles.rank} style={pt(30)}>
        <span>{r.liveRank}</span>
        <Movement value={r.movement} against="the official seeding" />
      </span>
      <TeamLogo url={r.row.logo} size={15} />
      <Name name={r.row.name} mine={mine} />
      {r.liveScore ? <LiveScore score={r.liveScore} /> : null}
      <span className={styles.spacer} />
      <span className={styles.points} style={pt(40)}>
        {r.wins}-{r.losses}
      </span>
      <span className={styles.cell} style={pt(36)}>
        {r.percentText}
      </span>
      <span className={styles.cell} style={pt(28)}>
        {r.gamesBehind}
      </span>
    </TableRow>
  );
});

// MARK: - College (ConferenceTable)

/**
 * One conference (or division), ranked by conference record with the season
 * record alongside; AP ranks before names; a live score beside any team
 * playing now. The streak from medium, home and away from large, points for
 * and against from xlarge, each only when the rows carry it. Opened from its
 * header by a click, rows arrive top to bottom (the scores list's stagger).
 */
export const ConferenceTable = memo(function ConferenceTable({
  group,
  rows,
  highlight,
  ranks,
  live,
  width,
  revealing = false,
  linking = false,
}: {
  group: string;
  rows: readonly StandingsRow[];
  highlight: ReadonlySet<string>;
  ranks: Readonly<Record<string, number>>;
  live: Readonly<Record<string, string>>;
  width: WidthClass;
  revealing?: boolean;
  linking?: boolean;
}) {
  const word = useContext(HighlightWord);
  const columns = conferenceColumns(width, rows);
  const grouped = new Set(rows.map((r) => r.group).filter(Boolean)).size > 1;
  const head = outlineReveal(0, revealing);
  const order = rows.map((r) => r.id).join(",");
  return (
    <div className={styles.table}>
      <div className={[styles.head, head.className].filter(Boolean).join(" ")} style={head.style} aria-hidden="true">
        <span style={pt(22)} title="Place in the conference">
          #
        </span>
        <span className={styles.teamHead}>Team</span>
        <span className={styles.num} style={pt(40)} title="Conference record">
          Conf
        </span>
        <span className={styles.num} style={pt(48)} title="Season record">
          Overall
        </span>
        {columns.homeAway ? (
          <>
            <span className={styles.num} style={pt(36)} title="Home record">
              Home
            </span>
            <span className={styles.num} style={pt(36)} title="Away record">
              Away
            </span>
          </>
        ) : null}
        {columns.points ? (
          <>
            <span className={styles.num} style={pt(30)} title="Points for">
              PF
            </span>
            <span className={styles.num} style={pt(30)} title="Points against">
              PA
            </span>
          </>
        ) : null}
        {columns.streak ? (
          <span className={styles.num} style={pt(30)} title="Current streak">
            Strk
          </span>
        ) : null}
      </div>
      {rows.map((r, index) => {
        const prev = rows[index - 1];
        const mine = highlight.has(r.id);
        return (
          <Fragment key={r.id}>
            {grouped && r.group !== (prev?.group ?? null) && r.group ? <GroupLabel title={r.group} first={index === 0} /> : prev && prev.group === r.group && prev.rank + 1 < r.rank ? <Gap /> : null}
            <TableRow id={r.id} label={spokenConferenceRow(r, columns, ranks[r.id], live[r.id]) + (mine ? `, ${word(r.id)}` : "")} mine={mine} order={order} reveal={outlineReveal(index + 1, revealing)}>
              <span className={styles.rank} style={pt(22)}>
                {r.rank}
              </span>
              {/* The leader's crest travels from the collapsed line to its row. */}
              {index === 0 ? <OutlineCrest group={group} id={r.id} logo={r.logo} size={15} linking={linking} /> : <TeamLogo url={r.logo} size={15} />}
              <Name name={r.name} mine={mine} rank={ranks[r.id]} />
              {live[r.id] ? <LiveScore score={live[r.id]!} /> : null}
              <span className={styles.spacer} />
              <span className={styles.points} style={pt(40)}>
                {r.conference ?? "–"}
              </span>
              <span className={styles.cell} style={pt(48)}>
                {r.overall ?? "–"}
              </span>
              {columns.homeAway ? (
                <>
                  <span className={styles.cell} style={pt(36)}>
                    {r.details[COLLEGE_KEY.home] ?? "–"}
                  </span>
                  <span className={styles.cell} style={pt(36)}>
                    {r.details[COLLEGE_KEY.away] ?? "–"}
                  </span>
                </>
              ) : null}
              {columns.points ? (
                <>
                  <span className={styles.cell} style={pt(30)}>
                    {r.details[COLLEGE_KEY.pointsFor] ?? "–"}
                  </span>
                  <span className={styles.cell} style={pt(30)}>
                    {r.details[COLLEGE_KEY.pointsAgainst] ?? "–"}
                  </span>
                </>
              ) : null}
              {/* A streak is a fact, not a verdict: never coloured. */}
              {columns.streak ? (
                <span className={styles.cell} style={pt(30)}>
                  {r.streak ?? "–"}
                </span>
              ) : null}
            </TableRow>
          </Fragment>
        );
      })}
    </div>
  );
});

/**
 * A collapsed conference's one line: who leads it, with the season and
 * conference records ("Leader  UCLA  7–0 · 5–0 Conf"). Independents show the
 * best record instead.
 */
export function LeaderLine({ group, row, rank, linking = false, reveal }: { group: string; row: StandingsRow; rank?: number; linking?: boolean; reveal?: boolean }) {
  const kind = leaderKind(row);
  return (
    <span className={[styles.leader, reveal ? styles.leaderReveal : null].filter(Boolean).join(" ")} aria-hidden="true">
      {kind === "none" ? (
        <span className={styles.leaderWord}>No games yet</span>
      ) : (
        <>
          <span className={styles.leaderWord}>{kind === "leader" ? "Leader" : "Best Record"}</span>
          <OutlineCrest group={group} id={row.id} logo={row.logo} size={14} linking={linking} />
          <span className={styles.leaderName}>
            {rank != null ? <span className={styles.apRank}>{rank}</span> : null}
            <span className={styles.leaderTeam}>{row.name}</span>
          </span>
          <span className={styles.leaderRecords}>{leaderRecords(row, kind)}</span>
        </>
      )}
    </span>
  );
}

// MARK: - Two columns (GroupColumns)

/**
 * Grouped tables side by side: each group (its title over its own table)
 * goes in whichever column has fewer rows so far. Placement comes from row
 * counts alone, so live re-ranking never moves a group, and each column keeps
 * the source's order.
 */
export function GroupColumns<R>({ groups, titles = true, render }: { groups: readonly TableGroup<R>[]; titles?: boolean; render: (group: TableGroup<R>) => ReactNode }) {
  const columns = groupColumns(groups.map((g) => g.rows.length));
  return (
    <div className={styles.columns}>
      {columns.map((indices, c) => (
        <div key={c} className={styles.column}>
          {indices.map((i, k) => {
            const group = groups[i]!;
            return (
              <div key={group.title} className={titles ? styles.titledGroup : undefined}>
                {titles ? (
                  <h2 className={styles.columnTitle} data-first={k === 0}>
                    {group.title}
                  </h2>
                ) : null}
                <UnderColumnTitle.Provider value={titles}>{render(group)}</UnderColumnTitle.Provider>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
