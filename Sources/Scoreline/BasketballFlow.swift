import SwiftUI

// The basketball theater's running order and what it says. Every play the
// live lane brings is told in order (`BasketballQueue`): a marquee play as
// its full replay, the rest as their lighter beats, a miss with the rebound
// it ended in, the substitutions at one stoppage together. Live plays come
// every few seconds; the theater never falls more than a dozen seconds of
// telling behind the game: when plays pile up, the least of them (a
// substitution, a timeout that's over, a whistle) are passed over, never a
// replay nor the newest, and the tag says so (CATCHING UP · 3 PLAYS).
//
// Between plays the court rests on the state the last play left
// (`BasketballFlow.rest`), and the broadcast tag (`BasketballStatus`) says
// what's going on: whose ball it is in the team's color, or the stoppage the
// game is in (TIMEOUT · JAZZ, END OF 3RD, HALFTIME, CHALLENGE · SPURS).
// ESPN doesn't flag TV breaks: timeouts and the ends of periods are the
// honest ones, and "MEDIA TIMEOUT" only when its words say so. Pure; tested.

enum BasketballQueue {
    /// One thing to tell: a play, and what its telling covers.
    struct Unit: Equatable {
        var scene: BasketballScene
        /// Substitutions at one stoppage, told together (the first is `scene`).
        var group: [BasketballScene] = []
        /// Plays its telling covers: later ones its choreography shows (a
        /// miss's rebound, an offensive foul's turnover), earlier ones a
        /// replay tells again (a putback's miss), the ones passed over.
        var covers: [String] = []
        /// Plays passed over just before it, to keep up with the game.
        var skipped = 0

        var marquee: Bool { scene.replays }
    }

    /// Never more than this many seconds of telling behind the game.
    static let budget = 12.0

    /// How long a play takes to tell, about: a replay's full length, a beat's second or three.
    static func estimate(_ scene: BasketballScene) -> Double {
        if scene.replays { return 6.5 }
        switch scene.kind {
        case .jumper, .three, .layup, .dunk, .alleyOop, .putback, .block: return 3.8
        case .freeThrow: return 3.2
        case .offensiveRebound, .defensiveRebound: return 1.8
        case .steal, .turnover: return 2.4
        case .foul, .violation, .challenge: return 2.2
        case .jumpBall: return 2.6
        case .substitution: return 1.6
        case .timeout, .periodEnd: return 2.0
        }
    }

    /// What's passed over first when it's behind: a substitution or a
    /// stoppage that's over, then a whistle or a board, then a shot or a
    /// turnover; never a replay.
    static func priority(_ scene: BasketballScene) -> Int {
        if scene.replays { return 9 }
        switch scene.kind {
        case .substitution, .timeout, .challenge, .periodEnd: return 0
        case .offensiveRebound, .defensiveRebound, .foul, .violation, .jumpBall: return 1
        default: return 2
        }
    }

    /// What to tell next: the first play that's news after the last one
    /// told (`cursor`; `told`, everything told or covered so far), grouped
    /// and caught up. Nil when there's nothing new. (pure; tested)
    static func next(after cursor: String?, told: Set<String>, in state: BasketballTheaterState) -> Unit? {
        let plays = state.plays
        let from = cursor.flatMap { c in plays.lastIndex { $0.id == c } }.map { $0 + 1 }
            ?? plays.lastIndex { told.contains($0.id) }.map { $0 + 1 } ?? 0
        let pending = Array(plays[min(from, plays.count)...].filter { state.news.contains($0.id) && !told.contains($0.id) })
        guard !pending.isEmpty else { return nil }
        let ids = Set(pending.map(\.id))
        // A steal, a miss and its board that a replay to come tells again aren't told twice.
        let retold = Set(pending.filter(\.replays).flatMap(\.leadIn))
        var units: [Unit] = []
        var covered = Set<String>()
        var i = 0
        while i < pending.count {
            let play = pending[i]
            i += 1
            if covered.contains(play.id) || retold.contains(play.id) { continue }
            var unit = Unit(scene: play)
            if play.kind == .substitution {
                unit.group = [play]
                while i < pending.count, pending[i].kind == .substitution {
                    unit.group.append(pending[i])
                    i += 1
                }
            }
            let later = play.follows.filter(ids.contains)
            unit.covers = later + (play.replays ? play.leadIn.filter(ids.contains) : []) + unit.group.dropFirst().map(\.id)
            covered.formUnion(later)
            units.append(unit)
        }
        guard !units.isEmpty else { return nil }
        // Behind: pass over the least of it, oldest first; never a replay, never the newest.
        var total = units.map { estimate($0.scene) }.reduce(0, +)
        var dropped = Set<Int>()
        if total > budget {
            let order = units.indices.dropLast().sorted { (priority(units[$0].scene), $0) < (priority(units[$1].scene), $1) }
            for k in order where total > budget && !units[k].marquee {
                dropped.insert(k)
                total -= estimate(units[k].scene)
            }
        }
        guard let first = units.indices.first(where: { !dropped.contains($0) }) else { return nil }
        var unit = units[first]
        let passed = units[..<first]
        unit.skipped = passed.reduce(0) { $0 + max($1.group.count, 1) }
        unit.covers += passed.flatMap { [$0.scene.id] + $0.covers }
        // Retold lead-ins ride with their replay.
        if unit.marquee { unit.covers += unit.scene.leadIn.filter(ids.contains) }
        return unit
    }
}

