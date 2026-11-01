import Foundation

// "Show on {chart}" (VoiceOver's row action): which section lights a row's
// focus, by sport, and never a guess.

extension ScorelineTests {
    static func chartLinks() {
        print("\nShow on chart")
        typealias Mark = ChartLinkInputs.Mark
        let soccerRef = EventRef.espn(path: "soccer/eng.1", id: "1", sport: .soccer)
        let nbaRef = EventRef.espn(path: NBADetail.path, id: "2", sport: .basketball)
        let mlbRef = EventRef.espn(path: "baseball/mlb", id: "3", sport: .baseball)
        let nflRef = EventRef.espn(path: "football/nfl", id: "4", sport: .football)
        let climbRef = EventRef.climbing(eventID: 1, category: "Lead Women", resultURL: nil, round: "Final", eventName: "", nextURL: nil)
        let csRef = EventRef.counterStrike(slug: "s", tournament: nil)
        func route(_ focus: Focus, _ ref: EventRef, _ inputs: ChartLinkInputs) -> DetailView.Section? {
            ChartLinks.target(for: focus, sport: ref, inputs: inputs)
        }

        // Soccer: key events → the pitch if the play is on it, else the timeline.
        var soccer = ChartLinkInputs()
        soccer.shown = [.pitch, .timeline, .moments]
        soccer.pitch = [Mark(id: "goal1")]
        soccer.timeline = [Mark(id: "goal1"), Mark(id: "card9")]
        check(route(Focus(play: "goal1", period: 1, side: .top), soccerRef, soccer) == .pitch, "soccer: a goal row shows on the pitch")
        check(route(Focus(play: "card9"), soccerRef, soccer) == .timeline, "soccer: a card with no foul position shows on the timeline")
        check(route(Focus(play: "nope"), soccerRef, soccer) == nil, "soccer: a play on neither chart: no action")
        soccer.shown = [.timeline, .moments]
        check(route(Focus(play: "goal1"), soccerRef, soccer) == .timeline, "no pitch on the page: the timeline")

        // Baseball: the spray chart if a ball joins, else the linescore.
        var mlb = ChartLinkInputs()
        mlb.shown = [.linescore, .moments, .battedBalls]
        mlb.balls = [Mark(id: "ab7", period: 7, side: .top)]
        check(route(Focus(play: "ab7", period: 7, side: .top), mlbRef, mlb) == .battedBalls,
              "baseball: a scoring play with its ball in play shows on Balls in Play")
        check(route(Focus(play: "walk", period: 3, side: .bottom), mlbRef, mlb) == .linescore,
              "baseball: a play with no ball shows on the linescore")

        // NBA: players and shots → the court; other key plays → the game flow.
        var nba = ChartLinkInputs()
        nba.shown = [.court, .flow, .linescore, .leaders, .moments, .box]
        nba.shots = [Mark(id: "s1", period: 3, side: .top, player: "lebron"), Mark(id: "s2", period: 3, side: .bottom, player: "kd")]
        nba.flow = [Mark(id: "f1", period: 2)]
        check(route(Focus(player: "lebron"), nbaRef, nba) == .court, "NBA: a player row shows on the court")
        check(route(Focus(player: "bench"), nbaRef, nba) == nil, "NBA: a player with no shots: nothing to light, no action")
        check(route(Focus(play: "s1", period: 3, side: .top), nbaRef, nba) == .court, "NBA: a key play that's a shot shows on the court")
        check(route(Focus(play: "f1", period: 2, side: .top), nbaRef, nba) == .flow, "NBA: a key play that isn't a shot shows on the game flow")

        // Football: a scoring row → its quarter in the linescore.
        var nfl = ChartLinkInputs()
        nfl.shown = [.field, .linescore, .moments]
        check(route(Focus(play: "td", period: 2, side: .top), nflRef, nfl) == .linescore, "football: a scoring play shows its quarter")

        // Climbing: the ascent while a final is live, else the wall, else the scorecard.
        var climb = ChartLinkInputs()
        climb.shown = [.ascent, .wall, .results, .startlist]
        climb.ascent = [Mark(id: "7")]
        climb.wall = [Mark(id: "7"), Mark(id: "8")]
        check(route(Focus(athlete: 7), climbRef, climb) == .ascent, "climbing: a live final shows on the ascent first")
        check(route(Focus(athlete: 8), climbRef, climb) == .wall, "climbing: off the ascent, the wall's lane")
        climb.shown = [.scorecard, .results]
        climb.cards = [Mark(id: "9")]
        check(route(Focus(athlete: 9), climbRef, climb) == .scorecard, "boulder: the scorecard row")
        check(route(Focus(round: 4), csRef, ChartLinkInputs()) == nil, "CS2 has no linked charts")
    }
}
