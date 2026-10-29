/**
 * Development only: the ballpark theater between plays, frame by frame (the
 * Mac app's beat and umpire review harnesses, shot for shot, for comparing
 * side by side). World Series Game 5's timeline (ESPN's plays with MLB's
 * feed, as the tests read it): each pitch, throw over, visit, change, the
 * end of a half, a delay, at the moments that matter, with its tag and the
 * heartbeat; the umpire's calls on Game 5's strikeouts, Game 3's run at the
 * plate and Game 2's out there; the field at rest and its idle moves.
 * `/dev/theater?shots` draws them all; `?shots=03-foul` those whose name
 * starts so. `?live=120&every=4000` plays Game 5 as a live game from its
 * 120th item, one more each 4 s (ESPN's side only: no MLB feed), through the
 * stage as the page has it: the queue, a new play's replay cutting in, the
 * tags, the idle life. Fixtures load lazily from test/fixtures, so nothing
 * here ships.
 */
import { useEffect, useMemo, useState } from "react";
import type { ScoreEvent, Side } from "../../../../data/models";
import { batting, beatPitch, beatTag, captionText, mlbBeat, standing, timeline, type BeatPitch, type PlayBeat } from "../../../../data/mlb/playBeat";
import { beatScript, IDLE_BEATS, idleScript } from "../../../../data/mlb/playBeatScript";
import { parse, theater, type PlayScene, type SideOf } from "../../../../data/mlb/playScene";
import { PlayScript, type Rest } from "../../../../data/mlb/playScript";
import { statcastAtBats } from "../../../../data/mlb/statcast";
import { teamPalette } from "../../../../data/teamColors";
import { useColorScheme } from "../../../../state/theme";
import { MomentProvider, useMomentSlot } from "../../core/moments";
import { PlayTheater } from "./PlayTheater";

const files = import.meta.glob<{ default: unknown }>([
  "../../../../../test/fixtures/ws-g5-plays.json",
  "../../../../../test/fixtures/statcast-849799.json",
  "../../../../../test/fixtures/statcast-824468-delay.json",
  "../../../../../test/fixtures/mlb-ws-g3-plays.json",
  "../../../../../test/fixtures/mlb-ws-g2-summary-plays.json",
]);

async function load(name: string): Promise<unknown> {
  const f = files[`../../../../../test/fixtures/${name}`];
  if (!f) throw new Error(`No fixture ${name}`);
  return (await f()).default;
}

/** One frame: a beat's (or idle move's) script, or a play, at t, with its tag. */
interface Shot {
  readonly name: string;
  readonly t: number;
  readonly side: Side;
  readonly tag: string | null;
  readonly beat?: PlayBeat | null;
  readonly script?: PlayScript;
  readonly scene?: PlayScene;
  readonly bats?: "L" | "R" | null;
  readonly narrow?: boolean;
}

// The Mac harnesses' teams (Brewers away, Rays home), and a game that isn't MLB's, so nothing's fetched.
const kits = { top: { color: "12284b", alternate: "ffc52f" }, bottom: { color: "092c5c", alternate: "8fbce6" } };
const competitor = (id: string, name: string, abbreviation: string, color: string, alternate: string) => ({
  id,
  name,
  abbreviation,
  score: null,
  logo: null,
  isWinner: false,
  color,
  rank: null,
  record: null,
  conferenceRecord: null,
  alternateColor: alternate,
});
const EVENT = {
  id: "dev",
  content: { kind: "match", top: competitor("mlb-8", "Brewers", "MIL", "12284b", "ffc52f"), bottom: competitor("mlb-30", "Rays", "TB", "092c5c", "8fbce6") },
  state: "final",
  start: 0,
  ref: { kind: "espn", path: "baseball/dev", id: "dev", sport: "baseball" },
} as unknown as ScoreEvent;

type Plays = { items: unknown[]; names: Record<string, string> };

