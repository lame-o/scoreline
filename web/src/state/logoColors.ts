/**
 * Where a team's colors come from, in the browser (TeamColors.swift). A
 * valid source primary is authoritative, and every payload that has one
 * feeds a cache by team ID (kept in localStorage), so a payload without
 * colors (a team's schedule, a history page) paints right the first time.
 * Teams with no source colors at all (CS2) read them from the logo: each
 * crest is read once, at 64px, through a canvas (both logo CDNs answer with
 * CORS headers), four at a time, and kept in localStorage. Newly read colors
 * repaint their teams in place: `useLogoColorsVersion()` re-renders on each
 * batch (at most every half second). This is also where a game's match-day
 * kits are held (`noteDetail`).
 */
import { useSyncExternalStore } from "react";
import type { GameDetail } from "../data/gameDetail";
import { sizedLogo } from "../data/images";
import { applyTeamColors, readLogoColors, type LogoColors } from "../data/logoColors";
import type { TeamKit } from "../data/matchColors";
import type { Competitor, ScoreEvent } from "../data/models";
import { oklabFromHex } from "../data/teamColors";

/** Bump when the reading changes, so every logo is read again. */
const KEY = "scoreline.teamColors.v5";
const PIXELS = 64;
const CONCURRENT = 4;

/** Each team's own colors, by team ID, from every payload that had them. */
const KNOWN_KEY = "scoreline.teamIdentities.v1";

let entries: Record<string, LogoColors> = load(KEY);
let known: Record<string, TeamKit> = load(KNOWN_KEY);
/** What each side wears in a game, by event and team ID (`noteDetail`). */
const kits = new Map<string, Readonly<Record<string, TeamKit>>>();
let version = 0;
const listeners = new Set<() => void>();
const pending = new Set<string>();
const queue: string[] = [];
let running = 0;
let notifyTimer: number | null = null;
let saveTimer: number | null = null;

function load<T>(key: string): Record<string, T> {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, T>) : {};
  } catch {
    return {};
  }
}

function scheduleNotify() {
  if (notifyTimer != null) return;
  notifyTimer = window.setTimeout(() => {
    notifyTimer = null;
    version += 1;
    for (const listener of listeners) listener();
  }, 500);
}

/** One write for a burst of new logos (the first visit reads a hundred-odd). */
function scheduleSave() {
  if (saveTimer != null || typeof window === "undefined") return;
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    try {
      localStorage.setItem(KEY, JSON.stringify(entries));
      localStorage.setItem(KNOWN_KEY, JSON.stringify(known));
    } catch {
      // Storage full or blocked: they're read again next visit.
    }
  }, 2000);
}

/**
 * Where a crest is read from: the small size where its host sends CORS
 * headers. bo3's image proxy sends none, so its crests come from bo3's file
 * host, which does (full size, but once per crest: the colors are kept).
 */
export function readableLogo(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.host === "files.bo3.gg" || u.host === "image-proxy.bo3.gg") return `https://files.bo3.gg${u.pathname}`;
  } catch {
    return null;
  }
  return sizedLogo(url, PIXELS / 2);
}

function read(url: string): Promise<LogoColors | null> {
  return new Promise((resolve) => {
    const src = readableLogo(url);
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = PIXELS;
        canvas.height = PIXELS;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, PIXELS, PIXELS);
        resolve(readLogoColors(ctx.getImageData(0, 0, PIXELS, PIXELS).data));
      } catch {
        // A crest without CORS headers taints the canvas: keep the source's color.
        resolve(null);
      }
    };
    // A failed download isn't recorded: it's tried again next time.
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function pump() {
  while (running < CONCURRENT && queue.length > 0) {
    const url = queue.shift()!;
    running += 1;
    void read(url).then((entry) => {
      running -= 1;
      pending.delete(url);
      if (entry) {
        entries = { ...entries, [url]: entry };
        scheduleSave();
        if (entry.colors.length > 0) scheduleNotify();
      }
      pump();
    });
  }
}

function request(url: string) {
  if (pending.has(url) || typeof window === "undefined") return;
  pending.add(url);
  queue.push(url);
  pump();
}

function remember(id: string, team: TeamKit) {
  const was = known[id];
  if (was && was.color === team.color && was.alternate === team.alternate) return;
  known = { ...known, [id]: team };
  scheduleSave();
}

/**
 * A team in its colors (TeamColors.apply): the source's when supplied (and
 * remembered), else what an earlier payload said of this team, else its
 * logo's once read (an unknown logo is queued).
 */
export function applyColors(c: Competitor): Competitor {
  if (oklabFromHex(c.color)) {
    if (c.id) remember(c.id, { color: c.color, alternate: c.alternateColor });
    return c;
  }
  const team = c.id ? known[c.id] : undefined;
  if (!team && c.logo && !entries[c.logo]) request(c.logo);
  return applyTeamColors(c, team, c.logo ? entries[c.logo] : undefined);
}

/** Events with each team in its colors (`applyColors`). Climbing has no crests. */
export function wearColors(events: readonly ScoreEvent[]): ScoreEvent[] {
  return events.map((e) => {
    if (e.content.kind !== "match") return e;
    const { top, bottom } = e.content;
    const t = applyColors(top);
    const b = applyColors(bottom);
    return t === top && b === bottom ? e : { ...e, content: { kind: "match", top: t, bottom: b } };
  });
}

const sameKits = (a: Readonly<Record<string, TeamKit>> | undefined, b: Readonly<Record<string, TeamKit>>) => {
  if (!a) return false;
  const keys = Object.keys(b);
  return Object.keys(a).length === keys.length && keys.every((k) => a[k]?.color === b[k]!.color && a[k]?.alternate === b[k]!.alternate);
};

/**
 * A summary's word on a game (TeamColors.note): each team's own colors, and
 * its kits as this game will wear them. Until kickoff they may still come
 * (lineups post about 40 minutes before) and are taken once they do; from
 * kickoff what's held stands, so a side never changes shirts mid-game. A
 * page first opened later holds what its first summary says. (tested)
 */
export function noteDetail(detail: GameDetail, event: ScoreEvent): GameDetail {
  for (const [id, team] of Object.entries(detail.teamColors)) if (oklabFromHex(team.color)) remember(id, team);
  const held = kits.get(event.id);
  if (event.state !== "scheduled" && held) return held === detail.matchKits ? detail : { ...detail, matchKits: held };
  if (Object.keys(detail.matchKits).length === 0 && held) return { ...detail, matchKits: held };
  if (!sameKits(held, detail.matchKits)) kits.set(event.id, detail.matchKits);
  return detail;
}

/** Re-renders when newly read colors arrive (the number only grows). */
export function useLogoColorsVersion(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => version,
    () => 0,
  );
}
