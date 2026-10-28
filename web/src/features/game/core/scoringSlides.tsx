/**
 * The scoring slide on screen (ScoringSlideView.swift; its rules and words:
 * data/scoringSlide.ts). The page's `ScoringSlides` keeps the line and plays
 * one slide at a time; its hosts put it over the hero card (taking the
 * scoreboard over while it holds) or just under the docked bar, and are out
 * of the tree between slides. The wipe is the Mac's keyframes, sampled from
 * the pure poses into WAAPI keyframes on transform and opacity only: the
 * slab lands in about 0.35 s, its sheen done by 1 s, and nothing animates or
 * ticks during the hold; out to the same side in 0.3 s. Reduce Motion
 * crossfades it. Nothing runs between scores: a timer exists only while a
 * slide waits, shows or leaves.
 *
 *     const slides = useScoringSlides(moments);           // GamePage, one per page
 *     <SlidesProvider slides={slides}> … </SlidesProvider>
 *     <ScoringSlideHost surface="hero" geometry={geometry} />
 *     useSlideTheater("field", playing, () => footballClimax(script));   // in a theater
 */
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { cueBursts, cueDuration, cueFor, drawParticles, particles, sparks, wantsBurst, type CelebrationCue } from "../../../data/celebrations";
import { isFinalRound } from "../../../data/climbing";
import type { GameDetail } from "../../../data/gameDetail";
import { sizedLogo } from "../../../data/images";
import type { Surface } from "../../../data/matchRules";
import type { StatcastBatted } from "../../../data/mlb/statcast";
import { darkLogo, type Competitor, type ScoreEvent } from "../../../data/models";
import { captioned, type LiveMoment, type MomentChart } from "../../../data/moments";
import {
  cutInset,
  lifted,
  LOGO_BASE,
  makeSlide,
  playsConfetti,
  poseValue,
  slideEdge,
  slideFrames,
  slideHold,
  SlideLine,
  slideLead,
  slideMetrics,
  SlideMotion,
  slidePaint,
  SlideTier,
  SLIDE_METRICS,
  smallInk,
  framesLength,
  type ScoringSlide,
  type SlideContext,
  type SlideMetrics,
  type SlidePaint,
  type SlidePose,
  type SlideTeam,
} from "../../../data/scoringSlide";
import { sectionForChart } from "../../../data/sections";
import { toHex } from "../../../data/teamColors";
import { getSettings, useSettings } from "../../../state/settings";
import { useWidth } from "../../../design/useWidth";
import { announce } from "./announce";
import { resolvePalette } from "./CelebrationStage";
import { DOCK_INSET, useSurface, type PageGeometry } from "./geometry";
import type { MomentSlot, SlideTaker } from "./moments";
import { useChartPeek } from "./peek";
import { pointSize, useReducedMotion } from "./useMedia";
import styles from "./ScoringSlide.module.css";

// MARK: - Theaters

/**
 * A play theater a slide follows (ScoringSlide.swift `SlideTheater`): the
 * news play it holds (replaying it, or about to) and that replay's climax in
 * seconds, read from the theater's own script. Registered by the theater
 * while it's on the page (`useSlideTheater`).
 */
export interface SlideTheater {
  playing(): string | null;
  climax(): number | null;
  /** Baseball: Statcast's measurement of the play, once it's in. */
  batted(id: string): StatcastBatted | null;
}

/** How a queued slide meets the page (ScoringSlide.swift `SlidePlan`). */
export interface SlidePlan {
  /** The theater or chart that celebrates this moment is on screen. */
  readonly ownerVisible: boolean;
  /** The theater that replays the play, when the page has one. */
  readonly theater: SlideTheater | null;
  /** Land with the theater's climax (it's on screen and replays the play); otherwise only wait for it to take the play, then show. */
  readonly follow: boolean;
  /** The longest to wait for the theater to take the play (seconds). */
  readonly patience: number;
  /** Statcast's measurement of the play, once it's in. */
  readonly batted: (() => StatcastBatted | null) | null;
}

const NO_PLAN: SlidePlan = { ownerVisible: false, theater: null, follow: false, patience: 0, batted: null };

/**
 * How long a theater may take to pick up a play it hasn't yet. The Mac's
 * baseball theater waits up to 3 s for Statcast (3.6). Web addition: a
 * theater takes its lane's new play on the render after the lane's tick, so
 * the others get a moment too.
 */
