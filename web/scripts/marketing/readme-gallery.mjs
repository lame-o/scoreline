/**
 * Marketing screenshots, step 3: the README's hero and its "Every page"
 * galleries, written between the `<!-- hero:start -->`,
 * `<!-- gallery:mac:start -->` and `<!-- gallery:web:start -->` markers from
 * shots.config.mjs and the images compose.mjs made. Only images that exist
 * are listed, so the README never shows a broken image: the hero is the Mac
 * one once docs/screenshots/mac/hero-*.webp exist (the web scores until
 * then), and the Mac gallery appears once it has a screen.
 *
 *     node scripts/marketing/readme-gallery.mjs
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gallery, macGallery, readmeImages } from "./shots.config.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const readmePath = join(repo, "README.md");

const picture = (dir, name, label, width) =>
  `<picture><source media="(prefers-color-scheme: dark)" srcset="${dir}/${name}-dark.webp"><img src="${dir}/${name}-light.webp" width="${width}" alt="${label}"></picture>`;

/** A table of `columns` cells per row, each a picture and its caption. */
function grid(items, dir, columns) {
  const present = items.filter((i) => existsSync(join(repo, dir, `${i.name}-light.webp`)) && existsSync(join(repo, dir, `${i.name}-dark.webp`)));
  const rows = [];
  for (let i = 0; i < present.length; i += columns) {
    const cells = present.slice(i, i + columns).map((item) => `<td width="${Math.floor(100 / columns)}%" align="center" valign="top">${picture(dir, item.name, item.label, "100%")}<br><sub>${item.label}</sub></td>`);
    rows.push(`<tr>\n${cells.join("\n")}\n</tr>`);
  }
  return { count: present.length, html: rows.length ? `<table>\n${rows.join("\n")}\n</table>` : "" };
}

function section(title, body, count) {
  return `<details>\n<summary><b>${title}</b>${count ? ` (${count} screens)` : ""}</summary>\n<br>\n\n${body}\n\n</details>`;
}

const desktop = grid(gallery.filter((g) => g.device !== "phone"), "docs/screenshots/web/pages", 2);
const phones = grid(gallery.filter((g) => g.device === "phone"), "docs/screenshots/web/pages", 4);
const web = section("The web app", [desktop.html, phones.html].filter(Boolean).join("\n\n"), desktop.count + phones.count);

const mac = grid(macGallery, "docs/screenshots/mac/pages", 3);
const macBlock = mac.count ? section("The Mac app", mac.html, mac.count) : "";

const both = (dir, name) => ["light", "dark"].every((t) => existsSync(join(repo, dir, `${name}-${t}.webp`)));
const hero = both("docs/screenshots/mac", "hero")
  ? { dir: "docs/screenshots/mac", name: "hero", alt: "Scoreline's panel open under the Mac menu bar, with a live game's isometric view" }
  : { dir: "docs/screenshots/web", name: "scores", alt: "Scoreline: every live game in the sidebar, beside a live NBA game's shot chart and box score" };
const heroBlock = `<p align="center">\n  ${picture(hero.dir, hero.name, hero.alt, "100%")}\n</p>`;

let readme = readFileSync(readmePath, "utf8");
const replace = (key, block) => {
  const re = new RegExp(`<!-- gallery:${key}:start -->[\\s\\S]*?<!-- gallery:${key}:end -->`);
  if (!re.test(readme)) throw new Error(`README has no gallery:${key} markers`);
  readme = readme.replace(re, `<!-- gallery:${key}:start -->\n${block}\n<!-- gallery:${key}:end -->`);
};
replace("mac", macBlock);
replace("web", web);
{
  const re = /<!-- hero:start -->[\s\S]*?<!-- hero:end -->/;
  if (!re.test(readme)) throw new Error("README has no hero markers");
  readme = readme.replace(re, `<!-- hero:start -->\n${heroBlock}\n<!-- hero:end -->`);
}
for (const item of readmeImages) {
  const re = new RegExp(`<!-- image:${item.key}:start -->[\\s\\S]*?<!-- image:${item.key}:end -->`);
  if (!re.test(readme)) throw new Error(`README has no image:${item.key} markers`);
  const block = both(item.dir, item.name) ? `\n<p align="center">\n  ${picture(item.dir, item.name, item.alt, item.width ?? "100%")}\n</p>\n` : "\n";
  readme = readme.replace(re, `<!-- image:${item.key}:start -->${block}<!-- image:${item.key}:end -->`);
}
writeFileSync(readmePath, readme);
console.log(`README hero: ${hero.dir}/${hero.name}; galleries: web ${desktop.count + phones.count}, Mac ${mac.count}`);
