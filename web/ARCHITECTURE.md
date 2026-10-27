# Scoreline for the web: architecture

Scoreline for the web is the macOS app (`../Sources/Scoreline`) as a web app on Cloudflare Workers. The aim is complete parity with the Mac app, and the same bar: native-feeling, calm, precise, snappy, interruptible. This document is the contract for everyone building on it. Read it before adding a page, a parser or a style.

- [Run it](#run-it)
- [Structure](#structure)
- [The Worker and the upstream allowlist](#the-worker-and-the-upstream-allowlist)
- [Data layer](#data-layer)
- [State: settings and live scores](#state-settings-and-live-scores)
- [Design system](#design-system)
- [Motion](#motion)
- [Layout, navigation and keyboard](#layout-navigation-and-keyboard)
- [Accessibility](#accessibility)
- [Performance](#performance)
- [Testing](#testing)
- [Conventions](#conventions)
- [Parity checklist](#parity-checklist)

## Run it

Use pnpm (one store shared across worktrees) and Node 22.15 or later. Node 22.18 or later is better: `cf` loads `cloudflare.config.ts` with Node's type stripping, which older 22.x builds only have behind a flag. The package scripts pass that flag, so `pnpm build` works on both. A bare `cf build` needs Node 22.18 or later. `.nvmrc` says 24.

```sh
pnpm install
pnpm dev             # cf dev: Vite plus the Worker in workerd, on http://localhost:5173
pnpm build           # cf build: client assets and the Worker bundle (must pass)
pnpm preview         # build, then serve the built output locally
pnpm typecheck       # generates Worker types (cf workers types), then tsc -b over all four programs
pnpm test            # Vitest: parsers, scoreboard logic, settings, tokens' contrast
pnpm test:e2e        # Playwright smoke and live-state tests against `pnpm dev`
pnpm fixtures [src]  # re-record trimmed fixtures from the live feeds (espn | bo3 | ifsc | teams)
```

`http://localhost:5173/?demo` (development only) replays the fixtures with games in progress: clocks run, scores change on every Refresh, strips draw. Use it to see and screenshot live states at any hour. It stays on for the tab until the tab closes. See `src/data/demo.ts`.

Deploying is `pnpm deploy` (`cf deploy`). The config has no `accountId` on purpose, because the repo is public: choose the account at deploy time. Workers Logs and Traces are on, with traces sampled at 10%.

## Structure

```
web/
  cloudflare.config.ts     Worker, SPA assets, /api/* first, Workers Caching, observability
  vite.config.ts           React and Cloudflare plugins, library chunks
  index.html               theme applied before first paint
  shared/upstreams.ts      the upstream allowlist and cache policies (Worker and client share it)
  worker/                  index.ts (routes /api/*), proxy.ts (allowlist, Cache API, headers)
  src/
    main.tsx               styles, the ?demo harness (dev only), <App/>
    app/                   App (router, providers), AppShell (split view), navigation, IndexRoute, errors
    data/                  pure TypeScript ported from Swift: models, catalog, parsers, formatting
      providers/           one file per source: espn.ts, counterStrike.ts, ifsc.ts, teams.ts
    state/                 settings (localStorage store), scores (TanStack Query), clock tickers, theme
    design/                tokens.css, base.css, motion.ts, icons.tsx, useWidth.ts
      components/          the design system (index.ts exports it all)
    features/              one folder per area: scores/, game/, settings/, schedule/, seasons/, standings/, brackets/, placeholders/
  test/
    unit/                  Vitest
    worker/                Vitest, the proxy with the Cache API and fetch stubbed
    e2e/                   Playwright (smoke, live, schedules, seasons, standings)
    fixtures/              small trimmed JSON (recorded, plus *.synthetic.json live states)
  scripts/record-fixtures.mjs
```

Four TypeScript programs with different globals:

- `tsconfig.app.json`: the browser app (`src`, `shared`).
- `tsconfig.worker.json`: the Worker (`worker`, `shared`), with workerd's runtime types generated into `.cloudflare/types` by `pnpm types`.
- `tsconfig.node.json`: tooling and e2e.
- `tsconfig.test.json`: unit tests, which are app code plus Node.

All of them run in strict mode with `noUncheckedIndexedAccess`.

## The Worker and the upstream allowlist

The browser never calls a sports feed directly. It calls `/api/<host><path>?<query>`, and the Worker fetches the upstream, as long as it's on the allowlist in `shared/upstreams.ts`. Turning an upstream URL into its proxy path is mechanical, so a URL copied from the Swift sources works as is:

```ts
import { getJSON } from "../data/http";
const board = await getJSON("https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard");
// fetches /api/site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard
```

`proxyPath()` throws for anything off the list, so a missing entry fails loudly in development. These hosts and path prefixes are allowed:

| Host | Prefixes | Notes |
| --- | --- | --- |
| `site.api.espn.com` | `/apis/site/v2/sports/`, `/apis/v2/sports/` | scoreboards, summaries, teams, rankings, standings |
| `sports.core.api.espn.com` | `/v2/` | plays, probabilities, seasons, brackets |
| `site.web.api.espn.com` | `/apis/common/v3/` | athlete and team profiles |
| `api.bo3.gg` | `/api/v1/` | CS2, S-tier only (`CounterStrike.TIER`). It ignores `[gte]`/`[lte]` on `start_date` (every match since 2020 comes back): bound a window with `[gt]`/`[lt]` |
| `ifsc.results.info` | `/api/v1/` | the Worker adds the `Referer` the service requires |
| `statsapi.mlb.com` | `/api/` | Statcast |

Nothing else is proxied. Images are never proxied: `<img>` loads logos from their CDNs, sized by the CDN (`src/data/images.ts`: ESPN's combiner and bo3.gg's image proxy, which turns a 90 KB crest into 5 KB). YouTube (the climbing streams), decapi.me (Twitch co-streams) and FotMob (soccer photos and injuries) are not on the list. A feature that needs one of them needs the owner's decision first.

Each response is cached at the edge for as long as its kind of data stays true. Policies are matched by path, first match wins, and live at the top of `shared/upstreams.ts`:

| Policy | Edge | Browser | Used for |
| --- | --- | --- | --- |
| `LIVE` | 15s | 5s | scoreboards, summaries, plays, live rounds |
| `SHORT` | 60s | 15s | match lists, event pages, the fallback |
| `TABLES` | 10 min | 2 min | standings, polls |
| `SCHEDULE` | 30 min | 5 min | team schedules, seasons, profiles |
| `CATALOG` | 6 h | 1 h | team lists |

How the caching works (`worker/proxy.ts`):

- The Cache API holds each successful response under its upstream URL, stamped with the time it was fetched. On a hit, the response says how long the copy has left: `Age`, a browser `max-age` that never outlives the edge copy, and `CDN-Cache-Control` for Workers Caching.
- Workers Caching (`cache.enabled` in `cloudflare.config.ts`) sits in front. It collapses bursts of identical polls and works on `workers.dev`, where the Cache API is a no-op.
- Failures are never cached. Bodies stream through, and only `Content-Type` is copied from upstream.
- Only GET and HEAD are accepted. Unknown hosts, paths outside the prefixes and traversal attempts get a 404.
- Every miss and every upstream failure logs one structured JSON line.

URLs whose query changes on every call defeat the cache. The CS2 provider rounds its date window to the hour for this reason (see `listURL`). Do the same for any time-based query you add.

## Data layer

`src/data/` is pure TypeScript ported from the Swift sources: no React and no DOM (except `Intl` for formatting). Everything is testable in Node.

- `models.ts`: `Sport`, `League`, `ScoreEvent` (Swift's `Event`, renamed because `Event` is a DOM global), `Competitor`, `EventRef`, `GameClock`, and the live snapshots (`FootballSpot`, `BaseState`, `MatchMark`, `CSLive`, `WallState`). The data is plain, immutable and serializable: dates are epoch milliseconds and absent values are `null`.
- `leagues.ts`: the catalog, exactly as `League.catalog` (ids, names, short names, sources, order, defaults).
- `json.ts`: lenient readers (`at`, `str`, `int`, `arr`…). Every field is read on its own, so a schema change upstream drops one field, never the feed. This is the Swift `try? decodeIfPresent` habit. Never cast a response to a type.
- `providers/`: `espn.ts`, `counterStrike.ts`, `ifsc.ts`, `teams.ts`, behind `providers/index.ts` (`fetchLeagueEvents`). Each takes a `Fetcher`, so tests replay fixtures.
- `scoreboard.ts`: ScoreStore's pure logic:
  - filters: picks, college Top 25 and followed teams, climbing disciplines;
  - the visibility window: finals for 18 hours, games from 6 hours ago to 36 hours ahead, and the next fixture when that window is empty;
  - three per side of now;
  - My Teams;
  - live-first ordering;
  - the tile board and its plan;
  - poll cadence and retry delays;
  - what carries over between polls (`mergePoll`).
- `format.ts`: ordinals, plurals, `periodLabel`, days and times ("Today 7:00 PM", "Tomorrow", "Nov 5, 1:00 PM"), countdowns, "Updated 5 minutes ago", and `spokenStatus` and its siblings, which turn source shorthand into words for screen readers.
- Also: `clock.ts` (GameClock ticking and running inference), `soccer.ts` (marks and own-goal reconciliation), `teams.ts` (`espnTeamID`, flags, climbing nations), `teamColors.ts` (OKLab, `teamTone`, `teamPalette`, wash strength), `logoColors.ts` (a team's colors read from its crest), `days.ts` (DayKey), `broadcasters.ts` (names and official watch pages), `images.ts`, and `demo.ts` (development only).

### How to port a Swift parser

1. Find the Swift entry point (`Providers.swift`, `GameDetail.swift`, `ScheduleProvider.swift`…) and read it whole, including its comments. The comments explain the gotchas: ESPN's yard line counts from the home goal line, postponed games come back "post" with 0–0 placeholders, college needs `groups=80`, and so on.
2. Port the model into `models.ts`, or into a new `src/data/<area>.ts` if it only belongs to one page, with the same field names and doc comments.
3. Port the parser as a pure function `(json: JSONValue, …) => Model`, reading through `json.ts`. Keep the order of the Swift checks and its fallbacks. Keep the Swift comment beside the line it explains. Cite the Swift file in the module's header comment.
4. Put the fetching (the URLs, and parallel requests where one failure must not sink the rest, via `Promise.allSettled`) in a separate function that takes a `Fetcher`.
5. Record a small fixture (add it to `scripts/record-fixtures.mjs`, trim it to the fields you read), then write the tests. When the live state can't be recorded today, derive a `*.synthetic.json` from a recorded file and say how in its `_note`.
6. If the URL is new, add its host or prefix and cache policy to `shared/upstreams.ts`. Never touch the Worker for this.

## State: settings and live scores

Settings live in `src/state/settings.ts`: one typed, versioned store in `localStorage` (`scoreline.settings.v1`), synced across tabs. Read a slice with `useSettings((s) => s.followed)`, which re-renders only when that slice changes. Selectors must return stored values or primitives, never new objects. Change settings only through `settings.*` actions. The Mac's rules live there: picking a team turns its league's filter on, a hidden league keeps its picks, and a new league joins the end of the order.

| Key | Default | Mac key |
| --- | --- | --- |
| `enabledLeagues` | eng.1, uefa.champions, nfl, mlb, cs2, ifsc | `enabledLeagues` |
| `followed` | [] | `followedTeams` |
| `teamFilters` / `filteredLeagues` | {} / [] | same |
| `collegeTop25Only` | true | same |
| `climbingDisciplines` | boulder, lead, speed | same |
| `showFinished` | true | same |
| `liveFirst` | false | `liveLeaguesFirst` |
| `collapsed` | [] | `collapsedSections` (league IDs, "my-teams", "tiles.live"…) |
| `landingView` | list | same |
| `theme` | system | new on the web |
| `celebrationLevel` / `celebrationSounds` | full / false | same (stored; nothing uses them yet) |
| `notifyFollowed` | true | same (stored; notifications to do) |
| `showCoStream` / `coStreamer` | true / ohnepixel | same (stored; co-streams to do) |
| `resultsDetails` | true | same (Results' Show Details: scorers, pitchers, performers under rows) |

To add a setting:

1. Add it to `Settings` and `DEFAULTS`.
2. Read it defensively in `sanitize`.
3. Add an action if it has a rule.
4. Add a row to the table above.

A change of shape bumps `VERSION` and needs a migration in `sanitize`. The Mac-only settings (menu bar label, live count, open at login, updates) have no web equivalent.

Live scores live in `src/state/scores.ts`, where `useScoreboard()` makes one TanStack Query per enabled league:

- Cadence, from ScoreStore: every 30s while anything you'd see is live, 60s before a start, otherwise 5 minutes.
- A failing league retries at 5s, 15s and 30s, then keeps its last good games, marked failed.
- Polling pauses while the tab is hidden, and refetches on return if the data is older than 30s.
- Each poll is merged onto the last. Clocks learn whether they run. The NBA's routine plays don't replace the last line worth reading. An unchanged game keeps its object identity, so its row doesn't re-render.

`useScoreboard()` returns the derived sections, the tile board, quiet leagues, the live count, status, `event(id)` and `leagueOf(id)`. A second reader beside one that already polls passes `{ poll: false }`, so the feeds aren't polled twice; the game page does this in the split view, where the sidebar polls. Results are recomputed only when a league's data changes, the settings change or the minute turns (ScoreStore's `version`). Game pages read their event from it, so they stay live.

`useNow(period)` (`state/clock.ts`) is the only way to tick. Every component on the same period ticks in the same frame, on the whole period, and tickers stop while the tab is hidden.

## Design system

Read `src/design/tokens.css` first.

**Units.** `--pt` is one Mac point. The root font size is the Mac's 13pt body (81.25% of the browser default, so it respects the user's text size). On touch screens the root is 15px and the whole layout scales with it. Write every length in Mac points, so a Swift layout ports number for number: `padding: calc(7 * var(--pt)) calc(8 * var(--pt))`. Container queries can't use `--pt`: use `rem` there, where 1rem is 13pt.

**Color.** Every color is defined once with `light-dark()`. The theme is just `color-scheme`: the system's by default, or Settings → Appearance, which sets `data-theme` on `<html>`; index.html applies it before first paint. The tokens:

- **Ink:** `--label`, `--label-secondary`, `--label-tertiary` (glyphs only, never text), `--separator`.
- **Washes:** `--fill-hover`, `--fill-press`, `--fill-surface`, `--fill-skeleton`, `--stroke-hairline`.
- **System colors:** `--accent` and `--accent-text`, `--live` and `--live-text`, `--live-wash`, `--live-pill`, `--delayed-text`, `--star`.
- **Charts:** `--viz-*` (grid, reference, track, neutral). Neutrals are ink opacities; team colors are for marks only.
- **Materials:** `--glass-fill` (`-strong`, `-clear`, and `--glass-solid` for chrome that content dissolves under), `--glass-blur`, `--glass-edge`, `--glass-highlight`, `--shadow-glass`, `--shadow-control`.

Text tokens clear 4.5:1 on the page, the glass and a pressed row, in both themes; `test/unit/contrast.test.ts` reads tokens.css to check it. Increase Contrast (`prefers-contrast: more`) strengthens edges and secondary ink. Reduce Transparency turns glass solid.

**Type.** System fonts throughout: SF on Apple devices, the system face elsewhere. `--font-rounded` (SF Rounded where available) is for scores and countdowns. Sizes follow the Mac: `--text-body` 13, `--text-callout` 11.5, `--text-status` 11, `--text-caption` 10.5, `--text-small` 10, plus the score sizes. Numbers are tabular wherever they line up. Section titles are small caps drawn by CSS (`text-transform`, `--tracking-caps`), so screen readers read them as written.

**Glass** is only for the floating layer: the sidebar, header controls, chips and the hero card. Never put glass on glass. Content sits on plain surfaces (`--fill-surface`).

**Team colors** come from each crest where it has color (`state/logoColors.ts`, read once and cached), else the source's. They go through `teamPalette(top, bottom, scheme)`, a port of TeamTone and TeamPalette. Only lightness moves, a color with no usable hue becomes neutral, and the second of two lookalikes goes neutral. Use them for washes and marks, never text.

**Components** (`src/design/components`, all exported from `index.ts`, each documented at the top of its file):

| Component | What it is |
| --- | --- |
| `GlassCard` | the floating material: `card`, `clear` (over a wash), `strong`, `capsule` |
| `SectionTitle` | small caps section heading with an optional glyph, accessory (Live, Final, text) and trailing controls |
| `Chip` | live count ("3 Live"), state chips (RED ZONE), neutral tags; arrives from 92% |
| `SegmentedControl` | macOS segmented control with a gliding thumb; a radio group; keyboard changes are instant |
| `PageHeader`, `BackButton`, `IconButton`, `Button` | header bar (title centered, Back leading), 28pt glass circles, push buttons |
| `LiveDot`, `LiveStatus` | breathing red dot (in phase across the page, still when stale), dot plus a ticking clock |
| `TeamLogo` | sized CDN crest, dark-mode variant with fallback, placeholder disc, fade only from the network |
| `ScoreDigits` | a score whose changed digits roll and whose pill flashes (in 150ms, hold 1.6s, decay 1.2s) |
| `Skeleton`, `EmptyState`, `ErrorState` (+ `ErrorCopy`) | static placeholders, empty and error states in the app's one wording |
| `GroupBox`, `FormSection`, `ToggleRow`, `Toggle`, `Row` | System Settings building blocks |
| `Icon` | the app's glyphs (SF Symbols-like, on a 16 grid); add new ones in `icons.tsx`, never inline SVG |
| `Menu` | a pull-down on near-opaque glass (`--menu-fill`) that grows from its trigger: items, sections, checks, shortcuts; ↑/↓, Return, Esc; keyboard opens are instant |
| `Outline` (`useOutline`, `DisclosureHeader`, `CrestStrip`, `OutlineBox`, `OutlineCrest`, `ShowAllButton`, `outlineReveal`, `OutlineGlide`) | long lists as an outline (OutlineList.swift): groups collapse to a header and a line of crests, "Show All N" past 24; each group's state is its own subscription, so opening one re-renders it alone; the decisions are pure in `data/outline.ts` |

Feature components (rows, tiles, strips) live with their feature, not here. Promote one to the design system when a second feature needs it.

## Motion

The rules, from Components.swift `Motion`:

- **Should it animate at all?** Anything triggered from the keyboard doesn't: highlights, view switches with ←/→, section toggles via Enter, and pages reached by keyboard, which arrive with `state.viaKeyboard` and no entrance. Neither does anything that happens tens of times a minute.
- **Springs never bounce.** In `motion.ts`: `spring.quick` (0.2), `standard` (0.3), `travel` (0.4). Use them through `motion`'s `m.*` components inside the app's `<LazyMotion>`, whose features load after first paint.
- **Curves and durations** for CSS are in tokens.css: `--ease-out` (Emil Kowalski's strong ease-out) for entering, leaving, fades and presses; `--ease-in-out` for changes of light. Durations: press and exit 120ms, fade 150, quick 200, reveal 250, standard 300. Exits are faster than entrances. UI motion stays under 300ms. The one exception is ambient decay (the score flash fading over 1.2s), which nothing waits for.
- **Interruptible.** Use CSS transitions or springs that retarget from the current value. Never block input while something moves. Use keyframes only for one-shot entrances.
- **Only transform and opacity move.** The strips place marks with `cqw` units in a transform for this reason.
- **Reduce Motion:** anything that moves becomes a short fade, never nothing. CSS modules carry `@media (prefers-reduced-motion: reduce)` variants, and `MotionConfig reducedMotion="user"` covers motion.
- **Hover** styles sit behind `@media (hover: hover) and (pointer: fine)`.

What's built:

- **Page entrance:** blocks slide 10pt from the left and fade, cascading (`stack-in`). Keyboard arrivals don't.
- **Collapsing or expanding a section or tier by click** runs in two phases, like ScoresView.toggle. First the crests are linked and layout tracking turns on; on the next frame the section toggles. The crests then travel between the rows and the collapsed preview (shared layout), the sections below glide (layout spring), and the rows' text rises in, staggered 40ms per row and capped at four. A toggle within 450ms of the last, or from the keyboard, is instant.
- **Live:** a score change flashes the row (a soft red wash plus the scorer's dot) or the tile digit (a red pill), and the digits roll. Clocks tick on the second. Dots breathe in phase.
- **List ⇄ Tiles:** a click stacks the new view in; the keyboard switches instantly.

The owner can run `/review-animations` on the motion code for an independent review; agents can't invoke that skill.

## Layout, navigation and keyboard

- **Phones** (under 760px): one column, at most 440pt, like the Mac panel. The window scrolls; headers are sticky, with a soft scroll edge once content is underneath.
- **From 760px:** a split view. The scores are a glass sidebar (340–420pt, the Mac's compact and medium widths) beside a detail pane, each scrolling on its own. The sidebar stays mounted across pages, so it keeps its scroll, highlight and polling, as the Mac keeps Scores built under every page. With nothing selected, the pane says "No Game Selected" (Mail's pattern).
- **Width classes:** blocks add detail as they widen, from the Mac's thresholds of 380pt of content (medium), 460 (large) and 560 (xlarge). `useWidth(ref)` gives a block's width in points from one ResizeObserver. Rows show records from medium. Tiles go to 3 small columns from large, and 4 small plus 2 large from 680.
- **Routes** (`src/app/App.tsx`): `/`, `/game/:id`, `/settings`, `/settings/league/:id`, `/team/:id`, `/player/:id`, and the schedule world, built by the helpers in `data/schedule.ts`:
  - `/schedule` (everything), `/schedule/your-teams`, `/schedule/<league>`, `/schedule/team/<id>?name=&logo=`, `/schedule/climbing`, `/schedule/tournaments`; each faces back in time with `?mode=results` (`schedulePath`).
  - `/results/climbing/<event>/<dcat>?category=&event=` and `/results/tournament/<slug>?name=` (`eventResultsPath`).
  - `/standings/<league>`, `/rankings/<league>`, `/bracket/mlb/<year>`, `/bracket/cs2/<slug>?name=`, each with `?ring=<team ids>` for the match it was opened from (`standingsPath`, `rankingsPath`, `bracketPath`).
  - Navigations may carry `state.from` (Back's label: "Schedule"); without it Back says "Scores". Every route but the scores is lazy. To add a page: create `src/features/<area>/<Page>.tsx` that exports the component, point its route's `lazy` at it, use `PageHeader` with `BackButton` (hidden in the split view, where Esc goes back), and use `useScoreboard()` or a new query for data. Placeholders live in `features/placeholders`; replace one by repointing its route.
- **Back** (`useGoBack`) returns to whichever page opened this one. A page opened directly goes back to the scores. Esc does the same from anywhere except a text field.
- **Keyboard:** on the scores, ↑/↓ move the highlight (←/→ too in Tiles, by on-screen geometry), Return opens the game, Esc goes back. The keyboard highlight wears the accent; the pointer's hover is a quiet gray and takes the highlight back.
- **Schedule pages:** ↑/↓ through the rows, ←/→ step the navigator (a day, a week, a month, a round), Return opens, T goes to Today (Results: the latest round), ⌥1 / ⌥2 face Upcoming / Results (the Mac's ⌘1 / ⌘2, which browsers keep for tabs). The page in front takes the keys (capture phase) unless focus is in the sidebar.

## Accessibility

- **Landmarks:** `aside` for the scores and `main` for the page.
- **Headings:** `h1` per page. On a game, the hero's `h1` is the game in words.
- **Sections** are disclosure buttons inside `h2`s, with `aria-expanded` and a spoken preview when collapsed.
- **Rows and tiles** are links labeled with the game in words: "Liverpool 3, Brighton 1, 67th minute", then follows, the situation and the caption, built by `spokenSummary`.
- **Controls:** segmented controls are radio groups and switches use `role="switch"`. Live and status text is announced politely.
- **Focus** rings show for keyboard users only (`:focus-visible`).
- **Contrast** is tested, and Increase Contrast and Reduce Transparency are honored.
- **Touch:** coarse pointers get a 15px root, so rows reach about 44px, and inputs are at least 16px so phones don't zoom.

## Performance

- **First paint:** the scores list is the only eager route. The initial JS is about 165 KB gzipped: React 68, the router 30, Query 11, and the app with motion's core. motion's layout features (about 32 KB) load after paint. Libraries sit in their own chunks for long-term caching.
- **Rendering:** rows and tiles are memoized on their game, and unchanged games keep their identity across polls. Derived lists are recomputed only on a data, settings or minute change.
- **Motion cost:** live dots are compositor-only CSS. Layout animation is turned on only during a toggle, and crest links exist only for the section being toggled; each costs a measurement.
- **No layout thrash:** text is measured with a shared canvas (`features/scores/measure.ts`, RecordFit), widths come from one ResizeObserver per board, and arrow keys read geometry only on a key press.
- **Logos** are CDN-resized to 40/64/96/160px buckets, lazy-loaded and decoded asynchronously.

## Testing

- **Unit** (`pnpm test`, Vitest, in Node with TZ America/New_York): every parser against `test/fixtures` (ESPN soccer, NFL, college, MLB, NBA; bo3; IFSC; team lists), plus the scoreboard logic, formatting and clocks, soccer marks, the allowlist and cache policies, team colors read from crests, settings, and token contrast. `test/worker/` covers the proxy with the Cache API and fetch stubbed (type-checked with the Worker's program).
- **Fixtures:** the recorded files come from `pnpm fixtures`, trimmed to the fields the parsers read (each records its `_source` URL and `_recorded` time). Files named `*.synthetic.json` are live states derived by hand from a recorded file, because a recording session rarely finds every sport live. Each says how it was derived in `_note`. Re-recording changes the games, so tests assert structure and rules rather than today's scores wherever they can.
- **End to end** (`pnpm test:e2e`, Playwright against `pnpm dev`, or `SCORELINE_URL`):
  - `smoke.spec.ts` covers 390, 1024 and 1440 pixels in light and dark: list, tiles, a game, Esc back, keyboard ↓ and Return, and Settings, with no console errors.
  - `schedules.spec.ts`, `seasons.spec.ts` and `standings.spec.ts` screenshot every schedule, results, season, standings, poll and bracket page type at the three widths in both schemes, and drive their interactions (folding a day, the keys, ⌥2, stepping rounds, the section menu, the docked season card, opening a conference).
  - `live.spec.ts` uses `?demo` to cover the live count, clocks, strips and the score flash.
  - Screenshots go to `SCORELINE_SCREENSHOTS` (default `test-results/screenshots`).
  - `@playwright/test` is pinned to 1.63 to reuse the Chromium already installed on this machine. After upgrading it, run `npx playwright install chromium`.

## Conventions

- **Names:** Swift names wherever a thing is ported (`stepsBack`, `mergePoll` for ScoreStore.refresh's merge, `planTiles` for TilePlanner.plan, `teamTone`), and Swift field names in models. Components are PascalCase files with a CSS module beside them (`EventRow.tsx` and `EventRow.module.css`). Hooks start with `use`. CSS module classes are camelCase.
- **Comments:** every module and component starts with a short comment saying what it is and why, citing the Swift file it ports. Keep the Swift comments that explain a decision next to the line they explain.
- **Copy:** the Mac's words exactly: "Can't Load Scores", "No games today or tomorrow: …", "Starting soon", "Time TBA". Use Title Case for buttons and labels, sentence case for messages, and en dashes for scores and records ("3–1", "7–1").
- **No component kit:** build from the design system. Add tokens rather than raw colors and lengths.
- **Imports:** extensionless within `src`. `shared/` is imported by both sides and must stay free of DOM and Workers types.
- **Errors:** a failed load shows `ErrorState`. A section that fails inside a working page shows `ErrorCopy.inline`. Polls retry on their own, so their errors stay quiet.
- **Never** link unofficial streams, add a CS2 tier option (S-tier only, one constant), or proxy images.

## Parity checklist

`[x]` done, `[~]` partly, `[ ]` to do. Swift files are in `../Sources/Scoreline/`. The groups are sized for one agent each.

### Foundation (this branch)

- [x] Worker proxy: upstream allowlist, Cache API plus Workers Caching, per-kind TTLs, structured logs, SPA assets with `/api/*` first
- [x] League catalog, models, the ESPN, CS2 (S-tier) and IFSC scoreboard providers, the off-season climbing opener
- [x] ScoreStore logic: filters, window, My Teams, live-first, poll cadence and retries, carry-over between polls, tile tiers and plan
- [x] Settings store with the Mac's keys and rules; theme (system, light, dark)
- [x] Design tokens and components, dark and light, contrast-checked
- [x] Split view (sidebar plus detail) and the phone layout; routes with placeholders; Back and Esc; keyboard ↑/↓/←/→/Return
- [x] Fixture tests, smoke and live e2e, the `?demo` harness
- [x] TeamColors from logos: each crest is read once through a canvas (both logo CDNs send CORS headers) with the OKLab reading from TeamColors.swift, cached in localStorage (`src/data/logoColors.ts`, `src/state/logoColors.ts`). Teams repaint as their colors arrive.
- [ ] Web notifications for followed teams (Notifier.swift); `notifyFollowed` is stored
- [ ] The pinned game: the Mac's menu bar item. The web equivalent could be the tab title and favicon showing a pinned or followed live score. It orders the Live tier too.
- [ ] PWA manifest, icons and offline shell; an app icon (the dithered ice crescent planet)

### Scores list (ScoresView, EventRow, ListLayout, OutlineList)

- [x] Sections in the user's order, My Teams first, live-first option, failed-league inline error, footnotes (quiet leagues, follow hint)
- [x] Rows: crest (dark variant), AP rank, name, possession ball, follow star, records from medium width (RecordFit), score, dimmed loser, "–" for a played final without a score
- [x] Context line (caption, or live: the situation for football, baseball and the NBA); status column (live clock, countdown inside 3h, Delayed, Starting soon, Time TBA, day and time, final word), aligned per section
- [x] Score-change flash and scorer dot; live dots that hold still when stale; empty, loading and error states; "Updated…" footer
- [x] Collapse and expand with a preview (crests, "N more", live count or next start); crests travel; stagger
- [~] Width classes: records at medium. Not yet: the detail lane at large and xlarge (`laneLines` is ported) and the two-up grid at 680pt, which only matters if the sidebar grows.
- [~] Context menus. A section's menu is built (`SectionMenu`: "…" on hover, always on touch, and right-click): Schedule, Results, Table, Standings, Top 25, Choose Teams. Still to do: Move Up/Down and Hide on it, and a game's menu (Open in Browser, Follow/Unfollow each team, Go to team, team's schedule, Copy Score) with long-press on touch.
- [ ] CS2 live round line on rows ("Mirage 5–8"), for followed or pinned matches, from bo3 `last_snapshot`
- [ ] Climbing: YouTube live mark and stream overlay (ClimbingBroadcast; needs YouTube on the allowlist)
- [ ] CS2 co-stream marks (CoStream; needs decapi.me or Twitch)
- [ ] My Teams fallback to a team's next scheduled game within 21 days (the schedule layer is ready: `fetchTeam` in `state/schedule.ts`)
- [ ] Footnote links "{League}: next Sat Nov 1" (league calendars are ready: `fetchCalendar`, `nextGameDay`; the schedule's own footnotes already link)

### Tiles (TileBoard, Tiles, TileStrips)

- [x] Tiers (Live, Your Teams, Up Next, Final), collapsible, sharing the collapsed set; large live budget (4/6) and next-up large; columns by width
- [x] Large live (team wash, face-off, rolling score with flash), large next-up (records, countdown that ticks inside the last hour), small tiles (full names or abbreviations), field tiles
- [x] Strips: football field (ball, chevron, line to gain, red zone), bases and count, soccer goal track, basketball lead bar
- [ ] Mini bases after the batting team's name in small live tiles (`MiniBases`)
- [ ] CS2 round race strip (needs `CSLive` from bo3 `last_snapshot`)
- [ ] Climbing wall strip and `WallState.from` (needs ClimbingDetail's boulder cards and wall routes)
- [ ] Strip moments: touchdown end zone, possession chevron sweep, run-scores ping, goal ping
- [ ] Up Next "Schedule ›" link

### Game pages (DetailView, GameDetail, LiveViews, Visualizations, LiveFeeds), one agent per sport

- [x] Hero placeholder: clear glass over the team wash, crests with glow, names, AP ranks, possession, follow stars, records, rolling score, live clock, countdown, final word and date; Where to Watch with official links, venue
- [ ] Shared: game detail fetch by ID (ESPN `summary`, bo3 match, IFSC round) so any game loads, not only the scoreboard's; hero beats (digit pop with pill, wash pulse, glint); trophy; stale note; per-sport two-column plan at wide widths; fast lane polling (5s; soccer 8s; climbing 4s); linked focus across charts and the peek (LinkedPeek); Open in Browser; pin
- [ ] Docked scorebar (DockedScorebar, PageGeometry): docks as the hero scrolls away; per-sport detail; chips; beats; back to top
- [ ] **Soccer:** live pitch, timeline, win probability (with draw), team stats, projected live table, key events, commentary, shot map (FotMob/ESPN)
- [ ] **NFL and college:** field with drive chart, score by quarter, scoring plays, win probability, team stats, conference table with Top 25 links, RED ZONE and 2-MIN DRILL chips
- [ ] **MLB:** At the Plate (diamond, count, runners, batter and pitcher), the play theater (PlayTheater, PlayScene, PlayScript), strike zone, spray chart, line score with R/H/E, series and bracket link, scoring, balls in play. Statcast (statsapi.mlb.com) is allowlisted but not wired up in the Mac app either.
- [ ] **NBA:** court with shot chart and replay scrubber, game flow and runs, leaders, key plays, box score, injury report, standings with seeds, the clutch chip. **WNBA:** the generic ESPN page.
- [ ] **CS2:** maps, round history with economy, streams (official first), tournament bracket link, rosters, MAP POINT
- [ ] **Climbing:** on the wall (lead ascent), high points, boulder scorecards, live results with your countries, starting order, YouTube watch

### Schedules and results (Schedule\*, Results\*, SeasonResults\*, SeasonTimeline, EventResultsPage, TournamentsPage, ClimbingSeasonPage)

- [x] Schedule page for every scope (all, your teams, league, team, climbing, tournaments) with the title menu, More, scope chips (All, Your Teams, teams, leagues) and Upcoming | Results (⌥1/⌥2; a click crossfades, keys are instant). Session memory per page (week, round, folds, Show All Games) in `state/schedule.ts`.
- [x] Navigators: week strip with dots (games, followed, live), NFL and college week picker, daily game days with "Next: Sat, Oct 31", month bar with the team's summary; days that fold like sections (crests travel, text staggers); Today; scroll spy; a team's season two-up on wide panes
- [x] Rows: networks and "Where to Watch" in the status column, provisional and TBA/TBC times, if-necessary and canceled games receding, live state from the scores list; results with the loser dimmed by the score, scorers (red cards drawn), performers, pitchers, series, aggregate, shootouts, forfeits and abandoned games, "Show Details"
- [x] Results: rounds (matchweeks, cup stage blocks, football weeks) with the round picker and summary line, the week strip by game day (everything, daily leagues), the rounds list beside the round from 680pt with your teams' form, a team's season card and form strip with the season picker and Include Friendlies, your teams' last 30 days
- [x] Climbing season page (timeline lanes, competitions by month, rounds by day, podiums, your countries; untracked disciplines neither shown nor fetched), tournaments page (S-tier timeline, bracket links), event results pages (climbing category, CS2 tournament), the sticky glass season card that docks into a slim bar
- [ ] Climbing round times and Watch buttons (World Climbing's YouTube streams: YouTube isn't on the allowlist, so rounds say "Time TBA")
- [ ] The mode switch's height easing (the Mac's panel resizes; here the content crossfades and the page reflows)
- [~] Disk caches with ETag revalidation (ScheduleCache, ProfileCache): TanStack Query keeps each board, calendar and team schedule with its own freshness (final days 30 days, the coming week 30 minutes, further 6 hours) over the HTTP and edge caches; nothing persists across visits yet

### Standings, polls and brackets (StandingsView, College, Brackets, BasketballViews)

- [x] League tables re-ranked live; grouped tables in two columns; college conferences as an outline (the shared `Outline` in the design system); columns by width (streak, home and away, PF and PA)
- [x] NBA seeds with play-in and lottery lines; AP Top 25 and Coaches Poll (movement, votes)
- [x] Brackets: MLB postseason from daily boards; CS2 Swiss ladder and playoff tree; the originating match's teams ringed; wide trees scroll sideways, opening on the round being played
- [ ] Game pages link in: "Full Standings" (`standingsPath(league, [top, bottom])`), the series or tournament bracket (`bracketPath`), the NBA standings window (`nbaWindow`, `NBAStandingsTable` are ready)

### Profiles (TeamPage, TeamSections, PlayerPage, PlayerSections, Profile\*, ProfileCharts, LinkedPeek, ProfileLinks, FotMob)

- [ ] Team pages: hero (crest, summary, coach, live strip), next, now and last game, results and form, roster and depth chart, leaders, stats with league ranks, table window, injuries, transactions; CS2 team pages
- [ ] Player pages: hero (photo, position, facts, injury), season tiles, game log strip, latest, career, awards; soccer competitions; CS2 map pool; climbing podiums
- [ ] Name links everywhere (team and player), and prefetch on hover

### Settings (ManageView, LeagueSettingsView, AddSportsView)

- [x] My Teams (unfollow), Your Sports (drag, or ↑/↓ on the handle, with an announcement), filter summaries, All Sports toggles, Show finished games, Live leagues move to top, Appearance
- [x] League page: All Games | Only My Teams, team picks (search above 12, college by conference, Selected first), follow stars, college Top 25, climbing disciplines and countries, CS2 co-stream channel (stored), Hide league
- [x] League page's Upcoming and Results sections (ScheduleHub, ResultsHub: `features/schedule/LeagueHub.tsx`)
- [ ] Keyboard navigation in the pick list (↑/↓, →/← groups, Return, Esc clears search); the pick list could use the design system's `Outline`
- [ ] Live Games: celebration level and sounds; Notifications (with the browser permission state); credits

### Notifications (Notifier)

- [ ] Followed teams: started, every score ("Goal · 23rd minute", "{Team} scored · 3:10 left in the 2nd"), final; one per game, replacing itself; click opens the game. Web Notifications only work while a tab is open; push would need a Worker cron and the Push API.

### Celebrations and moments (Moments, Celebrations, LiveCelebrations, BasketballCelebrations, CelebrateMatch)

- [ ] Moment model (routine, swing, score; accents), captions under charts, confetti and fireworks and sparks by sport, NBA swish and rim and embers, the decisive moment, levels (Full, Subtle, Off), Reduce Motion bloom, sounds (opt-in, at most one every 8s)

### Panel and menu bar equivalents (MenuBarLabel, PanelController, PanelCommands, RootView)

- [x] Pages and back stack (router history); Esc goes back
- [~] Commands: schedule pages take ⌥1/⌥2 (Upcoming/Results) and T (Today). Still to do: Refresh and Settings shortcuts that don't collide with the browser (⌘R and ⌘, are taken)
- [ ] Scroll memory per page in the split view's detail pane (the sidebar keeps its own)

### Accessibility and quality

- [x] Landmarks, headings, labels in words, `:focus-visible`, contrast tests, Reduce Motion, Increase Contrast, Reduce Transparency
- [ ] A screen-reader pass on VoiceOver (macOS and iOS) and a live-region policy for scores, matching Announcer: game pages only, never the list
- [ ] Real-device pass on iOS Safari (safe areas, toolbar collapse, tap feel)
