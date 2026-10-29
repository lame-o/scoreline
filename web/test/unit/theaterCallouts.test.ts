/**
 * Tags under the play and the callouts (TheaterNamesTests.swift, the checks
 * 4beee36 and b4c1ce7 added): where a tag sits round its man through his
 * stretch of the replay (alone, a crowd, a man passing, only his own stretch,
 * nudged, kept once chosen), raised over a crowd as a callout by the least
 * that clears it (a man further up, a basket, the ball's flight), where the
 * callout goes and its stem, the pointer's tag winning, the key tag's glide;
 * and who crosses a tag lying under the play (ringed over it alone), the
 * ring's width, its clip, the full tag's shape.
 */
import { describe, expect, it } from "vitest";
import { CameraFrame, type Rect } from "../../src/data/mlb/playCamera";
import type { Point } from "../../src/data/mlb/theaterField";
import { Hoops } from "../../src/data/theater/basketballScript";
import { RigPoses } from "../../src/data/theater/rig";
import {
  known,
  ringWidth,
  stemWidth,
  tagEntering,
  tagSpot,
  TheaterCast,
  theaterLabels,
  theaterPerson,
  TheaterTagLayout,
  TheaterTagPlan,
  WHOLE,
  type HitFigure,
  type TagAsk,
  type TheaterReplay,
  type TheaterTagSpot,
} from "../../src/data/theater/theaterNames";
import { SLIDE_LEAN } from "../../src/data/scoringSlide";
import { FieldProjection } from "../../src/features/game/core/theater/fieldProjection";
import { grip, RigLens, rigFigure, shift, type RigFigure } from "../../src/features/game/core/theater/rigFigure";
import { figureBox, figureTop, nameTag, tagCrossing, tagRing, tagShape, type TagBall, type TagFigure } from "../../src/features/game/core/theater/theaterTags";
import { basketRoom, HoopProjection } from "../../src/features/game/nba/theater/drawBasketball";

const well = { width: 312, height: 156 };
const tag = { width: 70, height: 14.4 };
const furniture = TheaterTagLayout.furniture(well, { width: 110, height: 16 }, true, "trailing");
const ask = (x: number, top: number, feet: number, pointer: boolean): TagAsk => ({ size: tag, head: { x, y: top }, feet, pointer });
const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
const meets = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const near = (a: Rect | null | undefined, b: Rect | null | undefined) =>
  a != null && b != null && Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9 && Math.abs(a.width - b.width) < 1e-9 && Math.abs(a.height - b.height) < 1e-9;

describe("where a tag goes, at its spot", () => {
  it("gives a man under the well's bottom edge none, and brings his tag in with him as he comes up over it", () => {
    expect(TheaterTagLayout.place([ask(160, 157, 184, true)], well, [])[0]).toBeNull();
    expect(tagEntering(ask(160, 155, 182, true), well)).toBe(0);
    expect(Math.abs(tagEntering(ask(160, 152, 179, true), well) - 0.5)).toBeLessThan(0.01);
    expect(tagEntering(ask(160, 140, 167, true), well)).toBe(1);
  });

  it("goes where its stretch's spot puts it: nudged a quarter of its width, or under his feet", () => {
    const nudged = TheaterTagLayout.place([{ ...ask(160, 80, 104, false), spot: tagSpot(0.25) }], well, furniture)[0];
    const under = TheaterTagLayout.place([{ ...ask(160, 80, 104, false), spot: tagSpot(0, true) }], well, furniture)[0];
    expect(near(nudged, rect(142.5, 80 - 3 - 14.4, 70, 14.4))).toBe(true);
    expect(near(under, rect(125, 107, 70, 14.4))).toBe(true);
  });
});

// He stands at (160, 100), 24 pt tall; his tag over him spans x 125–195, y 58.6–73.
type Man = HitFigure;
const replay = (others: (t: number) => Man[]): TheaterReplay => ({ length: 5, at: (t) => ({ figures: [{ index: 0, ground: { x: 160, y: 100 }, height: 24 }, ...others(t)], ball: null }) });
const man = (index: number, x: number, y: number): Man => ({ index, ground: { x, y }, height: 24 });
const row = [man(1, 140, 88), man(2, 160, 87), man(3, 180, 88)];
const front = [man(4, 135, 124), man(5, 160, 125), man(6, 185, 124)];
const choose = (r: TheaterReplay, stretch = WHOLE) => TheaterTagPlan.choose(0, tag, false, stretch, well, [], r);
const OVER = tagSpot();

