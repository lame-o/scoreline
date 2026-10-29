import Foundation

// Live odds for the open game: Polymarket's market (found by both team names
// and the start time, then followed live), ESPN's model placed on the wall
// clock, and DraftKings' pregame line with the vig removed. Everything here is
// pure parsing and arithmetic, tested on real captures (GSW at MIN and MUN v
// BOU, Tests/Fixtures/odds). OddsFeed.swift tracks the one open market;
// OddsChart.swift draws it. The web twin follows the same rules
// (ODDS-DECISIONS.md in the wave's notes).

// MARK: - Leagues

/// Where a league's games are listed on Polymarket: its series, per ESPN path.
enum OddsLeague {
    static let series: [String: Int] = [
        "soccer/eng.1": 10188, "soccer/uefa.champions": 10204, "soccer/uefa.europa": 10209,
        "soccer/esp.1": 10193, "soccer/ita.1": 10203, "soccer/ger.1": 10194, "soccer/fra.1": 10195,
        "soccer/eng.2": 10355, "soccer/usa.1": 10189, "soccer/fifa.world": 11433,
        "football/nfl": 12185, "football/college-football": 12756,
        "baseball/mlb": 3, "basketball/nba": 10345, "basketball/wnba": 10105,
    ]

    /// The series for a game's league, if Polymarket lists it.
    static func series(for ref: EventRef?) -> Int? {
        guard case let .espn(path, _, _)? = ref else { return nil }
        return series[path]
    }

    /// The US date Polymarket files a game under: its start in New York.
    static func day(_ date: Date) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/New_York") ?? .gmt
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    /// That day, then the day before and after (late games, other time zones).
    static func days(around date: Date) -> [String] {
        [day(date), day(date - 86_400), day(date + 86_400)]
    }
}

// MARK: - Model

/// One moment of a price series: when, and a chance (0…1).
struct OddsPoint: Equatable {
    var t: Date
    var p: Double
}

/// Each outcome's chance at one moment: two-way (`draw` nil) or soccer's three.
struct OddsSplit: Equatable {
    var top: Double
    var draw: Double?
    var bottom: Double

    /// The likeliest outcome.
    var leader: OddsMarket.Outcome {
        if let draw, draw > top, draw > bottom { return .draw }
        return top >= bottom ? .top : .bottom
    }

    func share(_ outcome: OddsMarket.Outcome) -> Double {
        switch outcome {
        case .top: top
        case .draw: draw ?? 0
        case .bottom: bottom
        }
    }
}

/// A Polymarket game market, matched to its ESPN event.
struct OddsMarket: Equatable {
    enum Outcome: Hashable { case top, draw, bottom }

    struct Token: Equatable {
        let id: String
        let outcome: Outcome
    }

    let eventID: String
    let slug: String
    /// US sports: the top team's token (the bottom's is its complement).
    /// Soccer: each outcome's Yes token.
    let tokens: [Token]
    let start: Date
    /// Dollars traded on the game's moneyline.
    var volume: Double?
    /// The prices as listed when found, so the header has numbers before the history lands.
    var snapshot: OddsSplit?
    var closed = false
    /// The moneyline markets' own slugs (to re-read their volume).
    var slugs: [String] = []

    var threeWay: Bool { tokens.count == 3 }
    var link: URL? { URL(string: "https://polymarket.com/event/\(slug)") }

    func token(_ outcome: Outcome) -> String? { tokens.first { $0.outcome == outcome }?.id }
}

/// A listed Polymarket event (`/events?…&include_markets=false`).
struct PolyEvent: Equatable {
    struct Team: Equatable {
        let name: String
        let abbreviation: String?
    }

    let id: String
    let slug: String
    let start: Date
    let teams: [Team]
    var volume: Double?
    var live = false
    var ended = false
}

// MARK: - Matching

