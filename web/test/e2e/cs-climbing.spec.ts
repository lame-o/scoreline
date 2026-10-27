/**
 * The CS2 match and climbing round pages, live and final, any time of day:
 * the `?demo` harness replays a CS2 map round by round (`cs=<n>` starts n
 * rounds in) and Santiago's Lead Women Final climber by climber (`climb=<n>`
 * starts n steps in), through each page's own fast lane (src/data/demo.ts).
 * At 390, 1024 and 1440 pixels, light and dark: the hero, maps, rounds with
 * MATCH POINT, streams, the bracket link and rosters; On the Wall, the live
 * results and linked focus from a result to the wall; a finished CS2 match
 * (three maps, one to overtime), a lead final's High Points and a boulder
 * final's scorecard; the docked bar; the climbing wall strip on tiles.
 * Screenshots go to SCORELINE_SCREENSHOTS as `<width>-<scheme>-<page>.png`.
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = process.env.SCORELINE_SCREENSHOTS ?? join("test-results", "screenshots");
mkdirSync(OUT, { recursive: true });

const WIDTHS = [
  { name: "390", width: 390, height: 844, mobile: true },
  { name: "1024", width: 1024, height: 768, mobile: false },
  { name: "1440", width: 1440, height: 900, mobile: false },
] as const;

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
  return errors;
}

/** The page's scroller: the detail pane beside the sidebar, else the window. */
async function scrollTo(page: Page, y: number) {
  await page.evaluate((top) => {
    const main = document.getElementById("main");
    (main && main.scrollHeight > main.clientHeight ? main : window).scrollTo(0, top);
  }, y);
  await page.waitForTimeout(500);
}

