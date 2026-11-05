/**
 * The football theater on the choreography engine, while the page
 * broadcasts the game (FootballTheater.swift `FootballDirectedStage`): each
 * snap told at its anchor on the broadcast's clock, the field between snaps
 * from where the last left everyone, every hand-off (a replay after another,
 * a touchdown's try) a splice: nothing cuts, nothing crossfades. Frames come
 * at the plan's tiers on the theater's time, only while the field is seen
 * (directedStage.ts). Over the field, as today: the broadcast tag, the
 * heartbeat, the names over the men, the field's turn on hover. The scoring
 * slide lands on the plan's scored cue (`useSlideDirected`). Today's
 * FootballTheater stays for a page that isn't broadcasting.
 *
 *     <FootballDirected source={broadcast} cues={cues} teams={teams} kits={kits} palette={palette} names={names} topName="DAL" bottomName="PHI" situation={situation} eventId={id} heard={heard} />
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Football } from "../../../../data/gameDetail";
import type { FootballTeams as LaneTeams } from "../../../../data/liveFeeds/football";
import { dress, type TheaterKits } from "../../../../data/mlb/theaterTeams";
import type { Side } from "../../../../data/models";
import { NEUTRAL, type Scheme, type TeamPalette } from "../../../../data/teamColors";
import { gridFacts, GridSport, type GridClip } from "../../../../data/theater/footballClips";
import { FootballStatus, type StatusNames, type StatusTag } from "../../../../data/theater/footballIdle";
import { footballCast } from "../../../../data/theater/footballTheater";
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
import { gridFrame, type GridDrawn } from "./directedField";
import { drawFootballFrame, drawGridiron, GridProjection, layoutLabels, type EndZone, type FootballTeams, type Labels } from "./drawFootball";

export interface FootballDirectedProps {
  readonly source: BroadcastTheaterSource;
  readonly cues: TheaterCues | null;
  /** Who's playing (the lane's teams). */
  readonly teams: LaneTeams;
  readonly kits: TheaterKits;
  /** The page's palette: the end zones wear it. */
  readonly palette: TeamPalette;
  /** The end zones' names (the teams' abbreviations). */
  readonly topName: string;
  readonly bottomName: string;
  /** The teams as the tag names them ("EAGLES BALL"). */
  readonly names: { readonly top: string; readonly bottom: string };
  /** The live situation: the down and distance and the timeouts left, for the tag between snaps. */
  readonly situation: Football | null;
  readonly eventId: string;
  readonly people?: Readonly<Record<string, TheaterPerson>>;
  /** When the lane last brought a play (epoch ms): the heartbeat counts from it. */
  readonly heard: number | null;
  /** A game held up says so over anything else, in ESPN's words ("Weather Delay"): TheaterStatus.holding. */
  readonly holding?: string | null;
}

const NO_PEOPLE: Readonly<Record<string, TheaterPerson>> = {};
const NO_STATUS: StatusTag = { tag: null, tint: null };

/** A team's end-zone color (TheaterTeams.solid): its own, or a gray for one with none. */
function solid(color: string, scheme: Scheme): string {
  return color === NEUTRAL || !color.startsWith("#") ? (scheme === "dark" ? "#b8b8b8" : "#808080") : color;
}

