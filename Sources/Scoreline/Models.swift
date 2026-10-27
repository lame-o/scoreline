import Foundation

// MARK: - Sports & leagues

enum Sport: String, CaseIterable, Identifiable {
    case soccer, football, baseball, basketball, esports, climbing

    var id: String { rawValue }

    var name: String {
        switch self {
        case .soccer: "Soccer"
        case .football: "Football"
        case .baseball: "Baseball"
        case .basketball: "Basketball"
        case .esports: "Esports"
        case .climbing: "Climbing"
        }
    }

    var symbol: String {
        switch self {
        case .soccer: "soccerball"
        case .football: "football.fill"
        case .baseball: "baseball.fill"
        case .basketball: "basketball.fill"
        case .esports: "gamecontroller.fill"
        case .climbing: "figure.climbing"
        }
    }
}

enum Source: Hashable {
    /// ESPN scoreboard, e.g. "soccer/eng.1". Weekly leagues (NFL, college football)
    /// are fetched as the current week; everything else day by day.
    case espn(path: String, weekly: Bool = false)
    case counterStrike
    case ifsc
}

struct League: Identifiable, Hashable {
    let id: String
    let name: String
    let sport: Sport
    let source: Source

    static let catalog: [League] = [
        League(id: "eng.1", name: "Premier League", sport: .soccer, source: .espn(path: "soccer/eng.1")),
        League(id: "uefa.champions", name: "Champions League", sport: .soccer, source: .espn(path: "soccer/uefa.champions")),
        League(id: "uefa.europa", name: "Europa League", sport: .soccer, source: .espn(path: "soccer/uefa.europa")),
        League(id: "esp.1", name: "LaLiga", sport: .soccer, source: .espn(path: "soccer/esp.1")),
        League(id: "ita.1", name: "Serie A", sport: .soccer, source: .espn(path: "soccer/ita.1")),
        League(id: "ger.1", name: "Bundesliga", sport: .soccer, source: .espn(path: "soccer/ger.1")),
        League(id: "fra.1", name: "Ligue 1", sport: .soccer, source: .espn(path: "soccer/fra.1")),
        League(id: "eng.2", name: "Championship", sport: .soccer, source: .espn(path: "soccer/eng.2")),
        League(id: "usa.1", name: "MLS", sport: .soccer, source: .espn(path: "soccer/usa.1")),
        League(id: "fifa.world", name: "FIFA World Cup", sport: .soccer, source: .espn(path: "soccer/fifa.world")),

        League(id: "nfl", name: "NFL", sport: .football, source: .espn(path: "football/nfl", weekly: true)),
        League(id: "college-football", name: "College Football", sport: .football, source: .espn(path: "football/college-football", weekly: true)),

        League(id: "mlb", name: "MLB", sport: .baseball, source: .espn(path: "baseball/mlb")),

        League(id: "nba", name: "NBA", sport: .basketball, source: .espn(path: "basketball/nba")),
        League(id: "wnba", name: "WNBA", sport: .basketball, source: .espn(path: "basketball/wnba")),

        League(id: "cs2", name: "Counter-Strike 2", sport: .esports, source: .counterStrike),

        League(id: "ifsc", name: "World Climbing Series", sport: .climbing, source: .ifsc),
    ]

    static let defaultIDs = ["eng.1", "uefa.champions", "nfl", "mlb", "cs2", "ifsc"]

    static func with(id: String) -> League? { catalog.first { $0.id == id } }

    /// A label for tight spaces (small tiles): "EPL", "UCL", "CS2".
    var shortName: String {
        switch id {
        case "eng.1": "EPL"
        case "uefa.champions": "UCL"
        case "uefa.europa": "UEL"
        case "eng.2": "EFL Champ"
        case "fifa.world": "World Cup"
        case "college-football": "College"
        case "cs2": "CS2"
        case "ifsc": "Climbing"
        default: name
        }
    }
}

// MARK: - Events

