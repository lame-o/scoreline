/**
 * Game-page modules (PageModules.swift, ModuleDrag.swift) on the live NBA
 * demo: a header folds its module to one live line and remembers it; keys
 * fold and open it without motion; the header's menu hides it on the sport's
 * pages (the page's end names it, and Show brings it back); Customize lists
 * the sport's modules, and ↑/↓ on a handle moves one, announced; dragging a
 * header moves its module within its column and saves the order. Folded, the
 * Live View keeps its theater (unseen).
 */
import { expect, test, type Page } from "@playwright/test";

const NBA = "/game/espn-401909869?demo&league=nba";
const header = (page: Page, section: string) => page.locator(`[data-section="${section}"] h2 button`);
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("scoreline.settings.v1") ?? "{}") as { foldedModules?: string[]; hiddenModules?: string[]; moduleOrder?: Record<string, string[]> });

test.use({ viewport: { width: 1440, height: 1000 } });

test("a header folds its module to one line, remembered; keys fold and open it", async ({ page }) => {
  await page.goto(NBA);
  const court = header(page, "court");
  await expect(court).toHaveAttribute("aria-expanded", "true", { timeout: 30_000 });
  await court.click();
  await expect(court).toHaveAttribute("aria-expanded", "false");
  // Folded: the glance line, in the module's own terms; the chart is gone.
  await expect(page.locator('[data-section="court"]')).toContainText(/% FG/);
  await expect(page.getByRole("img", { name: /^Shot chart\./ })).toHaveCount(0);
  expect((await stored(page)).foldedModules).toContain("nba.court");
  await page.reload();
  await expect(header(page, "court")).toHaveAttribute("aria-expanded", "false", { timeout: 30_000 });
  // → opens, ← folds (from the keyboard: no motion).
  await header(page, "court").focus();
  await page.keyboard.press("ArrowRight");
  await expect(header(page, "court")).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(header(page, "court")).toHaveAttribute("aria-expanded", "false");
  // The Live View folded keeps its theater, unseen.
  await header(page, "liveView").click();
  await expect(page.locator('[data-section="liveView"] [data-theater]')).toBeAttached();
  await expect(page.locator('[data-section="liveView"] [data-theater]')).toBeHidden();
});

test("the header's menu hides a module on the sport's pages; Show brings it back", async ({ page }) => {
  await page.goto(NBA);
  await expect(header(page, "flow")).toBeVisible({ timeout: 30_000 });
  // Once the page has assembled (a menu closes when the page under it scrolls).
  await expect(header(page, "box")).toBeVisible();
  await page.waitForTimeout(1500);
  await header(page, "flow").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Hide Game Flow on NBA Pages" }).click();
  await expect(page.locator('[data-section="flow"]')).toHaveCount(0);
  await expect(page.getByText("Hidden on NBA pages: Game Flow")).toBeVisible();
  await page.getByRole("button", { name: "Show", exact: true }).click();
  await expect(page.locator('[data-section="flow"]')).toHaveCount(1);
});

test("Customize: every module of the sport's pages, a handle's ↑/↓ moves one, announced", async ({ page }) => {
  await page.goto(NBA);
  await expect(header(page, "flow")).toBeVisible({ timeout: 30_000 });
  await header(page, "flow").focus();
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: /Customize NBA Pages/ }).click();
  const dialog = page.getByRole("dialog", { name: "NBA Game Pages" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("checkbox", { name: /Shot Chart/ })).toBeChecked();
  await dialog.getByRole("button", { name: "Reorder Box Score" }).focus();
  await page.keyboard.press("ArrowUp");
  await expect(dialog.getByRole("status")).toHaveText(/^Box Score, position \d+ of \d+$/);
  const order = (await stored(page)).moduleOrder?.nba ?? [];
  expect(order.indexOf("box")).toBeLessThan(order.indexOf("moments"));
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("dragging a header moves its module within its column, and the order is saved", async ({ page }) => {
  await page.goto(NBA);
  const box = header(page, "box");
  await expect(box).toBeVisible({ timeout: 30_000 });
  const b = (await box.boundingBox())!;
  await page.mouse.move(b.x + 20, b.y + 5);
  await page.mouse.down();
  await page.mouse.move(b.x + 20, b.y + 15, { steps: 3 });
  await page.waitForTimeout(300);
  // While a module is in hand, every module is folded for the drag (never saved).
  await expect(header(page, "leaders")).toHaveAttribute("aria-expanded", "false");
  await page.mouse.move(b.x + 20, b.y + 120, { steps: 10 });
  await page.waitForTimeout(300);
  await page.mouse.up();
  await expect(header(page, "leaders")).toHaveAttribute("aria-expanded", "true");
  const order = (await stored(page)).moduleOrder?.nba ?? [];
  expect(order.indexOf("leaders")).toBeLessThan(order.indexOf("box"));
  expect((await stored(page)).foldedModules ?? []).toEqual([]);
});
