/**
 * The soccer theater on the choreography engine, while the page broadcasts
 * the match (SoccerTheater.swift `SoccerDirectedStage`): each moment told at
 * its anchor on the broadcast's clock with its build-up, the events' beats,
 * the ball going round between them shaped by where it is, every hand-off a
 * splice (nothing cuts, nothing crossfades); frames come at the plan's tiers
 * on the theater's time, only while the pitch is seen (directedStage.ts).
 * Over the pitch, as today: the broadcast tag, the heartbeat, the names over
 * the players, the turn on hover. (Today's stage, SoccerTheater.tsx, is the
 * pitch while the page isn't broadcasting.)
 *
 *     <SoccerDirected source={broadcast} cues={cues} homeTeamID="362" lineups={state.lineups} kits={kits} names={names} eventId={id} heard={state.heard} />
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { dress, type TheaterKits } from "../../../../data/mlb/theaterTeams";
import type { Side } from "../../../../data/models";
import { PitchSport, type PitchClip, type PitchFacts } from "../../../../data/theater/soccerClips";
import { SoccerStatus, type SoccerNames, type SoccerStatusTag } from "../../../../data/theater/soccerIdle";
import { lineupsOn, type Lineups } from "../../../../data/theater/soccerScene";
import { idleKeyMan, soccerCast } from "../../../../data/theater/soccerTheater";
import { TheaterDirector } from "../../../../data/theater/theaterDirector";
import { FrameScratch } from "../../../../data/theater/theaterFrameScratch";
import { theaterLabels, type HitFigure, type TheaterPerson } from "../../../../data/theater/theaterNames";
import type { BroadcastTheaterSource } from "../../../../data/theater/theaterSource";
import { DirectedFrame, type TheaterCues } from "../../../../data/theater/theaterView";
import { useColorScheme } from "../../../../state/theme";
import { useSlideDirected } from "../../core/scoringSlides";
import { DirectedStage } from "../../core/theater/directedStage";
import { RigLens } from "../../core/theater/rigFigure";
import { TheaterFlipButton, TheaterHeartbeat, TheaterStatusTag, useTheaterFlip } from "../../core/theater/TheaterStatus";
import type { Size } from "../../core/theater/theaterKit";
import styles from "../../core/theater/TheaterWell.module.css";
import { useDirected, useDirector } from "../../core/theater/useDirected";
import { useTheaterNames } from "../../core/theater/useTheaterNames";
import { useReducedMotion } from "../../core/useMedia";
import { theaterInk } from "../../mlb/theater/theaterInk";
import { pitchFrame } from "./directedPitch";
import { drawPitch, drawSoccerFrame, layoutLabels, soccerProjection, type Labels, type SoccerTeams } from "./drawSoccer";

export interface SoccerDirectedProps {
  readonly source: BroadcastTheaterSource;
  readonly cues: TheaterCues | null;
  /** The home (top) team's ESPN ID: the plays' frames turn on it. */
  readonly homeTeamID: string | null;
  /** Both starting elevens (the summary's rosters), with their changes. */
  readonly lineups: Lineups;
  readonly kits: TheaterKits;
  /** The teams as the tag names them ("ARSENAL BALL"), and their colors for it (hex without the hash). */
  readonly names: SoccerNames;
  readonly eventId: string;
  readonly people?: Readonly<Record<string, TheaterPerson>>;
  /** When the lane last brought a play (epoch ms): the heartbeat counts from it. */
  readonly heard: number | null;
  /** The match is at a break (the presented status says so): the teams go off without waiting for ESPN's entry. */
  readonly atBreak?: boolean;
  /** A match held up says so over anything else, in ESPN's words ("Weather delay"): TheaterStatus.holding. */
  readonly holding?: string | null;
}

const NO_PEOPLE: Readonly<Record<string, TheaterPerson>> = {};
const NO_STATUS: SoccerStatusTag = { tag: null, tint: null };

