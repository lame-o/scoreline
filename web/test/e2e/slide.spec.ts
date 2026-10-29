/**
 * The scoring slide (ScoringSlideView.swift), live under `?demo`: the MLB
 * replay (World Series Game 3, the bottom of the 9th; src/data/demo.ts)
 * starts one entry before Yandy Díaz's RBI double reaches the lane, so the
 * run arrives as news. The Rays' lower third slides in from their side of
 * the hero while the scoreboard steps aside, says it once, is moved under
 * the docked bar when the page scrolls, and leaves; axe stays at zero with
 * it on screen.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { join } from "node:path";

const OUT = process.env.SCORELINE_SCREENSHOTS ?? join("test-results", "screenshots");

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} scoring slide`, () => {
    test.use({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, deviceScaleFactor: 2 });

    test("a run scores: the slide comes in from the scorer's side, is said once, moves under the docked bar, and leaves; axe at zero", async ({ page }) => {
      test.setTimeout(90_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));

      await page.goto("/game/espn-401908044?demo&mlb=8");
      await expect(page.getByRole("heading", { level: 1, name: /Brewers \d+, Rays \d+/ })).toBeAttached({ timeout: 20_000 });
      // History never slides: nothing on screen until the run arrives.
      await expect(page.locator("[data-scoring-slide]")).toHaveCount(0);

      // The run: the Rays (home, the hero's right) from the right, in their words, with the new score.
      const slide = page.locator("[data-scoring-slide]");
      await expect(slide).toHaveCount(1, { timeout: 30_000 });
      await expect(slide).toHaveAttribute("data-edge", "trailing");
      await expect(slide).toContainText("RBI DOUBLE");
      await expect(slide).toContainText("+1");
      await expect(slide).toContainText("Díaz doubles to center · Mullins scores");
      // The kicker (who and when) and the tally, the scorer's row first.
      await expect(slide).toContainText("Rays · Bot 9th");
      await expect(slide.locator("[data-row='mine']")).toHaveText("TB 1");
      await expect(slide.locator("[data-row='theirs']")).toHaveText("MIL 10");
      // Over the hero card, never in the page's flow, and hidden from screen readers (its one announcement says it).
      const card = page.locator("[data-scoring-slide]").locator("xpath=ancestor::*[@aria-hidden='true'][1]");
      await expect(card).toHaveCount(1);
      // The scoreboard steps aside entirely while it's up (its glass and everything in it).
      await expect(card.locator("xpath=..").locator(":scope > :not([data-slide-host])").first()).toHaveCSS("opacity", "0");
      await expect(page.locator("[aria-live='polite']").filter({ hasText: "Rays RBI double, Díaz, 1 run, Brewers lead 10 to 1" })).toHaveCount(1, { timeout: 5_000 });
      await page.waitForTimeout(1100);
      await page.screenshot({ path: join(OUT, `1440-${scheme}-slide-hero.png`) });

      // axe with the slide on screen.
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]).disableRules(["label-content-name-mismatch"]).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);

      // Scrolled: the docked bar is the scoreboard, and the slide rides just under it (landed: no second wipe).
      await page.evaluate(() => {
        const main = document.getElementById("main");
        (main && main.scrollHeight > main.clientHeight ? main : window).scrollTo(0, 700);
      });
      await expect(page.locator('button[title="Back to top"]').locator("..")).toHaveCSS("opacity", "1");
      await expect(slide).toHaveCount(1);
      const bar = await page.locator('button[title="Back to top"]').boundingBox();
      const under = await slide.boundingBox();
      expect(bar && under && under.y >= bar.y + bar.height).toBe(true);
      await page.screenshot({ path: join(OUT, `1440-${scheme}-slide-docked.png`) });

      // It holds 4.5 s from landing, then leaves the way it came, and nothing is left behind.
      await expect(slide).toHaveCount(0, { timeout: 10_000 });
      expect(errors, errors.join("\n")).toEqual([]);
    });
  });
}

test.describe("Scoring slides off", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Settings → Live Games turns them off; the run is then told by the moment as before", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/settings");
    const toggle = page.getByRole("switch", { name: /Scoring slides/ });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await page.goto("/game/espn-401908044?demo&mlb=8");
    await expect(page.locator("[aria-live='polite']").filter({ hasText: /^Run scores\. Díaz doubled to center/ })).toHaveCount(1, { timeout: 30_000 });
    await expect(page.locator("[data-scoring-slide]")).toHaveCount(0);
  });
});
