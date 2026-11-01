# The game as one broadcast (the presentation clock)

## What the user wants (their words, paraphrased)

The game page should feel like the game happening on the Mac, the way a broadcast or a sports video game does:

- Plays are told in order.
- Each play flows into the next, with no teleporting.
- The score changes at the moment the ball goes in, not before.
- The scoreboard, the isometric view, the banner, the play lists and the charts never disagree.

Sequence and coherence come first. Being as live as possible comes second; the user said "feel synced to TV" and "even 10 s more is too long", "as little as we can without compromising quality".

They want it built properly, at enterprise quality. **If a piece of this would be a shortcut, stop and redesign it; don't ship the shortcut.**

## Why it's broken today (measured, not guessed)

These are early numbers: two NBA 4th quarters on 2026-10-30. The weekend's recordings will refine them.

The **slow lane** is the play-by-play (`summary?event=`, and the core API, which is the same backend):
- A play is first seen about **42 s** (p50) after its `wallclock`.
- The response changes about every **10 s** (`max-age=9`), with 1–4 new plays per change.
- About 3% of plays are revised later (p50 30 s after first seen). Some are removed.

The **fast lane** is the scoreboard (`scoreboard`, `max-age=8`):
- Score and clock lead the play-by-play by about **18 s** (p50; p90 24 s, max 32 s).
- Its `situation.lastPlay` appears to come from the slow pipeline. To be confirmed: the recorder now logs it.

Every consumer on the page reacts to arrivals on its own clock:
- The hero, the docked bar and the menu bar show the fast lane's score at once.
- The theater animates the play about 18 s plus its lead-in later.
- ScoringSlides waits for the theater's climax (`TheaterDelays`).

The result is three clocks disagreeing.

The theater also tells each play without knowing what comes next:
- A marquee replay that follows another play is built `from: nil` and enters with an `.identity` transition, so it hard-cuts.
- `TheaterBridge` only bridges from the resting court.

## The model

This is the same idea as streaming playout buffers and multiplayer entity interpolation: present a short, steady delay behind what's known, so the next state is always already in hand, and never extrapolate.

### 1. `GameTimeline` (per game, pure, value-typed where it can be)

- **Ingest:** snapshots of `(source, arrivedAt, payload)` from every lane: ESPN scoreboard, ESPN summary, MLB statsapi live feed, Polymarket ticks. The output is one event-time-ordered list of plays.
- **Each play carries:**
  - its stable id;
  - its event time;
  - period and game clock;
  - kind;
  - the score after it;
  - whatever the theaters already parse.
