import SwiftUI

// The Player page's sections: the game log (strip + table), stat tables, bio
// facts, the status note, career by season, awards, and the climbing and
// CS2 specifics.

// MARK: - Columns

struct StatColumn: Equatable {
    let key: String
    let label: String
    var width: CGFloat = 30
    var from: WidthClass = .compact
}

enum PlayerColumns {
    /// The game-log table's columns, by sport and position; a column never moves when others join.
    static func gameLog(sport: Sport, position: String?, pitching: Bool) -> [StatColumn] {
        let pos = (position ?? "").uppercased()
        switch sport {
        case .basketball:
            return [.init(key: "points", label: "PTS"), .init(key: "totalRebounds", label: "REB"), .init(key: "assists", label: "AST"),
                    .init(key: "minutes", label: "MIN", from: .medium),
                    .init(key: "fieldGoalsMade-fieldGoalsAttempted", label: "FG", width: 40, from: .large),
                    .init(key: "threePointFieldGoalsMade-threePointFieldGoalsAttempted", label: "3PT", width: 36, from: .large),
                    .init(key: "steals", label: "STL", width: 28, from: .xlarge), .init(key: "blocks", label: "BLK", width: 28, from: .xlarge)]
        case .football:
            switch pos {
            case "QB":
                return [.init(key: "passingYards", label: "YDS", width: 36), .init(key: "passingTouchdowns", label: "TD", width: 24),
                        .init(key: "interceptions", label: "INT", width: 26), .init(key: "cmpatt", label: "C/ATT", width: 44, from: .medium),
                        .init(key: "QBRating", label: "RTG", width: 36, from: .large), .init(key: "rushingYards", label: "RUSH", width: 36, from: .xlarge)]
            case "RB", "FB":
                return [.init(key: "rushingYards", label: "YDS", width: 36), .init(key: "rushingTouchdowns", label: "TD", width: 24),
                        .init(key: "rushingAttempts", label: "CAR", width: 30), .init(key: "yardsPerRushAttempt", label: "AVG", width: 32, from: .medium)]
            case "WR", "TE":
                return [.init(key: "receptions", label: "REC", width: 30), .init(key: "receivingYards", label: "YDS", width: 36),
                        .init(key: "receivingTouchdowns", label: "TD", width: 24), .init(key: "receivingTargets", label: "TGT", width: 30, from: .medium)]
            case "PK", "K":
                return [.init(key: "fieldGoalsMade-fieldGoalAttempts", label: "FG", width: 34), .init(key: "longFieldGoalMade", label: "LNG", width: 30),
                        .init(key: "totalKickingPoints", label: "PTS", width: 30)]
            default:
                return [.init(key: "totalTackles", label: "TOT"), .init(key: "sacks", label: "SACK", width: 34),
                        .init(key: "interceptions", label: "INT", width: 26), .init(key: "passesDefended", label: "PD", width: 26, from: .medium)]
            }
        case .baseball where pitching:
            return [.init(key: "innings", label: "IP"), .init(key: "earnedRuns", label: "ER", width: 26), .init(key: "strikeouts", label: "K", width: 26),
                    .init(key: "hits", label: "H", width: 26, from: .medium), .init(key: "walks", label: "BB", width: 26, from: .large),
                    .init(key: "wins-losses", label: "DEC", width: 30, from: .large)]
        case .baseball:
            return [.init(key: "hits", label: "H", width: 24), .init(key: "homeRuns", label: "HR", width: 26), .init(key: "RBIs", label: "RBI"),
                    .init(key: "atBats", label: "AB", width: 26, from: .medium), .init(key: "walks", label: "BB", width: 26, from: .large),
                    .init(key: "strikeouts", label: "SO", width: 26, from: .large)]
        case .soccer where pos == "G":
            return [.init(key: "saves", label: "SV", width: 26), .init(key: "goalsConceded", label: "GA", width: 26),
                    .init(key: "cleanSheet", label: "CS", width: 26)]
        case .soccer:
            return [.init(key: "totalGoals", label: "G", width: 22), .init(key: "goalAssists", label: "A", width: 22),
                    .init(key: "totalShots", label: "SH", width: 26), .init(key: "shotsOnTarget", label: "SOT", width: 30, from: .medium),
                    .init(key: "yellowCards", label: "YC", width: 26, from: .large)]
        case .esports:
            return [.init(key: "rating", label: "RTG", width: 34), .init(key: "kd", label: "K–D", width: 42), .init(key: "adr", label: "ADR", width: 30),
                    .init(key: "hs", label: "HS%", width: 34, from: .medium), .init(key: "maps", label: "MAPS", width: 110, from: .xlarge)]
        default:
            return []
        }
    }

