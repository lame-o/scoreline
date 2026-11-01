# Integration review

The broadcast clock, continuous theater, competition navigation and following preferences share one native app. Claude's original worktrees remain untouched. The interrupted edits were preserved before integration; STATUS.md records their provenance.

## Corrections found during integration

| Before | After | Why |
| --- | --- | --- |
| The clock protected a sport's fixed binding horizon, even when the theater's approach started earlier. | The theater publishes the actual approach duration with its anchors. Skips, stretches and declared jumps respect it. | The clock must not change an anchor halfway through the visible approach, including when an administrative entry precedes the play. |
| New clock events were found using the length of a bounded 400-event history. | A separate monotonic cursor delivers new events after the history fills. | Long games and repeated stalls must keep delivering wake, jump and resume events. |
| Basketball's scene cache invalidated twenty raw rows. | It also walks back four court plays, past administrative rows. | A rebound arriving after a long substitution sequence must update the cached miss. |
| A horizon refresh parsed the unchanged trailing scenes again. | Unchanged keys, context and facts reuse every scene. | Off-main planning should still avoid unnecessary work. |
| Soccer recomputed loop bounds and inspected a large optional idle value for every sampled actor. | Loop bounds are stored once; the small clip-kind enum selects the path. | Keep sample calculations identical while reducing repeated work. |
| A uniform with explicit legs matching its jersey took a different drawing path. | Identical colors use the same batched path. | Plain uniforms must render identically whether or not the equal leg color is explicit. |
| Context clips inside a faded figure could darken individual limbs. | A subpixel filter forces an isolated layer only during fades; opaque figures keep their existing path. | Arms, legs and body must fade together, including overlapping parts. |
| A short ball flight could cap the slowdown while a basketball player still exceeded his sprint. | The flight receives the minimum extra stretch required for a feasible run, on the same clock as its contact. | The ball pace preference must not force an impossible player movement. |
| A determinism mismatch printed a warning but exited successfully. | It fails the command; a missing recording also fails. | Automated verification cannot pass without running the requested scenario. |

The isolated figure-fade reproduction and drawing-cost comparison pass; the complete pixel regression is being rerun for the cheaper isolated-layer implementation. Results and release status belong in STATUS.md; this review is not a claim that all gates have passed.

## Reproduction

Run from the repository root with the existing Command Line Tools and pinned Sparkle dependency:

```sh
./test.sh
./test.sh --sync-only
./Support/TheaterBench/run.sh --theater engine basketball --real --event=401909896 --twice
./build/ScorelineBench --theater engine soccer --real --event=401879249 --twice
./build/ScorelineBench --theater engine football --real --event=401859185 --twice
./build/ScorelineBench --theater engine football --real --event=401856842 --twice
./build/ScorelineBench --theater engine-cost basketball
./Support/BroadcastAcceptance/run.sh
```

The dedicated recording benchmark uses `-Osize -wmo` and the same adapters and meters as the test executable, without optimizing unrelated regression cases. Run comparisons sequentially after other builds finish; do not edit source while a build is running. The real recordings are read-only inputs under the recorder's configured folder. Synthetic-arrival fixtures are labeled in the fixture directories and must not be described as measurements of live feed latency.

The page harness runs the actual DetailView and reads the directed court's frame hook against the page's broadcast state. It uses an isolated preferences domain and blocks HTTP. It checks late arrivals, score/court agreement, and folded/unfolded tell times. Whole-app CPU and the installed interface require separate verification.

Phase 0 still adapts the existing sport scripts. The recovered choreography specification explicitly defers the allocation-free painter and sport grammar replacements. Report those limits rather than labeling the entire later design complete.
