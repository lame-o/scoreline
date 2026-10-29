/**
 * The names over the football theater's figures (TheaterNamesTests.swift's
 * football checks), on the Swift app's fixtures: Kansas City at Seattle's
 * snaps on their depth charts (nfl-turnovers-plays.json, nfl-depthcharts.json)
 * with its box score (names-nfl-401873022-boxscore.json), and a college game
 * whose credits are named only in the text (cfb-plays.json). Only the
 * credited men are named, each on his own figure; everyone else is his team
 * and his place; the key man is the one with the ball.
 */
import { describe, expect, it } from "vitest";
import type { JSONValue } from "../../src/data/json";
import type { FootballTeams } from "../../src/data/liveFeeds/football";
import { FootballDepthChart, parse, type FootballScene } from "../../src/data/theater/footballScene";
import { FootballScript } from "../../src/data/theater/footballScript";
import { footballCast, numberOf, tagPosition, textName } from "../../src/data/theater/footballTheater";
import { personOf, TheaterPeople, type TheaterCast, type TheaterPerson } from "../../src/data/theater/theaterNames";
import { fixture } from "./fixtures";

interface Team {
  readonly id: string;
  readonly abbreviation: string;
  readonly name: string;
}

interface Game {
  readonly teams: FootballTeams;
  readonly items: readonly JSONValue[];
}

/** Each game with the visitors on top, as the pages have it. */
function games(file: string): Game[] {
  const data = fixture(file) as { games: { home: Team; away: Team; items: JSONValue[] }[] };
  return data.games.map((g) => ({
    teams: { topIsHome: false, topID: g.away.id, bottomID: g.home.id, homeAbbreviation: g.home.abbreviation, awayAbbreviation: g.away.abbreviation, homeName: g.home.name, awayName: g.away.name },
    items: g.items,
  }));
}

const textOf = (item: JSONValue) => ((item as { text?: string }).text ?? "") as string;
const tag = (p: TheaterPerson | null | undefined) => (p ? `${p.number ?? "-"} ${p.last} ${p.position ?? "-"}` : "none");
const person = (cast: TheaterCast, i: number | null | undefined) => (i == null ? null : personOf(cast.members.get(i)?.who));

const nfl = games("nfl-turnovers-plays.json");
const kcAtSea = nfl[0]!;
const charts = (fixture("nfl-depthcharts.json") as { teams: Record<string, JSONValue> }).teams;
const kc = FootballDepthChart.from(charts["12"]);
const sea = FootballDepthChart.from(charts["26"]);
const people = TheaterPeople.boxscore(fixture("names-nfl-401873022-boxscore.json"));

/** Kansas City at Seattle's snap whose text says this, on the depth charts. */
function scene(clue: string): FootballScene | null {
  const item = kcAtSea.items.find((i) => textOf(i).includes(clue));
  const parsed = item ? parse(item, kcAtSea.teams) : null;
  return parsed && kc && sea ? parsed.slotted({ top: kc, bottom: sea }) : parsed;
}

