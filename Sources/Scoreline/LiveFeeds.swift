import Foundation
import Observation

// MARK: - Soccer play-by-play

/// One positioned action on the pitch, oriented so the home (top) team attacks
/// right. Coordinates are 0…100 on both axes.
struct PitchAction: Identifiable, Equatable {
    enum Kind { case pass, shot, goal, yellow, red, other }
    let id: Int
    let kind: Kind
    let side: GameDetail.Side
    let x: Double
    let y: Double
    let endX: Double?
    let endY: Double?
    let minute: String
    let text: String
    /// ESPN's play ID, shared with the match summary's key events.
    var playID: String = ""
    /// How a shot ended (goals are `.goal` kind).
    enum ShotOutcome: Equatable { case saved, blocked, wide, woodwork }
    var shot: ShotOutcome?
    /// Opta's expected goals for a shot (0…1), via ESPN.
    var xg: Double?
    /// Where a shot crossed (or would have crossed) the goal line, across the
    /// mouth on the same 0…100 scale as `y` and oriented like it. The posts
    /// stand at about 45.2 and 54.8.
    var goalY: Double?
    /// Its height at the line; the crossbar is at about 38.
    var goalZ: Double?
    /// Goals after this play, home (top) first.
    var topScore: Int?
    var bottomScore: Int?
    /// The match clock in seconds (85' = 5100), counting on through stoppage and extra time.
    var clockSeconds: Double?

    /// A chance worth a caption even though it missed: Opta's "big chance" line.
    static let bigChanceXG = 0.3
    /// From here on a goal that changes the result decides the match.
    static let lateSeconds = 85.0 * 60
    /// The posts on the goal-line scale (LMD §2.4).
    static let posts = (near: 45.2, far: 54.8)

    /// Where a shot off the woodwork struck, on the goal-line scale: the
    /// crossbar where it crossed between the posts high up, else the nearer post.
    var woodworkY: Double? {
        guard shot == .woodwork, let y = goalY else { return nil }
        if let z = goalZ, z >= 34, y > Self.posts.near, y < Self.posts.far { return y }
        return abs(y - Self.posts.near) < abs(y - Self.posts.far) ? Self.posts.near : Self.posts.far
    }

    /// A late goal that changes the result: an equalizer, or a winner from level.
    var decidesMatch: Bool {
        guard kind == .goal, let clockSeconds, clockSeconds >= Self.lateSeconds,
              let top = topScore, let bottom = bottomScore else { return false }
        let (mine, theirs) = side == .top ? (top, bottom) : (bottom, top)
        return mine == theirs || mine == theirs + 1
    }

    /// A goal, shot or card as a live moment.
    var moment: LiveMoment? {
        let detail = MomentList.shortened(text)
        switch kind {
        case .goal:
            var m = LiveMoment(id: playID, chart: .pitch, tier: .score, kind: .goal, lead: "Goal", detail: detail, side: side)
            if decidesMatch { m.accents.insert(.decisive) }
            return m
        case .yellow, .red:
            return LiveMoment(id: playID, chart: .pitch, tier: .swing, kind: .card(red: kind == .red),
                              lead: kind == .red ? "Red card" : "Yellow card", detail: detail, side: side)
        case .shot:
            let (kind, lead): (LiveMoment.Kind, String) = switch shot {
            case .saved?: (.shotSaved, "Saved")
            case .blocked?: (.shotBlocked, "Blocked")
            case .woodwork?: (.shotWide, "Off the woodwork")
            default: (.shotWide, "Wide")
            }
            var accents: LiveMoment.Accents = shot == .woodwork ? .woodwork : []
            var caption = (lead, detail)
            // A big chance leads with the chance: "Big chance  0.39 xG · saved · …".
            if let xg, xg >= Self.bigChanceXG {
                accents.insert(.bigChance)
                caption = ("Big chance", "\(String(format: "%.2f", xg)) xG · \(lead.lowercased()) · \(detail)")
            }
            var m = LiveMoment(id: playID, chart: .pitch, tier: .swing, kind: kind, lead: caption.0, detail: caption.1, side: side)
            m.accents = accents
            return m
        default:
            return nil
        }
    }
}

/// ESPN's event-level feed (each pass, shot, tackle with a location). It loads
/// a match once, then each refresh fetches only plays added since the last.
/// Positions are relative to the acting team's attack, so away actions are
/// flipped onto a single pitch.
@MainActor
@Observable
final class SoccerFeed {
    private(set) var trail: [PitchAction] = []
    private(set) var shots: [PitchAction] = []
    /// Cards, placed where the foul that drew them happened, by play ID.
    private(set) var cards: [String: PitchAction] = [:]
    private(set) var loaded = false
    /// Goals, shots and cards that arrived since the page opened.
    @ObservationIgnored private var moments: [LiveMoment] = []
    /// Whether this page has had a complete load: before it, everything is
    /// history (the feed outlives the page, so it may be catching up).
    @ObservationIgnored private var primed = false
    /// The last few located actions, kept across pages and refreshes, so a
    /// card (which has no position) can be put at its foul.
    @ObservationIgnored private var recent: [PitchAction] = []
    /// How many plays have been read (bookkeeping: no view shows it).
    @ObservationIgnored private var fetched = 0
    /// One update at a time: two overlapping ones (a page left and reopened)
    /// could finish out of order and leave the trail on older actions.
    @ObservationIgnored private var updating = false

    /// The first load takes the match in big pages; later refreshes ask for
    /// small ones, so a live update is a few kilobytes, not the last 200 plays.
    private static let firstPageSize = 200
    private static let updatePageSize = 25
    private static let trailLength = 10

