/**
 * The play theater (PlayTheater.swift): under the diamond and the count,
 * the last play replayed on an isometric field as it arrives from the live
 * lane, shot like a broadcast. The camera opens tight on the battery for the
 * delivery and the pitch (its type and speed), follows the ball off the bat
 * with the fielder going for it, frames each throw end to end, then settles
 * on the runners' last bases as the scorer's mark lands (with Statcast's
 * batted-ball line under it when MLB has the at-bat). A play Statcast
 * measured flies for real (playScript.ts), its pitch label adds the spin.
 * Where MLB's feed has
 * the play (useStatcast.ts), it's told from MLB's official account: the ball
 * to the man credited with fielding it, the throws along the credited chain,
 * every runner where MLB says, each run crossing in turn with the camera on
 * it. A replay keeps the play it began with: MLB's account landing
 * mid-replay waits for its end. Marquee plays get a
 * headline across the top (HOME RUN, TRIPLE, DOUBLE PLAY), and a home run's
 * fireworks burst at the wall it cleared. The footer under it (the
 * diamond's last play) is its caption.
 *
 * Between plays it plays the game's timeline in order (playBeat.ts,
 * playBeatScript.ts; PlayTheater.swift `PlayStage`): every pitch (the
 * delivery, the ball to its real plate location, the swing or the take, the
 * umpire's call), a throw over, a visit, a change, the teams changing sides,
 * a delay; the status tag says what's happening ("STRIKE 2 · 97 MPH
 * FOUR-SEAM FASTBALL", "TOP 7TH · 1-2 · 2 OUTS", "MIDDLE 5TH", "PITCHING
 * CHANGE · ROMERO") and the heartbeat that the feed is live. A news play cuts
 * in on a beat (the scoring slide keeps time with its replay); a backlog
 * plays its last few pitches. While nothing comes, the field has its idle
 * life: a move every few seconds, briefly, still in between, only while the
 * theater's on screen and the tab visible, never with Reduce Motion (the tags
 * still say what happened).
 *
 * Drawn on one canvas through the camera (renderer.ts, drawTheater.ts), so
 * lines stay crisp at any zoom. A rAF loop runs only while a replay, a beat
 * or an idle move plays; between them the scene is a still on the infield. Plays already on the
 * page when it opened show as they ended; a new one mid-replay cuts to
 * itself; with Reduce Motion each play crossfades to how it ended and the
 * camera never moves. A play's end (its trace, the stamp, the Statcast line)
 * stays until the next at-bat's first pitch, or `HOLD_MS` after its replay,
 * whichever comes first; then the field crossfades to the game as it is (the
 * live bases and batter). The field and the figures are one canvas pass,
 * through the same camera at the same moment. Decorative for screen readers:
 * the caption carries the play.
 *
 *     <PlayTheater state={theater} bases={[on1, on2, on3]} batting="top" palette={palette} kits={kits} event={event} />
 *
 * Faithful to the Swift: the parser and notation, the script (every beat and
 * pace), the camera (shots, spring, caps, the corner kept clear), the field,
 * figures and poses, the ball, the beats, the type and its timings, the
 * teams' dress, and the celebrations (fireworks at the wall, the banner's
 * confetti, Subtle, the cooldown, Reduce Motion's bloom).
 * Simplified on the web:
 * - The headline's expanded width uses the canvas `fontStretch` where the browser has it (SF Pro Expanded isn't web-addressable); type is the system UI face, without tabular figures.
 * - Text is measured with the canvas, not SwiftUI's layout, so the stamp's line boxes are approximations of SF's metrics.
 * - Team colors mix in OKLab for the far limbs (SwiftUI's `mix` is its own perceptual space).
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Baseball } from "../../../../data/gameDetail";
import type { JSONValue } from "../../../../data/json";
import type { ScoreEvent, Side } from "../../../../data/models";
import { batting as battingOf, captionText, catchUp, delayTag, isPlayBeat, mlbDelay, seedOf, standing, timeline, type Delay, type PlayBeat } from "../../../../data/mlb/playBeat";
import { battery, beatScript, idleNext, idleScript, type IdleBeat } from "../../../../data/mlb/playBeatScript";
import { CameraFrame, restCamera } from "../../../../data/mlb/playCamera";
import { PlayScript, type Rest, type Standing } from "../../../../data/mlb/playScript";
import { playOnStage, type PlayScene, type TheaterState } from "../../../../data/mlb/playScene";
import type { StatcastAtBat } from "../../../../data/mlb/statcast";
import { HOLD_MS } from "../../../../data/theater/theaterKit";
import { theaterTeams, type TheaterKits } from "../../../../data/mlb/theaterTeams";
import type { TeamPalette } from "../../../../data/teamColors";
import { useSettings } from "../../../../state/settings";
import { useColorScheme } from "../../../../state/theme";
import type { LiveMoment } from "../../../../data/moments";
import { useChartMoment } from "../../core/moments";
import { TheaterHeartbeat, TheaterStatusTag } from "../../core/theater/TheaterStatus";
import { TheaterRenderer } from "./renderer";
import { theaterInk } from "./theaterInk";
import { useMeasuredTheater, useMLBTimeline } from "./useStatcast";
import { useSlidePlate } from "./slidePlate";
import styles from "./PlayTheater.module.css";

export type { TeamKit, TheaterKits } from "../../../../data/mlb/theaterTeams";

export interface PlayTheaterProps {
  readonly state: TheaterState;
  /** The live bases and the team at bat (the diamond's), for the field between plays. */
  readonly bases: readonly [boolean, boolean, boolean] | null;
  readonly batting: Side | null;
  /** Unused when kits dress the teams (they always do here); kept for the contract with the page. */
  readonly palette: TeamPalette;
  /** The teams' own and second colors, so the figures always contrast. */
  readonly kits: TheaterKits;
  /** For MLB's feed: the game's date and teams. */
  readonly event: ScoreEvent;
  /** Development: draw this instant of the play, frozen (seconds from the pitch). */
  readonly frozen?: number | null;
  /** The lane's plays (its window) and their version: the timeline is built from them; with the box score's names. */
  readonly plays?: readonly JSONValue[];
  readonly playsVersion?: number;
  readonly names?: Readonly<Record<string, string>>;
  /** When the lane last brought anything (the heartbeat), and a delay ESPN's status says. */
  readonly heard?: number | null;
  readonly delay?: Delay | null;
  /** The live count and outs, and the inning ("Top 7th"): the tag until the timeline says more. */
  readonly situation?: Baseball | null;
  readonly inning?: string | null;
  /** The lane has spoken: the heartbeat shows, MLB's live poll runs. */
  readonly live?: boolean;
  /** Development: draw this beat (or idle move) at `frozen`, in place of the play. */
  readonly frozenBeat?: { readonly script: PlayScript; readonly beat: PlayBeat | null } | null;
}

