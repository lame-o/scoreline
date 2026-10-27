import Foundation

// Schedules: what's coming up (and what just happened) in every league, per
// team, and across the climbing and CS2 seasons. Plain values, so the data
// can be cached on disk and tested without views. See specs/schedules.md.

// MARK: - Days

/// A calendar date with no time zone attached: the day a game is listed on.
/// Timed games use the viewer's day; games without a time use the source's
/// (ESPN's Eastern) day, so a midnight placeholder never slides to the day before.
struct DayKey: Hashable, Comparable, Codable, Sendable, CustomStringConvertible {
    let year: Int
    let month: Int
    let day: Int

    static let eastern = TimeZone(identifier: "America/New_York")!
    static let utc = TimeZone(identifier: "UTC")!

    /// Gregorian arithmetic on civil dates (no zone involved).
    private static let civil: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = utc
        return c
    }()

    init(year: Int, month: Int, day: Int) {
        self.year = year
        self.month = month
        self.day = day
    }

    /// "2026-10-25", or the date part of "2026-10-25T07:00Z".
    init?(iso: String?) {
        guard let iso, iso.count >= 10 else { return nil }
        let parts = iso.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        self.init(year: parts[0], month: parts[1], day: parts[2])
    }

    static func of(_ date: Date, in zone: TimeZone = .current) -> DayKey {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = zone
        let d = c.dateComponents([.year, .month, .day], from: date)
        return DayKey(year: d.year ?? 2000, month: d.month ?? 1, day: d.day ?? 1)
    }

    static func today(in zone: TimeZone = .current) -> DayKey { of(.now, in: zone) }

    /// Midnight at the start of this day in `zone`.
    func start(in zone: TimeZone = .current) -> Date {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = zone
        return c.date(from: DateComponents(year: year, month: month, day: day)) ?? .distantPast
    }

    private var noon: Date { Self.civil.date(from: DateComponents(year: year, month: month, day: day, hour: 12)) ?? .distantPast }

    func adding(days n: Int) -> DayKey {
        DayKey.of(Self.civil.date(byAdding: .day, value: n, to: noon) ?? noon, in: Self.utc)
    }

    func days(to other: DayKey) -> Int {
        Self.civil.dateComponents([.day], from: noon, to: other.noon).day ?? 0
    }

    /// 1 = Sunday … 7 = Saturday.
    var weekday: Int { Self.civil.component(.weekday, from: noon) }

    /// The Sunday on or before this day (the strip's weeks run Sunday to Saturday, as Calendar's do).
    var weekStart: DayKey { adding(days: -(weekday - 1)) }

    /// ESPN's `dates=` form: "20261025".
    var compact: String { String(format: "%04d%02d%02d", year, month, day) }

    var description: String { String(format: "%04d-%02d-%02d", year, month, day) }

    static func < (a: DayKey, b: DayKey) -> Bool {
        (a.year, a.month, a.day) < (b.year, b.month, b.day)
    }

    // MARK: Words

    /// A date to format with the viewer's locale (noon, so no zone can move the day).
    var displayDate: Date {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = .current
        return c.date(from: DateComponents(year: year, month: month, day: day, hour: 12)) ?? noon
    }

    /// "Today", "Tomorrow", "Yesterday", or nil.
    func relative(to today: DayKey) -> String? {
        switch today.days(to: self) {
        case 0: "Today"
        case 1: "Tomorrow"
        case -1: "Yesterday"
        default: nil
        }
    }

    /// "Sunday, Oct 25"
    var longLabel: String { displayDate.formatted(.dateTime.weekday(.wide).month(.abbreviated).day()) }
    /// "Sun, Oct 25"
    var mediumLabel: String { displayDate.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day()) }
    /// "Oct 25"
    var shortLabel: String { displayDate.formatted(.dateTime.month(.abbreviated).day()) }

    /// "Apr 9–11", "Apr 30–May 2", "Dec 30–Jan 3, 2028" (across years).
    static func range(_ a: DayKey, _ b: DayKey) -> String {
        if a == b { return a.shortLabel }
        if a.year == b.year && a.month == b.month {
            return "\(a.shortLabel)–\(b.day)"
        }
        if a.year == b.year { return "\(a.shortLabel)–\(b.shortLabel)" }
        return "\(a.shortLabel)–\(b.shortLabel), \(b.year)"
    }
}

// MARK: - Times

