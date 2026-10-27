/**
 * The season pages at 390, 1024 and 1440 pixels, light and dark: the
 * climbing season (Upcoming and Results), CS2's tournaments (Upcoming and
 * Results), a climbing category's full results, a CS2 tournament's results,
 * and the docked season bar. Screenshots go to SCORELINE_SCREENSHOTS as
 * `seasons-<page>-<width>-<scheme>.png`.
 *
 * Live feeds through the local Worker: the assertions check structure and
 * the rules (the disciplines setting, keyboard, the dock), not results.
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
const SCHEMES = ["light", "dark"] as const;

const PAGES = [
  { name: "climbing", path: "/schedule/climbing" },
  { name: "climbing-results", path: "/schedule/climbing?mode=results" },
  { name: "tournaments", path: "/schedule/tournaments" },
  { name: "tournament-results", path: "/schedule/tournaments?mode=results" },
  { name: "event-climbing", path: "/results/climbing/1489/5?category=Lead%20Women&event=Santiago" },
  { name: "event-cs2", path: "/results/tournament/esl-pro-league-season-24?name=ESL%20Pro%20League%20Season%2024" },
] as const;

async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForFunction(() => !document.querySelector('[role="status"][aria-label^="Loading"]'), null, { timeout: 30_000 });
  await page.waitForTimeout(700);
}

/** The page's scroller: the detail pane beside the sidebar, else the window. */
async function scrollBy(page: Page, y: number) {
  await page.evaluate((dy) => {
    const main = document.querySelector("main");
    if (main && getComputedStyle(main).overflowY !== "visible" && main.scrollHeight > main.clientHeight) main.scrollBy(0, dy);
    else window.scrollBy(0, dy);
  }, y);
  await page.waitForTimeout(400);
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
  return errors;
}

for (const size of WIDTHS) {
  for (const scheme of SCHEMES) {
    test.describe(`seasons ${size.name} ${scheme}`, () => {
      test.use({ viewport: { width: size.width, height: size.height }, colorScheme: scheme, hasTouch: size.mobile, isMobile: size.mobile, deviceScaleFactor: 1 });

      test("every season page", async ({ page }) => {
        const errors = collectErrors(page);
        for (const p of PAGES) {
          await page.goto(p.path);
          await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
          await settle(page);
          await page.screenshot({ path: join(OUT, `seasons-${p.name}-${size.name}-${scheme}.png`) });
        }
        expect(errors, errors.join("\n")).toEqual([]);
      });

      test("the season card docks into a slim bar", async ({ page }) => {
        test.skip(scheme === "light" && size.name !== "390", "one docked shot per width is enough");
        await page.goto("/schedule/climbing?mode=results");
        await settle(page);
        const bar = page.locator('[data-docked]');
        await expect(bar).toHaveAttribute("data-docked", "false");
        await scrollBy(page, 360);
        await expect(bar).toHaveAttribute("data-docked", "true");
        await page.screenshot({ path: join(OUT, `seasons-docked-${size.name}-${scheme}.png`) });
        // Back to the top from the bar.
        await bar.getByTitle("Back to top").click();
        await page.waitForTimeout(700);
        await expect(bar).toHaveAttribute("data-docked", "false");
      });
    });
  }
}

test.describe("climbing disciplines", () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test("untracked disciplines don't appear, and aren't fetched", async ({ page }) => {
    // Lead only: Tokyo (boulder only) disappears, no Boulder or Speed lane, no speed categories.
    await page.addInitScript(() => {
      const key = "scoreline.settings.v1";
      const stored = JSON.parse(localStorage.getItem(key) ?? "{}");
      localStorage.setItem(key, JSON.stringify({ ...stored, climbingDisciplines: ["lead"] }));
    });
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));
    await page.goto("/schedule/climbing");
    await settle(page);
    const card = page.getByRole("region", { name: "Season" });
    await expect(card.getByRole("img")).toBeVisible();
    const lanes = await card.locator("svg text").allTextContents();
    expect(lanes).toContain("Lead");
    expect(lanes).not.toContain("Boulder");
    expect(lanes).not.toContain("Speed");
    await expect(page.locator("[data-row-id]").filter({ hasText: "Tokyo" })).toHaveCount(0);
    // Tokyo 2027 is boulder only: its detail is never asked for.
    expect(requests.some((u) => /\/events\/1544(\?|$)/.test(u))).toBe(false);

    // Results: no speed category in a finished competition.
    await page.goto("/schedule/climbing?mode=results");
    await settle(page);
    await expect(page.getByText("Lead Women", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Speed Men", { exact: true })).toHaveCount(0);
  });

  test("arrow keys walk the competitions and Return opens one", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/schedule/climbing?mode=results");
    await settle(page);
    await page.locator('[role="region"][aria-label="Climbing results"]').focus();
    await page.keyboard.press("ArrowDown");
    const first = page.locator('[data-row-id]').first();
    await expect(first).toHaveAttribute("data-lit", "keyboard");
    await page.keyboard.press("Enter");
    await expect(first).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(first).toHaveAttribute("aria-expanded", "false");
  });
});
