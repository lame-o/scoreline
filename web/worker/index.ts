/**
 * The Worker. Static assets (the React app) are served before it runs; it
 * sees only `/api/*` (cloudflare.config.ts: `assets.runWorkerFirst`) and
 * hands those to the proxy. Anything else that reaches it is a 404: the
 * asset layer already answered every app route with index.html.
 */
import { API_PREFIX } from "../shared/upstreams";
import { proxy } from "./proxy";

export default {
  async fetch(request, _env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith(API_PREFIX)) return proxy(request, url, ctx);
    return Response.json({ error: { status: 404, message: "Not found." } }, { status: 404, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  },
} satisfies ExportedHandler<Env>;
