import SwiftUI

// The soccer theater between its big moments, checked on real matches
// (Tests/Fixtures/soccer-events-plays.json: Aston Villa v Manchester City,
// Sunderland v Leeds, Crystal Palace v Newcastle, Valencia v Villarreal):
// every event ESPN logs parsed into what the theater shows (the corner and
// its side, the foul and its spot, the man booked where he fouled, the
// substitution, the man hurt, VAR's check and decision, the halves, the
// added time the commentary announces), every shot a moment, a shot's spot
// and aim from its words when ESPN didn't place it; and choreographed: the
// corner from its own flag, the card at the foul, the ends changed at half
// time, the ball going round the team that has it in its own formation, in
// sparse beats round a loop, the tags saying what's happening.

extension ScorelineTests {
    static func soccerIdle() {
        print("\nSoccer between moments")
        guard let data = try? Data(contentsOf: FixtureProtocol.directory.appendingPathComponent("soccer-events-plays.json")) else {
            return check(false, "soccer events fixture loads")
        }
        let matches = JSON(data: data)["matches"].array
        struct Found {
            let event: SoccerEvent
            let clip: [JSON]
            let index: Int
            let home: String?
            let lineups: [GameDetail.Side: SoccerLineup]
        }
        func lineups(_ m: JSON) -> [GameDetail.Side: SoccerLineup] {
            SoccerLineup.lineups(m["rosters"]) { $0 == m["home"]["id"].string ? .top : .bottom }
        }
        /// The entry of this type at this minute (with words, if any are given), parsed as an event.
        func find(_ match: Int, _ type: String, _ minute: String, _ clue: String = "") -> Found? {
            let m = matches[match], home = m["home"]["id"].string
            for clip in m["clips"].array.map(\.array) {
                guard let i = clip.firstIndex(where: { $0["type"]["type"].string == type && $0["clock"]["displayValue"].string == minute
                    && (clue.isEmpty || ($0["text"].string ?? "").contains(clue)) }),
                      let e = SoccerEvent.parse(clip, at: i, homeTeamID: home, order: i) else { continue }
                return Found(event: e, clip: clip, index: i, home: home, lineups: lineups(m))
            }
            return nil
        }
        func near(_ a: CGPoint?, _ b: CGPoint?, _ tolerance: Double) -> Bool {
            guard let a, let b else { return false }
            return hypot(a.x - b.x, a.y - b.y) <= tolerance
        }
        let villa = SoccerStatus.Names(top: "Aston Villa", bottom: "Manchester City", topColor: "660e36", bottomColor: "99c5ea")

        // MARK: Every event

        let corner = find(0, "corner-awarded", "4'")
        check(corner?.event.kind == .corner && corner?.event.side == .top && (corner?.event.at?.y ?? 0) > Pitch.width / 2,
              "Villa's corner at 4' (home, the top team), out on its left: the far side as the Live Pitch draws it")
        let foul = find(0, "foul", "32'", "Foul by Marc")
        check(foul?.event.kind == .foul && foul?.event.side == .bottom && foul?.event.player == "Marc Guéhi" && foul?.event.at != nil,
              "\"Foul by Marc Guéhi (Manchester City).\": City's foul, his, where it was")
        let won = find(0, "foul", "4'") ?? find(0, "foul", "1'")
        check(won.map { $0.event.other != nil || $0.event.player != nil } ?? true, "…a free kick won names the man fouled")
        let booking = find(0, "yellow-card", "32'")
        check(booking?.event.kind == .card(red: false, second: false) && booking?.event.player == "Marc Guéhi" && booking?.event.side == .bottom
              && near(booking?.event.at, foul?.event.at, 0.01),
              "his yellow card, placed where he fouled (the card itself has no spot)")
        let offside = find(0, "offside", "27'")
        check(offside?.event.kind == .offside && offside?.event.player == "Nicolas Jackson" && offside?.event.side == .top && offside?.event.at != nil,
              "\"Offside, Aston Villa. Nicolas Jackson is caught offside.\": Villa's, his, where")
        let red = find(3, "red-card", "79'"), second = find(3, "red-card", "89'")
        check(red?.event.kind == .card(red: true, second: false) && red?.event.player == "Pape Gueye"
              && second?.event.kind == .card(red: true, second: true) && second?.event.player == "Harvey Elliott",
              "Valencia v Villarreal: Gueye's straight red (violent conduct), Elliott's second yellow")
        let sub = find(1, "substitution", "52'")
        check(sub?.event.kind == .substitution && sub?.event.player == "Omar Alderete" && sub?.event.other == "Nordi Mukiele",
              "\"Omar Alderete replaces Nordi Mukiele because of an injury.\": who comes on, who goes off")
        let hurt = find(1, "start-delay", "19'")
        check(hurt?.event.kind == .injury && hurt?.event.player == "Nordi Mukiele" && hurt?.event.side == .top,
              "\"Delay in match because of an injury Nordi Mukiele (Sunderland).\": Sunderland's man down")
        check(find(1, "end-delay", "20'", "Delay over")?.event.kind == .resume, "\"Delay over.\": play on")
        let check78 = find(3, "start-delay", "78'", "VAR")
        check(check78?.event.kind == .varCheck, "\"Delay in match (Villarreal). VAR checking.\": a VAR check")
        let decisions = [find(3, "var---referee-decision-cancelled", "36'"), find(3, "var---referee-decision-cancelled", "78'"),
                         find(2, "var---referee-decision-cancelled", "53'")].map { $0?.event.kind }
        check(decisions == [.varDecision("Penalty Valencia"), .varDecision("Card upgraded"), .varDecision("No Goal")],
              "VAR's decisions: a penalty for Valencia, a card upgraded, Newcastle's goal ruled out", "\(decisions)")
        check(find(2, "handball", "78'")?.event.kind == .handball && find(2, "handball", "78'")?.event.player == "Adam Wharton",
              "a handball, by its man")
        check(find(0, "halftime", "45'+2'")?.event.kind == .halftime && find(0, "start-2nd-half", "45'")?.event.kind == .secondHalf,
              "half time, and the second half")
        // ESPN logs each delay twice; only one says why.
        let doubled = matches[1]["clips"].array.flatMap(\.array).filter { $0["type"]["type"].string == "start-delay" }
        check(doubled.count >= 2 && doubled.filter { ($0["text"].string ?? "").isEmpty }.allSatisfy { item in
            SoccerEvent.parse([item], at: 0, homeTeamID: matches[1]["home"]["id"].string) == nil
        }, "…and a delay's silent twin is no event of its own")
        let added = SoccerAddedTime.latest(matches[0]["commentary"]), addedLeeds = SoccerAddedTime.latest(matches[1]["commentary"])
        check(added == SoccerAddedTime(minutes: 4, half: 2) && addedLeeds == SoccerAddedTime(minutes: 6, half: 2),
              "the added time from the commentary (the core plays don't have it): 4 at Villa Park, 6 at Sunderland")
        check(added?.showing(period: 2, clock: 5420) == 4 && added?.showing(period: 2, clock: 5100) == nil && added?.showing(period: 1, clock: 2750) == nil,
              "…shown while it's being played, not before, not in the other half")

        // MARK: Every shot, and what its words say

        let shots = matches.flatMap { $0["clips"].array.flatMap(\.array) }.filter { ($0["type"]["type"].string ?? "").hasPrefix("shot-") }
        check(!shots.isEmpty && shots.allSatisfy(SoccerScene.isMoment), "every shot is a moment now, a speculative one too (its own short beat)")
        let bottomLeft = SoccerScene.aim(words: "is saved in the bottom left corner by Zion Suzuki"), bottomRight = SoccerScene.aim(words: "is saved in the bottom right corner")
        let highWide = SoccerScene.aim(words: "is high and wide to the left."), tooHigh = SoccerScene.aim(words: "is too high from a direct free kick.")
        check(bottomLeft.map { $0.y > 50 && $0.y < PitchAction.posts.far && $0.z < 10 } == true && bottomRight.map { $0.y < 50 && $0.y > PitchAction.posts.near } == true
              && highWide.map { $0.y > PitchAction.posts.far && $0.z > 38 } == true && tooHigh.map { abs($0.y - 50) < 0.1 && $0.z > 38 } == true
              && SoccerScene.aim(words: "left footed shot from the left side of the box is blocked.") == nil,
              "a shot's aim from its words: the bottom left corner, the bottom right, high and wide to the left, too high; none from \"left footed\"")
        let outside = SoccerScene.spot(words: "right footed shot from outside the box misses", seed: 1)
        let six = SoccerScene.spot(words: "left footed shot from the left side of the six yard box", seed: 1)
        check(outside.map { $0.x < 83 && $0.x > 70 } == true && six.map { $0.x > 94 && $0.y > 50 } == true
              && SoccerScene.spot(words: "header from very close range", seed: 1).map { $0.x > 94 } == true,
              "…and where it was struck from: outside the box, the left of the six-yard box, very close range")
        // Two real saves, the keeper going the way each one's words say: Ndiaye's to the bottom left, Haaland's header to the bottom right.
        let m0 = matches[0], home0 = m0["home"]["id"].string
        func save(_ clue: String, strip: Bool) -> (SoccerScene, SoccerScript)? {
            for clip in m0["clips"].array.map(\.array) {
                var plays = clip
                guard let i = plays.firstIndex(where: { SoccerScene.isMoment($0) && ($0["text"].string ?? "").contains(clue) }) else { continue }
                if strip, var raw = plays[i].raw as? [String: Any] {
                    raw["goalPositionY"] = nil
                    raw["goalPositionZ"] = nil
                    plays[i] = JSON(raw)
                }
                guard let scene = SoccerScene.parse(plays, at: i, homeTeamID: home0, keepers: SoccerScene.keepers(in: plays)) else { continue }
                return (scene, SoccerScript(scene, lineups: lineups(m0)))
            }
            return nil
        }
        for strip in [false, true] {
            let left = save("Iliman Ndiaye (Manchester City) left footed shot from the right side of the box is saved", strip: strip)
            let right = save("Erling Haaland (Manchester City) header from the centre of the box is saved", strip: strip)
            // City attack the left-hand goal in the data: the shooter's left is the near side (y below the middle).
            let l = left?.1.impacts.first { $0.kind == .save }?.point.y, r = right?.1.impacts.first { $0.kind == .save }?.point.y
            check(left?.0.outcome == .saved && right?.0.outcome == .saved && (l ?? 99) < Pitch.width / 2 && (r ?? 0) > Pitch.width / 2
                  && left?.1 != right?.1,
                  strip ? "…and from their words alone (ESPN's point in the goal mouth taken away): the same sides"
                        : "two real saves play differently: Suzuki to his right for Ndiaye's bottom left corner, to his left for Haaland's bottom right",
                  "\(String(describing: l)) \(String(describing: r))")
        }

        // MARK: Which way the pitch faces

        check(PitchFacing.homeAttacksRight(period: 1, flipped: false) && !PitchFacing.homeAttacksRight(period: 2, flipped: false)
              && !PitchFacing.homeAttacksRight(period: 1, flipped: true) && PitchFacing.homeAttacksRight(period: 2, flipped: true),
              "home attacks right in the first half (as the Live Pitch draws it), left in the second; the viewer's turn swaps them")
        if let found = save("Josko Gvardiol (Manchester City) left footed shot from the left side of the box is saved", strip: false) {
            let scene = found.0, drawn = PitchFacing.homeAttacksRight(period: scene.period, flipped: false) ? scene : scene.turned()
            check(scene.period == 2 && scene.shot.from.x < Pitch.length / 2 && drawn.attacksRight && drawn.shot.from.x > Pitch.length / 2
                  && near(drawn.turned().shot.from, scene.shot.from, 1e-9),
                  "the half-time swap: Gvardiol's 56' shot, at the left-hand goal in the data, is at the right-hand one in the second half")
            let script = SoccerScript(drawn, lineups: lineups(m0))
            check(script.flights.last.map { $0.to.x > Pitch.length / 2 } == true && script.cornerRight == false,
                  "…its replay goes at the right-hand goal, the stamp on the left, away from it")
        }
        if let second = find(0, "start-2nd-half", "45'") {
            let idle = SoccerIdle.make(event: second.event, touch: nil, scene: nil, period: 1, lineups: second.lineups, flipped: false)
            let s = SoccerScript(idle: idle)
            let homeMen = s.actors.filter { $0.team == (idle.possession == .top ? .attacking : .defending) && $0.role != .keeper }
            check(!idle.homeRight && homeMen.allSatisfy { $0.position(at: 1).x >= Pitch.length / 2 - 1.5 },
                  "the second half's kick-off: the ends changed, Villa's men all in the right-hand half")
        }

        // MARK: Choreography

        // The corner from its own flag.
        if let corner {
            let idle = SoccerIdle.make(event: corner.event, touch: nil, scene: nil, period: 1, lineups: corner.lineups, flipped: false)
            let s = SoccerScript(idle: idle)
            let ball = s.ball(at: 5)?.ground
            let taker = s.actors.indices.first { i in s.actors[i].team == .attacking && near(s.actors[i].position(at: 5), ball, 2.5) }
            let inBox = s.actors.filter { $0.team == .attacking && $0.position(at: 5).x > Pitch.length - Pitch.boxDepth && abs($0.position(at: 5).y - 34) < 20 }
            check(near(ball, CGPoint(x: Pitch.length - 0.6, y: Pitch.width - 0.6), 1.2) && taker != nil && inBox.count >= 4,
                  "Villa's corner from the right-hand goal's far flag (out on their left): the taker over it, four and more of theirs in the box")
            check(SoccerStatus.idle(idle, t: 5, names: villa, added: nil) == TheaterStatus(tag: "Corner · Aston Villa", tint: "660e36"),
                  "…tagged CORNER · ASTON VILLA in Villa's claret")
        }
        if let cityCorner = find(0, "corner-awarded", "9'") {
            let s = SoccerScript(idle: SoccerIdle.make(event: cityCorner.event, touch: nil, scene: nil, period: 1, lineups: cityCorner.lineups, flipped: false))
            check(near(s.ball(at: 5)?.ground, CGPoint(x: 0.6, y: Pitch.width - 0.6), 1.2),
                  "City's at 9', out on their right as they attack the left-hand goal: the far flag at that end")
        }
        // The card for the real player, where he fouled.
        if let booking, let spot = booking.event.at {
            let idle = SoccerIdle.make(event: booking.event, touch: nil, scene: nil, period: 1, lineups: booking.lineups, flipped: false)
            let s = SoccerScript(idle: idle)
            let guehi = booking.lineups[.bottom]?.players.first { $0.name == "Marc Guéhi" }?.athlete
            let booked = s.actors.first { $0.athlete == guehi && $0.athlete != nil }
            let referee = s.actors.indices.first { s.actors[$0].team == .official && s.actors[$0].name == "referee" }
            check(guehi != nil && booked.map { near($0.position(at: 3), spot, 2.5) } == true && referee.map { near(s.actors[$0].position(at: 3), spot, 0.5) } == true
                  && s.props.contains { $0.kind == .yellowCard && $0.actor == referee && $0.from < 3 && $0.until > 3 },
                  "Guéhi's booking: the referee at his foul, the yellow card up, Guéhi himself (by his ESPN ID) in front of him")
            check(SoccerStatus.idle(idle, t: 3, names: villa, added: nil) == TheaterStatus(tag: "Yellow card · Guéhi", tint: SoccerStatus.yellow),
                  "…tagged YELLOW CARD · GUÉHI in yellow")
        }
        if let red {
            let s = SoccerScript(idle: SoccerIdle.make(event: red.event, touch: nil, scene: nil, period: 2, lineups: red.lineups, flipped: false))
            check(s.props.contains { $0.kind == .redCard } && s.actors.contains { $0.vanish.isFinite && $0.team != .official },
                  "Gueye's red: the red card up, and he walks")
        }
        if let offside {
            let idle = SoccerIdle.make(event: offside.event, touch: nil, scene: nil, period: 1, lineups: offside.lineups, flipped: false)
            let s = SoccerScript(idle: idle)
            check(idle.possession == .bottom && s.props.contains { $0.kind == .flag }
                  && SoccerStatus.idle(idle, t: 2, names: villa, added: nil).tag == "Offside · Jackson"
                  && SoccerStatus.idle(idle, t: 8, names: villa, added: nil).tag == "Free kick · Manchester City",
                  "offside: the assistant's flag up, OFFSIDE · JACKSON, then City's free kick")
        }
        if let sub {
            let s = SoccerScript(idle: SoccerIdle.make(event: sub.event, touch: nil, scene: nil, period: 2, lineups: sub.lineups, flipped: false))
            let off = s.actors.first { $0.name == "Nordi Mukiele" }, on = s.actors.first { $0.name == "Omar Alderete" }
            check(s.props.contains { $0.kind == .board } && off.map { $0.vanish.isFinite } == true && on.map { $0.appear.isFinite && $0.opacity(at: s.duration) == 1 } == true,
                  "the substitution: the board up, Mukiele off, Alderete on")
        }
        if let hurt {
            let s = SoccerScript(idle: SoccerIdle.make(event: hurt.event, touch: nil, scene: nil, period: 1, lineups: hurt.lineups, flipped: false))
            let down = s.actors.first { $0.holds.contains { $0.kind == .down } }
            check(down?.name == "Nordi Mukiele" && s.actors.filter { $0.team == .staff }.count == 2
                  && s.actors.filter { $0.team == .staff }.allSatisfy { near($0.position(at: 12), down?.position(at: 12), 2) },
                  "Mukiele down, the physios at him")
        }
        // The ball going round the team that has it, in its own shape.
        if let corner, let touch = corner.clip[..<corner.index].reversed().lazy.compactMap({ SoccerTouch.parse($0, homeTeamID: corner.home, order: 1) }).first {
            let idle = SoccerIdle.make(event: nil, touch: touch, scene: nil, period: 1, lineups: corner.lineups, flipped: false)
            let s = SoccerScript(idle: idle)
            let team = Set(corner.lineups[idle.possession]?.players.map(\.athlete) ?? [])
            let passers = s.actors.filter { a in a.actions.contains { $0.kind == .kick } }
            let passes = s.flights.filter { $0.kind == .pass }
            check(idle.phase == .play && passes.count >= 5 && !passers.isEmpty && passers.allSatisfy { $0.team == .attacking && $0.athlete.map(team.contains) == true },
                  "between moments the team on the ball passes it round: \(passes.count) passes, every one between its own starters")
            if let loop = s.loop {
                let back = s.actors.indices.allSatisfy { near(s.actors[$0].position(at: loop.start), s.actors[$0].position(at: loop.start + loop.period), 0.3) }
                    && near(s.ball(at: loop.start)?.ground, s.ball(at: loop.start + loop.period)?.ground, 0.3)
                let moving = s.beats.filter { $0.lowerBound >= loop.start }.reduce(0) { $0 + $1.upperBound - $1.lowerBound }
                check(back && moving < loop.period * 0.7 && moving > 2,
                      "…round a loop that ends where it began, in beats with stills between", "moving \(moving) of \(loop.period)")
            }
            check(SoccerStatus.idle(idle, t: 1, names: villa, added: nil).tag == "\(idle.possession == .top ? "Aston Villa" : "Manchester City") ball"
                  && SoccerStatus.idle(idle, t: 1, names: villa, added: 4).tag == "+4 added",
                  "…tagged with the team on the ball, and +4 ADDED while the added time's played")
            let other = SoccerIdle.make(event: nil, touch: SoccerTouch(side: touch.side, at: CGPoint(x: 30, y: 20), order: 7), scene: nil, period: 1,
                                        lineups: corner.lineups, flipped: false)
            check(SoccerScript(idle: idle) == s && SoccerScript(idle: other).flights != s.flights,
                  "seeded: the same touch always goes round the same way, another differently")
        }
        check(SoccerTouch.parse(JSON(["type": ["type": "foul"], "team": ["$ref": "/teams/382"], "fieldPositionX": 40.0, "fieldPositionY": 30.0] as [String: Any]),
                                homeTeamID: "362", order: 1)?.side == .top,
              "a foul gives the ball to the other team")

        // MARK: What plays, in turn

        if let corner, let booking, let foul {
            var state = SoccerTheaterState()
            state.events = [foul.event, booking.event, corner.event].enumerated().map { k, e in var e = e; e.order = 10 + k; return e }
            state.newsFrom = 11
            state.touch = SoccerTouch(side: .top, at: Pitch.center, order: 5)
            let first = SoccerTheater.events(state, played: [])
            check(first.pending.map(\.id) == [booking.event.id, corner.event.id] && first.standing?.id == corner.event.id,
                  "events since the page opened play in turn (the foul before it is history); the corner holds play up")
            let after = SoccerTheater.events(state, played: [booking.event.id, corner.event.id])
            state.touch = SoccerTouch(side: .top, at: Pitch.center, order: 20)
            let taken = SoccerTheater.events(state, played: [booking.event.id, corner.event.id])
            check(after.pending.isEmpty && after.standing?.id == corner.event.id && taken.standing == nil,
                  "…until the ball's in play again (a touch after it): then the ball goes round")
        }
    }
}