describe("names over the football theater", () => {
  it("loads Kansas City at Seattle on its depth charts, with its box score", () => {
    expect(kcAtSea.teams.awayAbbreviation).toBe("KC");
    expect(kc).not.toBeNull();
    expect(sea).not.toBeNull();
    expect(Object.keys(people).length).toBeGreaterThan(20);
  });

  describe("Mahomes to E. Johnson", () => {
    const pass = scene("pass short middle to E.Johnson")!;
    const script = FootballScript.play(pass);
    const cast = footballCast(script, pass, "top", people, pass.id);
    const qb = script.players.findIndex((p) => p.role === "quarterback");

    it("names only the credited men, each on his own figure: the passer, the back he threw to, Murphy the tackler at his slot", () => {
      const named = [...cast.members.values()].flatMap((m) => (m.who.kind === "known" ? [tag(m.who.person)] : [])).sort();
      expect(named).toEqual(["10 Johnson RB", "15 Mahomes QB", "91 Murphy II NT"]);
      expect(tag(person(cast, qb))).toBe("15 Mahomes QB");
    });

    it("says only the team and the place of the other nineteen, never the depth chart's names", () => {
      const assumed = [...cast.members.values()].flatMap((m) => (m.who.kind === "assumed" ? [m.who.position] : []));
      expect(assumed).toHaveLength(19);
      expect(assumed).toContain("DE");
      expect(assumed).toContain("LT");
      expect(assumed).toContain("FS");
    });

    it("keys the man with the ball: the quarterback from the start and through the throw's flight, the receiver from the catch to the end", () => {
      const receiver = cast.keys.at(-1)?.figure ?? null;
      const caught = script.legs.find((l) => l.hand.kind === "carry" && l.hand.player === receiver)?.from ?? 99;
      expect(receiver).not.toBe(qb);
      expect(cast.key(0)).toBe(qb);
      expect(cast.key(caught - 0.05)).toBe(qb);
      expect(cast.key(caught + 0.01)).toBe(receiver);
      expect(cast.key(Infinity)).toBe(receiver);
    });

    it("gives the officials and trainers no tag", () => {
      script.players.forEach((p, i) => {
        if (p.team === "official" || p.team === "staff") expect(cast.members.has(i)).toBe(false);
      });
    });

    it("keeps a named man's id across scripts, and an unnamed one his figure's own", () => {
      expect(cast.members.get(qb)?.id).toMatch(/^a:/);
      const unnamed = [...cast.members.entries()].find(([, m]) => m.who.kind === "assumed");
      expect(unnamed?.[1].id).toBe(`${pass.id}#${unnamed?.[0]}`);
    });
  });

  it("keys a kickoff's kicker until it's caught, then the returner", () => {
    let kick: FootballScene | null = null;
    for (const g of nfl) {
      for (const item of g.items) {
        const s = parse(item, g.teams);
        if (s && s.kind.type === "kickoff" && s.kick === "returned") {
          kick = s;
          break;
        }
      }
      if (kick) break;
    }
    expect(kick).not.toBeNull();
    const script = FootballScript.play(kick!);
    const cast = footballCast(script, kick, kick!.offense ?? "top", people, kick!.id);
    const kicker = cast.key(0);
    expect(kicker).not.toBeNull();
    expect(script.players[kicker!]!.role).toBe("kicker");
    const last = cast.key(Infinity);
    expect(last != null ? script.players[last]!.role : null).toBe("returner");
  });

  it("names college's credited men by their role, numbered from the text (#12 K.Russell)", () => {
    const college = games("cfb-plays.json")[0]!;
    const item = college.items.find((i) => (i as { id?: string }).id === "40185672712")!;
    const pass = parse(item, college.teams)!;
    const script = FootballScript.play(pass);
    const cast = footballCast(script, pass, pass.offense ?? "top", {}, pass.id);
    const named = [...cast.members.values()].flatMap((m) => (m.who.kind === "known" ? [tag(m.who.person)] : [])).sort();
    // The passer, the tight end it went to, and the tackler on the figure his position puts him on.
    expect(named).toHaveLength(3);
    expect(named).toContain("12 Russell QB");
    expect(named).toContain("40 Ford TE");
    expect(named.some((t) => t.startsWith("7 Brooks "))).toBe(true);
  });

  it("finds a man's number and name in the text, and his place as a tag says it", () => {
    expect(numberOf("Russell", "(15:00) #12 K.Russell pass complete short right to #40 J.Ford")).toBe("12");
    expect(numberOf("Lee Jr.", "intercepted by #5 D.Lee Jr. at the ALA20")).toBe("5");
    expect(numberOf("Ford", "#12 K.Russell pass")).toBeNull();
    expect(tagPosition({ key: "lde", role: "front" }, null, null)).toBe("DE");
    expect(tagPosition({ key: null, role: "back" }, "fullback", null)).toBe("FB");
    expect(tagPosition({ key: null, role: "corner" }, "safety", null)).toBe("S");
    expect(tagPosition({ key: null, role: "returner" }, null, "punt")).toBe("PR");
    expect(tagPosition({ key: null, role: "returner" }, null, "kickoff")).toBe("KR");
    expect(tagPosition({ key: null, role: "cover" }, null, "kickoff")).toBe("");
    const s = scene("pass short middle to E.Johnson")!;
    expect(textName({ role: "receiver", id: null, position: null }, s)).toBe(s.names.target ?? null);
    expect(textName({ role: "holder", id: null, position: null }, s)).toBeNull();
  });
});
