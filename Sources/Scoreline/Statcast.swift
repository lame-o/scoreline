import Foundation

/// MLB's own pitch-by-pitch feed (Statcast, statsapi.mlb.com): each batted
/// ball's launch speed, angle and distance, and each pitch's measured flight;
/// and its official scorer's account of every play: each runner's legs and
/// each fielder's credits. ESPN says where a ball went; this says how it got
/// there and who handled it. Public and keyless; trimmed with `fields` to
/// about 65 KB a game, and fetched when an at-bat ends, never on the live
/// lane's clock.
enum Statcast {
    /// A pitch's flight in Statcast's frame: feet and seconds from release,
    /// x toward the catcher's right, y from home plate toward the mound, z up.
    struct Pitch: Equatable, Sendable {
        let release: SIMD3<Double>
        let velocity: SIMD3<Double>
        let acceleration: SIMD3<Double>
        /// Where it crossed the front of the plate: feet from its center, and height.
        let plate: SIMD2<Double>
        /// This batter's zone, top and bottom (feet).
        let zone: ClosedRange<Double>?
        let mph: Double?
        let spin: Int?
        /// "FF", "SL".
        let type: String?

        /// Where it is `t` seconds after release (constant acceleration, as Statcast fits it).
        func position(at t: Double) -> SIMD3<Double> {
            release + velocity * t + acceleration * (0.5 * t * t)
        }

        /// When it reaches the front of the plate (17 inches in front of the point).
        var plateTime: Double? {
            let a = acceleration.y / 2, b = velocity.y, c = release.y - 17.0 / 12.0
            let d = b * b - 4 * a * c
            guard d >= 0 else { return nil }
            let roots = a == 0 ? [-c / b] : [(-b - d.squareRoot()) / (2 * a), (-b + d.squareRoot()) / (2 * a)]
            return roots.filter { $0 > 0 }.min()
        }
    }

    struct Batted: Equatable, Sendable {
        /// Exit velocity (mph) and launch angle (degrees).
        let launchSpeed: Double?
        let launchAngle: Double?
        /// Feet, where it first came down or was caught (a grounder: its first hop).
        let distance: Double?
        /// "ground_ball", "line_drive", "fly_ball", "popup".
        let trajectory: String?
        /// Where it was fielded or landed, in the hit chart's space (home plate ≈ (125, 205)):
        /// the same space as ESPN's `hitCoordinate`, which comes from MLB.
        let spot: SIMD2<Double>?
        /// Who fielded it, by scorer's number (MLB's `location`).
        var fielder: Int? = nil

        /// "104.4 MPH · 12° · 273 FT", as much as is known. A grounder's
        /// distance is only its first hop, so it can be left off.
        func line(distance shown: Bool) -> String? {
            let parts = [launchSpeed.map { String(format: "%.1f MPH", $0) },
                         launchAngle.map { "\(Int($0.rounded()))°".replacingOccurrences(of: "-", with: "−") },
                         shown ? distance.map { "\(Int($0.rounded())) FT" } : nil].compactMap { $0 }
            return parts.isEmpty ? nil : parts.joined(separator: " · ")
        }

        var line: String? { line(distance: true) }
    }

    /// One leg of a runner's way on a play, as MLB's official scorer
    /// recorded it: base to base (0: the plate, where the batter starts; 4:
    /// home, a run), or put out at a base, the outs numbered in the order
    /// they were made, with every fielder's part in it.
    struct Movement: Equatable, Sendable {
        /// MLB's ID for the runner: the same on each of his legs.
        let runner: Int
        let from: Int
        /// Nil when he was put out on this leg.
        let to: Int?
        /// Where he was put out (4: home), and which out of the inning it was.
        let out: Int?
        let outNumber: Int?
        /// "r_adv_force", "r_adv_play", "r_out_stretching", "r_doubled_off"…
        let reason: String?
        /// The at-bat's event it came on (its last pitch, or a steal between pitches).
        let event: Int?
        let credits: [Credit]

