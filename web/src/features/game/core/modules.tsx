/**
 * A game page's sections as modules (PageModules.swift): each header is a
 * disclosure that folds its module in place to the header and one live
 * glance line; the header's menu collapses, moves, hides the module on the
 * sport's pages, or opens Customize; a drag on the header moves it
 * (core/moduleDrag.ts). Folds, hides and the order are the settings'
 * (`foldedModules`, `hiddenModules`, `moduleOrder`, the Mac's keys), app-wide
 * per page and module ("nba.liveView"), never per game.
 *
 * The header (ModuleHeader): pointing lifts it (a 6% wash, at once; it fades
 * out over 0.15 s) and shows the chevron at its trailing edge; folded, the
 * chevron stays, as the module's state. The wash is drawn under the pointer,
 * never over the click (69745ec). Space or Return toggles, ← folds, → unfolds,
 * ⌥-click folds or unfolds every module on the page; keys never animate.
 * ⌥↑ and ⌥↓ (and the menu's Move Up and Move Down) move the module within
 * its column, announced. A screen reader hears "Shot Chart, Live,
 * collapsed", with the glance as its description.
 */
import { createContext, memo, useContext, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { ContextMenu, Icon, SectionChromeContext, SectionTitle, type ContextMenuPoint, type MenuEntry, type SectionChrome, type SectionHead } from "../../../design/components";
import { spokenGlance, spokenHeader, type ModuleGlance } from "../../../data/modules";
import { captioned, type MomentChart } from "../../../data/moments";
import { useChartMoment } from "./moments";
import type { ModuleReorder } from "./moduleDrag";
import styles from "./Modules.module.css";

/** How a fold's change shows: a click springs, Reduce Motion fades, a key is instant (FoldMotion). */
export type FoldMotion = "animated" | "fade" | "instant";

/** What a module's header can do. */
export type ModuleAction =
  | { readonly kind: "toggle"; readonly all: boolean }
  | { readonly kind: "fold"; readonly on: boolean }
  | { readonly kind: "move"; readonly by: -1 | 1 }
  | { readonly kind: "hide" }
  | { readonly kind: "customize"; readonly from: HTMLElement | null };

/** A page section as a module: set by the page on each section, read by its header (ModuleChrome). */
export interface ModuleChrome {
  /** "Shot Chart": its name in the menu. */
  readonly name: string;
  /** "NBA": the pages hiding it applies to. */
  readonly page: string;
  readonly folded: boolean;
  /** Folded, the line under the header (null: the caption, quietly). */
  readonly glance: ModuleGlance | null;
  /** The chart whose live moments this module captions: folded, the glance carries them. */
  readonly chart: MomentChart | null;
  readonly motion: FoldMotion;
  /** Folded, the content stays (laid out, unseen): the Live View's theater keeps its running order. */
  readonly keepsAlive: boolean;
  /** Dragging the header moves the module (null: it doesn't); Move Up and Down at the run's ends are off. */
  readonly reorder: ModuleReorder | null;
  readonly canMove: { readonly up: boolean; readonly down: boolean };
  /** `keyboard`: from a key, so it doesn't animate. */
  readonly act: (action: ModuleAction, keyboard: boolean) => void;
  /** A press on the header: it may become a drag. */
  readonly press: (event: PointerEvent<HTMLElement>, reorder: ModuleReorder) => void;
  /** Whether a click ended a drag (it doesn't fold). */
  readonly takeClick: () => boolean;
}

const ChromeContext = createContext<ModuleChrome | null>(null);

/** A placed section as a module: its header and fold, from the page. */
export function ModuleSlot({ chrome, children }: { chrome: ModuleChrome; children: ReactNode }) {
  const section: SectionChrome = useMemo(
    () => ({
      folded: chrome.folded,
      keepsAlive: chrome.keepsAlive,
      reveals: chrome.motion !== "instant",
      header: (head: SectionHead) => <ModuleHeaderHost head={head} />,
    }),
    [chrome.folded, chrome.keepsAlive, chrome.motion],
  );
  return (
    <ChromeContext.Provider value={chrome}>
      <SectionChromeContext.Provider value={section}>{children}</SectionChromeContext.Provider>
    </ChromeContext.Provider>
  );
}

function ModuleHeaderHost({ head }: { head: SectionHead }) {
  const chrome = useContext(ChromeContext);
  return chrome ? <ModuleHeader head={head} chrome={chrome} /> : null;
}

/** A module's header: a disclosure over its title row and its caption (or, folded, its glance). */
export const ModuleHeader = memo(function ModuleHeader({ head, chrome }: { head: SectionHead; chrome: ModuleChrome }) {
  const { folded } = chrome;
  const glanceID = useId();
  const button = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<ContextMenuPoint | null>(null);
  const glance = (head.glance as ModuleGlance | null | undefined) ?? chrome.glance;

  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (chrome.takeClick()) return;
    // A click from the keyboard (Space, Return) has no detail: it doesn't animate.
    chrome.act({ kind: "toggle", all: e.altKey }, e.detail === 0);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      chrome.act({ kind: "move", by: e.key === "ArrowUp" ? -1 : 1 }, true);
    } else if (!e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      chrome.act({ kind: "fold", on: e.key === "ArrowLeft" }, true);
    } else if ((e.shiftKey && e.key === "F10") || e.key === "ContextMenu") {
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      setMenu({ x: r.left, y: r.bottom, instant: true });
    }
  };
  const onContextMenu = (e: MouseEvent<HTMLElement>) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, instant: false });
  };
  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    // A control in the title row (the odds window) stays its own.
    if (chrome.reorder && !(e.target as HTMLElement).closest("[data-module-control]")) chrome.press(e, chrome.reorder);
  };

  const entries: MenuEntry[] = [
    { kind: "item", label: `${folded ? "Expand" : "Collapse"} ${chrome.name}`, onSelect: () => chrome.act({ kind: "toggle", all: false }, menu?.instant ?? false) },
    { kind: "separator" },
    { kind: "item", label: "Move Up", disabled: !chrome.canMove.up, onSelect: () => chrome.act({ kind: "move", by: -1 }, true) },
    { kind: "item", label: "Move Down", disabled: !chrome.canMove.down, onSelect: () => chrome.act({ kind: "move", by: 1 }, true) },
    { kind: "separator" },
    { kind: "item", label: `Hide ${chrome.name} on ${chrome.page} Pages`, onSelect: () => chrome.act({ kind: "hide" }, false) },
    { kind: "item", label: `Customize ${chrome.page} Pages…`, onSelect: () => chrome.act({ kind: "customize", from: button.current }, false) },
  ];

  return (
    <div className={styles.head} data-folded={folded} data-motion={chrome.motion} data-draggable={chrome.reorder != null} onPointerDown={onPointerDown} onContextMenu={onContextMenu}>
      <span className={styles.wash} aria-hidden="true" />
      <SectionTitle
        id={head.titleID}
        accessory={head.accessory}
        wrapTitle={(title) => (
          <button
            ref={button}
            type="button"
            className={styles.disclosure}
            aria-expanded={!folded}
            aria-controls={folded && !chrome.keepsAlive ? undefined : head.contentID}
            aria-describedby={folded && (glance || head.caption) ? glanceID : undefined}
            title={`${folded ? "Expand" : "Collapse"} ${chrome.name}`}
            onClick={onClick}
            onKeyDown={onKeyDown}
          >
            {title}
          </button>
        )}
        trailing={
          <>
            {!folded && head.trailing ? (
              <span className={styles.control} data-module-control="">
                {head.trailing}
              </span>
            ) : null}
            <span className={styles.chevron} aria-hidden="true">
              <Icon name="chevronRight" size={9} />
            </span>
          </>
        }
      >
        {head.title}
      </SectionTitle>
      {folded ? (
        <GlanceLine id={glanceID} glance={glance} fallback={head.caption} chart={chrome.chart} />
      ) : head.caption ? (
        <p className={styles.caption}>
          {head.spokenCaption ? (
            <>
              <span aria-hidden="true">{head.caption}</span>
              <span className="visually-hidden">{head.spokenCaption}</span>
            </>
          ) : (
            head.caption
          )}
        </p>
      ) : null}
      {menu ? <ContextMenu label={spokenHeader(chrome.name, folded)} at={menu} entries={entries} onClose={() => setMenu(null)} returnFocus={button.current} /> : null}
    </div>
  );
});

