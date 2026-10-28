/**
 * Every field the football feed gives, read on real games
 * (FootballTheaterTests.swift `footballFidelity`, check by check): two
 * college games (test/fixtures/cfb-plays.json, every entry, in college's own
 * grammar), the NFL's turnovers, sacks, flags and hits from four games of 25
 * Oct (nfl-turnovers-plays.json), and two NFL depth charts
 * (nfl-depthcharts.json); the fixtures are the Swift app's, copied. The
 * coverage counts are the Swift suite's: who has the ball 310/318, where he
 * was stopped 179/179 (every run and catch short of the end zone), every
 * sack's spot and sackers 7/7, every pass's depth, side and air yards
 * 115/115, every kick's landing 32/32, every turnover's spots 9/9; the NFL's
 * turnovers 13/13; and where every ball carrier was stopped, runs, catches
 * and sacks in all seven games (the Swift check's population: 186 college,
 * 175 NFL with Monday night's), 361/361.
 */
import { describe, expect, it } from "vitest";
import type { JSONValue } from "../../src/data/json";
import { FootballFeed, type FootballTeams } from "../../src/data/liveFeeds/football";
import { FootballScene, FootballDepthChart, parse, positionFromESPN, ruling } from "../../src/data/theater/footballScene";
import { FootballTheaterWatch, footballTheaterState } from "../../src/data/theater/footballTheater";
import { Builder } from "../../src/data/theater/footballScript";
import { footballSeason } from "../../src/data/liveFeeds/football";
import { fixture } from "./fixtures";

interface Game {
  readonly teams: FootballTeams;
  readonly items: readonly JSONValue[];
}

interface Team {
  readonly id: string;
  readonly abbreviation: string;
  readonly name: string;
}

function games(file: string): Game[] {
  const data = fixture(file) as { games: { home: Team; away: Team; items: JSONValue[] }[] };
  // The away team on top, as on the MNF page.
  return data.games.map((g) => ({
    teams: { topIsHome: false, topID: g.away.id, bottomID: g.home.id, homeAbbreviation: g.home.abbreviation, awayAbbreviation: g.away.abbreviation, homeName: g.home.name, awayName: g.away.name },
    items: g.items,
  }));
}

const textOf = (item: JSONValue): string => ((item as { text?: string }).text ?? "") as string;
const typeOf = (item: JSONValue): string => (((item as { type?: { text?: string } }).type?.text ?? "") as string).toLowerCase();

const college = games("cfb-plays.json");
const nfl = games("nfl-turnovers-plays.json");

/** The play whose text says this, parsed with its game's teams. */
function play(clue: string, set: readonly Game[]): FootballScene | null {
  for (const game of set) {
    const item = game.items.find((i) => textOf(i).includes(clue));
    if (item) return parse(item, game.teams);
  }
  return null;
}
const cfb = (clue: string) => play(clue, college);
const pro = (clue: string) => play(clue, nfl);

describe("football fidelity: the fixtures", () => {
  it("two college games and four NFL games load", () => {
    expect(college.length).toBe(2);
    expect(nfl.length).toBe(4);
  });
});

describe("football fidelity: positions", () => {
  it("ESPN's 35 is a defensive back, 37 a defensive lineman, 45 an offensive lineman", () => {
    expect(positionFromESPN(35)).toBe("defensiveBack");
    expect(positionFromESPN(37)).toBe("defensiveLine");
    expect(positionFromESPN(45)).toBe("lineman");
  });

  it("…and the depth chart's slots: RCB 19 a corner, FS 21 a safety, the nickel back, WLB, LDT, the long snapper (a holder is no position)", () => {
    expect(positionFromESPN(19)).toBe("corner");
    expect(positionFromESPN(21)).toBe("safety");
    expect(positionFromESPN(34)).toBe("defensiveBack");
    expect(positionFromESPN(26)).toBe("linebacker");
    expect(positionFromESPN(24)).toBe("defensiveLine");
    expect(positionFromESPN(39)).toBe("snapper");
    expect(positionFromESPN(79)).toBeNull();
  });

  it("a college \"DB\" can be either a corner or a safety on the field (FootballScript.roles)", () => {
    expect(Builder.roles("defensiveBack")).toEqual(["corner", "safety"]);
  });
});

