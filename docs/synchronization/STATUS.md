# Broadcast and choreography integration

Updated November 1, 2026. **Scoreline 1.0.31 (33) is installed locally and remains unpublished.** Product source `50562aa`, binary SHA-256 `0b7e3bd4b6751472edf23aaf367fce9b4d6823ddf5d9c135af5c8268178cc387`. Soccer, football, basketball and baseball now share the original soccer-inspired compact 60-point timeline design and a common time domain/selection with odds. Football retains one scoring rail. Timestamped soccer now participates in linked odds inspection and retains existing play-ID focus; minute-only soccer uses the original fallback with an explicit unavailable-timestamps notice.

The 49 focused checks and full optimized Apple silicon build passed. Installed soccer, NFL and NBA selection/reset/visual checks passed; following/module preferences are preserved. Native acceptance rendered 38 cases, with 251 strict passes and 101 retained OCR/helper capability failures classified in the [current evidence](../odds-history/evidence/final-test-scope.json). Manual visual review supplements those failures. The historical 3,229 full-suite pass is scoped to `54cbc7b`, not the new source. No hover-only verification or new animation/FPS claim is made.

The broader animation report and its approximately 32 ms status-transition callback gaps remain open. No old release assets should be published. See the [current odds/history handoff](../odds-history/2026-11-01.md).

