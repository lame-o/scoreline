/**
 * Development only: the names on the isometric views, at the Mac contact
 * sheet's moments (the wave 24 names harness, `names-sheet.png`), for
 * comparing the two side by side: World Series Game 2's single, Mahomes to
 * E. Johnson, Wembanyama's three and Haaland's header, each on the Mac
 * harness's own kits and sizes (the 312 × 156 compact well, the 532 × 266
 * wide one), frozen, the pointer held where the Mac's is (on a man's chest,
 * hit-tested as a pointer there is, or at a point) and its tag as far in as
 * the Mac's. Only the cells in the page's appearance are drawn; each is a
 * `[data-shot]` panel, its pointer's point in the theater's `data-pointer`.
 * Fixtures load lazily from test/fixtures, so nothing here ships.
 *
 *     /dev/theater/names                 every cell in this appearance
 *     /dev/theater/names?only=b4         the cells whose name starts so
 *     /dev/theater/names?set=callouts    the callouts sheet's frames (wave 24's callouts harness, gen.py): crowds,
 *                                        callouts riding, the key tag's glide, stems, the wide well; each its own name
 */
import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import type { Baseball } from "../../../../data/gameDetail";
import type { JSONValue } from "../../../../data/json";
import type { FootballTeams } from "../../../../data/liveFeeds/football";
import { baseballFielders, type BaseballFielders } from "../../../../data/mlb/fielders";
import { parse as parseBaseball, type PlayScene, type SideOf } from "../../../../data/mlb/playScene";
import { statcastNumbers } from "../../../../data/mlb/statcast";
import type { TheaterKits } from "../../../../data/mlb/theaterTeams";
import type { ScoreEvent } from "../../../../data/models";
import { teamPalette } from "../../../../data/teamColors";
import { parseScene, type BasketballScene } from "../../../../data/theater/basketballScene";
import { FootballDepthChart, parse as parseFootball, type FootballScene } from "../../../../data/theater/footballScene";
import { isMoment, keepers, parse as parseSoccer, SoccerLineup, type SoccerScene } from "../../../../data/theater/soccerScene";
import { TheaterPeople, type TheaterPerson } from "../../../../data/theater/theaterNames";
import { useColorScheme } from "../../../../state/theme";
import FootballTheater from "../../football/theater/FootballTheater";
import { PlayTheater } from "../../mlb/theater/PlayTheater";
import BasketballTheater from "../../nba/theater/BasketballTheater";
import SoccerTheater from "../../soccer/theater/SoccerTheater";
import { MomentProvider, useMomentSlot } from "../moments";
import type { NamesPose } from "./useTheaterNames";

const files = import.meta.glob<{ default: unknown }>(
  "../../../../../test/fixtures/{mlb-ws-g2-summary-plays,names-mlb-401908043-summary,names-mlb-849802-numbers,nfl-turnovers-plays,nfl-depthcharts,names-nfl-401873022-boxscore,nba-every-play-401909890,names-nba-401909890-boxscore,soccer-theater-plays,names-soccer-401879256-rosters}.json",
);

async function load(name: string): Promise<unknown> {
  const f = files[`../../../../../test/fixtures/${name}.json`];
  if (!f) throw new Error(`No fixture ${name}`);
  return (await f()).default;
}

type Sport = "baseball" | "baseball-rest" | "baseball-nonumbers" | "football" | "basketball" | "soccer";

/** One cell of the Mac's sheet (its config.json). */
interface Cell {
  readonly name: string;
  readonly sport: Sport;
  readonly t: number;
  readonly scheme: "light" | "dark";
  readonly hover?: number;
  readonly x?: number;
  readonly y?: number;
  readonly appear?: number;
  readonly wide?: boolean;
  readonly crop?: boolean;
  /** Reduce Motion (the shooter emulates it for these). */
  readonly reduce?: boolean;
}

