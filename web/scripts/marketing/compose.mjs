/**
 * Marketing screenshots, step 2: frames, captions and backgrounds.
 *
 *     node scripts/marketing/compose.mjs              # everything
 *     node scripts/marketing/compose.mjs isometric    # only names containing these
 *
 * Reads the raw captures (capture.mjs, test-results/marketing/raw) and the
 * Mac app's renders (SCORELINE_MAC_RAW), renders compose.html headless for
 * each composition in shots.config.mjs, and writes small WebPs:
 *
 *   docs/screenshots/web/<name>-<theme>.webp         1600×1000, the README's
 *   docs/screenshots/web/2400/<name>-<theme>.webp    2400×1500, for press and posts
 *   docs/screenshots/web/pages/<name>-<theme>.webp   every page, framed, for the galleries
 *   docs/screenshots/mac/<name>-<theme>.webp         the Mac pipeline's framed images (macImports), once they
 *                                                    exist (never a placeholder); mac/pages/ for its panels
 *   docs/social-preview.png                          1280×640, GitHub's social preview
 *
 * Needs cwebp and ImageMagick (`brew install webp imagemagick`).
 */
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compositions, gallery, macGallery, macImports, social, MAC_RAW_DEFAULT } from "./shots.config.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const RAW = process.env.SCORELINE_RAW ?? join(here, "../../test-results/marketing/raw");
const MAC_RAW = process.env.SCORELINE_MAC_RAW ?? MAC_RAW_DEFAULT;
const TMP = join(here, "../../test-results/marketing/tmp");
const DOCS = join(repo, "docs");
const TEMPLATE = pathToFileURL(join(here, "compose.html")).href;
for (const d of [TMP, join(DOCS, "screenshots/web/2400"), join(DOCS, "screenshots/web/pages"), join(DOCS, "screenshots/mac/pages")]) mkdirSync(d, { recursive: true });

const filters = process.argv.slice(2);
const wanted = (name) => filters.length === 0 || filters.some((f) => name.includes(f));

/** The raw capture for a source name and theme (a frame like `mlb@7000` picks that frame). */
function raw(source, theme) {
  if (!source) return null;
  const [name, frame] = source.split("@");
  const file = join(RAW, `${name}-${theme}${frame ? `@${frame}` : ""}.png`);
  return existsSync(file) ? pathToFileURL(file).href : null;
}

/** A Mac render by name and theme: `<name>-<theme>.png` or `<name>.png` in SCORELINE_MAC_RAW (any subfolder). */
function macRaw(name, theme) {
  if (!name || !existsSync(MAC_RAW)) return null;
  const files = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(png|jpe?g|webp)$/i.test(f)) files.push(p);
    }
  };
  walk(MAC_RAW);
  const base = (p) => p.split("/").pop().replace(/\.(png|jpe?g|webp)$/i, "");
  const hit = files.find((p) => base(p) === `${name}-${theme}`) ?? files.find((p) => base(p) === name);
  return hit ? pathToFileURL(hit).href : null;
}

/**
 * The Mac pipeline's own images, carried over as they are (macImports): its uncaptioned README tile
 * `<from>-tile-<theme>.webp`, else `<from>-<theme>.webp` (an image it makes no tile for). `from` may
 * name a family (`slide` takes the first `slide-…`). Returns whether it copied one.
 */
function importMac(item, theme) {
  if (!existsSync(MAC_RAW)) return false;
  const files = readdirSync(MAC_RAW).filter((f) => f.endsWith(".webp")).sort();
  const family = (f) => f === `${item.from}-tile-${theme}.webp` || f === `${item.from}-${theme}.webp` || f.startsWith(`${item.from}-`);
  const pick = files.find((f) => family(f) && f.endsWith(`-tile-${theme}.webp`)) ?? files.find((f) => family(f) && f.endsWith(`-${theme}.webp`) && !f.includes("-tile-"));
  if (!pick) return false;
  copyFileSync(join(MAC_RAW, pick), join(DOCS, "screenshots/mac", `${item.name}-${theme}.webp`));
  return true;
}

/**
 * A card's picture: a web capture (`source`), or a Mac render (`mac`, by name) cut to `crop`
 * ([x, y, w, h] in its pixels), for the views only the Mac app has yet. Cards a theme lacks are left out.
 */
function cardImage(card, theme) {
  if (!card.mac) return raw(card.source, theme);
  const file = macRaw(card.mac, theme) ?? (card.fallbackTheme ? macRaw(card.mac, card.fallbackTheme) : null);
  if (!file) return null;
  if (!card.crop) return file;
  const out = join(TMP, `card-${card.mac}-${theme}.png`);
  const [x, y, w, h] = card.crop;
  execFileSync("magick", [fileURLToPath(file), "-crop", `${w}x${h}+${x}+${y}`, "+repage", out]);
  return pathToFileURL(out).href;
}

