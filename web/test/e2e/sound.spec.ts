/**
 * Celebration sounds (core/sound.ts): a goal on the open page plays one
 * synthesized pop once the page's audio is unlocked by a press, only with
 * Settings → Sounds on. A stand-in AudioContext records what's scheduled.
 */
import { expect, test, type BrowserContext } from "@playwright/test";

const SOCCER = "/game/espn-401879256?demo&league=eng.1&soccer=6";

async function fakeAudio(context: BrowserContext, sounds: boolean) {
  await context.addInitScript((on) => {
    localStorage.setItem("scoreline.settings.v1", JSON.stringify({ celebrationSounds: on }));
    const log: { freq: number; at: number }[] = [];
    (window as unknown as { __sounds: typeof log }).__sounds = log;
    const param = (onSet?: (v: number) => void) => ({ setValueAtTime: (v: number) => onSet?.(v), linearRampToValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} });
    class FakeAudioContext {
      state = "suspended";
      currentTime = 0;
      destination = {};
      resume() {
        this.state = "running";
        return Promise.resolve();
      }
      createGain() {
        return { gain: param(), connect: (n: unknown) => n };
      }
      createOscillator() {
        return { type: "sine", frequency: param((v) => log.push({ freq: v, at: Date.now() })), connect: (n: unknown) => n, start() {}, stop() {} };
      }
    }
    (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  }, sounds);
}

const sounds = (page: import("@playwright/test").Page) => page.evaluate(() => (window as unknown as { __sounds: { freq: number }[] }).__sounds.filter((s) => s.freq === 880 || s.freq === 1568).length);

test.describe("celebration sounds", () => {
  test.use({ viewport: { width: 1024, height: 760 } });

  test("a goal plays one sound once a press has unlocked the page's audio", async ({ page, context }) => {
    await fakeAudio(context, true);
    await page.goto(SOCCER);
    await page.locator("main h1").waitFor({ timeout: 20_000 });
    // A press anywhere unlocks the audio (browsers start it suspended).
    await page.mouse.click(700, 740);
    await expect.poll(() => sounds(page), { timeout: 25_000, intervals: [500] }).toBeGreaterThanOrEqual(1);
    // At most one every 8 s.
    expect(await sounds(page)).toBe(1);
  });

  test("nothing plays with Sounds off", async ({ page, context }) => {
    await fakeAudio(context, false);
    await page.goto(SOCCER);
    await page.locator("main h1").waitFor({ timeout: 20_000 });
    await page.mouse.click(700, 740);
    await page.waitForTimeout(16_000);
    expect(await sounds(page)).toBe(0);
  });
});
