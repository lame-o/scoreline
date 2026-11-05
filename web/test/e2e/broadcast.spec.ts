/**
 * The game as one broadcast on the page (BROADCAST.md §3; core/broadcast.tsx):
 * the `?demo` harness's NBA replay with `&broadcast` (its plays restamped onto
 * the harness's clock, src/data/demoCourtSoccer.ts), at 1024 and 1440 pixels.
 *
 * - Hovering the hero's live indicator, and the docked bar's, says how far
 *   behind live the page is ("About 45 s behind live"); nothing at rest, and
 *   the hero's heading says it to a screen reader.
 * - The hero's score never steps back while the plays are told at p.
 * - Without `&broadcast` the harness's pages show as before: no readout.
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = process.env.SCORELINE_SCREENSHOTS ?? join("test-results", "screenshots");
mkdirSync(OUT, { recursive: true });

function watch(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
  return errors;
}

const heroScores = async (page: Page) => {
  const name = (await page.getByRole("heading", { level: 1 }).first().textContent()) ?? "";
  const m = /Timberwolves (\d+), Cavaliers (\d+)/.exec(name);
  return m ? [Number(m[1]), Number(m[2])] : null;
};

for (const size of [
  { name: "1024", width: 1024, height: 768 },
  { name: "1440", width: 1440, height: 900 },
] as const) {
  test.describe(`${size.name} the broadcast`, () => {
    test.use({ viewport: { width: size.width, height: size.height }, colorScheme: "light" });

    test("live NBA at p: the behind-live readout on hover, a score that never steps back", async ({ page }) => {
      test.setTimeout(150_000);
      const errors = watch(page);
      // From 9.2 s left in overtime (ESPN's scores are consistent from there): the free throws, then the buzzer-beater.
      await page.goto("/game/espn-401909869?demo&league=nba&broadcast&nba=10");
      // The hero's heading says how far behind live, as the hover does.
      await expect(page.getByRole("heading", { level: 1, name: /Timberwolves \d+, Cavaliers \d+.*About \d+ (seconds|minute).* behind live/ })).toBeAttached({ timeout: 30_000 });
      // Nothing at rest.
      await expect(page.getByText(/behind live$/)).toHaveCount(0);
      // Hovering the hero's live indicator: the readout, once the pointer settles.
      const indicator = page.locator("[data-behind-live]").first();
      await indicator.hover();
      await expect(page.getByText(/^About \d+ (s|min)( \d+ s)? behind live$/)).toBeVisible({ timeout: 5_000 });
      await page.screenshot({ path: join(OUT, `${size.name}-light-broadcast-behind-live.png`) });
      // It leaves with the pointer.
      await page.mouse.move(5, size.height - 5);
      await expect(page.getByText(/^About \d+ (s|min)( \d+ s)? behind live$/)).toHaveCount(0, { timeout: 2_000 });
      // The plays are told at p: Peyton Watson's free throws (CLE 124) reach the hero when their moment
      // comes, well after the scoreboard had them, and the shown score never steps back, side by side.
      const seen: number[][] = [];
      const opened = Date.now();
      while (Date.now() - opened < 110_000) {
        const s = await heroScores(page);
        if (s) seen.push(s);
        if (s && s[1]! >= 124) break;
        await page.waitForTimeout(2_000);
      }
      expect(seen.at(-1)?.[1], `the free throws are told: ${JSON.stringify(seen)}`).toBeGreaterThanOrEqual(124);
      expect(seen.length, "told at p, not as they arrived (the scoreboard had them ~20 s in)").toBeGreaterThan(10);
      for (let i = 1; i < seen.length; i++) {
        expect(seen[i]![0]!, `away never steps back: ${JSON.stringify(seen)}`).toBeGreaterThanOrEqual(seen[i - 1]![0]!);
        expect(seen[i]![1]!, `home never steps back: ${JSON.stringify(seen)}`).toBeGreaterThanOrEqual(seen[i - 1]![1]!);
      }
      expect(errors).toEqual([]);
    });

    test("the harness without &broadcast shows the page as before: no readout", async ({ page }) => {
      const errors = watch(page);
      await page.goto("/game/espn-401909869?demo&league=nba&nba=16");
      await expect(page.getByRole("heading", { level: 1, name: /Timberwolves \d+, Cavaliers \d+/ })).toBeAttached({ timeout: 20_000 });
      await expect(page.locator("[data-behind-live]")).toHaveCount(0);
      await expect(page.getByRole("heading", { level: 1, name: /behind live/ })).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  });
}
