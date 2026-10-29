/**
 * The soccer theater between its big moments (SoccerIdleTests.swift), check
 * by check, on the same real matches (test/fixtures/soccer-events-plays.json,
 * the Swift app's fixture: Aston Villa v Manchester City, Sunderland v
 * Leeds, Crystal Palace v Newcastle, Valencia v Villarreal): every event
 * ESPN logs parsed into what the theater shows (the corner and its side, the
 * foul and its spot, the man booked where he fouled, the substitution, the
 * man hurt, VAR's check and decision, the halves, the added time the
 * commentary announces), every shot a moment, a shot's spot and aim from its
 * words when ESPN didn't place it; and choreographed: the corner from its own
 * flag, the card at the foul, the ends changed at half time, the ball going
 * round the team that has it in its own formation, in sparse beats round a
 * loop, the tags saying what's happening.
 */
import { describe, expect, it } from "vitest";
import type { JSONValue } from "../../src/data/json";
import { POSTS } from "../../src/data/liveFeeds/soccer";
import type { Point } from "../../src/data/mlb/theaterField";
import { latestAddedTime } from "../../src/data/soccer";
import {
  addedShowing,
  idleRight,
  parseEvent,
  parseTouch,
  PitchFacing,
  soccerEvents,
  soccerIdle,
  soccerIdleScript,
  SoccerStatus,
  turnedScene,
  type SoccerEvent,
  type SoccerNames,
  type SoccerTouch,
} from "../../src/data/theater/soccerIdle";
import { aimFromWords, attacksRight, isMoment, keepers, parse, Pitch, SoccerLineup, spotFromWords, type Lineups, type SoccerScene, type SoccerTheaterState } from "../../src/data/theater/soccerScene";
import { SoccerScript } from "../../src/data/theater/soccerScript";
import { SoccerTheaterWatch } from "../../src/data/theater/soccerTheater";
import { fixture } from "./fixtures";

interface Match {
  readonly home: { readonly id: string };
  readonly rosters: JSONValue;
  readonly clips: Record<string, unknown>[][];
  readonly commentary: unknown[];
}

const matches = (fixture("soccer-events-plays.json") as { matches: Match[] }).matches;
const typeOf = (p: Record<string, unknown>) => String((p.type as { type?: string } | undefined)?.type ?? "");
const clockOf = (p: Record<string, unknown>) => String((p.clock as { displayValue?: string } | undefined)?.displayValue ?? "");
const textOf = (p: unknown) => String((p as { text?: string }).text ?? "");
const lineupsOf = (m: Match): Lineups => SoccerLineup.lineups(m.rosters, (team) => (team === m.home.id ? "top" : "bottom"));

interface Found {
  readonly event: SoccerEvent;
  readonly clip: Record<string, unknown>[];
  readonly index: number;
  readonly home: string;
  readonly lineups: Lineups;
}

/** The entry of this type at this minute (with words, if any are given), parsed as an event. */
function find(match: number, type: string, minute: string, clue = ""): Found | null {
  const m = matches[match]!;
  for (const clip of m.clips) {
    const i = clip.findIndex((p) => typeOf(p) === type && clockOf(p) === minute && (clue === "" || textOf(p).includes(clue)));
    if (i < 0) continue;
    const event = parseEvent(clip, i, m.home.id, i);
    if (!event) continue;
    return { event, clip, index: i, home: m.home.id, lineups: lineupsOf(m) };
  }
  return null;
}

const near = (a: Point | null | undefined, b: Point | null | undefined, tolerance: number) => a != null && b != null && Math.hypot(a.x - b.x, a.y - b.y) <= tolerance;
const ground = (p: { x: number; y: number } | null) => (p ? { x: p.x, y: p.y } : null);
const villa: SoccerNames = { top: "Aston Villa", bottom: "Manchester City", topColor: "660e36", bottomColor: "99c5ea" };

