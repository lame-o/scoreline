# Soccer competition tracking

Soccer matches now open their competition season: all provider-defined rounds, fixtures and results. Carabao Cup and FA Cup are selectable in Your Sports on Mac and web. Existing UEFA, World Cup and domestic league entries use the same page. Cups outside the catalog remain accessible through their match pages.

## Behavior

- Mac: open a soccer match's **Competition** section, or **Season · Rounds and Results** in a soccer competition's Overview. Web uses `/competition/:slug/:year?` from the equivalent links.
- The selected round starts at the provider's current stage. Earlier rounds and pending rounds remain available in the picker. Match rows open the existing game detail page.
- Two-leg ties retain both fixtures and use ESPN's series aggregate scores and series winner. A winning first leg never establishes advancement. Shootout winners can advance with a drawn regulation score.
- A complete connected bracket appears when a final and confirmed earlier winners establish actual connections. Before the final is drawn, separate bracket paths connect the latest drawn knockout round to confirmed winners in the preceding round. Earlier fixtures remain in the round selector; future pairings are never inferred. Unplayed ties display no score. Undrawn future rounds stay pending. Group and league stages are match lists, not knockout brackets. Standings retain their existing separate views.
- Following a cup uses existing settings persistence; this change does not enable it by default.
- Refresh failures keep the last loaded data visible with a stale notice. A failed year fetch or capped monthly response fails the load rather than publishing a truncated season.

## Data and implementation

`Sources/Scoreline/SoccerCompetition.swift` and `web/src/data/soccerCompetition.ts` contain equivalent models, pure parsers and loaders. They reuse the existing bracket and schedule-row components; CS2 and MLB providers are unchanged.

The core season endpoint supplies stage metadata, including `type`, `hasLegs`, `hasStandings`, `hasGroups`, `isFinal` and `isThirdPlace`. Fetch the season's calendar years with `scoreboard?dates=YYYY&limit=1000`, then filter each event by `season.year`. A year at the cap is split into months; another cap is an error. Do not use `season=...&seasontype=...` on scoreboard to retrieve a soccer round: investigation found it could return an unrelated current board.

Schedule links retain the ESPN sport/competition path, including uncataloged soccer cups. Team schedules can supply `soccer/all`; new and cached schedule items normalize this to the validated competition slug before opening a match or its season; the game loader accepts a validated soccer path without adding that competition to settings.

The web core API stays on the existing direct-CORS route; site scoreboards use the existing Worker proxy. No new backend, secrets or proxy permissions.

## Cup replay regression

The Mac page previously required a `League.catalog` entry before loading its soccer feed. A team-history cup game could display summary goals but never load the positioned plays that make those rows replayable. `SoccerFeedRequest` now derives eligibility and the request from `EventRef`; only the separate standings request requires a catalog league.

Recorded case: Liverpool–Chelsea, Carabao Cup, event `401921842`, October 28, 2026. Both goals have positioned replay data. Tests also cover an uncataloged cup so merely adding Carabao Cup to the catalog cannot mask a recurrence.

## Verification and handoff

Fixtures in both test trees cover the current Carabao season, a completed season's two-leg semifinals/final, and Champions League stage metadata. The browser tests cover 390px dark and 1280px light layouts, pending rounds, match navigation, bracket rendering and stale refresh state. Images are blocked in those deterministic tests, so screenshots use crest placeholders.

Run the native suite with `./test.sh`; run web `tsc -b`, `pnpm test`, `pnpm build`, and the focused Playwright `competitions.spec.ts`. Browser tests can use any running local server via `SCORELINE_URL`.

This season/bracket increment is soccer only; the subsequent cross-sport discovery and following implementation is documented in [FOLLOWING.md](FOLLOWING.md). NBA/WNBA, NFL and college playoff adapters remain subsequent work. Claude's broadcast/choreography synchronization branches were not merged. Changes are local until explicitly integrated and released; the installed app and public web deployment do not acquire this feature from a passing test.

### Local validation on 2026-11-01

- Web: 1,430 unit/Worker tests passed, all four TypeScript programs passed, Cloudflare production build passed, and two browser scenarios passed (390px dark and 1280px light). Each scenario opens a fixture, verifies its competition-season return link, switches rounds, renders a completed bracket and tests a failed refresh.
- Native: DEBUG app typecheck and the test build passed. The full offline run passed 2,751 checks and reported three failures: an outdated assertion that grouped Carabao Cup under Premier League (updated for its new catalog entry), plus two figure-rendering checks. All 12 new competition/replay checks passed in that run.
- The two figure-rendering failures were reproduced separately against the untouched `9d842ed` source: whole-figure fading (64/255 pixels apart) and referee stripes/slacks. They are outside this change; no theater/rendering implementation was modified.
- The focused native rerun recompiled the updated source and tests and passed **168 checks, zero failures**, including agenda grouping, page modules, replays and soccer competitions.
- At this initial checkpoint, no native app installation, deployment, push or merge was performed. See the subsequent installed-app correction below.

### Installed-app correction, 2026-11-01

The initial implementation stopped before installation, so the running app retained its old behavior. Interactive verification after installing the first build confirmed both goals replayed, but exposed a generic `soccer/all` path in team history and the absence of current-round bracket paths. The fixes above cover fresh and cached history and display all four confirmed Carabao quarterfinal paths, including Liverpool–Chelsea feeding Liverpool–Bournemouth. Regression tests cover these exact cases in native and web code. Final installation verification is recorded in the handoff.
