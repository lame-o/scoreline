#!/bin/bash
# Verify the executable and every embedded Mach-O file are arm64 only.
# Used before packaging and after ZIP extraction; does not run any app code.
set -euo pipefail
[[ $# == 1 ]] || { echo "usage: $0 <Scoreline.app>" >&2; exit 64; }
app=$1
[[ -f "$app/Contents/MacOS/Scoreline" ]] || {
  echo "Missing Scoreline executable: $app" >&2; exit 1;
}
[[ $(lipo -archs "$app/Contents/MacOS/Scoreline") == arm64 ]] || {
  echo "Scoreline's main executable must be arm64 only: $app" >&2; exit 1;
}
count=0
while IFS= read -r -d '' code; do
  [[ $(file -b "$code") == *Mach-O* ]] || continue
  archs=$(lipo -archs "$code")
  [[ $archs == arm64 ]] || {
    echo "Expected arm64 only, found $archs: $code" >&2; exit 1;
  }
  count=$((count + 1))
done < <(find "$app" -type f -print0)
[[ $count -gt 0 ]] || { echo "No Mach-O code found: $app" >&2; exit 1; }
echo "Verified Apple silicon architecture ($count Mach-O files)."
