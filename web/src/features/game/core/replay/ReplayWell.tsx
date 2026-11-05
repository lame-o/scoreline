/**
 * A play replayed in the isometric view, under its row (ReplayWell.swift
 * `ReplayWell`): the sport's own frame, script, stamp, celebration and
 * names, on a clock of its own (nothing it does reaches the theater above,
 * which carries on). It plays once from its start, holds as it ended, and
 * the control in the corner plays it again. The game's turn of the field
 * for the play's period, as live; no heartbeat and no scoring slide: it's a
 * replay. With Reduce Motion it opens on how the play ended (a score's bloom
 * where it happened), and the control plays it.
 *
 * Drawn on one canvas by the theaters' stage (TheaterStage): a frame loop
 * only while it plays and is on screen in a visible tab (the replay's clock
 * stops off screen and picks up where it was), a still once it holds. A
 * touchdown's try follows it a breath after, as the live theater follows it
 * (ReplayClock). The names over the figures follow the pointer (a tap on a
 * phone), as the live theaters' do. The picture is decorative for screen
 * readers (the row says the play); the control isn't. Its own chunk, with
 * the sport's drawing (replayDrawing.ts).
 *
 *     <ReplayWell sport={footballReplay} replay={replay} context={context} via="pointer" />
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ReplayClock, type PlayReplay, type ReplayContext } from "../../../../data/replays";
import { useSettings } from "../../../../state/settings";
import { useColorScheme } from "../../../../state/theme";
import { TheaterStage, type StageInputs } from "../theater/TheaterStage";
import { readTheaterFlip, TheaterStatusTag } from "../theater/TheaterStatus";
import wellStyles from "../theater/TheaterWell.module.css";
import { useTheaterNames } from "../theater/useTheaterNames";
import { useReducedMotion } from "../useMedia";
import type { ReplayVia } from "./pageReplays";
import { NO_STATUS, type ReplaySport, type ReplayStatus } from "./replayDrawing";
import styles from "./Replay.module.css";

export interface ReplayWellProps<Take> {
  readonly sport: ReplaySport<Take>;
  readonly replay: PlayReplay;
  readonly context: ReplayContext;
  readonly via: ReplayVia;
}

/** Each running of the replay: its serial (the control's presses), or null while it holds as it ended without having played (Reduce Motion). */
type Run = number | null;

export function ReplayWell<Take>({ sport, replay, context }: ReplayWellProps<Take>) {
  const well = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<TheaterStage | null>(null);
  // Who the pointer's over (the name over him), read by each frame as it's drawn: never React state.
  const names = useTheaterNames(well, stage);
  const scheme = useColorScheme();
  const level = useSettings((s) => s.celebrationLevel);
  const reduceMotion = useReducedMotion();
  // The viewer's turn of the field for this game (the theater's; only read here).
  const flipped = useMemo(() => readTheaterFlip(context.eventID), [context.eventID]);
  // The takes last built, until the play, the turn of the field or the lineups change (ReplayScripts).
  const takes = useMemo(
    () => sport.takes(replay.scene, flipped, context),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sport, replay.scene, flipped, context.rosters, context.topIsHome],
  );
  const drawing = useMemo(() => sport.drawing(takes, replay, context, { scheme, flipped, level, reduceMotion }), [sport, takes, replay, context, scheme, flipped, level, reduceMotion]);
  const order = useMemo(() => new ReplayClock(drawing.lengths), [drawing.lengths]);
  // It plays once from its start (with Reduce Motion it opens on how it ended), then holds, with the control.
  const [run, setRun] = useState<Run>(() => (reduceMotion ? null : 0));
  const [held, setHeld] = useState(reduceMotion);

  // The tag: what's happening at the instant drawn, set only when its words or color change.
  const [status, setStatus] = useState<ReplayStatus>(NO_STATUS);
  const shown = useRef<ReplayStatus>(NO_STATUS);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (!canvas.current || !well.current) return;
    const s = new TheaterStage(canvas.current);
    stage.current = s;
    const box = well.current;
    const resize = new ResizeObserver(() => setHeight(box.clientHeight));
    resize.observe(box);
    return () => {
      resize.disconnect();
      s.dispose();
      stage.current = null;
    };
  }, []);

  useEffect(() => {
    const id = `${replay.scene.kind}|${run ?? "end"}`;
    const say = (next: ReplayStatus) => {
      if (next.tag === shown.current.tag && next.tint === shown.current.tint) return;
      shown.current = next;
      setStatus(next);
    };
    const inputs: StageInputs = {
      id,
      // Played from its start, unless it opened held (Reduce Motion): then how it ended, and the moment's bloom.
      news: run != null,
      duration: order.end,
      frozen: null,
      reduceMotion: run == null,
      momentID: replay.moment ? id : null,
      bursts: (h) => (reduceMotion ? [] : drawing.bursts(h)),
      bloom: replay.moment ? (size) => drawing.bloom(size) : null,
      onEnd: () => setHeld(true),
      paint: (ctx, size, pt, t, bursts) => {
        // The take on screen, and its time; from the end, the last one as it ended.
        const p = order.position(t);
        const at = Number.isFinite(p.t) ? p.t : drawing.ended(p.take);
        drawing.paint(ctx, size, pt, p.take, at, t, bursts, names);
        say(drawing.status(p.take, at));
      },
    };
    stage.current?.update(inputs);
  }, [run, replay, drawing, order, reduceMotion, names]);

  const again = () => {
    setHeld(false);
    setRun((r) => (r ?? -1) + 1);
  };

  return (
    <div className={styles.well} role="group" aria-label="Replay">
      <div ref={well} className={wellStyles.well} data-replay-well={replay.scene.kind}>
        <canvas ref={canvas} className={wellStyles.canvas} aria-hidden="true" />
        <div aria-hidden="true">
          <TheaterStatusTag tag={status.tag} tint={status.tint} height={height} />
        </div>
        {/* The replay's control, in the corner the live theater's heartbeat takes, in the turn control's look: plays it again. */}
        <button type="button" className={styles.again} data-corner={drawing.corner} data-shown={held} onClick={again} title="Replay" aria-label="Replay the play">
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="M2.8 8.4A5.2 5.2 0 1 0 4.4 4.2" />
            <path d="M4.1 1.6v3h3" />
          </svg>
        </button>
      </div>
    </div>
  );
}
