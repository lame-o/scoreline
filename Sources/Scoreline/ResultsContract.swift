import SwiftUI

// The types every part of Results shares: the mode a schedule page faces,
// what a finished game adds to its row, rounds, a team's season, CS2
// placings, and the pages deeper than a row.

/// Which way a schedule page faces in time.
enum ScheduleMode: String, Hashable, Codable, Sendable, CaseIterable {
    case upcoming, results

    var title: String { self == .upcoming ? "Upcoming" : "Results" }
}

/// The segmented control every schedule page carries under its title
/// (⌘1 / ⌘2, as Calendar switches its views).
struct ScheduleModeSwitch: View {
    let mode: ScheduleMode
    let onChange: (ScheduleMode) -> Void

    var body: some View {
        Picker("Show", selection: Binding(get: { mode }, set: { if $0 != mode { onChange($0) } })) {
            ForEach(ScheduleMode.allCases, id: \.self) { Text($0.title).tag($0) }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .controlSize(.small)
        .frame(width: 200)
        .frame(maxWidth: .infinity)
        .padding(.top, 2)
        .padding(.bottom, 8)
        .background {
            ShortcutButton(key: "1") { onChange(.upcoming) }
            ShortcutButton(key: "2") { onChange(.results) }
        }
        .help("Upcoming (⌘1) · Results (⌘2)")
    }
}

/// What a finished game adds to its row. Built by the parser; every string a
/// view shows is computed here once, off the main thread.
struct ResultDetail: Hashable, Codable, Sendable {
    enum Kind: String, Codable, Sendable { case regulation, overtime, extraTime, penalties, forfeit, abandoned, suspended }
    /// House order: top, then bottom.
    struct Pair: Hashable, Codable, Sendable {
        let top: Int
        let bottom: Int
    }
    struct Scorer: Hashable, Codable, Sendable {
        enum Mark: String, Codable, Sendable { case goal, penalty, ownGoal, red }
        /// The side it counts for (an own goal: the side it benefits).
        let top: Bool
        /// "Jackson"
        let name: String
        /// "6'", "90'+3'"
        let minute: String
        let mark: Mark
        let athleteID: String?
    }
    struct Performer: Hashable, Codable, Sendable {
        let top: Bool
        /// "Doncic"
        let name: String
        /// "52 pts, 8 reb, 10 ast"
        let line: String
        /// "points", "rating", "passingYards"
        let category: String
        let athleteID: String?
    }
    struct Decisions: Hashable, Codable, Sendable {
        struct Pitcher: Hashable, Codable, Sendable {
            let name: String
            /// "1–0" for a decision, "3" for a save.
            let record: String
            let athleteID: String?
        }
        var win: Pitcher?
        var loss: Pitcher?
        var save: Pitcher?
    }

    var kind: Kind = .regulation
    /// "FT", "AET", "Pens", "Final/OT", "Forfeit"
    var label: String
    var periods: Int? = nil
    var shootout: Pair? = nil
    var aggregate: Pair? = nil
    var leg: Int? = nil
    /// Who goes through, when the match itself doesn't say (two legs, shootouts).
    var advances: String? = nil
    /// `season.slug`: "round-of-16", "league-phase"
    var stage: String? = nil
    /// Soccer: the larger of the two sides' W+D+L after this game (its matchweek).
    var gamesPlayed: Int? = nil
    var scorers: [Scorer] = []
    var performers: [Performer] = []
    var decisions: Decisions? = nil
    /// "MIL leads 2–0"
    var series: String? = nil
    /// The recap's headline.
    var headline: String? = nil
    var attendance: Int? = nil
    // Display strings, made once by `ResultLine` at parse time.
    /// The compact details line.
    var details: String? = nil
    /// The lane's first line from the large width class.
    var detailsWide: String? = nil
    /// The knockout context line.
    var context: String? = nil
    /// Appended to the row's VoiceOver label.
    var spoken: String? = nil
}

/// A round of results: a matchweek, a football week, a cup stage block, a day.
struct ResultRound: Identifiable, Hashable, Codable, Sendable {
    enum Kind: String, Codable, Sendable { case day, week, matchweek, stage, dates }

    /// "d:2026-10-25", "w:2-7", "b:2026-10-23"
    let id: String
    var kind: Kind
    /// "Matchweek 8", "Week 7", "Sunday, Oct 25", "Round of 16 · 2nd legs"
    var title: String
    /// "Oct 23–25"
    var detail: String
    let first: DayKey
    let last: DayKey
    /// "2026–27", "League Phase", "Regular Season"
    var section: String? = nil
    /// Football: the board to fetch.
    var week: Int? = nil
    var seasonType: Int? = nil
    /// Known once the round has loaded.
    var played: Int? = nil
    var total: Int? = nil
}

/// One letter of a team's form strip.
struct FormMark: Hashable, Codable, Sendable {
    /// "W", "D", "L", "T"
    let letter: String
    let itemID: String
    /// "Sat, Oct 24 · W 2–0 vs Everton · Premier League"
    let readout: String
    /// "October 24, won 2 to 0 against Everton"
    let spoken: String
}

struct TeamSeason: Hashable, Codable, Sendable {
    var team: ScheduleTeamRef
    /// "2026–27"
    var season: String
    var isCurrent: Bool
    /// ESPN's (current season) or computed.
    var record: String?
    /// The current season only.
    var standing: String?
    var played = 0
    var won = 0
    var drawn = 0
    var lost = 0
    var scoredFor: Int? = nil
    var scoredAgainst: Int? = nil
    /// The last 10, oldest first.
    var form: [FormMark] = []
    /// Newest first.
    var results: [ScheduleItem] = []
}

/// A CS2 placing.
struct Placement: Hashable, Codable, Sendable {
    /// "1st", "5th–8th"
    let place: String
    /// Sort key: the first number.
    let order: Int
    let team: ScheduleTeam
    let money: Int?
    let clubMoney: Int?
}

/// Pages deeper than a row: a climbing category's full results, a tournament's.
enum EventResultsRef: Hashable, Codable, Sendable {
    /// `eventName` is the short name ("Santiago").
    case climbing(eventID: Int, dcatID: Int, category: String, eventName: String)
    case tournament(slug: String, name: String)

    /// "results:climbing:1489:5", "results:tournament:<slug>"
    var memoryKey: String {
        switch self {
        case let .climbing(eventID, dcatID, _, _): "results:climbing:\(eventID):\(dcatID)"
        case let .tournament(slug, _): "results:tournament:\(slug)"
        }
    }

    /// "Santiago", "ESL Pro League Season 24"
    var backTitle: String {
        switch self {
        case let .climbing(_, _, _, eventName): eventName
        case let .tournament(_, name): name
        }
    }
}

// MARK: - Climbing event links (filled by `ScheduleProvider.IFSC.parseEvent`)

extension SeasonEvent {
    /// A category's round, as the event detail lists it.
    struct RoundLink: Hashable, Codable, Sendable {
        /// `category_round_id`
        let id: Int
        /// "Qualification", "Semi-final", "Final"
        let name: String
        /// "finished", "active", "not_started"
        let status: String
        /// `result_url`: what `EventRef.climbing(resultURL:)` loads.
        let resultPath: String?
    }

    /// A podium athlete, with the ID their page needs.
    struct PodiumAthlete: Hashable, Codable, Sendable {
        let athleteID: Int
        let rank: Int
        let first: String
        let last: String
        /// IOC code ("SLO").
        let country: String?
    }
}
