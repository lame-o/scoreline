/**
 * The scoring slide on screen (ScoringSlideView.swift; its rules and words:
 * data/scoringSlide.ts): a broadcast lower third. The page's
 * `ScoringSlides` keeps the line and plays one slide at a time; its hosts put
 * it over the hero card (centered on it, while the card's scoreboard steps
 * aside entirely) or just under the docked bar, and are out of the tree
 * between slides. Its motion is the pure timeline (`SLIDE_IN`, `SLIDE_OUT`)
 * as WAAPI on transform, opacity and the reveals' clip: the kicker, the slab
 * and the detail strip in from the scorer's side, everything landed by
 * 0.7 s, its sheen done by 1.05 s, nothing animating or ticking during the
 * hold; out the way they came in 0.38 s. Reduce Motion crossfades it.
 * Nothing runs between scores: a timer exists only while a slide waits,
 * shows or leaves.
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
  kickerInk,
  lifted,
  LOGO_BASE,
  makeSlide,
  playsConfetti,
  SLAB_MAX,
  SLIDE_CURVES,
  SLIDE_IN,
  SLIDE_LEAN,
  SLIDE_OUT,
  slideEdge,
  slideHold,
  SlideLine,
  slideLead,
  slideMetrics,
  SlideMotion,
  slidePaint,
  SlideTier,
  smallInk,
  type ScoringSlide,
  type SlideBeat,
  type SlideContext,
  type SlideLayer,
  type SlideMetrics,
  type SlidePaint,
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
 * the others get a moment too. The court's tells every play in order, so a
 * basket may wait its turn behind a beat or two: up to its queue's budget
 * (basketballFlow.ts `QUEUE_BUDGET`, 12 s), as the Mac's.
 */
