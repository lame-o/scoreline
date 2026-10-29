/**
 * Development only: the basketball theater's review sheets, the web's twin
 * of the Mac's offscreen review harness (its `sheets` and `stage`): SA at UTA
 * (test/fixtures/nba-every-play-401909890.json), each beat built as the
 * stage builds it (from the court between plays it interrupts), drawn at the
 * same key moments with the broadcast tag and the heartbeat over it, row by
 * row, so a screenshot of a sheet lays beside the Mac's. The preview shows a
 * sheet for `?sheet=01` … `?sheet=10` (misses, rebounds, free throws,
 * whistles, turnovers, stoppages, periods, between plays, idle beats, ends
 * and the turn, light, the stage). Fixtures load lazily from test/fixtures,
 * so nothing here ships.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Teams } from "../../../../data/liveFeeds/basketball";
import { dress } from "../../../../data/mlb/theaterTeams";
import type { Side } from "../../../../data/models";
import { NEUTRAL, teamPalette, type Scheme } from "../../../../data/teamColors";
import { beatScript, beatSide, endsRight, hoopsEnds, restOf, restScript, type Lineup, type RestSpec } from "../../../../data/theater/basketballBeats";
import { restAfter, statusBetween, statusDuring, type Said } from "../../../../data/theater/basketballFlow";
import { parseScene, replays, made, type BasketballScene } from "../../../../data/theater/basketballScene";
import { BasketballScript, Hoops } from "../../../../data/theater/basketballScript";
import { MomentProvider, useMomentSlot } from "../../core/moments";
import { TheaterFlipButton, TheaterHeartbeat, TheaterStatusTag } from "../../core/theater/TheaterStatus";
import styles from "../../core/theater/TheaterWell.module.css";
import { theaterInk } from "../../mlb/theater/theaterInk";
import BasketballTheater from "./BasketballTheater";
import { drawBasketballFrame, drawCourt, HoopProjection, layoutLabels, type BasketballTeams } from "./drawBasketball";

const files = import.meta.glob<{ default: unknown }>("../../../../../test/fixtures/nba-every-play-401909890.json");

const names = { top: "Spurs", bottom: "Jazz" };
const kits = { top: { color: "#000000", alternate: "#c4ced4" }, bottom: { color: "#4e008e", alternate: "#79a3dc" } };
const SIZE = { width: 360, height: 180 };

interface Game {
  readonly items: readonly Record<string, unknown>[];
  readonly teams: Teams;
  readonly scenes: readonly BasketballScene[];
  scene(suffix: string): BasketballScene;
  index(suffix: string): number;
}

function gameOf(json: unknown): Game {
  const g = (json as { games: { items: Record<string, unknown>[]; home: { id: string }; away: { id: string } }[] }).games[0]!;
  const teams: Teams = { topIsHome: false, topID: g.away.id, bottomID: g.home.id, topName: "SA", bottomName: "UTAH" };
  const scenes = g.items.flatMap((_, i) => parseScene(g.items, i, teams) ?? []);
  return {
    items: g.items,
    teams,
    scenes,
    scene: (suffix) => scenes.find((s) => s.id.endsWith(suffix))!,
    index: (suffix) => scenes.findIndex((s) => s.id.endsWith(suffix)),
  };
}

const ends = (period: number | null, flipped = false) => hoopsEnds(period, false, flipped);

/** A frame to draw: what's on screen and when. */
interface Shot {
  readonly scene: BasketballScene | null;
  readonly script: BasketballScript;
  readonly t: number;
  readonly status: Said | null;
  readonly caption: string;
  readonly flip?: boolean;
}

type Row = readonly [string, readonly Shot[]];

/** A beat's key moments: the start, the shot, the rim, the whistle or the catch, the tag, the stamp, the end. */
function moments(s: BasketballScript, count = 5): number[] {
  const ts: number[] = [0.05];
  if (s.release != null) ts.push(s.release + 0.02);
  if (s.rimHit != null) ts.push(s.rimHit + 0.06);
  const w = s.flashes.find((f) => f.beat === "whistle" || f.beat === "steal" || f.beat === "horn");
  if (w) ts.push(w.at + 0.12);
  const c = s.flashes.findLast((f) => f.beat === "catchBall");
  if (c) ts.push(c.at + 0.05);
  if (s.tag) ts.push(s.tag.at + 0.4);
  if (Number.isFinite(s.stamp)) ts.push(s.stamp + 0.45);
  ts.push(s.duration);
  ts.sort((a, b) => a - b);
  const kept: number[] = [];
  for (const t of ts) if (kept.length === 0 || t - kept.at(-1)! > 0.25) kept.push(t);
  while (kept.length < count && kept.length >= 2) {
    // Fill the widest gap (the first of the widest, as Swift's max(by:)).
    let i = 0;
    for (let k = 1; k + 1 < kept.length; k++) if (kept[k + 1]! - kept[k]! > kept[i + 1]! - kept[i]!) i = k;
    kept.splice(i + 1, 0, (kept[i]! + kept[i + 1]!) / 2);
  }
  while (kept.length > count) {
    // Drop the one closest to its neighbour (never the first or last).
    let i = 1;
    for (let k = 2; k < kept.length - 1; k++) if (kept[k + 1]! - kept[k - 1]! < kept[i + 1]! - kept[i - 1]!) i = k;
    kept.splice(i, 1);
  }
  return kept;
}

