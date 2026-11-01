import Foundation

/// A game's reported events on the same wall clock as market prices. Game
/// clocks label those events; they are never stretched over a market chart.
/// Breaks, overtime and added time therefore keep their actual width.
struct MatchHistory: Equatable {
    enum Kind: Equatable {
        case goal, ownGoal, yellow, red, score, period, timeout, play
    }

    enum Timing: Equatable {
        /// The provider's event timestamp.
        case reported
        /// A timestamp that ran backwards was held at the preceding event.
        /// It is useful for ordering, but is not an exact event time.
        case adjusted
    }

    struct Event: Equatable, Identifiable {
        let id: String
        let t: Date
        let period: Int
        let clock: String
        let text: String
        let side: GameDetail.Side?
        let kind: Kind
        let score: String?
        let timing: Timing

        var isKeyEvent: Bool {
            switch kind {
            case .goal, .ownGoal, .yellow, .red, .score: true
            case .period, .timeout, .play: false
            }
        }
    }

    var sport: Sport
    var events: [Event] = []
    var periods: [OddsPeriod] = []
    /// Events whose timestamps cannot be placed honestly. These are not
    /// assigned kickoff-plus-game-clock times: stoppages make that incorrect.
    var missingTimeCount = 0
    /// Generic coverage notice survives broadcast clipping without revealing
    /// the number or kinds of not-yet-presented, untimed events.
    var hasUntimedEvents = false

    var start: Date? { periods.first?.start ?? events.first?.t }
    var end: Date? { periods.last?.end ?? events.last?.t }
    var keyEvents: [Event] { events.filter(\.isKeyEvent) }

    /// Only knowledge already reached by the page's broadcast. Even period
    /// ends are clipped: the duration of an upcoming half must not leak.
    func shown(until: Date?) -> MatchHistory {
        guard let until else { return self }
        var copy = self
        copy.events = events.filter { $0.t <= until }
        copy.periods = Self.clipped(periods, until: until)
        // An untimed event cannot be proven to precede the presentation time.
        copy.missingTimeCount = 0
        return copy
    }

    static func clipped(_ periods: [OddsPeriod], until: Date) -> [OddsPeriod] {
        periods.filter { $0.start <= until }.map {
            OddsPeriod(number: $0.number, label: $0.label, start: $0.start, end: min($0.end, until))
        }
    }

    /// One domain for both modules, independent of market availability. The
    /// caller supplies the same newest market timestamp to each; there is no
    /// hidden Date.now that could move one module a few pixels from the other.
    func domain(state: EventState, window: OddsWindow, eventStart: Date,
                latest: Date? = nil, until: Date? = nil) -> ClosedRange<Date> {
        let visible = shown(until: until)
        let first = visible.start ?? eventStart
        let latestShown = latest.map { date in until.map { min(date, $0) } ?? date }
        if state == .scheduled {
            let last = latestShown ?? until ?? eventStart
            return (last - 86_400)...last
        }
        let newest = [visible.end, latestShown]
            .compactMap { $0 }.max() ?? until ?? eventStart
        let naturalEnd = state == .final ? visible.end ?? newest : newest
        let desiredEnd = max(naturalEnd, first + (state == .final ? 1 : 60))
        let last = until.map { min(desiredEnd, $0) } ?? desiredEnd
        // During opening buffer warm-up p can precede the first recorded
        // play. Keep a valid, finite domain without exposing that future play.
        let lower = min(first, last - 1)
        return (window == .recent ? max(lower, last - 600) : lower)...last
    }

    /// The nearest named event, with a bounded distance: a long commercial
    /// break must not claim that a goal happened at the pointer's instant.
    func event(near t: Date, within distance: TimeInterval = 90, keyOnly: Bool = false) -> Event? {
        guard distance >= 0 else { return nil }
        let source = keyOnly ? keyEvents : events
        guard let index = Self.index(source, atOrBefore: t) else {
            return source.first.flatMap { abs($0.t.timeIntervalSince(t)) <= distance ? $0 : nil }
        }
        let next = source.indices.contains(index + 1) ? source[index + 1] : nil
        let event = next.map { abs($0.t.timeIntervalSince(t)) < abs(source[index].t.timeIntervalSince(t)) ? $0 : source[index] }
            ?? source[index]
        return abs(event.t.timeIntervalSince(t)) <= distance ? event : nil
    }

    /// The last reported game clock at/before a pointer. It is not a ticking
    /// or interpolated clock, and never borrows a future event's game state.
    func context(at t: Date) -> Event? { Self.index(events, atOrBefore: t).map { events[$0] } }

    func previous(before t: Date, keyOnly: Bool = true) -> Event? {
        (keyOnly ? keyEvents : events).last { $0.t < t }
    }

