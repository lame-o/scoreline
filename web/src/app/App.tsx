/**
 * The root: data (TanStack Query), appearance, and the router.
 *
 * Routes (React Router, lazy-loaded so the scores list paints first):
 *   /                       the scores (phone) or "no game selected" (split)
 *   /game/:id               a game's page (`?league=` lets one off the scoreboards load; `gameHref`)
 *   /settings               Settings; /settings/league/:id a league's teams and options
 *   /schedule[/:scope]      schedules and results (`?mode=results`); /schedule/team/:id a team's
 *   /results/climbing/:event/:dcat, /results/tournament/:slug   results deeper than a row
 *   /standings/:league      tables; /rankings/:league polls; /bracket/:league/:id brackets
 *   /team/:id, /player/:id  team and player pages (features/profiles; `teamHref`, `playerHref`)
 *   /dev/theater            development only: the play theater's preview (/football, /soccer: theirs; `?t=` freezes)
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { LazyMotion, MotionConfig } from "motion/react";
import { createBrowserRouter, RouterProvider } from "react-router";
import { queryClient } from "../state/scores";
import { useApplyTheme } from "../state/theme";
import { AppShell, ShellFrame } from "./AppShell";
import { IndexRoute } from "./IndexRoute";
import { NotFound } from "./NotFound";
import { RouteError } from "./RouteError";

const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    // A link straight to a page waits for that page's chunk: the frame paints meanwhile, never a blank window.
    hydrateFallbackElement: <ShellFrame />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <IndexRoute /> },
      { path: "game/:id", lazy: () => import("../features/game/GamePage").then((m) => ({ Component: m.GamePage })) },
      { path: "settings", lazy: () => import("../features/settings/SettingsPage").then((m) => ({ Component: m.SettingsPage })) },
      { path: "settings/league/:id", lazy: () => import("../features/settings/LeaguePage").then((m) => ({ Component: m.LeaguePage })) },
      { path: "schedule/team/:teamID", lazy: () => import("../features/schedule/SchedulePage").then((m) => ({ Component: m.SchedulePage })) },
      { path: "schedule/:scope?", lazy: () => import("../features/schedule/SchedulePage").then((m) => ({ Component: m.SchedulePage })) },
      { path: "results/climbing/:eventID/:dcatID", lazy: () => import("../features/seasons/EventResultsPage").then((m) => ({ Component: m.EventResultsPage })) },
      { path: "results/tournament/:slug", lazy: () => import("../features/seasons/EventResultsPage").then((m) => ({ Component: m.EventResultsPage })) },
      { path: "standings/:league", lazy: () => import("../features/standings/StandingsPage").then((m) => ({ Component: m.StandingsPage })) },
      { path: "rankings/:league", lazy: () => import("../features/standings/RankingsPage").then((m) => ({ Component: m.RankingsPage })) },
      { path: "bracket/:league/:id", lazy: () => import("../features/brackets/BracketPage").then((m) => ({ Component: m.BracketPage })) },
      { path: "team/:id", lazy: () => import("../features/profiles/TeamPage").then((m) => ({ Component: m.TeamPage })) },
      { path: "player/:id", lazy: () => import("../features/profiles/PlayerPage").then((m) => ({ Component: m.PlayerPage })) },
      // Development only: the play theater on recorded World Series plays (the render harness).
      ...(import.meta.env.DEV
        ? [
            { path: "dev/theater", lazy: () => import("../features/game/mlb/theater/PlayTheaterPreview").then((m) => ({ Component: () => <m.PlayTheaterPreview /> })) },
            { path: "dev/theater/football", lazy: () => import("../features/game/football/theater/FootballTheaterPreview").then((m) => ({ Component: m.FootballTheaterPreview })) },
            { path: "dev/theater/soccer", lazy: () => import("../features/game/soccer/theater/SoccerTheaterPreview").then((m) => ({ Component: m.SoccerTheaterPreview })) },
          ]
        : []),
      { path: "*", element: <NotFound /> },
    ],
  },
]);

const loadMotionFeatures = () => import("../design/motion-features").then((m) => m.default);

function Theme() {
  useApplyTheme();
  return null;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* motion follows the system's Reduce Motion everywhere; its features load after first paint. */}
      <MotionConfig reducedMotion="user">
        <LazyMotion features={loadMotionFeatures}>
          <Theme />
          <RouterProvider router={router} />
        </LazyMotion>
      </MotionConfig>
    </QueryClientProvider>
  );
}