const PATIENCE = { plate: 3.6, render: 1.2, court: 12 } as const;

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
      // The court's theater replays every basket and owns its celebration while it's shown. It tells every play in
      // order: a basket may wait its turn (never longer than the queue's budget).
      return timed(live ? slides.theater("court") : null, seen("court"), seen("court") ? PATIENCE.court : PATIENCE.render);
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
 * Where the slide shows: over the hero card, centered on it (the card's
 * scoreboard steps aside while it's up), or just under the docked bar once
 * that's the scoreboard on screen (the bar stays). A host on each; the one whose surface is on
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
  const bar = <SlideBar key={slide.id} slide={slide} leaving={state.leaving} settled={slides.settled()} hero={surface === "hero"} />;
  if (surface === "hero") {
    // `data-slide-host`: the card's scoreboard steps aside while it's here (Hero.module.css).
    return (
      <div className={styles.heroHost} data-slide-host="" aria-hidden="true">
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

// MARK: - Lower third

const css = (paint: SlidePaint) => ({
  slab: toHex(paint.slab),
  top: toHex(lifted(paint.slab, 0.07)),
  stripe: toHex(paint.stripe),
  ink: paint.lightInk ? "#ffffff" : "#141414",
  kicker: toHex(kickerInk(paint)),
});

type Layer = SlideLayer | "root";

/**
 * Over the hero the graphic bleeds into the page's gutter on its entering
 * side (the card's 10pt); its far end stops 16pt short of the card's far
 * edge (or the docked bar's). pt.
 */
const BLEED = 10;
const SHORT = 16;

let condenses: boolean | null = null;

/**
 * Whether the system font draws its condensed width (SF Pro Condensed, as
 * WebKit does). Chromium's system-ui ignores `font-stretch`, so there the
 * slide's type takes a condensed face that it does have (Helvetica Neue's,
 * Arial Narrow, Roboto Condensed). Measured once per page.
 */
export function systemCondenses(): boolean {
  if (condenses != null) return condenses;
  if (typeof document === "undefined") return true;
  const width = (stretch: string) => {
    const probe = document.createElement("span");
    probe.textContent = "HOME RUN";
    probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:italic 900 40px system-ui;font-stretch:${stretch}`;
    document.body.append(probe);
    const w = probe.getBoundingClientRect().width;
    probe.remove();
    return w;
  };
  condenses = width("condensed") < width("normal") * 0.95;
  return condenses;
}

/**
 * One slide as a broadcast lower third (the approved "A · Lower third"):
 * three hard-edged layers from the scorer's side, mirrored in place for the
 * right but never in lean (every slanted edge leans with the italic type,
 * 12°): the kicker tab in the second color, the slab in the team's color
 * (the logo in a darker zone behind a slash, the headline, the tally) and
 * the detail strip; the chip on the kicker row. Over the hero it's
 * vertically centered on the card while the card steps aside. Its width is
 * measured before the graphic mounts, so its entrance and its burst start
 * at the right width class.
 */
function SlideBar({ slide, leaving, settled, hero }: { slide: ScoringSlide; leaving: boolean; settled: boolean; hero: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box, 0);
  // The page's width class: over the hero the bar spans the card and its gutters; under the docked bar it sits 10pt in from each side.
  const m = slideMetrics(hero ? width : width + 2 * BLEED);
  const paint = useMemo(() => slidePaint(slide), [slide]);
  const colors = useMemo(() => css(paint), [paint]);
  // It had already landed when this bar appeared (it moved to the other scoreboard mid-hold): no second entrance.
  const [arrivedLanded] = useState(settled);
  const [condensed] = useState(systemCondenses);
  const leading = slideEdge(slide) === "leading";

  const style = {
    "--k": m.kicker,
    "--s": m.slab,
    "--d": m.detail,
    "--hl": m.headline,
    "--sc": m.scale,
    "--lean": SLIDE_LEAN,
    "--far": (hero ? BLEED : 0) + SHORT,
    "--slab-max": SLAB_MAX,
    "--slab": colors.slab,
    "--slab-top": colors.top,
    "--stripe": colors.stripe,
    "--ink": colors.ink,
    "--kicker-ink": colors.kicker,
    "--theirs": smallInk(paint, 0.55),
  } as CSSProperties;

  return (
    <div
      ref={box}
      className={styles.bar}
      data-scoring-slide={slide.id}
      data-edge={leading ? "leading" : "trailing"}
      data-tier={slide.tier}
      data-type={condensed ? undefined : "fallback"}
      data-ink={paint.lightInk ? "light" : "dark"}
      style={style}
    >
      {width > 0 ? <Graphic slide={slide} leaving={leaving} arrivedLanded={arrivedLanded} metrics={m} paint={paint} leading={leading} /> : null}
    </div>
  );
}

function Graphic({ slide, leaving, arrivedLanded, metrics: m, paint, leading }: { slide: ScoringSlide; leaving: boolean; arrivedLanded: boolean; metrics: SlideMetrics; paint: SlidePaint; leading: boolean }) {
  const reduceMotion = useReducedMotion();
  const level = useSettings((s) => s.celebrationLevel);
  const layers = useRef<Partial<Record<Layer, HTMLElement | null>>>({});
  const set = (layer: Layer) => (el: HTMLElement | null) => void (layers.current[layer] = el);
  const sheen = slide.tier >= SlideTier.big && level === "full" && !reduceMotion && !arrivedLanded;
  const short = useFit(slide, m, layers);

  // In, once, as it mounts; out when it leaves. Transform, opacity and the reveals' clip.
  useLayoutEffect(() => {
    if (arrivedLanded && !leaving) return;
    const animations = play(layers.current, leaving, reduceMotion, leading);
    return () => animations.forEach((a) => a.cancel());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);

  const tally = slide.tally ? (
    <span className={styles.tally} ref={set("tally")} data-tally="">
      <span className={styles.row} data-row="mine">
        <span>{slide.tally.mine.team}</span> <span>{slide.tally.mine.score}</span>
      </span>
      <span className={`${styles.row} ${styles.theirs}`} data-row="theirs">
        <span>{slide.tally.theirs.team}</span> <span>{slide.tally.theirs.score}</span>
      </span>
    </span>
  ) : slide.score ? (
    <span className={styles.tally} ref={set("tally")}>
      <span className={styles.score}>{slide.score}</span>
    </span>
  ) : null;

  return (
    <>
      <div className={styles.root} ref={set("root")}>
        {slide.kicker ? (
          <div className={styles.kicker} ref={set("kicker")}>
            {slide.kicker}
          </div>
        ) : null}
        <div className={styles.detail} ref={set("detail")}>
          <span className={styles.words} ref={set("subline")}>
            {slide.subline}
          </span>
        </div>
        <div className={styles.slab} ref={set("slab")}>
          <span className={styles.zone} />
          <span className={styles.slash} />
          {sheen ? <span className={styles.sheen} data-light={paint.lightInk} ref={set("sheen")} /> : null}
          <Mark slide={slide} paint={paint} set={set("logo")} />
          <span className={styles.headline} ref={set("headline")}>
            {short && slide.short ? slide.short : slide.headline}
          </span>
          <span className={styles.spacer} />
          {tally}
        </div>
        {slide.chip ? (
          <span className={styles.chip} ref={set("chip")}>
            {slide.chip}
          </span>
        ) : null}
      </div>
      {arrivedLanded ? null : <SlideBurst slide={slide} paint={paint} metrics={m} leading={leading} />}
    </>
  );
}

/**
 * The type fits as ViewThatFits and minimumScaleFactor do, measured once per
 * slide and width: the headline on one line (its short form when the full
 * one doesn't fit, then down to 40%, the mockup's floor); the subline in its
 * strip down to 90%, past that the strip takes the slab's whole length (a
 * web addition, so a phone doesn't cut the play), then down to 82%, then cut.
 * Each one's room is measured from its container, never from its own box
 * (which shrinks with it). Returns whether the short headline is showing.
 */
function useFit(slide: ScoringSlide, m: SlideMetrics, layers: { current: Partial<Record<Layer, HTMLElement | null>> }): boolean {
  // The size the short headline was chosen at (a wider bar asks again).
  const [shortAt, setShortAt] = useState<number | null>(null);
  const short = shortAt === m.headline;
  useLayoutEffect(() => {
    const { headline, subline, detail, slab, tally } = layers.current;
    if (!headline || !subline || !detail || !slab) return;
    const px = (v: string) => parseFloat(v) || 0;
    const inner = (el: HTMLElement) => {
      const box = getComputedStyle(el);
      return el.getBoundingClientRect().width - px(box.paddingLeft) - px(box.paddingRight);
    };
    // The headline's room: the slab's, less the tally, the least gap before it, and the italic's overhang.
    const headlineRoom = () => {
      const spacer = headline.nextElementSibling;
      const gap = spacer instanceof HTMLElement ? px(getComputedStyle(spacer).minWidth) : 0;
      const box = getComputedStyle(headline);
      return inner(slab) - (tally?.getBoundingClientRect().width ?? 0) - gap - px(box.paddingLeft) - px(box.paddingRight);
    };
    const full = fit(headline, headlineRoom, 0.4);
    if (full < 1 && slide.short && !short) {
      setShortAt(m.headline);
      return;
    }
    // In its own strip down to 90%; past that, the slab's whole length, down to 82%.
    delete detail.dataset.long;
    if (fit(subline, () => inner(detail), 0.9) < 0.9) {
      detail.dataset.long = "true";
      fit(subline, () => inner(detail), 0.82);
    }
  }, [slide, short, m, layers]);
  return short;
}

/**
 * Scales a line's type (`--fit`) until it fits `room`, to no less than
 * `least`; text doesn't scale exactly linearly, so it measures again after
 * each step. Returns how much of it fit at full size.
 */
function fit(el: HTMLElement, room: () => number, least: number): number {
  // Measured to the subpixel (scrollWidth rounds, and a text a fraction too wide is cut).
  const need = () => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getBoundingClientRect().width + 0.5;
  };
  el.style.setProperty("--fit", "1");
  const space = room();
  const first = Math.min(space / need(), 1);
  let scale = 1;
  for (let i = 0; i < 4; i++) {
    const ratio = space / need();
    if (ratio >= 1 || scale <= least) break;
    scale = Math.max(scale * ratio * 0.995, least);
    el.style.setProperty("--fit", String(scale));
  }
  return first;
}

/** The team's logo (its dark-background variant on a dark slab) or the climber's flag, in the slab's logo zone. */
function Mark({ slide, paint, set }: { slide: ScoringSlide; paint: SlidePaint; set: (el: HTMLElement | null) => void }) {
  const [failed, setFailed] = useState<string | null>(null);
  const logo = slide.team?.logo ?? null;
  const dark = paint.lightInk ? sizedLogo(darkLogo(logo), LOGO_BASE) : null;
  const regular = sizedLogo(logo, LOGO_BASE);
  const src = dark && failed !== dark ? dark : regular;
  return (
    <span className={styles.logo} ref={set}>
      {slide.flag ? (
        <span className={styles.flag}>{slide.flag}</span>
      ) : src ? (
        <img className={styles.logoImage} src={src} alt="" draggable={false} decoding="sync" onError={() => setFailed(src)} />
      ) : null}
    </span>
  );
}

// MARK: - Motion

const easing = (beat: SlideBeat) => `cubic-bezier(${SLIDE_CURVES[beat.curve].join(", ")})`;

/**
 * Starts each layer's move (data/scoringSlide.ts `SLIDE_IN`, `SLIDE_OUT`),
 * every one timed from now so the whole graphic shares one clock: WAAPI on
 * transform and opacity, and the reveals' clip. Returns the animations
 * (cancelled if the bar goes).
 */
function play(layers: Partial<Record<Layer, HTMLElement | null>>, leaving: boolean, reduceMotion: boolean, leading: boolean): Animation[] {
  const pt = pointSize();
  // Off toward the edge it came from.
  const sign = leading ? -1 : 1;
  const out: Animation[] = [];
  const run = (el: HTMLElement | null | undefined, beat: SlideBeat, keyframes: Keyframe[]) => {
    if (!el) return;
    el.getAnimations().forEach((a) => a.cancel());
    out.push(el.animate(keyframes, { delay: beat.at * 1000, duration: (beat.until - beat.at) * 1000, easing: easing(beat), fill: "both" }));
  };
  if (reduceMotion) {
    const fade = { at: 0, until: leaving ? SlideMotion.fadeOut : SlideMotion.fadeIn, curve: "out" } as const;
    run(layers.root, fade, leaving ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 0 }, { opacity: 1 }]);
    return out;
  }
  // Wholly off its entering edge, and a little more.
  const off = { transform: `translateX(calc(${sign * 100}% + ${sign * 48 * pt}px))` };
  const home = { transform: "translateX(0px)" };
  const popped = { transform: "scale(1)", opacity: 1 };
  if (leaving) {
    for (const layer of ["detail", "slab", "kicker"] as const) run(layers[layer], SLIDE_OUT[layer]!, [home, off]);
    run(layers.chip, SLIDE_OUT.chip!, [popped, { transform: "scale(0.85)", opacity: 0 }]);
    return out;
  }
  for (const layer of ["kicker", "slab", "detail"] as const) run(layers[layer], SLIDE_IN[layer], [off, home]);
  for (const layer of ["logo", "chip"] as const) run(layers[layer], SLIDE_IN[layer], [{ transform: "scale(0.45)", opacity: 0 }, popped]);
  run(layers.tally, SLIDE_IN.tally, [{ opacity: 0, transform: `translateY(${5 * pt}px)` }, { opacity: 1, transform: "translateY(0px)" }]);
  for (const layer of ["headline", "subline"] as const) {
    const el = layers[layer];
    if (el) run(el, SLIDE_IN[layer], reveal(el, leading, pt));
  }
  // One sheen across the slab, on the type's lean (its gradient's).
  run(layers.sheen, SLIDE_IN.sheen, [{ transform: "translateX(-100%)" }, { transform: "translateX(100%)" }]);
  return out;
}

/**
 * The type revealed behind a moving edge slanted on its own lean (top
 * further right, as the italic leans), travelling away from the side it came
 * in, as it settles the last few points behind it. The edge's foot runs from
 * before the type to past it; the shape keeps a little room either side for
 * the italic's overhang.
 */
function reveal(el: HTMLElement, leading: boolean, pt: number): Keyframe[] {
  const d = el.offsetHeight * SLIDE_LEAN;
  const pad = 12 * pt;
  const shape = (foot: string) =>
    leading
      ? `polygon(${-pad}px 0px, calc(${foot} + ${d}px) 0px, ${foot} 100%, ${-pad}px 100%)`
      : `polygon(calc(${foot} + ${d}px) 0px, calc(100% + ${pad}px) 0px, calc(100% + ${pad}px) 100%, ${foot} 100%)`;
  const before = `calc(0% - ${d + pad}px)`;
  const past = `calc(100% + ${pad}px)`;
  const [from, to] = leading ? [before, past] : [past, before];
  return [
    { clipPath: shape(from), transform: `translateX(${(leading ? -10 : 10) * pt}px)` },
    { clipPath: shape(to), transform: "translateX(0px)" },
  ];
}

// MARK: - Burst

/** Room around the bar for the confetti to fly into, above and below it (pt). */
const MARGIN = 130;
const SCALE = 1.7;

/**
 * The slide's celebration at its logo, as the logo pops: a spark for a big
 * score (in the type's color and the stripe's), and for the top tier the
 * confetti in the team's two colors, when the page's one burst is the
 * slide's. Through the page's rules (`cueFor`): the celebration level,
 * Reduce Motion (a soft bloom) and the cooldown. Drawn larger than a chart's
 * (the graphic is the stage). requestAnimationFrame only while it plays.
 */
function SlideBurst({ slide, paint, metrics, leading }: { slide: ScoringSlide; paint: SlidePaint; metrics: SlideMetrics; leading: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const level = useSettings((s) => s.celebrationLevel);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const toward = leading ? (-60 * Math.PI) / 180 : (-120 * Math.PI) / 180;
    // The logo: 42pt at the medium width, its center 43pt in from the graphic's entering edge, on the slab's middle.
    const logo = 42 * metrics.scale;
    let spark: CelebrationCue | null = null;
    if (slide.tier >= SlideTier.big) {
      // The rays start just clear of the logo and stop short of the headline.
      const base = (logo / 2 + 2) / SCALE;
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
    const inset = (22 * metrics.scale) + logo / 2;
    const x = leading ? inset : w - inset;
    const y = MARGIN + metrics.kicker + metrics.slab / 2;
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