const reduceQuery = typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
const subscribeReduce = (listener: () => void) => {
  reduceQuery?.addEventListener("change", listener);
  return () => reduceQuery?.removeEventListener("change", listener);
};

/** The system's Reduce Motion, live. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduce, () => reduceQuery?.matches ?? false, () => false);
}

/** A beat on screen: which, when it began (performance.now()), its script and where its camera starts and rests. */
interface BeatShow {
  readonly beat: PlayBeat;
  readonly start: number;
  readonly script: PlayScript;
  readonly to: CameraFrame;
}

/** An idle move on screen. */
interface IdleShow {
  readonly kind: IdleBeat;
  readonly start: number;
  readonly script: PlayScript;
}

/** A play's end stays up this long when the next thing is waiting. */
const BRIEF_HOLD_MS = 1_400;

/**
 * The timeline with what's news: entries first seen after the theater first
 * saw any are news (it opened on the rest: history isn't replayed); one seen
 * before keeps what it was; the newest play is news as the lane's is.
 */
function useTimeline(plays: readonly JSONValue[], version: number, atBats: readonly StatcastAtBat[], names: Readonly<Record<string, string>>, state: TheaterState): PlayBeat[] {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const base = useMemo(() => timeline(plays, atBats, names), [version, atBats, names]);
  const seen = useRef<Map<string, boolean>>(new Map());
  const primed = useRef(false);
  return useMemo(() => {
    const first = !primed.current && base.length > 0;
    if (first) primed.current = true;
    return base.map((b) => {
      let news = seen.current.get(b.id);
      if (news === undefined) {
        news = !first && primed.current;
        seen.current.set(b.id, news);
      }
      if (isPlayBeat(b) && b.id === state.play?.id) news = state.news;
      return news === b.news ? b : { ...b, news };
    });
  }, [base, state.play?.id, state.news]);
}

