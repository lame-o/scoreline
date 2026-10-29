/**
 * The names over the pitch (TheaterNamesTests.swift § Soccer): who each
 * figure is and who the moment is about, on the Swift app's fixtures (Aston
 * Villa v Man City's clips in soccer-theater-plays.json, its rosters with
 * City's changes in names-soccer-401879256-rosters.json): the changes by the
 * minute they were made, a substitute in the place of the man he came on
 * for, all twenty-two named, the scorer the key man, the referee nobody;
 * between moments, the man booked.
 */
import { describe, expect, it } from "vitest";
import type { JSONValue } from "../../src/data/json";
import { soccerIdle, soccerIdleScript, type SoccerEvent } from "../../src/data/theater/soccerIdle";
import { isMoment, keepers, lineupsOn, parse, SoccerLineup, type SoccerScene } from "../../src/data/theater/soccerScene";
import { SoccerScript } from "../../src/data/theater/soccerScript";
import { idleKeyMan, soccerCast, tagPosition } from "../../src/data/theater/soccerTheater";
import { personOf, TheaterPeople, type TheaterCast, type TheaterPerson } from "../../src/data/theater/theaterNames";
import { fixture } from "./fixtures";

const data = fixture("soccer-theater-plays.json") as { matches: { home: { id: string }; clips: JSONValue[][] }[] };
const match = data.matches[0]!;
const home = match.home.id;
const rosters = fixture("names-soccer-401879256-rosters.json") as { rosters: JSONValue };
const lineups = SoccerLineup.lineups(rosters.rosters, (team) => (team === home ? "top" : "bottom"));
const city = lineups.bottom!;
const people = TheaterPeople.rosters(rosters);

const tag = (p: TheaterPerson | null) => (p ? `${p.number ?? "-"} ${p.last} ${p.position ?? "-"}` : "none");
const person = (cast: TheaterCast, i: number | null) => (i == null ? null : personOf(cast.members.get(i)?.who));
const textOf = (p: JSONValue) => String((p as { text?: unknown }).text ?? "");

/** Haaland's header (52'): the last clip with one, as the Mac's test finds it. */
function haaland(): SoccerScene | null {
  let scene: SoccerScene | null = null;
  for (const clip of match.clips) {
    const i = clip.findIndex((p) => isMoment(p) && textOf(p).includes("Erling Haaland (Manchester City) header"));
    if (i >= 0) scene = parse(clip, i, home, keepers(clip));
  }
  return scene;
}

describe("a squad's changes", () => {
  it("reads Man City's from the rosters: Foden and Lewis at the half, McAidoo at 69'", () => {
    expect(city.subs).toHaveLength(3);
    expect(["250787", "325564"]).toContain(city.subs[0]!.athlete);
    expect(city.subs.at(-1)!.at).toBe(69 * 60);
  });

  it("puts the eleven on at a minute: Guéhi at 30', Lewis in his place at 52' (Ndiaye still on); now, McAidoo for Ndiaye", () => {
    const on = (clock: number | null, athlete: string) => city.on(clock).players.some((p) => p.athlete === athlete);
    expect(on(30 * 60, "265907")).toBe(true);
    expect(on(30 * 60, "325564")).toBe(false);
    expect(on(52 * 60, "325564")).toBe(true);
    expect(on(52 * 60, "265907")).toBe(false);
    expect(on(52 * 60, "268641")).toBe(true);
    expect(on(null, "395463")).toBe(true);
    expect(on(null, "268641")).toBe(false);
  });

  it("gives a substitute the place in the shape of the man he came on for, and the same lineups for the same changes", () => {
    expect(city.on(52 * 60).players.find((p) => p.athlete === "325564")?.place).toBe(city.players.find((p) => p.athlete === "265907")?.place);
    expect(city.on(52 * 60)).toBe(city.on(55 * 60));
    expect(city.on(10 * 60)).toBe(city);
    expect(lineupsOn(lineups, 52 * 60)).toBe(lineupsOn(lineups, 58 * 60));
    expect(lineupsOn(lineups, 52 * 60)).not.toBe(lineupsOn(lineups, 60 * 60));
    expect(lineupsOn(lineups, 10 * 60)).toBe(lineups);
  });

  it("reads a minute as the clock: 66' and 90'+3'", () => {
    expect(SoccerLineup.clock("66'")).toBe(66 * 60);
    expect(SoccerLineup.clock("90'+3'")).toBe(93 * 60);
    expect(SoccerLineup.clock(null)).toBeNull();
  });
});

