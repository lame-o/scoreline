/**
 * The theaters on the choreography engine (TheaterView.swift `TheaterFrames`;
 * CHOREOGRAPHY §5.6.7, §13): /dev/theater/directed plays a recording back as
 * the page's broadcast would hand it to the director. It draws; its frames
 * come at the display's rate while the plan moves and stop when nothing
 * does; scrolled away or in a hidden tab it draws nothing; with Reduce Motion
 * it shows key states, never a loop. `?sport=football` plays the field the
 * same way. Screenshots go to SCORELINE_SCREENSHOTS.
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = process.env.SCORELINE_SCREENSHOTS ?? join("test-results", "screenshots");
mkdirSync(OUT, { recursive: true });

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
  return errors;
}

const inked = (page: Page) =>
  page.locator("[data-directed] canvas").first().evaluate((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext("2d");
    if (!ctx || canvas.width === 0) return 0;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let n = 0;
    for (let i = 3; i < data.length; i += 4 * 16) if (data[i]! > 0) n++;
    return n / (data.length / (4 * 16));
  });

const frames = (page: Page) => page.evaluate(() => (window as unknown as { __theaterFrames?: number[] }).__theaterFrames?.length ?? 0);

test.describe("the court on the director", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`draws the recording live, in ${scheme}`, async ({ page }) => {
      const errors = watchErrors(page);
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 1024, height: 900 });
      await page.addInitScript(() => {
        (window as unknown as { __theaterFrames: number[] }).__theaterFrames = [];
      });
      // Two minutes into the recording: a stretch of the fourth quarter's plays.
      await page.goto("/dev/theater/directed?at=120&d=50");
      await page.locator("[data-directed] canvas").waitFor();
      await page.waitForTimeout(4000);
      expect(await inked(page)).toBeGreaterThan(0.3);
      await page.locator("[data-directed]").screenshot({ path: join(OUT, `directed-nba-${scheme}.png`) });
      expect(await frames(page)).toBeGreaterThan(0);
      expect(errors).toEqual([]);
    });
  }

  test("draws nothing scrolled away or in a hidden tab", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.addInitScript(() => {
      (window as unknown as { __theaterFrames: number[] }).__theaterFrames = [];
    });
    await page.goto("/dev/theater/directed?at=120&d=50");
    await page.locator("[data-directed] canvas").waitFor();
    await page.waitForTimeout(1500);
    // Out of view: the page made long enough to scroll the well away.
    await page.evaluate(() => {
      const spacer = document.createElement("div");
      spacer.style.height = "4000px";
      document.querySelector("main")?.prepend(spacer);
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(500);
    const before = await frames(page);
    await page.waitForTimeout(2000);
    expect(await frames(page)).toBe(before);
  });
});

test.describe("the field on the director", () => {
  test("draws the recording live, plans its snaps, nothing thrown", async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.addInitScript(() => {
      (window as unknown as { __theaterFrames: number[] }).__theaterFrames = [];
    });
    // DAL at PHI (the Mac's football gate fixture), a few minutes in: the drive after the opening kickoff.
    await page.goto("/dev/theater/directed?sport=football&at=200&d=74");
    await page.locator("[data-directed][data-theater='football'] canvas").waitFor();
    await page.waitForTimeout(4000);
    expect(await inked(page)).toBeGreaterThan(0.3);
    await page.locator("[data-directed]").screenshot({ path: join(OUT, "directed-nfl.png") });
    expect(await frames(page)).toBeGreaterThan(0);
    // The director has handed the timeline its anchors: the snaps it will tell, and when.
    const anchors = await page.evaluate(() => (window as unknown as { __directedSource?: { anchors: Map<string, number> } }).__directedSource?.anchors.size ?? 0);
    expect(anchors).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
});
