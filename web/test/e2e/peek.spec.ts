/**
 * The chart peek (core/peek.tsx, LinkedPeek.swift), end to end on the `?demo`
 * pages: a row whose chart is out of view docks a live copy of that chart at
 * the viewport's edge on the chart's side after hover intent, follows at once
 * after that, holds and goes on the Mac's timings, and a click pins the row
 * and scrolls to the real chart. axe stays at zero with it open.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const SOCCER = "/game/espn-401879256?demo&league=eng.1&soccer=6";
const NBA = "/game/espn-401909869?demo&league=nba";

/** Scrolls a section to just under the docked bar, so the charts above it are out of view. */
async function bring(page: Page, section: string) {
  await page.locator(`[data-section="${section}"]`).waitFor({ timeout: 25_000 });
  await page.waitForTimeout(1200);
  await page.evaluate((s) => window.scrollBy(0, document.querySelector(`[data-section="${s}"]`)!.getBoundingClientRect().top - 160), section);
  await page.waitForTimeout(400);
}

async function hoverRow(page: Page, section: string, nth: number, selector = "li") {
  const row = page.locator(`[data-section="${section}"] ${selector}`).nth(nth);
  const box = (await row.boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + Math.min(box.height / 2, 10));
}

test.describe("chart peek", () => {
  test.use({ viewport: { width: 560, height: 760 } });

  test("a key event peeks at the pitch after hover intent, follows at once, and goes", async ({ page }) => {
    await page.goto(SOCCER);
    await bring(page, "moments");
    const peek = page.locator("[data-peek]");
    await hoverRow(page, "moments", 0);
    await page.waitForTimeout(200);
    await expect(peek).toHaveCount(0);
    await expect(peek).toHaveCount(1, { timeout: 1000 });
    await expect(peek).toHaveAttribute("aria-hidden", "true");
    await expect(peek).toContainText("Live Pitch");
    await expect(peek).not.toContainText(", Live");
    await expect(peek.locator("[data-points='above']").first()).toBeAttached();
    // Docked at the top, under the docked bar, at the trailing edge.
    const box = (await peek.boundingBox())!;
    expect(box.y).toBeGreaterThan(40);
    expect(box.y).toBeLessThan(140);
    expect(box.x + box.width).toBeGreaterThan(500);
    // The next row: no wait.
    await hoverRow(page, "moments", 1);
    await page.waitForTimeout(120);
    await expect(peek).toHaveCount(1);
    // Off the rows: it goes after its grace.
    await page.mouse.move(10, 700);
    await expect(peek).toHaveCount(0, { timeout: 1000 });
  });

  test("a click pins the row and scrolls to the real chart", async ({ page }) => {
    await page.goto(SOCCER);
    await bring(page, "moments");
    await hoverRow(page, "moments", 0);
    const peek = page.locator("[data-peek]");
    await expect(peek).toHaveCount(1, { timeout: 1000 });
    const pk = (await peek.boundingBox())!;
    await page.mouse.click(pk.x + pk.width / 2, pk.y + pk.height / 2);
    await expect(peek).toHaveCount(0, { timeout: 2000 });
    await page.waitForTimeout(900);
    const pitch = (await page.locator('[data-section="pitch"]').boundingBox())!;
    expect(pitch.y).toBeGreaterThan(-pitch.height * 0.4);
    expect(pitch.y).toBeLessThan(760 * 0.6);
    await expect(page.locator('[data-section="moments"] [data-pinned="true"]').first()).toBeAttached();
  });

  test("a box score player peeks at their shots on the court, in dark, with axe at zero", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(NBA);
    await bring(page, "box");
    await hoverRow(page, "box", 0, "[role=listitem]");
    const peek = page.locator("[data-peek]");
    await expect(peek).toHaveCount(1, { timeout: 1500 });
    await expect(peek).toContainText("Shot Chart");
    // The copy can't be tabbed to or clicked into.
    await expect(peek.locator("[inert]")).toHaveCount(1);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]).disableRules(["label-content-name-mismatch"]).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });

  test("with Reduce Motion it still shows, as a fade", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(SOCCER);
    await bring(page, "moments");
    await hoverRow(page, "moments", 0);
    await expect(page.locator("[data-peek]")).toHaveCount(1, { timeout: 1000 });
    const transform = await page.locator("[data-peek]").evaluate((el) => getComputedStyle(el).transform);
    expect(transform === "none" || transform === "matrix(1, 0, 0, 1, 0, 0)").toBe(true);
  });
});
