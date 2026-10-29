/**
 * Settings the app shell owns (ManageView.swift's Menu Bar, Live Games'
 * sounds, Notifications and credits), adapted for a browser:
 *
 * - Tab: the Mac's menu bar item is the tab's title and icon here. A pinned
 *   game always shows; this decides whether a followed team's live game does.
 * - Sounds: the game pages' celebration sounds (`celebrationSounds`; game/core/sound.ts), unlocking the browser's audio as it's switched on.
 * - Notifications: the toggle is on only when the browser allows alerts, and
 *   turning it on is the one place the app asks (never on load). The
 *   browser's answer shows under it, kept current.
 * - Keyboard: the bare-key commands (pointer devices only).
 * - Credits: where the data comes from.
 */
import { FormSection, GroupBox, Icon, ToggleRow, formStyles } from "../../design/components";
import { requestNotificationPermission, useNotificationPermission, type NotificationPermissionState } from "../../state/notifications";
import { settings, useSettings } from "../../state/settings";
import { unlockAudio } from "../game/core/sound";
import styles from "./Settings.module.css";

export function TabSection() {
  const scoreInTitle = useSettings((s) => s.scoreInTitle);
  return (
    <FormSection title="Tab" icon="pin" caption="Any game can show its score in the tab: choose Show in Tab from its menu.">
      <GroupBox>
        <ToggleRow title="Live score" subtitle="In the tab's title and icon when a team you follow is playing" checked={scoreInTitle} onChange={(v) => settings.set("scoreInTitle", v)} />
      </GroupBox>
    </FormSection>
  );
}

/** Live Games' second row: sounds, off while celebrations are. */
export function SoundsRow() {
  const sounds = useSettings((s) => s.celebrationSounds);
  const off = useSettings((s) => s.celebrationLevel === "off");
  return (
    <ToggleRow
      title="Sounds"
      subtitle="When the game you're watching scores"
      checked={sounds && !off}
      disabled={off}
      onChange={(v) => {
        // The switch is a gesture: the browser lets the page's audio start now.
        if (v) unlockAudio();
        settings.set("celebrationSounds", v);
      }}
    />
  );
}

const PERMISSION: Readonly<Record<NotificationPermissionState, { label: string; note: string | null; tone: "ok" | "neutral" | "warning" }>> = {
  granted: { label: "Allowed", note: null, tone: "ok" },
  default: { label: "Not Asked Yet", note: "Your browser asks when you turn alerts on.", tone: "neutral" },
  denied: { label: "Blocked", note: "Blocked in this browser's settings for this site, so alerts can't appear. Allow notifications there, then come back.", tone: "warning" },
  unsupported: { label: "Unavailable", note: "This browser can't show notifications. On iPhone and iPad, add Scoreline to your Home Screen first.", tone: "warning" },
};

export function NotificationsSection() {
  const notify = useSettings((s) => s.notifyFollowed);
  const hasTeams = useSettings((s) => s.followed.length > 0);
  const permission = useNotificationPermission();
  const state = PERMISSION[permission];
  const on = notify && permission === "granted";
  const toggle = async (next: boolean) => {
    settings.set("notifyFollowed", next);
    if (next) await requestNotificationPermission();
  };
  // One caption: what's in the way, else when alerts arrive; and until a team is followed, how to get them.
  const caption = [state.note ?? "Alerts arrive while Scoreline is open in a tab, even one in the background.", hasTeams ? null : "Follow a team to get alerts for its games."]
    .filter(Boolean)
    .join(" ");
  return (
    <FormSection title="Notifications" icon="bell" caption={caption}>
      <GroupBox>
        <ToggleRow title="Alerts for my teams" subtitle="When a game starts, on every score, and at the end" checked={on} disabled={permission === "denied" || permission === "unsupported"} onChange={(v) => void toggle(v)} />
        <div className={formStyles.row} data-testid="notification-permission">
          <span className={formStyles.rowTitle} style={{ flex: 1 }}>
            Browser permission
          </span>
          <span className={styles.permission} data-tone={state.tone}>
            {state.tone === "warning" ? <Icon name="warning" size={10} /> : state.tone === "ok" ? <Icon name="check" size={9} /> : null}
            {state.label}
          </span>
        </div>
      </GroupBox>
    </FormSection>
  );
}

const SHORTCUTS: readonly (readonly [string, readonly string[]])[] = [
  ["Refresh", ["R"]],
  ["Settings", [","]],
  ["Schedule", ["S"]],
  ["Move through games", ["↑", "↓", "←", "→"]],
  ["Open the game", ["Return"]],
  ["Show the game in the tab", ["P"]],
  ["The game's menu", ["Shift", "F10"]],
  ["Back", ["Esc"]],
];

/** The keys, as a Mac app's menus would list them (the browser keeps ⌘R and ⌘, for itself). */
export function KeyboardSection() {
  return (
    <div className={styles.pointerOnly}>
      <FormSection title="Keyboard" icon="list" caption="Schedules also take ⌥1 and ⌥2 for Upcoming and Results, and T for Today.">
        <GroupBox label="Keyboard shortcuts">
          {SHORTCUTS.map(([action, keys]) => (
            <div key={action} className={formStyles.row}>
              <span className={formStyles.rowTitle} style={{ flex: 1 }}>
                {action}
              </span>
              <span className={styles.keys}>
                {keys.map((k) => (
                  <kbd key={k}>{k}</kbd>
                ))}
              </span>
            </div>
          ))}
        </GroupBox>
      </FormSection>
    </div>
  );
}

export function Credits() {
  return (
    <p className={`${formStyles.caption} ${styles.credits}`}>
      Data from ESPN, bo3.gg and IFSC. Win probability by ESPN. Odds from Polymarket and DraftKings. Scoreline is{" "}
      <a href="https://github.com/lame-o/scoreline" target="_blank" rel="noopener noreferrer">
        open source
      </a>{" "}
      and also lives in the Mac's menu bar.
    </p>
  );
}
