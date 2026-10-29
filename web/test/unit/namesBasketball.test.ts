/**
 * The names over the court (TheaterNamesTests.swift § Basketball), on SA at
 * UTAH (nba-every-play-401909890.json) and its box score
 * (names-nba-401909890-boxscore.json): only the men ESPN credits are named,
 * each on the figure the play gives him, by the box score's number and
 * position; everyone else his team's; and who each play is about, per play
 * type.
 */
import { describe, expect, it } from "vitest";
import type { Teams } from "../../src/data/liveFeeds/basketball";
import { beatScript, type HoopsEnds } from "../../src/data/theater/basketballBeats";
import { parseScene } from "../../src/data/theater/basketballScene";
import { BasketballScript } from "../../src/data/theater/basketballScript";
import { basketballCast, basketballKey } from "../../src/data/theater/basketballTheater";
import { personOf, TheaterPeople, type TheaterCast, type TheaterPerson } from "../../src/data/theater/theaterNames";
import { fixture } from "./fixtures";

type Item = Record<string, unknown>;
const game = (fixture("nba-every-play-401909890.json") as { games: { items: Item[]; home: { id: string }; away: { id: string } }[] }).games[0]!;
const items = game.items;
const teams: Teams = { topIsHome: false, topID: game.away.id, bottomID: game.home.id, topName: "SA", bottomName: "UTAH" };
const scene = (id: string) => {
  const i = items.findIndex((item) => item.id === id);
  return i < 0 ? null : parseScene(items, i, teams);
};
const people = TheaterPeople.boxscore(fixture("names-nba-401909890-boxscore.json"));
const flat: HoopsEnds = { topRight: true, topOpensRight: true };

const person = (cast: TheaterCast, i: number | null) => (i == null ? null : personOf(cast.members.get(i)?.who));
const tag = (p: TheaterPerson | null) => (p ? `${p.number ?? "-"} ${p.last} ${p.position ?? "-"}` : "none");
const named = (cast: TheaterCast) => [...cast.members.values()].flatMap((m) => personOf(m.who) ?? []);

describe("the names over the court", () => {
  it("names Wembanyama's three's shooter and Castle for the assist, nobody else; the other eight their team's", () => {
    const three = scene("40190989026")!;
    const script = BasketballScript.play(three);
    const cast = basketballCast(script, three, people, three.id);
    expect(tag(person(cast, script.shooter))).toBe("1 Wembanyama F");
    expect(named(cast)).toHaveLength(2);
    expect(named(cast).some((p) => p.last === "Castle" && p.number === "5")).toBe(true);
    expect([...cast.members.values()].filter((m) => m.who.kind === "team")).toHaveLength(8);
    expect(cast.key(1.2)).toBe(script.shooter);
    expect([...cast.members.values()].filter((m) => m.side === "top")).toHaveLength(5);
  });

  it("makes a block about the blocker: Bailey over Castle's layup", () => {
    const block = scene("40190989032")!;
    const script = BasketballScript.play(block);
    const cast = basketballCast(script, block, people, block.id);
    expect(tag(person(cast, cast.key(2)))).toBe("19 Bailey G");
    expect(tag(person(cast, script.shooter))).toBe("5 Castle G");
  });

  it("makes a shooting foul about the man whistled: Wembanyama, the defender in on it", () => {
    const foul = scene("40190989028")!;
    const script = beatScript(foul, [], flat, null);
    const cast = basketballCast(script, foul, people, foul.id);
    const key = cast.key(1);
    expect(tag(person(cast, key))).toBe("1 Wembanyama F");
    expect(script.players[key ?? 0]!.team).toBe("defense");
  });

  it("makes a bad pass stolen about the man who lost it (the text leads with him), the stealer named too", () => {
    const steal = scene("4019098908")!;
    const script = beatScript(steal, [], flat, null);
    const cast = basketballCast(script, steal, people, steal.id);
    expect(tag(person(cast, cast.key(1)))).toBe("19 Bailey G");
    expect(named(cast).some((p) => p.last === "Castle")).toBe(true);
  });

  it("makes a substitution about the man coming in (Collier), the man going off named", () => {
    const three = BasketballScript.play(scene("40190989026")!);
    const sub = scene("40190989063")!;
    const script = beatScript(sub, [sub], flat, three.lineup(three.duration));
    const cast = basketballCast(script, sub, people, sub.id);
    expect(tag(person(cast, cast.key(1)))).toBe("8 Collier G");
    expect(named(cast).some((p) => p.last === "Peterson")).toBe(true);
  });

  it("makes a timeout, and the court between plays, about nobody", () => {
    expect(basketballKey(scene("40190989074"))).toBeNull();
    expect(basketballKey(null)).toBeNull();
  });

  it("never names the referee", () => {
    const foul = scene("40190989028")!;
    const script = beatScript(foul, [], flat, null);
    const cast = basketballCast(script, foul, people, foul.id);
    script.players.forEach((p, i) => {
      if (p.team === "official") expect(cast.members.has(i)).toBe(false);
    });
  });
});
