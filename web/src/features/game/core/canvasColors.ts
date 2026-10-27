/**
 * Canvas can't read CSS variables: charts resolve their tokens (and
 * `light-dark()` or `color-mix()` values) to concrete colors through a
 * hidden probe, once per color per theme, and redraw when the theme changes.
 *
 *     const ink = colorResolver(canvas);
 *     ctx.fillStyle = ink("var(--viz-neutral)");
 */
const cache = new Map<string, string>();

export function colorResolver(host: Element, scheme: string): (css: string) => string {
  return (css: string) => {
    const key = `${scheme}|${css}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const probe = document.createElement("span");
    probe.style.color = css;
    probe.style.display = "none";
    host.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    cache.set(key, value);
    return value;
  };
}

/** A canvas sized to its box at the device's pixel ratio; returns the context scaled to CSS pixels. */
export function fitCanvas(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; width: number; height: number } | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const w = Math.round(width * dpr);
  const h = Math.round(height * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height };
}