    func update(league: String, eventID: String, homeTeamID: String?) async {
        guard !updating else { return }
        updating = true
        defer { updating = false }
        let base = "https://sports.core.api.espn.com/v2/sports/soccer/leagues/\(league)/events/\(eventID)/competitions/\(eventID)/plays"
        let size = loaded ? Self.updatePageSize : Self.firstPageSize
        var page = fetched / size + 1
        var newActions: [PitchAction] = []
        var newCards: [String: PitchAction] = [:]
        var unplaced: [LiveMoment] = []
        var complete = false
        while true {
            guard !Task.isCancelled, let url = URL(string: "\(base)?limit=\(size)&page=\(page)"),
                  let json = try? await JSON.fetch(url) else { break }
            let items = json["items"].array
            for (offset, item) in items.enumerated() {
                let index = (page - 1) * size + offset
                guard index >= fetched else { continue }
                if let action = Self.action(item, index: index, homeTeamID: homeTeamID) {
                    newActions.append(action)
                    recent = Array((recent + [action]).suffix(6))
                } else if let card = Self.card(item, index: index, recent: recent) {
                    newCards[card.playID] = card
                } else if let moment = Self.cardMoment(item, homeTeamID: homeTeamID) {
                    // Its foul isn't in (late, or out of order): still news, just not placed.
                    unplaced.append(moment)
                }
            }
            fetched = max(fetched, (page - 1) * size + items.count)
            let pageCount = json["pageCount"].int ?? page
            if page >= pageCount || items.isEmpty {
                complete = true
                break
            }
            page += 1
        }
        // Until this page has had a complete load it's history; after, goals,
        // shots and cards are news.
        if primed {
            moments += newActions.compactMap(\.moment) + newCards.values.compactMap(\.moment) + unplaced
        }
        if complete { primed = true }
        loaded = true
        if !newCards.isEmpty { cards.merge(newCards) { _, new in new } }
        guard !newActions.isEmpty else { return }
        shots += newActions.filter { $0.kind == .shot || $0.kind == .goal }
        trail = Array((trail + newActions).suffix(Self.trailLength))
    }

    /// The moments since the last call.
    func takeMoments() -> [LiveMoment] {
        defer { moments = [] }
        return moments
    }

    /// A match page opened: what the feed fetches until its next complete
    /// load is history, not news.
    func beginPage() {
        primed = false
        moments = []
    }

    /// A card as a moment, from the card entry alone.
    static func cardMoment(_ item: JSON, homeTeamID: String?) -> LiveMoment? {
        let type = item["type"]["type"].string ?? ""
        guard type.hasSuffix("card") || item["yellowCard"].bool == true || item["redCard"].bool == true else { return nil }
        let red = type.contains("red") || item["redCard"].bool == true
        let team = item["team"]["$ref"].string?.split(separator: "/").last?.split(separator: "?").first.map(String.init)
        let text = item["shortText"].string ?? item["text"].string ?? ""
        return LiveMoment(id: playID(item), chart: .pitch, tier: .swing, kind: .card(red: red),
                          lead: red ? "Red card" : "Yellow card", detail: MomentList.shortened(text),
                          side: team.map { $0 == homeTeamID ? .top : .bottom })
    }

    static func action(_ item: JSON, index: Int, homeTeamID: String?) -> PitchAction? {
        guard let x = item["fieldPositionX"].double, let y = item["fieldPositionY"].double,
              x != 0 || y != 0,
              let teamRef = item["team"]["$ref"].string,
              let teamID = teamRef.split(separator: "/").last?.split(separator: "?").first.map(String.init) else { return nil }
        let isHome = teamID == homeTeamID
        // Each team's coordinates have it attacking toward x = 100. Actions over
        // the touchline come in slightly outside 0…100; keep them on the pitch.
        func orient(_ value: Double?) -> Double? { value.map { min(max(isHome ? $0 : 100 - $0, 0), 100) } }
        let type = item["type"]["type"].string ?? ""
        // Exact types: substring matching would catch "attempted-tackle",
        // "assists-shot", keeper saves and goal kicks.
        // Goals by the scoring flag ("goal-kick" also starts with "goal").
        let kind: PitchAction.Kind =
            item["scoringPlay"].bool == true || type == "goal" || type.hasPrefix("goal---") || type == "penalty---scored"
                || type == "own-goal" ? .goal
            : type.hasPrefix("shot-") ? .shot
            : type == "pass" || type == "cross" ? .pass
            : .other
        let endX = item["fieldPosition2X"].double, endY = item["fieldPosition2Y"].double
        let hasEnd = (endX ?? 0) != 0 || (endY ?? 0) != 0
        var action = PitchAction(id: index, kind: kind, side: isHome ? .top : .bottom,
                                 x: orient(x)!, y: orient(y)!,
                                 endX: hasEnd ? orient(endX) : nil, endY: hasEnd ? orient(endY) : nil,
                                 minute: item["clock"]["displayValue"].string ?? "",
                                 text: item["shortText"].string ?? item["text"].string ?? item["type"]["text"].string ?? "",
                                 playID: playID(item))
        if kind == .shot {
            action.shot = switch type {
            case "shot-on-target": .saved
            case "shot-blocked": .blocked
            case "shot-hit-woodwork": .woodwork
            default: .wide
            }
        }
        if kind == .shot || kind == .goal {
            action.xg = item["expectedGoals"].double
            action.goalY = orient(item["goalPositionY"].double)
            action.goalZ = item["goalPositionZ"].double
        }
        action.topScore = item["homeScore"].int
        action.bottomScore = item["awayScore"].int
        action.clockSeconds = item["clock"]["value"].double
        return action
    }

    private static func playID(_ item: JSON) -> String {
        item["id"].string ?? item["id"].int.map(String.init) ?? ""
    }

    /// A card has no position of its own; ESPN logs the player's foul just
    /// before it, so the card goes there ("Nico González Foul" → "Nico González Yellow Card").
    static func card(_ item: JSON, index: Int, recent: [PitchAction]) -> PitchAction? {
        let type = item["type"]["type"].string ?? ""
        guard type.hasSuffix("card"), let text = item["shortText"].string else { return nil }
        let player = [" Second Yellow Card", " Yellow Card", " Red Card"].reduce(text) { name, suffix in
            name.hasSuffix(suffix) ? String(name.dropLast(suffix.count)) : name
        }
        guard !player.isEmpty, player != text, let foul = recent.last(where: { $0.text.hasPrefix(player) }) else { return nil }
        return PitchAction(id: index, kind: type.contains("red") ? .red : .yellow, side: foul.side,
                           x: foul.x, y: foul.y, endX: nil, endY: nil,
                           minute: item["clock"]["displayValue"].string ?? foul.minute, text: text, playID: playID(item))
    }
}

// MARK: - Live score

/// The score as of the newest play the fast lane has seen.
struct LiveScore: Equatable {
    let home: Int
    let away: Int

    init?(_ play: JSON) {
        guard let home = play["homeScore"].int, let away = play["awayScore"].int else { return nil }
        self.home = home
        self.away = away
    }
}

// MARK: - Football play-by-play

