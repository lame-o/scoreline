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
import { Builder, FootballScript, footballStamp, Gridiron, type Action } from "../../src/data/theater/footballScript";
import type { Point } from "../../src/data/mlb/theaterField";
import { cocked, playerPose } from "../../src/features/game/football/theater/drawFootball";
import { jointsBreak } from "./rigJoints";
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

/**
 * The choreography reading every field, on the same real plays
 * (FootballTheaterTests.swift `footballSequencing`): the hit as he throws,
 * the strip and the scramble for the ball, the split sack, the blocked kick,
 * each flag at the moment and the place of its foul and its walk, college's
 * exact spots, the defense in its own front with each credited man in his
 * slot, and the ball in the throwing hand.
 */
describe("football theater: every play in the order it happened", () => {
  const raw = (fixture("nfl-depthcharts.json") as { teams: Record<string, JSONValue> }).teams;
  const kc = FootballDepthChart.from(raw["12"]);
  const sea = FootballDepthChart.from(raw["26"]);
  /** The play whose text says this, parsed with its game's teams (Kansas City at Seattle's on their depth charts). */
  const placed = (clue: string, set: readonly Game[]): FootballScene | null => {
    for (const game of set) {
      const item = game.items.find((i) => textOf(i).includes(clue));
      const s = item ? parse(item, game.teams) : null;
      if (!s) continue;
      if (game.teams.topID === "12" && kc && sea) return s.slotted({ top: kc, bottom: sea });
      return s;
    }
    return null;
  };
  const proPlay = (clue: string) => placed(clue, nfl);
  const cfbPlay = (clue: string) => placed(clue, college);
  const near = (a: Point | null | undefined, b: Point | null | undefined, tolerance: number) => a != null && b != null && Math.hypot(a.x - b.x, a.y - b.y) <= tolerance;
  /** Who has a pose of this kind, and when. */
  const acting = (s: FootballScript, kind: Action["kind"]) => s.players.flatMap((p, i) => p.actions.filter((a) => a.kind === kind).map((a) => ({ player: i, at: a.at })));
  const quarterback = (s: FootballScript) => s.players.findIndex((p) => p.role === "quarterback");
  const throwAt = (s: FootballScript, qb: number) => s.players[qb]!.actions.find((a) => a.kind === "throwBall")?.at ?? 0;

  it("Seattle in its base 3-4: three down, a nose tackle over the ball; Kansas City's 4-3, four down; eleven a side", () => {
    const sea3 = proPlay("P.Mahomes pass incomplete deep right to X.Worthy [D.Hall]")!;
    const kc4 = proPlay("S.Darnold pass incomplete short middle to J.Smith-Njigba")!;
    const a = FootballScript.play(sea3);
    const b = FootballScript.play(kc4);
    const down = a.players.filter((p) => p.team === "defense" && p.role === "front");
    expect(sea3.front).toBe("threeFour");
    expect(down.length).toBe(3);
    expect(down.some((p) => p.key === "nt" && Math.abs(p.at.x) < 1)).toBe(true);
    expect(b.players.filter((p) => p.team === "defense" && p.role === "front").length).toBe(4);
    expect(a.players.filter((p) => p.team === "defense").length).toBe(11);
    expect(a.players.filter((p) => p.team === "offense").length).toBe(11);
  });

  it("every man in a depth-chart slot: the defense's left corner on the offense's right, its left tackle on its left", () => {
    const a = FootballScript.play(proPlay("P.Mahomes pass incomplete deep right to X.Worthy [D.Hall]")!);
    const keys = new Set(a.players.flatMap((p) => p.key ?? []));
    for (const k of ["lde", "rde", "nt", "wlb", "lcb", "rcb", "ss", "fs", "lt", "rt", "c", "qb"]) expect(keys.has(k), k).toBe(true);
    expect(a.players.filter((p) => p.key === "lcb").every((p) => p.at.x > 0)).toBe(true);
    expect(a.players.filter((p) => p.key === "lt").every((p) => p.at.x < 0)).toBe(true);
  });

  it("a hit as he threw: Seattle's backer (Hall, credited in brackets) gets to Mahomes as the ball leaves, and puts him on his back after it; the throw still goes, deep right", () => {
    const hit = proPlay("P.Mahomes pass incomplete deep right to X.Worthy [D.Hall]")!;
    const s = FootballScript.play(hit);
    const qb = quarterback(s);
    const release = throwAt(s, qb);
    const hitter = acting(s, "tackle").find((a) => a.at > release - 0.05 && a.at < release + 0.25);
    expect(hitter).toBeDefined();
    expect(near(s.players[hitter!.player]!.position(hitter!.at), s.players[qb]!.position(release), 3.5)).toBe(true);
    expect(s.players[hitter!.player]!.role).toBe("backer");
    expect(s.players[hitter!.player]!.position(0).x * (hit.lane === "left" ? -1 : 1)).not.toBe(0);
    expect(s.players[qb]!.holds.some((h) => h.kind === "knocked" && h.from > release)).toBe(true);
    expect(s.flashes.some((f) => f.beat === "hit" && f.at > release)).toBe(true);
    expect(s.flights.some((f) => f.start === release && f.end - f.start > 0.5)).toBe(true);
  });

  it("a hurried throw (college's \"QB hurried by\"): both men close on him as he throws, a stride short, no hit", () => {
    const s = FootballScript.play(cfbPlay("QB hurried by #3 M.Ratcliffe and #10 M.Jones")!);
    const qb = quarterback(s);
    const release = throwAt(s, qb);
    const at = s.players[qb]!.position(release);
    const closing = s.players.filter((p) => p.team === "defense" && Math.hypot(p.position(release).x - at.x, p.position(release).y - at.y) < 8);
    expect(closing.length).toBe(2);
    expect(s.players[qb]!.holds.some((h) => h.kind === "knocked")).toBe(false);
  });

  it("a strip-sack: Muhammad's punch as he gets there, the ball out of Young's arms at the spot of the sack, Young down; the scramble, and Kancey scoops it up at the 32 and runs it back: TOUCHDOWN", () => {
    const s = FootballScript.play(proPlay("B.Young sacked at CAR 31 for -9 yards (A.Muhammad). FUMBLES")!);
    const qb = quarterback(s);
    const stripped = acting(s, "strip")[0];
    const pop = s.flights.find((f) => f.start > 1 && Math.abs(f.from.z - 3.4) < 0.01);
    const recovery = acting(s, "scoop")[0];
    expect(stripped && pop?.start === stripped.at).toBe(true);
    expect(Math.abs(pop!.to.y - Gridiron.y(31))).toBeLessThan(0.5);
    expect(s.players[qb]!.holds.some((h) => h.kind === "down")).toBe(true);
    expect(recovery).toBeDefined();
    expect(s.players[recovery!.player]!.team).toBe("defense");
    expect(s.players[recovery!.player]!.role).toBe("front");
    expect(Math.abs(s.players[recovery!.player]!.position(recovery!.at).y - Gridiron.y(32))).toBeLessThan(1);
    expect(acting(s, "scramble").length).toBeGreaterThanOrEqual(2);
    expect(s.players.some((p) => p.team === "offense" && p.actions.some((a) => a.kind === "scramble"))).toBe(true);
    expect(s.end!.y).toBeLessThan(0);
    expect(s.banner?.text).toBe("TOUCHDOWN");
    expect(s.score!).toBeGreaterThan(recovery!.at);
  });

  it("a strip-sack he kept: Hall (Seattle's strong-side backer) punches it out, Mahomes falls on it at the 32, the ball still Kansas City's", () => {
    const s = FootballScript.play(proPlay("P.Mahomes sacked at SEA 32 for -2 yards (D.Hall). FUMBLES")!);
    const qb = quarterback(s);
    const stripper = acting(s, "strip")[0];
    expect(stripper && (s.players[stripper.player]!.key === "slb" || s.players[stripper.player]!.role === "backer")).toBe(true);
    const last = [...s.legs].reverse().find((l) => !Number.isFinite(l.until));
    expect(last?.hand).toEqual({ kind: "carry", player: qb });
    expect(s.banner).toBeNull();
    expect(s.next.gain!).toBeGreaterThan(s.next.scrimmage ?? 0);
  });

  it("a run fumbled: Gibbs stripped by McDuffie where it came out, Green Bay comes up with it, FUMBLE as he does, the lines turn round", () => {
    const s = FootballScript.play(proPlay("J.Gibbs up the middle to GB 6 for 6 yards (I.McDuffie). FUMBLES")!);
    const carrier = s.players.findIndex((p, i) => p.role === "back" && s.legs.some((l) => l.hand.kind === "carry" && l.hand.player === i));
    const stripped = acting(s, "strip")[0];
    const recovered = [...s.legs].reverse().find((l) => !Number.isFinite(l.until))?.from ?? 0;
    expect(carrier).toBeGreaterThanOrEqual(0);
    expect(stripped && Math.abs(s.players[carrier]!.position(stripped.at).y - Gridiron.y(94)) < 1).toBe(true);
    expect(s.banner?.text).toBe("FUMBLE");
    expect(Math.abs(s.banner!.at - recovered)).toBeLessThan(0.1);
    expect(s.next.gain!).toBeLessThan(s.next.scrimmage ?? 0);
  });

  it("a college fumble kept: stripped at the 18, Texas A&M falls on it at the 22", () => {
    const s = FootballScript.play(cfbPlay("fumbled by #10 M.Reed at TAM18 forced by #90 L.Simmons")!);
    const takers = s.legs.flatMap((l) => (l.hand.kind === "carry" && !Number.isFinite(l.until) ? [l.hand.player] : []));
    expect(acting(s, "strip").length).toBe(1);
    expect(takers.every((i) => s.players[i]!.team === "offense")).toBe(true);
    expect(Math.abs(s.end!.y - Gridiron.y(22))).toBeLessThan(1);
  });

  it("a botched snap: on the ground at Goff's feet, he goes down after it, Green Bay recovers", () => {
    const s = FootballScript.play(proPlay("J.Goff FUMBLES (Aborted) at DET 41")!);
    expect(s.flights.filter((f) => f.end - f.start > 0.1).length).toBeGreaterThanOrEqual(2);
    expect(acting(s, "scramble").some((a) => s.players[a.player]!.role === "quarterback")).toBe(true);
    expect(s.banner?.text).toBe("FUMBLE");
  });

  it("a split sack: Alexander and Reese both get to Stroud", () => {
    const s = FootballScript.play(proPlay("sack split by D.Alexander and A.Reese")!);
    const qb = quarterback(s);
    const down = s.players[qb]!.holds.find((h) => h.kind === "down")?.from ?? 0;
    const sackers = acting(s, "tackle").filter((a) => Math.abs(a.at - down) < 0.3);
    expect(sackers.length).toBe(2);
    expect(sackers.every((a) => near(s.players[a.player]!.position(a.at), s.players[qb]!.position(a.at), 5))).toBe(true);
  });

  it("a blocked field goal: Wonnum up at the line, both arms high, the ball off his hands a beat after the kick and away: BLOCKED", () => {
    const s = FootballScript.play(proPlay("35 yard field goal is BLOCKED (D.Wonnum)")!);
    const leap = acting(s, "leap")[0];
    const off = s.flights.findIndex((f) => f.to.z > 7 && f.end - f.start < 0.3);
    expect(leap).toBeDefined();
    expect(off).toBeGreaterThanOrEqual(0);
    expect(Math.abs(s.flights[off]!.end - leap!.at)).toBeLessThan(0.01);
    expect(s.flights[off + 1]!.to.z).toBeLessThan(1);
    expect(s.score).toBeNull();
    expect(s.banner?.text).toBe("BLOCKED");
    expect(s.flashes.some((f) => f.beat === "deflect")).toBe(true);
  });

  it("a false start: no snap; the flag from the wing official, onto the lineman who moved; five yards walked off", () => {
    const s = FootballScript.play(proPlay("PENALTY on SEA-G.Zabel, False Start")!);
    const official = s.players.findIndex((p) => p.team === "official");
    expect(s.flashes.some((f) => f.beat === "snap")).toBe(false);
    expect(s.legs.some((l) => l.hand.kind === "carry")).toBe(false);
    expect(s.flags.length).toBe(1);
    expect(official >= 0 && Math.abs(s.players[official]!.at.x) > Gridiron.half).toBe(true);
    expect(acting(s, "flagThrow").length).toBe(1);
    expect(Math.abs(s.march!.to - s.march!.from - Gridiron.y(-5))).toBeLessThan(0.01);
  });

  it("holding on a run: the run plays out (Walker to the 39), the flag lands on Suamataia while it goes on; then walked off from where it was enforced (SEA 45) to KC's 45: \"Holding, Offense\"", () => {
    const hold = proPlay("K.Walker left tackle to SEA 39 for 6 yards (U.Nwosu).PENALTY on KC-K.Suamataia")!;
    const played = FootballScript.played(hold)!;
    const s = FootballScript.play(hold);
    const flag = s.flags[0];
    const tackle = s.flashes.find((f) => f.beat === "hit")?.at ?? 0;
    const fouler = s.players.findIndex((p) => p.key === hold.flags[0]?.player?.slot);
    expect(played.kind.type).toBe("rush");
    expect(played.to).toBe(61);
    expect(s.flights.length).toBeGreaterThanOrEqual(2);
    expect(flag!.thrown).toBeLessThan(tackle);
    expect(fouler).toBeGreaterThanOrEqual(0);
    expect(near(flag!.to, s.players[fouler]!.position(flag!.lands - 0.5), 4)).toBe(true);
    expect(Math.abs(s.march!.from - Gridiron.y(55))).toBeLessThan(0.01);
    expect(Math.abs(s.march!.to - Gridiron.y(45))).toBeLessThan(0.01);
    expect(tackle).toBeLessThan(s.march!.start);
    expect(footballStamp(hold).title).toBe("Holding, Offense · No play");
  });

  it("roughing the passer: the flag comes in on Goff just after the throw", () => {
    const s = FootballScript.play(proPlay("J.Goff pass incomplete short right to S.LaPorta.PENALTY on GB-B.Cox, Roughing the Passer")!);
    const qb = quarterback(s);
    const release = throwAt(s, qb);
    const flag = s.flags[0]!;
    expect(flag.lands).toBeGreaterThan(release);
    expect(flag.lands).toBeLessThan(release + 0.9);
    expect(near(flag.to, s.players[qb]!.position(release), 6)).toBe(true);
  });

  it("pass interference: the flag where the ball comes down, as it does", () => {
    const s = FootballScript.play(proPlay("PENALTY on CAR-A.Evans, Defensive Pass Interference")!);
    const pass = s.flights.find((f) => f.start > 1 && f.end - f.start > 0.3)!;
    const flag = s.flags[0]!;
    expect(Math.abs(flag.lands - (pass.end + 0.45))).toBeLessThan(0.05);
    expect(near(flag.to, pass.to, 6)).toBe(true);
  });

  it("a declined hold: the flag, DECLINED beside it, nothing walked off", () => {
    const s = FootballScript.play(proPlay("sack split by D.Alexander and A.Reese")!);
    expect(s.flags.length).toBe(1);
    expect(s.flags[0]!.declined).toBe(true);
    expect(s.march).toBeNull();
  });

  it("offsetting fouls: two flags from two officials, nothing walked off, NO PLAY", () => {
    const offsetting = proPlay("Penalty on KC-J.Ezeudu, Offensive Holding, offsetting")!;
    const s = FootballScript.play(offsetting);
    expect(s.flags.length).toBe(2);
    expect(s.march).toBeNull();
    expect(new Set(s.players.filter((p) => p.team === "official").map((p) => p.at.x)).size).toBe(2);
    expect(footballStamp(offsetting).parts.map((p) => p.text)).toEqual(["NO PLAY"]);
    expect(footballStamp(offsetting).title).toBe("Offsetting penalties");
  });

  it("unnecessary roughness after the whistle: the flag once the play's over, then the walk", () => {
    const s = FootballScript.play(proPlay("PENALTY on GB-D.Wyatt, Unnecessary Roughness")!);
    const tackle = s.flashes.find((f) => f.beat === "hit")?.at ?? 0;
    expect(s.flags[0]!.thrown).toBeGreaterThan(tackle);
    expect(s.march).not.toBeNull();
  });

  it("college's exact spots: caught at the 24, 17 yards downfield; thrown to the 22, 7 yards, where it comes down", () => {
    const caught = cfbPlay("#12 K.Russell pass complete short left to #7 R.Scott caught at TAM24")!;
    const thrown = cfbPlay("pass incomplete short middle to #4 D.Hill thrown to TAM22")!;
    const pass = FootballScript.play(caught).flights.find((f) => f.start > 1 && f.end - f.start > 0.3)!;
    const miss = FootballScript.play(thrown).flights.find((f) => f.start > 1 && f.end - f.start > 0.3)!;
    expect(Math.abs(pass.to.y - Gridiron.y(caught.from + 17))).toBeLessThan(0.01);
    expect(Math.abs(miss.to.y - Gridiron.y(thrown.from + 7))).toBeLessThan(0.01);
  });

  it("the ball in both hands in the pocket, in his throwing hand once he cocks it, until it's away", () => {
    const s = FootballScript.play(proPlay("P.Mahomes pass incomplete deep right to X.Worthy [D.Hall]")!);
    const qb = quarterback(s);
    const release = throwAt(s, qb);
    const player = s.players[qb]!;
    expect([cocked(player, release - 0.6), cocked(player, release - 0.15), cocked(player, release - 0.02), cocked(player, release + 0.2)]).toEqual([0, 1, 1, 0]);
  });

  const all = [...college, ...nfl].flatMap((g) => g.items.flatMap((i) => parse(i, g.teams) ?? []));
  const scripts = all.map((scene) => [scene, FootballScript.play(scene)] as const);

  it("every play of two college games and the NFL's turnovers, hits and flags: finite, the ball never under the grass, 2–12.5 s (a kick and its return, slowed)", () => {
    const insane = scripts.filter(([, s]) => {
      for (let k = 0; k * 0.1 <= s.duration; k++) {
        const t = k * 0.1;
        if (!s.players.every((p) => Number.isFinite(p.position(t).x) && Number.isFinite(p.position(t).y))) return true;
        const b = s.ball(t);
        if (b && !(Number.isFinite(b.x) && Number.isFinite(b.y) && b.z >= -0.01)) return true;
      }
      return !(s.duration > 2 && s.duration < 12.5 && s.stamp < s.settle);
    });
    expect(insane.slice(0, 3).map(([scene, s]) => `${scene.text.slice(0, 50)} ${s.duration}`)).toEqual([]);
  });

  it("the new poses (the strip, the scramble, the hit, the leap, the flag thrown), every blend: knees and elbows bend their own way", { timeout: 120_000 }, () => {
    const broken = scripts
      .filter(([scene]) => scene.flags.length > 0 || scene.loose != null || scene.pressure != null || scene.blocker != null)
      .flatMap(([scene, s]) => {
        const where = jointsBreak(s.duration, s.players.length, (i, t) => playerPose(s, s.players[i]!, i, t, s.players[i]!.position(t), 1.1 / 8.5)[0]);
        return where ? [`${scene.text.slice(0, 30)}: ${where}`] : [];
      });
    expect(broken.slice(0, 3)).toEqual([]);
  });
});