/** The court the beat interrupts: play on, the team with the ball set, a beat of it run. */
function before(scene: BasketballScene, side: Side): Lineup {
  const rest = restScript(restOf({ offense: side, ends: ends(scene.period), phase: "live", from: null, seed: `pre-${scene.id}` }));
  return rest.lineup((rest.active[1]?.[1] ?? 6) + 0.5);
}

/** A beat as the stage builds it, and its frames. */
function beatRow(scene: BasketballScene, title: string, o: { group?: readonly BasketballScene[]; from?: Lineup; count?: number; period?: number; flipped?: boolean } = {}): Row {
  const group = o.group ?? [];
  const side = beatSide(scene, null, "top");
  const start = o.from ?? before(scene, side);
  const script = beatScript(scene, group, ends(o.period ?? scene.period, o.flipped ?? false), start, side);
  const unit = { scene, group, covers: [], skipped: 0 };
  return [title, moments(script, o.count ?? 5).map((t) => ({ scene, script, t, status: statusDuring(unit, script, t, names), caption: `t ${t.toFixed(2)} / ${script.duration.toFixed(2)} s` }))];
}

function restRow(rest: RestSpec, context: BasketballScene | null, title: string, times?: readonly number[]): Row {
  const script = restScript(rest);
  const ts =
    times ??
    (() => {
      const t = [0.05];
      const o = script.active[0];
      if (o) t.push(o[1] * 0.5, o[1]);
      for (const w of script.active.slice(1, 3)) t.push((w[0] + w[1]) / 2, w[1]);
      return t.slice(0, 6);
    })();
  const status = statusBetween(context, rest, names);
  return [title, ts.map((t) => ({ scene: null, script, t, status, caption: `rest t ${t.toFixed(2)} s` }))];
}

