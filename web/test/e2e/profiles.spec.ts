/**
 * Team and player pages, end to end, at 390 and 1440 pixels in light and
 * dark, with a screenshot of each for review in SCORELINE_SCREENSHOTS
 * (default: test-results/screenshots). Live feeds through the local Worker,
 * so the assertions check structure and rules, not today's numbers:
 *
 * - every page has its hero heading, its first sections and no errors;
 * - MLB opens on the player's role and offers Batting | Pitching only to a
 *   two-way player (a starter's batting log is all-zero appearances);
 * - the hero photo is the hero-size crop, never the list's thumbnail;
 * - the glass bar docks as the hero scrolls away, without moving the page.
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = process.env.SCORELINE_SCREENSHOTS ?? join("test-results", "screenshots");
mkdirSync(OUT, { recursive: true });

const PAGES = [
  { name: "team-nfl", path: "/team/espn-football-12", heading: /Kansas City Chiefs/, section: "Roster" },
  { name: "player-nba", path: "/player/nba-1966", heading: /LeBron James/, section: "This Season" },
  { name: "player-mlb-pitcher", path: "/player/mlb-33190", heading: /Tyler Glasnow/, section: "Game Log" },
  { name: "player-mlb-two-way", path: "/player/mlb-39832", heading: /Shohei Ohtani/, section: "Game Log" },
  { name: "player-nfl", path: "/player/nfl-3139477", heading: /Patrick Mahomes/, section: "Game Log" },
  { name: "player-soccer", path: "/player/eng.1-280555", heading: /Bukayo Saka/, section: "All Competitions" },
  { name: "player-cs2", path: "/player/cs2-zywoo", heading: /ZywOo/, section: "Map Pool" },
] as const;

const SIZES = [
  { name: "390", width: 390, height: 844, mobile: true },
  { name: "1440", width: 1440, height: 900, mobile: false },
] as const;

/** The page's scroller: the detail pane beside the sidebar, else the window. */
async function scrollBy(page: Page, y: number) {
  await page.evaluate((dy) => {
    const main = document.querySelector("main");
    const pane = main && getComputedStyle(main).overflowY === "auto" ? main : null;
    (pane ?? window).scrollBy(0, dy);
  }, y);
}

for (const size of SIZES) {
  for (const scheme of ["light", "dark"] as const) {
    test.describe(`profiles ${size.name} ${scheme}`, () => {
      test.use({ viewport: { width: size.width, height: size.height }, colorScheme: scheme, isMobile: size.mobile, hasTouch: size.mobile, deviceScaleFactor: size.mobile ? 2 : 1 });

      for (const p of PAGES) {
        test(p.name, async ({ page }) => {
          const errors: string[] = [];
          page.on("pageerror", (e) => errors.push(e.message));
          page.on("console", (m) => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
          await page.goto(p.path);
          await expect(page.getByRole("heading", { level: 1, name: p.heading })).toBeAttached({ timeout: 30_000 });
          await expect(page.getByRole("region", { name: p.section })).toBeVisible({ timeout: 30_000 });
          await page.waitForLoadState("networkidle").catch(() => {});
          await page.waitForTimeout(700);
          await page.screenshot({ path: join(OUT, `${p.name}-${size.name}-${scheme}.png`) });
          expect(errors, errors.join("\n")).toEqual([]);
        });
      }
    });
  }
}

test.describe("profile rules", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test("MLB: Pitching only for two-way players", async ({ page }) => {
    await page.goto("/player/mlb-39832");
    // Ohtani's log opens on his role (batting) and offers his pitching.
    await expect(page.getByRole("radiogroup", { name: "Category" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("radio", { name: "Batting" })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("radio", { name: "Pitching" }).click();
    await expect(page.getByText("Game Score by start")).toBeVisible();

    await page.goto("/player/mlb-33190");
    await expect(page.getByRole("region", { name: "Game Log" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Game Score by start")).toBeVisible();
    // A starter's batting appearances are all zeros: no switch.
    await page.waitForLoadState("networkidle").catch(() => {});
    await expect(page.getByRole("radiogroup", { name: "Category" })).toHaveCount(0);
  });

  test("the hero photo is the hero's crop, and the bar docks without moving the page", async ({ page }) => {
    await page.goto("/player/nba-1966");
    const hero = page.locator('[class*="heroMedia"] img');
    await expect(hero).toHaveAttribute("src", /w=260&h=190/, { timeout: 30_000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    await expect(page.locator('[class*="dockBar"]')).toHaveCount(0);
    await scrollBy(page, 300);
    await expect(page.locator('[class*="dockBar"]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(height);
    await page.screenshot({ path: join(OUT, "player-nba-390-docked.png") });
    await page.locator('[class*="dockBar"]').click();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("a roster row opens its player, and Back returns to the team", async ({ page }) => {
    await page.goto("/team/espn-football-12");
    const mahomes = page.locator('a[href="/player/nfl-3139477"]').first();
    await expect(mahomes).toBeVisible({ timeout: 30_000 });
    await mahomes.click();
    await expect(page.getByRole("heading", { level: 1, name: /Patrick Mahomes/ })).toBeAttached();
    // The Back button names the page the link was on.
    await expect(page.getByRole("button", { name: "Back to Chiefs" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/team\/espn-football-12$/);
  });
});