    func next(after t: Date, keyOnly: Bool = true) -> Event? {
        (keyOnly ? keyEvents : events).first { $0.t > t }
    }

    private static func index(_ source: [Event], atOrBefore t: Date) -> Int? {
        var lo = 0, hi = source.count, result: Int?
        while lo < hi {
            let mid = (lo + hi) / 2
            if source[mid].t <= t { result = mid; lo = mid + 1 } else { hi = mid }
        }
        return result
    }

    // MARK: ESPN chronology

    /// Shared with OddsBaseline so a corrected timestamp moves the market's
    /// ESPN model and the timeline's event by exactly the same amount.
    struct PlacedPlay {
        let json: JSON
        let t: Date
        let timing: Timing
    }

    static func chronology(_ summary: JSON, sport: Sport) -> [PlacedPlay] {
        var latest = Date.distantPast
        return rawPlays(summary, sport: sport).compactMap { play in
            guard let wall = DateParser.parse(play["wallclock"].string), wall.timeIntervalSince1970.isFinite else { return nil }
            let adjusted = wall < latest
            latest = max(latest, wall)
            return PlacedPlay(json: play, t: latest, timing: adjusted ? .adjusted : .reported)
        }
    }

    /// All currently supported ESPN sports. CS rounds and climbing attempts
    /// have no comparable absolute event history in their current providers;
    /// those views must not fabricate a market-aligned chronology.
    static func parse(_ summary: JSON, sport: Sport, topID: String?, bottomID: String?, path: String? = nil) -> MatchHistory {
        guard sport != .esports, sport != .climbing else { return MatchHistory(sport: sport) }
        let competitors = summary["header"]["competitions"][0]["competitors"].array
        let topIsHome = competitors.first { $0["team"]["id"].string == topID }?["homeAway"].string
        func side(_ play: JSON) -> GameDetail.Side? {
            guard let id = play["team"]["id"].string else { return nil }
            if let topID, id == topID { return .top }
            if let bottomID, id == bottomID { return .bottom }
            return nil
        }
        var history = MatchHistory(sport: sport)
        let placed = chronology(summary, sport: sport)
        history.events = placed.compactMap { entry in
            let p = entry.json
            let kind = Self.kind(p, sport: sport)
            let rawText = p["text"].string ?? p["shortText"].string ?? p["type"]["text"].string ?? ""
            let text = (sport == .soccer ? OddsBaseline.soccerLine(rawText)
                        : sport == .basketball ? NBADetail.plain(rawText) : rawText)
                .split(whereSeparator: \.isWhitespace).joined(separator: " ")
            // Pitches retain their place in period bounds, without filling
            // the inspector with each pitch of the same baseball at-bat.
            guard !text.isEmpty, !(sport == .baseball && text.hasPrefix("Pitch ")) else { return nil }
            let number = p["period"]["number"].int ?? 1
            return Event(id: identity(p, sport: sport), t: entry.t, period: number,
                         clock: clock(p, sport: sport, path: path), text: text, side: side(p), kind: kind,
                         score: topIsHome.map { ESPNDetail.scoreAfter(p, topIsHome: $0 == "home") } ?? nil,
                         timing: entry.timing)
        }
        var periodIndices: [Int: Int] = [:]
        for entry in placed {
            let n = entry.json["period"]["number"].int ?? 1
            guard n > 0 else { continue }
            if let i = periodIndices[n] {
                let old = history.periods[i]
                history.periods[i] = OddsPeriod(number: n, label: old.label, start: old.start, end: entry.t)
            } else {
                periodIndices[n] = history.periods.count
                history.periods.append(OddsPeriod(number: n, label: periodLabel(n, sport: sport, path: path), start: entry.t, end: entry.t))
            }
        }
        history.missingTimeCount = rawPlays(summary, sport: sport).filter {
            DateParser.parse($0["wallclock"].string) == nil
                && !($0["text"].string ?? $0["shortText"].string ?? "").isEmpty
        }.count
        history.hasUntimedEvents = history.missingTimeCount > 0
        return history
    }

