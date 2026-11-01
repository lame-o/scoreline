# Full-page broadcast acceptance

Run `./Support/BroadcastAcceptance/run.sh` from the repository. It builds an optimized DEBUG harness with the actual DetailView, a virtual recording clock, isolated preferences and blocked HTTP. It never activates its offscreen window.

The input is NBA event 401909285 from the local recorder, falling back to the checked-in quarter fixture. Set `SCORELINE_ACCEPTANCE_RECORDINGS` to an alternate recording root. Set `SCORELINE_ACCEPTANCE_OUTPUT` for artifacts (default `build/broadcast-acceptance`). `SCORELINE_ACCEPTANCE_PIXELS=1` adds OCR verification of the final rendered hero and saves that page as a PNG.

The primary checks compare the court's rendered frame hook with the page's presented broadcast state, at each score change and every sampled step. They also cover late arrivals, one plan in flight, and opening folded then unfolding without moving tell times. A failure exits nonzero; a missing recording exits 66. This is a virtual-clock correctness check, not a whole-app CPU benchmark.
