/**
 * An element's width in Mac points, from one ResizeObserver, updated only
 * when it changes. Blocks add detail as they widen (the Mac's width classes:
 * compact < 380pt of content, medium 380, large 460, xlarge 560); type never scales.
 */
import { useLayoutEffect, useState, type RefObject } from "react";

export const WIDTH = { medium: 380, large: 460, xlarge: 560 } as const;

function pointSize(): number {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) / 13 || 1;
}

export function useWidth(ref: RefObject<HTMLElement | null>, initial = 340): number {
  const [width, setWidth] = useState(initial);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setWidth(Math.round(el.clientWidth / pointSize()));
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
