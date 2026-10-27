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
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
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

export function Menu({ label, trigger, entries, align = "start", triggerClassName, className, heading = false, disabled = false }: MenuProps) {
  const [open, setOpen] = useState<null | { instant: boolean }>(null);
  const [active, setActive] = useState(-1);
  const [closing, setClosing] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const items = flatten(entries);
  const glyphs = items.some((i) => i.icon);
  const [placement, setPlacement] = useState<CSSProperties>({});

  const close = useCallback((returnFocus: boolean, instant = false) => {
    if (instant) {
      setOpen(null);
      setClosing(false);
    } else {
      setClosing(true);
      window.setTimeout(() => {
        setOpen(null);
        setClosing(false);
      }, 120);
    }
    if (returnFocus) button.current?.focus();
  }, []);

  const show = (instant: boolean, first: number) => {
    setActive(first);
    setClosing(false);
    setOpen({ instant });
  };

  // Keep the menu inside the viewport horizontally.
  useLayoutEffect(() => {
    if (!open || !list.current || !root.current) return;
    const menu = list.current.getBoundingClientRect();
    const margin = 8;
    let shift = 0;
    if (menu.right > window.innerWidth - margin) shift = window.innerWidth - margin - menu.right;
    if (menu.left + shift < margin) shift = margin - menu.left;
    if (shift !== 0) setPlacement({ translate: `${shift}px 0` });
    if (open && !open.instant) list.current.focus({ preventScroll: true });
    else list.current.focus({ preventScroll: true });
    // Only on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) close(false);
    };
    window.addEventListener("pointerdown", onPointer, true);
    return () => window.removeEventListener("pointerdown", onPointer, true);
  }, [open, close]);

  const choose = (item: MenuItem | undefined) => {
    if (!item || item.disabled) return;
    close(true, true);
    item.onSelect();
  };

  const onTriggerKey = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      show(true, Math.max(0, items.findIndex((i) => i.checked)));
    }
  };

  const onListKey = (event: KeyboardEvent) => {
    const move = (to: number) => {
      event.preventDefault();
      setActive(Math.min(Math.max(to, 0), items.length - 1));
    };
    switch (event.key) {
      case "ArrowDown":
        return move(active + 1);
      case "ArrowUp":
        return move(active - 1);
      case "Home":
        return move(0);
      case "End":
        return move(items.length - 1);
      case "Enter":
      case " ":
        event.preventDefault();
        return choose(items[active]);
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        return close(true, true);
      case "Tab":
        return close(false, true);
    }
  };

  useEffect(() => {
    if (!open || active < 0) return;
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

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
        onPointerMove={() => setActive(i)}
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
        <div
          ref={list}
          id={id}
          role="menu"
          aria-label={label}
          tabIndex={-1}
          aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
          className={styles.menu}
          data-align={align}
          data-instant={open.instant}
          data-closing={closing}
          style={placement}
          onKeyDown={onListKey}
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
      ) : null}
    </div>
  );
}
