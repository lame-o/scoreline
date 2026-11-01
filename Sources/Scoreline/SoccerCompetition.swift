import Foundation
import SwiftUI

/// A competition season, independent of the leagues a user chose for Scores.
/// Stages come from ESPN's season metadata, not a hard-coded cup format.
struct SoccerCompetition {
    struct Stage: Identifiable {
        let id: String
        let name: String
        let slug: String
        let hasLegs: Bool
        let hasStandings: Bool
        let final: Bool
        let thirdPlace: Bool
        var ties: [Tie] = []
    }
    struct Tie: Identifiable {
        let id: String
        var match: BracketMatch
        var games: [ScheduleItem]
    }
    let title: String
    let year: Int
    let currentStage: String?
    var stages: [Stage]

    var tournamentBrackets: TournamentBrackets { TournamentBrackets(title: title, bracket: bracket) }

    /// A cup need not have a final draw before its confirmed paths are useful.
    /// Show the latest two published rounds as independent trees; future draws
    /// never become inferred feeders or a fabricated champion.
    var confirmedPaths: [Bracket] {
        let knockout = stages.filter { !$0.hasStandings && !$0.thirdPlace }
        guard let lastIndex = knockout.lastIndex(where: { !$0.ties.isEmpty }), lastIndex > 0 else { return [] }
        let rounds = Array(knockout[(lastIndex - 1)...lastIndex])
        var matches = Dictionary(uniqueKeysWithValues: rounds[0].ties.map { ($0.id, $0.match) })
        for tie in rounds[1].ties {
            var match = tie.match
            match.feeders = [match.top?.id, match.bottom?.id].compactMap { team in
                guard let team else { return nil }
                let candidates = rounds[0].ties.filter {
                    ($0.match.winner == .top ? $0.match.top?.id : $0.match.winner == .bottom ? $0.match.bottom?.id : nil) == team
                }
                return candidates.count == 1 ? candidates[0].id : nil
            }
            matches[match.id] = match
        }
        return rounds[1].ties.compactMap { tie in
            guard matches[tie.id]?.feeders.isEmpty == false else { return nil }
            return Bracket(rounds: rounds.map(\.name), matches: matches, finalID: tie.id)
        }
    }

    /// Only connect rounds whose actual advancing teams are known. Draws for
    /// future rounds are not predictable, even in an otherwise knockout cup.
    var bracket: Bracket? {
        let rounds = Array(stages.filter { !$0.hasStandings && !$0.thirdPlace }.drop { $0.ties.isEmpty })
        guard let last = rounds.last, last.final, last.ties.count == 1 else { return nil }
        var matches: [String: BracketMatch] = [:]
        for (i, stage) in rounds.enumerated() {
            for tie in stage.ties {
                var match = tie.match
                if i > 0 {
                    match.feeders = [match.top?.id, match.bottom?.id].compactMap { team in
                        guard let team else { return nil }
                        let candidates = rounds[i - 1].ties.filter {
                            let m = $0.match
                            return (m.winner == .top ? m.top?.id : m.winner == .bottom ? m.bottom?.id : nil) == team
                        }
                        return candidates.count == 1 ? candidates[0].id : nil
                    }
                }
                matches[match.id] = match
            }
        }
        // A final alone is still a fixture, not a connected tournament tree.
        guard matches[last.ties[0].id]?.feeders.isEmpty == false else { return nil }
        return Bracket(rounds: rounds.map(\.name), matches: matches, finalID: last.ties[0].id)
    }
}

