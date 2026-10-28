/**
 * The climbing round page (DetailView.swift's climbing sections): On the
 * Wall (lead finals and semis, one climber at a time), High Points (lanes
 * per route), the boulder Scorecard, the live Results with your countries
 * highlighted, the Starting Order, and Watch (World Climbing's channel).
 *
 * The hero is dressed in the flag of whoever the round is about: the
 * climber on the wall while it's live, else the leader or winner, changing
 * like a change of light. A decided final's winner line carries the trophy.
 *
 * Live, the fast lane refreshes the round every 4 s (IFSC updates a
 * climber's score hold by hold; DetailView.fastLane), and each refresh is
 * compared with the last: a top, a pass, a new leader, the medal zone, the
 * final decided, a boulder topped or zoned (data/climbing.ts
 * `climbingMoments`). Untracked disciplines are never fetched (useGame).
 */
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { climbingMoments, decided, dockClimber, isFinalRound, liveFieldSummary, resultsCaption, roundLive, wallCaption, washCountry } from "../../../data/climbing";
import { dayAndTime, ordinal } from "../../../data/format";
import { EMPTY_DETAIL, type GameDetail } from "../../../data/gameDetail";
import { Accessory, type AccessoryTier } from "../../../data/matchRules";
import type { Section } from "../../../data/sections";
import { FLAG_PALETTE } from "../../../data/teams";
import type { TeamPalette } from "../../../data/teamColors";
import { queryClient } from "../../../state/scores";
import { useSettings } from "../../../state/settings";
import { wallExcerpt } from "../../../data/peek";
import { DetailSection } from "../core/DetailSection";
import type { PeekSource } from "../core/peek";
import { useCurrentMoment } from "../core/moments";
import { LANE_INTERVAL, useFastLane, type GameContext, type SportPage } from "../core/sport";
import { HighPoints } from "./HighPoints";
import { LeadAscent } from "./LeadAscent";
import { BoulderScorecard, ClimbingWatch, RankingList } from "./Rankings";
import styles from "./Climbing.module.css";

/** Your climbing countries (IOC codes), when the climbing filter is on (ScoreStore.climbingCountries). */
function useClimbingCountries(): ReadonlySet<string> {
  const filtered = useSettings((s) => s.filteredLeagues);
  const filters = useSettings((s) => s.teamFilters);
  return useMemo(() => new Set(filtered.includes("ifsc") ? (filters["ifsc"] ?? []).map((id) => id.replace("country-", "")) : []), [filtered, filters]);
}

