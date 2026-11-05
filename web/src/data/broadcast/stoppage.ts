/**
 * Why play has stopped (GameTimeline.swift `Stoppage`, BroadcastLanes.swift
 * `stoppage(type:)`): one table, read by every surface: the hero's line under
 * the clock, the docked bar, the scores list's row and the theater's tag. Its
 * own module, with nothing to import, so the scores list reads it without
 * the broadcast's timeline.
 */

export type Stoppage =
  | {
      readonly kind:
        | "timeout"
        /** The NFL's TV break, the WNBA's: ESPN's "Official Timeout". */
        | "officialTimeout"
        | "twoMinuteWarning"
        /** A challenge, a replay review. */
        | "review"
        /** Soccer: VAR is looking at something. */
        | "varCheck"
        /** Soccer: a man down, or no reason given. */
        | "delay"
        | "pitchingChange"
        | "moundVisit";
    }
  /** Weather, a suspension: the game's own status, in ESPN's words ("Rain Delay"). */
  | { readonly kind: "status"; readonly words: string };

export const Stoppages = {
  timeout: { kind: "timeout" },
  officialTimeout: { kind: "officialTimeout" },
  twoMinuteWarning: { kind: "twoMinuteWarning" },
  review: { kind: "review" },
  varCheck: { kind: "varCheck" },
  delay: { kind: "delay" },
  pitchingChange: { kind: "pitchingChange" },
  moundVisit: { kind: "moundVisit" },
  status: (words: string): Stoppage => ({ kind: "status", words }),
} as const satisfies Record<string, Stoppage | ((words: string) => Stoppage)>;

export function stoppageWords(s: Stoppage): string {
  switch (s.kind) {
    case "timeout":
      return "Timeout";
    case "officialTimeout":
      return "Official timeout";
    case "twoMinuteWarning":
      return "Two-minute warning";
    case "review":
      return "Under review";
    case "varCheck":
      return "VAR check";
    case "delay":
      return "Delay in match";
    case "pitchingChange":
      return "Pitching change";
    case "moundVisit":
      return "Mound visit";
    case "status":
      return s.words;
  }
}

export const sameStoppage = (a: Stoppage | null | undefined, b: Stoppage | null | undefined): boolean =>
  a == null || b == null ? a == b : a.kind === b.kind && (a.kind !== "status" || (b.kind === "status" && a.words === b.words));

/**
 * A stoppage as ESPN names a play's type, whatever the sport. The one table
 * behind the hero, the docked bar, the list row and the theater's tag. (pure; tested)
 */
export function stoppage(type: string | null | undefined): Stoppage | null {
  if (type == null) return null;
  const t = type.toLowerCase();
  switch (t) {
    case "official timeout":
      return Stoppages.officialTimeout;
    case "timeout":
    case "full timeout":
    case "short timeout":
    case "reset timeout":
      return Stoppages.timeout;
    case "two-minute warning":
      return Stoppages.twoMinuteWarning;
    case "pitching change":
      return Stoppages.pitchingChange;
    case "mound visit":
      return Stoppages.moundVisit;
    default:
      return t.startsWith("coach's challenge") || t.startsWith("ref-initiated review") || t === "challenge" ? Stoppages.review : null;
  }
}