/// Finding a game's market by both team names and its start time. Polymarket
/// uses official club names ("Club Atlético de Madrid", "FC Bayern München",
/// "Como 1907"), ESPN its own ("Atlético Madrid", "Bayern", "Como"), and the
/// abbreviations differ (ESPN's GS, Polymarket's gsw). A wrong market is worse
/// than none: anything short of a confident, unique match is no match.
/// Calibrated on 286 real games across the app's leagues: 281 matched, none wrong.
enum OddsMatch {
    /// Words that name a club's type, not the club.
    private static let affixes: Set<String> = ["fc", "afc", "cf", "the", "sc", "sk", "fk", "ac", "as", "ssc", "ud", "cd", "sd",
                                              "bk", "kv", "osc", "club", "de", "cp", "sad"]
    /// Local names to the ones ESPN uses.
    private static let exonyms: [String: String] = [
        "praha": "prague", "munchen": "munich", "koln": "cologne", "milano": "milan", "roma": "rome", "lisboa": "lisbon",
        "sevilla": "seville", "torino": "turin", "napoli": "naples", "firenze": "florence", "genova": "genoa", "wien": "vienna",
        "kobenhavn": "copenhagen", "bruxelles": "brussels", "moskva": "moscow", "warszawa": "warsaw", "beograd": "belgrade",
        "bucuresti": "bucharest", "athina": "athens", "lyonnais": "lyon", "olympiakos": "olympiacos", "omonoia": "omonia",
    ]
    private static let letters: [Character: String] = ["ø": "o", "æ": "ae", "ß": "ss", "ł": "l", "đ": "d", "þ": "th", "œ": "oe", "ı": "i"]

    /// A name as comparable words: "FC Bayern München" → ["bayern", "munich"]. (pure; tested)
    static func tokens(_ name: String) -> [String] {
        var s = ""
        for c in name.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en_US_POSIX")).lowercased() {
            s += letters[c] ?? String(c)
        }
        s = s.replacingOccurrences(of: "&", with: " and ").replacingOccurrences(of: "red bull", with: "rb")
        s = String(s.map { ($0.isASCII && ($0.isLetter || $0.isNumber)) ? $0 : " " })
        s = " " + s.split(separator: " ").joined(separator: " ") + " "
        for (short, long) in [(" la ", " los angeles "), (" ny ", " new york "), (" st ", " saint ")] {
            s = s.replacingOccurrences(of: short, with: long)
        }
        return s.split(separator: " ").map(String.init)
            .filter { !affixes.contains($0) && !$0.allSatisfy(\.isNumber) }
            .map { exonyms[$0] ?? $0 }
    }

    /// One word for another: equal, or a longer form of a 5+ letter word ("hamburg", "hamburger").
    static func same(_ a: String, _ b: String) -> Bool {
        if a == b { return true }
        let (short, long) = a.count <= b.count ? (a, b) : (b, a)
        return short.count >= 5 && long.hasPrefix(short) && long.count - short.count <= 3
    }

    private static func within(_ small: [String], _ big: [String]) -> Bool {
        small.allSatisfy { word in big.contains { same(word, $0) } }
    }

    /// How well a name fits a team's names: 3 the same words, 2 two or more
    /// words of one found in the other, 1 a single word, 0 none. (pure; tested)
    static func score(_ name: String, _ candidates: [String]) -> Int {
        let words = tokens(name)
        guard !words.isEmpty else { return 0 }
        var best = 0
        for candidate in candidates {
            let other = tokens(candidate)
            guard !other.isEmpty else { continue }
            if other.count == words.count, within(other, words), within(words, other) { return 3 }
            let small = within(other, words) ? other : within(words, other) ? words : nil
            guard let small else { continue }
            if Set(small).count >= 2 { best = max(best, 2) } else if small[0].count >= 2 { best = max(best, 1) }
        }
        return best
    }

    /// Which side each of two names is: (first, second), straight or crossed;
    /// nil when either fits neither or the two readings tie. (pure; tested)
    static func assign(_ first: String, _ second: String, top: [String], bottom: [String]) -> (GameDetail.Side, GameDetail.Side)? {
        let straight = (score(first, top), score(second, bottom))
        let crossed = (score(first, bottom), score(second, top))
        let s = min(straight.0, straight.1) >= 1, c = min(crossed.0, crossed.1) >= 1
        let total = (straight.0 + straight.1, crossed.0 + crossed.1)
        if s, !c || total.0 > total.1 { return (.top, .bottom) }
        if c, !s || total.1 > total.0 { return (.bottom, .top) }
        return nil
    }

    /// A main event ends with its date ("nba-gsw-min-2026-10-28"); sub-events
    /// carry a suffix ("…-exact-margin", "…-halftime-result").
    static func isMain(_ slug: String) -> Bool {
        let parts = slug.split(separator: "-")
        guard parts.count >= 3 else { return false }
        let tail = parts.suffix(3)
        return tail.map(\.count) == [4, 2, 2] && tail.allSatisfy { $0.allSatisfy(\.isNumber) }
    }

    /// The listed event for an ESPN game: both teams (assigned one to each
    /// side), starting within 6 h, and clearly the closest such event (an hour
    /// closer than any other: doubleheaders). (pure; tested)
    static func event(in listing: [PolyEvent], start: Date, top: [String], bottom: [String]) -> (PolyEvent, topIsFirst: Bool)? {
        var hits: [(distance: TimeInterval, event: PolyEvent, topIsFirst: Bool)] = []
        for event in listing where isMain(event.slug) && event.teams.count == 2 {
            let distance = abs(event.start.timeIntervalSince(start))
            guard distance <= 6 * 3600, let sides = assign(event.teams[0].name, event.teams[1].name, top: top, bottom: bottom)
            else { continue }
            hits.append((distance, event, sides.0 == .top))
        }
        hits.sort { $0.distance < $1.distance }
        guard let best = hits.first else { return nil }
        if hits.count > 1, hits[1].distance - best.distance < 3600 { return nil }
        return (best.event, best.topIsFirst)
    }
}

