import Foundation

// The match page's celebrations (1A): the state rules (two-minute drill,
// batting team, CS2 map point), detection (every climber passed and the
// climb's span, a new leader, the medal zone, a final decided once, a series
// won, a boulder flash), live rank deltas, and the hero's beats (the digit pop
// waits for its number, the final whistle defers to a decisive score).

extension ScorelineTests {
    static func celebrateMatch() {
        print("\nCelebrations: match page")
        typealias Climber = GameDetail.WallRoute.Climber

        // MARK: Scorer

        func moment(_ kind: LiveMoment.Kind, side: GameDetail.Side?) -> LiveMoment {
            LiveMoment(id: "m", chart: .field, tier: .score, kind: kind, lead: "", detail: "", side: side)
        }
        check(MatchRules.scorer(of: moment(.touchdown, side: .top)) == .top
              && MatchRules.scorer(of: moment(.safety, side: .top)) == .bottom
              && MatchRules.scorer(of: moment(.goal, side: nil)) == nil,
              "scorer: the moment's side, but a safety scores for the defense")

        // MARK: Two-minute drill

        let drill = MatchRules.twoMinuteDrill
        check(drill(4, 119, .top, 17, 24) && drill(4, 120, .bottom, 21, 20) && drill(5, 60, .top, 20, 23),
              "2-MIN DRILL: Q4 or OT, 2:00 or less, the team with the ball down 1–8")
        check(!drill(4, 121, .top, 17, 24) && !drill(3, 60, .top, 17, 24) && !drill(4, 60, .top, 24, 17)
              && !drill(4, 60, .top, 17, 17) && !drill(4, 60, .top, 10, 19) && !drill(4, 0, .top, 17, 24)
              && !drill(4, 60, nil, 17, 24),
              "no drill: 2:01, Q3, leading, tied, down 9, clock at 0:00, nobody has the ball")

        // MARK: Batting team

        let bats = MatchRules.battingSide
        check(bats("Top 7th", false) == .top && bats("Bot 7th", false) == .bottom
              && bats("Top 1st", true) == .bottom && bats("Bottom 9th", true) == .top,
              "batting team: top of the inning is the away team, bottom the home team")
        check(bats("Mid 7th", false) == nil && bats("End 9th", true) == nil && bats(nil, true) == nil && bats("Top 7th", nil) == nil,
              "nobody batting between halves or without the home side")

        // MARK: CS2 map point

        check([(11, 10), (12, 12), (14, 13), (15, 15), (17, 16), (18, 18)].map { MatchRules.mapTarget(top: $0.0, bottom: $0.1) }
              == [13, 16, 16, 19, 19, 22], "rounds to win: 13, then 16, 19, 22 through overtime")
        let point = MatchRules.mapPoint
        check(point(12, 11) == .top && point(11, 12) == .bottom && point(12, 12) == nil && point(15, 14) == .top
              && point(15, 15) == nil && point(17, 18) == .bottom && point(12, 3) == .top && point(0, 0) == nil,
              "map point at 12–11, 15–14, 18–17; none at 12–12 or 15–15",
              "\([point(12, 11), point(12, 12), point(15, 14), point(15, 15), point(17, 18)])")

        // MARK: CS2 series

        func map(_ n: Int, _ winner: GameDetail.Side?, live: Bool = false) -> GameDetail.MapResult {
            GameDetail.MapResult(number: n, name: "Map \(n)", topScore: nil, bottomScore: nil, winner: winner, live: live)
        }
        let bo3 = [map(1, .top), map(2, nil, live: true), map(3, nil)]
        check(MatchRules.series(after: 2, winner: .top, maps: bo3).map { ($0.wins, $0.losses, $0.clinched) } ?? (0, 0, false) == (2, 0, true)
              && MatchRules.series(after: 2, winner: .bottom, maps: bo3)?.clinched == false
              && MatchRules.series(after: 1, winner: .bottom, maps: [map(1, nil, live: true)])?.clinched == true
              && MatchRules.series(after: 1, winner: .top, maps: []) == nil,
              "series: 2–0 in a best of 3 clinches, 1–1 doesn't, a best of 1 does; no maps, no call")
        func live(_ t: Int, _ b: Int, ended: Bool = false, map: Int = 2) -> GameDetail.CSLive {
            GameDetail.CSLive(mapName: "Mirage", mapNumber: map, round: t + b, topScore: t, bottomScore: b,
                              topSide: "CT", bottomSide: "T", mapEnded: ended)
        }
        let names = (top: "NAVI", bottom: "FaZe")
        let won = MatchRules.csMoments(from: live(12, 9), to: live(13, 9, ended: true), names: names, maps: bo3)
        check(won.count == 1 && won[0].kind == .mapWon && won[0].tier == .score && won[0].decisive && won[0].side == .top
              && won[0].lead == "Series won" && won[0].detail == "NAVI take Mirage 13–9 and the series 2–0",
              "the map that wins the series is decisive: “Series won”", won.first.map { "\($0.lead) · \($0.detail)" } ?? "none")
        let level = MatchRules.csMoments(from: live(9, 12), to: live(9, 13, ended: true), names: names, maps: bo3)
        check(level.count == 1 && !level[0].decisive && level[0].lead == "Map won" && level[0].side == .bottom,
              "a map won that levels the series isn't decisive")
        let round = MatchRules.csMoments(from: live(11, 10), to: live(12, 10), names: names, maps: bo3)
        check(round.count == 1 && round[0].kind == .roundWon && round[0].tier == .swing && round[0].id == "cs:2:22",
              "a round won is a swing moment, keyed by rounds played")
        check(MatchRules.csMoments(from: live(11, 10, map: 1), to: live(0, 0, map: 2), names: names, maps: bo3).isEmpty,
              "a new map isn't a moment")

        // MARK: Climbing: passing, new leader, medal zone

        func climber(_ id: Int, _ height: Double, top: Bool = false, onWall: Bool = false, rank: Int? = nil) -> Climber {
            Climber(id: id, name: "C\(id)", country: "SLO", flag: nil, height: height, top: top,
                    label: top ? "TOP" : "\(Int(height))", rank: rank, onWall: onWall)
        }
        func detail(_ climbers: [Climber], total: Int = 8, round: String = "Final") -> GameDetail {
            var d = GameDetail()
            d.wall = [GameDetail.WallRoute(name: "1", climbers: climbers, total: total)]
            d.roundName = round
            return d
        }
        // Finished: 41 (5), 38+ (1), 36 (4), 33 (2), 20 (6). Climber 9 goes 30 → 39.
        let done = [climber(5, 41), climber(1, 38.5), climber(4, 36), climber(2, 33), climber(6, 20)]
        let before = detail(done + [climber(9, 30, onWall: true)])
        let after = detail(done + [climber(9, 39, onWall: true)])
        let pass = MatchRules.climbingMoments(from: before, to: after).first { $0.kind == .passed }
        check(pass?.id == "pass:9:1" && pass?.targets == ["2", "4", "1"] && pass?.span == 30...39,
              "a pass names every climber passed, lowest first, and the climb's span",
              "\(pass?.id ?? "none") \(pass?.targets ?? []) \(String(describing: pass?.span))")
        check(pass?.accents == .podium && pass?.tier == .swing && pass?.detail == "C9 · now 2nd",
              "into the medal zone for the first time (5th → 2nd): podium, still a swing")
        let lead = MatchRules.climbingMoments(from: after, to: detail(done + [climber(9, 42, onWall: true)]))
            .first { $0.kind == .passed }
        check(lead?.accents == .newLeader && lead?.tier == .score && lead?.lead == "Takes the lead" && lead?.targets == ["5"],
              "a new leader in a final is the round's score (and already in the medal zone: no second podium)",
              "\(String(describing: lead?.accents.rawValue)) \(String(describing: lead?.tier))")
        let semi = MatchRules.climbingMoments(from: detail(done + [climber(9, 30, onWall: true)], round: "Semi-final"),
                                              to: detail(done + [climber(9, 42, onWall: true)], round: "Semi-final"))
            .first { $0.kind == .passed }
        check(semi?.accents == .newLeader && semi?.tier == .swing && semi?.lead == "Passes C5",
              "a new leader in a semi-final is a swing; no medal zone outside a final")
        // A top passes everyone below it, up to the plot's scale.
        let topped = MatchRules.climbingMoments(from: before, to: detail(done + [climber(9, 50, top: true, onWall: true)]))
        let top = topped.first { $0.kind == .top }
        check(topped.count == 1 && top?.tier == .score && top?.targets == ["2", "4", "1", "5"]
              && top?.span == 30...MatchRules.plotScale(after.wall[0]) && top?.accents == [.newLeader, .podium],
              "a top (single route): the score, with every climber it passed; no separate pass",
              "\(topped.map(\.id)) \(top?.targets ?? [])")
        check(MatchRules.plotScale(after.wall[0]) == 45 && MatchRules.plotScale(detail([climber(1, 44.5)]).wall[0]) == 49,
              "the plot's scale: at least 45 holds, 4 above the best high point")

        // MARK: Climbing: the final decided, once

        let last = detail([climber(5, 41, rank: 2), climber(9, 44, rank: 1), climber(4, 36, rank: 3), climber(7, 20, onWall: true)], total: 4)
        let down = detail([climber(5, 41, rank: 2), climber(9, 44, rank: 1), climber(4, 36, rank: 3), climber(7, 22, rank: 4)], total: 4)
        let decided = MatchRules.climbingMoments(from: last, to: down)
        let gold = decided.first { $0.id == "decided:1" }
        check(gold?.decisive == true && gold?.tier == .score && gold?.targets == ["9"] && gold?.chart == .ascent
              && decided.contains { $0.id == "done:7" },
              "the last starter down decides the final: decisive, from the winner's mark (alongside their finish)")
        check(MatchRules.climbingMoments(from: down, to: down).isEmpty
              && !MatchRules.climbingMoments(from: detail(last.wall[0].climbers, total: 4, round: "Semi-final"),
                                             to: detail(down.wall[0].climbers, total: 4, round: "Semi-final")).contains { $0.decisive },
              "decided fires once, and only in a final")
        check(MatchRules.decided(down.wall) && !MatchRules.decided(last.wall) && !MatchRules.decided(down.wall + down.wall)
              && !MatchRules.decided([GameDetail.WallRoute(name: "1", climbers: [], total: 0)]),
              "decided: one route, all its starters, nobody on the wall")
        check(MatchRules.isFinalRound("Final") && MatchRules.isFinalRound("Women's Final") && !MatchRules.isFinalRound("Semi-final")
              && !MatchRules.isFinalRound("Semifinal") && !MatchRules.isFinalRound("Qualification") && !MatchRules.isFinalRound(nil),
              "a final is a final, not a semi")

        // MARK: Boulder flash

        func card(_ reach: GameDetail.BoulderCard.Reach, tries: Int?) -> GameDetail.BoulderCard {
            GameDetail.BoulderCard(id: 3, rank: 1, name: "Mori", country: "JPN", flag: nil,
                                   problems: [.init(reach: reach, tries: tries)], score: nil)
        }
        var b0 = GameDetail(), b1 = GameDetail(), b2 = GameDetail()
        b0.boulders = [card(.none, tries: nil)]
        b1.boulders = [card(.top, tries: 1)]
        b2.boulders = [card(.top, tries: 3)]
        check(MatchRules.climbingMoments(from: b0, to: b1).first?.accents == .flash
              && MatchRules.climbingMoments(from: b0, to: b2).first?.accents == [],
              "a boulder topped on the first attempt is a flash")

        // MARK: Rank deltas

        func athlete(_ id: Int, _ rank: Int?) -> GameDetail.Athlete {
            GameDetail.Athlete(id: id, rank: rank, name: "A\(id)", country: nil, score: nil)
        }
        let deltas = MatchRules.rankDeltas(from: [athlete(1, 1), athlete(2, 2), athlete(3, 3), athlete(5, nil)],
                                           to: [athlete(4, 1), athlete(1, 2), athlete(3, 3), athlete(2, 4), athlete(5, 5)])
        check(deltas == [1: -1, 2: -2], "rank deltas: places lost or gained; new, unchanged and unranked show none", "\(deltas)")

        // MARK: Hero beats

        let t0 = Date(timeIntervalSinceReferenceDate: 0)
        var beats = HeroBeats()
        beats.score(.top, decisive: false, at: t0)
        check(beats.pops(.top) == 0 && beats.washPulses == 1 && beats.washSide == .top && beats.glints == 0,
              "a score lifts the wash now; the digits wait for their number")
        beats.scoreRose(.top, at: t0.addingTimeInterval(20))
        check(beats.pops(.top) == 1 && beats.pops(.bottom) == 0, "the number arrives 20 s later: it pops then (soccer)")
        beats.scoreRose(.bottom, at: t0.addingTimeInterval(30))
        beats.score(.bottom, decisive: true, at: t0.addingTimeInterval(30))
        check(beats.pops(.bottom) == 1 && beats.glints == 1 && beats.washSide == .bottom,
              "number and moment together (football's lane): one pop; decisive adds the glint")
        beats.score(.bottom, decisive: false, at: t0.addingTimeInterval(60))
        check(beats.pops(.bottom) == 1, "a change already used doesn't pop the next moment")
        beats.scoreRose(.bottom, at: t0.addingTimeInterval(110))
        check(beats.pops(.bottom) == 1, "a moment waits 45 s for its number, no longer")
        let skipped = beats.final(winner: .bottom, bothSides: false, trophy: true, at: t0.addingTimeInterval(80))
        check(!skipped && beats.trophies == 1 && beats.glints == 1 && beats.pops(.bottom) == 1,
              "the final whistle right after a decisive score: the trophy, no second beat")
        let played = beats.final(winner: .top, bothSides: false, trophy: false, at: t0.addingTimeInterval(500))
        check(played && beats.pops(.top) == 2 && beats.glints == 2 && beats.washSide == .top,
              "the final whistle: the winner's number pops, their wash lifts, the glint sweeps")
        var climbing = HeroBeats()
        climbing.score(nil, decisive: false, at: t0)
        climbing.final(winner: nil, bothSides: true, trophy: true, at: t0.addingTimeInterval(200))
        check(climbing.washPulses == 2 && climbing.washSide == nil && climbing.pops(.top) == 0 && climbing.glints == 1,
              "climbing: both flag colors pulse; no digits to pop")
        var draw = HeroBeats()
        draw.final(winner: nil, bothSides: false, trophy: false, at: t0)
        check(draw.washPulses == 0 && draw.glints == 1, "a draw: just the glint")

        // MARK: Final

        let rams = Competitor(id: "1", name: "Rams", abbreviation: "LAR", score: "16", logo: nil, isWinner: true)
        let cards = Competitor(id: "2", name: "Cardinals", abbreviation: "ARI", score: "15", logo: nil, isWinner: false)
        let even = Competitor(id: "2", name: "Cardinals", abbreviation: "ARI", score: "15", logo: nil, isWinner: false)
        check(MatchRules.winner(top: cards, bottom: rams, scores: ("15", "16")) == .bottom
              && MatchRules.winner(top: even, bottom: even, scores: ("2", "1")) == .top
              && MatchRules.winner(top: even, bottom: even, scores: ("1", "1")) == nil,
              "the winner: the result flags, else the higher score; a draw has none")
        check(MatchRules.finalAnnouncement(top: ("Cardinals", "15"), bottom: ("Rams", "16"), winner: .bottom) == "Final. Rams win, 16 to 15."
              && MatchRules.finalAnnouncement(top: ("Villa", "1"), bottom: ("City", "1"), winner: nil) == "Final. 1 to 1.",
              "the final whistle, said aloud")
    }
}
