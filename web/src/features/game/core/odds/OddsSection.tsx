/**
 * The Win Probability section with Polymarket's market (its own chunk, loaded
 * as the page looks for the game's market: WinProbabilitySection.tsx): the
 * title, caption and Live/Final accessory, the Game | 10 min window, the
 * header row and its muted line, and the chart (OddsChart.tsx), with the
 * Mac's words from ODDS-DECISIONS.md.
 */
import { useMemo, useRef, useState, type CSSProperties } from "react";
import { nbaPalette } from "../../../../data/basketball";
import { percent, percentPair, spokenPercent, valueAt, type GameState, type OddsWindow } from "../../../../data/odds/chart";
import type { Sport } from "../../../../data/models";
import { NEUTRAL } from "../../../../data/teamColors";
import { SegmentedControl } from "../../../../design/components";
import { useWidth } from "../../../../design/useWidth";
import type { OddsFeed, OddsSnapshot } from "../../../../state/odds";
import { useColorScheme } from "../../../../state/theme";
import { DetailSection } from "../DetailSection";
import type { GameContext } from "../sport";
import { beforeStart, OddsChart } from "./OddsChart";
import styles from "./Odds.module.css";

const mark = (color: string): CSSProperties => ({ background: color === NEUTRAL ? "var(--viz-neutral)" : color });

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

export function OddsSection({ game, snapshot, feed, state }: { game: GameContext; snapshot: OddsSnapshot; feed: OddsFeed | null; state: GameState }) {
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