// MARK: - Polymarket

enum Polymarket {
    static let gamma = "https://gamma-api.polymarket.com"
    static let clob = "https://clob.polymarket.com"
    static let socket = URL(string: "wss://ws-subscriptions-clob.polymarket.com/ws/market")!

    /// A league's games on a day, without their markets (94 KB for an NBA day, not 20 MB).
    static func listingURL(series: Int, day: String) -> URL? {
        URL(string: "\(gamma)/events?series_id=\(series)&event_date=\(day)&limit=100&include_markets=false")
    }

    /// The game's moneyline market(s) by slug: US sports' is the event's own;
    /// soccer's are `<slug>-<team>` and `<slug>-draw`.
    static func marketsURL(_ event: PolyEvent, closed: Bool) -> URL? {
        var slugs = [event.slug]
        for team in event.teams { if let a = team.abbreviation, !a.isEmpty { slugs.append("\(event.slug)-\(a)") } }
        slugs.append("\(event.slug)-draw")
        let query = slugs.map { "slug=\($0)" }.joined(separator: "&")
        return URL(string: "\(gamma)/markets?\(query)&closed=\(closed)")
    }

    static func marketsURL(slugs: [String], closed: Bool) -> URL? {
        guard !slugs.isEmpty else { return nil }
        return URL(string: "\(gamma)/markets?\(slugs.map { "slug=\($0)" }.joined(separator: "&"))&closed=\(closed)")
    }

    /// The whole event (every market): the fallback when the slugs find nothing.
    static func eventURL(_ event: PolyEvent) -> URL? { URL(string: "\(gamma)/events/\(event.id)") }

    static func historyURL(token: String, from: Date, to: Date) -> URL? {
        URL(string: "\(clob)/prices-history?market=\(token)&startTs=\(Int(from.timeIntervalSince1970))&endTs=\(Int(to.timeIntervalSince1970))&fidelity=1")
    }

    static func midpointURL(token: String) -> URL? { URL(string: "\(clob)/midpoint?token_id=\(token)") }

    /// The listing's events. (pure; tested)
    static func events(_ json: JSON) -> [PolyEvent] {
        json.array.compactMap { e in
            guard let id = e["id"].string, let slug = e["slug"].string, let start = DateParser.parse(e["startTime"].string)
            else { return nil }
            let teams = e["teams"].array.compactMap { t in
                t["name"].string.map { PolyEvent.Team(name: $0, abbreviation: t["abbreviation"].string) }
            }
            return PolyEvent(id: id, slug: slug, start: start, teams: teams, volume: e["volume"].double,
                             live: e["live"].bool ?? false, ended: e["ended"].bool ?? false)
        }
    }

