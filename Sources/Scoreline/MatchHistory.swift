import Foundation

/// A game's reported events on the same wall clock as market prices. Game
/// clocks label those events; they are never stretched over a market chart.
/// Breaks, overtime and added time therefore keep their actual width.
struct MatchHistory: Equatable {
    struct Event: Equatable, Identifiable {
        let id: String
        let t: Date
        let period: Int
        let clock: String
        let text: String
        let side: GameDetail.Side?
        /// The team in `side` gave the ball away.
        var turnover = false
    }

    /// How long a game usually runs, first play to last, and how many periods
    /// it's played in: what a live game's axis is sized for, so nothing on it
    /// moves as the game goes on.
    struct Pace: Equatable {
        var game: TimeInterval
        var periods: Int

        static func of(_ sport: Sport, path: String? = nil) -> Pace {
            switch (sport, path) {
            case (.soccer, _): Pace(game: 113 * 60, periods: 2)
            case (.baseball, _): Pace(game: 165 * 60, periods: 9)
            case (.football, "football/college-football"): Pace(game: 205 * 60, periods: 4)
            case (.football, _): Pace(game: 185 * 60, periods: 4)
            case (.basketball, "basketball/mens-college-basketball"), (.basketball, "basketball/womens-college-basketball"):
                Pace(game: 125 * 60, periods: 2)
            case (.basketball, "basketball/wnba"): Pace(game: 125 * 60, periods: 4)
            default: Pace(game: 155 * 60, periods: 4)
            }
        }
    }

    var sport: Sport
    var pace: Pace
    var events: [Event]
    var periods: [OddsPeriod]

    init(sport: Sport, path: String? = nil, events: [Event] = [], periods: [OddsPeriod] = []) {
        self.sport = sport
        pace = .of(sport, path: path)
        self.events = events
        self.periods = periods
    }

    var start: Date? { periods.first?.start ?? events.first?.t }
    var end: Date? { periods.last?.end ?? events.last?.t }

    /// When a play happened, by its ID. An NBA run's moment ("…-run") is its last basket.
    func time(of id: String) -> Date? {
        let play = Replays.play(of: id)
        return events.first { $0.id == play }?.t
    }

    /// Only knowledge already reached by the page's broadcast. Even period
    /// ends are clipped: the duration of an upcoming half must not leak.
    func shown(until: Date?) -> MatchHistory {
        guard let until, (end ?? .distantPast) > until else { return self }
        var copy = self
        copy.events = events.filter { $0.t <= until }
        copy.periods = Self.clipped(periods, until: until)
        return copy
    }

    static func clipped(_ periods: [OddsPeriod], until: Date) -> [OddsPeriod] {
        periods.filter { $0.start <= until }.map {
            OddsPeriod(number: $0.number, label: $0.label, start: $0.start, end: min($0.end, until))
        }
    }

    /// Where a live game has got to: what the page has presented, or without a
    /// broadcast the newest thing heard. The caller supplies the same newest
    /// market timestamp to both modules; there is no hidden Date.now that
    /// could move one a few pixels from the other.
    func now(eventStart: Date, latest: Date? = nil, until: Date? = nil) -> Date {
        until ?? [end, latest].compactMap { $0 }.max() ?? eventStart
    }

    /// One domain for both modules, independent of market availability. A live
    /// game's axis is the game's usual length from its first play, so marks
    /// stay where they are and the game fills it from the left; past that it
    /// grows by a quarter hour at a time. A final ends at its last play.
    func domain(state: EventState, window: OddsWindow, eventStart: Date,
                latest: Date? = nil, until: Date? = nil) -> ClosedRange<Date> {
        let visible = shown(until: until)
        let latestShown = latest.map { date in until.map { min(date, $0) } ?? date }
        if state == .scheduled {
            let last = latestShown ?? until ?? eventStart
            return (last - 86_400)...last
        }
        let first = visible.start ?? eventStart
        let now = visible.now(eventStart: eventStart, latest: latestShown, until: until)
        // During opening buffer warm-up p can precede the first recorded
        // play. Keep a valid, finite domain without exposing that future play.
        let lower = min(first, now - 1)
        let live = state == .live
        if case let .period(number) = window, let index = visible.periods.firstIndex(where: { $0.number == number }) {
            let period = visible.periods[index]
            guard live, index == visible.periods.count - 1 else { return period.start...max(period.end, period.start + 60) }
            return period.start...Self.axisEnd(from: period.start, now: now, length: pace.game / Double(pace.periods))
        }
        guard live else { return lower...max(visible.end ?? now, lower + 1) }
        if window == .recent { return max(lower, now - 600)...now }
        return lower...Self.axisEnd(from: lower, now: now, length: pace.game)
    }

