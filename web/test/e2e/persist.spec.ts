/**
 * What survives a reload (state/persist.ts; ScheduleCache.swift,
 * ProfileCache.swift): a team page and a league's schedule, once loaded,
 * paint from disk after a reload even when the network then fails; the
 * scores (live data) never come from disk.
 */
import { expect, test } from "@playwright/test";

test.describe("persistent cache", () => {
  test.use({ viewport: { width: 1024, height: 900 } });

  test("a team page paints from disk after a reload with the network down", async ({ page, context }) => {
    await page.goto("/team/espn-football-12");
    const heading = page.locator("main h1");
    await expect(heading).toContainText(/Chiefs/, { timeout: 25_000 });
    const roster = page.locator('section[aria-label="Roster"] a').first();
    await expect(roster).toBeVisible({ timeout: 25_000 });
    const player = (await roster.getAttribute("href"))!;
    // Give the writes a moment (they land after each response).
    await page.waitForTimeout(800);
    await context.route("**/api/**", (route) => route.fulfill({ status: 502, body: "{}" }));
    await page.reload();
    await expect(heading).toContainText(/Chiefs/, { timeout: 5_000 });
    await expect(page.locator(`section[aria-label="Roster"] a[href="${player}"]`)).toBeVisible({ timeout: 5_000 });
  });

  test("a league's schedule paints from disk after a reload; the scores don't", async ({ page, context }) => {
    await page.goto("/schedule/eng.1");
    const row = page.locator('main a[href^="/game/"]').first();
    await expect(row).toBeVisible({ timeout: 25_000 });
    const href = (await row.getAttribute("href"))!;
    await page.waitForTimeout(800);
    await context.route("**/api/**", (route) => route.fulfill({ status: 502, body: "{}" }));
    await page.reload();
    await expect(page.locator(`main a[href="${href}"]`).first()).toBeVisible({ timeout: 5_000 });
    // The scores beside it are live data: never kept, so they say they can't load.
    await expect(page.getByRole("heading", { name: "Can't Load Scores" })).toBeVisible({ timeout: 10_000 });
  });
});
