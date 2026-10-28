/**
 * The game page's hero (DetailView.swift `hero`, SharedUI.swift `HeroWash`,
 * Celebrations.swift's scoreboard beats): clear glass over the teams' colors,
 * crests with a soft glow, names that open the team's page, AP ranks,
 * possession, follow stars, records, the score (digits roll live) and the
 * status (a ticking clock or the inning, a countdown, the final word).
 *
 * The beats, as on the Mac (`HeroBeats` in data/matchRules.ts decides when):
 * - a score's digits pop (1 → 1.12 → 1) over a pill in the scorer's color
 *   that holds 1.6 s and fades over 1.2 s, while the hero (not the docked
 *   bar) is the scoreboard on screen;
 * - the scorer's side of the wash lifts and settles (1.55 s);
 * - a decisive score or the final whistle sweeps one glint across the card.
 * Full plays all of them; Subtle keeps the pill; Off keeps nothing that
 * moves. Reduce Motion: no pop, a slower wash, a quick pill, no glint.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { TeamLink, teamRefFrom } from "../../profiles/ProfileLinks";
import { GlassCard, Icon, LiveStatus, ScoreDigits, Skeleton, TeamLogo } from "../../../design/components";
import { glintProgress, pillOpacity, popScale, sample, washPulse } from "../../../data/celebrations";
import { countdown, countdownClock, dayAndTime, enDash, spokenStatus } from "../../../data/format";
import { dayKeyOf, mediumDayLabel } from "../../../data/days";
import type { HeroBeats, Surface } from "../../../data/matchRules";
import { stepsBack, type Competitor, type GameClock, type ScoreEvent, type Side } from "../../../data/models";
import { NEUTRAL, washStrength, type TeamPalette } from "../../../data/teamColors";
import { useNow } from "../../../state/clock";
import { settings, useIsFollowing, useSettings } from "../../../state/settings";
import { useColorScheme } from "../../../state/theme";
import { useMediaQuery, useReducedMotion } from "./useMedia";
import styles from "./Hero.module.css";

export interface HeroProps {
  readonly event: ScoreEvent;
  readonly palette: TeamPalette | null;
  /** The numbers the hero shows (a fast lane's, while it's ahead of the scoreboard). */
  readonly scores: { top: string | null; bottom: string | null };
  readonly beats: HeroBeats;
  readonly surface: Surface;
  /** What the clock line says without a running clock: the lane's inning, half-time. */
  readonly clockFallback: string;
  /** Under the clock: "MIL batting". */
  readonly liveSecond?: string | null;
  /** Live football or NBA: who has the ball. */
  readonly possession?: Side | null;
  /** NBA: a shot in the air (the ball dims, still the shooting team's). */
  readonly possessionInAir?: boolean;
  /** A state chip beside the live clock (CLUTCH: the last five minutes, within five). */
  readonly chip?: string | null;
  /** A line under the status in any state ("Agg 3–2 · Pens 4–3"). */
  readonly note?: string | null;
  readonly staleSince: number | null;
  /** The spoken summary, the page's heading. */
  readonly spoken: string;
  readonly caption: string | null;
  /** The live clock (a fast lane's reading, else the scoreboard's). */
  readonly clock?: GameClock | null;
  /** A trophy: beside a series winner's name, or before a decided final's winner line. */
  readonly trophy?: Side | "field" | null;
  /** Under the card (CS2: the co-streamer's badge). */
  readonly badge?: ReactNode;
  /** Wraps the card so the page can measure it (docking) and tuck it. */
  readonly heroRef?: React.Ref<HTMLDivElement>;
  readonly tuckRef?: React.Ref<HTMLDivElement>;
  /** Over the card, in its frame (the scoring slide's host). */
  readonly overlay?: ReactNode;
}

