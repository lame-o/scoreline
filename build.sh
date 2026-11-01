#!/bin/zsh
# Builds Scoreline.app for Apple silicon (arm64).
#   --install     copy it to /Applications and launch it
set -euo pipefail
cd "${0:A:h}"

INSTALL=false
for arg in "$@"; do
  case "$arg" in
    --install) INSTALL=true ;;
    --universal) echo "Intel support has been retired. Run ./build.sh for Apple silicon." >&2; exit 64 ;;
    *) echo "Unknown option: $arg" >&2; exit 64 ;;
  esac
done
if $INSTALL && [[ $(sysctl -n hw.optional.arm64 2>/dev/null || true) != 1 ]]; then
  echo "Scoreline requires an Apple silicon Mac. Nothing was installed." >&2
  exit 1
fi

APP=build/Scoreline.app
BINARY="$APP/Contents/MacOS/Scoreline"
# Command Line Tools' newest SDK ships SwiftUI macros only Xcode can expand,
# so build against the newest SDK that doesn't need them.
SDK=$(ls -d /Library/Developer/CommandLineTools/SDKs/MacOSX26*.sdk 2>/dev/null | sort -V | tail -1)
[[ -z "$SDK" ]] && SDK=$(xcrun --show-sdk-path)
# Sparkle (auto-updates), the pinned release, checksum-verified on first fetch.
SPARKLE=$(Support/fetch-sparkle.sh)

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" "$APP/Contents/Frameworks"

echo "Compiling for Apple silicon…"
swiftc -j "${SCORELINE_JOBS:-2}" -parse-as-library -Osize -wmo \
  -sdk "$SDK" -target arm64-apple-macos15.0 -swift-version 5 \
  -F "$SPARKLE" -framework Sparkle -Xlinker -rpath -Xlinker @executable_path/../Frameworks \
  Sources/Scoreline/*.swift -o "$BINARY"
strip -x "$BINARY"

cp Support/Info.plist "$APP/Contents/"
cp "$SPARKLE/LICENSE" "$APP/Contents/Resources/Sparkle-LICENSE.txt"

# Embed Sparkle (ditto keeps the framework's symlinks). Its XPC services are
# only for sandboxed apps, and the headers only for compiling against it.
FRAMEWORK="$APP/Contents/Frameworks/Sparkle.framework"
ditto "$SPARKLE/Sparkle.framework" "$FRAMEWORK"
for part in XPCServices Headers PrivateHeaders Modules; do
  rm -rf "$FRAMEWORK/$part" "$FRAMEWORK/Versions/B/$part"
done

# Trim only the embedded copy, never the checksum-verified vendor framework.
# Keep each arm64 slice's signing metadata for the inside-out signing below.
for code in "$FRAMEWORK/Versions/B/Sparkle" "$FRAMEWORK/Versions/B/Autoupdate" \
            "$FRAMEWORK/Versions/B/Updater.app/Contents/MacOS/Updater"; do
  if [[ $(lipo -archs "$code") != arm64 ]]; then
    lipo "$code" -thin arm64 -output "$code.arm64"
    chmod "$(stat -f %OLp "$code")" "$code.arm64"
    mv "$code.arm64" "$code"
  fi
done

echo "Rendering icon…"
ICONSET=build/AppIcon.iconset
rm -rf "$ICONSET" && mkdir -p "$ICONSET"
swift Support/make-icon.swift build/icon-1024.png
for s in 16 32 128 256 512; do
  sips -z $s $s build/icon-1024.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s * 2)) $((s * 2)) build/icon-1024.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

# Ad-hoc sign inside-out: Sparkle's helpers, the framework, then the app.
# Sparkle ships these ad-hoc signed with the hardened runtime; keep its flags
# and entitlements.
for code in "$FRAMEWORK/Versions/B/Autoupdate" "$FRAMEWORK/Versions/B/Updater.app" "$FRAMEWORK"; do
  codesign --force --sign - --preserve-metadata=entitlements,flags "$code"
done
codesign --force --sign - "$APP"
codesign --verify --deep --strict "$APP"
Support/verify-architecture.sh "$APP"
echo "Built $APP ($(du -sh "$APP" | cut -f1), $(lipo -archs "$BINARY"))"

if $INSTALL; then
  pkill -x Scoreline 2>/dev/null || true
  while pgrep -x Scoreline >/dev/null; do sleep 0.2; done
  rm -rf /Applications/Scoreline.app
  cp -R "$APP" /Applications/
  # LaunchServices can briefly reject a freshly copied bundle (-600); retry.
  for attempt in 1 2 3 4 5; do
    open /Applications/Scoreline.app 2>/dev/null && break
    sleep 1
  done
  echo "Installed to /Applications and launched."
fi
