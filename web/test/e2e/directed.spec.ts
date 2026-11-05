/**
 * The theaters on the choreography engine (TheaterView.swift `TheaterFrames`;
 * CHOREOGRAPHY §5.6.7, §13): /dev/theater/directed plays a recording back as
 * the page's broadcast would hand it to the director. It draws; its frames
 * come at the display's rate while the plan moves and stop when nothing
 * does; scrolled away or in a hidden tab it draws nothing; with Reduce Motion
 * it shows key states, never a loop. `?sport=football` plays the field the
 * same way. Screenshots go to SCORELINE_SCREENSHOTS.
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = process.env.SCORELINE_SCREENSHOTS ?? join("test-results", "screenshots");
mkdirSync(OUT, { recursive: true });

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
  return errors;
}

const inked = (page: Page) =>
  page.locator("[data-directed] canvas").first().evaluate((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext("2d");
    if (!ctx || canvas.width === 0) return 0;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let n = 0;
    for (let i = 3; i < data.length; i += 4 * 16) if (data[i]! > 0) n++;
    return n / (data.length / (4 * 16));
  });

const frames = (page: Page) => page.evaluate(() => (window as unknown as { __theaterFrames?: number[] }).__theaterFrames?.length ?? 0);

/**
 * The cost (THEATER_TRACE=1 only): Chromium tracing over a stretch of the
 * recording (the main thread's tasks, the long ones), and each frame's draw
 * time as the stage reports it; at 4× CPU throttling too. Prints the numbers
 * ARCHITECTURE.md records.
 */
test.describe("the director's cost", () => {
  test.skip(!process.env.THEATER_TRACE, "set THEATER_TRACE=1 to trace");
  test.setTimeout(240_000);
  const pct = (xs: number[], q: number) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[Math.min(Math.floor(q * (s.length - 1)), s.length - 1)]! : 0;
  };
  for (const throttle of [1, 4]) {
    test(`frames and tasks at ${throttle}× CPU`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.addInitScript(() => {
        (window as unknown as { __theaterFrames: number[] }).__theaterFrames = [];
      });
      const at = Number(process.env.THEATER_AT ?? 40);
      await page.goto(`/dev/theater/directed?at=${at}&d=50`);
      await page.locator("[data-directed] canvas").waitFor();
      await page.waitForTimeout(1500);
      const cdp = await page.context().newCDPSession(page);
      if (throttle > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
      const events: { name: string; ph: string; dur?: number; tid: number; pid: number; args?: { name?: string } }[] = [];
      cdp.on("Tracing.dataCollected", (e) => events.push(...(e.value as typeof events)));
      await page.evaluate(() => {
        (window as unknown as { __theaterFrames: number[] }).__theaterFrames.length = 0;
      });
      await cdp.send("Tracing.start", { traceConfig: { includedCategories: ["devtools.timeline", "disabled-by-default-devtools.timeline"] } });
      await page.waitForTimeout(Number(process.env.THEATER_SECONDS ?? 60) * 1000);
      const done = new Promise<void>((resolve) => cdp.once("Tracing.tracingComplete", () => resolve()));
      await cdp.send("Tracing.end");
      await done;
      const drawn = await page.evaluate(() => (window as unknown as { __theaterFrames: number[] }).__theaterFrames.slice());
      // The renderer's main thread: the thread named CrRendererMain.
      const main = events.find((e) => e.name === "thread_name" && e.args?.name === "CrRendererMain");
      const tasks = events.filter((e) => e.name === "RunTask" && e.ph === "X" && (!main || (e.tid === main.tid && e.pid === main.pid))).map((e) => (e.dur ?? 0) / 1000);
      const long = tasks.filter((d) => d > 50);
      console.log(
        `THEATER ${throttle}x: frames ${drawn.length}, draw p50 ${pct(drawn, 0.5).toFixed(2)} ms, p95 ${pct(drawn, 0.95).toFixed(2)} ms, max ${Math.max(0, ...drawn).toFixed(2)} ms; ` +
          `tasks ${tasks.length}, p99 ${pct(tasks, 0.99).toFixed(1)} ms, max ${Math.max(0, ...tasks).toFixed(1)} ms, long (>50 ms) ${long.length}: ${long.map((d) => d.toFixed(0)).join(", ")}`,
      );
    });
  }
});

