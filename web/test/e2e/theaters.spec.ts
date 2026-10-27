/**
 * The football and soccer play theaters (FootballTheater.swift,
 * SoccerTheater.swift): key frames from the render harness
 * (/dev/theater/football and /dev/theater/soccer, `?t=` frozen) at 390 and
 * 1440 pixels in light and dark, and the theaters on the live `?demo` pages:
 * football in the Field section above the drive chart, soccer at the top of
 * the Live Pitch with its caption; each draws, replays a play that arrives,
 * stops its frame loop off screen and holds still between plays. Saves
 * screenshots to SCORELINE_SCREENSHOTS.
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = process.env.SCORELINE_SCREENSHOTS ?? join("test-results", "screenshots");
mkdirSync(OUT, { recursive: true });

const NFL = "/game/espn-401873016?demo";
const SOCCER = "/game/espn-401879256?demo&league=eng.1&soccer=6";

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
  return errors;
}

/** How much of a canvas is drawn on (the share of pixels with any alpha). */
const inked = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext("2d");
    if (!ctx || canvas.width === 0) return 0;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let n = 0;
    for (let i = 3; i < data.length; i += 4 * 16) if (data[i]! > 0) n++;
    return n / (data.length / (4 * 16));
  });

type Probe = { __theaterFrames?: number[] };

/** Frames the stages have drawn from their loops so far (TheaterStage pushes each one's draw time). */
const frames = (page: Page) => page.evaluate(() => (window as unknown as Probe).__theaterFrames?.length ?? 0);

const KEY_FRAMES = {
  football: [
    // The banner, its confetti and the fireworks over the goal line; the formation (heavy, an extra lineman
    // reported in), a snap off the right hash, the extra point as its own beat.
    ["Touchdown", "2.2"],
    ["Run", "0.3"],
    ["Off the right hash", "0.3"],
    ["Extra point", "1.8"],
  ],
  soccer: [
    // From behind the net as the header goes in; GOAL back on the main camera; the save from behind; PENALTY.
    ["Gabriel", "5.9"],
    ["Gabriel", "7.2"],
    ["Save", "2.6"],
    ["Penalty", "0.9"],
  ],
} as const;

for (const size of [
  { name: "390", width: 390, height: 844, mobile: true, frames: 1 },
  { name: "1440", width: 1440, height: 900, mobile: false, frames: 4 },
] as const) {
  for (const scheme of ["light", "dark"] as const) {
    test.describe(`${size.name} ${scheme} theaters`, () => {
      test.use({ viewport: { width: size.width, height: size.height }, colorScheme: scheme, isMobile: size.mobile, hasTouch: size.mobile, deviceScaleFactor: 2 });

      for (const sport of ["football", "soccer"] as const) {
        test(`${sport}: key frames from the harness`, async ({ page }) => {
          const errors = watchErrors(page);
          for (const [only, t] of KEY_FRAMES[sport].slice(0, size.frames)) {
            await page.goto(`/dev/theater/${sport}?only=${encodeURIComponent(only)}&t=${t}`);
            const tile = page.locator("[data-tile]").first();
            await expect(tile.locator("canvas")).toBeVisible({ timeout: 15_000 });
            // The moment is offered a tick after mount; its bursts arm with it.
            await page.waitForTimeout(300);
            expect(await inked(page, "[data-tile] canvas")).toBeGreaterThan(0.5);
            await tile.screenshot({ path: join(OUT, `theater-${sport}-${only.toLowerCase().replaceAll(" ", "-")}-${t}-${size.name}-${scheme}.png`) });
          }
          expect(errors).toEqual([]);
        });
      }
    });
  }
}

