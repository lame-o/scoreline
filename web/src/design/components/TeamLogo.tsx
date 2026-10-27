/**
 * TeamLogo: a team's crest at a size in Mac points (16 in rows, 14 in a
 * collapsed preview, 28/34 in tiles and the hero). In dark mode it prefers
 * ESPN's light-on-dark variant and falls back to the regular one if that's
 * missing. A placeholder disc holds the space, so nothing shifts; only a
 * crest arriving from the network fades in. Decorative: the team's name is
 * always beside it.
 */
import { useCallback, useState } from "react";
import { darkLogo } from "../../data/models";
import { sizedLogo } from "../../data/images";
import { useColorScheme } from "../../state/theme";
import styles from "./TeamLogo.module.css";

/** URLs that failed once (a missing dark variant): never asked for again this session. */
const missing = new Set<string>();

export interface TeamLogoProps {
  readonly url: string | null;
  /** Mac points. */
  readonly size?: number;
  readonly className?: string;
}

export function TeamLogo({ url, size = 16, className }: TeamLogoProps) {
  const scheme = useColorScheme();
  const dark = scheme === "dark" ? sizedLogo(darkLogo(url), size) : null;
  const light = sizedLogo(url, size);
  const [, bump] = useState(0);
  const src = dark && !missing.has(dark) ? dark : light && !missing.has(light) ? light : null;
  const [loaded, setLoaded] = useState<{ src: string | null; instant: boolean }>({ src: null, instant: false });

  // A cached image is complete before React sees it: show it at once, no fade.
  const measure = useCallback(
    (img: HTMLImageElement | null) => {
      if (src && img?.complete && img.naturalWidth > 0) setLoaded((l) => (l.src === src ? l : { src, instant: true }));
    },
    [src],
  );

  const dimension = `calc(${size} * var(--pt))`;
  const isLoaded = src != null && loaded.src === src;
  return (
    <span
      className={[styles.frame, className].filter(Boolean).join(" ")}
      style={{ width: dimension, height: dimension }}
      data-loaded={isLoaded}
      data-instant={isLoaded && loaded.instant}
      aria-hidden="true"
    >
      {src ? (
        <img
          key={src}
          ref={measure}
          className={styles.img}
          src={src}
          alt=""
          width={size * 2}
          height={size * 2}
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded((l) => (l.src === src ? l : { src, instant: false }))}
          onError={() => {
            missing.add(src);
            bump((n) => n + 1);
          }}
        />
      ) : null}
    </span>
  );
}
