/**
 * The bundle's seams: each sport's game page is its own chunk (sportPages.ts),
 * and the shell links a game without loading the game page's data layer.
 * Static imports would quietly merge them back, so the sources are checked.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOG } from "../../src/data/leagues";
import { leaguePageKind } from "../../src/data/sections";

const src = (path: string) => readFileSync(join(import.meta.dirname, "..", "..", "src", path), "utf8");
const staticImports = (code: string) => [...code.matchAll(/^import\s[^;]*?from\s+"([^"]+)";/gms)].map((m) => m[1]!);

describe("the game page's chunks", () => {
  it("never imports a sport's page statically", () => {
    for (const file of ["features/game/GamePage.tsx", "features/game/sportPages.ts"]) {
      const sports = staticImports(src(file)).filter((p) => /\/(mlb|nba|soccer|football|cs2|climbing)\//.test(p));
      expect(sports, file).toEqual([]);
    }
  });

  it("loads each sport with its own page through a dynamic import", () => {
    const pages = src("features/game/sportPages.ts");
    for (const page of ["./mlb/BaseballPage", "./football/FootballPage", "./soccer/SoccerPage", "./nba/BasketballPage"]) {
      expect(pages).toContain(`import("${page}")`);
    }
  });

  it("keeps the shell off the game page's data layer", () => {
    for (const file of ["app/LiveServices.tsx", "app/AppShell.tsx", "features/scores/ScoresPage.tsx"]) {
      expect(staticImports(src(file)).filter((p) => p.includes("features/game/")), file).toEqual([]);
    }
  });
});

describe("leaguePageKind", () => {
  it("names the page each league's games open on", () => {
    const kinds = Object.fromEntries(CATALOG.map((l) => [l.id, leaguePageKind(l)]));
    expect(kinds["eng.1"]).toBe("soccer");
    expect(kinds["uefa.champions"]).toBe("soccer");
    expect(kinds["nfl"]).toBe("football");
    expect(kinds["college-football"]).toBe("football");
    expect(kinds["mlb"]).toBe("baseball");
    expect(kinds["nba"]).toBe("nba");
    expect(kinds["cs2"]).toBe("counterStrike");
    expect(kinds["ifsc"]).toBe("climbing");
  });
});
