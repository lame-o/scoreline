# Repository settings

The GitHub settings that go with the README. Nothing here is applied automatically: run the commands once, from any directory, with `gh` signed in as lame-o.

## Description, homepage and topics

```sh
gh repo edit lame-o/scoreline \
  --description "Live scores in your Mac's menu bar: MLB, NFL, NBA, soccer, CS2 and climbing, with every play replayed in isometric 3D. Native SwiftUI, free, and on the web." \
  --homepage "https://scoreline-web.lame-o.workers.dev"

gh repo edit lame-o/scoreline \
  --add-topic macos \
  --add-topic menu-bar \
  --add-topic menubar-app \
  --add-topic swiftui \
  --add-topic swift \
  --add-topic live-scores \
  --add-topic sports \
  --add-topic mlb \
  --add-topic nfl \
  --add-topic nba \
  --add-topic soccer \
  --add-topic baseball \
  --add-topic basketball \
  --add-topic football \
  --add-topic esports \
  --add-topic cs2 \
  --add-topic counter-strike \
  --add-topic climbing \
  --add-topic statcast \
  --add-topic cloudflare-workers
```

That's GitHub's limit of 20 topics. To check the result:

```sh
gh repo view lame-o/scoreline --json description,homepageUrl,repositoryTopics
```

## Social preview

`docs/social-preview.png` (1280×640, under 1 MB) is the card that shows when the repo is linked on X, iMessage, Slack and the rest. GitHub has no API or `gh` command for it, so it's uploaded by hand:

1. Open https://github.com/lame-o/scoreline/settings.
2. Under **General → Social preview**, click **Edit → Upload an image…**
3. Choose `docs/social-preview.png`.

## Regenerating the images

The screenshots, the README's buttons and the social preview are all made by `web/scripts/marketing/` (capture.mjs, then compose.mjs; the shot list is shots.config.mjs). With `pnpm dev` running in `web/`:

```sh
cd web
node scripts/marketing/capture.mjs            # raw captures, light and dark (test-results/marketing/raw)
node scripts/marketing/compose.mjs            # frames, captions, WebP output into docs/, plus the Mac renders
node scripts/marketing/readme-gallery.mjs     # the README's "Every page" galleries
node scripts/marketing/check-readme.mjs       # every README image resolves; sizes
```

The first two take name filters (`node scripts/marketing/capture.mjs mlb nfl`) to redo a few shots.