/// One snap of the current drive, on the field's coordinates (0 = the top
/// team's goal line, 100 = the bottom team's).
struct DrivePlay: Identifiable, Equatable {
    enum Kind { case rush, pass, sack, penalty, kick, score, turnover, other }
    let id: String
    let side: GameDetail.Side?
    let startX: Double
    let endX: Double
    let kind: Kind
    /// "1st & 10".
    let downDistance: String?
    let yards: Int
    let clock: String
    let text: String
    let driveID: String?
    /// ESPN's play type ("Pass Incompletion", "Rushing Touchdown").
    var type: String = ""
    var turnover = false
    /// ESPN's play type number: the reliable classifier (text gets edited, and
    /// has announced touchdowns that were overturned).
    var typeID: String = ""
    /// "touchdown", "field-goal", "safety" on scoring plays.
    var scoring: String?
    /// Play order: the feed isn't always listed in it.
    var sequence: Double = 0
    /// The score after the play (ESPN's fields include the extra point).
    var homeScore: Int?
    var awayScore: Int?
    var period: Int?
    /// Seconds left in the period.
    var clockSeconds: Double?

    /// A gain this long is a big play (LMD §1.3).
    static let bigPlayYards = 20

    /// What it looks like as it happens, if it's worth showing. Classified by
    /// type number and scoring fields, never by the play's text (only spikes
    /// and kneels, which share a type with passes and rushes, need it).
    var moment: (kind: LiveMoment.Kind, tier: LiveMoment.Tier, lead: String)? {
        let lower = text.lowercased()
        switch scoring {
        case "touchdown"?: return (.touchdown, .score, "Touchdown")
        case "field-goal"?: return (.fieldGoal, .score, "Field goal")
        case "safety"?: return (.safety, .score, "Safety")
        default: break
        }
        switch typeID {
        case "59": return (.fieldGoal, .score, "Field goal")
        case "60", "18": return (.fieldGoalMissed, .swing, "No good")
        case "20": return (.safety, .score, "Safety")
        case "26", "63", "36": return (.turnover, .swing, "Interception")
        case "29", "30": return (.turnover, .swing, "Fumble lost")
        case "7", "80": return (.sack, .routine, "Sack")
        case "3": return lower.contains("spike") ? nil : (.passIncomplete, .routine, "Incomplete")
        case "24", "67": return bigPlay ? (.passComplete, .swing, "Big play +\(yards)") : (.passComplete, .routine, "Complete")
        case "5", "68":
            if lower.contains("kneel") || lower.contains("takes a knee") { return nil }
            return bigPlay ? (.rush, .swing, "Big play +\(yards)") : (.rush, .routine, "Rush")
        case "8": return (.penalty, .routine, "Flag")
        default: return kind == .penalty ? (.penalty, .routine, "Flag") : nil
        }
    }

    /// A pass or rush of 20+ yards (and not a penalty).
    var bigPlay: Bool { yards >= Self.bigPlayYards && kind != .penalty }

    /// A score that puts its team ahead with two minutes or less left in the
    /// 4th, or in overtime: the game-winner. `before` is the score going into
    /// the play (home, away); `scorer` is whose points they are.
    func decides(before: (home: Int, away: Int)?, scorerIsHome: Bool) -> Bool {
        guard let period, let home = homeScore, let away = awayScore, let before else { return false }
        let late = period >= 5 || (period == 4 && (clockSeconds ?? .infinity) <= 120)
        let (mine, theirs) = scorerIsHome ? (home, away) : (away, home)
        let (was, wasTheirs) = scorerIsHome ? (before.home, before.away) : (before.away, before.home)
        return late && mine > theirs && was <= wasTheirs
    }
}

/// ESPN's real-time football lane while a match page is open: the down,
/// distance, spot and clock (two requests of a few hundred bytes) every few
/// seconds, and the play-by-play only when a new play has happened.
@MainActor
@Observable
final class FootballFeed {
    private(set) var plays: [DrivePlay] = []
    private(set) var situation: GameDetail.Football?
    /// "9:13 - 1st".
    private(set) var clock: String?
    /// The game clock from 5-second readings, so it ticks only while really running.
    private(set) var gameClock: GameClock?
    @ObservationIgnored private var fetched = 0
    @ObservationIgnored private var lastPlayRef: String?
    /// ID of the newest entry fetched (snap or not), to tell whether the feed
    /// has caught up with the situation's last play.
    @ObservationIgnored private var newestID: String?
    @ObservationIgnored private var possessionTeam: String?
    @ObservationIgnored private var latestSequence: Double = -1
    @ObservationIgnored private var newestMomentSequence: Double = -1
    /// When the situation first ran ahead of the play feed.
    @ObservationIgnored private var behindSince: Date?
    /// Scores taken back by an edit (overturned on review) since the last call.
    @ObservationIgnored private var retracted: [String] = []
    /// The team with the ball now (after the last play).
    private(set) var possession: GameDetail.Side?
    private(set) var score: LiveScore?
    /// Moments from plays that arrived since the page opened, for the page to take.
    @ObservationIgnored private(set) var moments: [LiveMoment] = []
    @ObservationIgnored private var primed = false
    @ObservationIgnored private var updating = false

    private static let pageSize = 50
    /// Clock stoppages and admin entries, not snaps.
    private static let notPlays: Set<String> = ["Official Timeout", "Timeout", "End Period", "End of Half", "End of Game",
                                                "Two-minute warning", "Coin Toss", "End of Regulation"]

    /// The plays of the drive in progress (or the last one), oldest first.
    var drive: [DrivePlay] {
        guard let id = plays.last?.driveID else { return [] }
        return Array(plays.reversed().prefix { $0.driveID == id }.reversed())
    }

    struct Teams {
        let topIsHome: Bool
        let topID: String?
        let bottomID: String?
        let homeAbbreviation: String
        let awayAbbreviation: String
        func side(_ id: String?) -> GameDetail.Side? { id == topID ? .top : id == bottomID ? .bottom : nil }
    }

