import Foundation
import SwiftUI

extension ScorelineTests {
    static func oddsContinuity() {
        print("\nOdds continuity")
        let time = Date(timeIntervalSince1970: 1_800_000_000)
        let layout = OddsLayout(size: CGSize(width: 400, height: 139), plotHeight: 124,
                                domain: time...(time + 600), labelWidth: OddsStyle.labelWidth(["ATL", "TB", "Draw"]))
        let two: [OddsMarket.Outcome] = [.top, .bottom]
        let three: [OddsMarket.Outcome] = [.top, .draw, .bottom]
        func split(_ top: Double) -> OddsSplit { OddsSplit(top: top, draw: nil, bottom: 1 - top) }
        func point(_ seconds: Double, _ top: Double) -> OddsSplitPoint { OddsSplitPoint(t: time + seconds, split: split(top)) }
        func centers(_ labels: [OddsEndLabel]) -> [OddsMarket.Outcome: CGFloat] {
            Dictionary(uniqueKeysWithValues: labels.map { ($0.outcome, $0.y) })
        }
        func apart(_ labels: [OddsEndLabel]) -> Bool {
            let ys = labels.map(\.y).sorted()
            return zip(ys, ys.dropFirst()).allSatisfy { $1 - $0 >= OddsStyle.labelHeight - 1e-8 }
        }

        let original = OddsEndOrder.next([], split: split(0.51), outcomes: two, layout: layout)
        check(original == two, "initial end labels follow actual outcome rank")
        var order = original
        var stable = true
        var stableGeometry = true
        for value in [0.499, 0.501, 0.49, 0.51, 0.50, 0.4999, 0.5001] {
            order = OddsEndOrder.next(order, split: split(value), outcomes: two, layout: layout)
            stable = stable && order == original
            let labels = layout.endLabels(split(value), outcomes: two, order: order)
            stableGeometry = stableGeometry && apart(labels) && labels[0].y < labels[1].y
        }
        check(stable, "50/50 quote jitter never swaps outcome labels")
        check(stableGeometry, "near-tie labels stay separated in their established order")
        let reversed = OddsEndOrder.next(original, split: split(0.4), outcomes: two, layout: layout)
        check(reversed == [.bottom, .top], "a clear reversal eventually changes the outcome order")
        check(OddsEndOrder.next(reversed, split: split(0.51), outcomes: two, layout: layout) == reversed,
              "after a real reversal, a one-tick crossover does not immediately flip back")
        check(OddsEndOrder.next(reversed, split: split(0.6), outcomes: two, layout: layout) == two,
              "a clear recovery changes the order back")

        let soccerStart = OddsSplit(top: 0.34, draw: 0.33, bottom: 0.33)
        let soccerOrder = OddsEndOrder.next([], split: soccerStart, outcomes: three, layout: layout)
        let soccerNear = OddsSplit(top: 0.329, draw: 0.331, bottom: 0.34)
        let held = OddsEndOrder.next(soccerOrder, split: soccerNear, outcomes: three, layout: layout)
        check(held == soccerOrder && apart(layout.endLabels(soccerNear, outcomes: three, order: held)),
              "soccer's three-way near-tie keeps all outcome identities and spacing")
        let soccerClear = OddsSplit(top: 0.05, draw: 0.3, bottom: 0.65)
        let soccerSorted = OddsEndOrder.next(held, split: soccerClear, outcomes: three, layout: layout)
        check(soccerSorted == [.bottom, .draw, .top], "a decisive soccer move sorts all three outcomes correctly")
        check(OddsEndOrder.next(two, split: soccerStart, outcomes: three, layout: layout).count == 3,
              "switching from two to three outcomes does not inherit a stale identity list")

        let before = layout.endLabels(split(0.6), outcomes: two, order: two)
        let after = layout.endLabels(split(0.4), outcomes: two, order: reversed)
        let glide = OddsLabelGlide(from: before, to: after, start: time)
        check(centers(glide.labels(at: time, dots: after)) == centers(before),
              "a label reorder starts at the rendered centers without a 13pt snap")
        check(centers(glide.labels(at: time + OddsStyle.glide, dots: after)) == centers(after),
              "a label reorder lands exactly on the new centers")
        let interrupted = glide.labels(at: time + 0.08, dots: after)
        let next = OddsLabelGlide(from: interrupted, to: before, start: time + 0.08)
        check(centers(next.labels(at: time + 0.08, dots: before)) == centers(interrupted),
              "a fast follow-up quote restarts label motion from its visible position")
        let collision = [OddsEndLabel(outcome: .top, dot: before[0].dot, y: 62),
                         OddsEndLabel(outcome: .bottom, dot: before[1].dot, y: 62)]
        check(collision.allSatisfy { OddsEndOrder.opacity($0, among: collision) == 0 }
              && before.allSatisfy { OddsEndOrder.opacity($0, among: before) == 1 },
              "reordering labels dissolve before overlap and return when separated")

        let crossed = layout.endLabels(split(0.49), outcomes: two, order: two)
        check(OddsEndOrder.leaders(crossed).isEmpty, "near-tie leaders cannot form an apparent connector between outcomes")
        let clear = [OddsEndLabel(outcome: .top, dot: CGPoint(x: 300, y: 20), y: 14),
                     OddsEndLabel(outcome: .bottom, dot: CGPoint(x: 300, y: 100), y: 108)]
        check(OddsEndOrder.leaders(clear) == clear, "separate unambiguous labels retain their own leaders")
        let crossedLeaders = [OddsEndLabel(outcome: .top, dot: CGPoint(x: 300, y: 50), y: 75),
                              OddsEndLabel(outcome: .bottom, dot: CGPoint(x: 300, y: 70), y: 45)]
        check(OddsEndOrder.leaders(crossedLeaders).isEmpty, "leaders that cross are suppressed even when the dots are distinct")

        // The first jump is still gliding when a second quote arrives. The
        // preceding recorded value becomes 70%, but the visible dot is lower.
        let oldGlide = OddsGlide(from: split(0.4), to: split(0.7), start: time)
        let seen = oldGlide.value(at: time + 0.04)
        let previous = point(599.5, 0.7), head = point(600, 0.8)
        check(seen.top < previous.split.top, "the rapid-quote fixture reproduces a dot behind recorded history")
        check(two.allSatisfy { OddsTail.connector(previous: previous, head: head, shown: seen, outcome: $0, layout: layout).isEmpty },
              "an interrupted glide cannot draw an invented near-vertical hook back to history")
        let newGlide = OddsGlide(from: seen, to: head.split, start: time + 0.04)
        let landed = newGlide.value(at: time + 0.04 + OddsStyle.glide)
        check(two.allSatisfy { OddsTail.connector(previous: previous, head: head, shown: landed, outcome: $0, layout: layout).count == 3 },
              "the real last segment returns when the dot reaches its recorded range")
        let actual = OddsTail.connector(previous: previous, head: head, shown: head.split, outcome: .top, layout: layout)
        check(actual.first == CGPoint(x: layout.x(previous.t), y: layout.y(0.7)) && actual.last == layout.end(head.split, .top),
              "settled geometry preserves the exact historical price and latest outcome endpoint")
        let decline = point(600, 0.2)
        check(OddsTail.connector(previous: previous, head: decline, shown: split(0.45), outcome: .top, layout: layout).count == 3,
              "a genuine large odds swing remains visible; steep real movements are not erased")
        let first = OddsTail.connector(previous: nil, head: head, shown: head.split, outcome: .top, layout: layout)
        check(first.count == 2 && first.last == layout.end(head.split, .top), "a one-point market still shows its outcome endpoint")
        let soccerPrevious = OddsSplitPoint(t: time + 599, split: soccerStart)
        let soccerHead = OddsSplitPoint(t: time + 600, split: soccerClear)
        check(three.allSatisfy { outcome in
            let path = OddsTail.connector(previous: soccerPrevious, head: soccerHead, shown: soccerClear, outcome: outcome, layout: layout)
            return path.first == CGPoint(x: layout.x(soccerPrevious.t), y: layout.y(soccerStart.share(outcome)))
                && path.last == layout.end(soccerClear, outcome)
        }, "all three soccer tails stay attached to their own outcome identity")
        let feed = OddsFeed()
        let market = OddsMarket(eventID: "continuity", slug: "continuity", tokens: [
            .init(id: "home", outcome: .top), .init(id: "draw", outcome: .draw), .init(id: "away", outcome: .bottom)
        ], start: time)
        feed.adopt(market)
        feed.simulate([("home", .trade(0.5)), ("draw", .trade(0.2)), ("away", .trade(0.3))], at: time)
        feed.simulate([("home", .trade(0.4)), ("draw", .trade(0.3))], at: time + 0.5)
        let stacked = OddsSeries.stacked(top: feed.series[.top] ?? [], draw: feed.series[.draw] ?? [], bottom: feed.series[.bottom] ?? [])
        check(stacked.count == 2 && stacked.map(\.t) == [time, time + 0.5],
              "coalesced three-way quotes produce one snapshot, without microsecond intermediate prices")
        check(stacked.last?.split == OddsSplit(top: 0.4, draw: 0.3, bottom: 0.3)
              && feed.series[.top]?.last?.t == feed.series[.draw]?.last?.t,
              "changed soccer outcomes are atomic while the unchanged outcome retains its true price")
        let revision = feed.revision
        feed.simulate([("not-this-market", .trade(0.99))], at: time + 1)
        check(feed.revision == revision && feed.latest == stacked.last?.split,
              "unrelated asset IDs cannot change an outcome identity or quote")
        feed.stop()

        let initial = [OddsPoint(t: time, p: 0.4), OddsPoint(t: time + 60, p: 0.5)]
        let fetched = [OddsPoint(t: time + 60, p: 0.51), OddsPoint(t: time + 90, p: 0.55), OddsPoint(t: time + 120, p: 0.6)]
        let duringFetch = initial + [OddsPoint(t: time + 120, p: 0.7), OddsPoint(t: time + 121, p: 0.72)]
        let tail = (time + 60)...(time + 122)
        let merged = OddsFeed.mergingHistory(fetched, current: duringFetch, within: tail, now: time + 122)
        check(merged == initial + [fetched[1], duringFetch[2], duringFetch[3]],
              "history returning after live ticks fills the gap and preserves the newer observations, including an equal-time quote")
        check(OddsFeed.mergingHistory(fetched, current: initial, within: tail, now: time + 122)
              == initial + Array(fetched.dropFirst()), "history extends normally when no quote arrives during the request")
        let firstLoad = OddsFeed.mergingHistory(fetched, current: [duringFetch[2]], within: (time - 1800)...(time + 122), now: time + 122)
        check(firstLoad == Array(fetched.dropLast()) + [duringFetch[2]],
              "an initial history request also preserves a live tick that arrived before it returned")
        let quietTick = initial + [OddsPoint(t: time + 120, p: 0.5)]
        check(OddsFeed.mergingHistory(fetched, current: quietTick, within: tail, now: time + 122).last == quietTick.last,
              "the quiet-market ticker is not rolled back by a concurrent history response")
        check(zip(merged, merged.dropFirst()).allSatisfy { $0.t < $1.t },
              "merged history remains strictly chronological without duplicate timestamps")

        // A failed first request is asked again; a hole in the middle is filled, not overwritten.
        let gap = OddsSeries.gap
        let late = [OddsPoint(t: time + 3000, p: 0.6), OddsPoint(t: time + 3060, p: 0.61)]
        check(OddsFeed.holes(late, from: time, to: time + 3060, answered: []) == [time...(time + 3000)],
              "ticks arriving after a failed first request leave the game's opening still to ask for")
        check(OddsFeed.holes(late, from: time, to: time + 3060, answered: [time]).isEmpty,
              "an opening the provider has answered for, with nothing, isn't asked for again")
        check(OddsFeed.holes([], from: time, to: time + 60, answered: [time]) == [time...(time + 60)], "no data yet: ask again")
        let holed = [OddsPoint(t: time, p: 0.5), OddsPoint(t: time + gap + 60, p: 0.6)]
        check(OddsFeed.holes(holed, from: time, to: time + gap + 60, answered: []) == [time...(time + gap + 60)],
              "samples a gap apart are a hole to fill")
        check(OddsFeed.holes(holed, from: time, to: time + gap + 600, answered: [time]) == [(time + gap + 60)...(time + gap + 600)],
              "an answered hole stays a hole; the tail is always worth asking")
        let filled = OddsFeed.mergingHistory([OddsPoint(t: time + 120, p: 0.55), OddsPoint(t: time + gap + 90, p: 0.9)], current: holed,
                                             within: time...(time + gap + 60), now: time + gap + 600)
        check(filled == [holed[0], OddsPoint(t: time + 120, p: 0.55), holed[1]], "history fills only the hole, between the observations around it")

        // Unobserved time isn't drawn flat.
        let watcher = OddsFeed()
        watcher.adopt(OddsMarket(eventID: "gap", slug: "gap", tokens: [.init(id: "t", outcome: .top)], start: time))
        watcher.simulate([("t", .trade(0.5))], at: time)
        watcher.simulate([("t", .trade(0.6))], at: time + 30)
        check(watcher.series[.top]?.count == 3 && watcher.series[.top]?[1] == OddsPoint(t: time + 29, p: 0.5),
              "a quiet, observed market holds flat until it moves")
        watcher.simulate([("t", .trade(0.6))], at: time + 30 + gap + 1)
        check(watcher.series[.top]?.count == 4 && watcher.series[.top]?.last?.t == time + 30 + gap + 1,
              "after a stretch nobody saw, the line starts again, with no hold point claiming it was flat")
        watcher.stop()
        check(watcher.latestTick() == time + 30 + gap + 1 && watcher.latestTick(until: time + 40) == time + 30 && watcher.latestTick(until: time - 1) == nil,
              "the newest tick at a moment, without reading the series")
        check(watcher.ticks(after: time + 1).first == time + 29 && watcher.ticks(after: time + 30 + gap + 1).isEmpty, "the ticks still to come")
        let unspoken = OddsFeed()
        unspoken.adopt(OddsMarket(eventID: "three", slug: "three", tokens: [.init(id: "a", outcome: .top), .init(id: "b", outcome: .draw), .init(id: "c", outcome: .bottom)], start: time))
        unspoken.simulate([("a", .trade(0.5))], at: time)
        check(unspoken.latestTick() == nil, "no market moment until every outcome has spoken")
        unspoken.stop()

        // Three outcomes: one walk, and a moment one of them went unobserved breaks the line.
        let quiet = [OddsPoint(t: time, p: 0.4)]
        let busy = (0...10).map { OddsPoint(t: time + Double($0) * 60, p: 0.3) }
        let walked = OddsSeries.stacked(top: quiet + [OddsPoint(t: time + 600, p: 0.5)], draw: busy, bottom: busy)
        check(walked.count == busy.count && walked[5].unobserved == false,
              "a moment any of them moved, all three as they stood")
        let silent = OddsSeries.stacked(top: quiet, draw: busy, bottom: busy)
        check(silent[6].t == time + 360 && !silent[6].unobserved && silent[7].unobserved,
              "past a gap since an outcome was heard, the moment isn't a reading of all three")

        // A book breathing around 10¢ never saws between its midpoint and an old trade.
        var breathing = OddsQuote()
        OddsFrame.apply(.trade(0.70), to: &breathing)
        OddsFrame.apply(.book(bid: 0.44, ask: 0.46, last: nil), to: &breathing)
        check(breathing.displayed == 0.45, "tight: the midpoint")
        OddsFrame.apply(.best(bid: 0.30, ask: 0.60), to: &breathing)
        check(breathing.displayed == nil, "widened with no trade since: nothing new; the chart keeps the value it has")
        OddsFrame.apply(.trade(0.52), to: &breathing)
        check(breathing.displayed == 0.52, "a trade on a wide book is news: it's shown")
        OddsFrame.apply(.best(bid: 0.51, ask: 0.53), to: &breathing)
        OddsFrame.apply(.best(bid: 0.30, ask: 0.60), to: &breathing)
        check(breathing.displayed == nil, "and an old trade isn't again")
        let flips = OddsFeed()
        flips.adopt(OddsMarket(eventID: "flips", slug: "flips", tokens: [.init(id: "t", outcome: .top)], start: time))
        flips.simulate([("t", .trade(0.9))], at: time)
        flips.simulate([("t", .book(bid: 0.44, ask: 0.46, last: nil))], at: time + 1)
        for k in 0..<6 {
            flips.simulate([("t", .best(bid: 0.2, ask: 0.8))], at: time + 2 + Double(k) * 2)
            flips.simulate([("t", .best(bid: 0.44, ask: 0.46))], at: time + 3 + Double(k) * 2)
        }
        check(flips.series[.top]?.map(\.p).suffix(1) == [0.45] && flips.series[.top]?.filter({ $0.t > time + 1 }).isEmpty == true,
              "wide/tight flips draw no connector: one value, no sawtooth", "\(flips.series[.top]?.map(\.p) ?? [])")
        flips.stop()

        // Recorded while the installed app showed false 0→100→0 spikes.
        // Both books advertised BUF's last trade, but BAL's own trade and
        // midpoint endpoints never approached that value. Replaying every
        // full book/delta/trade catches the original recurrence, not just
        // the first snapshot.
        let captureURL = URL(fileURLWithPath: "Tests/Fixtures/odds/pm-nfl-bal-buf-2026-11-01.json")
        let capture = JSON(data: (try? Data(contentsOf: captureURL)) ?? Data())
        let capturedFrames = capture["frames"].array
        check(capturedFrames.count == 28 && capture["endpoints"]["bal"]["book"]["last_trade_price"].double == 0.999
              && capture["endpoints"]["bal"]["last"]["price"].double == 0.002,
              "real Ravens–Bills capture contains the mismatched book last price and asset-scoped trade")
        for (name, endpoint) in [("BAL", "bal"), ("BUF", "buf")] {
            let token = capture["tokens"][name].string ?? ""
            let reference = capture["endpoints"][endpoint]["mid"]["mid"].double ?? -1
            let replay = OddsFeed()
            replay.adopt(OddsMarket(eventID: "quote-\(name)", slug: "quote-\(name)", tokens: [.init(id: token, outcome: .top)], start: time))
            for frame in capturedFrames {
                let at = Date(timeIntervalSince1970: (frame["received"].double ?? 0) / 1000)
                replay.simulate(OddsFrame.parse(frame["message"].string ?? ""), at: at)
            }
            let values = replay.series[.top] ?? []
            check(!token.isEmpty && !values.isEmpty && values.allSatisfy { abs($0.p - reference) < 1e-9 },
                  "\(name): all 28 real websocket frames agree with its midpoint, without false winner/loser reversals",
                  "\(values.map(\.p)) vs \(reference)")
            check(values.count == 1, "\(name): repeated empty-side books and matching deltas do not publish duplicate fake moves")
            replay.stop()
        }
        check(OddsQuote(bid: nil, ask: 0.001, last: 0.999).displayed == 0.0005
              && OddsQuote(bid: 0, ask: 0.001, last: 0.999).displayed == 0.0005,
              "an empty bid book and an explicit zero best bid give the same losing-token midpoint")
        check(OddsQuote(bid: 0.999, ask: nil, last: 0.001).displayed == 0.9995
              && OddsQuote(bid: 0.999, ask: 1, last: 0.001).displayed == 0.9995,
              "an empty ask book and an explicit one best ask give the same winning-token midpoint")
        check(OddsQuote(bid: nil, ask: nil, last: nil).displayed == nil
              && OddsQuote(bid: 0.2, ask: 0.8, last: nil).displayed == nil
              && OddsQuote(bid: 0.8, ask: 0.2, last: nil).displayed == nil,
              "empty, wide and crossed books without a trusted trade cannot invent a probability")
        var trusted = OddsQuote()
        OddsFrame.apply(.trade(0.002), to: &trusted)
        OddsFrame.apply(.book(bid: nil, ask: 0.3, last: 0.999), to: &trusted)
        check(trusted.last == 0.002 && trusted.displayed == 0.002,
              "replacing a wide book cannot overwrite this asset's last trade with the other outcome's book price")
        OddsFrame.apply(.trade(0.999), to: &trusted)
        check(trusted.displayed == 0.999, "a genuine asset-scoped extreme trade is retained; no jump-size suppression")
        let sell = OddsFrame.parse("{\"event_type\":\"last_trade_price\",\"asset_id\":\"bal\",\"side\":\"SELL\",\"price\":\"0.03\"}")
        check(sell.first?.asset == "bal" && sell.first?.update == .trade(0.03),
              "SELL is the trade direction, never a request to complement the asset's price")
    }
}
