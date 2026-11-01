# Sports, competitions and following

Implemented in the isolated `feat/soccer-competitions` checkout, on top of the soccer competition increment. The local Mac build has been installed for interactive verification; this is not a published or deployed release. Claude's broadcast/choreography branches and the original checkout remain separate.

## Product contract

- **Sports** is the discovery browser. Choose a sport, search competitions, open a competition, or browse its team directory. Opening a row never subscribes. Its separate star follows that competition.
- **Following** owns global teams, competition order and scoped team selections, individual CS2 tournament editions and IFSC events, and team alert preferences.
- **Settings** retains appearance, window/tab behavior, live-game presentation, sounds, keyboard guidance and application preferences, with navigation to Sports and Following.
- A competition has **Overview**, **Teams**, and **Following** tabs. Overview opens its available schedule, results, season/stages, table, rankings or bracket. Teams follows a team globally. Following limits that competition to all games or selected teams. Climbing uses Countries for highlights, never hidden opponents.
- Following Premier League includes Premier League fixtures only. Following Liverpool independently includes Liverpool's available fixtures across competitions, including Carabao Cup. Match details identify the actual competition and explain global-team or edition inclusion. Overlapping subscriptions display a match once.
- An individual CS2 tournament or IFSC event uses a stable provider identity, never its display name. It does not enable every event in the sport. Climbing disciplines remain respected.
- New team follows start with alerts off. A team's bell enables alerts, subject to the master switch and OS/browser permission. Existing team alert behavior is preserved during migration. Competition and edition follows do not create notifications.

## Coverage

| Sport / source | Discovery and following | Detail capability |
| --- | --- | --- |
| Soccer | All catalog leagues/cups/tournaments; global teams; scoped team choices | Fixtures/results and season rounds; real knockout connections when provider evidence supports them; league/group tables where supported |
| NBA | League, global teams, scoped choices | Existing schedule/results, team pages and standings |
| WNBA | League, global teams, scoped choices; separate team ID namespace | Existing schedule/results; no invented standings or playoff adapter |
| NFL | League, global teams, scoped choices | Existing schedule/results and team pages |
| College football | League, global teams, scoped choices, Top 25 option | Existing schedule/results, standings and rankings |
| MLB | League, global teams, scoped choices | Existing schedule/results and postseason bracket |
| CS2 | Game scope, global teams, scoped choices, individual tournament editions | Existing S-tier tournament calendar, results and brackets |
| Climbing | Series, disciplines, country highlights, individual event editions | Existing season calendar, rounds and results |

Sports is bounded by the existing catalog and providers. It is not a claim of universal sports coverage. NBA/WNBA/NFL/college postseason brackets need explicit provider adapters; none are fabricated. CS2 remains S-tier. Soccer matches in uncataloged cups can open their competition season, but those cups cannot yet be followed as catalog competitions. A global team's schedule supplies its next fixture; supplemental live polling resolves catalog competitions only. No new user-account synchronization or background push service is introduced.

## Persistence and migration

Web keeps `scoreline.settings.v1` so startup theme loading and older releases still find preferences; the payload now has `schemaVersion: 2`. Native uses `followingSchemaVersion: 2`. New additive fields are `editions` / `followedEditions` and `mutedTeams` / `mutedFollowedTeams`.

Existing order, enabled competitions, nonempty scoped selections, hidden selections, appearance and notification intent survive. Legacy empty scoped selections previously meant all games; migration turns off those empty filters once. In schema 2, selecting zero teams means zero games. Turning off a competition preserves its picks and never removes a global team follow.

WNBA team IDs now use `espn-wnba-ID`, separated from NBA's `espn-basketball-ID`. Scoped WNBA selections migrate automatically. Legacy global basketball follows did not store a league, so ambiguous old entries cannot be relabeled safely; they retain their previous interpretation. A previously global WNBA team may need to be unfollowed and followed again from WNBA's directory. New follows do not collide.

Stored edition identities are validated and deduplicated. Malformed cross-tab settings JSON is ignored rather than crashing. Removing a team removes its alert override. Live polling is independent of competition visibility, and overlapping events are deduplicated before rendering/counting.

## Design and implementation

The implementation reuses the existing PageHeader/BackButton, GroupBox, segmented controls, outline grouping, ListRowStyle, form columns, semantic colors, motion/reduced-motion system, typography and light/dark theme. It does not replace the app's design system or alter broadcast/theater rendering.

Native entry points: AddSportsView, ManageView, LeagueSettingsView, RootView, FollowingPolicy and ScoreStore. Web: SportsPage, FollowingPage, LeaguePage, settings store, following policy and scoreboard derivation. Existing league settings URLs remain valid aliases. Competition row navigation and follow actions are separate controls; team directories have one selection meaning per tab.

## Validation

See the final handoff for exact run results and screenshots. Reproduce with `./test.sh`; web `tsc -b`, `vitest run`, `cf build`; Playwright `following.spec.ts` and `competitions.spec.ts` against `SCORELINE_URL`. The native opt-in render path is `SCORELINE_RENDER_FOLLOWING=/absolute/output ./build/ScorelineTests`, using an isolated, temporary preferences suite, fixture networking and no installation.

Release gate: review the diff, reconcile Claude's current branch, resolve or explicitly account for the existing native figure-rendering failures, and smoke-test provider-backed behavior in a separately installed build before publishing. Passing fixture tests does not establish availability of every live provider or make this a released build.

### Recorded local checks, 2026-11-01

- Web: all 1,444 tests in 74 files passed (`vitest run --maxWorkers=2`); all TypeScript programs and Cloudflare production build passed. An earlier unconstrained parallel run timed out in one existing football animation test; the bounded full rerun passed without a code or timeout change.
- Browser: four scenarios passed (Following and soccer competitions, each at 390px dark and 1280px light), covering scoped/global independence, persistence, alerts, edition identity, match/round navigation, stale refresh, horizontal overflow and an axe accessibility scan of Following. These are deterministic mocked-provider checks.
- Native: final DEBUG typecheck passed. Focused recompilation passed 346 checks, zero failures, covering schedules, results, season results, outlines, following policy and soccer competition behavior.
- The broader native run passed 2,771 checks and reported three failures: an obsolete fallback-back-navigation assertion (corrected and passed in the focused rerun), plus the same two baseline figure-rendering failures documented in SOCCER-COMPETITIONS.md. The two remaining failures are whole-figure fading (64/255) and referee stripes/slacks, previously reproduced against untouched release 1.0.28. No figure/theater code is changed here.
- Twelve native offscreen content captures cover Sports, Following and Settings at 340/600 points in light/dark appearance. They use a temporary test preferences domain and do not reproduce the window compositor's glass/vibrancy. They do not replace an installed-build interactive smoke test.
- Optimized Apple silicon app compiled and passed `codesign --verify --deep --strict`. Icon conversion required access to macOS system services outside the sandbox; packaging/signing then completed using the existing build steps. The initial ad-hoc-signed review archive was exported without installation. The subsequent installed-app correction and verification are recorded in the handoff.

### Installed verification after the Carabao correction

The optimized `be73a75` build is installed locally. From Liverpool history, both reported goal rows open animated replays, and the match’s competition link loads the actual Carabao season with all four confirmed quarterfinal paths. The original installed app/preferences are backed up. Focused native checks: 351 passed; full web suite: 1,445 passed; TypeScript/production web build passed; two updated competition browser scenarios passed. No public release or web deployment was performed.
