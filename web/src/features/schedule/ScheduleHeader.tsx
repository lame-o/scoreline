/**
 * Every schedule page's header, in either mode (SchedulePage.swift
 * `ScheduleHeader`, `PageTitleMenu`, ResultsContract.swift
 * `ScheduleModeSwitch`): Back, the scope as a title menu, More (the mode's
 * own items), and the Upcoming | Results control under them. The season
 * pages (climbing, tournaments) use it too, with their own title menu.
 *
 * Shortcuts: ⌥1 / ⌥2 face Upcoming / Results (the Mac's ⌘1 / ⌘2, which a
 * browser keeps for its tabs). Keys switch instantly; a click crossfades.
 *
 * Navigation (Swift's callbacks): `useScheduleNav()` gives
 * - `scope(s)`: another scope in place (chips, the title menu): no Back step;
 * - `drill(s)`: a deeper schedule with a way back here (a league's chip);
 * - `mode(m)`: the same scope facing the other way, in place.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useLocation, useNavigate } from "react-router";
import { BackButton, Icon, Menu, PageHeader, SegmentedControl, type MenuEntry } from "../../design/components";
import { schedulePath, scopeFor, scopeTitle, scopeKey, type ScheduleMode, type ScheduleScope } from "../../data/schedule";
import { leagueWithID } from "../../data/leagues";
import { useSplit, type NavState } from "../../app/layout";
import { isTyping, useGoBack } from "../../app/navigation";
import { useSettings } from "../../state/settings";
import styles from "./ScheduleHeader.module.css";

/** How a schedule page moves: in place (scope, mode) or deeper (drill). */
export function useScheduleNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const scope = useCallback(
    (s: ScheduleScope, mode: ScheduleMode = "upcoming", viaKeyboard = false) =>
      navigate(schedulePath(s, mode), { replace: true, state: { ...(location.state as object | null), viaKeyboard, inPlace: true } }),
    [navigate, location.state],
  );
  const drill = useCallback(
    (s: ScheduleScope, mode: ScheduleMode = "upcoming", viaKeyboard = false) => navigate(schedulePath(s, mode), { state: { viaKeyboard } satisfies NavState }),
    [navigate],
  );
  return { scope, drill };
}

/** Whether this render of a page came from switching in place (no entrance). */
export function useInPlace(): boolean {
  const location = useLocation();
  return Boolean((location.state as { inPlace?: boolean } | null)?.inPlace);
}

export interface ScheduleHeaderProps {
  readonly scope: ScheduleScope;
  readonly mode: ScheduleMode;
  /** Switch modes in place; `viaKeyboard` switches instantly. */
  readonly onMode: (mode: ScheduleMode, viaKeyboard: boolean) => void;
  /** The title menu's entries; omitted: the scope menu (Schedule, Your Teams, leagues, teams). */
  readonly titleEntries?: readonly MenuEntry[];
  /** The page's title (defaults to the scope's). */
  readonly title?: string;
  /** More's items; omitted or empty: no More button. */
  readonly more?: readonly MenuEntry[];
  /** Back's label ("Scores"). */
  readonly backTitle?: string;
  /** Pinned under the mode switch with the header (a navigator, chips). */
  readonly children?: ReactNode;
}

export function ScheduleHeader({ scope, mode, onMode, titleEntries, title, more, backTitle = "Back", children }: ScheduleHeaderProps) {
  const split = useSplit();
  const goBack = useGoBack();
  const nav = useScheduleNav();
  const enabled = useSettings((s) => s.enabledLeagues);
  const followed = useSettings((s) => s.followed);

  const scopeEntries: MenuEntry[] = [
    { kind: "item", label: "Schedule", checked: scope.kind === "all", onSelect: () => nav.scope({ kind: "all" }, mode) },
    ...(followed.length > 0
      ? [{ kind: "item" as const, label: "Your Teams", checked: scope.kind === "yourTeams", onSelect: () => nav.scope({ kind: "yourTeams" }, mode) }]
      : []),
    {
      kind: "section",
      title: "Leagues",
      items: enabled.flatMap((id) => {
        const league = leagueWithID(id);
        if (!league) return [];
        const s = scopeFor(league);
        return [{ kind: "item" as const, label: league.name, checked: scopeKey(s) === scopeKey(scope), onSelect: () => nav.scope(s, mode) }];
      }),
    },
    ...(followed.length > 0
      ? [
          {
            kind: "section" as const,
            title: "Teams",
            items: followed.map((t) => ({
              kind: "item" as const,
              label: t.name,
              checked: scope.kind === "team" && scope.team.id === t.id,
              onSelect: () => nav.scope({ kind: "team", team: { id: t.id, name: t.name, logo: t.logo } }, mode),
            })),
          },
        ]
      : []),
  ];

  const name = title ?? scopeTitle(scope);
  const sentinel = useRef<HTMLSpanElement>(null);
  const scrolled = useScrolledPast(sentinel);
  return (
    <>
    <span ref={sentinel} className={styles.sentinel} aria-hidden="true" />
    <div className={styles.header} data-scrolled={scrolled}>
      <PageHeader
        leading={split ? null : <BackButton to={backTitle} onClick={() => goBack()} />}
        trailing={
          more && more.length > 0 ? (
            <Menu label="More" align="end" triggerClassName={styles.more} trigger={<Icon name="ellipsis" size={12} />} entries={more} />
          ) : null
        }
        center={
          <Menu
          label={scope.kind === "climbing" || scope.kind === "tournaments" ? "Choose a season" : "Choose a schedule"}
          heading
          align="center"
          triggerClassName={styles.titleTrigger}
          trigger={
            <>
              <span className={styles.titleText}>{name}</span>
              <Icon name="chevronDown" size={8} className={styles.titleChevron} />
            </>
          }
          entries={titleEntries ?? scopeEntries}
        />
        }
      />
      <ScheduleModeSwitch mode={mode} onChange={onMode} />
      {children}
    </div>
    </>
  );
}