describe("where round him, through the replay", () => {
  const huddle = replay(() => row);
  const corner = replay(() => [man(1, 118, 88), man(2, 133, 87)]);

  it("keeps a tag over his head with nobody near, under his feet below a crowd, and still for a man passing through", () => {
    expect(choose(replay(() => [man(1, 40, 120)]))).toEqual(OVER);
    expect(choose(huddle)).toEqual(tagSpot(0, true));
    expect(choose(replay((t) => [man(1, t >= 1 && t <= 1.3 ? 160 : 20, 88)]))).toEqual(OVER);
  });

  it("counts only his own stretch: the crowd gone by the time he's key leaves it over his head", () => {
    const early = replay((t) => (t < 2 ? row : []));
    expect(choose(early, { from: 2, to: 5 })).toEqual(OVER);
    expect(choose(early, { from: 0, to: 2 })).toEqual(tagSpot(0, true));
  });

  it("nudges it right a quarter of its width for two men at its left end, and keeps the choice once made", () => {
    const side = choose(corner);
    expect(side).toEqual(tagSpot(0.25));
    expect(TheaterTagPlan.ranked(0, tag, false, WHOLE, well, null, corner, "test|corner")[0]).toEqual(side);
    expect(TheaterTagPlan.ranked(0, tag, false, WHOLE, well, null, huddle, "test|corner")[0]).toEqual(side);
  });

  it("raises it clear of a crowd on every side, by the least height that clears it", () => {
    expect(choose(replay(() => [...row, ...front]))).toEqual(tagSpot(0, false, 0.5));
    expect(choose(replay(() => [...row.map((m) => man(m.index, m.ground.x, m.ground.y - 12)), ...front]))).toEqual(tagSpot(0, false, 1));
    expect(choose(replay((t) => (t >= 1 && t < 1.6 ? [...row, ...front] : [])))).toEqual(OVER);
  });

  it("nudges a callout clear of the men further up behind him, and of a basket", () => {
    expect(choose(replay(() => [...row, ...front, man(7, 172, 62), man(8, 172, 40)]))).toEqual(tagSpot(-0.45, false, 0.5));
    const basket: TheaterReplay = { length: 5, at: () => ({ figures: [man(0, 160, 100), ...row, ...front], ball: null, fixtures: [rect(170, 40, 30, 22)] }) };
    expect(choose(basket)).toEqual(tagSpot(-0.45, false, 0.5));
  });

  it("takes a basket's room as its glass, rim and net, over the floor under it", () => {
    const court = new HoopProjection(well, { x: Hoops.length - 20, y: Hoops.width / 2, span: 60 } satisfies CameraFrame, 0);
    const hoop = basketRoom(court, 1);
    const rim = court.point(Hoops.rim, Hoops.rimHeight);
    expect(rim.x >= hoop.x - 0.01 && rim.x <= hoop.x + hoop.width + 0.01 && rim.y >= hoop.y - 0.01 && rim.y <= hoop.y + hoop.height + 0.01).toBe(true);
    expect(hoop.y + hoop.height).toBeLessThan(court.point(Hoops.rim).y);
    expect(hoop.y).toBeLessThan(rim.y - 4);
    expect(hoop.width).toBeGreaterThan(4);
  });

  it("counts the ball where it is, or all the way it flew across a tag since the last moment", () => {
    const r = rect(0, 0, 70, 14.4);
    expect(Math.abs(TheaterTagPlan.ball(r, { x: 90, y: 7 }, { x: -20, y: 7 }, 3) - 76 * 6)).toBeLessThan(0.01);
    expect(Math.abs(TheaterTagPlan.ball(r, { x: 35, y: 7 }, null, 3) - 36)).toBeLessThan(0.01);
    expect(TheaterTagPlan.ball(r, { x: 90, y: 40 }, { x: -20, y: 30 }, 3)).toBe(0);
    const passes: TheaterReplay = { length: 5, at: (t) => ({ figures: [man(0, 160, 100)], ball: { x: Math.round(t * 10) % 2 === 0 ? 100 : 220, y: 66 } }) };
    expect(choose(passes)).toEqual(tagSpot(0, true));
  });
});

