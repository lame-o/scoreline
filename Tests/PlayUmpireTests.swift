import Foundation

// The plate umpire in the ballpark theater, against real games: World
// Series Game 5's pitches and plays (Tests/Fixtures/ws-g5-plays.json with
// MLB's feed, statcast-849799.json), Game 3's run-scoring single
// (ws-g3-plays.json) and Game 2's outs at the plate (its summary,
// 3bd207fad0c0e7da8976ca99.bin). He's behind the catcher in his own kit, in
// his set as each pitch comes and up between them, and he makes the calls
// the data says he made: a called strike's punch, strike three looking's
// punch-out, a swinging strike's point, a foul's arms up, safe or out on a
// play at the plate, a challenge's tap on the cap; nothing for a ball, nor
// for a home run's trot.

extension ScorelineTests {
    static func playUmpire() {
        print("\nPlay theater: the plate umpire")
        let dir = FixtureProtocol.directory
        guard let espn = try? Data(contentsOf: dir.appendingPathComponent("ws-g5-plays.json")),
              let mlb = try? Data(contentsOf: dir.appendingPathComponent("statcast-849799.json")),
              let g3Data = try? Data(contentsOf: dir.appendingPathComponent("ws-g3-plays.json")),
              let g2Data = try? Data(contentsOf: dir.appendingPathComponent("3bd207fad0c0e7da8976ca99.bin")) else {
            return check(false, "Games 5, 3 and 2 load")
        }
        let g5 = JSON(data: espn)
        let items = g5["items"].array
        var names: [String: String] = [:]
        for (id, name) in (g5["names"].raw as? [String: String]) ?? [:] { names[id] = name }
        let line = PlayBeat.timeline(items, mlb: Statcast.atBats(JSON(data: mlb)), names: names)
        func pitch(_ b: PlayBeat) -> PlayBeat.Pitch? { if case let .pitch(p) = b.kind { return p }; return nil }
        func umpire(_ s: PlayScript) -> PlayScript.Actor? { s.umpire.map { s.actors[$0] } }
        let righty = PlayScript.Rest(bases: [false, false, false], bats: .right), lefty = PlayScript.Rest(bases: [true, false, false], bats: .left)

        // MARK: Where he stands

        let rest = PlayScript(rest: righty), restLefty = PlayScript(rest: lefty)
        check(umpire(rest).map { $0.team == .official && $0.at.y < Ballpark.position(2).y && $0.at.x < 0 } ?? false
              && umpire(restLefty).map { $0.at.x > 0 } ?? false && rest.actors.last?.role == .umpire
              && PlayScript(rest: PlayScript.Rest(standing: .tarp)).umpire == nil,
              "the plate umpire stands behind the catcher in the slot on the batter's side (the last figure: everyone else keeps his place); not under the tarp")
        let kit = Uniform.umpire(dark: true)
        check(kit.legs != nil && kit.legs != kit.jersey && kit.stripes == nil, "he wears the umpire's kit: navy shirt, gray slacks (Uniform.umpire)")

        // MARK: Each pitch

        func script(_ match: (PlayBeat.Pitch) -> Bool) -> (PlayBeat, PlayScript)? {
            line.first { pitch($0).map(match) ?? false }.map { ($0, PlayScript(beat: $0, rest: righty)) }
        }
        if let (_, s) = script({ $0.call == .calledStrike && $0.review == nil }), let u = umpire(s), let pop = s.captions.first?.at,
           let release = s.release {
            check(u.sets.contains { $0.contains(release) && $0.contains(pop) } && !u.sets.contains { $0.contains(s.duration) }
                  && u.signals.map(\.kind) == [.strike] && abs((u.signals.first?.at ?? 0) - pop) < 0.1,
                  "a called strike: down in his set as it comes, the punch as it pops the mitt, up after")
        }
        if let (_, s) = script({ $0.call == .ball && $0.review == nil }), let u = umpire(s) {
            check(u.signals.isEmpty && !u.sets.isEmpty, "a ball: he's set for it, and calls nothing")
        }
        if let (_, s) = script({ $0.call == .foul }) {
            check(umpire(s)?.signals.map(\.kind) == [.foul], "a foul: both arms up")
        }
        if let (_, s) = script({ $0.call == .swingingStrike }) {
            check(umpire(s)?.signals.map(\.kind) == [.swinging], "a swinging strike: a point")
        }
        // Contreras's ABS challenge: the umpire called a ball; the zone made it a strike.
        if let (_, s) = script({ $0.review?.overturned == true && $0.call == .calledStrike }), let u = umpire(s) {
            check(u.signals.map(\.kind) == [.challenge, .strike], "an overturned ball: no punch as it pops, the tap on the cap, then the strike the zone gave",
                  "\(u.signals.map(\.kind))")
        }

        // MARK: Plays

        let side: (String?) -> GameDetail.Side? = { $0 == "8" ? .top : $0 == "30" ? .bottom : nil }
        func play(_ plays: [JSON], _ id: String, side: @escaping (String?) -> GameDetail.Side? = side) -> PlayScript? {
            guard let i = plays.firstIndex(where: { $0["id"].string == id }), let scene = PlayScene.parse(plays, at: i, side: side, names: names) else {
                return nil
            }
            return PlayScript(scene, rest: PlayScript.Rest(bases: scene.basesAfter, bats: .right, swapped: scene.endsInning))
        }
        let looking = items.firstIndex { $0["type"]["type"].string == "play-result" && ($0["text"].string ?? "").contains("struck out looking") }
            .flatMap { items[$0]["id"].string }
        let swinging = items.firstIndex { $0["type"]["type"].string == "play-result" && ($0["text"].string ?? "").contains("struck out swinging") }
            .flatMap { items[$0]["id"].string }
        if let looking, let s = play(items, looking), let u = umpire(s) {
            let pop = s.flashes.first { $0.beat == .catchBall }?.at ?? 0
            check(u.signals.map(\.kind) == [.punchOut] && abs((u.signals.first?.at ?? 0) - pop) < 0.15 && u.sets.contains { $0.contains(pop) },
                  "strike three looking (Chourio, the game's first out): the punch-out as it pops the mitt")
        }
        if let swinging, let s = play(items, swinging) {
            check(umpire(s)?.signals.map(\.kind) == [.swinging], "strike three swinging: the point")
        }
        let g3 = JSON(data: g3Data)["items"].array
        if let s = play(g3, "4019080440404990057"), let u = umpire(s), let run = s.flashes.first(where: { $0.beat == .run }) {
            check(u.signals.contains { $0.kind == .safe && abs($0.at - run.at) < 0.1 && $0.toward == .zero }
                  && u.position(at: run.at).x < -5 && u.position(at: s.duration) == Ballpark.umpire(.right),
                  "Chourio scores on Yelich's single: the umpire up the line to see it, safe as he crosses, then back behind the plate")
        }
        let g2 = JSON(data: g2Data)["plays"].array
        let rays: (String?) -> GameDetail.Side? = { $0 == "30" ? .top : .bottom }
        if let s = play(g2, "4019080431004990057", side: rays), let u = umpire(s),
           let out = s.flashes.first(where: { $0.beat == .out && hypot($0.point.x, $0.point.y) < 3 }) {
            check(u.signals.contains { $0.kind == .out && abs($0.at - out.at) < 0.1 } && !u.signals.contains { $0.kind == .safe },
                  "Hicks thrown out at home (Game 2): the umpire's out, the hammer, as the tag goes down")
        } else {
            check(false, "Game 2's out at the plate replays with its out at home")
        }
        // Pratt's home run in Game 4: a trot, not a play at the plate.
        if let g4Data = try? Data(contentsOf: dir.appendingPathComponent("ws-g4-plays.json")),
           let s = play(JSON(data: g4Data)["items"].array, "4019080452201990057") {
            check(s.fence != nil && umpire(s)?.signals.isEmpty == true, "a home run's trot isn't a play at the plate: no call")
        } else {
            check(false, "Game 4's home run replays")
        }

        // MARK: Between pitches

        check(IdleBeat.fitting(PlayScript.Rest(bats: nil), between: true).contains(.brush)
              && !IdleBeat.fitting(righty, between: false).contains(.brush),
              "between halves he may dust off the plate (not with a batter in)")
        let brush = PlayScript(idle: .brush, rest: PlayScript.Rest(bats: nil), seed: 5)
        if let u = umpire(brush) {
            check(u.position(at: 0) == u.at && u.position(at: brush.duration) == u.at && u.position(at: 1.25).y > 1
                  && u.actions.contains { $0.kind == .scoop } && brush.duration <= 3,
                  "the brush: round the catcher to the plate, a bend over it, and back")
        }
        if let i = items.firstIndex(where: { $0["type"]["type"].string == "play-result" && $0["outs"].int == 3 }),
           let id = items[i]["id"].string, let s = play(items, id), let u = umpire(s) {
            check(u.vanish == .infinity && u.position(at: s.duration) == Ballpark.umpire(.right),
                  "the sides change; the umpire stays, behind the plate")
        }
    }
}
