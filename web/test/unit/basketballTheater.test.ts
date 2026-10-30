/**
 * The basketball theater (BasketballTheaterTests.swift), check by check, on
 * the same three games (test/fixtures/nba-theater-plays.json, copied from
 * the Swift app's Tests/Fixtures: BKN at BOS in overtime, DET at NY, SAC at
 * SA, every core play ESPN sent but the substitutions and timeouts, trimmed
 * and normalized as the live lane keeps them). ESPN's plays parsed into
 * scenes (the kind, the move, the spot, who shot, passed, blocked, fouled;
 * the miss a putback came off, the steal a break came from), which replay,
 * the choreography (a three leaves the shooter's hand where ESPN put him and
 * drops through the net, a pass reaches his hands, a block meets the
 * blocker's), the broadcast camera, the stamp in the box score's words,
 * what's news, the court between plays, and one celebration per moment.
 */
import { describe, expect, it } from "vitest";
import { isFreeThrow } from "../../src/data/basketball";
import { BasketballFeed, type Teams } from "../../src/data/liveFeeds/basketball";
import { CameraFrame } from "../../src/data/mlb/playCamera";
import { fieldPoint, type FieldPoint } from "../../src/data/mlb/theaterField";
import { liveMoment, Tier, type LiveMoment } from "../../src/data/moments";
import { restOf, restScript } from "../../src/data/theater/basketballBeats";
import { basketballNext } from "../../src/data/theater/basketballFlow";
import { made, marqueeOf, parseScene, replays, surname, type BasketballScene } from "../../src/data/theater/basketballScene";
import { BasketballScript, basketballStamp, Hoops, view } from "../../src/data/theater/basketballScript";
import { BasketballCelebration, basketballTheaterState, BasketballTheaterWatch } from "../../src/data/theater/basketballTheater";
import { HoopProjection, playerPose } from "../../src/features/game/nba/theater/drawBasketball";
import { fixture } from "./fixtures";
import { jointsBreak } from "./rigJoints";

type Item = Record<string, unknown>;
interface Game {
  readonly items: Item[];
  readonly teams: Teams;
}

// ESPN lists the visitors first: the top team.
const games: Game[] = (fixture("nba-theater-plays.json") as { games: { items: Item[]; home: { id: string; abbreviation: string }; away: { id: string; abbreviation: string } }[] }).games.map((g) => ({
  items: g.items,
  teams: { topIsHome: false, topID: g.away.id, bottomID: g.home.id, topName: g.away.abbreviation, bottomName: g.home.abbreviation },
}));
const scenesOf = (g: Game) => g.items.flatMap((_, i) => parseScene(g.items, i, g.teams) ?? []);
const scene = (game: number, id: string): BasketballScene | null => {
  const g = games[game]!;
  const i = g.items.findIndex((p) => p.id === id);
  return i >= 0 ? parseScene(g.items, i, g.teams) : null;
};
const all = games.map(scenesOf);
const replayed = all.map((list) => list.filter(replays));
const flat = replayed.flat();
const scripts = flat.map((s) => BasketballScript.play(s));
const pairs = flat.map((s, i) => [s, scripts[i]!] as const);
const makes = pairs.filter(([s]) => made(s) && s.kind !== "freeThrow");
const range = (from: number, to: number, step: number) => {
  const out: number[] = [];
  for (let t = from; t <= to + 1e-9; t += step) out.push(t);
  return out;
};

const brown = scene(0, "401909877738");
const tatum = scene(0, "401909877843");
const white = scene(0, "401909877673");
const demin = scene(0, "40190987713");
const tip = scene(2, "401909879338");
const swat = scene(2, "40190987921");

