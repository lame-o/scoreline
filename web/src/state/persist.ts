/**
 * What survives a reload (ScheduleCache.swift, ProfileCache.swift): schedules
 * and team and player pages are kept on disk, in IndexedDB, through TanStack
 * Query's fine-grained persister, so a reloaded page paints from its last
 * copy at once and revalidates behind it, as the Mac's disk caches do with
 * their ETags (the HTTP cache and the edge still answer the revalidation).
 *
 * - Opt-in per query (`persister: persisted(...)`): never the scoreboards, a
 *   game's detail, its lanes or anything else live.
 * - Lazy: a query reads its entry only when it first runs, so nothing is read
 *   for the first paint, and pages that don't use it never open the database.
 * - Each entry carries a version (`buster`); a different one is dropped. Raw
 *   responses (profiles) keep a fixed version; parsed values (schedules) take
 *   their module's URL too, which a build fingerprints with the code, so a
 *   new parser never reads an old shape.
 * - Entries older than their `maxAge` are dropped when read, and swept once
 *   at idle after the app starts (`sweepPersisted`).
 * - Where IndexedDB isn't available (a private window that refuses it,
 *   tests), nothing persists and nothing breaks.
 *
 *     useQuery({ queryKey, queryFn, staleTime, persister: persisted({ family: "profiles", version: "1", maxAge: 7 * DAY }) })
 */
import { experimental_createQueryPersister, type AsyncStorage, type PersistedQuery } from "@tanstack/query-persist-client-core";
import type { QueryPersister } from "@tanstack/react-query";

const DB = "scoreline-cache";
const STORE = "queries";
const PREFIX = "q";

let opening: Promise<IDBDatabase | null> | null = null;

/** The database, opened once (null where IndexedDB isn't there or refuses to open). */
function database(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    try {
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

function run<T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return database().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) return resolve(undefined);
        try {
          const request = body(db.transaction(STORE, mode).objectStore(STORE));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      }),
  );
}

/** IndexedDB as the persister's storage: values are stored as they are (structured clone), not as JSON. */
const indexedStorage: AsyncStorage<PersistedQuery> = {
  getItem: (key) => run<PersistedQuery>("readonly", (s) => s.get(key)),
  setItem: (key, value) => run("readwrite", (s) => s.put(value, key)),
  removeItem: async (key) => {
    await run("readwrite", (s) => s.delete(key));
  },
  // One pass of a cursor, so keys and values come from the same moment.
  entries: () =>
    database().then(
      (db) =>
        new Promise<Array<[string, PersistedQuery]>>((resolve) => {
          const out: Array<[string, PersistedQuery]> = [];
          if (!db) return resolve(out);
          try {
            const request = db.transaction(STORE, "readonly").objectStore(STORE).openCursor();
            request.onsuccess = () => {
              const cursor = request.result;
              if (!cursor) return resolve(out);
              out.push([String(cursor.key), cursor.value as PersistedQuery]);
              cursor.continue();
            };
            request.onerror = () => resolve(out);
          } catch {
            resolve(out);
          }
        }),
    ),
};

let storage: AsyncStorage<PersistedQuery> = indexedStorage;

/** Tests: another storage (an in-memory map), and every persister made again over it. */
export function setPersistStorage(next: AsyncStorage<PersistedQuery> | null): void {
  storage = next ?? indexedStorage;
  persisters.clear();
  families.clear();
}

/** The state worth keeping: the data and when it arrived, not the fetch's own bookkeeping or an error. */
function keep(q: PersistedQuery): PersistedQuery {
  const { data, dataUpdatedAt, dataUpdateCount } = q.state;
  return { ...q, state: { ...q.state, data, dataUpdatedAt, dataUpdateCount, error: null, errorUpdatedAt: 0, errorUpdateCount: 0, fetchFailureCount: 0, fetchFailureReason: null, fetchMeta: null, fetchStatus: "idle", status: "success", isInvalidated: false } };
}

export interface PersistOptions {
  /** Which store it belongs to ("profiles", "schedule"): each sweeps its own entries. */
  readonly family: string;
  /** The family's version: bump it when the stored values' shape changes (one per family). */
  readonly version: string;
  /** How long an entry is good for, from when its data arrived (ms). */
  readonly maxAge: number;
  /**
   * After a restore, refetch if the query's data is stale (the default: an
   * observed query revalidates behind what it shows). `false` for queries
   * nothing observes, which revalidate themselves (state/schedule.ts `cached`).
   */
  readonly refetchOnRestore?: boolean;
}

type Persister = ReturnType<typeof experimental_createQueryPersister<PersistedQuery>>;
const persisters = new Map<string, Persister>();
/** Each family's version and its longest maxAge, for its sweep. */
const families = new Map<string, { version: string; maxAge: number }>();

/** A query's `persister` option, for any query's data and key. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyPersister = QueryPersister<any, any, any>;

/** The `persister` for a query (one per set of options, shared). */
export function persisted({ family, version, maxAge, refetchOnRestore = true }: PersistOptions): AnyPersister {
  const id = `${family}|${version}|${maxAge}|${refetchOnRestore}`;
  let p = persisters.get(id);
  if (!p) {
    p = experimental_createQueryPersister<PersistedQuery>({
      storage,
      maxAge,
      buster: version,
      prefix: `${PREFIX}-${family}`,
      refetchOnRestore,
      serialize: keep,
      deserialize: (stored) => stored,
    });
    persisters.set(id, p);
    const known = families.get(family);
    if (!known) sweepSoon(family);
    families.set(family, { version, maxAge: Math.max(maxAge, known?.maxAge ?? 0) });
  }
  return p.persisterFn as AnyPersister;
}

/** At idle, once per family per visit: drops the family's entries of another version, or older than its longest maxAge. */
function sweepSoon(family: string): void {
  const sweep = () => void sweepFamily(family, Date.now()).catch(() => {});
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback;
  if (idle) idle(sweep, { timeout: 30_000 });
  else setTimeout(sweep, 10_000);
}

/** The family's sweep (exported for tests). */
export async function sweepFamily(family: string, now: number, store: AsyncStorage<PersistedQuery> = storage): Promise<number> {
  const rule = families.get(family);
  if (!rule || !store.entries) return 0;
  const prefix = `${PREFIX}-${family}-`;
  let dropped = 0;
  for (const [key, entry] of await store.entries()) {
    if (!key.startsWith(prefix)) continue;
    const at = entry?.state?.dataUpdatedAt ?? 0;
    if (entry?.buster !== rule.version || !at || now - at > rule.maxAge) {
      await store.removeItem(key);
      dropped++;
    }
  }
  return dropped;
}
