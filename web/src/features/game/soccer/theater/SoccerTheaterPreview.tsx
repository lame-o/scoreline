/**
 * Development only: the soccer theater on real Premier League moments
 * (24–25 Oct 2026, test/fixtures/soccer-theater-plays.json, each clip ESPN's
 * core plays round a big moment), without a live match (the Mac app's
 * render harness, for the web): Gabriel's header after a nine-pass move,
 * Haaland's header from a free kick, McBurnie's penalty, Penders' own goal,
 * Cherki saved by Suzuki, Haaland blocked, Ndiaye off the post and
 * Gelhardt's big chance wide, Petrovic punching a corner before Cunha's
 * header, and Osula's goal struck off by VAR (its NO GOAL beat), each with
 * both elevens from the summary's lineups and a Replay button. `?t=4.2` draws
 * every tile at that instant, frozen, for screenshots (`?t=end`: as it
 * ended); `?only=Gabriel` keeps the tiles whose title starts so.
 *
 * `?sheet=sc-corner` draws the pitch between moments as the Mac's review
 * harness does, a sheet of frozen frames from the real entries of
 * soccer-events-plays.json (SoccerIdle.swift's events: sc-play, sc-corner,
 * sc-corner2, sc-offside, sc-card, sc-foul, sc-red, sc-second, sc-sub,
 * sc-injury, sc-varcheck, sc-vardecision, sc-halftime, sc-secondhalf,
 * sc-added, sc-save-left, sc-save-right, sc-miss, sc-turned, sc-flip), each
 * frame 440 wide and captioned with its time, for comparing the two side by
 * side; `?sheet=` alone lists them all, and `&live` runs each one on its
 * own clock instead. Fixtures load lazily from test/fixtures, so nothing here
 * ships.
 */
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import type { JSONValue } from "../../../../data/json";
import { actionMoment, pitchAction } from "../../../../data/liveFeeds/soccer";
import type { LiveMoment } from "../../../../data/moments";
import type { SoccerAddedTime } from "../../../../data/soccer";
import { parseEvent, parseTouch, type SoccerTouch } from "../../../../data/theater/soccerIdle";
import { isMoment, keepers, parse, SoccerLineup, type SoccerTheaterState } from "../../../../data/theater/soccerScene";
import { theaterFlipKey } from "../../core/theater/TheaterStatus";
import { MomentProvider, useMomentSlot } from "../../core/moments";
import SoccerTheater from "./SoccerTheater";

const files = import.meta.glob<{ default: unknown }>("../../../../../test/fixtures/{soccer-theater-plays,soccer-events-plays}.json");

interface Team {
  readonly id: string;
  readonly abbreviation: string;
  readonly color: string;
  readonly alternateColor: string;
}

interface Fixture {
  readonly matches: readonly { readonly home: Team; readonly away: Team; readonly clips: readonly (readonly JSONValue[])[]; readonly rosters?: JSONValue }[];
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
  ["Punch", "Matheus Cunha (Manchester United) header"],
  ["No goal", "William Osula (Newcastle United)"],
];

function tiles(fixture: Fixture): Tile[] {
  const out: Tile[] = [];
  for (const [title, clue] of CLUES) {
    found: for (const match of fixture.matches) {
      for (const clip of match.clips) {
        const i = clip.findIndex((p) => isMoment(p) && String((p as { text?: string }).text ?? "").includes(clue));
        if (i < 0) continue;
        const parsed = parse(clip, i, match.home.id, keepers(clip));
        if (!parsed) continue;
        // Struck off by VAR: its NO GOAL beat.
        const scene = title === "No goal" ? { ...parsed, review: "overturned" as const } : parsed;
        const action = pitchAction(clip[i], 0, match.home.id);
        const m = action ? actionMoment(action) : null;
        const lineups = SoccerLineup.lineups(match.rosters ?? [], (team) => (team === match.home.id ? "top" : "bottom"));
        out.push({ title, state: { scene, news: true, lineups }, moment: m ? { ...m, burst: true } : null, home: match.home, away: match.away });
        break found;
      }
    }
  }
  return out;
}

export function SoccerTheaterPreview() {
  const [params] = useSearchParams();
  if (params.get("sheet") != null) return <IdleSheets only={params.get("sheet") || null} live={params.get("live") != null} />;
  return <Tiles />;
}