describe("football fidelity: college's grammar", () => {
  const tally = new Map<string, [number, number]>();
  const count = (key: string, ok: boolean) => {
    const [a, b] = tally.get(key) ?? [0, 0];
    tally.set(key, [a + (ok ? 1 : 0), b + 1]);
  };
  for (const game of college) {
    for (const item of game.items) {
      const type = typeOf(item);
      const s = parse(item, game.teams);
      if (!s) continue;
      count("lead", s.names.lead != null);
      if (["pass reception", "pass incompletion", "passing touchdown"].includes(type)) {
        count("pass", s.depth != null && s.lane != null && s.air != null);
        count("depth", s.depth != null && s.lane != null);
        count("air", s.air != null);
      }
      // Swift counts the three together (186/186); its commit message, and the brief, the runs and catches alone.
      if (["rush", "pass reception", "sack"].includes(type) && !textOf(item).includes("TOUCHDOWN")) count("carried", s.stopped != null);
      if (["rush", "pass reception"].includes(type) && !textOf(item).includes("TOUCHDOWN")) count("stop", s.stopped != null);
      if (type === "sack") count("sack", s.stopped != null && s.sackers.length > 0);
      if (["kickoff", "punt"].includes(type)) count("kick", s.kickYards != null && s.turn != null);
      if (type.includes("interception")) count("turnover", s.turn != null);
      if (type.includes("fumble")) count("turnover", s.loose != null && s.recovered != null);
    }
  }
  const shown = (key: string) => (tally.get(key) ?? [0, 0]).join("/");

  it("two college games: who has the ball 310/318, where he was stopped 179/179, every pass's depth, side and spot 115/115, every kick's landing 32/32, every sack 7/7, every turnover's spots 9/9 (all none before)", () => {
    expect({ lead: shown("lead"), stop: shown("stop"), carried: shown("carried"), pass: shown("pass"), depth: shown("depth"), air: shown("air"), kick: shown("kick"), sack: shown("sack"), turnover: shown("turnover") }).toEqual({
      lead: "310/318",
      stop: "179/179",
      carried: "186/186",
      pass: "115/115",
      depth: "115/115",
      air: "115/115",
      kick: "32/32",
      sack: "7/7",
      turnover: "9/9",
    });
  });

  it("Hill up the middle to Alabama's 43, stopped by Jones", () => {
    const run = cfb("#4 D.Hill rush middle for 2 yards gain to the ALA43");
    expect(run?.lane).toBe("middle");
    expect(run?.gap).toBe("middle");
    expect(run?.stopped).toBe(43);
    expect(run?.names.lead).toBe("Hill");
    expect(run?.names.stop).toBe("Jones");
  });

  it("a short pass left, caught exactly 17 yards downfield (\"caught at TAM24\"), to Scott", () => {
    const caught = cfb("#12 K.Russell pass complete short left to #7 R.Scott caught at TAM24");
    expect(caught?.depth).toBe("short");
    expect(caught?.lane).toBe("left");
    expect(caught?.air).toBe(17);
    expect(caught?.stopped).toBe(76);
    expect(caught?.names.target).toBe("Scott");
  });

  it("an incompletion thrown exactly 7 yards downfield (\"thrown to TAM22\")", () => {
    const thrown = cfb("pass incomplete short middle to #4 D.Hill thrown to TAM22");
    expect(thrown?.kind.type).toBe("incomplete");
    expect(thrown?.air).toBe(7);
  });

  it("a kickoff 41 yards to the 24, returned 9 by Edwards", () => {
    const kick = cfb("kickoff 41 yards to the ALA24 #81 K.Edwards return 9 yards");
    expect(kick?.kickYards).toBe(41);
    expect(kick?.turn).toBe(76);
    expect(kick?.kick).toBe("returned");
    expect(kick?.stopped).toBe(67);
    expect(kick?.returnYards).toBe(9);
    expect(kick?.names.returner).toBe("Edwards");
  });

  it("a punt into the end zone, a touchback; another fair caught at the 26", () => {
    const touchback = cfb("punt 46 yards to the TAM00, Touchback");
    expect(touchback?.turn).toBe(105);
    expect(touchback?.kick).toBe("touchback");
    const fair = cfb("punt 49 yards to the ALA26 fair catch");
    expect(fair?.kick).toBe("fairCatch");
    expect(fair?.turn).toBe(74);
  });

  it("Lee's pick at the 39, returned for a touchdown", () => {
    const pick = cfb("intercepted by #5 D.Lee Jr. at TAM39");
    expect(pick?.kind.type).toBe("interception");
    expect(pick?.turn).toBe(39);
    expect(pick?.names.taker).toBe("Lee Jr.");
    expect(pick?.pickSix).toBe(true);
  });

  it("a fumble lost at the 45, Reese on it", () => {
    const lost = cfb("fumbled by #10 M.Reed at TAM45 recovered by ALA #36 Q.Reese");
    expect(lost?.kind.type).toBe("fumble");
    expect(lost?.loose).toBe(45);
    expect(lost?.turn).toBe(45);
    expect(lost?.names.taker).toBe("Reese");
  });

  it("a fumble kept: knocked out at the 18 by Simmons (his credit), recovered at the 22", () => {
    const kept = cfb("fumbled by #10 M.Reed at TAM18 forced by #90 L.Simmons");
    expect(kept?.kind.type).toBe("rush");
    expect(kept?.loose).toBe(18);
    expect(kept?.recovered).toBe(22);
    expect(kept?.stripper?.name).toBe("Simmons");
    expect(kept?.stripper?.id).not.toBeNull();
  });

  it("a split sack: Ratcliffe and Jones, both credited, down at the 15", () => {
    const split = cfb("sacked for loss of 5 yards to the TAM15 (#3 M.Ratcliffe, #10 M.Jones)");
    expect(split?.sackers.map((p) => p.name)).toEqual(["Ratcliffe", "Jones"]);
    expect(split?.sackers.every((p) => p.id != null)).toBe(true);
    expect(split?.stopped).toBe(85);
  });

  it("a hurried throw: Ratcliffe (#3) and Jones", () => {
    const hurried = cfb("QB hurried by #3 M.Ratcliffe and #10 M.Jones");
    expect(hurried?.pressure?.hit).toBe(false);
    expect(hurried?.pressure?.by.map((p) => p.name)).toEqual(["Ratcliffe", "Jones"]);
    expect(hurried?.pressure?.by[0]?.jersey).toBe("3");
  });

  it("a college flag from the text: targeting on Alabama's Morgan, 15 yards from the 29 to the 14, no play", () => {
    const targeting = cfb("PENALTY ALA Targeting (#6 R.Morgan)");
    const flag = targeting?.flags[0];
    expect(flag?.name).toBe("Targeting");
    expect(flag?.yards).toBe(15);
    expect(flag?.from).toBe(71);
    expect(flag?.to).toBe(86);
    expect(flag?.noPlay).toBe(true);
    expect(flag?.side).toBe("bottom");
    expect(flag?.player?.name).toBe("Morgan");
    expect(flag?.player?.id).not.toBeNull();
    expect(flag?.timing).toBe("duringPlay");
    expect(targeting?.penalty?.name).toBe("Targeting");
  });

  it("…a false start before the snap; a declined offside that doesn't count", () => {
    expect(cfb("PENALTY ALA False Start (#65 T.Miller)")?.flags[0]?.timing).toBe("beforeSnap");
    const offside = cfb("PENALTY ALA Offside declined");
    expect(offside?.flags[0]?.status).toBe("declined");
    expect(offside?.penalty).toBeNull();
  });

  it("a review that made it an interception: the ruling that stood, not the original", () => {
    const overturned = cfb("pass intercepted by #19 C.McDonald III at TAM41, End Of Play. The previous play");
    expect(overturned?.kind.type).toBe("interception");
    expect(overturned?.turn).toBe(41);
    expect(overturned?.names.taker).toBe("McDonald III");
  });

  it("spots by a team's name: a punt to Akron's 9", () => {
    // Kent State's spots by its name ("Kent38"), Akron's too.
    const named = cfb("punt 42 yards to the Akron09 fair catch by #13 S.Patrick at Akron09");
    expect(named?.turn).toBe(91);
    expect(named?.kick).toBe("fairCatch");
  });

  it("offsetting fouls run together: two flags, one each, after the play", () => {
    const offsetting = cfb("PENALTY Kent UNS: Unsportsmanlike Conduct offsetting Akron");
    expect(offsetting?.flags.length).toBe(2);
    expect(offsetting?.flags.every((f) => f.status === "offsetting" && f.timing === "afterPlay")).toBe(true);
    expect(new Set(offsetting?.flags.map((f) => f.side).filter((s) => s != null)).size).toBe(2);
  });

  it("a muffed kick, recovered by the kicking team at the 13", () => {
    const muffed = cfb("muffed by #28 L.Reed at Akron04 recovered by Kent #24 T.Mintz at Akron13");
    expect(muffed?.kick).toBe("returned");
    expect(muffed?.stopped).toBe(87);
  });
});

