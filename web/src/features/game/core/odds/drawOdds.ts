/**
 * Win Probability's two canvas layers (OddsChart.swift `OddsStill`,
 * `OddsHead.draw`), drawn in Mac points:
 *
 * - The still layer: hairlines at 0, 25, 50, 75 and 100%, the period
 *   dividers, and every outcome's line up to its newest point, stopping short
 *   of every end dot (the dots need the room), broken where nobody observed
 *   the market (`GAP`). It redraws when the data, the size or the colors do,
 *   never for a glide, a pulse or a scrub.
 * - The live ends: each line's last stretch from its newest point before it
 *   (`tailConnector`), the leaders back to displaced labels, and the dots,
 *   each clearing a ring in the ones beneath it. Drawn per frame only during
 *   a 0.5 s glide.
 *
 * A "clearing" is the Swift's: room punched in this layer only
 * (destination-out on its own canvas), so the well shows through; the grid
 * goes in behind the lines afterwards (destination-over), so the room never
 * cuts it.
 */
import { dotSize, drawnOrder, endLeaders, endOpacity, LINE, maxX, tailConnector, visiblePoints, type OddsChartData, type OddsEndLabel, type OddsLayout, type OddsLine } from "../../../../data/odds/chart";
import { GAP, type OddsSplit } from "../../../../data/odds/polymarket";

/** Colors resolved for a canvas (css variables can't be read there). */
export interface OddsInk {
  readonly grid: string;
  /** Each line's color, by outcome, resolved. */
  readonly line: (line: OddsLine) => string;
}

function clipToPlot(ctx: CanvasRenderingContext2D, layout: OddsLayout): void {
  ctx.beginPath();
  ctx.rect(layout.plot.x, layout.bounds.y - 4, layout.plot.width + 1, layout.bounds.height + 8);
  ctx.clip();
}

/** Room punched in what's drawn so far: circles erased in this layer only. */
function clear(ctx: CanvasRenderingContext2D, centers: readonly { x: number; y: number }[], radius: number): void {
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  for (const c of centers) {
    ctx.moveTo(c.x + radius, c.y);
    ctx.arc(c.x, c.y, radius, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.restore();
}

/** The still layer: the grid and every line up to its newest point (OddsStill). */
export function drawStill(ctx: CanvasRenderingContext2D, data: OddsChartData | null, layout: OddsLayout, lines: readonly OddsLine[], ink: OddsInk): void {
  const drawn = drawnOrder(lines);
  const points = data ? visiblePoints(data.points, (p) => p.t, layout.domain, data.endVisible) : [];
  const head = data?.points.at(-1);
  if (data && head && points.length > 1) {
    ctx.save();
    clipToPlot(ctx, layout);
    ctx.lineWidth = LINE;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const line of drawn) {
      ctx.beginPath();
      let previous: { t: number } | null = null;
      for (const p of points) {
        if (p.unobserved) continue;
        const x = layout.x(p.t);
        const y = layout.y(share(p.split, line.outcome));
        // Samples a gap apart: nobody saw what happened between, so nothing's drawn.
        if (previous && p.t - previous.t <= GAP) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        previous = p;
      }
      ctx.strokeStyle = ink.line(line);
      ctx.stroke();
    }
    ctx.restore();
    if (data.endVisible) {
      clear(
        ctx,
        drawn.map((l) => layout.end(head.split, l.outcome)),
        dotSize(data.final) / 2 + 2,
      );
    }
  }
  // Hairlines at 0, 25, 50, 75 and 100%, and the period dividers: recessive, under everything.
  ctx.save();
  ctx.globalCompositeOperation = "destination-over";
  ctx.beginPath();
  const plot = layout.plot;
  for (const p of [0, 0.25, 0.5, 0.75, 1]) {
    const y = Math.round(layout.y(p) * 2) / 2;
    ctx.moveTo(plot.x, y);
    ctx.lineTo(maxX(plot), y);
  }
  for (const period of (data?.periods ?? []).slice(1)) {
    const x = layout.x(period.start);
    if (x <= plot.x + 1 || x >= maxX(plot) - 1) continue;
    ctx.moveTo(x, plot.y - 4);
    ctx.lineTo(x, plot.y + plot.height + 4);
  }
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = ink.grid;
  ctx.stroke();
  ctx.restore();
}

const share = (s: OddsSplit, o: OddsLine["outcome"]) => (o === "top" ? s.top : o === "draw" ? (s.draw ?? 0) : s.bottom);

/** The live ends at a frame: the last stretch of every line, the leaders, the dots (OddsHead.draw). */
export function drawHead(ctx: CanvasRenderingContext2D, data: OddsChartData, layout: OddsLayout, lines: readonly OddsLine[], shown: OddsSplit, labels: readonly OddsEndLabel[], ink: OddsInk): void {
  const head = data.points.at(-1);
  if (!head) return;
  const r = dotSize(data.final) / 2;
  const drawn = drawnOrder(lines);
  const ends = drawn.map((l) => layout.end(shown, l.outcome));
  const previous = data.points.length > 1 ? data.points[data.points.length - 2]! : null;
  // The last stretch of every line, from the newest point before it, stopping short of every dot.
  ctx.save();
  clipToPlot(ctx, layout);
  ctx.lineWidth = LINE;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const line of drawn) {
    const points = tailConnector(previous, head, shown, line.outcome, layout);
    const first = points[0];
    if (!first) continue;
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    for (const p of points.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = ink.line(line);
    ctx.stroke();
  }
  ctx.restore();
  clear(ctx, ends, r + 2);
  // Each leader belongs to one outcome; never join ambiguous crossings.
  for (const label of endLeaders(labels)) {
    const line = lines.find((l) => l.outcome === label.outcome);
    if (!line) continue;
    ctx.save();
    ctx.globalAlpha = 0.45 * endOpacity(label, labels);
    ctx.beginPath();
    ctx.moveTo(label.dot.x + r + 2.5, label.dot.y);
    ctx.lineTo(layout.labelX - 2, label.y);
    ctx.lineWidth = 0.75;
    ctx.strokeStyle = ink.line(line);
    ctx.stroke();
    ctx.restore();
  }
  // The dots, each clearing a ring in the ones beneath it.
  drawn.forEach((line, k) => {
    const end = ends[k]!;
    clear(ctx, [end], r + 1.5);
    ctx.beginPath();
    ctx.arc(end.x, end.y, r, 0, Math.PI * 2);
    ctx.fillStyle = ink.line(line);
    ctx.fill();
  });
}
