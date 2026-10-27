/**
 * Icon: the app's glyphs, drawn on a 16-unit grid in the spirit of SF
 * Symbols (rounded joins, 1.6-unit strokes at regular weight), since the web
 * has no SF Symbols. Each takes `currentColor` and is hidden from assistive
 * tech unless given a `label`.
 *
 *     <Icon name="soccer" size={11} />
 *     <Icon name="star" size={7.5} className={styles.star} label="Following" />
 *
 * `size` is in Mac points (the SF Symbol's point size in the Swift code).
 * Add a glyph here, never inline SVG in a component.
 */
import type { CSSProperties, ReactNode } from "react";
import type { Sport } from "../data/models";

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const GLYPHS = {
  chevronRight: <path {...stroke} strokeWidth={1.9} d="M6 3.25 10.75 8 6 12.75" />,
  chevronLeft: <path {...stroke} strokeWidth={1.9} d="M10 3.25 5.25 8 10 12.75" />,
  chevronDown: <path {...stroke} strokeWidth={1.9} d="M3.25 6 8 10.75 12.75 6" />,
  star: <path fill="currentColor" d="M8 1.2l1.95 4.1 4.5.55-3.3 3.1.86 4.45L8 11.2l-4.01 2.2.86-4.45-3.3-3.1 4.5-.55z" />,
  starOutline: <path {...stroke} strokeWidth={1.3} d="M8 1.9l1.75 3.66 4.02.5-2.95 2.77.77 3.98L8 10.84l-3.59 1.97.77-3.98-2.95-2.77 4.02-.5z" />,
  pin: (
    <g fill="currentColor">
      <path d="M5.2 1.5h5.6l-.7 4.1 2.2 2.6v1.1H3.7V8.2l2.2-2.6z" />
      <rect x="7.35" y="9.3" width="1.3" height="5.4" rx=".65" />
    </g>
  ),
  calendar: (
    <g {...stroke} strokeWidth={1.4}>
      <rect x="2" y="3" width="12" height="11" rx="2.4" />
      <path d="M2 6.6h12M5.2 1.6v2.6M10.8 1.6v2.6" />
    </g>
  ),
  sliders: (
    <g {...stroke} strokeWidth={1.4}>
      <path d="M2 4h12M2 8h12M2 12h12" opacity=".55" />
      <circle cx="10.5" cy="4" r="1.6" fill="currentColor" />
      <circle cx="5.5" cy="8" r="1.6" fill="currentColor" />
      <circle cx="9" cy="12" r="1.6" fill="currentColor" />
    </g>
  ),
  refresh: (
    <g {...stroke} strokeWidth={1.5}>
      <path d="M13.2 8.4A5.2 5.2 0 1 1 11.6 4.2" />
      <path d="M11.9 1.6v3h-3" />
    </g>
  ),
  list: (
    <g fill="currentColor">
      <rect x="1.5" y="3" width="2.2" height="2.2" rx="1.1" />
      <rect x="1.5" y="6.9" width="2.2" height="2.2" rx="1.1" />
      <rect x="1.5" y="10.8" width="2.2" height="2.2" rx="1.1" />
      <rect x="5.4" y="3.4" width="9.1" height="1.4" rx=".7" />
      <rect x="5.4" y="7.3" width="9.1" height="1.4" rx=".7" />
      <rect x="5.4" y="11.2" width="9.1" height="1.4" rx=".7" />
    </g>
  ),
  tiles: (
    <g fill="currentColor">
      <rect x="1.8" y="1.8" width="5.6" height="5.6" rx="1.6" />
      <rect x="8.6" y="1.8" width="5.6" height="5.6" rx="1.6" />
      <rect x="1.8" y="8.6" width="5.6" height="5.6" rx="1.6" />
      <rect x="8.6" y="8.6" width="5.6" height="5.6" rx="1.6" />
    </g>
  ),
  plusCircle: (
    <g>
      <circle cx="8" cy="8" r="6.6" fill="currentColor" />
      <path d="M8 5v6M5 8h6" stroke="var(--icon-cutout, #fff)" strokeWidth={1.5} strokeLinecap="round" />
    </g>
  ),
  minusCircle: (
    <g>
      <circle cx="8" cy="8" r="6.6" fill="currentColor" />
      <path d="M5 8h6" stroke="var(--icon-cutout, #fff)" strokeWidth={1.5} strokeLinecap="round" />
    </g>
  ),
  grip: <path {...stroke} strokeWidth={1.5} d="M3 5h10M3 8h10M3 11h10" />,
  check: <path {...stroke} strokeWidth={1.9} d="M3.2 8.4 6.5 11.6 12.8 4.6" />,
  xmark: <path {...stroke} strokeWidth={1.8} d="M4 4l8 8M12 4l-8 8" />,
  ellipsis: (
    <g fill="currentColor">
      <circle cx="3.5" cy="8" r="1.3" />
      <circle cx="8" cy="8" r="1.3" />
      <circle cx="12.5" cy="8" r="1.3" />
    </g>
  ),
  wifiSlash: (
    <g {...stroke} strokeWidth={1.5}>
      <path d="M1.8 6.2a9 9 0 0 1 12.4 0M4 8.6a5.8 5.8 0 0 1 8 0M6.2 11a2.6 2.6 0 0 1 3.6 0" />
      <path d="M2.5 2.5l11 11" />
    </g>
  ),
  sportscourt: (
    <g {...stroke} strokeWidth={1.4}>
      <rect x="1.5" y="3.5" width="13" height="9" rx="1.8" />
      <path d="M8 3.5v9" />
      <circle cx="8" cy="8" r="1.9" />
      <path d="M1.5 6.2h1.8v3.6H1.5M14.5 6.2h-1.8v3.6h1.8" />
    </g>
  ),
  trophy: (
    <g fill="currentColor">
      <path d="M4.2 1.8h7.6v3.6a3.8 3.8 0 0 1-7.6 0z" />
      <path d="M4.3 2.8H2.2v1.4a2.6 2.6 0 0 0 2.4 2.6M11.7 2.8h2.1v1.4a2.6 2.6 0 0 1-2.4 2.6" fill="none" stroke="currentColor" strokeWidth={1.2} />
      <rect x="7.2" y="8.6" width="1.6" height="3" />
      <rect x="4.8" y="11.6" width="6.4" height="2.4" rx=".8" />
    </g>
  ),
  clock: (
    <g {...stroke} strokeWidth={1.4}>
      <circle cx="8" cy="8" r="6.3" />
      <path d="M8 4.4V8l2.5 1.6" />
    </g>
  ),
  flag: (
    <g fill="currentColor">
      <rect x="2.6" y="1.6" width="1.3" height="12.8" rx=".65" />
      <path d="M4.5 2.3h9l-2 3.2 2 3.2h-9z" />
    </g>
  ),
  play: (
    <g>
      <rect x="1.3" y="2.8" width="13.4" height="10.4" rx="2.6" fill="currentColor" />
      <path d="M6.6 5.7v4.6l4-2.3z" fill="var(--icon-cutout, #fff)" />
    </g>
  ),
  external: (
    <g {...stroke} strokeWidth={1.4}>
      <path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5" />
      <path d="M11.5 9.5v2.6a1.6 1.6 0 0 1-1.6 1.6H3.9a1.6 1.6 0 0 1-1.6-1.6V6.1a1.6 1.6 0 0 1 1.6-1.6h2.6" />
    </g>
  ),
  sun: (
    <g {...stroke} strokeWidth={1.4}>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.3v1.6M8 13.1v1.6M1.3 8h1.6M13.1 8h1.6M3.3 3.3l1.1 1.1M11.6 11.6l1.1 1.1M3.3 12.7l1.1-1.1M11.6 4.4l1.1-1.1" />
    </g>
  ),
  moon: <path fill="currentColor" d="M13.6 10.2A6 6 0 0 1 5.8 2.4a6 6 0 1 0 7.8 7.8z" />,
  display: (
    <g {...stroke} strokeWidth={1.4}>
      <rect x="1.6" y="2.4" width="12.8" height="8.6" rx="1.6" />
      <path d="M5.6 13.8h4.8M8 11v2.8" />
    </g>
  ),
  bell: (
    <g {...stroke} strokeWidth={1.4}>
      <path d="M4 11.4V7.2a4 4 0 0 1 8 0v4.2l1.2 1.2H2.8z" />
      <path d="M6.6 14.2a1.6 1.6 0 0 0 2.8 0" />
    </g>
  ),
  sparkles: (
    <g fill="currentColor">
      <path d="M6.5 2l1.1 3.4L11 6.5 7.6 7.6 6.5 11 5.4 7.6 2 6.5l3.4-1.1z" />
      <path d="M12 9.5l.6 1.9 1.9.6-1.9.6-.6 1.9-.6-1.9-1.9-.6 1.9-.6z" />
    </g>
  ),
  gear: (
    <g {...stroke} strokeWidth={1.4}>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.6v2M8 12.4v2M1.6 8h2M12.4 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M3.5 12.5l1.4-1.4M11.1 4.9l1.4-1.4" />
    </g>
  ),
  // MARK: Sports
  soccer: (
    <g>
      <circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" strokeWidth={1.4} />
      <path fill="currentColor" d="M8 5.3l2.5 1.8-.95 2.95h-3.1L5.5 7.1z" />
      <path {...stroke} strokeWidth={1.2} d="M8 5.3V1.9M10.5 7.1l3.1-1.1M9.55 10.05l1.95 2.75M6.45 10.05 4.5 12.8M5.5 7.1 2.4 6" />
    </g>
  ),
  football: (
    <g>
      <path fill="currentColor" d="M2.6 13.4c-.6-3.6.6-6.9 2.9-8.9 2.2-1.9 5.2-2.7 7.9-2.4.6 3.6-.6 6.9-2.9 8.9-2.2 1.9-5.2 2.7-7.9 2.4z" />
      <path stroke="var(--icon-cutout, #fff)" strokeWidth={1.1} strokeLinecap="round" d="M6.1 9.9l3.8-3.8M6.7 7.9l1.4 1.4M7.9 6.7l1.4 1.4" />
    </g>
  ),
  baseball: (
    <g {...stroke} strokeWidth={1.4}>
      <circle cx="8" cy="8" r="6.4" />
      <path d="M4.2 2.9c1.6 1.4 2.4 3.2 2.4 5.1s-.8 3.7-2.4 5.1M11.8 2.9c-1.6 1.4-2.4 3.2-2.4 5.1s.8 3.7 2.4 5.1" strokeWidth={1.2} />
    </g>
  ),
  basketball: (
    <g {...stroke} strokeWidth={1.3}>
      <circle cx="8" cy="8" r="6.4" strokeWidth={1.4} />
      <path d="M8 1.6v12.8M1.6 8h12.8M3.4 3.4c2 1.6 2.6 3 2.6 4.6s-.6 3-2.6 4.6M12.6 3.4c-2 1.6-2.6 3-2.6 4.6s.6 3 2.6 4.6" />
    </g>
  ),
  esports: (
    <g>
      <path fill="currentColor" d="M4.6 4h6.8c1.7 0 2.9 1.1 3.2 2.8l.7 3.9c.3 1.6-1.4 2.6-2.6 1.6l-1.9-1.6H5.2l-1.9 1.6c-1.2 1-2.9 0-2.6-1.6l.7-3.9C1.7 5.1 2.9 4 4.6 4z" />
      <path stroke="var(--icon-cutout, #fff)" strokeWidth={1.1} strokeLinecap="round" d="M5 6.2v2.4M3.8 7.4h2.4" />
      <circle cx="10.6" cy="6.6" r=".75" fill="var(--icon-cutout, #fff)" />
      <circle cx="11.9" cy="8.1" r=".75" fill="var(--icon-cutout, #fff)" />
    </g>
  ),
  climbing: (
    <g {...stroke} strokeWidth={1.5}>
      <circle cx="9.6" cy="2.6" r="1.45" fill="currentColor" stroke="none" />
      <path d="M9 5.1 7.6 9.4M9 5.4l3 -1.9M8.6 6.1 5.6 7.2M7.6 9.4l2.4 2.2v2.8M7.6 9.4l-2.8 2.9" />
      <path d="M13.6 1.6v12.8" strokeWidth={1.1} opacity=".45" />
    </g>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof GLYPHS;

/** The glyph for each sport (Swift `Sport.symbol`). */
export const SPORT_ICON: Readonly<Record<Sport, IconName>> = {
  soccer: "soccer",
  football: "football",
  baseball: "baseball",
  basketball: "basketball",
  esports: "esports",
  climbing: "climbing",
};

export interface IconProps {
  readonly name: IconName;
  /** Mac points. */
  readonly size?: number;
  /** Spoken name; omit for decoration (most icons sit beside text). */
  readonly label?: string;
  readonly className?: string;
  readonly style?: CSSProperties;
}

export function Icon({ name, size = 12, label, className, style }: IconProps) {
  const dimension = `calc(${size} * var(--pt))`;
  return (
    <svg
      viewBox="0 0 16 16"
      width={16}
      height={16}
      className={className}
      style={{ width: dimension, height: dimension, flex: "none", overflow: "visible", ...style }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {GLYPHS[name]}
    </svg>
  );
}
