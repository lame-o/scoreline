/**
 * The baseball theater on the choreography engine, while the page
 * broadcasts the game (PlayTheater.swift `PlayDirectedStage`): each pitch's
 * beat and each play's replay told at its anchor on the broadcast's clock
 * (MLB's own pitch times when the timeline has them), the field between
 * pitches between them, every hand-off a splice (nothing cuts, nothing
 * crossfades); frames come at the plan's tiers on the theater's time, only
 * while the field is seen (directedStage.ts). Over the field, as today: the
 * tag (the count, a pitch's call, the stoppage), the heartbeat, the names.
 * The scoring slide lands with the plan's decisive frame, with Statcast's
 * batted line when MLB has measured the play.
 *
 *     <BaseballDirected source={broadcast} cues={cues} kits={kits} topID="8" bottomID="30" topTeam="Brewers" bottomTeam="Rays" eventId={id} heard={heard} />
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { DiamondSport, type DiamondClip, type DiamondFacts } from "../../../../data/mlb/baseballClips";
import { NO_FIELDERS, type BaseballFielders } from "../../../../data/mlb/fielders";
import { batting as battingOf, captionText, standing, type PlayBeat } from "../../../../data/mlb/playBeat";
import { playCast } from "../../../../data/mlb/playNames";
import type { TheaterState } from "../../../../data/mlb/playScene";
import { theaterTeams, type TheaterKits } from "../../../../data/mlb/theaterTeams";
import type { Side } from "../../../../data/models";
import { TheaterDirector } from "../../../../data/theater/theaterDirector";
import { FrameScratch } from "../../../../data/theater/theaterFrameScratch";
import { theaterLabels, type TheaterPerson } from "../../../../data/theater/theaterNames";
import type { BroadcastTheaterSource } from "../../../../data/theater/theaterSource";
import { DirectedFrame, type TheaterCues } from "../../../../data/theater/theaterView";
import { useColorScheme } from "../../../../state/theme";
import { useSlideDirected } from "../../core/scoringSlides";
import { DirectedStage } from "../../core/theater/directedStage";
import { TheaterHeartbeat, TheaterStatusTag } from "../../core/theater/TheaterStatus";
import { useDirected, useDirector } from "../../core/theater/useDirected";
import { useTheaterNames } from "../../core/theater/useTheaterNames";
import { useReducedMotion } from "../../core/useMedia";
import { diamondFrame } from "./directedField";
import { drawField, drawFrame, FieldProjection, layoutLabels, worldFigures, type Labels } from "./drawTheater";
import { theaterInk } from "./theaterInk";
import styles from "./PlayTheater.module.css";

export interface BaseballDirectedProps {
  readonly source: BroadcastTheaterSource;
  readonly cues: TheaterCues | null;
  /** The teams' own and second colors, so the figures always contrast. */
  readonly kits: TheaterKits;
  /** The teams as ESPN names them (its plays' `team.id`): MLB's visitors bat in the top. */
  readonly topID: string | null;
  readonly bottomID: string | null;
  /** The teams' names, for a man the tags can't name ("BREWERS"). */
  readonly topTeam?: string;
  readonly bottomTeam?: string;
  /** The box score's names (the timeline's beats name who came in by them). */
  readonly names?: Readonly<Record<string, string>>;
  readonly eventId: string;
  /** The summary's players (by athlete ID) and who's in the field, MLB's numbers by name: the names over the figures. */
  readonly people?: Readonly<Record<string, TheaterPerson>>;
  readonly fielders?: BaseballFielders;
  readonly numbers?: Readonly<Record<string, string>>;
  /** When the lane last brought a play (epoch ms): the heartbeat counts from it. */
  readonly heard: number | null;
  /** A game held up says so over anything else, in ESPN's words ("Rain Delay"), and the tarp's out: TheaterStatus.holding. */
  readonly holding?: string | null;
  /** The lane's play with MLB's account in it (useStatcast.ts `useMeasuredTheater`): the slide's distance and exit velocity. */
  readonly state?: TheaterState | null;
}

const NO_PEOPLE: Readonly<Record<string, TheaterPerson>> = {};
const NO_NAMES: Readonly<Record<string, string>> = {};
const NO_RUNNERS: readonly [string | null, string | null, string | null] = [null, null, null];

/** What the tag says, and in whose color. */
interface Said {
  readonly text: string | null;
  readonly side: Side | null;
}

/**
 * The tag, as today's stage words it (`PlayDirectedStage.status`): nothing
 * while a play replays; a beat's captions as they come; between, where the
 * game stands after the last beat told. The team at bat's color for the
 * count, a pitch, a batter stepping in, a play.
 */
export function directedStatus(clip: DiamondClip, t: number, last: PlayBeat | null, wide: boolean): Said {
  let tag: string | null = null;
  let about: PlayBeat | null = null;
  switch (clip.kind) {
    case "play":
      break;
    case "beat": {
      about = clip.beat;
      const caption = clip.script.captions.findLast((c) => c.at <= t);
      if (clip.beat && caption) tag = captionText(clip.beat, caption.line, wide);
      else tag = last ? standing(last) : null;
      break;
    }
    case "rest":
      about = last;
      tag = last ? standing(last) : null;
  }
  const k = about?.kind.kind;
  const side = about && (k === "pitch" || k === "batterUp" || k === "play") ? battingOf(about) : null;
  return { text: tag, side };
}

