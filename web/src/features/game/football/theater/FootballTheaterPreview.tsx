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
 *
 * `?sheet=fb-timeout` draws the field between snaps as the Mac's review
 * harness does, a sheet of frozen frames from the real entries
 * (FootballIdle.swift's moments: fb-between, fb-timeout, fb-commercial,
 * fb-twominute, fb-quarter, fb-halftime, fb-injury, fb-review, fb-reversed,
 * fb-kickoff, fb-flip, fb-flag), each frame 440 wide and captioned with its
 * time, for comparing the two side by side; `?sheet=` alone lists them all,
 * and `&live` runs each one on its own clock instead (its beats, the power
 * they take).
 * Fixtures load lazily from test/fixtures, so nothing here ships.
 */
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { ordinal } from "../../../../data/format";
import type { Football } from "../../../../data/gameDetail";
import type { FootballTeams } from "../../../../data/liveFeeds/football";
import type { Side } from "../../../../data/models";
import { liveMoment, Tier, type Accent, type LiveMoment, type MomentKind } from "../../../../data/moments";
import { teamPalette } from "../../../../data/teamColors";
import { parseStoppage, type FootballStoppage } from "../../../../data/theater/footballIdle";
import { FootballDepthChart, parse, type FootballScene, type FootballTheaterState } from "../../../../data/theater/footballScene";
import { FootballScript } from "../../../../data/theater/footballScript";
import { spot } from "../../../../data/theater/footballTheater";
import { useColorScheme } from "../../../../state/theme";
import { MomentProvider, useMomentSlot } from "../../core/moments";
import { theaterFlipKey } from "../../core/theater/TheaterStatus";
import FootballTheater from "./FootballTheater";

const files = import.meta.glob<{ default: unknown }>("../../../../../test/fixtures/{mnf-dal-phi-plays,nfl-turnovers-plays,nfl-depthcharts,nfl-stoppages-plays}.json");
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
  if (params.get("sheet") != null) return <IdleSheets only={params.get("sheet") || null} live={params.get("live") != null} />;
  return <Tiles />;
}

