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
    /// A goal's full commentary line (the foot, the assist) and ESPN's type
    /// for it ("goal---header"), for the scoring slide.
    var account: String?
    var playType: String?

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
            m.facts = ScoringFacts(soccer: self)
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
/// flipped onto a single pitch. ESPN edits entries in place, behind the tail
/// (VAR striking a goal off retypes it): entries are known by ID, and for a
/// few minutes after a goal each refresh reads again from its page.
@MainActor
@Observable
final class SoccerFeed {
    private(set) var trail: [PitchAction] = []
    private(set) var shots: [PitchAction] = []
    /// Cards, placed where the foul that drew them happened, by play ID.
    private(set) var cards: [String: PitchAction] = [:]
    private(set) var loaded = false
    /// The soccer theater's latest big moment (a goal, a save, the woodwork)
    /// with its build-up. Assigned only when it changes, so a pass doesn't
    /// redraw the theater.
    private(set) var theater = SoccerTheaterState()
    /// The most recent plays, enough to hold a moment's build-up.
    @ObservationIgnored private var window: [JSON] = []
    /// Goalkeepers by team ID, as the plays reveal them.
    @ObservationIgnored private var keepers: [String: SoccerScene.Person] = [:]
    /// Goals, shots and cards that arrived since the page opened.
    @ObservationIgnored private var moments: [LiveMoment] = []
    /// Whether this page has had a complete load: before it, everything is
    /// history (the feed outlives the page, so it may be catching up).
    @ObservationIgnored private var primed = false
    /// This look follows on from the last (the page didn't leave and come back).
    @ObservationIgnored private var looks = FeedLooks()
    @ObservationIgnored private var following = true
    /// The last few located actions, kept across pages and refreshes, so a
    /// card (which has no position) can be put at its foul.
    @ObservationIgnored private var recent: [PitchAction] = []
    /// How many plays have been read (bookkeeping: no view shows it).
    @ObservationIgnored private var fetched = 0
    /// One update at a time: two overlapping ones (a page left and reopened)
    /// could finish out of order and leave the trail on older actions.
    @ObservationIgnored private var updating = false
    /// Every entry read, by ID: one read again is an edit, not news.
    @ObservationIgnored private var seen: Set<String> = []
    /// New entries so far: the IDs the trail's actions take (an entry
    /// inserted behind the tail mustn't reuse a position's).
    @ObservationIgnored private var serial = 0
    /// Goals VAR may still strike off.
    @ObservationIgnored private var reviews: [Review] = []
    /// Goals struck off since the last call, for the page to take back.
    @ObservationIgnored private var retracted: [String] = []
    /// Every shot and goal read, as the theater would replay it, by play ID:
    /// what the page's key events and plays list replay (Replays.swift).
    /// Assigned only when it changes.
    private(set) var replays: [String: PlayReplay] = [:]

    /// A goal under review: where it was read, and when.
    struct Review: Equatable {
        let id: String
        let team: String?
        /// Who scored it (athlete ID).
        var scorer: String?
        /// Match clock, in seconds.
        let clock: Double
        /// Its position in the feed when read.
        let index: Int
        let since: Date
    }
    /// How long a goal stays open to VAR: checks take a minute or two, and ESPN a little longer.
    static let reviewTime: TimeInterval = 300

    /// The first load takes the match in big pages; later refreshes ask for
    /// small ones, so a live update is a few kilobytes, not the last 200 plays.
    private static let firstPageSize = 200
    private static let updatePageSize = 25
    private static let trailLength = 10
    private static let windowSize = 80

