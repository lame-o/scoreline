/**
 * Development only: the football theater on real Monday Night Football
 * snaps (DAL at PHI, test/fixtures/mnf-dal-phi-plays.json), without a live
 * game (the Mac app's render harness, for the web): a touchdown run, a pick
 * six (the interception, taken all the way back, as the Swift tests do),
 * the touchdown's extra point and a two-point try as their own beats, a
 * field goal, a deep pass, a 34-yard run from a heavy set, a snap off the
 * right hash, an interception, a sack, a punt downed at the 2, a flag
 * before the snap and a kickoff return; and from the NFL's turnovers, hits
 * and flags of 25 Oct (nfl-turnovers-plays.json, Kansas City at Seattle on
 * their depth charts): a strip-sack run back, a hit as he threw, holding on a
 * run, a false start, offsetting flags and a blocked field goal. Each with a
 * Replay button. `?t=2.4` draws every tile at that instant, frozen, for
 * screenshots; `?only=Touchdown` keeps the tiles whose title starts so.
 * Fixtures load lazily from test/fixtures, so nothing here ships.
 */
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import type { FootballTeams } from "../../../../data/liveFeeds/football";
import { liveMoment, Tier, type Accent, type LiveMoment, type MomentKind } from "../../../../data/moments";
import { teamPalette } from "../../../../data/teamColors";
import { FootballDepthChart, parse, type FootballScene, type FootballTheaterState } from "../../../../data/theater/footballScene";
import { spot } from "../../../../data/theater/footballTheater";
import { useColorScheme } from "../../../../state/theme";
import { MomentProvider, useMomentSlot } from "../../core/moments";
import FootballTheater from "./FootballTheater";

const files = import.meta.glob<{ default: unknown }>("../../../../../test/fixtures/{mnf-dal-phi-plays,nfl-turnovers-plays,nfl-depthcharts}.json");
const fixturePath = (name: string) => `../../../../../test/fixtures/${name}.json`;

interface Team {
  readonly id: string;
  readonly abbreviation: string;
  readonly color: string;
  readonly alternateColor: string;
}

interface Fixture {
  readonly home: Team;
  readonly away: Team;
  readonly items: readonly Record<string, unknown>[];
}

/** The 25 Oct games: teams without colors (the preview gives each its own). */
interface Turnovers {
  readonly games: readonly { readonly home: { id: string; abbreviation: string; name: string }; readonly away: { id: string; abbreviation: string; name: string }; readonly items: readonly Record<string, unknown>[] }[];
}

interface Tile {
  readonly title: string;
  readonly state: FootballTheaterState;
  readonly moment: LiveMoment | null;
  /** Whose game: the visitors on top. */
  readonly home: Team;
  readonly away: Team;
}

/** The 25 Oct teams' colors (their own and second), as ESPN lists them. */
const COLORS: Readonly<Record<string, readonly [string, string]>> = {
  SEA: ["002244", "69be28"],
  KC: ["e31837", "ffb612"],
  CAR: ["0085ca", "000000"],
  TB: ["bd1c36", "3e3a35"],
  DET: ["0076b6", "bbbbbb"],
  GB: ["204e32", "ffb612"],
  HOU: ["00143f", "c41230"],
  NYG: ["003c7f", "c9243f"],
};

/** DAL (6) visiting, the top team; PHI (21) at home. */
const TEAMS: FootballTeams = { topIsHome: false, topID: "6", bottomID: "21", homeAbbreviation: "PHI", awayAbbreviation: "DAL" };

