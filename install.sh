#!/bin/bash
# Installs (or updates) Scoreline from the latest GitHub release:
#   curl -fsSL https://raw.githubusercontent.com/lame-o/scoreline/main/install.sh | bash
# After that, Scoreline keeps itself up to date (Settings, Updates).
#
# For testing: SCORELINE_ZIP_URL replaces the download (file:// works), and
# SCORELINE_INSTALL_DIR the destination. With an install dir set, a running
# Scoreline is left alone: nothing is quit or launched.
set -euo pipefail

BUNDLE_ID=io.github.lame-o.Scoreline
URL=${SCORELINE_ZIP_URL:-https://github.com/lame-o/scoreline/releases/latest/download/Scoreline.zip}

# Everything runs from main, so a partly downloaded script does nothing.
main() {
  local dest manage_running=true
  if [[ -n ${SCORELINE_INSTALL_DIR:-} ]]; then
    dest=$SCORELINE_INSTALL_DIR
    manage_running=false
  elif [[ -w /Applications ]]; then
    dest=/Applications
  else
    dest=$HOME/Applications  # no sudo: install just for this user
  fi
  mkdir -p "$dest"

  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT

  echo "Downloading Scoreline…"
  curl -fL --progress-bar -o "$tmp/Scoreline.zip" "$URL"
  ditto -x -k "$tmp/Scoreline.zip" "$tmp"
  codesign --verify --deep --strict "$tmp/Scoreline.app"

  # Scoreline is free and open source, and isn't signed with a paid Apple
  # Developer ID (it's ad-hoc signed). If macOS marks a download as
  # quarantined, Gatekeeper refuses to open an app like that ("Apple could not
  # verify…"). curl doesn't normally add the mark; this clears it in case
  # something did, so the app opens normally. It changes nothing else.
  xattr -dr com.apple.quarantine "$tmp/Scoreline.app"

  if $manage_running && is_running; then
    echo "Quitting Scoreline…"
    osascript -e "tell application id \"$BUNDLE_ID\" to quit" >/dev/null
    for _ in {1..50}; do is_running || break; sleep 0.2; done
  fi

  rm -rf "$dest/Scoreline.app"
  mv "$tmp/Scoreline.app" "$dest/"
  echo "Installed Scoreline to $dest."

  if $manage_running; then
    # LaunchServices can briefly reject a just-moved app; try once more.
    open "$dest/Scoreline.app" 2>/dev/null || { sleep 1; open "$dest/Scoreline.app"; }
    echo "Scoreline is in your menu bar."
  fi
}

is_running() {
  [[ -n $(lsappinfo find bundleid="$BUNDLE_ID") ]]
}

main
