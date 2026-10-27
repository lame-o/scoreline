import Foundation

/// Where schedules come from. Every parser is a pure function over the
/// response bytes (tests replay recordings through them directly); fetching
/// goes through `ScheduleCache`. Findings behind each rule: specs/schedules.md §1.
enum ScheduleProvider {}

// MARK: - ESPN

extension ScheduleProvider {
    enum ESPN {
        static let base = "https://site.api.espn.com/apis/site/v2/sports"

        /// What a scoreboard request covers. There's deliberately no range:
        /// ESPN answers every `dates=A-B` with a 400.
        enum Window: Hashable, Sendable {
            case day(DayKey)
            case month(year: Int, month: Int)
            case week(Int, seasonType: Int)
            case undated
        }

        /// Soccer leagues whose far-off kickoffs are placeholders until the TV picks.
        static let provisionalLeagues: Set<String> = ["eng.1", "eng.2"]
        static let provisionalHorizon: TimeInterval = 42 * 86_400

        static func scoreboardURL(path: String, window: Window) -> URL {
            var items: [String] = []
            switch window {
            case let .day(day): items.append("dates=\(day.compact)")
            case let .month(year, month): items += [String(format: "dates=%04d%02d", year, month), "limit=500"]
            case let .week(n, type): items += ["week=\(n)", "seasontype=\(type)"]
            case .undated: break
            }
            // College: every FBS game, as the scores list fetches them.
            if path.hasSuffix("college-football") { items.append("groups=80") }
            let query = items.isEmpty ? "" : "?" + items.joined(separator: "&")
            return URL(string: "\(base)/\(path)/scoreboard\(query)")!
        }

        /// A team's season. Soccer: `soccer/all` covers every competition, and
        /// only `fixture=true` returns what's still to come. Throws rather than
        /// crashing on an ID the server sent malformed.
        static func teamURL(path: String, team: String, fixtures: Bool = false, season: Int? = nil) throws -> URL {
            var items: [String] = []
            if fixtures { items.append("fixture=true") }
            if let season { items += ["season=\(season)", "seasontype=2"] }
            let query = items.isEmpty ? "" : "?" + items.joined(separator: "&")
            return try URL.api("\(base)/\(path)/teams/\(team)/schedule\(query)")
        }

        /// Months touching the days from `from` through `to` (ESPN months are Eastern).
        /// The Eastern day boards covering the viewer's days `from…to`. Games
        /// are listed on Eastern days, so a viewer ahead of New York also needs
        /// the evening before, one behind it the day after. Days the league's
        /// calendar doesn't list have no games, so they cost no request.
        static func boardDays(from: DayKey, to: DayKey, calendar: ScheduleCalendar? = nil, zone: TimeZone = .current,
                              at date: Date = .now) -> [DayKey] {
            let offset = zone.secondsFromGMT(for: date) - DayKey.eastern.secondsFromGMT(for: date)
            let before = offset > 0 ? -1 : 0, after = offset < 0 ? 1 : 0
            let days = (before...(from.days(to: to) + after)).map { from.adding(days: $0) }
            // Unknown (no calendar, or one that can't say): ask for the day.
            return days.filter { calendar?.plays(on: $0) ?? true }
        }

        static func months(from: DayKey, to: DayKey) -> [Window] {
            var out: [Window] = []
            var y = from.year, m = from.month
            while (y, m) <= (to.year, to.month) {
                out.append(.month(year: y, month: m))
                m += 1
                if m > 12 { m = 1; y += 1 }
            }
            return out
        }

        // MARK: Parsing

        struct TeamSchedule: Codable, Sendable {
            var items: [ScheduleItem]
            /// "5–0 · 1st in AFC West"
            var summary: String?
            var byeWeek: Int?
            /// The season type ESPN answered with (3: the postseason, whose
            /// default schedule leaves the regular season out).
            var seasonType: Int? = nil
        }

        static func parseScoreboard(_ data: Data, path: String, league: String, sport: Sport,
                                    now: Date = .now, zone: TimeZone = .current) -> [ScheduleItem] {
            let board = JSON(data: data)
            let week = board["week"]["number"].int
            return board["events"].array.compactMap {
                item($0, path: path, league: league, sport: sport, week: week, now: now, zone: zone)
            }
        }

        static func parseTeamSchedule(_ data: Data, path: String, league: String, sport: Sport,
                                      now: Date = .now, zone: TimeZone = .current) -> TeamSchedule {
            let json = JSON(data: data)
            let items = json["events"].array.compactMap {
                item($0, path: path, league: league, sport: sport, week: nil, now: now, zone: zone)
            }
            let team = json["team"]
            let summary = [team["recordSummary"].string?.replacingOccurrences(of: "-", with: "–"), team["standingSummary"].string]
                .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
            return TeamSchedule(items: items, summary: summary.isEmpty ? nil : summary, byeWeek: json["byeWeek"].int,
                                seasonType: json["requestedSeason"]["type"].int)
        }

