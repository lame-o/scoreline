/**
 * The odds' continuity (OddsChart.swift `OddsEndOrder`, `OddsLabelGlide`,
 * `OddsTail`; OddsFeed.swift's flush, `mergingHistory`, `holes`, `publish`;
 * Odds.swift `OddsQuote`, `OddsFrame`, `OddsSeries.stacked`), ported check by
 * check from Tests/OddsContinuityTests.swift, with its Ravens–Bills capture
 * (Tests/Fixtures/odds/pm-nfl-bal-buf-2026-11-01.json). Times are epoch ms.
 */
import { describe, expect, it } from "vitest";
import { glideValue, labelWidth, LABEL_HEIGHT, endLeaders, endOpacity, nextEndOrder, OddsLabelGlide, OddsLayout, tailConnector, GLIDE_MS, type OddsEndLabel } from "../../src/data/odds/chart";
import { applyUpdate, displayed, EMPTY_QUOTE, GAP, holes, mergingHistory, parseSocketMessage, quote, stacked, type BookUpdate, type Market, type Outcome, type OddsSplit, type OddsSplitPoint, type PricePoint } from "../../src/data/odds/polymarket";
import { OddsFeed } from "../../src/state/odds";
import { sharedFixture } from "./fixtures";

const S = 1000;
const time = 1_800_000_000_000;
/** "ATL 100%", "Draw 100%" at 10.5pt semibold, near enough. */
const measure = (text: string) => text.length * 6.2;
const layout = new OddsLayout(400, 124, { from: time, to: time + 600 * S }, labelWidth(["ATL", "TB", "Draw"], measure));
const two: Outcome[] = ["top", "bottom"];
const three: Outcome[] = ["top", "draw", "bottom"];
const split = (top: number): OddsSplit => ({ top, draw: null, bottom: 1 - top });
const point = (seconds: number, top: number): OddsSplitPoint => ({ t: time + seconds * S, split: split(top), unobserved: false });
const centers = (labels: readonly OddsEndLabel[]) => Object.fromEntries(labels.map((l) => [l.outcome, l.y]));
const apart = (labels: readonly OddsEndLabel[]) => {
  const ys = labels.map((l) => l.y).sort((a, b) => a - b);
  return ys.every((y, k) => k === 0 || y - ys[k - 1]! >= LABEL_HEIGHT - 1e-8);
};

const trade = (token: string, price: number): BookUpdate => ({ token, update: { kind: "trade", price } });
const best = (token: string, bid: number | null, ask: number | null): BookUpdate => ({ token, update: { kind: "best", bid, ask } });
const book = (token: string, bid: number | null, ask: number | null, last: number | null = null): BookUpdate => ({ token, update: { kind: "book", bid, ask, last } });

function feedFor(id: string, tokens: [string, Outcome][]): OddsFeed {
  const market: Market = { slug: id, kind: tokens.length === 3 ? "three-way" : "two-way", tokens: tokens.map(([token, outcome]) => ({ token, outcome })), volume: null, start: time };
  const feed = new OddsFeed({ id, path: "basketball/nba", state: "live", start: time, names: { top: [], bottom: [] } });
  feed.preview(market, {});
  return feed;
}
const seriesOf = (feed: OddsFeed, o: Outcome): readonly PricePoint[] => feed.getSnapshot().series[o] ?? [];

