import Foundation
import SwiftUI

extension ScorelineTests {
    static func oddsInspection() {
        print("\nOdds inspection")
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        let sample = OddsSplitPoint(t: start + 30, split: OddsSplit(top: 0.6, draw: nil, bottom: 0.4))
        let data = OddsChartData(revision: 1, threeWay: false, points: [sample], domain: start...(start + 100), live: true, final: false)
        check(data.observedPoint(at: start + 29) == nil, "an inspection never borrows a future market sample")
        check(data.observedPoint(at: start + 30)?.split == sample.split && data.observedPoint(at: start + 60)?.split == sample.split,
              "inspection reports the last observed probability, including a quiet market")
        var swing = data
        swing.points.append(OddsSplitPoint(t: start + 90, split: OddsSplit(top: 0.8, draw: nil, bottom: 0.2)))
        check(swing.observedPoint(at: start + 60) == sample && swing.observedPoint(at: start + 29) == nil,
              "between samples, the reading keeps the earlier sample's real value")
        check(swing.observedPoint(at: start + 90) == swing.points.last, "an exact sample inspection uses its own timestamp")
        let middle = swing.drawn(at: start + 60)
        check(middle.map { abs($0.top - 0.7) < 1e-9 && abs($0.bottom - 0.3) < 1e-9 } == true && swing.drawn(at: start + 29) == nil,
              "the crosshair's dots sit on the drawn lines at the rule, between samples too; nothing before the first")

        // A stretch nobody observed: no reading, no line.
        var broken = data
        broken.points.append(OddsSplitPoint(t: start + 30 + OddsSeries.gap + 60, split: OddsSplit(top: 0.2, draw: nil, bottom: 0.8)))
        let inGap = start + 30 + OddsSeries.gap + 30
        check(broken.observedPoint(at: inGap) == nil && broken.drawn(at: inGap) == nil && broken.drawn(at: start + 60) == nil,
              "inside a gap there's no reading and nothing to put a dot on")
        var stale = data
        stale.points.append(OddsSplitPoint(t: start + 90, split: OddsSplit(top: 0.2, draw: nil, bottom: 0.8), unobserved: true))
        check(stale.observedPoint(at: start + 91) == nil && stale.drawn(at: start + 91) == nil,
              "a moment one outcome wasn't observed isn't a reading")

        var baseline = OddsBaseline()
        baseline.plays = [OddsPlay(t: start + 40, period: 1, clock: "Q1 10:00", text: "First score"),
                          OddsPlay(t: start + 80, period: 1, clock: "Q1 9:45", text: "Second score")]
        let before = OddsReading.at(start + 20, data: data, baseline: baseline)
        check(before != nil && before?.split == nil && before?.play == nil, "a gap has an inspectable time without a fabricated quote or play")
        let between = OddsReading.at(start + 79, data: data, baseline: baseline)
        check(between?.play?.text == "First score", "a near-future score cannot appear in the historical readout")
        check(between?.t == start + 79, "the reading keeps the moment asked for")
        check(between?.lead(top: "GSW", final: false) == "Q1 10:00 · GSW 60%", "the footer says it in plain words: where in the game, and the top team's chance")
        var withModel = data
        withModel.espn = [OddsPoint(t: start, p: 0.58)]
        baseline.plays.insert(OddsPlay(t: start, period: 1, clock: "Q1 12:00", text: "Tip"), at: 0)
        check(OddsReading.at(start + 41, data: withModel, baseline: baseline)?.lead(top: "GSW", final: false) == "Q1 10:00 · GSW 60% · ESPN 58%",
              "with ESPN's model: Q1 10:00 · GSW 60% · ESPN 58%")
        baseline.plays.removeFirst()
        let goal = TimelineMark(moment: GameDetail.Moment(id: "g", kind: .goal, clock: "38'", text: "Marcus Tavernier Goal", side: .bottom), t: start + 60)
        check(OddsReading.at(start + 60, data: data, baseline: baseline, marks: [goal])?.play?.text == "Marcus Tavernier",
              "exactly on a key play, the reading names it")

        // One recorded quote is inspected before and at the final whistle.
        // Header, source line and AX must use the same rounding policy without
        // moving that quote to the whistle or inventing a settled market price.
        let nearCertain = OddsSplitPoint(t: start + 90, split: OddsSplit(top: 0.998, draw: nil, bottom: 0.002))
        var finished = OddsChartData(revision: 2, threeWay: false, points: [nearCertain],
                                     espn: [OddsPoint(t: nearCertain.t, p: 0.998)],
                                     domain: start...(start + 100), live: false, final: true)
        let historical = OddsReading.at(start + 99, data: finished, baseline: baseline)!
        let endpoint = OddsReading.at(start + 100, data: finished, baseline: baseline)!
        let historicalFinal = finished.usesFinalPercentages(at: historical.t)
        let endpointFinal = finished.usesFinalPercentages(at: endpoint.t)
        check(!historicalFinal && endpointFinal && finished.usesFinalPercentages(at: nil),
              "only Latest and the exact final endpoint allow final percentages")
        check(historical.split?.percents(final: historicalFinal) == [.top: 99, .bottom: 1],
              "historical header and AX retain in-game caps after the event finishes")
        check(endpoint.split?.percents(final: endpointFinal) == nearCertain.split.percents(final: finished.usesFinalPercentages(at: nil))
              && endpoint.split?.percents(final: endpointFinal) == [.top: 100, .bottom: 0],
              "inspecting the exact final endpoint matches Latest market percentages")
        check(OddsSeries.percent(historical.espn!, final: historicalFinal) == 99
              && OddsSeries.percent(endpoint.espn!, final: endpointFinal) == 100,
              "ESPN source-line rounding follows the same historical and final policy")
        check(historical.split == nearCertain.split && endpoint.split == nearCertain.split
              && finished.points == [nearCertain],
              "final presentation preserves the observed market price")
        check(OddsSplit(top: 0.6, draw: nil, bottom: 0.4).percents(final: endpointFinal) == [.top: 60, .bottom: 40],
              "final formatting never fabricates a resolved winner from an unsettled quote")
        let threeWay = OddsSplit(top: 0.998, draw: 0.001, bottom: 0.001)
        check(threeWay.percents(final: historicalFinal) == [.top: 98, .draw: 1, .bottom: 1]
              && threeWay.percents(final: endpointFinal) == [.top: 100, .draw: 0, .bottom: 0],
              "three-way history and final readings share the same percentage policy")
        finished.final = false
        check(!finished.usesFinalPercentages(at: nil) && !finished.usesFinalPercentages(at: finished.domain.upperBound),
              "a live chart endpoint never enables final percentages")
        for sport in [Sport.soccer, .football, .basketball, .baseball] {
            let ref = EventRef.espn(path: sport == .basketball ? NBADetail.path : "test", id: "1", sport: sport)
            for state in [EventState.live, .final] {
                let order = DetailView.order(ref, state)
                let wide = DetailView.widePlan(ref, state)
                check(order.filter { $0 == .timeline }.count == 1 && wide.flatMap(\.sections).filter { $0 == .timeline }.count == 1,
                      "\(sport) \(state) has one timeline in narrow and wide layouts")
                let column = wide.compactMap { part -> [DetailView.Section]? in
                    guard case let .columns(left, right) = part else { return nil }
                    return left.contains(.winProbability) ? left : right.contains(.winProbability) ? right : nil
                }.first
                check(column?.contains(.timeline) == true, "\(sport) \(state) odds and timeline share the same column width")
            }
        }
    }
}