        /// Someone threw to the putout (not a catch or a tag by the man who fielded it).
        var assisted: Bool { credits.contains { $0.kind == .assist || $0.kind == .outfieldAssist } }
    }

    /// A fielder's part in a runner's leg, by scorer's number.
    struct Credit: Equatable, Sendable {
        enum Kind: String, Sendable {
            case fielded = "f_fielded_ball", assist = "f_assist", outfieldAssist = "f_assist_of", putout = "f_putout"
            case throwingError = "f_throwing_error", fieldingError = "f_fielding_error", deflection = "f_deflection"
            case other
        }
        let position: Int
        let kind: Kind
    }

    struct AtBat: Equatable, Sendable {
        let index: Int
        let inning: Int
        let top: Bool
        /// "Brice Turang".
        let batter: String
        /// "Groundout", "Home Run".
        let event: String?
        let pitches: [Pitch]
        let batted: Batted?
        /// Over (MLB's `isComplete`): `event` alone isn't, since MLB names it mid-at-bat for whatever
        /// just happened ("Mound Visit", "Batter Timeout", "Stolen Base 2B").
        var complete = true
        /// Every runner's legs in the at-bat (a steal's between pitches too).
        var runners: [Movement] = []
        /// The event that ended it (its last pitch, or a pickoff): the result's legs are the ones on it.
        var closing: Int? = nil

        /// The legs on the play that ended the at-bat.
        var result: [Movement] { runners.filter { $0.event == closing } }

        /// Its last pitch was put in play.
        var inPlay = false

        /// Over, with all of it posted: complete and named, a ball put in play with its hitData.
        var over: Bool { complete && event != nil && (!inPlay || batted != nil) }
    }

    /// Only what the theater reads: about a third of the feed.
    static let fields = [
        "liveData", "plays", "allPlays", "about", "atBatIndex", "inning", "isTopInning", "matchup", "batter", "fullName",
        "result", "event", "playEvents", "isPitch", "details", "type", "code", "pitchData", "startSpeed", "strikeZoneTop",
        "strikeZoneBottom", "coordinates", "x0", "y0", "z0", "vX0", "vY0", "vZ0", "aX", "aY", "aZ", "pX", "pZ", "breaks",
        "spinRate", "hitData", "launchSpeed", "launchAngle", "totalDistance", "trajectory", "coordX", "coordY", "location",
        "index", "runners", "movement", "start", "end", "isOut", "outBase", "outNumber", "movementReason", "runner", "id",
        "playIndex", "credits", "credit", "position", "isComplete",
    ].joined(separator: ",")

    static func feedURL(game: Int) -> URL? {
        URL(string: "https://statsapi.mlb.com/api/v1.1/game/\(game)/feed/live?fields=\(fields)")
    }

    /// MLB's schedule for a day, its own (Eastern) date: a 7 PM Pacific game is the same day.
    static func scheduleURL(for start: Date) -> URL? {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/New_York") ?? .current
        let d = calendar.dateComponents([.year, .month, .day], from: start)
        guard let y = d.year, let m = d.month, let day = d.day else { return nil }
        return URL(string: String(format: "https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=%04d-%02d-%02d", y, m, day))
    }

    /// The MLB game between these teams in a day's schedule. ESPN's names are
    /// the short ones ("Brewers", "Red Sox"); MLB's end with them.
    static func game(in schedule: JSON, teams: [String]) -> Int? {
        let wanted = teams.map { $0.lowercased() }
        for day in schedule["dates"].array {
            for g in day["games"].array {
                let names = [g["teams"]["away"]["team"]["name"].string, g["teams"]["home"]["team"]["name"].string]
                    .compactMap { $0?.lowercased() }
                if wanted.count == 2, wanted.allSatisfy({ team in names.contains { $0.hasSuffix(team) } }) { return g["gamePk"].int }
            }
        }
        return nil
    }

