/**
 * The pieces team and player pages share (TeamPage.swift, PlayerPage.swift,
 * ProfileLinks.swift, Visualizations.swift `DetailSection`): the sticky
 * header, the team-color wash and glow, sections with their titles and
 * captions, small-caps group headers, "Show All" buttons, the failure
 * footnote, stat tiles, static skeletons, the live strip, the crest, and the
 * one- or two-column layout from 680pt.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { Link } from "react-router";
import { BackButton, Icon, LiveStatus, PageHeader, SectionTitle, Skeleton, TeamLogo, type SectionTitleProps } from "../../design/components";
import { scoreLine, spokenEventStatus, spokenScore } from "../../data/format";
import type { ScoreEvent } from "../../data/models";
import { orderLogoColors } from "../../data/logoColors";
import { atLeast, widthClassOf, type WidthClass } from "../../data/profiles/display";
import type { StatTile, TeamHeader, TeamRef } from "../../data/profiles/models";
import { FLAG_PALETTE } from "../../data/teams";
import { luminance, teamPalette, washStrength, NEUTRAL } from "../../data/teamColors";
import { logoColorsFor, useLogoColorsVersion } from "../../state/logoColors";
import { useColorScheme } from "../../state/theme";
import { useWidth } from "../../design/useWidth";
import { useGoBack } from "../../app/navigation";
import styles from "./Profile.module.css";

// MARK: - Colors (ProfileLinks.swift `ProfileColors`)

export interface WashColors {
  readonly left: string;
  readonly right: string;
}

/**
 * The team's two colors for a wash, fitted to the scheme: the crest's own
 * colors once read (they arrive as a change of light), else the source's.
 * Null when the team has no usable color.
 */
