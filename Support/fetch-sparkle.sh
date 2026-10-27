#!/bin/zsh
# Fetches the pinned Sparkle release into .vendor/ (once) and prints its path.
# build.sh, test.sh and release.sh all use it, so the version and checksum live
# only here. To upgrade: change both, from github.com/sparkle-project/Sparkle/releases.
set -euo pipefail
cd "${0:A:h}/.."

VERSION=2.10.0
SHA256=c2bf58aa8387266ac179357b1415d6f2635f044da8be41042af32425dae6da0c
DIR=.vendor/Sparkle-$VERSION

if [[ ! -d "$DIR" ]]; then
  echo "Fetching Sparkle $VERSION…" >&2
  mkdir -p .vendor
  ARCHIVE=.vendor/Sparkle-$VERSION.tar.xz
  curl -fsSL -o "$ARCHIVE" "https://github.com/sparkle-project/Sparkle/releases/download/$VERSION/Sparkle-$VERSION.tar.xz"
  if ! echo "$SHA256  $ARCHIVE" | shasum -a 256 -c --status; then
    rm -f "$ARCHIVE"
    echo "Sparkle $VERSION doesn't match its pinned SHA-256; not using it." >&2
    exit 1
  fi
  # Only what we use: the framework, the signing tools and the licence.
  rm -rf "$DIR.partial" && mkdir -p "$DIR.partial"
  tar -xJf "$ARCHIVE" -C "$DIR.partial" ./Sparkle.framework ./bin/sign_update ./bin/generate_keys ./LICENSE
  mv "$DIR.partial" "$DIR"
  rm -f "$ARCHIVE"
fi
echo "$PWD/$DIR"
