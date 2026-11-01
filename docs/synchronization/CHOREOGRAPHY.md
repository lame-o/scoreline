# The game as one continuous broadcast: the choreography engine

*Design document for the next generation of Scoreline's isometric play theaters (all four sports, Mac first, web after). Wave 28, 2026-10-30. Builds on `BROADCAST.md` (the presentation clock and `GameTimeline`); read that first.*

This document has three parts:
- **Audit (§2–§3):** what the code does today and what the feeds actually give us, measured.
- **Design (§4–§10):** the engine, its rules, its contracts, its budget and its tests.
- **Plan (§11–§14):** what to keep, replace and delete; the phases; the web; the risks.

Every number marked *measured* comes from the recordings in `~/Developer/scoreline-recordings` or the fixtures in `Tests/Fixtures`. Every number marked *tune* is a starting value that must be tuned against recordings on the replay bench before it ships.

---

## 0. Glossary

| Term | Meaning |
|---|---|
| **p** | Presentation time: `now − D` on the game's `PresentationClock` (BROADCAST §2). Everything in the engine is indexed by p, in seconds. |
| **Anchor** | The p at which a known event's *decisive moment* must land: the ball through the net, the catch, the tackle, the ball crossing the goal line, the pitch reaching the plate. Solved by the anchor solver (§5.1). |
| **Beat** | One thing that happens on the field, with an anchor or a window, actors, a spot and a **provenance**: *known* (a feed play), *inferred* (a rule derived it from known plays: an assist implies a pass) or *ambient* (synthesized filler that changes nothing the data says). |
| **Sequence** | A causal chain of beats with one sport's semantics: a basketball possession, a football down or drive segment, a soccer phase of play, a baseball plate appearance. |
| **Plan** | Keyframes for every actor, the ball and the camera over a horizon of p, built from sequences and the on-screen state. |
| **Bake** | Turning a plan's keyframes into dense tracks (60 Hz positions, the rig's gait samples, ball segments, camera samples). Done once per plan, off the frame path. |
| **Sample** | Reading the baked tracks at one p to draw a frame. O(1) per actor, allocation-free. |
| **Splice** | Replacing the tail of the current plan with a new one from a commit point, starting exactly from the current plan's state there (position, velocity, gait phase, planted feet, ball, camera). The only way the future changes. |
| **Declared jump** | A deliberate discontinuity with a visible transition: opening the page, waking, a `Jmax` catch-up (BROADCAST), an instant replay's stinger. Nothing else may be discontinuous. |
| **Hard cut** | Any discontinuity that isn't a declared jump. Target: zero. |

---

## 1. Summary

**What's wrong today, in one paragraph.** Each sport tells the game as a queue of self-contained clips: a play arrives, a script is built for it in its own frame, from its own freshly laid-out formation, and it plays on its own clock; then the next. The idle between plays is a separate script. The only hand-off with real continuity is `TheaterBridge`'s idle → replay bridge, and only from a resting field to a replay. Replay → replay hard-cuts, the court or field turns with a crossfade whenever the frame changes ends, catch-up silently drops plays, and the theater's time has no relation to game time: a 14-second possession and a 2-second putback each take "one clip". The figures, the rig, the ball physics and the camera spring are excellent. The *sequencing* is what needs replacing.

**What we build.** A per-game **choreography engine** that turns the `GameTimeline` (up to its watermark) into one continuous, deterministic world, presented on p:

1. An **anchor solver** places every known decisive moment on p with sub-second precision, from wallclocks (1 s resolution, *measured*), game clocks and physics.
2. A **sequencer** groups plays into sequences with sport semantics and infers the events the feed never logs: passes, inbounds, outlets, huddles, line-ups, kickoffs, throw-ins, runner returns. Each inferred event is marked as inferred.
3. A **choreographer** builds keyframes for every actor. It works backward from each sequence's decisive moment, using a tactical template chosen by the data, so a corner three that was assisted looks like a drive-and-kick and a step-back looks like an isolation. It always starts from whatever is on screen.
4. A **motion layer** bakes C²-continuous tracks within human speed, acceleration and turning limits, avoiding collisions, with honest ball physics. It feeds the existing rig: 0 mm foot slip, kept across splices.
5. A **director** runs one broadcast camera for the whole session (pan, zoom, and now *yaw*, which orbits as the ball changes ends), pushes in on decisive moments, and shows instant replays only in dead time behind a declared stinger. It times tags, stamps and celebrations to the decisive moment.

The architecture is **Plan → Bake → Sample** with **receding-horizon splicing**. New data never cuts the picture. It retargets the future from the present state, velocity-continuous: Apple's interruptible-animation principle applied to a whole game.

**The five invariants** (each is a bench metric, §9):
1. **One world.** Every actor and the ball have one continuous track for the whole session. Positions are C¹ everywhere and C² except at contact events.
2. **Known events land on their anchors.** Error ≤ 0.25 s, except in a declared catch-up.
3. **Nothing decisive is invented.** Ambient motion never shoots, scores, tackles, fouls, substitutes or changes possession.
4. **Inferred is honest.** Names and stats go only on what the data credits. Inferred beats carry no names, and catch-ups and replays are tagged.
5. **Draw only what's seen, only as often as it moves.** No frames off-screen. Frame rate is planned by tier: 0, 30 or 60 fps. Sampling is allocation-free.

**What we build first:** Phase 0 is shared and can run today's scripts. It delivers the replay bench with continuity metrics, the anchor solver, the generalized splice and the carried camera with yaw. Phase 1 is basketball: the lineup tracker with persistent identities, the possession sequencer, half-court and transition choreography, and dead-ball choreography. Then football, soccer and baseball. The web follows once the user has tried the Mac version. Details in §12.

---

## 2. Audit: the theaters today

Paths are relative to `Sources/Scoreline/`. Line numbers are as of 2026-10-30.

### 2.1 Shared foundation

