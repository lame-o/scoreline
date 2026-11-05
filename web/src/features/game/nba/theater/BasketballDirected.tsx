/**
 * The basketball theater on the choreography engine, while the page
 * broadcasts the game (BasketballTheater.swift `BasketballDirectedStage`):
 * the broadcast's timeline and clock say what's told and when; the director
 * places today's scripts at their plays' anchors and splices every hand-off
 * (nothing cuts, nothing crossfades); frames come at the plan's tiers on the
 * theater's time, only while the court is seen (directedStage.ts). Over the
 * court, as today: the broadcast tag, the heartbeat, the names over the men,
 * the court's turn on hover, a marquee's celebration.
 *
 *     <BasketballDirected source={broadcast} cues={cues} teams={teams} kits={kits} palette={palette} names={names} homeName="UTAH" eventId={id} />
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Teams } from "../../../../data/liveFeeds/basketball";
import { dress, type TheaterKits } from "../../../../data/mlb/theaterTeams";
import type { Side } from "../../../../data/models";
import { NEUTRAL, type Scheme, type TeamPalette } from "../../../../data/teamColors";
import { HoopsSport, type HoopsClip, type HoopsFacts } from "../../../../data/theater/basketballClips";
import { statusBetween, statusDuring, type Said } from "../../../../data/theater/basketballFlow";
import type { BasketballScene } from "../../../../data/theater/basketballScene";
import { Hoops } from "../../../../data/theater/basketballScript";
import { basketballCast, BasketballCelebration, type BasketballBurst } from "../../../../data/theater/basketballTheater";
import { TheaterDirector } from "../../../../data/theater/theaterDirector";
import { FrameScratch } from "../../../../data/theater/theaterFrameScratch";
import { theaterLabels, type HitFigure, type TheaterPerson } from "../../../../data/theater/theaterNames";
import type { BroadcastTheaterSource } from "../../../../data/theater/theaterSource";
import { DirectedFrame, type TheaterCues } from "../../../../data/theater/theaterView";
import { useSettings } from "../../../../state/settings";
import { useColorScheme } from "../../../../state/theme";
import { useChartMoment } from "../../core/moments";
import { DirectedStage } from "../../core/theater/directedStage";
import { TheaterFlipButton, TheaterHeartbeat, TheaterStatusTag, useTheaterFlip } from "../../core/theater/TheaterStatus";
import { accentOf, drawBursts, stageBurstEnd, TheaterType, teamPalette, type Size, type StageBurst } from "../../core/theater/theaterKit";
import styles from "../../core/theater/TheaterWell.module.css";
import { useDirected, useDirector, useHeard } from "../../core/theater/useDirected";
import { useTheaterNames } from "../../core/theater/useTheaterNames";
import { useReducedMotion } from "../../core/useMedia";
import { theaterInk } from "../../mlb/theater/theaterInk";
import { charge, hoopsFrame } from "./directedCourt";
import { drawBasketballFrame, drawCourt, HoopProjection, layoutLabels, type BasketballTeams, type Labels, type Paint } from "./drawBasketball";
import { useSlideDirected } from "../../core/scoringSlides";

export interface BasketballDirectedProps {
  readonly source: BroadcastTheaterSource;
  readonly cues: TheaterCues | null;
  /** Who's playing (the lane's teams). */
  readonly teams: Teams;
  readonly kits: TheaterKits;
  readonly palette: TeamPalette;
  /** The teams as the tag names them ("SPURS BALL"). */
  readonly names: { readonly top: string; readonly bottom: string };
  /** The home team's name, at center court. */
  readonly homeName: string;
  readonly eventId: string;
  readonly people?: Readonly<Record<string, TheaterPerson>>;
  /** When the lane last brought a play (epoch ms): the heartbeat counts from it. */
  readonly heard?: number | null;
  /** A game held up says so over anything else, in ESPN's words ("Rain Delay"): TheaterStatus.holding. */
  readonly holding?: string | null;
}

const NO_PEOPLE: Readonly<Record<string, TheaterPerson>> = {};

/** A team's paint (TheaterTeams.solid): its own color, or a gray for one with none. */
function solid(color: string, scheme: Scheme): string {
  return color === NEUTRAL || !color.startsWith("#") ? (scheme === "dark" ? "#b8b8b8" : "#808080") : color;
}

export const hoopsFacts = (teams: Teams, flipped: boolean): HoopsFacts => ({
  topIsHome: teams.topIsHome,
  flipped,
  topID: teams.topID,
  bottomID: teams.bottomID,
  topName: teams.topName,
  bottomName: teams.bottomName,
});