/// When something starts, as honestly as the source knows.
enum StartTime: Hashable, Codable, Sendable {
    case exact(Date)
    /// Shown dimmed with "Provisional": EPL kickoffs before the TV picks,
    /// bo3.gg's placeholder order of play.
    case provisional(Date, Provisional)
    /// Listed for its day, time unknown (ESPN `timeValid: false`, climbing rounds).
    case tba
    /// The day may move too (European soccer `timeValid: false`).
    case tbc

    enum Provisional: String, Codable, Sendable { case tvPicks, orderOfPlay, programme }

    var date: Date? {
        switch self {
        case let .exact(d), let .provisional(d, _): d
        case .tba, .tbc: nil
        }
    }

    var isKnown: Bool { date != nil }
}

enum ScheduleStatus: String, Codable, Sendable {
    case scheduled, live, final, postponed, canceled
}

// MARK: - Items

struct ScheduleTeam: Hashable, Codable, Sendable {
    /// The `Competitor.id` format (ESPNTeamID, "cs-793"), so following and stars just work.
    let id: String?
    let name: String
    let abbreviation: String
    let logo: URL?
    var record: String? = nil
    var rank: Int? = nil
    var score: String? = nil
    var winner = false
}

enum ScheduleRef: Hashable, Codable, Sendable {
    case espn(path: String, id: String)
    case counterStrike(slug: String, tournament: String?)
    case climbing(eventID: Int)
}

/// One game, match or round on a schedule.
struct ScheduleItem: Identifiable, Hashable, Codable, Sendable {
    /// The same ID the scores list uses ("espn-401873033", "cs-412345"), so
    /// live state can be read from `ScoreStore` and the match page opens as usual.
    let id: String
    let sportRaw: String
    /// `League.id` for catalog leagues, else the competition's slug ("eng.league_cup").
    let league: String
    /// "Carabao Cup · Fourth Round": shown when the scope isn't that league.
    var competition: String? = nil
    let day: DayKey
    let start: StartTime
    var status: ScheduleStatus
    /// The source's short status for live and final games ("67'", "Final/OT").
    var statusDetail: String? = nil
    /// House order: soccer lists the home side first, everyone else the away side.
    var top: ScheduleTeam? = nil
    var bottom: ScheduleTeam? = nil
    /// Field events (climbing rounds, a collapsed tournament day).
    var title: String? = nil
    var subtitle: String? = nil
    /// "Anfield · Liverpool"
    var venue: String? = nil
    /// Display names, national networks first.
    var networks: [String] = []
    /// "Best of 3"
    var format: String? = nil
    /// Rewritten captions ("World Series · Game 5 · If necessary").
    var notes: [String] = []
    var ifNecessary = false
    var week: Int? = nil
    var link: URL? = nil
    let ref: ScheduleRef
    /// What a finished (or postponed, canceled) game adds: the label, scorers,
    /// decisions, performers, context. Nil until it's played.
    var result: ResultDetail? = nil
    /// A collapsed tournament day's matches (CS2 in the All scope).
    var children: [ScheduleItem]? = nil

    var sport: Sport { Sport(rawValue: sportRaw) ?? .soccer }

    var isField: Bool { top == nil && bottom == nil }

    var teams: [ScheduleTeam] { [top, bottom].compactMap { $0 } }

    /// Timed games by time; games without one sort after their day's timed games.
    var sortDate: Date { start.date ?? day.start(in: .current).addingTimeInterval(86_399) }

    /// The app's `Event`, for the match page, the context menu and live lookup.
    func event() -> Event {
        let state: EventState = switch status {
        case .live: .live
        case .final, .postponed, .canceled: .final
        case .scheduled: .scheduled
        }
        let played = status == .live || status == .final
        func competitor(_ t: ScheduleTeam) -> Competitor {
            Competitor(id: t.id, name: t.name, abbreviation: t.abbreviation, score: played ? t.score : nil, logo: t.logo,
                       isWinner: status == .final && t.winner, rank: t.rank, record: t.record)
        }
        let content: Event.Content = if let top, let bottom {
            .match(top: competitor(top), bottom: competitor(bottom))
        } else {
            .field(title: title ?? "", summary: subtitle ?? "")
        }
        let detail: String? = switch status {
        case .postponed: "Postponed"
        case .canceled: "Canceled"
        default: statusDetail
        }
        let eventRef: EventRef? = switch ref {
        case let .espn(path, id): .espn(path: path, id: id, sport: sport)
        case let .counterStrike(slug, tournament): .counterStrike(slug: slug, tournament: tournament)
        case let .climbing(eventID): .climbing(eventID: eventID, category: "", resultURL: nil, round: nil,
                                               eventName: title ?? "", nextURL: nil)
        }
        let caption = ([competition] + notes.map(Optional.some)).compactMap { $0 }.joined(separator: " · ")
        return Event(id: id, content: content, state: state, start: start.date ?? day.start(in: .current),
                     detail: detail, caption: caption.isEmpty ? nil : caption, link: link, ref: eventRef,
                     broadcast: networks.isEmpty ? nil : networks.prefix(2).joined(separator: " · "), venue: venue)
    }
}