const PATIENCE = { plate: 3.6, render: 1.2 } as const;

/** What the page tells its slides, read once per score, never observed. */
export interface SlidePage {
  readonly context: () => SlideContext;
  readonly plan: (m: LiveMoment) => SlidePlan;
}

// MARK: - The line, played

interface Entry {
  readonly moment: LiveMoment;
  readonly context: SlideContext;
  /** When it may show; null while it waits for the theater to take its play (until `deadline`). ms. */
  ready: number | null;
  deadline: number;
  theater: SlideTheater | null;
  follow: boolean;
  batted: (() => StatcastBatted | null) | null;
  confetti: boolean;
}

export interface SlideState {
  /** The slide on screen, and whether it's on its way out. */
  readonly current: ScoringSlide | null;
  readonly leaving: boolean;
}

const IDLE: SlideState = { current: null, leaving: false };

/** How long a slide waits for its logo to decode before it goes anyway (ms). */
const LOGO_WAIT = 300;

/**
 * The page's scoring slides (ScoringSlideView.swift `ScoringSlides`): the
 * line, the one on screen, and its timing. Plain TypeScript; the hosts
 * subscribe to its state.
 */
export class ScoringSlides implements SlideTaker {
  private state: SlideState = IDLE;
  private line = new SlideLine();
  private entries = new Map<string, Entry>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private shownAt: number | null = null;
  private leftAt: number | null = null;
  private listeners = new Set<() => void>();
  private theaters = new Map<MomentChart, SlideTheater>();
  private decoded = new Set<string>();
  private page: SlidePage = { context: () => ({}), plan: () => NO_PLAN };
  private readonly now: () => number;
  private readonly enabled: () => boolean;

  constructor(options: { now?: () => number; enabled?: () => boolean } = {}) {
    this.now = options.now ?? (() => performance.now());
    this.enabled = options.enabled ?? (() => getSettings().scoringSlides);
  }

  readonly snapshot = (): SlideState => this.state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(next: SlideState): void {
    this.state = next;
    this.listeners.forEach((l) => l());
  }

  /** The page's context and plan, current as of its last render. */
  bind(page: SlidePage): void {
    this.page = page;
  }

  /** A theater on the page; returns its removal. */
  register(chart: MomentChart, theater: SlideTheater): () => void {
    this.theaters.set(chart, theater);
    return () => {
      if (this.theaters.get(chart) === theater) this.theaters.delete(chart);
    };
  }

  theater(chart: MomentChart): SlideTheater | null {
    return this.theaters.get(chart) ?? null;
  }

  /**
   * One update's moments: the scores among them join the line (a catch-up
   * only its newest). Returns their IDs: each slide makes its own
   * announcement, so the moment slot stays quiet for them.
   */
  take(batch: readonly LiveMoment[]): ReadonlySet<string> {
    if (!this.enabled() || batch.length === 0) return new Set();
    const context = this.page.context();
    const catchUp = batch.filter(captioned).length > 3;
    const joined = this.line.offer(
      batch.flatMap((m) => makeSlide(m, context) ?? []),
      catchUp,
    );
    const time = this.now();
    for (const slide of joined) this.entries.set(slide.id, { moment: slide.moment, context, ready: time, deadline: time, theater: null, follow: false, batted: null, confetti: false });
    return new Set(joined.map((s) => s.id));
  }

  /**
   * After the moment slot has had the update: whether each new slide plays
   * the page's burst (`granted`: the moment the slot gave a burst; `claim`
   * takes the page's cooldown for a moment it didn't), and when it shows:
   * now, once the theater has its play, or with the theater's climax.
   */
  schedule(ids: ReadonlySet<string>, granted: LiveMoment | null, claim: () => boolean): void {
    const time = this.now();
    for (const id of [...ids].sort()) {
      const entry = this.entries.get(id);
      const slide = this.line.waiting.find((s) => s.id === id);
      if (!entry || !slide) continue;
      const p = this.page.plan(entry.moment);
      entry.confetti = playsConfetti(slide.tier, granted?.id === id && granted.burst, wantsBurst(entry.moment), p.ownerVisible, claim);
      entry.batted = p.batted;
      entry.theater = p.theater;
      entry.follow = p.follow;
      if (p.theater) {
        if (p.theater.playing() === id) {
          entry.ready = time + (p.follow ? slideLead(p.theater.climax()) * 1000 : 0);
        } else if (p.patience > 0) {
          entry.ready = null;
          entry.deadline = time + p.patience * 1000;
        }
      }
      this.warm(slide);
    }
    this.pump();
  }