describe("every event", () => {
  const corner = find(0, "corner-awarded", "4'");
  const foul = find(0, "foul", "32'", "Foul by Marc");
  const booking = find(0, "yellow-card", "32'");

  it("Villa's corner at 4' (home, the top team), out on its left: the far side as the Live Pitch draws it", () => {
    expect([corner?.event.kind.type, corner?.event.side]).toEqual(["corner", "top"]);
    expect(corner?.event.at?.y ?? 0).toBeGreaterThan(Pitch.width / 2);
  });

  it('"Foul by Marc Guéhi (Manchester City).": City\'s foul, his, where it was; a free kick won names the man fouled', () => {
    expect([foul?.event.kind.type, foul?.event.side, foul?.event.player]).toEqual(["foul", "bottom", "Marc Guéhi"]);
    expect(foul?.event.at).not.toBeNull();
    const won = find(0, "foul", "4'") ?? find(0, "foul", "1'");
    expect(won == null || won.event.other != null || won.event.player != null).toBe(true);
  });

  it("his yellow card, placed where he fouled (the card itself has no spot)", () => {
    expect(booking?.event.kind).toEqual({ type: "card", red: false, second: false });
    expect([booking?.event.player, booking?.event.side]).toEqual(["Marc Guéhi", "bottom"]);
    expect(near(booking?.event.at, foul?.event.at, 0.01)).toBe(true);
  });

  it('"Offside, Aston Villa. Nicolas Jackson is caught offside.": Villa\'s, his, where', () => {
    const offside = find(0, "offside", "27'");
    expect([offside?.event.kind.type, offside?.event.player, offside?.event.side]).toEqual(["offside", "Nicolas Jackson", "top"]);
    expect(offside?.event.at).not.toBeNull();
  });

  it("Valencia v Villarreal: Gueye's straight red (violent conduct), Elliott's second yellow", () => {
    const red = find(3, "red-card", "79'");
    const second = find(3, "red-card", "89'");
    expect(red?.event.kind).toEqual({ type: "card", red: true, second: false });
    expect(red?.event.player).toBe("Pape Gueye");
    expect(second?.event.kind).toEqual({ type: "card", red: true, second: true });
    expect(second?.event.player).toBe("Harvey Elliott");
  });

  it('"Omar Alderete replaces Nordi Mukiele because of an injury.": who comes on, who goes off', () => {
    const sub = find(1, "substitution", "52'");
    expect([sub?.event.kind.type, sub?.event.player, sub?.event.other]).toEqual(["substitution", "Omar Alderete", "Nordi Mukiele"]);
  });

  it('"Delay in match because of an injury Nordi Mukiele (Sunderland).": Sunderland\'s man down; "Delay over.": play on', () => {
    const hurt = find(1, "start-delay", "19'");
    expect([hurt?.event.kind.type, hurt?.event.player, hurt?.event.side]).toEqual(["injury", "Nordi Mukiele", "top"]);
    expect(find(1, "end-delay", "20'", "Delay over")?.event.kind.type).toBe("resume");
  });

  it('"Delay in match (Villarreal). VAR checking.": a VAR check; VAR\'s decisions: a penalty for Valencia, a card upgraded, Newcastle\'s goal ruled out', () => {
    expect(find(3, "start-delay", "78'", "VAR")?.event.kind.type).toBe("varCheck");
    const decisions = [find(3, "var---referee-decision-cancelled", "36'"), find(3, "var---referee-decision-cancelled", "78'"), find(2, "var---referee-decision-cancelled", "53'")].map((f) => f?.event.kind);
    expect(decisions).toEqual([
      { type: "varDecision", words: "Penalty Valencia" },
      { type: "varDecision", words: "Card upgraded" },
      { type: "varDecision", words: "No Goal" },
    ]);
  });

  it("a handball, by its man; half time, and the second half", () => {
    const handball = find(2, "handball", "78'");
    expect([handball?.event.kind.type, handball?.event.player]).toEqual(["handball", "Adam Wharton"]);
    expect(find(0, "halftime", "45'+2'")?.event.kind.type).toBe("halftime");
    expect(find(0, "start-2nd-half", "45'")?.event.kind.type).toBe("secondHalf");
  });

  it("…and a delay's silent twin is no event of its own", () => {
    const doubled = matches[1]!.clips.flat().filter((p) => typeOf(p) === "start-delay");
    expect(doubled.length).toBeGreaterThanOrEqual(2);
    for (const item of doubled.filter((p) => textOf(p) === "")) expect(parseEvent([item], 0, matches[1]!.home.id)).toBeNull();
  });

  it("the added time from the commentary (the core plays don't have it): 4 at Villa Park, 6 at Sunderland; shown while it's being played, not before, not in the other half", () => {
    const added = latestAddedTime(matches[0]!.commentary);
    expect(added).toEqual({ minutes: 4, half: 2 });
    expect(latestAddedTime(matches[1]!.commentary)).toEqual({ minutes: 6, half: 2 });
    expect([addedShowing(added, 2, 5420), addedShowing(added, 2, 5100), addedShowing(added, 1, 2750)]).toEqual([4, null, null]);
  });
});

