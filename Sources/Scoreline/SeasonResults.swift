import Foundation
import Observation
import SwiftUI

// Results for the two season sports. Climbing (IFSC): past seasons, the
// podiums, a category's full results. CS2 (bo3.gg): finished tournaments
// with their placings, a tournament's matches by round. The parsers are pure
// and run in the cache's detached task, so every string a row shows is made
// once, off the main thread. The store keeps one observable box per page:
// a load re-renders the page reading it, nothing else. See specs/results.md §4–§5.

// MARK: - Climbing: a category's full results

/// `/events/{id}/result/{dcat}`: every athlete in a category, with each
/// round's rank and score.
struct CategoryResults: Hashable, Codable, Sendable {
    struct Round: Hashable, Codable, Sendable, Identifiable {
        /// `category_round_id`
        let id: Int
        /// "Qualification", "Semi-final", "Final"
        let name: String
        let status: String
        /// What the match page loads (`EventRef.climbing(resultURL:)`).
        let resultPath: String?
        /// A column header: "Qual.", "Semi", "Final".
        let short: String
    }

    struct Score: Hashable, Codable, Sendable {
        let roundID: Int
        let rank: Int?
        /// IFSC's text, kept as is: "TOP", "48+", "84.6", "5.43 (5.12)".
        let score: String?
        /// Speed's elimination final: how far the athlete went ("1st", "Quarter-final").
        var placing: String? = nil
    }

    struct Row: Identifiable, Hashable, Codable, Sendable {
        let athleteID: Int
        let rank: Int?
        /// Shares its rank with another athlete.
        let tied: Bool
        /// "Janja Garnbret"
        let name: String
        /// IOC code ("SLO").
        let country: String?
        /// In round order, only the rounds climbed.
        let scores: [Score]
        /// Where the field drops to an earlier round (or, in a speed final, a
        /// heat): the label over the first row of each group.
        let stage: String
        /// "1", "55", "–"
        let rankText: String
        /// "55th, tied, Aimara Luz Baldasare Tello, Argentina, qualification: 0"
        let spoken: String
        var id: Int { athleteID }

        /// The last round climbed: what the compact ranking shows.
        var last: Score? { scores.last }
        func score(in round: Int) -> Score? { scores.first { $0.roundID == round } }
    }

    /// "World Climbing Series Santiago 2026"
    let event: String
    /// "Lead Women"
    let category: String
    /// "lead", "boulder", "speed"
    let discipline: String
    let status: String
    let rounds: [Round]
    let rows: [Row]
}

/// Your countries' best athlete in a category, for the season list.
struct CountryBest: Hashable, Sendable {
    let athleteID: Int
    let country: String
    let rank: Int
    /// "Ella Fisher"
    let name: String
    /// "🇺🇸 Ella Fisher · 8th"
    let text: String
}

// MARK: - CS2: finished tournaments

/// A finished tournament as the results list shows it: the tournament and its
/// placings (rosters dropped at parse time).
struct FinishedTournament: Identifiable, Hashable, Codable, Sendable {
    /// bo3.gg's numeric ID (its match list is filtered by it).
    let bo3ID: Int
    var event: SeasonEvent
    /// Sorted by place; teams bo3.gg hasn't named are left out.
    var placements: [Placement]
    /// "IEM Cologne Major Stage 2": the name fans use, without a year the dates give.
    var title: String
    /// "🏆 Vitality · 2nd MOUZ · $1M"
    var summary: String?
    var id: String { event.id }
    var slug: String {
        if case let .tournament(slug) = event.kind { return slug }
        return event.id
    }
}

struct FinishedPage: Hashable, Codable, Sendable {
    var items: [FinishedTournament]
    /// bo3.gg's count for the whole query (qualifiers included).
    var total: Int
}

/// A tournament's match list page, with where each match sits.
struct TournamentMatches: Hashable, Codable, Sendable {
    var items: [ScheduleItem]
    /// Item ID → stage and round IDs.
    var stage: [String: Int]
    var round: [String: Int]
    var total: Int
}

/// A tournament stage's name and its rounds' names (`/stages/{id}`, matches dropped).
struct StageInfo: Hashable, Codable, Sendable {
    struct Round: Hashable, Codable, Sendable {
        let id: Int
        /// "Round 5", "Quarterfinal", "Grand final", "3rd place"
        let name: String
        let index: Int
    }
    let id: Int
    /// "ESL Pro League Season 24 Group Stage"
    let title: String
    /// "swiss", "group", "playoff"
    let format: String
    let sequence: Int?
    let rounds: [Round]
}

/// The matches of one stage round, as the tournament page lists them.
struct MatchGroup: Identifiable, Hashable, Sendable {
    let id: String
    /// "Grand final", "Swiss · Round 5"
    let title: String
    /// Start order.
    let items: [ScheduleItem]
    /// The round's last start: groups list newest first by it.
    let last: Date
}

// MARK: - Parsing and requests

enum SeasonResults {
    typealias IFSC = ScheduleProvider.IFSC
    typealias CS = ScheduleProvider.CS

    // MARK: Freshness

    /// Finals barely change after two days (corrections land within ~48 h):
    /// then 30 days, revalidated by ETag; until then, half an hour.
    static func ttl(endedAt end: Date?, now: Date = .now) -> TimeInterval {
        guard let end else { return 6 * 3600 }
        if end > now { return 10 * 60 }
        return now.timeIntervalSince(end) > 48 * 3600 ? 30 * 86_400 : 30 * 60
    }

    // MARK: IFSC seasons