| Piece | What it does | Verdict |
|---|---|---|
| `TheaterRig.swift`: `RigTrack` (309–517), `RigGait` (531–545), `RigPose.gait` (551–590), IK (`Rig.reach`), `RigFigure` | Measures a figure's motion **once per script** from a `position(t)` closure at 60 Hz. Heading turns toward travel or what he watches, at a limited rate (`fastest = 11 − 5·run` rad/s). Cadence and duty follow speed. Each footfall is planted where the hips will be mid-stance, and a stop finishes its step. A 5-sample speed smoothing absorbs path kinks. Feet reach by two-bone IK and are clamped to a leg's swing ("a fast-forward run strides long, not into the splits"). One silhouette per figure, with limbs depth-sorted every frame. | **Keep, extend.** This is the engine's motion back end. It needs one addition: `RigTrack(continuing:)`, which seeds phase, heading and the planted steps from a previous track so a splice keeps 0 mm foot slip (§5.5.6). It also needs to accept baked position samples instead of a closure. |
| `TheaterBridge.swift`: `plan` (128), `match` (144), `tracks` (201), `pose` (222), `Far` (52) | Idle → replay only. It matches figures by athlete, then by kind, then nearest, with an untangling pass. If the median move ≤ the far rule (football 12 ft, basketball 10 ft, soccer 7 m, baseball 8 ft), each man travels over 0.5–0.7 s on `cubic-bezier(0.77, 0, 0.175, 1)` while both scenes keep playing underneath (the blend is C¹ because the curve's derivative is 0 at both ends). Otherwise there's a 0.25 s ease-out crossfade. It runs inside the replay's own lead-in when it fits. | **Generalize, then retire.** The matching (assignment by identity, then role, then distance, then untangle) and the "far" judgment survive as the splice's *identity-less fallback* and as the Reduce Motion crossfade pairing. Lerping two moving scenes is replaced by splicing one plan from the other's state (§4.5). |
| `TheaterBridge.swift`: `TheaterDelays` (253–264) | Adds the bridge's delay to the scoring slide. | **Delete** (BROADCAST: slides key off the decisive moment on p). |
| `TheaterKit.swift`: `CameraRig.follow` (30) / `CameraFollow.samples` (171) (duplicates), `CameraRig.blend` (60), `CameraFrame.fitting`/`clearing` (96/108), `CameraPath` (139) | A critically damped spring (ω = 7, about 0.9 s response) on pan and log-zoom, with pan capped at 1.4 view-heights/s and zoom clamped to −1.1…+2.2 log-units/s. It's integrated once per script. Shot blends take 0.4 s, or 0.9 s through a wide two-shot when far ("as an operator would rather than sliding across"). The stamp corner is kept clear. **Every script's camera starts at its own `goal(0)` with zero velocity.** | **Keep the operator and the spring, change the ownership.** One camera state (with velocity) runs for the whole session, carried across splices; yaw becomes a camera parameter (§5.6). Dedupe `CameraRig`/`CameraFollow`/`PlayCamera`. |
| `TheaterNames.swift`: `TheaterCast`, `TheaterTags`, `TheaterTagLayout` | Broadcast name tags on credited figures, placed once per stretch in the clearest spot, raised on a stem when buried, gliding at hand-offs. | **Keep.** With persistent identities (§5.3) a figure keeps its athlete across sequences, so a tag survives hand-offs instead of re-placing. |
| `TheaterStatus.swift` | Status tag ("SPURS BALL", "TIMEOUT · JAZZ"), the "Live · 4s" heartbeat, the per-game flip control. | **Keep.** The heartbeat should also be able to show the presentation delay D. |
| `ReplayWell.swift` | Inline replay of one play under its row, on its own clock, with soccer camera "takes". | **Keep the well, change what it plays.** It replays the play's *sequence* (the possession or the drive segment) through the same engine on a historical window, starting a few seconds before. |
| `ScoringSlideView.swift` / `ScoringSlide.swift` (`SlideTheater.climax`, 887–925) | Times the score wipe to the theater's climax, computed by building the play's script again. | **Replace the trigger** with the decisive-moment cue from the plan (BROADCAST §3). |

### 2.2 Basketball

**Pipeline.**
1. `BasketballFeed` (an `@Observable` lane over ESPN's core play-by-play) produces `BasketballTheaterState { plays, news, heard }`.
2. `BasketballScene.parse` (`BasketballScene.swift:335`) turns raw plays into scenes. It already links causes: `missBefore` (641), `stealBefore` (664), `reboundAfter` (687), `andOneFouler` (673) and `freeThrows(after:)` (820). The links surface as `leadIn` and `follows` (218–220).
3. `BasketballQueue.next` (`BasketballFlow.swift:68`) picks the next unit.
4. Each unit becomes a script in one of two ways:
   - A marquee unit (any made FG with a spot, any block, a late tying or go-ahead miss: `replays`, `BasketballScene.swift:292`) becomes `BasketballScript(scene, right:)` (`BasketballScript.swift:418`), built **from a fresh template set** by `lineUp` (567). Its time starts at 0.
   - Any other unit becomes `BasketballScript(beat:from:)` (`BasketballBeats.swift:152`), started from the previous `Lineup`.
5. Between plays, `BasketballScript(rest:)` (`BasketballBeats.swift:139`) runs a 30 s court rest with sparse beats.
6. Frames come from `BasketballFrame` (`BasketballTheater.swift:428`), one Canvas: court, shadows, tags, baskets in two passes, players, ball, flashes, stamp and banner.

**Queue** (`BasketballFlow.swift:19–117`; `BasketballTheater.swift:1275–1344`).
- One unit at a time. `finish()` waits for the script's `duration` plus a read beat:
  - 1.6 s after a marquee, or 0.9 s if more is pending;
  - 0.45 s after a beat, or 0.2 s if more is pending.
- Then `advance()` picks the next unit.
- A miss covers its rebound (`follows`). A putback or break replay retells its lead-in plays.
- Substitutions at one stoppage are grouped.
- If the estimated telling exceeds a 12 s budget, the least important plays are **dropped** (subs, timeouts, reviews, then rebounds, fouls and violations, oldest first; never a replay and never the newest), with "CATCHING UP · N PLAYS".
- Theater time is wall time since the unit started, unrelated to the game clock or wallclock.

**Idle** (`BasketballBeats.swift:1308–1650`). `BasketballFlow.rest` picks a `Rest.Phase` (live, inbound baseline or sideline, lane, benches, off-court, tip, loose) from the last play. `liveRest` brings the ball up into one of three half-court sets (5-out, horns, 4-out-1-in) and then plays a small beat every few seconds (jab, swing, cut, screen), still in between. A `TimelineView` exists only during `active` windows (`breathe()`, 1346). After 30 s, a new rest starts from where it stood.

**Hand-offs and every place continuity breaks:**

| # | Where | What the viewer sees | How often |
|---|---|---|---|
| B1 | `BasketballTheater.swift:1189–1191`: `.id(now.key)` + `.transition(marquee ? .identity : .opacity(0.28))` | A marquee replay that comes up while anything is being told (not resting) is built `from: nil` (1295) and **hard-cuts** to its own template set. | Every marquee told back to back. About 2 of 9 in the recorded 4th quarter (*measured*), more in dense stretches. |
| B2 | `BasketballTheater.swift:1295` (`if unit.marquee, let resting`) | Bridged replays still settle into a *template* set (`lineUp`, `BasketballScript.swift:567`) rather than the floor as it stood. Men walk to slots the play invented. | Every bridged marquee. |
| B3 | `BasketballTheater.swift:968–972` (`together`), `TheaterBridge.plan` far rule | A replay at the other end, or a median move > 10 ft, crossfades 0.25 s. | Every replay after a change of ends: breaks, steals, and makes after a rebound. |
| B4 | Frames are offense-relative: `Lineup.seen(by:)` (`BasketballBeats.swift:50`), `Hoops.yaw(right:)` (`BasketballScript.swift:71`) | The view's yaw is −30° at the right basket and +30° at the left. When consecutive scripts are framed for different ends, **the whole court snaps 60°** under a 0.28 s crossfade: two courts at different angles, double-exposed. | **Every change of possession** between scripts, about 200 a game. |
| B5 | `beatCamera` (`BasketballBeats.swift:1290–1300`), `restCamera` (1685–1693) | The camera continues from the previous framing only if yaw *and* formation match (`same`). Otherwise it starts at its own goal. | Same as B4, plus lane and benches transitions. |
| B6 | `place(_:near:within: 32)` (`BasketballBeats.swift:220–223`), `missBeat` (478–485), `reboundBeat` (771), `substitutionBeat` (1146), stoppages (1200, 1247), `rest` loose (1330), `liveRest` (1411) | If the floor "had moved on", or wasn't in `.play` formation, the beat **sets up fresh** at a template (`setUp`). Every man teleports, hidden by the 0.28 s crossfade. | Every beat after lane, benches or tip formations; every beat after a dropped play; any shot > 32 ft from the holder. |
| B7 | `BasketballQueue.next` catch-up (99–107) | Dropped plays never happen on screen. A foul's lane alignment, a timeout's huddle, a rebound: the next beat starts from a state the viewer never saw (and often triggers B6). | Whenever more than 12 s of telling is pending. Routine after a burst. |
| B8 | `finish()` read beats; `breathe()` 30 s rounds | Theater time is decoupled from game time. A 14 s possession and a 2 s putback each take one clip. Rests are filler with no relation to the game clock. | Always. |
| B9 | `BasketballScript.Player.position` (`BasketballScript.swift:187`) + `PlayScript.Move` (`PlayScript.swift:181`) | Paths are polylines with corners. Each move is its own smoothstep, so a man **stops between consecutive moves**. `shadow()` (586) re-targets defenders every 0.25 s on linear segments, so velocity jumps four times a second. `RigTrack`'s smoothing hides it in the gait, not in the drawn position. | Every replay and beat. Subtle, but it's what reads as "animated" rather than "played". |
| B10 | Reduce Motion: `time()` returns `.infinity` (1153–1159) | Each unit jumps to its end state. | By design. Fine as a principle; the new key-state mode keeps it (§6). |

**Excellent, and must be kept:**
- **Data fidelity of shots.** The release is at ESPN's spot, the flight is gravity-timed, and the ball goes through the net (tested).
- **Rebounds.** The `Carom` model (`BasketballBeats.swift:305–352`) bounces by the miss's distance and angle, because ESPN puts the rebound at the *shot's* coordinate. The rebounder comes from where his role would (`rebounder`, 353).
- **Continuity of the lighter beats.** `Lineup` (`BasketballBeats.swift:37`) already gives video-game continuity between consecutive beats.
- **Officials** appear only while acting, then fade (`whistle`, `signalled` = 1.5 s).
- **The camera operator.** Shot lists (`shoot()`, `BasketballScript.swift:1566`), the stamp corner and banner headroom.
- **Measured pacing.** `approachPace` = 1.2 was measured against real speeds.
- **Honest tags.** `BasketballStatus` says "MEDIA TIMEOUT" only when the words do, and "CATCHING UP" when it skips.
- **Deterministic variety.** `SplitMix64` is seeded by play ID.
- **Testable frames.** Every frame is a pure function of (script, t).
- **Work kept off the frame path.** A `TimelineView` runs only while moving and seen. The rest is pre-built off-main (`finish()`, 1325).

**Per-frame cost:**
- `posed()` (550) allocates several arrays per frame (`map`, `sorted`, `compactMap`). Each figure builds a `RigSkeleton`, a `RigFigure` with a `limbs` array, and several `Path`s.
- `pose()` scans `player.actions` with closures per figure per frame.
- The court's polylines are cached in court space (`HoopsCourtLayer.standard`) but re-projected with `map` each frame.
- `picture()` rebuilds `TheaterTags` and the status per frame.
- `BasketballFrame.==` short-circuits on `t` (cheap).
- None of this has been measured; Phase 0 measures it first (§8).

### 2.3 Football (NFL and college)

**Pipeline.**
1. `DetailView.fastLane` polls every 5 s. `FootballFeed.update` (`LiveFeeds.swift:685`) re-reads the last page of plays only when `situation.lastPlay` changes. It holds a new situation up to 15 s so the idle's spot and the play arrive together (721–728).
2. `FootballScene.parse` (`FootballScene.swift:508–614`): structured fields first, with text adding lane, gap, depth, flags and formation hints (NFL grammar 619–686, college 692–752); depth-chart slots (476–497); `nextHash` (376–394); the try is a derived scene, `conversion` (332–368).
3. `FootballScript.init` (`FootballScript.swift:466`) → `Builder.build` (1010–1042): formation, then the kind's builder, then `stretch` at 1.3× from snap to dead ball (1049–1080), flags, `finish`, `headline`, `settle` (2011–2029), the camera (`shoot`, 2037–2153) and the rig.
4. `FootballStage` (`FootballTheater.swift:951–1343`) owns time as wall-clock `Replay`/`IdleClock`.

**Queue.**
- `begin()` (`FootballTheater.swift:1287`) starts plays one at a time.
- Queued plays start 0.7 s after the previous replay ends, with no bridge.
- Otherwise the end holds 8 s (`TheaterKit.hold`) before the idle.
- The queue keeps the newest 5 (`LiveFeeds.swift:903`); older ones fall off silently.
- Only the newest stoppage after the newest snap survives (802–804), so timeouts between batched snaps are dropped.
- Nothing is anchored to event time.

**Idle.**
- `FootballIdle.make` (`FootballIdle.swift:167–220`) picks a phase (stoppage, review, injury, kickoff, between) and a formation (the last set, heavy, shotgun, bunch). The **strong side is a coin flip** (202).
- The "between" idle: huddle from 0.4 s, line-up at 7 s, then a 24 s pre-snap loop.
- Timeout idles hold 34 s and commercial idles 44 s.
- A `TimelineView` runs only inside beats.

**Continuity breaks** (per-game frequencies from two whole NFL games: about 155 snaps, 19 drives, 10 kickoffs, 6–7 TDs):

| # | Where | What the viewer sees | Per game |
|---|---|---|---|
| F1 | Replay → idle, 0.35 s crossfade (`FootballTheater.swift:1147–1149, 1204–1206`) | The formation is laid out again with a **re-rolled strong side** (slot, TE and safeties mirror half the time), the hash moves, the camera jumps, and the idle then walks *back* from the line to a huddle (`FootballIdle.swift:349`). After a change of possession the field also rotates 60°. After a score the pile teleports to the kickoff unit. | ~145 |
| F2 | Idle restart on any `idleKey` change (`FootballTheater.swift:1055, 1187, 1278`) | Men mid-huddle or mid-motion snap to a new t = 0, re-seeded. | ~25–30 |
| F3 | Idle → play far-rule crossfade (`TheaterBridge.swift:132–135`) | Special teams are never shown in the idle (`FootballIdle.swift:187–200`), so punts and FGs crossfade in. So do kickoffs after a commercial idle, plays from a huddle, and the post-halftime empty field. | ~15–25 |
| F4 | Bridge, median-only far rule (`TheaterBridge.swift:135–137, 240–244`) | When the strong side flips, slot, nickel, TE and safeties cross 34–76 ft in 0.5–0.7 s (**50–150 ft/s**) while the median stays ≤ 12 ft. | ~50–60 |
| F5 | Replay → replay (`FootballTheater.swift:1198–1202, 1295–1298`) | Hard cut: formation, hash and camera jump. | Whenever a play lands within duration + 8 s (rare in the NFL, common in college batches) |
| F6 | TD → try (`follow()`, `FootballTheater.swift:1336–1342`) | Hard cut to the try formation. The PAT is embedded in the TD entry and edited in later, so it often cuts in from the idle. | ~6–7 |
| F7 | Score then TV timeout (`FootballIdle.swift:206–213, 278–282`) | `.commercial` beats `.kickoff`: a **scrimmage formation at the scorer's 35**, then a crossfade to the kickoff. | 14 of 19 scores |
| F8 | College stoppages share the previous snap's `sequenceNumber` (`LiveFeeds.swift:802–804` requires strictly greater) | No timeout idle, no quarter turn. The next quarter flips the yaw under a crossfade. | 30 of 35 college stoppages |
| F9 | `settle()` cuts holds (`FootballScript.swift:2020`); `pose()` has no release envelope (`FootballTheater.swift:578–587`) | A tackled runner or sacked QB goes **from flat on the grass to upright in one frame**. | ~100 |
| F10 | Script rebuilt mid-replay on a revision or on depth charts arriving (`FootballTheater.swift:1356–1362`) | Mid-play jump. | Occasional |
| F11 | Idle lengths (34 s, 44 s, ~10 s) vs real (timeout ~52 s, TV ~158 s, quarter ~205 s) | The 24 s pre-snap loop repeats for minutes: frozen in feel. | Every stoppage |
| F12 | `SlideTheater.football` keys on the feed's newest play (`ScoringSlide.swift:907–910`) | A queued TD's slide lands before its replay does. | Per batched TD |

**Excellent, must keep:**
- **The two-grammar parser.** Flags carry timing and enforcement spots, and reviews and reversals are parsed (`ruling()`).
- **Personnel and formations from data.** Depth-chart slots, 4-3 and 3-4 fronts, the defense answering each formation (`FootballScript.swift:619–705`).
- **The pace rule.** 1.3× only from snap to dead ball.
- **Turnover realism.** Fumble scrambles and the punt and kickoff outcomes.
- **`settle()` reforming at the new line.** It's the natural source for the next play's walk-up.
- **Hash continuity** (`nextHash`).
- **Field facing per period** with the viewer's flip.
- **Stoppage-specific idles.** Sidelines, the field turn with exact framing, trainers, the red challenge flag.
- **Sparse-beat power discipline.**

**Per-frame cost.**
- `GridironLayer.draw` builds ~400 hash segments and 21 lines per frame.
- `posed()` sorts 22–30 figures and allocates.
- `RigPose.keyed` allocates array literals.
- `TheaterTags.draw` builds a string key per tag per frame.
- `FootballFrame ==` at rest deep-compares scripts, including the rig and camera sample arrays.
- `SlideTheater.football` rebuilds a full script on every `climax()` read.
- The 1 Hz heartbeat isn't gated by visibility.

### 2.4 Soccer

**Pipeline.**
1. `SoccerFeed.update` (`LiveFeeds.swift:174`) polls every 8 s.
2. Each new entry is parsed into events (`SoccerEvent.parse`, `SoccerIdle.swift:74–152`) and a "touch" (`SoccerTouch.parse`, 184–191: side and spot of the last located entry).
3. Only the **newest moment** (shot, goal, penalty) in a poll becomes a scene (`updateTheater`, `LiveFeeds.swift:300–313`). `SoccerScene.parse` (`SoccerScene.swift:334–468`) walks back up to 20 s for the build-up (`buildUp`, 537–632) and forward for the save or rebound.
4. `SoccerScript.init` (`SoccerScript.swift:319`) builds the replay. `SoccerScript(idle:)` (`SoccerIdle.swift:347`) builds circulation idles: 5–7 passes in a 40–60 s seamless loop.

**Queue.**
- There is no backlog of moments: a moment arriving mid-replay or mid-hold **hard-cuts** (`SoccerTheater.swift:1453–1457`).
- Events (fouls, cards, subs, corners) play one at a time for fixed beats of 6–11 s (`SoccerIdle.swift:306–314`), behind the replay plus an 8 s hold.
- Older events are dropped by a newer moment or by the `suffix(10)` cap.
- Simulated against a full match: event beats start p50 48 s after their wallclock.

**Continuity breaks** (per 96-minute match, from a simulation over Villa v City, 1379 entries):

| # | Where | What the viewer sees | Per match |
|---|---|---|---|
| S1 | Idle re-key on the touch's 15×17 m cell, side or period (`SoccerTheater.swift:1218–1219, 1303–1305`) | 0.35 s crossfade, **all 22 men and the ball re-seeded**, new camera. | **~294 (3 a minute)** |
| S2 | Event-beat swaps (`SoccerTheater.swift:1216–1217`) | Same crossfade and re-seed. | ~127 |
| S3 | Same-key idle rebuild (`SoccerTheater.swift:1499–1505`) | Instant snap of poses, ball and camera, with no transition. | ~17 |
| S4 | Idle → replay (`TheaterBridge.swift:135`) | **16 of 22 crossfade**: the idle and replay shapes use different models (`SoccerIdle.swift:415`: `b.x − 45`, width 0.95, vs `SoccerScript.swift:1086–1088`: `b.x − 52.5`, width 0.9, onside clamp), and set-piece replays pack the box at t = 0. | ~16 |
| S5 | Replay → idle (`SoccerTheater.swift:1340–1353`) | Payoff dissolves into a fresh shape at the latest touch. | 22 |
| S6 | Replay rewinds time (`SoccerScene.swift:635–637`) | The replay retells up to 11 s *before* the shot, after the idle has already shown synthetic play past it. | Every moment |
| S7 | After a goal (D7 in the audit) | The scoring team "passes it round" in the opponent's box, then a crossfade. ESPN emits no kickoff entry (0 of 3); the restart pass at the centre comes 42–87 s later. | 3 goals × 23–68 s |
| S8 | Corner and free-kick beats time-boxed to 7–8 s | The real restart takes 13–38 s (corners) or p50 20 s (free kicks), so the set-up is abandoned for circulation. | 11 corners, 41 fouls |
| S9 | Red card (`SoccerIdle.swift:762–767`; `SoccerScene.swift:795–805`) | The man walks off, then **reappears** in the next idle: 11 v 11 forever. | Rare, always wrong |
| S10 | Added time (`SoccerScene.swift:808–812`) | Subs logged in added time are never applied (`clock.value` freezes; `addedClock` is ignored). | 5.3% of entries are in added time |
| S11 | VAR "NO GOAL" (`SoccerTheater.swift:1447–1449`) | Hard cut and a full retelling with a different ending. | Per overturn |
| S12 | Reverse "behind the net" take (`SoccerScript.swift:997–1003`) | Two declared camera cuts. Broadcast grammar; keep as a declared device. | ~18 |
| S13 | Officials and physios fade in from nothing (`SoccerIdle.swift:439–444, 746`) | 0.3 s fades. | ~20 |

**Net effect.** About **83% of presented time is synthetic circulation re-seeded every ~20 s**, and the replays depict **2.8%** of the real match. This is the theater with the most to gain: the data covers 65% of match seconds within 3 s of a located entry (§3.3).

**Excellent, must keep:**
- **Coordinates.** The Opta-to-metre piecewise mapping through the markings (`SoccerScene.swift:44–69`).
- **Build-up pacing** with physical floors (`beats`/`least`/`flight`, `SoccerScript.swift:664–702`), and "nothing waits in the air".
- **The keeper.** Tracking, stranding, and dives with the hand pinned exactly to the ball (871–877).
- **The mark solver.** Hard and soft marks with reachability clamps (1128–1181).
- **Shapes from the formation** (`SoccerLineup.shaped`).
- **The camera.** Best-of-6 "care" tracks keep the stamp clear.
- **Event semantics.** A card placed at its foul, VAR phrase extraction, delay dedupe.
- **Celebrations** anchored to field points.

**Per-frame cost.**
- `PitchLayer.draw` rebuilds every path each frame.
- Two nets of ~140 projected points with `exp`.
- `RigPose.keyed([...])` array literals for every action of every actor, every frame (`SoccerTheater.swift:784–815`).
- While bridging, posing roughly doubles.
- About 311 idle rebuilds a match, each a 40–60 s × 22-actor RigTrack plus camera bake on the main actor: likely ≥ 10 ms each (unmeasured).
- `window + newItems` makes the first load O(n²) (`LiveFeeds.swift:213`).

### 2.5 Baseball

**Pipeline.**
1. ESPN core plays (an 80-entry window) arrive through `BaseballFeed.update` (`LiveFeeds.swift:1143`), merged with statsapi: `Statcast.fields`, `StatcastStore.atBats`, and the live poll every ≥ 4.5 s.
2. `PlayScene.parse` (`PlayScene.swift:324–411`) builds the newest play. `PlayScene.measure` (807) attaches hitData and runner legs, with a publish hold of up to 3 s (`LiveFeeds.swift:1401`).
3. `PlayBeat.timeline` (`PlayBeat.swift:178–299`) builds the per-pitch spine: a `batterUp` beat, each non-final pitch, MLB non-pitch events (pickoffs, visits, changes), plays and inning breaks.
4. `PlayScript` builds play, beat, idle and rest scripts. `PlayStage` (`PlayTheater.swift:1488`) owns the queue and the hand-offs. `ScriptMemo` (2062–2091) caches, **building synchronously inside `body`**.

**Queue.**
- `PlayBeat.catchUp` (`PlayBeat.swift:153–159`) keeps only the newest play, drops everything before it, and keeps the last 4 pitches of a backlog.
- Beats play back to back at full length. A replay's end holds 8 s, or 1.4 s if more is pending.
- A new play preempts a running beat or replay.
- **`wallclock` and statsapi `startTime` are parsed but never used for scheduling.**

**Idle.**
- `IdleBeat.fitting` (`PlayBeatScript.swift:811–822`): sign, weight, catcher, practice swing and lead, every 4.5–8 s, each 1.3–2.8 s.
- Dead time is static: runners frozen 7 ft off the bag in a crouch, the catcher permanently squatting.
- `Ballpark.onDeck` is defined but unused.

**Continuity breaks** (per game, from World Series games 3–5):

| # | Where | What the viewer sees | Per game |
|---|---|---|---|
| M1 | `rest(for: last)` uses the finished hitter's `bats` (`PlayBeat.swift:199`; `PlayTheater.swift:1647`) | A **phantom previous batter** fades into the wrong box. When `batterUp` arrives (p50 30 s later), he **glides 18 ft across the plate** in 0.5–0.7 s. | Phantom ~52, glide ~35–55 |
| M2 | Settle walks fielders home in 0.8 s (`PlayScript.swift:1418`) | Outfielders rubber-band at 75–150 ft/s. | ~50–64 |
| M3 | Fades instead of leaving (`PlayScript.swift:1206, 1001, 1164, 1173, 1428–1432`; `PlayBeatScript.swift:546, 564–576, 606–616`) | The strikeout batter fades in the box, scorers fade at the plate, the reliever appears mid-outfield, runners pop on and off bases. | ~80+ |
| M4 | Consecutive pitches bridge from `script(.rest)`, whose `CameraTrack()` is empty (`PlayCamera.swift:182–183`; `PlayTheater.swift:611, 1972`) | Camera snaps from the tight battery shot to the infield framing, then eases back. | Whenever 2+ pitches queue |
| M5 | A runner play draws its own generic pitch (`PlayScript.swift:1233–1256`) | A steal or wild pitch **re-throws** the pitch, or the real call is lost. | 1–5 |
| M6 | `catchUp` drop plus median far rule (`TheaterBridge.swift:240–244`, threshold 8 ft) | One runner 90 ft out of place still "bridges": a 90 ft glide in 0.6 s. | 1–3 |
| M7 | Play → play under `.identity` (`PlayTheater.swift:1599, 1953`) | Hard cut. | Rare |
| M8 | Camera `Shot(cut:)` (`PlayCamera.swift:264–266, 310–369`) | Cuts on outfield hits and the HR trot. Some are TV-legitimate, but none are declared. | ~10–16 |
| M9 | Mid-replay rebuild when live `bases`/`bats` change (`PlayTheater.swift:2071–2075`), and late Statcast | Runners and batter pop; the trace redraws in place. | Occasional |
| M10 | Fast-lane `bases` drive the idle (`PlayTheater.swift:1646`) | Runners shown ahead of the told plays, then glide backwards at the next replay. | Per lag window |
| M11 | Tarp and delay (`PlayScript.swift:614–617`) | Figures vanish instantly. | Per delay |

**Time.** Plays run 2–9× faster than real: runners at 95 ft/s, the trot at 140 ft/s, the settle in 0.8 s. Scripted motion covers about 13% of the game; **about 70% of wall time is a still frame**.

**Excellent, must keep:**
- **Pitch physics.** Statcast's 9-parameter kinematics on every pitch (916 of 916), release and plate times, real zone heights. `shaped()` is the fallback.
- **`BattedFlight`.** Drag calibrated to measured distance, wall caroms, hops and roll.
- **The official account.** `handling` turns credits into a throw chain (relays, rundowns, errant throws), and `official` gives runner legs in out order. `sequenceRuns`/`holdThenRun` keep runs from preceding the handling.
- **Coverage inference** (`coverer`).
- **The beat vocabulary.** ABS challenges, check swings, secondary leads, pickoffs.

**Per-frame cost.**
- `BallparkLayer.draw` rebuilds the field each frame: ~540 `fence()`/`polar()` trig calls. The projection is affine, so a cached path plus one transform would do.
- `posed()` sorts and allocates, and copies a full `PlayFrame` while bridging.
- `PlayFrame ==` at rest deep-compares rig arrays.
- **Script builds run on the main actor inside `body`.** `SlideTheater.baseball` builds another, unmemoized.

### 2.6 Census: where continuity breaks, all four sports

| Break class | Basketball | Football | Soccer | Baseball | Root cause | Fixed by |
|---|---|---|---|---|---|---|
| Hard cut between plays | B1 | F5, F6 | S11, replay→replay | M7 | Clips with view identity per play; bridge only from idle | One world + splice (§4.5) |
| Crossfade as a crutch | B3–B6 (~200/game) | F1, F3 (~170/game) | S1, S2, S4, S5 (~460/match) | M3, ended→rest | Each script in its own frame and fresh formation | Persistent world, aftermath = next set-up (§5.4.7) |
| Re-seeded or re-rolled formation | B2, B6 | F1, F2 | S1–S3 | — | Formations invented per script | Formation state carried; changes are motion |
| Superhuman glides | B9 corners | F4 (50–150 ft/s) | hard marks uncapped | M2, M6 (75–150 ft/s) | Median far rule; fixed-length settles | Limits + retiming (§5.5.4) |
| Fades instead of travel | officials (by design) | officials, staff | officials, red card, subs | batters, runners, relievers | Short scripts can't afford walks | Real durations: dead time is long enough to walk (§6, §7) |
| Dropped events | B7 | queue suffix(5), stoppages | suffix(10), newer moment | `catchUp` | No time model; fixed per-clip lengths | Anchored on p; dead-ball kinds attach late (§4.6) |
| Theater time ≠ game time | B8 | F11 | S6 | 2–9× fast | Arrival-driven | p-anchored (§5.1) |
| Camera restarts per script | B5 | F1, F5 | S1 | M4, M8 | Camera owned by scripts | One camera with carried state (§5.6) |
| Pose snaps | — | F9 | S3 | M9 | Holds cut; rebuild mid-play | Release envelopes; plans never rebuilt behind `c` |


---

## 3. What the data gives us (measured)

**Sources.**
- **NBA:** two recorded games (401909285, 76 snapshots of the 4th quarter; 401909286, 17 snapshots). Their last snapshots hold the full games (513 and 463 plays). Also `nba-every-play-401909890.json` (515 plays, with wallclocks).
- **Football, soccer, baseball:** fixtures only. The weekend's live recordings exist only as pre-game scoreboards so far, so **arrival lag for those sports is unmeasured**. Re-run §3's scripts (§9.5) on the weekend's recordings before tuning D and the lead-ins.

### 3.1 Basketball (ESPN `summary` / core plays)

**Fields** (per play):

| Field | Coverage | Notes |
|---|---|---|
| `coordinate {x, y}` | **Shots 100%** (346/346); fouls 93%; turnovers 85%; rebounds carry the miss's coordinate (201/203) | Half-court feet: x 0–50 across, y out from the baseline (−4…55). Sentinel −214748340 when absent. Already mapped by `Hoops.court`. |
| `participants[]` | 91% of plays | athlete IDs only (no role) in the summary; [shooter, assister] on assisted makes, [shooter, blocker] on blocks, [loser, stealer] on steals, [in, out] on substitutions. Team rebounds have none (17 of 48 offensive rebounds: dead-ball team rebounds after a missed first free throw). |
| `type {id, text}` | 100% | 60+ kinds; the move lives here ("Step Back Jump Shot", "Cutting Layup Shot", "Driving Floating Jump Shot"). |
| `text` | 100% | Distance ("26-foot") on 77% of shots; assister, blocker and stealer names. |
| `clock`, `period` | 100% | Whole seconds above 1:00, tenths below. |
| `wallclock` | 100% | **1 s resolution.** See the timing table below. |
| `sequenceNumber` | 100% | The true order. Gaps where plays were deleted. |
| `scoringPlay`, `scoreValue`, scores | 100% | Score after the play. |

**Timing:**

| Measure | Value |
|---|---|
| Consecutive plays sharing a wallclock | 36–41% |
| Miss → rebound wallclock difference | **0 s in 203 of 203** (same second, same coordinate) |
| Wallclock going backwards | 7–11 per game. Every case is a dead-ball cluster: FT ↔ substitution ↔ timeout ↔ review, all at one game clock. |
| Substitution wallclock | Stamped at the stoppage's **start**; first seen **90–228 s** after it (backdated). |
| Gap between consecutive non-substitution plays, wallclock | p50 7–8 s, p90 31–32 s |
| Gap between plays, game clock | p50 5 s, p90 18–19 s |
| Real time ÷ game time | 2.95–3.28 |
| Made FG → next play, game clock | p50 14–15 s |
| Defensive rebound or steal → next shot by that team, game clock | p50 9–10 s; 35% within 7 s (transition) |
| Offensive rebound → putback (same team, ≤ 4 game-s) | 18 of 59 offensive rebounds by players; 2–5 s wallclock |
| Free throw → free throw, wallclock | Either the same second (batched) or ~14–16 s apart (the real routine) |

**Arrival** (4th quarter of 401909285, plays first seen live; small sample, re-run on the weekend's recordings):

| Kind | Lag (first seen − wallclock) |
|---|---|
| Shots | p50 31 s, p90 47 s, max 51 s |
| Rebounds | p50 30 s |
| Fouls | p50 71 s |
| Free throws | p50 49 s |
| Substitutions | 50–228 s (backdated) |

- Miss and rebound arrived in the **same snapshot 15 of 16 times**.
- A shooting foul is first seen 50–75 s after its wallclock, around the time its first free throw is actually shot. The free throw itself arrives 22–89 s after the foul does.

**Lookahead coverage vs D.** This is the share of plays that are "late", i.e. that arrive after `anchor − 1.5 s`. "Linked" means the next play, when it happens within 10 s of the current one, is known by the current one's lead-in.

| D | Shots late | Rebounds late | Fouls late | Free throws late | Linked next play known |
|---|---|---|---|---|---|
| 30 s | 14/22 | 9/16 | 5/5 | 6/7 | 8/25 |
| 40 s | 7/22 | 4/16 | 5/5 | 6/7 | 15/25 |
| 45 s | 4/22 | 3/16 | 5/5 | 5/7 | 19/25 |
| 50 s | 2/22 | 3/16 | 4/5 | 5/7 | 20/25 |
| 60 s | 0/22 | 2/16 | 3/5 | 2/7 | 23/25 |

**Revisions.**
- 24 revisions in 976 plays changed `type`/`text` ("misses shot" → "misses 26-foot three point step back jumpshot", 10–174 s later).
- **The coordinate never changed.**
- 2 plays were removed after 124 s: an alley-oop miss and its rebound.

**Chains.** Possessions segmented from three full games (599 possession chunks):
- 70% are one event: a lone shot 58%, a turnover 12%.
- 30% chain:
  - shot → offensive rebound → shot: 6.7%;
  - foul → FT → FT: 4.5%;
  - foul → shot: 3.8%;
  - shot → offensive rebound → turnover: 2.3%;
  - two offensive rebounds and three shots: 2.0%;
  - and longer.
- Possessions end by: made FG 40%, defensive rebound 34%, turnover 17%, made last free throw 8%.
- **Every possession links to the next** (inbound, outlet, break), and the feed logs none of those links.

**Shot mix:**
- Zones: above-the-break three 29%, rim (< 4 ft) 22%, paint and short 22%, mid-range 14%, corner three 12%.
- Assisted makes: 67–73%.
- Moves (541 shots): plain "Jump Shot" 34%, pull-up 13%, driving layup 8%, step-back 7%, driving floater 6%, then running layup, fadeaway, putback, cutting layup, turnaround, tip and the rest.

**What's missing and must be inferred.** Every pass except the assist's existence, and the assist's origin; dribbles; inbounds; outlets; matchups; screens; help defense; box-outs; where the rebound was actually taken (ESPN logs the miss's spot); the timing of a rebound within its second; which basket a team attacks (ESPN folds coordinates onto one half court: keep `HoopsEnds` and the flip).

### 3.2 Football (fixtures: MNF DAL@PHI, SF@ATL, TA&M@ALA, AKR@KENT; 842 snaps)

**Fields.**
- `start` and `end {down, distance, yardLine, yardsToEndzone, team}` are on **100%** of snaps.
- **Next play's start = previous play's end** in all but 2 of ~506 consecutive pairs.
- Participants with roles on 99% of snaps: passer, receiver, rusher, tackler, assistedBy, sackedBy, kicker, returner, penalized, recoverer, forcedBy…
- Also: `statYardage`, `yardsAfterCatch` (16%), `penalty{yards, type, status}`, `pointAfterAttempt`, `review`, `drive.$ref`, `clock.value`.

**Text cues:**
- direction and depth ("short right"): 43%;
- run gap: 37%;
- tackler: 70%;
- Shotgun: 62%;
- **"No Huddle": 28%, read by nothing today**;
- kick yards: 10%;
- college `(mm:ss)` clock prefix on every college snap.

**Timing:**

| Measure | NFL | College |
|---|---|---|
| Wallclock | Monotonic along sequence | Logging time: batched, non-monotonic |
| Snap → snap within a drive | p50 42 s, p90 69–90 s | — |
| Across drive boundaries | p50 184–205 s | p50 76–127 s |
| Game clock between snaps | Bimodal: p25 6–7 s (stopped), p75 39–42 s (running) | — |

Real stoppages (NFL):

| Stoppage | Duration |
|---|---|
| TV timeout | p50 ~158 s |
| Team timeout | ~52 s |
| Two-minute warning | ~166 s |
| Quarter break | 202–319 s |
| Halftime | 834–885 s |

**Chains.**
- The PAT is **embedded in the TD entry** in every case.
- NFL: score → Official Timeout → kickoff in 14 of 19 scores.
- Penalty "No Play" entries: 6–9% of snaps.
- **Unknown:** whether NFL `wallclock` marks the snap or the dead ball. Measure against the weekend's recordings and a TV broadcast: the gap between consecutive wallclocks versus the game-clock drop says which. **Unmeasured:** arrival lag.

**Missing and to infer.** Unnamed men (2–5 credited per snap out of 22); routes beyond the target's direction and depth; blocking; the huddle, the break, the walk-up, motion and the snap count; the PAT unit; the kickoff after a score.

### 3.3 Soccer (core plays, Villa v City: 1379 entries over 96 minutes)

**Fields.**
- **`fieldPositionX/Y` on 97.1%** and `fieldPosition2X/Y` (pass ends, shot targets) on 934 entries. Coordinates run 0–100 in the *acting team's* frame.
- Named athletes on 98.9%, with roles: passer, shooter, scorer, assister, fouler, fouled, carded, subbed-in, subbed-out, thrower, kicker.
- `goalPositionY/Z`, `expectedGoals`, `contactType`, `shotInfo`, `targetZone`.
- `addedClock`, **ignored today**.
- `possessionId` only on goals' chains.

**Timing:**
- **`wallclock` = period start + `clock` + `addedClock`** within ±1 s for 1376 of 1379 entries. That is true elapsed time at 1 s resolution: a valid event time.
- 14.4 entries per minute.
- Gap p50 2 s, p90 8 s, p99 36 s. Every gap of 20 s or more is a dead ball.
- 10.5% of entries share a second (at most 3 per second).
- List order is monotonic. IDs are not. Substitutions are inserted 18–63 s behind.

**Coverage.**
- 65% of match seconds are within 3 s of a located entry, and 77% within 6 s.
- From one entry's end to the next's start the ball moves p50 3.3 m; 19% move more than 10 m.

**Chains:**

| Chain | Measured |
|---|---|
| Shot on target → save | 6/6, ≤ 1 s |
| Out → throw-in | p50 15 s, 3 m from the out spot |
| Out → goal kick | p50 20 s |
| Foul → free kick | 30/38; p50 20 s, ~5 m from the foul |
| Card after the same man's foul | 7/8, 2–9 s |
| Corner → delivery | 13–38 s |
| Goal → restart pass at the centre | 42–87 s; **no kickoff entry** (0/3) |
| Subs logged as pairs in one second | 4/8 |

**Arrival lag: unmeasured.**

**Missing and to infer.**
- About 20 of 22 men's positions at all times.
- Receivers. The next same-team entry's actor is the receiver: pass end → next start is p50 2.4 m.
- Kickoffs after goals.
- Restart set-ups.
- Off-ball shape.

### 3.4 Baseball (World Series games 3–5; statsapi + ESPN)

**Fields.**
- **Pitches:** Statcast 9-parameter kinematics on 100% of pitches (916/916), plus `pX/pZ`, zone top and bottom, `pfx`, spin, type, speed and exact call codes.
- **Balls in play:** **hitData on 100%** (launch speed and angle, distance, `coordX/coordY`, location).
- **Runners:** `runners[].movement{start, end, outBase, isOut, outNumber}` with `credits[]` (fielder position and putout or assist) give the fielding chain and runner legs.
- **Non-pitch events:** pickoffs, step-offs, mound visits, pitching changes, substitutions, ABS challenges, batter timeouts.
- **statsapi `playEvents[].startTime`** at millisecond resolution.
- Not yet requested by `Statcast.fields` and unverified here: `endTime`, `linescore.offense` (on deck, in the hole).
- ESPN adds entry order, base occupancy per pitch, spray spot, trajectory class and the zone chart.

**Timing:**

| Measure | Value |
|---|---|
| Pitch → pitch (MLB `startTime`) | p50 19.9 s, p90 31 s |
| Plate appearance → plate appearance | p50 39 s |
| Half-inning change | p50 196 s |
| Mound visit → next pitch | ~73 s |
| Pitching change → next pitch | ~147 s |
| ESPN wallclock vs MLB `startTime`, same pitch | p50 +1.1 s; **25% are 8–20 s late** |

**Chains:**
- Pitches per plate appearance: mean 3.6–4.0.
- Ball in play: 70–75% of plate appearances.
- Fielding chain of 2+ fielders: 25–33% of balls in play.
- Non-batter runner advances: none in 82–88% of plate appearances.
- Steals are logged about 15 s after their pitch.

**Missing and to infer.** Fielder positioning (no tracking: shade by bat side), intra-play timing of throws and tags (from physics and Statcast sprint speeds), the on-deck walk, the return throw, runners returning to the bag, the inning's jog off and on.

### 3.5 The data laws the engine is built on

1. **Event times are coarse and clustered.** Wallclocks are 1 s, tie often, and in dead-ball clusters are logging artifacts. Anchors must be *solved*, not read (§5.1). Soccer is the exception: wallclock is true elapsed time.
2. **Coordinates are the most stable field.** They never changed in an NBA revision; type and text often do. Plan from coordinates, refine from type.
3. **Live-ball plays arrive in 20–50 s; dead-ball admin arrives in 50–230 s.** Size D on the live-ball kinds, and let dead-ball kinds attach late to a stoppage already on screen. A kind-blind q95 would add a minute of delay for nothing. *For BROADCAST:* compute `D*` from shots, rebounds, turnovers, snaps, located soccer entries and pitches, not from substitutions, fouls, timeouts or reviews.
4. **Linked events arrive together.** A miss and its rebound share a snapshot 15 of 16 times, so chains can be planned whole.
5. **Most of what's on screen is inferred.** In the NBA, every pass but the last is unlogged. In football, 17–20 of 22 men are uncredited. In soccer, 20 of 22 men are unplaced. In baseball, nothing logs fielder positions. The craft is in making inference *consistent* (one evolving state) and *honest* (no names, no decisive actions).
6. **Real durations are long and known.** Dead time dominates every sport: 3× game time in the NBA, a 42 s snap cycle, 20 s between pitches, and soccer stoppages of 20–105 s. With p anchored, the engine knows exactly how long each stoppage lasts. That is the difference between a looping idle and a believable one.
7. **The previous play's end is the next play's start.** Football start/end spots match 99.6% of the time; soccer's pass ends land p50 2.4 m from the next entry's start; basketball rebounds sit at the miss's spot. This is the spine of continuity, and the data hands it to us.

---

## 4. Architecture: Plan → Bake → Sample

### 4.1 The choice, and the two we rejected

| Approach | Why not, or why |
|---|---|
| **Better clips.** Keep one script per play, bridge every hand-off. | This is BROADCAST's Phase A, and it is worth shipping as a stepping stone (§12, Phase 0). It can't reach the bar. A clip has no idea of the 10 s before it or after it, so possessions stay chopped into unrelated stagings, a set is re-invented per play, and dense stretches still need dropping or crossfading. |
| **Agent simulation.** Steering agents with behavior trees, a "game AI". | Agents can't be made to hit an anchor within 0.25 s with the right man at ESPN's spot without fighting their own controllers. Small changes in input produce different games, so a correction becomes a visible divergence. Agents cost CPU every frame, which a menu bar app can't afford. They aren't bit-portable to TypeScript either, because chaotic integration amplifies libm differences. |
| **Keyframe-constrained synthesis, baked.** *Chosen.* | Known events are hard keyframes; tactics produce soft keyframes; closed-form trajectories connect them within physical limits; everything is baked once per plan and sampled per frame. It is deterministic and portable (closed forms, contractive filters only). It's exact at anchors and nearly free per frame. Animation tooling calls this "constraint-based motion synthesis". Sports-game engines use it for replays and cinematics because it can be art-directed and still obey data. |

### 4.2 Data flow

```
 ESPN / statsapi lanes ──▶ GameTimeline (BROADCAST §1) ──watermark, plays, revisions──┐
 Fast lane hints ─────────▶ (clock running/stopped, score)                             │
 Rosters / box score ─────▶ Roster                                                     │
                                                                                       ▼
                           ┌──────────────── TheaterEngine<Sport> (pure, nonisolated) ─────────────────┐
 PresentationClock (p) ──▶ │ 1 AnchorSolver   plays → anchors on p (monotone, physics gaps)            │
                           │ 2 Sequencer      plays+anchors → Sequences of Beats (known/inferred)      │
                           │ 3 CastTracker    who is on the field, roles, identities                   │
                           │ 4 Choreographer  WorldState(c) + sequences → Plan (keyframes, cues)       │
                           │ 5 Motion         Plan → BakedPlan (tracks, rig, ball, camera, tiers)      │
                           └──────────────────────────────────────┬───────────────────────────────────┘
                                                                  │ PlanChain (spliced plans)
            TheaterDirector (@MainActor final class, event-driven) ┘  observed only when a plan changes
                                                                  ▼
            TheaterView: TimelineView(tier schedule) → p = clock.p(at: date) → chain.sample(p, into: scratch) → Canvas
```

Responsibilities:
- **Engine** stages are pure functions of their inputs and a seed. They have no SwiftUI, no `Date()` and no globals. Each is `nonisolated` and its types are `Sendable` values, so the identical code can run off-main and be ported line for line to TypeScript.
- **Director** is the only stateful object. It holds the `PlanChain`, decides when to re-plan, launches baking, and publishes a new chain.
- **View** reads p and samples.

### 4.3 Invariants and how each is enforced

| Invariant | Enforced by | Metric (§9) |
|---|---|---|
| One world, no hard cuts | Splice from the sampled state; no per-play view identity (`.id`) or transitions; declared jumps go through one API, `Director.jump(reason:)` | `hardCuts == 0`, `teleportMax` |
| Physical plausibility | Motion limits per sport and role; retiming before overspeed; collision pass | speed, accel and turn violations; `footSlip` |
| Anchors honored | Choreographer plans backward from anchors; motion treats them as hard keyframes | `decisiveError` p95, max |
| Nothing decisive invented | Ambient generators have a closed vocabulary (§5.4.4) with no decisive actions | static check + bench audit of the cue log |
| Honest provenance | `Provenance` on every beat; tags read only known beats | `inferredShare`, tag audit |
| Performance | Precompute per plan; tiers; zero allocation in sampling; no work off-screen | CPU per frame, allocations per frame |

### 4.4 Layers in one paragraph each

1. **AnchorSolver (§5.1).** Places each known event's decisive moment on p. Wallclocks are 1 s resolution and tie (a miss and its rebound share one wallclock in 203 of 203 cases, *measured*). Dead-ball clusters carry backdated wallclocks (substitutions stamped at the stoppage's start and logged up to 228 s later). So anchors come from a monotone least-squares fit with physics minimum gaps, using game-clock deltas inside running-clock stretches.
2. **Sequencer (§5.2).** Groups plays into sequences and adds inferred beats with explicit rules, marked as inferred.
3. **CastTracker (§5.3).** Knows who is on the field, from starters plus substitutions, checked against participants. A figure is one athlete for as long as he plays.
4. **Choreographer (§5.4).** Turns sequences into keyframes:
   - formations by situation;
   - backward planning from the decisive moment through a data-chosen tactical template;
   - ambient fill;
   - defense as a function of offense;
   - compression and merging when beats are dense;
   - connective beats between sequences.
5. **Motion (§5.5).** Bakes C² tracks within limits, then runs the collision pass, the ball segments and the rig.
6. **Direction (§5.6).** Runs the camera as one continuous operator (framing, lead room, push-ins, yaw orbit) plus replays in dead time, stamps, banners, tags, celebrations, frame tiers and honesty marks.

### 4.5 Receding-horizon planning and the splice

At any p the director holds a **PlanChain**: plans `P0, P1, …, Pk` with splice times `s1 < s2 < … < sk`. Plan `Pi` is valid on `[si, s(i+1))`, and `Pk` is valid until its horizon. Sampling finds the plan covering p (a cached index, binary search on a miss).

**When to re-plan.** Re-plan on any of:
- (a) a new, revised or removed play with an anchor ≥ the commit point;
- (b) a watermark advance that completes a sequence (for example, a rebound arriving after its miss);
- (c) a fast-lane hint change: the clock stopped or started, or the score changed with no play to explain it;
- (d) a clock regime change: stall, catch-up or jump (BROADCAST);
- (e) the viewer turning the court;
- (f) visibility, which bakes on demand (§8.4).

The director **never re-plans on a timer**.

**The commit point.** `c = max(p_now + 0.25 s, end of anything in flight that the new data doesn't contradict)`. "In flight" means:
- a pass or shot in the air;
- a jump between takeoff and landing;
- a foot mid-swing, which RigTrack handles;
- a camera cut, which never happens outside a declared jump.

The 0.25 s gives the bake time to run off-main. If the bake isn't back by `c`, the director re-requests with a new `c` when it is. Meanwhile the current plan's speculative tail keeps playing; it is always valid (§5.4.4).

**The splice.** It builds `WorldState(c)` from the current plan:
- each actor's position, velocity, acceleration, heading, gait phase, current and next planted steps, pose blend and current action;
- the ball's state, including in-flight parameters;
- the camera's state and velocity (pan, zoom, yaw);
- live cues (banner up, stamp up, tag text and age).

The new plan must reproduce `WorldState(c)` exactly at `c`, which is a hard keyframe for every actor with velocity and acceleration. **This is the whole continuity guarantee**, the same rule as Apple's: animate from the presentation value, carrying velocity, and retarget.

**Stability.** Seeds derive from stable IDs (game, sequence's first play, role), never from a plan revision. So re-planning with no new information reproduces the same future. Re-planning with new information changes only what the information touches, plus what must reconnect to it.

### 4.6 Data dynamics: early, late, revised, removed

| Case | What the engine does |
|---|---|
| **Known well before its lead-in** (the normal case, given D) | Planned backward from its anchor. The ambient before it is shaped so the actors are already near their marks. |
| **Arrives during its lead-in** (later than `anchor − leadIn`) | Re-plan from `c` with the lead-in **compressed** to what's left. Speed limits hold; if they can't, see the next row. |
| **Arrives too late for the lead-in** (less than the minimum lead-in left) | **Declared micro catch-up.** The decisive moment slips by up to 1.5 s (*tune*) and is logged as `catchUp`. The status tag shows nothing for slips under 1.5 s; the BROADCAST clock's slew absorbs the drift over the next 10–20 s. |
| **Arrives after its anchor + 1.5 s** | If it is a **dead-ball kind** (foul, substitution, timeout, review; these are routinely 50–230 s late, *measured* §3.1), it was never needed on time. It attaches to the stoppage already on screen (a "WHISTLE" becomes "SHOOTING FOUL · GRIMES"; subs walk on before the restart). If it is a **live-ball kind** (shot, rebound, turnover), it is told immediately as a compressed beat with "CATCHING UP", and the next sequence starts from its result. Score and possession follow the play when it is told (BROADCAST: the presented score derives from plays). |
| **Revised before it's told** | Re-plan. Coordinates were stable in every revision recorded, while type and text changed in 24 (*measured*), so templates key on the coordinate first and refine by move. |
| **Revised after it's told** | Quiet correction: tags and stamp text update in place; no re-animation (BROADCAST). |
| **Removed before it's told** | Re-plan without it. |
| **Removed after it's told** | No rewind. If score or possession diverges, BROADCAST's quiet correction applies, and the next dead ball reconciles the world: the ball goes to the right team at the restart. Logged. |

### 4.7 The craft principles, and where each one binds

| Principle (source) | Where it decides the design |
|---|---|
| Animate from the presentation value; carry velocity through a retarget; never lock out new input (Apple, *Designing Fluid Interfaces*) | The splice (§4.5): every replan starts from `WorldState(c)` with velocities. The camera spring keeps its velocity across goals (§5.6.1). |
| Critically damped springs by default; bounce only when momentum was thrown (Apple) | Camera pan, zoom and yaw are all damping 1.0 (§5.6.1). The defense tracker is critically damped (§5.4.5). |
| Spatial consistency: things leave the way they came, anchored to their source (Apple) | Substitutes walk on and off at the scorer's table; relievers come from the bullpen gate; batters walk from on deck and back to the dugout. No fades at arbitrary spots (§7). |
| Ease-out for entrances, ease-in-out for on-screen movement, never ease-in (Emil Kowalski) | Opening and waking fade in on `Motion.curve` (ease-out). The flip orbit and the hand-off travel use `cubic-bezier(0.77, 0, 0.175, 1)` (§6). |
| Blur masks an imperfect crossfade (Emil Kowalski) | The instant-replay stinger carries a 2 px blur (§5.6.4). It's the only crossfade in normal operation. |
| Reduced motion means gentler, not none; crossfades replace travel (Apple, Emil Kowalski) | Key-state mode: the same clock, crossfades between decisive states, no camera travel, no replays (§6). |
| Cause and feedback on the same frame (Apple, audio-haptic design) | Celebrations, stamps and the score change fire on the decisive frame (§5.6.5). |
| Every view is an invalidation boundary; no heavy work in `body`; observe narrowly (SwiftUI performance) | The director publishes only `chain`. Baking runs off-main. The court layer is `Equatable` on the quantized camera. Frames compare a plan revision, never scripts (§5.7, §8.3). |
| Value types, closed enums, `Sendable`, `nonisolated` library code (Swift) | The engine's contracts (§10). `AmbientAction` makes invented decisive events unrepresentable (§5.4.4). |

---

## 5. The layers

### 5.1 AnchorSolver: event times to decisive moments on p

**Why it's needed (*measured*, NBA, three full games):**
- `wallclock` is ISO-8601 to the second.
- 36–41% of consecutive plays share a wallclock.
- A miss and its rebound share one in **203 of 203** cases.
- Wallclock goes **backwards** 7–11 times a game. Every case is a dead-ball cluster at one game clock (free throws, substitutions, timeouts, reviews), where substitutions carry the stoppage's start time.

The game clock reads whole seconds above 1:00 and tenths below. So neither field alone places a rebound 1.6 s after a miss, or a putback 2.8 s after a rebound.

**Input.** The timeline's plays for the current period, in the timeline's order. For ESPN NBA that is `sequenceNumber` order within a period, never re-sorted by wallclock. Each play carries:
- `w`: wallclock or statsapi time;
- `g`: game-clock elapsed;
- kind;
- links from the sequencer's first pass (miss → rebound, foul → free throws…).

**Output.** `τ` for each play: its decisive moment on the event-time axis. p presents event time 1:1, so `τ` is the anchor.

**Algorithm** (O(n), deterministic, pure arithmetic, so it ports exactly):

1. **Stretches.** Split the period into *running-clock stretches*: maximal runs of plays where g strictly increases between consecutive live-ball plays and no clock-stopping kind intervenes. Each sport has its own stopping table (§7). Basketball's: fouls, violations, out-of-bounds and dead-ball turnovers, timeouts, made FGs in the last 2:00 of the 4th or OT, period ends, free throws.
2. **Targets.**
   - Inside a stretch, the target is `t_i = a + g_i`, where `a = median(w_j − g_j)` over the stretch's live-ball plays. This uses the game clock's relative timing and the wallclocks' absolute placement, and absorbs the 1 s quantization.
   - Outside stretches (dead-ball clusters), the target is `t_i = w_i` for clock-stopping events.
   - Events with unreliable wallclocks (substitutions, admin, timeouts after the first event of a cluster) get weight 0. Their targets are interpolated, and they are placed in the cluster's window by the sequencer's ordering rules.
3. **Minimum gaps.** `m_i` between consecutive anchors comes from each sport's physics table. Basketball:
   - miss → rebound: `max(1.0, 0.75 + flight(distance) + 0.35)`, with `flight` from the shot model (a three is about 1.2 s);
   - rebound → putback: ≥ 0.6;
   - offensive rebound → kick-out shot: ≥ 1.6;
   - free throw → free throw: ≥ 6.0;
   - made FG → the other team's first live event: ≥ 2.5;
   - otherwise ≥ 0.15 (no two decisive moments in one instant).
4. **Solve.** Minimize `Σ ω_i (τ_i − t_i)²` subject to `τ_{i+1} − τ_i ≥ m_i`. Substitute `u_i = τ_i − M_i`, where `M_i = Σ_{k<i} m_k`. The constraints become `u_{i+1} ≥ u_i`, which is weighted isotonic regression of `t_i − M_i`. Solve it with **pool-adjacent-violators**, then `τ_i = u_i + M_i`. Weight-0 events are skipped in the fit and then placed at the midpoint of their feasible interval.
5. **Incremental.** Anchors at or before the commit point are frozen. The solve runs on the suffix with a boundary constraint `τ_first ≥ τ_frozen + m`. A revision whose new time would move a frozen anchor is ignored for timing (the BROADCAST rule: told plays don't re-animate).
6. **Windows for inferred beats.** Inferred beats get windows, not anchors. An assisted catch-and-shoot's final pass is caught in `[τ_release − 0.9, τ_release − 0.45]`. The choreographer chooses the time within the window.

**Decisive moment per kind** (the instant the anchor denotes):

| Sport | Decisive moment |
|---|---|
| Basketball | Make: ball through the rim. Miss: rim or backboard contact (an airball: its landing). Block: hand on ball. Rebound: secured in two hands. Steal: the touch. Foul or violation: whistle. Free throw: rim. |
| Football | Ball spotted dead (tackle, out of bounds, touchdown crossing, incompletion hitting the turf). The snap is a second, inferred anchor at `τ_dead − playLength(kind, yards)` (§7.2). |
| Soccer | The event's touch: shot struck, pass struck or received, tackle, foul contact, ball crossing the line for a goal, a card shown, a save. |
| Baseball | Pitch crossing the plate (each pitch's `endTime`, or `startTime` + flight); contact for balls in play; each out's putout or tag; each runner's touch of his destination base. |

### 5.2 Sequencer: plays to sequences of beats

**Output.** A `SequenceWindow`: the sequences intersecting `[c, horizon]`, each an ordered list of beats with causal links, an outcome and a phase graph. It is a pure function of (plays up to the watermark, anchors, roster, fast-lane hints, the previous window's frozen prefix).

**Rules.** Each sport supplies a rule table (§7) with three kinds of rule:

1. **Grouping.** These say where sequences begin and end. Basketball: possessions end on a made FG (unless and-one), a defensive rebound, a turnover, the last free throw made, a period end, or a jump ball won by the other team.
2. **Linking.** These form causal edges: assist → shot, miss → rebound, rebound → putback, foul → free throws, steal → break, timeout → restart, and so on. The basketball parser's links (`leadIn`, `follows`, `missBefore`, `stealBefore`, `reboundAfter`, `andOneFouler`, `freeThrows(after:)`) move here; they become sport-agnostic edges.
3. **Inference.** Each rule says "given these known beats, add beat X with window W and provenance `.inferred(rule, from: [ids])`". Inferred beats are *structural*: they must happen for the known beats to make sense (the inbound after a make, the pass before an assisted shot, the return of runners to their bags). Ambient beats are not produced here; the choreographer fills them (§5.4.4).

**Phases.** Every sequence carries a phase graph: for basketball, `inbound → advance → set → action → finish → (rebound | aftermath)`, or `transition → finish`, or `deadBall → freeThrows → …`. The choreographer realizes the phases. The status tag reads the current phase ("SPURS BALL", "FREE THROWS · SPURS").

**Unknown future.** The last sequence is usually open: its outcome isn't known yet. The sequencer marks it `.open(phase:)`. The choreographer then plays its ambient phase, and re-plans when the outcome arrives (measured coverage at D = 45 s: 18 of 22 shots and 19 of 25 tightly linked next plays are known by their lead-in, §3.1).

**Fast-lane hints.** If the fast lane says the clock stopped at game time `g*` and no play yet explains it, the sequencer adds an inferred `.stoppage(at: g*)`. Its anchor is placed with the running-clock map. That ends the open sequence's ambient with a halt and, in basketball, an official's whistle (no call words). The real play attaches later (§4.6). This is the broadcast pattern: the whistle, then the graphic.

### 5.3 CastTracker: who is on the field

Today every script creates its figures fresh, and credits are pinned to whichever figure plays the part (`credits`, `BasketballScript.swift:299`). The engine keeps **persistent identities**:

- **Basketball.**
  - Starters come from the box score (`starter`), positions from the roster: G, F and C map to the existing `Role` guard, wing and big.
  - Each `Substitution` play swaps an athlete in and out at its stoppage.
  - **Validation:** a participant who isn't on the floor is swapped in for the teammate of the same role least recently credited, as an inferred substitution, logged.
  - Period starts re-validate against the first plays.
- **Football.** Personnel by unit (offense, defense, special teams) from depth charts (`nfl-depthcharts.json`) and participants; positions from roles in participants. Football has no substitution plays, so identities are per play for non-credited men. The QB and the credited men are stable across a drive.
- **Soccer.** Lineups and formation from the rosters (`names-soccer-…-rosters.json`); substitutions from events; positions from formation slots.
- **Baseball.** Batting order and the defensive alignment from statsapi (`liveData.boxscore`, `defense`/`offense` in each play's `matchup`); pitching changes from events; runners from `runners[].movement`.

Every actor has an `ActorID` stable for the session. Its `athlete` may be `nil` for synthesized men (football's unnamed linemen). The bridge's `match` cost (athlete, then kind, then distance, then untangle) remains the fallback for anonymous actors when a formation changes (football personnel changes).

### 5.4 Choreographer: sequences to keyframes

#### 5.4.1 The plan's skeleton

For each sequence in the window, in order, the choreographer lays out phase intervals on p:

```
[ connective ][ set-up / advance ][ ambient … ][ action clip → DECISIVE ][ aftermath ]→ next sequence
```

- **The action clip** is a parametric template (§7) chosen by the data: move, assist, distance, zone, roles. It has a duration `T_clip` (basketball 1.6–4.0 s), clip-start constraints (who holds the ball, where the clip's actors must be) and keyframes up to and just after the decisive moment.
- **The set-up or advance phase** realizes the sequence's opening: an inbound after a make, an outlet, a break, a huddle and line-up, a throw-in, a pitcher's set.
- **Ambient** fills the rest, shaped *backward* so the clip-start constraints are met when the clip begins (§5.4.3).
- **Aftermath** is the decisive moment's consequences (rebound battle, the shooter backpedaling, a celebration, a tackle's pile getting up). It *is* the connective beat into the next sequence: the next sequence's set-up begins from the aftermath's state.

#### 5.4.2 Template selection, data first

Selection is a deterministic decision table (§7). It reads only known data and stable seeds. Ties break with `SplitMix64(seed(gameID, sequenceID, "template"))`.

Variation must come from the data, never from noise alone:
- shot spot and zone;
- shooter and passer roles;
- the shooter's other shots tonight (the timeline knows every one);
- the assist (yes or no, and who);
- the distance;
- possession origin (after a make, a defensive rebound, a steal);
- game time (end of quarter, late clock);
- score margin.

Seeded noise only chooses among equally data-consistent options.

#### 5.4.3 Backward planning (the heart of it)

Given clip-start constraints `C` at time `t_c = τ − T_clip`, and the world at the sequence's set-up end `t_s`:

1. **Feasibility.** For each constrained actor, the time needed to reach his mark is `need = d / v_jog(role)`, with `v_jog` from §5.5.2. If `need > t_c − t_s`, shorten the clip toward its minimum, then the set-up toward its minimum, then mark a `catchUp` (§4.6).
2. **Ball path.** Choose a chain of ambient ball moves (passes, dribble hand-offs, dribbles) from the current holder to the clip's initial holder. Prefer the shortest chain consistent with the template ("swing it to the wing, then the entry"). Each link takes 1.2–2.8 s (*tune*, seeded). Over a long ambient, insert reversals (2–3 passes) to fill time without repeating the same pass within 6 s.
3. **Off-ball spots.** Every off-ball actor holds a slot of the chosen formation, and slots shift with the ball (a "strong side"/"weak side" shift on each reversal). In the last ambient link, the clip's actors leave their slots for their clip-start marks, arriving 0.2–0.4 s before `t_c`, so they are set, not skidding in.
4. **Life without noise.** Every 4–6 s of ambient (*tune*) add one tactical micro-action with no decisive content: a screen-away, a cut-through, a relocation, a dribble probe. Each is chosen from the formation's list, seeded, and never repeats twice in a row.
5. **Defense** is a function of offense and ball (§5.4.5).

#### 5.4.4 Ambient vocabulary: closed, and decisive-free

Ambient is allowed to: dribble; pass within a team (basketball, soccer); move off the ball; screen without contact outcome; reposition in formation; walk, jog and stretch in dead balls; and for the officials, the gestures of a call already known.

Ambient is **never** allowed to:
- shoot;
- score;
- turn the ball over;
- foul or whistle without a cause (a known play or a fast-lane stop);
- tackle;
- rebound;
- substitute;
- call a timeout;
- change possession;
- throw a pitch, or move a runner.

This vocabulary is enforced by type: ambient generators return `AmbientAction`, an enum with no decisive cases.

**Holding pattern** (stall, or an open sequence longer than the known future):
- Ambient is generated in 6 s chunks on demand.
- Each chunk returns to a neutral configuration (basketball: the ball at the top, 5-out), so the plan can be extended indefinitely without drifting.
- After 20 s of holding in one sequence (*tune*) the intensity eases: fewer cuts, more ball-holding.
- If the fast lane says the clock stopped, the stoppage choreography takes over (§5.2).

#### 5.4.5 Defense, as a function

Defenders aren't keyframed by hand. Their **target** at each 1/60 s is a function of offense and ball:
- `guardSpot(man, ball, onBall)` (existing, `BasketballScript.swift:546`);
- help shading toward the ball side;
- in-lane help on drives (the nearest weak-side defender moves 40% toward the drive line when the ball is within 12 ft of the rim, *tune*);
- close-outs on catches (sprint toward the shooter, with a `contest` action at release);
- box-outs on shots (turn to the man, back in, hold).

The target is followed by a **critically damped tracker with speed and acceleration caps**: ω = 9 for on-ball, 6 off-ball (*tune*). That makes defense smooth, slightly late (as real defense is), contractive and deterministic. Matchups are assigned once per sequence by the Hungarian method on `distance + 15 ft × roleMismatch` and kept, except at clip-declared switches (pick-and-roll).

The same pattern drives soccer's off-ball shape (targets from ball position and phase) and football's pursuit angles.

#### 5.4.6 Compression and merging

When anchors are dense:
1. Lead-ins shorten to template minimums.
2. Then consecutive beats **merge** into one continuous clip with several decisive moments: miss → tip → miss → tip; offensive rebound → kick-out → three.
3. Order never changes.
4. Each decisive moment stays within ±0.25 s of its anchor. If that's impossible, the solver keeps the later and more important beat exact, the earlier slips (logged), and the AnchorSolver's minimum-gap table is updated from these logs over time.

#### 5.4.7 Connective beats

These beats aren't in the data, yet without them the next sequence starts from nothing. The sequencer infers them; the choreographer realizes them.

- **Basketball:** the inbound after a make (a defender from the team just scored on steps out on the baseline, the guard receives at the free-throw line extended, the ball is brought up 4–7 s); the outlet after a big's rebound; the push after a steal; the walk to the lane for free throws; the walk to the benches at a timeout; the jog back onto the floor.
- **Football:** the pile getting up; the huddle; the break; the walk to the line; the set; the motion; the snap. Then the kickoff after a score, the PAT unit coming on, and the punt team.
- **Soccer:** the restart (throw-in, goal kick, corner, free kick); the kickoff after a goal; the keeper's distribution; the walk back after a stoppage.
- **Baseball:** the catcher's throw back to the pitcher; runners returning to their bags; the next batter's walk-up; the infield's throw-around after an out; the inning change with sides crossing; the mound visit; the pitching change.

The full rule tables are in §7.

### 5.5 Motion: keyframes to baked tracks

#### 5.5.1 Keyframes

Each keyframe is `Key(t, at, kind, v?, a?, window?, radius?, hard)`, where `kind ∈ {.through, .arrive, .depart, .contact}`.
- `.arrive` ends at rest (v = a = 0).
- `.contact` is a screen, box-out, tackle or tag: two actors meet at `t`, and the C² requirement is waived at `t` for both.
- `window` lets the solver slide `t`; `radius` lets it move `at`.
- Hard keys come from the splice state and from anchors. Soft keys come from tactics.

#### 5.5.2 Limits (per sport and role; all *tune*)

| Sport (units) | Walk | Jog | Run | Sprint cap | Overspeed allowance | Peak accel | Peak decel | Lateral accel |
|---|---|---|---|---|---|---|---|---|
| Basketball (ft/s) | 4.5 | 10 | 16 | 25 (guards, wings), 22 (bigs) | +12% for ≤ 0.6 s | 20 ft/s² | 26 ft/s² | 18 ft/s² |
| Football (ft/s) | 4.5 | 10 | 20 | 32 (skill positions), 24 (linemen) | +10% for ≤ 0.8 s | 22 ft/s² | 28 ft/s² | 20 ft/s² |
| Soccer (m/s) | 1.4 | 3.5 | 6.0 | 9.0 (outfield), 7.5 (keeper) | +10% for ≤ 0.8 s | 6.0 m/s² | 7.5 m/s² | 5.5 m/s² |
| Baseball (ft/s) | 4.5 | 10 | 20 | 28 runners (Statcast sprint speed when known, else 27); 27 fielders | none at real pace; all limits scale by the play-pace factor while today's pace is kept (§11.4) | 20 ft/s² | 24 ft/s² | 16 ft/s² |

These are court or field units, which the rig already converts into its own height-relative gait (`RigTrack.height`). They are bench-checked against the figures *as drawn*: `Hoops.ground` is 5.74 ft against the 7 ft drawn height, so speeds read about 20% faster on screen than in court feet. Tune by eye on video and by the bench's percentile report together.

Limits are in p-seconds. The presentation clock may slew up to 1.08× (BROADCAST), which raises on-screen speeds by up to 8%. The caps above already include that margin, so don't add more.

#### 5.5.3 Trajectories

- **Per segment:** a quintic Hermite between consecutive keys, giving C² positions. With `s = (t − t0)/T` and `T = t1 − t0`:
  `x(s) = H0 x0 + H1 T v0 + H2 T² a0 + H3 T² a1 + H4 T v1 + H5 x1`, where
  `H0 = 1 − 10s³ + 15s⁴ − 6s⁵`, `H1 = s − 6s³ + 8s⁴ − 3s⁵`, `H2 = ½s² − 1.5s³ + 1.5s⁴ − ½s⁵`, `H3 = ½s³ − s⁴ + ½s⁵`, `H4 = −4s³ + 7s⁴ − 3s⁵`, `H5 = 10s³ − 15s⁴ + 6s⁵`.
- **Velocities at `.through` keys:** non-uniform Catmull–Rom, `v_j = (T_{j+1}/(T_j+T_{j+1}))·(x_j−x_{j−1})/T_j + (T_j/(T_j+T_{j+1}))·(x_{j+1}−x_j)/T_{j+1}`, clamped to the sprint cap.
- **Accelerations at `.through` keys:** `a_j = 0.5·(v_{j+1} − v_{j−1})/(T_j + T_{j+1})`, clamped to peak accel. Both are 0 at `.arrive` keys. The splice key takes v and a from `WorldState`.
- **Long moves:** a rest-to-rest move longer than 12 ft (basketball), 20 ft (football), 6 m (soccer) or 20 ft (baseball) inserts **cruise keys**. The profile becomes ramp → cruise → ramp, with each quintic ramp ≥ 0.45 s, the way a player actually accelerates to a speed and holds it. A single min-jerk segment is acceleration-bound and reads sluggish: its peak speed is `1.875·d/T` and its peak acceleration `5.77·d/T²`.
- **Corners:** a direction change > 50° at a `.through` key at speed > jog gets a rounding key pair at ±(v·0.18 s) along the incoming and outgoing directions. That gives a real turning radius (`v²/lateralAccel`) instead of a polyline corner. This replaces B9.

#### 5.5.4 Feasibility and retiming (order matters)

Sample each actor at 60 Hz and check speed, tangential acceleration and lateral acceleration against §5.5.2. On a violation in segment `j`, try in order:

1. **Slide a soft key** within its window (closed form for rest-to-rest: `T ≥ max(1.875·d/v_cap, √(5.77·d/a_peak))`).
2. **Move a soft key** within its radius toward the actor's reachable set.
3. **Shorten an ambient link** or drop a micro-action.
4. **Use the overspeed allowance**, logged as `overspeed`.
5. **Escalate to the choreographer.** It can reassign an *anonymous* role to a closer actor (any teammate can be the screener; never the credited shooter), compress the lead-in, or declare a micro catch-up (§4.6).

Never break a hard key.

#### 5.5.5 Collisions

- Sample all actor pairs at 20 Hz. Bodies take a 1.0 ft radius (basketball, football) or 0.35 m (soccer).
- If two actors not in a declared contact overlap for more than 0.1 s, add a lateral detour key to the lower-priority actor at the closest approach, offset by `2.2 × radius` perpendicular to his path. Then re-synthesize him.
- Priority order: ball carrier, then credited actors, then clip actors, then the others.
- At most 3 passes; any residual overlap is logged.
- Declared contacts (screens, box-outs, post-ups, tackles, tags) hold at a minimum separation of `1.2 × radius`.

#### 5.5.6 The rig, across splices

`RigTrack` gains:

```swift
init(samples: TrackSamples, from start: Double, through end: Double, height: Double,
     continuing prior: RigTrack.Carry?, facing: (Double) -> RigFacing?)
struct Carry: Equatable, Sendable { var phase: Double; var heading: Double; var speed: Double
                                    var left: RigTrack.Step; var right: RigTrack.Step }
```

With a `Carry`, integration starts from its phase and heading, and the step lists start from the carried steps, including a foot mid-swing with its `lift` and the carried next landing. The first new landing is computed by the same rule as any other, so the splice adds no slip. The bench's `footSlip` metric (planted foot world displacement while weight > 0.5) must read 0 across splices, as it does inside a script today.

`measureBodies`' facing rules (the ball, the man he passes to, the rim; defenders square to the ball unless sprinting) move to a per-sport `facing` function over the baked plan.

#### 5.5.7 Ball

```swift
enum BallSegment: Equatable, Sendable {
  case held(ActorID, Hand, from: Double, until: Double)
  case dribble(ActorID, from: Double, until: Double, period: Double)        // basketball (2.4 Hz today), soccer touches
  case flight(Flight)                                                       // ballistic: from/to, t0/t1, apex or launch
  case roll(from: FieldPoint, velocity: SIMD2<Double>, decel: Double, t0: Double, t1: Double)  // soccer, loose balls
  case spot(FieldPoint, from: Double, until: Double)                        // dead, placed, held by an official
}
```

Physics per sport:
- **Basketball:** g = 32.2 ft/s²; floor restitution 0.75; rim and board through the existing `Carom`. Passes:
  - chest pass 40 ft/s (32–48 seeded), apex +1 ft;
  - bounce pass 35 ft/s, bouncing at 0.62 of the distance with restitution 0.7;
  - lob apex 13–15 ft;
  - outlet 45 ft/s.
- **Football:** g = 32.2. Spiral passes are launched at 55–70 ft/s with the apex chosen by depth. Punts take 4.0–4.8 s of hang time and kickoffs 3.8–4.3 s (seeded within the data's distance). Bounces are seeded and erratic, for an oblong ball.
- **Soccer:** g = 9.81. Ground passes run at 12–20 m/s and decelerate at 1.2 m/s² (*tune*). Lofted passes and crosses are ballistic with restitution 0.55. Shots run at 22–32 m/s, by distance and by the commentary's "powerful"/"placed" words when present.
- **Baseball:** pitches use Statcast's kinematics exactly (x0, v0, a), and batted balls use launch speed, angle and spray with drag (existing `PlayScript` flights). Throws run at 75–130 ft/s by position, distance and Statcast arm data when present.

A held ball attaches to the hand's joint position from the rig (existing `posed()` logic), so a catch or release blends with the hand: `held` easing 0.12 s in and 0.08 s out (existing constants).

### 5.6 Direction: one broadcast camera, and everything timed to the moment

#### 5.6.1 The camera is one continuous operator

- **State.** `CameraState(x, y, span, yaw)` plus velocities. One simulation for the session, carried across splices (`WorldState.camera`).
- **Spring.** It is integrated per plan at 60 Hz (the existing semi-implicit Euler, which is stable at ω·dt ≈ 0.12).
  - Pan and log-zoom stay **critically damped** at ω = 7 with today's caps: 1.4 view-heights/s pan, −1.1…+2.2 zoom.
  - **Yaw** is critically damped at ω = 3.6 (*tune*), settling to 95% in about 1.3 s, capped at 45°/s.
- **Why critically damped.** A camera is not a thrown object. Apple's guidance is damping 1.0 for anything that isn't carrying the user's momentum: graceful and non-distracting, never overshooting the subject.
- **Retargeting.** A new goal changes the target; the state keeps its velocity. A replan therefore re-targets mid-pan with no seam: the interruptible-animation rule.

#### 5.6.2 The goal function (per frame of the plan, computed at bake)

1. **Subjects:**
   - the ball;
   - its holder;
   - the actors of any decisive beat whose anchor is within the next 2.0 s (shooter, passer, rebounder, receiver, tackler, keeper, the fielder making the play);
   - the target (rim, goal mouth, end zone, base), when the ball is within its sport's framing distance (basketball 32 ft) or a decisive beat aims at it.
2. **Lead room.** Offset the framing center by `0.15 × span` along the ball's velocity, smoothed over 0.3 s, so the frame leads the play. Broadcasters lead the ball; trailing it reads as chasing.
3. **Closest framing by phase** (basketball, ft top to bottom; others in §7):
   - half court 34;
   - transition 42;
   - **decisive push-in 27**: the closest-framing value ramps from the phase value at `τ − 0.8 s` to 27 at `τ`, holds until `τ + 0.8 s`, and releases over 1.0 s;
   - free throws 30;
   - timeout 46;
   - period break 60.
4. **Clearing.** The stamp corner and banner headroom are kept clear (`CameraFrame.clearing`, `CameraRig.headroom`).
5. **Far subjects.** When the subject region moves more than `0.6 × min(heights)` within 0.5 s (a long outlet, a punt, a switch of play, a ball hit to the gap), the goal goes **through a wider two-shot** over 0.9 s instead of sliding: the existing `CameraRig.blend` rule, which stays.

#### 5.6.3 Yaw: the camera follows the ball's end of the floor

This fixes B4. The view's yaw is no longer a property of a script's frame. It is a camera parameter driven by where the ball is, so a change of possession becomes a broadcast pan instead of a 60° snap under a crossfade.

- **Basketball.** The target yaw is −30° when the ball is more than 6 ft beyond half court toward the right basket, +30° toward the left. Inside the ±6 ft band the target holds (hysteresis), with a minimum dwell of 2.0 s between changes. On a long rebound outlet the yaw starts turning as the ball crosses the band and completes while the ball is brought up: about 1.3 s of orbit inside a 4–7 s advance.
- **Football.** Yaw follows the direction of the offense, from the per-game ends, and turns only on a change of possession that reverses direction (§7.2). The orbit runs during the kickoff or punt's flight, never during a down.
- **Soccer.** Yaw follows the ball's third: a slow orbit (ω = 2.4) toward the attacking end, held through the middle third.
- **Baseball.** Yaw is fixed per framing family (behind home plate, the high first-base side). The existing `PlayCamera` families stay, now as continuous camera targets. A family change is a declared cut only where TV cuts (pitch → batted ball in play), and §7.4 decides between cut and orbit.

The **viewer's flip control** becomes a 180° yaw orbit over 0.9 s on the house in-out curve `cubic-bezier(0.77, 0, 0.175, 1)`, never a redraw.

#### 5.6.4 Instant replays: a declared jump, only in dead time

Today every made basket is "a replay" (a fresh staging after the fact). In the new engine the live coverage *is* the play; a replay is a broadcast device used when it costs nothing.

- **Eligible:**
  - basketball: dunk, posterized, and-one, block, buzzer-beater, the go-ahead basket in the last 2:00;
  - football: touchdown, interception, sack-fumble, a 20+ yard catch;
  - soccer: goal, penalty save, a red-card foul;
  - baseball: home run, a play with an out at home, a diving catch (Statcast catch probability under 50%).
- **Timing.** Only inside a dead-ball window on p of at least `replayLength + 1.0 s` with no known decisive beat in it: a timeout, free-throw set-up, the walk back after a touchdown, the goal celebration and kickoff set-up, the home-run trot, the inning change. Never over live action. If a decisive beat becomes known inside the window, the replay ends early through the stinger.
- **Look:**
  - in and out through a 0.35 s stinger: a wipe with a 2 px blur, the "blur masks imperfect transitions" technique;
  - "REPLAY" in the status tag;
  - a **reverse angle** (yaw + 180°) or a tight angle, alternating, seeded;
  - the 2.5 s before the decisive moment at 1×, the 1.8 s around it at 0.5×, then 0.6 s at 1×.
- **What runs underneath.** The live world continues during the replay; it is in a stoppage by construction. The stinger out lands on it with no catch-up.
- **Reduce Motion:** no replays.

#### 5.6.5 Cues timed to the decisive moment

All cues are scheduled on p from the plan:
- the stamp (`+3 3PT · BROWN JR. · 23 FT`);
- banners (DUNK, AND-ONE, REJECTED);
- flashes;
- net and rim motion;
- celebrations;
- the scoring slide trigger (BROADCAST);
- the score change on the hero and the docked bar (BROADCAST: score follows the presented play).

A celebration starts **on the decisive frame**. Apple's multimodal rule: cause and feedback on the same frame.

#### 5.6.6 Tags and honesty

- **Name tags** only on actors credited by known beats (today's rule), now *stable* across sequences.
- **Inferred beats never carry names.** The inferred inbound passer is just a figure.
- **Status tags** come from the current phase ("SPURS BALL", "FREE THROWS · SPURS", "TIMEOUT · JAZZ"):
  - "WHISTLE" for a fast-lane stop not yet explained;
  - "CATCHING UP" only for a declared catch-up longer than 1.5 s;
  - "REPLAY" during replays.
- **The heartbeat** (`TheaterHeartbeat`) can carry the delay ("Live · 41 s behind"). The user decides whether that shows; BROADCAST reports D either way.
- **A developer overlay** (harness and debug builds only) draws provenance rings (white known, amber inferred, gray ambient), anchor ticks and the plan revision. It's the tool for tuning on the bench.

#### 5.6.7 Frame tiers (planned, not reactive)

At bake, the plan computes tier intervals:
- **60 fps:** any actor faster than run speed, the ball in flight, the camera moving faster than 0.15 view-heights/s, or within ±1.5 s of a decisive moment.
- **30 fps:** live play below run speed with the camera nearly still.
- **0 fps:** nothing moves. The existing sparse-beat stillness during stoppages is kept: a still frame with sparse 30 fps beats.

The view switches `TimelineView` schedules at interval boundaries, from one `.task` that sleeps until the next boundary. It never polls per frame. Reduce Motion runs at 0 fps between key states, plus each crossfade's frames (§6).

### 5.7 Rendering

- **Two Canvas layers in one `ZStack`.**
  - The **court layer** draws the field, lines, paint and center name, and the far halves of fixtures (baskets' back, goal frames, stands). Its inputs are only `(camera quantized to 0.25 px, size, ink)`, as an `Equatable` view, so SwiftUI skips it whenever the camera holds still. The camera holds still for long stretches of a half-court set, a pitch or a set piece.
  - The **actor layer** draws shadows, tags, figures, ball, fixtures' front halves, flashes, stamp and banner.
- **The frame path is a pure function** `sample(chain, p, into: &FrameScratch)`.
  - Its scratch is a reference type held in `@State` and never observed. It holds preallocated buffers for posed figures (capacity 32: football can show 30 with staff), depth order (insertion sort into a fixed buffer, n ≤ 32), ball and cue state.
  - Action overlays are pre-indexed per actor as time-sorted arrays; the active ones are found by binary search, never by `filter`.
  - `Path` construction still allocates. Budget ≤ 40 allocations per frame in drawing, **0 in sampling and posing**.
- **The deployment target is macOS 15**, so `InlineArray` (macOS 26 runtime) isn't available. Use fixed-capacity buffers in the scratch object instead.

---

## 6. Continuity rules

Each row is a situation, what the engine does, and what the viewer sees. "Splice" always means §4.5: from the sampled state, velocity-continuous.

| Situation | Engine | Viewer sees |
|---|---|---|
| **Sequence boundary** (a possession ends, a down ends, a pitch ends) | No boundary exists in the plan. The aftermath of one sequence is the set-up of the next (§5.4.7), planned as one span. | The ball goes the other way; players turn and run; the camera pans and orbits. No cut, no fade. |
| **New data, normal case** | Splice at `c = p + 0.25 s`. Only the future changes. | Nothing, or the ambient bending smoothly into the real play. |
| **New data contradicting the speculative tail** (the ball was swung left, the shot comes from the right corner) | Splice. The backward planner re-routes from the current state, with the ambient link shortened, a skip pass, or a relocation. The speed limit holds, or catch-up rules apply. | A swing pass the other way, a cut to the corner: what a real offense does. |
| **Stall** (the watermark stops advancing; BROADCAST eases p to `watermark − leadIn` and holds) | The open sequence's ambient continues as a **holding pattern** (§5.4.4), generated in 6 s chunks, intensity easing after 20 s. Frame tier drops to 30 fps, then to stillness with sparse beats after 45 s (*tune*). | The game keeps breathing; the clock holds; nothing is invented. |
| **Stoppage** (a known dead ball: foul, timeout, injury, review, period end, pitching change) | Dead-ball choreography from the rule table, sized to the **measured real durations**: NBA timeouts and media breaks from wallclock gaps (31–237 s); NFL team timeout ~52 s, TV timeout ~158 s, quarter break ~205 s; MLB mound visit ~73 s, pitching change ~147 s, half-inning ~196 s. A non-repeating ambient generator fills it in 30–60 s cycles: huddles, a stretch, a trainer, the ball tossed around. Teams return early enough to be set at least 5 s before the restart's anchor (backward-planned). | A believable stoppage that ends on time. Today's idles loop 24–44 s against 158–205 s real breaks (football audit E20), and 70% of a baseball game is a still frame (baseball audit I). |
| **Late correction** (a told play is revised or removed) | Quiet: tag and stamp text update in place. A state divergence (possession, score, runners) reconciles at the next dead ball: a jog, never a glide or fade. Logged. | At most a tag that changes words. |
| **Opening mid-game, or waking** | Declared jump. Compute `WorldState` at p from the timeline (the last sequences, their outcome and the phase now). Place everyone in the phase's canonical configuration from the rule table (basketball after a defensive rebound 3 s ago: the ball being brought up past half court). Fade in over 0.25 s on `Motion.curve` (ease-out: an entrance). Plays before p are not told, as today. | The game already under way, settled, then moving. |
| **Off-screen and back** | Plans are kept (cheap keyframes), baking is skipped (§8.4). On return, bake from the current plan at p. | Continuous with what it would have been. No jump. |
| **`Jmax` catch-up** (BROADCAST: more than `Jmax` behind) | Declared jump: crossfade 0.25 s to the materialized `WorldState` at the new p, as on opening. | A short crossfade, tagged "CATCHING UP". |
| **Period or half change** | Choreographed and continuous: walk off, benches or tunnels, field turn (the camera's yaw orbit for basketball and soccer ends, football's quarter turn), walk on. The **teams change ends**; the camera never flips the field under a crossfade. | What TV shows, compressed only where p demands it. |
| **Viewer flips the field** | Camera yaw orbits 180° over 0.9 s on `cubic-bezier(0.77, 0, 0.175, 1)` (on-screen movement: ease-in-out). | A smooth turn. |
| **Window resize, appearance change** | Camera refits through its spring (resize); inks change instantly (appearance). | Natural. |
| **Reduce Motion** | Same clock, same plan, same anchors. The renderer shows **key states**: the world as the plan has it at each decisive moment and at each phase change (set, shot, rebound secured, ball dead, line set). Consecutive key states crossfade over 0.25 s ease-out. No travel, no camera motion within a sequence. The camera reframes only at key states (also a crossfade), and the yaw never orbits. Tags, stamps, scores and celebrations still fire on their anchors (celebrations in their Reduce Motion forms). No replays. Apple: "replace slides with crossfades; keep opacity changes that aid comprehension." | A calm, legible sequence of moments, in step with the game. |
| **Two decisive moments closer than the clip minimum** (wallclock ties, fast putbacks) | Compression, then merging (§5.4.6). Within ±0.25 s of each anchor; the later beat is exact. | A tip, a miss, a tip, as one action. |
| **Contradictory lanes** (fast-lane runners or score ahead of the slow lane) | The engine never reads fast-lane *state* for the field, only hints (clock stopped or running). BROADCAST's presented state is the only truth. This fixes the baseball audit's E14 and the football hash and spot leaks. | One coherent picture. |

---

## 7. Per-sport rule tables

Each sport implements one `SportGrammar` (§10). Its tables are data in code: one Swift file per sport for the tables (`<Sport>Grammar.swift`), separate from the builders, so the web port copies tables verbatim. All durations are *tune* unless marked measured.

### 7.1 Basketball

**World frame.** The absolute court: x 0–94 along, y 0–50 across from the near sideline; rims at x = 5.25 and x = 88.75. Each team's basket per period comes from `HoopsEnds` (kept, with the flip). ESPN coordinates map with `Hoops.court` for the team attacking right, rotated 180° for the left. **No offense-relative frames, no `Lineup.seen(by:)`.**

**Lead-in horizons** (inputs to D, BROADCAST §2):
- live-ball shots, rebounds and turnovers: 3.0 s before the anchor;
- free throws: 4.0 s;
- dead-ball admin: none (it attaches late).

**Clock-stopping kinds** (they end running stretches, §5.1): fouls; violations; out-of-bounds and dead-ball turnovers (`outOfBounds`, traveling, shot clock, offensive foul, charge); timeouts; free throws; period ends; made FGs in the last 2:00 of the 4th and OT.

**Sequencing:**

| Situation (known) | Sequence and phases | Inferred beats (window) |
|---|---|---|
| Possession start after a made FG | `inbound(baseline) → advance → set` | Inbounder: a non-guard defender of the scored-on team, seeded, steps out at the baseline (`[τ_make + 0.8, + 1.6]`). Inbound pass to the lead guard at the FT line extended (`+ 1.8 … 2.6`). Advance past half court within 8 game-s, typically 4–7 s by game clock to the next event. |
| After a defensive rebound | `outlet or push → advance or transition` | A big rebounder outlets to the nearest guard on the wing (`[τ_reb + 0.35, + 0.9]`), the existing `outlet` rule. A guard rebounder dribbles up himself. |
| After a steal (live-ball turnover) | `transition` | The stealer (or the nearest guard) pushes. The next known shot by that team within 6 game-s and at the rim → **break finish** template. Otherwise secondary break → set. |
| After a dead-ball turnover, non-shooting foul or violation | `deadBall → inbound(sideline at spot) → set` | Official whistle and signal at the spot (inferred if the play hasn't arrived). Ball to the inbounder at the nearest sideline point to the spot. |
| Shooting foul → free throws | `deadBall → laneSetup → FT×n → (rebound or inbound)` | Lane alignment (rules table below). An official hands the ball to the shooter at each attempt (`τ_FT − 4.5 … − 3.5`). The shooter's routine (existing `freeThrow()`). |
| Miss on FT k < n | none | The team rebound (dead), and the ball back to the shooter. The data's 0-participant offensive rebound is consumed here, not animated. |
| And-one (make + shooting foul at the same clock) | Contact at release; whistle at `τ_make + 0.3`; then the FT sequence | Fouler from `andOneFouler`. |
| Miss → rebound | Rebound clip | Carom (existing `Carom`) from distance and angle; box-outs by every defender on his man from release + 0.3 s; the credited rebounder reaches the carom point at `τ_reb`. A team rebound with no participant goes out of bounds near the carom → inbound. |
| Offensive rebound → shot ≤ 4 game-s | Merged clip `rebound → putback/tip/kick-out` | A kick-out to the shooter's spot if the shot is beyond 10 ft. |
| Jump ball | `tip` | The center circle (period starts) or the nearest circle (held balls): the existing `tipSet`/`jumpBallBeat`, with the official's toss. |
| Timeout | `benches` | Both fives walk to their benches (the existing `huddle()` spots); huddles; sparse beats; teams walk back to be set 5 s before the restart's anchor. Real durations from wallclock gaps (31–237 s, measured). |
| Substitutions (a cluster) | Inside the stoppage | Walk-on and walk-off at the scorer's table (near sideline, center), **during the stoppage's last 12 s**, ordered by `sequenceNumber`. Never fades except at the table. |
| Period end | `horn → walk to benches (or tunnel at halftime and the final)` | — |
| Review or challenge | `deadBall` + "CHALLENGE · TEAM", then the ruling | Officials at the monitor (table). The ruling is a quiet correction. |
| Fast-lane clock stop with no play yet | Open sequence → `stoppage(inferred)` | Players ease to a stop; an official whistles (no call words); "WHISTLE". The play attaches when it arrives. |

**Action clips** (the decisive ~1.6–4.0 s; selection by data):

| Data (type, assisted, zone, role) | Clip | Clip-start constraints | `T_clip` |
|---|---|---|---|
| Jump shot or three, **assisted**, corner | Drive-and-kick: a handler drives the near-side gap, the help sinks, the kick to the corner | Handler at the wing or top with the ball; shooter in the corner (or lifting into it) | 2.6 s |
| Jump shot or three, assisted, wing or above the break | Swing or pin-down: two swings, or the shooter curls off a big's down screen | Passer within 18 ft, shooter on the weak side or low block | 2.4–3.0 s |
| Jump shot, assisted, mid-range | Elbow catch or curl | Shooter at the block or wing, screener at the elbow | 2.2 s |
| Pull-up or step-back, unassisted | High pick-and-roll or isolation: a big screens (PnR) or clears out (ISO), 2–4 dribbles, then the pull-up or the step-back hop (3 ft back, landing balanced) | Shooter with the ball, 6–10 ft from his spot; a big within 15 ft for PnR | 2.8–3.6 s |
| Driving layup, finger roll or dunk, unassisted | Drive: an attack along the line arc → spot → rim, the help rotating (existing `driveToRim`) | Handler at the arc on the spot's side | 2.0–2.6 s |
| Driving floater, unassisted | Drive and stop: the floater released at the spot (inside today's `jumper` for floaters) | Same as the drive | 2.2 s |
| Cutting layup or dunk, assisted | Basket or backdoor cut (existing `cut`) | Passer at the wing or top; cutter at the wing or corner, defender overplaying | 1.8 s |
| Alley-oop | Lob (existing `alleyOop`) | Passer at the top or wing; finisher on the weak side or rim-running | 2.0 s |
| Turnaround, fadeaway, hook (post) | Post entry, back-down (1–2 dribbles), turn | Shooter on the block or elbow, passer on the wing | 3.0 s |
| Putback, tip | Part of the rebound clip | — | 0.6–1.2 s after `τ_reb` |
| Running layup or jumper after a steal or defensive rebound ≤ 6 game-s | Break finish (existing `transition()`): lanes filled, a 2-on-1 or 3-on-2 | Ball handler in the middle lane | 2.5–4.0 s |
| Free throw | Existing `freeThrow()` routine | Lane aligned | 3.2 s |
| Block | The underlying shot's clip with a contest by the blocker → `block` action at `τ` | The blocker within reach by `τ − 0.5` | as the shot |
| Missed late tying shot | As the shot | — | — |

Clips reuse today's builders (`halfCourt`, `driveToRim`, `cut`, `alleyOop`, `jumper`, `putback`, `transition`, `freeThrow`, `finishAtRim`, `Carom`). Refactor each to start from a `WorldState` slice (who and where) instead of `lineUp`, and to stop at `τ + aftermath`.

**Formations** (the ambient half court): the existing three sets (5-out, horns, 4-out-1-in), plus 1-4 high and box. Slots shift with ball side (strong and weak). The **shooter's slot is biased toward the zones he has shot from tonight**: a shooter with corner threes tonight gets the corner slot 60% of the time (seeded).

**Free-throw lane alignment** (NBA rules): the defense takes the first lane spot on each side (closest to the basket); the offense next; then a defender above on one side. The other players stay behind the three-point line, and the shooter is at the line. Officials appear only while acting (the standing rule): one comes in to hand the ball to the shooter for each attempt, then leaves. On the last free throw the box-outs happen at release + 0.2 s.

**Camera** (ft, top to bottom of view):
- half court 34, transition 42, push-in 27, free throws 30, timeout 46, break 60;
- yaw −30° at the right basket, +30° at the left, hysteresis ±6 ft, dwell 2 s, ω = 3.6.

### 7.2 Football

**World frame.** The absolute field: x along it (feet, goal line to goal line plus end zones), y across it. Each team's direction per quarter comes from the existing field-facing rules. ESPN `yardLine` counts from the **home** goal line (verified 2026-10-25); `yardsToEndzone` is the cross-check.

**Event time.**
- **NFL:** wallclock, monotonic. Determine on the bench whether it marks the snap or the dead ball (§3.2). Until then, treat it as the **dead ball** and place the snap at `τ_dead − playLength`.
- **College:** wallclock is logging time. Use the `(mm:ss)` clock prefix with the running-clock map, and wallclock only as an upper bound.
- `playLength` from kind and yards: passes 3.5–6.5 s by depth; runs 3–7 s by yards; sacks 3–4.5 s; punts and kickoffs from hang time plus the return; kneels 2.5 s; spikes 1.5 s.
- **Keep the user's 1.3× snap-to-dead-ball pace** (2026-10-29). The snap is inferred, so a play laid out at real speed is played 1.3× slower by moving the snap anchor earlier by 0.3 × `playLength`, keeping the dead-ball anchor exact. The pre-snap phase absorbs the difference. Walk-ups and resets are never slowed; nothing is sped up.

**Lead-in horizons:**
- **Formation commit at line-up: 15–20 s before the snap** (football audit, hardest problem 2). If the next play isn't known by line-up, line up in the **predicted** formation (the existing idle rules: down, distance, last set). When the real play arrives, realize the difference as a **pre-snap shift or motion**. Teams really do this, so it's never a morph or a crossfade.
- Unit changes (punt, FG, PAT) need a 20 s lead-in. If they're late, the substitution jog is compressed down to a minimum of 6 s.

**Clock-stopping kinds:** incompletions, out-of-bounds (outside the last 2:00 of the half the clock restarts on the ready signal, so this doesn't matter for anchors), scores, turnovers, penalties, timeouts, two-minute warning, quarter ends, injuries, reviews.

**Sequencing:**

| Situation (known) | Engine (sequence and connective beats) |
|---|---|
| Same offense, game clock ran (drop ~35–45 s) | Pile gets up (release envelope 0.6–1.0 s: fixes F9), then the walk to a huddle 7 yd behind the **next** spot, an 8–12 s huddle, the break, the walk-up into the **next play's** formation (from its data), set, cadence or motion, snap at its anchor. Start = previous end (99.6%, measured). |
| Clock stopped (incomplete, out of bounds) | Same, with a quicker huddle; an official spots the ball (inferred, no name). |
| "No Huddle" in the next play's text (28% of snaps, measured) | No huddle: jog to the line, QB signals. |
| Personnel change or 4th down → punt or FG | The substitution beat: the units jog off and on through the sideline, never morphing roles. For an FG the yaw orbits to 0° during the set. |
| Punt or kickoff outcome (fair catch, touchback, downed, out of bounds, return, onside) | The existing kick builders, anchored. Then the units swap and the **yaw orbits during the walk-off** (football's only possession orbit). |
| TD | Celebration 4–8 s, walk off, PAT unit to the 15 (NFL) or 3 (college). The try is anchored from `pointAfterAttempt` inside the TD entry, with holder and snapper names from the text. Then the kickoff sequence. |
| Score → Official Timeout (14 of 19, measured) | PAT, then to the sidelines with the kickoff unit visible. The return is backward-planned from the kickoff's anchor (~150–170 s). Kickoff units at the 35. Fixes F7. |
| Safety | Free kick from the 20. |
| INT, fumble lost, turnover on downs | Return to the stop (existing builders), units swap, yaw orbit, new huddle. |
| Penalty "No Play" (6–9% of snaps) | Set, flag at the line (officials appear only for the throw), whistle, walk-off of the yardage, re-set without a huddle. Kick plays typed Penalty use the kick unit (fixes F13 in the audit). |
| Flag on a play (declined or offsetting) | Existing in-script flags. |
| Team timeout (~52 s) | That team to its bench, the other team in a knot; return backward-planned. |
| TV timeout / two-minute warning (~158 / ~166 s) | Both teams to the sidelines, non-repeating ambient (water, a coach's tablet, a trainer), return ~20 s before the anchor. Fixes F11. |
| Quarter end (~205 s) | Teams walk to the other end while the yaw orbits 180°; ball re-spotted mirrored. College: break `sequenceNumber` ties by list order (fixes F8). |
| Halftime / final | Off to the tunnels; the second half runs out, then the kickoff units. |
| Challenge / booth review | Red flag after the play, then the tag stages Challenge → Under review → ruling. A reversal is a quiet correction. |
| Injury (named) | The credited man stays down where the play ended; trainers come on; 2–4 min. |
| Kneel / spike | Victory formation, kneels ~40 s apart / hurry-up line-up, then the spike. |
| Burst (stall recovery, college batching) | Huddles and walk-ups compressed to their minimums; TV-timeout beats whose time has passed are dropped. Never reorder, never cut. |

**Identity.** Credited men are persistent within a drive (QB, the credited back and receivers). Others are anonymous slots carried across plays, matched with the bridge's cost when the personnel changes, never re-rolled. **The strong side is a property of the formation data, never a coin flip:** when the text doesn't say, seed it per drive, not per play.

**Camera** (ft, closest):
- pre-snap 60;
- the play follows the existing shot grammar, with the first shot from the camera's current state;
- push-in 50 on the catch or tackle;
- kicks 80;
- yaw fixed by direction; it orbits only on a possession reversal during a kick or turnover return's walk-off, and at quarter ends.

### 7.3 Soccer

**World frame.** The absolute pitch in metres (Opta → metre mapping kept, `SoccerScene.swift:44–69`). Each team's attacking end per half comes from the period. Entries are in the acting team's frame: transform per entry.

**Event time** = wallclock = period start + `clock.value` + `addedClock.value` (true elapsed time, measured). Ties within a second are broken by list position, and the AnchorSolver spreads them with the minimum gaps below.

**Minimum gaps** (all *tune*):
- pass struck → received: the flight time from the distance and pass type (ground 15–20 m/s with deceleration, lofted ballistic);
- received → next touch: ≥ 0.3 s, or ≥ 0.15 s for a one-touch run (several entries in one second);
- shot → save: flight time;
- foul → card: ≥ 2 s.

**Lead-in horizons:** in play 2.0 s (receivers must reach the pass end), restarts 8 s (set-ups).

**The continuous ball.** **Every located entry is a hard ball keyframe** (the soccer audit's rule).
- A pass is struck at `pos` at `t` and arrives at `pos2`.
- The next same-team entry's actor is the receiver: he must reach `pos2` by the ball's arrival, then carry to the next entry's `pos` in the remaining time.
- An opponent's next entry is a contest at its `pos`: possession flips at that keyframe, and both shapes re-target continuously, **never re-seeded**.
- Gaps of 3 s or less are fully determined. Longer in-play gaps (rare, p99 36 s) get ambient circulation constrained to **end at the next keyframe's team, spot and time**.

**Off-ball shape.** One evolving state per team. Targets come from the formation slot shifted by the ball's position and the phase (build-up, attack, defend, transition): `slot + k_x·(ball.x − 52.5) + k_y·(ball.y − 34)`, with phase gains `k`. They're followed by the critically damped tracker (§5.4.5). Unify the two shape models (idle `b.x − 45`/0.95 vs replay `b.x − 52.5`/0.9 + onside clamp) into this one (fixes S4). The onside clamp stays: no attacker beyond the second-last defender unless the data says offside.

**Rules:**

| Situation (data) | Engine |
|---|---|
| Pass, cross, free kick, throw-in or goal kick with `pos2` | Ball flight from `pos` at `t` to `pos2`; the actor pinned at `pos` at `t` (hard key). |
| Run of 2+ entries within 1 s | One-touch play: flights compressed with physical floors (the existing `least`/`beats`); order kept. |
| Shot or goal | Existing strike and payoff, anchored so the goal-line or hands moment is the entry's `t`. The build-up is **not retold**, because it was already shown live (fixes S6). The reverse take moves to the replay system (§5.6.4). |
| Shot on target + save | Keeper keyframe (existing dives with the hand pinned); `drop-of-ball`/`punch` positions are rebound keyframes. |
| Out (+ throw-in) | Ball rolls out at the out spot; the nearest opponent wide man fetches it; throw-in at its spot and `t` (p50 15 s later, 3 m away, measured); the others drift into throw-in shape. |
| Out over the goal line + goal kick | Keeper places the ball; attackers retreat past halfway; goal kick at its `t` (p50 20 s). |
| Corner awarded | Taker walks to the flag on `y`'s side; the box fills and jostles **until the delivery entry** (13–38 s, measured). Never time-boxed (fixes S8). |
| Foul (fouler, fouled) | Contact at `pos`, the fouled man down; card if one follows (the referee walks in, as an official doing something); free kick at the next free-kick entry's `pos` and `t` (p50 20 s, ~5 m away); a wall when in range. |
| Offside (credited to the passer) | The assistant's flag at the receiver ≈ `pos2`; a free kick for the other team at the next entry. |
| Goal | Celebration (the existing scorer run to the corner with teammates), then **everyone walks back** to their halves into kickoff shape. The conceding team's first entry near the centre (42–87 s later) is the kickoff keyframe; the kickoff itself is synthesized because ESPN emits none (fixes S7). |
| Kickoff, 2nd half, halftime, full time | Walked into, never placed; tunnels at the half (fixes S16 in the audit). |
| Substitution pair (same second) | One beat: board, the off man walks to the nearest touchline, the on man enters at halfway, lineup changes at `t` (applied at its anchor, `addedClock` included: fixes S10). |
| Red or second yellow | Walks off; **removed from the shape for the rest of the match** (fixes S9). |
| Injury delay → resume | The man down at his last position, physios on, resume at the next entry. |
| VAR check / decision | Play held, referee to the monitor, decision tag. A goal struck off after presentation is a **quiet correction** (NO GOAL tag, score revert), not a retelling (fixes S11). |
| Stall | Restart set-ups keep jostling (corner, wall); in play, possession circulation around the last keyframe (holding pattern). |

**Camera:**
- the main stand camera (existing gantry travel);
- closest 30 m in circulation, 16 m on a move, 11 m on push-in at the shot;
- yaw orbit ω = 2.4 toward the attacking third;
- the reverse "behind the net" angle only in replays.

### 7.4 Baseball

**World frame.** The existing ballpark frame (feet).

**Event time:**
- **Pitches:** statsapi `playEvents[].startTime` (ms) is the primary source. Calibrate on the bench what it marks (release or record time) against the plate time computed from the kinematics. ESPN wallclock is a fallback (25% are 8–20 s late, measured).
- **Non-pitch events:** their own `startTime`.
- **Steals:** logged ~15 s after their pitch. Attach them to their pitch by `runners[].details.playIndex` and the pitch number, so the runner breaks **on that pitch's delivery**.

**Decisive moments:** the plate crossing for each pitch; contact; each putout or tag; each runner's touch of his destination base; the ball clearing the wall.

**Lead-in horizons:**
- **Pitch data by the pitcher's set: 2.5 s.** If it's missing, the pitcher holds (a step-off is real baseball) for up to 6 s; then the pitch is thrown with `shaped()` from ESPN data, and later Statcast is a quiet correction of the trace.
- **hitData by contact:** the flight shape is decided before contact and never swapped after (baseball audit, hardest problem 3). If hitData is late, use ESPN's spray spot and trajectory class through `BattedFlight`'s class model.

**Real time is available.** Pitch → pitch is 20 s, plate appearance → plate appearance 39 s, half-inning 196 s (measured), so there is time for real-speed plays: runners at Statcast sprint speed (default 27 ft/s, against today's 95), the trot at 18–22 ft/s (today 140), fielders jogging back at 10–15 ft/s. **Play pace is a policy knob and a decision for the user** (§11.4):
- Today's compressed pace was approved ("baseball's speed is fine", 2026-10-29) and stays the default.
- Phase 4 renders both on the same plate appearances.

Nothing logs intra-play times, so either pace is consistent with the anchors: the pitch crossing and contact. Dead time after the play absorbs the difference, filled by walks and jogs, never by fades or 0.8 s rubber-band settles.

**Rules:**

| Situation (data) | Engine |
|---|---|
| Non-final pitch | Pre-roll from the dead time: the catcher's throw back after the previous pitch, the pitcher on the rubber, the sign, the set (runners take primary leads at the set), the catcher squats at about T − 5 s, the delivery (arm slot from the release point), the plate crossing at the anchor, the call. After: the return throw, runners back to the bag, the batter's step out on a long pause. |
| Final pitch + ball in play | One sequence: pitch → contact → `BattedFlight` at real pace → the credits chain (`handling`) → runner legs at sprint speed, outs in `outNumber` order (`sequenceRuns` kept). Then the dead ball: fielders jog back, runners stand **on** the bag, the ball is relayed to the pitcher. Fixes M2. |
| Strikeout / air out / force | The batter **walks to the dugout** (never fades). On a strikeout with the bases empty, the catcher throws around the horn (inferred). Fixes M3. |
| Next batter | Walks from the **on-deck circle** (`Ballpark.onDeck`) to the box 10–15 s before the first pitch. His side comes from MLB `matchup.batSide`, or ESPN's situation batter as soon as known, **never the previous hitter's** (fixes M1). The on-deck man appears from the dugout during the previous plate appearance. |
| Steal / CS / WP / PB | Merged into that pitch's sequence: the runner breaks on the delivery with the **real call and swing**, catcher pop time ~2.0 s, the slide and tag. Never a second pitch (fixes M5). |
| Pickoff attempt | Keyframe at its `startTime`: the throw, the dive back, the ball back. |
| Mound visit (~73 s) | Walk out at `startTime`, a conversation idle, walk back so everyone is set ≥ 5 s before the next pitch. |
| Pitching change (~147 s) | Manager out, hand-off, the starter walks the full path to the dugout, the reliever jogs the full path from the bullpen (20–25 s), warm-up tosses fill the rest. Fixes M3. |
| Half-inning change (~196 s) | Full jogs off and on, stranded runners jog off, warm-up pitches, infield grounders, outfield toss, the leadoff hitter on deck, then the walk-up. |
| Batter timeout / step-off / ABS challenge | Keyframed at `startTime`, with the challenge caption. |
| Alignment | Shade fielders by `batSide` (no positional feed), during the walk-up, never inside a pitch. |
| State mismatch (a told play left a runner elsewhere) | Reconcile with a jog during dead time; never glide, never fade at a base (fixes M6, M10). |
| Revision / ID replacement (ABS overturns rewrite IDs, `ws-g4-rewrites.json`) | Quiet correction keyed by stable identity (half, batter, pitch number), never a retelling. |
| Stall | Dead-time idle on the pitch-clock rhythm (15–20 s cycles); never extrapolate a pitch. |
| Rain delay | Players walk off to the dugouts, the grounds crew pulls the tarp over 25–40 s (not a pop: fixes M11), and the reverse on resuming. |

**Camera.** The existing `PlayCamera` families become continuous targets:
- behind home for pitches;
- the high first-base side for balls in play;
- the outfield for deep flies.

A pitch → ball-in-play family change is the one place TV *cuts*. Keep it as a **declared cut** (a camera-only discontinuity that the bench allows, budgeted at ≤ 1 per plate appearance) or replace it with a 0.6 s pull-back orbit. Decide on video in Phase 4. The HR trot follows continuously (no cut).

---

## 8. Performance plan

### 8.1 The honest trade

Today the theaters are still most of the time:
- about 70% of a baseball game is a still frame;
- basketball and football draw only during clips and sparse idle beats;
- the idle theater costs about 0.5% CPU.

A continuous broadcast **animates whenever the ball is live**:

| Sport | Ball-live share of real time |
|---|---|
| NBA | ~⅓ (real time ÷ game time is ~3, measured) |
| NFL | ~10% (about 155 plays × 5 s in 3 h) |
| Soccer | ~55–60% |
| MLB | ~4% (pitch flights and plays) |

CPU will rise during live play. The design keeps it bounded with planned frame tiers, cached static layers, allocation-free sampling and no work off-screen. The targets below are **budgets to be measured, not estimates**. No frame cost has been measured yet. Phase 0's first task is to measure today's replay frame as the baseline.

| State | Budget (M2 Air, app process, one game page open) |
|---|---|
| Off-screen (folded, scrolled away, window hidden) | 0 frames; plan maintenance ≤ 0.05% average (keyframe planning on data arrival only) |
| Stoppage, still with sparse beats (tier 0) | ≤ 0.6% average (today's level) |
| Live play, slow (tier 1, 30 fps) | ≤ 4% while it lasts |
| Action (tier 2, 60 fps) | ≤ 9% while it lasts |
| **Whole-game average** | **NBA ≤ 2.5%, NFL ≤ 1.5%, soccer ≤ 4%, MLB ≤ 1.0%** |
| Per frame on the main thread | sample + pose ≤ 0.8 ms; Canvas command generation ≤ 1.5 ms; p99 frame ≤ 8 ms (no hitches at 60 Hz) |
| Per plan bake (off-main) | ≤ 15 ms for a 30 s horizon (≤ 32 actors) |
| Memory per baked 30 s plan | ≤ 1.8 MB (32 actors × 1800 samples × (8 B position + 20 B rig) + camera) |

### 8.2 Precomputed per plan vs per frame

| Per plan (bake, off-main, `nonisolated`) | Per frame (main, allocation-free) |
|---|---|
| Keyframes, splines, retiming, collisions | Locate the plan (cached index) |
| Position samples at 60 Hz (`ContiguousArray<SIMD2<Float>>`) | Read each actor's sample, lerp between samples |
| `RigTrack` (heading, phase, speed, push, weight, steps) | `RigTrack.motion` + `feet` (binary search over steps) |
| Action overlays, sorted, with time windows | Binary search for active overlays; envelope weights |
| Ball segments | Evaluate the current segment (closed form) |
| Camera samples (x, y, span, yaw) | Lerp |
| Cues (stamp, banner, flash, net, celebration, tags, status) with times | Read the active cues |
| Frame tiers (intervals) | — (the view schedules on tier boundaries) |
| Tag placements per stretch (the existing per-stretch cache) | Lookup |
| Depth-sort keys can't be precomputed (the camera's yaw changes depth) | Insertion sort of ≤ 32 into a fixed buffer |

### 8.3 Rendering rules

1. **Static layers cached.** Field and court geometry live in field space as prebuilt `Path`s, transformed by one `CGAffineTransform` per frame (the projections are affine). This removes ~540 trig calls a frame in baseball's `BallparkLayer`, ~400 hash segments in football's `GridironLayer`, and the pitch's per-frame `map`s.
2. **Two-layer Canvas** (§5.7). The court layer is an `Equatable` view keyed on the quantized camera, so it doesn't redraw while the camera holds.
3. **No script or plan building in `body`.** Today baseball builds scripts synchronously inside `body` (`ScriptMemo`), and soccer rebuilds idles about 311 times a match on the main actor. All baking moves to the director, off-main.
4. **No deep `==` on scripts.** Today `FootballFrame`, `PlayFrame` and `SoccerFrame` compare whole scripts, rig arrays included, when `t` is equal at rest. Frames compare `(planRevision, p, size, ink)` only.
5. **No duplicate builds for side consumers.** Today `SlideTheater.*.climax` rebuilds full scripts on every read. Slides read the plan's cue list.
6. **Gate every clock by visibility,** the heartbeat's 1 Hz `TimelineView` included.
7. **Measure `-O` vs `-Osize`** (`build.sh` uses `-Osize`) for the frame path. If `-O` is materially faster, consider it for the release build.
8. **Measure `Canvas(rendersAsynchronously: true)`** for the actor layer. It moves rasterization off the main thread where SwiftUI allows.

### 8.4 Plan always, bake when seen

Off-screen, the director keeps planning: keyframes are cheap and deterministic. It skips baking. On becoming visible it bakes the current plan from the latest splice. Because plans are pure functions of (timeline, seeds, splice chain), the result is exactly what would have been on screen, so returning shows no jump. If the chain has grown long off-screen (more than 10 plans), it is collapsed: the oldest plans are discarded, and the world state at p is computed by baking only the last plan from its splice state.

### 8.5 How to measure (no Instruments on this machine)

1. **Bench timing.** The replay bench (§9) samples every frame of a recorded game at 60 Hz and times `sample + pose` and the Canvas command generation (an offscreen `ImageRenderer` of the actor layer) with `ContinuousClock`. It reports p50, p99 and max per tier.
2. **Allocations.** In the bench harness, read `malloc_zone_statistics` deltas around the sampling call: the target is 0 for sampling and posing.
3. **Whole-app CPU.** Run the app's playback of a recorded game (a debug-only feed source reading the recordings on a virtual clock) and measure `top -l 0 -stats pid,cpu -pid <pid>` averaged per tier interval, plus `/usr/bin/sample <pid> 10` for hotspots. Remember the occluded-window caveat: an occluded or low-alpha window renders unthrottled, so measure with the window visible.
4. **Serialize heavy jobs.** Run every compile and render under the shared lock (`lockf -k <scratchpad>/heavy.lock nice -n 10 …`); see the agent-load notes.

---

## 9. Determinism and the replay bench

### 9.1 The bench

- **What it is:** a CLI target or test helper, shared with BROADCAST's bench, with `TheaterBench <sport> <recording-dir> [--from p --to p] [--video out.mp4] [--overlay]`.
- **What it does:**
  - feeds each snapshot at its arrival time on a virtual clock;
  - runs the **real** parsers, then `GameTimeline` and `PresentationClock`, then the engine;
  - samples every frame at 60 Hz;
  - writes a JSON report and a one-screen summary.
- **Speed:** deterministic and faster than real time. Baking dominates, at about 15 ms per plan, and plans number about one per data change (every ~10 s), so a 2.5 h game benches in well under a minute plus sampling.

### 9.2 Metrics, definitions and gates

| Metric | Definition | Gate |
|---|---|---|
| `hardCuts` | Frames where any actor, the ball or the camera moves more than `1.5 × v_cap × dt` (camera: more than 0.2 view-heights, or more than 5° of yaw in one frame), outside a declared jump | **0** |
| `teleportMax` | The largest single-frame displacement of any actor ÷ (`v_cap × dt`), and in field units | ≤ 1.15; report feet or metres |
| `speedViolations` | Actor-seconds above `v_cap(role)` ÷ live actor-seconds; plus the maximum overspeed | ≤ 0.5%; max ≤ +12% (basketball) |
| `accelViolations` | Actor-seconds above peak accel or decel (tangential) or lateral accel | ≤ 1% |
| `turnViolations` | Heading rate above the rig's cap while moving faster than jog | ≤ 0.5% |
| `footSlip` | Planted foot's world displacement while the gait weight is above 0.5 | ≤ 0.5 mm-equivalent, **across splices too** |
| `decisiveError` | \|plan's decisive time − anchor\| per known beat | p95 ≤ 0.05 s; max ≤ 0.25 s outside declared catch-ups |
| `catchUps` | Count and lateness of declared micro catch-ups and late tellings, by kind | Report; regression alarm when it rises 20% over baseline |
| `inferredShare` | Inferred beats ÷ all beats; and actor-seconds driven by inferred or ambient constraints ÷ all | Report by kind and sport (informational; watch for drift) |
| `ambientShare` | Presented live time with no known decisive beat within ±3 s | Report |
| `inventedDecisive` | Decisive cues (shots, scores, tackles, whistles with words, substitutions) without a known source | **0** |
| `namesOnInferred` | Name tags on actors not credited by a known beat | **0** |
| `cameraJerk` | Max pan, zoom and yaw acceleration; max yaw speed | Yaw ≤ 45°/s; no cut |
| `corrections` | Revisions or removals after presentation, by kind (BROADCAST) | Report |
| `cpuFrame` | `sample + pose` and Canvas command time per frame, p50/p99, by tier | p99 ≤ 2.3 ms combined |
| `allocsFrame` | Allocations in sampling and posing per frame | **0** |
| `determinism` | Hash of all baked tracks and cues, two runs | Identical (Swift); TS within 1e-3 field units (§13) |

### 9.3 Fixtures

Trim small slices of the recordings into `Tests/Fixtures/broadcast/` (shared with BROADCAST):
- **NBA:** 401909285 Q4 from 7:17 to 4:00. It contains a timeout cluster with backdated subs, a three-shot free-throw trip, a steal into a three, a block into an offensive rebound into a shot-clock turnover, and dense miss/rebound pairs.
- **NFL:** a scoring drive with a TD, the PAT inside the entry, a TV timeout and the kickoff.
- **College:** a batch with tied `sequenceNumber`s.
- **Soccer:** a goal, its build-up and the restart 42–87 s later; a corner from award to delivery; a substitution pair; a red card if one exists.
- **MLB:** a plate appearance with a steal on pitch 4, a pitching change, a half-inning change, and an ABS rewrite (`ws-g4-rewrites.json`).

Unit tests in `Tests/`:
- AnchorSolver: PAVA with gaps, ties, backdated clusters, frozen prefix;
- Sequencer rules: one test per row of §7;
- CastTracker: starters, subs, validation swaps;
- quintic Hermite continuity and retiming;
- the splice reproduces `WorldState` exactly (positions, velocities, rig carry);
- ambient vocabulary has no decisive cases (compile-time) and the generator respects it (property test);
- camera yaw hysteresis.

### 9.4 Video

The bench renders frames along its virtual time (the existing render harness's offscreen path) and encodes an `.mp4`:
- basketball: miss, offensive rebound, putback, then a made three back the other way;
- football: a scoring drive;
- soccer: a goal with its restart;
- baseball: a steal pitch and a ball in play.

Upload to the `videos` draft release (`gh release upload videos … --repo lame-o/scoreline --clobber`; the tag is lowercase) and delete the local copies. Phase 0's video (`./test.sh --bench --theater video <out.mp4>`) draws today's stage and the engine side by side on the same stretch, each starting a few seconds before its own telling of the first play. Videos are never kept locally. An overlay variant (`--overlay`) draws provenance rings and anchor ticks for tuning.

### 9.5 Re-run the measurements on the weekend's recordings

Extend `~/Developer/scoreline-recordings/measure.py` (it already prints lag, burst, revision and score-skew statistics) with the analyses behind §3:
- **lag by kind**, from each play's first-seen arrival minus its wallclock;
- **lookahead coverage vs D**: for D in {30, 35, 40, 45, 50, 60}, the share of each kind arriving after `anchor − leadIn`, and the share of tightly linked next plays (≤ 10 s later) known at the current play's lead-in;
- **wallclock ties and backward steps** per game;
- **chain patterns** (possession chunks per sport).

Run it on every sport as recordings arrive, and set the lead-ins and BROADCAST's kind-aware `D*` from the result.

---

## 10. Data contracts (Swift)

Engine files import `Foundation` and `simd` only, never SwiftUI. `CGPoint` and `CGRect` come from CoreGraphics through Foundation, as the scripts use them today. Types are value types and `Sendable`; the engine is `nonisolated`.

The project builds in Swift 5 language mode (`build.sh`: `-swift-version 5`, macOS 15). A `nonisolated async` function therefore already runs off the main actor. If the project later adopts Swift 6.2's nonisolated-nonsending default, mark `bake` `@concurrent`. Use structured `await` from the director, not `Task.detached`.

The shapes of `GameTimeline` and `PresentationClock` below are **what this engine needs**. Align the names with the BROADCAST implementation rather than duplicating them.

```swift
// MARK: - What the engine reads from BROADCAST

/// Seconds on the event-time axis; p presents it 1:1 (p = now − D).
typealias PTime = Double

struct TimelinePlay<Play: Equatable & Sendable>: Equatable, Sendable {
    let id: String
    let order: Int                  // the timeline's order: sequenceNumber / list position / statsapi index
    let eventTime: PTime?           // the timeline's event time (wallclock, statsapi startTime, or estimate)
    let period: Int
    let clock: GameClockReading     // game clock elapsed in the period, and its resolution (1 s / 0.1 s)
    let revision: Int
    let play: Play                  // the sport's parsed play (BasketballScene, FootballScene, SoccerEntry, PitchEvent…)
}

struct TimelineSnapshot<Play: Equatable & Sendable>: Equatable, Sendable {
    let plays: [TimelinePlay<Play>] // up to the watermark, in order
    let watermark: PTime
    let revision: UInt64            // bumps on any ingest that changes plays
    let told: Set<String>           // plays already presented (BROADCAST: told plays never re-animate)
}

enum Hint: Equatable, Sendable {    // fast lane: never state, only hints
    case clockStopped(period: Int, at: Double, seen: PTime)
    case clockRunning(period: Int, from: Double, seen: PTime)
}

// MARK: - Engine core

struct ActorID: Hashable, Comparable, Sendable { let raw: UInt16; static func < (a: Self, b: Self) -> Bool { a.raw < b.raw } }

struct BeatID: Hashable, Sendable {
    let play: String                // the known play, or the known play an inferred beat derives from
    let part: UInt8                 // 0 = the play itself; 1… its inferred children, by rule order
}

enum Provenance: Hashable, Sendable {
    case known(play: String)
    case inferred(rule: String, from: [String])   // rule id from the sport's table, e.g. "nba.inbound.afterMake"
    case ambient
}

struct PlayAnchor: Equatable, Sendable {   // `Anchor` in the first draft: SwiftUI has one
    var at: PTime                   // the decisive moment
    var window: ClosedRange<PTime>  // where it may slide (a point for hard anchors)
    var hard: Bool
}

struct Beat<G: SportGrammar>: Identifiable, Equatable, Sendable {
    let id: BeatID
    var kind: G.Kind
    var anchor: Anchor
    var cast: [G.Role: ActorID]     // who does what (credited for known beats; chosen for inferred)
    var spot: SIMD2<Double>?        // world frame (ft or m)
    var target: SIMD3<Double>?      // where the ball goes (rim, pass end, goal mouth, base)
    var provenance: Provenance
}

enum SequenceOutcome<G: SportGrammar>: Equatable, Sendable { case open(G.Phase), closed(G.Outcome) }

struct Sequence<G: SportGrammar>: Identifiable, Equatable, Sendable {
    let id: BeatID                  // its first beat
    var team: GameDetail.Side?
    var beats: [Beat<G>]            // ordered by anchor
    var phases: [G.Phase]           // the phase graph realized in order
    var outcome: SequenceOutcome<G>
}

struct SequenceWindow<G: SportGrammar>: Equatable, Sendable {
    var sequences: [Sequence<G>]
    var frozenUntil: PTime          // anchors at or before never move
    var watermark: PTime
}

struct Cast: Equatable, Sendable {  // CastTracker's output at a time
    struct Member: Equatable, Sendable { var id: ActorID; var athlete: String?; var team: GameDetail.Side?; var role: String; var since: PTime }
    var members: [Member]           // on the field now, sorted by id
}

struct MotionLimits: Equatable, Sendable {
    struct Band: Equatable, Sendable { var walk, jog, run, sprint: Double; var overspeed: Double; var overspeedFor: Double
                                       var accel, decel, lateral: Double }
    var bands: [String: Band]       // by role ("guard", "big", "skill", "line", "outfield", "keeper", "runner"…)
    var bodyRadius: Double
    var cruiseOver: Double          // rest-to-rest distance beyond which cruise keys are inserted
}

struct MotionKey: Equatable, Sendable {   // `Key` in the first draft
    enum Kind: Equatable, Sendable { case through, arrive, depart, contact(ActorID) }
    var t: PTime; var at: SIMD2<Double>; var kind: Kind
    var velocity: SIMD2<Double>? = nil; var acceleration: SIMD2<Double>? = nil
    var window: ClosedRange<PTime>? = nil; var radius: Double = 0; var hard: Bool
}

struct Overlay: Equatable, Sendable {   // what he does over how he moves: catch, pass, shoot, dunk, tackle, kick, swing, signal…
    var kind: UInt16                // sport's action id
    var at: PTime; var attack: Double; var release: Double   // envelope (fixes F9: holds always release)
    var toward: SIMD2<Double>
}

struct Cue: Equatable, Sendable {   // timed presentation events
    enum Kind: Equatable, Sendable { case stamp(String), banner(String, tone: UInt8, confetti: Bool), flash(UInt8, SIMD3<Double>),
                                     net(strength: Double), status(String?), celebrate(String), scored(String), replayIn, replayOut }
    var at: PTime; var until: PTime; var kind: Kind; var source: Provenance
}

struct ActorState: Equatable, Sendable {
    var id: ActorID
    var position: SIMD2<Double>, velocity: SIMD2<Double>, acceleration: SIMD2<Double>
    var rig: RigTrack.Carry         // phase, heading, speed, planted and swinging steps (§5.5.6)
    var overlays: [Overlay]         // in progress at the splice
    var opacity: Double
}

struct CameraState: Equatable, Sendable {
    var frame: CameraFrame; var yaw: Double
    var velocity: SIMD4<Double>     // x, y, log-span, yaw
}

struct WorldState: Equatable, Sendable {
    var at: PTime
    var actors: [ActorState]        // sorted by id
    var ball: BallSegment           // the segment in progress, parameters intact
    var camera: CameraState
    var cues: [Cue]                 // live at `at`
}

struct Plan: Equatable, Sendable {
    let revision: UInt32
    let start: PTime                // the splice time c
    let horizon: PTime
    var keys: [ActorID: [Key]]
    var overlays: [ActorID: [Overlay]]
    var presence: [ActorID: [ClosedRange<PTime>]]   // on the field (walk-ons and walk-offs, never pops)
    var ball: [BallSegment]
    var cameraSubjects: [CameraSubjectSpan]         // what the operator frames, by phase (§5.6.2)
    var cues: [Cue]
    var notes: [PlanNote]           // catch-ups, overspeeds, merges: what the bench reports
}

struct ActorTrack: Sendable {
    let id: ActorID
    let start: PTime
    let xy: ContiguousArray<SIMD2<Float>>   // 60 Hz
    let rig: RigTrack
    let overlays: [Overlay]         // sorted by `at`
    let presence: [ClosedRange<PTime>]
}

struct BakedPlan: Sendable {
    let plan: Plan
    let tracks: [ActorTrack]        // sorted by id
    let camera: ContiguousArray<SIMD4<Float>>       // 60 Hz: x, y, span, yaw
    let tiers: [(range: Range<PTime>, fps: UInt8)]  // 0, 30, 60
    func state(at t: PTime) -> WorldState           // the splice source (exact)
}

struct PlanChain: Sendable {        // what the view samples
    private(set) var plans: [BakedPlan]             // spliced; plans[i] valid from plans[i].plan.start
    func sample(_ p: PTime, into scratch: FrameScratch)   // allocation-free
    mutating func splice(_ next: BakedPlan)         // drops plans wholly before p − 2 s
}

// MARK: - One sport

protocol SportGrammar: Sendable {
    associatedtype Play: Equatable & Sendable
    associatedtype Kind: Hashable & Sendable
    associatedtype Role: Hashable & Sendable
    associatedtype Phase: Hashable & Sendable
    associatedtype Outcome: Hashable & Sendable

    static var limits: MotionLimits { get }
    /// §5.1: anchors for the unfrozen suffix (PAVA with this sport's gap table).
    static func anchors(_ plays: ArraySlice<TimelinePlay<Play>>, frozen: [String: Anchor]) -> [String: Anchor]
    /// §5.2: grouping, linking, inference.
    static func sequence(_ plays: ArraySlice<TimelinePlay<Play>>, anchors: [String: Anchor], cast: Cast, hints: [Hint],
                         prior: SequenceWindow<Self>?) -> SequenceWindow<Self>
    /// §5.4: keyframes from the on-screen state at `start`.
    static func choreograph(_ window: SequenceWindow<Self>, from state: WorldState, horizon: PTime, seed: UInt64) -> Plan
    /// §5.5.6: what each actor faces when not travelling (ball, rim, man, plate).
    static func facing(_ actor: ActorID, in plan: Plan) -> (PTime) -> RigFacing?
}

/// The generic engine: pure, deterministic, `nonisolated`.
enum TheaterEngine<G: SportGrammar> {
    static func plan(_ snapshot: TimelineSnapshot<G.Play>, cast: Cast, hints: [Hint], from state: WorldState,
                     prior: SequenceWindow<G>?, seed: UInt64) -> (Plan, SequenceWindow<G>)
    nonisolated static func bake(_ plan: Plan, from state: WorldState) async -> BakedPlan   // quintic, limits, collisions, rig, camera
}

// MARK: - The stateful part (main actor, event-driven)

@MainActor @Observable
final class TheaterDirector<G: SportGrammar> {
    private(set) var chain = PlanChain()            // the only observed property: changes on a splice
    @ObservationIgnored private var window: SequenceWindow<G>?
    @ObservationIgnored private var baking: Task<Void, Never>?
    @ObservationIgnored private var visible = true

    func timelineDidChange(_ snapshot: TimelineSnapshot<G.Play>, cast: Cast, hints: [Hint], clock: PresentationClock)
    func clockRegimeDidChange(_ clock: PresentationClock)   // stall, catch-up, jump
    func setVisible(_ seen: Bool)                           // plan always, bake when seen (§8.4)
    func flip()                                             // 180° yaw orbit (§5.6.3)
    func jump(_ reason: JumpReason)                         // the only discontinuity API
}

// MARK: - The view (one generic shell; each sport supplies painters)

protocol TheaterPainter {
    associatedtype G: SportGrammar
    static func court(_ context: inout GraphicsContext, camera: CameraFrame, yaw: Double, size: CGSize, ink: TheaterInk)
    static func actors(_ context: inout GraphicsContext, frame: FrameScratch, size: CGSize, ink: TheaterInk)
}

final class FrameScratch {          // reused every frame; capacities reserved once; never observed
    var p: PTime = 0
    var camera = CameraFrame.rest, yaw = 0.0
    var figures: [PosedFigure] = []             // removeAll(keepingCapacity: true) each frame, capacity 32
    var order: [Int] = []                       // depth order, insertion sort
    var ball: BallSample?
    var cues: [Cue] = []
}
```

**How it plugs in:**
- The game page owns the `GameTimeline` (BROADCAST) and one `TheaterDirector<Sport>`.
- On `timeline.revision` changes the page calls `director.timelineDidChange(...)`, through an `onChange`, never polling.
- The theater view is `TimelineView(tierSchedule)` → `p = clock.p(at: context.date)` → `director.chain.sample(p, into: scratch)` → two Canvases (§5.7).
- Scoring slides, celebrations and the menu bar read cues from the chain (`Cue.scored`) or from BROADCAST's presented state; they never rebuild scripts.

---

## 11. Migration: keep, replace, delete

### 11.1 New files

```
Sources/Scoreline/Theater/Engine/   TheaterEngine.swift   (types §10)      AnchorSolver.swift (PAVA, stretches, gaps)
                                    Sequencer.swift       (generic rules)  CastTracker.swift
                                    Choreographer.swift   (backward planner, ambient, compression, defense tracker)
                                    Motion.swift          (quintic, limits, retiming, collisions, bake)
                                    BallPhysics.swift     CameraOperator.swift   PlanChain.swift
                                    TheaterDirector.swift TheaterView.swift      FrameScratch.swift
Sources/Scoreline/Theater/<Sport>/  <Sport>Grammar.swift  (tables §7)      <Sport>Clips.swift (refactored builders)
                                    <Sport>Painter.swift  (court + actor layers, from today's Frame views)
Tools/TheaterBench/ (or a Tests helper)                   bench + metrics + video
```

### 11.2 Shared files

| File | Keep | Replace | Delete |
|---|---|---|---|
| `TheaterRig.swift` | All of it: rig, gait, IK, figure, poses | `RigTrack.init` gains a samples-based form and `Carry` (§5.5.6) | — |
| `TheaterBridge.swift` | `match` (identity, then kind, then distance, then untangle) as `Cast.rematch` for anonymous actors; `moved`, with a fastest-mover cap added (fixes F4 and M6 while the bridge lives) | `plan`/`tracks`/`pose`: superseded by the splice | `TheaterDelays` (BROADCAST Phase A); the rest once all four sports run the engine |
| `TheaterKit.swift` | Draw primitives, `CameraFrame.fitting`/`clearing`, `CameraRig.blend`, `headroom`, type, banner, stamp, well, bursts | `CameraRig.follow` / `CameraFollow` / `CameraPath` → `CameraOperator` (stateful, carries velocity, adds yaw) | The duplicate followers; `TheaterKit.hold` (no holds in a continuous world) |
| `PlayCamera.swift` | The baseball framing families as subject rules | Its spring copy → `CameraOperator` | `CameraTrack` once baseball migrates |
| `TheaterNames.swift` | All of it | `TheaterCast` built from the session `Cast`, so tags are stable across sequences | — |
| `TheaterStatus.swift` | All of it | Status text from the phase; heartbeat gains the delay option and a visibility gate | — |
| `ReplayWell.swift` | The well, the controls, the pointer tags | Content: the engine on a historical window (the play's sequence, from the sequence start − 3 s to the outcome + 2 s) | Per-sport `ReplayTake` once each sport migrates |
| `ScoringSlide.swift`, `ScoringSlideView.swift` | Slides | `SlideTheater.climax` → the plan's `Cue.scored` | Script rebuilds in `SlideTheater` |
| `PlayScript.swift` `Move`/`Ease` | `Ease` curves for overlays | `Move` polylines → quintic keys (fixes B9) | `Move` once every sport migrates |

### 11.3 Basketball (Phase 1)

| File | Keep | Replace | Delete |
|---|---|---|---|
| `BasketballScene.swift` | The parser, the types, `replays` (as replay eligibility) | Links (`leadIn`, `follows`, `missBefore`, `stealBefore`, `reboundAfter`, `andOneFouler`, `freeThrows(after:)`) feed `BasketballGrammar`'s linking | — |
| `BasketballFlow.swift` | `BasketballStatus` (phase → tag words) | `BasketballFlow.rest` → the grammar's sequencing table (§7.1) | `BasketballQueue` (catch-up dropping, estimates, budget) |
| `BasketballScript.swift` | `Hoops`, `HoopProjection`, `RigLens(h)`, `BasketballStamp`; the builders as clips: `halfCourt`, `driveToRim`, `cut`, `alleyOop`, `jumper`, `finishAtRim`, `putback`, `transition`, `freeThrow`, `shoot(from:to:)`, `throughNet`, `jump`, `guardSpot`, `passTime` → `BasketballClips.swift` | Clip entry from a `WorldState` slice instead of `lineUp`; `approachPace` becomes the drawn-speed calibration in `limits` | `lineUp` as a start; `stretch`; the per-script `shoot()` camera; `measureBodies` (moves to the bake); `BasketballScript` as a type once the painter reads `FrameScratch` |
| `BasketballBeats.swift` | `HoopsEnds`; `Carom`, `rebounder`; the beat builders as clips (miss, free throw, rebound, turnover kinds, whistle, jump ball); `huddle`, `whistle` (official only while acting); the half-court `sets` | `Rest` and its builders → ambient and dead-ball choreography in the grammar | `Lineup` and `seen(by:)` (absolute frame; fixes B4); `place(_:near:)`/`setUp` fallbacks (fixes B6); `beatCamera`/`restCamera` |
| `BasketballTheater.swift` | `HoopsCourtLayer` (→ court painter, its polylines pre-projected per camera); `BasketballFrame`'s posing and drawing (→ actor painter); `BasketballCelebration(Stage)` (triggered by cues) | `BasketballTheater` → `TheaterView<BasketballGrammar, BasketballPainter>` | `BasketballStage`, `BasketballScripts`, `.id(now.key)` transitions, `finish()`/`breathe()`/`advance()` |
| `BasketballFeed.swift` | The lane, `possession`, `streaks`, `runs` | `theater` → `GameTimeline` (BROADCAST); `replaying` → cue | — |

### 11.4 Football, soccer, baseball (Phases 2–4)

**Football.**
- **Keep:** `FootballScene` (add "No Huddle", `clock.value`, PAT unit names, college clock); the builders (pass, rush, sack, kicks, penalty, flags, turnovers) as clips; formations and personnel; `nextHash`; field facing; stoppage idles as dead-ball choreography.
- **Replace:** `settle()` with the aftermath plus the next walk-up.
- **Delete:** `FootballStage`'s replay/idle/hold queue; `FootballIdle.make`'s coin-flip strong side; `follow()` cuts.
- **Football's 1.3× pace stays** (the user's preference, 2026-10-29). The snap is an *inferred* anchor, so plays are laid out at real speed and played 1.3× slower, with the snap moved earlier so the dead-ball anchor stays exact. Nothing else is slowed or sped up.

**Soccer.**
- **Keep:** the Opta mapping, keeper and dive logic, the mark solver (as the off-ball tracker's constraint layer), shapes (unified, §7.3), event semantics, celebrations.
- **Replace:** `buildUp` retelling with live continuous coverage. The build-up pacing floors (`beats`/`least`/`flight`) become the AnchorSolver's gap table.
- **Delete:** idle re-keying by cell, `ScriptCache.idle`, the fixed event beats, the reverse take inside live coverage (it moves to replays).
- **In-play coverage runs at real time** (the data fixes it to the second); slow motion is for replays.

**Baseball.**
- **Keep:** Statcast kinematics, `shaped()`, `BattedFlight`, `handling`/`official`/`sequenceRuns`, `coverer`, the beat vocabulary.
- **Replace:** `PlayBeat.timeline`'s merge, by `startTime` anchoring and pitch-attached runner events; `settle` and the fades, by walks.
- **Delete:** `PlayBeat.catchUp`, `PlayStage`'s preemption, `ScriptMemo` in `body`.
- **Pace is a decision for the user.** Today's compressed play pace was approved ("baseball's speed is fine", 2026-10-29), while real time is now available: runners at Statcast sprint speed, the trot at ~20 ft/s. Phase 4 renders both on the same plate appearances. The default stays today's pace until the user picks. Since nothing logs intra-play times, either is consistent with the anchors, and the bench applies speed limits scaled by the pace factor.

### 11.5 Web (`web/src/data/theater/`, `web/src/data/mlb/`, `web/src/features/game/*/theater/`)

The web port mirrors the Swift files almost line for line. Every break in §2 exists there too. **Don't port incrementally.** After each sport's Mac phase is accepted by the user, port its engine files mechanically (§13), and delete the web equivalents of what §11.3–11.4 delete: `theaterDelays.ts`, `basketballFlow.ts`'s queue, `footballTheater.ts`'s queue and holds, `soccerIdle.ts`'s re-keying, and the MLB `catchUp`.

---

## 12. Phases

Each phase ships on its own, is verified by the bench gates (§9.2) and a video, and is released (Scoreline releases every verified change).

**Phase 0: the shared core.** Depends on BROADCAST's timeline and clock (Phase A), and runs alongside it.
1. **Measure the baseline:** today's per-frame cost and CPU per sport (§8.5), and today's continuity metrics on the bench, running today's scripts through an adapter. This gives the "before" numbers for every gate.
2. **Engine types** (§10), **AnchorSolver**, **Motion** (quintic, limits, retiming, collisions, bake), **CameraOperator** with carried state and yaw, **PlanChain**, **TheaterDirector**, the **TheaterView** shell, `RigTrack.Carry`.
3. **BROADCAST Phase A's "generalized bridge" is implemented as the splice:** today's per-play scripts become *clips* placed at their anchors, and every hand-off is a splice from `WorldState`. Build it this way so Phase A's work isn't thrown away.
4. The **bench** with all metrics and video. Fixtures.
- **Exit:** hard cuts (B1, F5, F6, M7, S11) at 0 on the fixtures with today's clips; `footSlip` 0 across splices; the bench deterministic.

**Phase 1: basketball.**
1. **1a.** CastTracker (starters, subs, validation); `BasketballGrammar` sequencing and inference (§7.1); the absolute court frame; camera yaw orbit. This removes B4, B5 and B6.
2. **1b.** Clips refactored from today's builders; backward planner; half-court ambient with sets; defense tracker; rebound battles; inbound, outlet and break connective beats.
3. **1c.** Dead-ball choreography at real durations (free throws with lane alignment, timeouts, subs at the table, period ends); fast-lane stop hint ("WHISTLE"); late dead-ball attachment.
4. **1d.** Instant replays in dead windows; Reduce Motion key-state mode; frame tiers; two-layer rendering; delete `BasketballQueue` and `BasketballStage`.
- **Exit:**
  - all §9.2 gates on the NBA fixtures and the weekend's full recordings;
  - `decisiveError` p95 ≤ 0.05 s;
  - whole-game CPU average ≤ 2.5%;
  - the video (miss, offensive rebound, putback, made three back the other way) reviewed by the user.

**Phase 2: football.** Grammar (§7.2), identities per drive, walk-up into the next formation with pre-snap shifts for late knowledge, real stoppage durations, unit changes, kick walk-offs with the yaw orbit, release envelopes.
- **Exit:** gates on NFL and college fixtures; F1–F12 gone; CPU ≤ 1.5% average.

**Phase 3: soccer.** Continuous ball from located entries, unified shape tracker, restarts held until their entries, kickoff synthesis after goals, red cards and subs (`addedClock`), VAR as a quiet correction, replays with the reverse angle.
- **Exit:** gates on the soccer fixtures; S1–S13 gone; CPU ≤ 4% average.

**Phase 4: baseball.** `startTime` anchoring with calibration, pitch-attached runner events, walks instead of fades, on-deck walk-ups, real dead-time choreography, the pace decision (§11.4), the camera family decision (§7.4).
- **Exit:** gates on the World Series fixtures; M1–M11 gone; CPU ≤ 1.0% average.

**Phase 5: web.** Port per sport after the user's verdict on its Mac phase (the standing practice: defer web ports until the Mac version is reviewed).

### 12.1 Phase 0 as built (mac/choreo)

What Phase 0 built differs from the plan above in these places. The code is the reference; this section says where and why.

**Names.** Four names clashed with existing types, so they changed: §10's `Anchor` is `PlayAnchor` (SwiftUI's `Anchor`), `Key` is `MotionKey`, `Motion` is `TheaterMotion` (the app's motion tokens), and `Placement` is `ClipPlacement`. Engine files are flat, with a `Theater` prefix: `TheaterEngine`, `TheaterAnchors`, `TheaterMotion`, `TheaterCamera`, `TheaterClips`, `TheaterPlanChain`, `TheaterFrameScratch`, `TheaterDirector`, `TheaterView`. Each sport's adapter sits beside its theater: `BasketballClips`, `FootballClips`, `SoccerClips`, `BaseballClips`.

**The theater's own time (§4.2, §4.5).** The chain is indexed by the theater's time `T = p + shift`, not by p.
- While p follows wall time, so does T.
- While p holds (a stall) or eases (a stretch, a catch-up), T keeps running on wall time and the shift grows. Plays at or past the hold wait (`deferFrom`).
- A skip moves p but not T: the theater keeps playing the stoppage on its own time.
- A declared jump moves T with p.
- The director re-plans on a hold, a resume, a skip or a jump.
- Each placement records the shift it was placed with, so its decisive moment lands when p reaches its anchor.
- The commit point snaps up to the covering plan's 60 Hz grid, so the camera state at `c` is exact.

**The plan's shape (§10, §12 Phase 0).** Phase 0 plans are placements of today's scripts as clips, not §10's keys and overlays. That Plan is Phase 1's. A `ClipPlacement` carries:
- the clip, its time offset, and the splice start;
- the cast (the clip's figures to the engine's men);
- each man's travel path and join time;
- the men leaving (they fade where they stand) and the men entering (they fade in where the clip has them);
- the clip time the travel lands at (`entry`);
- the ball across the splice;
- the play, its anchor, any slip, the shift it was placed with, and the plays its telling covers.

One generic planner, `TheaterPlanner`, places every sport's clips. A `ClipSequencer` supplies today's running order for the sport, so nothing is passed over.

**Planning reads `plays + pending`.** Phase A's watermark runs only about 4 s ahead of p in steady state (it is built to). Planning from it alone would leave no lead-in. Pending plays give 20–40 s of lookahead, and an insertion before one simply splices again.

**AnchorSolver (§5.1).**
- A stopped-clock cluster is placed backward from its restart. The restart is the timeline's `eventBounds` upper bound, else the next stretch's offset plus the stop's clock.
- `restartAfter` is 0 for a live play (the rebound restarts the clock) and 1 s otherwise.
- The gap from a miss to its rebound is `max(0.8, 0.45 + 0.022·d)`, measured from rim contact; the formula as written counted the flight twice.
- Free throw to free throw is 6 s, the physics floor (Phase A places unknown ones 14 s apart).
- The solver reads each play's `eventBounds`. Without them, the 2:45 Q4 challenge cluster was anchored at its stamp and slipped by two minutes.

**The splice (§4.5, §4.6).**
- **Travel pace.** A man travels as slowly as the time allows: a jog's pace and 60% of his push when there is time, his full limits only when there isn't, and a slip (a declared catch-up) only when not even that fits.
- **Late plays join mid-clip.** Before slipping, a late play joins its clip as it moves: at the first moment everyone can make it, up to `lead` before the decisive moment and never mid-flight (§4.6 row 2, for clips that can't re-steer).
- **Travel always lands on time.** A cruise that can't fit even at a sprint falls back to one quintic that arrives on time; the feasibility search then finds the time it really needs.
- **The ramp includes the turn.** The first ramp's length covers the whole change of velocity, including turning onto the line, not just the change of speed.
- **Pull up, then go.** A man running the wrong way, or too fast to turn, brakes within his limits first.
- **Overspeed isn't carried into travel.** A travel starts with his acceleration clamped to his limits; position and speed carry over exactly. Feasibility allows his inherited speed (he may only slow from it).
- **No reappearing.** A man matched at the earliest splice who has faded by its start comes back as a newcomer: he fades in rather than reappearing somewhere else.

**Retiming (§5.5.4), as built for today's clips.**
- Today's scripts are re-synthesized per figure (`ClipPaths`). Their moves' vertices, at today's timings, become keys, with each ball contact a hard key. Quintics through the keys carry each man C².
- A run between two keys where he is at rest or pinned gets the time it needs when he can't make it: he leaves earlier from a stand, or arrives later into a stop. Ball contacts never move this way.
- A clip's own time then stretches wherever its script still asks too much (`ClipWarp`): the script runs slower there, eased in and out. Only the decisive contact is data; the moments before it are free to move apart in order.
- Short flights (under 1.5 s) slow at most 1.25×. Long ones (a kick's hang) stretch with everything.
- The clip simply begins earlier by what it gained before its decisive moment; the planner still places that moment at its anchor.

**Feet (§5.5.6).**
- `RigTrack(continuing:)` takes a `Carry`: the gait phase, the heading, the speed, both feet's current steps, and a swinging foot's landing. A `history` pre-roll is used for smoothing.
- In every sport's pose, a planted foot stays planted once the gait weight passes 0.5. The pose's stance blend used to slide it.
- `footSlip` is reported at the rig (the spec's definition) and as drawn.

**The camera (§5.6.1).** The operator tracks the goal with velocity feed-forward (critically damped error dynamics): no lag inside a clip, carried velocity across splices.

**Slides (§5.6.5).** The page's `TheaterCues` holds each directed theater's `Cue.scored` on the theater's time. `SlideTheater.directed` reads it, so the slide lands with the decisive frame. `TheaterDelays` is deleted.

**One scheduler (one truth on p).** The theater's plan is the only schedule; the timeline's own is a fallback.
- Every plan gives each play still to tell a moment on the theater's time (`Plan.decisive`). A placed play's moment is where its decisive frame is drawn. The rest (an attached substitution, a touch that changed nothing) sit at the solver's anchor, held between the plays around them. The moments are monotone in timeline order.
- A moment the court reached before a plan's splice keeps its time in every later plan (the past is fixed).
- The director maps each moment to p through the clock: the p the clock will show as T reaches it. It hands these to the timeline (`setAnchors`), with the plays the plan was made from. They are the tell times for every consumer: the score, the lists, the slides and the court.
- The timeline's event-time schedule and its order guard apply only to a play with no anchor. The guard never holds an anchored play; when it would have, that's logged (`guardOverrides`).
- A play that arrives after the newest plan was made (a late arrival) waits for its anchor; the fallback never tells it first. The next plan puts it at the earliest moment the court can tell it (a declared catch-up), and every later play still to tell goes after it. If no anchor comes within 5 s of p (a theater that stopped planning), the fallback tells it, and that's logged (`uncoveredTells`).
- Plays past a hold get no moment until the plan after it, and wait for it the same way.
- The director plans whether or not the court is on screen; only the bake waits for it to be seen (§8.4).

**Phase 0's world frames.**
- Basketball: a half-turn about (47, 25) between the baskets; world yaw −30° and +30°.
- Football: a half-turn about (0, 150), with a 120° orbit.
- Soccer and baseball: the field as drawn.
- Soccer's and baseball's frames gain a world mode: the clip in charge's figures where the engine has its men, the others as their own kit's extras.

**Measurement (§8.5, §9).**
- The bench builds with `-Osize -wmo` (`SCORELINE_BENCH_FLAGS`); unoptimized numbers are meaningless for the generic engine.
- `hardCuts` counts discontinuities: a frame's move past 1.5× the cap and past 2.5× the man's own move the frame before. A sustained superhuman run is counted as a glide (`speedViolations`, `teleportMax`), not hidden.
- Overspeed is reported by cause: splice travel (late joins, carried overspeed), each clip kind's own motion, referees, newcomers.
- The video release tag is lowercase `videos`.

**ESPN placeholders.** "No Shot (Default Shot)" (type 91) parses as a generic jumper from its coordinate (data law 2).

**What Phase 0 measured (the bench at `-Osize -wmo`, 60 Hz on wall time, the real lanes at the app's cadence).**

| | NBA 401909285 Q4 (real) | NFL 401873009 (synthetic arrivals) | Soccer Villa v City (synthetic) | MLB WS3 (synthetic) |
|---|---|---|---|---|
| hardCuts (today → engine) | 28 → **0** | 2 by today's rules (F6) → **0** | 0 → **0** | 0 → **0** |
| crossfades | 87 → **0** | every hand-off → **0** | every cell change → **0** | every hand-off → **0** |
| teleportMax (≤ 1.15) | 12.9× → **0.90×** | **1.27×** (gate missed) | **0.91×** | **1.01×** |
| speed over the sprint (≤ 0.5%, max ≤ +12%) | 0.37%, +1347% → **0.00%, +1%** | **0.16%, +40%** (max missed) | **0.00%, +0%** | **0.00%, +1%** |
| accel over the limits (≤ 1%) | 1.86% → **0.06%** | **0.20%** | **0.27%** | **0.00%** |
| footSlip at the rig (0, across splices too) | 251 mm → **0** | **0** | **0** | **0** |
| decisiveError on time (p95 ≤ 0.05 s, max ≤ 0.25 s) | (today: 12.4 s p50 jitter) → **0.040 s, 0.071 s** | **0.026, 0.040** | (one goal, late) | **0.023, 0.040** |
| declared catch-ups (late arrivals) | 17 (p50 8.2 s) | 12 | 3 | 12 (p50 1.7 s) |
| declared fades (a run no one could make) | 0 | 59 in 7 clips | 0 | 0 |
| determinism (two runs) | identical | identical | identical | identical |
| frame cost p99, sample + pose + Canvas (≤ 2.3 ms) | 0.79 → **0.74 ms** | 1.31 → **1.24 ms** | 0.91 → **0.71 ms** | 0.75 → **0.52 ms** |
| allocations, sample + pose (gate 0), p50/p99 | 38/68 → **2/61** (gate missed) | 105/233 → **3/181** | 76/110 → **10/58** | 60/134 → **5/23** |

On the recorder's live recordings (`--real`), the NBA's second game (401909286, 4.4 min so far) meets every gate. The first real Premier League match (401879248, 121 min recorded at the time) runs with 3 hard cuts (2 at a splice, 1 inside a clip) and a 1.07 m worst step, across the half-time's 5-minute hold, the declared jumps around it, and a long ball-going-round clip spliced late. Those are the next soccer items. Synthetic Villa v City meets every gate.

The football misses are inside today's FootballScript: a defender credited with the tackle is sent across the field during a 0.6 s pass. The clip's time stretches as far as the ball's flight allows (2×); past that he fades through the run (declared and counted), and what's left is his fade's edges. Phase 2's grammar (identities per drive) replaces it. Allocation-free posing needs the painters to write into the scratch; that waits for Phase 1's two-layer rendering.

**The court's acceptance check (Phase A's offscreen page, extended).** The check runs the real DetailView on the NBA recording, at the app's cadence, with the Live View open. It runs on a virtual clock and waits for plans in flight, so a plan takes no virtual time. Debug plans at -Onone take up to 13 s real; a release build's take far less. All seven checks pass:
- At each change of the presented score, the court's frame at that step is the scoring play's decisive frame, and the step before it hadn't reached it.
- At every step (395), the court's newest decisive play is the timeline's newest told play.
- The late arrivals (666, the free throw 670 and 674, which came up to 20 s after their event times) wait for their anchors and are told with the court. None is told by the fallback.
- One anchored play (683) was told where the order guard would have held it; that's logged.
- A page opened mid-run with the Live View folded: the director plans unseen, and all six plays told while folded are told at its anchors. When unfolded, no play's tell time moves.

---

## 13. Web portability

The engine is built to port mechanically:
- **Pure functions over plain data.** Engine files contain no SwiftUI, no `Date()`, no `Task` inside the stages, no globals, no reference types except `FrameScratch`, which is a view concern. In TypeScript: plain objects and `Float32Array`/`Float64Array` for tracks.
- **Decisions are integer- or hash-based.** Templates, seeds (`SplitMix64` already exists in both, `splitMix64.ts`), matchups (the Hungarian method with deterministic tie-breaks by `ActorID`), rule tables. These port bit-exact.
- **Continuous math is closed-form or contractive.** Quintic Hermite segments, PAVA, ballistic flights, critically damped trackers (defense, camera). Small libm differences between Swift and V8 (`exp`, `sin`) don't amplify in contractive filters. Avoid any open-loop integration whose error grows (no free-running steering simulations).
- **A golden test per sport:** the Swift bench writes the baked tracks of a fixture to JSON; the TS test bakes the same fixture and compares within 1e-3 field units (positions) and 1e-4 s (anchors). Decisions must be identical.
- **Same tables:** `<Sport>Grammar.swift` tables are data; the TS port copies them verbatim (ideally generated from one JSON file read by both; consider it once two sports are done).
- **Rendering:** the web draws on canvas with requestAnimationFrame. Apply the same tier schedule (a frame callback that skips frames at 30 fps tiers and stops at tier 0), the same cached static layer (an offscreen canvas redrawn only when the camera moves), and no allocation in the sampler.

---

## 14. Risks, open questions, and what must be tuned

### 14.1 The biggest risks

1. **CPU of continuous animation.** The budget (§8.1) is unproven. Mitigations, in order: tiers (30 fps ambient), the static court layer, allocation-free sampling, `rendersAsynchronously`, `-O`. If live play still exceeds 4% at 30 fps, the fallback is "ambient at 20 fps with a short motion blur on the ball", or sparser ambient (fewer off-ball moves). That decision should be made by the user on video and numbers, not by us silently.
2. **The quality of inferred play.** Most of what's on screen is synthesized (data law 5). If the backward-planned ambient looks generic, the broadcast feels like a screensaver. Mitigations: data-driven templates, sets biased by tonight's shot zones, matchups by role, and review on video at 1× and 0.5× with fresh eyes the next day. This is where most of the tuning time will go.
3. **Event-time semantics are unverified for football and baseball.** Does NFL `wallclock` mark the snap or the dead ball? What does statsapi `startTime` mark? The weekend's recordings plus a TV broadcast decide it (§3.2, §7.4). Until then the anchors for those sports are provisional.
4. **Arrival lag for football and soccer is unmeasured.** The lead-ins and D for those sports wait on the weekend's recordings. The NBA sample is small (one 4th quarter); re-run on full games.
5. **Late dead-ball kinds and the fast-lane hint.** Inferring "WHISTLE" from a fast-lane clock stop depends on the scoreboard's ~11 s poll granularity and its mapping to p. Validate on recordings before shipping; it can launch behind a flag.
6. **Replans while ambient is mid-action.** A replan must never yank a pass already in the air. The commit point covers in-flight segments, but contradictions (a removed play) can still force a visible re-route. These are rare; log and review them.
7. **Scope.** This is a new engine. The phasing keeps each step shippable, and Phase 0 is valuable even if later phases slip: zero hard cuts with today's clips, and the bench.

### 14.2 Open questions for the user

- **The delay in the heartbeat:** show "Live · 41 s behind", or keep it hidden?
- **Instant replays in dead time:** on by default? (Recommended: yes, for marquee plays only.)
- **Baseball's play pace:** today's approved pace, or real time? (Decide on video in Phase 4.)
- **Baseball's pitch → ball-in-play camera change:** a declared cut, as TV does, or a continuous pull-back?
- **Officials:** the "only while acting" rule stays. In continuous coverage, should a referee trail the play at a distance during live basketball (as on TV) while staying out of the way? (Recommended: no, keep the rule.)

**The user's decisions (2026-10-31, morning):**
- **Delay policy:** sequence and fluidity over liveness. Use the setting where plays are rarely late (NBA q 0.95, about +27 s over today's score; soccer about +20 s), and apply the same principle to each sport as it's measured. In the user's words: "the key thing is not necessarily being as live as possible, it's the fluidity… the sequence of plays is actually correct."
- **Show the delay:** on hover only. The live dot stays clean; hovering shows about how far behind live (for example "About 55 s behind live").
- **Instant replays in dead time:** yes, big plays only (marquee). They must be unmistakable:
  - the banner says it's a replay *and* names the stoppage ("Replay · Timeout");
  - the replay plays in slow motion, as TV does (§5.6.4's slow-motion window becomes the default treatment, not an option).
- Baseball pace and camera, and officials: unchanged (decide baseball on video in Phase 4; keep the officials rule).

### 14.3 Tuning list (all against recordings on the bench, and by eye on video)

- AnchorSolver gap tables per sport (§5.1, §7).
- Lead-in horizons per kind (inputs to D).
- Motion limits per role (§5.5.2), including the drawn-height calibration.
- Defense tracker ω, help fraction and close-out timing (§5.4.5).
- Ambient link lengths, micro-action spacing, holding-pattern easing (§5.4.3–5.4.4).
- Camera framing values per phase, lead room, push-in timing, yaw ω, hysteresis and dwell (§5.6).
- Frame-tier thresholds (§5.6.7) against the CPU budget.
- Replay eligibility and slow-motion window (§5.6.4).
- Catch-up thresholds (1.5 s micro catch-up, §4.6).
