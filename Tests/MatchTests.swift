import Foundation

// The match page from 680pt: which column each section takes, per sport and
// state, and how hidden, unlisted and lone sections are placed. Checked
// without views, through the same layout function the page uses.

extension ScorelineTests {
    static func match() {
        print("\nMatch page")
        typealias S = DetailView.Section
        let soccer = EventRef.espn(path: "soccer/eng.1", id: "1", sport: .soccer)
        let nfl = EventRef.espn(path: "football/nfl", id: "1", sport: .football)
        let mlb = EventRef.espn(path: "baseball/mlb", id: "1", sport: .baseball)
        let nba = EventRef.espn(path: NBADetail.path, id: "1", sport: .basketball)
        let cs = EventRef.counterStrike(slug: "a-vs-b", tournament: nil)
        let climbing = EventRef.climbing(eventID: 1, category: "Lead Women", resultURL: nil, round: nil, eventName: "", nextURL: nil)

        func columns(_ placed: [DetailView.PlacedSection]) -> (left: [S], right: [S], span: [S]) {
            (placed.filter { $0.slot.column == .left }.map(\.section), placed.filter { $0.slot.column == .right }.map(\.section),
             placed.filter { $0.slot.column == .span }.map(\.section))
        }
        func arrange(_ ref: EventRef, _ state: EventState, _ shown: [S]) -> [DetailView.PlacedSection] {
            DetailView.wideArrangement(shown, plan: DetailView.widePlan(ref, state))
        }

        // Linked-hover partners side by side.
        let soccerLive = columns(arrange(soccer, .live, [.pitch, .timeline, .winProbability, .stats, .table, .moments, .plays, .whereToWatch]))
        check(soccerLive.left == [.pitch, .stats, .plays] && soccerLive.right == [.timeline, .moments, .winProbability, .table, .whereToWatch],
              "soccer live: pitch, stats, plays | timeline, key events, win probability, table, where to watch",
              "\(soccerLive)")
        let nflFinal = columns(arrange(nfl, .final, [.linescore, .moments, .stats, .table, .plays]))
        check(nflFinal.left == [.linescore, .stats] && nflFinal.right == [.moments, .table, .plays],
              "football final: linescore beside the scoring plays it lights")
        let mlbLive = columns(arrange(mlb, .live, [.atPlate, .atBat, .linescore, .winProbability, .moments, .battedBalls, .plays]))
        check(mlbLive.left == [.atPlate, .atBat, .battedBalls] && mlbLive.right.first == .linescore,
              "baseball live: diamond and strike zone stack on the left; inning cells on the right")
        let climbLive = columns(arrange(climbing, .live, [.ascent, .climbingWatch, .scorecard, .results, .startlist]))
        check(climbLive.left == [.ascent, .scorecard] && climbLive.right == [.climbingWatch, .results, .startlist],
              "climbing live: the wall beside the climbers' rows")
        let csFinal = columns(arrange(cs, .final, [.maps, .rounds, .bracket, .rosters]))
        check(csFinal.left == [.maps, .rounds] && csFinal.right == [.bracket, .rosters], "CS2: series and rounds read as one story")

        // NBA: the box score opens the right column, beside the court, so a
        // player picked in it lights their shots side by side.
        let nbaShown: [S] = [.court, .flow, .linescore, .leaders, .moments, .box, .stats, .winProbability, .plays, .table,
                             .injuries, .whereToWatch]
        for state in [EventState.live, .final] {
            let placed = arrange(nba, state, nbaShown)
            let sides = columns(placed)
            let court = sides.left.firstIndex(of: .court) ?? 99
            check(sides.right.first == .box && court <= 1 && sides.left.contains(.flow) && sides.right.contains(.leaders),
                  "NBA \(state == .live ? "live" : "final"): court and box score side by side at the top", "\(sides)")
            check(Set(placed.map(\.section)).isSubset(of: Set(nbaShown)) && Set(placed.map(\.section)).count == placed.count,
                  "NBA \(state == .live ? "live" : "final"): every placed section once")
        }
        let nbaLive = arrange(nba, .live, nbaShown)
        check(Set(nbaLive.map(\.section)) == Set(nbaShown), "live: every shown section placed")
        check(nbaLive.map(\.slot.rank) == Array(nbaLive.indices), "ranks follow the page's reading order")

        // A span closes a block; hidden, its blocks merge with each column still in order.
        let spanned: [DetailView.WidePart] = [.columns(left: [.court, .winProbability], right: [.flow]), .span(.box),
                                              .columns(left: [.moments], right: [.stats])]
        let withBox = DetailView.wideArrangement([.court, .winProbability, .flow, .box, .moments, .stats], plan: spanned)
        check(withBox.map(\.section) == [.court, .winProbability, .flow, .box, .moments, .stats]
              && withBox[3].slot.column == .span, "a span sits between its blocks in child order")
        let noBox = DetailView.wideArrangement([.court, .winProbability, .flow, .moments, .stats], plan: spanned)
        let merged = MatchColumnsLayout.frames(slots: noBox.map(\.slot), width: 680, columns: 2, spacing: 0) { _, _ in 100 }
        let mergedLeft = noBox.enumerated().filter { $0.element.slot.column == .left }
            .sorted { merged.frames[$0.offset].minY < merged.frames[$1.offset].minY }.map(\.element.section)
        check(mergedLeft == [.court, .winProbability, .moments], "a hidden span merges its blocks in order", "\(mergedLeft)")

        // No holes, no empty columns.
        let hidden = columns(arrange(soccer, .final, [.timeline, .moments, .stats, .plays]))
        check(hidden.left == [.stats] && hidden.right == [.timeline, .moments, .plays], "a section with nothing to show leaves no hole")
        let speed = columns(arrange(climbing, .final, [.results, .climbingWatch]))
        check(speed.left == [.results] && speed.right == [.climbingWatch],
              "speed climbing (no wall): the right column lends the left a section")
        let cupTie = columns(arrange(soccer, .scheduled, [.whereToWatch]))
        check(cupTie.left == [.whereToWatch] && cupTie.right.isEmpty, "a lone section sits on the left, where reading starts")
        let leftOnly = columns(arrange(soccer, .final, [.pitch, .stats]))
        check(leftOnly.left == [.pitch] && leftOnly.right == [.stats], "a full left column lends the right its last section")
        let unlisted = columns(arrange(nfl, .final, [.linescore, .stats, .moments, .flow]))
        check(unlisted.right.last == .flow, "a section the plan doesn't list joins the right column of the last block")
        check(DetailView.widePlan(nil, .live).isEmpty && arrange(soccer, .live, []).isEmpty, "nothing to show, nothing placed")

        // Every planned section, every sport and state, appears once.
        let refs = [soccer, nfl, mlb, nba, cs, climbing]
        let states: [EventState] = [.scheduled, .live, .final]
        let unique = refs.allSatisfy { ref in
            states.allSatisfy { state in
                let all = DetailView.widePlan(ref, state).flatMap(\.sections)
                return Set(all).count == all.count && !all.isEmpty
            }
        }
        check(unique, "each plan lists a section at most once, for every sport and state")

        // Hero: team columns never reach their cap at 340, so the compact hero is unchanged.
        let heroAt340 = (Metrics.compactWidth - 20 - 16 - 110) / 2
        check(heroAt340 < DetailView.heroTeamWidth && 2 * DetailView.heroTeamWidth + 110 <= Metrics.maxWidth - 36,
              "hero team columns cap at 220 only on a wide panel")
        matchPolish()
    }
}
