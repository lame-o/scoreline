/**
 * Standings, polls and brackets at 390, 1024 and 1440 pixels, light and dark:
 * a soccer table, the NBA's seeds, college football's conference outline
 * (opened and closed by click), the Top 25, the MLB postseason and a CS2
 * tournament. Screenshots go to SCORELINE_SCREENSHOTS for review.
 *
 * Live feeds through the local Worker, so the assertions check structure
 * (rows, headings, the outline's state), not standings.
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

const PAGES = [
  { name: "standings-soccer", path: "/standings/eng.1", rows: 20 },
  { name: "standings-nba", path: "/standings/nba", rows: 30 },
  { name: "standings-college", path: "/standings/college-football?ring=espn-ncaaf-96", rows: 1 },
  { name: "standings-top25", path: "/rankings/college-football", rows: 25 },
  { name: "bracket-mlb", path: "/bracket/mlb/2026", cells: 7 },
  { name: "bracket-cs2", path: "/bracket/cs2/esl-pro-league-season-24?name=ESL%20Pro%20League%20Season%2024&ring=cs-667,cs-3598", cells: 7 },
] as const;

async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(500);
}

for (const size of WIDTHS) {
  for (const scheme of SCHEMES) {
    test.describe(`${size.name} ${scheme}`, () => {
      test.use({
        viewport: { width: size.width, height: size.height },
        colorScheme: scheme,
        hasTouch: size.mobile,
        isMobile: size.mobile,
        deviceScaleFactor: 1,
      });

      test("tables, polls and brackets", async ({ page }) => {
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));

        for (const p of PAGES) {
          await page.goto(p.path);
          await expect(page.getByRole("heading", { level: 1 }).last()).toBeVisible();
          if ("rows" in p) {
            await page.waitForFunction((n) => document.querySelectorAll('main a[href^="/team/"]').length >= n || document.querySelector('main [role="alert"]') != null, p.rows, {
              timeout: 30_000,
            });
          } else {
            await page.waitForFunction((n) => document.querySelectorAll('main [role="group"][tabindex="0"]').length >= n || document.querySelector('main [role="alert"]') != null, p.cells, {
              timeout: 30_000,
            });
          }
          await settle(page);
          await page.screenshot({ path: join(OUT, `${p.name}-${size.name}-${scheme}.png`) });
        }

        // College: the ringed team's conference starts open, the rest closed;
        // a click opens one (and builds its table).
        await page.goto("/standings/college-football?ring=espn-ncaaf-96");
        const headers = page.locator('main h2 button[aria-expanded]');
        await expect(headers.first()).toBeVisible({ timeout: 30_000 });
        await expect(headers.first()).toHaveAttribute("aria-expanded", "true");
        const closed = page.locator('main h2 button[aria-expanded="false"]').first();
        const title = ((await closed.getAttribute("aria-label")) ?? "").split(",")[0]!;
        await closed.click();
        const opened = page.locator(`main h2 button[aria-label^="${title},"]`);
        await expect(opened).toHaveAttribute("aria-expanded", "true");
        await expect(page.locator(`#conf-${title.replace(/\W+/g, "-")}`)).toBeVisible();
        await page.waitForTimeout(900);
        if (size.name === "1440") await page.screenshot({ path: join(OUT, `standings-college-open-${size.name}-${scheme}.png`) });

        expect(errors).toEqual([]);
      });
    });
  }
}
