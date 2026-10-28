/**
 * Development only: the basketball theater on the Swift tests' three games
 * (test/fixtures/nba-theater-plays.json: BKN at BOS in overtime, DET at NY,
 * SAC at SA), without a live game (the Mac app's render harness, for the
 * web): Brown Jr.'s corner three at the end of regulation (a decisive
 * buzzer-beater), Tatum's winner in overtime, White's posterizing dunk,
 * Demin's steal and dunk, Wembanyama's tip at the half and his block, an
 * and-one, an alley-oop, a hook, a step-back, a floater, a fadeaway, a
 * late miss, and the court between plays, each with a Replay button. Each
 * play's moment is the live lane's own (`momentAt`). `?t=2.4` draws every
 * tile at that instant, frozen, for screenshots (`?t=end`: as it ended);
 * `?only=Posterized` keeps the tiles whose title starts so. Fixtures load
 * lazily from test/fixtures, so nothing here ships.
 */
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { momentAt, type Teams } from "../../../../data/liveFeeds/basketball";
import type { Side } from "../../../../data/models";
import type { LiveMoment } from "../../../../data/moments";
import { teamPalette } from "../../../../data/teamColors";
import { parseScene, replays, type BasketballMove, type BasketballScene, type BasketballTheaterState } from "../../../../data/theater/basketballScene";
import { useColorScheme } from "../../../../state/theme";
import { MomentProvider, useMomentSlot } from "../../core/moments";
import BasketballTheater from "./BasketballTheater";

const files = import.meta.glob<{ default: unknown }>("../../../../../test/fixtures/nba-theater-plays.json");

interface Team {
  readonly id: string;
  readonly abbreviation: string;
  readonly color: string;
  readonly alternate: string;
}

interface Game {
  readonly home: Team;
  readonly away: Team;
  readonly items: readonly Record<string, unknown>[];
}

interface Tile {
  readonly title: string;
  readonly game: Game;
  readonly state: BasketballTheaterState;
  readonly moment: LiveMoment | null;
  readonly rest?: Side | null;
}

/** ESPN lists the visitors first: the top team. */
const teamsOf = (g: Game): Teams => ({ topIsHome: false, topID: g.away.id, bottomID: g.home.id, topName: g.away.abbreviation, bottomName: g.home.abbreviation });

function tiles(games: readonly Game[]): Tile[] {
  const out: Tile[] = [];
  const add = (title: string, game: number, find: (s: BasketballScene) => boolean) => {
    const g = games[game];
    if (!g) return;
    const teams = teamsOf(g);
    for (let i = 0; i < g.items.length; i++) {
      const s = parseScene(g.items, i, teams);
      if (!s || !replays(s) || !find(s)) continue;
      // The lane's own moment for it, from the plays around it (a celebration needs one).
      const m = momentAt(i, g.items, teams, false, 0);
      out.push({ title, game: g, state: { scene: s, news: true }, moment: m ? { ...m, burst: true } : null });
      return;
    }
  };
  const id = (x: string) => (s: BasketballScene) => s.id === x;
  const move = (m: BasketballMove, kind?: BasketballScene["kind"]) => (s: BasketballScene) => s.move === m && (kind == null || s.kind === kind) && s.result === "make";
  add("Buzzer-beater", 0, id("401909877738"));
  add("Game-winner", 0, id("401909877843"));
  add("Posterized", 0, id("401909877673"));
  add("Steal and dunk", 0, id("40190987713"));
  add("Tip at the half", 2, id("401909879338"));
  add("Rejected", 2, id("40190987921"));
  add("And-one", 1, id("401909878474"));
  add("Alley-oop", 0, (s) => s.kind === "alleyOop" && s.dunk);
  add("Hook", 1, id("401909878444"));
  add("Step-back three", 0, move("stepBack", "three"));
  add("Floater", 1, move("floater"));
  add("Fadeaway", 2, move("fadeaway"));
  add("Driving layup", 1, (s) => s.kind === "layup" && s.move === "drive" && s.result === "make");
  add("Late miss", 0, id("401909877683"));
  const g = games[0];
  if (g) out.push({ title: "Between plays", game: g, state: { scene: null, news: false }, moment: null, rest: "top" });
  return out;
}

export function BasketballTheaterPreview() {
  const [params] = useSearchParams();
  const t = params.get("t");
  const frozen = t != null && t !== "" ? (t === "end" ? Infinity : Number(t)) : null;
  const only = params.get("only");
  const [data, setData] = useState<readonly Game[] | null>(null);
  useEffect(() => {
    let live = true;
    void files["../../../../../test/fixtures/nba-theater-plays.json"]?.().then((m) => {
      if (live) setData((m.default as { games: Game[] }).games);
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
        <strong style={{ fontWeight: 600 }}>{tile.title}</strong>
        <button type="button" onClick={() => setRun((n) => n + 1)} style={{ color: "var(--accent-text)" }}>
          Replay
        </button>
      </div>
      <PreviewStage key={run} tile={tile} frozen={frozen} />
      <p style={{ fontSize: "var(--text-caption)", color: "var(--label-secondary)" }}>{tile.state.scene?.text ?? `${tile.game.away.abbreviation} with the ball, set in its half`}</p>
    </section>
  );
}

/** One replay: its own moment slot, offered the play's moment once the theater is up (each replay is news again). */
function PreviewStage({ tile, frozen }: { tile: Tile; frozen: number | null }) {
  const scheme = useColorScheme();
  const slot = useMomentSlot();
  const { home, away } = tile.game;
  const palette = teamPalette(`#${away.color}`, `#${home.color}`, scheme);
  const kits = { top: { color: `#${away.color}`, alternate: `#${away.alternate}` }, bottom: { color: `#${home.color}`, alternate: `#${home.alternate}` } };
  useEffect(() => {
    // A tick later: development's StrictMode runs this twice, and the slot would take the second offer as already seen.
    const moment = tile.moment;
    if (!moment) return;
    const id = setTimeout(() => slot.offer([moment]), 0);
    return () => clearTimeout(id);
  }, [slot, tile.moment]);
  return (
    <MomentProvider slot={slot}>
      <BasketballTheater
        feed={null}
        teams={null}
        kits={kits}
        palette={palette}
        topIsHome={false}
        topName={away.abbreviation}
        bottomName={home.abbreviation}
        preloaded={tile.state}
        restOffense={tile.rest ?? null}
        frozen={frozen}
      />
    </MomentProvider>
  );
}