/**
 * A folded module's line: the moment its chart is captioning, while it's
 * news (so a folded chart in view carries it, not the docked bar); else its
 * glance; else its caption, quietly. Read as the header's description.
 */
function GlanceLine({ id, glance, fallback, chart }: { id: string; glance: ModuleGlance | null; fallback: string | null; chart: MomentChart | null }) {
  const live = useChartMoment(chart ?? "court");
  const moment = chart && live && captioned(live) ? live : null;
  if (moment) {
    return (
      <p className={styles.glance} id={id} key={moment.id} data-moment="">
        <span className={styles.dot} aria-hidden="true" />
        <strong>{moment.lead}</strong>
        {moment.detail ? <span className={styles.detail}>{`  ${moment.detail}`}</span> : null}
      </p>
    );
  }
  if (glance?.kind === "parts") {
    return (
      <p className={styles.glance} id={id} aria-label={spokenGlance(glance)}>
        {glance.parts.map((part) => (
          <span key={part.name} className={styles.part} aria-hidden="true">
            <span className={styles.swatch} style={{ background: part.color.startsWith("#") ? part.color : "var(--viz-neutral)" }} />
            <span className={styles.partName}>{part.name}</span>
            <span className={styles.partValue}>{part.value}</span>
          </span>
        ))}
      </p>
    );
  }
  if (glance) {
    return (
      <p className={styles.glance} id={id}>
        {glance.lead ? <strong>{glance.lead}</strong> : null}
        {glance.detail ? <span className={glance.lead ? styles.detail : undefined}>{glance.lead ? `  ${glance.detail}` : glance.detail}</span> : null}
      </p>
    );
  }
  return fallback ? (
    <p className={styles.fallback} id={id}>
      {fallback}
    </p>
  ) : null;
}

/** The page's end, when the sport hides some of what it would show: the modules by name, and one click to show them again (HiddenModulesLine). */
export function HiddenModulesLine({ text, names, page, onShow }: { text: string; names: readonly string[]; page: string; onShow: () => void }) {
  return (
    <p className={styles.hiddenLine}>
      <Icon name="eyeSlash" size={10} />
      <span className={styles.hiddenText}>{text}</span>
      <button type="button" className={styles.show} onClick={onShow} title={`Show ${names.join(" and ")} on ${page} pages`}>
        Show
      </button>
    </p>
  );
}

/** The module in hand, raised over the page at the pointer: its header and glance on a card. Not interactive; screen readers don't see it. */
export function ModuleLift({ title, glance, caption, left, width, liftRef }: { title: string; glance: ModuleGlance | null; caption: string | null; left: number; width: number; liftRef: (el: HTMLDivElement | null) => void }) {
  return (
    <div ref={liftRef} className={styles.lift} style={{ left, width }} aria-hidden="true">
      <div className={styles.liftCard}>
        <p className={styles.liftTitle}>{title}</p>
        <GlanceLine id="module-lift-glance" glance={glance} fallback={caption} chart={null} />
      </div>
    </div>
  );
}