    func update(path: String, eventID: String, teams: Teams) async {
        guard !updating else { return }
        updating = true
        defer { updating = false }
        let league = path.split(separator: "/").last.map(String.init) ?? path
        let base = "https://sports.core.api.espn.com/v2/sports/football/leagues/\(league)/events/\(eventID)/competitions/\(eventID)"
        guard let situationURL = URL(string: "\(base)/situation"), let statusURL = URL(string: "\(base)/status") else { return }
        async let situationCall = try? JSON.fetch(situationURL)
        async let statusCall = try? JSON.fetch(statusURL)
        let (situationJSON, status) = await (situationCall, statusCall)

        if let status {
            clock = Self.clock(status)
            if let text = clock, let seconds = status["clock"].double, let period = status["period"].int {
                gameClock = GameClock(seconds: seconds, sampledAt: .now, period: period, direction: .down,
                                      display: text, running: false).reading(after: gameClock)
            } else {
                gameClock = nil
            }
        }
        guard let situationJSON else { return }
        // New plays only when the last one changed.
        let lastRef = situationJSON["lastPlay"]["$ref"].string
        if lastRef != lastPlayRef || plays.isEmpty {
            await loadPlays(base: base, teams: teams)
            // The play feed trails the situation by a few seconds: keep asking
            // until it has the play the situation points to.
            let lastID = lastRef.flatMap { ref in ref.range(of: "/plays/").map { String(ref[$0.upperBound...].prefix { $0.isNumber }) } }
            if !Task.isCancelled, lastID == nil || lastID == newestID { lastPlayRef = lastRef }
        }
        // The ball moves with its play: hold a new spot back (briefly) until
        // the play that put it there is in, so the two animate together.
        let caughtUp = lastRef == lastPlayRef
        if caughtUp { behindSince = nil } else if behindSince == nil { behindSince = .now }
        guard caughtUp || situation == nil || Date.now.timeIntervalSince(behindSince ?? .now) > 15 else { return }
        possession = teams.side(possessionTeam)
        situation = Self.situation(situationJSON, possessionTeam: possessionTeam, teams: teams, lastPlay: plays.last?.text,
                                   afterScore: plays.last?.kind == .score)
    }

    private func loadPlays(base: String, teams: Teams) async {
        // Start at the page holding the newest known play and read it whole:
        // ESPN edits plays in place (yardage, the extra point, a call overturned).
        var page = max(fetched - 1, 0) / Self.pageSize + 1
        var new: [DrivePlay] = []
        var complete = false
        while !Task.isCancelled, let url = URL(string: "\(base)/plays?limit=\(Self.pageSize)&page=\(page)"),
              let json = try? await JSON.fetch(url) {
            let items = json["items"].array
            for item in items {
                newestID = item["id"].string ?? newestID
                // The score and the ball after the latest play in play order, not list order.
                let sequence = Double(item["sequenceNumber"].string ?? "") ?? item["sequenceNumber"].double ?? 0
                if sequence >= latestSequence {
                    latestSequence = sequence
                    if let latest = LiveScore(item) { score = latest }
                    if let team = Self.teamID(item["end"]["team"]["$ref"].string) ?? Self.teamID(item["team"]["$ref"].string) {
                        possessionTeam = team
                    }
                }
                if let play = Self.play(item, teams: teams) { new.append(play) }
            }
            fetched = max(fetched, (page - 1) * Self.pageSize + items.count)
            if page >= (json["pageCount"].int ?? page) || items.isEmpty {
                complete = true
                break
            }
            page += 1
        }
        // An edited play replaces its earlier version.
        let known = Dictionary(plays.enumerated().map { ($1.id, $0) }, uniquingKeysWith: { first, _ in first })
        var merged = plays
        var fresh: [DrivePlay] = []
        var upgraded: [DrivePlay] = []
        for play in new {
            if let index = known[play.id] {
                let was = merged[index].moment?.tier, now = play.moment?.tier
                if was == .score, now != .score { retracted.append(play.id) }
                if was != .score, now == .score { upgraded.append(play) }
                merged[index] = play
            } else if let index = fresh.firstIndex(where: { $0.id == play.id }) {
                fresh[index] = play
            } else {
                fresh.append(play)
            }
        }
        // The feed isn't always in play order; sequence numbers are (ties keep arrival order).
        if !new.isEmpty {
            plays = (merged + fresh).enumerated()
                .sorted { ($0.element.sequence, $0.offset) < ($1.element.sequence, $1.offset) }
                .map(\.element)
        }
        // Only a complete first load counts as history; after it, new plays
        // (and plays edited into a score) are news. A play older than one
        // already shown arrived late: it isn't "now" any more.
        if primed {
            let news = fresh.filter { $0.sequence >= newestMomentSequence } + upgraded
            let ordered = plays
            moments += news.sorted { $0.sequence < $1.sequence }.compactMap { play in
                Self.moment(play, before: Self.score(before: play, in: ordered), topIsHome: teams.topIsHome)
            }
            newestMomentSequence = max(newestMomentSequence, fresh.map(\.sequence).max() ?? -1)
        } else if complete {
            newestMomentSequence = plays.last?.sequence ?? -1
        }
        if complete { primed = true }
    }

    /// A play as a moment for the field. A touchdown belongs to whoever owns
    /// the end zone it reached: a pick-six or return scores for the defense.
    /// A late go-ahead score is decisive; a long gain is a big play.
    static func moment(_ play: DrivePlay, before: (home: Int, away: Int)? = nil, topIsHome: Bool = true) -> LiveMoment? {
        guard let m = play.moment else { return nil }
        let side: GameDetail.Side? = m.kind == .touchdown ? (play.endX >= 50 ? .top : .bottom) : play.side
        var moment = LiveMoment(id: play.id, chart: .field, tier: m.tier, kind: m.kind, lead: m.lead, detail: play.text, side: side)
        if (m.kind == .passComplete || m.kind == .rush), play.bigPlay { moment.accents.insert(.bigPlay) }
        if m.tier == .score, let side, play.decides(before: before, scorerIsHome: (side == .top) == topIsHome) {
            moment.accents.insert(.decisive)
        }
        return moment
    }

    /// The score going into a play: the nearest earlier play (in play order) that carries one.
    static func score(before play: DrivePlay, in ordered: [DrivePlay]) -> (home: Int, away: Int)? {
        guard let index = ordered.firstIndex(where: { $0.id == play.id }) else { return nil }
        return ordered[..<index].last { $0.homeScore != nil && $0.awayScore != nil }.map { ($0.homeScore!, $0.awayScore!) }
    }

    /// The moments since the last call.
    func takeMoments() -> [LiveMoment] {
        defer { moments = [] }
        return moments
    }

    /// Play IDs whose score was taken back since the last call.
    func takeRetractions() -> [String] {
        defer { retracted = [] }
        return retracted
    }

    /// The drive a play belongs to (the scoring drive stays on the field
    /// while its moment shows, even after the kickoff).
    func drive(containing playID: String) -> [DrivePlay]? {
        guard let driveID = plays.first(where: { $0.id == playID })?.driveID else { return nil }
        return plays.filter { $0.driveID == driveID }
    }

    // MARK: Parsing