describe("every shot, and what its words say", () => {
  it("every shot is a moment now, a speculative one too (its own short beat)", () => {
    const shots = matches.flatMap((m) => m.clips.flat()).filter((p) => typeOf(p).startsWith("shot-"));
    expect(shots.length).toBeGreaterThan(0);
    expect(shots.every((p) => isMoment(p))).toBe(true);
  });

  it('a shot\'s aim from its words: the bottom left corner, the bottom right, high and wide to the left, too high; none from "left footed"', () => {
    const bottomLeft = aimFromWords("is saved in the bottom left corner by Zion Suzuki")!;
    const bottomRight = aimFromWords("is saved in the bottom right corner")!;
    const highWide = aimFromWords("is high and wide to the left.")!;
    const tooHigh = aimFromWords("is too high from a direct free kick.")!;
    expect(bottomLeft.y > 50 && bottomLeft.y < POSTS.far && bottomLeft.z < 10).toBe(true);
    expect(bottomRight.y < 50 && bottomRight.y > POSTS.near).toBe(true);
    expect(highWide.y > POSTS.far && highWide.z > 38).toBe(true);
    expect(Math.abs(tooHigh.y - 50) < 0.1 && tooHigh.z > 38).toBe(true);
    expect(aimFromWords("left footed shot from the left side of the box is blocked.")).toBeNull();
  });

  it("…and where it was struck from: outside the box, the left of the six-yard box, very close range", () => {
    const outside = spotFromWords("right footed shot from outside the box misses", 1n)!;
    const six = spotFromWords("left footed shot from the left side of the six yard box", 1n)!;
    expect(outside.x < 83 && outside.x > 70).toBe(true);
    expect(six.x > 94 && six.y > 50).toBe(true);
    expect(spotFromWords("header from very close range", 1n)!.x).toBeGreaterThan(94);
  });

  const m0 = matches[0]!;
  const save = (clue: string, strip: boolean): [SoccerScene, SoccerScript] | null => {
    for (const clip of m0.clips) {
      const plays = [...clip];
      const i = plays.findIndex((p) => isMoment(p) && textOf(p).includes(clue));
      if (i < 0) continue;
      if (strip) {
        const raw = { ...plays[i]! };
        delete raw.goalPositionY;
        delete raw.goalPositionZ;
        plays[i] = raw;
      }
      const scene = parse(plays, i, m0.home.id, keepers(plays));
      if (scene) return [scene, SoccerScript.build(scene, lineupsOf(m0))];
    }
    return null;
  };
  for (const strip of [false, true]) {
    it(
      strip
        ? "…and from their words alone (ESPN's point in the goal mouth taken away): the same sides"
        : "two real saves play differently: Suzuki to his right for Ndiaye's bottom left corner, to his left for Haaland's bottom right",
      () => {
        const left = save("Iliman Ndiaye (Manchester City) left footed shot from the right side of the box is saved", strip)!;
        const right = save("Erling Haaland (Manchester City) header from the centre of the box is saved", strip)!;
        // City attack the left-hand goal in the data: the shooter's left is the near side (y below the middle).
        const l = left[1].impacts.find((i) => i.kind === "save")?.point.y;
        const r = right[1].impacts.find((i) => i.kind === "save")?.point.y;
        expect([left[0].outcome, right[0].outcome]).toEqual(["saved", "saved"]);
        expect(l ?? 99).toBeLessThan(Pitch.width / 2);
        expect(r ?? 0).toBeGreaterThan(Pitch.width / 2);
        expect(JSON.stringify(left[1].flights)).not.toBe(JSON.stringify(right[1].flights));
      },
    );
  }
});