// MARK: - The court after a play

enum BasketballFlow {
    /// The court once a play's been told: who has the ball and how the floor
    /// got that way (a score: the ball in from under the basket; a defensive
    /// board or a steal: up the floor the other way; a shooting foul: to the
    /// lane; a timeout: the benches; the half: off the floor). A substitution
    /// or a review keeps the floor as it was. (pure; tested)
    static func rest(after scene: BasketballScene?, previous: BasketballScript.Rest?, from lineup: Lineup?, ends: HoopsEnds,
                     possession: GameDetail.Side?) -> BasketballScript.Rest {
        let keep = previous?.offense ?? possession
        guard let scene else { return BasketballScript.Rest(offense: possession, ends: ends, phase: possession == nil ? .tip : .live, from: lineup) }
        func make(_ offense: GameDetail.Side?, _ phase: BasketballScript.Rest.Phase, outlet: Bool = false) -> BasketballScript.Rest {
            BasketballScript.Rest(offense: offense, ends: ends, phase: phase, from: lineup, seed: scene.id, outlet: outlet)
        }
        /// A big who takes a defensive board outlets it (a guard brings it up himself).
        func outlet(_ rebound: BasketballScene.Rebound) -> Bool { !rebound.offensive && rebound.person?.role.map { $0 != .guardRole } == true }
        switch scene.kind {
        case .jumper, .three, .layup, .dunk, .alleyOop, .putback, .block:
            if scene.made { return scene.andOne ? make(scene.offense, .lane) : make(scene.defense, .inbound(baseline: true)) }
            guard let rebound = scene.rebound else { return make(scene.offense, .loose) }
            return make(rebound.offensive ? scene.offense : scene.defense, rebound.person == nil ? .inbound(baseline: false) : .live,
                        outlet: outlet(rebound))
        case .freeThrow:
            let last = (scene.attempt ?? 1) >= (scene.attempts ?? 1)
            guard last else { return make(scene.offense, .lane) }
            if scene.made { return make(scene.defense, .inbound(baseline: true)) }
            guard let rebound = scene.rebound else { return make(scene.offense, .loose) }
            return make(rebound.offensive ? scene.offense : scene.defense, rebound.person == nil ? .inbound(baseline: false) : .live,
                        outlet: outlet(rebound))
        case .offensiveRebound, .defensiveRebound:
            return make(scene.offense, scene.shooter == nil ? .inbound(baseline: false) : .live,
                        outlet: scene.kind == .defensiveRebound && scene.shooter?.role.map { $0 != .guardRole } == true)
        case .steal:
            return make(scene.defense, .live)
        case .turnover:
            let live = scene.call == .lostBall || scene.call == .badPass
            return make(scene.defense, live ? .live : .inbound(baseline: false))
        case .foul, .violation:
            guard let call = scene.call, call != .technical, call != .delay else { return make(keep, previous?.phase ?? .live) }
            if call == .goaltending { return make(scene.offense, .inbound(baseline: true)) }
            if call.defensive {
                let shots = call == .shooting || scene.trip != nil
                return make(scene.offense?.opponent, shots ? .lane : .inbound(baseline: false))
            }
            return make(scene.offense?.opponent, .inbound(baseline: false))
        case .jumpBall:
            return make(scene.offense, .live)
        case .timeout:
            return make(keep, .benches)
        case .periodEnd:
            return make(nil, scene.final || scene.period == 2 ? .offCourt : .benches)
        case .substitution, .challenge:
            var phase = previous?.phase ?? .live
            if case .inbound = phase { phase = .live }
            return make(keep, phase)
        }
    }
}

