import Foundation

/// MLB's own pitch-by-pitch feed (Statcast, statsapi.mlb.com): each batted
/// ball's launch speed, angle and distance, and each pitch's measured flight.
/// ESPN says where a ball went; this says how it got there. Public and keyless;
/// trimmed with `fields` to about 60 KB a game, and fetched when an at-bat ends,
/// never on the live lane's clock.
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
        /// Feet, where it landed or was caught.
        let distance: Double?
        /// "ground_ball", "line_drive", "fly_ball", "popup".
        let trajectory: String?
        /// Where it was fielded or landed, in the hit chart's space (home plate ≈ (125, 205)):
        /// the same space as ESPN's `hitCoordinate`, which comes from MLB.
        let spot: SIMD2<Double>?

        /// "104.4 MPH · 12° · 273 FT", as much as is known.
        var line: String? {
            let parts = [launchSpeed.map { String(format: "%.1f MPH", $0) },
                         launchAngle.map { "\(Int($0.rounded()))°" },
                         distance.map { "\(Int($0.rounded())) FT" }].compactMap { $0 }
            return parts.isEmpty ? nil : parts.joined(separator: " · ")
        }
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
    }

    /// Only what the theater reads: about a quarter of the feed.
    static let fields = [
        "liveData", "plays", "allPlays", "about", "atBatIndex", "inning", "isTopInning", "matchup", "batter", "fullName",
        "result", "event", "playEvents", "isPitch", "details", "type", "code", "pitchData", "startSpeed", "strikeZoneTop",
        "strikeZoneBottom", "coordinates", "x0", "y0", "z0", "vX0", "vY0", "vZ0", "aX", "aY", "aZ", "pX", "pZ", "breaks",
        "spinRate", "hitData", "launchSpeed", "launchAngle", "totalDistance", "trajectory", "coordX", "coordY",
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
            for event in play["playEvents"].array {
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
                let hit = event["hitData"]
                if hit.exists {
                    let spot = hit["coordinates"]["coordX"].double.flatMap { x in hit["coordinates"]["coordY"].double.map { SIMD2(x, $0) } }
                    batted = Batted(launchSpeed: hit["launchSpeed"].double, launchAngle: hit["launchAngle"].double,
                                    distance: hit["totalDistance"].double, trajectory: hit["trajectory"].string, spot: spot)
                }
            }
            return AtBat(index: index, inning: inning, top: about["isTopInning"].bool ?? true,
                         batter: play["matchup"]["batter"]["fullName"].string ?? "", event: play["result"]["event"].string,
                         pitches: pitches, batted: batted)
        }
    }

    /// The at-bat an ESPN result describes: the same half-inning, the batter by
    /// surname (accents and case aside), and the nth of theirs in it when a team bats around.
    static func match(inning: Int, top: Bool, surname: String, occurrence: Int = 0, in atBats: [AtBat]) -> AtBat? {
        let key = fold(surname)
        let theirs = atBats.filter { $0.inning == inning && $0.top == top && fold($0.batter).hasSuffix(key) }
        return theirs.indices.contains(occurrence) ? theirs[occurrence] : nil
    }

    private static func fold(_ s: String) -> String {
        s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil).trimmingCharacters(in: .whitespaces)
    }
}

/// Statcast per game: which MLB game an ESPN one is, and its at-bats, fetched
/// again only when someone asks for an at-bat it doesn't have yet (Statcast
/// posts a few seconds after ESPN) and not more than every few seconds.
@MainActor
final class StatcastStore {
    static let shared = StatcastStore()

    private var games: [String: Int] = [:]
    private var feeds: [Int: (atBats: [Statcast.AtBat], fetched: Date)] = [:]
    private var inFlight: Set<Int> = []
    private static let minimumInterval: TimeInterval = 8

    /// The game's at-bats, refreshed if `through` (an at-bat index) isn't in them yet.
    func atBats(espnEvent: String, start: Date, teams: [String], through: Int? = nil) async -> [Statcast.AtBat] {
        guard let game = await game(espnEvent: espnEvent, start: start, teams: teams) else { return [] }
        let cached = feeds[game]
        let missing = through.map { index in !(cached?.atBats.contains { $0.index == index } ?? false) } ?? (cached == nil)
        let due = cached.map { AppClock.now.timeIntervalSince($0.fetched) > Self.minimumInterval } ?? true
        guard missing, due, !inFlight.contains(game), let url = Statcast.feedURL(game: game) else { return cached?.atBats ?? [] }
        inFlight.insert(game)
        defer { inFlight.remove(game) }
        guard let feed = try? await JSON.fetch(url) else { return cached?.atBats ?? [] }
        let atBats = Statcast.atBats(feed)
        feeds[game] = (atBats, AppClock.now)
        return atBats
    }

    private func game(espnEvent: String, start: Date, teams: [String]) async -> Int? {
        if let known = games[espnEvent] { return known }
        guard let url = Statcast.scheduleURL(for: start), let schedule = try? await JSON.fetch(url),
              let game = Statcast.game(in: schedule, teams: teams) else { return nil }
        games[espnEvent] = game
        return game
    }
}