function Tiles() {
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

// MARK: - The Mac harness's sheets (the pitch between moments)

interface EventsTeam {
  readonly id: string;
  readonly abbreviation: string;
  readonly name: string;
  readonly color: string;
  readonly alternateColor: string;
}

interface EventsFixture {
  readonly matches: readonly { readonly home: EventsTeam; readonly away: EventsTeam; readonly clips: readonly (readonly JSONValue[])[]; readonly rosters: JSONValue }[];
}

interface SheetCase {
  readonly state: SoccerTheaterState;
  readonly times: readonly number[];
  readonly home: EventsTeam;
  readonly away: EventsTeam;
  readonly eventId: string;
  readonly flipped: boolean;
  readonly added: SoccerAddedTime | null;
}

const SHEETS = ["sc-play", "sc-corner", "sc-corner2", "sc-offside", "sc-card", "sc-foul", "sc-red", "sc-second", "sc-sub", "sc-injury", "sc-varcheck", "sc-vardecision", "sc-halftime", "sc-secondhalf", "sc-added", "sc-save-left", "sc-save-right", "sc-miss", "sc-turned", "sc-flip"];
const WORDLESS = new Set(["halftime", "start-2nd-half", "kickoff", "end-regular-time"]);
const typeOf = (p: JSONValue) => String((p as { type?: { type?: string } }).type?.type ?? "");
const clockOf = (p: JSONValue) => String((p as { clock?: { displayValue?: string } }).clock?.displayValue ?? "");
const textOf = (p: JSONValue) => String((p as { text?: string }).text ?? "");

/** The harness's cases (field-harness/main.swift `soccerCase`), from the same entries. */
function sheetCase(key: string, fixture: EventsFixture): SheetCase | null {
  const lineupsOf = (m: EventsFixture["matches"][number]) => SoccerLineup.lineups(m.rosters, (team) => (team === m.home.id ? "top" : "bottom"));
  /** The event of this type at this minute, in its match's clips, as the theater would have it. */
  const event = (match: number, type: string, minute: string, times: number[]): SheetCase | null => {
    const m = fixture.matches[match];
    if (!m) return null;
    for (const clip of m.clips) {
      const i = clip.findIndex((p) => typeOf(p) === type && clockOf(p) === minute && (textOf(p) !== "" || WORDLESS.has(type)));
      if (i < 0) continue;
      const e = parseEvent(clip, i, m.home.id, 1000 + i);
      if (!e) return null;
      let touch: SoccerTouch | null = null;
      for (let k = i - 1; k >= 0 && !touch; k--) touch = parseTouch(clip[k], m.home.id, 900);
      const state: SoccerTheaterState = { scene: null, news: false, lineups: lineupsOf(m), events: [e], newsFrom: e.order, touch, period: e.period, heard: Date.now() - 6000 };
      return { state, times, home: m.home, away: m.away, eventId: `sheet-${key}`, flipped: false, added: null };
    }
    return null;
  };
  const moment = (match: number, clue: string, times: number[]): SheetCase | null => {
    const m = fixture.matches[match];
    if (!m) return null;
    for (const clip of m.clips) {
      const i = clip.findIndex((p) => isMoment(p) && textOf(p).includes(clue));
      const scene = i >= 0 ? parse(clip, i, m.home.id, keepers(clip)) : null;
      if (!scene) continue;
      return { state: { scene, news: true, lineups: lineupsOf(m), period: scene.period ?? null }, times, home: m.home, away: m.away, eventId: `sheet-${key}`, flipped: false, added: null };
    }
    return null;
  };
  const quiet = (c: SheetCase | null): SheetCase | null => (c ? { ...c, state: { ...c.state, events: [], newsFrom: null } } : null);
  switch (key) {
    case "sc-play":
      return quiet(event(0, "corner-awarded", "4'", [0.2, 1.4, 2.0, 3.4, 6, 8, 12, 20]));
    case "sc-corner":
      return event(0, "corner-awarded", "4'", [0.2, 1.6, 3.4, 5, 8, 12.4]);
    case "sc-corner2":
      return event(0, "corner-awarded", "9'", [3.6, 12]);
    case "sc-offside":
      return event(0, "offside", "27'", [0.3, 1.8, 4, 7, 12]);
    case "sc-card":
      return event(0, "yellow-card", "32'", [0.3, 1.6, 2.6, 4, 6]);
    case "sc-foul":
      // The foul just before the booking.
      return event(0, "foul", "32'", [0.2, 0.9, 2.5, 4.6, 7, 11]);
    case "sc-red":
      return event(3, "red-card", "79'", [0.3, 2.6, 6, 9]);
    case "sc-second":
      return event(3, "red-card", "89'", [2.6, 8]);
    case "sc-sub":
      return event(1, "substitution", "52'", [0.3, 2, 4, 6, 8, 11]);
    case "sc-injury":
      return event(1, "start-delay", "19'", [0.3, 2, 4, 8, 14]);
    case "sc-varcheck":
      return event(3, "start-delay", "78'", [1, 4]);
    case "sc-vardecision":
      return event(3, "var---referee-decision-cancelled", "78'", [3, 5]);
    case "sc-halftime":
      return event(0, "halftime", "45'+2'", [0.3, 3, 6, 11]);
    case "sc-secondhalf":
      return event(0, "start-2nd-half", "45'", [0.5, 5]);
    case "sc-added": {
      const c = quiet(event(0, "corner-awarded", "4'", [2, 12]));
      const touch = c?.state.touch;
      return c && { ...c, state: { ...c.state, period: 2, touch: touch ? { ...touch, period: 2, clock: 5420 } : null }, added: { minutes: 4, half: 2 } };
    }
    case "sc-save-left":
      return moment(0, "Iliman Ndiaye (Manchester City) left footed shot from the right side of the box is saved", [0, 1.2, 2.2, 3.0, 5, 9]);
    case "sc-save-right":
      return moment(0, "Erling Haaland (Manchester City) header from the centre of the box is saved", [0, 1.2, 2.2, 3.0, 5, 9]);
    case "sc-miss":
      return moment(0, "high and wide to the left", [0, 1.5, 3, 6]);
    case "sc-turned":
      // A second-half moment: the ends changed at half time.
      return moment(0, "Josko Gvardiol (Manchester City) left footed shot from the left side of the box is saved", [0, 2, 4, 8]);
    case "sc-flip": {
      const c = event(0, "corner-awarded", "4'", [6]);
      return c && { ...c, state: { ...c.state, heard: Date.now() - 3000 }, flipped: true };
    }
    default:
      return null;
  }
}

/** The sheets, each a column pair of frozen frames captioned with their times (the harness's 440 by 220, at 1x). */
function IdleSheets({ only, live }: { only: string | null; live: boolean }) {
  const [data, setData] = useState<EventsFixture | null>(null);
  useEffect(() => {
    let live = true;
    void files["../../../../../test/fixtures/soccer-events-plays.json"]?.().then((m) => {
      if (live) setData(m.default as EventsFixture);
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
        const c = sheetCase(key, data);
        if (!c) return null;
        // The flip sheet: as the pitch faces by default, and turned round by the viewer.
        const variants = key === "sc-flip" ? [{ ...c, flipped: false, eventId: `${c.eventId}-default` }, c] : [c];
        return (
          <section key={key} data-sheet={key} style={{ display: "grid", gridTemplateColumns: "repeat(2, 440px)", gap: 10, padding: 12, width: "max-content", background: "var(--background)" }}>
            {variants.flatMap((v) =>
              (live ? v.times.slice(0, 1) : v.times).map((t) => (
                <div key={`${v.eventId}-${t}`} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: "var(--label-secondary)" }}>
                    {key === "sc-flip" ? (v.flipped ? "pitch, turned" : "pitch, as default (1st half: Villa attacks right)") : `t = ${t.toFixed(1)}`}
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
  // The viewer's turn of the pitch, as the harness sets it, before the theater reads it.
  useState(() => {
    try {
      if (c.flipped) window.localStorage.setItem(theaterFlipKey(c.eventId), "1");
      else window.localStorage.removeItem(theaterFlipKey(c.eventId));
    } catch {
      // No storage: as it faces by default.
    }
    return null;
  });
  const kits = { top: { color: c.home.color, alternate: c.home.alternateColor }, bottom: { color: c.away.color, alternate: c.away.alternateColor } };
  return (
    <div style={{ width: 440 }} data-flip={c.eventId === "sheet-sc-flip" ? "shown" : undefined}>
      <SoccerTheater feed={null} homeTeamID={c.home.id} kits={kits} eventId={c.eventId} topTeam={c.home.name} bottomTeam={c.away.name} added={c.added} preloaded={c.state} frozen={t} />
    </div>
  );
}