/** Every sheet, as the Mac harness's `sheets` lays them out. */
function sheets(g: Game): Record<string, { rows: readonly Row[]; scheme?: Scheme }> {
  // Misses, each from ESPN's spot, off the rim to the man credited with the board.
  const misses: Row[] = [
    beatRow(g.scene("9022"), "Vassell misses a 25-ft three → long carom, Green's defensive board (MISS 3PT stamp)"),
    beatRow(g.scene("9058"), "Bailey misses a driving floater → stays at the rim, Wembanyama's board"),
    beatRow(g.scene("9050"), "Fox misses a driving layup → Hayes's board"),
    beatRow(g.scene("9056"), "Peterson misses a driving dunk → Green's offensive board"),
    beatRow(g.scene("9035"), "Peterson's 15-ft step-back → Wembanyama"),
  ];

  // Rebounds that come in after their miss: the ball where it lay.
  const late: BasketballScene = { ...g.scene("9079"), rebound: null, follows: [] };
  const missNoBoard = beatScript(late, [], ends(1), before(late, "bottom"), "bottom");
  const rebounds: Row[] = [
    [
      "Bailey's three before its board is in: off the rim and loose",
      moments(missNoBoard).map((t) => ({ scene: late, script: missNoBoard, t, status: { text: "JAZZ BALL", side: "bottom" as Side }, caption: `t ${t.toFixed(2)}` })),
    ],
    beatRow(g.scene("9080"), "…then Champagnie's defensive board arrives: he gets to it (REB stamp)", { from: missNoBoard.lineup(missNoBoard.duration) }),
    beatRow(g.scene("9021"), "Vassell's own offensive board, standalone (off the rim of his three)"),
    beatRow(g.scene("0138"), "A team rebound (Jazz defensive team rebound): off the rim and out"),
  ];

  // Free throws, each as it comes, from the lane the foul set up.
  const foul = g.scene("9028");
  const foulBeat = beatScript(foul, [], ends(1), before(foul, "bottom"), "bottom");
  const laneRest = restAfter(foul, null, foulBeat.lineup(foulBeat.duration), ends(1), null);
  const lane = restScript(laneRest);
  const ft1 = g.scene("9030");
  const ft2 = g.scene("9031");
  const ft1Beat = beatScript(ft1, [], ends(1), lane.lineup(20));
  const laneAfter1 = restScript(restAfter(ft1, null, ft1Beat.lineup(ft1Beat.duration), ends(1), null));
  const freeThrows: Row[] = [
    beatRow(foul, "Wembanyama's shooting foul at ESPN's spot: up into the shot, the whistle, the call"),
    restRow(laneRest, foul, "…to the lane: everyone walks to his place, the referee bounces Peterson the ball (FREE THROWS · JAZZ)"),
    beatRow(ft1, "Peterson's free throw 1 of 2: his routine, the swish (hands on hips: nothing live)", { from: lane.lineup(20) }),
    beatRow(ft2, "Free throw 2 of 2: the lane comes in as it leaves his hand", { from: laneAfter1.lineup(20) }),
    beatRow(g.scene("0114"), "Kornet misses 2 of 2: off the front, live, Bailey's board"),
    beatRow(g.scene("0272"), "Johnson misses 1 of 2: dead, it drops"),
  ];

  const whistles: Row[] = [
    beatRow(g.scene("9018"), "Hayes's personal foul: the reach, the whistle"),
    beatRow(g.scene("0656"), "Wembanyama's loose ball foul: both after it"),
    beatRow(g.scene("0252"), "Johnson's charge: contact, the defender on the floor"),
    beatRow(g.scene("0240"), "Hayes's offensive foul (push-off)"),
    beatRow(g.scene("0642"), "Vassell's kicked ball: the pass off his foot"),
    beatRow(g.scene("0312"), "Wembanyama's goaltending"),
  ];

  const turnovers: Row[] = [
    beatRow(g.scene("8908"), "Bailey's bad pass, picked off by Castle at ESPN's spot (STL)"),
    beatRow(g.scene("9070"), "George's lost ball, poked loose by Vassell"),
    beatRow(g.scene("0447"), "Collier's pass out of bounds"),
    beatRow(g.scene("0118"), "Castle loses it out of bounds"),
    beatRow(g.scene("0374"), "Fox travels"),
    beatRow(g.scene("0249"), "Harper's double dribble"),
    beatRow(g.scene("0260"), "Bamba's offensive goaltending"),
  ];

  const i168 = g.index("0168");
  const subs = g.scenes.slice(i168, i168 + 4);
  const timeout = g.scene("9074");
  const toBeat = beatScript(timeout, [], ends(1), before(timeout, "top"), "top");
  const endQ1 = g.scene("0165");
  const half = g.scene("0334");
  const endBeat = beatScript(endQ1, [], ends(1), before(endQ1, "bottom"), "bottom");
  const halfBeat = beatScript(half, [], ends(2), before(half, "bottom"), "bottom");
  const stoppages: Row[] = [
    beatRow(g.scene("8904"), "The opening tip: Wembanyama and Hayes, to Harper (TIP-OFF · HARPER)"),
    beatRow(g.scene("9063"), "A substitution mid-game: one jogs off, his sub on (SUB · COLLIER IN)"),
    beatRow(subs[0]!, "Four at once at a stoppage (SUBS · WEMBANYAMA, BRYANT +2 IN)", { group: subs }),
    beatRow(timeout, "Jazz timeout: the whistle, all ten head for their benches"),
    restRow(restAfter(timeout, null, toBeat.lineup(toBeat.duration), ends(1), "top"), timeout, "…at the benches until play resumes (TIMEOUT · JAZZ holds)"),
    beatRow(g.scene("0136"), "Jazz challenge, overturned: the referee at the table"),
    beatRow(g.scene("0428"), "Jazz challenge, the call stands"),
  ];
  const periods: Row[] = [
    beatRow(endQ1, "End of the 1st: the horn (backboards' red), END OF 1ST"),
    restRow(restAfter(endQ1, null, endBeat.lineup(endBeat.duration), ends(1), null), endQ1, "…the benches"),
    beatRow(half, "Halftime"),
    restRow(restAfter(half, null, halfBeat.lineup(halfBeat.duration), ends(2), null), half, "…the floor empties"),
    beatRow(g.scene("0669"), "End of regulation, tied 105–105"),
    beatRow(g.scene("0736"), "Final"),
  ];

  // The court between plays.
  const make = g.scenes.find((s) => replays(s) && made(s) && s.offense === "top" && (s.period ?? 0) === 1)!;
  const replay = BasketballScript.play(make, endsRight(ends(1), "top"));
  const miss = g.scene("9035");
  const missBeat = beatScript(miss, [], ends(1), before(miss, "bottom"), "bottom");
  const live = restAfter(miss, null, missBeat.lineup(missBeat.duration), ends(1), null);
  const inbound = restAfter(make, null, replay.lineup(replay.duration), ends(1), null);
  const liveScript = restScript(live);
  const opening = liveScript.active[0]?.[1] ?? 3;
  const idleTimes = [0.05, opening * 0.5, opening, ...liveScript.active.slice(1, 4).map((w) => w[1])];
  const pf = g.scene("9018");
  const pfBeat = beatScript(pf, [], ends(1), before(pf, "top"), "top");
  const between: Row[] = [
    restRow(live, miss, "After Wembanyama's board: the Spurs push up the floor and set (SPURS BALL), then a small beat every few seconds", idleTimes.slice(0, 6)),
    restRow(inbound, make, "After a Spurs basket: the Jazz take it out under the basket, bring it up, set"),
    restRow(restAfter(pf, null, pfBeat.lineup(2.5), ends(1), "top"), pf, "After Hayes's personal foul: the Spurs in from the sideline"),
  ];
  const mids = liveScript.active.slice(1).map((w) => (w[0] + w[1]) / 2);
  const idle: Row[] = [restRow(live, miss, "Each sparse beat at its middle (still between them; the stage redraws only inside them)", mids.slice(0, 6))];

  // Ends of the court: the halftime swap and the turn.
  const q3 = g.scenes.find((s) => replays(s) && made(s) && s.offense === "top" && (s.period ?? 0) === 3)!;
  const replayRow = (s: BasketballScene, flipped: boolean, title: string): Row => {
    const script = BasketballScript.play(s, endsRight(ends(s.period, flipped), s.offense));
    return [title, [0.3, script.release ?? 1, (script.score ?? 2) + 0.1, script.duration].map((t) => ({ scene: s, script, t, status: null, caption: `Q${s.period ?? 0} t ${t.toFixed(2)}`, flip: true }))];
  };
  const turn: Row[] = [
    replayRow(make, false, "A Spurs basket in the 1st: the visitors at the right basket (the default)"),
    replayRow(q3, false, "A Spurs basket in the 3rd: ends swapped at halftime, at the left"),
    replayRow(make, true, "The 1st-quarter basket with the court turned round (TheaterFlipButton, top right)"),
    beatRow(g.scene("9022"), "A Spurs miss in the 1st, turned round", { flipped: true }),
  ];

  const light: Row[] = [
    beatRow(foul, "Light: SHOOTING FOUL · WEMBANYAMA", { count: 3 }),
    beatRow(ft1, "Light: FREE THROW 1 OF 2", { from: lane.lineup(20), count: 3 }),
    restRow(live, miss, "Light: SPURS BALL", [0.05, opening]),
  ];

  return {
    "01": { rows: misses },
    "02": { rows: rebounds },
    "03": { rows: freeThrows },
    "04": { rows: whistles },
    "05": { rows: turnovers },
    "06": { rows: stoppages },
    "06b": { rows: periods },
    "07": { rows: between },
    "07b": { rows: idle },
    "08": { rows: turn },
    "09": { rows: light, scheme: "light" },
  };
}

