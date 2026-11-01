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
        let merged = OddsFeed.mergingHistory(fetched, current: duringFetch, requestedAfter: initial.last?.t, now: time + 122)
        check(merged == initial + [fetched[1], duringFetch[2], duringFetch[3]],
              "history returning after live ticks fills the gap and preserves the newer observations, including an equal-time quote")
        check(OddsFeed.mergingHistory(fetched, current: initial, requestedAfter: initial.last?.t, now: time + 122)
              == initial + Array(fetched.dropFirst()), "history extends normally when no quote arrives during the request")
        let firstLoad = OddsFeed.mergingHistory(fetched, current: [duringFetch[2]], requestedAfter: nil, now: time + 122)
        check(firstLoad == Array(fetched.dropLast()) + [duringFetch[2]],
              "an initial history request also preserves a live tick that arrived before it returned")
        let quietTick = initial + [OddsPoint(t: time + 120, p: 0.5)]
        check(OddsFeed.mergingHistory(fetched, current: quietTick, requestedAfter: initial.last?.t, now: time + 122).last == quietTick.last,
              "the quiet-market ticker is not rolled back by a concurrent history response")
        check(zip(merged, merged.dropFirst()).allSatisfy { $0.t < $1.t },
              "merged history remains strictly chronological without duplicate timestamps")

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