function tiles(fixture: Fixture, turnovers: Turnovers | null, charts: Record<string, unknown> | null): Tile[] {
  const scene = (suffix: string) => {
    const item = fixture.items.find((i) => String(i.id).endsWith(suffix));
    return item ? parse(item, TEAMS) : null;
  };
  const moment = (play: FootballScene | null, kind: MomentKind, lead: string, tier: number = Tier.score, accents: Accent[] = []) =>
    play ? { ...liveMoment({ id: play.id, chart: "field", tier: tier as Tier, kind, lead, detail: play.text, side: play.scorer ?? play.offense, accents }), burst: true } : null;
  const tile = (title: string, play: FootballScene | null, m: LiveMoment | null = null): Tile[] => (play ? [{ title, state: { play, news: true }, moment: m, home: fixture.home, away: fixture.away }] : []);
  // The 25 Oct plays, each with its game's teams (Kansas City at Seattle's on their depth charts).
  const kc = charts ? FootballDepthChart.from(charts["12"]) : null;
  const sea = charts ? FootballDepthChart.from(charts["26"]) : null;
  const pro = (title: string, clue: string, m: (play: FootballScene) => LiveMoment | null = () => null): Tile[] => {
    for (const g of turnovers?.games ?? []) {
      const item = g.items.find((i) => String(i.text ?? "").includes(clue));
      if (!item) continue;
      const teams: FootballTeams = { topIsHome: false, topID: g.away.id, bottomID: g.home.id, homeAbbreviation: g.home.abbreviation, awayAbbreviation: g.away.abbreviation, homeName: g.home.name, awayName: g.away.name };
      const parsed = parse(item, teams);
      if (!parsed) continue;
      const play = g.away.id === "12" && kc && sea ? parsed.slotted({ top: kc, bottom: sea }) : parsed;
      const team = (t: { id: string; abbreviation: string }): Team => ({ id: t.id, abbreviation: t.abbreviation, color: COLORS[t.abbreviation]?.[0] ?? "808080", alternateColor: COLORS[t.abbreviation]?.[1] ?? "ffffff" });
      return [{ title, state: { play, news: true }, moment: m(play), home: team(g.home), away: team(g.away) }];
    }
    return [];
  };
  const touchdown = scene("1152");
  const pick = scene("3701");
  const six = pick?.clone() ?? null;
  if (six) {
    // The same pick, taken all the way back.
    six.scoring = "touchdown";
    six.to = 0;
  }
  const fieldGoal = scene("9213");
  // A snap spotted on its hash from the plays before it: the one after a pass pushed out on the right.
  const spotted = spot(
    fixture.items.flatMap((i) => parse(i, TEAMS) ?? []),
    null,
  );
  const afterOut = spotted[spotted.findIndex((s) => s.id.endsWith("9274")) + 1] ?? null;
  const deep = scene("2186");
  const run = scene("3403");
  return [
    ...tile("Touchdown run", touchdown, moment(touchdown, "touchdown", "Touchdown")),
    ...tile("Pick six", six, moment(six, "touchdown", "Touchdown")),
    ...tile("Extra point", touchdown?.conversion ?? null),
    ...tile("Two-point try", scene("3048")?.conversion ?? null),
    ...tile("Field goal", fieldGoal, moment(fieldGoal, "fieldGoal", "Field goal")),
    ...tile("Deep pass", deep, moment(deep, "passComplete", "Pass", Tier.routine, ["bigPlay"])),
    ...tile("Run, left tackle", run, moment(run, "rush", "Run", Tier.routine, ["bigPlay"])),
    ...tile("Off the right hash", afterOut),
    ...tile("Interception", pick),
    ...tile("Sack", scene("3888")),
    ...tile("Punt, downed", scene("1812")),
    ...tile("Flag", scene("9361")),
    ...tile("Kickoff return", scene("0940")),
    ...tile("Incomplete", scene("9145")),
    ...pro("Strip-sack", "B.Young sacked at CAR 31 for -9 yards (A.Muhammad). FUMBLES", (play) => moment(play, "touchdown", "Touchdown")),
    ...pro("Hit as he threw", "P.Mahomes pass incomplete deep right to X.Worthy [D.Hall]"),
    ...pro("Holding on a run", "K.Walker left tackle to SEA 39 for 6 yards (U.Nwosu).PENALTY on KC-K.Suamataia"),
    ...pro("False start", "PENALTY on SEA-G.Zabel, False Start"),
    ...pro("Offsetting", "Penalty on KC-J.Ezeudu, Offensive Holding, offsetting"),
    ...pro("Blocked field goal", "35 yard field goal is BLOCKED (D.Wonnum)"),
  ];
}

export function FootballTheaterPreview() {
  const [params] = useSearchParams();
  const t = params.get("t");
  const frozen = t != null && t !== "" ? (t === "end" ? Infinity : Number(t)) : null;
  const only = params.get("only");
  const [data, setData] = useState<{ mnf: Fixture; turnovers: Turnovers | null; charts: Record<string, unknown> | null } | null>(null);
  useEffect(() => {
    let live = true;
    const load = (name: string) => files[fixturePath(name)]?.().then((m) => m.default) ?? Promise.resolve(null);
    void Promise.all([load("mnf-dal-phi-plays"), load("nfl-turnovers-plays"), load("nfl-depthcharts")]).then(([mnf, turnovers, charts]) => {
      if (live && mnf) setData({ mnf: mnf as Fixture, turnovers: turnovers as Turnovers | null, charts: (charts as { teams?: Record<string, unknown> } | null)?.teams ?? null });
    });
    return () => {
      live = false;
    };
  }, []);
  if (!data) return null;
  const list = tiles(data.mnf, data.turnovers, data.charts).filter((tile) => !only || tile.title.toLowerCase().startsWith(only.toLowerCase()));
  return (
    <div style={{ display: "grid", gap: "calc(16 * var(--pt))", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, calc(320 * var(--pt))), 1fr))", padding: "var(--gutter)" }}>
      {list.map((tile) => (
        <PreviewTile key={tile.title} tile={tile} frozen={frozen} />
      ))}
    </div>
  );
}

function PreviewTile({ tile, frozen }: { tile: Tile; frozen: number | null }) {
  const [run, setRun] = useState(0);
  return (
    <section data-tile={tile.title} style={{ display: "flex", flexDirection: "column", gap: "calc(6 * var(--pt))" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: "var(--text-callout)" }}>
        <strong style={{ fontWeight: 600 }}>{tile.title}</strong>
        <button type="button" onClick={() => setRun((n) => n + 1)} style={{ color: "var(--accent-text)" }}>
          Replay
        </button>
      </div>
      <PreviewStage key={run} tile={tile} frozen={frozen} />
      <p style={{ fontSize: "var(--text-caption)", color: "var(--label-secondary)" }}>{tile.state.play?.text}</p>
    </section>
  );
}

/** One replay: its own moment slot, offered the play's moment once the theater is up (each replay is news again). */
function PreviewStage({ tile, frozen }: { tile: Tile; frozen: number | null }) {
  const scheme = useColorScheme();
  const slot = useMomentSlot();
  const { home, away } = tile;
  const palette = teamPalette(away.color, home.color, scheme);
  const kits = { top: { color: away.color, alternate: away.alternateColor }, bottom: { color: home.color, alternate: home.alternateColor } };
  useEffect(() => {
    // A tick later: development's StrictMode runs this twice, and the slot would take the second offer as already seen.
    const moment = tile.moment;
    if (!moment) return;
    const id = setTimeout(() => slot.offer([moment]), 0);
    return () => clearTimeout(id);
  }, [slot, tile.moment]);
  return (
    <MomentProvider slot={slot}>
      <FootballTheater feed={null} teams={null} situation={null} kits={kits} palette={palette} topName={away.abbreviation} bottomName={home.abbreviation} preloaded={tile.state} frozen={frozen} />
    </MomentProvider>
  );
}
