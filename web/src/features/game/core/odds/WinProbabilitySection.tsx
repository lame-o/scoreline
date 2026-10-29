/**
 * Win Probability, grown up (ODDS-SPEC.md "Where it lives", ODDS-DECISIONS.md
 * "The section"): Polymarket's market as a live line against ESPN's model
 * and DraftKings' pregame line, in the section's place in each sport's
 * layout. Live and before the game it's "Win Probability"; once over, "How
 * the Odds Moved", the whole game's story.
 *
 * - Odds off (Settings), a league Polymarket doesn't list, or no confident
 *   match: ESPN's bar exactly as before (CommonSections.tsx `WinProbability`),
 *   or nothing where there was nothing.
 * - Which market is this game's is found as the page opens (one cached
 *   listing and one small request), since it decides whether the section
 *   shows at all; until then ESPN's bar stands in where there was one. The
 *   history, the socket and the polling follow only while the section is on
 *   screen (state/odds.ts).
 *
 * The header row: each team and its chance (the top team left, the bottom
 * right; soccer's draw between), and one muted line with ESPN's model and
 * DraftKings' line for the top team, the longest wording that fits on one
 * line. A final's header is where it began, at the start of play.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { nbaPalette } from "../../../../data/basketball";
import { percent, percentPair, spokenPercent, valueAt, type GameState, type OddsWindow } from "../../../../data/odds/chart";
import { seriesFor } from "../../../../data/odds/polymarket";
import type { Sport } from "../../../../data/models";
import { NEUTRAL } from "../../../../data/teamColors";
import { SegmentedControl } from "../../../../design/components";
import { useWidth } from "../../../../design/useWidth";
import { useOddsFeed, type OddsFeed, type OddsGame, type OddsSnapshot } from "../../../../state/odds";
import { useSettings } from "../../../../state/settings";
import { useColorScheme } from "../../../../state/theme";
import { WinProbability } from "../CommonSections";
import { DetailSection } from "../DetailSection";
import type { GameContext } from "../sport";
import { beforeStart, OddsChart } from "./OddsChart";
import styles from "./Odds.module.css";

const mark = (color: string): CSSProperties => ({ background: color === NEUTRAL ? "var(--viz-neutral)" : color });

/** Whether this game could have odds at all: odds on, an ESPN match in a league Polymarket lists. */
export function oddsPossible(game: GameContext, enabled: boolean): boolean {
  const ref = game.event.ref;
  return enabled && ref?.kind === "espn" && seriesFor(ref.path) != null && game.event.content.kind === "match";
}

/** Whether the section has anything for this game: odds possible, or ESPN's bar (live and before the game, as before). */
export function hasWinProbability(game: GameContext, enabled: boolean): boolean {
  return oddsPossible(game, enabled) || (game.detail.topWinProbability != null && game.event.state !== "final");
}

let measurer: CanvasRenderingContext2D | null = null;
/** A line's width at the caption size (10.5pt), in points. */
function lineWidth(text: string): number {
  if (typeof document === "undefined") return text.length * 5.5;
  measurer ??= document.createElement("canvas").getContext("2d");
  if (!measurer) return text.length * 5.5;
  measurer.font = `400 10.5px -apple-system, BlinkMacSystemFont, system-ui, sans-serif`;
  return measurer.measureText(text).width;
}

/** The game's start, as the muted line says it ("tip-off", "kickoff", "the first pitch"). */
const startWord = (sport: Sport) => (sport === "basketball" ? "tip-off" : sport === "baseball" ? "the first pitch" : "kickoff");