function shots(g5: Plays, mlb: unknown, rain: unknown, g3: Plays, g2: { plays: unknown[] }): Shot[] {
  const items = g5.items;
  const names = g5.names;
  const line = timeline(items, statcastAtBats(mlb), names);
  const out: Shot[] = [];
  const pitch = (b: PlayBeat): BeatPitch | null => beatPitch(b);
  const previous = (b: PlayBeat) => {
    const i = line.indexOf(b);
    return i > 0 ? line[i - 1]! : null;
  };
  const side = (b: PlayBeat): Side => batting(b) ?? "top";
  const rest = (b: PlayBeat): Rest => ({ bases: b.bases ?? [false, false, false], bats: b.bats ?? "R", swapped: false, fieldingHome: side(b) === "top" });
  const tagAt = (b: PlayBeat, s: PlayScript, t: number, wide: boolean) => {
    const c = s.captions.findLast((x) => x.at <= t);
    return (c ? captionText(b, c.line, wide) : null) ?? (previous(b) ? standing(previous(b)!) : null);
  };
  /** Frames of a beat at these moments (negative: from its end). */
  const frames = (name: string, b: PlayBeat | undefined, times: (s: PlayScript) => number[], r?: Rest, narrow = false) => {
    if (!b) return;
    const s = beatScript(b, r ?? rest(b));
    times(s).forEach((t0, i) => {
      const t = t0 < 0 ? s.duration + t0 : t0;
      out.push({ name: `${name}-${i + 1}`, t, side: side(b), tag: tagAt(b, s, t, !narrow), beat: b, script: s, narrow });
    });
  };
  const pop = (s: PlayScript) => s.captions[0]?.at ?? 1.3;
  const moments = (s: PlayScript) => {
    const release = s.release ?? 0.8;
    const contact = s.actors.find((a) => a.role.kind === "batter")?.swing ?? s.flashes.find((f) => f.beat === "contact")?.at ?? release + 0.42;
    return { release, contact, pop: pop(s) };
  };
  const pitches = line.filter((b) => pitch(b) != null);
  const firstPitch = (test: (p: BeatPitch, b: PlayBeat) => boolean) => pitches.find((b) => test(pitch(b)!, b));
  const at = (test: (p: BeatPitch, b: PlayBeat) => boolean, f: (m: ReturnType<typeof moments>, s: PlayScript) => number[]) => {
    const b = firstPitch(test);
    return [b, (s: PlayScript) => f(moments(s), s)] as const;
  };

  // The umpire's harness (wave22): a "u" before each name.
  frames("u01-called-strike", ...at((p) => p.call === "calledStrike" && p.review == null, (m) => [0.1, m.release, m.pop + 0.2, -0.2]));
  {
    const [b, f] = at((p) => p.call === "calledStrike" && p.review == null, (m) => [m.pop + 0.2]);
    frames("u01-called-strike-light-narrow", b, f, undefined, true);
  }
  frames("u02-swinging", ...at((p) => p.call === "swingingStrike", (m) => [m.pop + 0.25]));
  frames("u03-foul", ...at((p) => p.call === "foul", (m) => [m.contact + 0.45]));
  frames("u04-abs", ...at((p) => p.review?.overturned === true && p.call === "calledStrike", (m) => [m.pop + 0.2, m.pop + 1.35, m.pop + 2.6]));
  const sideOf: SideOf = (id) => (id === "8" ? "top" : id === "30" ? "bottom" : null);
  const replay = (name: string, plays: readonly unknown[], id: string, sideFn: SideOf, playNames: Record<string, string>, times: (s: PlayScript) => number[], bats: "R" | null = "R") => {
    const i = plays.findIndex((p) => (p as { id?: string }).id === id);
    const scene = i < 0 ? null : parse(plays, i, sideFn, playNames);
    if (!scene) return;
    const s = PlayScript.play(scene, { bases: scene.basesAfter, bats: "R", swapped: scene.endsInning });
    times(s).forEach((t, k) => out.push({ name: `${name}-${k + 1}`, t, side: "top", tag: null, scene, bats }));
  };
  const idOf = (p: unknown) => (p as { id?: string }).id!;
  const textOf = (p: unknown) => (p as { text?: string }).text ?? "";
  const typeOf = (p: unknown) => (p as { type?: { type?: string } }).type?.type;
  const looking = items.find((p) => typeOf(p) === "play-result" && textOf(p).includes("struck out looking"));
  if (looking)
    replay("u05-punch-out", items, idOf(looking), sideOf, names, (s) => {
      const p = s.flashes.find((f) => f.beat === "catchBall")?.at ?? 1;
      return [p + 0.12, p + 0.45];
    });
  replay("u06-safe-at-home", g3.items, "4019080440404990057", sideOf, g3.names, (s) => {
    const run = s.flashes.find((f) => f.beat === "run")?.at ?? 2;
    return [run - 0.3, run + 0.25];
  });
  replay("u07-out-at-home", g2.plays, "4019080431004990057", (id) => (id === "30" ? "top" : "bottom"), names, (s) => {
    const o = s.flashes.find((f) => f.beat === "out" && Math.hypot(f.point.x, f.point.y) < 3)?.at ?? 2;
    return [o - 0.25, o + 0.3];
  });
  const busy: Rest = { bases: [true, false, true], bats: "L", swapped: false };
  const between: Rest = { bases: [false, false, false], bats: null, swapped: false, fieldingHome: false };
  out.push({ name: "u08-rest", t: Infinity, side: "bottom", tag: "BOT 7TH · 1-2 · 2 OUTS", script: PlayScript.rest(busy), beat: null });
  const brush = idleScript("brush", between, 11n);
  [0.55, 1.3].forEach((t, k) => out.push({ name: `u09-brush-${k + 1}`, t, side: "bottom", tag: "MIDDLE 5TH", script: brush, beat: null }));

  // The beat harness (wave20).
  frames("01-called-strike", ...at((p, b) => p.call === "calledStrike" && b.bases?.includes(true) === true, (m) => [0.2, m.release - 0.08, m.release + 0.2, m.pop + 0.15, m.pop + 0.75, -0.3]));
  frames("02-swinging-strike", ...at((p) => p.call === "swingingStrike", (m) => [m.contact - 0.02, m.contact + 0.12, m.pop + 0.3, m.pop + 1.0]));
  pitches
    .filter((b) => pitch(b)?.call === "foul")
    .slice(0, 6)
    .forEach((b, k) => frames(`03-foul-${k + 1}`, b, (s) => [moments(s).contact + 0.05, moments(s).contact + 0.35, moments(s).contact + 0.7]));
  frames("04-foul-bunt", ...at((p) => p.call === "foulBunt", (m) => [m.release - 0.1, m.contact + 0.05, m.contact + 0.45]));
  frames("05-ball-in-dirt", ...at((p) => p.call === "ballInDirt", (m) => [m.pop - 0.02, m.pop + 0.5, m.pop + 1.1]));
  {
    const b = pitches.find((x) => pitch(x)?.call === "ball" && beatScript(x, rest(x)).actors.some((a) => a.check != null));
    frames("06-check-swing", b, (s) => [(s.actors.find((a) => a.check != null)?.check ?? 1.2) + 0.04, pop(s) + 0.2]);
  }
  frames("07-abs-challenge", ...at((p) => p.review != null, (m) => [m.pop + 0.3, m.pop + 1.5, m.pop + 2.7]));
  {
    const b = firstPitch((p) => p.call === "ball" && p.code === "ST") ?? firstPitch((p) => p.call === "ball");
    frames("08-ball-narrow-light", b, (s) => [moments(s).release + 0.2, moments(s).pop + 0.2], undefined, true);
  }
  const first = (test: (b: PlayBeat) => boolean) => line.find(test);
  frames("10-pickoff", first((b) => b.kind.kind === "pickoff"), () => [0.5, 0.95, 1.4, 2.6]);
  frames("11-step-off", first((b) => b.kind.kind === "stepOff"), () => [0.5, 1.1]);
  frames("12-visit-coach", first((b) => b.kind.kind === "moundVisit" && b.kind.coach), () => [0.8, 2.6, 4.4]);
  frames("13-visit-catcher", first((b) => b.kind.kind === "moundVisit" && !b.kind.coach), () => [2.6]);
  frames("14-pitching-change", first((b) => beatTag(b, true) === "PITCHING CHANGE · ROMERO"), () => [0.6, 1.9, 3.2, 4.6, -0.2]);
  frames("15-pinch-hitter", first((b) => b.kind.kind === "batterUp" && b.kind.pinch), () => [0.7]);
  frames("16-defensive-switch", first((b) => b.kind.kind === "substitution"), () => [0.4, 1.4, 2.4]);
  frames("17-inning-break", first((b) => b.kind.kind === "inningBreak"), () => [1.0, 3.3, 4.2], between);
  frames("18-injury", first((b) => b.kind.kind === "delay" && b.kind.delay.kind === "injury"), () => [1.0, -0.1]);
  frames("19-timeout", first((b) => b.kind.kind === "timeout"), () => [0.8, 1.3]);
  const third = items.find((p) => typeOf(p) === "play-result" && (p as { outs?: number }).outs === 3 && (p as { period?: { type?: string } }).period?.type === "Top");
  if (third)
    replay("20-sides-change", items, idOf(third), sideOf, names, (s) => [s.settle + 0.6, s.settle + 1.5, s.duration], null);
  const steal = items.find((p) => typeOf(p) === "play-result" && textOf(p).includes("stole second"));
  if (steal)
    replay("21-steal", items, idOf(steal), sideOf, names, (s) => {
      const throwing = s.flights[1]?.start ?? 1.2;
      return [throwing + 0.1, throwing + 0.3];
    });
  const rainAtBats = statcastAtBats(rain);
  const rainBeats = rainAtBats.flatMap((a) => (a.events ?? []).flatMap((e) => mlbBeat(e, a) ?? [])).filter((b) => b.kind.kind === "delay");
  const onFirst: Rest = { bases: [true, false, false], bats: "L", swapped: false };
  if (rainBeats[0]) {
    const s = beatScript(rainBeats[0], onFirst);
    [0.8, 2.2, s.duration].forEach((t, k) => out.push({ name: `22-rain-${k + 1}`, t, side: "top", tag: "RAIN DELAY", beat: null, script: s }));
    const over = rainBeats[rainBeats.length - 1]!;
    out.push({ name: "22-rain-4-resumes", t: 1.6, side: "top", tag: "PLAY RESUMES", beat: null, script: beatScript(over, onFirst) });
  }
  out.push({ name: "30-rest", t: Infinity, side: "bottom", tag: "BOT 7TH · 1-2 · 2 OUTS", script: PlayScript.rest(busy), beat: null });
  out.push({ name: "30-rest-narrow-light", t: Infinity, side: "bottom", tag: "BOT 7TH · 1-2 · 2 OUTS", script: PlayScript.rest(busy), beat: null, narrow: true });
  for (const kind of IDLE_BEATS) {
    if (kind === "trainer") continue;
    const field = ["warmup", "infield", "outfield", "brush"].includes(kind) ? between : busy;
    const s = idleScript(kind, field, 11n);
    const f = s.flights[0];
    const mid = f ? (f.start + f.end) / 2 : s.duration * 0.4;
    out.push({ name: `31-idle-${kind}`, t: mid, side: "bottom", tag: field.bats == null ? "MIDDLE 5TH" : "BOT 7TH · 1-2 · 2 OUTS", script: s, beat: null });
  }
  return out;
}