    /// The overview's season and career lines.
    static func season(sport: Sport, position: String?) -> [(String, WidthClass)] {
        switch sport {
        case .basketball:
            return [("gamesPlayed", .compact), ("avgPoints", .compact), ("avgRebounds", .compact), ("avgAssists", .compact),
                    ("fieldGoalPct", .medium), ("threePointPct", .large), ("avgMinutes", .large)]
        case .football:
            switch (position ?? "").uppercased() {
            case "QB": return [("passingYards", .compact), ("passingTouchdowns", .compact), ("interceptions", .compact),
                               ("completionPct", .medium), ("QBRating", .large)]
            case "RB", "FB": return [("rushingAttempts", .compact), ("rushingYards", .compact), ("rushingTouchdowns", .compact),
                                     ("yardsPerRushAttempt", .medium)]
            case "WR", "TE": return [("receptions", .compact), ("receivingYards", .compact), ("receivingTouchdowns", .compact),
                                     ("yardsPerReception", .medium)]
            default: return [("totalTackles", .compact), ("sacks", .compact), ("interceptions", .compact), ("passesDefended", .medium)]
            }
        case .baseball:
            return [("gamesPlayed", .compact), ("hits", .compact), ("homeRuns", .compact), ("RBIs", .compact), ("atBats", .medium),
                    ("walks", .large), ("strikeouts", .large), ("ERA", .compact), ("wins", .compact), ("innings", .medium)]
        default:
            return []
        }
    }

    /// Career by season (`/stats` averages).
    static func career(sport: Sport, position: String?) -> [(String, WidthClass)] {
        switch sport {
        case .basketball:
            return [("gamesPlayed", .compact), ("avgPoints", .compact), ("avgRebounds", .compact), ("avgAssists", .compact),
                    ("fieldGoalPct", .medium), ("threePointPct", .large)]
        case .baseball:
            return [("gamesPlayed", .compact), ("homeRuns", .compact), ("RBIs", .compact), ("avg", .compact), ("OPS", .medium),
                    ("ERA", .compact), ("wins", .compact), ("strikeouts", .medium)]
        default:
            return season(sport: sport, position: position)
        }
    }
}

// MARK: - Game log

struct GameLogSection: View {
    let ref: Profile.PlayerRef
    let profile: Profile.PlayerProfile
    let team: Profile.TeamRef?
    let tint: Color
    let session: ProfileStore.PageSession
    let store: ProfileStore
    @Environment(\.widthClass) private var widthClass
    @Environment(ProfileNavigator.self) private var navigator: ProfileNavigator?

    /// MLB: the player's role first (pitching for a pitcher); the other role
    /// only for a two-way player, by choice.
    private var rolePitches: Bool { profile.gameLog?.category == "pitching" }
    private var pitching: Bool { profile.otherLog == nil ? rolePitches : session.pitching ?? rolePitches }
    private var log: Profile.GameLog? { pitching == rolePitches ? profile.gameLog : profile.otherLog }