for (const size of WIDTHS) {
  for (const scheme of ["light", "dark"] as const) {
    test.describe(`${size.name} ${scheme} CS2 and climbing`, () => {
      test.use({ viewport: { width: size.width, height: size.height }, colorScheme: scheme, isMobile: size.mobile, hasTouch: size.mobile, deviceScaleFactor: size.mobile ? 2 : 1 });

      test("CS2 live: hero, maps, rounds to MATCH POINT, streams, bracket, rosters", async ({ page }) => {
        const errors = collectErrors(page);
        // 11–7 on Inferno: Liquid take round 19 five seconds in (12–7, match point).
        await page.goto("/game/cs-132240?demo&cs=17");
        await expect(page.getByRole("heading", { level: 1, name: /Liquid 1, Aurora 0\. Inferno \d+ to \d+\..*Round \d+/ })).toBeAttached({ timeout: 20_000 });
        await expect(page.getByRole("heading", { name: /^Maps/ })).toBeVisible();
        await expect(page.getByRole("group", { name: /^Map 2, Inferno: Liquid \d+, Aurora \d+\. Live\./ })).toBeAttached();
        await expect(page.getByRole("heading", { name: /^Rounds\s?, Live/ })).toBeAttached();
        await expect(page.getByRole("group", { name: /^2nd half: Liquid \d+, Aurora \d+\. Match point Liquid\./ })).toBeAttached({ timeout: 15_000 });
        // Streams official first, on Twitch, YouTube or Kick only.
        const streams = page.locator('[data-section="streams"] a');
        await expect(streams.first()).toHaveAttribute("href", /^https:\/\/(www\.)?(twitch\.tv|youtube\.com|kick\.com)\//);
        expect(await streams.evaluateAll((links) => links.every((a) => /^https:\/\/([a-z]+\.)?(twitch\.tv|youtube\.com|youtu\.be|kick\.com)\//.test(a.getAttribute("href") ?? "")))).toBe(true);
        await expect(page.locator('[data-section="bracket"] a')).toHaveAttribute("href", /^\/bracket\/cs2\/pgl-masters-bucharest-2026\?/);
        await expect(page.locator('[data-section="rosters"] a[href^="/player/cs2-"]').first()).toBeAttached();
        await page.waitForTimeout(800);
        await page.screenshot({ path: join(OUT, `${size.name}-${scheme}-cs-live.png`) });

        // The rounds out of view: the docked bar takes the score, and the moment its status slot.
        if (size.mobile) {
          await scrollTo(page, 640);
          const bar = page.locator('button[title="Back to top"]').locator("..");
          await expect(bar).toHaveCSS("opacity", "1");
          await page.screenshot({ path: join(OUT, `${size.name}-${scheme}-cs-docked.png`) });
        }
        expect(errors, errors.join("\n")).toEqual([]);
      });

      test("CS2 final: three maps, overtime, the series winner's trophy", async ({ page }) => {
        const errors = collectErrors(page);
        await page.goto("/game/cs-132237?demo");
        await expect(page.getByRole("heading", { level: 1, name: /G2 1, DENDELE 2\. Final\. DENDELE won/ })).toBeAttached({ timeout: 20_000 });
        await expect(page.getByRole("group", { name: /^Map 2, Ancient: G2 16, DENDELE 14\. G2 won\./ })).toBeAttached();
        await expect(page.getByRole("img", { name: "Winner" })).toBeAttached();
        // Overtime: the map's third block.
        await page.getByRole("radio", { name: "Ancient" }).click();
        await expect(page.getByRole("group", { name: /^Overtime 1: G2 \d, DENDELE \d\./ })).toBeAttached();
        // Pointing at a round says it in words (pointer devices).
        if (!size.mobile) {
          await page.locator('[data-section="rounds"] [data-side="top"]').first().hover();
          await expect(page.locator('[data-section="rounds"] p strong').first()).toHaveText(/won( as (CT|T))?$/);
          // The round's column: its square in each row rings.
          await expect(page.locator('[data-section="rounds"] [data-lit="true"]')).toHaveCount(2);
        }
        await page.waitForTimeout(400);
        await page.screenshot({ path: join(OUT, `${size.name}-${scheme}-cs-final.png`) });
        expect(errors, errors.join("\n")).toEqual([]);
      });

      test("climbing live: on the wall, live results, linked focus", async ({ page }) => {
        const errors = collectErrors(page);
        // Rogora on the wall, past two climbers already.
        await page.goto("/game/ifsc-1489-0?demo&climb=39");
        await expect(page.getByRole("heading", { level: 1, name: "Lead Women" })).toBeVisible({ timeout: 20_000 });
        await expect(page.getByRole("heading", { name: /^On the Wall\s?, Live/ })).toBeAttached();
        await expect(page.getByRole("img", { name: /is climbing, at \d+\+?, \d+(st|nd|rd|th) for now\./ })).toBeAttached();
        await expect(page.getByRole("heading", { name: /^Final · Live/ })).toBeAttached();
        // The hero wears the climber's flag; Watch links World Climbing's own channel.
        await expect(page.locator('[data-section="climbingWatch"] a')).toHaveAttribute("href", "https://www.youtube.com/@WorldClimbing/streams");
        if (!size.mobile) {
          // A result lights that climber on the wall.
          const row = page.locator('[data-section="results"] [role="group"]', { hasText: "Fisher" });
          await row.hover();
          await expect(page.locator('[data-section="ascent"] [data-lit="true"]')).toHaveCount(1);
          // A click beside the name pins; the name itself opens the climber's page.
          await row.click({ position: { x: 4, y: 4 } });
          await expect(row).toHaveAttribute("data-pinned", "true");
          await expect(row.getByRole("link", { name: /Fisher/ })).toHaveAttribute("href", /^\/player\/ifsc-\d+/);
        }
        await page.waitForTimeout(600);
        await page.screenshot({ path: join(OUT, `${size.name}-${scheme}-climbing-live.png`) });
        if (size.mobile) {
          await scrollTo(page, 420);
          const bar = page.locator('button[title="Back to top"]').locator("..");
          await expect(bar).toHaveCSS("opacity", "1");
          await page.screenshot({ path: join(OUT, `${size.name}-${scheme}-climbing-docked.png`) });
        }
        expect(errors, errors.join("\n")).toEqual([]);
      });

      test("climbing finals: high points and a boulder scorecard", async ({ page }) => {
        const errors = collectErrors(page);
        await page.goto("/game/ifsc-1489-1?demo");
        await expect(page.getByRole("heading", { name: /^Final · High Points\s?, Final/ })).toBeAttached({ timeout: 20_000 });
        await expect(page.getByRole("img", { name: /^J\. Utelli, Switzerland, / })).toBeAttached();
        await expect(page.getByRole("img", { name: "Winner" })).toBeAttached();
        await page.waitForTimeout(400);
        await page.screenshot({ path: join(OUT, `${size.name}-${scheme}-climbing-final-lead.png`) });

        await page.goto("/game/ifsc-1488-0?demo");
        await expect(page.getByRole("heading", { name: /^Final · Scorecard\s?, Final/ })).toBeAttached({ timeout: 20_000 });
        await expect(page.getByRole("group", { name: /^1st, O\. Bertone, 84\.6 points, 3 tops, 4 zones/ })).toBeAttached();
        await page.waitForTimeout(400);
        await page.screenshot({ path: join(OUT, `${size.name}-${scheme}-climbing-final-boulder.png`) });
        expect(errors, errors.join("\n")).toEqual([]);
      });
    });
  }
}

test.describe("1440 tiles: who's on the wall", () => {
  test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

  test("a live climbing tile shows the climber's height against the leader", async ({ page }) => {
    const errors = collectErrors(page);
    await page.addInitScript(() => {
      if (!sessionStorage.getItem("seeded")) {
        localStorage.setItem("scoreline.settings.v1", JSON.stringify({ landingView: "tiles", enabledLeagues: ["ifsc", "cs2"] }));
        sessionStorage.setItem("seeded", "1");
      }
    });
    await page.goto("/?demo&climb=33");
    const tile = page.locator('aside [data-nav-id="ifsc-1489-0"]');
    await expect(tile).toHaveAttribute("aria-label", /on the wall at hold \d+/, { timeout: 20_000 });
    await expect(tile).toContainText(/Leader /);
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, "1440-light-climbing-tiles.png") });
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