        /// The scoreboard's season calendar: game days, or weeks.
        static func parseCalendar(_ data: Data) -> ScheduleCalendar {
            let league = JSON(data: data)["leagues"][0]
            var calendar = ScheduleCalendar()
            let entries = league["calendar"].array
            if league["calendarType"].string == "list" {
                for section in entries {
                    let type = Int(section["value"].string ?? "") ?? section["value"].int ?? 2
                    for e in section["entries"].array {
                        guard let start = DateParser.parse(e["startDate"].string), let end = DateParser.parse(e["endDate"].string)
                        else { continue }
                        calendar.weeks.append(.init(label: e["label"].string ?? "", detail: e["detail"].string ?? "",
                                                    number: Int(e["value"].string ?? "") ?? e["value"].int ?? 0,
                                                    seasonType: type, start: start, end: end))
                    }
                }
            } else {
                // Each date is stamped at US Pacific midnight: only the date part means anything.
                let listed = entries.compactMap { DayKey(iso: $0.string) }
                if league["calendarIsWhitelist"].bool == false {
                    // MLB: the days *without* games, between the season's first and last.
                    let pacific = TimeZone(identifier: "America/Los_Angeles")!
                    calendar.offDays = listed
                    calendar.seasonStart = DateParser.parse(league["calendarStartDate"].string).map { DayKey.of($0, in: pacific) }
                    calendar.seasonEnd = DateParser.parse(league["calendarEndDate"].string).map { DayKey.of($0, in: pacific) }
                } else {
                    calendar.days = listed
                }
            }
            return calendar
        }

        /// NFL: the week's byes ("Titans").
        static func parseByes(_ data: Data) -> [String] {
            JSON(data: data)["week"]["teamsOnBye"].array.compactMap { $0["shortDisplayName"].string ?? $0["displayName"].string }
        }

        static func item(_ e: JSON, path: String, league: String, sport: Sport, week: Int?,
                         now: Date, zone: TimeZone) -> ScheduleItem? {
            let c = e["competitions"][0]
            guard let rawID = e["id"].string, let date = DateParser.parse(e["date"].string) else { return nil }
            let comps = c["competitors"].array
            guard let home = comps.first(where: { $0["homeAway"].string == "home" }),
                  let away = comps.first(where: { $0["homeAway"].string == "away" }) else { return nil }

            // soccer/all lists every competition: each fixture says which.
            var leagueID = league
            var competition: String?
            if e["league"]["slug"].exists {
                let slug = e["league"]["slug"].string ?? league
                leagueID = League.with(id: slug)?.id ?? slug
                var parts = [e["league"]["abbreviation"].string ?? e["league"]["name"].string]
                // Stages read "Fourth Round", "League Phase"; a season label ("2026-27 …") says nothing.
                if let stage = e["seasonType"]["name"].string, !stage.contains("20") { parts.append(stage) }
                competition = parts.compactMap { $0 }.joined(separator: " · ")
            }

            let timeValid = c["timeValid"].bool ?? e["timeValid"].bool ?? true
            let soccer = sport == .soccer
            let day = timeValid ? DayKey.of(date, in: zone) : DayKey.of(date, in: DayKey.eastern)
            let start: StartTime
            if !timeValid {
                start = soccer ? .tbc : .tba
            } else if provisionalLeagues.contains(leagueID), date.timeIntervalSince(now) > provisionalHorizon {
                start = .provisional(date, .tvPicks)
            } else {
                start = .exact(date)
            }

            let type = c["status"]["type"].exists ? c["status"]["type"] : e["status"]["type"]
            let name = type["name"].string ?? ""
            let status: ScheduleStatus
            switch (type["state"].string, name) {
            case ("in", _): status = .live
            case (_, "STATUS_POSTPONED"): status = .postponed
            case (_, "STATUS_CANCELED"), (_, "STATUS_CANCELLED"): status = .canceled
            // Results whatever `completed` says: the score at the time, or awarded.
            case (_, "STATUS_ABANDONED"): status = .final
            case (_, let n) where ResultParse.isAwarded(n): status = .final
            // Suspended: not completed, but the score stands (it resumes from there).
            case ("post", _): status = type["completed"].bool == false && name != "STATUS_SUSPENDED" ? .postponed : .final
            default: status = .scheduled
            }

            func team(_ comp: JSON) -> ScheduleTeam {
                let t = comp["team"]
                let display = t["shortDisplayName"].string ?? t["displayName"].string ?? "TBD"
                let logo = t["logo"].string ?? t["logos"][0]["href"].string
                let score = comp["score"].string ?? comp["score"]["displayValue"].string
                let record = comp["records"].array.first { $0["type"].string == "total" }?["summary"].string
                    ?? comp["record"].array.first { $0["type"].string == "total" }?["displayValue"].string
                return ScheduleTeam(id: t["id"].string.map { ESPNTeamID.make(path: path, sport: sport, team: $0) },
                                    name: display, abbreviation: t["abbreviation"].string ?? String(display.prefix(3)).uppercased(),
                                    logo: logo.flatMap(URL.init(string:)), record: record,
                                    rank: comp["curatedRank"]["current"].int.flatMap { (1...25).contains($0) ? $0 : nil },
                                    score: status == .live || status == .final ? score : nil,
                                    winner: comp["winner"].bool ?? false)
            }

            // Notes, rewritten; the MLB postseason adds the series standing.
            let headlines = c["notes"].array.compactMap { $0["headline"].string }.filter { !$0.isEmpty }
            let ifNecessary = headlines.contains { $0.localizedCaseInsensitiveContains("if necessary") }
            var notes = headlines.map { caption($0, near: date) }
            let postseason = e["season"]["slug"].string == "post-season" || e["seasonType"]["type"].int == 3
            if postseason, status != .postponed, status != .canceled, let series = c["series"]["summary"].string, !notes.isEmpty {
                notes[notes.count - 1] += " · " + MLBPostseason.shortSummary(series)
            }

            let venueName = c["venue"]["fullName"].string
            let city = c["venue"]["address"]["city"].string
            let venue = [venueName, city.flatMap { name in venueName?.localizedCaseInsensitiveContains(name) == true ? nil : name }]
                .compactMap { $0 }.joined(separator: " · ")

            let link = e["links"].array.first { $0["rel"].array.contains { $0.string == "summary" } }?["href"].string
                ?? e["links"][0]["href"].string

            // Results: scorers, decisions, performers, context; the winner
            // follows the score on the pitch, not ESPN's tie winner.
            var top = team(soccer ? home : away), bottom = team(soccer ? away : home)
            let result = ResultParse.espn(e, competition: c, sport: sport, top: soccer ? home : away, bottom: soccer ? away : home,
                                          status: status, notes: notes)
            ResultParse.settle(&top, &bottom, result: result)

            return ScheduleItem(
                id: "espn-\(rawID)", sportRaw: sport.rawValue, league: leagueID, competition: competition, day: day,
                start: start, status: status,
                statusDetail: status == .live || status == .final ? type["shortDetail"].string : nil,
                top: top, bottom: bottom,
                venue: venue.isEmpty ? nil : venue, networks: networks(c), notes: notes, ifNecessary: ifNecessary,
                week: week ?? e["week"]["number"].int, link: link.flatMap(URL.init(string:)),
                ref: .espn(path: path, id: rawID), result: result)
        }

