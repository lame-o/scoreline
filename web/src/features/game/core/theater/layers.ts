/**
 * A crossfade between two frames of a theater on its one canvas (a replay
 * taking over from the field between plays: theaterBridge.ts), shared by
 * every theater and small, so the baseball theater's chunk takes it without
 * the football and soccer kit (theaterKit.ts).
 */
type Ctx = CanvasRenderingContext2D;

/** The canvases a crossfade's frames are drawn on first (kept between frames). */
const layers: HTMLCanvasElement[] = [];

/**
 * Frames laid over each other, each at its own opacity as one layer, in
 * order (a crossfade: SwiftUI's `.opacity` on each frame of a ZStack, so
 * where a frame leaves its well bare, the other never shows through it
 * alone): each is drawn on a canvas of its own first, through `ctx`'s
 * transform, then laid down.
 */
export function drawLayers(ctx: Ctx, frames: readonly (readonly [opacity: number, draw: (c: Ctx) => void])[]): void {
  const { width, height } = ctx.canvas;
  const m = ctx.getTransform();
  frames.forEach(([opacity, draw], k) => {
    if (!(opacity > 0.001)) return;
    const layer = (layers[k] ??= document.createElement("canvas"));
    if (layer.width !== width || layer.height !== height) {
      layer.width = width;
      layer.height = height;
    }
    const c = layer.getContext("2d");
    if (!c) return;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, width, height);
    c.setTransform(m);
    draw(c);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = Math.min(opacity, 1);
    ctx.drawImage(layer, 0, 0);
    ctx.restore();
  });
}
