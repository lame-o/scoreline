/**
 * The app shell: a game's context menu (right-click, Shift-F10, a long press
 * on touch), the pinned game in the tab's title and favicon, the section
 * menu's Move and Hide, the bare-key commands, alerts for followed teams,
 * Settings' new toggles, the detail pane's scroll memory, and the PWA
 * manifest. Uses the `?demo` harness for live games; screenshots go to
 * SCORELINE_SCREENSHOTS.
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = process.env.SCORELINE_SCREENSHOTS ?? join("test-results", "screenshots");
mkdirSync(OUT, { recursive: true });

/** Settings as stored, before the app loads. */
async function withSettings(page: Page, settings: Record<string, unknown>) {
  await page.addInitScript((s) => {
    if (!sessionStorage.getItem("shell-test-seeded")) {
      localStorage.setItem("scoreline.settings.v1", JSON.stringify(s));
      sessionStorage.setItem("shell-test-seeded", "1");
    }
  }, settings);
}

/** A stand-in for the browser's notifications: asks once, grants, and records what's posted. */
async function fakeNotifications(page: Page) {
  await page.addInitScript(() => {
    const posted: { title: string; body?: string; tag?: string }[] = [];
    (window as unknown as { __alerts: typeof posted }).__alerts = posted;
    class FakeNotification {
      static permission: NotificationPermission = "default";
      static async requestPermission() {
        FakeNotification.permission = "granted";
        return "granted" as const;
      }
      onclick: (() => void) | null = null;
      constructor(title: string, options: NotificationOptions = {}) {
        posted.push({ title, body: options.body, tag: options.tag });
      }
      close() {}
    }
    Object.defineProperty(window, "Notification", { value: FakeNotification, configurable: true });
  });
}

async function waitForGames(page: Page) {
  await page.waitForSelector("[data-nav-id]", { timeout: 30_000 });
  await page.waitForTimeout(700);
}

const LEAGUES = { enabledLeagues: ["eng.1", "nfl", "nba", "cs2", "mlb"] };

test.describe("1440 dark: a game's menu", () => {
  test.use({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", deviceScaleFactor: 2 });

  test("right-click opens it; Show in Tab puts the score in the title and favicon", async ({ page }) => {
    await withSettings(page, LEAGUES);
    await page.goto("/?demo");
    await waitForGames(page);
    const row = page.locator("aside [data-nav-id]").first();
    await row.hover();
    // The "…" shows on hover.
    await expect(page.locator("aside").getByRole("button", { name: /Options$/ }).first()).toBeVisible();
    await row.click({ button: "right", position: { x: 60, y: 14 } });
    const menu = page.getByRole("menu", { name: /Options$/ });
    await expect(menu).toBeVisible();
    for (const item of ["Open in Browser", "Show in Tab", "Copy Score"]) await expect(menu.getByRole("menuitem", { name: item })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /^Follow / })).toHaveCount(2);
    await expect(menu.getByRole("menuitem", { name: /^Go to / })).toHaveCount(2);
    await expect(menu.getByRole("menuitem", { name: / Schedule$/ })).toHaveCount(2);
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(OUT, "shell-1440-dark-menu.png") });

    await menu.getByRole("menuitem", { name: "Show in Tab" }).click();
    await expect(menu).toBeHidden();
    // "LIV 2–0 BHA · 67' · Scoreline": the score leads the title, the favicon draws it.
    await expect(page).toHaveTitle(/\d+–\d+ .* · /);
    await expect.poll(() => page.getAttribute('link[rel="icon"]', "href")).toMatch(/^data:image\/png/);
    await expect(row).toHaveAttribute("aria-label", /In the tab/);

    await row.click({ button: "right", position: { x: 60, y: 14 } });
    await page.getByRole("menuitem", { name: "Remove from Tab" }).click();
    await expect(page).toHaveTitle("Scoreline");
    await expect.poll(() => page.getAttribute('link[rel="icon"]', "href")).toContain("/icon-64.png");
  });

  test("a followed team's goal posts an alert", async ({ page }) => {
    await fakeNotifications(page);
    await withSettings(page, { ...LEAGUES, followed: [{ id: "espn-soccer-364", name: "Liverpool", logo: null }] });
    await page.goto("/settings?demo");
    await page.getByRole("switch", { name: "Alerts for my teams" }).click();
    await expect(page.getByTestId("notification-permission")).toContainText("Allowed");
    await expect(page.getByRole("switch", { name: "Alerts for my teams" })).toHaveAttribute("aria-checked", "true");
    // The demo's games score on every refresh.
    await page.waitForTimeout(1000);
    await page.keyboard.press("r");
    await expect.poll(() => page.evaluate(() => (window as unknown as { __alerts: { body?: string }[] }).__alerts.map((a) => a.body)), { timeout: 15_000 }).toContainEqual(expect.stringMatching(/^Goal · /));
    const alert = await page.evaluate(() => (window as unknown as { __alerts: { title: string; tag?: string }[] }).__alerts[0]);
    expect(alert?.title).toMatch(/Liverpool \d+–\d+ Brighton/);
    expect(alert?.tag).toBe("espn-401878765");
  });
});