describe("which plays replay", () => {
  it("every made field goal replays: 87, 75 and 89 of them, 251 of 251", () => {
    const madeFG = games.map((g) => g.items.filter((p) => p.shootingPlay === true && p.scoringPlay === true && !isFreeThrow(p)).length);
    const madeReplayed = replayed.map((list) => list.filter((s) => made(s) && s.kind !== "freeThrow").length);
    expect(madeFG).toEqual([87, 75, 89]);
    expect(madeReplayed).toEqual(madeFG);
    expect(madeReplayed.reduce((a, b) => a + b, 0)).toBe(251);
  });

  it("every block replays, as a block", () => {
    const blocks = games.map((g) => g.items.filter((p) => (p.participants as Item[] | undefined)?.some((x) => x.type === "blocker")).length);
    expect(blocks).toEqual([9, 13, 9]);
    expect(replayed.map((list) => list.filter((s) => s.kind === "block").length)).toEqual(blocks);
  });

  it("a steal or an offensive rebound never replays alone (the basket it led to carries it)", () => {
    const lead = all.flat().filter((s) => s.kind === "steal" || s.kind === "turnover" || s.kind === "offensiveRebound");
    expect(lead.every((s) => !replays(s))).toBe(true);
    expect(all.flat().some((s) => s.kind === "steal")).toBe(true);
    expect(all.flat().some((s) => s.kind === "offensiveRebound")).toBe(true);
  });

  it("a free throw replays only when it tied it or went ahead in the last 30 seconds", () => {
    const freeThrows = flat.filter((s) => s.kind === "freeThrow");
    expect(freeThrows.every((s) => s.lastShot && made(s) && (s.period ?? 0) >= 4)).toBe(true);
  });

  it("a miss replays only as a shot to tie or lead in the last 30 seconds: Chaney Johnson's three down three with 19.8 left", () => {
    const late = flat.filter((s) => !made(s) && s.kind !== "block");
    expect(late.every((s) => s.lastShot)).toBe(true);
    expect(late.some((s) => s.id === "401909877683")).toBe(true);
  });

  it("about a hundred replays a game, 284 across the three: one every half minute of play, not every play", () => {
    const perGame = replayed.map((list) => list.length);
    const late = flat.filter((s) => !made(s) && s.kind !== "block").length;
    const freeThrows = flat.filter((s) => s.kind === "freeThrow").length;
    console.log(`    replays: ${JSON.stringify(perGame)} (${late} late misses, ${freeThrows} free throws); made baskets replayed: 100%`);
    expect(perGame.every((n) => n >= 80 && n <= 120)).toBe(true);
    expect(perGame.reduce((a, b) => a + b, 0)).toBe(284);
  });
});

describe("kinds, moves and who", () => {
  it("Brown Jr.'s corner three with a second left, off Ellis's pass, ties it at the end of regulation: a buzzer-beater, decisive", () => {
    expect(brown?.kind).toBe("three");
    expect(brown?.move).toBe("catchAndShoot");
    expect(brown?.value).toBe(3);
    expect(brown?.points).toBe(3);
    expect(brown?.shooter?.name).toBe("Brown Jr.");
    expect(brown?.assister?.name).toBe("Ellis");
    expect(brown?.spot).toEqual({ x: 1, y: 1 });
    expect(brown?.buzzer && brown.decisive).toBe(true);
    expect(brown?.offense).toBe("top");
  });

  it("Tatum's turnaround with no time left in overtime wins it: a decisive buzzer-beater for the home team", () => {
    expect(tatum?.kind).toBe("jumper");
    expect(tatum?.move).toBe("turnaround");
    expect(tatum?.buzzer && tatum.decisive).toBe(true);
    expect(tatum?.assister?.name).toBe("White");
    expect(tatum?.offense).toBe("bottom");
    expect(tatum?.period).toBe(5);
  });

  it("White's cutting dunk through Clowney's foul: an and-one the data credits to a defender, so posterized", () => {
    expect(white?.kind).toBe("dunk");
    expect(white?.move).toBe("cut");
    expect(white?.andOne).toBe(true);
    expect(white?.fouler?.name).toBe("Clowney");
    expect(white && white.dunk && white.andOne && white.fouler != null && made(white)).toBe(true);
  });

  it("Demin's running dunk three seconds after he stole George's pass: the break carries the steal", () => {
    expect(demin?.kind).toBe("dunk");
    expect(demin?.steal?.stealer?.name).toBe("Demin");
    expect(demin?.steal?.loser?.name).toBe("George");
    expect(demin?.steal?.spot).not.toBeNull();
    expect(demin?.assister?.name).toBe("Porter Jr.");
  });

  it("Wembanyama's tip at the half off Castle's missed three: a putback and a buzzer-beater", () => {
    expect(tip?.kind).toBe("putback");
    expect(tip?.move).toBe("tip");
    expect(tip?.miss?.shooter?.name).toBe("Castle");
    expect(tip?.miss?.value).toBe(3);
    expect(tip?.buzzer).toBe(true);
  });

  it("Wembanyama blocking Sabonis's driving layup: the shot it stopped, the blocker and the shooter", () => {
    expect(swat?.kind).toBe("block");
    expect(swat?.shot).toBe("layup");
    expect(swat?.blocker?.name).toBe("Wembanyama");
    expect(swat?.shooter?.name).toBe("Sabonis");
    expect(swat?.result).toBe("blocked");
    expect(swat?.offense).toBe("top");
  });

  it("alley-oops replay as alley-oops, each with its passer", () => {
    const oops = flat.filter((s) => s.kind === "alleyOop");
    expect(oops.length).toBeGreaterThanOrEqual(8);
    expect(oops.every((s) => s.assister != null)).toBe(true);
    expect(oops.some((s) => s.dunk)).toBe(true);
  });

  it("putbacks come with the miss they came off", () => {
    const putbacks = flat.filter((s) => s.kind === "putback");
    expect(putbacks.length).toBeGreaterThanOrEqual(15);
    expect(putbacks.filter((s) => s.miss != null).length).toBeGreaterThanOrEqual(putbacks.length - 2);
  });

  it("baskets off a steal carry it", () => {
    const breaks = flat.filter((s) => s.steal != null);
    expect(breaks.length).toBeGreaterThanOrEqual(5);
    expect(breaks.every((s) => made(s) && s.steal?.stealer != null)).toBe(true);
  });

  it("every replayed play names its shooter and its team", () => {
    expect(flat.every((s) => (s.shooter?.name ?? "") !== "")).toBe(true);
    expect(flat.every((s) => s.offense != null)).toBe(true);
  });

  it("a stamp's name is the surname, its suffix kept", () => {
    expect(surname("Mikel Brown Jr.")).toBe("Brown Jr.");
    expect(surname("Ronald Holland II")).toBe("Holland II");
    expect(surname("Karl-Anthony Towns")).toBe("Towns");
    expect(surname("De'Aaron Fox")).toBe("Fox");
  });
});