describe("who's who on the pitch", () => {
  const scene = haaland();

  it("makes Haaland's header about the scorer: 9 HAALAND ST", () => {
    expect(scene).not.toBeNull();
    const script = SoccerScript.build(scene!, lineups);
    const cast = soccerCast(script, scene!.side, lineupsOn(lineups, scene!.clock), people, scene!.shooterCredit?.athlete ?? null, scene!.id);
    expect(tag(person(cast, cast.key(4.6)))).toBe("9 Haaland ST");
  });

  it("names all twenty-two with the half-time changes made: Lewis at centre-back for Guéhi, Foden behind the striker for Cherki; the referee nobody", () => {
    const script = SoccerScript.build(scene!, lineups);
    const cast = soccerCast(script, scene!.side, lineupsOn(lineups, scene!.clock), people, scene!.shooterCredit?.athlete ?? null, scene!.id);
    const named = [...cast.members.values()].flatMap((m) => personOf(m.who) ?? []);
    const tags = named.map(tag);
    expect(named).toHaveLength(22);
    expect(tags).toContain("1 Suzuki GK");
    expect(tags).toContain("82 Lewis CB");
    expect(tags).toContain("47 Foden AM");
    expect(named.some((p) => p.last === "Guéhi" || p.last === "Cherki")).toBe(false);
    const officials = script.actors.flatMap((a, i) => (a.team === "official" ? [i] : []));
    expect(officials.every((i) => !cast.members.has(i))).toBe(true);
  });

  it("between moments: a booking is about the man booked (3 DIAS CB); the ball going round, nobody", () => {
    const booked: SoccerEvent = {
      id: "x",
      kind: { type: "card", red: false, second: false },
      side: "bottom",
      player: "Rúben Dias",
      athlete: "234878",
      other: null,
      otherAthlete: null,
      at: null,
      penalty: false,
      minute: "",
      clock: 0,
      period: 2,
      text: "",
      wallclock: null,
      order: 0,
    };
    const idle = soccerIdle({ event: booked, touch: null, scene: null, period: 2, lineups, flipped: false });
    const rest = soccerIdleScript(idle);
    const cast = soccerCast(rest, idle.possession, idle.lineups, people, idleKeyMan(idle), "idle");
    expect(tag(person(cast, cast.key(1)))).toBe("3 Dias CB");
    expect(idleKeyMan(soccerIdle({ event: null, touch: null, scene: null, period: 1, lineups, flipped: false }))).toBeNull();
  });

  it("calls a man only the plain 4-4-2 knows by his team, never a name", () => {
    const idle = soccerIdle({ event: null, touch: null, scene: null, period: 1, lineups: {}, flipped: false });
    const cast = soccerCast(soccerIdleScript(idle), idle.possession, idle.lineups, {}, null, "idle");
    expect([...cast.members.values()].every((m) => m.who.kind === "team")).toBe(true);
    expect(cast.members.size).toBe(22);
  });

  it("says a lineup place as a tag does: G, CD-L, AM-R, F as GK, CB, AM, ST; a substitute's nothing", () => {
    expect(["G", "CD-L", "AM-R", "F", "CF-L", "DM", "LWB", "SUB"].map(tagPosition)).toEqual(["GK", "CB", "AM", "ST", "ST", "DM", "LWB", null]);
  });
});
