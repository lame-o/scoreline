import Foundation

// What a live tile draws beyond the score, decoded from responses the app
// already downloads (ESPN scoreboards, the IFSC round results, bo3.gg's live
// snapshot). Nil or empty means the source didn't say: draw nothing, never guess.

enum LiveSnapshot: Hashable {
    /// Ball spot and line to gain on a 0…100 field from the top (left) team's goal line.
    case football(FootballSpot)
    case baseball(BaseState)
    /// Goals and red cards so far (empty: none yet, the track still shows time).
    case soccer([MatchMark])
    case basketball(lastPlay: String?)
    /// bo3.gg's live round score of the map being played.
    case counterStrike(GameDetail.CSLive)
    case climbing(WallState)
}

// MARK: - Football

struct FootballSpot: Hashable {
    /// 0 = the top (away, left crest) team's goal line, 100 = the bottom team's.
    let ballX: Double
    /// First-down marker in the same coordinates; nil between downs and when
    /// it's goal to go (the goal line is the target).
    let lineToGainX: Double?
    let possession: GameDetail.Side?
    let redZone: Bool
    let down: Int?
    let distance: Int?
    let goalToGo: Bool

    /// The top team attacks right (+x); the bottom team attacks left.
    var attacksLeft: Bool { possession == .bottom }
}

/// Field geometry shared by tiles and the match page's field (`FootballFeed`
/// builds its situation from it), so the two can never disagree.
enum FootballGeometry {
    /// ESPN counts yard lines from the home goal line; x runs from the top team's.
    static func x(_ yardLine: Double, topIsHome: Bool) -> Double { topIsHome ? yardLine : 100 - yardLine }

    /// Whether the line to gain is at or past the goal line ("1st & Goal").
    static func goalToGo(yardLine: Double, distance: Int, homeHasBall: Bool) -> Bool {
        let toEndzone = homeHasBall ? 100 - yardLine : yardLine
        return Int(toEndzone) <= distance
    }

    static func lineToGain(ballX: Double, distance: Int, possession: GameDetail.Side) -> Double {
        possession == .bottom ? max(ballX - Double(distance), 0) : min(ballX + Double(distance), 100)
    }

    /// A scoreboard situation as a spot. `possession` is the side with the ball.
    static func spot(yardLine: Double, down: Int?, distance: Int?, possession: GameDetail.Side?, topIsHome: Bool,
                     redZone: Bool) -> FootballSpot {
        let ballX = x(yardLine, topIsHome: topIsHome)
        var gain: Double?
        var goal = false
        if let down, (1...4).contains(down), let distance, let possession {
            let homeHasBall = (possession == .top) == topIsHome
            goal = goalToGo(yardLine: yardLine, distance: distance, homeHasBall: homeHasBall)
            gain = goal ? nil : lineToGain(ballX: ballX, distance: distance, possession: possession)
        }
        return FootballSpot(ballX: ballX, lineToGainX: gain, possession: possession, redZone: redZone,
                            down: down, distance: distance, goalToGo: goal)
    }
}

// MARK: - Baseball

struct BaseState: Hashable {
    let onFirst: Bool
    let onSecond: Bool
    let onThird: Bool
    let balls: Int
    let strikes: Int
    let outs: Int
    let batter: String?
    let pitcher: String?

    var runners: Int { [onFirst, onSecond, onThird].filter { $0 }.count }
}

// MARK: - Soccer

struct MatchMark: Hashable {
    enum Kind: Hashable { case goal, penalty, ownGoal, redCard }
    /// Match minute, stoppage included ("90'+3'" → 93).
    let minute: Double
    /// The team the mark belongs to (a goal: the side credited). Nil only for
    /// an own goal whose side can't be told from the scores.
    let side: GameDetail.Side?
    let kind: Kind
    let player: String?
    /// The source's clock text ("64'", "45'+2'").
    let clock: String

    var isGoal: Bool { kind != .redCard }

