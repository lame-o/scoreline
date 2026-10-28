/**
 * What survives a reload (state/persist.ts; ScheduleCache.swift,
 * ProfileCache.swift): a persisted query answers from disk after a "reload"
 * (a new client) without asking the network, takes its old time, and
 * revalidates behind it when stale; another version or an expired entry is
 * dropped; a failure is never kept; each family sweeps only its own entries.
 */
import { environmentManager, QueryClient, QueryObserver } from "@tanstack/react-query";
import type { AsyncStorage, PersistedQuery } from "@tanstack/query-persist-client-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { persisted, setPersistStorage, sweepFamily } from "../../src/state/persist";

const DAY = 86_400_000;

/** An in-memory stand-in for IndexedDB (values kept as they are). */
function memory() {
  const map = new Map<string, PersistedQuery>();
  const storage: AsyncStorage<PersistedQuery> = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, structuredClone(v)),
    removeItem: (k) => void map.delete(k),
    entries: () => [...map.entries()],
  };
  return { map, storage };
}

beforeAll(() => environmentManager.setIsServer(() => false));
afterAll(() => environmentManager.setIsServer(() => typeof window === "undefined"));

let store: ReturnType<typeof memory>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));
  store = memory();
  setPersistStorage(store.storage);
});
afterEach(() => {
  setPersistStorage(null);
  vi.useRealTimers();
});

const settle = () => vi.advanceTimersByTimeAsync(10);

async function load(client: QueryClient, queryFn: () => Promise<unknown>, options: { staleTime: number; version?: string; maxAge?: number }) {
  const observer = new QueryObserver(client, {
    queryKey: ["profile", "https://example.com/teams/12"],
    queryFn,
    staleTime: options.staleTime,
    retry: false,
    persister: persisted({ family: "profiles", version: options.version ?? "1", maxAge: options.maxAge ?? 7 * DAY }),
  });
  const off = observer.subscribe(() => {});
  await settle();
  return { observer, off };
}

describe("persisted queries", () => {
  it("answer from disk after a reload, with their old time, and revalidate behind it when stale", async () => {
    const first = new QueryClient();
    const fetch1 = vi.fn(async () => ({ team: "Chiefs", record: "6-1" }));
    const a = await load(first, fetch1, { staleTime: 30 * 60_000 });
    expect(fetch1).toHaveBeenCalledTimes(1);
    expect(store.map.size).toBe(1);
    const saved = [...store.map.values()][0]!;
    expect(saved.buster).toBe("1");
    expect(saved.state.data).toEqual({ team: "Chiefs", record: "6-1" });
    a.off();

    // An hour later, a reload: the page paints the kept copy at once, then asks again (30 minutes fresh).
    vi.setSystemTime(new Date("2026-10-27T13:00:00Z"));
    let resolve: (v: unknown) => void = () => {};
    const fetch2 = vi.fn(() => new Promise((r) => (resolve = r)));
    const second = new QueryClient();
    const b = await load(second, fetch2, { staleTime: 30 * 60_000 });
    expect(b.observer.getCurrentResult().data).toEqual({ team: "Chiefs", record: "6-1" });
    expect(b.observer.getCurrentResult().dataUpdatedAt).toBe(Date.parse("2026-10-27T12:00:00Z"));
    expect(fetch2).toHaveBeenCalledTimes(1);
    resolve({ team: "Chiefs", record: "7-1" });
    await settle();
    expect(b.observer.getCurrentResult().data).toEqual({ team: "Chiefs", record: "7-1" });
    expect([...store.map.values()][0]!.state.data).toEqual({ team: "Chiefs", record: "7-1" });
    b.off();
  });

  it("don't ask the network after a reload while the kept copy is fresh", async () => {
    await load(new QueryClient(), async () => "first", { staleTime: DAY });
    vi.advanceTimersByTime(60_000);
    const again = vi.fn(async () => "second");
    const b = await load(new QueryClient(), again, { staleTime: DAY });
    expect(again).not.toHaveBeenCalled();
    expect(b.observer.getCurrentResult().data).toBe("first");
  });

  it("drop another version's entry, or one past its max age", async () => {
    await load(new QueryClient(), async () => "old shape", { staleTime: DAY });
    const fresh = vi.fn(async () => "new shape");
    const b = await load(new QueryClient(), fresh, { staleTime: DAY, version: "2" });
    expect(fresh).toHaveBeenCalledTimes(1);
    expect(b.observer.getCurrentResult().data).toBe("new shape");

    vi.advanceTimersByTime(8 * DAY);
    const late = vi.fn(async () => "refetched");
    const c = await load(new QueryClient(), late, { staleTime: 30 * DAY, version: "2" });
    expect(late).toHaveBeenCalledTimes(1);
    expect(c.observer.getCurrentResult().data).toBe("refetched");
  });

  it("never keep a failure", async () => {
    await load(new QueryClient(), async () => {
      throw new Error("502");
    }, { staleTime: DAY });
    expect(store.map.size).toBe(0);
  });

  it("sweep their own family's other versions and expired entries, and no one else's", async () => {
    const at = Date.now();
    const entry = (buster: string, dataUpdatedAt: number) => ({ buster, queryHash: "h", queryKey: ["k"], state: { dataUpdatedAt, data: 1 } }) as unknown as PersistedQuery;
    persisted({ family: "profiles", version: "1", maxAge: 7 * DAY });
    await store.storage.setItem("q-profiles-a", entry("1", at - DAY));
    await store.storage.setItem("q-profiles-b", entry("0", at - DAY));
    await store.storage.setItem("q-profiles-c", entry("1", at - 9 * DAY));
    await store.storage.setItem("q-schedule-d", entry("other", at - 40 * DAY));
    const dropped = await sweepFamily("profiles", at);
    expect(dropped).toBe(2);
    expect([...store.map.keys()].sort()).toEqual(["q-profiles-a", "q-schedule-d"]);
  });
});
