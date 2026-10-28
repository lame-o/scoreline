import Foundation
import SwiftUI

// The match page's last polish: one rule for overtime names, one field
// geometry, worst-case layouts (long linescores, 32-team brackets, 80
// climbers) and what VoiceOver says about each chart.

extension ScorelineTests {
    static func matchPolish() {
        print("\nMatch page polish")

        // Overtimes are "OT", "2OT", "7OT" everywhere: scoring plays, linescore, peek, NBA.
        check(ESPNDetail.periodName(4, sport: .football) == "Q4" && ESPNDetail.periodName(5, sport: .football) == "OT"
              && ESPNDetail.periodName(6, sport: .football) == "2OT" && ESPNDetail.periodName(11, sport: .football) == "7OT",
              "a scoring play's period: Q4, OT, 2OT … 7OT (never OT for every overtime)")
        check(ESPNDetail.periodHeader(7, sport: .football) == "3OT" && ESPNDetail.periodHeader(12, sport: .baseball) == "12",
              "linescore headers: 3OT in football, the inning in baseball")
        check(NBADetail.periodName(5) == "OT" && NBADetail.periodName(8) == "4OT", "NBA: OT, then 4OT")
        var peekInputs = PeekInputs()
        peekInputs.flow = [PeekInputs.Mark(id: "f1", period: 6, side: .top)]
        check(PeekRouter.readout(for: Focus(period: 6), target: .flow, inputs: peekInputs)?.lead == "2OT",
              "the peek names the second overtime 2OT (it said OT2)")

        // Game Flow: four five-minute overtimes at 340 share one name.
        let narrow = { (t: Double) -> CGFloat in 30 + 270 * CGFloat(t / NBADetail.periodStart(9)) }
        let labels = GameFlowView.periodLabels(periods: 8, x: narrow).map(\.text)
        check(labels == ["Q1", "Q2", "Q3", "Q4", "4OT"], "4OT at 340: the overtimes are named once, over their span", "\(labels)")
        let wide = { (t: Double) -> CGFloat in 30 + 700 * CGFloat(t / NBADetail.periodStart(6)) }
        check(GameFlowView.periodLabels(periods: 5, x: wide).map(\.text) == ["Q1", "Q2", "Q3", "Q4", "OT"],
              "one overtime with room: its own name")

        // The football field: the tile and the match page draw the same lines.
        let teams = FootballFeed.Teams(topIsHome: false, topID: "11", bottomID: "16", homeAbbreviation: "MIN", awayAbbreviation: "IND")
        let goal = FootballFeed.situation(JSON(["yardLine": 95, "down": 1, "distance": 10, "isRedZone": true]),
                                          possessionTeam: "16", teams: teams, lastPlay: nil)
        let tile = FootballGeometry.spot(yardLine: 95, down: 1, distance: 10, possession: .bottom, topIsHome: false, redZone: true)
        check(goal?.downDistance == "1st & Goal at IND 5" && goal?.lineToGainX == nil && tile.lineToGainX == nil,
              "1st & Goal: no first-down line on the field or the tile", "\(String(describing: goal?.lineToGainX))")
        let third = FootballFeed.situation(JSON(["yardLine": 60, "down": 3, "distance": 4, "isRedZone": false]),
                                           possessionTeam: "11", teams: teams, lastPlay: nil)
        let thirdTile = FootballGeometry.spot(yardLine: 60, down: 3, distance: 4, possession: .top, topIsHome: false, redZone: false)
        check(third?.ballX == thirdTile.ballX && third?.lineToGainX == thirdTile.lineToGainX, "3rd & 4: the same spot and line")

        // What VoiceOver says about the charts: full names, words for the numbers.
        let line = GameDetail.Linescore(headers: ["1", "2", "3", "R", "H", "E"], top: ["0", "2", "1", "3", "9", "1"],
                                        bottom: ["1", "0", "0", "1", "4", "0"])
        check(LinescoreGrid.spoken(line, totals: 3, top: "Yankees", bottom: "Guardians")
              == "Yankees: 3 runs, 9 hits, 1 error. By inning: 0, 2, 1. Guardians: 1 run, 4 hits, 0 errors. By inning: 1, 0, 0.",
              "linescore: totals first, then each inning", LinescoreGrid.spoken(line, totals: 3, top: "Yankees", bottom: "Guardians"))
        let ot = GameDetail.Linescore(headers: ["1", "2", "3", "4", "OT", "2OT", "T"], top: ["7", "7", "0", "3", "3", "6", "26"],
                                      bottom: ["0", "7", "7", "3", "3", "0", "20"])
        check(LinescoreGrid.spoken(ot, totals: 1, top: "Chiefs", bottom: "Bills").hasPrefix("Chiefs: 26 points. By period: 7, 7, 0, 3, overtime 3, overtime 2 6."),
              "football: points, then the quarters and each overtime named", LinescoreGrid.spoken(ot, totals: 1, top: "Chiefs", bottom: "Bills"))
        check(StatBars.spoken(GameDetail.Stat(label: "Possession", top: "58%", bottom: "42%", topShare: 0.58), top: "Arsenal", bottom: "Chelsea")
              == "Possession: Arsenal 58%, Chelsea 42%. Arsenal leads.", "team stats say whose number is whose, and who leads")
        check(StatBars.spoken(GameDetail.Stat(label: "Corners", top: "4", bottom: "4", topShare: 0.5), top: "Arsenal", bottom: "Chelsea")
              == "Corners: Arsenal 4, Chelsea 4.", "level: nobody leads")

        // The hero's words.
        let soon = Date(timeIntervalSince1970: 1_000_000)
        check(DetailView.spokenCountdown(to: soon.addingTimeInterval(31 * 60 + 45), from: soon) == "Starts in 31 minutes, 45 seconds"
              && DetailView.spokenCountdown(to: soon.addingTimeInterval(2 * 3600 + 60), from: soon) == "Starts in 2 hours, 1 minute",
              "the countdown, spoken")
        let late = Event(id: "x", content: .match(top: comp("a", "A"), bottom: comp("b", "B")), state: .scheduled,
                         start: .now.addingTimeInterval(-600), detail: nil, caption: nil, link: nil, ref: nil)
        let round = Event(id: "y", content: .field(title: "Final", summary: ""), state: .scheduled,
                          start: .now.addingTimeInterval(-600), detail: nil, caption: nil, link: nil, ref: nil)
        check(DetailView.notStarted(late) == "Starting soon" && DetailView.notStarted(round) == "Time TBA",
              "a start that's passed: Starting soon (a match), Time TBA (a round)")
        check(Spoken.status("Final/OT") == "Final, overtime" && Spoken.status("FT") == "Full time",
              "the hero's final status in words (one helper: Spoken.status)")

        // Long linescores scroll only when the grid can't fit: 9 innings fit at 340, 18 don't.
        let nine = GameDetail.Linescore(headers: (1...9).map(String.init) + ["R", "H", "E"],
                                        top: Array(repeating: "0", count: 9) + ["3", "9", "1"], bottom: Array(repeating: "1", count: 9) + ["9", "12", "0"])
        let eighteen = GameDetail.Linescore(headers: (1...18).map(String.init) + ["R", "H", "E"],
                                            top: Array(repeating: "0", count: 18) + ["23", "31", "2"], bottom: Array(repeating: "1", count: 18) + ["21", "27", "4"])
        check(LinescoreGrid.naturalWidth(nine, totals: 3, names: ("ARI", "CLE")) <= 312
              && LinescoreGrid.naturalWidth(eighteen, totals: 3, names: ("ARI", "CLE")) > 312,
              "a 9-inning linescore fits a 340 panel; 18 innings scroll (names and R H E stay put)")
        let sevenOT = GameDetail.Linescore(headers: ["1", "2", "3", "4", "OT", "2OT", "3OT", "4OT", "5OT", "6OT", "7OT", "T"],
                                           top: ["0", "21", "7", "13", "7", "7", "3", "6", "2", "2", "4", "72"],
                                           bottom: ["7", "14", "10", "10", "7", "7", "3", "6", "2", "2", "6", "74"])
        let fourOT = GameDetail.Linescore(headers: ["1", "2", "3", "4", "OT", "2OT", "3OT", "4OT", "T"],
                                          top: ["31", "28", "30", "27", "8", "10", "7", "7", "148"], bottom: ["29", "30", "28", "29", "8", "10", "7", "9", "150"])
        check(LinescoreGrid.naturalWidth(sevenOT, totals: 1, names: ("USM", "USA")) > 312
              && LinescoreGrid.naturalWidth(fourOT, totals: 1, names: ("POR", "MIN")) <= 312,
              "7 college overtimes scroll at 340; an NBA 4OT game still fits")

        // This At-Bat names every pitch the same way: the longest form all of them fit.
        let curve = GameDetail.Pitch(id: "1", number: 12, x: 0, y: 0, result: .ball, type: "KC", typeName: "Knuckle curve", mph: 80)
        let heater = GameDetail.Pitch(id: "2", number: 13, x: 0, y: 0, result: .strike, type: "FF", typeName: "Four-seam fastball", mph: 98)
        let pitchNames = [curve, heater].map(StrikeZoneView.names)
        check(pitchNames[1] == ["Four-Seam Fastball", "Four-Seam", "FF"], "a pitch's names: MLB's full name, short, and Statcast's code")
        let results = [GameDetail.Pitch.Strike.called, .swinging, .foul, .foulTip].map {
            StrikeZoneView.resultWord(GameDetail.Pitch(id: "3", number: 1, x: 0, y: 0, result: .strike, type: nil, typeName: nil, mph: nil, strike: $0))
        }
        check(results == ["Called", "Swinging", "Foul", "Foul tip"], "a strike says how it came", "\(results)")
        check(StrikeZoneView.name(pitchNames[1], room: 200) == "Four-Seam Fastball" && StrikeZoneView.name(pitchNames[1], room: 80) == "Four-Seam"
              && StrikeZoneView.name(pitchNames[0], room: 30) == "KC",
              "a pitch steps from its full name to its short one to its code (never \"Knuckl…\")")

        // Hero names: the size steps down only when the longest word wouldn't fit.
        let wolves = HeroName.longestWords(["Brighton & Hove Albion", "Wolverhampton Wanderers"])
        check(HeroName.size(longestWords: wolves, room: 200) == 12 && HeroName.size(longestWords: wolves, room: wolves[2]) == 11
              && HeroName.size(longestWords: wolves, room: 10) == 10.5,
              "a hero name keeps 12pt while its longest word fits; steps down to fit; never below 10.5")

        // Brackets: 32 teams at 340 scroll at a readable width, opening on the round being played.
        check(BracketView.cellWidth(in: 312, rounds: 5) < BracketView.minCell && BracketView.minCell >= 96,
              "a 32-team tree at 340 is narrower than a readable cell: it scrolls instead")
        var matches: [String: BracketMatch] = [:]
        let a = BracketTeam(id: "1", name: "Yankees", abbreviation: "NYY", logo: nil)
        let b = BracketTeam(id: "2", name: "Guardians", abbreviation: "CLE", logo: nil)
        matches["q1"] = BracketMatch(id: "q1", top: a, bottom: b, topScore: 3, bottomScore: 1, winner: .top)
        matches["q2"] = BracketMatch(id: "q2", top: b, bottom: a, live: true)
        matches["f"] = BracketMatch(id: "f", feeders: ["q1", "q2"])
        let bracket = Bracket(rounds: ["Semifinals", "Final"], matches: matches, finalID: "f")
        check(BracketView.focusColumn(bracket, layout: BracketLayout(bracket)) == 0, "the live round is where the scrolled tree opens")
        check(BracketView.spoken(matches["q1"]!, round: "Semifinals") == "Semifinals: Yankees 3, Guardians 1. Yankees won."
              && BracketView.spoken(matches["q2"]!, round: "Semifinals") == "Semifinals: Guardians versus Yankees. Live."
              && BracketView.spoken(matches["f"]!, round: "Final") == "Final: to be decided.",
              "each matchup is one spoken element: result, live, or to be decided")

        // Climbing: 80 climbers on a lead route label only what fits.
        typealias Climber = GameDetail.WallRoute.Climber
        let field = (0..<80).map { i in
            Climber(id: i, name: "Climber \(i)", country: i == 70 ? "USA" : "FRA", flag: nil, height: Double(48 - i / 2),
                    top: false, label: "\(48 - i / 2)", rank: i + 1)
        }
        let capacity = LeadAscentView.labelCapacity(height: LeadAscentView.plotHeight(.compact))
        let shown = LeadAscentView.labeled(field, yours: ["USA"], capacity: capacity)
        check(shown.count == capacity && shown.contains(0) && shown.contains(70) && !shown.contains(capacity),
              "labels: the best placed plus your country's climber, as many as fit (\(capacity))")
        check(LeadAscentView.labeled(Array(field.prefix(5)), yours: [], capacity: capacity).count == 5, "a final's few climbers: every one labeled")
        let stacked = LeadAscentView.labelPositions(Array(repeating: 20, count: 30), gap: 13, floor: 242, ceiling: 12)
        check((stacked.first ?? 0) >= 12, "a crowded stack never rises above the wall's top", "\(stacked.first ?? 0)")
    }
}
