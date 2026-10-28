/**
 * Marketing screenshots, step 1: raw captures of every page, light and dark,
 * from the local dev server (`pnpm dev`), with the `?demo` harness replaying
 * recorded games live (src/data/demo.ts) and the live feeds for the rest.
 *
 *     pnpm dev                                   # one server, in another shell
 *     node scripts/marketing/capture.mjs          # every shot
 *     node scripts/marketing/capture.mjs mlb nfl  # only shots whose names contain these
 *
 * Writes PNGs to test-results/marketing/raw (SCORELINE_RAW to change it):
 * `<name>-<light|dark>.png`, plus `<name>-<theme>@<ms>.png` for each extra
 * frame a shot asks for (a theater mid-play). compose.mjs turns them into the
 * framed images in ../docs/screenshots. The shot list is shots.config.mjs.
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { captures, SETTINGS } from "./shots.config.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.SCORELINE_URL ?? "http://localhost:5173";
const RAW = process.env.SCORELINE_RAW ?? join(here, "../../test-results/marketing/raw");
const THEMES = (process.env.SCORELINE_THEMES ?? "light,dark").split(",");
mkdirSync(RAW, { recursive: true });

const filters = process.argv.slice(2);
const chosen = captures.filter((c) => filters.length === 0 || filters.some((f) => c.name.includes(f)));

const DEVICES = {
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 },
  // The phone's screen under its status bar: 390 × (844 − 54).
  phone: { viewport: { width: 390, height: 790 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Helpers each shot's `prepare` gets. */
function helpers(page, device) {
  return {
    sleep,
    /** Scrolls the page's own scroller (the detail pane beside the sidebar, the window on a phone) so `target` sits `offset` below the top. */
    async scrollTo(target, offset = 70) {
      const loc = typeof target === "string" ? page.locator(target).first() : target;
      await loc.waitFor({ state: "attached", timeout: 30_000 });
      await loc.evaluate((el, offset) => {
        let p = el.parentElement;
        while (p && !(p.scrollHeight > p.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(p).overflowY))) p = p.parentElement;
        const scroller = p ?? document.scrollingElement;
        const top = el.getBoundingClientRect().top - (p ? p.getBoundingClientRect().top : 0) + scroller.scrollTop - offset;
        scroller.scrollTo({ top, behavior: "instant" });
      }, offset);
      await sleep(500);
    },
    /** Scrolls the page's scroller by `dy` points. */
    async scrollBy(dy, selector = "main") {
      await page.evaluate(
        ([dy, selector]) => {
          const el = document.querySelector(selector);
          const scroller = el && el.scrollHeight > el.clientHeight + 4 ? el : document.scrollingElement;
          scroller.scrollBy({ top: dy, behavior: "instant" });
        },
        [dy, selector],
      );
      await sleep(400);
    },
    /** Waits until the scores have rows (or an empty state). */
    async scores() {
      await page.waitForFunction(() => document.querySelectorAll("[data-nav-id]").length > 0 || document.querySelector('[role="alert"]'), null, { timeout: 30_000 });
    },
    /** Waits for the network to go quiet (logos, photos), then a beat for entrances. */
    async settle(ms = 900) {
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      await sleep(ms);
    },
    device,
  };
}

const browser = await chromium.launch({ headless: true, args: ["--force-color-profile=srgb", "--font-render-hinting=none"] });
let failures = 0;
try {
  for (const shot of chosen) {
    const device = shot.device ?? "desktop";
    for (const theme of shot.themes ?? THEMES) {
      const context = await browser.newContext({ ...DEVICES[device], ...(shot.scale ? { deviceScaleFactor: shot.scale } : {}), colorScheme: theme, reducedMotion: "no-preference", locale: "en-US", timezoneId: "America/New_York" });
      await context.addInitScript(
        ([settings]) => {
          if (!localStorage.getItem("scoreline.settings.v1")) localStorage.setItem("scoreline.settings.v1", JSON.stringify(settings));
        },
        [{ ...SETTINGS, ...(shot.settings ?? {}) }],
      );
      const page = await context.newPage();
      const out = (suffix = "") => join(RAW, `${shot.name}-${theme}${suffix}.png`);
      const started = Date.now();
      try {
        await page.goto(BASE + shot.path, { waitUntil: "domcontentloaded" });
        const h = helpers(page, device);
        if (shot.prepare) await shot.prepare(page, h);
        else await h.settle();
        if (shot.frames) {
          // A beat that moves (a theater mid-play): one frame per moment, timed from the page opening.
          const t0 = shot.framesFrom === "prepare" ? Date.now() : started;
          for (const ms of shot.frames) {
            const wait = t0 + ms - Date.now();
            if (wait > 0) await sleep(wait);
            await page.screenshot({ path: out(`@${ms}`), clip: shot.clip });
          }
        }
        if (shot.element) await page.locator(shot.element).first().screenshot({ path: out() });
        else if (!shot.framesOnly) await page.screenshot({ path: out(), clip: shot.clip });
        console.log(`✓ ${shot.name} ${theme} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
      } catch (error) {
        failures++;
        console.error(`✗ ${shot.name} ${theme}: ${error.message.split("\n")[0]}`);
        await page.screenshot({ path: out("-failed") }).catch(() => {});
      } finally {
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
}
process.exitCode = failures ? 1 : 0;
