/**
 * Development only: the soccer theater on real Premier League moments
 * (24–25 Oct 2026, test/fixtures/soccer-theater-plays.json, each clip ESPN's
 * core plays round a big moment), without a live match (the Mac app's
 * render harness, for the web): Gabriel's header after a nine-pass move,
 * Haaland's header from a free kick, McBurnie's penalty, Penders' own goal,
 * Cherki saved by Suzuki, Haaland blocked, Ndiaye off the post and
 * Gelhardt's big chance wide, each with a Replay button. `?t=4.2` draws
 * every tile at that instant, frozen, for screenshots (`?t=end`: as it
 * ended); `?only=Gabriel` keeps the tiles whose title starts so. Fixtures
 * load lazily from test/fixtures, so nothing here ships.
 */
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import type { JSONValue } from "../../../../data/json";
import { actionMoment, pitchAction } from "../../../../data/liveFeeds/soccer";
import type { LiveMoment } from "../../../../data/moments";
import { isMoment, keepers, parse, type SoccerTheaterState } from "../../../../data/theater/soccerScene";
import { MomentProvider, useMomentSlot } from "../../core/moments";
import SoccerTheater from "./SoccerTheater";

const files = import.meta.glob<{ default: unknown }>("../../../../../test/fixtures/soccer-theater-plays.json");

interface Team {
  readonly id: string;
  readonly abbreviation: string;
  readonly color: string;
  readonly alternateColor: string;
}

interface Fixture {
  readonly matches: readonly { readonly home: Team; readonly away: Team; readonly clips: readonly (readonly JSONValue[])[] }[];
}

interface Tile {
  readonly title: string;
  readonly state: SoccerTheaterState;
  readonly moment: LiveMoment | null;
  readonly home: Team;
  readonly away: Team;
}

const CLUES: readonly [string, string][] = [
  ["Gabriel's header", "Gabriel Magalhães (Arsenal) header from very close range"],
  ["Haaland's header", "Erling Haaland (Manchester City) header from very close range"],
  ["Penalty", "converts the penalty"],
  ["Own goal", "Own Goal by Mike Penders"],
  ["Save", "Rayan Cherki (Manchester City) left footed shot from the centre"],
  ["Blocked", "Erling Haaland (Manchester City) header from the centre of the box is blocked"],
  ["Off the post", "Iliman Ndiaye (Manchester City) hits the left post"],
  ["Big chance", "Joe Gelhardt (Hull City) left footed shot from the centre of the box is close"],
];

function tiles(fixture: Fixture): Tile[] {
  const out: Tile[] = [];
  for (const [title, clue] of CLUES) {
    found: for (const match of fixture.matches) {
      for (const clip of match.clips) {
        const i = clip.findIndex((p) => isMoment(p) && String((p as { text?: string }).text ?? "").includes(clue));
        if (i < 0) continue;
        const scene = parse(clip, i, match.home.id, keepers(clip));
        if (!scene) continue;
        const action = pitchAction(clip[i], 0, match.home.id);
        const m = action ? actionMoment(action) : null;
        out.push({ title, state: { scene, news: true }, moment: m ? { ...m, burst: true } : null, home: match.home, away: match.away });
        break found;
      }
    }
  }
  return out;
}

export function SoccerTheaterPreview() {
  const [params] = useSearchParams();
  const t = params.get("t");
  const frozen = t != null && t !== "" ? (t === "end" ? Infinity : Number(t)) : null;
  const only = params.get("only");
  const [data, setData] = useState<Fixture | null>(null);
  useEffect(() => {
    let live = true;
    void files["../../../../../test/fixtures/soccer-theater-plays.json"]?.().then((m) => {
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
        <strong style={{ fontWeight: 600 }}>
          {tile.title} <span style={{ fontWeight: 400, color: "var(--label-secondary)" }}>{`${tile.home.abbreviation}–${tile.away.abbreviation}`}</span>
        </strong>
        <button type="button" onClick={() => setRun((n) => n + 1)} style={{ color: "var(--accent-text)" }}>
          Replay
        </button>
      </div>
      <PreviewStage key={run} tile={tile} frozen={frozen} />
    </section>
  );
}

/** One replay: its own moment slot, offered the moment once the theater is up (each replay is news again). */
function PreviewStage({ tile, frozen }: { tile: Tile; frozen: number | null }) {
  const slot = useMomentSlot();
  const kits = { top: { color: tile.home.color, alternate: tile.home.alternateColor }, bottom: { color: tile.away.color, alternate: tile.away.alternateColor } };
  useEffect(() => {
    // A tick later: development's StrictMode runs this twice, and the slot would take the second offer as already seen.
    const moment = tile.moment;
    if (!moment) return;
    const id = setTimeout(() => slot.offer([moment]), 0);
    return () => clearTimeout(id);
  }, [slot, tile.moment]);
  return (
    <MomentProvider slot={slot}>
      <SoccerTheater feed={null} homeTeamID={tile.home.id} kits={kits} preloaded={tile.state} frozen={frozen} />
    </MomentProvider>
  );
}
