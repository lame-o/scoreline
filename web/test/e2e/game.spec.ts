/**
 * The MLB game page, live, any time of day: the `?demo` harness replays the
 * bottom of the 9th of World Series Game 3 (src/data/demo.ts; `mlb=<n>`
 * starts n entries into Yandy Díaz's at-bat). At 390, 1024 and 1440 pixels,
 * light and dark: the hero, At the Plate with the play theater, This At-Bat
 * and its live count, the line score, the docked scorebar as the hero
 * scrolls away, and linked focus from a scoring play to its inning. Saves
 * screenshots to SCORELINE_SCREENSHOTS.
 */
import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = process.env.SCORELINE_SCREENSHOTS ?? join("test-results", "screenshots");
mkdirSync(OUT, { recursive: true });

const WIDTHS = [
  { name: "390", width: 390, height: 844, mobile: true },
  { name: "1024", width: 1024, height: 768, mobile: false },
  { name: "1440", width: 1440, height: 900, mobile: false },
] as const;

for (const size of WIDTHS) {
  for (const scheme of ["light", "dark"] as const) {
    test.describe(`${size.name} ${scheme} MLB game`, () => {
      test.use({ viewport: { width: size.width, height: size.height }, colorScheme: scheme, isMobile: size.mobile, hasTouch: size.mobile, deviceScaleFactor: 2 });

      test("live MLB page: hero, at the plate, at-bat, line score, docked bar, linked focus", async ({ page }) => {
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));

        await page.goto("/game/espn-401908044?demo&mlb=6");
        // The hero is the page's heading: the game in words.
        await expect(page.getByRole("heading", { level: 1, name: /Brewers \d+, Rays \d+/ })).toBeAttached({ timeout: 20_000 });
        await expect(page.getByRole("heading", { name: /At the Plate/ })).toBeVisible();
        // The live count beside the title, read with it.
        await expect(page.getByRole("heading", { name: /This At-Bat\s?, \d and \d/ })).toBeVisible();
        await expect(page.getByRole("img", { name: /Brewers: \d+ runs/ })).toBeAttached();
        // The play theater draws on a canvas under the diamond.
        await expect(page.locator('[data-section="atPlate"] canvas').first()).toBeAttached();
        await page.waitForTimeout(1500);
        await page.screenshot({ path: join(OUT, `${size.name}-${scheme}-mlb-live.png`) });

        // Scrolling the hero away docks the scorebar (an overlay: it never moves the page).
        const bar = page.locator('button[title="Back to top"]').locator("..");
        await expect(bar).toHaveCSS("visibility", "hidden");
        await page.evaluate(() => {
          const main = document.getElementById("main");
          (main && main.scrollHeight > main.clientHeight ? main : window).scrollTo(0, 700);
        });
        await expect(bar).toHaveCSS("opacity", "1");
        await page.waitForTimeout(400);
        await page.screenshot({ path: join(OUT, `${size.name}-${scheme}-mlb-docked.png`) });

        // Linked focus: pointing at a scoring play lights its inning in the line score (pointer devices only).
        if (!size.mobile) {
          await page.evaluate(() => {
            const main = document.getElementById("main");
            (main && main.scrollHeight > main.clientHeight ? main : window).scrollTo(0, 0);
          });
          await page.waitForTimeout(300);
          const play = page.locator('li[aria-label^="5th, Chourio"]');
          await play.scrollIntoViewIfNeeded();
          await play.hover();
          await expect(page.getByRole("img", { name: /Brewers: \d+ runs/ }).locator('[data-lit="true"]')).toHaveCount(1);
          await page.waitForTimeout(300);
          await page.screenshot({ path: join(OUT, `${size.name}-${scheme}-mlb-linked.png`) });
        }

        expect(errors, errors.join("\n")).toEqual([]);
      });
    });
  }
}