  /** A theater took a new play (`useSlideTheater`): a slide waiting for it is timed from now. */
  theaterMoved(): void {
    const time = this.now();
    let moved = false;
    for (const [id, entry] of this.entries) {
      if (entry.ready != null || !entry.theater || entry.theater.playing() !== id) continue;
      entry.ready = time + (entry.follow ? slideLead(entry.theater.climax()) * 1000 : 0);
      moved = true;
    }
    if (moved) this.pump();
  }

  /** Scores taken back (overturned on review, a play rewritten): gone from the line, and off screen. */
  retract(ids: readonly string[]): void {
    if (ids.length === 0) return;
    this.line.retract(new Set(ids));
    for (const id of ids) this.entries.delete(id);
    if (this.state.current && ids.includes(this.state.current.id) && !this.state.leaving) {
      this.leave();
      this.pump();
    }
  }

  /** The page went away. What was offered stays offered. */
  clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.line.drain();
    this.entries.clear();
    this.shownAt = null;
    this.leftAt = null;
    this.theaters.clear();
    if (this.state !== IDLE) this.set(IDLE);
  }

  /** The slide on screen has landed (a host drawing it for the first time mid-hold doesn't wipe it in again). */
  settled(): boolean {
    return this.shownAt != null && this.now() - this.shownAt > (SlideMotion.land + 0.2) * 1000;
  }

  /** Whether this moment is (or was) the slides': its slide makes the announcement and the sheen, and the docked bar's news line yields. */
  carries(id: string): boolean {
    return this.line.carries(id);
  }

  // MARK: Timing

  private pump(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.run();
  }

  private wait(until: number): void {
    this.timer = setTimeout(() => {
      this.timer = null;
      this.run();
    }, Math.max(until - this.now(), 0));
  }

  /** The one timer: sleeps to the next thing that happens (a slide due, its hold over, its exit done) and stops when nothing's left. */
  private run(): void {
    for (;;) {
      const time = this.now();
      const { current, leaving } = this.state;
      if (current) {
        if (!leaving && this.shownAt != null) {
          const end = this.shownAt + (SlideMotion.land + slideHold(current)) * 1000;
          if (time < end) return this.wait(end);
          this.leave();
        } else if (this.leftAt != null) {
          const gone = this.leftAt + (SlideMotion.exitLength + 0.02) * 1000;
          if (time < gone) return this.wait(gone);
          this.leftAt = null;
          this.set(IDLE);
        }
        continue;
      }
      const head = this.line.first;
      const entry = head ? this.entries.get(head.id) : undefined;
      if (!head || !entry) return;
      if (entry.ready != null) {
        if (time < entry.ready) return this.wait(entry.ready);
        // A moment for its logo to decode, so it never arrives as a placeholder.
        if (!this.logoReady(head) && time < entry.ready + LOGO_WAIT) return this.wait(time + 30);
      } else if (time < entry.deadline) {
        return this.wait(entry.deadline);
      }
      this.show(head, entry);
    }
  }

  private show(head: ScoringSlide, entry: Entry): void {
    this.line.next();
    this.entries.delete(head.id);
    // Dressed again now: Statcast may have measured the home run while it waited.
    const dressed = makeSlide(entry.moment, entry.context, entry.batted?.() ?? null) ?? head;
    const slide = { ...dressed, confetti: entry.confetti };
    this.shownAt = this.now();
    this.leftAt = null;
    this.set({ current: slide, leaving: false });
    announce(slide.spoken);
  }

  private leave(): void {
    this.leftAt = this.now();
    this.set({ current: this.state.current, leaving: true });
  }

  // MARK: Logos

  private logoReady(slide: ScoringSlide): boolean {
    const urls = logoURLs(slide);
    return urls.length === 0 || urls.some((u) => this.decoded.has(u));
  }

  /** Decodes the slide's logo at its size while it waits (the hero's is smaller). */
  private warm(slide: ScoringSlide): void {
    if (typeof Image === "undefined") return;
    for (const url of logoURLs(slide)) {
      if (this.decoded.has(url)) continue;
      const img = new Image();
      img.src = url;
      img.decode().then(
        () => this.decoded.add(url),
        () => {},
      );
    }
  }
}