    static func teamID(_ ref: String?) -> String? {
        guard let ref, let range = ref.range(of: "/teams/") else { return nil }
        return ref[range.upperBound...].split(whereSeparator: { $0 == "?" || $0 == "/" }).first.map(String.init)
    }

    static func clock(_ status: JSON) -> String? {
        guard let display = status["displayClock"].string, let period = status["period"].int, period > 0 else { return nil }
        let name = period <= 4 ? Ordinal.string(period) : period == 5 ? "OT" : "\(period - 4)OT"
        if status["type"]["state"].string == "post" { return nil }
        if let detail = status["type"]["shortDetail"].string, detail.lowercased().contains("half") { return detail }
        return "\(display) - \(name)"
    }

    static func play(_ item: JSON, teams: Teams) -> DrivePlay? {
        let type = item["type"]["text"].string ?? ""
        guard !notPlays.contains(type), !type.hasPrefix("End "),
              let start = item["start"]["yardLine"].double, let end = item["end"]["yardLine"].double,
              let id = item["id"].string else { return nil }
        let lower = type.lowercased()
        let kind: DrivePlay.Kind =
            item["scoringPlay"].bool == true ? .score
            : item["isTurnover"].bool == true ? .turnover
            : item["isPenalty"].bool == true || lower.contains("penalty") ? .penalty
            : lower.contains("sack") ? .sack
            : lower.contains("pass") ? .pass
            : lower.contains("rush") ? .rush
            : lower.contains("punt") || lower.contains("kickoff") || lower.contains("field goal") || lower.contains("extra point") ? .kick
            : .other
        return DrivePlay(
            id: id,
            side: teams.side(teamID(item["start"]["team"]["$ref"].string) ?? teamID(item["team"]["$ref"].string)),
            startX: FootballGeometry.x(start, topIsHome: teams.topIsHome), endX: FootballGeometry.x(end, topIsHome: teams.topIsHome),
            kind: kind,
            downDistance: item["start"]["shortDownDistanceText"].string.flatMap { $0.isEmpty ? nil : $0 },
            yards: item["statYardage"].int ?? 0,
            clock: item["clock"]["displayValue"].string ?? "",
            text: item["shortText"].string ?? item["text"].string ?? type,
            driveID: item["drive"]["$ref"].string.flatMap { ref in
                ref.range(of: "/drives/").map { String(ref[$0.upperBound...].prefix { $0.isNumber }) }
            },
            type: type,
            turnover: item["isTurnover"].bool ?? false,
            typeID: item["type"]["id"].string ?? "",
            scoring: item["scoringPlay"].bool == true ? item["scoringType"]["name"].string : nil,
            sequence: Double(item["sequenceNumber"].string ?? "") ?? item["sequenceNumber"].double ?? 0,
            homeScore: item["homeScore"].int, awayScore: item["awayScore"].int,
            period: item["period"]["number"].int, clockSeconds: item["clock"]["value"].double)
    }

    /// "2nd & 7 at MIN 38", the ball spot and line to gain, from the core
    /// situation. The geometry is `FootballGeometry`'s, the one tiles use, so
    /// the tile and the match page always draw the same lines (on 1st & Goal,
    /// none: the goal line is the target).
    static func situation(_ s: JSON, possessionTeam: String?, teams: Teams, lastPlay: String?,
                          afterScore: Bool = false) -> GameDetail.Football? {
        guard let yardLine = s["yardLine"].double else { return nil }
        let possession = teams.side(possessionTeam)
        let ballX = FootballGeometry.x(yardLine, topIsHome: teams.topIsHome)
        let down = s["down"].int ?? -1, distance = s["distance"].int ?? 0
        let homeHasBall = possession.map { ($0 == .top) == teams.topIsHome }
        let goal = homeHasBall.map { FootballGeometry.goalToGo(yardLine: yardLine, distance: distance, homeHasBall: $0) } ?? false
        let spot = yardLine == 50 ? "50" : yardLine < 50 ? "\(teams.homeAbbreviation) \(Int(yardLine))"
            : "\(teams.awayAbbreviation) \(Int(100 - yardLine))"
        var text: String?
        // After a score ESPN parks the next kickoff as a "1st & 10"; it isn't one.
        if afterScore {
            text = "Kickoff"
        } else if (1...4).contains(down) {
            text = "\(Ordinal.string(down)) & \(goal ? "Goal" : "\(distance)") at \(spot)"
        }
        let gain: Double? = !afterScore && (1...4).contains(down) && !goal
            ? possession.map { FootballGeometry.lineToGain(ballX: ballX, distance: distance, possession: $0) } : nil
        return GameDetail.Football(
            downDistance: text, ballX: ballX, lineToGainX: gain, possession: possession,
            redZone: s["isRedZone"].bool ?? false,
            topTimeouts: (teams.topIsHome ? s["homeTimeouts"] : s["awayTimeouts"]).int,
            bottomTimeouts: (teams.topIsHome ? s["awayTimeouts"] : s["homeTimeouts"]).int,
            lastPlay: lastPlay)
    }
}

// MARK: - Baseball pitch-by-pitch

/// ESPN's real-time baseball lane while a match page is open: count, outs,
/// runners, batter and pitcher every few seconds, and only the newest plays
/// when something happens, so each pitch lands in the zone as it's thrown.
@MainActor
@Observable
final class BaseballFeed {
    private(set) var situation: GameDetail.Baseball?
    /// Pitches of the at-bat in progress (or the last one between batters).
    private(set) var atBat: [GameDetail.Pitch] = []
    /// Balls in play seen since the page opened.
    private(set) var battedBalls: [GameDetail.BattedBall] = []
    /// "Top 7th".
    private(set) var inning: String?
    private(set) var score: LiveScore?
    /// True once the play feed has been read, so an empty at-bat is a fresh
    /// batter, not missing data.
    private(set) var loaded = false
    /// The play theater's last play on the field and who's up now. Assigned
    /// only when they change, so a pitch doesn't redraw the theater.
    private(set) var theater = TheaterState()
    /// The most recent plays, enough to hold the current at-bat.
    @ObservationIgnored private var window: [JSON] = []
    /// At-bat results that arrived since the page opened.
    @ObservationIgnored private var moments: [LiveMoment] = []
    @ObservationIgnored private var primed = false
    @ObservationIgnored private var fetched: Int?
    @ObservationIgnored private var lastPlayRef: String?
    @ObservationIgnored private var newestID: String?
    @ObservationIgnored private var updating = false

    private static let pageSize = 25
    private static let windowSize = 80

