/**
 * Text measurement for the few decisions the Mac app makes from text widths
 * (ListLayout.swift `RecordFit`): measured once per row's data with a shared
 * canvas, never per layout pass.
 */

let context: CanvasRenderingContext2D | null | undefined;

function ctx(): CanvasRenderingContext2D | null {
  if (context === undefined) context = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
  return context;
}

/** One Mac point in CSS pixels right now (the root font size / 13). */
export function pointSize(): number {
  if (typeof document === "undefined") return 1;
  return parseFloat(getComputedStyle(document.documentElement).fontSize) / 13 || 1;
}

/** The UI face, as tokens.css names it (canvas can't read CSS variables). */
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, "Segoe UI", Roboto, sans-serif';

/** Width in Mac points of `text` at `size` points and `weight`. */
export function textWidth(text: string, size: number, weight = 400): number {
  const c = ctx();
  if (!c) return text.length * size * 0.55;
  c.font = `${weight} ${size}px ${FONT}`;
  return Math.ceil(c.measureText(text).width);
}

/**
 * Whether a team's record fits beside its name in the fixed 230pt team block
 * (RecordFit.fits): crest, rank, name, the ball and star marks, the record,
 * the spacer's minimum, the score. The record gives way before the name would truncate.
 */
export function recordFits(options: { name: string; rank: number | null; marks: number; record: string; score: string | null; block?: number }): boolean {
  const { name, rank, marks, record, score, block = 230 } = options;
  let used = 16 + 8;
  if (rank != null) used += textWidth(String(rank), 10.5, 600) + 4;
  used += textWidth(name, 13);
  used += marks * (8 + 10);
  used += 8 + textWidth(record, 10.5);
  used += 8;
  if (score != null) used += textWidth(score, 13, 600);
  return used <= block - 2;
}
