/**
 * Customize a sport's game pages (PageModules.swift `CustomizeModulesSheet`):
 * show or hide each module, and drag the handles to set their order (the
 * same order a drag on the page sets; each page keeps only what it has, and
 * the split page keeps each module in its column). Over the page, as a
 * sheet; a click outside, Esc or Done closes it. A row's handle also moves
 * with ↑ and ↓ (instant, announced: "Shot Chart, position 3 of 14"), as
 * VoiceOver's Move Up and Move Down do on the Mac; the rest of a row is its
 * checkbox. Restore Defaults shows everything again in each page's own order.
 * Its own chunk: loaded the first time it opens.
 */
import { Reorder, useDragControls } from "motion/react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../../design/components";
import { spring } from "../../../design/motion";
import { customizeRows, hide, isHidden, move, pageName, rank, restoreDefaults, type CustomizeRow, type ModuleLayout } from "../../../data/modules";
import type { EventRef } from "../../../data/models";
import { pageKind } from "../../../data/sections";
import { settings, useSettings } from "../../../state/settings";
import styles from "./CustomizeModules.module.css";

export interface CustomizeModulesProps {
  readonly ref_: EventRef | null;
  readonly onClose: () => void;
  /** Where focus goes back to (the header whose menu opened it). */
  readonly returnFocus: HTMLElement | null;
}

export default function CustomizeModules({ ref_: ref, onClose, returnFocus }: CustomizeModulesProps) {
  const kind = pageKind(ref);
  const page = pageName(kind);
  const folded = useSettings((s) => s.foldedModules);
  const hiddenKeys = useSettings((s) => s.hiddenModules);
  const order = useSettings((s) => s.moduleOrder);
  const layout: ModuleLayout = { folded, hidden: hiddenKeys, order };
  // The Mac's list: every module the sport's pages can show, the timeline on every ESPN sport's.
  const rows = customizeRows(ref, layout);
  const [drawn, setDrawn] = useState<readonly string[]>(rows.map((r) => r.id));
  const [dragging, setDragging] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const titleID = useId();
  const sheet = useRef<HTMLDivElement>(null);
  const rowKey = rows.map((r) => r.id).join();
  // Follow the settings, except mid-drag (the drag owns the order until it drops).
  useEffect(() => {
    if (!dragging) setDrawn(rowKey.split(","));
  }, [rowKey, dragging]);

  const close = () => {
    onClose();
    returnFocus?.focus({ preventScroll: true });
  };

  // Esc closes; focus starts in the sheet.
  useEffect(() => {
    sheet.current?.focus({ preventScroll: true });
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = (ids: readonly string[]) => settings.setModules((l) => rank(l, ids, kind));
  const byID = new Map(rows.map((r) => [r.id, r]));

  const moveByKeyboard = (id: string, offset: number) => {
    const ids = rows.map((r) => r.id);
    const from = ids.indexOf(id as CustomizeRow["id"]);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= ids.length) return;
    save(move(id, to, ids));
    setAnnouncement(`${byID.get(id as CustomizeRow["id"])?.name ?? id}, position ${to + 1} of ${ids.length}`);
  };

  return createPortal(
    <div className={styles.scrim} onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div ref={sheet} className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby={titleID} tabIndex={-1}>
        <h2 className={styles.title} id={titleID}>
          {page} Game Pages
        </h2>
        <p className={styles.subtitle}>What shows on every {page} game, and in what order.</p>
        <Reorder.Group axis="y" values={[...drawn]} onReorder={setDrawn} className={styles.rows} as="ul">
          {drawn.map((id) => {
            const row = byID.get(id as CustomizeRow["id"]);
            return row ? (
              <CustomizeRowView
                key={id}
                row={row}
                shown={!isHidden(layout, row.id, kind)}
                onShown={(on) => settings.setModules((l) => hide(l, row.id, kind, !on))}
                onDragStart={() => setDragging(true)}
                onDragEnd={() => {
                  setDragging(false);
                  if (drawn.join() !== rowKey) save(drawn);
                }}
                onKeyMove={(offset) => moveByKeyboard(id, offset)}
              />
            ) : null;
          })}
        </Reorder.Group>
        <span className="visually-hidden" role="status" aria-live="polite">
          {announcement}
        </span>
        <div className={styles.footer}>
          <button type="button" className={styles.restore} title="Show every module, in each page's own order" onClick={() => settings.setModules((l) => restoreDefaults(l, kind))}>
            Restore Defaults
          </button>
          <button type="button" className={styles.done} onClick={close}>
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function CustomizeRowView({ row, shown, onShown, onDragStart, onDragEnd, onKeyMove }: { row: CustomizeRow; shown: boolean; onShown: (on: boolean) => void; onDragStart: () => void; onDragEnd: () => void; onKeyMove: (offset: number) => void }) {
  const controls = useDragControls();
  const [held, setHeld] = useState(false);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    event.stopPropagation();
    onKeyMove(event.key === "ArrowUp" ? -1 : 1);
  };
  return (
    <Reorder.Item
      value={row.id}
      dragListener={false}
      dragControls={controls}
      transition={spring.standard}
      className={styles.row}
      data-held={held}
      onDragStart={() => {
        setHeld(true);
        onDragStart();
      }}
      onDragEnd={() => {
        setHeld(false);
        onDragEnd();
      }}
    >
      <label className={styles.check}>
        <input type="checkbox" checked={shown} onChange={(e) => onShown(e.currentTarget.checked)} />
        <span className={styles.name} data-shown={shown}>
          {row.name}
        </span>
        {row.liveOnly ? (
          <span className={styles.live} aria-hidden="true">
            Live
          </span>
        ) : null}
      </label>
      <button type="button" className={styles.handle} aria-label={`Reorder ${row.name}`} title="Drag to reorder" onPointerDown={(e) => controls.start(e)} onKeyDown={onKeyDown}>
        <Icon name="grip" size={10} />
      </button>
    </Reorder.Item>
  );
}
