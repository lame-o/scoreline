import SwiftUI

// The match page's side of the celebrations: what counts as news on the
// climbing and CS2 pages (who was passed, a new leader, the medal zone, a
// decided final, a series won), the state rules football, baseball and CS2
// show as chips, and the hero's scoreboard beats. Detection is pure and
// tested; the views that draw it live with their charts.

// MARK: - Rules

enum MatchRules {
    /// Whose score went up. A safety's side is the offense, tackled in its own
    /// end zone: the defense scores.
    static func scorer(of m: LiveMoment) -> GameDetail.Side? {
        guard let side = m.side else { return nil }
        return m.kind == .safety ? opposite(side) : side
    }

    static func opposite(_ side: GameDetail.Side) -> GameDetail.Side { side == .top ? .bottom : .top }

    // MARK: Football

    /// The two-minute drill: Q4 or overtime with 2:00 or less on a running
    /// clock, and the team with the ball trailing by one score (1–8).
    static func twoMinuteDrill(period: Int, seconds: Double, possession: GameDetail.Side?, top: Int, bottom: Int) -> Bool {
        guard period >= 4, seconds > 0, seconds <= 120, let possession else { return false }
        let deficit = possession == .top ? bottom - top : top - bottom
        return (1...8).contains(deficit)
    }

    // MARK: Baseball

    /// The batting team from ESPN's inning ("Top 7th": the away team; "Bot 7th":
    /// home). Between halves ("Mid 7th", "End 7th") nobody is batting.
    static func battingSide(inning: String?, topIsHome: Bool?) -> GameDetail.Side? {
        guard let word = inning?.lowercased().split(separator: " ").first, let topIsHome else { return nil }
        let homeBats: Bool
        switch word {
        case "top", "▲": homeBats = false
        case "bot", "bottom", "▼": homeBats = true
        default: return nil
        }
        return homeBats == topIsHome ? .top : .bottom
    }

    // MARK: CS2

    /// Rounds needed to win the map at this score: 13 in regulation (MR12),
    /// then 16, 19, 22… through each six-round overtime.
    static func mapTarget(top: Int, bottom: Int) -> Int {
        top + bottom < 24 ? 13 : 16 + 3 * ((min(top, bottom) - 12) / 3)
    }

    /// The side one round from taking the map, if either is.
    static func mapPoint(top: Int, bottom: Int) -> GameDetail.Side? {
        let target = mapTarget(top: top, bottom: bottom)
        if top == target - 1, bottom < target - 1 { return .top }
        if bottom == target - 1, top < target - 1 { return .bottom }
        return nil
    }

    /// Maps each side has won once map `number` goes to `winner`, and whether
    /// that wins the series (best of `maps.count`).
    static func series(after number: Int?, winner: GameDetail.Side, maps: [GameDetail.MapResult])
        -> (wins: Int, losses: Int, clinched: Bool)? {
        guard !maps.isEmpty else { return nil }
        let others = maps.filter { $0.number != number }
        let wins = others.filter { $0.winner == winner }.count + 1
        let losses = others.filter { $0.winner == opposite(winner) }.count
        return (wins, losses, wins >= maps.count / 2 + 1)
    }

    /// A round won (the score moved), a map won, or the series won, between two
    /// live readings of the map being played.
    static func csMoments(from old: GameDetail.CSLive, to new: GameDetail.CSLive, names: (top: String, bottom: String),
                          maps: [GameDetail.MapResult]) -> [LiveMoment] {
        guard old.mapNumber == new.mapNumber else { return [] }
        let score = "\(new.topScore)–\(new.bottomScore)"
        // The map's over (the final round may have come in a reading earlier).
        if new.mapEnded, !old.mapEnded, new.topScore != new.bottomScore {
            let side: GameDetail.Side = new.topScore > new.bottomScore ? .top : .bottom
            let winner = side == .top ? names.top : names.bottom
            let map = new.mapName ?? "the map"
            var moment = LiveMoment(id: "cs:\(new.mapNumber ?? 0):end", chart: .rounds, tier: .score, kind: .mapWon,
                                    lead: "Map won", detail: "\(winner) take \(map) \(score)", side: side)
            if let s = series(after: new.mapNumber, winner: side, maps: maps), s.clinched {
                // The map that wins it: decisive (gold, the hero's glint, the trophy).
                let match = maps.count > 1 ? "the series \(s.wins)–\(s.losses)" : "the match"
                moment = LiveMoment(id: moment.id, chart: .rounds, tier: .score, kind: .mapWon,
                                    lead: maps.count > 1 ? "Series won" : "Match won",
                                    detail: "\(winner) take \(map) \(score) and \(match)", side: side)
                moment.accents = .decisive
            }
            return [moment]
        }
        let topWon = new.topScore > old.topScore, bottomWon = new.bottomScore > old.bottomScore
        guard topWon != bottomWon, !new.mapEnded else { return [] }
        let winner = topWon ? names.top : names.bottom
        // Rounds played so far, whatever bo3.gg's round counter means mid-round.
        let round = new.topScore + new.bottomScore
        return [LiveMoment(id: "cs:\(new.mapNumber ?? 0):\(round)", chart: .rounds, tier: .swing, kind: .roundWon,
                           lead: "Round \(round)", detail: "\(winner) won · \(score)", side: topWon ? .top : .bottom)]
    }