        /// National networks first (up to three), from either response shape.
        static func networks(_ c: JSON) -> [String] {
            var national: [String] = [], other: [String] = []
            for b in c["broadcasts"].array {
                if b["names"].exists {
                    // Scoreboard: {market: "national", names: […]}
                    let names = b["names"].array.compactMap(\.string)
                    if b["market"].string == "national" { national += names } else { other += names }
                } else if let name = b["media"]["shortName"].string {
                    // Team schedule: {market: {type: "National"}, media: {shortName}}
                    let market = b["market"]["type"].string?.lowercased()
                    if market == nil || market == "national" { national.append(name) } else { other.append(name) }
                }
            }
            let names = national.isEmpty ? Array(other.prefix(1)) : national
            var seen = Set<String>()
            return names.map { Broadcaster(name: $0, type: nil).name }.filter { seen.insert($0).inserted }.prefix(3).map { $0 }
        }

        /// ESPN's notes, in the app's voice:
        /// "World Series - Game 5 If Necessary" → "World Series · Game 5 · If necessary";
        /// "ALCS - Game 4 Rain - Makeup on Oct 18" → "ALCS · Game 4 · Rain, makeup Oct 18";
        /// "Flex Game: 1/2 or 1/3" → "Flex game: Sat, Jan 2 or Sun, Jan 3".
        static func caption(_ headline: String, near date: Date) -> String {
            if headline.hasPrefix("Flex Game:") {
                let days = headline.dropFirst("Flex Game:".count).components(separatedBy: " or ").compactMap { flexDay($0, near: date) }
                return days.isEmpty ? "Flex game" : "Flex game: " + days.joined(separator: " or ")
            }
            var text = headline
            if let range = text.range(of: #"(\w+) - Makeup on (.+)$"#, options: .regularExpression) {
                let tail = String(text[range])
                let reason = tail.components(separatedBy: " - ").first ?? ""
                let when = tail.components(separatedBy: "Makeup on ").last ?? ""
                text = text.replacingCharacters(in: range, with: "· \(reason), makeup \(when)")
            }
            text = text.replacingOccurrences(of: " If Necessary", with: " · If necessary", options: .caseInsensitive)
            return text.replacingOccurrences(of: " - ", with: " · ")
        }

        /// "1/2" near a January date → "Sat, Jan 2".
        private static func flexDay(_ text: String, near date: Date) -> String? {
            let parts = text.trimmingCharacters(in: .whitespaces).split(separator: "/").compactMap { Int($0) }
            guard parts.count == 2 else { return nil }
            let anchor = DayKey.of(date, in: DayKey.eastern)
            // The year that puts the date closest to the game's listed date.
            let candidates = [anchor.year - 1, anchor.year, anchor.year + 1].map { DayKey(year: $0, month: parts[0], day: parts[1]) }
            guard let day = candidates.min(by: { abs(anchor.days(to: $0)) < abs(anchor.days(to: $1)) }) else { return nil }
            return day.mediumLabel
        }

