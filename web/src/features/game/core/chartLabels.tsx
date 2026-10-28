/**
 * Team labels in charts, fitted on the page (data/chartLabels.ts with the
 * shared canvas measure): `fitted` for SVG text and positioned labels,
 * `FittedName` for an HTML label in a fixed slot, `useLabelGutter` for a
 * chart's name gutter. A cut label keeps its full name in the tooltip.
 *
 *     const gutter = useLabelGutter(topName, bottomName);
 *     <FittedName text={names.top} room={28} className={styles.rowName} />
 */
import { useMemo } from "react";
import { fitLabel, labelGutter, type FittedLabel, type GutterStyle, type LabelStyle } from "../../../data/chartLabels";
import { textWidth } from "../../scores/measure";

/** A label fitted to `room` points with the page's own font. */
export function fitted(text: string, room: number, style?: LabelStyle): FittedLabel {
  return fitLabel(text, room, textWidth, style);
}

/** A chart's name gutter (points) for its two labels: 30pt, grown for a long one. */
export function useLabelGutter(top: string, bottom: string, style?: GutterStyle): number {
  const { size, weight, base, max, pad } = style ?? {};
  return useMemo(() => labelGutter([top, bottom], textWidth, { size, weight, base, max, pad }), [top, bottom, size, weight, base, max, pad]);
}

/** An HTML label in a slot `room` points wide: shrunk, then cut, never spilling. */
export function FittedName({ text, room, size = 9, weight = 600, className }: { readonly text: string; readonly room: number; readonly size?: number; readonly weight?: number; readonly className?: string }) {
  const fit = useMemo(() => fitted(text, room, { size, weight }), [text, room, size, weight]);
  return (
    <span className={className} style={fit.size !== size ? { fontSize: `calc(${fit.size} * var(--pt))` } : undefined} title={fit.cut ? text : undefined}>
      {fit.text}
    </span>
  );
}
