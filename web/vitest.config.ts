import { defineConfig } from "vitest/config";

// Unit tests run in Node against recorded fixtures: no browser, and the
// Worker's proxy with the Cache API and fetch stubbed.
// (The Cloudflare plugin is deliberately not loaded here.)
export default defineConfig({
	test: {
		include: ["test/unit/**/*.test.ts", "test/worker/**/*.test.ts"],
		environment: "node",
		// Times and days are asserted in one zone, whatever the machine's.
		env: { TZ: "America/New_York" },
		// The theater engine's checks bake whole recordings (a few seconds each, alone);
		// on a machine busy with other builds they need room past Vitest's 5 s default.
		// The heaviest set their own, longer limits.
		testTimeout: 30_000,
	},
});