    /// Deduplicate the drive/current-drive overlap and enrich commentary by
    /// play ID with key-event fields (team, goal/card type). Supplemental
    /// events without commentary keep their actual timestamp.
    static func rawPlays(_ summary: JSON, sport: Sport) -> [JSON] {
        let main: [JSON]
        switch sport {
        case .football:
            let drives = summary["drives"]["previous"].array.flatMap { $0["plays"].array }
                + summary["drives"]["current"]["plays"].array
            main = drives.isEmpty ? summary["plays"].array : drives
        case .soccer:
            main = summary["commentary"].array.compactMap { c in
                guard var play = c["play"].raw as? [String: Any] else { return nil }
                if let text = c["text"].string { play["text"] = text }
                return JSON(play)
            }
        default: main = summary["plays"].array
        }
        var plays: [JSON] = []
        var indices: [String: Int] = [:]
        func add(_ play: JSON, supplemental: Bool) {
            let id = identity(play, sport: sport)
            if let i = indices[id] {
                if let old = plays[i].raw as? [String: Any], let new = play.raw as? [String: Any] {
                    plays[i] = JSON(merge(old, new, supplemental: supplemental))
                }
            } else {
                indices[id] = plays.count
                plays.append(play)
            }
        }
        for play in main { add(play, supplemental: false) }
        let mainCount = plays.count
        for play in summary["keyEvents"].array + summary["scoringPlays"].array { add(play, supplemental: true) }
        if sport == .soccer {
            // ESPN commentary can arrive newest-first. Wall time is the
            // relevant axis; array position and sequence IDs are not clocks.
            return plays.enumerated().sorted {
                let a = DateParser.parse($0.element["wallclock"].string) ?? .distantFuture
                let b = DateParser.parse($1.element["wallclock"].string) ?? .distantFuture
                return a != b ? a < b : $0.offset < $1.offset
            }.map(\.element)
        }
        // Other sports' array order is authoritative. Insert independently
        // supplied scoring plays into it before clamping regressed stamps.
        let extra = Array(plays.dropFirst(mainCount))
        plays = Array(plays.prefix(mainCount))
        for play in extra {
            if let t = DateParser.parse(play["wallclock"].string),
               let i = plays.firstIndex(where: { DateParser.parse($0["wallclock"].string).map { $0 > t } ?? false }) {
                plays.insert(play, at: i)
            } else { plays.append(play) }
        }
        return plays
    }

    private static func merge(_ old: [String: Any], _ new: [String: Any], supplemental: Bool) -> [String: Any] {
        old.merging(new) { a, b in
            if let left = a as? [String: Any], let right = b as? [String: Any] {
                return merge(left, right, supplemental: supplemental)
            }
            if a is NSNull || (a as? String)?.isEmpty == true { return b }
            return supplemental ? a : b
        }
    }

    private static func identity(_ p: JSON, sport: Sport) -> String {
        if let id = p["id"].string, !id.isEmpty { return id }
        // Stable across polls, including malformed rows without provider IDs.
        let fields = [sport.rawValue, p["wallclock"].string ?? "", p["period"]["number"].string ?? "",
                      p["clock"]["displayValue"].string ?? "", p["type"]["type"].string ?? "",
                      p["text"].string ?? p["shortText"].string ?? ""]
        return "history:" + fields.joined(separator: "|")
    }

    static func periodLabel(_ n: Int, sport: Sport, path: String?) -> String {
        if path == "basketball/mens-college-basketball" {
            return n <= 2 ? "H\(n)" : Period.overtime(n - 2)
        }
        return OddsBaseline.periodLabel(n, sport: sport)
    }

    static func clock(_ p: JSON, sport: Sport, path: String?) -> String {
        let n = p["period"]["number"].int
        let display = p["clock"]["displayValue"].string ?? ""
        switch sport {
        case .soccer: return SlideWords.minuteMark(display) ?? display
        case .baseball:
            guard let n else { return "" }
            let half = p["period"]["type"].string?.lowercased()
            return half == "top" ? "Top \(Ordinal.string(n))" : half == "bottom" ? "Bot \(Ordinal.string(n))" : Ordinal.string(n)
        default:
            return [n.map { periodLabel($0, sport: sport, path: path) } ?? "", display].filter { !$0.isEmpty }.joined(separator: " ")
        }
    }

    private static func kind(_ p: JSON, sport: Sport) -> Kind {
        let type = (p["type"]["type"].string ?? p["type"]["text"].string ?? "").lowercased()
        let text = (p["text"].string ?? "").lowercased()
        if type == "own-goal" { return .ownGoal }
        if type == "red-card" || type == "yellow-red-card" { return .red }
        if type == "yellow-card" { return .yellow }
        if sport == .soccer, type == "goal" || type.hasPrefix("goal---") || type == "penalty---scored" || text.hasPrefix("goal!") { return .goal }
        if p["scoringPlay"].bool == true || p["scoringPlay"].bool != false && (p["scoreValue"].int ?? 0) > 0 { return .score }
        if type.contains("timeout") || text.contains("timeout") || text.contains("two-minute warning") { return .timeout }
        if type == "kickoff" && sport == .soccer || ["end-period", "end-half", "end-quarter", "end-game", "end-match", "end-extra-time"].contains(type)
            || text.hasPrefix("end of ") || text.contains("half ends") || text.contains("half begins") { return .period }
        return .play
    }
}