    // MARK: Climbing

    /// A medal round: "Final", not a semi- or quarter-final.
    static func isFinalRound(_ name: String?) -> Bool {
        guard let name = name?.lowercased(), name.contains("final") else { return false }
        return !name.contains("semi") && !name.contains("quarter")
    }

    /// One route, everyone on its startlist has climbed, and nobody is on the wall.
    static func decided(_ wall: [GameDetail.WallRoute]) -> Bool {
        guard wall.count == 1, let route = wall.first, route.total > 0 else { return false }
        return route.climbers.count >= route.total && !route.climbers.contains(where: \.onWall)
    }

    /// The lead plot's height scale (as `LeadAscentView` draws it): at least
    /// 45 holds, and a few above the best high point. A top travels to it.
    static func plotScale(_ route: GameDetail.WallRoute) -> Double {
        let best = route.climbers.filter { !$0.top }.map(\.height).max() ?? 0
        return max(45, (best + 4).rounded(.up))
    }

    /// Since the last refresh: tops; in a final or semi (one climber at a
    /// time), the climber passing someone's high point (each climber passed,
    /// lowest first, in `targets`; the climb's from…to heights in `span`), a
    /// new leader, the medal zone, where they finished; and the final decided.
    static func climbingMoments(from old: GameDetail, to new: GameDetail) -> [LiveMoment] {
        var moments: [LiveMoment] = []
        let single = new.wall.count == 1
        let final = isFinalRound(new.roundName)
        for route in new.wall {
            let before = old.wall.first { $0.name == route.name }
            let done = route.climbers.filter { !$0.onWall }
            for climber in route.climbers where climber.top {
                guard let earlier = before?.climbers.first(where: { $0.id == climber.id }), !earlier.top else { continue }
                var top = LiveMoment(id: ClimbingWallView.momentID(climber, route: route), chart: single ? .ascent : .wall,
                                     tier: single ? .score : .swing, kind: .top, lead: "Top",
                                     detail: single ? climber.name : "\(climber.name) · Route \(route.name)")
                if single {
                    // A top passes everyone below it: the same knocks as a pass, all the way up.
                    let others = done.filter { $0.id != climber.id }
                    let passed = others.filter { !$0.top && $0.height >= earlier.height }.sorted { $0.height < $1.height }
                    top.targets = passed.map { String($0.id) }
                    top.span = earlier.height...max(earlier.height, plotScale(route))
                    top.accents = standing(after: (climber.height, true), before: (earlier.height, false), among: others,
                                           final: final, passedAnyone: !passed.isEmpty)
                }
                moments.append(top)
            }
            guard single, let before else { continue }
            // Passing: the climber on the wall goes above someone's high point.
            if let now = route.climbers.first(where: \.onWall), !now.top,
               let then = before.climbers.first(where: { $0.id == now.id }), now.height > then.height {
                let overtaken = done.filter { !$0.top && $0.height >= then.height && $0.height < now.height }
                    .sorted { $0.height < $1.height }
                if let highest = overtaken.last {
                    let place = LeadAscentView.place(of: now.height, top: false, among: done)
                    let accents = standing(after: (now.height, false), before: (then.height, false), among: done,
                                           final: final, passedAnyone: true)
                    let leads = accents.contains(.newLeader)
                    // A new leader in a final is the round's score.
                    var pass = LiveMoment(id: "pass:\(now.id):\(highest.id)", chart: .ascent, tier: leads && final ? .score : .swing,
                                          kind: .passed, lead: leads && final ? "Takes the lead" : "Passes \(highest.name)",
                                          detail: leads && final ? "\(now.name) · passes \(highest.name)"
                                              : "\(now.name) · \(place == 1 ? "leads" : "now \(Ordinal.string(place))")")
                    pass.targets = overtaken.map { String($0.id) }
                    pass.span = then.height...now.height
                    pass.accents = accents
                    moments.append(pass)
                }
            }
            // Finished: whoever was on the wall is done (and didn't top).
            for climber in before.climbers where climber.onWall {
                guard let after = route.climbers.first(where: { $0.id == climber.id }), !after.onWall, !after.top else { continue }
                let others = done.filter { $0.id != after.id }
                let place = LeadAscentView.place(of: after.height, top: false, among: others)
                moments.append(LiveMoment(id: "done:\(after.id)", chart: .ascent, tier: .swing, kind: .finished,
                                          lead: after.label, detail: "\(after.name) · \(Ordinal.string(place)) for now"))
            }
            // The final decided: the last starter is down. Gold, from the winner's mark.
            if final, decided(new.wall), !decided(old.wall),
               let winner = route.climbers.min(by: { ($0.rank ?? .max, $0.top ? 0 : 1, -$0.height) < ($1.rank ?? .max, $1.top ? 0 : 1, -$1.height) }) {
                // A top that decides it is the decisive moment itself (flag,
                // knocks, gold), not a second moment that would take the one
                // celebration slot and drop them.
                if let top = moments.lastIndex(where: { $0.kind == .top && $0.chart == .ascent }) {
                    moments[top].accents.insert(.decisive)
                    continue
                }
                var won = LiveMoment(id: "decided:\(route.name)", chart: .ascent, tier: .score, kind: .finished,
                                     lead: "Final won", detail: "\(winner.name) · \(winner.label)")
                won.targets = [String(winner.id)]
                won.accents = .decisive
                moments.append(won)
            }
        }
        // Boulder: a top (captioned) or a zone (the cell fills) on any problem.
        for card in new.boulders {
            guard let before = old.boulders.first(where: { $0.id == card.id }) else { continue }
            for (index, problem) in card.problems.enumerated() where index < before.problems.count {
                let was = before.problems[index].reach
                let name = new.boulderProblems.indices.contains(index) ? new.boulderProblems[index] : "\(index + 1)"
                let tries = problem.tries.map { $0 == 1 ? "flash" : "\(Ordinal.string($0)) attempt" }
                if problem.reach == .top, was != .top {
                    var top = LiveMoment(id: "boulder:\(card.id):\(index):top", chart: .boulder, tier: .swing, kind: .top,
                                         lead: "Top", detail: ["\(card.name) on B\(name)", tries].compactMap { $0 }.joined(separator: ", "))
                    if problem.tries == 1 { top.accents = .flash }
                    moments.append(top)
                } else if problem.reach == .zone, was == .none || was == .lowZone {
                    moments.append(LiveMoment(id: "boulder:\(card.id):\(index):zone", chart: .boulder, tier: .routine, kind: .zone,
                                              lead: "Zone", detail: "\(card.name) on B\(name)"))
                }
            }
        }
        return moments
    }

