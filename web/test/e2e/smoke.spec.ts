/**
 * Smoke test: the app loads and works at 390, 1024 and 1440 pixels wide, in
 * light and dark, and leaves a screenshot of each state for review in
 * SCORELINE_SCREENSHOTS (default: test-results/screenshots).
 *
 * It uses the live feeds through the local Worker, so what's on screen
 * depends on the day; the assertions check structure, not scores.
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = process.env.SCORELINE_SCREENSHOTS ?? join("test-results", "screenshots");
mkdirSync(OUT, { recursive: true });

const WIDTHS = [
  { name: "390", width: 390, height: 844, mobile: true },
  { name: "1024", width: 1024, height: 768, mobile: false },
  { name: "1440", width: 1440, height: 900, mobile: false },
] as const;
const SCHEMES = ["light", "dark"] as const;

async function shot(page: Page, name: string) {
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false });
}

/** Waits for the scores to settle: the first games, or an empty or error state. */
async function waitForScores(page: Page) {
  await expect(page.getByRole("heading", { name: "Scores", level: 1 })).toBeVisible();
  await page.waitForFunction(() => document.querySelectorAll("[data-nav-id]").length > 0 || document.querySelector('[role="alert"]') != null, null, {
    timeout: 30_000,
  });
  // Let logos land and entrances finish.
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(600);
}

for (const size of WIDTHS) {
  for (const scheme of SCHEMES) {
    test.describe(`${size.name} ${scheme}`, () => {
      test.use({
        viewport: { width: size.width, height: size.height },
        colorScheme: scheme,
        hasTouch: size.mobile,
        isMobile: size.mobile,
        deviceScaleFactor: 2,
      });

      test("scores, tiles, a game and settings", async ({ page }) => {
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));

        await page.goto("/");
        await waitForScores(page);
        await shot(page, `${size.name}-${scheme}-list`);

        // Tiles.
        await page.getByRole("radio", { name: "Tiles" }).click();
        await page.waitForTimeout(700);
        await shot(page, `${size.name}-${scheme}-tiles`);
        await page.getByRole("radio", { name: "List" }).click();
        await page.waitForTimeout(400);

        // A game: the first row (live if there is one, the list puts them first).
        const first = page.locator("[data-nav-id]").first();
        if ((await first.count()) > 0) {
          await first.click();
          await expect(page).toHaveURL(/\/game\//);
          await page.waitForTimeout(700);
          await shot(page, `${size.name}-${scheme}-game`);
          // Esc goes back (phone) or deselects (split).
          await page.keyboard.press("Escape");
          await expect(page).toHaveURL(/\/$/);
        }

        // Keyboard: ↓ highlights the first game, Return opens it.
        await page.keyboard.press("ArrowDown");
        await expect(page.locator('[data-keyboard="true"]').first()).toBeVisible();
        await page.keyboard.press("Enter");
        await expect(page).toHaveURL(/\/game\//);
        await page.keyboard.press("Escape");

        // Settings.
        await page.getByRole("button", { name: "Settings" }).click();
        await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
        await page.waitForTimeout(500);
        await shot(page, `${size.name}-${scheme}-settings`);

        expect(errors, errors.join("\n")).toEqual([]);
      });
    });
  }
}