    static func atBats(_ feed: JSON) -> [AtBat] {
        feed["liveData"]["plays"]["allPlays"].array.compactMap { play in
            let about = play["about"]
            guard let index = about["atBatIndex"].int, let inning = about["inning"].int else { return nil }
            var pitches: [Pitch] = []
            var batted: Batted?
            var closing: Int?, inPlay = false
            for (i, event) in play["playEvents"].array.enumerated() {
                if event["isPitch"].bool == true {
                    closing = event["index"].int ?? i
                    inPlay = ["X", "D", "E"].contains(event["details"]["code"].string ?? "")
                }
                let data = event["pitchData"], c = data["coordinates"]
                if event["isPitch"].bool == true,
                   let x0 = c["x0"].double, let y0 = c["y0"].double, let z0 = c["z0"].double,
                   let vx = c["vX0"].double, let vy = c["vY0"].double, let vz = c["vZ0"].double,
                   let ax = c["aX"].double, let ay = c["aY"].double, let az = c["aZ"].double,
                   let px = c["pX"].double, let pz = c["pZ"].double {
                    let top = data["strikeZoneTop"].double, bottom = data["strikeZoneBottom"].double
                    pitches.append(Pitch(release: [x0, y0, z0], velocity: [vx, vy, vz], acceleration: [ax, ay, az], plate: [px, pz],
                                         zone: top.flatMap { t in bottom.flatMap { $0 < t ? $0...t : nil } },
                                         mph: data["startSpeed"].double, spin: data["breaks"]["spinRate"].int,
                                         type: event["details"]["type"]["code"].string))
                }
                // A ball in play's (a foul can carry hitData too).
                let hit = event["hitData"], code = event["details"]["code"].string
                if hit.exists, code.map(["X", "D", "E"].contains) ?? true {
                    let spot = hit["coordinates"]["coordX"].double.flatMap { x in hit["coordinates"]["coordY"].double.map { SIMD2(x, $0) } }
                    batted = Batted(launchSpeed: hit["launchSpeed"].double, launchAngle: hit["launchAngle"].double,
                                    distance: hit["totalDistance"].double, trajectory: hit["trajectory"].string, spot: spot,
                                    // ("89": between two of them, no one's.)
                                    fielder: hit["location"].string.flatMap { Int($0) }.flatMap { (1...9).contains($0) ? $0 : nil })
                }
            }
            let runners = play["runners"].array.compactMap(movement)
            return AtBat(index: index, inning: inning, top: about["isTopInning"].bool ?? true,
                         batter: play["matchup"]["batter"]["fullName"].string ?? "", event: play["result"]["event"].string,
                         pitches: pitches, batted: batted, complete: about["isComplete"].bool ?? true, runners: runners,
                         // Its last pitch, or a pickoff after it that ended it.
                         closing: [closing, runners.compactMap(\.event).max()].compactMap { $0 }.max(), inPlay: inPlay)
        }
    }

    /// A runner's leg from MLB's `runners`: "1B"…"3B" are bases, "4B" and
    /// "score" home, and the batter starts from nowhere (the plate).
    static func movement(_ entry: JSON) -> Movement? {
        let m = entry["movement"], details = entry["details"]
        guard let runner = details["runner"]["id"].int else { return nil }
        func base(_ s: String?) -> Int? {
            switch s {
            case "1B": 1
            case "2B": 2
            case "3B": 3
            case "4B", "score": 4
            default: nil
            }
        }
        let out = m["isOut"].bool == true
        let credits = entry["credits"].array.compactMap { c in
            Int(c["position"]["code"].string ?? "").map { Credit(position: $0, kind: Credit.Kind(rawValue: c["credit"].string ?? "") ?? .other) }
        }
        return Movement(runner: runner, from: base(m["start"].string) ?? 0, to: out ? nil : base(m["end"].string),
                        out: out ? base(m["outBase"].string) : nil, outNumber: out ? m["outNumber"].int : nil,
                        reason: details["movementReason"].string, event: details["playIndex"].int, credits: credits)
    }

