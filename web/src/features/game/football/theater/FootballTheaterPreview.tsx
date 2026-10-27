/**
 * Development only: the football theater on real Monday Night Football
 * snaps (DAL at PHI, test/fixtures/mnf-dal-phi-plays.json), without a live
 * game (the Mac app's render harness, for the web): a touchdown run, a pick
 * six (the interception, taken all the way back, as the Swift tests do), a
 * field goal, a deep pass, a 34-yard run, an interception, a sack, a punt
 * downed at the 2, a flag before the snap and a kickoff return, each with a
 * Replay button. `?t=2.4` draws every tile at that instant, frozen, for
 * screenshots; `?only=Touchdown` keeps the tiles whose title starts so.
 * Fixtures load lazily from test/fixtures, so nothing here ships.
 */
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import type { FootballTeams } from "../../../../data/liveFeeds/football";
import { liveMoment, Tier, type Accent, type LiveMoment, type MomentKind } from "../../../../data/moments";
import { teamPalette } from "../../../../data/teamColors";
import { parse, type FootballScene, type FootballTheaterState } from "../../../../data/theater/footballScene";
import { useColorScheme } from "../../../../state/theme";
import { MomentProvider, useMomentSlot } from "../../core/moments";
import FootballTheater from "./FootballTheater";

const files = import.meta.glob<{ default: unknown }>("../../../../../test/fixtures/mnf-dal-phi-plays.json");

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

interface Tile {
  readonly title: string;
  readonly state: FootballTheaterState;
  readonly moment: LiveMoment | null;
}

/** DAL (6) visiting, the top team; PHI (21) at home. */
const TEAMS: FootballTeams = { topIsHome: false, topID: "6", bottomID: "21", homeAbbreviation: "PHI", awayAbbreviation: "DAL" };

function tiles(fixture: Fixture): Tile[] {
  const scene = (suffix: string) => {
    const item = fixture.items.find((i) => String(i.id).endsWith(suffix));
    return item ? parse(item, TEAMS) : null;
  };
  const moment = (play: FootballScene | null, kind: MomentKind, lead: string, tier: number = Tier.score, accents: Accent[] = []) =>
    play ? { ...liveMoment({ id: play.id, chart: "field", tier: tier as Tier, kind, lead, detail: play.text, side: play.scorer ?? play.offense, accents }), burst: true } : null;
  const tile = (title: string, play: FootballScene | null, m: LiveMoment | null = null): Tile[] => (play ? [{ title, state: { play, news: true }, moment: m }] : []);
  const touchdown = scene("1152");
  const pick = scene("3701");
  const six = pick?.clone() ?? null;
  if (six) {
    // The same pick, taken all the way back.
    six.scoring = "touchdown";
    six.to = 0;
  }
  const fieldGoal = scene("9213");
  const deep = scene("2186");
  const run = scene("3403");
  return [
    ...tile("Touchdown run", touchdown, moment(touchdown, "touchdown", "Touchdown")),
    ...tile("Pick six", six, moment(six, "touchdown", "Touchdown")),
    ...tile("Field goal", fieldGoal, moment(fieldGoal, "fieldGoal", "Field goal")),
    ...tile("Deep pass", deep, moment(deep, "passComplete", "Pass", Tier.routine, ["bigPlay"])),
    ...tile("Run, left tackle", run, moment(run, "rush", "Run", Tier.routine, ["bigPlay"])),
    ...tile("Interception", pick),
    ...tile("Sack", scene("3888")),
    ...tile("Punt, downed", scene("1812")),
    ...tile("Flag", scene("9361")),
    ...tile("Kickoff return", scene("0940")),
    ...tile("Incomplete", scene("9145")),
  ];
}

export function FootballTheaterPreview() {
  const [params] = useSearchParams();
  const t = params.get("t");
  const frozen = t != null && t !== "" ? (t === "end" ? Infinity : Number(t)) : null;
  const only = params.get("only");
  const [data, setData] = useState<Fixture | null>(null);
  useEffect(() => {
    let live = true;
    void files["../../../../../test/fixtures/mnf-dal-phi-plays.json"]?.().then((m) => {
      if (live) setData(m.default as Fixture);
    });
    return () => {
      live = false;
    };
  }, []);
  if (!data) return null;
  const list = tiles(data).filter((tile) => !only || tile.title.toLowerCase().startsWith(only.toLowerCase()));
  return (
    <div style={{ display: "grid", gap: "calc(16 * var(--pt))", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, calc(320 * var(--pt))), 1fr))", padding: "var(--gutter)" }}>
      {list.map((tile) => (
        <PreviewTile key={tile.title} tile={tile} fixture={data} frozen={frozen} />
      ))}
    </div>
  );
}

function PreviewTile({ tile, fixture, frozen }: { tile: Tile; fixture: Fixture; frozen: number | null }) {
  const [run, setRun] = useState(0);
  return (
    <section data-tile={tile.title} style={{ display: "flex", flexDirection: "column", gap: "calc(6 * var(--pt))" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: "var(--text-callout)" }}>
        <strong style={{ fontWeight: 600 }}>{tile.title}</strong>
        <button type="button" onClick={() => setRun((n) => n + 1)} style={{ color: "var(--accent-text)" }}>
          Replay
        </button>
      </div>
      <PreviewStage key={run} tile={tile} fixture={fixture} frozen={frozen} />
      <p style={{ fontSize: "var(--text-caption)", color: "var(--label-secondary)" }}>{tile.state.play?.text}</p>
    </section>
  );
}

/** One replay: its own moment slot, offered the play's moment once the theater is up (each replay is news again). */
function PreviewStage({ tile, fixture, frozen }: { tile: Tile; fixture: Fixture; frozen: number | null }) {
  const scheme = useColorScheme();
  const slot = useMomentSlot();
  const { home, away } = fixture;
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
