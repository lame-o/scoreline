/**
 * Logo URLs sized for where they're drawn. Images are never proxied: both
 * CDNs resize on the fly, so a 16pt crest downloads ~5 KB instead of a
 * 90 KB 500px PNG. Sizes are bucketed so the same crest is one cached file
 * across rows, tiles and the hero (ImageCache.swift shares decoded sizes
 * the same way).
 */

const BUCKETS = [40, 64, 96, 160] as const;

/** The smallest bucket covering `points` at 2× density. */
export function logoPixels(points: number): number {
  const wanted = Math.ceil(Math.max(points, 16) * 2);
  return BUCKETS.find((b) => b >= wanted) ?? BUCKETS[BUCKETS.length - 1]!;
}

/** A logo URL resized by its CDN when it has a resizer (ESPN's combiner, bo3.gg's image proxy). */
export function sizedLogo(url: string | null, points: number): string | null {
  if (!url) return null;
  const px = logoPixels(points);
  try {
    const u = new URL(url);
    if (u.host === "a.espncdn.com" && u.pathname.startsWith("/i/")) {
      return `https://a.espncdn.com/combiner/i?img=${u.pathname}&w=${px}&h=${px}`;
    }
    if (u.host === "files.bo3.gg" || u.host === "image-proxy.bo3.gg") {
      return `https://image-proxy.bo3.gg${u.pathname}?w=${px}&h=${px}`;
    }
  } catch {
    return null;
  }
  return url;
}