describe("which way the pitch faces", () => {
  it("home attacks right in the first half (as the Live Pitch draws it), left in the second; the viewer's turn swaps them", () => {
    expect([PitchFacing.homeAttacksRight(1, false), PitchFacing.homeAttacksRight(2, false), PitchFacing.homeAttacksRight(1, true), PitchFacing.homeAttacksRight(2, true)]).toEqual([true, false, false, true]);
  });

  it("the half-time swap: Gvardiol's 56' shot, at the left-hand goal in the data, is at the right-hand one in the second half; its replay goes at the right-hand goal, the stamp on the left, away from it", () => {
    const m0 = matches[0]!;
    let scene: SoccerScene | null = null;
    for (const clip of m0.clips) {
      const i = clip.findIndex((p) => isMoment(p) && textOf(p).includes("Josko Gvardiol (Manchester City) left footed shot from the left side of the box is saved"));
      if (i >= 0) scene = parse(clip, i, m0.home.id, keepers(clip));
      if (scene) break;
    }
    expect(scene).not.toBeNull();
    const s = scene!;
    const drawn = PitchFacing.homeAttacksRight(s.period, false) ? s : turnedScene(s);
    expect(s.period).toBe(2);
    expect(s.shot.from.x).toBeLessThan(Pitch.length / 2);
    expect(attacksRight(drawn)).toBe(true);
    expect(drawn.shot.from.x).toBeGreaterThan(Pitch.length / 2);
    expect(near(turnedScene(drawn).shot.from, s.shot.from, 1e-9)).toBe(true);
    const script = SoccerScript.build(drawn, lineupsOf(m0));
    expect(script.flights.at(-1)!.to.x).toBeGreaterThan(Pitch.length / 2);
    expect(script.cornerRight).toBe(false);
  });

  it("the second half's kick-off: the ends changed, Villa's men all in the right-hand half", () => {
    const second = find(0, "start-2nd-half", "45'")!;
    const idle = soccerIdle({ event: second.event, touch: null, scene: null, period: 1, lineups: second.lineups, flipped: false });
    const s = soccerIdleScript(idle);
    const homeMen = s.actors.filter((a) => a.team === (idle.possession === "top" ? "attacking" : "defending") && a.role !== "keeper");
    expect(idle.homeRight).toBe(false);
    expect(homeMen.every((a) => a.position(1).x >= Pitch.length / 2 - 1.5)).toBe(true);
  });
});