    /// The at-bat an ESPN result describes: the same half-inning, the batter by
    /// surname (accents and case aside), and the nth of theirs in it when a team bats around.
    static func match(inning: Int, top: Bool, surname: String, occurrence: Int = 0, in atBats: [AtBat]) -> AtBat? {
        let key = fold(surname)
        let theirs = atBats.filter { $0.inning == inning && $0.top == top && fold($0.batter).hasSuffix(key) }
        return theirs.indices.contains(occurrence) ? theirs[occurrence] : nil
    }

    /// Accents, case and periods aside ("Mesa Jr." is "mesa jr").
    private static func fold(_ s: String) -> String {
        s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil).replacingOccurrences(of: ".", with: "")
            .trimmingCharacters(in: .whitespaces)
    }

    /// An ESPN game as MLB's feed finds it: its ID, its day and both teams'
    /// short names. Only MLB's games are in it.
    struct Lookup: Equatable, Sendable {
        let espnEvent: String
        let start: Date
        let teams: [String]

        init(espnEvent: String, start: Date, teams: [String]) {
            self.espnEvent = espnEvent
            self.start = start
            self.teams = teams
        }

        init?(_ event: Event) {
            guard case let .espn(path, id, .baseball)? = event.ref, path == "baseball/mlb", event.competitors.count == 2 else { return nil }
            self.init(espnEvent: id, start: event.start, teams: event.competitors.map(\.name))
        }
    }
}

/// Statcast per game: which MLB game an ESPN one is, and its at-bats, fetched
/// again only when someone asks for an at-bat it doesn't have yet, or that
/// isn't over (Statcast posts a few seconds after ESPN), and not more than
/// every couple of seconds. A second caller waits for a fetch under way
/// rather than read what it's about to replace.
@MainActor
final class StatcastStore {
    static let shared = StatcastStore()

    private var games: [String: Int] = [:]
    private var feeds: [Int: (atBats: [Statcast.AtBat], fetched: Date)] = [:]
    private var inFlight: [Int: Task<[Statcast.AtBat]?, Never>] = [:]
    private var finding: [String: Task<Int?, Never>] = [:]
    /// ESPN games MLB's schedule didn't have (or couldn't say): not asked again for a minute.
    private var unknown: [String: Date] = [:]
    private static let minimumInterval: TimeInterval = 2

    /// The game's at-bats, refreshed if `through` (an at-bat index) isn't in them yet, or isn't over
    /// (complete, and a ball in play's hitData posted: it can come seconds after the result).
    func atBats(espnEvent: String, start: Date, teams: [String], through: Int? = nil) async -> [Statcast.AtBat] {
        guard let game = await game(espnEvent: espnEvent, start: start, teams: teams) else { return [] }
        if let running = inFlight[game] { return await running.value ?? feeds[game]?.atBats ?? [] }
        let cached = feeds[game]
        let missing = through.map { index in !(cached?.atBats.contains { $0.index == index && $0.over } ?? false) } ?? (cached == nil)
        let due = cached.map { Date().timeIntervalSince($0.fetched) > Self.minimumInterval } ?? true
        guard missing, due, let url = Statcast.feedURL(game: game) else { return cached?.atBats ?? [] }
        let fetch = Task { (try? await JSON.fetch(url)).map(Statcast.atBats) }
        inFlight[game] = fetch
        let atBats = await fetch.value
        inFlight[game] = nil
        guard let atBats else { return cached?.atBats ?? [] }
        feeds[game] = (atBats, Date())
        return atBats
    }

    private func game(espnEvent: String, start: Date, teams: [String]) async -> Int? {
        if let known = games[espnEvent] { return known }
        if let running = finding[espnEvent] { return await running.value }
        if let asked = unknown[espnEvent], Date().timeIntervalSince(asked) < 60 { return nil }
        let find = Task { () -> Int? in
            guard let url = Statcast.scheduleURL(for: start), let schedule = try? await JSON.fetch(url) else { return nil }
            return Statcast.game(in: schedule, teams: teams)
        }
        finding[espnEvent] = find
        let game = await find.value
        finding[espnEvent] = nil
        if let game { games[espnEvent] = game } else { unknown[espnEvent] = Date() }
        return game
    }
}