    /// New leader (1st, with someone below) and, in a final, into the medal
    /// zone for the first time this climb (heights only rise, so once).
    private static func standing(after now: (height: Double, top: Bool), before then: (height: Double, top: Bool),
                                 among done: [GameDetail.WallRoute.Climber], final: Bool, passedAnyone: Bool) -> LiveMoment.Accents {
        let place = LeadAscentView.place(of: now.height, top: now.top, among: done)
        let was = LeadAscentView.place(of: then.height, top: then.top, among: done)
        var accents: LiveMoment.Accents = []
        if place == 1, was > 1, passedAnyone, !done.isEmpty { accents.insert(.newLeader) }
        if final, place <= 3, was > 3 { accents.insert(.podium) }
        return accents
    }

    /// Places gained (positive) or lost per athlete ID between two live
    /// readings of the same round. New and unranked athletes have none.
    static func rankDeltas(from old: [GameDetail.Athlete], to new: [GameDetail.Athlete]) -> [Int: Int] {
        let before = Dictionary(old.compactMap { a in a.rank.map { (a.id, $0) } }, uniquingKeysWith: { first, _ in first })
        var deltas: [Int: Int] = [:]
        for athlete in new {
            guard let rank = athlete.rank, let was = before[athlete.id], was != rank else { continue }
            deltas[athlete.id] = was - rank
        }
        return deltas
    }

    // MARK: Final

    /// "Final. Lakers win, 112 to 104." / "Final. 1 to 1." for VoiceOver.
    static func finalAnnouncement(top: (name: String, score: String?), bottom: (name: String, score: String?),
                                  winner: GameDetail.Side?) -> String {
        let scores = [top.score, bottom.score].compactMap { $0 }
        guard let winner else { return scores.count == 2 ? "Final. \(scores[0]) to \(scores[1])." : "Final." }
        let (w, l) = winner == .top ? (top, bottom) : (bottom, top)
        guard let ws = w.score, let ls = l.score else { return "Final. \(w.name) win." }
        return "Final. \(w.name) win, \(ws) to \(ls)."
    }