describe("the stamp, in the box score's words", () => {
  const stamp = (s: BasketballScene | null): [string, readonly string[]] => {
    if (!s) return ["nil", []];
    const st = basketballStamp(s);
    return [st.parts.map((p) => p.text).join(" "), st.lines];
  };

  it("a three's: +3 3PT, the shot as the play-by-play names it with its distance in feet, the assist", () => {
    expect(stamp(brown)).toEqual(["+3 3PT", ["BROWN JR. · 23 FT JUMP SHOT", "AST ELLIS"]]);
  });

  it("a block's: BLK, the blocker, the shot he stopped", () => {
    const [parts, lines] = stamp(swat);
    expect(parts).toBe("BLK");
    expect(lines[0]).toBe("WEMBANYAMA");
    expect(lines[1]).toBe("SABONIS · DRIVING LAYUP SHOT");
  });

  it("a break's credits the assist and the steal; a dunk keeps no distance", () => {
    expect(stamp(demin)[1].at(-1)).toBe("AST PORTER JR. · STL DEMIN");
    expect(stamp(white)[1][0]).toBe("WHITE · CUTTING DUNK SHOT");
  });

  it("every replay has a stamp, in capitals", () => {
    expect(flat.every((s) => basketballStamp(s).parts.length > 0 && basketballStamp(s).lines.every((l) => l === l.toUpperCase()))).toBe(true);
  });
});

