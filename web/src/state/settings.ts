/**
 * Settings: every preference the app keeps, persisted in localStorage behind
 * one typed, versioned store. The future home of every setting, so it
 * mirrors the Mac app's semantics (ScoreStore.swift preferences, ManageView,
 * LeagueSettingsView): the same names, defaults and rules (picking a team
 * turns its league's filter on; a hidden league keeps its picks).
 *
 *     const leagues = useSettings((s) => s.enabledLeagues);
 *     settings.setEnabled("nba", true);
 *
 * Adding a setting: add it to `Settings` and `DEFAULTS`, read it in
 * `sanitize` (never trust storage), add an action if it needs a rule, and
 * list it in ARCHITECTURE.md § Settings. Changing a setting's shape bumps
 * `VERSION` with a migration in `sanitize`.
 *
 * Mac-only settings (menu bar label, live game count, open at login,
 * updates) have no web equivalent and aren't here.
 */
import { useSyncExternalStore } from "react";
import { CATALOG, DEFAULT_LEAGUE_IDS, leagueWithID } from "../data/leagues";
import type { FollowedTeam } from "../data/models";
import { CLIMBING_DISCIPLINES } from "../data/scoreboard";

export type LandingView = "list" | "tiles";
export type Theme = "system" | "light" | "dark";
export type CelebrationLevel = "full" | "subtle" | "off";

export interface Settings {
  /** Enabled leagues, in the user's order (Swift `enabledLeagues`). */
  readonly enabledLeagues: readonly string[];
  /** Followed teams, in the order followed (`followedTeams`). */
  readonly followed: readonly FollowedTeam[];
  /** League → picked team IDs; climbing: "country-SLO" (`teamFilters`). */
  readonly teamFilters: Readonly<Record<string, readonly string[]>>;
  /** Leagues where the pick filter is on (`filteredLeagues`). */
  readonly filteredLeagues: readonly string[];
  /** College football: Top 25 games only, plus followed teams (`collegeTop25Only`). */
  readonly collegeTop25Only: boolean;
  /** Climbing disciplines shown (`climbingDisciplines`). */
  readonly climbingDisciplines: readonly string[];
  /** Results from the last 18 hours (`showFinished`). */
  readonly showFinished: boolean;
  /** Leagues with live games move to the top of the list (`liveLeaguesFirst`). */
  readonly liveFirst: boolean;
  /** Collapsed list sections and tile tiers ("tiles.live") (`collapsedSections`). */
  readonly collapsed: readonly string[];
  /** List or Tiles (`landingView`). */
  readonly landingView: LandingView;
  /** Appearance: follow the system, or always light or dark (web only). */
  readonly theme: Theme;
  /**
   * Appearance: charts tell teams and outcomes apart by shape as well as by
   * color (the Mac's Differentiate Without Color, which the web can't read
   * from the system): the second team's marks are rounded squares, a
   * penalty's bar is hatched, a turnover's dashed.
   */
  readonly differentiateWithoutColor: boolean;
  /** How much live pages celebrate big plays (`celebrationLevel`). Used by game pages. */
  readonly celebrationLevel: CelebrationLevel;
  /** A soft sound when the open game scores (`celebrationSounds`). */
  readonly celebrationSounds: boolean;
  /** Alerts for followed teams (`notifyFollowed`): web notifications, once the browser allows them. */
  readonly notifyFollowed: boolean;
  /** The tab's title and favicon carry a followed team's live score (`scoreInMenuBar`; a pinned game shows regardless). */
  readonly scoreInTitle: boolean;
  /** CS2: mark live matches a Twitch channel is co-streaming (`showCoStream`, `coStreamer`). */
  readonly showCoStream: boolean;
  readonly coStreamer: string;
  /** Results pages: scorers, performers and notes under each result (`resultsDetails`). */
  readonly resultsDetails: boolean;
}

