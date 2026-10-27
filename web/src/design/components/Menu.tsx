/**
 * Menu: a pull-down menu on glass, the web twin of SwiftUI's `Menu` (the
 * Schedule title menu, a page's More menu, the round picker). It grows from
 * its trigger (origin-aware), never bounces, and leaves faster than it came.
 * Keyboard: Enter, Space or ↓ opens it with the first item highlighted;
 * ↑/↓ move, Home/End jump, Return chooses, Esc closes and returns focus to
 * the trigger. Keyboard opens are instant (keyboard actions never animate).
 *
 *     <Menu label="Choose a schedule" align="center"
 *       trigger={<span>Schedule <Icon name="chevronDown" /></span>}
 *       entries={[{ kind: "item", label: "Schedule", onSelect: () => … },
 *                 { kind: "section", title: "Leagues", items: [...] }]} />
 *
 * ContextMenu: the same menu where the pointer is (`.contextMenu` in
 * SwiftUI: a right-click, a long press, Shift-F10), in a layer over the
 * page, so a scrolling pane never clips it. It opens down and right of the
 * point and flips at the window's edges, growing from the corner nearest
 * it. Scrolling, resizing or leaving the window closes it.
 *
 *     {menu ? <ContextMenu label="Arsenal vs Chelsea" at={menu} entries={…} onClose={() => setMenu(null)} /> : null}
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "../icons";
import styles from "./Menu.module.css";

export interface MenuItem {
  readonly kind: "item";
  readonly label: string;
  readonly onSelect: () => void;
  readonly checked?: boolean;
  readonly icon?: IconName;
  readonly disabled?: boolean;
  /** A secondary line or trailing note ("Oct 23–25"). */
  readonly detail?: string;
  readonly shortcut?: string;
}

export type MenuEntry = MenuItem | { readonly kind: "section"; readonly title?: string; readonly items: readonly MenuItem[] } | { readonly kind: "separator" };

export interface MenuProps {
  /** The trigger's accessible name and tooltip ("Choose a schedule"). */
  readonly label: string;
  /** What the trigger shows. */
  readonly trigger: ReactNode;
  readonly entries: readonly MenuEntry[];
  /** Where the menu sits under its trigger. */
  readonly align?: "start" | "center" | "end";
  readonly triggerClassName?: string;
  readonly className?: string;
  /** The trigger is the page's title: it carries the h1 role. */
  readonly heading?: boolean;
  readonly disabled?: boolean;
}

function flatten(entries: readonly MenuEntry[]): MenuItem[] {
  return entries.flatMap((e) => (e.kind === "item" ? [e] : e.kind === "section" ? e.items : []));
}

/** The first enabled item at or after `from` going `step` (±1), or `from` when there's none. */
function enabledFrom(items: readonly MenuItem[], from: number, step: number): number {
  for (let i = from; i >= 0 && i < items.length; i += step) if (!items[i]?.disabled) return i;
  return Math.min(Math.max(from - step, -1), items.length - 1);
}

interface SurfaceProps {
  readonly id: string;
  readonly label: string;
  readonly entries: readonly MenuEntry[];
  /** The item highlighted on open (−1: none, as after a click). */
  readonly initialActive: number;
  readonly instant: boolean;
  readonly closing: boolean;
  readonly className: string | undefined;
  readonly style?: CSSProperties;
  readonly align?: string;
  readonly origin?: string;
  readonly onChoose: (item: MenuItem) => void;
  /** Esc (focus goes back) or Tab (focus moves on). */
  readonly onDismiss: (returnFocus: boolean) => void;
  readonly surfaceRef: RefObject<HTMLDivElement | null>;
}