    /// The game's market from `/markets` (or an event's `markets`): one
    /// two-outcome moneyline (US), or three Yes/No ones (soccer: each team,
    /// and the draw). Each outcome is placed by name, never by order. (pure; tested)
    static func market(_ markets: [JSON], event: PolyEvent, start: Date, top: [String], bottom: [String]) -> OddsMarket? {
        let lines = markets.filter { m in
            m["sportsMarketType"].string == "moneyline"
                && (m["events"][0]["slug"].string ?? event.slug) == event.slug
        }
        func strings(_ j: JSON) -> [String] { (j.string.map { JSON(data: Data($0.utf8)) } ?? j).array.compactMap(\.string) }
        func doubles(_ j: JSON) -> [Double] { (j.string.map { JSON(data: Data($0.utf8)) } ?? j).array.compactMap(\.double) }
        /// The first outcome's price as listed (the book's best bid and ask are its), by the displayed-price rule.
        func quote(_ m: JSON) -> Double? {
            OddsQuote(bid: m["bestBid"].double, ask: m["bestAsk"].double, last: m["lastTradePrice"].double).displayed
                ?? doubles(m["outcomePrices"]).first
        }
        let volume = lines.compactMap { $0["volume"].double }.reduce(0, +)
        let closed = lines.contains { $0["closed"].bool == true }
        // US: one market whose outcomes are the two teams.
        if let m = lines.first(where: { strings($0["outcomes"]).count == 2 && strings($0["outcomes"]).first != "Yes" }) {
            let outcomes = strings(m["outcomes"]), ids = strings(m["clobTokenIds"])
            guard ids.count == 2, let sides = OddsMatch.assign(outcomes[0], outcomes[1], top: top, bottom: bottom) else { return nil }
            let topIndex = sides.0 == .top ? 0 : 1
            let snapshot = quote(m).map { first in topIndex == 0 ? first : 1 - first }
            return OddsMarket(eventID: event.id, slug: event.slug, tokens: [.init(id: ids[topIndex], outcome: .top)], start: start,
                              volume: m["volume"].double ?? volume,
                              snapshot: snapshot.map { OddsSplit(top: $0, draw: nil, bottom: 1 - $0) }, closed: closed,
                              slugs: [m["slug"].string ?? event.slug])
        }
        // Soccer: three Yes/No markets, named by `groupItemTitle`.
        var tokens: [OddsMarket.Token] = [], prices: [OddsMarket.Outcome: Double] = [:]
        for m in lines {
            let title = m["groupItemTitle"].string ?? m["question"].string ?? ""
            let ids = strings(m["clobTokenIds"])
            guard let yes = ids.first, strings(m["outcomes"]).first == "Yes" else { continue }
            let outcome: OddsMarket.Outcome
            if title.lowercased().hasPrefix("draw") {
                outcome = .draw
            } else {
                let t = OddsMatch.score(title, top), b = OddsMatch.score(title, bottom)
                guard max(t, b) >= 1, t != b else { continue }
                outcome = t > b ? .top : .bottom
            }
            guard !tokens.contains(where: { $0.outcome == outcome }) else { return nil }
            tokens.append(.init(id: yes, outcome: outcome))
            prices[outcome] = quote(m)
        }
        guard tokens.count == 3 else { return nil }
        let order: [OddsMarket.Outcome] = [.top, .draw, .bottom]
        tokens.sort { (order.firstIndex(of: $0.outcome) ?? 0) < (order.firstIndex(of: $1.outcome) ?? 0) }
        let snapshot = prices.count == 3
            ? OddsSeries.normalized(top: prices[.top]!, draw: prices[.draw]!, bottom: prices[.bottom]!) : nil
        return OddsMarket(eventID: event.id, slug: event.slug, tokens: tokens, start: start, volume: volume, snapshot: snapshot, closed: closed,
                          slugs: lines.compactMap { $0["slug"].string })
    }

    /// `{history: [{t, p}]}`, oldest first. (pure; tested)
    static func history(_ json: JSON) -> [OddsPoint] {
        json["history"].array.compactMap { h in
            guard let t = h["t"].double, let p = h["p"].double, (0...1).contains(p) else { return nil }
            return OddsPoint(t: Date(timeIntervalSince1970: t), p: p)
        }
        .sorted { $0.t < $1.t }
    }

    /// `{"mid": "0.285"}`.
    static func midpoint(_ json: JSON) -> Double? { json["mid"].double.flatMap { (0...1).contains($0) ? $0 : nil } }
}

// MARK: - The displayed price