export default function BasketballDirected({ source, cues, teams, kits, palette, names, homeName, eventId, people = NO_PEOPLE, heard: given = null, holding = null }: BasketballDirectedProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const well = useRef<HTMLDivElement>(null);
  const stage = useRef<DirectedStage<HoopsClip> | null>(null);
  const [flipped, flip] = useTheaterFlip(eventId);
  const facts = hoopsFacts(teams, flipped);
  const director = useDirector(() => new TheaterDirector(HoopsSport, facts), eventId);
  useDirected(director, source, facts, cues);
  if (import.meta.env.DEV) (window as unknown as { __director?: unknown }).__director = director;
  useSlideDirected("court", cues);
  const scheme = useColorScheme();
  const level = useSettings((s) => s.celebrationLevel);
  const reduceMotion = useReducedMotion();
  const moment = useChartMoment("court");
  const nameTags = useTheaterNames(well, stage);
  const [height, setHeight] = useState(0);
  const [said, setSaid] = useState<Said | null>(null);
  const heard = useHeard(source, given);
  const scratch = useMemo(() => new FrameScratch(), []);
  const shown = useMemo(() => new DirectedFrame(), []);

  const dressed = useMemo(
    () => dress(kits, scheme),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kits.top.color, kits.top.alternate, kits.bottom.color, kits.bottom.alternate, scheme],
  );
  const teamsBy = useMemo((): Record<Side, BasketballTeams> => ({ top: { offense: dressed.top, defense: dressed.bottom }, bottom: { offense: dressed.bottom, defense: dressed.top } }), [dressed]);
  // The paint in the home team's color, its name at center court.
  const paint: Paint = useMemo(
    () => ({ color: solid(teams.topIsHome ? palette.top : palette.bottom, scheme), name: homeName.toUpperCase(), three: Hoops.three }),
    [teams.topIsHome, palette.top, palette.bottom, scheme, homeName],
  );
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
    let bursts: { key: string; value: readonly StageBurst[] } | null = null;
    let lastSaid: string | null | undefined = undefined;
    const report = (next: Said | null) => {
      const key = next ? `${next.text}|${next.side ?? ""}` : null;
      if (key === lastSaid) return;
      lastSaid = key;
      setSaid(next);
    };
    /** The last play told before the court between plays on screen (the stoppage its tag keeps saying). */
    const context = (): BasketballScene | null => {
      const chain = director.chain;
      if (scratch.plan < 0 || scratch.plan >= chain.plans.length) return null;
      const plan = chain.plans[scratch.plan]!.plan;
      const k = charge(plan, scratch.p);
      if (k == null) return null;
      for (let i = k; i >= 0; i--) {
        const scene = plan.placements[i]!.clip.scene;
        if (scene && scene.kind !== "substitution") return scene;
      }
      return null;
    };
    stage.current?.update((ctx, size: Size, pt, wall, T) => {
      const chain = director.chain;
      chain.sample(T, scratch);
      const drawn = hoopsFrame(chain, scratch, size);
      if (!drawn) return;
      const { clip, t, world } = drawn;
      const script = clip.script;
      const teamsNow = teamsBy[script.side ?? "top"];
      const h = new HoopProjection(size, world.camera, world.yaw);
      // What the tag says: the play being told (as today's stage words it), else the court between plays after the last.
      const scene = clip.scene;
      const told: Said | null = scene ? statusDuring({ scene, group: [], covers: [], skipped: 0 }, script, t, names) : statusBetween(context(), clip.rest, names);
      const saying: Said | null = holding ? { text: holding, side: null } : told;
      // The names: the clip in charge's cast, as the engine's men play it.
      const baked = chain.plans[scratch.plan]!;
      const placement = baked.plan.placements[drawn.placement]!;
      const cast = shown.castFor(`${baked.start}#${drawn.placement}|${flipped}`, placement.cast, () => basketballCast(script, scene, people, `${placement.play ?? "rest"}|${flipped}`));
      const hits = (): HitFigure[] =>
        world.figures.flatMap((f) => {
          if (!(f.opacity > 0.01)) return [];
          const lens = h.lens(f.at);
          return [{ index: f.index, ground: lens.origin, height: lens.height }];
        });
      shown.update(hits());
      const tags = nameTags.frame(cast, tagLabels, { status: saying?.text ?? null, flip: true, heartbeat: heard != null ? "trailing" : null }, hits);
      if (labels?.key !== clip || labels.size !== `${size.width}x${size.height}|${pt}`) {
        labels = { key: clip, size: `${size.width}x${size.height}|${pt}`, value: layoutLabels(ctx, scene, script, teamsNow, ink, size, pt) };
      }
      drawCourt(ctx, h, ink, paint);
      drawBasketballFrame(ctx, h, { script, t, teams: teamsNow, ink, labels: labels.value, tags, world });
      // A marquee's celebration: the page's moment for this play, its bursts on the clip's time.
      if (clip.kind === "replay" && scene && moment?.id === scene.id) {
        const key = `${scene.id}|${size.height}|${level}|${reduceMotion}`;
        if (bursts?.key !== key) bursts = { key, value: BasketballCelebration.theater(moment, scene, script, level, reduceMotion, size.height) };
        if (bursts.value.length > 0) {
          const end = Math.max(...bursts.value.map(stageBurstEnd));
          if (end > t) stage.current?.keepAwake(performance.now() + (end - t) * 1000);
          const color = (side: Side | null) => (side == null || side === script.side ? accentOf(teamsNow.offense, ink) : accentOf(teamsNow.defense, ink));
          drawBursts(ctx, bursts.value, t, (p) => h.at(p), TheaterType.bannerOrigin(size, pt), (b) => teamPalette(color((b as BasketballBurst).side ?? null), ink), size);
        }
      }
      report(saying);
    }, reduceMotion);
  }, [director, scratch, shown, teamsBy, paint, ink, names, flipped, people, tagLabels, nameTags, heard, holding, moment, level, reduceMotion]);

  return (
    <div ref={well} className={styles.well} data-theater="basketball" data-directed="">
      <canvas ref={canvas} className={styles.canvas} aria-hidden="true" />
      <TheaterStatusTag tag={said?.text ?? null} tint={said?.side ? (said.side === "top" ? (kits.top.color ?? null) : (kits.bottom.color ?? null)) : null} height={height} />
      <TheaterHeartbeat updated={heard} source="ESPN" />
      <TheaterFlipButton surface="court" flipped={flipped} onFlip={flip} />
    </div>
  );
}
