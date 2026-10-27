/**
 * Live states, any time of day: the dev server's `?demo` harness replays
 * fixtures with games in progress (src/data/demo.ts). Checks the live count,
 * running clocks, strips and the score flash, and saves screenshots.
 */
import { expect, test } from "@playwright/test";
import { join } from "node:path";

const OUT = process.env.SCORELINE_SCREENSHOTS ?? join("test-results", "screenshots");

for (const { name, width, height, mobile } of [
  { name: "390", width: 390, height: 844, mobile: true },
  { name: "1440", width: 1440, height: 900, mobile: false },
]) {
  for (const scheme of ["light", "dark"] as const) {
    test.describe(`${name} ${scheme} live`, () => {
      test.use({ viewport: { width, height }, colorScheme: scheme, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2 });

      test("live games: clocks, strips and the score flash", async ({ page }) => {
        await page.goto("/?demo");
        await expect(page.getByRole("status", { name: /games? in progress/ })).toBeVisible({ timeout: 20_000 });
        await page.waitForTimeout(800);
        await page.screenshot({ path: join(OUT, `${name}-${scheme}-live-list.png`) });

        // A refresh makes the demo's games score: the rows flash.
        await page.getByRole("button", { name: "Refresh" }).click();
        await page.waitForTimeout(450);
        await page.screenshot({ path: join(OUT, `${name}-${scheme}-live-flash.png`) });

        await page.getByRole("radio", { name: "Tiles" }).click();
        await page.waitForTimeout(800);
        await page.screenshot({ path: join(OUT, `${name}-${scheme}-live-tiles.png`) });

        // A live game's page.
        await page.locator("[data-nav-id]").first().click();
        await expect(page).toHaveURL(/\/game\//);
        await page.waitForTimeout(700);
        await page.screenshot({ path: join(OUT, `${name}-${scheme}-live-game.png`) });
      });
    });
  }
}