export function Hero({ event, palette, scores, beats, surface, clockFallback, clock, liveSecond, possession, possessionInAir = false, chip = null, note = null, staleSince, spoken, caption, trophy = null, badge = null, heroRef, tuckRef, overlay = null }: HeroProps) {
  const glint = useRef<HTMLSpanElement>(null);
  const level = useSettings((s) => s.celebrationLevel);
  const reduce = useReducedMotion();
  const dark = useColorScheme() === "dark";
  const first = useRef(beats.glints);

  // One sheen across the card: decisive, or the final whistle. Full only, never with Reduce Motion.
  useEffect(() => {
    if (beats.glints === first.current || surface !== "hero" || level !== "full" || reduce || !glint.current) return;
    const el = glint.current;
    const width = el.parentElement?.clientWidth ?? 0;
    el.animate(
      sample(glintProgress, 1).map(({ offset, value }) => ({ offset, transform: `translateX(${-44 + (width + 88) * value}px) rotate(18deg)`, opacity: value > 0 && value < 1 ? 1 : 0 })),
      { duration: 1000, easing: "linear" },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beats.glints]);

  const live = event.state === "live";
  const card =
    event.content.kind === "match" && palette ? (
      <div className={styles.hero}>
        <h1 className="visually-hidden">{spoken}</h1>
        {caption ? <p className={styles.caption}>{caption}</p> : null}
        <div className={styles.scoreboard}>
          <TeamColumn event={event} c={event.content.top} color={palette.top} hasBall={possession === "top"} inAir={possessionInAir} trophy={trophy === "top" ? beats.trophies : null} />
          <div className={styles.center}>
            {scores.top != null || scores.bottom != null ? (
              <span className={styles.score}>
                <BeatScore value={scores.top} live={live} dimmed={stepsBack(event, event.content.top)} pops={beats.pops.top} color={palette.top} active={surface === "hero"} />
                <span className={styles.dash}>–</span>
                <BeatScore value={scores.bottom} live={live} dimmed={stepsBack(event, event.content.bottom)} pops={beats.pops.bottom} color={palette.bottom} active={surface === "hero"} />
              </span>
            ) : null}
            <HeroStatus event={event} clock={clock ?? event.clock} stale={staleSince != null} fallback={clockFallback} second={liveSecond ?? null} ticking={surface === "hero"} chip={chip} />
            {note ? <span className={styles.note}>{note}</span> : null}
          </div>
          <TeamColumn event={event} c={event.content.bottom} color={palette.bottom} hasBall={possession === "bottom"} inAir={possessionInAir} trophy={trophy === "bottom" ? beats.trophies : null} />
        </div>
      </div>
    ) : event.content.kind === "field" ? (
      <div className={styles.fieldHero}>
        {event.caption ? <p className={styles.caption} style={{ padding: 0 }}>{event.caption}</p> : null}
        <h1 className={styles.fieldTitle}>{event.content.title}</h1>
        {event.content.summary ? (
          <p className={styles.fieldSummary}>
            {/* A final's winner ("Winner 🇸🇮 J. Garnbret"): a real trophy. */}
            {trophy === "field" ? <Trophy bounces={beats.trophies} /> : null}
            {event.content.summary}
          </p>
        ) : null}
        <div style={{ paddingTop: "calc(4 * var(--pt))" }}>
          <HeroStatus event={event} clock={clock ?? event.clock} stale={staleSince != null} fallback={clockFallback} second={null} ticking={surface === "hero"} />
        </div>
      </div>
    ) : null;

  return (
    <div className={styles.heroWrap} ref={heroRef}>
      <div className={styles.tuck} ref={tuckRef}>
        {/* The glass is a layer behind the card's content, not its container: a breathing live
            dot on top then never makes the compositor redo the blur under it every frame. */}
        <div className={styles.card}>
          <GlassCard variant="clear" className={styles.cardGlass} aria-hidden="true" />
          <div className={styles.cardContent}>{card}</div>
          <span className={styles.glintClip} aria-hidden="true">
            <span ref={glint} className={styles.glint} style={{ "--glint": dark ? 0.22 : 0.4 } as React.CSSProperties} />
          </span>
          {overlay}
        </div>
        {badge}
        {staleSince != null ? (
          <p className={styles.stale}>
            <Icon name="wifiSlash" size={10} />
            Can't connect · Updated {new Date(staleSince).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A side's number. On a score it pops over a pill in the scorer's color; the
 * pill stays still while the digits move. Plays only on the surface that's
 * the scoreboard on screen (the hero until the bar is half docked).
 */
export function BeatScore({ value, live, dimmed, pops, color, active, className }: {
  value: string | null;
  live: boolean;
  dimmed: boolean;
  pops: number;
  color: string;
  active: boolean;
  className?: string;
}) {
  const number = useRef<HTMLSpanElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const level = useSettings((s) => s.celebrationLevel);
  const reduce = useReducedMotion();
  const seen = useRef(pops);
  useEffect(() => {
    if (pops === seen.current) return;
    seen.current = pops;
    if (!active) return;
    if (level === "full" && !reduce && number.current) {
      number.current.animate(
        sample((t) => popScale(t, 1.12), 0.5).map(({ offset, value: s }) => ({ offset, transform: `scale(${s})` })),
        { duration: 500, easing: "linear" },
      );
    }
    if (level !== "off" && pill.current) {
      const fade = reduce ? 0.3 : 1.2;
      const total = 1.75 + fade;
      pill.current.getAnimations().forEach((a) => a.cancel());
      pill.current.animate(
        sample((t) => pillOpacity(t, 1, fade), total, 30).map(({ offset, value: o }) => ({ offset, opacity: o })),
        { duration: total * 1000, easing: "linear" },
      );
    }
  }, [pops, active, level, reduce]);
  const tint = color === NEUTRAL ? "color-mix(in srgb, var(--label) 10%, transparent)" : `color-mix(in srgb, ${color} 18%, transparent)`;
  return (
    <span className={[styles.beat, className].filter(Boolean).join(" ")}>
      <span ref={pill} className={styles.pill} style={{ background: tint }} aria-hidden="true" />
      <span ref={number} className={styles.beatNumber}>
        <ScoreDigits value={value} live={live} dimmed={dimmed} flash={false} />
      </span>
    </span>
  );
}

/**
 * The winner's trophy (DetailView.trophy): arrives like a badge and bounces
 * once each time one is won on this page. Still at Off and with Reduce Motion.
 */
function Trophy({ bounces }: { bounces: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const level = useSettings((s) => s.celebrationLevel);
  const reduce = useReducedMotion();
  const seen = useRef(bounces);
  useEffect(() => {
    if (bounces === seen.current) return;
    seen.current = bounces;
    if (level === "off" || reduce || !ref.current) return;
    ref.current.animate(
      sample((t) => popScale(t, 1.3), 0.5).map(({ offset, value }) => ({ offset, transform: `scale(${value})` })),
      { duration: 500, easing: "linear" },
    );
  }, [bounces, level, reduce]);
  return (
    <span ref={ref} className={styles.trophy} title="Winner">
      <Icon name="trophy" size={9} label="Winner" />
    </span>
  );
}

function TeamColumn({ event, c, color, hasBall, inAir = false, trophy = null }: { event: ScoreEvent; c: Competitor; color: string; hasBall: boolean; inAir?: boolean; trophy?: number | null }) {
  const following = useIsFollowing(c.id);
  const glow = color === NEUTRAL ? "var(--viz-neutral)" : color;
  const g = (pct: number) => `color-mix(in srgb, ${glow} ${pct}%, transparent)`;
  const name = <span className={[styles.name, stepsBack(event, c) ? styles.dimmed : null].filter(Boolean).join(" ")}>{c.name}</span>;
  return (
    <div className={styles.team}>
      <span className={styles.crest}>
        <span className={styles.glow} style={{ background: `radial-gradient(circle, ${g(35)} 0%, ${g(33)} 25%, ${g(17)} 34%, ${g(5)} 42%, transparent 50%)` }} aria-hidden="true" />
        <TeamLogo url={c.logo} size={34} />
      </span>
      <span className={styles.nameLine}>
        {c.rank != null ? <span className={styles.rank}>{c.rank}</span> : null}
        {/* The name opens the team's page: plain at rest, underlined under the pointer; a resting pointer prefetches it. */}
        {c.id ? (
          <TeamLink team={teamRefFrom(c, null)} variant="plain" className={styles.nameLink}>
            {name}
          </TeamLink>
        ) : (
          name
        )}
        {hasBall ? <Icon name={event.ref?.kind === "espn" && event.ref.sport === "basketball" ? "basketball" : "football"} size={8} className={styles.ball} label={inAir ? "Shot in the air" : "Has the ball"} style={{ opacity: inAir ? 0.55 : 1, transition: "opacity var(--dur-fade) var(--ease-out)" }} /> : null}
        {trophy != null ? <Trophy bounces={trophy} /> : null}
        {c.id ? (
          <button
            type="button"
            className={styles.follow}
            aria-pressed={following}
            aria-label={following ? `Unfollow ${c.name}` : `Follow ${c.name}`}
            title={following ? `Unfollow ${c.name}` : `Follow ${c.name}`}
            onClick={() => settings.toggleFollow({ id: c.id!, name: c.name, logo: c.logo })}
          >
            <Icon name={following ? "star" : "starOutline"} size={9} />
          </button>
        ) : null}
      </span>
      {c.record ? <span className={styles.record}>{[enDash(c.record), c.conferenceRecord ? `${enDash(c.conferenceRecord)} conf` : null].filter(Boolean).join(" · ")}</span> : null}
    </div>
  );
}

/** When a finished game was played: "Today", "Yesterday", "Sat, Oct 24" within ten months, else "May 19, 2024" (DetailView.playedOn). */
export function playedOn(start: number, now = Date.now()): string {
  const days = Math.round((dayStart(now) - dayStart(start)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (Math.abs(days) < 300) return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(start);
  return mediumDayLabel(dayKeyOf(start));
}

const dayStart = (ms: number) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** Live: the dot and clock (or the inning). Scheduled: a countdown inside a day, then the day and time. Final: the word and the date. */
function HeroStatus({ event, clock, stale, fallback, second, ticking, chip = null }: { event: ScoreEvent; clock: GameClock | null; stale: boolean; fallback: string; second: string | null; ticking: boolean; chip?: string | null }) {
  const soon = event.state === "scheduled" && event.start - Date.now() < 86_400_000;
  // The countdown ticks while the hero is the scoreboard on screen (the bar ticks instead).
  const now = useNow(soon && ticking ? 1000 : 30_000, event.state === "scheduled");
  switch (event.state) {
    case "live":
      return (
        <div className={styles.status}>
          {/* Breathes only while the hero is the scoreboard on screen (the bar's dot takes over). */}
          <span className={styles.liveLine}>
            <LiveStatus clock={clock} fallback={fallback} size={11.5} animated={!stale && ticking} />
            {chip ? (
              <span className={styles.chip} title={chip === "CLUTCH" ? "Last 5 minutes, within 5 points" : undefined}>
                {chip}
              </span>
            ) : null}
          </span>
          {second ? <span className={styles.statusSecond}>{second}</span> : null}
        </div>
      );
    case "scheduled": {
      const clock = countdownClock(event.start, now);
      return (
        <div className={styles.status}>
          {event.detail === "Delayed" && event.start < now ? (
            <span className={styles.finalWord} style={{ color: "var(--delayed-text)" }}>
              Delayed
            </span>
          ) : clock ? (
            <span className={styles.countdown}>Starts in {clock}</span>
          ) : (
            <span className={styles.countdown}>{countdown(event.start, now) ?? "Upcoming"}</span>
          )}
          <span className={styles.statusSecond}>{dayAndTime(event.start, now)}</span>
        </div>
      );
    }
    case "final":
      return (
        <div className={styles.status}>
          <span className={styles.finalWord}>{spokenStatus(event.detail ?? "Final")}</span>
          <span className={styles.statusSecond}>{playedOn(event.start)}</span>
        </div>
      );
  }
}

/**
 * The team colors behind the page's top, melting into the page (HeroWash).
 * A score lifts the scorer's side for 1.55 s (both sides when `washSide` is
 * null): a second layer whose opacity rises and settles, on the compositor.
 */
export function HeroWash({ palette, pulses, side, intensity: paletteIntensity = 1, crossfade = false }: {
  palette: TeamPalette | null;
  pulses: number;
  side: Side | null;
  intensity?: number;
  /** A new set of colors crossfades in (a field event's climber changing); otherwise it's replaced at once. */
  crossfade?: boolean;
}) {
  const level = useSettings((s) => s.celebrationLevel);
  const reduce = useReducedMotion();
  const reduceTransparency = useMediaQuery("(prefers-reduced-transparency: reduce)");
  const left = palette?.top ?? "var(--accent)";
  const right = palette?.bottom ?? "var(--accent)";
  // A field event's flag washes a little softer (0.85); with nobody to follow, the accent at 0.6.
  const intensity = palette ? paletteIntensity : 0.6;
  const strength = (c: string) => Math.round((c.startsWith("#") ? washStrength(c, intensity) : 0.6 * intensity) * 100);
  const mix = (c: string, pct: number) => `color-mix(in srgb, ${c === NEUTRAL ? "var(--viz-neutral)" : c} ${pct}%, transparent)`;
  const inner = Math.round(12 * intensity);
  const topPulse = useRef<HTMLDivElement>(null);
  const bottomPulse = useRef<HTMLDivElement>(null);
  const seen = useRef(pulses);
  useEffect(() => {
    if (pulses === seen.current) return;
    seen.current = pulses;
    const amplitude = level === "full" ? (reduceTransparency ? 0.5 : 1) : 0;
    if (amplitude === 0) return;
    const rise = reduce ? 0.4 : 0.25;
    const total = rise + 1.3;
    const frames = sample((t) => washPulse(t, rise) * amplitude, total, 30).map(({ offset, value }) => ({ offset, opacity: value }));
    for (const [layer, s] of [
      [topPulse.current, "top"],
      [bottomPulse.current, "bottom"],
    ] as const) {
      if (layer && (side == null || side === s)) layer.animate(frames, { duration: total * 1000, easing: "linear" });
    }
  }, [pulses, side, level, reduce, reduceTransparency]);
  const boost = (c: string) => Math.round(strength(c) * 0.35);
  return (
    <div className={styles.wash} aria-hidden="true">
      <div className={styles.washBase} />
      <WashColors crossfade={crossfade} gradient={`linear-gradient(to right, ${mix(left, strength(left))}, ${mix(left, inner)}, ${mix(right, inner)}, ${mix(right, strength(right))})`} />
      <div ref={topPulse} className={styles.washPulse} style={{ background: `linear-gradient(to right, ${mix(left, boost(left))}, ${mix(left, Math.round(inner * 0.35))} 33%, transparent 50%)` }} />
      <div ref={bottomPulse} className={styles.washPulse} style={{ background: `linear-gradient(to left, ${mix(right, boost(right))}, ${mix(right, Math.round(inner * 0.35))} 33%, transparent 50%)` }} />
    </div>
  );
}

/**
 * The wash's colors. A new set (a new climber's flag, a crest's colors
 * arriving) crossfades in over the old one like a change of light (0.9 s,
 * ease-in-out; a quick fade with Reduce Motion), never a cut. The first
 * set paints at once.
 */
function WashColors({ gradient, crossfade }: { gradient: string; crossfade: boolean }) {
  const [layers, setLayers] = useState(() => [{ key: 0, gradient }]);
  const last = layers.at(-1)!;
  if (last.gradient !== gradient) setLayers((ls) => (crossfade ? [...ls.slice(-1), { key: last.key + 1, gradient }] : [{ key: last.key + 1, gradient }]));
  return (
    <>
      {layers.map((layer, i) => (
        <div
          key={layer.key}
          className={styles.washColors}
          data-entering={i > 0 || undefined}
          style={{ background: layer.gradient }}
          onAnimationEnd={i > 0 ? () => setLayers((ls) => ls.filter((l) => l.key >= layer.key)) : undefined}
        />
      ))}
    </>
  );
}

export function HeroSkeleton({ children }: { children?: ReactNode }) {
  return (
    <div className={styles.heroWrap}>
      <GlassCard variant="clear">
        <div className={styles.hero} role="status" aria-label="Loading game">
          <Skeleton width={120} height={8} />
          <div className={styles.scoreboard} style={{ gap: "calc(40 * var(--pt))", padding: "calc(8 * var(--pt)) 0" }}>
            <Skeleton circle width={34} height={34} />
            <Skeleton width={70} height={24} />
            <Skeleton circle width={34} height={34} />
          </div>
        </div>
      </GlassCard>
      {children}
    </div>
  );
}
