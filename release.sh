#!/bin/zsh
# Cuts a release:  ./release.sh 1.1 [--publish]
# Bumps the version in Support/Info.plist, builds a universal app, packages
# Scoreline.zip (what Sparkle and install.sh download) and Scoreline.dmg (drag
# to Applications), signs the zip with Sparkle's EdDSA key from the login
# keychain, writes appcast.xml and commits the version bump. Then it prints
# the push and `gh release create` commands; --publish runs them.
#   RELEASE_DIR       where the files go (default build/release)
#   SPARKLE_KEY_FILE  sign with this private key file instead of the keychain
set -euo pipefail
cd "${0:A:h}"

REPO=lame-o/scoreline
PLIST=Support/Info.plist
APP=build/Scoreline.app

fail() { print -u2 "release.sh: $*"; exit 1; }

VERSION=""
PUBLISH=false
for arg in "$@"; do
  case "$arg" in
    --publish) PUBLISH=true ;;
    -*) fail "unknown option: $arg" ;;
    *) [[ -z $VERSION ]] || fail "give one version"; VERSION=$arg ;;
  esac
done
if [[ ! $VERSION =~ '^[0-9]+(\.[0-9]+)*$' ]]; then
  print -u2 "usage: ./release.sh <version> [--publish]   (e.g. ./release.sh 1.1)"
  exit 64
fi

# Fail fast, before anything changes.
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "not a git repository"
[[ -z $(git status --porcelain) ]] || fail "uncommitted changes. Commit or stash them first, so the release matches a commit."
CURRENT=$(plutil -extract CFBundleShortVersionString raw $PLIST)
BUILD=$(plutil -extract CFBundleVersion raw $PLIST)
autoload -U is-at-least
# The first release may ship the current version; every later one must be newer.
if [[ -n $(git tag -l 'v*') ]]; then
  [[ $VERSION != $CURRENT ]] && is-at-least $CURRENT $VERSION || fail "$VERSION isn't newer than the current version, $CURRENT"
else
  is-at-least $CURRENT $VERSION || fail "$VERSION is older than the current version, $CURRENT"
fi
[[ $BUILD == <-> ]] || fail "CFBundleVersion ($BUILD) isn't a whole number"
TAG=v$VERSION
! git rev-parse -q --verify "refs/tags/$TAG" >/dev/null || fail "tag $TAG already exists"

SPARKLE=$(Support/fetch-sparkle.sh)
PUBLIC_KEY=$(plutil -extract SUPublicEDKey raw $PLIST 2>/dev/null) || fail "Info.plist has no SUPublicEDKey"
if [[ -n ${SPARKLE_KEY_FILE:-} ]]; then
  [[ -r $SPARKLE_KEY_FILE ]] || fail "can't read SPARKLE_KEY_FILE ($SPARKLE_KEY_FILE)"
  SIGN=("$SPARKLE/bin/sign_update" --ed-key-file "$SPARKLE_KEY_FILE")
else
  # Only checks the key is there; reading it comes later (macOS may ask once).
  security find-generic-password -s https://sparkle-project.org -a ed25519 >/dev/null 2>&1 \
    || fail "no Sparkle signing key in the login keychain. Restore your backup: $SPARKLE/bin/generate_keys -f <backup file>"
  SIGN=("$SPARKLE/bin/sign_update")
fi
if $PUBLISH; then
  command -v gh >/dev/null || fail "--publish needs the GitHub CLI (brew install gh)"
fi

# Bump the version; put Info.plist back if anything below fails.
NEW_BUILD=$((BUILD + 1))
COMMITTED=false
trap '$COMMITTED || git checkout -q -- $PLIST' EXIT
plutil -replace CFBundleShortVersionString -string $VERSION $PLIST
plutil -replace CFBundleVersion -string $NEW_BUILD $PLIST

print "Building Scoreline $VERSION ($NEW_BUILD)…"
./build.sh --universal
ARCHS=$(lipo -archs $APP/Contents/MacOS/Scoreline)
[[ $ARCHS == *arm64* && $ARCHS == *x86_64* ]] || fail "the build isn't universal ($ARCHS)"

OUT=${RELEASE_DIR:-build/release}
rm -rf $OUT && mkdir -p $OUT
OUT=${OUT:A}
print "Packaging…"
ditto -c -k --sequesterRsrc --keepParent $APP $OUT/Scoreline.zip
STAGE=build/dmg
rm -rf $STAGE && mkdir -p $STAGE
ditto $APP $STAGE/Scoreline.app
ln -s /Applications $STAGE/Applications
hdiutil create -quiet -volname Scoreline -srcfolder $STAGE -format UDZO -ov $OUT/Scoreline.dmg
rm -rf $STAGE

# The zip must unpack to an app that still verifies (symlinks intact).
CHECK=build/zip-check
rm -rf $CHECK && ditto -x -k $OUT/Scoreline.zip $CHECK
codesign --verify --deep --strict $CHECK/Scoreline.app
rm -rf $CHECK

print "Signing…"
SIGNATURE=$("${SIGN[@]}" -p $OUT/Scoreline.zip)
LENGTH=$(stat -f %z $OUT/Scoreline.zip)
# The check every installed copy will make: this zip against the key it ships with.
swift Support/verify-signature.swift $OUT/Scoreline.zip $SIGNATURE $PUBLIC_KEY \
  || fail "the zip's signature doesn't match SUPublicEDKey in Info.plist (wrong signing key?)"

MIN_OS=$(plutil -extract LSMinimumSystemVersion raw $PLIST)
[[ $MIN_OS == *.*.* ]] || MIN_OS=$MIN_OS.0  # Sparkle wants major.minor.patch
cat > $OUT/appcast.xml <<EOF
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>Scoreline</title>
    <link>https://github.com/$REPO</link>
    <item>
      <title>Scoreline $VERSION</title>
      <pubDate>$(LC_ALL=C date -u '+%a, %d %b %Y %H:%M:%S +0000')</pubDate>
      <sparkle:version>$NEW_BUILD</sparkle:version>
      <sparkle:shortVersionString>$VERSION</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>$MIN_OS</sparkle:minimumSystemVersion>
      <sparkle:releaseNotesLink>https://github.com/$REPO/releases/tag/$TAG</sparkle:releaseNotesLink>
      <enclosure url="https://github.com/$REPO/releases/download/$TAG/Scoreline.zip"
                 length="$LENGTH" type="application/octet-stream"
                 sparkle:edSignature="$SIGNATURE"/>
    </item>
  </channel>
</rss>
EOF
xmllint --noout $OUT/appcast.xml

git commit -q -m "Release $VERSION" -- $PLIST
COMMITTED=true

GH=(gh release create $TAG --repo $REPO --target $(git rev-parse HEAD) --title "Scoreline $VERSION"
    --generate-notes $OUT/Scoreline.zip $OUT/Scoreline.dmg $OUT/appcast.xml)
if $PUBLISH; then
  git push origin HEAD
  "${GH[@]}"
  print "Published $TAG."
else
  print "\nCommitted \"Release $VERSION\". Files are in $OUT. To publish:\n"
  print "  git push origin HEAD"
  print -r -- "  ${(q-)GH[@]}"
fi