    /// "45'+2'" → 47; "64'" → 64.
    static func minute(from display: String) -> Double? {
        let parts = display.split(separator: "+").compactMap { Int($0.filter(\.isNumber)) }
        guard let first = parts.first else { return nil }
        return Double(first + parts.dropFirst().reduce(0, +))
    }

    /// The latest goal in a line: "Saka 64'", "Kane 23' (pen)", "Gross 17' (OG)".
    static func lastGoalLine(_ marks: [MatchMark]) -> String? {
        guard let goal = marks.last(where: \.isGoal) else { return nil }
        let name = goal.player.map(surname) ?? "Goal"
        let suffix = goal.kind == .penalty ? " (pen)" : goal.kind == .ownGoal ? " (OG)" : ""
        return "\(name) \(goal.clock)\(suffix)"
    }

    /// "B. Saka" → "Saka"; single names stay.
    static func surname(_ name: String) -> String {
        let parts = name.split(separator: " ")
        guard parts.count > 1, parts[0].hasSuffix(".") else { return name }
        return parts.dropFirst().joined(separator: " ")
    }

    /// Places own goals so each side's goal count matches its score. ESPN's
    /// team on an own goal is ambiguous (sometimes the beneficiary, sometimes
    /// the scorer's team), so the credited side is whichever makes the counts
    /// add up; if no assignment does, the own goal draws on the track with no
    /// side. Ordinary goals and cards keep the side the source gave.
    static func reconcile(_ marks: [MatchMark], topScore: Int?, bottomScore: Int?) -> [MatchMark] {
        let owns = marks.indices.filter { marks[$0].kind == .ownGoal }
        guard !owns.isEmpty, let topScore, let bottomScore else { return marks }
        let fixedTop = marks.filter { $0.isGoal && $0.kind != .ownGoal && $0.side == .top }.count
        let fixedBottom = marks.filter { $0.isGoal && $0.kind != .ownGoal && $0.side == .bottom }.count
        let needTop = topScore - fixedTop, needBottom = bottomScore - fixedBottom
        var output = marks
        guard needTop >= 0, needBottom >= 0, needTop + needBottom == owns.count else {
            for i in owns { output[i] = output[i].with(side: nil) }
            return output
        }
        // The source's sides already add up: keep them.
        if owns.filter({ marks[$0].side == .top }).count == needTop
            && owns.allSatisfy({ marks[$0].side != nil }) { return marks }
        // Only one way to split them when every own goal goes to the same side.
        if needTop == 0 || needBottom == 0 {
            for i in owns { output[i] = output[i].with(side: needTop > 0 ? .top : .bottom) }
            return output
        }
        // Mixed, and the counts can't say which is which: no side.
        for i in owns { output[i] = output[i].with(side: nil) }
        return output
    }

    func with(side: GameDetail.Side?) -> MatchMark {
        MatchMark(minute: minute, side: side, kind: kind, player: player, clock: clock)
    }
}

// MARK: - Climbing

/// Who's on the wall in a live round, from the IFSC results the provider
/// already fetches for the leader.
struct WallState: Hashable {
    struct Athlete: Hashable {
        let name: String
        let flag: String?
        /// IOC code ("JPN").
        let country: String?
    }

    struct Ascent: Hashable {
        let athlete: Athlete
        /// Hold number, +0.5 when moving to the next ("38+").
        let height: Double
        let top: Bool
        /// "38+", "Top".
        let label: String
    }

    enum Reach: Hashable { case none, lowZone, zone, top }

    enum Phase: Hashable {
        /// Lead: the climber on the wall and the leader on that route.
        case lead(climber: Ascent, leader: Ascent?, route: String?)
        /// Boulder: the athlete on a problem and their card so far.
        case boulder(athlete: Athlete, cells: [Reach], active: Int?)
        /// Between climbers (and in speed): who climbs next.
        case upNext(Athlete)
    }

    let phase: Phase