describe("choreography", () => {
  const corner = find(0, "corner-awarded", "4'")!;
  const booking = find(0, "yellow-card", "32'")!;

  it("Villa's corner from the right-hand goal's far flag (out on their left): the taker over it, four and more of theirs in the box; tagged CORNER · ASTON VILLA in Villa's claret", () => {
    const idle = soccerIdle({ event: corner.event, touch: null, scene: null, period: 1, lineups: corner.lineups, flipped: false });
    const s = soccerIdleScript(idle);
    const ball = ground(s.ball(5));
    const taker = s.actors.find((a) => a.team === "attacking" && near(a.position(5), ball, 2.5));
    const inBox = s.actors.filter((a) => a.team === "attacking" && a.position(5).x > Pitch.length - Pitch.boxDepth && Math.abs(a.position(5).y - 34) < 20);
    expect(near(ball, { x: Pitch.length - 0.6, y: Pitch.width - 0.6 }, 1.2)).toBe(true);
    expect(taker).toBeDefined();
    expect(inBox.length).toBeGreaterThanOrEqual(4);
    expect(SoccerStatus.idle(idle, 5, villa, null)).toEqual({ tag: "Corner · Aston Villa", tint: "660e36" });
  });

  it("City's at 9', out on their right as they attack the left-hand goal: the far flag at that end", () => {
    const city = find(0, "corner-awarded", "9'")!;
    const s = soccerIdleScript(soccerIdle({ event: city.event, touch: null, scene: null, period: 1, lineups: city.lineups, flipped: false }));
    expect(near(ground(s.ball(5)), { x: 0.6, y: Pitch.width - 0.6 }, 1.2)).toBe(true);
  });

  it("Guéhi's booking: the referee at his foul, the yellow card up, Guéhi himself (by his ESPN ID) in front of him; tagged YELLOW CARD · GUÉHI in yellow", () => {
    const spot = booking.event.at!;
    const idle = soccerIdle({ event: booking.event, touch: null, scene: null, period: 1, lineups: booking.lineups, flipped: false });
    const s = soccerIdleScript(idle);
    const guehi = booking.lineups.bottom?.players.find((p) => p.name === "Marc Guéhi")?.athlete;
    const booked = s.actors.find((a) => a.athlete != null && a.athlete === guehi);
    const referee = s.actors.findIndex((a) => a.team === "official" && a.name === "referee");
    expect(guehi).toBeDefined();
    expect(near(booked?.position(3), spot, 2.5)).toBe(true);
    expect(near(s.actors[referee]?.position(3), spot, 0.5)).toBe(true);
    expect(s.props.some((p) => p.kind === "yellowCard" && p.actor === referee && p.from < 3 && p.until > 3)).toBe(true);
    expect(SoccerStatus.idle(idle, 3, villa, null)).toEqual({ tag: "Yellow card · Guéhi", tint: SoccerStatus.yellow });
  });

  it("Gueye's red: the red card up, and he walks", () => {
    const red = find(3, "red-card", "79'")!;
    const s = soccerIdleScript(soccerIdle({ event: red.event, touch: null, scene: null, period: 2, lineups: red.lineups, flipped: false }));
    expect(s.props.some((p) => p.kind === "redCard")).toBe(true);
    expect(s.actors.some((a) => Number.isFinite(a.vanish) && a.team !== "official")).toBe(true);
  });

  it("offside: the assistant's flag up, OFFSIDE · JACKSON, then City's free kick", () => {
    const offside = find(0, "offside", "27'")!;
    const idle = soccerIdle({ event: offside.event, touch: null, scene: null, period: 1, lineups: offside.lineups, flipped: false });
    const s = soccerIdleScript(idle);
    expect(idle.possession).toBe("bottom");
    expect(s.props.some((p) => p.kind === "flag")).toBe(true);
    expect(SoccerStatus.idle(idle, 2, villa, null).tag).toBe("Offside · Jackson");
    expect(SoccerStatus.idle(idle, 8, villa, null).tag).toBe("Free kick · Manchester City");
  });

  it("the substitution: the board up, Mukiele off, Alderete on", () => {
    const sub = find(1, "substitution", "52'")!;
    const s = soccerIdleScript(soccerIdle({ event: sub.event, touch: null, scene: null, period: 2, lineups: sub.lineups, flipped: false }));
    const off = s.actors.find((a) => a.name === "Nordi Mukiele");
    const on = s.actors.find((a) => a.name === "Omar Alderete");
    expect(s.props.some((p) => p.kind === "board")).toBe(true);
    expect(Number.isFinite(off?.vanish)).toBe(true);
    expect(Number.isFinite(on?.appear)).toBe(true);
    expect(on?.opacity(s.duration)).toBe(1);
  });

  it("Mukiele down, the physios at him", () => {
    const hurt = find(1, "start-delay", "19'")!;
    const s = soccerIdleScript(soccerIdle({ event: hurt.event, touch: null, scene: null, period: 1, lineups: hurt.lineups, flipped: false }));
    const down = s.actors.find((a) => a.holds.some((h) => h.kind === "down"));
    const physios = s.actors.filter((a) => a.team === "staff");
    expect(down?.name).toBe("Nordi Mukiele");
    expect(physios.length).toBe(2);
    expect(physios.every((p) => near(p.position(12), down?.position(12), 2))).toBe(true);
  });

  describe("the ball going round the team that has it, in its own shape", () => {
    let touch: SoccerTouch | null = null;
    for (let i = corner.index - 1; i >= 0 && !touch; i--) touch = parseTouch(corner.clip[i], corner.home, 1);
    const idle = soccerIdle({ event: null, touch, scene: null, period: 1, lineups: corner.lineups, flipped: false });
    const s = soccerIdleScript(idle);

    it("between moments the team on the ball passes it round, every pass between its own starters", () => {
      const team = new Set(corner.lineups[idle.possession]?.players.map((p) => p.athlete) ?? []);
      const passers = s.actors.filter((a) => a.actions.some((x) => x.kind === "kick"));
      const passes = s.flights.filter((f) => f.kind === "pass");
      expect(touch).not.toBeNull();
      expect(idle.event).toBeNull();
      expect(passes.length).toBeGreaterThanOrEqual(5);
      expect(passers.length).toBeGreaterThan(0);
      expect(passers.every((a) => a.team === "attacking" && a.athlete != null && team.has(a.athlete))).toBe(true);
    });

    it("…round a loop that ends where it began, in beats with stills between", () => {
      const loop = s.loop!;
      expect(s.actors.every((a) => near(a.position(loop.start), a.position(loop.start + loop.period), 0.3))).toBe(true);
      expect(near(ground(s.ball(loop.start)), ground(s.ball(loop.start + loop.period)), 0.3)).toBe(true);
      const moving = s.beats.filter(([a]) => a >= loop.start).reduce((sum, [a, b]) => sum + b - a, 0);
      expect(moving).toBeLessThan(loop.period * 0.7);
      expect(moving).toBeGreaterThan(2);
    });

    it("…tagged with the team on the ball, and +4 ADDED while the added time's played", () => {
      expect(SoccerStatus.idle(idle, 1, villa, null).tag).toBe(`${idle.possession === "top" ? "Aston Villa" : "Manchester City"} ball`);
      expect(SoccerStatus.idle(idle, 1, villa, 4).tag).toBe("+4 added");
    });

    it("seeded: the same touch always goes round the same way, another differently", () => {
      const other = soccerIdle({ event: null, touch: { side: touch!.side, at: { x: 30, y: 20 }, order: 7, period: null, clock: 0 }, scene: null, period: 1, lineups: corner.lineups, flipped: false });
      expect(JSON.stringify(soccerIdleScript(idle).flights)).toBe(JSON.stringify(s.flights));
      expect(JSON.stringify(soccerIdleScript(other).flights)).not.toBe(JSON.stringify(s.flights));
      expect(idleRight(idle)).toBe((idle.possession === "top") === idle.homeRight);
    });
  });

  it("a foul gives the ball to the other team", () => {
    expect(parseTouch({ type: { type: "foul" }, team: { $ref: "/teams/382" }, fieldPositionX: 40, fieldPositionY: 30 }, "362", 1)?.side).toBe("top");
  });
});

