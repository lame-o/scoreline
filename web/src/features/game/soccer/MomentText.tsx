/**
 * A key event's words with the people in them linked to their pages (the
 * core's `momentText` hook): a goal's or card's player where the headline
 * names them, and a goal's assist after it ("Nicolas Jackson · assist
 * McGinn"). ESPN lists a key event's participants scorer first.
 */
import type { ReactNode } from "react";
import type { DetailMoment } from "../../../data/gameDetail";
import { PlayerLink, type PlayerRef } from "../../profiles/ProfileLinks";
import styles from "./SoccerPage.module.css";

export function soccerMomentText(playerRef: (id: string, name: string) => PlayerRef | null) {
  return function MomentText(m: DetailMoment, text: string): ReactNode {
    const [first, assist] = m.players ?? [];
    if (!first) return text;
    const named = text.startsWith(first.name);
    const goal = m.kind === "goal" && assist != null && assist.id !== first.id;
    return (
      <>
        {named ? <PlayerLink player={playerRef(first.id, first.name)}>{first.name}</PlayerLink> : null}
        {named ? text.slice(first.name.length) : text}
        {goal ? (
          <span className={styles.assist}>
            {" · assist "}
            <PlayerLink player={playerRef(assist.id, assist.name)}>{assist.name.split(" ").at(-1) ?? assist.name}</PlayerLink>
          </span>
        ) : null}
      </>
    );
  };
}
