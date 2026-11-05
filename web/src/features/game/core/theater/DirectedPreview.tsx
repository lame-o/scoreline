/**
 * Development only: a theater on the choreography engine, live, on a
 * recording played back as the page's broadcast would hand it over
 * (replaySource.ts): LAL at GS's fourth quarter (Tests/Fixtures/theater/
 * basketball_nba/401909285, the Mac's gate fixture), every play arriving
 * when the recorder first saw it, the clock a fixed delay behind. `?at=` opens
 * that many seconds into the recording (default 0), `?d=` sets the delay
 * (default 50 s). `?sport=football`: DAL at PHI's first quarter
 * (Tests/Fixtures/theater/football_nfl/401873009-synthetic, the Mac's
 * football gate fixture), the delay 74 s (the broadcast's football D), the
 * watermark the snap's horizon and the margin ahead of p. For checking the
 * director's frames by eye and for tracing their cost (ARCHITECTURE.md).
 * Fixtures load lazily from test/fixtures, so nothing here ships.
 */
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { teamPalette } from "../../../../data/teamColors";
import { FOOTBALL_AHEAD, footballArrivals } from "../../../../data/theater/replayFootball";
import { basketballArrivals } from "../../../../data/theater/replayTimeline";
import { TheaterCues } from "../../../../data/theater/theaterView";
import { useColorScheme } from "../../../../state/theme";
import FootballDirected from "../../football/theater/FootballDirected";
import BasketballDirected from "../../nba/theater/BasketballDirected";
import { MomentProvider, useMomentSlot } from "../moments";
import { ReplaySource } from "./replaySource";

const files = import.meta.glob<{ default: unknown }>(["../../../../../test/fixtures/directed-nba-401909285.json", "../../../../../test/fixtures/directed-nfl-401873009.json"]);

interface Recording {
  readonly competitors: readonly { homeAway: string; id: string; abbreviation: string; name: string }[];
  readonly arrivals: readonly { at: number; play: Record<string, unknown> }[];
}

export function DirectedPreview() {
  const [params] = useSearchParams();
  const football = params.get("sport") === "football";
  const [recording, setRecording] = useState<{ football: boolean; value: Recording } | null>(null);
  useEffect(() => {
    const load = Object.entries(files).find(([path]) => path.includes(football ? "directed-nfl-" : "directed-nba-"))?.[1];
    void load?.().then((m) => setRecording({ football, value: m.default as Recording }));
  }, [football]);
  if (!recording || recording.football !== football) return null;
  const at = Number(params.get("at") ?? 0);
  if (football) return <DirectedField recording={recording.value} at={at} delay={Number(params.get("d") ?? 74)} />;
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

function DirectedField({ recording, at, delay }: { recording: Recording; at: number; delay: number }) {
  const scheme = useColorScheme();
  const slot = useMomentSlot();
  const home = recording.competitors.find((c) => c.homeAway === "home")!;
  const away = recording.competitors.find((c) => c.homeAway === "away")!;
  const source = useMemo(() => {
    const when = new Map(recording.arrivals.map((a) => [a.play.id as string, a.at]));
    const arrivals = footballArrivals(
      recording.arrivals.map((a) => a.play),
      0,
      (id) => when.get(id) ?? null,
    );
    return new ReplaySource(arrivals, at, delay, Date.now() / 1000, { ahead: FOOTBALL_AHEAD, rereads: true });
  }, [recording, at, delay]);
  const cues = useMemo(() => new TheaterCues(), []);
  // For the page's checks: the source the director reads.
  (window as unknown as { __directedSource?: ReplaySource }).__directedSource = source;
  const palette = teamPalette("#002244", "#004c54", scheme);
  const kits = { top: { color: "#002244", alternate: "#869397" }, bottom: { color: "#004c54", alternate: "#a5acaf" } };
  // American football lists the visitors first: the top team.
  const teams = { topIsHome: false, topID: away.id, bottomID: home.id, homeAbbreviation: home.abbreviation, awayAbbreviation: away.abbreviation };
  return (
    <main style={{ padding: "calc(16 * var(--pt))", maxWidth: 760, display: "flex", flexDirection: "column", gap: "calc(8 * var(--pt))" }}>
      <h1 style={{ fontSize: "var(--text-title3)", fontWeight: 600 }}>
        {away.name} at {home.name}: the field on the director
      </h1>
      <MomentProvider slot={slot}>
        <FootballDirected
          source={source}
          cues={cues}
          teams={teams}
          kits={kits}
          palette={palette}
          topName={away.abbreviation}
          bottomName={home.abbreviation}
          names={{ top: "Cowboys", bottom: "Eagles" }}
          situation={null}
          eventId={`directed-${home.id}`}
          heard={Date.now()}
        />
      </MomentProvider>
    </main>
  );
}