test.describe("1440 light: keys, sections and Settings", () => {
  test.use({ viewport: { width: 1440, height: 900 }, colorScheme: "light", deviceScaleFactor: 2 });

  test("Shift-F10 opens the menu at once; P pins; R, comma and S", async ({ page }) => {
    await withSettings(page, LEAGUES);
    await page.goto("/?demo");
    await waitForGames(page);
    const row = page.locator("aside [data-nav-id]").first();
    await row.focus();
    await page.keyboard.press("Shift+F10");
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-active="true"]')).toHaveText(/Open in Browser/);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(row).toBeFocused();

    // P shows the highlighted game in the tab.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("p");
    await expect(page).toHaveTitle(/\d+–\d+/);

    // R refreshes: the demo's live games score on every refresh.
    const scores = () => page.locator("aside [data-nav-id]").evaluateAll((rows) => rows.map((r) => r.getAttribute("aria-label")).join("|"));
    const before = await scores();
    await page.locator("body").click({ position: { x: 900, y: 600 } });
    await page.keyboard.press("r");
    await expect.poll(scores).not.toBe(before);
    await page.keyboard.press(",");
    await expect(page).toHaveURL(/\/settings$/);
    await page.keyboard.press("s");
    await expect(page).toHaveURL(/\/schedule$/);
  });

  test("a section's menu moves and hides it", async ({ page }) => {
    await withSettings(page, LEAGUES);
    await page.goto("/?demo");
    await waitForGames(page);
    const sections = () => page.locator("aside section[aria-label]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    expect((await sections()).slice(0, 2)).toEqual(["Premier League", "NFL"]);
    await page.locator("aside h2").filter({ hasText: "Premier League" }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Move Down" }).click();
    await expect.poll(async () => (await sections()).slice(0, 2)).toEqual(["NFL", "Premier League"]);
    await page.locator("aside h2").filter({ hasText: "NFL" }).click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "Move Up" })).toHaveAttribute("aria-disabled", "true");
    await page.getByRole("menuitem", { name: "Hide NFL" }).click();
    await expect.poll(sections).not.toContain("NFL");
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("scoreline.settings.v1") ?? "{}").enabledLeagues);
    expect(stored).not.toContain("nfl");
  });

  test("Settings: the tab, sounds, notifications and the keys", async ({ page }) => {
    await fakeNotifications(page);
    await withSettings(page, LEAGUES);
    await page.goto("/settings");
    const tab = page.getByRole("switch", { name: "Live score" });
    await expect(tab).toHaveAttribute("aria-checked", "true");
    await tab.click();
    await expect(tab).toHaveAttribute("aria-checked", "false");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("scoreline.settings.v1")!).scoreInTitle)).toBe(false);

    const sounds = page.getByRole("switch", { name: "Sounds" });
    await sounds.click();
    await expect(sounds).toHaveAttribute("aria-checked", "true");
    await page.getByRole("radio", { name: "Off" }).click();
    await expect(sounds).toBeDisabled();

    const permission = page.getByTestId("notification-permission");
    await expect(permission).toContainText("Not Asked Yet");
    const section = page.locator("section").filter({ has: page.getByText("Alerts for my teams") });
    await section.scrollIntoViewIfNeeded();
    await section.screenshot({ path: join(OUT, "shell-1440-light-notifications.png") });
    await page.getByRole("switch", { name: "Alerts for my teams" }).click();
    await expect(permission).toContainText("Allowed");
    await expect(page.getByRole("group", { name: "Keyboard shortcuts" })).toBeVisible();
  });

  test("the detail pane remembers where each page was", async ({ page }) => {
    await withSettings(page, LEAGUES);
    await page.goto("/settings");
    await page.getByRole("link", { name: /^NFL/ }).waitFor();
    const main = page.locator("main");
    await main.evaluate((m) => (m.scrollTop = 500));
    await page.waitForTimeout(150);
    // A fresh visit starts at the top (S opens the Schedule)…
    await page.locator("body").press("s");
    await expect(page).toHaveURL(/\/schedule$/);
    await page.waitForTimeout(300);
    expect(await main.evaluate((m) => m.scrollTop)).toBe(0);
    // …and Back lands where Settings was.
    await page.goBack();
    await expect(page).toHaveURL(/\/settings$/);
    await expect.poll(() => main.evaluate((m) => Math.round(m.scrollTop))).toBeGreaterThan(450);
  });

  test("tiles: the round race, the pin and Up Next's schedule link", async ({ page }) => {
    await withSettings(page, { ...LEAGUES, landingView: "tiles" });
    await page.addInitScript(() => sessionStorage.setItem("scoreline.pinned", "cs-132240"));
    await page.goto("/?demo");
    await waitForGames(page);
    const cs = page.locator('aside [data-nav-id="cs-132240"]');
    await expect(cs).toHaveAttribute("aria-label", /In the tab.*Mirage, \d+ to \d+, round \d+/);
    await expect(page.locator("aside").getByRole("link", { name: "Schedule" })).toBeVisible();
    await cs.hover();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(OUT, "shell-1440-light-tiles.png") });
  });
});