export const DEFAULTS: Settings = {
  enabledLeagues: DEFAULT_LEAGUE_IDS,
  followed: [],
  teamFilters: {},
  filteredLeagues: [],
  collegeTop25Only: true,
  climbingDisciplines: [...CLIMBING_DISCIPLINES],
  showFinished: true,
  liveFirst: false,
  collapsed: [],
  landingView: "list",
  theme: "system",
  differentiateWithoutColor: false,
  celebrationLevel: "full",
  celebrationSounds: false,
  notifyFollowed: true,
  scoreInTitle: true,
  showCoStream: true,
  coStreamer: "ohnepixel",
  resultsDetails: true,
};

const VERSION = 1;
export const STORAGE_KEY = `scoreline.settings.v${VERSION}`;

// MARK: - Reading storage (never trusted)

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
const flag = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

/** A stored value made safe: unknown leagues and malformed entries drop out, defaults fill the gaps. */
export function sanitize(raw: unknown): Settings {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const known = new Set(CATALOG.map((l) => l.id));
  const leagues = isStringArray(s.enabledLeagues) ? [...new Set(s.enabledLeagues.filter((id) => known.has(id)))] : [...DEFAULTS.enabledLeagues];
  const followed = Array.isArray(s.followed)
    ? s.followed.flatMap((t): FollowedTeam[] => {
        if (!t || typeof t !== "object") return [];
        const { id, name, logo } = t as Record<string, unknown>;
        // Teams from sports no longer offered (hockey) drop out, as on the Mac.
        if (typeof id !== "string" || typeof name !== "string" || id.startsWith("espn-hockey-")) return [];
        return [{ id, name, logo: typeof logo === "string" ? logo : null }];
      })
    : [];
  const teamFilters: Record<string, string[]> = {};
  if (s.teamFilters && typeof s.teamFilters === "object") {
    for (const [league, ids] of Object.entries(s.teamFilters as Record<string, unknown>)) {
      if (known.has(league) && isStringArray(ids)) teamFilters[league] = [...new Set(ids)];
    }
  }
  const disciplines = isStringArray(s.climbingDisciplines)
    ? s.climbingDisciplines.filter((d) => (CLIMBING_DISCIPLINES as readonly string[]).includes(d))
    : [...DEFAULTS.climbingDisciplines];
  return {
    enabledLeagues: leagues,
    followed,
    teamFilters,
    filteredLeagues: isStringArray(s.filteredLeagues) ? s.filteredLeagues.filter((id) => known.has(id)) : [],
    collegeTop25Only: flag(s.collegeTop25Only, DEFAULTS.collegeTop25Only),
    climbingDisciplines: disciplines,
    showFinished: flag(s.showFinished, DEFAULTS.showFinished),
    liveFirst: flag(s.liveFirst, DEFAULTS.liveFirst),
    collapsed: isStringArray(s.collapsed) ? s.collapsed : [],
    landingView: pick(s.landingView, ["list", "tiles"], DEFAULTS.landingView),
    theme: pick(s.theme, ["system", "light", "dark"], DEFAULTS.theme),
    differentiateWithoutColor: flag(s.differentiateWithoutColor, DEFAULTS.differentiateWithoutColor),
    celebrationLevel: pick(s.celebrationLevel, ["full", "subtle", "off"], DEFAULTS.celebrationLevel),
    celebrationSounds: flag(s.celebrationSounds, DEFAULTS.celebrationSounds),
    notifyFollowed: flag(s.notifyFollowed, DEFAULTS.notifyFollowed),
    scoreInTitle: flag(s.scoreInTitle, DEFAULTS.scoreInTitle),
    showCoStream: flag(s.showCoStream, DEFAULTS.showCoStream),
    coStreamer: typeof s.coStreamer === "string" ? s.coStreamer : DEFAULTS.coStreamer,
    resultsDetails: flag(s.resultsDetails, DEFAULTS.resultsDetails),
  };
}

function load(): Settings {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    return stored ? sanitize(JSON.parse(stored)) : DEFAULTS;
  } catch {
    // Private windows and blocked storage: defaults, in memory.
    return DEFAULTS;
  }
}

// MARK: - The store

type Listener = () => void;
let current: Settings = load();
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener();
}

function commit(next: Settings) {
  if (next === current) return;
  current = next;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked: the change still holds for this session.
  }
  emit();
}

