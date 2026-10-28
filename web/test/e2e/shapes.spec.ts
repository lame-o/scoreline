/**
 * Shapes as well as color (Settings → Appearance; the Mac's Differentiate
 * Without Color): the toggle marks the document, and charts add shape cues:
 * the bottom team's marks as rounded squares (the pitch, the spray chart),
 * dotted penalties and dashed turnovers on the drive, capsule rounds for the
 * bottom team in CS2.
 */
import { expect, test } from "@playwright/test";

test.describe("shapes as well as color", () => {
  test("the Appearance toggle marks the document, and it persists", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto("/settings");
    const toggle = page.getByRole("switch", { name: /Shapes as well as color/ });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(await page.evaluate(() => document.documentElement.dataset.shapes)).toBeUndefined();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.shapes)).toBe("true");
    await page.reload();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.shapes)).toBe("true");
  });

  test("charts add their shape cues", async ({ page, context }) => {
    await context.addInitScript(() => localStorage.setItem("scoreline.settings.v1", JSON.stringify({ differentiateWithoutColor: true })));
    await page.setViewportSize({ width: 1440, height: 900 });
    // The live pitch: the bottom team's legend swatch is a rounded square.
    await page.goto("/game/espn-401879256?demo&league=eng.1&soccer=6");
    const square = page.locator('[data-section="pitch"] [data-square="true"]');
    await expect(square).toHaveCount(1, { timeout: 20_000 });
    expect(await square.evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius))).toBeLessThan(3);
    // Balls in play: the same for the bottom team.
    await page.goto("/game/espn-401908044?demo&mlb=8");
    await expect(page.locator('[data-section="battedBalls"] [data-square="true"]')).toHaveCount(1, { timeout: 20_000 });
    // CS2: the bottom team's rounds are capsules.
    await page.goto("/game/cs-132237?demo");
    const bottom = page.locator('[data-section="rounds"] [data-side="bottom"][data-won="true"]').first();
    await expect(bottom).toBeVisible({ timeout: 20_000 });
    expect(await bottom.evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius))).toBeGreaterThan(6);
    const top = page.locator('[data-section="rounds"] [data-side="top"][data-won="true"]').first();
    expect(await top.evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius))).toBeLessThan(4);
  });
});
