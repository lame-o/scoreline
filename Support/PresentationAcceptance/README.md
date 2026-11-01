# Game presentation acceptance

`./Support/PresentationAcceptance/run.sh` renders the real `DetailView` using the captured Steelers–Browns halftime feed from November 1, 2026. It verifies the presented phase, absence of a stale first-quarter clock, the rendered halftime text, the home/away color legend, and the actual football stage in light and dark mode.

The process blocks HTTP, uses a temporary preference suite, hosts a non-activating offscreen panel, and advances the page on a virtual clock. Screenshots and logs go under `build/presentation-acceptance`. Vision text recognition requires native macOS service access. The original NBA synchronization harness remains `Support/BroadcastAcceptance`.

This is a page correctness check, not a measurement of display FPS. The frame-tier regression and optimized theater benchmark cover scheduling and frame cost respectively.
