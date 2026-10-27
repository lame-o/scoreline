/**
 * A tournament's full picture, one level below a match (Brackets.swift
 * `BracketPage`): the Swiss stage if there is one, then the playoff tree.
 * The originating match's teams are ringed (`?ring=`, competitor IDs).
 *
 *   /bracket/mlb/2026                          the MLB postseason, from ESPN's daily boards
 *   /bracket/cs2/<slug>?name=…&ring=cs-793      a CS2 tournament (S-tier), from bo3.gg
 */
import { useMemo } from "react";
import { useParams, useSearchParams } from "react-router";
import { EmptyState, ErrorState } from "../../design/components";
import { ringIDs } from "../../data/brackets";
import type { BracketSource } from "../../data/schedule";
import { useBracket } from "../../state/standings";
import { useDocumentTitle } from "../../app/useDocumentTitle";
import { NotFound } from "../../app/NotFound";
import { Section, SkeletonTable, TablePage } from "../standings/TablePage";
import { BracketView } from "./BracketView";
import { SwissLadder } from "./SwissLadder";
import styles from "./Brackets.module.css";

/** The source a bracket path names (`bracketPath` in data/schedule.ts), or null. */
export function parseBracketSource(league: string | undefined, id: string | undefined, search: URLSearchParams): BracketSource | null {
  if (!league || !id) return null;
  if (league === "cs2") return { kind: "csTournament", slug: id, name: search.get("name") ?? "Tournament" };
  const year = Number(id);
  if (league === "mlb" && Number.isInteger(year)) return { kind: "espnPostseason", path: "baseball/mlb", year };
  return null;
}

export function BracketPage() {
  const { league, id } = useParams();
  const [search] = useSearchParams();
  const source = useMemo(() => parseBracketSource(league, id, search), [league, id, search]);
  const ring = useMemo(() => ringIDs((search.get("ring") ?? "").split(",").filter(Boolean)), [search]);
  const query = useBracket(source);
  const fallback = source ? (source.kind === "espnPostseason" ? `${source.year} Postseason` : source.name) : "Bracket";
  const title = query.data?.title ?? fallback;
  useDocumentTitle(title);
  if (!source) return <NotFound />;
  const data = query.data;
  return (
    <TablePage title={title}>
      {(layout) =>
        data ? (
          data.swiss == null && data.bracket == null ? (
            <EmptyState icon="trophy" title="No Bracket Yet" message="The bracket appears once the matchups are set." />
          ) : (
            <>
              {data.swiss ? (
                <Section title="Swiss Stage" caption={`${data.swiss.winsToAdvance} wins go through, ${data.swiss.winsToAdvance} losses go home.`}>
                  <SwissLadder stage={data.swiss} ring={ring} width={layout.page} />
                </Section>
              ) : null}
              {data.bracket ? (
                <Section
                  title={data.swiss == null ? "Bracket" : "Playoffs"}
                  caption={
                    source.kind === "espnPostseason"
                      ? "Series wins in each matchup. Lines carry each winner to the next round."
                      : "Maps won in each match. Lines carry each winner to the next round."
                  }
                >
                  <BracketView bracket={data.bracket} ring={ring} />
                </Section>
              ) : null}
            </>
          )
        ) : query.isError ? (
          <ErrorState subject="Bracket" onRetry={() => void query.refetch()} />
        ) : (
          <div className={styles.loading}>
            <SkeletonTable rows={8} />
          </div>
        )
      }
    </TablePage>
  );
}