describe("end labels keep their identity", () => {
  it("never swaps on 50/50 jitter; a clear reversal (and recovery) reorders", () => {
    const original = nextEndOrder([], split(0.51), two, layout);
    expect(original, "initial end labels follow actual outcome rank").toEqual(two);
    let order = original;
    let stable = true;
    let geometry = true;
    for (const value of [0.499, 0.501, 0.49, 0.51, 0.5, 0.4999, 0.5001]) {
      order = nextEndOrder(order, split(value), two, layout);
      stable &&= order.join() === original.join();
      const labels = layout.endLabels(split(value), two, order);
      geometry &&= apart(labels) && labels[0]!.y < labels[1]!.y;
    }
    expect(stable, "50/50 quote jitter never swaps outcome labels").toBe(true);
    expect(geometry, "near-tie labels stay separated in their established order").toBe(true);
    const reversed = nextEndOrder(original, split(0.4), two, layout);
    expect(reversed, "a clear reversal eventually changes the outcome order").toEqual(["bottom", "top"]);
    expect(nextEndOrder(reversed, split(0.51), two, layout), "after a real reversal, a one-tick crossover does not immediately flip back").toEqual(reversed);
    expect(nextEndOrder(reversed, split(0.6), two, layout), "a clear recovery changes the order back").toEqual(two);
  });

  it("keeps soccer's three identities and spacing through a near-tie, and sorts a decisive move", () => {
    const soccerStart: OddsSplit = { top: 0.34, draw: 0.33, bottom: 0.33 };
    const soccerOrder = nextEndOrder([], soccerStart, three, layout);
    const soccerNear: OddsSplit = { top: 0.329, draw: 0.331, bottom: 0.34 };
    const held = nextEndOrder(soccerOrder, soccerNear, three, layout);
    expect(held, "soccer's three-way near-tie keeps all outcome identities").toEqual(soccerOrder);
    expect(apart(layout.endLabels(soccerNear, three, held)), "and spacing").toBe(true);
    const soccerClear: OddsSplit = { top: 0.05, draw: 0.3, bottom: 0.65 };
    expect(nextEndOrder(held, soccerClear, three, layout), "a decisive soccer move sorts all three outcomes correctly").toEqual(["bottom", "draw", "top"]);
    expect(nextEndOrder(two, soccerStart, three, layout), "switching from two to three outcomes does not inherit a stale identity list").toHaveLength(3);
  });

  it("glides a reorder from the rendered centers, lands exactly, restarts from where it is, dissolves names before they collide", () => {
    const reversed: Outcome[] = ["bottom", "top"];
    const before = layout.endLabels(split(0.6), two, two);
    const after = layout.endLabels(split(0.4), two, reversed);
    const glide = new OddsLabelGlide(before, after, time);
    expect(centers(glide.labels(time, after)), "a label reorder starts at the rendered centers without a 13pt snap").toEqual(centers(before));
    expect(centers(glide.labels(time + GLIDE_MS, after)), "a label reorder lands exactly on the new centers").toEqual(centers(after));
    const interrupted = glide.labels(time + 80, after);
    const next = new OddsLabelGlide(interrupted, before, time + 80);
    expect(centers(next.labels(time + 80, before)), "a fast follow-up quote restarts label motion from its visible position").toEqual(centers(interrupted));
    const collision: OddsEndLabel[] = [
      { outcome: "top", dot: before[0]!.dot, y: 62 },
      { outcome: "bottom", dot: before[1]!.dot, y: 62 },
    ];
    expect(collision.every((l) => endOpacity(l, collision) === 0) && before.every((l) => endOpacity(l, before) === 1), "reordering labels dissolve before overlap and return when separated").toBe(true);
    expect(endLeaders(layout.endLabels(split(0.49), two, two)), "near-tie leaders cannot form an apparent connector between outcomes").toEqual([]);
    const clear: OddsEndLabel[] = [
      { outcome: "top", dot: { x: 300, y: 20 }, y: 14 },
      { outcome: "bottom", dot: { x: 300, y: 100 }, y: 108 },
    ];
    expect(endLeaders(clear), "separate unambiguous labels retain their own leaders").toEqual(clear);
    const crossed: OddsEndLabel[] = [
      { outcome: "top", dot: { x: 300, y: 50 }, y: 75 },
      { outcome: "bottom", dot: { x: 300, y: 70 }, y: 45 },
    ];
    expect(endLeaders(crossed), "leaders that cross are suppressed even when the dots are distinct").toEqual([]);
  });
});