    var body: some View {
        DetailSection(title: ref.sport == .esports ? "Recent Matches" : "Game Log", caption: caption) {
            if profile.otherLog != nil {
                Picker("Category", selection: Binding(get: { pitching }, set: { value in
                    store.session[ref.memoryKey, default: .init()].pitching = value
                })) {
                    Text("Batting").tag(false)
                    Text("Pitching").tag(true)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .controlSize(.small)
                .fixedSize()
            }
            if let log {
                if log.matchStrip {
                    MatchStrip(log: log, onOpen: opener)
                } else if Self.drawsStrip(log) {
                    GameLogStrip(log: log, tint: tint, onOpen: opener)
                }
                table(log)
            }
        }
        .task(id: profile.gameLog?.category) {
            if ref.sport == .baseball { await store.loadOtherLog(ref) }
        }
    }

    /// A season's shape needs a few games: before five, the table (which lists them all) says it better
    /// than three bars at the left of an empty chart.
    static func drawsStrip(_ log: Profile.GameLog) -> Bool {
        log.stripKey != nil && log.entries.count >= 5
    }

    private var caption: String? {
        guard let log else { return nil }
        if log.matchStrip { return "League matches, oldest to newest. Click one to open it." }
        guard Self.drawsStrip(log) else { return nil }
        if ref.sport == .esports { return "bo3 rating per match, last \(log.entries.count). Click one to open it." }
        if log.stripKey == "avgGameScore" { return "Game Score by start (50 is an average start). Click one to open it." }
        return "\(log.stripLabel) by game this season. Click a game to open it."
    }

    @ViewBuilder
    private func table(_ log: Profile.GameLog) -> some View {
        let columns = PlayerColumns.gameLog(sport: ref.sport, position: profile.bio?.positionAbbreviation ?? ref.position,
                                            pitching: log.category == "pitching" || log.stripKey == "avgGameScore")
            .filter { column in column.from <= widthClass && (log.columns.contains { $0.key == column.key } || column.key == "cmpatt") }
        let all = session.allGames
        let rows = Array(log.entries.reversed().prefix(all ? log.entries.count : 5))
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Text("GAME").frame(maxWidth: .infinity, alignment: .leading)
                ForEach(columns, id: \.key) { c in
                    Text(c.label).frame(width: c.width, alignment: .trailing).widthDetail()
                }
            }
            .font(.system(size: 9.5, weight: .semibold))
            .foregroundStyle(.secondary)
            .padding(.top, 10)
            .padding(.bottom, 2)
            // Each row speaks its values with their names.
            .accessibilityHidden(true)
            ForEach(rows) { entry in
                row(entry, columns: columns)
            }
            if !all, log.entries.count > 5 {
                ProfileMoreButton(title: "All Games (\(log.entries.count))") {
                    store.session[ref.memoryKey, default: .init()].allGames = true
                }
            }
        }
    }

    private func row(_ e: Profile.GameLog.Entry, columns: [StatColumn]) -> some View {
        RowLink(help: "Open this game", hint: LinkHint.match, action: { open(e) }) { hovering in
            HStack(spacing: 6) {
                Text(ProfileFormat.short(e.date))
                    .font(.system(size: 10.5).monospacedDigit())
                    .foregroundStyle(.secondary)
                    .frame(width: 42, alignment: .leading)
                if let opponent = e.opponent {
                    TeamCrest(team: opponent, size: 14)
                    Text("\(e.home ? "vs" : "at") \(opponent.abbreviation ?? opponent.name)")
                        .font(.system(size: 11.5))
                        .lineLimit(1)
                        .linkName(hovering)
                }
                Spacer(minLength: 4)
                if let result = e.result {
                    (Text(result).fontWeight(.semibold) + Text(GameLogStrip.score(e).map { " \($0)" } ?? ""))
                        .font(.system(size: 11).monospacedDigit())
                        .foregroundStyle(result == "D" ? .secondary : .primary)
                        .lineLimit(1)
                        .fixedSize()
                }
                ForEach(columns, id: \.key) { c in
                    Text(value(e, c.key))
                        .font(.system(size: 11.5).monospacedDigit())
                        .lineLimit(1)
                        .frame(width: c.width, alignment: .trailing)
                        .widthDetail()
                }
            }
        }
        .contextMenu { if let opponent = e.opponent { GoToTeamItem(team: opponent) } }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken(e, columns: columns))
        .accessibilityHint(LinkHint.match)
        .accessibilityAddTraits(.isLink)
        .accessibilityAction { open(e) }
    }

    /// "Oct 25, at Seattle, lost 3 to 20, 287 yards, 2 touchdowns".
    private func spoken(_ e: Profile.GameLog.Entry, columns: [StatColumn]) -> String {
        var parts = [ProfileFormat.short(e.date)]
        if let opponent = e.opponent { parts.append("\(e.home ? "versus" : "at") \(opponent.name)") }
        if let result = e.result {
            let word = ["W": "won", "L": "lost", "D": "drew", "T": "tied"][result] ?? result
            parts.append([word, GameLogStrip.score(e)?.replacingOccurrences(of: "–", with: " to ")].compactMap { $0 }.joined(separator: " "))
        }
        for c in columns {
            let v = value(e, c.key)
            parts.append(v == "–" ? "no \(StatSpeech.word(c.label))" : "\(v) \(StatSpeech.word(c.label))")
        }
        return parts.joined(separator: ", ")
    }

    private func value(_ e: Profile.GameLog.Entry, _ key: String) -> String {
        if key == "cmpatt", let c = e.stats["completions"], let a = e.stats["passingAttempts"] { return "\(c)/\(a)" }
        return e.stats[key] ?? "–"
    }

    /// Opens a game, when there's a navigator to open it with.
    private var opener: (@MainActor (Profile.GameLog.Entry) -> Void)? {
        guard navigator != nil else { return nil }
        return { open($0) }
    }

    private func open(_ e: Profile.GameLog.Entry) {
        guard let navigator, let event = ProfileEvents.event(for: e, player: ref, team: team) else { return }
        navigator.open(event)
    }
}

