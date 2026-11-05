/**
 * Win Probability with Polymarket's odds and the timeline that shares its
 * clock (core/odds/, core/timeline/), on the recorded games of the render
 * harness (/dev/odds: GSW @ MIN and Aston Villa v Manchester City through
 * the real sections, feed and a stand-in socket): a line per outcome with
 * its end labels, a quiet market makes no frames, pointing reads a moment
 * into the footer and both modules draw it in the same column
 * (MatchTimelineTests' alignment), the keyboard steps, holds a key play and
 * lets go (MatchInspectionTests' hosted checks), leaving the page closes the
 * socket and nothing runs after; a final keeps still ends; soccer's three
 * outcomes. Saves screenshots to SCORELINE_SCREENSHOTS.
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = process.env.SCORELINE_SCREENSHOTS ?? join("test-results", "screenshots");
mkdirSync(OUT, { recursive: true });

type Probe = { __frames?: number; __oddsDev?: { open: number; fetches: number; messages: number } };

/** Counts animation frame callbacks (the chart's glide is the only loop on the harness page). */
const countFrames = (page: Page) =>
  page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    (window as unknown as Probe).__frames = 0;
    window.requestAnimationFrame = (cb) =>
      raf((t) => {
        (window as unknown as Probe).__frames! += 1;
        cb(t);
      });
  });

const frames = (page: Page) => page.evaluate(() => (window as unknown as Probe).__frames ?? 0);
const activity = (page: Page) => page.evaluate(() => ({ ...(window as unknown as Probe).__oddsDev! }));
const section = (page: Page) => page.locator('[data-section="winProbability"]');
const timeline = (page: Page) => page.locator('[data-section="timeline"]');

async function open(page: Page, query: string) {
  await page.goto(`/dev/odds?${query}`);
  const s = section(page);
  await s.locator("canvas").first().waitFor();
  await s.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  return s;
}

/** The center of an element's box, in CSS pixels. */
const centerX = async (page: Page, selector: string) => {
  const box = await page.locator(selector).first().boundingBox();
  return box ? box.x + box.width / 2 : null;
};

test.describe("live odds", () => {
  test("a live game: a line per team with its end labels, idle while the market is quiet, read by pointing, closed on leaving", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await countFrames(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    const s = await open(page, "game=nba&state=live&at=150&speed=1");
    await expect(s.getByRole("heading", { name: "Win Probability" })).toBeVisible();
    await expect(s.getByRole("radiogroup", { name: "Window" })).toBeVisible();
    await expect(s.getByText("Polymarket's live market, a line per team.")).toBeVisible();
    // Each team's end label: its name and a whole percent.
    const labels = s.locator('[class*="_endLabel_"]');
    await expect(labels).toHaveCount(2);
    await expect(labels.first()).toHaveText(/^GS\s?\d{1,2}%$/);
    await page.waitForTimeout(1500);
    await s.screenshot({ path: join(OUT, "odds-live-1440-light.png") });

    // A quiet market: nothing draws.
    const before = await frames(page);
    await page.waitForTimeout(3000);
    expect(await frames(page)).toBe(before);

    // Pointing: the footer says where in the game and each source's chance; the timeline's rule is in the same column.
    const plot = s.getByRole("slider", { name: "Inspect win probability" });
    const box = (await plot.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5);
    await expect(s.getByText(/^Q\d [\d:.]+ · GS \d+% · ESPN \d+%$/)).toBeVisible();
    await expect(plot).toHaveAttribute("aria-valuetext", /GS, \d+ percent\. MIN, \d+ percent\./);
    const odds = await centerX(page, '[data-section="winProbability"] [data-part="rule"]');
    const line = await centerX(page, '[data-section="timeline"] [class*="_rule_"]');
    expect(odds).not.toBeNull();
    expect(line).not.toBeNull();
    expect(Math.abs(odds! - line!), "the timeline and the odds draw the same moment in the same column").toBeLessThan(0.5);
    await page.mouse.move(0, 0);
    await expect(s.locator('[data-part="rule"]')).toHaveCount(0);

    // Leaving the page closes the socket, and nothing runs after.
    expect((await activity(page)).open).toBe(1);
    await page.evaluate(() => {
      history.pushState({}, "", "/settings");
      dispatchEvent(new PopStateEvent("popstate"));
    });
    await page.waitForTimeout(500);
    const left = await activity(page);
    expect(left.open).toBe(0);
    await page.waitForTimeout(3000);
    expect(await activity(page)).toEqual(left);
    expect(errors).toEqual([]);
  });

  test("the keyboard: → reads, ⌥← holds a key play (the same pin as its row), Esc lets go", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await open(page, "game=nba&state=final");
    const scrub = section(page).getByRole("slider", { name: "Inspect win probability" });
    await scrub.focus();
    await page.keyboard.press("ArrowRight");
    await expect(scrub, "→ reads a moment: the keyboard's own reading").not.toHaveAttribute("aria-valuetext", /^Latest/);
    await page.keyboard.press("Escape");
    await expect(scrub, "Esc ends it").toHaveAttribute("aria-valuetext", /^Latest/);
    await page.keyboard.press("Alt+ArrowLeft");
    await expect(scrub, "⌥← holds a key play").toHaveAttribute("aria-valuetext", /^Held/);
    await expect(page.getByRole("button", { name: "Return to latest" })).toBeVisible();
    await expect(timeline(page).getByRole("slider")).not.toHaveAttribute("aria-valuetext", "Latest");
    await page.keyboard.press("Escape");
    await expect(scrub, "Esc lets go").toHaveAttribute("aria-valuetext", /^Latest/);
    await expect(page.getByRole("button", { name: "Return to latest" })).toHaveCount(0);
    // A period's label zooms both modules (the timeline to its one period); the way back is the whole game.
    await timeline(page).getByRole("button", { name: "Show Q3" }).click();
    await expect(timeline(page).getByRole("button", { name: /^Show Q/ })).toHaveCount(0);
    await section(page).getByRole("button", { name: "Show the whole game" }).first().click();
    await expect(timeline(page).getByRole("button", { name: "Show Q3" })).toBeAttached();
    await expect(timeline(page).getByRole("button", { name: /^Show Q/ })).toHaveCount(4);
  });

  test("a final keeps still ends; soccer's three outcomes, each its own line", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "dark" });
    let s = await open(page, "game=nba&state=final");
    await expect(s.getByRole("heading", { name: "How the Odds Moved" })).toBeVisible();
    await expect(s.locator('[class*="_ring_"]'), "a final's ends don't pulse").toHaveCount(0);
    await expect(s.locator('[class*="_endLabel_"]')).toHaveCount(2);
    await s.screenshot({ path: join(OUT, "odds-final-390-dark.png") });
    s = await open(page, "game=soccer&state=final");
    await expect(s.getByText("Polymarket's market through the game, a line per outcome.")).toBeVisible();
    await expect(s.locator('[class*="_endLabel_"]')).toHaveCount(3);
    await expect(s.locator('[class*="_endLabel_"]').nth(1)).toHaveText(/^Draw\s?\d{1,3}%$/);
    await timeline(page).screenshot({ path: join(OUT, "timeline-soccer-final-390-dark.png") });
  });
});
