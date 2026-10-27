/**
 * The QA pass's regressions, end to end:
 *
 * - axe (WCAG 2.1 A and AA plus best practice) on every page type, live
 *   pages under `?demo`, in both schemes at a phone and a desktop width;
 * - Back names where it goes, and hides beside the sidebar only when the
 *   sidebar is where it leads; the skip link reaches the page;
 * - the list never announces (game pages only);
 * - offline, a page says it can't connect instead of holding placeholders;
 * - worst-case names stay inside a tile and the game's hero.
 *
 * `label-content-name-mismatch` is off: rows and tiles are deliberately
 * labeled with the game in words ("Liverpool 3, Brighton 1, 67th minute"),
 * which begins with the names on screen but can't contain "67'" verbatim.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROUTES = [
  "/",
  "/?demo",
  "/game/espn-401908044?demo&mlb=8",
  "/game/espn-401873016?demo",
  "/game/espn-401879256?demo&league=eng.1&soccer=6",
  "/game/espn-401909869?demo&league=nba",
  "/game/cs-132240?demo",
  "/game/ifsc-1489-0?demo",
  "/schedule",
  "/schedule/eng.1?mode=results",
  "/schedule/climbing",
  "/schedule/tournaments",
  "/standings/nba",
  "/rankings/college-football",
  "/bracket/mlb/2026",
  "/results/climbing/1489/5?category=Lead%20Women&event=Santiago",
  "/team/espn-football-12",
  "/player/nba-1966",
  "/player/cs2-zywoo",
  "/settings",
  "/settings/league/eng.1",
  "/game/espn-1",
];

async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(1200);
}

for (const size of [
  { name: "390", width: 390, height: 844 },
  { name: "1440", width: 1440, height: 900 },
] as const) {
  for (const scheme of ["light", "dark"] as const) {
    test.describe(`${size.name} ${scheme} accessibility`, () => {
      test.use({ viewport: { width: size.width, height: size.height }, colorScheme: scheme, reducedMotion: "reduce" });
      test("axe finds nothing on any page type", async ({ page }) => {
        test.setTimeout(240_000);
        const found: string[] = [];
        for (const route of ROUTES) {
          await page.goto(route);
          await settle(page);
          const result = await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
            .disableRules(["label-content-name-mismatch"])
            .analyze();
          for (const v of result.violations) found.push(`${route}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target.join(" ")}`);
        }
        expect(found, found.join("\n")).toEqual([]);
      });
    });
  }
}

test.describe("Back", () => {
  test("names the page it returns to, on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/standings/nba");
    await expect(page.getByRole("button", { name: "Back to Scores" })).toBeVisible();
    await page.goto("/schedule");
    await settle(page);
    const game = page.locator("main a[href^='/game/']").first();
    test.skip((await game.count()) === 0, "No games on the schedule today");
    await game.click();
    await expect(page.getByRole("button", { name: "Back to Schedule" })).toBeVisible();
    await page.getByRole("button", { name: "Back to Schedule" }).click();
    await expect(page).toHaveURL(/\/schedule$/);
  });

  test("beside the sidebar, shows only when it leads somewhere the sidebar isn't", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?demo");
    await settle(page);
    // Picked in the sidebar: the sidebar is the way back.
    await page.locator("aside a[data-nav-id]").first().click();
    await expect(page.locator("main h1")).toBeVisible();
    await expect(page.locator("main").getByRole("button", { name: /^Back to/ })).toHaveCount(0);
    // A league's page opened from Settings: Back leads to Settings.
    await page.goto("/settings");
    await page.locator("main a[href^='/settings/league/']").first().click();
    await expect(page.getByRole("button", { name: "Back to Settings" })).toBeVisible();
  });

  test("a keyboard can skip the sidebar's games", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/standings/nba");
    await settle(page);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to Page" })).toBeFocused();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.closest("main") != null)).toBe(true);
  });
});

test("the list never announces; a game page has one polite region", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/game/espn-401908044?demo&mlb=8");
  await settle(page);
  await expect(page.locator('aside [role="status"], aside [aria-live]:not([aria-live="off"])')).toHaveCount(0);
  await expect(page.getByText(/^\d+ Live$/)).toBeVisible();
});

test.describe("offline", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => Object.defineProperty(Navigator.prototype, "onLine", { configurable: true, get: () => false }));
    await context.route("**/api/**", (route) => route.abort("internetdisconnected"));
  });

  test("the scores say they can't connect, at once", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Can't Load Scores" })).toBeVisible({ timeout: 8_000 });
  });

  test("a game says it can't load, not that it doesn't exist", async ({ page }) => {
    await page.goto("/game/espn-401908044?league=mlb");
    await expect(page.getByRole("heading", { level: 1, name: "Can't Load Game" })).toBeVisible({ timeout: 8_000 });
    await expect(page.getByRole("button", { name: "Try Again" })).toBeVisible();
  });
});

test.describe("worst-case names", () => {
  const fixture = JSON.parse(readFileSync(join(import.meta.dirname, "..", "fixtures", "espn-eng1-scoreboard.json"), "utf8")) as { events: Record<string, unknown>[] };
  const event = structuredClone(fixture.events[0]!) as { id: string; date: string; status: unknown; competitions: { competitors: { team: Record<string, unknown>; score: string }[]; details: unknown[] }[] };
  event.id = "999990";
  event.date = new Date(Date.now() - 3_600_000).toISOString().replace(/:\d\d\.\d+Z$/, "Z");
  event.status = { clock: 5400, displayClock: "90'+12'", period: 2, type: { state: "in", completed: false, shortDetail: "90'+12'", detail: "90'+12'" } };
  event.competitions[0]!.details = [];
  const [home, away] = event.competitions[0]!.competitors;
  Object.assign(home!.team, { displayName: "Wolverhampton Wanderers Football Club of the West Midlands", shortDisplayName: "Wolverhampton Wanderers Football Club of the West Midlands", abbreviation: "WOLVERHAMPTON" });
  Object.assign(away!.team, { displayName: "Borussiamönchengladbachfußballvereinigung", shortDisplayName: "Borussiamönchengladbachfußballvereinigung", abbreviation: "BMGFVG" });
  home!.score = "1234";
  away!.score = "999";

  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => localStorage.setItem("scoreline.settings.v1", JSON.stringify({ enabledLeagues: ["eng.1"], landingView: "tiles" })));
    await context.route("**/api/site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard**", (route) => route.fulfill({ json: { events: [event] } }));
  });

  test("a large tile truncates a name it can't fit", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/");
    const tile = page.locator('aside a[data-nav-id="espn-999990"]');
    await expect(tile).toBeVisible({ timeout: 15_000 });
    const box = (await tile.boundingBox())!;
    for (const name of await tile.locator("[class*='_name_']").all()) {
      const r = (await name.boundingBox())!;
      expect(r.x).toBeGreaterThanOrEqual(box.x - 1);
      expect(r.x + r.width).toBeLessThanOrEqual(box.x + box.width + 1);
    }
  });

  test("the game's hero keeps long names on the screen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/game/espn-999990?league=eng.1");
    await expect(page.locator("main h1")).toBeAttached({ timeout: 15_000 });
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
});