    /// The winning side from the result flags, else the higher score.
    static func winner(top: Competitor, bottom: Competitor, scores: (top: String?, bottom: String?)) -> GameDetail.Side? {
        if top.isWinner != bottom.isWinner { return top.isWinner ? .top : .bottom }
        guard let a = scores.top.flatMap(Double.init), let b = scores.bottom.flatMap(Double.init), a != b else { return nil }
        return a > b ? .top : .bottom
    }
}

// MARK: - Hero beats

/// The hero scoreboard's triggers (§2.9–2.11, §6.3). A score's digits pop
/// (with the scorer's pill) when the number actually changes: the moment can
/// arrive before the scoreboard has the score (soccer, CS2) or after it
/// (football's lane updates both together), so whichever comes second fires
/// the pop. The wash and the decisive glint follow the moment itself.
struct HeroBeats: Equatable {
    private(set) var pops: [GameDetail.Side: Int] = [:]
    private(set) var washPulses = 0
    /// The side whose wash brightens; nil brightens both (climbing's flag colors).
    private(set) var washSide: GameDetail.Side?
    private(set) var glints = 0
    /// Bumped when a trophy is won on this page (a climbing final, a CS2 series).
    private(set) var trophies = 0
    private var rose: [GameDetail.Side: Date] = [:]
    private var pending: Pending?
    private var lastDecisive: Date?

    private struct Pending: Equatable {
        let side: GameDetail.Side
        let until: Date
    }

    /// A number that rose this long before its moment arrived is that moment's score.
    static let recent: TimeInterval = 90
    /// How long a moment waits for its score to reach the scoreboard.
    static let wait: TimeInterval = 45

    func pops(_ side: GameDetail.Side) -> Int { pops[side] ?? 0 }

    /// A score-tier moment on this page.
    mutating func score(_ side: GameDetail.Side?, decisive: Bool, at now: Date) {
        washSide = side
        washPulses += 1
        if decisive {
            glints += 1
            lastDecisive = now
        }
        guard let side else { return }
        if let t = rose[side], now.timeIntervalSince(t) < Self.recent {
            pop(side)
        } else {
            pending = Pending(side: side, until: now.addingTimeInterval(Self.wait))
        }
    }

    /// The hero's number for `side` went up.
    mutating func scoreRose(_ side: GameDetail.Side, at now: Date) {
        if let p = pending, p.side == side, now < p.until {
            pending = nil
            pop(side)
        } else {
            rose[side] = now
        }
    }

    /// The game just ended on this page: the winner's number pops, their side
    /// of the wash lifts and the glint sweeps once, unless a decisive score
    /// celebrated the result moments ago. Returns whether the beat played.
    @discardableResult
    mutating func final(winner: GameDetail.Side?, bothSides: Bool, trophy: Bool, at now: Date) -> Bool {
        if trophy { trophies += 1 }
        if let last = lastDecisive, now.timeIntervalSince(last) < Self.recent { return false }
        if let winner {
            pop(winner)
            washSide = winner
            washPulses += 1
        } else if bothSides {
            washSide = nil
            washPulses += 1
        }
        glints += 1
        return true
    }

    mutating func trophy() { trophies += 1 }

    private mutating func pop(_ side: GameDetail.Side) {
        pops[side, default: 0] += 1
        // Used up: a later moment waits for its own change.
        rose[side] = nil
    }
}

// MARK: - One-shot keyframes

/// A value that plays a keyframe track once per change of `trigger` and rests
/// at `rest`: live through `KeyframeAnimator`, or sampled at the harness's
/// frozen clock. Never plays on first render. For marks this file's charts
/// draw themselves (the uprights, a bar's glint, the red zone's breath).
struct OneShot<Track: Keyframes, Content: View>: View where Track.Value == Double {
    let trigger: Int
    var rest: Double = 0
    let keyframes: () -> Track
    @ViewBuilder let content: (Double) -> Content
    @Environment(\.celebrationClock) private var clock

    var body: some View {
        switch clock {
        case let .frozen(t):
            content(trigger > 0 ? KeyframeTimeline(initialValue: rest, content: keyframes).value(time: max(t, 0)) : rest)
        case .live:
            KeyframeAnimator(initialValue: rest, trigger: trigger) { value in
                content(value)
            } keyframes: { _ in
                keyframes()
            }
        }
    }
}

extension CelebrationClock {
    /// The same clock `delay` seconds later, for a mark that starts after its moment.
    func delayed(by delay: Double) -> CelebrationClock {
        guard case let .frozen(t) = self else { return self }
        return .frozen(t - delay)
    }
}

/// A rank change's chips and moved-up washes, held for the moment's hold.
struct RankShift: Equatable {
    var id = 0
    var deltas: [Int: Int] = [:]
}