/** The slide's logo, sized: its dark-background variant first on a dark slab. */
function logoURLs(slide: ScoringSlide): string[] {
  const logo = slide.team?.logo ?? null;
  if (!logo) return [];
  const urls = slidePaint(slide).lightInk ? [darkLogo(logo), logo] : [logo];
  return urls.flatMap((u) => sizedLogo(u, LOGO_BASE) ?? []);
}

// MARK: - The page

const SlidesContext = createContext<ScoringSlides | null>(null);

export function SlidesProvider({ slides, children }: { slides: ScoringSlides; children: ReactNode }) {
  return <SlidesContext.Provider value={slides}>{children}</SlidesContext.Provider>;
}

/** The page's slides, if any (the docked bar's news line and the hero's glint ask what they carry). */
export function useScoringSlidesContext(): ScoringSlides | null {
  return useContext(SlidesContext);
}

/** One per page, taking the moment slot's scores; unmounting clears it. */
export function useScoringSlides(moments: MomentSlot): ScoringSlides {
  const slides = useMemo(() => new ScoringSlides(), []);
  useEffect(() => {
    moments.attach?.(slides);
    return () => {
      moments.attach?.(null);
      slides.clear();
    };
  }, [moments, slides]);
  return slides;
}

/** A competitor as a slide wears it. */
const slideTeam = (c: Competitor): SlideTeam => ({ name: c.name, abbreviation: c.abbreviation, logo: c.logo, color: c.color, alternate: c.alternateColor });

/** Who's who for the slides: the two sides, climbing's round and route, CS2's maps. */
export function slideContext(event: ScoreEvent, detail: GameDetail | null): SlideContext {
  const climbers = new Map<number, GameDetail["wall"][number]["climbers"][number]>();
  for (const c of detail?.wall.flatMap((r) => r.climbers) ?? []) if (!climbers.has(c.id)) climbers.set(c.id, c);
  return {
    top: event.content.kind === "match" ? slideTeam(event.content.top) : null,
    bottom: event.content.kind === "match" ? slideTeam(event.content.bottom) : null,
    final: isFinalRound(detail?.roundName),
    climbers,
    maps: detail?.maps ?? [],
    bestOf: detail?.bestOf ?? null,
  };
}

/**
 * How a slide meets this page (DetailView.slidePlan): whether the theater or
 * chart that celebrates its moment is on screen (it plays the burst there),
 * and the theater to time it to.
 */
export function slidePlan(m: LiveMoment, slides: ScoringSlides, geometry: PageGeometry, live: boolean, reduceMotion: boolean): SlidePlan {
  const visibility = (section: string) => geometry.visibilityOf(section);
  const seen = (section: string) => {
    const v = visibility(section);
    return v != null && v !== "hiddenAbove" && v !== "hiddenBelow";
  };
  const timed = (theater: SlideTheater | null, ownerVisible: boolean, patience: number): SlidePlan =>
    theater ? { ownerVisible, theater, follow: ownerVisible && !reduceMotion, patience, batted: null } : { ...NO_PLAN, ownerVisible };
  switch (m.chart) {
    case "plate": {
      // The theater owns a play's celebration when the page shows it (At the Plate); the spray chart otherwise.
      const plate = visibility("atPlate") != null;
      const theater = slides.theater("plate");
      const plan = timed(theater, seen(plate ? "atPlate" : "battedBalls"), PATIENCE.plate);
      return theater ? { ...plan, batted: () => theater.batted(m.id) } : plan;
    }
    case "field":
      return timed(slides.theater("field"), seen("field"), PATIENCE.render);
    case "pitch":
      return timed(live ? slides.theater("pitch") : null, seen("pitch"), PATIENCE.render);
    case "court":
      // The court's theater (once the web has it) replays every basket and owns its celebration while it's shown.
      return timed(live ? slides.theater("court") : null, seen("court"), PATIENCE.render);
    case "ascent":
    case "rounds":
      return { ...NO_PLAN, ownerVisible: seen(sectionForChart(m.chart)) };
    default:
      return NO_PLAN;
  }
}