    private static func axisEnd(from start: Date, now: Date, length: TimeInterval) -> Date {
        let end = start + length
        guard now > end else { return end }
        return end + (now.timeIntervalSince(end) / 900).rounded(.up) * 900
    }

    // MARK: ESPN chronology

    /// Shared with OddsBaseline so a corrected timestamp moves the market's
    /// ESPN model and the timeline's event by exactly the same amount.
    struct PlacedPlay {
        let json: JSON
        let t: Date
    }

    /// The plays in game order on the wall clock. Stamps run backwards now and
    /// then, because one play was logged late (14 of 552 in GSW at MIN). The
    /// longest run of stamps in order stands as reported; a play out of it
    /// goes as near its own stamp as its neighbors allow, so one late stamp
    /// never drags the plays after it to its time.
    static func chronology(_ summary: JSON, sport: Sport) -> [PlacedPlay] {
        let dated = rawPlays(summary, sport: sport).compactMap { play -> (json: JSON, t: Date)? in
            guard let wall = DateParser.parse(play["wallclock"].string), wall.timeIntervalSince1970.isFinite else { return nil }
            return (play, wall)
        }
        let times = placed(dated.map(\.t))
        return zip(dated, times).map { PlacedPlay(json: $0.json, t: $1) }
    }

    /// Each stamp, moved only as far as staying in order needs. (pure; tested)
    static func placed(_ stamps: [Date]) -> [Date] {
        let kept = inOrder(stamps)
        var times = stamps
        var previous = Date.distantPast
        for index in stamps.indices {
            if kept[index] {
                previous = stamps[index]
            } else {
                let next = stamps[(index + 1)...].indices.first { kept[$0] }.map { stamps[$0] } ?? .distantFuture
                times[index] = min(max(stamps[index], previous), next)
                previous = times[index]
            }
        }
        return times
    }

    /// Which stamps are in the longest run in order. Between runs of the same
    /// length, the earlier play stands. (pure; tested)
    static func inOrder(_ stamps: [Date]) -> [Bool] {
        // Patience sorting from the end: `tails[k]` is the index ending the
        // best run of length k + 1, read forwards from there.
        var tails: [Int] = []
        var next = Array(repeating: -1, count: stamps.count)
        for index in stamps.indices.reversed() {
            var lo = 0, hi = tails.count
            while lo < hi {
                let mid = (lo + hi) / 2
                if stamps[tails[mid]] >= stamps[index] { lo = mid + 1 } else { hi = mid }
            }
            next[index] = lo > 0 ? tails[lo - 1] : -1
            if lo == tails.count { tails.append(index) } else { tails[lo] = index }
        }
        var kept = Array(repeating: false, count: stamps.count)
        var index = tails.last ?? -1
        while index >= 0 {
            kept[index] = true
            index = next[index]
        }
        return kept
    }

    /// All currently supported ESPN sports. CS rounds and climbing attempts
    /// have no comparable absolute event history in their current providers;
    /// those views must not fabricate a market-aligned chronology.
    static func parse(_ summary: JSON, sport: Sport, topID: String?, bottomID: String?, path: String? = nil) -> MatchHistory {
        guard sport != .esports, sport != .climbing else { return MatchHistory(sport: sport) }
        func side(_ id: String?) -> GameDetail.Side? {
            guard let id else { return nil }
            if let topID, id == topID { return .top }
            if let bottomID, id == bottomID { return .bottom }
            return nil
        }
        var history = MatchHistory(sport: sport, path: path)
        let placed = chronology(summary, sport: sport)
        history.events = placed.compactMap { entry in
            let p = entry.json
            let rawText = p["text"].string ?? p["shortText"].string ?? p["type"]["text"].string ?? ""
            let text = (sport == .soccer ? OddsBaseline.soccerLine(rawText)
                        : sport == .basketball ? NBADetail.plain(rawText) : rawText)
                .split(whereSeparator: \.isWhitespace).joined(separator: " ")
            // Pitches retain their place in period bounds, without filling
            // the inspector with each pitch of the same baseball at-bat.
            guard !text.isEmpty, !(sport == .baseball && text.hasPrefix("Pitch ")) else { return nil }
            // A turnover belongs to the team that had the ball at the snap.
            let turnover = sport == .football && p["isTurnover"].bool == true
            return Event(id: identity(p, sport: sport), t: entry.t, period: p["period"]["number"].int ?? 1,
                         clock: clock(p, sport: sport, path: path), text: text,
                         side: side(p["team"]["id"].string ?? (turnover ? p["start"]["team"]["id"].string : nil)), turnover: turnover)
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
}
