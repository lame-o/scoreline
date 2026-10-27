/**
 * The NBA and soccer game pages at 390, 1024 and 1440 pixels, light and dark.
 *
 * - Live, any time of day: the `?demo` harness replays MIN @ CLE's overtime
 *   (`nba=<n>` plays in) and Aston Villa v Manchester City from 51'
 *   (`soccer=<n>` actions in) through the pages' own fast lanes
 *   (src/data/demoCourtSoccer.ts).
 * - Final: the same games from ESPN (the real feeds, through the proxy).
 *
 * Checks the sections, the hero's CLUTCH chip, the docked bar's ball, the
 * buzzer-beater and the goal arriving as moments, linked focus from a box
 * score row to the court, and the replay scrubber; saves screenshots to
 * SCORELINE_SCREENSHOTS.
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = process.env.SCORELINE_SCREENSHOTS ?? join("test-results", "screenshots");
mkdirSync(OUT, { recursive: true });

const WIDTHS = [
  { name: "390", width: 390, height: 844, mobile: true, scale: 2 },
  { name: "1024", width: 1024, height: 768, mobile: false, scale: 1 },
  { name: "1440", width: 1440, height: 900, mobile: false, scale: 1 },
] as const;

/** Errors worth failing on (resource failures are the network's, not the page's). */
function watch(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
  return errors;
}

async function scrollPage(page: Page, y: number) {
  await page.evaluate((top) => {
    const main = document.getElementById("main");
    (main && main.scrollHeight > main.clientHeight ? main : window).scrollTo(0, top);
  }, y);
}

for (const size of WIDTHS) {
  for (const scheme of ["light", "dark"] as const) {
    test.describe(`${size.name} ${scheme} court and soccer`, () => {
      test.use({ viewport: { width: size.width, height: size.height }, colorScheme: scheme, isMobile: size.mobile, hasTouch: size.mobile, deviceScaleFactor: size.scale });
      const shot = (page: Page, name: string) => page.screenshot({ path: join(OUT, `${size.name}-${scheme}-${name}.png`) });

      test("live NBA: court, flow, box score, leaders, CLUTCH, the docked ball, the buzzer-beater", async ({ page }) => {
        const errors = watch(page);
        await page.goto("/game/espn-401909869?demo&league=nba&nba=16");
        await expect(page.getByRole("heading", { level: 1, name: /Timberwolves \d+, Cavaliers \d+/ })).toBeAttached({ timeout: 20_000 });
        for (const title of ["Shot Chart", "Game Flow", "Box Score", "Leaders", "Score by Quarter", "Key Plays"]) await expect(page.getByRole("heading", { name: new RegExp(title) })).toBeAttached();
        await expect(page.getByRole("img", { name: /^Shot chart\. Timberwolves: \d+ of \d+/ })).toBeAttached();
        await expect(page.getByRole("slider", { name: "Replay" })).toHaveAttribute("aria-valuetext", /^Live, /);
        // The last five minutes of overtime, within five.
        await expect(page.getByText("CLUTCH").first()).toBeVisible();
        // The buzzer-beater arrives through the lane as the court's moment.
        await expect(page.getByText("Buzzer-beater", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
        await page.waitForTimeout(400);
        await shot(page, "nba-live");
        // The docked bar: the score and the ball by the team that has it.
        await scrollPage(page, 900);
        const bar = page.locator('button[title="Back to top"]').locator("..");
        await expect(bar).toHaveCSS("opacity", "1");
        if (size.name === "390") await shot(page, "nba-docked");
        expect(errors, errors.join("\n")).toEqual([]);
      });

      test("final NBA: shot chart, replay, linked focus from the box score", async ({ page }) => {
        const errors = watch(page);
        await page.goto("/game/espn-401909869?league=nba");
        await expect(page.getByRole("heading", { name: /Shot Chart/ })).toBeVisible({ timeout: 30_000 });
        await expect(page.getByRole("heading", { name: /Injury Report/ })).toHaveCount(0);
        await expect(page.getByText(/DNP: .+ · Coach's decision/)).toBeAttached();
        await page.waitForTimeout(800);
        await shot(page, "nba-final");
        if (!size.mobile) {
          // Pointing at a player's row lights his shots on the court.
          const row = page.locator('[data-section="box"] [role="listitem"]').filter({ hasText: "A. Edwards" }).first();
          await row.hover();
          await expect(page.locator('[data-section="court"]').getByText(/^A\. Edwards/)).toBeVisible();
          // The replay: play moves the thumb through the game.
          await page.mouse.move(5, 5);
          const slider = page.getByRole("slider", { name: "Replay" });
          await page.getByRole("button", { name: "Replay the game" }).click();
          await page.waitForTimeout(1200);
          await page.getByRole("button", { name: "Pause replay" }).click();
          await expect(slider).toHaveAttribute("aria-valuetext", /^Q\d \d+:\d\d, /);
          if (size.name === "1440") await page.locator('[data-section="court"]').screenshot({ path: join(OUT, `${size.name}-${scheme}-nba-replay.png`) });
        }
        expect(errors, errors.join("\n")).toEqual([]);
      });

      test("live soccer: the pitch, the timeline, the table, the goal", async ({ page }) => {
        const errors = watch(page);
        await page.goto("/game/espn-401879256?demo&league=eng.1&soccer=6");
        await expect(page.getByRole("heading", { level: 1, name: /Aston Villa \d+, Man City \d+/ })).toBeAttached({ timeout: 20_000 });
        for (const title of ["Live Pitch", "Timeline", "Key Events", "Team Stats", "Table"]) await expect(page.getByRole("heading", { name: new RegExp(title) })).toBeAttached();
        await expect(page.getByRole("img", { name: /^Live pitch\. Latest:/ })).toBeAttached();
        // Haaland's header lands at the lane's second look.
        await expect(page.getByText("Goal", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
        await expect(page.getByRole("img", { name: /^Timeline to \d+ minutes: 2 goals/ })).toBeAttached({ timeout: 15_000 });
        await page.waitForTimeout(600);
        await shot(page, "soccer-live");
        expect(errors, errors.join("\n")).toEqual([]);
      });

      test("final soccer: shot map, key events with links, table", async ({ page }) => {
        const errors = watch(page);
        await page.goto("/game/espn-401879256?league=eng.1");
        await expect(page.getByRole("heading", { name: /Shot Map/ })).toBeVisible({ timeout: 30_000 });
        await expect(page.getByRole("img", { name: /^Shot map\. Aston Villa: \d+ shots, 2 goals/ })).toBeAttached();
        // Scorers and assists link to their pages.
        await expect(page.getByRole("link", { name: "Erling Haaland" }).first()).toBeAttached();
        await expect(page.getByRole("link", { name: "Full Table" })).toBeAttached();
        await page.waitForTimeout(800);
        await shot(page, "soccer-final");
        expect(errors, errors.join("\n")).toEqual([]);
      });
    });
  }
}
