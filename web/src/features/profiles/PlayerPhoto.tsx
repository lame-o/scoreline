/**
 * A person's photo in a disc, or Contacts-style initials in the team's color
 * when there's none (most soccer players) (ProfileLinks.swift `PlayerPhoto`).
 * The monogram is also the placeholder while a photo loads: the photo fades
 * in over it once, and a photo already decoded this session (the hero's,
 * prefetched on a link's dwell) draws on its first frame with no fade.
 *
 * Large monograms (heroes) are a solid disc in the team color with white
 * initials; small ones in lists stay quiet. ESPN and bo3 cutouts are
 * transparent and wider than tall: top-aligned. Portraits and FotMob's face
 * crops are centered. Decorative: the name is always beside it.
 */
import { memo, useCallback, useRef, useState } from "react";
import { boldMonogram, photoAlignment } from "../../data/profiles/display";
import { initials } from "../../data/profiles/models";
import { isPhotoLoaded, isPhotoMissing, markPhoto } from "../../state/profilePhotos";
import type { PhotoCrop } from "../../data/profiles/photos";
import styles from "./PlayerPhoto.module.css";

export interface PlayerPhotoProps {
  readonly url: string | null;
  readonly name: string;
  /** The team's color (a CSS color), or null for neutral. */
  readonly tint: string | null;
  /** Mac points. */
  readonly size?: number;
  readonly crop?: PhotoCrop;
  /** The hero: asked for before anything else on the page. */
  readonly priority?: boolean;
  /** Whether light ink reads on the tint (bold monograms). */
  readonly lightInk?: boolean;
  readonly className?: string;
}

function PlayerPhotoView({ url, name, tint, size = 28, crop = "cutout", priority = false, lightInk = true, className }: PlayerPhotoProps) {
  // Per URL: whether it had already loaded when it first rendered (draws at once), and how it went since.
  const seen = useRef<{ url: string | null; instant: boolean }>({ url: null, instant: false });
  if (seen.current.url !== url) seen.current = { url, instant: isPhotoLoaded(url) };
  const [status, setStatus] = useState<{ url: string; ok: boolean } | null>(null);
  const failed = isPhotoMissing(url) || (status?.url === url && !status.ok);
  const loaded = url != null && !failed && (seen.current.instant || (status?.url === url && status.ok));

  // A cached image is complete before React sees it: show it at once.
  const measure = useCallback(
    (img: HTMLImageElement | null) => {
      if (!img || !url || !img.complete) return;
      if (img.naturalWidth > 0) {
        markPhoto(url, true);
        setStatus((s) => (s?.url === url && s.ok ? s : { url, ok: true }));
      }
    },
    [url],
  );

  const bold = boldMonogram(size, tint != null);
  const dimension = `calc(${size} * var(--pt))`;
  return (
    <span
      className={[styles.photo, className].filter(Boolean).join(" ")}
      style={{ width: dimension, height: dimension, ["--tint" as string]: tint ?? "var(--label)" }}
      data-loaded={loaded}
      data-instant={loaded && seen.current.instant}
      data-bold={bold}
      data-tinted={tint != null}
      aria-hidden="true"
    >
      {bold ? <span className={styles.boldDisc} /> : null}
      <span className={styles.monogram} data-light={lightInk} style={{ fontSize: `calc(${size * 0.38} * var(--pt))` }}>
        {initials(name)}
      </span>
      {url && !failed ? (
        <img
          key={url}
          ref={measure}
          className={styles.img}
          src={url}
          alt=""
          draggable={false}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={priority ? "high" : "auto"}
          style={{ objectPosition: photoAlignment(url, crop) === "top" ? "50% 0%" : "50% 50%" }}
          onLoad={() => {
            markPhoto(url, true);
            setStatus({ url, ok: true });
          }}
          onError={() => {
            markPhoto(url, false);
            setStatus({ url, ok: false });
          }}
        />
      ) : null}
    </span>
  );
}

export const PlayerPhoto = memo(PlayerPhotoView);