        /// The league a followed team's ID belongs to, and its ESPN path.
        static func teamSource(_ id: String) -> (path: String, league: String, sport: Sport, team: String)? {
            let prefixes: [(String, String, String, Sport)] = [
                ("espn-ncaaf-", "football/college-football", "college-football", .football),
                ("espn-football-", "football/nfl", "nfl", .football),
                ("espn-baseball-", "baseball/mlb", "mlb", .baseball),
                ("espn-basketball-", "basketball/nba", "nba", .basketball),
                ("espn-soccer-", "soccer/all", "soccer", .soccer),
            ]
            for (prefix, path, league, sport) in prefixes where id.hasPrefix(prefix) {
                return (path, league, sport, String(id.dropFirst(prefix.count)))
            }
            return nil
        }
    }
}

// MARK: - IFSC (climbing seasons)

extension ScheduleProvider {
    enum IFSC {
        static let base = "https://ifsc.results.info"
        static let headers = ["Referer": "https://ifsc.results.info/"]
        static let rootURL = URL(string: "\(base)/api/v1/")!

        struct SeasonRef: Hashable, Codable, Sendable {
            let id: Int
            let name: String
        }

        static func seasonURL(_ id: Int) -> URL { URL(string: "\(base)/api/v1/seasons/\(id)")! }
        static func eventURL(_ id: Int) -> URL { URL(string: "\(base)/api/v1/events/\(id)")! }
        static func registrationsURL(_ id: Int) -> URL { URL(string: "\(base)/api/v1/events/\(id)/registrations")! }

        /// Seasons are addressed by ID, not year (`/seasons/2026` is a 404):
        /// the root lists them all and says which is current.
        static func seasons(root data: Data) -> (current: SeasonRef?, all: [SeasonRef]) {
            let json = JSON(data: data)
            let all = json["seasons"].array.compactMap { s -> SeasonRef? in
                guard let id = s["id"].int, let name = s["name"].string else { return nil }
                return SeasonRef(id: id, name: name)
            }.sorted { $0.name < $1.name }
            let current = json["current"]["id"].int.flatMap { id in all.first { $0.id == id } }
                ?? json["current"]["season"].string.flatMap { name in all.first { $0.name == name } }
            return (current, all)
        }

        /// The current season and the one after it (by name), when published.
        static func currentAndNext(_ seasons: (current: SeasonRef?, all: [SeasonRef])) -> [SeasonRef] {
            guard let current = seasons.current else { return Array(seasons.all.suffix(2)) }
            let next = Int(current.name).flatMap { year in seasons.all.first { $0.name == String(year + 1) } }
            return [current] + [next].compactMap { $0 }
        }

        /// World Cups and the World Championships (plus the Olympics), without
        /// cancelled, youth, continental or para events.
        static func parseSeason(_ data: Data, now: Date = .now) -> [SeasonEvent] {
            let json = JSON(data: data)
            // A season's leagues carry only a name and a URL; the ID is the URL's last part.
            var worldCup = Set<Int>(), games = Set<Int>()
            for league in json["leagues"].array {
                guard let name = league["name"].string, let id = league["url"].string?.split(separator: "/").last.flatMap({ Int($0) })
                else { continue }
                if name.hasPrefix("World Cups") { worldCup.insert(id) }
                if name == "Games" { games.insert(id) }
            }
            return json["events"].array.compactMap { e -> SeasonEvent? in
                guard let id = e["event_id"].int, let name = e["event"].string,
                      let leagueSeason = e["league_season_id"].int else { return nil }
                let olympic = games.contains(leagueSeason) && name.contains("Olympic Games")
                guard worldCup.contains(leagueSeason) || olympic,
                      !name.localizedCaseInsensitiveContains("cancelled"),
                      e["is_paraclimbing_event"].bool != true,
                      let first = DayKey(iso: e["local_start_date"].string), let last = DayKey(iso: e["local_end_date"].string)
                else { return nil }
                let startsAt = DateParser.parse(e["starts_at"].string)
                let endsAt = DateParser.parse(e["ends_at"].string)
                let kinds = e["disciplines"].array.compactMap { $0["kind"].string }
                var lanes: [String] = []
                for kind in kinds {
                    let mapped: [String] = switch kind {
                    case "speed_relay": ["speed"]
                    case "boulder&lead", "combined": ["boulder", "lead"]
                    default: [kind]
                    }
                    for lane in mapped where !lanes.contains(lane) { lanes.append(lane) }
                }
                let badge: String? = olympic ? "Olympic Games" : name.contains("Championship") ? "World Championships" : nil
                return SeasonEvent(
                    id: "ifsc-\(id)", kind: .climbing(id), name: name, shortName: shortName(name),
                    place: e["location"].string, countryCode: Flag.iso(ioc: e["country"].string),
                    startDay: first, endDay: last, startsAt: startsAt, endsAt: endsAt,
                    timeZone: e["timezone"]["value"].string, lanes: lanes, badge: badge,
                    status: status(startsAt: startsAt, endsAt: endsAt, now: now),
                    link: URL(string: "\(base)/event/\(id)"),
                    infoSheet: e["infosheet_url"].string.flatMap(URL.init(string:)))
            }.sorted { $0.startDay < $1.startDay }
        }

        static func status(startsAt: Date?, endsAt: Date?, now: Date) -> SeasonEvent.Status {
            guard let startsAt, let endsAt else { return .upcoming }
            if now < startsAt { return .upcoming }
            return now <= endsAt ? .live : .finished
        }