/** The menu itself: its items, the highlight and the keys. Shared by `Menu` and `ContextMenu`. */
function MenuSurface({ id, label, entries, initialActive, instant, closing, className, style, align, origin, onChoose, onDismiss, surfaceRef }: SurfaceProps) {
  const [active, setActive] = useState(initialActive);
  const items = flatten(entries);
  const glyphs = items.some((i) => i.icon);

  const choose = (item: MenuItem | undefined) => {
    if (!item || item.disabled) return;
    onChoose(item);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const move = (to: number, step: number) => {
      event.preventDefault();
      setActive(enabledFrom(items, Math.min(Math.max(to, 0), items.length - 1), step));
    };
    switch (event.key) {
      case "ArrowDown":
        return move(active + 1, 1);
      case "ArrowUp":
        return move(active < 0 ? items.length - 1 : active - 1, -1);
      case "Home":
        return move(0, 1);
      case "End":
        return move(items.length - 1, -1);
      case "Enter":
      case " ":
        event.preventDefault();
        return choose(items[active]);
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        return onDismiss(true);
      case "Tab":
        return onDismiss(false);
    }
  };

  useEffect(() => {
    if (active < 0) return;
    surfaceRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, surfaceRef]);

  let index = -1;
  const renderItem = (item: MenuItem) => {
    const i = ++index;
    return (
      <div
        key={`${i}-${item.label}`}
        id={`${id}-${i}`}
        role={item.checked != null ? "menuitemradio" : "menuitem"}
        aria-checked={item.checked}
        aria-disabled={item.disabled}
        data-index={i}
        data-active={i === active}
        className={styles.item}
        onPointerMove={() => setActive(item.disabled ? -1 : i)}
        onPointerLeave={() => setActive(-1)}
        onClick={() => choose(item)}
      >
        <span className={styles.check}>{item.checked ? <Icon name="check" size={9} /> : null}</span>
        {item.icon ? <Icon name={item.icon} size={11} className={styles.itemIcon} /> : glyphs ? <span className={styles.iconSlot} /> : null}
        <span className={styles.itemLabel}>{item.label}</span>
        {item.detail ? <span className={styles.detail}>{item.detail}</span> : null}
        {item.shortcut ? <span className={styles.detail}>{item.shortcut}</span> : null}
      </div>
    );
  };

  return (
    <div
      ref={surfaceRef}
      id={id}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
      className={className}
      data-align={align}
      data-origin={origin}
      data-instant={instant}
      data-closing={closing}
      style={style}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {entries.map((entry, n) => {
        if (entry.kind === "item") return renderItem(entry);
        if (entry.kind === "separator") return <div key={`sep-${n}`} role="separator" className={styles.separator} />;
        return (
          <div key={`section-${n}`} role="group" aria-label={entry.title} className={styles.section}>
            {n > 0 ? <div role="separator" className={styles.separator} /> : null}
            {entry.title ? <div className={styles.sectionTitle}>{entry.title}</div> : null}
            {entry.items.map(renderItem)}
          </div>
        );
      })}
    </div>
  );
}

/** Opens and closes with the exit's timing: `close(instant)` plays it unless asked not to. */
function useClosing(onClosed: () => void) {
  const [closing, setClosing] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const close = useCallback(
    (instant: boolean) => {
      window.clearTimeout(timer.current);
      if (instant) {
        setClosing(false);
        onClosed();
        return;
      }
      setClosing(true);
      timer.current = window.setTimeout(() => {
        setClosing(false);
        onClosed();
      }, 120);
    },
    [onClosed],
  );
  return { closing, close, reset: () => setClosing(false) };
}

