/**
 * Web notifications for followed teams (Notifier.swift, the delivery half;
 * the words are data/notifier.ts). Posted while a Scoreline tab is open, even
 * in the background: the shell keeps polling a hidden tab while alerts are on
 * (state/scores.ts, `poll: "auto"`).
 *
 * - Permission is asked only from Settings → Notifications (a click), never
 *   on load. `useNotificationPermission` follows it, including changes made
 *   in the browser's site settings.
 * - One alert per game, replacing itself (`tag` is the event ID), with
 *   `renotify` so each score still sounds.
 * - Through the service worker when there is one (Android requires it; its
 *   `notificationclick` focuses the tab and asks it to open the game), else
 *   the page's own `Notification`.
 * - Several open tabs post each alert once: the first tab to claim it (a Web
 *   Lock around a note in localStorage) posts; the rest stand aside.
 */
import { useSyncExternalStore } from "react";
import type { Alert } from "../data/notifier";

export type NotificationPermissionState = "unsupported" | "default" | "granted" | "denied";

const supported = () => typeof window !== "undefined" && "Notification" in window;

export function notificationPermission(): NotificationPermissionState {
  return supported() ? (Notification.permission as NotificationPermissionState) : "unsupported";
}

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let watching = false;

function watch() {
  if (watching || typeof window === "undefined") return;
  watching = true;
  // The user can change it in the browser's site settings at any time: re-read on return.
  document.addEventListener("visibilitychange", emit);
  window.addEventListener("focus", emit);
  void navigator.permissions
    ?.query({ name: "notifications" as PermissionName })
    .then((status) => status.addEventListener("change", emit))
    .catch(() => {});
}

function subscribe(listener: () => void) {
  watch();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The browser's permission, kept current. */
export function useNotificationPermission(): NotificationPermissionState {
  return useSyncExternalStore(subscribe, notificationPermission, () => "default");
}

/** Asks the browser (call from a click). Resolves with the answer. */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (!supported()) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission as NotificationPermissionState;
  try {
    await Notification.requestPermission();
  } catch {
    // Old Safari takes a callback; its promise-less call throws. The re-read below says what happened.
  }
  emit();
  return notificationPermission();
}

// MARK: - Posting

const CLAIMS = "scoreline.alerts";
/** How long a claim stands: another tab polling the same change within this stands aside. */
const CLAIM_MS = 90_000;

/** Records the alert as posted, unless another tab already did. */
function claim(alert: Alert, now: number): boolean {
  try {
    const raw = localStorage.getItem(CLAIMS);
    const claims = (raw ? JSON.parse(raw) : {}) as Record<string, { body: string; at: number }>;
    const last = claims[alert.tag];
    if (last && last.body === alert.body && now - last.at < CLAIM_MS) return false;
    const kept = Object.fromEntries(Object.entries(claims).filter(([, c]) => now - c.at < CLAIM_MS));
    kept[alert.tag] = { body: alert.body, at: now };
    localStorage.setItem(CLAIMS, JSON.stringify(kept));
    return true;
  } catch {
    return true;
  }
}

async function claimed(alert: Alert): Promise<boolean> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks) return claim(alert, Date.now());
  return locks.request("scoreline-alerts", () => claim(alert, Date.now()));
}

export interface PostOptions {
  /** The game's page, opened by a click. */
  readonly path: string;
  /** For the page's own notifications: open the game in this tab. */
  readonly open: (path: string) => void;
}

/** Posts an alert (when allowed, and not already posted by another tab). */
export async function postAlert(alert: Alert, { path, open }: PostOptions): Promise<void> {
  if (notificationPermission() !== "granted" || !(await claimed(alert))) return;
  const options: NotificationOptions & { renotify?: boolean } = {
    body: alert.body,
    tag: alert.tag,
    renotify: true,
    icon: "/icon-192.png",
    data: { path },
  };
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration?.active) {
      await registration.showNotification(alert.title, options);
      return;
    }
  } catch {
    // Fall through to the page's own notification.
  }
  try {
    const n = new Notification(alert.title, options);
    n.onclick = () => {
      window.focus();
      open(path);
      n.close();
    };
  } catch {
    // A browser that only allows service-worker notifications, without one: nothing to do.
  }
}