    /// Seasons that can have results, newest first: the current one and the
    /// seven before it (the root lists 1990 to placeholder years ahead).
    static func resultSeasons(_ list: ScheduleStore.SeasonList) -> [IFSC.SeasonRef] {
        let current = list.current?.name ?? String(DayKey.today().year)
        return Array(list.all.filter { $0.name <= current }.sorted { $0.name > $1.name }.prefix(8))
    }

    /// A past season's calendar is settled; the current one moves.
    static func seasonTTL(_ name: String, current: String?) -> TimeInterval {
        if let current, name < current { return 30 * 86_400 }
        return 12 * 3600   // ScheduleStore.calendarTTL
    }

    /// Statuses move with the clock, not the cache.
    static func clocked(_ events: [SeasonEvent], now: Date = .now) -> [SeasonEvent] {
        events.map { event in
            var event = event
            if event.status != .canceled { event.status = IFSC.status(startsAt: event.startsAt, endsAt: event.endsAt, now: now) }
            return event
        }
    }

    /// The season's finished competitions, newest first.
    static func finished(_ events: [SeasonEvent]) -> [SeasonEvent] {
        events.filter { $0.status == .finished }.sorted { ($0.endDay, $0.startDay) > ($1.endDay, $1.startDay) }
    }

    // MARK: IFSC events

    /// A competition built from its own detail (`/events/{id}`), for a page
    /// opened without the season list: name, dates, place, then the detail.
    /// Same type as the season's parse, so the URL keeps one cached type.
    static func standaloneEvent(_ data: Data, now: Date = .now) -> SeasonEvent? {
        let e = JSON(data: data)
        guard let id = e["id"].int, let name = e["name"].string,
              let first = DayKey(iso: e["local_start_date"].string), let last = DayKey(iso: e["local_end_date"].string)
        else { return nil }
        let startsAt = DateParser.parse(e["starts_at"].string)
        let endsAt = DateParser.parse(e["ends_at"].string)
        var lanes: [String] = []
        for kind in e["disciplines"].array.compactMap({ $0["kind"].string }) {
            let mapped: [String] = switch kind {
            case "speed_relay": ["speed"]
            case "boulder&lead", "combined": ["boulder", "lead"]
            default: [kind]
            }
            for lane in mapped where !lanes.contains(lane) { lanes.append(lane) }
        }
        let base = SeasonEvent(
            id: "ifsc-\(id)", kind: .climbing(id), name: name, shortName: IFSC.shortName(name),
            place: e["location"].string, countryCode: Flag.iso(ioc: e["country"].string),
            startDay: first, endDay: last, startsAt: startsAt, endsAt: endsAt,
            timeZone: e["timezone"]["value"].string, lanes: lanes,
            badge: name.contains("Olympic Games") ? "Olympic Games" : name.contains("Championship") ? "World Championships" : nil,
            status: IFSC.status(startsAt: startsAt, endsAt: endsAt, now: now),
            link: URL(string: "\(IFSC.base)/event/\(id)"))
        return IFSC.parseEvent(data, into: base)
    }

    static func categoryURL(event: Int, dcat: Int) -> URL {
        URL(string: "\(IFSC.base)/api/v1/events/\(event)/result/\(dcat)")!
    }

    /// "LEAD Women" → ("Lead Women", "lead")
    static func categoryName(_ raw: String) -> (name: String, discipline: String) {
        let parts = raw.split(separator: " ", maxSplits: 1).map(String.init)
        let discipline = (parts.first ?? raw).lowercased()
        let name = ([discipline.capitalized] + (parts.count > 1 ? [parts[1]] : [])).joined(separator: " ")
        return (name.trimmingCharacters(in: .whitespaces), discipline)
    }

    /// "Qualification" → "Qual.", "Semi-final" → "Semi", "Final" → "Final".
    static func shortRound(_ name: String) -> String {
        switch name.lowercased() {
        case "qualification": "Qual."
        case "semi-final", "semifinal", "semi-finals": "Semi"
        case "final", "finals": "Final"
        default: String(name.prefix(5))
        }
    }