enum ProfileEvents {
    /// A finished (or upcoming) game from a player's log, as the match page expects it.
    static func event(for e: Profile.GameLog.Entry, player: Profile.PlayerRef, team: Profile.TeamRef?) -> Event? {
        guard let opponent = e.opponent else { return nil }
        let won = e.result == "W", lost = e.result == "L"
        func competitor(_ t: Profile.TeamRef, score: String?, winner: Bool) -> Competitor {
            Competitor(id: t.id, name: t.name, abbreviation: t.abbreviation ?? t.name, score: score, logo: t.logo,
                       isWinner: winner, color: t.color)
        }
        let us = competitor(team ?? Profile.TeamRef(id: "", name: ""), score: e.teamScore, winner: won)
        let them = competitor(opponent, score: e.opponentScore, winner: lost)
        let state: EventState = e.result == nil ? .scheduled : .final
        switch player.source {
        case let .espn(path):
            let soccer = player.sport == .soccer
            let (top, bottom) = soccer == e.home ? (us, them) : (them, us)
            return Event(id: "espn-\(e.eventID)", content: .match(top: top, bottom: bottom), state: state, start: e.date,
                         detail: state == .final ? (soccer ? "FT" : "Final") : nil, caption: e.competition, link: nil,
                         ref: .espn(path: path, id: e.eventID, sport: player.sport))
        case .counterStrike:
            return Event(id: "cs-\(e.eventID)", content: .match(top: us, bottom: them), state: state, start: e.date,
                         detail: "Final", caption: nil, link: URL(string: "https://bo3.gg/matches/\(e.eventID)"),
                         ref: .counterStrike(slug: e.eventID, tournament: nil))
        case .ifsc:
            return nil
        }
    }
}

// MARK: - Tables

/// A small stat table: a title column, then the preferred columns that exist
/// and fit; the rest join as the panel widens.
struct StatTableView: View {
    let table: Profile.StatTable
    let keys: [(String, WidthClass)]
    var titleWidth: CGFloat = 104
    @Environment(\.widthClass) private var widthClass