export function Menu({ label, trigger, entries, align = "start", triggerClassName, className, heading = false, disabled = false }: MenuProps) {
  const [open, setOpen] = useState<null | { instant: boolean; first: number }>(null);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const items = flatten(entries);
  const [placement, setPlacement] = useState<CSSProperties>({});
  const { closing, close: closeSurface, reset } = useClosing(useCallback(() => setOpen(null), []));

  const close = useCallback(
    (returnFocus: boolean, instant = false) => {
      closeSurface(instant);
      if (returnFocus) button.current?.focus();
    },
    [closeSurface],
  );

  const show = (instant: boolean, first: number) => {
    reset();
    setPlacement({});
    setOpen({ instant, first });
  };

  // Keep the menu inside the viewport horizontally, and take the keys.
  useLayoutEffect(() => {
    if (!open || !list.current || !root.current) return;
    const menu = list.current.getBoundingClientRect();
    const margin = 8;
    let shift = 0;
    if (menu.right > window.innerWidth - margin) shift = window.innerWidth - margin - menu.right;
    if (menu.left + shift < margin) shift = margin - menu.left;
    if (shift !== 0) setPlacement({ translate: `${shift}px 0` });
    list.current.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) close(false);
    };
    window.addEventListener("pointerdown", onPointer, true);
    return () => window.removeEventListener("pointerdown", onPointer, true);
  }, [open, close]);

  const onTriggerKey = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      show(true, Math.max(0, items.findIndex((i) => i.checked)));
    }
  };

  const Trigger = (
    <button
      ref={button}
      type="button"
      className={[styles.trigger, triggerClassName].filter(Boolean).join(" ")}
      aria-haspopup="menu"
      aria-expanded={open != null}
      aria-controls={open ? id : undefined}
      aria-label={heading ? undefined : label}
      title={label}
      disabled={disabled}
      onClick={(e) => (open ? close(false) : show(e.detail === 0, -1))}
      onKeyDown={onTriggerKey}
    >
      {trigger}
    </button>
  );

  return (
    <div ref={root} className={[styles.root, className].filter(Boolean).join(" ")}>
      {heading ? <h1 className={styles.heading}>{Trigger}</h1> : Trigger}
      {open ? (
        <MenuSurface
          id={id}
          label={label}
          entries={entries}
          initialActive={open.first}
          instant={open.instant}
          closing={closing}
          className={styles.menu}
          style={placement}
          align={align}
          surfaceRef={list}
          onChoose={(item) => {
            close(true, true);
            item.onSelect();
          }}
          onDismiss={(returnFocus) => close(returnFocus, true)}
        />
      ) : null}
    </div>
  );
}

// MARK: - Context menus

export interface ContextMenuPoint {
  /** Viewport coordinates (CSS pixels) the menu opens from. */
  readonly x: number;
  readonly y: number;
  /** Opened from the keyboard: no entrance, the first item highlighted. */
  readonly instant: boolean;
}

export interface ContextMenuProps {
  readonly label: string;
  readonly at: ContextMenuPoint;
  readonly entries: readonly MenuEntry[];
  /** Called once it has gone (after its exit). */
  readonly onClose: () => void;
  /** Where focus returns after a keyboard close (the row it was opened on). */
  readonly returnFocus?: HTMLElement | null;
}

const EDGE = 8;

export function ContextMenu({ label, at, entries, onClose, returnFocus }: ContextMenuProps) {
  const id = useId();
  const surface = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ style: CSSProperties; origin: string }>({ style: { left: at.x, top: at.y, visibility: "hidden" }, origin: "top-left" });
  const { closing, close } = useClosing(onClose);
  const first = at.instant ? enabledFrom(flatten(entries), 0, 1) : -1;

  // Down and right of the point; flipped at the window's edges, growing from the corner nearest the point.
  useLayoutEffect(() => {
    const el = surface.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = at.x + width > vw - EDGE ? Math.max(EDGE, at.x - width) : at.x;
    const top = at.y + height > vh - EDGE ? Math.max(EDGE, at.y - height) : at.y;
    const origin = `${top < at.y ? "bottom" : "top"}-${left < at.x ? "right" : "left"}`;
    setPlace({ style: { left, top }, origin });
    el.focus({ preventScroll: true });
  }, [at]);

  useEffect(() => {
    const dismiss = () => close(false);
    const onPointer = (event: PointerEvent) => {
      if (!surface.current?.contains(event.target as Node)) close(false);
    };
    const onScroll = (event: Event) => {
      if (!surface.current?.contains(event.target as Node)) close(true);
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
    };
  }, [close]);

  return createPortal(
    <MenuSurface
      id={id}
      label={label}
      entries={entries}
      initialActive={first}
      instant={at.instant}
      closing={closing}
      className={`${styles.menu} ${styles.contextMenu}`}
      style={place.style}
      origin={place.origin}
      surfaceRef={surface}
      onChoose={(item) => {
        close(true);
        if (at.instant) returnFocus?.focus({ preventScroll: true });
        item.onSelect();
      }}
      onDismiss={(back) => {
        close(true);
        if (back) returnFocus?.focus({ preventScroll: true });
      }}
    />,
    document.body,
  );
}