enum SoccerCompetitionProvider {
    static func parse(season: JSON, boards: [JSON], slug: String) -> SoccerCompetition {
        let year = season["year"].int ?? 0
        var stages = season["types"]["items"].array.compactMap { item -> SoccerCompetition.Stage? in
            guard let id = item["type"].string, let name = item["name"].string else { return nil }
            return .init(id: id, name: name, slug: item["slug"].string ?? id,
                         hasLegs: item["hasLegs"].bool == true, hasStandings: item["hasStandings"].bool == true || item["hasGroups"].bool == true,
                         final: item["isFinal"].bool == true, thirdPlace: item["isThirdPlace"].bool == true)
        }
        var seen = Set<String>()
        let events = boards.flatMap { $0["events"].array }.filter {
            guard $0["season"]["year"].int == year, let id = $0["id"].string else { return false }
            return seen.insert(id).inserted
        }.sorted { ($0["date"].string ?? "") < ($1["date"].string ?? "") }
        for i in stages.indices {
            let stage = stages[i]
            var order: [String] = []
            var ties: [String: SoccerCompetition.Tie] = [:]
            for event in events where event["season"]["type"].string == stage.id {
                guard var item = ScheduleProvider.ESPN.item(event, path: "soccer/\(slug)", league: slug, sport: .soccer,
                                                          week: nil, now: .now, zone: .current) else { continue }
                item.competition = stage.name
                let c = event["competitions"][0]
                let competitors = c["competitors"].array
                func team(_ side: String) -> BracketTeam? {
                    guard let t = competitors.first(where: { $0["homeAway"].string == side })?["team"], let id = t["id"].string else { return nil }
                    return BracketTeam(id: id, name: t["shortDisplayName"].string ?? t["displayName"].string ?? "",
                                       abbreviation: t["abbreviation"].string ?? "", logo: t["logo"].string.flatMap(URL.init(string:)))
                }
                guard let home = team("home"), let away = team("away") else { continue }
                let key = stage.hasLegs ? stage.id + ":" + [home.id, away.id].sorted().joined(separator: ":") : item.id
                if ties[key] == nil {
                    order.append(key)
                    ties[key] = .init(id: key, match: BracketMatch(id: key, top: home, bottom: away), games: [])
                }
                guard var tie = ties[key] else { continue }
                tie.games.append(item)
                tie.match.live = tie.games.contains { $0.status == .live }
                let summary = c["notes"].array.compactMap { $0["headline"].string ?? $0["text"].string }.joined(separator: " · ")
                tie.match.note = summary.isEmpty ? item.statusDetail : summary
                let done = stage.hasLegs ? c["series"]["completed"].bool == true : item.status == .final
                let scores = stage.hasLegs ? c["series"]["competitors"].array : competitors
                // The winning leg can belong to the losing team on aggregate.
                let winningID = done ? scores.first { $0["winner"].bool == true }?["id"].string : nil
                tie.match.winner = winningID == nil ? nil : winningID == tie.match.top?.id ? .top : winningID == tie.match.bottom?.id ? .bottom : nil
                func score(_ id: String?) -> Int? {
                    scores.first { $0["id"].string == id }?[stage.hasLegs ? "aggregateScore" : "score"].int
                }
                let played = tie.games.contains { $0.status == .live || $0.status == .final }
                tie.match.topScore = played ? score(tie.match.top?.id) : nil
                tie.match.bottomScore = played ? score(tie.match.bottom?.id) : nil
                ties[key] = tie
            }
            stages[i].ties = order.compactMap { ties[$0] }
        }
        return SoccerCompetition(title: season["displayName"].string ?? slug, year: year,
                                 currentStage: season["type"]["type"].string, stages: stages)
    }

    static func load(slug: String, year requested: Int?) async throws -> SoccerCompetition {
        let base = "https://site.api.espn.com/apis/site/v2/sports/soccer/\(slug)/scoreboard"
        let year: Int
        if let requested { year = requested }
        else {
            let board = try await JSON.fetch(URL.api(base))
            guard let current = board["leagues"][0]["season"]["year"].int else { throw URLError(.cannotParseResponse) }
            year = current
        }
        let season = try await JSON.fetch(URL.api("https://sports.core.api.espn.com/v2/sports/soccer/leagues/\(slug)/seasons/\(year)"))
        guard !season["types"]["items"].array.isEmpty else { throw URLError(.cannotParseResponse) }
        // A European season spans two calendar years; a World Cup does not.
        let endYear = season["endDate"].string.flatMap { Int($0.prefix(4)) } ?? year
        guard endYear >= year, endYear <= year + 1 else { throw URLError(.cannotParseResponse) }
        var boards: [JSON] = []
        for y in year...endYear {
            let board = try await JSON.fetch(URL.api("\(base)?dates=\(y)&limit=1000"))
            if board["events"].array.count >= 1000 {
                // Never silently truncate a busy competition's season.
                for month in 1...12 {
                    try Task.checkCancellation()
                    let monthBoard = try await JSON.fetch(URL.api(String(format: "%@?dates=%04d%02d&limit=1000", base, y, month)))
                    guard monthBoard["events"].array.count < 1000 else { throw URLError(.dataLengthExceedsMaximum) }
                    boards.append(monthBoard)
                }
            } else { boards.append(board) }
        }
        return parse(season: season, boards: boards, slug: slug)
    }
}

struct SoccerCompetitionPage: View {
    @Environment(ScoreStore.self) private var store
    @Environment(PanelCommands.self) private var commands: PanelCommands?
    let slug: String
    let year: Int?
    let name: String
    let backTitle: String
    let highlight: Set<String>
    let onBack: () -> Void
    let onOpen: (Event) -> Void
    @State private var data: SoccerCompetition?
    @State private var selected: String?
    @State private var failed = false
    @State private var loading = false