describe("the live end's tail", () => {
  it("never draws a hook back to history from a dot still behind it, and keeps real swings", () => {
    // The first jump is still gliding when a second quote arrives. The
    // preceding recorded value becomes 70%, but the visible dot is lower.
    const seen = glideValue({ from: split(0.4), to: split(0.7), start: time }, time + 40);
    const previous = point(599.5, 0.7);
    const head = point(600, 0.8);
    expect(seen.top, "the rapid-quote fixture reproduces a dot behind recorded history").toBeLessThan(previous.split.top);
    expect(two.every((o) => tailConnector(previous, head, seen, o, layout).length === 0), "an interrupted glide cannot draw an invented near-vertical hook back to history").toBe(true);
    const landed = glideValue({ from: seen, to: head.split, start: time + 40 }, time + 40 + GLIDE_MS);
    expect(two.every((o) => tailConnector(previous, head, landed, o, layout).length === 3), "the real last segment returns when the dot reaches its recorded range").toBe(true);
    const actual = tailConnector(previous, head, head.split, "top", layout);
    expect([actual[0], actual.at(-1)], "settled geometry preserves the exact historical price and latest outcome endpoint").toEqual([{ x: layout.x(previous.t), y: layout.y(0.7) }, layout.end(head.split, "top")]);
    expect(tailConnector(previous, point(600, 0.2), split(0.45), "top", layout), "a genuine large odds swing remains visible; steep real movements are not erased").toHaveLength(3);
    const first = tailConnector(null, head, head.split, "top", layout);
    expect([first.length, first.at(-1)], "a one-point market still shows its outcome endpoint").toEqual([2, layout.end(head.split, "top")]);
    const soccerStart: OddsSplit = { top: 0.34, draw: 0.33, bottom: 0.33 };
    const soccerClear: OddsSplit = { top: 0.05, draw: 0.3, bottom: 0.65 };
    const soccerPrevious: OddsSplitPoint = { t: time + 599 * S, split: soccerStart, unobserved: false };
    const soccerHead: OddsSplitPoint = { t: time + 600 * S, split: soccerClear, unobserved: false };
    const share = (s: OddsSplit, o: Outcome) => (o === "top" ? s.top : o === "draw" ? s.draw! : s.bottom);
    expect(
      three.every((o) => {
        const path = tailConnector(soccerPrevious, soccerHead, soccerClear, o, layout);
        const end = layout.end(soccerClear, o);
        return path[0]!.x === layout.x(soccerPrevious.t) && path[0]!.y === layout.y(share(soccerStart, o)) && path.at(-1)!.x === end.x && path.at(-1)!.y === end.y;
      }),
      "all three soccer tails stay attached to their own outcome identity",
    ).toBe(true);
  });
});