    private var indices: [Int] {
        let wanted = keys.filter { $0.1 <= widthClass }.map(\.0)
        let found = table.indices(wanted)
        if !found.isEmpty { return Array(found.prefix(widthClass >= .large ? 7 : 5)) }
        return Array(table.columns.indices.prefix(widthClass >= .large ? 6 : 4))
    }

    var body: some View {
        let indices = indices
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Spacer(minLength: titleWidth)
                ForEach(indices, id: \.self) { i in
                    Text(table.columns[i]).frame(width: 40, alignment: .trailing).widthDetail()
                }
            }
            .font(.system(size: 9.5, weight: .semibold))
            .foregroundStyle(.secondary)
            .padding(.bottom, 3)
            // Read once at the top, headers lose their numbers: each row says its own.
            .accessibilityHidden(true)
            ForEach(table.rows) { row in
                HStack(spacing: 6) {
                    Text(row.title)
                        .font(.system(size: 11.5))
                        .lineLimit(1)
                        .frame(minWidth: titleWidth, maxWidth: .infinity, alignment: .leading)
                    ForEach(indices, id: \.self) { i in
                        Text(i < row.values.count ? row.values[i] : "–")
                            .font(.system(size: 11.5).monospacedDigit())
                            .lineLimit(1)
                            .minimumScaleFactor(0.85)
                            .frame(width: 40, alignment: .trailing)
                            .widthDetail()
                    }
                }
                .padding(.vertical, 3)
                // "2025-26: 71 games, 25.3 points, 5.2 rebounds", not cell by cell.
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(row.title): " + indices.map { i in
                    let v = i < row.values.count ? row.values[i] : "–"
                    return v == "–" || v.isEmpty ? "no \(StatSpeech.word(table.columns[i]))" : "\(v) \(StatSpeech.word(table.columns[i]))"
                }.joined(separator: ", "))
            }
        }
    }
}

/// Stat column codes as VoiceOver should say them ("PTS" → "points").
enum StatSpeech {
    static func word(_ code: String) -> String {
        words[code.uppercased()] ?? code.lowercased()
    }

    private static let words: [String: String] = [
        "GP": "games", "G": "goals", "A": "assists", "PTS": "points", "REB": "rebounds", "AST": "assists", "MIN": "minutes",
        "FG": "field goals", "FG%": "field goal percentage", "3PT": "three-pointers", "3P%": "three-point percentage",
        "STL": "steals", "BLK": "blocks", "YDS": "yards", "TD": "touchdowns", "INT": "interceptions", "C/ATT": "completions",
        "RTG": "rating", "RUSH": "rushing yards", "CAR": "carries", "AVG": "average", "REC": "receptions", "TGT": "targets",
        "LNG": "long", "TOT": "tackles", "SACK": "sacks", "PD": "passes defended", "IP": "innings", "ER": "earned runs",
        "K": "strikeouts", "H": "hits", "BB": "walks", "DEC": "decision", "HR": "home runs", "RBI": "runs batted in",
        "AB": "at bats", "SO": "strikeouts", "SV": "saves", "GA": "goals against", "CS": "clean sheets", "SH": "shots",
        "SOT": "shots on target", "YC": "yellow cards", "K–D": "kills to deaths", "ADR": "damage per round",
        "HS%": "headshot percentage", "MAPS": "maps", "ERA": "earned run average", "W": "wins", "L": "losses",
        "OPS": "on-base plus slugging", "WHIP": "walks and hits per inning", "CMP%": "completion percentage",
        "STRT": "starts", "SHOTS": "shots", "APP": "appearances",
    ]
}

// MARK: - About

enum AboutFacts {
    private static let born: Date.FormatStyle = {
        var f = Date.FormatStyle.dateTime.month(.abbreviated).day().year()
        f.timeZone = TimeZone(identifier: "UTC")!
        return f
    }()

