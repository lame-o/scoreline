/**
 * Shapes as well as color (Settings → Appearance; the Mac's Differentiate
 * Without Color, LiveViews.swift `shape`): with it on, the bottom team's
 * marks in a chart are rounded squares in the same box as the top team's
 * circles, so the two sides differ by shape too.
 *
 *     markPath(ctx, x, y, r, shapes && side === "bottom"); ctx.fill();
 */

/** Begins a path: a circle of radius `r`, or a rounded square in the same box (corners 22% of its side). */
export function markPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, square: boolean): void {
  ctx.beginPath();
  if (!square) {
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    return;
  }
  if (typeof ctx.roundRect === "function") ctx.roundRect(x - r, y - r, 2 * r, 2 * r, 2 * r * 0.22);
  else ctx.rect(x - r, y - r, 2 * r, 2 * r);
}
