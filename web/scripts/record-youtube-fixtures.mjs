#!/usr/bin/env node
// Records World Climbing's two YouTube pages for the parser tests
// (test/fixtures/youtube), trimmed to what data/youtube.ts reads:
//
//   pnpm fixtures youtube
//
// - live-<date>.html: `/@WorldClimbing/live`, cut to the canonical link, the
//   title and the player's live flag and start.
// - streams-<date>.html: `/@WorldClimbing/streams`, `ytInitialData` cut to
//   each lockup's video ID and its `content` strings (title, "Scheduled for
//   …", "Streamed 6h ago"), in their own nesting, nothing else (no player
//   URLs, no visitor data).
//
// Fetched as the Worker fetches them: the proxy's own user agent, English,
// no cookies. So the "Scheduled for" times are in YouTube's default zone
// (Pacific), not the UTC the Mac pins with a cookie.
//
// `trim` also cuts the Mac app's recording (Tests/Fixtures/schedules/
// yt_worldclimbing_streams_2026-10-24.html, two streams scheduled) into
// streams-2026-10-25.html.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "test", "fixtures", "youtube");
const UA = "Scoreline/1.0 (web fixtures; +https://github.com/SubwooferLullaby/scoreline)";
const CHANNEL = "https://www.youtube.com/@WorldClimbing";

async function page(url) {
  const res = await fetch(url, { headers: { Accept: "text/html", "Accept-Language": "en-US", "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

const header = (source, recorded, note) => `<!-- _source: ${source} · _recorded: ${recorded}${note ? ` · ${note}` : ""} -->\n`;

/** The live page's few lines the parser reads. */
export function trimLive(html) {
  const keep = [
    /<link rel="canonical" href="[^"]+">?/,
    /<meta name="title" content="[^"]*">?/,
    /<title>[^<]*<\/title>/,
    /"isLiveNow":(true|false)/,
    /"startTimestamp":"[^"]+"/,
    /"scheduledStartTime":"\d+"/,
  ];
  const lines = keep.map((p) => p.exec(html)?.[0]).filter(Boolean);
  return `<!DOCTYPE html><html><head>\n${lines.join("\n")}\n</head><body></body></html>\n`;
}

/** Only the branches that lead to a `content` string or a lockup's `contentId`. */
function prune(node) {
  if (Array.isArray(node)) {
    const kept = node.map(prune).filter((v) => v !== undefined);
    return kept.length ? kept : undefined;
  }
  if (node && typeof node === "object") {
    const kept = {};
    for (const [k, v] of Object.entries(node)) {
      // The hover menu's items ("Add to queue", "Share") say nothing about the stream.
      if (k === "menuButton") continue;
      if (k === "content" && typeof v === "string") kept[k] = v;
      else if (k === "contentId" && typeof v === "string") kept[k] = v;
      else {
        const p = prune(v);
        if (p !== undefined) kept[k] = p;
      }
    }
    return Object.keys(kept).length ? kept : undefined;
  }
  return undefined;
}

/** Every lockup, pruned, in a list the parser walks as it walks the page. */
export function trimStreams(html) {
  const marker = "var ytInitialData = ";
  const start = html.indexOf(marker);
  const end = html.indexOf(";</script>", start);
  if (start < 0 || end < 0) throw new Error("no ytInitialData (a consent or bot page?)");
  const data = JSON.parse(html.slice(start + marker.length, end));
  const lockups = [];
  const walk = (n) => {
    if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === "object") {
      if (n.lockupViewModel?.contentId) lockups.push({ richItemRenderer: { content: { lockupViewModel: prune(n.lockupViewModel) } } });
      else Object.values(n).forEach(walk);
    }
  };
  walk(data);
  // A dozen is plenty: the scheduled ones come first on the Live tab.
  lockups.splice(12);
  const trimmed = { contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { content: { richGridRenderer: { contents: lockups } } } }] } } };
  return `<!DOCTYPE html><html><head><title>World Climbing - YouTube</title></head><body><script nonce="x">var ytInitialData = ${JSON.stringify(trimmed)};</script></body></html>\n`;
}

export async function recordYouTube() {
  await mkdir(out, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const recorded = new Date().toISOString();
  const live = await page(`${CHANNEL}/live`);
  await writeFile(join(out, `live-${day}.html`), header(`${CHANNEL}/live`, recorded) + trimLive(live));
  console.log(`youtube/live-${day}.html`);
  const streams = await page(`${CHANNEL}/streams`);
  await writeFile(join(out, `streams-${day}.html`), header(`${CHANNEL}/streams`, recorded) + trimStreams(streams));
  console.log(`youtube/streams-${day}.html`);
  // The Mac's recording, with two streams scheduled (Santiago's lead semi-finals and finals).
  const mac = await readFile(join(here, "..", "..", "Tests", "Fixtures", "schedules", "yt_worldclimbing_streams_2026-10-24.html"), "utf8");
  const note = "the Mac app's Tests/Fixtures/schedules/yt_worldclimbing_streams_2026-10-24.html, recorded 2026-10-25 05:00 UTC";
  await writeFile(join(out, "streams-2026-10-25.html"), header(`${CHANNEL}/streams`, "2026-10-25T05:00:52Z", note) + trimStreams(mac));
  console.log("youtube/streams-2026-10-25.html");
}