/** The page tells its slides who's who and how each score meets it, as of this render. */
export function useBindSlides(event: ScoreEvent, detail: GameDetail | null, geometry: PageGeometry): void {
  const slides = useContext(SlidesContext);
  const reduceMotion = useReducedMotion();
  const live = event.state === "live";
  useLayoutEffect(() => {
    slides?.bind({ context: () => slideContext(event, detail), plan: (m) => slidePlan(m, slides, geometry, live, reduceMotion) });
  });
}

/**
 * A play theater on the page tells the slides which news play it holds and
 * when its replay peaks (ScoringSlide.swift `SlideTheater.baseball` and the
 * rest): `playing` is read as of the theater's last render, `climax` from
 * the script it replays. A peek's copy of a chart never registers.
 */
export function useSlideTheater(chart: MomentChart, playing: string | null, climax: () => number | null, batted?: (id: string) => StatcastBatted | null): void {
  const slides = useContext(SlidesContext);
  const peek = useChartPeek();
  const latest = useRef({ playing, climax, batted });
  latest.current = { playing, climax, batted };
  useLayoutEffect(() => {
    if (!slides || peek) return;
    return slides.register(chart, {
      playing: () => latest.current.playing,
      climax: () => latest.current.climax(),
      batted: (id) => latest.current.batted?.(id) ?? null,
    });
  }, [slides, peek, chart]);
  useLayoutEffect(() => {
    if (slides && !peek && playing != null) slides.theaterMoved();
  }, [slides, peek, playing]);
}

// MARK: - Hosts

/**
 * Where the slide shows: over the hero card, filling it (the bar takes the
 * scoreboard over while it holds), or just under the docked bar once that's
 * the scoreboard on screen. A host on each; the one whose surface is on
 * screen draws, so a slide is only ever in one place. Out of the tree
 * between slides, and it reads which scoreboard shows only while a slide
 * does, so the page around it never re-renders for it. Information, never
 * in the way: clicks go to the page, and screen readers hear its one
 * announcement (the hero stays the scoreboard).
 */
export function ScoringSlideHost({ surface, geometry }: { surface: Surface; geometry: PageGeometry }) {
  const slides = useContext(SlidesContext);
  const state = useSyncExternalStore(slides ? slides.subscribe : noSubscribe, slides ? slides.snapshot : idle, idle);
  if (!slides || !state.current) return null;
  return <Surfaced slides={slides} state={state} slide={state.current} surface={surface} geometry={geometry} />;
}

const noSubscribe = () => () => {};
const idle = () => IDLE;

function Surfaced({ slides, state, slide, surface, geometry }: { slides: ScoringSlides; state: SlideState; slide: ScoringSlide; surface: Surface; geometry: PageGeometry }) {
  const on = useSurface(geometry);
  if (on !== surface) return null;
  const bar = <SlideBar key={slide.id} slide={slide} leaving={state.leaving} settled={slides.settled()} />;
  if (surface === "hero") {
    return (
      <div className={styles.heroHost} aria-hidden="true">
        {bar}
      </div>
    );
  }
  return (
    <div className={styles.dockSlot} aria-hidden="true">
      <div className={styles.dockHost} style={{ top: `calc(${DOCK_INSET + 4} * var(--pt))` }}>
        {bar}
      </div>
    </div>
  );
}

// MARK: - Bar

const css = (paint: SlidePaint) => ({
  slab: toHex(paint.slab),
  top: toHex(lifted(paint.slab, 0.045)),
  bottom: toHex(lifted(paint.slab, -0.05)),
  stripe: toHex(paint.stripe),
  ink: paint.lightInk ? "#ffffff" : "#141414",
});

type Layer = "stripe" | "slab" | "content" | "logo" | "chip" | "root" | "sheen";

/**
 * One slide: the stripe and the slab wiping in from its edge, the logo
 * large, the headline, the subline, the chip and the score.
 */