describe("football fidelity: NFL turnovers", () => {
  const ints = nfl.flatMap((g) => g.items.filter((i) => ((i as { type?: { text?: string } }).type?.text ?? "").includes("Interception")).flatMap((i) => parse(i, g.teams) ?? []));
  // A fumble in the ruling that stood (one the review reversed isn't).
  const fumbles = nfl.flatMap((g) => g.items.filter((i) => ruling(textOf(i)).includes("FUMBLES")).flatMap((i) => parse(i, g.teams) ?? []));

  it("every NFL pick has its spot (5/5; 2 before), every fumble where it came loose and where it was recovered (8/8; 1 and 3 of 8 before): 13/13", () => {
    expect(`${ints.filter((s) => s.turn != null).length}/${ints.length}`).toBe("5/5");
    expect(`${fumbles.filter((s) => s.loose != null && s.recovered != null).length}/${fumbles.length}`).toBe("8/8");
  });

  it("…and where every ball carrier was stopped, run, catch or sack, in all seven games: 175/175 in the NFL's five (Monday night's and these four), 361/361 with college's", () => {
    const mnf: Game = {
      teams: { topIsHome: false, topID: "6", bottomID: "21", homeAbbreviation: "PHI", awayAbbreviation: "DAL" },
      items: (fixture("mnf-dal-phi-plays.json") as { items: JSONValue[] }).items,
    };
    const stopped = (set: readonly Game[]): [number, number] => {
      let read = 0;
      let all = 0;
      for (const game of set) {
        for (const item of game.items) {
          const s = parse(item, game.teams);
          if (!s || !["rush", "pass reception", "sack"].includes(typeOf(item)) || textOf(item).includes("TOUCHDOWN")) continue;
          all += 1;
          if (s.stopped != null) read += 1;
        }
      }
      return [read, all];
    };
    expect(stopped([mnf, ...nfl]).join("/")).toBe("175/175");
    expect(stopped([mnf, ...nfl, ...college]).join("/")).toBe("361/361");
  });

  it("a pick past the hitter's [brackets]: at SEA 34, Emmanwori credited with the hit on Mahomes", () => {
    const okada = pro("INTERCEPTED by T.Okada [N.Emmanwori] at SEA 34");
    expect(okada?.turn).toBe(66);
    expect(okada?.pressure?.hit).toBe(true);
    expect(okada?.pressure?.by[0]?.name).toBe("Emmanwori");
    expect(okada?.pressure?.by[0]?.id).not.toBeNull();
  });

  it("…in the end zone (KC -9), past a breakup in (parentheses), at midfield", () => {
    expect(pro("INTERCEPTED by N.Williams [G.Karlaftis] at KC -9")?.turn).toBe(109);
    expect(pro("INTERCEPTED by T.Smith (K.Scott) at CAR 32")?.turn).toBe(32);
    expect(pro("INTERCEPTED by Z.McCollum at 50")?.turn).toBe(50);
  });

  const strip = pro("P.Mahomes sacked at SEA 32 for -2 yards (D.Hall). FUMBLES (D.Hall) [D.Hall], touched at SEA 27, and recovers at SEA 32");

  it("a strip-sack he kept: loose where Hall sacked him, recovered there (\"and recovers at\")", () => {
    expect(strip?.kind.type).toBe("sack");
    expect(strip?.loose).toBe(68);
    expect(strip?.recovered).toBe(68);
    expect(strip?.stripper?.name).toBe("Hall");
    expect(strip?.stripper?.id).not.toBeNull();
    expect(strip?.sackers[0]?.name).toBe("Hall");
  });

  it("a strip-sack scooped for a touchdown: loose at the 31, Kancey's at the 32", () => {
    const scoop = pro("FUMBLES (A.Muhammad) [A.Muhammad], RECOVERED by TB-C.Kancey at CAR 32");
    expect(scoop?.kind.type).toBe("fumble");
    expect(scoop?.loose).toBe(31);
    expect(scoop?.turn).toBe(32);
    expect(scoop?.scoring).toBe("touchdown");
    expect(scoop?.stripper?.name).toBe("Muhammad");
    expect(scoop?.sackers.map((p) => p.name)).toEqual(["Muhammad"]);
  });

  it("a botched snap: loose at the 41, recovered at the 42", () => {
    const aborted = pro("J.Goff FUMBLES (Aborted) at DET 41");
    expect(aborted?.loose).toBe(41);
    expect(aborted?.turn).toBe(42);
  });

  it("\"recovered by\" in lower case, and who punched it out", () => {
    const lower = pro("FUMBLES (W.Lee), recovered by TB-D.Sills at CAR 37");
    expect(lower?.loose).toBe(63);
    expect(lower?.recovered).toBe(63);
    expect(lower?.stripper?.name).toBe("Lee");
  });

  it("a split sack, both credited, at HST 40 (the gamebook's code for Houston)", () => {
    const splitSack = pro("sack split by D.Alexander and A.Reese");
    expect(splitSack?.sackers.map((p) => p.name)).toEqual(["Alexander", "Reese"]);
    expect(splitSack?.sackers.every((p) => p.id != null)).toBe(true);
    expect(splitSack?.stopped).toBe(40);
  });

  it("a blocked field goal: Wonnum got a hand on it", () => {
    const blocked = pro("35 yard field goal is BLOCKED (D.Wonnum)");
    expect(blocked?.blocker?.name).toBe("Wonnum");
    expect(blocked?.blocker?.id).not.toBeNull();
    expect(blocked?.blocker?.position).toBe("linebacker");
  });

  it("a hit as he threw: Hall, from the brackets and the `other` credit", () => {
    const hit = pro("P.Mahomes pass incomplete deep right to X.Worthy [D.Hall].");
    expect(hit?.pressure?.hit).toBe(true);
    expect(hit?.pressure?.by.map((p) => p.name)).toEqual(["Hall"]);
    expect(hit?.pressure?.by[0]?.position).toBe("linebacker");
  });

  it("…an `other` with no brackets isn't a hit (its play stats show none)", () => {
    const plain = pro("(Shotgun) P.Mahomes pass incomplete deep right to X.Worthy.");
    expect(plain?.pressure).toBeNull();
    expect(plain?.participants.some((p) => p.role === "other")).toBe(true);
  });
});

