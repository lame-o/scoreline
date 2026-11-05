/**
 * CoStreamIcon: the co-streamer's Twitch avatar in a Twitch-purple ring,
 * or a live glyph in the ring until (or unless) the avatar can be read
 * (DetailView.swift `CoStreamIcon`). Shared by the scores list's rows and
 * tiles and the CS2 page. Decorative: callers say what it means in words.
 * The avatar is an `<img>` from Twitch's CDN, never proxied; it draws once
 * decoded, with no fade (it's a mark, not content).
 */
import { useState } from "react";
import { Icon } from "../icons";
import styles from "./CoStreamIcon.module.css";

export function CoStreamIcon({ avatar, size = 13, className }: { readonly avatar: string | null; readonly size?: number; readonly className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const shows = avatar != null && failed !== avatar;
  return (
    <span className={[styles.icon, className].filter(Boolean).join(" ")} style={{ width: `calc(${size} * var(--pt))`, height: `calc(${size} * var(--pt))` }} aria-hidden="true">
      {shows ? (
        <img className={styles.avatar} src={avatar} alt="" width={size * 2} height={size * 2} decoding="async" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(avatar)} />
      ) : (
        <Icon name="broadcast" size={size * 0.62} />
      )}
    </span>
  );
}