/// One outcome's book as the market channel last told it.
struct OddsQuote: Equatable {
    var bid: Double?
    var ask: Double?
    var last: Double?

    /// Polymarket's own rule: the midpoint of the best bid and ask, or the last
    /// trade when the spread is wider than 10¢. Compared in tenths of a cent
    /// (0.40 − 0.30 is 0.10000000000000003). (pure; tested)
    var displayed: Double? {
        if let bid, let ask, ask >= bid, ((ask - bid) * 1000).rounded() <= 100 { return (bid + ask) / 2 }
        return last ?? zip(bid, ask).map { ($0 + $1) / 2 }
    }

    private func zip(_ a: Double?, _ b: Double?) -> (Double, Double)? {
        guard let a, let b else { return nil }
        return (a, b)
    }
}

/// What a market-channel frame says about each asset. (pure; tested)
enum OddsFrame {
    enum Update: Equatable {
        /// A full book: its best bid and ask (max bid, min ask: the sides come in opposite orders).
        case book(bid: Double?, ask: Double?, last: Double?)
        case best(bid: Double?, ask: Double?)
        case trade(Double)
    }

    static func parse(_ text: String) -> [(asset: String, update: Update)] {
        guard text.first == "[" || text.first == "{" else { return [] }
        let json = JSON(data: Data(text.utf8))
        let frames = json.raw is NSArray ? json.array : [json]
        var out: [(String, Update)] = []
        for f in frames {
            switch f["event_type"].string {
            case "book":
                guard let asset = f["asset_id"].string else { continue }
                let bid = f["bids"].array.compactMap { $0["price"].double }.max()
                let ask = f["asks"].array.compactMap { $0["price"].double }.min()
                out.append((asset, .book(bid: bid, ask: ask, last: f["last_trade_price"].double)))
            case "price_change":
                for c in f["price_changes"].array {
                    guard let asset = c["asset_id"].string else { continue }
                    out.append((asset, .best(bid: c["best_bid"].double, ask: c["best_ask"].double)))
                }
            case "last_trade_price":
                if let asset = f["asset_id"].string, let price = f["price"].double { out.append((asset, .trade(price))) }
            default:
                continue
            }
        }
        return out
    }

    static func apply(_ update: Update, to quote: inout OddsQuote) {
        switch update {
        case let .book(bid, ask, last):
            quote.bid = bid
            quote.ask = ask
            if let last { quote.last = last }
        case let .best(bid, ask):
            if let bid { quote.bid = bid }
            if let ask { quote.ask = ask }
        case let .trade(price):
            quote.last = price
        }
    }
}

// MARK: - DraftKings

/// DraftKings' pregame moneyline as chances: each price's implied chance,
/// with the book's margin (the vig) removed by scaling them to sum to 1.
enum DraftKings {
    /// −155 → 0.608; +130 → 0.435. (pure; tested)
    static func implied(_ moneyLine: Double) -> Double? {
        guard moneyLine != 0, moneyLine.isFinite else { return nil }
        return moneyLine < 0 ? -moneyLine / (-moneyLine + 100) : 100 / (moneyLine + 100)
    }

    /// GSW +130 / MIN −155 → 42% / 58%. (pure; tested)
    static func noVig(top: Double, draw: Double? = nil, bottom: Double) -> OddsSplit? {
        guard let t = implied(top), let b = implied(bottom) else { return nil }
        let d = draw.flatMap(implied)
        let sum = t + b + (d ?? 0)
        return OddsSplit(top: t / sum, draw: d.map { $0 / sum }, bottom: b / sum)
    }

    /// ESPN's `pickcenter` entry from DraftKings (provider 100; ESPN spells it
    /// "Draft Kings" and "DraftKings"), for the top team.
    static func line(_ summary: JSON, topIsHome: Bool) -> OddsSplit? {
        let entries = summary["pickcenter"].array
        guard let dk = entries.first(where: { e in
            e["provider"]["id"].string == "100"
                || (e["provider"]["name"].string ?? "").lowercased().replacingOccurrences(of: " ", with: "") == "draftkings"
        }), let home = dk["homeTeamOdds"]["moneyLine"].double, let away = dk["awayTeamOdds"]["moneyLine"].double else { return nil }
        return noVig(top: topIsHome ? home : away, draw: dk["drawOdds"]["moneyLine"].double, bottom: topIsHome ? away : home)
    }
}