describe("football fidelity: NFL flags", () => {
  it("the flag on Kelce: an illegal shift, enforced at SEA 46, walked back to KC's 49, no play", () => {
    const shift = pro("PENALTY on KC-T.Kelce, Illegal Shift, 5 yards, enforced at SEA 46 - No Play.")?.flags[0];
    expect(shift?.slug).toBe("illegal-shift");
    expect(shift?.player?.name).toBe("Kelce");
    expect(shift?.player?.id).not.toBeNull();
    expect(shift?.from).toBe(54);
    expect(shift?.to).toBe(49);
    expect(shift?.noPlay).toBe(true);
    expect(shift?.side).toBe("top");
    expect(shift?.timing).toBe("duringPlay");
  });

  it("offsetting flags: Kansas City's hold, Seattle's horse collar", () => {
    const both = pro("Penalty on KC-J.Ezeudu, Offensive Holding, offsetting")?.flags;
    expect(both?.map((f) => f.status)).toEqual(["offsetting", "offsetting"]);
    expect(both?.map((f) => f.side)).toEqual(["top", "bottom"]);
    expect(both?.at(-1)?.name).toBe("Horse Collar Tackle");
  });

  it("a declined flag is on the play, but walks nothing off", () => {
    const declined = pro("Penalty on GB-K.Brooks, Defensive Offside, declined.");
    expect(declined?.flags[0]?.status).toBe("declined");
    expect(declined?.penalty).toBeNull();
  });

  it("a delay of game before the snap (on the team, no one player); a foul enforced between downs, after the play", () => {
    const delay = pro("PENALTY on SEA, Delay of Game");
    expect(delay?.flags[0]?.timing).toBe("beforeSnap");
    expect(delay?.flags[0]?.player).toBeNull();
    expect(pro("Illegal Formation, 5 yards, enforced between downs")?.flags[0]?.timing).toBe("afterPlay");
  });
});