/** A team's color for the tag, as hex without the hash (the kit's own, else none). */
const tagColor = (color: string | null | undefined): string | null => (color ? color.replace(/^#/, "") : null);

export default function FootballDirected({ source, cues, teams, kits, palette, topName, bottomName, names, situation, eventId, people = NO_PEOPLE, heard, holding = null }: FootballDirectedProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const well = useRef<HTMLDivElement>(null);
  const stage = useRef<DirectedStage<GridClip> | null>(null);
  const [flipped, flip] = useTheaterFlip(eventId);
  const facts = gridFacts(teams, flipped);
  const director = useDirector(() => new TheaterDirector(GridSport, facts), eventId);
  useDirected(director, source, facts, cues);
  if (import.meta.env.DEV) (window as unknown as { __director?: unknown }).__director = director;
  useSlideDirected("field", cues);
  const scheme = useColorScheme();
  const reduceMotion = useReducedMotion();
  const nameTags = useTheaterNames(well, stage);
  const [height, setHeight] = useState(0);
  const [status, setStatus] = useState<StatusTag>(NO_STATUS);
  const scratch = useMemo(() => new FrameScratch(), []);
  const shown = useMemo(() => new DirectedFrame(), []);

  const dressed = useMemo(
    () => dress(kits, scheme),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kits.top.color, kits.top.alternate, kits.bottom.color, kits.bottom.alternate, scheme],
  );
  // Each side's look with the ball.
  const teamsBy = useMemo((): Record<Side, FootballTeams> => ({ top: { offense: dressed.top, defense: dressed.bottom }, bottom: { offense: dressed.bottom, defense: dressed.top } }), [dressed]);
  // The end zones: the offense's own nearest the camera, the one it attacks at the far end.
  const zonesBy = useMemo((): Record<Side, { near: EndZone; far: EndZone }> => {
    const top: EndZone = { color: solid(palette.top, scheme), name: topName.toUpperCase() };
    const bottom: EndZone = { color: solid(palette.bottom, scheme), name: bottomName.toUpperCase() };
    return { top: { near: top, far: bottom }, bottom: { near: bottom, far: top } };
  }, [palette.top, palette.bottom, scheme, topName, bottomName]);
  const ink = useMemo(() => theaterInk(scheme), [scheme]);
  const tagLabels = useMemo(
    () => theaterLabels(kits, scheme, names),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kits.top.color, kits.top.alternate, kits.bottom.color, kits.bottom.alternate, scheme, names.top, names.bottom],
  );
  const statusNames: StatusNames = useMemo(
    () => ({ top: names.top, bottom: names.bottom, topColor: tagColor(kits.top.color), bottomColor: tagColor(kits.bottom.color) }),
    [names.top, names.bottom, kits.top.color, kits.bottom.color],
  );
  const downDistance = situation?.downDistance ?? null;
  const topTimeouts = situation?.topTimeouts ?? null;
  const bottomTimeouts = situation?.bottomTimeouts ?? null;

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
    const report = (next: StatusTag) => {
      const key = next.tag == null ? null : `${next.tag}|${next.tint ?? ""}`;
      if (key === lastSaid) return;
      lastSaid = key;
      setStatus(next);
    };
    /** What the tag says: the snap being told (its headline says it for itself), else the field between snaps; a game held up, that. */
    const statusOf = ({ clip, t }: GridDrawn): StatusTag => {
      let said: StatusTag = NO_STATUS;
      if (clip.scene) {
        const banner = clip.script.banner;
        const up = banner != null && t >= banner.at - 0.3 && t < banner.until + 0.3;
        said = up ? NO_STATUS : FootballStatus.replay(clip.scene, clip.script, t, statusNames);
      } else if (clip.idle) {
        said = FootballStatus.idle(clip.idle, clip.stoppage, clip.script, t, statusNames, downDistance, { top: topTimeouts, bottom: bottomTimeouts });
      }
      return holding ? { tag: holding, tint: null } : said;
    };
    stage.current?.update((ctx, size: Size, pt, _wall, T) => {
      const chain = director.chain;
      chain.sample(T, scratch);
      const drawn = gridFrame(chain, scratch, size);
      if (!drawn) return;
      const { clip, t, world } = drawn;
      const script = clip.script;
      const teamsNow = teamsBy[clip.offense];
      const zones = zonesBy[clip.offense];
      const f = new GridProjection(size, world.camera, world.yaw);
      const status = statusOf(drawn);
      // The names: the clip in charge's cast, as the engine's men play it.
      const baked = chain.plans[scratch.plan]!;
      const k = drawn.placement;
      const placement = baked.plan.placements[k]!;
      const cast = shown.castFor(`${baked.start}#${k}|${flipped}`, placement.cast, () =>
        footballCast(script, clip.scene, clip.offense, people, placement.play != null ? `${placement.play}|${flipped}` : "idle"),
      );
      const hits = (): HitFigure[] =>
        world.figures.flatMap((w) => {
          if (!(w.opacity > 0.01)) return [];
          const lens = RigLens.grid(f, w.at);
          return [{ index: w.index, ground: lens.origin, height: lens.height }];
        });
      shown.update(hits());
      const tags = nameTags.frame(cast, tagLabels, { status: status.tag, flip: true, heartbeat: heard != null ? "trailing" : null }, hits);
      if (labels?.key !== clip || labels.size !== `${size.width}x${size.height}|${pt}`) {
        labels = { key: clip, size: `${size.width}x${size.height}|${pt}`, value: layoutLabels(ctx, clip.scene, script, teamsNow, ink, size, pt) };
      }
      drawGridiron(ctx, f, ink, zones.near, zones.far);
      drawFootballFrame(ctx, f, { script, t, teams: teamsNow, ink, labels: labels.value, tags, world });
      report(status);
    }, reduceMotion);
  }, [director, scratch, shown, teamsBy, zonesBy, ink, statusNames, flipped, people, tagLabels, nameTags, heard, holding, downDistance, topTimeouts, bottomTimeouts, reduceMotion]);

  return (
    <div ref={well} className={styles.well} data-theater="football" data-directed="">
      <canvas ref={canvas} className={styles.canvas} aria-hidden="true" />
      <TheaterStatusTag tag={status.tag} tint={status.tint} height={height} />
      <TheaterHeartbeat updated={heard} source="ESPN" />
      <TheaterFlipButton surface="field" flipped={flipped} onFlip={flip} />
    </div>
  );
}