test.describe("390 dark: touch", () => {
  test.use({ viewport: { width: 390, height: 844 }, colorScheme: "dark", isMobile: true, hasTouch: true, deviceScaleFactor: 3 });

  test("a long press opens a game's menu; Follow puts it in My Teams", async ({ page }) => {
    await withSettings(page, LEAGUES);
    await page.goto("/?demo");
    await waitForGames(page);
    const row = page.locator("[data-nav-id]").first();
    const box = (await row.boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const point = { x: box.x + 80, y: box.y + 16 };
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    await page.waitForTimeout(650);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    // The press didn't also open the game.
    await expect(page).toHaveURL(/\/(\?demo)?$/);
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(OUT, "shell-390-dark-menu.png") });
    await menu.getByRole("menuitem", { name: /^Follow / }).first().click();
    await expect(page.locator("section[aria-label='My Teams']")).toBeVisible();
  });

  test("Settings on a phone", async ({ page }) => {
    await withSettings(page, LEAGUES);
    await page.goto("/settings");
    await page.getByText("Notifications", { exact: true }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(OUT, "shell-390-dark-settings.png") });
    // No keyboard on a phone: no key list.
    await expect(page.getByRole("group", { name: "Keyboard shortcuts" })).toBeHidden();
  });
});

test.describe("PWA", () => {
  /** A PNG's width, height and color type, from its header. */
  const pngHeader = (b: Buffer) => ({ width: b.readUInt32BE(16), height: b.readUInt32BE(20), colorType: b[25] });

  test("the manifest is valid and its icons are what they say", async ({ request }) => {
    const html = await (await request.get("/")).text();
    expect(html).toContain('rel="manifest" href="/manifest.webmanifest"');
    expect(html).toContain('rel="apple-touch-icon" href="/apple-touch-icon.png"');
    const response = await request.get("/manifest.webmanifest");
    expect(response.ok()).toBe(true);
    const manifest = await response.json();
    expect(manifest).toMatchObject({ name: "Scoreline", short_name: "Scoreline", start_url: "/", scope: "/", display: "standalone" });
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    const purposes = new Set<string>();
    for (const icon of manifest.icons as { src: string; sizes: string; type: string; purpose: string }[]) {
      const file = await request.get(icon.src);
      expect(file.ok(), icon.src).toBe(true);
      expect(file.headers()["content-type"]).toContain("image/png");
      const [w, h] = icon.sizes.split("x").map(Number);
      const header = pngHeader(await file.body());
      expect([header.width, header.height], icon.src).toEqual([w, h]);
      // A maskable icon is full bleed: no alpha.
      if (icon.purpose === "maskable") expect(header.colorType).toBe(2);
      purposes.add(icon.purpose);
    }
    expect([...purposes].sort()).toEqual(["any", "maskable"]);
    expect(manifest.icons.some((i: { sizes: string }) => i.sizes === "192x192")).toBe(true);
    expect(manifest.icons.some((i: { sizes: string }) => i.sizes === "512x512")).toBe(true);
    const touch = pngHeader(await (await request.get("/apple-touch-icon.png")).body());
    expect(touch).toEqual({ width: 180, height: 180, colorType: 2 });
    const sw = await request.get("/sw.js");
    expect(sw.ok()).toBe(true);
    expect(sw.headers()["content-type"]).toContain("javascript");
    expect(await sw.text()).toContain("notificationclick");
  });
});