    func update(path: String, eventID: String, names: [String: String], side: @escaping (String?) -> GameDetail.Side?) async {
        guard !updating else { return }
        updating = true
        defer { updating = false }
        let league = path.split(separator: "/").last.map(String.init) ?? path
        let base = "https://sports.core.api.espn.com/v2/sports/baseball/leagues/\(league)/events/\(eventID)/competitions/\(eventID)"
        guard let situationURL = URL(string: "\(base)/situation"), let statusURL = URL(string: "\(base)/status") else { return }
        async let situationCall = try? JSON.fetch(situationURL)
        async let statusCall = try? JSON.fetch(statusURL)
        let (s, status) = await (situationCall, statusCall)
        if let status, status["type"]["state"].string == "in" {
            inning = status["type"]["shortDetail"].string
        }
        guard let s else { return }
        let lastRef = s["lastPlay"]["$ref"].string
        if lastRef != lastPlayRef || !loaded {
            await loadPlays(base: base, names: names, side: side)
            let lastID = lastRef.flatMap { ref in ref.range(of: "/plays/").map { String(ref[$0.upperBound...].prefix { $0.isNumber }) } }
            if !Task.isCancelled, lastID == nil || lastID == newestID { lastPlayRef = lastRef }
        }
        situation = Self.situation(s, names: names, lastPlay: window.last { $0["type"]["type"].string == "play-result" }?["text"].string)
    }

    private func loadPlays(base: String, names: [String: String], side: (String?) -> GameDetail.Side?) async {
        // First look: start a couple of pages from the end, not at the first pitch.
        if fetched == nil {
            guard let url = URL(string: "\(base)/plays?limit=1"), let head = try? await JSON.fetch(url) else { return }
            fetched = max((head["count"].int ?? 0) - 2 * Self.pageSize, 0)
        }
        guard var start = fetched else { return }
        var page = start / Self.pageSize + 1
        var new: [JSON] = []
        var complete = false
        while !Task.isCancelled, let url = URL(string: "\(base)/plays?limit=\(Self.pageSize)&page=\(page)"),
              let json = try? await JSON.fetch(url) {
            let items = json["items"].array
            for (offset, item) in items.enumerated() where (page - 1) * Self.pageSize + offset >= start {
                new.append(Self.normalized(item))
                newestID = item["id"].string ?? newestID
                if let latest = LiveScore(item) { score = latest }
            }
            start = max(start, (page - 1) * Self.pageSize + items.count)
            if page >= (json["pageCount"].int ?? page) || items.isEmpty {
                complete = true
                break
            }
            page += 1
        }
        fetched = start
        guard !Task.isCancelled else { return }
        // Until a complete look it's history; after, at-bat results are news.
        let news = primed
        if primed { moments += new.compactMap { Self.moment($0, side: side) } }
        if complete { primed = true }
        loaded = true
        guard !new.isEmpty else { return }
        window = Array((window + new).suffix(Self.windowSize))
        atBat = ESPNDetail.currentAtBat(window)
        updateTheater(news: news, names: names, side: side)
        let balls = ESPNDetail.battedBalls(window, side: side)
        var byID = Dictionary(battedBalls.map { ($0.id, $0) }, uniquingKeysWith: { _, new in new })
        for ball in balls { byID[ball.id] = ball }
        battedBalls = Array(byID.values)
    }

    private func updateTheater(news: Bool, names: [String: String], side: (String?) -> GameDetail.Side?) {
        let next = Self.theater(window, after: theater, primed: news, now: .now, names: names, side: side)
        if next != theater { theater = next }
    }

    /// The theater after a look at the plays. Its play is news if it arrived
    /// after the first complete look, or if it only just happened (a page
    /// opened right after it); otherwise it's history, shown as it ended. A
    /// play already showing keeps what it was. (pure; tested)
    static func theater(_ window: [JSON], after previous: TheaterState, primed: Bool, now: Date,
                        names: [String: String], side: (String?) -> GameDetail.Side?) -> TheaterState {
        var next = PlayScene.theater(window, side: side, names: names)
        if let play = next.play {
            next.news = play.id == previous.play?.id ? previous.news
                : primed || play.wallclock.map { now.timeIntervalSince($0) < recent } == true
        }
        return next
    }

    /// A play this fresh when the page opens still replays (ESPN publishes
    /// plays 15–45 s after they happen).
    static let recent: TimeInterval = 60

    /// The moments since the last call.
    func takeMoments() -> [LiveMoment] {
        defer { moments = [] }
        return moments
    }

    /// An at-bat's result as a moment, from its structured type (the result
    /// entry's `alternativeType`), never its text.
    static func moment(_ item: JSON, side: (String?) -> GameDetail.Side?) -> LiveMoment? {
        guard item["type"]["type"].string == "play-result", let id = item["id"].string else { return nil }
        let result = item["alternativeType"]["type"].string ?? ""
        let text = item["text"].string ?? ""
        let batting = side(item["team"]["id"].string)
        func moment(_ kind: LiveMoment.Kind, _ tier: LiveMoment.Tier, _ lead: String) -> LiveMoment {
            LiveMoment(id: id, chart: .plate, tier: tier, kind: kind, lead: lead, detail: text, side: batting)
        }
        let runs = item["scoreValue"].int ?? 1
        if result == "home-run" {
            var m = moment(.homeRun, .score, runs == 4 ? "Grand slam" : walkOff(item) ? "Walk-off home run" : "Home run")
            if runs == 4 { m.accents.insert(.grandSlam) }
            if walkOff(item) { m.accents.insert(.decisive) }
            return m
        }
        if item["scoringPlay"].bool == true {
            var m = moment(.runScored, .score, walkOff(item) ? "Walk-off" : runs > 1 ? "\(runs) runs score" : "Run scores")
            if walkOff(item) { m.accents.insert(.decisive) }
            return m
        }
        // Two outs on one play outranks the strikeout it may include (K + caught stealing).
        if item["doublePlay"].bool == true { return moment(.doublePlay, .swing, "Double play") }
        if result.hasPrefix("strike-") { return moment(.strikeout, .swing, "Strikeout") }
        if result.hasPrefix("ball") { return moment(.walk, .swing, "Walk") }
        if result == "hit-by-pitch" { return moment(.walk, .swing, "Hit by pitch") }
        switch result {
        case "single", "bunt-single": return moment(.hit, .swing, "Single")
        case "double": return moment(.hit, .swing, "Double")
        case "triple": return moment(.hit, .swing, "Triple")
        default: break
        }
        let outs: Set<String> = ["ground-out", "fly-out", "line-out", "pop-out", "foul-out", "bunt-ground-out", "sacrifice",
                                 "sacrifice-fly", "batters-fielders-choice---runner-out"]
        return outs.contains(result) ? moment(.outInPlay, .routine, "Out") : nil
    }

