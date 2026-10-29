/**
 * Win Probability with Polymarket's odds (core/odds/), on the recorded games
 * of the render harness (/dev/odds: GSW @ MIN and Aston Villa v Manchester
 * City through the real section, feed and a stand-in socket): it draws, the
 * live end carries its badge, a quiet market makes no frames, the scrub reads
 * a minute, leaving the page closes the socket and nothing runs after; a
 * two-way final keeps its end dot without a badge, a soccer final ends on its
 * bands. Saves screenshots to SCORELINE_SCREENSHOTS.
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

async function open(page: Page, query: string) {
  await page.goto(`/dev/odds?${query}`);
  const s = section(page);
  await s.locator("canvas").waitFor();
  await s.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  return s;
}

test.describe("live odds", () => {
  test("a live game: drawn, badged, idle while the market is quiet, read by the scrub, closed on leaving", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await countFrames(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    const s = await open(page, "game=nba&state=live&at=150&speed=1");
    await expect(s.getByRole("heading", { name: "Win Probability" })).toBeVisible();
    await expect(s.getByRole("radiogroup", { name: "Window" })).toBeVisible();
    // The badge names the leader with whole points.
    await expect(s.locator('[data-part="badge"]')).toHaveText(/^(GS|MIN) \d{1,2}%$/);
    await page.waitForTimeout(1500);
    await s.screenshot({ path: join(OUT, "odds-live-1440-light.png") });

    // A quiet market: nothing draws.
    const before = await frames(page);
    await page.waitForTimeout(3000);
    expect(await frames(page)).toBe(before);

    // The scrub: a minute, every series, the game clock.
    const plot = s.getByRole("slider");
    const box = (await plot.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5);
    const tip = s.locator('[data-part="tooltip"]');
    await expect(tip).toContainText("Polymarket");
    await expect(tip).toContainText("ESPN");
    // The game clock (ESPN writes the last minute in tenths: "Q2 0.0") and the wall time.
    await expect(tip).toContainText(/Q\d [\d:.]+ · \d+:\d\d/);
    await expect(plot).toHaveAttribute("aria-valuetext", /Polymarket: .+ percent/);

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

  test("a two-way final keeps its end dot without a badge; a soccer final ends on its bands", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "dark" });
    let s = await open(page, "game=nba&state=final");
    await expect(s.getByRole("heading", { name: "How the Odds Moved" })).toBeVisible();
    await expect(s.locator('[data-part="badge"]')).toHaveCount(0);
    await expect(s.locator('[data-part="end"]')).toHaveCSS("opacity", "1");
    await s.screenshot({ path: join(OUT, "odds-final-390-dark.png") });
    s = await open(page, "game=soccer&state=final");
    await expect(s.getByText("How Polymarket's market saw it: AVL win, draw or MNC win.")).toBeVisible();
    await expect(s.locator('[data-part="end"]')).toHaveCSS("opacity", "0");
  });
});
