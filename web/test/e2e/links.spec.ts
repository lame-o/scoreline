/**
 * Links the Mac has (ProfileLinks.swift `GoToPlayerItem`, `GoToTeamItem`,
 * TeamPage's "All Results"): "Go to {player}" from a row whose click is
 * taken (a box score line picks the player for the court; a climber's
 * result pins them), "Go to {opponent}" from a team page's game rows, and
 * "All Results" to the team's schedule facing back.
 */
import { expect, test } from "@playwright/test";

test.describe("links", () => {
  test.use({ viewport: { width: 1024, height: 900 } });

  test("a box score row's context menu goes to the player; a double click too", async ({ page }) => {
    await page.goto("/game/espn-401909869?demo&league=nba");
    const row = page.locator('[data-section="box"] [role=listitem]').first();
    await expect(row).toBeVisible({ timeout: 25_000 });
    // The name's own link says where it goes ("Go to J. McDaniels"); the row's menu says the same.
    const title = (await row.locator("a").first().getAttribute("title"))!;
    const box = (await row.boundingBox())!;
    // On the row's stats, not the name (a link keeps the browser's own menu).
    await page.mouse.click(box.x + box.width - 20, box.y + box.height / 2, { button: "right" });
    const item = page.getByRole("menuitem", { name: /^Go to / });
    await expect(item).toHaveText(title);
    await item.click();
    await expect(page).toHaveURL(/\/player\/nba-\d+/);
    await page.goBack();
    const again = page.locator('[data-section="box"] [role=listitem]').first();
    await expect(again).toBeVisible({ timeout: 25_000 });
    const b = (await again.boundingBox())!;
    await page.mouse.dblclick(b.x + b.width - 20, b.y + b.height / 2);
    await expect(page).toHaveURL(/\/player\/nba-\d+/);
  });

  test("a climber's result row goes to their page from its menu", async ({ page }) => {
    await page.goto("/game/ifsc-1489-0?demo");
    const row = page.locator('[data-section="results"] [role=group]').first();
    await expect(row).toBeVisible({ timeout: 25_000 });
    const box = (await row.boundingBox())!;
    await page.mouse.click(box.x + box.width - 12, box.y + box.height / 2, { button: "right" });
    await page.getByRole("menuitem", { name: /^Go to / }).click();
    await expect(page).toHaveURL(/\/player\/ifsc-\d+/);
  });

  test("a team page's results go to the opponent from a row's menu, and All Results opens the team's schedule", async ({ page }) => {
    await page.goto("/team/espn-football-12");
    const all = page.getByRole("link", { name: "All Results" });
    await expect(all).toBeVisible({ timeout: 25_000 });
    expect(await all.getAttribute("href")).toMatch(/^\/schedule\/team\/espn-football-12\?.*mode=results/);
    const result = page.locator('a[title="Open the match"]').filter({ hasText: /^(?!.*TBD)/ }).last();
    const box = (await result.boundingBox())!;
    await page.mouse.click(box.x + 40, box.y + box.height / 2, { button: "right" });
    await expect(page.getByRole("menuitem", { name: "Open in New Tab" })).toBeVisible();
    await page.getByRole("menuitem", { name: /^Go to / }).click();
    await expect(page).toHaveURL(/\/team\/espn-football-\d+/);
    await expect(page).not.toHaveURL(/\/team\/espn-football-12$/);
    await page.goBack();
    await all.click();
    await expect(page).toHaveURL(/\/schedule\/team\/espn-football-12\?.*mode=results/);
  });
});
