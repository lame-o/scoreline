/**
 * People's photos at the size they're drawn (ProfileProviders.swift
 * `PhotoURL`, ProfileLinks.swift `HeroPhoto`). Never proxied: each CDN
 * resizes on its own.
 *
 * The hero rule: a player page asks for the hero-size photo from its first
 * frame (ESPN's 260×190 combiner crop from the athlete ID), never the list's
 * 96×70 thumbnail stretched, and while a photo is on screen it's never
 * swapped for another crop (the bio's URL arriving later), so the face never
 * moves. Pure; tested.
 */
import { playerSport, type PlayerRef } from "./models";

export type PhotoSize = "small" | "hero";

/**
 * ESPN's resized headshot: 96×70 (7 KB) for lists, 260×190 for the hero,
 * instead of the 600×436 original (200 KB). A missing photo is a 404, and the
 * monogram stays.
 */
export function espnPhoto(path: string, id: string, size: PhotoSize): string {
  const league = path.startsWith("soccer") ? "soccer" : (path.split("/").pop() ?? "");
  const [w, h] = size === "small" ? [96, 70] : [260, 190];
  return `https://a.espncdn.com/combiner/i?img=/i/headshots/${league}/players/full/${id}.png&w=${w}&h=${h}&scale=crop&cquality=40&location=origin`;
}

function host(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function path(url: string): string {
  return new URL(url).pathname;
}

/** bo3.gg's image proxy: a 2 KB thumbnail of a 15 KB portrait. */
export function bo3Photo(url: string | null, size: PhotoSize): string | null {
  if (!url || host(url) !== "files.bo3.gg") return url;
  const px = size === "small" ? 96 : 240;
  return `https://image-proxy.bo3.gg${path(url)}?w=${px}&h=${px}`;
}

/** The hero's size of a bo3.gg photo, from the original or a list's thumbnail. */
export function bo3HeroPhoto(url: string | null): string | null {
  if (!url || host(url) !== "image-proxy.bo3.gg") return bo3Photo(url, "hero");
  return `https://image-proxy.bo3.gg${path(url)}?w=240&h=240`;
}

/** FotMob's transparent 192×192 face crop. */
export function fotMobPhoto(playerID: number | string): string {
  return `https://images.fotmob.com/image_resources/playerimages/${playerID}.png`;
}

export function isFotMobPhoto(url: string | null | undefined): boolean {
  return host(url)?.includes("fotmob") === true;
}

/** The hero's photo, 76pt across. */
export const HERO_PHOTO_SIZE = 76;

export type PhotoCrop = "cutout" | "portrait";

/**
 * ESPN and bo3 cutouts are transparent and wider than tall: top-aligned on a
 * disc. IFSC photos are square portraits, and FotMob's face crops: centered.
 */
export function photoCrop(ref: Pick<PlayerRef, "source">): PhotoCrop {
  return playerSport(ref) === "climbing" ? "portrait" : "cutout";
}

/**
 * The hero-size photo for what a link knows. ESPN: the athlete's headshot at
 * the hero's size, from the ID (a soccer link without a photo has no
 * headshot: wait for the bio). bo3.gg: its 240px proxy. FotMob and IFSC: as
 * they are (one size). null: wait for the bio.
 */
export function heroPhotoURL(ref: PlayerRef): string | null {
  switch (ref.source.kind) {
    case "espn":
      if (isFotMobPhoto(ref.photo)) return ref.photo;
      if (ref.photo == null && ref.source.path.startsWith("soccer")) return null;
      return espnPhoto(ref.source.path, ref.id, "hero");
    case "counterStrike":
      return bo3HeroPhoto(ref.photo);
    case "ifsc":
      return ref.photo;
  }
}

/**
 * The photo the hero opens with: one already decoded at the hero's size
 * (this link's, or the bio's from a past visit) draws on the first frame;
 * otherwise the link's, else the bio's.
 */
export function initialHeroPhoto(ref: PlayerRef, bio: string | null, isCached: (url: string) => boolean): string | null {
  const link = heroPhotoURL(ref);
  const ready = [link, bio].find((u): u is string => u != null && isCached(u));
  return ready ?? link ?? bio;
}

/**
 * The bio's photo arriving: the photo on screen stays for the rest of the
 * visit; with only the monogram showing, the bio's is asked for (or the
 * current one kept, when the bio has none).
 */
export function nextHeroPhoto(current: string | null, proposed: string | null, isShown: (url: string) => boolean): string | null {
  if (current != null && isShown(current)) return current;
  return proposed ?? current;
}
