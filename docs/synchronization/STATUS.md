# Broadcast and choreography integration

Status: integration and verification in progress. Not installed or released.

## Preserved inputs

- Release 1.0.28: `9d842ed`.
- Claude clock branch: `874b965` (`mac/broadcast`).
- Claude choreography branch: `a476360` (`mac/choreo`).
- Thirteen interrupted choreography edits are preserved exactly in `9213d19`; original working tree untouched. Original patch SHA-256: `9b5c950c6bbb78e1c18ee5cccc39b2537f35089ece82947bc98c89d1a62e4350`.
- Competition/following/replay changes: through `c0e98b7`.
- Integration: `5ef29b8`, combining both branches and the current app. Both alert paths retain team mute preferences; soccer feeds retain the actual competition path; the removed floating chart panel stays removed.

The recovered BROADCAST.md and CHOREOGRAPHY.md are the original working specifications. Their historical measurements are not new verification. Phase A plus Phase 0 is this release's scope. Later sport grammars and the web timing-engine port remain separate phases.

## Completion gates

1. Run the merged native suite and DEBUG app typecheck; investigate all failures.
2. Reproduce optimized engine measurements from the interrupted state, then improve measured hot paths. No unoptimized performance claims.
3. Verify transitions and decisive timing on real NBA/soccer/college recordings and available NFL captures; distinguish recorder outages from feed latency. Repeated runs must be deterministic.
4. Recover the full-page harness: score, play lists, court and folded/unfolded behavior must agree on the same presentation timeline.
5. Compare frame and whole-app CPU behavior with the released app, including folded/hidden views. Preserve Reduce Motion and existing design.
6. Verify the combined app locally, including the Carabao replay/bracket regression.
7. Integrate and release only the verified result; preserve original worktrees and provide reproducible evidence for Claude's return.

## Known work at interruption

The last written handoff listed planning cost, two transitions and a roughly five-second NBA outlier. Later logs already report zero hard cuts and a smaller 0.88-second NBA outlier, plus 1.34–1.70-second college outliers. These require fresh diagnosis, not blind reimplementation. The original allocation-free rendering goal is explicitly deferred by the Phase 0 implementation notes to the later two-layer renderer; report actual costs rather than claiming that gate passed.

## Skills

Recovered relevant skills used by Claude: Apple Design, Emil Design Engineering, SwiftUI Expert, SwiftUI Performance Audit, Write Swift, animation review. Apply their platform-appropriate guidance within the project's current Swift 5 language mode and macOS 15 deployment target; no unrelated language migration or visual redesign.