    /// Facts in reading order; a missing fact is skipped, never "–".
    static func facts(bio: Profile.Bio, sport: Sport, college: Bool, profile: Profile.PlayerProfile) -> [(String, String)] {
        var out: [(String, String)] = []
        func add(_ label: String, _ value: String?) { if let value, !value.isEmpty { out.append((label, value)) } }
        let birth = [bio.birthDate.map { $0.formatted(born) }, bio.birthPlace].compactMap { $0 }.joined(separator: " · ")
        let size = [bio.height.map(PlayerPage.height), bio.weight?.replacingOccurrences(of: " lbs", with: " lb")]
            .compactMap { $0 }.joined(separator: " · ")
        switch sport {
        case .esports:
            add("Born", bio.birthDate.map { $0.formatted(born) })
            add("Nationality", bio.nationality)
            add("With team since", bio.since.map { $0.formatted(.dateTime.month(.wide).year()) })
            add("Role", profile.roles.isEmpty ? nil : profile.roles.joined(separator: " · "))
            add("Prize money", bio.prizeMoney.map(ProfileFormat.money))
        case .climbing:
            add("Born", bio.birthDate.map { $0.formatted(born) })
            add("Height", bio.height)
            add("Arm span", bio.armSpan.map { "\($0) cm" })
            add("Home", bio.hometown)
            add("Federation", bio.federation)
            add("Speed PB", profile.speedBest)
        case .soccer:
            add("Born", birth)
            add("Nationality", bio.nationality)
            add("Height", bio.height.map(PlayerPage.height))
            add("Position", bio.position)
        case .football where college:
            add("Class", bio.classYear)
            add("Hometown", bio.birthPlace)
            add("Size", size)
            add("Position", bio.position)
        case .baseball:
            add("Born", birth)
            add("Bats / Throws", bio.batsThrows)
            add("Debut", bio.debutYear.map(String.init))
            add("Size", size)
        default:
            add("Born", birth)
            add("Size", size)
            add("College", bio.college)
            add("Drafted", bio.draft)
            add("Experience", bio.experience)
        }
        return out
    }
}

struct AboutGrid: View {
    let facts: [(String, String)]

    var body: some View {
        Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: 6) {
            ForEach(facts.indices, id: \.self) { i in
                GridRow {
                    Text(facts[i].0)
                        .textCase(.uppercase)
                        .font(.system(size: 9.5, weight: .semibold))
                        .tracking(0.3)
                        .foregroundStyle(.secondary)
                        .gridColumnAlignment(.leading)
                    Text(facts[i].1)
                        .font(.system(size: 12))
                        .fixedSize(horizontal: false, vertical: true)
                }
                .accessibilityElement(children: .combine)
            }
        }
    }
}

// MARK: - Note, career, awards

struct NoteView: View {
    let note: Profile.Note
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(note.headline)
                .font(.system(size: 12, weight: .medium))
                .fixedSize(horizontal: false, vertical: true)
            if let story = note.story, !story.isEmpty {
                Text(story)
                    .font(.system(size: 11.5))
                    .foregroundStyle(.secondary)
                    .lineLimit(expanded ? nil : 3)
                    .fixedSize(horizontal: false, vertical: true)
                    .contentShape(Rectangle())
                    .onTapGesture { expanded.toggle() }
                    // A click shows the rest; VoiceOver and the keyboard get the same.
                    .accessibilityAddTraits(.isButton)
                    .accessibilityHint(expanded ? "Shows less" : "Shows the whole story")
                    .accessibilityAction { expanded.toggle() }
            }
            if let published = note.published {
                Text(When.dayAndTime(published))
                    .font(.system(size: 10.5))
                    .foregroundStyle(.secondary)
            }
        }
        .readableWidth()
    }
}

struct CareerSection: View {
    let ref: Profile.PlayerRef
    let state: PlayerState
    let store: ProfileStore
    let position: String?