const CELLS: readonly Cell[] = [
  // 1 · Pointer over a man · compact panel · dark
  { name: "b1-1-baseball", sport: "baseball", t: 1.1, hover: 0, scheme: "dark" },
  { name: "b1-2-football", sport: "football", t: 2.3, x: 104, y: 50, scheme: "dark" },
  { name: "b1-3-basketball", sport: "basketball", t: 1.2, hover: 1, scheme: "dark" },
  { name: "b1-4-soccer", sport: "soccer", t: 4.6, hover: 0, scheme: "dark" },
  // 2 · No pointer · compact panel · light
  { name: "b2-1-baseball", sport: "baseball", t: 1.1, scheme: "light" },
  { name: "b2-2-football", sport: "football", t: 2.3, scheme: "light" },
  { name: "b2-3-basketball", sport: "basketball", t: 1.2, scheme: "light" },
  { name: "b2-4-soccer", sport: "soccer", t: 4.6, scheme: "light" },
  // 3 · Wider panel (560 pt) · pointer
  { name: "b3-1-baseball", sport: "baseball", t: 1.1, hover: 2, scheme: "light", wide: true },
  { name: "b3-2-football", sport: "football", t: 2.3, hover: 12, scheme: "dark", wide: true },
  { name: "b3-3-basketball", sport: "basketball", t: 1.2, hover: 7, scheme: "light", wide: true },
  { name: "b3-4-soccer", sport: "soccer", t: 4.6, hover: 2, scheme: "dark", wide: true },
  // 4 · Hard cases
  { name: "b4-1-crowded", sport: "basketball", t: 1.2, hover: 5, scheme: "dark" },
  { name: "b4-2-umpire", sport: "baseball", t: 1.1, hover: 12, scheme: "light" },
  { name: "b4-3-nonumber", sport: "baseball-nonumbers", t: 1.1, hover: 0, scheme: "dark" },
  { name: "b4-4-between", sport: "baseball-rest", t: 0, hover: 5, scheme: "light" },
  // 5 · The well's edges and its furniture
  { name: "b5-1-flip", sport: "soccer", t: 4.75, hover: 13, scheme: "dark" },
  { name: "b5-2-status", sport: "basketball", t: 5.75, scheme: "light" },
  { name: "b5-3-top", sport: "football", t: 0.75, hover: 17, scheme: "dark" },
  { name: "b5-4-left", sport: "soccer", t: 0.75, hover: 8, scheme: "light" },
  // 6 · The stamp, and the tag coming in
  { name: "b6-1-stamp", sport: "basketball", t: 3.2, hover: 5, scheme: "dark" },
  { name: "b6-2-stamp", sport: "soccer", t: 7.0, scheme: "light" },
  { name: "b6-3-fade12", sport: "football", t: 2.3, x: 104, y: 50, appear: 0.1, scheme: "dark" },
  { name: "b6-4-fade42", sport: "football", t: 2.3, x: 104, y: 50, appear: 0.35, scheme: "dark" },
];