enum EventState: Int, Comparable {
    case live = 0, scheduled = 1, final = 2
    static func < (a: Self, b: Self) -> Bool { a.rawValue < b.rawValue }
}

struct Competitor: Hashable {
    /// Stable across refreshes and seasons; used to follow a team.
    let id: String?
    let name: String
    /// Short code for the menu bar ("ARS", "NAVI").
    let abbreviation: String
    let score: String?
    let logo: URL?
    let isWinner: Bool
    /// Team color as a hex string, when the source provides one.
    var color: String? = nil
    /// Poll rank (college: AP Top 25), when ranked.
    var rank: Int? = nil
    /// Season record ("7-1") and, in college, the conference record ("4-1").
    var record: String? = nil
    var conferenceRecord: String? = nil
    /// The team's second color, for when its first clashes with the opponent's (NBA pages).
    var alternateColor: String? = nil

    /// Stable identity for views: survives score changes.
    var key: String { id ?? name }

    /// ESPN serves a light-on-dark variant of most logos alongside the default one.
    var darkLogo: URL? {
        guard let logo, logo.path.contains("/500/") else { return nil }
        return URL(string: logo.absoluteString.replacingOccurrences(of: "/500/", with: "/500-dark/"))
    }
}

struct Event: Identifiable, Hashable {
    enum Content: Hashable {
        /// Head-to-head match. Away/home order follows each sport's convention.
        case match(top: Competitor, bottom: Competitor)
        /// Field events (climbing rounds) that have a title and a one-line summary.
        case field(title: String, summary: String)
    }

    let id: String
    let content: Content
    let state: EventState
    let start: Date
    /// Short live/final detail from the source ("67'", "Top 9th", "Final/OT").
    let detail: String?
    /// Context such as tournament or round name.
    let caption: String?
    let link: URL?
    /// Where to fetch the detail page from.
    var ref: EventRef? = nil
    /// Competition stage when the source says ("regular-season", "knockout-round-playoffs").
    var stage: String? = nil
    /// The game clock while live, for sports with one.
    var clock: GameClock? = nil
    /// Football, live: the competitor ID of the team with the ball.
    var possession: String? = nil
    /// Live, where the sport has one: the situation in a line ("3rd & 7 at
    /// HOU 25", "1 out · 2–1 · Runner on 2nd"). Changes with every play.
    var liveLine: String? = nil
    /// NBA: the live line is only a rebound, timeout, substitution or the end
    /// of a period. The store keeps the last line worth reading instead.
    var liveLineRoutine = false
    /// Where to watch (US market, up to two networks) and where it's played,
    /// when the scoreboard says. Wide list rows show them in the detail lane.
    var broadcast: String? = nil
    var venue: String? = nil
    /// Live only: what a tile draws beyond the score (ball spot, bases, goals,
    /// the climber on the wall). Nil when the source didn't say.
    var snapshot: LiveSnapshot? = nil

    /// Cup ties and playoffs don't count toward a league table.
    var isKnockout: Bool {
        guard let s = stage?.lowercased() else { return false }
        return s.contains("knockout") || s.contains("playoff") || s.hasPrefix("round-of") || s.contains("final")
    }

    func with(state: EventState? = nil, start: Date? = nil, content: Content? = nil, detail: String?? = nil,
              caption: String?? = nil) -> Event {
        let state = state ?? self.state
        // A snapshot describes a game in progress; it doesn't outlive that.
        return Event(id: id, content: content ?? self.content, state: state, start: start ?? self.start,
                     detail: detail ?? self.detail, caption: caption ?? self.caption, link: link, ref: ref, stage: stage,
                     clock: clock, possession: possession, liveLine: liveLine, liveLineRoutine: liveLineRoutine,
                     broadcast: broadcast, venue: venue,
                     snapshot: state == .live ? snapshot : nil)
    }

    var competitors: [Competitor] {
        if case let .match(top, bottom) = content { return [top, bottom] }
        return []
    }

