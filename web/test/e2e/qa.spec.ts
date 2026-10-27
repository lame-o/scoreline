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

test.describe("failing upstream, online", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  // Online, an upstream answering 502 used to hold a page's placeholders for the 20–50 s
  // of its retries. Now the first failure shows, and the page keeps trying behind it.
  for (const { path, upstream, title, recovered } of [
    { path: "/standings/nba", upstream: "**/api/site.api.espn.com/apis/v2/sports/basketball/nba/standings**", title: "Can't Load Table", recovered: /Eastern|Western/ },
    { path: "/schedule/nba", upstream: "**/api/site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard**", title: "Can't Load Schedule", recovered: null },
    { path: "/team/espn-football-12", upstream: "**/api/site.api.espn.com/apis/site/v2/sports/football/nfl/teams/12**", title: "Can't Load Team", recovered: null },
  ]) {
    test(`${path} says it can't load at its first failure, and keeps trying`, async ({ page, context }) => {
      let failing = true;
      let asked = 0;
      await context.route(upstream, (route) => {
        asked += 1;
        return failing ? route.fulfill({ status: 502, body: "{}" }) : route.fallback();
      });
      const start = Date.now();
      await page.goto(path);
      await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 8_000 });
      expect(Date.now() - start).toBeLessThan(8_000);
      await expect(page.getByText("Scoreline will try again automatically.")).toBeVisible();
      const first = asked;
      // The first attempt after it comes at 5 s; the error stays up through it.
      await page.waitForTimeout(6_000);
      expect(asked).toBeGreaterThan(first);
      await expect(page.getByRole("heading", { name: title })).toBeVisible();
      if (recovered) {
        failing = false;
        await expect(page.getByText(recovered).first()).toBeVisible({ timeout: 20_000 });
        await expect(page.getByRole("heading", { name: title })).toHaveCount(0);
      }
    });
  }
});

test.describe("worst-case chart labels", () => {
  // ESPN's abbreviations are 2–5 letters; these aren't. The soccer summary's real match (Villa v City)
  // under a scoreboard entry whose teams carry a club's whole name and a long code.
  const board = JSON.parse(readFileSync(join(import.meta.dirname, "..", "fixtures", "espn-eng1-scoreboard.json"), "utf8")) as { events: Record<string, unknown>[] };
  const summary = JSON.parse(readFileSync(join(import.meta.dirname, "..", "fixtures", "espn-soccer-summary.json"), "utf8")) as Record<string, unknown>;
  const event = structuredClone(board.events[0]!) as { id: string; date: string; status: unknown; competitions: { competitors: { id: string; homeAway: string; team: Record<string, unknown>; score: string }[]; details: unknown[] }[] };
  event.id = "999991";
  event.date = new Date(Date.now() - 3 * 3_600_000).toISOString().replace(/:\d\d\.\d+Z$/, "Z");
  event.status = { clock: 5400, displayClock: "90'", period: 2, type: { state: "post", completed: true, shortDetail: "FT", detail: "FT", name: "STATUS_FULL_TIME" } };
  event.competitions[0]!.details = [];
  const [home, away] = event.competitions[0]!.competitors;
  home!.id = "362";
  away!.id = "382";
  Object.assign(home!.team, { id: "362", displayName: "Wolverhampton Wanderers Football Club", shortDisplayName: "Wolverhampton Wanderers", abbreviation: "WOLVERHAMPTON" });
  Object.assign(away!.team, { id: "382", displayName: "Borussiamönchengladbach", shortDisplayName: "Borussiamönchengladbach", abbreviation: "BMGFVG" });

  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => localStorage.setItem("scoreline.settings.v1", JSON.stringify({ enabledLeagues: ["eng.1"] })));
    await context.route("**/api/site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard**", (route) => route.fulfill({ json: { events: [event] } }));
    await context.route("**/api/site.api.espn.com/apis/site/v2/sports/soccer/eng.1/summary?event=999991**", (route) => route.fulfill({ json: summary }));
  });

  for (const width of [390, 1440]) {
    test(`team labels stay in their room at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/game/espn-999991?league=eng.1");
      const timeline = page.locator("section", { has: page.getByRole("img", { name: /^Timeline/ }) });
      await expect(timeline).toBeVisible({ timeout: 15_000 });
      // The lanes' names end before the track starts.
      const track = (await timeline.locator("svg rect[class*='_track_']").boundingBox())!;
      const names = timeline.locator("svg text[class*='_team_']");
      await expect(names).toHaveCount(2);
      for (const name of await names.all()) {
        const r = (await name.boundingBox())!;
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.x + r.width).toBeLessThanOrEqual(track.x + 1);
      }
      // A cut name keeps its full name in the tooltip.
      await expect(timeline.locator("svg text title").first()).toHaveText("WOLVERHAMPTON");
      // The line score's names stop short of the periods.
      const ls = page.locator("[class*='_lsNames_']").first();
      if (await ls.count()) {
        const box = (await ls.boundingBox())!;
        for (const n of await ls.locator("[class*='_lsNameText_']").all()) {
          const r = (await n.boundingBox())!;
          expect(r.x + r.width).toBeLessThanOrEqual(box.x + box.width + 1);
        }
      }
      expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth + 1)).toBe(true);
    });
  }
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