describe("the callout, where it goes", () => {
  const stands = (y: number, spot: TheaterTagSpot) => TheaterTagPlan.ask(spot, tag, { x: 160, y }, 24, false);
  const up = TheaterTagLayout.raised(stands(100, tagSpot(0, false, 1)), well);

  it("rides a fixed offset over where he stands: his height over the spot over his head (or half of it, nudged)", () => {
    expect(near(up, rect(125, 100 - 24 - 3 - 14.4 - 24, 70, 14.4))).toBe(true);
    expect(near(TheaterTagLayout.raised(stands(100, tagSpot(-0.25, false, 0.5)), well), rect(107.5, 100 - 24 - 3 - 14.4 - 12, 70, 14.4))).toBe(true);
  });

  it("sinks to the well's margin near the top, still over his head; with no room over him, or not raised, none", () => {
    expect(near(TheaterTagLayout.raised(stands(52, tagSpot(0, false, 1)), well), rect(125, 4, 70, 14.4))).toBe(true);
    expect(TheaterTagLayout.raised(stands(38, tagSpot(0, false, 1)), well)).toBeNull();
    expect(TheaterTagLayout.raised(stands(100, OVER), well)).toBeNull();
  });

  it("sinks just under the status tag it meets, still over him", () => {
    const placed = TheaterTagLayout.place([stands(100, tagSpot(0, false, 1.5))], well, [rect(0, 8, 150, 18)])[0];
    expect(Math.abs(placed!.y - 28)).toBeLessThan(0.01);
    expect(placed!.x).toBe(125);
  });

  it("stays round him where he's only lightly crowded, the callout next in line: where the pointer's tag takes his place, it rises over the crowd", () => {
    const order = TheaterTagPlan.rank(0, tag, false, WHOLE, well, [], replay((t) => [...row, ...(t < 2 ? [man(5, 160, 125)] : [])]));
    expect(order[0]).toEqual(tagSpot(0, true));
    expect(order[1]).toEqual(tagSpot(0, false, 0.5));
    const pushed = TheaterTagLayout.place([TheaterTagPlan.ask(OVER, tag, { x: 160, y: 140 }, 24, true), { ...stands(100, order[0]!), then: order.slice(1) }], well, []);
    expect(near(pushed[1], TheaterTagLayout.raised(stands(100, tagSpot(0, false, 0.5)), well))).toBe(true);
  });
});

describe("the stem", () => {
  const stands = (y: number, spot: TheaterTagSpot) => TheaterTagPlan.ask(spot, tag, { x: 160, y }, 24, false);
  const him = stands(100, tagSpot(0, false, 1));
  const stem = (r: Rect | null, a: TagAsk) => {
    const s = r ? TheaterTagLayout.stem(r, a, well) : null;
    return s ? `(${s.from.x.toFixed(1)}, ${s.from.y.toFixed(1)})→(${s.to.x.toFixed(1)}, ${s.to.y.toFixed(1)})` : "none";
  };
  const cut = 14.4 * SLIDE_LEAN;

  it("runs straight down from the middle of its bottom edge (tucked under the slab) to 2.5 pt over his head", () => {
    expect(stem(TheaterTagLayout.raised(him, well), him)).toBe("(160.0, 48.5)→(160.0, 73.5)");
  });

  it("starts from the near end of its bottom edge when it's off to one side, inside the slab's cut", () => {
    expect(stem(rect(200, 30, 70, 14.4), him)).toBe("(202.0, 43.9)→(160.0, 73.5)");
    expect(stem(rect(60, 30, 70, 14.4), him)).toBe(`(${(130 - cut - 2).toFixed(1)}, 43.9)→(160.0, 73.5)`);
  });

  it("is none for a tag over his head, nudged or under his feet, or held at the well's bottom edge over a man under it", () => {
    const over = rect(125, 58.6, 70, 14.4);
    expect(stem(over, him)).toBe("none");
    expect(stem({ ...over, x: over.x + 17.5 }, him)).toBe("none");
    expect(stem(rect(125, 105.4, 70, 14.4), him)).toBe("none");
    expect(stem(rect(125, 137.6, 70, 14.4), stands(185, OVER))).toBe("none");
  });

  it("is a hairline in small figures, a point in the compact panel's usual ones, never more", () => {
    expect(stemWidth(10)).toBe(0.75);
    expect(Math.abs(stemWidth(24) - 0.96)).toBeLessThan(0.01);
    expect(stemWidth(56)).toBe(1);
  });

  it("never runs through the pointer's tag: the key man's steps under his feet instead", () => {
    const pointer = TheaterTagPlan.ask(OVER, tag, { x: 160, y: 100 }, 24, true);
    const alone = TheaterTagLayout.place([pointer], well, [])[0]!;
    const behind = TheaterTagPlan.ask(tagSpot(0, false, 1.25), tag, { x: 160, y: 112 }, 24, false);
    const pair = TheaterTagLayout.place([pointer, behind], well, []);
    expect(near(pair[0], alone)).toBe(true);
    expect(meets(TheaterTagLayout.raised(behind, well)!, alone)).toBe(false);
    expect(pair[1]!.y).toBeGreaterThanOrEqual(behind.feet);
  });
});