    /// Score line used by the menu bar, notifications and VoiceOver.
    func scoreLine(abbreviated: Bool) -> String {
        switch content {
        case let .match(top, bottom):
            let a = abbreviated ? top.abbreviation : top.name
            let b = abbreviated ? bottom.abbreviation : bottom.name
            if let sa = top.score, let sb = bottom.score { return "\(a) \(sa)–\(sb) \(b)" }
            return abbreviated ? "\(a) v \(b)" : "\(a) vs \(b)"
        case let .field(title, _):
            return title
        }
    }
}

extension Event {
    /// The sport, from where the event comes from (nil for a bare event).
    var sport: Sport? {
        switch ref {
        case let .espn(_, _, sport)?: sport
        case .counterStrike?: .esports
        case .climbing?: .climbing
        case nil: nil
        }
    }

    /// Whether this side steps back (dims) in a finished match: it lost a
    /// game someone won. Nobody steps back on a draw, before the end, or in a
    /// field event. The one rule for rows, tiles, schedules, the hero and the
    /// docked bar.
    func stepsBack(_ competitor: Competitor) -> Bool {
        guard state == .final, case let .match(top, bottom) = content else { return false }
        return !competitor.isWinner && (top.isWinner || bottom.isWinner)
    }

    /// The status as VoiceOver should say it, never the source's shorthand:
    /// "67th minute", "45th minute plus 2", "3:10 left in the 2nd", "Top of
    /// the 5th", "Full time", "Final, overtime", "Starts Today 7:00 PM".
    /// (Copy Score keeps the shorthand: `statusLine`.)
    var spokenStatus: String {
        switch state {
        case .live:
            return Spoken.status(clock?.text(at: AppClock.now) ?? detail ?? "Live")
        case .final:
            return Spoken.status(detail ?? "Final")
        case .scheduled:
            if detail == "Delayed" { return "Delayed" }
            if start < AppClock.now { return competitors.isEmpty ? "Time to be announced" : "Starting soon" }
            return "Starts \(When.dayAndTime(start))"
        }
    }

    /// "Arsenal 2, Chelsea 1"; "Arsenal versus Chelsea" before kickoff; a
    /// field event's title.
    var spokenScore: String {
        switch content {
        case let .match(top, bottom):
            if let a = top.score, let b = bottom.score { return "\(top.name) \(a), \(bottom.name) \(b)" }
            return "\(top.name) versus \(bottom.name)"
        case let .field(title, _):
            return title
        }
    }

    /// A finished match's result: "Arsenal won", "Draw" (soccer) or "Tie";
    /// nil otherwise (a penalty shootout's winner is named, so a 1–1 isn't
    /// ambiguous).
    var spokenResult: String? {
        guard state == .final, case let .match(top, bottom) = content, top.score != nil, bottom.score != nil else { return nil }
        if top.isWinner { return "\(top.name) won" }
        if bottom.isWinner { return "\(bottom.name) won" }
        guard top.score == bottom.score else { return nil }
        return sport == .soccer ? "Draw" : "Tie"
    }

    /// Score, status and result in one line: "Arsenal 2, Chelsea 1, Full
    /// time, Arsenal won". The base of every row's, tile's and the menu bar
    /// item's VoiceOver label.
    var spokenSummary: String {
        [spokenScore, spokenStatus, spokenResult].compactMap { $0 }.joined(separator: ", ")
    }
}

/// A game period's name: one rule for every surface, so overtimes always
/// read "OT", "2OT", "3OT"… (never "OT" for all of them, or "OT2").
enum Period {
    enum Style {
        /// "Q3", "OT", "2OT" (football, basketball); "7" (an inning).
        case short
        /// A linescore column: "3", "OT", "2OT"; "7".
        case header
        /// In a sentence: "3rd", "OT", "2OT"; "7th".
        case ordinal
    }