    func update(league: String, eventID: String, homeTeamID: String?, lineups: [GameDetail.Side: SoccerLineup] = [:]) async {
        guard !updating else { return }
        updating = true
        defer { updating = false }
        following = looks.follows(at: .now)
        if !lineups.isEmpty, lineups != theater.lineups { theater.lineups = lineups }
        let base = "https://sports.core.api.espn.com/v2/sports/soccer/leagues/\(league)/events/\(eventID)/competitions/\(eventID)/plays"
        let size = loaded ? Self.updatePageSize : Self.firstPageSize
        var page = fetched / size + 1
        // A goal still open to review: read again from its page, not just the tail (one more
        // small request at most, for a few minutes after each goal).
        reviews.removeAll { Date.now.timeIntervalSince($0.since) > Self.reviewTime }
        if loaded, let oldest = reviews.map(\.index).min() { page = min(page, max(oldest - 2, 0) / size + 1) }
        var newActions: [PitchAction] = []
        var newCards: [String: PitchAction] = [:]
        var unplaced: [LiveMoment] = []
        var newItems: [JSON] = []
        var revised: [JSON] = []
        var complete = false
        // What the theater shows between moments: each event, the ball's whereabouts, the half.
        var newEvents: [SoccerEvent] = []
        var touch: SoccerTouch?
        var period: Int?
        var momentOrder: Int?
        while true {
            guard !Task.isCancelled, let url = URL(string: "\(base)?limit=\(size)&page=\(page)"),
                  let json = try? await JSON.fetch(url) else { break }
            let items = json["items"].array
            for (offset, item) in items.enumerated() {
                let id = Self.playID(item)
                // Read before: an edit, if anything changed.
                if !id.isEmpty, seen.contains(id) {
                    revised.append(item)
                    continue
                }
                seen.insert(id)
                newItems.append(item)
                let index = serial
                serial += 1
                let context = window + newItems
                if let event = SoccerEvent.parse(context, at: context.count - 1, homeTeamID: homeTeamID, order: index) { newEvents.append(event) }
                if let at = SoccerTouch.parse(item, homeTeamID: homeTeamID, order: index) { touch = at }
                if SoccerScene.isMoment(item) { momentOrder = index }
                period = item["period"]["number"].int ?? period
                if loaded || DateParser.parse(item["wallclock"].string).map({ Date.now.timeIntervalSince($0) < Self.reviewTime }) == true,
                   SoccerScene.isGoal(item) {
                    reviews.append(Review(id: id, team: SoccerScene.teamID(item), scorer: SoccerScene.credit(item)?.athlete,
                                          clock: item["clock"]["value"].double ?? 0, index: (page - 1) * size + offset, since: .now))
                }
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
        // Edits behind the tail: VAR's word on a goal under review.
        let struck = Self.struckOff(reviews, entries: revised + newItems)
        reviews.removeAll { review in
            struck.contains(review.id) || revised.contains { Self.playID($0) == review.id && Self.confirmed($0) }
        }
        // An entry read again that reads differently (its type, its words): the window takes the new version.
        var edited = Set<String>()
        window = window.map { old in
            guard let new = revised.first(where: { Self.playID($0) == Self.playID(old) }),
                  new["type"]["type"].string != old["type"]["type"].string || new["text"].string != old["text"].string else { return old }
            edited.insert(Self.playID(new))
            return new
        }
        if !struck.isEmpty {
            retract(struck, homeTeamID: homeTeamID)
            // Struck off before it was ever shown: it never arrives.
            newItems.removeAll { struck.contains(Self.playID($0)) && SoccerScene.isGoal($0) }
            newActions.removeAll { struck.contains($0.playID) }
        }
        if !newItems.isEmpty || !edited.isEmpty { readReplays(window + newItems, homeTeamID: homeTeamID) }
        let shownBefore = theater.scene?.id
        updateTheater(newItems, revised: edited, homeTeamID: homeTeamID, news: primed && following)
        if !newItems.isEmpty {
            var next = theater
            if theater.scene?.id != shownBefore, let momentOrder { next.sceneOrder = momentOrder }
            next.events = Array((next.events + newEvents).suffix(10))
            if primed, following, next.newsFrom == nil, let first = newEvents.first { next.newsFrom = first.order }
            next.touch = touch ?? next.touch
            next.period = period ?? next.period
            next.heard = primed ? .now : newItems.last.flatMap { DateParser.parse($0["wallclock"].string) } ?? next.heard
            if next != theater { theater = next }
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

    /// Play IDs of goals VAR struck off since the last call.
    func takeRetractions() -> [String] {
        defer { retracted = [] }
        return retracted
    }

    /// Parses a moment only when one has arrived (or the one showing has
    /// been followed by its save or block, or edited), with the plays before it.
    private func updateTheater(_ new: [JSON], revised: Set<String> = [], homeTeamID: String?, news: Bool) {
        let shown = theater.scene?.id
        guard !new.isEmpty || shown.map(revised.contains) == true else { return }
        let plays = window + new
        window = Array(plays.suffix(Self.windowSize))
        keepers.merge(SoccerScene.keepers(in: new)) { _, newer in newer }
        let first = plays.count - new.count
        guard let index = plays.indices.last(where: { SoccerScene.isMoment(plays[$0]) }),
              case let id = SoccerScene.playID(plays[index]),
              index >= first || (id == shown && (index >= first - 6 || id.map(revised.contains) == true)),
              let scene = SoccerScene.parse(plays, at: index, homeTeamID: homeTeamID, keepers: keepers) else { return }
        let next = Self.theater(scene, after: theater, primed: news, now: .now)
        if next != theater { theater = next }
    }

    /// Each moment in a run of plays (the window and what just came: on the
    /// first look, the whole match) as the theater would replay it, each
    /// read again while what follows it can still change it (its save, its
    /// block, VAR); an entry that's no longer a moment drops out.
    private func readReplays(_ plays: [JSON], homeTeamID: String?) {
        let known = keepers.merging(SoccerScene.keepers(in: plays)) { _, newer in newer }
        var next = replays
        for index in plays.indices {
            guard let id = SoccerScene.playID(plays[index]) else { continue }
            next[id] = Replays.soccer(plays, at: index, homeTeamID: homeTeamID, keepers: known)
        }
        if next != replays { replays = next }
    }

    /// A goal struck off: out of the shot map and the trail, taken back from
    /// the page's moments, and off the stage.
    private func retract(_ ids: Set<String>, homeTeamID: String?) {
        retracted += ids
        if replays.keys.contains(where: ids.contains) { replays = replays.filter { !ids.contains($0.key) } }
        shots.removeAll { ids.contains($0.playID) }
        trail.removeAll { ids.contains($0.playID) }
        window.removeAll { SoccerScene.playID($0).map(ids.contains) == true && SoccerScene.isGoal($0) }
        let next = Self.retracting(ids, from: theater, plays: window, homeTeamID: homeTeamID, keepers: keepers)
        if next != theater { theater = next }
    }

    /// Goals VAR has struck off, from what the feed says now: the goal's own
    /// entry retyped (to "deleted-after-review", or anything not a goal); or
    /// a "GOAL OVERTURNED BY VAR" or "VAR Decision: No Goal" entry naming
    /// the same scorer (else the same team's latest goal), within six
    /// minutes after it. (pure; tested)
    static func struckOff(_ reviews: [Review], entries: [JSON]) -> Set<String> {
        var struck = Set<String>()
        for item in entries {
            if let review = reviews.first(where: { $0.id == playID(item) }) {
                if !SoccerScene.isGoal(item) { struck.insert(review.id) }
                continue
            }
            let type = item["type"]["type"].string ?? ""
            guard type == "deleted-after-review" || (type.hasPrefix("var---") && (item["text"].string ?? "").contains("No Goal")),
                  let clock = item["clock"]["value"].double else { continue }
            let named = SoccerScene.credit(item)?.athlete
            let candidates = reviews.filter { review in
                review.team == SoccerScene.teamID(item) && clock >= review.clock - 5 && clock - review.clock <= 360
                    && (named == nil || review.scorer == nil || named == review.scorer)
            }
            if let goal = candidates.max(by: { $0.clock < $1.clock }) { struck.insert(goal.id) }
        }
        return struck
    }

    /// "…with a cross.Goal confirmed following VAR Review.": it stands.
    static func confirmed(_ item: JSON) -> Bool {
        SoccerScene.isGoal(item) && (item["text"].string ?? "").contains("confirmed following VAR")
    }

    /// The theater once VAR has struck goals off: one showing leaves the
    /// stage (kept as `overturned`, never to replay or celebrate as a goal),
    /// and the moment before it shows instead, as it ended. (pure; tested)
    static func retracting(_ ids: Set<String>, from state: SoccerTheaterState, plays: [JSON], homeTeamID: String?,
                           keepers: [String: SoccerScene.Person]) -> SoccerTheaterState {
        guard let shown = state.scene, ids.contains(shown.id) else { return state }
        var next = state
        var struck = shown
        struck.review = .overturned
        next.overturned = struck
        let rest = plays.filter { SoccerScene.playID($0).map(ids.contains) != true }
        next.scene = SoccerScene.latest(in: rest, homeTeamID: homeTeamID, keepers: keepers)
        next.news = false
        return next
    }

    /// The theater after a look at a moment. It's news if it arrived after
    /// the first complete load, or if it only just happened (a page opened
    /// right after it); otherwise it's history, shown as it ended. A moment
    /// already showing keeps what it was. (pure; tested)
    static func theater(_ scene: SoccerScene, after previous: SoccerTheaterState, primed: Bool, now: Date) -> SoccerTheaterState {
        var next = previous
        next.news = scene.id == previous.scene?.id ? previous.news
            : primed || scene.wallclock.map { now.timeIntervalSince($0) < BaseballFeed.recent } == true
        next.scene = scene
        return next
    }

    /// A match page opened: what the feed fetches until its next complete
    /// load is history, not news.
    func beginPage() {
        primed = false
        moments = []
        // Events from before are history: no beats for them.
        if theater.newsFrom != nil { theater.newsFrom = nil }
        // The theater's moment was on screen before: it shows as it ended, unless it only just happened.
        if theater.news, let scene = theater.scene {
            var shown = theater
            shown.scene = nil
            theater = Self.theater(scene, after: shown, primed: false, now: .now)
        }
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
        if kind == .goal {
            action.account = item["text"].string
            action.playType = type
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

/// A live feed's looks while its page is open. The page stops looking while
/// it's left for another (a team's, a player's) and starts again on coming
/// back: the look that catches up on what was missed is history, as on
/// opening the page, so the theater doesn't replay the plays it missed back
/// to back. Only the newest replays, if it only just happened. (pure; tested)
struct FeedLooks {
    /// Longer than the wait between looks plus a slow look's round trips.
    static let gap: TimeInterval = 30
    private var last: Date?

    /// Whether the look at `now` follows on from the last one; marks it.
    mutating func follows(at now: Date) -> Bool {
        defer { last = now }
        return last.map { now.timeIntervalSince($0) <= Self.gap } ?? true
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
    /// The play theater's last snap and whether it's news. Assigned only
    /// when it changes, so a clock reading doesn't redraw the theater (and
    /// the page never reads it: the theater does).
    private(set) var theater = FootballTheaterState()
    /// The sequence number of the theater's snap: an older entry never replaces it.
    @ObservationIgnored private var theaterSequence: Double = -1
    /// When the feed last brought a new entry, and the newest one's sequence: the theater's heartbeat.
    @ObservationIgnored private var heard: Date?
    @ObservationIgnored private var heardSequence: Double = -1
    @ObservationIgnored private var primed = false
    /// This look follows on from the last (the page didn't leave and come back).
    @ObservationIgnored private var looks = FeedLooks()
    @ObservationIgnored private var following = true
    @ObservationIgnored private var updating = false
    /// Both teams' depth charts (NFL), once fetched; when they were last asked for.
    @ObservationIgnored private var charts: [GameDetail.Side: FootballDepthChart] = [:]
    @ObservationIgnored private var chartsAsked: Date?
    /// Depth charts by season and team, kept for the day across pages: they change once a week.
    private static var chartCache: [String: (chart: FootballDepthChart, fetched: Date)] = [:]

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
        /// The teams' names ("Kent State"): college's text writes some spots
        /// with them ("Kent38"), not the abbreviation.
        var homeName = ""
        var awayName = ""
        func side(_ id: String?) -> GameDetail.Side? { id == topID ? .top : id == bottomID ? .bottom : nil }
    }

    /// Every entry read, by ID, in the order read (an edit replaces its
    /// earlier version): the page's replays build its scoring plays from it
    /// (never observed).
    @ObservationIgnored private(set) var entries: [JSON] = []
    @ObservationIgnored private var entryIndex: [String: Int] = [:]

    func update(path: String, eventID: String, teams: Teams) async {
        guard !updating else { return }
        updating = true
        defer { updating = false }
        following = looks.follows(at: .now)
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
        // Who starts where, once a game (college has no depth charts).
        if league == "nfl", charts.isEmpty, Date.now.timeIntervalSince(chartsAsked ?? .distantPast) > 300 {
            chartsAsked = .now
            await loadCharts(teams: teams)
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
        /// Entries newer than the theater's snap: only the newest that is one gets parsed.
        var newer: [(item: JSON, sequence: Double)] = []
        while !Task.isCancelled, let url = URL(string: "\(base)/plays?limit=\(Self.pageSize)&page=\(page)"),
              let json = try? await JSON.fetch(url) {
            let items = json["items"].array
            for item in items {
                newestID = item["id"].string ?? newestID
                if let id = item["id"].string {
                    if let i = entryIndex[id] { entries[i] = item } else {
                        entryIndex[id] = entries.count
                        entries.append(item)
                    }
                }
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
                if sequence >= theaterSequence { newer.append((item, sequence)) }
                if sequence > heardSequence {
                    heardSequence = sequence
                    heard = primed ? .now : item["wallclock"].string.flatMap(FootballScene.date) ?? heard
                }
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
        // The newest few snaps, oldest first: each is spotted on its hash from the one before.
        let charts = charts
        let recent = Array(newer.sorted { $0.sequence > $1.sequence }.lazy
            .compactMap { entry in FootballScene.parse(entry.item, teams: teams).map { (scene: $0.slotted(by: charts), sequence: entry.sequence) } }
            .prefix(5).reversed())
        // What stopped play after the newest snap (a timeout, a TV timeout, the quarter's end), if anything has.
        let after = recent.last?.sequence ?? theaterSequence
        let stoppage = newer.filter { $0.sequence > after }.max { $0.sequence < $1.sequence }
            .flatMap { FootballStoppage.parse($0.item, teams: teams) }
        if let snap = recent.last, !Task.isCancelled {
            theaterSequence = snap.sequence
            let snaps = recent.map(\.scene)
            // The snap showing keeps the hash its own plays put it on (an edit doesn't move it).
            let spotted: [FootballScene]
            if let shown = theater.play, let i = snaps.firstIndex(where: { $0.id == shown.id }) {
                var kept = snaps[i]
                kept.hash = shown.hash
                spotted = [kept] + Self.spot(Array(snaps[(i + 1)...]), after: kept)
            } else {
                spotted = Self.spot(snaps, after: theater.play)
            }
            var next = Self.theater(spotted, stoppage: stoppage, after: theater, primed: primed && following, now: .now)
            next.heard = heard
            if next != theater { theater = next }
        } else if !Task.isCancelled, theater.heard != heard || (stoppage != nil && stoppage != theater.stoppage) {
            var next = theater
            next.heard = heard
            if let stoppage { next.stoppage = stoppage }
            theater = next
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
        if m.tier == .score { moment.facts = ScoringFacts(football: play, before: before, topIsHome: topIsHome) }
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

    /// The theater after a look at the plays. Its snap is news if it arrived
    /// after the first complete look, or if it only just happened (a page
    /// opened right after it); otherwise it's history, shown as it ended. A
    /// snap already showing keeps what it was, edits and all. (pure; tested)
    static func theater(_ scene: FootballScene, after previous: FootballTheaterState, primed: Bool, now: Date) -> FootballTheaterState {
        var next = previous
        next.play = scene
        next.news = scene.id == previous.play?.id ? previous.news
            : primed || scene.wallclock.map { now.timeIntervalSince($0) < BaseballFeed.recent } == true
        return next
    }

    /// The theater after a look that brought `snaps` (oldest first, the
    /// one showing among them if it was read again): the newest is its play.
    /// While the page is open each new snap joins the queue in order, so a
    /// look that brings two (the feed caught up, a score and its kickoff)
    /// replays both; an edited snap replaces its earlier version there too.
    /// `stoppage` is whatever stopped play after the newest. (pure; tested)
    static func theater(_ snaps: [FootballScene], stoppage: FootballStoppage?, after previous: FootballTheaterState, primed: Bool,
                        now: Date) -> FootballTheaterState {
        guard let last = snaps.last else {
            var next = previous
            next.stoppage = stoppage ?? previous.stoppage
            return next
        }
        var next = theater(last, after: previous, primed: primed, now: now)
        next.stoppage = stoppage
        let edited = { (scene: FootballScene) in snaps.first { $0.id == scene.id } ?? scene }
        if next.news, primed {
            let shown = previous.play.flatMap { p in snaps.firstIndex { $0.id == p.id } }
            let fresh = shown.map { Array(snaps[($0 + 1)...]) } ?? (previous.play == nil ? [last] : snaps)
            var queue = (previous.news ? previous.queue : previous.play.map { [$0] } ?? []).map(edited)
            for snap in fresh where !queue.contains(where: { $0.id == snap.id }) { queue.append(snap) }
            if !queue.contains(where: { $0.id == last.id }) { queue.append(last) }
            next.queue = Array(queue.suffix(5))
        } else {
            next.queue = [last]
        }
        return next
    }

    /// Both teams' depth charts, from the day's cache or fetched together
    /// (official ESPN core, about 20 KB each); the snap showing is then
    /// placed on them.
    private func loadCharts(teams: Teams) async {
        let season = Self.season(.now)
        async let top = Self.depthChart(team: teams.topID, season: season)
        async let bottom = Self.depthChart(team: teams.bottomID, season: season)
        var found: [GameDetail.Side: FootballDepthChart] = [:]
        (found[.top], found[.bottom]) = await (top, bottom)
        guard !found.isEmpty, !Task.isCancelled else { return }
        charts = found
        var next = theater
        next.charts = found
        next.play = next.play?.slotted(by: found)
        next.queue = next.queue.map { $0.slotted(by: found) }
        if next != theater { theater = next }
    }

    static func depthChart(team: String?, season: Int) async -> FootballDepthChart? {
        guard let team else { return nil }
        let key = "\(season)/\(team)"
        if let cached = chartCache[key], Date.now.timeIntervalSince(cached.fetched) < 86_400 { return cached.chart }
        guard let url = URL(string: "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/\(season)/teams/\(team)/depthcharts"),
              let json = try? await JSON.fetch(url), let chart = FootballDepthChart(json) else { return nil }
        chartCache[key] = (chart, .now)
        return chart
    }

    /// The NFL season a date falls in: September to February. (pure; tested)
    static func season(_ date: Date) -> Int {
        let parts = Calendar(identifier: .gregorian).dateComponents(in: TimeZone(identifier: "America/New_York") ?? .current, from: date)
        return (parts.year ?? 2026) - ((parts.month ?? 9) <= 2 ? 1 : 0)
    }

    /// Spots each snap on its hash from the one before it (oldest first;
    /// the first from `previous`, or in the middle with nothing before it).
    /// (pure; tested)
    static func spot(_ snaps: [FootballScene], after previous: FootballScene?) -> [FootballScene] {
        var before = previous
        return snaps.map { snap in
            var spotted = snap
            spotted.hash = before?.nextHash ?? .middle
            before = spotted
            return spotted
        }
    }

    /// The last snap in a run of entries, spotted from the few before it. (pure; tested)
    static func spotted(_ items: ArraySlice<JSON>, teams: Teams) -> FootballScene? {
        let recent = items.reversed().lazy.compactMap { FootballScene.parse($0, teams: teams) }.prefix(6)
        return spot(Array(recent.reversed()), after: nil).last
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

extension FootballFeed.Teams {
    /// An event's teams: ESPN team IDs, codes and names, home from the summary.
    init(_ event: Event, topIsHome homeIsTop: Bool) {
        let ids = event.competitors.map { $0.id?.split(separator: "-").last.map(String.init) }
        let names = (top: event.competitors.first?.abbreviation ?? "", bottom: event.competitors.last?.abbreviation ?? "")
        let full = (top: event.competitors.first?.name ?? "", bottom: event.competitors.last?.name ?? "")
        self.init(topIsHome: homeIsTop, topID: ids.first ?? nil, bottomID: ids.last ?? nil,
                  homeAbbreviation: homeIsTop ? names.top : names.bottom, awayAbbreviation: homeIsTop ? names.bottom : names.top,
                  homeName: homeIsTop ? full.top : full.bottom, awayName: homeIsTop ? full.bottom : full.top)
    }
}

// MARK: - Baseball pitch-by-pitch

/// ESPN's real-time baseball lane while a match page is open: count, outs,
/// runners, batter and pitcher every few seconds, and only the newest plays
/// when something happens, so each pitch lands in the zone as it's thrown.
/// ESPN rewrites entries behind the tail (a scorer's ruling posted minutes
/// later, a steal that review made a caught stealing) and replaces a
/// challenged pitch with a new ID: entries are known by ID, and each look
/// (and a quiet look every 20 s) reads again from the previous at-bat.
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
    /// only when they change, so a pitch doesn't redraw the theater. A new
    /// plate appearance waits briefly for what Statcast measured of it.
    private(set) var theater = TheaterState()
    /// MLB's numbers for the game's men by name (`Statcast.numbers`): the
    /// pitchers' that ESPN's summary leaves out, for the tags. Assigned only when they change.
    private(set) var numbers: [String: String] = [:]
    /// The most recent plays, enough to hold the current at-bat, and where the first sits in the feed.
    @ObservationIgnored private var window: [JSON] = []
    @ObservationIgnored private var windowStart = 0
    /// When the plays were last read again from the previous at-bat.
    @ObservationIgnored private var reread: Date?
    /// Results rewritten into something they no longer are (or replaced) since the last call, for the page to take back.
    @ObservationIgnored private var retracted: [String] = []
    /// The theater as ESPN's plays have it, before Statcast's measurements.
    @ObservationIgnored private var espnTheater = TheaterState()
    /// Statcast's measurements by play ID, and the plays already looked up (once each).
    @ObservationIgnored private var measured: [String: PlayScene.Measured] = [:]
    @ObservationIgnored private var lookedUp: Set<String> = []
    /// A new plate appearance held back (up to `measureHold`) for its measurements.
    @ObservationIgnored private var holding: String?
    /// This game in MLB's feed (nil: not an MLB game).
    @ObservationIgnored private var lookup: Statcast.Lookup?
    /// At-bat results that arrived since the page opened.
    @ObservationIgnored private var moments: [LiveMoment] = []
    @ObservationIgnored private var primed = false
    /// This look follows on from the last (the page didn't leave and come back).
    @ObservationIgnored private var looks = FeedLooks()
    @ObservationIgnored private var following = true
    @ObservationIgnored private var fetched: Int?
    @ObservationIgnored private var lastPlayRef: String?
    @ObservationIgnored private var newestID: String?
    @ObservationIgnored private var updating = false
    /// MLB's at-bat under way and the game's status there (its live poll).
    @ObservationIgnored private var mlbLive: Statcast.Live?
    /// ESPN's status, held up ("Rain Delay").
    @ObservationIgnored private var espnDelay: PlayBeat.Delay?
    /// The theater's timeline as built from the plays (and MLB's events), and every entry ID it has had.
    @ObservationIgnored private var timeline: [PlayBeat] = []
    @ObservationIgnored private var seenBeats: Set<String> = []
    @ObservationIgnored private var names: [String: String] = [:]
    /// When anything last came (a play, a pitch, the count, MLB's events): the theater's heartbeat.
    @ObservationIgnored private var heard: Date?

    private static let pageSize = 25
    private static let windowSize = 80
    /// A quiet game's plays are read again this often, for ESPN's rewrites.
    private static let rereadInterval: TimeInterval = 20

    func update(path: String, eventID: String, names: [String: String], statcast: Statcast.Lookup? = nil,
                side: @escaping (String?) -> GameDetail.Side?) async {
        guard !updating else { return }
        updating = true
        defer { updating = false }
        following = looks.follows(at: .now)
        lookup = statcast
        self.names = names
        let league = path.split(separator: "/").last.map(String.init) ?? path
        let base = "https://sports.core.api.espn.com/v2/sports/baseball/leagues/\(league)/events/\(eventID)/competitions/\(eventID)"
        guard let situationURL = URL(string: "\(base)/situation"), let statusURL = URL(string: "\(base)/status") else { return }
        async let situationCall = try? JSON.fetch(situationURL)
        async let statusCall = try? JSON.fetch(statusURL)
        let (s, status) = await (situationCall, statusCall)
        if let status, status["type"]["state"].string == "in" {
            inning = status["type"]["shortDetail"].string
        }
        let held = Self.delay(status)
        var refresh = held != espnDelay
        espnDelay = held
        // MLB's at-bat under way: what came between pitches as it comes (a few kilobytes, its own pace).
        if let statcast {
            let live = await StatcastStore.shared.live(espnEvent: statcast.espnEvent, start: statcast.start, teams: statcast.teams)
            if let live, live != mlbLive {
                if live.atBat != mlbLive?.atBat { heard = .now }
                mlbLive = live
                refresh = true
            }
        }
        if refresh, loaded {
            rebuildTimeline(news: primed && following)
            publish()
        }
        guard let s else { return }
        let lastRef = s["lastPlay"]["$ref"].string
        if lastRef != lastPlayRef || !loaded || reread.map({ Date.now.timeIntervalSince($0) > Self.rereadInterval }) == true {
            await loadPlays(base: base, names: names, side: side)
            let lastID = lastRef.flatMap { ref in ref.range(of: "/plays/").map { String(ref[$0.upperBound...].prefix { $0.isNumber }) } }
            if !Task.isCancelled, lastID == nil || lastID == newestID { lastPlayRef = lastRef }
        }
        let lastPlay = window.last { $0["type"]["type"].string == "play-result" }?["text"].string
        let next = Self.settledSituation(Self.situation(s, names: names, lastPlay: lastPlay), window: window, names: names)
        if next != situation {
            situation = next
            heard = .now
            publish()
        }
    }

    /// A delay as ESPN's status has it ("STATUS_RAIN_DELAY", "STATUS_DELAYED": "Rain Delay"). (pure; tested)
    static func delay(_ status: JSON?) -> PlayBeat.Delay? {
        guard let type = status?["type"], let name = type["name"].string, name.contains("DELAY") else { return nil }
        let detail = type["detail"].string ?? type["shortDetail"].string ?? ""
        return .weather(name.contains("RAIN") || detail.lowercased().contains("rain") ? "Rain" : detail)
    }

    /// A delay as MLB's live status has it ("Delayed: Rain"): before ESPN's, it's the game's own.
    static func delay(mlb status: String?) -> PlayBeat.Delay? {
        guard let status, status.hasPrefix("Delayed") else { return nil }
        let why = status.split(separator: ":", maxSplits: 1).last.map { $0.trimmingCharacters(in: .whitespaces) } ?? ""
        return why.hasPrefix("About to Resume") ? .resuming : .weather(why)
    }

    /// The theater's timeline again from the plays and MLB's at-bats (the
    /// full feed's, cached as plays are measured, and the one under way): an
    /// entry is news if it's new since the first complete look; one already
    /// had keeps what it was; the newest play is news as the theater's is.
    private func rebuildTimeline(news: Bool) {
        var mlb = lookup.map { StatcastStore.shared.cached(espnEvent: $0.espnEvent) } ?? []
        if let lookup {
            let known = StatcastStore.shared.numbers(espnEvent: lookup.espnEvent)
            if !known.isEmpty, known != numbers { numbers = known }
        }
        if let current = mlbLive?.atBat {
            if let i = mlb.firstIndex(where: { $0.index == current.index }) { mlb[i] = current } else { mlb.append(current) }
        }
        let before = Dictionary(timeline.map { ($0.id, $0.news) }, uniquingKeysWith: { a, _ in a })
        var line = PlayBeat.timeline(window, mlb: mlb, names: names)
        for i in line.indices {
            let id = line[i].id
            line[i].news = line[i].isPlay && id == espnTheater.play?.id ? espnTheater.news : before[id] ?? (news && !seenBeats.contains(id))
        }
        seenBeats.formUnion(line.map(\.id))
        timeline = line
    }

    private func loadPlays(base: String, names: [String: String], side: (String?) -> GameDetail.Side?) async {
        // First look: start a couple of pages from the end, not at the first pitch.
        if fetched == nil {
            guard let url = URL(string: "\(base)/plays?limit=1"), let head = try? await JSON.fetch(url) else { return }
            fetched = max((head["count"].int ?? 0) - 2 * Self.pageSize, 0)
            windowStart = fetched ?? 0
        }
        guard let end = fetched else { return }
        // From where the previous at-bat begins: what's there now replaces what was read.
        let from = Self.rereadStart(window).map { windowStart + $0 } ?? end
        var page = from / Self.pageSize + 1
        var fresh: [JSON] = []
        var complete = false
        var read = from
        while !Task.isCancelled, let url = URL(string: "\(base)/plays?limit=\(Self.pageSize)&page=\(page)"),
              let json = try? await JSON.fetch(url) {
            let items = json["items"].array
            for (offset, item) in items.enumerated() where (page - 1) * Self.pageSize + offset >= from {
                fresh.append(Self.normalized(item))
                newestID = item["id"].string ?? newestID
                if let latest = LiveScore(item) { score = latest }
            }
            read = max(read, (page - 1) * Self.pageSize + items.count)
            if page >= (json["pageCount"].int ?? page) || items.isEmpty {
                complete = true
                break
            }
            page += 1
        }
        // A look cut short says nothing about what's gone: the next one reads it again.
        guard !Task.isCancelled, complete || from == end else { return }
        reread = .now
        fetched = read
        let look = Self.reread(window, from: from - windowStart, fresh: fresh)
        window = look.window
        if window.count > Self.windowSize {
            windowStart += window.count - Self.windowSize
            window = Array(window.suffix(Self.windowSize))
        }
        // Until a complete look it's history; after, at-bat results are news
        // (not those a look coming back to the page catches up on).
        let news = primed && following
        if primed { moments += look.new.compactMap { Self.moment($0, side: side) } }
        // A result rewritten: its moment again (a bigger one is news again), and taken back if it no
        // longer applies; it's measured again as what it is now. One replaced is taken back too.
        let changed = look.revised.compactMap { $0.new["id"].string } + look.gone
        for (old, new) in look.revised {
            guard let id = new["id"].string else { continue }
            let rewrite = Self.rewritten(old, new, side: side)
            if rewrite.retract { retracted.append(id) }
            if primed, let now = rewrite.offer { moments.append(now) }
            measured[id] = nil
            lookedUp.remove(id)
        }
        retracted += look.gone
        if complete { primed = true }
        loaded = true
        guard !look.new.isEmpty || !changed.isEmpty else { return }
        heard = .now
        atBat = ESPNDetail.currentAtBat(window)
        updateTheater(news: news, names: names, side: side)
        let balls = ESPNDetail.battedBalls(window, side: side)
        var byID = Dictionary(battedBalls.filter { !changed.contains($0.id) }.map { ($0.id, $0) }, uniquingKeysWith: { _, new in new })
        for ball in balls { byID[ball.id] = ball }
        battedBalls = Array(byID.values)
    }

    /// A result ESPN rewrote: its moment now (a bigger one is news again;
    /// MomentCenter knows), and whether the one it was is taken back (gone,
    /// or now something else, or less). (pure; tested)
    static func rewritten(_ old: JSON, _ new: JSON, side: (String?) -> GameDetail.Side?) -> (offer: LiveMoment?, retract: Bool) {
        let was = moment(old, side: side), now = moment(new, side: side)
        guard let was else { return (now, false) }
        return (now, now.map { $0.kind != was.kind || $0.tier < was.tier } ?? true)
    }

    /// Where a look reads again from: the previous at-bat's first entry in
    /// the window (the current one's, if it's the only one). (pure; tested)
    static func rereadStart(_ window: [JSON]) -> Int? {
        var atBats: [String] = []
        for entry in window {
            if let id = entry["atBatId"].string, atBats.last != id { atBats.append(id) }
        }
        guard let previous = atBats.dropLast().last ?? atBats.last else { return nil }
        return window.firstIndex { $0["atBatId"].string == previous }
    }

    /// A look at the feed from `index` in the window on: the window with
    /// what's there now in place of what was, and what changed: entries new
    /// to it, entries read again that read differently (rewritten), and IDs
    /// no longer there (a challenged pitch replaced by a new ID). (pure; tested)
    static func reread(_ window: [JSON], from index: Int, fresh: [JSON]) -> (window: [JSON], new: [JSON], revised: [(old: JSON, new: JSON)], gone: [String]) {
        let keep = min(max(index, 0), window.count)
        var known: [String: JSON] = [:]
        for entry in window { if let id = entry["id"].string { known[id] = entry } }
        func reads(_ e: JSON) -> [String?] {
            [e["type"]["type"].string, e["alternativeType"]["type"].string, e["text"].string, e["scoreValue"].int.map(String.init),
             e["outs"].int.map(String.init), e["participants"].array.compactMap { PlayScene.participant(e, $0["type"].string ?? "") }.joined(separator: ",")]
        }
        var new: [JSON] = [], revised: [(old: JSON, new: JSON)] = []
        for entry in fresh {
            guard let id = entry["id"].string else { continue }
            if let was = known[id] {
                if reads(was) != reads(entry) { revised.append((was, entry)) }
            } else {
                new.append(entry)
            }
        }
        let now = Set(fresh.compactMap { $0["id"].string })
        let gone = window[keep...].compactMap { $0["id"].string }.filter { !now.contains($0) }
        return (Array(window[..<keep]) + fresh, new, revised, gone)
    }

    private func updateTheater(news: Bool, names: [String: String], side: (String?) -> GameDetail.Side?) {
        espnTheater = Self.theater(window, after: espnTheater, primed: news, now: .now, names: names, side: side)
        if let play = espnTheater.play, let lookup, play.appearance != nil || play.during != nil, !lookedUp.contains(play.id) {
            lookedUp.insert(play.id)
            measure(play, lookup)
        }
        rebuildTimeline(news: news)
        publish()
    }

    /// The theater: ESPN's, with whatever Statcast measured. While a new
    /// plate appearance is held for its measurements, the field keeps the last play.
    private func publish() {
        var next = espnTheater
        if let id = next.play?.id {
            if id == holding, id != theater.play?.id { return }
            next.play?.measured = measured[id]
        }
        next.timeline = timeline
        next.updated = heard
        next.delay = Self.delay(mlb: mlbLive?.status) ?? espnDelay
        if next != theater { theater = next }
    }

    /// Statcast for a new plate appearance (or MLB's legs for a runner's
    /// play between pitches): asked at once, then a few times
    /// more as its feed catches up (only for a new result, never on the
    /// poll's clock). The replay waits up to `measureHold`, then goes with
    /// ESPN's account alone; a measurement that lands later reaches the play
    /// once its replay is done (the theater never swaps one mid-replay).
    private func measure(_ play: PlayScene, _ lookup: Statcast.Lookup) {
        let id = play.id
        holding = id
        Task { [weak self] in
            try? await Task.sleep(for: Self.measureHold)
            guard let self, self.holding == id else { return }
            self.holding = nil
            self.publish()
        }
        Task { [weak self] in
            for wait in Self.measureRetries {
                if wait > .zero { try? await Task.sleep(for: wait) }
                guard !Task.isCancelled, self != nil else { return }
                if let found = await play.measure(lookup), let self {
                    self.measured[id] = found
                    if self.holding == id { self.holding = nil }
                    // MLB's full account is cached now: the pitches and what came between them.
                    self.rebuildTimeline(news: self.primed)
                    self.publish()
                    return
                }
            }
            guard let self, self.holding == id else { return }
            self.holding = nil
            self.publish()
        }
    }

    /// How long a new plate appearance waits for Statcast before it replays.
    static let measureHold: Duration = .seconds(3)
    /// Waits between asks: at once, then as Statcast's feed catches up.
    private static let measureRetries: [Duration] = [.zero, .seconds(2.2), .seconds(4), .seconds(9)]

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

    /// Results ESPN has since rewritten into something else (or replaced), for the page to take back.
    func takeRetractions() -> [String] {
        defer { retracted = [] }
        return retracted
    }

    /// An at-bat's result as a moment, from its structured type (the result
    /// entry's `alternativeType`), never its text.
    nonisolated static func moment(_ item: JSON, side: (String?) -> GameDetail.Side?) -> LiveMoment? {
        guard item["type"]["type"].string == "play-result", let id = item["id"].string else { return nil }
        let result = item["alternativeType"]["type"].string ?? ""
        let text = item["text"].string ?? ""
        let batting = side(item["team"]["id"].string)
        func moment(_ kind: LiveMoment.Kind, _ tier: LiveMoment.Tier, _ lead: String) -> LiveMoment {
            var m = LiveMoment(id: id, chart: .plate, tier: tier, kind: kind, lead: lead, detail: text, side: batting)
            if tier == .score { m.facts = ScoringFacts(baseball: item, batting: batting) }
            return m
        }
        let runs = item["scoreValue"].int ?? 1
        // The play theater's banner brings confetti for a triple, scored or not.
        func accented(_ m: LiveMoment) -> LiveMoment {
            var m = m
            if result == "triple" { m.accents.insert(.triple) }
            return m
        }
        if result == "home-run" {
            var m = moment(.homeRun, .score, runs == 4 ? "Grand slam" : walkOff(item) ? "Walk-off home run" : "Home run")
            if runs == 4 { m.accents.insert(.grandSlam) }
            if walkOff(item) { m.accents.insert(.decisive) }
            return m
        }
        if item["scoringPlay"].bool == true {
            var m = moment(.runScored, .score, walkOff(item) ? "Walk-off" : runs > 1 ? "\(runs) runs score" : "Run scores")
            if walkOff(item) { m.accents.insert(.decisive) }
            return accented(m)
        }
        // Two outs on one play outranks the strikeout it may include (K + caught stealing).
        if item["doublePlay"].bool == true { return moment(.doublePlay, .swing, "Double play") }
        if result.hasPrefix("strike-") { return moment(.strikeout, .swing, "Strikeout") }
        if result.hasPrefix("ball") { return moment(.walk, .swing, "Walk") }
        if result == "hit-by-pitch" { return moment(.walk, .swing, "Hit by pitch") }
        switch result {
        case "single", "bunt-single": return moment(.hit, .swing, "Single")
        case "double": return moment(.hit, .swing, "Double")
        case "triple": return accented(moment(.hit, .swing, "Triple"))
        default: break
        }
        let outs: Set<String> = ["ground-out", "fly-out", "line-out", "pop-out", "foul-out", "bunt-ground-out", "sacrifice",
                                 "sacrifice-fly", "batters-fielders-choice---runner-out"]
        return outs.contains(result) ? moment(.outInPlay, .routine, "Out") : nil
    }

    /// The home team takes the lead in the bottom of the 9th or later: the
    /// game is over. A scoring result's score fields are the score after it.
    nonisolated static func walkOff(_ item: JSON) -> Bool { PlayScene.walkOff(item) }

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
            batterID: s["batter"]["playerId"].int.map(String.init), pitcherID: s["pitcher"]["playerId"].int.map(String.init),
            runnerIDs: GameDetail.Baseball.runnerIDs(s))
    }

    /// At the Plate as the plays have it (the live check, Game 4): after the
    /// third out ESPN's situation resets the outs to 0 at once but goes on
    /// naming the batter who made it for half a minute or so (and once named
    /// nobody), so the diamond said 0 outs with the old batter, then lost its
    /// batter row. Until the situation names the next half's batter, the half
    /// is shown as it ended: 3 outs, the count and bases cleared, the last
    /// matchup. And a situation still naming the batter whose at-bat the
    /// plays have closed (or nobody, or someone the box score hasn't named
    /// yet, a pinch hitter) takes the matchup from the at-bat under way
    /// ("Dustin May pitches to Yandy Diaz"). (pure; tested)
    static func settledSituation(_ s: GameDetail.Baseball?, window: [JSON], names: [String: String]) -> GameDetail.Baseball? {
        guard let s else { return nil }
        func type(_ e: JSON) -> String? { e["type"]["type"].string }
        func half(_ e: JSON) -> String { "\(e["period"]["type"].string ?? "")\(e["period"]["number"].int ?? 0)" }
        func startsAtBat(_ e: JSON) -> Bool { type(e) == "start-batterpitcher" || e["summaryType"].string == "P" }
        func name(_ id: String?) -> String? { id.flatMap { names[$0] } }
        // The third out, and nothing of the next half's at-bats after it: the half as it ended.
        if let third = window.lastIndex(where: { type($0) == "play-result" && ($0["outs"].int ?? 0) >= 3 }),
           !window[(third + 1)...].contains(where: { startsAtBat($0) && half($0) != half(window[third]) }) {
            let batterID = PlayScene.participant(window[third], "batter"), pitcherID = PlayScene.participant(window[third], "pitcher")
            if s.batterID == nil || s.batterID == batterID {
                return GameDetail.Baseball(balls: 0, strikes: 0, outs: 3, onFirst: false, onSecond: false, onThird: false,
                                           batter: name(batterID) ?? s.batter, pitcher: name(pitcherID) ?? s.pitcher,
                                           lastPlay: s.lastPlay, runners: [nil, nil, nil],
                                           batterID: batterID ?? s.batterID, pitcherID: pitcherID ?? s.pitcherID)
            }
        }
        // The at-bat under way: the first entry after the last at-bat's result names both, by ID and in words.
        let closed = window.lastIndex { type($0) == "play-result" && PlayScene.participant($0, "batter") != nil }
        guard let start = window[(closed.map { $0 + 1 } ?? 0)...].first(where: startsAtBat) else { return s }
        let batterID = PlayScene.participant(start, "batter"), pitcherID = PlayScene.participant(start, "pitcher")
        let previous = closed.flatMap { PlayScene.participant(window[$0], "batter") }
        let stale = s.batterID == nil || (s.batterID == previous && batterID != nil && batterID != previous)
        let words = matchup(start["text"].string)
        let batter = stale ? name(batterID) ?? words?.batter ?? s.batter : s.batter ?? (s.batterID == batterID ? words?.batter : nil)
        let pitcher = stale ? name(pitcherID) ?? words?.pitcher ?? s.pitcher : s.pitcher ?? (s.pitcherID == pitcherID ? words?.pitcher : nil)
        return GameDetail.Baseball(balls: s.balls, strikes: s.strikes, outs: s.outs, onFirst: s.onFirst, onSecond: s.onSecond,
                                   onThird: s.onThird, batter: batter, pitcher: pitcher, lastPlay: s.lastPlay, runners: s.runners,
                                   batterID: stale ? batterID : s.batterID, pitcherID: stale ? pitcherID ?? s.pitcherID : s.pitcherID,
                                   runnerIDs: s.runnerIDs)
    }

    /// "Dustin May pitches to Yandy Diaz" → the pitcher and the batter, as ESPN wrote them.
    static func matchup(_ text: String?) -> (pitcher: String, batter: String)? {
        guard let text, let range = text.range(of: " pitches to "), range.lowerBound > text.startIndex else { return nil }
        var batter = text[range.upperBound...]
        if batter.count > 1, batter.hasSuffix(".") { batter = batter.dropLast() }
        return batter.isEmpty ? nil : (String(text[..<range.lowerBound]), String(batter))
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