    var body: some View {
        VStack(spacing: 0) {
            PageHeader(data?.title ?? name, symbol: "trophy") {
                BackButton(title: backTitle, action: onBack)
            } trailing: {
                IconButton(symbol: "arrow.clockwise", label: "Refresh competition") { Task { await load() } }
                    .disabled(loading)
            }
                .pageChrome()
            PageScrollView {
                StackColumn {
                    if let league = League.with(id: slug) {
                        Button { store.setEnabled(league, !store.isEnabled(league)) } label: {
                            Label(store.isEnabled(league) ? "Following competition" : "Follow competition", systemImage: store.isEnabled(league) ? "star.fill" : "star")
                        }.controlSize(.small).padding(.horizontal, 16).padding(.top, 8)
                    }
                    if let data {
                        if failed {
                            Text("Can’t refresh. Showing the last loaded competition.")
                                .font(.callout).foregroundStyle(.secondary).padding(12)
                        }
                        if let bracket = data.bracket {
                            DetailSection(title: "Bracket", caption: "Confirmed matchups. Two-leg ties show aggregate goals; penalties decide drawn ties.") {
                                BracketView(bracket: bracket, highlight: highlight)
                            }
                        }
                        if data.bracket == nil, !data.confirmedPaths.isEmpty {
                            DetailSection(title: "Bracket", caption: "Confirmed paths through the latest drawn round. Use the round selector for all fixtures; future pairings are not inferred.") {
                                VStack(spacing: 16) {
                                    ForEach(data.confirmedPaths, id: \.finalID) { path in
                                        BracketView(bracket: path, highlight: highlight, terminalLabel: path.rounds.last ?? "Latest round")
                                    }
                                }
                            }
                        }
                        Picker("Round or stage", selection: $selected) {
                            ForEach(data.stages) { stage in Text(stage.name).tag(Optional(stage.id)) }
                        }
                        .padding(.horizontal, 16).padding(.top, 12)
                        if let stage = data.stages.first(where: { $0.id == selected }) {
                            DetailSection(title: stage.name, caption: stage.hasLegs ? "Each tie and both legs. Open a match for its full detail." : "Fixtures and results. Open a match for its full detail.") {
                                if stage.ties.isEmpty {
                                    Text("Fixtures have not been published for this round.")
                                        .font(.callout).foregroundStyle(.secondary).padding(.vertical, 12)
                                }
                                LazyVStack(spacing: 4) {
                                    ForEach(stage.ties) { tie in
                                        SoccerCompetitionTieRow(tie: tie, hasLegs: stage.hasLegs, highlight: highlight, onOpen: onOpen)
                                    }
                                }
                            }
                        }
                    } else if failed {
                        ErrorState("Competition") { Task { await load() } }
                    } else { PageSpinner("Loading competition") }
                }
                .padding(.bottom, 14)
            }
        }
        .pageLoading(data == nil && !failed)
        .task(id: "\(slug):\(year ?? 0)") { await load() }
        .onChange(of: commands?.refreshToken) { Task { await load() } }
    }

    private func load() async {
        guard !loading else { return }
        loading = true
        defer { loading = false }
        do {
            let next = try await SoccerCompetitionProvider.load(slug: slug, year: year)
            guard !Task.isCancelled else { return }
            data = next
            failed = false
            if !next.stages.contains(where: { $0.id == selected }) {
                selected = next.stages.first { $0.id == next.currentStage }?.id ?? next.stages.first?.id
            }
        } catch { if !Task.isCancelled { failed = true } }
    }
}

private struct SoccerCompetitionTieRow: View {
    let tie: SoccerCompetition.Tie
    let hasLegs: Bool
    let highlight: Set<String>
    let onOpen: (Event) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if hasLegs, let note = tie.match.note { Text(note).font(.caption).foregroundStyle(.secondary) }
            ForEach(tie.games) { item in
                VStack(alignment: .leading, spacing: 0) {
                    Text(item.sortDate, format: .dateTime.weekday().month().day())
                        .font(.caption).foregroundStyle(.secondary).padding(.horizontal, 12)
                    ScheduleRow(item: item, highlighted: [tie.match.top?.id, tie.match.bottom?.id].contains { $0.map { highlight.contains($0) } == true },
                                showsCompetition: false, onHover: { _ in }, onSelect: { onOpen($0.event()) })
                }
            }
        }
        .padding(.vertical, 4)
    }
}