    /// Regulation periods, after which each one is an overtime: four quarters
    /// in football and basketball; none elsewhere.
    static func regulation(_ sport: Sport) -> Int? {
        switch sport {
        case .football, .basketball: 4
        default: nil
        }
    }

    static func label(_ n: Int, sport: Sport, style: Style = .short) -> String {
        if let regulation = regulation(sport) {
            if n > regulation { return overtime(n - regulation) }
            switch style {
            case .short: return "Q\(n)"
            case .header: return "\(n)"
            case .ordinal: return Ordinal.string(n)
            }
        }
        return style == .ordinal ? Ordinal.string(n) : "\(n)"
    }

    /// The `extra`th overtime: "OT", "2OT", "3OT"…
    static func overtime(_ extra: Int) -> String { extra <= 1 ? "OT" : "\(extra)OT" }
}

/// "1 game", "3 games", "2 matches": a count and its noun, agreeing. English
/// rules: `+s`, or `+es` after s, x, z, ch and sh; pass `plural` for anything
/// irregular ("1 person", "4 people").
func plural(_ count: Int, _ noun: String, plural: String? = nil) -> String {
    guard count != 1 else { return "\(count) \(noun)" }
    if let plural { return "\(count) \(plural)" }
    let lower = noun.lowercased()
    let es = ["s", "x", "z", "ch", "sh"].contains { lower.hasSuffix($0) }
    return "\(count) \(noun)\(es ? "es" : "s")"
}

/// Source shorthand turned into words VoiceOver reads naturally (pure; tested).
enum Spoken {
    /// A live or final status line: "67'" → "67th minute", "45'+2'" → "45th
    /// minute plus 2", "3:10 - 2nd" → "3:10 left in the 2nd", "Top 5th" →
    /// "Top of the 5th", "FT" → "Full time", "Final/OT" → "Final, overtime".
    /// Anything it doesn't recognize comes back as is (en dashes read "to").
    static func status(_ raw: String) -> String {
        let text = raw.trimmingCharacters(in: .whitespaces)
        if let word = fixed[text.uppercased()] { return word }
        if let minute = minute(text) { return minute }
        if let range = text.range(of: " - ") {
            let clock = text[..<range.lowerBound], period = text[range.upperBound...]
            return "\(clock) left in \(Self.period(String(period)))"
        }
        if let inning = inning(text) { return inning }
        if let final = final(text) { return final }
        return text.replacingOccurrences(of: "–", with: " to ")
    }

    private static let fixed: [String: String] = [
        "FT": "Full time", "FULL TIME": "Full time", "HT": "Half-time", "AET": "After extra time",
        "FT-PENS": "After penalties", "PENS": "After penalties", "AP": "After penalties",
        "FINAL": "Final", "F": "Final", "LIVE": "Live",
    ]

    /// "67'", "45'+2'", "90+4'".
    private static func minute(_ text: String) -> String? {
        guard text.hasSuffix("'") || text.contains("'+") else { return nil }
        let parts = text.split(separator: "+").map { $0.filter(\.isNumber) }
        guard let first = parts.first.flatMap({ Int($0) }), first > 0 else { return nil }
        let base = "\(Ordinal.string(first)) minute"
        guard parts.count > 1, let added = Int(parts[1]), added > 0 else { return base }
        return "\(base) plus \(added)"
    }

    /// "2nd" → "the 2nd"; "OT" → "overtime"; "2OT" → "double overtime".
    private static func period(_ text: String) -> String {
        let upper = text.uppercased()
        if upper == "OT" { return "overtime" }
        if upper.hasSuffix("OT"), let n = Int(upper.dropLast(2)) {
            return ([2: "double", 3: "triple"][n] ?? "\(Ordinal.string(n))") + " overtime"
        }
        return text.first?.isNumber == true ? "the \(text)" : text
    }

