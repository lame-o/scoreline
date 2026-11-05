/**
 * The marks beside a row's or tile's status (EventRow.swift `StatusView`,
 * Tiles.swift `TileHeader`): the co-streamer's avatar on a live CS2 match
 * they're showing on Twitch, and YouTube's red play mark on a climbing
 * round World Climbing is streaming live. Each reads what's streaming by
 * selector (state/streams.ts), so a change redraws only this corner of the
 * rows it touches; rows of other sports never subscribe to more than a
 * constant. `streamWords` says the same in words for the row's label
 * (EventRow.swift `RowSpeech.marks`).
 */
import { memo } from "react";
import { CoStreamIcon, Icon } from "../../design/components";
import { liveOnYouTube } from "../../data/climbingBroadcast";
import { coStreamerName } from "../../data/coStream";
import type { ScoreEvent } from "../../data/models";
import { useStreams, type StreamState } from "../../state/streams";
import styles from "./EventRow.module.css";

/** Whether a row could wear a stream mark at all (climbing, CS2). */
export function mayStream(event: ScoreEvent): boolean {
  return event.ref?.kind === "climbing" || event.ref?.kind === "counterStrike";
}

function words(event: ScoreEvent, s: StreamState): string {
  if (event.ref?.kind === "climbing") return liveOnYouTube(event, s.climbing) ? "Live on YouTube" : "";
  if (event.ref?.kind === "counterStrike") return s.coStreaming.has(event.id) ? `${coStreamerName(s.handle)} is co-streaming` : "";
  return "";
}

/** "Live on YouTube", "ohnePixel is co-streaming", or "" (a primitive: the row re-renders only when it changes). */
export function useStreamWords(event: ScoreEvent): string {
  return useStreams((s) => (mayStream(event) ? words(event, s) : ""));
}

/** The marks themselves, sized for a row (co-stream 13, YouTube 14) or a tile (12, 12.5). */
export const StreamMarks = memo(function StreamMarks({ event, tile = false }: { event: ScoreEvent; tile?: boolean }) {
  const said = useStreamWords(event);
  const avatar = useStreams((s) => (event.ref?.kind === "counterStrike" ? s.avatar : null));
  if (!said) return null;
  if (event.ref?.kind === "counterStrike") {
    return (
      <span className={styles.mark} title={said}>
        <CoStreamIcon avatar={avatar} size={tile ? 12 : 13} />
      </span>
    );
  }
  return (
    <span className={`${styles.mark} ${styles.youtube}`} title="Streaming on YouTube">
      <Icon name="play" size={tile ? 12.5 : 14} />
    </span>
  );
});