export function PlayBeatPreview({ only }: { only: string }) {
  const [list, setList] = useState<Shot[] | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.all(["ws-g5-plays.json", "statcast-849799.json", "statcast-824468-delay.json", "mlb-ws-g3-plays.json", "mlb-ws-g2-summary-plays.json"].map(load)).then(
      ([g5, mlb, rain, g3, g2]) => {
        if (live) setList(shots(g5 as Plays, mlb, rain, g3 as Plays, g2 as { plays: unknown[] }));
      },
    );
    return () => {
      live = false;
    };
  }, []);
  if (!list) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, padding: 16 }}>
      {list
        .filter((s) => !only || s.name.startsWith(only))
        .map((s) => (
          <ShotTile key={s.name} shot={s} />
        ))}
    </div>
  );
}

function ShotTile({ shot }: { shot: Shot }) {
  const scheme = useColorScheme();
  const slot = useMomentSlot();
  const palette = teamPalette(kits.top.color, kits.bottom.color, scheme);
  const [heard] = useState(() => Date.now() - 4_000);
  const state = shot.scene ? { play: shot.scene, news: true, bats: shot.bats ?? null } : { play: null, news: false, bats: null };
  return (
    <section data-shot={shot.name} style={{ width: shot.narrow ? 340 : 640 }}>
      <MomentProvider slot={slot}>
        <PlayTheater
          state={state}
          bases={null}
          batting={shot.side}
          palette={palette}
          kits={kits}
          event={EVENT}
          frozen={shot.t}
          heard={heard}
          live
          frozenBeat={shot.script ? { script: shot.script, beat: shot.beat ?? null, tag: shot.tag } : null}
        />
      </MomentProvider>
    </section>
  );
}