describe("choreography", () => {
  it("every replay: five on five on the floor, the ball never under it", () => {
    const bad = pairs.filter(([, s]) =>
      range(0, s.duration, 0.1).some((t) => {
        const off = s.players.some((p) => {
          const q = p.position(t);
          return !(Number.isFinite(q.x) && Number.isFinite(q.y) && q.x > -1 && q.x < 95 && q.y > 0 && q.y < 50);
        });
        const b = s.ball(t);
        return off || !(b != null && Number.isFinite(b.x) && b.z >= 0.3);
      }),
    );
    expect(bad.map(([s]) => s.text)).toEqual([]);
    expect(pairs.every(([, s]) => s.players.length === 10)).toBe(true);
  });

  it("every replay runs 3–9 s, its stamp landing before the court settles", () => {
    const lengths = pairs.map(([, s]) => s.duration);
    console.log(`    replays run ${Math.min(...lengths).toFixed(2)}–${Math.max(...lengths).toFixed(2)} s`);
    expect(lengths.every((d) => d > 3 && d < 9)).toBe(true);
    expect(pairs.every(([, s]) => Number.isFinite(s.stamp) && s.stamp < s.settle)).toBe(true);
  });

  const rim: FieldPoint = { x: Hoops.rim.x, y: Hoops.rim.y, z: Hoops.rimHeight };
  const gap = (a: FieldPoint | null, b: FieldPoint) => (a ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : Infinity);

  it("every make: released, and through the rim at the moment it scores (a full replay for every one)", () => {
    expect(makes.length).toBe(251);
    expect(makes.filter(([, s]) => !(s.score != null && gap(s.ball(s.score), rim) < 0.3)).map(([s]) => s.text)).toEqual([]);
    expect(makes.every(([, s]) => s.release != null)).toBe(true);
  });

  it("every jump shot leaves his hand where ESPN put him (a fadeaway's drift aside)", () => {
    const jumpers = pairs.filter(([s]) => (s.kind === "jumper" || s.kind === "three") && s.steal == null);
    const offSpot = jumpers.filter(([s, sc]) => {
      if (sc.release == null || !s.spot) return true;
      const at = sc.players[0]!.position(sc.release);
      const real = Hoops.court(s.spot);
      return Math.hypot(at.x - real.x, at.y - real.y) > 2.6;
    });
    expect(offSpot.slice(0, 3).map(([s]) => s.text)).toEqual([]);
  });

  it("every assisted basket: the pass reaches the shooter's hands where he is", () => {
    const assisted = makes.filter(([s]) => s.assister != null && s.steal == null);
    const unpassed = assisted.filter(([, sc]) => !sc.flights.some((f) => f.end <= (sc.release ?? 0) + 0.12 && Math.hypot(f.to.x - sc.players[0]!.position(f.end).x, f.to.y - sc.players[0]!.position(f.end).y) < 1.6));
    expect(unpassed.slice(0, 3).map(([s]) => s.text)).toEqual([]);
  });

  it("an alley-oop's lob comes down over the rim to a man in the air", () => {
    const lobs = pairs.filter(([s]) => s.kind === "alleyOop");
    expect(lobs.every(([, sc]) => sc.flights.some((f) => f.to.z >= Hoops.rimHeight && Math.hypot(f.to.x - Hoops.rim.x, f.to.y - Hoops.rim.y) < 3.5) && sc.players[0]!.jumps.some((j) => j.height >= 2.5))).toBe(true);
  });

  it("every block: a defender in the air at the ball as it's swatted", () => {
    const blocked = pairs.filter(([s]) => s.kind === "block");
    const unmet = blocked.filter(([, sc]) => {
      const flash = sc.flashes.find((f) => f.beat === "block");
      if (!flash) return true;
      return ![5, 6, 7, 8, 9].some((k) => {
        const p = sc.players[k]!.position(flash.at);
        return Math.hypot(p.x - flash.point.x, p.y - flash.point.y) < 3.2 && sc.players[k]!.lift(flash.at) > 1.2;
      });
    });
    expect(unmet.slice(0, 3).map(([s]) => s.text)).toEqual([]);
  });

  it("a miss or a block the data gives to a rebounder ends in his hands", () => {
    const rebounded = pairs.filter(([s]) => !made(s) && s.rebound?.person != null && s.kind !== "freeThrow");
    expect(rebounded.filter(([, sc]) => sc.carrier(sc.settle) == null).map(([s]) => s.text)).toEqual([]);
  });

  it("a break starts with the steal at the other end, where ESPN put it", () => {
    expect(pairs.filter(([s]) => s.steal?.spot != null).every(([, sc]) => (sc.flashes.find((f) => f.beat === "steal")?.point.x ?? 99) < Hoops.length / 2)).toBe(true);
  });

  it("a putback: the miss off the rim, then back in", () => {
    expect(pairs.filter(([s]) => s.kind === "putback").every(([, sc]) => sc.flashes.some((f) => f.beat === "rim") && sc.rimHit != null && sc.rimHit <= (sc.score ?? 0))).toBe(true);
  });

  it("each team shoots at the basket the shot chart puts it at: the top team →, the bottom ←", () => {
    const center = { x: Hoops.length / 2, y: Hoops.width / 2 };
    expect(
      pairs.every(([s, sc]) => {
        const r = view(Hoops.rim, sc.yaw).x;
        const c = view(center, sc.yaw).x;
        return s.offense === "bottom" ? r < c : r > c;
      }),
    ).toBe(true);
  });

  it("in every replay of the three games, knees and elbows bend only their own way, never past folded", () => {
    const broken = pairs.flatMap(([s, sc]) => {
      const where = jointsBreak(sc.duration, sc.players.length, (i, t) => playerPose(sc, sc.players[i]!, i, t, sc.players[i]!.position(t), 1.1 / Hoops.ground)[0]);
      return where ? [`${s.text.slice(0, 30)}: ${where}`] : [];
    });
    expect(broken.slice(0, 3)).toEqual([]);
  }, 120_000);
});