describe("the feed's coalescing and history", () => {
  it("publishes coalesced three-way quotes as one atomic snapshot, and ignores other markets' assets", () => {
    const feed = feedFor("continuity", [["home", "top"], ["draw", "draw"], ["away", "bottom"]]);
    feed.simulate([trade("home", 0.5), trade("draw", 0.2), trade("away", 0.3)], time);
    feed.simulate([trade("home", 0.4), trade("draw", 0.3)], time + 500);
    const stack = stacked(seriesOf(feed, "top"), seriesOf(feed, "draw"), seriesOf(feed, "bottom"));
    expect(stack.map((p) => p.t), "coalesced three-way quotes produce one snapshot, without microsecond intermediate prices").toEqual([time, time + 500]);
    expect(stack.at(-1)!.split, "changed soccer outcomes are atomic while the unchanged outcome retains its true price").toEqual({ top: 0.4, draw: 0.3, bottom: 0.3 });
    expect(seriesOf(feed, "top").at(-1)!.t).toBe(seriesOf(feed, "draw").at(-1)!.t);
    const version = feed.getSnapshot().version;
    feed.simulate([trade("not-this-market", 0.99)], time + 1000);
    expect(feed.getSnapshot().version, "unrelated asset IDs cannot change an outcome identity or quote").toBe(version);
    feed.detach();
  });

  it("merges history around live observations, never overwriting them", () => {
    const initial: PricePoint[] = [
      { t: time, p: 0.4 },
      { t: time + 60 * S, p: 0.5 },
    ];
    const fetched: PricePoint[] = [
      { t: time + 60 * S, p: 0.51 },
      { t: time + 90 * S, p: 0.55 },
      { t: time + 120 * S, p: 0.6 },
    ];
    const duringFetch = [...initial, { t: time + 120 * S, p: 0.7 }, { t: time + 121 * S, p: 0.72 }];
    const tail = { from: time + 60 * S, to: time + 122 * S };
    const merged = mergingHistory(fetched, duringFetch, tail, time + 122 * S);
    expect(merged, "history returning after live ticks fills the gap and preserves the newer observations, including an equal-time quote").toEqual([...initial, fetched[1], duringFetch[2], duringFetch[3]]);
    expect(mergingHistory(fetched, initial, tail, time + 122 * S), "history extends normally when no quote arrives during the request").toEqual([...initial, ...fetched.slice(1)]);
    expect(mergingHistory(fetched, [duringFetch[2]!], { from: time - 1800 * S, to: time + 122 * S }, time + 122 * S), "an initial history request also preserves a live tick that arrived before it returned").toEqual([...fetched.slice(0, -1), duringFetch[2]]);
    const quietTick = [...initial, { t: time + 120 * S, p: 0.5 }];
    expect(mergingHistory(fetched, quietTick, tail, time + 122 * S).at(-1), "the quiet-market ticker is not rolled back by a concurrent history response").toEqual(quietTick.at(-1));
    expect(merged.every((p, k) => k === 0 || merged[k - 1]!.t < p.t), "merged history remains strictly chronological without duplicate timestamps").toBe(true);
  });

  it("asks again for a failed opening, fills holes without overwriting, and always asks for the tail", () => {
    const late: PricePoint[] = [
      { t: time + 3000 * S, p: 0.6 },
      { t: time + 3060 * S, p: 0.61 },
    ];
    expect(holes(late, time, time + 3060 * S, new Set()), "ticks arriving after a failed first request leave the game's opening still to ask for").toEqual([{ from: time, to: time + 3000 * S }]);
    expect(holes(late, time, time + 3060 * S, new Set([time])), "an opening the provider has answered for, with nothing, isn't asked for again").toEqual([]);
    expect(holes([], time, time + 60 * S, new Set([time])), "no data yet: ask again").toEqual([{ from: time, to: time + 60 * S }]);
    const holed: PricePoint[] = [
      { t: time, p: 0.5 },
      { t: time + GAP + 60 * S, p: 0.6 },
    ];
    expect(holes(holed, time, time + GAP + 60 * S, new Set()), "samples a gap apart are a hole to fill").toEqual([{ from: time, to: time + GAP + 60 * S }]);
    expect(holes(holed, time, time + GAP + 600 * S, new Set([time])), "an answered hole stays a hole; the tail is always worth asking").toEqual([{ from: time + GAP + 60 * S, to: time + GAP + 600 * S }]);
    const filled = mergingHistory(
      [
        { t: time + 120 * S, p: 0.55 },
        { t: time + GAP + 90 * S, p: 0.9 },
      ],
      holed,
      { from: time, to: time + GAP + 60 * S },
      time + GAP + 600 * S,
    );
    expect(filled, "history fills only the hole, between the observations around it").toEqual([holed[0], { t: time + 120 * S, p: 0.55 }, holed[1]]);
  });

  it("holds an observed quiet market flat, starts afresh after a stretch nobody saw, and reads ticks without the series", () => {
    const watcher = feedFor("gap", [["t", "top"]]);
    watcher.simulate([trade("t", 0.5)], time);
    watcher.simulate([trade("t", 0.6)], time + 30 * S);
    expect(seriesOf(watcher, "top"), "a quiet, observed market holds flat until it moves").toHaveLength(3);
    expect(seriesOf(watcher, "top")[1]).toEqual({ t: time + 29 * S, p: 0.5 });
    watcher.simulate([trade("t", 0.6)], time + 30 * S + GAP + S);
    expect(seriesOf(watcher, "top"), "after a stretch nobody saw, the line starts again, with no hold point claiming it was flat").toHaveLength(4);
    expect(seriesOf(watcher, "top").at(-1)!.t).toBe(time + 30 * S + GAP + S);
    watcher.detach();
    expect([watcher.latestTick(), watcher.latestTick(time + 40 * S), watcher.latestTick(time - S)], "the newest tick at a moment, without reading the series").toEqual([time + 30 * S + GAP + S, time + 30 * S, null]);
    expect(watcher.ticks(time + S)[0], "the ticks still to come").toBe(time + 29 * S);
    expect(watcher.ticks(time + 30 * S + GAP + S)).toEqual([]);
    const unspoken = feedFor("three", [["a", "top"], ["b", "draw"], ["c", "bottom"]]);
    unspoken.simulate([trade("a", 0.5)], time);
    expect(unspoken.latestTick(), "no market moment until every outcome has spoken").toBeNull();
  });

  it("walks three outcomes once, breaking the line where one went unobserved", () => {
    const quiet: PricePoint[] = [{ t: time, p: 0.4 }];
    const busy: PricePoint[] = Array.from({ length: 11 }, (_, k) => ({ t: time + k * 60 * S, p: 0.3 }));
    const walked = stacked([...quiet, { t: time + 600 * S, p: 0.5 }], busy, busy);
    expect([walked.length, walked[5]!.unobserved], "a moment any of them moved, all three as they stood").toEqual([busy.length, false]);
    const silent = stacked(quiet, busy, busy);
    expect([silent[6]!.t, silent[6]!.unobserved, silent[7]!.unobserved], "past a gap since an outcome was heard, the moment isn't a reading of all three").toEqual([time + 360 * S, false, true]);
  });
});