        /// The competition still to come (or underway) soonest.
        static func next(in events: [SeasonEvent], now: Date = .now) -> SeasonEvent? {
            events.filter { ($0.endsAt ?? $0.endDay.start(in: .current)) > now }.min { $0.startDay < $1.startDay }
        }

        /// Categories, rounds (same-named rounds of one discipline merge:
        /// "Lead semi-final · Men, Women") and podiums, from `/events/{id}`.
        static func parseEvent(_ data: Data, into event: SeasonEvent) -> SeasonEvent {
            var event = event
            let json = JSON(data: data)
            var rounds: [ClimbingRound] = []
            var categories: [SeasonEvent.Category] = []
            for cat in json["d_cats"].array {
                let raw = cat["dcat_name"].string ?? ""                 // "LEAD Women"
                let parts = raw.split(separator: " ", maxSplits: 1).map(String.init)
                let discipline = (parts.first ?? raw).capitalized       // "Lead"
                let gender = parts.count > 1 ? parts[1] : ""            // "Women"
                let podium = cat["top_3_results"].array.compactMap { a -> String? in
                    guard let last = a["lastname"].string else { return nil }
                    return [a["country"].string, last.capitalized].compactMap { $0 }.joined(separator: " ")
                }
                // Results: the category's ID (its full results), its rounds
                // (each opens the match page) and the podium with athlete IDs.
                let links = cat["category_rounds"].array.compactMap { r -> SeasonEvent.RoundLink? in
                    guard let id = r["category_round_id"].int else { return nil }
                    return .init(id: id, name: r["name"].string ?? "Round", status: r["status"].string ?? "pending",
                                 resultPath: r["result_url"].string)
                }
                let athletes = cat["top_3_results"].array.compactMap { a -> SeasonEvent.PodiumAthlete? in
                    guard let id = a["athlete_id"].int, let rank = a["rank"].int, let last = a["lastname"].string else { return nil }
                    return .init(athleteID: id, rank: rank, first: a["firstname"].string ?? "", last: last.capitalized,
                                 country: a["country"].string)
                }
                categories.append(.init(name: "\(discipline) \(gender)".trimmingCharacters(in: .whitespaces), podium: podium,
                                        dcatID: cat["dcat_id"].int, rounds: links, podiumAthletes: athletes))
                for r in cat["category_rounds"].array {
                    let name = r["name"].string ?? "Round"
                    let status = r["status"].string ?? "pending"
                    if let i = rounds.firstIndex(where: { $0.discipline == discipline && $0.name == name }) {
                        if !gender.isEmpty, !rounds[i].categories.contains(gender) { rounds[i].categories.append(gender) }
                        if status == "active" || (status == "finished" && rounds[i].status == "pending") { rounds[i].status = status }
                    } else {
                        rounds.append(ClimbingRound(name: name, discipline: discipline, categories: gender.isEmpty ? [] : [gender],
                                                status: status))
                    }
                }
            }
            let order = ["qualification": 0, "semi-final": 1, "final": 2]
            event.rounds = rounds.enumerated().sorted { a, b in
                let ra = order[a.element.name.lowercased()] ?? 1, rb = order[b.element.name.lowercased()] ?? 1
                return ra != rb ? ra < rb : a.offset < b.offset
            }.map(\.element)
            event.categories = categories
            event.detailed = true
            if let sheet = json["infosheet_url"].string { event.infoSheet = URL(string: sheet) }
            return event
        }

        /// The detail `parseEvent` adds (parsed off the main thread, in the
        /// cache), copied onto the competition as it is now.
        static func withDetail(_ parsed: SeasonEvent, into event: SeasonEvent) -> SeasonEvent {
            var event = event
            event.rounds = parsed.rounds
            event.categories = parsed.categories
            event.infoSheet = parsed.infoSheet ?? event.infoSheet
            event.detailed = true
            return event
        }

        /// Confirmed athletes per highlighted country (IOC codes).
        static func parseRegistrations(_ data: Data, countries: Set<String>) -> [String: Int] {
            var counts: [String: Int] = [:]
            for athlete in JSON(data: data).array {
                guard let country = athlete["country"].string, countries.contains(country),
                      athlete["d_cats"].array.contains(where: { $0["status"].string == "confirmed" }) else { continue }
                counts[country, default: 0] += 1
            }
            return counts
        }

        /// The scores list's climbing row when the season is over: the next
        /// season's first competition (2027 opens in Tokyo on Apr 9).
        static func nextSeasonOpener(now: Date = .now, cache: ScheduleCache = .shared) async -> Event? {
            guard let list = try? await cache.get(rootURL, headers: headers, ttl: 12 * 3600, parse: { data in
                let s = seasons(root: data)
                return ScheduleStore.SeasonList(current: s.current, all: s.all)
            }).value else { return nil }
            var events: [SeasonEvent] = []
            for season in currentAndNext((list.current, list.all)) {
                if let fetched = try? await cache.get(seasonURL(season.id), headers: headers, ttl: 12 * 3600,
                                                      parse: { parseSeason($0) }) {
                    events += fetched.value
                }
            }
            return opener(in: events, now: now).map(openerEvent)
        }