describe("camera", () => {
  const size = { width: 640, height: 320 };
  const inView = (sc: BasketballScript, p: FieldPoint, t: number) => {
    const q = new HoopProjection(size, sc.camera.frame(t), sc.yaw).at(p);
    return q.x > 0 && q.x < size.width && q.y > 0 && q.y < size.height;
  };
  const rim: FieldPoint = { x: Hoops.rim.x, y: Hoops.rim.y, z: Hoops.rimHeight };

  it("as the ball goes through, the rim and the shooter are in the shot", () => {
    expect(makes.every(([, sc]) => sc.score != null && sc.shooter != null && inView(sc, rim, sc.score) && inView(sc, fieldPoint(sc.players[sc.shooter]!.position(sc.score)), sc.score))).toBe(true);
  });

  it("at the rim the camera is close: a man and the rim, tighter than a ballpark's battery", () => {
    const close = makes.filter(([s]) => s.kind === "dunk" || s.kind === "layup");
    expect(close.every(([, sc]) => sc.score != null && sc.camera.frame(sc.score).span < 40)).toBe(true);
    expect(Hoops.tightest).toBeLessThan(CameraFrame.tightest);
  });

  it("the camera keeps everyone out of the stamp's corner while it's up, and at rest", () => {
    const covered = pairs.filter(([, sc]) =>
      [sc.stamp + 0.6, Infinity].some((t) => {
        const h = new HoopProjection(size, sc.camera.frame(t), sc.yaw);
        return sc.players.some((p) => {
          const q = h.point(p.position(t));
          return q.x < size.width * sc.corner.width * 0.9 && q.y > size.height * (1 - sc.corner.height * 0.9);
        });
      }),
    );
    expect(covered.slice(0, 3).map(([s]) => s.text)).toEqual([]);
  });

  it("every replay's camera comes to rest on where it ended", () => {
    expect(pairs.every(([, sc]) => JSON.stringify(sc.camera.frame(Infinity)) === JSON.stringify(sc.camera.rest))).toBe(true);
  });
});

describe("banners", () => {
  const banner = (s: BasketballScene | null) => (s ? (BasketballScript.play(s).banner?.text ?? "-") : "nil");

  it("the headlines: BUZZER-BEATER (gold when it tied or won it), POSTERIZED, REJECTED, DUNK, AND-ONE", () => {
    expect(banner(brown)).toBe("BUZZER-BEATER");
    expect(BasketballScript.play(brown!).banner?.tone.kind).toBe("gold");
    expect(banner(white)).toBe("POSTERIZED");
    expect(banner(swat)).toBe("REJECTED");
    expect(banner(demin)).toBe("DUNK");
    expect(banner(scene(1, "401909878474"))).toBe("AND-ONE");
  });

  it("a headline is for a marquee play: under half the replays get one", () => {
    const banners = pairs.filter(([, s]) => s.banner != null).length;
    console.log(`    headlines: ${banners} of ${pairs.length}`);
    expect(banners).toBeLessThan(pairs.length / 2);
  });
});