function Tiles() {
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

// MARK: - The Mac harness's sheets (the field between snaps)

/** A team as the sheets dress it: its letters, its name for the tag, its colors. */
type SheetTeam = readonly [abbreviation: string, name: string, color: string, alternate: string];

interface SheetCase {
  readonly state: FootballTheaterState;
  readonly situation: Football;
  readonly times: readonly number[];
  readonly eventId: string;
  readonly flipped: boolean;
  readonly top: SheetTeam;
  readonly bottom: SheetTeam;
}

interface Stoppages {
  readonly games: readonly { readonly home: { id: string; abbreviation: string; name: string }; readonly away: { id: string; abbreviation: string; name: string }; readonly items: readonly Record<string, unknown>[] }[];
}

const DAL: SheetTeam = ["DAL", "Cowboys", "002a5c", "b0b7bc"];
const PHI: SheetTeam = ["PHI", "Eagles", "06424d", "000000"];
const SHEETS = ["fb-between", "fb-timeout", "fb-commercial", "fb-twominute", "fb-quarter", "fb-halftime", "fb-injury", "fb-review", "fb-reversed", "fb-kickoff", "fb-flip", "fb-flag"];

/** The live situation the harness gives after a snap: the spot it left, ten to go, and each side's timeouts (2 and 1). */
function situationAfter(offense: Side, yard: number, gain: number | null, downDistance: string | null): Football {
  const x = (y: number) => (offense === "top" ? y : 100 - y);
  return { downDistance, ballX: x(yard), lineToGainX: gain != null ? x(gain) : null, possession: offense, redZone: false, topTimeouts: 2, bottomTimeouts: 1, lastPlay: null };
}

/** The harness's cases (field-harness/main.swift `footballCase`), from the same entries. */
function sheetCase(key: string, mnf: Fixture, stops: Stoppages | null): SheetCase | null {
  const item = (suffix: string) => mnf.items.find((i) => String(i.id).endsWith(suffix)) ?? null;
  const scene = (suffix: string) => {
    const i = item(suffix);
    return i ? parse(i, TEAMS) : null;
  };
  const snapBefore = (items: readonly Record<string, unknown>[], id: string, teams: FootballTeams) => {
    const i = items.findIndex((x) => String(x.id) === id);
    for (let k = i - 1; k >= 0; k--) {
      const s = parse(items[k], teams);
      if (s) return s;
    }
    return null;
  };
  const idle = (play: FootballScene | null, stoppage: FootballStoppage | null, times: number[], situation: string | null = null): SheetCase | null => {
    if (!play) return null;
    const offense: Side = play.flips ? (play.offense === "top" ? "bottom" : "top") : (play.offense ?? "top");
    const yard = play.flips ? 100 - play.to : play.to;
    const gain = Math.min(yard + 10, 100) < 100 ? yard + 10 : null;
    const text = situation ?? (play.after ? `${ordinal(play.after.down)} & ${play.after.distance} at X` : null);
    return { state: { play, news: false, stoppage, heard: Date.now() - 4000 }, situation: situationAfter(offense, yard, gain, text), times, eventId: `sheet-${key}`, flipped: false, top: DAL, bottom: PHI };
  };
  const stop = (suffix: string) => {
    const i = item(suffix);
    return i ? parseStoppage(i, TEAMS) : null;
  };
  const before = (suffix: string) => {
    const i = item(suffix);
    return i ? snapBefore(mnf.items, String(i.id), TEAMS) : null;
  };
  const stopped = (g: Stoppages["games"][number], clue: string, home: string, away: string) => {
    const teams: FootballTeams = { topIsHome: false, topID: g.away.id, bottomID: g.home.id, homeAbbreviation: home, awayAbbreviation: away, homeName: g.home.name, awayName: g.away.name };
    const i = g.items.find((x) => String(x.text ?? "").includes(clue));
    return i ? parse(i, teams) : null;
  };
  switch (key) {
    case "fb-between":
      return idle(scene("9274"), null, [0.2, 1.4, 5, 8.0, 9.4, 13, 16.4, 23.4, 28.4, 30.0]);
    case "fb-timeout":
      return idle(before("1100"), stop("1100"), [0.5, 2.5, 6, 20, 34, 39, 44]);
    case "fb-commercial":
      return idle(before("1824"), stop("1824"), [1, 4, 12, 30]);
    case "fb-twominute":
      return idle(before("1850"), stop("1850"), [2, 10]);
    case "fb-quarter":
      return idle(before("1042"), stop("1042"), [0.4, 1.6, 2.6, 3.4, 4.4, 8, 11, 14]);
    case "fb-halftime":
      return idle(before("2292"), stop("2292"), [0.5, 2, 3.5, 6]);
    case "fb-injury": {
      const hurt = mnf.items.find((x) => String(x.text ?? "").includes("Q.Mitchell was injured"));
      return idle(hurt ? parse(hurt, TEAMS) : null, null, [0.4, 2, 4, 8, 20, 27, 31, 40]);
    }
    case "fb-review": {
      const g = stops?.games[0];
      const c = g ? idle(stopped(g, "Atlanta challenged", "ATL", "SF"), null, [0.4, 1.1, 1.6, 4, 9, 17, 22]) : null;
      return c && { ...c, top: ["SF", "49ers", "aa0000", "b3995d"], bottom: ["ATL", "Falcons", "a71930", "000000"] };
    }
    case "fb-reversed": {
      const g = stops?.games[1];
      const c = g ? idle(stopped(g, "Rams challenged", "LV", "LAR"), null, [1.6, 9, 17]) : null;
      return c && { ...c, top: ["LAR", "Rams", "003594", "ffd100"], bottom: ["LV", "Raiders", "000000", "a5acaf"] };
    }
    case "fb-kickoff":
      return idle(scene("1152"), null, [0.3, 1.5, 3.2, 12, 19], "Kickoff");
    case "fb-flip": {
      const c = idle(scene("9274"), null, [12]);
      return c && { ...c, flipped: true };
    }
    case "fb-flag": {
      const play = scene("3169");
      if (!play) return null;
      const spotted = play.clone();
      spotted.hash = "left";
      const script = FootballScript.play(spotted);
      const lands = script.flags[0]?.lands ?? 1;
      const offense = play.offense ?? "top";
      return { state: { play: spotted, news: true, queue: [spotted] }, situation: { ...situationAfter(offense, 25, 35, null), possession: offense }, times: [0.3, lands - 0.2, lands + 0.4, script.settle + 0.5], eventId: "sheet-fb-flag", flipped: false, top: DAL, bottom: PHI };
    }
    default:
      return null;
  }
}

/** The sheets, each a column pair of frozen frames captioned with their times (the harness's 440 by 220, at 1x). */
function IdleSheets({ only, live }: { only: string | null; live: boolean }) {
  const [data, setData] = useState<{ mnf: Fixture; stops: Stoppages | null } | null>(null);
  useEffect(() => {
    let live = true;
    const load = (name: string) => files[fixturePath(name)]?.().then((m) => m.default) ?? Promise.resolve(null);
    void Promise.all([load("mnf-dal-phi-plays"), load("nfl-stoppages-plays")]).then(([mnf, stops]) => {
      if (live && mnf) setData({ mnf: mnf as Fixture, stops: stops as Stoppages | null });
    });
    return () => {
      live = false;
    };
  }, []);
  if (!data) return null;
  const keys = only ? only.split(",") : SHEETS;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, padding: 12 }}>
      {keys.map((key) => {
        const c = sheetCase(key, data.mnf, data.stops);
        if (!c) return null;
        // The flip sheet: as the field faces by default, and turned round by the viewer.
        const variants = key === "fb-flip" ? [{ ...c, flipped: false, eventId: `${c.eventId}-default` }, c] : [c];
        return (
          <section key={key} data-sheet={key} style={{ display: "grid", gridTemplateColumns: "repeat(2, 440px)", gap: 10, padding: 12, width: "max-content", background: "var(--background)" }}>
            {variants.flatMap((v) =>
              (live ? v.times.slice(0, 1) : v.times).map((t) => (
                <div key={`${v.eventId}-${t}`} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: "var(--label-secondary)" }}>
                    {key === "fb-flip" ? (v.flipped ? "field, turned" : "field, as default (Q1: DAL attacks right)") : `t = ${t.toFixed(1)}`}
                  </span>
                  <SheetFrame c={v} t={live ? null : t} />
                </div>
              )),
            )}
          </section>
        );
      })}
    </div>
  );
}

function SheetFrame({ c, t }: { c: SheetCase; t: number | null }) {
  const scheme = useColorScheme();
  // The viewer's turn of the field, as the harness sets it, before the theater reads it.
  useState(() => {
    try {
      if (c.flipped) window.localStorage.setItem(theaterFlipKey(c.eventId), "1");
      else window.localStorage.removeItem(theaterFlipKey(c.eventId));
    } catch {
      // No storage: as it faces by default.
    }
    return null;
  });
  const palette = teamPalette(c.top[2], c.bottom[2], scheme);
  const kits = { top: { color: c.top[2], alternate: c.top[3] }, bottom: { color: c.bottom[2], alternate: c.bottom[3] } };
  return (
    <div style={{ width: 440 }} data-flip={c.eventId === "sheet-fb-flip" ? "shown" : undefined}>
      <FootballTheater
        feed={null}
        teams={null}
        situation={c.situation}
        kits={kits}
        palette={palette}
        topName={c.top[0]}
        bottomName={c.bottom[0]}
        eventId={c.eventId}
        topTeam={c.top[1]}
        bottomTeam={c.bottom[1]}
        preloaded={c.state}
        frozen={t}
      />
    </div>
  );
}