        /// The first competition that hasn't started, if every one before it is over.
        static func opener(in events: [SeasonEvent], now: Date) -> SeasonEvent? {
            let live = events.contains { ($0.startsAt ?? .distantFuture) <= now && now <= ($0.endsAt ?? .distantPast) }
            guard !live else { return nil }
            return events.filter { ($0.startsAt ?? $0.startDay.start(in: .current)) > now }.min { $0.startDay < $1.startDay }
        }

        /// A whole upcoming competition as the scores list shows one: its
        /// name and place, its venue dates and disciplines. It starts at local
        /// midnight of its first (venue) day, so the day the row names is right.
        static func openerEvent(_ event: SeasonEvent) -> Event {
            guard case let .climbing(id) = event.kind else { preconditionFailure("not a climbing event") }
            let title = "\(event.shortName) \(event.startDay.year)"
            let caption = [event.badge ?? "Season opener", DayKey.range(event.startDay, event.endDay),
                           event.lanes.map(\.capitalized).joined(separator: " · ")].filter { !$0.isEmpty }
            return Event(
                id: "ifsc-\(id)",
                content: .field(title: title, summary: event.place ?? ""),
                state: .scheduled,
                start: event.startDay.start(in: .current),
                detail: nil,
                caption: caption.joined(separator: " · "),
                link: event.link,
                ref: .climbing(eventID: id, category: "", resultURL: nil, round: nil, eventName: title, nextURL: nil))
        }

        /// "World Climbing Series Tokyo 2027" → "Tokyo";
        /// "World Climbing Championship Brno 2027" → "Brno"; "Olympic Games LA28" → "LA28".
        static func shortName(_ name: String) -> String {
            var s = name
            for prefix in ["World Climbing Series ", "IFSC World Cup ", "World Climbing Championship ", "IFSC Climbing World Championships ",
                           "IFSC ", "Olympic Games ", "World Climbing "] where s.hasPrefix(prefix) {
                s = String(s.dropFirst(prefix.count))
                break
            }
            if let last = s.split(separator: " ").last, last.count == 4, Int(last) != nil {
                s = String(s.dropLast(5))
            }
            return s.isEmpty ? name : s
        }
    }
}

// MARK: - World Climbing streams (round times)

extension ScheduleProvider {
    enum Streams {
        static let url = URL(string: "https://www.youtube.com/@WorldClimbing/streams")!
        /// The page renders "Scheduled for …" in a zone of YouTube's choosing;
        /// this cookie pins it to UTC.
        static let headers = [
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
            "Accept-Language": "en-US",
            "Cookie": "PREF=tz=UTC&hl=en&gl=US",
        ]

        struct Slot: Hashable, Codable, Sendable {
            let videoID: String
            /// "Lead semi-finals | Santiago 2026"
            let title: String
            let start: Date
            var url: URL { URL(string: "https://www.youtube.com/watch?v=\(videoID)")! }
        }

        private static let scheduledFormat: DateFormatter = {
            let f = DateFormatter()
            f.locale = Locale(identifier: "en_US_POSIX")
            f.timeZone = DayKey.utc
            f.dateFormat = "M/d/yy, h:mm a"
            return f
        }()

        /// "Scheduled for 10/29/26, 10:45 AM" (with a narrow no-break space) → a UTC date.
        static func scheduledDate(_ text: String) -> Date? {
            guard text.hasPrefix("Scheduled for ") else { return nil }
            let clean = text.dropFirst("Scheduled for ".count)
                .replacingOccurrences(of: "\u{202F}", with: " ").replacingOccurrences(of: "\u{00A0}", with: " ")
            return scheduledFormat.date(from: clean)
        }

        /// Every scheduled stream on the channel's Live tab.
        static func parse(html: String) -> [Slot] {
            guard let start = html.range(of: "var ytInitialData = "),
                  let end = html.range(of: ";</script>", range: start.upperBound..<html.endIndex),
                  let data = String(html[start.upperBound..<end.lowerBound]).data(using: .utf8),
                  let root = try? JSONSerialization.jsonObject(with: data) else { return [] }
            var slots: [Slot] = []
            func texts(_ node: Any, into out: inout [String]) {
                if let dict = node as? [String: Any] {
                    if let content = dict["content"] as? String { out.append(content) }
                    for value in dict.values { texts(value, into: &out) }
                } else if let array = node as? [Any] {
                    for value in array { texts(value, into: &out) }
                }
            }
            func walk(_ node: Any) {
                if let dict = node as? [String: Any] {
                    if let lockup = dict["lockupViewModel"] as? [String: Any], let id = lockup["contentId"] as? String {
                        var found: [String] = []
                        texts(lockup, into: &found)
                        if let title = titleText(lockup) ?? found.first,
                           let date = found.lazy.compactMap(scheduledDate).first {
                            slots.append(Slot(videoID: id, title: title, start: date))
                        }
                        return
                    }
                    for value in dict.values { walk(value) }
                } else if let array = node as? [Any] {
                    for value in array { walk(value) }
                }
            }
            walk(root)
            var seen = Set<String>()
            return slots.filter { seen.insert($0.videoID).inserted }.sorted { $0.start < $1.start }
        }

