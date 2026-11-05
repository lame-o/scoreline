/**
 * Development only: a theater on the choreography engine, live, on a
 * recording played back as the page's broadcast would hand it over
 * (replaySource.ts): LAL at GS's fourth quarter (Tests/Fixtures/theater/
 * basketball_nba/401909285, the Mac's gate fixture), every play arriving
 * when the recorder first saw it, the clock a fixed delay behind. `?at=` opens
 * that many seconds into the recording (default 0), `?d=` sets the delay
 * (default 50 s). `?sport=soccer`: Villa v City's first eleven minutes
 * instead (Tests/Fixtures/broadcast/soccer_eng.1/401879256, soccer's gate
 * fixture, with the match's rosters for both elevens; default delay 60 s).
 * For checking the director's frames by eye and for tracing their cost
 * (ARCHITECTURE.md). Fixtures load lazily from test/fixtures, so nothing here
 * ships.
 */
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import type { JSONValue } from "../../../../data/json";
import { teamPalette } from "../../../../data/teamColors";
import { basketballArrivals } from "../../../../data/theater/replayTimeline";
import { soccerArrivals } from "../../../../data/theater/replaySoccer";
import { SoccerLineup } from "../../../../data/theater/soccerScene";
import { TheaterPeople } from "../../../../data/theater/theaterPeople";
import { TheaterCues } from "../../../../data/theater/theaterView";
import { useColorScheme } from "../../../../state/theme";
import BasketballDirected from "../../nba/theater/BasketballDirected";
import SoccerDirected from "../../soccer/theater/SoccerDirected";
import { MomentProvider, useMomentSlot } from "../moments";
import { ReplaySource } from "./replaySource";

const files = import.meta.glob<{ default: unknown }>([
  "../../../../../test/fixtures/directed-nba-401909285.json",
  "../../../../../test/fixtures/directed-soccer-401879256.json",
  "../../../../../test/fixtures/names-soccer-401879256-rosters.json",
]);

const load = async (name: string): Promise<unknown> => {
  const entry = Object.entries(files).find(([path]) => path.endsWith(name));
  return entry ? (await entry[1]()).default : null;
};

interface Recording {
  readonly competitors: readonly { homeAway: string; id: string; abbreviation: string; name: string }[];
  readonly arrivals: readonly { at: number; play: Record<string, unknown> }[];
  /** Soccer's: the match's rosters (both elevens and their changes). */
  readonly rosters?: JSONValue;
}

export function DirectedPreview() {
  const [params] = useSearchParams();
  const soccer = params.get("sport") === "soccer";
  const [recording, setRecording] = useState<Recording | null>(null);
  useEffect(() => {
    let live = true;
    const loading = soccer
      ? Promise.all([load("directed-soccer-401879256.json"), load("names-soccer-401879256-rosters.json")]).then(([r, rosters]) => ({ ...(r as Recording), rosters: (rosters as { rosters: JSONValue }).rosters }))
      : load("directed-nba-401909285.json").then((r) => r as Recording);
    void loading.then((r) => live && setRecording(r));
    return () => {
      live = false;
    };
  }, [soccer]);
  if (!recording) return null;
  const at = Number(params.get("at") ?? 0);
  return soccer ? <DirectedPitch recording={recording} at={at} delay={Number(params.get("d") ?? 60)} /> : <Directed recording={recording} at={at} delay={Number(params.get("d") ?? 50)} />;
}

function Directed({ recording, at, delay }: { recording: Recording; at: number; delay: number }) {
  const scheme = useColorScheme();
  const slot = useMomentSlot();
  const home = recording.competitors.find((c) => c.homeAway === "home")!;
  const away = recording.competitors.find((c) => c.homeAway === "away")!;
  const source = useMemo(() => {
    const when = new Map(recording.arrivals.map((a) => [a.play.id as string, a.at]));
    const arrivals = basketballArrivals(
      recording.arrivals.map((a) => a.play),
      0,
      (id) => when.get(id) ?? null,
    );
    return new ReplaySource(arrivals, at, delay);
  }, [recording, at, delay]);
  const cues = useMemo(() => new TheaterCues(), []);
  // For the page's checks: the source the director reads.
  (window as unknown as { __directedSource?: ReplaySource }).__directedSource = source;
  const palette = teamPalette("#552583", "#1d428a", scheme);
  const kits = { top: { color: "#552583", alternate: "#fdb927" }, bottom: { color: "#1d428a", alternate: "#ffc72c" } };
  const teams = { topIsHome: false, topID: away.id, bottomID: home.id, topName: away.abbreviation, bottomName: home.abbreviation };
  return (
    <main style={{ padding: "calc(16 * var(--pt))", maxWidth: 760, display: "flex", flexDirection: "column", gap: "calc(8 * var(--pt))" }}>
      <h1 style={{ fontSize: "var(--text-title3)", fontWeight: 600 }}>
        {away.name} at {home.name}: the court on the director
      </h1>
      <MomentProvider slot={slot}>
        <BasketballDirected
          source={source}
          cues={cues}
          teams={teams}
          kits={kits}
          palette={palette}
          names={{ top: "Lakers", bottom: "Warriors" }}
          homeName={home.abbreviation}
          eventId={`directed-${home.id}`}
          heard={Date.now()}
        />
      </MomentProvider>
    </main>
  );
}

/** Soccer's: the home team on top, as the page has it. */
function DirectedPitch({ recording, at, delay }: { recording: Recording; at: number; delay: number }) {
  const slot = useMomentSlot();
  const home = recording.competitors.find((c) => c.homeAway === "home")!;
  const away = recording.competitors.find((c) => c.homeAway === "away")!;
  const source = useMemo(() => {
    const when = new Map(recording.arrivals.map((a) => [a.play.id as string, a.at]));
    const arrivals = soccerArrivals(
      recording.arrivals.map((a) => a.play as JSONValue),
      0,
      (id) => when.get(id) ?? null,
    );
    return new ReplaySource(arrivals, at, delay);
  }, [recording, at, delay]);
  const cues = useMemo(() => new TheaterCues(), []);
  (window as unknown as { __directedSource?: ReplaySource }).__directedSource = source;
  const lineups = useMemo(() => SoccerLineup.lineups(recording.rosters ?? null, (team) => (team === home.id ? "top" : "bottom")), [recording, home.id]);
  const people = useMemo(() => TheaterPeople.rosters({ rosters: recording.rosters ?? null }), [recording]);
  const kits = { top: { color: "#670e36", alternate: "#95bfe5" }, bottom: { color: "#6cabdd", alternate: "#1c2c5b" } };
  const names = { top: "Aston Villa", bottom: "Man City", topColor: "670e36", bottomColor: "6cabdd" };
  return (
    <main style={{ padding: "calc(16 * var(--pt))", maxWidth: 760, display: "flex", flexDirection: "column", gap: "calc(8 * var(--pt))" }}>
      <h1 style={{ fontSize: "var(--text-title3)", fontWeight: 600 }}>
        {home.name} v {away.name}: the pitch on the director
      </h1>
      <MomentProvider slot={slot}>
        <SoccerDirected source={source} cues={cues} homeTeamID={home.id} lineups={lineups} kits={kits} names={names} eventId={`directed-${home.id}`} people={people} heard={Date.now()} />
      </MomentProvider>
    </main>
  );
}