export function useTeamColors(team: TeamRef | null, header: TeamHeader | null = null): WashColors | null {
  const scheme = useColorScheme();
  const version = useLogoColorsVersion();
  const logo = header?.logo ?? team?.logo ?? null;
  const color = header?.color ?? team?.color ?? null;
  const alternate = header?.alternateColor ?? team?.alternateColor ?? null;
  return useMemo(() => {
    if (!team && !header) return null;
    const entry = logoColorsFor(logo);
    let top = color;
    let bottom = alternate;
    if (entry && entry.colors.length > 0) {
      const ordered = orderLogoColors(entry, color);
      top = ordered[0]!.replace("#", "");
      bottom = ordered[1]?.replace("#", "") ?? alternate;
    }
    if (!top) return null;
    const palette = teamPalette(top, bottom ?? top, scheme);
    return { left: palette.top, right: bottom == null ? palette.top : palette.bottom };
    // `version` re-reads the crest's colors as they arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team?.id, header, logo, color, alternate, scheme, version]);
}

/** A climbing nation's two flag colors (never the white). */
export function flagColors(ioc: string | null): WashColors | null {
  const pair = ioc ? FLAG_PALETTE[ioc.toUpperCase()] : undefined;
  return pair ? { left: `#${pair[0]}`, right: `#${pair[1]}` } : null;
}

/** A CSS color for marks: the team's first color, or the accent. Neutral marks read as secondary ink. */
export function tintOf(colors: WashColors | null): string | null {
  return colors?.left ?? null;
}

/** Whether white initials read on a bold monogram of this tint (`Viz.ink(on:)`). */
export function lightInkOn(tint: string | null): boolean {
  return !tint || !tint.startsWith("#") || luminance(tint) <= 0.6;
}

// MARK: - The wash and the glow

/**
 * The team colors behind the page's top, as the match page's (SharedUI.swift
 * `HeroWash`): the two colors meeting in the middle over a soft base of page
 * color, so the clear glass hero refracts the team. It stays put while the
 * page scrolls over it. New colors (the crest's, read on the first visit)
 * cross-fade in over the old: a change of light, never a jump.
 */
export function ProfileWash({ colors, intensity = 1 }: { readonly colors: WashColors | null; readonly intensity?: number }) {
  const strength = colors ? intensity : 0.6;
  const gradient = washGradient(colors, strength);
  const [layers, setLayers] = useState<{ key: number; gradient: string }[]>(() => [{ key: 0, gradient }]);
  useEffect(() => {
    setLayers((current) => (current.at(-1)?.gradient === gradient ? current : [...current.slice(-1), { key: (current.at(-1)?.key ?? 0) + 1, gradient }]));
  }, [gradient]);
  // The old layer goes once the new one has faded in.
  useEffect(() => {
    if (layers.length < 2) return;
    const timer = window.setTimeout(() => setLayers((current) => current.slice(-1)), 1000);
    return () => window.clearTimeout(timer);
  }, [layers]);
  return (
    <div className={styles.washTrack} aria-hidden="true">
      <div className={styles.wash}>
        <div className={styles.washBase} />
        {layers.map((layer, i) => (
          <div key={layer.key} className={styles.washColors} data-incoming={i > 0} style={{ background: layer.gradient }} />
        ))}
      </div>
    </div>
  );
}

function washGradient(colors: WashColors | null, intensity: number): string {
  const left = colors?.left ?? "var(--accent)";
  const right = colors?.right ?? "var(--accent)";
  const strength = (c: string) => Math.round((c.startsWith("#") ? washStrength(c, intensity) : 0.6 * intensity) * 100);
  const mix = (c: string, pct: number) => `color-mix(in srgb, ${c === NEUTRAL ? "var(--viz-neutral)" : c} ${pct}%, transparent)`;
  const inner = Math.round(12 * intensity);
  return `linear-gradient(to right, ${mix(left, strength(left))}, ${mix(left, inner)}, ${mix(right, inner)}, ${mix(right, strength(right))})`;
}

/**
 * A soft glow of the team's color behind a hero crest or photo: a drawn
 * radial falloff, not a blur (the hero scales as the page scrolls, and a
 * blur would re-rasterize every frame).
 */
export function HeroGlow({ color, diameter }: { readonly color: string | null; readonly diameter: number }) {
  const c = color == null || color === NEUTRAL ? "var(--accent)" : color;
  const g = (pct: number) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;
  const size = `calc(${diameter * 2} * var(--pt))`;
  return (
    <span
      className={styles.glow}
      style={{
        width: size,
        height: size,
        margin: `calc(${-diameter} * var(--pt)) 0 0 calc(${-diameter} * var(--pt))`,
        background: `radial-gradient(circle closest-side, ${g(33)} 0%, ${g(30)} 25%, ${g(17)} 50%, ${g(8)} 67%, ${g(2.5)} 83%, transparent 100%)`,
      }}
      aria-hidden="true"
    />
  );
}

// MARK: - Header

/** The scroller a page lives in: the detail pane beside the sidebar, else the window. */
export function scrollerOf(el: Element | null): HTMLElement | null {
  const pane = el?.closest("main");
  if (pane && /(auto|scroll)/.test(getComputedStyle(pane).overflowY)) return pane as HTMLElement;
  return null;
}

/**
 * No title: the hero below is the page's heading. Back on the leading side
 * (hidden beside the sidebar, where Esc goes back), buttons trailing. It
 * stays put, and once content is underneath it gains a soft edge for the
 * content to dissolve under.
 */
export function ProfileHeader({ split, backTitle, trailing }: { readonly split: boolean; readonly backTitle: string; readonly trailing?: ReactNode }) {
  const goBack = useGoBack();
  const sentinel = useRef<HTMLSpanElement>(null);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setScrolled(!entry?.isIntersecting), { root: scrollerOf(el), threshold: 0 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <>
      <span ref={sentinel} className={styles.sentinel} aria-hidden="true" />
      <div className={styles.header} data-scrolled={scrolled}>
        <PageHeader className={styles.headerBar} leading={split ? null : <BackButton to={backTitle} onClick={() => goBack()} />} trailing={trailing} />
      </div>
    </>
  );
}

// MARK: - Layout

export interface ProfileLayout {
  /** Two columns from 680pt of page. */
  readonly split: boolean;
  /** A block spanning the page. */
  readonly page: WidthClass;
  /** A block in one column (the page's with one column). */
  readonly column: WidthClass;
}

/** The page's arrangement from its width, changing only at thresholds (Responsive.swift `PanelLayout`). */
export function useProfileLayout(ref: RefObject<HTMLElement | null>): ProfileLayout {
  const width = useWidth(ref, 340);
  const split = width >= 680;
  const page = widthClassOf(width - 28);
  const column = split ? widthClassOf(width / 2 - 28) : page;
  return useMemo(() => ({ split, page, column }), [split, page, column]);
}

export type Slot = "left" | "right" | "span";

/**
 * Sections in one column, or two from 680pt (Responsive.swift
 * `MatchColumnsLayout`): runs of left and right sections form a block, each
 * column stacked in order; a spanning section closes the block and sits full
 * width below it.
 */
export function SectionColumns<S extends string>({ sections, layout, slot, render }: {
  readonly sections: readonly S[];
  readonly layout: ProfileLayout;
  readonly slot: (s: S) => Slot;
  readonly render: (s: S, width: WidthClass) => ReactNode;
}) {
  if (!layout.split) return <div className={styles.columnStack}>{sections.map((s) => <Entrance key={s}>{render(s, layout.page)}</Entrance>)}</div>;
  const blocks: ({ kind: "span"; s: S } | { kind: "pair"; left: S[]; right: S[] })[] = [];
  for (const s of sections) {
    const where = slot(s);
    if (where === "span") {
      blocks.push({ kind: "span", s });
      continue;
    }
    const last = blocks.at(-1);
    const pair = last?.kind === "pair" ? last : (blocks.push({ kind: "pair", left: [], right: [] }), blocks.at(-1) as { kind: "pair"; left: S[]; right: S[] });
    pair[where].push(s);
  }
  return (
    <div className={styles.columnStack}>
      {blocks.map((b) =>
        b.kind === "span" ? (
          <Entrance key={b.s}>{render(b.s, layout.page)}</Entrance>
        ) : (
          <div key={`${b.left[0] ?? ""}|${b.right[0] ?? ""}`} className={styles.pair}>
            <div className={styles.columnStack}>{b.left.map((s) => <Entrance key={s}>{render(s, layout.column)}</Entrance>)}</div>
            <div className={styles.columnStack}>{b.right.map((s) => <Entrance key={s}>{render(s, layout.column)}</Entrance>)}</div>
          </div>
        ),
      )}
    </div>
  );
}

/** A section's entrance: it slides 10pt in and fades when it lands (sections that land later assemble the same way). */
function Entrance({ children }: { readonly children: ReactNode }) {
  return <div className={styles.entrance}>{children}</div>;
}

// MARK: - Sections

export interface DetailSectionProps {
  readonly title: string;
  readonly caption?: string | null;
  readonly accessory?: SectionTitleProps["accessory"];
  readonly trailing?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}

/** A section: its small-caps title, a one- or two-line caption, then the content. */
export function DetailSection({ title, caption, accessory, trailing, children, className }: DetailSectionProps) {
  return (
    <section className={[styles.section, className].filter(Boolean).join(" ")} aria-label={title}>
      <div className={styles.sectionHead}>
        <SectionTitle accessory={accessory} trailing={trailing}>
          {title}
        </SectionTitle>
        {caption ? <p className={styles.caption}>{caption}</p> : null}
      </div>
      {children}
    </section>
  );
}

export interface ColumnLabel {
  readonly label: string;
  /** Points. */
  readonly width: number;
}

/** A group's small-caps label with the columns' labels on the right (drawn for the eye; each row says its own values). */
export function GroupHeader({ title, columns = [], first = false }: { readonly title: string; readonly columns?: readonly ColumnLabel[]; readonly first?: boolean }) {
  return (
    <div className={styles.groupHeader} data-first={first}>
      <h3 className={styles.subLabel}>{title}</h3>
      <span className={styles.spacer} />
      {columns.map((c) => (
        <span key={c.label} className={styles.columnLabel} style={{ width: `calc(${c.width} * var(--pt))` }} aria-hidden="true">
          {c.label}
        </span>
      ))}
    </div>
  );
}

/** "All Games (20) ⌄": opens the rest of a long list in place. */
export function MoreButton({ children, onClick }: { readonly children: string; readonly onClick: () => void }) {
  return (
    <button type="button" className={styles.more} onClick={onClick}>
      <span>{children}</span>
      <Icon name="chevronDown" size={8} />
    </button>
  );
}

/** Parts that didn't load, with the way to try again (a profile loads once per visit: nothing retries on its own). */
export function Footnote({ text, onRetry }: { readonly text: string; readonly onRetry?: () => void }) {
  return (
    <div className={styles.footnote} role="status">
      <span>{text}</span>
      <span className={styles.spacer} />
      {onRetry ? (
        <button type="button" className={styles.more} onClick={onRetry}>
          <span>Try Again</span>
          <Icon name="refresh" size={8.5} />
        </button>
      ) : null}
    </div>
  );
}

/**
 * Headline numbers as tiles: the number is the chart. A rank caption only
 * when it means something (≤ 25th); from medium width it says where ("12th in the NBA").
 */
export function StatTiles({ tiles, rankSuffix, width }: { readonly tiles: readonly StatTile[]; readonly rankSuffix?: string | null; readonly width: WidthClass }) {
  const caption = (tile: StatTile) => {
    if (!tile.rank) return null;
    if (!rankSuffix || !atLeast(width, "medium") || !(/^\d/.test(tile.rank) || tile.rank.startsWith("T-"))) return tile.rank;
    return `${tile.rank} ${rankSuffix}`;
  };
  return (
    <div className={styles.tiles} style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.min(4, tiles.length))}, minmax(0, 1fr))` }}>
      {tiles.map((tile) => (
        <div key={tile.label} className={styles.tile} role="group" aria-label={[tile.label, tile.value, caption(tile)].filter(Boolean).join(", ")}>
          <span className={styles.tileValue} aria-hidden="true">
            {tile.value}
          </span>
          <span className={styles.tileLabel} aria-hidden="true">
            {tile.label}
          </span>
          <span className={styles.tileCaption} aria-hidden="true">
            {caption(tile) ?? " "}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Static placeholder tiles while the season loads (no shimmer: placeholders hold still). */
export function TileSkeleton() {
  return (
    <div className={styles.tiles} style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }} role="status" aria-label="Loading this season">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={styles.tile}>
          <Skeleton width={44} height={18} radius={4} />
          <Skeleton width={30} height={7} style={{ marginTop: "calc(5 * var(--pt))" }} />
        </div>
      ))}
    </div>
  );
}

/** Static placeholder rows while the roster loads. */
export function RosterSkeleton({ rows = 6 }: { readonly rows?: number }) {
  return (
    <div className={styles.rosterSkeleton} role="status" aria-label="Loading the roster">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={styles.skeletonRow}>
          <Skeleton circle width={28} height={28} />
          <span className={styles.skeletonLines}>
            <Skeleton width={120} height={8} />
            <Skeleton width={70} height={6} />
          </span>
          <span className={styles.spacer} />
          {[0, 1, 2].map((k) => (
            <Skeleton key={k} width={22} height={8} />
          ))}
        </div>
      ))}
    </div>
  );
}

// MARK: - Crest, live strip

/**
 * A team crest, or its abbreviation when there's no logo (a shield when
 * there's no abbreviation either: three letters of a name can be another
 * team's code).
 */
export function TeamCrest({ team, size = 16 }: { readonly team: Pick<TeamRef, "logo" | "abbreviation">; readonly size?: number }) {
  if (team.logo) return <TeamLogo url={team.logo} size={size} />;
  const code = team.abbreviation?.slice(0, 4).toUpperCase();
  const style: CSSProperties = { width: `calc(${size} * var(--pt))`, height: `calc(${size} * var(--pt))`, fontSize: `calc(${size * (code && code.length > 3 ? 0.34 : 0.42)} * var(--pt))` };
  return (
    <span className={styles.crestCode} style={style} aria-hidden="true">
      {code ?? <Icon name="flag" size={size * 0.45} />}
    </span>
  );
}

/** A team or player page's game in progress: the score line and the live clock, opening the match. */
export function LiveStrip({ event }: { readonly event: ScoreEvent }) {
  return (
    <Link to={`/game/${encodeURIComponent(event.id)}`} className={styles.liveStrip} aria-label={`Live: ${spokenScore(event)}, ${spokenEventStatus(event, Date.now())}`} title="Open the match">
      <span className={styles.liveScore}>{scoreLine(event, true)}</span>
      <LiveStatus clock={event.clock} fallback={event.detail ?? "Live"} size={11} />
      <span className={styles.spacer} />
      <Icon name="chevronRight" size={9} className={styles.chevron} />
    </Link>
  );
}