// MARK: - ESPN's side

/// A play on the wall clock, for the scrub: when, the game clock, what happened.
struct OddsPlay: Equatable {
    let t: Date
    let period: Int
    /// "Q3 4:12", "67'", "Top 7th".
    let clock: String
    let text: String
}

/// A period on the wall clock (its first play to its last), named for the axis.
struct OddsPeriod: Equatable {
    let number: Int
    let label: String
    let start: Date
    let end: Date
}

/// ESPN's side of the odds chart, from the summary the page already polls (no
/// extra requests): the names Polymarket is matched by, ESPN's model for the
/// top team placed on the wall clock, DraftKings' no-vig pregame line, and the
/// plays (the scrub names the nearest one) and periods (the axis).
struct OddsBaseline: Equatable {
    /// ESPN's names for each side: shortDisplayName, name, displayName, location.
    var topNames: [String] = []
    var bottomNames: [String] = []
    var espn: [OddsPoint] = []
    var draftKings: OddsSplit?
    var plays: [OddsPlay] = []
    var periods: [OddsPeriod] = []
    var sport: Sport = .basketball

    /// The first play (tip-off, kickoff, first pitch).
    var start: Date? { plays.first?.t }
    var end: Date? { plays.last?.t }

    /// "before tip-off", per sport.
    static func pregame(_ sport: Sport) -> String {
        switch sport {
        case .basketball: "before tip-off"
        case .baseball: "before the first pitch"
        default: "before kickoff"
        }
    }

    /// The play nearest a moment (by wall clock). (pure; tested)
    func play(near t: Date) -> OddsPlay? {
        guard !plays.isEmpty else { return nil }
        let i = OddsSeries.index(plays.map(\.t), atOrBefore: t)
        let candidates = [i, i.map { $0 + 1 } ?? 0].compactMap { $0 }.filter { plays.indices.contains($0) }
        return candidates.min { abs(plays[$0].t.timeIntervalSince(t)) < abs(plays[$1].t.timeIntervalSince(t)) }.map { plays[$0] }
    }

    /// ESPN's chance for the top team at a moment (its last play at or before it).
    func espn(at t: Date) -> Double? { OddsSeries.value(espn, at: t) }

    // MARK: Parsing

    /// From an ESPN summary. `topID` / `bottomID` are ESPN team ids. (pure; tested)
    static func parse(_ summary: JSON, sport: Sport, topID: String?, bottomID: String?) -> OddsBaseline {
        var b = OddsBaseline()
        b.sport = sport
        let competitors = summary["header"]["competitions"][0]["competitors"].array
        func names(_ id: String?) -> [String] {
            guard let team = competitors.first(where: { $0["team"]["id"].string == id })?["team"] else { return [] }
            return ["shortDisplayName", "name", "displayName", "location"].compactMap { team[$0].string }.filter { !$0.isEmpty }
        }
        b.topNames = names(topID)
        b.bottomNames = names(bottomID)
        let topIsHome = competitors.first { $0["team"]["id"].string == topID }?["homeAway"].string == "home"
        b.draftKings = DraftKings.line(summary, topIsHome: topIsHome)

        // Game order is array order (sequence numbers aren't); football's plays sit inside drives.
        let raw: [JSON]
        switch sport {
        case .football:
            raw = summary["drives"]["previous"].array.flatMap { $0["plays"].array } + summary["drives"]["current"]["plays"].array
        case .soccer:
            raw = summary["commentary"].array.compactMap { c -> JSON? in
                guard c["play"].exists, var play = c["play"].raw as? [String: Any] else { return nil }
                play["text"] = c["text"].string ?? play["text"]
                return JSON(play)
            }
        default:
            raw = summary["plays"].array
        }
        var latest = Date.distantPast
        var placed: [(id: String?, play: OddsPlay)] = []
        for p in raw {
            guard let wall = DateParser.parse(p["wallclock"].string) else { continue }
            // Wall clocks run backwards now and then (14 of 552 in GSW at MIN): time never does.
            latest = max(latest, wall)
            let period = p["period"]["number"].int ?? 1
            // The scrub names plays worth naming: the NBA's shots, fouls, turnovers and scores, not substitutions or timeouts.
            let notable = sport != .basketball || NBADetail.isNotable(type: p["type"]["id"].int, scoreValue: p["scoreValue"].int)
            let text = notable ? Self.text(p, sport: sport) : ""
            placed.append((p["id"].string, OddsPlay(t: latest, period: period, clock: Self.clock(p, sport: sport), text: text)))
        }
        b.plays = placed.filter { !$0.play.text.isEmpty }.map(\.play)

        // ESPN's model: per play, joined by id, home's chance turned to the top team's.
        var home: [String: Double] = [:]
        for w in summary["winprobability"].array {
            if let id = w["playId"].string, let h = w["homeWinPercentage"].double { home[id] = h }
        }
        if !home.isEmpty {
            b.espn = placed.compactMap { item in
                guard let id = item.id, let h = home[id] else { return nil }
                return OddsPoint(t: item.play.t, p: topIsHome ? h : 1 - h)
            }
        }

        // Periods: each one's first play to its last, in order.
        var periods: [OddsPeriod] = []
        for item in placed {
            let p = item.play
            if let last = periods.last, last.number == p.period {
                periods[periods.count - 1] = OddsPeriod(number: last.number, label: last.label, start: last.start, end: p.t)
            } else if !periods.contains(where: { $0.number == p.period }) {
                periods.append(OddsPeriod(number: p.period, label: periodLabel(p.period, sport: sport), start: p.t, end: p.t))
            }
        }
        b.periods = periods
        return b
    }