    static func parseCategory(_ data: Data) -> CategoryResults {
        let json = JSON(data: data)
        let (category, discipline) = categoryName(json["dcat"].string ?? "")
        let rounds = json["category_rounds"].array.compactMap { r -> CategoryResults.Round? in
            guard let id = r["category_round_id"].int else { return nil }
            let name = r["name"].string ?? "Round"
            return .init(id: id, name: name, status: r["status"].string ?? "pending", resultPath: r["result_url"].string,
                         short: shortRound(name))
        }
        let order = Dictionary(rounds.enumerated().map { ($1.id, $0) }, uniquingKeysWith: { a, _ in a })
        let speed = discipline == "speed"

        struct Raw {
            let id: Int, rank: Int?, first: String, last: String, country: String?, scores: [CategoryResults.Score]
        }
        let raws = json["ranking"].array.compactMap { a -> Raw? in
            guard let id = a["athlete_id"].int else { return nil }
            let rank = a["rank"].int
            let scores = a["rounds"].array.compactMap { r -> CategoryResults.Score? in
                guard let roundID = r["category_round_id"].int else { return nil }
                let text = r["score"].string.flatMap { $0.isEmpty ? nil : $0 }
                var score = CategoryResults.Score(roundID: roundID, rank: r["rank"].int, score: text)
                if speed, r["speed_elimination_stages"].exists {
                    score.placing = speedPlacing(r["speed_elimination_stages"].array, rank: r["rank"].int ?? rank)
                }
                return score
            }.sorted { (order[$0.roundID] ?? 0) < (order[$1.roundID] ?? 0) }
            return Raw(id: id, rank: rank, first: (a["firstname"].string ?? "").trimmingCharacters(in: .whitespaces),
                       last: (a["lastname"].string ?? "").capitalized.trimmingCharacters(in: .whitespaces),
                       country: a["country"].string, scores: scores)
        }
        var counts: [Int: Int] = [:]
        for raw in raws { if let rank = raw.rank { counts[rank, default: 0] += 1 } }
        // Ranks first; inside a tie, by surname (IFSC's order there means nothing).
        let sorted = raws.sorted { a, b in
            if (a.rank ?? .max) != (b.rank ?? .max) { return (a.rank ?? .max) < (b.rank ?? .max) }
            return a.last.localizedStandardCompare(b.last) == .orderedAscending
        }
        let rows = sorted.map { raw -> CategoryResults.Row in
            let tied = raw.rank.map { (counts[$0] ?? 0) > 1 } ?? false
            let name = raw.first.isEmpty ? raw.last : "\(raw.first) \(raw.last)"
            let lastRound = raw.scores.last.flatMap { s in rounds.first { $0.id == s.roundID } }
            var stage = lastRound?.name ?? "Unranked"
            if let placing = raw.scores.last?.placing, placing.first?.isNumber == false { stage = placing }
            let spoken = [raw.rank.map(Ordinal.string), tied ? "tied" : nil, name, raw.country.map(TeamCatalog.countryName),
                          spokenScore(raw.scores.last, round: lastRound?.name)]
                .compactMap { $0 }.joined(separator: ", ")
            return .init(athleteID: raw.id, rank: raw.rank, tied: tied, name: name, country: raw.country, scores: raw.scores,
                         stage: stage, rankText: raw.rank.map(String.init) ?? "–", spoken: spoken)
        }
        return CategoryResults(event: json["event"].string ?? "", category: category, discipline: discipline,
                               status: json["status"].string ?? "", rounds: rounds, rows: rows)
    }

    /// The elimination final: the last heat an athlete ran and whether they
    /// won it. The big and small finals place 1st–4th; everyone else went out
    /// in a heat ("1/4" → "Quarter-final").
    static func speedPlacing(_ stages: [JSON], rank: Int?) -> String? {
        guard let name = stages.last?["name"].string else { return nil }
        switch name.lowercased() {
        case "final", "small final", "big final": return rank.map(Ordinal.string)
        case "1/2": return "Semi-final"
        case "1/4": return "Quarter-final"
        case "1/8": return "Round of 16"
        case "1/16": return "Round of 32"
        default: return name
        }
    }

    private static func spokenScore(_ score: CategoryResults.Score?, round: String?) -> String? {
        guard let score, let text = score.score else { return round?.lowercased() }
        let value = text == "TOP" ? "top" : text
        let place = score.placing.flatMap { $0.first?.isNumber == false ? $0.lowercased() : nil }
        return "\([round?.lowercased(), place].compactMap { $0 }.joined(separator: ", ")): \(value)"
    }

    /// Each highlighted country's best athlete off the podium (the podium
    /// lines already name the top three).
    static func best(in results: CategoryResults, countries: Set<String>) -> [CountryBest] {
        guard !countries.isEmpty else { return [] }
        var seen = Set<String>()
        var out: [CountryBest] = []
        for row in results.rows {
            guard let country = row.country, countries.contains(country), let rank = row.rank, !seen.contains(country) else { continue }
            seen.insert(country)
            guard rank > 3 else { continue }
            out.append(CountryBest(athleteID: row.athleteID, country: country, rank: rank,
                                   name: row.name,
                                   text: "\(Flag.emoji(ioc: country) ?? country) \(row.name) · \(Ordinal.string(rank))"))
        }
        return out
    }

    /// A finished round as the match page opens it (§4.4).
    static func roundEvent(_ event: SeasonEvent, category: String, round: SeasonEvent.RoundLink, winner: String? = nil) -> Event? {
        guard case let .climbing(eventID) = event.kind, let path = round.resultPath else { return nil }
        let summary = [round.name, winner.map { "Winner \($0)" }].compactMap { $0 }.joined(separator: " · ")
        return Event(id: "ifsc-\(eventID)-r\(round.id)", content: .field(title: category, summary: summary),
                     state: round.status == "active" ? .live : .final,
                     start: event.startsAt ?? event.startDay.start(in: .current), detail: round.name,
                     caption: "\(event.shortName) \(event.startDay.year)", link: event.link,
                     ref: .climbing(eventID: eventID, category: category, resultURL: path, round: round.name,
                                    eventName: event.shortName, nextURL: nil))
    }

    /// "🇸🇮 J. Garnbret": a round's winner, short.
    static func shortName(_ first: String, _ last: String, country: String?) -> String {
        let initial = first.first.map { "\($0). " } ?? ""
        return [Flag.emoji(ioc: country), initial + last].compactMap { $0 }.joined(separator: " ")
    }

    /// "🥇 🇨🇳 Zhao · 🇨🇳 Deng · 🇨🇭 Utelli · 🇸🇮 Garnbret": every category's winner.
    static func winners(_ event: SeasonEvent, limit: Int? = nil) -> String? {
        let names = event.categories.compactMap { category -> String? in
            if let a = category.podiumAthletes.first(where: { $0.rank == 1 }) {
                return [Flag.emoji(ioc: a.country), a.last].compactMap { $0 }.joined(separator: " ")
            }
            guard let entry = category.podium.first else { return nil }
            let parts = entry.split(separator: " ", maxSplits: 1).map(String.init)
            return parts.count == 2 ? "\(Flag.emoji(ioc: parts[0]) ?? parts[0]) \(parts[1])" : entry
        }
        guard !names.isEmpty else { return nil }
        return "🥇 " + (limit.map { Array(names.prefix($0)) } ?? names).joined(separator: " · ")
    }