- **Event time** is `wallclock` (ESPN NBA, NFL/CFB, soccer) or statsapi `startTime`/`endTime` (MLB). Where it's missing, or logged in a batch (college), estimate it from period and clock against neighbors, keeping it monotonic.
- **A play at a stopped clock after a stoppage has a bound, not a point** (*implemented*). ESPN stamps free throws and their rebounds after a foul, timeout and challenge with the stoppage's time, sometimes minutes early. Their moment lies in `[stoppage start, clock restart]`. The restart comes from the fast lane's first moving reading less its measured latency, or from the next running-clock play less the game time it ran; until one is known, the bound is the arrival less the feed's minimum lag. `TimelinePlay` carries `eventBounds` and `timeSource` (`.wallclock`, `.statsapi`, `.estimated`, `.bounded`). Phase 0's anchor solver places the cluster backward from the restart. Phase A presents it there provisionally (free throws the routine's ~14 s apart) until the solver's anchors arrive (`setAnchors`). Bounded and estimated plays never size `D`.
- **Revisions** are matched by id, and the newest *content* wins: the freshest lane owns each region of the game, and a version seen before never comes back (stale caches). A wallclock change is a revision. A removal deletes the play; a removal of the newest play is believed once the lane confirms it for its content age.
- **What's told is recorded,** so a revision to a told play becomes a quiet correction, never a re-animation. Told plays are always a prefix. A play inserted behind them, or more than 30 s past its moment, attaches quietly (`TellReason.correction`: scorer's corrections, end-of-game insertions).
- **The presented score is derived from plays:** the score after the last presented play. Score and plays therefore can't disagree.
- **The fast lane is a hint, not the truth on the page.** It confirms stoppages (its clock stopped at the newest play's clock), bounds stopped-clock clusters, and guards order. A score it has that no play explains is not told past: nothing after it in the timeline is told before it. The clock keeps time, and the play is told when it comes (a micro catch-up or a late telling). The bench showed that holding the clock for these cost ~10 s of delay. A fast-lane score still unexplained once p is a grace (20–60 s, per sport) past its latest possible moment is applied quietly and logged (the safety net; 0 on the NBA recordings).
- **Watermark:** how far the timeline is known complete *for certain*, from hard evidence only: the newest live-ball play less a measured late-insertion allowance; a running game's quiet allowance (a game clock can't run for long with nothing logged; the fast lane's stopped clock confirms a stoppage and restarts the allowance); and a network guard (no successful read for ~3 read intervals). How far behind live to run is statistical and belongs to `D`, not the watermark.

### 2. `PresentationClock` (per game)

- **Presentation time** is `p = now − D`, where `D` is per game and adaptive.
- **Late binding** (*implemented*). The director doesn't need a play's details for its whole lead-in, only for its **binding horizon**: the last ~2–3 s before the decisive moment (the shooter's catch or gather, the snap). Before that, the lead-in is generic flow it steers at bind time. Each kind's horizon is supplied by the theater side through `BindingHorizons`, a table by kind label: live-ball 2.5 s by default (*tune*); dead-ball kinds none unless given, since they attach late.
  - `D* = q-quantile(arrival − eventTime + bindingHorizon(kind))` over the newest 40 trusted live-ball plays, plus a margin (1.0 s). Trusted means shots, rebounds, turnovers, snaps, located soccer entries and pitches whose game clock moved since the last stoppage. Fouls, substitutions, timeouts, reviews and stopped-clock clusters are excluded.
  - `q` = 0.95 (bench trade curve below; re-tune on the weekend's recordings).
- **Lateness is recoverable, not designed out:**
  - a play known inside its horizon gets a compressed lead-in;
  - one up to 1.5 s past its moment gets a declared micro catch-up, which counts as on time;
  - later, it's told late. Its lag enters the window, raising `D*`, and the clock slews down (rate ≥ 0.92) toward the watermark, which never reorders.
- **`D` never jumps.** The clock slews: its rate stays within 0.92–1.08×.
  - Inside a stoppage, where nothing on screen changes (no play to tell, the game clock stopped), it may skip forward to catch up or hold still to fall back. Skips are declared events for the director.
- **Jumps happen only:**
  - on opening the page or waking the Mac: start at the live edge, without telling past plays, as today;
  - when more than `Jmax` behind (per sport: basketball 40 s, soccer 180 s; football and baseball 40 s until measured): jump, with a crossfade. **A jump never passes a play that must be told live**: one that changes the score (any sport), an announced kind (VAR), or a kind the sport keeps live (soccer: shots, saves, cards). It lands just short of the first such play, its lead-in included, so that play is told live, in order. Only flow and dead-ball administration go by as history. The rest of the deficit is made up in dead time: skips inside stoppages (soccer's ball out of play counts: out, a foul, a corner or free kick given, a goal, a card, a VAR check; the game clock runs but nothing on screen moves), plus the 1.08× slew. *Implemented on mac/broadcast (the timeline's `jumpLimit`, `PlayKind.stopsPlay`).* On the real Premier League match, the 68'–71' outage: one 65-s jump (it landed before a yellow card) instead of four (105 s and 87 s among them, one over the ruled-out goal), then a 110-s skip inside the VAR check; the 120-s deficit was back within 5 s of the target 32 s after the resume. All three goals and all four VAR entries told live (none as history).
- **Stall** (the watermark stops advancing): `p` slews down within 5 s of `watermark − bindingHorizon`, eases to it and holds. The game clock display holds; the theater keeps ambient motion on wall time; nothing else on the page freezes.
- **The clock never presents beyond what's known for certain** (the watermark).
- **Report `D`** so we can see how far behind live we are. Metric: the added delay versus today's fast-lane score. *The user's choice (2026-10-31): on hover only.* Hovering the live indicator (the hero's red dot and clock, the docked bar's) shows "About 55 s behind live" (the clock's current `D`, rounded to 5 s), with a quieter "Catching up" or "Waiting for the feed" while the clock catches up or stalls. Nothing at rest. VoiceOver hears the same as the hero's value ("About 55 seconds behind live"). Implemented on mac/broadcast (`BehindLive.swift`: the house's floating glass, 80 ms hover intent, grows from the indicator on `Motion.fade`, leaves on `Motion.exit`; drawn outside the hero's glass container, as the scoring slide is).

**Measured** (NBA, two recorded 4th quarters at the app's cadence, 42 live-ball plays; one play = 2.4%, so the weekend's recordings must re-tune this):

| q | horizon | D p50 | added vs today's page p50 | after horizon | micro catch-up | beyond 1.5 s | corrections | stalls/h |
|---|---|---|---|---|---|---|---|---|
| 0.80 | 2 s | 46.7 s | 16.9 s | 23.8% | 7.1% | 11.9% | 7.1% | 9.4 |
| 0.85 | 3 s | 49.2 s | 20.8 s | 21.4% | 4.8% | 7.1% | 7.1% | 7.0 |
| 0.90 | 3 s | 51.0 s | 23.1 s | 16.7% | 0.0% | 7.1% | 7.1% | 7.0 |
| 0.95 | 2 s | 53.0 s | 26.2 s | 11.9% | 4.8% | 2.4% | 7.1% | 7.0 |
| 0.95 | 3 s | 53.9 s | 27.0 s | 11.9% | 0.0% | 2.4% | 7.1% | 7.0 |

`D`'s terms at q 0.95: trusted live-ball lag 50.7 s + horizon 2.5 s + margin 1.0 s = 54.2 s. Before this design `D` was ≈ 60.8 s: lag 51.8 s polluted by stopped-clock stamps, plus a 5 s read-interval term, a 2.5 s lead-in and a 1.5 s margin, plus holds before unexplained scores. The "corrections" are end-of-game insertions 127–590 s late; no `D` catches them.

**Corrected, soccer, with our own outages taken out** (2026-10-31 afternoon). The recorder slept 300 s after every failed scoreboard fetch until 12:22 PT, so this morning's "feed outages" (the 68'–71' batch among them) were ours. The replay now reads nothing inside the recorder's holes (gaps.jsonl, or inferred: every lane silent over 60 s while the clock ran over 20 s), plays landing after one size nothing, and the bench leaves each hole and the 300 s after it out of the feed's numbers. Five EPL matches (566 min) at q 0.95, horizon 3 s, by margin; "decisive late" = beyond 1.5 s + corrections:

| margin | D p50 | added vs today's page p50 | each new score behind real p50 | decisive late | flow late | stalls/h |
|---|---|---|---|---|---|---|
| 1 s | 98.9 s | +11.1 s | 105 s | 8.9% + 5.0% | 20.8% | 5.3 |
| **13 s (chosen)** | **110.5 s** | **+22.6 s** | **115 s** | **4.4% + 3.1%** | 16.2% | 2.4 |
| 20 s | 116.9 s | +29.6 s | 122 s | 4.2% + 2.3% | 13.7% | 2.2 |

MLS (761924, one match): 7.8% / 3.9% / 3.9% decisive late at margins 1 / 13 / 20 (D 97 / 108 / 114 s). Today's soccer page: 99 s behind real (the scoreboard 84 s, the core lane 53 s). All 12 EPL goals and 7 VAR decisions told live. The remaining ~2–3% corrections are ESPN's own late insertions (more than 30 s late, or behind told plays), which no `D` catches. Margin 13 stays the knee.

**Measured, college football** (two complete games, 401856842 and 401859185, 393 min; the recorder's holes, 79 min, taken out).
- *Drive batching (a) is false.* Outside the holes, plays are published one at a time: no drive arrived in one look (0 of 37 with three or more plays), and a drive's biggest single look held ~20% of it. Plays at a new game clock: lag p50 42–45 s, p90 56–61 s, p99 ~92 s.
- *Stoppage stamps (b) are true, for zero-clock plays after a stop* (a kickoff after a score or a field goal, a timeout, a pre-snap penalty): ESPN stamps them at the stop, minutes before they happen (a kickoff stamped at the field goal, 4 min before the TV break ended). The stopped-clock clusters now bound them as in the NBA (they needed the play clock read from its "11:35" display: college summaries carry no numeric value).
- measure.py's heavy tail (p90 ~490 s, p99 ~1530 s, kickoffs 253 s, sacks 1158 s) was the recorder's 300-s sleeps plus those stamps.
- Today's football page shows a new score 37 s after the real moment (the scoreboard alone 24 s; the summary first has it at 42 s).
- q 0.95, horizon 2.5 s (snap and kick 3 s), by margin; "late" = beyond 1.5 s + corrections:

| margin | D p50 | each new score behind real p50 | live-ball plays late | stalls/h |
|---|---|---|---|---|
| 1 s | 64.5 s | 63 s | 4.9% + 2.2% | 0.9 |
| 5 s | 68.3 s | 67 s | 4.5% + 2.2% | 0.9 |
| **10 s (set)** | **73.5 s** | **72 s** | **2.6% + 2.2%** | 0.6 |
| 20 s | 83.5 s | 82 s | 1.9% + 2.2% | 0.6 |

  The q × horizon grid at margin 1 (q 0.80 → 0.95: D p50 55 → 64 s, beyond 12.4% → 4.9%) is flat in the horizon. All 22 scoring plays told live. The 2.2% corrections are ESPN's late insertions. The NFL takes college's margin until tomorrow's games are measured.
- Two score reversals in two games: a punt-return touchdown revised in place to a plain punt return 30 s after it appeared (no review entry), and a scoreboard-only 9–7 that no play ever had, corrected after 11 min. The first, at D ≈ 74 s, is withdrawn before it's told; at a larger D it would be a told score revised down with nothing announced (a quiet correction today): open question below.

*Superseded below: the single-match numbers and the "≈4% no D catches" (that was the recorder).*

**Measured, soccer** (Chelsea v Manchester United, 2026-10-31, the first real Premier League recording: 115 min, 240 core looks, at the app's cadence; 97 decisive plays, so one play ≈ 1%):
- Today's soccer page shows a new score **89 s** after the real moment (p50, the scoreboard at 30-s polls; the scoreboard itself 83 s). Soccer's page has no lane score. The core lane first has the goal at 55 s: it leads the scoreboard by ~28 s.
- Core lag p50 64 s, p90 108 s, p95 154 s. Decisive kinds have no shorter tail than passes: shots p50 48 s (the "temp-attempt" ESPN posts first, revised in place later), saves 57, corners 65, free kicks 71; their p95 runs 121–188 s. A feed outage at 68'–71' delivered a whole stretch 240–411 s late; no `D` catches that (≈4% of decisive plays).
- Sized two ways (q × horizon, margin 1 s; "late" = beyond 1.5 s + corrections, decisive kinds):

| sizing | q | horizon | D p50 | added vs today's page p50 | decisive late | flow late | stalls/h |
|---|---|---|---|---|---|---|---|
| (a) every live-ball kind | 0.85 | 3 s | 81.0 s | +1.1 s | 24.7% | 24.9% | 5.7 |
| (a) | 0.90 | 3 s | 87.3 s | +2.3 s | 21.6% | 20.0% | 6.2 |
| (a) | 0.95 | 3 s | 91.5 s | +6.7 s | 21.7% | 17.0% | 7.3 |
| (b) decisive kinds only | 0.85 | 3 s | 90.0 s | +2.0 s | 19.6% | 16.3% | 2.6 |
| (b) | 0.90 | 3 s | 104.4 s | +12.8 s | 16.5% | 13.7% | 2.6 |
| (b) | 0.95 | 3 s | 141.7 s | +25.7 s | 12.4% | 9.7% | 2.6 |

  (b) is not smaller: decisive plays are sparse (~0.8/min), so their 40-play window spans ~48 min and keeps the outage in its q95. Sizing stays on every live-ball kind.
- **Chosen (pending the user's morning report):** every live-ball kind, q 0.95, horizon 3 s, a per-sport margin; soccer 13 s (D p50 101.5 s on the match, +20.1 s over today's page; decisive late 11.3% + 4.1% corrections; 4.7 stalls/h), NBA 1 s (horizon 2.5 s). The margin is the policy's per-sport value (`BroadcastLanes.policy`).
- Today's soccer page is so slow that the accepted +20 s buys more `D`. (a) q 0.95, horizon 3, with the margin raised: margin 10 → D 98 s, +17 s, decisive late 18.5%, 4.7 stalls/h; margin 20 → D 111 s, +27 s, 14.4%, 2.6/h; margin 30 → D 119 s, +36 s, 9.3%, 1.6/h. **A per-sport margin is the soccer knob**: about margin 13 for +20 s.
- **VAR** (three on this match, all told on time as events). ESPN revises an overturned goal in place to "Deleted After Review" (score back) and logs the VAR decision with the check's start time, arriving 132–213 s later. As implemented: review entries are an *announced* kind (told as an event even when late; never a quiet correction; inserted behind told plays they're `.late`). Entries inside a delay (Start Delay … End Delay) are bounded by it and placed backward from its end, so the decision lands where it was made, after the review beat. A told goal's score revised down with a review is held until the next play is told, so the score reverts *with* the decision, not quietly before it. A told reversal drops the score floor. The >30-s-late case in `tell()` (the 71' VAR arrived in a 210-s outage batch) is Phase 0's, in its tell-scheduling change.

### 3. Everything on the game page reads the presented state at `p`

- the hero's score, clock and period;
- the docked scorebar;
- the play lists (Latest, Key Plays, Scoring, Key Events): rows appear when their play is presented, and inline replays keep working;
- the shot chart, Game Flow and the other per-play charts;
- Win Probability:
  - ESPN's per-play probability, by event time;
  - Polymarket ticks presented at `tickTime ≤ p`, so the market line jumps with the basket, not 40 s before it. Check Polymarket's own latency from the recordings and timestamps.
- ScoringSlides and the celebrations: keyed to the play's decisive moment on `p`. **Delete `TheaterDelays`.**
- **The menu bar's score for this game:** while this game's page is open it follows `p`, so nothing spoils the play; otherwise it uses the fast lane, as today.
- **Notifications:** the same rule.
- **Box score and team stats:** they arrive as totals with each snapshot, so they can't be rewound per play. Hold the snapshot's tables until `p` passes that snapshot's watermark. **Say so if that's not feasible.** *Implemented, feasible.* Each summary's tables are held with the newest play's event time; the page shows the newest one `p` has passed. Exception: before `p` has passed any (right after opening), the first summary's tables show, at most one summary ahead.

*Phase A as implemented (mac/broadcast):*
- **Two presented views.** `Broadcast.present(event)` (hero, docked bar, menu bar, alerts) and `present(detail)`: play-keyed lists cut to what's told; Win Probability from ESPN's per-play values at the last told play; the line score derived from told plays; tables held as above.
- **The lanes' own lists are cut the same way:** shots, court plays, flow, the soccer trail, the football drive, baseball's at-bat and batted balls. The NBA's live marks (ball, clutch, run, players on fire) are computed from told plays.
- **The diamond.** Baseball's comes from the fast-lane situation recorded after the last told play.
- **The field.** Football's comes from the last told play's end spot.
- **Moments wait for their play's moment.** Scoring slides and celebrations get them then; Phase 0 moves slides to `Cue.scored`, and `TheaterDelays` is untouched.
- **The theaters keep today's inputs** until the director reads `BroadcastTheaterSource`.
- **A shown score never steps back (the floor).** Opening the page (or waking the Mac) sets a per-side floor: the most the user could already see, meaning the scoreboard's score, the scores list's copy and, on wake, what was shown. The hero, the docked bar and the menu bar show `max(p's score, floor)` per side. The floor goes for good once `p`'s score reaches it on both sides. It also goes if the scoreboard corrects its own score downward (a genuine overturn), and after 120 s. Only the score is held: the court and the lists still tell those plays at `p`, so the score leads them once, and only by what the user had already seen. Nothing new is shown ahead of `p`. A floor going doesn't send an alert. Before the first load the hero shows the scoreboard's score (no blank numbers).
- **The menu bar** shows the presented copy for the open game, with the floor, so opening the page doesn't step it back. The scoreboard's alerts for that game wait, and the page sends them from the presented changes.
- **Updates are discrete.** The page re-renders on a play told, a score, a clock start or stop, or a drift over 0.75 s; the clock text ticks itself. The odds chart redraws when `p` reaches each pending tick (`TimelineView(.explicit)`).

### 4. The theater director (all four sports)

**Ownership:** this section is implemented by CHOREOGRAPHY.md Phase 0 (anchor solver, splice, carried camera, `TheaterDirector`), not by Phase A. Phase A stops at the theater boundary: it gives the theaters the timeline (plays up to the watermark, with event times) and the clock `p`, behind a protocol CHOREOGRAPHY.md §10 can consume. Until Phase 0 lands, the theaters keep today's behavior.

The theaters stop owning time. Given the plays up to the watermark (lookahead), the director:

- schedules each play so its **decisive moment lands at its event time on `p`**. The decisive moment is the make, the catch or tackle, the ball in the net, or the contact or the pitch. The lead-in fills the time before it.
- **keeps continuity:** every play starts from where everyone is at that instant, at the end of the last play, mid-idle or mid-beat. Generalize `TheaterBridge` from "resting court → replay" to "any current lineup → next script". Far moves sweep the camera; Reduce Motion crossfades.
- **fills gaps** between plays with what the game state says is happening: the clock running or stopped, possession, and connective beats. Connective beats are phase B, but design the hook now.
- **compresses when plays are close together:**
  - shorten lead-ins;
  - merge minor plays into one flow (a miss and its rebound);
  - never reorder;
  - never let a decisive moment drift more than about ±0.25 s from its slot, except in a declared catch-up.
- **reports hard cuts.** Target: zero outside a declared jump.

Phase A may keep each sport's existing per-play scripts. It must anchor them on `p` and route every hand-off through the generalized bridge.

### 5. Rules that stay

- Theaters draw frames only while visible. Folded or scrolled away, no `TimelineView`, but the clock and the queue carry on.
- **The isometric views must never freeze during a live game.**
- Non-theater consumers update on discrete events: schedule the next change on `p`, never poll per frame.
- Reduce Motion: the same clock, with crossfades.
- One game page is open at a time. The timeline exists only for the open game page (plus the menu bar's pinned game, if that's cheap); no work for games nobody is looking at.

## How it's proven

- **Unit tests (`Tests/`):**
  - ingest: duplicates, out-of-order arrival, revisions, removals, missing event times;
  - the watermark;
  - clock slewing bounds, stall, catch-up and jump;
  - presented state at chosen times;
  - menu bar and notification policy;
  - Polymarket alignment.
- **Replay bench**, a CLI target or test helper:
  - Loads a recording (`~/Developer/scoreline-recordings/<sport>/<event>/<arrivalMs>.json.gz` plus `<sport>/scores.jsonl`). Since 2026-10-31 01:50 PT the recorder also writes `<event>/status.jsonl`, the core status the app polls every 5 s, which the bench replays as the status lane at the app's cadence (without it, the status still comes from the scoreboard's rows). For soccer it writes `<event>/core/<arrivalMs>.json.gz`, the newest one or two pages of core plays: soccer's real slow lane, ingested as a `core` tail lane so ids merge across looks and the newest version wins.
  - Feeds the snapshots at their arrival times, on a virtual clock, through the **real feed parsers**, the timeline, the clock and the director.
  - Prints:
    - `D` over the game;
    - the added delay versus the fast-lane score;
    - each decisive moment's error against its slot;
    - hard cuts;
    - corrections after presentation;
    - stalls and jumps.
  - Deterministic, and faster than real time.
- **Fixtures:** trim small slices of real recordings into `Tests/Fixtures/broadcast/` (a dense NBA stretch, an NFL drive, a soccer goal, MLB innings if any exist; otherwise statsapi captures).
- **Video:** render the theater along the bench's virtual time into frames, then encode an `.mp4` of a dense NBA stretch (a miss, offensive rebound, putback, then a made three back the other way) and a football scoring drive. Upload to the GitHub draft release "Videos" (its tag is `videos`: `gh release upload videos <file> --repo lame-o/scoreline --clobber`; ffmpeg is at `/opt/homebrew/bin/ffmpeg`), then delete the local copies. **Never keep videos locally.**

## Phases

- **A:**
  - timeline and clock;
  - the recording loader, which feeds recordings through the real parsers on a virtual clock (the bench's front end);
  - every non-theater page consumer on `p`;
  - the theater-facing protocol.

  All four sports. Ships together with CHOREOGRAPHY Phase 0, which owns the theaters, the bench's continuity metrics and video, and deleting `TheaterDelays`.
- **B onward:** CHOREOGRAPHY.md §12 (Phase 1 basketball, then football, soccer, baseball).
- **C:** web port, after the user tries the Mac.

## Policy knob (the user decides the default after seeing weekend numbers)

With ESPN's data, full coherence for the NBA costs roughly 20–25 s more than today's score display. Build `D` as a per-sport policy so that's a setting, not a rewrite:
- **Coherent:** `p` tracks the slow lane. This is the default. On 2026-10-30, after hearing the roughly +20 s cost, the user accepted it ("TV is not live instant either"); keep `D` as small as the data allows.
- **Hybrid:** `p` tracks the fast lane, and a scoring play whose details haven't arrived is told when they do, as an explicitly tagged replay. Never silently out of order.
