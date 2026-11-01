import { expect, test } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const fixture = (name: string) => JSON.parse(readFileSync(join(import.meta.dirname, "../fixtures/competitions", `${name}.json`), "utf8"));
const out = process.env.SCORELINE_SCREENSHOTS ?? "test-results/screenshots";
mkdirSync(out, { recursive: true });

for (const size of [{ width: 390, height: 844, colorScheme: "dark" as const }, { width: 1280, height: 900, colorScheme: "light" as const }]) {
  test.describe(`soccer competitions ${size.width}`, () => {
    test.use({ viewport: size, colorScheme: size.colorScheme, reducedMotion: "reduce" });
    test("round navigation, match links, actual bracket, and refresh failure", async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      let fail = false;
      await page.route("**/*", async (route) => {
        const url = route.request().url();
        if (url.includes("sports.core.api.espn.com") && url.includes("/seasons/")) {
          if (fail) return route.fulfill({ status: 503, body: "Unavailable" });
          return route.fulfill({ json: fixture(url.includes("/2025") ? "previous-season" : "current-season") });
        }
        if (url.includes("/api/") && url.includes("soccer/eng.league_cup/summary")) {
          return route.fulfill({ json: fixture("match-summary") });
        }
        if (url.includes("/api/")) {
          return route.fulfill({ json: url.includes("soccer/eng.league_cup/scoreboard") ? fixture("boards") : { events: [], leagues: [] } });
        }
        if (!url.startsWith("http://127.0.0.1") && !url.startsWith("http://localhost")) return route.abort();
        return route.continue();
      });

      await page.goto("/competition/eng.league_cup/2026");
      const select = page.getByRole("combobox", { name: "Round or stage" });
      await expect(select).toBeVisible();
      await select.selectOption({ label: "Fourth Round" });
      const match = page.locator('main a[href*="401921842"]');
      await expect(match).toHaveCount(1);
      await expect(match).toContainText("Liverpool");
      await expect(page.getByRole("region", { name: "Bracket", exact: true })).toHaveCount(0);
      await page.waitForTimeout(800);
      await page.screenshot({ path: join(out, `soccer-current-${size.width}.png`) });
      await match.click();
      await expect(page).toHaveURL(/401921842\?league=soccer%2Feng.league_cup/);
      await expect(page.locator('main a[href="/competition/eng.league_cup/2026"]')).toBeVisible();
      await page.goBack();
      await select.selectOption({ label: "Final" });
      await expect(page.getByText("Fixtures have not been published for this round.")).toBeVisible();

      await page.goto("/competition/eng.league_cup/2025");
      await expect(page.getByRole("heading", { name: "Bracket", exact: true })).toBeVisible();
      await select.selectOption({ label: "Semifinals" });
      await expect(page.locator("main [data-nav-id]")).toHaveCount(4);
      await page.waitForTimeout(800);
      await page.screenshot({ path: join(out, `soccer-bracket-${size.width}.png`) });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      fail = true;
      await page.locator("main").getByRole("button", { name: "Refresh", exact: true }).click();
      await expect(page.getByText(/Can't connect/)).toBeVisible();
      await expect(page.getByRole("heading", { name: "Bracket", exact: true })).toBeVisible();
      expect(errors).toEqual([]);
    });
  });
}
