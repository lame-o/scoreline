/**
 * The polls, one level below the scores or a match: the AP Top 25 and the
 * Coaches Poll, switchable (College.swift `RankingsView`, `PollList`). Each
 * is a ranked list: movement since last week, crest, record, points with
 * first-place votes in parentheses. On a wide page it reads down two columns,
 * as in print (1–13, then 14–25): the same rows either way.
 *
 *     /rankings/college-football?ring=espn-ncaaf-26,espn-ncaaf-84
 */
import { memo, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { EmptyState, ErrorState, Icon, SegmentedControl, TeamLogo } from "../../design/components";
import { leagueWithID } from "../../data/leagues";
import { movement, perColumn, pollLabel, pollPoints, spokenPollEntry, type Poll, type PollEntry } from "../../data/college";
import { useSettings } from "../../state/settings";
import { useRankings } from "../../state/standings";
import { useDocumentTitle } from "../../app/useDocumentTitle";
import { NotFound } from "../../app/NotFound";
import { teamRef } from "../../data/profiles/models";
import { TeamLink } from "../profiles/ProfileLinks";
import { Section, SkeletonTable, TablePage } from "./TablePage";
import styles from "./RankingsPage.module.css";

const followedSelector = (s: { followed: readonly { id: string }[] }) => s.followed;

export function RankingsPage() {
  const { league: id } = useParams();
  const league = id ? leagueWithID(id) : undefined;
  useDocumentTitle("Top 25");
  const path = league?.source.kind === "espn" ? league.source.path : null;
  const polls = useRankings(path);
  const [search] = useSearchParams();
  const followed = useSettings(followedSelector);
  const highlight = useMemo(() => new Set([...(search.get("ring") ?? "").split(",").filter(Boolean), ...followed.map((t) => t.id)]), [search, followed]);
  const [selected, setSelected] = useState<string | null>(null);
  if (!league || !path) return <NotFound />;
  const list = polls.data ?? [];
  const poll = list.find((p) => p.name === selected) ?? list[0];
  return (
    <TablePage title="Top 25">
      {(layout) =>
        poll ? (
          <>
            {list.length > 1 ? (
              <div className={styles.picker}>
                <SegmentedControl
                  label="Poll"
                  value={poll.name}
                  onChange={(name) => setSelected(name)}
                  options={list.map((p) => ({ value: p.name, label: pollLabel(p.name) }))}
                />
              </div>
            ) : null}
            <Section title={poll.headline ?? poll.name} caption="Arrows show moves since last week. Points, first-place votes in parentheses.">
              <PollList poll={poll} highlight={highlight} columns={layout.split ? 2 : 1} />
            </Section>
          </>
        ) : polls.isPending ? (
          <SkeletonTable rows={25} />
        ) : polls.isError ? (
          <ErrorState subject="Rankings" onRetry={() => void polls.refetch()} />
        ) : (
          <EmptyState icon="list" title="No Rankings Yet" message="This week's polls haven't been published yet." />
        )
      }
    </TablePage>
  );
}

/** The poll as a ranked list, read down each column. */
const PollList = memo(function PollList({ poll, highlight, columns }: { poll: Poll; highlight: ReadonlySet<string>; columns: number }) {
  const rows = perColumn(poll.entries.length, columns);
  return (
    <ol className={styles.list} style={{ gridTemplateRows: `repeat(${rows}, auto)`, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }} aria-label={poll.name}>
      {poll.entries.map((e) => (
        <PollRow key={e.teamID} entry={e} mine={highlight.has(e.teamID)} />
      ))}
    </ol>
  );
});

const PollRow = memo(function PollRow({ entry, mine }: { entry: PollEntry; mine: boolean }) {
  const points = pollPoints(entry);
  return (
    <li>
      <TeamLink
        team={teamRef({ id: entry.teamID, name: entry.name, logo: entry.logo, league: "college-football" })}
        variant="plain"
        className={styles.row}
        dataset={{ mine }}
        label={spokenPollEntry(entry) + (mine ? ", your team" : "")}
        draggable={false}
      >
        <span className={styles.rank}>{entry.rank}</span>
        <span className={styles.move}>
          <Move entry={entry} />
        </span>
        <TeamLogo url={entry.logo} size={15} />
        <span className={styles.name} data-mine={mine}>
          {entry.name}
        </span>
        {entry.record ? <span className={styles.record}>{entry.record.replaceAll("-", "–")}</span> : null}
        <span className={styles.spacer} />
        {points ? <span className={styles.points}>{points}</span> : null}
      </TeamLink>
    </li>
  );
});

/** ▲3 green, ▼2 red, NEW in the accent, – when unchanged. */
function Move({ entry }: { entry: PollEntry }) {
  const m = movement(entry);
  if (entry.previous == null) {
    return (
      <span className={styles.new} title="Not ranked last week">
        NEW
      </span>
    );
  }
  if (m == null || m === 0) {
    return (
      <span className={styles.same} title="Same as last week">
        –
      </span>
    );
  }
  return (
    <span className={m > 0 ? styles.up : styles.down} title={m > 0 ? `Up ${m} from last week` : `Down ${-m} from last week`}>
      <Icon name={m > 0 ? "triangleUp" : "triangleDown"} size={6.5} />
      {Math.abs(m)}
    </span>
  );
}