export default function SoccerDirected({ source, cues, homeTeamID, lineups, kits, names, eventId, people = NO_PEOPLE, heard, atBreak = false, holding = null }: SoccerDirectedProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const well = useRef<HTMLDivElement>(null);
  const stage = useRef<DirectedStage<PitchClip> | null>(null);
  const [flipped, flip] = useTheaterFlip(eventId);
  const facts: PitchFacts = { homeTeamID, flipped, lineups, atBreak };
  const director = useDirector(() => new TheaterDirector(PitchSport, facts), eventId);
  useDirected(director, source, facts, cues);
  if (import.meta.env.DEV) (window as unknown as { __director?: unknown }).__director = director;
  useSlideDirected("pitch", cues);
  const scheme = useColorScheme();
  const reduceMotion = useReducedMotion();
  const nameTags = useTheaterNames(well, stage);
  const [height, setHeight] = useState(0);
  const [status, setStatus] = useState<SoccerStatusTag>(NO_STATUS);
  const scratch = useMemo(() => new FrameScratch(), []);
  const shown = useMemo(() => new DirectedFrame(), []);

  const dressed = useMemo(
    () => dress(kits, scheme),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kits.top.color, kits.top.alternate, kits.bottom.color, kits.bottom.alternate, scheme],
  );
  // Each side's look on the ball.
  const teamsBy = useMemo((): Record<Side, SoccerTeams> => ({ top: { attacking: dressed.top, defending: dressed.bottom }, bottom: { attacking: dressed.bottom, defending: dressed.top } }), [dressed]);
  const ink = useMemo(() => theaterInk(scheme), [scheme]);
  const tagLabels = useMemo(
    () => theaterLabels(kits, scheme, names),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kits.top.color, kits.top.alternate, kits.bottom.color, kits.bottom.alternate, scheme, names.top, names.bottom],
  );

  useEffect(() => {
    if (!canvas.current) return;
    const s = new DirectedStage(canvas.current, director);
    stage.current = s;
    return () => {
      s.dispose();
      stage.current = null;
    };
  }, [director]);

  useEffect(() => {
    const el = well.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => setHeight(entries[0]?.contentRect.height ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    // The type, laid out once per clip, size and point.
    let labels: { key: unknown; size: string; value: Labels } | null = null;
    let lastSaid: string | null | undefined = undefined;
    /** The tag, set only when its words or color change. */
    const report = (next: SoccerStatusTag) => {
      const key = `${next.tag ?? ""}|${next.tint ?? ""}`;
      if (key === lastSaid) return;
      lastSaid = key;
      setStatus(next);
    };
    stage.current?.update((ctx, size: Size, pt, _wall, T) => {
      const chain = director.chain;
      chain.sample(T, scratch);
      const drawn = pitchFrame(chain, scratch, size);
      if (!drawn) return;
      const { clip, t, world } = drawn;
      const script = clip.script;
      const scene = clip.scene;
      const teams = teamsBy[clip.attacking];
      const f = soccerProjection(size, script, t, null, world);
      // What the tag says, as today's stage words it: nothing while the headline or the stamp says it; the moment's
      // start during its replay; the pitch between moments' event, or the team on the ball.
      let told: SoccerStatusTag = NO_STATUS;
      if (scene) {
        const banner = script.banners.some((b) => t >= b.at - 0.3 && t < b.until + 0.3);
        told = banner || t >= script.stamp ? NO_STATUS : SoccerStatus.replay(scene, names);
      } else if (clip.idle) {
        told = SoccerStatus.idle(clip.idle, t, names, null);
      }
      const saying: SoccerStatusTag = holding ? { tag: holding, tint: null } : told;
      // The names: the clip in charge's cast, as the engine's men play it.
      const baked = chain.plans[scratch.plan]!;
      const placement = baked.plan.placements[drawn.placement]!;
      const cast = shown.castFor(`${baked.start}#${drawn.placement}|${flipped}`, placement.cast, () => {
        if (scene) return soccerCast(script, scene.side, lineupsOn(lineups, scene.clock), people, scene.shooterCredit?.athlete ?? null, `${scene.id}|${flipped}`);
        const idle = clip.idle;
        return soccerCast(script, clip.attacking, idle?.lineups ?? {}, people, idle ? idleKeyMan(idle) : null, `idle|${baked.start}#${drawn.placement}`);
      });
      const hits = (): HitFigure[] => {
        const out: HitFigure[] = [];
        for (const w of world.figures.values()) {
          if (!(w.opacity > 0.01)) continue;
          const lens = RigLens.pitch(f, w.at);
          out.push({ index: w.index, ground: lens.origin, height: lens.height });
        }
        return out;
      };
      shown.update(hits());
      const tags = nameTags.frame(cast, tagLabels, { status: saying.tag, flip: true, heartbeat: "trailing" }, hits);
      if (labels?.key !== clip || labels.size !== `${size.width}x${size.height}|${pt}|${clip.attacking}`) {
        labels = { key: clip, size: `${size.width}x${size.height}|${pt}|${clip.attacking}`, value: layoutLabels(ctx, scene, script, teams, ink, size, pt) };
      }
      drawPitch(ctx, f, ink);
      drawSoccerFrame(ctx, f, { scene, script, t, teams, ink, labels: labels.value, tags, world });
      report(saying);
    }, reduceMotion);
  }, [director, scratch, shown, teamsBy, ink, names, flipped, lineups, people, tagLabels, nameTags, holding, reduceMotion]);

  return (
    <div ref={well} className={styles.well} data-theater="soccer" data-directed="">
      <canvas ref={canvas} className={styles.canvas} aria-hidden="true" />
      <TheaterStatusTag tag={status.tag} tint={status.tint} height={height} />
      <TheaterHeartbeat updated={heard} source="ESPN" />
      <TheaterFlipButton surface="pitch" flipped={flipped} onFlip={flip} />
    </div>
  );
}
