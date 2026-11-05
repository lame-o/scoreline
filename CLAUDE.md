# Scoreline: notes for Claude

Read this first in any Scoreline session, on any machine. It holds the owner's standing decisions and how this repo is built, released and run. README.md is the user-facing story.

Some details can't live in a public repo: account IDs, history that must never be pushed, business plans and machine setup. Those are in `context-private.md` on the private draft release `data`, along with archived recordings and research:

    gh release download data --repo SubwooferLullaby/scoreline -p context-private.md -O -

## What it is

- **Mac app:** a macOS menu bar app in Swift (SwiftUI and AppKit). It builds with plain `swiftc`: no Xcode project and no SwiftPM.
- **Web twin:** `web/`, React + Vite on Cloudflare Workers, live at https://scoreline-web.lame-o.workers.dev.
- **Sports:**
  - soccer
  - NFL and college football
  - MLB
  - NBA and WNBA
  - CS2 (bo3.gg)
  - climbing (IFSC and World Climbing's YouTube)
- **Design docs:**
  - `docs/engine/BROADCAST.md`: the presentation clock and the replay bench.
  - `docs/engine/CHOREOGRAPHY.md`: the play engine.
  - `web/ARCHITECTURE.md`: web conventions and the Mac parity checklist.
  - `docs/RELEASE-ARCHITECTURE.md` and `docs/REPO-SETTINGS.md`.

## Direction (owner, 2026-11-04)

The web app comes first. It runs much smoother than the Mac app, which has grown slow. Mac 1.0.33 also crashes when opening a game: EXC_BREAKPOINT, a Swift runtime trap inside a SwiftUI view body. Release builds are stripped, so the crash isn't symbolicated yet. The reports are on the `data` draft release.

The plan is to invest in the web app and later make a stripped-back Mac menu bar app. Don't pile new features onto the Mac app in the meantime.

## Machines

- The Mac app builds, tests and releases only on macOS. `build.sh`, `test.sh` and `release.sh` need `swiftc` with the macOS SDK, `codesign`, `hdiutil` and Sparkle's macOS tools. It's Apple silicon only (arm64) since 1.0.32.
- Everything else works on Linux too, such as the owner's always-on PC: `web/`, `tools/` and docs.
- The owner drives agents from their laptop. Code moves between machines through GitHub, so pull before you start.

## Build, test and release the Mac app

- **Test:** `./test.sh` replays the offline fixtures and typechecks a DEBUG build. `--record` re-records the fixtures.
- **Build:** `./build.sh` writes `build/Scoreline.app`.
- **Install locally:** `pkill -x Scoreline; rm -rf /Applications/Scoreline.app && cp -R build/Scoreline.app /Applications/ && open /Applications/Scoreline.app`.
- **Release:**
  1. Run `./release.sh <version>` on a clean tree. It bumps `Support/Info.plist`, builds for arm64 and packages the zip and dmg. It signs the appcast with Sparkle's EdDSA key and commits "Release X".
  2. Push main.
  3. Run `gh release create v<version> --target $(git rev-parse HEAD) --title "Scoreline <version>" --notes-file <notes> build/release/Scoreline.zip build/release/Scoreline.dmg build/release/appcast.xml`.
  4. Check the update feed: `curl -sL https://github.com/SubwooferLullaby/scoreline/releases/latest/download/appcast.xml`.
- **When to release:** every verified change to the Mac app ships as a published release, without asking. Installed copies update themselves through Sparkle. Commits that touch only docs or tools don't need a release.
- **Release gotchas:**
  - **Don't edit during a build.** Never edit the checkout while `release.sh` compiles: swiftc aborts with "input file ... was modified during the build". Do follow-up work in a worktree.
  - **Keychain prompt.** `sign_update` reads the key from the login keychain and waits on a keychain prompt until someone clicks Allow. Unattended, it hangs. `SPARKLE_KEY_FILE=<file>` signs from a file instead.
  - **Key backup.** A backup of the key exists off the Mac; the private notes say where. If the key is lost, installed copies can never update again.
- **Memory:** the Mac is a 16 GB M2 Air, and each `swiftc -wmo` peaks at about 2.3 GB.
  - Run heavy jobs (builds, tests, renders, full web test runs) one at a time behind a machine-wide lock: `lockf -k <lockfile> nice -n 10 <cmd>`.
  - Typecheck rather than build while iterating.
  - If the owner reports lag, stop the agents first.
- **Performance work:**
  - Instruments isn't available (Command Line Tools only), but `/usr/bin/sample` on a harness process works.
  - `matchedGeometryEffect` links are the expensive part of list animations, so keep them scoped to the section that toggles.

## Web app

- **Commands:**
  - `cd web && pnpm install && pnpm test` runs Vitest.
  - `pnpm test:e2e` runs Playwright.
  - `pnpm dev` runs `cf dev`.
- **Deploy** with Cloudflare's `cf` CLI, not Wrangler: `CLOUDFLARE_ACCOUNT_ID=<id> pnpm run deploy`. The `run` matters, because `pnpm deploy` is a pnpm built-in.
  - The account ID is in the private notes. Never put it in `cloudflare.config.ts`.
  - The `cf` login can also see a second account that belongs to someone else. Never deploy or create anything there.
  - If `cf` auth fails, ask the owner to run `cf auth login`.
- **ESPN blocks Workers.** `sports.core.api.espn.com` and `site.web.api.espn.com` answer 403 to Workers, so the browser fetches those two directly (`direct: true` in `web/shared/upstreams.ts`). Local e2e tests can't catch this, so check production after each deploy.

## Repo rules

- **Public repo** in the SubwooferLullaby org. Commit as `lame-o <52851089+lame-o@users.noreply.github.com>` and push to main; reviews aren't required.
- **Nothing personal** in anything public: no real names, no local paths (`/Users/...`), no logs and no evidence files.
- **Never commit secrets.** The KIE API key (kie.ai's video, image and music models) lives in `~/.config/scoreline/kie.key` (chmod 600). Never print or log it.
- **Keep the bundle ID** `io.github.lame-o.Scoreline`. Changing it breaks updates and settings.
- **No new `scoreline` repo.** The `lame-o` account must never create a repo with that name: installed copies find their update feed through GitHub's redirect from the old repo.
- **Videos and marketing media** go to the private draft release `videos` (`gh release upload videos <file> --repo SubwooferLullaby/scoreline --clobber`). Never commit them or keep them on disk.

## Product decisions

### Design bar

Everything should feel as if Apple made it. Performance is a requirement: no per-frame state, narrow observation and no idle timers.

### Isometric views

That's the owner's name for the play theaters: PlayTheater, FootballTheater and SoccerTheater on the Mac, and the web's `theater/`.

- **One fix, every sport:** a fix to one sport's view carries across all sports, on the Mac and the web.
- **Live data, not assumptions:** tell plays in order and chained, video-game style: the hit, the fielding, then each runner's advance. For MLB, `runners[].credits` and `movement` give the chain.
- **Never frozen:**
  - Animate every play in the feed in some form.
  - Keep sparse ambient motion between plays.
  - Show broadcast status tags (TEAM BALL, TIMEOUT, VAR CHECK…) and a "Live · 4s" heartbeat.
- **Sequence and fluidity beat liveness:**
  - The game page runs on one presentation clock behind ESPN, with the delay chosen per sport so plays are rarely late.
  - The delay shows only when hovering the live dot.
- **People on the field:**
  - Officials appear only while they're doing something.
  - A player's tag shows number, SURNAME and position on hover, and only the key player's surname at rest.
  - No shirt numbers anywhere else.
- **Next up (not built):** instant replays in dead time. Big plays only, labeled "Replay · Timeout" and played in slow motion.

### Timelines and charts

- Soccer's timeline is the model for every sport's timeline.
- The floating chart panel ("LinkedPeek") was removed on purpose in 1.0.28 and must not come back.

### Live odds

The Win Probability section shows Polymarket's price against ESPN's win probability and the DraftKings pregame line.

- Fetch odds only for the open game page, and only while that section is on screen: one market and one WebSocket at most.
- Never fetch from the menu bar, the list, tiles or notifications.
- A setting turns odds off.
- A wrong market is worse than none: match both team names and the start time.

### Notation and other rules

- **Notation:** follow each sport's official standard and don't invent shorthand.
  - MLB: official pitch names and Statcast codes (FF, not FB), and official scorer notation (K, backwards K, F8, 6-3, 4-6-3 DP, FC, SF, E5).
  - NFL, soccer and NBA: broadcast and official terms.
- **CS2 is S-tier only.** One constant, `CounterStrike.tier = "s"`, and no tier setting.
- **Team colors** settle once per game. Home keeps its kit, and away changes only on a clash, using ESPN's real kits.

## Data facts (measured)

- **Yard line:** ESPN's `situation.yardLine` counts from the home team's goal line.
- **Feed lag:**
  - A play reaches ESPN's summary a median of about 50 s after its `wallclock` (NFL).
  - Plays at a stopped clock carry the stoppage's start wallclock, so only running-clock wallclocks are trustworthy for lag.
- **Soccer:** core plays lead the scoreboard by about 30 s. VAR cancellations arrive 130–210 s late and must be told as events.
- **Climbing:** IFSC marks a round active hours early. The World Climbing stream's scheduled start is the real one.
- **Recorder tools:**
  - `tools/recorder/recorder.py` polls ESPN politely and saves every changed response.
  - `tools/recorder/measure.py` prints lag, burst, revision and score-skew stats.
  - Recordings go to `../scoreline-recordings` beside the repo, or to `$SCORELINE_RECORDINGS`. The Mac's replay bench reads `~/Developer/scoreline-recordings`.
  - The recordings from Oct 30 to Nov 2 are archived on the `data` draft release.

## Data sources and etiquette

- Don't get around bot checks, such as the NBA CDN's 403s or ESPN fastcast's Origin check. No spoofed headers.
- Use only Polymarket's and Kalshi's public read-only endpoints. Never place orders, create accounts or log in.
- Never link unofficial streaming sites. Offer official "Where to Watch" links instead.
- ESPN's terms bar commercial use of its API, so settle data licensing before charging money.

## Working with agents

- Agents never install the app, launch apps or UI, run `open`, or move or click the real mouse.
- Each agent works in its own worktree and wraps heavy jobs in the lock above.
- No shell wait loops and no persistent background processes.
- Usage is shared with the owner's other work, so stay lean.
  - Finish what's running before starting more.
  - Hold web ports of brand-new features until the owner has tried the first version.
- The main session shows the owner renders by opening them on the Mac, because they can't open attached file cards.

## Open work

- Find and fix the 1.0.33 crash when opening a game.
- Port the recent Mac work to the web: the football redo with its new ball, and the timing engine.
- Engine items:
  - NBA overspeed and teleports
  - bake cost
  - checking soccer goal lanes and sparse NBA key plays against real data
  - a basketball replay held at its end that fades its players
- Redraw the other sports' balls. Only football's was redone, in 1.0.33.
- Build instant replays (see Isometric views).
- Before charging money: Developer ID signing and notarization, pricing, and data licensing.