// MARK: - Seasons (climbing competitions, CS2 tournaments)

/// A round of a climbing competition, with a time when a stream (or the
/// programme) gives one.
struct ClimbingRound: Hashable, Codable, Sendable, Identifiable {
    let name: String
    /// "Lead", "Boulder", "Speed"
    let discipline: String
    /// ["Men", "Women"]
    var categories: [String]
    var start: StartTime = .tba
    var stream: URL? = nil
    /// pending / active / finished
    var status: String
    var id: String { "\(discipline)|\(name)" }

    /// "Lead semi-final"
    var label: String {
        "\(discipline) \(name.lowercased())"
    }
}

struct SeasonEvent: Identifiable, Hashable, Codable, Sendable {
    enum Kind: Hashable, Codable, Sendable { case climbing(Int), tournament(slug: String) }
    enum Status: String, Codable, Sendable { case upcoming, live, finished, canceled }
    struct Category: Hashable, Codable, Sendable {
        let name: String            // "Lead Women"
        var podium: [String] = []   // "SLO Garnbret"
        /// IFSC's `dcat_id`: the category's full results.
        var dcatID: Int? = nil
        var rounds: [RoundLink] = []
        var podiumAthletes: [PodiumAthlete] = []
    }

    let id: String
    let kind: Kind
    /// "World Climbing Series Tokyo 2027"
    let name: String
    /// "Tokyo"
    let shortName: String
    /// "Tokyo, Japan"
    var place: String?
    /// ISO 3166 alpha-2, for the flag.
    var countryCode: String?
    /// Venue-local dates (climbing) or UTC dates (CS2): never converted.
    let startDay: DayKey
    let endDay: DayKey
    var startsAt: Date?
    var endsAt: Date?
    /// IANA zone of the venue (climbing).
    var timeZone: String?
    /// Timeline lanes: "boulder", "lead", "speed" / "s", "a", "b".
    var lanes: [String]
    /// "World Championships", "Olympic Games", "Major"
    var badge: String?
    var prize: Int?
    /// "LAN", "Online"
    var format: String?
    var logo: URL?
    var status: Status
    var categories: [Category] = []
    var rounds: [ClimbingRound] = []
    var teams: [ScheduleTeam] = []
    /// IOC code → confirmed athletes (highlighted countries only).
    var registered: [String: Int] = [:]
    var link: URL?
    var infoSheet: URL?
    /// CS2: stages drawn so far (a bracket page has something to show).
    var stages = 0
    /// True once the event's own detail has been loaded.
    var detailed = false

    var flag: String? { Flag.emoji(iso2: countryCode) }

    /// Inclusive day count ("Day 1 of 3").
    var dayCount: Int { startDay.days(to: endDay) + 1 }

    func contains(_ day: DayKey) -> Bool { startDay <= day && day <= endDay }
}

// MARK: - Calendars

/// A league's season, from ESPN's scoreboard: the dates that have games
/// (soccer, NBA, MLB) or the weeks (NFL, college).
struct ScheduleCalendar: Codable, Hashable, Sendable {
    struct Week: Codable, Hashable, Sendable, Identifiable {
        let label: String           // "Week 8", "Wild Card", "Bowls"
        let detail: String          // "Oct 28-Nov 3"
        let number: Int
        let seasonType: Int         // 1 preseason, 2 regular, 3 postseason
        let start: Date
        let end: Date
        var id: String { "\(seasonType)-\(number)" }

        func contains(_ date: Date) -> Bool { start <= date && date < end }
    }

    /// Game days, for leagues whose calendar lists them (most).
    var days: [DayKey] = []
    /// MLB lists the opposite: days off within the season (`offSeason…`).
    var offDays: [DayKey]? = nil
    var seasonStart: DayKey? = nil
    var seasonEnd: DayKey? = nil
    var weeks: [Week] = []