    /// The home team takes the lead in the bottom of the 9th or later: the
    /// game is over. A scoring result's score fields are the score after it.
    static func walkOff(_ item: JSON) -> Bool {
        guard item["period"]["type"].string?.lowercased().hasPrefix("bot") == true,
              let inning = item["period"]["number"].int, inning >= 9,
              let home = item["homeScore"].int, let away = item["awayScore"].int else { return false }
        let runs = item["scoreValue"].int ?? 1
        return home > away && home - runs <= away
    }

    /// Core plays name their team by link; the summary parsers expect `team.id`.
    private static func normalized(_ item: JSON) -> JSON {
        guard var raw = item.raw as? [String: Any] else { return item }
        if let id = FootballFeed.teamID(item["team"]["$ref"].string) { raw["team"] = ["id": id] }
        return JSON(raw)
    }

    static func situation(_ s: JSON, names: [String: String], lastPlay: String?) -> GameDetail.Baseball? {
        guard s["outs"].exists || s["balls"].exists else { return nil }
        func name(_ role: String) -> String? {
            s[role]["playerId"].int.map(String.init).flatMap { names[$0] }
        }
        return GameDetail.Baseball(
            balls: min(s["balls"].int ?? 0, 3), strikes: min(s["strikes"].int ?? 0, 2), outs: min(s["outs"].int ?? 0, 3),
            onFirst: s["onFirst"].exists, onSecond: s["onSecond"].exists, onThird: s["onThird"].exists,
            batter: name("batter"), pitcher: name("pitcher"), lastPlay: lastPlay,
            runners: GameDetail.Baseball.runners(s, names: names),
            batterID: s["batter"]["playerId"].int.map(String.init), pitcherID: s["pitcher"]["playerId"].int.map(String.init))
    }
}

// MARK: - Standings

struct StandingsRow: Identifiable, Equatable {
    /// Same format as `Competitor.id` ("espn-soccer-382").
    let id: String
    /// Conference or group ("Eastern Conference", "Group A"); nil for a single table.
    let group: String?
    let name: String
    let abbreviation: String
    let logo: URL?
    let rank: Int
    let played: Int
    let wins: Int
    let draws: Int
    let losses: Int
    let goalDifference: Int
    let goalsFor: Int
    let points: Int
    /// College: the conference a division's table belongs to ("Sun Belt" for
    /// "Sun Belt · East"); nil where the group is the conference itself.
    var parentGroup: String? = nil
    /// College: season and conference records ("7-1", "4-1") and streak ("W5").
    var overall: String? = nil
    var conference: String? = nil
    var streak: String? = nil
    /// NBA: games behind ("-", "2.5"), win percentage and the last ten ("7-3").
    var gamesBehind: String? = nil
    var winPercent: Double? = nil
    var lastTen: String? = nil
    /// NBA: every stat ESPN sends, by its name ("Home" "18-6", "Road", "avgPointsFor"
    /// "112.4", "differential" "+8.2"), for wider tables.
    var details: [String: String] = [:]
    /// Soccer: what this *position* earns ("Champions League", "Relegation"),
    /// from ESPN's note on the entry. It belongs to the place, not the team.
    var zone: String? = nil
}

/// A standings row adjusted for games in progress: every count moves
/// together, so a live 2–1 lead is +1 played, +1 won, +3 points, +2 for and
/// +1 against all at once (wider tables show each of them).
struct LiveStandingsRow: Identifiable, Equatable {
    let row: StandingsRow
    let liveRank: Int
    let points: Int
    let goalDifference: Int
    let played: Int
    let wins: Int
    let draws: Int
    let losses: Int
    let goalsFor: Int
    /// Derived, so it always agrees with GF and GD.
    var goalsAgainst: Int { goalsFor - goalDifference }
    /// What the live position earns (the zone of the place, after re-ranking).
    var zone: String? = nil
    /// Positive = climbing (official rank − live rank).
    var movement: Int { row.rank - liveRank }
    /// "2–1" from this team's side, while its game is live.
    let liveScore: String?
    /// Place in its table, counting from 0. ESPN's ranks can repeat for teams
    /// level on points, so gaps in a window are judged by position, not rank.
    var position = 0
    var id: String { row.id }
}

enum Standings {
    static func fetch(league: League) async throws -> [StandingsRow] {
        guard case let .espn(path, _) = league.source else { return [] }
        if path.hasSuffix("college-football") { return try await college(path: path) }
        if path == NBADetail.path { return try await NBAStandings.fetch() }
        guard league.sport == .soccer else { return [] }
        return soccer(try await JSON.fetch(URL.api("https://site.api.espn.com/apis/v2/sports/\(path)/standings")))
    }

    /// A soccer table (or its groups), sorted by group then rank.
    static func soccer(_ json: JSON) -> [StandingsRow] {
        let children = json["children"].array
        let grouped = children.count > 1
        let entries = children.flatMap { child in
            child["standings"]["entries"].array.map { (grouped ? child["name"].string : nil, $0) }
        }
        return entries.compactMap { group, e in
            guard let teamID = e["team"]["id"].string else { return nil }
            var stats: [String: Int] = [:]
            for s in e["stats"].array {
                if let name = s["name"].string, let value = s["value"].int ?? s["displayValue"].int { stats[name] = value }
            }
            return StandingsRow(
                id: "espn-soccer-\(teamID)", group: group,
                name: e["team"]["shortDisplayName"].string ?? e["team"]["displayName"].string ?? "",
                abbreviation: e["team"]["abbreviation"].string ?? "",
                logo: e["team"]["logos"][0]["href"].string.flatMap(URL.init(string:)),
                rank: stats["rank"] ?? 0, played: stats["gamesPlayed"] ?? 0,
                wins: stats["wins"] ?? 0, draws: stats["ties"] ?? 0, losses: stats["losses"] ?? 0,
                goalDifference: stats["pointDifferential"] ?? 0, goalsFor: stats["pointsFor"] ?? 0,
                points: stats["points"] ?? 0,
                zone: e["note"]["description"].string.map { $0.trimmingCharacters(in: .whitespaces) }.flatMap { $0.isEmpty ? nil : $0 })
        }
        .sorted { ($0.group ?? "", $0.rank) < ($1.group ?? "", $1.rank) }
    }

