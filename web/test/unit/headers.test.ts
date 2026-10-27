/**
 * The static assets' headers (public/_headers): security headers on every
 * page, a CSP the app runs under, and a year's cache on hashed bundles.
 * The CSP allows index.html's inline theme script by its hash, so editing
 * that script without updating the hash would let a dark page flash light.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { UPSTREAMS } from "../../shared/upstreams";

const root = join(import.meta.dirname, "..", "..");
const headersFile = readFileSync(join(root, "public", "_headers"), "utf8");
const indexHTML = readFileSync(join(root, "index.html"), "utf8");

/** `_headers` as path → header name (lowercased) → value. */
function rules(text: string): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  let current: Map<string, string> | null = null;
  for (const line of text.split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      current = new Map();
      out.set(line.trim(), current);
    } else if (current) {
      const i = line.indexOf(":");
      current.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim());
    }
  }
  return out;
}

const all = rules(headersFile).get("/*")!;
const csp = new Map(
  (all.get("content-security-policy") ?? "")
    .split(";")
    .map((d) => d.trim().split(/\s+/))
    .filter((d) => d[0])
    .map(([name, ...values]) => [name!, values]),
);

describe("the static assets' headers", () => {
  it("sends the security headers on every page", () => {
    expect(all.get("x-content-type-options")).toBe("nosniff");
    expect(all.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(all.get("x-frame-options")).toBe("DENY");
    expect(csp.get("frame-ancestors")).toEqual(["'none'"]);
    expect(csp.get("object-src")).toEqual(["'none'"]);
  });

  it("allows index.html's inline scripts by hash, and nothing else inline", () => {
    const inline = [...indexHTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${createHash("sha256").update(m[1]!).digest("base64")}'`);
    expect(inline.length).toBeGreaterThan(0);
    const scripts = csp.get("script-src") ?? [];
    for (const hash of inline) expect(scripts, "update the hash in public/_headers").toContain(hash);
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toContain("'unsafe-eval'");
  });

  it("keeps data on the app's own origin (the /api proxy) and images on https", () => {
    expect(csp.get("connect-src")).toEqual(["'self'", ...UPSTREAMS.filter((u) => u.direct).map((u) => `https://${u.host}`)]);
    expect(csp.get("img-src")).toEqual(expect.arrayContaining(["'self'", "https:", "data:"]));
  });

  it("caches hashed bundles for a year", () => {
    expect(rules(headersFile).get("/assets/*")?.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });
});