export function useClimbingPage(game: GameContext): SportPage {
  const { event, detail, live } = game;
  const loaded = detail !== EMPTY_DETAIL;
  const ref = event.ref?.kind === "climbing" ? event.ref : null;
  const yours = useClimbingCountries();
  const isLive = roundLive(detail, event.state);
  const moment = useCurrentMoment();

  // IFSC updates a climber's score hold by hold: the whole round, every 4 s, while it's live. Each
  // tick waits for its load (joining one already under way), so a slow answer is never cancelled
  // by the next tick.
  useFastLane(live && loaded && isLive, LANE_INTERVAL.climbing, async () => {
    await queryClient.refetchQueries({ queryKey: ["detail", event.id], exact: true }, { cancelRefetch: false });
  });

  // Each refresh against the last (same page, live): the moments since.
  const previous = useRef<GameDetail | null>(null);
  useEffect(() => {
    if (!loaded) return;
    const before = previous.current;
    previous.current = detail;
    if (!before || before === detail || event.state !== "live") return;
    const moments = climbingMoments(before, detail);
    if (moments.length > 0) game.moments.offer(moments);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, loaded]);

  // The flag the page is dressed in.
  const country = loaded ? washCountry(detail, live) : null;
  const pair = country ? FLAG_PALETTE[country] : undefined;
  const wash: TeamPalette | null = pair ? { top: `#${pair[0]}`, bottom: `#${pair[1]}` } : null;

  const sections: Partial<Record<Section, ReactNode>> = {};
  const category = ref?.category ?? "";
  const roundName = detail.roundName;
  const route = detail.wall[0];
  // One route, one climber at a time (finals and semis): who's on the wall. It stays while its moment
  // holds: the last climber's finish (a final decided) celebrates where it happened before the page moves on.
  const ascent = detail.wall.length === 1 && route != null && ((isLive && (route.climbers.some((c) => c.onWall) || detail.upNext != null)) || (live && moment?.chart === "ascent"));
  if (ascent && route) {
    const climbing = route.climbers.find((c) => c.onWall);
    sections.ascent = (
      <DetailSection id="ascent" title="On the Wall" caption={climbing ? `${climbing.name} is climbing. Marks show where everyone before them reached.` : "Between climbers. Marks show where everyone so far reached."} accessory="live">
        <LeadAscent route={route} upNext={detail.upNext} yours={yours} roundName={roundName} />
      </DetailSection>
    );
  }
  // While a final is on, the climber-by-climber view above covers it.
  if (detail.wall.length > 0 && !ascent) {
    sections.wall = (
      <DetailSection id="wall" title={`${roundName ?? "Route"} · High Points`} caption={wallCaption(detail, { state: event.state, start: event.start, round: ref?.round ?? null }, (start) => dayAndTime(start, Date.now()))} accessory={isLive ? "live" : "final"}>
        <HighPoints routes={detail.wall} live={isLive} yours={yours} />
      </DetailSection>
    );
  }
  if (detail.boulders.length > 0) {
    sections.scorecard = (
      <DetailSection id="scorecard" title={`${roundName ?? "Round"} · Scorecard`} caption="Each boulder: lower half for the zone, upper half for the top. Numbers show attempts." accessory={isLive ? "live" : "final"}>
        <BoulderScorecard cards={detail.boulders} problems={detail.boulderProblems} yours={yours} live={isLive} />
      </DetailSection>
    );
  }
  // A past round's stream is long over: the channel's live one isn't it.
  if (event.state !== "final" || event.start > Date.now() - 86_400_000) {
    sections.climbingWatch = (
      <DetailSection id="climbingWatch" title="Watch" caption="Official World Climbing streams on YouTube.">
        <ClimbingWatch final={event.state === "final"} />
      </DetailSection>
    );
  }
  if (detail.ranking.length > 0) {
    sections.results = (
      <DetailSection id="results" title={isLive ? `${roundName ?? "Round"} · Live` : `${roundName ?? "Round"} Results`} caption={resultsCaption(category, roundName)}>
        <RankingList athletes={detail.ranking} yours={yours} live={isLive} />
      </DetailSection>
    );
  }
  // This round before anyone finishes, or the next round before it starts.
  if (detail.startlist.length > 0 && (detail.ranking.length === 0 || detail.startlistRound !== roundName)) {
    const climbingNow = isLive && detail.startlistRound === roundName;
    sections.startlist = (
      <DetailSection
        id="startlist"
        title={`${detail.startlistRound ?? "Round"} · Starting Order`}
        caption={climbingNow ? "Climbing now, in this order. Results appear as each climber finishes." : `Who climbs in the ${(detail.startlistRound ?? "next round").toLowerCase()}, in order. Results appear once it starts.`}
        accessory={climbingNow ? "live" : undefined}
      >
        <RankingList athletes={detail.startlist} yours={yours} live={false} />
      </DetailSection>
    );
  }

  // The chart peek (LinkedPeek): a result or a starting-order row lights its climber on the wall, the high points or the scorecards.
  const peek: PeekSource = {
    inputs: {
      ascent: ascent && route ? route.climbers.map((c) => ({ id: String(c.id), lead: c.name, detail: c.label })) : [],
      wall: detail.wall.flatMap((r) => r.climbers).map((c) => ({ id: String(c.id), lead: c.name, detail: c.label })),
      cards: detail.boulders.map((c) => ({ id: String(c.id), lead: c.name, detail: c.score ?? "" })),
    },
    chart: (section, focus) => {
      switch (section) {
        case "ascent":
          return route ? <LeadAscent route={route} upNext={detail.upNext} yours={yours} roundName={roundName} /> : null;
        case "wall":
          // List-like charts narrow to the climber (and their neighbors).
          return <HighPoints routes={focus?.athlete != null ? wallExcerpt(detail.wall, focus.athlete) : detail.wall} live={isLive} yours={yours} />;
        case "scorecard": {
          const cards = focus?.athlete != null ? detail.boulders.filter((c) => c.id === focus.athlete) : [];
          return <BoulderScorecard cards={cards.length > 0 ? cards : detail.boulders} problems={detail.boulderProblems} yours={yours} live={isLive} />;
        }
        default:
          return null;
      }
    },
  };

  const line = loaded ? dockClimber(detail, event.state) : null;
  const trophy = isFinalRound(roundName) && (event.state === "final" || decided(detail.wall)) ? "field" : null;
  const onWall = detail.wall.flatMap((r) => r.climbers).find((c) => c.onWall);

  return {
    sections,
    peek,
    clockFallback: event.detail ?? "Live",
    fieldSummary: loaded ? liveFieldSummary(detail, event.state) : null,
    heroSpoken: live && onWall ? `${onWall.name} is climbing, at ${onWall.label}` : null,
    wash,
    trophy,
    dockLead: line
      ? (tier: AccessoryTier) => (
          <span className={styles.dock}>
            {line.prefix ? (
              <>
                <span className={styles.dockPrefix}>{line.prefix}</span>
                <span className={styles.dockDot}>·</span>
              </>
            ) : null}
            {line.flag ? <span className={styles.dockFlag}>{line.flag}</span> : null}
            <span className={styles.dockName}>{line.name}</span>
            {line.height ? (
              <>
                <span className={styles.dockDot}>·</span>
                <span className={styles.dockHeight}>{line.height}</span>
              </>
            ) : null}
            {line.boulder ? (
              <>
                <span className={styles.dockDot}>·</span>
                <span className={styles.dockBoulder}>{line.boulder}</span>
              </>
            ) : null}
            {line.tally && tier >= Accessory.text ? (
              <>
                <span className={styles.dockDot}>·</span>
                <span className={styles.dockTally}>{line.tally}</span>
              </>
            ) : null}
            {line.place != null && tier >= Accessory.full ? <span className={styles.dockPlace}>{ordinal(line.place)}</span> : null}
          </span>
        )
      : undefined,
  };
}
