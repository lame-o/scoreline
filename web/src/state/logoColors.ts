/**
 * Logo colors in the browser (TeamColors.swift's queue and cache): each
 * crest is read once, at 64px, through a canvas (both logo CDNs answer with
 * CORS headers), four at a time, and kept in localStorage. Newly read colors
 * repaint their teams in place: `useLogoColors()` re-renders on each batch
 * (at most every half second).
 */
import { useSyncExternalStore } from "react";
import { sizedLogo } from "../data/images";
import { readLogoColors, wearLogoColors, type LogoColors } from "../data/logoColors";
import type { ScoreEvent } from "../data/models";

/** Bump when the reading changes, so every logo is read again. */
const KEY = "scoreline.teamColors.v5";
const PIXELS = 64;
const CONCURRENT = 4;

let entries: Record<string, LogoColors> = load();
let version = 0;
const listeners = new Set<() => void>();
const pending = new Set<string>();
const queue: string[] = [];
let running = 0;
let notifyTimer: number | null = null;
let saveTimer: number | null = null;

function load(): Record<string, LogoColors> {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, LogoColors>) : {};
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
  if (saveTimer != null) return;
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    try {
      localStorage.setItem(KEY, JSON.stringify(entries));
    } catch {
      // Storage full or blocked: they're read again next visit.
    }
  }, 2000);
}

function read(url: string): Promise<LogoColors | null> {
  return new Promise((resolve) => {
    const src = sizedLogo(url, PIXELS / 2);
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

/**
 * Events with each team in its logo's colors where they're known; logos not
 * read yet are queued. Climbing has no crests.
 */
export function wearColors(events: readonly ScoreEvent[]): ScoreEvent[] {
  return events.map((e) => {
    if (e.content.kind !== "match") return e;
    const { top, bottom } = e.content;
    for (const c of [top, bottom]) if (c.logo && !entries[c.logo]) request(c.logo);
    const t = wearLogoColors(top, top.logo ? entries[top.logo] : undefined);
    const b = wearLogoColors(bottom, bottom.logo ? entries[bottom.logo] : undefined);
    return t === top && b === bottom ? e : { ...e, content: { kind: "match", top: t, bottom: b } };
  });
}

/**
 * One logo's colors, when read; the logo is queued otherwise (team and
 * player pages, whose wash takes the crest's colors as they arrive).
 * Re-render with `useLogoColorsVersion()`.
 */
export function logoColorsFor(logo: string | null): LogoColors | undefined {
  if (!logo) return undefined;
  if (!entries[logo]) request(logo);
  return entries[logo];
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