/** The callouts sheet's frames (Tags under the play, Callouts): each cell's name is its own, scheme and all. */
const CALLOUTS: readonly Cell[] = [
  { name: "football-dark-0.75-h17", sport: "football", t: 0.75, hover: 17, scheme: "dark" },
  { name: "football-dark-2.53-h14", sport: "football", t: 2.53, hover: 14, scheme: "dark" },
  { name: "soccer-dark-4.75-h13", sport: "soccer", t: 4.75, hover: 13, scheme: "dark" },
  { name: "basketball-dark-1.20-h5", sport: "basketball", t: 1.2, hover: 5, scheme: "dark" },
  { name: "football-dark-1.53-h12", sport: "football", t: 1.53, hover: 12, scheme: "dark" },
  { name: "football-dark-2.13", sport: "football", t: 2.13, scheme: "dark" },
  { name: "basketball-dark-3.40-h8", sport: "basketball", t: 3.4, hover: 8, scheme: "dark" },
  { name: "basketball-dark-2.00", sport: "basketball", t: 2.0, scheme: "dark" },
  { name: "soccer-dark-2.27", sport: "soccer", t: 2.27, scheme: "dark" },
  { name: "soccer-dark-2.27-h20", sport: "soccer", t: 2.27, hover: 20, scheme: "dark" },
  { name: "baseball-dark-0.80", sport: "baseball", t: 0.8, scheme: "dark" },
  { name: "baseball-dark-3.40-h1", sport: "baseball", t: 3.4, hover: 1, scheme: "dark" },
  { name: "football-light-0.75-h17", sport: "football", t: 0.75, hover: 17, scheme: "light" },
  { name: "football-light-2.53-h14", sport: "football", t: 2.53, hover: 14, scheme: "light" },
  { name: "soccer-light-4.75-h13", sport: "soccer", t: 4.75, hover: 13, scheme: "light" },
  { name: "basketball-light-1.20-h5", sport: "basketball", t: 1.2, hover: 5, scheme: "light" },
  { name: "football-light-1.53-h12", sport: "football", t: 1.53, hover: 12, scheme: "light" },
  { name: "football-light-2.13", sport: "football", t: 2.13, scheme: "light" },
  { name: "basketball-light-3.40-h8", sport: "basketball", t: 3.4, hover: 8, scheme: "light" },
  { name: "basketball-light-2.00", sport: "basketball", t: 2.0, scheme: "light" },
  { name: "soccer-light-2.27", sport: "soccer", t: 2.27, scheme: "light" },
  { name: "soccer-light-2.27-h20", sport: "soccer", t: 2.27, hover: 20, scheme: "light" },
  { name: "baseball-light-0.80", sport: "baseball", t: 0.8, scheme: "light" },
  { name: "baseball-light-3.40-h1", sport: "baseball", t: 3.4, hover: 1, scheme: "light" },
  { name: "football-dark-0.30-h0", sport: "football", t: 0.3, hover: 0, scheme: "dark" },
  { name: "football-dark-0.90-h0", sport: "football", t: 0.9, hover: 0, scheme: "dark" },
  { name: "football-dark-1.50-h0", sport: "football", t: 1.5, hover: 0, scheme: "dark" },
  { name: "football-dark-2.10-h0", sport: "football", t: 2.1, hover: 0, scheme: "dark" },
  { name: "soccer-dark-1.50-h20", sport: "soccer", t: 1.5, hover: 20, scheme: "dark" },
  { name: "soccer-dark-2.50-h20", sport: "soccer", t: 2.5, hover: 20, scheme: "dark" },
  { name: "soccer-dark-3.50-h20", sport: "soccer", t: 3.5, hover: 20, scheme: "dark" },
  { name: "soccer-dark-4.50-h20", sport: "soccer", t: 4.5, hover: 20, scheme: "dark" },
  { name: "basketball-dark-0.80-h8", sport: "basketball", t: 0.8, hover: 8, scheme: "dark" },
  { name: "basketball-dark-1.60-h8", sport: "basketball", t: 1.6, hover: 8, scheme: "dark" },
  { name: "basketball-dark-2.40-h8", sport: "basketball", t: 2.4, hover: 8, scheme: "dark" },
  { name: "basketball-dark-3.20-h8", sport: "basketball", t: 3.2, hover: 8, scheme: "dark" },
  { name: "basketball-light-0.80-h8", sport: "basketball", t: 0.8, hover: 8, scheme: "light" },
  { name: "basketball-light-1.60-h8", sport: "basketball", t: 1.6, hover: 8, scheme: "light" },
  { name: "basketball-light-2.40-h8", sport: "basketball", t: 2.4, hover: 8, scheme: "light" },
  { name: "basketball-light-3.20-h8", sport: "basketball", t: 3.2, hover: 8, scheme: "light" },
  { name: "football-dark-1.97-h2", sport: "football", t: 1.97, hover: 2, scheme: "dark" },
  { name: "football-dark-2.03-h2", sport: "football", t: 2.03, hover: 2, scheme: "dark" },
  { name: "football-dark-2.07-h2", sport: "football", t: 2.07, hover: 2, scheme: "dark" },
  { name: "football-dark-2.10-h2", sport: "football", t: 2.1, hover: 2, scheme: "dark" },
  { name: "football-dark-2.20-h2", sport: "football", t: 2.2, hover: 2, scheme: "dark" },
  { name: "football-dark-2.07-h2-reduce", sport: "football", t: 2.07, hover: 2, scheme: "dark", reduce: true },
  { name: "football-light-2.07-h2", sport: "football", t: 2.07, hover: 2, scheme: "light" },
  { name: "football-light-2.20-h2", sport: "football", t: 2.2, hover: 2, scheme: "light" },
  { name: "football-light-0.90-h0", sport: "football", t: 0.9, hover: 0, scheme: "light" },
  { name: "football-dark-1.00-h1", sport: "football", t: 1.0, hover: 1, scheme: "dark" },
  { name: "football-light-1.00-h1", sport: "football", t: 1.0, hover: 1, scheme: "light" },
  { name: "soccer-dark-3.00-h20", sport: "soccer", t: 3.0, hover: 20, scheme: "dark" },
  { name: "soccer-light-3.00-h20", sport: "soccer", t: 3.0, hover: 20, scheme: "light" },
  { name: "basketball-dark-1.50-h4", sport: "basketball", t: 1.5, hover: 4, scheme: "dark" },
  { name: "basketball-light-1.50-h4", sport: "basketball", t: 1.5, hover: 4, scheme: "light" },
  { name: "basketball-dark-1.50-h2", sport: "basketball", t: 1.5, hover: 2, scheme: "dark" },
  { name: "basketball-light-1.50-h2", sport: "basketball", t: 1.5, hover: 2, scheme: "light" },
  { name: "soccer-dark-3.00-h14", sport: "soccer", t: 3.0, hover: 14, scheme: "dark" },
  { name: "football-dark-1.00-h6", sport: "football", t: 1.0, hover: 6, scheme: "dark" },
  { name: "soccer-light-0.75-h8", sport: "soccer", t: 0.75, hover: 8, scheme: "light" },
  { name: "football-dark-1.00-h2", sport: "football", t: 1.0, hover: 2, scheme: "dark" },
  { name: "football-dark-0.90-h0-wide", sport: "football", t: 0.9, hover: 0, scheme: "dark", wide: true },
  { name: "soccer-light-3.00-h20-wide", sport: "soccer", t: 3.0, hover: 20, scheme: "light", wide: true },
  { name: "basketball-dark-1.50-h4-wide", sport: "basketball", t: 1.5, hover: 4, scheme: "dark", wide: true },
  { name: "football-light-1.53-h12-wide", sport: "football", t: 1.53, hover: 12, scheme: "light", wide: true },
];