/** The color along the top edge of a capture (what a phone's status bar sits on), and the ink that reads on it. */
function topEdge(fileURL) {
  const hex = execFileSync("magick", [fileURLToPath(fileURL), "-crop", "100%x1+0+0", "-resize", "1x1!", "-format", "%[hex:p{0,0}]", "info:"]).toString().trim().slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return { bg: `#${hex}`, ink: 0.2126 * r + 0.7152 * g + 0.0722 * b > 140 ? "#000" : "#fff" };
}

function webp(png, out, { quality = 84, width, height } = {}) {
  let source = png;
  if (width) {
    source = png.replace(/\.png$/, `-${width}.png`);
    execFileSync("magick", [png, "-filter", "Lanczos", "-resize", `${width}x${height ?? ""}`, "-strip", source]);
  }
  execFileSync("cwebp", ["-quiet", "-q", String(quality), "-m", "6", "-sharp_yuv", "-af", "-metadata", "none", source, "-o", out]);
  return statSync(out).size;
}

// The browser starts with the first render, so carrying over the Mac images alone needs none.
let browser = null;
let page = null;
async function ensurePage() {
  if (page) return page;
  browser = await chromium.launch({ headless: true, args: ["--force-color-profile=srgb", "--font-render-hinting=none"] });
  page = await browser.newPage({ viewport: { width: 2400, height: 1500 }, deviceScaleFactor: 1 });
  return page;
}
const report = [];

async function render(spec, png) {
  await ensurePage();
  await page.setViewportSize({ width: spec.width, height: spec.height });
  await page.goto(`${TEMPLATE}#${encodeURIComponent(JSON.stringify(spec))}`);
  // A new hash on the same file doesn't reload; make sure each spec renders fresh.
  await page.reload();
  await page.waitForSelector("body[data-ready]", { timeout: 20_000 });
  await page.screenshot({ path: png, omitBackground: spec.kind === "bare", clip: { x: 0, y: 0, width: spec.width, height: spec.height } });
}

const kb = (n) => `${Math.round(n / 1024)} KB`;