    /// Whether the league plays on `day`, or nil when the calendar can't say.
    func plays(on day: DayKey) -> Bool? {
        if let offDays {
            guard let seasonStart, let seasonEnd else { return nil }
            return seasonStart <= day && day <= seasonEnd && !offDays.contains(day)
        }
        return days.isEmpty ? nil : days.contains(day)
    }

    /// Up to `limit` game days from `day` on, or nil when the calendar can't say.
    func gameDays(from day: DayKey, limit: Int) -> [DayKey]? {
        if let offDays {
            guard let seasonStart, let seasonEnd else { return nil }
            let off = Set(offDays)
            var out: [DayKey] = []
            var d = max(day, seasonStart)
            while d <= seasonEnd && out.count < limit {
                if !off.contains(d) { out.append(d) }
                d = d.adding(days: 1)
            }
            return out
        }
        guard !days.isEmpty else { return nil }
        return Array(days.filter { $0 >= day }.prefix(limit))
    }

    /// The week containing `date`, else the next one, else the last.
    func week(at date: Date) -> Week? {
        weeks.first { $0.contains(date) } ?? weeks.first { $0.start > date } ?? weeks.last
    }

    func week(after week: Week) -> Week? {
        guard let i = weeks.firstIndex(of: week), i + 1 < weeks.count else { return nil }
        return weeks[i + 1]
    }

    func week(before week: Week) -> Week? {
        guard let i = weeks.firstIndex(of: week), i > 0 else { return nil }
        return weeks[i - 1]
    }

    /// The next game day on or after `day`.
    func nextDay(onOrAfter day: DayKey) -> DayKey? { gameDays(from: day, limit: 1)?.first }
}

// MARK: - Scopes

/// A team a schedule can be opened for.
struct ScheduleTeamRef: Hashable, Codable, Sendable {
    let id: String
    let name: String
    let logo: URL?
    /// League ID when known (otherwise derived from the ID's prefix).
    var league: String? = nil
}

/// What a schedule page shows.
enum ScheduleScope: Hashable, Codable, Sendable {
    /// Every enabled league, filtered as the scores list is.
    case all
    case yourTeams
    case league(String)
    case team(ScheduleTeamRef)
    case climbing
    case tournaments

    static func `for`(league: League) -> ScheduleScope {
        switch league.source {
        case .ifsc: .climbing
        case .counterStrike: .tournaments
        case .espn: .league(league.id)
        }
    }

    var memoryKey: String {
        switch self {
        case .all: "all"
        case .yourTeams: "yourTeams"
        case let .league(id): "league:\(id)"
        case let .team(team): "team:\(team.id)"
        case .climbing: "climbing"
        case .tournaments: "tournaments"
        }
    }

    var title: String {
        switch self {
        case .all: "Schedule"
        case .yourTeams: "Your Teams"
        case let .league(id): League.with(id: id)?.name ?? "Schedule"
        case let .team(team): team.name
        case .climbing: "Climbing Season"
        case .tournaments: "Tournaments"
        }
    }

    var league: League? {
        if case let .league(id) = self { return League.with(id: id) }
        return nil
    }

    /// How the page navigates in time: a week of every league (strip), a
    /// football week (picker), a daily league's coming game days (list, more
    /// on request), a team's season by month.
    enum Navigator { case weekStrip, weekPicker, list, monthBar, none }

    var navigator: Navigator {
        switch self {
        case .all: .weekStrip
        case let .league(id):
            if case .espn(_, true)? = League.with(id: id)?.source { .weekPicker } else { .list }
        case .yourTeams, .team: .monthBar
        case .climbing, .tournaments: .none
        }
    }

    /// Days fold to a one-line summary: pages with many games a day. A team's
    /// days hold one game each, so they never fold.
    var foldsDays: Bool {
        switch self {
        case .all, .league: true
        default: false
        }
    }
}

// MARK: - Agenda

struct AgendaGroup: Identifiable, Hashable {
    let league: String
    let title: String
    let symbol: String
    /// Timed items by start, then those without a time.
    var items: [ScheduleItem]
    var id: String { league }
}

struct AgendaDay: Identifiable, Hashable {
    let day: DayKey
    var groups: [AgendaGroup]
    /// NFL/college: teams without a game this week, on the week's last day.
    var byes: [String] = []
    var id: DayKey { day }

    var items: [ScheduleItem] { groups.flatMap(\.items) }
}