describe("what plays, in turn", () => {
  const corner = find(0, "corner-awarded", "4'")!;
  const booking = find(0, "yellow-card", "32'")!;
  const foul = find(0, "foul", "32'", "Foul by Marc")!;

  it("events since the page opened play in turn (the foul before it is history); the corner holds play up, until the ball's in play again", () => {
    let state: SoccerTheaterState = {
      scene: null,
      news: false,
      events: [foul.event, booking.event, corner.event].map((e, k) => ({ ...e, order: 10 + k })),
      newsFrom: 11,
      touch: { side: "top", at: Pitch.center, order: 5, period: null, clock: 0 },
    };
    const first = soccerEvents(state, new Set());
    expect(first.pending.map((e) => e.id)).toEqual([booking.event.id, corner.event.id]);
    expect(first.standing?.id).toBe(corner.event.id);
    const after = soccerEvents(state, new Set([booking.event.id, corner.event.id]));
    state = { ...state, touch: { side: "top", at: Pitch.center, order: 20, period: null, clock: 0 } };
    const taken = soccerEvents(state, new Set([booking.event.id, corner.event.id]));
    expect(after.pending).toEqual([]);
    expect(after.standing?.id).toBe(corner.event.id);
    expect(taken.standing).toBeNull();
  });

  it("the lane's watch: events read from the window in order, news only once the page has had its first load, the ball's whereabouts, the half, the heartbeat", () => {
    const clip = matches[0]!.clips.find((c) => c.some((p) => typeOf(p) === "corner-awarded" && clockOf(p) === "4'"))!;
    const cut = clip.findIndex((p) => typeOf(p) === "corner-awarded");
    const watch = new SoccerTheaterWatch();
    const now = Date.now();
    watch.update(clip.slice(0, cut), matches[0]!.home.id, false, now);
    expect(watch.state.newsFrom ?? null).toBeNull();
    expect(watch.state.touch).not.toBeNull();
    expect(watch.state.period).toBe(1);
    watch.update(clip.slice(0, cut + 1), matches[0]!.home.id, true, now + 3000);
    const events = watch.state.events ?? [];
    expect(events.at(-1)?.kind.type).toBe("corner");
    expect(watch.state.newsFrom).toBe(events.at(-1)?.order);
    expect(watch.state.heard).toBe(now + 3000);
    expect(soccerEvents(watch.state, new Set()).pending.map((e) => e.kind.type)).toEqual(["corner"]);
  });
});