        /// The lockup's title (metadata.lockupMetadataViewModel.title.content).
        private static func titleText(_ lockup: [String: Any]) -> String? {
            let metadata = (lockup["metadata"] as? [String: Any])?["lockupMetadataViewModel"] as? [String: Any]
            return (metadata?["title"] as? [String: Any])?["content"] as? String
        }

        /// Gives each round the stream that covers it ("Lead semi-finals |
        /// Santiago 2026" covers the men's and the women's semi-final).
        static func attach(_ slots: [Slot], to event: SeasonEvent) -> SeasonEvent {
            var event = event
            let name = "\(event.shortName) \(event.startDay.year)"
            for i in event.rounds.indices {
                let round = event.rounds[i]
                let category = "\(round.discipline) \(round.categories.first ?? "")"
                if let slot = slots.last(where: { slot in
                    ClimbingBroadcast(url: slot.url, title: slot.title, isLive: false, start: slot.start)
                        .covers(category: category, round: round.name, eventName: name)
                }) {
                    event.rounds[i].start = .exact(slot.start)
                    event.rounds[i].stream = slot.url
                }
            }
            return event
        }
    }
}

// MARK: - bo3.gg (CS2 tournaments and matches)

extension ScheduleProvider {
    enum CS {
        static let api = "https://api.bo3.gg/api/v1"

        static func tournamentsURL(status: String) -> URL {
            var c = URLComponents(string: "\(api)/tournaments")!
            c.queryItems = [
                .init(name: "filter[tournaments.discipline_id][eq]", value: "1"),
                .init(name: "filter[tournaments.status][in]", value: status),
                .init(name: "filter[tournaments.tier][in]", value: CounterStrike.tier),
                .init(name: "sort", value: "start_date"),
                .init(name: "page[limit]", value: "50"),
            ]
            return c.url!
        }

        /// Throws rather than crashing on a slug the server sent malformed.
        static func tournamentURL(slug: String) throws -> URL { try URL.api("\(api)/tournaments/\(slug)") }

        /// Upcoming and live matches for several teams at once (either side).
        static func teamMatchesURL(teamIDs: [Int]) -> URL {
            var c = URLComponents(string: "\(api)/matches")!
            c.queryItems = [
                .init(name: "filter[matches.discipline_id][eq]", value: "1"),
                .init(name: "filter[matches.status][in]", value: "upcoming,current"),
                .init(name: "filter[matches.team_ids][overlap]", value: teamIDs.map(String.init).joined(separator: ",")),
                .init(name: "filter[matches.tier][in]", value: CounterStrike.tier),
                .init(name: "sort", value: "start_date"),
                .init(name: "page[limit]", value: "30"),
                .init(name: "with", value: "teams,tournament"),
            ]
            return c.url!
        }

        /// Matches between two instants (the All scope's week).
        static func matchesURL(from: Date, to: Date) -> URL {
            var c = URLComponents(string: "\(api)/matches")!
            let iso = ISO8601DateFormatter()
            c.queryItems = [
                .init(name: "filter[matches.discipline_id][eq]", value: "1"),
                .init(name: "filter[matches.status][in]", value: "upcoming,current,finished"),
                .init(name: "filter[matches.tier][in]", value: CounterStrike.tier),
                .init(name: "filter[matches.start_date][gte]", value: iso.string(from: from)),
                .init(name: "filter[matches.start_date][lte]", value: iso.string(from: to)),
                .init(name: "sort", value: "start_date"),
                .init(name: "page[limit]", value: "100"),
                .init(name: "with", value: "teams,tournament"),
            ]
            return c.url!
        }

        static func parseTournaments(_ data: Data) -> [SeasonEvent] {
            JSON(data: data)["results"].array.compactMap(tournament)
        }

        static func tournament(_ t: JSON) -> SeasonEvent? {
            guard let slug = t["slug"].string, let name = t["name"].string,
                  let start = DateParser.parse(t["start_date"].string) else { return nil }
            let end = DateParser.parse(t["end_date"].string) ?? start
            let status: SeasonEvent.Status = switch t["status"].string {
            case "current": .live
            case "finished": .finished
            case "canceled": .canceled
            default: .upcoming
            }
            return SeasonEvent(
                id: "cs-t-\(slug)", kind: .tournament(slug: slug), name: name, shortName: shortName(name),
                place: t["country"]["name"].string, countryCode: t["country"]["code"].string,
                // bo3.gg's own convention: tournament days are UTC dates.
                startDay: DayKey.of(start, in: DayKey.utc), endDay: DayKey.of(end, in: DayKey.utc),
                startsAt: start, endsAt: end, lanes: [CounterStrike.tier],
                badge: name.contains("Major") ? "Major" : nil, prize: t["prize"].int,
                format: t["event_type"].string.map { $0 == "lan" ? "LAN" : $0.capitalized },
                logo: t["image_url"].string.flatMap(URL.init(string:)), status: status,
                link: URL(string: "https://bo3.gg/tournaments/\(slug)"))
        }

