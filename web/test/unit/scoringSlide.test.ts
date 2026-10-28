/**
 * The scoring slide (ScoringSlideTests.swift), checked on the same real
 * games: World Series Games 2 and 3 (ESPN's plays), Statcast's at-bats,
 * Monday Night Football, the Premier League goals the soccer theater replays,
 * NY at BOS (the Mac's nba-plays-401909095.json), the recorded CS2 series
 * (G2 0–2 NAVI) and a recorded lead route: which moments slide (and which
 * never do), the headline and subline per sport, the side it comes in from,
 * the tier, the paint, the theater's climax, who plays the burst, the motion
 * and the line.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRound, climbingMoments, surname, type ClimbingState } from "../../src/data/climbing";
import { csMoments } from "../../src/data/cs2";
import type { MapResult } from "../../src/data/gameDetail";
import type { JSONValue } from "../../src/data/json";
import { baseballMoment } from "../../src/data/liveFeeds/baseball";
import { BasketballFeed, type Teams as CourtTeams } from "../../src/data/liveFeeds/basketball";
import { footballMoment, footballPlay, scoreBefore, type FootballTeams } from "../../src/data/liveFeeds/football";
import { actionMoment, pitchAction, type PitchAction } from "../../src/data/liveFeeds/soccer";
import { beatFinal, beatScore, NO_BEATS } from "../../src/data/matchRules";
import { parse as parsePlay } from "../../src/data/mlb/playScene";
import { PlayScript } from "../../src/data/mlb/playScript";
import { statcastAtBats, type StatcastBatted } from "../../src/data/mlb/statcast";
import type { CSLive, Side } from "../../src/data/models";
import { liveMoment, MomentCenter, Tier, type LiveMoment } from "../../src/data/moments";
import {
  footballAttempt,
  inkContrast,
  labDistance,
  makeSlide,
  minuteMark,
  playClimax,
  footballClimax,
  soccerClimax,
  basketballClimax,
  playsConfetti,
  POSE_HOME,
  readBaseballPlay,
  scoredLine,
  slideEdge,
  slideHold,
  SlideLine,
  slideLength,
  SlideMotion,
  slidePaint,
  slidePose,
  SlideTier,
  smallInk,
  spokenMinute,
  teamPaint,
  type ScoringSlide,
  type SlideContext,
  type SlideTeam,
} from "../../src/data/scoringSlide";
import { oklabFromHex } from "../../src/data/teamColors";
import { parse as parseFootball } from "../../src/data/theater/footballScene";
import { FootballScript } from "../../src/data/theater/footballScript";
import { parseScene as parseCourt } from "../../src/data/theater/basketballScene";
import { BasketballScript } from "../../src/data/theater/basketballScript";
import { keepers, parse as parseSoccer } from "../../src/data/theater/soccerScene";
import { SoccerScript } from "../../src/data/theater/soccerScript";
import type { Climber, WallRoute } from "../../src/data/wallState";
import { fixture } from "./fixtures";

const say = (s: ScoringSlide | null) => (s ? `${s.headline} | ${s.chip ?? "-"} | ${s.subline} | ${s.score ?? "-"} | ${s.spoken}` : "null");
const mac = (name: string) => JSON.parse(readFileSync(join(import.meta.dirname, "../../../Tests/Fixtures", name), "utf8")) as Record<string, unknown>;
const idOf = (p: unknown) => (p as { id?: string }).id;

const brewers: SlideTeam = { name: "Brewers", abbreviation: "MIL", color: "12284b", alternate: "ffc52f" };
const rays: SlideTeam = { name: "Rays", abbreviation: "TB", color: "092c5c", alternate: "8fbce6" };

describe("reading a run-scoring play", () => {
  it("a grand slam's runners, listed: McMahon, Jones and Goldschmidt score", () => {
    const listed = readBaseballPlay("Rice homered to right (408 feet), McMahon, Jones, and Goldschmidt scored.");
    expect(listed.scorers).toEqual(["McMahon", "Jones", "Goldschmidt"]);
    expect(scoredLine(listed.scorers)).toBe("McMahon, Jones and Goldschmidt score");
    expect(listed.feet).toBe(408);
  });

  it("a runner who moved up isn't a scorer; two scorers joined by and", () => {
    expect(readBaseballPlay("Pratt doubled to left, Frelick scored, Yelich to third.").scorers).toEqual(["Frelick"]);
    expect(readBaseballPlay("Chourio singled to center, Turang and Yelich scored.").scorers).toEqual(["Turang", "Yelich"]);
  });
});

// MARK: Baseball, Game 3 (MIL at TB: the Brewers bat first, on the left)

describe("baseball: World Series Game 3", () => {
  // The fixture is trimmed to what the theater reads; the live feed's
  // scoring flag and running score go back on from each play's runs.
  let away = 0;
  let home = 0;
  const g3 = (fixture("mlb-ws-g3-plays.json") as { items: Record<string, unknown>[] }).items.map((item) => {
    const runs = item.scoreValue as number | undefined;
    if ((item.type as { type?: string } | undefined)?.type !== "play-result" || !runs || runs <= 0) return item;
    if ((item.period as { type?: string }).type === "Top") away += runs;
    else home += runs;
    return { ...item, scoringPlay: true, homeScore: home, awayScore: away };
  });
  const side = (id: string | null | undefined): Side | null => (id === "8" ? "top" : id === "30" ? "bottom" : null);
  const context: SlideContext = { top: brewers, bottom: rays };
  const moments = g3.flatMap((item) => baseballMoment(item, side) ?? []);
  const slides = moments.flatMap((m) => makeSlide(m, context) ?? []);
  const slideOf = (id: string) => slides.find((s) => s.id === id) ?? null;

  it("every run-scoring play slides (9), and nothing else: no strikeouts, outs or hits without a run", () => {
    const runPlays = g3.filter((p) => p.scoringPlay === true);
    expect(runPlays).toHaveLength(9);
    expect(slides).toHaveLength(runPlays.length);
  });

  it("Yelich's RBI single: the Brewers' bar from the left, said once", () => {
    const yelich = slideOf("4019080440404990057");
    expect(say(yelich)).toBe("RBI SINGLE | +1 | Yelich singles to left · Chourio scores | MIL 1–0 | Brewers RBI single, Yelich, 1 run, Brewers lead 1 to 0");
    expect(yelich?.side).toBe("top");
    expect(yelich && slideEdge(yelich)).toBe("leading");
    expect(yelich?.tier).toBe(SlideTier.normal);
  });

  it("two runs on an infield single: 2-RUN SINGLE, +2, both runners named; Pratt's 2-run double", () => {
    const turang = slideOf("4019080440806990057");
    expect(turang?.headline).toBe("2-RUN SINGLE");
    expect(turang?.chip).toBe("+2");
    expect(turang?.subline).toBe("Turang reaches on infield single to shortstop · Chourio and Yelich score");
    const pratt = slideOf("4019080440808990057");
    expect(pratt?.headline).toBe("2-RUN DOUBLE");
    expect(pratt?.subline).toBe("Pratt doubles to left · Mitchell and Turang score");
  });

  it("a Rays run comes in from the right, their number first (TB 1–10), and says who leads", () => {
    const diaz = slideOf("4019080441704990057");
    expect(diaz?.headline).toBe("RBI DOUBLE");
    expect(diaz?.side).toBe("bottom");
    expect(diaz && slideEdge(diaz)).toBe("trailing");
    expect(diaz?.score).toBe("TB 1–10");
    expect(diaz?.spoken.endsWith("Brewers lead 10 to 1")).toBe(true);
  });

  it("a run that isn't a hit: an error, and two on one play", () => {
    const error = {
      id: "e1",
      type: { type: "play-result" },
      alternativeType: { type: "reached-on-error" },
      text: "Pratt scored on error, Hamilton safe at first on fielding error by first baseman Aranda, Frelick to second.",
      scoringPlay: true,
      scoreValue: 1,
      team: { id: "8" },
      period: { type: "Top", number: 7 },
      homeScore: 4,
      awayScore: 3,
    };
    const one = makeSlide(baseballMoment(error, side)!, context);
    expect(one?.headline).toBe("RUN SCORES");
    expect(one?.subline.endsWith("Pratt scores")).toBe(true);
    expect(one?.subline.startsWith("Hamilton safe at first")).toBe(true);
    const two = makeSlide(baseballMoment({ ...error, scoreValue: 2, text: "Pratt scored and Turang scored on error, Hamilton safe at first." }, side)!, context);
    expect(two?.headline).toBe("2 RUNS SCORE");
    expect(two?.chip).toBe("+2");
  });
});

// MARK: Baseball, Game 2 (TB at MIL): home runs, with Statcast

describe("baseball: World Series Game 2's home runs", () => {
  const g2 = (fixture("mlb-ws-g2-summary-plays.json") as { plays: Record<string, unknown>[] }).plays;
  const side = (id: string | null | undefined): Side | null => (id === "30" ? "top" : id === "8" ? "bottom" : null);
  const context: SlideContext = { top: rays, bottom: brewers };
  const item = (id: string) => g2.find((p) => p.id === id)!;
  const hicksMoment = baseballMoment(item("4019080430005990057"), side)!;

  it("Hicks' two-run homer: baseball's own headline (2-RUN HOMER), +2, ESPN's 411 ft, a big slide", () => {
    const hicks = makeSlide(hicksMoment, context);
    expect(hicks?.headline).toBe("2-RUN HOMER");
    expect(hicks?.short).toBeNull();
    expect(hicks?.chip).toBe("+2");
    expect(hicks?.subline).toBe("Hicks · 411 ft · Caminero scores");
    expect(hicks?.score).toBe("TB 4–0");
    expect(hicks?.tier).toBe(SlideTier.big);
    expect(hicks?.side).toBe("top");
    expect(hicks?.spoken).toBe("Rays 2-run homer, Hicks, 2 runs, Rays lead 4 to 0");
  });

  it("with Statcast: its distance and exit velocity (EV, as Statcast labels it) in the subline", () => {
    const batted = statcastAtBats(fixture("statcast-849804.json"))
      .flatMap((a) => (a.batted ? [a.batted] : []))
      .reduce<StatcastBatted | null>((best, b) => (best == null || (b.distance ?? 0) > (best.distance ?? 0) ? b : best), null);
    expect(batted?.distance).toBe(413);
    expect(makeSlide(hicksMoment, context, batted)?.subline).toBe("Hicks · 413 ft · EV 111.4 mph · Caminero scores");
  });

  it("Frelick's solo shot (the Brewers at home: from the right) ties it", () => {
    const frelick = makeSlide(baseballMoment(item("4019080431101990057"), side)!, context);
    expect(frelick?.headline).toBe("HOME RUN");
    expect(frelick?.chip).toBe("+1");
    expect(frelick?.subline).toBe("Frelick · 408 ft");
    expect(frelick?.side).toBe("bottom");
    expect(frelick && slideEdge(frelick)).toBe("trailing");
    expect(frelick?.score).toBe("MIL 4–4");
    expect(frelick?.spoken.endsWith("tied 4 to 4")).toBe(true);
  });

  it("a grand slam: the top tier (confetti, a longer hold), every runner named; a walk-off home run: the top tier", () => {
    const slam = { ...item("4019080430005990057"), scoreValue: 4, awayScore: 6, text: "Hicks homered to right center (411 feet), Caminero scored, Díaz scored and Simpson scored." };
    const grand = makeSlide(baseballMoment(slam, side)!, context);
    expect(grand?.headline).toBe("GRAND SLAM");
    expect(grand?.chip).toBe("+4");
    expect(grand?.tier).toBe(SlideTier.top);
    expect(grand && slideHold(grand)).toBe(6);
    expect(grand?.subline).toBe("Hicks · 411 ft · Caminero, Díaz and Simpson score");
    const walkOff = { ...item("4019080431101990057"), period: { type: "Bottom", number: 11 }, homeScore: 5 };
    const walk = makeSlide(baseballMoment(walkOff, side)!, context);
    expect(walk?.headline).toBe("WALK-OFF HOME RUN");
    expect(walk?.short).toBe("WALK-OFF HR");
    expect(walk?.tier).toBe(SlideTier.top);
  });
});

// MARK: Football: Monday Night Football (DAL at PHI: Dallas on the left)

describe("football: Monday Night Football", () => {
  const mnf = fixture("mnf-dal-phi-plays.json") as { items: Record<string, unknown>[] };
  const items = mnf.items;
  const teams: FootballTeams = { topIsHome: false, topID: "6", bottomID: "21", homeAbbreviation: "PHI", awayAbbreviation: "DAL" };
  const plays = items.flatMap((i) => footballPlay(i, teams) ?? []).sort((a, b) => a.sequence - b.sequence);
  const context: SlideContext = {
    top: { name: "Cowboys", abbreviation: "DAL", color: "002a5c", alternate: "b0b7bc" },
    bottom: { name: "Eagles", abbreviation: "PHI", color: "06424d", alternate: "000000" },
  };
  const moments = plays.flatMap((p) => footballMoment(p, scoreBefore(p, plays), false) ?? []);
  const slides = moments.flatMap((m) => makeSlide(m, context) ?? []);
  const fb = (suffix: string) => slides.find((s) => s.id.endsWith(suffix)) ?? null;

  it("every score in the game slides (7 touchdowns, 3 field goals), and no other play does (big plays, sacks, turnovers)", () => {
    const scores = items.filter((i) => i.scoringPlay === true);
    expect(scores).toHaveLength(10);
    expect(slides).toHaveLength(scores.length);
    expect(moments.length).toBeGreaterThan(60);
  });

  it("Pierce's touchdown: the Eagles' bar from the right, +7 with the kick, said with the try", () => {
    const pierce = fb("1152");
    expect(say(pierce)).toBe("TOUCHDOWN | +7 | D. Pierce 5-yd run · PAT good | PHI 14–10 | Eagles touchdown, D. Pierce 5-yard run, extra point good, Eagles lead 14 to 10");
    expect(pierce?.side).toBe("bottom");
    expect(pierce?.tier).toBe(SlideTier.big);
  });

  it("a passing touchdown names the passer; the two-point run makes it +8", () => {
    const lamb = fb("3048");
    expect(lamb?.chip).toBe("+8");
    expect(lamb?.subline).toBe("C. Lamb 16-yd pass from D. Prescott · 2-pt conversion good");
    expect(lamb?.score).toBe("DAL 28–21");
    expect(lamb?.side).toBe("top");
  });

  it("a 55-yard field goal: a normal slide", () => {
    const aubrey = fb("9213");
    expect(aubrey?.headline).toBe("FIELD GOAL");
    expect(aubrey?.chip).toBe("+3");
    expect(aubrey?.subline).toBe("B. Aubrey from 55 yards");
    expect(aubrey?.tier).toBe(SlideTier.normal);
  });

  it("a pick six and a late go-ahead touchdown: the top tier; a safety is the defense's", () => {
    const pick = makeSlide(liveMoment({ id: "pick", chart: "field", tier: Tier.score, kind: "touchdown", lead: "Touchdown", detail: "Quinyon Mitchell 38 Yd Interception Return (Jake Elliott Kick)", side: "bottom" }), context);
    expect(pick?.headline).toBe("PICK SIX");
    expect(pick?.tier).toBe(SlideTier.top);
    expect(pick?.chip).toBe("+7");
    expect(pick?.subline).toBe("Q. Mitchell 38-yd interception return · PAT good");
    const late = makeSlide(liveMoment({ id: "late", chart: "field", tier: Tier.score, kind: "touchdown", lead: "Touchdown", detail: "Saquon Barkley 8 Yd Rush (Kick Failed)", side: "bottom", accents: ["decisive"] }), context);
    expect(late?.headline).toBe("GO-AHEAD TOUCHDOWN");
    expect(late?.short).toBe("GO-AHEAD TD");
    expect(late?.tier).toBe(SlideTier.top);
    expect(late?.chip).toBe("+6");
    expect(late?.subline.endsWith("PAT no good")).toBe(true);
    const safety = makeSlide(liveMoment({ id: "s", chart: "field", tier: Tier.score, kind: "safety", lead: "Safety", detail: "Team Safety", side: "top" }), context);
    expect(safety?.headline).toBe("SAFETY");
    expect(safety?.chip).toBe("+2");
    expect(safety?.side).toBe("bottom");
  });

  it("the try: a kick, good or not; two points by pass or run, good or not", () => {
    expect(footballAttempt("Two-Point Pass Conversion Failed")).toEqual({ kind: "twoPoint", good: false, pass: true });
    expect(footballAttempt("Jake Elliott Kick")).toEqual({ kind: "kick", good: true });
    expect(footballAttempt("Kick Failed")).toEqual({ kind: "kick", good: false });
  });

  it("the slide lands as the ball crosses the goal line (read from the theater's script)", () => {
    const scene = parseFootball(items.find((i) => idOf(i)?.endsWith("1152")), teams)!;
    const script = FootballScript.play(scene);
    const at = footballClimax(script);
    expect(at).toBeGreaterThan(0.5);
    expect(at).toBeLessThan(script.duration);
  });
});

// MARK: Soccer: the theater's goals

describe("soccer: the theater's goals", () => {
  const data = fixture("soccer-theater-plays.json") as { matches: { home: Record<string, unknown>; away: Record<string, unknown>; clips: JSONValue[][] }[] };
  const goals = new Map<string, { action: PitchAction; context: SlideContext; plays: JSONValue[]; home: string | null }>();
  for (const match of data.matches) {
    const team = (t: Record<string, unknown>): SlideTeam => ({ name: (t.name as string) ?? "", abbreviation: (t.abbreviation as string) ?? "", color: (t.color as string) ?? null, alternate: (t.alternateColor as string) ?? null });
    const context: SlideContext = { top: team(match.home), bottom: team(match.away) };
    const home = (match.home.id as string) ?? null;
    for (const clip of match.clips) {
      clip.forEach((item, i) => {
        const action = pitchAction(item, i, home);
        if (action?.kind === "goal") goals.set(action.playID, { action, context, plays: clip, home });
      });
    }
  }
  const goal = (id: string, change: Partial<PitchAction> = {}) => {
    const g = goals.get(id);
    if (!g) return null;
    const m = actionMoment({ ...g.action, ...change });
    return m ? makeSlide(m, g.context) : null;
  };

  it("every goal slides", () => {
    expect(goals.size).toBe(15);
    for (const id of goals.keys()) expect(goal(id), id).not.toBeNull();
  });

  it("Haaland's header: scorer, how, the assist and the minute; the away side from the right; said with the minute and the score", () => {
    const haaland = goal("54149975");
    expect(haaland?.headline).toBe("GOAL");
    expect(haaland?.chip).toBe("+1");
    expect(haaland?.subline).toBe("Erling Haaland · header · assisted by Iliman Ndiaye · 52'");
    expect(haaland?.score).toBe("MNC 1–1");
    expect(haaland?.side).toBe("bottom");
    expect(haaland?.tier).toBe(SlideTier.big);
    expect(haaland?.spoken).toBe("Manchester City goal, Erling Haaland, header, assisted by Iliman Ndiaye, 52nd minute, tied 1 to 1");
  });

  it("an own goal (the line says whose it is), a penalty, the foot when the line says", () => {
    const own = goal("54194895");
    expect(own?.headline).toBe("OWN GOAL");
    expect(own?.side).toBe("bottom");
    expect(own?.subline).toBe("Mike Penders, Chelsea · 77'");
    expect(own?.score).toBe("TOT 1–0");
    const pen = goal("54275717");
    expect(pen?.headline).toBe("PENALTY");
    expect(pen?.subline).toBe("Oliver McBurnie · penalty · 24'");
    expect(pen?.side).toBe("top");
    expect(goal("54146134")?.subline).toBe("Nicolas Jackson · right foot · assisted by John McGinn · 6'");
  });

  it("minutes as soccer writes them: 37', 90+3' (said: the 93rd minute)", () => {
    expect(minuteMark("90'+3'")).toBe("90+3'");
    expect(minuteMark("37'")).toBe("37'");
    expect(spokenMinute("90'+3'")).toBe("93rd minute");
  });

  it("the same header at 88': a late equalizer, the top tier", () => {
    const equalizer = goal("54149975", { clockSeconds: 88 * 60 });
    expect(equalizer?.headline).toBe("LATE EQUALIZER");
    expect(equalizer?.short).toBe("EQUALIZER");
    expect(equalizer?.tier).toBe(SlideTier.top);
  });

  it("the slide lands as the ball hits the net (read from the theater's script)", () => {
    const g = goals.get("54149975")!;
    const i = g.plays.findIndex((p) => idOf(p) === "54149975");
    const scene = parseSoccer(g.plays, i, g.home, keepers(g.plays))!;
    expect(soccerClimax(SoccerScript.build(scene))).toBeGreaterThan(0.5);
  });
});

// MARK: NBA: NY at BOS, look by look as the page polls it

describe("NBA: NY at BOS", () => {
  const game = (mac("nba-plays-401909095.json").items as JSONValue[]) ?? [];
  const teams: CourtTeams = { topIsHome: false, topID: "18", bottomID: "2", topName: "NY", bottomName: "BOS" };
  const context: SlideContext = { top: { name: "Knicks", abbreviation: "NY" }, bottom: { name: "Celtics", abbreviation: "BOS" } };
  const feed = new BasketballFeed(() => 1000);
  const window = (end: number) => game.slice(Math.max(0, end - 149), end + 1);
  feed.ingest(window(10), 0, teams);
  feed.takeMoments();
  const moments: LiveMoment[] = [];
  for (let end = 12; end < game.length; end += 2) {
    feed.ingest(window(end), Math.max(0, end - 149), teams);
    moments.push(...feed.takeMoments());
  }
  const slides = moments.flatMap((m) => makeSlide(m, context) ?? []);

  it("never every basket: only buzzer-beaters, clutch go-aheads and big runs slide", () => {
    const makes = moments.filter((m) => m.kind === "made");
    expect(makes.length).toBeGreaterThan(60);
    expect(slides.length).toBeLessThanOrEqual(6);
    expect(slides.every((s) => s.headline === "BUZZER-BEATER" || s.headline.startsWith("GO-AHEAD") || s.headline.endsWith(" RUN"))).toBe(true);
  });

  it("George's three at the end of the half: a buzzer-beater, the top tier, the Celtics' from the right", () => {
    const george = slides.find((s) => s.id === idOf(game[231])) ?? null;
    expect(george?.headline).toBe("BUZZER-BEATER");
    expect(george?.chip).toBe("+3");
    expect(george?.tier).toBe(SlideTier.top);
    expect(george?.side).toBe("bottom");
    expect(george?.subline.endsWith("end of Q2")).toBe(true);
    expect(george?.score).toBe("BOS 50–49");
  });

  it("timed to the court's theater: George's three drops through the net this far into its replay", () => {
    const george = slides.find((s) => s.id === idOf(game[231])) ?? null;
    const scene = parseCourt(game, 231, teams);
    const swish = scene ? basketballClimax(BasketballScript.play(scene)) : null;
    console.log(`    NBA: the slide lands as the ball drops through the net (${(swish ?? -1).toFixed(2)} s into the theater's replay)`);
    expect(scene?.id).toBe(george?.id);
    expect(swish).toBeGreaterThan(0.3);
  });

  it("an 8–0 run doesn't slide (12 or more do); a 14–2 run: a normal slide, no chip; a clutch go-ahead", () => {
    const hart = moments.find((m) => m.kind === "run");
    expect(hart?.lead).toBe("8–0 run");
    expect(makeSlide(hart!, context)).toBeNull();
    const run = makeSlide({ ...liveMoment({ id: "run", chart: "court", tier: Tier.swing, kind: "run", lead: "14–2 run", detail: "NY · Josh Hart 10-ft two point shot", side: "top" }), facts: { top: 61, bottom: 52 } }, context);
    expect(run?.headline).toBe("14–2 RUN");
    expect(run?.chip).toBeNull();
    expect(run?.subline).toBe("Josh Hart 10-ft two point shot");
    expect(run?.score).toBe("NY 61–52");
    expect(run?.tier).toBe(SlideTier.normal);
    const goAhead = makeSlide(
      { ...liveMoment({ id: "ga", chart: "court", tier: Tier.swing, kind: "leadChange", lead: "Lead change", detail: "Jalen Brunson 15-ft pullup jump shot · NY 96–95", side: "top", accents: ["clutch"] }), facts: { top: 96, bottom: 95, value: 2, clock: "1:12", period: 4 } },
      context,
    );
    expect(goAhead?.headline).toBe("GO-AHEAD BASKET");
    expect(goAhead?.subline).toBe("Jalen Brunson 15-ft pullup jump shot · Q4 1:12");
    expect(goAhead?.tier).toBe(SlideTier.big);
  });
});

// MARK: CS2: G2 0–2 NAVI (Nuke 11–13, Dust II 19–22)

describe("CS2: G2 0–2 NAVI", () => {
  const live = (t: number, b: number, map: number, name: string, ended = false): CSLive => ({ mapName: name, mapNumber: map, round: t + b, topScore: t, bottomScore: b, topSide: "CT", bottomSide: "T", mapEnded: ended });
  const series: MapResult[] = [
    { number: 1, name: "Nuke", topScore: 11, bottomScore: 13, winner: "bottom", live: false },
    { number: 2, name: "Dust II", topScore: null, bottomScore: null, winner: null, live: true },
    { number: 3, name: "Mirage", topScore: null, bottomScore: null, winner: null, live: false },
  ];
  const context: SlideContext = { top: { name: "G2", abbreviation: "G2" }, bottom: { name: "Natus Vincere", abbreviation: "NAVI", color: "fff200", alternate: "000000" }, maps: series };
  const names = { top: "G2", bottom: "Natus Vincere" };

  it("NAVI take Dust II and the series: MATCH WON, the map's score winner first, the maps; NAVI's yellow takes black type", () => {
    const won = makeSlide(csMoments(live(19, 21, 2, "Dust II"), live(19, 22, 2, "Dust II", true), names, series)[0]!, context);
    expect(won?.headline).toBe("MATCH WON");
    expect(won?.subline).toBe("Dust II 22–19 · maps 2–0");
    expect(won?.score).toBe("NAVI 2–0");
    expect(won?.tier).toBe(SlideTier.top);
    expect(won && slideEdge(won)).toBe("trailing");
    expect(won && slidePaint(won).lightInk).toBe(false);
  });

  it("a map won; a round never slides", () => {
    const firstMap = [{ ...series[0]!, topScore: null, bottomScore: null, winner: null, live: true }, series[1]!, series[2]!];
    const nuke = makeSlide(csMoments(live(11, 12, 1, "Nuke"), live(11, 13, 1, "Nuke", true), names, firstMap)[0]!, { ...context, maps: firstMap });
    expect(nuke?.headline).toBe("MAP WON");
    expect(nuke?.tier).toBe(SlideTier.big);
    expect(nuke?.subline).toBe("Nuke 13–11 · maps 1–0");
    const round = csMoments(live(5, 4, 2, "Dust II"), live(6, 4, 2, "Dust II"), names, series);
    expect(round).toHaveLength(1);
    expect(makeSlide(round[0]!, context)).toBeNull();
  });
});

// MARK: Climbing: a recorded route's climbers, in a final

describe("climbing: a recorded route, in a final", () => {
  const real = parseRound(fixture("ifsc-round-lead-qualification.json")).wall[0]?.climbers.filter((c) => !c.top) ?? [];
  const at = (c: Climber, height: number, top = false, onWall = false): Climber => ({ ...c, height, top, label: top ? "TOP" : String(Math.trunc(height)), rank: null, onWall });
  const done = real.slice(0, 5).map((c) => at(c, c.height));
  const climber = real[5]!;
  const round = (climbers: Climber[], name = "Final"): ClimbingState => ({ wall: [{ name: "1", climbers, total: 8 } satisfies WallRoute], boulders: [], boulderProblems: [], roundName: name });
  const before = round([...done, at(climber, climber.height, false, true)]);
  const ahead = round([...done, at(climber, real[0]!.height + 1, false, true)]);
  const context: SlideContext = { final: true, climbers: new Map([...done, climber].map((c) => [c.id, c])) };

  it("the recorded route loads", () => expect(real.length).toBeGreaterThanOrEqual(6));

  it("a new leader in a final: from the leading edge, in the climber's flag", () => {
    const lead = climbingMoments(before, ahead).flatMap((m) => makeSlide(m, context) ?? [])[0] ?? null;
    expect(lead?.headline).toBe("NEW LEADER");
    expect(lead?.chip).toBe("1ST");
    expect(lead?.subline.startsWith(`${climber.name} · passes `)).toBe(true);
    expect(lead?.spoken.startsWith(`New leader, ${climber.name}, passes `)).toBe(true);
    // The highest climber passed (the route's leaders tie on height).
    expect(done.filter((c) => c.height === real[0]!.height).some((c) => lead?.subline.endsWith(surname(c.name)))).toBe(true);
    expect(lead?.side).toBeNull();
    expect(lead?.flag).toBe("🇺🇸");
    expect(lead && slideEdge(lead)).toBe("leading");
  });

  it("a top in a final; nothing slides outside a final", () => {
    const topped = climbingMoments(before, round([...done, at(climber, 60, true, true)])).flatMap((m) => makeSlide(m, context) ?? [])[0] ?? null;
    expect(topped?.headline).toBe("TOP");
    expect(topped?.subline).toBe(`${climber.name} · new leader`);
    expect(topped?.tier).toBe(SlideTier.big);
    expect(climbingMoments(before, ahead).every((m) => makeSlide(m, { ...context, final: false }) == null)).toBe(true);
  });
});

// MARK: Paint

describe("paint", () => {
  const mil = teamPaint("12284b", "ffc52f");
  const tb = teamPaint("092c5c", "8fbce6");
  const newcastle = teamPaint("000000", "0B1B3D");
  const spurs = teamPaint("ffffff", "0B1426");
  const hull = teamPaint("f28800", "ffffff");
  const red = teamPaint("e20520", "003399");

  it("the Brewers' navy takes white type and a gold stripe; the Rays' navy too", () => {
    expect(mil.lightInk).toBe(true);
    expect(labDistance(mil.stripe, oklabFromHex("ffc52f")!)).toBeLessThan(0.02);
    expect(tb.lightInk).toBe(true);
    expect(inkContrast(mil)).toBeGreaterThanOrEqual(7);
  });

  it("white or black type, whichever reads (4:1 or better): orange takes black, red takes white", () => {
    expect(hull.lightInk).toBe(false);
    expect(red.lightInk).toBe(true);
    for (const p of [mil, tb, newcastle, spurs, hull, red]) expect(inkContrast(p)).toBeGreaterThanOrEqual(4);
  });

  it("black lifts to charcoal (or its second color); white stays white with dark type; no second color: a white stripe on a dark slab", () => {
    expect(newcastle.slab.l).toBeGreaterThanOrEqual(0.25);
    expect(spurs.slab.l).toBeGreaterThan(0.9);
    expect(spurs.lightInk).toBe(false);
    expect(teamPaint("002a5c", null).stripe.l).toBeGreaterThan(0.9);
  });

  it("web: the small type keeps the Mac's softer ink only where it still clears 4.5:1", () => {
    expect(smallInk(mil, 0.86)).toBe(0.86);
    for (const p of [mil, tb, newcastle, spurs, hull, red, teamPaint("ff6600", null), teamPaint("d00000", null)]) {
      const alpha = smallInk(p, 0.86);
      expect(alpha === 0.86 || alpha === 1).toBe(true);
    }
  });
});

// MARK: The theater's climax (baseball's, read from its script)

describe("the theater's climax", () => {
  it("baseball: as the home run clears the fence, and a run as it crosses the plate", () => {
    const g2 = (fixture("mlb-ws-g2-summary-plays.json") as { plays: unknown[] }).plays;
    const i = g2.findIndex((p) => idOf(p) === "4019080430005990057");
    const homer = parsePlay(g2, i, (id) => (id === "30" ? "top" : id === "8" ? "bottom" : null))!;
    expect(playClimax(PlayScript.play(homer, { bases: homer.basesAfter, bats: "L", swapped: false }))).toBeGreaterThan(0.5);
    const g3 = fixture("mlb-ws-g3-plays.json") as { items: unknown[]; names: Record<string, string> };
    const j = g3.items.findIndex((p) => idOf(p) === "4019080440404990057");
    const single = parsePlay(g3.items, j, (id) => (id === "8" ? "top" : id === "30" ? "bottom" : null), g3.names)!;
    expect(playClimax(PlayScript.play(single, { bases: single.basesAfter, bats: "L", swapped: false }))).toBeGreaterThan(0.5);
  });
});

// MARK: One celebration per moment

describe("one celebration per moment", () => {
  it("the page's burst plays where it's seen: in the theater or chart when it's on screen, else on the slide; never below the top tier", () => {
    expect(playsConfetti(SlideTier.top, true, true, true, () => true)).toBe(false);
    expect(playsConfetti(SlideTier.top, true, true, false, () => false)).toBe(true);
    expect(playsConfetti(SlideTier.big, true, true, false, () => true)).toBe(false);
  });

  it("a moment no chart bursts for (a match won) claims the cooldown; inside the cooldown, nobody bursts", () => {
    expect(playsConfetti(SlideTier.top, false, false, true, () => true)).toBe(true);
    expect(playsConfetti(SlideTier.top, false, false, false, () => false)).toBe(false);
    expect(playsConfetti(SlideTier.top, false, true, false, () => true)).toBe(false);
  });

  it("a claimed burst counts against the page's one every 10 s", () => {
    let clock = 0;
    const center = new MomentCenter({ wantsBurst: () => true, now: () => clock });
    const first = center.claimBurst();
    const second = center.claimBurst();
    clock += 10_000;
    expect([first, second, center.claimBurst()]).toEqual([true, false, true]);
  });

  it("a decisive score the slide carries: no hero glint under it, and the final whistle still knows it was celebrated", () => {
    const now = Date.now();
    const beats = beatScore(NO_BEATS, "top", true, now, false);
    expect(beats.glints).toBe(0);
    expect(beatFinal(beats, "top", false, false, now).glints).toBe(0);
  });
});

// MARK: Motion

describe("motion", () => {
  const hold = 4.5;

  it("the wipe: off at its edge, home (exactly) once landed, the sheen crossing after it lands, off the same way at the end", () => {
    const start = slidePose(0, hold, false);
    const mid = slidePose(0.6, hold, false);
    expect(start.slab).toBe(1);
    expect(start.stripe).toBe(1);
    expect(slidePose(1.05, hold, false)).toEqual(POSE_HOME);
    expect(mid.sheen).toBeGreaterThan(0);
    expect(mid.sheen).toBeLessThan(1);
    expect(slidePose(slideLength(hold), hold, false).slab).toBe(1);
  });

  it("the stripe leads the slab in", () => {
    const early = slidePose(0.15, hold, false);
    expect(early.stripe).toBeLessThan(early.slab);
  });

  it("Reduce Motion: a crossfade in place", () => {
    const fadeIn = slidePose(0, hold, true);
    const held = slidePose(2, hold, true);
    const fadeOut = slidePose(SlideMotion.land + hold + 0.25, hold, true);
    expect([fadeIn.opacity, fadeIn.slab, held.opacity, fadeOut.opacity, fadeOut.slab]).toEqual([0, 0, 1, 0, 0]);
  });
});

// MARK: The line

describe("the line", () => {
  const slide = (id: string, tier: SlideTier = SlideTier.normal): ScoringSlide => ({
    id,
    side: "top",
    tier,
    headline: "",
    short: null,
    chip: null,
    subline: "",
    score: null,
    spoken: "",
    team: null,
    flag: null,
    country: null,
    moment: liveMoment({ id, chart: "plate", tier: Tier.score, kind: "runScored", lead: "", detail: "" }),
    confetti: false,
  });

  it("scores arriving together play in order, one at a time; the same play never twice", () => {
    const line = new SlideLine();
    line.offer([slide("a"), slide("b")], false);
    line.offer([slide("a")], false);
    expect(line.waiting.map((s) => s.id)).toEqual(["a", "b"]);
    expect([line.next()?.id, line.next()?.id, line.next()]).toEqual(["a", "b", null]);
  });

  it("a catch-up plays only its newest (its top tier first); the rest never slide later", () => {
    const catchUp = new SlideLine();
    catchUp.offer([slide("1", SlideTier.top), slide("2"), slide("3"), slide("4")], true);
    const normal = new SlideLine();
    normal.offer([slide("1"), slide("2"), slide("3"), slide("4")], true);
    expect(catchUp.waiting.map((s) => s.id)).toEqual(["1"]);
    expect(normal.waiting.map((s) => s.id)).toEqual(["4"]);
    expect(catchUp.carries("3")).toBe(true);
  });

  it("at most three wait: the oldest normal slides give way; a score taken back leaves the line", () => {
    const full = new SlideLine();
    full.offer([slide("1"), slide("2", SlideTier.top), slide("3"), slide("4"), slide("5")], false);
    expect(full.waiting.map((s) => s.id)).toEqual(["2", "4", "5"]);
    full.retract(new Set(["4"]));
    expect(full.waiting.map((s) => s.id)).toEqual(["2", "5"]);
  });
});