describe("football fidelity: depth charts", () => {
  const raw = (fixture("nfl-depthcharts.json") as { teams: Record<string, JSONValue> }).teams;
  const kc = FootballDepthChart.from(raw["12"]);
  const sea = FootballDepthChart.from(raw["26"]);

  it("Kansas City's base 4-3, Seattle's base 3-4 (a nose tackle)", () => {
    expect(kc?.front).toBe("fourThree");
    expect(sea?.front).toBe("threeFour");
    expect(sea?.slots.some((s) => s.key === "nt")).toBe(true);
  });

  it("each man in his slot: the strong safety; the defense's left end on the offense's right, its right corner on the left", () => {
    expect(sea?.slot("4247808")?.key).toBe("ss");
    expect(sea?.slots.find((s) => s.key === "lde")?.lane).toBe("right");
    expect(sea?.slots.find((s) => s.key === "rcb")?.lane).toBe("left");
    expect(kc?.slots.find((s) => s.key === "lt")?.lane).toBe("left");
    expect(kc?.slots.find((s) => s.key === "lt")?.position).toBe("lineman");
  });

  it("the strip-sack on the chart: Hall is Seattle's strong-side backer, in a 3-4", () => {
    const strip = pro("P.Mahomes sacked at SEA 32 for -2 yards (D.Hall). FUMBLES (D.Hall) [D.Hall], touched at SEA 27, and recovers at SEA 32")!;
    const placed = strip.slotted({ top: kc!, bottom: sea! });
    expect(placed.stripper?.slot).toBe("slb");
    expect(placed.sackers[0]?.slot).toBe("slb");
    expect(placed.front).toBe("threeFour");
    // The scene it came from is left as it was.
    expect(strip.stripper?.slot ?? null).toBeNull();
    expect(strip.slotted({})).toBe(strip);
  });

  it("two loads of the same chart compare equal (slots by key, not the dictionary's order)", () => {
    expect(JSON.stringify(FootballDepthChart.from(raw["26"]))).toBe(JSON.stringify(sea));
    expect(FootballDepthChart.from({ items: [] })).toBeNull();
  });

  it("the season a game falls in: October's and February's are 2026's", () => {
    expect(footballSeason(Date.UTC(2026, 9, 27, 18))).toBe(2026);
    expect(footballSeason(Date.UTC(2027, 1, 27, 18))).toBe(2026);
  });

});

