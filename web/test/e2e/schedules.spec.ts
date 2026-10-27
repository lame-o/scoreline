/**
 * Schedules and results (features/schedule): every page type at 390, 1024
 * and 1440 pixels, light and dark, with a screenshot of each for review in
 * SCORELINE_SCREENSHOTS, and the interactions that make them work: folding a
 * day, the arrow keys, ⌥2 to Results, stepping rounds, the section menu.
 *
 * Live feeds through the local Worker: assertions check structure, not
 * today's games.
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

const ARSENAL = "/schedule/team/espn-soccer-359?name=Arsenal&logo=https%3A%2F%2Fa.espncdn.com%2Fi%2Fteamlogos%2Fsoccer%2F500%2F359.png";

const PAGES = [
  { name: "schedule-all", path: "/schedule" },
  { name: "schedule-nfl-week", path: "/schedule/nfl" },
  { name: "schedule-epl-days", path: "/schedule/eng.1" },
  { name: "schedule-team", path: ARSENAL },
  { name: "results-epl-rounds", path: "/schedule/eng.1?mode=results" },
  { name: "results-mlb-days", path: "/schedule/mlb?mode=results" },
  { name: "results-team", path: `${ARSENAL}&mode=results` },
  { name: "league-hub", path: "/settings/league/eng.1" },
] as const;

/** Waits for a schedule page to settle: rows, a note, an empty or an error state. */
async function settle(page: Page) {
  await page.waitForFunction(
    () => document.querySelectorAll("main [data-nav-id], main [data-day]").length > 0 || document.querySelector('main [role="alert"]') != null || document.querySelector("main h2") != null,
    null,
    { timeout: 30_000 },
  );
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(700);
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
  return errors;
}

for (const size of WIDTHS) {
  for (const scheme of SCHEMES) {
    test.describe(`${size.name} ${scheme}`, () => {
      test.use({
        viewport: { width: size.width, height: size.height },
        colorScheme: scheme,
        hasTouch: size.mobile,
        isMobile: size.mobile,
        deviceScaleFactor: size.mobile ? 2 : 1,
      });

      test("every schedule and results page", async ({ page }) => {
        const errors = collectErrors(page);
        for (const p of PAGES) {
          await page.goto(p.path);
          await settle(page);
          // The mode switch says which way the page faces (a league page leads with both).
          const results = p.path.includes("mode=results");
          if (p.path.startsWith("/schedule")) await expect(page.getByRole("radio", { name: results ? "Results" : "Upcoming" })).toHaveAttribute("aria-checked", "true");
          else await expect(page.getByRole("link", { name: "Full Schedule" })).toBeVisible();
          await page.screenshot({ path: join(OUT, `${p.name}-${size.name}-${scheme}.png`) });
        }
        expect(errors).toEqual([]);
      });
    });
  }
}

test.describe("interactions", () => {
  test.use({ viewport: { width: 1024, height: 768 }, colorScheme: "light" });

  test("fold a day, move with the keys, switch to Results with ⌥2", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/schedule");
    await settle(page);
    // A folded day opens by click, and its rows arrive.
    const folded = page.locator('main button[aria-expanded="false"][aria-controls^="day-rows-"]').first();
    if ((await folded.count()) > 0) {
      const controls = await folded.getAttribute("aria-controls");
      await folded.click();
      await expect(page.locator(`#${controls}`)).toBeVisible();
      await page.waitForTimeout(900);
      // Folding it again by keyboard is instant.
      await page.locator(`main button[aria-controls="${controls}"]`).press("Enter");
      await expect(page.locator(`#${controls}`)).toHaveCount(0);
    }
    // ↓ lights a row with the keyboard's accent.
    await page.locator("main").click({ position: { x: 5, y: 300 } });
    await page.keyboard.press("ArrowDown");
    await expect(page.locator('main [data-nav-id][data-keyboard="true"]')).toHaveCount(1);
    // ⌥2 faces Results, in place.
    await page.keyboard.press("Alt+Digit2");
    await expect(page).toHaveURL(/mode=results/);
    await expect(page.getByRole("radio", { name: "Results" })).toHaveAttribute("aria-checked", "true");
    expect(errors).toEqual([]);
  });

  test("step back a round and come back to the latest", async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 900 });
    await page.goto("/schedule/eng.1?mode=results");
    await settle(page);
    const picker = page.getByRole("button", { name: "Choose a round" });
    await expect(picker).toBeVisible();
    const latest = await picker.textContent();
    await page.getByRole("button", { name: "Previous round" }).click();
    await expect(picker).not.toHaveText(latest ?? "");
    await page.keyboard.press("t");
    await expect(picker).toHaveText(latest ?? "");
  });

  test("a section's menu opens its schedule", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("aside [data-nav-id]").first()).toBeVisible({ timeout: 30_000 });
    const section = page.locator("aside h2[data-has-menu='true']").first();
    await section.hover();
    await section.locator("[data-section-menu] button").click();
    await page.getByRole("menuitem", { name: "Schedule" }).click();
    await expect(page).toHaveURL(/\/schedule/);
    await settle(page);
  });
});