/** A team's paint (TheaterTeams.solid). */
const solid = (color: string, scheme: Scheme) => (color === NEUTRAL || !color.startsWith("#") ? (scheme === "dark" ? "#b8b8b8" : "#808080") : color);

/** One frame, drawn once: the court, the play at t, the tag and the heartbeat over it. */
function Frame({ shot, scheme }: { shot: Shot; scheme: Scheme }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const heard = useMemo(() => Date.now() - 4000, []);
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = SIZE.width * dpr;
    el.height = SIZE.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pt = (Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 13) / 13;
    const ink = theaterInk(scheme);
    const d = dress(kits, scheme);
    const side = shot.script.side ?? "top";
    const teams: BasketballTeams = side === "top" ? { offense: d.top, defense: d.bottom } : { offense: d.bottom, defense: d.top };
    const palette = teamPalette(kits.top.color, kits.bottom.color, scheme);
    const h = new HoopProjection(SIZE, shot.script.camera.frame(shot.t), shot.script.yaw);
    drawCourt(ctx, h, ink, { color: solid(palette.bottom, scheme), name: "UTAH JAZZ", three: Hoops.three });
    drawBasketballFrame(ctx, h, { script: shot.script, t: shot.t, teams, ink, labels: layoutLabels(ctx, shot.scene, shot.script, teams, ink, SIZE, pt) });
  }, [shot, scheme]);
  const tint = shot.status?.side ? (shot.status.side === "top" ? kits.top.color : kits.bottom.color) : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <div className={styles.well} style={{ width: SIZE.width, height: SIZE.height }}>
        <canvas ref={canvas} className={styles.canvas} />
        <TheaterStatusTag tag={shot.status?.text ?? null} tint={tint} height={SIZE.height} />
        <TheaterHeartbeat updated={heard} source="ESPN" />
        {shot.flip ? <TheaterFlipButton surface="court" flipped={false} onFlip={() => {}} /> : null}
      </div>
      <span style={{ fontSize: 10, fontWeight: 500, fontVariantNumeric: "tabular-nums", color: scheme === "dark" ? "#b3b3b3" : "#4d4d4d" }}>{shot.caption}</span>
    </div>
  );
}