export default function BaseballDirected({
  source,
  cues,
  kits,
  topID,
  bottomID,
  topTeam = "",
  bottomTeam = "",
  names = NO_NAMES,
  eventId,
  people = NO_PEOPLE,
  fielders = NO_FIELDERS,
  numbers = NO_NAMES,
  heard,
  holding = null,
  state = null,
}: BaseballDirectedProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const well = useRef<HTMLDivElement>(null);
  const stage = useRef<DirectedStage<DiamondClip> | null>(null);
  // Held up (ESPN's status says so): the tarp's out.
  const facts: DiamondFacts = { topID, bottomID, names, heldUp: holding };
  const director = useDirector(() => new TheaterDirector(DiamondSport, facts), eventId);
  useDirected(director, source, facts, cues);
  if (import.meta.env.DEV) (window as unknown as { __director?: unknown }).__director = director;
  // The scoring slide lands with the plan's decisive frame; Statcast's batted line as the stage's slide has it (slidePlate.ts).
  useSlideDirected("plate", cues, (id) => (state?.play?.id === id ? (state.play.measured?.batted ?? null) : null));
  const scheme = useColorScheme();
  const reduceMotion = useReducedMotion();
  const nameTags = useTheaterNames(well, stage);
  const [height, setHeight] = useState(0);
  const [said, setSaid] = useState<Said | null>(null);
  const scratch = useMemo(() => new FrameScratch(), []);
  const shown = useMemo(() => new DirectedFrame(), []);

  const teamsBy = useMemo(
    () => ({ top: theaterTeams(kits, scheme, "top"), bottom: theaterTeams(kits, scheme, "bottom") }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kits.top.color, kits.top.alternate, kits.bottom.color, kits.bottom.alternate, scheme],
  );
  const ink = useMemo(() => theaterInk(scheme), [scheme]);
  const tagLabels = useMemo(
    () => theaterLabels(kits, scheme, { top: topTeam, bottom: bottomTeam }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kits.top.color, kits.top.alternate, kits.bottom.color, kits.bottom.alternate, scheme, topTeam, bottomTeam],
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
    const report = (next: Said) => {
      const key = `${next.text ?? ""}|${next.side ?? ""}`;
      if (key === lastSaid) return;
      lastSaid = key;
      setSaid(next);
    };
    stage.current?.update((ctx, size, pt, _wall, T) => {
      const chain = director.chain;
      chain.sample(T, scratch);
      const drawn = diamondFrame(chain, scratch, size);
      if (!drawn) return;
      const { clip, t, world } = drawn;
      const baked = chain.plans[scratch.plan]!;
      const plan = baked.plan;
      const placement = plan.placements[drawn.placement]!;
      // The beat the field between pitches follows: the last one told up to the clip in charge.
      let last: PlayBeat | null = null;
      for (let i = drawn.placement; i >= 0; i--) {
        const b = plan.placements[i]!.clip.beat;
        if (b) {
          last = b;
          break;
        }
      }
      const told = directedStatus(clip, t, last, size.width > 420);
      const saying: Said = holding ? { text: holding, side: null } : told;
      const teams = teamsBy[clip.batting];
      const f = new FieldProjection(size, world.camera);
      // The names: the clip in charge's own cast (the frame keys its figures by the clip's men).
      const own = clip.figures.map((_, i) => i);
      const cast = shown.castFor(`${baked.start}#${drawn.placement}`, own, () =>
        playCast(clip.script, clip.scene, clip.beat, clip.batting, fielders, people, numbers, { side: clip.batting, batter: null, pitcher: null, runners: NO_RUNNERS }, `${placement.play ?? "rest"}#${baked.start}`),
      );
      const hits = () => worldFigures(f, world);
      shown.update(hits());
      const tags = nameTags.frame(cast, tagLabels, { status: saying.text, flip: false, heartbeat: heard != null ? "trailing" : null }, hits);
      const sizeKey = `${size.width}x${size.height}|${pt}`;
      if (labels?.key !== clip || labels.size !== sizeKey) {
        labels = { key: clip, size: sizeKey, value: layoutLabels(ctx, { scene: clip.scene, script: clip.script, teams, ink, size, pt, statcast: clip.scene?.readout ?? null }) };
      }
      drawField(ctx, f, ink);
      drawFrame(ctx, f, { scene: clip.scene, script: clip.script, t, teams, ink, labels: labels.value, tags, world });
      report(saying);
    }, reduceMotion);
  }, [director, scratch, shown, teamsBy, ink, holding, fielders, people, numbers, tagLabels, nameTags, heard, reduceMotion]);

  const tint = said?.side ? (said.side === "top" ? kits.top.color : kits.bottom.color) : null;
  return (
    <div ref={well} className={styles.well} data-theater="baseball" data-directed="" aria-hidden="true">
      <canvas ref={canvas} className={styles.canvas} />
      <TheaterStatusTag tag={said?.text ?? null} tint={tint ?? null} height={height} />
      <TheaterHeartbeat updated={heard} source="ESPN" />
    </div>
  );
}