    /// Every category winner's surname, for the timeline's readout.
    static func winnerNames(_ event: SeasonEvent) -> [String] {
        event.categories.compactMap { category in
            category.podiumAthletes.first { $0.rank == 1 }?.last
                ?? category.podium.first.map { $0.split(separator: " ", maxSplits: 1).last.map(String.init) ?? $0 }
        }
    }

    // MARK: bo3.gg

    static func finishedURL(page: Int, limit: Int = pageSize) -> URL {
        var c = URLComponents(string: "\(CS.api)/tournaments")!
        c.queryItems = [
            .init(name: "filter[tournaments.discipline_id][eq]", value: "1"),
            .init(name: "filter[tournaments.status][in]", value: "finished"),
            .init(name: "filter[tournaments.tier][in]", value: CounterStrike.tier),
            .init(name: "sort", value: "-end_date"),
            .init(name: "page[limit]", value: String(limit)),
            .init(name: "page[offset]", value: String(page * limit)),
            .init(name: "with", value: "tournament_prizes"),
        ]
        return c.url!
    }

    /// Six with placings is about 70 KB gzipped: a page at a time.
    static let pageSize = 6

    /// One tournament with its placings, by slug: a page opened cold (the
    /// detail endpoint is 73 KB; this is about 12).
    static func slugURL(_ slug: String) -> URL {
        var c = URLComponents(string: "\(CS.api)/tournaments")!
        c.queryItems = [.init(name: "filter[tournaments.slug][eq]", value: slug), .init(name: "with", value: "tournament_prizes")]
        return c.url!
    }

    static func parseFinished(_ data: Data) -> FinishedPage {
        let json = JSON(data: data)
        let items = json["results"].array.compactMap { t -> FinishedTournament? in
            guard let id = t["id"].int, var event = CS.tournament(t),
                  // Qualifiers are tournaments of their own; their results aren't news.
                  !event.name.localizedCaseInsensitiveContains("qualifier") else { return nil }
            let placements = placements(t["tournament_prizes"].array)
            if event.status != .canceled { event.status = .finished }
            return FinishedTournament(bo3ID: id, event: event, placements: placements, title: displayName(event.name),
                                      summary: summary(placements, prize: event.prize))
        }
        return FinishedPage(items: items, total: json["total"]["count"].int ?? items.count)
    }

    /// "Intel Extreme Masters Cologne Major 2026 Stage 2" → "IEM Cologne Major Stage 2"
    /// (the short name drops a trailing year; a year mid-name goes too).
    static func displayName(_ name: String) -> String {
        let words = CS.shortName(name).split(separator: " ")
        let kept = words.filter { !($0.count == 4 && Int($0).map { (1990...2100).contains($0) } == true) }
        return kept.count >= 2 ? kept.joined(separator: " ") : words.joined(separator: " ")
    }

    static func placements(_ prizes: [JSON]) -> [Placement] {
        prizes.enumerated().compactMap { index, p -> (Int, Placement)? in
            let t = p["teams"]
            guard let id = t["id"].int ?? p["team_id"].int, let name = t["name"].string,
                  let (place, order) = placeLabel(p["place"].string) else { return nil }
            let team = ScheduleTeam(id: "cs-\(id)", name: name, abbreviation: CounterStrike.abbreviate(name),
                                    logo: t["image_url"].string.flatMap(URL.init(string:)), rank: t["rank"].int)
            return (index, Placement(place: place, order: order, team: team, money: p["money"].int, clubMoney: p["club_money"].int))
        }
        .sorted { ($0.1.order, $0.0) < ($1.1.order, $1.0) }
        .map(\.1)
    }

    /// bo3.gg's "5-8th" → ("5th–8th", 5); "1st" → ("1st", 1); "25-32nd" → ("25th–32nd", 25).
    static func placeLabel(_ raw: String?) -> (String, Int)? {
        guard let raw = raw?.trimmingCharacters(in: .whitespaces), !raw.isEmpty else { return nil }
        let parts = raw.split(separator: "-").map(String.init)
        let first = Int(parts[0].prefix { $0.isNumber })
        guard let first else { return (raw, .max) }
        if parts.count == 2, let second = Int(parts[1].prefix { $0.isNumber }) {
            return ("\(Ordinal.string(first))–\(Ordinal.string(second))", first)
        }
        return (Ordinal.string(first), first)
    }

