import { useState } from "react";
import { useParams } from "react-router";
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
  const title = data?.title ?? "Competition";
  useDocumentTitle(title);
  if (!valid) return <NotFound />;
  const stage = data?.stages.find((s) => s.id === selected) ?? data?.stages.find((s) => s.id === data.currentStage) ?? data?.stages[0];
  return (
    <TablePage title={title} trailing={<Button onClick={() => void query.refetch()} disabled={query.isFetching}>Refresh</Button>}
      footer={load.stale ? <StaleNote updated={load.updated} subject="competition" /> : null}>
      {() => data ? (
        <>
          {data.bracket ? <Section title="Bracket" caption="Confirmed matchups. Two-leg ties show aggregate goals; penalties decide drawn ties.">
            <BracketView bracket={data.bracket} ring={new Set()} />
          </Section> : null}
          <label className={styles.stagePicker}>Round or stage
            <select value={stage?.id ?? ""} onChange={(e) => setSelected(e.target.value)}>
              {data.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          {stage ? <Section title={stage.name} caption={stage.hasLegs ? "Each tie and both legs. Open a match for its full detail." : "Fixtures and results. Open a match for its full detail."}>
            {stage.ties.length === 0 ? <EmptyState icon="trophy" title="Fixtures to Come" message="Fixtures have not been published for this round." /> :
              stage.ties.map((tie) => <div className={styles.tie} key={tie.id}>
                {stage.hasLegs && tie.match.note ? <p className={styles.note}>{tie.match.note}</p> : null}
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
