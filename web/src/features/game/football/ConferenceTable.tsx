/**
 * A college game's conference table (DetailView.swift `.table` for college,
 * College.swift `ConferenceTable`): each team's conference, ranked by
 * conference record with the season record alongside, one place either side
 * of each team (two when the table has a wide column to itself), AP ranks
 * before names, a live score beside any team playing now. The standings
 * page's own table (features/standings/Tables.tsx), so the two never differ.
 */
import { useMemo, useRef } from "react";
import { collegeWindow, liveScores, widthClassOf, type StandingsRow } from "../../../data/standings";
import { useWidth, WIDTH } from "../../../design/useWidth";
import { useScoreboard } from "../../../state/scores";
import { ConferenceTable, HighlightWord } from "../../standings/Tables";

/** The highlighted rows are the two teams playing. */
const inThisMatch = () => "in this match";

export function CollegeTable({ rows, ids, ranks, leagueID }: { rows: readonly StandingsRow[]; ids: readonly (string | null)[]; ranks: Readonly<Record<string, number>>; leagueID: string }) {
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box, 360);
  const highlight = useMemo(() => new Set(ids.filter((id): id is string => id != null)), [ids]);
  // Two places either side when the table has a wide column to itself (more of the race around them), else one.
  const reach = width >= WIDTH.xlarge ? 2 : 1;
  const shown = useMemo(() => collegeWindow(rows, highlight, reach), [rows, highlight, reach]);
  // Teams playing now, from the scores the sidebar (or this page) already polls.
  const events = useScoreboard({ poll: false }).results[leagueID]?.events;
  const live = useMemo(() => liveScores(events ?? []), [events]);
  return (
    <div ref={box}>
      <HighlightWord.Provider value={inThisMatch}>
        <ConferenceTable group={shown[0]?.group ?? ""} rows={shown} highlight={highlight} ranks={ranks} live={live} width={widthClassOf(width)} />
      </HighlightWord.Provider>
    </div>
  );
}