    /// "🏆 Vitality · 2nd MOUZ · $1M"; a qualification stage's shared top
    /// places read "1st–2nd FUT, Spirit".
    static func summary(_ placements: [Placement], prize: Int?) -> String? {
        var parts: [String] = []
        if let first = placements.first {
            if first.place == "1st" {
                parts.append("🏆 \(first.team.name)")
                if let second = placements.first(where: { $0.order == 2 }) { parts.append("\(second.place) \(second.team.name)") }
            } else {
                parts.append("\(first.place) " + placements.filter { $0.order == first.order }.map(\.team.name).joined(separator: ", "))
            }
        }
        if let prize = CS.prize(prize) { parts.append(prize) }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    static func tournamentMatchesURL(_ id: Int, offset: Int = 0) -> URL {
        var c = URLComponents(string: "\(CS.api)/matches")!
        c.queryItems = [
            .init(name: "filter[matches.tournament_id][eq]", value: String(id)),
            .init(name: "page[limit]", value: "100"),
            .init(name: "page[offset]", value: String(offset)),
            .init(name: "with", value: "teams"),
        ]
        return c.url!
    }

    static func parseTournamentMatches(_ data: Data, now: Date = .now) -> TournamentMatches {
        let json = JSON(data: data)
        var stage: [String: Int] = [:], round: [String: Int] = [:]
        for m in json["results"].array {
            guard let id = m["id"].int else { continue }
            if let s = m["stage_id"].int { stage["cs-\(id)"] = s }
            if let r = m["round_id"].int { round["cs-\(id)"] = r }
        }
        // R1's result rule: every final labeled, a forfeit without bo3.gg's fake 1–0.
        return TournamentMatches(items: CS.parseMatches(data, now: now).map(ResultParse.counterStrike), stage: stage, round: round,
                                 total: json["total"]["count"].int ?? 0)
    }

    static func stageURL(_ id: Int) -> URL { URL(string: "\(CS.api)/stages/\(id)")! }

    static func parseStage(_ data: Data) -> StageInfo? {
        let s = JSON(data: data)
        guard let id = s["id"].int else { return nil }
        let rounds = s["rounds"].array.compactMap { r -> StageInfo.Round? in
            // Trimmed or older responses carry no round ID: its matches still say it.
            guard let rid = r["id"].int ?? r["matches"][0]["round_id"].int else { return nil }
            return .init(id: rid, name: r["name"].string ?? "Round \(r["round_index"].int ?? 0)", index: r["round_index"].int ?? 0)
        }
        return StageInfo(id: id, title: s["title"].string ?? "", format: s["format_type"].string ?? "",
                         sequence: s["sequence_number"].int, rounds: rounds)
    }

    /// "ESL Pro League Season 24 Group Stage" (swiss) → "Swiss"; "… Playoffs" → "Playoffs".
    static func stageName(_ stage: StageInfo, tournament: String) -> String {
        if stage.format == "swiss" { return "Swiss" }
        var title = stage.title
        for prefix in [tournament, CS.shortName(tournament)] where title.hasPrefix(prefix) {
            title = String(title.dropFirst(prefix.count)).trimmingCharacters(in: .whitespaces)
            break
        }
        return title.isEmpty ? stage.format.capitalized : title
    }

    /// Matches by stage round, newest round first, start order inside. A
    /// playoff round says its own name ("Grand final"); a Swiss or group round
    /// gets its stage ("Swiss · Round 5"). Without stage data, by day.
    static func groups(_ matches: TournamentMatches, stages: [StageInfo], tournament: String) -> [MatchGroup] {
        var rounds: [Int: (stage: StageInfo, round: StageInfo.Round)] = [:]
        for stage in stages { for round in stage.rounds { rounds[round.id] = (stage, round) } }
        var buckets: [String: (title: String, items: [ScheduleItem])] = [:]
        for item in matches.items {
            let key: String, title: String
            if let rid = matches.round[item.id], let found = rounds[rid] {
                key = "r\(rid)"
                title = found.stage.format == "playoff" ? found.round.name.capitalizedFirst
                    : "\(stageName(found.stage, tournament: tournament)) · \(found.round.name.capitalizedFirst)"
            } else {
                key = "d\(item.day)"
                title = item.day.longLabel
            }
            buckets[key, default: (title, [])].items.append(item)
        }
        return buckets.map { key, value in
            let items = value.items.sorted { $0.sortDate < $1.sortDate }
            return MatchGroup(id: key, title: value.title, items: items, last: items.last?.sortDate ?? .distantPast)
        }
        .sorted { $0.last > $1.last }
    }

    /// "beat MOUZ 3–0 in the grand final": the champion's last match against the runner-up.
    static func finalLine(_ tournament: FinishedTournament, groups: [MatchGroup]) -> String? {
        guard let first = tournament.placements.first, first.place == "1st",
              let second = tournament.placements.first(where: { $0.order == 2 }) else { return nil }
        let pair = Set([first.team.id, second.team.id].compactMap { $0 })
        for group in groups {
            guard let match = group.items.last(where: { Set($0.teams.compactMap(\.id)) == pair }) else { continue }
            let round = group.title.contains("·") ? "" : " in the \(group.title.lowercased())"
            if match.result?.kind == .forfeit { return "beat \(second.team.name) by forfeit\(round)" }
            let mine = match.top?.id == first.team.id ? match.top : match.bottom
            let theirs = match.top?.id == first.team.id ? match.bottom : match.top
            guard let a = mine?.score, let b = theirs?.score else { return "beat \(second.team.name)\(round)" }
            return "beat \(second.team.name) \(a)–\(b)\(round)"
        }
        return nil
    }
}

// MARK: - Store

/// Results for climbing and CS2: past seasons, a category's results,
/// finished tournaments and a tournament's matches. Reads through
/// `ScheduleCache` (ETag, long TTLs for what's settled); nothing loads until
/// a page asks. One observable box per page.
@MainActor
@Observable
final class SeasonResultsStore {
    static let shared = SeasonResultsStore()
    typealias IFSC = ScheduleProvider.IFSC

    // MARK: Boxes

    /// The climbing season page in results mode (and the league page's preview).
    @MainActor @Observable final class Climbing {
        /// Seasons with results, newest first ("2026", "2025", …).
        var menu: [String] = []
        var season: String?
        /// Every competition of each loaded season (the timeline wants them all).
        var events: [String: [SeasonEvent]] = [:]
        var loading = false
        var failed = false
        var stale = false
        var updated: Date?
        var expanded: Set<String> = []
        /// Split panel: the competition beside the list.
        var selected: String?
        /// "1489-5" → your countries' best athletes in that category.
        var yours: [String: [CountryBest]] = [:]