describe("football fidelity: the depth charts reach the theater", () => {
  const raw = (fixture("nfl-depthcharts.json") as { teams: Record<string, JSONValue> }).teams;
  const sea = nfl[0]!;
  const BASE = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/1/competitions/1";
  const stripAt = sea.items.findIndex((i) => textOf(i).includes("P.Mahomes sacked at SEA 32 for -2 yards (D.Hall). FUMBLES"));
  /** Kansas City at Seattle as of the strip-sack, and both teams' depth charts (once a game). */
  function lane(path = "football/nfl") {
    const calls: string[] = [];
    const served = sea.items.slice(0, stripAt + 1);
    const fetcher = async (url: string) => {
      calls.push(url);
      const chart = /\/seasons\/(\d+)\/teams\/(\d+)\/depthcharts$/.exec(url);
      if (chart) return raw[chart[2]!] ?? { items: [] };
      if (url.endsWith("/situation")) return { lastPlay: { $ref: `${BASE}/plays/${(served.at(-1) as { id: string }).id}` }, down: 1, distance: 10, yardLine: 40 };
      if (url.endsWith("/status")) return { clock: 600, displayClock: "10:00", period: 2, type: { state: "in" } };
      return { count: served.length, pageCount: 1, items: served };
    };
    return { calls, update: (feed: FootballFeed) => feed.update(fetcher, { path, eventID: "1", teams: sea.teams }) };
  }

  it("the NFL lane asks for both teams' charts once a game (the season's, official ESPN core), and keeps them for the day", async () => {
    FootballFeed.chartCache.clear();
    const { calls, update } = lane();
    const feed = new FootballFeed(() => Date.UTC(2026, 9, 25, 20));
    await update(feed);
    const asked = calls.filter((u) => u.endsWith("/depthcharts"));
    expect(asked).toEqual([
      "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2026/teams/12/depthcharts",
      "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2026/teams/26/depthcharts",
    ]);
    expect(Object.keys(feed.charts).sort()).toEqual(["bottom", "top"]);
    await update(feed);
    expect(calls.filter((u) => u.endsWith("/depthcharts")).length).toBe(2);
    // Another page on the same day reads them from the cache.
    const again = lane();
    await again.update(new FootballFeed(() => Date.UTC(2026, 9, 25, 21)));
    expect(again.calls.filter((u) => u.endsWith("/depthcharts"))).toEqual([]);
  });

  it("college has none: its lane never asks", async () => {
    const { calls, update } = lane("football/college-football");
    await update(new FootballFeed());
    expect(calls.some((u) => u.endsWith("/depthcharts"))).toBe(false);
  });

  it("the theater beside the lane: the snap placed on the charts (Hall, Seattle's strong-side backer, in a 3-4), and the charts on its state", async () => {
    FootballFeed.chartCache.clear();
    const { update } = lane();
    const feed = new FootballFeed(() => Date.UTC(2026, 9, 25, 20));
    await update(feed);
    const watch = new FootballTheaterWatch();
    expect(watch.update(feed.items, sea.teams, false, Date.UTC(2030, 0, 1), feed.charts)).toBe(true);
    expect(watch.state.play?.text).toContain("FUMBLES (D.Hall)");
    expect(watch.state.play?.stripper?.slot).toBe("slb");
    expect(watch.state.play?.front).toBe("threeFour");
    expect(watch.state.charts?.top?.front).toBe("fourThree");
    expect(watch.state.charts?.bottom?.front).toBe("threeFour");
    // Nothing new: nothing changes.
    expect(watch.update(feed.items, sea.teams, true, Date.UTC(2030, 0, 1), feed.charts)).toBe(false);
  });

  it("…charts that come after the snap place the one showing; a new snap keeps them", () => {
    const watch = new FootballTheaterWatch();
    const items = sea.items.slice(0, stripAt + 1);
    watch.update(items, sea.teams, false, Date.UTC(2030, 0, 1));
    expect(watch.state.play?.stripper?.slot ?? null).toBeNull();
    expect(watch.update(items, sea.teams, false, Date.UTC(2030, 0, 1), { top: raw["12"], bottom: raw["26"] })).toBe(true);
    expect(watch.state.play?.stripper?.slot).toBe("slb");
    const next = footballTheaterState(parse(sea.items[stripAt + 1]!, sea.teams)!, watch.state, true, 0);
    expect(next.charts).toBe(watch.state.charts);
  });
});