/** The Mac harness's wells: the compact panel's, and a 560 pt panel's. */
const COMPACT = 312;
const WIDE = 532;

interface Data {
  readonly baseball: { scene: PlayScene; people: Record<string, TheaterPerson>; fielders: BaseballFielders; numbers: Record<string, string> };
  readonly football: { scene: FootballScene; people: Record<string, TheaterPerson> };
  readonly basketball: { scene: BasketballScene; people: Record<string, TheaterPerson> };
  readonly soccer: { scene: SoccerScene; lineups: ReturnType<typeof SoccerLineup.lineups>; people: Record<string, TheaterPerson> };
}

async function loadAll(): Promise<Data> {
  const [g2, mlbSummary, mlbNumbers, nfl, charts, nflBox, nba, nbaBox, soccer, rosters] = await Promise.all(
    [
      "mlb-ws-g2-summary-plays",
      "names-mlb-401908043-summary",
      "names-mlb-849802-numbers",
      "nfl-turnovers-plays",
      "nfl-depthcharts",
      "names-nfl-401873022-boxscore",
      "nba-every-play-401909890",
      "names-nba-401909890-boxscore",
      "soccer-theater-plays",
      "names-soccer-401879256-rosters",
    ].map(load),
  );
  // Baseball: Contreras singled to center, Chourio scored, Bauers to third.
  const side: SideOf = (id) => (id === "30" ? "top" : id === "8" ? "bottom" : null);
  const plays = (g2 as { plays: unknown[] }).plays;
  const names: Record<string, string> = {};
  for (const team of (mlbSummary as { boxscore: { players: { statistics: { athletes: { athlete: { id: string; shortName?: string } }[] }[] }[] } }).boxscore.players) {
    for (const g of team.statistics) for (const e of g.athletes) if (e.athlete.shortName) names[e.athlete.id] = e.athlete.shortName;
  }
  const single = parseBaseball(plays, plays.findIndex((p) => (p as { id?: string }).id === "4019080430104990057"), side, names)!;
  // Football: KC at SEA, on their depth charts.
  const game = (nfl as { games: { items: Record<string, unknown>[] }[] }).games[0]!;
  const teams: FootballTeams = { topIsHome: false, topID: "12", bottomID: "26", homeAbbreviation: "SEA", awayAbbreviation: "KC", homeName: "Seahawks", awayName: "Chiefs" };
  const item = game.items.find((i) => String(i.text ?? "").includes("pass short middle to E.Johnson"))!;
  const c = (charts as { teams: Record<string, unknown> }).teams;
  const pass = parseFootball(item, teams)!.slotted({ top: FootballDepthChart.from(c["12"])!, bottom: FootballDepthChart.from(c["26"])! });
  // Basketball: SA at UTAH, Wembanyama's three (Castle assists).
  const items = (nba as { games: { items: JSONValue[] }[] }).games[0]!.items;
  const three = parseScene(items, items.findIndex((i) => (i as { id?: string }).id === "40190989026"), { topIsHome: false, topID: "24", bottomID: "26", topName: "SA", bottomName: "UTAH" })!;
  // Soccer: Aston Villa v Man City, Haaland's header (52'), the half-time changes made.
  const match = (soccer as { matches: { home: { id: string }; clips: JSONValue[][] }[] }).matches[0]!;
  let header: SoccerScene | null = null;
  for (const clip of match.clips) {
    const i = clip.findIndex((p) => isMoment(p) && String((p as { text?: string }).text ?? "").includes("Erling Haaland (Manchester City) header from very close range"));
    if (i >= 0) header = parseSoccer(clip, i, match.home.id, keepers(clip));
    if (header) break;
  }
  const lineups = SoccerLineup.lineups((rosters as { rosters: JSONValue }).rosters, (team) => (team === match.home.id ? "top" : "bottom"));
  return {
    baseball: { scene: single, people: { ...TheaterPeople.boxscore(mlbSummary), ...TheaterPeople.rosters(mlbSummary) }, fielders: baseballFielders(mlbSummary, side), numbers: statcastNumbers(mlbNumbers) },
    football: { scene: pass, people: TheaterPeople.boxscore(nflBox) },
    basketball: { scene: three, people: TheaterPeople.boxscore(nbaBox) },
    soccer: { scene: header!, lineups, people: TheaterPeople.rosters(rosters) },
  };
}