        /// "Intel Extreme Masters Beijing 2026" → "IEM Beijing": the name fans
        /// use, without the year its dates already give.
        static func shortName(_ name: String) -> String {
            var s = name.replacingOccurrences(of: "Intel Extreme Masters ", with: "IEM ")
            if let last = s.split(separator: " ").last, last.count == 4, Int(last) != nil, s.count > 5 { s = String(s.dropLast(5)) }
            return s
        }

        /// The detail `parseTournament` adds (parsed off the main thread, in
        /// the cache), copied onto the tournament as it is now.
        static func withDetail(_ parsed: SeasonEvent, into event: SeasonEvent) -> SeasonEvent {
            var event = event
            event.place = parsed.place ?? event.place
            event.countryCode = parsed.countryCode ?? event.countryCode
            if parsed.badge == "Major" { event.badge = "Major" }
            event.stages = parsed.stages
            event.teams = parsed.teams
            event.detailed = true
            return event
        }

        /// Country, city, teams and the Major series, from `/tournaments/{slug}`.
        static func parseTournament(_ data: Data, into event: SeasonEvent) -> SeasonEvent {
            let t = JSON(data: data)
            var event = event
            if let country = t["country"]["name"].string {
                event.place = [t["city"]["name"].string, country].compactMap { $0 }.joined(separator: ", ")
            }
            event.countryCode = t["country"]["code"].string ?? event.countryCode
            if t["series"]["slug"].string == "cs2-major" { event.badge = "Major" }
            event.stages = t["stages"].array.count
            event.teams = t["teams"].array.compactMap { team -> ScheduleTeam? in
                guard let id = team["id"].int, let name = team["name"].string else { return nil }
                return ScheduleTeam(id: "cs-\(id)", name: name, abbreviation: CounterStrike.abbreviate(name),
                                    logo: team["image_url"].string.flatMap(URL.init(string:)),
                                    rank: team["rank"].int)
            }.sorted { ($0.rank ?? .max) < ($1.rank ?? .max) }
            event.detailed = true
            return event
        }

        /// How many of bo3.gg's world top 10 are in the field.
        static func topTen(_ teams: [ScheduleTeam]) -> Int { teams.filter { ($0.rank ?? .max) <= 10 }.count }

        /// "$1.25M", "$100K", "$750"
        static func prize(_ amount: Int?) -> String? {
            guard let amount, amount > 0 else { return nil }
            if amount >= 1_000_000 {
                let m = Double(amount) / 1_000_000
                return "$" + (m == m.rounded() ? String(Int(m)) : String(format: "%.2f", m).replacingOccurrences(of: #"0$"#, with: "", options: .regularExpression)) + "M"
            }
            if amount >= 1_000 { return "$\(amount / 1_000)K" }
            return "$\(amount)"
        }

        static func parseMatches(_ data: Data, now: Date = .now) -> [ScheduleItem] {
            let matches = JSON(data: data)["results"].array
            // Placeholder order of play: four or more matches of one tournament
            // listed at the same minute, more than two days out.
            var sameMinute: [String: Int] = [:]
            for m in matches where m["status"].string == "upcoming" {
                sameMinute["\(m["tournament_id"].int ?? 0)|\(m["start_date"].string ?? "")", default: 0] += 1
            }
            return matches.compactMap { m -> ScheduleItem? in
                guard let id = m["id"].int, let date = DateParser.parse(m["start_date"].string),
                      m["team1"]["id"].exists || m["team2"]["id"].exists else { return nil }
                let status: ScheduleStatus = switch m["status"].string {
                case "current": .live
                case "finished", "defwin": .final
                case "canceled": .canceled
                case "postponed": .postponed
                default: .scheduled
                }
                let placeholder = (sameMinute["\(m["tournament_id"].int ?? 0)|\(m["start_date"].string ?? "")"] ?? 0) >= 4
                    && date.timeIntervalSince(now) > 2 * 86_400
                func team(_ key: String, _ score: String) -> ScheduleTeam {
                    let t = m[key]
                    let name = t["name"].string ?? "TBD"
                    return ScheduleTeam(id: t["id"].int.map { "cs-\($0)" }, name: name, abbreviation: CounterStrike.abbreviate(name),
                                        logo: t["image_url"].string.flatMap(URL.init(string:)),
                                        score: status == .live || status == .final ? String(m[score].int ?? 0) : nil,
                                        winner: t["id"].int != nil && t["id"].int == m["winner_team_id"].int)
                }
                let tournament = m["tournament"]["name"].string
                return ScheduleItem(
                    id: "cs-\(id)", sportRaw: Sport.esports.rawValue, league: "cs2", competition: tournament,
                    day: DayKey.of(date, in: .current), start: placeholder ? .provisional(date, .orderOfPlay) : .exact(date),
                    status: status,
                    statusDetail: m["status"].string == "defwin" ? "Forfeit" : status == .final ? "Final" : nil,
                    top: team("team1", "team1_score"), bottom: team("team2", "team2_score"),
                    format: m["bo_type"].int.map { "Best of \($0)" },
                    link: m["slug"].string.flatMap { URL(string: "https://bo3.gg/matches/\($0)") },
                    ref: .counterStrike(slug: m["slug"].string ?? String(id), tournament: tournament))
            }
        }
    }
}