        var current: [SeasonEvent] { season.flatMap { events[$0] } ?? [] }
    }

    /// The tournaments page in results mode.
    @MainActor @Observable final class Tournaments {
        var items: [FinishedTournament] = []
        var pages = 0
        var more = false
        var loading = false
        var failed = false
        var stale = false
        var updated: Date?
        /// Split panel: the tournament beside the list.
        var selected: String?
    }

    /// A climbing category's results page.
    @MainActor @Observable final class Category {
        var event: SeasonEvent?
        var results: CategoryResults?
        var loading = false
        var failed = false
        var stale = false
        var updated: Date?
    }

    /// A tournament's results page.
    @MainActor @Observable final class Tournament {
        var tournament: FinishedTournament?
        var groups: [MatchGroup] = []
        var matches = 0
        var final: String?
        var loading = false
        var failed = false
        var stale = false
        var updated: Date?
    }

    /// Followed CS2 teams' last results (league page).
    @MainActor @Observable final class Followed {
        var items: [ScheduleItem] = []
        var loaded = false
    }

    let climbing = Climbing()
    let tournaments = Tournaments()
    let followed = Followed()
    @ObservationIgnored private var categories: [String: Category] = [:]
    @ObservationIgnored private var tournamentPages: [String: Tournament] = [:]
    @ObservationIgnored private var seasonRefs: [String: IFSC.SeasonRef] = [:]
    @ObservationIgnored private var currentSeason: String?

    let cache: ScheduleCache

    init(cache: ScheduleCache = .shared) {
        self.cache = cache
    }

    func category(_ eventID: Int, _ dcatID: Int) -> Category {
        let key = "\(eventID)-\(dcatID)"
        if let box = categories[key] { return box }
        let box = Category()
        categories[key] = box
        return box
    }

    func tournament(_ slug: String) -> Tournament {
        if let box = tournamentPages[slug] { return box }
        let box = Tournament()
        tournamentPages[slug] = box
        return box
    }

    // MARK: Climbing

    /// The seasons, then the chosen one (the current season, or the one
    /// before while nothing in this one has finished), then the winners of
    /// its finished competitions (`details`: how many, newest first; nil = all).
    func loadClimbing(force: Bool = false, details: Int? = nil) async {
        let box = climbing
        if box.loading { return }
        box.loading = true
        defer { box.loading = false }
        guard let list = try? await cache.get(IFSC.rootURL, headers: IFSC.headers, ttl: force ? 0 : ScheduleStore.calendarTTL,
                                              parse: { data in
                                                  let s = IFSC.seasons(root: data)
                                                  return ScheduleStore.SeasonList(current: s.current, all: s.all)
                                              }) else {
            box.failed = box.events.isEmpty
            return
        }
        let seasons = SeasonResults.resultSeasons(list.value)
        currentSeason = list.value.current?.name ?? seasons.first?.name
        seasonRefs = Dictionary(seasons.map { ($0.name, $0) }, uniquingKeysWith: { a, _ in a })
        if box.menu != seasons.map(\.name) { box.menu = seasons.map(\.name) }
        var stale = list.stale
        if box.season == nil || force {
            var pick = box.season
            if pick == nil {
                for ref in seasons.prefix(2) {
                    guard let loaded = await fetchSeason(ref, force: force) else { continue }
                    stale = stale || loaded.stale
                    if pick == nil { pick = ref.name }
                    // Nothing finished yet (March, before the opener): the season before.
                    if loaded.events.contains(where: { $0.status == .finished }) { pick = ref.name; break }
                }
            } else if let name = pick, let ref = seasonRefs[name], let loaded = await fetchSeason(ref, force: true) {
                stale = stale || loaded.stale
            }
            box.season = pick
        } else if let name = box.season, box.events[name] == nil, let ref = seasonRefs[name] {
            let loaded = await fetchSeason(ref, force: false)
            stale = stale || (loaded?.stale ?? true)
        }
        box.failed = box.season.flatMap { box.events[$0] } == nil
        box.stale = stale
        box.updated = .now
        if let season = box.season { await loadDetails(season: season, limit: details, force: force) }
    }

    /// Picks a season from the title menu (one request the first time, 30 days after).
    func selectSeason(_ name: String) async {
        let box = climbing
        guard box.season != name else { return }
        box.season = name
        box.selected = nil
        if box.events[name] == nil, let ref = seasonRefs[name] {
            box.loading = true
            let loaded = await fetchSeason(ref, force: false)
            box.loading = false
            box.stale = loaded?.stale ?? true
            box.failed = loaded == nil
            box.updated = .now
        }
        await loadDetails(season: name, limit: nil, force: false)
    }

