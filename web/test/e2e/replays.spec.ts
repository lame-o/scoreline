/**
 * Click a play, watch it (Replays.swift, ReplayWell.swift): on the `?demo`
 * pages of all four sports, a row whose play replays (the scoring plays,
 * key plays, key events) opens the isometric view under it: the well
 * unfolds, its canvas draws the play (a frame loop while it plays), its
 * control plays it again once it holds; Esc closes it and the focus goes
 * back to the row. The keyboard opens one at once (Return on a row that's a
 * button; the "Watch Replay" glyph on football's rows, whose names are
 * links). With Reduce Motion it opens on how the play ended. axe finds
 * nothing with a well open. Screenshots at 390 and 1440 in light and dark
 * (Reduce Motion: the end, the same every run) go to SCORELINE_SCREENSHOTS.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = process.env.SCORELINE_SCREENSHOTS ?? join("test-results", "screenshots");
mkdirSync(OUT, { recursive: true });

const PAGES = [
  { sport: "baseball", url: "/game/espn-401908044?demo", links: false },
  { sport: "football", url: "/game/espn-401873016?demo", links: true },
  { sport: "basketball", url: "/game/espn-401909869?demo&league=nba", links: false },
  { sport: "soccer", url: "/game/espn-401879256?demo&league=eng.1", links: true },
] as const;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
  return errors;
}

/** How much of a canvas is drawn on (the share of pixels with any alpha). */
const inked = (canvas: Locator) =>
  canvas.evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext("2d");
    if (!ctx || el.width === 0) return 0;
    const { data } = ctx.getImageData(0, 0, el.width, el.height);
    let n = 0;
    for (let i = 3; i < data.length; i += 4 * 16) if (data[i]! > 0) n++;
    return n / (data.length / (4 * 16));
  });

type Probe = { __theaterFrames?: number[] };
const frames = (page: Page) => page.evaluate(() => (window as unknown as Probe).__theaterFrames?.length ?? 0);

/** The first row in the page's key moments whose play replays, once the page has read its plays (held by its place, as it opens and closes). */
async function replayableRow(page: Page): Promise<Locator> {
  await expect(page.locator('[data-section="moments"] [data-replay="ready"]').first()).toBeVisible({ timeout: 30_000 });
  // By its words: a live list grows at the top as plays are told.
  const rows = page.locator('[data-section="moments"] li > div:first-child');
  const words = await rows.evaluateAll((els) => els.find((el) => el.getAttribute("data-replay") === "ready")?.textContent ?? "");
  const row = rows.filter({ hasText: words }).first();
  await row.scrollIntoViewIfNeeded();
  return row;
}

/** A click on the row beside any link in it (its clock). */
const clickRow = (row: Locator) => row.locator("span").first().click();

const well = (page: Page) => page.locator("[data-replay-well]");

for (const size of [
  { name: "390", width: 390, height: 844, mobile: true },
  { name: "1440", width: 1440, height: 900, mobile: false },
] as const) {
  for (const scheme of ["light", "dark"] as const) {
    test.describe(`${size.name} ${scheme} replays`, () => {
      test.use({ viewport: { width: size.width, height: size.height }, colorScheme: scheme, isMobile: size.mobile, hasTouch: size.mobile, deviceScaleFactor: 2, reducedMotion: "reduce" });

      for (const { sport, url } of PAGES) {
        test(`${sport}: a row opens its play in the isometric view, as it ended`, async ({ page }) => {
          const errors = watchErrors(page);
          await page.goto(url);
          const row = await replayableRow(page);
          if (size.mobile) await row.locator("span").first().tap();
          else await clickRow(row);
          await expect(well(page).locator("canvas")).toBeVisible({ timeout: 15_000 });
          await expect.poll(() => inked(well(page).locator("canvas")), { timeout: 5_000 }).toBeGreaterThan(0.5);
          // With Reduce Motion it opens on how the play ended, with the control to play it.
          await expect(page.getByRole("button", { name: "Replay the play" })).toHaveAttribute("data-shown", "true");
          await page.waitForTimeout(500);
          await row.locator("xpath=ancestor::li[1]").screenshot({ path: join(OUT, `replay-${sport}-${size.name}-${scheme}.png`) });
          expect(errors).toEqual([]);
        });
      }
    });
  }
}

test.describe("replays on the live pages", () => {
  test.use({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", deviceScaleFactor: 2 });
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as Probe).__theaterFrames = [];
    });
  });

  for (const { sport, url } of PAGES) {
    test(`${sport}: a click unfolds the well and plays the play; it holds with its control; Esc closes it`, async ({ page }) => {
      const errors = watchErrors(page);
      await page.goto(url);
      const row = await replayableRow(page);
      await clickRow(row);
      const canvas = well(page).locator("canvas");
      await expect(canvas).toBeVisible({ timeout: 15_000 });
      // It plays: the stage's loop runs (the live theater above may run too; the replay adds its own).
      const before = await frames(page);
      await expect.poll(() => frames(page), { timeout: 10_000 }).toBeGreaterThan(before + 30);
      expect(await inked(canvas)).toBeGreaterThan(0.5);
      // Played through, it holds as it ended with the control in the corner.
      await expect(page.getByRole("button", { name: "Replay the play" })).toHaveAttribute("data-shown", "true", { timeout: 20_000 });
      // One open at a time; clicked again, it closes.
      await clickRow(row);
      await expect(well(page)).toHaveCount(0, { timeout: 2_000 });
      await clickRow(row);
      await expect(well(page)).toHaveCount(1);
      // Esc closes it (before it would go back), and the page stays.
      const at = page.url();
      await page.keyboard.press("Escape");
      await expect(well(page)).toHaveCount(0, { timeout: 2_000 });
      expect(page.url()).toBe(at);
      expect(errors).toEqual([]);
    });
  }

  test("the keyboard opens a row's replay at once, and Esc gives the focus back to the row", async ({ page }) => {
    await page.goto(PAGES[0].url);
    const row = await replayableRow(page);
    await expect(row).toHaveAttribute("role", "button");
    await expect(row).toHaveAttribute("aria-expanded", "false");
    await row.focus();
    await page.keyboard.press("Enter");
    await expect(row).toHaveAttribute("aria-expanded", "true");
    await expect(well(page)).toHaveCount(1);
    // The control is the next stop, and plays it again.
    await page.getByRole("button", { name: "Replay the play" }).focus();
    await page.keyboard.press("Escape");
    await expect(well(page)).toHaveCount(0, { timeout: 2_000 });
    await expect(row).toBeFocused();
  });

  test("football: a row holding names opens through its glyph, a button of its own", async ({ page }) => {
    await page.goto(PAGES[1].url);
    const row = await replayableRow(page);
    const glyph = row.getByRole("button", { name: "Watch Replay" });
    await glyph.focus();
    await page.keyboard.press("Enter");
    await expect(well(page)).toHaveCount(1);
    await expect(row.getByRole("button", { name: "Close Replay" })).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(well(page)).toHaveCount(0, { timeout: 2_000 });
  });

  test("axe finds nothing with a well open", async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const found: string[] = [];
    for (const { url } of PAGES) {
      await page.goto(url);
      const row = await replayableRow(page);
      await clickRow(row);
      await expect(well(page).locator("canvas")).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(400);
      const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]).disableRules(["label-content-name-mismatch"]).analyze();
      for (const v of result.violations) found.push(`${url}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target.join(" ")}`);
    }
    expect(found, found.join("\n")).toEqual([]);
  });
});