/** The team at bat for a beat: between halves, the one about to; after a third out, the other. */
function battingSide(b: PlayBeat, fallback: Side | null): Side {
  if (b.kind.kind === "inningBreak") return b.kind.middle ? "bottom" : "top";
  if (b.kind.kind === "play" && b.outs >= 3) return b.top === false ? "top" : "bottom";
  return battingOf(b) ?? fallback ?? "top";
}

/** Between halves: the warm-ups, no batter. */
function isBetween(last: PlayBeat | null, inning: string | null): boolean {
  if (last) return last.kind.kind === "inningBreak" || (last.kind.kind === "play" && last.outs >= 3);
  const word = inning?.toLowerCase().split(" ")[0] ?? "";
  return word === "mid" || word === "end";
}

/** What still stands on the field: a rain delay's tarp, the trainer out to an injured man. */
function standingOf(last: PlayBeat | null, delay: Delay | null): Standing | null {
  if (delay && (delay.kind === "weather" || delay.kind === "resuming")) return { kind: "tarp" };
  if (!last || last.kind.kind !== "delay") return null;
  const d = last.kind.delay;
  if (d.kind === "injury") return { kind: "injury", hurt: d.hurt };
  if (d.kind === "weather" || d.kind === "resuming") return { kind: "tarp" };
  return null;
}

/** "TOP 7TH · 1-2 · 2 OUTS" from the live situation, before the timeline says more. */
function fallbackTag(inning: string | null, situation: Baseball | null): string | null {
  if (!inning) return null;
  const words = inning.toUpperCase().split(" ");
  const first = words[0];
  if (!first || words.length < 2) return null;
  if (first === "MID" || first === "MIDDLE" || first === "END") return `${first === "END" ? "END" : "MIDDLE"} ${words[1]}`;
  const half = `${first.startsWith("BOT") ? "BOT" : first} ${words[1]}`;
  if (!situation) return half;
  return `${half} · ${situation.balls}-${situation.strikes} · ${situation.outs} OUT${situation.outs === 1 ? "" : "S"}`;
}

