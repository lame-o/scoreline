/**
 * What's streaming, and the scores list given more room, on the `?demo`
 * harness (src/data/demo.ts answers World Climbing's YouTube pages and
 * decapi.me as the live services would: Santiago's lead finals live on
 * YouTube, ohnePixel live in Counter-Strike with a watch party of the demo's
 * CS2 match in the title):
 *
 * - rows and tiles wear YouTube's live mark and the co-streamer's ring, and
 *   say so in their labels; a finished round wears no live mark;
 * - the climbing round's page offers its own stream, live, above the
 *   channel; the season card offers it while the competition is live;
 * - the CS2 page names the co-streamer under the hero and first in Watch;
 * - a list widened past the sidebar's 420pt shows the detail lane, then two
 *   up from 680pt with the arrow keys moving around the grid.
 *
 * Screenshots go to SCORELINE_SCREENSHOTS as `streams-<scheme>-<what>.png`.
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = process.env.SCORELINE_SCREENSHOTS ?? join("test-results", "screenshots");
mkdirSync(OUT, { recursive: true });

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
  return errors;
}

/** The sidebar at a width the Mac's panel can reach (it stops at 420pt today). */
async function widenList(page: Page, points: number) {
  await page.addStyleTag({ content: `:root { --sidebar-width: calc(${points} * var(--pt)) !important; }` });
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} streams and widths`, () => {
    test.use({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });

    test("rows and tiles: YouTube's live mark, the co-streamer's ring", async ({ page }) => {
      const errors = collectErrors(page);
      await page.goto("/?demo");
      const climbing = page.locator('aside a[aria-label*="Live on YouTube"]');
      await expect(climbing.first()).toBeAttached({ timeout: 30_000 });
      await expect(climbing).toHaveCount(1);
      await expect(climbing.first()).toHaveAttribute("aria-label", /Lead Women/);
      const cs = page.locator('aside a[aria-label*="ohnePixel is co-streaming"]');
      await expect(cs.first()).toBeAttached({ timeout: 30_000 });
      await expect(cs.first()).toHaveAttribute("aria-label", /Liquid/);
      // The marks themselves, beside the status.
      await expect(page.locator('aside [title="Streaming on YouTube"]')).toHaveCount(1);
      await expect(page.locator('aside [title="ohnePixel is co-streaming"]')).toHaveCount(1);
      await page.screenshot({ path: join(OUT, `streams-${scheme}-list.png`) });
      await page.getByRole("radio", { name: "Tiles" }).click();
      await expect(page.locator('aside a[aria-label*="Live on YouTube"]')).toHaveCount(1);
      await expect(page.locator('aside a[aria-label*="ohnePixel is co-streaming"]').first()).toBeAttached();
      await page.screenshot({ path: join(OUT, `streams-${scheme}-tiles.png`) });
      await page.getByRole("radio", { name: "List" }).click();
      expect(errors).toEqual([]);
    });

    test("pages: the round's own stream, the season card's Watch, the CS2 co-streamer", async ({ page }) => {
      const errors = collectErrors(page);
      await page.goto("/game/ifsc-1489-0?demo");
      const watch = page.locator('[data-section="climbingWatch"]');
      await expect(watch.getByRole("link", { name: /^YouTube, Lead finals \| Santiago 2026, Live now/ })).toHaveAttribute("href", /^https:\/\/www\.youtube\.com\/watch\?v=/, { timeout: 30_000 });
      await expect(watch.getByRole("link", { name: /^World Climbing on YouTube, all streams/ })).toHaveAttribute("href", "https://www.youtube.com/@WorldClimbing/streams");
      await watch.scrollIntoViewIfNeeded();
      await watch.screenshot({ path: join(OUT, `streams-${scheme}-climbing-watch.png`) });

      await page.goto("/schedule/climbing?demo");
      await expect(page.getByRole("link", { name: /^Watch live on YouTube/ })).toHaveAttribute("href", /^https:\/\/www\.youtube\.com\/watch\?v=/, { timeout: 30_000 });

      await page.goto("/game/cs-132240?demo&cs=17");
      // The badge under the hero (the sidebar's row says it too, in its label).
      await expect(page.locator("main").getByRole("link", { name: /ohnePixel is co-streaming/ }).first()).toHaveAttribute("href", "https://www.twitch.tv/ohnepixel", { timeout: 30_000 });
      const streams = page.locator('[data-section="streams"] a');
      await expect(streams.first()).toHaveAttribute("href", "https://www.twitch.tv/ohnepixel");
      expect(errors).toEqual([]);
    });

    test("a wider list: the detail lane, then two up with the arrow keys around the grid", async ({ page }) => {
      const errors = collectErrors(page);
      await page.goto("/?demo");
      const nfl = page.locator('aside a[aria-label*="Patriots"]').first();
      await expect(nfl).toBeAttached({ timeout: 30_000 });
      // The sidebar's 420pt (less its scroll gutter): compact or records, no lane yet.
      await expect(page.locator("aside [data-detail]").first()).toBeAttached();
      await expect(page.locator('aside [data-detail="lane"]')).toHaveCount(0);

      await widenList(page, 560);
      await expect(page.locator('aside [data-detail="lane"]').first()).toBeAttached();
      // The situation moves into the lane: beside the teams, not under them.
      const name = await nfl.getByText("Patriots").first().boundingBox();
      const situation = await nfl.getByText(/& \d+ at /).first().boundingBox();
      expect(situation!.x).toBeGreaterThan(name!.x + 150);
      expect(Math.abs(situation!.y - name!.y)).toBeLessThan(30);
      await page.screenshot({ path: join(OUT, `streams-${scheme}-lane.png`) });

      await widenList(page, 760);
      await expect(page.locator('aside [data-columns="2"]').first()).toBeAttached();
      const rows = page.locator('aside [data-columns="2"]').first().locator("[data-nav-id]");
      expect(await rows.count()).toBeGreaterThan(1);
      const [a, b] = [await rows.nth(0).boundingBox(), await rows.nth(1).boundingBox()];
      // Two up: the second game sits beside the first, on one visual row.
      expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);
      expect(b!.x).toBeGreaterThan(a!.x + 100);
      await page.screenshot({ path: join(OUT, `streams-${scheme}-two-up.png`) });

      await page.locator("aside").click({ position: { x: 5, y: 5 } });
      await page.keyboard.press("ArrowDown");
      const first = await page.locator('aside [data-keyboard="true"]').getAttribute("data-nav-id");
      await page.keyboard.press("ArrowRight");
      const right = await page.locator('aside [data-keyboard="true"]').getAttribute("data-nav-id");
      expect(right).not.toBe(first);
      await page.keyboard.press("ArrowLeft");
      await expect(page.locator('aside [data-keyboard="true"]')).toHaveAttribute("data-nav-id", first!);
      expect(errors).toEqual([]);
    });
  });
}