    /// The athlete the tile is dressed in (flag colors).
    var country: String? {
        switch phase {
        case let .lead(climber, _, _): climber.athlete.country
        case let .boulder(athlete, _, _): athlete.country
        case let .upNext(athlete): athlete.country
        }
    }

    /// The lead bar's domain: 0 to the next ten above the higher of the two
    /// heights (viz-spec scale rule), at least 10.
    static func domain(height: Double, leader: Double?) -> Double {
        max(10, ((max(height, leader ?? 0) + 1) / 10).rounded(.up) * 10)
    }

    /// Reads an IFSC round-results JSON. Nil when nobody is on the wall and
    /// nobody is waiting (the round hasn't started, or it's over).
    static func from(results: JSON) -> WallState? {
        let athletes = results["ranking"].array
        let routes = results["routes"].array.compactMap { $0["name"].string }
        let ascents = athletes.flatMap { $0["ascents"].array }
        let discipline = results["discipline"].string?.lowercased()
        let isBoulder = discipline == "boulder" || (discipline == nil && ascents.contains { $0["zone"].exists })
        let isSpeed = discipline == "speed" || (discipline == nil && ascents.contains { $0["time_ms"].exists && !$0["plus"].exists })

        func athlete(name: String, flag: String?, country: String?) -> Athlete {
            Athlete(name: name, flag: flag, country: country)
        }

        if isBoulder {
            let cards = athletes.compactMap { ClimbingDetail.boulderCard($0, routes: routes) }
            if let card = cards.first(where: \.onWall) {
                let cells = card.problems.map { p -> Reach in
                    switch p.reach {
                    case .none: .none
                    case .lowZone: .lowZone
                    case .zone: .zone
                    case .top: .top
                    }
                }
                return WallState(phase: .boulder(athlete: athlete(name: card.name, flag: card.flag, country: card.country),
                                                 cells: cells, active: card.problems.firstIndex(where: \.active)))
            }
        } else if !isSpeed {
            for route in routes {
                let wall = ClimbingDetail.wallRoute(named: route, athletes: athletes)
                guard let climber = wall.climbers.first(where: \.onWall) else { continue }
                func ascent(_ c: GameDetail.WallRoute.Climber) -> Ascent {
                    Ascent(athlete: athlete(name: c.name, flag: c.flag, country: c.country), height: c.height, top: c.top,
                           label: c.top ? "Top" : c.label)
                }
                // The leader on this route: the highest climber who isn't climbing now.
                let leader = wall.climbers.first { $0.id != climber.id && !$0.onWall && ($0.top || $0.height > 0) }
                return WallState(phase: .lead(climber: ascent(climber), leader: leader.map(ascent),
                                              route: routes.count > 1 ? route : nil))
            }
        }
        if let next = ClimbingDetail.upNext(results, route: routes.first) {
            // `upNext` gives the display name and flag; find the country for the wash.
            let country = results["startlist"].array.first { s in
                let initial = s["firstname"].string?.first.map { "\($0). " } ?? ""
                return initial + (s["lastname"].string ?? "").capitalized == next.name
            }?["country"].string
            return WallState(phase: .upNext(athlete(name: next.name, flag: next.flag, country: country)))
        }
        return nil
    }
}

// MARK: - CS2

extension CSDetail {
    /// bo3.gg's live state for a scores-list event (IDs are "cs-123").
    static func liveState(for event: Event) async -> GameDetail.CSLive? {
        guard event.state == .live, let matchID = Int(event.id.dropFirst(3)) else { return nil }
        let ids = event.competitors.map { $0.id.flatMap { Int($0.dropFirst(3)) } }
        return await liveState(matchID: matchID, topTeamID: ids.first ?? nil, bottomTeamID: ids.last ?? nil)
    }

    /// "Mirage 5–8", the list row's live line (top team first).
    static func line(_ live: GameDetail.CSLive) -> String {
        [live.mapName, "\(live.topScore)–\(live.bottomScore)"].compactMap { $0 }.joined(separator: " ")
    }
}