    /// Under the axis: "Q1"…"OT" (basketball, football), "1"…"9", "10" (innings),
    /// "1st", "2nd", "ET", "Pens" (soccer halves).
    static func periodLabel(_ n: Int, sport: Sport) -> String {
        switch sport {
        case .soccer: [1: "1st", 2: "2nd", 3: "ET", 4: "ET", 5: "Pens"][n] ?? ""
        case .baseball: "\(n)"
        default: Period.label(n, sport: sport)
        }
    }

    /// The game clock at a play: "Q3 4:12", "67'", "Top 7th".
    private static func clock(_ p: JSON, sport: Sport) -> String {
        let n = p["period"]["number"].int
        let display = p["clock"]["displayValue"].string ?? ""
        switch sport {
        case .soccer:
            return SlideWords.minuteMark(display) ?? ""
        case .baseball:
            guard let n else { return "" }
            let half = p["period"]["type"].string?.lowercased()
            return half == "top" ? "Top \(Ordinal.string(n))" : half == "bottom" ? "Bot \(Ordinal.string(n))" : Ordinal.string(n)
        default:
            guard let n else { return display }
            return [Period.label(n, sport: sport), display].filter { !$0.isEmpty }.joined(separator: " ")
        }
    }

    /// What happened, in a line the tooltip can hold.
    private static func text(_ p: JSON, sport: Sport) -> String {
        let raw = p["text"].string ?? ""
        switch sport {
        case .basketball: return NBADetail.plain(raw).replacingOccurrences(of: "-foot ", with: "-ft ")
        // Baseball: the at-bat's result, not each pitch ("Pitch 4 : Strike 3 Swinging").
        case .baseball: return raw.hasPrefix("Pitch ") ? "" : raw
        // Soccer: who and what ("Goal! Manchester United 0, Bournemouth 2. Marcus Tavernier (Bournemouth)"), not the shot's whole path.
        case .soccer: return soccerLine(raw)
        default: return raw.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        }
    }

    /// ESPN's commentary, short: the first sentence, and the second up to its
    /// "(Team)" when the first is just the kind of moment. (pure; tested)
    static func soccerLine(_ raw: String) -> String {
        let text = raw.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        // A goal, as a scoreboard says it: "Goal! Marcus Tavernier (Bournemouth), 0–2".
        if let m = text.firstMatch(of: #/^Goal! .+? (\d+), .+? (\d+)\. (.+?\))/#) {
            return "Goal! \(m.3), \(m.1)–\(m.2)"
        }
        let parts = text.components(separatedBy: ". ")
        guard parts.count > 1 else { return text }
        if parts[0].count < 45, let close = parts[1].firstIndex(of: ")") {
            return parts[0] + ". " + parts[1][...close]
        }
        return text.count <= 80 ? text : parts[0] + "."
    }
}

