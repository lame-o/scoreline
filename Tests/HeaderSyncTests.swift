import Foundation
import Observation

// The game page's sections kept no older than its hero (GameDetail.swift
// `HeaderLedger`, ScoreStore.swift `LaneScores`; the live check of Oct 27,
// the web's test/unit/headerSync.test.ts): the line score brought up to what
// the hero said period by period (the NBA page's Q1 went back to 12–9 while
// the total said 12–12), and the scores list given the page's newer lane
// score until the scoreboard catches up.

extension ScorelineTests {
    static func headerSync() {
        print("\nThe line score against the hero")
        func nba(_ quarters: [(String, String)], _ total: (String, String)) -> GameDetail.Linescore {
            GameDetail.Linescore(headers: quarters.indices.map { "\($0 + 1)" } + ["T"],
                                 top: quarters.map(\.0) + [total.0], bottom: quarters.map(\.1) + [total.1])
        }

        func reading(_ period: Int, _ top: Int, _ bottom: Int) -> HeaderLedger.Reading {
            HeaderLedger.Reading(period: period, top: top, bottom: bottom)
        }

        let ledger = HeaderLedger()
        ledger.observe(reading(1, 12, 9))
        ledger.observe(reading(1, 12, 12))
        // Q2 under way; the summary still has Q1 at 12–9 and no Q2 column (its T the lane's, from NBADetail.linescore).
        ledger.observe(reading(2, 12, 12))
        let line = ledger.reconciled(nba([("12", "9")], ("12", "12")))
        check(line.top == ["12", "12"] && line.bottom == ["12", "12"],
              "the NBA's Q1, read 12–12 by the lane, never goes back to the summary's 12–9 once the lane is in Q2", "\(line.bottom)")
        // A basket in Q2 before the summary has its column: in the total only, never made up in Q1.
        ledger.observe(reading(2, 14, 12))
        let later = ledger.reconciled(nba([("12", "9")], ("12", "9")))
        check(later.top == ["12", "14"] && later.bottom == ["12", "12"], "a basket in Q2 before the summary has its column: in T only",
              "\(later.top) \(later.bottom)")
        let withQ2 = ledger.reconciled(nba([("12", "9"), ("0", "0")], ("12", "9")))
        check(withQ2.top == ["12", "2", "14"] && withQ2.bottom == ["12", "0", "12"], "…and in Q2's own cell once the summary has one",
              "\(withQ2.top) \(withQ2.bottom)")

        let caughtUp = HeaderLedger()
        caughtUp.observe(reading(2, 20, 18))
        let caught = nba([("12", "12"), ("8", "6")], ("20", "18"))
        let ahead = nba([("12", "12"), ("10", "6")], ("22", "18"))
        let asIs = { (a: GameDetail.Linescore, b: GameDetail.Linescore) in a.headers == b.headers && a.top == b.top && a.bottom == b.bottom }
        check(asIs(caughtUp.reconciled(caught), caught) && asIs(caughtUp.reconciled(ahead), ahead)
              && asIs(HeaderLedger().reconciled(caught), caught),
              "a summary that has caught up (or is ahead: a correction) shows as ESPN has it")

        let inning = HeaderLedger()
        inning.observe(HeaderLedger.Reading(top: "2", bottom: "1", period: HeaderLedger.period(in: "Top 7th")))
        inning.observe(HeaderLedger.Reading(top: "3", bottom: "1", period: HeaderLedger.period(in: "Top 7th")))
        let box = GameDetail.Linescore(headers: ["1", "2", "3", "4", "5", "6", "7", "R", "H", "E"],
                                       top: ["0", "1", "0", "0", "1", "0", "0", "2", "6", "0"],
                                       bottom: ["0", "0", "1", "0", "0", "0", "", "1", "4", "1"])
        let seventh = inning.reconciled(box)
        check(seventh.top == ["0", "1", "0", "0", "1", "0", "1", "3", "6", "0"] && seventh.bottom == box.bottom,
              "baseball: a run in the top of the 7th lands in the 7th and in R; the bottom's empty cell stays empty; H and E untouched",
              "\(seventh.top) \(seventh.bottom)")

        let periods: [Int?] = ["Mid 7th", "End 12th", "3rd", "Live"].map { HeaderLedger.period(in: $0) }
        check(periods == [7, 12, 3, nil],
              "the hero's period from its text: an inning, a quarter", "\(periods)")
        check(HeaderLedger.Reading(top: "3", bottom: "", period: 2) == nil
              && HeaderLedger.Reading(top: "3", bottom: "1", period: 2) == reading(2, 3, 1),
              "its score as numbers only when both are")

        // Followers hear a new reading once (the line score redraws only then).
        final class Count: @unchecked Sendable { var said = 0 }
        let said = Count(), heard = HeaderLedger()
        func follow() { withObservationTracking { _ = heard.now } onChange: { said.said += 1 } }
        follow()
        heard.observe(reading(1, 1, 0))
        follow()
        heard.observe(reading(1, 1, 0))
        heard.observe(nil)
        check(said.said == 1 && heard.end(1) == reading(1, 1, 0), "the ledger says a new reading once", "\(said.said)")

        print("\nThe scores list beside the page")
        func live(_ top: String, _ bottom: String, _ state: EventState = .live) -> Event {
            Event(id: "espn-1", content: .match(top: comp("a", "A", top), bottom: comp("b", "B", bottom)), state: state, start: .now,
                  detail: nil, caption: nil, link: nil)
        }
        func score(_ e: Event) -> String { e.competitors.map { $0.score ?? "" }.joined(separator: "–") }
        let epoch = Date(timeIntervalSince1970: 0)
        let lane = LaneScores.Reading(top: "12", bottom: "12", at: epoch)
        let soon = epoch + 1
        let shownScores: [String] = [
            score(LaneScores.withLaneScore(live("12", "9"), lane, now: soon)),
            score(LaneScores.withLaneScore(live("12", "12"), lane, now: soon)),
            score(LaneScores.withLaneScore(live("14", "12"), lane, now: soon)),
            score(LaneScores.withLaneScore(live("12", "9", .final), lane, now: soon)),
            score(LaneScores.withLaneScore(live("12", "9"), lane, now: epoch + LaneScores.lapse + 1)),
        ]
        check(shownScores == ["12–12", "12–12", "14–12", "12–9", "12–9"],
              "shows the page's lane score while it's ahead of the scoreboard's, never behind it, for a live game, for a few minutes",
              "\(shownScores)")
        let raced = LaneScores.withLaneScore(live("12", "9"), lane, now: soon)
        check(raced.id == "espn-1" && raced.state == .live && raced.competitors.map(\.name) == ["A", "B"],
              "only the score changes: the same game, teams and state")

        var lanes = LaneScores()
        let events = [live("12", "9"), Event(id: "espn-2", content: .match(top: comp("c", "C", "3"), bottom: comp("d", "D", "1")),
                                             state: .live, start: .now, detail: nil, caption: nil, link: nil)]
        check(lanes.isEmpty && lanes.shown(events, now: .now) == events, "no lanes: the scoreboard's events as they are")
        let first = lanes.publish("espn-1", top: "12", bottom: "12", now: .now)
        let shown = lanes.shown(events, now: .now)
        let again = lanes.publish("espn-1", top: "12", bottom: "12", now: .now)
        check(first && !again && score(shown[0]) == "12–12" && shown[1] == events[1] && lanes.shown(events, now: .now) == shown,
              "one redraw per reading, and only that game's copy differs: equatable rows and tiles render only when their score does")
    }
}
