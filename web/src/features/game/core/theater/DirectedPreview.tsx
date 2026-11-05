/**
 * Development only: a theater on the choreography engine, live, on a
 * recording played back as the page's broadcast would hand it over
 * (replaySource.ts): LAL at GS's fourth quarter (Tests/Fixtures/theater/
 * basketball_nba/401909285, the Mac's gate fixture), every play arriving
 * when the recorder first saw it, the clock a fixed delay behind. `?sport=baseball`
 * plays the Mac's baseball gate fixture instead (Tests/Fixtures/theater/
 * baseball_mlb/ws3-synthetic: Brewers at Rays, its arrivals synthesized). `?at=`
 * opens that many seconds into the recording (default 0), `?d=` sets the delay
 * (default 50 s; baseball's 55 s, every entry in before its pitch's horizon).
 * For checking the director's frames by eye and for tracing their cost
 * (ARCHITECTURE.md). Fixtures load lazily from test/fixtures, so nothing
 * here ships.
 */
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { baseballArrivals } from "../../../../data/mlb/replayBaseball";
import { teamPalette } from "../../../../data/teamColors";
import { basketballArrivals } from "../../../../data/theater/replayTimeline";
import { TheaterCues } from "../../../../data/theater/theaterView";
import { useColorScheme } from "../../../../state/theme";
import BaseballDirected from "../../mlb/theater/BaseballDirected";
import BasketballDirected from "../../nba/theater/BasketballDirected";
import { MomentProvider, useMomentSlot } from "../moments";
import { ReplaySource } from "./replaySource";

const files = import.meta.glob<{ default: unknown }>(["../../../../../test/fixtures/directed-nba-401909285.json", "../../../../../test/fixtures/directed-mlb-ws3-synthetic.json"]);
const FIXTURES = { basketball: "directed-nba-401909285.json", baseball: "directed-mlb-ws3-synthetic.json" } as const;

interface Recording {
  readonly competitors: readonly { homeAway: string; id: string; abbreviation: string; name: string }[];
  readonly arrivals: readonly { at: number; play: Record<string, unknown> }[];
}

export function DirectedPreview() {
  const [params] = useSearchParams();
  const sport = params.get("sport") === "baseball" ? "baseball" : "basketball";
  const [recording, setRecording] = useState<{ sport: string; value: Recording } | null>(null);
  useEffect(() => {
    const load = Object.entries(files).find(([path]) => path.endsWith(FIXTURES[sport]))?.[1];
    void load?.().then((m) => setRecording({ sport, value: m.default as Recording }));
  }, [sport]);
  if (recording?.sport !== sport) return null;
  const at = Number(params.get("at") ?? 0);
  if (sport === "baseball") return <DirectedField recording={recording.value} at={at} delay={Number(params.get("d") ?? 55)} />;
  return <Directed recording={recording.value} at={at} delay={Number(params.get("d") ?? 50)} />;
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

/** The field on the director: two navies, the Brewers in their gold as the theaters dress them. */
function DirectedField({ recording, at, delay }: { recording: Recording; at: number; delay: number }) {
  const slot = useMomentSlot();
  const home = recording.competitors.find((c) => c.homeAway === "home")!;
  const away = recording.competitors.find((c) => c.homeAway === "away")!;
  const source = useMemo(() => {
    const when = new Map(recording.arrivals.map((a) => [a.play.id as string, a.at]));
    const arrivals = baseballArrivals(
      recording.arrivals.map((a) => a.play),
      0,
      (id) => when.get(id) ?? null,
    );
    return new ReplaySource(arrivals, at, delay);
  }, [recording, at, delay]);
  const cues = useMemo(() => new TheaterCues(), []);
  (window as unknown as { __directedSource?: ReplaySource }).__directedSource = source;
  const kits = { top: { color: "#13294b", alternate: "#ffc52f" }, bottom: { color: "#092c5c", alternate: "#8fbce6" } };
  return (
    <main style={{ padding: "calc(16 * var(--pt))", maxWidth: 760, display: "flex", flexDirection: "column", gap: "calc(8 * var(--pt))" }}>
      <h1 style={{ fontSize: "var(--text-title3)", fontWeight: 600 }}>
        {away.name} at {home.name}: the field on the director
      </h1>
      <MomentProvider slot={slot}>
        <BaseballDirected
          source={source}
          cues={cues}
          kits={kits}
          topID={away.id}
          bottomID={home.id}
          topTeam="Brewers"
          bottomTeam="Rays"
          eventId={`directed-mlb-${home.id}`}
          heard={Date.now()}
        />
      </MomentProvider>
    </main>
  );
}