// MARK: - What it says

enum BasketballStatus {
    /// "END OF 1ST", "HALFTIME", "END OF 3RD", "END OF REGULATION" (tied after
    /// four: overtime to come), "END OF OT", "END OF 2OT", "FINAL".
    static func periodWords(_ period: Int, final: Bool, tied: Bool) -> String {
        if final { return "FINAL" }
        switch period {
        case 1: return "END OF 1ST"
        case 2: return "HALFTIME"
        case 3: return "END OF 3RD"
        case 4: return tied ? "END OF REGULATION" : "END OF 4TH"
        default: return period == 5 ? "END OF OT" : "END OF \(period - 4)OT"
        }
    }

    /// A review's words: "CHALLENGE · JAZZ", then its ruling ("· OVERTURNED",
    /// "· CALL STANDS"); a referees' review is just "REVIEW".
    static func reviewWords(_ scene: BasketballScene, team: String?) -> String {
        let who = scene.review ? nil : team ?? scene.text.firstMatch(of: #/\[(.+?)\]/#).map { String($0.1).uppercased() }
        let ruling = scene.overturned.map { $0 ? "OVERTURNED" : "CALL STANDS" }
        return [scene.review ? "REVIEW" : "CHALLENGE", who, ruling].compactMap { $0 }.joined(separator: " · ")
    }

    /// The tag between plays: the stoppage the game is in (the last play
    /// told that wasn't a substitution: a timeout, the end of a period, a
    /// challenge still under review), else whose ball it is ("SPURS BALL",
    /// "FREE THROWS · SPURS" on the lane); nothing while a miss is loose.
    static func between(context: BasketballScene?, rest: BasketballScript.Rest?, names: (top: String, bottom: String))
        -> (text: String, side: GameDetail.Side?)? {
        if let context {
            switch context.kind {
            case .timeout:
                return (BasketballScript.Builder.stoppageWords(context), context.stoppage == nil ? context.offense : nil)
            case .periodEnd:
                return (periodWords(context.period ?? 1, final: context.final, tied: context.top == context.bottom), nil)
            case .challenge where context.overturned == nil:
                return (reviewWords(context, team: nil), context.offense)
            default:
                break
            }
        }
        guard let rest, let side = rest.offense else { return nil }
        let name = (side == .top ? names.top : names.bottom).uppercased()
        guard !name.isEmpty else { return nil }
        switch rest.phase {
        case .loose, .tip, .offCourt: return nil
        case .lane: return ("FREE THROWS · \(name)", side)
        default: return ("\(name) BALL", side)
        }
    }

    /// The tag while something's told: the beat's own (its whistle's, from
    /// when it blows), the catching up for its first moments, else whose
    /// ball it is; nothing over a replay (its banner and stamp say it).
    static func during(unit: BasketballQueue.Unit, script: BasketballScript, t: Double, names: (top: String, bottom: String))
        -> (text: String, side: GameDetail.Side?)? {
        if unit.skipped > 0, t < 1.6 { return ("CATCHING UP · \(unit.skipped) PLAY\(unit.skipped == 1 ? "" : "S")", nil) }
        if unit.marquee { return nil }
        if let tag = script.tag, t >= tag.at { return (tag.text, tag.side) }
        var side = unit.scene.ball
        // A play that turns the ball over says so as it lands (the board, the steal).
        if script.stamp.isFinite, t >= script.stamp - 0.2, let after = unit.scene.after { side = after }
        guard let side else { return nil }
        let name = (side == .top ? names.top : names.bottom).uppercased()
        return name.isEmpty ? nil : ("\(name) BALL", side)
    }
}