/** Game 5 delivered an item at a time, as a lane would: the stage's queue, replays and idle life, live. */
export function PlayLivePreview({ from, every }: { from: number; every: number }) {
  const [g5, setG5] = useState<Plays | null>(null);
  const [k, setK] = useState(from);
  const [heard, setHeard] = useState(() => Date.now());
  useEffect(() => {
    void load("ws-g5-plays.json").then((g) => setG5(g as Plays));
  }, []);
  useEffect(() => {
    if (!g5) return;
    const id = setInterval(() => {
      setK((n) => Math.min(n + 1, g5.items.length));
      setHeard(Date.now());
    }, every);
    return () => clearInterval(id);
  }, [g5, every]);
  const sideOf: SideOf = (id) => (id === "8" ? "top" : id === "30" ? "bottom" : null);
  const plays = useMemo(() => g5?.items.slice(0, k) ?? [], [g5, k]);
  const base = useMemo(() => (g5 ? theater(plays, sideOf, g5.names) : null), [plays, g5]);
  // News once it's arrived since the page opened (the lane's rule once primed).
  const [first, setFirst] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (base && first === undefined) setFirst(base.play?.id ?? null);
  }, [base, first]);
  const scheme = useColorScheme();
  const slot = useMomentSlot();
  if (!g5 || !base || first === undefined) return null;
  const state = { ...base, news: base.play != null && base.play.id !== first };
  const palette = teamPalette(kits.top.color, kits.bottom.color, scheme);
  const last = plays[plays.length - 1] as { text?: string } | undefined;
  return (
    <div style={{ padding: 16, width: 640 }}>
      <MomentProvider slot={slot}>
        <PlayTheater
          state={state}
          bases={state.play && !state.play.endsInning ? [...state.play.basesAfter] as [boolean, boolean, boolean] : [false, false, false]}
          batting={state.play?.batting ?? "top"}
          palette={palette}
          kits={kits}
          event={EVENT}
          plays={plays}
          playsVersion={k}
          names={g5.names}
          heard={heard}
          live
        />
      </MomentProvider>
      <p data-live-item={k} style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>
        {k}: {last?.text}
      </p>
    </div>
  );
}