    var body: some View {
        if let career = state.profile.career {
            let shown = store.session[ref.memoryKey]?.expanded.contains("career") == true
            VStack(alignment: .leading, spacing: 0) {
                StatTableView(table: Profile.StatTable(columns: career.columns, keys: career.keys,
                                                       rows: shown ? career.rows : Array(career.rows.prefix(3))),
                              keys: PlayerColumns.career(sport: ref.sport, position: position), titleWidth: 104)
                if !shown, career.rows.count > 3 {
                    ProfileMoreButton(title: "All \(career.rows.count) Seasons") {
                        store.session[ref.memoryKey, default: .init()].expanded.insert("career")
                    }
                }
            }
        } else if state.careerLoading {
            ProgressView().controlSize(.small).frame(maxWidth: .infinity).padding(.vertical, 10)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Loading career")
        } else {
            ProfileMoreButton(title: "Show Career") { Task { await store.loadCareer(ref) } }
        }
    }
}

/// Wrapping capsules ("4× Finals MVP").
struct FlowChips: View {
    let items: [String]
    @State private var all = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            FlowLayout(spacing: 5, lineSpacing: 5) {
                ForEach(all ? items : Array(items.prefix(4)), id: \.self) { item in
                    Text(item)
                        .font(.system(size: 11))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Capsule().fill(Color.primary.opacity(0.06)))
                }
            }
            if !all, items.count > 4 {
                ProfileMoreButton(title: "All Awards (\(items.count))") { all = true }
            }
        }
    }
}

// MARK: - Climbing

struct PodiumRows: View {
    let podiums: [Profile.Podium]
    let championships: [Profile.Podium]

    var body: some View {
        StackColumn(spacing: 4) {
            ForEach(podiums) { row($0) }
            if !championships.isEmpty {
                ProfileGroupHeader(title: "World Championships")
                ForEach(championships) { row($0) }
            }
        }
    }

    private func row(_ p: Profile.Podium) -> some View {
        HStack(spacing: 10) {
            Text(p.discipline).font(.system(size: 12)).frame(maxWidth: .infinity, alignment: .leading)
            medal(p.gold, Color(red: 0.84, green: 0.69, blue: 0.22), "gold")
            medal(p.silver, Color(red: 0.70, green: 0.72, blue: 0.75), "silver")
            medal(p.bronze, Color(red: 0.74, green: 0.47, blue: 0.27), "bronze")
            Text("\(p.total)").font(.system(size: 11.5, weight: .semibold).monospacedDigit()).frame(width: 30, alignment: .trailing)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(p.discipline): \(p.gold) gold, \(p.silver) silver, \(p.bronze) bronze")
    }

    private func medal(_ n: Int, _ color: Color, _ name: String) -> some View {
        HStack(spacing: 4) {
            Circle().fill(color).frame(width: 8, height: 8)
            Text("\(n)").font(.system(size: 11.5).monospacedDigit()).foregroundStyle(n == 0 ? .tertiary : .primary)
        }
        .frame(width: 38, alignment: .leading)
        .help("\(n) \(name)")
    }
}

struct ResultRows: View {
    let results: [Profile.ClimbResult]

    var body: some View {
        let seasons = results.reduce(into: [String]()) { if !$0.contains($1.season) { $0.append($1.season) } }
        VStack(alignment: .leading, spacing: 0) {
            ForEach(seasons, id: \.self) { season in
                ProfileGroupHeader(title: season)
                ForEach(results.filter { $0.season == season }) { r in
                    HStack(spacing: 8) {
                        Text(r.rank.map(String.init) ?? "–")
                            .font(.system(size: 11.5, weight: (r.rank ?? 99) <= 3 ? .semibold : .regular).monospacedDigit())
                            .foregroundStyle((r.rank ?? 99) <= 3 ? .primary : .secondary)
                            .frame(width: 22, alignment: .trailing)
                        Text(r.event).font(.system(size: 12)).lineLimit(1)
                        Text(r.discipline).font(.system(size: 10.5)).foregroundStyle(.secondary)
                        Spacer(minLength: 4)
                        Text(r.date.map(ProfileFormat.short) ?? "")
                            .font(.system(size: 10.5).monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 2)
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }
}
