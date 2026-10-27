/**
 * People's photos already downloaded and decoded this session
 * (ImageCache.swift's role for photos): a photo on this list draws on its
 * first frame with no fade, and a failed one isn't asked for again. Light on
 * purpose, so any page drawing a person can use it.
 */

const loadedPhotos = new Set<string>();
const failedPhotos = new Set<string>();
const preloading = new Map<string, HTMLImageElement>();

/** Whether a photo has been downloaded and decoded this session (it draws on its first frame, with no fade). */
export function isPhotoLoaded(url: string | null | undefined): boolean {
  return url != null && loadedPhotos.has(url);
}

export function isPhotoMissing(url: string | null | undefined): boolean {
  return url != null && failedPhotos.has(url);
}

export function markPhoto(url: string, ok: boolean): void {
  (ok ? loadedPhotos : failedPhotos).add(url);
}

/** Downloads and decodes a photo ahead of its page. */
export function preloadPhoto(url: string): void {
  if (loadedPhotos.has(url) || failedPhotos.has(url) || preloading.has(url) || typeof Image === "undefined") return;
  const img = new Image();
  img.decoding = "async";
  preloading.set(url, img);
  img.src = url;
  img.decode().then(
    () => {
      preloading.delete(url);
      loadedPhotos.add(url);
    },
    () => {
      preloading.delete(url);
      if (img.naturalWidth === 0) failedPhotos.add(url);
    },
  );
}

