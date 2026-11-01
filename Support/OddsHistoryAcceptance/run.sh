#!/bin/zsh
# Run after the regular build/test jobs finish. No external service is used.
# SCORELINE_ACCEPTANCE_FLAGS can override the default optimized build.
set -euo pipefail
cd "${0:A:h}/../.."
SDK=$(ls -d /Library/Developer/CommandLineTools/SDKs/MacOSX26*.sdk | sort -V | tail -1)
SPARKLE=$(Support/fetch-sparkle.sh)
mkdir -p build
export CLANG_MODULE_CACHE_PATH="$PWD/build/module-cache"
SOURCES=(Sources/Scoreline/*.swift)
SOURCES=(${SOURCES:#*/ScorelineApp.swift})
swiftc -j 2 -D DEBUG ${=SCORELINE_ACCEPTANCE_FLAGS:--Osize -wmo} -parse-as-library -sdk "$SDK" -target arm64-apple-macos15.0 -swift-version 5 \
  -F "$SPARKLE" -framework Sparkle -Xlinker -rpath -Xlinker "$SPARKLE" \
  "${SOURCES[@]}" Support/OddsHistoryAcceptance/*.swift -o build/OddsHistoryAcceptance
exec ./build/OddsHistoryAcceptance