export function WinProbabilitySection({ game }: { game: GameContext }) {
  const enabled = useSettings((s) => s.odds);
  const { event, detail, names, spoken } = game;
  const possible = oddsPossible(game, enabled);
  const ref = event.ref?.kind === "espn" ? event.ref : null;
  const state: GameState = event.state === "live" ? "live" : event.state === "final" ? "final" : "scheduled";
  const basis = detail.odds;
  const top = event.content.kind === "match" ? event.content.top : null;
  const bottom = event.content.kind === "match" ? event.content.bottom : null;

  const oddsGame = useMemo((): OddsGame | null => {
    if (!possible || !ref || !top || !bottom) return null;
    const unique = (xs: readonly string[]) => xs.filter((x, i) => x && xs.indexOf(x) === i);
    return {
      id: event.id,
      path: ref.path,
      state,
      start: event.start,
      playStart: basis.start,
      playEnd: basis.end,
      names: { top: unique([top.name, ...basis.names.top]), bottom: unique([bottom.name, ...basis.names.bottom]) },
    };
  }, [possible, ref, top, bottom, event.id, event.start, state, basis.start, basis.end, basis.names]);

  // On screen or not (the feed debounces it: 0.25 s on, 2 s off), once there's a section to see.
  const section = useRef<HTMLDivElement>(null);
  const [onScreen, setOnScreen] = useState(false);
  const { feed, snapshot } = useOddsFeed(oddsGame, onScreen);
  const found = possible && snapshot.status === "ready" && snapshot.market != null;
  useEffect(() => {
    const el = section.current;
    if (!found || !el || typeof IntersectionObserver === "undefined") {
      setOnScreen(false);
      return;
    }
    const io = new IntersectionObserver(([entry]) => setOnScreen(entry?.isIntersecting ?? false));
    io.observe(el);
    return () => io.disconnect();
  }, [found]);

  if (found) {
    return (
      <div ref={section}>
        <OddsSection game={game} snapshot={snapshot} feed={feed} state={state} />
      </div>
    );
  }
  if (detail.topWinProbability != null && event.state !== "final") {
    return (
      <DetailSection
        id="winProbability"
        title="Win Probability"
        caption={event.state === "scheduled" ? "ESPN's matchup predictor, before tip-off." : "ESPN's estimate of each team's chance to win, updated live."}
      >
        <WinProbability topShare={detail.topWinProbability} draw={detail.drawProbability} topName={names.top} bottomName={names.bottom} palette={game.palette} spokenTop={spoken.top} spokenBottom={spoken.bottom} />
      </DetailSection>
    );
  }
  return null;
}