function update(change: (s: Settings) => Partial<Settings>) {
  commit({ ...current, ...change(current) });
}

// Another tab changed them: follow along.
globalThis.addEventListener?.("storage", (event: StorageEvent) => {
  if (event.key !== STORAGE_KEY) return;
  current = event.newValue ? sanitize(JSON.parse(event.newValue)) : DEFAULTS;
  emit();
});

export function getSettings(): Settings {
  return current;
}

export function subscribeSettings(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A slice of the settings; re-renders only when that slice changes (by identity). */
export function useSettings<T>(selector: (s: Settings) => T): T {
  return useSyncExternalStore(
    subscribeSettings,
    () => selector(current),
    () => selector(DEFAULTS),
  );
}

const without = <T>(list: readonly T[], value: T) => list.filter((x) => x !== value);
const toggled = <T>(list: readonly T[], value: T) => (list.includes(value) ? without(list, value) : [...list, value]);

/** Every change goes through these: the Mac app's rules live here, not in views. */
export const settings = {
  set<K extends keyof Settings>(key: K, value: Settings[K]) {
    update(() => ({ [key]: value }) as Partial<Settings>);
  },

  // Leagues

  /** On: joins the end of the order. Off: leaves it (its picks are kept). */
  setEnabled(id: string, on: boolean) {
    if (!leagueWithID(id)) return;
    update((s) => ({
      enabledLeagues: on ? (s.enabledLeagues.includes(id) ? s.enabledLeagues : [...s.enabledLeagues, id]) : without(s.enabledLeagues, id),
    }));
  },

  /** Moves a league to just before another in the user's order (a drop). */
  moveBefore(id: string, target: string) {
    update((s) => {
      if (id === target || !s.enabledLeagues.includes(id)) return {};
      const ids = without(s.enabledLeagues, id);
      const to = ids.indexOf(target);
      ids.splice(to < 0 ? ids.length : to, 0, id);
      return { enabledLeagues: ids };
    });
  },

  /** Move Up / Move Down. */
  move(id: string, offset: number) {
    update((s) => {
      const from = s.enabledLeagues.indexOf(id);
      if (from < 0) return {};
      const to = Math.min(Math.max(from + offset, 0), s.enabledLeagues.length - 1);
      if (to === from) return {};
      const ids = [...s.enabledLeagues];
      [ids[from], ids[to]] = [ids[to]!, ids[from]!];
      return { enabledLeagues: ids };
    });
  },

  // Teams

  toggleFollow(team: FollowedTeam) {
    update((s) => ({
      followed: s.followed.some((t) => t.id === team.id) ? s.followed.filter((t) => t.id !== team.id) : [...s.followed, team],
    }));
  },

  unfollow(id: string) {
    update((s) => ({ followed: s.followed.filter((t) => t.id !== id) }));
  },

  setFilterOn(league: string, on: boolean) {
    update((s) => ({ filteredLeagues: on ? [...without(s.filteredLeagues, league), league] : without(s.filteredLeagues, league) }));
  },

  /** Picking a team implies wanting the filter. */
  togglePick(league: string, teamID: string) {
    update((s) => {
      const picks = toggled(s.teamFilters[league] ?? [], teamID);
      return {
        teamFilters: { ...s.teamFilters, [league]: picks },
        filteredLeagues: picks.length > 0 && !s.filteredLeagues.includes(league) ? [...s.filteredLeagues, league] : s.filteredLeagues,
      };
    });
  },

  toggleDiscipline(discipline: string) {
    update((s) => ({ climbingDisciplines: toggled(s.climbingDisciplines, discipline) }));
  },

  /** Sections and tile tiers share one collapsed set. */
  toggleCollapsed(id: string) {
    update((s) => ({ collapsed: toggled(s.collapsed, id) }));
  },

  reset() {
    commit(DEFAULTS);
  },
};

/** Whether a competitor is followed (by ID). */
export function useIsFollowing(id: string | null): boolean {
  return useSettings((s) => id != null && s.followed.some((t) => t.id === id));
}