function SlideBar({ slide, leaving, settled }: { slide: ScoringSlide; leaving: boolean; settled: boolean }) {
  const reduceMotion = useReducedMotion();
  const level = useSettings((s) => s.celebrationLevel);
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box, 360);
  // The page's width class from the bar's (it sits 10pt in from each side).
  const m = slideMetrics(width + 20);
  const paint = useMemo(() => slidePaint(slide), [slide]);
  const colors = useMemo(() => css(paint), [paint]);
  // It had already landed when this bar appeared (it moved to the other scoreboard mid-hold): no second wipe.
  const [arrivedLanded] = useState(settled);
  const leading = slideEdge(slide) === "leading";
  const layers = useRef<Partial<Record<Layer, HTMLElement | null>>>({});
  const sheen = slide.tier >= SlideTier.big && level === "full" && !reduceMotion && !arrivedLanded;

  // The wipe in, once, as it mounts; out when it leaves. Transform and opacity only.
  useLayoutEffect(() => {
    if (arrivedLanded && !leaving) return;
    const el = box.current;
    if (!el) return;
    const animations = play(layers.current, leaving, reduceMotion, leading, el.clientWidth, m);
    return () => animations.forEach((a) => a.cancel());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);

  const style = {
    "--slide-h": m.height,
    "--slide-logo": m.logo,
    "--slide-headline": m.headline,
    "--slide-subline": m.subline,
    "--slide-chip": m.chip,
    "--slide-score": m.score,
    "--slide-slant": m.slant,
    "--slide-cut": m.stripe,
    "--slide-inset": cutInset(m),
    "--slab": colors.slab,
    "--slab-top": colors.top,
    "--slab-bottom": colors.bottom,
    "--stripe": colors.stripe,
    "--ink": colors.ink,
    "--subline-ink": smallInk(paint, 0.86),
    "--score-ink": smallInk(paint, 0.9),
  } as CSSProperties;

  const tally = (
    <span className={styles.tally}>
      {slide.chip ? (
        <span className={styles.chip} ref={(el) => void (layers.current.chip = el)}>
          {slide.chip}
        </span>
      ) : null}
      {slide.score ? <span className={styles.score}>{slide.score}</span> : null}
    </span>
  );
  const words = <Words slide={slide} compact={m === SLIDE_METRICS.compact} size={m.headline} />;
  const mark = <Mark slide={slide} paint={paint} set={(el) => void (layers.current.logo = el)} />;

  return (
    <div ref={box} className={styles.bar} data-scoring-slide={slide.id} data-edge={leading ? "leading" : "trailing"} data-tier={slide.tier} style={style}>
      <div className={styles.root} ref={(el) => void (layers.current.root = el)}>
        <div className={styles.stripeLayer} ref={(el) => void (layers.current.stripe = el)}>
          <div className={styles.stripe} />
        </div>
        <div className={styles.slabLayer} ref={(el) => void (layers.current.slab = el)}>
          <div className={styles.slab}>
            {sheen ? <span className={styles.sheen} data-light={paint.lightInk} ref={(el) => void (layers.current.sheen = el)} /> : null}
          </div>
          <div className={styles.content} ref={(el) => void (layers.current.content = el)}>
            {leading ? (
              <>
                {mark}
                {words}
                <span className={styles.spacer} />
                {tally}
              </>
            ) : (
              <>
                {tally}
                <span className={styles.spacer} />
                {words}
                {mark}
              </>
            )}
          </div>
        </div>
      </div>
      {arrivedLanded ? null : <SlideBurst slide={slide} paint={paint} metrics={m} leading={leading} />}
    </div>
  );
}

/**
 * The headline (its short form when the full one doesn't fit, then down to
 * 72%) and the subline (down to 88%, then cut). Web additions, so a narrow
 * bar never reads "TOUCHDO…": at the compact width (a phone) the headline
 * may go down to 60% before it's cut, and a subline that doesn't fit at 88%
 * takes a second line (the bar's height holds two at every width).
 */