export function NamesPreview() {
  const [params] = useSearchParams();
  const only = params.get("only") ?? "";
  const callouts = params.get("set") === "callouts";
  const scheme = useColorScheme();
  const [data, setData] = useState<Data | null>(null);
  useEffect(() => {
    let live = true;
    void loadAll().then((d) => {
      if (live) setData(d);
    });
    return () => {
      live = false;
    };
  }, []);
  if (!data) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, padding: 16, alignItems: "flex-start" }}>
      {/* The turn control shows while the pointer's over the theater (held here, as the Mac harness draws it). */}
      <style>{`[data-hovered] button[aria-label^="Turn the"] { opacity: 1 !important; transition: none !important; } [data-shot] [data-theater] ~ p { display: none; }`}</style>
      {(callouts ? CALLOUTS : CELLS)
        .filter((c) => c.scheme === scheme && c.name.startsWith(only))
        .map((c) => (
          <Panel key={c.name} cell={c} data={data} named={callouts} />
        ))}
    </div>
  );
}

/** A cell as the Mac's PanelCell frames it: the well, 14 pt in, on the panel. */
function Panel({ cell, data, named = false }: { cell: Cell; data: Data; named?: boolean }) {
  const slot = useMomentSlot();
  const posed = cell.hover != null || cell.x != null;
  const pointer: NamesPose | null = posed ? { index: cell.hover, x: cell.x, y: cell.y, appear: cell.appear } : null;
  return (
    <div
      data-shot={named ? cell.name : `${cell.name}-${cell.scheme}`}
      data-hovered={posed ? "" : undefined}
      style={{ padding: 14, borderRadius: 18, background: cell.scheme === "dark" ? "rgb(65 69 78)" : "rgb(236 236 238)" }}
    >
      <div style={{ width: cell.wide ? WIDE : COMPACT }}>
        <MomentProvider slot={slot}>{theater(cell, data, pointer)}</MomentProvider>
      </div>
    </div>
  );
}

const HEARD = Date.now() - 4000;

/** The Mac harness's basketball tag, held (BK.moment's `TheaterStatus(tag: "SPURS BALL")`). */
const SPURS_BALL = { text: "SPURS BALL", side: "top" } as const;

