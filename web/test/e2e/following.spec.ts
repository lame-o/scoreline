/**
 * Sports and Following (34ba1dd): one search across competitions and teams;
 * a sport's page with its cups and its teams; stars that follow (a
 * competition, a team everywhere it plays, one tournament); a competition's
 * page with one list (the star follows, Selected Teams picks); Following's
 * bells, removes and order; persistence; axe at zero.
 */
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
const out = process.env.SCORELINE_SCREENSHOTS ?? "test-results/screenshots";
mkdirSync(out, { recursive: true });
for (const size of [{ width: 390, height: 844, colorScheme: "dark" as const }, { width: 1280, height: 900, colorScheme: "light" as const }]) {
  test.describe(`Following ${size.width}`, () => {
    test.use({ viewport: size, colorScheme: size.colorScheme, reducedMotion: "reduce" });
    test("search, a sport's page, stars, one list, alerts and persistence", async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(() => {
        if (!localStorage.getItem("scoreline.settings.v1")) localStorage.setItem("scoreline.settings.v1", JSON.stringify({ enabledLeagues: ["eng.1"], theme: "system", filteredLeagues: ["nba"], teamFilters: { nba: [] }, followed: [] }));
      });
      await page.route("**/*", (route) => {
        const u = route.request().url();
        if (u.includes("/api/") || u.includes("sports.core.api.espn.com") || u.includes("api.bo3.gg")) {
          if (u.includes("/soccer/") && u.includes("/teams?")) return route.fulfill({ json: { sports: [{ leagues: [{ teams: [{ team: { id: "364", displayName: "Liverpool", logos: [] } }, { team: { id: "363", displayName: "Chelsea", logos: [] } }] }] }] } });
          return route.fulfill({ json: { events: [], leagues: [], results: [], children: [], sports: [] } });
        }
        if (!u.startsWith("http://127.0.0.1") && !u.startsWith("http://localhost")) return route.abort();
        return route.continue();
      });
      const read = () => page.evaluate(() => JSON.parse(localStorage.getItem("scoreline.settings.v1")!));
      await page.goto("/sports");
      await expect(page.getByRole("heading", { level: 1, name: "Sports", exact: true })).toBeVisible();
      // One search, focused on open: a competition, and a team in two lists found once.
      await expect(page.getByRole("searchbox", { name: "Search teams and competitions" })).toBeFocused();
      await page.keyboard.type("liverpool");
      await expect(page.getByRole("link", { name: /^Liverpool/ })).toHaveCount(1, { timeout: 20_000 });
      await page.getByRole("button", { name: "Follow Liverpool", exact: true }).click();
      expect((await read()).followed.map((t: { id: string }) => t.id)).toEqual(["espn-soccer-364"]);
      // Esc clears the search first (a second would go back).
      const field = page.getByRole("searchbox", { name: "Search teams and competitions" });
      await field.press("Escape");
      await expect(field).toHaveValue("");
      await expect(page.getByRole("link", { name: /^Following/ })).toBeVisible();
      // A sport's page: its cups (the star follows one), then its teams.
      await page.goto("/sports/soccer");
      await expect(page.getByRole("heading", { name: "Soccer", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Follow Carabao Cup", exact: true }).click();
      expect((await read()).enabledLeagues).toContain("eng.league_cup");
      await page.screenshot({ animations: "disabled", path: join(out, `sports-${size.width}.png`) });
      // A competition's page: one list; Selected Teams picks for it alone, the star follows everywhere.
      await page.goto("/sports/competition/eng.league_cup");
      await expect(page.getByRole("heading", { name: "Carabao Cup", exact: true })).toBeVisible();
      await expect(page.getByRole("switch", { name: "Follow Carabao Cup", exact: true })).toBeChecked();
      await page.getByRole("radio", { name: "Selected Teams", exact: true }).click();
      await page.getByRole("checkbox", { name: "Chelsea", exact: true }).click();
      await page.screenshot({ animations: "disabled", path: join(out, `competition-scope-${size.width}.png`) });
      let stored = await read();
      expect(stored.followed.map((t: { id: string }) => t.id)).toEqual(["espn-soccer-364"]);
      expect(stored.teamFilters["eng.league_cup"]).toEqual(["espn-soccer-363"]);
      expect(stored.mutedTeams).toEqual([]);
      // Following: the bell turns a team's alerts off, remembered.
      await page.goto("/following");
      await expect(page.getByRole("heading", { name: "Following", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Turn off alerts for Liverpool", exact: true }).click();
      stored = await read();
      expect(stored.mutedTeams).toEqual(["espn-soccer-364"]);
      await page.reload();
      await expect(page.getByRole("button", { name: "Turn on alerts for Liverpool", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: /Add Competitions/ })).toBeVisible();
      await page.screenshot({ animations: "disabled", path: join(out, `following-${size.width}.png`) });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const accessibility = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      expect(accessibility.violations).toEqual([]);
      // One tournament, followed by its star: never its whole game.
      await page.goto("/bracket/cs2/major-2026?name=Major%202026");
      await page.getByRole("button", { name: "Follow Major 2026", exact: true }).click();
      expect((await read()).editions).toEqual([{ source: "cs2", key: "major-2026", name: "Major 2026" }]);
      expect((await read()).enabledLeagues).not.toContain("cs2");
      await page.goto("/following");
      await expect(page.getByRole("link", { name: "Major 2026", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Unfollow Major 2026", exact: true }).click();
      expect((await read()).editions).toEqual([]);
      expect(errors).toEqual([]);
    });
  });
}
