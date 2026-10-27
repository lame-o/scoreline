/**
 * The favicon as a live score (the menu bar item's text, as an icon): the
 * score drawn on the app icon's night, "2–1" on one line or two stacked
 * scores ("148" over "150") when one line wouldn't read at 16px, with a red
 * dot while the game is live. Back to the app icon when there's no score.
 * Redrawn only when what it shows changes.
 */
import type { FaviconScore } from "../data/tabScore";

const SIZE = 64;
const NIGHT = "#0a1a28";
const ICE = "#f4fbff";
const LIVE = "#ff3b30";
const FONT = 'ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", sans-serif';

let original: string | null = null;
let shown: string | null = null;

function draw(score: FaviconScore): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const g = canvas.getContext("2d");
  if (!g) return null;
  g.fillStyle = NIGHT;
  g.beginPath();
  g.roundRect(0, 0, SIZE, SIZE, 14);
  g.fill();
  g.fillStyle = ICE;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const fit = (text: string, start: number, width: number) => {
    let size = start;
    g.font = `700 ${size}px ${FONT}`;
    while (size > 12 && g.measureText(text).width > width) {
      size -= 1;
      g.font = `700 ${size}px ${FONT}`;
    }
  };
  if (score.lines.length === 1) {
    const text = score.lines[0]!;
    fit(text, 36, 58);
    g.fillText(text, SIZE / 2, SIZE / 2 + 2);
  } else {
    score.lines.forEach((text, i) => {
      fit(text, 29, 54);
      g.fillText(text, SIZE / 2, i === 0 ? 19 : 47);
    });
  }
  if (score.live) {
    g.fillStyle = NIGHT;
    g.beginPath();
    g.arc(SIZE - 9, 9, 9, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = LIVE;
    g.beginPath();
    g.arc(SIZE - 9, 9, 6.5, 0, Math.PI * 2);
    g.fill();
  }
  return canvas.toDataURL("image/png");
}

/** Shows a score in the favicon, or (null) the app icon again. */
export function setFaviconScore(score: FaviconScore | null): void {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) return;
  original ??= link.href;
  const key = score ? `${score.lines.join("/")}|${score.live}` : null;
  if (key === shown) return;
  const href = score ? draw(score) : original;
  if (!href) return;
  shown = key;
  link.href = href;
}