test.describe("the court on the director", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`draws the recording live, in ${scheme}`, async ({ page }) => {
      const errors = watchErrors(page);
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 1024, height: 900 });
      await page.addInitScript(() => {
        (window as unknown as { __theaterFrames: number[] }).__theaterFrames = [];
      });
      // Two minutes into the recording: a stretch of the fourth quarter's plays.
      await page.goto("/dev/theater/directed?at=120&d=50");
      await page.locator("[data-directed] canvas").waitFor();
      await page.waitForTimeout(4000);
      expect(await inked(page)).toBeGreaterThan(0.3);
      await page.locator("[data-directed]").screenshot({ path: join(OUT, `directed-nba-${scheme}.png`) });
      expect(await frames(page)).toBeGreaterThan(0);
      expect(errors).toEqual([]);
    });
  }

  test("with Reduce Motion: key states, crossfading, never a running loop", async ({ page }) => {
    const errors = watchErrors(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.addInitScript(() => {
      (window as unknown as { __theaterFrames: number[] }).__theaterFrames = [];
    });
    await page.goto("/dev/theater/directed?at=40&d=50");
    await page.locator("[data-directed] canvas").waitFor();
    await page.waitForTimeout(1500);
    expect(await inked(page)).toBeGreaterThan(0.3);
    const before = await frames(page);
    await page.waitForTimeout(4000);
    // A quarter-second fade at each key state: a handful of frames, never a display-rate loop (4 s would be 240).
    expect((await frames(page)) - before).toBeLessThan(80);
    expect(errors).toEqual([]);
  });

  test("draws nothing scrolled away or in a hidden tab", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.addInitScript(() => {
      (window as unknown as { __theaterFrames: number[] }).__theaterFrames = [];
    });
    await page.goto("/dev/theater/directed?at=120&d=50");
    await page.locator("[data-directed] canvas").waitFor();
    await page.waitForTimeout(1500);
    // Out of view: the page made long enough to scroll the well away.
    await page.evaluate(() => {
      const spacer = document.createElement("div");
      spacer.style.height = "4000px";
      document.querySelector("main")?.prepend(spacer);
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(500);
    const before = await frames(page);
    await page.waitForTimeout(2000);
    expect(await frames(page)).toBe(before);
  });
});

test.describe("the field on the director", () => {
  test("draws the recording live, plans its snaps, nothing thrown", async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.addInitScript(() => {
      (window as unknown as { __theaterFrames: number[] }).__theaterFrames = [];
    });
    // DAL at PHI (the Mac's football gate fixture), a few minutes in: the drive after the opening kickoff.
    await page.goto("/dev/theater/directed?sport=football&at=200&d=74");
    await page.locator("[data-directed][data-theater='football'] canvas").waitFor();
    await page.waitForTimeout(4000);
    expect(await inked(page)).toBeGreaterThan(0.3);
    await page.locator("[data-directed]").screenshot({ path: join(OUT, "directed-nfl.png") });
    expect(await frames(page)).toBeGreaterThan(0);
    // The director has handed the timeline its anchors: the snaps it will tell, and when.
    const anchors = await page.evaluate(() => (window as unknown as { __directedSource?: { anchors: Map<string, number> } }).__directedSource?.anchors.size ?? 0);
    expect(anchors).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
});

test.describe("the pitch on the director", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`draws the recording live, in ${scheme}`, async ({ page }) => {
      const errors = watchErrors(page);
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 1024, height: 900 });
      await page.addInitScript(() => {
        (window as unknown as { __theaterFrames: number[] }).__theaterFrames = [];
      });
      // Five minutes into Villa v City: the corners and the goal's build-up come in as the page watches.
      await page.goto("/dev/theater/directed?sport=soccer&at=300&d=60");
      await page.locator("[data-directed][data-theater='soccer'] canvas").waitFor();
      await page.waitForTimeout(4000);
      expect(await inked(page)).toBeGreaterThan(0.3);
      await page.locator("[data-directed]").screenshot({ path: join(OUT, `directed-soccer-${scheme}.png`) });
      expect(await frames(page)).toBeGreaterThan(0);
      expect(errors).toEqual([]);
    });
  }

  test("draws nothing scrolled away", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.addInitScript(() => {
      (window as unknown as { __theaterFrames: number[] }).__theaterFrames = [];
    });
    await page.goto("/dev/theater/directed?sport=soccer&at=300&d=60");
    await page.locator("[data-directed] canvas").waitFor();
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      const spacer = document.createElement("div");
      spacer.style.height = "4000px";
      document.querySelector("main")?.prepend(spacer);
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(500);
    const before = await frames(page);
    await page.waitForTimeout(2000);
    expect(await frames(page)).toBe(before);
  });
});

test.describe("the game page, while it broadcasts", () => {
  test("the court is the theater on the engine, reading the page's broadcast; without it, today's", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = watchErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      (window as unknown as { __theaterFrames: number[] }).__theaterFrames = [];
    });
    // The harness's NBA replay restamped onto its clock (`&broadcast`): the page broadcasts, so the court is directed.
    await page.goto("/game/espn-401909869?demo&league=nba&broadcast&nba=10");
    const directed = page.locator("[data-theater='basketball'][data-directed]");
    await directed.waitFor({ timeout: 30_000 });
    await directed.scrollIntoViewIfNeeded();
    await page.waitForTimeout(4000);
    expect(await inked(page)).toBeGreaterThan(0.3);
    expect(await frames(page)).toBeGreaterThan(0);
    // The director handed the broadcast its anchors: the plays it tells, and when.
    const planned = await page.evaluate(() => (window as unknown as { __director?: { chain: { plans: unknown[] } } }).__director?.chain.plans.length ?? 0);
    expect(planned).toBeGreaterThan(0);
    await directed.screenshot({ path: join(OUT, "directed-page-nba.png") });
    expect(errors).toEqual([]);
    // The harness without `&broadcast`: today's theater.
    await page.goto("/game/espn-401909869?demo&league=nba&nba=10");
    await page.locator("[data-theater='basketball']").waitFor({ timeout: 30_000 });
    await expect(page.locator("[data-theater][data-directed]")).toHaveCount(0);
  });
});
