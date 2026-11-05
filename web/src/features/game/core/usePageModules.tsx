/**
 * The page's modules, assembled (DetailView.swift's `shownModules`,
 * `arrangement`, `setFolded`, `customizeSheet`): what this state's plan has to
 * show, less what the sport hides, in the sport's order (or, mid-drag, the
 * drag's proposal), placed in one column or the split page's two; each
 * placed section wrapped as a module (its header, its fold, its glance, its
 * menu, its drag); the line naming what's hidden; the lift while a module is
 * in hand; Customize.
 *
 * A fold by click glides the page on `standard` (layout is tracked for that
 * moment only, turned on a frame before the change lands); a key is instant;
 * Reduce Motion only cross-fades. A move (⌥↑/⌥↓, the menu) glides the same
 * way and is announced.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { announce } from "./announce";
import { fold as foldIn, hiddenHere, hiddenText, hide, isFolded, moduleName, pageName, ranking, rank, shown, showAll, step, type ModuleGlance, type ModuleLayout } from "../../../data/modules";
import type { ScoreEvent } from "../../../data/models";
import { arrangement, chartForSection, pageKind, runs, sectionOrder, type PlacedSection, type Section } from "../../../data/sections";
import type { MomentChart } from "../../../data/moments";
import { settings, useSettings } from "../../../state/settings";
import type { PageGeometry } from "./geometry";
import { commonGlance, type GlanceInputs } from "./moduleGlances";
import { ModuleDrag } from "./moduleDrag";
import { HiddenModulesLine, ModuleLift, ModuleSlot, type FoldMotion, type ModuleAction, type ModuleChrome } from "./modules";
import type { SportPage } from "./sport";
import { useReducedMotion } from "./useMedia";
import styles from "./Modules.module.css";

const CustomizeModules = lazy(() => import("./CustomizeModules"));

/** How long a fold's or a move's glide is tracked. */
const GLIDE_MS = 450;

export interface PageModules {
  readonly placed: readonly PlacedSection[];
  /** A placed section as a module. */
  readonly slot: (section: Section, content: ReactNode) => ReactNode;
  /** Slots animate their position (a glide is under way). */
  readonly layoutOn: boolean;
  /** "Hidden on NBA pages: …", or null. */
  readonly hiddenLine: ReactNode;
  /** The lift and Customize, over the page. */
  readonly overlay: ReactNode;
  /** Changes when any module folds or opens (the page's geometry measures again). */
  readonly foldKey: string;
}