/** The game, off MLB's live feed (its path isn't MLB's): the Mac harness's play has no Statcast either. */
function event(id: string, sport: string, path: string): ScoreEvent {
  return { id, content: { kind: "match", top: { name: "", color: null }, bottom: { name: "", color: null } }, state: "final", start: Date.parse("2026-10-25T00:08:00Z"), ref: { kind: "espn", path, id, sport } } as unknown as ScoreEvent;
}

function theater(cell: Cell, data: Data, pointer: NamesPose | null): ReactNode {
  const scheme = cell.scheme;
  switch (cell.sport) {
    case "baseball":
    case "baseball-nonumbers":
    case "baseball-rest": {
      const kits: TheaterKits = { top: { color: "092c5c", alternate: "8fbce6" }, bottom: { color: "13294b", alternate: "ffc72c" } };
      const resting = cell.sport === "baseball-rest";
      const b = data.baseball;
      // After the play: Yelich up, Contreras on first, Bauers on third.
      const situation: Baseball = {
        balls: 0,
        strikes: 0,
        outs: 1,
        onFirst: true,
        onSecond: false,
        onThird: true,
        batter: "C. Yelich",
        pitcher: "D. Rasmussen",
        lastPlay: null,
        runners: [null, null, null],
        batterID: "31283",
        pitcherID: "42584",
        runnerIDs: ["39895", null, "35013"],
      };
      return (
        <PlayTheater
          state={resting ? { play: null, news: false, bats: "R" } : { play: b.scene, news: true, bats: "R" }}
          bases={resting ? [true, false, true] : null}
          batting="bottom"
          palette={teamPalette("092c5c", "13294b", scheme)}
          kits={kits}
          event={event("401908043", "baseball", "baseball/harness")}
          frozen={cell.t}
          situation={situation}
          inning={resting ? "Bot 1st" : null}
          live
          heard={HEARD}
          topTeam="Rays"
          bottomTeam="Brewers"
          people={b.people}
          fielders={b.fielders}
          numbers={cell.sport === "baseball-nonumbers" ? {} : b.numbers}
          pointer={pointer}
        />
      );
    }
    case "football": {
      const kits: TheaterKits = { top: { color: "e31837", alternate: "ffb612" }, bottom: { color: "002a5c", alternate: "69be28" } };
      return (
        <FootballTheater
          feed={null}
          teams={null}
          situation={null}
          kits={kits}
          palette={teamPalette("e31837", "002a5c", scheme)}
          topName="KC"
          bottomName="SEA"
          topTeam="Chiefs"
          bottomTeam="Seahawks"
          eventId="harness-football"
          preloaded={{ play: data.football.scene, news: true, heard: HEARD } as never}
          frozen={cell.t}
          people={data.football.people}
          pointer={pointer}
        />
      );
    }
    case "basketball": {
      const kits: TheaterKits = { top: { color: "000000", alternate: "c4ced4" }, bottom: { color: "4e008e", alternate: "79a3dc" } };
      const scene = data.basketball.scene;
      return (
        <BasketballTheater
          feed={null}
          teams={null}
          kits={kits}
          palette={teamPalette("000000", "4e008e", scheme)}
          topIsHome={false}
          topName="SA"
          bottomName="JAZZ"
          topTeam="Spurs"
          bottomTeam="Jazz"
          eventId="harness-basketball"
          said={SPURS_BALL}
          preloaded={{ plays: [scene], news: new Set([scene.id]), heard: HEARD }}
          frozen={cell.t}
          people={data.basketball.people}
          pointer={pointer}
        />
      );
    }
    case "soccer": {
      const kits: TheaterKits = { top: { color: "660e36", alternate: "000000" }, bottom: { color: "99c5ea", alternate: "000000" } };
      return (
        <SoccerTheater
          feed={null}
          homeTeamID={null}
          kits={kits}
          eventId="harness-soccer"
          topTeam="Aston Villa"
          bottomTeam="Man City"
          preloaded={{ scene: data.soccer.scene, news: true, lineups: data.soccer.lineups, heard: HEARD } as never}
          frozen={cell.t}
          people={data.soccer.people}
          pointer={pointer}
        />
      );
    }
  }
}
