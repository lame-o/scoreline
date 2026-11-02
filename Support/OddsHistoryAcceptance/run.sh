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
SOURCES+=(Support/OddsHistoryAcceptance/*.swift)
FLAGS=(${=SCORELINE_ACCEPTANCE_FLAGS:--Osize -wmo})
CACHE_FLAGS=()
if (( ! ${FLAGS[(Ie)-wmo]} && ! ${FLAGS[(Ie)-whole-module-optimization]} )); then
  # The compiler, rather than a hand-written timestamp filter, tracks all
  # cross-file dependencies. Harness-only fixes can reuse unchanged objects.
  CACHE=build/odds-history-incremental
  mkdir -p "$CACHE"
  python3 - "$CACHE" "${SOURCES[@]}" <<'PY'
from pathlib import Path
import json
import sys
cache = Path(sys.argv[1])
mapping = {"": {"swift-dependencies": str(cache / "build-record.swiftdeps")}}
for source in sys.argv[2:]:
    stem = source.replace("/", "_")
    mapping[source] = {"object": str(cache / (stem + ".o")),
                       "dependencies": str(cache / (stem + ".d")),
                       "swift-dependencies": str(cache / (stem + ".swiftdeps"))}
text = json.dumps(mapping, sort_keys=True, indent=2) + "\n"
target = cache / "output-map.json"
if not target.exists() or target.read_text() != text:
    target.write_text(text)
PY
  CACHE_FLAGS=(-incremental -enable-batch-mode -output-file-map "$CACHE/output-map.json")
fi
swiftc -j 2 -D DEBUG "${FLAGS[@]}" "${CACHE_FLAGS[@]}" -parse-as-library -sdk "$SDK" -target arm64-apple-macos15.0 -swift-version 5 \
  -F "$SPARKLE" -framework Sparkle -Xlinker -rpath -Xlinker "$SPARKLE" \
  "${SOURCES[@]}" -o build/OddsHistoryAcceptance
exec ./build/OddsHistoryAcceptance