describe("the key man's stretch and the glide", () => {
  const named = (i: number) => ({ who: known(theaterPerson(`Man ${i}`)), side: "top" as const, id: `a:${i}` });
  const switched = new TheaterCast(
    new Map([
      [3, named(3)],
      [7, named(7)],
    ]),
    [
      { from: -Infinity, figure: 3 },
      { from: 2.4, figure: 7 },
    ],
  );

  it("runs a key man's stretch until the next one's", () => {
    expect(switched.stretch(1)).toEqual({ from: -Infinity, to: 2.4 });
    expect(switched.stretch(3)).toEqual({ from: 2.4, to: Infinity });
  });

  it("glides the key tag over from the last man in 200 ms on a strong ease-in-out, a function of t alone", () => {
    const glides: number[] = [];
    for (let k = 0; k < 10; k++) {
      const u = switched.handoff(2.4 + k * 0.02)?.u;
      if (u != null) glides.push(u);
    }
    expect(switched.handoff(2.39)).toBeNull();
    expect(switched.handoff(2.5)?.from).toBe(3);
    expect(switched.handoff(2.5)?.stretch).toEqual({ from: -Infinity, to: 2.4 });
    expect(switched.handoff(2.61)).toBeNull();
    expect(glides).toHaveLength(10);
    expect(glides[0]).toBe(0);
    expect(glides.every((u, i) => i === 0 || u > glides[i - 1]!)).toBe(true);
    expect(switched.handoff(2.45)!.u).toBeLessThan(0.2);
    expect(switched.handoff(2.55)!.u).toBeGreaterThan(0.8);
  });
});