    /// College football by conference (and division, where a conference has
    /// them), in ESPN's order: conference record first.
    static func college(path: String) async throws -> [StandingsRow] {
        college(try await JSON.fetch(URL.api("https://site.api.espn.com/apis/v2/sports/\(path)/standings")), path: path)
    }

    static func college(_ json: JSON, path: String) -> [StandingsRow] {
        var rows: [StandingsRow] = []
        /// "4-1" → 0.8; no games → 0.
        func pct(_ record: String?) -> Double {
            let parts = (record ?? "").split(separator: "-").compactMap { Double($0) }
            guard parts.count >= 2, parts[0] + parts[1] > 0 else { return 0 }
            return parts[0] / (parts[0] + parts[1])
        }
        func add(_ table: JSON, group: String, parent: String? = nil) {
            // ESPN's order isn't always by record: conference win rate, then overall.
            let entries = table["standings"]["entries"].array.map { e -> (JSON, [String: String]) in
                var records: [String: String] = [:]
                for s in e["stats"].array {
                    if let type = s["type"].string, let value = s["displayValue"].string { records[type] = value }
                }
                return (e, records)
            }
            .enumerated()
            .sorted { a, b in
                let (ca, cb) = (pct(a.element.1["vsconf"]), pct(b.element.1["vsconf"]))
                if ca != cb { return ca > cb }
                let (oa, ob) = (pct(a.element.1["total"]), pct(b.element.1["total"]))
                if oa != ob { return oa > ob }
                return a.offset < b.offset
            }
            .map(\.element)
            for (index, (e, records)) in entries.enumerated() {
                guard let teamID = e["team"]["id"].string else { continue }
                rows.append(StandingsRow(
                    id: ESPNTeamID.make(path: path, sport: .football, team: teamID), group: group,
                    name: e["team"]["location"].string ?? e["team"]["shortDisplayName"].string ?? e["team"]["displayName"].string ?? "",
                    abbreviation: e["team"]["abbreviation"].string ?? "",
                    logo: e["team"]["logos"][0]["href"].string.flatMap(URL.init(string:)),
                    rank: index + 1, played: 0, wins: 0, draws: 0, losses: 0, goalDifference: 0, goalsFor: 0, points: 0,
                    parentGroup: parent, overall: records["total"], conference: records["vsconf"], streak: records["streak"],
                    // Every split ESPN sends (home, away, points for and against), for wider tables.
                    details: records))
            }
        }
        for conference in json["children"].array {
            let name = conference["shortName"].string ?? conference["name"].string ?? ""
            let divisions = conference["children"].array
            if divisions.isEmpty {
                add(conference, group: name)
            } else {
                // "Sun Belt - East" → "Sun Belt · East".
                for division in divisions {
                    add(division, group: (division["name"].string ?? name).replacingOccurrences(of: " - ", with: " · "), parent: name)
                }
            }
        }
        return rows
    }

    /// The table as it would stand if live games ended now: provisional points,
    /// record and goals, re-ranked on points, goal difference, goals for.
    static func live(_ rows: [StandingsRow], liveEvents: [Event]) -> [LiveStandingsRow] {
        // Each conference/group is its own table: project within it, keep its order.
        let groups = rows.reduce(into: [String?]()) { if !$0.contains($1.group) { $0.append($1.group) } }
        guard groups.count <= 1 else {
            return groups.flatMap { g in project(rows.filter { $0.group == g }, liveEvents: liveEvents) }
        }
        return project(rows, liveEvents: liveEvents)
    }

    /// A live game's effect on one side's line, as if it ended now.
    struct LiveResult: Equatable {
        var points = 0, won = 0, drawn = 0, lost = 0, goalsFor = 0, goalsAgainst = 0
        var score = ""

        init(scored: Int, conceded: Int) {
            goalsFor = scored
            goalsAgainst = conceded
            if scored > conceded { won = 1; points = 3 } else if scored == conceded { drawn = 1; points = 1 } else { lost = 1 }
            score = "\(scored)–\(conceded)"
        }
    }

    private static func project(_ rows: [StandingsRow], liveEvents: [Event]) -> [LiveStandingsRow] {
        var adjust: [String: LiveResult] = [:]
        // Knockout ties are played outside the league table.
        for event in liveEvents where event.state == .live && !event.isKnockout {
            guard case let .match(top, bottom) = event.content,
                  let a = top.id, let b = bottom.id,
                  let sa = top.score.flatMap(Int.init), let sb = bottom.score.flatMap(Int.init) else { continue }
            adjust[a] = LiveResult(scored: sa, conceded: sb)
            adjust[b] = LiveResult(scored: sb, conceded: sa)
        }
        let projected = rows.map { row -> LiveStandingsRow in
            let a = adjust[row.id]
            return LiveStandingsRow(
                row: row, liveRank: row.rank,
                points: row.points + (a?.points ?? 0),
                goalDifference: row.goalDifference + (a.map { $0.goalsFor - $0.goalsAgainst } ?? 0),
                played: row.played + (a == nil ? 0 : 1),
                wins: row.wins + (a?.won ?? 0), draws: row.draws + (a?.drawn ?? 0), losses: row.losses + (a?.lost ?? 0),
                goalsFor: row.goalsFor + (a?.goalsFor ?? 0),
                liveScore: a?.score)
        }
        // With nothing live, keep the official order (leagues break ties
        // differently: MLS on wins, not goal difference).
        let ordered = adjust.isEmpty ? projected.sorted { $0.row.rank < $1.row.rank } : projected.sorted { l, r in
            if l.points != r.points { return l.points > r.points }
            if l.goalDifference != r.goalDifference { return l.goalDifference > r.goalDifference }
            if l.goalsFor != r.goalsFor { return l.goalsFor > r.goalsFor }
            return l.row.rank < r.row.rank
        }
        // Zones belong to places: a team projected into 4th takes 4th's zone.
        let zoneAt = Dictionary(rows.compactMap { r in r.zone.map { (r.rank, $0) } }, uniquingKeysWith: { a, _ in a })
        return ordered.enumerated().map { index, p in
            let rank = adjust.isEmpty ? p.row.rank : index + 1
            return LiveStandingsRow(row: p.row, liveRank: rank, points: p.points, goalDifference: p.goalDifference,
                                    played: p.played, wins: p.wins, draws: p.draws, losses: p.losses, goalsFor: p.goalsFor,
                                    zone: zoneAt[rank], liveScore: p.liveScore, position: index)
        }
    }
}