try {
  // MARK: The Mac pipeline's framed images (they replace this script's placeholders of the same name)
  const imported = new Set();
  for (const item of macImports) {
    if (!wanted(`mac-${item.name}`)) continue;
    for (const theme of ["light", "dark"]) {
      if (importMac(item, theme)) {
        imported.add(`${item.name}-${theme}`);
        console.log(`✓ mac ${item.name} ${theme} (from the Mac renders)`);
      }
    }
  }

  // MARK: Compositions (2400×1500 and 1600×1000)
  for (const c of compositions) {
    if (!wanted(c.name)) continue;
    for (const theme of c.themes ?? ["light", "dark"]) {
      if (c.kind === "mac" && imported.has(`${c.name}-${theme}`)) continue;
      const spec = { width: 2400, height: 1500, theme, kind: c.kind, caption: c.caption, url: c.url ?? "scoreline-web.lame-o.workers.dev", ...c.spec };
      if (c.kind === "browser") spec.image = raw(c.source, theme);
      if (c.kind === "phones") spec.phones = c.phones.map((p) => { const image = raw(p.source, theme); return { image, ...(image ? topEdge(image) : {}) }; });
      if (c.kind === "mac") Object.assign(spec, { panels: c.panels.map((p) => ({ image: macRaw(p.source, theme), label: p.label })), icon: pathToFileURL(join(repo, "web/public/icon-512.png")).href });
      if (c.kind === "grid") Object.assign(spec, { kind: "grid", cards: c.cards.map((card) => ({ ...card, image: cardImage(card, theme) })) });
      // Nothing is drawn without its pixels: a Mac frame waits for the Mac renders rather than ship a placeholder.
      if (spec.cards) spec.cards = spec.cards.filter((x, i) => x.image || !c.cards[i].optional);
      const missing = (spec.image === null) || spec.phones?.some((p) => !p.image) || spec.cards?.some((x) => !x.image) || spec.panels?.some((p) => !p.image);
      if (missing) {
        console.warn(`· ${c.name} ${theme}: missing raw capture, skipped`);
        continue;
      }
      const png = join(TMP, `${c.name}-${theme}.png`);
      await render(spec, png);
      const dir = join(DOCS, "screenshots", c.kind === "mac" ? "mac" : "web");
      mkdirSync(join(dir, "2400"), { recursive: true });
      const big = webp(png, join(dir, "2400", `${c.name}-${theme}.webp`), { quality: 82 });
      const small = webp(png, join(dir, `${c.name}-${theme}.webp`), { quality: 84, width: 1600, height: 1000 });
      report.push(`${c.name}-${theme}: 1600 ${kb(small)} · 2400 ${kb(big)}`);
      console.log(`✓ ${c.name} ${theme} (1600: ${kb(small)}, 2400: ${kb(big)})`);
    }
  }

  // MARK: Every page, framed (the galleries)
  for (const g of gallery) {
    if (!wanted(g.name)) continue;
    for (const theme of ["light", "dark"]) {
      const image = raw(g.source, theme);
      if (!image) {
        console.warn(`· page ${g.name} ${theme}: missing raw capture, skipped`);
        continue;
      }
      const spec = g.device === "phone"
        ? { kind: "bare", theme, width: 520, height: Math.round(520 * 2.1305) + 2, phone: { image, ...topEdge(image) } }
        : { kind: "bare", theme, width: 1200, height: Math.round(1200 * (52 / 1280)) + 750, image, url: g.url ?? "scoreline-web.lame-o.workers.dev" };
      const png = join(TMP, `page-${g.name}-${theme}.png`);
      await render(spec, png);
      const size = webp(png, join(DOCS, "screenshots/web/pages", `${g.name}-${theme}.webp`), { quality: 80 });
      console.log(`✓ page ${g.name} ${theme} (${kb(size)})`);
    }
  }

  // MARK: The Mac app's pages: its clean panels (panels/<page>-<theme>.png), cut to at most 2:1 tall, as WebP
  for (const m of macGallery) {
    if (!wanted(`mac-${m.name}`) && !wanted("mac-pages")) continue;
    for (const theme of ["light", "dark"]) {
      const file = join(MAC_RAW, "panels", `${m.source}-${theme}.png`);
      if (!existsSync(file)) continue;
      const png = join(TMP, `mac-${m.name}-${theme}.png`);
      execFileSync("magick", [file, "-gravity", "North", "-crop", `100%x0`, "+repage", "-resize", "720x", "-crop", "720x1440+0+0", "+repage", png]);
      const size = webp(png, join(DOCS, "screenshots/mac/pages", `${m.name}-${theme}.webp`), { quality: 82 });
      console.log(`✓ mac page ${m.name} ${theme} (${kb(size)})`);
    }
  }

  // MARK: The README's buttons (2×, transparent PNG)
  if (wanted("buttons")) {
    await ensurePage();
    mkdirSync(join(DOCS, "buttons"), { recursive: true });
    for (const b of [
      { name: "download-mac", label: "Download for Mac", icon: "download", variant: "primary" },
      { name: "try-web", label: "Try it on the web", icon: "web", variant: "secondary" },
    ]) {
      for (const theme of ["light", "dark"]) {
        await page.setViewportSize({ width: 900, height: 200 });
        await page.goto(`${TEMPLATE}#${encodeURIComponent(JSON.stringify({ kind: "button", theme, width: 900, height: 200, ...b }))}`);
        await page.reload();
        await page.waitForSelector("body[data-ready]");
        const out = join(DOCS, "buttons", `${b.name}-${theme}.png`);
        await page.locator(".button-wrap").screenshot({ path: out, omitBackground: true });
        execFileSync("magick", [out, "-strip", "-define", "png:compression-level=9", out]);
        console.log(`✓ button ${b.name} ${theme} (${kb(statSync(out).size)})`);
      }
    }
  }

  // MARK: Social preview (1280×640 PNG; GitHub takes up to 1 MB)
  if (wanted("social")) {
    const image = raw(social.source, "dark");
    if (image) {
      const png = join(TMP, "social.png");
      await render({ kind: "social", theme: "dark", width: 1280, height: 640, image, icon: pathToFileURL(join(repo, "web/public/icon-512.png")).href, url: "scoreline-web.lame-o.workers.dev", tagline: social.tagline, tags: social.tags }, png);
      const out = join(DOCS, "social-preview.png");
      execFileSync("magick", [png, "-strip", "-define", "png:compression-level=9", out]);
      if (statSync(out).size > 1_000_000) execFileSync("magick", [png, "-strip", "-dither", "FloydSteinberg", "-colors", "256", "-define", "png:compression-level=9", out]);
      console.log(`✓ social preview (${kb(statSync(out).size)})`);
    }
  }
} finally {
  await browser?.close();
  rmSync(TMP, { recursive: true, force: true });
}