describe("under the play", () => {
  // A man standing in a compact panel's well, his tag over his head as placement puts it.
  const field = new FieldProjection(well, { x: 0, y: 60, span: 60 });
  const lens = RigLens.field(field, { x: 0, y: 60 });
  const him = rigFigure(RigPoses.stand, 0, lens);
  const spot = TheaterTagLayout.place([ask(him.head.x, figureTop(him), him.ground.y + 3, true)], well, [])[0]!;
  const midY = spot.y + spot.height / 2;
  const copy = (f: RigFigure, dx: number, dy: number): RigFigure => {
    const g: RigFigure = { ...f, hands: [...f.hands], limbs: f.limbs.map((l) => ({ ...l })) } as RigFigure;
    shift(g, dx, dy);
    return g;
  };
  const figure = (index: number, dx: number, dy: number, opacity = 1): TagFigure => ({ index, figure: copy(him, dx, dy), height: lens.height, opacity });
  // Another man walking across it (his chest on it), one faded out there, one far off.
  const men = [figure(0, 0, 0), figure(1, 24, midY - him.neck.y), figure(2, 24, midY - him.neck.y, 0), figure(3, 140, 0)];
  const ball = (x: number, opacity = 1): TagBall => ({ x, y: midY, rx: 2.5, ry: 2.5, height: lens.height, opacity });

  it("rings a man crossing a tag, not its own man under it, one faded out or one far off; the ball within its ring's width of it too", () => {
    const crossed = tagCrossing(men, ball(spot.x + spot.width + 3.5), spot, 0);
    expect(lens.height).toBeGreaterThan(14);
    expect(lens.height).toBeLessThan(40);
    expect(crossed.figures).toEqual([1]);
    expect(crossed.ball).toBe(true);
  });

  it("never lets a big man's ring margin bite his own tag (3 pt over his head), though it counts for anyone else", () => {
    const tall: TagFigure[] = [{ index: 5, figure: him, height: 56, opacity: 1 }];
    expect(tagCrossing(tall, null, spot).figures).toEqual([0]);
    expect(tagCrossing(tall, null, spot, 5).figures).toEqual([]);
  });

  it("leaves the ball clear of it alone, and one faded out", () => {
    expect(tagCrossing(men, ball(spot.x + spot.width + 8), spot).ball).toBe(false);
    expect(tagCrossing([], ball(spot.x + spot.width / 2, 0), spot).ball).toBe(false);
  });

  it("rings the batter whose bat reaches into his own tag, bat and all", () => {
    const g = grip(him);
    const batter: TagFigure = { ...men[0]!, held: { from: g, to: { x: g.x + 6, y: spot.y + spot.height - 1 }, width: 2.5 } };
    expect(tagCrossing([batter], null, spot).figures).toEqual([0]);
  });

  it("holds a man's whole ring in his box", () => {
    const f = men[1]!;
    const grow = Math.max(f.height * 0.045, 0.8) + ringWidth(f.height);
    const g = f.figure;
    // The ring's capsules, sampled round each end.
    const ends: [Point, number][] = [];
    for (const l of g.limbs) for (const p of [l.root, l.joint, l.end]) ends.push([p, g.limb / 2 + grow]);
    ends.push([g.hip, g.torso / 2 + grow], [g.neck, g.torso / 2 + grow], [g.head, g.headRadius + grow]);
    const box = figureBox(f);
    for (const [p, r] of ends) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * 2 * Math.PI;
        const x = p.x + r * Math.cos(a);
        const y = p.y + r * Math.sin(a);
        expect(x >= box.x - 0.01 && x <= box.x + box.width + 0.01 && y >= box.y - 0.01 && y <= box.y + box.height + 0.01).toBe(true);
      }
    }
  });

  it("makes the ring about 1.5 pt round the compact panel's figures (19–31 pt tall), wider with them in a wider well", () => {
    for (let h = 19; h <= 31; h++) {
      expect(ringWidth(h)).toBeGreaterThanOrEqual(1.1);
      expect(ringWidth(h)).toBeLessThanOrEqual(1.9);
    }
    expect(ringWidth(60)).toBeGreaterThan(ringWidth(30));
  });

  it("clips the ring to the tag's slab, cut on the lean at its top leading and bottom trailing corners", () => {
    const shape = tagShape(spot);
    const inside = (p: Point) => shape.every((a, i) => {
      const b = shape[(i + 1) % 4]!;
      return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= 0;
    });
    const lean = spot.height * SLIDE_LEAN;
    expect(inside({ x: spot.x + spot.width / 2, y: midY })).toBe(true);
    expect(inside({ x: spot.x + 0.5, y: spot.y + spot.height - 0.5 })).toBe(true);
    expect(inside({ x: spot.x + spot.width - 0.5, y: spot.y + 0.5 })).toBe(true);
    expect(inside({ x: spot.x + lean / 2, y: spot.y + 0.5 })).toBe(false);
    expect(inside({ x: spot.x + spot.width - lean / 2, y: spot.y + spot.height - 0.5 })).toBe(false);
  });

  it("draws the full tag solid across, number to name, cut on the lean at its corners: the clip's shape", () => {
    // A canvas that keeps each slab it fills (the number's stripe, the name's), type measured half an em a letter.
    const slabs: Point[][] = [];
    let path: Point[] = [];
    const ctx = {
      font: "",
      fontStretch: "normal",
      letterSpacing: "0px",
      fillStyle: "",
      globalAlpha: 1,
      save() {},
      restore() {},
      measureText(text: string) {
        return { width: [...text].length * 4.5 };
      },
      beginPath() {
        path = [];
      },
      moveTo(x: number, y: number) {
        path.push({ x, y });
      },
      lineTo(x: number, y: number) {
        path.push({ x, y });
      },
      closePath() {},
      fill() {
        if (path.length === 4) slabs.push(path);
      },
      fillText() {},
    };
    const black = theaterLabels({ top: { color: "000000", alternate: "c4ced4" }, bottom: { color: "4e008e", alternate: "79a3dc" } }, "dark", { top: "Spurs", bottom: "Jazz" }).top;
    const block = nameTag(ctx as unknown as CanvasRenderingContext2D, known(theaterPerson("Victor Wembanyama", null, "1", "F")), black, true, 9);
    block.draw(ctx as unknown as CanvasRenderingContext2D);
    expect(slabs).toHaveLength(2);
    const inAny = (p: Point) =>
      slabs.some((s) => s.every((a, i) => {
        const b = s[(i + 1) % 4]!;
        return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= -1e-9;
      }));
    const W = block.width;
    const H = block.height;
    const d = H * SLIDE_LEAN;
    for (let x = d / 2 + 1; x <= W - d / 2 - 1; x += 0.5) expect(inAny({ x, y: H / 2 })).toBe(true);
    expect(inAny({ x: 0.5, y: 0.5 })).toBe(false);
    expect(inAny({ x: W - 0.5, y: H - 0.5 })).toBe(false);
    expect(inAny({ x: W - 2, y: 1 })).toBe(true);
    expect(inAny({ x: 1, y: H - 1 })).toBe(true);
  });

  it("rings white in the light; in the dark cuts the slab away round him, the surface showing", () => {
    expect(tagRing(false)).toEqual({ kind: "paint", color: "#ffffff" });
    expect(tagRing(true)).toEqual({ kind: "cutout" });
  });
});
