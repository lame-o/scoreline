/**
 * Development only: the play theater on real World Series plays, without a
 * live game (the Mac app's render harness, for the web). A home run (Game 2),
 * a triple (Game 3's double, stretched, as the Swift tests do), a 4-6-3
 * double play, a 6-3 and a strikeout looking (Game 3), each with a Replay
 * button and, with `frozen`, drawn at a fixed instant for screenshots.
 * As the football and soccer previews do, `?t=1.6` draws every tile at that
 * instant, frozen (`?t=end`: as it ended), and `?only=6-3` keeps the tiles
 * whose title starts so. Fixtures load lazily from test/fixtures, so nothing
 * here ships.
 *
 *     <PlayTheaterPreview />                 // replays on mount (or as `?t=` says)
 *     <PlayTheaterPreview frozen={1.6} />    // every tile at t = 1.6 s
 */
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import type { Competitor, ScoreEvent } from "../../../../data/models";
import { liveMoment, Tier, type LiveMoment } from "../../../../data/moments";
import { parse, theater, type PlayScene, type SideOf, type TheaterState } from "../../../../data/mlb/playScene";
import { teamPalette } from "../../../../data/teamColors";
import { useColorScheme } from "../../../../state/theme";
import { MomentProvider, useMomentSlot } from "../../core/moments";
import { PlayTheater } from "./PlayTheater";

const files = import.meta.glob<{ default: unknown }>("../../../../../test/fixtures/mlb-ws-g*-*.json");

async function load(name: string): Promise<unknown> {
  const f = files[`../../../../../test/fixtures/${name}`];
  if (!f) throw new Error(`No fixture ${name}`);
  return (await f()).default;
}

function team(id: string, name: string, abbreviation: string, color: string, alternate: string): Competitor {
  return { id: `mlb-${id}`, name, abbreviation, score: null, logo: null, isWinner: false, color, rank: null, record: null, conferenceRecord: null, alternateColor: alternate };
}

const brewers = team("8", "Brewers", "MIL", "13294b", "ffc52f");
const rays = team("30", "Rays", "TB", "092c5c", "8fbce6");

function game(id: string, start: string, top: Competitor, bottom: Competitor): ScoreEvent {
  return {
    id,
    content: { kind: "match", top, bottom },
    state: "final",
    start: Date.parse(start),
    ref: { kind: "espn", path: "baseball/mlb", id, sport: "baseball" },
  } as unknown as ScoreEvent;
}

const G3 = game("401908044", "2026-10-27T00:08:00Z", brewers, rays);
const G2 = game("401908043", "2026-10-25T00:08:00Z", rays, brewers);

interface Tile {
  readonly title: string;
  readonly state: TheaterState;
  readonly event: ScoreEvent;
  readonly moment: LiveMoment | null;
}

function tiles(g3: { items: unknown[]; names: Record<string, string> }, g2: { plays: unknown[] }): Tile[] {
  const side3: SideOf = (id) => (id === "8" ? "top" : id === "30" ? "bottom" : null);
  const side2: SideOf = (id) => (id === "30" ? "top" : id === "8" ? "bottom" : null);
  const upTo = (plays: unknown[], id: string, side: SideOf, names: Record<string, string> = {}) => {
    const i = plays.findIndex((p) => (p as { id?: string }).id === id);
    return { ...theater(plays.slice(0, i + 1), side, names), news: true };
  };
  const homer = upTo(g2.plays, "4019080430005990057", side2);
  const doubleIndex = g3.items.findIndex((p) => (p as { id?: string }).id === "4019080440811990057");
  const triple = parse(g3.items, doubleIndex, side3, g3.names) as PlayScene;
  triple.kind = { type: "triple" };
  triple.runners = triple.runners.map((r) => (r.from === 0 ? { id: r.id, from: 0, end: { kind: "base", base: 3 } } : r));
  const moment = (play: PlayScene | null, m: Omit<Parameters<typeof liveMoment>[0], "id" | "chart" | "detail">) =>
    play ? liveMoment({ ...m, id: play.id, chart: "plate", detail: play.text }) : null;
  return [
    { title: "Home run", state: homer, event: G2, moment: moment(homer.play, { tier: Tier.score, kind: "homeRun", lead: "Home run", side: "top" }) },
    {
      title: "Triple",
      state: { play: triple, news: true, bats: "R" },
      event: G3,
      moment: moment(triple, { tier: Tier.score, kind: "runScored", lead: "Run scores", side: "top", accents: ["triple"] }),
    },
    { title: "4-6-3 double play", state: upTo(g3.items, "4019080441102990057", side3, g3.names), event: G3, moment: null },
    { title: "6-3", state: upTo(g3.items, "4019080440005990057", side3, g3.names), event: G3, moment: null },
    { title: "Strikeout looking", state: upTo(g3.items, "4019080440902990057", side3, g3.names), event: G3, moment: null },
  ];
}

export function PlayTheaterPreview({ frozen: fixed = null }: { frozen?: number | null }) {
  const [params] = useSearchParams();
  const t = params.get("t");
  const frozen = fixed ?? (t != null && t !== "" ? (t === "end" ? Infinity : Number(t)) : null);
  const only = params.get("only");
  const [list, setList] = useState<Tile[] | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.all([load("mlb-ws-g3-plays.json"), load("mlb-ws-g2-summary-plays.json")]).then(([g3, g2]) => {
      if (live) setList(tiles(g3 as { items: unknown[]; names: Record<string, string> }, g2 as { plays: unknown[] }));
    });
    return () => {
      live = false;
    };
  }, []);
  if (!list) return null;
  return (
    <div style={{ display: "grid", gap: "calc(16 * var(--pt))", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, calc(320 * var(--pt))), 1fr))", padding: "var(--gutter)" }}>
      {list
        .filter((tile) => !only || tile.title.toLowerCase().startsWith(only.toLowerCase()))
        .map((tile) => (
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
  const content = tile.event.content;
  const top = content.kind === "match" ? content.top : null;
  const bottom = content.kind === "match" ? content.bottom : null;
  const palette = teamPalette(top?.color ?? null, bottom?.color ?? null, scheme);
  const kits = { top: { color: top?.color ?? null, alternate: top?.alternateColor ?? null }, bottom: { color: bottom?.color ?? null, alternate: bottom?.alternateColor ?? null } };
  useEffect(() => {
    if (tile.moment && frozen == null) slot.offer([tile.moment]);
  }, [slot, tile.moment, frozen]);
  return (
    <MomentProvider slot={slot}>
      <PlayTheater state={tile.state} bases={null} batting={tile.state.play?.batting ?? null} palette={palette} kits={kits} event={tile.event} frozen={frozen} />
    </MomentProvider>
  );
}
