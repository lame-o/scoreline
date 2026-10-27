/**
 * The Schedule page for any scope, facing either way in time: Upcoming or
 * Results (`?mode=results`, the segmented control under the title, ⌥1 / ⌥2)
 * (SchedulePage.swift). Agenda scopes (everything, a league, a team, your
 * teams) share one layout per mode; climbing and CS2 have season pages.
 *
 *   /schedule                     everything you follow, by week
 *   /schedule/your-teams          your teams' season, by month
 *   /schedule/<league>            a league (week picker or game days)
 *   /schedule/team/<id>?name=…    a team's season
 *   /schedule/climbing            the climbing season (features/seasons)
 *   /schedule/tournaments         CS2's S-tier calendar (features/seasons)
 */
import { lazy, Suspense, useCallback } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { parseMode, parseScope, schedulePath, scopeTitle, type ScheduleMode, type ScheduleScope } from "../../data/schedule";
import { useDocumentTitle } from "../../app/useDocumentTitle";
import { NotFound } from "../../app/NotFound";

const ClimbingSeasonPage = lazy(() => import("../seasons/ClimbingSeasonPage").then((m) => ({ default: m.ClimbingSeasonPage })));
const TournamentsPage = lazy(() => import("../seasons/TournamentsPage").then((m) => ({ default: m.TournamentsPage })));
const AgendaPage = lazy(() => import("./AgendaPage").then((m) => ({ default: m.AgendaPage })));
const ResultsAgendaPage = lazy(() => import("./ResultsAgendaPage").then((m) => ({ default: m.ResultsAgendaPage })));

/** Props every schedule page body takes. */
export interface SchedulePageProps {
  readonly scope: ScheduleScope;
  readonly mode: ScheduleMode;
  /** The same scope facing the other way, in place; keys switch instantly. */
  readonly onMode: (mode: ScheduleMode, viaKeyboard: boolean) => void;
  /** True when this page replaced another in place (scope chips, mode switch): no entrance. */
  readonly switched: boolean;
  /** The mode switch was clicked (crossfade) rather than keyed (instant). */
  readonly crossfade: boolean;
}

export function SchedulePage() {
  const { scope: segment, teamID } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const scope = parseScope(segment, teamID, search);
  const mode = parseMode(search);
  const state = location.state as { inPlace?: boolean; viaKeyboard?: boolean; crossfade?: boolean } | null;
  useDocumentTitle(scope ? (mode === "results" ? `${scopeTitle(scope)} Results` : scopeTitle(scope)) : "Schedule");

  const onMode = useCallback(
    (next: ScheduleMode, viaKeyboard: boolean) => {
      if (!scope) return;
      navigate(schedulePath(scope, next), { replace: true, state: { inPlace: true, viaKeyboard, crossfade: !viaKeyboard } });
    },
    [navigate, scope],
  );

  if (!scope) return <NotFound />;
  const props: SchedulePageProps = { scope, mode, onMode, switched: Boolean(state?.inPlace), crossfade: Boolean(state?.crossfade) };
  return (
    <Suspense fallback={null}>
      {scope.kind === "climbing" ? (
        <ClimbingSeasonPage {...props} />
      ) : scope.kind === "tournaments" ? (
        <TournamentsPage {...props} />
      ) : mode === "results" ? (
        <ResultsAgendaPage key={`r:${segment ?? ""}:${teamID ?? ""}`} {...props} />
      ) : (
        <AgendaPage key={`u:${segment ?? ""}:${teamID ?? ""}`} {...props} />
      )}
    </Suspense>
  );
}