export function PlayTheater({
  state: lane,
  bases,
  batting,
  kits,
  event,
  frozen = null,
  plays = [],
  playsVersion = 0,
  names = {},
  heard = null,
  delay = null,
  situation = null,
  inning = null,
  live = false,
  frozenBeat = null,
}: PlayTheaterProps) {
  const well = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<TheaterRenderer | null>(null);
  const scheme = useColorScheme();
  const level = useSettings((s) => s.celebrationLevel);
  const reduceMotion = usePrefersReducedMotion();
  const current = useChartMoment("plate");
  // The replay that has run its course, and the one whose end has had its time on screen.
  const [ended, setEnded] = useState<string | null>(null);
  const [rested, setRested] = useState<string | null>(null);
  // The lane's play with MLB's account in it, once found (a new one waits briefly for it).
  const state = useMeasuredTheater(event, lane);
  // MLB's at-bats for the timeline (the full feed's, and the one under way), and its status.
  const mlb = useMLBTimeline(event, live && frozen == null);
  const held = mlbDelay(mlb.status) ?? delay;
  const line = useTimeline(plays, playsVersion, mlb.atBats, names, state);

  // The last entry shown (or passed over): what's after it, and news, is still to come. "": before everything.
  const [shown, setShown] = useState<string | null>(null);
  const [beat, setBeat] = useState<BeatShow | null>(null);
  const [move, setMove] = useState<IdleShow | null>(null);
  const [captionAt, setCaptionAt] = useState(-1);
  const camera = useRef<CameraFrame>(restCamera());
  // On screen (the well in view, the tab visible), and how wide (the tag's pitch names).
  const [onScreen, setOnScreen] = useState(true);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = well.current;
    if (!el) return;
    let visible = true;
    let tab = !document.hidden;
    const update = () => setOnScreen(visible && tab);
    const io = new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting);
      update();
    });
    io.observe(el);
    const ro = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width ?? 0));
    ro.observe(el);
    const onVisibility = () => {
      tab = !document.hidden;
      update();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Opened on the game: history stands as it is (a news play, the newest thing, still replays).
  useEffect(() => {
    if (shown != null || line.length === 0) return;
    const newest = line[line.length - 1]!;
    if (!newest.news) setShown(newest.id);
    else setShown(line.length >= 2 ? line[line.length - 2]!.id : "");
  }, [shown, line]);

  // A new play cuts in, as a replay cuts in on another (a scoring slide keeps time with it).
  const playID = state.play?.id ?? null;
  useEffect(() => {
    if (playID == null || !state.news || frozen != null || reduceMotion) return;
    if (!line.some((b) => b.id === playID)) return;
    setBeat(null);
    setMove(null);
    camera.current = restCamera();
    setShown(playID);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playID]);

  const last = useMemo(() => (shown ? (line.findLast((b) => b.id === shown) ?? null) : null), [line, shown]);
  const pending = useMemo(() => {
    if (shown == null) return [];
    const from = line.findIndex((b) => b.id === shown) + 1;
    return line.slice(from).filter((b) => b.news && (!isPlayBeat(b) || b.id === state.play?.id));
  }, [line, shown, state.play?.id]);

  // The stage: with a timeline, a play's end stays until the hold or the next thing; without, as before (until the next pitch).
  const stageState: TheaterState = line.length > 0 ? { ...state, cleared: shown !== state.play?.id } : state;
  // The play on screen: a replay's own until it's over; then how the latest ended, until the next pitch or the hold; then none.
  const latest = playOnStage(stageState, frozen == null && !reduceMotion, ended, rested);
  // A replay keeps the play it began with (MLB's account landing mid-replay waits for its end).
  const began = useRef<PlayScene | null>(null);
  const replaying = latest != null && frozen == null && !reduceMotion && state.news && ended !== latest.id;
  if (replaying && began.current?.id !== latest.id) began.current = latest;
  const play = frozenBeat ? null : replaying ? began.current : latest;
  // This play's moment, kept once seen: its replay can begin after the page's moment slot has moved on
  // (a play held for MLB's account).
  const heldMoment = useRef<LiveMoment | null>(null);
  if (current != null && current.id === play?.id) heldMoment.current = current;
  const moment = current?.id === play?.id || !replaying ? current : heldMoment.current?.id === play?.id ? heldMoment.current : current;
  useEffect(() => {
    if (ended == null) return;
    // Done: its end holds a while (briefly when the next thing's waiting), then the field returns to the game.
    const id = setTimeout(() => setRested(ended), pending.length > 0 ? BRIEF_HOLD_MS : HOLD_MS);
    return () => clearTimeout(id);
  }, [ended, pending.length > 0]);

  // The field: after a play, as it left it; after a beat, its bases and batter, the team in the field's side; a stoppage still standing.
  const between = isBetween(last, inning);
  const standingNow = standingOf(last, held);
  const restFor = (b: PlayBeat | null): Rest => {
    if (!b) return { bases: bases ?? [false, false, false], bats: between ? null : state.bats, swapped: false, fieldingHome: (batting ?? "top") === "top", standing: standingNow };
    const side = battingSide(b, batting);
    const noBatter = between || b.kind.kind === "inningBreak";
    return {
      bases: noBatter ? [false, false, false] : (b.bases ?? bases ?? [false, false, false]),
      bats: noBatter ? null : (b.bats ?? state.bats),
      swapped: false,
      fieldingHome: side === "top",
      standing: standingNow,
    };
  };
  const swapped = play?.endsInning ?? false;
  const playSide: Side = swapped ? (play?.batting === "bottom" ? "top" : "bottom") : (play?.batting ?? batting ?? "top");
  const restBases: readonly boolean[] = play ? (swapped ? [false, false, false] : (bases ?? play.basesAfter)) : (bases ?? [false, false, false]);
  const field: Rest = play ? { bases: restBases, bats: state.bats, swapped, fieldingHome: playSide === "top" } : restFor(last);
  const fieldKey = JSON.stringify(field);
  const script = useMemo(
    () => (play ? PlayScript.play(play, field) : PlayScript.rest(field)),
    // A play keeps one script per field it settles to and reading of MLB's account (the play's object may be re-made by a poll).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [play?.id, play?.measured, fieldKey],
  );

  // The next thing in the timeline, when nothing's on screen: a beat (a pitch to follow another keeps the camera on the battery).
  useEffect(() => {
    if (frozen != null || shown == null || beat || replaying) return;
    // A play's end, held for a moment.
    if (play && play.id !== rested && !stageState.cleared) return;
    const queue = catchUp(pending);
    const next = queue[0];
    if (!next) return;
    if (isPlayBeat(next)) {
      // The newest is its replay's; an older one's scene has gone.
      setShown(next.id);
      return;
    }
    setMove(null);
    const nextRest = restFor(next);
    const following = queue[1];
    const to = !reduceMotion && next.kind.kind === "pitch" && following?.kind.kind === "pitch" ? battery(nextRest) : restCamera();
    const from = reduceMotion ? restCamera() : camera.current;
    setBeat({ beat: next, start: performance.now(), script: beatScript(next, nextRest, from, to), to });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, beat, replaying, play?.id, rested, shown, frozen]);

  // Each beat to its end, then the next.
  useEffect(() => {
    if (!beat) return;
    const length = (reduceMotion ? Math.min(beat.script.duration, 2.4) : beat.script.duration) * 1000;
    const id = setTimeout(() => {
      camera.current = beat.to;
      setShown(beat.beat.id);
      setBeat(null);
    }, Math.max(beat.start + length - performance.now(), 0));
    return () => clearTimeout(id);
  }, [beat, reduceMotion]);

  // Its captions as they come (a pitch's call as it pops the mitt).
  useEffect(() => {
    setCaptionAt(-1);
    if (!beat) return;
    const timers = beat.script.captions.map((c, i) => setTimeout(() => setCaptionAt(i), Math.max(beat.start + c.at * 1000 - performance.now(), 0)));
    return () => timers.forEach(clearTimeout);
  }, [beat]);

  // The idle life: a move every few seconds, a second or two long, still in between; only on screen, never with Reduce Motion.
  const resting = !play && !beat && frozen == null;
  const idleSeed = seedOf(shown ?? "rest");
  const arm = last?.arm ?? null;
  useEffect(() => {
    setMove(null);
    if (!resting || !onScreen || reduceMotion || !live) return;
    let n = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const rest: Rest = JSON.parse(fieldKey) as Rest;
    const step = () => {
      const next = idleNext(n, rest, between, idleSeed);
      if (!next) return;
      timer = setTimeout(() => {
        const s = idleScript(next.beat, rest, (idleSeed + BigInt(n)) & 0xffffffffffffffffn, arm);
        setMove({ kind: next.beat, start: performance.now(), script: s });
        timer = setTimeout(() => {
          setMove(null);
          n += 1;
          step();
        }, s.duration * 1000 + 50);
      }, next.wait * 1000);
    };
    step();
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resting, onScreen, reduceMotion, live, fieldKey, between, idleSeed]);

  // Whose colors: the play's batting team; a beat's; after the last thing, its; else the live one.
  const side: Side = frozenBeat?.beat ? battingSide(frozenBeat.beat, batting) : play ? (play.batting ?? batting ?? "top") : beat ? battingSide(beat.beat, batting) : last ? battingSide(last, batting) : (batting ?? "top");
  const teams = useMemo(
    () => theaterTeams(kits, scheme, side),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kits.top.color, kits.top.alternate, kits.bottom.color, kits.bottom.alternate, scheme, side],
  );
  const ink = useMemo(() => theaterInk(scheme), [scheme]);
  // Statcast's batted-ball line on the stamp (a grounder's without its first hop's distance).
  const statcast = play?.readout ?? null;
  // The scoring slide lands with this replay's climax.
  useSlidePlate(state, play, script);

  // What the tag says: nothing while a play replays (its headline and mark tell it); a beat's captions as they come; between, the
  // game as the last thing left it ("TOP 7TH · 1-2 · 2 OUTS", a stoppage while it stands); a delay over all of it.
  const wide = width >= 440;
  let tag: string | null = null;
  let about: PlayBeat | null = null;
  if (frozenBeat?.beat) {
    const fb = frozenBeat.beat;
    const c = frozenBeat.script.captions.findLast((x) => x.at <= (frozen ?? Infinity));
    about = fb;
    tag = c ? captionText(fb, c.line, wide) : null;
  } else if (replaying) {
    tag = null;
  } else if (beat) {
    const c = beat.script.captions[captionAt];
    if (c) {
      about = beat.beat;
      tag = captionText(beat.beat, c.line, wide);
    } else {
      about = last;
      tag = last ? standing(last) : null;
    }
  } else if (play) {
    about = line.findLast((b) => b.id === play.id) ?? null;
    tag = about ? standing(about) : null;
  } else {
    about = last;
    tag = last ? standing(last) : fallbackTag(inning, situation);
  }
  if (held && held.kind !== "over") {
    tag = delayTag(held);
    about = null;
  }
  const tint = tintOf(about, batting, kits);

  useEffect(() => {
    if (!canvas.current) return;
    const r = new TheaterRenderer(canvas.current);
    renderer.current = r;
    return () => {
      r.dispose();
      renderer.current = null;
    };
  }, []);

  const shownBeat = frozenBeat
    ? { key: "frozen", script: frozenBeat.script, start: 0, idle: false }
    : beat
      ? { key: beat.beat.id, script: beat.script, start: beat.start, idle: false }
      : move
        ? { key: `idle.${move.start}`, script: move.script, start: move.start, idle: true }
        : null;
  const footer = live ? 16 : 0;
  useEffect(() => {
    renderer.current?.update({ scene: play, news: state.news, script, teams, ink, statcast, moment, level, reduceMotion, frozen, onEnd: setEnded, beat: shownBeat, footer });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play, state.news, script, teams, ink, statcast, moment, level, reduceMotion, frozen, shownBeat?.key, shownBeat?.script, footer]);

  return (
    <div ref={well} className={styles.well} aria-hidden="true">
      <canvas ref={canvas} className={styles.canvas} />
      <TheaterStatusTag tag={tag} tint={tint} height={width / 2} />
      {live ? <TheaterHeartbeat updated={heard} source="ESPN" /> : null}
    </div>
  );
}

/**
 * A tag in a team's color: the team at bat's for the count, a pitch, a pinch
 * hitter or runner; the team in the field's for a visit, a change, a throw
 * over; the game's own (none) for the end of a half, a review, a delay.
 */
function tintOf(b: PlayBeat | null, batting: Side | null, kits: TheaterKits): string | null {
  let side: Side | null;
  if (b) {
    const at = battingSide(b, batting);
    const field: Side = at === "top" ? "bottom" : "top";
    switch (b.kind.kind) {
      case "play":
        side = b.outs >= 3 ? null : at;
        break;
      case "pitch":
      case "batterUp":
      case "timeout":
        side = at;
        break;
      case "substitution":
        side = b.kind.change.role === "pinchRunner" || b.kind.change.role === "pinchHitter" ? at : field;
        break;
      case "moundVisit":
      case "pitchingChange":
      case "pickoff":
      case "stepOff":
        side = field;
        break;
      default:
        side = null;
    }
  } else side = batting;
  if (side == null) return null;
  return (side === "top" ? kits.top.color : kits.bottom.color) ?? null;
}