export function usePageModules(event: ScoreEvent, sport: SportPage, geometry: PageGeometry, columns: boolean, inputs: Omit<GlanceInputs, "event">): PageModules {
  const kind = pageKind(event.ref);
  const page = pageName(kind);
  const folded = useSettings((s) => s.foldedModules);
  const hiddenKeys = useSettings((s) => s.hiddenModules);
  const order = useSettings((s) => s.moduleOrder);
  const layout: ModuleLayout = useMemo(() => ({ folded, hidden: hiddenKeys, order }), [folded, hiddenKeys, order]);
  const reduce = useReducedMotion();

  // The drag, one per page, outside React (core/moduleDrag.ts).
  const dragRef = useRef<ModuleDrag | null>(null);
  dragRef.current ??= new ModuleDrag(geometry);
  const drag = dragRef.current;
  useEffect(() => () => drag.dispose(), [drag]);
  const snap = useSyncExternalStore(drag.subscribe, drag.snapshot, drag.snapshot);

  // What this state's plan has, less what's hidden, in the sport's order (or the drag's).
  const available = sectionOrder(event.ref, event.state).filter((s) => sport.sections[s] != null);
  const list = shown(layout, available, kind, snap.preview);
  const placed = arrangement(list, event.ref, event.state, columns, snap.preview ?? ranking(layout, kind));
  const hiddenList = hiddenHere(layout, available, kind);

  // A glide: layout tracked from this frame, the change on the next (ScoresView.toggle's two phases).
  const [motion, setMotion] = useState<FoldMotion>("instant");
  const [gliding, setGliding] = useState(false);
  const generation = useRef(0);
  const glide = useCallback(
    (how: FoldMotion, change: () => void) => {
      setMotion(how);
      const mine = ++generation.current;
      if (how !== "animated") {
        setGliding(false);
        change();
        return;
      }
      setGliding(true);
      requestAnimationFrame(() => {
        change();
        window.setTimeout(() => {
          if (generation.current === mine) setGliding(false);
        }, GLIDE_MS);
      });
    },
    [],
  );

  const [customizing, setCustomizing] = useState<{ from: HTMLElement | null } | null>(null);
  const liftRef = useCallback((el: HTMLDivElement | null) => {
    drag.lift = el;
  }, [drag]);

  // The one-column order and each module's run (its column on the split page).
  const pageIDs = list as readonly string[];
  const runOf = new Map<string, readonly string[]>();
  for (const run of runs(placed)) for (const id of run) runOf.set(id, run);

  const glanceOf = (section: Section): ModuleGlance | null => {
    const own = sport.glance?.(section);
    return own !== undefined ? own : commonGlance(section, { event, ...inputs });
  };

  const act = (section: Section, action: ModuleAction, keyboard: boolean) => {
    const how: FoldMotion = keyboard ? "instant" : reduce ? "fade" : "animated";
    const name = moduleName(section, kind);
    switch (action.kind) {
      case "toggle":
      case "fold": {
        const on = action.kind === "fold" ? action.on : !isFolded(layout, section, kind);
        const targets = action.kind === "toggle" && action.all ? placed.map((p) => p.section) : [section];
        glide(how, () => settings.setModules((l) => foldIn(l, targets, kind, on)));
        return;
      }
      case "move": {
        const run = runOf.get(section) ?? [];
        const next = step(section, action.by, run, pageIDs, ranking(layout, kind));
        if (!next) return;
        const at = run.indexOf(section) + action.by;
        glide(reduce || keyboard ? "instant" : "animated", () => settings.setModules((l) => ({ ...l, order: { ...l.order, [kind]: next } })));
        announce(`${name} moved ${action.by < 0 ? "up" : "down"}, ${at + 1} of ${run.length}`);
        return;
      }
      case "hide":
        glide(how, () => settings.setModules((l) => hide(l, section, kind, true)));
        announce(`${name} hidden on ${page} pages`);
        return;
      case "customize":
        setCustomizing({ from: action.from });
        return;
    }
  };

  const slot = (section: Section, content: ReactNode): ReactNode => {
    const run = runOf.get(section) ?? [];
    const i = run.indexOf(section);
    const chrome: ModuleChrome = {
      name: moduleName(section, kind),
      page,
      folded: snap.compact || isFolded(layout, section, kind),
      glance: snap.compact || isFolded(layout, section, kind) ? glanceOf(section) : null,
      chart: chartForSection(section) as MomentChart | null,
      motion: snap.compact ? "instant" : motion,
      keepsAlive: section === "liveView",
      reorder: kind === "none" || run.length < 2 ? null : { id: section, run, page: pageIDs, commit: (ids) => settings.setModules((l) => rank(l, ids, kind)) },
      canMove: { up: i > 0, down: i >= 0 && i < run.length - 1 },
      act: (action, keyboard) => act(section, action, keyboard),
      press: (e, reorder) => {
        drag.root = e.currentTarget.closest("article");
        drag.press(e.nativeEvent, reorder);
      },
      takeClick: () => drag.takeClick(),
    };
    return (
      <div className={styles.slot} data-module={section} data-gap={snap.compact && snap.id === section}>
        <ModuleSlot chrome={chrome}>{content}</ModuleSlot>
      </div>
    );
  };

  const lifted = snap.id as Section | null;
  const overlay = (
    <>
      {lifted ? <ModuleLift title={moduleName(lifted, kind)} glance={glanceOf(lifted)} caption={null} left={snap.left} width={snap.width} liftRef={liftRef} /> : null}
      {customizing ? (
        <Suspense fallback={null}>
          <CustomizeModules ref_={event.ref} returnFocus={customizing.from} onClose={() => setCustomizing(null)} />
        </Suspense>
      ) : null}
    </>
  );

  const names = hiddenList.map((s) => moduleName(s, kind));
  const hiddenLine =
    hiddenList.length > 0 ? (
      <HiddenModulesLine text={hiddenText(names, page)} names={names} page={page} onShow={() => glide(reduce ? "fade" : "animated", () => settings.setModules((l) => showAll(l, kind)))} />
    ) : null;

  return {
    placed,
    slot,
    layoutOn: gliding || snap.id != null,
    hiddenLine,
    overlay,
    foldKey: `${snap.compact}|${placed.map((p) => isFolded(layout, p.section, kind)).join()}`,
  };
}

/**
 * Whether a module is open on this sport's pages (shown, and not folded):
 * the Live View's theater owns its moments' bursts only while it is
 * (FootballCelebration.driveChartBursts, GoalCelebration.pitchBursts,
 * BasketballCelebration.courtBursts, the spray chart's fireworks).
 */
export function useModuleOpen(ref: ScoreEvent["ref"], section: Section): boolean {
  const key = `${pageKind(ref)}.${section}`;
  return useSettings((s) => !s.foldedModules.includes(key) && !s.hiddenModules.includes(key));
}