/**
 * Whether the page has scrolled past a sentinel at its top: the sticky
 * header's soft edge shows only once content is underneath. Works in the
 * split view's detail pane (its own scroller) and on a phone (the window).
 */
export function useScrolledPast(sentinel: RefObject<HTMLElement | null>): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const scroller = el.closest("main");
    const root = scroller && getComputedStyle(scroller).overflowY !== "visible" ? scroller : null;
    const observer = new IntersectionObserver(([entry]) => setScrolled(!entry?.isIntersecting), { root, threshold: 0 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [sentinel]);
  return scrolled;
}

/** Upcoming | Results, with ⌥1 / ⌥2. */
export function ScheduleModeSwitch({ mode, onChange }: { mode: ScheduleMode; onChange: (mode: ScheduleMode, viaKeyboard: boolean) => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.metaKey || event.ctrlKey || isTyping(event.target)) return;
      const next = event.code === "Digit1" ? "upcoming" : event.code === "Digit2" ? "results" : null;
      if (!next) return;
      event.preventDefault();
      if (next !== mode) onChange(next, true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, onChange]);
  return (
    <div className={styles.modeRow} title="Upcoming (⌥1) · Results (⌥2)">
      <SegmentedControl
        label="Show"
        value={mode}
        className={styles.mode}
        onChange={(m, viaKeyboard) => m !== mode && onChange(m, viaKeyboard)}
        options={[
          { value: "upcoming", label: "Upcoming" },
          { value: "results", label: "Results" },
        ]}
      />
    </div>
  );
}

export interface ScopeChip {
  readonly scope: ScheduleScope;
  readonly title: string;
  readonly star?: boolean;
  /** Opens another page (a league's own schedule) instead of filtering this one. */
  readonly drills?: boolean;
}

/**
 * All, your teams, then (on the calendar) each league: a league chip opens
 * its own schedule, climbing's season and CS2's tournaments included. The
 * same row on Upcoming and Results; a league opens facing the same way
 * (SchedulePage.swift `ScheduleChips.scopes`). Null when there's nothing to choose.
 */
export function useScopeChips(scope: ScheduleScope): ScopeChip[] | null {
  const followed = useSettings((s) => s.followed);
  const enabled = useSettings((s) => s.enabledLeagues);
  if (!(scope.kind === "all" || scope.kind === "yourTeams" || scope.kind === "team")) return null;
  const list: ScopeChip[] = [{ scope: { kind: "all" }, title: "All" }];
  if (followed.length > 0) {
    list.push({ scope: { kind: "yourTeams" }, title: "Your Teams", star: true });
    list.push(...followed.slice(0, 6).map((t): ScopeChip => ({ scope: { kind: "team", team: { id: t.id, name: t.name, logo: t.logo } }, title: t.name })));
  }
  const leagues: ScopeChip[] =
    scope.kind === "all"
      ? enabled.flatMap((id) => {
          const league = leagueWithID(id);
          return league ? [{ scope: scopeFor(league), title: league.shortName, drills: true }] : [];
        })
      : [];
  if (list.length <= 1 && leagues.length === 0) return null;
  return [...list, ...leagues];
}

/** The scope chips: filters, then (after a hairline) leagues to open. Scrolls sideways when they don't fit. */
export function ScopeChips({ chips, selected, onSelect }: { chips: readonly ScopeChip[]; selected: ScheduleScope; onSelect: (chip: ScopeChip, viaKeyboard: boolean) => void }) {
  const firstDrill = chips.findIndex((c) => c.drills);
  return (
    <div className={styles.chips} role="toolbar" aria-label="Schedules">
      {chips.map((chip, i) => {
        const isSelected = scopeKey(chip.scope) === scopeKey(selected);
        return (
          <span key={scopeKey(chip.scope)} className={styles.chipSlot}>
            {i === firstDrill && i > 0 ? <span className={styles.chipDivider} aria-hidden="true" /> : null}
            <button
              type="button"
              className={styles.chip}
              aria-pressed={chip.drills ? undefined : isSelected}
              data-selected={isSelected}
              title={chip.drills ? `${chip.title} schedule` : chip.title}
              onClick={(e) => onSelect(chip, e.detail === 0)}
            >
              {chip.star ? <Icon name="star" size={8.5} className={styles.chipStar} /> : null}
              {chip.title}
              {chip.drills ? <Icon name="chevronRight" size={7.5} className={styles.chipChevron} /> : null}
            </button>
          </span>
        );
      })}
    </div>
  );
}