    /// "Top 5th", "Bot 9th", "Bottom 9th", "Mid 7th", "End 3rd".
    private static func inning(_ text: String) -> String? {
        let words = text.split(separator: " ", maxSplits: 1).map(String.init)
        guard words.count == 2, words[1].first?.isNumber == true else { return nil }
        let half: String
        switch words[0].lowercased() {
        case "top": half = "Top"
        case "bot", "bottom": half = "Bottom"
        case "mid", "middle": half = "Middle"
        case "end": half = "End"
        default: return nil
        }
        return "\(half) of the \(words[1])"
    }

    /// "Final/OT", "Final/2OT", "F/OT", "Final/10" (extra innings).
    private static func final(_ text: String) -> String? {
        let parts = text.split(separator: "/").map(String.init)
        guard parts.count == 2, ["FINAL", "F"].contains(parts[0].uppercased()) else { return nil }
        let extra = parts[1]
        if let innings = Int(extra) { return "Final, \(innings) innings" }
        return "Final, \(period(extra))"
    }
}

enum EventRef: Hashable {
    case espn(path: String, id: String, sport: Sport)
    case counterStrike(slug: String, tournament: String?)
    /// A climbing category (empty for a whole upcoming competition). `resultURL`
    /// is the round in focus; `round` is the round underway or up next.
    /// `resultURL`: the live or last finished round. `nextURL`: the next round
    /// while it hasn't started (its starting order), else nil.
    case climbing(eventID: Int, category: String, resultURL: String?, round: String?, eventName: String, nextURL: String?)
}

struct LeagueResult: Equatable {
    var events: [Event] = []
    var failed = false
}

// MARK: - Game clock

/// A game clock as the source last read it, able to say what it reads now:
/// counting down (football, basketball) or up in minutes (soccer).
/// Sources don't say whether a clock is running; it's inferred from two
/// readings in a row, and between readings it ticks (or holds) on its own.
struct GameClock: Hashable {
    enum Direction: Hashable { case down, up }
    let seconds: Double
    let sampledAt: Date
    let period: Int
    let direction: Direction
    /// The source's own text when read ("3:10 - 2nd", "37'", "45'+2'").
    let display: String
    /// Moving between the last two readings (soccer: in play).
    var running: Bool

    /// Past this, a reading is stale: the clock holds rather than guess.
    private static let horizon: TimeInterval = 90

    func text(at now: Date) -> String {
        guard running else { return display }
        let elapsed = min(max(now.timeIntervalSince(sampledAt), 0), Self.horizon)
        switch direction {
        case .down:
            // "3:10 - 2nd": tick the clock, keep the period.
            guard let range = display.range(of: " - ") else { return display }
            let left = Int(max(seconds - elapsed, 0).rounded(.up))
            return String(format: "%d:%02d", left / 60, left % 60) + display[range.lowerBound...]
        case .up:
            // Match the source's minute at the reading, then count on from there.
            let parts = display.split(separator: "+").map { Int($0.filter(\.isNumber)) ?? 0 }
            guard let first = parts.first, first > 0 else { return display }
            let minute = Int((seconds + elapsed) / 60) + (parts.reduce(0, +) - Int(seconds / 60))
            let base = [45, 90, 105, 120][min(max(period, 1), 4) - 1]
            return minute > base ? "\(base)'+\(minute - base)'" : "\(minute)'"
        }
    }

    /// The same clock read again: running if the time moved since the last reading.
    func reading(after previous: GameClock?) -> GameClock {
        // The same reading again keeps the earlier one, its timestamp included,
        // so a game that didn't change compares equal and nothing re-renders.
        // (A countdown that read the same twice has stopped; a soccer minute
        // keeps counting on from when it was first read.)
        if let previous, previous.seconds == seconds, previous.period == period,
           previous.display == display, previous.direction == direction {
            var same = previous
            same.running = direction == .down ? false : running
            return same
        }
        guard direction == .down, let previous, previous.period == period else { return self }
        var next = self
        next.running = previous.seconds - seconds >= 0.5
        return next
    }
}