describe("the displayed price", () => {
  it("never saws between a breathing book's midpoint and an old trade", () => {
    let q = EMPTY_QUOTE;
    q = applyUpdate(q, { kind: "trade", price: 0.7 });
    q = applyUpdate(q, { kind: "book", bid: 0.44, ask: 0.46, last: null });
    expect(displayed(q), "tight: the midpoint").toBeCloseTo(0.45, 12);
    q = applyUpdate(q, { kind: "best", bid: 0.3, ask: 0.6 });
    expect(displayed(q), "widened with no trade since: nothing new; the chart keeps the value it has").toBeNull();
    q = applyUpdate(q, { kind: "trade", price: 0.52 });
    expect(displayed(q), "a trade on a wide book is news: it's shown").toBe(0.52);
    q = applyUpdate(q, { kind: "best", bid: 0.51, ask: 0.53 });
    q = applyUpdate(q, { kind: "best", bid: 0.3, ask: 0.6 });
    expect(displayed(q), "and an old trade isn't again").toBeNull();
    const flips = feedFor("flips", [["t", "top"]]);
    flips.simulate([trade("t", 0.9)], time);
    flips.simulate([book("t", 0.44, 0.46)], time + S);
    for (let k = 0; k < 6; k++) {
      flips.simulate([best("t", 0.2, 0.8)], time + 2 * S + k * 2 * S);
      flips.simulate([best("t", 0.44, 0.46)], time + 3 * S + k * 2 * S);
    }
    const series = seriesOf(flips, "top");
    expect(series.at(-1)!.p, "wide/tight flips draw no connector: one value, no sawtooth").toBeCloseTo(0.45, 12);
    expect(series.filter((p) => p.t > time + S)).toEqual([]);
  });

  it("agrees with BAL's and BUF's own midpoints over all 28 real frames of the Ravens–Bills capture", () => {
    const capture = sharedFixture("odds/pm-nfl-bal-buf-2026-11-01.json") as {
      tokens: Record<string, string>;
      endpoints: Record<string, { book: { last_trade_price: string }; last: { price: string }; mid: { mid: string } }>;
      frames: { received: number; message: string }[];
    };
    expect(capture.frames, "real Ravens–Bills capture contains the mismatched book last price and asset-scoped trade").toHaveLength(28);
    expect([Number(capture.endpoints.bal!.book.last_trade_price), Number(capture.endpoints.bal!.last.price)]).toEqual([0.999, 0.002]);
    for (const [name, endpoint] of [["BAL", "bal"], ["BUF", "buf"]] as const) {
      const token = capture.tokens[name]!;
      const reference = Number(capture.endpoints[endpoint]!.mid.mid);
      const replay = feedFor(`quote-${name}`, [[token, "top"]]);
      for (const frame of capture.frames) replay.simulate(parseSocketMessage(frame.message), frame.received);
      const values = seriesOf(replay, "top");
      expect(values.length > 0 && values.every((v) => Math.abs(v.p - reference) < 1e-9), `${name}: all 28 real websocket frames agree with its midpoint, without false winner/loser reversals`).toBe(true);
      expect(values, `${name}: repeated empty-side books and matching deltas do not publish duplicate fake moves`).toHaveLength(1);
      replay.detach();
    }
  });

  it("reads an empty side as the contract's boundary, and never invents a probability", () => {
    expect([displayed(quote(null, 0.001, 0.999)), displayed(quote(0, 0.001, 0.999))], "an empty bid book and an explicit zero best bid give the same losing-token midpoint").toEqual([0.0005, 0.0005]);
    expect([displayed(quote(0.999, null, 0.001)), displayed(quote(0.999, 1, 0.001))], "an empty ask book and an explicit one best ask give the same winning-token midpoint").toEqual([0.9995, 0.9995]);
    expect([displayed(quote(null, null, null)), displayed(quote(0.2, 0.8, null)), displayed(quote(0.8, 0.2, null))], "empty, wide and crossed books without a trusted trade cannot invent a probability").toEqual([null, null, null]);
    let trusted = applyUpdate(EMPTY_QUOTE, { kind: "trade", price: 0.002 });
    trusted = applyUpdate(trusted, { kind: "book", bid: null, ask: 0.3, last: 0.999 });
    expect([trusted.last, displayed(trusted)], "replacing a wide book cannot overwrite this asset's last trade with the other outcome's book price").toEqual([0.002, 0.002]);
    trusted = applyUpdate(trusted, { kind: "trade", price: 0.999 });
    expect(displayed(trusted), "a genuine asset-scoped extreme trade is retained; no jump-size suppression").toBe(0.999);
    const sell = parseSocketMessage('{"event_type":"last_trade_price","asset_id":"bal","side":"SELL","price":"0.03"}');
    expect(sell[0], "SELL is the trade direction, never a request to complement the asset's price").toEqual({ token: "bal", update: { kind: "trade", price: 0.03 } });
  });
});
