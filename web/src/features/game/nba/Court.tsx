/**
 * The shot chart (BasketballViews.swift `CourtView`, BasketballReplay.swift,
 * BasketballCelebrations.swift): a full court, side on, every field-goal
 * attempt where it was taken, makes filled in the team's color and misses as
 * rings. The top team shoots at the right basket.
 *
 * - Live, the last plays trail to the ball (it glides from play to play),
 *   with an arrow at center court for who has it (dimmed while a shot is in
 *   the air). Each new shot tells its story: a swish, a rim-out, a stuff, a
 *   slam (data/basketball.ts `courtStory`, ./courtDraw.ts `drawStory`), and
 *   the celebration stage plays its beat at the rim.
 * - Under the court a scrubber replays the game shot by shot (24 seconds for
 *   regulation); a player picked in the box score or leaders narrows it to
 *   their shots. A shot, a quarter's cell, a player's row or a moment in the
 *   game flow lights the shots it means.
 *
 * Cost: the lines, the shots and the lit shots are three canvases redrawn
 * only when what they show changes; a running replay redraws the shots on
 * each frame from the stage's one requestAnimationFrame loop, with no React
 * render; a story's canvas runs only while it plays.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  arcDuration,
  backboard,
  ballPoint,
  clockLabel,
  clockLabelAt,
  countThrough,
  courtScene,
  courtStory,
  holdsShot,
  isShotPlay,
  litShots,
  madeOf,
  periodName,
  periodStart,
  periodsPlayed,
  plain,
  playerLine,
  playLabel,
  playPoint,
  positioned,
  rim,
  scoreLine,
  shooting,
  shootingOf,
  short,
  shotPoint,
  shotText,
  spanLabel,
  throughTime,
  lastName,
  FIRE_STREAK,
  type BoxPlayer,
  type CourtPlay,
  type CourtStory,
  type Shot,
} from "../../../data/basketball";
import { seed, sparks, type Effect } from "../../../data/celebrations";
import type { Side } from "../../../data/models";
import type { LiveMoment } from "../../../data/moments";
import { runLabel, runSpan, type Run } from "../../../data/liveFeeds/basketball";
import { NEUTRAL, type TeamPalette } from "../../../data/teamColors";
import { useSettings } from "../../../state/settings";
import { useColorScheme } from "../../../state/theme";
import { Icon } from "../../../design/components";
import { PlayerLink, type PlayerRef } from "../../profiles/ProfileLinks";
import { colorResolver, fitCanvas } from "../core/canvasColors";
import { CelebrationStage } from "../core/CelebrationStage";
import { ChartFooter, Legend, LegendItem, VizWell, type Readout } from "../core/DetailSection";
import { useFocus, useLinkedMarks, useLinkedStore, type Focus } from "../core/linked";
import { useChartMoment } from "../core/moments";
import { pointSize, useReducedMotion } from "../core/useMedia";
import { courtFrame, drawLit, drawMarkings, drawScene, drawStory, RECEDED, sideInk, trailAlpha, type CourtInk, type StoryGeometry } from "./courtDraw";
import { ReplayScrubber, type ScrubberHandle } from "./ReplayScrubber";
import { REPLAY_RATE, useStage, useStageStore } from "./stage";
import styles from "./Court.module.css";

/** The court fills the width until it's this tall, then centres with its footer. */
const MAX_PLOT_HEIGHT = 280;
const ASPECT = 94 / 50;

