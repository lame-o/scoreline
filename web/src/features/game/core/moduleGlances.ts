/**
 * What each folded module says in one line, from the data every page has
 * (DetailView.glance): the newest play, the latest period, the newest score,
 * the stats, where to watch, each side's chance, the NBA's leaders, box,
 * injuries, flow and shooting, this at-bat, the balls in play, soccer's
 * timeline. A sport's page adds what only its lane knows (the Live View, the
 * field, the live pitch, at the plate: `SportPage.glance`). Asked only for
 * folded modules.
 */
import type { GameDetail } from "../../../data/gameDetail";
import {
  atBatGlance,
  boxGlance,
  broadcastersGlance,
  chancesGlance,
  flowGlance,
  glanceText,
  injuriesGlance,
  leadersGlance,
  linescoreGlance,
  newestGlance,
  playGlance,
  shootingFromShots,
  shootingFromTotals,
  shootingGlance,
  statsGlance,
  timelineGlance,
  type ModuleGlance,
} from "../../../data/modules";
import type { ScoreEvent } from "../../../data/models";
import type { Section } from "../../../data/sections";
import { NEUTRAL, type TeamPalette } from "../../../data/teamColors";

export interface GlanceInputs {
  readonly event: ScoreEvent;
  readonly detail: GameDetail;
  readonly palette: TeamPalette;
  readonly names: { readonly top: string; readonly bottom: string };
  /** The hero's numbers (a lane's while it's ahead). */
  readonly scores: { readonly top: string | null; readonly bottom: string | null };
}

export function commonGlance(section: Section, { event, detail: d, palette, names, scores }: GlanceInputs): ModuleGlance | null {
  const live = event.state === "live";
  const soccer = event.ref?.kind === "espn" && event.ref.sport === "soccer";
  const baseball = event.ref?.kind === "espn" && event.ref.sport === "baseball";
  const nba = d.basketball;
  switch (section) {
    case "plays":
    case "liveView":
      return d.recentPlays[0] ? playGlance(d.recentPlays[0]) : null;
    case "linescore":
      return d.linescore ? linescoreGlance(d.linescore, names, baseball, live) : null;
    case "moments":
      return newestGlance(d.moments, soccer);
    case "stats":
      return statsGlance(d.stats);
    case "whereToWatch":
      return broadcastersGlance(d.broadcasters.map((b) => b.name));
    case "timeline":
      return soccer ? timelineGlance(d.moments, `${scores.top ?? "0"}–${scores.bottom ?? "0"}`) : null;
    case "court": {
      if (!nba) return null;
      const top = shootingFromTotals(nba.topTotals["FG"], nba.topTotals["3PT"]) ?? shootingFromShots(nba.shots, "top");
      const bottom = shootingFromTotals(nba.bottomTotals["FG"], nba.bottomTotals["3PT"]) ?? shootingFromShots(nba.shots, "bottom");
      return shootingGlance(top, bottom, names);
    }
    case "flow":
      return nba ? flowGlance(nba.flow, names) : null;
    case "leaders":
      return nba ? leadersGlance(nba.leaders) : null;
    case "box":
      return nba ? boxGlance(nba.topBox, live) : null;
    case "injuries":
      return nba ? injuriesGlance(nba.injuries) : null;
    case "atBat":
      return atBatGlance(d.atBat);
    case "battedBalls": {
      const last = d.battedBalls.at(-1);
      return last ? glanceText(d.battedBalls.length === 1 ? "1 in play" : `${d.battedBalls.length} in play`, last.text) : null;
    }
    case "winProbability": {
      // ESPN's bar (Polymarket's chart says its own).
      const p = d.topWinProbability;
      if (p == null) return null;
      const draw = d.drawProbability;
      return chancesGlance(
        { top: p, draw, bottom: Math.max(1 - p - (draw ?? 0), 0) },
        event.state === "final",
        { color: palette.top, name: names.top },
        draw == null ? null : NEUTRAL,
        { color: palette.bottom, name: names.bottom },
      );
    }
    default:
      return null;
  }
}