function Words({ slide, compact, size }: { slide: ScoringSlide; compact: boolean; size: number }) {
  const headline = useRef<HTMLSpanElement>(null);
  const subline = useRef<HTMLSpanElement>(null);
  // The size the short headline was chosen at (a wider bar asks again).
  const [shortAt, setShortAt] = useState<number | null>(null);
  const short = shortAt === size;
  useLayoutEffect(() => {
    const fit = (el: HTMLElement | null, least: number) => {
      if (!el) return 1;
      el.style.setProperty("--fit", "1");
      delete el.dataset.wrap;
      // Measured to the subpixel (scrollWidth rounds, and a text a fraction too wide is cut).
      const range = document.createRange();
      range.selectNodeContents(el);
      const need = range.getBoundingClientRect().width + 1;
      const room = el.getBoundingClientRect().width;
      const ratio = need > room ? room / need : 1;
      el.style.setProperty("--fit", String(Math.max(ratio, least)));
      return ratio;
    };
    const full = fit(headline.current, compact && !slide.short ? 0.6 : 0.72);
    if (full < 1 && slide.short && !short) {
      setShortAt(size);
      return;
    }
    if (fit(subline.current, 0.88) < 0.88 && subline.current) subline.current.dataset.wrap = "true";
  }, [slide, short, compact, size]);
  return (
    <span className={styles.words}>
      <span ref={headline} className={styles.headline}>
        {short && slide.short ? slide.short : slide.headline}
      </span>
      <span ref={subline} className={styles.subline}>
        {slide.subline}
      </span>
    </span>
  );
}

/** The team's logo (its dark-background variant on a dark slab) or the climber's flag, seated on a soft glow of the type's color. */
function Mark({ slide, paint, set }: { slide: ScoringSlide; paint: SlidePaint; set: (el: HTMLElement | null) => void }) {
  const [failed, setFailed] = useState<string | null>(null);
  const logo = slide.team?.logo ?? null;
  const dark = paint.lightInk ? sizedLogo(darkLogo(logo), LOGO_BASE) : null;
  const regular = sizedLogo(logo, LOGO_BASE);
  const src = dark && failed !== dark ? dark : regular;
  return (
    <span className={styles.logo} ref={set}>
      <span className={styles.glow} />
      {slide.flag ? (
        <span className={styles.flag}>{slide.flag}</span>
      ) : src ? (
        <img className={styles.logoImage} src={src} alt="" draggable={false} decoding="sync" onError={() => setFailed(src)} />
      ) : null}
    </span>
  );
}

// MARK: - Motion

/** The away direction's sign: off toward the edge it came from. */
const away = (leading: boolean) => (leading ? -1 : 1);

/**
 * Starts the wipe on each layer: the pure poses (data/scoringSlide.ts
 * `slideFrames`) sampled at 60 per second into WAAPI keyframes on
 * transform and opacity. Returns the animations (cancelled if the bar goes).
 */
function play(layers: Partial<Record<Layer, HTMLElement | null>>, leaving: boolean, reduceMotion: boolean, leading: boolean, width: number, m: SlideMetrics): Animation[] {
  const pt = pointSize();
  const sign = away(leading);
  const frames = slideFrames(leaving, reduceMotion);
  const out: Animation[] = [];
  const run = (el: HTMLElement | null | undefined, keys: readonly (keyof SlidePose)[], frame: (v: Record<string, number>) => Keyframe) => {
    if (!el) return;
    el.getAnimations().forEach((a) => a.cancel());
    const length = Math.max(...keys.map((k) => framesLength(frames[k])));
    if (length <= 0) return;
    const steps = Math.max(2, Math.ceil(length * 60));
    const keyframes: Keyframe[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * length;
      const values: Record<string, number> = {};
      for (const k of keys) values[k] = poseValue(k, t, leaving, reduceMotion);
      keyframes.push({ ...frame(values), offset: i / steps });
    }
    out.push(el.animate(keyframes, { duration: length * 1000, easing: "linear", fill: "both" }));
  };
  // Moved off toward an edge by `fraction` of its own width, plus room for the shadow.
  const across = (f: number) => `translateX(calc(${sign * f * 100}% + ${sign * f * 40 * pt}px))`;
  run(layers.stripe, ["stripe"], (v) => ({ transform: across(v.stripe!) }));
  run(layers.slab, ["slab"], (v) => ({ transform: across(v.slab!) }));
  run(layers.content, ["lag"], (v) => ({ transform: `translateX(${sign * SlideMotion.lag * v.lag! * pt}px)`, opacity: 1 - v.lag! }));
  run(layers.logo, ["logo"], (v) => ({ transform: `scale(${v.logo})` }));
  run(layers.chip, ["chip"], (v) => ({ transform: `scale(${v.chip})` }));
  run(layers.root, ["opacity"], (v) => ({ opacity: v.opacity }));
  // One sheen across the slab as it lands: a soft band of light at 18°.
  const band = Math.max(56, m.height * 0.9) * pt;
  run(layers.sheen, ["sheen"], (v) => ({
    // Its center from a band's width before the slab to one past it.
    transform: `translateX(${-1.5 * band + (width + 2 * band) * v.sheen!}px) rotate(18deg)`,
    opacity: v.sheen! > 0 && v.sheen! < 1 ? 1 : 0,
  }));
  return out;
}

