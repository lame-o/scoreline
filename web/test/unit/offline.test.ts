/**
 * Offline, a page says it can't connect instead of holding its placeholders:
 * queries fail rather than pause (networkMode "always") and don't retry while
 * the browser knows it's offline; reconnecting refetches.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryClient, retryOnline } from "../../src/state/scores";

afterEach(() => vi.unstubAllGlobals());

describe("offline", () => {
  it("retries a failed load on its schedule while online", () => {
    vi.stubGlobal("navigator", { onLine: true });
    const retry = retryOnline(3);
    expect([0, 1, 2, 3].map((n) => retry(n))).toEqual([true, true, true, false]);
  });

  it("stops retrying while the browser is offline", () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect(retryOnline(3)(0)).toBe(false);
  });

  it("never pauses a query while offline (it fails, and the page says so)", () => {
    expect(queryClient.getDefaultOptions().queries?.networkMode).toBe("always");
    expect(queryClient.getDefaultOptions().queries?.refetchOnReconnect).not.toBe(false);
  });
});