test.describe("theaters on the live pages", () => {
  test.use({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", deviceScaleFactor: 2 });
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as Probe).__theaterFrames = [];
    });
  });

  test("football: in the Field above the drive chart; replays a snap as it arrives", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(NFL);
    const field = page.locator('[data-section="field"]');
    const canvas = field.locator("[data-theater] canvas");
    await expect(canvas).toBeVisible({ timeout: 20_000 });
    // Above the drive chart, and no section of its own.
    const theaterBox = await canvas.boundingBox();
    const chartBox = await field.locator('[role="group"]').first().boundingBox();
    expect(theaterBox && chartBox && theaterBox.y < chartBox.y).toBeTruthy();
    await expect(page.locator('[data-section="theater"]')).toHaveCount(0);
    expect(await inked(page, '[data-section="field"] [data-theater] canvas')).toBeGreaterThan(0.5);
    // The demo serves a new snap every 5 s: it replays (the loop runs).
    await expect.poll(() => frames(page), { timeout: 15_000 }).toBeGreaterThan(30);
    await field.screenshot({ path: join(OUT, "theater-football-live-page-1440-dark.png") });
    expect(errors).toEqual([]);
  });

  test("off screen, a theater's loop stops (and its replay's clock with it)", async ({ page }) => {
    // A phone's one column: the page scrolls well past the field.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(NFL);
    await expect(page.locator('[data-section="field"] [data-theater] canvas')).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => frames(page), { timeout: 15_000 }).toBeGreaterThan(30);
    await page.evaluate(() => {
      const main = document.getElementById("main");
      (main && main.scrollHeight > main.clientHeight ? main : window).scrollTo(0, 1e6);
    });
    await expect(page.locator("[data-theater]")).not.toBeInViewport();
    await page.waitForTimeout(400);
    const away = await frames(page);
    // New snaps keep arriving every 5 s: none of them draws while it's unseen.
    await page.waitForTimeout(6000);
    expect(await frames(page)).toBe(away);
  });

  test("soccer: at the top of the Live Pitch with its caption; a moment replays as it arrives", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(SOCCER);
    const pitch = page.locator('[data-section="pitch"]');
    const canvas = pitch.locator("[data-theater] canvas");
    await expect(canvas).toBeVisible({ timeout: 20_000 });
    expect(await inked(page, '[data-section="pitch"] [data-theater] canvas')).toBeGreaterThan(0.5);
    // The caption says the moment in ESPN's words, with its minute.
    await expect(pitch.getByText(/^\d+(\+\d+)?'/).first()).toBeVisible();
    // The header arrives at the lane's second look and replays.
    await expect.poll(() => frames(page), { timeout: 25_000 }).toBeGreaterThan(60);
    await pitch.screenshot({ path: join(OUT, "theater-soccer-live-page-1440-dark.png") });
    expect(errors).toEqual([]);
  });

  test("Reduce Motion: no replay, each play crossfades to how it ended", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(NFL);
    await expect(page.locator('[data-section="field"] [data-theater] canvas')).toBeVisible({ timeout: 20_000 });
    expect(await inked(page, '[data-section="field"] [data-theater] canvas')).toBeGreaterThan(0.5);
    // Two new snaps (one every 5 s): a 0.35 s crossfade each, never a replay's hundreds of frames.
    const before = await frames(page);
    await page.waitForTimeout(10_500);
    expect((await frames(page)) - before).toBeLessThan(60);
  });

  test("football: a touchdown replayed is followed by its extra point, a short beat of its own, then the stage holds still", async ({ page }) => {
    await page.goto("/dev/theater/football?only=Touchdown");
    await expect(page.locator("[data-tile] canvas")).toBeVisible({ timeout: 15_000 });
    // The touchdown and its bursts run about 3.5 s; the try follows after a breath and runs about 3.4 s more.
    await page.waitForTimeout(4600);
    const during = await frames(page);
    await page.waitForTimeout(1000);
    expect((await frames(page)) - during).toBeGreaterThan(30);
    await page.waitForTimeout(4500);
    const settled = await frames(page);
    await page.waitForTimeout(1500);
    expect(await frames(page)).toBe(settled);
  });

  for (const [sport, only] of [
    ["football", "Field goal"],
    ["soccer", "Save"],
  ] as const) {
    test(`${sport}: a replay runs its course, then the stage holds still`, async ({ page }) => {
      await page.goto(`/dev/theater/${sport}?only=${encodeURIComponent(only)}`);
      await expect(page.locator("[data-tile] canvas")).toBeVisible({ timeout: 15_000 });
      await expect.poll(() => frames(page), { timeout: 10_000 }).toBeGreaterThan(60);
      // Settled (its bursts too): not a frame more.
      await page.waitForTimeout(8000);
      const settled = await frames(page);
      await page.waitForTimeout(1500);
      expect(await frames(page)).toBe(settled);
    });
  }
});