describe("news and the court between plays", () => {
  it("the lane's first look is history (nothing to tell: the court as it stands); the plays after it are news, told from the first of them", () => {
    const g0 = games[0]!;
    const feed = new BasketballFeed();
    const watch = new BasketballTheaterWatch();
    const look = () => watch.update(feed.items, g0.teams, feed.looks, (id) => feed.seenIn(id));
    feed.ingest(g0.items.slice(0, 41), 0, g0.teams);
    look();
    const first = watch.state;
    let next = 41;
    for (let i = 41; i < g0.items.length; i++) {
      const s = parseScene(g0.items, i, g0.teams);
      if (s && replays(s)) {
        next = i;
        break;
      }
    }
    feed.ingest(g0.items.slice(0, next + 1), 0, g0.teams);
    look();
    const fresh = new Set(g0.items.slice(41, next + 1).map((p) => p.id as string));
    const told = basketballNext(null, new Set(), watch.state);
    expect(first.plays.length).toBeGreaterThan(0);
    expect(first.news.size).toBe(0);
    expect(basketballNext(null, new Set(), first)).toBeNull();
    expect([...watch.state.news].sort()).toEqual(watch.state.plays.map((p) => p.id).filter((id) => fresh.has(id)).sort());
    expect(told != null && fresh.has(told.scene.id)).toBe(true);
    expect(marqueeOf(watch.state)?.id).toBe(g0.items[next]!.id);
  });

  it("a play that was news stays news through its edits", () => {
    const g0 = games[0]!;
    const plays = scenesOf(g0).slice(0, 10);
    const state = { plays, news: new Set(plays.slice(5).map((p) => p.id)), heard: 1 };
    expect([...basketballTheaterState(plays, state, 1, () => null, Date.now()).news].sort()).toEqual([...state.news].sort());
  });

  it("plays the look coming back to the page caught up on are history; those after it are news", () => {
    const plays = scenesOf(games[0]!).slice(0, 10);
    const old = { plays: [], news: new Set<string>(), heard: null };
    const seen = () => 6;
    const later = Date.now() + 3_600_000;
    expect(basketballTheaterState(plays, old, 6, seen, later, 6).news.size).toBe(0);
    expect([...basketballTheaterState(plays, old, 6, seen, later, 5).news].sort()).toEqual([...new Set(plays.map((p) => p.id))].sort());
  });

  it("between plays the team with the ball sets up in its half, the point guard with it; nobody's: round the center circle", () => {
    const rest = restScript(restOf({ offense: "bottom" }));
    const tipOff = restScript(restOf({ offense: null }));
    expect(rest.players.length).toBe(10);
    expect(rest.carrier(0)?.player).toBe(0);
    expect(rest.yaw).toBe(Hoops.yaw("bottom"));
    expect(Math.abs((tipOff.ball(0)?.x ?? 0) - Hoops.length / 2)).toBeLessThan(0.1);
  });
});

describe("one celebration per moment", () => {
  const buzzerBeater = (): LiveMoment => ({ ...liveMoment({ id: brown!.id, chart: "court", tier: Tier.score, kind: "made", value: 3, lead: "Buzzer-beater", detail: "", side: "top", accents: ["buzzer", "decisive"] }), burst: true });

  it("the shot chart bursts only when there's no theater to", () => {
    expect(BasketballCelebration.courtBursts(true)).toBe(false);
    expect(BasketballCelebration.courtBursts(false)).toBe(true);
  });

  it("a decisive buzzer-beater: sparks at the rim as it drops and the banner's confetti, in gold", () => {
    const script = BasketballScript.play(brown!);
    const bursts = BasketballCelebration.theater(buzzerBeater(), brown!, script, "full", false, 320);
    expect(bursts.length).toBe(2);
    expect(bursts.every((b) => b.cue.gold)).toBe(true);
    expect(bursts.some((b) => b.anchor.kind === "banner")).toBe(true);
    expect(bursts.every((b) => b.at + b.cue.delay >= (script.score ?? 0) - 0.01)).toBe(true);
  });

  it("nothing at Off, nor for another play's moment", () => {
    expect(BasketballCelebration.theater(buzzerBeater(), brown!, BasketballScript.play(brown!), "off", false, 320)).toEqual([]);
    expect(BasketballCelebration.theater(buzzerBeater(), tatum!, BasketballScript.play(tatum!), "full", false, 320)).toEqual([]);
  });

  it("a routine two gets the net, no particles", () => {
    const two = makes.find(([s]) => s.value === 2 && !s.buzzer && !s.clutch);
    expect(two).toBeDefined();
    const [s, sc] = two!;
    const m = liveMoment({ id: s.id, chart: "court", tier: Tier.routine, kind: "made", value: 2, lead: "Two", detail: "", side: s.offense });
    expect(BasketballCelebration.theater(m, s, sc, "full", false, 320)).toEqual([]);
  });
});
