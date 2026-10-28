/**
 * Marketing screenshots, step 3: the README's pictures and its "Every page"
 * galleries, from shots.config.mjs and the images compose.mjs made.
 *
 * - Each `<!-- slot:<key>:start -->` … `<!-- slot:<key>:end -->` gets the
 *   first of its options whose images all exist in light and dark
 *   (readmeSlots): the Mac app's when the Mac renders have landed, else the
 *   web's, else nothing.
 * - `<!-- gallery:mac:… -->` and `<!-- gallery:web:… -->` get a table of every
 *   screen that exists; the Mac one appears once it has a screen.
 *
 * Only images that exist are written, so the README never shows a broken
 * or placeholder image, and it's safe to run at any point.
 *
 *     node scripts/marketing/readme-gallery.mjs
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gallery, macGallery, readmeSlots } from "./shots.config.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const readmePath = join(repo, "README.md");

const picture = (dir, name, label, width) =>
  `<picture><source media="(prefers-color-scheme: dark)" srcset="${dir}/${name}-dark.webp"><img src="${dir}/${name}-light.webp" width="${width}" alt="${label}"></picture>`;
const both = (dir, name) => ["light", "dark"].every((t) => existsSync(join(repo, dir, `${name}-${t}.webp`)));

/** A table of `columns` cells per row, each a picture and its caption. */
function grid(items, dir, columns) {
  const present = items.filter((i) => both(dir, i.name));
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

/** A slot's picture rows: centered, a row's images sharing the width (100%, 49%, 32%). */
function rows(option) {
  return option
    .map((row) => {
      const width = row.length === 1 ? "100%" : `${Math.floor(100 / row.length) - 1}%`;
      return `<p align="center">\n${row.map((img) => `  ${picture(img.dir, img.name, img.alt, width)}`).join("\n")}\n</p>`;
    })
    .join("\n\n");
}

let readme = readFileSync(readmePath, "utf8");
function fill(marker, block) {
  const re = new RegExp(`<!-- ${marker}:start -->[\\s\\S]*?<!-- ${marker}:end -->`);
  if (!re.test(readme)) throw new Error(`README has no ${marker} markers`);
  readme = readme.replace(re, `<!-- ${marker}:start -->\n${block ? `${block}\n` : ""}<!-- ${marker}:end -->`);
}

const chosen = [];
for (const slot of readmeSlots) {
  const option = slot.options.find((o) => o.every((row) => row.every((img) => both(img.dir, img.name)))) ?? [];
  fill(`slot:${slot.key}`, rows(option));
  chosen.push(`${slot.key}: ${option.length ? option.flat().map((i) => `${i.dir.split("/").pop()}/${i.name}`).join(", ") : "(empty)"}`);
}

const desktop = grid(gallery.filter((g) => g.device !== "phone"), "docs/screenshots/web/pages", 2);
const phones = grid(gallery.filter((g) => g.device === "phone"), "docs/screenshots/web/pages", 4);
fill("gallery:web", section("The web app", [desktop.html, phones.html].filter(Boolean).join("\n\n"), desktop.count + phones.count));
const mac = grid(macGallery, "docs/screenshots/mac/pages", 3);
fill("gallery:mac", mac.count ? section("The Mac app", mac.html, mac.count) : "");

writeFileSync(readmePath, readme);
console.log(chosen.join("\n"));
console.log(`galleries: web ${desktop.count + phones.count}, Mac ${mac.count}`);