    private func fetchSeason(_ ref: IFSC.SeasonRef, force: Bool) async -> (events: [SeasonEvent], stale: Bool)? {
        let ttl = force ? 0 : SeasonResults.seasonTTL(ref.name, current: currentSeason)
        guard let fetched = try? await cache.get(IFSC.seasonURL(ref.id), headers: IFSC.headers, ttl: ttl,
                                                 parse: { IFSC.parseSeason($0) }) else { return nil }
        // Details already here survive a reload.
        let old = Dictionary((climbing.events[ref.name] ?? []).map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let events = SeasonResults.clocked(fetched.value).map { event in
            guard let known = old[event.id], known.detailed else { return event }
            return IFSC.withDetail(known, into: event)
        }
        climbing.events[ref.name] = events
        return (events, fetched.stale)
    }

    /// Categories, podiums and round links for a season's finished
    /// competitions: about 2 KB each, kept 30 days, revalidated by ETag.
    func loadDetails(season: String, limit: Int?, force: Bool) async {
        let finished = SeasonResults.finished(climbing.events[season] ?? []).filter { force || !$0.detailed }
        let targets = limit.map { Array(finished.prefix($0)) } ?? finished
        guard !targets.isEmpty else { return }
        let cache = self.cache
        let parsed = await withTaskGroup(of: (String, SeasonEvent?).self, returning: [String: SeasonEvent].self) { group in
            for event in targets {
                guard case let .climbing(id) = event.kind else { continue }
                let ttl = force ? 0 : SeasonResults.ttl(endedAt: event.endsAt)
                group.addTask {
                    let fetched = try? await cache.get(IFSC.eventURL(id), headers: IFSC.headers, ttl: ttl,
                                                       parse: { IFSC.parseEvent($0, into: event) })
                    return (event.id, fetched?.value)
                }
            }
            var out: [String: SeasonEvent] = [:]
            for await (id, value) in group { if let value { out[id] = value } }
            return out
        }
        guard !parsed.isEmpty, let events = climbing.events[season] else { return }
        climbing.events[season] = events.map { event in parsed[event.id].map { IFSC.withDetail($0, into: event) } ?? event }
    }

    /// One competition's detail (opening it before the batch landed).
    func loadDetail(_ id: String) async {
        guard let season = climbing.season,
              let event = climbing.events[season]?.first(where: { $0.id == id }), !event.detailed,
              case let .climbing(eventID) = event.kind else { return }
        let ttl = SeasonResults.ttl(endedAt: event.endsAt)
        guard let fetched = try? await cache.get(IFSC.eventURL(eventID), headers: IFSC.headers, ttl: ttl,
                                                 parse: { IFSC.parseEvent($0, into: event) }),
              let events = climbing.events[season] else { return }
        climbing.events[season] = events.map { $0.id == id ? IFSC.withDetail(fetched.value, into: $0) : $0 }
    }

    /// Opened in the list: your countries' best athletes per category (one
    /// full-results request per category, only with countries highlighted).
    func loadYours(_ event: SeasonEvent, countries: Set<String>) async {
        guard !countries.isEmpty, case let .climbing(eventID) = event.kind else { return }
        if !event.detailed { await loadDetail(event.id) }
        let current = climbing.current.first { $0.id == event.id } ?? event
        let ttl = SeasonResults.ttl(endedAt: event.endsAt)
        for category in current.categories {
            guard let dcat = category.dcatID else { continue }
            let key = "\(eventID)-\(dcat)"
            guard climbing.yours[key] == nil else { continue }
            guard let fetched = try? await cache.get(SeasonResults.categoryURL(event: eventID, dcat: dcat), headers: IFSC.headers,
                                                     ttl: ttl, parse: { SeasonResults.parseCategory($0) }) else { continue }
            climbing.yours[key] = SeasonResults.best(in: fetched.value, countries: countries)
        }
    }

    func toggle(_ id: String) {
        if climbing.expanded.contains(id) { climbing.expanded.remove(id) } else { climbing.expanded.insert(id) }
    }

    /// The league page opens a competition: the season page will show it
    /// open, in its own season.
    func reveal(_ id: String) {
        if let season = climbing.events.first(where: { $0.value.contains { $0.id == id } })?.key, climbing.season != season {
            climbing.season = season
        }
        climbing.expanded.insert(id)
        climbing.selected = id
    }

    /// The newest finished competitions, whichever season the page has open
    /// (the current one, or the last while nothing in it has finished).
    func latestFinished(_ count: Int) -> [SeasonEvent] {
        for name in climbing.menu {
            let finished = SeasonResults.finished(climbing.events[name] ?? [])
            if !finished.isEmpty { return Array(finished.prefix(count)) }
        }
        return Array(SeasonResults.finished(climbing.current).prefix(count))
    }

    // MARK: Category page

    func loadCategory(eventID: Int, dcatID: Int, force: Bool = false) async {
        let box = category(eventID, dcatID)
        if box.loading { return }
        box.loading = true
        defer { box.loading = false }
        // The competition: from the season list when it's there, else its own detail.
        let known = climbing.events.values.lazy.flatMap { $0 }.first { $0.kind == .climbing(eventID) && $0.detailed }
        if let known, !force {
            box.event = known
        } else {
            let ttl = force ? 0 : SeasonResults.ttl(endedAt: box.event?.endsAt ?? known?.endsAt)
            let base = known ?? box.event
            if let fetched = try? await cache.get(IFSC.eventURL(eventID), headers: IFSC.headers, ttl: ttl, parse: { data in
                if let base { return IFSC.parseEvent(data, into: base) }
                guard let event = SeasonResults.standaloneEvent(data) else { throw URLError(.cannotParseResponse) }
                return event
            }) {
                box.event = base.map { IFSC.withDetail(fetched.value, into: $0) } ?? fetched.value
            }
        }
        let ttl = force ? 0 : SeasonResults.ttl(endedAt: box.event?.endsAt)
        guard let fetched = try? await cache.get(SeasonResults.categoryURL(event: eventID, dcat: dcatID), headers: IFSC.headers,
                                                 ttl: ttl, parse: { SeasonResults.parseCategory($0) }) else {
            box.failed = box.results == nil
            return
        }
        if box.results != fetched.value { box.results = fetched.value }
        box.failed = false
        box.stale = fetched.stale
        box.updated = fetched.fetchedAt
    }

    // MARK: Tournaments

    /// The first page of finished tournaments (6 h), and any later pages
    /// already shown (30 days: they're settled).
    func loadTournaments(force: Bool = false) async {
        let box = tournaments
        if box.loading { return }
        box.loading = true
        defer { box.loading = false }
        var items: [FinishedTournament] = []
        var more = false, stale = false
        for page in 0..<max(box.pages, 1) {
            let ttl: TimeInterval = force ? 0 : page == 0 ? 6 * 3600 : 30 * 86_400
            guard let fetched = try? await cache.get(SeasonResults.finishedURL(page: page), ttl: ttl,
                                                     parse: { SeasonResults.parseFinished($0) }) else {
                if page == 0 { box.failed = box.items.isEmpty; return }
                break
            }
            items += fetched.value.items
            more = (page + 1) * SeasonResults.pageSize < fetched.value.total
            stale = stale || fetched.stale
        }
        apply(items, pages: max(box.pages, 1), more: more, stale: stale)
    }

    /// "Show Earlier": the next six.
    func loadMoreTournaments() async {
        let box = tournaments
        guard !box.loading, box.more else { return }
        box.loading = true
        defer { box.loading = false }
        guard let fetched = try? await cache.get(SeasonResults.finishedURL(page: box.pages), ttl: 30 * 86_400,
                                                 parse: { SeasonResults.parseFinished($0) }) else { return }
        apply(box.items + fetched.value.items, pages: box.pages + 1,
              more: (box.pages + 1) * SeasonResults.pageSize < fetched.value.total, stale: box.stale || fetched.stale)
    }

    private func apply(_ items: [FinishedTournament], pages: Int, more: Bool, stale: Bool) {
        let box = tournaments
        var seen = Set<String>()
        let unique = items.filter { seen.insert($0.id).inserted }
        if box.items != unique { box.items = unique }
        box.pages = pages
        box.more = more
        box.stale = stale
        box.failed = false
        box.updated = .now
    }

    // MARK: Tournament page

    func loadTournament(slug: String, force: Bool = false) async {
        let box = tournament(slug)
        if box.loading { return }
        box.loading = true
        defer { box.loading = false }
        typealias S = SeasonResults
        if let known = tournaments.items.first(where: { $0.slug == slug }), !force {
            box.tournament = known
        } else if let fetched = try? await cache.get(S.slugURL(slug), ttl: force ? 0 : 6 * 3600, parse: { S.parseFinished($0) }),
                  let found = fetched.value.items.first {
            box.tournament = found
        }
        guard let tournament = box.tournament else {
            box.failed = true
            return
        }
        let ttl = force ? 0 : S.ttl(endedAt: tournament.event.endsAt)
        // Every match (bo3.gg pages at 100), then the stages that name the rounds.
        var all = TournamentMatches(items: [], stage: [:], round: [:], total: 0)
        var offset = 0, stale = false, fetchedAt: Date?
        repeat {
            guard let page = try? await cache.get(S.tournamentMatchesURL(tournament.bo3ID, offset: offset), ttl: ttl,
                                                  parse: { S.parseTournamentMatches($0) }) else {
                if offset == 0 { box.failed = box.groups.isEmpty; return }
                break
            }
            all.items += page.value.items
            all.stage.merge(page.value.stage) { a, _ in a }
            all.round.merge(page.value.round) { a, _ in a }
            all.total = page.value.total
            stale = stale || page.stale
            fetchedAt = fetchedAt ?? page.fetchedAt
            offset += 100
        } while offset < all.total && offset < 1000
        let stageIDs = Array(Set(all.stage.values)).sorted()
        let cache = self.cache
        let stages = await withTaskGroup(of: StageInfo?.self, returning: [StageInfo].self) { group in
            for id in stageIDs {
                group.addTask {
                    (try? await cache.get(S.stageURL(id), ttl: ttl, parse: { data in
                        guard let stage = S.parseStage(data) else { throw URLError(.cannotParseResponse) }
                        return stage
                    }))?.value
                }
            }
            var out: [StageInfo] = []
            for await stage in group { if let stage { out.append(stage) } }
            return out
        }
        let groups = S.groups(all, stages: stages, tournament: tournament.event.name)
        if box.groups != groups { box.groups = groups }
        box.matches = all.items.count
        box.final = S.finalLine(tournament, groups: groups)
        box.failed = false
        box.stale = stale
        box.updated = fetchedAt ?? .now
    }

    // MARK: League page

    func loadFollowed(teamIDs: [Int], force: Bool = false) async {
        guard !teamIDs.isEmpty else {
            followed.items = []
            followed.loaded = true
            return
        }
        // The team pages' history request (R1's), for all followed teams at once:
        // one team's is the very entry its team page reads.
        let url = CSHistory.url(teamIDs: teamIDs.sorted(), page: 0)
        if let fetched = try? await cache.get(url, ttl: force ? 0 : 30 * 60, parse: { CSHistory.parse($0) }) {
            if followed.items != fetched.value { followed.items = fetched.value }
        }
        followed.loaded = true
    }

    #if DEBUG
    /// Render harness: a store whose climbing season is already chosen.
    func seedClimbing(menu: [String], season: String, events: [String: [SeasonEvent]]) {
        climbing.menu = menu
        climbing.season = season
        climbing.events = events
        climbing.updated = .now
    }
    #endif
}

// MARK: - Environment

private struct SeasonResultsStoreKey: EnvironmentKey {
    static let defaultValue: SeasonResultsStore? = nil
}

extension EnvironmentValues {
    /// The render harness and tests inject one; the app's pages use the shared store.
    var seasonResultsStore: SeasonResultsStore? {
        get { self[SeasonResultsStoreKey.self] }
        set { self[SeasonResultsStoreKey.self] = newValue }
    }
}
