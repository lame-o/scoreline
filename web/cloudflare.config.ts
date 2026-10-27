import { defineConfig } from "cf/config";
import * as entrypoint from "./worker/index.ts" with { type: "cf-worker" };

// Scoreline for the web: the React app as static assets, plus an `/api/*`
// Worker that proxies and caches the sports feeds (worker/proxy.ts).
//
// No accountId here on purpose: the repo is public, and the account is
// chosen at deploy time.
export default defineConfig({
	worker: {
		name: "scoreline-web",
		compatibilityDate: "2026-10-26",
		compatibilityFlags: ["nodejs_compat"],
		entrypoint,
		assets: {
			// Every app route (/game/123, /settings…) gets index.html; React Router takes it from there.
			notFoundHandling: "single-page-application",
			// The proxy runs before the asset layer for its own paths only.
			runWorkerFirst: ["/api/*"],
		},
		// Workers Caching in front of the proxy: collapses bursts of identical
		// polls and works on workers.dev, where the Cache API inside the proxy is
		// a no-op. The proxy's CDN-Cache-Control sets each response's lifetime.
		cache: { enabled: true },
		observability: {
			enabled: true,
			logs: { enabled: true, invocationLogs: true },
			traces: { enabled: true, headSamplingRate: 0.1 },
		},
	},
});
