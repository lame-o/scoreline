/**
 * A page's data fails and recovers as the Mac's does (state/retry.ts): the
 * first failure shows at once, the page keeps its error (never its
 * placeholders) through every attempt after it, attempts climb 5, 15, 30,
 * then 60 s, a good answer ends the streak, a 404 is never asked again, and
 * nothing is asked offline.
 */
import { environmentManager, QueryClient, QueryObserver, keepPreviousData } from "@tanstack/react-query";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { HTTPError } from "../../src/data/http";
import { hasFailed, loadState, retrying } from "../../src/state/retry";

let client: QueryClient;

// Node has no window, so TanStack would treat it as a server and schedule no refetch timers.
beforeAll(() => environmentManager.setIsServer(() => false));
afterAll(() => environmentManager.setIsServer(() => typeof window === "undefined"));

beforeEach(() => {
  vi.useFakeTimers();
  client = new QueryClient({ defaultOptions: { queries: { networkMode: "always", gcTime: Infinity } } });
});

afterEach(() => {
  client.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Lets the query's promise chain settle after the clock moves. */
async function flush(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms);
}

function watch<T>(queryFn: () => Promise<T>, options: Parameters<typeof retrying<T>>[0] = {}, key: unknown[] = ["k"]) {
  const observer = new QueryObserver(client, { queryKey: key, queryFn, ...retrying<T>(options) });
  const unsubscribe = observer.subscribe(() => {});
  return { observer, unsubscribe, result: () => observer.getCurrentResult() };
}

describe("retrying", () => {
  it("shows the first failure at once, then asks again at 5, 15, 30 and 60 s", async () => {
    let calls = 0;
    const { result, unsubscribe } = watch(async () => {
      calls += 1;
      throw new Error("502");
    });
    await flush();
    expect(calls).toBe(1);
    expect(loadState(result())).toMatchObject({ failed: true, loading: false, stale: false });

    const at: number[] = [];
    let last = calls;
    for (let s = 1; s <= 170; s++) {
      await flush(1000);
      if (calls !== last) {
        at.push(s);
        last = calls;
      }
    }
    // 5, then 15 after that, then 30, then every 60.
    expect(at).toEqual([5, 20, 50, 110, 170]);
    unsubscribe();
  });

  it("keeps the error through an attempt (never back to the placeholders), saying it's retrying", async () => {
    let resolve: ((v: string) => void) | null = null;
    let calls = 0;
    const { result, unsubscribe } = watch(
      () =>
        new Promise<string>((ok, fail) => {
          calls += 1;
          if (calls === 1) fail(new Error("502"));
          else resolve = ok;
        }),
    );
    await flush();
    expect(loadState(result()).failed).toBe(true);
    await flush(5000);
    // The attempt is out: TanStack says "pending" again, the page still says it failed.
    expect(result().status).toBe("pending");
    expect(loadState(result())).toMatchObject({ failed: true, retrying: true, loading: false });
    resolve!("table");
    await flush();
    expect(loadState(result())).toMatchObject({ failed: false, retrying: false, loading: false, stale: false });
    expect(result().data).toBe("table");
    unsubscribe();
  });

  it("ends the streak on a good answer, and goes back to its own cadence", async () => {
    let calls = 0;
    const { observer, unsubscribe } = watch(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error("502");
        return "ok";
      },
      { every: 600_000 },
    );
    await flush(5000 + 15000);
    expect(calls).toBe(3);
    expect(observer.getCurrentResult().data).toBe("ok");
    // No more attempts on the ladder: the next is the ten-minute poll.
    await flush(120_000);
    expect(calls).toBe(3);
    await flush(480_000);
    expect(calls).toBe(4);
    unsubscribe();
  });

  it("marks data whose refresh failed as stale, not failed, and climbs from 5 s again", async () => {
    let calls = 0;
    const { result, observer, unsubscribe } = watch(
      async () => {
        calls += 1;
        if (calls === 1) return "table";
        throw new Error("502");
      },
      { every: 60_000 },
    );
    await flush();
    expect(result().data).toBe("table");
    await flush(60_000);
    expect(calls).toBe(2);
    expect(loadState(result())).toMatchObject({ failed: false, stale: true });
    expect(loadState(result()).updated).toBe(observer.getCurrentResult().dataUpdatedAt);
    await flush(5000);
    expect(calls).toBe(3);
    unsubscribe();
  });

  it("never asks again after a 404 (an answer: nobody by that ID)", async () => {
    let calls = 0;
    const { result, unsubscribe } = watch(async () => {
      calls += 1;
      throw new HTTPError(404, "https://example.com/athletes/0");
    });
    await flush(120_000);
    expect(calls).toBe(1);
    expect(hasFailed(result())).toBe(true);
    unsubscribe();
  });

  it("asks nothing while the browser is offline", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    let calls = 0;
    const { result, unsubscribe } = watch(async () => {
      calls += 1;
      throw new TypeError("Failed to fetch");
    });
    await flush(120_000);
    expect(calls).toBe(1);
    expect(loadState(result()).failed).toBe(true);
    unsubscribe();
  });

  it("climbs the ladder for an answer that is a failure of its own (ok: false)", async () => {
    let calls = 0;
    const { unsubscribe } = watch(
      async () => {
        calls += 1;
        return { ok: calls >= 3, items: [] };
      },
      { failed: (page) => !page.ok },
    );
    await flush();
    expect(calls).toBe(1);
    await flush(5000);
    expect(calls).toBe(2);
    await flush(14_000);
    expect(calls).toBe(2);
    await flush(1000);
    expect(calls).toBe(3);
    // Good now: no more attempts.
    await flush(120_000);
    expect(calls).toBe(3);
    unsubscribe();
  });

  it("stops asking once the page is gone", async () => {
    let calls = 0;
    const { unsubscribe } = watch(async () => {
      calls += 1;
      throw new Error("502");
    });
    await flush();
    unsubscribe();
    await flush(120_000);
    expect(calls).toBe(1);
  });

  it("keeps a moved-to page's failure through its retries while the last page stands in", async () => {
    let calls = 0;
    const observer = new QueryObserver(client, {
      queryKey: ["week", 1],
      queryFn: async () => {
        calls += 1;
        return "week 1";
      },
      placeholderData: keepPreviousData,
      ...retrying<string>(),
    });
    const unsubscribe = observer.subscribe(() => {});
    await flush();
    observer.setOptions({
      queryKey: ["week", 2],
      queryFn: async () => {
        calls += 1;
        throw new Error("502");
      },
      placeholderData: keepPreviousData,
      ...retrying<string>(),
    });
    await flush();
    expect(hasFailed(observer.getCurrentResult())).toBe(true);
    // Mid-retry, TanStack shows week 1 again as the placeholder: still a failure.
    await vi.advanceTimersByTimeAsync(5000);
    const mid = observer.getCurrentResult();
    expect(mid.isPlaceholderData || mid.isError).toBe(true);
    expect(hasFailed(mid)).toBe(true);
    unsubscribe();
  });
});