export interface CourtProps {
  readonly shots: readonly Shot[];
  /** Every play in game order: the live trail, who has the ball, and the replay. */
  readonly plays: readonly CourtPlay[];
  readonly palette: TeamPalette;
  readonly topName: string;
  readonly bottomName: string;
  readonly spokenTop: string;
  readonly spokenBottom: string;
  /** Box score lines by athlete ID, for a player's shooting line. */
  readonly players: ReadonlyMap<string, BoxPlayer>;
  /** Names by athlete ID for players the box score doesn't list yet. */
  readonly names: Readonly<Record<string, string>>;
  readonly live: boolean;
  /** Game seconds played, while live: the replay reaches this far. */
  readonly now: number | null;
  readonly quarter: number;
  /** The live lane: players on fire, ESPN's run. */
  readonly streaks: Readonly<Record<string, number>>;
  readonly runs: readonly Run[];
  readonly playerRef: (id: string, name: string) => PlayerRef | null;
  /** The section's width in points (each team's shooting shows from large). */
  readonly width: number;
}

/** The first version of each play shown (an edit plays only what it added), and those that arrived while replaying, narrowed or pointed at. Deliberately not state. */
interface Memory {
  shown: LiveMoment[];
  quiet: Set<string>;
}

const EFFECTS: Readonly<Record<string, Effect>> = {
  swish: { kind: "swish", echo: false },
  swishEcho: { kind: "swish", echo: true },
  rimPulse: { kind: "rimPulse" },
  embers: { kind: "embers" },
  echo: { kind: "echo" },
  sparks: sparks(6, 13),
};

/** Which way a buzzer-beater's confetti flies from the rim: up, leaning into the court. */
const confettiDirection = (side: Side | null) => ((side === "bottom" ? -70 : -110) * Math.PI) / 180;