function OddsSection({ game, snapshot, feed, state }: { game: GameContext; snapshot: OddsSnapshot; feed: OddsFeed | null; state: GameState }) {
  const { event, detail, names, spoken } = game;
  const scheme = useColorScheme();
  const basis = detail.odds;
  const sport = event.ref?.kind === "espn" ? event.ref.sport : "basketball";
  const threeWay = snapshot.market?.kind === "three-way";
  const [span, setSpan] = useState<{ value: OddsWindow; instant: boolean }>({ value: "game", instant: false });
  const block = useRef<HTMLDivElement>(null);
  const width = useWidth(block);
  const live = state === "live";
  const final = state === "final";
  // Two sides that must read apart in every sport: the NBA page's clash rule (a near-twin steps to its second color).
  const palette = useMemo(
    () => (event.content.kind === "match" ? nbaPalette(event.content.top, event.content.bottom, scheme) : game.palette),
    [event.content, scheme, game.palette],
  );

  // The header: now (live, before the game), or the start of play (a final: the chart tells the rest).
  const at = final ? (basis.start ?? event.start) : null;
  const read = (outcome: "top" | "draw" | "bottom") => {
    const series = snapshot.series[outcome] ?? [];
    return at != null ? (valueAt(series, at)?.p ?? series[0]?.p ?? null) : (snapshot.current[outcome] ?? null);
  };
  const espnNow = at != null ? (valueAt(basis.win, at) ?? basis.win[0] ?? null) : (basis.win.at(-1) ?? null);
  const espnTop = espnNow?.top ?? (state === "scheduled" ? detail.topWinProbability : null);
  const pregame = basis.pregame;

  let left: { name: string; text: string; spoken: string; color: string };
  let right: { name: string; text: string; spoken: string; color: string };
  let draw: string | null = null;
  let spokenDraw: string | null = null;
  if (threeWay) {
    const a = read("top");
    const d = read("draw");
    const b = read("bottom");
    const sum = (a ?? 0) + (d ?? 0) + (b ?? 0) || 1;
    left = { name: names.top, text: a != null ? percent(a / sum) : "–", spoken: a != null ? spokenPercent(a / sum) : "unknown", color: palette.top };
    right = { name: names.bottom, text: b != null ? percent(b / sum) : "–", spoken: b != null ? spokenPercent(b / sum) : "unknown", color: palette.bottom };
    draw = d != null ? percent(d / sum) : null;
    spokenDraw = d != null ? spokenPercent(d / sum) : null;
  } else {
    // A two-way market's sides are complements: written so they add up to 100.
    const a = read("top");
    const pair = a != null ? percentPair(a) : null;
    left = { name: names.top, text: pair?.[0] ?? "–", spoken: a != null ? spokenPercent(a) : "unknown", color: palette.top };
    right = { name: names.bottom, text: pair?.[1] ?? "–", spoken: a != null ? spokenPercent(1 - a) : "unknown", color: palette.bottom };
  }

  // The muted line: the longest wording that fits on one line, shorter ones dropping trailing words.
  const when = beforeStart(sport);
  const variants: string[] = [];
  if (threeWay) {
    if (pregame && pregame.draw != null) {
      const odds = `${names.top} ${percent(pregame.top)} · Draw ${percent(pregame.draw)} · ${names.bottom} ${percent(pregame.bottom)}`;
      variants.push(`DraftKings ${when}: ${odds}`, `DraftKings: ${odds}`);
    }
  } else if (final) {
    const pm = left.text !== "–" ? `Polymarket ${left.text}` : null;
    const espn = espnTop != null ? `ESPN ${percent(espnTop)}` : null;
    const dk = pregame ? `DraftKings ${percent(pregame.top)}` : null;
    const lead = `${names.top} at ${startWord(sport)}: `;
    for (const parts of [[pm, espn, dk], [pm, dk], [pm]]) {
      const kept = parts.filter(Boolean);
      if (kept.length) variants.push(lead + kept.join(" · "));
    }
  } else {
    const espn = espnTop != null ? `ESPN ${percent(espnTop)}` : null;
    const lead = `For ${names.top}: `;
    if (pregame) variants.push(lead + [espn, `DraftKings ${percent(pregame.top)} ${when}`].filter(Boolean).join(" · "), lead + [espn, `DraftKings ${percent(pregame.top)}`].filter(Boolean).join(" · "));
    else if (espn) variants.push(lead + espn);
  }
  const line = variants.find((v) => lineWidth(v) <= width) ?? variants.at(-1) ?? null;

  const vs = threeWay ? `${names.top} win, draw or ${names.bottom} win` : null;
  const spokenVs = threeWay ? `${spoken.top} win, a draw or ${spoken.bottom} win` : null;
  const model = basis.win.length > 0 ? " against ESPN's model" : "";
  const sides = `${names.top} above the line, ${names.bottom} below.`;
  const spokenSides = `${spoken.top} above the line, ${spoken.bottom} below.`;
  const [caption, spokenCaption] = threeWay
    ? final
      ? [`How Polymarket's market saw it: ${vs}.`, `How Polymarket's market saw it: ${spokenVs}.`]
      : [`Polymarket's ${live ? "live market" : "market over the last day"}: ${vs}.`, `Polymarket's ${live ? "live market" : "market over the last day"}: ${spokenVs}.`]
    : live
      ? [`Polymarket's live market${model}. ${sides}`, `Polymarket's live market${model}. ${spokenSides}`]
      : final
        ? [`Polymarket's market through the game${model}. ${sides}`, `Polymarket's market through the game${model}. ${spokenSides}`]
        : [`Polymarket's market over the last day. ${sides}`, `Polymarket's market over the last day. ${spokenSides}`];

  const spokenHeader = [
    `Polymarket${final ? ` at ${startWord(sport)}` : ""}: ${spoken.top} ${left.spoken}`,
    spokenDraw != null ? `draw ${spokenDraw}` : null,
    `${spoken.bottom} ${right.spoken}.`,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <DetailSection
      id="winProbability"
      title={final ? "How the Odds Moved" : "Win Probability"}
      accessory={live ? "live" : final ? "final" : undefined}
      caption={caption}
      spokenCaption={spokenCaption}
      trailing={
        live ? (
          <SegmentedControl<OddsWindow>
            label="Window"
            value={span.value}
            options={[
              { value: "game", label: "Game" },
              { value: "10m", label: "10 min" },
            ]}
            onChange={(value, viaKeyboard) => setSpan({ value, instant: viaKeyboard })}
            className={styles.window}
          />
        ) : null
      }
    >
      <div ref={block} className={styles.block}>
        <div className={styles.head}>
          <p className="visually-hidden">{`${spokenHeader}${line ? ` ${line.replace(names.top, spoken.top)}.` : ""}`}</p>
          <div className={styles.teams} aria-hidden="true">
            <span className={styles.team}>
              <span className={styles.teamDot} style={mark(left.color)} />
              <span className={styles.teamName}>{left.name}</span>
              <span className={styles.teamValue}>{left.text}</span>
            </span>
            {draw != null ? (
              <span className={styles.team} data-draw>
                <span className={styles.teamDot} style={mark(NEUTRAL)} />
                <span className={styles.teamName}>Draw</span>
                <span className={styles.teamValue}>{draw}</span>
              </span>
            ) : null}
            <span className={styles.team} data-trailing>
              <span className={styles.teamValue}>{right.text}</span>
              <span className={styles.teamName}>{right.name}</span>
              <span className={styles.teamDot} style={mark(right.color)} />
            </span>
          </div>
          {line ? (
            <p className={styles.reference} aria-hidden="true">
              {line}
            </p>
          ) : null}
        </div>
        <OddsChart
          snapshot={snapshot}
          feed={feed}
          basis={basis}
          state={state}
          scheduled={event.start}
          sport={sport}
          palette={palette}
          names={names}
          spoken={spoken}
          span={live ? span.value : "game"}
          instant={span.instant}
          width={width}
        />
      </div>
    </DetailSection>
  );
}
