/*
 * Scoreline's service worker: a minimal offline shell, and the hand-off for
 * notification clicks. Scores are never cached here: every /api/ request
 * goes to the network (the Worker and the browser's HTTP cache already hold
 * each kind of data for as long as it stays true).
 *
 * - Pages: network first; offline, the last good app shell (index.html), so
 *   the app opens and says it can't connect instead of the browser's error.
 * - /assets/ (hashed, immutable) and the icons: cache first, filled as they
 *   load. The shell's own assets are fetched on install.
 * - A clicked alert focuses an open Scoreline tab and asks it to open the
 *   game (it navigates in place), or opens a new window on the game.
 */
const SHELL = "scoreline-shell-v1";
const ASSETS = "scoreline-assets-v1";
const KEEP_ASSETS = 80;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      const response = await fetch("/", { cache: "no-cache" });
      if (!response.ok) return;
      await cache.put("/", response.clone());
      // The scripts and styles the shell loads first, so it opens offline.
      const html = await response.text();
      const urls = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
      const assets = await caches.open(ASSETS);
      await Promise.all([...urls, "/icon-192.png", "/icon-64.png", "/manifest.webmanifest"].map((url) => assets.add(url).catch(() => {})));
    })(),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== SHELL && key !== ASSETS) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  for (const request of keys.slice(0, Math.max(0, keys.length - KEEP_ASSETS))) await cache.delete(request);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok) {
            const cache = await caches.open(SHELL);
            await cache.put("/", response.clone());
          }
          return response;
        } catch {
          return (await caches.match("/")) ?? Response.error();
        }
      })(),
    );
    return;
  }

  if (url.pathname.startsWith("/assets/") || /^\/(icon-[\w-]+\.png|apple-touch-icon\.png|manifest\.webmanifest)$/.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const hit = await caches.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(ASSETS);
          await cache.put(request, response.clone());
          void trim(cache);
        }
        return response;
      })(),
    );
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = typeof event.notification.data?.path === "string" && event.notification.data.path.startsWith("/") ? event.notification.data.path : "/";
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const tab = windows.find((c) => new URL(c.url).origin === self.location.origin);
      if (tab) {
        await tab.focus();
        tab.postMessage({ type: "open", path });
        return;
      }
      await self.clients.openWindow(path);
    })(),
  );
});