// MARK: - Burst

/** Room around the bar for the confetti to fly into, above and below it (pt). */
const MARGIN = 130;
const SCALE = 1.7;

/**
 * The slide's celebration at its logo, as the slab lands: a spark for a big
 * score (in the type's color and the stripe's), and for the top tier the
 * confetti in the team's two colors, when the page's one burst is the
 * slide's. Through the page's rules (`cueFor`): the celebration level,
 * Reduce Motion (a soft bloom) and the cooldown. Drawn larger than a chart's
 * (the bar is the stage). requestAnimationFrame only while it plays.
 */
function SlideBurst({ slide, paint, metrics, leading }: { slide: ScoringSlide; paint: SlidePaint; metrics: SlideMetrics; leading: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const level = useSettings((s) => s.celebrationLevel);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const toward = leading ? (-60 * Math.PI) / 180 : (-120 * Math.PI) / 180;
    let spark: CelebrationCue | null = null;
    if (slide.tier >= SlideTier.big) {
      // The rays start just clear of the logo and stop short of the headline.
      const base = (metrics.logo / 2 + 2) / SCALE;
      const cue = cueFor(slide.moment, { level, reduceMotion, preset: "medium", direction: toward, effects: [sparks(10, 8, base)] });
      spark = cue ? { ...cue, delay: 0 } : null;
    }
    let confetti: CelebrationCue | null = null;
    if (slide.confetti && !reduceMotion) {
      const cue = cueFor({ ...slide.moment, burst: true }, { level, reduceMotion: false, preset: "medium", direction: toward, effects: [{ kind: "confetti", direction: toward, spread: (85 * Math.PI) / 180, preset: "medium" }] });
      // A grand slam's is gold too, as the theater's banner has it.
      confetti = cue ? { ...cue, delay: 0, gold: cue.gold || (slide.moment.accents.has("grandSlam") && cueBursts(cue)) } : null;
    }
    const length = Math.max(spark ? cueDuration(spark) : 0, confetti ? cueDuration(confetti) : 0);
    if (length <= 0) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    el.width = Math.round(rect.width * dpr);
    el.height = Math.round(rect.height * dpr);
    const pt = pointSize();
    const c = css(paint);
    const sparkPalette = resolvePalette(el, { primary: c.ink, tint: c.stripe });
    // The team's two colors, as they read over the slab and the page: the second color, and the first lifted (a navy piece on a navy slab is gone).
    const teamPalette = resolvePalette(el, { primary: c.stripe, tint: toHex(lifted(paint.slab, Math.max(0.62 - paint.slab.l, 0.18))) });
    const w = rect.width / pt;
    const h = rect.height / pt;
    const x = leading ? 14 + metrics.logo / 2 : w - 14 - metrics.logo / 2;
    const y = MARGIN + (h - 2 * MARGIN) / 2;
    let frame = 0;
    let start: number | null = null;
    const draw = (now: number) => {
      start ??= now;
      const t = (now - start) / 1000 - SlideMotion.burstAt;
      ctx.setTransform(dpr * pt, 0, 0, dpr * pt, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (t >= 0) {
        ctx.translate(x, y);
        ctx.scale(SCALE, SCALE);
        if (confetti) drawParticles(ctx, particles(confetti, { x: 0, y: 0 }, t), teamPalette);
        if (spark) drawParticles(ctx, particles(spark, { x: 0, y: 0 }, t), sparkPalette);
      }
      if (t < length + 0.05) frame = requestAnimationFrame(draw);
      else {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, el.width, el.height);
      }
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
    // One burst per slide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <canvas ref={canvas} className={styles.burst} style={{ "--slide-margin": MARGIN } as CSSProperties} aria-hidden="true" />;
}