export const Court = memo(function Court(props: CourtProps) {
  const { shots, plays, palette, topName, bottomName, spokenTop, spokenBottom, players, names, live, now, quarter, streaks, runs, playerRef, width } = props;
  const stage = useStageStore();
  const pinned = useStage(stage, (s) => s.pinned);
  const paused = useStage(stage, (s) => s.paused);
  const playback = useStage(stage, (s) => s.playback);
  const level = useSettings((s) => s.celebrationLevel);
  const reduce = useReducedMotion();
  const scheme = useColorScheme();
  const linked = useLinkedStore();
  const moment = useChartMoment("court");

  const box = useRef<HTMLDivElement>(null);
  const markings = useRef<HTMLCanvasElement>(null);
  const base = useRef<HTMLCanvasElement>(null);
  const lit = useRef<HTMLCanvasElement>(null);
  const storyCanvas = useRef<HTMLCanvasElement>(null);
  const latestLine = useRef<HTMLSpanElement>(null);
  const scrubber = useRef<ScrubberHandle | null>(null);
  const memory = useRef<Memory>({ shown: [], quiet: new Set() });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [scrubHover, setScrubHover] = useState<number | null>(null);
  const [landed, setLanded] = useState<string | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => setSize((s) => (s.width === el.clientWidth && s.height === el.clientHeight ? s : { width: el.clientWidth, height: el.clientHeight }));
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (stage) stage.stepped = reduce;
  const pt = pointSize();
  const frame = useMemo(() => courtFrame(size.width, pt), [size.width, pt]);

  // Regulation, plus any overtime played (or started, live).
  const periods = periodsPlayed(Math.max(plays.at(-1)?.period ?? 1, shots.at(-1)?.period ?? 1), now, quarter);
  const gameLength = periodStart(periods + 1, quarter);
  const replayEnd = live ? Math.min(Math.max(now ?? 0, plays.at(-1)?.elapsed ?? 0), gameLength) : gameLength;
  const replayable = plays.length > 1;
  const playing = playback != null;
  // React's time: a held replay's, or where a running one started (frames take it from there).
  const time = paused ?? (playback ? (stage?.time() ?? playback.from) : null);
  const scene = useMemo(() => courtScene(shots, plays, time, live, playing, pinned), [shots, plays, time, live, playing, pinned]);

  const ink = useMemo<CourtInk | null>(() => {
    const el = base.current;
    if (!el || size.width === 0) return null;
    const resolve = colorResolver(el, scheme);
    const team = (c: string) => resolve(c === NEUTRAL ? "var(--viz-neutral)" : c);
    return {
      top: team(palette.top),
      bottom: team(palette.bottom),
      neutral: resolve("var(--viz-neutral)"),
      label: resolve("var(--label)"),
      markings: resolve("color-mix(in srgb, var(--label) 16%, transparent)"),
      reference: resolve("var(--viz-reference)"),
      track: resolve("var(--viz-track)"),
      page: resolve("var(--page)"),
    };
  }, [scheme, palette, size.width]);

  // The story for the page's moment: never in a replay, for one player, or once it was quiet.
  const pointing = useFocus((f) => f != null);
  const story: CourtStory | null = useMemo(() => {
    if (!moment || time != null || pinned != null || memory.current.quiet.has(moment.id)) return null;
    const first = memory.current.shown.find((m) => m.id === moment.id) ?? null;
    return courtStory(moment, first, scene.shots);
  }, [moment, time, pinned, scene.shots]);
  const storyPlaying = story != null && story.kind != null && landed !== story.key;
  const holding = storyPlaying && story != null && holdsShot(story);
  const held = !pointing && holding ? (story?.shot?.id ?? null) : null;

  // Remember each moment as it arrives (after the story above has read the memory).
  useEffect(() => {
    if (!moment) return;
    const m = memory.current;
    if (!m.shown.some((x) => x.id === moment.id)) {
      m.shown.push(moment);
      if (m.shown.length > 16) m.shown.splice(0, m.shown.length - 16);
    }
    if ((stage?.replaying ?? false) || stage?.get().pinned != null || linked?.focus() != null) {
      if (m.quiet.size > 32) m.quiet.clear();
      m.quiet.add(moment.id);
    }
  }, [moment, stage, linked]);

  // The lines: when the size or theme changes.
  useLayoutEffect(() => {
    const canvas = markings.current;
    if (!canvas || !ink || size.width === 0) return;
    const fit = fitCanvas(canvas);
    if (fit) drawMarkings(fit.ctx, fit.width, fit.height, ink, pt);
  }, [ink, size, pt]);

  // The shots and the trail: when what they show changes; each frame of a running replay.
  const paint = useCallback(
    (t: number | null, running: boolean) => {
      const canvas = base.current;
      if (!canvas || !ink || size.width === 0) return;
      const sc = running ? courtScene(shots, plays, t, live, true, pinned) : scene;
      const fit = fitCanvas(canvas);
      if (fit) drawScene(fit.ctx, sc, frame, ink, t, REPLAY_RATE, held);
      if (running) {
        scrubber.current?.show(t, sc.score ? scoreLine(sc.score.top, sc.score.bottom, topName, bottomName) : "");
        const latest = sc.latest;
        if (latestLine.current && latest) latestLine.current.textContent = `${clockLabel(latest.period, latest.clock)}  ${plain(latest.text).replaceAll("-foot ", "-ft ")}`;
      }
    },
    [ink, size.width, shots, plays, live, pinned, scene, frame, held, topName, bottomName],
  );
  useLayoutEffect(() => paint(time, false), [paint, time]);
  useEffect(() => stage?.onFrame((t) => paint(t, true)), [stage, paint]);

  // Shots picked out by the focus, on their own layer; the rest step back.
  const focusKey = useFocus((f) => (f ? `${f.play ?? ""}|${f.player ?? ""}|${f.period ?? ""}|${f.side ?? ""}|${f.span?.join("-") ?? ""}` : null));
  const focus = useFocus((f) => f);
  const picked = useMemo(() => litShots(scene.shots, focus), [focusKey, scene.shots]); // eslint-disable-line react-hooks/exhaustive-deps
  const litPlay = useMemo(() => (focus?.play && picked.length === 0 ? (scene.trail.findLast((p) => p.id === focus.play && !isShotPlay(p)) ?? null) : null), [focusKey, scene.trail]); // eslint-disable-line react-hooks/exhaustive-deps
  const dimmed = picked.length > 0 || litPlay != null;
  useLayoutEffect(() => {
    const canvas = lit.current;
    if (!canvas || !ink || size.width === 0) return;
    const fit = fitCanvas(canvas);
    if (fit && dimmed) drawLit(fit.ctx, picked, litPlay, frame, ink, focus?.play != null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, litPlay, ink, frame, size, dimmed]);

  // The story's canvas: mounted work only while it plays.
  const storyKey = storyPlaying ? story!.key : null;
  useEffect(() => {
    const canvas = storyCanvas.current;
    if (!story || !storyKey || !story.kind || !story.shot || !canvas || !ink || size.width === 0) return;
    const shot = story.shot;
    const spot = frame.map(shotPoint(shot));
    const index = scene.trail.findIndex((p) => p.id === shot.id);
    let rest: StoryGeometry["rest"] = { grow: 1, alpha: scene.style === "trail" ? RECEDED : 1, end: null };
    if (index >= 0) {
      const play = scene.trail[index]!;
      const newestShot = scene.trail.findLast(isShotPlay)?.id;
      const end = ballPoint(play);
      const p = playPoint(play);
      rest = { grow: play.id === newestShot ? 1.3 : 1, alpha: trailAlpha(index, scene.trail.length), end: end && p && (end.x !== p.x || end.y !== p.y) ? frame.map(end) : null };
    }
    const last = scene.trail.at(-1);
    const ballAt = last ? ballPoint(last) : null;
    const bb = backboard(shot.side);
    const geometry: StoryGeometry = {
      kind: story.kind,
      made: shot.made,
      spot,
      rim: frame.map(rim(shot.side)),
      color: sideInk(ink, shot.side),
      blocker: sideInk(ink, shot.side === "top" ? "bottom" : shot.side === "bottom" ? "top" : null),
      backboard: [frame.map(bb[0]), frame.map(bb[1])],
      seed: seed(story.key),
      rest,
      lands: story.lands,
      ball: holdsShot(story) && ballAt ? frame.map(ballAt) : null,
    };
    const duration = arcDuration(story.kind, reduce);
    const start = performance.now();
    let raf = 0;
    const draw = (nowMs: number) => {
      const t = (nowMs - start) / 1000;
      const fit = fitCanvas(canvas);
      if (fit) drawStory(fit.ctx, geometry, t, level, reduce, ink, pt);
      if (t < duration) raf = requestAnimationFrame(draw);
      else {
        fitCanvas(canvas);
        setLanded(storyKey);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      fitCanvas(canvas);
    };
    // One run per story; the geometry is read as it starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyKey]);

  // Hover targets: the shots drawn, and the trail's other plays.
  const targets = useMemo(() => {
    const list: { x: number; y: number; focus: Focus }[] = scene.shots.map((s) => ({ ...frame.map(shotPoint(s)), focus: { play: s.id, period: s.period ?? undefined, side: s.side, player: s.player ?? undefined } }));
    for (const p of scene.trail) {
      if (isShotPlay(p)) continue;
      const at = playPoint(p);
      if (at) list.push({ ...frame.map(at), focus: { play: p.id, period: p.period ?? undefined, side: p.side, player: p.player ?? undefined } });
    }
    return list;
  }, [scene, frame]);
  const hover = useLinkedMarks(targets, (i) => targets[i]!.focus);

  const color = (side: Side | null) => (side === "top" ? palette.top : side === "bottom" ? palette.bottom : NEUTRAL);
  const css = (c: string) => (c === NEUTRAL ? "var(--viz-neutral)" : c);
  const name = (side: Side) => (side === "top" ? topName : bottomName);
  const playerName = (id: string) => players.get(id)?.name ?? names[id] ?? "Player";

  // The ball at the newest play (stepping aside while a story carries it), and who has it.
  const lastPlay = scene.trail.at(-1);
  const ballAt = lastPlay ? ballPoint(lastPlay) : null;
  const ballPx = ballAt && size.width > 0 ? frame.map(ballAt) : null;
  const ballAway = !pointing && holding;
  const wait = story && holding && story.kind ? throughTime(story.kind, reduce) : 0;
  const snap = story?.moment.kind === "steal";
  const center = frame.map({ x: 47, y: 25 });
  const rimPx = story ? frame.map(rim(story.side)) : null;

  const playPause = () => {
    if (!stage) return;
    if (playing) return stage.pause();
    // From where it's held; from tip-off when it isn't, or when it's at the end.
    const from = time != null && time < replayEnd - 1 ? time : 0;
    stage.play(from, replayEnd);
  };

  // Footer: the scrubber's time and score; else the pointed-at shot or play; a player's or a quarter's shooting.
  const readout = ((): Readout | null => {
    if (scrubHover != null) {
      const upTo = plays.slice(0, countThrough(plays, scrubHover));
      const last = upTo.at(-1);
      return { lead: scoreLine(last?.top ?? 0, last?.bottom ?? 0, topName, bottomName), detail: clockLabelAt(scrubHover, quarter) };
    }
    if (!focus) return null;
    if (focus.play != null) {
      const shot = scene.shots.find((s) => s.id === focus.play) ?? shots.find((s) => s.id === focus.play);
      if (shot) {
        const shooter = shot.player ? (players.get(shot.player)?.name ?? names[shot.player] ?? null) : null;
        return { lead: `${shot.made ? "Made" : "Missed"} ${shot.value}`, detail: `${clockLabel(shot.period, shot.clock)} · ${shotText(shot.text, shooter)}` };
      }
      const play = scene.trail.findLast((p) => p.id === focus.play);
      return play ? { lead: playLabel(play), detail: `${clockLabel(play.period, play.clock)} · ${short(play.text)}` } : null;
    }
    if (focus.player != null) {
      const box = players.get(focus.player);
      const fg = madeOf(box?.stats.FG);
      if (box && fg) return { lead: playerName(focus.player), detail: shooting(fg, madeOf(box.stats["3PT"]) ?? [0, 0]) };
      return { lead: playerName(focus.player), detail: shootingOf(shots.filter((s) => s.player === focus.player)) };
    }
    if (focus.span) {
      const mine = litShots(scene.shots, focus);
      const run = runs.find((r) => runSpan(r)[0] === focus.span![0] && runSpan(r)[1] === focus.span![1]);
      const lead = run ? `${name(run.team)} ${runLabel(run)}` : focus.side ? `${name(focus.side)} run` : "Run";
      return { lead, detail: `${mine.filter((s) => s.made).length} of ${mine.length} · ${spanLabel(focus.span, quarter)}` };
    }
    if (focus.period != null) {
      const label = periodName(focus.period);
      if (focus.side) return { lead: label, detail: `${name(focus.side)} ${shootingOf(scene.shots.filter((s) => s.period === focus.period && s.side === focus.side))}` };
      const both = (["top", "bottom"] as const).map((s) => {
        const mine = scene.shots.filter((x) => x.period === focus.period && x.side === s);
        return `${name(s)} ${mine.filter((x) => x.made).length} of ${mine.length}`;
      });
      return { lead: label, detail: both.join(" · ") };
    }
    return null;
  })();

  // A picked player's line: the box score's, or the plays' up to the replay's moment.
  const pinnedNumbers = (id: string) => {
    const box = players.get(id);
    const fg = madeOf(box?.stats.FG);
    if (time == null && box && fg) return { fg, threes: madeOf(box.stats["3PT"]) ?? ([0, 0] as [number, number]), points: Number(box.stats.PTS ?? 0) || 0 };
    return playerLine(id, time != null ? plays.slice(0, countThrough(plays, time)) : plays);
  };
  const streak = pinned && live && time == null ? (streaks[pinned] ?? 0) : 0;

  const spoken = (side: Side) => (side === "top" ? spokenTop : spokenBottom);
  const label = (() => {
    if (pinned) {
      const n = pinnedNumbers(pinned);
      return `Shot chart, ${playerName(pinned)} only: ${shooting(n.fg, n.threes)}, ${n.points} points.`;
    }
    const parts = (["top", "bottom"] as const).map((s) => `${spoken(s)}: ${shootingOf(scene.shots.filter((x) => x.side === s))}`);
    if (time != null && scene.score) parts.unshift(`Replay at ${clockLabelAt(time, quarter)}, ${scoreLine(scene.score.top, scene.score.bottom, topName, bottomName)}`);
    if (scene.latest && (live || time != null)) parts.push(`Latest: ${plain(scene.latest.text)}`);
    if (scene.ball.side) parts.push(scene.ball.inAir ? `${spoken(scene.ball.side)} shot, ball in the air` : `${spoken(scene.ball.side)} ball`);
    return `Shot chart. ${parts.join(". ")}.`;
  })();

  const scoreText = scene.score ? scoreLine(scene.score.top, scene.score.bottom, topName, bottomName) : "";
  const latest = scene.latest;
  return (
    <div className={styles.court} style={{ maxWidth: `calc(${MAX_PLOT_HEIGHT * ASPECT + 20} * var(--pt))` }}>
      <VizWell>
        <div ref={box} className={styles.plot} style={{ aspectRatio: `${94} / ${50}` }} role="img" aria-label={label} {...hover}>
          <canvas ref={markings} className={styles.layer} />
          <canvas ref={base} className={styles.layer} data-receded={dimmed} />
          <canvas ref={lit} className={styles.layer} />
          {ballPx ? (
            <span
              className={styles.ball}
              data-glide={time == null && !reduce}
              style={{ transform: `translate(${ballPx.x}px, ${ballPx.y}px)`, opacity: ballAway ? 0 : dimmed ? RECEDED : 1 }}
              aria-hidden="true"
            />
          ) : null}
          {scene.ball.side ? (
            <span
              className={styles.chevron}
              data-side={scene.ball.side}
              data-reduce={reduce}
              style={{
                transform: `translate(${center.x}px, ${center.y}px)`,
                opacity: (scene.ball.inAir ? RECEDED : 1) * (dimmed ? RECEDED : 1),
                color: css(color(scene.ball.side)),
                "--turn": scene.ball.side === "top" ? "0deg" : "180deg",
                "--wait": `${wait * 1000}ms`,
                "--sweep": snap ? "200ms" : "300ms",
              } as React.CSSProperties}
              title={`${name(scene.ball.side)} ${scene.ball.inAir ? "shot in the air" : "ball"} · attacking ${scene.ball.side === "top" ? "→" : "←"}`}
              aria-hidden="true"
            >
              <span className={styles.arm} data-dir="top">
                <span className={styles.arrow} />
              </span>
              {reduce ? (
                <span className={styles.arm} data-dir="bottom">
                  <span className={styles.arrow} />
                </span>
              ) : null}
            </span>
          ) : null}
          <canvas ref={storyCanvas} className={styles.layer} data-hidden={pointing} />
          {story?.moment.kind === "steal" ? <span key={`${story.key}-ping`} className={styles.ping} style={{ transform: `translate(${center.x}px, ${center.y}px)`, color: css(color(story.side)) }} aria-hidden="true" /> : null}
          {story && rimPx && time == null ? (
            <CelebrationStage
              key={`${story.key}-stage`}
              moment={story.moment}
              origin={rimPx}
              colors={{ primary: color(story.side) }}
              direction={confettiDirection(story.side)}
              effects={story.effects ? story.effects.map((e) => EFFECTS[e]!) : undefined}
            />
          ) : null}
          {scene.shots.length === 0 && (live || pinned != null) ? <p className={styles.empty}>{pinned == null ? "Shots appear here as they're taken." : "No shots yet."}</p> : null}
        </div>
      </VizWell>
      {replayable ? (
        <ReplayScrubber
          length={gameLength}
          end={replayEnd}
          live={live}
          time={time}
          playing={playing}
          score={scoreText}
          periods={periods}
          quarter={quarter}
          onSeek={(t) => stage?.seek(t, replayEnd)}
          onPlayPause={playPause}
          onHover={setScrubHover}
          handle={scrubber}
        />
      ) : null}
      <ChartFooter readout={readout} moment={time == null && pinned == null ? moment : null}>
        <div className={styles.footer}>
          {pinned ? (
            <PinnedLine
              name={playerName(pinned)}
              player={playerRef(pinned, playerName(pinned))}
              numbers={pinnedNumbers(pinned)}
              when={time != null ? clockLabelAt(time, quarter) : null}
              streak={streak}
              onClear={() => stage?.unpin()}
            />
          ) : (live || time != null) && latest ? (
            <span ref={latestLine} className={styles.latest}>
              <strong>{clockLabel(latest.period, latest.clock)}</strong>
              {`  ${plain(latest.text).replaceAll("-foot ", "-ft ")}`}
            </span>
          ) : null}
          <Legend>
            <LegendItem label={`${topName} →`} swatch={<span className={styles.dot} style={{ background: css(palette.top) }} />} />
            <LegendItem label={`← ${bottomName}`} swatch={<span className={styles.dot} style={{ background: css(palette.bottom) }} />} />
            <LegendItem label="Made" swatch={<span className={styles.dot} style={{ background: "var(--viz-neutral)" }} />} />
            <LegendItem label="Missed" swatch={<span className={styles.ring} />} />
            {scene.style === "trail" ? <LegendItem label="Turnover" swatch={<Icon name="xmark" size={6.5} className={styles.cross} />} /> : null}
            {width >= 460 && pinned == null
              ? (["top", "bottom"] as const).map((s) => {
                  const mine = scene.shots.filter((x) => x.side === s);
                  const made = mine.filter((x) => x.made).length;
                  return (
                    <span key={s} className={styles.summary}>
                      {`${name(s)} ${made}/${mine.length}${mine.length ? ` · ${Math.round((made / mine.length) * 100)}%` : ""}`}
                    </span>
                  );
                })
              : null}
          </Legend>
        </div>
      </ChartFooter>
    </div>
  );
});

/**
 * The picked player in the footer (PinnedPlayerLine): a quiet chip with
 * their name and a clear button, then their line, and "Profile ›" to their
 * page at the end. Where room is short the first name goes, then the
 * threes; the line truncates, never the name or the link.
 */
function PinnedLine({ name, player, numbers, when, streak, onClear }: { name: string; player: PlayerRef | null; numbers: { fg: readonly [number, number]; threes: readonly [number, number]; points: number }; when: string | null; streak: number; onClear: () => void }) {
  const full = `${shooting(numbers.fg, numbers.threes)}, ${numbers.points} PTS`;
  const brief = `${numbers.fg[0]} of ${numbers.fg[1]}, ${numbers.points} PTS`;
  return (
    <span className={styles.pinned}>
      <span className={styles.chip}>
        <span className={styles.chipName}>
          <span className={styles.full}>{name}</span>
          <span className={styles.short}>{lastName(name)}</span>
        </span>
        {streak >= FIRE_STREAK ? <Icon name="flame" size={8} className={styles.flame} label={`${streak} straight makes`} /> : null}
        <button type="button" className={styles.clear} onClick={onClear} title="Show every player" aria-label="Show every player">
          <Icon name="xmark" size={7} />
        </button>
      </span>
      <span className={styles.line}>
        <span className={styles.lineFull}>{when ? `${full} · ${when}` : full}</span>
        <span className={styles.lineBrief}>{brief}</span>
      </span>
      {player ? (
        <PlayerLink player={player} className={styles.profile} title={`Go to ${name}`}>
          Profile
          <Icon name="chevronRight" size={7} />
        </PlayerLink>
      ) : null}
    </span>
  );
}

/** Whether a court play can be drawn (the trail's), re-exported for the page's tests. */
export const drawable = positioned;
