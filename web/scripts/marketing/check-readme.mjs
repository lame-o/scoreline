/**
 * Marketing screenshots, step 4: checks. Every local image and link in the
 * README resolves (commented-out slots are skipped), no image is over 600 KB,
 * and docs/screenshots stays under 25 MB.
 *
 *     node scripts/marketing/check-readme.mjs
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const readme = readFileSync(join(repo, "README.md"), "utf8").replace(/<!--[\s\S]*?-->/g, "");

const refs = new Set();
for (const m of readme.matchAll(/(?:src|srcset|href)="([^"]+)"/g)) refs.add(m[1]);
for (const m of readme.matchAll(/\]\(([^)\s]+)\)/g)) refs.add(m[1]);
const local = [...refs].filter((r) => !/^(https?:|mailto:|#)/.test(r)).map((r) => r.split("#")[0]);

let problems = 0;
for (const ref of local) {
  if (!existsSync(join(repo, ref))) {
    console.error(`✗ missing: ${ref}`);
    problems++;
  }
}
console.log(`${local.length} local references checked, ${local.length - problems} resolve`);

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));
}
const shots = join(repo, "docs/screenshots");
const files = existsSync(shots) ? walk(shots) : [];
const total = files.reduce((n, f) => n + statSync(f).size, 0);
for (const f of files) {
  const size = statSync(f).size;
  if (size > 600 * 1024) console.warn(`! over 600 KB: ${f.slice(repo.length + 1)} (${Math.round(size / 1024)} KB)`);
}
console.log(`docs/screenshots: ${files.length} files, ${(total / 1024 / 1024).toFixed(1)} MB`);
if (total > 25 * 1024 * 1024) {
  console.error("✗ docs/screenshots is over 25 MB");
  problems++;
}
const social = join(repo, "docs/social-preview.png");
if (existsSync(social)) console.log(`docs/social-preview.png: ${Math.round(statSync(social).size / 1024)} KB${statSync(social).size > 1_000_000 ? " (over GitHub's 1 MB)" : ""}`);
process.exitCode = problems ? 1 : 0;
