import { Link } from "react-router";
import { leagueWithID } from "../../data/leagues";
import { settings, useSettings } from "../../state/settings";
import { useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { getJSON } from "../../data/http";
import { loadSoccerCompetition } from "../../data/soccerCompetition";
import { itemEvent, sortDate } from "../../data/schedule";
import { Button, EmptyState, ErrorState, StaleNote } from "../../design/components";
import { loadState, retrying } from "../../state/retry";
import { NotFound } from "../../app/NotFound";
import { useDocumentTitle } from "../../app/useDocumentTitle";
import { ScheduleRow } from "../schedule/ScheduleRow";
import { Section, SkeletonTable, TablePage } from "../standings/TablePage";
import { BracketView } from "./BracketView";
import styles from "./SoccerCompetitionPage.module.css";
import rows from "../schedule/ScheduleRow.module.css";

export function SoccerCompetitionPage() {
  const { slug, year: rawYear } = useParams();
  const [search] = useSearchParams();
  const ring = useMemo(() => new Set(search.get("ring")?.split(",").filter(Boolean) ?? []), [search]);
  const year = rawYear == null ? null : Number(rawYear);
  const valid = !!slug && /^[a-z0-9._-]+$/.test(slug) && (year == null || (Number.isInteger(year) && year >= 1900 && year <= 2200));
  const [selected, setSelected] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["soccerCompetition", slug, year],
    queryFn: ({ signal }) => loadSoccerCompetition(slug!, year, getJSON, signal),
    enabled: valid, staleTime: 60_000,
    ...retrying({ every: 60_000 }),
  });
  const data = query.data, load = loadState(query);
  const followed = useSettings(s => s.enabledLeagues.includes(slug ?? ""));
  const title = data ? `${data.title} ${data.seasonLabel}` : "Competition";
  useDocumentTitle(title);
  if (!valid) return <NotFound />;
  const stage = data?.stages.find((s) => s.id === selected) ?? data?.stages.find((s) => s.id === data.currentStage) ?? data?.stages[0];
  return (
    <TablePage title={title} trailing={<Button onClick={() => void query.refetch()} disabled={query.isFetching}>Refresh</Button>}
      footer={load.stale ? <StaleNote updated={load.updated} subject="competition" /> : null}>
      {() => data ? (
        <>
          {leagueWithID(slug!) ? <p className={styles.note}><Button aria-pressed={followed} onClick={() => settings.setEnabled(slug!, !followed)}>{followed ? "Following competition" : "Follow competition"}</Button>{" · "}<Link to={`/sports/competition/${slug}`}>Competition overview</Link></p> : null}
          {data.bracket ? <Section title="Bracket" caption="The score in each tie, over both legs or a whole series where there's more than one game. Lines carry each winner to the next round.">
            <BracketView bracket={data.bracket} ring={ring} />
          </Section> : data.undrawnFrom ? <EmptyState icon="trophy" title="No Bracket Yet" message={`It starts at the ${data.undrawnFrom}, once that's drawn. Until then, see the fixtures.`} /> : null}
          <label className={styles.stagePicker}>Round or stage
            <select value={stage?.id ?? ""} onChange={(e) => setSelected(e.target.value)}>
              {data.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          {stage ? <Section title={stage.name} caption="Fixtures and results. Open a match for its full detail.">
            {stage.games.length === 0 ? <EmptyState icon="trophy" title="Not Drawn Yet" message={`${stage.name} fixtures appear once the draw is made.`} /> :
              (stage.ties.length ? stage.ties : stage.games.map((game) => ({ id: game.id, match: null, games: [game] }))).map((tie) => <div className={styles.tie} key={tie.id}>
                {tie.games.length > 1 && tie.match?.note ? <p className={styles.note}>{tie.match?.note}</p> : null}
                {tie.games.map((item) => <div key={item.id}>
                  <p className={styles.date}>{new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(sortDate(item))}</p>
                  <div className={rows.rows} data-detail="compact">
                    <ScheduleRow item={item} event={itemEvent(item)} keyboard={false} detail="compact" showsCompetition={false} onHover={() => {}} />
                  </div>
                </div>)}
              </div>)}
          </Section> : null}
        </>
      ) : load.failed ? <ErrorState subject="Competition" retrying={load.retrying} onRetry={() => void query.refetch()} /> : <SkeletonTable rows={8} />}
    </TablePage>
  );
}
