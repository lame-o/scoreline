#!/bin/zsh
# Release-optimized recording benchmarks, using the existing adapters and meters.
set -euo pipefail
cd "${0:A:h}/../.."
SDK=$(ls -d /Library/Developer/CommandLineTools/SDKs/MacOSX26*.sdk | sort -V | tail -1)
SPARKLE=$(Support/fetch-sparkle.sh)
mkdir -p build
export CLANG_MODULE_CACHE_PATH="$PWD/build/module-cache"
BENCH_SOURCES=(Sources/Scoreline/*.swift)
BENCH_SOURCES=(${BENCH_SOURCES:#*/ScorelineApp.swift})
swiftc -j "${SCORELINE_JOBS:-2}" -D BENCH -Osize -wmo -parse-as-library \
  -sdk "$SDK" -target arm64-apple-macos15.0 -swift-version 5 \
  -F "$SPARKLE" -framework Sparkle -Xlinker -rpath -Xlinker "$SPARKLE" \
  "${BENCH_SOURCES[@]}" Tests/FixtureProtocol.swift Tests/BroadcastBench.swift Tests/TheaterBench*.swift \
  Support/TheaterBench/main.swift -o build/ScorelineBench
exec ./build/ScorelineBench "$@"