enum Agenda {
    /// Day sections. With `grouped`, each day is split into leagues in
    /// `leagueOrder` (the user's order; unknown leagues last); otherwise one group.
    static func build(_ items: [ScheduleItem], leagueOrder: [String], grouped: Bool) -> [AgendaDay] {
        var seen = Set<String>()
        let unique = items.filter { seen.insert($0.id).inserted }
        let byDay = Dictionary(grouping: unique, by: \.day)
        let rank = Dictionary(leagueOrder.enumerated().map { ($1, $0) }, uniquingKeysWith: { a, _ in a })
        return byDay.keys.sorted().map { day in
            let dayItems = byDay[day] ?? []
            let groups: [AgendaGroup]
            if grouped {
                let byLeague = Dictionary(grouping: dayItems) { groupKey($0) }
                groups = byLeague.keys.sorted { a, b in
                    let ra = rank[a] ?? .max, rb = rank[b] ?? .max
                    return ra != rb ? ra < rb : a < b
                }.map { key in
                    let league = League.with(id: key)
                    return AgendaGroup(league: key, title: league?.name ?? key, symbol: league?.sport.symbol ?? "calendar",
                                       items: sorted(byLeague[key] ?? []))
                }
            } else {
                groups = [AgendaGroup(league: "all", title: "", symbol: "", items: sorted(dayItems))]
            }
            return AgendaDay(day: day, groups: groups)
        }
    }

    /// Cross-competition fixtures (Carabao Cup, a club's cup tie) sit with
    /// their sport's league in the All scope rather than as a group of one.
    private static func groupKey(_ item: ScheduleItem) -> String {
        League.with(id: item.league) != nil ? item.league : (League.catalog.first { $0.sport == item.sport }?.id ?? item.league)
    }

    static func sorted(_ items: [ScheduleItem]) -> [ScheduleItem] {
        items.sorted { a, b in
            if a.start.isKnown != b.start.isKnown { return a.start.isKnown }
            if a.sortDate != b.sortDate { return a.sortDate < b.sortDate }
            return a.id < b.id
        }
    }

    /// The days a page opens unfolded: today and the next game day, and one
    /// more when those two hold fewer than `minimum` games (a Thursday night
    /// game shouldn't leave Sunday folded). Everything after starts folded.
    static func defaultOpen(_ upcoming: [AgendaDay], today: DayKey, minimum: Int = 6) -> Set<DayKey> {
        var open = Set<DayKey>()
        var games = 0
        for day in upcoming where day.day >= today {
            if open.count >= 2 && games >= minimum || open.count >= 3 { break }
            open.insert(day.day)
            games += day.items.count
        }
        return open
    }

    /// A folded day in one line: "14 games · NFL, NBA, EPL" (leagues in the
    /// page's order; a league page names no league).
    static func summary(_ day: AgendaDay, namesLeagues: Bool) -> String {
        ([count(day)] + (namesLeagues ? [leagues(day)] : [])).filter { !$0.isEmpty }.joined(separator: " · ")
    }

    /// "14 games", "3 games · 1 event" (climbing rounds and the like are events).
    static func count(_ day: AgendaDay) -> String {
        let items = day.items
        let matches = items.filter { !$0.isField }.count
        let events = items.count - matches
        var parts: [String] = []
        if matches > 0 { parts.append("\(matches) game\(matches == 1 ? "" : "s")") }
        if events > 0 { parts.append("\(events) event\(events == 1 ? "" : "s")") }
        return parts.joined(separator: " · ")
    }

    /// "EPL, NBA, Climbing": the day's leagues, short names, in the page's order.
    static func leagues(_ day: AgendaDay) -> String {
        day.groups.map { League.with(id: $0.league)?.shortName ?? $0.title }.joined(separator: ", ")
    }

    /// Days before `today` (results) and from `today` on.
    static func split(_ days: [AgendaDay], today: DayKey) -> (earlier: [AgendaDay], upcoming: [AgendaDay]) {
        (days.filter { $0.day < today }, days.filter { $0.day >= today })
    }

    /// Form over the last results of `teamID`, oldest first: "W", "D", "L".
    static func form(_ items: [ScheduleItem], teamID: String, last n: Int = 5) -> [String] {
        let played = items.filter { $0.status == .final && $0.teams.contains { $0.id == teamID } }
            .sorted { $0.sortDate < $1.sortDate }.suffix(n)
        return played.map { item in
            guard let mine = item.teams.first(where: { $0.id == teamID }),
                  let other = item.teams.first(where: { $0.id != teamID }) else { return "–" }
            if mine.winner { return "W" }
            if other.winner { return "L" }
            return "D"
        }
    }
}
