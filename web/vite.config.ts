import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The client (React, in src/) builds to static assets; the Cloudflare plugin
// builds the Worker (worker/) from cloudflare.config.ts and runs it in workerd
// during `cf dev`, so /api/* behaves locally as it does deployed.
export default defineConfig({
	plugins: [react(), cloudflare()],
	build: {
		// Routes are split by React Router's `lazy`; keep vendor code in one long-lived chunk.
		chunkSizeWarningLimit: 400,
	},
});