// MARK: - Series

enum OddsSeries {
    /// Points kept per series.
    static let cap = 600
    /// The newest stretch kept tick by tick (the 10 min window's span).
    static let raw: TimeInterval = 600

    /// The index of the last time at or before `t` (binary search; times ascending).
    static func index(_ times: [Date], atOrBefore t: Date) -> Int? {
        var lo = 0, hi = times.count - 1, found: Int?
        while lo <= hi {
            let mid = (lo + hi) / 2
            if times[mid] <= t { found = mid; lo = mid + 1 } else { hi = mid - 1 }
        }
        return found
    }

    /// The value in effect at `t`: the last point at or before it.
    static func value(_ points: [OddsPoint], at t: Date) -> Double? {
        index(points.map(\.t), atOrBefore: t).map { points[$0].p }
    }

    /// At most `cap` points, times strictly increasing: the last `raw` seconds
    /// as they came, older ones one per minute (each minute's last value),
    /// then evenly thinned if that's still too many. The newest point always
    /// survives. (pure; tested)
    static func compact(_ points: [OddsPoint], now: Date, cap: Int = cap) -> [OddsPoint] {
        var out: [OddsPoint] = []
        out.reserveCapacity(min(points.count, cap + 1))
        let cut = now - raw
        var bucket: (minute: Int, point: OddsPoint)?
        for point in points {
            if let last = out.last, point.t <= last.t { continue }
            if point.t < cut {
                let minute = Int(point.t.timeIntervalSince1970 / 60)
                if let b = bucket, b.minute != minute { out.append(b.point) }
                bucket = (minute, point)
            } else {
                if let b = bucket { out.append(b.point); bucket = nil }
                if let last = out.last, point.t <= last.t { continue }
                out.append(point)
            }
        }
        if let b = bucket, out.last.map({ b.point.t > $0.t }) ?? true { out.append(b.point) }
        guard out.count > cap, cap > 1 else { return out }
        // Still too many (a whole day of minutes): keep every k-th, and the newest.
        let stride = Double(out.count - 1) / Double(cap - 1)
        return (0..<cap).map { out[Int((Double($0) * stride).rounded())] }
    }

    /// History and live ticks as one series: ticks win where they overlap.
    static func merge(_ history: [OddsPoint], _ ticks: [OddsPoint]) -> [OddsPoint] {
        guard let first = ticks.first?.t else { return history }
        return history.filter { $0.t < first } + ticks
    }

    /// Soccer's three prices scaled to sum to 1 (they list at 0.99–1.01).
    static func normalized(top: Double, draw: Double, bottom: Double) -> OddsSplit {
        let sum = top + draw + bottom
        guard sum > 0 else { return OddsSplit(top: 1.0 / 3, draw: 1.0 / 3, bottom: 1.0 / 3) }
        return OddsSplit(top: top / sum, draw: draw / sum, bottom: bottom / sum)
    }

    /// Three series on one timeline: at each moment any of them moved, all
    /// three as they stood, normalized. (pure; tested)
    static func stacked(top: [OddsPoint], draw: [OddsPoint], bottom: [OddsPoint]) -> [(t: Date, split: OddsSplit)] {
        let times = Array(Set((top + draw + bottom).map(\.t))).sorted()
        return times.compactMap { t in
            guard let a = value(top, at: t), let d = value(draw, at: t), let b = value(bottom, at: t) else { return nil }
            return (t, normalized(top: a, draw: d, bottom: b))
        }
    }

    /// Whole points, never 0 or 100 while it's undecided: "100%" is for the
    /// final whistle. (pure; tested)
    static func percent(_ p: Double, final: Bool = false) -> Int {
        let whole = Int((p * 100).rounded())
        return final ? whole : min(max(whole, 1), 99)
    }

    /// "$4.1M", "$850K", "$12K", "$900".
    static func dollars(_ value: Double) -> String {
        switch value {
        case 1_000_000...: String(format: "$%.1fM", value / 1_000_000).replacingOccurrences(of: ".0M", with: "M")
        case 10_000...: "$\(Int((value / 1000).rounded()))K"
        case 1000...: String(format: "$%.1fK", value / 1000).replacingOccurrences(of: ".0K", with: "K")
        default: "$\(Int(value.rounded()))"
        }
    }
}
