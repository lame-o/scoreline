import { defineConfig } from "vitest/config";

// Unit tests run in Node against recorded fixtures: no Worker, no browser.
// (The Cloudflare plugin is deliberately not loaded here.)
export default defineConfig({
	test: {
		include: ["test/unit/**/*.test.ts"],
		environment: "node",
	},
});