function Sheet({ rows, scheme, children }: { rows: readonly Row[]; scheme: Scheme; children?: ReactNode }) {
  return (
    <div data-sheet style={{ display: "inline-flex", flexDirection: "column", gap: 10, padding: 14, background: scheme === "dark" ? "#171717" : "#fafafa", colorScheme: scheme }}>
      {/* The turn control shows, as the Mac's render has it (it's otherwise hover-only). */}
      <style>{"[data-sheet] button[aria-pressed] { opacity: 1 !important; }"}</style>
      {rows.map(([title, shots]) => (
        <div key={title} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: scheme === "dark" ? "#fff" : "#000" }}>{title}</span>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            {shots.map((shot, i) => (
              <Frame key={i} shot={shot} scheme={scheme} />
            ))}
          </div>
        </div>
      ))}
      {children}
    </div>
  );
}

/** The real stage on the frozen clock: a news whistle over the court, its tag, heartbeat and well; then the court between plays (the Mac harness's `stage`). */
function StageSheet({ g }: { g: Game }) {
  const slot = useMomentSlot();
  const i = g.index("9028");
  const news = useMemo(() => ({ plays: g.scenes.slice(i - 6, i + 1), news: new Set([g.scene("9028").id]), heard: Date.now() - 3000 }), [g, i]);
  const rest = useMemo(() => ({ plays: g.scenes.slice(i - 6, i), news: new Set<string>(), heard: Date.now() - 9000 }), [g, i]);
  const palette = teamPalette(kits.top.color, kits.bottom.color, "dark");
  const theater = (state: typeof news, frozen: number) => (
    <div style={{ width: 420 }}>
      <BasketballTheater
        feed={null}
        teams={null}
        kits={kits}
        palette={palette}
        topIsHome={false}
        topName="SA"
        bottomName="UTAH"
        topTeam="Spurs"
        bottomTeam="Jazz"
        eventId="harness"
        period={1}
        preloaded={state}
        frozen={frozen}
      />
    </div>
  );
  return (
    <MomentProvider slot={slot}>
      <div data-sheet style={{ display: "inline-flex", flexDirection: "column", gap: 10, padding: 14, background: "#171717", colorScheme: "dark" }}>
        <span style={{ color: "#fff" }}>The stage itself (BasketballTheater, frozen clock): a news whistle at 0.4, 1.2, 1.8 s; then the court between plays</span>
        <div style={{ display: "flex", gap: 10 }}>{[0.4, 1.2, 1.8].map((t) => <div key={t}>{theater(news, t)}</div>)}</div>
        {theater(rest, 0)}
      </div>
    </MomentProvider>
  );
}

export function BasketballTheaterSheets({ sheet }: { sheet: string }) {
  const [game, setGame] = useState<Game | null>(null);
  useEffect(() => {
    let live = true;
    void files["../../../../../test/fixtures/nba-every-play-401909890.json"]?.().then((m) => {
      if (live) setGame(gameOf(m.default));
    });
    return () => {
      live = false;
    };
  }, []);
  const all = useMemo(() => (game ? sheets(game) : null), [game]);
  if (!game || !all) return null;
  if (sheet === "10") return <StageSheet g={game} />;
  const chosen = all[sheet];
  return chosen ? <Sheet rows={chosen.rows} scheme={chosen.scheme ?? "dark"} /> : <p>Sheets: {Object.keys(all).join(", ")}, 10</p>;
}