Published baseline: [Scoreline 1.0.30](https://github.com/lame-o/scoreline/releases/tag/v1.0.30), universal build 32, previously installed and verified locally. It includes the 1.0.29 integration and the [presentation follow-up](../presentation/2026-11-01.md) for halftime state, nonrepeating break animations, frame cadence, and team colors. The integration completes the interrupted **BROADCAST Phase A + CHOREOGRAPHY Phase 0 integration**, together with competition discovery, following and the Carabao replay/bracket correction. Later sport grammar, renderer and web phases remain separate work.

The integration measurements below describe 1.0.29. The 1.0.30 presentation follow-up had 3,035 passing native checks, 12 passing page checks, repeated NFL/NBA recordings, and frame-cost evidence in `../presentation/`. These historical receipts do not validate the pending 1.0.31 corrections. Later phases remain open as listed below.

## Preserved inputs

- Release 1.0.28: `9d842ed`.
- Claude clock branch: `874b965` (`mac/broadcast`).
- Claude choreography branch: `a476360` (`mac/choreo`).
- Thirteen interrupted choreography edits preserved exactly in `9213d19`. Original patch SHA-256: `9b5c950c6bbb78e1c18ee5cccc39b2537f35089ece82947bc98c89d1a62e4350`.
- Competition/following/replay corrections: through `c0e98b7`.
- Combined branches: `5ef29b8`. Integration corrections and harnesses: `5958178`. Universal release build: `dfecd27`.

The original Developer checkouts were not reset, cleaned, rebased or updated. The thirteen-file patch was rechecked byte-for-byte. Local backup refs also retain the original unpublished history; only the reviewed integration is intended for publication. Both alert paths retain team mute preferences; soccer history retains its actual competition; the removed floating chart panel stays removed.

BROADCAST.md and CHOREOGRAPHY.md are the recovered original specifications. Their historical measurements are not new verification. INTEGRATION.md explains the corrections and reproduction commands.

## Verification of the 1.0.29 integration

- **3,010 native checks passed, zero failed**, plus successful DEBUG application typecheck. Includes figure pixel regressions, competition routing, following migration, replay construction, bounded clock history, cache invalidation and actual approach protection.
- **10 actual DetailView checks passed, zero failed**, including Vision verification of rendered score pixels. Scores and decisive scoring frames agreed; six plays told while folded retained their anchors; unfolding moved no tell times; at most one plan was outstanding. Preferences were isolated and HTTP blocked.
- Six recording cases ran twice with identical hashes. All reported zero non-declared hard cuts and zero crossfades. NBA, soccer and college use full real recordings; NFL uses a fixed 40-minute real Cardinals–Cowboys capture; baseball uses explicitly synthetic fixture arrivals.

| Recording | On-time decisive p95 / max | Repeated hash |
| --- | --- | --- |
| NBA `401909896` | 0.040 / 0.080 s | `07e0d7435a2b1680` |
| College `401859185` | 0.040 / 0.040 s | `3a83161538ef92fb` |
| College `401856842` | 0.040 / 0.060 s | `785e7163ae26784f` |
| NFL `401873024` real capture | 0.040 / 0.040 s | `a1d18af11efcd1ac` |
| Soccer `401879249` | No on-time decisive sample; catch-ups separate | `a0aaefdd60581b85` |
| MLB WS3 fixture | 0.040 / 0.040 s | `087d0a262d5748d5` |

NBA's largest on-time error fell from 0.880 s in the preserved integration baseline to 0.080 s. Maximum sprint excess is +10%, continuous displacement ratio 0.98 times the cap, and rig foot slip zero.

Optimized measurements use `-Osize -wmo`. Real soccer main-actor p99 was 3.606 ms during concurrent verification/build load, then **1.040 ms** in the serial comparison, within the 2 ms gate, with the same deterministic hash. NBA's p99 was 0.634 ms. At 540×270 points and 2× scale, combined frame p99 was **0.819 ms basketball / 0.764 ms soccer**, both below 2.3 ms; baseline values were 0.825 / 0.770 ms. Compilation could overlap parts of the serial comparison; these are per-frame measurements, not a whole-app CPU reduction claim.

College initially reported 16 and 9 large rig foot changes. Instrumented runs identified **every one as a declared timeline jump**, spanning 14–42 seconds rather than adjacent playback frames. Continuous rig foot slip remained zero. The diagnostic patch and full reports are retained; the original inclusive metric has not been edited to hide those jumps.

Installed NFL observations, 20 seconds each, percent of one CPU core: before 32.41% expanded / 13.34% folded; after 24.54% expanded / 10.45% folded. Game state, thermal conditions and background work differed, so these are observations, not a controlled improvement. All test folds were restored, including the earlier soccer Live View fold; the user's other folds and following selections were preserved.

## Installed interface and release checks for 1.0.29

- Confirmed `/Applications/Scoreline.app` version 1.0.29 build 31 and its exact binary hash against the packaged app.
- Live Ravens–Bills rendered the directed field, presentation-delay value and existing theme. The two-minute-warning wait matched ESPN's current summary and scoreboard (`401873026`); it was not an app-only freeze.
- Liverpool history → October 28 Chelsea match: clicking **43' Gakpo** and **40' Rogers** displayed both animated goal replays.
- Match → Competition opened four confirmed Carabao quarterfinal paths, including Liverpool–Chelsea → Liverpool–Bournemouth, highlighting the current match without inventing a future draw.
- Sports grouped leagues, cups and tournaments under their sports. Carabao opened from Sports, with an independent follow control.
- Apple silicon + Intel binary, deep/strict bundle signature, archive round-trip, Sparkle EdDSA signature against the existing public key, and appcast XML validation passed. Asset hashes are in `evidence/release-artifacts.json`; the previous installed app has a separate local backup.

## Explicit remaining scope

Phase 0 adapts existing scripts. Some football clips still exceed eventual motion caps (recorded maxima +29–39%, continuous displacement 1.18–1.26 times the cap); drawn poses can slide despite the rig keeping planted feet fixed. Soccer's legacy idle has a short overspeed tail: baseline maximum +74%, integrated +97%, with 0.003% of actor-seconds above +12%. This is **not** claimed to meet Phase 3's motion gate. Actual approach protection changes the windows through which those clips run; it does not replace their grammar.

The allocation-free painter, whole-game CPU targets, sport grammar rewrites and Mac-reviewed web timing-engine port remain later phases. Real recording outages and late data produce declared catch-ups; their large delays remain visible in the reports and are excluded from on-time accuracy.

## Resume here

1. Read this file, INTEGRATION.md and the relevant later phase of CHOREOGRAPHY.md. Keep the existing build.sh/test.sh toolchain; SwiftPM does not work in this machine's CLT setup.
2. Preserve the original worktrees and patch. The published integration already contains those edits; do not apply them twice.
3. Use Support/TheaterBench for optimized recordings and Support/BroadcastAcceptance for page synchronization. Raw reports, hashes, check receipts, frame costs and diagnostic instrumentation are committed under evidence/.
4. Start later motion/CPU work with the legacy clip issues above. Preserve the shared presentation timeline, following/mute policy and actual competition routing.

Recovered skills applied: Apple Design, Emil Design Engineering, SwiftUI Expert, SwiftUI Performance Audit, Write Swift and animation review. Swift 5 language mode, macOS 15 deployment target and the established design system are retained.
