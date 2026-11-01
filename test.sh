#!/bin/zsh
# Offline regression suite. --record refreshes the recorded API responses.
# Also typechecks the app with -D DEBUG (the render-harness and smoke code that
# neither the release build nor the tests compile), alongside the test build.
# --bench [args] builds the same binary and runs the broadcast replay bench
# instead (Tests/BroadcastBench.swift), skipping the suite and the typecheck.
set -euo pipefail
cd "${0:A:h}"
BENCH=false
if [[ "${1:-}" == "--bench" ]]; then
  BENCH=true
  shift
fi
SDK=$(ls -d /Library/Developer/CommandLineTools/SDKs/MacOSX26*.sdk 2>/dev/null | sort -V | tail -1)
# Updater.swift imports Sparkle, so the tests link it too (never started: the app delegate starts it).
SPARKLE=$(Support/fetch-sparkle.sh)
if [[ "${1:-}" == "--record" ]]; then
  export SCORELINE_RECORD=1
  find Tests/Fixtures -name "*.bin" -delete 2>/dev/null; rm -f Tests/Fixtures/index.txt
fi
mkdir -p build Tests/Fixtures
# Leave room for the rest of the Mac: the two compiles run side by side, so
# together they take at most 6 cores (SCORELINE_JOBS sets the test build's share).
JOBS=${SCORELINE_JOBS:-4}

if $BENCH; then
  # Keep bounded compile parallelism and optional release flags for meaningful benchmarks.
  swiftc -j "$JOBS" -D BENCH ${=SCORELINE_BENCH_FLAGS:-} -parse-as-library -sdk "$SDK" -target arm64-apple-macos15.0 -swift-version 5 \
    -F "$SPARKLE" -framework Sparkle -Xlinker -rpath -Xlinker "$SPARKLE" \
    $(ls Sources/Scoreline/*.swift | grep -v ScorelineApp.swift) Tests/*.swift -o build/ScorelineTests
  exec ./build/ScorelineTests --bench "$@"
fi

swiftc -j 2 -typecheck -D DEBUG -parse-as-library -sdk "$SDK" -target arm64-apple-macos15.0 -swift-version 5 \
  -F "$SPARKLE" Sources/Scoreline/*.swift > build/debug-typecheck.log 2>&1 &
DEBUG_CHECK=$!

swiftc -j "$JOBS" -D BENCH -parse-as-library -sdk "$SDK" -target arm64-apple-macos15.0 -swift-version 5 \
  -F "$SPARKLE" -framework Sparkle -Xlinker -rpath -Xlinker "$SPARKLE" \
  $(ls Sources/Scoreline/*.swift | grep -v ScorelineApp.swift) Tests/*.swift -o build/ScorelineTests

if ! wait $DEBUG_CHECK; then
  echo "DEBUG typecheck failed:" >&2
  cat build/debug-typecheck.log >&2
  exit 1
fi
if grep -q "warning:" build/debug-typecheck.log; then
  echo "DEBUG typecheck warnings:" >&2
  grep -A3 "warning:" build/debug-typecheck.log >&2
fi
echo "DEBUG typecheck: ok"

./build/ScorelineTests
